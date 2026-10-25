/** Contrato de `GET /gestion_contratacion/reporte/metricas/*` (ms-hr, snake_case). */

export interface FiltrosMetricas {
  desde: string;
  hasta: string;
  oficinas?: string[];
  temporal?: string | null;
  /** Varias fincas / usuarios (se mandan separados por "|"). */
  fincas?: string[];
  medio?: string | null;
  usuarios?: string[];
  cargo?: string | null;
  q?: string | null;
}

export interface Kpis {
  presentados: number;
  personas: number;
  evaluados: number;
  aplica: number;
  no_aplica: number;
  en_espera: number;
  sin_evaluar: number;
  remitidos: number;
  examenes: number;
  caidas_etapa: number;
  contratados: number;
  ingresos: number;
  ingresos_al: number;
  ingresos_ta: number;
  retiro_temprano: number;
  vacantes: number;
  vacantes_activas: number;
  personas_solicitadas: number;
  tasa_aplica: number | null;
  tasa_conversion: number | null;
  tasa_evaluacion: number | null;
  dias_a_ingreso: number | null;
  oficinas_con_ingresos: number;
}

export interface EtapaEmbudo { etapa: string; nombre: string; valor: number; pct_total: number | null; pct_anterior: number | null; }
export interface Conteo { clave: string; valor: number; }
export interface Ranking { nombre: string; valor: number; }

export interface FilaOficina {
  oficina: string; presentados: number; evaluados: number; aplica: number; no_aplica: number; en_espera: number;
  remitidos: number; examenes: number; contratados: number; ingresos: number; ingresos_al: number; ingresos_ta: number;
  retiro_temprano: number; tasa_aplica: number | null; tasa_conversion: number | null; tasa_evaluacion: number | null;
  dias_a_ingreso: number | null;
}

export interface FilaFinca {
  finca: string; empresa: string | null; ingresos: number; al: number; ta: number; solicitadas: number;
  remitidos: number; retirados: number;
}

export interface FilaMedio {
  medio: string; presentados: number; aplica: number; contratados: number; ingresos: number;
  tasa_aplica: number | null; tasa_conversion: number | null;
}

export interface VacanteMetrica {
  id: number; fecha: string | null; temporal: string | null; finca: string | null; empresa: string | null;
  cargo: string | null; solicitadas: number; estado: string | null; activa: boolean; tipo: string | null;
  publicada_por: string | null; oficinas: string; remitidos: number; contratados: number; cobertura: number | null;
}

export interface TableroContratacion {
  desde: string;
  hasta: string;
  periodo_anterior: { desde: string; hasta: string };
  generado: string;
  kpis: Kpis;
  kpis_anterior: Kpis;
  embudo: EtapaEmbudo[];
  resultados: Conteo[];
  serie_diaria: { modo?: 'hora' | 'dia'; fechas: string[]; presentados: number[]; aplica: number[]; no_aplica: number[]; en_espera: number[]; ingresos: number[] };
  serie_oficinas: { modo?: 'hora' | 'dia'; fechas: string[]; oficinas: { oficina: string; presentados: number[]; ingresos: number[]; total: number }[] };
  por_oficina: FilaOficina[];
  por_temporal: { temporal: string; nombre: string; ingresos: number; vacantes: number; solicitadas: number }[];
  por_finca: FilaFinca[];
  por_medio: FilaMedio[];
  por_cargo: Ranking[];
  motivos: {
    no_aplica: Ranking[]; no_aplica_texto: Ranking[]; en_espera: Ranking[]; en_espera_texto: Ranking[];
    etapas: { etapa: string; resultado: string; valor: number }[];
  };
  equipo: {
    evaluadores: { nombre: string; evaluados: number; aplica: number; no_aplica: number; en_espera: number }[];
    contratadores: { nombre: string; ingresos: number; al: number; ta: number; oficinas: string }[];
    publicadores: Ranking[];
  };
  mapa_calor: { dias: string[]; oficinas: string[]; valores: [number, number, number][]; por_hora: number[] };
  perfil: { sexo_presentados: Conteo[]; sexo_ingresos: Conteo[]; edad_presentados: Conteo[]; edad_ingresos: Conteo[]; experiencia: Ranking[] };
  tiempos: { presentacion_a_ingreso: Conteo[]; retiros_30_dias: number };
  vacantes: VacanteMetrica[];
  opciones: { oficinas: string[]; fincas: string[]; medios: string[]; usuarios: string[]; cargos: string[]; resultados: string[]; temporales: string[] };
}

