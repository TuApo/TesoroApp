import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  CdkDrag, CdkDragDrop, CdkDragHandle, CdkDragPlaceholder, CdkDropList, CdkDropListGroup,
  moveItemInArray, transferArrayItem,
} from '@angular/cdk/drag-drop';
import { MatSnackBar } from '@angular/material/snack-bar';
import { forkJoin } from 'rxjs';
import Swal from 'sweetalert2';

import { environment } from '@/environments/environment';
import { DynamicFormService } from '../../services/dynamic-form.service';
import { FieldTypeService } from '../../services/field-type.service';
import { MatDialog } from '@angular/material/dialog';
import {
  FormAccessDialogComponent, FormAccessDialogData,
} from '../../components/form-access-dialog/form-access-dialog.component';
import { FormAccessConfig, FormColumn } from '../../models/process.models';
import { PlacementService } from '../../services/placement.service';
import {
  ApiProblem, BuilderRequest, DynamicField, FieldTypeInfo, FormDetail, FormSection,
  FormTheme, FormUi,
} from '../../models/dynamic-forms.models';
import { FIN_DEL_FORMULARIO, tieneRamificacion } from '../../models/form-routing';
import { PRESETS_TEMA, PresetTema, temaEfectivo } from '../../models/form-theme';
import { campoDesdeBorrador, seccionesDesdeBorrador } from '../../models/form-drafts';
import {
  ESTILOS_PORTADA, EstiloPortada, FormDesignService, SugerenciaDiseno,
} from '../../services/form-design.service';
import { ModuleNode, Placement, PlacementRequest } from '../../models/placement.models';
import {
  FieldConfigCardComponent, clonarCampoParaDuplicar, crearCampoDesdeTipo,
} from '../../components/field-config-card/field-config-card.component';
import { DispositivoPreview, FormPreviewComponent } from '../../components/form-preview/form-preview.component';
import { ModuleTreePickerComponent } from '../../components/module-tree-picker/module-tree-picker.component';
import { FieldTypePickerComponent } from '../../components/field-type-picker/field-type-picker.component';
import { FormStartComponent, InicioElegido } from '../../components/form-start/form-start.component';
import {
  AiQuestionsDialogComponent, ContextoFormulario, PropuestaAceptada,
} from '../../components/ai-questions-dialog/ai-questions-dialog.component';
import { ExcelImportDialogComponent } from '../../components/excel-import-dialog/excel-import-dialog.component';
import { FormImportService } from '../../services/form-import.service';
import { ImportedForm } from '../../models/form-import.models';
import { leerUsuarioCrudo } from '@/app/core/utils/usuario-actual';
import { getLocalStorageItem, setLocalStorageItem } from '@/app/core/utils/safe-storage';

/**
 * Deriva el slug en cliente (solo para la vista previa; la ruta canónica la
 * calcula el backend): minúsculas, NFD sin diacríticos, no-alfanumérico→'-',
 * sin guiones en los extremos.
 */
function derivarSlug(texto: string): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Clave corta y única para identificar la portada de un formulario que todavía no
 * existe en la base. `crypto.randomUUID` no está en todos los WebView del APK, de ahí
 * el respaldo.
 */
function claveAleatoria(): string {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (c?.randomUUID) return c.randomUUID().slice(0, 12);
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/**
 * En qué maqueta se mira la vista previa. Es una preferencia de TRABAJO de quien
 * construye —no del formulario— así que se recuerda en el navegador y no viaja al API.
 */
const CLAVE_VISTA_PREVIA = 'formularios:vistaPrevia';

function leerVistaPrevia(): DispositivoPreview {
  return getLocalStorageItem(CLAVE_VISTA_PREVIA) === 'escritorio' ? 'escritorio' : 'movil';
}

/** Paneles plegables de la columna central del constructor. */
type PanelKey = 'datos' | 'diseno' | 'permisos' | 'ubicacion';

/**
 * Constructor de Formularios Dinámicos — 2 columnas:
 *   metadatos + secciones con tarjetas de campo | preview teléfono.
 * Los campos se agregan SIEMPRE por el selector de tipo (`abrirPickerDeCampo`), que es
 * el mismo camino en escritorio y en móvil; ya no hay paleta lateral que arrastrar.
 *
 * Estado 100% con signals e INMUTABLE: toda mutación de secciones/campos crea
 * arrays y objetos nuevos para que OnPush repinte (el preview se deriva de aquí).
 *
 * Dos modos por ruta:
 *  - /builder            → creación (permisos de llenado + createBuilder)
 *  - /:formId/editar     → edición  (precarga get+structure; editBuilder publica v n+1)
 *
 * Los `name` de los campos NO se editan en UI: los genera el backend desde el label.
 */
@Component({
  selector: 'app-form-builder',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule,
    CdkDropListGroup, CdkDropList, CdkDrag, CdkDragHandle, CdkDragPlaceholder,
    FieldConfigCardComponent, FormPreviewComponent,
    ModuleTreePickerComponent, FieldTypePickerComponent,
    FormStartComponent, AiQuestionsDialogComponent, ExcelImportDialogComponent,
  ],
  templateUrl: './form-builder.component.html',
  styleUrl: './form-builder.component.css',
})
export class FormBuilderComponent {
  private formsSvc = inject(DynamicFormService);
  private tiposSvc = inject(FieldTypeService);
  private placementSvc = inject(PlacementService);
  private designSvc = inject(FormDesignService);
  private importSvc = inject(FormImportService);
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private snack = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private destroyRef = inject(DestroyRef);

  private static readonly RUTA_LISTADO = '/dashboard/gestion-del-programa/formularios-dinamicos';

  // ── Metadatos ─────────────────────────────────────────────────────
  nombre = signal('');
  descripcion = signal('');
  categoria = signal('');
  esPublico = signal(false);

  // ── Estructura ────────────────────────────────────────────────────
  sections = signal<FormSection[]>([{ code: 'sec_root', order_no: 1, title: 'Sección 1', fields: [] }]);
  seccionActiva = signal(0);

  // ── Diseño (tema + recorrido) ─────────────────────────────────────
  /**
   * Tema en edición. Arranca en el preset institucional para que un formulario nuevo
   * no nazca sin identidad; el usuario cambia preset o toquetea colores sueltos.
   */
  readonly presets: PresetTema[] = PRESETS_TEMA;
  tema = signal<FormTheme>({ ...PRESETS_TEMA[0].theme });
  /** Recorrido: paso a paso (default con 2+ secciones) o todo de corrido. */
  pasoAPaso = signal(true);
  mostrarProgreso = signal(true);

  // ── Vista previa ──────────────────────────────────────────────────
  /**
   * El mismo formulario se llena desde el APK y desde un escritorio, así que la
   * maqueta la elige quien construye. En 'escritorio' la vista previa necesita ancho
   * real: la columna se ensancha (ver .fb-layout--ancha).
   */
  vistaPrevia = signal<DispositivoPreview>(leerVistaPrevia());

  cambiarVistaPrevia(d: DispositivoPreview): void {
    this.vistaPrevia.set(d);
    setLocalStorageItem(CLAVE_VISTA_PREVIA, d);
  }

  /** Portada: objectURL para verla aquí; en el tema solo viaja la referencia. */
  portadaUrl = signal<string | null>(null);
  private portadaObjectUrl: string | null = null;

  sugiriendo = signal(false);
  generandoPortada = signal(false);
  sugerencia = signal<SugerenciaDiseno | null>(null);

