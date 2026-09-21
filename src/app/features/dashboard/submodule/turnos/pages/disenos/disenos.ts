import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

import { SelectorOficina } from '../../components/selector-oficina/selector-oficina';
import { EditorVista } from '../../components/editor-vista/editor-vista';
import { DatosVista, NOMBRE_BLOQUE, VistaRender, bloqueNuevo } from '../../components/vista-render/vista-render';
import { ReproductorGuion } from '../../components/reproductor-guion/reproductor-guion';
import { ContextoTurnosService } from '../../service/contexto-turnos.service';
import {
  AlcanceGuion, Bloque, Croquis, DisenoResuelto, Guion, GuionIn, Media, Pantalla, Paso, Playlist, Transicion, Turno,
  TurnosService, Vista, VistaIn,
} from '../../service/turnos.service';

export const TRANSICIONES: { valor: Transicion; nombre: string }[] = [
  { valor: 'FUNDIDO', nombre: 'Fundido' },
  { valor: 'DESLIZAR_IZQUIERDA', nombre: 'Deslizar a la izquierda' },
  { valor: 'DESLIZAR_ARRIBA', nombre: 'Deslizar hacia arriba' },
  { valor: 'ZOOM', nombre: 'Acercar' },
  { valor: 'NINGUNA', nombre: 'Corte (sin transición)' },
];

function turnoMuestra(p: Partial<Turno>): Turno {
  return {
    id: 'm', oficina_id: '', servicio_id: '', servicio_nombre: 'Contratación', servicio_color: null, fecha: '', numero: 14,
    codigo: 'A-014', estado: 'LLAMADO', prioridad: 'NORMAL', canal: 'RECEPCION', documento: null, nombre: 'CAMILO H.',
    telefono: null, correo: null, empresa_usuaria_ref: null, empresa_usuaria_nombre: null, punto_id: null, punto_nombre: 'Módulo 2',
    atendido_por: null, atendido_por_nombre: null, area_id: null, area_nombre: 'Contratación', area_referencia: null,
    creado_en: '', llamado_en: null, iniciado_en: null, finalizado_en: null, espera_seg: null, atencion_seg: null, llamadas: 1,
    motivo: null, observaciones: null, delante: null, espera_estimada_min: null, ...p,
  } as unknown as Turno;
}

const EN_CURSO_MUESTRA: Turno[] = [
  turnoMuestra({ id: 'm1', codigo: 'A-014', estado: 'LLAMADO', punto_nombre: 'Módulo 2' }),
  turnoMuestra({ id: 'm2', codigo: 'C-031', estado: 'EN_ATENCION', punto_nombre: 'Ventanilla 1', servicio_nombre: 'Certificados', area_nombre: 'Tesorería', nombre: 'ANA T.' }),
];
const EN_ESPERA_MUESTRA: Turno[] = [
  turnoMuestra({ id: 'm3', codigo: 'A-015', estado: 'EN_ESPERA', punto_nombre: null }),
  turnoMuestra({ id: 'm4', codigo: 'A-016', estado: 'EN_ESPERA', punto_nombre: null }),
  turnoMuestra({ id: 'm5', codigo: 'C-032', estado: 'EN_ESPERA', punto_nombre: null, servicio_nombre: 'Certificados' }),
  turnoMuestra({ id: 'm6', codigo: 'B-007', estado: 'EN_ESPERA', punto_nombre: null, servicio_nombre: 'Afiliaciones' }),
];
const PIEZA_MUESTRA: Media = {
  id: 'demo', tipo: 'TEXTO', titulo: 'Aquí va su publicidad', descripcion: 'Suba piezas en Publicidad y cursos; circularán en este bloque.',
  url: null, archivo_nombre: null, mime: null, bytes: null, ancho: null, alto: null, duracion_seg: 8, ajuste: 'CONTENER', silenciado: true,
  curso_ref: null, curso_url: null, vigente_desde: null, vigente_hasta: null, activo: true, etiquetas: null, creado_en: '', creado_por_nombre: null,
  alcances: [], vigente: true, emisiones: null,
  voz_texto: null, voz_id: null, voz_audio_id: null, cama_media_id: null, cama_volumen: 25, es_cama: false, intervalo_min: null, horario_json: null,
};

