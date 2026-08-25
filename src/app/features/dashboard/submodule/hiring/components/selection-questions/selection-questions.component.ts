import {  Component, DestroyRef, effect, inject, input, output , ChangeDetectionStrategy, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { firstValueFrom, merge, startWith } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import Swal from 'sweetalert2';
import { mensajeDeErrorLog } from '@/app/shared/utils/mensaje-error';
import { ElectronWindowService } from '@/app/core/services/electron-window.service';

import { SharedModule } from '@/app/shared/shared.module';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';

import { GestionDocumentalService } from '../../service/gestion-documental/gestion-documental.service';
import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';
import { RegistroProcesoContratacion } from '../../service/registro-proceso-contratacion/registro-proceso-contratacion';
import type { AntecedentesPayload } from '../../service/registro-proceso-contratacion/registro-proceso-contratacion';
import { RobotsService } from '../../service/robots/robots.service';
import type { ResultadosAntecedentes } from '../../service/robots/robots.service';
import { procesoDeAntecedentes } from '../../pages/recruitment-pipeline/contrato.rules';
import { PipelineNavService } from '../../service/pipeline-nav/pipeline-nav.service';
import { avanceDeForm } from '../../shared/progreso.util';

/* ===================== Tipos ===================== */
type UploadedFileInfo = {
  file?: File | string;
  fileName?: string;
  updatedAt?: number | string;
  updatedAtLabel?: string;
  changed?: boolean;
  loading?: boolean;
  error?: string | null;
};

type DocKey =
  | 'eps' | 'afp' | 'policivos' | 'procuraduria' | 'contraloria'
  | 'ramaJudicial' | 'medidasCorrectivas' | 'sisben' | 'ofac'
  | 'figuraHumana' | 'pensionSemanas';

type ListSource = 'epsList' | 'afpList' | 'categoriasSisben' | 'medidasCorrectivas';
type FieldType = 'estado' | 'list' | 'number';

interface FieldDef {
  key: DocKey;
  label: string;
  type: FieldType;
  optionSource?: ListSource;
  placeholder?: string;
  control?: string;
  /** Sin una selección en este campo no se deja guardar. */
  required?: boolean;
}

/**
 * PDF adjuntado en la UI y todavía no subido al backend.
 *
 * Se captura como snapshot ANTES de cualquier `await`, porque el effect() del
 * candidato llama resetUploadedFilesAsNew() y borra los File pendientes.
 */
interface PendienteUpload {
  key: DocKey;
  file: File;
  fileName: string;
  typeId: number;
}

/* ===== Cola de antecedentes (viene del backend) ===== */
type ColaKey =
  | 'adress'
  | 'policivo'
  | 'ofac'
  | 'contraloria'
  | 'sisben'
  | 'procuraduria'
  | 'fondo_pension'
  | 'medidas_correctivas';

interface ColaItem {
  estado: 'FINALIZADO' | 'EN_PROGRESO' | 'SIN_CONSULTAR' | 'DESCARGADO ROBOT' | 'SIN_REGISTRO' | string;
  faltan_antes: number | null;
}

type ColaRaw = Partial<Record<ColaKey, ColaItem>>;

/* ============== Constantes (catálogos/UI) ============== */
const DEFAULT_UPLOADED_FILES: Record<DocKey, UploadedFileInfo> = {
  eps: { fileName: 'Adjuntar documento' },
  afp: { fileName: 'Adjuntar documento' },
  policivos: { fileName: 'Adjuntar documento' },
  procuraduria: { fileName: 'Adjuntar documento' },
  contraloria: { fileName: 'Adjuntar documento' },
  ramaJudicial: { fileName: 'Adjuntar documento' },
  medidasCorrectivas: { fileName: 'Adjuntar documento' },
  sisben: { fileName: 'Adjuntar documento' },
  ofac: { fileName: 'Adjuntar documento' },
  figuraHumana: { fileName: 'Adjuntar documento' },
  pensionSemanas: { fileName: 'Sin consultar' },
};

/* Keys que maneja el patch del formulario */
type FormPatchKeys =
  | 'eps' | 'afp' | 'policivos' | 'procuraduria' | 'contraloria'
  | 'ramaJudicial' | 'sisben' | 'ofac' | 'medidasCorrectivas' | 'semanasCotizadas';

type FormPatchBase = Record<FormPatchKeys, string | number | null>;

/* nombre (BD) -> key de form */
const MAP_NOMBRE_TO_KEY: Record<string, FormPatchKeys> = {
  EPS: 'eps',
  AFP: 'afp',
  POLICIVOS: 'policivos',
  PROCURADURIA: 'procuraduria',
  CONTRALORIA: 'contraloria',
  RAMA_JUDICIAL: 'ramaJudicial',
  SISBEN: 'sisben',
  OFAC: 'ofac',
  MEDIDAS_CORRECTIVAS: 'medidasCorrectivas',
  SEMANAS_COTIZADAS: 'semanasCotizadas',
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-selection-questions',
  standalone: true,
  imports: [SharedModule, MatTabsModule, MatDatepickerModule, MatNativeDateModule],
  templateUrl: './selection-questions.component.html',
  styleUrls: ['./selection-questions.component.css'],
} )
export class SelectionQuestionsComponent implements OnDestroy {
  /* -------- Input (signal) -------- */
  candidatoSeleccionado = input<any | null>(null);
  /** Avisa al pipeline que se guardaron antecedentes, para que recargue el candidato. */
  guardado = output<void>();
  /**
   * Override "Modificar de todas formas" (pipeline con contrato activo): al guardar,
   * marca la edición como pura sobre el proceso EXISTENTE y sella la auditoría
   * (nombre + fecha/hora del servidor). No abre proceso/entrevista nuevos.
   */
  modificacionForzada = input<boolean>(false);
  /** Nº de consulta del buscador: re-consultar re-pide los resultados del robot. */
  consultaSeq = input<number>(0);
  modificadoPor = input<string>('');

  /** Proceso que se está mostrando/guardando (ver procesoDeAntecedentes). */
  private procesoId: number | string | null = null;

  /* -------- Form -------- */
  antecedentes: FormGroup;

  /** Patch-base del form para reinicios/control de tipos */
  readonly formPatchBase: FormPatchBase = {
    eps: '', afp: '', policivos: '', procuraduria: '', contraloria: '',
    ramaJudicial: '', sisben: '', ofac: '', medidasCorrectivas: '', semanasCotizadas: ''
  };

