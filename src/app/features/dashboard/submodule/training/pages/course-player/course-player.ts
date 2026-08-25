import { Component, ChangeDetectionStrategy, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import Swal from 'sweetalert2';
import {
  TrainingS, PaqueteCurso, LeccionOffline, PreguntaPresentacion, RecursoOffline, RespuestaEnviada
} from '../../service/training-s';
import { TrainingOffline } from '../../service/training-offline';

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
export class CoursePlayer implements OnInit {
  private api = inject(TrainingS);
  private ruta = inject(ActivatedRoute);
  private router = inject(Router);
  private sanitizer = inject(DomSanitizer);
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

  /** Material ya descargado en esta sesión: id del recurso -> object URL del blob. */
  readonly materiales = signal<Record<string, string>>({});
  readonly descargandoMaterial = signal<string | null>(null);

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

  seleccionar(leccion: LeccionOffline): void {
    this.leccionActivaId.set(leccion.id);
    this.respuestas.set({});
    this.resultadoQuiz.set(null);
    this.indiceAbierto.set(false);
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

  get quizCompleto(): boolean {
    const quiz = this.leccion()?.quiz;
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
