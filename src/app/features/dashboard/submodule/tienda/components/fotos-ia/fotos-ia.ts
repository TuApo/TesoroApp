import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { ImagenAmpliableComponent } from '../../../../../../shared/components/imagen-ampliable/imagen-ampliable.component';
import { reducir } from '../../../../../economiapp/components/eco-captura-rostro';
import { ContextoTiendaService } from '../../service/contexto-tienda.service';
import { ConfigFotos, EstiloFoto, ImagenProducto, TiendaService, TrabajoFotoIa } from '../../service/tienda.service';
import { ConfigFotosTienda } from './config-fotos-tienda';

export const NOMBRE_ANGULO: Record<string, string> = {
  FRENTE: 'De frente', TRES_CUARTOS: 'Tres cuartos', LATERAL: 'De lado', POSTERIOR: 'Por detrás',
  SUPERIOR: 'Desde arriba', DETALLE: 'Detalle', EN_USO: 'En uso',
};

const ESTADO: Record<string, { texto: string; tono: string }> = {
  PENDIENTE: { texto: 'En cola', tono: 'espera' }, PROCESANDO: { texto: 'Generando…', tono: 'espera' },
  LISTO: { texto: 'Para revisar', tono: 'listo' }, ERROR: { texto: 'Falló', tono: 'mal' },
  APROBADO: { texto: 'Publicada', tono: 'bien' }, DESCARTADO: { texto: 'Descartada', tono: 'gris' },
};

/**
 * Mejora de fotos con IA: se parte de una foto real (una ya publicada o una que se toma
 * ahora), se eligen estilos y ángulos, se ve y se corrige la instrucción, y la IA edita la
 * foto — no inventa el producto. Cada versión se revisa al lado de la original y se
 * publica (como principal o adicional), se descarta o se vuelve a generar.
 */
@Component({
  selector: 'app-fotos-ia',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule, ImagenAmpliableComponent, ConfigFotosTienda],
  templateUrl: './fotos-ia.html',
  styleUrls: ['../../styles/tienda-comun.css', './fotos-ia.css'],
})
export class FotosIa {
  private api = inject(TiendaService);
  private ctx = inject(ContextoTiendaService);
  readonly productoId = input.required<string>();
  readonly fotos = input<ImagenProducto[]>([]);
  readonly publicada = output<void>();

  readonly tiendaId = computed(() => this.ctx.tiendaId());
  readonly puedeConfigurar = computed(() => ['ADMIN_NEGOCIO', 'ADMIN_TIENDA'].includes(this.ctx.rolEnTienda() ?? '') || this.ctx.esSuperAdmin());

  readonly cfg = signal<ConfigFotos | null>(null);
  readonly estilos = signal<EstiloFoto[]>([]);
  readonly angulosDisponibles = signal<string[]>(Object.keys(NOMBRE_ANGULO));
  readonly iaConfigurada = signal<boolean | null>(null);

  readonly base = signal<string | null>(null);
  readonly baseTomada = signal<string | null>(null);
  readonly subiendoBase = signal(false);
  readonly elegidos = signal<string[]>([]);
  readonly angulos = signal<string[]>(['FRENTE']);
  readonly extra = signal('');
  readonly prompt = signal('');
  readonly promptEditado = signal(false);
  readonly verConfig = signal(false);

  readonly trabajos = signal<TrabajoFotoIa[]>([]);
  readonly enviando = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  readonly total = computed(() => this.elegidos().length * this.angulos().length);
  readonly unaSola = computed(() => this.total() === 1);
  readonly enCurso = computed(() => this.trabajos().some(t => t.estado === 'PENDIENTE' || t.estado === 'PROCESANDO'));
  readonly visibles = computed(() => this.trabajos().filter(t => t.estado !== 'DESCARTADO'));
  readonly opcionesBase = computed(() => {
    const l = this.fotos().map(f => f.doc_id);
    const t = this.baseTomada();
    return t ? [t, ...l] : l;
  });

  private reloj: ReturnType<typeof setInterval> | null = null;

  constructor() {
    effect(() => {
      const t = this.tiendaId();
      untracked(() => this.cargarConfig(t));
    });
    effect(() => {
      const p = this.productoId();
      untracked(() => { this.base.set(null); this.baseTomada.set(null); this.cargarTrabajos(p); });
    });
    effect(() => {
      const f = this.fotos();
      untracked(() => { if (!this.base() && f.length) this.base.set((f.find(x => x.principal) ?? f[0]).doc_id); });
    });
    // La instrucción se recalcula al cambiar estilo/ángulo/extra, salvo que la persona la haya editado.
    effect(() => {
      const e = this.elegidos(), a = this.angulos(), x = this.extra();
      untracked(() => { if (!this.promptEditado()) this.recalcularPrompt(e, a, x); });
    });
    inject(DestroyRef).onDestroy(() => this.parar());
  }

  async cargarConfig(t: string | null): Promise<void> {
    let c: ConfigFotos | null = null;
    if (t) { try { c = await firstValueFrom(this.api.configFotos(t)); } catch { c = null; } }
    this.cfg.set(c);
    if (c?.estilos?.length) this.estilos.set(c.estilos);
    if (c?.angulos_disponibles?.length) this.angulosDisponibles.set(c.angulos_disponibles);
    this.iaConfigurada.set(c ? !!c.ia_configurada : null);
    if (!this.elegidos().length) this.elegidos.set([c?.estilo ?? 'FONDO_BLANCO']);
    if (!this.estilos().length) this.estilos.set(ESTILOS_RESPALDO);
  }

  async cargarTrabajos(p: string): Promise<void> {
    if (!p) return;
    try { this.trabajos.set(await firstValueFrom(this.api.trabajosFotoIa(p))); } catch { this.trabajos.set([]); }
    this.enCurso() ? this.arrancar() : this.parar();
  }