  /* -------- Catálogos -------- */
  readonly estados = ['CUMPLE', 'NO CUMPLE', 'SIN BUSCAR'] as const;
  readonly epsList = [
    'ALIANSALUD', 'ASMET SALUD', 'CAJACOPI', 'CAPITAL SALUD', 'CAPRESOCA', 'COMFAMILIARHUILA',
    'COMFAORIENTE', 'COMPENSAR', 'COOSALUD', 'DUSAKAWI', 'ECOOPSOS', 'FAMISANAR',
    'FAMILIAR DE COLOMBIA', 'MUTUAL SER', 'NUEVA EPS', 'PIJAOS SALUD', 'SALUD TOTAL',
    'SANITAS', 'SAVIA SALUD', 'SOS', 'SURA', 'No Tiene', 'Sin Buscar',
  ] as const;
  // 'No Tiene' y 'Sin Buscar' faltaban: sin ellas no había forma de registrar
  // que la persona no cotiza pensión, ni de dejar el campo como "pendiente".
  // Van con la misma escritura que EPS y Sisbén para que se vean parejas.
  readonly afpList = [
    'PORVENIR', 'COLFONDOS', 'PROTECCION', 'COLPENSIONES', 'SKANDIA',
    'No Tiene', 'Sin Buscar',
  ] as const;
  readonly categoriasSisben = [
    'A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7',
    'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11', 'C12', 'C13', 'C14', 'C15', 'C16', 'C17', 'C18',
    'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12', 'D13', 'D14', 'D15', 'D16', 'D17', 'D18', 'D19', 'D20', 'D21',
    // 'No Tiene' = la persona no está sisbenizada (el robot lo devuelve como
    // "Sin Sisben"). Distinto de 'No Aplica' (no corresponde consultarlo) y de
    // 'Sin Buscar' (todavía nadie lo revisó).
    'No Tiene', 'No Aplica', 'Sin Buscar'
  ] as const;
  readonly medidasCorrectivasOpts = [...Array.from({ length: 11 }, (_, i) => i), 'CUMPLE'] as const;

  /* -------- Definición de campos (data-driven) -------- */
  readonly fields: FieldDef[] = [
    { key: 'policivos', label: 'Policivos', type: 'estado', required: true },
    { key: 'procuraduria', label: 'Procuraduría', type: 'estado', required: true },
    { key: 'contraloria', label: 'Contraloría', type: 'estado', required: true },
    { key: 'ofac', label: 'OFAC', type: 'estado', required: true },
    { key: 'ramaJudicial', label: 'Rama Judicial', type: 'estado' },

    { key: 'eps', label: 'EPS', type: 'list', optionSource: 'epsList', placeholder: 'EPS', required: true },
    { key: 'sisben', label: 'Sisbén', type: 'list', optionSource: 'categoriasSisben', required: true },
    { key: 'afp', label: 'AFP', type: 'list', optionSource: 'afpList', placeholder: 'AFP', required: true },
    { key: 'medidasCorrectivas', label: 'Medidas Correctivas', type: 'list', optionSource: 'medidasCorrectivas' },

    { key: 'pensionSemanas', label: 'Semanas cotizadas', type: 'number', control: 'semanasCotizadas' },
  ];

  /* -------- Documentos -------- */
  readonly typeMap: Record<DocKey, number> = {
    eps: 7, policivos: 6, procuraduria: 3, contraloria: 4, medidasCorrectivas: 10,
    afp: 11, ramaJudicial: 12, sisben: 8, ofac: 5, figuraHumana: 31, pensionSemanas: 33
  };
  uploadedFiles: Record<DocKey, UploadedFileInfo> = { ...DEFAULT_UPLOADED_FILES };

  /* -------- Estado/ctx -------- */
  private _ctx = 0;
  /** Cédula a la que ya se le avisó del fallo de carga de docs (1 toast por persona). */
  private avisoErrorDocsCed: string | null = null;
  cedula: string | null = null;
  // tipo_documento del candidato: necesario para que el backend prefije owner_id
  // con "x" cuando no sea CC. Sin esto, los Documents non-CC colisionarían
  // con los CC del mismo número de cédula.
  tipoDocumento: string | null = null;

  /* -------- Cola de antecedentes (para la UI) -------- */
  private colaRaw: ColaRaw | null = null;

  /* -------- Auto-refresco de documentos del robot --------
   * Las píldoras de cola llegan FINALIZADO con el candidato, pero el PDF que
   * sube el robot puede llegar segundos después. Mientras haya antecedentes
   * FINALIZADO sin archivo cargado, re-consultamos getDocuments para que el
   * documento aparezca solo, sin recargar manualmente. */
  private pollTimer: any = null;
  private readonly POLL_INTERVAL_MS = 2500;
  private readonly POLL_MAX_ATTEMPTS = 12; // ~30 s de ventana de espera

  /** Mapa de campos del formulario -> clave en cola_antecedentes */
  /** Mapa de campos del formulario -> clave en cola_antecedentes */
  private readonly colaKeyMap: Record<DocKey, ColaKey | null> = {
    // con cola
    eps: 'adress',                      // ← EPS usa 'adress'
    policivos: 'policivo',
    ramaJudicial: 'policivo',           // ← Rama Judicial también usa 'policivo'
    procuraduria: 'procuraduria',
    contraloria: 'contraloria',
    ofac: 'ofac',
    sisben: 'sisben',
    medidasCorrectivas: 'medidas_correctivas',
    // opcional (muestra la cola de AFP):
    afp: 'fondo_pension',               // ← quítalo si no la quieres mostrar

    // sin cola
    figuraHumana: null,
    pensionSemanas: null,
  };


  private readonly destroyRef = inject(DestroyRef);
  private readonly nav = inject(PipelineNavService);

