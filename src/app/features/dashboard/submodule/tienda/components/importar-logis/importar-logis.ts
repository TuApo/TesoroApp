import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { ContextoTiendaService } from '../../service/contexto-tienda.service';
import { InformeImportacion, Negocio, TiendaService } from '../../service/tienda.service';

/** Departamento sugerido para cada familia de Logis (se puede cambiar antes de importar). */
const DEPARTAMENTOS: Record<string, string> = {
  'Arroz': 'Supermercado', 'Avena': 'Supermercado', 'Bebida': 'Bebidas', 'Bebida instantanea': 'Supermercado', 'Cafe': 'Supermercado',
  'Cereal': 'Supermercado', 'Comida instantanea': 'Supermercado', 'Condimentos': 'Supermercado', 'Dulceria': 'Supermercado',
  'Embutidos': 'Supermercado', 'Enlatados': 'Supermercado', 'Granos': 'Supermercado', 'Grasas': 'Supermercado', 'Harinas': 'Supermercado',
  'Huevos': 'Supermercado', 'Lacteos': 'Supermercado', 'Pan': 'Supermercado', 'Pastas': 'Supermercado', 'Salsas': 'Supermercado',
  'Super ricas': 'Supermercado', 'Sanduchion': 'Supermercado', 'Aseo hogar': 'Aseo', 'Detergente': 'Aseo', 'Suavizante': 'Aseo',
  'Aseo personal': 'Cuidado personal', 'Maquillaje': 'Belleza', 'Perfumes': 'Belleza', 'Accesorios hombre': 'Moda',
  'Accesorios mujer': 'Moda', 'Joyeria': 'Moda', 'Ropa': 'Moda', 'Ropa mujer': 'Moda', 'Escolar': 'Escolar', 'Jugueteria': 'Juguetería',
  'Hogar': 'Hogar', 'Electrodomesticos': 'Hogar', 'Mascotas': 'Mascotas', 'Medicamentos': 'Droguería', 'Licores': 'Licores', 'Tabaco': 'Licores',
};
const LISTA_DEPARTAMENTOS = ['Supermercado', 'Bebidas', 'Aseo', 'Cuidado personal', 'Belleza', 'Moda', 'Hogar', 'Escolar', 'Juguetería',
  'Mascotas', 'Droguería', 'Licores', 'Tecnología', 'Servicios', 'Varios'];

/**
 * Importar el catálogo de un negocio desde Logis: maestro de productos (obligatorio),
 * catálogo de la tienda (qué se publica en EconomiAPP) y resumen de ventas (orden por lo más
 * vendido). Primero se previsualiza con el informe de calidad, luego se aplica en segundo
 * plano y se sigue el avance. Volver a importar actualiza: no duplica.
 */
@Component({
  selector: 'app-importar-logis',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './importar-logis.html',
  styleUrls: ['../../styles/tienda-comun.css', './importar-logis.css'],
})
export class ImportarLogis implements OnInit, OnDestroy {
  private api = inject(TiendaService);
  readonly ctx = inject(ContextoTiendaService);

  readonly LISTA_DEPARTAMENTOS = LISTA_DEPARTAMENTOS;
  readonly negocios = signal<Negocio[]>([]);
  negocio = '';
  tienda = '';
  prefijo = '';
  stockInicial = true;
  publicarTodo = false;
  vendedores: Array<{ categoria: string; negocio: string }> = [];
  readonly maestro = signal<File | null>(null);
  readonly catalogo = signal<File | null>(null);
  readonly resumen = signal<File | null>(null);
  readonly departamentos = signal<Record<string, string>>({ ...DEPARTAMENTOS });

  readonly informe = signal<InformeImportacion | null>(null);
  readonly avance = signal<InformeImportacion | null>(null);
  readonly historial = signal<Array<Record<string, unknown>>>([]);
  readonly ocupado = signal(false);
  readonly error = signal<string | null>(null);
  private sondeo: ReturnType<typeof setInterval> | null = null;

  readonly tiendasDelNegocio = computed(() => {
    const n = this.negocios().find(x => x.codigo === this.negocioSel());
    return n ? this.ctx.tiendas().filter(t => t.negocio_id === n.id) : [];
  });
  readonly negocioSel = signal('');
  readonly familias = computed(() => Object.keys(this.informe()?.familias ?? {}).sort());
  readonly pct = computed(() => {
    const a = this.avance();
    return a && a.productos ? Math.round(100 * (a.procesados ?? 0) / a.productos) : 0;
  });

