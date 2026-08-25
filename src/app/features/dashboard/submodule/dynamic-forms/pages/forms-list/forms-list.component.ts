import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import Swal from 'sweetalert2';

import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonToggleModule, MatButtonToggleChange } from '@angular/material/button-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';

import { environment } from '@/environments/environment';
import { StandardFilterTable } from '@/app/shared/components/standard-filter-table/standard-filter-table';
import { ColumnCellTemplateDirective } from '@/app/shared/directives/column-cell-template.directive';
import { ColumnDefinition } from '@/app/shared/models/advanced-table-interface';
import { DynamicFormService } from '../../services/dynamic-form.service';
import { PlacementService } from '../../services/placement.service';
import { ProcessControlService } from '../../services/process-control.service';
import {
  FormAccessDialogComponent, FormAccessDialogData,
} from '../../components/form-access-dialog/form-access-dialog.component';
import { FormColumn } from '../../models/process.models';
import { AiSummary, ApiProblem, FormDetail, FormSummary } from '../../models/dynamic-forms.models';
import { Placement, PlacementStatus } from '../../models/placement.models';
import { PublicLinksDialogComponent, PublicLinksDialogData } from '../../components/public-links-dialog/public-links-dialog.component';
import { PlacementDialogComponent, PlacementDialogData } from '../../components/placement-dialog/placement-dialog.component';
import { ExcelImportDialogComponent } from '../../components/excel-import-dialog/excel-import-dialog.component';
import { FormImportService } from '../../services/form-import.service';
import { ImportedForm } from '../../models/form-import.models';
import { leerUsuarioCrudo } from '@/app/core/utils/usuario-actual';
import { setLocalStorageItem } from '@/app/core/utils/safe-storage';

/** Filtro de estado del listado. `todos` no manda el parámetro `active`. */
type FiltroEstado = 'todos' | 'activos' | 'inactivos';

/** Filtro solo-cliente por estado de ubicación en el menú. */
type FiltroUbic = 'todos' | PlacementStatus;

/**
 * Fila tal como la consume la tabla estándar: valores PLANOS (lo que se busca,
 * ordena y filtra) más `_f`, el summary original que usan las plantillas y las
 * acciones. Sin esta capa habría que meter el formateo dentro de la tabla común.
 */
interface FilaForm {
  formulario: string;
  resumen_ia: string;
  categoria: string;
  version: string;
  respuestas: number;
  publico: string;
  estado: string;
  ubicacion: string;
  actualizado: string | null;
  _f: FormSummary;
}

/**
 * True si el usuario logueado puede borrar DEFINITIVAMENTE un formulario.
 * El rol vive en `localStorage["user"].rol` con dos shapes conocidos:
 * string plano ("ADMIN") u objeto `{id, nombre}` (login / UsuarioDetailSerializer).
 */
function calcularEsAdmin(): boolean {
  const user = leerUsuarioCrudo();
  const rol: unknown = user?.['rol'];
  let nombre = '';
  if (typeof rol === 'string') nombre = rol;
  else if (rol && typeof rol === 'object') nombre = String((rol as Record<string, unknown>)['nombre'] ?? '');
  const limpio = nombre.trim().toUpperCase();
  return limpio === 'ADMIN' || limpio === 'GERENCIA';
}

