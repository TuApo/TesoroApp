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
import { SmartSelectComponent } from '../smart-select/smart-select.component';
import { MatIconModule } from '@angular/material/icon';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule, MAT_DATE_FORMATS, DateAdapter, MAT_DATE_LOCALE } from '@angular/material/core';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
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
import {
  OpcionCentro,
  OpcionEmpresa,
  OpcionTemporal,
  VacancyCascadeService,
  canonicalTemporal,
  ResultadoLabor,
} from '../../service/vacancy-cascade/vacancy-cascade.service';
import {
  CargoAutorizado,
  ParametrizacionVacantesService,
} from '../../../users/services/parametrizacion-vacantes/parametrizacion-vacantes.service';

/**
 * Los once perfiles de vacante que vivían cableados aquí. Se conservan como respaldo del
 * catálogo, no como fuente: la fuente es «Perfil vacante» del parametrizador, y la
 * migración V90 de ms-auth-admin los sembró con estos mismos valores y en este orden.
 */
const AREAS_DE_RESPALDO: string[] = [
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

const TIPOS_CONTRATACION = [
  'Obra Labor',
  'Fijo Inferior a un año',
  'Fijo a un año',
  'Indefinido',
];

/** Lo único que puede fijar el rol restringido. */
const TIPO_UNICO_CONTRATACION = 'Obra Labor';
const ROL_RESTRINGIDO = 'CONTRATACION';
/** Roles que levantan la limitación. Espejo de `PublicacionController`. */
const ROLES_SIN_LIMITE = ['ADMIN', 'GERENCIA', 'JEFE-DE-AREA'];

/**
 * "Rosa, Clavel" → ['Rosa', 'Clavel'].
 *
 * La vacante guarda el texto, así que al reabrirla hay que partirlo. Se parte por coma
 * porque es como se une al guardar; ningún perfil del catálogo lleva coma en el nombre.
 */
function partirPerfiles(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x ?? '').trim()).filter(Boolean);
  return String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
}

