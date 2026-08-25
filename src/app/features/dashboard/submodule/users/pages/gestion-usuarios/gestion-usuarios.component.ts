import { Component, computed, inject, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { StandardFilterTable } from '@/app/shared/components/standard-filter-table/standard-filter-table';
import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';
import { AdminService, UsuarioDetail } from '../../services/admin.service';
import { UserUpsertDialogComponent } from '../../components/user-upsert-dialog/user-upsert-dialog.component';
import { firstValueFrom } from 'rxjs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import Swal from 'sweetalert2';
import { UserPermissionsDialogComponent } from '../../components/user-permissions-dialog/user-permissions-dialog.component';
import { ColumnDefinition } from '@/app/shared/models/advanced-table-interface';
import { ColumnCellTemplateDirective } from '@/app/shared/directives/column-cell-template.directive';
import { UserAvatarComponent } from '../../components/user-avatar/user-avatar.component';

@Component({
  selector: 'app-gestion-usuarios',
  standalone: true,
  imports: [
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatDialogModule,
    StandardFilterTable,
    MatProgressSpinnerModule,
    ColumnCellTemplateDirective,
    UserAvatarComponent,
  ],
  templateUrl: './gestion-usuarios.component.html',
  styleUrl: './gestion-usuarios.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GestionUsuariosComponent implements OnInit {
  // --- INYECCIÓN DE DEPENDENCIAS ---
  private readonly adminService = inject(AdminService);
  private readonly utilityService = inject(UtilityServiceService);
  private readonly dialog = inject(MatDialog);

  // --- ESTADO REACTIVO CON SIGNALS ---
  private users = signal<UsuarioDetail[]>([]);

  /** Hay una carga en curso (inicial o recarga tras crear/editar/eliminar). */
  public readonly loading = signal(true);

  /** La última carga falló: distingue "sin usuarios" de "no se pudo cargar". */
  public readonly loadError = signal(false);

  /** Signal computada que transforma los datos para la tabla */
  public readonly rows = computed(() => {
    return this.users().map(u => ({
      id: u.id,
      tiene_foto: !!u.tiene_foto,
      iniciales: this.inicialesDe(u),
      estado: !!u.estado_solicitudes,
      correo: u.correo_electronico ?? '—',
      // Una cédula puede tener varios correos de login (usuario_credencial):
      // se listan aquí para no aparentar que cada correo es otra persona.
      correos_adicionales: (u.correos_adicionales ?? [])
        .filter(c => c.activo)
        .map(c => c.correo)
        .join(', ') || '—',
      tipo_documento: u.tipo_documento ?? '—',
      cedula: u.numero_de_documento ?? '—',
      nombres: u.datos_basicos?.nombres || '—',
      apellidos: u.datos_basicos?.apellidos || '—',
      celular: u.datos_basicos?.celular || '—',
      empresa: u.empresa?.nombre ?? '—',
      // Multi-sede / multi-rol (V40): se listan todas; los roles vencidos se marcan.
      sede: u.sedes?.length
        ? u.sedes.map(s => s.nombre).join(', ')
        : (u.sede?.nombre ?? '—'),
      rol: u.roles?.length
        ? u.roles.map(r => (r.vigente === false ? `${r.nombre} (vencido)` : r.nombre)).join(', ')
        : (u.rol?.nombre ?? '—'),
      fecha_registro: this.formatFecha(u.fecha_registro),
    }));
  });

  /**
   * `fecha_registro` llega como ISO-8601 (el backend corre con
   * spring.jackson.serialization.write-dates-as-timestamps=false). La versión previa hacía
   * `Number(iso) * 1000`, que da NaN y pintaba "Invalid Date" en toda la columna. Se aceptan
   * también los dos formatos epoch por si algún endpoint legacy los devuelve.
   */
  private formatFecha(valor: unknown): string {
    if (valor === null || valor === undefined || valor === '') return '—';

    let fecha: Date;
    if (typeof valor === 'number' || /^\d+(\.\d+)?$/.test(String(valor))) {
      const n = Number(valor);
      fecha = new Date(n > 3e10 ? n : n * 1000); // > 3e10 ya son milisegundos
    } else {
      fecha = new Date(String(valor));
    }

    if (isNaN(fecha.getTime())) return '—';
    return fecha.toLocaleDateString('es-CO', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  /** Iniciales de respaldo cuando el usuario no tiene foto. */
  private inicialesDe(u: UsuarioDetail): string {
    const n = (u.datos_basicos?.nombres ?? '').trim();
    const a = (u.datos_basicos?.apellidos ?? '').trim();
    const ini = `${n.charAt(0)}${a.charAt(0)}`.toUpperCase();
    return ini || (u.correo_electronico ?? '?').charAt(0).toUpperCase();
  }

  // --- DEFINICIÓN DE COLUMNAS ---
  public readonly columns: ColumnDefinition[] = [
    { name: 'foto', header: 'Foto', type: 'custom', width: '72px', sortable: false, filterable: false },
    {
      name: 'estado', header: 'Estado', type: 'status', width: '110px',
      statusConfig: {
        'true': { color: '#067647', background: '#ecfdf3' },
        'false': { color: '#b42318', background: '#fef3f2' },
      }
    },
    { name: 'fecha_registro', header: 'Fecha registro', type: 'text', width: '160px' },
    { name: 'correo', header: 'Correo', type: 'text', width: '260px' },
    { name: 'correos_adicionales', header: 'Otros correos', type: 'text', width: '260px' },
    { name: 'tipo_documento', header: 'Tipo doc.', type: 'text', width: '110px' },
    { name: 'cedula', header: 'Cédula', type: 'text', width: '140px' },
    { name: 'nombres', header: 'Nombres', type: 'text' },
    { name: 'apellidos', header: 'Apellidos', type: 'text' },
    { name: 'celular', header: 'Celular', type: 'text', width: '140px' },
    { name: 'empresa', header: 'Empresa', type: 'text', width: '160px' },
    { name: 'sede', header: 'Sede', type: 'text', width: '140px' },
    { name: 'rol', header: 'Rol', type: 'text', width: '150px' },
    { name: 'actions', header: 'Acciones', type: 'custom', width: '184px', stickyEnd: true, sortable: false, filterable: false },
  ];

  ngOnInit(): void {
    this.reloadUsers(true); // Initial load
  }

  /**
   * Carga/recarga usuarios.
   * @param isInitial Carga de arranque: muestra el spinner de bloque completo.
   *                  En las recargas la tabla permanece montada con su overlay.
   */
  async reloadUsers(isInitial = false): Promise<void> {
    this.loading.set(true);

    try {
      const usersData = await firstValueFrom(this.utilityService.getAllUsers());
      this.users.set(usersData ?? []);
      this.loadError.set(false);
    } catch (err) {
      console.error(err);
      this.loadError.set(true);
      // En el arranque no hay nada que conservar; en una recarga se mantiene la
      // lista anterior en pantalla en vez de vaciar la tabla por un fallo de red.
      if (isInitial) this.users.set([]);
      // Con datos en pantalla el estado de error no llega a verse: avisar con toast.
      if (this.users().length > 0) {
        this.showErrorToast('No se pudieron recargar los usuarios.');
      }
    } finally {
      this.loading.set(false);
    }
  }

  /** Abre el diálogo de creación */
  async openCreateDialog(): Promise<void> {
    const dialogRef = this.dialog.open(UserUpsertDialogComponent, {
      minWidth: '60vw',
      maxWidth: '96vw',
      height: '90vh',
      data: { mode: 'create' },
      disableClose: true,
      panelClass: 'dialog-responsive'
    });

    const result = await firstValueFrom(dialogRef.afterClosed());
    if (result?.ok) {
      this.showSuccessToast('Usuario creado correctamente');
      this.reloadUsers();
    }
  }

  /** Abre el diálogo de edición */
  async openEditDialog(row: { id: string }): Promise<void> {
    const user = this.users().find(u => u.id === row.id);
    if (!user) return;

    const dialogRef = this.dialog.open(UserUpsertDialogComponent, {
      minWidth: '60vw',
      maxWidth: '96vw',
      height: '90vh',
      data: { mode: 'edit', user },
      disableClose: true,
      panelClass: 'dialog-responsive'
    });

    const result = await firstValueFrom(dialogRef.afterClosed());
    if (result?.ok) {
      this.showSuccessToast('Usuario actualizado correctamente');
      this.reloadUsers();
    }
  }

  /**
   * Activa / inactiva un usuario (baja reversible).
   * Conserva la fila y todo su historial: es lo que hay que usar cuando alguien deja de
   * trabajar pero sus registros deben seguir existiendo. Para borrar de verdad, deleteUser.
   */
  async toggleActivo(row: { id: string; estado: boolean }): Promise<void> {
    const user = this.users().find(u => u.id === row.id);
    if (!user) return;

    const activar = !user.estado_solicitudes;
    const nombre = user.correo_electronico ?? 'este usuario';

    const result = await Swal.fire({
      title: activar ? '¿Activar usuario?' : '¿Inactivar usuario?',
      html: activar
        ? `<b>${nombre}</b> volverá a poder iniciar sesión.`
        : `<b>${nombre}</b> no podrá iniciar sesión. Sus datos y su historial se conservan y puede reactivarlo cuando quiera.`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: activar ? '#067647' : '#b54708',
      cancelButtonColor: '#64748b',
      confirmButtonText: activar ? 'Sí, activar' : 'Sí, inactivar',
      cancelButtonText: 'Cancelar',
      reverseButtons: true
    });
    if (!result.isConfirmed) return;

    try {
      await firstValueFrom(this.adminService.setActivo(row.id, activar));
      this.showSuccessToast(activar ? 'Usuario activado' : 'Usuario inactivado');
      this.reloadUsers();
    } catch (err) {
      this.showErrorToast(this.mensajeDeError(err, 'No se pudo cambiar el estado del usuario.'));
    }
  }

  /**
   * Borrado DEFINITIVO, con confirmación escrita.
   * Antes el backend resolvía este DELETE como un simple "inactivar", así que la fila volvía
   * a aparecer al recargar y el botón parecía no hacer nada. Ahora borra de verdad, por eso
   * se pide escribir ELIMINAR y se ofrece "Inactivar" como alternativa no destructiva.
   */
  async deleteUser(row: { id: string }): Promise<void> {
    const user = this.users().find(u => u.id === row.id);
    const nombre = user?.correo_electronico ?? 'este usuario';

    const result = await Swal.fire({
      title: '¿Eliminar definitivamente?',
      html:
        `Se eliminará <b>${nombre}</b> junto con sus permisos, datos básicos y configuración de MFA.<br><br>` +
        `<b>Esta acción no se puede deshacer.</b> Si solo quiere impedirle el acceso, cancele y use <b>Inactivar</b>.<br><br>` +
        `Escriba <b>ELIMINAR</b> para confirmar:`,
      input: 'text',
      inputPlaceholder: 'ELIMINAR',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#b42318',
      cancelButtonColor: '#64748b',
      confirmButtonText: 'Eliminar definitivamente',
      cancelButtonText: 'Cancelar',
      reverseButtons: true,
      focusCancel: true,
      inputValidator: (value) =>
        (value ?? '').trim().toUpperCase() === 'ELIMINAR' ? null : 'Escriba ELIMINAR para confirmar'
    });

    if (result.isConfirmed) {
      Swal.fire({
        title: 'Eliminando...',
        text: 'Por favor espere',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading(),
        timerProgressBar: true
      });

      try {
        await firstValueFrom(this.adminService.eliminar(row.id));
        Swal.close(); // Close loading
        this.showSuccessToast('Usuario eliminado');
        this.reloadUsers();
      } catch (err) {
        // El backend bloquea borrarse a uno mismo y borrar al último ADMIN activo:
        // ese motivo hay que mostrarlo tal cual, no como un error genérico.
        Swal.fire('No se pudo eliminar', this.mensajeDeError(err, 'No se pudo eliminar el usuario.'), 'error');
      }
    }
  }

  /** Extrae el motivo que manda el backend (`{ok:false, message}`) o cae a uno genérico. */
  private mensajeDeError(err: any, fallback: string): string {
    return err?.error?.message ?? fallback;
  }

  openPermsDialog(row: { id: string }): void {
    const userfull = this.users().find(u => u.id === row.id);
    if (!userfull) {
      this.showErrorToast('No se encontró información detallada del usuario');
      return;
    }

    this.dialog.open(UserPermissionsDialogComponent, {
      width: 'min(920px, 96vw)',
      maxWidth: '96vw',
      maxHeight: '90vh',
      data: { userfull },
      disableClose: false,
      panelClass: 'dialog-responsive'
    });
  }

  // --- Helpers UI ---
  private showSuccessToast(title: string) {
    Swal.fire({
      icon: 'success',
      title: title,
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 3000,
      timerProgressBar: true
    });
  }

  private showErrorToast(msg: string) {
    Swal.fire({
      icon: 'error',
      title: 'Error',
      text: msg,
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 4000
    });
  }
}