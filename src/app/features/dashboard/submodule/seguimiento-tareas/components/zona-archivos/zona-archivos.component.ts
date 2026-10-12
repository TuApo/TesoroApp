import { ChangeDetectionStrategy, Component, input, model, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { iconoArchivo, tamano } from '../../utils/tareas-ui';

/**
 * Zona para soltar o elegir archivos de cualquier tipo, con la lista de lo elegido.
 * Los archivos quedan en el `model` `archivos`; quien la usa decide cuándo subirlos.
 */
@Component({
  selector: 'app-zona-archivos',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="za" [class.za--sobre]="sobre()" [class.za--compacta]="compacta()"
         (dragover)="$event.preventDefault(); sobre.set(true)" (dragleave)="sobre.set(false)" (drop)="soltar($event)"
         (click)="selector.click()" (keydown.enter)="selector.click()" role="button" tabindex="0"
         [attr.aria-label]="texto()">
      <mat-icon>{{ sobre() ? 'file_download' : 'cloud_upload' }}</mat-icon>
      <div class="za__txt">
        <strong>{{ texto() }}</strong>
        <small>Cualquier tipo de archivo · hasta {{ maxMb() }} MB cada uno</small>
      </div>
      <input #selector type="file" multiple hidden (change)="elegir($event)">
    </div>
    @if (rechazados().length) {
      <p class="za__error"><mat-icon>error_outline</mat-icon>Superan {{ maxMb() }} MB: {{ rechazados().join(', ') }}</p>
    }
    @if (archivos().length) {
      <ul class="za__lista">
        @for (f of archivos(); track f.name + f.size + $index; let i = $index) {
          <li>
            <mat-icon class="za__ico">{{ icono(f) }}</mat-icon>
            <button type="button" class="za__nombre" (click)="ver.emit(i)" [matTooltip]="'Vista previa de ' + f.name">{{ f.name }}</button>
            <small>{{ tamano(f.size) }}</small>
            <button type="button" class="za__x" (click)="quitar(i)" [attr.aria-label]="'Quitar ' + f.name"><mat-icon>close</mat-icon></button>
          </li>
        }
      </ul>
    }
  `,
  styles: [`
    :host { display: block; }
    .za { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border: 2px dashed var(--border-strong); border-radius: 14px;
          background: var(--surface-2); color: var(--muted); cursor: pointer; transition: border-color .15s, background .15s; }
    .za:hover, .za:focus-visible { border-color: var(--primary); color: var(--primary); outline: none; }
    .za--sobre { border-color: var(--primary); background: var(--blue-soft); color: var(--primary); }
    .za--compacta { padding: 9px 12px; }
    .za mat-icon { font-size: 28px; width: 28px; height: 28px; flex: none; }
    .za--compacta mat-icon { font-size: 22px; width: 22px; height: 22px; }
    .za__txt { display: flex; flex-direction: column; min-width: 0; }
    .za__txt strong { color: var(--text); font-size: 14px; }
    .za__txt small { font-size: 12px; }
    .za__error { display: flex; align-items: center; gap: 6px; margin: 6px 0 0; font-size: 12.5px; color: var(--danger-fg); }
    .za__error mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .za__lista { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .za__lista li { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 10px; background: var(--surface); border: 1px solid var(--border); }
    .za__ico { color: var(--muted); font-size: 20px; width: 20px; height: 20px; }
    .za__nombre { flex: 1; min-width: 0; text-align: left; border: 0; background: none; padding: 0; font: inherit; font-size: 13.5px; font-weight: 650;
                  color: var(--link); cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-height: 0 !important; }
    .za__lista small { color: var(--muted); font-size: 12px; flex: none; }
    .za__x { border: 0; background: none; color: var(--text-faint); cursor: pointer; padding: 2px; border-radius: 6px; display: inline-flex; min-height: 0 !important; }
    .za__x:hover { color: var(--danger); background: var(--danger-bg); }
    .za__x mat-icon { font-size: 18px; width: 18px; height: 18px; }
  `],
})
export class ZonaArchivosComponent {
  readonly archivos = model<File[]>([]);
  readonly maxMb = input(100);
  readonly texto = input('Arrastra archivos aquí o haz clic para elegirlos');
  readonly compacta = input(false);
  /** Índice del archivo que se quiere previsualizar. */
  readonly ver = output<number>();
  readonly sobre = signal(false);
  readonly rechazados = signal<string[]>([]);

  icono(f: File): string { return iconoArchivo(f.name, f.type); }
  tamano = tamano;

  soltar(ev: DragEvent): void {
    ev.preventDefault();
    this.sobre.set(false);
    this.agregar(Array.from(ev.dataTransfer?.files ?? []));
  }

  elegir(ev: Event): void {
    const el = ev.target as HTMLInputElement;
    this.agregar(Array.from(el.files ?? []));
    el.value = '';
  }

  quitar(i: number): void { this.archivos.update(l => l.filter((_, j) => j !== i)); }

  private agregar(nuevos: File[]): void {
    const max = this.maxMb() * 1024 * 1024;
    const buenos = nuevos.filter(f => f.size <= max);
    this.rechazados.set(nuevos.filter(f => f.size > max).map(f => f.name));
    if (buenos.length) this.archivos.update(l => [...l, ...buenos]);
  }
}
