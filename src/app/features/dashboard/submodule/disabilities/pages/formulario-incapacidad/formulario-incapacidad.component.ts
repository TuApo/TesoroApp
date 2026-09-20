import {  Component, Inject, OnInit, PLATFORM_ID , ChangeDetectionStrategy, signal } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { IncapacidadService } from '../../services/incapacidad/incapacidad.service';
import { Incapacidad } from '../../models/incapacidad.model';
import { InfoCardComponent } from '@/app/shared/components/info-card/info-card.component';
import { PagosService } from '../../services/pagos/pagos.service';
import { ColumnaTabla, TABLA_ESTANDAR, ValorCelda } from '@/app/shared/components/tabla-estandar';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';
import { Router } from '@angular/router';
import { MAT_DATE_FORMATS, MAT_DATE_LOCALE, MatNativeDateModule } from '@angular/material/core';
import { FormControl } from '@angular/forms';
import { combineLatest, Observable, of } from 'rxjs';
import { map, startWith, debounceTime, first, switchMap, catchError } from 'rxjs/operators';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { isPlatformBrowser } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatSelect, MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { CommonModule } from '@angular/common';
import { IncapacidadValidator } from './IncapacidadValidator'; // Ruta de la clase que creamos
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { HiringService } from '@/app/features/dashboard/submodule/hiring/service/hiring.service';
import moment from 'moment';
import { MatMomentDateModule, MAT_MOMENT_DATE_ADAPTER_OPTIONS } from '@angular/material-moment-adapter'; // Importar el adaptador de Moment
import { takeUntil, distinctUntilChanged } from 'rxjs/operators';
import { Subject } from 'rxjs';
import { MatListModule } from '@angular/material/list';
import { forkJoin, mergeMap } from 'rxjs';
import { getLocalStorageItem } from '../../../../../../core/utils/safe-storage';

export const MY_DATE_FORMATS = {
  parse: {
    dateInput: 'DD/MM/YYYY', // Formato de entrada del usuario
  },
  display: {
    dateInput: 'DD/MM/YYYY', // Formato mostrado en el input
    monthYearLabel: 'MMM YYYY', // Formato mostrado en el selector de mes
    dateA11yLabel: 'DD/MM/YYYY', // Formato para accesibilidad
    monthYearA11yLabel: 'MMMM YYYY', // Formato para accesibilidad en el selector de mes
  },
};
interface ColumnTitle {
  [key: string]: string;
}

/** Claves del historial que se ven siempre (el resto, en pantallas anchas). */
const COLUMNAS_PRINCIPALES_HISTORIAL: readonly string[] = [
  'Numero_de_documento', 'nombre', 'apellido', 'consecutivoSistema', 'tipo_incapacidad',
  'F_inicio', 'F_final', 'dias_incapacidad', 'codigo_diagnostico', 'estado_incapacidad',
];

/** Rol de cada clave en la vista de tarjetas; las demas no salen en la tarjeta. */
const ROL_TARJETA_HISTORIAL: Readonly<Record<string, RolTarjetaHistorial>> = {
  tipo_incapacidad: 'titulo',
  F_inicio: 'subtitulo',
  F_final: 'meta',
  dias_incapacidad: 'meta',
  codigo_diagnostico: 'meta',
  estado_incapacidad: 'meta',
  consecutivoSistema: 'meta',
  nombre_eps: 'meta',
};
type RolTarjetaHistorial = NonNullable<ColumnaTabla['tarjeta']>;

/** Dato plano para la tabla estandar: numeros y booleanos tal cual, el resto como texto. */
function valorPlano(value: unknown): ValorCelda {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}

@Component({
  selector: 'app-formulario-incapacidad',
  standalone: true,
  imports: [
    MatSnackBarModule,
    MatDividerModule,
    ...TABLA_ESTANDAR,
    MatMenuModule,
    MatMomentDateModule,
    MatFormFieldModule,
    MatInputModule,
    MatListModule,
    MatSelectModule,
    MatAutocompleteModule,
    CommonModule,
    MatButtonModule,
    MatDatepickerModule,
    MatIconModule,
    FormsModule,
    MatCardModule,
    ReactiveFormsModule
],
  providers: [
    { provide: MAT_DATE_LOCALE, useValue: 'es-ES' }, // Configurar el idioma y la localización
    { provide: MAT_DATE_FORMATS, useValue: MY_DATE_FORMATS }, // Configurar el formato de fecha personalizado
    { provide: MAT_MOMENT_DATE_ADAPTER_OPTIONS, useValue: { useUtc: true } } // Opcional, para manejar fechas en UTC si es necesario
  ],
  templateUrl: './formulario-incapacidad.component.html',
  styleUrl: './formulario-incapacidad.component.css'
})
export class FormularioIncapacidadComponent implements OnInit {
  overlayVisible = false;
  loaderVisible = false;
  currentRole: string = '';
  counterVisible = false;
  incapacidadForm!: FormGroup;
  cedula: string = '';
  isSidebarHidden = false;

  toggleSidebar() {
    this.isSidebarHidden = !this.isSidebarHidden;
  }

  fields: string[] = [
    'Oficina', 'Nombre de quien recibio', 'Tipo de documento', 'Numero de documento', 'Temporal del contrato',
    'Numero de contrato', 'Apellido', 'Nombre', 'Edad', 'Sexo', 'Empresa', 'Centro de costo', 'Celular o telefono 01',
    'Celular o telefono 02', 'Correo Electronico', 'Fecha de ingreso temporal', 'Fecha inicio incapacidad', 'Fecha fin incapacidad', 'Tipo incapacidad', 'Codigo diagnostico',
    'Descripcion diagnostico', 'Dias incapacidad', 'Dias temporal', 'Dias eps', 'Nombre eps',
    'Fondo de pensiones', 'Estado incapacidad', 'Prorroga', 'Incapacidad Transcrita', 'Numero de incapacidad',
    'Nit de la IPS', 'IPS punto de atencion', 'Observaciones', 'Tipo de documento doctor atendido', 'Numero de documento doctor',
    'Nombre doctor', 'Estado robot doctor', 'Archivo Incapacidad', 'Historial clinico', 'Dias de diferencia',
    'Fecha de Envio Incapacidad Fisica', 'Centro de costos', 'Vigente', 'A quien corresponde el pago', 'Estado del documento Incapacidad', 'FURAT',
    'SOAT',
    'FURIPS',
    'Registro Civil',
    'Registro de Nacido Vivo',
    'Formulario de Salud Total'
  ];
  nombreepspersona: string = '';
  fieldMap: { [key: string]: string } = {
    'Oficina': 'Oficina',
    'Nombre de quien recibio': 'nombre_de_quien_recibio',
    'Tipo de documento': 'tipodedocumento',
    'Numero de documento': 'numerodeceduladepersona',
    'Temporal del contrato': 'temporal_contrato',
    'Numero de contrato': 'numero_de_contrato',
    'Apellido': 'primer_apellido',
    'Nombre': 'primer_nombre',
    'Edad': 'edad',
    'Sexo': 'genero',
    'Empresa': 'empresa',
    'Centro de costos': 'Centro_de_costos',
    'Centro de costo': 'Centro_de_costo',
    'Celular o telefono 01': 'celular',
    'Celular o telefono 02': 'whatsapp',
    'Correo Electronico': 'primercorreoelectronico',
    'Fecha de ingreso temporal': 'fecha_contratacion',
    'Fecha inicio incapacidad': 'fecha_inicio_incapacidad',
    'Fecha fin incapacidad': 'fecha_fin_incapacidad',
    'Tipo incapacidad': 'tipo_incapacidad',
    'Codigo diagnostico': 'codigo_diagnostico',
    'Descripcion diagnostico': 'descripcion_diagnostico',
    'Dias incapacidad': 'dias_incapacidad',
    'Dias temporal': 'Dias_temporal',
    'Dias eps': 'dias_eps',
    'Nombre eps': 'nombre_eps',
    'Fondo de pensiones': 'fondo_de_pension',
    'Estado incapacidad': 'estado_incapacidad',
    'Prorroga': 'prorroga',
    'Incapacidad Transcrita': 'Incapacidad_transcrita',
    'Numero de incapacidad': 'numero_de_incapacidad',
    'Nit de la IPS': 'nit_de_la_IPS',
    'IPS punto de atencion': 'ips_punto_de_atencion',
    'Observaciones': 'observaciones',
    'Tipo de documento doctor atendido': 'tipo_de_documento_doctor_atendido',
    'Numero de documento doctor': 'numero_de_documento_doctor',
    'Nombre doctor': 'nombre_doctor',
    'Estado robot doctor': 'estado_robot_doctor',
    'Archivo Incapacidad': 'archivo_incapacidad',
    'Vigente': 'vigente',
    'Historial clinico': 'historial_clinico',
    'Dias de diferencia': 'dias_de_diferencia',
    'Fecha de Envio Incapacidad Fisica': 'Fecha_de_Envio_Incapacidad_Fisica',
    'A quien corresponde el pago': 'correspondeelpago',
    'Estado del documento Incapacidad': 'estado_documento_incapacidad',
    'FURAT': 'furat',
    'SOAT': 'soat',
    'FURIPS': 'furips',
    'Registro Civil': 'registro_civil',
    'Registro de Nacido Vivo': 'registro_de_nacido_vivo',
    'Formulario de Salud Total': 'formulario_salud_total'
  };

