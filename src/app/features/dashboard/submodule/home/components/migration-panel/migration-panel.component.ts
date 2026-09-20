import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';

import Swal from 'sweetalert2';

import { BadgeCelda, ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';

import {
  MigrationBatchDownload,
  MigrationPlan,
  MigrationService,
  MigrationSuggestedBatch,
} from '../../service/migration.service';

type BatchStatus = 'pending' | 'in_progress' | 'done' | 'skipped' | 'error';

/** Chip de estado de cada lote (mismos textos e íconos que la tabla anterior). */
const ESTADO_LOTE: Record<BatchStatus, BadgeCelda> = {
  pending:     { texto: 'pendiente', tono: 'neutro', icono: 'schedule' },
  in_progress: { texto: 'bajando',   tono: 'warn',   icono: 'sync' },
  done:        { texto: 'ok',        tono: 'ok',     icono: 'check' },
  skipped:     { texto: 'ya estaba', tono: 'neutro', icono: 'skip_next' },
  error:       { texto: 'error',     tono: 'danger', icono: 'error' },
};

interface BatchProgressRow {
  batch_id: string;
  owners: number;
  versions: number;
  bytes: number;
  status: BatchStatus;
  error?: string;
  files_written?: number;
  files_missing?: number;
  duration_ms?: number;
}

interface FsWritable {
  write(data: Blob | Uint8Array | string): Promise<void>;
  close(): Promise<void>;
}
interface FsFileHandle {
  createWritable(): Promise<FsWritable>;
  getFile(): Promise<File>;
}
interface FsDirHandle {
  name: string;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FsDirHandle>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FsFileHandle>;
}

// Defaults internos. El cliente NO los toca: el panel los aplica solo.
// Si los lotes salen muy grandes, se baja a uno menor automáticamente.
const DEFAULT_OWNERS_PER_BATCH = 50;
const DEFAULT_MAX_BATCH_MB = 300;
const AUTO_RETRY_MAX = 2;

@Component({
  selector: 'app-migration-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    ...TABLA_ESTANDAR,
  ],
  templateUrl: './migration-panel.component.html',
  styleUrls: ['./migration-panel.component.css'],
})
export class MigrationPanelComponent {
  private readonly migrationService = inject(MigrationService);

  // El backend autentica con el JWT actual (AuthInterceptor lo inyecta).
  // El usuario solo necesita estar logueado como ADMIN/GERENCIA.

  // Toggle único para ver tabla detalle.
  showDetails = signal<boolean>(false);

  /** Detalle por lote en la tabla estándar. */
  readonly columnasLotes: ColumnaTabla<BatchProgressRow>[] = [
    { id: 'lote', header: 'Lote', valor: (b) => b.batch_id, tarjeta: 'titulo' },
    { id: 'personas', header: 'Personas', valor: (b) => b.owners, align: 'right', tarjeta: 'meta' },
    { id: 'versiones', header: 'Versiones', valor: (b) => b.versions, align: 'right', prioridad: 2, tarjeta: 'meta' },
    { id: 'tamano', header: 'Tamaño', valor: (b) => b.bytes, align: 'right', tarjeta: 'meta',
      formato: (b) => this.formatBytes(b.bytes), copiaTexto: (b) => String(b.bytes ?? '') },
    { id: 'estado', header: 'Estado', valor: (b) => ESTADO_LOTE[b.status]?.texto ?? b.status, tarjeta: 'badge',
      badge: (b) => ESTADO_LOTE[b.status] },
    { id: 'files', header: 'Files', prioridad: 2, tarjeta: 'meta',
      valor: (b) => (b.files_written !== undefined && b.files_written >= 0
        ? `${b.files_written} / ${b.files_missing ?? 0}` : '') },
    { id: 'tiempo', header: 'Tiempo', valor: (b) => b.duration_ms ?? null, align: 'right', prioridad: 3,
      tarjeta: 'meta', formato: (b) => this.formatMs(b.duration_ms) },
    { id: 'detalle', header: 'Detalle', valor: (b) => b.error ?? '', prioridad: 3, tarjeta: 'cuerpo' },
  ];