export interface ListaMetricas<T> { desde: string; hasta: string; total: number; truncado: boolean; filas: T[]; }

export interface FilaProceso {
  proceso_id: number | null; fecha: string; oficina: string; tipo_documento: string | null; cedula: string;
  nombre: string; sexo: string; edad: number | null; celular: string | null; medio: string; experiencia: string | null;
  estado: string | null; motivo: string | null; categoria_motivo: string | null; evaluador: string | null;
  cargo: string | null; finca: string | null; empresa: string | null; temporal: string | null; remitido: boolean;
  prueba: string | null; examen: string | null; resultado: string; fecha_ingreso: string | null;
  dias_a_ingreso: number | null; proceso_contrato: number | null;
}

export interface FilaIngreso {
  proceso_id: number; fecha_ingreso: string; tipo_documento: string | null; cedula: string; nombre: string;
  sexo: string; edad: number | null; temporal: string | null; empresa: string | null; finca: string | null;
  codigo: string | null; oficina: string; medio: string; cargo: string; usuario: string | null; activo: boolean;
  fecha_retiro: string | null; motivo_retiro: string | null; origen: string | null;
  fecha_presentacion: string | null; dias_desde_presentacion: number | null;
}

export interface ProcesoFicha {
  proceso_id: number; fecha: string | null; oficina: string; origen: string | null; resultado: string;
  entrevista: { medio: string; medio_texto: string | null; experiencia_flores: string | null; fincas_trabajadas: string | null;
    labores: string | null; referenciado: string | null; nombre_referenciado: string | null; proyeccion: string | null };
  evaluacion: { estado: string | null; motivo: string | null; evaluador: string | null; detalle: string | null };
  vacante: { tipo: string | null; cargo: string | null; finca: string | null; empresa: string | null; temporal: string | null };
  remision: { prueba_at: string | null; autorizado_at: string | null };
  prueba: { resultado: string | null; motivo: string | null; fecha: string | null };
  examen: { enviado_at: string | null; resultado: string | null; motivo: string | null; ips: string | null;
    concepto: string | null; fecha: string | null; restricciones: string | null };
  contrato: null | { real: boolean; codigo: string | null; temporal: string | null; empresa: string | null; finca: string | null;
    empresa_usuaria: string | null; fecha_ingreso: string | null; usuario: string | null; activo: boolean | null;
    fecha_retiro: string | null; motivo_retiro: string | null; forma_pago: string | null; eps: string | null;
    cesantias: string | null; ciudad_labor: string | null; contratado_at: string | null };
}

export interface FichaPersona {
  candidato_id: number; tipo_documento: string | null; cedula: string; nombre: string; sexo: string | null;
  fecha_nacimiento: string | null; edad: number | null; estado_civil: string | null; rh: string | null;
  lateralidad: string | null; departamento: string | null; municipio: string | null; nacionalidad: string | null;
  celular: string | null; whatsapp: string | null; email: string | null; direccion: string | null; barrio: string | null;
  localidad: string | null; tiempo_residencia: string | null; fecha_expedicion: string | null;
  lugar_expedicion: string | null; lugar_nacimiento: string | null; registrado: string | null;
  procesos: ProcesoFicha[];
}