  /**
   * Prompt de la portada, EDITABLE. Antes se generaba a ciegas con lo que hubiera
   * devuelto la sugerencia (o el nombre pelado), así que la única forma de cambiar la
   * imagen era volver a pedir sugerencia y cruzar los dedos. Ahora se escribe aquí, se
   * puede refinar contra los estándares las veces que haga falta —eso es solo texto, no
   * cuesta imagen— y solo entonces se gasta una generación.
   */
  promptPortada = signal('');
  readonly estilosPortada = ESTILOS_PORTADA;
  estiloPortada = signal<EstiloPortada | ''>('');
  refinando = signal(false);
  notasPrompt = signal<{ resumen: string; tips: string[] } | null>(null);

  /**
   * Dueño de la portada EN ms-documents. Allí un documento se identifica por
   * (ownerId, typeCode): si todas las portadas colgaran del usuario serían versiones
   * del MISMO documento y cambiar una repintaría las de los demás formularios. Un
   * formulario ya guardado usa su id; uno en creación, una clave efímera propia de
   * esta instancia del constructor.
   */
  private readonly ownerPortadaNuevo = `dfform-cover-nuevo-${claveAleatoria()}`;

  private ownerPortada(): string {
    const id = this.formId();
    return id != null ? `dfform-cover-${id}` : this.ownerPortadaNuevo;
  }

  /** Bloque `ui` que se envía al backend. */
  readonly uiActual = computed<FormUi>(() => ({
    theme: this.tema(),
    navigation: { mode: this.pasoAPaso() ? 'wizard' : 'single', progress: this.mostrarProgreso() },
  }));

  /** Tema con los defaults rellenos: lo que leen los selectores de color. */
  readonly temaVista = computed(() => temaEfectivo(this.tema()));

  /**
   * CONTENIDO REAL del formulario para la IA: cada línea es un campo con su sección y su
   * tipo ("Datos del predio › Área sembrada (número)"). Mandar solo etiquetas sueltas
   * hacía que la sugerencia se apoyara casi únicamente en el nombre; con la sección y el
   * tipo la IA sabe de qué se pregunta y con qué profundidad.
   *
   * Va etiqueta, sección y tipo — NUNCA valores de respuestas.
   */
  private contenidoDelFormulario(): string[] {
    const out: string[] = [];
    for (const sec of this.sections()) {
      const seccion = sec.title?.trim() ?? '';
      for (const f of sec.fields) {
        const linea = this.lineaDeCampo(f, seccion);
        if (linea) out.push(linea);
        for (const c of f.children ?? []) {
          const hijo = this.lineaDeCampo(c, seccion ? `${seccion} / ${f.label?.trim() ?? ''}` : f.label?.trim() ?? '');
          if (hijo) out.push(hijo);
        }
      }
      // Una sección todavía sin campos igual dice de qué va el formulario.
      if (seccion && sec.fields.length === 0) out.push(`${seccion} (sección vacía)`);
    }
    return out.slice(0, 40);
  }

  private lineaDeCampo(f: DynamicField, seccion: string): string {
    const etiqueta = f.label?.trim();
    if (!etiqueta) return '';
    const tipo = this.tipos().find(t => t.code === f.type)?.name ?? f.type;
    const base = seccion ? `${seccion} - ${etiqueta}` : etiqueta;
    return `${base} (${tipo}${f.required ? ', obligatorio' : ''})`;
  }

