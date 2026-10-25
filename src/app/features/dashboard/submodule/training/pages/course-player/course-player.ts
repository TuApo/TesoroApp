import { BloqueFicha } from '../../components/bloque-ficha/bloque-ficha';
import { BloqueYoutube } from '../../components/bloque-youtube/bloque-youtube';
import { ResolverEjercicio } from '../../components/codigo/resolver-ejercicio';
import { ResultadoPruebas } from '../../components/codigo/resultado-pruebas';
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
  RespuestaEnviada, BloqueOffline, CitaMaterial, OpcionPresentacion, Boletin, ItemBoletin,
  RequisitoBoletin, QuizPresentacion, Comentario, ModuloOffline, DetalleRespuesta, ResultadoIntento,
  Actividad, EntregaMia
} from '../../service/training-s';
import { TrainingAdminService } from '../../service/training-admin.service';
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
  imports: [CommonModule, MatIconModule, MatProgressBarModule, BloqueFicha, BloqueYoutube, ResolverEjercicio, ResultadoPruebas],
  templateUrl: './course-player.html',
  styleUrl: './course-player.css'
})
export class CoursePlayer implements OnInit, OnDestroy {
  private api = inject(TrainingS);
  private adminApi = inject(TrainingAdminService);
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

  /**
   * Vista previa: el curso sin matrícula, para quien lo arma. Nada se guarda —ni progreso, ni
   * intentos, ni entregas—; el quiz se puede recorrer y ver la corrección local.
   */
  readonly preview = signal(false);
  private courseId = '';
  private versionId = '';

  /** Respuestas del quiz en curso: preguntaId -> opcionIds elegidas. */
  readonly respuestas = signal<Record<string, string[]>>({});
  /** Resultado por quiz (una lección puede tener varios): quizId -> resultado con su detalle. */
  readonly resultados = signal<Record<string, ResultadoLocal>>({});

