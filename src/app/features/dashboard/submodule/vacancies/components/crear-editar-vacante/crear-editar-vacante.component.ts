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
import { VacantesService } from '../../service/vacantes/vacantes.service';
import { PositionsService } from '../../../positions/services/positions/positions.service';
import {
  OpcionCentro,
  OpcionTemporal,
  VacancyCascadeService,
  canonicalTemporal,
  ResultadoLabor,
} from '../../service/vacancy-cascade/vacancy-cascade.service';
import { CalendarioPago, CentroGrupoPago } from '../../../users/services/parametrizacion-vacantes/parametrizacion-vacantes.service';
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
  // El control se sigue llamando `descripcion` (es la clave del backend), pero en
  // pantalla el campo es «Características del cargo»: el aviso tiene que nombrarlo
  // como lo ve quien lo está llenando.
  descripcion: 'Características del cargo',
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

/**
 * Grupos tipados del FormArray de DETALLES DE CARGO.
 *
 * «Personas solicitadas (total)» dice cuántas personas se piden; esto dice de qué:
 * "Operario de corte 2", "Poscosecha 1". La suma tiene que dar exactamente el total.
 */
interface DetalleCargoControls {
  detalle: FormControl<string>;
  cantidad: FormControl<number | null>;
}
type DetalleCargoGroup = FormGroup<DetalleCargoControls>;

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
  /**
   * Empresas del alcance, con «Todas las empresas» delante.
   *
   * La empresa dejó de ser un eslabón obligatorio para poder llegar al centro
   * de costo: ahora es un FILTRO. Por eso el tipo admite `ref: null`, que es la
   * opción de no filtrar.
   */
  empresas: Array<{ ref: number | null; nombre: string }> = [];
  /**
   * TODOS los centros de la temporal, sin filtrar por empresa.
   *
   * Se cargan de una vez al elegir la temporal para poder buscar el centro por
   * su nombre sin saber a qué empresa pertenece —que es como se busca en la
   * práctica: se recuerda la finca, no la razón social—. Lo que ve el
   * desplegable es `centros`, que es esta lista recortada por el filtro.
   */
  centrosTemporal: OpcionCentro[] = [];
  areasOperativas: Array<{ id: number; codigo: string; nombre: string | null }> = [];
  cargosAutorizados: CargoAutorizado[] = [];

  /**
   * Lo que ofrece el desplegable de centro de costo.
   *
   * Sin empresa elegida son todos los de la temporal —así se puede buscar por
   * nombre—; con empresa elegida, solo los suyos. Las opciones sin empresa
   * conocida (las del maestro y la que trae la vacante guardada) no se filtran
   * nunca: dejarlas fuera vaciaría el desplegable de una vacante que sí tiene
   * centro.
   */
  get centros(): OpcionCentro[] {
    const ref = this.vacanteForm?.get('empresa_ref')?.value ?? null;
    if (ref == null) return this.centrosTemporal;
    return this.centrosTemporal.filter((c) => c.empresaRef == null || c.empresaRef === ref);
  }

  /** Opción de cabecera del filtro de empresa: no filtrar. */
  readonly EMPRESA_TODAS: { ref: number | null; nombre: string } =
    { ref: null, nombre: 'Todas las empresas' };

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

  // ── Grupo de pago, fechas de pago y casino (V115) ────────────────────────
  // El grupo es del CENTRO: con uno solo se elige solo, con varios hay que
  // decirlo, y sin ninguno no se puede publicar porque la vacante saldria sin
  // fechas de pago ni casino que imprimir en el contrato.

  /**
   * TODO el catalogo de grupos de pago activos, con `asignada` diciendo cual tiene
   * configurado el centro elegido. Se pueden elegir todos: el que no este asignado se
   * ASIGNA al guardar (ver `guardar()`), pidiendo antes su calendario.
   */
  gruposPago: CentroGrupoPago[] = [];
  /** Calendarios de pago activos. Solo se piden cuando hay que asignar un grupo. */
  calendariosPago: CalendarioPago[] = [];
  /** Hay un PUT de parametrizacion en vuelo: el boton no debe dispararse dos veces. */
  asignandoGrupo = false;
  /**
   * Si este centro exige grupo de pago. Lo dice el BACKEND por los datos: solo las
   * temporales que ya tienen esta parametrizacion lo exigen, asi que Tu Alianza sigue
   * publicando como hasta ahora en vez de quedarse bloqueada.
   */
  exigeGrupoPago = false;
  /** Codigo funcional cuando el backend no resuelve el pago o el casino. */
  errorPagoCasino: string | null = null;
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
   * cambiar la dirección de un centro. Antes se podían editar y solo se
   * marcaban como "ajustado a mano", que es como decir que el dato de la
   * vacante y el de la ficha podían discrepar sin que nadie lo revisara.
   *
   * Los que la ficha deja en blanco quedan ABIERTOS: el maestro no siempre da
   * los datos y alguien tiene que poder completarlos.
   *
   * Bloquear no es esconder: `getRawValue()` incluye los deshabilitados, así
   * que el valor viaja igual en el payload.
   */
  readonly CAMPOS_HEREDADOS = ['empresa_usuaria_solicita', 'direccion', 'salario', 'auxilio_transporte'] as const;

  /**
   * Lo que NUNCA se bloquea, aunque la ficha del centro lo traiga.
   *
   * Decisión de negocio (2026-09-02): el salario y el auxilio se negocian por
   * vacante. La ficha del centro sigue prellenándolos —es el punto de partida
   * bueno— pero quien publica tiene que poder ajustarlos sin ir a editar el
   * maestro. Se quedan en `CAMPOS_HEREDADOS` para que sigan mostrando de qué
   * centro vienen; lo que cambia es que no se deshabilitan.
   */
  private readonly CAMPOS_SIEMPRE_EDITABLES: readonly string[] = ['salario', 'auxilio_transporte'];

  /** Salario mínimo legal mensual vigente: el valor por defecto de toda vacante. */
  static readonly SALARIO_MINIMO = 1750905;

  /** Campos heredados que quedaron abiertos porque la ficha no los trae. */
  private abiertos = new Set<string>();

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
      if (centro && trae[nombre] && !this.CAMPOS_SIEMPRE_EDITABLES.includes(nombre)) {
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

  valorEmpresa = (e: { ref: number | null }) => e.ref;
  etiquetaEmpresa = (e: { nombre: string }) => e.nombre;

  valorCentro = (c: OpcionCentro) => c.clave;
  etiquetaCentro = (c: OpcionCentro) => c.label;
  /** La empresa es lo que distingue dos fincas homónimas. */
  detalleCentro = (c: OpcionCentro) => c.empresa;

  valorGrupoPago = (g: CentroGrupoPago) => g.grupo_pago_id;
  // Solo el NOMBRE. Antes la segunda linea traia las fechas de pago del calendario, pero
  // son cuatro renglones por opcion: la lista dejaba de leerse y de caber. Las fechas
  // siguen viendose, en su propio campo, en cuanto se elige el grupo.
  etiquetaGrupoPago = (g: CentroGrupoPago) => g.nombre;

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
    return 'Opcional: recorta la lista de centros.';
  }

  /**
   * Texto de apoyo del selector de centro de costo.
   *
   * Ya no manda elegir la empresa: el centro se busca por nombre entre todos
   * los de la temporal y es él quien trae su empresa.
   */
  get ayudaCentro(): string | undefined {
    if (!this.temporalSel) return 'Elige primero la temporal.';
    return 'Búscalo por nombre: trae su empresa y su dirección.';
  }

  // ════════════════════════════════════════════════════════════════════════
  // LABOR RESUELTA (sección 3 · Vinculación)
  // ────────────────────────────────────────────────────────────────────────
  // Es el texto que ANTES se volcaba en «Descripción». Ahora vive aquí, junto a
  // la fecha de ingreso que lo determina, y se muestra como dato resuelto: no se
  // teclea, lo devuelve `resolver-labor` a partir del centro, el cargo y el MES
  // DE INGRESO. Se guarda en `labor_descripcion_snapshot`, que ya viajaba en el
  // payload como parte de la traza de la labor.

  /** true cuando ya hay fecha de ingreso: es lo único que activa la labor. */
  get hayFechaIngreso(): boolean {
    return !!this.soloDia(this.vacanteForm?.get('fechadeIngreso')?.value);
  }

  /** Labor resuelta para esa fecha de ingreso. Vacío = todavía no se resolvió. */
  get laborResuelta(): string {
    return String(this.vacanteForm?.get('labor_descripcion_snapshot')?.value ?? '').trim();
  }

  /**
   * Fecha de ingreso en texto, para la nota del campo.
   *
   * Se formatea aquí y no con el pipe `date`: el diálogo usa `MomentDateAdapter`,
   * así que el valor del calendario es un Moment y el pipe no lo acepta.
   */
  get textoFechaIngreso(): string {
    const d = this.soloDia(this.vacanteForm?.get('fechadeIngreso')?.value);
    return d ? d.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  }

  /**
   * Mes de la fecha de ingreso, en letra.
   *
   * Se pinta bajo el campo porque es LA pregunta que levanta ese texto: de qué
   * mes es la labor. Todas las reglas de un mismo area suelen decir lo mismo los
   * doce meses salvo por el codigo que llevan delante (1AD, 2AD…), así que sin
   * nombrar el mes parece que el campo no reacciona a la fecha.
   */
  get mesIngreso(): string {
    const d = this.soloDia(this.vacanteForm?.get('fechadeIngreso')?.value);
    if (!d) return '';
    const m = d.toLocaleDateString('es-CO', { month: 'long' });
    return m.charAt(0).toUpperCase() + m.slice(1);
  }

  /**
   * Por qué el campo está vacío teniendo ya fecha de ingreso.
   *
   * Se dice el motivo en vez de dejar un hueco: sin cargo no hay nada que
   * resolver, y con cargo pero sin parametrización el detalle sale del aviso
   * `errorLabor` que ya se pinta debajo.
   */
  get avisoLabor(): string | undefined {
    if (this.laborResuelta) return undefined;
    if (!String(this.vacanteForm?.get('cargo')?.value ?? '').trim()) {
      return 'Elige el cargo en «La vacante» para que se resuelva la labor.';
    }
    if (this.cargandoCascada) return 'Resolviendo la labor…';
    return 'No hay labor parametrizada para este centro, cargo y mes de ingreso.';
  }

  // ════════════════════════════════════════════════════════════════════════
  // GRUPO DE PAGO, FECHAS DE PAGO Y CASINO (sección 2 · La vacante)
  // ────────────────────────────────────────────────────────────────────────
  // Los tres los resuelve el backend a partir del centro y del grupo elegido, y
  // llegan en solo lectura: son parametrización del centro, no algo que quien
  // publica deba recordar ni pueda ajustar aquí.

  /** El grupo elegido, si sigue entre los del centro. */
  get grupoPagoSel(): CentroGrupoPago | null {
    const id = this.vacanteForm?.get('grupo_pago_ref')?.value ?? null;
    return this.gruposPago.find((g) => g.grupo_pago_id === id) ?? null;
  }

  /** Los que este centro YA tiene configurados, con su calendario. */
  get gruposPagoAsignados(): CentroGrupoPago[] {
    return this.gruposPago.filter((g) => g.asignada);
  }

  /**
   * El grupo elegido todavia no es de este centro. Entonces hace falta su calendario, y
   * al guardar se asigna en el parametrizador.
   */
  get grupoPorAsignar(): boolean {
    const sel = this.grupoPagoSel;
    return !!sel && !sel.asignada;
  }

  /** El centro aun no tiene ningun grupo configurado. Ya no bloquea: se puede asignar. */
  get centroSinGruposPago(): boolean {
    return this.exigeGrupoPago && this.centroSel?.id != null && this.gruposPagoAsignados.length === 0;
  }

  /** Solo se pregunta el grupo cuando hay más de uno; con uno se pone solo. */
  get eligeGrupoPago(): boolean {
    return this.exigeGrupoPago && this.gruposPago.length > 0;
  }

  get fechasPagoResueltas(): string {
    return String(this.vacanteForm?.get('fechas_pago_texto_snapshot')?.value ?? '').trim();
  }

  get casinoResuelto(): string {
    return String(this.vacanteForm?.get('casino_texto_snapshot')?.value ?? '').trim();
  }


  /** Texto de apoyo del selector de grupo de pago. */
  get ayudaGrupoPago(): string | undefined {
    if (this.centroSinGruposPago) {
      return 'Este centro no tiene grupos de pago configurados: no se puede publicar.';
    }
    if (this.gruposPagoAsignados.length === 1 && !this.grupoPorAsignar) {
      return 'El centro solo tiene configurado este grupo: se elige solo.';
    }
    if (this.grupoPorAsignar) {
      return 'Este centro aún no tiene este grupo: se le asignará al guardar.';
    }
    return undefined;
  }

  /** Texto de apoyo del campo Dirección. */
  get ayudaDireccion(): string | undefined {
    if (!this.heredadoDe) return undefined;
    return this.abiertos.has('direccion')
      ? 'Su ficha no la trae: complétala aquí'
      : `Viene de la ficha de ${this.heredadoDe}`;
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
    // Empresa, salario y auxilio ya no se pintan (se retiró la fila de datos
    // heredados): siguen viajando en el payload, pero contarlos aquí dejaba la
    // barra en rojo por campos que nadie puede ver ni tocar.
    { id: 1, controles: ['temporal', 'centro_clave', 'direccion'] },
    // `grupo_pago_ref` cuenta en la 2: el desplegable se pregunta tras el codigo bot,
    // y la barra tiene que medir la seccion donde el campo esta a la vista.
    { id: 2, controles: ['cargo', 'area_operativa_codigo', 'area', 'personas_solicitadas', 'tipo_contratacion', 'experiencia', 'codigo_elite', 'grupo_pago_ref', 'descripcion'] },
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
    // La sección 2 tampoco se resuelve con el total a secas: el desglose por
    // detalle de cargo tiene que sumarlo exacto, y ese error deja `guardar()`
    // bloqueado. Sin contarlo aquí, la barra decía 100% con el diálogo sin
    // responder al botón.
    if (id === 2) {
      total++;
      const lineasCompletas = this.detallesCargo.controls.every(
        (c) => !!(c.get('detalle')!.value || '').toString().trim()
      );
      if (this.detallesCargo.length && lineasCompletas && this.restanteDetallesCargo === 0) hechos++;
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
        // Sin `required` A PROPÓSITO desde que se retiró la fila de heredados: lo
        // rellena el centro de costo y ya no hay campo donde completarlo, así que
        // un obligatorio vacío aquí dejaba `guardar()` sin responder y sin nada
        // rojo que mirar (58 de los 1.041 centros del maestro no traen empresa).
        empresa_usuaria_solicita: [''],
        direccion: ['', Validators.required],

        experiencia: ['', Validators.required],
        descripcion: ['', Validators.required],
        fecha_publicado: [new Date()],
        quienpublicolavacante: [
          `${this.user?.datos_basicos?.nombres ?? ''} ${this.user?.datos_basicos?.apellidos ?? ''}`.trim(),
        ],
        estadovacante: ['Activa'],
        salario: [CrearEditarVacanteComponent.SALARIO_MINIMO, [Validators.required, Validators.min(0)]],
        codigo_elite: [''],

        // Condicional 1: Fecha de ingreso
        tieneFechaIngreso: ['No', Validators.required],
        fechadeIngreso: [{ value: null, disabled: true }],

        // Condicional 2: Prueba o Contratación
        prueba_ocontratacion: ['', Validators.required],
        fechadePruebatecnica: [{ value: null, disabled: true }],
        horade_pruebatecnica: [{ value: '', disabled: true }],
        ubicacionPruebaTecnica: [{ value: '', disabled: true }],

        // Arranca en «Obra Labor» (2026-09-03, a petición del usuario): es el tipo
        // con el que se publica casi siempre y el ÚNICO que puede fijar el rol
        // CONTRATACION, así que empezar en blanco era un paso de más para todos.
        // Los roles sin límite lo siguen pudiendo cambiar.
        tipo_contratacion: [TIPO_UNICO_CONTRATACION, Validators.required],

        municipio: [[], Validators.required],
        barrio: [''],

        personas_solicitadas: [null, [Validators.required, Validators.min(1)]],
        // Desglose del total por detalle de cargo. Arranca vacío: la primera línea la
        // siembra `sembrarDetalleCargo()` en cuanto el total tiene valor, para que el
        // campo aparezca justo DESPUÉS de decir cuántas personas se piden.
        detallesCargo: this.fb.array<DetalleCargoGroup>([]),
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

        // Grupo de pago de la vacante y traza de lo que resolvio el backend
        // (columnas V18 de db_automation). Los textos son SNAPSHOT: se guardan
        // congelados para que un cambio posterior en el calendario o en los
        // valores del casino no reescriba lo que ya se publico.
        grupo_pago_ref: [null as number | null],
        // SOLO PANTALLA: el calendario con el que se asignara el grupo al centro cuando
        // este todavia no lo tenga. No es un campo de la vacante —el payload de
        // `vacancy-list` solo manda claves conocidas— y se usa en `guardar()` para el PUT
        // del parametrizador. Lo que la vacante guarda es el `calendario_pago_ref` que
        // devuelve la resolucion, no esto.
        calendario_pago_nuevo: [null as number | null],
        grupo_pago_nombre_snapshot: [null as string | null],
        calendario_pago_ref: [null as number | null],
        fechas_pago_texto_snapshot: [null as string | null],
        politica_casino_ref: [null as number | null],
        casino_origen_resolucion: [null as string | null],
        casino_texto_snapshot: [null as string | null],

        // Oficinas
        oficinasSeleccionadas: [[], Validators.required],
        oficinas_que_contratan: this.fb.array([]),
      },
      {
        validators: [
          this.sumNoExcedeTotalValidator(),
          this.sumIgualTotalValidator(), // ✅ NUEVO: NO deja guardar si la suma no cuadra
          this.sumDetallesIgualTotalValidator(),
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

    // ✅ Revalida si cambia el total. Y abre el desglose por detalle de cargo en
    // cuanto el total tiene valor: es el campo que va justo detrás.
    this.vacanteForm
      .get('personas_solicitadas')!
      .valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.sembrarDetalleCargo();
        this.vacanteForm.updateValueAndValidity({ emitEvent: false });
      });

    // ✅ Revalida al tocar cualquier cantidad del desglose, para que el aviso de
    // "faltan/sobran" se actualice mientras se escribe y no solo al guardar.
    this.detallesCargo.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.vacanteForm.updateValueAndValidity({ emitEvent: false }));

    // Una vacante que se abre con total ya puesto (edición) también tiene que
    // mostrar el desglose sin esperar a que alguien toque el campo.
    this.sembrarDetalleCargo();

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

    // `fechadePruebatecnica` y `fecha_publicado` salieron de esta lista: la labor
    // depende SOLO de la fecha de ingreso, así que tocarlas ya no puede cambiarla
    // y solo provocaba una consulta de más por cada pulsación del calendario.
    const disparan = [
      'cargo',
      'fechadeIngreso',
      'temporal',
      'prueba_ocontratacion',
      'finca',
      'empresa_usuaria_solicita',
    ];
    for (const campo of disparan) {
      this.vacanteForm
        .get(campo)!
        .valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.resolverLaborDelCargo());
    }

    this.resolverLaborDelCargo();
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

  // ══════════════════════════════════════════════════════════════════════════
  // DETALLE DE CARGO: desglose del total solicitado
  // ──────────────────────────────────────────────────────────────────────────
  // El total dice CUÁNTAS personas se piden; estas líneas dicen DE QUÉ. Van
  // pegadas al total a propósito: es el dato que se acaba de escribir y el que
  // tienen que sumar. La regla es la misma que en el reparto por municipio —la
  // suma tiene que dar el total exacto— y por eso se resuelve igual: un error
  // de formulario que deja `guardar()` bloqueado hasta que cuadre.

  get detallesCargo(): FormArray<DetalleCargoGroup> {
    return this.vacanteForm.get('detallesCargo') as FormArray<DetalleCargoGroup>;
  }

  /** Suma de las cantidades del desglose. */
  get totalDetallesCargo(): number {
    return this.detallesCargo.controls
      .map((c) => Number(c.get('cantidad')!.value) || 0)
      .reduce((a: number, b: number) => a + b, 0);
  }

  /** Lo que falta por desglosar. Negativo cuando se pasó del total. */
  get restanteDetallesCargo(): number {
    const total = Number(this.vacanteForm.get('personas_solicitadas')!.value) || 0;
    return total - this.totalDetallesCargo;
  }

  /** true cuando el desglose se pasó del total (el resumen cambia de rótulo). */
  get sobranDetallesCargo(): boolean {
    return this.restanteDetallesCargo < 0;
  }

  /** Cuánto se desvía el desglose del total, siempre en positivo. */
  get desviacionDetallesCargo(): number {
    return Math.abs(this.restanteDetallesCargo);
  }

  /** Una línea nueva del desglose. Arranca en 1, que es el mínimo que admite. */
  private nuevoDetalleCargo(detalle = '', cantidad = 1): DetalleCargoGroup {
    return this.fb.group<DetalleCargoControls>({
      detalle: this.fb.control<string>(detalle, {
        nonNullable: true,
        validators: [Validators.required],
      }),
      cantidad: this.fb.control<number | null>(Math.max(1, Math.trunc(cantidad) || 1), [
        Validators.required,
        Validators.min(1),
      ]),
    });
  }

  agregarDetalleCargo(): void {
    this.detallesCargo.push(this.nuevoDetalleCargo());
    this.vacanteForm.updateValueAndValidity({ emitEvent: false });
  }

  /**
   * Quita una línea. La última no se quita: el desglose es obligatorio desde que
   * hay un total, y dejarlo en cero solo escondería el descuadre.
   */
  quitarDetalleCargo(i: number): void {
    if (this.detallesCargo.length <= 1) return;
    this.detallesCargo.removeAt(i);
    this.vacanteForm.updateValueAndValidity({ emitEvent: false });
  }

  /**
   * Los dos botones del contador. El teclado sigue funcionando sobre el input,
   * pero con `min="1"` el navegador no impide TECLEAR un 0: por eso el valor se
   * sanea aquí y en `normalizarCantidadDetalle`.
   */
  subirCantidadDetalle(i: number): void {
    const ctrl = this.detallesCargo.at(i)?.get('cantidad');
    if (!ctrl) return;
    ctrl.setValue((Number(ctrl.value) || 0) + 1);
    ctrl.markAsTouched();
  }

  bajarCantidadDetalle(i: number): void {
    const ctrl = this.detallesCargo.at(i)?.get('cantidad');
    if (!ctrl) return;
    ctrl.setValue(Math.max(1, (Number(ctrl.value) || 1) - 1));
    ctrl.markAsTouched();
  }

  /** Al salir del input: entero y nunca por debajo de 1. */
  normalizarCantidadDetalle(i: number): void {
    const ctrl = this.detallesCargo.at(i)?.get('cantidad');
    if (!ctrl) return;
    const n = Math.trunc(Number(ctrl.value));
    ctrl.setValue(Number.isFinite(n) && n >= 1 ? n : 1);
  }

  /**
   * La primera línea aparece sola en cuanto el total tiene valor, que es lo que
   * se pidió: escribir "personas solicitadas" y encontrarse el desglose abierto.
   * No se siembra nada mientras el total esté vacío ni si ya hay líneas (editar
   * una vacante guardada no debe añadirle una fila en blanco).
   */
  private sembrarDetalleCargo(): void {
    const total = Number(this.vacanteForm.get('personas_solicitadas')!.value) || 0;
    if (total < 1 || this.detallesCargo.length) return;
    this.detallesCargo.push(this.nuevoDetalleCargo());
  }

  /**
   * La suma del desglose tiene que ser EXACTAMENTE el total: ni pasarse (se
   * estarían pidiendo más personas de las autorizadas) ni quedarse corto (habría
   * cupos sin decir para qué son). Se distinguen los dos casos porque el aviso
   * tiene que decir cuál de los dos es.
   */
  private sumDetallesIgualTotalValidator(): ValidatorFn {
    return (group: AbstractControl) => {
      const arr = group.get('detallesCargo') as FormArray | null;
      if (!arr || arr.length === 0) return null;

      const total = Number(group.get('personas_solicitadas')?.value) || 0;
      if (total <= 0) return null;

      const suma = (arr.controls || [])
        .map((c) => Number(c.get('cantidad')?.value) || 0)
        .reduce((a: number, b: number) => a + b, 0);

      if (suma > total) return { excesoDetallesCargo: true };
      return suma === total ? null : { faltanDetallesCargo: true };
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
      // Una vacante guardada sin salario (o en 0) se abre con el mínimo legal.
      salario: Number(v?.salario) > 0 ? Number(v?.salario) : CrearEditarVacanteComponent.SALARIO_MINIMO,
      codigo_elite: v?.codigo_elite ?? '',

      oficinasSeleccionadas: Array.isArray(v?.oficinas_que_contratan)
        ? v.oficinas_que_contratan.map((o: any) => o?.nombre)
        : [],

      prueba_ocontratacion: v?.prueba_ocontratacion ?? '',
      fechadePruebatecnica: this.parseApiDate(v?.fechadePruebatecnica),

      horade_pruebatecnica: v?.horade_pruebatecnica ?? '',
      ubicacionPruebaTecnica: v?.ubicacionPruebaTecnica ?? '',
      // Al reabrir manda lo GUARDADO; solo se cae al valor por defecto si la
      // vacante no traía tipo (el campo es obligatorio, así que en blanco dejaba
      // el guardado bloqueado hasta elegirlo a mano).
      tipo_contratacion: v?.tipo_contratacion || TIPO_UNICO_CONTRATACION,
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

      // Pago y casino: igual que la labor, se reponen TAL CUAL se publicaron.
      // Reabrir una vacante no debe reescribir sus textos aunque el calendario
      // o los valores del casino hayan cambiado desde entonces.
      grupo_pago_ref: v?.grupo_pago_ref ?? null,
      grupo_pago_nombre_snapshot: v?.grupo_pago_nombre_snapshot ?? null,
      calendario_pago_ref: v?.calendario_pago_ref ?? null,
      fechas_pago_texto_snapshot: v?.fechas_pago_texto_snapshot ?? null,
      politica_casino_ref: v?.politica_casino_ref ?? null,
      casino_origen_resolucion: v?.casino_origen_resolucion ?? null,
      casino_texto_snapshot: v?.casino_texto_snapshot ?? null,
    });

    // Oficinas
    const fa = this.oficinas_que_contratan;
    fa.clear();
    (Array.isArray(v?.oficinas_que_contratan) ? v.oficinas_que_contratan : []).forEach((o: any) =>
      fa.push(this.fb.group({ nombre: [o?.nombre ?? '', Validators.required] }))
    );

    // Desglose por detalle de cargo.
    //
    // Las vacantes anteriores a la columna `detalles_cargo` (V17) no traen ninguno.
    // NO se dejan en blanco: se siembra una línea con el cargo de la vacante y el
    // total, que es el desglose que implícitamente tenían. Dejarla vacía habría
    // bloqueado la edición de todas las vacantes ya publicadas con un campo
    // obligatorio que nadie había podido llenar.
    const detGuardados = Array.isArray(v?.detallesCargo)
      ? v.detallesCargo
      : (Array.isArray(v?.detalles_cargo) ? v.detalles_cargo : []);
    const detFA = this.detallesCargo;
    detFA.clear();

    if (detGuardados.length) {
      detGuardados.forEach((d: any) =>
        detFA.push(this.nuevoDetalleCargo((d?.detalle ?? '').toString(), Number(d?.cantidad) || 1))
      );
    } else {
      const totalGuardado = Number(v?.personas_solicitadas) || 0;
      if (totalGuardado >= 1) {
        detFA.push(this.nuevoDetalleCargo(String(v?.cargo ?? '').trim(), totalGuardado));
      }
    }

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
      this.centrosTemporal = [];
      this.areasOperativas = [];
      this.cargosAutorizados = [];
      this.modoPorArea = false;
    }

    this.empresas = [];

    if (!this.temporalSel) return;

    if (this.temporalSel.parametrizada) {
      // Las empresas y TODOS sus centros se piden de una vez. Antes los centros
      // esperaban a que se eligiera una empresa, y eso obligaba a saber de qué
      // empresa era la finca antes de poder buscarla.
      this.cargandoCascada = true;
      this.cascada
        .empresasDe(this.temporalSel.configRef)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((lista) => {
          this.empresas = [this.EMPRESA_TODAS, ...lista];
          if (opts.conservarSeleccion) this.reengancharEmpresaGuardada();

          this.cascada
            .centrosDeVarias(lista.map((e) => e.ref))
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((centros) => {
              this.centrosTemporal = this.conCentroGuardado(centros);
              this.cargandoCascada = false;
              this.reengancharCentroGuardado();
            });
        });
    } else {
      // Temporal sin alcance parametrizado: los centros salen del maestro y no
      // hay paso de empresa (la trae el propio centro, como hasta ahora).
      this.cargandoCascada = true;
      this.cascada
        .centrosDelMaestro(this.temporalSel.valor)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((lista) => {
          this.centrosTemporal = this.conCentroGuardado(lista);
          this.cargandoCascada = false;
          this.reengancharCentroGuardado();
        });
    }
  }

  /**
   * Cambió la empresa. Ya no dispara ninguna petición: los centros de la
   * temporal están cargados y la empresa solo RECORTA la lista (`centros`).
   *
   * Sí se suelta el centro elegido: era de la empresa anterior, y dejarlo
   * puesto es como se guardaba una vacante con la finca de una empresa y la
   * razón social de otra.
   */
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
    this.heredadoDe = null;
    this.liberarHeredados();
    this.areasOperativas = [];
    this.cargosAutorizados = [];
    this.modoPorArea = false;
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
    const empresa = this.empresas.find(
      (e) => e.ref != null && this.normalizarNombre(e.nombre) === nombre,
    );
    // Si la empresa guardada ya no está en el alcance no se filtra por ella: la
    // vacante sigue editable porque `conCentroGuardado` mete su propio centro
    // en la lista. Los centros los carga quien llama, en una sola petición.
    if (empresa) {
      this.vacanteForm.get('empresa_ref')!.setValue(empresa.ref, { emitEvent: false });
    }
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
        // Sin referencia de empresa: el filtro de empresa NO la descarta nunca,
        // que es justo lo que se quiere para el centro que la vacante ya tiene.
        empresaRef: null,
        finca,
        label: `${finca} (guardado en la vacante)`,
        empresa: String(this.vacanteForm.get('empresa_usuaria_solicita')?.value ?? '') || null,
        direccion: String(this.vacanteForm.get('direccion')?.value ?? '') || null,
        temporal: String(this.vacanteForm.get('temporal')?.value ?? '') || null,
        // Sin centro, el salario vuelve al mínimo legal: `null` dejaba el campo
        // vacío y obligatorio, y la vacante no se podía guardar sin teclearlo.
        salario: CrearEditarVacanteComponent.SALARIO_MINIMO,
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
    // La empresa ya no se ve, así que si el centro no la trae se cae a la del
    // filtro antes que dejarla en blanco en la vacante publicada.
    const empresaFiltro = this.empresas.find(
      (e) => e.ref != null && e.ref === this.vacanteForm.get('empresa_ref')?.value,
    )?.nombre;
    if (centro.empresa || empresaFiltro) {
      patch['empresa_usuaria_solicita'] = centro.empresa || empresaFiltro;
    }
    if (centro.direccion) patch['direccion'] = centro.direccion;
    // El centro TRAE su empresa: al buscarlo por nombre, el filtro de empresa se
    // pone solo en la que le corresponde en vez de quedarse en «Todas» dando la
    // impresión de que ese dato quedó sin resolver.
    if (centro.empresaRef != null) patch['empresa_ref'] = centro.empresaRef;

    // Pago y transporte son datos DEL CENTRO, no algo que quien publica tenga
    // que recordar. Solo entran cuando la fuente los da sin ambigüedad (mismo
    // valor en todos los subcentros); si difieren llega null y se deja lo que
    // haya para digitarlo.
    if (opts.pisarAjustes) {
      // El centro manda si trae un salario real; si no lo trae —o llega en 0
      // porque sus subcentros no coinciden— se pone el mínimo legal. Dejarlo
      // vacío obligaba a teclearlo en cada vacante y era el hueco por el que
      // salían publicaciones sin salario.
      const delCentro = Number(centro.salario);
      patch['salario'] = Number.isFinite(delCentro) && delCentro > 0
        ? delCentro
        : CrearEditarVacanteComponent.SALARIO_MINIMO;
    }
    if (opts.pisarAjustes) {
      // Se resuelve SIEMPRE, no solo cuando la ficha lo dice. El campo dejó de
      // estar en pantalla y sigue siendo obligatorio: dejarlo vacío bloqueaba el
      // guardado sin decir por qué. `No` es el mismo valor por defecto que ya
      // tiene la entidad `CentroCosto` en el backend.
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

    // Grupos de pago del centro: se piden SIEMPRE que el centro esté
    // parametrizado, incluso al reabrir, porque de ellos depende poder guardar.
    this.cargarPagoDelCentro(centro.id, opts.pisarAjustes);

    // Un centro del maestro no tiene parametrización que consultar: el cargo
    // sigue siendo el autocompletado del maestro de cargos.
    if (centro.id == null) {
      this.resolverLaborDelCargo();
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
        this.resolverLaborDelCargo();
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
    this.resolverLaborDelCargo();
  }

  /**
   * Carga los grupos de pago del centro y decide qué hacer con ellos.
   *
   * Con UNO se elige solo —preguntar por algo que no tiene alternativa es ruido—;
   * con VARIOS el grupo pasa a ser obligatorio; con NINGUNO se avisa y el
   * guardado queda bloqueado, porque la vacante saldría sin fechas de pago ni
   * casino que imprimir.
   *
   * `pisar` es false al reabrir una vacante: lo que se guardó manda sobre lo que
   * hoy diga la parametrización, igual que con la traza de la labor.
   */
  private cargarPagoDelCentro(centroId: number | null, pisar: boolean): void {
    if (centroId == null) {
      this.gruposPago = [];
      this.exigeGrupoPago = false;
      this.errorPagoCasino = null;
      this.aplicarObligatoriedadGrupoPago();
      if (pisar) this.limpiarTrazaPago();
      return;
    }
    this.cascada
      .modoPagoDe(centroId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((modo) => {
        this.exigeGrupoPago = !!modo?.exige_grupo_pago;
        this.cascada
          .gruposPagoDe(centroId)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe((grupos) => {
            this.gruposPago = grupos;
            const guardado = this.vacanteForm.get('grupo_pago_ref')?.value ?? null;
            const sigueValido = !pisar && grupos.some((g) => g.grupo_pago_id === guardado);
            // `grupos` es el catalogo entero; el que se pone SOLO es el del CENTRO, y solo
            // cuando tiene exactamente uno configurado. Con el catalogo se elegiria siempre
            // el primero y la vacante saldria en un grupo que nadie escogio.
            const delCentro = grupos.filter((g) => g.asignada);
            const elegido = sigueValido
              ? guardado
              : (delCentro.length === 1 ? delCentro[0].grupo_pago_id : null);
            this.vacanteForm.get('grupo_pago_ref')!.setValue(elegido, { emitEvent: false });
            this.aplicarObligatoriedadGrupoPago();
            if (elegido == null) {
              if (pisar) this.limpiarTrazaPago();
              this.errorPagoCasino = null;
              return;
            }
            this.resolverPagoCasinoDelGrupo();
          });
      });
  }

  /**
   * El grupo es obligatorio cuando hay entre qué elegir; el CALENDARIO lo es solo
   * mientras el grupo elegido no sea de este centro, porque sin él no se puede asignar
   * (el backend exige `calendario_pago_id` en cada item) y no hay forma de inventarse
   * cuándo se paga.
   */
  private aplicarObligatoriedadGrupoPago(): void {
    const ctrl = this.vacanteForm?.get('grupo_pago_ref');
    if (ctrl) {
      if (this.eligeGrupoPago) ctrl.addValidators(Validators.required);
      else ctrl.removeValidators(Validators.required);
      ctrl.updateValueAndValidity({ emitEvent: false });
    }

    const cal = this.vacanteForm?.get('calendario_pago_nuevo');
    if (cal) {
      if (this.grupoPorAsignar) cal.addValidators(Validators.required);
      else cal.removeValidators(Validators.required);
      cal.updateValueAndValidity({ emitEvent: false });
    }
  }

  /** Cambió el grupo de pago: se vuelven a resolver fechas de pago y casino. */
  onGrupoPagoChange(_id: number | null): void {
    this.limpiarTrazaPago({ conservarGrupo: true });
    this.aplicarObligatoriedadGrupoPago();

    // El grupo no es (todavia) de este centro. No se pregunta al backend: responderia 409
    // GRUPO_PAGO_NO_CONFIGURADO, que es justo lo que ya sabemos por `asignada`. En su
    // lugar se pide el calendario y se deja el NOMBRE apuntado; las fechas y el casino
    // llegan al guardar, cuando el grupo ya este asignado.
    if (this.grupoPorAsignar) {
      const sel = this.grupoPagoSel!;
      this.vacanteForm.patchValue({ grupo_pago_nombre_snapshot: sel.nombre }, { emitEvent: false });
      this.errorPagoCasino = null;
      this.cargarCalendariosPago();
      return;
    }

    this.vacanteForm.get('calendario_pago_nuevo')!.setValue(null, { emitEvent: false });
    this.resolverPagoCasinoDelGrupo();
  }

  /**
   * Calendarios activos para asignar el grupo. Se piden una vez por dialogo, y se propone
   * el que YA usan los grupos de este centro cuando todos coinciden: es el dato que hay,
   * no una suposicion, y en un centro con un solo calendario ahorra la eleccion. Si
   * discrepan no se propone nada: elegir uno al azar fijaria cuando se le paga a la gente.
   */
  private cargarCalendariosPago(): void {
    const proponer = () => {
      const ctrl = this.vacanteForm.get('calendario_pago_nuevo')!;
      if (ctrl.value != null) return;
      const usados = [...new Set(
        this.gruposPagoAsignados.map((g) => g.calendario_pago_id).filter((x): x is number => x != null),
      )];
      if (usados.length === 1) ctrl.setValue(usados[0], { emitEvent: false });
    };

    if (this.calendariosPago.length) { proponer(); return; }
    this.cascada
      .calendariosPago()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((lista) => {
        this.calendariosPago = lista;
        proponer();
      });
  }

  valorCalendario = (c: CalendarioPago) => c.id;
  etiquetaCalendario = (c: CalendarioPago) => c.codigo;
  /** Lo que distingue un calendario de otro es CUANDO paga; aqui si hace falta verlo. */
  detalleCalendario = (c: CalendarioPago) => c.texto_documento ?? null;

  /**
   * Resuelve FECHAS DE PAGO y CASINO en el backend y guarda su traza.
   *
   * Los dos textos se guardan como snapshot junto a las referencias: así un
   * cambio posterior en el calendario o en los valores del casino no reescribe
   * lo que ya se publicó. Si el backend no puede resolver, no se inventa nada:
   * se deja la traza vacía y se muestra el código.
   */
  private resolverPagoCasinoDelGrupo(alResolver?: (ok: boolean) => void): void {
    const centroId = this.centroSel?.id ?? null;
    const grupoPagoId = this.vacanteForm.get('grupo_pago_ref')?.value ?? null;
    if (centroId == null || grupoPagoId == null) {
      this.errorPagoCasino = null;
      alResolver?.(false);
      return;
    }

    this.cascada
      .resolverPagoCasino({ centroId, grupoPagoId })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        if (res.ok) {
          const r = res.resolucion;
          // Una advertencia (hoy solo CALENDARIO_VENCIDO) no impide publicar,
          // pero se muestra: el contrato imprimiría unas fechas ya pasadas.
          this.errorPagoCasino = r.advertencias?.length ? r.advertencias[0] : null;
          this.vacanteForm.patchValue({
            grupo_pago_ref: r.grupo_pago_id,
            grupo_pago_nombre_snapshot: r.grupo_pago_nombre,
            calendario_pago_ref: r.calendario_pago_id,
            fechas_pago_texto_snapshot: r.fechas_pago_texto,
            politica_casino_ref: r.politica_casino_id,
            casino_origen_resolucion: r.casino_origen,
            casino_texto_snapshot: r.casino_texto,
          }, { emitEvent: false });
          alResolver?.(true);
          return;
        }
        // No se pudo resolver (casino sin parametrizar, o sin conexion). Las fechas y el
        // casino se quedan vacios —y se avisa en pantalla—, pero el NOMBRE del grupo se
        // conserva: es la eleccion de quien publica, es lo que hereda Contratacion, y un
        // fallo de red no tiene por que borrarla.
        this.limpiarTrazaPago({ conservarGrupo: true });
        const sel = this.grupoPagoSel;
        if (sel) {
          this.vacanteForm.patchValue({ grupo_pago_nombre_snapshot: sel.nombre }, { emitEvent: false });
        }
        this.errorPagoCasino = res.codigo;
        alResolver?.(false);
      });
  }

  /** Borra la traza del pago y el casino; se rehace al volver a resolver. */
  private limpiarTrazaPago(opts: { conservarGrupo: boolean } = { conservarGrupo: false }): void {
    const patch: Record<string, unknown> = {
      grupo_pago_nombre_snapshot: null,
      calendario_pago_ref: null,
      fechas_pago_texto_snapshot: null,
      politica_casino_ref: null,
      casino_origen_resolucion: null,
      casino_texto_snapshot: null,
    };
    if (!opts.conservarGrupo) patch['grupo_pago_ref'] = null;
    this.vacanteForm.patchValue(patch, { emitEvent: false });
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
   * Resuelve la LABOR del centro+cargo y guarda su traza.
   *
   * YA NO ESCRIBE EN «Características del cargo» (2026-09-03, a petición del
   * usuario): ese campo se redacta a mano SIEMPRE, sin importar el área ni el
   * cargo elegidos. Antes proponía el texto —del backend si el centro estaba
   * parametrizado, y si no de la hoja cableada `labores-por-mes.data.ts`— y eso
   * es justo lo que se pidió quitar.
   *
   * La llamada a `resolver-labor` SIGUE haciéndose, porque no era solo para el
   * texto: devuelve la traza (configuración, regla, código de labor, esquema,
   * origen) que se guarda con la vacante y con la que después se explica de
   * dónde salió su labor. Quitarla habría publicado vacantes sin esa traza.
   *
   * LA FECHA ES LA DE INGRESO Y NINGUNA OTRA (2026-09-04, a petición del usuario).
   * Antes caía a la fecha de prueba técnica y, en último término, a la de
   * publicación —es decir, a HOY—, y eso hacía que la labor mostrada fuera la del
   * mes en curso y no la del mes en que la persona entra a trabajar. Sin fecha de
   * ingreso no se resuelve nada: el campo se queda vacío, que es la respuesta
   * honesta, en vez de enseñar la labor de otro mes.
   */
  private resolverLaborDelCargo(): void {
    const v = this.vacanteForm.getRawValue();
    const fecha = this.soloDia(v.fechadeIngreso);
    if (!fecha) {
      this.limpiarTrazaLabor();
      this.errorLabor = null;
      return;
    }

    // Solo hay a quien preguntar si el centro está parametrizado: `resolver-labor`
    // sabe de reglas, esquemas y overrides, y devuelve la traza (configuración,
    // regla, código) que se guarda con la vacante.
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
            // El texto resuelto NO se vuelca en el campo: solo se guarda como
            // `labor_descripcion_snapshot` para la traza.
            return;
          }

          // CENTRO PARAMETRIZADO Y EL BACKEND NO RESUELVE: se dice, no se tapa.
          // La vacante se puede publicar igual —el texto se escribe a mano—, pero
          // queda SIN traza de labor, y eso hay que verlo antes de guardar, no
          // descubrirlo cuando haga falta generar sus documentos.
          this.limpiarTrazaLabor();
          this.errorLabor = res.ok ? 'RESOLUCION_VACIA' : res.codigo;
        });
      return;
    }

    // Sin centro parametrizado no hay a quien preguntar, y ya no queda nada que
    // proponer: el camino legacy contra `labores-por-mes.data.ts` se retiró con
    // el autocompletado, que era su único uso aquí.
    this.errorLabor = null;
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

    // Ya hay un PUT de parametrizacion en vuelo: un segundo clic mandaria la misma
    // asignacion otra vez.
    if (this.asignandoGrupo) return;

    // ✅ Si la suma no cuadra o excede, el form queda INVALID y NO guarda
    if (this.vacanteForm.invalid) {
      // Y se ABREN las secciones a las que les falta algo. Plegar ahorra espacio,
      // pero un campo obligatorio vacío escondido dentro de una sección cerrada
      // deja el botón sin responder y sin decir por qué.
      this.abrirSeccionesIncompletas();
      return;
    }

    // El grupo elegido no es de este centro: se ASIGNA en el parametrizador y solo
    // despues se cierra, ya con las fechas de pago y el casino resueltos.
    if (this.grupoPorAsignar) {
      this.asignarGrupoAlCentroYCerrar();
      return;
    }

    this.dialogRef.close(this.vacanteForm.getRawValue());
  }

  /**
   * Asigna al centro el grupo elegido y cierra con la traza puesta.
   *
   * Por que se escribe la parametrizacion desde aqui: el grupo decide las fechas de pago
   * y el casino del contrato, y antes solo se podian elegir los que alguien hubiera
   * configurado antes en Parametrizacion de vacantes. Quien publica sabe a que grupo va
   * la contratacion; obligarle a pedir que se configure —o cablear la equivalencia en el
   * codigo— era el problema. Asi el parametrizador queda completo desde donde aparece la
   * necesidad, y sigue siendo la unica fuente: esto no guarda una copia, guarda la
   * ASIGNACION y despues pregunta.
   *
   * El PUT es de REEMPLAZO TOTAL, asi que viajan los que ya estaban mas el nuevo. Si el
   * backend lo rechaza (un casino que contradice el grupo, por ejemplo) no se cierra: se
   * muestra el codigo y la vacante no se guarda con una traza a medias.
   */
  private asignarGrupoAlCentroYCerrar(): void {
    const centroId = this.centroSel?.id ?? null;
    const sel = this.grupoPagoSel;
    const calendarioId: number | null = this.vacanteForm.get('calendario_pago_nuevo')?.value ?? null;
    if (centroId == null || !sel || calendarioId == null) return;

    // Los que YA estaban tienen que viajar con su calendario: el PUT reemplaza la lista
    // entera y lo que no vaya se da de baja. `calendario_pago_id` es NOT NULL en la tabla,
    // asi que si alguno llega sin el, el problema es la lectura y NO se toca nada: filtrar
    // en silencio desasignaria un grupo que si estaba configurado.
    const previos = this.gruposPagoAsignados;
    if (previos.some((g) => g.calendario_pago_id == null)) {
      this.errorPagoCasino = 'ERROR_ASIGNACION';
      this.plegadas.delete(2);
      return;
    }
    const items = [
      ...previos.map((g) => ({
        grupo_pago_id: g.grupo_pago_id,
        calendario_pago_id: g.calendario_pago_id as number,
      })),
      { grupo_pago_id: sel.grupo_pago_id, calendario_pago_id: calendarioId },
    ];

    this.asignandoGrupo = true;
    this.errorPagoCasino = null;
    this.cascada
      .asignarGruposAlCentro(centroId, items)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        if (!res.ok) {
          this.asignandoGrupo = false;
          this.errorPagoCasino = res.codigo;
          this.plegadas.delete(2);
          return;
        }
        // Vuelve la lista con el grupo ya `asignada`, asi que `grupoPorAsignar` se apaga
        // y el calendario deja de pedirse.
        this.gruposPago = res.grupos;
        this.vacanteForm.get('calendario_pago_nuevo')!.setValue(null, { emitEvent: false });
        this.aplicarObligatoriedadGrupoPago();
        this.resolverPagoCasinoDelGrupo((ok) => {
          this.asignandoGrupo = false;
          if (!ok) {
            // El grupo YA quedo asignado; lo que falta es otra cosa (casino sin
            // parametrizar, sin conexion). Se dice y no se guarda la vacante: al
            // reintentar, el grupo ya es del centro y el camino es el normal.
            this.plegadas.delete(2);
            return;
          }
          this.dialogRef.close(this.vacanteForm.getRawValue());
        });
      });
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
