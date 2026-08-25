import {
  Component,
  LOCALE_ID,
  inject,
  effect,
  signal,
  computed,
  DestroyRef,
  PLATFORM_ID,
  afterNextRender,
  ChangeDetectionStrategy,
  AfterViewInit,
  ViewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';

import { DateAdapter, MAT_DATE_FORMATS, MAT_DATE_LOCALE, MatDateFormats } from '@angular/material/core';
import { MomentDateAdapter, MatMomentDateModule } from '@angular/material-moment-adapter';

import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatBadgeModule } from '@angular/material/badge';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatButtonToggleModule } from '@angular/material/button-toggle';

import { FormsModule, FormArray, FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';

import { SharedModule } from '@/app/shared/shared.module';
import { SearchForCandidateComponent } from '../../components/search-for-candidate/search-for-candidate.component';
import { DocumentoPromptDialogComponent, DocumentoPrompt } from './documento-prompt.dialog';
import { FichaCandidatoComponent } from '../../components/ficha-candidato/ficha-candidato.component';
import { SelectionQuestionsComponent } from '../../components/selection-questions/selection-questions.component';
import { HiringQuestionsComponent } from '../../components/hiring-questions/hiring-questions.component';
import { HelpInformationComponent } from '../../components/help-information/help-information.component';
import { CameraDialogComponent } from '../../components/camera-dialog/camera-dialog.component';

import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';
import { faltantesDePagoTransporte, FALTA_GUARDAR } from './pago-transporte.rules';
import {
  aplicarResultadoPruebaLocal,
  esVacanteDePruebaTecnica,
  etiquetaPruebaTecnica,
  resultadoDePruebaTecnica,
} from './prueba-tecnica.rules';
import { pedirResultadoEtapa, payloadResultadoEtapa } from '../../components/resultado-etapa/resultado-etapa.dialog';
import { CarnetMasivoDialogComponent } from '../../components/carnet-masivo-dialog/carnet-masivo-dialog.component';
import {
  ContactoComprobarDialogComponent,
  ContactoComprobarResultado,
} from '../../components/contacto-comprobar/contacto-comprobar.dialog';
import { esContratoRealMini, estadoContratoPill, procesoDelContrato, procesoVigente, tieneContratoActivoReal } from './contrato.rules';

import { firstValueFrom, merge, startWith } from 'rxjs';
import Swal from 'sweetalert2';
import { mensajeDeErrorLog } from '@/app/shared/utils/mensaje-error';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RegistroProcesoContratacion } from '../../service/registro-proceso-contratacion/registro-proceso-contratacion';
import { SeleccionEstadoService } from '../../service/seleccion/seleccion-estado.service';
import { TableDialogComponent } from '@/app/shared/components/table-dialog/table-dialog.component';
import {
  AvisoDialogComponent,
  AvisoDialogData,
} from '@/app/shared/components/confirm-dialog/confirm-dialog.component';
import { GestionDocumentalService } from '../../service/gestion-documental/gestion-documental.service';
import jsPDF from 'jspdf';
import JSZip from 'jszip';
import QRCode from 'qrcode';

import { PdfService } from '@/app/shared/services/pdf/pdf.service';
import { HomeService } from '../../../home/service/home.service';
import { ReportesService } from '../../service/reportes/reportes.service';
import { HiringService } from '../../service/hiring.service';
import {
  ArlExcelError,
  ArlIndex,
  leerArlExcel,
  validarCedulaContraArl,
} from '../../shared/arl-excel.helper';
import { ElectronWindowService } from '@/app/core/services/electron-window.service';
import { getLocalStorageItem } from '@/app/core/utils/safe-storage';

import { ColumnDefinition } from '@/app/shared/models/advanced-table-interface';
import {
  ClaveAvance,
  PanelSeleccion,
  PipelineNavService,
} from '../../service/pipeline-nav/pipeline-nav.service';
import { Avance, avanceDeForm, pctDe, sumarAvances } from '../../shared/progreso.util';

export const MY_DATE_FORMATS: MatDateFormats = {
  parse: { dateInput: 'DD/MM/YYYY' },
  display: {
    dateInput: 'DD/MM/YYYY',
    monthYearLabel: 'MMMM YYYY',
    dateA11yLabel: 'LL',
    monthYearA11yLabel: 'MMMM YYYY',
  },
};

type LocalFile = { file: File | string; fileName: string };
type ServerDocInfo = {
  id: number;
  fileName: string;
  type: number;
  file_url: string;
  uploaded_at?: string;
  size?: number;
  etag?: string;
  lastModified?: string;
};

type ExamenResultadoForm = { aptoStatus?: string };
type BioKind = 'foto' | 'huella' | 'firma';

/** Los dos momentos del proceso: capa 1 del rail. */
type CapaId = 'seleccion' | 'contratacion' | 'ia' | 'accesos';

interface CapaPipeline {
  readonly id: CapaId;
  readonly label: string;
  readonly icon: string;
  /** Bloques cuyo avance se suma para dar el % de la capa. */
  readonly claves: readonly ClaveAvance[];
}

interface SubPasoSeleccion {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  /** Pestaña del `mat-tab-group` de este componente. */
  readonly tab: number;
  /** Sub-pestaña del área de trabajo, cuando comparte la pestaña 2. */
  readonly panel: PanelSeleccion | null;
  /** Bloque que reporta el avance; `null` si no se mide. */
  readonly clave: ClaveAvance | null;
}

interface SubPasoContratacion {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  /** Índice del `mat-tab-group` de `app-hiring-questions`. */
  readonly idx: number;
  readonly clave: ClaveAvance;
}

@Component({
  selector: 'app-recruitment-pipeline',
  standalone: true,
  imports: [
    FormsModule, ReactiveFormsModule,
    MatIconModule, MatTabsModule, MatDatepickerModule, MatMomentDateModule,
    MatTooltipModule, MatDialogModule, MatBadgeModule, MatSnackBarModule,
    MatButtonToggleModule,
    SharedModule,
    MatMenuModule,
    FichaCandidatoComponent,
    SearchForCandidateComponent, SelectionQuestionsComponent, HiringQuestionsComponent, HelpInformationComponent,
    RouterLink
  ],
  templateUrl: './recruitment-pipeline.component.html',
  styleUrls: ['./recruitment-pipeline.component.css'],
  providers: [
    PipelineNavService,
    { provide: LOCALE_ID, useValue: 'es-CO' },
    { provide: MAT_DATE_LOCALE, useValue: 'es-CO' },
    { provide: DateAdapter, useClass: MomentDateAdapter, deps: [MAT_DATE_LOCALE] },
    { provide: MAT_DATE_FORMATS, useValue: MY_DATE_FORMATS },
  ],
})
export class RecruitmentPipelineComponent implements AfterViewInit {
  // ───────── Signals de estado ─────────
  candidatoSeleccionado = signal<any | null>(null);
  nombreCandidato: string = '';
  numeroDocumento: string = '';

  // Previews locales
  fotoDataUrl = signal<string | null>(null);
  firmaDataUrl = signal<string | null>(null);
  huellaDataUrl = signal<string | null>(null);

  uploadedFiles: Record<string, LocalFile> = {};
  serverDocs: Record<string, ServerDocInfo> = {};

  // Biometría desde backend
  biometria = signal<{ firma?: any; huella?: any; foto?: any; created_at?: string; updated_at?: string } | null>(null);
  examenMedicoDoc = signal<ServerDocInfo | null>(null); // Signal para el documento ID 32
  arlDoc = signal<ServerDocInfo | null>(null); // Signal para el documento ID 30
  fotoDoc = signal<ServerDocInfo | null>(null); // Signal para el documento FOTO ID 89

  // Flags (solo backend)
  private tieneFirmaSrv = computed(() => !!this.getBioDoc('firma'));
  private tieneHuellaSrv = computed(() => !!this.getBioDoc('huella'));
  private tieneFotoSrv = computed(() => !!this.getBioDoc('foto'));

  // Flags UI
  tieneFirmaUI = computed(() => !!(this.firmaDataUrl() || this.tieneFirmaSrv()));
  tieneHuellaUI = computed(() => !!(this.huellaDataUrl() || this.tieneHuellaSrv()));
  tieneFotoUI = computed(() => !!(this.fotoDataUrl() || this.fotoDoc() || this.tieneFotoSrv()));

  /**
   * URL de la foto del candidato para mostrar en el avatar del header.
   * Prioridad: preview local recién tomada → archivo subido (foto doc) → biometría almacenada.
   * Devuelve null si todavía no hay foto.
   *
   * También chequea propiedades alternativas (`url`, `urlfoto`, `foto`) en el documento
   * por si el backend usa nombres distintos.
   */
  /**
   * URL que ya se intentó cargar y falló (404, archivo movido, etc.).
   *
   * Se guarda la URL y no un simple booleano para que al cambiar de candidato
   * —o al subir una foto nueva, que estrena URL— se vuelva a intentar solo.
   */
  private fotoUrlFallida = signal<string | null>(null);

  /** Última cédula a la que ya se le corrió la cascada completa (docs, bio, historial). */
  private cedulaAtendida: string | null = null;

  /** Titular (tipo|número) de esa cascada: distingue CC de C.C/CE con el mismo número. */
  private titularAtendido: string | null = null;

  /** Se incrementa en cada consulta del buscador (ver onCandidatoSeleccionado). */
  readonly consultaSeq = signal(0);

  /**
   * Huella de los datos de salud ocupacional ya pintados. El effect que
   * autollena esa pestaña corre con cada referencia nueva del candidato; si la
   * huella no cambió, reconstruir borraría los PDFs de exámenes adjuntos.
   */
  private saludFingerprint: string | null = null;

  /**
   * Se pone en true justo antes de un `candidatoSeleccionado.set()` interno
   * (recargas tras guardar). El effect lo consume y, si la persona es la misma,
   * se salta la cascada de peticiones. Una consulta desde el buscador nunca lo
   * marca, así que re-consultar a la misma persona sí recorre todo de nuevo.
   */
  private refrescoSilencioso = false;

  avatarPhotoUrl = computed<string | null>(() => {
    const url = this.avatarPhotoUrlCandidata();
    // Si esa imagen ya falló, se devuelve null para que el avatar caiga en el
    // ícono de persona. Dejar el <img> roto en pantalla muestra el texto
    // alternativo ("Foto del candidato") sobre el fondo azul, que se ve como
    // un error de la aplicación.
    return url && url === this.fotoUrlFallida() ? null : url;
  });

  private avatarPhotoUrlCandidata = computed<string | null>(() => {
    const local = this.fotoDataUrl();
    if (local) return local;

    const doc = this.fotoDoc() as any;
    if (doc) {
      const fromDoc = doc.file_url || doc.file || doc.url || doc.urlfoto || doc.foto;
      if (fromDoc) return fromDoc;
    }

    const fromBio = this.getBioUrl('foto');
    if (fromBio) return fromBio;

    // Último intento: leer directamente del candidato seleccionado por si la
    // foto vino embebida en otra propiedad.
    const cand = this.candidatoSeleccionado() as any;
    const fromCand =
      cand?.foto ||
      cand?.foto_url ||
      cand?.urlfoto ||
      cand?.biometria?.foto?.file_url ||
      cand?.biometria?.foto?.file ||
      null;
    return fromCand || null;
  });

  /**
   * URL `blob:` que creamos NOSOTROS para la vista previa de la foto recién
   * tomada, y que por lo tanto nos toca liberar.
   *
   * No se puede reutilizar la que devuelve `CameraDialogComponent`: ese diálogo
   * revoca su propia `previewUrl` en el `ngOnDestroy`, o sea justo al cerrarse.
   * Si se guardaba esa URL, el `<img>` del avatar quedaba apuntando a un blob
   * ya destruido y se veía el texto alternativo en vez de la foto — hasta que
   * se volvía a consultar al candidato y entraba la URL del servidor.
   */
  private fotoPreviewPropia: string | null = null;

  /** Muestra la foto recién tomada con una URL de la que somos dueños. */
  private mostrarPreviewFoto(file: File): void {
    this.liberarPreviewFoto();
    this.fotoPreviewPropia = URL.createObjectURL(file);
    this.fotoDataUrl.set(this.fotoPreviewPropia);
  }

  private liberarPreviewFoto(): void {
    if (this.fotoPreviewPropia) {
      URL.revokeObjectURL(this.fotoPreviewPropia);
      this.fotoPreviewPropia = null;
    }
  }

  /** Notifica que la imagen del avatar falló (sólo para log; no oculta la imagen). */
  onAvatarPhotoError(ev: Event): void {
    const img = ev.target as HTMLImageElement | null;
    console.warn('[avatar] foto no cargó:', img?.src);
    // Se marca el valor que se le pasó a [src], no `img.src`: el DOM lo
    // devuelve resuelto a absoluto y una ruta relativa no volvería a coincidir.
    // Con la URL descartada el avatar cae en el ícono de persona en vez de
    // quedarse mostrando la imagen rota.
    const usada = this.avatarPhotoUrlCandidata();
    if (usada) this.fotoUrlFallida.set(usada);
  }

  onAvatarPhotoLoad(ev: Event): void {
    const img = ev.target as HTMLImageElement | null;
    console.info('[avatar] foto cargada OK:', img?.src);
  }
  /** Badge "✓" del carnet: mismo proceso que usa generarCarnetIndividual. */
  carnetGeneradoUI = computed<boolean>(() => {
    const cand = this.candidatoSeleccionado();
    const proc = procesoDelContrato(cand) ?? procesoVigente(cand);
    return proc?.contrato?.carnet_generado === true;
  });

  tieneExamenMedicoUI = computed(() => !!this.examenMedicoDoc());
  /** True si el candidato ya tiene exámenes médicos registrados en el proceso */
  examenesYaCargados = computed(() => {
    const cand = this.candidatoSeleccionado();
    const em = cand?.entrevistas?.[0]?.proceso?.examen_medico;
    if (!em) return false;
    try {
      const exams = typeof em.examenes === 'string' ? JSON.parse(em.examenes) : em.examenes;
      return Array.isArray(exams) && exams.length > 0;
    } catch { return false; }
  });
  tieneArlUI = computed(() => !!this.arlDoc());

  // Helpers para badges
  badge(kind: BioKind) { return this.tiene(kind) ? '✓' : '✗'; }
  badgeColor(kind: BioKind) { return this.tiene(kind) ? 'primary' : 'warn'; }
  tiene(kind: BioKind): boolean {
    return !!(this.bioLocal(kind) || this.getBioUrl(kind));
  }

  sede = signal<string>('');
  // Un archivo por examen seleccionado (mapeo por índice)
  examFiles = signal<File[]>([]);

  readonly typeMap: Record<string, number> = { examenesMedicos: 32, arl: 30 };

  readonly filteredExamOptions: string[] = [
    'Exámen Ingreso', 'Colinesterasa', 'Glicemia Basal', 'Perfil lípidico', 'Visiometria', 'Optometría', 'Audiometría',
    'Espirometría', 'Sicometrico', 'Frotis de uñas', 'Frotis de garganta', 'Cuadro hematico', 'Creatinina', 'TGO',
    'Coprológico', 'Osteomuscular', 'Quimico (Respiratorio - Dermatologico)', 'Tegumentaria', 'Cardiovascular',
    'Trabajo en alturas (Incluye test para detección de fobia a las alturas: El AQ (Acrophobia Questionnaire) de Cohen)',
    'Electrocardiograma (Sólo aplica para mayores de 45 años)', 'Examen Médico', 'HEPATITIS A Y B', 'TETANO VACUNA T-D',
    'Exámen médico integral definido para conductores',
  ];

  /**
   * Abreviatura que se manda como `sede_abbr` para que el backend resuelva el
   * rango de numeración del contrato (ALIAS_OFICINA en codigo_contrato.py).
   *
   * Deben estar LAS 19 oficinas de `GET /gestion_contratacion/oficinas/`.
   * Faltaban SOTAQUIRA y ZIPAQUIRÁ: no rompía porque `normalizarSedeAbbr` cae
   * al nombre crudo y el backend lo normaliza igual, pero dejaba dos sedes
   * fuera del mapa sin razón.
   */
  private readonly abreviaciones: Record<string, string> = {
    ADMINISTRATIVOS: 'ADM', ANDES: 'AND', BOSA: 'BOS', CARTAGENITA: 'CAR',
    FACA_PRIMERA: 'FPR', FACA_PRINCIPAL: 'FPC', FONTIBÓN: 'FON', FORANEOS: 'FOR',
    FUNZA: 'FUN', MADRID: 'MAD', MONTE_VERDE: 'MV', ROSAL: 'ROS', SOACHA: 'SOA',
    SOTAQUIRA: 'SOT', SUBA: 'SUB', TOCANCIPÁ: 'TOC', USME: 'USM',
    VIRTUAL: 'VIRTUAL', ZIPAQUIRÁ: 'ZIP'
  };

  // ───────── DI ─────────
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private snack = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private destroyRef = inject(DestroyRef);
  private readonly docSvc = inject(GestionDocumentalService);

  private util = inject(UtilityServiceService);
  private pdfSvc = inject(PdfService);
  private registroProceso = inject(RegistroProcesoContratacion);
  private homeService = inject(HomeService);
  private electronWindow = inject(ElectronWindowService);
  private platformId = inject(PLATFORM_ID);
  private isBrowser = signal(false);
  private seleccionEstado = inject(SeleccionEstadoService);
  private reportesSvc = inject(ReportesService);
  private hiringSvc = inject(HiringService);

  /**
   * El candidato quedó EN ESPERA de vacante o NO APLICA (observación del
   * evaluador): se bloquean los Exámenes de ingreso hasta que aplique.
   */
  readonly bloqueado = this.seleccionEstado.bloqueado;
  readonly motivoBloqueo = this.seleccionEstado.motivoBloqueo;

  /**
   * True cuando el candidato consultado tiene un CONTRATO ACTIVO REAL. Mientras
   * lo tenga no puede avanzar al resto del pipeline (Antecedentes, Selección,
   * Exámenes, Contratación): primero hay que darle de baja ese contrato
   * (pill verde "Contrato activo" del header o el botón del banner).
   *
   * OJO: la fila de Contrato puede existir SIN contratación (el backend la crea
   * al reservar el código y nace con contrato_activo=true por default). Solo
   * bloquea si el proceso llegó a contratado=true o hay fecha_ingreso
   * (ver contrato.rules.ts).
   */
  readonly contratoActivo = computed<boolean>(() =>
    tieneContratoActivoReal(this._procesoContrato())
  );

  /**
   * Proceso del que se lee el contrato. NO es necesariamente el de la primera
   * entrevista: cuando la persona vuelve y se le abre un turno nuevo, esa
   * entrevista puede no tener proceso todavía y el contrato sigue en la
   * anterior (ver procesoDelContrato).
   */
  private readonly _procesoContrato = computed<any>(() =>
    procesoDelContrato(this.candidatoSeleccionado())
  );

  /** Estado del pill de contrato del header: activo / retirado / en_tramite / sin_fila. */
  readonly contratoPill = computed(() =>
    estadoContratoPill(this._procesoContrato())
  );

  /** La fila de contrato que pinta el header (fecha de retiro, código...). */
  readonly contratoHeader = computed<any>(() => this._procesoContrato()?.contrato ?? null);

  // ───────── Override "Modificar de todas formas" ─────────
  /**
   * Override por sesión/candidato: permite EDITAR el pipeline de una persona con
   * contrato activo SIN darle de baja. Es una edición pura forward-only; el
   * backend (guard `modificacion_forzada` en update-by-document) NO reinicia
   * banderas ni abre proceso/entrevista nuevos, y sella quién/cuándo. Se reinicia
   * al cambiar de candidato (ver onCandidatoSeleccionado).
   */
  readonly modificacionForzada = signal(false);

  /** Auditoría del override para mostrar en el banner (la fecha la sella el servidor). */
  readonly overrideAuditNombre = signal<string>('');
  readonly overrideAuditFecha = signal<string | null>(null);

  /**
   * Los tabs se bloquean por contrato activo REAL, SALVO que el usuario active el
   * override "Modificar de todas formas".
   */
  readonly bloqueoContratoTabs = computed<boolean>(() =>
    this.contratoActivo() && !this.modificacionForzada()
  );

  /**
   * Activa el override. Muestra el sello de auditoría PREVIO si el proceso ya trae
   * uno; el sello nuevo lo confirma el servidor al primer guardado en este modo.
   */
  activarModificacionForzada(): void {
    this.modificacionForzada.set(true);
    const proc = this.candidatoSeleccionado()?.entrevistas?.[0]?.proceso;
    this.overrideAuditNombre.set(proc?.modificado_por || '');
    this.overrideAuditFecha.set(proc?.modificado_en || null);
  }

