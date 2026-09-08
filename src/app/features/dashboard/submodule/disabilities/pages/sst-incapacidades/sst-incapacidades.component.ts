/**
 * Submodulo "Seguridad y salud en el trabajo" (reunion 2026-09-07): las incapacidades ARL
 * (accidente de trabajo / enfermedad laboral) con el seguimiento de la investigacion del
 * accidente que hace SST — cuales tienen el levantamiento subido, cuales no y cuales vencieron
 * el plazo. El archivo queda en gestion documental anclado a la incapacidad.
 */
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import Swal from 'sweetalert2';

import { IncapacidadGestionService } from '../../services/incapacidad-gestion/incapacidad-gestion.service';
import {
  ETIQUETA_ESTADO_INVESTIGACION,
  EstadoInvestigacionSst,
  FilaSst,
  FiltrosSst,
  ResumenSst,
} from '../../models/incapacidad-gestion.model';
import { hoyIso, inicioDeAnio, mensajeDeError } from '../informes-incapacidades/informes-incapacidades.component';
import { DialogoInvestigacionSstComponent } from './dialogo-investigacion-sst.component';

export function claseEstadoInvestigacion(f: FilaSst): string {
  if (f.investigacion.estado === 'COMPLETA') return 'ges-chip-ok';
  if (f.investigacion.estado === 'NO_APLICA') return 'ges-chip-neutro';
  if (f.vencida) return 'ges-chip-peligro';
  return 'ges-chip-aviso';
}

@Component({
  selector: 'app-sst-incapacidades',
  standalone: true,
  imports: [
    DatePipe, DecimalPipe, FormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatIconModule,
    MatInputModule, MatPaginatorModule, MatProgressSpinnerModule, MatSelectModule, MatTooltipModule,
  ],
  templateUrl: './sst-incapacidades.component.html',
  styleUrls: ['../gestion-incapacidades.comun.css', './sst-incapacidades.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SstIncapacidadesComponent implements OnInit {
  private readonly srv = inject(IncapacidadGestionService);
  private readonly dialogo = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);
  private readonly entradaArchivo = viewChild<ElementRef<HTMLInputElement>>('entradaArchivo');

  readonly estados = Object.entries(ETIQUETA_ESTADO_INVESTIGACION) as [EstadoInvestigacionSst, string][];
  filtros: FiltrosSst = { desde: inicioDeAnio(), hasta: hoyIso(), q: '', estado: '' };

  readonly page = signal(0);
  readonly size = signal(25);
  readonly total = signal(0);
  readonly filas = signal<FilaSst[]>([]);
  readonly resumen = signal<ResumenSst | null>(null);
  readonly cargando = signal(false);
  readonly error = signal('');
  readonly subiendo = signal<number | null>(null);
  readonly claseEstado = claseEstadoInvestigacion;
  private filaParaArchivo: FilaSst | null = null;

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.error.set('');
    this.srv.sstResumen(this.filtros.desde, this.filtros.hasta).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (r) => this.resumen.set(r), error: () => this.resumen.set(null) });
    this.srv
      .sstIncapacidades(this.filtros, this.page(), this.size())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (p) => { this.filas.set(p.content); this.total.set(p.totalElements); this.cargando.set(false); },
        error: (e: unknown) => { this.cargando.set(false); this.error.set(mensajeDeError(e, 'No se pudo cargar el listado.')); },
      });
  }

  filtrar(): void { this.page.set(0); this.cargar(); }

  filtroRapido(estado: EstadoInvestigacionSst | ''): void {
    this.filtros.estado = estado;
    this.filtrar();
  }

  paginar(e: PageEvent): void {
    this.page.set(e.pageIndex);
    this.size.set(e.pageSize);
    this.cargar();
  }

  editar(f: FilaSst): void {
    this.dialogo
      .open<DialogoInvestigacionSstComponent, FilaSst, FilaSst | undefined>(DialogoInvestigacionSstComponent, {
        data: f, width: '560px', maxWidth: '95vw', autoFocus: false,
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((actualizada) => { if (actualizada) this.reemplazar(actualizada); });
  }

  /** Abre el selector de archivo para la fila; la subida deja la investigacion COMPLETA. */
  elegirArchivo(f: FilaSst): void {
    this.filaParaArchivo = f;
    const input = this.entradaArchivo()?.nativeElement;
    if (input) { input.value = ''; input.click(); }
  }

  archivoElegido(evento: Event): void {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0];
    const fila = this.filaParaArchivo;
    if (!archivo || !fila) return;
    this.subiendo.set(fila.incapacidadId);
    this.srv.sstSubirArchivo(fila.incapacidadId, archivo).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (f) => { this.subiendo.set(null); this.reemplazar(f); },
      error: (e: unknown) => {
        this.subiendo.set(null);
        void Swal.fire({ icon: 'error', title: 'No se pudo subir la investigacion', text: mensajeDeError(e, 'Intente de nuevo.') });
      },
    });
  }

  descargar(f: FilaSst): void {
    this.srv.sstDescargarArchivo(f.incapacidadId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = f.investigacion.nombreArchivo || `investigacion-${f.cedula}.pdf`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      },
      error: (e: unknown) => void Swal.fire({ icon: 'error', title: 'No se pudo descargar', text: mensajeDeError(e, 'Intente de nuevo.') }),
    });
  }

  private reemplazar(f: FilaSst): void {
    this.filas.update((lista) => lista.map((x) => (x.incapacidadId === f.incapacidadId ? f : x)));
    this.srv.sstResumen(this.filtros.desde, this.filtros.hasta).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (r) => this.resumen.set(r), error: () => undefined });
  }

  trackFila(_: number, f: FilaSst): number { return f.incapacidadId; }
}