  private arrancar(): void {
    if (this.reloj) return;
    this.reloj = setInterval(() => this.cargarTrabajos(this.productoId()), 5000);
  }
  private parar(): void { if (this.reloj) { clearInterval(this.reloj); this.reloj = null; } }

  async tomarBase(ev: Event): Promise<void> {
    const inp = ev.target as HTMLInputElement; const a = inp.files?.[0]; inp.value = '';
    if (!a) return;
    this.subiendoBase.set(true); this.error.set(null);
    try {
      const b = await reducir(a, 1800);
      const doc = await firstValueFrom(this.api.subirArchivo(b, 'base-ia.jpg', this.productoId(), 'STORE_PRODUCTO'));
      this.baseTomada.set(doc); this.base.set(doc);
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo subir la foto'); }
    finally { this.subiendoBase.set(false); }
  }

  alternarEstilo(c: string): void {
    this.elegidos.update(l => l.includes(c) ? l.filter(x => x !== c) : [...l, c]);
  }
  alternarAngulo(a: string): void {
    this.angulos.update(l => l.includes(a) ? l.filter(x => x !== a) : [...l, a]);
  }

  editarPrompt(v: string): void { this.prompt.set(v); this.promptEditado.set(true); }
  restaurarPrompt(): void { this.promptEditado.set(false); this.recalcularPrompt(this.elegidos(), this.angulos(), this.extra()); }

  private async recalcularPrompt(e: string[], a: string[], x: string): Promise<void> {
    if (e.length !== 1 || a.length !== 1) { this.prompt.set(''); return; }
    try { this.prompt.set((await firstValueFrom(this.api.promptFotoIa(this.tiendaId(), e[0], a[0], x || undefined))).prompt); }
    catch { this.prompt.set(''); }
  }

  async generar(): Promise<void> {
    if (!this.total() || !this.base()) return;
    this.enviando.set(true); this.error.set(null); this.aviso.set(null);
    try {
      const r = await firstValueFrom(this.api.solicitarFotosIa(this.productoId(), {
        tienda_id: this.tiendaId(), doc_origen: this.base(), estilos: this.elegidos(), angulos: this.angulos(),
        extra: this.extra() || undefined, prompt: this.unaSola() && this.promptEditado() ? this.prompt() : undefined,
      }));
      this.trabajos.set(r);
      this.aviso.set(this.iaConfigurada() === false
        ? 'Quedaron en cola: se generan apenas se configure la llave de la IA.'
        : `${this.total()} versión(es) en camino. Tardan entre 20 s y 1 min cada una.`);
      this.arrancar();
    } catch (e: any) { this.error.set(e?.error?.error ?? e?.error?.message ?? 'No se pudo pedir la mejora'); }
    finally { this.enviando.set(false); }
  }

  async aprobar(t: TrabajoFotoIa, principal: boolean): Promise<void> {
    try {
      await firstValueFrom(this.api.aprobarFotoIa(t.id, principal));
      this.aviso.set(principal ? 'Publicada como foto principal.' : 'Publicada en las fotos del producto.');
      await this.cargarTrabajos(this.productoId());
      this.publicada.emit();
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo publicar'); }
  }

  async descartar(t: TrabajoFotoIa): Promise<void> {
    try { await firstValueFrom(this.api.descartarFotoIa(t.id)); await this.cargarTrabajos(this.productoId()); }
    catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo descartar'); }
  }

  /** Otra versión con el mismo estilo, ángulo e instrucción. */
  async regenerar(t: TrabajoFotoIa): Promise<void> {
    try {
      await firstValueFrom(this.api.solicitarFotosIa(this.productoId(), {
        tienda_id: this.tiendaId(), doc_origen: t.doc_origen, estilos: [t.estilo], angulos: [t.angulo],
        prompt: t.prompt.split(' CRITICAL:')[0],
      }));
      if (t.estado !== 'APROBADO') await firstValueFrom(this.api.descartarFotoIa(t.id));
      await this.cargarTrabajos(this.productoId());
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo regenerar'); }
  }

  async reintentar(): Promise<void> {
    try { const r = await firstValueFrom(this.api.reintentarFotosIa(this.tiendaId())); this.aviso.set(`${r.reintentados} versión(es) vuelven a la cola.`); await this.cargarTrabajos(this.productoId()); }
    catch { this.error.set('No se pudo reintentar'); }
  }

  configGuardada(c: ConfigFotos): void { this.cfg.set(c); if (c.estilos?.length) this.estilos.set(c.estilos); this.recalcularPrompt(this.elegidos(), this.angulos(), this.extra()); }

  nombreEstilo(c: string): string { return this.estilos().find(e => e.codigo === c)?.nombre ?? c; }
  nombreAngulo(a: string): string { return NOMBRE_ANGULO[a] ?? a; }
  estado(t: TrabajoFotoIa) { return ESTADO[t.estado] ?? { texto: t.estado, tono: 'gris' }; }
}

const ESTILOS_RESPALDO: EstiloFoto[] = [
  { codigo: 'FONDO_BLANCO', nombre: 'Fondo blanco de catálogo', descripcion: 'Producto centrado sobre blanco puro, sombra suave.', prompt: '' },
  { codigo: 'ESTUDIO', nombre: 'Estudio profesional', descripcion: 'Luz de estudio con degradado suave.', prompt: '' },
  { codigo: 'AMBIENTE', nombre: 'En ambiente', descripcion: 'El producto en un entorno real y limpio.', prompt: '' },
  { codigo: 'MARCA', nombre: 'Estilo de la marca', descripcion: 'Color e instrucciones de la tienda.', prompt: '' },
];
