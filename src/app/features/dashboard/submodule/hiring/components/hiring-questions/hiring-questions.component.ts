import {  Component, OnInit, input, output, effect, inject, DestroyRef , ChangeDetectionStrategy, computed, signal } from '@angular/core';
import { centroDeCostosDe } from '../../shared/contrato-campos';
import { ParametrizacionVacantesService } from '../../../users/services/parametrizacion-vacantes/parametrizacion-vacantes.service';
import {
  EstadoCampo, estadoDeControl, esImporteValido, esPorcentajeValido,
} from '../../shared/completitud.util';
import { AbstractControl, FormBuilder, FormGroup, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, merge, Observable } from 'rxjs';
import { take } from 'rxjs/operators';
import { startWith, map } from 'rxjs/operators';
import { SharedModule } from '@/app/shared/shared.module';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDialog } from '@angular/material/dialog';
import Swal from 'sweetalert2';
import { mensajeDeErrorLog } from '@/app/shared/utils/mensaje-error';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import type jsPDF from 'jspdf';
import type { RowInput } from 'jspdf-autotable';
import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';
import {
  FORMATO_ENTREGA_APOYO,
  PLAN_FUNERAL,
} from '../generate-contracting-documents/formato-entrega-docs.data';
import {
  resolverDescripcionObra,
  esDescripcionGenerada,
  descripcionEsDeOtroMes,
  claveDescripcion,
  resolverCodigoCompania,
} from '@/app/shared/data/labores-por-mes.data';
import { GestionDocumentalService } from '../../service/gestion-documental/gestion-documental.service';
import { FarmsService } from '../../../farms/services/farms/farms.service';
import { VacantesService } from '../../service/vacantes/vacantes.service';
import {
  ProcesoUpdateByDocumentRequest,
  RegistroProcesoContratacion,
} from '../../service/registro-proceso-contratacion/registro-proceso-contratacion';
import { SeleccionEstadoService } from '../../service/seleccion/seleccion-estado.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TarjetasService } from '../../service/tarjetas.service';
import { PositionsService } from '../../../positions/services/positions/positions.service';
import { PipelineNavService } from '../../service/pipeline-nav/pipeline-nav.service';
import { DocumentosPaqueteComponent } from '../documentos-paquete/documentos-paquete.component';
import { EmpalmeDocumentosComponent } from '../empalme-documentos/empalme-documentos.component';
import { FirmaDialogComponent } from '../firma/firma.dialog';
import {
  VisorDocumentoComponent, VisorDocumentoData,
} from '../../../nomina/components/visor-documento/visor-documento.component';
import { avanceDeBanderas, avanceDeForm } from '../../shared/progreso.util';
import { AutoGuardado } from '../../shared/auto-guardado';
import { AutoGuardadoEstadoComponent } from '../auto-guardado-estado/auto-guardado-estado.component';
import { HuellaCapturaService } from '../../service/huella/huella-captura.service';
import { ArchivosBackendService } from '../../service/archivos/archivos-backend.service';
import { HuellaError, OrigenHuella } from '../../service/huella/huella.model';

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

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-hiring-questions',
  standalone: true,
  imports: [SharedModule, MatTabsModule, DocumentosPaqueteComponent, EmpalmeDocumentosComponent,
    AutoGuardadoEstadoComponent],
  templateUrl: './hiring-questions.component.html',
  styleUrls: ['./hiring-questions.component.css'],
} )
export class HiringQuestionsComponent implements OnInit {

  // ==========================================================================
  // SUB-PASOS DE CONTRATACIÓN
  // ==========================================================================
  /*
   * Contratación tiene cinco sub-pasos. El rail que los pinta ya no vive aquí:
   * lo pinta el pipeline junto al de Selección, para que las dos capas de
   * navegación se vean y se entiendan igual. Aquí solo queda el contenido.
   *
   * La pestaña abierta se comparte por `PipelineNavService`: rail y
   * `mat-tab-group` leen y escriben la MISMA señal, así no hay dos estados
   * que sincronizar.
   */
  /** Público: la plantilla del paso Cédula & Huella lee la biometría de aquí. */
  readonly nav = inject(PipelineNavService);
  private readonly dialog = inject(MatDialog);
  readonly subIdx = this.nav.subContratacion;

  /** La cédula ya está en el expediente (tipo 29, CEDULA). */
  readonly cedulaSubida = signal<boolean>(false);
  /** Id del documento vigente en el tipo 29, para previsualizarlo. */
  readonly cedulaDocumentoId = signal<number | null>(null);
  readonly subiendoCedula = signal<boolean>(false);
  // ───────── Input con signals ─────────
  candidatoSeleccionado = input<any>(null);
  /**
   * Avisa al pipeline que algo del contrato/proceso cambió, para que recargue el
   * candidato. Sin esto el padre se queda con el objeto viejo y los `computed`
   * que dependen de él (p. ej. el botón "Generar documentación", que exige
   * "Pago y Transporte" completo) no se habilitan hasta volver a buscar a la persona.
   */
  guardado = output<void>();
  /**
   * Override "Modificar de todas formas" (pipeline con contrato activo): los
   * guardados de este tab se marcan como edición pura sobre el proceso EXISTENTE.
   * El backend (update-by-document) NO reinicia banderas ni abre proceso nuevo y
   * sella la auditoría con el nombre + fecha/hora del servidor.
   */
  modificacionForzada = input<boolean>(false);
  /** Nº de consulta del buscador: re-consultar a la misma persona re-parchea. */
  consultaSeq = input<number>(0);
  modificadoPor = input<string>('');
  /**
   * Documento tal como se tecleó en el buscador.
   *
   * Hay registros a los que `numero_documento` les llega vacío: el módulo
   * Documentos se quedaba en "busca primero a la persona" con la persona
   * delante. El pipeline sabe con qué documento se buscó y lo baja aquí.
   */
  documentoBuscado = input<string | null>(null);

  /** La cédula con la que trabajan los dos sub-módulos de Documentos. */
  readonly cedulaDocs = computed<string>(() => {
    const cand = this.candidatoSeleccionado();
    const suya = cand?.numero_documento ? String(cand.numero_documento).trim() : '';
    return suya || (this.documentoBuscado() ?? '').toString().trim();
  });

  /** Inyecta las banderas de override en cualquier payload de update-by-document. */
  /**
   * Proceso EXACTO sobre el que trabaja esta pestaña, resuelto por el pipeline
   * (`procesoContratacion`). Sin esto el backend resolvía "la última
   * entrevista" por su cuenta: se guardaba en un proceso y la pantalla leía de
   * otro, así que forma de pago decía "guardado" y volvía vacía.
   */
  procesoId = input<number | string | null>(null);

  /**
   * Sella el destino (`proceso_id`) y, si aplica, el override de edición
   * forzada. Todos los guardados de esta pestaña pasan por aquí para que
   * ninguno pueda quedarse sin destino explícito.
   */
  private conDestino(payload: ProcesoUpdateByDocumentRequest): ProcesoUpdateByDocumentRequest {
    const id = this.procesoId();
    const out: ProcesoUpdateByDocumentRequest = id == null
      ? payload
      : { ...payload, proceso_id: Number(id) };
    if (!this.modificacionForzada()) return out;
    return { ...out, modificacion_forzada: true, modificado_por: this.modificadoPor() || null };
  }

  // ───────── UI ─────────
  descripcionVacante = '';
  nombreEmpresa = '';

  // ───────── Formularios ─────────
  pagoTransporteForm!: FormGroup;
  referenciasForm!: FormGroup;
  trasladosForm!: FormGroup;
  huellaForm!: FormGroup;
  /** Datos de obra/empresa para documentos (siempre desde la vacante, solo lectura). */
  datosObraForm!: FormGroup;

  // ───────── Archivos / tipos ─────────
  uploadedFiles: Record<string, LocalFile> = {};
  serverDocs: Record<string, ServerDocInfo> = {};

  private readonly typeMap: Record<string, number> = {
    personal1: 16, personal2: 16,
    familiar1: 17, familiar2: 17,
    traslado: 18,
    laboral1: 86, laboral2: 86,
  };

  // Lista de tarjetas disponibles (objetos completos)
  tarjetasDisponibles: any[] = [];
  filteredTarjetas!: Observable<any[]>;

  // PDFs por empresa
  private readonly DOCS: Record<string, string> = {
    'APOYO LABORAL TS SAS': 'APOYOLABORALCARTAAUTORIZACIONTRASLADO2024.pdf',
    'TU ALIANZA SAS': 'TUALIANZACARTAAUTORIZACIONTRASLADO_2024.pdf',
  };

  // ── Documentos con Huella (dialog preview) ──
  showDocumentsDialog = false;
  huellaDocsList: { title: string; safeUrl: SafeResourceUrl }[] = [];
  currentDocIndex = 0;

  /**
   * Cómo llegó la imagen, en el vocabulario del backend. El origen vivía solo
   * dentro del nombre del archivo, así que no se podía consultar cuántas
   * huellas se habían adjuntado a mano en lugar de capturarse con lector.
   */
  private static readonly ORIGEN_A_CATALOGO: Record<string, string> = {
    'agente-local': 'AGENTE_LOCAL',
    'electron': 'ELECTRON',
    'nativo-android': 'ANDROID',
    'archivo': 'ARCHIVO',
    'camara': 'CAMARA',
  };

  // ── Consentimiento Biométrico — Huella (Ley 1581 de 2012) ──
  private static readonly EMPRESAS_HUELLA: Record<string, { nombre: string }> = {
    'apoyo-laboral': { nombre: 'APOYO LABORAL T.S. S.A.S.' },
    'tu-alianza': { nombre: 'TU ALIANZA SAS' },
  };
  private readonly VERSION_CONSENTIMIENTO_HUELLA = 'v1.0-2026';

  private buildTextoConsentimientoHuella(empresa: string): string {
    return (
      'En cumplimiento de la Ley Estatutaria 1581 de 2012 "Por la cual se dictan disposiciones generales ' +
      'para la protección de datos personales" y su Decreto Reglamentario 1377 de 2013, autorizo de manera ' +
      `libre, expresa, previa e informada a ${empresa} para que realice la recolección, ` +
      'almacenamiento, uso, circulación, supresión y en general, el tratamiento de mis datos biométricos ' +
      '(huella dactilar) que voluntariamente suministro en este proceso, con la finalidad de validar mi ' +
      'identidad, formalizar mi vinculación laboral y generar soporte probatorio contractual. ' +
      'Declaro que he sido informado(a) de mis derechos como titular de datos personales, incluyendo el ' +
      'derecho a conocer, actualizar, rectificar y solicitar la supresión de mis datos, así como a revocar ' +
      'la autorización otorgada, mediante comunicación dirigida al responsable del tratamiento.'
    );
  }

  // Huellas (per-company UI state)
  messageApoyo = '';
  messageTuAlianza = '';
  fingerprintImageApoyo: string | null = null;
  fingerprintImageTuAlianza: string | null = null;
  // Legacy (kept for PD if needed)
  messageID = '';
  messagePD = '';
  fingerprintImageID: string | null = null;
  fingerprintImagePD: string | null = null;

  // ───────── Inyección compacta ─────────
  private readonly fb = inject(FormBuilder);
  private readonly http = inject(HttpClient);
  private readonly docSvc = inject(GestionDocumentalService);
  private readonly vacantesService = inject(VacantesService);
  private readonly farmsService = inject(FarmsService);
  private readonly procesosService = inject(RegistroProcesoContratacion);
  private readonly tarjetasService = inject(TarjetasService);
  private readonly positionsService = inject(PositionsService);
  // Seguros funerarios por centro de costo. El servicio ya existía para el
  // parametrizador; aquí solo se LEE (`segurosDeCentro`).
  private readonly parametrizacion = inject(ParametrizacionVacantesService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly seleccionEstado = inject(SeleccionEstadoService);
  private readonly utilService = inject(UtilityServiceService);
  private readonly huellaSvc = inject(HuellaCapturaService);
  /**
   * La ruta del archivo biometrico va por el gateway y EXIGE token: un
   * `<img src>` directo recibe 401 y la tarjeta se queda en blanco, que es
   * exactamente lo que parecia "no se guardo". Este servicio la descarga con
   * cabecera y devuelve algo pintable.
   */
  private readonly archivos = inject(ArchivosBackendService);

  /**
   * El candidato quedó EN ESPERA de vacante o marcado NO APLICA (observación del
   * evaluador): se bloquea toda la contratación hasta que aplique.
   */
  readonly bloqueado = this.seleccionEstado.bloqueado;
  readonly motivoBloqueo = this.seleccionEstado.motivoBloqueo;

  constructor() {
    // Reacciona a cambios del candidato seleccionado
    effect(() => {
      if (this.candidatoSeleccionado()) {
        this.loadData().catch(console.error);
      }
    });

    // Va aquí y no en `ngOnInit`: `effect()` exige contexto de inyección.
    this.vigilarIdentidad();
  }

  /**
   * "Pago y Transporte" sin botón "Cargar": cada respuesta se guarda sola (ver
   * `AutoGuardado`). La llave es la persona + el proceso: un guardado pedido para
   * uno no puede caer en otro.
   */
  readonly autoPago = new AutoGuardado(
    () => this.cargarPagoTransporte({ silencioso: true }),
    () => `${this.cedulaDocs()}|${this.procesoId() ?? ''}`,
  );

  // ───────── Ciclo de vida ─────────
  // ── Grupo de pago: lo trae la REQUISICIÓN ─────────────────────────────────
  // Antes se elegía aquí (y antes de eso era texto libre prellenado con `centros_costos.grupo`,
  // donde 826 de 1.041 centros dicen "GRUPO 1"). Ahora manda la vacante: de su grupo salen las
  // fechas de pago y el casino que imprime el contrato, así que este campo solo lo muestra.
  //
  // Ya no se pide el catálogo de grupos: sin desplegable no hay nada que llenar con él.

  grupoVacante = '';

  /**
   * Ayuda bajo el campo: de dónde sale el valor.
   *
   * El grupo decide las fechas de pago y el casino que imprime el contrato, y los dos textos
   * los congela la VACANTE. Por eso aquí no se elige: se muestra.
   *
   * Cuando la vacante no trae grupo —las de antes de esta parametrización, y todas mientras
   * ms-automation no guarde el suyo— se dice, en vez de dejar un hueco sin explicación. Si
   * hay algo guardado de antes, se conserva y se avisa de que no viene de la requisición.
   */
  get ayudaGrupo(): string {
    const actual = String(this.pagoTransporteForm?.get('grupo')?.value ?? '').trim();
    if (this.grupoVacante) return `Viene de la requisición (${this.grupoVacante}).`;
    if (actual) return 'Guardado antes; la requisición todavía no trae grupo.';
    return 'Lo define la requisición: se llena solo cuando la vacante lleva su grupo.';
  }

  ngOnInit(): void {
    this.initForms();
    this.autoPago.vigilar(this.pagoTransporteForm, this.destroyRef);
    this.setupFormaPagoValidation(); // ← aplica validación dinámica CO
    this.loadTarjetas();
    // Consentimiento: autocompletar UserAgent
    this.huellaForm.patchValue({ userAgent: navigator.userAgent });

    // Sondea el lector una vez, para que el botón diga qué va a usar en lugar
    // de fallar al pulsarlo. No bloquea el arranque de la pantalla.
    void this.refrescarFormaCaptura();

    this.filteredTarjetas = this.pagoTransporteForm.get('numeroIdentificacion')!.valueChanges.pipe(
      startWith(''),
      map(value => this._filterTarjetas(value || '')),
    );

    // La labor de la base cambia con el MES de ingreso, así que si se corrige
    // la fecha hay que reproponerla.
    this.pagoTransporteForm.get('fechaIngreso')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.sugerirDescripcionObra());

    // Avance de los cinco sub-pasos para el rail del pipeline. Se escucha
    // también `statusChanges`: los obligatorios de Pago y Transporte cambian
    // con la forma de pago (Daviplata no pide tarjeta ni contraseña), y eso
    // mueve el denominador, no solo el numerador.
    merge(
      this.pagoTransporteForm.valueChanges, this.pagoTransporteForm.statusChanges,
      this.datosObraForm.valueChanges,
      this.referenciasForm.valueChanges,
      this.trasladosForm.valueChanges, this.trasladosForm.statusChanges,
      this.huellaForm.valueChanges,
    )
      .pipe(startWith(null), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.publicarAvances());
  }

  /** Tipo con el que gestión documental guarda la cédula escaneada. */
  private static readonly TIPO_CEDULA = 29;

  /** Nombre del documento de identidad según `tipo_doc` de la persona. */
  private static readonly NOMBRE_DOCUMENTO: Readonly<Record<string, string>> = {
    CC: 'Cédula de ciudadanía',
    CE: 'Cédula de extranjería',
    TI: 'Tarjeta de identidad',
    PEP: 'Permiso especial de permanencia',
    PPT: 'Permiso por protección temporal',
    PT: 'Permiso temporal',
    PA: 'Pasaporte',
  };

  /**
   * La tarjeta no se llama "Cédula" para todos: a quien se contrata con PPT o
   * pasaporte hay que pedirle ESE documento. Sin tipo se asume cédula, que es
   * lo que hace el resto del pipeline (`tipo_doc || 'CC'`).
   */
  readonly nombreDocumento = computed<string>(() => {
    const tipo = String(this.candidatoSeleccionado()?.tipo_doc || 'CC').trim().toUpperCase();
    return HiringQuestionsComponent.NOMBRE_DOCUMENTO[tipo] ?? `Documento de identidad (${tipo})`;
  });

  /** Última cédula para la que se miró el expediente, para no repetir. */
  private cedulaRevisada: string | null = null;