/** Cómo se pinta cada "dónde se quedó": etiqueta, tono de la tabla estándar y color de gráfica. */
export const RESULTADOS: Record<string, { texto: string; tono: 'ok' | 'warn' | 'danger' | 'info' | 'violet' | 'neutro'; color: string }> = {
  CONTRATADO: { texto: 'Contratado', tono: 'ok', color: '#16A34A' },
  EN_EXAMENES: { texto: 'En exámenes', tono: 'info', color: '#0891B2' },
  REMITIDO: { texto: 'Remitido a vacante', tono: 'violet', color: '#7C3AED' },
  APLICA_SIN_REMITIR: { texto: 'Aplica, sin remitir', tono: 'info', color: '#3B82F6' },
  EN_ESPERA: { texto: 'En espera', tono: 'warn', color: '#F59E0B' },
  NO_APLICA: { texto: 'No aplica', tono: 'danger', color: '#DC2626' },
  NO_PASO_PRUEBA: { texto: 'No pasó prueba técnica', tono: 'danger', color: '#EA580C' },
  NO_SE_PRESENTO_PRUEBA: { texto: 'No fue a prueba técnica', tono: 'neutro', color: '#94A3B8' },
  NO_PASO_EXAMEN: { texto: 'No pasó examen médico', tono: 'danger', color: '#BE123C' },
  NO_SE_PRESENTO_EXAMEN: { texto: 'No fue a exámenes', tono: 'neutro', color: '#64748B' },
  SIN_EVALUAR: { texto: 'Sin evaluar', tono: 'neutro', color: '#CBD5E1' },
};

export const ESTADOS_EVALUACION: Record<string, string> = {
  APLICA: 'Aplica', NO_APLICA: 'No aplica', EN_ESPERA: 'En espera', SIN_CLASIFICAR: 'Sin clasificar',
};

export const ETAPA_TEXTO: Record<string, string> = { PASO: 'Pasó', NO_PASO: 'No pasó', NO_SE_PRESENTO: 'No se presentó' };

export const TEMPORAL_TEXTO: Record<string, string> = { AL: 'Apoyo Laboral', TA: 'Tu Alianza', SIN: 'Sin temporal' };

export const CATEGORIA_TEXTO: Record<string, string> = {
  SIN_VACANTE: 'Sin vacante disponible', SIN_EXPERIENCIA: 'Sin experiencia', PREFIERE_AREA: 'Prefiere un área',
  SEMANAS: 'Semanas cotizadas', NO_SE_PRESENTO: 'No se presentó', OTRO: 'Otro', EDAD: 'Edad', ANTECEDENTES: 'Antecedentes',
  MEDIDAS: 'Medidas / IMC', BLOQUEO_CLIENTE: 'Bloqueo del cliente', EXAMEN_MEDICO: 'Examen médico', EPS_SEMANAS: 'EPS / semanas',
};

// ─── Informe diario ────────────────────────────────────────────────

export interface OficinaDia {
  oficina: string; hora_cargue: string | null; ta: number; al: number; total: number; cedulas: number; traslados: number;
  reporto: boolean; ayer: number; semana_pasada: number | null; promedio_30: number; dias_cargue?: number; promedio_dia?: number;
}

export interface BloqueDia { desde: string; hasta: string; al: number; ta: number; total: number; }

export interface VacanteCumplimiento {
  id: number; fecha: string; temporal: string | null; finca: string | null; cargo: string | null; oficinas: string | null;
  solicitadas: number; contratados: number; contratados_hoy: number; pendientes: number; cumplimiento: number | null;
  remitidos_periodo?: number;
  dias_abierta: number; activa: boolean; estado: string | null;
}

export interface ContratoDia {
  proceso_id: number; cedula: string; nombre: string; temporal: string | null; oficina: string; finca: string | null;
  empresa: string | null; codigo: string | null; cargo: string | null; fecha_ingreso: string | null; usuario: string | null;
  cedula_cargada: boolean; traslado: boolean; fecha_contratacion?: string;
}

