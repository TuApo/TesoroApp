import { BloqueFicha } from '../bloque-ficha/bloque-ficha';
import { EjercicioEditor } from '../codigo/ejercicio-editor';
import { EjercicioCodigo, ejercicioNuevo } from '../../service/codigo.service';
import { BloqueYoutube } from '../bloque-youtube/bloque-youtube';
import {
  Component, ChangeDetectionStrategy, EventEmitter, Input, OnInit, Output, ViewChild, inject, signal, computed
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';
import {
  TrainingAdminService, Bloque, BloqueRequest, TipoBloque, Quiz, Pregunta, PreguntaEncontrada,
  Banco, Actividad, Opcion, CriterioPregunta, SugerenciaReferencia, PreguntaSugerida,
  OrigenEnQuiz, PedidoDePreguntas, TipoQuiz
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
  { tipo: 'QUIZ',         icono: 'quiz',        nombre: 'Quiz',         ayuda: 'Comprobación, práctica o examen. Los que hagan falta' },
  { tipo: 'AUDIO',        icono: 'headphones',  nombre: 'Audio',        ayuda: 'Narración o podcast que se escucha en la lección' },
  { tipo: 'YOUTUBE',      icono: 'smart_display', nombre: 'YouTube',    ayuda: 'Un video de YouTube, desde el minuto que importa' },
  { tipo: 'FICHA',        icono: 'style',       nombre: 'Fichas',       ayuda: 'Tarjetas de pregunta y respuesta para repasar' },
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
  imports: [CommonModule, FormsModule, MatIconModule, BloqueFicha, BloqueYoutube, EjercicioEditor],
  templateUrl: './block-card.html',
  styleUrl: './block-card.css'
})
export class BlockCard implements OnInit {
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

  /**
   * Qué partes del quiz están desplegadas.
   *
   * Armar un quiz es mirar la lista de preguntas, no los ajustes: los intentos y el barajado se
   * deciden una vez y no se vuelven a tocar, mientras que las preguntas se revisan cada vez que
   * se abre el bloque. Por eso entra plegado todo menos la lista, y la cabecera de cada parte
   * resume lo que esconde para no tener que abrirla para saberlo.
   */
  readonly secciones = signal<Record<SeccionQuiz, boolean>>({
    calificacion: false, ajustes: false, preguntas: true, agregar: false,
  });

  alternarSeccion(clave: SeccionQuiz): void {
    this.secciones.update(s => ({ ...s, [clave]: !s[clave] }));
  }

  /**
   * Qué pregunta tiene el detalle abierto. Solo una: con varias abiertas la lista deja de
   * poder leerse de un vistazo, que es justo para lo que sirve.
   */
  readonly detalleAbierto = signal<string | null>(null);

  alternarDetalle(p: Pregunta): void {
    this.detalleAbierto.update(id => id === p.id ? null : p.id);
  }

  /** Cómo se agrega la próxima pregunta. null = sin elegir, las tres opciones a la vista. */
  readonly modoAgregar = signal<ModoAgregar | null>(null);

  elegirModo(modo: ModoAgregar): void {
    const nuevo = this.modoAgregar() === modo ? null : modo;
    this.modoAgregar.set(nuevo);
    // Escribir una pregunta abre su formulario de una vez: elegir "escribirla" y tener que
    // pulsar otra vez "escribir una pregunta nueva" es el mismo paso dos veces.
    if (nuevo === 'NUEVA' && !this.nuevaPregunta()) this.abrirNuevaPregunta();
    if (nuevo !== 'NUEVA') this.nuevaPregunta.set(null);
  }

  /** Copia local en edición. Se compara con el original para saber si hay cambios. */
  readonly borrador = signal<BorradorBloque | null>(null);

  // ── Quiz ──────────────────────────────────────────────────────────────────
  readonly quiz = signal<Quiz | null>(null);
  readonly cargandoQuiz = signal(false);
  readonly bancoElegido = signal<string | null>(null);
  /**
   * Dónde se guarda una pregunta NUEVA. Es distinto del filtro de búsqueda a propósito: se
   * puede estar mirando "todos los bancos" y aun así hacer falta decidir en cuál queda la que
   * se escribe. Antes iban pegados y por eso no se podía crear sin elegir banco primero.
   */
  readonly bancoDestino = signal<string | null>(null);
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

  /**
   * El quiz se trae al pintar la tarjeta, no al abrirla: el resumen cerrado tiene que decir
   * qué es y cuánto vale sin obligar a desplegar cada bloque para enterarse. Es una petición
   * por quiz de la lección, que es como mucho una.
   */
  ngOnInit(): void {
    if (this.bloque.tipo === 'QUIZ' && !this.quiz()) void this.cargarQuiz();
  }

  nombreTipoQuiz(tipo: TipoQuiz | string | null | undefined): string {
    switch (tipo) {
      case 'EXAMEN_FINAL': return 'Examen final';
      case 'PRACTICA':     return 'Práctica';
      default:             return 'Quiz de actividad';
    }
  }

  iconoTipoQuiz(tipo: TipoQuiz | string | null | undefined): string {
    switch (tipo) {
      case 'EXAMEN_FINAL': return 'workspace_premium';
      case 'PRACTICA':     return 'sports_esports';
      default:             return 'quiz';
    }
  }

