import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, signal, untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Observable } from 'rxjs';

import { ReunionesService } from '../../services/reuniones.service';
import {
  Acuerdo, Grabacion, HablanteInsight, InsightsReunion, PASOS_PIPELINE, ReunionDetalle, SegmentoTranscripcion,
} from '../../models/reunion.model';
import { PanelHablantesComponent } from '../../components/panel-hablantes/panel-hablantes.component';
import { LineaTiempoComponent } from '../../components/linea-tiempo/linea-tiempo.component';
import { TranscripcionComponent } from '../../components/transcripcion/transcripcion.component';
import { LoHabladoComponent, PestanaHablado } from '../../components/lo-hablado/lo-hablado.component';
import { DetallesReunionComponent } from '../../components/detalles-reunion/detalles-reunion.component';
import { CapturaAudioComponent } from '../../components/captura-audio/captura-audio.component';
import { generarActaMarkdown, nombreArchivoActa } from '../../utils/acta';
import { analisisEnCurso, detenida, enCurso, pasoPipeline } from '../../utils/estado';
import { ordenarHablantes } from '../../utils/hablantes';
import { mensajeError } from '../../utils/texto';
import { duracionHumana, fechaCorta, reloj } from '../../utils/tiempo';
import { indiceSegmentoEn } from '../../utils/turnos';

type Vista = 'conversacion' | 'detalles';
type VistaMovil = 'transcripcion' | 'personas' | 'hablado';
type Lateral = 'personas' | 'hablado';
type EstadoVista = 'cargando' | 'error' | 'sin-grabacion' | 'procesando' | 'fallo' | 'lista';

/** Cada cuánto se pregunta por el avance mientras hay trabajo en curso. */
export const SONDEO_MS = 5000;
/** Tamaño de página de segmentos: el máximo que acepta ms-meetings. */
const PAGINA_SEGMENTOS = 500;
const VELOCIDADES = [1, 1.25, 1.5, 2, 0.75];

/**
 * Ficha de una reunión, centrada en la transcripción: quién habló (izquierda), la
 * conversación con el reproductor y la línea de tiempo por persona (centro) y lo que se
 * habló (derecha). Lo administrativo queda en la pestaña Detalles.
 *
 * Esta página ORQUESTA: carga detalle, insights y segmentos, lleva el audio, el sondeo y
 * los filtros, y hace las llamadas de identidad de hablantes. Los paneles son
 * componentes hijos en `components/`.
 *
 * El avance del pipeline se consulta por sondeo cada 5 s mientras haya trabajo (una
 * grabación procesándose o un análisis en curso) y se apaga solo al terminar y al salir.
 */
