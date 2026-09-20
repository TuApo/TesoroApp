import {  Component, OnInit, ChangeDetectionStrategy, signal } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { IncapacidadService } from '../../services/incapacidad/incapacidad.service';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';
import * as XLSX from 'xlsx';
import { MatDialog } from '@angular/material/dialog';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatDividerModule } from '@angular/material/divider';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ColumnaTabla, TABLA_ESTANDAR, ValorCelda } from '../../../../../../shared/components/tabla-estandar';

type RolTarjeta = NonNullable<ColumnaTabla['tarjeta']>;

/** Incapacidades: claves que se ven siempre (el resto, en pantallas anchas). */
const PRINCIPALES_T1: readonly string[] = [
  'Tipo_de_documento', 'Numero_de_documento', 'consecutivoSistema', 'numero_de_contrato', 'nombre', 'apellido',
  'Oficina', 'celular_o_telefono_01', 'celular_o_telefono_02', 'correoElectronico', 'tipo_incapacidad',
  'F_inicio', 'F_final', 'dias_incapacidad', 'estado_incapacidad',
];

/** Incapacidades: rol en la vista de tarjetas; las claves que no estan no salen en la tarjeta. */
const ROL_TARJETA_T1: Readonly<Record<string, RolTarjeta>> = {
  nombre: 'titulo',
  apellido: 'titulo',
  Numero_de_documento: 'subtitulo',
  consecutivoSistema: 'meta',
  tipo_incapacidad: 'meta',
  F_inicio: 'meta',
  F_final: 'meta',
  dias_incapacidad: 'meta',
  estado_incapacidad: 'meta',
};

/** Columnas de Incapacidades que se editan en la celda (telefonos y correo). */
const COLUMNAS_EDITABLES: readonly string[] = ['celular_o_telefono_01', 'celular_o_telefono_02', 'correoElectronico'];

/** Dato plano para la tabla estandar: numeros y booleanos tal cual, el resto como texto. */
function valorPlano(value: unknown): ValorCelda {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}

export interface ColumnConfig {
  key: string;
  label: string;
  filterable: boolean;
  filterValue?: string;
}
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-buscar-incapacidad',
  standalone: true,

  imports: [
    ...TABLA_ESTANDAR,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    FormsModule,
    MatCardModule,
    MatProgressSpinnerModule,
    MatExpansionModule,
    MatDividerModule,
    MatTabsModule,
    MatTooltipModule
],
  templateUrl: './buscar-incapacidad.component.html',
  styleUrl: './buscar-incapacidad.component.css'
} )
export class BuscarIncapacidadComponent implements OnInit {
  query: string = '';
  isSidebarHidden = false;

  toggleSidebar() {
    this.isSidebarHidden = !this.isSidebarHidden;
  }

  ColumnsTable1 = [
    'Tipo_de_documento',
    'Numero_de_documento',
    'consecutivoSistema',
    'numero_de_contrato',
    'nombre',
    'apellido',
    'Oficina',
    'celular_o_telefono_01',
    'celular_o_telefono_02',
    'correoElectronico',
    'Temporal',
    'Dias_temporal',
    'tipo_incapacidad',
    'codigo_diagnostico',
    'descripcion_diagnostico',
    'F_inicio',
    'F_final',
    'Fecha_de_Envio_Incapacidad_Fisica',
    'Incapacidad_transcrita',
    'centrodecosto',

    'dias_de_diferencia',
    'dias_eps',
    'dias_incapacidad',
    'edad',
    'empresa',
    'estado_incapacidad',
    'estado_robot_doctor',
    'fecha_de_ingreso_temporal',
    'fondo_de_pensiones',
    'historial_clinico',
    'ips_punto_de_atencion',
    'link_incapacidad',
    'marcaTemporal',
    'nit_de_la_IPS',

    'nombre_de_quien_recibio',
    'nombre_doctor',
    'nombre_eps',

    'numero_de_documento_doctor',
    'numero_de_incapacidad',
    'observaciones',
    'prorroga',
    'responsable_de_envio',
    'sexo',
    'tipo_de_documento_doctor_atendido',

  ];

  columnTitlesTable1 = {
    'tipo_de_documento': 'Tipo de Documento',
    'numero_de_documento': 'Número de Documento',
    'dias_temporal': 'Días Temporal',
    'f_inicio': 'Fecha de Inicio',
    'fecha_de_envio_incapacidad_fisica': 'Fecha de Envío Incapacidad Física',
    'Incapacidad_transcrita': 'Incapacidad Transcrita',
    'oficina': 'Oficina',
    'temporal': 'Temporal',

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
    'historial_clinico': 'Historial Clínico',
    'ips_punto_de_atencion': 'IPS Punto de Atención',
    'link_incapacidad': 'Archivo Incapacidad',
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
    'tipo_incapacidad': 'Tipo Incapacidad'
  };

  displayedColumnsTable2= [
    'contrato',
    'empresa',
    'idEmpresa',
    'tipodedocumento',
    'documentodeidentidad',
    'SegundoApellido',
    'nombre',
    'sexo',
    'eps',
    'afp',
    'fecha_de_nacimiento',
    'cargo',
    'codigo_sucursal',
    'nombre_sucursal',
    'codigo_centro_trabajo',
    'nombre_centro_trabajo',
    'porcentaje_corizacion',
    'codigo_actividad_economica',
    'descripcion_actividad_economica',
    'ciudad',
    'fecha_de_ingreso',
    'fecha_retiro_programado',
    'estado_cobertura',
    'tipo_afiliado',
    'tasa_riesgo_independiente',
    'teletrabajo',
    'trabajo_remoto',
    'trabajo_en_casa',
    'tipo_cotizante',
    'acciones'
  ];

