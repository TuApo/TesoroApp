export type ColumnType = 'select' | 'text' | 'date' | 'actions' | 'number' | 'status' | 'custom';

export interface ColumnConfig {
  columnDef: string;
  header: string;
  type: ColumnType;
  options?: { value: string; viewValue: string }[];
  placeholder?: string;
  cellFn?: (row: any) => string | number | boolean;
  editable?: boolean; // Si quieres inline editing
  width?: string; // Ej: '150px'
  align?: 'start' | 'center' | 'end';
  tooltipFn?: (row: any) => string; // Para tooltips custom
}

export type Align = 'left' | 'center' | 'right';

export interface ColumnDefinition {
  name: string;
  header: string;
  type: 'text' | 'number' | 'date' | 'select' | 'status' | 'custom';
  /**
   * Formato de presentación para columnas numéricas. Sin esto, `type:'number'`
   * pinta el valor crudo (`1300000`, `12.5`) porque la tabla cae al @default.
   * Es opcional: quien no lo declare sigue viendo exactamente lo de antes.
   */
  format?: 'currency' | 'percent' | 'decimal';
  /**
   * Patrón del DatePipe para columnas `type:'date'`. Sin esto se pinta 'dd/MM/yyyy',
   * que es lo de siempre; declararlo permite mostrar la hora ('dd/MM/yyyy HH:mm')
   * cuando el dato es un instante y no una fecha suelta.
   */
  dateFormat?: string;
  options?: string[];
  statusConfig?: Record<string, { color: string; background: string }>;
  customClassConfig?: Record<string, { color: string; background: string }>;
  width?: string;
  filterable?: boolean;
  sortable?: boolean; // por defecto true; desactivar en columnas como actions/attachment
  stickyStart?: boolean;
  stickyEnd?: boolean;
  align?: Align;
  placeholder?: string;
}

/** Tipo para tags de filtros activos */
export interface ActiveFilter {
  name: string;
  header: string;
  type: ColumnDefinition['type'] | 'date';
  value: any;
  operator?: FilterOperator; // Nuevo: para mostrar "Contiene: X" o ">= X"
}

export type FilterOperator = 'contains' | 'equals' | 'startsWith' | 'range' | 'gte' | 'lte' | 'in';

export interface DynamicTableColumn {
  key: string;   // nombre de la propiedad en el row
  label: string; // encabezado visible
  // opcional: por si luego quieres diferenciar tipos
  type?: 'text' | 'number' | 'date' | 'status' | 'boolean';
}

export interface DynamicTableConfig {
  title: string;
  columns: DynamicTableColumn[];
  options: any[];
  selected?: any[];
  selectLabel?: string;
  filterPlaceholder?: string;
  icon?: string;
  objetive?: string;
  idUser?: string; // Para identificar al usuario si es necesario
}

export interface DynamicTableAction {
  label: string;
  icon: string; // 'visibility', 'edit', 'delete', etc.
  color?: 'primary' | 'accent' | 'warn';
  callback: (row: any) => void;
}

/** Config de cada acción de permiso para la matriz (Leer, Crear, etc.) */
export interface PermissionActionConfig {
  key: string;       // Código backend: READ, CREATE, UPDATE, DELETE, DOWNLOAD, UPLOAD...
  label: string;     // Texto visible: "Leer", "Crear"...
  shortLabel?: string; // Opcional, por si quieres abreviar en la UI
}

// 👇 Datos que se inyectan desde MatDialog.open(...)
export interface DynamicTableDialogData {
  title?: string;
  icon?: string;
  columns?: DynamicTableColumn[];         // definición simple (key/label)
  columnDefinitions?: ColumnDefinition[]; // si quieres pasar las defs avanzadas directamente
  data?: any[];
  actions?: DynamicTableAction[];
  pageSizeOptions?: number[];
  defaultPageSize?: number;

  /** Modo de funcionamiento del DynamicTable */
  mode?: 'default' | 'permissionsMatrix';

  /**
   * Solo para mode === 'permissionsMatrix':
   * columnas de permisos (Leer, Crear, Actualizar, Eliminar, Descargar, Subir...)
   */
  permissionActions?: PermissionActionConfig[];

  /**
   * Callback que se ejecuta cuando se marca / desmarca un permiso
   * row: fila (módulo)
   * actionKey: código de acción (READ, CREATE, etc.)
   * checked: true/false
   */
  onTogglePermiso?: (row: any, actionKey: string, checked: boolean) => void;
}
