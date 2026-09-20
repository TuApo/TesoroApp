/**
 * REGISTRO DE INCAPACIDAD (v2).
 *
 * Reemplaza al viejo `formulario-incapacidad`, que es inusable: su boton de
 * envio esta atado a `form.invalid` con 10 controles obligatorios que ningun
 * flujo llena, y sus reglas de negocio vivian (mal) en el navegador.
 *
 * Principios de esta pantalla:
 *  1. NINGUNA regla de negocio se reimplementa en TypeScript. Dias, dias de
 *     empresa, dias de entidad, prorroga, traslape, prescripcion, soportes
 *     exigidos y responsable de pago SIEMPRE salen de
 *     `POST /Incapacidades/v2/validar`. Aqui solo se pintan.
 *  2. Estado 100% en SIGNALS. La app es ZONELESS: cualquier campo mutado
 *     dentro de un `subscribe` que no sea un signal NO repinta. El puente
 *     entre el `ReactiveForm` y la vista es el signal `valores`.
 *  3. El boton de guardar NUNCA se ata a `form.invalid` sin explicacion: se
 *     muestra exactamente que falta y se hace scroll al primer campo malo.
 *  4. Sin fugas: `takeUntilDestroyed` en todos los flujos y `ngOnDestroy`
 *     liberando los object URLs de las vistas previas.
 *  5. Sin `moment` y sin `toISOString()` (en UTC-5 resta un dia): todas las
 *     fechas pasan por `aIsoCorto` / `aIsoCortoFlexible`.
 */

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnDestroy,
  TemplateRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { Observable, Subject, from, merge, of, timer } from 'rxjs';
import {
  catchError,
  concatMap,
  debounce,
  distinctUntilChanged,
  finalize,
  map,
  startWith,
  switchMap,
  tap,
  toArray,
} from 'rxjs/operators';

import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';

import { BuscadorRemotoComponent } from '@/app/shared/components/buscador-remoto/buscador-remoto.component';
import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';
import { obtenerUsuarioActual } from '@/app/core/utils/usuario-actual';

import { IncapacidadService } from '../../services/incapacidad/incapacidad.service';
import { IncapacidadV2Service } from '../../services/incapacidad-v2/incapacidad-v2.service';
import {
  DatosFormularioSaludTotal,
  DialogoFormularioSaludTotalComponent,
} from './dialogos/dialogo-formulario-salud-total/dialogo-formulario-salud-total.component';
import {
  ARL_POR_DEFECTO,
  AlertaValidacion,
  CodigoDiagnostico,
  CrearIncapacidadV2Request,
  DatosContratacionResponse,
  EmpleadoBusqueda,
  EpsMatrizItem,
  EstadoDocumento,
  IncapacidadV2,
  IpsBusqueda,
  SoporteRequerido,
  TipoIncapacidad,
  TipoSoporte,
  ValidacionResponse,
  ValidarIncapacidadRequest,
  etiquetaTemporal,
} from '../../models/incapacidad-v2.model';
import {
  aIsoCorto,
  aIsoCortoFlexible,
  calcularEdad,
  diasCalendarioInclusive,
  parsearFechaFlexible,
} from '../../utils/fechas';
import { codigoSinGuion } from '../../utils/codigos';

// ─────────────────────────────────────────────────────────────────────────
// Constantes de presentacion (solo UI: nada de reglas de negocio)
// ─────────────────────────────────────────────────────────────────────────

/** Orden EXACTO de los cargadores pedido por la funcional. */
const ORDEN_SOPORTES: readonly TipoSoporte[] = [
  'INCAPACIDAD_MEDICA',
  'HISTORIAL_CLINICO',
  'REGISTRO_CIVIL',
  'REGISTRO_NACIDO_VIVO',
  'FURAT',
  'FURIPS',
  'SOAT',
  'FORMULARIO_SALUD_TOTAL',
] as const;

/** Icono de cada soporte (decorativo). */
const ICONO_SOPORTE: Readonly<Record<TipoSoporte, string>> = {
  INCAPACIDAD_MEDICA: 'medical_services',
  HISTORIAL_CLINICO: 'clinical_notes',
  REGISTRO_CIVIL: 'badge',
  REGISTRO_NACIDO_VIVO: 'child_care',
  FURAT: 'report',
  FURIPS: 'local_hospital',
  SOAT: 'directions_car',
  FORMULARIO_SALUD_TOTAL: 'assignment',
};

/** Etiqueta de respaldo por si el backend no manda `etiqueta`. */
const ETIQUETA_SOPORTE: Readonly<Record<TipoSoporte, string>> = {
  INCAPACIDAD_MEDICA: 'Incapacidad',
  HISTORIAL_CLINICO: 'Historia clinica',
  REGISTRO_CIVIL: 'Registro civil',
  REGISTRO_NACIDO_VIVO: 'Registro de nacido vivo',
  FURAT: 'FURAT',
  FURIPS: 'FURIPS',
  SOAT: 'SOAT',
  FORMULARIO_SALUD_TOTAL: 'Formulario Salud Total',
};

/**
 * Formato oficial de Salud Total ("Formato para descarte de evento laboral", M-GINT-F103):
 * es el que hay que diligenciar y subir como soporte cuando la EPS es Salud Total y el tipo
 * es enfermedad general. Se enlaza para que ninguna oficina tenga que adivinar cual es.
 */
export const URL_FORMATO_SALUD_TOTAL =
  'https://saludtotal.com.co/wp-content/uploads/2025/05/M-GINT-F103-FORMATO-PARA-DESCARTE-DE-EVENTO-LABORAL.pdf';

/** Icono por nivel de alerta. */
const ICONO_ALERTA: Readonly<Record<string, string>> = {
  INFO: 'info',
  ADVERTENCIA: 'warning_amber',
  CRITICA: 'error',
};

/** Tipos de archivo aceptados en los soportes. */
const MIME_ACEPTADOS = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];

/** Tamano maximo por soporte: 10 MB. */
const TAMANO_MAXIMO = 10 * 1024 * 1024;

/** Espera antes de pedir una nueva validacion al backend. */
const MS_DEBOUNCE_VALIDACION = 400;

/** Opciones de tipo de documento cuando hay que capturarlo a mano. */
const TIPOS_DOCUMENTO = ['CC', 'CE', 'TI', 'PA', 'PPT', 'NIT'] as const;

/** Opciones de sexo cuando hay que capturarlo a mano. */
const OPCIONES_SEXO = ['MASCULINO', 'FEMENINO', 'OTRO'] as const;

// ─────────────────────────────────────────────────────────────────────────
// Tipos auxiliares de la vista
// ─────────────────────────────────────────────────────────────────────────

/** Estado de un archivo elegido para un soporte. */
interface ArchivoSoporte {
  archivo: File;
  nombre: string;
  tamanoTexto: string;
  esImagen: boolean;
  esPdf: boolean;
  /** Object URL para la vista previa (se libera en `ngOnDestroy`). */
  urlPrevia: string;
  /** Solo para PDF: el `src` de un iframe es RESOURCE_URL y exige bypass. */
  urlPreviaSegura: SafeResourceUrl | null;
  estado: 'pendiente' | 'subiendo' | 'cargado' | 'error';
  mensajeError: string;
}

/** Tarjeta de soporte ya lista para pintar. */
interface VistaSoporte {
  tipo: TipoSoporte;
  etiqueta: string;
  obligatorio: boolean;
  icono: string;
  archivo: ArchivoSoporte | null;
  arrastrando: boolean;
  /** El servidor ya tiene este soporte (no hace falta volver a subirlo). */
  yaEnServidor: boolean;
}

/** Chip del resumen de la persona. */
interface ChipPersona {
  icono: string;
  etiqueta: string;
  valor: string;
}

/** Chip del panel de validacion. */
interface ChipValidacion {
  icono: string;
  texto: string;
  tono: 'ok' | 'info' | 'alerta' | 'critico';
}