  files: Record<string, File[]> = {
    'Historial clinico': [],
    'Archivo Incapacidad': [],
    'FURAT': [],
    'SOAT': [],
    'FURIPS': [],
    'Registro Civil': [],
    'Registro de Nacido Vivo': [],
    'Formulario de Salud Total': []
  };
  epsControlForm = new FormControl();
  IpsControlForm = new FormControl();
  filteredCodigos: Observable<string[]> = of([]);
  filteredEps: Observable<string[]> = of([]);
  allIps: { nit: string, nombre: string }[] = [];
  allCodigosDiagnostico: { codigo: string, descripcion: string }[] = [];
  epsnombres: { nombre: string }[] = []
  isSubmitButtonDisabled = false;
  ipsControlNit = new FormControl();
  ipsControlNombre = new FormControl();
  filteredIpsNit: Observable<string[]> = of([]);
  filteredIpsNombre: Observable<string[]> = of([]);
  private unsubscribe$ = new Subject<void>();
  observacionesControl = new FormControl();
  quiencorrespondepagoControl = new FormControl();
  filteredObservaciones: Observable<string[]> = of([]);
  filteredQuiencorrespondepago: Observable<string[]> = of([]);
  nombredelarchvio = ''
  filterCriteria: any = {
    numeroDeDocumento: ''
  };
  constructor(private fb: FormBuilder, private snackBar: MatSnackBar, private router: Router, private incapacidadService: IncapacidadService, private contratacionService: HiringService,
    @Inject(PLATFORM_ID) private platformId: Object,
  ) {
    this.incapacidadForm = this.fb.group({});
    // Inicializar el formulario

    this.initializeForm();

    // Cargar datos de listas desde el servicio
    this.loadDataForForm();

    // Configurar filtros y validaciones para el formulario
    this.setupFormFilters();
    this.setupFormValidations();
  }
  private initializeForm(): void {
    // Configuración del formulario utilizando los campos y el mapeo
    const formGroupConfig = this.fields.reduce((acc, field) => {
      const formControlName = this.fieldMap[field];
      acc[formControlName] = formControlName === 'whatsapp' || formControlName === 'vigente' || formControlName === 'observaciones' ? [''] : ['', Validators.required];
      return acc;
    }, {} as { [key: string]: any });

    this.incapacidadForm = this.fb.group(formGroupConfig);

    // Deshabilitar los campos iniciales
    this.disableInitialFields();
  }
  async getUser(): Promise<any> {
    if (isPlatformBrowser(this.platformId)) {
      const user = getLocalStorageItem('user');
      return user ? JSON.parse(user) : null;
    }
    return null;
  }
  private disableInitialFields(): void {
    const fieldsToDisable = [
      'primer_apellido', 'primer_nombre', 'tipodedocumento', 'numerodeceduladepersona',
      'temporal_contrato', 'numero_de_contrato', 'edad', 'empresa', 'Centro_de_costo',
      'fecha_contratacion', 'fondo_de_pension', 'dias_eps', 'dias_incapacidad',
      'Dias_temporal', 'descripcion_diagnostico', 'dias_de_diferencia', 'prorroga'
    ];

    fieldsToDisable.forEach(field => this.incapacidadForm.get(field)?.disable());
  }

  private undisableInitialFields(): void {
    const fieldsToDisable = [
      'primer_apellido', 'primer_nombre', 'tipodedocumento', 'numerodeceduladepersona',
      'temporal_contrato', 'numero_de_contrato', 'edad', 'empresa', 'Centro_de_costo',
      'fecha_contratacion', 'fondo_de_pension',
    ];

    fieldsToDisable.forEach(field => this.incapacidadForm.get(field)?.enable());
  }

  mostrarBotonSubirDocumentacion(): boolean {
    const eps = (this.incapacidadForm.get('nombre_eps')?.value || '').toLowerCase().trim();
    return eps && eps !== 'salud total' && eps !== 'mutual ser';
  }

  mostrarBotonSaludTotal(): boolean {
    // Normaliza a minúsculas y quita espacios para evitar errores de comparación
    const epsSeleccionada = (this.incapacidadForm.get('nombre_eps')?.value || '').toLowerCase().trim();
    return epsSeleccionada === 'salud total';
  }

  mostrarBotonesEspeciales(): boolean {
    const eps = (this.incapacidadForm.get('nombre_eps')?.value || '').toLowerCase().trim();
    return eps === 'salud total' || eps === 'mutual ser';
  }

  private loadDataForForm(): void {
    this.cargarInformacion(true);
    this.incapacidadService.traerDatosListas().subscribe(
      response => {
        console.log(response.codigos);
        // Transformar los datos y asignar a los arreglos
        this.allIps = response.IPSNames.map((item: { nit: string, nombreips: string }) => ({
          nit: item.nit,
          nombre: item.nombreips
        }));
        this.allCodigosDiagnostico = response.codigos.map((item: { codigo: string, descripcion: string }) => ({
          codigo: item.codigo,
          descripcion: item.descripcion
        }));
        this.epsnombres = response.eps.map((item: { nombreeps: string }) => ({
          nombre: item.nombreeps
        }));
        this.setupIPSFilters();
        this.setupCodigoFilters();
        this.cargarInformacion(false);
      },
      error => this.handleServiceError('No se pudo cargar la información necesaria para el formulario')
    );
  }

  private handleServiceError(message: string): void {
    Swal.fire({
      icon: 'warning',
      title: 'Error',
      text: message
    });
  }

  private setupFormFilters(): void {
    this.filteredObservaciones = this.observacionesControl.valueChanges.pipe(
      startWith(''),
      map(value => this._filterObservaciones(value || ''))
    );
    // Configuración de los filtros para los campos del formulario
    this.filteredEps = this.epsControlForm.valueChanges.pipe(
      startWith(''),
      map(value => this._filterEps(value))
    );

    // Server-side autocomplete (20 resultados máx, con debounce, sin cargar 12k+ al inicio)
    this.filteredCodigos = this._codigosObs();
    this.filteredIpsNombre = this._ipsNombreObs();
    this.filteredIpsNit = this._ipsNitObs();
  }
  observaciones: string = '';
  quienpaga: string = '';

  observacionesincapacidad: string[] = [
    'TRASLAPADA',
    'PRESCRITA',
    'OK',
    'FALSA',
    'SIN EPICRISIS',
    'SIN INCAPACIDAD',
    'MEDICINA PREPAGADA',
    'ILEGIBLE',
    'INCONSISTENTE -, MAS DE 180 DIAS',
    'MAS DE 540 DIAS',
    'FECHAS INCONSISTENTES',
    'INCAPACIDAD DE 1 DIA ARL',
    'FALTA ORIGINAL',
    'FALTA FURAT',
    'FALTA SOAT',
    'INCAPACIDAD 1 DIA ARL PRORROGA',
    'INCAPACIDAD DE 1 Y 2 DIAS EPS   SI NO ES PROROGA',
    'INCAPACIDAD 1 Y 2 DIAS PRORROGA ',
    'No cumple con el tiempo decreto 780'
  ];

  ColumnsTable1 = [
    'Tipo_de_documento',
    'Numero_de_documento',
    'numero_de_contrato',
    'nombre',
    'apellido',
    'celular_o_telefono_01',
    'celular_o_telefono_02',
    'Oficina',
    'Temporal',
    'edad',
    'observaciones',
    'Dias_temporal',
    'F_inicio',
    'F_final',
    'Fecha_de_Envio_Incapacidad_Fisica',
    'Incapacidad_transcrita',
    'centrodecosto',
    'codigo_diagnostico',
    'consecutivoSistema',
    'correoElectronico',
    'descripcion_diagnostico',
    'dias_de_diferencia',
    'dias_eps',
    'dias_incapacidad',
    'empresa',
    'estado_incapacidad',
    'estado_robot_doctor',
    'fecha_de_ingreso_temporal',
    'fondo_de_pensiones',
    'ips_punto_de_atencion',
    'marcaTemporal',
    'nit_de_la_IPS',
    'nombre_de_quien_recibio',
    'nombre_doctor',
    'nombre_eps',
    'numero_de_documento_doctor',
    'numero_de_incapacidad',
    'prorroga',
    'responsable_de_envio',
    'sexo',
    'tipo_de_documento_doctor_atendido',
    'tipo_incapacidad',
    'quiencorrespondepago',
    'estado_documento_incapacidad'
  ];