  /**
   * Republica el avance del paso cuando cambia algo que NO pasa por un
   * formulario: la persona, su biometría o si ya se comprobó el contacto.
   *
   * `publicarAvances` cuelga de los `valueChanges` de los formularios, así que
   * sin esto el paso se quedaba con el porcentaje de la persona anterior.
   */
  private vigilarIdentidad(): void {
    effect(() => {
      const cand = this.candidatoSeleccionado();
      this.nav.biometria();
      this.cedulaSubida();
      this.publicarAvances();

      // ¿La cédula ya está en el expediente? Sin preguntarlo, la tarjeta decía
      // "Sin subir" aunque llevara meses cargada.
      const ced = cand?.numero_documento ? String(cand.numero_documento) : null;
      if (!ced || ced === this.cedulaRevisada) return;
      this.cedulaRevisada = ced;
      this.cedulaSubida.set(false);
      this.cedulaDocumentoId.set(null);
      this.docSvc.getDocuments(ced, HiringQuestionsComponent.TIPO_CEDULA)
        .pipe(take(1), takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (r: any) => {
            const lista = Array.isArray(r) ? r : (r?.results ?? []);
            if (lista.length > 0) this.marcarCedula(lista[0]?.id);
            // Se pregunta SIEMPRE, no solo con el tipo vacío: si las caras del
            // formulario son más nuevas que lo que hay, el backend lo rehace; si
            // no, devuelve el vigente sin tocar nada.
            this.armarCedulaAmpliada(ced);
          },
          error: () => { /* si falla, se queda en "sin subir": no se inventa */ },
        });
    });
  }

  /**
   * El formulario pudo dejar las dos caras: ms-documents las une en la hoja
   * ampliada al 150% y la deja en el tipo 29. Cubre a quien llenó el formulario
   * antes de que se armara sola, o a quien tenía un documento más viejo.
   */
  private armarCedulaAmpliada(ced: string): void {
    this.docSvc.armarCedulaAmpliada(ced)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          // Si mientras tanto se abrió otra persona, esta respuesta ya no aplica.
          if (this.cedulaRevisada !== ced || r?.id == null) return;
          this.marcarCedula(r.id);
        },
        error: () => { /* sin caras o sin archivo: sigue "sin subir" */ },
      });
  }

  private marcarCedula(id: unknown): void {
    const n = Number(id);
    this.cedulaDocumentoId.set(Number.isFinite(n) && n > 0 ? n : null);
    this.cedulaSubida.set(true);
  }

  /** Abre el documento de identidad del expediente sin salir de Contratación. */
  verDocumentoIdentidad(): void {
    const id = this.cedulaDocumentoId();
    if (id == null) return;
    const ced = this.cedulaDe() ?? '';
    this.dialog.open<VisorDocumentoComponent, VisorDocumentoData>(VisorDocumentoComponent, {
      width: '960px', maxWidth: '96vw', autoFocus: false,
      data: {
        documentId: id,
        titulo: ced ? `${this.nombreDocumento()} · ${ced}` : this.nombreDocumento(),
        nombreArchivo: `documento_identidad_${ced || id}.pdf`,
      },
    });
  }

  /**
   * Firma manuscrita.
   *
   * Se apoya en el diálogo de cámara NO: es un lienzo propio, porque firmar
   * con el dedo o el ratón es lo que se hace en el mostrador. El PNG sube por
   * el mismo endpoint de biometría que la foto y la huella.
   */
  abrirFirma(): void {
    const cedula = this.cedulaDe();
    if (!cedula) {
      this.alert('info', 'Sin persona', 'Busca primero a la persona para registrar su firma.');
      return;
    }
    this.dialog
      .open(FirmaDialogComponent, {
        width: '640px', maxWidth: '95vw', autoFocus: false,
      })
      .afterClosed()
      .subscribe((file: File | undefined) => {
        if (!file) return;
        this.procesosService.uploadFirma(cedula, file).pipe(take(1)).subscribe({
          next: () => {
            this.alert('success', 'Firma registrada', 'Quedó guardada en el expediente.');
            // El pipeline es quien lee la biometría: sin este aviso la tarjeta
            // seguía diciendo "Sin registrar" con la firma ya guardada.
            this.nav.pedirRefrescoBiometria();
            this.guardado.emit();
          },
          error: (e: any) => this.alert(
            'error', 'No se pudo guardar',
            mensajeDeErrorLog('uploadFirma', e, 'Inténtalo de nuevo.')),
        });
      });
  }

  /** Sube la cédula escaneada al expediente. */
  subirCedula(evento: Event): void {
    const input = evento.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const cedula = this.cedulaDe();
    if (!file || !cedula) return;

    if (file.name.length > 100) {
      this.alert('error', 'Nombre muy largo', 'Máximo 100 caracteres.');
      return;
    }

    this.subiendoCedula.set(true);
    this.docSvc
      .guardarDocumento('Cedula', cedula, HiringQuestionsComponent.TIPO_CEDULA, file,
        undefined, String(this.candidatoSeleccionado()?.tipo_doc || '').trim() || undefined)
      .pipe(take(1))
      .subscribe({
        next: (r: any) => {
          this.subiendoCedula.set(false);
          this.marcarCedula(r?.id);
          this.alert('success', `${this.nombreDocumento()} subido`, 'Quedó en el expediente.');
          this.guardado.emit();
        },
        error: (e: any) => {
          this.subiendoCedula.set(false);
          this.alert('error', 'No se pudo subir',
            mensajeDeErrorLog('subirCedula', e, 'Inténtalo de nuevo.'));
        },
      });
  }

  /** Contacto de la persona, para decir a qué correo / número se está enviando. */
  correoDe(): string | null {
    const c = this.candidatoSeleccionado()?.contacto ?? {};
    return (c.email ?? c.correo_electronico ?? '').toString().trim() || null;
  }

  whatsappDe(): string | null {
    const c = this.candidatoSeleccionado()?.contacto ?? {};
    return (c.whatsapp ?? c.celular ?? '').toString().trim() || null;
  }

  correoConfirmado(): boolean {
    return !!this.candidatoSeleccionado()?.contacto?.correo_confirmado;
  }

  whatsappConfirmado(): boolean {
    return !!this.candidatoSeleccionado()?.contacto?.whatsapp_confirmado;
  }

  /**
   * La cédula con la que actúa este paso.
   *
   * Misma resolución que `cedulaDocs()` —el registro primero, el documento con
   * el que se buscó después—: si el registro trae `numero_documento` vacío,
   * firmar o subir la cédula respondía "busca primero a la persona" con la
   * persona en pantalla.
   */
  private cedulaDe(): string | null {
    return this.cedulaDocs() || null;
  }

  /**
   * Cuánto lleva llenado cada sub-paso de Contratación.
   *
   * Pago y Datos de obra se miden solos desde su formulario. Cédula & Huella no:
   * no es un campo sino dos capturas del lector, la foto, la firma y que el
   * correo y el WhatsApp existan.
   */
  private publicarAvances(): void {
    // `vigilarIdentidad` puede dispararlo antes de `initForms()` si algún día
    // se adelanta el ciclo: sin formularios no hay nada que medir.
    if (!this.pagoTransporteForm) return;
    this.nav.publicar('pago', avanceDeForm(this.pagoTransporteForm));
    this.nav.publicar('obra', avanceDeForm(this.datosObraForm));
    // Referencias y Traslados ya no son pasos de Contratación (2026-09-02): no
    // se publican porque nadie los agrega. Sus formularios siguen vivos y se
    // siguen guardando; lo que se quitó es su peso en el porcentaje del paso.

    // Todo lo que identifica a la persona y permite avisarle: las dos huellas,
    // la foto, la firma, la cédula y que el correo y el WhatsApp EXISTAN. Un
    // contrato con un correo que no existe es un contrato sin forma de avisarle
    // nada a la persona, así que cuenta como pendiente igual que una huella.
    this.nav.publicar('huella', avanceDeBanderas([
      !!this.fingerprintImageApoyo,
      !!this.fingerprintImageTuAlianza,
      !!this.nav.biometria().foto,
      !!this.nav.biometria().firma,
      this.cedulaSubida(),
      this.correoConfirmado(),
      this.whatsappConfirmado(),
    ]));
  }

  /** Último motivo de "sin código de contrato" ya avisado en el guardado automático. */
  private avisoSinCodigo = '';

  /** True cuando la lista de tarjetas YA respondió (aunque venga vacía). */
  private tarjetasCargadas = false;

  private loadTarjetas() {
    this.tarjetasService.list().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res: any) => {
        const items = Array.isArray(res) ? res : (res.results || []);
        this.tarjetasDisponibles = items;
        this.tarjetasCargadas = true;
        // El patch inicial del contrato pudo correr ANTES de que llegara esta
        // lista y quedarse sin validar: re-verificar con la lista real.
        this.verificarTarjeta();
      },
      error: (err) => {
        console.error('[loadTarjetas] Error:', err);
        Swal.fire({ icon: 'warning', title: 'Aviso', text: 'No se pudieron cargar las tarjetas. El campo de tarjeta podría no funcionar correctamente.', confirmButtonText: 'Ok' });
      }
    });
  }

  private _filterTarjetas(value: string | any): any[] {
    const raw = typeof value === 'string' ? value : (value?.identification_number || '');
    const filterValue = raw.toLowerCase();
    
    // Optimización V8: Limitar a 50 resultados para evitar colapso del DOM (mat-option rendering)
    // El FOR loop clásico con Break destruye el bottleneck cuando hay miles de tarjetas
    const matchCount = 50;
    const result = [];
    
    for (const t of this.tarjetasDisponibles) {
      if ((t.identification_number || '').toLowerCase().includes(filterValue) ||
          (t.card_number || '').includes(filterValue)) {
        result.push(t);
        if (result.length >= matchCount) break;
      }
    }
    
    return result;
  }

  private initForms(): void {
    this.pagoTransporteForm = this.fb.group(
      {
        formaPago: ['', Validators.required],
        otraFormaPago: [''],
        numeroPagos: ['', []],
        numeroIdentificacion: ['', []], // Restored field
        contraseniaAsignada: ['', []],
        seguroFunerario: [false, Validators.required],
        // Cuál de los seguros del centro de costo. Obligatorio SOLO cuando el seguro
        // es "SI" y el centro tiene más de uno; lo gobierna `setupSeguroFunerario`.
        seguroFunerarioId: [null],
        Ccostos: ['', Validators.required],
        // Centro de costo que se IMPRIME en el carnet. Puede diferir del
        // Ccostos de nomina (p. ej. la finca donde va a estar la persona),
        // por eso es un campo propio y no obligatorio: si va vacio, el carnet
        // cae al Ccostos.
        carnetCentroCosto: [null],
        salario: [{ value: null, disabled: true }, Validators.required],
        auxilio_transporte: [{ value: null, disabled: true }, Validators.required],
        // Temporal y cargo son datos CANÓNICOS del proceso: la temporal la resuelve el
        // maestro de centros de costo (más fiable que la vacante, ver
        // `prellenarDesdeVacante`) y el cargo es `vacante.cargo`. Se muestran
        // deshabilitados en vez de capturarse para que no puedan divergir de su fuente;
        // ya vivían en el componente (`temporalVacante`, `cargoVacante`) pero sin
        // asomarse a la pantalla. La temporal SÍ se persiste —la columna existe y
        // nadie la escribía—; el cargo no, para no crear una segunda copia del de la
        // vacante.
        temporal: [{ value: null, disabled: true }],
        cargo: [{ value: null, disabled: true }],
        // Espejo de SOLO LECTURA de `datosObraForm.empresaUsuaria`. La ficha de
        // contratación la pide, pero quien la guarda sigue siendo `datosObraPayload()`
        // (clave `empresa_usuaria`): si este control también la mandara habría dos
        // escritores para el mismo campo y ganaría el último en el objeto literal.
        empresaUsuaria: [{ value: null, disabled: true }],
        // Ruta y recargo (V57). Ninguno obligatorio: hay 89.982 contratos históricos
        // sin el dato y volverlos obligatorios bloquearía el guardado de todos ellos.
        usaRuta: [null],
        valorTransporte: [null],
        // OJO: NO es `porcentajeARL`. Aquel es riesgo laboral y se sugiere desde el
        // cargo; este es el recargo pactado de horas extras. Campos y columnas
        // distintas a propósito.
        porcentajeHorasExtras: [null],
        // ── Fuera de la ficha de contratación, pero VIVOS ────────────────────
        // Estos ocho salieron de la pantalla (2026-09-08) porque no están en la
        // ficha que se pidió. NO se borran: la ficha técnica, el carnet, el Excel
        // de ARL y el contrato los imprimen, y casi todos se resuelven solos desde
        // el maestro de centros de costo o desde el cargo. Al conservar el control:
        //   - lo guardado vuelve a cargarse y se re-guarda igual (no se pierde nada),
        //   - el autollenado sigue alimentando los documentos sin pedir nada.
        // Lo que sí se quita es `Validators.required`: un obligatorio que ya no se
        // ve deja el formulario inválido para siempre y nadie podría guardar.
        porcentajeARL: [null],
        cesantias: [null],
        // Sub centro, grupo y los clasificadores 2/3 salen del maestro del
        // centro de costo; cuando el maestro no los trae hay que poder guardar
        // igual, así que van sin Validators.required (el backend los acepta
        // null: `subcentro_de_costos`, `grupo`, `categoria`, `operacion`).
        subCentroCostos: [null],
        // Datos de nomina. Se prellenan desde el centro de costo pero quedan
        // editables; no son obligatorios para no bloquear contrataciones viejas.
        empresaGrupoElite: [null],
        codigoCompania: [null],
        sucursal: [null],
        ciudadLabor: [null],
        sublabor: [null],
        grupo: [null],
        categoria: [null],
        operacion: [null],
        horasExtras: [false, Validators.required],
        fechaIngreso: [null, Validators.required],
        fechaContrato: [null, Validators.required],
      },
      // { validators: this.numbersMatch('numeroPagos', 'validacionNumeroCuenta') },
    );

    this.referenciasForm = this.fb.group({
      familiar1: [''],
      familiar2: [''],
      personal1: [''],
      personal2: [''],
      laboral1: [''],
      laboral2: [''],
    });

    this.trasladosForm = this.fb.group({
      opcion_traslado_eps: ['NO', Validators.required],
      eps_a_trasladar: [''],
      traslado: [''],
    });

    this.huellaForm = this.fb.group({
      consentimientoHuella: [false],
      versionConsentimiento: [this.VERSION_CONSENTIMIENTO_HUELLA],
      timestampConsentimiento: [''],
      consentimientoHash: [''],
      imageHash: [''],
      userAgent: [''],
    });

    // Datos de obra/empresa para documentos: opcionales, se prellenan desde la
    // vacante en loadData() y se guardan en el contrato.
    this.datosObraForm = this.fb.group({
      empresaUsuaria: [''],
      centroCosto: [''],
      direccion: [''],
      descripcionObra: [''],
    });

    // La empresa usuaria se captura una sola vez (en Datos de obra) y se refleja en
    // la ficha de contratación. Un espejo y no una copia editable: dos casillas que
    // escriben el mismo campo acaban divergiendo.
    this.datosObraForm.get('empresaUsuaria')!.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(v => this.pagoTransporteForm.get('empresaUsuaria')?.setValue(v ?? null,
        { emitEvent: false }));
  }

  // ───────── Seguro funerario ─────────
  /**
   * Seguros que aplican al centro de costo actual, ya filtrados por `asignada`.
   *
   * `db_admin` los parametriza por centro (`centro_costo_seguro_funerario`): hoy 184
   * centros tienen uno y 2 tienen los dos, con importes muy distintos (ordinario
   * $4.750 · especial $13.169). Con uno solo se resuelve solo; con dos NO se puede
   * elegir por la persona —es plata que se le descuenta— y lo decide quien contrata.
   */
  segurosDelCentro: Array<{ id: number; nombre: string; valor: number; periodicidad: string }> = [];

  /** Centro de costo (id numérico) para el que se cargaron los seguros. */
  private centroCostoIdSeguros: number | null = null;

  /** El centro tiene varios seguros: hay que elegir. */
  get seguroRequiereEleccion(): boolean {
    return this.segurosDelCentro.length > 1;
  }

  /**
   * Importe guardado en el contrato, si lo hay.
   *
   * Manda sobre el del catálogo: el parametrizador puede cambiar el valor de un
   * seguro y eso afecta a todos los centros, pero lo que se le descuenta a alguien
   * ya contratado es lo que se firmó, no lo que valga hoy.
   */
  private seguroValorGuardado: number | null = null;

  /** Importe a mostrar y a guardar. `null` mientras no haya seguro resuelto. */
  get valorSeguro(): number | null {
    const sel = this.seguroSeleccionado;
    if (sel) return sel.valor;
    return this.seguroValorGuardado;
  }

  /** El seguro elegido (o el único que hay). `null` si aún no se resolvió. */
  get seguroSeleccionado(): { id: number; nombre: string; valor: number; periodicidad: string } | null {
    if (!this.segurosDelCentro.length) return null;
    if (this.segurosDelCentro.length === 1) return this.segurosDelCentro[0];
    const id = this.pagoTransporteForm?.get('seguroFunerarioId')?.value;
    return this.segurosDelCentro.find(s => s.id === id) ?? null;
  }

  /** Se muestra el bloque del valor: solo con el seguro en "SI". */
  get mostrarValorSeguro(): boolean {
    return this.pagoTransporteForm?.get('seguroFunerario')?.value === true;
  }

  /**
   * Carga los seguros del centro de costo y deja el formulario coherente.
   *
   * Se llama al resolver el centro (autollenado y prellenado desde la vacante) y al
   * cambiar el switch del seguro. Es idempotente por `centroCostoId` para no repetir
   * la consulta en cada ciclo.
   */
  private async cargarSegurosDelCentro(centroCostoId: number | null | undefined): Promise<void> {
    const id = Number(centroCostoId);
    if (!Number.isFinite(id) || id <= 0) return;
    if (this.centroCostoIdSeguros === id) return;

    const ctx = this._loadCtx;
    try {
      const filas = await firstValueFrom(this.parametrizacion.segurosDeCentro(id));
      // Llegó tarde: es el centro de costo de otro candidato.
      if (ctx !== this._loadCtx) return;
      // El endpoint devuelve TODOS los seguros activos marcando cuáles tiene el
      // centro; sin filtrar por `asignada` se ofrecerían seguros que no le aplican.
      this.segurosDelCentro = (filas || [])
        .filter((f: any) => f?.asignada === true)
        .map((f: any) => ({
          id: Number(f.seguro_funerario_id),
          nombre: String(f.nombre ?? ''),
          valor: Number(f.valor ?? 0),
          periodicidad: String(f.periodicidad ?? ''),
        }));
      this.centroCostoIdSeguros = id;
      this.sincronizarSeguroFunerario();
    } catch (e) {
      // Es una ayuda: sin seguros parametrizados el campo queda vacío y se sigue
      // pudiendo guardar. No se bloquea una contratación por esto.
      console.warn('[seguro funerario] no se pudieron cargar los del centro', e);
    }
  }

  /**
   * Deja `seguroFunerarioId` coherente con lo que hay disponible.
   *
   * Con un único seguro se fija solo (no hay nada que elegir). Con varios se respeta
   * lo ya guardado y solo se limpia si apunta a uno que este centro no tiene —pasa al
   * cambiar de finca—, porque si no se guardaría el importe de otro centro de costo.
   */
  private sincronizarSeguroFunerario(): void {
    const ctrl = this.pagoTransporteForm?.get('seguroFunerarioId');
    if (!ctrl) return;

    if (this.segurosDelCentro.length === 1) {
      ctrl.setValue(this.segurosDelCentro[0].id, { emitEvent: false });
    } else if (this.segurosDelCentro.length > 1) {
      const actual = ctrl.value;
      if (actual != null && !this.segurosDelCentro.some(s => s.id === actual)) {
        ctrl.setValue(null, { emitEvent: false });
      }
    }

    // Obligatorio solo cuando de verdad hay que elegir. Un obligatorio que no se ve
    // —seguro en "NO", o centro con un único seguro— dejaría el formulario inválido.
    const exige = this.mostrarValorSeguro && this.seguroRequiereEleccion;
    ctrl.setValidators(exige ? [Validators.required] : []);
    ctrl.updateValueAndValidity({ emitEvent: false });
  }

  /** El switch SI/NO del seguro cambió. */
  onSeguroFunerarioChange(): void {
    this.sincronizarSeguroFunerario();
  }

  // ───────── Completitud visual (verde) ─────────
  /**
   * Cuándo APLICA cada campo condicional. Fuera de aquí todos aplican siempre.
   *
   * Un campo que no aplica nunca se pinta —ni verde ni rojo—: no está pendiente,
   * es que no existe en este estado del formulario. Las condiciones son las mismas
   * que decide `setupFormaPagoValidation` y las que ocultan el campo en el HTML;
   * se escriben una sola vez aquí para que no puedan discrepar.
   */
  private aplicaCampo(nombre: string): boolean {
    const forma = String(this.pagoTransporteForm?.get('formaPago')?.value ?? '').trim();
    switch (nombre) {
      case 'otraFormaPago':
        return forma === 'Otra';
      // Daviplata no pide tarjeta ni contraseña: el HTML los oculta.
      case 'numeroIdentificacion':
      case 'contraseniaAsignada':
        return !!forma && forma !== 'Daviplata';
      // El valor solo tiene sentido si la persona usa la ruta. Con "NO" o sin
      // responder no cuenta como pendiente.
      case 'valorTransporte':
        return this.pagoTransporteForm?.get('usaRuta')?.value === true;
      default:
        return true;
    }
  }

  /** Reglas de validez propias del dato, más allá de los `Validators` del control. */
  private static readonly VALIDEZ_CAMPO: Record<string, (v: unknown) => boolean> = {
    salario: esImporteValido,
    valorTransporte: esImporteValido,
    porcentajeARL: esPorcentajeValido,
    porcentajeHorasExtras: esPorcentajeValido,
  };

  /**
   * Estado de completitud de un campo de "Pago y Transporte".
   *
   * Se calcula en cada ciclo de detección de cambios en vez de cachearse: depende
   * también de `touched`, que cambia en el blur sin tocar el valor, así que un caché
   * alimentado por `valueChanges` se quedaría desfasado justo al salir del campo.
   * El cálculo es una comparación por campo y la plantilla ya consulta el formulario
   * bastante más que eso.
   */
  estadoCampo(nombre: string): EstadoCampo {
    if (!this.pagoTransporteForm) return 'normal';
    return estadoDeControl(this.pagoTransporteForm.get(nombre), {
      aplica: this.aplicaCampo(nombre),
      valido: HiringQuestionsComponent.VALIDEZ_CAMPO[nombre],
    });
  }

  /** Atajo para la plantilla: `[class.campo-completo]="campoCompleto('grupo')"`. */
  campoCompleto(nombre: string): boolean {
    return this.estadoCampo(nombre) === 'completo';
  }

  // === Validador de coincidencia ===
  // === Validador de coincidencia (YA NO SE USA, PERO SE DEJA O SE BORRA) ===
  // numbersMatch(...) { ... }

  // === Reglas dinámicas según forma de pago (CO) ===
  // === Reglas dinámicas según forma de pago (CO) ===
  private setupFormaPagoValidation() {
    const formaCtrl = this.pagoTransporteForm.get('formaPago')!;
    const numCtrl = this.pagoTransporteForm.get('numeroPagos')!;
    const idCtrl = this.pagoTransporteForm.get('numeroIdentificacion');
    const passCtrl = this.pagoTransporteForm.get('contraseniaAsignada');

    // Daviplata: solo obligatorio
    const phoneCO = /^3\d{9}$/;

    const apply = () => {
      const forma = formaCtrl.value;
      numCtrl.clearValidators();
      if (idCtrl) idCtrl.clearValidators();
      if (passCtrl) passCtrl.clearValidators();

      if (forma === 'Daviplata') {
        // Daviplata => "Número de cuenta"
        numCtrl.setValidators([Validators.required]); // O pattern phoneCO
      } else if (forma) {
        // Otros => Tarjeta. Sin `pattern`: el número de cuenta es TEXTO libre.
        // El patrón de 16-18 dígitos rechazaba cuentas que no son tarjeta (bancos
        // que no usan ese formato) y era la única razón por la que este campo no
        // aceptaba texto. La comprobación contra el maestro de tarjetas sigue
        // viva —`verificarTarjeta`— y es la que de verdad protege el pago.
        numCtrl.setValidators([Validators.required]);
        // La identificación de la tarjeta y la contraseña salieron de la pantalla:
        // exigirlas dejaría el formulario inválido sin casilla donde responder. El
        // cruce contra el maestro de tarjetas (`verificarTarjeta`) sigue activo para
        // los contratos que ya las tienen.
      }

      numCtrl.updateValueAndValidity({ emitEvent: false });
      if (idCtrl) idCtrl.updateValueAndValidity({ emitEvent: false });
      if (passCtrl) passCtrl.updateValueAndValidity({ emitEvent: false });
    };

    apply();
    formaCtrl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(apply);

    // Validación extra: verificar si la tarjeta existe
    // Escuchar cambios en numeroPagos + numeroIdentificacion
    if (idCtrl) {
      numCtrl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => this.verificarTarjeta(),
        error: (err) => console.error('💥 numCtrl.valueChanges subscription crashed:', err),
      });
      idCtrl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => this.verificarTarjeta(),
        error: (err) => console.error('💥 idCtrl.valueChanges subscription crashed:', err),
      });
    }
  }

  // Verificar existencia de tarjeta (local, sin API call)
  verificarTarjeta() {
    try {
      const forma = this.pagoTransporteForm.get('formaPago')?.value;
      console.log('[verificarTarjeta] forma:', forma);
      if (forma === 'Daviplata' || !forma) return;

      const numCtrl = this.pagoTransporteForm.get('numeroPagos')!;
      const numRaw = numCtrl.value;
      const num = (typeof numRaw === 'string' ? numRaw : '').trim();

      const idRaw = this.pagoTransporteForm.get('numeroIdentificacion')?.value;
      const id = (typeof idRaw === 'string' ? idRaw : (idRaw?.identification_number || '')).trim();

      // Si faltan datos o no cumplen longitud mínima, limpiamos los errores custom y salimos
      if (!num || num.length < 16 || !id) {
        this._clearCustomError(numCtrl, 'tarjetaInexistente');
        this._clearCustomError(numCtrl, 'noCoincide');
        return;
      }

      // Mientras la lista no haya llegado no se puede afirmar que la tarjeta no
      // exista: el patch del contrato guardado corría antes que la respuesta y
      // dejaba `tarjetaInexistente` sobre datos correctos, bloqueando el
      // guardado hasta re-editar el campo a mano. loadTarjetas re-verifica al
      // llegar la lista.
      if (!this.tarjetasCargadas) return;

      // Buscar tarjetas que coincidan con la identificación
      const tarjetasDelId = this.tarjetasDisponibles.filter(
        t => (t.identification_number || '').trim() === id
      );

      if (tarjetasDelId.length === 0) {
        this._setCustomError(numCtrl, 'tarjetaInexistente');
        this._clearCustomError(numCtrl, 'noCoincide');
        return;
      }

      const coincide = tarjetasDelId.some(
        t => (t.card_number || '').trim() === num
      );

      if (!coincide) {
        this._clearCustomError(numCtrl, 'tarjetaInexistente');
        this._setCustomError(numCtrl, 'noCoincide');
      } else {
        this._clearCustomError(numCtrl, 'tarjetaInexistente');
        this._clearCustomError(numCtrl, 'noCoincide');
      }
    } catch (err) {
      console.error('💥 verificarTarjeta crashed:', err);
    }
  }

  /** Cuando el usuario selecciona una tarjeta del autocomplete, verifica que numeroPagos coincida */
  onTarjetaSelected(tarjeta: any): void {
    // Guardamos solo el identification_number como valor del control
    if (tarjeta?.identification_number) {
      this.pagoTransporteForm.get('numeroIdentificacion')?.setValue(tarjeta.identification_number, { emitEvent: false });
    }
    // Disparamos la verificación cruzada con lo que el usuario ya escribió en numeroPagos
    this.verificarTarjeta();
  }

  /** displayWith del autocomplete: muestra el identification_number en el input */
  displayTarjeta(value: any): string {
    if (!value) return '';
    return typeof value === 'string' ? value : (value.identification_number || '');
  }

  // Helpers para manejar errores custom sin borrar los validators nativos (required, pattern)
  private _setCustomError(ctrl: AbstractControl, errorKey: string): void {
    const existing = ctrl.errors || {};
    ctrl.setErrors({ ...existing, [errorKey]: true });
  }

  private _clearCustomError(ctrl: AbstractControl, errorKey: string): void {
    if (!ctrl.errors || !ctrl.errors[errorKey]) return;
    const { [errorKey]: _, ...rest } = ctrl.errors;
    ctrl.setErrors(Object.keys(rest).length ? rest : null);
  }

  // (Opcional) Limpia caracteres no numéricos al teclear/pegar
  digitsOnly(controlName: string, e: Event) {
    const ctrl = this.pagoTransporteForm.get(controlName);
    const el = e.target as HTMLInputElement | null;
    if (!ctrl || !el) return;
    const cleaned = el.value.replace(/\D+/g, '');
    if (el.value !== cleaned) {
      ctrl.setValue(cleaned, { emitEvent: true });
    }
  }

  // ───────── Acciones principales ─────────
  /**
   * Guarda "Pago y Transporte".
   *
   * `silencioso` es el guardado automático (sin botón): no abre avisos, lanza
   * si falla para que el indicador lo muestre, y con el formulario A MEDIAS
   * guarda lo respondido sin marcar contratado ni pedir código de contrato.
   * Eso solo pasa cuando está completo, igual que hacía el antiguo "Cargar".
   */
  async cargarPagoTransporte(opts: { silencioso?: boolean } = {}): Promise<void> {
    const silencioso = !!opts.silencioso;
    if (silencioso ? this.bloqueado() : this.bloqueadoPorEspera()) return;
    const completo = this.pagoTransporteForm.valid;
    if (!completo && !silencioso) {
      this.pagoTransporteForm.markAllAsTouched();
      return this.alert('warning', 'Formulario incompleto', 'Revisa los campos obligatorios.');
    }

    const cand = this.candidatoSeleccionado();
    if (!cand?.numero_documento) {
      if (silencioso) throw new Error('No hay candidato seleccionado.');
      return this.alert('info', 'Sin cédula', 'No hay candidato seleccionado.');
    }

    const ent0 = Array.isArray(cand?.entrevistas) ? cand.entrevistas[0] : null;
    const proc = ent0?.proceso || null;
    if (!proc) {
      if (silencioso) throw new Error('La última entrevista no tiene proceso asociado.');
      return this.alert('info', 'Sin proceso', 'La última entrevista no tiene proceso asociado.');
    }

    const contr = proc?.contrato || null;
    const codigoContrato: string | null =
      (proc?.contrato_codigo as string) || (contr?.codigo_contrato as string) || null;

    const v = this.pagoTransporteForm.getRawValue(); // getRawValue incluye disabled fields (salario, auxilio_transporte)
    // Acepta coma decimal ("0,522"): con Number() a secas daba NaN, que el
    // serializador de HTTP convertía en null y el %ARL se perdía con Swal de
    // éxito incluido.
    const toNum = (x: any) => {
      if (x === '' || x == null) return null;
      const n = Number(String(x).trim().replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    };

    const payload: ProcesoUpdateByDocumentRequest & {
      contratado?: boolean;
      contrato?: { sede_abbr?: string; generar_codigo: boolean };
      contrato_detalle: {
        forma_de_pago?: string | null;
        numero_para_pagos?: string | null;
        identification_number_tarjeta?: string | null;
        contrasenia_asignada?: string | null;
        seguro_funerario?: boolean | null;
        /** Cuál de los seguros del centro se eligió. */
        seguro_funerario_id?: number | null;
        /** Importe con el que se firmó, copiado del catálogo (V58). */
        seguro_funerario_valor?: number | null;
        Ccentro_de_costos?: string | null;
        /** Centro de costo que se imprime en el carnet (puede diferir del de nómina). */
        carnet_centro_costo?: string | null;
        porcentaje_arl?: number | null;
        cesantias?: string | null;
        subcentro_de_costos?: string | null;
        empresa_grupo_elite?: string | null;
        codigo_compania?: string | null;
        sucursal?: string | null;
        ciudad_labor?: string | null;
        sublabor?: string | null;
        grupo?: string | null;
        categoria?: string | null;
        operacion?: string | null;
        horas_extras?: boolean | null;
        /** Temporal (TA/AL). Columna vieja que hasta ahora nadie escribía desde aquí. */
        temporal?: string | null;
        /** Decisión de ESTA persona; el centro de costo solo da el valor por defecto. */
        usa_ruta?: boolean | null;
        /** Lo que se reconoce por la ruta. NO es el auxilio legal de transporte. */
        valor_transporte?: number | null;
        /** Recargo de horas extras. Independiente de `porcentaje_arl`. */
        porcentaje_horas_extras?: number | null;
        fecha_ingreso?: string | null;
        fecha_contrato?: string | null;
        /** Datos de obra: van en el mismo guardado, ver más abajo. */
        descripcion_de_obra?: string | null;
        centro_costo_obra?: string | null;
        direccion_empresa?: string | null;
        empresa_usuaria?: string | null;
      };
    } = {
      numero_documento: String(cand.numero_documento),
      // Completo: contratado + código de contrato. El backend es idempotente:
      // si ya hay código lo devuelve sin tocarlo (incluida la edición forzada) y
      // solo genera cuando el contrato está sin código. A medias (guardado
      // automático) solo se escriben las respuestas.
      ...(completo ? {
        contratado: true,
        contrato: { sede_abbr: ent0?.oficina || undefined, generar_codigo: true },
      } : {}),
      contrato_detalle: {
        // "Otra" guarda el TEXTO que escribió el usuario (mismo campo del
        // backend): antes `otraFormaPago` se pedía en pantalla y se descartaba,
        // quedando solo el literal "Otra" sin saber cuál era.
        forma_de_pago: v.formaPago === 'Otra' && String(v.otraFormaPago ?? '').trim()
          ? String(v.otraFormaPago).trim()
          : (v.formaPago ?? null),
        numero_para_pagos: v.numeroPagos ?? null,
        identification_number_tarjeta: v.numeroIdentificacion ?? null,
        contrasenia_asignada: v.contraseniaAsignada ?? null,
        seguro_funerario: !!v.seguroFunerario,
        // Con el seguro en "NO" van los dos en null: dejar el importe de un "SI"
        // anterior sería seguir descontando algo que ya no aplica.
        seguro_funerario_id: v.seguroFunerario ? (this.seguroSeleccionado?.id ?? null) : null,
        seguro_funerario_valor: v.seguroFunerario ? this.valorSeguro : null,
        Ccentro_de_costos: v.Ccostos ?? null,
        carnet_centro_costo: v.carnetCentroCosto ?? null,
        porcentaje_arl: toNum(v.porcentajeARL),
        cesantias: v.cesantias ?? null,
        subcentro_de_costos: v.subCentroCostos ?? null,
        empresa_grupo_elite: v.empresaGrupoElite ?? null,
        codigo_compania: v.codigoCompania ?? null,
        sucursal: v.sucursal ?? null,
        ciudad_labor: v.ciudadLabor ?? null,
        sublabor: v.sublabor ?? null,
        grupo: v.grupo ?? null,
        categoria: v.categoria ?? null,
        operacion: v.operacion ?? null,
        horas_extras: !!v.horasExtras,
        // `getRawValue()` incluye los deshabilitados, así que la temporal resuelta viaja
        // aunque el campo no se pueda editar. Se manda solo si tiene valor: `applyStr`
        // del backend ignora los null, pero mandar "" borraría el dato de un contrato
        // histórico que sí lo tiene.
        ...(String(v.temporal ?? '').trim() ? { temporal: String(v.temporal).trim() } : {}),
        // `usa_ruta` viaja SIEMPRE (incluido null) porque el backend mira `containsKey`:
        // así "no respondido" se puede volver a dejar en blanco. Sin ternario a `false`:
        // eso afirmaría que no usa ruta cuando lo cierto es que nadie lo preguntó.
        usa_ruta: v.usaRuta === null || v.usaRuta === undefined || v.usaRuta === '' ? null : !!v.usaRuta,
        valor_transporte: toNum(v.valorTransporte),
        porcentaje_horas_extras: toNum(v.porcentajeHorasExtras),
        fecha_ingreso: v.fechaIngreso ? new Date(v.fechaIngreso).toISOString().split('T')[0] : null,
        fecha_contrato: v.fechaContrato ? new Date(v.fechaContrato).toISOString().split('T')[0] : null,
        // Los datos de obra viajan en el MISMO guardado. Antes solo los
        // persistía el botón aparte de la pestaña "Datos de obra", así que la
        // descripción que se propone sola al fijar la fecha de ingreso se
        // quedaba en pantalla y los documentos salían con la de la vacante.
        ...this.datosObraPayload(),
      },
    };

    if (silencioso) {
      const resp = await firstValueFrom(
        this.procesosService.updateProcesoByDocumento(this.conDestino(payload), 'PATCH'),
      );
      this.pagoTransporteForm.markAsPristine();
      const proc0 = (resp as any)?.proceso;
      const codigoFinal = String(proc0?.contrato_codigo ?? codigoContrato ?? '').trim();
      const motivo = String(proc0?.contrato_codigo_motivo ?? '').trim();
      if (completo && !codigoFinal && motivo && this.avisoSinCodigo !== motivo) {
        // Una vez por motivo: repetirlo en cada campo sería ruido.
        this.avisoSinCodigo = motivo;
        void Swal.fire({
          icon: 'warning', toast: true, position: 'top-end', showConfirmButton: false,
          timer: 6000, timerProgressBar: true,
          title: 'Guardado sin código de contrato',
          text: motivo === 'rango_agotado'
            ? 'El rango de números de esta oficina se agotó. Avisa a sistemas.'
            : 'La oficina no tiene rango de numeración. Avisa a sistemas.',
        });
      }
      this.guardado.emit();
      return;
    }

    try {
      const resp = await firstValueFrom(
        this.procesosService.updateProcesoByDocumento(this.conDestino(payload), 'PATCH'),
      );
      const proc0 = (resp as any)?.proceso;
      const codigoFinal = String(proc0?.contrato_codigo ?? codigoContrato ?? '').trim();
      const motivo = String(proc0?.contrato_codigo_motivo ?? '').trim();
      if (!codigoFinal && motivo) {
        // El guardado sí quedó; lo que falló fue asignar el número. Se avisa en
        // vez de dejarlo mudo: 'sin_oficina' = la sede no tiene rango asignado,
        // 'rango_agotado' = se acabaron los 10.000 números de esa oficina.
        // Se ESPERA el Ok antes de emitir: la recarga que dispara `guardado`
        // abre el Swal de "Cargando…", que reemplazaría este aviso a los
        // pocos ms y el operador nunca sabría que el contrato quedó sin código.
        await Swal.fire({
          icon: 'warning',
          title: 'Guardado sin código de contrato',
          text: motivo === 'rango_agotado'
            ? 'Se guardó, pero el rango de números de esta oficina se agotó. Avisa a sistemas para asignar un rango nuevo.'
            : 'Se guardó, pero no se pudo asignar el código porque la oficina no tiene rango de numeración. Avisa a sistemas.',
          confirmButtonText: 'Ok',
        });
      } else {
        this.alert(
          'success',
          'Guardado',
          `Contrato ${codigoFinal ? `(${codigoFinal}) ` : ''}actualizado y proceso marcado como contratado.`,
        );
      }
      this.guardado.emit();
    } catch (e: any) {
      console.error('[cargarPagoTransporte] Error:', e);
      const body = e?.error;
      let msg = '';
      if (body?.detail) {
        msg = body.detail;
      } else if (body && typeof body === 'object') {
        // Intentar extraer errores de validación de DRF
        const entries = Object.entries(body)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
          .join('\n');
        msg = entries || 'No se pudo guardar la información.';
      } else {
        msg = e?.message || 'No se pudo guardar la información. Verifique su conexión e intente de nuevo.';
      }
      this.alert('error', 'Error al guardar', msg);
    }
  }

  // ───────── Archivos: subir / ver / descargar ─────────
  subirArchivo(evt: Event, campo: string): void {
    const input = evt.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (file.name.length > 100) {
      this.alert('error', 'Nombre muy largo', 'Máximo 100 caracteres.');
      input.value = ''; return;
    }
    this.uploadedFiles[campo] = { file, fileName: file.name };
    (this.referenciasForm.get(campo) || this.trasladosForm.get(campo))?.setValue(file.name);
    input.value = '';
    void this.guardarArchivo(campo);
  }

  /** Archivos subiéndose ahora mismo, para bloquear su casilla. */
  readonly subiendoArchivo = signal<ReadonlySet<string>>(new Set<string>());

  estaSubiendo(campo: string): boolean {
    return this.subiendoArchivo().has(campo);
  }

  /**
   * Guarda el archivo EN CUANTO se elige.
   *
   * Antes se quedaba en pantalla hasta que alguien se acordara de pulsar
   * "Cargar": cambiar de persona, recargar o simplemente irse a otra pestaña
   * lo perdía sin decir nada, y el expediente quedaba a medias sin que nadie
   * lo notara. Ahora el botón sobra: elegir el PDF ES guardarlo.
   */
  private async guardarArchivo(campo: string): Promise<void> {
    const ced = this.cedulaDe();
    if (!ced) {
      this.alert('info', 'Sin persona', 'Busca primero a la persona para guardar el documento.');
      return;
    }
    this.subiendoArchivo.update((s) => new Set(s).add(campo));
    try {
      const { uploaded, failed } = await this.uploadChanged([campo], false);
      if (failed.length) {
        this.alert('error', 'No se pudo guardar', failed[0].error);
        return;
      }
      if (uploaded.length) {
        this.toast(`${this.uploadedFiles[campo]?.fileName ?? 'Documento'} guardado`);
        // El expediente cambió: el módulo Documentos y el resto del pipeline
        // tienen que releerlo.
        this.docSvc.invalidarDocumentos(ced);
        this.guardado.emit();
      }
    } catch (err: any) {
      this.alert('error', 'No se pudo guardar',
        mensajeDeErrorLog('hiring/subir-archivo', err, 'Inténtalo de nuevo.'));
    } finally {
      this.subiendoArchivo.update((s) => {
        const n = new Set(s);
        n.delete(campo);
        return n;
      });
    }
  }

  /** Aviso corto que no tapa la pantalla: son varios documentos seguidos. */
  private toast(titulo: string): void {
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: titulo,
      showConfirmButton: false,
      timer: 2200,
      timerProgressBar: true,
    });
  }

  /**
   * Genera el formato de verificación de referencias para un slot
   * ('familiar1' | 'familiar2' | 'personal1' | 'personal2').
   *
   * Queda en `uploadedFiles` y se guarda sola, igual que un PDF adjuntado a
   * mano. Solo aplica a referencias personales y
   * familiares; las laborales llevan otro formato.
   */
  async generarReferencia(campo: string): Promise<void> {
    const m = /^(familiar|personal)([12])$/.exec(campo);
    if (!m) return;
    const tipo = m[1].toUpperCase();      // FAMILIAR | PERSONAL
    const slot = Number(m[2]);

    const cand: any = this.candidatoSeleccionado();
    if (!cand?.numero_documento) {
      return this.alert('info', 'Sin candidato', 'Selecciona un candidato primero.');
    }

    // La tabla guarda el tipo con y sin sufijo ('PERSONAL' y 'PERSONAL1'); se
    // aceptan ambos y, cuando hay varias del mismo tipo, se ordenan por id.
    const todas: any[] = Array.isArray(cand?.referencias) ? [...cand.referencias] : [];
    const delTipo = todas
      .filter(r => String(r?.tipo ?? '').toUpperCase().startsWith(tipo))
      .sort((a, b) => (Number(a?.id) || 0) - (Number(b?.id) || 0));
    const exacta = delTipo.find(r => String(r?.tipo ?? '').toUpperCase() === `${tipo}${slot}`);
    const ref = exacta ?? delTipo[slot - 1];

    if (!ref) {
      return this.alert(
        'info', 'Sin datos de la referencia',
        `El candidato no tiene registrada la referencia ${tipo.toLowerCase()} ${slot}.`,
      );
    }

    const nombreCand = [cand.primer_nombre, cand.segundo_nombre, cand.primer_apellido, cand.segundo_apellido]
      .map((x: any) => String(x ?? '').trim()).filter(Boolean).join(' ').toUpperCase();
    const hoy = new Date();
    const fecha = `${String(hoy.getDate()).padStart(2, '0')}/${String(hoy.getMonth() + 1).padStart(2, '0')}/${hoy.getFullYear()}`;

    const { buildCartaReferenciaPdf } = await import('./referencias-fill');
    const blob = buildCartaReferenciaPdf({
      candidatoNombre: nombreCand,
      ciudad: String(cand?.municipio ?? ''),
      fecha,
      referencia: {
        tipo,
        slot,
        nombre: String(ref.nombre ?? ''),
        parentesco: String(ref.parentesco ?? ''),
        telefono: String(ref.telefono ?? ''),
        ocupacion: String(ref.ocupacion ?? ''),
      },
    });

    const fileName = `Referencia-${tipo}${slot}-${cand.numero_documento}.pdf`;
    const file = new File([blob], fileName, { type: 'application/pdf' });
    this.uploadedFiles[campo] = { file, fileName };
    this.referenciasForm.get(campo)?.setValue(fileName);
    // Se guarda solo, igual que un PDF adjuntado a mano: generar y que quede
    // esperando un botón era la forma de perderlo.
    await this.guardarArchivo(campo);
  }

  /**
   * Prellena los datos de nómina desde el centro de costo digitado.
   *
   * `CentroCosto` ya guarda empresa, ciudad y sublabor; se copian solo a los
   * campos vacíos para no pisar un ajuste manual.
   *
   * `GET /gestion_centros_costos/` responde con las claves "tal cual el Excel"
   * ("Ccostos", "Empresa " con espacio, "Categoría" con tilde), no en
   * snake_case como `/resolver/`. Antes se leían en minúscula y salían todas
   * `undefined`, así que este autollenado no hacía nada; `campo()` acepta las
   * dos formas para que sirva con cualquiera de los dos endpoints.
   */
  async autollenarDesdeCentroCosto(): Promise<void> {
    const cc = String(this.pagoTransporteForm.get('Ccostos')?.value ?? '').trim();
    if (!cc) return;

    const campo = (fila: Record<string, any>, ...claves: string[]): string => {
      for (const k of claves) {
        const v = fila?.[k];
        if (v != null && String(v).trim() !== '') return String(v).trim();
      }
      return '';
    };

    // Si el centro de costo cambió respecto al que generó el llenado anterior,
    // los valores que hay son de OTRA finca y hay que reemplazarlos: dejarlos
    // mandaría a la persona al centro de costo equivocado, y eso va a nómina.
    // Mientras sea el mismo, solo se rellenan huecos y no se pisa nada a mano.
    const cambioDeFinca =
      this.ccostosAutollenado !== '' && this.ccostosAutollenado !== cc.toUpperCase();

    try {
      const ctx = this._loadCtx;
      const filas = await firstValueFrom(this.farmsService.list(cc));
      // El candidato pudo cambiar mientras respondía la finca: escribir acá
      // llenaría el formulario del nuevo con la finca del anterior.
      if (ctx !== this._loadCtx) return;
      // Coincidencia exacta por Ccostos; si no, la primera del resultado.
      const norm = (v: any) => String(v ?? '').trim().toUpperCase();
      const fila = (filas || []).find(f => norm(campo(f, 'Ccostos', 'ccostos')) === norm(cc))
        ?? (filas || [])[0];
      if (!fila) return;

      const poner = (control: string, valor: string) => {
        const c = this.pagoTransporteForm.get(control);
        if (!c) return;
        const actual = String(c.value ?? '').trim();
        if (cambioDeFinca) {
          if (valor !== actual) c.setValue(valor);
        } else if (!actual && valor) {
          c.setValue(valor);
        }
      };

      const empresa = campo(fila, 'Empresa ', 'Empresa', 'empresa');
      const centroCosto = campo(fila, 'Centro de costo', 'centro_de_costo');
      const temporal = campo(fila, 'Temporal', 'temporal');

      poner('empresaGrupoElite', empresa);
      poner('ciudadLabor', campo(fila, 'Ciudad', 'ciudad'));
      poner('sublabor', campo(fila, 'Sublabor', 'sublabor'));
      poner('subCentroCostos', campo(fila, 'Subcentro', 'subcentro'));
      poner('grupo', campo(fila, 'Grupo', 'grupo'));
      poner('categoria', campo(fila, 'Categoría', 'categoria'));
      poner('operacion', campo(fila, 'Operación', 'operacion'));
      // Sucursal = "Centro de costo Para el Carné" (FICHA V12!I95).
      poner('sucursal', centroCosto);
      poner('carnetCentroCosto', centroCosto);
      poner('codigoCompania', resolverCodigoCompania(empresa));
      // La temporal del maestro, que es la fiable (hay fincas homónimas en dos
      // temporales: SAN CARLOS está en Apoyo y en Tu Alianza).
      poner('temporal', temporal);
      // Valor del transporte de ESTA finca. Es un importe, no texto: `campo()` no
      // sirve porque devuelve '' y borraría un 0 legítimo.
      const valorFinca = fila?.['valor_transporte'];
      const valorCtrl = this.pagoTransporteForm.get('valorTransporte');
      if (valorCtrl && valorFinca != null) {
        const actual = String(valorCtrl.value ?? '').trim();
        if (cambioDeFinca || !actual) valorCtrl.setValue(valorFinca);
      }
      // "¿Usa ruta?" arranca en lo que dice el maestro para esa finca, pero es una
      // decisión por persona: si ya está respondida solo se repropone al cambiar de
      // finca, porque la ruta de la finca anterior no dice nada de la nueva.
      const rutaFinca = fila?.['ruta'];
      const rutaCtrl = this.pagoTransporteForm.get('usaRuta');
      if (rutaCtrl && typeof rutaFinca === 'boolean') {
        if (cambioDeFinca || rutaCtrl.value === null) rutaCtrl.setValue(rutaFinca);
      }

      this.ccostosAutollenado = cc.toUpperCase();

      // Los seguros funerarios son del CENTRO, así que se recargan con él. `fila.id`
      // es el id numérico de `centros_costos`, que es lo que pide la parametrización.
      if (cambioDeFinca) this.centroCostoIdSeguros = null;   // forzar recarga
      this.cargarSegurosDelCentro(fila?.['id']).catch(() => { /* ya se avisa dentro */ });

      // Cambiar de finca puede cambiar la empresa usuaria Y la temporal, y con
      // ellas el juego de labores (Apoyo, Elite Blu y Tu Alianza tienen hojas
      // distintas), así que la obra se repropone.
      //
      // La temporal hay que releerla del maestro, no dejar la de la vacante:
      // hay fincas con el mismo nombre en las dos temporales (SAN CARLOS está
      // en Apoyo y en Tu Alianza) y sin esto la obra seguía saliendo de la hoja
      // de la finca anterior.
      if (cambioDeFinca && (empresa || temporal)) {
        if (empresa) {
          this.empresaVacante = empresa;
          this.datosObraForm.get('empresaUsuaria')?.setValue(empresa);
        }
        if (temporal) this.temporalVacante = temporal;
        this.sugerirDescripcionObra();
      }
    } catch (e) {
      // Es una ayuda de digitación: si falla, los campos se llenan a mano.
      console.warn('[centro de costo] no se pudo autocompletar', e);
    }
  }

  // ───────── Visor de documentos ─────────
  /** Documento que se está viendo; `null` = visor cerrado. */
  visorSrc: SafeResourceUrl | null = null;
  visorTitulo = '';
  /** blob: URL cruda, para poder descargarla y revocarla al cerrar. */
  private visorBlobUrl: string | null = null;

  /**
   * Muestra el documento dentro de la app.
   *
   * Antes se hacía con `window.open`, pero cuando `verArchivo` se llama después
   * de un `await` se pierde el gesto del usuario, el popup se bloquea y caía al
   * plan B de descargar. Con el visor propio siempre se ve, y descargar queda
   * como una acción aparte.
   */
  verArchivo(campo: string): void {
    const reg = this.uploadedFiles[campo];
    if (!reg) return this.alert('error', 'Archivo no encontrado', 'No se encontró el archivo.');

    this.cerrarVisor();

    if (typeof reg.file === 'string') {
      // Documento ya guardado: se abre por su URL, no hay blob que revocar.
      this.visorSrc = this.sanitizer.bypassSecurityTrustResourceUrl(encodeURI(reg.file));
    } else {
      this.visorBlobUrl = URL.createObjectURL(reg.file);
      this.visorSrc = this.sanitizer.bypassSecurityTrustResourceUrl(this.visorBlobUrl);
    }
    this.visorTitulo = reg.fileName || 'Documento';
  }

  /** Descarga lo que se está viendo. */
  descargarDelVisor(): void {
    if (!this.visorBlobUrl) return;
    const a = document.createElement('a');
    a.href = this.visorBlobUrl;
    a.download = this.visorTitulo || 'documento.pdf';
    a.click();
  }

  cerrarVisor(): void {
    if (this.visorBlobUrl) {
      try { URL.revokeObjectURL(this.visorBlobUrl); } catch { }
      this.visorBlobUrl = null;
    }
    this.visorSrc = null;
    this.visorTitulo = '';
  }

  descargarArchivo(): void {
    const archivo = this.DOCS[this.nombreEmpresa];
    if (!archivo) return this.alert('error', 'Error', 'No hay documento para esta empresa.');
    const a = document.createElement('a');
    a.href = `Docs/${archivo}`;
    a.download = archivo;
    a.click();
  }

  // ───────── Subir SOLO los que cambiaron ─────────
  private isChanged(key: string): boolean {
    const local = this.uploadedFiles[key];
    const server = this.serverDocs[key];
    if (!local) return false;
    if (typeof local.file === 'string') return false; // ya es URL → sin cambios
    if (!server) return true;
    const f = local.file as File;
    const nameDiffers = !!(server.fileName && server.fileName !== f.name);
    const sizeKnownAndDiffers = typeof server.size === 'number' && server.size !== f.size;
    return nameDiffers || sizeKnownAndDiffers;
  }

  private async uploadChanged(keys: string[], withContract = false): Promise<{ uploaded: string[], skipped: string[], failed: { key: string; error: string }[] }> {
    const toUpload = keys.filter(k => this.isChanged(k));
    const skipped = keys.filter(k => !toUpload.includes(k));
    const uploaded: string[] = [];
    const failed: { key: string; error: string }[] = [];

    await Promise.all(toUpload.map(async (k) => {
      const { file, fileName } = this.uploadedFiles[k]!;
      if (typeof file === 'string') { skipped.push(k); return; }
      const type = this.typeMap[k] ?? 3;

      const ced = this.candidatoSeleccionado()?.numero_documento;
      const cod = this.candidatoSeleccionado()?.codigo_contrato;
      // Sin el tipo, el backend asume CC y guarda el documento de un CE/PPT en
      // el expediente del titular CC con el mismo número (owner_id sin "x").
      const tipoDoc = String(this.candidatoSeleccionado()?.tipo_doc || '').trim() || undefined;
      const obs = withContract
        ? this.docSvc.guardarDocumento(fileName, ced, type, file, cod, tipoDoc)
        : this.docSvc.guardarDocumento(fileName, ced, type, file, undefined, tipoDoc);

      try {
        const resp: any = await firstValueFrom(obs);
        this.serverDocs[k] = {
          id: this.serverDocs[k]?.id ?? (resp?.id ?? 0),
          fileName,
          type,
          file_url: resp?.file_url ?? this.serverDocs[k]?.file_url ?? '',
          uploaded_at: resp?.uploaded_at ?? new Date().toISOString(),
          size: (file as File).size,
        };
        const newUrl = this.serverDocs[k].file_url;
        this.uploadedFiles[k] = { file: newUrl || this.uploadedFiles[k].file, fileName };
        uploaded.push(k);
      } catch (err: any) {
        console.error(`[uploadChanged] Error subiendo "${k}" (${fileName}):`, err);
        const reason = err?.error?.detail || err?.error?.message || err?.message || 'Error desconocido';
        failed.push({ key: k, error: reason });
      }
    }));

    return { uploaded, skipped, failed };
  }

  /** Cargo de la vacante; se usa para deducir el área de la labor. */
  private cargoVacante = '';

  /**
   * Temporal y empresa usuaria de la vacante. Deciden de qué hoja de "labores
   * por mes" sale la descripción de la obra (Apoyo / Blu / Tu Alianza).
   */
  private temporalVacante = '';
  private empresaVacante = '';

  /** Ccostos con el que se autollenaron los datos de nómina la última vez. */
  private ccostosAutollenado = '';

  /**
   * Fecha de ingreso que propone la vacante (ISO). Se guarda para poder mostrar la
   * traza cuando quien contrata la cambia: la vacante decía una y el contrato quedó
   * con otra, y las dos tienen que poder verse.
   */
  fechaIngresoVacante = '';

  /** La fecha del contrato difiere de la que propuso la vacante. */
  fechaIngresoEditada(): boolean {
    const v = this.pagoTransporteForm?.get('fechaIngreso')?.value;
    if (!v || !this.fechaIngresoVacante) return false;
    const iso = (x: any) => {
      const d = new Date(x);
      return isNaN(d.getTime()) ? String(x).slice(0, 10) : d.toISOString().split('T')[0];
    };
    return iso(v) !== iso(this.fechaIngresoVacante);
  }

  /**
   * Prellena los datos de nómina cruzando la vacante con el maestro de centros
   * de costo. El backend resuelve el cruce (los nombres de finca se escribieron
   * por separado en las dos tablas y casi nunca coinciden literal).
   *
   * Solo se escribe lo que el backend marca como `comun`, es decir lo que vale
   * igual en TODAS las filas que cruzaron. Cuando una finca tiene varios
   * subcentros —SAN CARLOS tiene 5— el centro de costo no viene en `comun` y se
   * deja vacío a propósito: elegir uno al azar metería a la persona en el
   * centro de costo equivocado, y eso va a nómina.
   *
   * Nunca pisa un valor ya escrito.
   */
  private async prellenarDesdeVacante(vac: any): Promise<void> {
    const finca = String(vac?.finca ?? '').trim();
    const empresa = String(vac?.empresa_usuaria_solicita ?? '').trim();
    if (!finca && !empresa) return;

    const ctx = this._loadCtx;
    const res: any = await firstValueFrom(this.farmsService.resolverPorVacante(finca, empresa));
    // Si mientras respondía la finca ya se está cargando otro candidato, estos
    // "solo si vacío" llenarían los campos del nuevo con datos del anterior.
    if (ctx !== this._loadCtx) return;
    const comun = res?.comun;
    if (!comun) return;

    const soloSiVacio = (ctrl: string, valor: any) => {
      const c = this.pagoTransporteForm.get(ctrl);
      if (!c) return;
      const actual = String(c.value ?? '').trim();
      const nuevo = String(valor ?? '').trim();
      if (actual === '' && nuevo !== '') c.setValue(nuevo, { emitEvent: false });
    };

    soloSiVacio('Ccostos', comun.ccostos);
    soloSiVacio('subCentroCostos', comun.subcentro);
    // Ultimo recurso: el maestro dice "GRUPO 1" en casi todos los centros, asi que
    // solo entra cuando la vacante no trae grupo y el contrato aun no tiene ninguno.
    soloSiVacio('grupo', comun.grupo);
    soloSiVacio('empresaGrupoElite', comun.empresa);
    soloSiVacio('ciudadLabor', comun.ciudad);
    soloSiVacio('sublabor', comun.sublabor);            // clasificador 4
    soloSiVacio('categoria', comun.categoria);          // clasificador 2
    soloSiVacio('operacion', comun.operacion);          // clasificador 3

    // Sucursal y código de compañía salen de FICHA V12 de la base de
    // contratación, no de una columna propia del maestro:
    //   Sucursal        = FICHA V12!I95 -> "Centro de costo Para el Carné",
    //                     que en el maestro es `centro_de_costo`.
    //   Código Compañía = FICHA V12!I94 -> tabla fija empresa -> código.
    soloSiVacio('sucursal', comun.centro_de_costo);
    soloSiVacio('carnetCentroCosto', comun.centro_de_costo);
    soloSiVacio('codigoCompania', resolverCodigoCompania(comun.empresa));

    // Ruta y valor del transporte. NO vienen en `comun`: el backend los deja fuera de
    // `CAMPOS_COMUN` a propósito, así que hay que sacarlos de `opciones` aplicando la
    // MISMA regla que él —solo si todas las filas que cruzaron coinciden—. Con varios
    // subcentros discrepando no hay un valor que dar por bueno y se deja en blanco,
    // igual que se hace con el centro de costo.
    const unanime = (campo: string): any => {
      const filas: any[] = Array.isArray(res?.opciones) ? res.opciones : [];
      if (!filas.length) return undefined;
      const primero = filas[0]?.[campo];
      return filas.every(f => f?.[campo] === primero) ? primero : undefined;
    };
    // El booleano no puede ir por `soloSiVacio`: compara con '' y `false` no es vacío.
    const rutaCtrl = this.pagoTransporteForm.get('usaRuta');
    const rutaMaestro = unanime('ruta');
    if (rutaCtrl && rutaCtrl.value === null && typeof rutaMaestro === 'boolean') {
      rutaCtrl.setValue(rutaMaestro, { emitEvent: false });
    }
    soloSiVacio('valorTransporte', unanime('valor_transporte'));

    // Seguros del centro que resolvió el backend. Con varias filas (una finca con
    // varios subcentros) todas comparten centro, así que basta la primera.
    const primera: any = Array.isArray(res?.opciones) ? res.opciones[0] : null;
    if (primera?.id != null) {
      this.cargarSegurosDelCentro(primera.id).catch(() => { /* ya se avisa dentro */ });
    }

    // La temporal del maestro es más confiable que la de la vacante: en la
    // vacante se escoge a mano de una lista de dos opciones.
    if (comun.temporal) this.temporalVacante = String(comun.temporal);
    if (comun.empresa) this.empresaVacante = String(comun.empresa);

    // Punto de partida para detectar un cambio de finca hecho a mano.
    this.ccostosAutollenado =
      String(this.pagoTransporteForm.get('Ccostos')?.value ?? '').trim().toUpperCase();

    // Datos de obra: la dirección y la empresa del maestro son más confiables
    // que las de la vacante, pero igual solo entran si el campo está vacío.
    const obra = (ctrl: string, valor: any) => {
      const c = this.datosObraForm.get(ctrl);
      if (!c) return;
      if (String(c.value ?? '').trim() === '' && String(valor ?? '').trim() !== '') {
        c.setValue(String(valor).trim(), { emitEvent: false });
      }
    };
    obra('empresaUsuaria', comun.empresa);
    obra('centroCosto', comun.centro_de_costo);
    obra('direccion', comun.direccion);
  }

  /**
   * Aviso a mostrar bajo la descripción de obra. Vacío = todo en orden.
   *
   * La descripción es la causa objetiva del contrato temporal, así que cuando no
   * se puede calcular hay que decirlo, no dejar el campo callado con un texto
   * que puede ser del mes equivocado.
   */
  avisoDescripcionObra = '';

  /**
   * Propone la "Descripción de la obra" con la misma regla de la base de
   * contratación (columna J): la labor depende del MES de ingreso y del área,
   * y el área sale del cargo. Ver `labores-por-mes.data.ts`.
   *
   * Manda SIEMPRE la fecha de ingreso de esta pantalla, no la de la vacante.
   * La vacante se publica con la fecha de prueba técnica —que muchas veces ni
   * existe todavía—, y entre la prueba y el ingreso se puede cruzar el mes: si
   * la prueba fue el 28 de julio y la persona entra el 3 de agosto, el contrato
   * tiene que decir la obra de agosto. Por eso una descripción que quedó de otro
   * mes se reemplaza aunque ya estuviera escrita.
   *
   * Lo único que nunca se pisa es un texto redactado a mano (sin el prefijo
   * `<mes><área>` y que no esté en las tablas).
   */
  private sugerirDescripcionObra(): void {
    const ctrl = this.datosObraForm.get('descripcionObra');
    if (!ctrl) return;

    const actual = String(ctrl.value ?? '').trim();
    const fechaIngreso = this.pagoTransporteForm.get('fechaIngreso')?.value;

    const redactadaAMano =
      actual !== '' && !esDescripcionGenerada(actual) && !claveDescripcion(actual);
    if (redactadaAMano) {
      this.avisoDescripcionObra = '';
      return;
    }

    if (!fechaIngreso) {
      this.avisoDescripcionObra =
        'Falta la fecha de ingreso: la descripción de la obra se ajustará al fijarla.';
      return;
    }

    const v = this.datosObraForm.value;
    const sugerida = resolverDescripcionObra(
      this.cargoVacante,
      fechaIngreso,
      `${v.empresaUsuaria ?? ''} ${v.centroCosto ?? ''}`,
      this.temporalVacante,
      this.empresaVacante || String(v.empresaUsuaria ?? ''),
    );

    if (!sugerida) {
      // Cargo fuera del maestro, o área sin labores en la hoja que aplica (los
      // cargos de jardinería de Tu Alianza, area JAR, son el caso real).
      this.avisoDescripcionObra = descripcionEsDeOtroMes(actual, fechaIngreso)
        ? 'La descripción quedó de otro mes y no hay labor definida para este cargo. Revísala a mano.'
        : 'No hay labor definida para este cargo y mes. Escribe la descripción a mano.';
      return;
    }

    this.avisoDescripcionObra = '';
    if (sugerida !== actual) {
      ctrl.setValue(sugerida, { emitEvent: false });
    }
  }

  /**
   * Los 4 datos de obra tal como los espera el contrato.
   *
   * Lo que esté escrito en el formulario es lo que se guarda: los documentos
   * (contrato, ficha técnica, carnet, Minerva) leen estos campos del contrato y
   * solo caen a la vacante cuando están vacíos, así que un `''` en vez de `null`
   * dejaría el documento en blanco en vez de usar el respaldo.
   */
  private datosObraPayload(): {
    descripcion_de_obra: string | null;
    centro_costo_obra: string | null;
    direccion_empresa: string | null;
    empresa_usuaria: string | null;
  } {
    const v = this.datosObraForm.value;
    const norm = (s: any) => {
      const t = (s ?? '').toString().trim();
      return t.length ? t : null;
    };
    return {
      descripcion_de_obra: norm(v.descripcionObra),
      centro_costo_obra: norm(v.centroCosto),
      direccion_empresa: norm(v.direccion),
      empresa_usuaria: norm(v.empresaUsuaria),
    };
  }

  /**
   * Guarda en el contrato los datos de obra/empresa (descripción de obra, centro
   * de costo, dirección, empresa usuaria). Sólo persiste estos campos; no marca
   * al candidato como contratado. Crea el contrato si aún no existía.
   *
   * Guardar "Pago y Transporte" ya persiste lo mismo; este botón sigue existiendo
   * para poder corregir la obra sin marcar al candidato como contratado.
   */
  async guardarDatosObra(opts: { silencioso?: boolean } = {}): Promise<void> {
    if (opts.silencioso ? this.bloqueado() : this.bloqueadoPorEspera()) return;
    const cand = this.candidatoSeleccionado();
    if (!cand?.numero_documento) {
      if (opts.silencioso) return;
      return this.alert('info', 'Sin cédula', 'No hay candidato seleccionado.');
    }

    const payload: ProcesoUpdateByDocumentRequest = {
      numero_documento: String(cand.numero_documento),
      contrato_detalle: this.datosObraPayload(),
    };

    if (opts.silencioso) {
      // Sin `guardado.emit()`: la recarga volvería a llamar aquí.
      await firstValueFrom(this.procesosService.updateProcesoByDocumento(this.conDestino(payload), 'PATCH'));
      return;
    }

    this.loading('Guardando datos de obra…');
    try {
      await firstValueFrom(this.procesosService.updateProcesoByDocumento(this.conDestino(payload), 'PATCH'));
      this.guardado.emit();
      Swal.close();
      this.alert('success', 'Guardado', 'Los datos de obra se guardaron en el contrato.');
    } catch (e: any) {
      Swal.close();
      this.alert('error', 'Error', e?.error?.detail || 'No se pudo guardar. Verifica tu conexión e intenta de nuevo.');
    }
  }

  async cargarReferencias(): Promise<void> {
    if (this.bloqueadoPorEspera()) return;
    this.loading('Validando cambios y subiendo referencias…');

    try {
      const { uploaded, skipped, failed } = await this.uploadChanged(
        ['personal1', 'personal2', 'familiar1', 'familiar2', 'laboral1', 'laboral2'],
        false,
      );

      Swal.close();

      if (failed.length > 0) {
        const errorList = failed.map(f => `<li><b>${f.key}</b>: ${f.error}</li>`).join('');
        Swal.fire({
          icon: 'warning',
          title: 'Carga parcial',
          html: `<p>Subidos: <b>${uploaded.length}</b> | Fallidos: <b>${failed.length}</b></p>
                 <ul style="text-align:left;font-size:13px;padding-left:20px;">${errorList}</ul>
                 ${uploaded.length > 0 ? '<p style="font-size:12px;color:#888;">Los archivos subidos se guardaron correctamente.</p>' : ''}`,
          confirmButtonText: 'Ok',
        });
        return;
      }

      const parts: string[] = [];
      if (uploaded.length) parts.push(`Subidos: ${uploaded.join(', ')}`);
      if (skipped.length) parts.push(`Omitidos (sin cambios): ${skipped.join(', ')}`);

      Swal.fire({
        icon: 'success',
        title: 'Listo',
        html: parts.length ? parts.join('<br>') : 'Operación completada.',
        confirmButtonText: 'Ok',
      });

    } catch (err: any) {
      Swal.close();
      console.error('[cargarReferencias] Error:', err);
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: mensajeDeErrorLog('hiring/subir-archivos', err, 'No se pudieron subir los archivos.'),
        confirmButtonText: 'Ok',
      });
    }
  }

  onTrasladoChange(event: any): void {
    const v = event?.value;
    if (v === 'NO') {
      this.trasladosForm.get('eps_a_trasladar')?.reset();
      this.trasladosForm.get('traslado')?.reset();
    }
  }

  async cargarTraslados(): Promise<void> {
    if (this.bloqueadoPorEspera()) return;
    const cand = this.candidatoSeleccionado();
    if (!cand?.numero_documento) {
      return this.alert('info', 'Sin cédula', 'No hay candidato seleccionado.');
    }

    const desea = this.trasladosForm.value.opcion_traslado_eps === 'SI';
    const epsSel: string | null = this.trasladosForm.value.eps_a_trasladar ?? null;

    if (desea && !epsSel) {
      return this.alert('warning', 'Falta EPS', 'Selecciona la EPS a la que se trasladará.');
    }

    const payload = {
      numero_documento: String(cand.numero_documento),
      contrato_detalle: {
        desea_trasladarse: desea,
        seleccion_eps: desea ? epsSel : null,
      },
    };

    this.loading('Procesando la solicitud de traslado…');

    try {
      // Sube el PDF solo si el usuario eligió traslado = "SI"
      if (desea) {
        const { failed } = await this.uploadChanged(['traslado'], true);
        if (failed.length > 0) {
          Swal.close();
          this.alert('error', 'Error subiendo documento', `No se pudo subir el archivo de traslado: ${failed[0].error}`);
          return;
        }
      }

      await firstValueFrom(
        this.procesosService.updateProcesoByDocumento(this.conDestino(payload), 'PATCH'),
      );

      this.guardado.emit();
      Swal.close();
      this.alert('success', '¡Éxito!', 'Solicitud de traslado guardada.');
    } catch (e: any) {
      Swal.close();
      console.error('[cargarTraslados] Error:', e);
      this.alert('error', 'Error', e?.error?.detail || 'No se pudo guardar la solicitud de traslado. Verifique su conexión e intente de nuevo.');
    }
  }

  // ───────── Huellas (Electron) ─────────
  async captureFingerprintApoyo(): Promise<void> { await this.captureFingerprint('ID', 'apoyo-laboral'); }
  async captureFingerprintTuAlianza(): Promise<void> { await this.captureFingerprint('ID', 'tu-alianza'); }
  async captureFingerprintPD(): Promise<void> { await this.captureFingerprint('PD'); }

  /** Adjuntar la imagen a propósito, sin pasar por el lector. */
  async adjuntarHuella(empresaSlug: 'apoyo-laboral' | 'tu-alianza'): Promise<void> {
    await this.captureFingerprint('ID', empresaSlug, 'archivo');
  }

  /** true en Android/iOS: la pantalla pone la cámara por delante del adjunto. */
  readonly enMovil = this.huellaSvc.esMovil();

  /**
   * Qué lector se usaría, para que el botón lo diga antes de pulsarlo. Se
   * resuelve una vez al abrir la pestaña; `null` mientras se sondea.
   */
  readonly formaCaptura = signal<string | null>(null);

  /**
   * Huella ya guardada en el expediente, POR EMPRESA.
   *
   * El pipeline solo publica una huella (`nav.biometria().huella`): la última
   * cargada, sea de la razón social que sea. Con una huella por empresa eso no
   * basta — cada tarjeta tiene que enseñar la suya, o vuelve el problema de
   * ver la misma imagen repetida en las dos.
   */
  readonly huellasGuardadas = signal<Record<string, string>>({});

  /**
   * El candidato es un `input()` y el padre lo rellena DESPUES de pedirlo al
   * servidor. Cargar las huellas solo en ngOnInit dejaba el mapa vacio para
   * siempre: la pantalla parecia no haber guardado nada.
   */
  private readonly recargarHuellas = effect(() => {
    const cand = this.candidatoSeleccionado();
    void cand;
    void this.cargarHuellasGuardadas();
  });

  /**
   * Quita la huella de una tarjeta.
   *
   * Dos casos distintos bajo el mismo boton: si lo que se ve es una captura
   * recien hecha y aun sin guardar, basta con limpiarla en pantalla; si ya esta
   * en el expediente hay que desligarla en el servidor, porque limpiarla aqui
   * la haria reaparecer en cuanto se recargue la vista.
   *
   * Se pregunta siempre: es un dato biometrico y el boton es una X pequena
   * junto a la imagen, facil de pulsar sin querer.
   */
  async borrarHuella(empresaSlug: 'apoyo-laboral' | 'tu-alianza'): Promise<void> {
    const recienCapturada = empresaSlug === 'apoyo-laboral'
      ? this.fingerprintImageApoyo : this.fingerprintImageTuAlianza;
    const guardada = this.huellaGuardadaDe(empresaSlug);
    if (!recienCapturada && !guardada) return;

    const cfg = HiringQuestionsComponent.EMPRESAS_HUELLA[empresaSlug];
    const { isConfirmed } = await Swal.fire({
      icon: 'warning',
      title: 'Quitar la huella',
      html: recienCapturada && !guardada
        ? `Se descarta la captura de <strong>${cfg.nombre}</strong> sin guardarla.`
        : `Se quitara la huella de <strong>${cfg.nombre}</strong> del expediente.`
          + '<br><small>El archivo se conserva en gestion documental por trazabilidad.</small>',
      showCancelButton: true,
      confirmButtonText: 'Quitar huella',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#c62828',
    });
    if (!isConfirmed) return;

    // Siempre se limpia lo local; el servidor solo si habia algo guardado.
    if (empresaSlug === 'apoyo-laboral') this.fingerprintImageApoyo = null;
    else this.fingerprintImageTuAlianza = null;
    this.publicarAvances();

    if (!guardada) { this.setMensajeHuella(empresaSlug, 'Captura descartada.'); return; }

    const cedula = this.candidatoSeleccionado()?.numero_documento;
    if (!cedula) return;
    try {
      await firstValueFrom(this.procesosService.eliminarHuella(cedula, empresaSlug));
      await this.cargarHuellasGuardadas();
      this.nav.pedirRefrescoBiometria();
      this.setMensajeHuella(empresaSlug, 'Huella quitada. Puedes capturar una nueva.');
    } catch {
      this.setMensajeHuella(empresaSlug, 'No se pudo quitar la huella. Intentalo de nuevo.');
      this.alert('error', 'No se pudo quitar la huella', 'Revisa la conexion y vuelve a intentarlo.');
      await this.cargarHuellasGuardadas();
    }
  }

  /** El mensaje de estado de cada tarjeta vive en una variable distinta. */
  private setMensajeHuella(empresaSlug: string, texto: string): void {
    if (empresaSlug === 'apoyo-laboral') this.messageApoyo = texto;
    else this.messageTuAlianza = texto;
  }

  huellaGuardadaDe(empresaSlug: string): string | null {
    const ruta = this.huellasGuardadas()[empresaSlug];
    if (!ruta) return null;
    // Devuelve null en la primera llamada y repinta cuando la descarga termina.
    return this.archivos.visible(ruta);
  }

  /** ¿Hay huella guardada, aunque su imagen aún se esté descargando? */
  tieneHuellaGuardada(empresaSlug: string): boolean {
    return !!this.huellasGuardadas()[empresaSlug];
  }

  /** Relee del servidor qué huellas hay guardadas para el candidato actual. */
  private async cargarHuellasGuardadas(): Promise<void> {
    const cedula = this.candidatoSeleccionado()?.numero_documento;
    if (!cedula) { this.huellasGuardadas.set({}); return; }
    try {
      const bio: any = await firstValueFrom(this.procesosService.getBiometriaPorCedula(cedula));
      const mapa: Record<string, string> = {};
      for (const [slug, info] of Object.entries<any>(bio?.huellas ?? {})) {
        if (info?.file_url) mapa[slug] = info.file_url;
      }
      this.huellasGuardadas.set(mapa);
    } catch {
      // Que falle la relectura no puede romper la pantalla: como mucho, la
      // tarjeta se queda sin la previa de lo ya guardado.
      this.huellasGuardadas.set({});
    }
  }

  /** Vuelve a sondear y repinta el texto. Lo usa el botón de reintentar. */
  async reintentarDeteccionHuella(): Promise<void> {
    this.formaCaptura.set('Buscando lector…');
    await this.huellaSvc.refrescar();
    await this.refrescarFormaCaptura();
  }

  private async refrescarFormaCaptura(): Promise<void> {
    const preferida = await this.huellaSvc.preferida();
    if (preferida) { this.formaCaptura.set(preferida.nombre); return; }
    // "Sin lector detectado" en un celular es una verdad inútil: ahí nunca va a
    // haber uno. Se dice lo que SÍ se puede hacer.
    // El detalle técnico se enseña a propósito. "Sin lector detectado" tapa
    // tres causas distintas (agente apagado, navegador bloqueando el acceso a
    // loopback, lector desconectado) y sin el error concreto no hay forma de
    // saber cuál es sin abrir las herramientas del navegador.
    const detalle = this.huellaSvc.detalleAgente();
    this.formaCaptura.set(this.enMovil
      ? 'Sin lector: adjunta la imagen de la huella'
      : `Sin lector detectado${detalle ? ' — ' + detalle : ''}`);
  }

  // ── SHA-256 genérico ──
  private async generateHash(data: string): Promise<string> {
    const encoded = new TextEncoder().encode(data);
    const buffer = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(buffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private async generateFileHash(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // ── Dialog de consentimiento biométrico (huella) ──
  private async mostrarConsentimientoHuella(empresaSlug: string): Promise<boolean> {
    const cfg = HiringQuestionsComponent.EMPRESAS_HUELLA[empresaSlug]
      ?? HiringQuestionsComponent.EMPRESAS_HUELLA['apoyo-laboral'];
    const texto = this.buildTextoConsentimientoHuella(cfg.nombre);

    const { isConfirmed } = await Swal.fire({
      title: '',
      html: `
        <div class="consent-dialog-content">
          <div class="consent-dialog-header">
            <div class="consent-dialog-icon">
              <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#2e7d32" stroke-width="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
            </div>
            <h2 class="consent-dialog-title">Autorización de Tratamiento de Datos Biométricos — Huella Dactilar</h2>
            <span class="consent-dialog-badge">Ley 1581 de 2012</span>
            <span class="consent-dialog-badge" style="background:#e8f5e9;color:#2e7d32">${cfg.nombre}</span>
          </div>
          <div class="consent-dialog-body-inner">
            <div class="consent-dialog-text">${texto}</div>
            <label class="consent-dialog-check" id="consent-label">
              <input type="checkbox" id="swal-consent-cb" />
              <span>He leído y <strong>autorizo</strong> la captura, almacenamiento y tratamiento de mi huella dactilar conforme a lo anterior.</span>
            </label>
            <p class="consent-dialog-version">Versión: ${this.VERSION_CONSENTIMIENTO_HUELLA}</p>
          </div>
        </div>
      `,
      width: '540px',
      showCancelButton: true,
      confirmButtonText: '🔒 Autorizar y Capturar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#2e7d32',
      customClass: { popup: 'consent-popup' },
      didOpen: () => {
        const btn = Swal.getConfirmButton();
        if (btn) btn.disabled = true;
        const cb = document.getElementById('swal-consent-cb') as HTMLInputElement;
        cb?.addEventListener('change', () => {
          if (btn) btn.disabled = !cb.checked;
        });
      },
      preConfirm: () => {
        const cb = document.getElementById('swal-consent-cb') as HTMLInputElement;
        if (!cb?.checked) {
          Swal.showValidationMessage('Debes marcar la casilla para continuar.');
          return false;
        }
        return true;
      },
    });
    return isConfirmed;
  }

  private async captureFingerprint(
    kind: 'ID' | 'PD',
    empresaSlug?: string,
    /** Forzar una forma concreta. Sin esto se usa la mejor disponible. */
    origen?: OrigenHuella,
  ): Promise<void> {
    // Per-company UI state helpers
    const setMsg = (t: string) => {
      if (empresaSlug === 'apoyo-laboral') this.messageApoyo = t;
      else if (empresaSlug === 'tu-alianza') this.messageTuAlianza = t;
      if (kind === 'ID') this.messageID = t; else this.messagePD = t;
    };
    const setImg = (d: string | null) => {
      if (empresaSlug === 'apoyo-laboral') this.fingerprintImageApoyo = d;
      else if (empresaSlug === 'tu-alianza') this.fingerprintImageTuAlianza = d;
      if (kind === 'ID') this.fingerprintImageID = d; else this.fingerprintImagePD = d;
      // La huella no pasa por ningún FormControl: si no se avisa aquí, el rail
      // se queda diciendo que falta algo que ya se capturó.
      this.publicarAvances();
    };

    // ── Consentimiento obligatorio para Índice Derecho ──
    if (kind === 'ID' && empresaSlug) {
      const aceptado = await this.mostrarConsentimientoHuella(empresaSlug);
      if (!aceptado) return;
      this.huellaForm.patchValue({ consentimientoHuella: true });
    }

    // De dónde sale la imagen lo decide HuellaCapturaService: lector por
    // Electron, lector por agente local, lector del celular o imagen adjunta.
    // Aquí abajo el flujo es el mismo para las cuatro.
    /**
     * El aviso de "pon el dedo" tiene que estar EN LA PANTALLA.
     *
     * El agente lo escribe en su ventana de PowerShell, pero quien contrata
     * está mirando la web, no una consola: sin esto la pantalla se queda muda
     * entre cinco y treinta segundos, que es justo lo que dura la captura, y
     * parece colgada. Se abre antes de pedir la huella y se cierra pase lo que
     * pase.
     */
    const conAvisoDeLector = async (fn: () => Promise<any>) => {
      // DOS FASES, porque el lector no está listo al instante.
      //
      // Entre que se pide la captura y que el SDK enciende el sensor pasan
      // unos segundos (init, enumerar, abrir). Decir "pon el dedo" desde el
      // primer momento hace que la persona lo apoye antes de tiempo, lo retire
      // al ver que no pasa nada, y la captura acabe expirando con el dedo
      // fuera. Aquí se avisa primero de que está preparando, y solo después se
      // pide el dedo, con la cuenta atrás real de lo que queda.
      // 2 s: con el shim del agente precompilado, el sensor se enciende en
      // menos de dos segundos. Con 4 la persona esperaba de mas.
      const SEGUNDOS_PREPARANDO = 2;
      const SEGUNDOS_TOTAL = 25;
      let restantes = SEGUNDOS_TOTAL;
      let reloj: any = null;

      const pintar = (fase: 'preparando' | 'esperando') => {
        if (fase === 'preparando') {
          Swal.update({
            title: 'Preparando el lector…',
            html: '<p style="margin:0">Espera a que se encienda. <strong>Todavía no apoyes el dedo.</strong></p>',
          });
        } else {
          Swal.update({
            title: 'Apoya el índice derecho',
            html: '<p style="margin:0 0 6px">Apóyalo completo sobre el cristal y no lo muevas.</p>'
              + `<p style="margin:0;font-size:13px;opacity:.7">Quedan ${restantes} s</p>`,
          });
        }
      };

      Swal.fire({
        title: 'Preparando el lector…',
        html: '<p style="margin:0">Espera a que se encienda. <strong>Todavía no apoyes el dedo.</strong></p>',
        allowOutsideClick: false,
        showConfirmButton: false,
        didOpen: () => {
          Swal.showLoading();
          reloj = setInterval(() => {
            restantes--;
            pintar(restantes > SEGUNDOS_TOTAL - SEGUNDOS_PREPARANDO ? 'preparando' : 'esperando');
            if (restantes <= 0 && reloj) { clearInterval(reloj); reloj = null; }
          }, 1000);
        },
      });

      try { return await fn(); }
      finally { if (reloj) clearInterval(reloj); Swal.close(); }
    };

    /**
     * La huella se revisa ANTES de guardarla.
     *
     * Antes se subía sola en cuanto el lector devolvía algo, así que una
     * captura movida o a medias quedaba en el expediente sin que nadie la
     * hubiera mirado, y para corregirla había que repetir el proceso entero
     * sin saber si la anterior se había reemplazado. Ahora la decisión de
     * guardar es explícita, y repetir no cuesta nada.
     */
    const revisarAntesDeGuardar = async (dataUrl: string): Promise<'guardar' | 'repetir' | 'cancelar'> => {
      const { isConfirmed, isDenied } = await Swal.fire({
        title: '¿Guardamos esta huella?',
        html: `<img src="${dataUrl}" alt="Huella capturada"
                 style="max-width:220px;max-height:260px;object-fit:contain;background:#fff;
                        border:1px solid #dbe3ea;border-radius:8px;padding:6px" />
               <p style="margin:12px 0 0;font-size:13px;opacity:.75">
                 Las crestas deben verse separadas y la yema completa.</p>`,
        showDenyButton: true,
        showCancelButton: true,
        confirmButtonText: 'Guardar huella',
        denyButtonText: 'Repetir captura',
        cancelButtonText: 'Descartar',
        reverseButtons: true,
      });
      return isConfirmed ? 'guardar' : (isDenied ? 'repetir' : 'cancelar');
    };

    // Capturar -> revisar -> repetir tantas veces como haga falta. Solo se sale
    // del bucle guardando o descartando: repetir no debe obligar a volver a
    // pasar por el consentimiento ni por el botón.
    let captura;
    let intento = 0;
    while (true) {
      intento++;
      try {
        captura = origen
          ? (origen === 'archivo'
              ? await this.huellaSvc.capturar(origen)
              : await conAvisoDeLector(() => this.huellaSvc.capturar(origen)))
          : (await this.huellaSvc.hayLectorTrasReintento())
            ? await conAvisoDeLector(() => this.huellaSvc.capturar())
            : await this.ofrecerAdjuntarHuella(setMsg);
        if (!captura) return;
      } catch (e) {
        const err = e as HuellaError;
        if (err?.cancelado) { setMsg('Captura cancelada.'); return; }
        const detalle = err?.message || 'No se pudo capturar la huella.';
        setMsg(detalle);
        const { isConfirmed } = await Swal.fire({
          icon: 'error',
          title: 'No se pudo capturar la huella',
          text: detalle,
          showCancelButton: true,
          confirmButtonText: 'Reintentar',
          cancelButtonText: 'Cancelar',
        });
        if (isConfirmed) continue;   // fallar no debe costar empezar de cero
        return;
      }

      // Un archivo adjuntado ya lo eligió la persona: no se le pide revisarlo.
      if (captura.origen === 'archivo') break;

      const decision = await revisarAntesDeGuardar(captura.dataUrl);
      if (decision === 'guardar') break;
      if (decision === 'repetir') { setMsg(`Repitiendo captura (intento ${intento + 1})…`); continue; }
      setMsg('Captura descartada.');
      return;
    }

    try {
      const dataUrl = captura.dataUrl;
      setImg(dataUrl);
      setMsg(captura.origen === 'archivo'
        ? 'Imagen de huella adjuntada.'
        : 'Huella capturada exitosamente.');

      // Subir automáticamente solo la Índice Derecho
      if (kind === 'ID' && empresaSlug) {
        const cedula = this.candidatoSeleccionado()?.numero_documento;
        if (!cedula) {
          this.alert('warning', 'Cédula requerida', 'No hay cédula para asociar la huella.');
          return;
        }

        const cfg = HiringQuestionsComponent.EMPRESAS_HUELLA[empresaSlug]
          ?? HiringQuestionsComponent.EMPRESAS_HUELLA['apoyo-laboral'];
        const textoConsentimiento = this.buildTextoConsentimientoHuella(cfg.nombre);

        // DataURL → File
        const filename = this.buildHuellaFilename('ID', captura.origen);
        const file = this.dataUrlToFile(dataUrl, filename);

        // ── Generar hashes ──
        const timestampISO = new Date().toISOString();
        const consentimientoHash = await this.generateHash(
          String(cedula) + textoConsentimiento + timestampISO
        );
        const imageHash = await this.generateFileHash(file);

        this.huellaForm.patchValue({
          consentimientoHash,
          timestampConsentimiento: timestampISO,
          imageHash,
        });

        Swal.fire({
          icon: 'info',
          title: 'Subiendo huella…',
          text: `Guardando Índice Derecho (${cfg.nombre}) en el servidor.`,
          allowOutsideClick: false,
          didOpen: () => Swal.showLoading(),
        });

        try {
          await firstValueFrom(
            this.procesosService.uploadHuella(cedula, file, {
              consentimiento_hash: consentimientoHash,
              consentimiento_version: this.VERSION_CONSENTIMIENTO_HUELLA,
              consentimiento_timestamp: timestampISO,
              user_agent: this.huellaForm.value.userAgent,
              image_hash: imageHash,
              // Sin `empresa` el backend guarda UNA sola huella por candidato y
              // la segunda tarjeta pisa a la primera. El origen se persiste
              // para poder auditar cuantas se adjuntaron a mano en vez de
              // capturarse con lector.
              empresa: empresaSlug,
              dedo: 'INDICE_DERECHO',
              origen: HiringQuestionsComponent.ORIGEN_A_CATALOGO[captura.origen] ?? 'DESCONOCIDO',
              dispositivo: captura.dispositivo,
              width: captura.ancho ? String(captura.ancho) : undefined,
              height: captura.alto ? String(captura.alto) : undefined,
              dpi: captura.dpi ? String(captura.dpi) : undefined,
            })
          );
          Swal.close();
          setMsg('Huella capturada y guardada.');
          // Igual que la firma: quien lee la biometría del servidor es el
          // pipeline, y hay que decirle que cambió.
          this.nav.pedirRefrescoBiometria();
          void this.cargarHuellasGuardadas();
          this.alert('success', '¡Listo!', `La huella (Índice Derecho — ${cfg.nombre}) se guardó correctamente.`);
        } catch (e) {
          Swal.close();
          setMsg('Huella capturada, pero no se pudo guardar.');
          this.alert('error', 'Error al guardar la huella', 'Intenta nuevamente.');
        }
      }
    } catch {
      setMsg('La huella se capturó, pero falló el procesamiento posterior.');
    }
  }

  /**
   * No hay lector: se le pregunta a quien contrata antes de aceptar una imagen
   * suelta. Adjuntar es una excepción trazable (queda como origen `archivo`),
   * no un respaldo que ocurra solo.
   */
  private async ofrecerAdjuntarHuella(setMsg: (t: string) => void) {
    const motivo = await this.huellaSvc.motivoSinLector();

    const { isConfirmed } = await Swal.fire({
      icon: 'warning',
      title: 'Sin lector de huella',
      text: `${motivo} ¿Quieres adjuntar una imagen de la huella?`,
      showCancelButton: true,
      confirmButtonText: 'Adjuntar imagen',
      cancelButtonText: 'Cancelar',
    });
    if (!isConfirmed) { setMsg(motivo); return null; }
    return this.huellaSvc.capturar('archivo');
  }

  // Helper: DataURL → File
  private dataUrlToFile(dataUrl: string, filename: string): File {
    const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
    if (!m) throw new Error('DataURL inválido');
    const mime = m[1] || 'application/octet-stream';
    const base64 = m[2];
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], filename, { type: mime });
  }

  /**
   * El origen va en el NOMBRE porque es lo único que llega hasta gestión
   * documental: el endpoint de biometría solo recibe archivo y documento. Sin
   * esto no habría forma de saber después cuáles huellas salieron de un lector
   * y cuáles se adjuntaron a mano.
   */
  private buildHuellaFilename(kind: 'ID' | 'PD', origen?: OrigenHuella): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `huella_${kind}_${origen ?? 'lector'}_${stamp}.png`;
  }

  // ───────── Utilidades ─────────
  private alert(icon: 'success' | 'error' | 'warning' | 'info', title: string, text: string): void {
    Swal.fire({ icon, title, text, confirmButtonText: 'Ok' });
  }

  /** Avisa y devuelve true si la contratación está bloqueada (EN ESPERA o NO APLICA). */
  private bloqueadoPorEspera(): boolean {
    if (this.bloqueado()) {
      this.alert(
        'info',
        `Candidato ${this.motivoBloqueo()}`,
        'No se puede contratar con la observación actual del evaluador.'
      );
      return true;
    }
    return false;
  }

  private loading(text: string) {
    Swal.fire({ icon: 'info', title: 'Cargando…', text, allowOutsideClick: false, didOpen: () => Swal.showLoading() });
  }

  private async headMeta(url: string): Promise<Partial<ServerDocInfo>> {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      return {
        size: Number(res.headers.get('content-length') ?? undefined),
        etag: res.headers.get('etag') ?? undefined,
        lastModified: res.headers.get('last-modified') ?? undefined,
      };
    } catch { return {}; }
  }

  timeAgo(dateStr?: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr).getTime();
    if (!Number.isFinite(d)) return '';
    const diffMs = Date.now() - d;
    const sec = Math.round(diffMs / 1000);
    const min = Math.round(sec / 60);
    const hrs = Math.round(min / 60);
    const days = Math.round(hrs / 24);
    if (sec < 60) return `hace ${sec} s`;
    if (min < 60) return `hace ${min} min`;
    if (hrs < 24) return `hace ${hrs} h`;
    return `hace ${days} días`;
  }

  ageInDays(dateStr?: string): number {
    if (!dateStr) return NaN;
    const t = new Date(dateStr).getTime();
    return Number.isFinite(t) ? Math.floor((Date.now() - t) / 86400000) : NaN;
  }

  hasLocalChange(key: string): boolean { return this.isChanged(key); }

  urlToFile(url: string, fileName: string): Promise<File> {
    return fetch(url)
      .then(r => { if (!r.ok) throw new Error(`No se pudo descargar: ${r.statusText}`); return r.blob(); })
      .then(blob => new File([blob], fileName, { type: blob.type || 'application/octet-stream' }))
      .catch(err => { Swal.fire('Error', 'No se pudo descargar el archivo', 'error'); throw err; });
  }

  private toSiNo(v: any): 'Sí' | 'No' {
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    if (typeof v === 'number') return v > 0 ? 'Sí' : 'No';
    if (typeof v === 'string') {
      const s = v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
      return ['si', 'sí', 'true', '1', 'x', 's'].includes(s) ? 'Sí' : 'No';
    }
    return 'No';
  }

  // ───────── Carga integral reactiva ─────────
  /** Secuencia de cargas: invalida los `await` de una carga anterior. */
  private _loadCtx = 0;
  /** Último titular (tipo|número) cuyo formulario ya se parcheó desde el servidor. */
  private ultimaCedulaCargada: string | null = null;
  /** Llave de la carga aplicada: titular + id del proceso (uno nuevo re-parchea). */
  private ultimaCargaKey: string | null = null;

  async loadData(): Promise<void> {
    const cand = this.candidatoSeleccionado();
    if (!cand?.numero_documento) return;

    // `loadData` corre con CADA referencia nueva del candidato (el padre
    // recarga tras cada guardado). Dos protecciones:
    //  1. `ctx`: una carga vieja que despierta de un await no puede escribir
    //     (antes, cambiar rápido de persona dejaba salario/finca/cargo del
    //     candidato anterior en el formulario del nuevo).
    //  2. Misma persona re-servida: NO se re-parchean los formularios (pisaría
    //     lo que el usuario tiene editado sin guardar en otras pestañas); solo
    //     se refrescan los documentos.
    const ctx = ++this._loadCtx;
    // Llave por TITULAR (tipo|número): dos personas distintas pueden compartir
    // número (CC vs C.C/CE) y con la cédula sola el cambio no se detectaba.
    const cedActual = `${String(cand.tipo_doc || 'CC').trim().toUpperCase()}|${String(cand.numero_documento)}`;
    const cambioPersona = cedActual !== this.ultimaCedulaCargada;

    if (cambioPersona) {
      // Sin esta limpieza, los slots que el nuevo candidato no llena conservan
      // el documento del anterior (la pestaña Referencias mostraba y abría el
      // PDF de otra persona).
      this.serverDocs = {};
      this.uploadedFiles = {};
      this.referenciasForm.reset();
      this.trasladosForm.reset();
      // Se acaba de limpiar todo: pase lo que pase abajo, la próxima carga con
      // proceso debe parchear desde cero (ver el sellado más adelante).
      this.ultimaCedulaCargada = null;
      this.ultimaCargaKey = null;
      // Lo que se parchee ahora es de la persona nueva, no algo que ella editó:
      // no debe dispararse el guardado automático, y lo pendiente de la
      // anterior se descarta.
      this.pagoTransporteForm?.markAsPristine();
      this.autoPago.cancelar();
      // El "criterio de finca" también es del candidato anterior: sin esto, un
      // blur sobre el Ccostos del nuevo evaluaba cambioDeFinca=true y
      // REEMPLAZABA su nómina con datos de la finca del otro.
      this.ccostosAutollenado = '';
    }

    const ent0 = Array.isArray(cand?.entrevistas) ? cand.entrevistas[0] : null;
    const proc = ent0?.proceso;
    // Sin proceso no hay nada que parchear; NO se sella la cédula para que la
    // recarga que sí traiga el proceso haga la carga inicial completa.
    if (!proc) return;

    // La llave de carga incluye el ID DEL PROCESO: cuando el backend abre uno
    // nuevo (regla terminal, eliminar del historial) la misma persona debe
    // re-parchearse desde cero — sin esto el formulario conservaba forma de
    // pago, tarjeta y obra del contrato ANTERIOR y "Guardar" los escribía en
    // el proceso nuevo.
    // También entran la PUBLICACIÓN y el SALARIO de la remisión: guardar la
    // remisión (pestaña Selección) cambia la vacante o el salario sobre el
    // MISMO proceso, y sin esto "Datos de obra", salario, auxilio y % ARL se
    // quedaban con los de la vacante anterior hasta volver a buscar a la
    // persona. Esta pestaña solo LEE esos dos campos, así que un guardado
    // propio no dispara re-parcheo.
    // `consultaSeq` también entra: una consulta nueva del buscador re-parchea
    // (refresco explícito); las recargas internas conservan lo editado.
    const cargaKey = `${cedActual}|${proc.id ?? 'sin-id'}`
      + `|${proc.publicacion ?? proc.vacante ?? 'sin-vac'}`
      + `|${proc.vacante_salario ?? ''}#${this.consultaSeq()}`;
    if (cargaKey === this.ultimaCargaKey) {
      this.llenarDocumentos().catch(console.error);
      return;
    }
    this.ultimaCedulaCargada = cedActual;
    this.ultimaCargaKey = cargaKey;

    const contr = proc?.contrato;
    const isEmptyValue = (v: any) => v === null || v === '' || (typeof v === 'boolean' && v === false);
    const CONTR_KEYS: Array<keyof typeof contr> = [
      'forma_de_pago', 'numero_para_pagos', 'Ccentro_de_costos', 'porcentaje_arl', 'cesantias',
      'subcentro_de_costos', 'grupo', 'categoria', 'operacion', 'horas_extras', 'seguro_funerario',
      'empresa_grupo_elite', 'codigo_compania', 'sucursal', 'ciudad_labor', 'sublabor',
      'desea_trasladarse', 'seleccion_eps', 'contrasenia_asignada', 'identification_number_tarjeta'
    ];
    const contratoVacio = !contr || CONTR_KEYS.every(k => isEmptyValue((contr as any)?.[k]));
    const toNum = (v: any) => (v === '' || v == null ? null : Number(v));

    // "Otra" forma de pago se guarda como el texto libre que escribió el
    // usuario; al volver del servidor hay que reconocerlo y reabrir el campo.
    const FORMAS_CONOCIDAS = ['Daviplata', 'Davivienda cta ahorros', 'Colpatria cta ahorros', 'Bancolombia', 'Otra'];
    const formaGuardada = String(contr?.forma_de_pago ?? '').trim();
    const esFormaLibre = !!formaGuardada && !FORMAS_CONOCIDAS.includes(formaGuardada);

    // 1) Parche inicial (contrato/proceso)
    this.pagoTransporteForm.patchValue({
      formaPago: esFormaLibre ? 'Otra' : (contr?.forma_de_pago ?? ''),
      otraFormaPago: esFormaLibre ? formaGuardada : '',
      numeroPagos: contr?.numero_para_pagos ?? null,
      numeroIdentificacion: (contr as any)?.identification_number_tarjeta ?? null,
      contraseniaAsignada: contr?.contrasenia_asignada ?? null,
      // validacionNumeroCuenta: contr?.numero_para_pagos ?? null, // eliminado
      seguroFunerario: contr?.seguro_funerario ?? false,
      // Cuál se eligió. El importe NO se parchea a un control: se muestra desde el
      // catálogo del centro y, si el contrato trae uno guardado distinto (porque el
      // parametrizador cambió el valor después), manda el guardado —ver `valorSeguro`.
      seguroFunerarioId: (contr as any)?.seguro_funerario_id ?? null,
      // Se lee con minúscula aunque se guarde con mayúscula: si no, al reabrir
      // la pestaña la casilla salía vacía y se volvía a teclear lo mismo.
      Ccostos: centroDeCostosDe(contr),
      carnetCentroCosto: (contr as any)?.carnet_centro_costo ?? null,
      porcentajeARL: contr?.porcentaje_arl != null ? toNum(contr.porcentaje_arl) : null,
      cesantias: contr?.cesantias ?? null,
      subCentroCostos: contr?.subcentro_de_costos ?? null,
      empresaGrupoElite: contr?.empresa_grupo_elite ?? null,
      codigoCompania: contr?.codigo_compania ?? null,
      sucursal: contr?.sucursal ?? null,
      ciudadLabor: contr?.ciudad_labor ?? null,
      sublabor: contr?.sublabor ?? null,
      grupo: contr?.grupo ?? null,
      categoria: contr?.categoria ?? null,
      operacion: contr?.operacion ?? null,
      horasExtras: contr?.horas_extras ?? false,
      // Lo GUARDADO manda; si el contrato aún no tiene temporal, la resuelve la vacante
      // o el maestro más abajo (`prellenarDesdeVacante` / `autollenarDesdeCentroCosto`).
      // El backend la guarda como código (AL/TA, VARCHAR(16)); con código se deja vacía
      // para que la vacante o el maestro pinten el nombre. Vacía no se envía, así que
      // el código guardado no se pierde.
      temporal: /^(AL|TA)$/i.test(String((contr as any)?.temporal ?? '').trim()) ? null : ((contr as any)?.temporal ?? null),
      // Ruta y recargo: null cuando nunca se preguntó, que es distinto de "NO".
      usaRuta: (contr as any)?.usa_ruta ?? null,
      valorTransporte: (contr as any)?.valor_transporte != null ? toNum((contr as any).valor_transporte) : null,
      porcentajeHorasExtras: (contr as any)?.porcentaje_horas_extras != null
        ? toNum((contr as any).porcentaje_horas_extras) : null,
      salario: proc?.vacante_salario != null ? toNum(proc.vacante_salario) : null,
      // Vacío, NO 'No': el auxilio lo dice la vacante y se parchea abajo. Con
      // 'No' fijo, un proceso sin publicación —o una vacante que no se pudo
      // traer— mostraba "sin auxilio" como si fuera un dato del contrato.
      auxilio_transporte: null,
      fechaIngreso: contr?.fecha_ingreso ?? null,
      fechaContrato: contr?.fecha_contrato ?? null,
    });

    // Importe del seguro tal como se firmó. Se guarda aparte del catálogo para que
    // un cambio posterior del parametrizador no reescriba contratos ya hechos.
    this.seguroValorGuardado = (contr as any)?.seguro_funerario_valor != null
      ? toNum((contr as any).seguro_funerario_valor) : null;
    // Al cambiar de candidato hay que releer los seguros: el centro es otro.
    this.centroCostoIdSeguros = null;
    this.segurosDelCentro = [];

    // Datos de obra/empresa: primero lo que ya esté guardado en el contrato.
    this.datosObraForm.patchValue({
      empresaUsuaria: (contr as any)?.empresa_usuaria ?? '',
      centroCosto: (contr as any)?.centro_costo_obra ?? '',
      direccion: (contr as any)?.direccion_empresa ?? '',
      descripcionObra: (contr as any)?.descripcion_de_obra ?? '',
    });

    // 2) Traer SIEMPRE la vacante (si hay publicacion) para setear auxilio_transporte
    //    y autollenar porcentajeARL desde el cargo asociado al cargo de la vacante.
    if (proc?.publicacion) {
      try {
        // `loadData` corre en cada recarga del candidato (guardar dispara una),
        // pero la vacante no cambia entre guardados: se pide una vez por id.
        let vac: any = this.vacantePorId.get(proc.publicacion);
        if (vac === undefined) {
          vac = await firstValueFrom(this.vacantesService.obtenerVacante(proc.publicacion));
          this.vacantePorId.set(proc.publicacion, vac ?? null);
        }
        // El candidato pudo cambiar mientras respondía la vacante: parchear
        // acá pondría salario/finca/cargo del anterior sobre el nuevo.
        if (ctx !== this._loadCtx) return;

        const salarioFromProc = proc?.vacante_salario != null ? toNum(proc.vacante_salario) : null;
        const salarioFromVac = vac?.salario != null ? toNum(vac.salario) : null;

        const auxFromVac = this.toSiNo(vac?.auxilio_transporte);

        this.pagoTransporteForm.patchValue({
          salario: salarioFromProc ?? salarioFromVac,
          auxilio_transporte: auxFromVac,
          // El cargo SIEMPRE manda desde la vacante: es su fuente canónica y aquí solo
          // se muestra. No se guarda en el contrato para que no puedan divergir.
          cargo: String(vac?.cargo ?? '').trim() || null,
        });

        // GRUPO DE PAGO: manda la vacante.
        //
        // Antes salia del maestro (`centros_costos.grupo`, ver `prellenarDesdeVacante`),
        // donde 826 de los 1.041 centros dicen "GRUPO 1" sin mas: casi cualquier
        // contratacion acababa en el grupo 1 tuviera o no que estar ahi. La vacante, en
        // cambio, lo lleva ELEGIDO en Parametrizacion de vacantes, y de ese mismo grupo
        // salen las fechas de pago y el casino que imprime el contrato. Si aqui dijera
        // otro, el documento se contradiria consigo mismo.
        //
        // Las vacantes sin grupo —las de antes de esta parametrizacion y las de las
        // temporales que no la tienen— llegan vacias: entonces no se pisa nada y sigue
        // valiendo lo guardado, o el maestro como ultimo recurso.
        this.grupoVacante = String(vac?.grupo_pago_nombre_snapshot ?? '').trim();
        if (this.grupoVacante) {
          this.pagoTransporteForm.get('grupo')?.setValue(this.grupoVacante, { emitEvent: false });
        }

        // Fecha de ingreso PROPUESTA por la vacante. Se guarda en el contrato, que es
        // una fila distinta: editarla aquí no toca `tabla_publicaciones_vacantes`
        // —este endpoint solo escribe `contrato_detalle`— así que la vacante conserva
        // su fecha y queda la traza de las dos. Solo se propone si el contrato no
        // tiene ya una: lo guardado es la decisión tomada y no la pisa la vacante.
        this.fechaIngresoVacante = vac?.fechadeIngreso ? String(vac.fechadeIngreso) : '';
        const fiCtrl = this.pagoTransporteForm.get('fechaIngreso');
        if (fiCtrl && !fiCtrl.value && this.fechaIngresoVacante) {
          fiCtrl.setValue(this.fechaIngresoVacante);
        }

        // La temporal solo se propone si el contrato no traía una guardada: lo que ya
        // se persistió es la decisión que se tomó y no la pisa la vacante.
        const temporalCtrl = this.pagoTransporteForm.get('temporal');
        if (temporalCtrl && !String(temporalCtrl.value ?? '').trim()) {
          const t = String(vac?.temporal ?? '').trim();
          if (t) temporalCtrl.setValue(t, { emitEvent: false });
        }

        // Datos de obra/empresa: manda SIEMPRE la vacante (los campos son de
        // solo lectura en la pestaña); lo guardado en el contrato queda solo
        // de respaldo para cuando la vacante no trae el dato.
        const obraActual = this.datosObraForm.value;
        const orStr = (x: any) => (x == null ? '' : String(x));
        this.datosObraForm.patchValue({
          empresaUsuaria: orStr(vac?.empresa_usuaria_solicita) || obraActual.empresaUsuaria,
          centroCosto: orStr(vac?.finca) || obraActual.centroCosto,
          direccion: orStr(vac?.direccion) || obraActual.direccion,
          descripcionObra: orStr(vac?.descripcion) || obraActual.descripcionObra,
        });

        this.cargoVacante = String(vac?.cargo ?? '').trim();
        this.temporalVacante = String(vac?.temporal ?? '').trim();
        this.empresaVacante = String(vac?.empresa_usuaria_solicita ?? '').trim();

        // Datos de nómina desde el maestro de centros de costo. Va antes de
        // sugerir la descripción porque puede llenar el centro de costo.
        try {
          await this.prellenarDesdeVacante(vac);
        } catch (e) {
          console.warn('[nomina] no se pudo prellenar desde la vacante:', e);
        }

        this.sugerirDescripcionObra();

        // Autocompletar Porcentaje ARL desde el cargo de la vacante.
        // Si el contrato YA tenía un porcentaje_arl explícito, lo respetamos
        // y no lo pisamos (hay casos donde nómina ajustó manualmente).
        const cargo_nombre = (vac?.cargo ?? '').toString().trim();
        if (cargo_nombre) {
          await this.autollenarPorcentajeArlDesdeCargo(cargo_nombre, contr?.porcentaje_arl);
        }

        if (contratoVacio) {
          // Completar otros defaults desde la vacante si aplica
        }
      } catch (e) {
        console.error('No se pudo cargar la vacante:', e);
      }
    } else {
      // Proceso sin publicación (remisión quitada o aún sin remitir): el
      // contexto de la vacante ANTERIOR no puede quedarse alimentando la
      // sugerencia de descripción de obra ni el juego de labores.
      this.cargoVacante = '';
      this.temporalVacante = '';
      this.empresaVacante = '';
      this.grupoVacante = '';
    }

    if (ctx === this._loadCtx) void this.sincronizarDatosObra(proc, contr);
    this.llenarDocumentos().catch(console.error);
  }

  /** Datos de obra ya escritos por `sincronizarDatosObra`, por proceso. */
  private obraSincronizada = '';

  /**
   * Sin botón "Guardar datos de obra": si lo que sale de la vacante difiere de
   * lo guardado en el contrato, se guarda solo. Es lo mismo que hacía el botón;
   * sin esto, cambiar la vacante en Remisión dejaba el contrato con la obra
   * anterior hasta que alguien tocara "Pago y Transporte".
   *
   * Una vez por (proceso, valores): si el backend normaliza distinto, no se
   * entra en un bucle de guardar y recargar.
   */
  private async sincronizarDatosObra(proc: any, contr: any): Promise<void> {
    if (this.bloqueado()) return;
    const p = this.datosObraPayload();
    const txt = (x: unknown) => String(x ?? '').trim();
    if (!Object.values(p).some(v => txt(v))) return;
    const igual = txt(p.descripcion_de_obra) === txt(contr?.descripcion_de_obra)
      && txt(p.centro_costo_obra) === txt(contr?.centro_costo_obra)
      && txt(p.direccion_empresa) === txt(contr?.direccion_empresa)
      && txt(p.empresa_usuaria) === txt(contr?.empresa_usuaria);
    if (igual) return;
    const firma = `${proc?.id ?? ''}|${JSON.stringify(p)}`;
    if (firma === this.obraSincronizada) return;
    this.obraSincronizada = firma;
    try {
      await this.guardarDatosObra({ silencioso: true });
    } catch (e) {
      console.warn('[datos de obra] no se pudieron guardar solos:', e);
    }
  }

  /**
   * Obtiene el porcentaje_arl del cargo asociado a la vacante y lo escribe en
   * el control `porcentajeARL` (editable, sólo se sugiere).
   *
   * Si el contrato ya tenía un porcentaje_arl explícito (>0), respeta ese
   * valor y no lo sobreescribe (nómina pudo ajustar manualmente).
   *
   * Usa el endpoint LIST con filtro `q=` y filtra exacto en cliente, porque
   * muchos cargos contienen slash literal (ej. "OPERARIO Y/U OFICIOS"), y el
   * endpoint detail `/cargos/{nombre}/` se rompe con slashes en la URL.
   */
  private async autollenarPorcentajeArlDesdeCargo(
    cargo_nombre: string,
    porcentajeYaGuardado?: number | string | null,
  ): Promise<void> {
    const ctrl = this.pagoTransporteForm.get('porcentajeARL');
    if (!ctrl) return;

    const yaTiene =
      porcentajeYaGuardado != null &&
      porcentajeYaGuardado !== '' &&
      Number(porcentajeYaGuardado) > 0;

    if (yaTiene) {
      ctrl.setValue(Number(porcentajeYaGuardado), { emitEvent: false });
      return;
    }

    try {
      // El endpoint detail no soporta slashes. Usamos list con `q` (icontains)
      // y matcheamos exacto en cliente. Igual que la vacante, el porcentaje de
      // un cargo no cambia entre guardados: se consulta una vez por nombre.
      const ctx = this._loadCtx;
      let lista = this.cargosPorNombre.get(cargo_nombre);
      if (lista === undefined) {
        lista = await firstValueFrom(this.positionsService.list({ q: cargo_nombre }));
        this.cargosPorNombre.set(cargo_nombre, lista ?? []);
      }
      if (ctx !== this._loadCtx) return; // llegó tarde: es el %ARL de otro candidato
      const norm = (s: string) => (s || '').trim().toUpperCase();
      const target = norm(cargo_nombre);
      const cargo = (lista || []).find(c => norm(c.nombre) === target);

      if (cargo?.porcentaje_arl != null) {
        ctrl.setValue(Number(cargo.porcentaje_arl), { emitEvent: false });
      } else {
        console.warn(`[hiring-questions] Cargo "${cargo_nombre}" no encontrado en gestion_cargos.`);
      }
    } catch (e) {
      console.warn(`[hiring-questions] Error consultando cargo "${cargo_nombre}":`, e);
    }
  }

  /** Vacantes ya consultadas por id. Vive lo que vive el componente. */
  private readonly vacantePorId = new Map<string | number, any>();
  /** Resultados de gestion_cargos por nombre de cargo consultado. */
  private readonly cargosPorNombre = new Map<string, any[]>();

  private _docsCtx = 0;
  async llenarDocumentos(): Promise<void> {
    const ctx = ++this._docsCtx;
    Swal.fire({
      icon: 'info',
      title: 'Cargando…',
      text: 'Cargando documentos del candidato…',
      allowOutsideClick: false,
      showConfirmButton: false,
      didOpen: () => Swal.showLoading(),
    });

    try {
      // Antes eran cuatro GET al mismo endpoint variando `type` (16, 17, 18 y
      // 86). El expediente completo trae lo mismo —el backend aplica idéntica
      // regla de "vigentes" con y sin tipo, incluidas las DOS referencias de
      // los tipos 16/17— y viene cacheado por cédula, así que el pipeline y
      // selección comparten esta misma respuesta. (El `codigo_contrato` que se
      // enviaba antes nunca filtró nada: el GET del backend lo ignora.)
      const ced = this.candidatoSeleccionado()?.numero_documento;
      const docs = await firstValueFrom(this.docSvc.getDocumentosDeCandidato(ced));
      // Orden por id ASCENDENTE: es el mismo criterio con el que "Generar
      // referencia" reparte personal1/personal2. Con el orden por recencia del
      // backend, re-subir el PDF de la persona 2 lo movía al slot 1 y quedaban
      // archivo y datos cruzados.
      const delTipo = (t: number) => (docs ?? [])
        .filter((d: any) => Number(d?.type) === t)
        .sort((a: any, b: any) => Number(a?.id ?? 0) - Number(b?.id ?? 0));
      const res = { tipo16: delTipo(16), tipo17: delTipo(17), tipo18: delTipo(18), tipo86: delTipo(86) };

      if (ctx !== this._docsCtx) { if (Swal.isVisible()) Swal.close(); return; }

      // Slots derivados del servidor se reconstruyen desde cero; un adjunto
      // LOCAL aún sin guardar (File) se respeta para no perderlo.
      const clavesRef = ['personal1', 'personal2', 'familiar1', 'familiar2', 'laboral1', 'laboral2', 'traslado'];
      for (const k of clavesRef) {
        if (this.uploadedFiles[k]?.file instanceof File) continue;
        delete this.uploadedFiles[k];
        delete this.serverDocs[k];
      }

      const fillList = async (list: any[], baseKey: 'personal' | 'familiar' | 'laboral', max = 2) => {
        let i = 1;
        for (const doc of list ?? []) {
          if (i > max) break;
          const key = `${baseKey}${i}` as const;
          const head = await this.headMeta(doc.file_url);
          // El HEAD pudo demorar y ya hay otra carga en curso: no escribir
          // slots del contexto viejo sobre el candidato nuevo.
          if (ctx !== this._docsCtx) return;
          if (this.uploadedFiles[key]?.file instanceof File) { i++; continue; }
          this.serverDocs[key] = {
            id: doc.id, fileName: doc.title || 'Documento', type: doc.type, file_url: doc.file_url,
            uploaded_at: doc.uploaded_at, size: head.size, etag: head.etag, lastModified: head.lastModified,
          };
          this.uploadedFiles[key] = { file: doc.file_url, fileName: doc.title || 'Documento' };
          if (baseKey === 'personal' || baseKey === 'familiar' || baseKey === 'laboral') {
            this.referenciasForm.patchValue({ [key]: doc.title || 'Documento' });
          }
          i++;
        }
      };

      await fillList(res.tipo16, 'personal', 2);
      await fillList(res.tipo17, 'familiar', 2);
      await fillList(res.tipo86, 'laboral', 2);

      // Traslado (único)
      for (const doc of res.tipo18 ?? []) {
        const head = await this.headMeta(doc.file_url);
        if (ctx !== this._docsCtx) return;
        if (this.uploadedFiles['traslado']?.file instanceof File) break;
        this.serverDocs['traslado'] = {
          id: doc.id, fileName: doc.title || 'Documento', type: doc.type, file_url: doc.file_url,
          uploaded_at: doc.uploaded_at, size: head.size, etag: head.etag, lastModified: head.lastModified,
        };
        this.uploadedFiles['traslado'] = { file: doc.file_url, fileName: doc.title || 'Documento' };
        this.trasladosForm.patchValue({ traslado: doc.title || 'Documento' });
        break;
      }
    } catch (err: any) {
      console.error('[llenarDocumentos] Error:', err);
      if (Swal.isVisible()) Swal.close();
      const detail = err?.error?.detail || err?.message || '';
      Swal.fire('Error', detail ? `No se pudieron cargar los documentos: ${detail}` : 'No fue posible cargar los documentos. Verifique su conexión.', 'error');
      return;
    } finally {
      if (ctx === this._docsCtx && Swal.isVisible()) Swal.close();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  DOCUMENT PREVIEW DIALOG (Huella)
  // ═══════════════════════════════════════════════════════════════

  openDocumentsDialog(): void {
    this.currentDocIndex = 0;
    this.showDocumentsDialog = true;
  }

  closeDocumentsDialog(): void {
    this.showDocumentsDialog = false;
  }

  nextDocument(): void {
    if (this.currentDocIndex < this.huellaDocsList.length - 1) this.currentDocIndex++;
  }

  prevDocument(): void {
    if (this.currentDocIndex > 0) this.currentDocIndex--;
  }

  private pushHuellaDoc(title: string, buffer: ArrayBuffer): void {
    const blob = new Blob([buffer], { type: 'application/pdf' });
    this.huellaDocsList.push({
      title,
      safeUrl: this.sanitizer.bypassSecurityTrustResourceUrl(URL.createObjectURL(blob))
    });
  }

  /** Genera previews de los documentos que usan la huella */
  async generarPreviewsHuella(empresaSlug: string): Promise<void> {
    this.huellaDocsList = [];
    this.currentDocIndex = 0;

    const huellaImage = empresaSlug === 'tu-alianza'
      ? this.fingerprintImageTuAlianza
      : this.fingerprintImageApoyo;

    if (!huellaImage) {
      Swal.fire('Atención', 'Primero debes capturar la huella.', 'info');
      return;
    }

    Swal.fire({
      icon: 'info', title: 'Generando documentos…',
      text: 'Creando las vistas previas con la huella capturada.',
      allowOutsideClick: false, didOpen: () => Swal.showLoading(),
    });

    const cand = this.candidatoSeleccionado();
    const cedula = cand?.numero_documento ?? '';

    try {
      // 1. Entrega de Documentos (jsPDF – usa huella)
      try {
        const buf = await this.generarEntregaDocsHuella(cedula, cand, huellaImage);
        if (buf) this.pushHuellaDoc('Entrega de documentos', buf);
      } catch (e) { console.warn('No se pudo generar Entrega de Documentos:', e); }

      this.currentDocIndex = 0;
      Swal.close();

      if (this.huellaDocsList.length > 0) {
        this.openDocumentsDialog();
      } else {
        Swal.fire('Info', 'No se generaron documentos con la huella.', 'info');
      }
    } catch (error) {
      Swal.close();
      console.error('Error generando previews de huella:', error);
      Swal.fire('Error', 'No se pudieron generar los documentos.', 'error');
    }
  }

  // ═════ ENTREGA DE DOCUMENTOS con Huella (jsPDF) ═════
  private async generarEntregaDocsHuella(
    cedula: string, cand: any, huellaDataUrl: string
  ): Promise<ArrayBuffer | null> {
    const H_CENTER = 'center' as const;
    const BOLD = 'bold' as const;
    const ITALIC = 'italic' as const;

    const toDataURL = async (url?: string): Promise<string | null> => {
      if (!url) return null;
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) throw new Error('fetch fail');
        const b = await r.blob();
        return await new Promise<string>((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.onerror = () => rej(new Error('reader fail'));
          fr.readAsDataURL(b);
        });
      } catch { return null; }
    };

    const renderJustifiedLine = (
      doc: jsPDF, linea: string, x: number, y: number,
      anchoDisponible: number, ultimaLinea: boolean
    ) => {
      const palabras = linea.split(' ').filter(Boolean);
      if (palabras.length <= 1 || ultimaLinea) { doc.text(linea, x, y); return; }
      const widths = palabras.map(p => doc.getTextWidth(p));
      const totalPalabras = widths.reduce((a, b) => a + b, 0);
      const espacios = palabras.length - 1;
      const extra = (anchoDisponible - totalPalabras) / espacios;
      let cursorX = x;
      palabras.forEach((p, i) => {
        doc.text(p, cursorX, y);
        if (i < espacios) cursorX += widths[i] + extra;
      });
    };

    const { jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true });
    const empresaNombre = 'APOYO LABORAL T.S. S.A.S.';
    doc.setProperties({ title: 'Entrega_Documentos.pdf', author: empresaNombre, creator: empresaNombre });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const leftMargin = 10, rightMargin = 10;
    const contentWidth = pageWidth - leftMargin - rightMargin;
    let y = 10;
    const marginLeft = leftMargin;

    // ── Encabezado ──
    const startX = leftMargin, startY = y, headerHeight = 13;
    const logoBoxWidth = 50, tableWidth = contentWidth;
    doc.setLineWidth(0.1);
    doc.rect(startX, startY, logoBoxWidth, headerHeight);
    const logoData = await toDataURL('logos/Logo_AL.png');
    if (logoData) doc.addImage(logoData, 'PNG', startX + 2, startY + 1.5, 27, 10);
    doc.setFontSize(7);
    const tableStartX = startX + logoBoxWidth;
    const rightHeaderWidth = tableWidth - logoBoxWidth;
    doc.rect(tableStartX, startY, rightHeaderWidth, headerHeight);
    doc.setFont('helvetica', 'bold');
    doc.text('PROCESO DE CONTRATACIÓN', tableStartX + 54, startY + 3);
    doc.text('ENTREGA DE DOCUMENTOS Y AUTORIZACIONES', tableStartX + 44, startY + 7);
    const h1Y = startY + 4, h2Y = startY + 8;
    doc.line(tableStartX, h1Y, tableStartX + rightHeaderWidth, h1Y);
    doc.line(tableStartX, h2Y, tableStartX + rightHeaderWidth, h2Y);
    const col1 = tableStartX + 30, col2 = tableStartX + 50, col3 = tableStartX + 110;
    doc.line(col1, h2Y, col1, startY + headerHeight);
    doc.line(col2, h2Y, col2, startY + headerHeight);
    doc.line(col3, h2Y, col3, startY + headerHeight);
    doc.setFontSize(7).setFont('helvetica', 'bold');
    doc.text(`Código: ${FORMATO_ENTREGA_APOYO.codigo}`, tableStartX + 2, startY + 11.5);
    doc.text(`Versión: ${FORMATO_ENTREGA_APOYO.version}`, col1 + 2, startY + 11.5);
    doc.text(`Fecha Emisión: ${FORMATO_ENTREGA_APOYO.fechaEmision}`, col2 + 5, startY + 11.5);
    doc.text('Página: 1 de 1', col3 + 6, startY + 11.5);
    y = startY + headerHeight + 7;

    // ── Intro ──
    doc.setFontSize(8).setFont('helvetica', 'normal');
    doc.text('Reciba un cordial saludo, por medio del presente documento afirmo haber recibido, leído y comprendido los documentos relacionados a continuación:', marginLeft, y, { maxWidth: contentWidth });
    doc.setFontSize(7);
    y += 4;

    ['Copia del Contrato individual de Trabajo',
      'Inducción General de nuestra Compañía e Información General de la Empresa Usuaria el cual incluye información sobre:'
    ].forEach((item, idx) => {
      const n = `${idx + 1}) `;
      doc.setFont('helvetica', 'bold'); doc.text(n, marginLeft, y);
      doc.setFont('helvetica', 'normal'); doc.text(item, marginLeft + doc.getTextWidth(n), y);
      y += 5;
    });

    // ── Tabla (autoTable) ──
    doc.setFontSize(8).setFont('helvetica', 'bold');
    doc.text('Fechas de Pago de Nómina y Valor del almuerzo que es descontado por Nómina o Liquidación final:', marginLeft + 20, y);
    const startYForTable = y + 3;

    const head: RowInput[] = [[
      { content: 'EMPRESA USUARIA', styles: { halign: H_CENTER, fontStyle: BOLD, fillColor: [255, 128, 0], textColor: 255 } },
      { content: 'FECHA DE PAGO', styles: { halign: H_CENTER, fontStyle: BOLD, fillColor: [255, 128, 0], textColor: 255 } },
      { content: 'SERVICIO DE CASINO', styles: { halign: H_CENTER, fontStyle: BOLD, fillColor: [255, 128, 0], textColor: 255 } }
    ]];
    const body: RowInput[] = [
      [{ content: 'The Elite Flower S.A.S C.I *\nFundación Fernando Borrero Caicedo', styles: { fontStyle: ITALIC, fontSize: 6.5, halign: H_CENTER } }, { content: '01 y 16 de cada mes', styles: { fontSize: 6.5, halign: H_CENTER } }, { content: 'Valor de Almuerzo $ 1,945\nDescuento quincenal por nómina y/o Liquidación Final', styles: { fontSize: 6.5, halign: H_CENTER } }],
      [{ content: 'Luisiana Farms S.A.S.', styles: { fontStyle: ITALIC, fontSize: 6.5, halign: H_CENTER } }, { content: '01 y 16 de cada mes', styles: { fontSize: 6.5, halign: H_CENTER } }, { content: 'Valor de Almuerzo $ 3,700\nDescuento quincenal por nómina y/o Liquidación Final', styles: { fontSize: 6.5, halign: H_CENTER } }],
      [{ content: 'Petalia S.A.S', styles: { fontStyle: ITALIC, fontSize: 6.5, halign: H_CENTER } }, { content: '01 y 16 de cada mes', styles: { fontSize: 6.5, halign: H_CENTER } }, { content: 'No cuenta con servicio de casino, se debe llevar el almuerzo', styles: { fontSize: 6.5, halign: H_CENTER } }],
      [{ content: 'Fantasy Flower S.A.S. \nMercedes S.A.S. \nWayuu Flowers S.A.S', styles: { fontStyle: ITALIC, fontSize: 6.5, halign: H_CENTER } }, { content: '06 y 21 de cada mes', styles: { fontSize: 6.5, halign: H_CENTER } }, { content: 'Valor de Almuerzo $ 1,945 \n Descuento quincenal por nómina y/o Liquidación Final', styles: { fontSize: 6.5, halign: H_CENTER } }]
    ];
    autoTable(doc, { head, body, startY: startYForTable, theme: 'grid', margin: { left: leftMargin, right: rightMargin }, styles: { font: 'helvetica', fontSize: 6.5, cellPadding: { top: 1.2, bottom: 1.2, left: 2, right: 2 } }, headStyles: { lineWidth: 0.2, lineColor: [120, 120, 120] }, bodyStyles: { lineWidth: 0.2, lineColor: [180, 180, 180], valign: 'middle' }, columnStyles: { 0: { cellWidth: 95 }, 1: { cellWidth: 45 }, 2: { cellWidth: 'auto' as const } } });
    const finalY = (doc as any).lastAutoTable?.finalY ?? (startYForTable + 30);
    doc.setDrawColor(0).setLineWidth(0.2);
    doc.line(leftMargin, finalY, pageWidth - rightMargin, finalY);
    y = finalY + 4;

    // ── Notas ──
    doc.setFontSize(7).setFont('helvetica', 'normal');
    const nota1 = 'Nota: * Para los centros de costo de la empresa usuaria The Elite Flower S.A.S. C.I.: Carnations, Florex, Jardines de Colombia Normandía, Tinzuque, Tikya, Chuzacá; su fecha de pago son 06 y 21 de cada mes.';
    const nota2 = '** Para los centros de costo de la empresa usuaria Wayuu Flowers S.A.S.: Pozo Azul, Postcosecha Excellence, Belchite; su fecha de pago son 01 y 16 de cada mes.';
    const l1 = doc.splitTextToSize(nota1, contentWidth) as string[]; doc.text(l1, marginLeft, y); y += l1.length * 4;
    const l2 = doc.splitTextToSize(nota2, contentWidth) as string[]; doc.text(l2, marginLeft, y); y += l2.length * 4;

    // ── Autorización casino ──
    doc.setFontSize(8).setFont('helvetica', 'bold');
    doc.text('Teniendo en cuenta la anterior información, autorizo descuento de casino:', marginLeft, y);
    doc.setFont('helvetica', 'normal');
    doc.text('SI (  X  )', 130, y); doc.text('NO (     )', 155, y); doc.text('No aplica (     )', 175, y);

    // ── Forma de pago ──
    y += 5;
    doc.setFont('helvetica', 'bold').setFontSize(7);
    doc.text('3) FORMA DE PAGO:', marginLeft, y); y += 5;
    const contrato = cand?.entrevistas?.[0]?.proceso?.contrato || {};
    const formaPago: string = contrato?.forma_de_pago ?? '';
    const numPagos: string = contrato?.numero_para_pagos ?? '';
    const opciones = [
      { nombre: 'Daviplata', x: marginLeft, y }, { nombre: 'Davivienda cta ahorros', x: marginLeft + 20, y },
      { nombre: 'Davivienda Tarjeta Master', x: marginLeft + 60, y }, { nombre: 'Otra', x: marginLeft + 105, y },
    ];
    opciones.forEach(op => {
      doc.rect(op.x, op.y - 3, 4, 4);
      doc.setFont('helvetica', 'normal').text(op.nombre, op.x + 6, op.y);
      if (formaPago === op.nombre) doc.setFont('helvetica', 'bold').text('X', op.x + 1, op.y);
    });
    doc.text('¿Cuál?', 130, y); doc.line(140, y, 200, y);
    y += 5;
    doc.setFontSize(8).setFont('helvetica', 'bold').text('Número TJT ó Celular:', marginLeft, y);
    doc.text('Código de Tarjeta:', 110, y);
    doc.setFont('helvetica', 'normal');
    if (formaPago === 'Daviplata') doc.text(String(numPagos), 60, y);
    else doc.text(String(numPagos), 150, y);

    // ── IMPORTANTE (justificado) ──
    y += 5;
    doc.setFont('helvetica', 'bold').setFontSize(7);
    const importante = 'IMPORTANTE: Recuerde que si usted cuenta con su forma de pago Daviplata, cualquier cambio realizado en la misma debe ser notificado a la Emp. Temporal. También tenga presente que la entrega de la tarjeta Master por parte de la Emp. Temporal es provisional, y se reemplaza por la forma de pago DAVIPLATA; tan pronto Davivienda nos informa que usted activó su DAVIPLATA, se le genera automáticamente el cambio de forma de pago. CUIDADO! El manejo de estas cuentas es responsabilidad de usted como trabajador, por eso son personales e intransferibles.';
    doc.setFont('helvetica', 'normal');
    const lineas = doc.splitTextToSize(importante.trim().replace(/\s+/g, ' '), contentWidth) as string[];
    lineas.forEach((ln, i) => { renderJustifiedLine(doc, ln, marginLeft, y, contentWidth, i === lineas.length - 1); y += 3; });

    // ── Acepto cambio ──
    y += 5;
    doc.setFont('helvetica', 'bold').setFontSize(8);
    doc.text('ACEPTO CAMBIO SIN PREVIO AVISO YA QUE HE SIDO INFORMADO (A):', marginLeft, y - 4);
    doc.setFont('helvetica', 'normal'); doc.text('SI (  x  )', 170, y - 4); doc.text('NO (     )', 190, y - 4);
    doc.setFontSize(6.5);

    // ── Contenido final ──
    const contenidoFinal = [
      { numero: '4)', texto: 'Entrega y Manejo del Carné de la Empresa de Servicios Temporales APOYO LABORAL TS S.A.S.' },
      { numero: '5)', texto: 'Capacitación de Ley 1010 DEL 2006 (Acosos laboral) y mecanismo para interponer una queja general o frente al acoso.' },
      { numero: '6)', texto: 'Socialización de las políticas vigentes y aplicables de la Empresa Temporal.' },
      { numero: '7)', texto: 'Curso de Seguridad y Salud en el Trabajo "SST" de la Empresa Temporal.' },
      { numero: '8)', texto: 'Se hace entrega de la documentación requerida para la vinculación de beneficiarios a la Caja de Compensación Familiar y se establece compromiso de 15 días para la entrega sobre la documentación para afiliación de beneficiarios a la Caja de Compensación y EPS si aplica.\nDe lo contrario se entenderá que usted no desea recibir este beneficio, recuerde que es su responsabilidad el registro de los mismos.' },
      { numero: '9)', texto: PLAN_FUNERAL }
    ];
    const bottomSafe = 12;
    const ensureSpace = (need: number) => { if (y + need > pageHeight - bottomSafe) { doc.addPage(); y = 15; } };
    doc.setFontSize(7);
    contenidoFinal.forEach(item => {
      ensureSpace(10);
      doc.setFont('helvetica', 'bold').text(item.numero, marginLeft, y);
      doc.setFont('helvetica', 'normal');
      const tl = doc.splitTextToSize(item.texto, contentWidth) as string[];
      doc.text(tl, marginLeft + 10, y); y += tl.length * 4 + 1;
    });

    // Seguro funerario
    const seguro = !!contrato?.seguro_funerario;
    if (seguro) { doc.text('SI (  x  )', 170, y - 4); doc.text('NO (     )', 190, y - 4); }
    else { doc.text('SI (     )', 170, y - 4); doc.text('NO (  x  )', 190, y - 4); }

    doc.setFont('helvetica', 'bold').text('Nota:', marginLeft, y + 1);
    doc.setFont('helvetica', 'normal').setFontSize(7).text(
      'Si usted autorizó este descuento debe presentar una carta en la oficina de la Temporal solicitando el retiro, para la desafiliación de este plan.',
      marginLeft + 10, y + 1, { maxWidth: contentWidth - 10 }
    );

    // ── Banner Recuerde que ──
    y += 5; ensureSpace(10);
    doc.setFillColor(230, 230, 230); doc.rect(marginLeft, y - 2, contentWidth, 5, 'F');
    doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(0, 0, 0);
    doc.text('Recuerde que:', marginLeft + 2, y + 1);
    doc.setFont('helvetica', 'normal').setTextColor(0, 0, 0);
    doc.text('Puede encontrar esta información disponible en:', marginLeft + 25, y + 1);
    doc.setTextColor(0, 0, 255);
    doc.textWithLink('http://www.apoyolaboralts.com/', marginLeft + 95, y + 1, { url: 'http://www.apoyolaboralts.com/' });
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold').text('Ingresando la clave:', marginLeft + 145, y + 1);
    doc.setFont('helvetica', 'bold').setFontSize(8).text('9876', marginLeft + 180, y + 1);

    // ── DEL COLABORADOR ──
    y += 8; ensureSpace(20);
    const contenidoColaborador = [
      { numero: 'a)', texto: 'Por medio de la presente manifiesto que recibí lo anteriormente mencionado y que acepto el mismo.' },
      { numero: 'b)', texto: 'Leí y comprendí  el curso de inducción General y de Seguridad y Salud en el Trabajo, así como  el contrato laboral   y todas las cláusulas y condiciones establecidas.' },
      { numero: 'c)', texto: 'Información Condiciones de Salud: Manifiesto que conozco los resultados de mis exámenes médicos de ingreso y las recomendaciones dadas por el médico ocupacional.' },
    ];
    doc.setFont('helvetica', 'bold').setFontSize(8).text('DEL COLABORADOR:', marginLeft, y); y += 5;
    doc.setFontSize(7.5);
    const lh = 4, gapAfterItem = 1;
    doc.setFont('helvetica', 'bold');
    const bulletBoxWidth = Math.max(doc.getTextWidth('a) '), doc.getTextWidth('b) '), doc.getTextWidth('c) ')) + 1.5;
    const xBullet = marginLeft, xText = xBullet + bulletBoxWidth;
    const availWidth = pageWidth - rightMargin - xText;

    contenidoColaborador.forEach(({ numero, texto }) => {
      ensureSpace(10);
      doc.setFont('helvetica', 'bold').text(numero, xBullet, y);
      doc.setFont('helvetica', 'normal');
      const partes = String(texto).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      (partes.length ? partes : ['']).forEach((p, pi) => {
        const lines = doc.splitTextToSize(p, availWidth) as string[];
        lines.forEach(ln => { ensureSpace(lh); doc.text(ln, xText, y); y += lh; });
        if (pi < partes.length - 1) y += 1.5;
      });
      y += gapAfterItem;
    });

    // ── Firma + Huella ──
    y += 10; ensureSpace(30);
    doc.setFont('helvetica', 'bold').setFontSize(8);
    doc.line(marginLeft, y, marginLeft + 60, y);
    doc.text('Firma de Aceptación', marginLeft, y + 4);

    // Firma del candidato (si existe en biometría)
    const firmaUrl = cand?.biometria?.firma?.file_url;
    if (firmaUrl) {
      const firmaData = await toDataURL(firmaUrl);
      if (firmaData) doc.addImage(firmaData, 'PNG', marginLeft, y - 18, 50, 20);
    }

    y += 8;
    doc.setFont('helvetica', 'bold').setFontSize(8);
    doc.text(`No de Identificación: ${cedula ?? ''}`, marginLeft, y);
    doc.text(`Fecha de Recibido: ${new Date().toISOString().split('T')[0]}`, marginLeft, y + 4);

    // Tabla de huella
    const huellaTableWidth = 82, huellaTableHeight = 30, huellaHeaderHeight = 8;
    const huellaStartX = pageWidth - rightMargin - huellaTableWidth;
    const huellaStartY = y - 10;
    doc.setFillColor(230, 230, 230);
    doc.rect(huellaStartX, huellaStartY, huellaTableWidth / 2, huellaHeaderHeight, 'F');
    doc.setDrawColor(0);
    doc.rect(huellaStartX, huellaStartY, huellaTableWidth / 2, huellaHeaderHeight);
    doc.setFont('helvetica', 'bold').setFontSize(8);
    doc.text('Huella Indice Derecho', huellaStartX + 5, huellaStartY + 5);
    doc.rect(huellaStartX, huellaStartY + huellaHeaderHeight, huellaTableWidth / 2, huellaTableHeight);

    // Insertar la huella capturada directamente desde el dataURL en memoria
    if (huellaDataUrl) {
      const imageWidth = huellaTableWidth / 2 - 10;
      const imageHeight = huellaTableHeight - 3;
      doc.addImage(huellaDataUrl, 'PNG', huellaStartX + 5, huellaStartY + huellaHeaderHeight + 2, imageWidth, imageHeight);
    }

    // Sello
    const selloData = await toDataURL('firma/FirmaEntregaDocApoyo.png');
    if (selloData) { y += 5; doc.addImage(selloData, 'PNG', marginLeft, y, 95, 10); }

    return doc.output('arraybuffer');
  }
}
