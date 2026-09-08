/**
 * Previsualizacion de un correo (lo que saldria hoy o lo que ya se envio): asunto, destinatario,
 * copias y el HTML exacto dentro de un iframe aislado (sandbox, sin scripts).
 */
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface DatosVistaCorreo {
  titulo: string;
  asunto: string | null;
  destinatario: string | null;
  copias: string[] | string | null;
  cuerpoHtml: string;
  estado?: string | null;
  mensajeError?: string | null;
}

@Component({
  selector: 'app-dialogo-vista-correo',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title class="vc-titulo"><mat-icon>mail</mat-icon> {{ datos.titulo }}</h2>
    <mat-dialog-content class="vc-contenido">
      <dl class="vc-cabecera">
        <dt>Asunto</dt><dd>{{ datos.asunto || '—' }}</dd>
        <dt>Para</dt><dd>{{ datos.destinatario || '— (sin destinatario)' }}</dd>
        <dt>Copia</dt><dd>{{ copias || '—' }}</dd>
        @if (datos.estado) { <dt>Estado</dt><dd>{{ datos.estado }} @if (datos.mensajeError) { · {{ datos.mensajeError }} }</dd> }
      </dl>
      <iframe class="vc-marco" title="Vista previa del correo" sandbox="" [srcdoc]="cuerpo"></iframe>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button color="primary" type="button" mat-dialog-close>Cerrar</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .vc-titulo { display: flex; align-items: center; gap: 8px; font-weight: 800; }
    .vc-contenido { display: flex; flex-direction: column; gap: 10px; min-width: min(760px, 92vw); }
    .vc-cabecera { display: grid; grid-template-columns: 70px 1fr; gap: 4px 10px; margin: 0; font-size: 13px; }
    .vc-cabecera dt { color: #64748b; font-weight: 600; }
    .vc-cabecera dd { margin: 0; word-break: break-word; }
    .vc-marco { width: 100%; height: min(60vh, 560px); border: 1px solid rgba(15,23,42,.12); border-radius: 10px; background: #fff; }
  `],
})
export class DialogoVistaCorreoComponent {
  readonly datos = inject<DatosVistaCorreo>(MAT_DIALOG_DATA);
  private readonly sanitizador = inject(DomSanitizer);
  /** El HTML viene de nuestro propio backend (plantilla fija); el iframe sandbox lo aisla igual. */
  readonly cuerpo: SafeHtml = this.sanitizador.bypassSecurityTrustHtml(this.datos.cuerpoHtml || '<p>Sin contenido.</p>');
  readonly copias = Array.isArray(this.datos.copias) ? this.datos.copias.join(', ') : (this.datos.copias ?? '');
}