  /** Un input numérico vacío llega como '' o null: para el servidor eso es null, no 0. */
  numeroONull(v: unknown): number | null {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Cambiar a práctica apaga la calificación de una vez: una práctica no califica nunca.
   * Cambiar a examen final enciende el modo examen (sin pegar): es lo que se espera de un
   * examen, y se puede apagar a mano.
   */
  cambiarTipoQuiz(tipo: TipoQuiz): void {
    this.editarQuiz(tipo === 'PRACTICA'
      ? { tipo, calificable: false, peso: null, nota_minima: null, bloquea_pegado: false }
      : tipo === 'EXAMEN_FINAL'
        ? { tipo, calificable: true, bloquea_pegado: true }
        : { tipo, calificable: true });
  }

  /** Lo que dice la calificación sin abrirla: qué es, cuánto pesa y si exige mínimo. */
  readonly resumenCalificacion = computed(() => {
    const q = this.borrador()?.quiz;
    if (!q) return '';
    const partes = [this.nombreTipoQuiz(q.tipo)];
    if (q.tipo !== 'PRACTICA' && q.calificable) {
      partes.push(q.peso != null ? `vale el ${q.peso} % del módulo` : 'peso repartido por igual');
      if (q.nota_minima != null) partes.push(`mínimo ${q.nota_minima}`);
    } else {
      partes.push('no cuenta en la nota');
    }
    if (q.bloquea_pegado) partes.push('modo examen');
    return partes.join(' · ');
  });

  /** Lo que dicen los ajustes sin abrirlos: intentos, cuántas salen y en qué orden. */
  readonly resumenAjustes = computed(() => {
    const q = this.borrador()?.quiz;
    if (!q) return '';
    const intentos = q.intentos_max === 0 ? 'intentos sin límite' : `${q.intentos_max} intento(s)`;
    const cuantas = q.preguntas_por_intento ? `salen ${q.preguntas_por_intento}` : 'salen todas';
    const orden = q.barajar_preguntas ? 'al azar' : 'en orden';
    return `${intentos} · ${cuantas} · ${orden}`;
  });

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
      case 'FICHA':  return `${BlockCard.tarjetasDe(this.bloque.contenido).length} tarjeta(s) de repaso`;
      case 'YOUTUBE': {
        const y = BlockCard.youtubeDe(this.bloque.contenido);
        return y.video_id ? `${y.titulo ?? 'Video'} · youtu.be/${y.video_id}` : 'Sin video elegido';
      }
      case 'QUIZ': {
        const q = this.quiz();
        if (!q) return 'Comprobación de la lección';
        const partes = [this.nombreTipoQuiz(q.tipo), `${q.total_preguntas} pregunta(s)`];
        if (q.tipo !== 'PRACTICA' && q.calificable) {
          partes.push(q.peso != null ? `vale el ${q.peso} % del módulo` : 'peso por igual');
          if (q.nota_minima != null) partes.push(`mínimo ${q.nota_minima}`);
        } else {
          partes.push('no cuenta en la nota');
        }
        return partes.join(' · ');
      }
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
        puntaje_max: undefined, obligatoria: true, calificable: true, peso: null, ejercicio: null,
      },
      actividadSucia: false,
      quiz: {
        intentos_max: 3, feedback_inmediato: true, preguntas_por_intento: null,
        barajar_preguntas: true, barajar_opciones: true,
        modo_presentacion: 'TODAS', permite_volver: true, mostrar_respuesta_correcta: true,
        tipo: 'ACTIVIDAD', calificable: true, peso: null, nota_minima: null, bloquea_pegado: false,
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
          calificable: a.calificable ?? true,
          peso: a.peso ?? null,
          ejercicio: a.ejercicio ?? null,
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
    // Pasar a CODIGO estrena un ejercicio y la califican sus pruebas; salir de CODIGO lo suelta.
    if (parche.tipo === 'CODIGO') {
      parche = { ...parche, revision: 'PRUEBAS', ejercicio: this.borrador()?.actividad.ejercicio ?? ejercicioNuevo(),
        puntaje_max: this.borrador()?.actividad.puntaje_max ?? 100 };
    } else if (parche.tipo) {
      parche = { ...parche, ejercicio: null, revision: this.borrador()?.actividad.revision === 'PRUEBAS' ? 'MANUAL' : this.borrador()?.actividad.revision };
    }
    this.borrador.update(b =>
      b ? { ...b, actividad: { ...b.actividad, ...parche }, actividadSucia: true } : b);
  }

  @ViewChild(EjercicioEditor) editorEjercicio?: EjercicioEditor;

  // ── Fichas y YouTube: el contenido es un JSON que se edita por partes ──

  static tarjetasDe(contenido: string | null | undefined): { frente: string; reverso: string }[] {
    try {
      const d = JSON.parse(contenido || '{}');
      return Array.isArray(d?.tarjetas) ? d.tarjetas : [];
    } catch { return []; }
  }

  static youtubeDe(contenido: string | null | undefined): { video_id?: string; titulo?: string; canal?: string; inicio?: number; fin?: number } {
    try { return JSON.parse(contenido || '{}') ?? {}; } catch { return {}; }
  }

  tarjetasBorrador(): { frente: string; reverso: string }[] {
    return BlockCard.tarjetasDe(this.borrador()?.contenido);
  }