  columnTitlesTable1 = {
    'dias_temporal': 'Días Temporal',
    'f_inicio': 'Fecha de Inicio',
    'fecha_de_envio_incapacidad_fisica': 'Fecha de Envío Incapacidad Física',
    'incapacidad_transcrita': 'Incapacidad Transcrita',
    'numero_de_documento': 'Número de Documento',
    'oficina': 'Oficina',
    'temporal': 'Temporal',
    'tipo_de_documento': 'Tipo de Documento',
    'apellido': 'Apellido',
    'celular_o_telefono_01': 'Celular o Teléfono 01',
    'celular_o_telefono_02': 'Celular o Teléfono 02',
    'centrodecosto': 'Centro de Costo',
    'codigo_diagnostico': 'Código Diagnóstico',
    'consecutivoSistema': 'Consecutivo Sistema',
    'correoElectronico': 'Correo Electrónico',
    'descripcion_diagnostico': 'Descripción Diagnóstico',
    'dias_de_diferencia': 'Días de Diferencia',
    'dias_eps': 'Días EPS',
    'dias_incapacidad': 'Días Incapacidad',
    'edad': 'Edad',
    'empresa': 'Empresa',
    'estado_incapacidad': 'Estado Incapacidad',
    'estado_robot_doctor': 'Estado Robot Doctor',
    'fecha_de_ingreso_temporal': 'Fecha de Ingreso Temporal',
    'fondo_de_pensiones': 'Fondo de Pensiones',
    'ips_punto_de_atencion': 'IPS Punto de Atención',
    'marcaTemporal': 'Marca Temporal',
    'nit_de_la_IPS': 'NIT de la IPS',
    'nombre': 'Nombre',
    'nombre_de_quien_recibio': 'Nombre de Quien Recibió',
    'nombre_doctor': 'Nombre Doctor',
    'nombre_eps': 'Nombre EPS',
    'numero_de_contrato': 'Número de Contrato',
    'numero_de_documento_doctor': 'Número de Documento Doctor',
    'numero_de_incapacidad': 'Número de Incapacidad',
    'observaciones': 'Observaciones',
    'prorroga': 'Prórroga',
    'responsable_de_envio': 'Responsable de Envío',
    'sexo': 'Sexo',
    'tipo_de_documento_doctor_atendido': 'Tipo de Documento Doctor Atendido',
    'tipo_incapacidad': 'Tipo Incapacidad',
    'quiencorrespondepago': 'Quién Corresponde el Pago',
    'estado_documento_incapacidad': 'Estado Documento Incapacidad'
  };

  private _filterObservaciones(value: string): string[] {
    const filterValue = value.toLowerCase();
    return this.observacionesincapacidad.filter(option => option.toLowerCase().includes(filterValue));
  }

  private setupFormValidations(): void {
    // Suscripciones a los cambios de valores de los campos del formulario
    this.incapacidadForm.get('fecha_contratacion')?.valueChanges.pipe(
      distinctUntilChanged(),
      takeUntil(this.unsubscribe$)
    ).subscribe(() => {
      this.applyValidation()
    });
    this.incapacidadForm.get('fecha_inicio_incapacidad')?.valueChanges.pipe(
      distinctUntilChanged(),
      takeUntil(this.unsubscribe$)
    ).subscribe(() => {
      this.calcularDiasIncapacidad();
      this.determinarProrroga();
      this.calcularprorroga();
      this.applyValidation()
    });
    this.incapacidadForm.get('tipo_incapacidad')?.valueChanges.pipe(distinctUntilChanged(),
      takeUntil(this.unsubscribe$)
    ).subscribe(() => {
      this.determinarProrroga();
      this.calcularprorroga();
      this.applyValidation();
    });

    this.incapacidadForm.get('fecha_fin_incapacidad')?.valueChanges.pipe(
      distinctUntilChanged(),
      takeUntil(this.unsubscribe$)
    ).subscribe(() => {
      this.calcularDiasIncapacidad();
      this.determinarProrroga();
      this.calcularprorroga();
      this.applyValidation();
    });

    this.incapacidadForm.get('Fecha_de_Envio_Incapacidad_Fisica')?.valueChanges.pipe(
      distinctUntilChanged(),
      takeUntil(this.unsubscribe$)
    ).subscribe(() => {
      this.calcularDiferenciaDias();
    });

    this.incapacidadForm.get('prorroga')?.valueChanges.pipe(
      distinctUntilChanged(),
      takeUntil(this.unsubscribe$)
    ).subscribe(() => {
      this.determinarProrroga();
      this.calcularprorroga();
      this.applyValidation();
    });
    this.incapacidadForm.get('observaciones')?.valueChanges.pipe(
      distinctUntilChanged(),
      takeUntil(this.unsubscribe$)
    ).subscribe(() => {
      this.applyValidation();
    });

    this.incapacidadForm.get('estado_incapacidad')?.valueChanges.pipe(
      distinctUntilChanged(),
      takeUntil(this.unsubscribe$)
    ).subscribe(() => {
      this.applyValidation();
      if (this.incapacidadForm.get('estado_incapacidad')?.value === 'Falsa') {
        this.handleServiceError('Recuerda que es una incapacidad Falsa, se va a reportar esto al area correspondiente');
      }
    });
    this.incapacidadForm.get('prorroga')?.valueChanges.pipe(
      distinctUntilChanged(),
      takeUntil(this.unsubscribe$)
    ).subscribe((value) => {
      this.determinarProrroga();
      this.calcularprorroga();
      this.applyValidation();

      // Si el valor es "SI", muestra el mensaje
      if (value === "SI") {
        Swal.fire({
          icon: 'info',
          title: 'Prórroga seleccionada',
          text: 'Se escogió prórroga.'
        });
      }
    });

  }

  private setupIPSFilters() {
    this.filteredIpsNit = this._ipsNitObs();
    this.filteredIpsNombre = this._ipsNombreObs();

    // Actualizar Nombre cuando se selecciona un NIT (usa el mapa que poblamos en los helpers)
    this.ipsControlNit.valueChanges.pipe(debounceTime(300)).subscribe(value => {
      const selected = this.allIps.find(item => item.nit === value);
      if (selected) {
        this.ipsControlNombre.setValue(selected.nombre, { emitEvent: false });
        this.incapacidadForm.get('ips_punto_de_atencion')?.setValue(selected.nombre);
        this.incapacidadForm.get('nit_de_la_IPS')?.setValue(selected.nit);
      }
    });

    // Actualizar NIT cuando se selecciona un Nombre
    this.ipsControlNombre.valueChanges.pipe(debounceTime(300)).subscribe(value => {
      const selected = this.allIps.find(item => item.nombre === value);
      if (selected) {
        this.ipsControlNit.setValue(selected.nit, { emitEvent: false });
        this.incapacidadForm.get('ips_punto_de_atencion')?.setValue(selected.nombre);
        this.incapacidadForm.get('nit_de_la_IPS')?.setValue(selected.nit);
      }
    });
  }
  applyValidation() {

    const formData = this.incapacidadForm.getRawValue();
    if (this.isIncapacidadSectionActive(formData)) {
      // Validar y formatear fecha de inicio incapacidad
      const rawFechaInicio = this.incapacidadForm.get('fecha_inicio_incapacidad')?.value;
      let normalizedStartDate = '';
      if (rawFechaInicio) {
        const dateObj = new Date(rawFechaInicio);
        if (!isNaN(dateObj.getTime())) {
          normalizedStartDate = moment(dateObj).format('DD/MM/YYYY');
        }
      }
      formData.fecha_inicio_incapacidad = normalizedStartDate;

      // Validar y formatear otras fechas si lo necesitas aquí...

      // Desestructuración del objeto devuelto por validateConditions
      const { errors, quienpaga, observaciones } = IncapacidadValidator.validateConditions(formData);

      this.validationErrors = errors;
      this.quienpaga = quienpaga;
      if (observaciones === "No cumple con el tiempo decreto 780 de 2016" || observaciones === "OK") {
        this.incapacidadForm.get('observaciones')?.setValue(observaciones, { emitEvent: false });
      }

      // Actualizar el campo de "correspondeelpago" en el formulario
      this.incapacidadForm.get('correspondeelpago')?.setValue(quienpaga, { emitEvent: false });

      // Deshabilitar el botón de envío si hay errores de validación
      this.isSubmitButtonDisabled = this.validationErrors.length > 0;
    } else {
      this.isSubmitButtonDisabled = false; // Habilitar el botón si la sección no está activa
    }
  }

