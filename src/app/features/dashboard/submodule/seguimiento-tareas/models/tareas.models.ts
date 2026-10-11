/**
 * Contrato del API de Seguimiento Tareas (ms-tools, prefijo /matder).
 *
 * Los nombres de campo van tal cual los serializa el backend (snake_case de los DTOs de
 * MatderDtos). El prefijo del API sigue siendo /matder por compatibilidad con el gateway
 * y con los otros módulos que ya lo llaman; el módulo en pantalla se llama Seguimiento Tareas.
 */

export type Estado = 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE';
export type Prioridad = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TipoLista = Estado | 'UNASSIGNED';
export type RolEspacio = 'OWNER' | 'MANAGER' | 'MEMBER' | 'VIEWER';

/** Alcance de "Mis tareas" (GET /matder/my-tasks?scope=). */
export type Alcance = 'asignadas' | 'delegadas' | 'sigo' | 'todas';

export interface EtiquetaTarea {
  id: number;
  card: number;
  label: number;
  label_name: string;
  label_color: string;
}

/** Resumen de tarea. En listados trae contexto (tablero/espacio/lista) y conteos. */
export interface Tarea {
  id: number;
  uuid: string;
  board_id: number | null;
  board_list: number | null;
  title: string;
  status: Estado;
  priority: Prioridad;
  due_at: string | null;
  position: number;
  assignee: string | null;
  assignee_name: string | null;
  assignee_group: number | null;
  assignee_group_name?: string | null;
  created_at: string;
  created_by?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
  origen_tipo?: string | null;
  origen_ref?: string | null;
  origen_url?: string | null;
  board_name?: string | null;
  board_accent?: string | null;
  workspace_id?: number | null;
  workspace_name?: string | null;
  list_name?: string | null;
  list_type?: TipoLista | null;
  checklist_total?: number;
  checklist_done?: number;
  comment_count?: number;
  attachment_count?: number;
  watcher_count?: number;
  is_watching?: boolean;
  labels?: EtiquetaTarea[];
}

export interface ItemChecklist {
  id: number;
  card: number;
  content: string;
  completed: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface Comentario {
  id: number;
  uuid: string;
  card: number;
  author: string | null;
  author_name: string | null;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface Adjunto {
  id: number;
  uuid: string;
  card: number | null;
  original_name: string;
  file: string;
  mime_type: string | null;
  size_bytes: number;
  uploader: string | null;
  created_at: string;
}

export interface Seguidor {
  usuario_id: string;
  created_at: string;
}

export interface TareaDetalle extends Tarea {
  description: string | null;
  checklist_items: ItemChecklist[];
  comments: Comentario[];
  card_labels: EtiquetaTarea[];
  uploads: Adjunto[];
  watchers?: Seguidor[];
  workspace_role?: RolEspacio | null;
  can_edit?: boolean;
}

export interface Lista {
  id: number;
  uuid: string;
  board: number;
  name: string;
  list_type: TipoLista | null;
  position: number;
  cards: Tarea[];
  created_at: string;
  updated_at: string;
}

export interface Tablero {
  id: number;
  uuid: string;
  workspace: number;
  workspace_name: string;
  workspace_role: RolEspacio | null;
  name: string;
  description: string | null;
  accent: string | null;
  can_manage_content: boolean;
  is_favorite?: boolean;
  created_at: string;
  updated_at: string;
}

export interface Etiqueta {
  id: number;
  uuid: string;
  board: number;
  name: string;
  color: string;
  created_at: string;
}

export interface Espacio {
  id: number;
  uuid: string;
  name: string;
  description: string | null;
  owner: string;
  owner_name: string | null;
  member_count: number;
  board_count: number;
  current_user_role: RolEspacio | null;
  can_manage_members: boolean;
  can_create_boards: boolean;
  can_delete_workspace: boolean;
  is_favorite?: boolean;
  created_at: string;
  updated_at: string;
}

export interface MiembroEspacio {
  id: number;
  workspace: number;
  user: string;
  username: string | null;
  full_name: string | null;
  role: RolEspacio;
  active: boolean;
  added_by: string | null;
  joined_at: string;
  updated_at: string;
}

export interface Grupo {
  id: number;
  uuid: string | null;
  name: string;
  description: string | null;
  member_count: number;
  created_at: string;
  updated_at: string;
}

export interface MiembroGrupo {
  id: number;
  group: number;
  user: string;
  username: string | null;
  full_name: string | null;
  joined_at: string;
}

export interface Resumen {
  total_workspaces: number;
  active_workspaces: number;
  total_boards: number;
  active_boards: number;
  total_lists: number;
  total_tasks: number;
  todo_tasks: number;
  in_progress_tasks: number;
  blocked_tasks: number;
  completed_tasks: number;
  overdue_tasks: number;
  due_soon_tasks: number;
  assigned_tasks: number;
  unassigned_tasks: number;
  tasks_with_due_date: number;
  completion_rate: number;
  assignment_coverage_rate: number;
  due_date_coverage_rate: number;
  due_soon_window_days: number;
  workspace_indicators: IndicadorEspacio[];
  board_indicators: IndicadorTablero[];
}

export interface IndicadorEspacio {
  id: number;
  name: string;
  board_count: number;
  task_count: number;
  todo_task_count: number;
  in_progress_task_count: number;
  blocked_task_count: number;
  completed_task_count: number;
  overdue_task_count: number;
  progress_percent: number;
}

export interface IndicadorTablero extends IndicadorEspacio {
  workspace_name: string;
  accent: string;
  list_count: number;
  unassigned_task_count: number;
}

export interface RegistroAuditoria {
  id: number;
  user: string | null;
  user_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface RegistroImportacion {
  id: number;
  user: string | null;
  workspace: number;
  file_name: string;
  boards_created: number;
  cards_created: number;
  errors: string[] | null;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  created_at: string;
}

export type TipoParametro = 'BOOLEANO' | 'ENTERO' | 'TEXTO' | 'OPCION' | 'LISTAS';

export interface Parametro {
  clave: string;
  valor: string | null;
  tipo: TipoParametro;
  opciones: string[];
  grupo: string;
  etiqueta: string;
  descripcion: string | null;
  orden: number;
  updated_by: string | null;
  updated_at: string | null;
}

/** Datos con que se abre el formulario de tarea desde este u otro módulo. */
export interface NuevaTareaPrefill {
  titulo?: string;
  descripcion?: string;
  tableroId?: number;
  listaId?: number;
  responsable?: string | null;
  grupo?: number | null;
  prioridad?: Prioridad;
  vence?: Date | null;
  /** Registro de otro módulo del que nace la tarea (compromiso de reunión, ticket...). */
  origen?: { tipo: string; ref: string; url?: string | null; etiqueta?: string };
}
