import { FincaItem, etiquetaFinca } from './../../service/fincas/fincas.service';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { COMMA, ENTER } from '@angular/cdk/keycodes';
import { Component, ElementRef, Inject, OnDestroy, OnInit, ViewChild, ChangeDetectionStrategy, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ValidatorFn,
  Validators,
  ReactiveFormsModule,
  FormsModule,
} from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule, MAT_DATE_FORMATS, DateAdapter, MAT_DATE_LOCALE } from '@angular/material/core';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MomentDateAdapter } from '@angular/material-moment-adapter';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';

import { Observable, Subject, of } from 'rxjs';
import { catchError, map, startWith, takeUntil } from 'rxjs/operators';

import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';
import {
  resolverDescripcionObra,
  esDescripcionGenerada,
  claveDescripcion,
  fechaParaDescripcionVacante,
} from '@/app/shared/data/labores-por-mes.data';
import { VacantesService } from '../../service/vacantes/vacantes.service';
import { PositionsService } from '../../../positions/services/positions/positions.service';
import { FincasService } from '../../service/fincas/fincas.service';

export const MY_DATE_FORMATS = {
  parse: { dateInput: 'D/M/YYYY' },
  display: {
    dateInput: 'D/M/YYYY',
    monthYearLabel: 'MMMM YYYY',
    dateA11yLabel: 'LL',
    monthYearA11yLabel: 'MMMM YYYY',
  },
};

/** Grupos tipados del FormArray de municipios */
interface DistMunControls {
  municipio: FormControl<string>;
  cantidad: FormControl<number | null>;
}
type DistMunGroup = FormGroup<DistMunControls>;

type DepCiudades = { ciudades: string[] };

@Component({
  selector: 'app-crear-editar-vacante',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
    MatIconModule,
    MatCheckboxModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatAutocompleteModule,
    FormsModule,
    MatChipsModule,
    MatTooltipModule,
  ],
  templateUrl: './crear-editar-vacante.component.html',
  styleUrls: ['./crear-editar-vacante.component.css'],
  providers: [
    { provide: DateAdapter, useClass: MomentDateAdapter, deps: [MAT_DATE_LOCALE] },
    { provide: MAT_DATE_FORMATS, useValue: MY_DATE_FORMATS },
    { provide: MAT_DATE_LOCALE, useValue: 'es-CO' },
  ],
})
export class CrearEditarVacanteComponent implements OnInit, OnDestroy {
  private readonly SI = 'Si';
  private readonly PRUEBA = 'Prueba';
  private readonly CONTRATACION = 'Contratación';
  private readonly destroyRef = inject(DestroyRef);

  vacanteForm!: FormGroup;

  sedes: Array<{ nombre: string; activa?: boolean }> = [];
  user: any;

  cargos: string[] = [];
  filteredCargos: Observable<string[]> = of([]);

  centrosCostos: string[] = [];
  filteredCentrosCostos: Observable<string[]> = of([]);

  municipiosColombia: string[] = [];
  municipiosFiltrados: string[] = [];
  municipioFiltro = '';
  municipioCtrl = new FormControl<string>('', { nonNullable: true });

  separatorKeysCodes: number[] = [ENTER, COMMA];
  @ViewChild('municipioInput', { static: false }) municipioInput!: ElementRef<HTMLInputElement>;

  areas: string[] = [
    'Rosa',
    'Clavel',
    'Astromelia',
    'Pompon',
    'Miniclavel',
    'Diversificados',
    'Lirios',
    'Fumigación',
    'Corte de Rosa',
    'Oficios Varios',
    'Otros',
  ];

  today: Date = new Date();

  private prevMunicipios: string[] = [];

  /** Finca cuyos datos ya se trajeron del maestro; evita recargas repetidas. */
  private fincaAplicada = '';

  // ==========================================================================
  // PROCEDENCIA DE LOS DATOS QUE TRAE EL CENTRO DE COSTO
  // ==========================================================================
  /*
   * `aplicarFinca` rellena empresa, direccion, temporal y —cuando el maestro
   * los da sin ambiguedad— salario y auxilio de transporte. En la pantalla
   * vieja eso era invisible: campos identicos al resto que "se llenaban solos",
   * sin decir de donde ni si podian tocarse. Ahora el formulario los agrupa,
   * dice de que centro vienen y marca el que se haya ajustado a mano, para que
   * la diferencia con la ficha del maestro se vea ANTES de guardar.
   */

  /** Centro de costo que rellenó los campos. `null` = todavía ninguno. */
  heredadoDe: string | null = null;

  /**
   * Lo que trajo ese centro, por nombre de control. Solo lleva los campos que
   * de verdad llegaron: si el maestro no dio salario, ese campo no es heredado
   * y no debe marcarse como "ajustado" al digitarlo.
   */
  private heredado: Record<string, string> = {};