@Component({
  selector: 'app-reunion-detail',
  standalone: true,
  imports: [
    NgTemplateOutlet, RouterLink, MatIconModule, MatMenuModule, MatTooltipModule,
    PanelHablantesComponent, LineaTiempoComponent, TranscripcionComponent, LoHabladoComponent,
    DetallesReunionComponent, CapturaAudioComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reunion-detail.component.html',
  styleUrls: ['../../estilos/paleta-hablantes.css', '../../estilos/base.css', './reunion-detail.component.css'],
  host: { '[class.modo-espacio]': 'modoEspacio()' },
})
export class ReunionDetailComponent {
  private readonly api = inject(ReunionesService);
  private readonly destroyRef = inject(DestroyRef);

  /** Parámetro de ruta `:id` (withComponentInputBinding). */
  readonly id = input<string>('');
  /** Query param `?t=<ms>`: salto al abrir. */
  readonly t = input<string | undefined>(undefined);

  private readonly medio = viewChild<ElementRef<HTMLMediaElement>>('medio');
  private readonly transcripcionRef = viewChild(TranscripcionComponent);

  // ── Datos ─────────────────────────────────────────────────────────────────
  readonly detalle = signal<ReunionDetalle | null>(null);
  readonly insights = signal<InsightsReunion | null>(null);
  readonly grabaciones = signal<Grabacion[]>([]);
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly errorInsights = signal('');
  readonly aviso = signal('');

  readonly segmentos = signal<SegmentoTranscripcion[]>([]);
  readonly cargandoSegmentos = signal(false);
  readonly totalSegmentos = signal<number | null>(null);
  private segmentosDe: string | null = null;
  private cargaToken = 0;

  // ── Audio ─────────────────────────────────────────────────────────────────
  readonly urlMedio = signal<string | null>(null);
  readonly sinPermisoAudio = signal(false);
  readonly posicionMs = signal(0);
  readonly reproduciendo = signal(false);
  readonly velocidad = signal(1);
  private urlMedioDe: string | null = null;
  private reintentosMedio = 0;
  private pendienteMedio: number | null = null;
  private pendienteTexto: number | null = null;

  // ── Vista ─────────────────────────────────────────────────────────────────
  readonly vista = signal<Vista>('conversacion');
  readonly vistaMovil = signal<VistaMovil>('transcripcion');
  readonly lateral = signal<Lateral>('personas');
  readonly pestanaHablado = signal<PestanaHablado>('resumen');
  readonly resaltado = signal<{ id: string; vez: number } | null>(null);
  readonly filtroHablantes = signal<string[]>([]);
  readonly filtroTema = signal<string | null>(null);
  readonly hablanteOcupado = signal<string | null>(null);
  readonly reanalizando = signal(false);

  private sondeo: ReturnType<typeof setInterval> | null = null;
  private esperandoGrabacion: string | null = null;
  private vueltasEsperando = 0;
  private temporizadorAviso: ReturnType<typeof setTimeout> | null = null;
  private vecesResaltado = 0;
  private destruido = false;

  readonly PASOS = PASOS_PIPELINE;
  readonly reloj = reloj;
  readonly fechaCorta = fechaCorta;
  readonly duracionHumana = duracionHumana;

  // ── Derivados ─────────────────────────────────────────────────────────────
  private readonly esperando = signal(false);
  readonly hablantes = computed<HablanteInsight[]>(() => ordenarHablantes(this.insights()?.speakers ?? []));
  readonly participantes = computed(() => this.detalle()?.participants ?? []);
  readonly etapa = computed(() => this.insights()?.pipeline?.status ?? null);
  /** Quieta en una etapa intermedia con motivo (sin proveedor de transcripción…): no avanzará sola. */
  readonly detenida = computed(() => detenida(this.insights()?.pipeline));
  readonly procesando = computed(() => (enCurso(this.etapa()) && !this.detenida()) || this.esperando());
  readonly paso = computed(() => pasoPipeline(this.etapa() ?? 'UPLOADED'));

  readonly duracion = computed(() => {
    const d = this.insights()?.duration_ms ?? 0;
    const fin = this.segmentos().reduce((m, s) => Math.max(m, s.end_ms), 0);
    return Math.max(d, fin);
  });

  readonly grabacionVista = computed(() => {
    const id = this.insights()?.recording_id;
    return id ? this.grabaciones().find(g => g.id === id) ?? null : null;
  });
  readonly esVideo = computed(() => this.grabacionVista()?.kind === 'VIDEO');

  readonly estadoVista = computed<EstadoVista>(() => {
    const ins = this.insights();
    if (!ins) return this.errorInsights() ? 'error' : 'cargando';
    if (ins.recording_id && ins.transcript_status === 'LISTA') return 'lista';
    if (this.procesando()) return 'procesando';
    if (ins.pipeline?.status === 'FAILED' || ins.transcript_status === 'ERROR' || this.detenida()) return 'fallo';
    if (!ins.recording_id && !ins.pipeline?.status && !this.grabaciones().length) return 'sin-grabacion';
    if (ins.pipeline?.status === 'COMPLETED' || ins.pipeline?.status === 'PENDING_REVIEW') return 'fallo';
    return this.grabaciones().length ? 'procesando' : 'sin-grabacion';
  });

  /** Espacio de trabajo a pantalla completa (columnas con scroll propio) en escritorio. */
  readonly modoEspacio = computed(() => this.vista() === 'conversacion' && this.estadoVista() === 'lista');

  readonly hablandoAhora = computed(() => {
    if (!this.reproduciendo()) return null;
    const segs = this.segmentos();
    const i = indiceSegmentoEn(segs, this.posicionMs(), 0);
    return i >= 0 ? segs[i].speaker_id : null;
  });

  readonly puedeExportar = computed(() =>
    !!this.insights()?.recording_id && !this.cargandoSegmentos() && this.segmentos().length > 0);

  readonly acuerdosAbiertos = computed(() =>
    (this.insights()?.items ?? []).filter(i => i.status === 'ABIERTO' && (i.kind === 'COMPROMISO' || i.kind === 'PENDIENTE')).length);

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => this.iniciar(id));
    });
    effect(() => {
      const t = this.t();
      untracked(() => this.pedirSalto(t));
    });
    this.destroyRef.onDestroy(() => {
      this.destruido = true;
      this.detenerSondeo();
      this.cargaToken++;
      if (this.temporizadorAviso) clearTimeout(this.temporizadorAviso);
    });
  }

  // ── Carga ─────────────────────────────────────────────────────────────────

  private iniciar(id: string): void {
    if (!id) return;
    this.detenerSondeo();
    this.cargaToken++;
    this.detalle.set(null);
    this.insights.set(null);
    this.grabaciones.set([]);
    this.segmentos.set([]);
    this.segmentosDe = null;
    this.urlMedio.set(null);
    this.urlMedioDe = null;
    this.filtroHablantes.set([]);
    this.filtroTema.set(null);
    this.error.set('');
    this.errorInsights.set('');
    this.cargando.set(true);
    this.recargarDetalle();
    this.cargarInsights();
  }

  reintentar(): void { this.iniciar(this.id()); }

  reintentarInsights(): void {
    this.errorInsights.set('');
    this.cargarInsights();
  }

  recargarDetalle(): void {
    this.api.detalle(this.id()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (d) => {
        this.detalle.set(d);
        this.grabaciones.set(d.recordings ?? []);
        this.cargando.set(false);
        this.revisarMedio();
      },
      error: (e) => {
        this.error.set(mensajeError(e, 'No se pudo abrir la reunión'));
        this.cargando.set(false);
      },
    });
  }

  private cargarInsights(): void {
    this.api.insights(this.id()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (ins) => {
        this.errorInsights.set('');
        this.aplicarInsights(ins);
      },
      error: (e) => {
        const estado = (e as { status?: number } | null)?.status;
        if (estado === 401 || estado === 403 || estado === 404) {
          // La reunión ya no existe o dejó de ser visible (la borraron, cambió su ACL, venció
          // la sesión): seguir preguntando cada 5 s sólo repetiría el mismo error para siempre.
          this.esperandoGrabacion = null;
          this.esperando.set(false);
          this.reanalizando.set(false);
          this.insights.set(null);
          this.errorInsights.set(mensajeError(e, 'No se pudo cargar la conversación'));
          this.detenerSondeo();
          return;
        }
        if (!this.insights()) this.errorInsights.set(mensajeError(e, 'No se pudo cargar la conversación'));
        this.sincronizarSondeo();
      },
    });
  }

  private aplicarInsights(crudo: InsightsReunion): void {
    const previo = this.insights();
    const ins: InsightsReunion = {
      ...crudo,
      speakers: crudo.speakers ?? [],
      topics: (crudo.topics ?? []).map(t => ({ ...t, keywords: t.keywords ?? [], speakers: t.speakers ?? [] })),
      items: crudo.items ?? [],
    };
    this.insights.set(ins);

    if (this.reanalizando() && ins.analysis && !analisisEnCurso(ins.analysis.status)
        && (ins.analysis.version ?? 0) >= (previo?.analysis?.version ?? 0)) {
      this.reanalizando.set(false);
    }
    if (this.esperandoGrabacion) {
      this.vueltasEsperando++;
      const lista = ins.recording_id === this.esperandoGrabacion && ins.transcript_status === 'LISTA';
      if (lista || enCurso(ins.pipeline?.status) || ins.pipeline?.status === 'FAILED' || this.vueltasEsperando > 12) {
        this.esperandoGrabacion = null;
        this.esperando.set(false);
      }
    }
    if (ins.recording_id && ins.transcript_status === 'LISTA' && this.segmentosDe !== ins.recording_id) {
      this.cargarSegmentos(ins.recording_id);
    }
    this.revisarMedio();
    if (previo && enCurso(previo.pipeline?.status) && !enCurso(ins.pipeline?.status)) this.refrescarGrabaciones();
    this.sincronizarSondeo();
  }

  /** Trae TODOS los segmentos por páginas de 500 sin bloquear: la vista pinta cada página al llegar. */
  private cargarSegmentos(grabacionId: string): void {
    const token = ++this.cargaToken;
    this.segmentosDe = grabacionId;
    this.segmentos.set([]);
    this.totalSegmentos.set(null);
    this.cargandoSegmentos.set(true);

    const pagina = (n: number, acumulado: SegmentoTranscripcion[]) => {
      this.api.segmentos(grabacionId, n, PAGINA_SEGMENTOS).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (p) => {
          if (token !== this.cargaToken) return;
          const contenido = p.content ?? [];
          const todos = acumulado.concat(contenido);
          const totalPaginas = p.totalPages ?? p.page?.totalPages ?? 1;
          this.totalSegmentos.set(p.totalElements ?? p.page?.totalElements ?? todos.length);
          this.segmentos.set(todos);
          if (n + 1 < totalPaginas && contenido.length > 0) {
            pagina(n + 1, todos);
          } else {
            this.cargandoSegmentos.set(false);
          }
          this.aplicarPendienteTexto();
        },
        error: (e) => {
          if (token !== this.cargaToken) return;
          this.cargandoSegmentos.set(false);
          this.segmentosDe = null;
          this.error.set(mensajeError(e, 'No se pudo cargar la transcripción'));
        },
      });
    };
    pagina(0, []);
  }

  private refrescarGrabaciones(): void {
    this.api.grabaciones(this.id()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (gs) => { this.grabaciones.set(gs); this.revisarMedio(); },
      error: () => { /* una vuelta fallida del sondeo no molesta */ },
    });
  }

  // ── Sondeo ────────────────────────────────────────────────────────────────

  private sincronizarSondeo(): void {
    const ins = this.insights();
    const trabajando = this.esperandoGrabacion !== null
      || (enCurso(ins?.pipeline?.status) && !detenida(ins?.pipeline))
      || analisisEnCurso(ins?.analysis?.status)
      || this.reanalizando();
    if (trabajando && !this.sondeo) {
      this.sondeo = setInterval(() => { this.cargarInsights(); this.refrescarGrabaciones(); }, SONDEO_MS);
    } else if (!trabajando) {
      this.detenerSondeo();
    }
  }

  private detenerSondeo(): void {
    if (this.sondeo) { clearInterval(this.sondeo); this.sondeo = null; }
  }

  /** Se creó una grabación (subida o grabada): a esperar el pipeline. */
  alCrearGrabacion(grabacionId: string): void {
    this.esperandoGrabacion = grabacionId;
    this.vueltasEsperando = 0;
    this.esperando.set(true);
    this.vista.set('conversacion');
    this.refrescarGrabaciones();
    this.cargarInsights();
    this.sincronizarSondeo();
  }

  // ── Audio ─────────────────────────────────────────────────────────────────

  private revisarMedio(): void {
    const ins = this.insights();
    const id = ins?.recording_id;
    if (!id || this.urlMedioDe === id) return;
    const g = this.grabaciones().find(x => x.id === id);
    const listo = ins.transcript_status === 'LISTA' || !!g?.audio_ready || g?.status === 'COMPLETED';
    if (!listo) return;
    this.urlMedioDe = id;
    this.reintentosMedio = 0;
    this.pedirUrlMedio(id);
  }

  private async pedirUrlMedio(id: string): Promise<void> {
    try {
      const url = await this.api.urlDeMedia(id);
      if (this.urlMedioDe !== id) return;
      this.urlMedio.set(url);
      this.sinPermisoAudio.set(false);
    } catch {
      if (this.urlMedioDe !== id) return;
      this.urlMedio.set(null);
      this.sinPermisoAudio.set(true);
    }
  }

  alAvanzar(): void {
    const el = this.medio()?.nativeElement;
    if (el) this.posicionMs.set(Math.round(el.currentTime * 1000));
  }

  alCargarMedio(): void {
    const el = this.medio()?.nativeElement;
    if (!el) return;
    el.playbackRate = this.velocidad();
    if (this.pendienteMedio != null) {
      el.currentTime = this.pendienteMedio / 1000;
      this.pendienteMedio = null;
    }
  }

  /**
   * La URL firmada dura minutos: si vence a mitad de una reunión larga, el navegador falla
   * al pedir el siguiente rango. Se pide otra y se sigue donde iba (máximo dos veces).
   */
  alFallarMedio(): void {
    const id = this.urlMedioDe;
    if (!id || this.reintentosMedio >= 2) return;
    this.reintentosMedio++;
    this.pendienteMedio = this.posicionMs();
    this.pedirUrlMedio(id);
  }

  saltarA(ms: number, reproducir = true): void {
    const destino = Math.max(0, Math.round(ms));
    this.vista.set('conversacion');
    this.vistaMovil.set('transcripcion');
    this.posicionMs.set(destino);
    const el = this.medio()?.nativeElement;
    if (el && this.urlMedio()) {
      if (el.readyState >= 1) {
        el.currentTime = destino / 1000;
        if (reproducir) el.play().catch(() => { /* el navegador puede exigir un gesto */ });
      } else {
        this.pendienteMedio = destino;
      }
    }
    this.transcripcionRef()?.mostrarMinuto(destino);
  }

  retroceder(): void {
    const el = this.medio()?.nativeElement;
    if (!el) return;
    el.currentTime = Math.max(0, el.currentTime - 10);
    this.alAvanzar();
  }

  cambiarVelocidad(): void {
    const i = VELOCIDADES.indexOf(this.velocidad());
    const v = VELOCIDADES[(i + 1) % VELOCIDADES.length];
    this.velocidad.set(v);
    const el = this.medio()?.nativeElement;
    if (el) el.playbackRate = v;
  }

  etiquetaVelocidad(): string { return `${`${this.velocidad()}`.replace('.', ',')}×`; }

  /** `?t=` al abrir (o al volver a la misma reunión con otro minuto). */
  private pedirSalto(t: string | undefined): void {
    const ms = t != null ? Number.parseInt(t, 10) : NaN;
    if (!Number.isFinite(ms) || ms < 0) return;
    this.posicionMs.set(ms);
    this.pendienteTexto = ms;
    const el = this.medio()?.nativeElement;
    if (el && el.readyState >= 1) el.currentTime = ms / 1000;
    else this.pendienteMedio = ms;
    this.aplicarPendienteTexto();
  }

  private aplicarPendienteTexto(): void {
    const ms = this.pendienteTexto;
    if (ms == null) return;
    const segs = this.segmentos();
    const cubierto = segs.length > 0 && (segs[segs.length - 1].end_ms >= ms || !this.cargandoSegmentos());
    if (!cubierto) return;
    this.pendienteTexto = null;
    this.vistaMovil.set('transcripcion');
    // La transcripción puede no existir aún en el DOM en esta misma vuelta.
    setTimeout(() => { if (!this.destruido) this.transcripcionRef()?.mostrarMinuto(ms); });
  }

  // ── Filtros ───────────────────────────────────────────────────────────────

  alternarFiltroHablante(id: string): void {
    this.filtroHablantes.update(f => (f.includes(id) ? f.filter(x => x !== id) : [...f, id]));
    this.vistaMovil.set('transcripcion');
  }

  quitarFiltroHablante(id: string): void {
    this.filtroHablantes.update(f => f.filter(x => x !== id));
  }

  alternarFiltroTema(id: string): void {
    const nuevo = this.filtroTema() === id ? null : id;
    this.filtroTema.set(nuevo);
    this.vistaMovil.set('transcripcion');
    const tema = this.insights()?.topics.find(t => t.id === id);
    if (nuevo && tema) this.saltarA(tema.start_ms, false);
  }

  limpiarFiltros(): void {
    this.filtroHablantes.set([]);
    this.filtroTema.set(null);
  }

  // ── Identidad de hablantes ────────────────────────────────────────────────

  asignarHablante(ev: { hablanteId: string; participanteId: string | null }): void {
    this.accionHablante(ev.hablanteId, this.api.asignarHablante(ev.hablanteId, ev.participanteId),
      'No se pudo asignar la voz');
  }

  confirmarHablante(id: string): void {
    this.accionHablante(id, this.api.confirmarHablante(id), 'No se pudo confirmar la voz');
  }

  crearDesdeSugerencia(id: string): void {
    this.accionHablante(id, this.api.participanteDesdeSugerencia(id), 'No se pudo crear el participante', true);
  }

  private accionHablante(id: string, peticion: Observable<HablanteInsight>, fallo: string, recargarDetalle = false): void {
    this.hablanteOcupado.set(id);
    this.error.set('');
    peticion.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (h) => {
        this.hablanteOcupado.set(null);
        if (h && h.id) {
          this.insights.update(ins => ins
            ? { ...ins, speakers: ins.speakers.map(s => (s.id === h.id ? { ...s, ...h } : s)) }
            : ins);
        }
        // El nombre cambia también en acuerdos y temas: se relee todo (no los segmentos).
        this.cargarInsights();
        if (recargarDetalle) this.recargarDetalle();
      },
      error: (e) => {
        this.hablanteOcupado.set(null);
        this.error.set(mensajeError(e, fallo));
      },
    });
  }

  // ── Acuerdos, análisis y edición ──────────────────────────────────────────

  alGuardarAcuerdo(a: Acuerdo): void {
    this.insights.update(ins => {
      if (!ins) return ins;
      const existe = ins.items.some(x => x.id === a.id);
      return { ...ins, items: existe ? ins.items.map(x => (x.id === a.id ? a : x)) : [...ins.items, a] };
    });
  }

  alEliminarAcuerdo(id: string): void {
    this.insights.update(ins => (ins ? { ...ins, items: ins.items.filter(x => x.id !== id) } : ins));
  }

  verAcuerdo(id: string): void {
    this.resaltado.set({ id, vez: ++this.vecesResaltado });
    this.pestanaHablado.set('acuerdos');
    this.vistaMovil.set('hablado');
    this.lateral.set('hablado');
  }

  reanalizar(): void {
    this.reanalizando.set(true);
    this.error.set('');
    this.api.analizar(this.id()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (a) => {
        if (a) this.insights.update(ins => (ins ? { ...ins, analysis: a } : ins));
        this.sincronizarSondeo();
      },
      error: (e) => {
        this.reanalizando.set(false);
        this.error.set(mensajeError(e, 'No se pudo volver a analizar la conversación'));
      },
    });
  }

  alActualizarSegmento(s: SegmentoTranscripcion): void {
    this.segmentos.update(lista => lista.map(x => (x.id === s.id ? s : x)));
  }

  // ── Acta ──────────────────────────────────────────────────────────────────

  private acta(): { texto: string; archivo: string } | null {
    const d = this.detalle();
    const ins = this.insights();
    if (!d || !ins) return null;
    const texto = generarActaMarkdown({
      reunion: { code: d.resumen.code, name: d.resumen.name, held_on: d.resumen.held_on, objective: d.objective },
      insights: ins,
      segmentos: this.segmentos(),
      participantes: d.participants,
    });
    return { texto, archivo: nombreArchivoActa(d.resumen.code, d.resumen.name) };
  }

  descargarActa(): void {
    const a = this.acta();
    if (!a) return;
    const blob = new Blob([a.texto], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = a.archivo;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    this.avisar('Acta descargada');
  }

  async copiarActa(): Promise<void> {
    const a = this.acta();
    if (!a) return;
    try {
      await navigator.clipboard.writeText(a.texto);
      this.avisar('Acta copiada. Pégala en un correo o documento.');
    } catch {
      // Sin permiso de portapapeles (o contexto inseguro): se usa el método clásico.
      const area = document.createElement('textarea');
      area.value = a.texto;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      this.avisar(ok ? 'Acta copiada. Pégala en un correo o documento.' : 'No se pudo copiar. Usa "Descargar".');
    }
  }

  private avisar(texto: string): void {
    this.aviso.set(texto);
    if (this.temporizadorAviso) clearTimeout(this.temporizadorAviso);
    this.temporizadorAviso = setTimeout(() => this.aviso.set(''), 4000);
  }
}