  /** Colores del tema que se le pasan a la IA para que la portada no desentone. */
  private paletaActual(): string[] {
    const t = this.temaVista();
    return [t.primary, t.accent, t.header_from, t.header_to]
      .filter((c): c is string => typeof c === 'string' && /^#[0-9a-fA-F]{3,6}$/.test(c));
  }

  aplicarPreset(preset: PresetTema): void {
    // El preset reemplaza los colores pero RESPETA la portada ya elegida.
    const actual = this.tema();
    this.tema.set({
      ...preset.theme,
      ...(actual.cover_url ? { cover_url: actual.cover_url } : {}),
      ...(actual.cover_document_id ? { cover_document_id: actual.cover_document_id } : {}),
      ...(actual.cover_alt ? { cover_alt: actual.cover_alt } : {}),
    });
  }

  cambiarTema<K extends keyof FormTheme>(clave: K, valor: FormTheme[K]): void {
    this.tema.update(t => ({ ...t, [clave]: valor, preset: 'personalizado' }));
  }

  /** Pide a la IA una identidad visual acorde al tema del formulario. */
  sugerirDiseno(): void {
    const nombre = this.nombre().trim();
    if (!nombre) {
      this.abrirPanel('datos');
      this.snack.open('Ponle nombre al formulario para que la IA sepa de qué se trata.', 'Entendido', { duration: 5000 });
      return;
    }
    this.sugiriendo.set(true);
    this.designSvc.sugerir({
      nombre,
      descripcion: this.descripcion().trim(),
      categoria: this.categoria().trim(),
      campos: this.contenidoDelFormulario(),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: sug => {
          this.sugiriendo.set(false);
          this.sugerencia.set(sug);
          this.tema.update(t => ({ ...t, ...sug.theme, preset: 'ia' }));
          // El prompt propuesto solo entra si el usuario no había escrito el suyo:
          // pisarle lo que escribió sería perder su trabajo.
          if (!this.promptPortada().trim() && sug.cover_prompt) {
            this.promptPortada.set(sug.cover_prompt);
          }
          this.snack.open('Diseño sugerido aplicado. Puedes ajustarlo a mano.', 'OK', { duration: 4000 });
        },
        error: (err: unknown) => {
          this.sugiriendo.set(false);
          this.snack.open(this.mensajeIa(err, 'No se pudo obtener la sugerencia de diseño.'), 'Cerrar', { duration: 6000 });
        },
      });
  }

  /**
   * REFINA el prompt escrito a mano contra los estándares de portada (ilustración
   * corporativa, sin texto, apaisada, coherente con la paleta). Es solo texto: se puede
   * repetir sin gastar generaciones de imagen.
   */
  refinarPrompt(): void {
    const borrador = this.promptPortada().trim();
    const nombre = this.nombre().trim();
    if (!borrador && !nombre) {
      this.abrirPanel('datos');
      this.snack.open('Escribe una idea para la portada, o ponle nombre al formulario.', 'Entendido', { duration: 5000 });
      return;
    }
    this.refinando.set(true);
    this.designSvc.refinarPrompt({
      prompt: borrador,
      nombre,
      descripcion: this.descripcion().trim(),
      campos: this.contenidoDelFormulario(),
      paleta: this.paletaActual(),
      estilo: this.estiloPortada(),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: r => {
          this.refinando.set(false);
          this.promptPortada.set(r.prompt);
          this.notasPrompt.set({ resumen: r.resumen ?? '', tips: r.tips ?? [] });
          this.snack.open('Prompt refinado. Revísalo y genera la portada cuando te guste.', 'OK', { duration: 4500 });
        },
        error: (err: unknown) => {
          this.refinando.set(false);
          this.snack.open(this.mensajeIa(err, 'No se pudo refinar el prompt.'), 'Cerrar', { duration: 6000 });
        },
      });
  }

  /** Vuelve a dejar el prompt en la propuesta de la IA (o en el tema del formulario). */
  restablecerPrompt(): void {
    this.promptPortada.set(this.promptPorDefecto());
    this.notasPrompt.set(null);
  }

  /** Punto de partida cuando el usuario no ha escrito nada. */
  private promptPorDefecto(): string {
    const sugerido = (this.sugerencia()?.cover_prompt || '').trim();
    if (sugerido) return sugerido;
    const nombre = this.nombre().trim();
    return nombre ? `Cover for an internal business form about: ${nombre}` : '';
  }

  /** Genera la portada con IA y la deja subida en ms-documents. */
  generarPortada(): void {
    const prompt = this.promptPortada().trim() || this.promptPorDefecto();
    if (!prompt) {
      this.abrirPanel('datos');
      this.snack.open('Describe la portada (o ponle nombre al formulario) antes de generarla.', 'Entendido', { duration: 5000 });
      return;
    }
    // Lo que se envió es lo que queda escrito: si la IA falla, el texto sigue ahí.
    this.promptPortada.set(prompt);
    this.generandoPortada.set(true);
    this.designSvc.generarPortada(prompt, this.formId() ?? 0, this.ownerPortada())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ref => {
          this.generandoPortada.set(false);
          this.fijarPortada(ref.document_id);
          this.snack.open('Portada generada y guardada.', 'OK', { duration: 4000 });
        },
        error: (err: unknown) => {
          this.generandoPortada.set(false);
          // La cadena es generar → subir: el motivo puede venir de ms-ai o de ms-documents.
          this.snack.open(this.mensajeIa(err, 'No se pudo generar la imagen.'), 'Cerrar', { duration: 7000 });
        },
      });
  }

  /** Portada subida a mano (por si prefieren su propia imagen a la generada). */
  subirPortada(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.snack.open('La portada debe ser una imagen.', 'Cerrar', { duration: 4000 });
      return;
    }
    this.generandoPortada.set(true);
    this.designSvc.subirPortada(file, this.formId() ?? 0, this.ownerPortada())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ref => {
          this.generandoPortada.set(false);
          this.fijarPortada(ref.document_id);
          this.snack.open('Portada actualizada.', 'OK', { duration: 3000 });
        },
        error: (err: unknown) => {
          this.generandoPortada.set(false);
          this.snack.open(
            this.designSvc.motivoDeFallo(err, 'No se pudo subir la portada.'),
            'Cerrar', { duration: 7000 });
        },
      });
  }

  quitarPortada(): void {
    this.revocarPortada();
    this.portadaUrl.set(null);
    this.tema.update(t => {
      const { cover_document_id, cover_url, cover_alt, ...resto } = t;
      // `fijarPortada` había puesto header_style='image'; sin imagen ese valor miente.
      return resto.header_style === 'image' ? { ...resto, header_style: 'gradient' as const } : resto;
    });
  }

  /**
   * Aplica SOLO el diseño al formulario ya publicado. Es un cambio cosmético: el
   * backend lo guarda en el formulario, no en la versión, así que no publica v n+1.
   */
  aplicarDisenoAhora(): void {
    const id = this.formId();
    if (id == null) return;
    this.guardando.set(true);
    this.formsSvc.updateUi(id, this.uiActual())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.guardando.set(false);
          this.snack.open('Diseño aplicado (sin publicar versión nueva).', 'OK', { duration: 4000 });
        },
        error: (err: unknown) => { this.guardando.set(false); this.mostrarErrorApi(err); },
      });
  }

  private fijarPortada(documentId: number): void {
    this.tema.update(t => ({ ...t, cover_document_id: documentId, header_style: 'image' }));
    this.cargarPortada(documentId);
  }

  private cargarPortada(documentId: number): void {
    this.designSvc.portadaBlobUrl(documentId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: url => { this.revocarPortada(); this.portadaObjectUrl = url; this.portadaUrl.set(url); },
        error: () => this.portadaUrl.set(null),
      });
  }

  private revocarPortada(): void {
    if (this.portadaObjectUrl) {
      URL.revokeObjectURL(this.portadaObjectUrl);
      this.portadaObjectUrl = null;
    }
  }

  private mensajeIa(err: unknown, porDefecto: string): string {
    if (err instanceof HttpErrorResponse) {
      const detalle = (err.error as { error?: string } | null)?.error;
      if (detalle) return detalle;
      if (err.status === 429) return 'Demasiadas peticiones a la IA; espera unos segundos.';
    }
    return porDefecto;
  }

  // ── Punto de partida y asistente de preguntas ─────────────────────
  /**
   * Portada del constructor: plantilla, borrador con IA o lienzo en blanco. Se abre sola
   * al entrar a /builder (creación) y a petición desde el encabezado — también editando,
   * donde lo elegido se agrega al final salvo que se pida reemplazar.
   */
  mostrarInicio = signal(false);
  /** Asistente de preguntas: propone lo que falta, en creación y en edición. */
  asistenteAbierto = signal(false);
  /** Carga por Excel: plantilla ya parametrizada + archivo lleno. */
  importarAbierto = signal(false);

  /**
   * Lo que el asistente necesita saber del formulario: nunca respuestas de nadie.
   * Es `computed` y no un método porque el diálogo lo recibe como input: recalcularlo
   * en cada ciclo de detección le cambiaría la identidad del objeto a cada rato.
   */
  readonly contextoIa = computed<ContextoFormulario>(() => ({
    nombre: this.nombre().trim(),
    descripcion: this.descripcion().trim(),
    categoria: this.categoria().trim(),
    secciones: this.sections().map((s, i) => s.title?.trim() || `Sección ${i + 1}`),
    contenido: this.contenidoDelFormulario(),
  }));

  /**
   * Aplica el punto de partida elegido. Lo que trae la plantilla o la IA es un BORRADOR:
   * entra al constructor como si se hubiera armado a mano y desde ahí se edita.
   *
   * Reemplazar es destructivo, así que si ya había campos se pregunta primero (la
   * portada se puede reabrir con el formulario a medias).
   */
  async aplicarInicio(elegido: InicioElegido): Promise<void> {
    if (elegido.origen === 'excel') {
      this.mostrarInicio.set(false);
      this.importarAbierto.set(true);
      return;
    }
    if (elegido.origen === 'blanco' || !elegido.secciones?.length) {
      this.mostrarInicio.set(false);
      return;
    }
    const secciones = seccionesDesdeBorrador(elegido.secciones);
    if (!secciones.length) { this.mostrarInicio.set(false); return; }

    // Con el lienzo vacío no hay nada que perder; con contenido, quien decide es el
    // usuario: agregar al final es lo seguro, reemplazar borra lo que llevaba (y en
    // edición, además, se publicaría como versión nueva).
    let reemplazar = this.totalCampos() === 0;
    if (this.totalCampos() > 0) {
      const conf = await Swal.fire({
        icon: 'question',
        title: 'Ya tienes preguntas',
        text: 'Puedes agregar lo elegido al final o reemplazar todo lo que llevas.',
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: 'Agregar al final',
        denyButtonText: 'Reemplazar todo',
        cancelButtonText: 'Cancelar',
      });
      if (!conf.isConfirmed && !conf.isDenied) return;
      reemplazar = conf.isDenied;
    }

    if (reemplazar) {
      this.fijarSecciones(secciones);
      this.seccionActiva.set(0);
      // Los metadatos solo se rellenan si el usuario no había escrito los suyos.
      if (elegido.nombre && !this.nombre().trim()) this.nombre.set(elegido.nombre);
      if (elegido.descripcion && !this.descripcion().trim()) this.descripcion.set(elegido.descripcion);
      if (elegido.categoria && !this.categoria().trim()) this.categoria.set(elegido.categoria);
      // Una plantilla trae además el look con el que fue pensada; al agregar al final no
      // se toca el tema, que es del formulario que ya existía.
      const preset = this.presets.find(p => p.id === elegido.preset);
      if (preset) this.aplicarPreset(preset);
      if (elegido.icono) this.tema.update(t => ({ ...t, icon: elegido.icono! }));
    } else {
      const actuales = this.clonarSecciones();
      const nuevas = secciones.map((sec, i) => ({ ...sec, order_no: actuales.length + i + 1 }));
      this.fijarSecciones([...actuales, ...nuevas]);
      this.seccionActiva.set(actuales.length);
    }

    this.mostrarInicio.set(false);
    this.abrirPanel('datos');
    const cuantas = secciones.reduce((a, sec) => a + sec.fields.length, 0);
    const que = elegido.origen === 'ia' ? 'Borrador' : 'Plantilla';
    this.snack.open(
      reemplazar
        ? `${que} cargada: ${cuantas} preguntas. Revísalas y ajústalas antes de guardar.`
        : `${que} agregada al final: ${cuantas} preguntas. Revísalas antes de guardar.`,
      'OK', { duration: 5000 });
  }

  /**
   * Inserta las preguntas que el usuario marcó en el asistente. Es ADITIVO: nunca toca
   * lo que ya existe. `seccionIndex === -1` crea una sección nueva, y todas las que
   * pidan el mismo título comparten esa sección en vez de crear una por pregunta.
   */
  insertarPropuestas(propuestas: PropuestaAceptada[]): void {
    if (!propuestas.length) return;
    const secs = this.clonarSecciones();
    const nuevasPorTitulo = new Map<string, number>();
    let ultima = this.seccionActiva();

    for (const p of propuestas) {
      let destino = p.seccionIndex;
      if (destino < 0 || destino >= secs.length) {
        const titulo = (p.nuevaSeccion || 'Preguntas sugeridas').trim();
        const ya = nuevasPorTitulo.get(titulo.toLowerCase());
        if (ya != null) {
          destino = ya;
        } else {
          secs.push({ order_no: secs.length + 1, title: titulo, fields: [] });
          destino = secs.length - 1;
          nuevasPorTitulo.set(titulo.toLowerCase(), destino);
        }
      }
      secs[destino].fields.push(campoDesdeBorrador(p.campo, secs[destino].fields.length));
      ultima = destino;
    }

    this.fijarSecciones(secs);
    this.seccionActiva.set(ultima);
    this.asistenteAbierto.set(false);
    this.snack.open(
      propuestas.length === 1
        ? 'Pregunta agregada. Revísala antes de guardar.'
        : `${propuestas.length} preguntas agregadas. Revísalas antes de guardar.`,
      'OK', { duration: 5000 });
  }

  // ── Carga por Excel ───────────────────────────────────────────────

  /**
   * Vuelca en el constructor un formulario leído de un Excel: metadatos, secciones con
   * sus preguntas, roles de llenado y ubicación en el menú. Es exactamente lo que se
   * habría armado a mano —de hecho es el mismo `BuilderRequest` que se guardaría—, así
   * que desde aquí todo se edita igual y NADA se ha guardado todavía.
   */
  aplicarImportado(f: ImportedForm): void {
    if (this.totalCampos() === 0) {
      this.volcarImportado(f, true);
      return;
    }
    // Con contenido a medias, reemplazar es destructivo: decide el usuario.
    void Swal.fire({
      icon: 'question',
      title: 'Ya tienes preguntas',
      text: 'Puedes agregar las del archivo al final o reemplazar todo lo que llevas.',
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: 'Agregar al final',
      denyButtonText: 'Reemplazar todo',
      cancelButtonText: 'Cancelar',
    }).then(r => {
      if (r.isConfirmed) this.volcarImportado(f, false);
      else if (r.isDenied) this.volcarImportado(f, true);
    });
  }

  private volcarImportado(f: ImportedForm, reemplazar: boolean): void {
    // Clon profundo: el estado del constructor es suyo, no el objeto de la respuesta HTTP.
    const secciones = structuredClone(f.form.sections ?? []);
    if (!secciones.length) {
      this.snack.open('El archivo no trajo preguntas para este formulario.', 'Cerrar', { duration: 5000 });
      return;
    }

    let avisoRutas = false;
    if (reemplazar) {
      this.fijarSecciones(secciones);
      this.seccionActiva.set(0);
      this.nombre.set(f.form.name ?? '');
      this.descripcion.set(f.form.description ?? '');
      this.categoria.set(f.form.category ?? '');
      this.esPublico.set(!!f.form.is_public);
      // El tema no viaja en el Excel (es visual): se queda el preset que ya hubiera.
      this.pasoAPaso.set(f.form.ui?.navigation?.mode !== 'single');
      this.mostrarProgreso.set(f.form.ui?.navigation?.progress !== false);
      this.aplicarUbicacionImportada(f);
    } else {
      // Al agregar al final, los códigos de sección del archivo se regeneran para no chocar
      // con los que ya existen — y una ruta que cite el código viejo apuntaría a otra
      // sección. Se quitan los saltos de lo importado y se avisa: mejor sin ramificación
      // que con una ramificación equivocada.
      const actuales = this.clonarSecciones();
      avisoRutas = secciones.some(sec => sec.next_section || sec.fields?.some(c => c.schema?.routing));
      const nuevas = secciones.map((sec, i) => ({
        ...sec,
        code: undefined,
        next_section: null,
        order_no: actuales.length + i + 1,
        fields: (sec.fields ?? []).map(c => c.schema?.routing ? { ...c, schema: { ...c.schema, routing: undefined } } : c),
      }));
      this.fijarSecciones([...actuales, ...nuevas]);
      this.seccionActiva.set(actuales.length);
    }

    this.importarAbierto.set(false);
    this.mostrarInicio.set(false);
    this.abrirPanel('datos');
    const cuantas = secciones.reduce((a, sec) => a + (sec.fields?.length ?? 0), 0);
    this.snack.open(
      `Archivo cargado: ${cuantas} pregunta(s) en ${secciones.length} sección(es).`
      + (avisoRutas ? ' Los saltos entre secciones del archivo se quitaron al agregarlo al final.' : '')
      + ' Revísalas y guarda cuando estés listo.',
      'OK', { duration: 7000 });
  }

  /** Destino y permisos que venían escritos en el archivo (solo al reemplazar). */
  private aplicarUbicacionImportada(f: ImportedForm): void {
    const roles = f.placement?.fill_role_ids ?? f.form.fill_role_ids ?? [];
    if (roles.length) this.rolesSel.set([...roles]);
    const padre = f.placement?.parent_module_id;
    if (padre) {
      this.ubicPadre.set(padre);
      this.noPublicar.set(false);
      // El selector de módulos vive dentro del panel plegado: abrirlo lo monta, con lo que
      // se preselecciona el módulo del archivo y el resumen deja de decir que falta elegirlo.
      this.abrirPanel('ubicacion');
    }
    if (f.placement?.menu_label) this.ubicLabel.set(f.placement.menu_label);
    if (f.placement?.icon) this.ubicIcono.set(f.placement.icon);
    if (f.placement?.order_no != null) this.ubicOrden.set(f.placement.order_no);
    this.ubicRespuestas.set(f.placement?.responses_menu_enabled !== false);
  }

  // ── Catálogos y permisos ──────────────────────────────────────────
  tipos = signal<FieldTypeInfo[]>([]);
  /**
   * Roles importados de un Excel (`fill_role_ids`). El catálogo de roles ya no se carga
   * aquí: lo pide el diálogo de permisos junto con grupos, oficinas y personas, que es
   * donde de verdad se eligen. Esto solo conserva lo que venga escrito en un archivo.
   */
  rolesSel = signal<string[]>([]);

  // ── Ubicación en el menú (solo en creación) ───────────────────────
  // El BuilderRequest NO lleva menu_parent_module_id: el formulario nace PENDING
  // y, si el usuario eligió ubicación y no marcó "no publicar", se publica con
  // placementService.place() justo después de crearlo.
  ubicPadre = signal<string | null>(null);
  ubicPadreNodo = signal<ModuleNode | null>(null);
  ubicLabel = signal<string>('');
  ubicIcono = signal<string>('dynamic_form');
  ubicOrden = signal<number | null>(null);
  ubicRespuestas = signal<boolean>(true);
  noPublicar = signal<boolean>(false);

  /** Ruta final estimada: /dashboard/{route_path del padre}/{slug de la etiqueta}. */
  readonly rutaUbicPreview = computed(() => {
    const n = this.ubicPadreNodo();
    if (!n) return '';
    const rp = (n.route_path ?? '').replace(/^\/+|\/+$/g, '');
    const etiqueta = this.ubicLabel().trim() || this.nombre().trim();
    const slug = derivarSlug(etiqueta) || '…';
    return `/dashboard/${rp ? rp + '/' : ''}${slug}`;
  });

  // ── Paneles plegables de la columna central ───────────────────────
  /**
   * Los paneles de configuración (datos, permisos, ubicación) ocupaban toda la primera
   * pantalla y empujaban los campos —lo que de verdad se está armando— fuera de la vista.
   * Ahora se pliegan: solo "Datos" arranca abierto (trae el nombre, que es obligatorio) y
   * cada cabecera lleva un RESUMEN de lo configurado para que plegado no signifique
   * olvidado.
   */
  readonly paneles = signal<Record<PanelKey, boolean>>({
    datos: true,
    diseno: false,
    permisos: false,
    ubicacion: false,
  });

  panelAbierto(key: PanelKey): boolean {
    return this.paneles()[key];
  }

  alternarPanel(key: PanelKey): void {
    this.paneles.update(p => ({ ...p, [key]: !p[key] }));
  }

  abrirPanel(key: PanelKey): void {
    this.paneles.update(p => (p[key] ? p : { ...p, [key]: true }));
  }

  /** Resúmenes de cabecera: lo esencial de cada panel cuando está plegado. */
  readonly resumenDatos = computed(() => {
    const n = this.nombre().trim();
    const cat = this.categoria().trim();
    if (!n) return 'Sin nombre';
    return cat ? `${n} · ${cat}` : n;
  });

  readonly resumenDiseno = computed(() => {
    const t = this.tema();
    const preset = this.presets.find(p => p.id === t.preset)?.nombre
      ?? (t.preset === 'ia' ? 'Sugerido por IA' : 'Personalizado');
    const recorrido = this.pasoAPaso() ? 'paso a paso' : 'de corrido';
    return `${preset} · ${recorrido}${t.cover_document_id || t.cover_url ? ' · con portada' : ''}`;
  });

  readonly resumenUbicacion = computed(() => {
    if (this.noPublicar()) return 'Sin publicar por ahora';
    const nodo = this.ubicPadreNodo();
    if (!nodo) return 'Falta elegir el módulo padre';
    const etiqueta = this.ubicLabel().trim() || this.nombre().trim() || 'Formulario';
    return `${nodo.label} › ${etiqueta}`;
  });

  // ── Modo / progreso ───────────────────────────────────────────────
  formId = signal<number | null>(null);
  versionActual = signal(0);
  cargando = signal(false);
  guardando = signal(false);

  esEdicion = computed(() => this.formId() != null);

  /** Total de campos contando los hijos de SECTION (para el contador del header). */
  totalCampos = computed(() =>
    this.sections().reduce(
      (acc, s) => acc + s.fields.reduce((a, f) => a + 1 + (f.children?.length ?? 0), 0),
      0,
    ));

  constructor() {
    this.tiposSvc.fieldTypes()
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: ts => this.tipos.set(ts),
        error: () => this.snack.open('No se pudo cargar el catálogo de tipos de campo.', 'OK', { duration: 5000 }),
      });

    const idParam = this.route.snapshot.paramMap.get('formId');
    if (idParam) {
      this.formId.set(Number(idParam));
      this.cargarEdicion(Number(idParam));
    } else {
      // El listado pudo dejar un formulario leído de un Excel: entonces no hay nada que
      // elegir —ya se eligió allá— y se entra directo al lienzo con todo cargado.
      const importado = this.importSvc.tomarPendiente();
      if (importado) this.aplicarImportado(importado);
      else this.mostrarInicio.set(true);
    }
  }

  // ── Carga inicial ─────────────────────────────────────────────────

  private cargarEdicion(id: number): void {
    this.cargando.set(true);
    forkJoin({ detalle: this.formsSvc.get(id), estructura: this.formsSvc.structure(id) })
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: ({ detalle, estructura }) => {
          this.nombre.set(detalle.name);
          this.descripcion.set(detalle.description ?? '');
          this.categoria.set(detalle.category ?? '');
          this.esPublico.set(detalle.is_public);
          this.aplicarUiCargada(detalle.ui ?? estructura.ui ?? null);
          this.versionActual.set(estructura.version.version);
          // Clon profundo: el estado del builder es nuestro, no el objeto del HTTP cache.
          this.fijarSecciones(structuredClone(estructura.sections));
          this.seccionActiva.set(0);
          this.cargando.set(false);
        },
        error: (err: unknown) => {
          this.cargando.set(false);
          const problema = this.comoProblema(err);
          void Swal.fire({
            icon: 'error',
            title: 'No se pudo cargar el formulario',
            text: problema?.detail || 'Error inesperado del servidor.',
          }).then(() => this.irAlListado());
        },
      });
  }

  /** Vuelca en el editor el tema guardado; sin tema, se queda el preset por defecto. */
  private aplicarUiCargada(ui: FormUi | null): void {
    if (ui?.theme) this.tema.set({ ...ui.theme });
    // Sin `mode` guardado se asume paso a paso: es el default del runtime.
    this.pasoAPaso.set(ui?.navigation?.mode !== 'single');
    this.mostrarProgreso.set(ui?.navigation?.progress !== false);
    const docId = ui?.theme?.cover_document_id;
    if (docId) this.cargarPortada(docId);
    else if (ui?.theme?.cover_url) this.portadaUrl.set(ui.theme.cover_url);
  }

  // ── Secciones ─────────────────────────────────────────────────────

  agregarSeccion(): void {
    const secs = [...this.sections()];
    secs.push({ order_no: secs.length + 1, title: `Sección ${secs.length + 1}`, fields: [] });
    this.fijarSecciones(secs);
    this.seccionActiva.set(secs.length - 1);
  }

  /**
   * Escribe el signal asegurando que TODA sección tenga `code` estable antes de que
   * alguien pueda apuntarle una ruta. El criterio es el mismo del servidor
   * (sec_root para la primera, sec_N para el resto), así el code que se ve en el
   * constructor es el que queda publicado.
   */
  private fijarSecciones(secs: FormSection[]): void {
    const usados = new Set<string>();
    const conCodigo = secs.map((sec, i) => {
      if (sec.code && !usados.has(sec.code)) {
        usados.add(sec.code);
        return sec;
      }
      let code = i === 0 && !usados.has('sec_root') ? 'sec_root' : `sec_${i + 1}`;
      let n = 2;
      while (usados.has(code)) code = `sec_${i + 1}_${n++}`;
      usados.add(code);
      return { ...sec, code };
    });
    this.sections.set(conCodigo);
  }

  renombrarSeccion(i: number, titulo: string): void {
    const secs = [...this.sections()];
    secs[i] = { ...secs[i], title: titulo };
    this.fijarSecciones(secs);
  }

  quitarSeccion(i: number): void {
    if (this.sections()[i].fields.length > 0) return; // solo si está vacía
    const codigo = this.sections()[i].code;
    // Quitar la sección deja huérfana cualquier ruta que apuntara a ella; publicar así
    // fallaría con "apunta a una sección que no existe". Se limpia aquí, no al guardar.
    const secs = this.sections().filter((_, k) => k !== i).map(sec => this.sinRutasHacia(sec, codigo));
    this.fijarSecciones(secs);
    this.seccionActiva.set(Math.max(0, Math.min(this.seccionActiva(), secs.length - 1)));
    // El selector apuntaba a un índice que ya no existe (o se corrió una posición).
    this.seccionDelPicker.set(null);
  }

  // ── Ruta de respuestas ────────────────────────────────────────────

  /**
   * Destinos válidos desde la sección `si`: las secciones POSTERIORES y "terminar".
   * Solo hacia adelante — es lo que el servidor acepta al publicar, y lo que garantiza
   * que el formulario siempre se pueda enviar (sin ciclos).
   */
  destinosDesde(si: number): Array<{ code: string; nombre: string }> {
    const secs = this.sections();
    const out = secs
      .map((sec, i) => ({ i, code: sec.code ?? '', nombre: sec.title?.trim() || `Sección ${i + 1}` }))
      .filter(d => d.i > si && !!d.code)
      .map(d => ({ code: d.code, nombre: d.nombre }));
    out.push({ code: FIN_DEL_FORMULARIO, nombre: 'Terminar el formulario' });
    return out;
  }

  /** Valor del selector "al terminar ir a" ('' = la siguiente por orden). */
  destinoDeSeccion(si: number): string {
    return this.sections()[si]?.next_section ?? '';
  }

  cambiarDestinoDeSeccion(si: number, destino: string): void {
    const secs = this.clonarSecciones();
    secs[si] = { ...secs[si], next_section: destino.trim() || null };
    this.fijarSecciones(secs);
  }

  /** ¿Hay alguna ramificación configurada? (mueve el aviso del pie del constructor). */
  readonly hayRamificacion = computed(() => tieneRamificacion(this.sections()));

  /** Copia de la sección sin las reglas que apuntaban al código dado. */
  private sinRutasHacia(sec: FormSection, codigo: string | undefined): FormSection {
    if (!codigo) return sec;
    const limpiaCampo = (f: DynamicField): DynamicField => {
      const reglas = f.schema?.routing?.rules;
      if (!reglas?.length) return f;
      const quedan = reglas.filter(r => r.go_to !== codigo);
      if (quedan.length === reglas.length) return f;
      const schema = { ...f.schema };
      if (quedan.length === 0) delete schema.routing;
      else schema.routing = { rules: quedan };
      return { ...f, schema };
    };
    return {
      ...sec,
      next_section: sec.next_section === codigo ? null : sec.next_section,
      fields: sec.fields.map(f => (f.children
        ? { ...limpiaCampo(f), children: f.children.map(limpiaCampo) }
        : limpiaCampo(f))),
    };
  }

  // ── Campos ────────────────────────────────────────────────────────

  /**
   * Sección para la que está abierto el selector de tipo, o null si está cerrado.
   *
   * El selector de tipo es la ÚNICA vía para agregar un campo, y da a cada sección un
   * punto de entrada explícito para su PRIMERA pregunta.
   */
  seccionDelPicker = signal<number | null>(null);

  /**
   * Posición DENTRO de la sección donde entrará el campo nuevo: el índice ante el que
   * se inserta, o `null` para apendizar al final (que es lo que hace el botón de la
   * cabecera). Lo fijan los puntos de inserción que hay entre tarjeta y tarjeta.
   */
  posicionDelPicker = signal<number | null>(null);

  readonly pickerAbierto = computed(() => this.seccionDelPicker() !== null);

  /** Nombre de la sección destino, para el encabezado del selector. */
  readonly destinoDelPicker = computed(() => {
    const i = this.seccionDelPicker();
    if (i == null) return '';
    return this.sections()[i]?.title?.trim() || `Sección ${i + 1}`;
  });

  /**
   * Dónde va a caer el campo, en palabras, para que el selector no mienta cuando se
   * abrió desde un punto de inserción intermedio ("se añade al final" solo es cierto
   * si vino del botón de la cabecera).
   */
  readonly ubicacionDelPicker = computed(() => {
    const si = this.seccionDelPicker();
    if (si == null) return '';
    const destino = this.destinoDelPicker();
    const campos = this.sections()[si]?.fields ?? [];
    const pos = this.posicionDelPicker();
    if (pos == null || pos >= campos.length) return `Se añade al final de ${destino}.`;
    const etiqueta = (campos[pos]?.label || '').trim();
    return etiqueta
      ? `Se inserta en ${destino}, antes de «${etiqueta}».`
      : `Se inserta en ${destino}, en la posición ${pos + 1}.`;
  });

  /**
   * Abre el selector para una sección. `pos` es el índice ante el que se insertará el
   * campo; sin `pos` se apendiza al final (comportamiento del botón de la cabecera).
   */
  abrirPickerDeCampo(si: number, pos: number | null = null): void {
    this.seccionActiva.set(si);
    this.posicionDelPicker.set(pos);
    this.seccionDelPicker.set(si);
  }

  cerrarPickerDeCampo(): void {
    this.seccionDelPicker.set(null);
    this.posicionDelPicker.set(null);
  }

  /**
   * Tipo elegido en el selector: entra en la sección desde la que se abrió, en la
   * posición pedida (o al final si se abrió desde la cabecera).
   */
  agregarDesdePicker(t: FieldTypeInfo): void {
    const si = this.seccionDelPicker();
    const pos = this.posicionDelPicker();
    if (si == null) return;
    this.seccionDelPicker.set(null);
    this.posicionDelPicker.set(null);
    const secs = this.clonarSecciones();
    if (si >= secs.length) return;
    const campos = secs[si].fields;
    const donde = pos == null ? campos.length : Math.max(0, Math.min(pos, campos.length));
    campos.splice(donde, 0, crearCampoDesdeTipo(t));
    this.fijarSecciones(secs);
    this.seccionActiva.set(si);
  }

  /**
   * Drop CDK sobre la lista de una sección: reordenar dentro de la misma lista o
   * transferir desde otra sección. Todo sobre copias — nunca se mutan las arrays
   * que ya están en el signal.
   */
  soltarCampo(ev: CdkDragDrop<number>, destino: number): void {
    const secs = this.clonarSecciones();
    if (ev.previousContainer === ev.container) {
      moveItemInArray(secs[destino].fields, ev.previousIndex, ev.currentIndex);
    } else {
      const origen = ev.previousContainer.data;
      transferArrayItem(secs[origen].fields, secs[destino].fields, ev.previousIndex, ev.currentIndex);
    }
    this.fijarSecciones(secs);
    this.seccionActiva.set(destino);
  }

  /**
   * Campos de la misma sección que pueden hacer de PADRE en una cascada de opciones:
   * los de selección simple que ya tienen `name` (el nombre lo genera el backend al
   * guardar, así que un campo recién arrastrado todavía no sirve de padre).
   */
  camposEncadenables(si: number, fi: number): Array<{ name: string; label: string }> {
    const secs = this.sections();
    const sec = secs[si];
    if (!sec) return [];
    return sec.fields
      .filter((f, i) => i !== fi && !!f.name
        && (f.type === 'SINGLE_CHOICE' || f.type === 'DROPDOWN'))
      .map(f => ({ name: f.name as string, label: f.label || (f.name as string) }));
  }

  actualizarCampo(si: number, fi: number, actualizado: DynamicField): void {
    const secs = this.clonarSecciones();
    secs[si].fields[fi] = actualizado;
    this.fijarSecciones(secs);
  }

  duplicarCampo(si: number, fi: number): void {
    const secs = this.clonarSecciones();
    secs[si].fields.splice(fi + 1, 0, clonarCampoParaDuplicar(secs[si].fields[fi]));
    this.fijarSecciones(secs);
  }

  quitarCampo(si: number, fi: number): void {
    const secs = this.clonarSecciones();
    secs[si].fields.splice(fi, 1);
    this.fijarSecciones(secs);
  }

  /**
   * Un hijo pidió salir de su SECTION: se quita de children (por identidad de
   * objeto, estable dentro del estado actual) y se inserta justo después de la
   * sección en la misma FormSection.
   */
  sacarDeSeccion(si: number, fi: number, hijo: DynamicField): void {
    const secs = this.clonarSecciones();
    const campo = secs[si].fields[fi];
    secs[si].fields[fi] = { ...campo, children: (campo.children ?? []).filter(c => c !== hijo) };
    secs[si].fields.splice(fi + 1, 0, hijo);
    this.fijarSecciones(secs);
  }

  // ── Guardar ───────────────────────────────────────────────────────

  async guardar(): Promise<void> {
    const problema = this.validar();
    if (problema) {
      // El campo que falta suele vivir en "Datos": si estaba plegado, se abre para que el
      // mensaje no señale a un panel invisible.
      this.abrirPanel('datos');
      this.snack.open(problema, 'Entendido', { duration: 5000 });
      return;
    }
    const req = this.construirRequest();
    const id = this.formId();

    if (id != null) {
      // EDICIÓN: publicar crea versión nueva — confirmar SIEMPRE antes.
      const v = this.versionActual();
      const conf = await Swal.fire({
        icon: 'question',
        title: `Publicar v${v + 1}`,
        text: `Esto crea la versión v${v} → v${v + 1}; las respuestas ya enviadas conservan su esquema. ¿Continuar?`,
        showCancelButton: true,
        confirmButtonText: `Publicar v${v + 1}`,
        cancelButtonText: 'Cancelar',
      });
      if (!conf.isConfirmed) return;

      this.guardando.set(true);
      this.formsSvc.editBuilder(id, req)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.guardando.set(false);
            void Swal.fire({
              icon: 'success',
              title: `Versión v${v + 1} publicada`,
              timer: 1800,
              showConfirmButton: false,
            }).then(() => this.irAlListado());
          },
          error: (err: unknown) => { this.guardando.set(false); this.mostrarErrorApi(err); },
        });
      return;
    }

    // CREACIÓN: los roles con permiso de llenar son los que ven la entrada en el menú.
    const menu = this.idsDeMenu();
    if (menu.length > 0) req.fill_role_ids = menu;
    this.guardando.set(true);
    this.formsSvc.createBuilder(req)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: detalle => { this.guardando.set(false); this.despuesDeCrear(detalle); },
        error: (err: unknown) => { this.guardando.set(false); this.mostrarErrorApi(err); },
      });
  }

  /**
   * Post-creación. El formulario nace PENDING (el BuilderRequest no lleva
   * ubicación). Si el usuario eligió un padre y no marcó "no publicar", se
   * publica ahora con placementService.place(); si no, se crea sin publicar.
   */
  private despuesDeCrear(detalle: FormDetail): void {
    const padre = this.ubicPadre();
    if (this.noPublicar() || !padre) {
      void Swal.fire({
        icon: 'success',
        title: 'Formulario creado',
        text: 'Formulario creado sin publicar; ubícalo cuando quieras desde el listado.',
        confirmButtonText: 'Ir al listado',
      }).then(() => this.irAlListado());
      return;
    }

    const req: PlacementRequest = {
      parent_module_id: padre,
      menu_label: this.ubicLabel().trim() || detalle.name || this.nombre().trim(),
      icon: this.ubicIcono().trim() || 'dynamic_form',
      responses_menu_enabled: this.ubicRespuestas(),
    };
    const orden = this.ubicOrden();
    if (orden != null && Number.isFinite(Number(orden))) req.order_no = Number(orden);
    // Los roles de llenado elegidos también gobiernan quién ve la entrada de menú.
    const idsMenu = this.idsDeMenu();
    if (idsMenu.length > 0) req.fill_role_ids = idsMenu;

    this.guardando.set(true);
    this.placementSvc.place(detalle.id, req)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: p => { this.guardando.set(false); this.trasPublicarUbicacion(detalle.id, p); },
        error: (err: unknown) => {
          this.guardando.set(false);
          const problema = this.comoProblema(err);
          void Swal.fire({
            icon: 'warning',
            title: 'Formulario creado, pero no se pudo ubicar',
            text: problema?.detail || 'La publicación en el menú falló. Puedes ubicarlo desde el listado.',
            showCancelButton: true,
            confirmButtonText: 'Reintentar ubicación',
            cancelButtonText: 'Ir al listado',
          }).then(r => r.isConfirmed ? this.reintentarUbicacionTrasCrear(detalle.id) : this.irAlListado());
        },
      });
  }

  /** Resultado del place() tras crear: LINKED = éxito; FAILED/warnings = ofrecer reintento. */
  private trasPublicarUbicacion(formId: number, p: Placement): void {
    const conAvisos = (p.warnings?.length ?? 0) > 0;
    if (p.placement_status === 'FAILED' || conAvisos) {
      const items = (p.warnings ?? []).map(w => `<li>${this.esc(w)}</li>`).join('');
      const detalleErr = p.placement_error ? `<p>${this.esc(p.placement_error)}</p>` : '';
      void Swal.fire({
        icon: p.placement_status === 'FAILED' ? 'error' : 'warning',
        title: p.placement_status === 'FAILED' ? 'La ubicación quedó en error' : 'Ubicación con advertencias',
        html: `${detalleErr}${items ? `<ul style="text-align:left;margin:8px 0 0;padding-left:18px">${items}</ul>` : ''}`
          || 'Revisa la ubicación desde el listado.',
        showCancelButton: true,
        confirmButtonText: 'Reintentar ubicación',
        cancelButtonText: 'Ir al listado',
      }).then(r => r.isConfirmed ? this.reintentarUbicacionTrasCrear(formId) : this.irAlListado());
      return;
    }
    // LINKED: éxito. Refrescar el menú en caliente y navegar al listado.
    void Swal.fire({ icon: 'success', title: 'Formulario creado y publicado', timer: 1600, showConfirmButton: false })
      .then(() => this.irAlListadoRefrescandoMenu());
  }

  private reintentarUbicacionTrasCrear(formId: number): void {
    this.placementSvc.retry(formId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: p => {
          if (p.placement_status === 'FAILED' || (p.warnings?.length ?? 0) > 0) {
            this.snack.open('La ubicación sigue incompleta; gestiónala desde el listado.', 'OK', { duration: 6000 });
            this.irAlListado();
          } else {
            this.irAlListadoRefrescandoMenu();
          }
        },
        error: () => {
          this.snack.open('No se pudo reintentar la ubicación; gestiónala desde el listado.', 'OK', { duration: 6000 });
          this.irAlListado();
        },
      });
  }

  /**
   * Navega al listado refrescando el menú lateral EN CALIENTE. El sidebar
   * (navbar.component.ts) sólo relee `localStorage["user"].permisos_tree` en su
   * ngOnInit/refreshPermisos(); no hay canal para empujarle un refresco sin tocar
   * ese componente. Replicamos su mismo GET (/gestion_admin/usuarios/{id}/),
   * reescribimos 'user' con el árbol nuevo y hacemos una navegación COMPLETA al
   * listado (window.location) para que el navbar se reinstancie y pinte el módulo
   * recién publicado. Si el GET falla, navegamos igual: el refreshPermisos() del
   * navbar hará el fetch al reiniciar.
   */
  private irAlListadoRefrescandoMenu(): void {
    const ir = () => {
      if (typeof window !== 'undefined') window.location.href = FormBuilderComponent.RUTA_LISTADO;
      else this.irAlListado();
    };
    const user = leerUsuarioCrudo();
    const idCrudo = user?.['id'];
    const userId = idCrudo != null ? String(idCrudo) : '';
    if (!userId) { ir(); return; }
    const apiUrl = environment.apiUrl.replace(/\/+$/, '');
    this.http.get<unknown>(`${apiUrl}/gestion_admin/usuarios/${userId}/`)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: resp => { setLocalStorageItem('user', JSON.stringify(resp)); ir(); },
        error: () => ir(),
      });
  }

  // ── Validación local mínima (la del servidor es la que manda) ─────

  private validar(): string | null {
    if (!this.nombre().trim()) return 'El nombre del formulario es obligatorio.';
    if (this.totalCampos() === 0) return 'Agrega al menos un campo al formulario.';
    for (const sec of this.sections()) {
      for (const campo of sec.fields) {
        const p = this.validarCampo(campo);
        if (p) return p;
        for (const hijo of campo.children ?? []) {
          const ph = this.validarCampo(hijo);
          if (ph) return ph;
        }
      }
    }
    return null;
  }

  private validarCampo(f: DynamicField): string | null {
    if (!f.label.trim()) return 'Hay un campo sin etiqueta: complétala antes de guardar.';
    const esChoice = f.type === 'SINGLE_CHOICE' || f.type === 'DROPDOWN' || f.type === 'MULTIPLE_CHOICE';
    if (esChoice && !(f.schema.options?.length)) return `«${f.label}» necesita al menos una opción.`;
    if (f.type === 'COMMENT' && !f.schema.text?.trim()) return `El comentario «${f.label}» necesita texto.`;
    return null;
  }

  // ── Permisos por rol y control del proceso (V14) ──────────────────

  /**
   * Configuración de permisos elegida en el diálogo. null = no se tocó, y el formulario
   * queda en modo OWNER (lo gestiona su dueño; el resto solo lo llena), que es el
   * comportamiento de siempre.
   */
  readonly accessCfg = signal<FormAccessConfig | null>(null);

  /** Resumen del panel: qué se configuró, sin abrir el diálogo. */
  readonly resumenAcceso = computed(() => {
    const cfg = this.accessCfg();
    if (!cfg || cfg.access_mode !== 'ROLES') {
      return cfg?.process_enabled ? 'Con control del proceso' : 'Solo el creador y los administradores';
    }
    const n = cfg.rules.length;
    const quienes = n === 0 ? 'sin destinatarios' : (n === 1 ? '1 destinatario' : `${n} destinatarios`);
    return cfg.process_enabled ? `${quienes} · con control del proceso` : quienes;
  });

  /**
   * Roles que además verán la entrada en su MENÚ lateral.
   *
   * NO es una segunda lista que marcar: sale de las reglas de permiso con «Llenar» cuyo
   * destinatario es un ROL. El menú lo reparte ms-auth-admin por rol y no entiende de
   * fincas ni de personas, así que los demás destinatarios abren el formulario por su
   * enlace. Tener dos listas de roles —una para permisos y otra para el menú— era la
   * fuente garantizada de "le di permiso y no le aparece".
   */
  readonly rolesDelMenu = computed<Array<{ id: string; nombre: string }>>(() => {
    const cfg = this.accessCfg();
    if (!cfg || cfg.access_mode !== 'ROLES') return [];
    return cfg.rules
      .filter(r => (r.subject_kind ?? 'ROL') === 'ROL' && r.can_fill)
      .map(r => ({
        id: r.role_id ?? r.subject_ref ?? '',
        nombre: r.subject_label || r.role_name || '',
      }))
      .filter(r => !!r.id);
  });

  /** Ids que viajan como `fill_role_ids`; con permisos configurados mandan ellos. */
  private idsDeMenu(): string[] {
    const derivados = this.rolesDelMenu().map(r => r.id);
    // Sin permisos por reglas se conserva lo que traía un import de Excel (fill_role_ids).
    return derivados.length > 0 ? derivados : this.rolesSel();
  }

  /**
   * Columnas del formulario tal como está AHORA en el constructor. En creación no existen
   * todavía en el servidor, así que se derivan de las secciones abiertas: es lo que
   * permite elegir el campo llave y las columnas por rol antes de guardar nada.
   */
  private columnasActuales(): FormColumn[] {
    const out: FormColumn[] = [];
    for (const s of this.sections()) {
      const codigo = s.code ?? '';
      for (const f of s.fields ?? []) {
        if (f.type === 'COMMENT' || f.type === 'SECTION') continue;
        out.push({
          key: `${codigo}__${f.name ?? ''}`,
          section: codigo,
          section_title: s.title ?? null,
          name: f.name ?? '',
          label: f.label?.trim() || f.name || '',
          type: f.type,
          required: f.required === true,
        });
      }
    }
    return out;
  }

  abrirPermisos(): void {
    const data: FormAccessDialogData = {
      // En edición el diálogo guarda directo contra el backend; en creación devuelve la
      // configuración para que viaje con la estructura.
      formId: this.esEdicion() ? this.formId() : null,
      formName: this.nombre().trim() || undefined,
      config: this.accessCfg(),
      columns: this.columnasActuales(),
    };
    this.dialog.open(FormAccessDialogComponent, {
      width: '820px',
      maxWidth: '96vw',
      data,
    }).afterClosed().subscribe((cfg?: FormAccessConfig) => {
      if (cfg) this.accessCfg.set(cfg);
    });
  }

  // ── Armado del request ────────────────────────────────────────────

  private construirRequest(): BuilderRequest {
    return {
      name: this.nombre().trim(),
      description: this.descripcion().trim() || null,
      category: this.categoria().trim() || null,
      is_public: this.esPublico(),
      ui: this.uiActual(),
      // Solo viaja si se configuró algo: un request sin `access` deja los permisos como estén.
      ...(this.accessCfg() ? { access: this.accessCfg() } : {}),
      sections: this.sections().map((s, si) => ({
        ...(s.code ? { code: s.code } : {}),
        title: s.title?.trim() || null,
        order_no: si + 1,
        next_section: (s.next_section ?? '').trim() || null,
        fields: s.fields.map((f, fi) => ({
          ...f,
          order_no: fi + 1,
          ...(f.children ? { children: f.children.map((c, ci) => ({ ...c, order_no: ci + 1 })) } : {}),
        })),
      })),
    };
  }

  // ── Errores del API (ProblemDetail RFC 7807) ──────────────────────

  private comoProblema(err: unknown): ApiProblem | null {
    return err instanceof HttpErrorResponse ? (err.error as ApiProblem | null) : null;
  }

  private mostrarErrorApi(err: unknown): void {
    const problema = this.comoProblema(err);
    if (problema?.code === 'df_structure_invalid' && problema.errors?.length) {
      const items = problema.errors
        .map(e => `<li><b>${this.esc(e.section)} / ${this.esc(e.field)}</b>: ${this.esc(e.message)}</li>`)
        .join('');
      void Swal.fire({
        icon: 'error',
        title: 'Estructura inválida',
        html: `<ul style="text-align:left;margin:0;padding-left:18px">${items}</ul>`,
      });
    } else {
      void Swal.fire({
        icon: 'error',
        title: 'No se pudo guardar',
        text: problema?.detail || 'Error inesperado del servidor. Intenta de nuevo.',
      });
    }
  }

  // ── Utilitarios ───────────────────────────────────────────────────

  irAlListado(): void {
    void this.router.navigateByUrl(FormBuilderComponent.RUTA_LISTADO);
  }

  /** Copia superficial de secciones + arrays de campos (los campos se reemplazan, no se mutan). */
  private clonarSecciones(): FormSection[] {
    return this.sections().map(s => ({ ...s, fields: [...s.fields] }));
  }

  /** Escapa texto que va dentro del html de un Swal. */
  private esc(s: string): string {
    const mapa: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return s.replace(/[&<>"']/g, c => mapa[c] ?? c);
  }
}
