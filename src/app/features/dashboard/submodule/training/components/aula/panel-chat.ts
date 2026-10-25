import { ChangeDetectionStrategy, Component, ElementRef, Injector, Input, OnChanges, ViewChild, afterNextRender, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import type { SalaEnVivo } from '../../aula/sala-en-vivo';

/** Chat del aula. Va por los datos de LiveKit: quien entra tarde no ve lo anterior. */
@Component({
  selector: 'app-aula-chat',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule, DatePipe],
  template: `
    <div class="ch-lista" #lista>
      @for (m of sala.chat(); track m.id) {
        <div class="ch-msg" [class.propio]="m.propio">
          @if (!m.propio) { <strong>{{ m.nombre }}</strong> }
          <p>{{ m.texto }}</p>
          <time>{{ m.hora | date: 'h:mm a' }}</time>
        </div>
      } @empty {
        <p class="ch-vacio">Escribe para toda el aula. Los mensajes no se guardan.</p>
      }
    </div>
    <form class="ch-form" (ngSubmit)="enviar()">
      <input name="t" [(ngModel)]="texto" placeholder="Escribe un mensaje…" maxlength="2000" autocomplete="off" aria-label="Mensaje" />
      <button type="submit" [disabled]="!texto.trim()" aria-label="Enviar"><mat-icon>send</mat-icon></button>
    </form>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; min-height: 0; }
    .ch-lista { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 8px 2px; }
    .ch-msg { align-self: flex-start; max-width: 88%; background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px 12px 12px 4px; padding: 6px 10px; }
    .ch-msg.propio { align-self: flex-end; background: var(--primary); border-color: var(--primary); color: #fff; border-radius: 12px 12px 4px 12px; }
    .ch-msg strong { font-size: 12px; color: var(--primary); }
    .ch-msg p { margin: 2px 0; font-size: 14px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .ch-msg time { font-size: 10.5px; opacity: .65; }
    .ch-vacio { color: var(--muted); font-size: 13px; text-align: center; margin-top: 30px; }
    .ch-form { display: flex; gap: 6px; padding-top: 8px; border-top: 1px solid var(--border); }
    .ch-form input { flex: 1; min-width: 0; font: 14px var(--font-sans); padding: 10px 12px; border-radius: 12px; border: 1px solid var(--border-strong); background: var(--surface-2); color: var(--text); }
    .ch-form button { width: 44px; border-radius: 12px; border: 0; background: var(--primary); color: #fff; cursor: pointer; display: grid; place-items: center; }
    .ch-form button:disabled { opacity: .5; }
  `],
})
export class PanelChat implements OnChanges {
  @Input({ required: true }) sala!: SalaEnVivo;
  @Input() largo = 0;
  @ViewChild('lista') lista?: ElementRef<HTMLElement>;
  private injector = inject(Injector);
  texto = '';

  ngOnChanges(): void {
    afterNextRender(() => { const el = this.lista?.nativeElement; if (el) el.scrollTop = el.scrollHeight; }, { injector: this.injector });
  }

  enviar(): void {
    this.sala.enviarChat(this.texto);
    this.texto = '';
    this.ngOnChanges();
  }
}