  async ngOnInit(): Promise<void> {
    this.ctx.cargar();
    try {
      const ns = (await firstValueFrom(this.api.negocios())).filter(n => n.activo !== false);
      this.negocios.set(ns);
      const flora = ns.find(n => n.codigo === 'FLORA-MARKET');
      if (flora) this.elegirNegocio(flora.codigo);
    } catch { this.error.set('No se pudieron cargar los negocios'); }
    this.cargarHistorial();
  }

  ngOnDestroy(): void { if (this.sondeo) clearInterval(this.sondeo); }

  elegirNegocio(codigo: string): void {
    this.negocio = codigo;
    this.negocioSel.set(codigo);
    this.prefijo = codigo === 'FLORA-MARKET' ? 'MF' : codigo.replace(/[^A-Z0-9]/g, '').slice(0, 6);
    setTimeout(() => { this.tienda = this.tiendasDelNegocio()[0]?.id ?? ''; });
    this.informe.set(null);
  }

  archivo(tipo: 'maestro' | 'catalogo' | 'resumen', ev: Event): void {
    const f = (ev.target as HTMLInputElement).files?.[0] ?? null;
    ({ maestro: this.maestro, catalogo: this.catalogo, resumen: this.resumen })[tipo].set(f);
    this.informe.set(null);
  }

  cambiarDepartamento(familia: string, dep: string): void {
    this.departamentos.update(d => ({ ...d, [familia]: dep }));
  }
  departamentoDe(familia: string): string {
    const d = this.departamentos();
    const k = Object.keys(d).find(x => this.clave(x) === this.clave(familia));
    return k ? d[k] : 'Varios';
  }

  agregarVendedor(): void { this.vendedores = [...this.vendedores, { categoria: '', negocio: '' }]; }
  quitarVendedor(i: number): void { this.vendedores = this.vendedores.filter((_, j) => j !== i); }

  async previsualizar(): Promise<void> { await this.enviar(false); }
  async aplicar(): Promise<void> {
    const i = this.informe();
    if (!i || !confirm(`¿Importar ${i.productos} productos a ${this.negocio}? ${i.ya_importados ? i.ya_importados + ' ya existen y se actualizan.' : ''}`)) return;
    await this.enviar(true);
  }

  private async enviar(aplicar: boolean): Promise<void> {
    const m = this.maestro();
    if (!m || !this.negocio) { this.error.set('Elija el negocio y el maestro de productos.'); return; }
    const fd = new FormData();
    fd.append('maestro', m, m.name);
    if (this.catalogo()) fd.append('catalogo', this.catalogo()!, this.catalogo()!.name);
    if (this.resumen()) fd.append('resumen', this.resumen()!, this.resumen()!.name);
    fd.append('negocio', this.negocio);
    if (this.tienda) fd.append('tienda', this.tienda);
    if (this.prefijo) fd.append('prefijo', this.prefijo);
    const deps: Record<string, string> = {};
    for (const f of this.familias().length ? this.familias() : Object.keys(this.departamentos())) deps[f] = this.departamentoDe(f);
    fd.append('departamentos', JSON.stringify(deps));
    const vend: Record<string, string> = {};
    for (const v of this.vendedores) if (v.categoria.trim() && v.negocio) vend[v.categoria.trim()] = v.negocio;
    fd.append('vendedores', JSON.stringify(vend));
    fd.append('stockInicial', String(this.stockInicial));
    fd.append('publicarTodo', String(this.publicarTodo));
    fd.append('aplicar', String(aplicar));
    this.ocupado.set(true);
    this.error.set(null);
    try {
      const r = await firstValueFrom(this.api.importarLogis(fd));
      if (aplicar && r.id) { this.avance.set({ ...r, procesados: 0 }); this.seguir(r.id); }
      else this.informe.set(r);
    } catch (e: any) {
      this.error.set(e?.error?.error ?? e?.error?.message ?? 'No se pudo leer el archivo');
    } finally { this.ocupado.set(false); }
  }

  private seguir(id: string): void {
    if (this.sondeo) clearInterval(this.sondeo);
    this.sondeo = setInterval(async () => {
      try {
        const a = await firstValueFrom(this.api.estadoImportacion(id));
        this.avance.set(a);
        if (a.estado !== 'EN_CURSO') { clearInterval(this.sondeo!); this.sondeo = null; this.cargarHistorial(); }
      } catch { /* reintenta */ }
    }, 2500);
  }

  private async cargarHistorial(): Promise<void> {
    try { this.historial.set(await firstValueFrom(this.api.historialImportaciones())); } catch { /* opcional */ }
  }

  claves(o: Record<string, unknown> | undefined): string[] { return o ? Object.keys(o) : []; }
  private clave(s: string): string { return s.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase(); }
}
