import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { filter, firstValueFrom, lastValueFrom } from 'rxjs';
import { TareasApiService } from '../../services/tareas-api.service';
import { DirectorioService } from '../../services/directorio.service';
import { TareasDialogosService } from '../../services/tareas-dialogos.service';
import { Adjunto } from '../../models/tareas.models';
import { hace, iconoArchivo, mensajeError, modoVista, tamano } from '../../utils/tareas-ui';
import { AvisoDialogComponent } from '@/app/shared/components/confirm-dialog/confirm-dialog.component';

interface EnCurso { id: number; nombre: string; pct: number; error?: string }

/**
 * Archivos de una tarea o de un tablero: se arrastran o se eligen (de cualquier tipo), se
 * suben mostrando el avance de cada uno y se abren en el visor (imagen, PDF, video, audio,
 * Excel, CSV, Word, texto…) con navegación entre ellos.
 */
@Component({
  selector: 'app-adjuntos',
  standalone: true,
  imports: [MatIconModule, MatButtonModule, MatTooltipModule, MatProgressBarModule, MatSnackBarModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ad" [class.ad--sobre]="sobre()"
         (dragover)="puedeEditar() && $event.preventDefault(); puedeEditar() && sobre.set(true)"
         (dragleave)="sobre.set(false)" (drop)="soltar($event)">
      @if (adjuntos().length || enCurso().length) {
        <ul class="ad-grid">
          @for (a of adjuntos(); track a.uuid; let i = $index) {
            <li class="ad-item" [attr.data-modo]="modo(a)">
              <button type="button" class="ad-abrir" (click)="ver(i)" [matTooltip]="'Ver ' + a.original_name">
                <span class="ad-ico"><mat-icon>{{ icono(a) }}</mat-icon></span>
                <span class="ad-txt">
                  <strong>{{ a.original_name }}</strong>
                  <small>{{ tamano(a.size_bytes) }} · {{ hace(a.created_at) }}{{ a.uploader ? ' · ' + dir.nombre(a.uploader, '') : '' }}</small>
                </span>
              </button>
              <span class="ad-acc">
                <button type="button" class="ad-btn" (click)="descargar(a)" aria-label="Descargar" matTooltip="Descargar"><mat-icon>download</mat-icon></button>
                @if (puedeEditar()) {
                  <button type="button" class="ad-btn ad-btn--peligro" (click)="eliminar(a)" aria-label="Quitar" matTooltip="Quitar"><mat-icon>delete_outline</mat-icon></button>
                }
              </span>
            </li>
          }
          @for (u of enCurso(); track u.id) {
            <li class="ad-item ad-item--subiendo" [class.ad-item--error]="u.error">
              <span class="ad-ico"><mat-icon>{{ u.error ? 'error_outline' : 'cloud_upload' }}</mat-icon></span>
              <span class="ad-txt">
                <strong>{{ u.nombre }}</strong>
                @if (u.error) { <small>{{ u.error }}</small> } @else { <mat-progress-bar mode="determinate" [value]="u.pct" /> }
              </span>
              @if (u.error) {
                <button type="button" class="ad-btn" (click)="descartar(u.id)" aria-label="Descartar"><mat-icon>close</mat-icon></button>
              } @else { <small class="ad-pct">{{ u.pct }}%</small> }
            </li>
          }
        </ul>
      } @else if (!puedeEditar()) {
        <p class="ad-vacio">Sin archivos.</p>
      }
      @if (puedeEditar()) {
        <input #selector type="file" multiple hidden (change)="elegir($event)">
        <button type="button" class="ad-zona" (click)="selector.click()">
          <mat-icon>upload_file</mat-icon>
          <span><strong>Arrastra archivos aquí</strong> o haz clic para elegirlos · cualquier tipo, hasta {{ maxMb() }} MB c/u</span>
        </button>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .ad { display: flex; flex-direction: column; gap: 8px; border-radius: 14px; transition: background .15s, box-shadow .15s; }
    .ad--sobre { background: var(--blue-soft); box-shadow: 0 0 0 2px var(--primary); }
    .ad-grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 8px; }
    .ad-item { display: flex; align-items: center; gap: 4px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); padding: 4px 4px 4px 0; min-width: 0; }
    .ad-item:hover { border-color: var(--border-strong); }
    .ad-abrir { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; border: 0; background: none; padding: 4px 6px; font: inherit; color: var(--text);
                text-align: left; cursor: pointer; border-radius: 10px; min-height: 0 !important; }
    .ad-ico { width: 36px; height: 36px; flex: none; display: grid; place-items: center; border-radius: 10px; background: var(--surface-3); color: var(--text-2); }
    .ad-item[data-modo="imagen"] .ad-ico { background: var(--info-bg); color: var(--info-fg); }
    .ad-item[data-modo="pdf"] .ad-ico { background: var(--danger-bg); color: var(--danger-fg); }
    .ad-item[data-modo="hoja"] .ad-ico, .ad-item[data-modo="csv"] .ad-ico { background: var(--ok-bg); color: var(--ok-fg); }
    .ad-item[data-modo="documento"] .ad-ico { background: var(--blue-soft); color: var(--brand-blue-strong); }
    .ad-item[data-modo="video"] .ad-ico, .ad-item[data-modo="audio"] .ad-ico { background: var(--violet-bg); color: var(--violet-fg); }
    .ad-txt { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
    .ad-txt strong { font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ad-txt small { font-size: 11.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ad-acc { display: flex; flex: none; }
    .ad-btn { border: 0; background: none; color: var(--muted); cursor: pointer; padding: 6px; border-radius: 8px; display: inline-flex; min-height: 0 !important; }
    .ad-btn:hover { background: var(--surface-3); color: var(--text); }
    .ad-btn--peligro:hover { color: var(--danger); }
    .ad-btn mat-icon { font-size: 19px; width: 19px; height: 19px; }
    .ad-item--subiendo { padding: 8px 10px; gap: 8px; }
    .ad-item--subiendo .ad-ico { width: 30px; height: 30px; }
    .ad-item--error { border-color: var(--danger-border); background: var(--danger-bg); }
    .ad-item--error small { color: var(--danger-fg); white-space: normal; }
    .ad-pct { font-size: 11.5px; color: var(--muted); font-weight: 700; }
    .ad-zona { display: flex; align-items: center; gap: 10px; border: 1.5px dashed var(--border-strong); border-radius: 12px; background: var(--surface-2);
               padding: 10px 14px; font: inherit; font-size: 13px; color: var(--muted); cursor: pointer; text-align: left; min-height: 0 !important; }
    .ad-zona:hover { border-color: var(--primary); color: var(--text-2); }
    .ad-zona strong { color: var(--text-2); }
    .ad-zona mat-icon { color: var(--primary); flex: none; }
    .ad-vacio { margin: 0; color: var(--muted); font-size: 13px; }
  `],
})
export class AdjuntosComponent {
  private readonly api = inject(TareasApiService);
  readonly dir = inject(DirectorioService);
  private readonly dialogos = inject(TareasDialogosService);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);

  readonly adjuntos = input<Adjunto[]>([]);
  /** A dónde se suben: a una tarea o al tablero (archivos del tablero, sin tarea). */
  readonly destino = input.required<{ card?: number; board?: number }>();
  readonly puedeEditar = input(true);
  readonly maxMb = input(100);
  /** Se subió o se quitó algo: quien lo usa recarga. */
  readonly cambio = output<void>();

  readonly sobre = signal(false);
  readonly enCurso = signal<EnCurso[]>([]);
  private sec = 0;

  tamano = tamano;
  hace = hace;
  icono(a: Adjunto): string { return iconoArchivo(a.original_name, a.mime_type); }
  modo(a: Adjunto): string { return modoVista(a.original_name, a.mime_type); }

  ver(i: number): void {
    this.dialogos.verArchivos(this.adjuntos().map(a => ({ nombre: a.original_name, mime: a.mime_type, tamano: a.size_bytes, uuid: a.uuid })), i);
  }

  soltar(ev: DragEvent): void {
    ev.preventDefault();
    this.sobre.set(false);
    if (!this.puedeEditar()) return;
    this.subir(Array.from(ev.dataTransfer?.files ?? []));
  }

  elegir(ev: Event): void {
    const el = ev.target as HTMLInputElement;
    this.subir(Array.from(el.files ?? []));
    el.value = '';
  }

  /** Sube en paralelo de a uno por archivo; cada uno muestra su avance o su error. */
  async subir(archivos: File[]): Promise<void> {
    if (!archivos.length) return;
    const max = this.maxMb() * 1024 * 1024;
    const tareas = archivos.map(f => {
      const id = ++this.sec;
      this.enCurso.update(l => [...l, { id, nombre: f.name, pct: 0, error: f.size > max ? `Supera ${this.maxMb()} MB` : undefined }]);
      if (f.size > max) return Promise.resolve(false);
      return lastValueFrom(this.api.subirConAvance(this.destino(), f).pipe(
        filter(ev => {
          if (ev.tipo === 'progreso') this.enCurso.update(l => l.map(u => u.id === id ? { ...u, pct: ev.pct } : u));
          return ev.tipo === 'listo';
        }),
      )).then(() => { this.enCurso.update(l => l.filter(u => u.id !== id)); return true; })
        .catch(e => { this.enCurso.update(l => l.map(u => u.id === id ? { ...u, error: mensajeError(e, 'No se pudo subir') } : u)); return false; });
    });
    const res = await Promise.all(tareas);
    const ok = res.filter(Boolean).length;
    if (ok) {
      this.cambio.emit();
      this.snack.open(ok === 1 ? 'Archivo adjuntado' : `${ok} archivos adjuntados`, undefined, { duration: 2200 });
    }
  }

  descartar(id: number): void { this.enCurso.update(l => l.filter(u => u.id !== id)); }

  async descargar(a: Adjunto): Promise<void> {
    try {
      const blob = await this.api.descargarAdjunto(a.uuid);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = a.original_name || 'archivo';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      this.snack.open(mensajeError(e, 'No se pudo descargar.'), 'Cerrar', { duration: 4000 });
    }
  }

  async eliminar(a: Adjunto): Promise<void> {
    const nombre = a.original_name.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
    const ref = this.dialog.open(AvisoDialogComponent, {
      data: { icono: 'warning', titulo: '¿Quitar el archivo?', html: `Se elimina <b>${nombre}</b>. No se puede deshacer.`, textoConfirmar: 'Quitar', textoCancelar: 'Cancelar' },
      autoFocus: false,
    });
    if (!(await firstValueFrom(ref.afterClosed()))) return;
    try {
      await this.api.eliminarAdjunto(a.uuid);
      this.cambio.emit();
      this.snack.open('Archivo eliminado', undefined, { duration: 2200 });
    } catch (e) {
      this.snack.open(mensajeError(e), 'Cerrar', { duration: 4500 });
    }
  }
}
