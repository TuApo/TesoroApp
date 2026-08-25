import { StandardFilterTable } from '@/app/shared/components/standard-filter-table/standard-filter-table';
import { Component, computed, inject, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { GestionRolesSService, Rol } from '../../services/gestion-roles/gestion-roles-s.service';
import { MatDialog } from '@angular/material/dialog';
import { ColumnConfig, ColumnDefinition } from '../../../../../../shared/models/advanced-table-interface';
import { MatCardModule } from '@angular/material/card';
import Swal from 'sweetalert2';
import { finalize } from 'rxjs/operators';
import { RolPermissionsDialogComponent } from '../../components/rol-permissions-dialog/rol-permissions-dialog.component';
import { RolUpsertDialogComponent } from '../../components/rol-upsert-dialog/rol-upsert-dialog.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-gestion-roles',
  imports: [
    StandardFilterTable,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    MatCardModule
  ],
  templateUrl: './gestion-roles.component.html',
  styleUrl: './gestion-roles.component.css'
})
export class GestionRolesComponent implements OnInit {
  private rolesSvc = inject(GestionRolesSService);
  private dialog = inject(MatDialog);

  loading = signal(true);
  roles = signal<Rol[]>([]);

  /** La última carga falló: distingue "sin roles" de "no se pudo cargar". */
  loadError = signal(false);

  /** Definición tipo ColumnConfig (tu modelo) */
  columnsCfg: ColumnConfig[] = [
    { columnDef: 'nombre', header: 'Nombre', type: 'text' },
    { columnDef: 'actions', header: 'Acciones', type: 'actions', align: 'end', editable: false, width: '150px' },
  ];

  /** Mapeo al ColumnDefinition que consume la tabla */
  columns = computed<ColumnDefinition[]>(() =>
    this.columnsCfg.map((c): ColumnDefinition => ({
      name: c.columnDef,
      header: c.header,
      // La tabla entiende: 'text' | 'number' | 'date' | 'select' | 'status' | 'custom'
      type: c.type === 'actions' ? 'custom' : (c.type as any),
      width: c.width,
      align: (c.align === 'start' ? 'left' : c.align === 'end' ? 'right' : 'center'),
      filterable: c.type !== 'actions',
      // Ordenar por la columna de acciones no significa nada
      sortable: c.type !== 'actions',
      options: c.options?.map(o => o.value),
    }))
  );

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.loading.set(true);
    this.rolesSvc.list().subscribe({
      next: (items) => {
        this.roles.set(items ?? []);
        this.loadError.set(false);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.loadError.set(true);
        // Con la tabla ya poblada el estado de error no se ve: hace falta avisar.
        if (this.roles().length > 0) {
          Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'No se pudieron recargar los roles.',
            confirmButtonText: 'Entendido',
          });
        }
      },
    });
  }

  nuevo(): void {
    const ref = this.dialog.open(RolUpsertDialogComponent, {
      width: '420px',
      data: { mode: 'create', rol: null },
      disableClose: true,
    });
    ref.afterClosed().subscribe(r => {
      if (r?.ok) {
        this.toastOk('Rol creado');
        this.refresh();
      }
    });
  }

  editar(row: Rol): void {
    const ref = this.dialog.open(RolUpsertDialogComponent, {
      width: '420px',
      data: { mode: 'edit', rol: row },
      disableClose: true,
    });
    ref.afterClosed().subscribe(r => {
      if (r?.ok) {
        this.toastOk('Rol actualizado');
        this.refresh();
      }
    });
  }

  async eliminar(row: Rol): Promise<void> {
    const { isConfirmed } = await Swal.fire({
      icon: 'warning',
      title: '¿Eliminar rol?',
      html: `Se eliminará el rol <b>${row.nombre}</b>. Esta acción no se puede deshacer.`,
      showCancelButton: true,
      confirmButtonColor: '#b42318',
      cancelButtonColor: '#64748b',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      reverseButtons: true,
      focusCancel: true,
    });

    if (!isConfirmed) return;

    // Sin await: el loader debe quedar abierto mientras corre la petición.
    Swal.fire({
      title: 'Eliminando...',
      icon: 'info',
      allowOutsideClick: false,
      allowEscapeKey: false,
      didOpen: () => Swal.showLoading(),
    });

    this.rolesSvc.delete(row.id)
      .pipe(finalize(() => Swal.close()))
      .subscribe({
        next: () => {
          this.toastOk('Rol eliminado');
          this.refresh();
        },
        error: (err) => {
          Swal.fire({
            icon: 'error',
            title: 'No se pudo eliminar el rol',
            text: err?.error?.detail ?? 'Intenta nuevamente.',
            confirmButtonText: 'Cerrar',
          });
        },
      });
  }

  permisos(row: Rol): void {
    const ref = this.dialog.open(RolPermissionsDialogComponent, {
      width: '940px',
      maxWidth: '98vw',
      height: '80vh',
      data: { rol: row },
      disableClose: true,
    });
    ref.afterClosed().subscribe(r => {
      if (r?.ok) {
        this.refresh();
      }
    });
  }

  /** Toast de éxito */
  private toastOk(title: string) {
    Swal.fire({
      icon: 'success',
      title,
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 1500,
      timerProgressBar: true,
    });
  }
}
