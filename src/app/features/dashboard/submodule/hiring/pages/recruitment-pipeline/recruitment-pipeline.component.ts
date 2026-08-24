import {
  Component, LOCALE_ID, inject, effect, signal, computed, DestroyRef, PLATFORM_ID,
  ChangeDetectionStrategy, untracked
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
import { MatBadgeModule } from '@angular/material/badge';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { environment } from '@/environments/environment';
import { DocViewerService } from '@/app/shared/services/doc-viewer/doc-viewer.service';
import { MatButtonToggleModule } from '@angular/material/button-toggle';

import { FormsModule, FormArray, FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';

import { SharedModule } from '@/app/shared/shared.module';
import { SearchForCandidateComponent } from '../../components/search-for-candidate/search-for-candidate.component';
import { SelectionQuestionsComponent } from '../../components/selection-questions/selection-questions.component';
import { HiringQuestionsComponent } from '../../components/hiring-questions/hiring-questions.component';
import { HelpInformationComponent } from '../../components/help-information/help-information.component';
import { CameraDialogComponent } from '../../components/camera-dialog/camera-dialog.component';

import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';

import { firstValueFrom, merge, startWith } from 'rxjs';
import Swal from 'sweetalert2';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RegistroProcesoContratacion } from '../../service/registro-proceso-contratacion/registro-proceso-contratacion';
import { SeleccionEstadoService } from '../../service/seleccion/seleccion-estado.service';
import { TableDialogComponent } from '@/app/shared/components/table-dialog/table-dialog.component';
import { GestionDocumentalService } from '../../service/gestion-documental/gestion-documental.service';
import jsPDF from 'jspdf';
import QRCode from 'qrcode';

import { PdfService } from '@/app/shared/services/pdf/pdf.service';
import { HomeService } from '../../../home/service/home.service';
import { ReportesService } from '../../service/reportes/reportes.service';
import { HiringService } from '../../service/hiring.service';
import { getLocalStorageItem } from '@/app/core/utils/safe-storage';
import { ElectronWindowService } from '@/app/core/services/electron-window.service';
import { mensajeDeErrorLog } from '@/app/shared/utils/mensaje-error';
import {
  AvisoDialogComponent,
  AvisoDialogData,
} from '@/app/shared/components/confirm-dialog/confirm-dialog.component';

import { ColumnDefinition } from '@/app/shared/models/advanced-table-interface';

import { faltantesDePagoTransporte, FALTA_GUARDAR } from './pago-transporte.rules';
import {
  aplicarResultadoPruebaLocal,
  esVacanteDePruebaTecnica,
  etiquetaPruebaTecnica,
  resultadoDePruebaTecnica,
} from './prueba-tecnica.rules';
import { esContratoRealMini, estadoContratoPill, procesoDelContrato, procesoVigente, tieneContratoActivoReal } from './contrato.rules';
import { claveTitular, elegirDocDelTitular } from './titular.rules';
import { pedirResultadoEtapa, payloadResultadoEtapa } from '../../components/resultado-etapa/resultado-etapa.dialog';
import { CarnetMasivoDialogComponent } from '../../components/carnet-masivo-dialog/carnet-masivo-dialog.component';
import {
  ArlExcelError,
  ArlIndex,
  leerArlExcel,
  validarCedulaContraArl,
} from '../../shared/arl-excel.helper';

export const MY_DATE_FORMATS: MatDateFormats = {
  parse: { dateInput: 'DD/MM/YYYY' },
  display: {
    dateInput: 'DD/MM/YYYY',
    monthYearLabel: 'MMMM YYYY',
    dateA11yLabel: 'LL',
    monthYearA11yLabel: 'MMMM YYYY',
  },
};

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

@Component({
  selector: 'app-recruitment-pipeline',
  standalone: true,
  imports: [
    FormsModule, ReactiveFormsModule,
    MatIconModule, MatTabsModule, MatDatepickerModule, MatMomentDateModule,
    MatTooltipModule, MatDialogModule, MatBadgeModule, MatSnackBarModule,
    MatButtonToggleModule,
    SharedModule,
    SearchForCandidateComponent, SelectionQuestionsComponent, HiringQuestionsComponent, HelpInformationComponent,
    RouterLink
  ],
  templateUrl: './recruitment-pipeline.component.html',
  styleUrls: ['./recruitment-pipeline.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: LOCALE_ID, useValue: 'es-CO' },
    { provide: MAT_DATE_LOCALE, useValue: 'es-CO' },
    { provide: DateAdapter, useClass: MomentDateAdapter, deps: [MAT_DATE_LOCALE] },
    { provide: MAT_DATE_FORMATS, useValue: MY_DATE_FORMATS },
  ],
})
export class RecruitmentPipelineComponent {
  // ───────── Signals de estado ─────────
  candidatoSeleccionado = signal<any | null>(null);

  /** Nombre completo del candidato, derivado de forma reactiva del candidato seleccionado. */
  nombreCandidato = computed<string>(() => {
    const c = this.candidatoSeleccionado();
    if (!c) return '';
    return [c.primer_nombre, c.segundo_nombre, c.primer_apellido, c.segundo_apellido]
      .map(v => (v ?? '').toString().trim())
      .filter(v => v.length > 0)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  });

  /** Número de documento del candidato seleccionado (string vacío si no hay). */
  numeroDocumento = computed<string>(() => {
    const c = this.candidatoSeleccionado();
    return c?.numero_documento != null ? String(c.numero_documento).trim() : '';
  });

  /**
   * Proceso del que se lee el CONTRATO.
   *
   * No es `entrevistas[0].proceso`: cuando la persona vuelve y se le abre un turno
   * nuevo, la entrevista más reciente todavía no tiene proceso (o tiene otro), y el
   * contrato vive en una anterior. Con `entrevistas[0]` el header salía sin píldora
   * mientras el historial laboral decía CONTRATADO, así que no había cómo dar de
   * baja (caso CC 1097727446). Ver `procesoDelContrato` en contrato.rules.ts.
   */
  private readonly _procesoContrato = computed<any>(() =>
    procesoDelContrato(this.candidatoSeleccionado())
  );

  /**
   * True cuando el candidato consultado tiene un CONTRATO ACTIVO REAL. Mientras
   * lo tenga no puede avanzar al resto del pipeline hasta darle de baja el
   * contrato (ver contrato.rules.ts).
   */
  readonly contratoActivo = computed<boolean>(() =>
    tieneContratoActivoReal(this._procesoContrato())
  );

  /** Estado del pill de contrato del header: activo / retirado / en_tramite / sin_fila. */
  readonly contratoPill = computed(() =>
    estadoContratoPill(this._procesoContrato())
  );

  /** Qué falta de "Pago y Transporte" para poder generar la documentación. */
  readonly faltantesPagoTransporte = computed<string[]>(() =>
    faltantesDePagoTransporte(this._procesoContrato()?.contrato)
  );

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

  /** Contrato que muestra el header (del proceso que realmente lo tiene). */
  readonly contratoHeader = computed<any>(() => this._procesoContrato()?.contrato ?? null);

  /**
   * Los tabs se bloquean por contrato activo, SALVO que se haya activado
   * "Modificar de todas formas": ese override existe justo para poder corregir
   * datos de alguien contratado sin tener que darle de baja.
   */
  readonly bloqueoContratoTabs = computed<boolean>(
    () => this.contratoActivo() && !this.modificacionForzada(),
  );

  // ───────── Override "Modificar de todas formas" ─────────
  /**
   * Permite EDITAR el pipeline de una persona con contrato activo SIN darle de
   * baja. Es una edición pura forward-only: el backend (guard
   * `modificacion_forzada` en update-by-document) NO reinicia banderas ni abre
   * proceso/entrevista nuevos, y sella quién/cuándo.
   */
  readonly modificacionForzada = signal(false);

  /** Auditoría del override para el banner (la fecha la sella el servidor). */
  readonly overrideAuditNombre = signal<string>('');
  readonly overrideAuditFecha = signal<string | null>(null);

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

  // ───────── Finalizar contratación (ARL) ─────────
  /**
   * El Excel de ARL se cachea por sesión: es un export masivo del portal, así
   * que pedirlo en cada finalización obligaría a subir el mismo archivo veinte
   * veces en una jornada.
   */
  readonly arlIndex = signal<ArlIndex | null>(null);
  readonly finalizando = signal(false);
  /**
   * Titulares finalizados en esta sesión, para no repetir el ida y vuelta.
   *
   * Llave por TITULAR (tipo|número), no por número: una misma cédula puede
   * existir como CC y como C.C/CE (dos personas). Con el número a secas,
   * finalizar al CC pintaba el badge "✓ Ya finalizado" también sobre el otro
   * titular. Ver claveTitular en titular.rules.ts.
   */
  private readonly finalizadas = signal<Set<string>>(new Set());

  readonly contratacionFinalizada = computed<boolean>(() => {
    const clave = claveTitular(this.candidatoSeleccionado());
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

  /**
   * Índice del tab activo. Controlado para poder forzar el regreso a "Turnos"
   * cuando hay un contrato activo (los demás tabs quedan deshabilitados).
   */
  readonly tabIndex = signal(0);

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

  // Previews locales
  fotoDataUrl = signal<string | null>(null);
  fotoBlobUrl = signal<string | null>(null); // foto de la API resuelta a blob (JWT) para el avatar
  firmaDataUrl = signal<string | null>(null);
  huellaDataUrl = signal<string | null>(null);

  // ───────── Cascada por candidato ─────────
  /** Última cédula a la que ya se le corrió la cascada completa (docs, bio). */
  private cedulaAtendida: string | null = null;

  /** Titular (tipo|número) de esa cascada: distingue CC de C.C/CE con el mismo número. */
  private titularAtendido: string | null = null;

  /** Se incrementa en cada consulta del buscador (ver onCandidatoSeleccionado). */
  readonly consultaSeq = signal(0);

  /**
   * Se pone en true justo antes de un `candidatoSeleccionado.set()` interno
   * (recargas tras guardar). El effect lo consume y, si la persona es la misma,
   * se salta la cascada de peticiones. Una consulta desde el buscador nunca lo
   * marca, así que re-consultar a la misma persona sí recorre todo de nuevo.
   */
  private refrescoSilencioso = false;

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
   * URL que ya se intentó cargar y falló (404, archivo movido, etc.).
   *
   * Se guarda la URL y no un simple booleano para que al cambiar de candidato
   * —o al subir una foto nueva, que estrena URL— se vuelva a intentar solo.
   */
  private fotoUrlFallida = signal<string | null>(null);

  avatarPhotoUrl = computed<string | null>(() => {
    const url = this.avatarPhotoUrlCandidata();
    // Si esa imagen ya falló, se devuelve null para que el avatar caiga en el
    // ícono de persona. Dejar el <img> roto en pantalla muestra el texto
    // alternativo ("Foto del candidato") sobre el fondo azul, que se ve como
    // un error de la aplicación.
    return url && url === this.fotoUrlFallida() ? null : url;
  });

  /**
   * URL de la foto del candidato para mostrar en el avatar del header.
   * Prioridad: preview local recién tomada → blob de la API (JWT) → archivo
   * subido (foto doc) → biometría almacenada. Devuelve null si todavía no hay
   * foto.
   *
   * También chequea propiedades alternativas (`url`, `urlfoto`, `foto`) en el
   * documento por si el backend usa nombres distintos.
   */
  private avatarPhotoUrlCandidata = computed<string | null>(() => {
    const local = this.fotoDataUrl();
    if (local) return local;

    const blob = this.fotoBlobUrl();
    if (blob) return blob;

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

  /** Notifica que la imagen del avatar falló (la descarta para caer al ícono). */
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

  // Un archivo por examen seleccionado (mapeo por índice)
  examFiles = signal<File[]>([]);

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
  private snack = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private destroyRef = inject(DestroyRef);
  private readonly docSvc = inject(GestionDocumentalService);
  private readonly docViewer = inject(DocViewerService);

  private util = inject(UtilityServiceService);
  private pdfSvc = inject(PdfService);
  private registroProceso = inject(RegistroProcesoContratacion);
  private reportesSvc = inject(ReportesService);
  private hiringSvc = inject(HiringService);
  private homeService = inject(HomeService);
  private electronWindow = inject(ElectronWindowService);
  private platformId = inject(PLATFORM_ID);
  private isBrowser = signal(false);
  private seleccionEstado = inject(SeleccionEstadoService);
  private readonly router = inject(Router);

  /**
   * El candidato quedó EN ESPERA de vacante o NO APLICA (observación del
   * evaluador): se bloquean los Exámenes de ingreso hasta que aplique.
   */
  readonly bloqueado = this.seleccionEstado.bloqueado;
  readonly motivoBloqueo = this.seleccionEstado.motivoBloqueo;

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

  /**
   * Huella de los datos de salud ocupacional ya pintados. El effect que
   * autollena esa pestaña corre con cada referencia nueva del candidato; si la
   * huella no cambió (misma persona, mismos datos), reconstruir borraría los
   * PDFs de exámenes adjuntos. A diferencia del corte por cédula de antes, si
   * el backend trae datos DISTINTOS de la misma persona (otro operador, otra
   * pestaña, re-consulta) el formulario sí se repinta.
   */
  private saludFingerprint: string | null = null;

  // 🔔 control para no spamear toasts
  private _lastMissingKey = signal<string>('');

  // ───────── Toast de faltantes (SweetAlert2) ─────────
  // Antes era un overlay artesanal colgado de document.body que QUEDABA PEGADO
  // sobre la página (incluso al navegar). El toast de Swal se descarta solo,
  // anima como el resto de avisos de la app y el operador puede cerrarlo.

  /** true si el popup visible de Swal es un TOAST (no un modal). */
  private _swalToastVisible(): boolean {
    return Swal.isVisible() && !!Swal.getPopup()?.classList.contains('swal2-toast');
  }

  /** Devuelve true si el toast se mostró (false si había un modal abierto). */
  private _mostrarToastFaltantes(missing: string[]): boolean {
    // Swal es de instancia única: dispararlo sobre un modal abierto (una
    // confirmación, por ejemplo) lo cerraría. En ese caso no se muestra y el
    // effect lo reintenta en el próximo cambio.
    if (Swal.isVisible() && !this._swalToastVisible()) return false;
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'info',
      title: 'Faltan requisitos para Contratación',
      html: `<ul style="margin:0;padding-left:18px;text-align:left;font-size:12.5px;line-height:1.45">
        ${missing.map(m => `<li>${m}</li>`).join('')}
      </ul>`,
      showConfirmButton: false,
      showCloseButton: true,
      timer: 9000,
      timerProgressBar: true,
    });
    return true;
  }

  private _cerrarToastFaltantes(): void {
    if (this._swalToastVisible()) Swal.close();
  }

  // normalizeText conserva el espacio interno: el valor del toggle es 'NO APTO'
  // (no 'NOAPTO'), así que la comparación debe hacerse contra 'NO APTO'.
  private isNoApto = (v: unknown) =>
    this.util.normalizeText(v) === 'NO APTO';

  constructor() {
    // Al navegar a otra página: cerrar el toast si sigue abierto y liberar
    // el blob de la preview de la foto.
    this.destroyRef.onDestroy(() => {
      this._cerrarToastFaltantes();
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

    // 2) Cédula + biometría (embebida y refresh opcional)
    //
    // OJO con lo que dispara este effect: `candidatoSeleccionado` se re-setea
    // con una referencia NUEVA tras cada guardado (recargarCandidato y los
    // flujos de confirmación), no solo cuando cambia la persona. Antes cada
    // guardado relanzaba biometría + documentos (varias peticiones por nada).
    // Ahora las recargas internas se marcan (`refrescoSilencioso`) y solo
    // actualizan lo local; la cascada completa corre únicamente cuando la
    // consulta viene del buscador.
    effect(() => {
      if (!this.isBrowser()) return;

      const cand = this.candidatoSeleccionado();
      const ced = cand?.numero_documento ? String(cand.numero_documento) : null;

      const silencioso = this.refrescoSilencioso;
      this.refrescoSilencioso = false;
      // El cambio de persona se detecta por TITULAR (tipo|número): dos
      // titulares distintos pueden compartir número (CC vs C.C/CE) y con la
      // cédula sola pasar de uno al otro se veía como "misma persona".
      const clave = ced ? claveTitular(cand) : null;
      const cambioPersona = clave !== this.titularAtendido;
      this.titularAtendido = clave;
      this.cedulaAtendida = ced;

      // Lo embebido en el payload siempre se refleja: es local y ya está fresco.
      this.setBiometriaFromCandidate(cand);

      if (!ced) {
        this.examenMedicoDoc.set(null);
        this.arlDoc.set(null);
        this.fotoDoc.set(null);
        this.fotoBlobUrl.set(null);
        this.liberarPreviewFoto();
        this.fotoDataUrl.set(null);
        return;
      }

      // Recarga interna de la MISMA persona: nada nuevo que pedirle al
      // servidor, y la vista previa local sigue siendo su foto (soltarla acá
      // era lo que dejaba el avatar en blanco justo después de subirla).
      if (silencioso && !cambioPersona) return;

      // untracked: la cascada dispara HttpClient, y al suscribirse corren
      // SÍNCRONOS los interceptores, que leen señales ajenas (el de loading lee
      // `_pasos`, el offline lee `onlineStatus`). Sin untracked el effect queda
      // suscrito a esas señales, que cambian con CADA respuesta HTTP → el
      // effect relanzaba la cascada en bucle infinito hasta agotar el rate
      // limit del gateway (tormenta de 429 del 2026-08-19). Este effect solo
      // debe depender de `candidatoSeleccionado`.
      untracked(() => {
        const bio = cand?.biometria ?? null;
        if (!bio || this.isBioStale(bio)) {
          this.refreshBiometriaForCandidate(ced).catch(() => this.biometria.set(null));
        }
        this.refreshExamenMedicoForCandidate(ced);
        this.refreshArlForCandidate(ced);
        this.refreshFotoForCandidate(ced);
      });

      // La vista previa local es del candidato ANTERIOR: si no se suelta, se
      // queda mostrando su foto encima del nuevo (y además fuga el blob).
      this.liberarPreviewFoto();
      this.fotoDataUrl.set(null);
      this.fotoUrlFallida.set(null);
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

      // Sólo (re)cargamos cuando la HUELLA de datos cambia. Evita que
      // mutaciones del mismo candidato (nueva referencia del signal) reinicien
      // el formulario y descarten los PDFs de exámenes ya adjuntados, pero sí
      // repinta cuando el backend trae datos de salud distintos.
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
          text: 'Hay al menos un examen con resultado "NO APTO". Al guardar, el proceso quedará marcado como RECHAZADO (901).',
          confirmButtonText: 'Entendido',
          allowOutsideClick: false,
          allowEscapeKey: false,
        });
      }
      if (!hay && this._warnedNoApto()) this._warnedNoApto.set(false);
    });

    // 5) 🔔 Toast AUTOMÁTICO (Swal, se descarta solo) con lo que FALTA (top-end)
    effect(() => {
      if (!this.isBrowser()) return;
      const cand = this.candidatoSeleccionado();
      if (!cand) { this._cerrarToastFaltantes(); return; }

      const missing = this._missingForContratacion();
      const key = missing.join('|');

      // solo mostrar si hay algo faltante y cambió el "hash" de motivos
      if (missing.length > 0) {
        if (key !== this._lastMissingKey()) {
          // La llave solo se sella si el toast DE VERDAD se mostró (con un
          // modal abierto se pospone y se reintenta en el próximo cambio).
          if (this._mostrarToastFaltantes(missing)) this._lastMissingKey.set(key);
        }
      } else {
        // ya no falta nada ⇒ cerrar si está abierto
        this._lastMissingKey.set('');
        this._cerrarToastFaltantes();
      }
    });

    // 6) Contrato ACTIVO ⇒ sólo "Turnos" disponible. Si el candidato
    //    consultado tiene contrato activo forzamos el primer tab; los demás
    //    quedan deshabilitados en la plantilla hasta darle de baja.
    effect(() => {
      if (this.contratoActivo()) this.tabIndex.set(0);
    });
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
    // Apenas se busca/selecciona un candidato (búsqueda por cédula o clic en la
    // cola de Turnos), abrir automáticamente el diálogo de Historial laboral,
    // sin tener que pulsar "Ver tabla de registros".
    if (candidato?.numero_documento) {
      this.mostrarTabla();
    }
  }

  /**
   * Recarga el candidato desde el backend tras guardar la entrevista. Si el proceso
   * anterior era terminal, el backend abrió uno nuevo; al re-fetch y setear una
   * referencia nueva, las píldoras (contrato/prueba) y el Historial reflejan el
   * proceso nuevo SIN tener que volver a buscar a la persona.
   */
  recargarCandidato(): void {
    const ced = (this.numeroDocumento() || this.candidatoSeleccionado()?.numero_documento || '')
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

  // ───────── ELIMINAR PROCESO DEL HISTORIAL ─────────
  /** Aviso/confirmación como MatDialog, para poder abrirlo sobre otro diálogo. */
  private avisoDialog(data: AvisoDialogData): Promise<boolean> {
    return firstValueFrom(
      this.dialog.open<AvisoDialogComponent, AvisoDialogData, boolean>(
        AvisoDialogComponent, { data, autoFocus: 'dialog', restoreFocus: false },
      ).afterClosed(),
    ).then(r => r === true);
  }

  /**
   * Borra la entrevista/proceso del candidato consultado.
   *
   * Lo que NO se borra: el candidato ni su formulario web. Si llenó el paso 1 o
   * el formulario completo, eso queda intacto — no tiene por qué volver a
   * llenarlo porque se anuló un proceso de selección.
   *
   * Lo que sí se va, en cascada: proceso, contrato y antecedentes.
   */
  async eliminarProcesoDelHistorial(row: any): Promise<boolean> {
    const doc = String(
      row?.numero_documento
      ?? this.candidatoSeleccionado()?.numero_documento
      ?? this.numeroDocumento()
      ?? '',
    ).trim();
    if (!doc) return false;

    // `id` de la fila = ProcesoCandidato.id (lo trae el mini-serializer del
    // historial). Se manda explícito para borrar ESE registro y no el más reciente.
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

  // ───────── CONFIRMACIÓN CONTACTO ─────────
  async confirmarCorreoBienvenida(): Promise<void> {
    const cand = this.candidatoSeleccionado();
    if (!cand?.id) return;

    const emailStr = cand.contacto?.email || cand.correo_electronico || cand.correo || 'No registrado';
    const msgTemplate = `Hola ${cand.primer_nombre || ''},\n\nTe damos la bienvenida al equipo.\n\nPor favor confirma la recepción de este correo.\n\nSaludos.`;

    const { value: textToSend, isConfirmed } = await Swal.fire({
      title: 'Confirmar Correo de Bienvenida',
      html: `<p>Se enviará el siguiente mensaje a: <b>${emailStr}</b></p>`,
      input: 'textarea',
      inputValue: msgTemplate,
      inputAttributes: {
        'aria-label': 'Mensaje de bienvenida'
      },
      showCancelButton: true,
      confirmButtonText: 'Confirmar y Guardar',
      cancelButtonText: 'Cancelar',
      width: '600px'
    });

    if (!isConfirmed) return;

    try {
      Swal.fire({ title: 'Guardando confirmación...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
      await firstValueFrom(this.registroProceso.confirmarContacto(cand.id, { correo_confirmado: true }));
      cand.contacto = cand.contacto || {};
      cand.contacto.correo_confirmado = true;
      // Nueva referencia: el signal usa igualdad por referencia; sin el spread el
      // badge de "correo confirmado" no se repinta (zoneless). Es una recarga
      // interna de la misma persona: no relanza la cascada de peticiones.
      this.refrescoSilencioso = true;
      this.candidatoSeleccionado.set({ ...cand });
      Swal.close();
      this.snack.open('Correo confirmado', 'OK', { duration: 3000 });

      // Here you could also trigger an email sending service with `textToSend` and `emailStr`
      // if there's a backend endpoint for it, but for now we just mark it as confirmed.
    } catch (err) {
      Swal.close();
      console.error(err);
      this.snack.open('Error al confirmar correo', 'Cerrar', { duration: 3000 });
    }
  }

  async confirmarWhatsAppBienvenida(): Promise<void> {
    const cand = this.candidatoSeleccionado();
    if (!cand?.id) return;

    const waStr = cand.contacto?.whatsapp || cand.numCelular || cand.telefono || cand.celular || 'No registrado';
    const msgTemplate = `Hola ${cand.primer_nombre || ''}, te damos la bienvenida al equipo. Por favor confirma este mensaje.`;

    const { value: textToSend, isConfirmed } = await Swal.fire({
      title: 'Confirmar WhatsApp de Bienvenida',
      html: `<p>Se enviará el siguiente mensaje a: <b>${waStr}</b></p>`,
      input: 'textarea',
      inputValue: msgTemplate,
      inputAttributes: {
        'aria-label': 'Mensaje de WhatsApp'
      },
      showCancelButton: true,
      confirmButtonText: 'Confirmar y Guardar',
      cancelButtonText: 'Cancelar',
      width: '600px'
    });

    if (!isConfirmed) return;

    try {
      Swal.fire({ title: 'Guardando confirmación...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
      await firstValueFrom(this.registroProceso.confirmarContacto(cand.id, { whatsapp_confirmado: true }));
      cand.contacto = cand.contacto || {};
      cand.contacto.whatsapp_confirmado = true;
      // Nueva referencia para que el badge de WhatsApp se repinte (zoneless).
      // Recarga interna: sin cascada de peticiones.
      this.refrescoSilencioso = true;
      this.candidatoSeleccionado.set({ ...cand });
      Swal.close();
      this.snack.open('WhatsApp confirmado', 'OK', { duration: 3000 });

      // Open WhatsApp web with the message
      if (waStr !== 'No registrado') {
        const waNumber = waStr.replace(/[^0-9]/g, '');
        const waUrl = `https://wa.me/57${waNumber}?text=${encodeURIComponent(textToSend)}`;
        window.open(waUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      Swal.close();
      console.error(err);
      this.snack.open('Error al confirmar WhatsApp', 'Cerrar', { duration: 3000 });
    }
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

        // Recarga real desde el backend: el contrato puede vivir en una
        // entrevista ANTERIOR a entrevistas[0] (caso CC 1097727446, ver
        // procesoDelContrato) y el parche local de antes no lo alcanzaba —
        // la píldora seguía en "activo" y los tabs bloqueados hasta re-buscar.
        this.recargarCandidato();
        Swal.fire('¡Baja exitosa!', `El contrato de ${this.nombreCandidato()} ha sido desactivado.`, 'success');
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

    // Mismo diálogo que usa el resultado del examen médico: una sola
    // implementación para que ambos pidan y validen igual (incluye pedir el
    // motivo también cuando "no se presentó").
    const elegido = await pedirResultadoEtapa(this.dialog, 'prueba', {
      resultado: this.resultadoPrueba(),
      motivoNoPaso: this._proceso()?.motivo_no_paso_prueba_tecnica,
      motivoNoSePresento: this._proceso()?.motivo_no_se_presento_prueba_tecnica,
    }, this.nombreCandidato());
    if (!elegido) return;

    const { resultado, motivo } = elegido;

    const payload: any = {
      numero_documento: String(cc),
      // Con cédula duplicada entre procesos, sin el id el backend podría tocar
      // el proceso equivocado (mismo patrón que registrarResultadoExamen).
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
        // Recarga interna de la misma persona: sin cascada de peticiones.
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

  /**
   * Lista de lo que falta para habilitar Contratación, en LENGUAJE del
   * operador (qué hacer y en qué pestaña), nunca en jerga de campos del
   * backend ("proceso.entrevistado en TRUE" no le dice nada a nadie).
   */
  private _missingForContratacion(): string[] {
    const cand = this.candidatoSeleccionado();
    if (!cand || !Array.isArray(cand.entrevistas) || cand.entrevistas.length === 0) {
      return ['La persona aún no tiene una entrevista registrada.'];
    }

    const proc = this._firstProceso(cand);
    if (!proc) return ['La entrevista aún no tiene un proceso de contratación asociado.'];

    const missing: string[] = [];

    // Antecedentes
    const vEPS = this._antecedenteValor(proc, 'EPS');
    const vPROC = this._antecedenteValor(proc, 'PROCURADURIA');
    const vPOLI = this._antecedenteValor(proc, 'POLICIVOS');

    // ✅ EPS: sólo que NO esté vacío
    if (!vEPS || this._norm(vEPS).length === 0) {
      missing.push('Registrar la EPS en la pestaña Antecedentes.');
    }

    // Se mantienen estos como "CUMPLE"
    if (this._norm(vPROC) !== 'CUMPLE') {
      missing.push(`Procuraduría debe quedar en CUMPLE${vPROC ? ` (hoy: ${vPROC})` : ' (aún sin registrar)'}.`);
    }
    if (this._norm(vPOLI) !== 'CUMPLE') {
      missing.push(`Policivos debe quedar en CUMPLE${vPOLI ? ` (hoy: ${vPOLI})` : ' (aún sin registrar)'}.`);
    }

    // Etapas del proceso
    if (proc?.entrevistado !== true) {
      missing.push('Completar y guardar la entrevista (pestaña Selección).');
    }

    // ❌ remision ya no es requisito

    // ✅ Al menos uno: prueba_tecnica o autorizado
    const tienePruebaTecnica = proc?.prueba_tecnica === true;
    const tieneAutorizado = proc?.autorizado === true;
    if (!(tienePruebaTecnica || tieneAutorizado)) {
      missing.push('Enviar a prueba técnica o autorizar el ingreso (Selección › Remisión).');
    }

    if (proc?.examenes_medicos !== true) {
      missing.push('Cargar los exámenes de ingreso (pestaña Exámenes).');
    }

    // NO APTO local (form)
    const arr = (this.selectedExamsArray.value ?? []) as ExamenResultadoForm[];
    const hayNoApto = Array.isArray(arr) && arr.some(x => this.isNoApto(x?.aptoStatus));
    if (hayNoApto) {
      missing.push('Hay un examen con resultado NO APTO: revísalo antes de continuar.');
    }

    return missing;
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
  private yyyymmdd(d = new Date()): string {
    const iso = this.util.formatDateForBackend(d);
    return iso ? iso.replace(/-/g, '') : '';
  }

  // ========= Helpers de UI para no congelar =========
  private nextFrame(): Promise<void> {
    return new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
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

    // El detalle del contrato lo gestiona el componente hijo (hiring-questions),
    // no este padre: aquí sólo se pide la generación del código.
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
        const tipoDoc = (this.candidatoSeleccionado()?.tipo_documento
                        ?? this.candidatoSeleccionado()?.tipoDocumento
                        ?? undefined) as string | undefined;
        const obs = this.candidatoSeleccionado()?.codigo_contrato
          ? this.docSvc.guardarDocumento(mergedFile.name, cedula, TYPE_EXAM, mergedFile, this.candidatoSeleccionado()?.codigo_contrato, tipoDoc)
          : this.docSvc.guardarDocumento(mergedFile.name, cedula, TYPE_EXAM, mergedFile, undefined, tipoDoc);
        await firstValueFrom(obs);
        // Releer el doc 32 para que "Ver examen médico" se encienda ya, sin
        // esperar a volver a consultar al candidato (las recargas silenciosas
        // no refrescan documentos).
        await this.refreshExamenMedicoForCandidate(cedula);
        updateLoader(100, 'Finalizando…');

        resumenHtml = `PDF consolidado subido: <b>${mergedName}</b>`;
      } else {
        updateLoader(100, 'Finalizando…');
        resumenHtml = 'No hay archivos PDF de exámenes para unir.';
      }

      // El PATCH pudo CREAR el código de contrato, marcar examenes_medicos o
      // rechazar el proceso (NO APTO): recargar la señal para que Contratación,
      // la píldora del header, el toast de faltantes y los bloqueos se enteren
      // YA, sin volver a consultar a la persona. (Silencioso: sin cascada HTTP.)
      this.recargarCandidato();

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
   * agrega ARL/SST si aplica, elige sede y envía. No depende del candidato
   * seleccionado en el pipeline.
   */
  irACerrarContratacion(): void {
    this.router.navigate(['/dashboard/hiring/hiring-report'], { queryParams: { auto: 'hoy' } });
  }

  mostrarTabla(): void {
    const ced = this.candidatoSeleccionado()?.numero_documento || this.numeroDocumento();
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
          this.candidatoSeleccionado()?.numero_documento || this.numeroDocumento() || ''
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

          // Fecha de la prueba PROGRAMADA en la publicación (vacante). Se muestra para
          // los procesos de prueba técnica, tengan o no resultado aún.
          row._fecha_prueba_publicacion = row.vacante_fecha_prueba || null;

          // Cuándo se REGISTRÓ el resultado de la prueba (pasó / no pasó / no se
          // presentó). Solo existe cuando ya hay resultado.
          row._fecha_resultado_prueba =
            row.no_paso_prueba_tecnica_at || row.no_se_presento_prueba_tecnica_at
            || row.paso_prueba_tecnica_at || null;

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

          // El motivo del examen se SUMA sin pisar lo anterior.
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
            title: `Historial laboral de ${this.nombreCandidato() || ced}`,
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

    const numero = this.candidatoSeleccionado()?.numero_documento || this.numeroDocumento();
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
      // La foto entró por otro servicio: invalidar el expediente cacheado para
      // que las pestañas que leen getDocumentosDeCandidato (selección,
      // contratación) vean el doc 89 recién subido.
      this.docSvc.invalidarDocumentos(String(numero));
      this.fotoUrlFallida.set(null); // la URL nueva merece su propio intento
      await this.refreshFotoForCandidate(String(numero)); // Actualizar también el doc 89
    } catch (err: any) {
      console.error(err);
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

  private async openInNewTab(url: string): Promise<void> {
    if (!url) return;
    // data:pdf → visor seguro (Electron).
    if (/^data:application\/pdf/i.test(url)) {
      this.electronWindow.openPdfFromBase64(url);
      return;
    }
    // Descarga con JWT → blob (con sniff de content-type para que previsualice, no descargue).
    const ok = await this.docViewer.openInNewTab(url);
    if (!ok) this.snack.open('No se pudo abrir el documento.', 'OK', { duration: 3000 });
  }

  /** Base absoluta de la API (para resolver file_url relativos). */
  private apiBase(): string {
    const b = (environment as any)?.apiUrl || '';
    return b.endsWith('/') ? b.slice(0, -1) : b;
  }

  /** Header Authorization (Bearer) desde localStorage; {} si no hay token. */
  private authHeader(): Record<string, string> {
    try {
      let raw = localStorage.getItem('token') || localStorage.getItem('Authorization');
      if (!raw) {
        const u = localStorage.getItem('user');
        if (u) {
          const user = JSON.parse(u);
          raw = user?.token || user?.jwt || user?.access_token || user?.accessToken || null;
        }
      }
      if (!raw) return {};
      return { Authorization: raw.startsWith('Bearer ') ? raw : `Bearer ${raw}` };
    } catch {
      return {};
    }
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

  private recalcHayNoApto(): void {
    const arr = (this.selectedExamsArray.value ?? []) as ExamenResultadoForm[];
    this.hayNoApto.set(Array.isArray(arr) && arr.some(x => this.isNoApto(x?.aptoStatus)));
  }

  /** Tipo de documento del candidato en pantalla, para elegir el doc del titular. */
  private tipoDocSeleccionado(): string {
    const c = this.candidatoSeleccionado() as any;
    return String(c?.tipo_doc ?? c?.tipo_documento ?? c?.tipoDocumento ?? 'CC');
  }

  private async refreshBiometriaForCandidate(cedula: string): Promise<void> {
    // El endpoint ms-hr /gestion_contratacion/biometria/{cedula} da 500 (mapeo ambiguo con
    // SubCandidatoController) y ademas sirve desde un cache vacio. Los archivos reales viven
    // en ms-documents con file_url valido: FIRMA=87, HUELLA=88, FOTO=89 (mismo path que el
    // resto de documentos que si se ven). Se leen de ahi.
    try {
      const [firmaDocs, huellaDocs, fotoDocs] = await Promise.all([
        firstValueFrom(this.docSvc.getDocuments(cedula, 87)).then(r => this.docsToList(r)).catch(() => [] as ServerDocInfo[]),
        firstValueFrom(this.docSvc.getDocuments(cedula, 88)).then(r => this.docsToList(r)).catch(() => [] as ServerDocInfo[]),
        firstValueFrom(this.docSvc.getDocuments(cedula, 89)).then(r => this.docsToList(r)).catch(() => [] as ServerDocInfo[]),
      ]);
      // Una respuesta tardía del candidato anterior no debe poner su
      // firma/huella sobre el actual.
      if (cedula !== this.cedulaAtendida) return;
      // La lectura expande <ced>/x<ced>: puede traer docs de dos titulares
      // homónimos; se elige el del titular en pantalla (ver titular.rules.ts).
      const tipo = this.tipoDocSeleccionado();
      const firma = elegirDocDelTitular(firmaDocs, cedula, tipo);
      const huella = elegirDocDelTitular(huellaDocs, cedula, tipo);
      const foto = elegirDocDelTitular(fotoDocs, cedula, tipo);
      if (!firma && !huella && !foto) { this.biometria.set(null); return; }
      this.biometria.set({ firma, huella, foto, created_at: null, updated_at: null } as any);
    } catch {
      if (cedula !== this.cedulaAtendida) return;
      this.biometria.set(null);
    }
  }

  /**
   * Normaliza la respuesta de getDocuments: el endpoint puede devolver un array
   * plano o un objeto paginado { results: [...] } (así se maneja en el carnet).
   */
  private docsToList(resp: any): ServerDocInfo[] {
    if (Array.isArray(resp)) return resp;
    return Array.isArray(resp?.results) ? resp.results : [];
  }

  private async refreshExamenMedicoForCandidate(cedula: string): Promise<void> {
    try {
      // 32 es el ID de tipo de documento para EXAMENES_MEDICOS.
      const docs = this.docsToList(await firstValueFrom(this.docSvc.getDocuments(cedula, 32)));
      // La respuesta pudo demorar y el operador ya cambió de persona: escribir
      // acá pondría el examen de otra cédula en pantalla.
      if (cedula !== this.cedulaAtendida) return;
      // No docs[0] a ciegas: la lectura puede traer el examen del otro titular
      // homónimo (owner_id con/sin prefijo "x"). Ver titular.rules.ts.
      this.examenMedicoDoc.set(elegirDocDelTitular(docs, cedula, this.tipoDocSeleccionado()));
    } catch {
      // El fallo de una consulta vieja tampoco debe borrar lo del candidato actual.
      if (cedula !== this.cedulaAtendida) return;
      this.examenMedicoDoc.set(null);
    }
  }

  private async refreshArlForCandidate(cedula: string): Promise<void> {
    try {
      // 30 es el ID para ARL.
      const docs = this.docsToList(await firstValueFrom(this.docSvc.getDocuments(cedula, 30)));
      if (cedula !== this.cedulaAtendida) return;
      this.arlDoc.set(elegirDocDelTitular(docs, cedula, this.tipoDocSeleccionado()));
    } catch {
      if (cedula !== this.cedulaAtendida) return;
      this.arlDoc.set(null);
    }
  }

  private async refreshFotoForCandidate(cedula: string): Promise<void> {
    try {
      // 89 es el ID para FOTO. La foto es el caso más delicado del trío:
      // mostrar la de otro titular es una confusión de identidad.
      const docs = this.docsToList(await firstValueFrom(this.docSvc.getDocuments(cedula, 89)));
      if (cedula !== this.cedulaAtendida) return;
      const doc = elegirDocDelTitular(docs, cedula, this.tipoDocSeleccionado());
      this.fotoDoc.set(doc);
      // La foto se pinta como <img>; su file_url es de la API (JWT) → se resuelve a blob.
      const url = (doc as any)?.file_url || null;
      const blob = url ? await this.toBlobUrl(url) : null;
      // Re-chequeo tras el segundo await: la descarga del blob también pudo demorar.
      if (cedula !== this.cedulaAtendida) return;
      this.fotoBlobUrl.set(blob);
    } catch {
      if (cedula !== this.cedulaAtendida) return;
      this.fotoDoc.set(null);
      this.fotoBlobUrl.set(null);
    }
  }

  /** Descarga una URL (API con JWT / relativa) y devuelve un blob URL (con sniff de tipo). */
  private toBlobUrl(url: string | null): Promise<string | null> {
    return this.docViewer.toBlobUrl(url ?? undefined);
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
          const docs = (Array.isArray(docsResp) ? docsResp : (docsResp?.results || []))
            .filter((d: any) => d.type === 102);
          // Misma regla del titular que examen/ARL/foto: dos personas pueden
          // compartir número (CC vs CE) y sin el filtro se abría el carnet del
          // otro titular homónimo.
          const carnetDoc: any = elegirDocDelTitular<any>(docs, cedulaQuery, this.tipoDocSeleccionado());

          Swal.close();
          if (carnetDoc && carnetDoc.file_url) {
            this.openInNewTab(carnetDoc.file_url);
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
    let centroCosto = String(contratoBE?.carnet_centro_costo || contratoBE?.ccentro_de_costos || contratoBE?.Ccentro_de_costos || '').trim();
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

    // cMini solo como RESPALDO: el contrato del backend es la fuente de verdad.
    if (!codigo && cMini?.CARNET_CODIGO) codigo = String(cMini.CARNET_CODIGO).trim();
    if (!centroCosto && cMini?.CARNET_CENTRO_COSTO) centroCosto = String(cMini.CARNET_CENTRO_COSTO).trim();
    if (!fechaIng) {
      const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(cMini?.FECHA_INGRESO ?? '').trim());
      if (m) fechaIng = `${m[3]}-${m[2]}-${m[1]}`;
    }

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
        const tipoDocCarnet = (cand?.tipo_documento ?? cand?.tipoDocumento ?? undefined) as string | undefined;
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
          }, 'PATCH'));
          // Recarga real: el contrato puede vivir en una entrevista ANTERIOR a
          // entrevistas[0] (carnetGeneradoUI lee procesoDelContrato) y el parche
          // local de antes no lo alcanzaba — el badge ✓ no se encendía hasta
          // re-buscar a la persona. Silencioso: sin cascada de peticiones.
          this.recargarCandidato();
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
      // actual tras el await marcaría como "finalizado" a quien estuviera en
      // pantalla en ese momento, no a quien se finalizó.
      const clave = claveTitular(cand);
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
   * Abre la revisión de generación masiva de carnets con las cédulas de la
   * cola del día. El diálogo valida quién tiene todo completo, marca por
   * defecto solo a los que aún no tienen carnet y deja previsualizar antes de
   * generar.
   */
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
        `<b>${this.nombreCandidato() || doc}</b> (${doc}).<br><br>` +
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
        // Los estados quedaron archivados y en SIN_CONSULTAR: recargar para
        // que la pestaña Antecedentes y su cola lo muestren YA (los PDFs
        // nuevos llegan después con los robots).
        this.recargarCandidato();
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
    }, this.nombreCandidato());
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
        // Recarga interna de la misma persona: sin cascada de peticiones.
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


}
