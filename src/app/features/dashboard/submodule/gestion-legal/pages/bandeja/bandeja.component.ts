import {
  Component, ChangeDetectionStrategy, ChangeDetectorRef, OnInit, inject, viewChild
} from '@angular/core';
import { CommonModule, formatDate } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormControl } from '@angular/forms';
import { Router } from '@angular/router';

import { MatChipsModule } from '@angular/material/chips';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';

import {
  ColumnaTabla, TABLA_ESTANDAR, TablaEstandarComponent,
} from '../../../../../../shared/components/tabla-estandar';
import { LegalService } from '../../services/legal.service';
import { ProcesoLegal, ProcesoTipo, ProcesoEstado } from '../../models/legal.models';
import { CambiarEstadoDialogComponent, CambiarEstadoResult } from './cambiar-estado-dialog.component';

/** Fecha del backend ('yyyy-MM-dd' o ISO) como Date local: un 'yyyy-MM-dd' con
 *  `new Date()` se leería en UTC y en Colombia caería el día anterior. */
function aFecha(v: string | null | undefined): Date | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/** dd/MM/yyyy como el `date` pipe de antes (locale por defecto; no lanza si la fecha es mala). */
function fechaCorta(v: string | null | undefined): string {
  const d = aFecha(v);
  return d ? formatDate(d, 'dd/MM/yyyy', 'en-US') : '—';
}

@Component({
  selector: 'app-bandeja-legal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule, ReactiveFormsModule,
    MatChipsModule, MatButtonModule,
    MatIconModule, MatSelectModule, MatFormFieldModule, MatInputModule,
    MatTooltipModule, MatSnackBarModule, MatDialogModule,
    ...TABLA_ESTANDAR,
  ],
  templateUrl: './bandeja.component.html',
  styleUrl: './bandeja.component.css'
})
export class BandejaComponent implements OnInit {
  private svc = inject(LegalService);
  private router = inject(Router);
  private snack = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private cdr = inject(ChangeDetectorRef);

  // Datos
  procesos: ProcesoLegal[] = [];
  tipos: ProcesoTipo[] = [];
  estados: ProcesoEstado[] = [];
  totalElements = 0;
  cargando = false;

  // Filtros
  filtroTipo = new FormControl<number | null>(null);
  filtroEstado = new FormControl<number | null>(null);
  filtroSemaforo = new FormControl<string>('');
  busqueda = new FormControl<string>('');

  // Paginación (en el servidor: la tabla estándar pide la página y el tamaño)
  pageIndex = 0;
  pageSize = 50;

  /** La tabla estándar recuerda su página y su búsqueda: se le reinician cuando
   *  un filtro de negocio devuelve el backend a la página 1. */
  private readonly tabla = viewChild(TablaEstandarComponent);

  // Tabla estándar (modo servidor). El backend no ordena: columnas sin orden.
  readonly columnas: ColumnaTabla<ProcesoLegal>[] = [
    { id: 'radicado', header: 'Radicado', valor: (p) => p.radicado, tarjeta: 'subtitulo', ordenable: false },
    { id: 'tipo', header: 'Tipo', valor: (p) => p.tipo_nombre, prioridad: 2, tarjeta: 'meta', ordenable: false },
    { id: 'trabajador', header: 'Trabajador', valor: (p) => p.trabajador_nombre,
      tarjeta: 'titulo', minAncho: '180px', ordenable: false },
    { id: 'cedula', header: 'Cédula', valor: (p) => p.trabajador_cedula, tarjeta: 'cuerpo', ordenable: false },
    { id: 'estado', header: 'Estado', valor: (p) => p.estado_nombre, tarjeta: 'badge', ordenable: false },
    { id: 'fechaInicio', header: 'Fecha inicio', valor: (p) => aFecha(p.fecha_inicio),
      formato: (p) => fechaCorta(p.fecha_inicio),
      prioridad: 2, tarjeta: 'meta', ordenable: false },
    { id: 'responsable', header: 'Responsable', valor: (p) => p.responsable_id ?? '',
      formato: (p) => p.responsable_id || '—', prioridad: 3, tarjeta: 'meta', ordenable: false },
  ];

  readonly idProceso = (p: ProcesoLegal) => p.id;

  ngOnInit(): void {
    this.cargarCatalogos();
    this.cargar();
  }

  cargarCatalogos(): void {
    this.svc.getTipos().subscribe({
      next: tipos => { this.tipos = tipos; this.cdr.markForCheck(); },
      error: () => {}
    });
    this.svc.getEstados().subscribe({
      next: estados => { this.estados = estados; this.cdr.markForCheck(); },
      error: () => {}
    });
  }

