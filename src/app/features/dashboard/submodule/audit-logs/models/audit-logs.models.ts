// Todos los campos en snake_case para coincidir con la serialización SNAKE_CASE del backend.

export interface AuditLogEntry {
  id: number;
  occurred_at: number;       // epoch seconds (Instant serializado)
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  resource: string | null;
  resource_id: string | null;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  success: boolean;
  metadata: string | null;
}

export interface ChangeLogEntry {
  id: number;
  occurred_at: number;       // epoch seconds
  actor_id: string | null;
  actor_email: string | null;
  actor_nombre: string | null;
  actor_rol: string | null;
  modulo: string;
  entidad: string;
  entidad_id: string | null;
  accion: string;
  campo: string | null;
  valor_anterior: string | null;
  valor_nuevo: string | null;
  descripcion: string | null;
  ip: string | null;
}

export interface PageResponse<T> {
  content: T[];
  total_elements: number;
  total_pages: number;
  page: number;
  size: number;
}

export interface AuditStats {
  total_eventos: number;
  login_exitosos: number;
  login_fallidos: number;
  cambio_clave: number;
  total_cambios: number;
  cambios_hoy: number;
  top_acciones: ActionCount[];
  top_actores: ActionCount[];
}

export interface ActionCount {
  nombre: string;
  cantidad: number;
}

export const ACTION_LABELS: Record<string, string> = {
  LOGIN:               'Inicio de sesión',
  LOGOUT:              'Cierre de sesión',
  USER_REGISTER:       'Registro de usuario',
  PASSWORD_CHANGE:     'Cambio de contraseña',
  PASSWORD_RESET_OTP:  'Restablecimiento por OTP',
  REFRESH:             'Renovación de token',
  OTP_SOLICITAR:       'OTP solicitado',
  OTP_VERIFICAR:       'OTP verificado',
  CREATE:              'Creación',
  UPDATE:              'Actualización',
  DELETE:              'Eliminación',
  VIEW:                'Visita',
};

export const ACTION_COLORS: Record<string, string> = {
  LOGIN:              '#4caf50',
  LOGOUT:             '#9e9e9e',
  USER_REGISTER:      '#2196f3',
  PASSWORD_CHANGE:    '#ff9800',
  PASSWORD_RESET_OTP: '#ff5722',
  CREATE:             '#4caf50',
  UPDATE:             '#2196f3',
  DELETE:             '#f44336',
  VIEW:               '#7e57c2',
};
