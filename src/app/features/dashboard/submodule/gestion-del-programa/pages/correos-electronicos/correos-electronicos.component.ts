import { ChangeDetectorRef, Component, OnInit, OnDestroy, AfterViewInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatCardModule } from '@angular/material/card';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatSortModule, MatSort } from '@angular/material/sort';
import { MatPaginatorModule, MatPaginator } from '@angular/material/paginator';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import Swal from 'sweetalert2';

import { CorreosService } from '../../services/correos.service';
import { CorreoFormDialogComponent } from './correo-form-dialog.component';
import {
  CorreoCuenta,
  CuotaResumen,
  ESTADO_VERIFICACION_META,
  EstadoVerificacionCorreo,
  PROVEEDORES_CORREO,
  ProveedorCorreo,
  UMBRAL_CORTE_PCT,
} from '../../models/correo-cuenta.model';

type FiltroEstado = 'activas' | 'inactivas' | 'todas';

/**
 * Administración → Gestión del Programa → Correos electrónicos.
 *
 * Mantenimiento de las CUENTAS REMITENTES que usará la plataforma para enviar
 * correo (no es un directorio de destinatarios). Cada cuenta aporta una cuota
 * diaria al pool; solo suman las cuentas activas y verificadas.
 *
 * Mismo patrón que Entidades Externas / Centros de Costo: filtros de servidor
 * (proveedor, estado activo, estado de verificación), buscador libre en cliente,
 * paginación con MatPaginator, confirmaciones con Swal y borrado lógico
 * (desactivar/reactivar). NO existe acción de eliminar.
 */
