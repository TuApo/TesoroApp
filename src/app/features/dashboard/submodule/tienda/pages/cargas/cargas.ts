import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { ImportarLogis } from '../../components/importar-logis/importar-logis';
import { mejorarFoto } from '../../util/mejorar-foto';
import { ContextoTiendaService } from '../../service/contexto-tienda.service';
import { ConfigFotosTienda } from '../../components/fotos-ia/config-fotos-tienda';
import {
  CategoriaResuelta, CodigoResuelto, FilaCatalogo, ResultadoCargaCatalogo, TiendaService,
} from '../../service/tienda.service';

type Pestana = 'fotos' | 'catalogo' | 'existencias' | 'familias' | 'logis';
type Estado = 'pendiente' | 'subiendo' | 'ok' | 'error' | 'omitido';

/** Fotos de un código (producto o familia), ya ordenadas por el número del nombre. */
interface GrupoFotos {
  codigo: string; archivos: Array<{ nombre: string; orden: number; blob: Blob }>;
  destinoId: string | null; destinoNombre: string | null; actuales: number; problema: string | null;
  estado: Estado; detalle: string;
}
interface FilaStock {
  fila: number; tienda: string; codigo: string; cantidad: number; costo: number | null; tipo: string; motivo: string;
  tiendaId?: string; productoId?: string; varianteId?: string | null; producto?: string; problema?: string;
  estado: Estado; detalle: string;
}

const IMAGEN = /\.(jpe?g|png|webp)$/i;
const MAX_FOTO = 8 * 1024 * 1024;

/** Encabezados de la hoja de catálogo, en el orden de la plantilla. */
const COLUMNAS_CATALOGO: Array<[keyof FilaCatalogo, string]> = [
  ['codigo_producto', 'Código del producto (P-0001). Obligatorio. Varias filas con el mismo código = opciones del mismo producto'],
  ['nombre_producto', 'Nombre comercial (obligatorio si el producto es nuevo)'],
  ['marca', 'Marca'],
  ['categoria', 'Ruta Familia > Grupo > Subcategoría. Lo que no exista se crea'],
  ['tipo', 'BIEN, SERVICIO o BONO (vacío = BIEN)'],
  ['condicion', 'Nuevo, Exhibición, Reacondicionado…'],
  ['origen', 'Importado, Nacional…'],
  ['garantia', 'Texto de garantía que ve el comprador'],
  ['descripcion', 'Descripción corta'],
  ['caracteristicas', 'Ficha técnica: "Pantalla: 6,1 OLED | Procesador: A16 | Cámara: 48 MP"'],
  ['etiquetas', 'Separadas por coma'],
  ['vendedor', 'Código del aliado que vende y despacha (TU-AFILIACION)'],
  ['negocio', 'Código del negocio dueño; vacío = catálogo global'],
  ['impuesto_pct', 'IVA en % (0 o 19)'],
  ['sku_variante', 'SKU de la opción (vacío si el producto no tiene opciones)'],
  ['nombre_variante', 'Cómo se ve la opción: "256GB eSIM 5G"'],
  ['ram', 'RAM'], ['almacenamiento', 'Almacenamiento'], ['sim', 'SIM'], ['red', 'Red (4G/5G)'],
  ['costo', 'Costo del proveedor'], ['precio', 'Precio de venta (obligatorio si es nuevo)'],
  ['precio_referencia', 'Precio típico en el comercio (opcional)'],
  ['activo', 'SI / NO (NO = cargado pero oculto)'],
];
const NUMERICAS = new Set(['impuesto_pct', 'costo', 'precio', 'precio_referencia']);

