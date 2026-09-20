/**
 * Alta y edición de un CALENDARIO DE PAGO.
 *
 * Existe aparte de `DynamicFormDialogComponent` porque un calendario de tipo
 * FECHAS_ESPECIFICAS lleva una LISTA de fechas, y aquel diálogo solo sabe pintar campos
 * sueltos.
 *
 * El `texto_documento` y el `estado` NO se calculan aquí: el texto se pide al backend
 * (vista previa) cada vez que cambia el formulario, y el estado es el que devolvió el
 * listado. Duplicar esa lógica en Angular sería tener dos versiones de la misma frase.
 */
import { ChangeDetectionStrategy, Component, Inject, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Subject, catchError, debounceTime, of, switchMap } from 'rxjs';

import {
  CalendarioPago, ParametrizacionVacantesService, TipoCalendarioPago,
} from '../../services/parametrizacion-vacantes/parametrizacion-vacantes.service';

export interface CalendarioPagoDialogData {
  /** null = alta. En 'duplicar' llega relleno pero se guarda como uno NUEVO. */
  calendario: CalendarioPago | null;
  modo?: 'alta' | 'edicion' | 'duplicar';
  /** Cuántos grupos de centro usan este calendario. Editar los cambia a todos. */
  enUso?: number;
}

@Component({
  selector: 'app-calendario-pago-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatDialogModule, MatButtonModule, MatIconModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatTooltipModule, MatProgressSpinnerModule,
  ],
  template: `
    <h2 class="cp-titulo" mat-dialog-title>
      @switch (data.modo ?? (data.calendario ? 'edicion' : 'alta')) {
        @case ('duplicar') { Duplicar calendario de pago }
        @case ('edicion') { Editar calendario de pago }
        @default { Nuevo calendario de pago }
      }
    </h2>

    <!-- Las fechas de pago son del CALENDARIO, no del centro: cambiarlas alcanza a todos los
         que lo usan. Se dice antes de guardar, con la salida (duplicar) al lado. -->
    @if ((data.modo ?? 'edicion') === 'edicion' && (data.enUso ?? 0) > 0) {
      <p class="cp-aviso">
        <mat-icon>groups</mat-icon>
        <span>Este calendario lo usan <strong>{{ data.enUso }}</strong> grupo(s) de centro: al
          guardar cambian todos. Si solo quieres otras fechas para este centro, cierra y usa
          <strong>Duplicar</strong>.</span>
      </p>
    }

    <mat-dialog-content class="cp-cuerpo">
      <mat-form-field appearance="outline" class="cp-campo">
        <mat-label>Código</mat-label>
        <input matInput maxlength="60" [ngModel]="codigo()" (ngModelChange)="codigo.set($event)"
               placeholder="QUINCENAL_15_30">
        <mat-hint>Es la clave: dos calendarios no pueden llamarse igual.</mat-hint>
      </mat-form-field>

      <mat-form-field appearance="outline" class="cp-campo">
        <mat-label>Tipo</mat-label>
        <mat-select [ngModel]="tipo()" (ngModelChange)="cambiarTipo($event)">
          <mat-option value="RECURRENTE_MENSUAL">Recurrente mensual (los mismos dos días cada mes)</mat-option>
          <mat-option value="FECHAS_ESPECIFICAS">Fechas específicas (un calendario con fecha de caducidad)</mat-option>
        </mat-select>
      </mat-form-field>

      @if (tipo() === 'RECURRENTE_MENSUAL') {
        <div class="cp-dias">
          <mat-form-field appearance="outline" class="cp-dia">
            <mat-label>Primer día de pago</mat-label>
            <input matInput type="number" min="1" max="31"
                   [ngModel]="dia1()" (ngModelChange)="dia1.set($event)">
          </mat-form-field>
          <mat-form-field appearance="outline" class="cp-dia">
            <mat-label>Segundo día de pago</mat-label>
            <input matInput type="number" min="1" max="31"
                   [ngModel]="dia2()" (ngModelChange)="dia2.set($event)">
          </mat-form-field>
        </div>
        <p class="cp-hint">Del 1 al 31, y el primero antes que el segundo. No lleva fechas.</p>
      } @else {
        <div class="cp-agregar">
          <mat-form-field appearance="outline" class="cp-campo">
            <mat-label>Agregar fecha de pago</mat-label>
            <input matInput type="date" [ngModel]="nuevaFecha()" (ngModelChange)="nuevaFecha.set($event)">
          </mat-form-field>
          <button mat-stroked-button type="button" (click)="agregarFecha()" [disabled]="!nuevaFecha()">
            <mat-icon>add</mat-icon><span>Agregar</span>
          </button>
        </div>

        @if (!fechas().length) {
          <p class="cp-hint cp-hint-warn">Todavía no hay fechas. Un calendario de fechas específicas necesita al menos una.</p>
        } @else {
          <ul class="cp-fechas">
            @for (f of fechas(); track f) {
              <li class="cp-fecha">
                <span>{{ f }}</span>
                <button mat-icon-button type="button" (click)="quitarFecha(f)" matTooltip="Quitar esta fecha">
                  <mat-icon>close</mat-icon>
                </button>
              </li>
            }
          </ul>
          <p class="cp-hint">
            El calendario queda <strong>vencido</strong> cuando pasa la última fecha; lo decide el
            backend, no esta pantalla.
          </p>
        }
      }

      <div class="cp-previa">
        <div class="cp-previa-cab">
          <mat-icon>article</mat-icon>
          <span>Texto que sale en los documentos</span>
          @if (calculando()) { <mat-spinner diameter="14"></mat-spinner> }
          @if (data.calendario?.estado; as est) {
            <span class="cp-badge" [class.cp-badge-warn]="est === 'VENCIDO'">{{ est }}</span>
          }
        </div>
        <div class="cp-previa-texto">{{ previa() || '—' }}</div>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-stroked-button type="button" (click)="ref.close()">Cancelar</button>
      <button mat-flat-button type="button" class="cp-ok" [disabled]="!valido()" (click)="guardar()">Guardar</button>
    </mat-dialog-actions>
  `,
  styles: [`
    :host { display: block; }
    .cp-aviso {
      display: flex; gap: 8px; align-items: flex-start;
      margin: 0 24px 4px; padding: 8px 10px; border-radius: 8px;
      background: var(--warn-bg, #fff4e5); background: var(--warn-bg, light-dark(#fff4e5, #382d24)); color: var(--warn-fg, #b26a00); color: var(--warn-fg, light-dark(#b26a00, #f7d097));
      font-size: 12px; line-height: 1.35;
    }
    .cp-aviso mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .cp-titulo { margin: 0; font-size: 18px; }
    .cp-cuerpo { display: flex; flex-direction: column; gap: 4px; min-width: min(560px, 80vw); padding-top: 8px; }
    .cp-campo { width: 100%; }
    .cp-dias { display: flex; gap: 12px; }
    .cp-dia { flex: 1 1 0; }
    .cp-agregar { display: flex; align-items: flex-start; gap: 8px; }
    .cp-agregar button { margin-top: 8px; }
    .cp-hint { font-size: 12.5px; opacity: .75; margin: 0 0 8px; }
    .cp-hint-warn { color: var(--warn-fg, #b26a00); color: var(--warn-fg, light-dark(#b26a00, #f7d097)); opacity: 1; }
    .cp-fechas { list-style: none; margin: 0 0 8px; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
    .cp-fecha {
      display: flex; align-items: center; gap: 2px; padding: 2px 2px 2px 10px;
      border: 1px solid rgba(127, 127, 127, .3); border-radius: 999px; font-size: 13px;
      font-variant-numeric: tabular-nums;
    }
    .cp-fecha button { width: 28px; height: 28px; line-height: 28px; }
    .cp-fecha mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .cp-previa { border: 1px dashed rgba(127, 127, 127, .35); border-radius: 10px; padding: 10px 12px; }
    .cp-previa-cab { display: flex; align-items: center; gap: 6px; font-size: 12.5px; opacity: .8; }
    .cp-previa-cab mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .cp-previa-texto { margin-top: 6px; font-size: 13.5px; }
    .cp-badge {
      margin-left: auto; font-size: 11px; padding: 1px 8px; border-radius: 999px;
      background: var(--ok-bg, #e6f4ea); background: var(--ok-bg, light-dark(#e6f4ea, #193434)); color: var(--ok-fg, #2e7d32); color: var(--ok-fg, light-dark(#2e7d32, #ade1b0));
    }
    .cp-badge-warn { background: var(--warn-bg, #fff4e5); background: var(--warn-bg, light-dark(#fff4e5, #382d24)); color: var(--warn-fg, #b26a00); color: var(--warn-fg, light-dark(#b26a00, #f7d097)); }
    .cp-ok { background: var(--mt-navy, #16284f); color: #fff; }
  `],
})
export class CalendarioPagoDialogComponent {
  private svc = inject(ParametrizacionVacantesService);

