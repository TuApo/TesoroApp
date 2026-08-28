import {
  Component, ChangeDetectionStrategy, EventEmitter, Input, Output, inject, signal, computed
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';
import {
  TrainingAdminService, Bloque, BloqueRequest, TipoBloque, Quiz, Pregunta, Banco, Actividad, Opcion
} from '../../service/training-admin.service';

/** Lo que la consola necesita saber de un tipo de bloque para pintarlo y explicarlo. */
export interface MetaBloque {
  tipo: TipoBloque;
  icono: string;
  nombre: string;
  ayuda: string;
}

/**
 * El catálogo de bloques. Vive aquí y no en la página para que el menú de "agregar" y la
 * cabecera de cada tarjeta digan exactamente lo mismo: repartirlo entre dos sitios es cómo se
 * acaba con un icono en la lista y otro en la tarjeta.
 */
export const TIPOS_DE_BLOQUE: MetaBloque[] = [
  { tipo: 'TEXTO',        icono: 'notes',       nombre: 'Texto',        ayuda: 'Explicación, instrucciones o resumen' },
  { tipo: 'VIDEO',        icono: 'play_circle', nombre: 'Video',        ayuda: 'Se ve dentro de la lección; la IA lo transcribe y lo etiqueta' },
  { tipo: 'DOCUMENTO',    icono: 'description', nombre: 'Documento',    ayuda: 'PDF, Word o Excel para consultar o descargar' },
  { tipo: 'PRESENTACION', icono: 'slideshow',   nombre: 'Presentación', ayuda: 'Diapositivas de la charla' },
  { tipo: 'IMAGEN',       icono: 'image',       nombre: 'Imagen',       ayuda: 'Foto, diagrama o señalización' },
  { tipo: 'ENLACE',       icono: 'link',        nombre: 'Enlace',       ayuda: 'Página externa' },
  { tipo: 'ACTIVIDAD',    icono: 'assignment_turned_in', nombre: 'Actividad', ayuda: 'Tarea entregable: la foto del EPP, un formato lleno' },
  { tipo: 'QUIZ',         icono: 'quiz',        nombre: 'Quiz',         ayuda: 'Comprobación de lo entendido. Uno por lección' },
];

export function metaDeBloque(tipo: string): MetaBloque {
  return TIPOS_DE_BLOQUE.find(t => t.tipo === tipo)
    ?? { tipo: tipo as TipoBloque, icono: 'widgets', nombre: tipo, ayuda: '' };
}

/**
 * Tarjeta de UN bloque del armador de lecciones.
 *
 * <p>Se edita EN SITIO, desplegando la tarjeta, y no en un diálogo. Armar un taller es ir y
 * volver entre bloques —"esto va antes, esto lo explico mejor, esta pregunta sobra"— y un
 * modal por cada cambio obliga a cerrar para ver el conjunto, que es justo lo que hay que
 * mirar. Es el mismo trato que el constructor de formularios le da a sus campos.
 *
 * <p><b>Guarda con botón, no al escribir.</b> Cada bloque es una escritura HTTP propia;
 * guardar en cada tecla llenaría la red de peticiones y dejaría a medias lo que se está
 * redactando. La tarjeta avisa cuando hay cambios sin guardar.
 *
 * <p><b>El quiz se edita aquí dentro.</b> Sus preguntas salen del banco y se agregan y quitan
 * al momento: son acciones sueltas, no parte del formulario, y esperar a "Guardar" para ver si
 * una pregunta entró sería adivinar.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-block-card',
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './block-card.html',
  styleUrl: './block-card.css'
})
export class BlockCard {
  private api = inject(TrainingAdminService);

  @Input({ required: true }) bloque!: Bloque;
  @Input({ required: true }) lessonId!: string;
  @Input() indice = 0;
  @Input() total = 1;
  @Input() editable = true;
  /** Bancos de preguntas disponibles, para el selector del quiz. Los carga la página. */
  @Input() bancos: Banco[] = [];
  /**
   * Los demás bloques de la lección. El quiz los usa para apuntar cada pregunta al sitio
   * donde se explica, que es lo que se le ofrece a quien falla.
   */
  @Input() bloquesDeLaLeccion: Bloque[] = [];

  /** Algo cambió en el servidor: la página tiene que recargar el árbol. */
  @Output() cambiado = new EventEmitter<void>();
  @Output() mover = new EventEmitter<-1 | 1>();
  @Output() eliminar = new EventEmitter<void>();

  readonly abierto = signal(false);
  readonly guardando = signal(false);

  /** Copia local en edición. Se compara con el original para saber si hay cambios. */
  readonly borrador = signal<BorradorBloque | null>(null);

  // ── Quiz ──────────────────────────────────────────────────────────────────
  readonly quiz = signal<Quiz | null>(null);
  readonly cargandoQuiz = signal(false);
  readonly bancoElegido = signal<string | null>(null);
  readonly preguntasDelBanco = signal<Pregunta[]>([]);

  /**
   * Pregunta que se está escribiendo aquí mismo. null = cerrado.
   *
   * Existe porque mandar a alguien a otra pantalla a crear la pregunta, volver, y buscarla en
   * la lista es tres pasos para una frase. Se crea en el banco elegido —siguen siendo del
   * banco, se corrigen en un solo sitio— y se engancha al quiz de una vez.
   */
  readonly nuevaPregunta = signal<FormPregunta | null>(null);

  get meta(): MetaBloque {
    return metaDeBloque(this.bloque.tipo);
  }

  readonly sucio = computed(() => {
    const b = this.borrador();
    if (!b) return false;
    return b.titulo !== (this.bloque.titulo ?? '')
        || b.descripcion !== (this.bloque.descripcion ?? '')
        || b.contenido !== (this.bloque.contenido ?? '')
        || b.url !== (this.bloque.recurso?.url ?? '')
        || b.actividadSucia
        || b.quizSucio;
  });

  /** El resumen de una línea que se ve con la tarjeta cerrada. */
  get resumen(): string {
    switch (this.bloque.tipo) {
      case 'TEXTO':  return (this.bloque.contenido ?? '').replace(/<[^>]*>/g, '').slice(0, 140);
      case 'ENLACE': return this.bloque.recurso?.url ?? '';
      case 'QUIZ':   return this.quiz()
        ? `${this.quiz()!.total_preguntas} pregunta(s)`
        : 'Comprobación de la lección';
      default:       return this.bloque.descripcion ?? this.bloque.recurso?.titulo ?? '';
    }
  }

  async alternar(): Promise<void> {
    const abriendo = !this.abierto();
    this.abierto.set(abriendo);
    if (!abriendo) { this.borrador.set(null); return; }

    this.borrador.set({
      titulo: this.bloque.titulo ?? '',
      descripcion: this.bloque.descripcion ?? '',
      contenido: this.bloque.contenido ?? '',
      url: this.bloque.recurso?.url ?? '',
      actividad: {
        tipo: 'EVIDENCIA_FOTO', instrucciones: '', revision: 'MANUAL',
        puntaje_max: undefined, obligatoria: true,
      },
      actividadSucia: false,
      quiz: {
        intentos_max: 3, feedback_inmediato: true,
        barajar_preguntas: true, barajar_opciones: true,
        modo_presentacion: 'TODAS', permite_volver: true, mostrar_respuesta_correcta: true,
      },
      quizSucio: false,
    });
    if (this.bloque.tipo === 'QUIZ') await this.cargarQuiz();
    if (this.bloque.tipo === 'ACTIVIDAD') await this.cargarActividad();
  }

  /**
   * Rellena el formulario con la tarea real.
   *
   * El árbol de contenido trae solo el `activity_id`; la tarea entera se pide aquí, y solo al
   * desplegar la tarjeta. Sin esto el formulario saldría con los valores por defecto y guardar
   * borraría en silencio lo que ya estaba escrito.
   */
  private async cargarActividad(): Promise<void> {
    if (!this.bloque.activity_id) return;
    try {
      const tareas = await this.api.actividadesDeLeccion(this.lessonId);
      const a: Actividad | undefined = tareas.find(x => x.id === this.bloque.activity_id);
      if (!a) return;
      this.borrador.update(b => b ? {
        ...b,
        titulo: b.titulo || a.titulo,
        actividad: {
          tipo: a.tipo,
          instrucciones: a.instrucciones ?? '',
          revision: a.revision,
          puntaje_max: a.puntaje_max ?? undefined,
          obligatoria: a.obligatoria,
        },
        actividadSucia: false,
      } : b);
    } catch { /* sin la tarea el formulario queda con los valores por defecto */ }
  }

  /** Cambia un campo del borrador sin mutarlo: OnPush necesita objeto nuevo para repintar. */
  editar(parche: Partial<BorradorBloque>): void {
    this.borrador.update(b => b ? { ...b, ...parche } : b);
  }

  editarActividad(parche: Partial<BorradorActividad>): void {
    this.borrador.update(b =>
      b ? { ...b, actividad: { ...b.actividad, ...parche }, actividadSucia: true } : b);
  }

  editarQuiz(parche: Partial<BorradorQuiz>): void {
    this.borrador.update(b => b ? { ...b, quiz: { ...b.quiz, ...parche }, quizSucio: true } : b);
  }

  async guardar(): Promise<void> {
    const b = this.borrador();
    if (!b || !this.sucio()) return;

    this.guardando.set(true);
    try {
      const req: BloqueRequest = {
        tipo: this.bloque.tipo,
        titulo: b.titulo,
        descripcion: b.descripcion,
      };
      if (this.bloque.tipo === 'TEXTO')  req.contenido = b.contenido;
      if (this.bloque.tipo === 'ENLACE') req.url = b.url;
      if (this.bloque.tipo === 'ACTIVIDAD' && b.actividadSucia) {
        req.actividad = {
          tipo: b.actividad.tipo,
          titulo: b.titulo || 'Actividad',
          instrucciones: b.actividad.instrucciones,
          revision: b.actividad.revision,
          puntaje_max: b.actividad.puntaje_max,
          obligatoria: b.actividad.obligatoria,
        };
      }
      await this.api.actualizarBloque(this.bloque.id, req);

      if (this.bloque.tipo === 'QUIZ' && b.quizSucio) {
        await this.api.guardarQuiz(this.lessonId, b.quiz);
      }
      this.borrador.update(x => x ? { ...x, actividadSucia: false, quizSucio: false } : x);
      this.cambiado.emit();
    } catch (e: any) {
      Swal.fire('No se pudo guardar', e?.error?.message ?? 'Inténtalo de nuevo.', 'error');
    } finally {
      this.guardando.set(false);
    }
  }

  // ── Quiz ──────────────────────────────────────────────────────────────────

  private async cargarQuiz(): Promise<void> {
    this.cargandoQuiz.set(true);
    try {
      const q = await this.api.quizDeLeccion(this.lessonId);
      this.quiz.set(q);
      this.borrador.update(b => b ? {
        ...b,
        quiz: {
          intentos_max: q.intentos_max,
          feedback_inmediato: q.feedback_inmediato,
          barajar_preguntas: q.barajar_preguntas,
          barajar_opciones: q.barajar_opciones,
          modo_presentacion: q.modo_presentacion,
          permite_volver: q.permite_volver,
          mostrar_respuesta_correcta: q.mostrar_respuesta_correcta,
        },
        quizSucio: false,
      } : b);
    } catch {
      this.quiz.set(null);
    } finally {
      this.cargandoQuiz.set(false);
    }
  }

  async elegirBanco(bankId: string): Promise<void> {
    this.bancoElegido.set(bankId || null);
    if (!bankId) { this.preguntasDelBanco.set([]); return; }
    try {
      this.preguntasDelBanco.set(await this.api.preguntas(bankId, true));
    } catch {
      this.preguntasDelBanco.set([]);
    }
  }

  /** Las del banco que todavía no están en el quiz: agregar dos veces la misma no aporta. */
  readonly disponibles = computed(() => {
    const puestas = new Set((this.quiz()?.preguntas ?? []).map(p => p.id));
    return this.preguntasDelBanco().filter(p => !puestas.has(p.id));
  });

  // ── Crear una pregunta sin salir de aquí ──────────────────────────────────

  abrirNuevaPregunta(): void {
    this.nuevaPregunta.set({
      enunciado: '',
      cuerpo_html: '',
      media_tipo: null, media_document_id: null, media_mime: null,
      tipo: 'VERDADERO_FALSO',
      explicacion: '',
      opciones: [
        { texto: 'Verdadero', correcta: true, orden: 0 },
        { texto: 'Falso', correcta: false, orden: 1 },
      ],
    });
  }

  editarNueva(parche: Partial<FormPregunta>): void {
    this.nuevaPregunta.update(f => f ? { ...f, ...parche } : f);
  }

  /** Cambiar de tipo rehace las opciones: un V/F con cinco opciones no significa nada. */
  cambiarTipoNueva(tipo: 'VERDADERO_FALSO' | 'OPCION_MULTIPLE'): void {
    this.nuevaPregunta.update(f => {
      if (!f) return f;
      const opciones: Opcion[] = tipo === 'VERDADERO_FALSO'
        ? [{ texto: 'Verdadero', correcta: true, orden: 0 },
           { texto: 'Falso', correcta: false, orden: 1 }]
        : [{ texto: '', correcta: true, orden: 0 }, { texto: '', correcta: false, orden: 1 }];
      return { ...f, tipo, opciones };
    });
  }

  editarOpcion(i: number, parche: Partial<Opcion>): void {
    this.nuevaPregunta.update(f => {
      if (!f) return f;
      const opciones = f.opciones.map((o, j) => j === i ? { ...o, ...parche } : o);
      return { ...f, opciones };
    });
  }

  /**
   * Marca la correcta. En VERDADERO_FALSO solo puede haber una, así que marcar una desmarca
   * la otra; en opción múltiple pueden ser varias.
   */
  marcarCorrecta(i: number, valor: boolean): void {
    this.nuevaPregunta.update(f => {
      if (!f) return f;
      const unica = f.tipo === 'VERDADERO_FALSO';
      const opciones = f.opciones.map((o, j) =>
        j === i ? { ...o, correcta: valor } : (unica && valor ? { ...o, correcta: false } : o));
      return { ...f, opciones };
    });
  }

  agregarOpcion(): void {
    this.nuevaPregunta.update(f => f
      ? { ...f, opciones: [...f.opciones, { texto: '', correcta: false, orden: f.opciones.length }] }
      : f);
  }

  quitarOpcion(i: number): void {
    this.nuevaPregunta.update(f => {
      if (!f || f.opciones.length <= 2) return f;
      return { ...f, opciones: f.opciones.filter((_, j) => j !== i) };
    });
  }

  readonly nuevaValida = computed(() => {
    const f = this.nuevaPregunta();
    if (!f) return false;
    return f.enunciado.trim().length > 3
        && f.opciones.every(o => o.texto.trim().length > 0)
        && f.opciones.some(o => o.correcta);
  });

  /** Crea la pregunta en el banco elegido y la engancha al quiz en un solo paso. */
  async guardarNuevaPregunta(): Promise<void> {
    const f = this.nuevaPregunta();
    const bankId = this.bancoElegido();
    const q = this.quiz();
    if (!f || !bankId || !q || !this.nuevaValida()) return;

    this.guardando.set(true);
    try {
      const creada = await this.api.crearPregunta(bankId, {
        enunciado: f.enunciado.trim(),
        cuerpo_html: f.cuerpo_html?.trim() || undefined,
        media_tipo: f.media_tipo,
        media_document_id: f.media_document_id,
        media_mime: f.media_mime,
        tipo: f.tipo,
        explicacion: f.explicacion?.trim() || undefined,
        activa: true,
        opciones: f.opciones.map((o, i) => ({ ...o, texto: o.texto.trim(), orden: i })),
      });
      this.quiz.set(await this.api.agregarPreguntasAlQuiz(q.id, [creada.id]));
      // La lista del banco se recarga para que la nueva no reaparezca como "disponible".
      await this.elegirBanco(bankId);
      this.nuevaPregunta.set(null);
      this.cambiado.emit();
    } catch (e: any) {
      Swal.fire('No se pudo crear', e?.error?.message ?? 'Inténtalo de nuevo.', 'error');
    } finally {
      this.guardando.set(false);
    }
  }

  /**
   * Sube la foto o el vídeo sobre el que se pregunta, sin salir del bloque.
   *
   * Va a gestión documental como todo el material. Aquí no se ofrece el enlace externo: la
   * política de seguridad de la página no deja incrustarlo y se vería en blanco. Eso se hace
   * desde la pantalla de bancos, donde se explica que se abrirá aparte.
   */
  async subirMediaDeNueva(tipo: 'IMAGEN' | 'VIDEO', evento: Event): Promise<void> {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0];
    const bankId = this.bancoElegido();
    if (!archivo || !bankId) return;
    input.value = '';

    const limiteMb = tipo === 'VIDEO' ? 200 : 15;
    if (archivo.size > limiteMb * 1024 * 1024) {
      Swal.fire('Archivo demasiado grande',
        `El material de una pregunta no puede pasar de ${limiteMb} MB.`, 'info');
      return;
    }
    this.guardando.set(true);
    try {
      const documentId = await this.api.subirMediaDePregunta(archivo, bankId);
      this.editarNueva({
        media_tipo: tipo, media_document_id: documentId, media_mime: archivo.type || null,
      });
    } catch (e: any) {
      Swal.fire('No se pudo subir', e?.error?.message ?? 'Inténtalo de nuevo.', 'error');
    } finally {
      this.guardando.set(false);
    }
  }

  quitarMediaDeNueva(): void {
    this.editarNueva({ media_tipo: null, media_document_id: null, media_mime: null });
  }

  async agregarPregunta(p: Pregunta): Promise<void> {
    const q = this.quiz();
    if (!q) return;
    this.guardando.set(true);
    try {
      this.quiz.set(await this.api.agregarPreguntasAlQuiz(q.id, [p.id]));
      this.cambiado.emit();
    } catch (e: any) {
      Swal.fire('No se pudo agregar', e?.error?.message ?? 'Inténtalo de nuevo.', 'error');
    } finally {
      this.guardando.set(false);
    }
  }

  async quitarPregunta(p: Pregunta): Promise<void> {
    const q = this.quiz();
    if (!q) return;
    this.guardando.set(true);
    try {
      this.quiz.set(await this.api.quitarPreguntaDelQuiz(q.id, p.id));
      this.cambiado.emit();
    } catch (e: any) {
      Swal.fire('No se pudo quitar', e?.error?.message ?? 'Inténtalo de nuevo.', 'error');
    } finally {
      this.guardando.set(false);
    }
  }

  /** Reordena mandando la lista completa, que es lo que espera el backend. */
  async moverPregunta(p: Pregunta, salto: -1 | 1): Promise<void> {
    const q = this.quiz();
    if (!q) return;
    const orden = q.preguntas.map(x => x.id);
    const i = orden.indexOf(p.id);
    const j = i + salto;
    if (i < 0 || j < 0 || j >= orden.length) return;
    [orden[i], orden[j]] = [orden[j], orden[i]];

    this.guardando.set(true);
    try {
      this.quiz.set(await this.api.reordenarPreguntasDelQuiz(q.id, orden));
    } catch (e: any) {
      Swal.fire('No se pudo reordenar', e?.error?.message ?? 'Inténtalo de nuevo.', 'error');
    } finally {
      this.guardando.set(false);
    }
  }

  // ── A dónde mandar a quien falla ──────────────────────────────────────────

  /** Los bloques a los que se puede apuntar: todos menos el propio quiz. */
  get bloquesReferenciables(): Bloque[] {
    return this.bloquesDeLaLeccion.filter(b => b.tipo !== 'QUIZ');
  }

  referenciaDe(p: Pregunta): { block_id: string; segundo?: number | null } | null {
    return this.quiz()?.referencias?.find(r => r.question_id === p.id) ?? null;
  }

  /** Solo tiene sentido pedir el segundo si el bloque es un vídeo. */
  esVideo(blockId: string | null | undefined): boolean {
    return !!blockId && this.bloquesDeLaLeccion.find(b => b.id === blockId)?.tipo === 'VIDEO';
  }

  async fijarReferencia(p: Pregunta, blockId: string | null, segundo?: number | null): Promise<void> {
    const q = this.quiz();
    if (!q) return;
    this.guardando.set(true);
    try {
      // Se manda el segundo solo si el bloque es un vídeo: en un PDF no significa nada y
      // guardarlo dejaría un dato que la próxima lectura interpretaría como un salto.
      const seg = this.esVideo(blockId) ? (segundo ?? null) : null;
      this.quiz.set(await this.api.referenciaDePregunta(q.id, p.id, blockId || null, seg));
    } catch (e: any) {
      Swal.fire('No se pudo guardar', e?.error?.message ?? 'Inténtalo de nuevo.', 'error');
    } finally {
      this.guardando.set(false);
    }
  }

  /** Bytes en algo legible. 0 y null se tratan igual: no sabemos el tamaño. */
  tamano(bytes?: number | null): string {
    if (!bytes) return '';
    const mb = bytes / 1024 / 1024;
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
}

/** Lo que se escribe al crear una pregunta desde aquí. */
interface FormPregunta {
  enunciado: string;
  /** Texto enriquecido de apoyo, y la foto o el vídeo sobre el que se pregunta. */
  cuerpo_html: string;
  media_tipo: 'IMAGEN' | 'VIDEO' | null;
  media_document_id: string | null;
  media_mime: string | null;
  tipo: 'VERDADERO_FALSO' | 'OPCION_MULTIPLE';
  explicacion: string;
  opciones: Opcion[];
}

interface BorradorActividad {
  tipo: string;
  instrucciones: string;
  revision: string;
  puntaje_max?: number;
  obligatoria: boolean;
}

interface BorradorQuiz {
  intentos_max: number;
  feedback_inmediato: boolean;
  barajar_preguntas: boolean;
  barajar_opciones: boolean;
  modo_presentacion: 'TODAS' | 'UNA_POR_UNA';
  permite_volver: boolean;
  mostrar_respuesta_correcta: boolean;
}

interface BorradorBloque {
  titulo: string;
  descripcion: string;
  contenido: string;
  url: string;
  actividad: BorradorActividad;
  actividadSucia: boolean;
  quiz: BorradorQuiz;
  quizSucio: boolean;
}