  private setupCodigoFilters() {
    this.filteredCodigos = this._codigosObs();
    this.filteredEps = this.epsControlForm.valueChanges.pipe(
      debounceTime(300),
      startWith(''),
      map(value => this._filterEps(value || ''))
    );

    // La suscripción de selección vive en ngOnInit (codigoControl.valueChanges)
    // para evitar doble disparo por cada tecla.

    this.epsControlForm.valueChanges.subscribe(value => {
      const selected = this.epsnombres.find(item => item.nombre === value);
      this.incapacidadForm.get('nombre_eps')?.setValue(selected ? selected.nombre : '');
    });
  }
  private calcularDiferenciaDias() {
    const actualDate = new Date();
    const fechaEnvio = new Date(this.incapacidadForm.get('Fecha_de_Envio_Incapacidad_Fisica')?.value);

    if (fechaEnvio && actualDate) {
      // Convertir las fechas a medianoche para evitar problemas con horas y minutos
      const actualDateMidnight = new Date(actualDate.getFullYear(), actualDate.getMonth(), actualDate.getDate());
      const fechaEnvioMidnight = new Date(fechaEnvio.getFullYear(), fechaEnvio.getMonth(), fechaEnvio.getDate());

      // Calcular la diferencia en tiempo
      const diferenciaEnTiempo = fechaEnvioMidnight.getTime() - actualDateMidnight.getTime();

      // Calcular la diferencia en días
      const diasDeDiferencia = Math.ceil(diferenciaEnTiempo / (1000 * 3600 * 24));

      // Siempre sumar 1 para incluir ambos días, el de inicio y el de fin
      const diasDeIncapacidad = diasDeDiferencia + 1;

      // Asegurarse de que no se calcule un número negativo
      const diasDiferenciaPositivo = Math.max(diasDeIncapacidad, 0);

      this.incapacidadForm.get('dias_de_diferencia')?.setValue(diasDiferenciaPositivo);
    }
  }

  // Método para verificar si los campos relevantes están llenos
  private areRelevantFieldsFilled(formData: any): string | null {

    const fieldsToDisable = [
      'primer_apellido', 'primer_nombre', 'tipodedocumento', 'numerodeceduladepersona',
      'temporal_contrato', 'numero_de_contrato', 'edad', 'empresa', 'Centro_de_costo',
      'fecha_contratacion', 'fondo_de_pension', 'dias_eps', 'dias_incapacidad',
      'Dias_temporal', 'descripcion_diagnostico', 'dias_de_diferencia'
    ];
    // Función auxiliar para verificar si un campo está vacío, nulo o indefinido
    const isFieldEmpty = (field: any) => {
      return field === null || field === undefined || field === '';
    };

    // Función auxiliar para verificar si un campo está deshabilitado
    const isFieldDisabled = (fieldName: string) => {
      return fieldsToDisable.includes(fieldName);
    };

    // Lista de campos que se deben validar
    const fieldsToValidate = [
      'Oficina',
      'temporal_contrato',
      'codigo_diagnostico',
      'prorroga',
      'estado_incapacidad',
      'Incapacidad_transcrita',
      'edad'
    ];

    // Recorre los campos y verifica si deben ser validados
    // Recorre los campos y verifica si están vacíos o deshabilitados
    for (const field of fieldsToValidate) {
      const empty = isFieldEmpty(formData[field]);
      const disabled = isFieldDisabled(field);

      if ((field === 'edad' && empty) || (!disabled && empty)) {
        return field;
      }
    }

    // Si todos los campos relevantes tienen valores o están deshabilitados, devolver null
    return null;
  }
  calcularprorroga() {
    if (this.incapacidadForm.get('prorroga')?.value == 'SI') {
      const diasincapacidad = this.incapacidadForm.get('dias_incapacidad')?.value
      this.incapacidadForm.get('dias_eps')?.setValue(diasincapacidad);
      this.incapacidadForm.get('Dias_temporal')?.setValue(0);
      this.incapacidadForm.get('dias_incapacidad')?.setValue(diasincapacidad);
    }
    if (this.incapacidadForm.get('prorroga')?.value == 'NO') {
      this.calcularDiasIncapacidad()
    } if (this.incapacidadForm.get('prorroga')?.value == 'NO' && this.incapacidadForm.get('tipo_incapacidad')?.value == 'ACCIDENTE DE TRABAJO') {
      const diasincapacidad = this.incapacidadForm.get('dias_incapacidad')?.value
      this.incapacidadForm.get('dias_eps')?.setValue(diasincapacidad - 1);
      this.incapacidadForm.get('Dias_temporal')?.setValue(1);
      this.incapacidadForm.get('dias_incapacidad')?.setValue(diasincapacidad);
      this.incapacidadForm.get('nombre_eps')?.setValue('ARL SURA');
    }
    if (this.incapacidadForm.get('prorroga')?.value == 'NO' && this.incapacidadForm.get('tipo_incapacidad')?.value == 'ENFERMEDAD GENERAL') {
      this.calcularDiasIncapacidad();
      this.incapacidadForm.get('nombre_eps')?.setValue(this.nombreepspersona);
    }
    if (this.incapacidadForm.get('prorroga')?.value == 'SI' && this.incapacidadForm.get('tipo_incapacidad')?.value == 'ENFERMEDAD GENERAL') {
      const diasincapacidad = this.incapacidadForm.get('dias_incapacidad')?.value
      this.incapacidadForm.get('nombre_eps')?.setValue(this.nombreepspersona);
      this.incapacidadForm.get('dias_eps')?.setValue(diasincapacidad);
      this.incapacidadForm.get('Dias_temporal')?.setValue(0);
      this.incapacidadForm.get('dias_incapacidad')?.setValue(diasincapacidad);
    } if (this.incapacidadForm.get('prorroga')?.value == 'SI' && this.incapacidadForm.get('tipo_incapacidad')?.value == 'ACCIDENTE DE TRABAJO') {
      const diasincapacidad = this.incapacidadForm.get('dias_incapacidad')?.value
      this.incapacidadForm.get('nombre_eps')?.setValue('ARL SURA');
      this.incapacidadForm.get('dias_eps')?.setValue(diasincapacidad);
      this.incapacidadForm.get('Dias_temporal')?.setValue(0);
      this.incapacidadForm.get('dias_incapacidad')?.setValue(diasincapacidad);
    }

  }
  calcularDiasIncapacidad() {
    const fechaInicio = new Date(this.incapacidadForm.get('fecha_inicio_incapacidad')?.value);
    const fechaFin = new Date(this.incapacidadForm.get('fecha_fin_incapacidad')?.value);

    if (fechaInicio && fechaFin) {
      // Convertir fechas a medianoche para evitar problemas con horas
      const fechaInicioMidnight = new Date(fechaInicio.getFullYear(), fechaInicio.getMonth(), fechaInicio.getDate());
      const fechaFinMidnight = new Date(fechaFin.getFullYear(), fechaFin.getMonth(), fechaFin.getDate());

      // Calcular la diferencia en tiempo
      const diferenciaEnTiempo = fechaFinMidnight.getTime() - fechaInicioMidnight.getTime();

      // Calcular los días de incapacidad, sumando 1 para incluir ambos días de inicio y fin
      const diasIncapacidad = Math.ceil(diferenciaEnTiempo / (1000 * 3600 * 24)) + 1;

      // Asegurarse de que el valor no sea negativo
      const diasIncapacidadPositivos = Math.max(diasIncapacidad, 0);

      // Establecer el valor de los días de incapacidad en el formulario
      this.incapacidadForm.get('dias_incapacidad')?.setValue(diasIncapacidadPositivos);

      // Calcular los días de incapacidad cubiertos por la EPS
      const diasEps = diasIncapacidadPositivos - 2;

      if (diasEps < 0) {
        this.incapacidadForm.get('dias_eps')?.setValue(0);
        this.incapacidadForm.get('Dias_temporal')?.setValue(diasIncapacidadPositivos);
        this.incapacidadForm.get('dias_incapacidad')?.setValue(diasIncapacidadPositivos);
        return;
      } else {
        this.incapacidadForm.get('dias_eps')?.setValue(diasEps);
        this.incapacidadForm.get('Dias_temporal')?.setValue(2);
        this.incapacidadForm.get('dias_incapacidad')?.setValue(diasIncapacidadPositivos);
        return;
      }
    }
  }

  private isUpdating = false;

  codigoControl = new FormControl();
  fechaInicioControl = new FormControl();
  private ipsMapByNit = new Map<string, string>();
  private ipsMapByNombre = new Map<string, string>();
  private codigosByLabel = new Map<string, { codigo: string; descripcion: string }>();
  descripcionControl = new FormControl({ value: '', disabled: true });
  nombreControl = new FormControl({ value: '', disabled: true });
  validationErrors: string[] = [];


