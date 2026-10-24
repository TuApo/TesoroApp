import { FormAccess } from '../../dynamic-forms/models/process.models';

/**
 * INICIO DEL MÓDULO COORDINADORES ("Asistentes al Trabajador en Misión").
 *
 * Los formularios de los coordinadores son formularios dinámicos de ms-forms (categoría
 * COORDINADORES, migrados de Google Forms el 2026-10-23) colgados del menú bajo
 * `/dashboard/coordinadores/<grupo>/<slug>`. Esta pantalla NO los reimplementa: solo
 * lleva a ellos y resume lo que el backend deja ver a cada rol.
 */

/** Ruta raíz del módulo (relativa a /dashboard). */
export const RAIZ_COORDINADORES = 'coordinadores';

/** Grupo del menú: segundo segmento de la ruta del formulario. */
export interface GrupoCoordinadores {
  slug: string;
  nombre: string;
  icono: string;
  descripcion: string;
}

/**
 * Orden y nombre de los grupos. Coinciden con los módulos db_admin
 * `ca000000-0000-4000-8000-00000000000{2..5}`; si mañana se cuelga un grupo nuevo del
 * menú, aparece igual (al final, con el nombre que traiga el árbol de permisos).
 */
export const GRUPOS_COORDINADORES: readonly GrupoCoordinadores[] = [
  { slug: 'visitas', nombre: 'Visitas y novedades', icono: 'event_available',
    descripcion: 'Informe diario y visitas a finca' },
  { slug: 'tramites', nombre: 'Trámites del personal', icono: 'assignment_ind',
    descripcion: 'Cartas, paz y salvo, memorandos y tarjetas' },
  { slug: 'disciplinarios', nombre: 'Procesos disciplinarios', icono: 'gavel',
    descripcion: 'Procesos e informes disciplinarios' },
  { slug: 'seguridad-social', nombre: 'Seguridad social y SST', icono: 'medical_services',
    descripcion: 'EPS, plan funerario e inspecciones SST' },
];

/**
 * Campo de control que el jefe de área usa para devolver o aprobar el caso. Todos los
 * formularios migrados lo tienen (sección `control`, SINGLE_CHOICE con Registrado /
 * En revisión / Devuelto al coordinador / Aprobado / Archivado).
 */
export const CAMPO_ESTADO_CASO = { seccion: 'control', nombre: 'estado_del_caso' } as const;
export const COLUMNA_ESTADO_CASO = `${CAMPO_ESTADO_CASO.seccion}__${CAMPO_ESTADO_CASO.nombre}`;
export const ESTADO_DEVUELTO = 'Devuelto al coordinador';
export const SIN_ESTADO = 'Sin estado';

/** Orden de presentación de los estados del caso (los desconocidos van al final). */
export const ORDEN_ESTADOS_CASO = [
  'Registrado', 'En revisión', ESTADO_DEVUELTO, 'Aprobado', 'Archivado', SIN_ESTADO,
];

/** Un formulario que el usuario tiene en su menú, ya resuelto contra ms-forms. */
export interface FormularioCoordinador {
  /** Ruta absoluta del menú, p. ej. `/dashboard/coordinadores/visitas/informe-diario`. */
  ruta: string;
  /** Ruta relativa a /dashboard (lo que entiende ms-forms). */
  rutaRelativa: string;
  nombre: string;
  icono: string;
  grupo: string;
  /** null hasta resolverlo (o si la ruta ya no es un formulario). */
  formId: number | null;
  acceso: FormAccess | null;
}

/** Un estado del caso con su conteo. */
export interface ConteoEstado {
  estado: string;
  total: number;
}

/** Punto de la línea de tiempo (día local yyyy-MM-dd). */
export interface PuntoDia {
  dia: string;
  total: number;
}

/**
 * Estadística de un formulario, tal como la arma el resumen por categoría de ms-forms
 * (`GET /api/dynamic-forms/categories/COORDINADORES/summary`). Ya viene recortada a las
 * oficinas del usuario cuando es COORDINADOR / JEFE-DE-AREA.
 */
export interface EstadisticaFormulario {
  formId: number;
  fuente: 'resumen';
  total: number | null;
  delMes: number | null;
  /** Se conserva por compatibilidad de la plantilla; el resumen nunca es parcial. */
  delMesParcial: boolean;
  /** Registros (de todo el histórico) creados por el usuario actual. */
  mios: number | null;
  /** Estado del caso, histórico completo. */
  estados: ConteoEstado[];
  alcanceEstados: 'todo' | 'mes';
  /** Últimos 90 días, solo si el usuario tiene analítica del formulario. */
  lineaTiempo: PuntoDia[];
  ultimoRegistro: string | null;
}

/** Alcance por oficina con que el backend calculó el resumen. */
export interface AlcanceResumen {
  /** true = COORDINADOR / JEFE-DE-AREA viendo solo sus oficinas. */
  restringido: boolean;
  oficinas: string[];
  /** "Viendo: la oficina SUBA", "Viendo: todas las oficinas"… */
  texto: string;
}

// ── Contrato de ms-forms (snake_case) ──────────────────────────────────────

export interface ResumenCategoriaApi {
  categoria: string;
  alcance: AlcanceResumen;
  generado_en: string | null;
  formularios: ResumenFormularioApi[];
  pendientes_total: number;
  pendientes: PendienteApi[];
}

export interface ResumenFormularioApi {
  form_id: number;
  nombre: string;
  route_path: string | null;
  puede_ver_respuestas: boolean;
  puede_procesar: boolean;
  puede_ver_analitica: boolean;
  total: number;
  del_mes: number;
  mios: number;
  ultimo_registro: string | null;
  por_estado_caso: { estado: string; total: number }[];
  ultimos_90_dias: { dia: string; total: number }[];
}

export interface PendienteApi {
  id: number;
  form_id: number;
  nombre_formulario: string | null;
  route_path: string | null;
  submitted_at: string | null;
  record_key: string | null;
  estado: string;
}

/** Un caso que espera al coordinador. */
export interface CasoPendiente {
  formId: number;
  formulario: string;
  rutaProceso: string;
  submissionId: number;
  llave: string | null;
  estado: string;
  fecha: string | null;
}
