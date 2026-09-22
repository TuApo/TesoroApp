import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

import { ContextoTurnosService } from '../../service/contexto-turnos.service';
import { Alcance, Aviso, AvisoIn, Media, MediaIn, ModoAviso, Playlist, PlaylistIn, ReporteEmision, TipoAlcance, TipoMedia, TurnosService, Vista, VozAudio, VozDisponible } from '../../service/turnos.service';
import { UtilityServiceService } from '../../../../../../shared/services/utilityService/utility-service.service';
import { DatosVista, VistaRender } from '../../components/vista-render/vista-render';
import { idYoutube } from '../../service/media.util';

export { idYoutube };

interface Sede { id: string; nombre: string; }
type ModoAlcance = 'TODAS' | 'OFICINA' | 'AVANZADO';

/** Borrador de una pieza en el formulario (todo en un objeto para que la vista previa reaccione). */
interface Borrador {
  tipo: TipoMedia; titulo: string; descripcion: string; url: string; duracion_seg: number; ajuste: 'CONTENER' | 'CUBRIR' | 'ESTIRAR';
  silenciado: boolean; curso_url: string; vigente_desde: string | null; vigente_hasta: string | null; activo: boolean; etiquetas: string;
  alcances: Alcance[]; voz_texto: string; voz_id: string; cama_media_id: string | null; cama_volumen: number; es_cama: boolean;
  intervalo_min: number | null; dias: number[]; desde: string; hasta: string;
}

const TIPOS_CON_ARCHIVO: TipoMedia[] = ['IMAGEN', 'VIDEO', 'AUDIO'];

/** Borrador de un aviso en pantalla. */
interface BorradorAviso {
  titulo: string; texto: string; modo: ModoAviso; duracion_seg: number; color: string; icono: string; con_voz: boolean;
  orden: number; intervalo_min: number | null; vigente_desde: string | null; vigente_hasta: string | null; activo: boolean; oficina_id: string | null;
}
export const ICONOS_AVISO = ['campaign', 'info', 'warning', 'badge', 'schedule', 'event', 'local_hospital', 'school', 'celebration', 'construction', 'wifi_off', 'volume_up'];