  /** Nombre del usuario logueado (localStorage `user`) para la auditoría del override. */
  usuarioActual(): string {
    try {
      const raw = getLocalStorageItem('user');
      if (!raw) return '';
      const u = JSON.parse(raw);
      const nom = [u?.datos_basicos?.nombres, u?.datos_basicos?.apellidos]
        .filter(Boolean).join(' ').trim();
      if (nom) return nom;
      const alt = [u?.primer_nombre, u?.primer_apellido].filter(Boolean).join(' ').trim();
      return alt || String(u?.numero_de_documento ?? '');
    } catch {
      return '';
    }
  }

  /** Qué falta de "Pago y Transporte" para poder generar la documentación. */
  /**
   * Qué falta de "Pago y Transporte" para poder generar la documentación.
   *
   * Se lee de `_procesoContrato()`, la MISMA fuente que el pill de contrato del
   * header y que `fechaIngresoContrato`. Antes miraba `entrevistas[0].proceso`
   * a secas y eso bloqueaba el botón de por vida a quien tuviera un turno nuevo:
   * esa entrevista puede no tener proceso todavía (o ser de otra vacante) y el
   * contrato sigue en la anterior, así que salían los 11 campos como faltantes
   * aunque estuvieran guardados. Es el mismo error que ya obligó a escribir
   * `procesoDelContrato()` (casos CC 1097727446 y CC 1128324722).
   */
  readonly faltantesPagoTransporte = computed<string[]>(() =>
    faltantesDePagoTransporte(this.procesoContratacion()?.contrato)
  );

  /**
   * Proceso sobre el que trabaja la pestaña CONTRATACIÓN (pago y transporte,
   * datos de obra, generar código). Es también el `proceso_id` que se le manda
   * al backend, para que leer y guardar no puedan caer en procesos distintos.
   *
   * La regla la marca el override "Modificar de todas formas":
   *
   *  - Con override → se está EDITANDO un contrato vigente. Una persona con
   *    contrato activo tiene los tabs bloqueados, así que la ÚNICA forma de
   *    llegar aquí es habiendo pulsado "Modificar de todas formas". Se opera
   *    sobre el proceso que tiene el contrato. Es lo que el backend ya dice
   *    hacer en este modo ("edición pura sobre el proceso EXISTENTE").
   *
   *  - Sin override → no hay contrato activo bloqueando, así que es una
   *    contratación NUEVA sobre el turno abierto. El contrato anterior, si
   *    existe, queda intacto como histórico.
   *
   * Antes la pestaña LEÍA de `_procesoContrato()` (que prefiere el contrato
   * real y activo, o sea el viejo) y GUARDABA donde el backend resolviera por
   * su cuenta (la última entrevista, o sea el turno nuevo). Escribía en uno y
   * leía del otro: llenabas forma de pago, decía "guardado", y al volver los
   * campos seguían faltando.
   */
  readonly procesoContratacion = computed<any>(() =>
    this.modificacionForzada()
      ? (this._procesoContrato() ?? this._proceso())
      : (this._proceso() ?? this._procesoContrato())
  );

  // ───────── Prueba técnica (pill del header) ─────────

  /**
   * Proceso del que se lee el estado del candidato.
   *
   * NO es `entrevistas[0].proceso` a secas: una entrevista puede existir sin
   * proceso (el formulario público abre una nueva cuando la anterior quedó
   * terminal, y el proceso nace cuando alguien la atiende aquí). Si se leyera
   * la posición 0 a ciegas, a esa gente se le veía todo vacío.
   */
  private readonly _proceso = computed<any>(() =>
    procesoVigente(this.candidatoSeleccionado())
  );

  /** El pill solo aparece si hay vacante remitida y es de tipo prueba técnica. */
  readonly esPruebaTecnica = computed<boolean>(() => esVacanteDePruebaTecnica(this._proceso()));

  readonly resultadoPrueba = computed(() => resultadoDePruebaTecnica(this._proceso()));
  readonly pasoPrueba = computed<boolean>(() => this.resultadoPrueba() === 'paso');
  readonly noPasoPrueba = computed<boolean>(() => this.resultadoPrueba() === 'no_paso');
  readonly noSePresentoPrueba = computed<boolean>(() => this.resultadoPrueba() === 'no_se_presento');

  readonly etiquetaPrueba = computed<string>(() => etiquetaPruebaTecnica(this._proceso()));

  readonly tooltipPrueba = computed<string>(() => {
    const proc = this._proceso();
    switch (resultadoDePruebaTecnica(proc)) {
      case 'paso':
        return 'Pasó la prueba técnica. Click para cambiar el resultado';
      case 'no_paso': {
        const motivo = proc?.motivo_no_paso_prueba_tecnica;
        return motivo ? `No pasó la prueba. Motivo: ${motivo}` : 'No pasó la prueba. Click para cambiar el resultado';
      }
      case 'no_se_presento': {
        const motivo = proc?.motivo_no_se_presento_prueba_tecnica;
        return motivo
          ? `No se presentó a la prueba. Motivo: ${motivo}`
          : 'No se presentó a la prueba técnica. Click para cambiar el resultado';
      }
      default:
        return 'Click para registrar el resultado de la prueba técnica';
    }
  });

  // ───────── Examen médico (pill del header) ─────────
  // Independiente de `examenes_medicos` (que solo dice que se cargaron): esto
  // registra CÓMO salió. Mismos tres resultados que la prueba técnica.
  readonly resultadoExamen = computed<'sin_resultado' | 'paso' | 'no_paso' | 'no_se_presento'>(() => {
    const proc = this._proceso();
    if (proc?.no_paso_examen_medico === true) return 'no_paso';
    if (proc?.no_se_presento_examen_medico === true) return 'no_se_presento';
    if (proc?.paso_examen_medico === true) return 'paso';
    return 'sin_resultado';
  });

  readonly etiquetaExamen = computed<string>(() => {
    switch (this.resultadoExamen()) {
      case 'paso': return 'Examen: pasó';
      case 'no_paso': return 'Examen: no pasó';
      case 'no_se_presento': return 'Examen: no se presentó';
      default: return 'Examen médico';
    }
  });

  readonly tooltipExamen = computed<string>(() => {
    const proc = this._proceso();
    switch (this.resultadoExamen()) {
      case 'paso':
        return 'Pasó el examen médico. Click para cambiar el resultado';
      case 'no_paso': {
        const motivo = proc?.motivo_no_paso_examen_medico;
        return motivo ? `No pasó el examen. Motivo: ${motivo}` : 'No pasó el examen médico. Click para cambiar';
      }
      case 'no_se_presento': {
        const motivo = proc?.motivo_no_se_presento_examen_medico;
        return motivo
          ? `No se presentó al examen. Motivo: ${motivo}`
          : 'No se presentó al examen médico. Click para cambiar';
      }
      default:
        return 'Click para registrar el resultado del examen médico';
    }
  });

  readonly puedeGenerarDocumentacion = computed<boolean>(() =>
    !!this.candidatoSeleccionado()?.numero_documento && this.faltantesPagoTransporte().length === 0
  );

  /**
   * Lista lo que falta, una cosa por línea.
   *
   * En una sola línea eran once etiquetas separadas por comas que nadie leía.
   * El tooltip se pinta con `white-space: pre-line` (clase `tooltip-faltantes`),
   * así que los saltos de línea se respetan.
   */
  private textoFaltantes(faltan: string[], accion: string): string {
    // `faltantesDePagoTransporte` devuelve este texto solo cuando NO hay fila de
    // contrato; ahí no tiene sentido enumerar campos.
    if (faltan.length === 1 && faltan[0] === FALTA_GUARDAR) {
      return `No se puede ${accion}.\nAún no se ha guardado "Pago y Transporte".\nVe a Contratación → Pago y Transporte y guarda.`;
    }
    const lista = faltan.map(f => `• ${f}`).join('\n');
    return `No se puede ${accion}.\nFalta ${faltan.length === 1 ? 'este dato' : `estos ${faltan.length} datos`} en "Pago y Transporte":\n${lista}\n\nCompleta y GUARDA en Contratación → Pago y Transporte.`;
  }

  /** El tooltip dice QUÉ falta: un botón gris sin motivo no se puede accionar. */
  readonly tooltipGenerarDocumentacion = computed<string>(() => {
    if (!this.candidatoSeleccionado()?.numero_documento) {
      return 'Selecciona primero un candidato';
    }
    const faltan = this.faltantesPagoTransporte();
    if (!faltan.length) {
      return 'Generar o subir documentación';
    }
    return this.textoFaltantes(faltan, 'generar la documentación');
  });

  // ───────── Finalizar contratación ─────────
  /**
   * Registra al candidato en el reporte del día de su oficina, reutilizando los
   * documentos que ya subió el pipeline. Sustituye el cargue manual de
   * hiring-report (cédulas / traslados / SST) para las oficinas migradas.
   *
   * El Excel de ARL se cachea por sesión: es un export masivo del portal, así
   * que pedirlo en cada finalización obligaría a subir el mismo archivo veinte
   * veces en una jornada.
   */
  readonly arlIndex = signal<ArlIndex | null>(null);
  readonly finalizando = signal(false);
  /** Titulares finalizados en esta sesión, para no repetir el ida y vuelta. */
  private readonly finalizadas = signal<Set<string>>(new Set());

  /**
   * Llave por TITULAR, no por número: una misma cédula puede existir como CC y
   * como C.C/CE (dos personas). Con el número a secas, finalizar al CC pintaba
   * el badge "✓ Ya finalizado" también sobre el otro titular.
   */
  private claveTitular(cand: any): string | null {
    const ced = cand?.numero_documento;
    if (!ced) return null;
    return `${String(cand?.tipo_doc || 'CC').trim().toUpperCase()}|${String(ced).trim()}`;
  }

  readonly contratacionFinalizada = computed<boolean>(() => {
    const clave = this.claveTitular(this.candidatoSeleccionado());
    return !!clave && this.finalizadas().has(clave);
  });

  /**
   * La fecha de ingreso del contrato guardado. Es la que se cruza contra
   * "INICIO VIGENCIA" del ARL y la que va a la columna 9 del cruce generado.
   */
  private readonly fechaIngresoContrato = computed<string | null>(
    () => this._procesoContrato()?.contrato?.fecha_ingreso ?? null,
  );

  /**
   * Oficina del proceso que tiene el contrato.
   *
   * OJO: el backend anida `entrevista.proceso`, NO al revés — `proceso.entrevista`
   * NO existe en el payload. Hay que buscar la entrevista dueña del proceso;
   * `entrevistas[0]` no sirve porque el contrato puede estar en una anterior
   * (el turno nuevo aún no tiene proceso).
   */
  private readonly oficinaDelContrato = computed<string>(() => {
    const proc = this._procesoContrato();
    const entrevistas: any[] = this.candidatoSeleccionado()?.entrevistas ?? [];
    const propia = proc ? entrevistas.find((e) => e?.proceso?.id === proc.id) : null;
    return String(propia?.oficina ?? entrevistas[0]?.oficina ?? '').trim();
  });

  readonly puedeFinalizarContratacion = computed<boolean>(() => {
    if (!this.candidatoSeleccionado()?.numero_documento) return false;
    if (this.finalizando()) return false;
    // Mismos requisitos que generar documentación + fecha de ingreso: sin ella
    // no hay nada que cruzar contra el ARL ni que escribir en el Excel.
    if (this.faltantesPagoTransporte().length > 0) return false;
    return !!this.fechaIngresoContrato();
  });

  readonly tooltipFinalizarContratacion = computed<string>(() => {
    if (!this.candidatoSeleccionado()?.numero_documento) return 'Selecciona primero un candidato';
    if (this.contratacionFinalizada()) return 'Ya finalizado. Click para volver a enviarlo al reporte';
    // El botón también se apaga mientras corre el envío; sin esto el tooltip
    // decía "Finalizar contratación" sobre un botón que no responde.
    if (this.finalizando()) return 'Finalizando... espera a que termine';

    const faltan = this.faltantesPagoTransporte();
    if (faltan.length) {
      return this.textoFaltantes(faltan, 'finalizar la contratación');
    }
    if (!this.fechaIngresoContrato()) {
      return 'No se puede finalizar la contratación.\nEl contrato no tiene fecha de ingreso.\nGuárdala en Contratación → Pago y Transporte.';
    }
    return this.arlIndex()
      ? `Finalizar contratación (ARL: ${this.arlIndex()!.nombreArchivo})`
      : 'Finalizar contratación (te pedirá el Excel del ARL)';
  });

  /** Descarta el ARL cargado para poder subir uno más nuevo. */
  limpiarArl(): void {
    this.arlIndex.set(null);
    this.snack.open('Excel de ARL descartado. La próxima finalización lo pedirá de nuevo.', 'OK', {
      duration: 3000,
    });
  }

  /** Lee el Excel del ARL y lo deja cacheado. Devuelve false si el archivo no sirve. */
  async cargarArlExcel(evt: Event): Promise<boolean> {
    const input = evt.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return false;

    try {
      const index = await leerArlExcel(file);
      this.arlIndex.set(index);
      this.snack.open(
        `ARL cargado: ${index.nombreArchivo} (${index.totalFilas} filas).`,
        'OK',
        { duration: 3500 },
      );
      return true;
    } catch (e: any) {
      if (e instanceof ArlExcelError) {
        await Swal.fire({ icon: 'error', title: e.message, html: e.detalleHtml });
      } else {
        console.error('[cargarArlExcel] Error inesperado:', e);
        await Swal.fire({
          icon: 'error',
          title: 'No se pudo leer el Excel del ARL',
          text: mensajeDeErrorLog('pipeline', e, 'No se pudo completar la acción.'),
        });
      }
      this.arlIndex.set(null);
      return false;
    }
  }

  /** Carga el ARL y, si quedó bien, continúa con la finalización. */
  async onArlSeleccionadoYFinalizar(evt: Event): Promise<void> {
    const ok = await this.cargarArlExcel(evt);
    if (ok) await this.finalizarContratacion();
  }

  async finalizarContratacion(): Promise<void> {
    const cand = this.candidatoSeleccionado();
    const cedula = String(cand?.numero_documento ?? '').trim();
    if (!cedula || this.finalizando()) return;

    const fechaIngreso = this.fechaIngresoContrato();
    if (!fechaIngreso) {
      await Swal.fire({
        icon: 'warning',
        title: 'Falta la fecha de ingreso',
        text: 'Guarda la fecha de ingreso en "Pago y Transporte" antes de finalizar.',
      });
      return;
    }

    const index = this.arlIndex();
    if (!index) {
      await Swal.fire({
        icon: 'info',
        title: 'Falta el Excel del ARL',
        html:
          'Sube el archivo que descargaste del portal de la ARL.<br><br>' +
          'Se queda cargado para el resto de las contrataciones de hoy; ' +
          'solo tendrás que subirlo una vez.',
      });
      return;
    }

    const responsable = this.usuarioActual();
    if (!responsable) {
      await Swal.fire({
        icon: 'error',
        title: 'Sin usuario',
        text: 'No se pudo identificar al usuario logueado. Vuelve a iniciar sesión.',
      });
      return;
    }

    // ── Cruce contra el ARL ──
    const arl = validarCedulaContraArl(index, cedula, fechaIngreso);

    if (arl.hallazgos.length) {
      // Auditoría: los hallazgos quedan en la misma tabla de errores que
      // alimentaba hiring-report, con el mismo `tipo`, para no partir el
      // histórico de "Validación ARL" en dos fuentes.
      void this.guardarHallazgosArl(cedula, arl.hallazgos.map((h) => h.mensaje));
    }

    if (!arl.ok) {
      const items = arl.hallazgos.map((h) => `<li>${h.mensaje}</li>`).join('');
      const res = await Swal.fire({
        icon: 'error',
        title: 'El ARL no cuadra',
        html:
          `<ul style="text-align:left;">${items}</ul>` +
          `<p style="text-align:left; margin-top:10px;">` +
          `Corrige la afiliación en el portal de la ARL o la fecha de ingreso del contrato, ` +
          `descarta el Excel y vuelve a subirlo.</p>`,
        showCancelButton: true,
        confirmButtonText: 'Finalizar de todas formas',
        cancelButtonText: 'Cancelar',
        reverseButtons: true,
      });
      if (!res.isConfirmed) return;
    } else if (arl.hallazgos.length) {
      // Fecha correcta pero con duplicados: avisa y sigue.
      await Swal.fire({
        icon: 'warning',
        title: 'Revisar ARL',
        html: `<ul style="text-align:left;">${arl.hallazgos.map((h) => `<li>${h.mensaje}</li>`).join('')}</ul>`,
      });
    }

    this.finalizando.set(true);
    Swal.fire({ title: 'Finalizando...', didOpen: () => Swal.showLoading() });

    try {
      const resp: any = await firstValueFrom(
        this.reportesSvc.finalizarContratacion({
          numero_documento: cedula,
          tipo_doc: cand?.tipo_doc ?? null,
          responsable,
          arl: {
            ok: arl.ok,
            fecha: arl.fechaIso,
            detalle: arl.hallazgos.map((h) => h.mensaje).join('. ') || null,
          },
        }),
      );

      Swal.close();

      const docs = resp?.documentos ?? {};
      const faltantes: string[] = [];
      if (!docs.cedula) faltantes.push('cédula escaneada');
      if (!docs.sst_individual) faltantes.push('SST');

      const totales = resp?.totales ?? {};
      // La clave sale del candidato CAPTURADO al inicio: leer la selección
      // actual tras el await marcaba como "finalizado" a quien estuviera en
      // pantalla en ese momento, no a quien se finalizó.
      const clave = this.claveTitular(cand);
      if (clave) this.finalizadas.update((prev) => new Set(prev).add(clave));

      await Swal.fire({
        icon: faltantes.length ? 'warning' : 'success',
        title: resp?.creado === false ? 'Reporte actualizado' : 'Contratación finalizada',
        html:
          `Quedó en el reporte de <b>${resp?.contratacion?.oficina ?? '—'}</b> ` +
          `como <b>${resp?.contratacion?.tem ?? 'sin empresa'}</b>.<br><br>` +
          `Acumulado del día: Tu Alianza <b>${totales.cantidadContratosTuAlianza ?? 0}</b>, ` +
          `Apoyo Laboral <b>${totales.cantidadContratosApoyoLaboral ?? 0}</b>.` +
          (faltantes.length
            ? `<br><br><span style="color:#b45309;">No se encontró en gestión documental: ` +
              `<b>${faltantes.join(', ')}</b>. Súbelo desde "Generar documentación" y ` +
              `vuelve a finalizar para enlazarlo.</span>`
            : ''),
      });
    } catch (e: any) {
      Swal.close();
      console.error('[finalizarContratacion] Error:', e);
      const backend = e?.error ?? e;
      await Swal.fire({
        icon: 'error',
        title: 'No se pudo finalizar',
        html:
          (backend?.message || e?.message || 'El servidor respondió con un error sin detalle.') +
          (backend?.detail ? `<br><br><small>${backend.detail}</small>` : ''),
      });
    } finally {
      this.finalizando.set(false);
    }
  }

  /** Envío silencioso de los hallazgos ARL a la tabla de errores de validación. */
  private async guardarHallazgosArl(cedula: string, mensajes: string[]): Promise<void> {
    if (!mensajes.length) return;
    try {
      await this.hiringSvc.enviarErroresValidacion({
        errores: [{ registro: cedula, errores: mensajes }],
        responsable: this.usuarioActual(),
        oficina: this.oficinaDelContrato(),
        tipo: 'Validación ARL',
      });
    } catch (e) {
      // Silencioso a propósito: es auditoría, no puede bloquear la finalización.
      console.error('[guardarHallazgosArl] Falló el envío:', e);
    }
  }

  /**
   * Índice del tab activo. Controlado para poder forzar el regreso a "Turnos"
   * cuando hay un contrato activo (los demás tabs quedan deshabilitados).
   */
  /**
   * Paso visible. Arranca en Selección (2), no en Turnos.
   *
   * Turnos dejó de ser la puerta de entrada: la búsqueda por documento ahora
   * es un diálogo que se abre solo al entrar, así que la pantalla útil desde
   * el primer segundo es la ficha del candidato.
   */
  readonly tabIndex = signal(2);

