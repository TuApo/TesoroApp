/**
 * Modelos de Administración → Notificaciones (parametrización del hub).
 *
 * Espejo de los DTOs de ms-auth-admin (`/api/v1/admin/notificaciones/config`),
 * que serializan en snake_case como el resto de la plataforma.
 *
 * `Urgencia`, `DestinoTipo` y `NotificationType` NO se redeclaran aquí: ya viven
 * en `core/services/notification-center.service` porque los usa la campana. Un
 * segundo juego de literales terminaría divergiendo del primero, que es
 * exactamente el problema que este módulo vino a resolver.
 */
import { DestinoTipo, NotificationType, Urgencia } from '@/app/core/services/notification-center.service';

export type { DestinoTipo, NotificationType, Urgencia };

/** Cómo se decide QUIÉN recibe. Espejo del enum AudienciaModo del backend. */
export type AudienciaModo = 'PAYLOAD' | 'USUARIOS' | 'ROLES' | 'MODULO' | 'SEDE' | 'TODOS';

/** Canales de entrega. Espejo del enum Canal. */
export type Canal = 'IN_APP' | 'EMAIL' | 'PUSH';

/** Operadores admitidos por `condicion_json`. Espejo de CondicionEvaluador. */
export type OperadorCondicion =
  | 'EQ' | 'NEQ' | 'IN' | 'NOT_IN' | 'CONTAINS'
  | 'GT' | 'GTE' | 'LT' | 'LTE' | 'EXISTS' | 'NOT_EXISTS';

/** Una condición suelta. El backend las une con AND. */
export interface Condicion {
  campo: string;
  op: OperadorCondicion;
  valor?: unknown;
}

/** Una regla tal como la devuelve el listado de administración. */
export interface NotifRegla {
  id: string;
  evento_clave: string;
  tipo_id: string | null;
  tipo_clave: string | null;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  /** JSON crudo: lista de condiciones unidas por AND. null = la regla siempre aplica. */
  condicion_json: string | null;
  audiencia_modo: AudienciaModo;
  /** JSON crudo: lista de UUID según el modo. Irrelevante en PAYLOAD y TODOS. */
  audiencia_json: string | null;
  excluir_actor: boolean;
  canales: Canal[];
  plantilla_titulo: string;
  plantilla_mensaje: string | null;
  destino_tipo: DestinoTipo;
  destino_valor: string | null;
  dedup_ventana_min: number | null;
  /** Override del tipo. null = hereda `urgencia_default` del tipo. */
  urgencia: Urgencia | null;
  /** La que se aplica de verdad: el override si lo hay, si no la del tipo. */
  urgencia_efectiva: Urgencia;
  creado_en: string | null;
  actualizado_en: string | null;
}

/**
 * Payload de alta/edición. En PATCH los campos omitidos se conservan, así que
 * el diálogo manda siempre el objeto completo salvo en el toggle de activo.
 */
export interface ReglaRequest {
  evento_clave?: string;
  tipo_id?: string;
  nombre?: string;
  descripcion?: string | null;
  activo?: boolean;
  condicion_json?: string | null;
  audiencia_modo?: AudienciaModo;
  audiencia_json?: string | null;
  excluir_actor?: boolean;
  canales?: Canal[];
  plantilla_titulo?: string;
  plantilla_mensaje?: string | null;
  destino_tipo?: DestinoTipo;
  destino_valor?: string | null;
  dedup_ventana_min?: number | null;
  urgencia?: Urgencia | null;
}

/** Alta/edición de tipo. `clave` solo se acepta al crear: el backend la congela. */
export interface TipoRequest {
  clave?: string;
  nombre?: string;
  descripcion?: string | null;
  icono?: string;
  color?: string;
  urgencia_default?: Urgencia;
  modulo_id?: string | null;
  agrupable?: boolean;
  activo?: boolean;
  orden?: number;
}

/** Evento de ejemplo con el que se prueba una regla. */
export interface SimularRequest {
  actor_id?: string | null;
  destinatarios?: string[] | null;
  dedup_key?: string | null;
  payload?: Record<string, unknown>;
}

/**
 * Resultado del dry-run. `escribio` siempre viene en false: es la garantía de
 * que simular no manda nada, y por eso se pinta en pantalla.
 */
export interface SimulacionResultado {
  regla: string;
  evento_clave: string;
  condicion_se_cumple: boolean;
  audiencia_modo: AudienciaModo;
  destinatarios_total: number;
  /** Acotada a 50 por el backend: con audiencia TODOS serían miles de UUID. */
  destinatarios_muestra: string[];
  titulo: string;
  mensaje: string | null;
  destino_tipo: DestinoTipo;
  destino_valor: string | null;
  urgencia: Urgencia;
  canales: Canal[];
  escribio: boolean;
}

// ── Catálogos de presentación ──────────────────────────────────────────────