/**
 * FORMULARIOS DINÁMICOS — listado y administración.
 *
 * Puerta de entrada del submódulo: buscar/filtrar formularios (paginación en el
 * servidor), entrar a llenarlos, ver respuestas y analítica, editar la estructura
 * (crea versión nueva), gestionar links públicos, duplicar, activar/desactivar y
 * —solo ADMIN/GERENCIA— borrar definitivo.
 *
 * Ubicación en el menú: la columna "Ubicación" muestra el `placement_status`
 * (LINKED/PENDING/UNLINKED/FAILED) y las acciones Publicar / Mover-Renombrar /
 * Desvincular / Reintentar según ese estado.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-forms-list',
  standalone: true,
  imports: [
    CommonModule, RouterLink,
    MatCardModule, MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule,
    MatButtonToggleModule, MatProgressSpinnerModule, MatSnackBarModule, MatDialogModule,
    StandardFilterTable, ColumnCellTemplateDirective,
    ExcelImportDialogComponent,
  ],
  templateUrl: './forms-list.component.html',
  styleUrl: './forms-list.component.css',
})
export class FormsListComponent {
  private svc = inject(DynamicFormService);
  private placementSvc = inject(PlacementService);
  private processSvc = inject(ProcessControlService);
  private http = inject(HttpClient);
  private snack = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private router = inject(Router);
  private importSvc = inject(FormImportService);

  /** Base ABSOLUTA de las rutas del submódulo (coincide con el módulo sembrado en db_admin). */
  readonly base = '/dashboard/gestion-del-programa/formularios-dinamicos';

  /**
   * Abrir un formulario = ir a SU pantalla, la que trae las cinco vistas en pestañas
   * (formulario · respuestas · control del proceso · soportes · analítica). Antes cada
   * vista era una ruta suelta desde el listado y para pasar de una a otra había que volver.
   *
   * Qué pestañas ve cada quien lo decide el backend con los permisos del formulario: quien
   * solo tiene llenado entra al formulario y no ve barra de pestañas.
   */
  abrir(fila: { _f?: FormSummary } | FormSummary): void {
    const f = (fila as { _f?: FormSummary })._f ?? (fila as FormSummary);
    if (f?.id) this.abrirVista(f.id, '');
  }

  /** Abre el formulario directamente en una de sus vistas. */
  abrirVista(formId: number, sufijo: string): void {
    void this.router.navigateByUrl(`${this.base}/${formId}${sufijo}`);
  }

  /**
   * Permisos por rol y control del proceso, sin pasar por el constructor: aquí se define
   * quién ve qué del formulario y hasta qué columnas puede llenar. El diálogo carga la
   * configuración vigente del backend y guarda por su cuenta.
   */
  abrirPermisos(f: FormSummary): void {
    const abrir = (columns: FormColumn[]) => {
      const data: FormAccessDialogData = {
        formId: f.id,
        formName: f.name,
        config: null,
        columns,
      };
      this.dialog.open(FormAccessDialogComponent, { width: '820px', maxWidth: '96vw', data });
    };
    // Las columnas salen de la versión publicada; si el formulario aún no tiene una, el
    // diálogo sigue sirviendo para repartir permisos (solo no ofrece elegir columnas).
    this.processSvc.columns(f.id).subscribe({
      next: cols => abrir(cols),
      error: () => abrir([]),
    });
  }

  /** Solo ADMIN/GERENCIA ven el borrado definitivo. Se calcula una vez por sesión de la vista. */
  readonly esAdmin = calcularEsAdmin();

  // La app corre ZONELESS: todo estado que pinte la vista va en signals.
  readonly rows = signal<FormSummary[]>([]);
  readonly total = signal(0);
  readonly page = signal(0);
  readonly size = signal(25);
  readonly loading = signal(false);
  readonly loadError = signal(false);
  readonly filtro = signal<FiltroEstado>('todos');
  /** Filtro solo-cliente por estado de ubicación (sobre la página ya cargada). */
  readonly filtroUbic = signal<FiltroUbic>('todos');
  /** Id de la fila con una acción en curso (deshabilita sus botones). */
  readonly busyId = signal<number | null>(null);

  /** Diálogo de carga por Excel (plantilla parametrizada + carga individual o masiva). */
  readonly importarAbierto = signal(false);

  /** Fila con el resumen IA en curso (solo una a la vez: cada una cuesta una llamada). */
  readonly resumenBusyId = signal<number | null>(null);

  /** Filas visibles tras aplicar el filtro de ubicación en cliente. */
  private readonly filasVisibles = computed<FormSummary[]>(() => {
    const f = this.filtroUbic();
    if (f === 'todos') return this.rows();
    return this.rows().filter(r => this.estadoUbic(r) === f);
  });

  /** Lo que recibe la tabla estándar: valores planos + el summary original en `_f`. */
  readonly filas = computed<FilaForm[]>(() => this.filasVisibles().map(f => ({
    formulario: f.name,
    resumen_ia: this.resumenPlano(f),
    categoria: f.category || '—',
    version: f.current_version != null ? `v${f.current_version}` : 'Sin publicar',
    respuestas: f.submissions_count,
    publico: f.is_public ? 'Sí' : 'No',
    estado: f.active ? 'Activo' : 'Inactivo',
    ubicacion: this.ubicacionPlano(f),
    actualizado: f.updated_at || f.created_at,
    _f: f,
  })));

  /** Columnas de la tabla estándar. El resumen IA va junto al nombre, antes de Categoría. */
  readonly columnas: ColumnDefinition[] = [
    { name: 'formulario', header: 'Formulario', type: 'custom', width: '230px' },
    { name: 'resumen_ia', header: 'Resumen IA', type: 'custom', width: '380px', sortable: false },
    { name: 'categoria', header: 'Categoría', type: 'text', width: '150px' },
    { name: 'version', header: 'Versión', type: 'custom', width: '120px', align: 'center' },
    { name: 'respuestas', header: 'Respuestas', type: 'number', width: '120px', align: 'center' },
    {
      name: 'publico', header: 'Público', type: 'status', width: '110px', align: 'center',
      statusConfig: {
        'Sí': { color: '#067647', background: '#ecfdf3' },
        'No': { color: '#475467', background: '#f2f4f7' },
      },
    },
    {
      name: 'estado', header: 'Estado', type: 'status', width: '120px', align: 'center',
      statusConfig: {
        'Activo': { color: '#067647', background: '#ecfdf3' },
        'Inactivo': { color: '#b42318', background: '#fef3f2' },
      },
    },
    { name: 'ubicacion', header: 'Ubicación', type: 'custom', width: '280px' },
    { name: 'actualizado', header: 'Actualizado', type: 'date', width: '140px', align: 'center' },
    { name: 'actions', header: 'Acciones', type: 'custom', width: '220px', stickyEnd: true, sortable: false, filterable: false },
  ];
  /** Texto de búsqueda YA aplicado (lo manda la tabla estándar en modo servidor). */
  private readonly q = signal('');

  constructor() {
    this.cargar();
  }

  // ── Carga y filtros ─────────────────────────────────────────────────

  cargar(): void {
    this.loading.set(true);
    this.loadError.set(false);
    this.svc.list({
      q: this.q(),
      active: this.activeParam(),
      page: this.page(),
      size: this.size(),
    }).subscribe({
      next: r => {
        this.rows.set(r.content);
        this.total.set(r.total);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.loadError.set(true);
        this.snack.open(this.mensajeError(err, 'No se pudo cargar el listado de formularios'), 'Cerrar', { duration: 5000 });
      },
    });
  }

  /**
   * La búsqueda la resuelve ms-forms sobre TODO el universo, no sobre la página.
   * La tabla estándar ya emite con debounce de 400 ms; aquí solo se descarta el
   * texto que no cambió nada (p. ej. al perder y recuperar el foco).
   */
  onServerSearch(texto: string): void {
    const limpio = texto.trim();
    if (limpio === this.q()) return;
    this.q.set(limpio);
    this.page.set(0);
    this.cargar();
  }

  setFiltro(e: MatButtonToggleChange): void {
    const v = e.value as FiltroEstado;
    this.filtro.set(v);
    this.page.set(0);
    this.cargar();
  }

  onPageChange(e: { page: number; size: number }): void {
    this.page.set(e.page);
    this.size.set(e.size);
    this.cargar();
  }

  private activeParam(): boolean | null {
    switch (this.filtro()) {
      case 'activos': return true;
      case 'inactivos': return false;
      default: return null;
    }
  }

  // ── Ubicación en el menú ────────────────────────────────────────────

  /** Estado de ubicación efectivo: un summary sin dato se trata como PENDING. */
  estadoUbic(f: FormSummary): PlacementStatus {
    return f.placement_status ?? 'PENDING';
  }

  /** Etiqueta legible del estado de ubicación (para el badge). */
  ubicEtiqueta(f: FormSummary): string {
    switch (this.estadoUbic(f)) {
      case 'LINKED': return 'Publicado';
      case 'UNLINKED': return 'Desvinculado';
      case 'FAILED': return 'Error';
      default: return 'Pendiente';
    }
  }

  setFiltroUbic(e: MatButtonToggleChange): void {
    this.filtroUbic.set(e.value as FiltroUbic);
  }

  /** Publicar en el menú (PENDING/UNLINKED) → diálogo de ubicación en modo publish. */
  publicar(f: FormSummary): void {
    if (this.estadoUbic(f) === 'LINKED') return;
    this.abrirDialogoUbicacion(f, 'publish');
  }

  /** Mover / renombrar / reordenar (LINKED) → diálogo en modo move. */
  moverRenombrar(f: FormSummary): void {
    if (this.estadoUbic(f) !== 'LINKED') return;
    this.abrirDialogoUbicacion(f, 'move');
  }

  /**
   * Carga la ubicación actual (para precargar el diálogo) y lo abre. Al cerrar
   * con éxito, refresca el menú lateral en caliente.
   */
  private abrirDialogoUbicacion(f: FormSummary, mode: 'publish' | 'move'): void {
    if (this.busyId() !== null) return;
    this.busyId.set(f.id);
    this.placementSvc.getPlacement(f.id).subscribe({
      next: current => { this.busyId.set(null); this.lanzarDialogoUbicacion(f, mode, current); },
      error: () => {
        this.busyId.set(null);
        if (mode === 'publish') {
          // Sin ubicación previa legible: se publica desde cero.
          this.lanzarDialogoUbicacion(f, mode, undefined);
        } else {
          this.snack.open('No se pudo cargar la ubicación actual del formulario.', 'Cerrar', { duration: 5000 });
        }
      },
    });
  }

  private lanzarDialogoUbicacion(f: FormSummary, mode: 'publish' | 'move', current?: Placement): void {
    const data: PlacementDialogData = { formId: f.id, formName: f.name, current, mode };
    const ref = this.dialog.open(PlacementDialogComponent, {
      data,
      width: '760px',
      maxWidth: '95vw',
      autoFocus: false,
      restoreFocus: true,
    });
    ref.afterClosed().subscribe((res?: Placement) => {
      if (!res) return; // cancelado
      const titulo = mode === 'publish' ? 'Formulario publicado en el menú' : 'Ubicación actualizada';
      void Swal.fire({ icon: 'success', title: titulo, timer: 1400, showConfirmButton: false })
        .then(() => this.refrescarMenuLateralYRecargar());
    });
  }

  /** Desvincular del menú (LINKED): conserva formulario y respuestas. */
  desvincular(f: FormSummary): void {
    if (this.estadoUbic(f) !== 'LINKED' || this.busyId() !== null) return;
    Swal.fire({
      icon: 'warning',
      title: '¿Desvincular del menú?',
      text: `La entrada de "${f.name}" se quitará del menú. El formulario y sus respuestas se conservan; podrás volver a publicarlo cuando quieras.`,
      showCancelButton: true,
      confirmButtonText: 'Desvincular',
      cancelButtonText: 'Cancelar',
    }).then(res => {
      if (!res.isConfirmed) return;
      this.busyId.set(f.id);
      this.placementSvc.unlink(f.id).subscribe({
        next: () => {
          this.busyId.set(null);
          void Swal.fire({ icon: 'success', title: 'Formulario desvinculado', timer: 1400, showConfirmButton: false })
            .then(() => this.refrescarMenuLateralYRecargar());
        },
        error: (err: unknown) => {
          this.busyId.set(null);
          this.snack.open(this.mensajeError(err, 'No se pudo desvincular el formulario'), 'Cerrar', { duration: 5000 });
        },
      });
    });
  }

  /** Reintentar (FAILED): reconcilia el estado real en ms-auth-admin. */
  reintentarUbicacion(f: FormSummary): void {
    if (this.estadoUbic(f) !== 'FAILED' || this.busyId() !== null) return;
    this.busyId.set(f.id);
    this.placementSvc.retry(f.id).subscribe({
      next: p => {
        this.busyId.set(null);
        const conAvisos = (p.warnings?.length ?? 0) > 0;
        if (p.placement_status === 'FAILED' || conAvisos) {
          const items = (p.warnings ?? []).map(w => `<li>${this.esc(w)}</li>`).join('');
          const detalle = p.placement_error ? `<p>${this.esc(p.placement_error)}</p>` : '';
          void Swal.fire({
            icon: 'error',
            title: 'La ubicación sigue en error',
            html: `${detalle}${items ? `<ul style="text-align:left;margin:8px 0 0;padding-left:18px">${items}</ul>` : ''}`
              || 'El reintento no completó. Intenta de nuevo más tarde.',
            confirmButtonText: 'Entendido',
          });
        } else {
          void Swal.fire({ icon: 'success', title: 'Ubicación reconciliada', timer: 1400, showConfirmButton: false })
            .then(() => this.refrescarMenuLateralYRecargar());
        }
      },
      error: (err: unknown) => {
        this.busyId.set(null);
        void Swal.fire({
          icon: 'error',
          title: 'No se pudo reintentar',
          text: this.mensajeError(err, 'El servidor rechazó el reintento de ubicación.'),
          confirmButtonText: 'Cerrar',
        });
      },
    });
  }

  /**
   * Refresca el menú lateral EN CALIENTE (sin cerrar sesión) tras un cambio de
   * ubicación. El sidebar (navbar.component.ts) construye el menú desde
   * `localStorage["user"].permisos_tree`, que sólo relee en su ngOnInit /
   * refreshPermisos(); no hay canal para empujarle un refresco desde aquí sin
   * tocar ese componente (fuera del alcance de este cambio). Así que replicamos
   * su mismo GET (/gestion_admin/usuarios/{id}/), reescribimos 'user' con el
   * árbol nuevo y recargamos la página: el navbar se reinstancia y ya pinta el
   * módulo recién publicado/movido/desvinculado. Si el GET falla, recargamos
   * igual — el propio refreshPermisos() del navbar hará el fetch al reiniciar.
   */
  private refrescarMenuLateralYRecargar(): void {
    const recargar = () => { if (typeof window !== 'undefined') window.location.reload(); };
    const user = leerUsuarioCrudo();
    const idCrudo = user?.['id'];
    const userId = idCrudo != null ? String(idCrudo) : '';
    if (!userId) { recargar(); return; }
    const apiUrl = environment.apiUrl.replace(/\/+$/, '');
    this.http.get<unknown>(`${apiUrl}/gestion_admin/usuarios/${userId}/`).subscribe({
      next: resp => { setLocalStorageItem('user', JSON.stringify(resp)); recargar(); },
      error: () => recargar(),
    });
  }

  /** Escapa texto que va dentro del html de un Swal. */
  private esc(s: string): string {
    const mapa: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return s.replace(/[&<>"']/g, c => mapa[c] ?? c);
  }

  // ── Resumen IA ──────────────────────────────────────────────────────

  /**
   * Genera un resumen NUEVO (ms-forms → ms-ai) y lo deja guardado. Es explícito a
   * propósito: cada generación cuesta una llamada al modelo. Si falla, el backend
   * responde 503 sin tocar lo guardado, así que la celda sigue mostrando el anterior.
   */
  generarResumen(f: FormSummary): void {
    if (this.resumenBusyId() !== null) return;
    this.resumenBusyId.set(f.id);
    this.svc.generateAiSummary(f.id).subscribe({
      next: (r: AiSummary) => {
        this.resumenBusyId.set(null);
        this.aplicarResumen(f.id, r);
        this.snack.open(`Resumen de "${f.name}" actualizado`, 'Cerrar', { duration: 4000 });
      },
      error: (err: unknown) => {
        this.resumenBusyId.set(null);
        this.snack.open(
          this.mensajeError(err, 'No se pudo generar el resumen. Se conserva el anterior.'),
          'Cerrar', { duration: 6000 });
      },
    });
  }

  /** Resumen completo en un diálogo: en la celda va recortado a dos líneas. */
  verResumen(f: FormSummary): void {
    if (!f.ai_summary) return;
    const respuestas = f.ai_responses_summary
      ? `<p style="margin:12px 0 0"><b>Respuestas registradas</b><br>${this.esc(f.ai_responses_summary)}</p>`
      : '';
    const desactualizado = this.resumenDesactualizado(f)
      ? `<p style="margin:12px 0 0;color:#b54708"><b>Hay respuestas nuevas</b> desde que se generó `
        + `(${f.ai_summary_submissions ?? 0} de ${f.submissions_count}). Regenéralo para incluirlas.</p>`
      : '';
    void Swal.fire({
      icon: 'info',
      title: f.name,
      html: `<div style="text-align:left">`
        + `<p style="margin:0"><b>De qué trata</b><br>${this.esc(f.ai_summary)}</p>`
        + respuestas + desactualizado
        + `</div>`,
      showCancelButton: true,
      confirmButtonText: 'Regenerar con IA',
      cancelButtonText: 'Cerrar',
      width: '640px',
    }).then(res => {
      if (res.isConfirmed) this.generarResumen(f);
    });
  }

  /** Llegaron respuestas después de generarlo: el texto sigue siendo el vigente. */
  resumenDesactualizado(f: FormSummary): boolean {
    return !!f.ai_summary
      && f.ai_summary_submissions != null
      && f.submissions_count > f.ai_summary_submissions;
  }

  /** Actualiza SOLO la fila tocada: recargar la página entera perdería el scroll. */
  private aplicarResumen(id: number, r: AiSummary): void {
    this.rows.update(list => list.map(f => f.id === id ? {
      ...f,
      ai_summary: r.summary ?? null,
      ai_responses_summary: r.responses_summary ?? null,
      ai_summary_at: r.generated_at ?? null,
      ai_summary_submissions: r.submissions_count ?? null,
    } : f));
  }

  /** Texto plano del resumen: es lo que ordena y filtra la tabla en esa columna. */
  private resumenPlano(f: FormSummary): string {
    return [f.ai_summary, f.ai_responses_summary].filter(Boolean).join(' · ') || 'Sin resumen';
  }

  /** Ubicación en texto plano (la celda la pinta con chips). */
  private ubicacionPlano(f: FormSummary): string {
    switch (this.estadoUbic(f)) {
      case 'LINKED': return f.route_path || f.menu_label || '—';
      case 'UNLINKED': return 'Desvinculado';
      case 'FAILED': return 'Error';
      default: return 'Pendiente';
    }
  }

  // ── Acciones por fila ───────────────────────────────────────────────

  abrirLinksPublicos(f: FormSummary): void {
    const data: PublicLinksDialogData = { formId: f.id, formName: f.name };
    this.dialog.open(PublicLinksDialogComponent, {
      data,
      width: '680px',
      maxWidth: '95vw',
      autoFocus: false,
      restoreFocus: true,
    });
  }

  duplicar(f: FormSummary): void {
    if (this.busyId() !== null) return;
    Swal.fire({
      icon: 'question',
      title: '¿Duplicar formulario?',
      text: `Se creará una copia de "${f.name}" con su estructura vigente (sin respuestas ni links públicos).`,
      showCancelButton: true,
      confirmButtonText: 'Duplicar',
      cancelButtonText: 'Cancelar',
    }).then(res => {
      if (!res.isConfirmed) return;
      this.busyId.set(f.id);
      this.svc.duplicate(f.id).subscribe({
        next: (copia: FormDetail) => {
          this.busyId.set(null);
          // La copia nace sin ubicar (PENDING): se publica luego desde su fila.
          this.snack.open(
            `Formulario duplicado como "${copia.name}". Publícalo en el menú desde su fila.`,
            'Cerrar', { duration: 5000 });
          this.cargar();
        },
        error: (err: unknown) => {
          this.busyId.set(null);
          this.snack.open(this.mensajeError(err, 'No se pudo duplicar el formulario'), 'Cerrar', { duration: 5000 });
        },
      });
    });
  }

  /** Desactivar = borrado lógico (con confirmación); activar = PATCH active. */
  toggleActivo(f: FormSummary): void {
    if (this.busyId() !== null) return;
    if (f.active) {
      Swal.fire({
        icon: 'warning',
        title: '¿Desactivar formulario?',
        text: `"${f.name}" dejará de estar disponible para llenado; las respuestas ya guardadas se conservan y podrás reactivarlo cuando quieras.`,
        showCancelButton: true,
        confirmButtonText: 'Desactivar',
        cancelButtonText: 'Cancelar',
      }).then(res => {
        if (!res.isConfirmed) return;
        this.busyId.set(f.id);
        this.svc.softDelete(f.id).subscribe({
          next: () => {
            this.busyId.set(null);
            this.snack.open('Formulario desactivado', 'Cerrar', { duration: 4000 });
            this.cargar();
          },
          error: (err: unknown) => {
            this.busyId.set(null);
            this.snack.open(this.mensajeError(err, 'No se pudo desactivar el formulario'), 'Cerrar', { duration: 5000 });
          },
        });
      });
    } else {
      this.busyId.set(f.id);
      this.svc.patch(f.id, { active: true }).subscribe({
        next: () => {
          this.busyId.set(null);
          this.snack.open('Formulario activado', 'Cerrar', { duration: 4000 });
          this.cargar();
        },
        error: (err: unknown) => {
          this.busyId.set(null);
          this.snack.open(this.mensajeError(err, 'No se pudo activar el formulario'), 'Cerrar', { duration: 5000 });
        },
      });
    }
  }

  /**
   * Borrado DEFINITIVO (solo ADMIN/GERENCIA): irreversible, se lleva estructura,
   * versiones y respuestas. Doble confirmación: aviso + escribir "ELIMINAR".
   */
  eliminarDefinitivo(f: FormSummary): void {
    if (!this.esAdmin || this.busyId() !== null) return;
    Swal.fire({
      icon: 'warning',
      title: 'Eliminar definitivamente',
      html: `Vas a borrar <b>"${f.name}"</b> con sus versiones y sus `
        + `<b>${f.submissions_count}</b> respuesta(s).<br>Esta acción <b>no se puede deshacer</b>.`,
      showCancelButton: true,
      confirmButtonText: 'Continuar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#b42318',
    }).then(paso1 => {
      if (!paso1.isConfirmed) return;
      Swal.fire({
        icon: 'error',
        title: 'Confirmación final',
        text: 'Escribe ELIMINAR (en mayúsculas) para confirmar el borrado definitivo.',
        input: 'text',
        inputPlaceholder: 'ELIMINAR',
        inputAttributes: { autocomplete: 'off', 'aria-label': 'Escribe ELIMINAR para confirmar' },
        showCancelButton: true,
        confirmButtonText: 'Eliminar definitivo',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#b42318',
        preConfirm: (valor: string) => {
          if (valor !== 'ELIMINAR') {
            Swal.showValidationMessage('Debes escribir exactamente ELIMINAR');
            return false;
          }
          return true;
        },
      }).then(paso2 => {
        if (!paso2.isConfirmed) return;
        this.busyId.set(f.id);
        this.svc.hardDelete(f.id).subscribe({
          next: () => {
            this.busyId.set(null);
            this.snack.open(`Formulario "${f.name}" eliminado definitivamente`, 'Cerrar', { duration: 5000 });
            this.cargar();
          },
          error: (err: unknown) => {
            this.busyId.set(null);
            Swal.fire({
              icon: 'error',
              title: 'No se pudo eliminar',
              text: this.mensajeError(err, 'El servidor rechazó el borrado definitivo.'),
              confirmButtonText: 'Cerrar',
            });
          },
        });
      });
    });
  }

  // ── Carga por Excel ─────────────────────────────────────────────────

  /**
   * Un formulario leído del Excel se abre en el CONSTRUCTOR con todo cargado: es ahí donde
   * se revisa y se guarda. Como /builder no admite un objeto por parámetro de ruta, viaja
   * por el buzón del servicio de importación y el constructor lo recoge al montarse.
   */
  abrirImportado(f: ImportedForm): void {
    this.importSvc.dejarPendiente(f);
    this.importarAbierto.set(false);
    void this.router.navigate([`${this.base}/builder`]);
  }

  /** La carga masiva ya creó formularios: el listado tiene que reflejarlos. */
  trasCrearMasivo(cuantos: number): void {
    this.snack.open(
      cuantos === 1 ? 'Se creó 1 formulario desde el archivo.' : `Se crearon ${cuantos} formularios desde el archivo.`,
      'OK', { duration: 5000 });
    this.cargar();
  }

  // ── Utilidades ──────────────────────────────────────────────────────

  /** Extrae el `detail` del ProblemDetail RFC 7807 del backend; si no, el texto por defecto. */
  private mensajeError(err: unknown, porDefecto: string): string {
    if (err instanceof HttpErrorResponse) {
      const p = err.error as ApiProblem | null;
      if (p && typeof p === 'object' && typeof p.detail === 'string' && p.detail) return p.detail;
    }
    return porDefecto;
  }
}