  // ==========================================================================
  // NAVEGACIÓN EN DOS CAPAS
  // ==========================================================================
  /*
   * El proceso son DOS cosas: seleccionar a la persona y contratarla. Todo lo
   * demás son pasos dentro de una de esas dos.
   *
   * Antes el rail mezclaba niveles —Antecedentes y Exámenes al lado de
   * Selección, cuando en realidad ocurren DENTRO de ella— y encima Selección
   * abría una segunda barra horizontal arriba del contenido. Eran tres
   * navegaciones distintas compitiendo por la misma pantalla.
   *
   * Ahora es una sola idea repetida: capa 1 (los dos momentos) a la izquierda,
   * capa 2 (los pasos del momento abierto) pegada a su derecha, contenido al
   * final. Contratación ya funcionaba así; esto lo generaliza.
   *
   * El `mat-tab-group` sigue siendo el dueño del contenido y del estado de
   * cada pestaña: su cabecera se oculta por CSS y los railes la gobiernan.
   */
  private readonly nav = inject(PipelineNavService);

  /** Bloques que suman al avance de cada capa. */
  private readonly AVANCES_SELECCION: readonly ClaveAvance[] = [
    'entrevista', 'formacion', 'antecedentes', 'remision', 'examenes',
  ];
  private readonly AVANCES_CONTRATACION: readonly ClaveAvance[] = [
    'pago', 'obra', 'referencias', 'traslados', 'huella', 'documentos',
  ];

  readonly capas: readonly CapaPipeline[] = [
    { id: 'seleccion',    label: 'Selección',    icon: 'how_to_reg',           claves: this.AVANCES_SELECCION },
    { id: 'contratacion', label: 'Contratación', icon: 'assignment_turned_in', claves: this.AVANCES_CONTRATACION },
    // La IA no es un paso que se llene: es una lectura del expediente. Va en la
    // primera capa porque se consulta en cualquier momento del proceso, no
    // dentro de Selección, y por eso no lleva porcentaje.
    { id: 'ia',           label: 'Inteligencia artificial', icon: 'auto_awesome', claves: [] },
    // No es un paso del proceso: es el cajón de herramientas. Vive en la misma
    // capa porque se alcanza desde cualquier punto y porque colgado del rail de
    // Contratación quedaba escondido justo cuando se trabaja en Selección.
    { id: 'accesos',      label: 'Accesos rápidos',         icon: 'apps',         claves: [] },
  ];

  /**
   * Los pasos de Selección.
   *
   * `tab` es la pestaña del grupo de este componente y `panel` la sub-pestaña
   * del área de trabajo (que vive dentro de la pestaña 2). Antecedentes y
   * Exámenes son pestañas propias; Entrevista, Formación, Remisión e IA
   * comparten la 2 y se distinguen por el panel.
   */
  readonly subSeleccion: readonly SubPasoSeleccion[] = [
    { id: 'entrevista',   label: 'Entrevista',             icon: 'rate_review',         tab: 2, panel: 'entrevista', clave: 'entrevista' },
    { id: 'formacion',    label: 'Formación y laboral',    icon: 'school',              tab: 2, panel: 'formacion',  clave: 'formacion' },
    { id: 'antecedentes', label: 'Antecedentes',           icon: 'gavel',               tab: 1, panel: null,         clave: 'antecedentes' },
    { id: 'remision',     label: 'Remisión',               icon: 'work',                tab: 2, panel: 'remision',   clave: 'remision' },
    { id: 'examenes',     label: 'Exámenes de ingreso',    icon: 'medical_information', tab: 3, panel: null,         clave: 'examenes' },
  ];

  /**
   * Los pasos de la IA. No llevan porcentaje: no son formularios que se llenen,
   * son dos formas de mirar a la misma persona —lo que la plataforma ya sabe de
   * ella, y preguntarle a la IA lo que sea sobre su proceso—.
   */
  readonly subIa: readonly SubPasoSeleccion[] = [
    { id: 'ia',     label: 'Resumen del perfil', icon: 'insights', tab: 2, panel: 'ia',     clave: null },
    { id: 'iaChat', label: 'Chat',               icon: 'forum',    tab: 2, panel: 'iaChat', clave: null },
  ];

  /** Los pasos de Contratación. El contenido lo pinta `app-hiring-questions`. */
  readonly subContratacion: readonly SubPasoContratacion[] = [
    { id: 'pago',        label: 'Pago y Transporte', icon: 'payments',    idx: 0, clave: 'pago' },
    { id: 'obra',        label: 'Datos de obra',     icon: 'engineering', idx: 1, clave: 'obra' },
    { id: 'referencias', label: 'Referencias',       icon: 'groups',      idx: 2, clave: 'referencias' },
    { id: 'traslados',   label: 'Traslados',         icon: 'swap_horiz',  idx: 3, clave: 'traslados' },
    { id: 'huella',      label: 'Cédula & Huella',   icon: 'fingerprint', idx: 4, clave: 'huella' },
    { id: 'documentos',  label: 'Documentos',        icon: 'folder_copy', idx: 5, clave: 'documentos' },
  ];

  /**
   * Capa 1 abierta. La pestaña 4 es Contratación; la IA vive dentro de la 2
   * (es un panel del área de trabajo) pero se presenta como capa propia; el
   * resto —1, 2 y 3— son pasos de Selección.
   */
  /**
   * Capa 1 abierta.
   *
   * "Accesos rápidos" no tiene contenido propio —no cambia de pestaña, solo
   * cambia lo que lista el rail de al lado—, así que su selección se guarda
   * aparte; el resto se deduce de la pestaña visible.
   */
  private readonly accesosAbiertos = signal(false);

  readonly capaActiva = computed<CapaId>(() => {
    if (this.accesosAbiertos()) return 'accesos';
    if (this.tabIndex() === 4) return 'contratacion';
    const panel = this.nav.panelSeleccion();
    if (this.tabIndex() === 2 && (panel === 'ia' || panel === 'iaChat')) return 'ia';
    return 'seleccion';
  });

  /** Paso de Selección abierto: la pestaña manda, salvo dentro de la 2. */
  readonly subSeleccionActivo = computed<string>(() => {
    const t = this.tabIndex();
    if (t === 1) return 'antecedentes';
    if (t === 3) return 'examenes';
    // Sirve igual para los pasos de Selección y para los dos de la IA: el id de
    // cada uno es su panel.
    return this.nav.panelSeleccion();
  });

  /** Paso de Contratación abierto (lo comparte con `app-hiring-questions`). */
  readonly subContratacionActivo = this.nav.subContratacion;

  /** Último paso de Selección visitado, para volver donde se dejó. */
  private readonly ultimoSubSeleccion = signal<string>('entrevista');

  readonly avanceSeleccion = computed<Avance>(() => this.nav.agregado(this.AVANCES_SELECCION));
  readonly avanceContratacion = computed<Avance>(() => this.nav.agregado(this.AVANCES_CONTRATACION));

  private avanceCapa(id: CapaId): Avance {
    const capa = this.capas.find((c) => c.id === id);
    return this.nav.agregado(capa?.claves ?? []);
  }

  /** % de una capa. `null` = no se mide (la IA) o aún no hay nada que medir. */
  pctCapa(id: CapaId): number | null {
    const a = this.avanceCapa(id);
    return a.total > 0 ? pctDe(a) : null;
  }

  /**
   * Fondo del anillo de la capa 1: el arco lima ES el porcentaje.
   *
   * Se arma aquí y no con una variable CSS para no depender de que el binding
   * a custom properties llegue intacto: el degradado sale ya resuelto.
   */
  fondoAnillo(pct: number | null): string {
    if (pct === null) return 'rgba(255, 255, 255, .14)';
    return `conic-gradient(var(--lime, #8CD50A) ${pct}%, rgba(255, 255, 255, .16) 0)`;
  }

  /** % de un sub-paso. `null` en los que no son formulario (IA). */
  pctSub(clave: ClaveAvance | null): number | null {
    if (!clave) return null;
    const a = this.nav.avance(clave);
    return a && a.total > 0 ? pctDe(a) : null;
  }

  /** Rótulo del avance para el tooltip: dice exactamente qué falta. */
  detalleAvance(label: string, clave: ClaveAvance | null): string {
    if (!clave) return label;
    const a = this.nav.avance(clave);
    if (!a || a.total <= 0) return label;
    const faltan = Math.max(0, a.total - a.hechos);
    return faltan === 0
      ? `${label} · completo (${a.hechos} de ${a.total})`
      : `${label} · ${a.hechos} de ${a.total} · faltan ${faltan}`;
  }

  detalleCapa(label: string, id: CapaId): string {
    const a = this.avanceCapa(id);
    if (a.total <= 0) return label;
    const faltan = Math.max(0, a.total - a.hechos);
    return faltan === 0
      ? `${label} · completo (${a.hechos} de ${a.total})`
      : `${label} · ${a.hechos} de ${a.total} campos · faltan ${faltan}`;
  }

  abrirCapa(id: CapaId): void {
    if (id === 'accesos') {
      // Las herramientas se alcanzan siempre, también con contrato activo: dar
      // de baja o cerrar el día se hace desde aquí.
      this.accesosAbiertos.set(true);
      return;
    }
    this.accesosAbiertos.set(false);
    if (this.bloqueoContratoTabs()) return;
    if (id === 'contratacion') {
      this.tabIndex.set(4);
      return;
    }
    if (id === 'ia') {
      // La IA son dos paneles del área de trabajo. Se entra por el resumen, que
      // es lo que se mira primero; el análisis lo dispara `form-entrevista` al
      // ver el panel en 'ia'.
      if (this.nav.panelSeleccion() !== 'iaChat') this.nav.panelSeleccion.set('ia');
      this.tabIndex.set(2);
      return;
    }
    const sub = this.subSeleccion.find((s) => s.id === this.ultimoSubSeleccion());
    this.abrirSubSeleccion(sub ?? this.subSeleccion[0]);
  }

  abrirSubSeleccion(sub: SubPasoSeleccion): void {
    if (this.bloqueoContratoTabs()) return;
    this.accesosAbiertos.set(false);
    this.ultimoSubSeleccion.set(sub.id);
    if (sub.panel) this.nav.panelSeleccion.set(sub.panel);
    this.tabIndex.set(sub.tab);
  }

  /** Vacante remitida, tal como la publica `help-information`. */
  readonly vacanteAsignada = this.nav.vacanteAsignada;

  /** Avance de los bloques de la ficha, medido por `form-entrevista`. */
  readonly avanceFicha = this.nav.avanceFicha;

  /**
   * Cambiar la vacante. Igual que el lápiz: aquí solo se pide; quien tiene la
   * lista y sabe guardarla es `help-information`.
   */
  pedirVacante(): void {
    // La guarda va sobre el CANDIDATO, no sobre su `numero_documento`: hay
    // registros cargados a los que ese campo les llega vacío —la ficha los
    // pinta con "CC · —"— y exigirlo mandaba al diálogo de búsqueda a alguien
    // que ya tenía la persona en pantalla.
    if (!this.candidatoSeleccionado()) {
      this.abrirPromptDocumento();
      return;
    }
    if (this.bloqueoContratoTabs()) return;
    this.nav.pedirAsignarVacante();
  }

  /**
   * El lápiz de la ficha. No edita aquí: publica QUÉ se quiere editar y lo
   * recoge `form-entrevista`, que es el dueño del formulario con esos campos.
   */
  editarFicha(bloque: string): void {
    // Mismo motivo que en `pedirVacante`: basta con que haya candidato. Y de
    // hecho editar es JUSTO lo que hay que poder hacer cuando al registro le
    // falta el documento.
    if (!this.candidatoSeleccionado()) {
      this.abrirPromptDocumento();
      return;
    }
    this.nav.pedirEdicion(bloque);
  }

  abrirSubContratacion(sub: SubPasoContratacion): void {
    if (this.bloqueoContratoTabs()) return;
    this.accesosAbiertos.set(false);
    this.nav.subContratacion.set(sub.idx);
    this.tabIndex.set(4);
  }

  /**
   * Avance de Exámenes de ingreso.
   *
   * No sale de un hijo: el formulario vive aquí. Cuenta IPS y lista de
   * exámenes, más un apto/no apto por cada examen marcado.
   */
  private publicarAvanceExamenes(): void {
    const base = avanceDeForm(this.formGroup3, ['ips', 'selectedExams']);
    const filas = this.selectedExamsArray.controls;
    const porExamen: Avance = {
      hechos: filas.filter((c) => !!(c.value as ExamenResultadoForm)?.aptoStatus).length,
      total: filas.length,
    };
    this.nav.publicar('examenes', sumarAvances([base, porExamen]));
  }

  /**
   * Turnos ya no es un paso NI una pantalla.
   *
   * La cola del día y el buscador dejaron de mostrarse: se busca por documento
   * desde el diálogo, y las acciones que vivían ahí (Excel, carnés, refrescar)
   * están en el menú de la barra. `SearchForCandidateComponent` sigue montado
   * —fuera del grupo de pestañas y oculto— porque es quien hace la búsqueda
   * real. La pestaña 0 quedó como hueco para no renumerar las demás.
   */
  readonly TAB_BUSCADOR = 0;

  /** Documento tal como se tecleó, para contrastarlo con el que está en base. */
  readonly documentoBuscado = signal<string | null>(null);

  /** Turnos (0) siempre entra; el resto respeta el bloqueo por contrato activo. */
  pasoBloqueado(idx: number): boolean {
    return idx > 0 && this.bloqueoContratoTabs();
  }

  seleccionarPaso(idx: number): void {
    if (this.pasoBloqueado(idx)) return;
    this.tabIndex.set(idx);
  }

  /** Mensaje único del bloqueo por contrato activo, para los dos railes. */
  readonly MOTIVO_BLOQUEO =
    'Dé de baja el contrato activo o usa Modificar de todas formas para continuar';

  // ==========================================================================
  // PROMPT DE DOCUMENTO AL ENTRAR
  // ==========================================================================
  /** El buscador real. El prompt le pasa el documento y dispara SU búsqueda. */
  @ViewChild(SearchForCandidateComponent) private buscador?: SearchForCandidateComponent;

  /** Solo se pregunta una vez por visita; reabrir es manual desde la barra. */
  private promptMostrado = false;

  ngAfterViewInit(): void {
    // Sin candidato no hay nada que hacer en Selección, así que se pregunta de
    // una. Con candidato ya cargado (se volvió de otra pantalla) no se molesta.
    if (this.candidatoSeleccionado()?.numero_documento) return;
    if (this.promptMostrado) return;
    this.promptMostrado = true;
    // Fuera del ciclo de render actual: abrir un diálogo dentro de
    // ngAfterViewInit dispara ExpressionChangedAfterItHasBeenChecked.
    setTimeout(() => this.abrirPromptDocumento());
  }

  /**
   * Pide el documento y delega la búsqueda en `SearchForCandidateComponent`.
   *
   * Se le escriben los campos y se llama a su `buscarCandidato()` en vez de
   * repetir la consulta aquí: ese método también consulta vetados, asegura el
   * estado del robot y encola en la tabla del día. Reimplementarlo habría
   * dejado dos caminos de búsqueda divergiendo.
   */
  // ── Acciones que vivían dentro de Turnos ────────────────────────────────
  /*
   * Descargar Excel, carnés en masa y refrescar estaban enterrados en la
   * pestaña Turnos. Al convertirse Turnos en un diálogo dejaban de estar a
   * mano, así que suben a la barra. Siguen ejecutándose en el buscador, que es
   * su dueño: aquí solo se delega.
   */
  get accionesListas(): boolean {
    return !!this.buscador;
  }

  descargarExcel(): void {
    this.buscador?.abrirDialogExcel();
  }

  generarCarnetsMasivos(): void {
    this.buscador?.pedirCarnetMasivo();
  }

  refrescarRecientes(): void {
    this.buscador?.refrescarRecientes();
  }

  abrirPromptDocumento(): void {
    this.dialog
      .open(DocumentoPromptDialogComponent, { width: '540px', maxWidth: '94vw', autoFocus: false })
      .afterClosed()
      .subscribe((r: DocumentoPrompt | undefined) => {
        if (!r) return;
        const b = this.buscador;
        if (!b) return;
        this.documentoBuscado.set(r.numero);
        b.tipoDocSeleccionado = r.tipoDoc;
        b.cedula = r.numero;
        b.buscarCandidato();
      });
  }

  /**
   * Salto desde la ficha de Selección a los pasos 4 (exámenes) y 5
   * (contratación) del stepper.
   *
   * La ficha ofrece esos dos pasos como pestaña para que, con la persona al
   * frente, no haya que volver arriba a buscarlos. Respeta el mismo bloqueo
   * que los tabs: con contrato activo no se entra sin dar de baja o usar
   * "Modificar de todas formas", igual que si se hiciera click en el paso.
   */
  irAPaso(paso: 'salud' | 'contratacion'): void {
    if (this.bloqueoContratoTabs()) {
      Swal.fire({
        icon: 'info',
        title: 'Contrato activo',
        text: 'Dé de baja el contrato activo o use "Modificar de todas formas" para continuar.',
        confirmButtonColor: '#21263C',
      });
      return;
    }
    this.tabIndex.set(paso === 'salud' ? 3 : 4);
  }

  // ───────── Form Parte 3 ─────────
  formGroup3: FormGroup = this.fb.group({
    ips: ['', Validators.required],
    ipsLab: [''],
    selectedExams: [[], Validators.required],
    selectedExamsArray: this.fb.array([]),
  });

  private selectedExamsCtrl = this.formGroup3.get('selectedExams')!;
  private selectedExamsArray = this.formGroup3.get('selectedExamsArray') as FormArray;

  // Señal booleana: hay al menos un NO APTO
  private hayNoApto = signal<boolean>(false);
  private _warnedNoApto = signal<boolean>(false);

  // 🔔 control para no spamear toasts
  private _lastMissingKey = signal<string>('');

  // ───────── Overlay Toast persistente (no-Swal) ─────────
  private _toastNode: HTMLDivElement | null = null;

  private _ensureToastNode(): HTMLDivElement {
    if (this._toastNode && document.body.contains(this._toastNode)) return this._toastNode;

    const node = document.createElement('div');
    node.setAttribute('role', 'status');
    node.style.position = 'fixed';
    node.style.top = '12px';
    node.style.right = '12px';
    node.style.maxWidth = '420px';
    node.style.zIndex = '2147483647';
    node.style.pointerEvents = 'auto';

    node.innerHTML = `
      <div style="
        background:#fff;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.18);
        border:1px solid rgba(0,0,0,.08);overflow:hidden;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,'Helvetica Neue',Arial;
      ">
        <div style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(0,0,0,.06);">
          <span style="display:inline-flex;width:22px;height:22px;align-items:center;justify-content:center;border-radius:50%;background:#e8f0fe;">ℹ️</span>
          <div style="font-weight:600;color:#222">Faltan requisitos para Contratación</div>
          <button type="button" aria-label="Cerrar" style="
            margin-left:auto;background:transparent;border:0;cursor:pointer;font-size:18px;line-height:1;color:#444;padding:2px 6px;border-radius:8px;
          ">&times;</button>
        </div>
        <div class="body" style="padding:10px 14px;color:#333;font-size:13px;line-height:1.35;max-height:45vh;overflow:auto;"></div>
      </div>
    `;

    const closeBtn = node.querySelector('button');
    closeBtn?.addEventListener('click', () => this._closeToast());

    document.body.appendChild(node);
    this._toastNode = node;
    return node;
  }

  private _renderToast(htmlList: string): void {
    const node = this._ensureToastNode();
    const body = node.querySelector('.body') as HTMLElement | null;
    if (body) body.innerHTML = htmlList;
  }

  private _closeToast(): void {
    if (this._toastNode) {
      this._toastNode.remove();
      this._toastNode = null;
    }
  }

  private isNoApto = (v: unknown) =>
    this.util.normalizeText(v) === 'NOAPTO';