  editarTarjeta(i: number, campo: 'frente' | 'reverso', valor: string): void {
    const ts = this.tarjetasBorrador().map(t => ({ ...t }));
    if (!ts[i]) return;
    ts[i][campo] = valor;
    this.editar({ contenido: JSON.stringify({ tarjetas: ts }) });
  }

  agregarTarjeta(): void {
    this.editar({ contenido: JSON.stringify({ tarjetas: [...this.tarjetasBorrador(), { frente: '', reverso: '' }] }) });
  }

  quitarTarjeta(i: number): void {
    const ts = this.tarjetasBorrador().filter((_, j) => j !== i);
    this.editar({ contenido: ts.length ? JSON.stringify({ tarjetas: ts }) : '' });
  }

  youtubeBorrador(): { video_id?: string; titulo?: string; canal?: string; inicio?: number; fin?: number } {
    return BlockCard.youtubeDe(this.borrador()?.contenido);
  }

  /** Acepta el enlace en cualquier forma (watch, youtu.be, shorts, embed) o el id pelado. */
  editarYoutube(parche: { url?: string; inicio?: string; fin?: string }): void {
    const y = { ...this.youtubeBorrador() };
    if (parche.url !== undefined) {
      const m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(parche.url);
      const id = m?.[1] ?? (/^[A-Za-z0-9_-]{11}$/.test(parche.url.trim()) ? parche.url.trim() : '');
      y.video_id = id || undefined;
    }
    const seg = (v: string) => {
      const t = v.trim();
      const mm = /^(\d+):(\d{1,2})$/.exec(t);
      return mm ? Number(mm[1]) * 60 + Number(mm[2]) : /^\d+$/.test(t) ? Number(t) : undefined;
    };
    if (parche.inicio !== undefined) y.inicio = seg(parche.inicio) ?? 0;
    if (parche.fin !== undefined) y.fin = seg(parche.fin);
    this.editar({ contenido: y.video_id ? JSON.stringify(y) : '' });
  }

