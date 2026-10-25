/**
 * Afiliaciones › Envíos a EPS (ms-hr V70, /gestion_afiliaciones/envios-eps).
 *
 * Las claves van en snake_case tal como las sirve ms-hr (los DTO fijan @JsonNaming): este
 * submódulo NO pasa por conAliasCamel, así que lo que se lee aquí es lo que viaja.
 */

export type CanalEps = 'CORREO' | 'PLATAFORMA' | 'MANUAL';
export type EstadoTramite = 'POR_ENVIAR' | 'RADICADA' | 'CONFIRMADA' | 'RECHAZADA';
export type EmpresaTemporal = 'APOYO_LABORAL' | 'TU_ALIANZA';

export interface CanalEpsConfig {
  id: number;
  eps_key: string;
  nombre: string;
  nit: string | null;
  activa: boolean;
  canal: CanalEps;
  tramitador_nombre: string | null;
  correo_destino: string | null;
  correo_cc: string | null;
  asunto: string | null;
  cuerpo_intro: string | null;
  adjuntar_cedula: boolean;
  adjuntar_formato: boolean;
  adjuntar_excel: boolean;
  max_personas_correo: number;
  plataforma_url: string | null;
  plataforma_usuario: string | null;
  instrucciones: string | null;
  confirmacion_directa: boolean;
  tiene_plantilla: boolean;
  por_enviar: number;
  radicadas: number;
  confirmadas: number;
  rechazadas: number;
  actualizado_por: string | null;
  updated_at: string | null;
}

export type CanalEpsRequest = Partial<Omit<CanalEpsConfig,
  'id' | 'tiene_plantilla' | 'por_enviar' | 'radicadas' | 'confirmadas' | 'rechazadas' | 'actualizado_por' | 'updated_at'>>;

export interface PersonaBandeja {
  proceso_id: number;
  candidato_id: number;
  tramite_id: number | null;
  cedula: string;
  nombre: string;
  empresa: EmpresaTemporal | null;
  oficina: string | null;
  finca: string | null;
  fecha_ingreso: string | null;
  eps_texto: string | null;
  eps_key: string;
  eps_nombre: string;
  eps_activa: boolean;
  canal: CanalEps | null;
  ingreso_confirmado: boolean;
  /** null = ms-documents no respondió: no se sabe. */
  cedula_cargada: boolean | null;
  faltantes: string[];
  datos_confirmados_at: string | null;
  datos_confirmados_por: string | null;
}

export interface GrupoBandeja {
  eps_key: string;
  eps_nombre: string;
  eps_activa: boolean;
  canal: CanalEps | null;
  configurado: boolean;
  aviso_configuracion: string | null;
  pendientes_datos: number;
  listos: number;
  personas: PersonaBandeja[];
}

export interface BandejaEps {
  desde: string;
  hasta: string;
  total: number;
  sin_eps: number;
  eps_inactiva: number;
  grupos: GrupoBandeja[];
  /** off | prueba | activo */
  modo_envio: string;
}

export interface ResultadoMasivoEps {
  procesados: number;
  ok: number;
  omitidos: number;
  detalles: string[];
}

export interface PreviaCorreoEps {
  eps_key: string;
  empresa: string | null;
  destinatario: string | null;
  cc: string[];
  asunto: string;
  cuerpo_html: string;
  personas: number;
  adjuntos: string[];
  avisos: string[];
  modo_envio: string;
}

export interface EnvioEps {
  id: number;
  eps_key: string;
  empresa: string | null;
  canal: CanalEps;
  estado: 'ENVIADO' | 'FALLIDO' | 'PRUEBA' | 'REGISTRADO';
  destinatario: string | null;
  cc: string | null;
  asunto: string | null;
  remitente: string | null;
  motivo: string | null;
  total_personas: number;
  total_adjuntos: number;
  usuario: string | null;
  created_at: string;
}

export interface ResultadoEnvioEps {
  correos: number;
  enviados: number;
  fallidos: number;
  personas: number;
  modo_envio: string;
  envios: EnvioEps[];
  avisos: string[];
}

export interface TramiteEps {
  id: number;
  proceso_id: number;
  candidato_id: number;
  cedula: string;
  nombre: string;
  empresa: EmpresaTemporal | null;
  oficina: string | null;
  fecha_ingreso: string | null;
  eps_key: string;
  eps_texto: string | null;
  eps_nombre: string;
  estado: EstadoTramite;
  canal: CanalEps | null;
  envio_id: number | null;
  datos_confirmados_at: string | null;
  datos_confirmados_por: string | null;
  radicado_numero: string | null;
  radicado_fecha: string | null;
  radicado_por: string | null;
  radicado_at: string | null;
  radicado_doc_id: number | null;
  confirmado_por: string | null;
  confirmado_at: string | null;
  confirmacion_fecha: string | null;
  confirmacion_doc_id: number | null;
  confirmacion_directa: boolean;
  rechazo_motivo: string | null;
  nota: string | null;
  updated_at: string | null;
}

export interface EventoTramiteEps {
  id: number;
  estado_anterior: EstadoTramite | null;
  estado_nuevo: EstadoTramite;
  detalle: string | null;
  usuario: string | null;
  created_at: string;
}

export const ETIQUETA_CANAL: Record<CanalEps, string> = {
  CORREO: 'Correo al tramitador',
  PLATAFORMA: 'Registro en plataforma',
  MANUAL: 'Trámite a mano',
};

export const ICONO_CANAL: Record<CanalEps, string> = {
  CORREO: 'forward_to_inbox',
  PLATAFORMA: 'language',
  MANUAL: 'edit_note',
};

export const ETIQUETA_ESTADO_TRAMITE: Record<EstadoTramite, string> = {
  POR_ENVIAR: 'Por enviar',
  RADICADA: 'Radicada',
  CONFIRMADA: 'Confirmada',
  RECHAZADA: 'Devuelta',
};

export const ETIQUETA_EMPRESA: Record<string, string> = {
  APOYO_LABORAL: 'Apoyo Laboral',
  TU_ALIANZA: 'Tu Alianza',
};

/** Nombres legibles de los datos obligatorios (los de EnvioEpsService.faltantes). */
export const ETIQUETA_FALTANTE: Record<string, string> = {
  Tipo_Documento: 'tipo de documento',
  Cedula: 'cédula',
  Primer_Apellido: 'primer apellido',
  Primer_Nombre: 'primer nombre',
  Fecha_Nacimiento: 'fecha de nacimiento',
  Sexo: 'sexo',
  Direccion: 'dirección',
  Municipio_Residencia: 'municipio',
  Departamento_Residencia: 'departamento',
  Numero_Movil: 'celular',
  Fecha_Ingreso: 'fecha de ingreso',
  Salario: 'salario',
};
