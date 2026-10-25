import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';

import { EnviosEpsService } from '../../services/envios-eps.service';
import {
  CanalEps, ETIQUETA_CANAL, ETIQUETA_EMPRESA, PreviaCorreoEps, ResultadoEnvioEps,
} from '../../models/envios-eps.models';

export interface EnvioEpsDialogData {
  epsKey: string;
  epsNombre: string;
  canal: CanalEps;
  /** Ids de trámite marcados; vacío = todos los listos de la EPS. */
  tramiteIds: number[];
  modoEnvio: string;
}

/**
 * Previa y envío de un lote a una EPS. Por CORREO muestra cada correo tal como saldría (uno por
 * temporal y por tope de personas) y lo envía; por PLATAFORMA o MANUAL no hay correo: el botón
 * deja constancia de que el usuario ya registró a esas personas y las pasa a «radicada».
 */
@Component({
  selector: 'app-envio-eps-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule],
  template: `
    <h2 mat-dialog-title>{{ porCorreo ? 'Enviar a ' : 'Registrar en ' }}{{ data.epsNombre }}</h2>
    <mat-dialog-content class="ev">
      @if (cargando()) { <mat-progress-bar mode="indeterminate" /> }

      @if (data.modoEnvio !== 'activo' && porCorreo) {
        <p class="ev-aviso ev-aviso-warn" role="status">
          <mat-icon>science</mat-icon>
          <span>Modo <b>{{ data.modoEnvio }}</b>: el correo va al buzón de pruebas, no a la EPS, y las personas
          siguen en «por enviar».</span>
        </p>
      }

      @if (error()) { <p class="ev-aviso ev-aviso-error" role="alert"><mat-icon>error</mat-icon> {{ error() }}</p> }

      @if (resultado(); as r) {
        <div class="ev-resultado">
          <p><b>{{ r.enviados }}</b> de {{ r.correos }} {{ porCorreo ? 'correo(s) enviados' : 'registro(s) guardados' }}
             · <b>{{ r.personas }}</b> persona(s) {{ r.modo_envio === 'activo' || !porCorreo ? 'pasaron a radicada' : 'en el correo de prueba' }}.</p>
          @for (e of r.envios; track e.id) {
            <p class="ev-linea" [class.ev-mal]="e.estado === 'FALLIDO'">
              <mat-icon>{{ e.estado === 'FALLIDO' ? 'error' : 'check_circle' }}</mat-icon>
              Envío #{{ e.id }} · {{ empresa(e.empresa) }} · {{ e.total_personas }} persona(s) · {{ e.estado }}
              @if (e.motivo) { — {{ e.motivo }} }
            </p>
          }
          @if (r.avisos.length) {
            <ul class="ev-avisos">@for (a of r.avisos; track $index) { <li>{{ a }}</li> }</ul>
          }
        </div>
      } @else if (previas().length) {
        <p class="ev-resumen">
          {{ previas().length }} {{ porCorreo ? 'correo(s)' : 'grupo(s)' }} · {{ totalPersonas() }} persona(s) · {{ etiquetaCanal }}
        </p>
        @if (previas()[0].avisos.length) {
          <ul class="ev-avisos">@for (a of previas()[0].avisos; track $index) { <li>{{ a }}</li> }</ul>
        }
        <div class="ev-pestanas" role="tablist">
          @for (p of previas(); track $index) {
            <button type="button" role="tab" class="ev-pestana" [class.ev-activa]="$index === indice()"
                    [attr.aria-selected]="$index === indice()" (click)="indice.set($index)">
              {{ empresa(p.empresa) }} · {{ p.personas }}
            </button>
          }
        </div>
        @if (actual(); as p) {
          @if (porCorreo) {
            <dl class="ev-meta">
              <dt>Para</dt><dd>{{ p.destinatario }}</dd>
              @if (p.cc.length) { <dt>Copia</dt><dd>{{ p.cc.join(', ') }}</dd> }
              <dt>Asunto</dt><dd>{{ p.asunto }}</dd>
              <dt>Adjuntos</dt><dd>{{ p.adjuntos.length }} — {{ p.adjuntos.slice(0, 6).join(', ') }}{{ p.adjuntos.length > 6 ? '…' : '' }}</dd>
            </dl>
          }
          <div class="ev-cuerpo" [innerHTML]="cuerpo()"></div>
        }
        <mat-form-field appearance="outline" class="ev-nota">
          <mat-label>{{ porCorreo ? 'Nota interna (no sale en el correo)' : 'Nota del registro (radicado, observaciones)' }}</mat-label>
          <input matInput [(ngModel)]="nota" maxlength="500">
        </mat-form-field>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (resultado()) {
        <button mat-flat-button [mat-dialog-close]="resultado()">Cerrar</button>
      } @else {
        <button mat-button mat-dialog-close>Cancelar</button>
        <button mat-flat-button (click)="enviar()" [disabled]="cargando() || !previas().length">
          <mat-icon>{{ porCorreo ? 'send' : 'task_alt' }}</mat-icon>
          {{ porCorreo ? 'Enviar ' + previas().length + ' correo(s)' : 'Marcar como registradas' }}
        </button>
      }
    </mat-dialog-actions>
  `,
  styles: [`
    .ev { display: flex; flex-direction: column; gap: 10px; min-width: min(860px, 90vw); }
    .ev-aviso { display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px; border-radius: 8px; margin: 0; }
    .ev-aviso-warn { background: var(--warn-bg); color: var(--warning); }
    .ev-aviso-error { background: var(--danger-bg); color: var(--danger); }
    .ev-resumen { margin: 0; color: var(--text-2); }
    .ev-avisos { margin: 0; padding-left: 20px; max-height: 140px; overflow-y: auto; font-size: 13px; color: var(--warning); }
    .ev-pestanas { display: flex; gap: 6px; flex-wrap: wrap; }
    .ev-pestana { border: 1px solid var(--border); background: var(--surface-2); color: var(--text); border-radius: 999px; padding: 4px 12px; cursor: pointer; font: inherit; font-size: 13px; }
    .ev-pestana.ev-activa { background: var(--brand-blue); color: #fff; border-color: var(--brand-blue); }
    .ev-meta { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 2px 12px; margin: 0; font-size: 13px; }
    .ev-meta dt { color: var(--text-faint); }
    .ev-meta dd { margin: 0; overflow-wrap: anywhere; color: var(--text); }
    /* El correo se ve como lo verá la EPS: fondo blanco fijo aunque la app esté en oscuro. */
    .ev-cuerpo { background: #ffffff; color: #1f2937; border: 1px solid var(--border); border-radius: 8px; padding: 12px; max-height: 46vh; overflow: auto; }
    .ev-nota { width: 100%; }
    .ev-resultado p { margin: 0 0 6px; }
    .ev-linea { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--success); }
    .ev-linea.ev-mal { color: var(--danger); }
    .ev-linea mat-icon { font-size: 18px; width: 18px; height: 18px; }
  `],
})
export class EnvioEpsDialogComponent implements OnInit {
  readonly data = inject<EnvioEpsDialogData>(MAT_DIALOG_DATA);
  private ref = inject(MatDialogRef<EnvioEpsDialogComponent, ResultadoEnvioEps | undefined>);
  private svc = inject(EnviosEpsService);
  private sanitizer = inject(DomSanitizer);