  async ngOnInit(): Promise<void> {
    // `loadData()` se eliminó del ciclo de inicio porque descargaba > 12k incapacidades sin
    // filtrar (causaba ERR_CONNECTION_RESET). El historial del trabajador ahora se solicita
    // filtrado por cédula dentro de `buscarCedula()`.
    const user = await this.getUser();
    if (!user) {
      return;
    }

    const rolRaw: any = user.rol;
    const rolStr = typeof rolRaw === 'string'
      ? rolRaw
      : (rolRaw?.nombre ?? rolRaw?.name ?? 'user');
    this.currentRole = String(rolStr).toUpperCase().replace(/-/g, '_');
    if (this.currentRole === 'INCAPACIDADADMIN') {
      this.undisableInitialFields();
    }
    this.allIps.forEach(item => {
      this.ipsMapByNit.set(item.nit, item.nombre);
      this.ipsMapByNombre.set(item.nombre, item.nit);
    });

    // Autocompletes server-side (usan índices MySQL, payload < 3 KB)
    this.filteredIpsNit = this._ipsNitObs();
    this.filteredIpsNombre = this._ipsNombreObs();
    this.filteredCodigos = this._codigosObs();
    this.filteredEps = this.epsControlForm.valueChanges.pipe(
      startWith(''),
      map(value => this._filterEps(value || ''))
    );

    // Selección de código diagnóstico:
    //   - Mientras el usuario escribe, value es texto parcial → no resuelve, no se tocan los campos.
    //   - Al elegir una opción del autocomplete (label "CODE — descripcion"), resolveCodigoSeleccion
    //     devuelve el par {codigo, descripcion} cacheado y se llenan los campos del form.
    this.codigoControl.valueChanges
      .pipe(debounceTime(50), distinctUntilChanged())
      .subscribe(value => {
        const selected = this.resolveCodigoSeleccion(value);
        if (!selected) return;

        this.descripcionControl.setValue(selected.descripcion);
        this.incapacidadForm.get('descripcion_diagnostico')?.setValue(selected.descripcion);
        this.incapacidadForm.get('codigo_diagnostico')?.setValue(selected.codigo);
        this.determinarProrroga();
        this.calcularprorroga();
      });
    this.epsControlForm.valueChanges.pipe(debounceTime(300)).subscribe(value => {
      const selected = this.epsnombres.find(item => item.nombre === value);
      this.incapacidadForm.get('nombre_eps')?.setValue(selected ? selected.nombre : '');
    });

    this.ipsControlNit.valueChanges.pipe(debounceTime(300)).subscribe(value => {
      const selectedNombre = this.ipsMapByNit.get(value);
      if (selectedNombre) {
        this.ipsControlNombre.setValue(selectedNombre, { emitEvent: false });
        this.incapacidadForm.get('ips_punto_de_atencion')?.setValue(selectedNombre);
        this.incapacidadForm.get('nit_de_la_IPS')?.setValue(value);
      }
    });

    this.fechaInicioControl.valueChanges.pipe(
      debounceTime(300)
    ).subscribe(() => {
      this.determinarProrroga();
      this.calcularprorroga();
    });

    // Actualizar NIT cuando se selecciona un Nombre
    this.ipsControlNombre.valueChanges.pipe(debounceTime(300)).subscribe(value => {
      const selectedNit = this.ipsMapByNombre.get(value);
      if (selectedNit) {
        this.ipsControlNit.setValue(selectedNit, { emitEvent: false });
        this.incapacidadForm.get('ips_punto_de_atencion')?.setValue(value);
        this.incapacidadForm.get('nit_de_la_IPS')?.setValue(selectedNit);
      }
    });
  }
  private _filterEps(value: string): string[] {
    const filterValue = value.toLowerCase();
    const result = this.epsnombres
      .map(item => item.nombre)
      .filter(nombre => nombre.toLowerCase().includes(filterValue));
    return Array.from(new Set(result));
  }

  // Nota: _filter, _filterNit y _filterNombre (client-side) fueron eliminados.
  // Ahora todos los autocompletes usan los helpers server-side más abajo
  // (_codigosObs, _ipsNitObs, _ipsNombreObs) que consultan endpoints paginados
  // con índices MySQL — payload ~3 KB vs 1.5 MB.

  // ---------------------------------------------------------------------------
  // AUTOCOMPLETE SERVER-SIDE (rápido, usa índices MySQL)
  // ---------------------------------------------------------------------------

  /** Observable para el autocomplete de códigos: server-side con debounce.
   *  Escucha al MISMO control bindeado al input (codigoControl).
   *  Emite labels "CODE — descripcion" y cachea cada label en codigosByLabel
   *  para que el handler de selección pueda resolver al par {codigo, descripcion}.
   */
  private _codigosObs(): Observable<string[]> {
    return this.codigoControl.valueChanges.pipe(
      startWith(''),
      debounceTime(220),
      distinctUntilChanged(),
      switchMap((value: any) => {
        const q = String(value || '').trim();
        if (q.length < 1) return of([] as string[]);
        // Si el usuario ya seleccionó (el value es una label cacheada), no re-buscar.
        if (this.codigosByLabel.has(q)) return of([q]);
        return this.incapacidadService.buscarCodigosDiagnostico(q, 20).pipe(
          map(items => {
            const labels: string[] = [];
            for (const it of items) {
              const label = this.formatCodigoLabel(it.codigo, it.descripcion);
              this.codigosByLabel.set(label, { codigo: it.codigo, descripcion: it.descripcion });
              labels.push(label);
            }
            return Array.from(new Set(labels));
          }),
          catchError(() => of([] as string[]))
        );
      })
    );
  }

  private formatCodigoLabel(codigo: string, descripcion: string): string {
    const desc = (descripcion || '').replace(/^descripcion:\s*/i, '').trim();
    return desc ? `${codigo} — ${desc}` : codigo;
  }

  /** Resuelve el value del autocomplete a {codigo, descripcion}.
   *  Acepta una label cacheada o un código exacto.
   */
  private resolveCodigoSeleccion(value: any): { codigo: string; descripcion: string } | null {
    const v = String(value || '').trim();
    if (!v) return null;
    const fromLabel = this.codigosByLabel.get(v);
    if (fromLabel) return fromLabel;
    const fromList = this.allCodigosDiagnostico.find(item => item.codigo === v);
    if (fromList) return { codigo: fromList.codigo, descripcion: fromList.descripcion };
    return null;
  }

  /** Observable para autocomplete de IPS por NIT */
  private _ipsNitObs(): Observable<string[]> {
    return this.ipsControlNit.valueChanges.pipe(
      startWith(''),
      debounceTime(220),
      distinctUntilChanged(),
      switchMap((value: any) => {
        const q = String(value || '').trim();
        if (!q) return of([] as string[]);
        return this.incapacidadService.buscarIps(q, 20).pipe(
          map(items => {
            // Cachear en ipsMapByNit/Nombre para que se pueda mapear nit↔nombre al seleccionar
            items.forEach(it => {
              this.ipsMapByNit.set(it.nit, it.nombre);
              this.ipsMapByNombre.set(it.nombre, it.nit);
            });
            return Array.from(new Set(items.map(i => i.nit)));
          }),
          catchError(() => of([] as string[]))
        );
      })
    );
  }

  /** Observable para autocomplete de IPS por nombre */
  private _ipsNombreObs(): Observable<string[]> {
    return this.ipsControlNombre.valueChanges.pipe(
      startWith(''),
      debounceTime(220),
      distinctUntilChanged(),
      switchMap((value: any) => {
        const q = String(value || '').trim();
        if (!q) return of([] as string[]);
        return this.incapacidadService.buscarIps(q, 20).pipe(
          map(items => {
            items.forEach(it => {
              this.ipsMapByNit.set(it.nit, it.nombre);
              this.ipsMapByNombre.set(it.nombre, it.nit);
            });
            return Array.from(new Set(items.map(i => i.nombre)));
          }),
          catchError(() => of([] as string[]))
        );
      })
    );
  }

  displayIps(ips: { nit: string, nombre: string }): string {
    return ips ? `${ips.nit} - ${ips.nombre}` : '';
  }

  playSound(success: boolean): void {
    const audio = new Audio(success ? 'Sounds/positivo.mp3' : 'Sounds/negativo.mp3');
    audio.play();
  }

  private isIncapacidadSectionActive(formData: any): boolean {
    const fieldsToCheck = [
      this.fieldMap['Fecha inicio incapacidad'],
      this.fieldMap['Fecha de ingreso temporal'],
      this.fieldMap['Fecha fin incapacidad'],
      this.fieldMap['Prorroga'],
      this.fieldMap['Codigo diagnostico'],
      this.fieldMap['Descripcion diagnostico'],
      this.fieldMap['Dias incapacidad'],
      this.fieldMap['Dias temporal'],
      this.fieldMap['Dias eps'],
      this.fieldMap['Estado incapacidad'],
      this.fieldMap['Incapacidad Transcrita'],
      this.fieldMap['Dias de diferencia']
    ];

    // Verificar si al menos uno de los campos en la sección de "Información de Incapacidad" tiene un valor
    return fieldsToCheck.some(field => formData[field] !== null && formData[field] !== '');
  }