/** Alerta ya preparada para pintar. */
interface VistaAlerta extends AlertaValidacion {
  icono: string;
  clase: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Validador de rango de fechas
// ─────────────────────────────────────────────────────────────────────────

/**
 * Unica validacion "de negocio" admitida en el cliente: que la fecha final
 * no sea anterior a la de inicio. No calcula dias ni responsables; eso es
 * del backend. Existe solo para no mandar basura al motor de reglas.
 */
function rangoFechasValido(grupo: AbstractControl): ValidationErrors | null {
  const inicio = grupo.get('fechaInicio')?.value as Date | null;
  const fin = grupo.get('fechaFin')?.value as Date | null;
  if (!inicio || !fin) return null;
  const a = parsearFechaFlexible(inicio);
  const b = parsearFechaFlexible(fin);
  if (!a || !b) return null;
  return b.getTime() < a.getTime() ? { rangoInvertido: true } : null;
}

/** Minusculas sin tildes, para comparar y filtrar. */
function normalizar(texto: string): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * El nombre de la EPS sin sufijos juridicos (EPS, ESS, SAS, LTDA): "salud total eps" y
 * "salud total" comparten nucleo. Espejo del `nucleo()` de RadicacionNombresService (ms-hr).
 */
function nucleoEps(nombre: string): string {
  return normalizar(nombre)
    .replace(/\b(eps[- ]?s|eps|ess|s\.?a\.?s?|ltda)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `dd/MM/yyyy` para mostrar (nunca para enviar al backend). */
function formatoHumano(valor: unknown): string {
  const fecha = parsearFechaFlexible(valor);
  if (!fecha) return '';
  const dia = String(fecha.getDate()).padStart(2, '0');
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}/${fecha.getFullYear()}`;
}

/** Tamano legible de un archivo. */
function formatoTamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Primer texto no vacio de la lista, ya recortado. */
function primerTexto(...valores: unknown[]): string {
  for (const valor of valores) {
    const texto = (valor ?? '').toString().trim();
    if (texto) return texto;
  }
  return '';
}

// ─────────────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-registro-incapacidad',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatDividerModule,
    MatTooltipModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatDialogModule,
    BuscadorRemotoComponent,
  ],
  providers: [
    provideNativeDateAdapter(),
    { provide: MAT_DATE_LOCALE, useValue: 'es-CO' },
  ],
  templateUrl: './registro-incapacidad.component.html',
  styleUrl: './registro-incapacidad.component.css',
})
export class RegistroIncapacidadComponent implements OnDestroy {
  private readonly srv = inject(IncapacidadV2Service);
  private readonly srvLegacy = inject(IncapacidadService);
  private readonly utilidades = inject(UtilityServiceService);
  private readonly dialogo = inject(MatDialog);
  private readonly ruta = inject(ActivatedRoute);
  private readonly sanitizador = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  // ── Constantes expuestas a la plantilla ───────────────────────────────
  readonly tiposDocumento = TIPOS_DOCUMENTO;
  readonly opcionesSexo = OPCIONES_SEXO;
  readonly aceptaArchivos = '.pdf,.jpg,.jpeg,.png';

  // ── Plantillas de dialogo ─────────────────────────────────────────────
  private readonly plantillaBloqueo = viewChild.required<TemplateRef<unknown>>('plantillaBloqueo');
  private readonly plantillaConfirmar =
    viewChild.required<TemplateRef<unknown>>('plantillaConfirmar');
  /** Aviso PROMINENTE al guardar cuando el motor dice NO PAGAR (reunion 2026-08-20). */
  private readonly plantillaNoPagar =
    viewChild.required<TemplateRef<unknown>>('plantillaNoPagar');

  // ── Usuario logueado (Oficina y "quien recibe") ───────────────────────
  /**
   * Se lee UNA vez: `localStorage["user"]` tiene dos shapes distintos en la
   * misma sesion y el helper los tolera. Si el usuario no tiene sede hay que
   * pedirla con un desplegable; la oficina nunca se guarda vacia.
   */
  readonly usuario = obtenerUsuarioActual();
  // Multi-sede (V40): con UNA sede el campo queda bloqueado como siempre; con
  // varias se ofrece un desplegable limitado a las sedes del usuario.
  readonly oficinaBloqueada = signal(
    this.usuario.sedeNombre.length > 0 && this.usuario.sedes.length <= 1,
  );
  readonly nombreBloqueado = signal(this.usuario.nombreCompleto.length > 0);
  readonly oficinasDisponibles = signal<string[]>([]);
  readonly cargandoOficinas = signal(false);

  // ── Formulario tipado ─────────────────────────────────────────────────
  readonly form = new FormGroup({
    oficina: new FormGroup({
      oficina: new FormControl(this.usuario.sedeNombre, {
        nonNullable: true,
        validators: [Validators.required],
      }),
      nombreQuienRecibe: new FormControl(this.usuario.nombreCompleto, {
        nonNullable: true,
        validators: [Validators.required],
      }),
    }),
    personal: new FormGroup({
      tipoDocumento: new FormControl('', { nonNullable: true }),
      numeroDocumento: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required],
      }),
      primerApellido: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required],
      }),
      segundoApellido: new FormControl('', { nonNullable: true }),
      primerNombre: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required],
      }),
      segundoNombre: new FormControl('', { nonNullable: true }),
      fechaNacimiento: new FormControl<Date | null>(null),
      fondoPension: new FormControl('', { nonNullable: true }),
      sexo: new FormControl('', { nonNullable: true }),
      empresa: new FormControl('', { nonNullable: true }),
      centroCosto: new FormControl('', { nonNullable: true }),
      fechaIngreso: new FormControl<Date | null>(null, {
        validators: [Validators.required],
      }),
      celular: new FormControl('', { nonNullable: true }),
      whatsapp: new FormControl('', { nonNullable: true }),
      correo: new FormControl('', { nonNullable: true }),
      epsAfiliacion: new FormControl('', { nonNullable: true }),
      arl: new FormControl(ARL_POR_DEFECTO, { nonNullable: true }),
      temporal: new FormControl('', { nonNullable: true }),
      numeroContrato: new FormControl('', { nonNullable: true }),
    }),
    incapacidad: new FormGroup(
      {
        tipoIncapacidad: new FormControl<TipoIncapacidad | ''>('', {
          nonNullable: true,
          validators: [Validators.required],
        }),
        fechaInicio: new FormControl<Date | null>(null, {
          validators: [Validators.required],
        }),
        fechaFin: new FormControl<Date | null>(null, {
          validators: [Validators.required],
        }),
        codigoDiagnostico: new FormControl('', {
          nonNullable: true,
          validators: [Validators.required],
        }),
        descripcionDiagnostico: new FormControl('', { nonNullable: true }),
        eps: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
        nitIps: new FormControl('', { nonNullable: true }),
        nombreIps: new FormControl('', { nonNullable: true }),
        numeroIncapacidad: new FormControl('', { nonNullable: true }),
        // `OK` es el estado documental neutro: se ajusta al catalogo en
        // cuanto llega, pero arranca poblado para que la validacion en vivo
        // pueda dispararse desde el primer momento.
        estadoDocumento: new FormControl<EstadoDocumento>('OK', { nonNullable: true }),
        // Reunion 2026-08-20: quien recibe marca si el soporte ya viene transcrito
        // por la IPS. null = sin marcar (no se asume ni Si ni No).
        transcrita: new FormControl<boolean | null>(null),
        observaciones: new FormControl('', { nonNullable: true }),
      },
      { validators: [rangoFechasValido] },
    ),
  });

  /**
   * PUENTE ZONELESS: signal con el valor crudo del formulario.
   * Cualquier `patchValue` (incluido el que ocurre dentro de un `subscribe`)
   * emite `valueChanges`, refresca este signal y repinta la vista. Sin esto
   * la pantalla se quedaria en blanco tras autocompletar.
   */
  readonly valores = toSignal(
    this.form.valueChanges.pipe(
      startWith(null),
      map(() => this.form.getRawValue()),
    ),
    { requireSync: true },
  );

  // ── Modo edicion (ruta hermana `registro/:id`) ────────────────────────
  /** Id de la incapacidad en edicion; `null` cuando es un alta nueva. */
  readonly idEdicion = signal<number | null>(null);

  /**
   * `origen` del registro cargado en modo edicion (`HISTORICO` = importado de los
   * formularios viejos). A las historicas NO se les exige el soporte minimo al
   * guardar: su documento vive como link de Drive, no como soporte v2.
   */
  readonly origenEdicion = signal<string | null>(null);
  readonly cargandoRegistro = signal(false);
  readonly errorRegistro = signal('');
  readonly esEdicion = computed(() => this.idEdicion() !== null);

  /**
   * Id de la incapacidad recien creada en esta misma sesion de la pantalla.
   * Sin esto, un segundo clic en "Guardar" crearia un DUPLICADO: a partir
   * del primer guardado exitoso la pantalla pasa a actualizar (`PUT`).
   */
  private readonly idCreado = signal<number | null>(null);

  /** Id contra el que hay que trabajar: ruta de edicion o alta ya guardada. */
  readonly idEfectivo = computed(() => this.idEdicion() ?? this.idCreado());

  // ── Estado de la persona ──────────────────────────────────────────────
  readonly empleado = signal<EmpleadoBusqueda | null>(null);
  readonly cargandoPersona = signal(false);
  readonly errorPersona = signal('');
  readonly cedulaBuscada = signal('');
  /** Texto con el que arranca el buscador de trabajador (util al editar). */
  readonly valorInicialPersona = signal('');
  /** El usuario decidio capturar los datos a mano (cedula sin contratacion). */
  readonly modoManual = signal(false);
  /** Campos que contratacion NO trajo: quedan editables y marcados. */
  readonly camposSinDato = signal<ReadonlySet<string>>(new Set<string>());

  readonly personaCargada = computed(() => this.empleado() !== null || this.modoManual());

  // ── Estado de la validacion en vivo ───────────────────────────────────
  readonly validacion = signal<ValidacionResponse | null>(null);
  readonly validando = signal(false);
  readonly errorValidacion = signal('');
  readonly prorrogaOrigen = signal<IncapacidadV2 | null>(null);

  // ── Estado de los soportes ────────────────────────────────────────────
  readonly archivos = signal<Partial<Record<TipoSoporte, ArchivoSoporte>>>({});
  readonly tipoArrastrado = signal<TipoSoporte | null>(null);
  readonly errorArchivo = signal('');
  /**
   * Soportes que el SERVIDOR dice tener ya vinculados (`soportesCargados` del
   * detalle). Se rellena al editar y tras cada subida/borrado: es la unica
   * forma de que la pantalla no exija de nuevo un archivo que ya esta arriba.
   */
  private readonly soportesEnServidor = signal<ReadonlySet<TipoSoporte>>(new Set<TipoSoporte>());

  // ── Estado del guardado ───────────────────────────────────────────────
  readonly guardando = signal(false);
  readonly errorGuardado = signal('');
  readonly intentoGuardar = signal(false);
  readonly progresoSubida = signal<{ actual: number; total: number; etiqueta: string } | null>(
    null,
  );
  readonly resultado = signal<{ incapacidad: IncapacidadV2; validada: boolean } | null>(null);
  readonly motivosDialogo = signal<string[]>([]);

  // ── EPS (desplegable con buscador incorporado) ────────────────────────
  private readonly listaEps = signal<string[]>([]);
  /** Matriz completa (con forma de cargue), por si la plantilla necesita el detalle. */
  readonly epsMatrizLista = signal<EpsMatrizItem[]>([]);
  readonly filtroEps = signal('');
  readonly cargandoEps = signal(false);

  // ── Panel de validacion en movil ──────────────────────────────────────
  readonly panelAbierto = signal(true);

  // ── Catalogos (signals del propio servicio: 1 solo GET por sesion) ────
  readonly catalogos = this.srv.catalogosCache;
  readonly cargandoCatalogos = this.srv.cargandoCatalogos;
  readonly errorCatalogos = signal('');

  readonly tiposIncapacidad = computed(() => this.catalogos()?.tiposIncapacidad ?? []);
  readonly estadosDocumento = computed(() => this.catalogos()?.estadosDocumento ?? []);

  /** Disparador de la carga de datos de contratacion (evento, no estado). */
  private readonly empleadoElegido$ = new Subject<EmpleadoBusqueda>();

  // ─────────────────────────────────────────────────────────────────────
  // Derivados
  // ─────────────────────────────────────────────────────────────────────

  /** Edad CALCULADA desde `fecha_nacimiento` (nunca desde `edadTrabajador`). */
  readonly edad = computed(() => calcularEdad(this.valores().personal.fechaNacimiento));

  readonly fechaNacimientoTexto = computed(() =>
    formatoHumano(this.valores().personal.fechaNacimiento),
  );

  /** Iniciales para el avatar del resumen. */
  readonly iniciales = computed(() => {
    const p = this.valores().personal;
    const a = (p.primerNombre || '').trim().charAt(0);
    const b = (p.primerApellido || '').trim().charAt(0);
    const texto = `${a}${b}`.trim().toUpperCase();
    if (texto) return texto;
    const emp = this.empleado();
    return (emp?.nombreCompleto ?? '?').trim().charAt(0).toUpperCase() || '?';
  });

  readonly nombreCompleto = computed(() => {
    const p = this.valores().personal;
    const armado = [p.primerNombre, p.segundoNombre, p.primerApellido, p.segundoApellido]
      .map((x) => (x || '').trim())
      .filter(Boolean)
      .join(' ');
    return armado || this.empleado()?.nombreCompleto || '';
  });

  /** Dias transcurridos desde el ingreso (solo informativo en la tarjeta). */
  readonly antiguedadDias = computed(() => {
    const ingreso = this.valores().personal.fechaIngreso;
    if (!ingreso) return null;
    const dias = diasCalendarioInclusive(ingreso, new Date());
    return dias === null ? null : Math.max(dias - 1, 0);
  });

  /** Chips del resumen de la persona. */
  readonly chipsPersona = computed<ChipPersona[]>(() => {
    const p = this.valores().personal;
    const chips: ChipPersona[] = [];
    const agregar = (icono: string, etiqueta: string, valor: string) => {
      if ((valor || '').trim()) chips.push({ icono, etiqueta, valor: valor.trim() });
    };
    agregar('apartment', 'Empresa', p.empresa);
    agregar('account_tree', 'Centro de costo', p.centroCosto);
    agregar('groups', 'Temporal', p.temporal);
    agregar('local_hospital', 'EPS', p.epsAfiliacion);
    agregar('savings', 'Fondo de pensiones', p.fondoPension);
    agregar('event_available', 'Fecha de ingreso', formatoHumano(p.fechaIngreso));
    const dias = this.antiguedadDias();
    if (dias !== null) agregar('timelapse', 'Antiguedad', `${dias} dias`);
    return chips;
  });

  // ── Panel de validacion ───────────────────────────────────────────────

  readonly alertasVista = computed<VistaAlerta[]>(() =>
    (this.validacion()?.alertas ?? []).map((a) => ({
      ...a,
      icono: ICONO_ALERTA[a.nivel] ?? 'info',
      clase: `reg-alerta--${a.nivel.toLowerCase()}`,
    })),
  );

  /** Reparto visual de dias empresa vs entidad. */
  readonly repartoDias = computed(() => {
    const v = this.validacion();
    if (!v || v.dias <= 0) return null;
    const total = Math.max(v.dias, v.diasEmpresa + v.diasEntidad, 1);
    return {
      total: v.dias,
      empresa: v.diasEmpresa,
      entidad: v.diasEntidad,
      pctEmpresa: Math.round((v.diasEmpresa / total) * 100),
      pctEntidad: Math.round((v.diasEntidad / total) * 100),
      nombreEntidad: v.entidadResponsable,
    };
  });

  readonly chipsValidacion = computed<ChipValidacion[]>(() => {
    const v = this.validacion();
    if (!v) return [];
    const chips: ChipValidacion[] = [];

    chips.push(
      v.cumpleCotizacion
        ? { icono: 'verified', texto: 'Cumple cotizacion', tono: 'ok' }
        : { icono: 'gpp_maybe', texto: 'No cumple cotizacion', tono: 'critico' },
    );

    chips.push(
      v.estaPrescrita
        ? { icono: 'timer_off', texto: 'Prescrita', tono: 'critico' }
        : { icono: 'schedule', texto: `${v.diasHabilesTranscurridos} dias habiles`, tono: 'info' },
    );

    if (v.esProrroga) {
      chips.push({ icono: 'link', texto: this.textoProrroga(), tono: 'ok' });
    }

    if (v.tieneTraslape) {
      chips.push({
        icono: 'layers',
        texto: `Traslape con ${v.idsTraslapados.length} registro(s)`,
        tono: 'critico',
      });
    }

    chips.push({
      icono: 'functions',
      texto: `Acumulado del diagnostico: ${v.diasAcumuladosDiagnostico} dias`,
      tono: v.superado180 || v.superado540 ? 'alerta' : 'info',
    });

    if (v.superado540) {
      chips.push({ icono: 'priority_high', texto: 'Supera 540 dias', tono: 'critico' });
    } else if (v.superado180) {
      chips.push({ icono: 'priority_high', texto: 'Supera 180 dias', tono: 'alerta' });
    } else if (v.proximoA180) {
      chips.push({ icono: 'hourglass_bottom', texto: 'Proximo a 180 dias', tono: 'alerta' });
    }

    return chips;
  });

  /** Texto del chip de prorroga: usa la fecha real si se pudo consultar. */
  readonly textoProrroga = computed(() => {
    const v = this.validacion();
    if (!v?.esProrroga) return '';
    const origen = this.prorrogaOrigen();
    if (origen) {
      const desde = formatoHumano(origen.fechaInicio);
      const hasta = formatoHumano(origen.fechaFin);
      if (desde && hasta) return `Es prorroga de la incapacidad del ${desde} al ${hasta}`;
    }
    return v.prorrogaDeId
      ? `Es prorroga de la incapacidad #${v.prorrogaDeId}`
      : 'Es prorroga';
  });