/**
 * Cargas masivas del catálogo: fotos por ZIP, productos y precios por hoja, existencias por
 * hoja y fotos de familias.
 *
 * <p>Las fotos se abren y suben desde el navegador una por una: un ZIP con cientos de fotos
 * no cabe en una sola petición, y así cada foto que falla se puede reintentar sola. El
 * nombre manda: `P-0052_iphone-15-pro-max_01.jpg` es la foto 1 del producto P-0052.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-tienda-cargas',
  imports: [CommonModule, FormsModule, MatIconModule, ImportarLogis, ConfigFotosTienda],
  templateUrl: './cargas.html',
  styleUrls: ['../../styles/tienda-comun.css', './cargas.css'],
})
export class Cargas implements OnInit {
  private api = inject(TiendaService);
  readonly ctx = inject(ContextoTiendaService);

  readonly pestana = signal<Pestana>('fotos');
  readonly ocupado = signal(false);
  readonly aviso = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  // ── Fotos (productos y familias comparten la mecánica) ──
  readonly grupos = signal<GrupoFotos[]>([]);
  readonly ignorados = signal<string[]>([]);
  reemplazar = false;
  /** Al terminar, pide a la IA una versión con el estilo de la tienda (queda para revisar). */
  conIa = false;
  readonly verEstilo = signal(false);
  /** Revelado automático (luz, color, nitidez) de cada foto antes de subirla. */
  mejorar = true;
  readonly progreso = signal({ hechas: 0, total: 0 });
  readonly listos = computed(() => this.grupos().filter(g => g.destinoId && !g.problema));
  readonly sinDestino = computed(() => this.grupos().filter(g => !g.destinoId || g.problema));
  readonly totalFotos = computed(() => this.listos().reduce((s, g) => s + g.archivos.length, 0));
  readonly terminados = computed(() => this.grupos().filter(g => g.estado === 'ok').length);
  readonly fallidos = computed(() => this.grupos().filter(g => g.estado === 'error').length);

  // ── Catálogo ──
  readonly filasCatalogo = signal<FilaCatalogo[]>([]);
  readonly resultado = signal<ResultadoCargaCatalogo | null>(null);
  readonly soloErrores = signal(false);
  readonly filasVisibles = computed(() => {
    const r = this.resultado();
    if (!r) return [];
    return this.soloErrores() ? r.filas.filter(f => f.accion === 'ERROR') : r.filas;
  });

  // ── Existencias ──
  readonly filasStock = signal<FilaStock[]>([]);
  readonly stockListas = computed(() => this.filasStock().filter(f => !f.problema));

  ngOnInit(): void {
    this.ctx.cargar();
  }

  cambiar(p: Pestana): void {
    if (this.ocupado()) return;
    this.pestana.set(p);
    this.limpiar();
  }

  limpiar(): void {
    this.grupos.set([]); this.ignorados.set([]); this.filasCatalogo.set([]); this.resultado.set(null);
    this.filasStock.set([]); this.aviso.set(null); this.error.set(null); this.progreso.set({ hechas: 0, total: 0 });
  }

  // ════════════════════════ FOTOS ════════════════════════

  /** Acepta un ZIP o varias imágenes sueltas. */
  async elegirFotos(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const archivos = Array.from(input.files ?? []);
    input.value = '';
    if (!archivos.length) return;
    this.limpiar();
    this.ocupado.set(true);
    try {
      const fotos: Array<{ ruta: string; blob: Blob }> = [];
      const ignorados: string[] = [];
      for (const a of archivos) {
        if (/\.zip$/i.test(a.name)) {
          const JSZip = (await import('jszip')).default;
          const zip = await JSZip.loadAsync(a);
          for (const entrada of Object.values(zip.files)) {
            if (entrada.dir || /(^|\/)(__MACOSX|\.)/.test(entrada.name)) continue;
            if (!IMAGEN.test(entrada.name)) { ignorados.push(entrada.name); continue; }
            const tipo = /\.png$/i.test(entrada.name) ? 'image/png' : /\.webp$/i.test(entrada.name) ? 'image/webp' : 'image/jpeg';
            fotos.push({ ruta: entrada.name, blob: new Blob([await entrada.async('arraybuffer')], { type: tipo }) });
          }
        } else if (IMAGEN.test(a.name)) {
          fotos.push({ ruta: a.name, blob: a });
        } else {
          ignorados.push(a.name);
        }
      }
      const porCodigo = new Map<string, GrupoFotos>();
      for (const f of fotos) {
        const { codigo, orden } = this.leerNombre(f.ruta);
        if (!codigo) { ignorados.push(f.ruta); continue; }
        if (f.blob.size > MAX_FOTO) { ignorados.push(`${f.ruta} (pasa de 8 MB)`); continue; }
        const nombre = f.ruta.split('/').pop()!;
        const g = porCodigo.get(codigo) ?? { codigo, archivos: [], destinoId: null, destinoNombre: null, actuales: 0,
          problema: null, estado: 'pendiente' as Estado, detalle: '' };
        g.archivos.push({ nombre, orden, blob: f.blob });
        porCodigo.set(codigo, g);
      }
      const grupos = [...porCodigo.values()];
      grupos.forEach(g => g.archivos.sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre)));
      this.ignorados.set(ignorados);
      if (!grupos.length) { this.error.set('No encontré fotos con un código en el nombre (ej. P-0052_iphone_01.jpg).'); return; }
      await this.resolverGrupos(grupos);
    } catch (e) {
      this.error.set('No se pudo abrir el archivo: ' + ((e as Error)?.message ?? 'formato no válido'));
    } finally {
      this.ocupado.set(false);
    }
  }

  /**
   * `P-0052_iphone-15-pro-max_01.jpg` → código P-0052, foto 1. Para familias el nombre
   * entero es el código (`GLB-CEL.jpg`, `Celulares.jpg`). Si el archivo está en una carpeta
   * y no trae código, manda la carpeta.
   */
  private leerNombre(ruta: string): { codigo: string; orden: number } {
    const partes = ruta.split('/');
    const archivo = partes.pop()!.replace(IMAGEN, '');
    const carpeta = partes.pop() ?? '';
    const num = archivo.match(/[_\- ](\d{1,3})$/);
    const orden = num ? Number(num[1]) : 1;
    if (this.pestana() === 'familias') {
      const base = num ? archivo.slice(0, -num[0].length) : archivo;
      return { codigo: base.trim(), orden };
    }
    if (archivo.includes('_')) return { codigo: archivo.split('_')[0].trim(), orden };
    if (/^\d{1,3}$/.test(archivo) && carpeta) return { codigo: carpeta.split('_')[0].trim(), orden: Number(archivo) };
    return { codigo: (num ? archivo.slice(0, -num[0].length) : archivo).trim(), orden };
  }

  private async resolverGrupos(grupos: GrupoFotos[]): Promise<void> {
    const codigos = grupos.map(g => g.codigo);
    if (this.pestana() === 'familias') {
      const r: CategoriaResuelta[] = await firstValueFrom(this.api.resolverCategorias(codigos));
      grupos.forEach((g, i) => {
        const x = r[i];
        g.destinoId = x?.categoria_id ?? null; g.destinoNombre = x?.nombre ?? null; g.actuales = x?.tiene_foto ? 1 : 0;
        g.problema = x?.ambiguo ? 'El nombre coincide con varias familias: use el código' : !g.destinoId ? 'No existe esa familia' : null;
        // Una familia lleva UNA foto: la de menor número.
        g.archivos = g.archivos.slice(0, 1);
      });
    } else {
      const r: CodigoResuelto[] = await firstValueFrom(this.api.resolverCodigos(codigos));
      const porCodigo = new Map(r.map(x => [x.codigo.toUpperCase(), x]));
      for (const g of grupos) {
        const x = porCodigo.get(g.codigo.toUpperCase());
        g.destinoId = x?.producto_id ?? null; g.destinoNombre = x ? (x.nombre ? `${x.sku} · ${x.nombre}` : null) : null;
        g.actuales = x?.fotos ?? 0;
        g.problema = x?.ambiguo ? 'Coincide con varios productos: ' + x.candidatos.join(', ')
          : !g.destinoId ? 'Ningún producto tiene ese código' : null;
      }
      // Dos códigos distintos (P-0052 y su opción TV-0065) pueden caer en el mismo producto.
      const porProducto = new Map<string, GrupoFotos>();
      for (const g of grupos.filter(x => x.destinoId && !x.problema)) {
        const otro = porProducto.get(g.destinoId!);
        if (otro) { otro.archivos.push(...g.archivos); g.problema = `Se sube junto con ${otro.codigo}`; g.estado = 'omitido'; }
        else porProducto.set(g.destinoId!, g);
      }
    }
    grupos.sort((a, b) => Number(!!a.problema) - Number(!!b.problema) || a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
    this.grupos.set(grupos);
  }

  async subirFotos(soloFallidos = false): Promise<void> {
    const cola = this.listos().filter(g => soloFallidos ? g.estado === 'error' : g.estado !== 'ok');
    if (!cola.length) return;
    this.ocupado.set(true); this.error.set(null); this.aviso.set(null);
    this.progreso.set({ hechas: 0, total: cola.reduce((s, g) => s + g.archivos.length, 0) });
    const familias = this.pestana() === 'familias';
    for (const g of cola) {
      this.actualizar(g, 'subiendo', 'Subiendo…');
      try {
        const docs: string[] = [];
        // Tres a la vez: rápido sin ahogar a gestión documental.
        for (let i = 0; i < g.archivos.length; i += 3) {
          const tanda = g.archivos.slice(i, i + 3);
          const ids = await Promise.all(tanda.map(async a => firstValueFrom(
            this.api.subirArchivo(this.mejorar ? await this.revelar(a.blob) : a.blob, a.nombre, g.destinoId!, familias ? 'STORE_CATEGORIA' : 'STORE_PRODUCTO'))));
          docs.push(...ids);
          this.progreso.update(p => ({ ...p, hechas: p.hechas + tanda.length }));
        }
        if (familias) {
          await firstValueFrom(this.api.editarCategoria(g.destinoId!, { imagen_doc_id: docs[0] }));
          this.actualizar(g, 'ok', 'Foto puesta');
        } else {
          const r = await firstValueFrom(this.api.fijarFotosProducto(g.destinoId!, docs, this.reemplazar));
          this.actualizar(g, 'ok', `${r.agregadas} foto${r.agregadas === 1 ? '' : 's'} · queda con ${r.total}`);
        }
      } catch (e) {
        this.actualizar(g, 'error', this.mensaje(e));
      }
    }
    this.ocupado.set(false);
    const f = this.fallidos();
    let ia = '';
    if (this.conIa && !familias) {
      const ids = cola.filter(g => g.estado === 'ok' && g.destinoId).map(g => g.destinoId!);
      try {
        const r = await firstValueFrom(this.api.loteFotosIa(this.ctx.tiendaId(), ids));
        ia = ` ${r.trabajos} producto(s) en cola para la IA${r.ia_configurada ? ' (revíselos en el detalle del producto)' : ' (se generan cuando se configure la llave de IA)'}.`;
      } catch { ia = ' No se pudo pedir la mejora con IA.'; }
    }
    this.aviso.set((f ? `Listo con ${f} producto(s) con error: puede reintentarlos.` : `Listo: ${this.terminados()} ${familias ? 'familias' : 'productos'} con fotos nuevas.`) + ia);
  }

  private async revelar(b: Blob): Promise<Blob> {
    try { return await mejorarFoto(b, { luzYColor: true, nitidez: true, limpiarFondo: false, cuadroBlanco: false }); } catch { return b; }
  }

  private actualizar(g: GrupoFotos, estado: Estado, detalle: string): void {
    g.estado = estado; g.detalle = detalle;
    this.grupos.update(l => [...l]);
  }

  // ════════════════════════ CATÁLOGO ════════════════════════

  async descargarPlantillaCatalogo(): Promise<void> {
    const XLSX = await import('xlsx');
    const enc = COLUMNAS_CATALOGO.map(c => c[0]);
    const ejemplo = [
      ['P-0011', 'iPhone 17', 'Apple', 'Celulares > iPhone > Nuevos', 'BIEN', 'Nuevo', 'Importado', '12 meses garantía Apple',
       'iPhone 17 nuevo, importado.', 'Pantalla: 6,3" ProMotion 120 Hz | Procesador: A19', 'Apple, 5G', 'TU-AFILIACION', '', 19,
       'CEL-APL-IPHONE17-256-SIMF', '256GB SIM física 5G', '', '256GB', 'SIM física + eSIM', '5G', 3100000, 3699000, 4699000, 'SI'],
      ['P-0011', '', '', '', '', '', '', '', '', '', '', '', '', '', 'CEL-APL-IPHONE17-256-ESIM', '256GB eSIM 5G', '', '256GB',
       'Solo eSIM', '5G', 2900000, 3399000, 4699000, 'SI'],
    ];
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([enc, ...ejemplo]), 'Catalogo');
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([['Columna', 'Qué va'], ...COLUMNAS_CATALOGO]), 'Instrucciones');
    XLSX.writeFile(libro, 'plantilla_catalogo_tienda.xlsx');
  }

  async elegirCatalogo(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo) return;
    this.limpiar();
    this.ocupado.set(true);
    try {
      const filas = await this.leerHoja(archivo);
      const salida: FilaCatalogo[] = [];
      filas.forEach((r, i) => {
        const f: Record<string, unknown> = { fila: i + 2 };
        for (const [k] of COLUMNAS_CATALOGO) {
          const v = r[k];
          f[k] = NUMERICAS.has(k) ? this.numero(v) : (v == null || String(v).trim() === '' ? null : String(v).trim());
        }
        if (f['codigo_producto'] || f['sku_variante']) salida.push(f as unknown as FilaCatalogo);
      });
      if (!salida.length) { this.error.set('La hoja no trae filas con codigo_producto. Use la plantilla.'); return; }
      this.filasCatalogo.set(salida);
      this.resultado.set(await firstValueFrom(this.api.cargarCatalogo(salida, false)));
    } catch (e) {
      this.error.set(this.mensaje(e));
    } finally {
      this.ocupado.set(false);
    }
  }

  async aplicarCatalogo(): Promise<void> {
    const filas = this.filasCatalogo();
    if (!filas.length || this.resultado()?.errores) return;
    this.ocupado.set(true); this.error.set(null);
    try {
      const r = await firstValueFrom(this.api.cargarCatalogo(filas, true));
      this.resultado.set(r);
      this.aviso.set(`Catálogo aplicado: ${r.creados ?? 0} productos nuevos y ${r.actualizados ?? 0} actualizados.`);
    } catch (e) {
      this.error.set(this.mensaje(e));
    } finally {
      this.ocupado.set(false);
    }
  }

  // ════════════════════════ EXISTENCIAS ════════════════════════

  async descargarPlantillaStock(): Promise<void> {
    const XLSX = await import('xlsx');
    const tienda = this.ctx.tiendas()[0]?.codigo ?? 'CAJ01';
    const datos = [['tienda', 'codigo', 'cantidad', 'costo_unitario', 'tipo', 'motivo'],
      [tienda, 'CEL-APL-IPHONE17-256-SIMF', 3, 3100000, 'ENTRADA_COMPRA', 'Inventario inicial']];
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(datos), 'Existencias');
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([
      ['Columna', 'Qué va'], ['tienda', 'Código de la tienda o bodega (' + this.ctx.tiendas().map(t => t.codigo).join(', ') + ')'],
      ['codigo', 'SKU del producto, SKU de la opción o código del catálogo (P-0001 / TV-0011)'],
      ['cantidad', 'Unidades (siempre positivas)'], ['costo_unitario', 'Costo de cada unidad'],
      ['tipo', 'ENTRADA_COMPRA (llega mercancía), AJUSTE_POS (sobra), AJUSTE_NEG (falta), MERMA'],
      ['motivo', 'Por qué (queda en el kardex)']]), 'Instrucciones');
    XLSX.writeFile(libro, 'plantilla_existencias.xlsx');
  }

  async elegirStock(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo) return;
    this.limpiar();
    this.ocupado.set(true);
    try {
      const filas = (await this.leerHoja(archivo)).map((r, i): FilaStock => ({
        fila: i + 2, tienda: String(r['tienda'] ?? '').trim(), codigo: String(r['codigo'] ?? r['sku'] ?? '').trim(),
        cantidad: this.numero(r['cantidad']) ?? 0, costo: this.numero(r['costo_unitario'] ?? r['costo']),
        tipo: String(r['tipo'] ?? 'ENTRADA_COMPRA').trim().toUpperCase() || 'ENTRADA_COMPRA',
        motivo: String(r['motivo'] ?? '').trim() || 'Carga masiva de existencias', estado: 'pendiente', detalle: '',
      })).filter(f => f.codigo || f.tienda);
      const resueltos = await firstValueFrom(this.api.resolverCodigos([...new Set(filas.map(f => f.codigo))]));
      const porCodigo = new Map(resueltos.map(x => [x.codigo.toUpperCase(), x]));
      const tiendas = this.ctx.tiendas();
      for (const f of filas) {
        const t = tiendas.find(x => x.codigo?.toUpperCase() === f.tienda.toUpperCase() || x.nombre?.toUpperCase() === f.tienda.toUpperCase());
        const p = porCodigo.get(f.codigo.toUpperCase());
        f.tiendaId = t?.id; f.productoId = p?.producto_id ?? undefined; f.varianteId = p?.variante_id ?? null;
        f.producto = p?.nombre ?? undefined;
        f.problema = !t ? `Tienda "${f.tienda}" no existe o no está en su alcance`
          : !p?.producto_id ? (p?.ambiguo ? 'Código ambiguo' : 'Ningún producto tiene ese código')
          : !(f.cantidad > 0) ? 'Cantidad debe ser mayor que 0'
          : !['ENTRADA_COMPRA', 'AJUSTE_POS', 'AJUSTE_NEG', 'MERMA'].includes(f.tipo) ? 'Tipo no permitido' : undefined;
      }
      this.filasStock.set(filas);
    } catch (e) {
      this.error.set(this.mensaje(e));
    } finally {
      this.ocupado.set(false);
    }
  }

  async aplicarStock(): Promise<void> {
    const cola = this.stockListas().filter(f => f.estado !== 'ok');
    if (!cola.length) return;
    this.ocupado.set(true); this.error.set(null);
    this.progreso.set({ hechas: 0, total: cola.length });
    for (const f of cola) {
      try {
        await firstValueFrom(this.api.ajustar(f.tiendaId!, {
          producto_id: f.productoId!, variante_id: f.varianteId ?? undefined, tipo: f.tipo,
          cantidad: f.cantidad, costo_unitario: f.costo ?? undefined, motivo: f.motivo,
        }));
        f.estado = 'ok'; f.detalle = 'Registrado en el kardex';
      } catch (e) {
        f.estado = 'error'; f.detalle = this.mensaje(e);
      }
      this.progreso.update(p => ({ ...p, hechas: p.hechas + 1 }));
      this.filasStock.update(l => [...l]);
    }
    this.ocupado.set(false);
    const malas = this.filasStock().filter(f => f.estado === 'error').length;
    this.aviso.set(malas ? `${malas} filas con error; las demás quedaron en el kardex.` : 'Existencias cargadas en el kardex.');
  }

  // ════════════════════════ utilidades ════════════════════════

  /** Primera hoja como objetos con encabezados normalizados (sin tildes, minúsculas, "_"). */
  private async leerHoja(archivo: File): Promise<Array<Record<string, unknown>>> {
    const XLSX = await import('xlsx');
    const libro = XLSX.read(await archivo.arrayBuffer(), { type: 'array' });
    const hoja = libro.Sheets[libro.SheetNames[0]];
    const crudas = XLSX.utils.sheet_to_json<Record<string, unknown>>(hoja, { defval: null, raw: true });
    return crudas.map(r => {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) {
        o[k.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')] = v;
      }
      return o;
    });
  }

  /** "$ 1.234.900" → 1234900; números de Excel pasan tal cual. */
  private numero(v: unknown): number | null {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    const t = String(v).replace(/[^\d,.-]/g, '');
    if (!t) return null;
    const n = Number(/,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/[.,]/g, ''));
    return isFinite(n) ? n : null;
  }

  private mensaje(e: unknown): string {
    const c = (e as { error?: { error?: string; message?: string } })?.error;
    return c?.error ?? c?.message ?? (e as Error)?.message ?? 'No se pudo completar';
  }
}