  /**
   * En qué pregunta va cada quiz, cuando se responde de a una: quizId -> índice.
   *
   * Las respuestas SIGUEN enviándose todas juntas al final: el quiz se contesta sin conexión y
   * una petición por pregunta rompería eso. "De a una" es cómo se ve, no cómo se envía.
   */
  readonly indices = signal<Record<string, number>>({});
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
    this.courseId = this.ruta.snapshot.paramMap.get('courseId') ?? '';
    this.versionId = this.ruta.snapshot.paramMap.get('versionId') ?? '';
    this.preview.set(!!this.versionId);
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
      const p = this.preview()
        ? await this.adminApi.previsualizarVersion(this.courseId, this.versionId)
        : await this.api.paqueteDelCurso(this.enrollmentId);
      this.paquete.set(p);
      // Se abre donde la persona se quedó, no en la primera: retomar es el caso normal.
      const pendiente = p.modulos.flatMap(m => m.lecciones).find(l => l.estado !== 'COMPLETADA');
      this.leccionActivaId.set((pendiente ?? p.modulos[0]?.lecciones[0])?.id ?? null);
      this.publicarContexto();
      void this.cargarEntregasDeCodigo();
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
    if (recurso.tipo !== 'VIDEO' && recurso.tipo !== 'AUDIO') {
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
      case 'AUDIO':        return 'headphones';
      case 'YOUTUBE':      return 'smart_display';
      case 'FICHA':        return 'style';
      default:             return 'description';
    }
  }

  seleccionar(leccion: LeccionOffline): void {
    this.leccionActivaId.set(leccion.id);
    this.respuestas.set({});
    this.resultados.set({});
    this.indices.set({});
    this.confirmadas.set(new Set());
    this.indiceAbierto.set(false);
    this.publicarContexto();
    void this.cargarComentarios();
    void this.cargarEntregasDeCodigo();
    // Arriba del todo: en el celular, cambiar de lección con el scroll a mitad deja a la
    // persona mirando el final de la clase nueva.
    this.host.nativeElement.querySelector('.cp-leccion')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  /** Las lecciones en orden plano, para "anterior / siguiente". */
  readonly indiceLeccion = computed(() =>
    this.lecciones().findIndex(l => l.id === this.leccion()?.id));

  readonly porcentajeCurso = computed(() =>
    Math.round(this.completadas() * 100 / (this.lecciones().length || 1)));

  /** Módulos plegados en el temario. Lo que no está aquí se ve desplegado. */
  readonly modulosPlegados = signal<ReadonlySet<string>>(new Set());

  moduloPlegado(id: string): boolean {
    return this.modulosPlegados().has(id);
  }

  alternarModulo(id: string): void {
    this.modulosPlegados.update(s => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  progresoModulo(m: ModuloOffline): { hechas: number; total: number; pct: number } {
    const total = m.lecciones.length;
    const hechas = m.lecciones.filter(l => l.estado === 'COMPLETADA').length;
    return { hechas, total, pct: total ? Math.round(hechas * 100 / total) : 0 };
  }

  moduloDe(l: LeccionOffline): ModuloOffline | null {
    return this.paquete()?.modulos.find(m => m.lecciones.some(x => x.id === l.id)) ?? null;
  }

  numeroModuloDe(l: LeccionOffline): number {
    const mods = this.paquete()?.modulos ?? [];
    return mods.findIndex(m => m.lecciones.some(x => x.id === l.id)) + 1;
  }

  nombreBloque(tipo: string): string {
    switch (tipo) {
      case 'TEXTO':        return 'Lectura';
      case 'VIDEO':        return 'Vídeo';
      case 'DOCUMENTO':    return 'Documento';
      case 'PRESENTACION': return 'Presentación';
      case 'IMAGEN':       return 'Imagen';
      case 'ENLACE':       return 'Enlace';
      case 'ACTIVIDAD':    return 'Actividad';
      case 'QUIZ':         return 'Quiz';
      case 'AUDIO':        return 'Audio';
      case 'YOUTUBE':      return 'Video de YouTube';
      case 'FICHA':        return 'Fichas de repaso';
      default:             return 'Material';
    }
  }

  /** Desplaza hasta el bloque, que es lo que hace el paso del recorrido al tocarlo. */
  irAlBloque(id: string): void {
    this.host.nativeElement.querySelector(`[data-bloque="${id}"]`)
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  /**
   * El gesto de un curso: cerrar la lección y pasar a la siguiente. Si era la última, se
   * da por terminado el contenido y se abre la calificación.
   */
  async completarYContinuar(l: LeccionOffline): Promise<void> {
    await this.completar(l);
    const sig = this.siguienteLeccion;
    if (sig) {
      this.seleccionar(sig);
    } else {
      await this.terminarCurso();
    }
  }

  async terminarCurso(): Promise<void> {
    if (this.preview()) {
      await Swal.fire('Fin de la vista previa', 'Así termina el curso para quien lo curse.', 'info');
      return;
    }
    await Swal.fire({
      title: '¡Terminaste el contenido!',
      text: 'Revisa tu calificación: si cumples todo, el curso queda aprobado y el certificado aparece en "Mis certificados".',
      icon: 'success', confirmButtonText: 'Ver mi calificación',
    });
    if (!this.boletinAbierto()) await this.alternarBoletin();
    this.host.nativeElement.querySelector('.boletin')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  get anteriorLeccion(): LeccionOffline | null {
    const i = this.indiceLeccion();
    return i > 0 ? this.lecciones()[i - 1] : null;
  }

  get siguienteLeccion(): LeccionOffline | null {
    const i = this.indiceLeccion();
    return i >= 0 && i < this.lecciones().length - 1 ? this.lecciones()[i + 1] : null;
  }

  /** Cuántos bloques trae la lección, por tipo, para el temario. */
  resumenDe(l: LeccionOffline): string {
    const b = this.bloquesDe(l);
    const partes: string[] = [];
    const n = (t: string) => b.filter(x => x.tipo === t).length;
    if (n('VIDEO')) partes.push(`${n('VIDEO')} vídeo`);
    if (n('QUIZ')) partes.push(`${n('QUIZ')} quiz`);
    if (n('ACTIVIDAD')) partes.push(`${n('ACTIVIDAD')} actividad`);
    if (l.duracion_min) partes.push(`${l.duracion_min} min`);
    return partes.join(' · ');
  }

  // ── Comentarios de la clase ───────────────────────────────────────────────

  readonly comentarios = signal<Comentario[]>([]);
  readonly cargandoComentarios = signal(false);
  readonly comentariosAbiertos = signal(false);
  readonly nuevoComentario = signal('');
  /** El hilo al que se está respondiendo, y lo escrito. null = ninguno. */
  readonly respondiendoA = signal<string | null>(null);
  readonly textoRespuesta = signal('');
  readonly enviandoComentario = signal(false);

  readonly totalComentarios = computed(() =>
    this.comentarios().reduce((n, c) => n + 1 + (c.respuestas?.length ?? 0), 0));

  /**
   * Los comentarios necesitan conexión y se piden aparte del paquete: no se cachean offline
   * (cambian a cada rato) y sin señal la sección simplemente no aparece.
   */
  async cargarComentarios(): Promise<void> {
    const l = this.leccion();
    this.comentarios.set([]);
    this.respondiendoA.set(null);
    if (!l || !this.offline.enLinea) return;
    this.cargandoComentarios.set(true);
    try {
      this.comentarios.set(await this.api.comentarios(l.id));
    } catch {
      this.comentarios.set([]);
    } finally {
      this.cargandoComentarios.set(false);
    }
  }

  async comentar(): Promise<void> {
    const l = this.leccion();
    const texto = this.nuevoComentario().trim();
    if (!l || !texto || this.enviandoComentario()) return;
    this.enviandoComentario.set(true);
    try {
      await this.api.comentar(l.id, texto);
      this.nuevoComentario.set('');
      await this.cargarComentarios();
    } catch (e: any) {
      Swal.fire('No se pudo comentar', e?.error?.message ?? 'Revisa la conexión e intenta de nuevo.', 'error');
    } finally {
      this.enviandoComentario.set(false);
    }
  }

  async responder(c: Comentario): Promise<void> {
    const l = this.leccion();
    const texto = this.textoRespuesta().trim();
    if (!l || !texto || this.enviandoComentario()) return;
    this.enviandoComentario.set(true);
    try {
      await this.api.comentar(l.id, texto, c.id);
      this.textoRespuesta.set('');
      this.respondiendoA.set(null);
      await this.cargarComentarios();
    } catch (e: any) {
      Swal.fire('No se pudo responder', e?.error?.message ?? 'Revisa la conexión e intenta de nuevo.', 'error');
    } finally {
      this.enviandoComentario.set(false);
    }
  }

  async borrarComentario(c: Comentario): Promise<void> {
    const r = await Swal.fire({
      title: '¿Borrar el comentario?',
      text: c.parent_id ? '' : 'Se borran también sus respuestas.',
      icon: 'warning', showCancelButton: true, confirmButtonText: 'Borrar', cancelButtonText: 'Cancelar',
      confirmButtonColor: '#c62828',
    });
    if (!r.isConfirmed) return;
    try {
      await this.api.borrarComentario(c.id);
      await this.cargarComentarios();
    } catch (e: any) {
      Swal.fire('No se pudo borrar', e?.error?.message ?? 'Inténtalo de nuevo.', 'error');
    }
  }

  abrirRespuesta(c: Comentario): void {
    this.respondiendoA.set(this.respondiendoA() === c.id ? null : c.id);
    this.textoRespuesta.set('');
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
  async saltarA(leccionId: string, segundos: number): Promise<void> {
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
    if (this.preview()) {
      this.router.navigate(['/dashboard/capacitaciones/catalogo', this.courseId]);
      return;
    }
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
    if (this.preview()) {
      // En vista previa no hay matrícula que avanzar: se marca solo en pantalla.
      this.marcarLocalmente(leccion.id);
      return;
    }
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

  // ── Mi calificación ───────────────────────────────────────────────────────

  readonly boletinAbierto = signal(false);
  readonly boletin = signal<Boletin | null>(null);
  readonly cargandoBoletin = signal(false);

  async alternarBoletin(): Promise<void> {
    const abrir = !this.boletinAbierto();
    this.boletinAbierto.set(abrir);
    if (!abrir) return;
    const id = this.paquete()?.enrollment_id;
    if (!id) return;
    this.cargandoBoletin.set(true);
    try {
      this.boletin.set(await this.api.miBoletin(id));
    } catch {
      this.boletin.set(null);
    } finally {
      this.cargandoBoletin.set(false);
    }
  }

  /** Solo lo que este curso pide: listar lo que no aplica confunde. */
  requisitosQueAplican(b: Boletin): RequisitoBoletin[] {
    return b.requisitos.filter(r => r.aplica);
  }

  etiquetaItem(it: ItemBoletin): string {
    switch (it.estado) {
      case 'SIN_PRESENTAR':      return 'sin presentar';
      case 'PENDIENTE_REVISION': return 'esperando revisión';
      case 'RECHAZADO':          return 'rechazada';
      case 'APROBADO':           return 'aprobada';
      default:                   return it.intentos ? `${it.intentos} intento(s)` : '';
    }
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

  /**
   * Las que se responden escribiendo.
   *
   * <p>Se guardan en el MISMO mapa que las marcadas, como un arreglo de un elemento. Así
   * "¿está respondida?" sigue siendo una sola pregunta —¿hay algo en el arreglo?— y no dos.
   */
  esAbierta(p: PreguntaPresentacion): boolean {
    return p.tipo === 'TEXTO_ABIERTO' || p.tipo === 'NUMERO';
  }

  /** Las de programación: se responden con código y las califican sus pruebas en el servidor. */
  esCodigo(p: PreguntaPresentacion): boolean {
    return p.tipo === 'PROGRAMACION';
  }

  /** El código va tal cual (sin recortar: la indentación importa), en el mismo mapa. */
  escribirCodigo(pregunta: PreguntaPresentacion, codigo: string): void {
    if (this.confirmada(pregunta)) return;
    this.respuestas.update(actual => ({ ...actual, [pregunta.id]: (codigo ?? '').trim() ? [codigo] : [] }));
  }

  escribir(pregunta: PreguntaPresentacion, texto: string): void {
    if (this.confirmada(pregunta)) return;
    const limpio = (texto ?? '').trim();
    this.respuestas.update(actual => ({ ...actual, [pregunta.id]: limpio ? [limpio] : [] }));
  }

  escrito(preguntaId: string): string {
    return (this.respuestas()[preguntaId] ?? [])[0] ?? '';
  }

  elegida(preguntaId: string, opcionId: string): boolean {
    return (this.respuestas()[preguntaId] ?? []).includes(opcionId);
  }

  // ── Quiz de a una pregunta ────────────────────────────────────────────────
  // Todo recibe el quiz: una lección puede tener varios y cada bloque pinta el suyo.

  /** El quiz al que pertenece una pregunta, entre los de la lección abierta. */
  quizDePregunta(p: PreguntaPresentacion): QuizPresentacion | null {
    const l = this.leccion();
    if (!l) return null;
    for (const b of this.bloquesDe(l)) {
      if (b.quiz?.preguntas.some(x => x.id === p.id)) return b.quiz;
    }
    return null;
  }

  indiceDe(q: QuizPresentacion): number {
    return this.indices()[q.quiz_id] ?? 0;
  }

  resultadoDe(q: QuizPresentacion): ResultadoLocal | null {
    return this.resultados()[q.quiz_id] ?? null;
  }

  /** Qué pasó con una pregunta en el resultado de su quiz. Null si no vino en el detalle. */
  detalleDe(q: QuizPresentacion, p: PreguntaPresentacion): DetalleRespuesta | null {
    return this.resultadoDe(q)?.detalle?.find(d => d.question_id === p.id) ?? null;
  }

  /** Lo que la persona contestó, en palabras, para la revisión. */
  respuestaTexto(p: PreguntaPresentacion): string {
    if (this.esAbierta(p)) return this.escrito(p.id) || '(en blanco)';
    if (this.esCodigo(p)) {
      const lineas = this.escrito(p.id).split('\n').filter(l => l.trim()).length;
      return lineas ? `${lineas} línea(s) de código` : '(en blanco)';
    }
    if (this.esEmparejar(p)) {
      const pares = this.parejasDe(p);
      if (!pares.length) return '(sin unir)';
      const texto = (id: string) => p.opciones.find(o => o.id === id)?.texto ?? '?';
      return pares.map(x => `${texto(x.a)} → ${texto(x.b)}`).join(' · ');
    }
    const marcadas = this.respuestas()[p.id] ?? [];
    if (!marcadas.length) return '(en blanco)';
    return marcadas.map(id => p.opciones.find(o => o.id === id)?.texto ?? '?').join(' · ');
  }

  /** La respuesta correcta en palabras, SOLO si el quiz la revela. */
  correctasTexto(p: PreguntaPresentacion): string | null {
    if (!p.opciones_correctas?.length || this.esEmparejar(p)) return null;
    return p.opciones_correctas.map(id => p.opciones.find(o => o.id === id)?.texto ?? '?').join(' · ');
  }

  /**
   * Modo examen: no se pega ni se suelta texto en las respuestas escritas. Es una barrera
   * contra el pegar reflejo, no seguridad; la decide quien arma el quiz.
   */
  bloquearPegado(evento: Event, q: QuizPresentacion): void {
    if (!q.bloquea_pegado) return;
    evento.preventDefault();
    void Swal.fire({
      toast: true, position: 'top', timer: 2200, showConfirmButton: false, icon: 'info',
      title: 'Modo examen: escribe tu respuesta, no se puede pegar.',
    });
  }

  unaPorUna(q: QuizPresentacion): boolean {
    return q.modo_presentacion === 'UNA_POR_UNA';
  }

  /** Las que se pintan ahora: todas, o solo la que toca. */
  preguntasVisibles(q: QuizPresentacion): PreguntaPresentacion[] {
    if (!this.unaPorUna(q)) return q.preguntas;
    const p = q.preguntas[this.indiceDe(q)];
    return p ? [p] : [];
  }

  puedeVolver(q: QuizPresentacion): boolean {
    return this.unaPorUna(q) && !!q.permite_volver && this.indiceDe(q) > 0;
  }

  esUltimaPregunta(q: QuizPresentacion): boolean {
    return !this.unaPorUna(q) || this.indiceDe(q) >= (q.preguntas.length ?? 1) - 1;
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

  // ── Imágenes de las opciones ──────────────────────────────────────────────

  readonly mediaOpciones = signal<Record<string, string>>({});

  /**
   * Baja la imagen de una opción. Se pide una vez y se guarda la url del blob.
   *
   * Se dispara al pintar la opción, no con un botón: en «une cada señal con lo que significa»
   * la imagen ES la opción, y una opción que hay que destapar no se puede elegir.
   */
  async cargarMediaDeOpcion(o: OpcionPresentacion): Promise<void> {
    if (!o.tiene_archivo || this.mediaOpciones()[o.id]) return;
    try {
      const blob = await this.api.descargarMediaDeOpcion(o.id);
      this.mediaOpciones.update(m => ({ ...m, [o.id]: URL.createObjectURL(blob) }));
    } catch { /* sin señal se queda el texto, que siempre está */ }
  }

  mediaDeOpcion(o: OpcionPresentacion): string | null {
    if (o.tiene_archivo && !this.mediaOpciones()[o.id]) void this.cargarMediaDeOpcion(o);
    return this.mediaOpciones()[o.id] ?? null;
  }

  // ── Emparejar ─────────────────────────────────────────────────────────────

  /**
   * Las parejas que ha armado, por pregunta.
   *
   * Se resuelve TOCANDO: primero un elemento de la izquierda, después su pareja de la derecha.
   * Nada de arrastrar — esto se contesta en un celular, muchas veces con guantes y de pie, y
   * arrastrar ahí falla más de lo que acierta.
   */
  readonly parejas = signal<Record<string, { a: string; b: string }[]>>({});
  /** El elemento de la izquierda que está esperando pareja. */
  readonly esperandoPareja = signal<Record<string, string | null>>({});

  esEmparejar(p: PreguntaPresentacion): boolean {
    return p.tipo === 'EMPAREJAR';
  }

  columna(p: PreguntaPresentacion, cual: 'A' | 'B'): OpcionPresentacion[] {
    return (p.opciones ?? []).filter(o => o.columna === cual);
  }

  parejasDe(p: PreguntaPresentacion): { a: string; b: string }[] {
    return this.parejas()[p.id] ?? [];
  }

  /** El número de pareja de una opción (1, 2, 3…), o null si todavía no tiene. */
  numeroDePareja(p: PreguntaPresentacion, opcionId: string): number | null {
    const i = this.parejasDe(p).findIndex(x => x.a === opcionId || x.b === opcionId);
    return i < 0 ? null : i + 1;
  }

  esperando(p: PreguntaPresentacion): string | null {
    return this.esperandoPareja()[p.id] ?? null;
  }

  /** Toca un elemento: arma pareja, la deshace, o queda esperando la contraparte. */
  tocarOpcion(p: PreguntaPresentacion, o: OpcionPresentacion): void {
    if (this.confirmada(p)) return;

    // Tocar algo ya emparejado lo desarma: es la única forma de corregirse sin borrar todo.
    const ya = this.numeroDePareja(p, o.id);
    if (ya != null) {
      this.parejas.update(m => ({
        ...m,
        [p.id]: this.parejasDe(p).filter(x => x.a !== o.id && x.b !== o.id),
      }));
      return;
    }

    if (o.columna === 'A') {
      this.esperandoPareja.update(m => ({ ...m, [p.id]: this.esperando(p) === o.id ? null : o.id }));
      return;
    }

    const a = this.esperando(p);
    if (!a) return;   // tocar la derecha sin haber elegido la izquierda no hace nada
    this.parejas.update(m => ({ ...m, [p.id]: [...this.parejasDe(p), { a, b: o.id }] }));
    this.esperandoPareja.update(m => ({ ...m, [p.id]: null }));
  }

  /** true cuando ya no queda nada por emparejar. */
  emparejarCompleto(p: PreguntaPresentacion): boolean {
    return this.parejasDe(p).length >= this.columna(p, 'A').length
        && this.columna(p, 'A').length > 0;
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

  siguientePregunta(q: QuizPresentacion, p: PreguntaPresentacion): void {
    this.confirmar(p);
    if (!this.esUltimaPregunta(q)) {
      this.indices.update(m => ({ ...m, [q.quiz_id]: this.indiceDe(q) + 1 }));
    }
  }

  preguntaAnterior(q: QuizPresentacion): void {
    if (this.puedeVolver(q)) {
      this.indices.update(m => ({ ...m, [q.quiz_id]: this.indiceDe(q) - 1 }));
    }
  }

  // ── Dónde se explica lo que fallé ─────────────────────────────────────────

  /** Citas encontradas por pregunta. Vacío hasta que se piden: cuestan una consulta. */
  readonly citas = signal<Record<string, CitaMaterial[]>>({});
  readonly buscandoCitas = signal<string | null>(null);

  /**
   * Busca en el material ya visto dónde se explica lo que se falló.
   *
   * Necesita conexión: las transcripciones no viajan en el paquete offline —son grandes y solo
   * hacen falta cuando alguien falla—. Sin señal se dice, en vez de dejar un botón que no hace
   * nada.
   */
  async buscarDondeSeExplica(p: PreguntaPresentacion): Promise<void> {
    const quiz = this.quizDePregunta(p);
    if (!quiz || this.buscandoCitas()) return;
    this.buscandoCitas.set(p.id);
    try {
      const encontradas = await this.api.dondeSeExplica(p.id, quiz.quiz_id);
      this.citas.update(c => ({ ...c, [p.id]: encontradas }));
    } catch {
      this.citas.update(c => ({ ...c, [p.id]: [] }));
    } finally {
      this.buscandoCitas.set(null);
    }
  }

  citasDe(preguntaId: string): CitaMaterial[] | null {
    return this.citas()[preguntaId] ?? null;
  }

  /** Del texto citado al minuto del vídeo, aunque sea de otra lección del curso. */
  async irALaCita(c: CitaMaterial): Promise<void> {
    await this.saltarA(c.lesson_id, c.segundos);
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

  /** Una pregunta está respondida cuando tiene con qué calificarse, sea del tipo que sea. */
  respondida(p: PreguntaPresentacion): boolean {
    if (this.esEmparejar(p)) return this.emparejarCompleto(p);
    return (this.respuestas()[p.id] ?? []).length > 0;
  }

  quizCompleto(quiz: QuizPresentacion): boolean {
    return quiz.preguntas.every(p => this.respondida(p));
  }

  // ── Actividades de código ─────────────────────────────────────────────────
  // Se resuelven y entregan aquí mismo (no en la app del celular): las califican sus pruebas
  // en el servidor, y la nota llega unos segundos después.

  readonly entregas = signal<Record<string, EntregaMia | null>>({});
  readonly entregando = signal<string | null>(null);

  entregaDe(activityId: string): EntregaMia | null {
    return this.entregas()[activityId] ?? null;
  }

  private async cargarEntregasDeCodigo(): Promise<void> {
    const l = this.leccion();
    if (!l || this.preview()) return;
    const deCodigo = this.bloquesDe(l).map(b => b.actividad).filter((a): a is Actividad => !!a && a.tipo === 'CODIGO');
    for (const a of deCodigo) {
      try {
        const e = await this.api.miEntrega(a.id);
        this.entregas.update(m => ({ ...m, [a.id]: e }));
        if (e.calificando) void this.seguirEntrega(a.id);
      } catch {
        this.entregas.update(m => ({ ...m, [a.id]: null }));
      }
    }
  }

  async entregarCodigo(a: Actividad, codigo: string): Promise<void> {
    if (this.preview() || this.entregando()) return;
    this.entregando.set(a.id);
    try {
      const e = await this.api.entregarActividad(a.id, {
        client_event_id: this.offline.idDeEvento('actividad', a.id + ':' + Date.now()),
        texto: codigo, ocurrido_at: new Date().toISOString(),
      }) as EntregaMia;
      this.entregas.update(m => ({ ...m, [a.id]: e }));
      void this.seguirEntrega(a.id);
    } catch (err: any) {
      Swal.fire('No se pudo entregar', err?.error?.message ?? 'Revisa la conexión e intenta de nuevo.', 'error');
    } finally {
      this.entregando.set(null);
    }
  }

  private async seguirEntrega(activityId: string): Promise<void> {
    const limite = Date.now() + 240_000;
    while (Date.now() < limite) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const e = await this.api.miEntrega(activityId);
        this.entregas.update(m => ({ ...m, [activityId]: e }));
        if (!e.calificando) return;
      } catch {
        return;
      }
    }
  }

  private ponerResultado(quizId: string, r: ResultadoIntento): void {
    this.resultados.update(m => ({ ...m, [quizId]: {
      nota: r.nota,
      correctas: r.preguntas_correctas,
      total: r.preguntas_totales,
      detalle: r.detalle ?? [],
      calificando: !!r.calificando,
    } }));
  }

  /** Pide el resultado cada 2 s mientras el código se califica (hasta 4 minutos). */
  private async seguirCalificacion(quizId: string, attemptId: string): Promise<void> {
    const limite = Date.now() + 240_000;
    while (Date.now() < limite) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const r = await this.api.resultadoIntento(attemptId);
        this.ponerResultado(quizId, r);
        if (!r.calificando) return;
      } catch {
        return;
      }
    }
  }

  async enviarQuiz(quiz: QuizPresentacion): Promise<void> {
    const leccion = this.leccion();
    if (!quiz || !leccion || this.guardando()) return;

    if (this.preview()) {
      // Sin matrícula no hay intento que guardar: se corrige con lo que trae el paquete, que
      // es lo que vería la persona sin conexión. Las abiertas no se pueden corregir aquí.
      const corregibles = quiz.preguntas.filter(p => p.opciones_correctas);
      const correctas = corregibles.filter(p => this.acerto(p) === true).length;
      const total = quiz.preguntas.length;
      this.confirmadas.update(s => { const n = new Set(s); quiz.preguntas.forEach(p => n.add(p.id)); return n; });
      const detalle: DetalleRespuesta[] = quiz.preguntas.map(p => {
        const ok = this.acerto(p);
        return { question_id: p.id, enunciado: p.enunciado, correcta: ok === true, puntaje: ok ? 1 : 0,
                 motivo: ok === null ? 'La corrige el servidor cuando alguien la presenta de verdad.' : null };
      });
      this.resultados.update(m => ({ ...m, [quiz.quiz_id]: {
        nota: total ? Math.round(correctas * 100 / total) : 0, correctas, total, detalle } }));
      Swal.fire('Vista previa', corregibles.length < total
        ? 'Aquí solo se corrigen las preguntas de marcar; las escritas las califica el servidor cuando alguien las presenta de verdad.'
        : 'Nada se guarda: es la corrección tal como la vería la persona.', 'info');
      return;
    }

    this.guardando.set(true);
    const idEvento = this.offline.idDeEvento('quiz', quiz.quiz_id);
    // Las abiertas van como texto: la corrección la hace el analizador en el servidor, que es
    // el mismo que califica los exámenes de Formularios Dinámicos. Aquí no viaja su criterio,
    // y por eso tampoco se puede corregir sin conexión.
    const respuestas: RespuestaEnviada[] = quiz.preguntas.map(p => {
      if (this.esAbierta(p) || this.esCodigo(p)) return { question_id: p.id, texto: this.escrito(p.id) || null };
      if (this.esEmparejar(p)) {
        return {
          question_id: p.id,
          parejas: this.parejasDe(p).map(x => ({ opcion_a: x.a, opcion_b: x.b })),
        };
      }
      return { question_id: p.id, option_ids: this.respuestas()[p.id] ?? [] };
    });

    try {
      const resultado = await this.api.responderQuiz(quiz.quiz_id, idEvento, respuestas);
      this.offline.confirmar('quiz', quiz.quiz_id);
      // Con el resultado se fijan todas las preguntas: la revisión muestra cómo quedó cada
      // una y ya no se cambia nada.
      this.confirmadas.update(s => { const n = new Set(s); quiz.preguntas.forEach(p => n.add(p.id)); return n; });
      this.ponerResultado(quiz.quiz_id, resultado);
      // Con código por calificar la nota llega después: se sigue el intento hasta que termine.
      if (resultado.calificando) void this.seguirCalificacion(quiz.quiz_id, resultado.id);
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

/** El resultado de un quiz tal como lo guarda la pantalla: la nota y qué pasó con cada pregunta. */
interface ResultadoLocal {
  nota: number;
  correctas: number;
  total: number;
  detalle: DetalleRespuesta[];
  /** true = hay código calificándose y la nota todavía puede subir. */
  calificando?: boolean;
}