  columnTitlesTable2 = {
    'contrato': 'Contrato',
    'empresa': 'Empresa',
    'idEmpresa': 'ID Empresa',
    'tipodedocumento': 'Tipo de Documento',
    'documentodeidentidad': 'Documento de Identidad',
    'SegundoApellido': 'Segundo Apellido',
    'nombre': 'Nombre',
    'sexo': 'Sexo',
    'eps': 'EPS',
    'afp': 'AFP',
    'fecha_de_nacimiento': 'Fecha de Nacimiento',
    'cargo': 'Cargo',
    'codigo_sucursal': 'Código Sucursal',
    'nombre_sucursal': 'Nombre Sucursal',
    'codigo_centro_trabajo': 'Código Centro de Trabajo',
    'nombre_centro_trabajo': 'Nombre Centro de Trabajo',
    'porcentaje_corizacion': 'Porcentaje Cotización',
    'codigo_actividad_economica': 'Código Actividad Económica',
    'descripcion_actividad_economica': 'Descripción Actividad Económica',
    'ciudad': 'Ciudad',
    'fecha_de_ingreso': 'Fecha de Ingreso',
    'fecha_retiro_programado': 'Fecha Retiro Programado',
    'estado_cobertura': 'Estado Cobertura',
    'tipo_afiliado': 'Tipo Afiliado',
    'tasa_riesgo_independiente': 'Tasa Riesgo Independiente',
    'teletrabajo': 'Teletrabajo',
    'trabajo_remoto': 'Trabajo Remoto',
    'trabajo_en_casa': 'Trabajo en Casa',
    'tipo_cotizante': 'Tipo Cotizante',
    'acciones': 'Acciones'

  };

  displayedColumnsTable4 = [
    'Numero_de_documento',
    'consecutivoSistema_id',
    'valor_incapacidad',
    'a_donde_se_radico',
    'aquien_corresponde_el_pago',
    'codigo_respuesta_eps',
    'confirmacion_fecha_de_radicacion',

    'dias_pagos_incapacidad',
    'estado_del_documento_incapacidad',
    'fecha_de_recepcion_de_la_incapacidad',
    'fecha_de_respuesta_eps',
    'fecha_de_radicado_eps',
    'fecha_revision_por_parte_de_incapacidades',
    'numero_de_incapacidad_eps',
    'numero_de_radicado',
    'numero_transaccion_eps_arl',
    'quien_corresponde_el_pago_final',
    'quien_radico',
    'respuesta_de_la_eps',
    'respuesta_final_incapacidad',
    'transaccion_empresa_usuaria',

  ];
  columnTitlesTable4 = {
    'consecutivoSistema_id': 'Número de consecutivo del sistema',
    'confirmacion_fecha_de_radicacion': 'Fecha de confirmación de radicación',
    'fecha_de_recepcion_de_la_incapacidad': 'Fecha de recepción de la incapacidad',
    'fecha_revision_por_parte_de_incapacidades': 'Fecha de revisión por parte de incapacidades',
    'estado_del_documento_incapacidad': 'Estado del documento de incapacidad',
    'aquien_corresponde_el_pago': 'A quién corresponde el pago',
    'fecha_de_radicado_eps': 'Fecha de radicado EPS',
    'numero_de_radicado': 'Número de radicado',
    'a_donde_se_radico': 'A dónde se radicó',
    'quien_radico': 'Quién radicó',
    'respuesta_de_la_eps': 'Respuesta de la EPS',
    'codigo_respuesta_eps': 'Código de respuesta EPS',
    'fecha_de_respuesta_eps': 'Fecha de respuesta EPS',
    'numero_de_incapacidad_eps': 'Número de incapacidad EPS',
    'dias_pagos_incapacidad': 'Días pagos incapacidad',
    'valor_incapacidad': 'Valor incapacidad',
    'numero_transaccion_eps_arl': 'Número de transacción EPS/ARL',
    'transaccion_empresa_usuaria': 'Transacción empresa usuaria',
    'quien_corresponde_el_pago_final': 'Quién corresponde el pago final',
    'respuesta_final_incapacidad': 'Respuesta final incapacidad'
  };

