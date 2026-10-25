import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';

import {
  CargaMasivaVacantesService,
  Catalogos,
  FilaValidada,
  MAX_FILAS,
  ResultadoCreacion,
} from '../../service/carga-masiva/carga-masiva-vacantes.service';

type Paso = 'inicio' | 'validando' | 'revision' | 'creando' | 'fin';

/**
 * Carga masiva de vacantes desde Excel.
 *
 * Descargar plantilla → subir → vista previa fila por fila → crear. El botón de crear
 * solo se habilita sin errores: la carga es de todo o nada (ver el servicio).
 * Devuelve `true` al cerrar si se creó algo, para que el listado recargue.
 */
@Component({
  selector: 'app-carga-masiva-vacantes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatProgressBarModule, MatTooltipModule],
  templateUrl: './carga-masiva-vacantes.component.html',
  styleUrl: './carga-masiva-vacantes.component.css',
})
export class CargaMasivaVacantesComponent {
  private readonly servicio = inject(CargaMasivaVacantesService);
  private readonly dialogRef = inject(MatDialogRef<CargaMasivaVacantesComponent>);

  readonly MAX_FILAS = MAX_FILAS;

  readonly paso = signal<Paso>('inicio');
  readonly descargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly archivo = signal<string | null>(null);
  readonly filas = signal<FilaValidada[]>([]);
  readonly total = signal(0);
  readonly hechas = signal(0);
  readonly resultado = signal<ResultadoCreacion | null>(null);
  readonly soloProblemas = signal(false);

  readonly conError = computed(() => this.filas().filter((f) => f.estado === 'error').length);
  readonly conAviso = computed(() => this.filas().filter((f) => f.estado === 'advertencia').length);
  readonly validas = computed(() => this.filas().filter((f) => f.payload).length);
  readonly personas = computed(() =>
    this.filas().reduce((a, f) => a + (f.payload ? Number(f.resumen.personas) || 0 : 0), 0));
  readonly visibles = computed(() =>
    this.soloProblemas() ? this.filas().filter((f) => f.estado !== 'ok') : this.filas());
  readonly porcentaje = computed(() => (this.total() ? Math.round((this.hechas() / this.total()) * 100) : 0));

  /** Catálogos de la última plantilla o validación: no se vuelven a pedir en la misma sesión del diálogo. */
  private catalogos: Catalogos | null = null;
  private creoAlgo = false;

  private async catalogosVivos(): Promise<Catalogos> {
    if (!this.catalogos) this.catalogos = await this.servicio.cargarCatalogos();
    return this.catalogos;
  }

  async descargarPlantilla(): Promise<void> {
    this.descargando.set(true);
    this.error.set(null);
    try {
      const cat = await this.catalogosVivos();
      if (!cat.centros.length) {
        this.error.set('No se pudieron cargar los centros del parametrizador. Intenta de nuevo.');
        this.catalogos = null;
        return;
      }
      await this.servicio.descargarPlantilla(cat);
    } catch (e) {
      this.catalogos = null;
      this.error.set(`No se pudo generar la plantilla: ${(e as Error)?.message ?? e}`);
    } finally {
      this.descargando.set(false);
    }
  }

  async onArchivo(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.error.set(null);
    this.filas.set([]);
    this.resultado.set(null);
    this.archivo.set(file.name);

    if (!/\.xlsx$/i.test(file.name)) {
      this.error.set('El archivo debe ser .xlsx (usa la plantilla).');
      return;
    }

    this.paso.set('validando');
    this.hechas.set(0);
    try {
      const leidas = await this.servicio.leerArchivo(file);
      if (!leidas.length) throw new Error('La hoja «Vacantes» no tiene filas con datos.');
      if (leidas.length > MAX_FILAS) {
        throw new Error(`El archivo trae ${leidas.length} filas; el máximo es ${MAX_FILAS}. Pártelo en varios.`);
      }
      this.total.set(leidas.length);
      // Catálogos frescos en cada validación: lo que se valida es lo que hay HOY.
      this.catalogos = null;
      const cat = await this.catalogosVivos();
      const filas = await this.servicio.validar(leidas, cat, (n) => this.hechas.set(n));
      this.filas.set(filas);
      this.soloProblemas.set(filas.some((f) => f.estado === 'error'));
      this.paso.set('revision');
    } catch (e) {
      this.error.set((e as Error)?.message ?? String(e));
      this.paso.set('inicio');
    }
  }

  async crear(): Promise<void> {
    if (this.conError() || !this.validas()) return;
    this.paso.set('creando');
    this.total.set(this.validas());
    this.hechas.set(0);
    const res = await this.servicio.crear(this.filas(), (n) => this.hechas.set(n));
    this.resultado.set(res);
    if (res.ok && res.creadas) this.creoAlgo = true;
    // Si falló y algo no se pudo deshacer, el listado también tiene que recargar.
    if (!res.ok && res.sinDeshacer?.length) this.creoAlgo = true;
    this.paso.set('fin');
  }

  otraCarga(): void {
    this.filas.set([]);
    this.archivo.set(null);
    this.resultado.set(null);
    this.error.set(null);
    this.paso.set('inicio');
  }

  cerrar(): void {
    this.dialogRef.close(this.creoAlgo);
  }

  iconoEstado(f: FilaValidada): string {
    return f.estado === 'error' ? 'error' : f.estado === 'advertencia' ? 'warning' : 'check_circle';
  }
}
