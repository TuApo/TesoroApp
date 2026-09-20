/**
 * Alta y edición de una POLÍTICA DE CASINO.
 *
 * Aparte de `DynamicFormDialogComponent` por lo mismo que el calendario: lleva una LISTA
 * —las comidas con su valor— y aquel diálogo solo pinta campos sueltos.
 *
 * El `texto_documento` lo arma el BACKEND: aquí solo se pide la vista previa mientras se
 * edita. El PUT reemplaza también las comidas: las que no viajen se dan de baja.
 */
import { ChangeDetectionStrategy, Component, Inject, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Subject, catchError, debounceTime, of, switchMap } from 'rxjs';

import {
  ComidaCasino, PoliticaCasino, ParametrizacionVacantesService,
} from '../../services/parametrizacion-vacantes/parametrizacion-vacantes.service';

export interface PoliticaCasinoDialogData {
  /** null = alta. En 'duplicar' llega rellena pero se guarda como una NUEVA. */
  politica: PoliticaCasino | null;
  modo?: 'alta' | 'edicion' | 'duplicar';
  /** Cuántos centros usan esta política. Cambiar el valor los cambia a todos. */
  enUso?: number;
}

/** Una comida como se edita: marcada o no, con su valor. */
interface FilaComida {
  comida: ComidaCasino;
  etiqueta: string;
  incluida: boolean;
  valor: number | null;
}

@Component({
  selector: 'app-politica-casino-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatDialogModule, MatButtonModule, MatIconModule, MatFormFieldModule,
    MatInputModule, MatCheckboxModule, MatProgressSpinnerModule,
  ],
  template: `
    <h2 class="pc-titulo" mat-dialog-title>
      @switch (data.modo ?? (data.politica ? 'edicion' : 'alta')) {
        @case ('duplicar') { Duplicar política de casino }
        @case ('edicion') { Editar política de casino }
        @default { Nueva política de casino }
      }
    </h2>

    <!-- El valor es de la POLÍTICA, no del centro: subirlo aquí lo sube en todos los centros
         que la tengan. Es el mismo modelo de los seguros funerarios, y por eso se avisa. -->
    @if ((data.modo ?? 'edicion') === 'edicion' && (data.enUso ?? 0) > 0) {
      <p class="pc-aviso">
        <mat-icon>groups</mat-icon>
        <span>Esta política la usan <strong>{{ data.enUso }}</strong> centro(s): al guardar
          cambia el valor en todos. Si solo quieres otro valor para este centro, cierra y usa
          <strong>Duplicar</strong>.</span>
      </p>
    }

    <mat-dialog-content class="pc-cuerpo">
      <mat-form-field appearance="outline" class="pc-campo">
        <mat-label>Código</mat-label>
        <input matInput maxlength="60" [ngModel]="codigo()" (ngModelChange)="codigo.set($event)"
               placeholder="CASINO_ALMUERZO_5000">
        <mat-hint>Es la clave: dos políticas no pueden llamarse igual.</mat-hint>
      </mat-form-field>

      <mat-checkbox class="pc-check" [checked]="ofrece()" (change)="cambiarOfrece($event.checked)">
        El centro ofrece servicio de casino
      </mat-checkbox>

      @if (!ofrece()) {
        <p class="pc-hint">
          Sin servicio no lleva comidas ni forma de descuento: es la política de «no hay casino»,
          y el documento lo dice así.
        </p>
      } @else {
        <p class="pc-hint">
          Forma de descuento: <strong>quincenal, por nómina y en la liquidación</strong>.
          Es la única que admite el backend hoy.
        </p>

        <table class="pc-comidas">
          <tbody>
            @for (c of comidas(); track c.comida) {
              <tr>
                <td class="pc-col-check">
                  <mat-checkbox [checked]="c.incluida" (change)="alternarComida(c.comida, $event.checked)">
                    {{ c.etiqueta }}
                  </mat-checkbox>
                </td>
                <td class="pc-col-valor">
                  @if (c.incluida) {
                    <mat-form-field appearance="outline" class="pc-valor" subscriptSizing="dynamic">
                      <mat-label>Valor</mat-label>
                      <span matTextPrefix>$&nbsp;</span>
                      <input matInput type="number" min="1" step="1"
                             [ngModel]="c.valor" (ngModelChange)="cambiarValor(c.comida, $event)">
                    </mat-form-field>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>

        @if (!hayComida()) {
          <p class="pc-hint pc-hint-warn">Con servicio hay que marcar al menos una comida con valor mayor que cero.</p>
        }
      }

      <div class="pc-previa">
        <div class="pc-previa-cab">
          <mat-icon>article</mat-icon>
          <span>Texto que sale en los documentos</span>
          @if (calculando()) { <mat-spinner diameter="14"></mat-spinner> }
        </div>
        <div class="pc-previa-texto">{{ previa() || '—' }}</div>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-stroked-button type="button" (click)="ref.close()">Cancelar</button>
      <button mat-flat-button type="button" class="pc-ok" [disabled]="!valido()" (click)="guardar()">Guardar</button>
    </mat-dialog-actions>
  `,
  styles: [`
    :host { display: block; }
    .pc-aviso {
      display: flex; gap: 8px; align-items: flex-start;
      margin: 0 24px 4px; padding: 8px 10px; border-radius: 8px;
      background: var(--warn-bg, #fff4e5); background: var(--warn-bg, light-dark(#fff4e5, #382d24)); color: var(--warn-fg, #b26a00); color: var(--warn-fg, light-dark(#b26a00, #f7d097));
      font-size: 12px; line-height: 1.35;
    }
    .pc-aviso mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .pc-titulo { margin: 0; font-size: 18px; }
    .pc-cuerpo { display: flex; flex-direction: column; gap: 4px; min-width: min(560px, 80vw); padding-top: 8px; }
    .pc-campo { width: 100%; }
    .pc-check { margin: 4px 0 8px; }
    .pc-hint { font-size: 12.5px; opacity: .75; margin: 0 0 8px; }
    .pc-hint-warn { color: var(--warn-fg, #b26a00); color: var(--warn-fg, light-dark(#b26a00, #f7d097)); opacity: 1; }
    .pc-comidas { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
    .pc-comidas td { padding: 4px 0; vertical-align: middle; }
    .pc-col-valor { width: 190px; padding-left: 12px; }
    .pc-valor { width: 100%; }
    .pc-previa { border: 1px dashed rgba(127, 127, 127, .35); border-radius: 10px; padding: 10px 12px; }
    .pc-previa-cab { display: flex; align-items: center; gap: 6px; font-size: 12.5px; opacity: .8; }
    .pc-previa-cab mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .pc-previa-texto { margin-top: 6px; font-size: 13.5px; }
    .pc-ok { background: var(--mt-navy, #16284f); color: #fff; }
  `],
})
export class PoliticaCasinoDialogComponent {
  private svc = inject(ParametrizacionVacantesService);