  displayedColumnsTable3 = [
    'tipoidentificacion', 'no_identificacion', 'razon_social', 'clase_aportante', 'tipo_aportante',
    'fecha_de_pago', 'periodo_pension', 'periodo_salud', 'tipo_planilla', 'clave',
    'tipo_id_2', 'no_identificacion_2', 'nombre', 'ciudad', 'depto', 'salario',
    'integral', 'tipo_cotizante', 'subtipo_cotizante', 'horas_laboradas',
    'es_extranjero', 'residente_ext', 'fecha_residencia_ext', 'codigo',
    'centro_de_trabajo', 'nombre_centro_trabajo', 'codigo_2', 'direccion',
    'ing', 'fecha_ing', 'ret', 'fecha_ret', 'tae', 'tde', 'tap', 'tdp',
    'vsp', 'fecha_vsp', 'vst', 'sln', 'inicio_sln', 'fin_sln', 'ige',
    'inicio_ige', 'fin_ige', 'lma', 'inicio_lma', 'fin_lma', 'vac',
    'inicio_vac', 'fin_vac', 'avp', 'vct', 'inicio_vct', 'fin_vct',
    'irl', 'inicio_irl', 'fin_irl', 'vip', 'cor', 'administradora',
    'nit', 'codigo_3', 'dias', 'ibc', 'tarifa', 'aporte', 'tarifa_empleado',
    'aporte_empleado', 'fsp', 'fs', 'voluntaria_empleado', 'valor_no_retenido',
    'total_empleado', 'tarifa_empleador', 'aporte_empleador', 'voluntaria_empleador',
    'total_empleador', 'total_afp', 'afp_destino', 'administradora_afp',
    'nit_afp', 'codigo_4', 'dias_afp', 'ibc_afp', 'tarifa_afp',
    'aporte_afp', 'upc', 'tarifa_empleado_afp', 'aporte_empleado_afp',
    'tarifa_empleador_afp', 'aporte_empleador_afp', 'total_eps', 'eps_destino',
    'administradora_eps', 'nit_eps', 'codigo_eps', 'dias_eps', 'ibc_eps',
    'tarifa_eps', 'aporte_eps', 'administradora_riesgos', 'nit_riesgos',
    'codigo_riesgos', 'dias_riesgos', 'ibc_riesgos', 'tarifa_riesgos',
    'clase_riesgo', 'aporte_riesgos', 'dias_riesgos_2', 'ibc_riesgos_2',
    'tarifa_riesgos_2', 'aporte_riesgos_2', 'tarifa_sena', 'aporte_sena',
    'tarifa_icbf', 'aporte_icbf', 'exonerado_sena_icbf', 'total_aportes', 'acciones'
  ];
  columnTitles = {
    'tipoidentificacion': 'Tipo Identificación',
    'no_identificacion': 'No Identificación',
    'razon_social': 'Razón Social',
    'clase_aportante': 'Clase Aportante',
    'tipo_aportante': 'Tipo Aportante',
    'fecha_de_pago': 'Fecha de Pago',
    'periodo_pension': 'Periodo Pensíon',
    'periodo_salud': 'Periodo Salud',
    'tipo_planilla': 'Tipo Planilla',
    'clave': 'Clave',
    'tipo_id_2': 'Tipo ID 2',
    'no_identificacion_2': 'No Identificación 2',
    'nombre': 'Nombre',
    'ciudad': 'Ciudad',
    'depto': 'Depto',
    'salario': 'Salario',
    'integral': 'Integral',
    'tipo_cotizante': 'Tipo Cotizante',
    'subtipo_cotizante': 'Subtipo Cotizante',
    'horas_laboradas': 'Horas Laboradas',
    'es_extranjero': 'Es Extranjero',
    'residente_ext': 'Residente Ext',
    'fecha_residencia_ext': 'Fecha Residencia Ext',
    'codigo': 'Código',
    'centro_de_trabajo': 'Centro de Trabajo',
    'nombre_centro_trabajo': 'Nombre Centro Trabajo',
    'codigo_2': 'Código 2',
    'direccion': 'Dirección',
    'ing': 'ING',
    'fecha_ing': 'Fecha ING',
    'ret': 'RET',
    'fecha_ret': 'Fecha RET',
    'tae': 'TAE',
    'tde': 'TDE',
    'tap': 'TAP',
    'tdp': 'TDP',
    'vsp': 'VSP',
    'fecha_vsp': 'Fecha VSP',
    'vst': 'VST',
    'sln': 'SLN',
    'inicio_sln': 'Inicio SLN',
    'fin_sln': 'Fin SLN',
    'ige': 'IGE',
    'inicio_ige': 'Inicio IGE',
    'fin_ige': 'Fin IGE',
    'lma': 'LMA',
    'inicio_lma': 'Inicio LMA',
    'fin_lma': 'Fin LMA',
    'vac': 'VAC',
    'inicio_vac': 'Inicio VAC',
    'fin_vac': 'Fin VAC',
    'avp': 'AVP',
    'vct': 'VCT',
    'inicio_vct': 'Inicio VCT',
    'fin_vct': 'Fin VCT',
    'irl': 'IRL',
    'inicio_irl': 'Inicio IRL',
    'fin_irl': 'Fin IRL',
    'vip': 'VIP',
    'cor': 'COR',
    'administradora': 'Administradora',
    'nit': 'NIT',
    'codigo_3': 'Código 3',
    'dias': 'Días',
    'ibc': 'IBC',
    'tarifa': 'Tarifa',
    'aporte': 'Aporte',
    'tarifa_empleado': 'Tarifa Empleado',
    'aporte_empleado': 'Aporte Empleado',
    'fsp': 'FSP',
    'fs': 'FS',
    'voluntaria_empleado': 'Voluntaria Empleado',
    'valor_no_retenido': 'Valor No Retenido',
    'total_empleado': 'Total Empleado',
    'tarifa_empleador': 'Tarifa Empleador',
    'aporte_empleador': 'Aporte Empleador',
    'voluntaria_empleador': 'Voluntaria Empleador',
    'total_empleador': 'Total Empleador',
    'total_afp': 'Total AFP',
    'afp_destino': 'AFP Destino',
    'administradora_afp': 'Administradora AFP',
    'nit_afp': 'NIT AFP',
    'codigo_4': 'Código 4',
    'dias_afp': 'Días AFP',
    'ibc_afp': 'IBC AFP',
    'tarifa_afp': 'Tarifa AFP',
    'aporte_afp': 'Aporte AFP',
    'upc': 'UPC',
    'tarifa_empleado_afp': 'Tarifa Empleado AFP',
    'aporte_empleado_afp': 'Aporte Empleado AFP',
    'tarifa_empleador_afp': 'Tarifa Empleador AFP',
    'aporte_empleador_afp': 'Aporte Empleador AFP',
    'total_eps': 'Total EPS',
    'eps_destino': 'EPS Destino',
    'administradora_eps': 'Administradora EPS',
    'nit_eps': 'NIT EPS',
    'codigo_eps': 'Código EPS',
    'dias_eps': 'Días EPS',
    'ibc_eps': 'IBC EPS',
    'tarifa_eps': 'Tarifa EPS',
    'aporte_eps': 'Aporte EPS',
    'administradora_riesgos': 'Administradora Riesgos',
    'nit_riesgos': 'NIT Riesgos',
    'codigo_riesgos': 'Código Riesgos',
    'dias_riesgos': 'Días Riesgos',
    'ibc_riesgos': 'IBC Riesgos',
    'tarifa_riesgos': 'Tarifa Riesgos',
    'clase_riesgo': 'Clase Riesgo',
    'aporte_riesgos': 'Aporte Riesgos',
    'dias_riesgos_2': 'Días Riesgos 2',
    'ibc_riesgos_2': 'IBC Riesgos 2',
    'tarifa_riesgos_2': 'Tarifa Riesgos 2',
    'aporte_riesgos_2': 'Aporte Riesgos 2',
    'tarifa_sena': 'Tarifa SENA',
    'aporte_sena': 'Aporte SENA',
    'tarifa_icbf': 'Tarifa ICBF',
    'aporte_icbf': 'Aporte ICBF',
    'exonerado_sena_icbf': 'Exonerado SENA ICBF',
    'total_aportes': 'Total Aportes',
    'acciones': 'Acciones'
  };
  displayedColumnsTable5 = ["FECHA",
    "TIPO DOC.",
    "NÚMERO DOC.",
    "CUENTA",
    "CONCEPTO",
    "NOMBRE DEL TERCERO",
    "NOMBRE C. DE COSTO",
    "CUENTA BANCARIA",
    "USUARIO",
    "NOMBRE CUENTA",
    "DEBITO",
    "GRUPO DE INCAPACIDADES"];
  columnTitlesTable5 = {
    'fecha': 'FECHA',
    'tipo_doc': 'TIPO DOC.',
    'numero_doc': 'NÚMERO DOC.',
    'cuenta': 'CUENTA',
    'concepto': 'CONCEPTO',
    'nombre_tercero': 'NOMBRE DEL TERCERO',
    'nombre_centro_costo': 'NOMBRE C. DE COSTO',
    'cuenta_bancaria': 'CUENTA BANCARIA',
    'usuario': 'USUARIO',
    'nombre_cuenta': 'NOMBRE CUENTA',
    'debito': 'DEBITO',
    'grupo_incapacidades': 'GRUPO DE INCAPACIDADES'
  };
  displayedColumnsTable6 = ["temporal", "entidad", "TIPO_ID_AFILIADO", "IDENTIFICACION_AFILIADO", "NOMBRES_AFILIADO",
    "NRO_INCAPACIDAD", "FECHA_INICIO", "FECHA_FÍN", "DÍAS_OTORGADOS", "CONTINGENCIA", "DIAGNÓSTICO",
    "IBL", "DÍAS_PAGADOS", "VALOR_PAGADO", "FECHA_PAGO", "NRO_COMPROBANTE_PAGO", "GRUPO DE INCAPACIDADES"];
  columnTitlesTable6 = {
    'temporal': 'Información temporal o identificador temporal',
    'entidad': 'Nombre de la entidad',
    'tipo_id_afiliado': 'Tipo de identificación del afiliado (ej. CC, TI)',
    'identificacion_afiliado': 'Número de identificación del afiliado',
    'nombres_afiliado': 'Nombres completos del afiliado',
    'nro_incapacidad': 'Número de la incapacidad',
    'fecha_inicio': 'Fecha de inicio de la incapacidad',
    'fecha_fin': 'Fecha de finalización de la incapacidad',
    'dias_otorgados': 'Número de días otorgados de incapacidad',
    'contingencia': 'Tipo de contingencia',
    'diagnostico': 'Diagnóstico relacionado con la incapacidad',
    'ibl': 'Ingreso Base de Liquidación (IBL)',
    'dias_pagados': 'Días pagados por la incapacidad',
    'valor_pagado': 'Valor pagado por la incapacidad',
    'fecha_pago': 'Fecha en que se realizó el pago',
    'nro_comprobante_pago': 'Número de comprobante del pago',
    'grupo_incapacidades': 'Grupo de incapacidades'
  };
  displayedColumnsTable7 = ["Grupo",
    "Cedula",
    "Nombres y Apellidos",
    "Fecha Ingreso",
    "Suma de Dias incapacidad enf gral menor a 2d",
    "Suma de Dias Incapacidad enf grl desde 3d",
    "Verificacion Existencia Incapacidad",
    "Arreglo de Incapacidades registradas",
    "Dias Empresa Usuaria",
    "Dias EPS",
    "Confirmacion Dias Empresa Usuaria",
    "Confirmacion Dias EPS",
    "tabla de indicadores"];
  columnTitlesTable7 = {
    'grupo': 'Grupo del empleado',
    'cedula': 'Cédula del empleado',
    'nombres_apellidos': 'Nombres y Apellidos',
    'fecha_ingreso': 'Fecha Ingreso',
    'suma_dias_incapacidad_menor_2d': 'Suma de Días Incapacidad Enf Gral Menor a 2d',
    'suma_dias_incapacidad_3d_o_mas': 'Suma de Días Incapacidad Enf Grl Desde 3d',
    'verificacion_existencia_incapacidad': 'Verificación Existencia Incapacidad',
    'arreglo_incapacidades_registradas': 'Arreglo de Incapacidades Registradas',
    'dias_empresa_usuaria': 'Días Empresa Usuaria',
    'dias_eps': 'Días EPS',
    'confirmacion_dias_empresa_usuaria': 'Confirmación Días Empresa Usuaria',
    'confirmacion_dias_eps': 'Confirmación Días EPS',
    'tabla_indicadores': 'Tabla de Indicadores'
  };
  empresas: string[] = [
    'APOYO POSCOSECHAS',
    'CALIDAD',
    'CALIDAD VALENTINO',
    'CARNATION',
    'CENTRO DE ACOPIO CASCARILLA',
    'CHUSACA E.U.',
    'CIRCASIA',
    'CONFINAMIENTO CLAVEL',
    'CRISANTEMOS PLANTA MADRE LA PRIMAVERA',
    'DESARROLLO INVESTIGACION DIVERSIFICADOS',
    'DISTRIBUCION MATERIALES PROPAGACION',
    'DISTRIBUCION PERSONAL ADMINISTRATIVO',
    'DISTRIBUCION PERSONAL PROPAGADORA',
    'EL RESPIRO',
    'EL ROSAL',
    'ELITE GERBERAS',
    'ENRAIZAMEINTO CLAVEL TINZUQUE',
    'ENRAIZAMIENTO CRISANTEMOS LA NENA',
    'ENRAIZAMIENTO CRISANTEMOS LA PRIMAVERA',
    'ESTADISTICA VALENTINO',
    'FINCA EL COLEGIO',
    'FINCA LA PRIMAVERA',
    'FINCA SEVILLA',
    'FLOREX',
    'FLOREX 2',
    'FLOREX 3',
    'GESTION HUMANA',
    'JARDINES DE COLOMBIA',
    'LA ESMERALDA',
    'LA MONTAÑA',
    'LA NENA',
    'LA NENA 1',
    'LA VALENTINA',
    'LABORATORIO',
    'LABORATORIO INVITRO PROPAGACION',
    'LAS MARGARITAS',
    'MAQUINA PLANA',
    'MARLY',
    'MARLY 1',
    'MIPE  SALAS',
    'NORMANDIA',
    'NUEVO MANTENIMIENTO DIVERSIFICADO',
    'NUEVO MANTENIMIENTO LA NENA',
    'NUEVO MANTENIMIENTO VALENTINO',
    'NUEVO MANTENIMIENTO ZONA 3',
    'NUEVO MANTENIMIENTO ZONA 1',
    'NUEVO MANTENIMIENTO ZONA 5',
    'ORNATOS ELITE',
    'ORNATOS SAN VALENTINO',
    'PALMAS',
    'PATRONERA PALMAS',
    'PLANTA DE SUSTRATOS',
    'PLANTA MADRE PROPAGACION',
    'POSCOSECHA ALSTROEMERIA',
    'POSCOSECHA ALSTROEMERIA PALMAS',
    'POSCOSECHA DIVERSIFICADOS LA NENA',
    'POSCOSECHA EL RESPIRO',
    'POSCOSECHA FLOREX',
    'POSCOSECHA GERBERAS',
    'POSCOSECHA GYPSOPHILA',
    'POSCOSECHA JARDINES',
    'POSCOSECHA LA NENA',
    'POSCOSECHA VALDAYA',
    'POSCOSECHA VISTA FARMS',
    'POSTCOSECHA CARNATION',
    'POSTCOSECHA EL ROSAL',
    'POSTCOSECHA GUACARI',
    'POSTCOSECHA LAS MARGARITAS',
    'POSTCOSECHA LAS PALMAS',
    'POSTCOSECHA MORADO',
    'POSTCOSECHA SAN VALENTINO',
    'POSTCOSECHA SANTA MARIA',
    'POSTCOSECHA SANTA MARIA SIGNATURE',
    'POSTCOSECHA TINZUQUE OTROS',
    'PRODUCCION DE BIOCONTROLADORES',
    'PROGRAMA NUEVAS VARIEDADES',
    'PROPAGADORA ALSTROEMERIA',
    'PROPAGADORA ENRAIZAMIENTO POMPON',
    'PROPAGADORA ESQUEJES',
    'PROPAGADORA PLANTA MADRE CLAVEL',
    'PROPAGADORA SEMILLAS',
    'SAN CARLOS',
    'SAN MATEO',
    'SAN PEDRO',
    'SANTA MARIA',
    'TIKIYA',
    'TINZUQUE',
    'TINZUQUE CLAVEL',
    'TINZUQUE MALVAL',
    'TRABAJO EN SUELO',
    'TRABAJO EN SUELO VALENTINO',
    'VALDAYA',
    'VALENTINO COMPOST',
    'VISTA FARMS',
    'CONFINAMIENTO CLAVEL FANTASY',
    'ENRAIZAMEINTO CLAVEL FANTASY',
    'FANTASY 1',
    'FANTASY 2',
    'FANTASY 3',
    'FANTASY 4',
    'FANTASY 5',
    'FANTASY 6 CLAVEL Y MINI',
    'FANTASY 7',
    'FANTASY 8',
    'FANTASY COMPOST',
    'NUEVO MANTENIMIENTO  ZONA 7',
    'ORNATOS FANTASY',
    'POSCOSECHA FANTASY OTROS',
    'POSTCOSECHA FANTASY',
    'LAS MERCEDES',
    'POSCOSECHA DIVERSIFICADOS MERCEDES',
    'POSCOSECHA ROSAS COLOMBIANAS',
    'ROSAS COLOMBIANAS',
    'BELCHITE',
    'POSCOSECHA EXCELLENCE',
    'POSCOSECHA WAYUU EL FUTURO',
    'POSCOSECHA WAYUU GUASCA',
    'POSCOSECHA WAYUU SUESCA',
    'POZO AZUL',
    'WAYUU COMPOST',
    'WAYUU EL FUTURO',
    'WAYUU GUASCA',
    'WAYUU SUESCA',
    'AGROIDEA',
    'AGROINDUSTRIAL DON EUSEBIO',
    'AMANCAY',
    'CONTROL CALIDAD',
    'NEVERAS E INVENTARIOS AMANCAY',
    'TRANSFORMACION',
    'TRATADOS',
    'BALLESTEROS GOMEZ MARIBEL DAYANNA',
    'BOUQUETS MIXTOS',
    'CALAFATE CICLICOS',
    'CALAFATE PERENES',
    'CALAFATE POSTCOSECHA',
    'CARTUCHO',
    'CONDADO',
    'JARDINES CRISANTEMOS',
    'JARDINES DIVERSIFICADOS',
    'JARDINES OPERATIVOS',
    'JARDINES SERVICIOS',
    'NORIA',
    'PROPAGACION',
    'CAFARCOL',
    'CASA DENTAL EDUARDO DAZA',
    'AGRICOLA CARDENAL FACA',
    'AGRICOLA CARDENAL ROSAL',
    'COMESTIBLES REINA DULCERIA',
    'DANIELA LEON',
    'DELI POLLO LG',
    'FLORES CAMPO VERDE',
    'FLORES DE LOS ANDES',
    'MONTE VERDE',
    'FLORES DEL RIO',
    'FLORES EL REBAÑO',
    'EL HATO',
    'GUAYMARAL',
    'GUAYMARAL N - O',
    'GUENSUCA',
    'LA MACARENA',
    'SAN CARLOS',
    'SAGARO',
    'SAN JUAN CLAVEL FUNZA',
    'SAN JUAN ROSA FUNZA',
    'SAN JUAN ROSA NEMOCON',
    'FRUITSFULL',
    'HMVE VALMAR',
    'HMVE CURUBITAL',
    'HMVE YUNDAMA',
    'ALEJANDRA',
    'TURFLOR',
    'VALMAR PRODUCTORA'];

