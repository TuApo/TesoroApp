import { FincaItem } from './../../service/fincas/fincas.service';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { COMMA, ENTER } from '@angular/cdk/keycodes';
import { ChangeDetectorRef, Component, ElementRef, Inject, OnDestroy, OnInit, ViewChild, DestroyRef, inject } from '@angular/core';
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
  /**
   * Zoneless: los catálogos (cargos, centros de costo, sedes, municipios) se
   * asignan dentro de .subscribe(). Sin markForCheck no hay ciclo que repinte y
   * los desplegables se quedan vacíos hasta que el usuario toca cualquier campo
   * y dispara CD por un evento de plantilla.
   */
  private readonly cdr = inject(ChangeDetectorRef);

  vacanteForm!: FormGroup;

  sedes: Array<{ nombre: string; activa?: boolean }> = [];
  user: any;

  cargos: string[] = [];
  filteredCargos: Observable<string[]> = of([]);

  centrosCostos: string[] = [];
  filteredCentrosCostos: Observable<string[]> = of([]);

  // ==========================================================================
  // PROCEDENCIA DE LOS DATOS HEREDADOS DEL CENTRO DE COSTO
  // ==========================================================================
  /*
   * Empresa, Dirección y Temporal no se escriben a mano: los trae el centro de
   * costo (`onCentroCostoSelected`). En la pantalla vieja eso era invisible —
   * tres campos idénticos al resto que "se llenaban solos" y nadie sabía de
   * dónde salían ni si podía tocarlos. Ahora el formulario los agrupa y dice
   * de qué centro vienen, y marca el que se haya ajustado a mano para que la
   * diferencia con la ficha del centro de costo quede a la vista antes de
   * guardar.
   */

  /** Centro de costo que rellenó los tres campos. `null` = todavía ninguno. */
  heredadoDe: string | null = null;

  /** Lo que trajo ese centro, tal cual, para detectar ajustes manuales. */
  private heredado: { empresa: string; direccion: string; temporal: string } | null = null;

  /** Normaliza para comparar: lo que importa es el dato, no mayúsculas ni bordes. */
  private norm(v: unknown): string {
    return (v ?? '').toString().trim().toUpperCase();
  }

  /**
   * El valor actual del campo ya no coincide con el que trajo el centro de
   * costo. Sólo tiene sentido cuando hubo herencia previa.
   */
  fueAjustado(campo: 'empresa' | 'direccion' | 'temporal'): boolean {
    if (!this.heredado) return false;
    const actual =
      campo === 'empresa' ? this.vacanteForm?.get('empresaUsuariaSolicita')?.value
      : campo === 'direccion' ? this.vacanteForm?.get('direccion')?.value
      : this.vacanteForm?.get('temporal')?.value;
    return this.norm(actual) !== this.norm(this.heredado[campo]);
  }

  /** ¿Hay algún ajuste manual sobre lo que trajo el centro de costo? */
  get hayAjustes(): boolean {
    return this.fueAjustado('empresa') || this.fueAjustado('direccion') || this.fueAjustado('temporal');
  }

  /** Vuelve a poner los tres campos como los dejó el centro de costo. */
  restaurarHeredados(): void {
    if (!this.heredado) return;
    this.vacanteForm.patchValue({
      empresaUsuariaSolicita: this.heredado.empresa || null,
      direccion: this.heredado.direccion || null,
      temporal: this.heredado.temporal || null,
    });
    this.cdr.markForCheck();
  }

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
        empresaUsuariaSolicita: ['', Validators.required],
        temporal: ['', Validators.required],
        direccion: ['', Validators.required],

        experiencia: ['', Validators.required],
        observacionVacante: [''],
        descripcion: ['', Validators.required],
        fechaPublicado: [new Date()],
        quienpublicolavacante: [
          `${this.user?.datos_basicos?.nombres ?? ''} ${this.user?.datos_basicos?.apellidos ?? ''}`.trim(),
        ],
        estadovacante: ['Activa'],
        salario: [1750905, [Validators.required, Validators.min(0)]],
        codigoElite: [''],

        // Condicional 1: Fecha de ingreso
        tieneFechaIngreso: ['No', Validators.required],
        fechadeIngreso: [{ value: null, disabled: true }],

        // Condicional 2: Prueba o Contratación
        pruebaOContratacion: ['', Validators.required],
        fechadePruebatecnica: [{ value: null, disabled: true }],
        horadePruebatecnica: [{ value: '', disabled: true }],
        ubicacionPruebaTecnica: [{ value: '', disabled: true }],

        tipoContratacion: ['', Validators.required],

        municipio: [[], Validators.required],
        barrio: [''],

        personasSolicitadas: [null, [Validators.required, Validators.min(1)]],
        municipiosDistribucion: this.fb.array<DistMunGroup>([]),

        auxilioTransporte: [0, [Validators.required]],
        area: ['', Validators.required],

        // Oficinas
        oficinasSeleccionadas: [[], Validators.required],
        oficinasQueContratan: this.fb.array([]),
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
        this.cdr.markForCheck();
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
        this.cdr.markForCheck();
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
          this.cdr.markForCheck();
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
        this.cdr.markForCheck();
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
        this.cdr.markForCheck();
      });

    this.municipioCtrl.valueChanges.pipe(startWith(''), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.filtrarMunicipios());

    // --------- SYNC: municipio[] => municipiosDistribucion[] ----------
    this.vacanteForm
      .get('municipio')!
      .valueChanges.pipe(startWith(this.vacanteForm.get('municipio')!.value), takeUntilDestroyed(this.destroyRef))
      .subscribe((actual: unknown) => this.syncDistribucionConSeleccion(Array.isArray(actual) ? actual : []));

    // ✅ Revalida si cambia el total
    this.vacanteForm
      .get('personasSolicitadas')!
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
    this.applyPruebaContratacion(String(this.vacanteForm.get('pruebaOContratacion')!.value ?? ''));
    this.vacanteForm
      .get('pruebaOContratacion')!
      .valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((v: unknown) => this.applyPruebaContratacion(String(v ?? '')));
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
      String(this.vacanteForm.get('pruebaOContratacion')?.value ?? '') === this.CONTRATACION;

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
    const hPrueba = this.vacanteForm.get('horadePruebatecnica')!;
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
    const total = Number(this.vacanteForm.get('personasSolicitadas')!.value) || 0;
    return Math.max(0, total - this.totalAsignado);
  }

  // ✅ Error 1: no exceder el total
  private sumNoExcedeTotalValidator(): ValidatorFn {
    return (group: AbstractControl) => {
      const total = Number(group.get('personasSolicitadas')?.value) || 0;
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
      const total = Number(group.get('personasSolicitadas')?.value) || 0;
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
      empresaUsuariaSolicita: v?.empresaUsuariaSolicita ?? '',
      direccion: v?.direccion ?? '',
      temporal: v?.temporal ?? '',
      experiencia: v?.experiencia ?? '',
      observacionVacante: v?.observacion ?? '',

      tieneFechaIngreso: v?.fechadeIngreso ? this.SI : 'No',
      fechadeIngreso: this.parseApiDate(v?.fechadeIngreso),

      descripcion: v?.descripcion ?? '',
      fechaPublicado: this.parseApiDate(v?.fechaPublicado) ?? new Date(),

      quienpublicolavacante: v?.quienpublicolavacante ?? '',
      estadovacante: v?.estadovacante ?? 'Activa',
      salario: v?.salario ?? 1750905,
      codigoElite: v?.codigoElite ?? '',

      oficinasSeleccionadas: Array.isArray(v?.oficinasQueContratan)
        ? v.oficinasQueContratan.map((o: any) => o?.nombre)
        : [],

      pruebaOContratacion: v?.pruebaOContratacion ?? '',
      fechadePruebatecnica: this.parseApiDate(v?.fechadePruebatecnica),

      horadePruebatecnica: v?.horadePruebatecnica ?? '',
      ubicacionPruebaTecnica: v?.ubicacionPruebaTecnica ?? '',
      tipoContratacion: v?.tipoContratacion ?? '',
      municipio: Array.isArray(v?.municipio) ? v.municipio : [],
      auxilioTransporte: v?.auxilioTransporte ?? 0,
      personasSolicitadas: v?.personasSolicitadas ?? null,
    });

    // Oficinas
    const fa = this.oficinasQueContratan;
    fa.clear();
    (Array.isArray(v?.oficinasQueContratan) ? v.oficinasQueContratan : []).forEach((o: any) =>
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

    this.syncFechaIngreso();
    this.applyPruebaContratacion(String(this.vacanteForm.get('pruebaOContratacion')!.value ?? ''));

    this.vacanteForm.updateValueAndValidity({ emitEvent: false });
  }


  // ---------- Helpers ----------
  private _filter(value: string, list: string[]): string[] {
    const filterValue = (value || '').toLowerCase();
    return (list || []).filter((item) => item.toLowerCase().includes(filterValue));
  }

  get oficinasQueContratan(): FormArray {
    return this.vacanteForm.get('oficinasQueContratan') as FormArray;
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
    const nombre = (event.option.value || '').toString();
    if (!nombre) return;

    this.fincasService
      .getFincaByNombre(nombre)
      .pipe(catchError(() => of(undefined)))
      .subscribe((finca: FincaItem | undefined) => {
        const temporalCanon = this.canonicalTemporal(finca?.temporal);

        this.vacanteForm.patchValue({
          empresaUsuariaSolicita: finca?.empresa ?? null,
          direccion: finca?.direccion ?? null,
          temporal: temporalCanon,
        });

        // Guardamos de dónde vino y con qué valores, para poder mostrar la
        // procedencia y detectar después un ajuste manual.
        this.heredadoDe = nombre;
        this.heredado = {
          empresa: (finca?.empresa ?? '').toString(),
          direccion: (finca?.direccion ?? '').toString(),
          temporal: (temporalCanon ?? '').toString(),
        };
        // `temporal` es un mat-select: su valor lo escribe el CVA, pero el
        // texto visible del trigger sí depende de un ciclo de detección.
        this.cdr.markForCheck();
      });
  }

  actualizarOficinasQueContratan(seleccionadas: any[]): void {
    const formArray = this.oficinasQueContratan;
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
    this.oficinasQueContratan.removeAt(index);
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