  readonly idLote = (b: BatchProgressRow) => b.batch_id;
  readonly claseFilaLote = (b: BatchProgressRow): string => {
    if (b.status === 'error') return 'te-fila--peligro';
    if (b.status === 'in_progress') return 'te-fila--alerta';
    if (b.status === 'skipped') return 'te-fila--atenuada';
    return '';
  };

  // Estado de migración
  plan = signal<MigrationPlan | null>(null);
  destinationHandle = signal<FsDirHandle | null>(null);
  destinationName = signal<string>('');
  batches = signal<BatchProgressRow[]>([]);
  phase = signal<'idle' | 'loading_plan' | 'picking_dest' | 'running' | 'done' | 'error_fatal'>('idle');
  errorMsg = signal<string>('');
  currentBatchId = signal<string>('');
  retryRound = signal<number>(0);

  // ─── Derivados para mostrar bonito ──────────────────────────────────
  totalBatches = computed(() => this.batches().length);
  doneBatches = computed(
    () => this.batches().filter((b) => b.status === 'done' || b.status === 'skipped').length,
  );
  errorBatches = computed(() => this.batches().filter((b) => b.status === 'error').length);
  inProgress = computed(() => this.phase() === 'running');

  progressPct = computed(() => {
    const total = this.totalBatches();
    if (!total) return 0;
    return Math.round((this.doneBatches() / total) * 100);
  });

  totalBytesDone = computed(() =>
    this.batches()
      .filter((b) => b.status === 'done' || b.status === 'skipped')
      .reduce((acc, b) => acc + b.bytes, 0),
  );

  totalBytesPlan = computed(() => this.plan()?.totals?.bytes ?? 0);

  hasFinished = computed(
    () => this.phase() === 'done' && this.totalBatches() > 0,
  );

  hasAnyError = computed(() => this.errorBatches() > 0);

