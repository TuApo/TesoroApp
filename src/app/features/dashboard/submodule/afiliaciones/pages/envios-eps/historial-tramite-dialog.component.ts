import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';

import { EnviosEpsService } from '../../services/envios-eps.service';
import {
  ETIQUETA_CANAL, ETIQUETA_EMPRESA, ETIQUETA_ESTADO_TRAMITE, EventoTramiteEps, TramiteEps,
} from '../../models/envios-eps.models';

/** Ficha de un trámite: datos del radicado y la confirmación, soportes y su historial. */
@Component({
  selector: 'app-historial-tramite-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MatDialogModule, MatButtonModule, MatIconModule, MatProgressBarModule],
  template: `
    <h2 mat-dialog-title>{{ t.nombre }}</h2>
    <mat-dialog-content class="ht">
      <dl class="ht-datos">
        <dt>Cédula</dt><dd>{{ t.cedula }}</dd>
        <dt>EPS</dt><dd>{{ t.eps_nombre }} <span class="ht-sub">(contrato: {{ t.eps_texto || '—' }})</span></dd>
        <dt>Empresa</dt><dd>{{ empresa }}</dd>
        <dt>Estado</dt><dd><b>{{ estado[t.estado] }}</b>{{ t.confirmacion_directa ? ' · confirmación directa' : '' }}</dd>
        @if (t.canal) { <dt>Canal</dt><dd>{{ canal[t.canal] }}</dd> }
        @if (t.radicado_numero || t.radicado_fecha) {
          <dt>Radicado</dt><dd>{{ t.radicado_numero || 'sin número' }} · {{ t.radicado_fecha }}</dd>
        }
        @if (t.confirmacion_fecha) { <dt>Confirmación</dt><dd>{{ t.confirmacion_fecha }}</dd> }
        @if (t.rechazo_motivo) { <dt>Devolución</dt><dd class="ht-mal">{{ t.rechazo_motivo }}</dd> }
        @if (t.nota) { <dt>Nota</dt><dd>{{ t.nota }}</dd> }
      </dl>

      <div class="ht-soportes">
        @if (t.radicado_doc_id) {
          <button mat-stroked-button (click)="abrir('RADICADO')"><mat-icon>receipt_long</mat-icon> Soporte del radicado</button>
        }
        @if (t.confirmacion_doc_id) {
          <button mat-stroked-button (click)="abrir('CONFIRMACION')"><mat-icon>verified</mat-icon> Certificado de afiliación</button>
        }
      </div>
      @if (error()) { <p class="ht-mal">{{ error() }}</p> }

      <h3 class="ht-h">Historial</h3>
      @if (cargando()) { <mat-progress-bar mode="indeterminate" /> }
      <ol class="ht-eventos">
        @for (e of eventos(); track e.id) {
          <li>
            <span class="ht-fecha">{{ e.created_at | date:'dd/MM/yyyy HH:mm' }}</span>
            <span><b>{{ estado[e.estado_nuevo] }}</b> — {{ e.detalle }}</span>
            <span class="ht-sub">{{ e.usuario }}</span>
          </li>
        } @empty {
          @if (!cargando()) { <li class="ht-sub">Sin movimientos.</li> }
        }
      </ol>
    </mat-dialog-content>
    <mat-dialog-actions align="end"><button mat-button mat-dialog-close>Cerrar</button></mat-dialog-actions>
  `,
  styles: [`
    .ht { min-width: min(560px, 86vw); }
    .ht-datos { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 14px; margin: 0 0 12px; font-size: 14px; }
    .ht-datos dt { color: var(--text-faint); }
    .ht-datos dd { margin: 0; color: var(--text); overflow-wrap: anywhere; }
    .ht-sub { color: var(--text-faint); font-size: 12px; }
    .ht-mal { color: var(--danger); }
    .ht-soportes { display: flex; gap: 8px; flex-wrap: wrap; }
    .ht-h { margin: 16px 0 6px; font-size: 14px; color: var(--text-2); }
    .ht-eventos { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .ht-eventos li { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-left: 3px solid var(--border-strong); background: var(--surface-2); border-radius: 0 8px 8px 0; font-size: 13px; color: var(--text); }
    .ht-fecha { font-size: 12px; color: var(--text-2); font-variant-numeric: tabular-nums; }
  `],
})
export class HistorialTramiteDialogComponent implements OnInit {
  readonly t = inject<TramiteEps>(MAT_DIALOG_DATA);
  private svc = inject(EnviosEpsService);

  readonly estado = ETIQUETA_ESTADO_TRAMITE;
  readonly canal = ETIQUETA_CANAL;
  readonly empresa = this.t.empresa ? (ETIQUETA_EMPRESA[this.t.empresa] ?? this.t.empresa) : '—';

  eventos = signal<EventoTramiteEps[]>([]);
  cargando = signal(true);
  error = signal<string | null>(null);

  ngOnInit() {
    this.svc.historial(this.t.id).subscribe({
      next: e => { this.eventos.set(e); this.cargando.set(false); },
      error: () => { this.cargando.set(false); this.error.set('No se pudo leer el historial.'); },
    });
  }

  abrir(tipo: 'RADICADO' | 'CONFIRMACION') {
    this.error.set(null);
    this.svc.descargarSoporte(this.t.id, tipo).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      },
      error: () => this.error.set('No se pudo abrir el soporte.'),
    });
  }
}