  codigo = signal('');
  tipo = signal<TipoCalendarioPago>('RECURRENTE_MENSUAL');
  dia1 = signal<number | null>(null);
  dia2 = signal<number | null>(null);
  fechas = signal<string[]>([]);
  nuevaFecha = signal<string>('');

  /** Lo que devuelve la vista previa del backend. Aquí NO se arma ningún texto. */
  previa = signal('');
  calculando = signal(false);

  private peticion = new Subject<Partial<CalendarioPago>>();

  /** Lo mínimo para que el backend no rechace de plano; lo demás lo valida él. */
  valido = computed(() => {
    if (!this.codigo().trim()) return false;
    if (this.tipo() === 'RECURRENTE_MENSUAL') {
      const d1 = this.dia1(); const d2 = this.dia2();
      if (d1 == null || d2 == null) return false;
      return d1 >= 1 && d1 <= 31 && d2 >= 1 && d2 <= 31 && d1 < d2;
    }
    return this.fechas().length > 0;
  });

  /** El cuerpo del POST/PUT. El PUT REEMPLAZA: lo que no vaya aquí queda vacío. */
  cuerpo = computed<Partial<CalendarioPago>>(() => this.tipo() === 'RECURRENTE_MENSUAL'
    ? { codigo: this.codigo().trim(), tipo: 'RECURRENTE_MENSUAL', dia_pago_1: this.dia1(), dia_pago_2: this.dia2() }
    : { codigo: this.codigo().trim(), tipo: 'FECHAS_ESPECIFICAS', fechas: this.fechas() });

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: CalendarioPagoDialogData,
    public ref: MatDialogRef<CalendarioPagoDialogComponent, Partial<CalendarioPago> | undefined>,
  ) {
    const c = data.calendario;
    if (c) {
      // En 'duplicar' se hereda todo menos el código: dos calendarios no pueden llamarse igual.
      this.codigo.set(data.modo === 'duplicar' ? '' : (c.codigo ?? ''));
      this.tipo.set(c.tipo ?? 'RECURRENTE_MENSUAL');
      this.dia1.set(c.dia_pago_1 ?? null);
      this.dia2.set(c.dia_pago_2 ?? null);
      this.fechas.set([...(c.fechas ?? [])].sort());
      this.previa.set(c.texto_documento ?? '');
    }

    this.peticion.pipe(
      debounceTime(300),
      switchMap(body => this.svc.vistaPreviaCalendarioPago(body)
        .pipe(catchError(() => of({ texto_documento: '' })))),
      takeUntilDestroyed(),
    ).subscribe(r => { this.previa.set(r?.texto_documento ?? ''); this.calculando.set(false); });

    // Cada cambio pide el texto al backend. Con el formulario incompleto no se pide nada:
    // el backend respondería un 400 que no aporta.
    effect(() => {
      const body = this.cuerpo();
      if (!this.valido()) return;
      this.calculando.set(true);
      this.peticion.next(body);
    });
  }

  /** Cambiar de tipo limpia lo del otro: el backend rechaza días y fechas a la vez. */
  cambiarTipo(t: TipoCalendarioPago): void {
    this.tipo.set(t);
    if (t === 'RECURRENTE_MENSUAL') this.fechas.set([]);
    else { this.dia1.set(null); this.dia2.set(null); }
    this.previa.set('');
  }

  agregarFecha(): void {
    const f = this.nuevaFecha();
    if (!f) return;
    if (!this.fechas().includes(f)) this.fechas.set([...this.fechas(), f].sort());
    this.nuevaFecha.set('');
  }

  quitarFecha(f: string): void {
    this.fechas.set(this.fechas().filter(x => x !== f));
  }

  guardar(): void {
    if (this.valido()) this.ref.close(this.cuerpo());
  }
}
