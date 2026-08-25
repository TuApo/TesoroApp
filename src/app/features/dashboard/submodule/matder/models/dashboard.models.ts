export interface DashboardOverviewResponse {
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
  workspace_indicators: WorkspaceIndicator[];
  board_indicators: BoardIndicator[];
}

export interface WorkspaceIndicator {
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

export interface BoardIndicator {
  id: number;
  name: string;
  workspace_name: string;
  accent: string;
  list_count: number;
  task_count: number;
  todo_task_count: number;
  in_progress_task_count: number;
  blocked_task_count: number;
  completed_task_count: number;
  overdue_task_count: number;
  unassigned_task_count: number;
  progress_percent: number;
}

export interface NotificationResponse {
  id: number;
  user: string;
  title: string;
  message: string;
  type: string;
  link: string | null;
  read: boolean;
  created_at: string;
}

export interface UserGroupResponse {
  id: number;
  uuid: string;
  name: string;
  description: string | null;
  member_count: number;
  created_at: string;
  updated_at: string;
}

export interface GroupMemberResponse {
  id: number;
  group: number;
  user: string;
  username: string | null;
  full_name: string | null;
  joined_at: string;
}

export interface AuditLogResponse {
  id: number;
  user: string | null;
  user_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface ImportLogResponse {
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
