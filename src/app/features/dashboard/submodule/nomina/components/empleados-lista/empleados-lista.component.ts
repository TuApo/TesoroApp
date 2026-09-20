import {
  Component, ChangeDetectionStrategy, OnInit, signal, computed, inject, viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';

import {
  ColumnaTabla, TABLA_ESTANDAR, TablaEstandarComponent, TonoBadge,
} from '../../../../../../shared/components/tabla-estandar';
import {
  NominaService, Empleado, EmpleadosQuery, Client, CostCenter,
} from '../../service/nomina/nomina.service';
import { EmpleadoEditorDialogComponent } from '../empleado-editor-dialog/empleado-editor-dialog.component';

/** Tono del chip de estado del contrato activo (sin contrato → neutro). */
const TONO_ESTADO: Record<string, TonoBadge> = {
  ACTIVO: 'ok', INACTIVO: 'warn', RETIRADO: 'danger', FINALIZADO: 'violet',
};

@Component({
  selector: 'app-empleados-lista',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule,
    MatIconModule, MatButtonModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatDialogModule, MatTooltipModule,
    ...TABLA_ESTANDAR,
  ],
  templateUrl: './empleados-lista.component.html',
  styleUrl: './empleados-lista.component.css',
})
export class EmpleadosListaComponent implements OnInit {
  private svc = inject(NominaService);
  private dialog = inject(MatDialog);

  empleados = signal<Empleado[]>([]);
  loading = signal(false);
  total = signal(0);
  pageIndex = signal(0);
  pageSize = signal(50);

  // Filtros (signals para CD en modo zoneless)
  q = signal('');
  clienteId = signal<number | null>(null);
  cecoId = signal<number | null>(null);
  estado = signal<string>('ACTIVO');

  clientes = signal<Client[]>([]);
  cecos = signal<CostCenter[]>([]);

  /**
   * Columnas de la tabla estándar (modo servidor: el backend pagina y busca;
   * por eso no son ordenables, el endpoint no recibe orden).
   */
  readonly columnas: ColumnaTabla<Empleado>[] = [
    { id: 'documento', header: 'Documento', ordenable: false, tarjeta: 'subtitulo',
      valor: (e) => `${this.tipoDoc(e)} ${e.numero_documento ?? ''}`.trim() },
    { id: 'nombre', header: 'Nombre', ordenable: false, tarjeta: 'titulo', minAncho: '180px',
      valor: (e) => e.nombre_completo ?? '', formato: (e) => e.nombre_completo || '—' },
    { id: 'cliente', header: 'Cliente', ordenable: false, tarjeta: 'cuerpo',
      valor: (e) => e.contrato_activo?.cliente_nombre ?? '',
      formato: (e) => e.contrato_activo?.cliente_nombre || '—' },
    { id: 'ceco', header: 'CECO', ordenable: false, prioridad: 2, tarjeta: 'cuerpo',
      valor: (e) => e.contrato_activo?.centro_de_costo ?? '',
      formato: (e) => e.contrato_activo?.centro_de_costo || '—' },
    { id: 'salario', header: 'Salario', ordenable: false, prioridad: 2, align: 'right', tarjeta: 'meta',
      valor: (e) => {
        const v = e.contrato_activo?.salario_basico;
        return v == null ? null : Number(v);
      },
      formato: (e) => this.fmtSalario(e.contrato_activo?.salario_basico) },
    { id: 'fecha_ingreso', header: 'Ingreso', ordenable: false, prioridad: 3, tarjeta: 'meta',
      valor: (e) => (e.contrato_activo?.fecha_ingreso ? this.fmtFecha(e.contrato_activo.fecha_ingreso) : ''),
      formato: (e) => this.fmtFecha(e.contrato_activo?.fecha_ingreso) },
    { id: 'estado', header: 'Estado', ordenable: false, tarjeta: 'badge',
      valor: (e) => e.contrato_activo?.estado || 'SIN CONTRATO',
      badge: (e) => ({
        texto: e.contrato_activo?.estado || 'SIN CONTRATO',
        tono: TONO_ESTADO[e.contrato_activo?.estado ?? ''] ?? 'neutro',
      }) },
  ];

  readonly idEmpleado = (e: Empleado, i: number) => e.id_persona ?? `i${i}`;