  // ─── ÚNICA acción que el cliente necesita ejecutar ──────────────────
  /**
   * Botón "Iniciar migración completa".
   * Hace los 3 pasos seguidos: plan → carpeta → descarga.
   * Cualquier corte se persiste en localStorage para retomar.
   */
  async startEverything(): Promise<void> {
    this.errorMsg.set('');

    // 1. Plan (autenticación = JWT del AuthInterceptor)
    this.phase.set('loading_plan');
    let plan: MigrationPlan;
    try {
      plan = await this.migrationService.getPlan(
        DEFAULT_OWNERS_PER_BATCH,
        DEFAULT_MAX_BATCH_MB * 1024 * 1024,
      );
    } catch (err: any) {
      this.errorMsg.set(this.extractError(err));
      this.phase.set('error_fatal');
      return;
    }
    this.plan.set(plan);
    this.batches.set(plan.suggested_batches.map((b) => ({
      batch_id: b.batch_id,
      owners: b.owner_ids.length,
      versions: b.versions,
      bytes: b.bytes,
      status: 'pending' as BatchStatus,
    })));

    if (plan.suggested_batches.length === 0) {
      this.phase.set('done');
      await Swal.fire({
        title: 'No hay nada para migrar',
        text: 'El server 1 no reporta documentos.',
        icon: 'info',
      });
      return;
    }

    // 2. Confirmar y elegir carpeta destino (1 sola interacción)
    this.phase.set('picking_dest');
    const totalGb = (plan.totals.bytes / 1024 / 1024 / 1024).toFixed(2);
    const confirm = await Swal.fire({
      title: 'Listo para descargar',
      html: `
        <div style="text-align:left;line-height:1.7;">
          <div><b>${plan.totals.owners.toLocaleString()}</b> personas</div>
          <div><b>${plan.totals.documents.toLocaleString()}</b> documentos</div>
          <div><b>${plan.totals.versions.toLocaleString()}</b> versiones</div>
          <div><b>${totalGb} GB</b> aprox</div>
          <div><b>${plan.suggested_batches.length.toLocaleString()}</b> lotes</div>
          <hr/>
          <small>Vas a elegir una carpeta destino. Cada lote se guarda como ZIP.
          Si se corta, vuelves a darle al botón y retoma solo.</small>
        </div>`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Elegir carpeta y empezar',
      cancelButtonText: 'Cancelar',
      reverseButtons: true,
    });
    if (!confirm.isConfirmed) {
      this.phase.set('idle');
      return;
    }

    const win = window as any;
    if (typeof win.showDirectoryPicker !== 'function') {
      this.errorMsg.set(
        'Tu navegador no soporta el selector de carpeta. Abre la app desde Electron.',
      );
      this.phase.set('error_fatal');
      return;
    }

    let dest: FsDirHandle;
    try {
      dest = await win.showDirectoryPicker({
        id: 'gd-migration-dest',
        mode: 'readwrite',
        startIn: 'downloads',
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        this.phase.set('idle');
        return;
      }
      this.errorMsg.set(this.extractError(err));
      this.phase.set('error_fatal');
      return;
    }
    this.destinationHandle.set(dest);
    this.destinationName.set(dest.name);

    // 3. Descargar
    await this.runDownloadLoop();

    // 4. Auto-retry de fallidos (sin pedir nada al cliente)
    for (let i = 0; i < AUTO_RETRY_MAX && this.errorBatches() > 0; i++) {
      this.retryRound.set(i + 1);
      const rows = this.batches().map((b) =>
        b.status === 'error' ? { ...b, status: 'pending' as BatchStatus, error: undefined } : b,
      );
      this.batches.set(rows);
      await this.runDownloadLoop();
    }
    this.retryRound.set(0);

    this.phase.set('done');
    if (this.errorBatches() === 0) {
      await Swal.fire({
        title: '¡Listo!',
        html: `Se descargaron <b>${this.doneBatches()}</b> lotes en <code>${this.destinationName()}</code>.`,
        icon: 'success',
      });
    } else {
      await Swal.fire({
        title: 'Terminó con errores',
        html: `Quedaron <b>${this.errorBatches()}</b> lote(s) con error después de ${AUTO_RETRY_MAX} reintentos automáticos. ` +
              `Vuelve a darle a "Iniciar" para retomar — solo bajará los que faltan.`,
        icon: 'warning',
      });
    }
  }

  private async runDownloadLoop(): Promise<void> {
    this.phase.set('running');
    const plan = this.plan();
    const dest = this.destinationHandle();
    if (!plan || !dest) { this.phase.set('error_fatal'); return; }

    // Escribir plan.json + catalogs.json (idempotente: sobreescribimos siempre,
    // el último plan vivo es el bueno).
    try {
      await this.writeJson(dest, 'plan.json', plan);
      await this.writeJson(dest, 'catalogs.json', plan.catalogs);
    } catch (err: any) {
      this.errorMsg.set('No se pudo escribir en la carpeta: ' + this.extractError(err));
      this.phase.set('error_fatal');
      return;
    }

    const batchesDir = await dest.getDirectoryHandle('batches', { create: true });
    const rows = [...this.batches()];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.status === 'done' || row.status === 'skipped') continue;

      // Skip si ya está en disco con tamaño > 0
      const existing = await this.tryGetExistingFile(batchesDir, `${row.batch_id}.zip`);
      if (existing && existing.size > 0) {
        row.status = 'skipped';
        row.files_written = -1;
        rows[i] = row;
        this.batches.set([...rows]);
        continue;
      }

      row.status = 'in_progress';
      rows[i] = row;
      this.batches.set([...rows]);
      this.currentBatchId.set(row.batch_id);

      const startedAt = performance.now();
      try {
        const batchMeta: MigrationSuggestedBatch = {
          batch_id: row.batch_id,
          owner_ids: plan.suggested_batches[i].owner_ids,
          versions: row.versions,
          bytes: row.bytes,
        };
        const dl: MigrationBatchDownload = await this.migrationService.downloadBatch(
          batchMeta, { includeChunks: false, includeAccessLogs: false },
        );
        await this.writeBlob(batchesDir, dl.filename, dl.blob);
        row.status = 'done';
        row.files_written = dl.headers.filesWritten;
        row.files_missing = dl.headers.filesMissing;
        row.duration_ms = Math.round(performance.now() - startedAt);
      } catch (err: any) {
        row.status = 'error';
        row.error = this.extractError(err);
      }
      rows[i] = row;
      this.batches.set([...rows]);
    }
    this.currentBatchId.set('');
  }

  /**
   * "Empezar de cero": olvida estado, NO borra archivos del disco.
   * Si el usuario vuelve a apuntar a la misma carpeta, los .zip ya bajados
   * siguen contando como skipped.
   */
  resetState(): void {
    this.plan.set(null);
    this.batches.set([]);
    this.destinationHandle.set(null);
    this.destinationName.set('');
    this.currentBatchId.set('');
    this.errorMsg.set('');
    this.phase.set('idle');
    this.retryRound.set(0);
  }

  toggleDetails(): void {
    this.showDetails.update((v) => !v);
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private async writeJson(dir: FsDirHandle, name: string, obj: unknown): Promise<void> {
    const handle = await dir.getFileHandle(name, { create: true });
    const w = await handle.createWritable();
    await w.write(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
    await w.close();
  }

  private async writeBlob(dir: FsDirHandle, name: string, blob: Blob): Promise<void> {
    const handle = await dir.getFileHandle(name, { create: true });
    const w = await handle.createWritable();
    await w.write(blob);
    await w.close();
  }

  private async tryGetExistingFile(dir: FsDirHandle, name: string): Promise<File | null> {
    try {
      const h = await dir.getFileHandle(name, { create: false });
      return await h.getFile();
    } catch { return null; }
  }

  formatBytes(b: number): string {
    if (!b || b < 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = b;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v >= 100 || i === 0 ? 0 : 2)} ${units[i]}`;
  }

  formatMs(ms?: number): string {
    if (!ms) return '—';
    if (ms < 1000) return `${ms} ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(1)} s`;
    const m = Math.floor(s / 60);
    const rs = Math.round(s % 60);
    return `${m}m ${rs}s`;
  }

  phaseLabel(): string {
    switch (this.phase()) {
      case 'loading_plan': return 'Consultando server 1…';
      case 'picking_dest': return 'Esperando carpeta destino…';
      case 'running':
        return this.retryRound() > 0
          ? `Descargando (reintento ${this.retryRound()}/${AUTO_RETRY_MAX})…`
          : 'Descargando…';
      case 'done': return this.hasAnyError() ? 'Terminó con errores' : 'Completado';
      case 'error_fatal': return 'Error';
      default: return 'Listo para empezar';
    }
  }

  primaryButtonLabel(): string {
    if (this.inProgress()) return 'Descargando…';
    if (this.hasFinished() && this.hasAnyError()) return 'Reintentar los que faltaron';
    if (this.hasFinished()) return 'Migración completada';
    return 'Iniciar migración completa';
  }

  primaryButtonDisabled(): boolean {
    return this.inProgress()
      || this.phase() === 'loading_plan'
      || this.phase() === 'picking_dest'
      || (this.hasFinished() && !this.hasAnyError());
  }

  private extractError(err: unknown): string {
    if (!err) return 'Error desconocido';
    const anyErr = err as any;
    if (anyErr?.error?.detail) return anyErr.error.detail;
    if (anyErr?.message) return anyErr.message;
    return String(err);
  }
}
