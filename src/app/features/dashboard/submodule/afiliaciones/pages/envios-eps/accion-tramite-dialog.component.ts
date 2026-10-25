import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';

import { EnviosEpsService } from '../../services/envios-eps.service';
import { CanalEps, ETIQUETA_CANAL, ResultadoMasivoEps, TramiteEps } from '../../models/envios-eps.models';

export type AccionTramite = 'radicar' | 'confirmar' | 'rechazar' | 'reabrir';

export interface AccionTramiteData {
  accion: AccionTramite;
  tramites: TramiteEps[];
  /** La EPS de todos los marcados suele confirmar en el acto: se marca «directa» de entrada. */
  sugerirDirecta?: boolean;
}

const TITULO: Record<AccionTramite, string> = {
  radicar: 'Registrar radicado',
  confirmar: 'Confirmar afiliación',
  rechazar: 'Devuelta por la EPS',
  reabrir: 'Reabrir para reenviar',
};

/**
 * Una acción del seguimiento sobre uno o varios trámites. El soporte (pantallazo de la
 * plataforma, acuse, certificado) es opcional y se sube a CADA trámite marcado: owner = la
 * cédula de cada persona en la gestión documental.
 */
@Component({
  selector: 'app-accion-tramite-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatDialogModule, MatButtonModule, MatButtonToggleModule, MatCheckboxModule,
    MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ titulo }}</h2>
    <mat-dialog-content class="at">
      @if (trabajando()) { <mat-progress-bar mode="indeterminate" /> }
      <p class="at-quien">
        {{ data.tramites.length === 1 ? data.tramites[0].nombre + ' · ' + data.tramites[0].cedula : data.tramites.length + ' personas marcadas' }}
      </p>

      @switch (data.accion) {
        @case ('radicar') {
          <p class="at-ayuda">Lo que se mandó a la EPS o al tramitador (registro en plataforma, ventanilla o correo por fuera).</p>
          <div class="at-grid">
            <mat-form-field appearance="outline">
              <mat-label>Número de radicado</mat-label>
              <input matInput [(ngModel)]="numero" maxlength="80">
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Fecha</mat-label>
              <input matInput type="date" [(ngModel)]="fecha">
            </mat-form-field>
          </div>
          <mat-button-toggle-group [(ngModel)]="canal" aria-label="Canal" class="at-canal">
            @for (c of canales; track c) { <mat-button-toggle [value]="c">{{ etiquetaCanal[c] }}</mat-button-toggle> }
          </mat-button-toggle-group>
        }
        @case ('confirmar') {
          <p class="at-ayuda">Llegó la confirmación de la EPS. Si nunca se radicó porque la EPS la confirmó en el acto, marque «confirmación directa».</p>
          <mat-form-field appearance="outline">
            <mat-label>Fecha de la confirmación</mat-label>
            <input matInput type="date" [(ngModel)]="fecha">
          </mat-form-field>
          @if (hayPorEnviar) {
            <mat-checkbox [(ngModel)]="directa">Confirmación directa (sin radicado previo)</mat-checkbox>
          }
        }
        @case ('rechazar') {
          <mat-form-field appearance="outline" class="at-ancho">
            <mat-label>Motivo de la devolución</mat-label>
            <textarea matInput [(ngModel)]="motivo" rows="3" maxlength="500" required></textarea>
          </mat-form-field>
        }
        @case ('reabrir') {
          <p class="at-ayuda">Vuelven a «por enviar» para salir en el próximo envío. El radicado y la devolución quedan en el historial.</p>
        }
      }

      @if (data.accion === 'radicar' || data.accion === 'confirmar') {
        <div class="at-archivo">
          <button mat-stroked-button type="button" (click)="selector.click()">
            <mat-icon>attach_file</mat-icon> {{ archivo() ? archivo()!.name : (data.accion === 'radicar' ? 'Soporte del radicado (opcional)' : 'Certificado de afiliación (opcional)') }}
          </button>
          @if (archivo()) { <button mat-icon-button type="button" (click)="archivo.set(null)" aria-label="Quitar archivo"><mat-icon>close</mat-icon></button> }
          <input #selector type="file" hidden accept=".pdf,image/*" (change)="elegir($event)">
        </div>
      }

      @if (data.accion !== 'rechazar') {
        <mat-form-field appearance="outline" class="at-ancho">
          <mat-label>Nota</mat-label>
          <input matInput [(ngModel)]="nota" maxlength="500">
        </mat-form-field>
      }

      @if (error()) { <p class="at-error" role="alert"><mat-icon>error</mat-icon> {{ error() }}</p> }
      @if (resultado(); as r) {
        <p class="at-ok"><mat-icon>check_circle</mat-icon> {{ r.ok }} de {{ r.procesados }} aplicados.</p>
        @if (r.detalles.length) { <ul class="at-detalles">@for (d of r.detalles; track $index) { <li>{{ d }}</li> }</ul> }
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (resultado()) {
        <button mat-flat-button [mat-dialog-close]="true">Cerrar</button>
      } @else {
        <button mat-button mat-dialog-close>Cancelar</button>
        <button mat-flat-button (click)="aplicar()" [disabled]="trabajando() || (data.accion === 'rechazar' && !motivo.trim())">Aplicar</button>
      }
    </mat-dialog-actions>
  `,
  styles: [`
    .at { display: flex; flex-direction: column; gap: 6px; min-width: min(520px, 86vw); }
    .at-quien { margin: 0 0 4px; font-weight: 600; color: var(--text); }
    .at-ayuda { margin: 0 0 8px; font-size: 13px; color: var(--text-2); }
    .at-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 12px; }
    .at-ancho { width: 100%; }
    .at-canal { margin-bottom: 10px; flex-wrap: wrap; }
    .at-archivo { display: flex; align-items: center; gap: 4px; margin: 4px 0 10px; min-width: 0; }
    .at-archivo button[mat-stroked-button] { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
    .at-error { display: flex; gap: 6px; align-items: center; color: var(--danger); background: var(--danger-bg); padding: 8px 10px; border-radius: 8px; margin: 0; }
    .at-ok { display: flex; gap: 6px; align-items: center; color: var(--success); margin: 4px 0; }
    .at-detalles { margin: 0; padding-left: 20px; font-size: 13px; color: var(--warning); max-height: 160px; overflow-y: auto; }
    @media (max-width: 600px) { .at-grid { grid-template-columns: minmax(0, 1fr); } }
  `],
})
export class AccionTramiteDialogComponent {
  readonly data = inject<AccionTramiteData>(MAT_DIALOG_DATA);
  private ref = inject(MatDialogRef<AccionTramiteDialogComponent, boolean>);
  private svc = inject(EnviosEpsService);

  readonly titulo = TITULO[this.data.accion];
  readonly canales: CanalEps[] = ['PLATAFORMA', 'CORREO', 'MANUAL'];
  readonly etiquetaCanal = ETIQUETA_CANAL;
  readonly hayPorEnviar = this.data.tramites.some(t => t.estado === 'POR_ENVIAR');

  numero = this.data.tramites.length === 1 ? (this.data.tramites[0].radicado_numero ?? '') : '';
  fecha = hoyIso();
  canal: CanalEps = (this.data.tramites[0]?.canal as CanalEps) ?? 'PLATAFORMA';
  directa = !!this.data.sugerirDirecta && this.hayPorEnviar;
  motivo = '';
  nota = '';

  archivo = signal<File | null>(null);
  trabajando = signal(false);
  error = signal<string | null>(null);
  resultado = signal<ResultadoMasivoEps | null>(null);

  elegir(ev: Event) {
    const f = (ev.target as HTMLInputElement).files?.[0] ?? null;
    if (f && f.size > 10 * 1024 * 1024) { this.error.set('El archivo pasa de 10 MB.'); return; }
    this.archivo.set(f);
  }

  async aplicar() {
    const ids = this.data.tramites.map(t => t.id);
    const nota = this.nota.trim() || null;
    this.trabajando.set(true);
    this.error.set(null);
    try {
      let r: ResultadoMasivoEps;
      switch (this.data.accion) {
        case 'radicar':
          r = await firstValueFrom(this.svc.radicar(ids, this.numero.trim() || null, this.fecha || null, this.canal, nota));
          break;
        case 'confirmar':
          r = await firstValueFrom(this.svc.confirmar(ids, this.fecha || null, this.directa, nota));
          break;
        case 'rechazar':
          r = await firstValueFrom(this.svc.rechazar(ids, this.motivo.trim()));
          break;
        default:
          r = await firstValueFrom(this.svc.reabrir(ids, nota));
      }
      // El soporte va después de la transición y solo a los que sí se movieron: los que el
      // backend rechazó traen su motivo en r.detalles y no deben quedar con un archivo suelto.
      const f = this.archivo();
      if (f && r.ok > 0 && (this.data.accion === 'radicar' || this.data.accion === 'confirmar')) {
        const tipo = this.data.accion === 'radicar' ? 'RADICADO' : 'CONFIRMACION';
        const omitidos = new Set(r.detalles.map(d => d.split(' ')[0]));
        const fallos: string[] = [];
        for (const t of this.data.tramites.filter(x => !omitidos.has(x.cedula))) {
          try {
            await firstValueFrom(this.svc.subirSoporte(t.id, tipo, f));
          } catch (e) {
            fallos.push(`${t.cedula}: ${(e as HttpErrorResponse).error?.error ?? 'no se pudo subir el soporte'}`);
          }
        }
        r = { ...r, detalles: [...r.detalles, ...fallos] };
      }
      this.resultado.set(r);
      this.ref.disableClose = true;
    } catch (e) {
      this.error.set((e as HttpErrorResponse).error?.error ?? 'No se pudo aplicar la acción.');
    } finally {
      this.trabajando.set(false);
    }
  }
}

function hoyIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
