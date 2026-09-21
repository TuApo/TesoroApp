import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatIconModule } from '@angular/material/icon';

import { Bloque, Croquis, Media, Turno, TurnosService, Vista } from '../../service/turnos.service';
import { CroquisSvg } from '../croquis-svg/croquis-svg';
import { idYoutube } from '../../pages/publicidad/publicidad';

/** Lo que una vista necesita del mundo para pintarse: cola, piezas, croquis y hora. */
export interface DatosVista {
  oficina_nombre: string;
  ahora: Date;
  llamado: Turno | null;
  en_curso: Turno[];
  en_espera: Turno[];
  /** Piezas de la pantalla (las de sus listas o todo lo vigente). */
  piezas: Media[];
  /** Piezas de las listas que piden los bloques de publicidad atados a una lista. */
  playlists: Record<string, Media[]>;
  croquis: Croquis | null;
  url_turno: string | null;
}

export interface EmisionPieza { media_id: string; segundos: number; }

/** Bloque nuevo con posición y propiedades razonables para su tipo. */
export function bloqueNuevo(tipo: Bloque['tipo'], vertical = false): Bloque {
  const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : `b${Date.now()}${Math.random().toString(16).slice(2, 6)}`;
  const base: Bloque = { id, tipo, x: 4, y: 4, w: 40, h: 30, z: 1, estilo: {}, props: {} };
  switch (tipo) {
    case 'TURNO_LLAMADO': return { ...base, w: 40, h: 44, estilo: { fondo: '#2B59F0', color: '#FFFFFF', radio: 2.4, relleno: 2 }, props: { etiqueta: 'Turno', vacio: 'Tome su turno y espere a ser llamado', mostrar_nombre: true, mostrar_area: true } };
    case 'LISTA_ATENCION': return { ...base, y: 52, w: 19, h: 44, estilo: { fondo: '#121A33', color: '#F8FAFC', radio: 2, relleno: 1.4 }, props: { titulo: 'En atención', max: 6 } };
    case 'LISTA_ESPERA': return { ...base, x: 25, y: 52, w: 19, h: 44, estilo: { fondo: '#121A33', color: '#F8FAFC', radio: 2, relleno: 1.4 }, props: { titulo: 'Siguientes', max: 6, mostrar_servicio: true } };
    case 'PUBLICIDAD': return { ...base, x: 46, y: 4, w: 50, h: 92, estilo: { fondo: '#000000', radio: 2 }, props: { playlist_id: null, ajuste: 'CONTENER' } };
    case 'RELOJ': return { ...base, x: 78, y: 2, w: 20, h: 10, estilo: { color: '#F8FAFC', tamano: 4.2, alinear: 'derecha' }, props: { mostrar_fecha: true, formato: '24h' } };
    case 'TEXTO': return { ...base, x: 4, y: 90, w: 92, h: 8, estilo: { fondo: '#9BD441', color: '#0B1020', tamano: 3.2, alinear: 'centro', radio: 1.2, negrita: true }, props: { texto: 'Bienvenidos. Por favor tome su turno en recepción.', marquesina: false, velocidad: 20 } };
    case 'IMAGEN': return { ...base, w: 30, h: 30, estilo: { radio: 1.5 }, props: { url: '', ajuste: 'CONTENER' } };
    case 'LOGO': return { ...base, w: 16, h: 9, estilo: {}, props: { url: 'logos/logo_alianza.svg', ajuste: 'CONTENER' } };
    case 'CROQUIS': return { ...base, y: 64, w: 40, h: 32, estilo: { fondo: '#121A33', radio: 2, relleno: 1 }, props: {} };
    case 'QR': return { ...base, x: 80, y: 66, w: 16, h: 30, estilo: { fondo: '#FFFFFF', color: '#0B1020', radio: 1.5, relleno: 1 }, props: { url: '', etiqueta: 'Escanee para tomar su turno' } };
    case 'OFICINA': return { ...base, x: 4, y: 2, w: 50, h: 8, estilo: { color: '#94A3B8', tamano: 2.6, negrita: true }, props: { texto: '' } };
  }
  return vertical ? { ...base, w: 60 } : base;
}

