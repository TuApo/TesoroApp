import { ChangeDetectionStrategy, Component, LOCALE_ID, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule, formatCurrency, formatDate, getCurrencySymbol } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';

import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';
import { FotosProducto } from '../../components/fotos-producto/fotos-producto';
import { CodigosProducto } from '../../components/codigos-producto/codigos-producto';
import { ComponentesProducto } from '../../components/componentes-producto/componentes-producto';
import { EscanerCodigoComponent } from '../../../../../../shared/components/escaner-codigo/escaner-codigo.component';
import { imprimirEtiquetas } from '../../util/etiquetas';
import { SelectorTienda } from '../../components/selector-tienda/selector-tienda';
import { ContextoTiendaService } from '../../service/contexto-tienda.service';
import { Negocio, Producto, TiendaService } from '../../service/tienda.service';
import { EcoImagen } from '../../../../../economiapp/components/eco-imagen';

/** Una fila del árbol de familias, ya con su nivel y su ruta para pintarla. */
interface NodoCategoria {
  id: string; padre_id: string | null; codigo: string; nombre: string; descripcion: string | null;
  icono: string; imagen_doc_id: string | null; orden: number; nivel: number; ruta: string;
  filtros_json?: string | null;
}

/**
 * Catálogo: productos, precios y costos.
 *
 * <p>El costo se pide junto al precio y no como un campo aparte perdido en otra pantalla,
 * porque sin él no hay margen — y sin margen, la mitad del tablero son cifras inventadas.
 *
 * <p>Cambiar un precio no sobrescribe el anterior: cierra su vigencia y abre otra. Por eso
 * la ficha muestra el histórico.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-tienda-catalogo',
  imports: [CommonModule, FormsModule, MatIconModule, SelectorTienda, EcoImagen, FotosProducto, CodigosProducto, ComponentesProducto, EscanerCodigoComponent, ...TABLA_ESTANDAR],
  templateUrl: './catalogo.html',
  styleUrls: ['../../styles/tienda-comun.css', './catalogo.css'],
})
export class Catalogo implements OnInit {
  private api = inject(TiendaService);
  readonly ctx = inject(ContextoTiendaService);
  private readonly locale = inject(LOCALE_ID);

  readonly productos = signal<Producto[]>([]);
  readonly categorias = signal<Array<Record<string, unknown>>>([]);
  readonly negocios = signal<Negocio[]>([]);
  readonly historico = signal<Array<Record<string, unknown>>>([]);
  readonly seleccionado = signal<Producto | null>(null);

  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);
  readonly formulario = signal<'' | 'producto' | 'categoria' | 'precio' | 'tipo' | 'familias'>('');

  /**
   * Las categorías como árbol (Familia › Grupo › Subcategoría), en orden de vitrina. Los
   * selectores muestran la ruta completa: "Gama media" a secas no dice si es de celulares.
   */
  readonly arbol = computed<NodoCategoria[]>(() => {
    const todas = this.categorias().map(c => c as unknown as NodoCategoria);
    const hijos = new Map<string | null, NodoCategoria[]>();
    for (const c of todas) {
      const k = todas.some(x => x.id === c.padre_id) ? c.padre_id : null;
      hijos.set(k, [...(hijos.get(k) ?? []), c]);
    }
    const salida: NodoCategoria[] = [];
    const recorrer = (padre: string | null, nivel: number, ruta: string) => {
      const lista = [...(hijos.get(padre) ?? [])].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || a.nombre.localeCompare(b.nombre));
      for (const c of lista) {
        const r = ruta ? `${ruta} › ${c.nombre}` : c.nombre;
        salida.push({ ...c, nivel, ruta: r });
        recorrer(c.id, nivel + 1, r);
      }
    };
    recorrer(null, 0, '');
    return salida;
  });

  /** La familia que se está editando y su copia de trabajo. */
  readonly familiaSel = signal<NodoCategoria | null>(null);
  edicionFamilia = { nombre: '', descripcion: '', icono: '', orden: 0, padre_id: '' };
  /** Filtros de la familia: propios, o heredados de la familia padre. */
  readonly filtrosDisponibles = signal<Array<{ clave: string; nombre: string }>>([]);
  filtrosEdicion: string[] = [];
  heredarFiltros = true;
  readonly subiendoFoto = signal(false);

  /**
   * Productos en la tabla estándar. La búsqueda por nombre o SKU sigue yendo al servidor
   * (la lista trae solo los primeros 60), por eso la tabla no pinta su propio buscador.
   */
  /** Foto principal por producto, para reconocerlo en la tabla (se amplía al tocarla). */
  readonly fotos = signal<Record<string, string>>({});

  readonly columnasProductos: ColumnaTabla<Producto>[] = [
    { id: 'producto', header: 'Producto', valor: (p) => p.nombre, tarjeta: 'titulo',
      imagen: (p) => this.fotos()[p.id], minAncho: '220px' },
    { id: 'sku', header: 'SKU', valor: (p) => p.sku, tarjeta: 'subtitulo' },
    { id: 'marca', header: 'Marca', valor: (p) => p.marca ?? '', prioridad: 2, tarjeta: 'meta' },
    { id: 'alcance', header: 'Alcance', tarjeta: 'badge',
      valor: (p) => (p.negocio_id ? 'del negocio' : 'global'),
      badge: (p) => p.negocio_id ? { texto: 'del negocio', tono: 'neutro' } : { texto: 'global', tono: 'info' } },
  ];
  readonly idProducto = (p: Producto) => p.id;
  /** El producto elegido se marca en la tabla: es el que manda en la ficha de la derecha. */
  readonly claseProducto = (p: Producto) => (this.seleccionado()?.id === p.id ? 'te-fila--destacada' : '');

  /** Histórico de precios: fechas y pesos planos; el formato es solo lo visible. */
  readonly columnasHistorico: ColumnaTabla<Record<string, unknown>>[] = [
    { id: 'desde', header: 'Desde', tarjeta: 'titulo',
      valor: (h) => (h['vigente_desde'] ? new Date(h['vigente_desde'] as string) : null),
      formato: (h) => (h['vigente_desde'] ? formatDate(h['vigente_desde'] as string, 'shortDate', this.locale) : '') },
    { id: 'precio', header: 'Precio', align: 'right', tarjeta: 'subtitulo',
      valor: (h) => h['precio'] as number,
      formato: (h) => this.pesos(h['precio']), copiaTexto: (h) => String(h['precio'] ?? '') },
    { id: 'opcion', header: 'Opción', tarjeta: 'meta', prioridad: 2,
      valor: (h) => (h['variante_id'] ? 'opción' : 'base') },
    { id: 'referencia', header: 'En el comercio', align: 'right', tarjeta: 'meta', prioridad: 2,
      valor: (h) => h['precio_referencia'] as number,
      formato: (h) => this.pesos(h['precio_referencia']), copiaTexto: (h) => String(h['precio_referencia'] ?? '') },
    { id: 'costo', header: 'Costo', align: 'right', tarjeta: 'meta',
      valor: (h) => h['costo'] as number,
      formato: (h) => this.pesos(h['costo']), copiaTexto: (h) => String(h['costo'] ?? '') },
    { id: 'margen', header: 'Margen', align: 'right', tarjeta: 'meta',
      valor: (h) => h['margen'] as number,
      formato: (h) => this.pesos(h['margen']), copiaTexto: (h) => String(h['margen'] ?? '') },
    { id: 'alcance', header: 'Alcance', tarjeta: 'badge',
      valor: (h) => (h['tienda_id'] ? 'tienda' : 'negocio'),
      badge: (h) => h['tienda_id'] ? { texto: 'tienda', tono: 'neutro' } : { texto: 'negocio', tono: 'info' } },
  ];
  readonly idHistorico = (h: Record<string, unknown>) => h['id'];
  /** Las vigencias ya cerradas se atenúan: siguen ahí como histórico, no como precio actual. */
  readonly claseHistorico = (h: Record<string, unknown>) => (h['vigente_hasta'] ? 'te-fila--atenuada' : '');

  busqueda = '';
  nuevoProducto = {
    sku: '', nombre: '', descripcion: '', marca: '', unidad: 'und',
    codigo_barras: '', categoria_id: '', negocio_id: '', impuesto_pct: 0,
    tipo: 'BIEN', dias_vigencia_reclamo: 30, instrucciones_reclamo: '',
  };
  /** Edición del tipo del producto elegido (servicio/bono se reclaman con código en EconomiAPP). */
  tipoEdicion = { tipo: 'BIEN', dias_vigencia_reclamo: 30, instrucciones_reclamo: '' };
  nuevaCategoria = { codigo: '', nombre: '', negocio_id: '', padre_id: '', descripcion: '' };
  nuevoPrecio = { precio: 0, costo: 0, referencia: 0, soloEstaTienda: false };

  ngOnInit(): void {
    this.ctx.cargar();
    this.buscar();
    this.recargarCategorias();
    this.api.filtrosDisponibles().subscribe({
      next: m => this.filtrosDisponibles.set(Object.entries(m).map(([clave, nombre]) => ({ clave, nombre }))), error: () => {},
    });
    this.api.negocios().subscribe({ next: n => this.negocios.set(n), error: () => {} });
  }

  buscar(): void {
    this.cargando.set(true);
    this.api.productos({ texto: this.busqueda || undefined, tamano: 60 }).subscribe({
      next: p => {
        this.productos.set(p.content); this.cargando.set(false);
        this.api.imagenesPrincipales(p.content.map(x => x.id)).subscribe({ next: m => this.fotos.update(f => ({ ...f, ...m })), error: () => {} });
      },
      error: () => { this.error.set('No se pudo cargar el catálogo'); this.cargando.set(false); },
    });
  }

  seleccionar(p: Producto): void {
    this.seleccionado.set(p);
    this.tipoEdicion = {
      tipo: p.tipo ?? 'BIEN',
      dias_vigencia_reclamo: p.dias_vigencia_reclamo ?? 30,
      instrucciones_reclamo: p.instrucciones_reclamo ?? '',
    };
    this.formulario.set('');
    this.api.historicoPrecios(p.id).subscribe({
      next: h => this.historico.set(h), error: () => this.historico.set([]),
    });
  }

  guardarTipo(): void {
    const p = this.seleccionado();
    if (!p) return;
    this.api.cambiarTipoProducto(p.id, this.tipoEdicion).subscribe({
      next: actualizado => {
        this.seleccionado.set(actualizado);
        this.aviso.set(this.tipoEdicion.tipo === 'BIEN'
          ? `"${p.nombre}" se vende como bien (se entrega).`
          : `"${p.nombre}" ahora es ${this.tipoEdicion.tipo === 'BONO' ? 'un bono' : 'un servicio'}: en EconomiAPP se activa con un código y se redime en la tienda.`);
        this.buscar();
      },
      error: e => this.fallo(e),
    });
  }

  private recargarCategorias(): void {
    this.api.categorias().subscribe({ next: c => this.categorias.set(c), error: () => {} });
  }

  elegirFamilia(c: NodoCategoria): void {
    this.familiaSel.set(c);
    this.edicionFamilia = {
      nombre: c.nombre, descripcion: c.descripcion ?? '', icono: c.icono ?? 'category',
      orden: c.orden ?? 0, padre_id: c.padre_id ?? '',
    };
    const propios = this.leerFiltros(c.filtros_json);
    this.heredarFiltros = propios === null;
    this.filtrosEdicion = propios ?? this.filtrosHeredados(c);
    this.error.set(null);
  }

  private leerFiltros(json: string | null | undefined): string[] | null {
    if (!json) return null;
    try { const v = JSON.parse(json); return Array.isArray(v) ? v : null; } catch { return null; }
  }

  /** Lo que heredaría: los filtros del ancestro más cercano que tenga propios; si nadie, marca. */
  filtrosHeredados(c: NodoCategoria): string[] {
    let padre = this.arbol().find(x => x.id === c.padre_id);
    while (padre) {
      const f = this.leerFiltros(padre.filtros_json);
      if (f) return f;
      padre = this.arbol().find(x => x.id === padre!.padre_id);
    }
    return ['marca'];
  }

  alternarFiltro(clave: string): void {
    this.filtrosEdicion = this.filtrosEdicion.includes(clave)
      ? this.filtrosEdicion.filter(k => k !== clave) : [...this.filtrosEdicion, clave];
  }

  /** No se ofrece como padre la misma familia ni nada que cuelgue de ella. */
  padresPosibles(c: NodoCategoria | null): NodoCategoria[] {
    if (!c) return this.arbol();
    return this.arbol().filter(x => x.id !== c.id && !x.ruta.startsWith(c.ruta + ' › '));
  }

  guardarFamilia(): void {
    const c = this.familiaSel();
    if (!c) return;
    const e = this.edicionFamilia;
    this.api.editarCategoria(c.id, {
      nombre: e.nombre, descripcion: e.descripcion, icono: e.icono || undefined,
      orden: Number(e.orden) || 0, padre_id: e.padre_id && e.padre_id !== c.padre_id ? e.padre_id : undefined,
      // [] = heredar; con lista propia, se guarda en el orden de pantalla.
      filtros: this.heredarFiltros ? [] : this.filtrosDisponibles().map(f => f.clave).filter(k => this.filtrosEdicion.includes(k)),
    }).subscribe({
      next: r => { this.aviso.set(`"${e.nombre}" quedó actualizada.`); this.alGuardarFamilia(r); },
      error: err => this.fallo(err),
    });
  }

  /** La foto se sube a gestión documental y la familia guarda solo su id. */
  subirFotoFamilia(ev: Event): void {
    const c = this.familiaSel();
    const archivo = (ev.target as HTMLInputElement).files?.[0];
    (ev.target as HTMLInputElement).value = '';
    if (!c || !archivo) return;
    if (!/^image\//.test(archivo.type)) { this.error.set('La foto debe ser una imagen (JPG, PNG o WebP).'); return; }
    if (archivo.size > 5 * 1024 * 1024) { this.error.set('La foto no puede pasar de 5 MB.'); return; }
    this.subiendoFoto.set(true);
    this.api.subirArchivo(archivo, archivo.name, c.id, 'STORE_CATEGORIA').subscribe({
      next: doc => this.api.editarCategoria(c.id, { imagen_doc_id: doc }).subscribe({
        next: r => { this.subiendoFoto.set(false); this.aviso.set(`Foto de "${c.nombre}" actualizada.`); this.alGuardarFamilia(r); },
        error: err => { this.subiendoFoto.set(false); this.fallo(err); },
      }),
      error: err => { this.subiendoFoto.set(false); this.fallo(err); },
    });
  }

  quitarFotoFamilia(): void {
    const c = this.familiaSel();
    if (!c) return;
    this.api.editarCategoria(c.id, { quitar_imagen: true }).subscribe({
      next: r => { this.aviso.set(`Se quitó la foto de "${c.nombre}".`); this.alGuardarFamilia(r); },
      error: err => this.fallo(err),
    });
  }

  private alGuardarFamilia(r: Record<string, unknown>): void {
    this.categorias.update(lista => lista.map(x => x['id'] === r['id'] ? r : x));
    const nodo = this.arbol().find(x => x.id === r['id']) ?? null;
    this.familiaSel.set(nodo);
  }

  abrir(f: '' | 'producto' | 'categoria' | 'precio' | 'tipo' | 'familias'): void {
    this.formulario.set(this.formulario() === f ? '' : f);
    this.error.set(null);
    this.aviso.set(null);
  }

  crearProducto(): void {
    this.api.crearProducto({
      ...this.nuevoProducto,
      negocio_id: this.nuevoProducto.negocio_id || undefined,
      categoria_id: this.nuevoProducto.categoria_id || undefined,
      codigo_barras: this.nuevoProducto.codigo_barras || undefined,
    }).subscribe({
      next: () => {
        this.aviso.set(`Producto "${this.nuevoProducto.nombre}" creado. `
          + 'Ahora fíjele precio y costo, o no se podrá vender.');
        this.nuevoProducto = {
          sku: '', nombre: '', descripcion: '', marca: '', unidad: 'und',
          codigo_barras: '', categoria_id: '', negocio_id: '', impuesto_pct: 0,
          tipo: 'BIEN', dias_vigencia_reclamo: 30, instrucciones_reclamo: '',
        };
        this.formulario.set('');
        this.buscar();
      },
      error: e => this.fallo(e),
    });
  }

  crearCategoria(): void {
    this.api.crearCategoria({
      ...this.nuevaCategoria,
      negocio_id: this.nuevaCategoria.negocio_id || undefined,
      padre_id: this.nuevaCategoria.padre_id || undefined,
      descripcion: this.nuevaCategoria.descripcion || undefined,
    }).subscribe({
      next: () => {
        this.aviso.set('Categoría creada. Póngale foto y descripción en "Familias".');
        this.nuevaCategoria = { codigo: '', nombre: '', negocio_id: '', padre_id: '', descripcion: '' };
        this.formulario.set('');
        this.recargarCategorias();
      },
      error: e => this.fallo(e),
    });
  }

  fijarPrecio(): void {
    const p = this.seleccionado();
    if (!p) return;
    this.api.fijarPrecio(p.id, {
      precio: this.nuevoPrecio.precio,
      costo: this.nuevoPrecio.costo,
      precio_referencia: this.nuevoPrecio.referencia > 0 ? this.nuevoPrecio.referencia : undefined,
      tienda_id: this.nuevoPrecio.soloEstaTienda ? (this.ctx.tiendaId() ?? undefined) : undefined,
    }).subscribe({
      next: () => {
        this.aviso.set('Precio fijado. El anterior queda en el histórico, no se borra.');
        this.nuevoPrecio = { precio: 0, costo: 0, referencia: 0, soloEstaTienda: false };
        this.formulario.set('');
        this.seleccionar(p);
      },
      error: e => this.fallo(e),
    });
  }

  /** Lo mismo que el pipe `currency:'COP':'symbol-narrow':'1.0-0'` de la plantilla. */
  private pesos(valor: unknown): string {
    if (valor === null || valor === undefined || valor === '') return '';
    const n = Number(valor);
    if (isNaN(n)) return '';
    return formatCurrency(n, this.locale, getCurrencySymbol('COP', 'narrow', this.locale), 'COP', '1.0-0');
  }

  private fallo(e: unknown): void {
    const cuerpo = (e as { error?: { error?: string } })?.error;
    this.error.set(cuerpo?.error ?? 'No se pudo completar la operación');
    this.aviso.set(null);
  }

  /** Precio vigente del producto elegido (para la etiqueta). */
  precioActual(): number | null {
    const h = this.historico().find(x => !x['vigente_hasta'] && !x['tienda_id']) ?? this.historico()[0];
    return h ? Number(h['precio']) : null;
  }

  /** Etiquetas de góndola de los productos listados que tienen código de barras. */
  async imprimirEtiquetasLista(): Promise<void> {
    const ps = this.productos().filter(p => p.codigo_barras);
    if (!ps.length) { this.error.set('Ninguno de la lista tiene código de barras: genérelos primero.'); return; }
    const etiquetas = [];
    for (const p of ps.slice(0, 300)) {
      let precio: number | null = null;
      try {
        const h = await firstValueFrom(this.api.historicoPrecios(p.id));
        const v = h.find(x => !x['vigente_hasta'] && !x['tienda_id']);
        precio = v ? Number(v['precio']) : null;
      } catch { /* sin precio */ }
      etiquetas.push({ nombre: p.nombre, precio, codigo: p.codigo_barras!, sku: p.sku });
    }
    imprimirEtiquetas(etiquetas, 'Etiquetas de góndola');
  }

  generarCodigosLista(): void {
    const ids = this.productos().filter(p => !p.codigo_barras).map(p => p.id);
    if (!ids.length) { this.aviso.set('Todos los productos de la lista ya tienen código de barras.'); return; }
    if (!confirm(`¿Generar código de barras interno a ${ids.length} productos?`)) return;
    this.api.generarCodigosFaltantes(ids).subscribe({
      next: r => { this.aviso.set(`${r.generados} códigos generados. Ya puede imprimir sus etiquetas.`); this.buscar(); },
      error: e => this.error.set(e?.error?.error ?? 'No se pudieron generar'),
    });
  }
}