  constructor(
    private fb: FormBuilder,
    private docsSrv: GestionDocumentalService,
    private rpc: RegistroProcesoContratacion,
    private ui: UtilityServiceService,
    private robots: RobotsService,
    private cdr: ChangeDetectorRef,
    private ventanas: ElectronWindowService
  ) {
    // Reactive Forms. Los 7 con `required` no dejan guardar sin una selección
    // ('Sin Buscar' / 'SIN BUSCAR' cuentan como selección: lo que no puede
    // quedar es el campo en blanco). Rama Judicial, Medidas Correctivas y
    // Semanas cotizadas siguen opcionales.
    this.antecedentes = this.fb.group({
      eps: ['', Validators.required],
      afp: ['', Validators.required],
      policivos: ['', Validators.required],
      procuraduria: ['', Validators.required],
      contraloria: ['', Validators.required],
      ramaJudicial: [''],
      sisben: ['', Validators.required],
      ofac: ['', Validators.required],
      medidasCorrectivas: [''],
      semanasCotizadas: [null],
    });

    // Avance de Antecedentes para el rail del pipeline: los 7 obligatorios
    // (los opcionales no cuentan, porque no son lo que falta por llenar).
    merge(this.antecedentes.valueChanges, this.antecedentes.statusChanges)
      .pipe(startWith(null), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.nav.publicar('antecedentes', avanceDeForm(this.antecedentes)));

    // Reacciona al candidato seleccionado
    effect(() => {
      const candidato = this.candidatoSeleccionado();
      // NO es `entrevistas[0].proceso`: con dos turnos abiertos el mismo día la
      // posición 0 puede ser el turno nuevo (sin proceso o sin antecedentes) y
      // el form se pintaba vacío después de guardar. Ver procesoDeAntecedentes.
      const proc = procesoDeAntecedentes(candidato);
      // Se guarda SOBRE este mismo proceso (`proceso_id`): sin él el backend
      // resuelve "la última entrevista" por su cuenta y podía escribir en uno
      // distinto del que se está mostrando.
      this.procesoId = proc?.id ?? null;
      const cedulaAnterior = this.cedula;
      const tipoAnterior = this.tipoDocumento;
      this.cedula = (candidato?.numero_documento ?? candidato?.numeroDocumento ?? null) as string | null;
      // El payload del backend trae `tipo_doc` (así se llama en el modelo
      // Candidato); `tipo_documento` no existe y dejaba esto SIEMPRE en null,
      // con lo que los PDFs de personas CE/PPT se guardaban sin el prefijo "x"
      // — es decir, en el expediente del titular CC con el mismo número.
      this.tipoDocumento = (candidato?.tipo_doc ?? candidato?.tipo_documento ?? candidato?.tipoDocumento ?? null) as string | null;
      // El titular cambia también si cambia el TIPO con el mismo número
      // (CC vs C.C/CE son personas distintas).
      const cambioPersona = this.cedula !== cedulaAnterior || this.tipoDocumento !== tipoAnterior;

      if (cambioPersona) {
        // La "procedencia robot" es de la persona anterior: si la consulta del
        // nuevo falla o demora, sus tarjetas mostrarían los valores del otro.
        this.resultadosRobot = {};
        this.camposDesdeRobot.clear();
      }

      // Cola de antecedentes (camelCase o snake_case)
      this.colaRaw = (candidato?.cola_antecedentes ?? candidato?.colaAntecedentes ?? null) as ColaRaw | null;

      // En recargas de la MISMA persona (tras guardar) se preservan los PDFs
      // adjuntos que aún no se han subido: resetearlos acá los borraba en
      // silencio justo cuando la subida había fallado y tocaba reintentar.
      this.resetUploadedFilesAsNew(!cambioPersona);
      this.patchSeleccion(proc?.antecedentes ?? null);

      // Cancela cualquier polling del candidato anterior antes de empezar.
      this.cancelDocPolling();

      // opcional: precargar documentos ya existentes
      const ctx = ++this._ctx;
      if (this.cedula) {
        this.loadDataDocumentos(ctx)
          .then(() => this.maybeScheduleDocPolling(ctx, 0))
          .catch((err) => console.error('[selection] Error cargando documentos:', err));

        // Prellenado con lo que ya consultó el robot. Va después del patch de
        // antecedentes guardados para que estos tengan prioridad. Solo cuando
        // CAMBIA la persona: este effect también corre con cada recarga tras
        // guardar (referencia nueva, misma cédula) y los resultados del robot
        // no cambian por guardar — re-pedirlos era una petición por guardado.
        // El sello lo pone prellenarDesdeRobot al APLICAR la respuesta: sellar
        // acá dejaba la consulta perdida para siempre si una recarga la
        // interrumpía a mitad de vuelo.
        if (this.claveRobot() !== this.cedulaRobotConsultada) {
          this.prellenarDesdeRobot(ctx);
        }
      }
    });
  }

  /** Último titular (tipo|número) cuyos resultados de robot ya se aplicaron. */
  private cedulaRobotConsultada: string | null = null;

  /** Llave del titular actual para la consulta del robot. Incluye el número de
   *  consulta del buscador: re-consultar a la persona re-pide los resultados. */
  private claveRobot(): string | null {
    if (!this.cedula) return null;
    return `${String(this.tipoDocumento || 'CC').trim().toUpperCase()}|${this.cedula}#${this.consultaSeq()}`;
  }

  ngOnDestroy(): void {
    this.cancelDocPolling();
  }