  /** Etiqueta legible del responsable de pago (viene del catalogo). */
  readonly etiquetaResponsablePago = computed(() => {
    const v = this.validacion();
    if (!v) return '';
    const opcion = (this.catalogos()?.responsablesPago ?? []).find(
      (o) => o.codigo === v.responsablePago,
    );
    return opcion?.etiqueta ?? v.responsablePago.replace(/_/g, ' ');
  });

  /** Tono del chip de responsable de pago. */
  readonly tonoResponsablePago = computed<ChipValidacion['tono']>(() => {
    const codigo = this.validacion()?.responsablePago;
    if (!codigo) return 'info';
    if (codigo === 'NO_PAGAR') return 'critico';
    if (codigo === 'EMPLEADOR') return 'alerta';
    return 'ok';
  });

  // ── Soportes ──────────────────────────────────────────────────────────

  /** Soportes visibles SEGUN EL BACKEND, en el orden pedido por la funcional. */
  readonly soportesVisibles = computed<SoporteRequerido[]>(() => {
    const v = this.validacion();
    if (!v) return [];
    const porTipo = new Map(v.soportes.map((s) => [s.tipo, s]));
    return ORDEN_SOPORTES.map((t) => porTipo.get(t)).filter(
      (s): s is SoporteRequerido => !!s && s.visible,
    );
  });

  readonly soportesVista = computed<VistaSoporte[]>(() => {
    const mapa = this.archivos();
    const arrastrado = this.tipoArrastrado();
    const enServidor = this.soportesEnServidor();
    return this.soportesVisibles().map((s) => ({
      tipo: s.tipo,
      etiqueta: s.etiqueta || ETIQUETA_SOPORTE[s.tipo],
      obligatorio: s.obligatorio,
      icono: ICONO_SOPORTE[s.tipo] ?? 'attach_file',
      archivo: mapa[s.tipo] ?? null,
      arrastrando: arrastrado === s.tipo,
      yaEnServidor: enServidor.has(s.tipo),
    }));
  });

  /** Tipos con archivo elegido en ESTA pantalla (los unicos que hay que subir). */
  readonly tiposConArchivo = computed<TipoSoporte[]>(() => {
    const mapa = this.archivos();
    return ORDEN_SOPORTES.filter((t) => !!mapa[t]);
  });

  /**
   * Tipos que cuentan como cargados: los que el servidor ya tiene MAS los
   * elegidos aqui cuya subida no haya fallado. Alimentan `soportesCargados`
   * de la validacion.
   *
   * Un archivo cuya subida devolvio error NO cuenta: declararlo cargado seria
   * exactamente la mentira que la v2 de soportes vino a cerrar.
   */
  readonly tiposCargados = computed<TipoSoporte[]>(() => {
    const mapa = this.archivos();
    const enServidor = this.soportesEnServidor();
    return ORDEN_SOPORTES.filter(
      (t) => enServidor.has(t) || (!!mapa[t] && mapa[t]?.estado !== 'error'),
    );
  });

  readonly soportesFaltantes = computed<string[]>(() => {
    const cargados = new Set(this.tiposCargados());
    return this.soportesVisibles()
      .filter((s) => s.obligatorio && !cargados.has(s.tipo))
      .map((s) => s.etiqueta || ETIQUETA_SOPORTE[s.tipo]);
  });

  /**
   * Soportes SIN los cuales ni siquiera se puede GUARDAR como RECIBIDA: solo la
   * incapacidad medica (reunion 2026-08-20: "se debe al menos subir el soporte de la
   * incapacidad; el resto se puede completar despues editando"; ratificado 2026-09-07:
   * "guardar como recibida solo cuando se tenga al menos la incapacidad, asi aun no se
   * tenga lo demas"). El formulario de Salud Total y los demas obligatorios solo
   * bloquean el paso a VALIDADA, no el guardado.
   */
  readonly soportesBloqueantesGuardar = computed<string[]>(() => {
    const cargados = new Set(this.tiposCargados());
    return cargados.has('INCAPACIDAD_MEDICA') ? [] : [ETIQUETA_SOPORTE['INCAPACIDAD_MEDICA']];
  });

  /** true cuando el soporte visible es el formulario de Salud Total (tarjeta especial). */
  esFormularioSaludTotal(tipo: TipoSoporte): boolean {
    return tipo === 'FORMULARIO_SALUD_TOTAL';
  }

  /** Link del formato oficial, expuesto a la plantilla. */
  readonly urlFormatoSaludTotal = URL_FORMATO_SALUD_TOTAL;

  /** Alertas criticas del motor, para el aviso prominente de NO PAGAR al guardar. */
  readonly motivosNoPagar = computed<string[]>(() => {
    const v = this.validacion();
    if (!v || v.responsablePago !== 'NO_PAGAR') return [];
    const criticas = (v.alertas ?? [])
      .filter((a) => a.nivel === 'CRITICA')
      .map((a) => a.mensaje);
    return criticas.length
      ? criticas
      : ['El motor de reglas determino que esta incapacidad NO se paga.'];
  });

  // ── Que falta para poder guardar ──────────────────────────────────────

  /** Ruta del control -> etiqueta humana, para el resumen de errores. */
  private readonly ETIQUETAS: ReadonlyArray<[string, string]> = [
    ['oficina.oficina', 'Oficina'],
    ['oficina.nombreQuienRecibe', 'Nombre de quien recibe'],
    ['personal.numeroDocumento', 'Numero de documento'],
    ['personal.primerApellido', 'Primer apellido'],
    ['personal.primerNombre', 'Primer nombre'],
    ['personal.fechaIngreso', 'Fecha de ingreso'],
    ['incapacidad.tipoIncapacidad', 'Tipo de incapacidad'],
    ['incapacidad.fechaInicio', 'Fecha de inicio'],
    ['incapacidad.fechaFin', 'Fecha final'],
    ['incapacidad.codigoDiagnostico', 'Codigo de diagnostico'],
    ['incapacidad.eps', 'EPS'],
  ];

  /**
   * Lista EXPLICITA de lo que impide guardar.
   * El boton nunca se ata a `form.invalid` a secas: esa es justamente la
   * razon por la que el formulario viejo es imposible de usar.
   */
  readonly camposFaltantes = computed<string[]>(() => {
    // Dependencia explicita del valor del formulario para recalcular.
    this.valores();
    const faltan: string[] = [];
    for (const [ruta, etiqueta] of this.ETIQUETAS) {
      const control = this.form.get(ruta);
      if (control && control.invalid) faltan.push(etiqueta);
    }
    if (this.form.controls.incapacidad.hasError('rangoInvertido')) {
      faltan.push('La fecha final no puede ser anterior a la de inicio');
    }
    return faltan;
  });

