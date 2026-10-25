import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { DocViewerService } from '@/app/shared/services/doc-viewer/doc-viewer.service';
import { environment } from '../../../../../../../environments/environment';
import { reducir } from '../../../../../economiapp/components/eco-captura-rostro';
import { Evidencia, TiendaService } from '../../service/tienda.service';

/**
 * Varias fotos de soporte para una cosa (un gasto de caja, un ajuste, un conteo, un
 * traslado): se toman con la cámara o se eligen de la galería, se reducen antes de subir y
 * quedan como evidencias de esa entidad.
 */
@Component({
  selector: 'app-fotos-evidencia',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <div class="fotos">
      @for (f of fotos(); track f.id) {
        <button type="button" class="mini" (click)="ver(f)" [attr.aria-label]="'Ver foto ' + ($index + 1)">
          @if (miniaturas()[f.id]) { <img [src]="miniaturas()[f.id]" alt="" /> } @else { <mat-icon>image</mat-icon> }
        </button>
      }
      @if (!soloVer()) {
        <label class="agregar" [class.ocupado]="subiendo() > 0">
          <mat-icon>{{ subiendo() ? 'hourglass_top' : 'add_a_photo' }}</mat-icon>
          <span>{{ subiendo() ? 'Subiendo ' + subiendo() + '…' : (fotos().length ? 'Más fotos' : etiqueta()) }}</span>
          <input type="file" accept="image/*" multiple (change)="subir($event)" hidden />
        </label>
      }
    </div>
  `,
  styles: [`
    .fotos { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .mini { width: 56px; height: 56px; min-height: 56px !important; padding: 0; border-radius: 10px; overflow: hidden; border: 1px solid var(--border); background: var(--surface-2, #f1f5f9); cursor: pointer; display: grid; place-items: center; }
    .mini img { width: 100%; height: 100%; object-fit: cover; }
    .agregar { display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; min-height: 44px; border-radius: 10px; border: 1px dashed var(--border); cursor: pointer; font-size: 13px; color: var(--text-2, var(--text)); }
    .agregar.ocupado { pointer-events: none; opacity: .7; }
    .agregar mat-icon { font-size: 20px; width: 20px; height: 20px; }
  `],
})
export class FotosEvidencia {
  private api = inject(TiendaService);
  private visor = inject(DocViewerService);
  readonly entidadTipo = input.required<string>();
  readonly entidadId = input.required<string>();
  readonly etiqueta = input('Agregar fotos');
  readonly soloVer = input(false);
  readonly cambio = output<number>();
  readonly fotos = signal<Evidencia[]>([]);
  readonly miniaturas = signal<Record<string, string>>({});
  readonly subiendo = signal(0);

  constructor() {
    effect(() => { const t = this.entidadTipo(), id = this.entidadId(); untracked(() => this.cargar(t, id)); });
  }

  async cargar(t: string, id: string): Promise<void> {
    if (!id) return;
    try {
      const fs = await firstValueFrom(this.api.evidencias(t, id));
      this.fotos.set(fs);
      for (const f of fs) if (!this.miniaturas()[f.id]) {
        this.visor.toBlobUrl(`${environment.apiUrl}/api/v1/documents/${f.doc_id}/download`).then(u => { if (u) this.miniaturas.update(m => ({ ...m, [f.id]: u })); });
      }
    } catch { this.fotos.set([]); }
  }

  async subir(ev: Event): Promise<void> {
    const archivos = Array.from((ev.target as HTMLInputElement).files ?? []); (ev.target as HTMLInputElement).value = '';
    this.subiendo.set(archivos.length);
    for (const a of archivos) {
      try {
        const b = await reducir(a, 1800);
        const doc = await firstValueFrom(this.api.subirArchivo(b, a.name || 'foto.jpg', this.entidadId(), 'STORE_' + this.entidadTipo()));
        await firstValueFrom(this.api.adjuntarEvidencia({ entidad_tipo: this.entidadTipo(), entidad_id: this.entidadId(), doc_id: doc }));
      } catch { /* sigue con las demas */ }
      this.subiendo.update(n => n - 1);
    }
    await this.cargar(this.entidadTipo(), this.entidadId());
    this.cambio.emit(this.fotos().length);
  }

  ver(f: Evidencia): void { this.visor.openInNewTab(`${environment.apiUrl}/api/v1/documents/${f.doc_id}/download`); }
}
