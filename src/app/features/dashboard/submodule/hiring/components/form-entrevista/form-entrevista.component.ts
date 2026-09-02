import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  effect,
  inject,
  input,
  NgZone,
  OnInit,
  output,
} from '@angular/core';
import {
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ValidatorFn,
  AbstractControl,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { DateAdapter } from '@angular/material/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, firstValueFrom, map, startWith, take, filter, of, catchError, shareReplay } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';

import colombia from '../../../../../../data/colombia.json';
import { SharedModule } from '@/app/shared/shared.module';
import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';
import { docParaEnviar } from '@/app/shared/utils/tipo-doc.util';
import { RegistroProcesoContratacion } from '../../service/registro-proceso-contratacion/registro-proceso-contratacion';
import { SeleccionEstadoService } from '../../service/seleccion/seleccion-estado.service';
import {
  GestionParametrizacionService,
  CatalogValue,
} from '../../../users/services/gestion-parametrizacion/gestion-parametrizacion.service';

@Component({
  selector: 'app-form-entrevista',
  standalone: true,
  imports: [MatIconModule, SharedModule],
  templateUrl: './form-entrevista.component.html',
  styleUrls: ['./form-entrevista.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormEntrevistaComponent implements OnInit {
  /** Último titular (tipo|número) rellenado desde el servidor (effect del constructor). */
  private cedulaRellenada: string | null = null;

  // ====== Inputs / Outputs / Servicios ======
  candidatoSeleccionado = input<any | null>(null);
  /**
   * Override "Modificar de todas formas". Sin esto, guardar la entrevista de un
   * candidato cuyo proceso ya es terminal (contratado, retirado, rechazado, no
   * pasó la prueba, NO_APLICA/EN_ESPERA) abre una entrevista y un proceso NUEVOS
   * — que es la regla correcta cuando de verdad se re-inicia el proceso, pero no
   * cuando el usuario destrabó los tabs justamente para CORREGIR el actual.
   * Con la bandera en true el backend edita la entrevista existente en sitio.
   */
  modificacionForzada = input<boolean>(false);
  /** Nº de consulta del buscador: re-consultar a la misma persona re-rellena. */
  consultaSeq = input<number>(0);
  modificadoPor = input<string>('');
  /** Se emite tras guardar la entrevista con éxito, para que el padre recargue
   *  el candidato (y aparezca el proceso nuevo sin re-buscar). */
  guardado = output<void>();

  private readonly fb = inject(FormBuilder);
  private readonly dateAdapter = inject<DateAdapter<Date>>(
    DateAdapter as any
  );
  private readonly route = inject(ActivatedRoute);
  private readonly util = inject(UtilityServiceService);
  private readonly candidateService = inject(RegistroProcesoContratacion);
  private readonly catalogos = inject(GestionParametrizacionService);
  private readonly seleccionEstado = inject(SeleccionEstadoService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly ngZone = inject(NgZone);

  // ====== Catálogos ======
  /**
   * Catálogo con la respuesta compartida entre TODOS los `| async`.
   *
   * Sin `shareReplay` cada suscripción del template dispara su propia petición,
   * porque un observable de HttpClient es frío. `parentescosOpciones$` se usa
   * en las 4 filas de familiares → salían 4 GET idénticos del mismo catálogo
   * (y 2 de estado civil, 2 de marketing) cada vez que se abría un candidato.
   *
   * `refCount: false` a propósito: el valor queda cacheado aunque se queden en
   * cero suscriptores, así cambiar de pestaña no vuelve a pedir la lista.
   */
  private safeCatalog(code: string, label: string): Observable<CatalogValue[]> {
    return this.catalogos.listDatosByTablaCodigo(code, { activo: true }).pipe(
      catchError((err) => {
        console.error(`[form-entrevista] Error cargando catálogo "${label}":`, err);
        Swal.fire({
          icon: 'warning',
          title: 'Error cargando opciones',
          text: `No se pudo cargar la lista "${label}". Recargue la página o contacte a soporte.`,
          confirmButtonColor: '#3085d6',
        });
        return of([] as CatalogValue[]);
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
  }

  tipoDocOpciones$: Observable<CatalogValue[]> = this.safeCatalog('TIPOS_IDENTIFICACION', 'Tipo de Documento');
  escolaridadOpciones$: Observable<CatalogValue[]> = this.safeCatalog('CATALOGO_NIVELES_ESCOLARIDAD', 'Escolaridad');
  estadoCivilOpciones$: Observable<CatalogValue[]> = this.safeCatalog('ESTADOS_CIVILES', 'Estado Civil');

  conQuienViveOpciones$: Observable<CatalogValue[]> = this.safeCatalog('CATALOGO_CON_QUIEN_VIVE', 'Con quién vive').pipe(
    map((opts) => {
      const seen = new Set<string>();
      return (opts ?? []).filter((o) => {
        const k = String(o['codigo'] ?? '').trim().toUpperCase();
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    })
  );

  dominioCorreoOpciones$: Observable<CatalogValue[]> = this.safeCatalog('DOMINIOS', 'Dominios de Correo');
  comoSeEnteroOpciones$: Observable<CatalogValue[]> = this.safeCatalog('CATALOGO_MARKETING', '¿Cómo se enteró?');
  parentescosOpciones$: Observable<CatalogValue[]> = this.safeCatalog('PARENTESCOS_FAMILIARES', 'Parentescos');

  // ====== Form / estado ======
  formVacante!: FormGroup;
  isSubmitting = false;
  lockedOffice?: string;
  firma = '';

  // Agrupadores lógicos (ex "steps") para validación seccional
  step1Ctrl = new FormGroup({});
  step2Ctrl = new FormGroup({});
  step3Ctrl = new FormGroup({});
  step4Ctrl = new FormGroup({});
  step5Ctrl = new FormGroup({});
  step6Ctrl = new FormGroup({});
  step7Ctrl = new FormGroup({});

  // Auxiliares
  readonly emailUserPattern = '^[^@\\s]+$';
  readonly otroExperienciaControl = new FormControl('', [
    Validators.maxLength(64),
  ]);

  // Autocomplete ciudades
  allCities: string[] = [];
  filteredCities$!: Observable<string[]>;
  filteredCitiesNacimiento$!: Observable<string[]>;

  // Listas fijas
  readonly SEED_EXP_COUNT = 0;

  readonly sexos = ['M', 'F'] as const;
  // Fuente de verdad: gestion_admin.Sede == NUMERO_POR_OFICINA del backend
  // (GET /gestion_contratacion/oficinas/). Toda oficina de esta lista TIENE
  // rango de numeracion de contratos; si se agrega una que no lo tenga, el
  // backend rechaza el guardado con 400.
  readonly oficinas = [
    'ADMINISTRATIVOS',
    'ANDES',
    'BOSA',
    'CARTAGENITA',
    'FACA_PRIMERA',
    'FACA_PRINCIPAL',
    'FONTIBÓN',
    'FORANEOS',
    'FUNZA',
    'MADRID',
    'MONTE_VERDE',
    'ROSAL',
    'SOACHA',
    'SOTAQUIRA',
    'SUBA',
    'TOCANCIPÁ',
    'USME',
    'VIRTUAL',
    'ZIPAQUIRÁ',
  ] as const;

  // Campos usados para validar cada bloque
  private readonly step1Fields = [
    'oficina',
    'tipo_doc',
    'numero_documento',
    'fecha_expedicion',
    'mpio_expedicion',
  ];
  private readonly step2Fields = [
    'primer_apellido',
    'primer_nombre',
    'fecha_nacimiento',
    'mpio_nacimiento',
    'sexo',
    'estado_civil',
  ];
  private readonly step3Fields = [
    'correo_electronico',
    'password',
    'direccion_de_residencia',
    'barrio',
    'celular',
    'whatsapp',
    'personas_con_quien_convive',
    'hace_cuanto_vive',
  ];

  constructor() {
    this.dateAdapter.setLocale('es-CO');

    // =======================
    // Definición del form
    // =======================
    this.formVacante = this.fb.group({
      // Identificación / documento
      // La oficina la preasigna el flujo (URL/candidato) pero es editable:
      // el valor que llega no siempre es el correcto y hay que poder
      // corregirlo desde la UI. Sigue acotada a la lista `oficinas`.
      oficina: ['', Validators.required],
      tipo_doc: ['', Validators.required],
      numero_documento: [
        '',
        [
          Validators.required,
          Validators.pattern(/^X?\d+$/i),
          Validators.minLength(6),
          Validators.maxLength(15),
        ],
      ],
      fecha_expedicion: ['', Validators.required],
      mpio_expedicion: ['', Validators.required],

      // Datos personales
      primer_apellido: [
        '',
        [
          Validators.required,
          Validators.minLength(2),
          Validators.maxLength(30),
        ],
      ],
      segundo_apellido: ['', [Validators.maxLength(30)]],
      primer_nombre: [
        '',
        [
          Validators.required,
          Validators.minLength(2),
          Validators.maxLength(30),
        ],
      ],
      segundo_nombre: ['', [Validators.maxLength(30)]],
      fecha_nacimiento: ['', Validators.required],
      edad: [{ value: '', disabled: true }],
      mpio_nacimiento: ['', Validators.required],
      sexo: ['', Validators.required],
      estado_civil: ['', Validators.required],

      // Contacto / domicilio
      correo_electronico: [
        '',
        [
          Validators.required,
          Validators.pattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
        ]
      ],
      password: [''],
      direccion_de_residencia: ['', Validators.required],
      barrio: [
        '',
        [
          Validators.required,
          Validators.minLength(3),
          Validators.maxLength(40),
        ],
      ],
      celular: ['', [Validators.required, Validators.pattern(/^3\d{9}$/)]],
      whatsapp: [
        '',
        [
          Validators.required,
          Validators.pattern(/^3\d{9}$/),
          Validators.maxLength(10),
        ],
      ],
      personas_con_quien_convive: [
        [],
        [Validators.required, this.minLengthArray(1)],
      ],
      hace_cuanto_vive: ['', Validators.required],

      // Información familiar
      tieneHijos: [null, Validators.required],
      cuidadorHijos: [''],
      numeroHijos: [0],
      hijos: this.fb.array([]),
      nombreReferenciaFamiliar1: [''],
      parentescoReferenciaFamiliar1: ['', [Validators.maxLength(70)]],
      nombreReferenciaFamiliar2: [''],
      parentescoReferenciaFamiliar2: ['', [Validators.maxLength(70)]],
      nombreReferenciaPersonal1: [''],
      parentescoReferenciaPersonal1: ['', [Validators.maxLength(70)]],
      nombreReferenciaPersonal2: [''],
      parentescoReferenciaPersonal2: ['', [Validators.maxLength(70)]],

      // Formación / experiencia
      nivel: [null, Validators.required],
      estudiaActualmente: [null, Validators.required],
      proyeccion1Ano: ['', Validators.required],
      experienciaFlores: ['', Validators.required],
      tipoExperienciaFlores: [''],
      otroExperiencia: this.otroExperienciaControl,

      // Historial laboral
      experiencias: this.fb.array([]),

      // Entrevista
      comoSeEntero: ['', [Validators.maxLength(120), Validators.required]],
      referenciado: [null, Validators.required], // 'SI' | 'NO'
      nombreReferenciado: ['', [Validators.maxLength(120)]],
      aplicaObservacion: ['', Validators.required], // 'APLICA' | 'NO_APLICA' | 'EN_ESPERA'
      motivoEspera: [''],
      motivoNoAplica: [''],

      // Aux
      brigadaDe: [''],

      // Evaluacion (Opcionales)
      relacionFamiliar: [''],
      desempenoLaboral: [''],
      felicitaciones: [''],
      situacionConflictiva: [''],
      actividadesDiferentes: [''],

      // Firma
      firmaEvaluador: [{ value: '', disabled: true }],
    });

    // =======================
    // Reacciones dinámicas
    // =======================

    // Edad calculada
    this.ctrl('fecha_nacimiento')
      .valueChanges.pipe(startWith(this.ctrl('fecha_nacimiento').value))
      .subscribe(() => this.setEdad());

    // Hijos
    this.ctrl('tieneHijos')
      .valueChanges.pipe(startWith(this.ctrl('tieneHijos').value))
      .subscribe((tiene: boolean) => this.setupHijosValidators(!!tiene));

    this.ctrl('numeroHijos')
      .valueChanges.pipe(startWith(this.ctrl('numeroHijos').value))
      .subscribe((n: number) => this.setHijosCount(Number(n) || 0));

    // Experiencia en flores
    this.ctrl('experienciaFlores')
      .valueChanges.pipe(startWith(this.ctrl('experienciaFlores').value))
      .subscribe((val) => {
        this.applyExperienciaFloresRules(val);
        this.refreshSteps();
      });

    // Tipo de experiencia = OTROS -> obliga descripción
    this.ctrl('tipoExperienciaFlores')
      .valueChanges.pipe(startWith(this.ctrl('tipoExperienciaFlores').value))
      .subscribe((value) => {
        this.applyTipoExperienciaFloresRules(value);
        this.refreshSteps();
      });

    // Referenciado -> nombreReferenciado requerido si "SI"
    this.ctrl('referenciado')
      .valueChanges.pipe(startWith(this.ctrl('referenciado').value))
      .subscribe((v) => {
        this.applyReferenciadoRules(v);
        this.refreshSteps();
      });

    // aplicaObservacion -> obliga el motivo según el caso
    this.ctrl('aplicaObservacion')
      .valueChanges.pipe(startWith(this.ctrl('aplicaObservacion').value))
      .subscribe((v) => {
        this.applyAplicaObservacionRules(v);
        this.refreshSteps();
      });

    // Cuando cambie el candidato seleccionado, rellenamos el form
    effect(() => {
      const cand = this.candidatoSeleccionado();
      // Solo se rellena al CAMBIAR de persona. El padre recarga el candidato
      // (referencia nueva, misma cédula) tras guardar cualquier pestaña; re-
      // ejecutar acá pisaba media entrevista escrita sin guardar y recortaba
      // las filas de hijos al conteo del servidor. La llave incluye el tipo:
      // dos titulares distintos pueden compartir número (CC vs C.C/CE).
      const ced = cand?.numero_documento ? String(cand.numero_documento) : null;
      // `consultaSeq` entra en la llave: una consulta NUEVA del buscador (que
      // lo incrementa) re-rellena aunque sea la misma persona; las recargas
      // internas tras guardar (mismo seq) no pisan lo editado.
      const clave = ced
        ? `${String(cand?.tipo_doc || 'CC').trim().toUpperCase()}|${ced}#${this.consultaSeq()}`
        : null;
      if (clave !== null && clave === this.cedulaRellenada) return;
      this.cedulaRellenada = clave;
      this.rellenarForm(cand);
    });

    // Populate signature
    const u: any = this.util.getUser();
    if (u) {
      this.firma = `${u?.datos_basicos?.nombres ?? ''} ${u?.datos_basicos?.apellidos ?? ''} - ${u?.rol?.nombre ?? ''}`.trim();
    }
  }

  private normalizeText(v: any): string {
    return String(v ?? '')
      .normalize('NFD')                 // separa tildes (incluye el caso de "MÁS")
      .replace(/[\u0300-\u036f]/g, '')  // quita tildes
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  }

  private mapHaceCuantoVive(raw: any): string {
    if (!raw) return '';

    const s = this.normalizeText(raw);

    // Si ya viene en formato del select, respétalo
    // Normalizamos quitando guiones bajos para comparar texto flexible
    const textV = s.replace(/_/g, ' ');

    // 1. Mapeo exacto de valores (o equivalentes con espacios)
    if (s === 'LIFETIME' || textV.includes('VIDA')) return 'LIFETIME';
    if (textV.includes('MAS DE 2 MESES')) return 'MAS_DE_2_MESES';
    if (textV.includes('MAS DE 6 MESES')) return 'MAS_DE_6_MESES';
    if (textV.includes('MENOS DE UN MES')) return 'MENOS_DE_UN_MES';
    // "UN MES" debe chequearse después de "MENOS DE UN MES" para evitar falsos positivos
    if (textV.includes('UN MES')) return 'UN_MES';

    // 2. Mapeos de fallback (por si vienen datos viejos tipo "8 MESES", "1 AÑO")
    // Si contiene "AÑO" o "ANO" -> se asume más de 6 meses
    if (textV.includes('ANO') || textV.includes('AÑO')) return 'MAS_DE_6_MESES';

    // Si detectamos meses numéricos y no cayó en los anteriores
    const m = s.match(/(\d+)/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > 6) return 'MAS_DE_6_MESES';
      if (n > 2) return 'MAS_DE_2_MESES';
      if (n === 1) return 'UN_MES';
      // n < 1 no debería pasar si dice "meses", pero por si acaso
      return 'MENOS_DE_UN_MES';
    }

    return '';
  }


  // =======================
  // Navegación interna
  // =======================
  /**
   * Smooth-scroll al ancla `id` (sección) dentro del contenedor scrollable más
   * cercano. Funciona aunque el form esté dentro de un mat-tab que tiene su
   * propio overflow.
   */
  scrollToSection(id: string): void {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // =======================
  // Ciclo de vida
  // =======================
  ngOnInit(): void {

    // Vinculamos controles de la sección de contacto/domicilio para refrescar validación
    this.linkStepToControls(this.step3Ctrl, this.step3Fields);

    this.hydrateOfficeFromQuery();
    this.loadCities();
    this.setupAutocomplete();
    this.setupAutocompleteNacimiento();
    this.seedExperiencias();

    // Validadores por bloque
    this.step1Ctrl.setValidators(this.makeValidator(this.step1Fields));

    this.step2Ctrl.setValidators(this.makeValidator(this.step2Fields));

    this.step3Ctrl.setValidators(this.makeValidator(this.step3Fields));

    this.step4Ctrl.setValidators(
      this.makeValidator(['tieneHijos'], () => {
        if (this.ctrl('tieneHijos').value !== true) return true;
        return (
          this.areValid(['cuidadorHijos', 'numeroHijos']) && this.hijosFA.valid
        );
      })
    );

    this.step5Ctrl.setValidators(
      this.makeValidator(
        ['nivel', 'estudiaActualmente', 'proyeccion1Ano', 'experienciaFlores'],
        () => {
          const exp = this.ctrl('experienciaFlores').value === 'Sí';
          if (!exp) return true;
          if (!this.areValid(['tipoExperienciaFlores'])) return false;
          return this.ctrl('tipoExperienciaFlores').value === 'OTROS'
            ? this.otroExperienciaControl.valid
            : true;
        }
      )
    );

    this.step6Ctrl.setValidators(() =>
      this.experienciasFA.valid ? null : { stepInvalid: true }
    );

    // Bloque de entrevista
    this.step7Ctrl.setValidators(() => {
      const val = (n: string) => (this.ctrl(n).value ?? '').toString().trim();

      // ¿Cómo se enteró?
      const comoSeEnteroOk = !!val('comoSeEntero');

      // Referenciado
      const referenciado = this.ctrl('referenciado').value;
      const nombreReferenciadoOk =
        referenciado === 'SI' ? !!val('nombreReferenciado') : true;

      // Observación evaluador
      const aplica = val('aplicaObservacion');
      let aplicaOk = false;

      if (aplica === 'EN_ESPERA') {
        const m = val('motivoEspera');
        aplicaOk = !!m && m.length <= 300;
      } else if (aplica === 'NO_APLICA') {
        const m = val('motivoNoAplica');
        aplicaOk = !!m && m.length <= 300;
      } else if (aplica === 'APLICA') {
        aplicaOk = true;
      } else {
        aplicaOk = false;
      }

      const ok = comoSeEnteroOk && nombreReferenciadoOk && aplicaOk;
      return ok ? null : { stepInvalid: true };
    });

    // Cuando cambie cualquier cosa en el formulario, refrescamos validación de las secciones
    this.formVacante.statusChanges.subscribe(() => this.refreshSteps());
    this.refreshSteps();

  }

  // =======================
  // Autocomplete ciudades
  // =======================
  private loadCities(): void {
    const list = colombia as Array<{
      id: number;
      departamento: string;
      ciudades: string[];
    }>;
    const set = new Set<string>();
    list.forEach((d) => d.ciudades?.forEach((c) => set.add(c)));
    this.allCities = Array.from(set).sort((a, b) =>
      a.localeCompare(b, 'es', { sensitivity: 'base' })
    );
  }

  get municipioCtrl() {
    return this.ctrl('mpio_expedicion');
  }
  get lugarNacimientoCtrl() {
    return this.ctrl('mpio_nacimiento');
  }

  private setupAutocomplete(): void {
    this.filteredCities$ = this.municipioCtrl.valueChanges.pipe(
      startWith(this.municipioCtrl.value || ''),
      map((v) => this.filterCities(String(v ?? '')))
    );
  }

  private setupAutocompleteNacimiento(): void {
    this.filteredCitiesNacimiento$ =
      this.lugarNacimientoCtrl.valueChanges.pipe(
        startWith(this.lugarNacimientoCtrl.value || ''),
        map((v) => this.filterCities(String(v ?? '')))
      );
  }

  private filterCities(value: string): string[] {
    const norm = (s: string) =>
      s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    const q = norm(value);
    return q
      ? this.allCities.filter((c) => norm(c).includes(q)).slice(0, 50)
      : this.allCities.slice(0, 50);
  }

  onMunicipioSelected(e: MatAutocompleteSelectedEvent) {
    this.municipioCtrl.setValue(e.option.value);
  }

  onLugarNacimientoSelected(e: MatAutocompleteSelectedEvent) {
    this.lugarNacimientoCtrl.setValue(e.option.value);
  }

  // =======================
  // Hijos
  // =======================
  get hijosFA(): FormArray {
    return this.formVacante.get('hijos') as FormArray;
  }

  private buildHijoGroup(): FormGroup {
    return this.fb.group({
      // Requerido: el backend lo exige (Hijo.numero_de_documento sin blank) y
      // el servicio filtra las filas sin documento antes de enviar — sin este
      // required, un hijo con solo fecha pasaba la validación, se descartaba
      // en silencio y el Swal decía "guardado".
      numero_de_documento: [
        '',
        [
          Validators.required,
          Validators.pattern(/^\d+$/),
          Validators.minLength(6),
          Validators.maxLength(15),
        ],
      ],
      fecha_nac: [null, [Validators.required]],
    });
  }

  /** Tope duro de filas de hijos: por encima de esto es un error de digitación. */
  private static readonly MAX_HIJOS = 15;

  private setHijosCount(n: number): void {
    // Sin el tope, teclear "99999" en el número de hijos creaba 99.999
    // FormGroups síncronos y congelaba la ventana.
    const objetivo = Math.min(Math.max(0, Math.floor(Number(n) || 0)), FormEntrevistaComponent.MAX_HIJOS);
    const fa = this.hijosFA;
    while (fa.length < objetivo) fa.push(this.buildHijoGroup());
    while (fa.length > objetivo) fa.removeAt(fa.length - 1);
    this.refreshSteps();
  }

  private setupHijosValidators(tiene: boolean): void {
    const cuidador = this.ctrl('cuidadorHijos');
    const num = this.ctrl('numeroHijos');

    if (tiene) {
      cuidador.addValidators([Validators.required, Validators.maxLength(120)]);
      num.addValidators([Validators.required, Validators.min(1)]);
    } else {
      cuidador.clearValidators();
      cuidador.setValue('', { emitEvent: false });

      num.clearValidators();
      num.setValue(0, { emitEvent: false });

      this.setHijosCount(0);
    }

    cuidador.updateValueAndValidity({ emitEvent: false });
    num.updateValueAndValidity({ emitEvent: false });
  }

  // =======================
  // Experiencias laborales
  // =======================
  get experienciasFA(): FormArray {
    return this.formVacante.get('experiencias') as FormArray;
  }

  addExperiencia(): void {
    this.experienciasFA.push(this.buildExperienciaGroup(true));
    this.refreshSteps();
  }

  removeExperiencia(i: number): void {
    if (i >= this.SEED_EXP_COUNT) this.experienciasFA.removeAt(i);
    this.refreshSteps();
  }

  private buildExperienciaGroup(required = true): FormGroup {
    const req = required
      ? [Validators.required, Validators.maxLength(255)]
      : [Validators.maxLength(255)];

    return this.fb.group({
      empresa: ['', req],
      tiempo_trabajado: ['', [Validators.maxLength(50)]],
      labores_realizadas: ['', [Validators.maxLength(255)]],
      labores_principales: ['', [Validators.maxLength(255)]],
    });
  }

  private seedExperiencias(n = this.SEED_EXP_COUNT): void {
    while (this.experienciasFA.length < n) {
      this.experienciasFA.push(this.buildExperienciaGroup(false));
    }
  }

  // =======================
  // Helpers de validación
  // =======================
  private ctrl(name: string) {
    return this.formVacante.get(name)!;
  }

  private areValid(keys: string[]): boolean {
    return keys.every((k) => {
      const c = this.ctrl(k);
      return !!c && (c.disabled || c.valid);
    });
  }

  private makeValidator(
    keys: string[],
    extra?: () => boolean
  ): ValidatorFn {
    return () =>
      this.areValid(keys) && (extra ? extra() : true)
        ? null
        : { stepInvalid: true };
  }

  private minLengthArray(min: number): ValidatorFn {
    return (ctrl: AbstractControl): ValidationErrors | null => {
      const v = ctrl.value as unknown;
      return Array.isArray(v) && v.length >= min
        ? null
        : { minLengthArray: { required: min } };
    };
  }

  private linkStepToControls(step: FormGroup, keys: string[]) {
    keys.forEach((k) =>
      this.ctrl(k).valueChanges.subscribe(() => {
        step.updateValueAndValidity({ onlySelf: true, emitEvent: false });
      })
    );
  }

  // Forzar validación de una sección tras patchValue
  private forceValidateStep(stepCtrl: FormGroup, keys: string[]) {
    keys.forEach((k) =>
      this.ctrl(k).updateValueAndValidity({ emitEvent: false })
    );
    stepCtrl.updateValueAndValidity({ onlySelf: true, emitEvent: false });
  }

  // Revalida todos los bloques lógicos
  refreshSteps(): void {
    this.step1Ctrl.updateValueAndValidity({
      onlySelf: true,
      emitEvent: false,
    });
    this.step2Ctrl.updateValueAndValidity({
      onlySelf: true,
      emitEvent: false,
    });
    this.step3Ctrl.updateValueAndValidity({
      onlySelf: true,
      emitEvent: false,
    });
    this.step4Ctrl.updateValueAndValidity({
      onlySelf: true,
      emitEvent: false,
    });
    this.step5Ctrl.updateValueAndValidity({
      onlySelf: true,
      emitEvent: false,
    });
    this.step6Ctrl.updateValueAndValidity({
      onlySelf: true,
      emitEvent: false,
    });
    this.step7Ctrl.updateValueAndValidity({
      onlySelf: true,
      emitEvent: false,
    });
  }

  private setEdad(): void {
    const v = this.ctrl('fecha_nacimiento').value;
    const d = v instanceof Date ? v : v ? new Date(v) : null;
    let edad: number | '' = '';

    if (d && !isNaN(d.getTime())) {
      const t = new Date();
      let a = t.getFullYear() - d.getFullYear();
      const m = t.getMonth() - d.getMonth();
      if (m < 0 || (m === 0 && t.getDate() < d.getDate())) a--;
      edad = Math.max(0, a);
    }

    this.ctrl('edad').setValue(edad, { emitEvent: false });
  }

  // =======================
  // Helpers de reglas dinámicas
  // =======================
  private applyExperienciaFloresRules(val: any): void {
    const tipoCtrl = this.ctrl('tipoExperienciaFlores');

    if (val !== 'Sí') {
      tipoCtrl.setValue('', { emitEvent: false });
      tipoCtrl.clearValidators();
      this.otroExperienciaControl.reset('', { emitEvent: false });
      this.otroExperienciaControl.clearValidators();
    } else {
      tipoCtrl.setValidators([Validators.required]);
    }

    tipoCtrl.updateValueAndValidity({ emitEvent: false });
    this.otroExperienciaControl.updateValueAndValidity({ emitEvent: false });
  }

  private applyTipoExperienciaFloresRules(value: any): void {
    if (value === 'OTROS') {
      this.otroExperienciaControl.setValidators([
        Validators.required,
        Validators.maxLength(64),
      ]);
    } else {
      this.otroExperienciaControl.reset('', { emitEvent: false });
      this.otroExperienciaControl.clearValidators();
    }

    this.otroExperienciaControl.updateValueAndValidity({
      emitEvent: false,
    });
  }

  private applyReferenciadoRules(v: any): void {
    const nombreRef = this.ctrl('nombreReferenciado');

    if (v === 'SI') {
      nombreRef.setValidators([
        Validators.required,
        Validators.maxLength(120),
      ]);
    } else {
      nombreRef.clearValidators();
      nombreRef.setValue('', { emitEvent: false });
    }

    nombreRef.updateValueAndValidity({ emitEvent: false });
    this.step7Ctrl.updateValueAndValidity({ emitEvent: false });
  }

  private applyAplicaObservacionRules(v: any): void {
    // Punto único por el que pasan tanto la carga del candidato (rellenarForm)
    // como los cambios en vivo del operador. Publicamos el estado para que los
    // componentes hermanos (remisión, exámenes, contratación) se bloqueen si el
    // candidato queda EN ESPERA de vacante.
    this.seleccionEstado.setAplicaObservacion(v);

    const motEsp = this.ctrl('motivoEspera');
    const motNoAp = this.ctrl('motivoNoAplica');

    if (v === 'EN_ESPERA') {
      motEsp.setValidators([
        Validators.required,
        Validators.maxLength(300),
      ]);
      motNoAp.clearValidators();
      motNoAp.setValue('', { emitEvent: false });
    } else if (v === 'NO_APLICA') {
      motNoAp.setValidators([
        Validators.required,
        Validators.maxLength(300),
      ]);
      motEsp.clearValidators();
      motEsp.setValue('', { emitEvent: false });
    } else if (v === 'APLICA') {
      motEsp.clearValidators();
      motEsp.setValue('', { emitEvent: false });
      motNoAp.clearValidators();
      motNoAp.setValue('', { emitEvent: false });
    } else {
      motEsp.clearValidators();
      motEsp.setValue('', { emitEvent: false });
      motNoAp.clearValidators();
      motNoAp.setValue('', { emitEvent: false });
    }

    motEsp.updateValueAndValidity({ emitEvent: false });
    motNoAp.updateValueAndValidity({ emitEvent: false });
    this.step7Ctrl.updateValueAndValidity({ emitEvent: false });
  }

  // =======================
  // Hidratar desde la URL (oficina)
  // =======================
  private normalizeOffice(s: string): string {
    return s
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[\s-]+/g, '_')
      .toUpperCase();
  }

  private hydrateOfficeFromQuery() {
    this.route.queryParamMap.subscribe((params) => {
      const raw = (params.get('oficina') || params.get('o') || '').trim();

      // La oficina siempre queda editable: el query param solo la preasigna.
      // Si no hay query param, simplemente quedamos sin valor preasignado.
      if (!raw) {
        this.lockedOffice = undefined;
        return this.refreshSteps();
      }

      const norm = this.normalizeOffice(raw);
      const mapOficinas = new Map(
        this.oficinas.map((o) => [this.normalizeOffice(o), o])
      );
      const match = mapOficinas.get(norm);

      if (match) {
        this.ctrl('oficina').setValue(match, { emitEvent: false });
        this.lockedOffice = match;
      }

      // 'BRIGADA' salió de la lista: no es una sede, no tiene rango de
      // numeración de contratos y el flujo reescribía la oficina a
      // "BRIGADA DE <texto libre>", que es por donde entraban valores
      // arbitrarios. `brigadaDe` se sigue prellenando desde la URL para no
      // perder el dato si alguien todavía manda el query param.
      const brig = params.get('brigada');
      if (brig) {
        this.ctrl('brigadaDe').setValue(brig, { emitEvent: false });
      }

      this.refreshSteps();
    });
  }

  private normalizeCode(v: any): string {
    return String(v ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toUpperCase();
  }

  private mapEstadoCivil(raw: any, opts: Array<{ codigo?: string; descripcion?: string }> = []): string {
    const s = this.normalizeText(raw);
    if (!s) return '';

    // Si ya viene un código válido
    const byCode = opts.find(o => this.normalizeText(o?.codigo) === s);
    if (byCode?.codigo) return String(byCode.codigo);

    // Si viene "SO (Soltero)" u "SO - Soltero"
    const codeMatch = s.match(/\b(VI|UL|SO|SE|CA)\b/);
    if (codeMatch) {
      const code = codeMatch[1];
      if (opts.some(o => this.normalizeText(o?.codigo) === code)) return code;
    }

    // Si viene solo la palabra (SOLTERO, CASADO, etc.)
    const dict: Record<string, string> = {
      'SOLTERO': 'SO',
      'SOLTERA': 'SO',
      'CASADO': 'CA',
      'CASADA': 'CA',
      'VIUDO': 'VI',
      'VIUDA': 'VI',
      'SEPARADO': 'SE',
      'SEPARADA': 'SE',
      'UNION LIBRE': 'UL',
      'UNIONLIBRE': 'UL',
      'UL': 'UL',
    };

    const mapped = dict[s];
    if (mapped && opts.some(o => this.normalizeText(o?.codigo) === mapped)) return mapped;

    // Último intento: comparar contra descripción
    const byDesc = opts.find(o => this.normalizeText(o?.descripcion).includes(s));
    if (byDesc?.codigo) return String(byDesc.codigo);

    return '';
  }


  // =======================
  // Rellenar el form desde el candidato seleccionado
  // =======================
  private rellenarForm(cand: any): void {
    if (!cand) return;

    console.log('Rellenando formulario con candidato:', cand);
    const toDate = (v: any): Date | null => {
      if (!v) return null;

      // Si llega como "YYYY-MM-DD" (sin hora), parsea en zona local para que NO reste el día
      if (typeof v === 'string') {
        const s = v.trim();

        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        if (m) {
          const y = Number(m[1]);
          const mo = Number(m[2]) - 1; // 0-based
          const d = Number(m[3]);

          const local = new Date(y, mo, d); // local midnight
          return isNaN(local.getTime()) ? null : local;
        }

        // Si trae hora/zona (ej. 2026-01-17T05:00:00Z), usa el parse normal
        const parsed = new Date(s);
        return isNaN(parsed.getTime()) ? null : parsed;
      }

      const d = v instanceof Date ? v : new Date(v);
      return isNaN(d.getTime()) ? null : d;
    };


    const onlyDigits = (s: any) =>
      String(s ?? '')
        .replace(/\D+/g, '')
        .trim();

    // Normaliza texto (quita tildes raras, espacios, etc.)
    const normalizeText = (v: any): string =>
      String(v ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();

    // Mapea estado civil recibido (SOLTERO / "SO (Soltero)" / "SO") -> código (SO, CA, UL, VI, SE)
    const mapEstadoCivil = (
      raw: any,
      opts: Array<{ codigo?: string; descripcion?: string }> = []
    ): string => {
      const s = normalizeText(raw);
      if (!s) return '';

      // 1) Si ya viene el código exacto
      const byCode = opts.find((o) => normalizeText(o?.codigo) === s);
      if (byCode?.codigo) return String(byCode.codigo);

      // 2) Si viene mezclado tipo "SO (Soltero)" / "SO - Soltero"
      const codeMatch = s.match(/\b(VI|UL|SO|SE|CA)\b/);
      if (codeMatch) {
        const code = codeMatch[1];
        if (opts.some((o) => normalizeText(o?.codigo) === code)) return code;
      }

      // 3) Si viene la palabra
      const dict: Record<string, string> = {
        SOLTERO: 'SO',
        SOLTERA: 'SO',
        CASADO: 'CA',
        CASADA: 'CA',
        VIUDO: 'VI',
        VIUDA: 'VI',
        SEPARADO: 'SE',
        SEPARADA: 'SE',
        'UNION LIBRE': 'UL',
        UNIONLIBRE: 'UL',
      };

      const mapped = dict[s];
      if (mapped && opts.some((o) => normalizeText(o?.codigo) === mapped)) return mapped;

      // 4) Último intento: buscar por descripción
      const byDesc = opts.find((o) => normalizeText(o?.descripcion).includes(s));
      if (byDesc?.codigo) return String(byDesc.codigo);

      return '';
    };

    const info_cc = cand?.info_cc ?? {};
    const residencia = cand?.residencia ?? {};
    const contacto = cand?.contacto ?? {};
    const entrevistas = Array.isArray(cand?.entrevistas) ? cand.entrevistas : [];
    const oficina = entrevistas[0]?.oficina ?? '';
    const evalAux = cand?.evaluacion ?? {};

    const fechaNac = toDate(cand?.fecha_nacimiento);
    const fechaExp = toDate(info_cc?.fecha_expedicion);
    const haceCuantoVive = this.mapHaceCuantoVive(residencia?.hace_cuanto_vive);

    const estadoCivilRaw = cand?.estado_civil;
    const estadoCivilNorm = normalizeText(estadoCivilRaw);

    // Si ya viene código, lo ponemos de una; si viene "SOLTERO", lo dejamos vacío y lo mapeamos con el catálogo
    const estadoCivilQuick =
      ['VI', 'UL', 'SO', 'SE', 'CA'].includes(estadoCivilNorm) ? estadoCivilNorm : '';

    // El select de "tipo de experiencia en flores" solo acepta CULTIVO/POSCOSECHA/AMBAS/OTROS.
    // area_experiencia puede venir como multi-valor general ("A, B") desde la web: si no
    // matchea una opción válida, dejamos '' para que el evaluador lo elija (no metemos basura).
    const VALID_TIPO_FLORES = ['CULTIVO', 'POSCOSECHA', 'AMBAS', 'OTROS'];
    const areaExpNorm = normalizeText(cand?.experiencia_resumen?.area_experiencia);
    const tipoExperienciaFloresVal =
      VALID_TIPO_FLORES.find((t) => areaExpNorm.includes(t)) || '';

    // 1) patchValue sin emitir eventos
    this.formVacante.patchValue(
      {
        // Si el servidor no trae oficina se CONSERVA la actual: el query param
        // `?oficina=` la preasigna en ngOnInit y este patch (que corre después)
        // la borraba para todos los candidatos nuevos.
        oficina: oficina || this.formVacante.get('oficina')?.value || '',
        tipo_doc: cand?.tipo_doc || '',
        numero_documento: cand?.numero_documento || '',
        fecha_expedicion: fechaExp,
        mpio_expedicion: info_cc?.mpio_expedicion || '',

        primer_apellido: cand?.primer_apellido || '',
        segundo_apellido: cand?.segundo_apellido || '',
        primer_nombre: cand?.primer_nombre || '',
        segundo_nombre: cand?.segundo_nombre || '',
        fecha_nacimiento: fechaNac,
        mpio_nacimiento: info_cc?.mpio_nacimiento || '',
        sexo: cand?.sexo || '',
        estado_civil: estadoCivilQuick || '',
        correo_electronico: contacto?.email || contacto?.correo_electronico || '',
        direccion_de_residencia: residencia?.direccion || residencia?.direccion_de_residencia || '',
        barrio: residencia?.barrio || '',
        celular: contacto?.celular || '',
        whatsapp: contacto?.whatsapp || '',
        hace_cuanto_vive: haceCuantoVive || '',

        nivel: cand?.formaciones?.[0]?.nivel || '',
        proyeccion1Ano: entrevistas?.[0]?.como_se_proyecta || evalAux?.motivacion || '',
        estudiaActualmente: !!cand?.vivienda?.estudia_actualmente,
        experienciaFlores: cand?.experiencia_resumen?.tiene_experiencia ? 'Sí' : 'No',
        tipoExperienciaFlores: tipoExperienciaFloresVal,

        comoSeEntero: entrevistas?.[0]?.como_se_entero || '',
        // Backend guarda 'SI' | 'NO' (CharField). El bug previo trataba el valor
        // como booleano, así que cualquier string truthy ('NO' incluido) caía a 'SI'.
        // Normalizamos: 'SI'/'SÍ' -> 'SI', 'NO' -> 'NO', resto -> null (sin selección).
        referenciado: ((): 'SI' | 'NO' | null => {
          const v = String(entrevistas?.[0]?.referenciado ?? '').trim().toUpperCase();
          if (v === 'SI' || v === 'SÍ') return 'SI';
          if (v === 'NO') return 'NO';
          return null;
        })(),
        nombreReferenciado: entrevistas?.[0]?.nombre_referenciado || '',
        aplicaObservacion: entrevistas?.[0]?.proceso?.aplica_o_no_aplica || '',
        motivoEspera: entrevistas?.[0]?.proceso?.motivo_espera || '',
        motivoNoAplica: entrevistas?.[0]?.proceso?.motivo_no_aplica || '',

        // Opcionales evaluacion
        relacionFamiliar: evalAux?.relacion_familiar || '',
        desempenoLaboral: evalAux?.rendimiento_laboral || evalAux?.rendimiento || '',
        felicitaciones: evalAux?.porque_lo_felicitarian || '',
        situacionConflictiva: evalAux?.malentendido || '',
        actividadesDiferentes: evalAux?.actividades_diarias || '',
      },
      { emitEvent: false }
    );

    // 1.1) Asegurar estado civil cuando cargue el catálogo (SOLTERO -> SO, etc.)
    this.estadoCivilOpciones$
      .pipe(
        filter((opts): opts is any[] => Array.isArray(opts) && opts.length > 0),
        take(1)
      )
      .subscribe((opts) => {
        const code = mapEstadoCivil(estadoCivilRaw, opts);
        this.formVacante.get('estado_civil')?.setValue(code || '', { emitEvent: false });

        // Revalida por si tienes validación forzada por steps
        this.formVacante.get('estado_civil')?.updateValueAndValidity({ emitEvent: false });
        this.formVacante.updateValueAndValidity({ emitEvent: false });

        if (typeof this.refreshSteps === 'function') {
          this.refreshSteps();
        }
      });

    // 2) Validar secciones inmediatamente después del patch
    this.forceValidateStep(this.step1Ctrl, this.step1Fields);
    this.forceValidateStep(this.step2Ctrl, this.step2Fields);

    // 3) Campos derivados (recalcula edad)
    this.ctrl('fecha_nacimiento').setValue(fechaNac, { emitEvent: true });

    // 4) “¿Con quién vive?”
    const rawConvive = String(cand?.vivienda?.personas_con_quien_convive ?? '');
    const tokens = rawConvive
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    this.conQuienViveOpciones$.pipe(take(1)).subscribe((opts) => {
      const up = (x: any) => String(x ?? '').trim().toUpperCase();
      const selectedCodes = tokens
        .map((tok) => {
          const TK = up(tok);
          const found = opts.find((o) => up(o['codigo']) === TK || up(o['descripcion']) === TK);
          return found ? String(found['codigo']) : null;
        })
        .filter((x): x is string => !!x);

      this.ctrl('personas_con_quien_convive').setValue(selectedCodes, { emitEvent: false });
      this.forceValidateStep(this.step3Ctrl, this.step3Fields);
      this.refreshSteps();
    });

    // 5) Información familiar (hijos)
    const hijosArr = Array.isArray(cand?.hijos) ? cand.hijos : [];
    
    // Referencias vienen en formato array por el backend
    const refs = Array.isArray(cand?.referencias) ? cand.referencias : [];
    /**
     * Conviven dos convenciones de `tipo`: los registros migrados del sistema
     * viejo guardan dos filas planas ('PERSONAL', 'FAMILIAR') y los creados por
     * esta app usan slot numerado ('PERSONAL1'/'PERSONAL2'). Buscando solo el
     * slot numerado se perdían los migrados, que son la enorme mayoría, y los
     * campos salían vacíos aunque el candidato sí tuviera referencias.
     * Se ordena por id para que la 1ª y la 2ª sean estables (el orden por
     * defecto del modelo es alfabético por nombre).
     */
    const slotRef = (base: 'PERSONAL' | 'FAMILIAR', n: 1 | 2) => {
      const tipoDe = (r: any) => String(r?.tipo ?? '').trim().toUpperCase();
      const exacto = refs.find((r: any) => tipoDe(r) === `${base}${n}`);
      if (exacto) return exacto;
      const planas = refs
        .filter((r: any) => tipoDe(r) === base)
        .sort((a: any, b: any) => (a?.id ?? 0) - (b?.id ?? 0));
      return planas[n - 1] ?? null;
    };
    const fam1 = slotRef('FAMILIAR', 1);
    const fam2 = slotRef('FAMILIAR', 2);
    const per1 = slotRef('PERSONAL', 1);
    const per2 = slotRef('PERSONAL', 2);

    this.formVacante.patchValue(
      {
        tieneHijos: hijosArr.length > 0,
        cuidadorHijos: cand?.vivienda?.responsable_hijos || '',
        numeroHijos: hijosArr.length,
        nombreReferenciaFamiliar1: fam1?.nombre || '',
        parentescoReferenciaFamiliar1: fam1?.parentesco || '',
        nombreReferenciaFamiliar2: fam2?.nombre || '',
        parentescoReferenciaFamiliar2: fam2?.parentesco || '',
        nombreReferenciaPersonal1: per1?.nombre || '',
        parentescoReferenciaPersonal1: per1?.parentesco || '',
        nombreReferenciaPersonal2: per2?.nombre || '',
        parentescoReferenciaPersonal2: per2?.parentesco || '',
      },
      { emitEvent: false }
    );

    this.setHijosCount(hijosArr.length);

    hijosArr.forEach((h: any, i: number) => {
      const fg = this.hijosFA.at(i) as FormGroup;
      fg?.patchValue(
        {
          numero_de_documento: onlyDigits(h?.numero_de_documento),
          fecha_nac: toDate(h?.fecha_nac),
        },
        { emitEvent: false }
      );
    });

    // 6) Historial laboral
    const exps = Array.isArray(cand?.experiencias) ? cand.experiencias : [];
    const totalCards = Math.max(exps.length, this.SEED_EXP_COUNT);

    while (this.experienciasFA.length < totalCards) {
      this.experienciasFA.push(this.buildExperienciaGroup(false));
    }
    while (this.experienciasFA.length > totalCards) {
      this.experienciasFA.removeAt(this.experienciasFA.length - 1);
    }

    exps.forEach((e: any, i: number) => {
      (this.experienciasFA.at(i) as FormGroup)?.patchValue(
        {
          empresa: (e?.empresa ?? '').toString(),
          tiempo_trabajado: (e?.tiempo_trabajado ?? '').toString(),
          labores_realizadas: (e?.labores_realizadas ?? '').toString(),
          labores_principales: (e?.labores_principales ?? '').toString(),
        },
        { emitEvent: false }
      );
    });

    for (let i = exps.length; i < totalCards; i++) {
      (this.experienciasFA.at(i) as FormGroup)?.patchValue(
        {
          empresa: '',
          tiempo_trabajado: '',
          labores_realizadas: '',
          labores_principales: '',
        },
        { emitEvent: false }
      );
    }

    // 7) Reaplicar reglas dinámicas para que los validadores condicionales coincidan con los valores cargados
    this.setupHijosValidators(this.ctrl('tieneHijos').value === true);
    this.applyExperienciaFloresRules(this.ctrl('experienciaFlores').value);
    this.applyTipoExperienciaFloresRules(this.ctrl('tipoExperienciaFlores').value);
    this.applyReferenciadoRules(this.ctrl('referenciado').value);
    this.applyAplicaObservacionRules(this.ctrl('aplicaObservacion').value);

    // 8) Forzar validación final de todas las secciones
    this.forceValidateStep(this.step3Ctrl, this.step3Fields);
    this.step4Ctrl.updateValueAndValidity({ emitEvent: false });
    this.step5Ctrl.updateValueAndValidity({ emitEvent: false });
    this.step6Ctrl.updateValueAndValidity({ emitEvent: false });
    this.step7Ctrl.updateValueAndValidity({ emitEvent: false });

    // 9) Recalcular el formulario completo
    this.formVacante.updateValueAndValidity({ emitEvent: false });
    this.refreshSteps();
  }


  // =======================
  // Helpers de formato
  // =======================

  // Siempre devolver fechas como 'YYYY-MM-DD' o null
  private toYMD(value: any): string | null {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return null;

    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');

    return `${y}-${m}-${day}`;
  }

  /**
   * La `X` marca que el documento NO es cédula de ciudadanía.
   *
   * Antes esto comparaba `tipo === 'CC'` contra el valor CRUDO del formulario.
   * Con `'C.C'` —13793 filas en prod— la comparación fallaba, se enviaba
   * `X<cédula>` y el backend creaba un Candidato NUEVO para una persona que ya
   * existía. Era la fábrica activa de duplicados: cada entrevista guardada así
   * sumaba una fila. Se canoniza antes de comparar.
   */
  private normalizeDocForSubmit(tipo: string, raw: any): string {
    return docParaEnviar(tipo, raw);
  }

  // =======================
  // Submit
  // =======================
  async onSubmit() {
    if (this.isSubmitting) return;

    if (this.formVacante.invalid) {
      this.formVacante.markAllAsTouched();
      this.refreshSteps();

      // Determinar qué sección tiene el error
      const sections: { ctrl: FormGroup; name: string }[] = [
        { ctrl: this.step1Ctrl, name: 'Identificación / Documento' },
        { ctrl: this.step2Ctrl, name: 'Datos Personales' },
        { ctrl: this.step3Ctrl, name: 'Contacto y Domicilio' },
        { ctrl: this.step4Ctrl, name: 'Información Familiar (Hijos)' },
        { ctrl: this.step5Ctrl, name: 'Formación / Experiencia en Flores' },
        { ctrl: this.step6Ctrl, name: 'Historial Laboral' },
        { ctrl: this.step7Ctrl, name: 'Datos de Entrevista' },
      ];
      const invalidSections = sections.filter(s => s.ctrl.invalid).map(s => `<li>${s.name}</li>`);
      const sectionList = invalidSections.length
        ? `<p>Revise las siguientes secciones:</p><ul style="text-align:left;font-size:14px;">${invalidSections.join('')}</ul>`
        : '';

      await Swal.fire({
        icon: 'error',
        title: 'Formulario incompleto',
        html: `Hay campos obligatorios sin llenar o con errores.<br><b>Revise los campos marcados en rojo.</b>${sectionList}`,
        confirmButtonColor: '#3085d6',
      });

      setTimeout(() => {
        const firstInvalidControl = document.querySelector(
          'mat-form-field.mat-form-field-invalid, .ng-invalid[formControlName], .ng-invalid[formGroupName], .ng-invalid[formArrayName]'
        ) as HTMLElement;

        if (firstInvalidControl) {
          // Destaca visualmente el control temporalmente
          firstInvalidControl.classList.add('error-pulse');
          setTimeout(() => firstInvalidControl.classList.remove('error-pulse'), 2000);

          // Hacer focus si es posible (inputs/selects de Angular)
          const focusable = firstInvalidControl.querySelector('input, select, textarea') as HTMLElement;
          if (focusable) focusable.focus();

          // Scroll más suave y calculando el offset para evitar el header fijo
          const headerOffset = 100;
          const elementPosition = firstInvalidControl.getBoundingClientRect().top;
          const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

          window.scrollTo({
            top: offsetPosition,
            behavior: 'smooth'
          });
        }
      }, 150);

      return;
    }

    this.isSubmitting = true;
    try {
      const raw = this.formVacante.getRawValue();

      // Normalizamos payload antes de enviarlo
      const payload = {
        ...raw,

        // Documento con regla X + dígitos si no es CC
        numero_documento: this.normalizeDocForSubmit(
          raw.tipo_doc,
          raw.numero_documento
        ),

        // Fechas principales en YYYY-MM-DD
        fecha_expedicion: this.toYMD(raw.fecha_expedicion),
        fecha_nacimiento: this.toYMD(raw.fecha_nacimiento),

        // Hijos: formatear fecha_nac
        hijos: Array.isArray(raw.hijos)
          ? raw.hijos.map((h: any) => ({
            ...h,
            fecha_nac: this.toYMD(h?.fecha_nac),
          }))
          : [],

        // Por si el backend espera string plano, no Date
        brigadaDe: raw.brigadaDe ?? '',
      };

      // Guardar candidato / marcar entrevista como realizada
      const resp: any = await firstValueFrom(
        this.candidateService.upsertCandidatoByDocumentoFromForm(payload, {
          entrevistado: true,
        }, this.modificacionForzada()
          ? { modificacion_forzada: true, modificado_por: this.modificadoPor() || null }
          : undefined)
      );

      // Detectar respuesta offline falsa del interceptor
      if (resp?.offline === true) {
        await Swal.fire({
          icon: 'info',
          title: 'Sin conexión',
          html: 'No hay conexión a internet. Los datos se guardaron en su dispositivo y se enviarán automáticamente cuando vuelva la conexión.',
          confirmButtonText: 'Entendido',
          confirmButtonColor: '#3085d6',
        });
        return;
      }

      // Guardado real y confirmado (no offline): avisar al padre para que recargue
      // el candidato. Si el proceso anterior era terminal, ahora hay uno nuevo y
      // debe reflejarse en las píldoras / Historial sin tener que re-buscar.
      this.guardado.emit();

      await Swal.fire({
        icon: 'success',
        title: 'Listo',
        text: 'Datos guardados y entrevista marcada.',
      });
    } catch (e: any) {
      console.error('[form-entrevista] Error al guardar:', e);

      let title = 'Error al guardar';
      let htmlMessage = '';

      // Detectar respuesta offline falsa del interceptor
      if (e?.offline === true || e?.error?.offline === true) {
        await Swal.fire({
          icon: 'info',
          title: 'Sin conexión',
          html: 'No hay conexión a internet. Los datos se guardaron en su dispositivo y se enviarán automáticamente cuando vuelva la conexión.',
          confirmButtonText: 'Entendido',
          confirmButtonColor: '#3085d6',
        });
        return;
      }

      const errBody = e?.error;

      // Diccionario para traducir nombres técnicos de campos Django → español
      const fieldDict: Record<string, string> = {
        'numero_documento': 'Número de documento',
        'tipo_doc': 'Tipo de documento',
        'fecha_expedicion': 'Fecha de expedición',
        'mpio_expedicion': 'Municipio de expedición',
        'primer_apellido': 'Primer apellido',
        'segundo_apellido': 'Segundo apellido',
        'primer_nombre': 'Primer nombre',
        'segundo_nombre': 'Segundo nombre',
        'fecha_nacimiento': 'Fecha de nacimiento',
        'mpio_nacimiento': 'Municipio de nacimiento',
        'sexo': 'Género',
        'estado_civil': 'Estado civil',
        'correo_electronico': 'Correo electrónico',
        'password': 'Contraseña',
        'direccion_de_residencia': 'Dirección de residencia',
        'barrio': 'Barrio',
        'celular': 'Celular',
        'whatsapp': 'WhatsApp',
        'personas_con_quien_convive': 'Con quién vive',
        'hace_cuanto_vive': 'Tiempo en la zona',
        'nivel': 'Nivel de escolaridad',
        'experiencias': 'Experiencia laboral',
        'empresa': 'Empresa',
        'tiempo_trabajado': 'Tiempo trabajado',
        'labores_realizadas': 'Labores realizadas',
        'hijos': 'Hijos',
        'fecha_nac': 'Fecha de nacimiento del hijo',
        'numero_de_documento': 'Documento del hijo',
        'non_field_errors': 'Error general',
        'detail': 'Detalle',
      };
      const msgDict: Record<string, string> = {
        'This field is required.': 'Este campo es obligatorio.',
        'This field may not be blank.': 'Este campo no puede estar vacío.',
        'This field must be unique.': 'Este dato ya está registrado.',
        'Ensure this field has at least 8 characters.': 'Debe tener mínimo 8 caracteres.',
        'Enter a valid email address.': 'Ingrese un correo electrónico válido.',
        'A valid integer is required.': 'Se requiere un número válido.',
        'Date has wrong format.': 'Formato de fecha incorrecto (use AAAA-MM-DD).',
      };

      const translateField = (k: string): string => fieldDict[k] || k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const translateMsg = (m: string): string => msgDict[m] || m;

      if (errBody) {
        if (errBody.detail) {
          htmlMessage += `<b>${translateMsg(errBody.detail)}</b><br/>`;
        }

        // Parsear errores de validación de Django (DRF) recursivamente
        if (errBody.errors && typeof errBody.errors === 'object') {
          htmlMessage += `<ul style="text-align: left; font-size: 0.9em; margin-top: 10px; max-height: 200px; overflow-y: auto; padding-right: 10px;">`;

          const parseErrors = (obj: any, parentKey = ''): void => {
            if (Array.isArray(obj)) {
              obj.forEach((item, idx) => {
                if (typeof item === 'object' && item !== null) {
                  parseErrors(item, `${parentKey} (#${idx + 1})`);
                } else if (String(item).trim()) {
                  const translated = translateMsg(String(item));
                  if (parentKey.includes('Error general')) {
                    htmlMessage += `<li>${translated}</li>`;
                  } else {
                    htmlMessage += `<li>${parentKey ? `<b>${parentKey}:</b> ` : ''}${translated}</li>`;
                  }
                }
              });
            } else if (typeof obj === 'object' && obj !== null) {
              for (const [k, v] of Object.entries(obj)) {
                const fieldName = k === 'non_field_errors' ? 'Error general' : translateField(k);
                const prefix = parentKey ? `${parentKey} ➔ ${fieldName}` : fieldName;
                parseErrors(v, prefix);
              }
            } else if (String(obj).trim()) {
              const translated = translateMsg(String(obj));
              htmlMessage += `<li>${parentKey ? `<b>${parentKey}:</b> ` : ''}${translated}</li>`;
            }
          };

          parseErrors(errBody.errors);
          htmlMessage += `</ul>`;
        }

        if (errBody.db_error) {
          htmlMessage += `<div style="font-size: 0.85em; margin-top: 10px; color: #666; text-align: left; max-height: 100px; overflow-y: auto;"><i>Detalle técnico:</i> ${errBody.db_error}</div>`;
        }
        if (errBody.hint) {
          htmlMessage += `<div style="font-size: 0.85em; color: dimgrey; margin-top: 5px; text-align: left;"><b>Sugerencia:</b> ${errBody.hint}</div>`;
        }

        if (errBody.error && !errBody.details && !errBody.errors) {
          htmlMessage += `<div style="font-size: 0.85em; margin-top: 10px; color: #666; text-align: left;"><i>Error de sistema:</i> ${errBody.error}</div>`;
        }
      }

      if (!htmlMessage) {
        const status = e?.status;
        if (status === 0 || status === 504) {
          htmlMessage = 'No se pudo conectar con el servidor. Verifique su conexión a internet e intente de nuevo.';
        } else if (status === 500) {
          htmlMessage = 'Error interno del servidor. Los datos no se guardaron. Por favor intente de nuevo o contacte a soporte.';
        } else {
          htmlMessage = e?.message || 'No se pudo guardar debido a un error de conexión o del servidor.';
        }
      }

      await Swal.fire({
        icon: 'error',
        title: title,
        html: htmlMessage + '<p style="font-size:12px;color:#888;margin-top:10px;">Si el problema persiste, contacte a soporte indicando el número de documento.</p>',
        confirmButtonText: 'Entendido',
        confirmButtonColor: '#3085d6',
      });
    } finally {
      // OnPush + Electron: el `await` puede resolver FUERA de la zona de Angular
      // (el interceptor offline resuelve vía IPC de Electron). Sin esto, el botón
      // se queda en "Enviando…" hasta el próximo evento (un click). Forzamos el
      // reset y el re-render dentro de la zona.
      this.ngZone.run(() => {
        this.isSubmitting = false;
        this.cdr.markForCheck();
      });
    }
  }
}