  /**
   * Resultado de la busqueda, comun a las 7 pestanas (cada una lo muestra con
   * sus columnas). Tabla estandar: busqueda, filtros por columna, orden,
   * paginacion y copiado los da la tabla.
   */
  readonly filas = signal<any[]>([]);
  /** Copia de lo encontrado para restablecer tras un filtro sin resultados. */
  copiaFilas: any[] = [];

  /**
   * Incapacidades: una columna por clave de ColumnsTable1 con el mismo titulo
   * de antes. Los telefonos y el correo se editan en la celda (interactivas) y
   * los soportes son un enlace de descarga.
   */
  readonly columnasIncapacidades: ColumnaTabla<any>[] = this.ColumnsTable1.map((col): ColumnaTabla<any> => {
    const descarga = this.isDownloadableColumn(col);
    return {
      id: col,
      header: this.toTitleCase(col, this.columnTitlesTable1),
      valor: (fila) => valorPlano(descarga ? fila?.[col + '_link'] : fila?.[col]),
      prioridad: PRINCIPALES_T1.includes(col) ? 1 : 3,
      tarjeta: ROL_TARJETA_T1[col] ?? 'oculto',
      // Constante de modulo y no `isEditable()`: este campo se inicializa antes que `editableColumns`.
      interactiva: descarga || COLUMNAS_EDITABLES.includes(col),
      ...(descarga ? { ordenable: false, filtrable: false, copiable: false } : {}),
    };
  });