  readonly puedeGuardar = computed(() => !this.guardando() && !this.cargandoRegistro());

  /** Rotulo del boton principal: alta vs edicion. */
  readonly etiquetaGuardar = computed(() =>
    this.idEfectivo() !== null ? 'Guardar cambios' : 'Guardar como Recibida',
  );

  /** El backend manda: si `puedeValidar` es false, el boton se bloquea. */
  readonly puedeValidar = computed(
    () =>
      !this.guardando() &&
      this.camposFaltantes().length === 0 &&
      this.validacion()?.puedeValidar === true,
  );

  readonly motivosBloqueo = computed<string[]>(() => {
    const motivos = [...(this.validacion()?.motivosBloqueo ?? [])];
    for (const faltante of this.soportesFaltantes()) {
      motivos.push(`Falta el soporte obligatorio: ${faltante}`);
    }
    return motivos;
  });

  readonly tooltipValidar = computed(() => {
    if (this.guardando()) return 'Guardando...';
    const faltan = this.camposFaltantes();
    if (faltan.length) return `Faltan datos: ${faltan.join(', ')}`;
    if (!this.validacion()) return 'Completa el tipo y las fechas para validar la incapacidad';
    const motivos = this.motivosBloqueo();
    if (motivos.length) return motivos.join(' · ');
    return 'Guarda la incapacidad y la promueve a VALIDADA';
  });

  // ── EPS filtrada ──────────────────────────────────────────────────────

  readonly opcionesEps = computed<string[]>(() => {
    const base = this.listaEps();
    // Se rescatan los valores YA puestos en el formulario (la EPS de afiliacion
    // de contratacion y la EPS de una incapacidad guardada antes de la matriz):
    // un mat-select solo muestra valores que EXISTAN como opcion, asi que
    // cualquier valor sin coincidencia EXACTA se antepone tal cual.
    const extras: string[] = [];
    for (const valor of [
      (this.valores().personal.epsAfiliacion || '').trim(),
      (this.valores().incapacidad.eps || '').trim(),
    ]) {
      if (valor && !base.includes(valor) && !extras.includes(valor)) {
        extras.push(valor);
      }
    }
    return extras.length ? [...extras, ...base] : base;
  });

  readonly epsFiltradas = computed<string[]>(() => {
    const filtro = normalizar(this.filtroEps());
    const todas = this.opcionesEps();
    if (!filtro) return todas;
    return todas.filter((e) => normalizar(e).includes(filtro));
  });

  // ─────────────────────────────────────────────────────────────────────
  // Referencias ESTABLES para <app-buscador-remoto>
  // (si se crearan en la plantilla se recrearian en cada render)
  // ─────────────────────────────────────────────────────────────────────

  readonly buscarEmpleado = (q: string): Observable<EmpleadoBusqueda[]> =>
    this.srv.buscarEmpleados(q, 15);
  readonly mostrarEmpleado = (e: EmpleadoBusqueda): string =>
    `${e.cedula} - ${e.nombreCompleto}`;
  readonly detalleEmpleado = (e: EmpleadoBusqueda): string =>
    [e.empresa, e.centroCosto, etiquetaTemporal(e.temporal)].filter(Boolean).join(' · ');

  readonly buscarCie10 = (q: string): Observable<CodigoDiagnostico[]> =>
    this.srv.buscarCodigosDiagnostico(q, 20);
  readonly mostrarCie10 = (c: CodigoDiagnostico): string => `${c.codigo} - ${c.descripcion}`;

  readonly buscarIps = (q: string): Observable<IpsBusqueda[]> => this.srv.buscarIps(q, 20);
  readonly mostrarIps = (i: IpsBusqueda): string => `${i.nit} - ${i.nombre}`;
  readonly detalleIps = (i: IpsBusqueda): string => `NIT ${i.nit}`;

  // ─────────────────────────────────────────────────────────────────────

  constructor() {
    this.cargarCatalogos();
    this.cargarListaEps();
    this.cargarOficinasSiHaceFalta();
    this.conectarCargaDePersona();
    this.conectarValidacionEnVivo();
    this.conectarConsultaDeProrroga();
    this.conectarModoEdicion();
  }