  mostrarCargando(estado: boolean) {
    if (estado) {
      // Mostrar la alerta de carga con spinner
      Swal.fire({
        title: 'Cargando...',
        html: 'Por favor espera mientras se carga la información',
        icon: 'info',
        allowOutsideClick: false, // Evitar que se cierre al hacer click fuera
        didOpen: () => {
          Swal.showLoading(); // Mostrar el spinner
        }
      });
    } else {
      // Cerrar la alerta de carga
      Swal.close();
    }
  }

  // Método que se llama con el estado
  cargarInformacion(estado: boolean) {
    this.mostrarCargando(estado); // Mostrar o cerrar la alerta dependiendo del estado

    if (estado) {
      // Simulación de una operación de carga (reemplazar con lógica real)
      setTimeout(() => {
        // Aquí se cierra el Swal después de la simulación (simulación de 5 segundos)
        this.mostrarCargando(false);
      }, 5000);
    }
  }

  onSubmit(): void {
    // Evitar múltiples envíos
    let fieldEmpty = this.areRelevantFieldsFilled(this.incapacidadForm.getRawValue());
    if (fieldEmpty !== null) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'Por favor llena los campos obligatorios, el campo ' + fieldEmpty + ' está vacío'
      });
      return;
    } else {
      this.unsubscribe$.next();
      this.cargarInformacion(true);

      // Habilita todos los controles antes de enviar
      Object.keys(this.incapacidadForm.controls).forEach((controlName) => {
        this.incapacidadForm.get(controlName)?.enable();
      });

      // Normalización de tipo de documento
      const tipoDoc = this.incapacidadForm.get('tipodedocumento')?.value;
      if (tipoDoc == 'Cedula de ciudadania') {
        this.incapacidadForm.get('tipodedocumento')?.setValue('CC');
      }
      if (tipoDoc == 'Cedula de extranjeria') {
        this.incapacidadForm.get('tipodedocumento')?.setValue('CE');
      }
      if (tipoDoc == 'Pasaporte') {
        this.incapacidadForm.get('tipodedocumento')?.setValue('PA');
      }
      else if (tipoDoc == 'Tarjeta de identidad') {
        this.incapacidadForm.get('tipodedocumento')?.setValue('TI');
      }
      else if (tipoDoc == 'Permiso de proteccion temporal') {
        this.incapacidadForm.get('tipodedocumento')?.setValue('PPT');
      }


      // Normalización de tipo de documento doctor
      const tipoDocDoctor = this.incapacidadForm.get('tipo_de_documento_doctor_atendido')?.value;
      if (tipoDocDoctor == 'Cedula de ciudadania') {
        this.incapacidadForm.get('tipo_de_documento_doctor_atendido')?.setValue('CC');
      }
      if (tipoDocDoctor == 'Cedula de extranjeria') {
        this.incapacidadForm.get('tipo_de_documento_doctor_atendido')?.setValue('CE');
      }
      if (tipoDocDoctor == 'Pasaporte') {
        this.incapacidadForm.get('tipo_de_documento_doctor_atendido')?.setValue('PA');
      }

      // Fechas seguras y formateadas
      const fechaInicioStr = this.incapacidadForm.get('fecha_inicio_incapacidad')?.value;
      const fechaFinStr = this.incapacidadForm.get('fecha_fin_incapacidad')?.value;
      const fechaEnvioStr = this.incapacidadForm.get('Fecha_de_Envio_Incapacidad_Fisica')?.value;

      let normalizedStartDate = '';
      let normalizedEndDate = '';
      let normalizedFechaEnvio = '';

      if (fechaInicioStr) {
        const fechaInicioDate = new Date(fechaInicioStr);
        if (!isNaN(fechaInicioDate.getTime())) {
          normalizedStartDate = moment(fechaInicioDate).format('DD-MM-YYYY');
        }
      }
      if (fechaFinStr) {
        const fechaFinDate = new Date(fechaFinStr);
        if (!isNaN(fechaFinDate.getTime())) {
          normalizedEndDate = moment(fechaFinDate).format('DD-MM-YYYY');
        }
      }
      if (fechaEnvioStr) {
        const fechaEnvioDate = new Date(fechaEnvioStr);
        if (!isNaN(fechaEnvioDate.getTime())) {
          normalizedFechaEnvio = moment(fechaEnvioDate).format('DD-MM-YYYY');
        }
      }

      // Actualizar las fechas normalizadas en el formulario
      this.incapacidadForm.patchValue({
        fecha_inicio_incapacidad: normalizedStartDate,
        fecha_fin_incapacidad: normalizedEndDate,
        Fecha_de_Envio_Incapacidad_Fisica: normalizedFechaEnvio,
      });

      const nuevaIncapacidad: Incapacidad = this.incapacidadForm.value;

      if (isNaN(nuevaIncapacidad.dias_incapacidad) || nuevaIncapacidad.dias_incapacidad === undefined) {
        const fechaInicio = fechaInicioStr ? new Date(fechaInicioStr) : null;
        const fechaFin = fechaFinStr ? new Date(fechaFinStr) : null;

        if (fechaInicio && fechaFin && !isNaN(fechaInicio.getTime()) && !isNaN(fechaFin.getTime())) {
          const diferenciaEnTiempo = fechaFin.getTime() - fechaInicio.getTime();
          const diasIncapacidad = Math.ceil(diferenciaEnTiempo / (1000 * 3600 * 24)) + 1;
          nuevaIncapacidad.dias_incapacidad = diasIncapacidad;
        } else {
          Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Ha ocurrido un error con las fechas que ingresaste, por favor verifica que estén bien'
          });
          this.cargarInformacion(false);
          return;
        }
      }

      // Envía la incapacidad al servicio
      this.incapacidadService.createIncapacidad(nuevaIncapacidad).pipe(first()).subscribe(
        async (response: any) => {
          const consecutivoSistema: string =
            response?.consecutivoSistema || response?.consecutivo || '';

          if (!consecutivoSistema) {
            this.cargarInformacion(false);
            Swal.fire({
              icon: 'warning',
              title: 'Incapacidad creada (sin documentos)',
              text: 'No se recibió consecutivoSistema. Los PDFs no se pudieron vincular; comunica a soporte.',
            });
            this.resetPage();
            return;
          }

          // Subir cada PDF vía multipart al nuevo endpoint
          let uploadError: string | null = null;
          try {
            await this.uploadPendingFiles(consecutivoSistema);
          } catch (e: any) {
            uploadError = String(e?.message || e);
          }

          this.cargarInformacion(false);
          if (uploadError) {
            Swal.fire({
              icon: 'warning',
              title: 'Incapacidad creada con observaciones',
              text:
                `La incapacidad ${consecutivoSistema} se creó, pero algunos PDFs ` +
                `fallaron al subirse:\n${uploadError}`,
            });
          } else {
            Swal.fire({
              icon: 'success',
              title: 'Incapacidad creada',
              text: 'La incapacidad ha sido creada exitosamente, puedes verla en la lista de incapacidades',
            });
          }

          this.incapacidadForm.reset();
          for (const key in this.fieldMap) {
            this.incapacidadForm.get(key)?.setValue('');
          }
          this.files = {
            'Historial clinico': [],
            'Archivo Incapacidad': [],
            'FURAT': [],
            'SOAT': [],
            'FURIPS': [],
            'Registro Civil': [],
            'Registro de Nacido Vivo': [],
            'Formulario de Salud Total': [],
          };
          this.validationErrors = [];
          this.isSubmitButtonDisabled = false;
          this.resetPage();
        },
        error => {
          console.error('Error al crear la incapacidad:', error);
          Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Ha ocurrido un error al crear la incapacidad'
          });
          this.loaderVisible = false;
          this.disableCertainFields();
          this.cargarInformacion(false);
        }
      );
    }
  }
  resetPage(): void {
    this.incapacidadForm.reset();
    this.incapacidadForm.get('nombre_eps')?.setValue('');
    this.incapacidadForm.get('Oficina')?.setValue('');
    this.incapacidadForm.get('nombre_de_quien_recibio')?.setValue('');
    this.incapacidadForm.get('empresa')?.setValue('');
    this.incapacidadForm.get('nit_de_la_IPS')?.setValue('');
    this.incapacidadForm.get('ips_punto_de_atencion')?.setValue('');
    this.incapacidadForm.get('codigo_diagnostico')?.setValue('');
    this.incapacidadForm.get('descripcion_diagnostico')?.setValue('');
    this.incapacidadForm.get('dias_incapacidad')?.setValue('');
    this.incapacidadForm.get('dias_eps')?.setValue('');
    this.incapacidadForm.get('Dias_temporal')?.setValue('');
    this.incapacidadForm.get('estado_incapacidad')?.setValue('');
    this.incapacidadForm.get('Incapacidad_transcrita')?.setValue('');
    this.incapacidadForm.get('dias_de_diferencia')?.setValue('');
    this.incapacidadForm.get('fecha_inicio_incapacidad')?.setValue('');
    this.incapacidadForm.get('fecha_fin_incapacidad')?.setValue('');
    this.incapacidadForm.get('prorroga')?.setValue('');
    this.incapacidadForm.get('observaciones')?.setValue('');
    this.incapacidadForm.get('Fecha_de_Envio_Incapacidad_Fisica')?.setValue('');
    this.incapacidadForm.get('tipo_incapacidad')?.setValue('');
    this.incapacidadForm.get('tipo_de_documento_doctor_atendido')?.setValue('');
    this.router.navigateByUrl('/home', { skipLocationChange: true }).then(() => {
      this.router.navigate(['/formulario-incapacicades']);
    });
  }
  // Método auxiliar para deshabilitar campos específicos
  disableCertainFields(): void {
    this.incapacidadForm.get('genero')?.disable();
    this.incapacidadForm.get('primer_apellido')?.disable();
    this.incapacidadForm.get('primer_nombre')?.disable();
    this.incapacidadForm.get('tipodedocumento')?.disable();
    this.incapacidadForm.get('numerodeceduladepersona')?.disable();
    this.incapacidadForm.get('temporal_contrato')?.disable();
    this.incapacidadForm.get('numero_de_contrato')?.disable();
    this.incapacidadForm.get('edad')?.disable();
    this.incapacidadForm.get('empresa')?.disable();
    this.incapacidadForm.get('Centro_de_costo')?.disable();
    this.incapacidadForm.get('fecha_contratacion')?.disable();
    this.incapacidadForm.get('fondo_de_pension')?.disable();
    this.isSubmitButtonDisabled = false; // Rehabilitar el botón
  }
  [key: string]: any;
  sucursalde = ''
  nombredequienrecibio = ''
  empresa = ''

  buscarCedula(cedula: string): void {
    this.cedula = cedula;
    this.cargarInformacion(true);
    // Historial filtrado por cédula (payload ligero, excluye TextField de archivos)
    this.loadData(cedula);

    const storedData = getLocalStorageItem('user');

    if (storedData) {
      const dataObject = JSON.parse(storedData);
      this.sucursalde = dataObject.sucursalde;
      this.nombredequienrecibio = dataObject.primer_apellido + ' ' + dataObject.primer_nombre;
      this.empresa = dataObject.sitio_contratacion;
    } else {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'Ha ocurrido un error al buscar tus datos, cierra la sesion y vuelve a ingresar'
      });
    }

    this.contratacionService.traerDatosEncontratacion(cedula).subscribe(
      (response: any) => {
        this.cargarInformacion(false);
        const contratacion = response.contratacion || {};
        const datosBasicos = response.datos_basicos || {};
        const afp = response.afp || {};

        const tipoNorm = (datosBasicos.tipodedocumento || '')
          .toUpperCase()
          .replace(/\./g, '')
          .replace(/\s+/g, '')
          .trim();
        const tipoDocMap: Record<string, string> = {
          CC: 'Cedula de ciudadania',
          CE: 'Cedula de extranjeria',
          PA: 'Pasaporte',
          TI: 'Tarjeta de identidad',
          PPT: 'Permiso de proteccion temporal',
        };
        const tipoDocLabel = tipoDocMap[tipoNorm] || datosBasicos.tipodedocumento || '';

        const generoMap: Record<string, string> = { M: 'Masculino', F: 'Femenino' };
        const generoLabel = generoMap[datosBasicos.genero] || datosBasicos.genero || '';

        const joinNombres = (a: any, b: any) =>
          [a, b].filter(v => v != null && String(v).trim() !== '').join(' ').trim();

        this.nombreepspersona = afp.eps || '';

        this.incapacidadForm.patchValue({
          Oficina: this.convertToTitleCaseAndRemoveAccents(this.sucursalde),
          nombre_de_quien_recibio: this.nombredequienrecibio,
          Centro_de_costo: contratacion.centro_costo_carnet,
          Centro_de_costos: contratacion.centro_de_costos,
          empresa: contratacion.empresaUsuaraYCCentrodeCosto,
          numero_de_contrato: contratacion.codigo_contrato,
          temporal_contrato: contratacion.temporal,
          fecha_contratacion: contratacion.fecha_contratacion,
          tipodedocumento: tipoDocLabel,
          numerodeceduladepersona: cedula,
          primer_nombre: joinNombres(datosBasicos.primer_nombre, datosBasicos.segundo_nombre),
          primer_apellido: joinNombres(datosBasicos.primer_apellido, datosBasicos.segundo_apellido),
          edad: datosBasicos.edadTrabajador,
          genero: generoLabel,
          celular: datosBasicos.celular,
          whatsapp: datosBasicos.whatsapp,
          primercorreoelectronico: datosBasicos.primercorreoelectronico,
          fondo_de_pension: afp.afc,
          nombre_eps: afp.eps,
        });

        this.epsControlForm.setValue(afp.eps || '', { emitEvent: false });
      },
      (_error: any) => {
        this.cargarInformacion(false);
        Swal.fire({
          icon: 'error',
          title: 'Error',
          text: 'La cedula que buscas no se encuentra en la base de datos, por favor verifica que sea correcta, si el problema persiste reportalo a contratacion'
        });
      }
    );
  }

  historialIncapacidades: Incapacidad[] = [];
  mostrarHistorial = false;
  /** Historial de incapacidades del trabajador (tabla estandar). */
  readonly historialFilas = signal<any[]>([]);

  /**
   * Columnas del historial: una por cada clave de ColumnsTable1, con el mismo
   * titulo de antes. Las claves principales se ven siempre y en la tarjeta
   * (movil); el resto, en la vista tabla desde 1024 px.
   */
  readonly columnasHistorial: ColumnaTabla<any>[] = this.ColumnsTable1.map((col): ColumnaTabla<any> => ({
    id: col,
    header: this.toTitleCase(col, this.columnTitlesTable1),
    valor: (fila) => valorPlano(fila?.[col]),
    prioridad: COLUMNAS_PRINCIPALES_HISTORIAL.includes(col) ? 1 : 3,
    tarjeta: ROL_TARJETA_HISTORIAL[col] ?? 'oculto',
  }));

  readonly idHistorial = (fila: any, i: number) => fila?.consecutivoSistema ?? i;

  // Función principal para aplicar el filtro por cédula
  applyCedulaFilter(cedula: string): void {
    // Asegúrate de tener el valor de la cédula a buscar
    if (!cedula) {
      this.showInfo('Por favor ingresa una cédula para filtrar.');
      return;
    }
    // Filtra usando la función filterByCedula
    const filteredData = this.filterByCedula(this.historialFilas(), cedula);
    if (filteredData.length === 0) {
      this.showInfo('No se encontraron registros para la cédula ingresada.');
    } else {
      this.historialFilas.set(filteredData);
    }
  }

  // Función auxiliar para filtrar por cédula (número de documento)
  private filterByCedula(data: any[], cedula: string): any[] {
    return data.filter(item => this.cedulaMatch(item.Numero_de_documento, cedula));
  }

  // Función que compara exactamente la cédula ingresada con la del registro
  private cedulaMatch(value: string, cedula: string): boolean {
    return value?.toLowerCase().trim() === cedula;
  }

  // Opcional: función para mostrar mensajes informativos
  private showInfo(message: string): void {
    Swal.fire({
      icon: 'info',
      title: 'Información',
      text: message,
      confirmButtonText: 'Aceptar'
    });
  }

  private loadData(cedula?: string): void {
    this.cargarInformacion(true);
    forkJoin({
      incapacidades: this.incapacidadService.traerTodosDatosIncapacidad(cedula ? { cedula } : undefined),
      reporte: this.incapacidadService.traerTodosDatosReporte(cedula ? { cedula } : undefined)
    }).subscribe({
      next: ({ incapacidades, reporte }) => {
        this.handleDataSuccess(incapacidades || [], reporte?.data || []);
        this.cargarInformacion(false);
        this.mostrarHistorial = (incapacidades?.length ?? 0) > 0;
      },
      error: () => {
        this.cargarInformacion(false);
        this.handleError('Error al cargar el historial, por favor intenta de nuevo.');
      }
    });
  }

  private handleDataSuccess(incapacidades: any[], reporte: any[]): void {
    this.historialFilas.set(incapacidades);
  }

  private handleError(errorMessage: string): void {
    Swal.fire({
      icon: 'error',
      title: 'Error',
      text: errorMessage,
      confirmButtonText: 'Aceptar'
    });
  }