/**
 * Piezas de publicidad, avisos y cursos, con su alcance y las listas que las
 * ordenan en cada pantalla.
 *
 * <p>El tipo sale de lo que se suelta (imagen, video, audio o un enlace): no
 * hay que elegirlo. La vista previa usa el MISMO renderizador del televisor,
 * así que lo que se ve aquí es lo que va a salir. Los avisos hablados se
 * escriben y la voz de marca los locuta; con intervalo, se convierten en
 * perifoneo (suenan cada N minutos dentro de un horario sin cortar la
 * rotación visual).
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-turnos-publicidad',
  imports: [CommonModule, FormsModule, MatIconModule, RouterLink, VistaRender],
  templateUrl: './publicidad.html',
  styleUrls: ['../../styles/turnos-comun.css', './publicidad.css'],
})
export class Publicidad implements OnInit {
  readonly ctx = inject(ContextoTurnosService);
  readonly api = inject(TurnosService);
  private utilidades = inject(UtilityServiceService);
  private destroyRef = inject(DestroyRef);

  readonly pestana = signal<'piezas' | 'listas' | 'avisos' | 'reporte'>('piezas');
  // ── Avisos en pantalla ──
  readonly avisosLista = signal<Aviso[]>([]);
  readonly formAviso = signal(false);
  readonly editandoAviso = signal<string | null>(null);
  readonly avisoBorrador = signal<BorradorAviso>(this.avisoVacio());
  readonly emitiendo = signal<string | null>(null);
  readonly ICONOS_AVISO = ICONOS_AVISO;
  readonly piezas = signal<Media[]>([]);
  readonly totalPiezas = signal(0);
  readonly pagina = signal(0);
  readonly q = signal('');
  readonly filtroTipo = signal('');
  readonly listas = signal<Playlist[]>([]);
  readonly sedes = signal<Sede[]>([]);
  readonly reporte = signal<ReporteEmision[]>([]);
  readonly voces = signal<VozDisponible[]>([]);
  readonly camas = signal<Media[]>([]);
  readonly ocupado = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  // ── Formulario de pieza ──
  readonly formPieza = signal(false);
  readonly editandoPieza = signal<string | null>(null);
  readonly piezaOriginal = signal<Media | null>(null);
  readonly pieza = signal<Borrador>(this.piezaVacia());
  readonly archivo = signal<File | null>(null);
  readonly archivoUrlLocal = signal<string | null>(null);
  readonly modoAlcance = signal<ModoAlcance>('TODAS');
  readonly oficinaAlcance = signal<string | null>(null);
  readonly masOpciones = signal(false);
  readonly arrastrando = signal(false);
  readonly subiendo = signal(false);
  readonly generandoVoz = signal(false);
  readonly audioVoz = signal<VozAudio | null>(null);
  readonly reproduciendo = signal<string | null>(null);
  readonly vistaPrevia = signal<Media | null>(null);
  readonly ahora = signal(new Date());
  private audio = new Audio();

  // ── Listas ──
  readonly formLista = signal(false);
  readonly editandoLista = signal<string | null>(null);
  lista: Omit<PlaylistIn, 'items'> & { items: { media_id: string; duracion_seg: number | null }[] } = this.listaVacia();
  readonly buscadorLista = signal('');

  reporteDesde = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  reporteHasta = new Date().toISOString().slice(0, 10);

  readonly TIPOS: { v: TipoMedia; n: string; icono: string }[] = [
    { v: 'IMAGEN', n: 'Imagen', icono: 'image' }, { v: 'VIDEO', n: 'Video propio', icono: 'movie' },
    { v: 'AUDIO', n: 'Audio / aviso hablado', icono: 'graphic_eq' },
    { v: 'YOUTUBE', n: 'YouTube', icono: 'smart_display' }, { v: 'VIMEO', n: 'Vimeo', icono: 'smart_display' },
    { v: 'CURSO', n: 'Curso de inducción', icono: 'school' }, { v: 'TEXTO', n: 'Aviso de texto', icono: 'text_fields' },
    { v: 'HTML', n: 'Página web', icono: 'code' },
  ];
  readonly ALCANCES: { v: TipoAlcance; n: string }[] = [
    { v: 'OFICINA', n: 'Oficina' }, { v: 'SEDE', n: 'Sede' }, { v: 'CIUDAD', n: 'Ciudad' }, { v: 'EMPRESA_USUARIA', n: 'Empresa usuaria' },
  ];
  readonly DIAS = [{ n: 1, l: 'L' }, { n: 2, l: 'M' }, { n: 3, l: 'X' }, { n: 4, l: 'J' }, { n: 5, l: 'V' }, { n: 6, l: 'S' }, { n: 7, l: 'D' }];

  readonly piezasParaLista = computed(() => {
    const q = this.buscadorLista().trim().toLowerCase();
    return this.piezas().filter(p => p.activo && !p.es_cama && (!q || p.titulo.toLowerCase().includes(q)));
  });
  readonly vocesEspanol = computed(() => this.voces().filter(v => (v.idioma ?? '').startsWith('es') || /colomb|medell|latino/i.test(v.nombre)));
  readonly conArchivo = computed(() => TIPOS_CON_ARCHIVO.includes(this.pieza().tipo));
  readonly esLocucion = computed(() => this.pieza().tipo === 'AUDIO' && !this.archivo() && !this.piezaOriginal()?.archivo_nombre);

  /** La pieza tal como la vería el televisor (para la vista previa). */
  readonly borrador = computed<Media>(() => {
    const p = this.pieza();
    const o = this.piezaOriginal();
    let url: string | null = this.archivoUrlLocal();
    if (!url) {
      if (this.conArchivo()) url = o?.url ?? null;
      else url = p.url || null;
    }
    if (p.tipo === 'AUDIO' && p.voz_texto && this.audioVoz()) url = this.audioVoz()!.url;
    return {
      id: o?.id ?? 'borrador', tipo: p.tipo, titulo: p.titulo || 'Sin título', descripcion: p.descripcion || null, url,
      archivo_nombre: this.archivo()?.name ?? o?.archivo_nombre ?? null, mime: this.archivo()?.type ?? o?.mime ?? null, bytes: null, ancho: null, alto: null,
      duracion_seg: p.duracion_seg || 12, ajuste: p.ajuste, silenciado: p.silenciado, curso_ref: null, curso_url: p.curso_url || null,
      vigente_desde: null, vigente_hasta: null, activo: true, etiquetas: p.etiquetas || null, creado_en: '', creado_por_nombre: null, alcances: [],
      vigente: true, emisiones: null, voz_texto: p.voz_texto || null, voz_id: p.voz_id || null, voz_audio_id: this.audioVoz()?.id ?? null,
      cama_media_id: p.cama_media_id, cama_volumen: p.cama_volumen, es_cama: p.es_cama, intervalo_min: null, horario_json: null,
    };
  });
  readonly vistaPreviaForm = computed<Vista>(() => this.vistaDeUnaPieza(this.pieza().ajuste));
  readonly datosPreviaForm = computed<DatosVista>(() => this.datosDe(this.borrador()));

  constructor() {
    this.audio.onended = () => this.reproduciendo.set(null);
    this.destroyRef.onDestroy(() => { this.audio.pause(); this.liberarUrlLocal(); });
    const reloj = setInterval(() => this.ahora.set(new Date()), 1000);
    this.destroyRef.onDestroy(() => clearInterval(reloj));
    effect(() => {
      const id = this.ctx.oficinaId();
      untracked(() => { if (!this.oficinaAlcance()) this.oficinaAlcance.set(id); });
    });
  }

  ngOnInit(): void {
    this.ctx.cargar();
    this.cargarPiezas();
    this.cargarListas();
    this.api.vozVoces().subscribe({ next: v => this.voces.set(v), error: () => {} });
    this.utilidades.traerSucursales().subscribe({
      next: (r: unknown) => {
        const l = Array.isArray(r) ? r : (r as { results?: unknown[] })?.results ?? [];
        this.sedes.set((l as Array<{ id: string; nombre: string }>).map(s => ({ id: String(s.id), nombre: s.nombre })));
      },
      error: () => this.sedes.set([]),
    });
  }

  // ── Piezas: carga y galería ────────────────────────────────────────────

  cargarPiezas(): void {
    this.api.buscarMedia(this.q() || undefined, this.filtroTipo() || undefined, null, this.pagina(), 80).subscribe({
      next: p => { this.piezas.set(p.content); this.totalPiezas.set(p.total_elements); this.camas.set(p.content.filter(m => m.es_cama && m.activo)); },
      error: () => this.error.set('No se pudieron cargar las piezas'),
    });
  }

  private avisar(t: string): void { this.aviso.set(t); setTimeout(() => this.aviso.set(null), 2500); }

  escuchar(url: string | null, clave: string): void {
    if (!url) return;
    if (this.reproduciendo() === clave) { this.audio.pause(); this.reproduciendo.set(null); return; }
    this.audio.pause();
    this.audio.src = url;
    this.reproduciendo.set(clave);
    this.audio.play().catch(() => this.reproduciendo.set(null));
  }

  verEnPantalla(m: Media): void { this.vistaPrevia.set(m); }
  vistaDeUnaPieza(ajuste: string): Vista {
    return { id: 'previa', oficina_id: null, nombre: 'Vista previa', descripcion: null, orientacion: 'HORIZONTAL', fondo: { tipo: 'COLOR', color: '#000000' },
      bloques: [{ id: 'p', tipo: 'PUBLICIDAD', x: 0, y: 0, w: 100, h: 100, z: 1, estilo: {}, props: { playlist_id: null, ajuste } }],
      activa: true, creado_en: '', actualizado_en: '', usada_por: [] };
  }
  datosDe(m: Media): DatosVista {
    return { oficina_nombre: this.ctx.oficina()?.nombre ?? 'Oficina', ahora: this.ahora(), llamado: null, en_curso: [], en_espera: [],
      piezas: [{ ...m, intervalo_min: null, es_cama: false }], playlists: {}, croquis: null, url_turno: null };
  }

  // ── Formulario ─────────────────────────────────────────────────────────

  set<K extends keyof Borrador>(campo: K, valor: Borrador[K]): void { this.pieza.update(p => ({ ...p, [campo]: valor })); }

  nuevaPieza(tipo?: TipoMedia): void {
    this.liberarUrlLocal();
    this.pieza.set({ ...this.piezaVacia(), tipo: tipo ?? 'IMAGEN' });
    this.archivo.set(null);
    this.piezaOriginal.set(null);
    this.audioVoz.set(null);
    this.editandoPieza.set(null);
    this.modoAlcance.set('TODAS');
    this.oficinaAlcance.set(this.ctx.oficinaId());
    this.masOpciones.set(false);
    this.formPieza.set(true);
  }

  editarPieza(m: Media): void {
    this.liberarUrlLocal();
    let h = { dias: [1, 2, 3, 4, 5], desde: '08:00', hasta: '17:00' };
    try { if (m.horario_json) h = { ...h, ...JSON.parse(m.horario_json) }; } catch { /* horario ilegible: se usa el defecto */ }
    this.pieza.set({
      tipo: m.tipo, titulo: m.titulo, descripcion: m.descripcion ?? '', url: TIPOS_CON_ARCHIVO.includes(m.tipo) ? '' : (m.url ?? ''),
      duracion_seg: m.duracion_seg, ajuste: m.ajuste, silenciado: m.silenciado, curso_url: m.curso_url ?? '',
      vigente_desde: m.vigente_desde?.slice(0, 16) ?? null, vigente_hasta: m.vigente_hasta?.slice(0, 16) ?? null,
      activo: m.activo, etiquetas: m.etiquetas ?? '', alcances: m.alcances.map(a => ({ tipo: a.tipo, valor_ref: a.valor_ref, valor_nombre: a.valor_nombre })),
      voz_texto: m.voz_texto ?? '', voz_id: m.voz_id ?? '', cama_media_id: m.cama_media_id, cama_volumen: m.cama_volumen ?? 25, es_cama: m.es_cama,
      intervalo_min: m.intervalo_min, dias: h.dias, desde: h.desde, hasta: h.hasta,
    });
    this.archivo.set(null);
    this.piezaOriginal.set(m);
    this.audioVoz.set(m.voz_audio_id ? { id: m.voz_audio_id, url: m.url ?? '', texto: m.voz_texto ?? '', voz_id: m.voz_id ?? '', voz_nombre: null, modelo: '', uso: 'LOCUCION', bytes: 0, duracion_ms: null, caracteres: 0, veces: 0, creado_en: '', ultimo_uso: null, de_cache: true, clave: null } : null);
    const soloOficina = m.alcances.length === 1 && m.alcances[0].tipo === 'OFICINA';
    this.modoAlcance.set(!m.alcances.length ? 'TODAS' : soloOficina ? 'OFICINA' : 'AVANZADO');
    this.oficinaAlcance.set(soloOficina ? m.alcances[0].valor_ref : this.ctx.oficinaId());
    this.masOpciones.set(!!(m.etiquetas || m.vigente_desde || m.vigente_hasta || !m.activo));
    this.editandoPieza.set(m.id);
    this.formPieza.set(true);
  }

  cerrarForm(): void { this.formPieza.set(false); this.liberarUrlLocal(); }

  /** El tipo sale del archivo: imagen, video o audio. */
  recibirArchivos(lista: FileList | File[] | null): void {
    const f = lista && lista.length ? lista[0] : null;
    if (!f) return;
    const tipo: TipoMedia | null = f.type.startsWith('image/') ? 'IMAGEN' : f.type.startsWith('video/') ? 'VIDEO' : f.type.startsWith('audio/') ? 'AUDIO' : null;
    if (!tipo) { this.error.set(`No se reconoce "${f.name}": suba una imagen, un video o un audio.`); return; }
    this.liberarUrlLocal();
    this.archivo.set(f);
    this.archivoUrlLocal.set(URL.createObjectURL(f));
    this.audioVoz.set(null);
    this.pieza.update(p => ({ ...p, tipo, url: '', voz_texto: tipo === 'AUDIO' ? '' : p.voz_texto, titulo: p.titulo || f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') }));
  }

  archivoElegido(e: Event): void { this.recibirArchivos((e.target as HTMLInputElement).files); }
  soltar(e: DragEvent): void { e.preventDefault(); this.arrastrando.set(false); this.recibirArchivos(e.dataTransfer?.files ?? null); }
  arrastrar(e: DragEvent, dentro: boolean): void { e.preventDefault(); this.arrastrando.set(dentro); }

  /** Un enlace pegado: YouTube, Vimeo, una imagen o video externo, o una página. */
  recibirEnlace(url: string): void {
    const u = url.trim();
    let tipo: TipoMedia = 'HTML';
    if (idYoutube(u)) tipo = 'YOUTUBE';
    else if (/vimeo\.com\/\d+/.test(u)) tipo = 'VIMEO';
    else if (/\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(u)) tipo = 'IMAGEN';
    else if (/\.(mp4|webm|mov)(\?.*)?$/i.test(u)) tipo = 'VIDEO';
    else if (/\.(mp3|wav|ogg|m4a)(\?.*)?$/i.test(u)) tipo = 'AUDIO';
    this.liberarUrlLocal();
    this.archivo.set(null);
    this.pieza.update(p => ({ ...p, tipo, url: u, titulo: p.titulo || (tipo === 'YOUTUBE' ? 'Video de YouTube' : tipo === 'VIMEO' ? 'Video de Vimeo' : p.titulo) }));
  }

  quitarArchivo(): void { this.liberarUrlLocal(); this.archivo.set(null); }

  private liberarUrlLocal(): void {
    const u = this.archivoUrlLocal();
    if (u) { URL.revokeObjectURL(u); this.archivoUrlLocal.set(null); }
  }

  alternarDia(d: number): void {
    this.pieza.update(p => ({ ...p, dias: p.dias.includes(d) ? p.dias.filter(x => x !== d) : [...p.dias, d].sort() }));
  }

  // Alcance avanzado (sede, ciudad, empresa usuaria)
  agregarAlcance(): void { this.pieza.update(p => ({ ...p, alcances: [...p.alcances, { tipo: 'OFICINA', valor_ref: null, valor_nombre: null }] })); }
  quitarAlcance(i: number): void { this.pieza.update(p => ({ ...p, alcances: p.alcances.filter((_, k) => k !== i) })); }
  alcanceSet(i: number, cambios: Partial<Alcance>): void {
    this.pieza.update(p => ({ ...p, alcances: p.alcances.map((a, k) => {
      if (k !== i) return a;
      const n = { ...a, ...cambios };
      if (cambios.tipo !== undefined) { n.valor_ref = null; n.valor_nombre = null; }
      if (cambios.valor_ref !== undefined) {
        n.valor_nombre = n.tipo === 'OFICINA' ? this.ctx.oficinas().find(o => o.id === n.valor_ref)?.nombre ?? null
          : n.tipo === 'SEDE' ? this.sedes().find(s => s.id === n.valor_ref)?.nombre ?? null : n.valor_ref;
      }
      return n;
    }) }));
  }

  /** Genera (o recupera de caché) la locución del aviso para escucharla antes de guardar. */
  generarVoz(): void {
    const p = this.pieza();
    if (!p.voz_texto.trim()) return;
    this.generandoVoz.set(true);
    this.error.set(null);
    this.api.vozProbar(p.voz_texto, p.voz_id || null, null, this.ctx.oficinaId()).subscribe({
      next: a => { this.generandoVoz.set(false); this.audioVoz.set(a); this.escuchar(this.api.urlAudio(a.url), 'voz-borrador'); },
      error: e => { this.generandoVoz.set(false); this.error.set(e?.error?.message || 'No se pudo generar la voz. Revise Voz y locución.'); },
    });
  }

  guardarPieza(): void {
    const p = this.pieza();
    if (!p.titulo.trim()) return;
    if (p.tipo === 'AUDIO' && !this.archivo() && !this.piezaOriginal()?.archivo_nombre && !p.voz_texto.trim() && !p.url) { this.error.set('Un audio necesita un archivo o un texto para locutar.'); return; }
    let alcances: Alcance[] = [];
    if (this.modoAlcance() === 'OFICINA') {
      const id = this.oficinaAlcance();
      if (!id) { this.error.set('Elija la oficina'); return; }
      alcances = [{ tipo: 'OFICINA', valor_ref: id, valor_nombre: this.ctx.oficinas().find(o => o.id === id)?.nombre ?? null }];
    } else if (this.modoAlcance() === 'AVANZADO') {
      alcances = p.alcances.filter(a => a.valor_ref);
    }
    const cuerpo: MediaIn = {
      tipo: p.tipo, titulo: p.titulo.trim(), descripcion: p.descripcion || null, url: this.conArchivo() ? null : (p.url || null),
      duracion_seg: p.duracion_seg, ajuste: p.ajuste, silenciado: p.tipo === 'AUDIO' ? false : p.silenciado, curso_ref: null, curso_url: p.curso_url || null,
      vigente_desde: p.vigente_desde || null, vigente_hasta: p.vigente_hasta || null, activo: p.activo, etiquetas: p.etiquetas || null, alcances,
      voz_texto: p.tipo === 'AUDIO' ? (p.voz_texto || null) : null, voz_id: p.voz_id || null, cama_media_id: p.cama_media_id || null,
      cama_volumen: p.cama_volumen, es_cama: p.es_cama, intervalo_min: p.intervalo_min || null,
      horario_json: p.intervalo_min ? JSON.stringify({ dias: p.dias, desde: p.desde, hasta: p.hasta }) : null,
    };
    const id = this.editandoPieza();
    this.ocupado.set(true);
    this.error.set(null);
    (id ? this.api.actualizarMedia(id, cuerpo) : this.api.crearMedia(cuerpo)).subscribe({
      next: m => {
        const f = this.archivo();
        if (f) {
          this.subiendo.set(true);
          this.api.subirArchivoMedia(m.id, f).subscribe({
            next: () => { this.subiendo.set(false); this.terminarPieza(id); },
            error: e => { this.subiendo.set(false); this.ocupado.set(false); this.error.set(e?.error?.message || 'La pieza se guardó pero el archivo no subió'); this.cargarPiezas(); },
          });
        } else {
          this.terminarPieza(id);
        }
      },
      error: e => { this.ocupado.set(false); this.error.set(e?.error?.message || 'No se pudo guardar la pieza'); },
    });
  }

  private terminarPieza(id: string | null): void {
    this.ocupado.set(false);
    this.cerrarForm();
    this.avisar(id ? 'Pieza actualizada; los televisores la toman en su próximo refresco.' : 'Pieza creada');
    this.cargarPiezas();
  }

  desactivarPieza(m: Media): void {
    if (!confirm(`¿Retirar "${m.titulo}"? Sale de las listas y deja de circular; el reporte de emisiones se conserva.`)) return;
    this.api.desactivarMedia(m.id).subscribe({ next: () => this.cargarPiezas(), error: () => {} });
  }

  iconoTipo(t: string): string { return this.TIPOS.find(x => x.v === t)?.icono ?? 'image'; }
  nombreTipo(t: string): string { return this.TIPOS.find(x => x.v === t)?.n ?? t; }
  urlPieza(m: Media): string | null { return this.api.urlMedia(m); }
  miniaturaYoutube(m: Media): string | null {
    const id = idYoutube(m.url);
    return id ? `https://img.youtube.com/vi/${id}/mqdefault.jpg` : null;
  }
  horarioTexto(m: Media): string {
    try { const h = JSON.parse(m.horario_json ?? '{}'); return `${(h.dias ?? []).map((d: number) => this.DIAS.find(x => x.n === d)?.l ?? '').join('')} ${h.desde ?? ''}–${h.hasta ?? ''}`; }
    catch { return ''; }
  }
  nombreCama(id: string | null): string { return this.camas().find(c => c.id === id)?.titulo ?? ''; }

  // ── Avisos en pantalla ─────────────────────────────────────────────────
  cargarAvisos(): void {
    this.api.avisos(this.ctx.oficinaId()).subscribe({ next: a => this.avisosLista.set(a), error: () => this.avisosLista.set([]) });
  }
  setAviso<K extends keyof BorradorAviso>(campo: K, valor: BorradorAviso[K]): void { this.avisoBorrador.update(a => ({ ...a, [campo]: valor })); }
  nuevoAviso(modo: ModoAviso = 'BLOQUE'): void { this.avisoBorrador.set({ ...this.avisoVacio(), modo, oficina_id: this.ctx.oficinaId() }); this.editandoAviso.set(null); this.formAviso.set(true); }
  editarAviso(a: Aviso): void {
    this.avisoBorrador.set({ titulo: a.titulo, texto: a.texto ?? '', modo: a.modo, duracion_seg: a.duracion_seg, color: a.color ?? '#9BD441', icono: a.icono ?? 'campaign',
      con_voz: a.con_voz, orden: a.orden, intervalo_min: a.intervalo_min, vigente_desde: a.vigente_desde?.slice(0, 16) ?? null, vigente_hasta: a.vigente_hasta?.slice(0, 16) ?? null,
      activo: a.activo, oficina_id: a.oficina_id });
    this.editandoAviso.set(a.id);
    this.formAviso.set(true);
  }
  guardarAviso(): void {
    const a = this.avisoBorrador();
    if (!a.titulo.trim()) return;
    const cuerpo: AvisoIn = { oficina_id: a.oficina_id, titulo: a.titulo.trim(), texto: a.texto || null, modo: a.modo, duracion_seg: a.duracion_seg, color: a.color || null,
      icono: a.icono || null, con_voz: a.con_voz, orden: a.orden, intervalo_min: a.modo === 'PANTALLA_COMPLETA' ? (a.intervalo_min || null) : null,
      vigente_desde: a.vigente_desde || null, vigente_hasta: a.vigente_hasta || null, activo: a.activo };
    const id = this.editandoAviso();
    this.ocupado.set(true);
    this.error.set(null);
    (id ? this.api.actualizarAviso(id, cuerpo) : this.api.crearAviso(cuerpo)).subscribe({
      next: () => { this.ocupado.set(false); this.formAviso.set(false); this.avisar(id ? 'Aviso actualizado; las pantallas ya lo tienen.' : 'Aviso creado'); this.cargarAvisos(); },
      error: e => { this.ocupado.set(false); this.error.set(e?.error?.message || 'No se pudo guardar el aviso'); },
    });
  }
  emitirAviso(a: Aviso): void {
    this.emitiendo.set(a.id);
    this.api.emitirAviso(a.id).subscribe({
      next: () => { this.emitiendo.set(null); this.avisar(a.modo === 'PANTALLA_COMPLETA' ? 'Aviso emitido: está tomando las pantallas ahora.' : 'Aviso emitido a las pantallas.'); },
      error: e => { this.emitiendo.set(null); this.error.set(e?.error?.message || 'No se pudo emitir'); },
    });
  }
  desactivarAviso(a: Aviso): void {
    if (!confirm(`¿Retirar el aviso "${a.titulo}"?`)) return;
    this.api.desactivarAviso(a.id).subscribe({ next: () => this.cargarAvisos(), error: () => {} });
  }
  private avisoVacio(): BorradorAviso {
    return { titulo: '', texto: '', modo: 'BLOQUE', duracion_seg: 10, color: '#9BD441', icono: 'campaign', con_voz: false, orden: 0, intervalo_min: null,
      vigente_desde: null, vigente_hasta: null, activo: true, oficina_id: null };
  }

  // ── Listas ─────────────────────────────────────────────────────────────
  cargarListas(): void { this.api.playlists(null).subscribe({ next: l => this.listas.set(l), error: () => {} }); }
  nuevaLista(): void { this.lista = this.listaVacia(); this.editandoLista.set(null); this.formLista.set(true); }
  editarLista(p: Playlist): void {
    this.lista = { nombre: p.nombre, descripcion: p.descripcion, oficina_id: p.oficina_id, modo: p.modo, activa: p.activa,
      items: p.items.map(i => ({ media_id: i.media_id, duracion_seg: i.duracion_seg })) };
    this.editandoLista.set(p.id);
    this.formLista.set(true);
  }
  enLista(id: string): boolean { return this.lista.items.some(i => i.media_id === id); }
  alternarEnLista(m: Media): void {
    this.lista.items = this.enLista(m.id) ? this.lista.items.filter(i => i.media_id !== m.id) : [...this.lista.items, { media_id: m.id, duracion_seg: null }];
  }
  moverItem(i: number, d: -1 | 1): void {
    const j = i + d;
    if (j < 0 || j >= this.lista.items.length) return;
    const items = [...this.lista.items];
    [items[i], items[j]] = [items[j], items[i]];
    this.lista.items = items;
  }
  tituloPieza(id: string): string { return this.piezas().find(p => p.id === id)?.titulo ?? '(pieza)'; }
  guardarLista(): void {
    const cuerpo: PlaylistIn = { ...this.lista, nombre: this.lista.nombre.trim(), oficina_id: this.lista.oficina_id || null,
      items: this.lista.items.map((i, k) => ({ media_id: i.media_id, orden: k, duracion_seg: i.duracion_seg })) };
    const id = this.editandoLista();
    this.ocupado.set(true);
    (id ? this.api.actualizarPlaylist(id, cuerpo) : this.api.crearPlaylist(cuerpo)).subscribe({
      next: () => { this.ocupado.set(false); this.formLista.set(false); this.avisar('Lista guardada'); this.cargarListas(); },
      error: e => { this.ocupado.set(false); this.error.set(e?.error?.message || 'No se pudo guardar la lista'); },
    });
  }
  desactivarLista(p: Playlist): void {
    if (!confirm(`¿Retirar la lista "${p.nombre}"?`)) return;
    this.api.desactivarPlaylist(p.id).subscribe({ next: () => this.cargarListas(), error: () => {} });
  }

  // ── Reporte ────────────────────────────────────────────────────────────
  cargarReporte(): void {
    this.api.reporteEmisiones(this.reporteDesde, this.reporteHasta, this.ctx.oficinaId()).subscribe({ next: r => this.reporte.set(r), error: () => this.reporte.set([]) });
  }

  private piezaVacia(): Borrador {
    return { tipo: 'IMAGEN', titulo: '', descripcion: '', url: '', duracion_seg: 12, ajuste: 'CONTENER', silenciado: true, curso_url: '',
      vigente_desde: null, vigente_hasta: null, activo: true, etiquetas: '', alcances: [], voz_texto: '', voz_id: '', cama_media_id: null,
      cama_volumen: 25, es_cama: false, intervalo_min: null, dias: [1, 2, 3, 4, 5], desde: '08:00', hasta: '17:00' };
  }
  private listaVacia(): Omit<PlaylistIn, 'items'> & { items: { media_id: string; duracion_seg: number | null }[] } {
    return { nombre: '', descripcion: '', oficina_id: null, modo: 'SECUENCIAL', activa: true, items: [] };
  }
}