  /** El orden en que se comen, que es como negocio las lee. */
  private static readonly ORDEN: Array<{ comida: ComidaCasino; etiqueta: string }> = [
    { comida: 'DESAYUNO', etiqueta: 'Desayuno' },
    { comida: 'ALMUERZO', etiqueta: 'Almuerzo' },
    { comida: 'CENA', etiqueta: 'Cena' },
  ];

  codigo = signal('');
  ofrece = signal(true);
  comidas = signal<FilaComida[]>(
    PoliticaCasinoDialogComponent.ORDEN.map(o => ({ ...o, incluida: false, valor: null })));

  previa = signal('');
  calculando = signal(false);

  private peticion = new Subject<Partial<PoliticaCasino>>();

  /** Comidas marcadas con valor entero mayor que cero: lo que el backend acepta. */
  private comidasValidas = computed(() => this.comidas()
    .filter(c => c.incluida && c.valor != null && Number.isFinite(c.valor) && Math.trunc(c.valor!) > 0)
    .map(c => ({ comida: c.comida, valor: Math.trunc(c.valor!) })));

  hayComida = computed(() => this.comidasValidas().length > 0);

  valido = computed(() => {
    if (!this.codigo().trim()) return false;
    if (!this.ofrece()) return true;
    // Una comida marcada sin valor bloquea: guardarla la perdería en silencio.
    const marcadas = this.comidas().filter(c => c.incluida).length;
    return this.hayComida() && this.comidasValidas().length === marcadas;
  });

  cuerpo = computed<Partial<PoliticaCasino>>(() => this.ofrece()
    ? {
        codigo: this.codigo().trim(),
        ofrece_servicio: true,
        forma_descuento: 'QUINCENAL_NOMINA_Y_LIQUIDACION',
        comidas: this.comidasValidas(),
      }
    : { codigo: this.codigo().trim(), ofrece_servicio: false });

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: PoliticaCasinoDialogData,
    public ref: MatDialogRef<PoliticaCasinoDialogComponent, Partial<PoliticaCasino> | undefined>,
  ) {
    const p = data.politica;
    if (p) {
      // En 'duplicar' se hereda todo menos el código: dos políticas no pueden llamarse igual.
      this.codigo.set(data.modo === 'duplicar' ? '' : (p.codigo ?? ''));
      this.ofrece.set(!!p.ofrece_servicio);
      const actuales = new Map((p.comidas ?? []).map(c => [c.comida, c.valor]));
      this.comidas.set(PoliticaCasinoDialogComponent.ORDEN.map(o => ({
        ...o,
        incluida: actuales.has(o.comida),
        valor: actuales.get(o.comida) ?? null,
      })));
      this.previa.set(p.texto_documento ?? '');
    }

    this.peticion.pipe(
      debounceTime(300),
      switchMap(body => this.svc.vistaPreviaPoliticaCasino(body)
        .pipe(catchError(() => of({ texto_documento: '' })))),
      takeUntilDestroyed(),
    ).subscribe(r => { this.previa.set(r?.texto_documento ?? ''); this.calculando.set(false); });

    effect(() => {
      const body = this.cuerpo();
      if (!this.valido()) return;
      this.calculando.set(true);
      this.peticion.next(body);
    });
  }

  /** Quitar el servicio borra las comidas: el backend rechaza una política sin servicio con comidas. */
  cambiarOfrece(v: boolean): void {
    this.ofrece.set(v);
    if (!v) this.comidas.set(this.comidas().map(c => ({ ...c, incluida: false, valor: null })));
    this.previa.set('');
  }

  alternarComida(comida: ComidaCasino, incluida: boolean): void {
    this.comidas.set(this.comidas().map(c => c.comida === comida ? { ...c, incluida } : c));
  }

  cambiarValor(comida: ComidaCasino, valor: number | null): void {
    this.comidas.set(this.comidas().map(c => c.comida === comida ? { ...c, valor } : c));
  }

  guardar(): void {
    if (this.valido()) this.ref.close(this.cuerpo());
  }
}