  cargar(): void {
    this.cargando = true;
    this.cdr.markForCheck();

    const params: any = { page: this.pageIndex, size: this.pageSize };
    const tipo = this.filtroTipo.value;
    const estado = this.filtroEstado.value;
    const q = (this.busqueda.value || '').trim();
    if (tipo != null) params.tipo = tipo;
    if (estado != null) params.estado = estado;
    if (q) params.q = q;

    this.svc.listarProcesos(params).subscribe({
      next: page => {
        let filas = page.content || [];
        const semaforo = this.filtroSemaforo.value;
        if (semaforo) filas = filas.filter(p => p.color_semaforo === semaforo);
        this.procesos = filas;
        this.totalElements = page.total_elements || filas.length;
        this.cargando = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.cargando = false;
        this.snack.open('Error al cargar procesos legales', 'Cerrar', { duration: 3000 });
        this.cdr.markForCheck();
      }
    });
  }

  aplicarFiltros(): void {
    this.pageIndex = 0;
    this.reiniciarTabla();
    if (this.filtroTipo.value != null) {
      this.svc.getEstados(this.filtroTipo.value).subscribe({
        next: e => { this.estados = e; this.cdr.markForCheck(); },
        error: () => {}
      });
    }
    this.cargar();
  }

  limpiarFiltros(): void {
    this.filtroTipo.reset();
    this.filtroEstado.reset();
    this.filtroSemaforo.reset('');
    this.busqueda.reset('');
    this.pageIndex = 0;
    this.reiniciarTabla(true);
    this.cargarCatalogos();
    this.cargar();
  }

  onPageChange(ev: { pagina: number; porPagina: number }): void {
    this.pageIndex = ev.pagina;
    this.pageSize = ev.porPagina;
    this.cargar();
  }

  /** Búsqueda de la tabla estándar: la resuelve el backend (`q`) desde la página 1. */
  buscar(q: string): void {
    this.busqueda.setValue(q, { emitEvent: false });
    this.pageIndex = 0;
    this.cargar();
  }

  private reiniciarTabla(limpiarBusqueda = false): void {
    const t = this.tabla();
    if (!t) return;
    t.pagina.set(0);
    if (limpiarBusqueda) t.q.set('');
  }

  irExpediente(proceso: ProcesoLegal): void {
    this.router.navigate(['/dashboard/gestion-legal/expediente', proceso.id]);
  }

  nuevoProceso(): void {
    this.router.navigate(['/dashboard/gestion-legal/nuevo-proceso']);
  }

  abrirCambiarEstado(proceso: ProcesoLegal, event: MouseEvent): void {
    event.stopPropagation();
    this.svc.getEstados(proceso.tipo_id).subscribe({
      next: estados => {
        const ref = this.dialog.open(CambiarEstadoDialogComponent, {
          width: '560px',
          maxWidth: '95vw',
          data: { proceso, estados }
        });
        ref.afterClosed().subscribe((result: CambiarEstadoResult | null) => {
          if (!result) return;
          this.svc.cambiarEstado(proceso.id, result).subscribe({
            next: () => {
              const docs = result.archivos || [];
              if (docs.length === 0) {
                this.snack.open('Estado actualizado correctamente', 'Cerrar', { duration: 3000 });
                this.cargar();
                return;
              }
              let pendiente = docs.length;
              let errores = 0;
              for (const d of docs) {
                const fd = new FormData();
                fd.append('file', d.file);
                fd.append('docTipoId', String(d.docTipoId));
                this.svc.subirDocumento(proceso.id, fd).subscribe({
                  next: () => {
                    pendiente--;
                    if (pendiente === 0) {
                      const msg = errores === 0
                        ? `Estado actualizado y ${docs.length} documento(s) radicado(s)`
                        : `Estado actualizado. ${errores} documento(s) fallaron`;
                      this.snack.open(msg, 'Cerrar', { duration: 4000 });
                      this.cargar();
                    }
                  },
                  error: () => {
                    errores++;
                    pendiente--;
                    if (pendiente === 0) {
                      this.snack.open(
                        `Estado actualizado. ${errores} documento(s) no se pudieron subir`,
                        'Cerrar', { duration: 4000 }
                      );
                      this.cargar();
                    }
                  }
                });
              }
            },
            error: () => this.snack.open('Error al cambiar estado', 'Cerrar', { duration: 3000 })
          });
        });
      },
      error: () => this.snack.open('Error al cargar estados', 'Cerrar', { duration: 3000 })
    });
  }

  colorSemaforoClass(color: string): string {
    const map: Record<string, string> = {
      verde: 'semaforo-verde',
      amarillo: 'semaforo-amarillo',
      rojo: 'semaforo-rojo'
    };
    return map[color] || '';
  }

  colorSemaforoLabel(color: string): string {
    const map: Record<string, string> = {
      verde: 'Al día',
      amarillo: 'Por vencer',
      rojo: 'Vencido / Urgente'
    };
    return map[color] || color;
  }

  tipoNombre(tipoId: number): string {
    return this.tipos.find(t => t.id === tipoId)?.nombre || String(tipoId);
  }
}