  mmss(s?: number): string {
    return s == null ? '' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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
      if (this.bloque.tipo === 'TEXTO' || this.bloque.tipo === 'FICHA' || this.bloque.tipo === 'YOUTUBE') req.contenido = b.contenido;
      if (this.bloque.tipo === 'ENLACE') req.url = b.url;
      if (this.bloque.tipo === 'ACTIVIDAD' && b.actividadSucia) {
        // Un ejercicio se guarda con todos sus esperados: si faltan y hay solución, se calculan.
        let ejercicio: EjercicioCodigo | null = null;
        if (b.actividad.tipo === 'CODIGO') {
          ejercicio = this.editorEjercicio ? await this.editorEjercicio.completarEsperados() : b.actividad.ejercicio;
        }
        req.actividad = {
          tipo: b.actividad.tipo,
          titulo: b.titulo || 'Actividad',
          instrucciones: b.actividad.instrucciones,
          revision: b.actividad.revision,
          puntaje_max: b.actividad.puntaje_max,
          obligatoria: b.actividad.obligatoria,
          calificable: b.actividad.calificable,
          peso: b.actividad.peso,
          ejercicio,
        };
      }
      await this.api.actualizarBloque(this.bloque.id, req);

      if (this.bloque.tipo === 'QUIZ' && b.quizSucio && this.bloque.quiz_id) {
        // El título viaja también: es el que sale en el boletín y en el reproductor.
        this.quiz.set(await this.api.actualizarQuiz(this.bloque.quiz_id, { ...b.quiz, titulo: b.titulo || null }));
      }
      this.borrador.update(x => x ? { ...x, actividadSucia: false, quizSucio: false } : x);
      this.cambiado.emit();
    } catch (e: any) {
      Swal.fire('No se pudo guardar', e?.error?.message ?? (e instanceof Error ? e.message : 'Inténtalo de nuevo.'), 'error');
    } finally {
      this.guardando.set(false);
    }
  }

  // ── Quiz ──────────────────────────────────────────────────────────────────

  private async cargarQuiz(): Promise<void> {
    if (!this.bloque.quiz_id) { this.quiz.set(null); return; }
    this.cargandoQuiz.set(true);
    try {
      // Por el id del bloque, no "el de la lección": puede haber varios quices en la clase.
      const q = await this.api.obtenerQuiz(this.bloque.quiz_id);
      this.quiz.set(q);
      this.borrador.update(b => b ? {
        ...b,
        quiz: {
          intentos_max: q.intentos_max,
          feedback_inmediato: q.feedback_inmediato,
          preguntas_por_intento: q.preguntas_por_intento ?? null,
          barajar_preguntas: q.barajar_preguntas,
          barajar_opciones: q.barajar_opciones,
          modo_presentacion: q.modo_presentacion,
          permite_volver: q.permite_volver,
          mostrar_respuesta_correcta: q.mostrar_respuesta_correcta,
          tipo: q.tipo ?? 'ACTIVIDAD',
          calificable: q.calificable ?? true,
          peso: q.peso ?? null,
          nota_minima: q.nota_minima ?? null,
          bloquea_pegado: q.bloquea_pegado ?? false,
        },
        quizSucio: false,
      } : b);
      // Con el quiz abierto ya se puede ofrecer algo: las últimas creadas, sin que haya
      // que escribir nada ni elegir banco.
      void this.buscar();
    } catch {
      this.quiz.set(null);
    } finally {
      this.cargandoQuiz.set(false);
    }
  }

  // ── De dónde salió cada pregunta ──────────────────────────────────────────

  /** Cómo entró al quiz cada pregunta, por su id. Vacío para las anteriores a la columna. */
  readonly origenEnQuiz = computed(() => {
    const m = new Map<string, OrigenEnQuiz>();
    for (const o of this.quiz()?.origenes ?? []) m.set(o.question_id, o.origen);
    return m;
  });

  /**
   * La etiqueta que dice cómo se creó, o null cuando no se sabe.
   *
   * No se inventa: las preguntas anteriores a que esto se guardara no llevan etiqueta. Poner
   * "del banco" por descarte sería afirmar algo que nadie comprobó, y la etiqueta existe
   * justamente para poder fiarse de ella al revisar.
   */
  etiquetaOrigen(p: Pregunta): EtiquetaOrigen | null {
    const entro = this.origenEnQuiz().get(p.id) ?? null;
    const nacio = p.origen ?? null;
    const deIa = !!nacio && nacio.startsWith('IA');

    if (entro === 'IA' || (!entro && deIa)) {
      return {
        texto: 'IA', icono: 'auto_awesome', clase: 'bc-eti--ia',
        titulo: nacio === 'IA_TEMA'
          ? 'La propuso el asistente sobre un tema y alguien la revisó antes de agregarla'
          : 'La propuso el asistente desde lo que dice el material, y alguien la revisó',
      };
    }
    if (entro === 'NUEVA') {
      return {
        texto: 'Escrita aquí', icono: 'edit_note', clase: 'bc-eti--nueva',
        titulo: 'Se escribió en este quiz y quedó guardada en el banco para los demás',
      };
    }
    if (entro === 'BANCO') {
      return {
        texto: 'Del banco', icono: 'inventory_2', clase: 'bc-eti--banco',
        titulo: deIa
          ? 'Ya existía en un banco. En su día la propuso el asistente'
          : 'Ya existía en un banco y se trajo a este quiz',
      };
    }
    if (nacio === 'MANUAL') {
      return {
        texto: 'Manual', icono: 'edit_note', clase: 'bc-eti--nueva',
        titulo: 'La escribió una persona',
      };
    }
    return null;
  }

  /** El tipo en una palabra, que es lo que cabe en la fila. */
  etiquetaTipo(tipo: string): string {
    switch (tipo) {
      case 'VERDADERO_FALSO': return 'V/F';
      case 'EMPAREJAR':       return 'emparejar';
      case 'TEXTO_ABIERTO':   return 'escrita';
      case 'NUMERO':          return 'número';
      default:                return 'opción';
    }
  }

  /** El atajo en una línea, para verlo sin abrir el detalle. Null = no tiene. */
  resumenAtajo(p: Pregunta): string | null {
    const r = this.referenciaDe(p);
    if (!r?.block_id) return null;
    const bl = this.bloquesDeLaLeccion.find(b => b.id === r.block_id);
    const nombre = bl?.titulo || bl?.tipo || 'bloque';
    return this.esVideo(r.block_id) && r.segundo != null
      ? `${nombre} · ${this.minuto(r.segundo)}` : nombre;
  }

  /**
   * Con qué se corrige una pregunta escrita, dicho en una frase.
   *
   * Es lo único del detalle que no se ve tal cual en la pantalla del alumno, y por eso hay que
   * decirlo aquí: quien revisa el quiz tiene que poder saber si la pregunta se aprueba con
   * mencionar dos palabras o si exige un número dentro de un rango.
   */
  resumenCriterio(c: CriterioPregunta | null | undefined): string {
    if (!c) return 'Sin criterio: el servidor no deja guardarla así.';
    switch (c.modo) {
      case 'TEXTO_CONTIENE': {
        const t = (c.contiene ?? []).join(', ');
        const cuantos = c.minimo_aciertos
          ? `basta con ${c.minimo_aciertos}` : 'tienen que estar todos';
        return `Debe mencionar: ${t || '—'} (${cuantos}).`;
      }
      case 'TEXTO_SIMILITUD':
        return `Se parece a: «${c.respuesta_modelo ?? ''}» `
             + `(parecido mínimo ${c.umbral_similitud ?? 0.6}).`;
      case 'NUMERO_RANGO':
        return `Un número entre ${c.min ?? '—'} y ${c.max ?? '—'}.`;
      case 'PRESENCIA':  return 'Basta con responder algo.';
      default:           return 'La revisa una persona.';
    }
  }

  /** Las parejas de una pregunta de emparejar ya guardada, agrupadas por su letra. */
  parejasDe(opciones: { texto: string; pareja_clave?: string | null }[]):
      { clave: string; lados: string[] }[] {
    const porClave = new Map<string, string[]>();
    for (const o of opciones) {
      const c = o.pareja_clave ?? '';
      if (!c) continue;
      porClave.set(c, [...(porClave.get(c) ?? []), o.texto]);
    }
    return [...porClave.entries()].map(([clave, lados]) => ({ clave, lados }));
  }

  // ── Pedir una pregunta que ya existe ──────────────────────────────────────

  /** Texto que se está buscando. Vacío = las últimas creadas, que es un buen punto de partida. */
  readonly busqueda = signal('');
  readonly buscando = signal(false);
  readonly resultados = signal<PreguntaEncontrada[]>([]);
  private temporizadorBusqueda: ReturnType<typeof setTimeout> | null = null;

  /** El banco es un FILTRO, no un requisito: por defecto se busca en todos. */
  async elegirBanco(bankId: string): Promise<void> {
    this.bancoElegido.set(bankId || null);
    if (bankId && !this.bancoDestino()) this.bancoDestino.set(bankId);
    await this.buscar();
  }

  /**
   * Teclear no dispara una consulta por letra.
   *
   * 300 ms es el punto donde la lista ya se siente viva y el servidor recibe una consulta por
   * palabra escrita en vez de una por tecla. Sin esto, buscar "arnés" son cinco búsquedas.
   */
  buscarConRetraso(texto: string): void {
    this.busqueda.set(texto);
    if (this.temporizadorBusqueda) clearTimeout(this.temporizadorBusqueda);
    this.temporizadorBusqueda = setTimeout(() => { void this.buscar(); }, 300);
  }

  async buscar(): Promise<void> {
    const q = this.quiz();
    this.buscando.set(true);
    try {
      this.resultados.set(await this.api.buscarPreguntas({
        q: this.busqueda(),
        bank_id: this.bancoElegido(),
        quiz_id: q?.id ?? null,
        limite: 25,
      }));
    } catch {
      this.resultados.set([]);
    } finally {
      this.buscando.set(false);
    }
  }

  // ── El material como fuente: atajos y preguntas ───────────────────────────

  /** Sugerencias de atajo por pregunta. Vacío hasta que se piden. */
  readonly sugerenciasRef = signal<Record<string, SugerenciaReferencia[]>>({});
  readonly buscandoRef = signal<string | null>(null);

  /**
   * Busca en las transcripciones dónde se explica una pregunta.
   *
   * Es la versión que de verdad hace falta: el atajo que queda guardado viaja en el paquete que
   * se descarga al teléfono, así que el repaso funciona SIN SEÑAL. La búsqueda que hace el
   * alumno al fallar necesita conexión, y en finca es lo que no hay.
   */
  async buscarReferencia(p: Pregunta): Promise<void> {
    const q = this.quiz();
    if (!q || this.buscandoRef()) return;
    this.buscandoRef.set(p.id);
    try {
      const s = await this.api.sugerenciasDeReferencia(q.id, p.id);
      this.sugerenciasRef.update(m => ({ ...m, [p.id]: s }));
      if (!s.length) {
        Swal.fire('Sin resultados',
          'No encontramos dónde se explica esto en el material transcrito de esta lección ni de '
          + 'las anteriores. Si el vídeo es nuevo, espera a que termine el etiquetado.', 'info');
      }
    } catch (e: any) {
      Swal.fire('No se pudo buscar', e?.error?.message ?? 'Inténtalo de nuevo.', 'error');
    } finally {
      this.buscandoRef.set(null);
    }
  }

  /** Acepta una sugerencia: la guarda como atajo de la pregunta. */
  async aceptarSugerencia(p: Pregunta, s: SugerenciaReferencia): Promise<void> {
    await this.fijarReferencia(p, s.block_id, s.segundo);
    this.sugerenciasRef.update(m => ({ ...m, [p.id]: [] }));
  }

  sugerenciasDe(preguntaId: string): SugerenciaReferencia[] {
    return this.sugerenciasRef()[preguntaId] ?? [];
  }

  // ── Preguntas propuestas desde la clase ───────────────────────────────────

  readonly propuestas = signal<PreguntaSugerida[]>([]);
  readonly proponiendo = signal(false);
  readonly aceptadas = signal<ReadonlySet<number>>(new Set());

  /**
   * Qué se le pide al modelo. Nada de esto es obligatorio: el botón funciona sin tocarlo.
   *
   * El alcance es la decisión que cambia el resultado. «Esta lección» pregunta solo por la
   * clase que se acaba de dar; «y las anteriores» es lo que la persona habrá visto cuando
   * llegue al quiz; «un tema» suelta al modelo del guion, para lo que el vídeo no alcanza a
   * decir —una norma, un procedimiento de la empresa— o para cuando todavía no hay
   * transcripción.
   */
  readonly iaAlcance = signal<'LECCION' | 'HASTA_AQUI' | 'LIBRE'>('HASTA_AQUI');
  /** Vacío = que el modelo elija el tipo de cada pregunta. */
  readonly iaTipo = signal('');
  readonly iaTema = signal('');
  readonly iaCantidad = signal(5);
  /** Texto libre para el asistente: enfoque, tono, qué comprobar. Se manda tal cual. */
  readonly iaInstrucciones = signal('');

  /**
   * Atajos que se van a guardar al aceptar. Se descartan uno a uno, no se marcan: lo normal es
   * quedarse con el respaldo que el servidor encontró, y pedir que lo confirmen a mano en cada
   * pregunta acabaría en que nadie lo marca y el repaso se queda sin atajo.
   */
  readonly atajosDescartados = signal<ReadonlySet<number>>(new Set());

  alternarAtajo(i: number): void {
    this.atajosDescartados.update(s => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i); else n.add(i);
      return n;
    });
  }

  /** Le pide al modelo preguntas con el alcance, el tipo y el tema que se hayan elegido. */
  async proponerPreguntas(): Promise<void> {
    const q = this.quiz();
    if (!q || this.proponiendo()) return;
    const pedido: PedidoDePreguntas = {
      cantidad: this.iaCantidad(),
      alcance: this.iaAlcance(),
      tipo: this.iaTipo(),
      tema: this.iaTema(),
      instrucciones: this.iaInstrucciones(),
    };
    this.proponiendo.set(true);
    try {
      const p = await this.api.sugerirPreguntas(q.id, pedido);
      this.propuestas.set(p);
      this.aceptadas.set(new Set());
      this.atajosDescartados.set(new Set());
      if (!p.length) {
        Swal.fire('Sin propuestas',
          this.iaAlcance() === 'LIBRE'
            ? 'El modelo no devolvió preguntas utilizables sobre ese tema. Prueba a decirlo con '
              + 'otras palabras, o pídelas de la clase.'
            : 'El modelo no sacó preguntas que se sostengan con lo que dice el material. '
              + 'Prueba otra vez, cambia el alcance o escríbelas a mano.', 'info');
      }
    } catch (e: any) {
      Swal.fire('No se pudo proponer',
        e?.error?.message ?? 'Revisa que el material esté transcrito.', 'info');
    } finally {
      this.proponiendo.set(false);
    }
  }

  alternarPropuesta(i: number): void {
    this.aceptadas.update(s => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i); else n.add(i);
      return n;
    });
  }

  /** Marca o desmarca todas de una vez: revisarlas es lo lento, marcarlas no debería serlo. */
  alternarTodasLasPropuestas(): void {
    const todas = this.propuestas().length;
    this.aceptadas.set(this.aceptadas().size === todas
      ? new Set()
      : new Set(this.propuestas().map((_, i) => i)));
  }

  /**
   * Guarda las propuestas marcadas: al banco, al quiz y con su atajo.
   *
   * Las tres cosas en ese orden, y una pregunta a la vez. Si algo falla a medias, lo ya creado
   * queda bien puesto en vez de dejar preguntas sueltas en el banco sin quiz.
   */
  async aceptarPropuestas(): Promise<void> {
    const q = this.quiz();
    const bankId = this.bancoDestino() ?? this.bancoElegido() ?? this.bancos[0]?.id ?? null;
    const marcadas = [...this.aceptadas()].sort((a, b) => a - b);
    if (!q || !bankId || !marcadas.length) return;

    this.guardando.set(true);
    let creadas = 0;
    try {
      for (const i of marcadas) {
        const p = this.propuestas()[i];
        if (!p) continue;
        const abierta = p.tipo === 'TEXTO_ABIERTO' || p.tipo === 'NUMERO';
        const nueva = await this.api.crearPregunta(bankId, {
          enunciado: p.enunciado,
          tipo: p.tipo,
          explicacion: p.explicacion ?? undefined,
          activa: true,
          // Queda escrito en el banco que la propuso el modelo: editarle el enunciado después
          // no la convierte en escrita a mano, y eso es lo que hay que poder auditar.
          origen: p.origen,
          criterio: abierta ? (p.criterio ?? null) : null,
          opciones: abierta ? [] : p.opciones.map((o, j) => ({
            texto: o.texto,
            correcta: !!o.correcta,
            pareja_clave: o.pareja_clave ?? undefined,
            orden: j,
          })),
        });
        this.quiz.set(await this.api.agregarPreguntasAlQuiz(q.id, [nueva.id], 'IA'));
        // El atajo solo si el material respalda la pregunta y no se descartó a mano.
        if (p.block_id && !this.atajosDescartados().has(i)) {
          this.quiz.set(await this.api.referenciaDePregunta(
            q.id, nueva.id, p.block_id, p.segundo));
        }
        creadas++;
      }
      this.propuestas.set([]);
      this.aceptadas.set(new Set());
      this.atajosDescartados.set(new Set());
      await this.buscar();
      this.cambiado.emit();
      Swal.fire('Listo', `Se agregaron ${creadas} pregunta(s) al quiz y al banco.`, 'success');
    } catch (e: any) {
      Swal.fire('Se guardaron a medias',
        `Alcanzaron a crearse ${creadas}. ${e?.error?.message ?? ''}`.trim(), 'warning');
    } finally {
      this.guardando.set(false);
    }
  }

  /** "3:20" a partir de los segundos, como lo muestra el reproductor. */
  minuto(segundos: number | null | undefined): string {
    if (segundos == null) return '';
    return Math.floor(segundos / 60) + ':' + String(segundos % 60).padStart(2, '0');
  }

  // ── Crear una pregunta sin salir de aquí ──────────────────────────────────

  abrirNuevaPregunta(): void {
    this.nuevaPregunta.set({
      enunciado: '',
      cuerpo_html: '',
      media_tipo: null, media_document_id: null, media_mime: null,
      tipo: 'VERDADERO_FALSO',
      explicacion: '',
      criterio: null,
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
  cambiarTipoNueva(tipo: TipoPreguntaForm): void {
    this.nuevaPregunta.update(f => {
      if (!f) return f;
      // Las abiertas no llevan opciones y sí criterio; las de marcar, al revés. Cambiar de
      // tipo cambia la pregunta entera, no sólo su etiqueta.
      if (tipo === 'TEXTO_ABIERTO') {
        return { ...f, tipo, opciones: [],
                 criterio: { modo: 'TEXTO_CONTIENE', contiene: [] } };
      }
      if (tipo === 'NUMERO') {
        return { ...f, tipo, opciones: [],
                 criterio: { modo: 'NUMERO_RANGO', min: null, max: null } };
      }
      if (tipo === 'EMPAREJAR') {
        // Dos parejas para empezar: con una sola no hay nada que emparejar —la respuesta es
        // la única posible— y el ejercicio no mide nada.
        return { ...f, tipo, criterio: null, opciones: [
          { texto: '', correcta: false, pareja_clave: 'a', orden: 0 },
          { texto: '', correcta: false, pareja_clave: 'a', orden: 1 },
          { texto: '', correcta: false, pareja_clave: 'b', orden: 2 },
          { texto: '', correcta: false, pareja_clave: 'b', orden: 3 },
        ] };
      }
      const opciones: Opcion[] = tipo === 'VERDADERO_FALSO'
        ? [{ texto: 'Verdadero', correcta: true, orden: 0 },
           { texto: 'Falso', correcta: false, orden: 1 }]
        : [{ texto: '', correcta: true, orden: 0 }, { texto: '', correcta: false, orden: 1 }];
      return { ...f, tipo, opciones, criterio: null };
    });
  }

  /** true si la pregunta que se está escribiendo es de emparejar. */
  readonly nuevaEsEmparejar = computed(() => this.nuevaPregunta()?.tipo === 'EMPAREJAR');

  /** Las parejas de la pregunta nueva, agrupadas por su letra. */
  readonly parejasNuevas = computed(() => {
    const ops = this.nuevaPregunta()?.opciones ?? [];
    const claves: string[] = [];
    for (const o of ops) {
      const c = o.pareja_clave ?? '';
      if (c && !claves.includes(c)) claves.push(c);
    }
    return claves.map(c => ({
      clave: c,
      indices: ops.map((o, i) => o.pareja_clave === c ? i : -1).filter(i => i >= 0),
    }));
  });

  /** Añade una pareja: dos filas con la misma letra, que es lo que las une. */
  agregarPareja(): void {
    this.nuevaPregunta.update(f => {
      if (!f) return f;
      const clave = String.fromCharCode(97 + this.parejasNuevas().length);
      const n = f.opciones.length;
      return { ...f, opciones: [
        ...f.opciones,
        { texto: '', correcta: false, pareja_clave: clave, orden: n },
        { texto: '', correcta: false, pareja_clave: clave, orden: n + 1 },
      ] };
    });
  }

  quitarPareja(clave: string): void {
    this.nuevaPregunta.update(f => f
      ? { ...f, opciones: f.opciones.filter(o => o.pareja_clave !== clave)
                                    .map((o, i) => ({ ...o, orden: i })) }
      : f);
  }

  /** Sube la imagen de UNA opción. Va al mismo sitio que el material de la pregunta. */
  async subirImagenDeOpcion(i: number, evento: Event): Promise<void> {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0];
    const bankId = this.bancoDestino() ?? this.bancoElegido() ?? this.bancos[0]?.id ?? null;
    if (!archivo || !bankId) return;
    input.value = '';

    if (archivo.size > 5 * 1024 * 1024) {
      Swal.fire('Imagen muy grande',
        'La imagen de una opción no puede pasar de 5 MB. Se ven varias a la vez y el quiz se '
        + 'contesta en el celular.', 'info');
      return;
    }
    this.guardando.set(true);
    try {
      const documentId = await this.api.subirMediaDePregunta(archivo, bankId);
      this.editarOpcion(i, { media_document_id: documentId, media_mime: archivo.type || null });
    } catch (e: any) {
      Swal.fire('No se pudo subir', e?.error?.message ?? 'Inténtalo de nuevo.', 'error');
    } finally {
      this.guardando.set(false);
    }
  }

  quitarImagenDeOpcion(i: number): void {
    this.editarOpcion(i, { media_document_id: null, media_mime: null });
  }

  /** true si la pregunta que se está escribiendo se responde escribiendo. */
  readonly nuevaEsAbierta = computed(() => {
    const t = this.nuevaPregunta()?.tipo;
    return t === 'TEXTO_ABIERTO' || t === 'NUMERO';
  });

  editarCriterio(parche: Partial<CriterioPregunta>): void {
    this.nuevaPregunta.update(f => f
      ? { ...f, criterio: { ...(f.criterio ?? { modo: 'TEXTO_CONTIENE' }), ...parche } as CriterioPregunta }
      : f);
  }

  /** Los términos se escriben uno por línea, como en el constructor de exámenes. */
  terminosTexto(): string {
    return (this.nuevaPregunta()?.criterio?.contiene ?? []).join('\n');
  }

  cambiarTerminos(texto: string): void {
    this.editarCriterio({ contiene: texto.split('\n').map(t => t.trim()).filter(Boolean) });
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
    if (f.enunciado.trim().length <= 3) return false;

    if (f.tipo === 'EMPAREJAR') {
      // Cada pareja tiene que estar completa: una fila suelta no empareja con nada, y el
      // servidor la rechaza. Mejor apagar el botón que enseñar el error después.
      const parejas = this.parejasNuevas();
      return parejas.length >= 2
          && parejas.every(par => par.indices.length === 2
                && par.indices.every(i => (f.opciones[i]?.texto ?? '').trim().length > 0
                                       || !!f.opciones[i]?.media_document_id));
    }

    if (this.nuevaEsAbierta()) {
      const c = f.criterio;
      if (!c) return false;
      // Las mismas reglas que enforza el servidor, dichas antes de intentar guardar: una
      // pregunta abierta sin criterio es una pregunta que nadie puede aprobar.
      if (c.modo === 'TEXTO_CONTIENE') return (c.contiene ?? []).length > 0;
      if (c.modo === 'TEXTO_SIMILITUD') return !!c.respuesta_modelo?.trim();
      if (c.modo === 'NUMERO_RANGO') return c.min != null || c.max != null;
      return true;   // PRESENCIA y MANUAL no piden nada más
    }
    return f.opciones.every(o => o.texto.trim().length > 0)
        && f.opciones.some(o => o.correcta);
  });

  /** Crea la pregunta en el banco elegido y la engancha al quiz en un solo paso. */
  async guardarNuevaPregunta(): Promise<void> {
    const f = this.nuevaPregunta();
    const bankId = this.bancoDestino() ?? this.bancoElegido() ?? this.bancos[0]?.id ?? null;
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
        criterio: this.nuevaEsAbierta() ? f.criterio : null,
        origen: 'MANUAL',
        opciones: this.nuevaEsAbierta()
          ? []
          : f.opciones.map((o, i) => ({ ...o, texto: o.texto.trim(), orden: i })),
      });
      this.quiz.set(await this.api.agregarPreguntasAlQuiz(q.id, [creada.id], 'NUEVA'));
      // Se rebusca para que la recién creada no reaparezca como disponible: ya está en el quiz.
      await this.buscar();
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
    const bankId = this.bancoDestino() ?? this.bancoElegido() ?? this.bancos[0]?.id ?? null;
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
      this.quiz.set(await this.api.agregarPreguntasAlQuiz(q.id, [p.id], 'BANCO'));
      await this.buscar();
      this.cambiado.emit();
    } catch (e: any) {
      Swal.fire('No se pudo agregar', e?.error?.message ?? 'Inténtalo de nuevo.', 'error');
    } finally {
      this.guardando.set(false);
    }
  }

  /** ¿Esta pregunta entra siempre, aunque el resto se sortee? */
  esObligatoria(p: Pregunta): boolean {
    return (this.quiz()?.obligatorias ?? []).includes(p.id);
  }

  async alternarObligatoria(p: Pregunta): Promise<void> {
    const q = this.quiz();
    if (!q) return;
    this.guardando.set(true);
    try {
      this.quiz.set(await this.api.obligatoriaDePregunta(q.id, p.id, !this.esObligatoria(p)));
    } catch (e: any) {
      Swal.fire('No se pudo marcar', e?.error?.message ?? 'Inténtalo de nuevo.', 'error');
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

/** Las partes plegables del editor del quiz. */
type SeccionQuiz = 'calificacion' | 'ajustes' | 'preguntas' | 'agregar';

/** Las tres formas de meter una pregunta en el quiz. */
type ModoAgregar = 'IA' | 'NUEVA' | 'BANCO';

/** La etiqueta de origen que se pinta en la fila de la pregunta. */
interface EtiquetaOrigen {
  texto: string;
  icono: string;
  clase: string;
  titulo: string;
}

/** Lo que se escribe al crear una pregunta desde aquí. */
interface FormPregunta {
  enunciado: string;
  /** Texto enriquecido de apoyo, y la foto o el vídeo sobre el que se pregunta. */
  cuerpo_html: string;
  media_tipo: 'IMAGEN' | 'VIDEO' | null;
  media_document_id: string | null;
  media_mime: string | null;
  tipo: TipoPreguntaForm;
  explicacion: string;
  criterio: CriterioPregunta | null;
  opciones: Opcion[];
}

type TipoPreguntaForm = 'VERDADERO_FALSO' | 'OPCION_MULTIPLE' | 'EMPAREJAR'
  | 'TEXTO_ABIERTO' | 'NUMERO';

interface BorradorActividad {
  tipo: string;
  instrucciones: string;
  revision: string;
  puntaje_max?: number;
  obligatoria: boolean;
  calificable: boolean;
  peso: number | null;
  /** Sólo CODIGO. */
  ejercicio: EjercicioCodigo | null;
}

interface BorradorQuiz {
  intentos_max: number;
  feedback_inmediato: boolean;
  /** Cuántas preguntas salen de las que tiene. null = todas. */
  preguntas_por_intento: number | null;
  barajar_preguntas: boolean;
  barajar_opciones: boolean;
  modo_presentacion: 'TODAS' | 'UNA_POR_UNA';
  permite_volver: boolean;
  mostrar_respuesta_correcta: boolean;
  tipo: TipoQuiz;
  calificable: boolean;
  peso: number | null;
  nota_minima: number | null;
  /** Modo examen: sin pegar en lo escrito ni copiar el enunciado. */
  bloquea_pegado: boolean;
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
