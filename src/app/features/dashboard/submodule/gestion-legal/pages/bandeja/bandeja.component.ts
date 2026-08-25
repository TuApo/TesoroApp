import {
  Component, ChangeDetectionStrategy, ChangeDetectorRef, OnInit, inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormControl } from '@angular/forms';
import { Router } from '@angular/router';
import { BreakpointObserver } from '@angular/cdk/layout';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatChipsModule } from '@angular/material/chips';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

import { LegalService } from '../../services/legal.service';
import { ProcesoLegal, ProcesoTipo, ProcesoEstado } from '../../models/legal.models';
import { CambiarEstadoDialogComponent, CambiarEstadoResult } from './cambiar-estado-dialog.component';

const COLS_DESKTOP = ['radicado', 'tipo', 'trabajador', 'estado', 'fechaInicio', 'responsable', 'acciones'];
const COLS_MOBILE  = ['trabajador', 'estado', 'acciones'];

@Component({
  selector: 'app-bandeja-legal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule, ReactiveFormsModule,
    MatTableModule, MatPaginatorModule, MatChipsModule, MatButtonModule,
    MatIconModule, MatSelectModule, MatFormFieldModule, MatInputModule,
    MatTooltipModule, MatSnackBarModule, MatDialogModule, MatProgressSpinnerModule
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

  // Paginación
  pageIndex = 0;
  pageSize = 50;

  // Tabla
  columnasVisibles = COLS_DESKTOP;
  viewMode: 'table' | 'cards' = 'table';

  private bp = inject(BreakpointObserver);

  constructor() {
    this.busqueda.valueChanges.pipe(
      debounceTime(400),
      distinctUntilChanged(),
      takeUntilDestroyed()
    ).subscribe(() => { this.pageIndex = 0; this.cargar(); });

    this.bp.observe('(max-width: 768px)').pipe(takeUntilDestroyed()).subscribe(r => {
      this.columnasVisibles = r.matches ? COLS_MOBILE : COLS_DESKTOP;
      this.viewMode = r.matches ? 'cards' : 'table';
      this.cdr.markForCheck();
    });
  }

  setViewMode(mode: 'table' | 'cards'): void {
    this.viewMode = mode;
    this.cdr.markForCheck();
  }

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
        if (semaforo) filas = filas.filter(p => p.colorSemaforo === semaforo);
        this.procesos = filas;
        this.totalElements = page.totalElements || filas.length;
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
    this.cargarCatalogos();
    this.cargar();
  }

  onPageChange(ev: PageEvent): void {
    this.pageIndex = ev.pageIndex;
    this.pageSize = ev.pageSize;
    this.cargar();
  }

  irExpediente(proceso: ProcesoLegal): void {
    this.router.navigate(['/dashboard/gestion-legal/expediente', proceso.id]);
  }

  nuevoProceso(): void {
    this.router.navigate(['/dashboard/gestion-legal/nuevo-proceso']);
  }

  abrirCambiarEstado(proceso: ProcesoLegal, event: MouseEvent): void {
    event.stopPropagation();
    this.svc.getEstados(proceso.tipoId).subscribe({
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
