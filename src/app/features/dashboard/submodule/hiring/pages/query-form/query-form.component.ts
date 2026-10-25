import { SharedModule } from '@/app/shared/shared.module';
import {  Component, ChangeDetectionStrategy, signal } from '@angular/core';
import Swal from 'sweetalert2';
import { SelectionModel } from '@angular/cdk/collections';
import { HiringService } from '../../service/hiring.service';
import { ColumnaTabla, SugerenciaBusqueda, TABLA_ESTANDAR } from '@/app/shared/components/tabla-estandar';
import { concatMap, from, toArray } from 'rxjs';

/** Cédulas por petición: cada fila son ~20 lecturas en ms-hr y el gateway corta a los 30 s. */
const CEDULAS_POR_LOTE = 50;

/**
 * Saca las cédulas de un bloque pegado: una columna de Excel, o separadas por
 * comas, espacios o punto y coma. Quita el `.0` y los puntos de miles que deja
 * Excel y la X inicial de los PPT (el backend busca con y sin ella).
 */
function extraerCedulas(texto: string): string[] {
  const out = new Set<string>();
  for (const trozo of (texto ?? '').split(/[\s,;|]+/)) {
    const c = trozo.replace(/^["']+|["']+$/g, '').replace(/\.0+$/, '').replace(/\./g, '')
      .replace(/^[xX]+(?=\d)/, '');
    if (/^\d{4,15}$/.test(c)) out.add(c);
  }
  return [...out];
}

/**
 * Las columnas de la pantalla = la base de contratación de la L a la FG (cols 12-195 de
 * base-cruce.xlsx), EN ESE ORDEN y con sus encabezados, para pegar el bloque en la base sin que
 * se corra nada (2026-10-17). Sin dato = en blanco. [id, encabezado, campo del backend si difiere].
 * Las de hijos van aparte (5 espacios).
 */
const COLUMNAS_ANTES_DE_HIJOS: ReadonlyArray<readonly [string, string, string?]> = [
  ['numerodeceduladepersona', 'Número de Identificación Trabajador'],
  ['primer_apellido', 'Primer Apellido'],
  ['segundo_apellido', 'Segundo Apellido'],
  ['primer_nombre', 'Primer Nombre'],
  ['segundo_nombre', 'Segundo Nombre'],
  ['fecha_nacimiento', 'Fecha de Nacimiento (DD/MM/AAAA)'],
  ['genero', 'Sexo (F - M)'],
  ['estado_civil', 'Estado civil (SO-UL - CA-SE-VI)'],
  ['direccion_residencia', 'Dirección de residencia (Sin simbolos)'],
  ['barrio', 'Barrio'],
  ['celular', 'Teléfono móvil'],
  ['primercorreoelectronico', 'Correo electrónico E-mail'],
  ['municipio', 'Ciudad de Residencia'],
  ['fecha_expedicion_cc', 'Fecha Expedición CC'],
  ['municipio_expedicion_cc', 'Municipio Expedición CC'],
  ['departamento_expedicion_cc', 'Departamento Expedición CC'],
  ['lugar_nacimiento_municipio', 'Lugar de Nacimiento Municipio'],
  ['lugar_nacimiento_departamento', 'Lugar de Nacimiento Departamento'],
  ['rh', 'Rh'],
  ['zurdo_diestro', 'Zurdo/Diestro'],
  ['eps', 'EPS'],
  ['afp', 'AFP'],
  ['afc', 'AFC'],
  ['centro_costo_carne', 'Centro de costo Para el Carné'],
  ['persona_contratacion', 'Persona que hace Contratación'],
  ['edad', 'Edad Apropiada'],
  ['escolaridad', 'Escolaridad (1-11)'],
  ['tecnico', 'Técnico'],
  ['tecnologo', 'Tecnólogo'],
  ['universidad', 'Universidad'],
  ['especializacion', 'Especialización'],
  ['otros_estudios', 'Otros'],
  ['nombre_institucion', 'Nombre Institución'],
  // Como en la base (cols 45-46): primero el año y después el título.
  ['ano_finalizacion', 'Año de Finalización'],
  ['titulo_obtenido', 'Título Obtenido'],
  ['chaqueta', 'Chaqueta'],
  ['pantalon', 'Pantalón'],
  ['camisa', 'Camisa'],
  ['calzado', 'Calzado'],
  ['familiar_emergencia', 'Familiar en caso de emergencia'],
  ['parentesco_familiar_emergencia', 'Parentesco'],
  ['direccion_familiar_emergencia', 'Dirección'],
  ['barrio_familiar_emergencia', 'Barrio'],
  ['telefono_familiar_emergencia', 'Teléfono'],
  ['ocupacion_familiar_emergencia', 'Ocupación'],
  ['nombre_conyugue', 'Nombre Pareja'],
  ['vive_con_el_conyugue', 'Vive Si/No'],
  ['ocupacion_conyugue', 'Ocupación'],
  ['direccion_laboral_conyugue', 'Dirección'],
  ['telefono_conyugue', 'Teléfono'],
  ['barrio_municipio_conyugue', 'Barrio'],
  ['num_hijos_dependen_economicamente', 'No de Hijos Dependientes'],
];
const COLUMNAS_DESPUES_DE_HIJOS: ReadonlyArray<readonly [string, string, string?]> = [
  // Contrato y vacante (base cols 94-105), entre los hijos y el padre como en la base.
  ['centro_costos', 'Ccostos'],
  ['subcentro_costos', 'Subcentro'],
  ['grupo', 'Grupo'],
  ['categoria', 'Categoría'],
  ['operacion', 'Operación'],
  ['sublabor', 'Sublabor', 'area'],
  ['salario', 'Salario'],
  ['auxilio_transporte', 'AUXILIO DE TRANSPORTE'],
  ['ruta', 'RUTA'],
  // Sin fuente todavía: va en blanco para no correr las columnas al pegar en la base.
  ['valor_transporte', 'Valor Transporte'],
  ['horas_extras', 'HORAS EXTRAS'],
  ['porcentaje_arl', '% ARL'],
  ['nombre_padre', 'Nombre Padre'],
  ['vive_padre', 'Vive Si /No'],
  ['ocupacion_padre', 'Ocupación'],
  ['direccion_padre', 'Dirección'],
  ['telefono_padre', 'Teléfono'],
  ['barrio_padre', 'Barrio/Municipio'],
  ['nombre_madre', 'Nombre Madre'],
  ['vive_madre', 'Vive Si /No'],
  ['ocupacion_madre', 'Ocupación'],
  ['direccion_madre', 'Dirección'],
  ['telefono_madre', 'Teléfono'],
  ['barrio_madre', 'Barrio/Municipio'],
  ['nombre_referencia_personal1', 'Nombre Referencia Personal 1'],
  ['telefono_referencia_personal1', 'Teléfono*'],
  ['ocupacion_referencia_personal1', 'Ocupación'],
  ['nombre_referencia_personal2', 'Nombre Referencia Personal 2'],
  ['telefono_referencia_personal2', 'Teléfono*'],
  ['ocupacion_referencia_personal2', 'Ocupación'],
  ['nombre_referencia_familiar1', 'Nombre Referencia Familiar 1'],
  ['telefono_referencia_familiar1', 'Teléfono*'],
  ['ocupacion_referencia_familiar1', 'Ocupación'],
  ['nombre_referencia_familiar2', 'Nombre Referencia Familiar 2'],
  ['telefono_referencia_familiar2', 'Teléfono*'],
  ['ocupacion_referencia_familiar2', 'Ocupación'],
  ['nombre_expe_laboral1_empresa', 'Nombre Empresa Experiencia Laboral 1'],
  ['direccion_empresa1', 'Dirección Empresa'],
  ['telefonos_empresa1', 'Teléfonos* (Obligatorio)'],
  ['nombre_jefe_empresa1', 'Nombre Jefe Inmediato'],
  // En la experiencia 1 el formato pide el ÁREA (no el cargo): la que marcó el candidato.
  ['area_experiencia_empresa1', 'AREA DE EXPERIENCIA', 'area_experiencia'],
  ['fecha_retiro_empresa1', 'Fecha de Retiro'],
  ['motivo_retiro_empresa1', 'Motivo Retiro'],
  ['nombre_expe_laboral2_empresa', 'Nombre Empresa Experiencia Laboral 2'],
  ['direccion_empresa2', 'Dirección Empresa'],
  ['telefonos_empresa2', 'Teléfonos*'],
  ['nombre_jefe_empresa2', 'Nombre Jefe Inmediato'],
  ['cargo_empresa2', 'Cargo del Trabajador'],
  ['fecha_retiro_empresa2', 'Fecha de Retiro'],
  ['motivo_retiro_empresa2', 'Motivo Retiro'],
  ['nombre_carnet', 'Nombre del Carnet'],
  ['seguro_funerario', 'Desea Plan Funerario'],
  // Pago y acceso: cuenta y tarjeta completas (la tabla las copia como texto); la clave solo dice ASIGNADA.
  ['numero_cuenta', 'Número Cuenta/ Celular'],
  ['numero_tarjeta', 'Número Tarjeta/ Tipo de Cuenta'],
  ['clave_asignada', 'Clave para Asignar'],
  ['examenes', 'Examen Salud Ocupacional'],
  ['apto_cargo', 'Apto para el Cargo? Sí o No'],
  ['examen_sangre', 'EXAMEN DE SANGRE'],
  ['planilla_fumigacion', 'PLANILLA FUMIGACION'],
  ['labores_especificas', 'LABOR ESPECIFICA JARDINES'],
  ['tipo_experiencia_flores', 'TIPO DE EXPERIENCIA JARDINES'],
  ['eps_afiliada', 'Nombre de la EPS afiliada'],
  ['eps_a_trasladar', 'EPS A TRASLADAR'],
  ['afp_afiliada', 'Nombre de AFP Afiliado'],
  ['afp_a_trasladar', 'AFP A TRASLADAR'],
  ['semanas_cotizadas', 'NÚMERO DE SEMANAS COTIZADAS'],
  ['caja_compensacion', 'Afiliación Caja de compesación'],
  // 161, 162, 164 y 165 son controles que la oficina llenaba a mano: sin fuente, van en blanco
  // para que al pegar en la base no se corra nada.
  ['revision_fecha_ingreso_arl', 'Revisión de Fecha de Ingreso ARL'],
  ['confirmacion_ingresos_correos', 'Confirmación de los Ingresos Envío de correos a las Fincas a diario Confirmacion hasta las 12:30'],
  ['fecha_confirmacion_ingreso', 'Fecha confirmación Ingreso a las Empresas Usuarias'],
  ['afiliacion_enviada_fecha', 'Afiliación enviada con fecha (Coomeva-Nueva Eps - Sura - S.O.S - Salud Vida -Compensar - Famisanar'],
  ['revision_confirmado_vs_nomina', 'Revisión Personal Confirmado Empresas Usuarias VS Nómina los días 14 y los días 29 de cada Mes'],
  ['referenciacion_personal1', 'Referenciación Personal 1'],
  ['referenciacion_personal2', 'Referenciación Personal 2'],
  ['referenciacion_familiar1', 'Referenciación Familiar 1'],
  ['referenciacion_familiar2', 'Referenciación Familiar 2'],
  ['referenciacion_exp1', 'Referenciación Experiencia Laboral 1'],
  ['referenciacion_exp2', 'Referenciación Experiencia Laboral 2'],
  ['revision_registraduria', 'Revisión Registraduria (Fecha entrega CC )'],
  // Entrevista (base 173-194), con los encabezados de la base.
  ['como_se_entero', 'COMO SE ENTERO DEL EMPLEO'],
  ['tiene_experiencia_laboral', 'Tiene Experiencia laboral ?'],
  ['empresas_laborado', 'Empresas de flores que ha trabajado (Separarlas con ,)'],
  ['area_experiencia', '¿En que area?'],
  ['labores_realizadas', 'Describa paso a paso como es su labora (ser lo mas breve posible)'],
  ['rendimiento', 'Califique su rendimiento'],
  ['porqueRendimiento', '¿Por que se da esta auto calificación?'],
  ['hacecuantoviveenlazona', 'Hace cuanto vive en la zona'],
  ['tipo_vivienda', 'Tipo de vivienda'],
  ['personas_con_quien_convive', 'Con quien Vive'],
  ['estudia_actualmente', 'Estudia Actualmente'],
  ['personas_a_cargo', 'Personas a cargo'],
  ['num_hijos_dependen_economicamente2', 'Numero de hijosacargo'],
  ['quien_los_cuida', 'Quien los cuida?'],
  ['como_es_su_relacion_familiar', 'Como es su relacion Familiar'],
  ['porqueLofelicitarian', 'Segun su Experiencia y desempeño laboral por que motivos lo han felicitado'],
  ['malentendido', 'Ha tenido algun malentendido o situacion conflictiva en algun trabajo, Si si en otro especificar por que:'],
  ['actividadesDi', 'Esta dispuesto a realizar actividades diferentes al cargo :'],
  ['experienciaSignificativa', 'Mencione una experiencia significativa en su trabajo'],
  ['expectativas_de_vida', 'Que proyecto de vida tiene de aqui a 3 años'],
  ['tipo_vivienda_2p', 'La vivienda es:'],
  ['motivacion', '¿Cuál es su motivación?'],
  ['observaciones', 'OBSERVACIONES'],
];
function columnaCampo([id, header, campo]: readonly [string, string, string?]): ColumnaTabla<any> {
  const c = campo ?? id;
  return {
    id, header,
    valor: (r) => r?.[c] ?? '',
    // Prioridad 1 en TODAS: la pantalla es para ver el formulario completo. Con
    // prioridad 3 la tabla ocultaba todo menos cédula y nombres bajo 1024 px de
    // ventana (laptop con el menú abierto) y parecía que no traía los datos.
    prioridad: 1,
    tarjeta: id === 'primer_apellido' ? 'titulo' : id === 'numerodeceduladepersona' ? 'subtitulo' : 'cuerpo',
  };
}

/** Los 5 espacios de hijos del formato: en blanco cuando no hay ese hijo o ese dato. */
function columnasHijos(): ColumnaTabla<any>[] {
  // Solo el nombre lleva el número del hijo, como en el formato.
  const campos: ReadonlyArray<readonly [string, string, string]> = [
    ['nombre_hijo', 'Nombre Hijo', 'nombre'],
    ['sexo_hijo', 'Sexo', 'sexo'],
    ['fecha_nacimiento_hijo', 'Fecha Nacimiento', 'fecha_nacimiento'],
    ['no_documento_hijo', 'No de Documento de Identidad', 'no_documento'],
    ['estudia_o_trabaja_hijo', 'Estudia o Trabaja', 'estudia_o_trabaja'],
    ['curso_hijo', 'Curso', 'curso'],
  ];
  const cols: ColumnaTabla<any>[] = [];
  for (let index = 0; index < 5; index++) {
    for (const [id, header, campo] of campos) {
      cols.push({
        id: `${id}_${index + 1}`,
        // Como en el formato: el hijo 1 dice "Estudia o Trabaja" y del 2 al 5 "Estudia o trabaja".
        header: id === 'nombre_hijo' ? `${header} ${index + 1}`
          : id === 'estudia_o_trabaja_hijo' && index > 0 ? 'Estudia o trabaja' : header,
        prioridad: 1, tarjeta: 'cuerpo',
        valor: (r) => r?.hijos?.[index]?.[campo] ?? '',
      });
    }
  }
  return cols;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-query-form',
  imports: [
    SharedModule,
    ...TABLA_ESTANDAR,
  ],
  templateUrl: './query-form.component.html',
  styleUrl: './query-form.component.css'
} )
export class QueryFormComponent {
  /** Candidatos elegidos en el buscador (señal: la pantalla es OnPush y sin zone.js). */
  filas = signal<any[]>([]);
  cargando = signal(false);
  /** Filas marcadas en la tabla: son las únicas que sobreviven a una búsqueda nueva. */
  readonly seleccion = new SelectionModel<any>(true, []);
  /** Lo que el backend sugiere para el texto escrito en el buscador de la tabla. */
  sugerencias = signal<SugerenciaBusqueda[]>([]);

  /** Columnas de la tabla estándar (la tabla pagina, busca, ordena y copia). */
  readonly columnas: ColumnaTabla<any>[] = [
    ...COLUMNAS_ANTES_DE_HIJOS.map(columnaCampo),
    ...columnasHijos(),
    ...COLUMNAS_DESPUES_DE_HIJOS.map(columnaCampo),
  ];

  private ultimaBusqueda = '';

  constructor(
    private hiringService: HiringService
  ) { }

  pedirSugerencias(texto: string) {
    this.ultimaBusqueda = texto;
    if (texto.length < 3) {
      this.sugerencias.set([]);
      return;
    }
    this.hiringService.sugerenciasFormularios(texto).subscribe({
      next: (lista) => {
        if (texto !== this.ultimaBusqueda) return; // llegó tarde: ya se escribió otra cosa
        this.sugerencias.set((lista ?? []).map((s) => ({
          id: s.cedula,
          texto: `${s.cedula} · ${s.nombre || 'Sin nombre'}`,
          detalle: s.fecha_inscripcion ? `Inscrito: ${s.fecha_inscripcion}` : undefined,
        })));
      },
      error: () => this.sugerencias.set([]),
    });
  }

  /**
   * Trae el formulario completo del candidato elegido y lo pone arriba en la tabla.
   * De lo que ya había solo se conservan las filas marcadas.
   */
  agregar(cedula: string) {
    this.sugerencias.set([]);
    this.cargando.set(true);
    this.hiringService.consultaFormularios({ cedula }).subscribe({
      next: (resp) => {
        this.cargando.set(false);
        this.ponerArriba(resp?.data ?? []);
      },
      error: (error) => {
        this.cargando.set(false);
        Swal.fire({ icon: 'error', title: 'Error', text: error?.error?.error ?? 'No se pudo traer el formulario.' });
      },
    });
  }

  /**
   * Ctrl+V dentro de la tabla (normalmente en el buscador) con dos o más cédulas:
   * en vez de pegarlas como texto se traen sus formularios. Una sola cédula sigue
   * el camino normal del buscador (sugerencias).
   */
  alPegar(evento: ClipboardEvent) {
    const cedulas = extraerCedulas(evento.clipboardData?.getData('text') ?? '');
    if (cedulas.length < 2) return;
    evento.preventDefault();
    this.cargarCedulas(cedulas);
  }

  /** Botón «Pegar cédulas»: un cuadro donde pegar la columna de Excel. */
  async pegarCedulas() {
    const { value: texto } = await Swal.fire({
      title: 'Pegar cédulas',
      input: 'textarea',
      inputLabel: 'Una por línea (una columna de Excel), o separadas por comas o espacios',
      inputPlaceholder: '1122415324\n1105788627',
      inputAttributes: { rows: '10' },
      showCancelButton: true,
      confirmButtonText: 'Traer formularios',
      cancelButtonText: 'Cancelar',
      inputValidator: (v) => extraerCedulas(v).length ? null : 'No se encontró ninguna cédula en lo pegado.',
    });
    if (!texto) return;
    this.cargarCedulas(extraerCedulas(texto));
  }

  /**
   * Trae los formularios de varias cédulas (en lotes, uno tras otro) y los pone
   * arriba. El backend devuelve una fila vacía para la cédula que no existe:
   * esas no se pintan, se informan.
   */
  private cargarCedulas(cedulas: string[]) {
    const lotes: string[][] = [];
    for (let i = 0; i < cedulas.length; i += CEDULAS_POR_LOTE) lotes.push(cedulas.slice(i, i + CEDULAS_POR_LOTE));
    this.sugerencias.set([]);
    this.cargando.set(true);
    from(lotes).pipe(
      concatMap((lote) => this.hiringService.consultaFormularios({ cedula: lote.join(',') })),
      toArray(),
    ).subscribe({
      next: (respuestas) => {
        this.cargando.set(false);
        const filas: any[] = respuestas.flatMap((r: any) => r?.data ?? []);
        const existe = (f: any) => !!(f?.fecha_inscripcion || f?.primer_nombre || f?.primer_apellido);
        const encontradas = filas.filter(existe);
        const faltan = filas.filter((f) => !existe(f)).map((f) => String(f?.numerodeceduladepersona ?? ''));
        this.ponerArriba(encontradas);
        if (!faltan.length) return;
        Swal.fire({
          icon: encontradas.length ? 'info' : 'warning',
          title: `${encontradas.length} de ${cedulas.length} cédulas encontradas`,
          html: `Sin formulario registrado:<br><code style="white-space:pre-wrap">${faltan.join(', ')}</code>`,
        });
      },
      error: (error) => {
        this.cargando.set(false);
        Swal.fire({ icon: 'error', title: 'Error', text: error?.error?.error ?? 'No se pudieron traer los formularios.' });
      },
    });
  }

  /** Pone las filas nuevas arriba; de lo que ya había solo se conservan las marcadas. */
  private ponerArriba(nuevas: any[]) {
    const ids = new Set(nuevas.map((f) => f.numerodeceduladepersona));
    const conservadas = this.filas().filter(
      (f) => this.seleccion.isSelected(f) && !ids.has(f.numerodeceduladepersona));
    this.seleccion.clear();
    this.seleccion.select(...conservadas);
    this.filas.set([...nuevas, ...conservadas]);
  }
}