  constructor() {
    // El toast de faltantes vive colgado de document.body y la preview de la
    // foto es un blob URL: si el componente se destruye (navegar a generar
    // documentación, por ejemplo) sin esto, el toast queda pegado sobre la
    // página nueva y el blob no se libera nunca.
    this.destroyRef.onDestroy(() => {
      this._closeToast();
      this.liberarPreviewFoto();
    });

    const safeJson = <T>(raw: any, fallback: T): T => {
      try {
        if (typeof raw !== 'string') return fallback;
        const parsed = JSON.parse(raw);
        return (Array.isArray(parsed) || typeof parsed === 'object') ? (parsed as T) : fallback;
      } catch { return fallback; }
    };

    this.isBrowser.set(isPlatformBrowser(this.platformId));

    // 1) Mantener MISMA instancia de FormArray → clear() + push()
    this.selectedExamsCtrl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((exams: string[]) => {
        const arr = this.selectedExamsArray;
        while (arr.length) arr.removeAt(0);
        (exams || []).forEach(() =>
          arr.push(this.fb.group({ aptoStatus: ['APTO', Validators.required] }))
        );
        // Sincronizar slots de archivos con la cantidad de exámenes seleccionados
        const files = [...(this.examFiles() ?? [])];
        files.length = (exams ?? []).length;
        this.examFiles.set(files);

        this.recalcHayNoApto();
      });

    // 1.1) Recalcular “hayNoApto”
    merge(this.selectedExamsArray.valueChanges, this.selectedExamsArray.statusChanges)
      .pipe(startWith(this.selectedExamsArray.value), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.recalcHayNoApto());

    // 1.2) Publicar el avance de Exámenes al rail. Se escucha el formulario
    //      entero (no solo el FormArray) porque IPS y la lista de exámenes
    //      también cuentan, y se escucha `statusChanges` porque habilitar o
    //      deshabilitar un campo cambia cuántas casillas hay que llenar.
    merge(this.formGroup3.valueChanges, this.formGroup3.statusChanges)
      .pipe(startWith(null), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.publicarAvanceExamenes());

    // 2) Cédula + biometría (embebida y refresh opcional)
    //
    // OJO con lo que dispara este effect: `candidatoSeleccionado` se re-setea
    // con una referencia NUEVA tras cada guardado (recargarCandidato y los
    // flujos de confirmación), no solo cuando cambia la persona. Antes cada
    // guardado relanzaba biometría + documentos + historial (~13 peticiones y
    // el diálogo del historial reabriéndose solo). Ahora las recargas internas
    // se marcan (`refrescoSilencioso`) y solo actualizan lo local; la cascada
    // completa corre únicamente cuando la consulta viene del buscador.
    effect(() => {
      if (!this.isBrowser()) return;
      this.getFullName();
      this.getNumeroDocumento();

      const cand = this.candidatoSeleccionado();
      const ced = cand?.numero_documento ? String(cand.numero_documento) : null;

      const silencioso = this.refrescoSilencioso;
      this.refrescoSilencioso = false;
      // El cambio de persona se detecta por TITULAR (tipo|número): dos
      // titulares distintos pueden compartir número (CC vs C.C/CE) y con la
      // cédula sola pasar de uno al otro se veía como "misma persona".
      const claveTitular = ced ? this.claveTitular(cand) : null;
      const cambioPersona = claveTitular !== this.titularAtendido;
      this.titularAtendido = claveTitular;
      this.cedulaAtendida = ced;

      // Lo embebido en el payload siempre se refleja: es local y ya está fresco.
      this.setBiometriaFromCandidate(cand);

      if (!ced) {
        this.examenMedicoDoc.set(null);
        this.arlDoc.set(null);
        this.fotoDoc.set(null);
        this.liberarPreviewFoto();
        this.fotoDataUrl.set(null);
        return;
      }

      // Recarga interna de la MISMA persona: nada nuevo que pedirle al
      // servidor, y la vista previa local sigue siendo su foto (soltarla acá
      // era lo que dejaba el avatar en blanco justo después de subirla).
      if (silencioso && !cambioPersona) return;

      const bio = cand?.biometria ?? null;
      if (!bio || this.isBioStale(bio)) {
        this.refreshBiometriaForCandidate(ced).catch(() => this.biometria.set(null));
      }
      this.refreshDocsDelCandidato(ced);

      // La vista previa local es del candidato ANTERIOR: si no se suelta, se
      // queda mostrando su foto encima del nuevo (y además fuga el blob).
      this.liberarPreviewFoto();
      this.fotoDataUrl.set(null);
      this.fotoUrlFallida.set(null);

      this.mostrarTabla();
    });

    // 3) Autollenar Salud Ocupacional desde la PRIMERA entrevista
    effect(() => {
      if (!this.isBrowser()) return;
      const cand = this.candidatoSeleccionado();
      const formArray = this.selectedExamsArray;

      if (!cand || !cand.entrevistas?.length) {
        this.saludFingerprint = null;
        this.formGroup3.reset();
        while (formArray.length) formArray.removeAt(0);
        this.examFiles.set([]); // limpiar archivos si no hay entrevista
        this.recalcHayNoApto();
        return;
      }

      const ent = cand.entrevistas[0];
      const proc = ent?.proceso;
      const em = proc?.examen_medico;

      // Este effect corre con CADA referencia nueva del candidato, y tras
      // guardar cualquier pestaña el padre recarga (misma persona, referencia
      // nueva). Si los datos de salud no cambiaron, reconstruir acá borraba
      // los PDFs de exámenes que el usuario ya había adjuntado sin guardar
      // (examFiles volvía a quedar en huecos vacíos) y "No hay archivos PDF
      // de exámenes para unir" aparecía sin explicación.
      const huella = [
        cand.numero_documento, cand.tipo_doc,
        em?.ips ?? '', em?.ips_lab ?? '', em?.examenes ?? '', em?.resultados ?? '',
      ].join('§');
      if (huella === this.saludFingerprint) return;
      this.saludFingerprint = huella;

      if (!em) {
        this.formGroup3.patchValue({ ips: '', ipsLab: '', selectedExams: [] }, { emitEvent: false });
        while (formArray.length) formArray.removeAt(0);
        this.examFiles.set([]);
        this.recalcHayNoApto();
        return;
      }

      const exams: string[] = safeJson<string[]>(em.examenes, []);
      const results: ExamenResultadoForm[] = safeJson<ExamenResultadoForm[]>(em.resultados, []);

      this.formGroup3.patchValue(
        { ips: em.ips ?? '', ipsLab: em.ips_lab ?? '', selectedExams: exams ?? [] },
        { emitEvent: true }
      );

      setTimeout(() => {
        const len = formArray.length;
        for (let i = 0; i < len; i++) {
          const fg = formArray.at(i) as FormGroup;
          fg.patchValue({ aptoStatus: results[i]?.aptoStatus || 'APTO' }, { emitEvent: false });
        }
        // crear slots de archivos acorde a los exámenes autollenados (vacíos por ahora)
        const files = new Array<File>(formArray.length);
        this.examFiles.set(files);
        this.recalcHayNoApto();
      });
    });

    // 4) Aviso/lock por “NO APTO”
    effect(() => {
      if (!this.isBrowser()) return;
      const hay = this.hayNoApto();
      if (hay && !this._warnedNoApto()) {
        this._warnedNoApto.set(true);
        Swal.fire({
          icon: 'warning',
          title: 'Examen no apto',
          text: 'Hay al menos un examen con resultado "NO APTO". Se deshabilitará la pestaña de Contratación.',
          confirmButtonText: 'Entendido',
          allowOutsideClick: false,
          allowEscapeKey: false,
        }).then(() => this.util.nextStep.emit());
      }
      if (!hay && this._warnedNoApto()) this._warnedNoApto.set(false);
    });

    // 5) 🔔 Toast AUTOMÁTICO (overlay propio) con detalle de lo que FALTA (top-end)
    effect(() => {
      if (!this.isBrowser()) return;
      const cand = this.candidatoSeleccionado();
      if (!cand) { this._closeToast(); return; }

      const missing = this._missingForContratacion();
      const key = missing.join('|');

      // solo mostrar si hay algo faltante y cambió el "hash" de motivos
      if (missing.length > 0) {
        if (key !== this._lastMissingKey()) {
          this._lastMissingKey.set(key);
          const htmlList = `<ul style="margin:0;padding-left:18px;text-align:left">
            ${missing.map(m => `<li>${m}</li>`).join('')}
          </ul>`;
          this._renderToast(htmlList);
        } else {
          // ya estaba abierto, no actualizar => nada
        }
      } else {
        // ya no falta nada ⇒ cerrar si está abierto
        this._lastMissingKey.set('');
        this._closeToast();
      }
    });

    // 5.9) Biometría al servicio compartido: el paso Cédula & Huella la pinta y
    //      la captura, pero quien sabe resolver sus URLs es este componente.
    effect(() => {
      this.candidatoSeleccionado();
      this.fotoDataUrl(); this.huellaDataUrl(); this.firmaDataUrl();
      this.nav.biometria.set({
        foto: this.avatarPhotoUrl(),
        firma: this.bioLocalPub('firma') ?? this.getBioUrlPub('firma'),
        huella: this.bioLocalPub('huella') ?? this.getBioUrlPub('huella'),
      });
    });

    // 5.95) "Ábreme la cámara" desde Cédula & Huella.
    effect(() => {
      const n = this.nav.pedidoFoto();
      if (n === this.pedidoFotoAtendido) return;
      this.pedidoFotoAtendido = n;
      if (n > 0) this.openCamera();
    });

    // 5.96) Comprobar correo y WhatsApp desde donde el dato está a la vista:
    //       la ficha y el paso Cédula & Huella.
    effect(() => {
      const n = this.nav.pedidoCorreo();
      if (n === this.pedidoCorreoAtendido) return;
      this.pedidoCorreoAtendido = n;
      if (n > 0) this.confirmarCorreoBienvenida();
    });

    effect(() => {
      const n = this.nav.pedidoWhatsapp();
      if (n === this.pedidoWhatsappAtendido) return;
      this.pedidoWhatsappAtendido = n;
      if (n > 0) this.confirmarWhatsAppBienvenida();
    });

    // 6) Contrato ACTIVO ⇒ el rail y las pestañas quedan deshabilitados hasta
    //    dar de baja (o usar "Modificar de todas formas"); el banner rojo de
    //    arriba explica por qué y ofrece las dos salidas.
    //
    //    Antes esto además saltaba a la pestaña 0 para dejar solo "Turnos".
    //    Turnos ya no es una pantalla, así que ese salto mandaba al usuario a
    //    un panel vacío. Se queda donde estaba: ve el paso bloqueado y el
    //    motivo, que es la información útil.
  }

  // ───────── API UI ────────
  onCandidatoSeleccionado(candidato: any | null): void {
    // El override es por candidato: al cambiar de persona vuelve a exigir "Dar de baja".
    this.modificacionForzada.set(false);
    const proc = candidato?.entrevistas?.[0]?.proceso;
    // Muestra la auditoría previa si el proceso ya trae un override sellado.
    this.overrideAuditNombre.set(proc?.modificado_por || '');
    this.overrideAuditFecha.set(proc?.modificado_en || null);
    // Consulta EXTERNA (del buscador): los hijos incluyen este número en sus
    // llaves de "misma persona", así re-consultar a alguien SÍ re-rellena sus
    // formularios (las recargas internas tras guardar no lo incrementan y por
    // eso no pisan lo editado sin guardar).
    this.consultaSeq.update(v => v + 1);
    this.candidatoSeleccionado.set(candidato);
  }

  /**
   * Recarga el candidato desde el backend tras guardar la entrevista. Si el proceso
   * anterior era terminal, el backend abrió uno nuevo; al re-fetch y setear una
   * referencia nueva, las píldoras (contrato/prueba) y el Historial reflejan el
   * proceso nuevo SIN tener que volver a buscar a la persona.
   */
  recargarCandidato(): void {
    const ced = (this.numeroDocumento || this.candidatoSeleccionado()?.numero_documento || '')
      .toString().trim();
    if (!ced) return;
    // Se recarga el MISMO titular: con cédula duplicada (CC vs C.C), sin el
    // tipo el backend podría devolver la otra fila y "saltar" de persona.
    this.registroProceso.getCandidatoPorDocumento(
      ced, true, this.candidatoSeleccionado()?.tipo_doc
    ).subscribe({
      next: (cand: any) => {
        if (cand) {
          this.refrescoSilencioso = true; // misma persona: sin cascada de peticiones
          this.candidatoSeleccionado.set({ ...cand });
          // Refresca el sello de auditoría del override si el backend lo actualizó.
          const proc = cand?.entrevistas?.[0]?.proceso;
          if (proc?.modificado_por) {
            this.overrideAuditNombre.set(proc.modificado_por);
            this.overrideAuditFecha.set(proc.modificado_en || null);
          }
        }
      },
      error: (err: any) => console.error('[pipeline] No se pudo recargar el candidato:', err),
    });
  }

  getFullName(): void {
    const c = this.candidatoSeleccionado();
    this.nombreCandidato = c
      ? [c.primer_nombre, c.segundo_nombre, c.primer_apellido, c.segundo_apellido]
        .map(v => (v ?? '').toString().trim())
        .filter(v => v.length > 0)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      : '';
  }

  getNumeroDocumento(): void {
    const c = this.candidatoSeleccionado();
    this.numeroDocumento = c?.numero_documento != null ? String(c.numero_documento).trim() : '';
  }

  generacionDocumentos(): void {
    this.router.navigate(['dashboard/hiring/generate-contracting-documents', this.numeroDocumento]);
  }

  // ───────── CARNETS MASIVOS ─────────
  /**
   * Abre la revisión de generación masiva de carnets con las cédulas de la
   * cola del día. El diálogo valida quién tiene todo completo, marca por
   * defecto solo a los que aún no tienen carnet y deja previsualizar antes de
   * generar.
   */
  /**
   * Borra la entrevista/proceso del candidato consultado.
   *
   * Lo que NO se borra: el candidato ni su formulario web. Si llenó el paso 1 o
   * el formulario completo, eso queda intacto — no tiene por qué volver a
   * llenarlo porque se anuló un proceso de selección.
   *
   * Lo que sí se va, en cascada: proceso, contrato y antecedentes.
   */
  /** Aviso/confirmación como MatDialog, para poder abrirlo sobre otro diálogo. */
  private avisoDialog(data: AvisoDialogData): Promise<boolean> {
    return firstValueFrom(
      this.dialog.open<AvisoDialogComponent, AvisoDialogData, boolean>(
        AvisoDialogComponent, { data, autoFocus: 'dialog', restoreFocus: false },
      ).afterClosed(),
    ).then(r => r === true);
  }

  async eliminarProcesoDelHistorial(row: any): Promise<boolean> {
    const doc = String(
      row?.numero_documento
      ?? this.candidatoSeleccionado()?.numero_documento
      ?? this.numeroDocumento
      ?? '',
    ).trim();
    if (!doc) return false;

    // `id` de la fila = ProcesoCandidato.id (lo trae ProcesoMiniSerializer).
    // Se manda explícito para borrar ESE registro y no el más reciente.
    const procesoId = Number(row?.id) || null;
    const codigo = String(row?.codigo_contrato ?? '').trim();

    // MatDialog y no Swal: esto se dispara DESDE el diálogo del historial y un
    // Swal ahí queda detrás. El CDK apila por orden de apertura.
    const isConfirmed = await this.avisoDialog({
      icono: 'warning',
      titulo: 'Eliminar el proceso',
      html:
        `Se borra la <b>entrevista completa</b> de este registro (<b>${doc}</b>), con su proceso, `
        + `antecedentes${codigo ? ` y el contrato <b>${codigo}</b>` : ''}.`
        + `<br><br><b>NO</b> se borra el candidato ni su formulario web: `
        + `lo que llenó (paso 1 o formulario completo) queda igual.`
        + `<br><br>Esto no se puede deshacer.`,
      textoConfirmar: 'Sí, eliminar',
      textoCancelar: 'Cancelar',
    });
    if (!isConfirmed) return false;

    const borrar = (forzar: boolean) =>
      firstValueFrom(this.registroProceso.eliminarProceso(doc, { procesoId, forzar }));

    try {
      let res;
      try {
        res = await borrar(false);
      } catch (e: any) {
        // 409 = contrato activo. Se pregunta una segunda vez, con el código a
        // la vista, en vez de borrarlo de una.
        if (e?.status !== 409) throw e;
        const forzarOk = await this.avisoDialog({
          icono: 'error',
          titulo: 'El contrato está ACTIVO',
          html: `Esta persona tiene el contrato <b>${e?.error?.codigo_contrato || codigo || '—'}</b> vigente.`
            + `<br><br>Lo normal es darle la baja primero. ¿Aun así quieres borrar el proceso?`,
          textoConfirmar: 'Borrar de todas formas',
          textoCancelar: 'Cancelar',
        });
        if (!forzarOk) return false;
        res = await borrar(true);
      }

      await this.avisoDialog({
        icono: 'success',
        titulo: 'Proceso eliminado',
        html: `Se borró la entrevista <b>${res.eliminado.entrevista_id}</b>`
          + (res.eliminado.antecedentes ? ` y ${res.eliminado.antecedentes} antecedente(s)` : '')
          + `.<br><br>El candidato y su formulario siguen ahí.`,
      });
      return true;
    } catch (e: any) {
      console.error('[pipeline] eliminar proceso', e);
      await this.avisoDialog({
        icono: 'error', titulo: 'Error',
        html: mensajeDeErrorLog('pipeline/eliminar-proceso', e, 'No se pudo eliminar el proceso.'),
      });
      return false;
    }
  }

  async abrirCarnetMasivo(cedulas: string[] = []): Promise<void> {
    const ref = this.dialog.open(CarnetMasivoDialogComponent, {
      maxWidth: '96vw',
      maxHeight: '92vh',
      data: { cedulas },
      panelClass: 'dialog-responsive',
    });
    const hubo = await firstValueFrom(ref.afterClosed());
    // Si se generó alguno, el candidato abierto puede haber cambiado de estado.
    if (hubo && this.candidatoSeleccionado()?.numero_documento) this.recargarCandidato();
  }