export interface FiltrosInforme { dias: number; desde?: string | null; temporal?: string | null; oficinas?: string[]; fincas?: string[]; usuarios?: string[]; }

export interface Contratador { nombre: string; total: number; al: number; ta: number; oficinas: string; dias: number; }

export interface EtapasProceso {
  llegaron: number; evaluados: number; aplica: number; no_aplica: number; en_espera: number; sin_evaluar: number;
  remitidos: number; examenes: number; contratados: number; caidas: number; ingresos: number;
}

export interface ProcesoOficina extends EtapasProceso {
  oficina: string; primera_llegada: string | null; ultima_llegada: string | null; llegadas: number[]; contratos: number[];
}

export interface ProcesoSeleccion {
  modo: 'hora' | 'dia'; cubetas: string[]; general: EtapasProceso & { oficinas_con_llegadas: number };
  por_oficina: ProcesoOficina[]; llegadas: number[]; contratos: number[];
}

export interface InformeDiario {
  proceso?: ProcesoSeleccion;
  dias?: number;
  /** Periodo (ms-hr ≥ 22-oct-2026): un solo día o un rango. */
  desde?: string; hasta?: string; es_dia?: boolean; dias_periodo?: number;
  etiquetas?: { periodo: string; anterior: string; semana: string; hoy: string };
  serie_oficinas?: { fechas: string[]; oficinas: { oficina: string; valores: number[]; total: number; promedio: number; maximo: number }[] };
  contratadores?: { dia: Contratador[]; periodo: Contratador[] };
  opciones?: { oficinas: string[]; fincas: string[]; usuarios: string[] };
  fecha: string; fecha_texto: string; generado: string; fecha_ingreso_principal: string | null;
  totales: { al: number; ta: number; total: number; cedulas: number; traslados: number; dias_con_carga?: number; promedio_dia?: number; oficinas_reportaron: number; oficinas_sin_reporte: string[] };
  oficinas: OficinaDia[];
  fincas: { TA: { finca: string; total: number }[]; AL: { finca: string; total: number }[] };
  comparativo: { dia: BloqueDia; ayer: BloqueDia; semana_pasada: BloqueDia | null; mes: BloqueDia; mes_anterior: BloqueDia; promedio_30: { total: number; dias: number } };
  serie: { fecha: string; al: number; ta: number; total: number }[];
  vacantes: { resumen: { vacantes: number; solicitadas: number; contratados: number; pendientes: number; cumplimiento: number | null; completas: number };
    filas: VacanteCumplimiento[] };
  detalle: ContratoDia[];
}

export interface ConfigInforme {
  activo: boolean; hora_envio: string; dias: string[]; incluir_excel: boolean; ultima_corrida: string | null;
  /** Oficinas del cuadro, en orden (ms-hr ≥ 22-oct-2026; antes no viene). */
  oficinas?: string[];
}

export interface Destinatario {
  id: number; canal: 'CORREO' | 'WHATSAPP'; valor: string; nombre: string | null; usuario_id: string | null;
  activo: boolean | number; creado_por: string | null; creado_en: string | null;
}

export interface UsuarioPlataforma { usuario_id: string; correo: string | null; celular: string | null; nombre: string | null; documento: string | null; }

export interface EnvioInforme {
  id: number; fecha_informe: string; canal: string; destinatario: string; enviado: boolean | number; detalle: string | null;
  disparo: string; usuario: string | null; creado_en: string;
}

export interface ResultadoEnvio {
  fecha: string; asunto: string; enviados: number; fallidos: number;
  resultados: { destinatario: string; enviado: boolean; detalle: string }[];
  whatsapp: { nombre: string; celular: string; enlace: string; encolado?: boolean; detalle?: string }[];
  texto_whatsapp: string;
}