export const NOMBRE_BLOQUE: Record<Bloque['tipo'], string> = {
  TURNO_LLAMADO: 'Turno llamado', LISTA_ATENCION: 'En atención', LISTA_ESPERA: 'Siguientes', PUBLICIDAD: 'Publicidad',
  RELOJ: 'Reloj y fecha', TEXTO: 'Texto / aviso', IMAGEN: 'Imagen', LOGO: 'Logo', CROQUIS: 'Mini-mapa', QR: 'Código QR', OFICINA: 'Nombre de la oficina',
};
export const ICONO_BLOQUE: Record<Bloque['tipo'], string> = {
  TURNO_LLAMADO: 'campaign', LISTA_ATENCION: 'support_agent', LISTA_ESPERA: 'groups', PUBLICIDAD: 'slideshow',
  RELOJ: 'schedule', TEXTO: 'title', IMAGEN: 'image', LOGO: 'workspace_premium', CROQUIS: 'map', QR: 'qr_code_2', OFICINA: 'store',
};

/**
 * Pinta UNA vista: sus bloques en la posición y el tamaño que dice el diseño,
 * con los datos vivos que le pasen (cola, piezas, hora). Es el mismo componente
 * en el televisor, en el editor y en las miniaturas: lo que se diseña es lo
 * que se ve.
 *
 * <p>Los tamaños del diseño van en % de la ALTURA del lienzo (`--u` = 1 % en
 * px, medido con ResizeObserver), así que una vista se ve igual en un
 * televisor de 55" y en una miniatura de 240 px.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-vista-render',
  imports: [CommonModule, MatIconModule, CroquisSvg],
  templateUrl: './vista-render.html',
  styleUrl: './vista-render.css',
})
export class VistaRender implements OnInit {
  readonly vista = input.required<Vista>();
  readonly datos = input.required<DatosVista>();
  /** Reportar emisiones de piezas (solo el televisor real). */
  readonly reportar = input(false);
  /** Rotar la publicidad y correr marquesinas (las miniaturas lo apagan). */
  readonly animar = input(true);
  /** Reproducir el sonido de las piezas de audio (el editor y las miniaturas lo apagan). */
  readonly sonido = input(true);
  readonly emision = output<EmisionPieza>();

  private api = inject(TurnosService);
  private sanitizer = inject(DomSanitizer);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private destroyRef = inject(DestroyRef);

  /** Índice de pieza por bloque de publicidad; cambia con el reloj interno. */
  readonly indices = signal<Record<string, number>>({});
  private estado = new Map<string, { inicio: number; espera: number }>();
  private embebidas = new Map<string, SafeResourceUrl>();

  readonly bloques = computed(() => [...(this.vista().bloques ?? [])].sort((a, b) => (a.z ?? 0) - (b.z ?? 0)));
  readonly fondo = computed(() => {
    const f = this.vista().fondo;
    if (!f) return { background: '#0B1020' };
    if (f.tipo === 'DEGRADADO') return { background: `linear-gradient(${f.angulo ?? 135}deg, ${f.color ?? '#0B1020'}, ${f.color2 ?? '#1E293B'})` };
    if (f.tipo === 'IMAGEN' && f.url) return { background: `${f.color ?? '#000'} url("${f.url}") center / ${f.ajuste === 'CONTENER' ? 'contain' : 'cover'} no-repeat` };
    return { background: f.color ?? '#0B1020' };
  });
  readonly turnoGrande = computed<Turno | null>(() => this.datos().llamado ?? this.datos().en_curso[0] ?? null);
  readonly areaResaltada = computed(() => this.turnoGrande()?.area_id ?? null);

  ngOnInit(): void {
    const el = this.host.nativeElement;
    const medir = () => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--u', `${r.height / 100}px`);
      el.style.setProperty('--uw', `${r.width / 100}px`);
    };
    medir();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(medir);
      ro.observe(el);
      this.destroyRef.onDestroy(() => ro.disconnect());
    }
    const reloj = setInterval(() => this.tick(), 1000);
    this.destroyRef.onDestroy(() => clearInterval(reloj));
  }

  // ── Publicidad: una rotación por bloque ────────────────────────────────

  /** Las piezas que rotan en el bloque: sin camas musicales ni perifoneos (esos suenan aparte). */
  piezasDe(b: Bloque): Media[] {
    const pid = b.props?.['playlist_id'] as string | null | undefined;
    const l = pid ? (this.datos().playlists?.[pid] ?? []) : (this.datos().piezas ?? []);
    return l.filter(p => !p.es_cama && !p.intervalo_min);
  }

  /** URL absoluta de la cama musical de una pieza de audio. */
  urlCama(p: Media): string | null {
    return p.cama_media_id ? this.api.urlMedia({ url: `/api/v1/public/turnos/media/${p.cama_media_id}/archivo` }) : null;
  }

  volumenCama(p: Media): number { return Math.max(0, Math.min(1, (p.cama_volumen ?? 25) / 100)); }

  pieza(b: Bloque): Media | null {
    const l = this.piezasDe(b);
    if (!l.length) return null;
    return l[(this.indices()[b.id] ?? 0) % l.length];
  }

  private tick(): void {
    if (!this.animar()) return;
    const ahora = Date.now();
    let cambio = false;
    const idx = { ...this.indices() };
    for (const b of this.bloques()) {
      if (b.tipo !== 'PUBLICIDAD') continue;
      const l = this.piezasDe(b);
      if (l.length === 0) continue;
      const i = (idx[b.id] ?? 0) % l.length;
      const p = l[i];
      let st = this.estado.get(b.id);
      if (!st) { st = { inicio: ahora, espera: this.duracion(p) }; this.estado.set(b.id, st); }
      if (ahora - st.inicio < st.espera) continue;
      this.terminarPieza(b, p, st.inicio);
      idx[b.id] = l.length > 1 ? (i + 1) % l.length : 0;
      this.estado.set(b.id, { inicio: ahora, espera: this.duracion(l[idx[b.id]]) });
      cambio = true;
    }
    if (cambio) this.indices.set(idx);
  }

  /** Un video propio avisa al terminar; lo demás va por duración. */
  private duracion(p: Media): number {
    if (p.tipo === 'VIDEO' && this.api.urlMedia(p)) return (Math.max(5, p.duracion_seg) + 15) * 1000;
    if (p.tipo === 'AUDIO' && this.sonido() && this.api.urlMedia(p)) return (Math.max(3, p.duracion_seg) + 10) * 1000;
    return Math.max(3, p.duracion_seg) * 1000;
  }

  videoTermino(b: Bloque): void {
    const p = this.pieza(b);
    const st = this.estado.get(b.id);
    if (p) this.terminarPieza(b, p, st?.inicio ?? Date.now());
    const l = this.piezasDe(b);
    if (!l.length) return;
    const i = ((this.indices()[b.id] ?? 0) + 1) % l.length;
    this.estado.set(b.id, { inicio: Date.now(), espera: this.duracion(l[i]) });
    this.indices.update(x => ({ ...x, [b.id]: i }));
  }

  private terminarPieza(_b: Bloque, p: Media, inicio: number): void {
    if (!this.reportar()) return;
    this.emision.emit({ media_id: p.id, segundos: Math.round((Date.now() - inicio) / 1000) });
  }

  urlPieza(p: Media): string | null { return this.api.urlMedia(p); }

  urlEmbebida(p: Media): SafeResourceUrl | null {
    const clave = `${p.id}|${p.silenciado ? 1 : 0}`;
    const previa = this.embebidas.get(clave);
    if (previa) return previa;
    let url: string | null = null;
    if (p.tipo === 'YOUTUBE') {
      const id = idYoutube(p.url);
      url = id ? `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=${p.silenciado ? 1 : 0}&controls=0&loop=1&playlist=${id}&rel=0` : null;
    } else if (p.tipo === 'VIMEO') {
      const m = /vimeo\.com\/(\d+)/.exec(p.url ?? '');
      url = m ? `https://player.vimeo.com/video/${m[1]}?autoplay=1&muted=${p.silenciado ? 1 : 0}&controls=0&loop=1` : null;
    } else if (p.tipo === 'HTML' && p.url) {
      url = p.url;
    }
    if (!url) return null;
    const segura = this.sanitizer.bypassSecurityTrustResourceUrl(url);
    this.embebidas.set(clave, segura);
    return segura;
  }

  qr(url: string | null): string | null {
    if (!url) return null;
    return `https://api.qrserver.com/v1/create-qr-code/?size=480x480&margin=6&data=${encodeURIComponent(url)}`;
  }

  // ── Estilo ─────────────────────────────────────────────────────────────

  estilo(b: Bloque): Record<string, string> {
    const e = b.estilo ?? {};
    const s: Record<string, string> = {
      left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%`, 'z-index': String(b.z ?? 1),
    };
    if (e.fondo) s['background'] = e.fondo;
    if (e.color) s['color'] = e.color;
    if (e.radio) s['border-radius'] = `calc(var(--u) * ${e.radio})`;
    if (e.relleno) s['padding'] = `calc(var(--u) * ${e.relleno})`;
    if (e.opacidad !== undefined && e.opacidad !== null && e.opacidad !== 1) s['opacity'] = String(e.opacidad);
    if (e.sombra) s['box-shadow'] = '0 calc(var(--u) * .6) calc(var(--u) * 2.4) rgba(0,0,0,.35)';
    if (e.borde) s['border'] = `calc(var(--u) * .25) solid ${e.borde}`;
    if (e.alinear) s['text-align'] = e.alinear;
    if (e.alinear) s['align-items'] = e.alinear === 'centro' ? 'center' : e.alinear === 'derecha' ? 'flex-end' : 'flex-start';
    if (e.negrita !== undefined) s['font-weight'] = e.negrita ? '800' : '500';
    return s;
  }

  /** Tamaño de letra del bloque en % de la altura (con un valor por defecto por tipo). */
  tam(b: Bloque, defecto: number): string {
    return `calc(var(--u) * ${b.estilo?.tamano || defecto})`;
  }

  prop<T>(b: Bloque, clave: string, defecto: T): T {
    const v = b.props?.[clave];
    return v === undefined || v === null || v === '' ? defecto : (v as T);
  }

  ajuste(b: Bloque | Media): string {
    const a = (b as Media).ajuste ?? ((b as Bloque).props?.['ajuste'] as string | undefined);
    return a === 'CUBRIR' ? 'cover' : a === 'ESTIRAR' ? 'fill' : 'contain';
  }

  filas(b: Bloque, lista: Turno[]): Turno[] {
    return lista.slice(0, Math.max(1, Number(this.prop(b, 'max', 6))));
  }

  marquesinaSeg(b: Bloque): string {
    const v = Number(this.prop(b, 'velocidad', 20));
    return `${Math.max(4, 60 - Math.min(55, v))}s`;
  }

  /** '24h' | '12h' (tipado como string para poder compararlo en la plantilla). */
  formato(b: Bloque): string { return String(this.prop(b, 'formato', '24h')); }

  hora(): string {
    const d = this.datos().ahora;
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  hora12(): string {
    const d = this.datos().ahora;
    const h = d.getHours() % 12 || 12;
    return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'a. m.' : 'p. m.'}`;
  }

  trackBloque = (_: number, b: Bloque) => b.id;
}
