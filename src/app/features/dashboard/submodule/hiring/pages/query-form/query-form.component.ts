import { SharedModule } from '@/app/shared/shared.module';
import {  Component, ChangeDetectionStrategy, signal } from '@angular/core';
import Swal from 'sweetalert2';
import { HiringService } from '../../service/hiring.service';
import { ColumnaTabla, TABLA_ESTANDAR } from '@/app/shared/components/tabla-estandar';

/**
 * Columnas con dato de la tabla, en el mismo orden que `displayedColumns`
 * (sin las columnas vacías, que solo sirven para «Copiar Tabla» a la
 * plantilla de Excel): [id, encabezado, campo si difiere del id].
 */
const COLUMNAS_ANTES_DE_HIJOS: ReadonlyArray<readonly [string, string, string?]> = [
  ['numerodeceduladepersona', 'Número de Cédula'],
  ['primer_apellido', 'Primer Apellido'],
  ['segundo_apellido', 'Segundo Apellido'],
  ['primer_nombre', 'Primer Nombre'],
  ['segundo_nombre', 'Segundo Nombre'],
  ['fecha_nacimiento', 'Fecha de Nacimiento'],
  ['genero', 'Género'],
  ['estado_civil', 'Estado Civil'],
  ['direccion_residencia', 'Dirección de Residencia'],
  ['barrio', 'Barrio'],
  ['celular', 'Celular'],
  ['primercorreoelectronico', 'Primer Correo Electrónico'],
  ['municipio', 'Municipio'],
  ['fecha_expedicion_cc', 'Fecha de Expedición Cédula'],
  ['municipio_expedicion_cc', 'Municipio Expedición Cédula'],
  ['departamento_expedicion_cc', 'Departamento Expedición Cédula'],
  ['lugar_nacimiento_municipio', 'Municipio de Nacimiento'],
  ['lugar_nacimiento_departamento', 'Departamento de Nacimiento'],
  ['rh', 'RH'],
  ['zurdo_diestro', 'Zurdo/Diestro'],
  ['escolaridad', 'Escolaridad'],
  ['nombre_institucion', 'Nombre de la Institución'],
  ['ano_finalizacion', 'Año de Finalización'],
  ['titulo_obtenido', 'Título Obtenido'],
  ['chaqueta', 'Talla Chaqueta'],
  ['pantalon', 'Talla Pantalón'],
  ['camisa', 'Talla Camisa'],
  ['calzado', 'Talla Calzado'],
  ['familiar_emergencia', 'Familiar de Emergencia'],
  ['parentesco_familiar_emergencia', 'Parentesco Familiar de Emergencia'],
  ['direccion_familiar_emergencia', 'Dirección Familiar de Emergencia'],
  ['barrio_familiar_emergencia', 'Barrio Familiar de Emergencia'],
  ['telefono_familiar_emergencia', 'Teléfono Familiar de Emergencia'],
  ['ocupacion_familiar_emergencia', 'Ocupación Familiar de Emergencia'],
  ['nombre_conyugue', 'Nombre del Cónyuge'],
  ['vive_con_el_conyugue', 'Vive con el Cónyuge'],
  ['ocupacion_conyugue', 'Ocupación del Cónyuge'],
  ['direccion_laboral_conyugue', 'Dirección Laboral del Cónyuge'],
  ['telefono_conyugue', 'Teléfono del Cónyuge'],
  ['barrio_municipio_conyugue', 'Barrio/Municipio del Cónyuge'],
  ['num_hijos_dependen_economicamente', 'N° Hijos Dependientes'],
];
const COLUMNAS_DESPUES_DE_HIJOS: ReadonlyArray<readonly [string, string, string?]> = [
  ['nombre_padre', 'Nombre del Padre'],
  ['vive_padre', 'Vive el Padre'],
  ['ocupacion_padre', 'Ocupación del Padre'],
  ['direccion_padre', 'Dirección del Padre'],
  ['telefono_padre', 'Teléfono del Padre'],
  ['barrio_padre', 'Barrio del Padre'],
  ['nombre_madre', 'Nombre de la Madre'],
  ['vive_madre', 'Vive la Madre'],
  ['ocupacion_madre', 'Ocupación de la Madre'],
  ['direccion_madre', 'Dirección de la Madre'],
  ['telefono_madre', 'Teléfono de la Madre'],
  ['barrio_madre', 'Barrio de la Madre'],
  ['nombre_referencia_personal1', 'Nombre Referencia Personal 1'],
  ['telefono_referencia_personal1', 'Teléfono Referencia Personal 1'],
  ['ocupacion_referencia_personal1', 'Ocupación Referencia Personal 1'],
  ['nombre_referencia_personal2', 'Nombre Referencia Personal 2'],
  ['telefono_referencia_personal2', 'Teléfono Referencia Personal 2'],
  ['ocupacion_referencia_personal2', 'Ocupación Referencia Personal 2'],
  ['nombre_referencia_familiar1', 'Nombre Referencia Familiar 1'],
  ['telefono_referencia_familiar1', 'Teléfono Referencia Familiar 1'],
  ['ocupacion_referencia_familiar1', 'Ocupación Referencia Familiar 1'],
  ['nombre_referencia_familiar2', 'Nombre Referencia Familiar 2'],
  ['telefono_referencia_familiar2', 'Teléfono Referencia Familiar 2'],
  ['ocupacion_referencia_familiar2', 'Ocupación Referencia Familiar 2'],
  ['nombre_expe_laboral1_empresa', 'Nombre Empresa'],
  ['direccion_empresa1', 'Dirección Empresa'],
  ['telefonos_empresa1', 'Teléfonos Empresa'],
  ['nombre_jefe_empresa1', 'Nombre Jefe'],
  ['cargo_empresa1', 'Cargo Jefe'],
  ['fecha_retiro_empresa1', 'Fecha de Retiro'],
  ['motivo_retiro_empresa1', 'Motivo Retiro'],
  ['como_se_entero', '¿Cómo se Enteró?'],
  ['tiene_experiencia_laboral', '¿Tiene Experiencia Laboral?'],
  ['empresas_laborado', 'Empresas de flores que ha trabajado (Separarlas con ,)'],
  ['area_experiencia', '¿En que area?'],
  ['labores_realizadas', 'Labores Realizadas'],
  ['rendimiento', 'Rendimiento'],
  ['porqueRendimiento', '¿Por qué ese Rendimiento?'],
  ['hacecuantoviveenlazona', '¿Hace Cuánto Vive en la Zona?'],
  ['tipo_vivienda', 'Tipo de Vivienda'],
  ['personas_con_quien_convive', 'Personas con Quien Convive'],
  ['estudia_actualmente', '¿Estudia Actualmente?'],
  ['personas_a_cargo', 'Personas a Cargo'],
  ['num_hijos_dependen_economicamente2', 'N° Hijos Dependientes', 'num_hijos_dependen_economicamente'],
  ['quien_los_cuida', '¿Quién los Cuida?'],
  ['como_es_su_relacion_familiar', '¿Cómo es su Relación Familiar?'],
  ['porqueLofelicitarian', '¿Por qué lo Felicitarían?'],
  ['malentendido', 'Malentendido'],
  ['actividadesDi', 'Actividades Diarias'],
  ['experienciaSignificativa', 'Experiencia Significativa'],
  ['expectativas_de_vida', 'Expectativas de Vida'],
  ['tipo_vivienda_2p', 'Tipo de Vivienda (2P)'],
  ['motivacion', 'Motivación'],
  ['marcaTemporal', 'Marca Temporal'],
];
/** Estas se ven también en el celular; el resto solo desde 1024 px. */
const COLUMNAS_PRINCIPALES = new Set(['numerodeceduladepersona', 'primer_apellido', 'primer_nombre']);