export const URGENCIAS: { value: Urgencia; label: string; icono: string; clase: string }[] = [
  { value: 'INFO',       label: 'Informativa', icono: 'info',           clase: 'urg-info' },
  { value: 'IMPORTANTE', label: 'Importante',  icono: 'priority_high',  clase: 'urg-importante' },
  { value: 'URGENTE',    label: 'Urgente',     icono: 'warning',        clase: 'urg-urgente' },
  { value: 'CRITICA',    label: 'Crítica',     icono: 'e911_emergency', clase: 'urg-critica' },
];

export const URGENCIA_META: Record<Urgencia, { label: string; icono: string; clase: string }> =
  Object.fromEntries(URGENCIAS.map((u) => [u.value, { label: u.label, icono: u.icono, clase: u.clase }])) as
    Record<Urgencia, { label: string; icono: string; clase: string }>;

/**
 * Cada modo dice de dónde salen los destinatarios y qué hay que pedirle al
 * operador. `pideIds` es lo que decide si el diálogo muestra el selector: en
 * PAYLOAD los ids los trae el evento y en TODOS no hay nada que elegir.
 */
export const AUDIENCIA_MODOS: {
  value: AudienciaModo; label: string; ayuda: string; pideIds: boolean; icono: string;
}[] = [
  { value: 'PAYLOAD',  label: 'Los que indique el evento', icono: 'call_received',
    ayuda: 'El módulo que publica el hecho ya sabe a quién avisar y manda los ids en el evento.',
    pideIds: false },
  { value: 'USUARIOS', label: 'Personas concretas', icono: 'person',
    ayuda: 'Lista fija de personas. Útil para avisos a un equipo pequeño y estable.',
    pideIds: true },
  { value: 'ROLES',    label: 'Por rol', icono: 'security',
    ayuda: 'Todos los usuarios activos con alguno de estos roles vigentes.',
    pideIds: true },
  { value: 'SEDE',     label: 'Por sede', icono: 'location_on',
    ayuda: 'Todos los usuarios activos asignados a alguna de estas sedes.',
    pideIds: true },
  { value: 'MODULO',   label: 'Quien tenga acceso a un módulo', icono: 'apps',
    ayuda: 'Quien vea el módulo en su menú, por rol o por permiso individual.',
    pideIds: true },
  { value: 'TODOS',    label: 'Toda la organización', icono: 'groups',
    ayuda: 'Todos los usuarios activos. Simula antes: esto no se puede deshacer.',
    pideIds: false },
];

export const AUDIENCIA_MODO_LABEL: Record<AudienciaModo, string> =
  Object.fromEntries(AUDIENCIA_MODOS.map((m) => [m.value, m.label])) as Record<AudienciaModo, string>;

/** true si el modo necesita que el operador elija ids. */
export function modoPideIds(modo: AudienciaModo): boolean {
  return AUDIENCIA_MODOS.find((m) => m.value === modo)?.pideIds ?? false;
}

/** El tipo de sujeto que hay que ofrecer en el selector para cada modo. */
export const SUJETO_DE_MODO: Partial<Record<AudienciaModo, 'ROL' | 'SEDE' | 'USUARIO' | 'MODULO'>> = {
  USUARIOS: 'USUARIO',
  ROLES: 'ROL',
  SEDE: 'SEDE',
  MODULO: 'MODULO',
};

export const CANALES: { value: Canal; label: string; icono: string; ayuda: string; disponible: boolean }[] = [
  { value: 'IN_APP', label: 'En la aplicación', icono: 'notifications', disponible: true,
    ayuda: 'Campana y página de Novedades.' },
  { value: 'EMAIL',  label: 'Correo', icono: 'mail', disponible: true,
    ayuda: 'Se publica en el tópico de correo; lo entrega ms-ai con las cuentas remitentes configuradas.' },
  { value: 'PUSH',   label: 'Push al móvil', icono: 'phone_iphone', disponible: false,
    ayuda: 'Aún no hay entrega real: requiere el proyecto Firebase. Marcarlo solo deja el registro en el ledger.' },
];

export const DESTINO_TIPOS: {
  value: DestinoTipo; label: string; ayuda: string; ejemplo: string; pideValor: boolean;
}[] = [
  { value: 'NINGUNO', label: 'No navegable', pideValor: false,
    ayuda: 'La notificación se lee y ya. Sin clic.', ejemplo: '' },
  { value: 'RUTA', label: 'Una pantalla de la app', pideValor: true,
    ayuda: 'Ruta interna. Admite placeholders del payload.', ejemplo: 'matder/cards/{{card.id}}' },
  { value: 'MODULO', label: 'Un módulo del menú', pideValor: true,
    ayuda: 'Id del módulo. Se valida al guardar y no navega si el usuario no tiene permiso.',
    ejemplo: '5a7c1e30-9f42-4c88-8b31-2d6ae51c7f01' },
  { value: 'FORM_DINAMICO', label: 'Un formulario dinámico', pideValor: true,
    ayuda: 'Id numérico del formulario.', ejemplo: '42' },
  { value: 'FORM_PUBLICO', label: 'Un formulario público', pideValor: true,
    ayuda: 'Token del enlace público; abre /f/{token}.', ejemplo: 'a1b2c3d4' },
  { value: 'URL', label: 'Un enlace externo', pideValor: true,
    ayuda: 'Debe empezar por http:// o https://. Abre en pestaña nueva.', ejemplo: 'https://tuapo.co' },
];