  readonly porCorreo = this.data.canal === 'CORREO';
  readonly etiquetaCanal = ETIQUETA_CANAL[this.data.canal];

  cargando = signal(true);
  error = signal<string | null>(null);
  previas = signal<PreviaCorreoEps[]>([]);
  indice = signal(0);
  resultado = signal<ResultadoEnvioEps | null>(null);
  nota = '';

  actual = computed(() => this.previas()[this.indice()] ?? null);
  totalPersonas = computed(() => this.previas().reduce((s, p) => s + p.personas, 0));
  /**
   * El HTML lo arma ms-hr escapando cada dato (HtmlUtils.htmlEscape): es el mismo cuerpo que
   * saldrá, así que se muestra tal cual en vez de dejar que Angular le quite los estilos.
   */
  cuerpo = computed<SafeHtml>(() => this.sanitizer.bypassSecurityTrustHtml(this.actual()?.cuerpo_html ?? ''));

  ngOnInit() {
    this.svc.previa(this.data.epsKey, null, this.data.tramiteIds).subscribe({
      next: r => { this.previas.set(r.correos); this.cargando.set(false); },
      error: (e: HttpErrorResponse) => { this.error.set(e.error?.error ?? 'No se pudo armar la previa.'); this.cargando.set(false); },
    });
  }

  enviar() {
    this.cargando.set(true);
    this.error.set(null);
    this.svc.enviar(this.data.epsKey, null, this.data.tramiteIds, this.nota.trim() || null).subscribe({
      next: r => { this.resultado.set(r); this.cargando.set(false); this.ref.disableClose = true; },
      error: (e: HttpErrorResponse) => { this.error.set(e.error?.error ?? 'No se pudo enviar.'); this.cargando.set(false); },
    });
  }

  empresa(e: string | null): string {
    return e ? (ETIQUETA_EMPRESA[e] ?? e) : 'Sin temporal';
  }
}