@Component({
  selector: 'app-correos-electronicos',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatTableModule,
    MatSortModule,
    MatPaginatorModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatDialogModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './correos-electronicos.component.html',
  styleUrls: ['./correos-electronicos.component.css'],
})
export class CorreosElectronicosComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  /**
   * OJO: cada id de aquí DEBE tener su `matColumnDef` en el HTML. Si falta uno,
   * MatTable lanza y no pinta NINGUNA fila (la tabla se ve vacía con el contador
   * en 4). Lo cubre la prueba de render de la spec.
   *
   * La cuota declarada no tiene columna propia: lo que importa operativamente es
   * el restante ('disponible_hoy'); el declarado vive en el indicador de arriba
   * y en el tooltip de 'limite_efectivo'.
   */
  displayedColumns = [
    'direccion', 'nombre_mostrar', 'proveedor', 'proposito',
    'enviados_hoy', 'disponible_hoy', 'limite_efectivo', 'estado_verificacion', 'activo',
    'actualizado_en', 'acciones',
  ];
  dataSource = new MatTableDataSource<CorreoCuenta>([]);

  readonly PROVEEDORES = PROVEEDORES_CORREO;
  readonly PROVEEDOR_LABEL: Record<string, string> =
    Object.fromEntries(PROVEEDORES_CORREO.map((p) => [p.value, p.label]));
  readonly ESTADOS: EstadoVerificacionCorreo[] = [
    'PENDIENTE', 'VERIFICADA', 'ERROR_AUTENTICACION',
    'ERROR_CONEXION', 'ERROR_CONFIGURACION', 'DESHABILITADA',
  ];

  isLoading = false;
  cargaFallida = false;
  verificandoId: string | null = null;
  enviandoId: string | null = null;

  // ── Auto-refresco ────────────────────────────────────────────────────────
  /** Cada cuántos ms se vuelve a consultar el backend. */
  static readonly REFRESCO_MS = 20_000;
  autoRefresco = true;
  /** Momento del último refresco exitoso; alimenta el "actualizado hace…". */
  ultimoRefresco: Date | null = null;
  segundosDesdeRefresco = 0;
  private timerRefresco: ReturnType<typeof setInterval> | null = null;
  private timerReloj: ReturnType<typeof setInterval> | null = null;
  /** Bloquea el refresco mientras hay un diálogo abierto o una acción en curso. */
  private ocupado = false;

  resumen: CuotaResumen | null = null;

  /** Umbral de corte vigente; lo manda el backend en el resumen. */
  get umbralCorte(): number {
    return this.resumen?.umbral_corte_pct ?? UMBRAL_CORTE_PCT;
  }

  filterSearch = '';
  filterProveedor: ProveedorCorreo | '' = '';
  filterEstado: FiltroEstado = 'activas';
  filterVerificacion: EstadoVerificacionCorreo | '' = '';

  private all: CorreoCuenta[] = [];

  constructor(
    private correos: CorreosService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.cargar();
    this.iniciarAutoRefresco();
  }

  ngOnDestroy(): void {
    this.detenerAutoRefresco();
    if (this.timerReloj) clearInterval(this.timerReloj);
  }

  ngAfterViewInit(): void {
    this.dataSource.sort = this.sort;
    this.dataSource.paginator = this.paginator;
  }

  // ── Auto-refresco ────────────────────────────────────────────────────────

  /**
   * Refresco periódico en segundo plano: la pantalla se mantiene al día sin que
   * el operador toque nada (útil cuando otro usuario verifica o desactiva una
   * cuenta). Se salta el ciclo si hay un diálogo abierto, una verificación en
   * curso o una carga en vuelo, para no pisar lo que el usuario está haciendo.
   */
  private iniciarAutoRefresco(): void {
    if (this.timerRefresco) return;
    this.timerRefresco = setInterval(() => {
      if (!this.autoRefresco || this.ocupado || this.isLoading || this.verificandoId || this.enviandoId) return;
      this.cargar(true);
    }, CorreosElectronicosComponent.REFRESCO_MS);

    // Reloj independiente para el "actualizado hace X" (no pega al backend).
    this.timerReloj = setInterval(() => {
      if (!this.ultimoRefresco) return;
      this.segundosDesdeRefresco = Math.floor((Date.now() - this.ultimoRefresco.getTime()) / 1000);
      this.cdr.markForCheck();
    }, 1000);
  }

  private detenerAutoRefresco(): void {
    if (this.timerRefresco) {
      clearInterval(this.timerRefresco);
      this.timerRefresco = null;
    }
  }

  toggleAutoRefresco(): void {
    this.autoRefresco = !this.autoRefresco;
    if (this.autoRefresco) this.cargar(true);
  }

  /** Texto del indicador de frescura. */
  get textoFrescura(): string {
    if (!this.ultimoRefresco) return 'sin datos';
    const s = this.segundosDesdeRefresco;
    if (s < 5) return 'actualizado ahora';
    if (s < 60) return `actualizado hace ${s} s`;
    const m = Math.floor(s / 60);
    return `actualizado hace ${m} min`;
  }

  // ── Carga ────────────────────────────────────────────────────────────────

  private estadoParam(): boolean | null {
    if (this.filterEstado === 'activas') return true;
    if (this.filterEstado === 'inactivas') return false;
    return null;
  }

  /**
   * @param silencioso true = refresco de fondo: no muestra spinner ni molesta
   *                   con snackbars, y ante un error deja los datos anteriores
   *                   en pantalla en vez de vaciar la tabla.
   */
  cargar(silencioso = false): void {
    if (!silencioso) {
      this.isLoading = true;
      this.cargaFallida = false;
    }
    this.cdr.markForCheck();

    this.correos.listar({
      proveedor: this.filterProveedor || null,
      activo: this.estadoParam(),
      estadoVerificacion: this.filterVerificacion || null,
    }).subscribe({
      next: (data) => {
        this.all = data ?? [];
        this.aplicarFiltros();
        this.isLoading = false;
        this.cargaFallida = false;
        this.marcarRefresco();
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isLoading = false;
        if (silencioso) {
          // Un fallo de fondo no debe borrar lo que el operador está viendo.
          this.cdr.markForCheck();
          return;
        }
        this.all = [];
        this.dataSource.data = [];
        this.cargaFallida = true;
        this.snackBar.open(
          err?.error?.error ?? 'Error al cargar las cuentas de correo', 'Cerrar', { duration: 4000 },
        );
        this.cdr.markForCheck();
      },
    });

    this.cargarResumen(silencioso);
  }

  private marcarRefresco(): void {
    this.ultimoRefresco = new Date();
    this.segundosDesdeRefresco = 0;
  }

  /** Los indicadores se recalculan en el backend tras cada operación. */
  cargarResumen(silencioso = false): void {
    this.correos.resumenCuota().subscribe({
      next: (r) => { this.resumen = r; this.cdr.markForCheck(); },
      error: () => {
        // En refresco de fondo se conserva el último resumen bueno.
        if (!silencioso) this.resumen = null;
        this.cdr.markForCheck();
      },
    });
  }

  // ── Filtros ──────────────────────────────────────────────────────────────

  aplicarFiltros(): void {
    const q = (this.filterSearch || '').trim().toLowerCase();
    this.dataSource.data = this.all.filter((c) => {
      if (!q) return true;
      const blob = [c.direccion, c.nombre_mostrar, c.proposito, c.smtp_host, c.smtp_usuario]
        .filter(Boolean).join(' ').toLowerCase();
      return blob.includes(q);
    });
    if (this.paginator) this.paginator.firstPage();
    this.cdr.markForCheck();
  }

  onSearchChange(value: string): void {
    this.filterSearch = value;
    this.aplicarFiltros();
  }

  /** Proveedor, estado y verificación se filtran en el backend → recargar. */
  onServerFilterChange(): void {
    this.cargar();
  }

  limpiarFiltros(): void {
    this.filterSearch = '';
    this.filterProveedor = '';
    this.filterEstado = 'activas';
    this.filterVerificacion = '';
    this.cargar();
  }

  // ── Presentación ─────────────────────────────────────────────────────────

  proveedorLabel(p: string): string {
    return this.PROVEEDOR_LABEL[p] ?? p;
  }

  /** % del cupo del día ya consumido, para la barrita de la columna Disponible. */
  porcentajeUso(c: CorreoCuenta): number {
    if (!c.limite_efectivo) return 0;
    return Math.min(100, Math.round((c.enviados_hoy / c.limite_efectivo) * 100));
  }

  estadoMeta(e: EstadoVerificacionCorreo) {
    return ESTADO_VERIFICACION_META[e] ?? { label: e, icon: 'help', clase: 'estado-pendiente' };
  }

  // ── Acciones ─────────────────────────────────────────────────────────────

  abrirDialogoCrear(): void {
    this.ocupado = true;
    const ref = this.dialog.open(CorreoFormDialogComponent, {
      width: '720px',
      data: { cuenta: null, umbralCortePct: this.umbralCorte },
    });
    ref.afterClosed().subscribe((ok) => {
      this.ocupado = false;
      if (ok) this.cargar();
    });
  }

  abrirDialogoEditar(cuenta: CorreoCuenta): void {
    this.ocupado = true;
    const ref = this.dialog.open(CorreoFormDialogComponent, {
      width: '720px',
      data: { cuenta, umbralCortePct: this.umbralCorte },
    });
    ref.afterClosed().subscribe((ok) => {
      this.ocupado = false;
      if (ok) this.cargar();
    });
  }

  async desactivar(cuenta: CorreoCuenta): Promise<void> {
    this.ocupado = true;
    const res = await Swal.fire({
      title: `Desactivar “${cuenta.direccion}”`,
      html: 'La cuenta no será eliminada: queda inactiva, deja de aportar cuota y no ' +
        'se usará para nuevos envíos. Se conserva su último resultado de verificación.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, desactivar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#d33',
      reverseButtons: true,
    });
    this.ocupado = false;
    if (!res.isConfirmed) return;

    this.correos.desactivar(cuenta.id).subscribe({
      next: () => {
        this.snackBar.open('Cuenta desactivada correctamente.', 'Cerrar', { duration: 2500 });
        this.cargar();
      },
      error: (err) => {
        this.snackBar.open(err?.error?.error ?? 'No se pudo desactivar', 'Cerrar', { duration: 3500 });
      },
    });
  }

  async reactivar(cuenta: CorreoCuenta): Promise<void> {
    this.ocupado = true;
    const res = await Swal.fire({
      title: `Reactivar “${cuenta.direccion}”`,
      html: 'La cuenta vuelve a estar disponible. Recuperará su estado de verificación ' +
        'anterior: si quedó pendiente, deberás verificarla para que aporte cuota.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, reactivar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#3f51b5',
      reverseButtons: true,
    });
    this.ocupado = false;
    if (!res.isConfirmed) return;

    this.correos.reactivar(cuenta.id).subscribe({
      next: () => {
        this.snackBar.open('Cuenta reactivada correctamente.', 'Cerrar', { duration: 2500 });
        this.cargar();
      },
      error: (err) => {
        this.snackBar.open(err?.error?.error ?? 'No se pudo reactivar', 'Cerrar', { duration: 3500 });
      },
    });
  }

  /**
   * Envía un correo REAL por esta cuenta. Consume cuota y queda en el ledger,
   * así que se pide confirmación y el destinatario antes de disparar nada.
   */
  async enviarPrueba(cuenta: CorreoCuenta): Promise<void> {
    this.ocupado = true;
    const res = await Swal.fire({
      title: 'Enviar correo de prueba',
      html: `Se enviará un correo <b>real</b> desde <b>${cuenta.direccion}</b> y consumirá ` +
        `1 de su cupo (le quedan ${cuenta.disponible_hoy}).`,
      input: 'email',
      inputLabel: 'Destinatario',
      inputPlaceholder: 'alguien@dominio.com',
      showCancelButton: true,
      confirmButtonText: 'Enviar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#3f51b5',
      reverseButtons: true,
      inputValidator: (v) => (!v ? 'Escribe un destinatario' : null),
    });
    this.ocupado = false;
    if (!res.isConfirmed || !res.value) return;

    this.enviandoId = cuenta.id;
    this.cdr.markForCheck();

    this.correos.enviar({
      cuenta_id: cuenta.id,
      destinatario: res.value,
      asunto: 'Correo de prueba — plataforma TuApo',
      cuerpo_html: '<p>Este es un correo de prueba enviado desde el submódulo '
        + 'Correos electrónicos para validar la entrega real.</p>',
      origen: 'prueba',
    }).subscribe({
      next: (r) => {
        this.enviandoId = null;
        this.snackBar.open(
          `Enviado desde ${r.remitente}. Le quedan ${r.disponible_hoy} hoy.`,
          'Cerrar', { duration: 4000 },
        );
        this.cargar();
      },
      error: (err) => {
        this.enviandoId = null;
        this.snackBar.open(
          err?.error?.error ?? 'No fue posible enviar el correo', 'Cerrar', { duration: 5000 },
        );
        this.cdr.markForCheck();
      },
    });
  }

  /**
   * Prueba conexión + autenticación SMTP. El backend responde 200 aunque la
   * prueba falle (con el motivo saneado); los errores de pre-vuelo llegan como
   * 409/422 con `{ error }`.
   */
  verificar(cuenta: CorreoCuenta): void {
    this.verificandoId = cuenta.id;
    this.cdr.markForCheck();

    this.correos.verificar(cuenta.id).subscribe({
      next: (r) => {
        this.verificandoId = null;
        if (r.verificada) {
          this.snackBar.open('Cuenta verificada correctamente.', 'Cerrar', { duration: 3000 });
        } else {
          Swal.fire({
            title: 'No fue posible verificar la cuenta',
            text: this.estadoMeta(r.estado_verificacion).label,
            icon: 'error',
            confirmButtonText: 'Entendido',
            confirmButtonColor: '#3f51b5',
          });
        }
        this.cargar();
      },
      error: (err) => {
        this.verificandoId = null;
        this.snackBar.open(
          err?.error?.error ?? 'No fue posible verificar la cuenta', 'Cerrar', { duration: 4500 },
        );
        this.cdr.markForCheck();
      },
    });
  }
}