  /** Reporte (con el boton Editar de cada fila en las acciones). */
  readonly columnasReporte = this.columnasDe(this.displayedColumnsTable4, this.columnTitlesTable4);
  readonly columnasArl = this.columnasDe(this.displayedColumnsTable2, this.columnTitlesTable2);
  // SS, movimientos, pagas y Factura Elite usaban `columnTitles` para el titulo: se conserva.
  readonly columnasSeguridadSocial = this.columnasDe(this.displayedColumnsTable3, this.columnTitles);
  readonly columnasMovimientos = this.columnasDe(this.displayedColumnsTable5, this.columnTitles);
  readonly columnasPagas = this.columnasDe(this.displayedColumnsTable6, this.columnTitles);
  readonly columnasFacturaElite = this.columnasDe(this.displayedColumnsTable7, this.columnTitles);

  /** Columnas planas para las pestanas de solo lectura: las 8 primeras siempre visibles. */
  private columnasDe(claves: string[], titulos: { [key: string]: string }): ColumnaTabla<any>[] {
    return claves.map((col, i): ColumnaTabla<any> => ({
      id: col,
      header: this.toTitleCase(col, titulos),
      valor: (fila) => valorPlano(fila?.[col]),
      prioridad: i < 8 ? 1 : 3,
      tarjeta: i === 0 ? 'titulo' : i === 1 ? 'subtitulo' : i < 8 ? 'meta' : 'oculto',
    }));
  }
  overlayVisible = false;
  loaderVisible = false;

