import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { environment } from '@/environments/environment';
import { obtenerUsuarioActual } from '../../../../../../core/utils/usuario-actual';
import { EcoImagen } from '../../../../../economiapp/components/eco-imagen';
import { ContextoTiendaService } from '../../service/contexto-tienda.service';
import {
  ArticuloComprador, CategoriaComprador, KitComprador, PromocionComprador, PublicacionGestion,
  TiendaService, ZONAS_PUBLICIDAD, ZonaPublicidad,
} from '../../service/tienda.service';

type Enlace = 'NINGUNO' | 'PRODUCTO' | 'COMBO' | 'CATEGORIA' | 'PROMOCION' | 'BUSQUEDA' | 'URL';

/** Lo que se sabe del archivo elegido, medido en el navegador antes de subirlo. */
interface Archivo { file: File; url: string; video: boolean; ancho: number; alto: number; segundos: number | null; }

const MAX_IMAGEN = 3 * 1024 * 1024;
const MAX_VIDEO = 15 * 1024 * 1024;
const MAX_SEGUNDOS = 30;

/**
 * Publicidad de EconomiAPP: banners del carrusel principal y tarjetas destacadas, con foto
 * o video, y a dónde lleva cada una (producto, combo, promoción, categoría, búsqueda o un
 * enlace externo).
 *
 * <p>Las medidas son EXACTAS para las fotos (1600×800 el carrusel, 800×800 la tarjeta):
 * la vitrina recorta a esa proporción en todos los tamaños de pantalla, así que una pieza
 * con otra medida sale cortada en el celular. Al video se le exige la misma proporción y
 * un ancho mínimo, porque los videos rara vez se exportan al píxel. Se mide aquí, antes de
 * subir nada, para que quien diseña se entere en su escritorio y no en la vitrina.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-tienda-publicidad',
  imports: [FormsModule, MatIconModule, DatePipe, DecimalPipe, EcoImagen],
  templateUrl: './publicidad.html',
  styleUrls: ['../../styles/tienda-comun.css', './publicidad.css'],
})
export class Publicidad implements OnInit, OnDestroy {
  readonly ctx = inject(ContextoTiendaService);
  private api = inject(TiendaService);
  private http = inject(HttpClient);

  readonly ZONAS = ZONAS_PUBLICIDAD;
  readonly zonas = Object.keys(ZONAS_PUBLICIDAD) as ZonaPublicidad[];

  /** '' = publicidad GLOBAL (todas las tiendas). */
  readonly alcance = signal<string>('');
  readonly lista = signal<PublicacionGestion[]>([]);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  // Formulario
  readonly zona = signal<ZonaPublicidad>('HOME_BANNER');
  readonly archivo = signal<Archivo | null>(null);
  readonly problemaArchivo = signal<string | null>(null);
  readonly titulo = signal('');
  readonly subtitulo = signal('');
  readonly enlace = signal<Enlace>('NINGUNO');
  readonly enlaceValor = signal('');
  readonly desde = signal('');
  readonly hasta = signal('');
  readonly orden = signal(0);
  readonly publicando = signal(false);

  // Para elegir a dónde lleva
  readonly categorias = signal<CategoriaComprador[]>([]);
  readonly promociones = signal<PromocionComprador[]>([]);
  readonly combos = signal<KitComprador[]>([]);
  readonly busquedaProducto = signal('');
  readonly productos = signal<ArticuloComprador[]>([]);
  readonly productoElegido = signal<ArticuloComprador | null>(null);

  readonly medida = computed(() => ZONAS_PUBLICIDAD[this.zona()]);
  /** Con qué tienda se buscan productos, categorías y promociones para el enlace. */
  readonly tiendaConsulta = computed(() => this.alcance() || this.ctx.tiendaId() || this.ctx.tiendas()[0]?.id || null);

  readonly listo = computed(() =>
    !!this.archivo() && !this.problemaArchivo() && !this.publicando()
    && (this.enlace() === 'NINGUNO' || !!this.enlaceValor().trim())
    && (this.enlace() !== 'URL' || this.enlaceValor().trim().startsWith('https://')));

  constructor() {
    effect(() => {
      const t = this.tiendaConsulta();
      untracked(() => { if (t) this.cargarOpciones(t); });
    });
    // Quien no administra la organización no puede tocar la publicidad global: arranca en su tienda.
    effect(() => {
      const cargado = !!this.ctx.alcance();
      const admin = this.ctx.esSuperAdmin();
      const tiendas = this.ctx.tiendas();
      untracked(() => {
        if (cargado && !admin && !this.alcance() && tiendas.length) {
          this.alcance.set(this.ctx.tiendaId() || tiendas[0].id);
        }
      });
    });
    effect(() => {
      this.alcance();
      const cargado = !!this.ctx.alcance();
      untracked(() => { if (cargado) this.cargarLista(); });
    });
    // Si cambia la zona con un archivo ya elegido, se vuelve a medir contra la medida nueva.
    effect(() => {
      this.zona();
      untracked(() => { const a = this.archivo(); if (a) this.problemaArchivo.set(this.validar(a)); });
    });
  }

  ngOnInit(): void {
    this.ctx.cargar();
  }

  ngOnDestroy(): void {
    const a = this.archivo();
    if (a) URL.revokeObjectURL(a.url);
  }

  cargarLista(): void {
    if (!this.alcance() && !this.ctx.esSuperAdmin()) return;
    this.cargando.set(true);
    this.api.publicaciones(this.alcance() || null).subscribe({
      next: l => { this.lista.set(l ?? []); this.cargando.set(false); },
      error: () => { this.lista.set([]); this.cargando.set(false); },
    });
  }

  private cargarOpciones(t: string): void {
    this.api.categoriasComprador(t).subscribe({ next: c => this.categorias.set(c ?? []), error: () => null });
    this.api.promocionesComprador(t).subscribe({ next: p => this.promociones.set(p ?? []), error: () => null });
    this.api.combosComprador(t).subscribe({ next: k => this.combos.set(k ?? []), error: () => null });
  }

  buscarProducto(): void {
    const t = this.tiendaConsulta();
    const q = this.busquedaProducto().trim();
    if (!t || q.length < 2) return;
    this.api.catalogoComprador(t, { texto: q, tamano: 12 }).subscribe({
      next: r => this.productos.set(r.articulos ?? []),
      error: () => this.productos.set([]),
    });
  }

  elegirProducto(p: ArticuloComprador): void {
    this.productoElegido.set(p);
    this.enlaceValor.set(p.id);
    this.productos.set([]);
  }

  cambiarEnlace(e: Enlace): void {
    this.enlace.set(e);
    this.enlaceValor.set('');
    this.productoElegido.set(null);
  }

  // ── Archivo ─────────────────────────────────────────────────────────────

  async elegirArchivo(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const previo = this.archivo();
    if (previo) URL.revokeObjectURL(previo.url);
    this.archivo.set(null);
    this.problemaArchivo.set(null);

    const video = file.type.startsWith('video/');
    if (!video && !file.type.startsWith('image/')) {
      this.problemaArchivo.set('Solo fotos (JPG, PNG, WebP) o video (MP4, WebM).');
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const m = video ? await medirVideo(url) : await medirImagen(url);
      const a: Archivo = { file, url, video, ...m };
      this.archivo.set(a);
      this.problemaArchivo.set(this.validar(a));
    } catch {
      URL.revokeObjectURL(url);
      this.problemaArchivo.set('No se pudo leer el archivo. ¿Está dañado?');
    }
  }

  /** Por qué no sirve el archivo para la zona elegida, o null si sirve. */
  private validar(a: Archivo): string | null {
    const { ancho, alto } = this.medida();
    if (a.video) {
      if (a.file.size > MAX_VIDEO) return `El video pesa ${mb(a.file.size)}; el máximo es ${mb(MAX_VIDEO)}.`;
      if (a.segundos != null && a.segundos > MAX_SEGUNDOS) return `El video dura ${Math.round(a.segundos)} s; el máximo es ${MAX_SEGUNDOS} s.`;
      const prop = a.ancho / a.alto;
      if (Math.abs(prop - ancho / alto) > 0.02 * (ancho / alto)) {
        return `El video mide ${a.ancho}×${a.alto}: la proporción debe ser la de ${ancho}×${alto}.`;
      }
      if (a.ancho < ancho * 0.75) return `El video mide ${a.ancho}×${a.alto}: necesita al menos ${Math.round(ancho * 0.75)} px de ancho.`;
      return null;
    }
    if (a.file.size > MAX_IMAGEN) return `La foto pesa ${mb(a.file.size)}; el máximo es ${mb(MAX_IMAGEN)}.`;
    if (a.ancho !== ancho || a.alto !== alto) {
      return `La foto mide ${a.ancho}×${a.alto} px y esta zona exige exactamente ${ancho}×${alto} px.`;
    }
    return null;
  }

  quitarArchivo(): void {
    const a = this.archivo();
    if (a) URL.revokeObjectURL(a.url);
    this.archivo.set(null);
    this.problemaArchivo.set(null);
  }

  // ── Publicar / retirar ──────────────────────────────────────────────────

  async publicar(): Promise<void> {
    const a = this.archivo();
    if (!a || !this.listo()) return;
    this.publicando.set(true);
    this.error.set(null);
    this.aviso.set(null);
    try {
      const fd = new FormData();
      fd.append('ownerId', obtenerUsuarioActual().id || 'economiapp');
      fd.append('typeCode', 'FORMULARIO_ADJUNTO');
      fd.append('ownerType', 'STORE_PUBLICIDAD');
      fd.append('sourceService', 'economiapp');
      fd.append('legacyField', `publicidad:${this.zona()}`);
      fd.append('file', a.file, a.file.name);
      const r = await firstValueFrom(this.http.post<{ document_id?: number | string }>(
        `${environment.apiUrl}/api/v1/documents/upload-by-owner`, fd));
      if (r?.document_id == null) throw new Error('El servidor de documentos no confirmó la subida');

      await firstValueFrom(this.api.crearPublicacion({
        tienda_id: this.alcance() || null,
        zona: this.zona(),
        titulo: this.titulo().trim() || null,
        subtitulo: this.subtitulo().trim() || null,
        imagen_doc_id: String(r.document_id),
        enlace_tipo: this.enlace(),
        enlace_valor: this.enlace() === 'NINGUNO' ? null : this.enlaceValor().trim(),
        orden: Number(this.orden()) || 0,
        vigente_desde: this.desde() ? new Date(`${this.desde()}T00:00:00`).toISOString() : null,
        vigente_hasta: this.hasta() ? new Date(`${this.hasta()}T23:59:59`).toISOString() : null,
      }));
      this.aviso.set('Publicado. Ya se ve en EconomiAPP.');
      this.quitarArchivo();
      this.titulo.set(''); this.subtitulo.set(''); this.cambiarEnlace('NINGUNO');
      this.desde.set(''); this.hasta.set(''); this.orden.set(0);
      this.cargarLista();
    } catch (e) {
      const err = e as { error?: { error?: string; message?: string }; message?: string };
      this.error.set(err?.error?.error || err?.error?.message || err?.message || 'No se pudo publicar');
    } finally {
      this.publicando.set(false);
    }
  }

  retirar(p: PublicacionGestion): void {
    if (!confirm(`¿Retirar "${p.titulo || 'esta publicidad'}" de la vitrina?`)) return;
    this.api.retirarPublicacion(p.id).subscribe({
      next: () => { this.aviso.set('Retirada de la vitrina.'); this.cargarLista(); },
      error: () => this.error.set('No se pudo retirar'),
    });
  }

  destinoTexto(p: PublicacionGestion): string {
    const v = p.enlace_valor || '';
    switch (p.enlace_tipo) {
      case 'PRODUCTO': return 'Producto';
      case 'COMBO': return 'Combo: ' + (this.combos().find(c => c.id === v)?.nombre ?? '');
      case 'PROMOCION': return 'Promoción: ' + (this.promociones().find(x => x.id === v)?.nombre ?? '');
      case 'CATEGORIA': return 'Categoría: ' + (this.categorias().find(c => c.id === v)?.nombre ?? '');
      case 'BUSQUEDA': return `Búsqueda “${v}”`;
      case 'URL': return v;
      default: return 'Sin enlace';
    }
  }

  nombreZona(z: string): string {
    return (ZONAS_PUBLICIDAD as Record<string, { nombre: string }>)[z]?.nombre ?? z;
  }

  readonly mb = mb;
}

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
}

function medirImagen(url: string): Promise<{ ancho: number; alto: number; segundos: null }> {
  return new Promise((ok, mal) => {
    const img = new Image();
    img.onload = () => ok({ ancho: img.naturalWidth, alto: img.naturalHeight, segundos: null });
    img.onerror = mal;
    img.src = url;
  });
}

function medirVideo(url: string): Promise<{ ancho: number; alto: number; segundos: number }> {
  return new Promise((ok, mal) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => ok({ ancho: v.videoWidth, alto: v.videoHeight, segundos: v.duration });
    v.onerror = mal;
    v.src = url;
  });
}