  /* ===================== Auto-refresco de documentos ===================== */
  private cancelDocPolling(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** DocKeys cuya cola está FINALIZADO pero que aún no tienen archivo cargado. */
  private pendientesPorCola(): DocKey[] {
    const out: DocKey[] = [];
    for (const k of Object.keys(this.typeMap) as DocKey[]) {
      const colaKey = this.colaKeyMap[k];
      if (!colaKey) continue;
      const it = this.colaRaw?.[colaKey];
      if (!it) continue;
      const est = (it.estado || '').toUpperCase();
      const finalizado = est === 'FINALIZADO' || est === 'DESCARGADO ROBOT';
      const tieneArchivo = !!this.uploadedFiles[k]?.file;
      if (finalizado && !tieneArchivo) out.push(k);
    }
    return out;
  }

  /**
   * Si quedan antecedentes FINALIZADO sin documento, agenda una re-consulta.
   * Se detiene cuando ya cargaron todos, al cambiar de candidato (ctx), o al
   * agotar los intentos.
   */
  private maybeScheduleDocPolling(ctx: number, attempt: number): void {
    if (ctx !== this._ctx) return;
    if (attempt >= this.POLL_MAX_ATTEMPTS) return;
    if (!this.pendientesPorCola().length) return; // todo lo finalizado ya cargó

    this.pollTimer = setTimeout(() => {
      if (ctx !== this._ctx) return;
      // Re-consulta SIN resetear (merge) para no parpadear lo ya cargado.
      this.loadDataDocumentos(ctx, false)
        .then(() => this.maybeScheduleDocPolling(ctx, attempt + 1))
        .catch(() => this.maybeScheduleDocPolling(ctx, attempt + 1));
    }, this.POLL_INTERVAL_MS);
  }

  /* ===================== Helpers de UI/Template ===================== */
  controlName(fld: FieldDef): string { return fld.control ?? fld.key; }
  docKey(fld: FieldDef): DocKey { return fld.key; }
  getOptions(fld: FieldDef): readonly (string | number)[] {
    switch (fld.optionSource) {
      case 'epsList': return this.epsList;
      case 'afpList': return this.afpList;
      case 'categoriasSisben': return this.categoriasSisben;
      case 'medidasCorrectivas': return this.medidasCorrectivasOpts;
      default: return [];
    }
  }
  estadoIcon(v: string | null | undefined): string {
    const s = (v ?? '').toUpperCase();
    if (s === 'CUMPLE') return 'check_circle';
    if (s === 'NO CUMPLE') return 'cancel';
    return 'help_outline';
  }
  estadoColor(v: string | null | undefined): string {
    const s = (v ?? '').toUpperCase();
    if (s === 'CUMPLE') return '#2E7D32';
    if (s === 'NO CUMPLE') return '#C62828';
    return '#6E7781';
  }
  trackByIndex(index: number): number { return index; }

  /**
   * Estado GENERAL de un antecedente, para pintar la tarjeta.
   *
   * Resume en una palabra las tres señales que hoy hay que leer por separado
   * (el valor del campo, si llegó el documento y en qué va la cola del robot),
   * para poder darle un color a la tarjeta y que se vea de un vistazo cuál
   * falta y cuál está lista.
   *
   *   'listo'     verde  — hay valor y documento
   *   'progreso'  ámbar  — el robot está trabajando o está en cola
   *   'alerta'    rojo   — dice NO CUMPLE
   *   'falta'     gris   — sin valor y sin documento
   */
  estadoTarjeta(fld: FieldDef): 'listo' | 'progreso' | 'alerta' | 'falta' {
    const valor = String(this.antecedentes.get(this.controlName(fld))?.value ?? '').trim();
    if (valor.toUpperCase() === 'NO CUMPLE') return 'alerta';

    const cola = this.queueDetailFor(fld);
    const tieneDoc = !!this.uploadedFiles[fld.key]?.file;

    if (valor && (tieneDoc || cola?.finalizado)) return 'listo';
    if (cola?.enProgreso || (cola && !cola.finalizado)) return 'progreso';
    return valor ? 'listo' : 'falta';
  }

  /** Nombre del archivo, o el aviso de que falta. */
  nombreArchivo(fld: FieldDef): string {
    return this.uploadedFiles[fld.key]?.fileName ?? 'Adjuntar documento';
  }

  /** ¿Ya hay un documento cargado para este antecedente? */
  tieneDocumento(fld: FieldDef): boolean {
    return !!this.uploadedFiles[fld.key]?.file;
  }

  /* ===== Cola: helpers que usa el template para la píldora ===== */
  hasQueue(fld: FieldDef): boolean {
    const k = this.colaKeyMap[fld.key];
    return !!(k && this.colaRaw && this.colaRaw[k]);
  }

  colaEstado(fld: FieldDef): string | null {
    const k = this.colaKeyMap[fld.key];
    const it = k ? this.colaRaw?.[k] : undefined;
    if (!it) return null;
    // normaliza: FINALIZADO también se muestra como DESCARGADO ROBOT
    if ((it.estado || '').toUpperCase() === 'FINALIZADO') return 'DESCARGADO ROBOT';
    return it.estado || null;
  }

  queueDetailFor(fld: FieldDef): { finalizado: boolean, enProgreso: boolean, faltan: number | null } | null {
    const k = this.colaKeyMap[fld.key];
    const it = k ? this.colaRaw?.[k] : undefined;
    if (!it) return null;

    const est = (it.estado || '').toUpperCase();
    if (est === 'FINALIZADO' || est === 'DESCARGADO ROBOT') {
      return { finalizado: true, enProgreso: false, faltan: 0 };
    }
    if (est === 'EN_PROGRESO') {
      return { finalizado: false, enProgreso: true, faltan: null };
    }
    return { finalizado: false, enProgreso: false, faltan: typeof it.faltan_antes === 'number' ? it.faltan_antes : null };
  }

  queueLabelFor(fld: FieldDef): string {
    const k = this.colaKeyMap[fld.key];
    const it = k ? this.colaRaw?.[k] : undefined;
    if (!it) return '—';
    const estado = (it.estado || '').toUpperCase();
    if (estado === 'DESCARGADO ROBOT' || estado === 'FINALIZADO') return 'DESCARGADO ROBOT';
    if (typeof it.faltan_antes === 'number') return `${it.faltan_antes} antes`;
    return '—';
  }

  queueTooltipFor(fld: FieldDef): string {
    const k = this.colaKeyMap[fld.key];
    const it = k ? this.colaRaw?.[k] : undefined;
    if (!it) return 'Sin datos de cola';
    const estado = (it.estado || '').toUpperCase();
    if (estado === 'DESCARGADO ROBOT' || estado === 'FINALIZADO') {
      return 'Este antecedente ya fue DESCARGADO ROBOT.';
    }
    const n = typeof it.faltan_antes === 'number' ? it.faltan_antes : null;
    return n == null
      ? `Estado: ${estado}`
      : `Estado: ${estado} · Faltan ${n} antes en la cola`;
  }

  queuePillClass(fld: FieldDef): string {
    const est = (this.colaEstado(fld) || '').toUpperCase();
    if (est === 'DESCARGADO ROBOT') return 'q-pill q-ok';
    if (est === 'EN_PROGRESO') return 'q-pill q-progress';
    if (est === 'SIN_CONSULTAR') return 'q-pill q-wait';
    return 'q-pill q-none';
  }

  /* ===================== Carga antecedentes -> form ===================== */
  /**
   * Devuelve el valor EXACTO del catálogo que corresponde a `valor`, o el
   * original si no hay ninguno parecido.
   *
   * Un `mat-select` solo pinta la opción si el valor del control es idéntico
   * (===) al de un `mat-option`. Lo guardado no siempre coincide letra por
   * letra con el catálogo, y entonces el campo se veía VACÍO aunque el dato
   * estuviera bien guardado. Casos reales medidos en prod:
   *   - `PROTECCIÓN ` con tilde (17 filas) contra la opción `PROTECCION`.
   *   - `Sin Buscar` / `Cumple` guardados en minúsculas, que el patch pasaba a
   *     MAYÚSCULAS y dejaban de coincidir con opciones de escritura mixta.
   * Se compara sin tildes, sin mayúsculas y con espacios colapsados.
   */
  private alinearConCatalogo(valor: unknown, opciones: readonly (string | number)[]): unknown {
    if (valor === null || valor === undefined || valor === '') return valor;
    const clave = claveComparable(valor);
    if (!clave) return valor;
    const match = opciones.find(o => claveComparable(o) === clave);
    return match !== undefined ? match : valor;
  }

  private patchSeleccion(raw: any): void {
    const patch = buildPatchFromAntecedentes(raw, this.formPatchBase) as any;

    // Los campos de lista se alinean con SU catálogo antes de entrar al form.
    for (const fld of this.fields) {
      if (fld.type !== 'list') continue;
      const control = fld.control ?? fld.key;
      patch[control] = this.alinearConCatalogo(patch[control], this.getOptions(fld));
    }
    // Los de estado comparten el catálogo CUMPLE / NO CUMPLE / SIN BUSCAR.
    for (const fld of this.fields) {
      if (fld.type !== 'estado') continue;
      const control = fld.control ?? fld.key;
      patch[control] = this.alinearConCatalogo(patch[control], this.estados);
    }

    this.antecedentes.patchValue(patch, { emitEvent: false });
  }

  /* ===================== Prellenado desde el robot ===================== */

  /** Resultados del robot para el candidato actual (para mostrar procedencia). */
  resultadosRobot: ResultadosAntecedentes['campos'] = {};

  /** Campos que quedaron diligenciados por el robot en esta carga. */
  camposDesdeRobot = new Set<string>();

  /** Mapa: clave del endpoint -> control del formulario. */
  private readonly robotKeyToControl: Record<string, string> = {
    policivos: 'policivos',
    ofac: 'ofac',
    procuraduria: 'procuraduria',
    contraloria: 'contraloria',
    eps: 'eps',
    afp: 'afp',
    sisben: 'sisben',
    medidas_correctivas: 'medidasCorrectivas',
  };

  /** Un control se considera vacío si no tiene valor útil todavía. */
  private estaVacio(control: string): boolean {
    const v = this.antecedentes.get(control)?.value;
    if (v === null || v === undefined) return true;
    const s = String(v).trim();
    // 'SIN BUSCAR' es el placeholder de "todavía nadie lo revisó".
    return s === '' || s.toUpperCase() === 'SIN BUSCAR';
  }

  /**
   * Trae lo que ya consultó el robot y llena SOLO los campos vacíos.
   *
   * No pisa nada diligenciado: si el analista ya eligió un valor, o si venían
   * antecedentes guardados en el proceso, se respetan. Tampoco autocompleta
   * cuando el robot no dejó un veredicto interpretable (`valor === null`),
   * que es el caso de procuraduría/contraloría en estado "Consultado".
   */
  private async prellenarDesdeRobot(ctx: number): Promise<void> {
    if (!this.cedula) return;

    try {
      const res = await firstValueFrom(
        this.robots.getResultadosAntecedentes(this.cedula, this.tipoDocumento)
      );
      // El candidato pudo cambiar mientras respondía el backend.
      if (ctx !== this._ctx) return;

      this.resultadosRobot = res?.campos ?? {};
      this.camposDesdeRobot.clear();
      if (!res?.encontrado) {
        // El robot AÚN no tiene resultados: no sellar, para que el próximo
        // refresco vuelva a preguntar (sellar acá dejaba las tarjetas en
        // "Sin consultar" para siempre aunque el robot terminara después).
        this.cdr.markForCheck();
        return;
      }
      // Solo una respuesta CON resultados sella al titular; una vacía o
      // descartada se vuelve a pedir en el próximo refresco.
      this.cedulaRobotConsultada = this.claveRobot();

      // Índice control -> campo, para saber contra qué catálogo alinear.
      const porControl = new Map(this.fields.map(f => [f.control ?? f.key, f]));

      const patch: Record<string, string | number> = {};
      for (const [robotKey, control] of Object.entries(this.robotKeyToControl)) {
        const campo = (this.resultadosRobot as any)[robotKey];
        const valor = campo?.valor;
        if (valor === null || valor === undefined || valor === '') continue;
        if (!this.estaVacio(control)) continue;

        // El robot normaliza a sus propios tokens ("No Tiene", "PROTECCION"…),
        // que no siempre están escritos igual que la opción del catálogo. Sin
        // alinear, el select quedaba vacío pese a haberse prellenado.
        const fld = porControl.get(control);
        const opciones = fld?.type === 'estado'
          ? this.estados
          : (fld ? this.getOptions(fld) : []);
        patch[control] = this.alinearConCatalogo(valor, opciones) as string | number;
        this.camposDesdeRobot.add(control);
      }

      if (Object.keys(patch).length) {
        this.antecedentes.patchValue(patch, { emitEvent: false });
        this.antecedentes.markAsDirty();
      }
      this.cdr.markForCheck();
    } catch (err) {
      // Es una ayuda, no un requisito: si falla, el formulario sigue usable.
      console.warn('[selection] No se pudieron cargar los resultados del robot:', err);
    }
  }

  /** Texto crudo que devolvió el robot para un campo, para mostrarlo en la UI. */
  crudoRobot(fld: FieldDef): string | null {
    const control = fld.control ?? fld.key;
    const entry = Object.entries(this.robotKeyToControl).find(([, c]) => c === control);
    if (!entry) return null;
    return (this.resultadosRobot as any)[entry[0]]?.crudo ?? null;
  }

  /** ¿Este campo lo llenó el robot en esta carga? */
  vieneDelRobot(fld: FieldDef): boolean {
    return this.camposDesdeRobot.has(fld.control ?? fld.key);
  }

  /* ===================== Documentos (estado/descarga/subida) ===================== */
  private resetUploadedFilesAsNew(preservarPendientes = false): void {
    (Object.keys(this.typeMap) as DocKey[]).forEach(k => {
      // Un File adjuntado y aún no guardado sobrevive al reset cuando la
      // persona es la misma (recarga tras guardar): borrarlo obligaba a
      // buscar el archivo otra vez en disco tras cualquier fallo de subida.
      const actual = this.uploadedFiles[k];
      if (preservarPendientes && actual?.changed && actual.file instanceof File) return;
      this.uploadedFiles[k] = {
        file: undefined,
        fileName: k === 'pensionSemanas' ? 'Sin consultar' : 'Adjuntar documento',
        changed: false,
        updatedAt: undefined,
        updatedAtLabel: undefined,
        loading: true,
        error: null,
      };
    });
  }

  async loadDataDocumentos(ctx: number, resetFirst = true): Promise<Set<DocKey>> {
    const tocados = new Set<DocKey>();
    if (!this.cedula) return tocados;

    try {
      // Expediente completo (sin filtro de tipo), compartido con el pipeline y
      // contratación vía caché por cédula. El polling (resetFirst=false) fuerza
      // ir al servidor: su razón de ser es ver documentos NUEVOS del robot.
      const docs: any[] = await firstValueFrom(
        this.docsSrv.getDocumentosDeCandidato(this.cedula, { force: !resetFirst })
      );
      if (ctx !== this._ctx || !Array.isArray(docs)) return tocados;

      // Un fetch que sí respondió limpia el rastro de un fallo anterior: lo
      // que no venga en la respuesta es "sin documento", no "error". Sin esto
      // el polling exitoso dejaba recuadros diciendo "Error al cargar".
      (Object.keys(this.uploadedFiles) as DocKey[]).forEach((k) => {
        const e = this.uploadedFiles[k];
        if (e?.error) {
          this.uploadedFiles[k] = {
            ...e,
            error: null,
            ...(e.file ? {} : { fileName: k === 'pensionSemanas' ? 'Sin consultar' : 'Adjuntar documento' }),
          };
        }
      });

      // Reset all uploadedFiles to default before populating.
      // En modo polling (resetFirst=false) NO reseteamos: hacemos merge para no
      // borrar/parpadear los documentos que ya estaban cargados.
      // SIEMPRE preservando pendientes: el barrido por cambio de persona ya lo
      // hizo el effect; resetear acá sin preservar anulaba esa protección un
      // tick después y el PDF adjunto se perdía igual.
      if (resetFirst) this.resetUploadedFilesAsNew(true);

      for (const d of docs) {
        if (ctx !== this._ctx) break;
        // Find which key corresponds to this doc type
        const typeKey = (Object.keys(this.typeMap) as DocKey[]).find(k => this.typeMap[k] === d.type);
        if (!typeKey) continue;

        // No pisar un PDF que el usuario ya adjuntó y todavía no ha guardado:
        // el refresco por polling llegaría a borrarle el archivo pendiente.
        const pendiente = this.uploadedFiles[typeKey];
        if (pendiente?.changed && pendiente.file instanceof File) continue;

        const nombre = d.original_filename || d.title || 'Documento sin título';
        const fileUrl = d.file_url; // Use URL directly
        const iso: string | undefined = d.uploaded_at || undefined;

        // Update the file entry
        this.uploadedFiles[typeKey] = {
          fileName: nombre,
          file: fileUrl, // Store string URL
          updatedAt: iso,
          updatedAtLabel: this.formatFecha(iso),
          changed: false,
          loading: false,
          error: null,
        };
        tocados.add(typeKey);
      }
    } catch (err: any) {
      // If 404/Not Found, just means no docs, which is fine.
      if (err?.error?.error !== 'No se encontraron documentos') {
        console.error('Error loading documents:', err);
        // Un error real (500, red caída) dejaba los recuadros girando para
        // siempre y solo se veía en consola: el operador leía "sin documentos"
        // donde había un fallo de carga. Se apagan los spinners (sin tocar
        // PDFs pendientes de subir) y se avisa una vez por cédula — el polling
        // reintenta cada tanto y no puede convertirse en una lluvia de toasts.
        if (ctx === this._ctx) {
          (Object.keys(this.uploadedFiles) as DocKey[]).forEach((k) => {
            const e = this.uploadedFiles[k];
            if (e?.loading && !(e.changed && e.file instanceof File)) {
              this.uploadedFiles[k] = {
                ...e,
                loading: false,
                error: 'No se pudieron cargar los documentos',
                // Solo si el recuadro no tiene un documento ya cargado: un doc
                // visible sigue siendo válido aunque el refresco haya fallado.
                ...(e.file ? {} : { fileName: 'Error al cargar' }),
              };
            }
          });
          if (this.avisoErrorDocsCed !== this.cedula) {
            this.avisoErrorDocsCed = this.cedula;
            Swal.fire({
              icon: 'warning',
              title: 'No se pudieron cargar los documentos',
              text: 'Revisa la conexión y vuelve a intentar; lo que se muestra puede estar incompleto.',
              toast: true,
              position: 'top-end',
              timer: 6000,
              timerProgressBar: true,
              showConfirmButton: false,
            });
          }
        }
      }
    }
    // OnPush: la carga es asíncrona; marcamos para que el PDF y la fecha se
    // pinten en cuanto llegan (incluido el refresco por polling).
    this.cdr.markForCheck();
    return tocados;
  }

  verArchivo(key: DocKey) {
    const entry = this.uploadedFiles[key];
    const f = entry?.file;
    if (!f) {
      return void Swal.fire('Sin documento',
        'Todavía no hay un archivo cargado en este campo.', 'info');
    }

    // Se abre por `ElectronWindowService` y no con `window.open`: el main
    // process de TesoroApp deniega TODO `window.open` (setWindowOpenHandler en
    // app.js). Con una URL http la delegaba al navegador del sistema y por eso
    // "funcionaba"; con un archivo recién adjuntado es un `blob:`, que no se
    // puede delegar, y no pasaba nada al darle "Ver PDF".
    if (typeof f === 'string') {
      this.ventanas.openExternal(f);
    } else {
      void this.ventanas.openPdfFromBlob(f, { title: entry?.fileName || 'Documento' });
    }
  }

  subirArchivo(event: any | Blob, key: DocKey, fileName?: string): void {
    let file: File | null = null;

    if (event instanceof Blob && !(event as any).target) {
      file = new File([event], fileName || 'archivo.pdf', { type: 'application/pdf' });
    } else if (event?.target?.files?.length) {
      file = event.target.files[0] as File;
    }
    if (!file) return;

    const nameOk = file.name && file.name.length <= 100;
    if (!nameOk) {
      return void Swal.fire('Nombre muy largo',
        'El nombre del archivo no puede pasar de 100 caracteres. Renómbralo y vuelve a intentar.', 'warning');
    }

    // El navegador reporta el tipo real del archivo en `file.type`. Antes
    // bastaba con que el NOMBRE terminara en .pdf, así que un .exe renombrado
    // pasaba el filtro y solo lo frenaba el backend. Si el navegador no sabe
    // el tipo (`''`, pasa con algunos escáneres), se acepta por extensión.
    const tipo = (file.type || '').toLowerCase();
    const terminaEnPdf = file.name.toLowerCase().endsWith('.pdf');
    const esPdf = tipo === 'application/pdf' || (tipo === '' && terminaEnPdf);
    if (!esPdf) {
      return void Swal.fire('Solo se aceptan PDF',
        'Ese archivo no es un PDF. Si lo tienes en Word o en foto, conviértelo a PDF y súbelo de nuevo.',
        'warning');
    }
    if (file.size === 0) {
      return void Swal.fire('Archivo vacío',
        'El archivo no tiene contenido. Revísalo y vuelve a subirlo.', 'warning');
    }

    this.uploadedFiles[key] = {
      file,
      fileName: file.name,
      changed: true,
      loading: false,
      updatedAt: undefined,
      updatedAtLabel: undefined,
      error: null,
    };
  }

  isOlderThan(key: DocKey, days: number): boolean {
    const entry = this.uploadedFiles[key];
    if (!entry) return false;
    let ts: number | undefined;

    if (typeof entry.updatedAt === 'number') ts = entry.updatedAt;
    else if (typeof entry.updatedAt === 'string') {
      const p = Date.parse(entry.updatedAt);
      if (!Number.isNaN(p)) ts = p;
    } else if (entry.file instanceof File) {
      ts = entry.file.lastModified;
    }
    if (ts == null) return false;

    return (Date.now() - ts) > (days * 24 * 60 * 60 * 1000);
  }

  /* ===================== Forzar re-consulta de UNA fuente ===================== */

  /** Documento cuyo botón "Forzar consultar" está en vuelo. */
  forzandoFuente: DocKey | null = null;

  /**
   * Solo tienen robot los documentos con fuente en la cola; `figuraHumana` y
   * `pensionSemanas` se suben a mano, así que ahí no hay nada que forzar.
   */
  puedeForzarFuente(key: DocKey): boolean {
    return !!this.colaKeyMap[key];
  }

  /**
   * Re-abre SOLO la fuente de este documento para que el robot la vuelva a
   * consultar. A diferencia del botón del pipeline (que re-abre las 8), esto
   * cuesta una sola consulta.
   *
   * Ojo: Policivos y Rama Judicial comparten la fuente `policivo`, así que
   * forzar cualquiera de los dos re-consulta ambos: es una sola consulta del
   * robot que produce los dos PDF.
   */
  async forzarConsultaDeFuente(key: DocKey, label: string): Promise<void> {
    const fuente = this.colaKeyMap[key];
    const doc = (this.cedula || '').trim();
    if (!fuente || !doc || this.forzandoFuente) return;

    // El robot va a producir resultados nuevos: el próximo refresco de esta
    // persona debe volver a pedirlos aunque la cédula no haya cambiado.
    this.cedulaRobotConsultada = null;

    const compartida = fuente === 'policivo'
      ? '<br><br>Policivos y Rama Judicial son la misma consulta del robot: se actualizan los dos.'
      : '';

    const { isConfirmed } = await Swal.fire({
      icon: 'question',
      title: 'Forzar consultar',
      html: `Se volverá a consultar <b>${label}</b> de la cédula <b>${doc}</b>.<br><br>`
        + 'El estado queda en <b>SIN_CONSULTAR</b> y el robot sube el PDF nuevo '
        + 'en los próximos minutos. Las demás fuentes no se tocan.' + compartida,
      showCancelButton: true,
      confirmButtonText: 'Sí, volver a consultar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#111827',
    });
    if (!isConfirmed) return;

    this.forzandoFuente = key;
    this.cdr.markForCheck();
    try {
      const resp = await firstValueFrom(this.rpc.forzarConsultaFuente({
        numero_documento: doc,
        tipo_doc: this.tipoDocumento,
        fuente,
      }));
      await Swal.fire({
        icon: resp?.reabierto ? 'success' : 'info',
        title: resp?.reabierto ? 'Re-consulta pedida' : 'Sin cambios',
        text: resp?.mensaje || 'Listo.',
        confirmButtonColor: '#111827',
      });
    } catch (err: any) {
      console.error('[antecedentes] forzar fuente falló', err);
      await Swal.fire({
        icon: 'error',
        title: 'No se pudo',
        text: mensajeDeErrorLog('selection/forzar-fuente', err, 'No se pudo volver a consultar este documento.'),
        confirmButtonColor: '#111827',
      });
    } finally {
      this.forzandoFuente = null;
      this.cdr.markForCheck();
    }
  }

  private formatFecha(iso?: string): string | undefined {
    if (!iso) return undefined;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return undefined;
    try {
      return d.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' });
    } catch {
      return d.toLocaleString();
    }
  }



  onlyInteger(e: KeyboardEvent) {
    const allowed = ['Backspace', 'Tab', 'ArrowLeft', 'ArrowRight', 'Delete', 'Home', 'End'];
    if (allowed.includes(e.key)) return;
    if (!/^\d$/.test(e.key)) e.preventDefault();
  }

  /* ===================== Guardar selección + subir PDFs ===================== */
  async imprimirVerificacionesAplicacion(): Promise<void> {
    // Snapshot síncrono: cualquier `await` de aquí en adelante da chance a que
    // el candidato se recargue y resetUploadedFilesAsNew() borre los adjuntos.
    const pendientes = this.capturarPendientes(Object.keys(this.typeMap) as DocKey[]);
    // El DESTINO también se congela acá: si el operador cambia de candidato
    // mientras el upsert está en vuelo, leer this.cedula al momento de subir
    // mandaría los PDFs de esta persona al expediente de la otra.
    const destino = { cedula: this.cedula, tipoDoc: this.tipoDocumento };

    if (this.antecedentes.invalid) {
      this.antecedentes.markAllAsTouched();
      // OnPush: sin esto los selects no se pintan en rojo hasta otro evento.
      this.cdr.markForCheck();
      const faltantes = this.fields
        .filter(f => f.required && this.antecedentes.get(this.controlName(f))?.invalid)
        .map(f => `<li><b>${f.label}</b></li>`)
        .join('');
      await Swal.fire({
        icon: 'warning',
        title: 'Campos incompletos',
        html: `<p>Para guardar debes elegir una opción en:</p>`
          + `<ul style="text-align:left; margin-bottom:0;">${faltantes}</ul>`,
        confirmButtonColor: '#111827',
      });
      return;
    }
    const cand = this.candidatoSeleccionado?.();
    const numero = (cand?.numero_documento ?? cand?.numeroDocumento ?? '').toString().trim();
    if (!numero) {
      await Swal.fire('Error', 'No se encontró el número de documento del candidato.', 'error');
      return;
    }

    const v: Record<string, unknown> = this.antecedentes.value ?? {};

    // ------ Normalizadores fuertes ------
    const toUpperStrOrNull = (x: unknown): string | null => {
      const s = (x ?? '').toString().trim().toUpperCase();
      return s ? s : null;
    };
    const normalizeEstado = (x: unknown): 'CUMPLE' | 'NO CUMPLE' | null => {
      const s = (x ?? '').toString().trim().toUpperCase();
      return s === 'CUMPLE' || s === 'NO CUMPLE' ? s : null;
    };
    const toNumOrNull = (x: unknown): number | null => (x === '' || x == null ? null : Number(x));

    // Medidas correctivas: número o 'CUMPLE', otro -> null
    let medidas: number | 'CUMPLE' | null = null;
    const mc = v['medidasCorrectivas'];
    if (mc !== '' && mc != null) {
      const s = String(mc).trim().toUpperCase();
      medidas = /^\d+$/.test(s) ? Number(s) : (s === 'CUMPLE' ? 'CUMPLE' : null);
    }

    const payload: AntecedentesPayload = {
      eps: toUpperStrOrNull(v['eps']),
      afp: toUpperStrOrNull(v['afp']),
      policivos: normalizeEstado(v['policivos']),
      procuraduria: normalizeEstado(v['procuraduria']),
      contraloria: normalizeEstado(v['contraloria']),
      ramaJudicial: normalizeEstado(v['ramaJudicial']),
      sisben: toUpperStrOrNull(v['sisben']),
      ofac: normalizeEstado(v['ofac']),
      medidasCorrectivas: medidas,
      semanasCotizadas: toNumOrNull(v['semanasCotizadas']),
    };

    try {
      await firstValueFrom(this.rpc.upsertSeleccionByDocumento(numero, payload, this.procesoId ?? undefined, {
        modificacionForzada: this.modificacionForzada(),
        modificadoPor: this.modificadoPor(),
      }));

      // Los PDFs van ANTES de `guardado.emit()`. Emitir primero hace que el
      // padre recargue el candidato -> effect() -> resetUploadedFilesAsNew(),
      // que borra los File pendientes; la subida quedaba vacía y aun así
      // reportaba "todo OK". Se notaba sobre todo en sisbén (8) y AFP (11),
      // que son los únicos que ningún robot vuelve a llenar.
      const res = await this.subirTodosLosArchivos(pendientes, destino);

      this.guardado.emit();
      await Swal.fire('¡Guardado!', 'Se actualizaron los antecedentes del proceso.', 'success');

      if (res.todosOk) {
        if (res.exitosos.length) {
          Swal.fire('¡Listo!', 'Todos los documentos se subieron correctamente.', 'success');
        }
      } else {
        // Build detailed error message
        const listaErrores = res.fallidos.map(f => `<li><b>${f.key}:</b> ${f.error}</li>`).join('');
        const htmlMsg = `
          <p>Algunos documentos no se pudieron subir:</p>
          <ul style="text-align: left; margin-bottom: 0;">${listaErrores}</ul>
        `;

        Swal.fire({
          title: 'Atención',
          html: htmlMsg,
          icon: 'warning',
          confirmButtonText: 'Entendido'
        });
      }
    } catch (err: any) {
      console.error('[selection] Error guardando antecedentes:', err);
      const body = err?.error;
      let msg = '';
      if (body?.detail) {
        msg = body.detail;
      } else if (body && typeof body === 'object') {
        const entries = Object.entries(body).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
        msg = entries.length ? entries.join(' | ') : 'No fue posible guardar los antecedentes.';
      } else {
        msg = err?.message || 'No fue posible guardar los antecedentes. Verifique su conexión.';
      }
      await Swal.fire('Error', msg, 'error');
    }
  }

  /**
   * Snapshot de los PDFs adjuntados y aún no subidos.
   *
   * DEBE llamarse de forma síncrona, antes de cualquier `await`: en cuanto el
   * padre recarga el candidato (`(guardado)="recargarCandidato()"`), el
   * effect() de este componente dispara resetUploadedFilesAsNew() y deja
   * `file: undefined, changed: false`. Si se lee después, no queda nada que
   * subir y la subida se pierde en silencio.
   */
  capturarPendientes(keys: DocKey[]): PendienteUpload[] {
    return keys
      .filter(k => !!this.uploadedFiles[k]?.changed && this.uploadedFiles[k].file instanceof File)
      .map(k => ({
        key: k,
        file: this.uploadedFiles[k].file as File,
        fileName: this.uploadedFiles[k].fileName ?? 'documento.pdf',
        typeId: this.typeMap[k],
      }));
  }

  async subirTodosLosArchivos(
    keysOPendientes: DocKey[] | PendienteUpload[],
    destino?: { cedula: string | null; tipoDoc: string | null },
  ): Promise<{ todosOk: boolean; exitosos: DocKey[]; fallidos: { key: DocKey; error: string }[] }> {
    // `destino` viene congelado desde antes del upsert; sin él (llamadas
    // directas) se usa el candidato actual.
    const ced = destino ? destino.cedula : this.cedula;
    const tipoDoc = destino ? destino.tipoDoc : this.tipoDocumento;
    if (!ced) return { todosOk: true, exitosos: [], fallidos: [] };

    const aEnviar: PendienteUpload[] =
      typeof keysOPendientes[0] === 'string' || keysOPendientes.length === 0
        ? this.capturarPendientes(keysOPendientes as DocKey[])
        : (keysOPendientes as PendienteUpload[]);

    if (!aEnviar.length) return { todosOk: true, exitosos: [], fallidos: [] };

    // Reset errors for sending files
    aEnviar.forEach(({ key }) => {
      if (this.uploadedFiles[key]) this.uploadedFiles[key].error = null;
    });

    const promesas = aEnviar.map(({ key, file, fileName, typeId }) =>
      new Promise<void>((resolve, reject) => {
        this.docsSrv.guardarDocumento(fileName, ced, typeId, file, undefined, tipoDoc || undefined).subscribe({
          next: () => {
            const entry = this.uploadedFiles[key];
            if (entry) {
              entry.changed = false;
              entry.updatedAt = new Date().toISOString();
              entry.updatedAtLabel = this.formatFecha(entry.updatedAt as string);
              entry.error = null;
            }
            resolve();
          },
          error: (err) => {
            let msg = 'Error desconocido';
            if (err?.error?.error) {
              const e = err.error.error;
              msg = Array.isArray(e) ? e.join(', ') : String(e);
            } else if (err?.error?.detail) {
              msg = err.error.detail;
            } else if (err?.message) {
              msg = err.message;
            }

            // Guardar error en estado local también (opcional para mostrar en UI inline)
            if (this.uploadedFiles[key]) {
              this.uploadedFiles[key].error = msg;
            }
            reject(new Error(msg));
          },
        });
      })
    );

    const settled = await Promise.allSettled(promesas);
    const exitosos: DocKey[] = [];
    const fallidos: { key: DocKey; error: string }[] = [];
    settled.forEach((r, i) => {
      const key = aEnviar[i].key;
      if (r.status === 'fulfilled') {
        exitosos.push(key);
      } else {
        const reason = (r as PromiseRejectedResult).reason;
        const msg = reason?.message || String(reason);
        fallidos.push({ key, error: msg });
      }
    });

    return { todosOk: fallidos.length === 0, exitosos, fallidos };
  }
}

/* ===================== Helpers puros (fuera de la clase) ===================== */
function up(v: unknown): string { return v == null ? '' : String(v).toUpperCase().trim(); }

/**
 * Clave para comparar un valor guardado contra las opciones de un catálogo:
 * sin tildes, en mayúsculas y con los espacios colapsados.
 *
 * Solo se usa para COMPARAR; lo que entra al formulario siempre es el valor
 * exacto del catálogo (ver `alinearConCatalogo`).
 */
function claveComparable(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}
function isEmpty(v: unknown): boolean { return v === '' || v == null; }
function toNumOrEmpty(v: unknown): number | '' {
  if (v === '' || v == null) return '';
  const n = Number(v);
  return Number.isFinite(n) ? n : '';
}

/** Recibe la lista [{nombre, observacion}] o un diccionario normalizado y devuelve un patch para el form */
function buildPatchFromAntecedentes(raw: any, base: FormPatchBase): FormPatchBase {
  const initial: FormPatchBase = { ...base };

  // Diccionario normalizado
  if (raw && !Array.isArray(raw) && (raw.eps || raw.policivos || raw.ramaJudicial || raw.medidasCorrectivas)) {
    return {
      ...initial,
      eps: up(raw.eps),
      afp: up(raw.afp),
      policivos: up(raw.policivos),
      procuraduria: up(raw.procuraduria),
      contraloria: up(raw.contraloria),
      ramaJudicial: up(raw.ramaJudicial ?? raw.rama_judicial),
      sisben: up(raw.sisben),
      ofac: up(raw.ofac),
      medidasCorrectivas: up(raw.medidasCorrectivas),
      semanasCotizadas: toNumOrEmpty(raw.semanasCotizadas ?? raw.semanas_cotizadas),
    };
  }

  // Lista [{nombre, observacion}]
  const lista: Array<{ nombre?: string; observacion?: any; }> | undefined =
    Array.isArray(raw) ? raw :
      Array.isArray(raw?.proceso?.antecedentes) ? raw.proceso.antecedentes :
        Array.isArray(raw?.antecedentes) ? raw.antecedentes : undefined;

  if (!lista) return initial;

  const out: any = { ...initial };
  for (const it of lista) {
    const key = MAP_NOMBRE_TO_KEY[up(it?.nombre)];
    if (!key) continue;

    if (key === 'semanasCotizadas') {
      out['semanasCotizadas'] = toNumOrEmpty(it?.observacion);
    } else if (key === 'medidasCorrectivas') {
      const obs = it?.observacion;
      out['medidasCorrectivas'] = isEmpty(obs) ? '' : (/^\d+$/.test(String(obs)) ? Number(obs) : up(obs));
    } else {
      out[key] = up(it?.observacion);
    }
  }
  return out as FormPatchBase;
}