  resultsincapacidades: any[] = [];
  resultsarl: any[] = [];
  resultssst: any[] = [];

  user: any
  correo: any
  filteredData: any[] = [];
  isSearchded = false;

  counterVisible = false;
  columnConfigs: ColumnConfig[] = [
    { key: 'numero_de_documento', label: 'Número de Documento', filterable: true },
    { key: 'a_donde_se_radico', label: 'A dónde se radicó', filterable: true },
    { key: 'aquien_corresponde_el_pago', label: 'A quién corresponde el pago', filterable: true },
    { key: 'codigo_respuesta_eps', label: 'Código de respuesta EPS', filterable: true },
    { key: 'confirmacion_fecha_de_radicacion', label: 'Fecha de confirmación de radicación', filterable: true },
    { key: 'consecutivo_sistema_id', label: 'Número de consecutivo del sistema', filterable: true },
    // Agrega más columnas según sea necesario...
  ];
  tiposIncapacidad: string[] = [
    'ENFERMEDAD GENERAL',
    'LICENCIA DE MATERNIDAD',
    'LICENCIA PATERNIDAD',
    'ACCIDENTE DE TRABAJO',
    'SOAT / ACCIDENTE DE TRANCITO',
    'ENFERMEDAD LABORAL'
  ];
  temporales:string [] = [
    'Tu Alianza',
    'Apoyo Laboral'

  ]
  constructor(private incapacidadService: IncapacidadService, private router: Router) {
  }
  async ngOnInit(): Promise<void> {
    this.displayedColumns = [...this.columnConfigs.map(config => config.key), 'edit'];
  }

