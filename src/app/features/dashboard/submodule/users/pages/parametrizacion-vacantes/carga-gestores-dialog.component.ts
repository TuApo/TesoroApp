/**
 * Carga masiva de gestores y correos de centros de costo.
 *
 * ```
 *   descargar plantilla → editar → subir → VISTA PREVIA (nada se guarda) → APLICAR
 * ```
 *
 * Mismo flujo que la carga de tarjetas: el backend lee y valida el archivo y guarda un
 * lote SIMULADO con el veredicto por fila; APLICAR aplica exactamente ese lote. La
 * pestaña Historial lista las cargas, su Excel de resultados y la reversa.
 *
 * Toda la validación vive en el backend (ms-auth-admin): aquí solo se muestra.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatRadioModule } from '@angular/material/radio';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';

import { AvisoDialogComponent, AvisoDialogData } from '@/app/shared/components/confirm-dialog/confirm-dialog.component';
import {
  EstadoFilaCarga, FilaLoteContactos, LoteContactos, LoteContactosConFilas, ModoCargaContactos,
  ParametrizacionVacantesService,
} from '../../services/parametrizacion-vacantes/parametrizacion-vacantes.service';

export interface CargaGestoresDialogData {
  temporales: { id: number; nombre: string }[];
  empresas: { ref: number; nombre: string; temporal: number | null }[];
}

/** Mismos topes que valida el backend. */
export const TAMANO_MAXIMO_CONTACTOS = 5 * 1024 * 1024;
const EXTENSIONES = ['.xlsx', '.csv'];

/** CAMBIOS = NUEVO + MODIFICADO: lo que de verdad va a tocar la carga. */
type FiltroEstado = 'TODAS' | 'CAMBIOS' | EstadoFilaCarga | 'ADVERTENCIA';

@Component({
  selector: 'app-carga-gestores-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe, FormsModule, MatDialogModule, MatButtonModule, MatIconModule, MatFormFieldModule,
    MatSelectModule, MatRadioModule, MatTabsModule, MatTooltipModule, MatProgressBarModule,
  ],
  templateUrl: './carga-gestores-dialog.component.html',
  styleUrl: './carga-gestores-dialog.component.css',
})
export class CargaGestoresDialogComponent {
  readonly data = inject<CargaGestoresDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<CargaGestoresDialogComponent, boolean>>(MatDialogRef);
  private readonly svc = inject(ParametrizacionVacantesService);
  private readonly dialog = inject(MatDialog);

  // ── Plantilla ───────────────────────────────────────────────────────────
  readonly temporalPlantilla = signal<number | null>(null);
  readonly empresasPlantilla = signal<number[]>([]);
  readonly empresasDeTemporal = computed(() => {
    const t = this.temporalPlantilla();
    return t == null ? this.data.empresas : this.data.empresas.filter(e => e.temporal === t);
  });

  // ── Carga ───────────────────────────────────────────────────────────────
  readonly archivo = signal<File | null>(null);
  readonly modo = signal<ModoCargaContactos>('AGREGAR');
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly simulacion = signal<LoteContactosConFilas | null>(null);
  readonly aplicacion = signal<LoteContactosConFilas | null>(null);
  readonly filtro = signal<FiltroEstado>('TODAS');
  /** Hubo escritura: el listado de centros de atrás se recarga al cerrar. */
  private escribio = false;

  readonly paso = computed<'archivo' | 'revision' | 'resultado'>(() =>
    this.aplicacion() ? 'resultado' : this.simulacion() ? 'revision' : 'archivo');

  readonly loteActual = computed(() => (this.aplicacion() ?? this.simulacion())?.lote ?? null);

  readonly filasVisibles = computed(() => {
    const base = (this.aplicacion() ?? this.simulacion())?.filas ?? [];
    const f = this.filtro();
    if (f === 'TODAS') return base;
    if (f === 'ADVERTENCIA') return base.filter(x => x.advertencias.length);
    if (f === 'CAMBIOS') return base.filter(x => x.estado === 'NUEVO' || x.estado === 'MODIFICADO');
    return base.filter(x => x.estado === f);
  });