  /**
   * Libera los object URLs de las vistas previas. Sin esto, cada archivo
   * elegido deja un blob retenido en memoria mientras viva la pestana.
   * Las suscripciones se cierran solas con `takeUntilDestroyed`.
   */
  ngOnDestroy(): void {
    for (const archivo of Object.values(this.archivos())) {
      if (archivo?.urlPrevia) URL.revokeObjectURL(archivo.urlPrevia);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Carga inicial
  // ─────────────────────────────────────────────────────────────────────

  /** Catalogos del backend: unica fuente de verdad de los desplegables. */
  cargarCatalogos(): void {
    this.errorCatalogos.set('');
    this.srv
      .catalogos()
      .pipe(
        catchError((err: unknown) => {
          this.errorCatalogos.set(this.mensajeHttp(err, 'los catalogos'));
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((cat) => {
        if (!cat) return;
        // Si el catalogo no ofrece `OK` como estado manual, se toma el
        // primer estado NO automatico como valor por defecto.
        const control = this.form.controls.incapacidad.controls.estadoDocumento;
        const manuales = cat.estadosDocumento.filter((e) => !e.automatico);
        const actualValido = manuales.some((e) => e.codigo === control.value);
        if (!actualValido && manuales.length) control.setValue(manuales[0].codigo);
      });
  }

  /**
   * Lista de EPS del selector. La fuente es la MATRIZ oficial de cartera
   * (`GET /Incapacidades/v2/eps-matriz`, V43): lista CERRADA para elegir
   * mientras contratacion corrige su base de EPS. Si el backend aun no la
   * expone, degrada a la lista del endpoint legacy para no dejar el selector
   * vacio (misma politica de degradacion que los catalogos de la consulta).
   */
  private cargarListaEps(): void {
    this.cargandoEps.set(true);
    this.srv
      .epsMatriz()
      .pipe(
        catchError(() => of<EpsMatrizItem[] | null>(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((matriz) => {
        if (matriz && matriz.length) {
          this.cargandoEps.set(false);
          this.epsMatrizLista.set(matriz);
          // El orden lo manda la matriz (columna `orden`), no el alfabeto.
          this.listaEps.set(matriz.map((e) => e.nombre.trim()).filter((n) => n.length > 0));
          this.recanonizarEpsDelFormulario();
          return;
        }
        this.cargarListaEpsLegacy();
      });
  }

  /**
   * La matriz puede llegar DESPUES de que contratacion o el modo edicion ya
   * sembraran las EPS del formulario: se re-canonizan para que casen con las
   * opciones del selector (un valor que difiere solo en mayusculas dejaria el
   * mat-select en blanco).
   */
  private recanonizarEpsDelFormulario(): void {
    const afiliacion = this.form.controls.personal.controls.epsAfiliacion;
    const canonAfiliacion = this.canonizarEps(afiliacion.value);
    if (canonAfiliacion !== afiliacion.value) afiliacion.setValue(canonAfiliacion);

    const eps = this.form.controls.incapacidad.controls.eps;
    const canonEps = this.canonizarEps(eps.value);
    if (canonEps !== eps.value) eps.setValue(canonEps);
  }

  /** Respaldo: lista de EPS del endpoint legacy (solo si la matriz fallo). */
  private cargarListaEpsLegacy(): void {
    this.srvLegacy
      .traerDatosListas()
      .pipe(
        catchError(() => of(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((resp: unknown) => {
        this.cargandoEps.set(false);
        const crudas = (resp as { eps?: unknown } | null)?.eps;
        if (!Array.isArray(crudas)) return;
        const nombres = crudas
          .map((x: unknown) =>
            primerTexto(
              (x as { nombreeps?: unknown })?.nombreeps,
              (x as { nombre?: unknown })?.nombre,
              typeof x === 'string' ? x : '',
            ),
          )
          .filter((n) => n.length > 0);
        const unicas = Array.from(new Set(nombres)).sort((a, b) => a.localeCompare(b, 'es'));
        this.listaEps.set(unicas);
      });
  }

  /**
   * Devuelve el nombre CANONICO de la matriz si el valor coincide con una EPS
   * de la lista (ignorando tildes y mayusculas); si no, el valor tal cual.
   * Sin esto, un "Nueva Eps" de contratacion no casaria con la opcion
   * "NUEVA EPS" del `mat-select` y el campo se veria vacio.
   *
   * Reunion 2026-08-26: ademas casa por NUCLEO sin sufijos juridicos (espejo
   * de `RadicacionNombresService.matrizDe` en ms-hr), solo si es inequivoco.
   * Sin esto, el "SALUD TOTAL" que trae contratacion no casaba con la opcion
   * "SALUD TOTAL EPS" de la matriz, se guardaba tal cual y el ZIP de cartera
   * terminaba con DOS carpetas de la misma EPS.
   */
  /** Para el banner de exito: el codigo tecnico se muestra sin guion bajo (2026-08-26). */
  protected readonly sinGuion = codigoSinGuion;

  private canonizarEps(valor: string | null | undefined): string {
    const limpio = (valor ?? '').trim();
    if (!limpio) return '';
    const hallada = this.listaEps().find((e) => normalizar(e) === normalizar(limpio));
    if (hallada) return hallada;
    const objetivo = nucleoEps(limpio);
    if (!objetivo) return limpio;
    const candidatas = this.listaEps().filter((e) => nucleoEps(e) === objetivo);
    return candidatas.length === 1 ? candidatas[0] : limpio;
  }

  /** Al elegir la EPS de afiliacion, siembra la EPS de la incapacidad si esta vacia. */
  alCambiarEpsAfiliacion(valor: string): void {
    const control = this.form.controls.incapacidad.controls.eps;
    if (valor && !control.value) control.setValue(valor);
  }

  /**
   * Solo 123 de 7.582 usuarios tienen sede. Si el usuario no la trae, hay
   * que ofrecerle el desplegable de oficinas: la oficina NUNCA se guarda
   * vacia (es `Validators.required`).
   */
  private cargarOficinasSiHaceFalta(): void {
    if (this.oficinaBloqueada()) return;
    // Multi-sede (V40): con varias sedes asignadas, el desplegable se limita a
    // ellas (la principal ya viene preseleccionada en el control).
    if (this.usuario.sedes.length > 1) {
      this.oficinasDisponibles.set(
        [...this.usuario.sedes].sort((a, b) => a.localeCompare(b, 'es')),
      );
      return;
    }
    this.cargandoOficinas.set(true);
    this.utilidades
      .traerSucursales()
      .pipe(
        catchError(() => of(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((resp: unknown) => {
        this.cargandoOficinas.set(false);
        const lista = Array.isArray(resp)
          ? resp
          : ((resp as { results?: unknown[] } | null)?.results ?? []);
        const nombres = (lista as unknown[])
          .map((s: unknown) => primerTexto((s as { nombre?: unknown })?.nombre))
          .filter((n) => n.length > 0);
        this.oficinasDisponibles.set(
          Array.from(new Set(nombres)).sort((a, b) => a.localeCompare(b, 'es')),
        );
      });
  }

  // ─────────────────────────────────────────────────────────────────────
  // A) Buscador inteligente de la persona
  // ─────────────────────────────────────────────────────────────────────

  /** Handler del `(seleccionado)` del buscador de empleados. */
  alSeleccionarEmpleado(empleado: EmpleadoBusqueda): void {
    this.empleadoElegido$.next(empleado);
  }

  /** Handler del `(limpiado)` del buscador de empleados. */
  alLimpiarEmpleado(): void {
    this.empleado.set(null);
    this.errorPersona.set('');
    this.cedulaBuscada.set('');
    this.modoManual.set(false);
    this.camposSinDato.set(new Set<string>());
    this.form.controls.personal.reset({ arl: ARL_POR_DEFECTO });
  }

  /**
   * `switchMap` cancela la consulta anterior: si el usuario elige dos
   * personas seguidas nunca llega la respuesta vieja despues de la nueva.
   */
  private conectarCargaDePersona(): void {
    this.empleadoElegido$
      .pipe(
        tap((emp) => {
          this.empleado.set(emp);
          this.cedulaBuscada.set(emp.cedula);
          this.errorPersona.set('');
          this.modoManual.set(false);
          this.cargandoPersona.set(true);
          this.aplicarEmpleado(emp);
        }),
        switchMap((emp) =>
          this.srv.datosContratacion(emp.cedula).pipe(
            catchError((err: unknown) => {
              const estado = (err as { status?: number } | null)?.status;
              this.errorPersona.set(
                estado === 404
                  ? `No encontramos datos de contratacion para la cedula ${emp.cedula}.`
                  : this.mensajeHttp(err, 'los datos de contratacion'),
              );
              return of(null);
            }),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((datos) => {
        this.cargandoPersona.set(false);
        if (datos) this.aplicarDatosContratacion(datos);
      });
  }

  /**
   * Modo edicion: la ruta hermana `registro/:id` reutiliza esta misma
   * pantalla. Con `id` se carga la incapacidad, se rellena el formulario y
   * el guardado pasa a ser `PUT` en vez de `POST`. Ademas la validacion
   * envia `excluirId` para que el registro no se traslape consigo mismo.
   */
  private conectarModoEdicion(): void {
    this.ruta.paramMap
      .pipe(
        map((params) => {
          const crudo = params.get('id');
          const numero = Number(crudo);
          return crudo && Number.isFinite(numero) && numero > 0 ? numero : null;
        }),
        distinctUntilChanged(),
        tap((id) => {
          this.idEdicion.set(id);
          if (id === null) this.origenEdicion.set(null);
          this.errorRegistro.set('');
          this.cargandoRegistro.set(id !== null);
        }),
        switchMap((id) =>
          id === null
            ? of<IncapacidadV2 | null>(null)
            : this.srv.obtener(id).pipe(
                catchError((err: unknown) => {
                  this.errorRegistro.set(this.mensajeHttp(err, 'la incapacidad a editar'));
                  return of<IncapacidadV2 | null>(null);
                }),
              ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((inc) => {
        this.cargandoRegistro.set(false);
        if (inc) this.aplicarIncapacidadExistente(inc);
      });
  }

  /** Vuelca una incapacidad ya guardada en el formulario. */
  private aplicarIncapacidadExistente(inc: IncapacidadV2): void {
    this.origenEdicion.set(inc.origen ?? null);
    // Los soportes que el servidor ya tiene no se piden otra vez.
    this.sincronizarSoportesDelServidor(inc);

    this.form.controls.oficina.patchValue({
      oficina: inc.oficina || this.usuario.sedeNombre,
      nombreQuienRecibe: inc.recibidoPor || this.usuario.nombreCompleto,
    });

    this.form.controls.incapacidad.patchValue({
      tipoIncapacidad: inc.tipoIncapacidad,
      fechaInicio: parsearFechaFlexible(inc.fechaInicio),
      fechaFin: parsearFechaFlexible(inc.fechaFin),
      codigoDiagnostico: (inc.codigoDiagnostico ?? '').trim(),
      descripcionDiagnostico: (inc.descripcionDiagnostico ?? '').trim(),
      eps: this.canonizarEps(inc.eps),
      nitIps: (inc.nitIps ?? '').trim(),
      nombreIps: (inc.ipsNombre ?? '').trim(),
      numeroIncapacidad: (inc.numeroIncapacidad ?? '').trim(),
      estadoDocumento: inc.estadoDocumento,
      transcrita: inc.transcrita ?? null,
      observaciones: (inc.observaciones ?? '').trim(),
    });

    // La ARL es SIEMPRE Sura (definicion de la funcional): aunque el registro
    // guardado traiga otra cosa, el campo fijo la corrige al reguardar.
    this.form.controls.personal.patchValue({ arl: ARL_POR_DEFECTO });

    // Los datos del trabajador son maestros de contratacion: se recargan
    // por el mismo camino que el alta, no se copian del registro guardado.
    this.valorInicialPersona.set(
      `${inc.cedula} - ${(inc.nombreCompleto ?? '').trim()}`.trim(),
    );
    this.empleadoElegido$.next({
      cedula: inc.cedula ?? '',
      nombreCompleto: (inc.nombreCompleto ?? '').trim(),
      tipoDocumento: (inc.tipoDocumento ?? '').trim(),
      empresa: (inc.empresa ?? '').trim(),
      centroCosto: (inc.centroCosto ?? '').trim(),
      temporal: (inc.temporal ?? '').trim(),
      numeroContrato: (inc.numeroContrato ?? '').trim(),
      fechaIngreso: inc.fechaIngreso ?? '',
      eps: (inc.eps ?? '').trim(),
      afp: (inc.afp ?? '').trim(),
      oficina: (inc.oficina ?? '').trim(),
    });
  }

  /** Reintenta la consulta de contratacion de la persona ya elegida. */
  reintentarPersona(): void {
    const emp = this.empleado();
    if (emp) this.empleadoElegido$.next(emp);
  }

  /** Habilita la captura manual cuando contratacion no tiene a la persona. */
  activarModoManual(): void {
    this.modoManual.set(true);
    this.errorPersona.set('');
  }

  /** Prellenado rapido con lo que ya trae la fila del buscador. */
  private aplicarEmpleado(emp: EmpleadoBusqueda): void {
    this.form.controls.personal.patchValue({
      tipoDocumento: (emp.tipoDocumento ?? '').trim(),
      numeroDocumento: (emp.cedula ?? '').trim(),
      empresa: (emp.empresa ?? '').trim(),
      centroCosto: (emp.centroCosto ?? '').trim(),
      temporal: etiquetaTemporal(emp.temporal),
      numeroContrato: (emp.numeroContrato ?? '').trim(),
      fechaIngreso: parsearFechaFlexible(emp.fechaIngreso),
      // La EPS llega con espacios finales ("NUEVA EPS ", "SURA ") y se
      // canoniza contra la matriz para que case con el selector.
      epsAfiliacion: this.canonizarEps(emp.eps),
      fondoPension: (emp.afp ?? '').trim(),
    });
  }

  /**
   * Autocompletado completo desde `/contratacion/datosIncapacidadContratacion`.
   *
   * Avisos de datos reales aplicados aqui:
   *  - `fecha_nacimiento` viene en dos formatos y con basura -> se parsea con
   *    `parsearFechaFlexible`, que descarta lo imposible.
   *  - `edadTrabajador` solo esta poblado en el 41%: NO se usa; la edad se
   *    calcula desde la fecha de nacimiento.
   *  - el fondo de pension es `afp.afp`, NUNCA `afp.afc` (cesantias): ese era
   *    el bug del formulario viejo.
   *  - la EPS llega con espacios finales -> `trim()`.
   *  - `temporal` llega como codigo crudo "AL"/"TA" -> `etiquetaTemporal`.
   */
  private aplicarDatosContratacion(datos: DatosContratacionResponse): void {
    const b = datos.datos_basicos ?? {};
    const c = datos.contratacion ?? {};
    const a = datos.afp ?? {};
    const emp = this.empleado();

    const valores = {
      tipoDocumento: primerTexto(b.tipodedocumento, emp?.tipoDocumento),
      numeroDocumento: primerTexto(b.numerodeceduladepersona, emp?.cedula),
      primerApellido: primerTexto(b.primer_apellido),
      segundoApellido: primerTexto(b.segundo_apellido),
      primerNombre: primerTexto(b.primer_nombre),
      segundoNombre: primerTexto(b.segundo_nombre),
      sexo: primerTexto(b.genero),
      celular: primerTexto(b.celular),
      whatsapp: primerTexto(b.whatsapp, b.celular),
      correo: primerTexto(b.primercorreoelectronico),
      empresa: primerTexto(emp?.empresa, c.empresaUsuaraYCCentrodeCosto),
      centroCosto: primerTexto(c.centro_de_costos, c.centro_costo_carnet, emp?.centroCosto),
      temporal: etiquetaTemporal(primerTexto(c.temporal, emp?.temporal)),
      numeroContrato: primerTexto(c.codigo_contrato, emp?.numeroContrato),
      // OJO: `a.afp` es pension obligatoria. `a.afc` son CESANTIAS.
      fondoPension: primerTexto(a.afp, c.nombre_afp, emp?.afp),
      epsAfiliacion: this.canonizarEps(primerTexto(c.nombre_eps_afiliada, a.eps, emp?.eps)),
    };

    this.form.controls.personal.patchValue({
      ...valores,
      fechaNacimiento: parsearFechaFlexible(b.fecha_nacimiento),
      fechaIngreso: parsearFechaFlexible(
        primerTexto(c.fechaIngreso, c.fecha_contratacion, emp?.fechaIngreso),
      ),
    });

    // Campos que contratacion NO trajo: quedan editables y senalizados.
    const faltantes = new Set<string>();
    for (const [clave, valor] of Object.entries(valores)) {
      if (!valor) faltantes.add(clave);
    }
    if (!parsearFechaFlexible(b.fecha_nacimiento)) faltantes.add('fechaNacimiento');
    if (!this.form.controls.personal.controls.fechaIngreso.value) faltantes.add('fechaIngreso');
    this.camposSinDato.set(faltantes);

    // La EPS de la incapacidad arranca con la de afiliacion (editable).
    if (valores.epsAfiliacion && !this.form.controls.incapacidad.controls.eps.value) {
      this.form.controls.incapacidad.controls.eps.setValue(valores.epsAfiliacion);
    }
  }

  /** `true` si el campo debe ir en solo lectura (vino de contratacion). */
  readonly soloLectura = (clave: string): boolean =>
    this.personaCargada() && !this.modoManual() && !this.camposSinDato().has(clave);

  /** `true` si hay que pedirlo a mano (contratacion no lo trajo). */
  readonly completarManual = (clave: string): boolean =>
    this.personaCargada() && this.camposSinDato().has(clave);

  // ─────────────────────────────────────────────────────────────────────
  // E) Validacion en vivo (todas las reglas son del backend)
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Cada cambio relevante dispara `POST /Incapacidades/v2/validar` con
   * debounce de 400 ms y `switchMap` (cancela la peticion anterior).
   *
   * `distinctUntilChanged` sobre el request serializado evita llamadas
   * inutiles cuando lo que cambio fueron observaciones, IPS o el numero de
   * incapacidad, que no entran en el motor de reglas.
   */
  private conectarValidacionEnVivo(): void {
    const cambiosForm$ = this.form.valueChanges.pipe(map(() => undefined));
    // Los soportes elegidos tambien entran al motor de reglas
    // (`soportesCargados`), asi que su cambio revalida.
    const cambiosSoportes$ = toObservable(this.tiposCargados).pipe(map(() => undefined));

    merge(cambiosForm$, cambiosSoportes$)
      .pipe(
        map(() => this.construirRequestValidacion()),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        tap((req) => {
          this.errorValidacion.set('');
          this.validando.set(req !== null);
          if (req === null) this.validacion.set(null);
        }),
        // `debounce` + `timer` en vez de `debounceTime`: `debounceTime` de
        // RxJS 7 programa UNA sola tarea y no la reprograma con cada valor,
        // asi que el temporizador queda anclado al contexto en el que se
        // creo. Con `debounce` cada emision cancela el temporizador anterior
        // y crea uno nuevo, que es el comportamiento que se quiere aqui (y
        // el unico que se puede probar de verdad con `fakeAsync`).
        debounce(() => timer(MS_DEBOUNCE_VALIDACION)),
        switchMap((req) => {
          if (req === null) return of<ValidacionResponse | null>(null);
          return this.srv.validar(req).pipe(
            catchError((err: unknown) => {
              this.errorValidacion.set(this.mensajeHttp(err, 'la validacion'));
              return of<ValidacionResponse | null>(null);
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((resp) => {
        this.validando.set(false);
        this.validacion.set(resp);
      });
  }

  /** Trae la incapacidad de la que esta es prorroga, para mostrar su fecha. */
  private conectarConsultaDeProrroga(): void {
    toObservable(computed(() => this.validacion()?.prorrogaDeId ?? null))
      .pipe(
        distinctUntilChanged(),
        switchMap((id) =>
          id === null
            ? of<IncapacidadV2 | null>(null)
            : this.srv.obtener(id).pipe(catchError(() => of<IncapacidadV2 | null>(null))),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((inc) => this.prorrogaOrigen.set(inc));
  }

  /**
   * Arma el request del motor de reglas.
   * Devuelve `null` (y por tanto no llama al backend) mientras falte el
   * nucleo minimo: persona, fecha de ingreso, tipo y rango de fechas.
   */
  private construirRequestValidacion(): ValidarIncapacidadRequest | null {
    const p = this.form.controls.personal.getRawValue();
    const i = this.form.controls.incapacidad.getRawValue();

    const cedula = (p.numeroDocumento ?? '').trim();
    const fechaIngreso = aIsoCortoFlexible(p.fechaIngreso);
    const fechaInicio = aIsoCorto(i.fechaInicio);
    const fechaFin = aIsoCorto(i.fechaFin);

    if (!cedula || !fechaIngreso || !i.tipoIncapacidad || !fechaInicio || !fechaFin) {
      return null;
    }
    if (this.form.controls.incapacidad.hasError('rangoInvertido')) return null;

    return {
      cedula,
      fechaIngreso,
      tipoIncapacidad: i.tipoIncapacidad,
      fechaInicio,
      fechaFin,
      codigoDiagnostico: (i.codigoDiagnostico ?? '').trim(),
      eps: (i.eps ?? '').trim(),
      estadoDocumento: i.estadoDocumento,
      soportesCargados: this.tiposCargados(),
      // Al editar (o tras el primer guardado), el propio registro no debe
      // contarse como traslape consigo mismo.
      ...(this.idEfectivo() !== null ? { excluirId: this.idEfectivo() as number } : {}),
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Handlers de los buscadores del bloque de incapacidad
  // ─────────────────────────────────────────────────────────────────────

  /** Al elegir el CIE-10 se llena sola la descripcion (campo 8). */
  alSeleccionarCie10(codigo: CodigoDiagnostico): void {
    this.form.controls.incapacidad.patchValue({
      codigoDiagnostico: (codigo.codigo ?? '').trim(),
      descripcionDiagnostico: (codigo.descripcion ?? '').trim(),
    });
  }

  alLimpiarCie10(): void {
    this.form.controls.incapacidad.patchValue({
      codigoDiagnostico: '',
      descripcionDiagnostico: '',
    });
  }

  alSeleccionarIps(ips: IpsBusqueda): void {
    this.form.controls.incapacidad.patchValue({
      nitIps: (ips.nit ?? '').trim(),
      nombreIps: (ips.nombre ?? '').trim(),
    });
  }

  alLimpiarIps(): void {
    this.form.controls.incapacidad.patchValue({ nitIps: '', nombreIps: '' });
  }

  /**
   * El buscador del desplegable de EPS vive DENTRO del `mat-select`, que
   * captura las teclas para su propio typeahead. Se detiene la propagacion
   * salvo en las teclas de navegacion, que el panel si debe recibir.
   */
  alTeclearFiltroEps(evento: KeyboardEvent): void {
    const navegacion = ['Escape', 'ArrowDown', 'ArrowUp', 'Enter', 'Tab'];
    if (!navegacion.includes(evento.key)) evento.stopPropagation();
  }

  alAbrirEps(abierto: boolean): void {
    if (!abierto) this.filtroEps.set('');
  }

  // ─────────────────────────────────────────────────────────────────────
  // F) Soportes
  // ─────────────────────────────────────────────────────────────────────

  alElegirArchivo(evento: Event, tipo: TipoSoporte): void {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0] ?? null;
    if (archivo) this.registrarArchivo(tipo, archivo);
    // Permite volver a elegir el mismo archivo tras quitarlo.
    input.value = '';
  }

  alArrastrarSobre(evento: DragEvent, tipo: TipoSoporte): void {
    evento.preventDefault();
    evento.stopPropagation();
    this.tipoArrastrado.set(tipo);
  }

  alSalirArrastre(evento: DragEvent): void {
    evento.preventDefault();
    evento.stopPropagation();
    this.tipoArrastrado.set(null);
  }

  alSoltarArchivo(evento: DragEvent, tipo: TipoSoporte): void {
    evento.preventDefault();
    evento.stopPropagation();
    this.tipoArrastrado.set(null);
    const archivo = evento.dataTransfer?.files?.[0] ?? null;
    if (archivo) this.registrarArchivo(tipo, archivo);
  }

  /** Valida tipo y peso en el cliente antes de aceptar el archivo. */
  private registrarArchivo(tipo: TipoSoporte, archivo: File): void {
    const nombre = archivo.name ?? '';
    const extensionOk = /\.(pdf|jpe?g|png)$/i.test(nombre);
    const mimeOk = MIME_ACEPTADOS.includes((archivo.type ?? '').toLowerCase());
    if (!extensionOk && !mimeOk) {
      this.errorArchivo.set(`"${nombre}" no es un PDF, JPG o PNG.`);
      return;
    }
    if (archivo.size > TAMANO_MAXIMO) {
      this.errorArchivo.set(
        `"${nombre}" pesa ${formatoTamano(archivo.size)}; el maximo permitido es 10 MB.`,
      );
      return;
    }

    this.errorArchivo.set('');
    const esPdf = /\.pdf$/i.test(nombre) || (archivo.type ?? '').toLowerCase() === 'application/pdf';
    const esImagen = !esPdf;
    const urlPrevia = URL.createObjectURL(archivo);

    this.archivos.update((mapa) => {
      const anterior = mapa[tipo];
      if (anterior?.urlPrevia) URL.revokeObjectURL(anterior.urlPrevia);
      const copia: Partial<Record<TipoSoporte, ArchivoSoporte>> = { ...mapa };
      copia[tipo] = {
        archivo,
        nombre,
        tamanoTexto: formatoTamano(archivo.size),
        esImagen,
        esPdf,
        urlPrevia,
        urlPreviaSegura: esPdf
          ? this.sanitizador.bypassSecurityTrustResourceUrl(urlPrevia)
          : null,
        estado: 'pendiente',
        mensajeError: '',
      };
      return copia;
    });
  }

  /**
   * Abre el diligenciamiento EN LINEA del formato de Salud Total con los datos del
   * trabajador prellenados; al cerrar con exito, el PDF diligenciado queda adjunto
   * como soporte FORMULARIO_SALUD_TOTAL (pendiente de subir, igual que un archivo
   * elegido a mano).
   */
  abrirFormularioSaludTotal(): void {
    const p = this.form.controls.personal.getRawValue();
    const o = this.form.controls.oficina.getRawValue();
    const datos: DatosFormularioSaludTotal = {
      nombres: [p.primerNombre, p.segundoNombre].filter(Boolean).join(' ').trim(),
      apellidos: [p.primerApellido, p.segundoApellido].filter(Boolean).join(' ').trim(),
      telefono: (p.celular || p.whatsapp || '').trim(),
      arl: (p.arl || ARL_POR_DEFECTO).trim(),
      cargo: '',
      // Reunion 2026-09-07: el responsable del diligenciamiento es el TRABAJADOR, no quien
      // recibe en la oficina; si no hay nombre del trabajador se cae a quien recibe.
      responsable:
        [p.primerNombre, p.segundoNombre, p.primerApellido, p.segundoApellido]
          .filter(Boolean)
          .join(' ')
          .trim() || (o.nombreQuienRecibe || '').trim(),
      cedula: (p.numeroDocumento || '').trim(),
    };
    this.dialogo
      .open<DialogoFormularioSaludTotalComponent, DatosFormularioSaludTotal, File | undefined>(
        DialogoFormularioSaludTotalComponent,
        { width: '640px', maxWidth: '95vw', data: datos, autoFocus: false },
      )
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((archivo) => {
        if (archivo) this.registrarArchivo('FORMULARIO_SALUD_TOTAL', archivo);
      });
  }

  quitarArchivo(tipo: TipoSoporte): void {
    const yaEstabaArriba = this.archivos()[tipo]?.estado === 'cargado';

    this.archivos.update((mapa) => {
      const actual = mapa[tipo];
      if (actual?.urlPrevia) URL.revokeObjectURL(actual.urlPrevia);
      const copia: Partial<Record<TipoSoporte, ArchivoSoporte>> = { ...mapa };
      delete copia[tipo];
      return copia;
    });

    // Si el archivo ya estaba en el servidor hay que borrar tambien el vinculo:
    // desde la v2 el servidor es la fuente de verdad de `soportesCargados`, y
    // dejarlo ahi permitiria validar la incapacidad con un soporte que el
    // usuario acaba de retirar.
    const id = this.idEfectivo();
    if (!yaEstabaArriba || id === null) return;

    this.srv
      .eliminarSoporte(id, tipo)
      .pipe(
        switchMap(() => this.srv.obtener(id)),
        catchError(() => {
          this.errorArchivo.set(
            'El archivo se quito de la pantalla, pero el servidor no pudo borrar el soporte. Vuelve a intentarlo o recarga la incapacidad.',
          );
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((incapacidad) => {
        if (incapacidad) this.fijarIncapacidadResultado(incapacidad);
      });
  }

  /** Abre la vista previa en una pestana nueva. */
  abrirVistaPrevia(tipo: TipoSoporte): void {
    const archivo = this.archivos()[tipo];
    if (archivo?.urlPrevia && typeof window !== 'undefined') {
      window.open(archivo.urlPrevia, '_blank', 'noopener');
    }
  }

  /** Reintenta la subida de un soporte que fallo tras crear la incapacidad. */
  reintentarSoporte(tipo: TipoSoporte): void {
    const creada = this.resultado()?.incapacidad;
    const id = creada?.id;
    if (!creada || !id) return;
    const archivo = this.archivos()[tipo];
    if (!archivo) return;

    this.actualizarArchivo(tipo, { estado: 'subiendo', mensajeError: '' });
    this.srv
      .subirSoporte(id, tipo, archivo.archivo)
      .pipe(
        // Igual que en el guardado: tras subir, el estado bueno es el del
        // servidor, que acaba de recalcular `soportesCargados`.
        switchMap(() => this.releerIncapacidad(id, creada)),
        catchError((err: unknown) => {
          this.actualizarArchivo(tipo, {
            estado: 'error',
            mensajeError: this.mensajeErrorSoporte(err, archivo.nombre),
          });
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((incapacidad) => {
        if (!incapacidad) return;
        this.actualizarArchivo(tipo, { estado: 'cargado', mensajeError: '' });
        this.fijarIncapacidadResultado(incapacidad);
      });
  }

  private actualizarArchivo(tipo: TipoSoporte, cambios: Partial<ArchivoSoporte>): void {
    this.archivos.update((mapa) => {
      const actual = mapa[tipo];
      if (!actual) return mapa;
      const copia: Partial<Record<TipoSoporte, ArchivoSoporte>> = { ...mapa };
      copia[tipo] = { ...actual, ...cambios };
      return copia;
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // G) Barra de acciones
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Guarda la incapacidad y, opcionalmente, la promueve a VALIDADA.
   *
   * Nunca se bloquea el boton "solo porque el formulario es invalido": si
   * falta algo se marca todo como tocado, se hace scroll al primer campo
   * malo y el resumen del panel dice exactamente que falta.
   */
  guardar(conValidacion: boolean): void {
    if (this.guardando()) return;

    this.intentoGuardar.set(true);
    this.errorGuardado.set('');
    this.form.markAllAsTouched();

    if (this.camposFaltantes().length > 0) {
      this.enfocarPrimerInvalido();
      return;
    }

    const peticion = this.construirRequestCreacion();
    if (!peticion) {
      this.errorGuardado.set('No se pudo armar la incapacidad: revisa los datos del trabajador.');
      return;
    }

    // Los chequeos de abajo (soporte minimo, aviso NO PAGAR) se deciden sobre una
    // validacion FRESCA, no sobre la del panel: la del panel corre con debounce de
    // 400 ms y un guardado rapido podria evaluar gates con datos viejos.
    const reqValidacion = this.construirRequestValidacion();
    this.guardando.set(true);
    (reqValidacion === null
      ? of(this.validacion())
      : this.srv.validar(reqValidacion).pipe(
          tap((v) => this.validacion.set(v)),
          // Si /validar esta caido se sigue con lo que haya (o sin gate): bloquear el
          // guardado exigiendo un soporte cuyo cargador ni se pinta seria un callejon.
          catchError(() => of(this.validacion())),
        )
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((validacionFresca) => {
        this.guardando.set(false);
        this.continuarGuardado(conValidacion, peticion, validacionFresca);
      });
  }

  /** Gates previos al guardado, evaluados sobre la validacion fresca. */
  private continuarGuardado(
    conValidacion: boolean,
    peticion: CrearIncapacidadV2Request,
    validacionFresca: ValidacionResponse | null,
  ): void {
    // Reunion 2026-08-20: sin el soporte de la incapacidad (y sin el formulario de
    // Salud Total cuando aplica) NO se recibe; el resto se completa editando.
    // Excepciones: las HISTORICAS importadas (su documento vive como link de Drive,
    // exigirles soporte bloquearia la edicion de 55 mil registros) y el caso sin
    // validacion disponible (el backend decide; los soportes se cargan despues).
    const esHistorica = this.origenEdicion() === 'HISTORICO';
    const bloqueantes =
      esHistorica || validacionFresca === null ? [] : this.soportesBloqueantesGuardar();
    if (bloqueantes.length > 0) {
      this.errorGuardado.set(
        `Para recibir la incapacidad debes adjuntar al menos: ${bloqueantes.join(' y ')}. ` +
          'Los demas soportes se pueden completar despues editando el registro.',
      );
      this.desplazarASoportes();
      return;
    }

    // Reunion 2026-08-20: si el motor dice NO PAGAR (no cumple cotizacion, prescrita,
    // documento malo), el aviso tiene que saltarle en la cara a quien registra — no
    // quedarse quieto en el panel lateral. Se puede continuar, pero a sabiendas.
    if (this.motivosNoPagar().length > 0) {
      this.dialogo
        .open(this.plantillaNoPagar(), {
          width: '540px',
          panelClass: 'reg-dialogo-panel',
          autoFocus: false,
        })
        .afterClosed()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((continuar) => {
          if (continuar === true) this.ejecutarGuardado(conValidacion, peticion);
        });
      return;
    }

    this.ejecutarGuardado(conValidacion, peticion);
  }

  /** El guardado propiamente dicho (tras pasar los chequeos y avisos de `guardar`). */
  private ejecutarGuardado(conValidacion: boolean, peticion: CrearIncapacidadV2Request): void {
    const id = this.idEfectivo();
    this.guardando.set(true);
    // ORDEN OBLIGATORIO: guardar -> subir soportes (+ relectura) -> promover.
    // El servidor recalcula `soportesCargados` con cada subida y sobre ese dato
    // decide si puede pasar a VALIDADA; promover antes de que los archivos
    // esten realmente arriba solo consigue un 409 por soportes faltantes.
    (id === null ? this.srv.crear(peticion) : this.srv.actualizar(id, peticion))
      .pipe(
        switchMap((guardada) => this.subirSoportes(guardada)),
        switchMap((creada) =>
          conValidacion
            ? this.srv.promoverAValidada(creada.id).pipe(
                map((res) => ({
                  // El 200 de la promocion trae la incapacidad ya en VALIDADA.
                  creada: res.incapacidad?.id ? res.incapacidad : creada,
                  motivos: res.motivosBloqueo,
                  validada: res.ok,
                })),
              )
            : of({ creada, motivos: [] as string[], validada: false }),
        ),
        catchError((err: unknown) => {
          this.errorGuardado.set(this.mensajeHttp(err, 'el guardado de la incapacidad'));
          return of(null);
        }),
        finalize(() => this.guardando.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        if (!res) return;
        this.resultado.set({ incapacidad: res.creada, validada: res.validada });
        // Lo que se pinta es el estado REAL del servidor, incluidos los
        // soportes que el recalculo dejo como cargados.
        this.sincronizarSoportesDelServidor(res.creada);
        // A partir de aqui, "Guardar" actualiza: nunca duplica.
        this.idCreado.set(res.creada.id ?? null);
        this.intentoGuardar.set(false);
        if (conValidacion && !res.validada) {
          this.motivosDialogo.set(
            res.motivos.length
              ? res.motivos
              : ['La incapacidad quedo en RECIBIDA: el backend no permitio validarla.'],
          );
          this.dialogo.open(this.plantillaBloqueo(), {
            width: '540px',
            panelClass: 'reg-dialogo-panel',
            autoFocus: false,
          });
        }
        this.desplazarArriba();
      });
  }

  /**
   * Sube los soportes uno a uno DESPUES de crear/actualizar y devuelve la
   * incapacidad RELEIDA del servidor.
   *
   * El destino es `POST /Incapacidades/v2/{id}/soportes`, que ancla en el ID
   * NUMERICO de la incapacidad v2. El multipart legacy resolvia el consecutivo
   * contra la tabla vieja y respondia 404 "Formulario no encontrado" para toda
   * incapacidad del modelo nuevo: por eso los soportes se quedaban en
   * "Pendiente de subir".
   *
   * Al terminar se RELEE la incapacidad porque `soportesCargados` lo recalcula
   * el servidor a partir de los soportes reales; lo que el cliente creia tener
   * no vale. De ese estado real dependen los soportes obligatorios y el paso a
   * VALIDADA.
   */
  private subirSoportes(creada: IncapacidadV2): Observable<IncapacidadV2> {
    const id = creada.id;
    // Solo se suben los archivos elegidos AQUI: los que ya estan en el
    // servidor (edicion) no se vuelven a mandar.
    const pendientes = this.tiposConArchivo();
    if (!pendientes.length || !id) return of(creada);

    const mapa = this.archivos();

    return from(pendientes).pipe(
      concatMap((tipo, indice) => {
        const archivo = mapa[tipo];
        if (!archivo) return of(null);
        this.actualizarArchivo(tipo, { estado: 'subiendo', mensajeError: '' });
        this.progresoSubida.set({
          actual: indice + 1,
          total: pendientes.length,
          etiqueta: ETIQUETA_SOPORTE[tipo],
        });
        return this.srv.subirSoporte(id, tipo, archivo.archivo).pipe(
          // PENDIENTE_SYNC tambien cuenta como cargado: el vinculo ya existe en
          // ms-hr y el envio a ms-documents queda en su cola de reintento.
          tap(() => this.actualizarArchivo(tipo, { estado: 'cargado', mensajeError: '' })),
          // Un soporte que falla NO tumba el guardado: queda con reintento.
          catchError((err: unknown) => {
            this.actualizarArchivo(tipo, {
              estado: 'error',
              mensajeError: this.mensajeErrorSoporte(err, archivo.nombre),
            });
            return of(null);
          }),
        );
      }),
      toArray(),
      switchMap(() => this.releerIncapacidad(id, creada)),
      finalize(() => this.progresoSubida.set(null)),
    );
  }

  /**
   * Relee la incapacidad para quedarse con el estado REAL del servidor
   * (sobre todo `soportesCargados`). Si el GET falla no se pierde el guardado:
   * se sigue con la copia que ya se tenia.
   */
  private releerIncapacidad(id: number, respaldo: IncapacidadV2): Observable<IncapacidadV2> {
    return this.srv.obtener(id).pipe(catchError(() => of(respaldo)));
  }

  /**
   * Refresca la incapacidad mostrada con la version del servidor.
   * Si todavia no hay resultado (edicion sin guardar) NO se inventa uno: solo
   * se sincronizan los soportes, para no encender el panel de "guardada".
   */
  private fijarIncapacidadResultado(incapacidad: IncapacidadV2): void {
    this.resultado.update((actual) => (actual ? { ...actual, incapacidad } : actual));
    this.sincronizarSoportesDelServidor(incapacidad);
  }

  /**
   * Copia a la pantalla los soportes que el servidor dice tener.
   * `soportesCargados` es SU calculo (filas reales de soportes), no la lista
   * optimista que mando el formulario: se acepta tal cual.
   */
  private sincronizarSoportesDelServidor(inc: IncapacidadV2): void {
    const crudos = inc.soportesCargados;
    if (!Array.isArray(crudos)) return;
    const conocidos = new Set<TipoSoporte>(
      crudos
        .map((t) => (t ?? '').toString().trim().toUpperCase())
        .filter((t): t is TipoSoporte => (ORDEN_SOPORTES as readonly string[]).includes(t)),
    );
    this.soportesEnServidor.set(conocidos);
  }

  /** Payload de creacion. Todas las fechas via `aIsoCorto*`. */
  private construirRequestCreacion(): CrearIncapacidadV2Request | null {
    const o = this.form.controls.oficina.getRawValue();
    const p = this.form.controls.personal.getRawValue();
    const i = this.form.controls.incapacidad.getRawValue();
    const v = this.validacion();

    const fechaIngreso = aIsoCortoFlexible(p.fechaIngreso);
    const fechaInicio = aIsoCorto(i.fechaInicio);
    const fechaFin = aIsoCorto(i.fechaFin);
    if (!fechaIngreso || !fechaInicio || !fechaFin || !i.tipoIncapacidad) return null;

    return {
      cedula: p.numeroDocumento.trim(),
      tipoDocumento: p.tipoDocumento.trim(),
      // Nombre DESGLOSADO: el backend no acepta `nombreCompleto` y rechaza el
      // cuerpo entero con 400 ante cualquier campo que no declare.
      primerApellido: p.primerApellido.trim(),
      segundoApellido: p.segundoApellido.trim(),
      primerNombre: p.primerNombre.trim(),
      segundoNombre: p.segundoNombre.trim(),
      fechaIngreso,
      fechaNacimiento: aIsoCortoFlexible(p.fechaNacimiento) || null,
      edad: this.edad(),
      sexo: p.sexo.trim(),
      celular: p.celular.trim(),
      correo: p.correo.trim(),
      empresa: p.empresa.trim(),
      centroCosto: p.centroCosto.trim(),
      temporal: p.temporal.trim(),
      numeroContrato: p.numeroContrato.trim(),
      eps: i.eps.trim(),
      afp: p.fondoPension.trim(),
      arl: p.arl.trim(),

      tipoIncapacidad: i.tipoIncapacidad,
      fechaInicio,
      fechaFin,
      codigoDiagnostico: i.codigoDiagnostico.trim(),
      descripcionDiagnostico: i.descripcionDiagnostico.trim(),
      numeroIncapacidad: i.numeroIncapacidad.trim(),
      // Prorroga, traslape y responsable de pago SIEMPRE los decide el motor de
      // reglas del servidor: no se envian, ni siquiera como sugerencia.
      nitIps: i.nitIps.trim(),
      ipsNombre: i.nombreIps.trim(),

      estadoDocumento: i.estadoDocumento,
      transcrita: i.transcrita,
      // Declaracion OPTIMISTA de lo que el usuario acaba de elegir: sirve para
      // que el motor de reglas no marque como faltantes los soportes que estan
      // a punto de subirse. La verdad la fija el servidor, que recalcula
      // `soportesCargados` con cada subida/borrado; por eso la incapacidad se
      // relee despues de subir los archivos.
      soportesCargados: this.tiposCargados(),
      observaciones: i.observaciones.trim(),

      oficina: o.oficina.trim(),
      recibidoPor: o.nombreQuienRecibe.trim(),
      recibidoPorId: this.usuario.id || undefined,
      actor: this.usuario.email || this.usuario.nombreCompleto || undefined,
      actorRol: this.usuario.rol || undefined,
    };
  }

  /** Limpia el formulario tras confirmacion explicita. */
  pedirLimpiar(): void {
    this.dialogo
      .open(this.plantillaConfirmar(), {
        width: '460px',
        panelClass: 'reg-dialogo-panel',
        autoFocus: false,
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmado) => {
        if (confirmado === true) this.limpiar();
      });
  }

  /** Devuelve la pantalla al estado inicial (conservando el usuario). */
  limpiar(): void {
    for (const archivo of Object.values(this.archivos())) {
      if (archivo?.urlPrevia) URL.revokeObjectURL(archivo.urlPrevia);
    }
    this.archivos.set({});
    this.soportesEnServidor.set(new Set<TipoSoporte>());
    this.empleado.set(null);
    this.modoManual.set(false);
    this.camposSinDato.set(new Set<string>());
    this.errorPersona.set('');
    this.errorGuardado.set('');
    this.errorArchivo.set('');
    this.cedulaBuscada.set('');
    this.validacion.set(null);
    this.prorrogaOrigen.set(null);
    this.resultado.set(null);
    this.intentoGuardar.set(false);
    this.filtroEps.set('');
    this.valorInicialPersona.set('');
    this.errorRegistro.set('');
    this.idCreado.set(null);
    this.origenEdicion.set(null);

    const manuales = (this.catalogos()?.estadosDocumento ?? []).filter((e) => !e.automatico);
    this.form.reset({
      oficina: {
        oficina: this.usuario.sedeNombre,
        nombreQuienRecibe: this.usuario.nombreCompleto,
      },
      personal: { arl: ARL_POR_DEFECTO },
      incapacidad: { estadoDocumento: manuales.length ? manuales[0].codigo : 'OK' },
    });
    this.desplazarArriba();
  }

  // ─────────────────────────────────────────────────────────────────────
  // Utilidades de la vista
  // ─────────────────────────────────────────────────────────────────────

  /** Marca y enfoca el primer control invalido, con scroll suave. */
  private enfocarPrimerInvalido(): void {
    const raiz = this.host.nativeElement as HTMLElement | null;
    if (!raiz) return;
    const nodo = raiz.querySelector<HTMLElement>(
      'input.ng-invalid, textarea.ng-invalid, mat-select.ng-invalid',
    );
    if (!nodo) return;
    nodo.scrollIntoView({ behavior: 'smooth', block: 'center' });
    nodo.focus({ preventScroll: true });
  }

  private desplazarArriba(): void {
    const raiz = this.host.nativeElement as HTMLElement | null;
    raiz?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Lleva la vista a la seccion de soportes (cuando falta el documento minimo). */
  private desplazarASoportes(): void {
    const raiz = this.host.nativeElement as HTMLElement | null;
    const seccion = raiz?.querySelector<HTMLElement>('.reg-grid-soportes, .reg-vacio');
    seccion?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  alternarPanel(): void {
    this.panelAbierto.update((v) => !v);
  }

  /** Mensaje legible a partir de un error HTTP. */
  private mensajeHttp(err: unknown, contexto: string): string {
    const e = err as { status?: number; error?: { message?: unknown } } | null;
    const estado = e?.status;
    if (estado === 0) return 'Sin conexion con el servidor.';
    if (estado === 401 || estado === 403) return 'No tienes permiso para esta operacion.';
    if (estado === 404) return `No se encontro ${contexto}.`;
    if (typeof estado === 'number' && estado >= 500) {
      return `El servidor fallo al procesar ${contexto}. Intenta de nuevo.`;
    }
    const mensaje = e?.error?.message;
    return mensaje ? String(mensaje) : `No se pudo completar ${contexto}.`;
  }

  /**
   * Mensaje de un fallo de subida de soporte, distinguiendo las tres causas
   * que el usuario puede corregir: archivo muy grande, formato no permitido y
   * caida de la red (esta ultima con reintento, que la tarjeta ya ofrece).
   *
   * El backend v2 responde `400` con un texto en espanol (tipo invalido,
   * archivo vacio, mas de 10 MB, mime que no es PDF/JPG/PNG); si viene, ese
   * texto manda porque es mas preciso que cualquier suposicion del cliente.
   */
  private mensajeErrorSoporte(err: unknown, nombre: string): string {
    const estado = (err as { status?: number } | null)?.status;
    const archivo = nombre ? `"${nombre}"` : 'El archivo';
    const detalle = this.textoDeError(err);

    if (estado === 0) {
      return `Sin conexion con el servidor: ${archivo} no se subio. Reintenta.`;
    }
    if (estado === 413) {
      return `${archivo} es demasiado grande: el maximo permitido son 10 MB.`;
    }
    if (estado === 415) {
      return `${archivo} no tiene un formato permitido: debe ser PDF, JPG o PNG.`;
    }
    if (estado === 400) {
      return (
        detalle ||
        `${archivo} fue rechazado: debe ser un PDF, JPG o PNG de hasta 10 MB y no estar vacio.`
      );
    }
    if (estado === 401 || estado === 403) return 'No tienes permiso para subir soportes.';
    if (estado === 404) {
      return 'La incapacidad no existe o esta inactiva en el servidor: no se pudo adjuntar el soporte.';
    }
    if (typeof estado === 'number' && estado >= 500) {
      return `El servidor fallo al guardar ${archivo}. Reintenta en un momento.`;
    }
    // Sin `status` no es un fallo HTTP (p.ej. la incapacidad aun no tiene id).
    if (estado === undefined && err instanceof Error && err.message) return err.message;
    return detalle || `No se pudo subir ${archivo}.`;
  }

  /** Texto util del cuerpo de un error HTTP (`message`, `detalle`, `error` o texto plano). */
  private textoDeError(err: unknown): string {
    const cuerpo = (err as { error?: unknown } | null)?.error;
    if (typeof cuerpo === 'string' && cuerpo.trim()) return cuerpo.trim();
    if (cuerpo && typeof cuerpo === 'object') {
      const c = cuerpo as { message?: unknown; detalle?: unknown; error?: unknown };
      for (const valor of [c.message, c.detalle, c.error]) {
        if (typeof valor === 'string' && valor.trim()) return valor.trim();
      }
    }
    return '';
  }
}