/** Bloques del diseño clásico "turnos + publicidad", como punto de partida. */
function plantillaClasica(vertical: boolean): Bloque[] {
  const pon = (b: Bloque, x: number, y: number, w: number, h: number, z: number) => ({ ...b, x, y, w, h, z });
  if (vertical) {
    return [
      pon(bloqueNuevo('OFICINA'), 3, 1, 60, 4, 1), pon(bloqueNuevo('RELOJ'), 60, 1, 37, 5, 1),
      pon(bloqueNuevo('TURNO_LLAMADO'), 3, 7, 94, 26, 1),
      pon(bloqueNuevo('LISTA_ATENCION'), 3, 35, 46, 20, 1), pon(bloqueNuevo('LISTA_ESPERA'), 51, 35, 46, 20, 1),
      pon(bloqueNuevo('PUBLICIDAD'), 3, 57, 94, 41, 1),
    ];
  }
  return [
    pon(bloqueNuevo('OFICINA'), 2, 1.5, 50, 7, 1), pon(bloqueNuevo('RELOJ'), 74, 1.5, 24, 9, 1),
    pon(bloqueNuevo('TURNO_LLAMADO'), 2, 11, 42, 44, 1),
    pon(bloqueNuevo('LISTA_ATENCION'), 2, 57, 20, 41, 1), pon(bloqueNuevo('LISTA_ESPERA'), 24, 57, 20, 41, 1),
    pon(bloqueNuevo('PUBLICIDAD'), 46, 11, 52, 87, 1),
  ];
}

