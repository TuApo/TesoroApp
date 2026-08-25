/**
 * Modelos del submódulo Administración → Gestión del Programa → Correos
 * electrónicos. Espejo de los DTOs de ms-auth-admin (`/api/v1/admin/correos`),
 * que serializan en snake_case como el resto de la plataforma.
 *
 * NUNCA existe un campo de contraseña en la respuesta: el backend solo publica
 * `credencial_configurada`.
 */

/** Selector controlado; debe coincidir con el enum ProveedorCorreo del backend. */
export type ProveedorCorreo = 'GMAIL' | 'OUTLOOK' | 'YANDEX' | 'SMTP_PROPIO' | 'OTRO';

/** Estados de verificación; espejo del enum EstadoVerificacionCorreo. */
export type EstadoVerificacionCorreo =
  | 'PENDIENTE'
  | 'VERIFICADA'
  | 'ERROR_AUTENTICACION'
  | 'ERROR_CONEXION'
  | 'ERROR_CONFIGURACION'
  | 'DESHABILITADA';

/** Cuenta remitente tal como la devuelve el listado / detalle. */
export interface CorreoCuenta {
  id: string;
  direccion: string;
  nombre_mostrar: string | null;
  proveedor: ProveedorCorreo;
  proposito: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_usuario: string | null;
  /** Cuota declarada para la cuenta (correos/día). Es la única cuota del modelo. */
  cuota_diaria: number;
  /** Tope real de envío: el `umbral_corte_pct`% de la cuota. Ahí se corta. */
  limite_efectivo: number;
  /** Porcentaje del corte automático (90 por defecto). */
  umbral_corte_pct: number;
  /** Enviados HOY por esta cuenta, según el ledger. Consumo real. */
  enviados_hoy: number;
  /** Lo que queda de verdad hoy: limite_efectivo − enviados_hoy. */
  disponible_hoy: number;
  estado_verificacion: EstadoVerificacionCorreo;
  ultima_verificacion: string | null;
  mensaje_ultima_verificacion: string | null;
  activo: boolean;
  notas: string | null;
  /** true si hay credencial SMTP guardada. Jamás se expone su valor. */
  credencial_configurada: boolean;
  /** activa + VERIFICADA. Es lo único que suma al pool de cuota. */
  aporta_cuota: boolean;
  creado_por: string | null;
  creado_en: string | null;
  actualizado_por: string | null;
  actualizado_en: string | null;
}

/**
 * Payload de creación/edición. `smtp_password`:
 *  - en creación es obligatoria cuando la configuración autentica;
 *  - en edición, omitirla o mandarla vacía CONSERVA la credencial actual.
 */
export interface CorreoCuentaUpsert {
  direccion: string;
  nombre_mostrar: string | null;
  proveedor: ProveedorCorreo;
  proposito: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_usuario: string | null;
  smtp_password?: string | null;
  cuota_diaria: number;
  notas: string | null;
}

/**
 * Resumen del pool. `disponible_hoy` se mide contra `limite_efectivo_total`
 * (el 90% de cada cuota), no contra la cuota declarada: ese 10% restante es el
 * colchón que nunca se consume. Fase 1: `enviados_hoy` siempre 0 (sin ledger).
 */
export interface CuotaResumen {
  cuentas_activas: number;
  cuentas_verificadas: number;
  cuota_total: number;
  limite_efectivo_total: number;
  umbral_corte_pct: number;
  enviados_hoy: number;
  disponible_hoy: number;
}

/** Respuesta de POST /{id}/verificar. */
export interface VerificacionCorreo {
  verificada: boolean;
  estado_verificacion: EstadoVerificacionCorreo;
  mensaje: string | null;
  cuenta: CorreoCuenta;
}

/**
 * Umbral de corte por defecto (%). El backend es la fuente de verdad y lo
 * devuelve en cada respuesta (`umbral_corte_pct`); esta constante solo cubre el
 * caso en que aún no se ha cargado nada de la API.
 */
export const UMBRAL_CORTE_PCT = 90;

/** Tope real de envío: el `pct`% de la cuota, truncado hacia abajo. */
export function limiteEfectivo(cuota: number | null | undefined, pct = UMBRAL_CORTE_PCT): number {
  if (!cuota || cuota <= 0) return 0;
  return Math.floor((cuota * pct) / 100);
}

/** Opciones del selector de proveedor (valor interno + etiqueta visible). */
export const PROVEEDORES_CORREO: { value: ProveedorCorreo; label: string }[] = [
  { value: 'GMAIL', label: 'Gmail' },
  { value: 'OUTLOOK', label: 'Outlook / Microsoft 365' },
  { value: 'YANDEX', label: 'Yandex' },
  { value: 'SMTP_PROPIO', label: 'SMTP propio' },
  { value: 'OTRO', label: 'Otro' },
];

/**
 * Host/puerto sugeridos por proveedor (mismos valores por defecto que aplica el
 * backend). Sirven para autocompletar el formulario; SMTP_PROPIO y OTRO exigen
 * que el operador los digite.
 */
export const SMTP_POR_DEFECTO: Record<ProveedorCorreo, { host: string; port: number } | null> = {
  GMAIL: { host: 'smtp.gmail.com', port: 465 },
  OUTLOOK: { host: 'smtp.office365.com', port: 587 },
  YANDEX: { host: 'smtp.yandex.com', port: 465 },
  SMTP_PROPIO: null,
  OTRO: null,
};

/** Proveedores que siempre autentican (contraseña obligatoria al crear). */
export const PROVEEDORES_CON_AUTENTICACION: ProveedorCorreo[] = ['GMAIL', 'OUTLOOK', 'YANDEX'];

/** Etiqueta + color de cada estado de verificación, para la tabla y el detalle. */
export const ESTADO_VERIFICACION_META: Record<
  EstadoVerificacionCorreo,
  { label: string; icon: string; clase: string }
> = {
  VERIFICADA: { label: 'Verificada', icon: 'verified', clase: 'estado-verificada' },
  PENDIENTE: { label: 'Pendiente', icon: 'schedule', clase: 'estado-pendiente' },
  ERROR_AUTENTICACION: { label: 'Error de autenticación', icon: 'key_off', clase: 'estado-error-auth' },
  ERROR_CONEXION: { label: 'Error de conexión', icon: 'wifi_off', clase: 'estado-error-conexion' },
  ERROR_CONFIGURACION: { label: 'Error de configuración', icon: 'settings_alert', clase: 'estado-error-config' },
  DESHABILITADA: { label: 'Deshabilitada', icon: 'do_not_disturb_on', clase: 'estado-deshabilitada' },
};

/** Payload de envío. Sin `cuenta_id` el backend elige la de más cupo. */
export interface EnvioRequest {
  cuenta_id?: string | null;
  destinatario: string;
  asunto: string;
  cuerpo_html: string;
  origen?: string | null;
}

/** Resultado de un envío: qué cuenta se usó y cómo quedó su cupo. */
export interface EnvioResultado {
  enviado: boolean;
  cuenta_id: string;
  remitente: string;
  destinatario: string;
  enviados_hoy: number;
  disponible_hoy: number;
  mensaje: string;
}
