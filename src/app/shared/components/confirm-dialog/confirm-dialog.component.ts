/**
 * Diálogos de aviso/confirmación y de progreso, para usar DESDE otro MatDialog.
 *
 * Son MatDialog y no SweetAlert a propósito. Un Swal abierto desde un MatDialog
 * vive fuera del `.cdk-overlay-container` (o dentro, peleando por z-index) y
 * termina detrás del diálogo; se intentó con `target`, con z-index inline y
 * reordenando el DOM, y seguía quedando tapado. El CDK, en cambio, apila los
 * overlays por orden de apertura: el último abierto SIEMPRE queda al frente,
 * sin CSS de por medio.
 */
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

export type AvisoIcono = 'info' | 'question' | 'success' | 'warning' | 'error';

export interface AvisoDialogData {
  icono?: AvisoIcono;
  titulo: string;
  /** HTML simple (negritas, <br>); lo arma el componente que abre el diálogo. */
  html: string;
  textoConfirmar?: string;
  /** Sin esto solo se muestra el botón de confirmar (modo "aviso"). */
  textoCancelar?: string;
}

const ICONOS: Record<AvisoIcono, { nombre: string; clase: string }> = {
  info: { nombre: 'info', clase: 'ic-info' },
  question: { nombre: 'help', clase: 'ic-question' },
  success: { nombre: 'check_circle', clase: 'ic-success' },
  warning: { nombre: 'warning', clase: 'ic-warning' },
  error: { nombre: 'error', clase: 'ic-error' },
};

@Component({
  selector: 'app-aviso-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <div class="cd-wrap">
      <mat-icon class="cd-icon" [ngClass]="icono.clase">{{ icono.nombre }}</mat-icon>
      <h2 class="cd-titulo">{{ data.titulo }}</h2>
      <div class="cd-html" [innerHTML]="data.html"></div>
      <div class="cd-acciones">
        @if (data.textoCancelar) {
          <button mat-stroked-button (click)="ref.close(false)">{{ data.textoCancelar }}</button>
        }
        <button mat-flat-button class="cd-ok" (click)="ref.close(true)" cdkFocusInitial>
          {{ data.textoConfirmar || 'Entendido' }}
        </button>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .cd-wrap { padding: 22px 24px 16px; text-align: center; max-width: 420px; }
    .cd-icon { width: 56px; height: 56px; font-size: 56px; margin-bottom: 8px; }
    .ic-info, .ic-question { color: var(--muted); }
    .ic-success { color: #16a34a; color: light-dark(#16a34a, #9cf2bc); }
    .ic-warning { color: #d97706; color: light-dark(#d97706, #f7ca97); }
    .ic-error { color: #dc2626; color: light-dark(#dc2626, #ef9e9e); }
    .cd-titulo { margin: 0 0 8px; font-size: 1.15rem; font-weight: 700; color: var(--text); }
    .cd-html { font-size: .88rem; color: var(--text-2); line-height: 1.45; }
    .cd-acciones { display: flex; justify-content: center; gap: 10px; margin-top: 20px; }
    .cd-ok { background: #111827; color: #fff; }
  `],
})
export class AvisoDialogComponent {
  // Se asigna en el constructor, no como inicializador de campo: los campos se
  // inicializan ANTES de que los parámetros del constructor estén disponibles.
  readonly icono: { nombre: string; clase: string };

  constructor(
    public ref: MatDialogRef<AvisoDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: AvisoDialogData,
  ) {
    this.icono = ICONOS[data.icono ?? 'info'];
  }
}

/**
 * Progreso bloqueante. Se abre con `disableClose` y el texto se actualiza desde
 * afuera con `ref.componentInstance.mensaje.set(...)`.
 */
@Component({
  selector: 'app-progreso-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatDialogModule, MatProgressSpinnerModule],
  template: `
    <div class="cp-wrap">
      <mat-spinner diameter="46"></mat-spinner>
      <h2 class="cp-titulo">{{ titulo() }}</h2>
      <p class="cp-msg" [innerHTML]="mensaje()"></p>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .cp-wrap { padding: 26px 28px; text-align: center; min-width: 280px; }
    mat-spinner { margin: 0 auto 14px; }
    .cp-titulo { margin: 0 0 6px; font-size: 1.05rem; font-weight: 700; color: var(--text); }
    .cp-msg { margin: 0; font-size: .84rem; color: var(--muted); }
  `],
})
export class ProgresoDialogComponent {
  readonly titulo = signal('Procesando…');
  readonly mensaje = signal('');
}
