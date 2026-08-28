import {
  Component, ChangeDetectionStrategy, OnInit, OnDestroy, ElementRef, inject, signal, computed
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import Swal from 'sweetalert2';
import {
  TrainingS, PaqueteCurso, LeccionOffline, PreguntaPresentacion, RecursoOffline,
  RespuestaEnviada, BloqueOffline
} from '../../service/training-s';
import { TrainingOffline } from '../../service/training-offline';
import { TutorIaService } from '../../service/tutor-ia.service';

/**
 * El curso: índice de lecciones, visor y quiz.
 *
 * Todo lo que se ve aquí sale de UN payload (`/me/enrollments/{id}/content`) que el
 * interceptor deja cacheado en IndexedDB. Esa es la razón de que la pantalla no pida nada más
 * al navegar entre lecciones: en finca, cada petición extra es una oportunidad de quedarse a
 * medias.
 *
 * Marcar una lección y responder un quiz SÍ escriben, y funcionan sin señal: el interceptor
 * las encola y el `client_event_id` evita que se cuenten dos veces al reintentar.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-course-player',
  imports: [CommonModule, MatIconModule, MatProgressBarModule],
  templateUrl: './course-player.html',
  styleUrl: './course-player.css'
})
export class CoursePlayer implements OnInit, OnDestroy {
  private api = inject(TrainingS);
  private ruta = inject(ActivatedRoute);
  private router = inject(Router);
  private sanitizer = inject(DomSanitizer);
  private tutor = inject(TutorIaService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly offline = inject(TrainingOffline);

  readonly paquete = signal<PaqueteCurso | null>(null);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly leccionActivaId = signal<string | null>(null);
  readonly indiceAbierto = signal(false);
  readonly guardando = signal(false);

  /** Respuestas del quiz en curso: preguntaId -> opcionIds elegidas. */
  readonly respuestas = signal<Record<string, string[]>>({});
  readonly resultadoQuiz = signal<{ nota: number; correctas: number; total: number } | null>(null);

  /**
   * En qué pregunta va, cuando el quiz se responde de a una.
   *
   * Las respuestas SIGUEN enviándose todas juntas al final: el quiz se contesta sin conexión y
   * una petición por pregunta rompería eso. "De a una" es cómo se ve, no cómo se envía.
   */
  readonly indicePregunta = signal(0);
  /** Preguntas ya confirmadas. Una confirmada muestra su corrección y no se puede cambiar. */
  readonly confirmadas = signal<Set<string>>(new Set());

  /** Material de las preguntas ya descargado: preguntaId -> object URL. */
  readonly mediaPreguntas = signal<Record<string, string>>({});

  /** Material ya descargado en esta sesión: id del recurso -> object URL del blob. */
  readonly materiales = signal<Record<string, string>>({});
  readonly descargandoMaterial = signal<string | null>(null);

  /**
   * Salto pendiente pedido por el tutor: recurso y segundo.
   *
   * Existe porque el vídeo se carga con `preload="none"` para no gastar el plan de datos de
   * quien está en finca, y un vídeo sin metadatos ignora que le fijen `currentTime`. Mientras
   * hay un salto pendiente ESE vídeo —solo ese— pasa a `preload="metadata"`.
   */
  readonly saltoPendiente = signal<{ recursoId: string; segundos: number } | null>(null);

  private enrollmentId = '';

  readonly lecciones = computed<LeccionOffline[]>(() =>
    (this.paquete()?.modulos ?? []).flatMap(m => m.lecciones)
  );

  readonly leccion = computed<LeccionOffline | null>(() => {
    const id = this.leccionActivaId();
    return this.lecciones().find(l => l.id === id) ?? this.lecciones()[0] ?? null;
  });

  readonly completadas = computed(() =>
    this.lecciones().filter(l => l.estado === 'COMPLETADA').length
  );

  async ngOnInit(): Promise<void> {
    this.enrollmentId = this.ruta.snapshot.paramMap.get('enrollmentId') ?? '';
    await this.cargar();
    await this.offline.refrescarPendientes();

    // Los saltos del tutor llegan por queryParams y no por estado compartido: así el enlace
    // sigue funcionando si se recarga la página o se pega en otro sitio. Se escucha el flujo
    // (no el snapshot) porque el tutor puede mandar otro salto con el curso ya abierto, y ahí
    // Angular reutiliza el componente sin volver a construirlo.
    this.ruta.queryParamMap.subscribe(q => {
      const leccionId = q.get('leccion');
      if (leccionId) void this.saltarA(leccionId, Number(q.get('t') ?? 0));
    });
  }

  ngOnDestroy(): void {
    // El tutor deja de dar por hecho que se está viendo este curso.
    this.tutor.contexto.set(null);
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const p = await this.api.paqueteDelCurso(this.enrollmentId);
      this.paquete.set(p);
      // Se abre donde la persona se quedó, no en la primera: retomar es el caso normal.
      const pendiente = p.modulos.flatMap(m => m.lecciones).find(l => l.estado !== 'COMPLETADA');
      this.leccionActivaId.set((pendiente ?? p.modulos[0]?.lecciones[0])?.id ?? null);
      this.publicarContexto();
    } catch {
      this.error.set('No pudimos abrir el curso. Conéctate una vez para descargarlo y '
        + 'después podrás estudiarlo sin internet.');
    } finally {
      this.cargando.set(false);
    }
  }

  /**
   * Descarga el material y lo deja listo para verse.
   *
   * Necesita conexión: el interceptor no cachea respuestas binarias, así que el archivo solo
   * queda como object URL mientras esta pantalla siga abierta. Se baja bajo demanda y no al
   * abrir la lección porque un video de 40 MB bajado sin que nadie lo pida es el plan de datos
   * de la persona.
   */
  async abrirMaterial(recurso: RecursoOffline): Promise<void> {
    if (this.materiales()[recurso.id]) {
      this.mostrar(recurso, this.materiales()[recurso.id]);
      return;
    }
    this.descargandoMaterial.set(recurso.id);
    try {
      const blob = await this.api.descargarMaterial(recurso.id);
      const url = URL.createObjectURL(blob);
      this.materiales.update(m => ({ ...m, [recurso.id]: url }));
      this.mostrar(recurso, url);
    } catch {
      Swal.fire('No pudimos abrir el material',
        this.offline.enLinea
          ? 'Intenta de nuevo en un momento.'
          : 'Necesitas conexión para abrir este material. Mientras no cierres el curso queda listo para volver a verlo.',
        'info');
    } finally {
      this.descargandoMaterial.set(null);
    }
  }

  /** El video se ve en la página; lo demás se abre aparte, que es lo que espera la gente. */
  private mostrar(recurso: RecursoOffline, url: string): void {
    if (recurso.tipo !== 'VIDEO') {
      window.open(url, '_blank');
    }
  }

  urlMaterial(recursoId: string): string | null {
    return this.materiales()[recursoId] ?? null;
  }

  // ── Recorrido de la lección ───────────────────────────────────────────────

  /**
   * Los bloques de la lección, en orden.
   *
   * Si el paquete viene SIN bloques se arma uno equivalente al vuelo con las listas planas.
   * Pasa con lo que quedó cacheado en IndexedDB antes de este cambio: la persona en finca
   * puede llevar días sin conectarse, y no puede quedarse mirando una lección vacía hasta que
   * vuelva a tener señal.
   */
  bloquesDe(l: LeccionOffline): BloqueOffline[] {
    if (l.bloques?.length) return l.bloques;

    const derivados: BloqueOffline[] = [];
    let orden = 0;
    if (l.contenido?.trim()) {
      derivados.push({ id: `${l.id}-texto`, tipo: 'TEXTO', orden: orden++, contenido: l.contenido });
    }
    for (const r of l.recursos ?? []) {
      derivados.push({
        id: `${l.id}-r-${r.id}`,
        tipo: r.tipo === 'VIDEO' ? 'VIDEO' : (r.url ? 'ENLACE' : 'DOCUMENTO'),
        titulo: r.nombre, orden: orden++, recurso: r
      });
    }
    for (const a of l.actividades ?? []) {
      derivados.push({ id: `${l.id}-a-${a.id}`, tipo: 'ACTIVIDAD', titulo: a.titulo,
                       orden: orden++, actividad: a });
    }
    if (l.quiz) {
      derivados.push({ id: `${l.id}-q`, tipo: 'QUIZ', orden: orden++, quiz: l.quiz });
    }
    return derivados;
  }

  iconoBloque(tipo: string): string {
    switch (tipo) {
      case 'TEXTO':        return 'notes';
      case 'VIDEO':        return 'play_circle';
      case 'PRESENTACION': return 'slideshow';
      case 'IMAGEN':       return 'image';
      case 'ENLACE':       return 'link';
      case 'ACTIVIDAD':    return 'assignment_turned_in';
      case 'QUIZ':         return 'quiz';
      default:             return 'description';
    }
  }

  seleccionar(leccion: LeccionOffline): void {
    this.leccionActivaId.set(leccion.id);
    this.respuestas.set({});
    this.resultadoQuiz.set(null);
    this.indicePregunta.set(0);
    this.confirmadas.set(new Set());
    this.indiceAbierto.set(false);
    this.publicarContexto();
  }

  /**
   * Le dice al tutor flotante qué se está viendo.
   *
   * Sin esto, preguntar "¿y esto cómo se hace?" con una clase abierta obligaría al backend a
   * rebuscar en todos los cursos de la persona, y la respuesta saldría del curso equivocado.
   */
  private publicarContexto(): void {
    const p = this.paquete();
    this.tutor.contexto.set(p
      ? { course_version_id: p.course_version_id, lesson_id: this.leccionActivaId() }
      : null);
  }

  // ── Saltos del tutor ──────────────────────────────────────────────────────

  /** Abre la lección, baja su vídeo si hace falta y lo deja sonando en el segundo pedido. */
  private async saltarA(leccionId: string, segundos: number): Promise<void> {
    const leccion = this.lecciones().find(l => l.id === leccionId);
    if (!leccion) return;
    if (this.leccionActivaId() !== leccionId) this.seleccionar(leccion);

    // Solo los archivos servidos por learning-ms: un enlace externo se abre en otra pestaña y
    // ahí no hay ningún elemento <video> al que pedirle nada. Se busca por el recorrido y no
    // por la lista plana para saltar al PRIMER video tal como lo ve la persona.
    const recurso = this.bloquesDe(leccion)
      .map(b => b.recurso)
      .find((r): r is RecursoOffline => !!r && r.tipo === 'VIDEO' && !r.url);
    if (!recurso) return;

    this.saltoPendiente.set({ recursoId: recurso.id, segundos: Math.max(0, segundos || 0) });
    if (!this.urlMaterial(recurso.id)) {
      await this.abrirMaterial(recurso);
    }
    // Un turno de reloj para que Angular pinte el <video> con la url recién creada. Se busca
    // en el DOM del propio componente en vez de con una consulta de vista porque el elemento
    // nace dentro de dos bloques @if anidados y la consulta llegaría vacía en este instante.
    setTimeout(() => this.aplicarSalto(), 0);
  }

  private aplicarSalto(): void {
    const salto = this.saltoPendiente();
    if (!salto) return;
    const video = this.host.nativeElement.querySelector<HTMLVideoElement>(
      `video[data-recurso="${salto.recursoId}"]`);
    if (!video) return;

    const colocar = () => {
      video.currentTime = salto.segundos;
      void video.play().catch(() => { /* el navegador puede exigir un gesto: queda posicionado */ });
      this.saltoPendiente.set(null);
    };
    // readyState >= HAVE_METADATA: ya sabe cuánto dura y acepta que le fijen el segundo.
    if (video.readyState >= 1) {
      colocar();
    } else {
      video.addEventListener('loadedmetadata', colocar, { once: true });
      video.load();
    }
  }

  /** Segundos en mm:ss, para decir "minuto 3:20" y no "segundo 200". */
  minuto(segundos?: number | null): string {
    const t = Math.max(0, Math.floor(segundos ?? 0));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }

  /** El vídeo al que hay que saltar sí carga metadatos; el resto sigue sin gastar datos. */
  precargaDe(recursoId: string): 'metadata' | 'none' {
    return this.saltoPendiente()?.recursoId === recursoId ? 'metadata' : 'none';
  }

  volver(): void {
    this.router.navigate(['/dashboard/capacitaciones']);
  }

  urlSegura(url: string): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  // ── Progreso ──────────────────────────────────────────────────────────────

  /**
   * Marca la lección como vista. Funciona sin señal: el interceptor encola el PUT y el
   * `client_event_id` impide que un reintento la cuente dos veces.
   */
  async completar(leccion: LeccionOffline): Promise<void> {
    if (leccion.estado === 'COMPLETADA' || this.guardando()) return;
    this.guardando.set(true);
    const idEvento = this.offline.idDeEvento('progreso', leccion.id);
    try {
      await this.api.guardarProgreso(leccion.id, {
        client_event_id: idEvento,
        porcentaje: 100,
        completada: true,
        ocurrido_at: this.offline.ahora()
      });
      this.offline.confirmar('progreso', leccion.id);
      this.marcarLocalmente(leccion.id);
      await this.offline.refrescarPendientes();
    } catch {
      // Encolada por el interceptor: para la persona SÍ quedó hecho, y hay que decírselo así.
      this.marcarLocalmente(leccion.id);
      await this.offline.refrescarPendientes();
      Swal.fire('Guardado en el teléfono',
        'No hay conexión ahora. Tu avance se envía solo cuando vuelvas a tener internet.',
        'info');
    } finally {
      this.guardando.set(false);
    }
  }

  /** Refleja el avance en pantalla sin volver a pedir el paquete: offline no hay a quién pedirle. */
  private marcarLocalmente(lessonId: string): void {
    this.paquete.update(p => {
      if (!p) return p;
      return {
        ...p,
        modulos: p.modulos.map(m => ({
          ...m,
          lecciones: m.lecciones.map(l =>
            l.id === lessonId ? { ...l, estado: 'COMPLETADA', porcentaje: 100 } : l)
        }))
      };
    });
  }

  // ── Quiz ──────────────────────────────────────────────────────────────────

  elegir(pregunta: PreguntaPresentacion, opcionId: string): void {
    // Una vez confirmada ya se vio la corrección: dejar cambiarla sería dejar "acertar"
    // después de ver la respuesta.
    if (this.confirmada(pregunta)) return;
    this.respuestas.update(actual => {
      const previas = actual[pregunta.id] ?? [];
      if (pregunta.tipo === 'OPCION_MULTIPLE') {
        const yaEstaba = previas.includes(opcionId);
        return {
          ...actual,
          [pregunta.id]: yaEstaba ? previas.filter(o => o !== opcionId) : [...previas, opcionId]
        };
      }
      return { ...actual, [pregunta.id]: [opcionId] };
    });
  }

  elegida(preguntaId: string, opcionId: string): boolean {
    return (this.respuestas()[preguntaId] ?? []).includes(opcionId);
  }

  // ── Quiz de a una pregunta ────────────────────────────────────────────────

  get quiz() {
    return this.leccion()?.quiz ?? null;
  }

  get unaPorUna(): boolean {
    return this.quiz?.modo_presentacion === 'UNA_POR_UNA';
  }

  /** Las que se pintan ahora: todas, o solo la que toca. */
  get preguntasVisibles(): PreguntaPresentacion[] {
    const q = this.quiz;
    if (!q) return [];
    if (!this.unaPorUna) return q.preguntas;
    const p = q.preguntas[this.indicePregunta()];
    return p ? [p] : [];
  }

  get puedeVolver(): boolean {
    return this.unaPorUna && !!this.quiz?.permite_volver && this.indicePregunta() > 0;
  }

  get esUltimaPregunta(): boolean {
    return !this.unaPorUna || this.indicePregunta() >= (this.quiz?.preguntas.length ?? 1) - 1;
  }

  /**
   * Baja la foto o el vídeo sobre el que se pregunta.
   *
   * Se pide por la pregunta y no por el document_id: el proxy comprueba que esta persona
   * alcance esa pregunta. Sin material, la pregunta no se puede responder, así que se baja al
   * mostrarla y no bajo demanda como el material de una lección.
   */
  async cargarMediaDe(p: PreguntaPresentacion): Promise<void> {
    if (!p.tiene_archivo || this.mediaPreguntas()[p.id]) return;
    try {
      const blob = await this.api.descargarMediaDePregunta(p.id);
      const url = URL.createObjectURL(blob);
      this.mediaPreguntas.update(m => ({ ...m, [p.id]: url }));
    } catch { /* sin señal se queda sin la imagen; el enunciado se sigue viendo */ }
  }

  mediaDe(p: PreguntaPresentacion): string | null {
    return p.media_url ?? this.mediaPreguntas()[p.id] ?? null;
  }

  confirmada(p: PreguntaPresentacion): boolean {
    return this.confirmadas().has(p.id);
  }

  /**
   * Fija la respuesta de la pregunta actual y muestra la corrección.
   *
   * Se compara CONTRA EL PAQUETE, sin red: es la razón por la que las correctas viajan en él
   * cuando el quiz lo permite. Si no las trae, se confirma sin decir nada y la nota llega al
   * final, como siempre.
   */
  confirmar(p: PreguntaPresentacion): void {
    if (this.confirmada(p)) return;
    this.confirmadas.update(s => new Set(s).add(p.id));
  }

  siguientePregunta(p: PreguntaPresentacion): void {
    this.confirmar(p);
    if (!this.esUltimaPregunta) this.indicePregunta.update(i => i + 1);
  }

  preguntaAnterior(): void {
    if (this.puedeVolver) this.indicePregunta.update(i => i - 1);
  }

  /** null = el quiz no revela nada; true/false = acertó o no. */
  acerto(p: PreguntaPresentacion): boolean | null {
    if (!p.opciones_correctas) return null;
    const marcadas = [...(this.respuestas()[p.id] ?? [])].sort();
    const correctas = [...p.opciones_correctas].sort();
    return marcadas.length === correctas.length
        && marcadas.every((o, i) => o === correctas[i]);
  }

  esCorrecta(p: PreguntaPresentacion, opcionId: string): boolean {
    return (p.opciones_correctas ?? []).includes(opcionId);
  }

  /**
   * Lleva a la persona al bloque donde se explica lo que falló.
   *
   * Si es un vídeo lo abre y salta al segundo; si no, desplaza hasta el bloque. Es el atajo
   * que convierte un "incorrecta" en algo que se puede repasar sin buscar por toda la lección.
   */
  async verDondeSeExplica(p: PreguntaPresentacion): Promise<void> {
    const l = this.leccion();
    if (!l || !p.bloque_id) return;
    const bloque = this.bloquesDe(l).find(b => b.id === p.bloque_id);
    if (!bloque) return;

    const r = bloque.recurso;
    if (bloque.tipo === 'VIDEO' && r && !r.url) {
      this.saltoPendiente.set({ recursoId: r.id, segundos: Math.max(0, p.segundo ?? 0) });
      if (!this.urlMaterial(r.id)) await this.abrirMaterial(r);
      setTimeout(() => this.aplicarSalto(), 0);
    }
    setTimeout(() => {
      this.host.nativeElement
        .querySelector(`[data-bloque="${bloque.id}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
  }

  get quizCompleto(): boolean {
    const quiz = this.quiz;
    if (!quiz) return false;
    return quiz.preguntas.every(p => (this.respuestas()[p.id] ?? []).length > 0);
  }

  async enviarQuiz(): Promise<void> {
    const leccion = this.leccion();
    const quiz = leccion?.quiz;
    if (!quiz || !leccion || this.guardando()) return;

    this.guardando.set(true);
    const idEvento = this.offline.idDeEvento('quiz', quiz.quiz_id);
    const respuestas: RespuestaEnviada[] = quiz.preguntas.map(p => ({
      question_id: p.id,
      option_ids: this.respuestas()[p.id] ?? []
    }));

    try {
      const resultado = await this.api.responderQuiz(quiz.quiz_id, idEvento, respuestas);
      this.offline.confirmar('quiz', quiz.quiz_id);
      this.resultadoQuiz.set({
        nota: resultado.nota,
        correctas: resultado.preguntas_correctas,
        total: resultado.preguntas_totales
      });
    } catch {
      await this.offline.refrescarPendientes();
      Swal.fire('Respuestas guardadas',
        'No hay conexión ahora. Tus respuestas se envían solas cuando vuelvas a tener internet, '
        + 'y ahí verás la calificación.',
        'info');
    } finally {
      this.guardando.set(false);
      await this.offline.refrescarPendientes();
    }
  }
}