  /** La tabla guarda su página: al cambiar un filtro de negocio se vuelve a la 1. */
  private readonly tabla = viewChild(TablaEstandarComponent);

  ngOnInit(): void {
    this.svc.getClientesActivos().subscribe({
      next: (cs) => this.clientes.set(cs),
      error: () => this.clientes.set([]),
    });
    this.fetch();
  }

  onClienteChange(id: number | null): void {
    this.clienteId.set(id);
    this.cecoId.set(null);
    this.cecos.set([]);
    if (id) {
      this.svc.getCentrosCostos(id).subscribe({
        next: (cs) => this.cecos.set(cs),
        error: () => this.cecos.set([]),
      });
    }
    this.irAPrimeraPagina();
    this.fetch();
  }

  onEstadoChange(value: string): void {
    this.estado.set(value);
    this.irAPrimeraPagina();
    this.fetch();
  }

  onCecoChange(id: number | null): void {
    this.cecoId.set(id);
    this.irAPrimeraPagina();
    this.fetch();
  }

  /** Búsqueda libre de la tabla estándar (ya llega con debounce): va al backend desde la página 1. */
  onBuscar(texto: string): void {
    this.q.set(texto);
    this.pageIndex.set(0); // la tabla ya volvió a su página 1
    this.fetch();
  }

  onPage(e: { pagina: number; porPagina: number }): void {
    this.pageIndex.set(e.pagina);
    this.pageSize.set(e.porPagina);
    this.fetch();
  }

  /** Limpia los filtros de negocio. La búsqueda libre la limpia la propia tabla. */
  limpiarFiltros(): void {
    this.clienteId.set(null);
    this.cecoId.set(null);
    this.estado.set('ACTIVO');
    this.cecos.set([]);
    this.irAPrimeraPagina();
    this.fetch();
  }

  private irAPrimeraPagina(): void {
    this.pageIndex.set(0);
    this.tabla()?.pagina.set(0);
  }

  private fetch(): void {
    this.loading.set(true);
    const query: EmpleadosQuery = {
      q: this.q(),
      cliente_id: this.clienteId(),
      ceco_id: this.cecoId(),
      estado: this.estado(),
      solo_con_contrato: 1,
      page: this.pageIndex() + 1,
      page_size: this.pageSize(),
    };
    this.svc.getEmpleados(query).subscribe({
      next: (resp) => {
        this.empleados.set(resp.results || []);
        this.total.set(resp.count || 0);
        this.loading.set(false);
      },
      error: () => {
        this.empleados.set([]);
        this.total.set(0);
        this.loading.set(false);
      },
    });
  }

  abrirEditor(emp?: Empleado): void {
    const ref = this.dialog.open(EmpleadoEditorDialogComponent, {
      width: '95vw', maxWidth: '1100px', height: '90vh',
      disableClose: true,
      data: { id_persona: emp?.id_persona ?? null },
    });
    ref.afterClosed().subscribe((result) => {
      if (result?.changed) this.fetch();
    });
  }

  eliminar(emp: Empleado, ev: MouseEvent): void {
    ev.stopPropagation();
    if (!emp.id_persona) return;
    const nombre = emp.nombre_completo || emp.numero_documento;
    if (!confirm(`¿Retirar a ${nombre}? Sus contratos activos quedarán RETIRADOS con fecha de hoy.`)) return;

    this.svc.eliminarEmpleado(emp.id_persona).subscribe({
      next: () => this.fetch(),
      error: (err: HttpErrorResponse) => alert(err.error?.error || 'No se pudo retirar el empleado.'),
    });
  }

  fmtSalario = (v: any) => v == null ? '—'
    : new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(v));

  fmtFecha = (v: string | null | undefined) => v ? v.split('T')[0] : '—';

  /** Regla: si el número de documento empieza con 'X', el tipo siempre es PPT.
   *  Se aplica aquí como último cinturón de seguridad para datos legacy que
   *  aún no pasaron por el serializer actualizado. */
  tipoDoc(e: Empleado): string {
    const nd = (e.numero_documento || '').trim().toUpperCase();
    if (nd.startsWith('X')) return 'PPT';
    return e.tipo_documento || '';
  }
}