  /** Orden en que la ficha pinta los campos heredados. */
  readonly CAMPOS_HEREDADOS = [
    { control: 'empresa_usuaria_solicita', label: 'Empresa' },
    { control: 'direccion', label: 'Dirección' },
    { control: 'temporal', label: 'Temporal' },
    { control: 'salario', label: 'Salario' },
    { control: 'auxilio_transporte', label: 'Auxilio Transporte' },
  ] as const;

  private norm(v: unknown): string {
    return (v ?? '').toString().trim().toUpperCase();
  }

  /** Ese control lo trajo el centro de costo (aunque luego se haya tocado). */
  esHeredado(control: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.heredado, control);
  }

  /** El valor actual ya no coincide con el que trajo el centro de costo. */
  fueAjustado(control: string): boolean {
    if (!this.esHeredado(control)) return false;
    return this.norm(this.vacanteForm?.get(control)?.value) !== this.norm(this.heredado[control]);
  }

  get hayAjustes(): boolean {
    return Object.keys(this.heredado).some((c) => this.fueAjustado(c));
  }

  /** Vuelve a poner los campos como los dejó el centro de costo. */
  restaurarHeredados(): void {
    if (!Object.keys(this.heredado).length) return;
    const patch: Record<string, unknown> = {};
    for (const [c, v] of Object.entries(this.heredado)) {
      patch[c] = c === 'salario' ? Number(v) : (v || null);
    }
    // Sin markForCheck: este componente no es OnPush y el botón que llama aquí
    // es un listener de plantilla, que en zoneless ya agenda la detección.
    this.vacanteForm.patchValue(patch);
  }

  constructor(
    private fb: FormBuilder,
    private http: HttpClient,
    public dialogRef: MatDialogRef<CrearEditarVacanteComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any,
    private adminService: UtilityServiceService,
    private vacantesService: VacantesService, // (queda por si lo usas luego)
    private positionsService: PositionsService,
    private fincasService: FincasService,
    private utilityService: UtilityServiceService
  ) {
    this.today.setHours(0, 0, 0, 0);
  }

  ngOnInit(): void {
    this.user = this.utilityService.getUser() || null;

    // ✅ VALIDADORES:
    // - excesoMunicipios: suma > total
    // - sumaNoIgualTotal: suma !== total (solo cuando ya hay distribución)
    this.vacanteForm = this.fb.group(
      {
        cargo: ['', Validators.required],
        finca: ['', Validators.required],
        empresa_usuaria_solicita: ['', Validators.required],
        temporal: ['', Validators.required],
        direccion: ['', Validators.required],

        experiencia: ['', Validators.required],
        observacionVacante: [''],
        descripcion: ['', Validators.required],
        fecha_publicado: [new Date()],
        quienpublicolavacante: [
          `${this.user?.datos_basicos?.nombres ?? ''} ${this.user?.datos_basicos?.apellidos ?? ''}`.trim(),
        ],
        estadovacante: ['Activa'],
        salario: [1750905, [Validators.required, Validators.min(0)]],
        codigo_elite: [''],

        // Condicional 1: Fecha de ingreso
        tieneFechaIngreso: ['No', Validators.required],
        fechadeIngreso: [{ value: null, disabled: true }],

        // Condicional 2: Prueba o Contratación
        prueba_ocontratacion: ['', Validators.required],
        fechadePruebatecnica: [{ value: null, disabled: true }],
        horade_pruebatecnica: [{ value: '', disabled: true }],
        ubicacionPruebaTecnica: [{ value: '', disabled: true }],

        tipo_contratacion: ['', Validators.required],

        municipio: [[], Validators.required],
        barrio: [''],

        personas_solicitadas: [null, [Validators.required, Validators.min(1)]],
        municipiosDistribucion: this.fb.array<DistMunGroup>([]),

        // Arranca VACIO y no en 0: con 0 `Validators.required` pasaba (0 no es
        // "vacío" para Angular), el select se veía en blanco sin marca de error
        // y el faltante solo salía al guardar, en el Swal de "faltan campos".
        // Se llena solo desde el maestro al elegir la finca.
        auxilio_transporte: ['', [Validators.required]],
        area: ['', Validators.required],

        // Oficinas
        oficinasSeleccionadas: [[], Validators.required],
        oficinas_que_contratan: this.fb.array([]),
      },
      {
        validators: [
          this.sumNoExcedeTotalValidator(),
          this.sumIgualTotalValidator(), // ✅ NUEVO: NO deja guardar si la suma no cuadra
        ],
      }
    );

    // Si viene data, cargar primero para no pelear con subscribes
    if (this.data) this.cargarParaEdicion(this.data);

    // --------- AUTOCOMPLETE CARGOS ----------
    const cargoCtrl = this.vacanteForm.get('cargo') as FormControl<string>;
    this.filteredCargos = cargoCtrl.valueChanges.pipe(
      startWith(cargoCtrl.value ?? ''),
      map((value: string) => this._filter(value || '', this.cargos))
    );

    this.positionsService
      .list()
      .pipe(
        map((rows: any[]) => (rows ?? []).map((c: any) => String(c?.nombre ?? '').trim()).filter(Boolean)),
        catchError(() => of([] as string[])),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((nombres: string[]) => {
        this.cargos = nombres;
        this.filteredCargos = cargoCtrl.valueChanges.pipe(
          startWith(cargoCtrl.value ?? ''),
          map((value: string) => this._filter(value || '', this.cargos))
        );
      });

    // --------- AUTOCOMPLETE FINCAS ----------
    this.fincasService
      .listNombreFincas()
      .pipe(catchError(() => of([] as string[])), takeUntilDestroyed(this.destroyRef))
      .subscribe((nombres: string[]) => {
        this.centrosCostos = nombres ?? [];
        const fincaCtrl = this.vacanteForm.get('finca') as FormControl<string>;
        this.filteredCentrosCostos = fincaCtrl.valueChanges.pipe(
          startWith(fincaCtrl.value ?? ''),
          map((value: string) => this._filter(value || '', this.centrosCostos))
        );
      });

    // --------- SEDES ----------
    type SedeDto = { nombre: string; activa?: boolean | null };

    this.adminService
      .traerSucursales()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError(() => {
          this.sedes = [];
          return of([] as SedeDto[]);
        })
      )
      .subscribe((sucursales: SedeDto[]) => {
        if (!Array.isArray(sucursales)) {
          this.sedes = [];
          return;
        }

        this.sedes = sucursales
          .filter((s: SedeDto) => s?.activa !== false)
          .map((s: SedeDto) => ({
            nombre: String(s?.nombre ?? '').trim(),
            activa: s?.activa ?? true,
          }))
          .filter((s) => !!s.nombre)
          .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
      });

    // --------- OFICINAS SELECCIONADAS => FORMARRAY ----------
    this.vacanteForm
      .get('oficinasSeleccionadas')!
      .valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((sel: unknown) => this.actualizarOficinasQueContratan(Array.isArray(sel) ? sel : []));

    // --------- MUNICIPIOS (CATÁLOGO + FILTRO) ----------
    this.http
      .get<DepCiudades[]>('./util/colombia.json')
      .pipe(catchError(() => of([] as DepCiudades[])), takeUntilDestroyed(this.destroyRef))
      .subscribe((data: DepCiudades[]) => {
        const ciudades = (data ?? []).flatMap((dep) => (Array.isArray(dep?.ciudades) ? dep.ciudades : []));
        this.municipiosColombia = ciudades
          .map((c) => String(c ?? '').trim())
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

        this.municipiosFiltrados = [...this.municipiosColombia];
        this.resetFiltroMunicipio();
      });

    this.municipioCtrl.valueChanges.pipe(startWith(''), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.filtrarMunicipios());

    // --------- SYNC: municipio[] => municipiosDistribucion[] ----------
    this.vacanteForm
      .get('municipio')!
      .valueChanges.pipe(startWith(this.vacanteForm.get('municipio')!.value), takeUntilDestroyed(this.destroyRef))
      .subscribe((actual: unknown) => this.syncDistribucionConSeleccion(Array.isArray(actual) ? actual : []));

    // ✅ Revalida si cambia el total
    this.vacanteForm
      .get('personas_solicitadas')!
      .valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.vacanteForm.updateValueAndValidity({ emitEvent: false }));

    // ✅ Revalida cuando cambie cualquier cantidad de distribución (para que el mensaje se actualice al instante)
    this.municipiosDistribucion.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.vacanteForm.updateValueAndValidity({ emitEvent: false }));

    // ====== Validaciones condicionales ======
    // La fecha de ingreso la maneja applyPruebaContratacion -> syncFechaIngreso
    // (solo aplica en "Contratación inmediata"). El toggle "Tiene Fecha de
    // Ingreso" ya no se muestra ni se edita a mano.
    this.applyPruebaContratacion(String(this.vacanteForm.get('prueba_ocontratacion')!.value ?? ''));
    this.vacanteForm
      .get('prueba_ocontratacion')!
      .valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((v: unknown) => this.applyPruebaContratacion(String(v ?? '')));

    // ====== DESCRIPCIÓN AUTOMÁTICA ======
    // La labor cambia con el cargo (de ahí sale el área), con el mes de la
    // fecha, y con la temporal (cada una tiene su hoja de labores).
    // `prueba_ocontratacion` entra porque al cambiarlo se limpia la fecha que se
    // estaba usando, y `fechadePruebatecnica` porque es la que se conoce al
    // publicar: ponerla tiene que corregir la descripción en el momento.
    // `finca` y `empresa_usuaria_solicita` entran porque también mandan: la
    // finca por las áreas fijas (LAS DELICIAS) y la empresa porque Elite Blu
    // tiene su propia hoja de labores aunque sea de Apoyo. Las dos se pueden
    // editar a mano después de que el maestro las llenó.
    const disparan = [
      'cargo',
      'fechadeIngreso',
      'fechadePruebatecnica',
      'fecha_publicado',
      'temporal',
      'prueba_ocontratacion',
      'finca',
      'empresa_usuaria_solicita',
    ];
    for (const campo of disparan) {
      this.vacanteForm
        .get(campo)!
        .valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.sugerirDescripcion());
    }

    this.sugerirDescripcion();
  }

  ngOnDestroy(): void {
  }

  // ---------- Validaciones condicionales ----------
  /**
   * La Fecha de Ingreso se muestra y se exige SOLO en "Contratación inmediata"
   * (misma lógica que tenía la "Autorización de ingreso": entra de una vez).
   * El toggle "Tiene Fecha de Ingreso" ya no se muestra: se maneja aquí solo.
   * Al cambiar a otra opción (p.ej. Prueba técnica) se BORRA la fecha para no
   * dejar un dato viejo colgado, y se oculta.
   */
  private syncFechaIngreso(): void {
    const esContratacion =
      String(this.vacanteForm.get('prueba_ocontratacion')?.value ?? '') === this.CONTRATACION;

    // Toggle oculto, coherente con el payload (Si/No).
    this.vacanteForm.get('tieneFechaIngreso')!
      .setValue(esContratacion ? this.SI : 'No', { emitEvent: false });

    const ctrl = this.vacanteForm.get('fechadeIngreso')!;
    if (esContratacion) {
      ctrl.enable({ emitEvent: false });
      ctrl.setValidators([Validators.required]);
    } else {
      ctrl.reset(null, { emitEvent: false });   // borra el dato al cambiar de opción
      ctrl.clearValidators();
      ctrl.disable({ emitEvent: false });
    }
    ctrl.updateValueAndValidity({ emitEvent: false });
  }

  private applyPruebaContratacion(valor: string): void {
    const fPrueba = this.vacanteForm.get('fechadePruebatecnica')!;
    const hPrueba = this.vacanteForm.get('horade_pruebatecnica')!;
    const uPrueba = this.vacanteForm.get('ubicacionPruebaTecnica')!;

    if (valor === this.PRUEBA) {
      fPrueba.enable({ emitEvent: false });
      fPrueba.setValidators([Validators.required]);

      hPrueba.enable({ emitEvent: false });
      hPrueba.setValidators([Validators.required]);

      uPrueba.enable({ emitEvent: false });
      uPrueba.clearValidators();
    } else {
      [fPrueba, hPrueba, uPrueba].forEach((c) => {
        c.reset(null, { emitEvent: false });
        c.clearValidators();
        c.disable({ emitEvent: false });
      });
    }

    fPrueba.updateValueAndValidity({ emitEvent: false });
    hPrueba.updateValueAndValidity({ emitEvent: false });
    uPrueba.updateValueAndValidity({ emitEvent: false });

    // La fecha de ingreso depende de esta opción (Contratación inmediata).
    this.syncFechaIngreso();
  }

  // ---------- Distribución por municipio ----------
  get municipiosDistribucion(): FormArray<DistMunGroup> {
    return this.vacanteForm.get('municipiosDistribucion') as FormArray<DistMunGroup>;
  }

  onAddBarrioFromForm(): void {
    const raw = (this.vacanteForm.get('barrio')?.value || '').toString().trim();
    if (!raw) return;

    const etiqueta = `B - ${raw}`.trim();

    const idxBarrio = this.municipiosDistribucion.controls.findIndex((fg) =>
      /^B\s*-\s*/i.test((fg.get('municipio')?.value || '').toString())
    );

    if (idxBarrio > -1) {
      this.municipiosDistribucion.at(idxBarrio).get('municipio')?.setValue(etiqueta);
    } else {
      this.municipiosDistribucion.push(
        this.fb.group<DistMunControls>({
          municipio: this.fb.control<string>(etiqueta, { nonNullable: true }),
          cantidad: this.fb.control<number | null>(0, [Validators.required, Validators.min(0)]),
        })
      );
    }

    this.vacanteForm.get('barrio')?.setValue('');
    this.vacanteForm.updateValueAndValidity({ emitEvent: false });
  }

  private syncDistribucionConSeleccion(actual: any[]): void {
    const curr = (actual || []).map((s) => (s ?? '').toString().trim()).filter(Boolean);
    const added = curr.filter((m) => !this.prevMunicipios.includes(m));
    const removed = this.prevMunicipios.filter((m) => !curr.includes(m));

    for (const m of added) {
      this.municipiosDistribucion.push(
        this.fb.group<DistMunControls>({
          municipio: this.fb.control<string>(m, { nonNullable: true }),
          cantidad: this.fb.control<number | null>(0, [Validators.required, Validators.min(0)]),
        })
      );
    }

    for (const m of removed) {
      const idx = this.municipiosDistribucion.controls.findIndex(
        (c) => (c.get('municipio')!.value || '').toString().trim() === m
      );
      if (idx > -1) this.municipiosDistribucion.removeAt(idx);
    }

    this.prevMunicipios = curr;
    this.vacanteForm.updateValueAndValidity({ emitEvent: false });
  }

  get totalAsignado(): number {
    return this.municipiosDistribucion.controls
      .map((c) => Number(c.get('cantidad')!.value) || 0)
      .reduce((a: number, b: number) => a + b, 0);
  }

  get restante(): number {
    const total = Number(this.vacanteForm.get('personas_solicitadas')!.value) || 0;
    return Math.max(0, total - this.totalAsignado);
  }

  // ✅ Error 1: no exceder el total
  private sumNoExcedeTotalValidator(): ValidatorFn {
    return (group: AbstractControl) => {
      const total = Number(group.get('personas_solicitadas')?.value) || 0;
      const arr = group.get('municipiosDistribucion') as FormArray | null;
      if (!arr) return null;

      const suma = (arr.controls || [])
        .map((c) => Number(c.get('cantidad')?.value) || 0)
        .reduce((a: number, b: number) => a + b, 0);

      return suma <= total ? null : { excesoMunicipios: true };
    };
  }

  // ✅ Error 2: la suma debe ser IGUAL al total (para el mensaje visible bajo el resumen)
  private sumIgualTotalValidator(): ValidatorFn {
    return (group: AbstractControl) => {
      const total = Number(group.get('personas_solicitadas')?.value) || 0;
      const arr = group.get('municipiosDistribucion') as FormArray | null;
      if (!arr) return null;

      // Si no hay distribución todavía, no marcamos este error
      if (arr.length === 0) return null;

      const suma = (arr.controls || [])
        .map((c) => Number(c.get('cantidad')?.value) || 0)
        .reduce((a: number, b: number) => a + b, 0);

      // Si ya excedió, que lo maneje "excesoMunicipios"
      if (suma > total) return null;

      // Si total no está definido aún, no forzamos igualdad
      if (total <= 0) return null;

      return suma === total ? null : { sumaNoIgualTotal: true };
    };
  }

  // ---------- Filtro de municipios ----------
  filtrarMunicipios(): void {
    const f = (this.municipioFiltro || '').toLowerCase();
    const seleccionados: string[] = Array.isArray(this.vacanteForm.get('municipio')?.value)
      ? (this.vacanteForm.get('municipio')!.value as string[])
      : [];

    const noSeleccionados = this.municipiosColombia.filter(
      (m) => !seleccionados.includes(m) && m.toLowerCase().includes(f)
    );

    this.municipiosFiltrados = [...seleccionados, ...noSeleccionados];
  }

  resetFiltroMunicipio(): void {
    const seleccionados: string[] = Array.isArray(this.vacanteForm.get('municipio')?.value)
      ? (this.vacanteForm.get('municipio')!.value as string[])
      : [];

    const noSeleccionados = this.municipiosColombia.filter((m) => !seleccionados.includes(m));
    this.municipiosFiltrados = [...seleccionados, ...noSeleccionados];
    this.municipioFiltro = '';
  }

  private stripTime(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()); // local, sin hora
  }

  private parseApiDate(value: unknown): Date | null {
    if (!value) return null;

    if (value instanceof Date) return this.stripTime(value);

    const s = String(value).trim();

    // Caso: "YYYY-MM-DD" (DateField típico)
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]) - 1;
      const d = Number(m[3]);
      return new Date(y, mo, d); // ✅ local, no se corre
    }

    // Caso: ISO con hora/zona ("2026-01-21T00:00:00Z", etc.)
    const dt = new Date(s);
    if (Number.isNaN(dt.getTime())) return null;

    return this.stripTime(dt); // ✅ te quedas con la fecha local
  }

  private toYmdLocal(d: Date | null | undefined): string | null {
    if (!d) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`; // ✅ no usa UTC
  }


  // ---------- Edición ----------
  private cargarParaEdicion(v: any): void {
    this.vacanteForm.patchValue({
      cargo: v?.cargo ?? '',
      area: v?.area ?? '',
      finca: v?.finca ?? '',
      empresa_usuaria_solicita: v?.empresa_usuaria_solicita ?? '',
      direccion: v?.direccion ?? '',
      temporal: v?.temporal ?? '',
      experiencia: v?.experiencia ?? '',
      observacionVacante: v?.observacion ?? '',

      tieneFechaIngreso: v?.fechadeIngreso ? this.SI : 'No',
      fechadeIngreso: this.parseApiDate(v?.fechadeIngreso),

      descripcion: v?.descripcion ?? '',
      fecha_publicado: this.parseApiDate(v?.fecha_publicado) ?? new Date(),

      quienpublicolavacante: v?.quienpublicolavacante ?? '',
      estadovacante: v?.estadovacante ?? 'Activa',
      salario: v?.salario ?? 1750905,
      codigo_elite: v?.codigo_elite ?? '',

      oficinasSeleccionadas: Array.isArray(v?.oficinas_que_contratan)
        ? v.oficinas_que_contratan.map((o: any) => o?.nombre)
        : [],

      prueba_ocontratacion: v?.prueba_ocontratacion ?? '',
      fechadePruebatecnica: this.parseApiDate(v?.fechadePruebatecnica),

      horade_pruebatecnica: v?.horade_pruebatecnica ?? '',
      ubicacionPruebaTecnica: v?.ubicacionPruebaTecnica ?? '',
      tipo_contratacion: v?.tipo_contratacion ?? '',
      municipio: Array.isArray(v?.municipio) ? v.municipio : [],
      auxilio_transporte: v?.auxilio_transporte ?? '',
      personas_solicitadas: v?.personas_solicitadas ?? null,
    });

    // Oficinas
    const fa = this.oficinas_que_contratan;
    fa.clear();
    (Array.isArray(v?.oficinas_que_contratan) ? v.oficinas_que_contratan : []).forEach((o: any) =>
      fa.push(this.fb.group({ nombre: [o?.nombre ?? '', Validators.required], ruta: [!!o?.ruta] }))
    );

    // Distribución
    const dist = Array.isArray(v?.municipiosDistribucion) ? v.municipiosDistribucion : [];
    const distFA = this.municipiosDistribucion;
    distFA.clear();

    dist.forEach((d: any) => {
      distFA.push(
        this.fb.group<DistMunControls>({
          municipio: this.fb.control<string>((d?.municipio ?? '').toString(), { nonNullable: true }),
          cantidad: this.fb.control<number | null>(Number(d?.cantidad) || 0, [Validators.required, Validators.min(0)]),
        })
      );
    });

    // Si hay "B - ...", reflejarlo en el input barrio
    const barrioItem = dist.find((d: any) => typeof d?.municipio === 'string' && /^B\s*-\s*/i.test(d.municipio));
    if (barrioItem) {
      const nombreBarrio = String(barrioItem.municipio).replace(/^B\s*-\s*/i, '').trim();
      this.vacanteForm.get('barrio')?.setValue(nombreBarrio);
    }

    this.prevMunicipios = (Array.isArray(v?.municipio) ? v.municipio : [])
      .map((x: any) => String(x ?? '').trim())
      .filter(Boolean);

    // La vacante ya trae empresa y dirección guardadas: no hay que volver a
    // pedirlas al abrir para editar, solo si se cambia la finca.
    this.fincaAplicada = String(v?.finca ?? '').trim().toUpperCase();

    this.syncFechaIngreso();
    this.applyPruebaContratacion(String(this.vacanteForm.get('prueba_ocontratacion')!.value ?? ''));

    this.vacanteForm.updateValueAndValidity({ emitEvent: false });
  }


  // ---------- Helpers ----------
  private _filter(value: string, list: string[]): string[] {
    const filterValue = (value || '').toLowerCase();
    return (list || []).filter((item) => item.toLowerCase().includes(filterValue));
  }

  get oficinas_que_contratan(): FormArray {
    return this.vacanteForm.get('oficinas_que_contratan') as FormArray;
  }

  private canonicalTemporal(raw: string | null | undefined): 'APOYO LABORAL SAS' | 'TU ALIANZA SAS' | null {
    if (!raw) return null;

    const norm = String(raw)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();

    if (/(^|[^a-z])apoyo([^a-z]|$)/.test(norm)) return 'APOYO LABORAL SAS';
    if (/(^|[^a-z])alianza([^a-z]|$)/.test(norm)) return 'TU ALIANZA SAS';

    return null;
  }

  onCentroCostoSelected(event: MatAutocompleteSelectedEvent): void {
    this.aplicarFinca((event.option.value || '').toString());
  }

  /**
   * Nombres entre los que hay que escoger cuando la finca escrita es ambigua.
   * Vacío = no hay ambigüedad pendiente. Lo lee la plantilla para decir cuáles
   * son las opciones sin que el usuario tenga que adivinar.
   */
  fincaAmbiguaOpciones: string[] = [];

  /**
   * Trae del maestro empresa, dirección, temporal, salario y auxilio de
   * transporte de la finca dada.
   *
   * Se llama tanto al elegir del desplegable como al salir del campo escrito a
   * mano: el input es un autocomplete libre, así que se puede teclear el nombre
   * completo sin llegar a seleccionar la opción, y antes en ese caso la vacante
   * quedaba sin empresa ni dirección.
   */
  private aplicarFinca(nombre: string): void {
    const q = (nombre || '').trim();
    if (!q || q.toUpperCase() === this.fincaAplicada) return;

    this.fincasService
      .buscarFincasPorNombre(q)
      .pipe(catchError(() => of([] as FincaItem[])))
      .subscribe((coincidencias: FincaItem[]) => {
        if (!coincidencias.length) return;

        const finca = this.escogerFinca(coincidencias);
        if (!finca) return; // ambigua: `escogerFinca` ya dejó el aviso puesto

        // El autocomplete muestra el nombre desambiguado ("SAN CARLOS (FLORES
        // IPANEMA S.A.S)") pero en la vacante se guarda el nombre limpio: es la
        // clave con la que la contratación vuelve a cruzar el maestro, y la
        // empresa usuaria —que queda al lado— ya dice de cuál de las dos es.
        const limpio = (finca.finca ?? '').trim();
        this.fincaAplicada = (limpio || q).toUpperCase();

        const patch: Record<string, unknown> = {
          finca: limpio || q,
          empresa_usuaria_solicita: finca.empresa ?? null,
          direccion: finca.direccion ?? null,
          temporal: this.canonicalTemporal(finca.temporal),
        };

        // Pago y transporte son datos DE LA FINCA, no algo que quien publica
        // tenga que recordar: el maestro ya los tiene y son distintos entre la
        // finca de Apoyo y la homónima de Tu Alianza. Solo entran cuando el
        // maestro los da sin ambigüedad (mismo valor en todos los subcentros);
        // si difieren llega `null` y se deja lo que haya para digitarlo.
        if (finca.salario != null && Number(finca.salario) > 0) {
          patch['salario'] = Number(finca.salario);
        }
        if (finca.auxilio_transporte != null) {
          patch['auxilio_transporte'] = finca.auxilio_transporte ? 'Si' : 'No';
        }

        this.vacanteForm.patchValue(patch);

        // Deja constancia de QUÉ trajo el maestro y con qué valores. Se guarda
        // desde `patch` y no de una lista fija porque salario y auxilio solo
        // entran a veces: si no llegaron, no son heredados.
        this.heredadoDe = limpio || q;
        this.heredado = {};
        for (const c of ['empresa_usuaria_solicita', 'direccion', 'temporal', 'salario', 'auxilio_transporte']) {
          if (c in patch) this.heredado[c] = (patch[c] ?? '').toString();
        }

        // La temporal del maestro es la que decide de qué hoja sale la labor,
        // así que la descripción se recalcula después de tenerla.
        this.sugerirDescripcion();
      });
  }

  /**
   * Decide cuál de las fincas homónimas aplicar, o ninguna.
   *
   * Con un solo resultado no hay nada que decidir. Cuando el nombre existe en
   * varias razones sociales —SAN CARLOS está en Apoyo (The Elite Flower) y en
   * Tu Alianza (Flores Ipanema), y son sitios distintos— primero se intenta con
   * la empresa que ya tenga la vacante; si eso no la deja en una sola, NO se
   * escoge: entre las dos cambia la dirección, la temporal (y con ella la hoja
   * de labores de la que sale la descripción) y el pago, así que tomar la
   * primera llenaba la vacante con los datos del sitio equivocado sin avisar.
   *
   * El error `fincaAmbigua` deja el formulario inválido a propósito: es lo que
   * evita guardar una vacante con la temporal de la otra finca. Se limpia solo,
   * porque al escribir en el campo Angular vuelve a correr los validadores.
   */
  private escogerFinca(coincidencias: FincaItem[]): FincaItem | null {
    const fincaCtrl = this.vacanteForm.get('finca')!;

    const aceptar = (f: FincaItem): FincaItem => {
      this.fincaAmbiguaOpciones = [];
      this.limpiarError(fincaCtrl, 'fincaAmbigua');
      return f;
    };

    if (coincidencias.length === 1) return aceptar(coincidencias[0]);

    const empresa = this.normalizarNombre(this.vacanteForm.get('empresa_usuaria_solicita')?.value);
    const porEmpresa = empresa
      ? coincidencias.filter((i) => this.normalizarNombre(i.empresa) === empresa)
      : [];
    if (porEmpresa.length === 1) return aceptar(porEmpresa[0]);

    this.fincaAmbiguaOpciones = coincidencias.map(etiquetaFinca).filter(Boolean);
    this.ponerError(fincaCtrl, 'fincaAmbigua');
    return null;
  }

  /** Mayúsculas sin acentos ni espacios de sobra, para comparar nombres. */
  private normalizarNombre(v: unknown): string {
    return String(v ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Agrega un error propio sin borrar los nativos (`required`). */
  private ponerError(ctrl: AbstractControl, clave: string): void {
    ctrl.setErrors({ ...(ctrl.errors || {}), [clave]: true });
  }

  /** Quita un error propio dejando los nativos como estén. */
  private limpiarError(ctrl: AbstractControl, clave: string): void {
    if (!ctrl.errors || !ctrl.errors[clave]) return;
    const { [clave]: _, ...resto } = ctrl.errors;
    ctrl.setErrors(Object.keys(resto).length ? resto : null);
  }

  /** Al salir del campo de finca escrito a mano. */
  onFincaBlur(): void {
    this.aplicarFinca(String(this.vacanteForm.get('finca')?.value ?? ''));
  }

  /**
   * Propone la descripción de la obra con la misma regla de la base de
   * contratación: la labor depende del MES y del área, y el área sale del
   * cargo. De qué hoja de "labores por mes" se lee lo decide la temporal, y
   * Elite Blu tiene la suya aunque sea de Apoyo.
   *
   * El mes sale de la fecha de ingreso; si no la hay todavía, de la de prueba
   * técnica, y solo como último recurso de la de publicación (ver
   * `fechaParaDescripcionVacante`). Aquí es una aproximación: la definitiva es
   * la fecha de ingreso de la pantalla de contratación, que la vuelve a
   * calcular antes de que salga en los documentos.
   *
   * Se reescribe cuando el campo está vacío, cuando lo que hay salió de estas
   * tablas, o cuando quedó de otro mes. Un texto redactado a mano no se pisa.
   */
  private sugerirDescripcion(): void {
    const ctrl = this.vacanteForm.get('descripcion');
    if (!ctrl) return;

    const actual = String(ctrl.value ?? '').trim();
    const redactadaAMano =
      actual !== '' && !esDescripcionGenerada(actual) && !claveDescripcion(actual);
    if (redactadaAMano) return;

    const v = this.vacanteForm.getRawValue();
    const fecha = fechaParaDescripcionVacante(
      v.fechadeIngreso,
      v.fechadePruebatecnica,
      v.fecha_publicado,
    );
    if (!fecha) return;

    const sugerida = resolverDescripcionObra(
      v.cargo,
      fecha,
      `${v.empresa_usuaria_solicita ?? ''} ${v.finca ?? ''}`,
      v.temporal,
      v.empresa_usuaria_solicita,
    );

    // Si no hay labor para esa combinación se deja lo que haya: el campo es
    // obligatorio y quien publica la escribe a mano. Pasa con los cargos de
    // jardinería de Tu Alianza (área JAR), que no tienen labores definidas.
    if (sugerida && sugerida !== actual) {
      ctrl.setValue(sugerida);
    }
  }

  actualizarOficinasQueContratan(seleccionadas: any[]): void {
    const formArray = this.oficinas_que_contratan;
    formArray.clear();

    (seleccionadas || []).forEach((sede: any) => {
      const nombre = typeof sede === 'string' ? sede : String(sede?.nombre ?? sede ?? '').trim();
      if (!nombre) return;
      formArray.push(this.fb.group({ nombre: [nombre, Validators.required], ruta: [false] }));
    });
  }

  formatSalary(event: Event): void {
    const input = event.target as HTMLInputElement;
    const digits = (input?.value || '').replace(/\D/g, '');

    // Mantén el formControl NUMÉRICO
    this.vacanteForm.get('salario')?.setValue(Number(digits || 0), { emitEvent: false });

    // Formatea sólo el input
    input.value = this.formatNumber(digits);
  }

  onBlur(event: FocusEvent): void {
    const input = event.target as HTMLInputElement;
    const valueNum = Number(this.vacanteForm.get('salario')?.value) || 0;
    if (input) input.value = this.formatNumber(valueNum);
  }

  formatNumber(value: string | number): string {
    return new Intl.NumberFormat('es-CO').format(Number(value || 0));
  }

  eliminarOficina(index: number): void {
    this.oficinas_que_contratan.removeAt(index);
    this.vacanteForm.updateValueAndValidity({ emitEvent: false });
  }

  guardar(): void {
    this.vacanteForm.markAllAsTouched();
    this.vacanteForm.updateValueAndValidity({ emitEvent: false });

    // ✅ Si la suma no cuadra o excede, el form queda INVALID y NO guarda
    if (this.vacanteForm.invalid) return;

    this.dialogRef.close(this.vacanteForm.getRawValue());
  }

  cancelar(): void {
    this.dialogRef.close();
  }

  isRequired(ctrlOrName: string | AbstractControl | null): boolean {
    const ctrl = typeof ctrlOrName === 'string' ? this.vacanteForm.get(ctrlOrName) : ctrlOrName;
    if (!ctrl || !ctrl.enabled) return false;

    const anyCtrl = ctrl as any;
    return typeof anyCtrl.hasValidator === 'function' ? anyCtrl.hasValidator(Validators.required) : false;
  }
}
