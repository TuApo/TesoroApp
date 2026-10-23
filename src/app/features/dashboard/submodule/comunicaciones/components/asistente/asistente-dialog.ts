import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { ChatStoreService } from '../../service/chat-store.service';
import { ComAsistentePanel } from './asistente-panel';

export interface AsistenteDialogData { conversacionId: string; nombre: string }

/** El asistente de IA de una conversación del chat (lo que se habló, redactar, pantallas y documentos). */
export function abrirAsistente(dialog: MatDialog, conversacionId: string, nombre: string): void {
  dialog.open(AsistenteDialog, {
    data: { conversacionId, nombre }, width: 'min(560px, 100vw)', maxWidth: '100vw', height: 'min(82vh, 760px)',
    panelClass: 'com-dialogo', autoFocus: false,
  });
}

@Component({
  selector: 'app-com-asistente-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, ComAsistentePanel],
  template: `
    <header>
      <span class="ico"><mat-icon>auto_awesome</mat-icon></span>
      <div class="tit"><h2>Asistente IA</h2><small>{{ data.nombre }}</small></div>
      <button type="button" class="cerrar" (click)="ref.close()" aria-label="Cerrar"><mat-icon>close</mat-icon></button>
    </header>
    <app-com-asistente-panel [conversacionId]="data.conversacionId" textoUsar="Usar en el chat"
      (usar)="usar($event)" (salio)="ref.close()" />`,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; background: var(--surface); color: var(--text); }
    header { display: flex; align-items: center; gap: .6rem; padding: .8rem 1rem; border-bottom: 1px solid var(--border); }
    .ico { width: 36px; height: 36px; border-radius: 50%; background: color-mix(in srgb, var(--primary) 14%, transparent); color: var(--primary);
      display: inline-flex; align-items: center; justify-content: center; flex: none; }
    .tit { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    h2 { margin: 0; font-size: 1rem; }
    small { color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cerrar { border: 0; background: var(--surface-3); width: 36px; height: 36px; min-height: 0 !important; border-radius: 50%; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center; color: var(--text); }
  `],
})
export class AsistenteDialog {
  readonly data = inject<AsistenteDialogData>(MAT_DIALOG_DATA);
  readonly ref = inject(MatDialogRef<AsistenteDialog>);
  private readonly store = inject(ChatStoreService);

  /** El borrador va al redactor de la conversación: la persona lo revisa y lo envía. */
  usar(texto: string): void {
    this.store.insertarEnComposer$.next({ conversacionId: this.data.conversacionId, texto });
    this.ref.close();
  }
}