/** Nombre visible de cada control, para los avisos de la cabecera de sección. */
const ETIQUETAS_CAMPO: Record<string, string> = {
  codigo_elite: 'Código Bot',
  area_operativa_codigo: 'Área operativa',
  ubicacionPruebaTecnica: 'Ubicación de la prueba',
  empresa_ref: 'Empresa usuaria',
};

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
    MatDatepickerModule,
    MatNativeDateModule,
    MatAutocompleteModule,
    FormsModule,
    MatChipsModule,
    MatTooltipModule,
    SmartSelectComponent,
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

  // ── Cascada: Temporal → Empresa → Centro de costo → (Area) → Cargo ────────
  temporales: OpcionTemporal[] = [];
  empresas: OpcionEmpresa[] = [];
  centros: OpcionCentro[] = [];
  areasOperativas: Array<{ id: number; codigo: string; nombre: string | null }> = [];
  cargosAutorizados: CargoAutorizado[] = [];

  /** Temporal elegida. Decide de donde salen empresas y centros. */
  temporalSel: OpcionTemporal | null = null;
  /** Centro elegido, con sus datos ya resueltos. */
  centroSel: OpcionCentro | null = null;

  /**
   * Codigo funcional cuando el backend NO puede resolver la labor de un centro
   * parametrizado (CONFIGURACION_NO_ENCONTRADA / REGLA_LABOR_NO_ENCONTRADA / ...).
   * Se pinta junto al campo de descripcion. `null` = no hay nada que advertir.
   */
  errorLabor: string | null = null;
  /** El centro encadena por area antes del cargo. Lo dicen los datos del centro. */
  modoPorArea = false;
  /** Hay peticiones de la cascada en vuelo. */
  cargandoCascada = false;

  /** true si la temporal elegida tiene alcance en el parametrizador. */
  get parametrizada(): boolean {
    return !!this.temporalSel?.parametrizada;
  }

  /**
   * Si el cargo se elige de la lista de AUTORIZADOS o del autocompletado libre.
   *
   * Manda la lista autorizada siempre que el centro esté parametrizado. La
   * excepción son los centros habilitados a los que todavía nadie les cargó
   * configuraciones —hoy 4 de los 45—: ahí la lista sale vacía y quedarse en
   * ella dejaría el centro inservible, así que se cae al autocompletado de
   * siempre. Es una válvula de escape, no el camino normal: en cuanto se
   * parametricen, esos centros pasan solos a la lista.
   */
  get usarCargoAutorizado(): boolean {
    if (!this.centroSel?.id) return false;
    if (this.cargandoCascada) return true;
    // Falta elegir área: los cargos aún no se pueden pedir, pero el desplegable
    // correcto ya es el de autorizados.
    if (this.modoPorArea && !this.vacanteForm?.get('area_operativa_codigo')?.value) return true;
    return this.cargosAutorizados.length > 0;
  }

  municipiosColombia: string[] = [];

  /**
   * Línea de flor del desplegable «Área».
   *
   * Sale del catálogo «Perfil vacante» del parametrizador. Esta lista de aquí es solo el
   * PLAN B: son los mismos once valores que estaban cableados antes, y se usan si la
   * petición falla. Sin ese plan B, un parametrizador caído dejaría el campo vacío y,
   * como es obligatorio, no se podría publicar ninguna vacante.
   */
  areas: string[] = AREAS_DE_RESPALDO;

  today: Date = new Date();

  private prevMunicipios: string[] = [];


  // ==========================================================================
  // PROCEDENCIA DE LOS DATOS QUE TRAE EL CENTRO DE COSTO
  // ==========================================================================
  /*
   * `aplicarCentro` rellena empresa, direccion y —cuando la fuente los da sin
   * ambiguedad— salario y auxilio de transporte. En la pantalla vieja eso era
   * invisible: campos identicos al resto que "se llenaban solos", sin decir de
   * donde ni si podian tocarse. El formulario los agrupa, dice de que centro
   * vienen y marca el que se haya ajustado a mano, para que la diferencia con
   * su ficha se vea ANTES de guardar.
   *
   * La temporal ya NO se hereda del centro: es el PRIMER campo del formulario y
   * lo que decide que centros hay para elegir.
   */

  /** Centro de costo que rellenó los campos. `null` = todavía ninguno. */
  heredadoDe: string | null = null;

  /**
   * Campos que trae la ficha del centro de costo.
   *
   * Los que la ficha SÍ trae se bloquean: la vacante no es el sitio para
   * cambiar la dirección o el salario de un centro. Antes se podían editar y
   * solo se marcaban como "ajustado a mano", que es como decir que el dato de
   * la vacante y el de la ficha podían discrepar sin que nadie lo revisara.
   *
   * Los que la ficha deja en blanco quedan ABIERTOS: el maestro no siempre da
   * salario ni auxilio —cuando sus subcentros no coinciden llegan en null— y
   * alguien tiene que poder completarlos.
   *
   * Bloquear no es esconder: `getRawValue()` incluye los deshabilitados, así
   * que el valor viaja igual en el payload.
   */
  readonly CAMPOS_HEREDADOS = ['empresa_usuaria_solicita', 'direccion', 'salario', 'auxilio_transporte'] as const;

  /** Campos heredados que quedaron abiertos porque la ficha no los trae. */
  private abiertos = new Set<string>();

  /** true si alguno quedó abierto; lo dice el rótulo del bloque. */
  get hayHeredadosAbiertos(): boolean {
    return this.abiertos.size > 0;
  }

  /** Texto bajo un campo heredado. */
  ayudaHeredado(control: string): string | undefined {
    if (!this.heredadoDe) return undefined;
    return this.abiertos.has(control) ? 'Su ficha no lo trae: complétalo aquí' : undefined;
  }

  /**
   * Bloquea lo que la ficha del centro trae y abre lo que deja en blanco.
   *
   * `emitEvent: false` en las dos direcciones: habilitar o deshabilitar emite
   * `valueChanges`, y eso volvería a disparar la sugerencia de descripción en
   * cadena por cada campo.
   */
  private aplicarBloqueoHeredados(centro: OpcionCentro | null): void {
    this.abiertos.clear();

    const trae: Record<string, boolean> = {
      empresa_usuaria_solicita: !!(centro?.empresa ?? '').toString().trim(),
      direccion: !!(centro?.direccion ?? '').toString().trim(),
      salario: centro?.salario != null && Number(centro.salario) > 0,
      auxilio_transporte: centro?.auxilio_transporte != null,
    };

    for (const nombre of this.CAMPOS_HEREDADOS) {
      const ctrl = this.vacanteForm.get(nombre);
      if (!ctrl) continue;
      if (centro && trae[nombre]) {
        ctrl.disable({ emitEvent: false });
      } else {
        ctrl.enable({ emitEvent: false });
        if (centro) this.abiertos.add(nombre);
      }
    }
  }

  /** Sin centro elegido, todo vuelve a estar abierto. */
  private liberarHeredados(): void {
    this.aplicarBloqueoHeredados(null);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ACCESORES PARA `app-smart-select`
  // ──────────────────────────────────────────────────────────────────────────
  // Son campos de clase con función flecha, no métodos: el selector los recibe
  // como @Input y los invoca por su cuenta, así que necesitan el `this` atado.
  // Se declaran aquí, juntos, para poder leer de un vistazo qué se guarda, qué
  // se muestra y por qué se distingue cada opción.

  /** Opciones simples {valor,label} de los desplegables cerrados. */
  readonly OPC_SI_NO = [
    { valor: 'Si', label: 'Sí' },
    { valor: 'No', label: 'No' },
  ];
  readonly OPC_EXPERIENCIA = [
    { valor: 'SI', label: 'Sí' },
    { valor: 'NO', label: 'No' },
    { valor: 'AMBAS', label: 'Ambas' },
  ];
  /**
   * Tipos de contratación que este usuario puede fijar.
   *
   * CONTRATACION es el rol más bajo del proceso: publica, pero solo por Obra Labor.
   * Los demás tipos comprometen a la empresa más allá de lo que ese rol decide.
   *
   * Ocultar las opciones es la mitad del trabajo; la otra la hace ms-automation, que
   * rechaza el guardado con un 400 aunque alguien mande el POST a mano. Si se cambia
   * esta lista hay que cambiar también la del `PublicacionController`.
   */
  OPC_TIPO_CONTRATACION: string[] = TIPOS_CONTRATACION;

  /** true si al usuario solo le corresponde Obra Labor; lo dice la nota del campo. */
  rolSoloObraLabor = false;

  /**
   * Recorta los tipos de contratación al alcance del rol.
   *
   * El valor YA guardado se conserva en la lista aunque el rol no pudiera elegirlo: si
   * alguien de CONTRATACION abre una vacante antigua marcada "Indefinido", quitarle la
   * opción dejaría el campo en blanco y el guardado bloqueado por obligatorio. El
   * backend tampoco se queja mientras el valor no cambie.
   */
  private aplicarAlcanceDeTipos(guardado?: string | null): void {
    this.rolSoloObraLabor = this.soloObraLabor();
    if (!this.rolSoloObraLabor) {
      this.OPC_TIPO_CONTRATACION = TIPOS_CONTRATACION;
      return;
    }
    const permitidos = [TIPO_UNICO_CONTRATACION];
    const actual = String(guardado ?? '').trim();
    if (actual && !permitidos.includes(actual)) permitidos.push(actual);
    this.OPC_TIPO_CONTRATACION = permitidos;
  }

  /** Roles del usuario, normalizados. Tolera `rol` suelto o la lista `roles`. */
  private soloObraLabor(): boolean {
    const crudo = this.user?.rol ?? this.user?.roles ?? [];
    const lista: any[] = Array.isArray(crudo) ? crudo : [crudo];
    const roles = lista
      .map((r) => (typeof r === 'string' ? r : r?.nombre))
      .filter(Boolean)
      .map((r: string) => r.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim());

    if (!roles.length) return false;
    if (roles.some((r) => ROLES_SIN_LIMITE.includes(r))) return false;
    return roles.includes(ROL_RESTRINGIDO);
  }
  readonly OPC_VINCULACION = [
    { valor: 'Prueba', label: 'Prueba técnica' },
    { valor: 'Contratación', label: 'Contratación inmediata' },
  ];

  valorOpcion = (o: { valor: string; label: string }) => o.valor;
  etiquetaOpcion = (o: { valor: string; label: string }) => o.label;

  valorTemporal = (t: OpcionTemporal) => t.valor;
  etiquetaTemporal = (t: OpcionTemporal) => t.label;
  /** Se avisa aquí de que la temporal aún no tiene parametrización propia. */
  detalleTemporal = (t: OpcionTemporal) =>
    t.parametrizada ? null : 'Sin parametrizar · los centros salen del maestro';

  valorEmpresa = (e: OpcionEmpresa) => e.ref;
  etiquetaEmpresa = (e: OpcionEmpresa) => e.nombre;

  valorCentro = (c: OpcionCentro) => c.clave;
  etiquetaCentro = (c: OpcionCentro) => c.label;
  /** La empresa es lo que distingue dos fincas homónimas. */
  detalleCentro = (c: OpcionCentro) => c.empresa;

  valorArea = (a: { id: number; codigo: string; nombre: string | null }) => a.codigo;
  etiquetaArea = (a: { id: number; codigo: string; nombre: string | null }) => a.nombre || a.codigo;
  detalleArea = (a: { id: number; codigo: string; nombre: string | null }) => a.codigo;

  valorCargo = (c: CargoAutorizado) => c.cargo_nombre;
  etiquetaCargo = (c: CargoAutorizado) => c.cargo_nombre;
  /** Qué esquema de labor le aplica; es lo que decide la descripción. */
  detalleCargo = (c: CargoAutorizado) =>
    c.esquema_codigo ? `Esquema ${c.esquema_codigo}` : 'Sin esquema de labor';

  valorSede = (s: { nombre: string }) => s.nombre;
  etiquetaSede = (s: { nombre: string }) => s.nombre;

  /** Texto de apoyo del selector de empresa. */
  get ayudaEmpresa(): string | undefined {
    if (!this.temporalSel) return 'Elige primero la temporal.';
    return undefined;
  }

  /** Texto de apoyo del selector de centro de costo. */
  get ayudaCentro(): string | undefined {
    if (!this.temporalSel) return 'Elige primero la temporal.';
    if (this.parametrizada && !this.vacanteForm?.get('empresa_ref')?.value) {
      return 'Elige primero la empresa.';
    }
    return undefined;
  }

  /** Texto de apoyo del selector de cargo. */
  get ayudaCargo(): string | undefined {
    if (this.modoPorArea && !this.vacanteForm?.get('area_operativa_codigo')?.value) {
      return 'Elige primero el área operativa.';
    }
    if (this.centroSel?.id && !this.usarCargoAutorizado) {
      return 'Este centro aún no tiene cargos parametrizados: se usa el maestro de cargos.';
    }
    return undefined;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SECCIONES: AVANCE Y COLAPSO
  // ──────────────────────────────────────────────────────────────────────────
  // El formulario tiene 18 campos repartidos en cinco secciones y no cabe en una
  // pantalla. Cada cabecera dice CUANTO le falta y se puede plegar, para poder
  // cerrar lo que ya está resuelto y seguir trabajando en lo que no.
  //
  // El avance se calcula sobre los controles REALES, no sobre una lista de
  // porcentajes escrita a mano: un campo que se deshabilita —la fecha de prueba
  // cuando se elige contratación inmediata, o el salario que trae bloqueado la
  // ficha del centro— cambia solo lo que la barra cuenta, sin tocar esto.

  /** Qué controles mira cada sección. `extra` son reglas que no son un control. */
  private readonly SECCIONES: ReadonlyArray<{ id: number; controles: string[] }> = [
    { id: 1, controles: ['temporal', 'centro_clave', 'empresa_usuaria_solicita', 'direccion', 'salario', 'auxilio_transporte'] },
    { id: 2, controles: ['cargo', 'area_operativa_codigo', 'area', 'personas_solicitadas', 'tipo_contratacion', 'experiencia', 'codigo_elite', 'descripcion'] },
    { id: 3, controles: ['prueba_ocontratacion', 'fechadeIngreso', 'fechadePruebatecnica', 'horade_pruebatecnica', 'ubicacionPruebaTecnica'] },
    { id: 4, controles: ['municipio'] },
    { id: 5, controles: ['oficinasSeleccionadas'] },
  ];

  /** Secciones plegadas. Todas empiezan abiertas. */
  private plegadas = new Set<number>();

  estaPlegada(id: number): boolean {
    return this.plegadas.has(id);
  }

  alternarSeccion(id: number): void {
    if (this.plegadas.has(id)) this.plegadas.delete(id);
    else this.plegadas.add(id);
  }

  /**
   * Avance de una sección: obligatorios resueltos sobre obligatorios que aplican.
   *
   * Un control DESHABILITADO con valor cuenta como resuelto —es el caso de lo que
   * trae bloqueado la ficha del centro—, y uno deshabilitado y vacío no cuenta
   * para nada: no aplica en este momento del formulario.
   *
   * Sin obligatorios que aplicar la sección va al 100%: no hay nada que exigir.
   */
  avanceSeccion(id: number): number {
    const { hechos, total } = this.cuentaObligatorios(id);
    if (!total) return 100;
    return Math.round((hechos / total) * 100);
  }

  private cuentaObligatorios(id: number): { hechos: number; total: number } {
    let hechos = 0;
    let total = 0;
    for (const nombre of this.controlesDe(id)) {
      const ctrl = this.vacanteForm.get(nombre);
      if (!ctrl) continue;
      const bloqueadoConValor = ctrl.disabled && this.tieneValor(ctrl);
      if (ctrl.disabled && !bloqueadoConValor) continue;
      if (!bloqueadoConValor && !this.esObligatorio(ctrl)) continue;
      total++;
      if (this.tieneValor(ctrl)) hechos++;
    }
    // La sección 4 no se resuelve con que haya municipios: el reparto tiene que
    // sumar exactamente el total pedido, que es lo que valida el formulario.
    if (id === 4) {
      total++;
      if (this.municipiosDistribucion.length && this.restante === 0 && this.totalAsignado > 0) hechos++;
    }
    return { hechos, total };
  }

  /**
   * Campos OPCIONALES de la sección que se dejaron vacíos.
   *
   * Es el aviso en ámbar: la sección está completa —no impide guardar— pero se
   * publica sin un dato que sí se podía dar.
   */
  opcionalesVacios(id: number): string[] {
    const out: string[] = [];
    for (const nombre of this.controlesDe(id)) {
      const ctrl = this.vacanteForm.get(nombre);
      if (!ctrl || ctrl.disabled) continue;
      if (this.esObligatorio(ctrl)) continue;
      if (!this.tieneValor(ctrl)) out.push(ETIQUETAS_CAMPO[nombre] ?? nombre);
    }
    return out;
  }

  /** Estado de la barra: en curso, completa, o completa con huecos opcionales. */
  estadoSeccion(id: number): 'curso' | 'aviso' | 'lista' {
    if (this.avanceSeccion(id) < 100) return 'curso';
    return this.opcionalesVacios(id).length ? 'aviso' : 'lista';
  }

  /** Texto del tooltip de la cabecera. */
  detalleSeccion(id: number): string {
    const { hechos, total } = this.cuentaObligatorios(id);
    const faltan = this.opcionalesVacios(id);
    const partes = [total ? `Obligatorios: ${hechos} de ${total}` : 'Sin campos obligatorios'];
    if (faltan.length) partes.push(`Sin llenar (opcional): ${faltan.join(', ')}`);
    return partes.join('\n');
  }

  // ── Avance GLOBAL, el de la cabecera del diálogo ─────────────────────────
  //
  // Se suman los obligatorios de TODAS las secciones, no se promedian sus
  // porcentajes: una sección con un solo campo pesaría lo mismo que otra con
  // siete, y el número diría cualquier cosa menos cuánto falta de verdad.

  avanceGlobal(): number {
    const { hechos, total } = this.totalObligatorios();
    if (!total) return 100;
    return Math.round((hechos / total) * 100);
  }

  estadoGlobal(): 'curso' | 'aviso' | 'lista' {
    if (this.avanceGlobal() < 100) return 'curso';
    return this.opcionalesVaciosTodos().length ? 'aviso' : 'lista';
  }

  /** Rótulo corto junto al porcentaje. */
  rotuloGlobal(): string {
    switch (this.estadoGlobal()) {
      case 'lista': return 'Listo para guardar';
      case 'aviso': return 'Listo · con campos vacíos';
      default: return 'En progreso';
    }
  }

  detalleGlobal(): string {
    const { hechos, total } = this.totalObligatorios();
    const faltan = this.opcionalesVaciosTodos();
    const partes = [`Obligatorios: ${hechos} de ${total}`];
    if (faltan.length) partes.push(`Sin llenar (opcional): ${faltan.join(', ')}`);
    return partes.join('\n');
  }

  private totalObligatorios(): { hechos: number; total: number } {
    let hechos = 0;
    let total = 0;
    for (const s of this.SECCIONES) {
      const c = this.cuentaObligatorios(s.id);
      hechos += c.hechos;
      total += c.total;
    }
    return { hechos, total };
  }

  private opcionalesVaciosTodos(): string[] {
    return this.SECCIONES.flatMap((s) => this.opcionalesVacios(s.id));
  }

  private controlesDe(id: number): string[] {
    return this.SECCIONES.find((s) => s.id === id)?.controles ?? [];
  }

  private esObligatorio(ctrl: AbstractControl): boolean {
    const c = ctrl as any;
    return typeof c.hasValidator === 'function' && c.hasValidator(Validators.required);
  }

  private tieneValor(ctrl: AbstractControl): boolean {
    const v = ctrl.value;
    if (v === null || v === undefined) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'number') return true;
    return String(v).trim() !== '';
  }

  constructor(
    private fb: FormBuilder,
    private http: HttpClient,
    public dialogRef: MatDialogRef<CrearEditarVacanteComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any,
    private adminService: UtilityServiceService,
    private vacantesService: VacantesService, // (queda por si lo usas luego)
    private positionsService: PositionsService,
    private cascada: VacancyCascadeService,
    private param: ParametrizacionVacantesService,
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
        // La TEMPORAL es el primer eslabon: decide que empresas y que centros
        // de costo se ofrecen. Va antes que nada en la plantilla.
        temporal: ['', Validators.required],
        // Referencia de la empresa dentro del alcance de vacantes. Solo se usa
        // para encadenar; lo que se guarda en la vacante es el NOMBRE, que
        // sigue viviendo en `empresa_usuaria_solicita`.
        empresa_ref: [null as number | null],
        // id del centro en el parametrizador. `null` cuando el centro viene del
        // maestro (temporal sin alcance) o cuando se edita una vacante vieja.
        centro_costo_id: [null as number | null],
        // Lo que selecciona el desplegable de centro. NO es el nombre: dentro de
        // una misma temporal hay fincas homonimas de empresas distintas
        // (ADMINISTRACION CENTRAL esta en tres de Apoyo) y elegir por nombre
        // llenaba la vacante con los datos de la empresa equivocada.
        centro_clave: ['', Validators.required],

        cargo: ['', Validators.required],
        finca: ['', Validators.required],
        empresa_usuaria_solicita: ['', Validators.required],
        direccion: ['', Validators.required],

        experiencia: ['', Validators.required],
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
        // Linea de flor ('Rosa', 'Clavel'...). NO confundir con el area
        // OPERATIVA de abajo: la entidad Publicacion las guarda por separado y
        // su propio comentario avisa de que no deben mezclarse.
        // "Perfil vacante": ahora admite VARIAS. Se guarda como texto separado por
        // coma en la misma columna `area`, que es como ya lo leen todos sus
        // consumidores (el cruce de ms-hr, los formatos Excel y la Remisión).
        area: [[] as string[], Validators.required],
        // Area OPERATIVA del parametrizador ('CU', 'PO', 'AD'...), el
        // vocabulario con el que se resuelve la labor. Solo aplica a los centros
        // que trabajan por area; en el resto queda en null.
        area_operativa_codigo: [null as string | null],
        area_operativa_id: [null as number | null],

        // Trazabilidad de la labor resuelta (columnas V13 de db_automation). Las
        // llena `resolverLabor`; si no hay parametrizacion se quedan en null y la
        // descripcion la propone la hoja de labores de siempre.
        configuracion_centro_cargo_id: [null as number | null],
        regla_labor_id: [null as number | null],
        labor_codigo_snapshot: [null as string | null],
        labor_descripcion_snapshot: [null as string | null],
        esquema_labor_codigo: [null as string | null],
        labor_origen_resolucion: [null as string | null],

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

    this.aplicarAlcanceDeTipos(this.data?.tipo_contratacion);

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

    // --------- PERFILES DE FLOR: catálogo del desplegable «Área» ----------
    this.param
      .listarPerfilesVacante(true)
      .pipe(catchError(() => of([])), takeUntilDestroyed(this.destroyRef))
      .subscribe((lista) => {
        const nombres = (lista ?? []).map((p) => String(p?.nombre ?? '').trim()).filter(Boolean);
        // Un catálogo vacío también cae al respaldo: dejar el desplegable sin
        // opciones bloquearía la publicación, porque el campo es obligatorio.
        if (nombres.length) this.areas = nombres;
      });

    // --------- TEMPORALES: primer eslabon de la cascada ----------
    this.cascada
      .listarTemporales()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((lista: OpcionTemporal[]) => {
        this.temporales = lista ?? [];
        // Al editar, la vacante ya trae su temporal: se reengancha la opcion del
        // catalogo para saber si esa temporal esta parametrizada y poder bajar
        // por la cascada sin obligar a volver a elegirla.
        const actual = String(this.vacanteForm.get('temporal')?.value ?? '');
        if (actual) this.engancharTemporal(actual, { conservarSeleccion: true });
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

      });

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
    this.vacanteForm
      .get('fechadeIngreso')!
      .valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        // El validador vive en el control de la prueba y Angular no lo vuelve a
        // correr porque cambie su hermana: hay que pedírselo.
        this.vacanteForm.get('fechadePruebatecnica')!.updateValueAndValidity({ emitEvent: false });
        this.vacanteForm.get('tieneFechaIngreso')!
          .setValue(this.vacanteForm.get('fechadeIngreso')!.value ? this.SI : 'No', { emitEvent: false });
      });

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
    const opcion = String(this.vacanteForm.get('prueba_ocontratacion')?.value ?? '');
    const esContratacion = opcion === this.CONTRATACION;
    const esPrueba = opcion === this.PRUEBA;

    const ctrl = this.vacanteForm.get('fechadeIngreso')!;

    // La fecha de ingreso aparece en LAS DOS opciones, pero no manda lo mismo:
    //   · Contratación inmediata → OBLIGATORIA, la persona entra de una vez.
    //   · Prueba técnica         → OPCIONAL. Muchas veces la fecha de ingreso ya
    //     se conoce al programar la prueba; poder anotarla aquí es lo que permite
    //     comprobar que la prueba no cae después del ingreso.
    if (esContratacion || esPrueba) {
      ctrl.enable({ emitEvent: false });
      ctrl.setValidators(esContratacion ? [Validators.required] : []);
    } else {
      ctrl.reset(null, { emitEvent: false });   // borra el dato al cambiar de opción
      ctrl.clearValidators();
      ctrl.disable({ emitEvent: false });
    }
    ctrl.updateValueAndValidity({ emitEvent: false });

    // Toggle oculto, coherente con el payload (Si/No). Ya no depende de la opción
    // sino de si hay fecha: en Prueba puede haberla o no.
    this.vacanteForm.get('tieneFechaIngreso')!
      .setValue(ctrl.value ? this.SI : 'No', { emitEvent: false });
  }

  private applyPruebaContratacion(valor: string): void {
    const fPrueba = this.vacanteForm.get('fechadePruebatecnica')!;
    const hPrueba = this.vacanteForm.get('horade_pruebatecnica')!;
    const uPrueba = this.vacanteForm.get('ubicacionPruebaTecnica')!;

    if (valor === this.PRUEBA) {
      fPrueba.enable({ emitEvent: false });
      fPrueba.setValidators([Validators.required, this.pruebaNoPosteriorAIngreso()]);

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

  /**
   * La prueba técnica no puede ser POSTERIOR a la fecha de ingreso.
   *
   * Va como validador del propio control de la prueba —y no del formulario— para
   * que el mensaje salga debajo de ese campo, que es donde el usuario tiene que
   * corregir. Un error a nivel de grupo no lo pinta `mat-error`.
   *
   * Sin una de las dos fechas no hay nada que comparar: en Prueba técnica la de
   * ingreso es opcional y lo normal es que falte.
   */
  private pruebaNoPosteriorAIngreso(): ValidatorFn {
    return (ctrl: AbstractControl) => {
      const grupo = ctrl.parent;
      if (!grupo) return null;

      const ingreso = this.soloDia(grupo.get('fechadeIngreso')?.value);
      const prueba = this.soloDia(ctrl.value);
      if (!ingreso || !prueba) return null;

      return prueba.getTime() > ingreso.getTime() ? { pruebaDespuesDeIngreso: true } : null;
    };
  }

  /**
   * Fecha sin hora, para comparar días completos.
   *
   * El primer caso es el importante: este diálogo usa `MomentDateAdapter`, así que
   * lo que devuelve el calendario NO es un `Date` sino un Moment. Sin este `toDate`
   * la comparación caía en el parseo por texto, que funciona de milagro y no hay
   * por qué dejarlo así.
   */
  private soloDia(v: unknown): Date | null {
    if (v && typeof (v as any).toDate === 'function') {
      return this.stripTime((v as any).toDate());
    }
    const d = this.parseApiDate(v);
    return d ? this.stripTime(d) : null;
  }

  /**
   * Tope del calendario de la prueba: la fecha de ingreso, si ya se eligió.
   *
   * El validador es la red de seguridad; esto evita llegar a él, porque los días
   * posteriores al ingreso ni siquiera se pueden pulsar.
   */
  get topeFechaPrueba(): Date | null {
    return this.soloDia(this.vacanteForm?.get('fechadeIngreso')?.value);
  }

  /**
   * ¿La fecha de ingreso es obligatoria? Solo en contratación inmediata.
   *
   * Se ata al `[required]` del campo en vez de dejar que `mat-form-field` lo
   * deduzca de los validadores: así el asterisco dice exactamente lo mismo que
   * la regla, sin depender de cuándo se recalculan los validadores.
   */
  get ingresoObligatorio(): boolean {
    return String(this.vacanteForm?.get('prueba_ocontratacion')?.value ?? '') === this.CONTRATACION;
  }

  /** Suelo del calendario de ingreso: la fecha de la prueba, si ya se eligió. */
  get sueloFechaIngreso(): Date | null {
    return this.soloDia(this.vacanteForm?.get('fechadePruebatecnica')?.value);
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

  /** YYYY-MM-DD para el backend, venga como Date o como texto ya formateado. */
  private aYmd(fecha: Date | string): string {
    if (fecha instanceof Date) return this.toYmdLocal(fecha) ?? '';
    return this.toYmdLocal(this.parseApiDate(fecha)) ?? '';
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
      // Viene como texto separado por coma; se parte para el selector múltiple.
      area: partirPerfiles(v?.area),
      finca: v?.finca ?? '',
      empresa_usuaria_solicita: v?.empresa_usuaria_solicita ?? '',
      direccion: v?.direccion ?? '',
      temporal: v?.temporal ?? '',
      experiencia: v?.experiencia ?? '',

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

      // Cascada + traza de la labor. Se reponen tal cual estaban: editar una
      // vacante sin volver a tocar el cargo NO debe reescribir su snapshot, que
      // es lo que explica de dónde salió la descripción que ya se publicó.
      // La Publicacion no guarda el id del centro: se reengancha por NOMBRE
      // contra la lista que trae la cascada (ver `conCentroGuardado`).
      centro_costo_id: null,
      area_operativa_codigo: v?.area_operativa_codigo ?? null,
      configuracion_centro_cargo_id: v?.configuracion_centro_cargo_id ?? null,
      regla_labor_id: v?.regla_labor_id ?? null,
      labor_codigo_snapshot: v?.labor_codigo_snapshot ?? null,
      labor_descripcion_snapshot: v?.labor_descripcion_snapshot ?? null,
      esquema_labor_codigo: v?.esquema_labor_codigo ?? null,
      labor_origen_resolucion: v?.labor_origen_resolucion ?? null,
    });

    // Oficinas
    const fa = this.oficinas_que_contratan;
    fa.clear();
    (Array.isArray(v?.oficinas_que_contratan) ? v.oficinas_que_contratan : []).forEach((o: any) =>
      fa.push(this.fb.group({ nombre: [o?.nombre ?? '', Validators.required] }))
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

    // La vacante ya trae empresa, dirección y centro guardados: no se vuelven a
    // pedir al abrir. Los desplegables de la cascada se rellenan igualmente —lo
    // hace `engancharTemporal` cuando llega el catálogo de temporales— para que
    // se puedan cambiar, pero sin pisar lo guardado.

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

  // ══════════════════════════════════════════════════════════════════════════
  // CASCADA: Temporal → Empresa → Centro de costo → (Área operativa) → Cargo
  // ══════════════════════════════════════════════════════════════════════════
  //
  // El orden no es cosmético: la temporal decide qué empresas existen, la
  // empresa qué centros, y el centro qué áreas y qué cargos están AUTORIZADOS.
  // Antes se empezaba por el centro de costo escrito a mano sobre el maestro
  // completo, y de ahí se deducía la temporal; eso permitía combinaciones que
  // la parametrización no reconoce y dejaba la labor sin resolver.
  //
  // Dos fuentes, elegidas por los datos (ver `VacancyCascadeService`): la
  // temporal con alcance en el parametrizador encadena por él; la que no lo
  // tiene cae al maestro de centros de costo, filtrado por esa temporal.

  /** Cambió la temporal: se rehace todo lo que cuelga de ella. */
  onTemporalChange(valor: string): void {
    this.engancharTemporal(valor, { conservarSeleccion: false });
  }

  /**
   * Ata el valor del control `temporal` a su opción del catálogo y recarga lo
   * que dependa de ella.
   *
   * @param conservarSeleccion true al ABRIR una vacante para editar: la empresa
   *   y el centro ya guardados no se borran, solo se rellenan los desplegables
   *   para poder cambiarlos.
   */
  private engancharTemporal(valor: string, opts: { conservarSeleccion: boolean }): void {
    const canonica = canonicalTemporal(valor) ?? valor;
    this.temporalSel =
      this.temporales.find((t) => t.valor === canonica)
      ?? this.temporales.find((t) => canonicalTemporal(t.label) === canonica)
      ?? null;

    if (!opts.conservarSeleccion) {
      // Cambiar de temporal invalida empresa, centro, área y cargo: son de la
      // otra. Dejarlos puestos era la forma silenciosa de guardar una vacante
      // con la finca de una temporal y la razón social de la otra.
      this.vacanteForm.patchValue({
        empresa_ref: null,
        centro_costo_id: null,
        centro_clave: '',
        finca: '',
        empresa_usuaria_solicita: '',
        direccion: '',
        cargo: '',
        area_operativa_codigo: null,
        area_operativa_id: null,
      }, { emitEvent: false });
      this.limpiarTrazaLabor();
      this.centroSel = null;
      this.heredadoDe = null;
      this.liberarHeredados();
      this.centros = [];
      this.areasOperativas = [];
      this.cargosAutorizados = [];
      this.modoPorArea = false;
    }

    this.empresas = [];

    if (!this.temporalSel) return;

    if (this.temporalSel.parametrizada) {
      this.cargandoCascada = true;
      this.cascada
        .empresasDe(this.temporalSel.configRef)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((lista) => {
          this.empresas = lista;
          this.cargandoCascada = false;
          if (opts.conservarSeleccion) this.reengancharEmpresaGuardada();
        });
    } else {
      // Temporal sin alcance parametrizado: los centros salen del maestro y no
      // hay paso de empresa (la trae el propio centro, como hasta ahora).
      this.cargandoCascada = true;
      this.cascada
        .centrosDelMaestro(this.temporalSel.valor)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((lista) => {
          this.centros = this.conCentroGuardado(lista);
          this.cargandoCascada = false;
          this.reengancharCentroGuardado();
        });
    }
  }

  /** Cambió la empresa: se recargan sus centros. */
  onEmpresaChange(ref: number | null): void {
    const empresa = this.empresas.find((e) => e.ref === ref) ?? null;
    this.vacanteForm.patchValue({
      empresa_usuaria_solicita: empresa?.nombre ?? '',
      centro_costo_id: null,
      centro_clave: '',
      finca: '',
      direccion: '',
      cargo: '',
      area_operativa_codigo: null,
      area_operativa_id: null,
    }, { emitEvent: false });
    this.limpiarTrazaLabor();
    this.centroSel = null;
    this.centros = [];
    this.areasOperativas = [];
    this.cargosAutorizados = [];
    this.modoPorArea = false;

    if (ref == null) return;
    this.cargandoCascada = true;
    this.cascada
      .centrosDe(ref)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((lista) => {
        this.centros = this.conCentroGuardado(lista);
        this.cargandoCascada = false;
      });
  }

  /**
   * Al abrir para editar: ata el centro ya guardado a su opción de la lista.
   *
   * Sin esto el desplegable salía en blanco sobre una vacante que sí tenía
   * centro, y `centro_clave` vacío bloqueaba el guardado por obligatorio.
   */
  private reengancharCentroGuardado(): void {
    if (this.vacanteForm.get('centro_clave')?.value) return;
    const guardado = this.centroGuardadoEnLista();
    if (guardado) this.aplicarCentro(guardado, { pisarAjustes: false });
  }

  /** Al abrir para editar: engancha la empresa ya guardada por su NOMBRE. */
  private reengancharEmpresaGuardada(): void {
    const nombre = this.normalizarNombre(this.vacanteForm.get('empresa_usuaria_solicita')?.value);
    if (!nombre) return;
    const empresa = this.empresas.find((e) => this.normalizarNombre(e.nombre) === nombre);
    if (!empresa) {
      // La empresa guardada ya no está en el alcance. La vacante sigue siendo
      // editable: se ofrece su propio centro como única opción para no dejarla
      // bloqueada por un cambio de parametrización posterior.
      this.centros = this.conCentroGuardado([]);
      this.reengancharCentroGuardado();
      return;
    }
    this.vacanteForm.get('empresa_ref')!.setValue(empresa.ref, { emitEvent: false });
    this.cascada
      .centrosDe(empresa.ref)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((lista) => {
        this.centros = this.conCentroGuardado(lista);
        this.reengancharCentroGuardado();
      });
  }

  /**
   * Añade a la lista el centro que la vacante ya tiene guardado si no viene en
   * ella.
   *
   * Pasa con las vacantes viejas y con las de una temporal cuyo alcance cambió:
   * sin esto el desplegable saldría en blanco y el guardado siguiente borraría
   * el centro de costo de una vacante que sí lo tenía.
   */
  private conCentroGuardado(lista: OpcionCentro[]): OpcionCentro[] {
    const finca = String(this.vacanteForm.get('finca')?.value ?? '').trim();
    if (!finca) return lista;
    const ya = lista.some((c) => this.normalizarNombre(c.finca) === this.normalizarNombre(finca));
    if (ya) return lista;
    return [
      {
        clave: `g:${finca}`,
        id: this.vacanteForm.get('centro_costo_id')?.value ?? null,
        finca,
        label: `${finca} (guardado en la vacante)`,
        empresa: String(this.vacanteForm.get('empresa_usuaria_solicita')?.value ?? '') || null,
        direccion: String(this.vacanteForm.get('direccion')?.value ?? '') || null,
        temporal: String(this.vacanteForm.get('temporal')?.value ?? '') || null,
        salario: null,
        auxilio_transporte: null,
      },
      ...lista,
    ];
  }

  private centroGuardadoEnLista(): OpcionCentro | null {
    const finca = this.normalizarNombre(this.vacanteForm.get('finca')?.value);
    if (!finca) return null;
    return this.centros.find((c) => this.normalizarNombre(c.finca) === finca) ?? null;
  }

  /** Cambió el centro de costo. Llega la CLAVE de la opción, no el nombre. */
  onCentroChange(clave: string): void {
    const centro = this.centros.find((c) => c.clave === clave) ?? null;
    if (!centro) return;
    this.aplicarCentro(centro, { pisarAjustes: true });
  }

  /**
   * Vuelca en el formulario lo que trae el centro y encadena área/cargo.
   *
   * @param pisarAjustes false al reabrir una vacante: lo guardado manda sobre la
   *   ficha del centro, que puede haber cambiado desde que se publicó.
   */
  private aplicarCentro(centro: OpcionCentro, opts: { pisarAjustes: boolean }): void {
    this.centroSel = centro;

    const patch: Record<string, unknown> = {
      finca: centro.finca,
      centro_costo_id: centro.id,
      centro_clave: centro.clave,
    };
    if (centro.empresa) patch['empresa_usuaria_solicita'] = centro.empresa;
    if (centro.direccion) patch['direccion'] = centro.direccion;

    // Pago y transporte son datos DEL CENTRO, no algo que quien publica tenga
    // que recordar. Solo entran cuando la fuente los da sin ambigüedad (mismo
    // valor en todos los subcentros); si difieren llega null y se deja lo que
    // haya para digitarlo.
    if (opts.pisarAjustes && centro.salario != null && Number(centro.salario) > 0) {
      patch['salario'] = Number(centro.salario);
    }
    if (opts.pisarAjustes && centro.auxilio_transporte != null) {
      patch['auxilio_transporte'] = centro.auxilio_transporte ? 'Si' : 'No';
    }

    this.vacanteForm.patchValue(patch, { emitEvent: false });

    // Lo que trae la ficha se bloquea; lo que no trae queda abierto.
    this.heredadoDe = centro.label || centro.finca;
    this.aplicarBloqueoHeredados(centro);

    this.areasOperativas = [];
    this.cargosAutorizados = [];
    this.modoPorArea = false;

    if (opts.pisarAjustes) {
      this.vacanteForm.patchValue(
        { cargo: '', area_operativa_codigo: null, area_operativa_id: null },
        { emitEvent: false },
      );
      this.limpiarTrazaLabor();
    }

    // Un centro del maestro no tiene parametrización que consultar: el cargo
    // sigue siendo el autocompletado del maestro de cargos.
    if (centro.id == null) {
      this.sugerirDescripcion();
      return;
    }

    this.cargandoCascada = true;
    this.cascada
      .modoDe(centro.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((modo) => {
        this.modoPorArea = !!modo?.trabaja_por_area;
        if (this.modoPorArea) {
          this.cascada
            .areasDe(centro.id!)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((areas) => {
              this.areasOperativas = areas;
              this.cargandoCascada = false;
              // Al reabrir, el área guardada reengancha sola y trae sus cargos.
              const cod = this.vacanteForm.get('area_operativa_codigo')?.value;
              if (cod) this.onAreaOperativaChange(String(cod), { pisarCargo: false });
            });
        } else {
          this.cargarCargosAutorizados(centro.id!, undefined);
        }
      });
  }

  /** Cambió el área operativa: se recargan los cargos autorizados en ella. */
  onAreaOperativaChange(codigo: string | null, opts = { pisarCargo: true }): void {
    const area = this.areasOperativas.find((a) => a.codigo === codigo) ?? null;
    this.vacanteForm.get('area_operativa_id')!.setValue(area?.id ?? null, { emitEvent: false });
    if (opts.pisarCargo) {
      this.vacanteForm.get('cargo')!.setValue('', { emitEvent: false });
      this.limpiarTrazaLabor();
    }
    this.cargosAutorizados = [];
    const centroId = this.centroSel?.id;
    if (centroId == null || !area) return;
    this.cargarCargosAutorizados(centroId, area.id);
  }

  private cargarCargosAutorizados(centroId: number, areaId?: number): void {
    this.cargandoCascada = true;
    this.cascada
      .cargosDe(centroId, areaId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((lista) => {
        this.cargosAutorizados = this.conCargoGuardado(lista);
        this.cargandoCascada = false;
        this.sugerirDescripcion();
      });
  }

  /**
   * Añade a la lista el cargo que la vacante ya tiene guardado si no está entre
   * los autorizados.
   *
   * Pasa al reabrir vacantes publicadas antes de que existiera la
   * parametrización, o si al centro le retiraron ese cargo. Sin esto el
   * desplegable saldría vacío y guardar habría fallado con "El cargo es
   * obligatorio" sobre una vacante que sí tenía cargo.
   */
  private conCargoGuardado(lista: CargoAutorizado[]): CargoAutorizado[] {
    const cargo = String(this.vacanteForm.get('cargo')?.value ?? '').trim();
    if (!cargo) return lista;
    if (lista.some((c) => this.normalizarNombre(c.cargo_nombre) === this.normalizarNombre(cargo))) {
      return lista;
    }
    return [
      {
        configuracion_id: -1,
        cargo_id: null,
        cargo_nombre: cargo,
        area_id: null,
        area_codigo: null,
        esquema_id: null,
        esquema_codigo: null,
        completa: false,
        activo: null,
      },
      ...lista,
    ];
  }

  /** Cambió el cargo dentro de la lista de autorizados. */
  onCargoAutorizadoChange(nombre: string): void {
    const cargo = this.cargosAutorizados.find((c) => c.cargo_nombre === nombre) ?? null;
    this.vacanteForm.get('configuracion_centro_cargo_id')!
      .setValue(cargo?.configuracion_id ?? null, { emitEvent: false });
    this.vacanteForm.get('esquema_labor_codigo')!
      .setValue(cargo?.esquema_codigo ?? null, { emitEvent: false });
    this.sugerirDescripcion();
  }

  /** Borra la traza de la labor resuelta; se rehace al volver a resolver. */
  private limpiarTrazaLabor(): void {
    this.vacanteForm.patchValue({
      configuracion_centro_cargo_id: null,
      regla_labor_id: null,
      labor_codigo_snapshot: null,
      labor_descripcion_snapshot: null,
      esquema_labor_codigo: null,
      labor_origen_resolucion: null,
    }, { emitEvent: false });
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

    // Con centro parametrizado manda el BACKEND: `resolver-labor` sabe de reglas,
    // esquemas y overrides que la hoja de labores cableada no conoce, y devuelve
    // además la traza (configuración, regla, código) que se guarda con la vacante
    // para que dentro de un año se pueda explicar de dónde salió este texto.
    // Ante cualquier fallo se cae a la hoja de siempre: quedarse sin descripción
    // bloquearía el guardado, porque el campo es obligatorio.
    const centroId = this.centroSel?.id ?? null;
    const cargo = String(v.cargo ?? '').trim();
    if (centroId != null && cargo) {
      const cargoSel = this.cargosAutorizados.find((c) => c.cargo_nombre === cargo) ?? null;
      this.cascada
        .resolverLabor({
          centroId,
          cargoId: cargoSel?.cargo_id ?? undefined,
          cargoNombre: cargo,
          fechaIngreso: this.aYmd(fecha),
        })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((res) => {
          if (res.ok && res.resolucion?.labor) {
            const r = res.resolucion;
            this.errorLabor = null;
            this.vacanteForm.patchValue({
              configuracion_centro_cargo_id: r.configuracion_id ?? null,
              regla_labor_id: r.regla_labor_id ?? null,
              labor_codigo_snapshot: r.codigo_labor ?? null,
              labor_descripcion_snapshot: r.labor,
              esquema_labor_codigo: r.esquema?.codigo ?? null,
              labor_origen_resolucion: r.origen_resolucion ?? null,
            }, { emitEvent: false });
            if (r.labor !== actual) ctrl.setValue(r.labor);
            return;
          }

          // CENTRO PARAMETRIZADO Y EL BACKEND NO RESUELVE: se dice, no se tapa.
          //
          // Aqui estaba la caida silenciosa al TypeScript cableado. Con ella, una vacante
          // sobre un centro SIN configuracion salia con una labor plausible y nadie se
          // enteraba de que faltaba parametrizacion. El flujo nuevo (ALIANZA, APOYO, BLU,
          // HMVE, JARDINES) resuelve contra la BD o no resuelve: la descripcion se deja
          // como este y la persona ve el motivo.
          //
          // `labores-por-mes.data.ts` NO se borra ni se deja de usar en el camino de abajo:
          // un centro sin `centroSel` (el flujo viejo) lo sigue teniendo.
          this.limpiarTrazaLabor();
          this.errorLabor = res.ok ? 'RESOLUCION_VACIA' : res.codigo;
        });
      return;
    }

    // Sin centro parametrizado no hay a quien preguntar: queda el camino legacy.
    this.errorLabor = null;
    this.sugerirDesdeHojaDeLabores(ctrl, actual, v, fecha);
  }

  /** La regla cableada de siempre (`labores-por-mes.data.ts`). */
  private sugerirDesdeHojaDeLabores(ctrl: AbstractControl, actual: string, v: any, fecha: Date | string): void {
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
      formArray.push(this.fb.group({ nombre: [nombre, Validators.required] }));
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


  guardar(): void {
    this.vacanteForm.markAllAsTouched();
    this.vacanteForm.updateValueAndValidity({ emitEvent: false });

    // ✅ Si la suma no cuadra o excede, el form queda INVALID y NO guarda
    if (this.vacanteForm.invalid) {
      // Y se ABREN las secciones a las que les falta algo. Plegar ahorra espacio,
      // pero un campo obligatorio vacío escondido dentro de una sección cerrada
      // deja el botón sin responder y sin decir por qué.
      this.abrirSeccionesIncompletas();
      return;
    }

    this.dialogRef.close(this.vacanteForm.getRawValue());
  }

  /** Despliega toda sección con obligatorios sin resolver. */
  private abrirSeccionesIncompletas(): void {
    for (const s of this.SECCIONES) {
      if (this.avanceSeccion(s.id) < 100) this.plegadas.delete(s.id);
    }
  }

  cancelar(): void {
    this.dialogRef.close();
  }

}