  readonly filasAAplicar = computed(() => {
    const l = this.simulacion()?.lote;
    return l ? l.filas_nuevo + l.filas_modificado : 0;
  });

  // ── Historial ───────────────────────────────────────────────────────────
  readonly lotes = signal<LoteContactos[]>([]);
  readonly cargandoLotes = signal(false);

  readonly etiquetasEstado: Record<EstadoFilaCarga, string> = {
    NUEVO: 'Nuevo', MODIFICADO: 'Modificado', SIN_CAMBIOS: 'Sin cambios', ERROR: 'Error',
  };

  // ── Plantilla ───────────────────────────────────────────────────────────

  alCambiarTemporal(t: number | null): void {
    this.temporalPlantilla.set(t);
    // Las empresas elegidas que no son de esa temporal ya no aplican.
    const validas = new Set(this.empresasDeTemporal().map(e => e.ref));
    this.empresasPlantilla.update(l => l.filter(r => validas.has(r)));
  }

  descargarPlantilla(): void {
    this.cargando.set(true);
    this.error.set(null);
    this.svc.plantillaContactos(this.temporalPlantilla(), this.empresasPlantilla()).subscribe({
      next: b => {
        this.cargando.set(false);
        this.guardarArchivo(b, `plantilla_gestores_correos_${new Date().toISOString().slice(0, 10)}.xlsx`);
      },
      error: e => this.fallo(e),
    });
  }

  // ── Archivo ─────────────────────────────────────────────────────────────

  alElegirArchivo(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    this.aceptar(input.files?.[0] ?? null);
    input.value = '';
  }

  alSoltar(ev: DragEvent): void {
    ev.preventDefault();
    this.aceptar(ev.dataTransfer?.files?.[0] ?? null);
  }

  alArrastrar(ev: DragEvent): void { ev.preventDefault(); }

  private aceptar(f: File | null): void {
    if (!f) return;
    const n = f.name.toLowerCase();
    if (!EXTENSIONES.some(e => n.endsWith(e))) {
      this.error.set('Solo se admiten archivos .xlsx o .csv.');
      return;
    }
    if (f.size > TAMANO_MAXIMO_CONTACTOS) {
      this.error.set(`El archivo pesa ${this.peso(f.size)}; el máximo es 5 MB.`);
      return;
    }
    this.error.set(null);
    this.archivo.set(f);
  }

  simular(): void {
    const f = this.archivo();
    if (!f) return;
    this.cargando.set(true);
    this.error.set(null);
    this.svc.simularContactos(f, this.modo()).subscribe({
      next: r => {
        this.cargando.set(false);
        this.simulacion.set(r);
        // Primero lo que hay que mirar: los errores, o si no hay, lo que va a cambiar.
        this.filtro.set(r.lote.filas_error ? 'ERROR' : (r.lote.filas_nuevo + r.lote.filas_modificado) ? 'CAMBIOS' : 'TODAS');
      },
      error: e => this.fallo(e),
    });
  }

  confirmarAplicar(): void {
    const l = this.simulacion()?.lote;
    if (!l) return;
    const modoTxt = l.modo === 'REEMPLAZAR'
      ? '<strong>Reemplazar</strong>: los correos que no estén en el archivo quedarán <strong>inactivos</strong> y las celdas vacías borran el dato.'
      : '<strong>Solo agregar/actualizar</strong>: no se desactiva ni se borra nada.';
    const data: AvisoDialogData = {
      icono: 'warning',
      titulo: `Aplicar ${this.filasAAplicar()} fila(s)`,
      html: `<p>Se actualizarán ${this.filasAAplicar()} centro(s) en una sola transacción.
             ${l.filas_error ? `Las ${l.filas_error} fila(s) con error <strong>no</strong> se aplican.` : ''}</p>
             <p>${modoTxt}</p><p>Se puede revertir desde el Historial mientras nadie cambie esos centros.</p>`,
      textoConfirmar: 'Aplicar', textoCancelar: 'Cancelar',
    };
    this.dialog.open(AvisoDialogComponent, { data }).afterClosed().subscribe(ok => { if (ok === true) this.aplicar(); });
  }