  // ───────── ANTECEDENTES (ROBOTS) ─────────
  /**
   * Re-abre las 8 fuentes de antecedentes del candidato consultado para que la
   * flota vuelva a consultarlas y suba PDFs nuevos.
   *
   * Normalmente el backend solo re-consulta cuando la fila lleva más de
   * ESTADO_ROBOT_STALE_DAYS sin tocarse (o cuando la persona llena el
   * formulario web). Este botón es la salida manual para cuando se necesita el
   * antecedente al día ya. Cuesta una pasada completa de robots, por eso pide
   * confirmación explícita.
   */
  async forzarConsultaAntecedentes(): Promise<void> {
    const cand = this.candidatoSeleccionado();
    const doc = cand?.numero_documento != null ? String(cand.numero_documento).trim() : '';
    if (!doc) return;

    const { isConfirmed } = await Swal.fire({
      icon: 'question',
      title: 'Forzar consulta de antecedentes',
      html:
        `Se volverán a consultar <b>todos</b> los antecedentes de ` +
        `<b>${this.nombreCandidato || doc}</b> (${doc}).<br><br>` +
        `Los estados actuales se archivan y quedan en <b>SIN_CONSULTAR</b>; ` +
        `los robots los toman en los próximos minutos y suben los PDF nuevos.`,
      showCancelButton: true,
      confirmButtonText: 'Sí, volver a consultar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#111827',
    });
    if (!isConfirmed) return;

    try {
      Swal.fire({ title: 'Re-abriendo antecedentes...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
      const resp = await firstValueFrom(this.registroProceso.forzarConsultaAntecedentes({
        tipo_doc: cand?.tipo_doc ?? null,
        numero_documento: doc,
      }));
      Swal.close();
      const msg = resp?.mensaje || 'Antecedentes re-abiertos.';
      if (resp?.reabierto) {
        this.snack.open(msg, 'OK', { duration: 5000 });
      } else {
        // Ya estaba en cola / no había nada que re-abrir: no es un error.
        Swal.fire({ icon: 'info', title: 'Sin cambios', text: msg, confirmButtonColor: '#111827' });
      }
    } catch (err: any) {
      Swal.close();
      console.error('[antecedentes] forzar falló', err);
      const detalle = err?.error?.detail || err?.message || 'No se pudo re-abrir la consulta.';
      Swal.fire({ icon: 'error', title: 'No se pudo', text: detalle, confirmButtonColor: '#111827' });
    }
  }

  // ───────── CONFIRMACIÓN CONTACTO ─────────
  /**
   * Comprobar que el correo EXISTE.
   *
   * Antes esto abría un textarea, no enviaba nada y marcaba el contacto como
   * comprobado igual: se comprobaba la intención del operador, no el correo de
   * la persona. Ahora se manda de verdad con una plantilla publicada, y solo se
   * marca si el proveedor confirma el envío.
   */
  async confirmarCorreoBienvenida(): Promise<void> {
    const cand = this.candidatoSeleccionado();
    if (!cand?.id) return;

    const destino = (cand.contacto?.email || cand.correo_electronico || cand.correo || '').trim() || null;
    if (!destino) {
      await Swal.fire('Sin correo', 'Esta persona no tiene correo registrado. Añádelo en la ficha.', 'info');
      return;
    }

    const r = await firstValueFrom(this.dialog.open<
      ContactoComprobarDialogComponent, unknown, ContactoComprobarResultado
    >(ContactoComprobarDialogComponent, {
      width: '640px', maxWidth: '95vw', autoFocus: false,
      data: {
        modo: 'correo',
        nombre: this.nombreCandidato || null,
        cedula: cand.numero_documento ? String(cand.numero_documento) : null,
        destino,
        password: null,
      },
    }).afterClosed());

    if (!r?.confirmado) return;
    await this.marcarContacto(cand, { correo_confirmado: true }, 'Correo comprobado');
  }

  /** Marca el contacto y refleja el cambio sin relanzar toda la cascada. */
  private async marcarContacto(
    cand: Record<string, any>,
    campos: { correo_confirmado?: boolean; whatsapp_confirmado?: boolean },
    aviso: string,
  ): Promise<void> {
    try {
      Swal.fire({ title: 'Guardando…', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
      await firstValueFrom(this.registroProceso.confirmarContacto(cand['id'], campos));
      // Referencia NUEVA: con la misma, la señal no notifica, el effect nunca
      // consume `refrescoSilencioso` y la bandera queda pegada (la siguiente
      // consulta real de esta persona se saltaría la cascada).
      this.refrescoSilencioso = true;
      this.candidatoSeleccionado.set({
        ...cand,
        contacto: { ...(cand['contacto'] || {}), ...campos },
      });
      Swal.close();
      this.snack.open(aviso, 'OK', { duration: 3000 });
    } catch (err) {
      Swal.close();
      Swal.fire('Error', mensajeDeErrorLog('confirmarContacto', err, 'No se pudo guardar.'), 'error');
    }
  }

  /**
   * Comprobar que el WhatsApp EXISTE.
   *
   * Mismo problema que el correo: no mandaba nada. Ahora arma el mensaje con el
   * enlace de ingreso, el usuario y la contraseña, abre WhatsApp con el texto
   * puesto, y marcar queda a un paso aparte —quien sabe si llegó es quien lo
   * mandó—.
   */
  async confirmarWhatsAppBienvenida(): Promise<void> {
    const cand = this.candidatoSeleccionado();
    if (!cand?.id) return;

    const destino = (cand.contacto?.whatsapp || cand.contacto?.celular
      || cand.numCelular || cand.telefono || cand.celular || '').toString().trim() || null;
    if (!destino) {
      await Swal.fire('Sin número', 'Esta persona no tiene WhatsApp registrado. Añádelo en la ficha.', 'info');
      return;
    }

    const r = await firstValueFrom(this.dialog.open<
      ContactoComprobarDialogComponent, unknown, ContactoComprobarResultado
    >(ContactoComprobarDialogComponent, {
      width: '640px', maxWidth: '95vw', autoFocus: false,
      data: {
        modo: 'whatsapp',
        nombre: this.nombreCandidato || null,
        cedula: cand.numero_documento ? String(cand.numero_documento) : null,
        destino,
        password: cand.contacto?.password || cand.password || null,
      },
    }).afterClosed());

    if (!r?.confirmado) return;
    await this.marcarContacto(cand, { whatsapp_confirmado: true }, 'WhatsApp comprobado');
  }

  async darDeBajaManual() {
    const cc = this.candidatoSeleccionado()?.numero_documento;
    if (!cc) return;
    
    const hoy = new Date().toISOString().split('T')[0];
    const { value: formValues } = await Swal.fire({
      title: 'Dar de baja contrato',
      width: 520,
      iconHtml: '<span style="font-size:36px;">⚠️</span>',
      html: `
        <style>
          .baja-form { text-align:left; display:flex; flex-direction:column; gap:16px; margin-top:8px; }
          .baja-form .sub { font-size:13px; color:#64748b; margin:-4px 0 8px; text-align:center; }
          .baja-form label { display:block; font-size:13px; font-weight:600; color:#334155; margin-bottom:6px; letter-spacing:.2px; }
          .baja-form .campo input, .baja-form .campo textarea {
            width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid #cbd5e1; border-radius:8px;
            font-size:14px; color:#0f172a; background:#f8fafc; transition:border-color .15s, box-shadow .15s, background .15s;
            font-family: inherit;
          }
          .baja-form .campo input:focus, .baja-form .campo textarea:focus {
            outline:none; border-color:#dc2626; background:#fff; box-shadow:0 0 0 3px rgba(220,38,38,.12);
          }
          .baja-form textarea { resize:vertical; min-height:96px; }
          .baja-form .hint { font-size:11px; color:#94a3b8; margin-top:4px; }
        </style>
        <div class="baja-form">
          <div class="sub">Esta acción desactivará el contrato y registrará el motivo del retiro.</div>
          <div class="campo">
            <label for="swal-fecha-baja">Fecha de retiro</label>
            <input type="date" id="swal-fecha-baja" value="${hoy}" max="${hoy}">
          </div>
          <div class="campo">
            <label for="swal-motivo-baja">Motivo de retiro</label>
            <textarea id="swal-motivo-baja" rows="4" placeholder="Describa brevemente el motivo del retiro"></textarea>
            <div class="hint">Este texto se guardará como motivo_retiro.</div>
          </div>
        </div>
      `,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Confirmar baja',
      confirmButtonColor: '#dc2626',
      cancelButtonText: 'Cancelar',
      cancelButtonColor: '#64748b',
      reverseButtons: true,
      customClass: { popup: 'swal-baja-popup' },
      preConfirm: () => {
        const fecha = (document.getElementById('swal-fecha-baja') as HTMLInputElement).value;
        const motivo = (document.getElementById('swal-motivo-baja') as HTMLTextAreaElement).value.trim();
        if (!fecha) { Swal.showValidationMessage('La fecha es obligatoria'); return false; }
        if (!motivo) { Swal.showValidationMessage('El motivo es obligatorio'); return false; }
        return { fecha, motivo };
      }
    });

    if (formValues) {
      Swal.fire({ title: 'Actualizando estado...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
      try {
        const payload = {
          numero_documento: cc,
          // Se da de baja EL proceso del contrato, no "el último": si la
          // persona tiene un turno nuevo abierto, por cédula el backend
          // crearía otro proceso y dejaría vivo el contrato real.
          proceso_id: this._procesoContrato()?.id ?? undefined,
          contrato_detalle: {
            contrato_activo: false,
            fecha_retiro: formValues.fecha,
            motivo_retiro: formValues.motivo
          }
        };
        await firstValueFrom(this.registroProceso.updateProcesoByDocumento(payload as any));

        // Estado local sobre el proceso que TIENE el contrato (no siempre es el
        // de la primera entrevista), con referencias nuevas para que el pill
        // del header se repinte.
        const cand = this.candidatoSeleccionado();
        const objetivo = this._procesoContrato();
        if (cand && objetivo?.contrato) {
          const entrevistas = (cand.entrevistas ?? []).map((e: any) =>
            e?.proceso === objetivo
              ? {
                  ...e,
                  proceso: {
                    ...e.proceso,
                    contrato: {
                      ...e.proceso.contrato,
                      contrato_activo: false,
                      fecha_retiro: formValues.fecha,
                      motivo_retiro: formValues.motivo,
                    },
                  },
                }
              : e,
          );
          this.refrescoSilencioso = true;
          this.candidatoSeleccionado.set({ ...cand, entrevistas });
        }
        Swal.fire('¡Baja exitosa!', `El contrato de ${this.nombreCandidato} ha sido desactivado.`, 'success');
      } catch (err) {
        Swal.close();
        console.error(err);
        Swal.fire('Error', 'No se pudo desactivar el contrato', 'error');
      }
    }
  }

  /**
   * Registra el resultado de la prueba técnica desde el pill del header.
   *
   * Es solo un marcador: NO toca `prueba_tecnica` (que se puso en true al remitir y
   * es lo que habilita Contratación), así que registrar "no pasó" no bloquea el
   * pipeline. Mismo payload y misma semántica que el bloque de help-information.
   */
  async registrarResultadoPrueba(): Promise<void> {
    const cc = this.candidatoSeleccionado()?.numero_documento;
    if (!cc || !this.esPruebaTecnica()) return;

    // Mismo diálogo que usa el cumplimiento de la vacante: una sola
    // implementación para que ambos pidan y validen igual.
    const elegido = await pedirResultadoEtapa(this.dialog, 'prueba', {
      resultado: this.resultadoPrueba(),
      motivoNoPaso: this._proceso()?.motivo_no_paso_prueba_tecnica,
      motivoNoSePresento: this._proceso()?.motivo_no_se_presento_prueba_tecnica,
    }, this.nombreCandidato);
    if (!elegido) return;

    const { resultado, motivo } = elegido;

    const payload: any = {
      numero_documento: String(cc),
      // Se guarda sobre el proceso que se está viendo: sin esto el backend
      // resuelve la última entrevista y podría marcar otro proceso.
      proceso_id: this._proceso()?.id ?? undefined,
      ...payloadResultadoEtapa('prueba', resultado, motivo),
    };

    Swal.fire({ title: 'Guardando resultado...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    try {
      const resp: any = await firstValueFrom(
        this.registroProceso.updateProcesoByDocumento(payload, 'PATCH')
      );

      // Estado local para que el pill cambie EN EL ACTO, sin re-buscar. El helper
      // crea referencias nuevas en toda la cadena para que los computed del pill
      // recalculen (ver aplicarResultadoPruebaLocal).
      const cand = this.candidatoSeleccionado();
      if (cand?.entrevistas?.[0]?.proceso) {
        this.refrescoSilencioso = true;
        this.candidatoSeleccionado.set(
          aplicarResultadoPruebaLocal(cand, {
            resultado,
            motivo,
            procResp: resp?.proceso,
            ahora: new Date().toISOString(),
          }),
        );
      } else {
        // El PATCH fue al proceso VIGENTE (entrevistas[1] cuando entrevistas[0]
        // es un turno sin proceso), que el update local de arriba no cubre: sin
        // recargar, el pill seguiría en "Enviado a prueba" tras el éxito.
        this.recargarCandidato();
      }

      const titulos: Record<string, string> = {
        paso: 'Registrado: pasó la prueba.',
        no_paso: 'Registrado: no pasó la prueba.',
        no_se_presento: 'Registrado: no se presentó a la prueba.',
      };
      await Swal.fire({
        title: titulos[resultado],
        icon: 'success',
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 2500,
        timerProgressBar: true,
      });
    } catch (err: any) {
      console.error('Error registrando resultado de prueba técnica:', err);
      const detalle = err?.error?.detail || 'No se pudo registrar el resultado.';
      await Swal.fire({ title: 'Error', text: detalle, icon: 'error' });
    }
  }

  /**
   * Registra el resultado del examen médico desde el pill del header.
   *
   * Marcador de outcome: NO toca `examenes_medicos` (que indica que los
   * exámenes se cargaron) ni bloquea el pipeline. Usa el mismo diálogo que el
   * de cumplimiento de vacantes.
   */
  async registrarResultadoExamen(): Promise<void> {
    const cc = this.candidatoSeleccionado()?.numero_documento;
    if (!cc) return;

    const proc = this._proceso();
    const elegido = await pedirResultadoEtapa(this.dialog, 'examen', {
      resultado: this.resultadoExamen(),
      motivoNoPaso: proc?.motivo_no_paso_examen_medico,
      motivoNoSePresento: proc?.motivo_no_se_presento_examen_medico,
    }, this.nombreCandidato);
    if (!elegido) return;

    const payload: any = {
      numero_documento: String(cc),
      proceso_id: this._proceso()?.id ?? undefined,
      ...payloadResultadoEtapa('examen', elegido.resultado, elegido.motivo),
    };

    Swal.fire({ title: 'Guardando resultado...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    try {
      await firstValueFrom(this.registroProceso.updateProcesoByDocumento(payload, 'PATCH'));

      // Estado local con referencias nuevas para que el pill cambie en el acto
      // (los computed del header memoizan por referencia).
      const cand = this.candidatoSeleccionado();
      const proceso = cand?.entrevistas?.[0]?.proceso;
      if (proceso) {
        const ahora = new Date().toISOString();
        const noPaso = elegido.resultado === 'no_paso';
        const noShow = elegido.resultado === 'no_se_presento';
        const procActualizado = {
          ...proceso,
          paso_examen_medico: elegido.resultado === 'paso',
          paso_examen_medico_at: elegido.resultado === 'paso' ? ahora : null,
          no_paso_examen_medico: noPaso,
          no_paso_examen_medico_at: noPaso ? ahora : null,
          motivo_no_paso_examen_medico: noPaso ? elegido.motivo : null,
          no_se_presento_examen_medico: noShow,
          no_se_presento_examen_medico_at: noShow ? ahora : null,
          motivo_no_se_presento_examen_medico: noShow ? elegido.motivo : null,
        };
        const entrevistas = [...(cand!.entrevistas ?? [])];
        entrevistas[0] = { ...entrevistas[0], proceso: procActualizado };
        this.refrescoSilencioso = true;
        this.candidatoSeleccionado.set({ ...cand, entrevistas });
      } else {
        // Mismo respaldo que en registrarResultadoPrueba: el guardado fue al
        // proceso vigente y el update local no aplicó — recargar para que el
        // pill del examen refleje el resultado.
        this.recargarCandidato();
      }

      const titulos: Record<string, string> = {
        paso: 'Registrado: pasó el examen médico.',
        no_paso: 'Registrado: no pasó el examen médico.',
        no_se_presento: 'Registrado: no se presentó al examen médico.',
      };
      await Swal.fire({
        title: titulos[elegido.resultado],
        icon: 'success',
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 2500,
        timerProgressBar: true,
      });
    } catch (err: any) {
      console.error('Error registrando resultado del examen médico:', err);
      const detalle = err?.error?.detail || 'No se pudo registrar el resultado.';
      await Swal.fire({ title: 'Error', text: detalle, icon: 'error' });
    }
  }

  // ───────── VALIDACIÓN PARA HABILITAR/DESHABILITAR CONTRATACIÓN ─────────
  // ───────── VALIDACIÓN PARA HABILITAR/DESHABILITAR CONTRATACIÓN ─────────
  private _norm(s: any): string {
    return this.util.normalizeText(s);
  }

  private _firstProceso(cand: any): any | null {
    // El proceso a evaluar es el VIGENTE (primera entrevista CON proceso), no
    // entrevistas[0] a secas: un turno nuevo sin proceso es un estado válido
    // (ver contrato.rules) y con la ruta vieja el toast de "faltan requisitos"
    // se abría para personas que tenían todo en orden en el proceso real.
    return procesoVigente(cand) ?? null;
  }

  private _antecedenteValor(proc: any, nombre: string): string | null {
    const want = this._norm(nombre);
    const lista = proc?.antecedentes ?? [];
    let val: string | null = null;
    for (const it of lista) {
      if (this._norm(it?.nombre) === want) {
        val = it?.observacion ?? null; // si hay duplicados, se queda con el último
      }
    }
    return val;
  }

  private _antecedentesCumplen(proc: any): boolean {
    // Regla estricta: EPS = "CUMPLE", PROCURADURIA = "CUMPLE", POLICIVOS = "CUMPLE"
    const eps = this._norm(this._antecedenteValor(proc, 'EPS'));
    const pro = this._norm(this._antecedenteValor(proc, 'PROCURADURIA'));
    const poli = this._norm(this._antecedenteValor(proc, 'POLICIVOS'));
    return eps === 'CUMPLE' && pro === 'CUMPLE' && poli === 'CUMPLE';
  }

  private _etapasOk(proc: any): boolean {
    const entrevistado = proc?.entrevistado === true;
    const remision = proc?.remision === true; // requerido explícitamente
    const pruebaOAprob = proc?.prueba_tecnica === true || proc?.autorizado === true;
    const examenes = proc?.examenes_medicos === true;
    return entrevistado && remision && pruebaOAprob && examenes;
  }

  /** Devuelve lista de mensajes con lo que falta para habilitar Contratación */
  private _missingForContratacion(): string[] {
    const cand = this.candidatoSeleccionado();
    if (!cand || !Array.isArray(cand.entrevistas) || cand.entrevistas.length === 0) {
      return ['Debe existir al menos una entrevista (entrevistas[0]).'];
    }

    const proc = this._firstProceso(cand);
    if (!proc) return ['La primera entrevista no tiene proceso asociado.'];

    const missing: string[] = [];

    // Antecedentes
    const vEPS = this._antecedenteValor(proc, 'EPS');
    const vPROC = this._antecedenteValor(proc, 'PROCURADURIA');
    const vPOLI = this._antecedenteValor(proc, 'POLICIVOS');

    // ✅ EPS: sólo que NO esté vacío
    if (!vEPS || this._norm(vEPS).length === 0) {
      missing.push(`Antecedente EPS no debe estar vacío (actual: ${vEPS ?? 'sin registro'})`);
    }

    // Se mantienen estos como "CUMPLE"
    if (this._norm(vPROC) !== 'CUMPLE') {
      missing.push(`Antecedente PROCURADURIA debe estar en "CUMPLE" (actual: ${vPROC ?? 'sin registro'})`);
    }
    if (this._norm(vPOLI) !== 'CUMPLE') {
      missing.push(`Antecedente POLICIVOS debe estar en "CUMPLE" (actual: ${vPOLI ?? 'sin registro'})`);
    }

    // Etapas del proceso
    if (proc?.entrevistado !== true) {
      missing.push('Marcar proceso.entrevistado en TRUE.');
    }

    // ❌ remision ya no es requisito
    // if (proc?.remision !== true) missing.push('Marcar proceso.remision en TRUE.');

    // ✅ Al menos uno: prueba_tecnica o autorizado
    const tienePruebaTecnica = proc?.prueba_tecnica === true;
    const tieneAutorizado = proc?.autorizado === true;
    if (!(tienePruebaTecnica || tieneAutorizado)) {
      missing.push('Debe estar TRUE al menos uno: "prueba_tecnica" o "autorizado".');
    }

    if (proc?.examenes_medicos !== true) {
      missing.push('Marcar proceso.examenes_medicos en TRUE.');
    }

    // NO APTO local (form)
    const arr = (this.selectedExamsArray.value ?? []) as ExamenResultadoForm[];
    const hayNoApto = Array.isArray(arr) && arr.some(x => this.isNoApto(x?.aptoStatus));
    if (hayNoApto) {
      missing.push('Hay al menos un examen con resultado "NO APTO".');
    }

    return missing;
  }


  // Usado por la plantilla: <mat-tab [disabled]="deshabilitarContratacion()">
  deshabilitarContratacion(): boolean {
    return this._missingForContratacion().length > 0;
  }

  // ───────── Salud ocupacional (PDF) ─────────
  // ───────── Salud ocupacional (PDF) ─────────
  private isPdf(file?: File | null): file is File {
    return this.pdfSvc.isPdf(file);
  }

  private normalizarSedeAbbr(raw: string | undefined | null): string {
    const s = (raw || '').toString().trim().toUpperCase();
    return this.abreviaciones[s] || s;
  }

  // ========= Utilidades nombres/fechas =========
  // ========= Utilidades nombres/fechas =========
  private slug(input: string): string {
    return this.util.normalizeText(input)
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  private yyyymmdd(d = new Date()): string {
    const iso = this.util.formatDateForBackend(d);
    return iso ? iso.replace(/-/g, '') : '';
  }

  private buildExamFilename(examName: string, cedula: string): string {
    const base = this.slug(examName || 'EXAMEN');
    return `${base}_${cedula}_${this.yyyymmdd()}.pdf`;
  }

  // ========= Helpers de UI para no congelar =========
  private nextFrame(): Promise<void> {
    return new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
  private yieldUI(): Promise<void> {
    return new Promise<void>(resolve => setTimeout(resolve, 0));
  }

  // ========= Unir todos los PDFs de exámenes en uno solo =========
  // ========= Unir todos los PDFs de exámenes en uno solo =========
  private async mergeExamPdfs(
    pairs: { name: string; file: File }[],
    mergedName: string,
    onProgress?: (i: number, total: number) => void
  ): Promise<File> {
    return this.pdfSvc.mergePdfs(pairs.map(p => p.file), mergedName, onProgress);
  }

  // ========= Guardar + Unir + Subir =========
  async imprimirSaludOcupacional(): Promise<void> {
    if (this.isSavingMedical()) return;

    // Bloqueo: candidato EN ESPERA de vacante o NO APLICA → no se cargan exámenes.
    if (this.bloqueado()) {
      await Swal.fire({
        title: `Candidato ${this.motivoBloqueo()}`,
        text: 'No se pueden registrar exámenes de ingreso con la observación actual del evaluador.',
        icon: 'info',
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 3500,
        timerProgressBar: true,
      });
      return;
    }

    const f = this.formGroup3.value;
    const numeroDocumento = this.candidatoSeleccionado()?.numero_documento;
    if (!numeroDocumento) {
      await Swal.fire({ title: 'Falta el número de documento del candidato', icon: 'info', toast: true, position: 'top-end', showConfirmButton: false, timer: 3000, timerProgressBar: true });
      return;
    }

    this.isSavingMedical.set(true);
    try {
      await this._imprimirSaludOcupacionalCore();
    } finally {
      this.isSavingMedical.set(false);
    }
  }

  private async _imprimirSaludOcupacionalCore(): Promise<void> {
    const f = this.formGroup3.value;
    const numeroDocumento = this.candidatoSeleccionado()?.numero_documento;

    // Helpers del loader
    const renderProgress = (pct: number, fase: string, sub: string = '') => `
      <div style="width:100%;margin-top:6px">
        <div style="height:10px;background:#eee;border-radius:6px;overflow:hidden">
          <div style="height:100%;width:${pct}%;transition:width .2s ease;background:#1976d2"></div>
        </div>
        <div style="margin-top:8px;font-size:12px;color:#555">${fase}${sub ? `<br><span style="font-size:11px;color:#777">${sub}</span>` : ''}</div>
      </div>
    `;
    const updateLoader = (pct: number, title: string, sub = '') =>
      Swal.update({ title, html: renderProgress(pct, title, sub) });

    // --- Datos para payload y NO APTO ---
    const cand = this.candidatoSeleccionado();
    const ent0 = cand?.entrevistas?.[0];
    const formContrato: FormGroup | undefined = (this as any).formContrato;
    const llenoUI = formContrato?.valid === true;

    const sedeAbbr = this.normalizarSedeAbbr?.(ent0?.oficina) ?? ent0?.oficina ?? '';

    type ExamenResultado = { aptoStatus?: string | boolean | null;[k: string]: any };
    const resultadosArr: ExamenResultado[] = Array.isArray(this.selectedExamsArray?.value) ? this.selectedExamsArray.value : (f?.selectedExamsArray || []);
    const norm = (x: any) => String(x ?? '').trim().toUpperCase().replace(/_/g, ' ').replace(/\s+/g, ' ');
    const hayNoApto = resultadosArr.some(r => typeof r?.aptoStatus === 'boolean' ? r.aptoStatus === false : norm(r?.aptoStatus) === 'NO APTO');

    const payload: any = {
      numero_documento: String(numeroDocumento),
      examen_medico: {
        ips: f?.ips ?? null,
        ips_lab: f?.ipsLab ?? null,
        examenes: JSON.stringify(f?.selectedExams ?? []),
        resultados: JSON.stringify(resultadosArr ?? []),
      },
    };

    if (hayNoApto) {
      payload.rechazado = true;
      payload.detalle = '901 examen';
    } else {
      // Guardar exámenes médicos SIEMPRE pide código: el backend es idempotente
      // (si el contrato ya tiene código lo devuelve tal cual, no renumera) y
      // resuelve la oficina solo si `sede_abbr` no llega. Antes se pedía solo
      // cuando el contrato estaba vacío, así que un candidato con "Pago y
      // Transporte" ya diligenciado se quedaba sin código.
      payload.contrato = { sede_abbr: sedeAbbr || undefined, generar_codigo: true };
      if (llenoUI && formContrato) {
        const det = { ...(formContrato.value || {}) };
        Object.keys(det).forEach(k => { const v = det[k]; if (v === '' || v === undefined) delete det[k]; });
        if (Object.keys(det).length > 0) payload.contrato_detalle = det;
      }
    }

    // Override "Modificar de todas formas": edición pura sobre persona con contrato
    // activo. El backend NO reinicia banderas ni abre proceso nuevo, y sella la
    // auditoría (nombre del usuario + fecha/hora del servidor).
    if (this.modificacionForzada()) {
      payload.modificacion_forzada = true;
      payload.modificado_por = this.usuarioActual();
    }

    // --- Preparar insumos de exámenes ---
    const selectedExams: string[] = (this.formGroup3.get('selectedExams')?.value || []) as string[];
    const files: File[] = this.examFiles() || [];
    const cedula = String(numeroDocumento);
    const TYPE_EXAM = 32;

    // Pares (nombre, archivo) válidos
    const pairs = selectedExams
      .map((name, i) => ({ name: name ?? `EXAMEN_${i + 1}`, file: files[i] }))
      .filter(p => !!p.file && this.isPdf(p.file));

    try {
      // Abrir loader
      Swal.fire({
        title: 'Preparando…',
        html: renderProgress(0, 'Preparando…'),
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => Swal.showLoading(),
      });
      await this.nextFrame();

      // 1) Guardar proceso (10%)
      updateLoader(10, 'Guardando salud ocupacional…');
      const resp = await firstValueFrom(this.registroProceso.updateProcesoByDocumento(payload, 'PATCH'));

      // Captura el sello de auditoría del override (fecha/hora del servidor).
      const procResp: any = (resp as any)?.proceso;
      if (this.modificacionForzada() && procResp) {
        this.overrideAuditNombre.set(procResp.modificado_por || this.usuarioActual());
        this.overrideAuditFecha.set(procResp.modificado_en || new Date().toISOString());
      }

      const codigo = (resp as any)?.proceso?.contrato_codigo as string | undefined;
      const okMsg = hayNoApto
        ? 'Examen médico guardado · Proceso RECHAZADO por NO APTO'
        : (codigo ? `Examen médico guardado · Contrato: ${codigo}` : 'Examen médico guardado');

      let resumenHtml = '';

      if (pairs.length) {
        // 2) Unir PDFs (15% → 85%)
        const mergedName = `EXAMENES_MEDICOS_${cedula}_${this.yyyymmdd()}.pdf`;
        updateLoader(15, 'Uniendo PDFs de exámenes…', `${pairs.length} archivo(s)`);

        const mergedFile = await this.mergeExamPdfs(pairs, mergedName, (i, total) => {
          const pct = 15 + Math.round((i / total) * 70);
          updateLoader(pct, `Uniendo PDFs de exámenes… (${i}/${total})`);
        });

        // 3) Subir PDF consolidado (85% → 100%)
        updateLoader(88, 'Subiendo PDF consolidado…', mergedName);
        // Pasar tipo_documento para que el backend prefije owner_id con "x"
        // cuando la persona no es CC (evita colisiones entre CC y non-CC).
        // El serializer expone `tipo_doc`; `tipo_documento`/`tipoDocumento` no
        // existen en la respuesta, asi que esto era SIEMPRE undefined y el
        // prefijo nunca se aplicaba, mientras `elegirDocDelTitular` si lo
        // esperaba: los documentos de un CE/PET no se reconocian como suyos.
        const tipoDoc = (this.candidatoSeleccionado()?.tipo_doc ?? undefined) as string | undefined;
        const obs = this.candidatoSeleccionado()?.codigo_contrato
          ? this.docSvc.guardarDocumento(mergedFile.name, cedula, TYPE_EXAM, mergedFile, this.candidatoSeleccionado()?.codigo_contrato, tipoDoc)
          : this.docSvc.guardarDocumento(mergedFile.name, cedula, TYPE_EXAM, mergedFile, undefined, tipoDoc);
        await firstValueFrom(obs);
        // Igual que la foto: releer con force para que "Ver examen médico" se
        // encienda ya (las recargas silenciosas no refrescan documentos).
        this.docSvc.invalidarDocumentos(cedula);
        await this.refreshDocsDelCandidato(cedula, true);
        updateLoader(100, 'Finalizando…');

        resumenHtml = `PDF consolidado subido: <b>${mergedName}</b>`;
      } else {
        updateLoader(100, 'Finalizando…');
        resumenHtml = 'No hay archivos PDF de exámenes para unir.';
      }

      Swal.close();
      await Swal.fire({
        icon: 'success',
        title: okMsg,
        html: resumenHtml,
        confirmButtonText: 'Ok',
      });
    } catch (err: unknown) {
      Swal.close();
      const http = err as any;
      const msg = http?.error?.detail || http?.message || 'No se pudo completar la operación.';
      await Swal.fire({ title: 'Error', text: msg, icon: 'error', confirmButtonText: 'OK' });
      console.error(err);
    }
  }

  // ========= Otros helpers/subidas =========
  subirArchivo(event: any | Blob, campo: string, fileName?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let file: File | undefined;
      if (event instanceof Blob) file = new File([event], fileName || 'archivo.pdf', { type: 'application/pdf' });
      else file = event?.target?.files?.[0];

      if (!file) return reject('No se recibió archivo');
      if (file.name.length > 100) {
        Swal.fire('Error', 'El nombre del archivo no debe exceder 100 caracteres', 'error');
        return reject('Nombre demasiado largo');
      }

      // uploadedFiles queda para otros documentos (no exámenes)
      this.uploadedFiles[campo] = { file, fileName: file.name };
      resolve();
    });
  }

  imprimirDocumentos(): void {
    Swal.fire({ title: 'Subiendo archivos...', icon: 'info', html: 'Por favor, espere…', allowOutsideClick: false, allowEscapeKey: false, didOpen: () => Swal.showLoading() });
  }

  onFileSelected(evt: any, index: number): void {
    const f: File | undefined = evt?.target?.files?.[0];
    const files = [...(this.examFiles() ?? [])];
    if (f && this.isPdf(f)) {
      files[index] = f;
      this.examFiles.set(files);
    } else {
      Swal.fire('Archivo inválido', 'Seleccione un PDF válido.', 'warning');
    }
  }

  /** Loading state del botón Guardar Salud Ocupacional. */
  isSavingMedical = signal(false);

  /** Devuelve el estado visual del examen i: 'apto' | 'no-apto' | 'pending'. */
  getExamStatus(i: number): 'apto' | 'no-apto' | 'pending' {
    const v = this.selectedExamsArray.at(i)?.get('aptoStatus')?.value;
    if (v === 'APTO') return 'apto';
    if (v === 'NO APTO') return 'no-apto';
    return 'pending';
  }

  /** Abre el PDF del examen i en una pestaña nueva (preview local). */
  viewExamPdf(i: number): void {
    const file = this.examFiles()?.[i];
    if (!file) return;
    const url = URL.createObjectURL(file);
    window.open(url, '_blank');
    // No revocamos inmediatamente para que el visor lo cargue
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  /** Quita el archivo del examen i (no afecta el control de aptoStatus). */
  removeExamFile(i: number): void {
    const files = [...(this.examFiles() ?? [])];
    files[i] = undefined as unknown as File;
    this.examFiles.set(files);
  }

  /** Formatea bytes a KB/MB legibles. */
  formatBytes(bytes?: number): string {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  // ───────── Tabla ─────────
  /**
   * Cerrar contratación del día: el cierre cubre a TODAS las personas
   * contratadas HOY. Navega al Reporte de Contratación con `auto=hoy`, que
   * descarga del sistema la base de contratados del día, la adjunta como
   * Cruce Diario y dispara la validación automáticamente — el usuario solo
   * agrega ARL/traslados si aplica, elige sede y envía. No depende del
   * candidato seleccionado en el pipeline.
   */
  irACerrarContratacion(): void {
    this.router.navigate(['/dashboard/hiring/hiring-report'], { queryParams: { auto: 'hoy' } });
  }

  mostrarTabla(): void {
    const ced = this.candidatoSeleccionado()?.numero_documento || this.numeroDocumento;
    if (!ced) return;

    Swal.fire({
      icon: 'info',
      title: 'Cargando registros…',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    });

    const cedPedida = String(ced);
    this.registroProceso.listProcesosMiniByDocumento(cedPedida).subscribe({
      next: (rows: any) => {
        Swal.close();

        // Si mientras respondía el servidor el operador cambió de persona, no
        // abrir el historial de la anterior con el nombre de la nueva.
        const cedActual = String(
          this.candidatoSeleccionado()?.numero_documento || this.numeroDocumento || ''
        );
        if (cedActual && cedActual !== cedPedida) return;

        const data = Array.isArray(rows) ? rows : (rows ? [rows] : []);

        // Regla de negocio: SOLO puede haber UN proceso CONTRATADO (el contrato
        // activo más reciente). Los datos llegan ordenados del más reciente al
        // más antiguo, así que el PRIMER contratado activo que se encuentra es
        // el vigente; cualquier otro contratado posterior en la lista (un
        // contrato anterior) se muestra como RETIRADO.
        let contratadoAsignado = false;

        const mappedData = data.map((row: any) => {
          const apl = String(row.aplica_o_no_aplica || '').toUpperCase();
          row._motivo = '';

          // Estado del flujo con semáforo. RETIRADO tiene prioridad si el contrato fue dado de baja.
          // CONTRATADO exige contrato REAL (contratado=true o fecha_ingreso): una fila de
          // contrato con solo el código reservado NO cuenta (misma regla que el header,
          // ver contrato.rules.ts) y cae al estado del flujo (prueba técnica, etc.).
          if (row.contrato_activo === false) {
            row._estado = 'RETIRADO';
            row._motivo = row.motivo_retiro || '';
          } else if (esContratoRealMini(row)) {
            if (!contratadoAsignado) {
              row._estado = 'CONTRATADO';
              contratadoAsignado = true;
            } else {
              // Ya hay un contratado vigente: este es un contrato anterior.
              row._estado = 'RETIRADO';
              row._motivo = row.motivo_retiro || '';
            }
          } else if (row.rechazado === true || apl === 'NO_APLICA' || apl === 'NO APLICA') {
            row._estado = '911';
            row._motivo = row.motivo_no_aplica || row.detalle || '';
          } else if (row.no_paso_prueba_tecnica === true) {
            row._estado = 'NO PASÓ PRUEBA';
            row._motivo = row.motivo_no_paso_prueba_tecnica || '';
          } else if (row.no_se_presento_prueba_tecnica === true) {
            row._estado = 'NO SE PRESENTÓ';
            row._motivo = row.motivo_no_se_presento_prueba_tecnica || '';
          } else if (row.paso_prueba_tecnica === true) {
            row._estado = 'PASÓ PRUEBA';
          } else if (row.prueba_tecnica === true) {
            row._estado = 'PRUEBA TÉCNICA';
          } else if (apl === 'EN_ESPERA') {
            row._estado = 'ESPERA VACANTE';
            row._motivo = row.motivo_espera || '';
          } else if (apl === 'APLICA') {
            row._estado = 'EN PROGRESO';
          } else {
            row._estado = '';
          }

          // Fecha de la ENTREVISTA: cuándo se entrevistó realmente (entrevistado_at),
          // no cuándo se creó el turno. Si el turno se creó anoche pero la entrevista
          // se hizo hoy, debe verse HOY. Cae a created_at para procesos antiguos.
          row._fecha_entrevista = row.entrevistado_at || row.entrevista_created_at || null;

          // Fecha de ingreso
          row._ingreso_date = row.contrato_fecha_ingreso || row.ingreso_at || null;

          // Resultado de la prueba técnica en su PROPIA columna, independiente del
          // estado: así se ve el resultado aunque el estado sea RETIRADO/CONTRATADO.
          row._prueba = row.no_paso_prueba_tecnica === true
            ? 'NO PASÓ'
            : row.no_se_presento_prueba_tecnica === true
              ? 'NO SE PRESENTÓ'
              : row.paso_prueba_tecnica === true ? 'PASÓ' : '';

          // Resultado del EXAMEN MÉDICO en su propia columna, igual que el de la
          // prueba: se ve aunque el estado sea CONTRATADO o RETIRADO.
          row._examen = row.no_paso_examen_medico === true
            ? 'NO PASÓ'
            : row.no_se_presento_examen_medico === true
              ? 'NO SE PRESENTÓ'
              : row.paso_examen_medico === true ? 'PASÓ' : '';

          row._fecha_resultado_examen =
            row.no_paso_examen_medico_at || row.no_se_presento_examen_medico_at
            || row.paso_examen_medico_at || null;

          // Fecha de la prueba PROGRAMADA en la publicación (vacante). Se muestra para
          // los procesos de prueba técnica, tengan o no resultado aún.
          row._fecha_prueba_publicacion = row.vacante_fecha_prueba || null;

          // Cuándo se REGISTRÓ el resultado de la prueba (pasó / no pasó / no se
          // presentó). Solo existe cuando ya hay resultado.
          row._fecha_resultado_prueba =
            row.no_paso_prueba_tecnica_at || row.no_se_presento_prueba_tecnica_at
            || row.paso_prueba_tecnica_at || null;

          // Motivo COMBINADO: el del estado (retiro / no aplica / espera) MÁS el de la
          // prueba técnica cuando existen los dos, para que ninguno se pierda. Si el
          // estado ya es "NO PASÓ PRUEBA", _motivo ya es el de la prueba: no se duplica.
          const motivoPrueba = row.no_paso_prueba_tecnica === true
            ? (row.motivo_no_paso_prueba_tecnica || '')
            : row.no_se_presento_prueba_tecnica === true
              ? (row.motivo_no_se_presento_prueba_tecnica || '')
              : '';
          if (motivoPrueba) {
            row._motivo = (row._motivo && row._motivo !== motivoPrueba)
              ? `${row._motivo} · Prueba técnica: ${motivoPrueba}`
              : motivoPrueba;
          }

          // Igual con el motivo del examen médico: se suma sin pisar lo anterior.
          const motivoExamen = row.no_paso_examen_medico === true
            ? (row.motivo_no_paso_examen_medico || '')
            : row.no_se_presento_examen_medico === true
              ? (row.motivo_no_se_presento_examen_medico || '')
              : '';
          if (motivoExamen) {
            row._motivo = row._motivo
              ? `${row._motivo} · Examen médico: ${motivoExamen}`
              : `Examen médico: ${motivoExamen}`;
          }

          return row;
        });

        const columns: ColumnDefinition[] = [
          // Orden solicitado: Oficina, Entrevista, Estado, Empresa, Finca, Fecha prueba,
          // Resultado prueba, Fecha resultado de la prueba, Motivo, Ingreso, Retiro.
          { name: 'oficina', header: 'Oficina', type: 'text', width: '90px' },
          { name: '_fecha_entrevista', header: 'Entrevista', type: 'date', width: '100px' },
          {
            name: '_estado', header: 'Estado', type: 'status', width: '120px',
            statusConfig: {
              'CONTRATADO':       { color: '#fff', background: '#2E7D32' },
              'RETIRADO':         { color: '#fff', background: '#78909C' },
              '911':              { color: '#fff', background: '#C62828' },
              'PRUEBA TÉCNICA':   { color: '#fff', background: '#1565C0' },
              'PASÓ PRUEBA':      { color: '#fff', background: '#2E7D32' },
              'NO PASÓ PRUEBA':   { color: '#fff', background: '#C62828' },
              'NO SE PRESENTÓ':   { color: '#fff', background: '#EF6C00' },
              'ESPERA VACANTE':   { color: '#000', background: '#FFD54F' },
              'EN PROGRESO':      { color: '#fff', background: '#00897B' },
            }
          },
          { name: 'empresaUsuariaSolicita', header: 'Empresa', type: 'text', width: '130px' },
          { name: 'finca', header: 'Finca', type: 'text', width: '110px' },
          {
            name: '_fecha_prueba_publicacion', header: 'Fecha prueba',
            type: 'date', dateFormat: 'dd/MM/yyyy', width: '110px',
          },
          {
            name: '_prueba', header: 'Resultado prueba', type: 'status', width: '130px',
            statusConfig: {
              'PASÓ':           { color: '#fff', background: '#2E7D32' },
              'NO PASÓ':        { color: '#fff', background: '#C62828' },
              'NO SE PRESENTÓ': { color: '#fff', background: '#EF6C00' },
            }
          },
          {
            name: '_fecha_resultado_prueba', header: 'Fecha resultado de la prueba',
            type: 'date', dateFormat: 'dd/MM/yyyy HH:mm', width: '160px',
          },
          {
            name: '_examen', header: 'Resultado examen', type: 'status', width: '130px',
            statusConfig: {
              'PASÓ':           { color: '#fff', background: '#2E7D32' },
              'NO PASÓ':        { color: '#fff', background: '#C62828' },
              'NO SE PRESENTÓ': { color: '#fff', background: '#EF6C00' },
            }
          },
          {
            name: '_fecha_resultado_examen', header: 'Fecha resultado del examen',
            type: 'date', dateFormat: 'dd/MM/yyyy HH:mm', width: '160px',
          },
          { name: '_motivo', header: 'Motivo', type: 'text', width: '160px' },
          { name: '_ingreso_date', header: 'Ingreso', type: 'date', width: '95px' },
          { name: 'fecha_retiro', header: 'Retiro', type: 'date', width: '95px' },
        ];

        const ref = this.dialog.open(TableDialogComponent, {
          maxWidth: '95vw',
          height: '92vh',
          maxHeight: '95vh',
          data: {
            title: `Historial laboral de ${this.nombreCandidato || ced}`,
            rows: mappedData,
            columns,
            pageSize: 12,
            pageSizeOptions: [12, 24, 36],
            tableTitle: 'Historial laboral',
            // Borrado por fila: cada registro es una entrevista/proceso.
            eliminarTooltip: 'Eliminar este proceso (entrevista, contrato y antecedentes). NO borra el candidato ni su formulario.',
            onEliminar: (row: any) => this.eliminarProcesoDelHistorial(row),
          },
          panelClass: 'table-dialog',
        });

        // Si se borró algún proceso, el candidato abierto pudo quedarse sin
        // entrevista o con otra distinta: se recarga para no mostrar datos
        // de algo que ya no existe.
        ref.afterClosed().subscribe(huboBorrados => {
          if (huboBorrados && this.candidatoSeleccionado()?.numero_documento) {
            this.recargarCandidato();
          }
        });
      },
      error: (err) => {
        Swal.close();
        console.error(err);
        Swal.fire('Error', 'No fue posible cargar la tabla.', 'error');
      },
    });
  }

  // ───────── Cámara ─────────
  async openCamera(): Promise<void> {
    const initialPreview = this.fotoDataUrl() || this.fotoDoc()?.file_url || this.getBioUrl('foto') || null;

    const ref = this.dialog.open<
      CameraDialogComponent,
      { initialPreviewUrl?: string | null },
      { file: File; previewUrl: string } | undefined
    >(CameraDialogComponent, {
      width: '720px',
      maxWidth: '95vw',
      disableClose: true,
      data: { initialPreviewUrl: initialPreview },
    });

    const result = await firstValueFrom(ref.afterClosed());
    if (!result) return;

    const numero = this.candidatoSeleccionado()?.numero_documento || this.numeroDocumento;
    if (!numero) {
      await Swal.fire('Información', 'Selecciona un candidato antes de tomar la foto.', 'info');
      return;
    }

    // Se crea una URL PROPIA a partir del archivo. La `result.previewUrl` que
    // devuelve el diálogo ya no sirve: el diálogo la revoca al cerrarse.
    this.mostrarPreviewFoto(result.file);

    try {
      Swal.fire({ title: 'Subiendo foto...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
      await this.uploadFotoWithRetry(String(numero), result.file);
      Swal.close();
      await Swal.fire('Éxito', 'Foto subida correctamente', 'success');
      await this.refreshBiometriaForCandidate(String(numero));
      // La foto entró por otro servicio: invalidar el expediente cacheado y
      // releer con force para que el doc 89 traiga la versión recién subida.
      this.docSvc.invalidarDocumentos(String(numero));
      this.fotoUrlFallida.set(null); // la URL nueva merece su propio intento
      await this.refreshDocsDelCandidato(String(numero), true);
    } catch (err: any) {
      Swal.close();
      // Se muestra en lenguaje natural; el detalle técnico va a la consola.
      await Swal.fire('No se pudo subir la foto', mensajeDeErrorLog('pipeline/foto', err,
        'No se pudo subir la foto. Intenta de nuevo.'), 'error');
    }
  }

  // ── Robustez: retry con backoff para uploads de biometría ──
  private readonly UPLOAD_RETRY_STATUS = new Set<number>([0, 408, 425, 429, 500, 502, 503, 504]);

  private uploadFotoWithRetry(numero: string, file: File, attempts = 3): Promise<any> {
    return new Promise((resolve, reject) => {
      let tryNumber = 0;
      const run = () => {
        tryNumber++;
        this.registroProceso.uploadFoto(numero, file).subscribe({
          next: (res: any) => resolve(res),
          error: (err: any) => {
            const code = err?.status ?? 0;
            const retryable = this.UPLOAD_RETRY_STATUS.has(code);
            if (retryable && tryNumber < attempts) {
              const delay = 800 * Math.pow(2, tryNumber - 1);
              setTimeout(run, delay);
            } else {
              reject(err);
            }
          },
        });
      };
      run();
    });
  }

  // ───────── Ver archivos con una sola función ─────────
  ver(kind: BioKind): void {
    const label = kind === 'huella' ? 'Huella' : kind === 'firma' ? 'Firma' : 'Foto';
    const local = this.bioLocal(kind);
    if (local) { this.showBase64(label, local); return; }

    const url = this.getBioUrl(kind);
    if (!url) {
      this.snack.open(`No hay ${label.toLowerCase()} disponible.`, 'OK', { duration: 2500 });
      return;
    }
    this.openInNewTab(url);
  }

  verHuella(): void { this.ver('huella'); }
  verFirma(): void { this.ver('firma'); }
  verFoto(): void {
    if (this.fotoDoc()) {
      this.openInNewTab(this.fotoDoc()!.file_url);
      return;
    }
    this.ver('foto');
  }

  verExamenMedico(): void {
    const doc = this.examenMedicoDoc();
    if (!doc || !doc.file_url) {
      this.snack.open('No hay examen médico disponible.', 'OK', { duration: 2500 });
      return;
    }
    this.openInNewTab(doc.file_url);
  }

  verArl(): void {
    const doc = this.arlDoc();
    if (!doc || !doc.file_url) {
      this.snack.open('No hay ARL disponible.', 'OK', { duration: 2500 });
      return;
    }
    this.openInNewTab(doc.file_url);
  }

  // Helpers
  private bioLocal(kind: BioKind): string | null {
    switch (kind) {
      case 'foto': return this.fotoDataUrl();
      case 'huella': return this.huellaDataUrl();
      case 'firma': return this.firmaDataUrl();
    }
  }

  private pedidoFotoAtendido = 0;
  private pedidoCorreoAtendido = 0;
  private pedidoWhatsappAtendido = 0;

  /** Envoltorios públicos: los originales son privados y el effect los usa. */
  private bioLocalPub(kind: BioKind): string | null { return this.bioLocal(kind); }
  private getBioUrlPub(kind: BioKind): string | null { return this.getBioUrl(kind); }

  private openInNewTab(url: string) {
    // URLs http(s) → navegador del SO; data: / blob: → visor seguro.
    if (/^data:application\/pdf/i.test(url)) {
      this.electronWindow.openPdfFromBase64(url);
      return;
    }
    this.electronWindow.openExternal(url);
  }

  private normalizeDataUrl(raw: string | null | undefined, defaultMime = 'image/png'): string | null {
    if (!raw) return null;
    const s = String(raw).trim();
    if (!s) return null;
    if (s.startsWith('data:')) return s;

    if (/^JVBERi0/.test(s)) return `data:application/pdf;base64,${s}`;
    if (/^iVBOR/.test(s)) return `data:image/png;base64,${s}`;
    if (/^\/9j\//.test(s)) return `data:image/jpeg;base64,${s}`;

    return `data:${defaultMime};base64,${s}`;
  }

  private isPdfDataUrl(url: string): boolean {
    return url.startsWith('data:application/pdf');
  }

  private async showBase64(title: string, dataUrl: string, alt = title) {
    if (!dataUrl) {
      this.snack.open(`No hay ${title.toLowerCase()} disponible.`, 'OK', { duration: 2500 });
      return;
    }

    if (this.isPdfDataUrl(dataUrl)) {
      this.electronWindow.openPdfFromBase64(dataUrl, { title });
      return;
    }

    // Imágenes base64: se muestran directamente en el modal (el SwAL ya las
    // renderiza con scaling). El visor PDF-in-window no aplica a imágenes.
    await Swal.fire({
      title,
      html: `<img src="${dataUrl}" alt="${alt}" style="max-width:100%;height:auto;border-radius:8px;" />`,
      width: '48rem',
      heightAuto: false,
      showCloseButton: true,
      showConfirmButton: false,
    });
  }

  private fileToDataURL(file: File): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  private dataUrlToFile(dataUrl: string, filename: string): File {
    const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
    if (!m) throw new Error('DataURL inválido');
    const mime = m[1] || 'application/octet-stream';
    const base64 = m[2];
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return new File([bytes.buffer], filename, { type: mime });
  }

  private recalcHayNoApto(): void {
    const arr = (this.selectedExamsArray.value ?? []) as ExamenResultadoForm[];
    this.hayNoApto.set(Array.isArray(arr) && arr.some(x => this.isNoApto(x?.aptoStatus)));
  }

  private async refreshBiometriaForCandidate(cedula: string): Promise<void> {
    try {
      const data: any = await firstValueFrom(this.registroProceso.getBiometriaPorCedula(cedula));
      // Igual que en refreshDocsDelCandidato: una respuesta tardía del
      // candidato anterior no debe poner su firma/huella sobre el actual.
      if (cedula !== this.cedulaAtendida) return;
      this.biometria.set({
        firma: Array.isArray(data?.firma) ? data.firma[0] : data?.firma ?? null,
        huella: Array.isArray(data?.huella) ? data.huella[0] : data?.huella ?? null,
        foto: Array.isArray(data?.foto) ? data.foto[0] : data?.foto ?? null,
        created_at: data?.created_at,
        updated_at: data?.updated_at,
      });
    } catch {
      if (cedula !== this.cedulaAtendida) return;
      this.biometria.set(null);
    }
  }

  /**
   * Elige el documento QUE ES DEL TITULAR, no el primero de la lista.
   *
   * El backend guarda `owner_id = "<cedula>"` para CC y `"x<cedula>"` para
   * cualquier otro tipo, justamente para no mezclar a dos titulares que
   * comparten número. Pero la lectura expande las tres formas
   * (`<ced>`, `x<ced>`, `X<ced>`), así que `getDocuments(cedula)` puede
   * devolver documentos de AMBAS personas. Quedarse con `docs[0]` a ciegas
   * mostraba el examen médico, la ARL o la FOTO del otro titular.
   *
   * Si ningún documento trae `owner_id` (payload viejo) se conserva el
   * comportamiento anterior: es preferible mostrar algo a romper la pantalla.
   */
  private elegirDocDelTitular(docs: ServerDocInfo[], cedula: string): ServerDocInfo | null {
    if (!Array.isArray(docs) || docs.length === 0) return null;

    const ced = String(cedula || '').trim().replace(/^[xX]/, '');
    // Solo letras antes de comparar: en BD conviven 'CC', 'C.C' y 'C.C.' para
    // la misma persona, y con comparacion cruda un 'C.C' se tomaba por
    // extranjero y se le buscaban los documentos con prefijo "x".
    const esperado = String(this.candidatoSeleccionado()?.tipo_doc || 'CC')
      .toUpperCase().replace(/[^A-Z]/g, '') === 'CC' ? ced : `x${ced}`;

    const conOwner = docs.filter(d => (d as any)?.owner_id != null);
    if (conOwner.length === 0) return docs[0];

    const propios = conOwner.filter(
      d => String((d as any).owner_id).trim().toLowerCase() === esperado.toLowerCase()
    );
    return propios[0] ?? null;
  }

  /**
   * Examen médico (32), ARL (30) y FOTO (89) en UNA petición compartida.
   *
   * Antes eran tres GET al mismo endpoint variando solo `type`; ahora se pide
   * el expediente completo (cacheado por cédula en el servicio, así la lectura
   * de selection-questions comparte la misma respuesta) y se filtra en local.
   * La regla del titular se mantiene por tipo: la FOTO sigue siendo el caso más
   * delicado del trío, mostrar la de otro titular es una confusión de identidad.
   *
   * `force` salta el caché (tras subir una foto nueva, por ejemplo).
   */
  private async refreshDocsDelCandidato(cedula: string, force = false): Promise<void> {
    try {
      const docs: ServerDocInfo[] = await firstValueFrom(
        this.docSvc.getDocumentosDeCandidato(cedula, { force })
      );
      // La respuesta pudo demorar y el operador ya cambió de persona: escribir
      // acá pondría el examen, la ARL y la FOTO de otra cédula en pantalla.
      if (cedula !== this.cedulaAtendida) return;
      const delTipo = (t: number) =>
        this.elegirDocDelTitular(docs.filter((d: any) => Number(d?.type) === t), cedula);
      this.examenMedicoDoc.set(delTipo(32));
      this.arlDoc.set(delTipo(30));
      this.fotoDoc.set(delTipo(89));
    } catch {
      // El fallo de una consulta vieja tampoco debe borrar lo del candidato actual.
      if (cedula !== this.cedulaAtendida) return;
      this.examenMedicoDoc.set(null);
      this.arlDoc.set(null);
      this.fotoDoc.set(null);
    }
  }

  private setBiometriaFromCandidate(cand: any): void {
    const b = cand?.biometria ?? null;
    if (!b) { this.biometria.set(null); return; }
    this.biometria.set({
      firma: Array.isArray(b.firma) ? b.firma[0] : b.firma ?? null,
      huella: Array.isArray(b.huella) ? b.huella[0] : b.huella ?? null,
      foto: Array.isArray(b.foto) ? b.foto[0] : b.foto ?? null,
      created_at: b.created_at,
      updated_at: b.updated_at,
    });
  }

  private isBioStale(b: any, maxMin = 3): boolean {
    const ts = b?.updated_at || b?.created_at;
    if (!ts) return false;
    const t = Date.parse(String(ts));
    if (Number.isNaN(t)) return false;
    const ageMin = (Date.now() - t) / 60000;
    return ageMin > maxMin;
  }

  private getBioDoc(kind: BioKind): any | null {
    const bio = this.biometria();
    const raw = (bio as any)?.[kind];
    if (!raw) return null;
    return Array.isArray(raw) ? (raw[0] ?? null) : raw;
  }

  private getBioUrl(kind: BioKind): string | null {
    const doc = this.getBioDoc(kind);
    if (!doc) return null;
    return doc.file_url || doc.file || null;
  }

  // =========================================================
  // ✅ GENERAR CARNET INDIVIDUAL (Recruitment Pipeline)
  // =========================================================
  async generarCarnetIndividual(): Promise<void> {
    const cand = this.candidatoSeleccionado();
    if (!cand) {
      await Swal.fire({ icon: 'warning', title: 'Aviso', text: 'No hay candidato seleccionado.' });
      return;
    }

    // El contrato puede vivir en una entrevista ANTERIOR (entrevistas[0] puede
    // ser un turno nuevo sin proceso — caso CC 1097727446, ver contrato.rules).
    // Leer entrevistas[0] a secas decía "sin código de contrato" a personas
    // contratadas y ofrecía re-generar carnets que ya existían.
    const proc0 = procesoDelContrato(cand) ?? procesoVigente(cand);
    const contratoBE = proc0?.contrato;

    const carnetGenerado = contratoBE?.carnet_generado === true;

    if (carnetGenerado) {
      const result = await Swal.fire({
        title: 'Carnet ya generado',
        text: 'Este candidato ya tiene un carnet generado previamente. ¿Qué deseas hacer?',
        icon: 'question',
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: 'Visualizar',
        denyButtonText: 'Volver a generar',
        cancelButtonText: 'Cancelar'
      });

      if (result.isConfirmed) {
        // VISUALIZAR
        try {
          Swal.fire({ title: 'Buscando carnet...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
          const cedulaQuery = String(cand.numero_documento ?? '').trim();
          const docsResp = await firstValueFrom(this.docSvc.getDocuments(cedulaQuery, 102));
          const docs = Array.isArray(docsResp) ? docsResp : (docsResp?.results || []);
          // Misma regla del titular que examen/ARL/foto: el GET expande
          // <ced>/x<ced> y puede traer el carnet del OTRO titular (CC vs CE).
          const carnetDoc = this.elegirDocDelTitular(
            docs.filter((d: any) => Number(d?.type) === 102), cedulaQuery,
          );

          Swal.close();
          if (carnetDoc && carnetDoc.file_url) {
            window.open(carnetDoc.file_url, '_blank');
          } else {
            await Swal.fire({ icon: 'warning', title: 'No encontrado', text: 'No se encontró el archivo del carnet en el servidor.' });
          }
        } catch (e) {
          Swal.close();
          console.error(e);
          await Swal.fire({ icon: 'error', title: 'Error', text: 'Ocurrió un error al buscar el carnet.' });
        }
        return;
      } else if (result.isDenied) {
        // Continua con la generacion
      } else {
        return; // Cancelar
      }
    }

    const cedula = String(cand.numero_documento ?? '').trim();
    // El "Con." del carnet ES el código de contrato, que asigna el backend por
    // rango de oficina. `carnet_codigo` queda como respaldo de los carnets
    // viejos, de cuando ese número se escribía a mano.
    let codigo = String(
      contratoBE?.codigo_contrato || proc0?.contrato_codigo || contratoBE?.carnet_codigo || ''
    ).trim();
    let centroCosto = String(contratoBE?.carnet_centro_costo || contratoBE?.Ccentro_de_costos || '').trim();
    // Solo `fecha_ingreso`: es un DateField, así que llega en ISO y el
    // <input type="date"> de abajo lo precarga bien. `carnet_fecha_ingreso` es
    // texto libre; si venía en DD/MM/YYYY el input salía VACÍO, y encima hacía
    // que el carnet llevara distinta fecha según desde dónde se generara.
    let fechaIng = String(contratoBE?.fecha_ingreso || '').trim();

    // Consultar HomeService para obtener exactamente los mismos campos que la vista de Home
    let cMini: any = {};
    if (cedula) {
      try {
        const resp = await firstValueFrom(this.homeService.getCandidatosMini([cedula]));
        const items = Array.isArray(resp) ? resp : ((resp as any)?.ITEMS ?? (resp as any)?.items ?? []);
        if (items.length > 0) cMini = items[0];
      } catch (e) {
        console.warn('No se pudo obtener el candidato mini para el carnet', e);
      }
    }

    // CARNET_CODIGO solo se usa si el contrato aún no tiene código: el código
    // de contrato manda sobre el valor histórico que traiga Home.
    if (!codigo && cMini?.CARNET_CODIGO) codigo = String(cMini.CARNET_CODIGO).trim();
    // "Centro de costo carnet" del contrato manda: es el campo que se diligencia
    // en Pago y Transporte para este carnet en concreto.
    if (!centroCosto && cMini?.CARNET_CENTRO_COSTO) centroCosto = String(cMini.CARNET_CENTRO_COSTO).trim();
    // Si el contrato no trae fecha, se cae a la de Home, que es ESA MISMA
    // `contrato.fecha_ingreso` pero ya formateada DD/MM/YYYY por el backend; hay
    // que voltearla a ISO porque el <input type="date"> no acepta otra cosa.
    if (!fechaIng) {
      const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(cMini?.FECHA_INGRESO ?? '').trim());
      if (m) fechaIng = `${m[3]}-${m[2]}-${m[1]}`;
    }

    // Replicando la lógica exacta ("pickAny") que usa el Home component
    const pickAny = (obj: any, keys: string[]) => {
      for (const k of keys) {
        const v = obj?.[k];
        if (v !== undefined && v !== null && String(v).trim() !== '') return v;
      }
      return '';
    };

    const searchIn = [cMini, cand]; // Buscar primero en cMini (el de Home), luego en cand (el del Pipeline)

    let familiarNombre = '';
    let familiarTel = '';

    for (const data of searchIn) {
      if (!data) continue;

      if (!familiarNombre) {
        familiarNombre = String(
          pickAny(data?.contacto_emergencia, ['NOMBRES', 'nombres', 'NOMBRE_CONTACTO', 'nombre_contacto', 'NOMBRE', 'nombre']) ||
          pickAny(data?.contacto, ['NOMBRE_CONTACTO', 'nombre_contacto', 'NOMBRES', 'nombres', 'NOMBRE', 'nombre']) ||
          pickAny(data, [
            'FAMILIAR_EMERGENCIA', 'familiar_emergencia',
            'FAMILIAR_EMERGENCIA_NOMBRE', 'familiar_emergencia_nombre',
            'CONTACTO_EMERGENCIA_NOMBRE', 'contacto_emergencia_nombre',
            'NOMBRE_CONTACTO_EMERGENCIA', 'nombre_contacto_emergencia'
          ]) || pickAny(data?.datos_basicos, [
            'FAMILIAR_EMERGENCIA', 'familiar_emergencia',
            'FAMILIAR_EMERGENCIA_NOMBRE', 'familiar_emergencia_nombre',
            'CONTACTO_EMERGENCIA_NOMBRE', 'contacto_emergencia_nombre',
            'NOMBRE_CONTACTO_EMERGENCIA', 'nombre_contacto_emergencia'
          ])
        ).trim();
      }

      if (!familiarTel) {
        familiarTel = String(
          pickAny(data?.contacto_emergencia, ['TELEFONO', 'telefono', 'CELULAR', 'celular', 'CELULAR_CONTACTO', 'celular_contacto']) ||
          pickAny(data?.contacto, ['CELULAR_CONTACTO', 'celular_contacto', 'TELEFONO', 'telefono', 'CELULAR', 'celular']) ||
          pickAny(data, [
            'FAMILIAR_EMERGENCIA_TELEFONO', 'familiar_emergencia_telefono',
            'TELEFONO_FAMILIAR_EMERGENCIA', 'telefono_familiar_emergencia',
            'CONTACTO_EMERGENCIA_TELEFONO', 'contacto_emergencia_telefono',
            'TELEFONO_CONTACTO_EMERGENCIA', 'telefono_contacto_emergencia'
          ]) || pickAny(data?.datos_basicos, [
            'FAMILIAR_EMERGENCIA_TELEFONO', 'familiar_emergencia_telefono',
            'TELEFONO_FAMILIAR_EMERGENCIA', 'telefono_familiar_emergencia',
            'CONTACTO_EMERGENCIA_TELEFONO', 'contacto_emergencia_telefono',
            'TELEFONO_CONTACTO_EMERGENCIA', 'telefono_contacto_emergencia'
          ])
        ).trim();
      }
    }

    console.log('--- ENCONTRADOS PARA CARNET INDIVIDUAL ---');
    console.log('cMini:', cMini);
    console.log('cand:', cand);
    console.log('Familiar Nombre:', familiarNombre);
    console.log('Familiar Tel:', familiarTel);

    // El código ya no se escribe: es el de contrato, asignado por el backend.
    if (!codigo) {
      await Swal.fire({
        icon: 'info',
        title: 'Sin código de contrato',
        text: 'El carnet usa el código de contrato como consecutivo y este candidato todavía no lo tiene. '
          + 'Guarda "Exámenes médicos" o "Pago y Transporte" para generarlo y vuelve a intentar.',
      });
      return;
    }

    const { value: formValues, isConfirmed } = await Swal.fire({
      title: 'Datos del Carnet',
      html: `
        <label style="display:block;text-align:left;font-size:14px;margin-bottom:4px;font-weight:bold;">Fecha de Ingreso</label>
        <input id="swal-fecha" class="swal2-input" style="max-width:90%;margin:0 auto 16px;display:block;" type="date" value="${fechaIng}">

        <label style="display:block;text-align:left;font-size:14px;margin-bottom:4px;font-weight:bold;">Código de Contrato</label>
        <input id="swal-codigo" class="swal2-input" style="max-width:90%;margin:0 auto 4px;display:block;background:#f1f5f9;color:#475569;" type="text" value="${codigo}" readonly>
        <small style="display:block;text-align:left;color:#64748b;margin:0 auto 16px;max-width:90%;">Lo asigna el sistema; no se edita.</small>

        <label style="display:block;text-align:left;font-size:14px;margin-bottom:4px;font-weight:bold;">Centro de Costo</label>
        <input id="swal-ccosto" class="swal2-input" style="max-width:90%;margin:0 auto 16px;display:block;" type="text" value="${centroCosto}">
      `,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Generar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const f = (document.getElementById('swal-fecha') as HTMLInputElement).value;
        const cc = (document.getElementById('swal-ccosto') as HTMLInputElement).value;
        if (!f || !cc) {
          Swal.showValidationMessage('La fecha de ingreso y el centro de costo son obligatorios');
          return false;
        }
        return { fecha: f, codigo, ccosto: cc };
      }
    });

    if (!isConfirmed || !formValues) return;

    // Build the "row"
    const row = {
      CEDULA: cedula,
      CODIGO: String(formValues.codigo).trim(),
      APELLIDOS: String((cand.primer_apellido ?? '') + ' ' + (cand.segundo_apellido ?? '')).trim(),
      NOMBRES: String((cand.primer_nombre ?? '') + ' ' + (cand.segundo_nombre ?? '')).trim(),
      FECHA_INGRESO: String(formValues.fecha).trim(),
      CENTRO_COSTO: String(formValues.ccosto).trim(),
      FAMILIAR_EMERGENCIA_NOMBRE: familiarNombre,
      FAMILIAR_EMERGENCIA_TELEFONO: familiarTel,
      DOCUMENTO_89_URL: String(this.fotoDoc()?.file_url ?? '').trim()
    };

    if (!Swal.isVisible()) {
      Swal.fire({
        title: 'Generando carnet...',
        text: 'Preparando PDF...',
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => Swal.showLoading(),
      });
    }

    try {
      const CARD_W = 280;
      const CARD_H = 440;
      const PAGE_W = CARD_W;
      const PAGE_H = CARD_H;
      const MARGIN = 0;
      const GAP = 0;

      const BLUE_CORP = '#1B4FD9';
      const BLUE_DARK = '#152C70';
      const GREEN_BG = '#9BE114';
      const WHITE = '#FFFFFF';
      const BLACK = '#000000';

      const isHttp = (u: string) => /^https?:\/\//i.test(u);
      const isDataUrl = (u: string) => /^data:image\//i.test(u);

      const fetchBase64WithFallback = async (mainUrl: string, alts: string[] = [], isPhoto = false): Promise<string | null> => {
        const tryFetch = async (u: string) => {
          try {
            const res = await fetch(u);
            if (res.ok) {
              const domUrl = URL.createObjectURL(await res.blob());
              
              if (u.toLowerCase().endsWith('.svg')) {
                let text = await (await fetch(u)).text();
                if (!text.includes('xmlns=')) text = text.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
                
                const svg64 = btoa(unescape(encodeURIComponent(text)));
                const svgDataUrl = `data:image/svg+xml;base64,${svg64}`;
                
                const img = new Image();
                img.crossOrigin = 'Anonymous';
                await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = svgDataUrl; });
                
                const canvas = document.createElement('canvas');
                const w = img.width || 156;
                const h = img.height || 35;
                canvas.width = w * 4;
                canvas.height = h * 4;
                const ctx = canvas.getContext('2d');
                ctx?.scale(4, 4);
                ctx?.drawImage(img, 0, 0, w, h);
                URL.revokeObjectURL(domUrl);
                return canvas.toDataURL('image/png');
              } else {
                const img = new Image();
                img.crossOrigin = 'Anonymous';
                await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = domUrl; });
                
                const canvas = document.createElement('canvas');
                
                if (isPhoto) {
                  // Para fotos: Recortar al centro (sin distorsión) y hacerla circular con un fondo igual al PDF
                  const size = Math.min(img.width, img.height);
                  canvas.width = size;
                  canvas.height = size;
                  const ctx = canvas.getContext('2d');
                  if (ctx) {
                    ctx.fillStyle = GREEN_BG; // Fondo idéntico al PDF para fusíon perfecta
                    ctx.fillRect(0, 0, size, size);
                    
                    ctx.beginPath();
                    ctx.arc(size/2, size/2, size/2, 0, Math.PI * 2);
                    ctx.clip();
                    
                    ctx.fillStyle = WHITE;
                    ctx.fillRect(0, 0, size, size);
                    
                    const offsetX = (img.width - size) / 2;
                    const offsetY = img.height > img.width ? (img.height - size) * 0.15 : (img.height - size) / 2;
                    ctx.drawImage(img, offsetX, offsetY, size, size, 0, 0, size, size);
                  }
                } else {
                  // Para otras imágenes (ej. QR)
                  canvas.width = img.width;
                  canvas.height = img.height;
                  const ctx = canvas.getContext('2d');
                  if (ctx) {
                    ctx.fillStyle = WHITE;
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0);
                  }
                }
                
                URL.revokeObjectURL(domUrl);
                return canvas.toDataURL('image/jpeg', 0.95);
              }
            }
          } catch { }
          return null;
        };
        let b64 = await tryFetch(mainUrl);
        if (b64) return b64;
        for (const alt of alts) {
          b64 = await tryFetch(alt);
          if (b64) return b64;
        }
        return null;
      };

      const fetchImageBase64 = async (urlOrData?: string, isPhoto = false): Promise<string | null> => {
        const raw = String(urlOrData ?? '').trim();
        if (!raw) return null;
        if (isDataUrl(raw)) return raw;
        const clean = raw.replace(/^\/+/, '').replace(/^assets\//, '');
        if (isHttp(raw)) return await fetchBase64WithFallback(raw, [], isPhoto);
        return await fetchBase64WithFallback(clean, [`assets/${clean}`, `/${clean}`, `./${clean}`], isPhoto);
      };

      const buildQrDataUrl = async (payload: string): Promise<string> => {
        const key = String(payload ?? '').trim();
        if (!key) return '';
        try {
          return await (QRCode as any).toDataURL(key, { type: 'image/jpeg', errorCorrectionLevel: 'M', margin: 1, width: 300, color: { light: '#ffffffff' } });
        } catch { return ''; }
      };

      const safeTxt = (txt: any) => {
        let s = String(txt ?? '').trim().toUpperCase();
        s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return s.replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ');
      };
      const safeTxtMixed = (txt: any) => {
        let s = String(txt ?? '').trim();
        s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return s.replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ');
      }

      const logoB64 = await fetchImageBase64('logos/Group.svg');
      const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: [PAGE_W, PAGE_H], compress: true });

      const fotoUrl = row.DOCUMENTO_89_URL;
      const qrKey = `${row.CEDULA}|${row.CODIGO}`;
      const [fotoB64, qrB64] = await Promise.all([
        fetchImageBase64(fotoUrl, true), // isPhoto = true
        buildQrDataUrl(qrKey)
      ]);

      const drawGeometricsTopRight = () => {
        doc.setFillColor(BLUE_CORP);
        doc.triangle(CARD_W - 90, 0, CARD_W, 0, CARD_W, 90, 'F');
        doc.setFillColor(WHITE);
        doc.triangle(CARD_W - 60, 0, CARD_W, 0, CARD_W, 60, 'F');
        doc.setFillColor(BLUE_CORP);
        doc.triangle(CARD_W - 30, 0, CARD_W, 0, CARD_W, 30, 'F');
      };

      const drawGeometricsBottomLeft = () => {
        doc.setFillColor(BLUE_CORP);
        doc.triangle(0, CARD_H - 90, 90, CARD_H, 0, CARD_H, 'F');
        doc.setFillColor(WHITE);
        doc.triangle(0, CARD_H - 60, 60, CARD_H, 0, CARD_H, 'F');
        doc.setFillColor(BLUE_CORP);
        doc.triangle(0, CARD_H - 30, 30, CARD_H, 0, CARD_H, 'F');
      };

      const processCardSide = (isFront: boolean) => {
        const cx = 0; const cy = 0;
        
        // Background
        doc.setFillColor(GREEN_BG);
        doc.rect(0, 0, CARD_W, CARD_H, 'F');

        // Borde Exterior Oscuro
        doc.setDrawColor('#1A0F2E');
        doc.setLineWidth(3);
        doc.rect(cx+1.5, cy+1.5, CARD_W - 3, CARD_H - 3);

        const innerPad = 14;
        const contentX = cx + innerPad;
        const contentW = CARD_W - 2 * innerPad;
        let cursorY = cy + innerPad;

        if (isFront) {
          drawGeometricsTopRight();

          const HEADER_H = 35;
          if (logoB64) {
            const format = logoB64.includes('image/png') ? 'PNG' : 'JPEG';
            doc.addImage(logoB64, format, contentX + (contentW - 120) / 2, cursorY + 10, 120, HEADER_H);
          }
          cursorY += HEADER_H + 30;

          const PHOTO_R = 75; // Radio
          const PHOTO_D = PHOTO_R * 2;
          const photoCenterX = CARD_W / 2;
          const photoCenterY = cursorY + PHOTO_R;
          
          if (fotoB64) {
            const format = fotoB64.includes('image/png') ? 'PNG' : 'JPEG';
            try { 
              // La imagen ya viene recortada sin distorsión y con fondo verde circular desde el Canvas
              doc.addImage(fotoB64, format, photoCenterX - PHOTO_R, photoCenterY - PHOTO_R, PHOTO_D, PHOTO_D); 
            } catch (e) { }
            
            // Borde sutil blanco para resaltar el círculo
            doc.setLineWidth(2.5);
            doc.setDrawColor(WHITE);
            doc.circle(photoCenterX, photoCenterY, PHOTO_R, 'S');
          } else {
            doc.setFillColor(WHITE);
            doc.circle(photoCenterX, photoCenterY, PHOTO_R, 'F');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10);
            doc.setTextColor(BLUE_CORP);
            doc.text('SIN FOTO', photoCenterX, photoCenterY, { align: 'center', baseline: 'middle' });
          }
          cursorY += PHOTO_D + 25;

          // Nombres
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(18);
          doc.setTextColor(BLUE_CORP);
          doc.text(safeTxtMixed(row.NOMBRES), CARD_W / 2, cursorY, { align: 'center', maxWidth: contentW });
          cursorY += 20;
          
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(14);
          doc.setTextColor(BLUE_DARK);
          doc.text(safeTxtMixed(row.APELLIDOS), CARD_W / 2, cursorY, { align: 'center', maxWidth: contentW });
          cursorY += 40;

          // Datos a la izquierda
          const dataX = 65; 
          let rowY = cursorY;
          
          const fields = [
            { l: 'C.C', v: safeTxtMixed(row.CEDULA) },
            { l: 'ingreso', v: safeTxtMixed(row.FECHA_INGRESO) },
            { l: 'Codigo', v: safeTxtMixed(row.CODIGO) },
          ];

          for (const f of fields) {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(14);
            doc.setTextColor(BLUE_CORP);
            doc.text(f.l, dataX, rowY);
            
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(BLUE_DARK);
            doc.text(f.v, dataX + 60, rowY);
            rowY += 22;
          }
        } else {
          drawGeometricsBottomLeft();
          
          cursorY += 10;
          if (logoB64) {
            const format = logoB64.includes('image/png') ? 'PNG' : 'JPEG';
            doc.addImage(logoB64, format, contentX + (contentW - 100) / 2, cursorY, 100, 30);
          }
          cursorY += 45;

          doc.setFontSize(12);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(BLUE_CORP);
          doc.text('Nit 900864596-1', CARD_W / 2, cursorY, { align: 'center' });
          cursorY += 45;

          // Datos
          const dataX = 35;
          
          doc.setFontSize(13);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(BLUE_CORP);
          doc.text('Arl:', dataX, cursorY);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(BLUE_DARK);
          doc.text('Sura', dataX + doc.getTextWidth('Arl:') + 5, cursorY);
          cursorY += 25;

          doc.setFont('helvetica', 'bold');
          doc.setTextColor(BLUE_CORP);
          doc.text('Número coordinador', dataX, cursorY);
          cursorY += 18;
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(BLUE_DARK);
          doc.text('Jimmy Lorenzo Ballesteros', dataX, cursorY);
          cursorY += 25;

          doc.setFont('helvetica', 'bold');
          doc.setTextColor(BLUE_CORP);
          doc.text('Contacto de emergencia', dataX, cursorY);
          cursorY += 18;
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(BLUE_DARK);
          const emName = row.FAMILIAR_EMERGENCIA_NOMBRE || 'No registrado';
          doc.text(safeTxtMixed(emName), dataX, cursorY);
          cursorY += 22;

          doc.setFont('helvetica', 'bold');
          doc.setTextColor(BLUE_CORP);
          doc.text('Tel:', dataX, cursorY);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(BLUE_DARK);
          const emTel = row.FAMILIAR_EMERGENCIA_TELEFONO || 'No registrado';
          doc.text(safeTxtMixed(emTel), dataX + doc.getTextWidth('Tel:') + 5, cursorY);

          const bottomY = CARD_H - 50;
          if (qrB64) {
            doc.addImage(qrB64, 'JPEG', CARD_W - 60, bottomY - 15, 45, 45);
            doc.setDrawColor(WHITE);
            doc.setLineWidth(2);
            doc.rect(CARD_W - 60, bottomY - 15, 45, 45, 'S'); 
          }

          // Movido barcode un poco a la derecha para no pisar el triángulo
          const barcodeX = 55;
          doc.setFillColor(WHITE);
          doc.roundedRect(barcodeX, bottomY - 15, 100, 30, 4, 4, 'F');
          
          doc.setDrawColor(BLUE_CORP);
          doc.setLineWidth(1.5);
          for(let i=0; i<30; i++) {
             let draw = i % 3 !== 0; 
             if(draw) {
               doc.line(barcodeX + 6 + (i * 3), bottomY - 10, barcodeX + 6 + (i * 3), bottomY + 10);
             }
          }

          doc.setFont('helvetica', 'bold');
          doc.setFontSize(11);
          doc.setTextColor(BLUE_CORP);
          doc.text(safeTxtMixed(row.CEDULA), barcodeX + 50, bottomY + 28, { align: 'center' });
        }
      };

      // FRONT
      processCardSide(true);
      // BACK
      doc.addPage();
      processCardSide(false);

      doc.save(`carnet_${row.CEDULA}.pdf`);

      let backMsg = '';
      try {
        const pdfBlob = doc.output('blob');
        const pdfFile = new File([pdfBlob], `carnet_${row.CEDULA}.pdf`, { type: 'application/pdf' });
        const codigoContrato = row.CODIGO || cand.contrato?.codigo_contrato;
        
        // tipo_documento del candidato para prefijo "x" en non-CC.
        const tipoDocCarnet = (cand?.tipo_doc ?? undefined) as string | undefined;
        await firstValueFrom(
          codigoContrato
            ? this.docSvc.guardarDocumento(`carnet_${row.CEDULA}.pdf`, cedula, 102, pdfFile, codigoContrato, tipoDocCarnet)
            : this.docSvc.guardarDocumento(`carnet_${row.CEDULA}.pdf`, cedula, 102, pdfFile, undefined, tipoDocCarnet)
        );
        backMsg = '<br><br><small style="color:green;">El carnet también se guardó correctamente en el historial del candidato.</small>';
      } catch (err) {
        console.error('Error guardando carnet en el backend', err);
        backMsg = '<br><br><small style="color:red;">El carnet se descargó, pero hubo un error al guardarlo en el historial.</small>';
      }

      // Guardar bandera en backend INMEDIATAMENTE
      if (cedula) {
        try {
          await firstValueFrom(this.registroProceso.updateProcesoByDocumento({
            numero_documento: cedula,
            // Sin esto el backend resuelve "la última entrevista" y la bandera
            // puede sellarse en un proceso distinto al del contrato.
            proceso_id: proc0?.id ?? undefined,
            contrato: {
              carnet_generado: true,
              carnet_fecha_ingreso: formValues.fecha,
              carnet_codigo: formValues.codigo,
              carnet_centro_costo: formValues.ccosto
            } as any
          } as any, 'PATCH'));
          let proc = proc0;
          if (proc) {
            if (!proc.contrato) proc.contrato = {};
            proc.contrato.carnet_generado = true;
            proc.contrato.carnet_fecha_ingreso = formValues.fecha;
            proc.contrato.carnet_codigo = formValues.codigo;
            proc.contrato.carnet_centro_costo = formValues.ccosto;
            this.refrescoSilencioso = true;
            this.candidatoSeleccionado.set({ ...cand }); // trigger ui reference update
          }
        } catch (e) {
          console.error('Error actualizando bandera carnet_generado', e);
        }
      }

      Swal.close();
      const sendWa = await Swal.fire({
        icon: 'success',
        title: 'Carnet Generado',
        html: `El carnet de ${row.NOMBRES} se descargó correctamente. ¿Quieres enviar un mensaje por WhatsApp diciéndole que adjuntarás el carnet?${backMsg}`,
        showCancelButton: true,
        confirmButtonText: 'Enviar por WhatsApp',
        cancelButtonText: 'Cerrar'
      });

      if (sendWa.isConfirmed) {
        const waStr = cand.contacto?.whatsapp || cand.numCelular || cand.telefono || cand.celular || '';
        let numUrl = '';
        if (waStr) {
          const waNumber = String(waStr).replace(/[^0-9]/g, '');
          numUrl = waNumber ? `57${waNumber}` : '';
        }
        const textToSend = `Hola ${row.NOMBRES}, te damos la bienvenida al equipo. A continuación, adjunto tu carnet digital.`;
        const waUrl = `https://wa.me/${numUrl}?text=${encodeURIComponent(textToSend)}`;
        window.open(waUrl, '_blank', 'noopener,noreferrer');
      }

    } catch (error: any) {
      console.error('❌ Error generando carnet:', error);
      Swal.close();
      await Swal.fire({ icon: 'error', title: 'Error', text: mensajeDeErrorLog('pipeline/carnet', error, 'No se pudo generar el carnet.') });
    }
  }
}