function columnaCampo([id, header, campo]: readonly [string, string, string?]): ColumnaTabla<any> {
  const c = campo ?? id;
  return {
    id, header,
    valor: (r) => r?.[c] ?? '',
    prioridad: COLUMNAS_PRINCIPALES.has(id) ? 1 : 3,
    tarjeta: id === 'primer_apellido' ? 'titulo' : id === 'numerodeceduladepersona' ? 'subtitulo' : 'cuerpo',
  };
}

/** Columnas de los 5 hijos (antes generadas en la plantilla): «N/A» si no hay dato. */
function columnasHijos(): ColumnaTabla<any>[] {
  const campos: ReadonlyArray<readonly [string, string, string]> = [
    ['nombre_hijo', 'Nombre del Hijo', 'nombre'],
    ['sexo_hijo', 'Sexo del Hijo', 'sexo'],
    ['fecha_nacimiento_hijo', 'Fecha de Nacimiento del Hijo', 'fecha_nacimiento'],
    ['no_documento_hijo', 'N° Documento del Hijo', 'no_documento'],
    ['estudia_o_trabaja_hijo', 'Estudia o Trabaja Hijo', 'estudia_o_trabaja'],
    ['curso_hijo', 'Curso del Hijo', 'curso'],
  ];
  const cols: ColumnaTabla<any>[] = [];
  for (let index = 0; index < 5; index++) {
    for (const [id, header, campo] of campos) {
      cols.push({
        id: `${id}_${index + 1}`, header: `${header} ${index + 1}`, prioridad: 3, tarjeta: 'cuerpo',
        valor: (r) => r?.hijos?.[index]?.[campo] ?? '',
        formato: (r) => r?.hijos?.[index]?.[campo] || 'N/A',
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
  cedula: string = '';
  /** Registros encontrados (señal: la pantalla es OnPush y sin zone.js). */
  filas = signal<any[]>([]);

  /** Columnas de la tabla estándar (la tabla pagina, busca, ordena y copia). */
  readonly columnas: ColumnaTabla<any>[] = [
    ...COLUMNAS_ANTES_DE_HIJOS.map(columnaCampo),
    ...columnasHijos(),
    ...COLUMNAS_DESPUES_DE_HIJOS.map(columnaCampo),
  ];

  displayedColumns: string[] = [
    'numerodeceduladepersona', 'primer_apellido', 'segundo_apellido', 'primer_nombre', 'segundo_nombre',
    'fecha_nacimiento', 'genero', 'estado_civil', 'direccion_residencia', 'barrio', 'celular',
    'primercorreoelectronico', 'municipio', 'fecha_expedicion_cc', 'municipio_expedicion_cc',
    'departamento_expedicion_cc', 'lugar_nacimiento_municipio', 'lugar_nacimiento_departamento', 'rh', 'zurdo_diestro',
    // crear 6 empty columns para los documentos vacios
    'empty1', 'empty2', 'empty3', 'empty4', 'empty5', 'empty6',

    'escolaridad',

    'empty56', 'empty57', 'empty58', 'empty59', 'empty60',

    'nombre_institucion', 'ano_finalizacion', 'titulo_obtenido', 'chaqueta', 'pantalon', 'camisa', 'calzado',
    'familiar_emergencia', 'parentesco_familiar_emergencia', 'direccion_familiar_emergencia', 'barrio_familiar_emergencia',
    'telefono_familiar_emergencia', 'ocupacion_familiar_emergencia', 'nombre_conyugue', 'vive_con_el_conyugue',
    'ocupacion_conyugue', 'direccion_laboral_conyugue', 'telefono_conyugue', 'barrio_municipio_conyugue',

    'num_hijos_dependen_economicamente',
    // crear 12 empty columns para los hijos vacios
    'empty7', 'empty8', 'empty9', 'empty10', 'empty11', 'empty12', 'empty13', 'empty14', 'empty15', 'empty16', 'empty17', 'empty18',

    'nombre_padre', 'vive_padre', 'ocupacion_padre', 'direccion_padre', 'telefono_padre', 'barrio_padre',
    'nombre_madre', 'vive_madre', 'ocupacion_madre', 'direccion_madre', 'telefono_madre', 'barrio_madre',

    'nombre_referencia_personal1', 'telefono_referencia_personal1', 'ocupacion_referencia_personal1',
    'nombre_referencia_personal2', 'telefono_referencia_personal2', 'ocupacion_referencia_personal2',
    'nombre_referencia_familiar1', 'telefono_referencia_familiar1', 'ocupacion_referencia_familiar1',
    'nombre_referencia_familiar2', 'telefono_referencia_familiar2', 'ocupacion_referencia_familiar2',

    'nombre_expe_laboral1_empresa', 'direccion_empresa1', 'telefonos_empresa1', 'nombre_jefe_empresa1', 'cargo_empresa1',
    'fecha_retiro_empresa1', 'motivo_retiro_empresa1',

    // crear 37 empty columns para las experiencias laborales vacias
    'empty20', 'empty21', 'empty22', 'empty23', 'empty24',
    'empty25', 'empty26', 'empty27', 'empty28', 'empty29', 'empty30',
    'empty31', 'empty32', 'empty33', 'empty34', 'empty35', 'empty36',
    'empty37', 'empty38', 'empty39', 'empty40', 'empty41', 'empty42',
    'empty43', 'empty44', 'empty45', 'empty46', 'empty47', 'empty48',
    'empty49', 'empty50', 'empty51', 'empty52', 'empty53', 'empty54',
    'empty55',

    'como_se_entero', 'tiene_experiencia_laboral',
    'empresas_laborado', 'area_experiencia', 'labores_realizadas', 'rendimiento', 'porqueRendimiento',
    'hacecuantoviveenlazona', 'tipo_vivienda', 'personas_con_quien_convive', 'estudia_actualmente',
    'personas_a_cargo', 'num_hijos_dependen_economicamente2',
    'quien_los_cuida', 'como_es_su_relacion_familiar', 'porqueLofelicitarian',
    'malentendido', 'actividadesDi', 'experienciaSignificativa', 'expectativas_de_vida', 'tipo_vivienda_2p', 'motivacion', 'marcaTemporal'
  ];

  constructor(
    private hiringService: HiringService
  ) { }

    // Captura el valor de la cédula ingresada
    onCedulaInput(event: Event) {
      const inputElement = event.target as HTMLInputElement;
      this.cedula = inputElement.value.trim(); // Guarda el valor de la cédula en la variable de clase
    }


    ngOnInit(): void {
      // Índice donde se deben insertar las columnas de los hijos
      const indexHijos = this.displayedColumns.indexOf('num_hijos_dependen_economicamente') + 1;

      // Añadir las columnas dinámicas para los hijos
      const hijosColumns = [];
      for (let i = 1; i <= 5; i++) { // Ajustar según cuántos hijos quieras mostrar, en este caso 5
        hijosColumns.push(`nombre_hijo_${i}`);
        hijosColumns.push(`sexo_hijo_${i}`);
        hijosColumns.push(`fecha_nacimiento_hijo_${i}`);
        hijosColumns.push(`no_documento_hijo_${i}`);
        hijosColumns.push(`estudia_o_trabaja_hijo_${i}`);
        hijosColumns.push(`curso_hijo_${i}`);
      }

      // Inserta las columnas de los hijos después de 'num_hijos_dependen_economicamente'
      this.displayedColumns.splice(indexHijos, 0, ...hijosColumns);


    }

    buscarPorCedula(){
      // Obtención de datos desde el servicio
      this.hiringService.buscarEncontratacion(this.cedula).subscribe(
        (data) => {
          this.filas.set(data.data ?? []);  // Asigna los datos a la tabla estándar
        },
        (error) => {
          // "No se encontraron datos para la cédula ingresada: 78"
          if (error.status === 404) {
            Swal.fire({
              icon: 'error',
              title: 'Error',
              text: `No se encontraron datos para la cédula ingresada: ${this.cedula}`,
            });
          }

        }
      );
    }


    async copyTableToClipboard(): Promise<void> {
      let copyText = '';

      // Definir los mapeos de columnas al principio del método
      const columnMappings: { [key: string]: string } = {
        'num_hijos_dependen_economicamente2': 'Número de hijos dependientes',
        // Otros mapeos necesarios
      };

      // Itera sobre los datos consultados y genera las filas
      this.filas().forEach(row => {
        const rowData = this.displayedColumns.map(column => {
          // Manejo de columnas dinámicas relacionadas con hijos
          if (column.startsWith('nombre_hijo') || column.startsWith('sexo_hijo') ||
            column.startsWith('fecha_nacimiento_hijo') || column.startsWith('no_documento_hijo') ||
            column.startsWith('estudia_o_trabaja_hijo') || column.startsWith('curso_hijo')) {

            const match = column.match(/\d+$/);
            const index = match ? parseInt(match[0], 10) - 1 : 0;

            if (row.hijos && row.hijos[index]) {
              if (column.startsWith('nombre_hijo')) return this.escapeForExcel(row.hijos[index].nombre || 'N/A');
              if (column.startsWith('sexo_hijo')) return this.escapeForExcel(row.hijos[index].sexo || 'N/A');
              if (column.startsWith('fecha_nacimiento_hijo')) return this.escapeForExcel(row.hijos[index].fecha_nacimiento || 'N/A');
              if (column.startsWith('no_documento_hijo')) return this.escapeForExcel(row.hijos[index].no_documento || 'N/A');
              if (column.startsWith('estudia_o_trabaja_hijo')) return this.escapeForExcel(row.hijos[index].estudia_o_trabaja || 'N/A');
              if (column.startsWith('curso_hijo')) return this.escapeForExcel(row.hijos[index].curso || 'N/A');
            } else {
              return 'N/A';
            }
          }

          // Manejo de columnas normales con mapeo
          const dataField = columnMappings[column] || column;
          return this.escapeForExcel(row[dataField] || '');
        }).join('\t');
        copyText += rowData + '\n';
      });

      // Copiar al portapapeles
      try {
        await navigator.clipboard.writeText(copyText);
        Swal.fire({
          icon: 'success',
          title: 'Tabla copiada al portapapeles',
          text: 'La tabla se ha copiado exitosamente al portapapeles.'
        });
      } catch (error) {
        Swal.fire({
          icon: 'error',
          title: 'Error al copiar la tabla al portapapeles',
          text: 'Hubo un problema al intentar copiar la tabla al portapapeles.'
        });
      }
    }

    // Función para manejar caracteres especiales
    escapeForExcel(value: string): string {
      if (value === null || value === undefined) return '';
      const str = String(value);
      return str
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\t/g, ' ')
        .replace(/\n/g, ' ')
        .replace(/"/g, '""');
    }


    // Función para retornar los encabezados amigables de las columnas
    getColumnHeader(column: string): string {
      const headers: { [key: string]: string } = {
        'numerodeceduladepersona': 'Número de Cédula',
        'primer_apellido': 'Primer Apellido',
        'segundo_apellido': 'Segundo Apellido',
        // Agregar el resto de las columnas
        'nombre_hijo_1': 'Nombre del Hijo 1',
        'sexo_hijo_1': 'Sexo del Hijo 1',
        'fecha_nacimiento_hijo_1': 'Fecha de Nacimiento del Hijo 1',
        'no_documento_hijo_1': 'N° Documento del Hijo 1',
        'estudia_o_trabaja_hijo_1': 'Estudia o Trabaja Hijo 1',
        'curso_hijo_1': 'Curso del Hijo 1',
        // Agregar encabezados hasta el número máximo de hijos
      };
      return headers[column] || column;
    }
}