  private aplicar(): void {
    const l = this.simulacion()?.lote;
    if (!l) return;
    this.cargando.set(true);
    this.svc.aplicarLoteContactos(l.id).subscribe({
      next: r => {
        this.cargando.set(false);
        this.escribio = true;
        this.aplicacion.set(r);
        this.filtro.set('CAMBIOS');
      },
      error: e => this.fallo(e),
    });
  }

  otraCarga(): void {
    this.archivo.set(null);
    this.simulacion.set(null);
    this.aplicacion.set(null);
    this.error.set(null);
    this.filtro.set('TODAS');
  }

  descargarResultado(loteId?: number): void {
    const id = loteId ?? this.loteActual()?.id;
    if (!id) return;
    this.svc.resultadoLoteContactos(id).subscribe({
      next: b => this.guardarArchivo(b, `resultado_carga_${id}.xlsx`),
      error: e => this.fallo(e),
    });
  }

  // ── Historial ───────────────────────────────────────────────────────────

  alCambiarPestana(i: number): void {
    if (i === 1) this.cargarLotes();
  }

  cargarLotes(): void {
    this.cargandoLotes.set(true);
    this.svc.lotesContactos().subscribe({
      next: l => { this.lotes.set(l ?? []); this.cargandoLotes.set(false); },
      error: e => { this.cargandoLotes.set(false); this.fallo(e); },
    });
  }

  revertir(l: LoteContactos): void {
    const data: AvisoDialogData = {
      icono: 'warning',
      titulo: `Revertir la carga ${l.id}`,
      html: `<p>Los ${l.centros_actualizados} centro(s) de esta carga vuelven a como estaban antes de aplicarla:
             gestor, teléfono, oficina y correos. Los correos que creó quedan inactivos.</p>
             <p>Si alguno de esos centros se modificó después, la reversa se rechaza para no pisar ese cambio.</p>`,
      textoConfirmar: 'Revertir', textoCancelar: 'Cancelar',
    };
    this.dialog.open(AvisoDialogComponent, { data }).afterClosed().subscribe(ok => {
      if (ok !== true) return;
      this.cargandoLotes.set(true);
      this.svc.revertirLoteContactos(l.id).subscribe({
        next: () => { this.escribio = true; this.cargarLotes(); },
        error: e => { this.cargandoLotes.set(false); this.fallo(e); },
      });
    });
  }

  // ── utilidades ──────────────────────────────────────────────────────────

  cerrar(): void { this.ref.close(this.escribio); }

  claseEstado(e: string): string { return `cg-chip cg-chip--${e.toLowerCase()}`; }

  peso(bytes: number): string {
    return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  private fallo(e: HttpErrorResponse): void {
    this.cargando.set(false);
    // Los errores de un blob llegan como Blob: hay que leerlos para ver {error, codigo}.
    if (e?.error instanceof Blob) {
      e.error.text().then(t => {
        try { const j = JSON.parse(t); this.error.set(`${j.error ?? 'Error'}${j.codigo ? ` [${j.codigo}]` : ''}`); }
        catch { this.error.set('No se pudo completar la operación.'); }
      });
      return;
    }
    const d = e?.error?.error;
    this.error.set(d ? `${d}${e.error.codigo ? ` [${e.error.codigo}]` : ''}`
      : e?.status === 413 ? 'El archivo es demasiado grande.' : 'No se pudo completar la operación.');
  }

  private guardarArchivo(b: Blob, nombre: string): void {
    const url = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    a.click();
    URL.revokeObjectURL(url);
  }

  trackFila = (_: number, f: FilaLoteContactos) => f.fila;
}