  toTitleCase(text: string, columnTitles: { [key: string]: string }): string {
    if (!text) return '';

    // Si el texto existe en la lista de títulos de columnas, devolver ese valor
    if (columnTitles[text]) {
      return columnTitles[text];
    }

    // Si no existe en la lista, realizar la conversión a título de caso
    return text
      .toLowerCase()
      .split('_') // Suponiendo que las claves están en snake_case
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  playSound(success: boolean): void {
    const audio = new Audio(success ? 'Sounds/positivo.mp3' : 'Sounds/negativo.mp3');
    audio.play();
  }



  toggleLoader(visible: boolean, showCounter: boolean = false): void {
    this.loaderVisible = visible;
    this.counterVisible = showCounter;
  }
  isDownloadableColumn(column: string): boolean {
    // Verifica si la columna es 'historial_clinico' o 'link_incapacidad'
    return column === 'historial_clinico' || column === 'link_incapacidad';
  }
  onSearch(): void {
    this.cargarInformacion(true);
    if (this.query.trim()) { // Verifica que el input no esté vacío
      this.incapacidadService.buscar(this.query).subscribe(
        response => {


          // Assuming response contains incapacidades and reporte arrays
          const incapacidades = response.incapacidades || [];
          const reporte = response.reporte || [];
          const movimiento = response.movimientoBanco || [];
          const facturaelite = response.facturaelite || [];
          const incapacidadespagas = response.incapacidadespagas || [];
          // Combinar los datos
          const combinedData = incapacidades.map((incapacidad: any, index: number) => {
            const result = {
              ...incapacidad,
              ...reporte[index], // Asumiendo que hay una correspondencia uno a uno
              ...movimiento[index],
              ...facturaelite[index],
              ...incapacidadespagas[index]
            };

            // Los PDFs ahora viven en gestion_documental. Los serializers del
            // backend exponen `<campo>_doc.file_url` por cada documento. Para no
            // romper el HTML existente que apunta a `<campo>_link`, copiamos
            // el file_url al alias `_link`.
            const docPairs: Array<[string, string]> = [
              ['historial_clinico', 'historial_clinico_link'],
              ['link_incapacidad', 'link_incapacidad_link'],
              ['furat', 'furat_link'],
              ['soat', 'soat_link'],
              ['furips', 'furips_link'],
              ['registro_civil', 'registro_civil_link'],
              ['registro_de_nacido_vivo', 'registro_de_nacido_vivo_link'],
              ['formulario_salud_total', 'formulario_salud_total_link'],
            ];
            for (const [legacy, alias] of docPairs) {
              const meta = result[`${legacy}_doc`];
              if (meta && meta.file_url) {
                result[alias] = meta.file_url;
              }
            }

            return result;
          });
          // Asignar los datos al DataSource
          this.cargarInformacion(false);
          this.filas.set(combinedData);
          this.copiaFilas = combinedData;
          this.isSearchded = true;

        },
        error => {
          this.cargarInformacion(false);
          Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Ha ocurrido un error al realizar la búsqueda'
          });
          // Handle error as needed
        }
      );
    } else {
      this.toggleLoader(false, false);
      // Clear the tables if the query is empty
      this.filas.set([]);

    }
  }
  convertBase64ToPDF(base64String: string): string | null {
    // Verificar si la cadena base64 es válida
    if (!base64String || typeof base64String !== 'string') {
      return null;
    }

    // Limpiar prefijos como 'data:application/pdf;base64,'
    const base64Pattern = /^data:application\/pdf;base64,/;
    if (base64Pattern.test(base64String)) {
      base64String = base64String.replace(base64Pattern, '');
    }

    try {
      // Decodificar la cadena Base64
      const binaryString = atob(base64String);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Crear un Blob a partir del Uint8Array
      const blob = new Blob([bytes], { type: 'application/pdf' });

      // Crear una URL para el Blob
      return window.URL.createObjectURL(blob);
    } catch (error) {
      return null;
    }
  }


  applyFilter() {
    // Función auxiliar para verificar coincidencias de cadenas
    const stringMatch = (value: string, filterValue: string): boolean => {
      return value?.toLowerCase().trim().includes(filterValue?.toLowerCase().trim());
    };

    // Función auxiliar para verificar coincidencias exactas de cadenas
    const exactStringMatch = (value: string, filterValue: string): boolean => {
      return value?.toLowerCase().trim() === filterValue?.toLowerCase().trim();
    };
    if(this.filterCriteria.temporal === 'Tu Alianza'){
      this.filterCriteria.temporal = 'TA';
    }else if(this.filterCriteria.temporal === 'Apoyo Laboral'){
      this.filterCriteria.temporal = 'AL';
    }

    // Filtrar los datos de la tabla basados en los criterios seleccionados
    const filteredData = this.filas().filter(item => {
      const numeroDeDocumentoMatch = this.filterCriteria.numeroDeDocumento
        ? exactStringMatch(item.Numero_de_documento?.toString(), this.filterCriteria.numeroDeDocumento)
        : true;

      const fechaInicioMatch = this.filterCriteria.fechaInicio
        ? (item.f_inicio && new Date(item.f_inicio).toISOString().split('T')[0] === new Date(this.filterCriteria.fechaInicio).toISOString().split('T')[0])
        : true;

      const empresaMatch = this.filterCriteria.temporal
        ? stringMatch(item.Temporal, this.filterCriteria.temporal)
        : true;

      const tipoIncapacidadMatch = this.filterCriteria.tipoIncapacidad
        ? exactStringMatch(item.tipo_incapacidad, this.filterCriteria.tipoIncapacidad)
        : true;

      const estadorobotMatch = this.filterCriteria.estadorobot
        ? stringMatch(item.estadorobot, this.filterCriteria.estadorobot)
        : true;

      const temporalMatch = this.filterCriteria.temporal
        ? stringMatch(item.temporal, this.filterCriteria.temporal)
        : true;

      return numeroDeDocumentoMatch && fechaInicioMatch && empresaMatch && tipoIncapacidadMatch && estadorobotMatch && temporalMatch;
    });
    if (filteredData.length === 0) {
      Swal.fire({
        icon: 'info',
        title: 'No se encontraron datos',
        text: 'No se encontraron datos con los criterios seleccionados.',
        confirmButtonText: 'Aceptar'
      });

      // Limpia los criterios de filtro
      this.filterCriteria = {
        numeroDeDocumento: '',
        fechaInicio: '',
        empresa: '',
        tipoIncapacidad: '',
        estadorobot: '',
        temporal: ''
      };
      this.filas.set(this.copiaFilas);
    }else{
      this.filas.set(filteredData);
    }


  }
  clearFilter(): void {
    this.filterCriteria = {
      tipodeincapacidad: '',
      centrodecosto: '',
      empresa: '',
      estadorobot: '',
      temporal: ''
    };
    this.filas.set(this.copiaFilas);
  }

  resetFileInput(event: any): void {
    event.target.value = '';
  }
  mostrarCargando(estado: boolean) {
    if (estado) {
      // Mostrar la alerta de carga con spinner
      Swal.fire({
        title: 'Cargando...',
        html: 'Por favor espera mientras se carga la información',
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
  openReportDialog(): void {
    Swal.fire({
      title: 'Crear/Editar Reporte',
      text: '¿Qué acción deseas realizar?',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Crear/Editar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) {
        if (this.isSearchded) {
        // Manejar el resultado del diálogo aquí
          this.router.navigate(['/formulario-reporte', this.query]);
        } else {
          Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'No se han realizado búsquedas'
          });
        }
      } 
    });
  }


  claves = ["NroDes", "Contrato", "Cedula", "Nombre", "CentrodeCosto", "Concepto", "FormadePago", "Valor", "Banco", "FECHADEPAGO"];

  asignarClaves(data: any[]): any[] {

    return data.map((row: any) => {
      let modifiedRow: any = {};
      row.forEach((cell: any, index: number) => {
        if (index < this.claves.length) {
          modifiedRow[this.claves[index]] = cell !== null ? cell : 'N/A';
        }
      });
      return modifiedRow;
    });
  }
  triggerFileInput(): void {
    const fileInput = document.getElementById('fileInput') as HTMLInputElement;
    fileInput.click();
  }


  displayedColumnsWithEdit: string[] = [...this.displayedColumnsTable4, 'edit'];

  openEditDialog(element: any): void {
    Swal.fire({
      title: 'Editar Reporte',
      text: '¿Qué acción deseas realizar?',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Editar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) {
        this.router.navigate(['/formulario-reporte', element.consecutivoSistema_id]);
      }
    });
  }
  displayedColumns: string[] = [];
  editRow(element: any) {
    // Activa el modo de edición en la fila seleccionada
    element.editing = true;
  }

  isFilterable(column: string): boolean {
    const filterableColumns = ['T1', 'T2', 'Total']; // Define las columnas que son filtrables
    return filterableColumns.includes(column);
  }
  isEditable(column: string): boolean {
    return this.editableColumns.includes(column);
  }
  editableColumns: string[] = [...COLUMNAS_EDITABLES];
  editingRow: any = null; // La fila que está siendo editada
  editedValues: any = {}; // Almacena los valores editados
  updateValue(row: any, column: string, event: any) {
    row[column] = event.target.value;
    this.editedValues[column] = event.target.value;
    this.editingRow = row;
  }
  saveChanges(): void {
    const datos = this.filas();
    const index = datos.findIndex(item => item === this.editingRow);
    if (index !== -1) {
      // Arreglo nuevo (no se muta en sitio): la tabla estandar se entera por la senal.
      const actualizados = [...datos];
      actualizados[index] = { ...actualizados[index], ...this.editedValues };
      this.filas.set(actualizados);

      this.incapacidadService.updateIncapacidad(this.editingRow.consecutivoSistema_id, this.editingRow).subscribe(
        response => {
          Swal.fire({ icon: 'success', title: 'Éxito', text: 'Los cambios se han guardado correctamente' });
          this.cancelEditing();
        },
        error => Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudieron guardar los cambios' })
      );
    }
  }

  cancelEditing() {
    this.editingRow = null;
    this.editedValues = {};
  }

  filterCriteria: any = {
    numeroDeDocumento: '',
    fechaInicio: '',
    temporal: '',
    estadoIncapacidad: ''
  };
  isFilterCollapsed = true;
  toggleFilter(): void {
    this.isFilterCollapsed = !this.isFilterCollapsed;
  }
}