export const DESTINO_TIPO_LABEL: Record<DestinoTipo, string> =
  Object.fromEntries(DESTINO_TIPOS.map((d) => [d.value, d.label])) as Record<DestinoTipo, string>;

export const OPERADORES: { value: OperadorCondicion; label: string; pideValor: boolean; lista: boolean }[] = [
  { value: 'EQ',         label: 'es igual a',        pideValor: true,  lista: false },
  { value: 'NEQ',        label: 'es distinto de',    pideValor: true,  lista: false },
  { value: 'IN',         label: 'es alguno de',      pideValor: true,  lista: true },
  { value: 'NOT_IN',     label: 'no es ninguno de',  pideValor: true,  lista: true },
  { value: 'CONTAINS',   label: 'contiene el texto', pideValor: true,  lista: false },
  { value: 'GT',         label: 'es mayor que',      pideValor: true,  lista: false },
  { value: 'GTE',        label: 'es mayor o igual a',pideValor: true,  lista: false },
  { value: 'LT',         label: 'es menor que',      pideValor: true,  lista: false },
  { value: 'LTE',        label: 'es menor o igual a',pideValor: true,  lista: false },
  { value: 'EXISTS',     label: 'viene en el evento',pideValor: false, lista: false },
  { value: 'NOT_EXISTS', label: 'no viene en el evento', pideValor: false, lista: false },
];

/**
 * Íconos ofrecidos al crear un tipo. No es una lista cerrada — el campo acepta
 * cualquier nombre de Material Symbols — pero elegir de una paleta evita el
 * cuadrado vacío que deja un nombre de ícono mal escrito.
 */
export const ICONOS_SUGERIDOS = [
  'notifications', 'campaign', 'assignment', 'assignment_ind', 'task_alt', 'schedule',
  'event', 'alarm', 'comment', 'alternate_email', 'group_add', 'swap_horiz',
  'gavel', 'medical_services', 'payments', 'receipt_long', 'badge', 'description',
  'warning', 'error', 'verified', 'inventory_2', 'build', 'shopping_cart',
];

/** Paleta sugerida de colores del catálogo (los mismos tonos del seed V39). */
export const COLORES_SUGERIDOS = [
  '#2563eb', '#0ea5e9', '#14b8a6', '#22c55e', '#84cc16',
  '#eab308', '#f97316', '#ef4444', '#ec4899', '#a855f7',
  '#6366f1', '#64748b',
];

/**
 * Parsea `condicion_json` a la lista que edita el constructor visual.
 * Ante JSON inválido devuelve null (no lista vacía) para poder distinguir
 * "sin condiciones" de "condiciones que no se pudieron leer": lo segundo hay
 * que mostrarlo como JSON crudo y no dejar que el formulario lo pise.
 */
export function parseCondiciones(json: string | null): Condicion[] | null {
  if (!json || !json.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((c) => {
      const o = c as Record<string, unknown>;
      return { campo: String(o['campo'] ?? ''), op: (o['op'] as OperadorCondicion) ?? 'EQ', valor: o['valor'] };
    });
  } catch {
    return null;
  }
}

/** Serializa la lista del constructor. Lista vacía → null (la regla siempre aplica). */
export function serializarCondiciones(condiciones: Condicion[]): string | null {
  const limpias = condiciones.filter((c) => c.campo && c.campo.trim());
  if (!limpias.length) return null;
  return JSON.stringify(limpias.map((c) => {
    const op = OPERADORES.find((o) => o.value === c.op);
    if (!op?.pideValor) return { campo: c.campo.trim(), op: c.op };
    return { campo: c.campo.trim(), op: c.op, valor: c.valor };
  }));
}

/** Parsea `audiencia_json` (lista de UUID). Ante basura devuelve lista vacía. */
export function parseAudiencia(json: string | null): string[] {
  if (!json || !json.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Los `{{campo}}` que usa una plantilla. Alimenta el formulario de simulación. */
export function placeholdersDe(...plantillas: (string | null | undefined)[]): string[] {
  const encontrados = new Set<string>();
  for (const p of plantillas) {
    if (!p) continue;
    for (const m of p.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) encontrados.add(m[1]);
  }
  return [...encontrados];
}

/** Una opción del selector de audiencia (rol, sede, persona o módulo). */
export interface OpcionAudiencia {
  id: string;
  nombre: string;
  /** Segunda línea: documento de la persona, ruta del módulo… */
  detalle?: string;
}