onUploadClick(field: string) {
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/pdf,.pdf';
  fileInput.style.display = 'none';

  fileInput.onchange = (event: any) => {
    const file: File = event.target.files[0];
    if (!file) return;

    const MAX_SIZE = 2 * 1024 * 1024; // 2MB
    if (file.size > MAX_SIZE) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: `El archivo "${file.name}" supera el límite de 2 MB.`,
      });
      return;
    }

    // El archivo ya NO se sube como base64 dentro del JSON. Lo guardamos en
    // memoria y se enviará vía multipart después de crear la incapacidad
    // (ver onSubmit -> uploadPendingFiles).
    this.addFile(field, file);
    this.nombredelarchvio = file.name;
  };

  fileInput.click();
}

// Mapeo del label de UI al campo legacy esperado por el backend.
private readonly UI_TO_LEGACY_FIELD: Record<string, string> = {
  'Archivo Incapacidad': 'link_incapacidad',
  'Historial clinico': 'historial_clinico',
  'FURAT': 'furat',
  'SOAT': 'soat',
  'FURIPS': 'furips',
  'Registro Civil': 'registro_civil',
  'Registro de Nacido Vivo': 'registro_de_nacido_vivo',
  'Formulario de Salud Total': 'formulario_salud_total',
};

/**
 * Sube todos los PDFs pendientes (uno por uno, multipart) al endpoint
 * `/Incapacidades/<consecutivo>/documentos/upload` después de crear la
 * incapacidad. Devuelve un Promise que resuelve cuando todos terminaron;
 * si alguno falla, el Promise se rechaza con la lista de errores.
 */
