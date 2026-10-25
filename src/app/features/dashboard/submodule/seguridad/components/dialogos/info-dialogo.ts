import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import QRCode from 'qrcode';

import { copiarTexto } from '../../utils/formato';

export interface BloqueInfo {
  etiqueta: string;
  valor: string;
  /** Muestra el valor grande (un código para dictar). */
  grande?: boolean;
  /** Botón "Descargar" con este nombre de archivo. */
  archivo?: string;
}

export interface DatosInfo {
  titulo: string;
  icono?: string;
  descripcion?: string;
  aviso?: { tono: 'info' | 'warn' | 'danger'; texto: string };
  /** Botón grande que abre un enlace (p. ej. "Abrir Telegram"). */
  enlace?: { texto: string; url: string; icono?: string };
  /** Pinta un QR de este texto (con el paquete `qrcode`, ya en el proyecto). */
  qr?: string;
  bloques?: BloqueInfo[];
  pasosTitulo?: string;
  pasos?: string[];
  nota?: string;
  textoCerrar?: string;
}

/**
 * Diálogo de solo lectura para lo que se muestra UNA vez (token de un agente, código de
 * Telegram, enlace del parlante): cada bloque con su botón Copiar y, si aplica, Descargar.
 */
@Component({
  selector: 'sg-info-dialogo',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dlg">
      <header class="dlg-cab">
        @if (data.icono) { <mat-icon aria-hidden="true">{{ data.icono }}</mat-icon> }
        <h2 mat-dialog-title>{{ data.titulo }}</h2>
      </header>
      <mat-dialog-content class="dlg-cuerpo">
        @if (data.descripcion) { <p class="dlg-desc">{{ data.descripcion }}</p> }
        @if (data.aviso; as a) {
          <div [class]="'dlg-aviso ' + a.tono"><mat-icon aria-hidden="true">warning</mat-icon><span>{{ a.texto }}</span></div>
        }
        @if (data.enlace; as e) {
          <a class="inf-enlace" [href]="e.url" target="_blank" rel="noopener noreferrer">
            <mat-icon aria-hidden="true">{{ e.icono ?? 'open_in_new' }}</mat-icon>{{ e.texto }}
          </a>
        }
        @if (qr(); as q) { <div class="inf-qr"><img [src]="q" alt="Código QR del enlace" /></div> }
        @for (b of data.bloques ?? []; track b.etiqueta) {
          <div class="inf-bloque">
            <div class="et">
              <span>{{ b.etiqueta }}</span>
              <span>
                @if (b.archivo) {
                  <button type="button" class="inf-copiar" (click)="descargar(b)"><mat-icon aria-hidden="true">download</mat-icon>Descargar</button>
                }
                <button type="button" class="inf-copiar" (click)="copiar(b.valor)"><mat-icon aria-hidden="true">content_copy</mat-icon>Copiar</button>
              </span>
            </div>
            <pre class="inf-valor" [class.grande]="b.grande">{{ b.valor }}</pre>
          </div>
        }
        @if (data.pasos?.length) {
          <div class="inf-bloque">
            <div class="et">{{ data.pasosTitulo ?? 'Pasos' }}</div>
            <ol class="inf-lista">@for (p of data.pasos; track $index) { <li>{{ p }}</li> }</ol>
          </div>
        }
        @if (data.nota) { <p class="inf-nota">{{ data.nota }}</p> }
      </mat-dialog-content>
      <mat-dialog-actions align="end" class="dlg-acciones">
        <button mat-flat-button type="button" (click)="ref.close()">{{ data.textoCerrar ?? 'Listo' }}</button>
      </mat-dialog-actions>
    </div>
  `,
  styleUrls: ['./dialogos.css'],
})
export class InfoDialogo {
  readonly ref = inject(MatDialogRef<InfoDialogo>);
  readonly data = inject<DatosInfo>(MAT_DIALOG_DATA);
  private readonly snack = inject(MatSnackBar);
  readonly qr = signal<string | null>(null);

  constructor() {
    if (this.data.qr) {
      QRCode.toDataURL(this.data.qr, { margin: 1, width: 400, errorCorrectionLevel: 'M' })
        .then((u: string) => this.qr.set(u))
        .catch(() => this.qr.set(null));
    }
  }

  async copiar(v: string): Promise<void> {
    const ok = await copiarTexto(v);
    this.snack.open(ok ? 'Copiado' : 'No se pudo copiar: selecciónelo y cópielo a mano', 'OK', { duration: 2500 });
  }

  descargar(b: BloqueInfo): void {
    const blob = new Blob([b.valor], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = b.archivo ?? 'archivo.txt';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

export function abrirInfo(dialog: MatDialog, datos: DatosInfo): void {
  dialog.open(InfoDialogo, { data: datos, width: '640px', maxWidth: '96vw', autoFocus: false });
}