/**
 * Diseño de pantallas: las VISTAS (qué se ve, bloque a bloque) y los GUIONES
 * (en qué orden, con qué transición y en qué pantallas). Desde aquí se
 * administra el contenido de todos los televisores de la oficina, o de todas.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-turnos-disenos',
  imports: [CommonModule, FormsModule, MatIconModule, RouterLink, SelectorOficina, EditorVista, VistaRender, ReproductorGuion],
  templateUrl: './disenos.html',
  styleUrls: ['../../styles/turnos-comun.css', './disenos.css'],
})
export class Disenos implements OnInit {
  readonly ctx = inject(ContextoTurnosService);
  private api = inject(TurnosService);
  private destroyRef = inject(DestroyRef);

  readonly TRANSICIONES = TRANSICIONES;
  readonly NOMBRE_BLOQUE = NOMBRE_BLOQUE;

  readonly pestana = signal<'vistas' | 'guiones'>('vistas');
  readonly vistas = signal<Vista[]>([]);
  readonly guiones = signal<Guion[]>([]);
  readonly pantallas = signal<Pantalla[]>([]);
  readonly playlists = signal<Playlist[]>([]);
  readonly imagenes = signal<Media[]>([]);
  readonly piezas = signal<Media[]>([]);
  readonly croquis = signal<Croquis | null>(null);

  readonly vistaEdit = signal<Vista | null>(null);
  readonly guionEdit = signal<Guion | null>(null);
  readonly ocupado = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);
  readonly sucio = signal(false);

  readonly prueba = signal<DisenoResuelto | null>(null);
  readonly llamadoPrueba = signal<Turno | null>(null);
  readonly ahora = signal(new Date());

  /** Datos de muestra para el lienzo y la vista previa: cola inventada, piezas reales si las hay. */
  readonly muestra = computed<DatosVista>(() => {
    const mapa: Record<string, Media[]> = {};
    for (const p of this.playlists()) mapa[p.id] = p.items.map(i => i.media).filter(Boolean);
    const codigo = this.ctx.oficina()?.cartel_codigo;
    return {
      oficina_nombre: this.ctx.oficina()?.nombre ?? 'Oficina',
      ahora: this.ahora(),
      llamado: this.llamadoPrueba(),
      en_curso: EN_CURSO_MUESTRA,
      en_espera: EN_ESPERA_MUESTRA,
      piezas: this.piezas().length ? this.piezas() : [PIEZA_MUESTRA],
      playlists: mapa,
      croquis: this.croquis(),
      url_turno: codigo ? `${location.origin}/t/${codigo}` : null,
    };
  });

  readonly guionesActivos = computed(() => this.guiones().filter(g => g.activo));
  readonly pantallasDeOficina = computed(() => this.pantallas().filter(p => p.activa));

  constructor() {
    effect(() => {
      const id = this.ctx.oficinaId();
      untracked(() => { this.vistaEdit.set(null); this.guionEdit.set(null); this.cargar(id); });
    });
    const reloj = setInterval(() => this.ahora.set(new Date()), 1000);
    this.destroyRef.onDestroy(() => clearInterval(reloj));
  }

  ngOnInit(): void { this.ctx.cargar(); }

  // ── Carga ──────────────────────────────────────────────────────────────

  private cargar(id: string | null): void {
    if (!id) { this.vistas.set([]); this.guiones.set([]); this.pantallas.set([]); this.playlists.set([]); return; }
    this.api.vistas(id).subscribe({ next: v => this.vistas.set(v), error: () => this.vistas.set([]) });
    this.api.guiones(id).subscribe({ next: g => this.guiones.set(g), error: () => this.guiones.set([]) });
    this.api.pantallas(id).subscribe({ next: p => this.pantallas.set(p), error: () => this.pantallas.set([]) });
    this.api.playlists(id).subscribe({ next: p => this.playlists.set(p.filter(x => x.activa)), error: () => this.playlists.set([]) });
    this.api.buscarMedia(undefined, 'IMAGEN', true, 0, 60).subscribe({ next: p => this.imagenes.set(p.content.filter(m => !!m.url)), error: () => {} });
    this.api.buscarMedia(undefined, undefined, true, 0, 30).subscribe({ next: p => this.piezas.set(p.content.filter(m => m.vigente)), error: () => {} });
    this.api.croquis(id).subscribe({ next: c => this.croquis.set(c), error: () => this.croquis.set(null) });
  }

  private recargarVistas(): void {
    const id = this.ctx.oficinaId();
    if (id) this.api.vistas(id).subscribe({ next: v => this.vistas.set(v), error: () => {} });
  }

  private recargarGuiones(): void {
    const id = this.ctx.oficinaId();
    if (!id) return;
    this.api.guiones(id).subscribe({ next: g => this.guiones.set(g), error: () => {} });
    this.api.pantallas(id).subscribe({ next: p => this.pantallas.set(p), error: () => {} });
  }

  private avisar(texto: string): void { this.aviso.set(texto); setTimeout(() => this.aviso.set(null), 2500); }

  // ── Vistas ─────────────────────────────────────────────────────────────

  nuevaVista(plantilla: 'clasica' | 'blanco', vertical = false): void {
    const bloques = plantilla === 'clasica' ? plantillaClasica(vertical) : [];
    this.vistaEdit.set({
      id: '', oficina_id: this.ctx.oficinaId(), nombre: plantilla === 'clasica' ? 'Turnos y publicidad' : 'Nueva vista', descripcion: null,
      orientacion: vertical ? 'VERTICAL' : 'HORIZONTAL', fondo: { tipo: 'COLOR', color: '#0B1020' }, bloques, activa: true,
      creado_en: '', actualizado_en: '', usada_por: [],
    });
    this.sucio.set(true);
    this.pestana.set('vistas');
  }

  editarVista(v: Vista): void {
    if (this.sucio() && this.vistaEdit() && !confirm('Hay cambios sin guardar en la vista actual. ¿Descartarlos?')) return;
    this.vistaEdit.set(structuredClone(v));
    this.sucio.set(false);
  }

  vistaCambio(v: Vista): void { this.vistaEdit.set(v); this.sucio.set(true); }

  vistaCampo<K extends keyof Vista>(clave: K, valor: Vista[K]): void {
    this.vistaEdit.update(v => (v ? { ...v, [clave]: valor } : v));
    this.sucio.set(true);
  }

  guardarVista(): void {
    const v = this.vistaEdit();
    if (!v || !v.nombre.trim()) return;
    const in_: VistaIn = { nombre: v.nombre, descripcion: v.descripcion, oficina_id: v.oficina_id, orientacion: v.orientacion, fondo: v.fondo, bloques: v.bloques, activa: v.activa };
    this.ocupado.set(true);
    this.error.set(null);
    (v.id ? this.api.actualizarVista(v.id, in_) : this.api.crearVista(in_)).subscribe({
      next: g => { this.ocupado.set(false); this.sucio.set(false); this.vistaEdit.set(g); this.avisar(v.id ? 'Vista guardada. Los televisores que la usan ya la muestran.' : 'Vista creada'); this.recargarVistas(); },
      error: e => { this.ocupado.set(false); this.error.set(e?.error?.message || 'No se pudo guardar la vista'); },
    });
  }

  duplicarVista(v: Vista): void {
    this.api.duplicarVista(v.id).subscribe({ next: n => { this.recargarVistas(); this.vistaEdit.set(n); this.sucio.set(false); this.avisar('Vista duplicada'); }, error: e => this.error.set(e?.error?.message || 'No se pudo duplicar') });
  }

  eliminarVista(v: Vista): void {
    if (v.usada_por?.length) { this.error.set(`La vista está en uso por: ${v.usada_por.join(', ')}. Quítela de esos guiones primero.`); return; }
    if (!confirm(`¿Eliminar la vista "${v.nombre}"?`)) return;
    this.api.desactivarVista(v.id).subscribe({
      next: () => { if (this.vistaEdit()?.id === v.id) this.vistaEdit.set(null); this.recargarVistas(); this.avisar('Vista eliminada'); },
      error: e => this.error.set(e?.error?.message || 'No se pudo eliminar'),
    });
  }

  cerrarEditor(): void {
    if (this.sucio() && !confirm('Hay cambios sin guardar. ¿Descartarlos?')) return;
    this.vistaEdit.set(null);
    this.sucio.set(false);
  }

  probarVista(v: Vista): void {
    const id = v.id || 'borrador';
    const m = this.muestra();
    this.prueba.set({
      origen: 'PANTALLA',
      guion: { id: 'prueba', oficina_id: null, nombre: v.nombre, descripcion: null, alcance: 'PANTALLAS', pasos: [{ vista_id: id, duracion_seg: 60, transicion: 'NINGUNA', transicion_ms: 0 }], al_llamar_vista_id: null, al_llamar_seg: 12, activo: true, pantallas: [], duracion_total_seg: 60, creado_en: '', actualizado_en: '' },
      vistas: [{ ...v, id }], playlists: m.playlists, url_turno: m.url_turno, firma: `prueba-${Date.now()}`,
    });
  }

  // ── Guiones ────────────────────────────────────────────────────────────

  nuevoGuion(): void {
    const primera = this.vistas()[0];
    this.guionEdit.set({
      id: '', oficina_id: this.ctx.oficinaId(), nombre: 'Guion de sala', descripcion: null, alcance: 'OFICINA',
      pasos: primera ? [{ vista_id: primera.id, duracion_seg: 30, transicion: 'FUNDIDO', transicion_ms: 600 }] : [],
      al_llamar_vista_id: null, al_llamar_seg: 12, activo: true, pantallas: [], duracion_total_seg: 0, creado_en: '', actualizado_en: '',
    });
    this.pestana.set('guiones');
  }

  editarGuion(g: Guion): void { this.guionEdit.set(structuredClone(g)); }

  guionCampo<K extends keyof Guion>(clave: K, valor: Guion[K]): void {
    this.guionEdit.update(g => (g ? { ...g, [clave]: valor } : g));
  }

  alternarPantalla(id: string): void {
    this.guionEdit.update(g => {
      if (!g) return g;
      const l = g.pantallas.includes(id) ? g.pantallas.filter(x => x !== id) : [...g.pantallas, id];
      return { ...g, pantallas: l };
    });
  }

  agregarPaso(vistaId: string): void {
    if (!vistaId) return;
    this.guionEdit.update(g => (g ? { ...g, pasos: [...g.pasos, { vista_id: vistaId, duracion_seg: 20, transicion: 'FUNDIDO', transicion_ms: 600 }] } : g));
  }

  quitarPaso(i: number): void { this.guionEdit.update(g => (g ? { ...g, pasos: g.pasos.filter((_, k) => k !== i) } : g)); }

  moverPaso(i: number, d: -1 | 1): void {
    this.guionEdit.update(g => {
      if (!g) return g;
      const j = i + d;
      if (j < 0 || j >= g.pasos.length) return g;
      const pasos = [...g.pasos];
      [pasos[i], pasos[j]] = [pasos[j], pasos[i]];
      return { ...g, pasos };
    });
  }

  pasoSet(i: number, cambios: Partial<Paso>): void {
    this.guionEdit.update(g => (g ? { ...g, pasos: g.pasos.map((p, k) => (k === i ? { ...p, ...cambios } : p)) } : g));
  }

  guardarGuion(): void {
    const g = this.guionEdit();
    if (!g || !g.nombre.trim()) return;
    if (!g.pasos.length) { this.error.set('El guion necesita al menos una vista'); return; }
    if (g.alcance === 'PANTALLAS' && !g.pantallas.length) { this.error.set('Elija al menos una pantalla o cambie el alcance a toda la oficina'); return; }
    const in_: GuionIn = {
      nombre: g.nombre, descripcion: g.descripcion, oficina_id: g.alcance === 'GLOBAL' ? null : this.ctx.oficinaId(), alcance: g.alcance,
      pasos: g.pasos, al_llamar_vista_id: g.al_llamar_vista_id, al_llamar_seg: g.al_llamar_seg, activo: g.activo,
      pantallas: g.alcance === 'PANTALLAS' ? g.pantallas : null,
    };
    this.ocupado.set(true);
    this.error.set(null);
    (g.id ? this.api.actualizarGuion(g.id, in_) : this.api.crearGuion(in_)).subscribe({
      next: n => { this.ocupado.set(false); this.guionEdit.set(n); this.avisar(g.id ? 'Guion guardado. Los televisores ya lo reproducen.' : 'Guion creado'); this.recargarGuiones(); },
      error: e => { this.ocupado.set(false); this.error.set(e?.error?.message || 'No se pudo guardar el guion'); },
    });
  }

  eliminarGuion(g: Guion): void {
    if (!confirm(`¿Eliminar el guion "${g.nombre}"? Las pantallas que lo usan volverán a su diseño anterior.`)) return;
    this.api.desactivarGuion(g.id).subscribe({
      next: () => { if (this.guionEdit()?.id === g.id) this.guionEdit.set(null); this.recargarGuiones(); this.avisar('Guion eliminado'); },
      error: e => this.error.set(e?.error?.message || 'No se pudo eliminar'),
    });
  }

  probarGuion(g: Guion): void {
    const ids = new Set<string>(g.pasos.map(p => p.vista_id));
    if (g.al_llamar_vista_id) ids.add(g.al_llamar_vista_id);
    const m = this.muestra();
    this.prueba.set({ origen: g.alcance === 'PANTALLAS' ? 'PANTALLA' : g.alcance, guion: { ...g, id: g.id || 'prueba' }, vistas: this.vistas().filter(v => ids.has(v.id)), playlists: m.playlists, url_turno: m.url_turno, firma: `prueba-${Date.now()}` });
  }

  // ── Vista previa ───────────────────────────────────────────────────────

  simularLlamado(): void {
    this.llamadoPrueba.set(turnoMuestra({ id: `ll-${Date.now()}`, codigo: `A-0${Math.floor(Math.random() * 90) + 10}`, estado: 'LLAMADO', punto_nombre: 'Módulo 2' }));
    setTimeout(() => this.llamadoPrueba.set(null), 12_000);
  }

  cerrarPrueba(): void { this.prueba.set(null); this.llamadoPrueba.set(null); }

  // ── Utilidades de plantilla ────────────────────────────────────────────

  nombreVista(id: string | null): string { return this.vistas().find(v => v.id === id)?.nombre ?? '(vista eliminada)'; }
  vistaPorId(id: string): Vista | null { return this.vistas().find(v => v.id === id) ?? null; }
  nombrePantalla(id: string): string { return this.pantallas().find(p => p.id === id)?.nombre ?? id; }
  nombreTransicion(t: Transicion): string { return TRANSICIONES.find(x => x.valor === t)?.nombre ?? t; }
  duracion(g: Guion): number { return g.pasos.reduce((s, p) => s + (p.duracion_seg || 0), 0); }
  relacion(v: Vista): string { return v.orientacion === 'VERTICAL' ? '9 / 16' : '16 / 9'; }
  alcanceNombre(a: AlcanceGuion): string { return a === 'GLOBAL' ? 'Todas las oficinas' : a === 'OFICINA' ? 'Toda la oficina' : 'Pantallas elegidas'; }
  origenNombre(o: string | null | undefined): string {
    return o === 'PANTALLA' ? 'asignado a la pantalla' : o === 'OFICINA' ? 'guion de la oficina' : o === 'GLOBAL' ? 'guion global' : 'plantilla fija';
  }
}