private async uploadPendingFiles(consecutivoSistema: string): Promise<void> {
  const errores: string[] = [];
  for (const uiField of Object.keys(this.files)) {
    const legacy = this.UI_TO_LEGACY_FIELD[uiField];
    if (!legacy) continue;
    for (const file of this.files[uiField] || []) {
      try {
        await this.incapacidadService.uploadDocumento(consecutivoSistema, legacy, file);
      } catch (e: any) {
        const msg = e?.error?.error || e?.message || 'Error desconocido';
        errores.push(`${uiField}: ${msg}`);
      }
    }
  }
  if (errores.length) {
    throw new Error('Algunos archivos no se subieron:\n' + errores.join('\n'));
  }
}


  removeFile(field: string, file: File): void {
    const index = this.files[field].indexOf(file);
    if (index >= 0) {
      this.files[field].splice(index, 1); // Eliminar el archivo de la lista si se encuentra
    }
  }

  addFile(field: string, file: File): void {
    if (!this.files[field]) {
      this.files[field] = [];  // Si el campo no existe, inicializar como un array vacío
    }
    this.files[field].push(file); // Añadir el archivo al campo especificado
  }

  getFieldType(field: string): string {
    if (field === 'Correo Electronico') {
      return 'email';
    } else if (field === 'Marca Temporal' || field === 'Fecha_de_Envio_Incapacidad_Fisica' || field === 'fecha_inicio_incapacidad') {
      return 'date';
    } else if (field === 'Edad' || field === 'dias_incapacidad' || field === 'Dias_temporal' || field === 'dias_eps' || field === 'dias_de_diferencia') {
      return 'number';
    } else if (field === 'Sexo' || field === 'Tipo de documento') {
      return 'select';
    }
    else {
      return 'text';
    }
  }

  sexos: string[] = ['Masculino', 'Femenino'];
  Prorroga: string[] = ['SI', 'NO'];
  tiposDocumento: string[] = ['Cedula de ciudadania', 'Cedula de extranjeria', 'Pasaporte', 'Tarjeta de identidad', 'Permiso de proteccion temporal'];
  tiposDocumentoDoctor: string[] = ['Cedula de ciudadania', 'Cedula de extranjeria', 'Pasaporte', 'Tarjeta de identidad'];
  tiposincapacidad: string[] = ['ENFERMEDAD GENERAL', 'LICENCIA DE MATERNIDAD', 'LICENCIA PATERNIDAD', 'ACCIDENTE DE TRABAJO', 'SOAT / ACCIDENTE DE TRANCITO', 'ENFERMEDAD LABORAL']

  // ...dentro de tu clase FormularioIncapacidadComponent

  get tipoIncapacidadSeleccionado(): string {
    return this.incapacidadForm.get('tipo_incapacidad')?.value;
  }

  toTitleCase(text: string, columnTitles: ColumnTitle): string {
    return columnTitles[text] || text
      .toLowerCase()
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  // Ejemplo de función para saber si mostrar un botón
  mostrarBotonAccidenteTrabajo(): boolean {
    return this.tipoIncapacidadSeleccionado === 'ENFERMEDAD LABORAL' || this.tipoIncapacidadSeleccionado === 'ACCIDENTE DE TRABAJO';
  }

  // Ejemplo de función para saber si mostrar un botón
  mostrarBotonAccidenteTrancito(): boolean {
    return this.tipoIncapacidadSeleccionado === 'SOAT / ACCIDENTE DE TRANCITO';
  }

  mostrarBotonMATERNIDAD(): boolean {
    return this.tipoIncapacidadSeleccionado === 'LICENCIA DE MATERNIDAD' || this.tipoIncapacidadSeleccionado === 'LICENCIA PATERNIDAD';
  }

  // Puedes hacer una genérica si tienes muchos tipos:
  mostrarBotonPorTipo(tipo: string): boolean {
    return this.tipoIncapacidadSeleccionado === tipo;
  }

  estadoincapacidad: string[] = ['Original', 'Falsa', 'Copia']
  centrodecosto: string[] = [
    'Andes',
    'Cartagenita',
    'Facatativa Principal',
    'Facatativa Primera',
    'Fontibon',
    'Funza',
    'Ipanema',
    'Madrid',
    'MonteVerde',
    'Rosal',
    'Soacha',
    'Suba',
    'Tocancipa',
    'Bosa',
    'Bogota']

  vigentelist: string[] = ['Si', 'No']
  convertToTitleCaseAndRemoveAccents(value: string): string {
    if (value === null || value === undefined) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'No hay oficina afiliada a tu cuenta, por favor contacta a tu administrador'
      });
      return '';
    } else {
      if (value === 'FACA_PRINCIPAL') {
        value = 'FACATATIVA PRINCIPAL'
      } if (value === 'FACA_CENTRO') {
        value = 'FACATATIVA CENTRO'
      }
      const valueWithoutAccents = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

      const valueWithSpaces = valueWithoutAccents.replace(/_/g, ' ');

      return valueWithSpaces.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
    }
  }

  getOptions(field: string): string[] {
    switch (field) {
      case 'Sexo':
        return this.sexos;
      case 'Tipo de documento':
        return this.tiposDocumento;
      case 'Tipo de documento doctor atendido':
        return this.tiposDocumentoDoctor;
      default:
        return [];
    }
  }

  validateForm(): boolean {
    let isValid = true;

    // Loop through each key in the fieldMap to validate each form control
    for (let key in this.fieldMap) {
      const controlName = this.fieldMap[key];
      const control = this.incapacidadForm.get(controlName);

      // Example validation rules (these can be customized as needed)
      if (control) {
        // Check if the control is required and empty
        if (controlName === 'Oficina' || controlName === 'nombre_de_quien_recibio') {
          if (!control.value || control.value.trim() === '') {
            control.setErrors({ required: true });
            isValid = false;
          }
        }

        // Check if a field has a minimum or maximum length
        if (controlName === 'numerodeceduladepersona') {
          if (control.value && control.value.length !== 10) {  // Example: cedula must be 10 digits
            control.setErrors({ length: true });
            isValid = false;
          }
        }

        // Additional custom validations can be added here based on your needs
      }
    }

    return isValid;
  }
  getFiles(field: string): File[] {
    return this.files[field] || [];
  }
  clearErrors() {
    this.validationErrors = [];
  }

  private determinarProrroga(): void {
    const fechaInicio = this.incapacidadForm.get('fecha_inicio_incapacidad')?.value;
    const codigo = this.incapacidadForm.get('codigo_diagnostico')?.value;
    const cedula = this.incapacidadForm.get('numerodeceduladepersona')?.value;
    let valor = 'NO';

    //si la cedula existe
    if (cedula && fechaInicio && codigo) {
      //convertimos fechaInicio a string de tipo dd-MM-yyyy
      const fecha = new Date(fechaInicio);
      const dia = String(fecha.getDate()).padStart(2, '0');
      const mes = String(fecha.getMonth() + 1).padStart(2, '0');
      const anio = fecha.getFullYear();
      const fechaInicioStr = `${dia}-${mes}-${anio}`;
      this.incapacidadService.verificarIncapacidadPrevia(cedula, fechaInicioStr, codigo).subscribe(
        (tieneIncapacidadPrevia: boolean) => {
          if (tieneIncapacidadPrevia) {
            valor = 'SI';
          } else {
            valor = 'NO';
          }
          this.incapacidadForm.get('prorroga')?.setValue(valor);
        },
        (error: any) => {
          console.error('Error al verificar incapacidad previa:', error);
          this.incapacidadForm.get('prorroga')?.setValue('NO');
        }
      );
    }
  }
}
