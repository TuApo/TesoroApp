/**
 * Prompt de resultado de etapa (pasó / no pasó / no se presentó) como MatDialog.
 *
 * Antes esto era un SweetAlert. Abierto desde una página funcionaba, pero
 * abierto DESDE otro diálogo quedaba por detrás: Swal se cuelga de `body` y el
 * orden de pintado depende de z-index y stacking contexts que el CDK maneja con
 * capas (`@layer cdk-overlay`). Subir el z-index y montarlo dentro del overlay
 * no bastó en la app real.
 *
 * Con MatDialog el problema desaparece por diseño: cada diálogo abre su propio
 * pane en el mismo contenedor del CDK y, al agregarse después, queda encima del
 * que lo abrió. Es el mismo mecanismo que ya usa el resto de la app.
 *
 * Lo usan el pipeline (pills del header) y el cumplimiento de la vacante, para
 * prueba técnica y para examen médico: una sola implementación.
 *
 * Resultado y motivo van en UN solo paso: el motivo aparece cuando hace falta y
 * es obligatorio, así no se puede guardar un "no pasó" sin explicación.
 */
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Inject, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

import type { EtapaConResultado, ResultadoEtapa, ResultadoEtapaPrevio } from './resultado-etapa.dialog';

export interface ResultadoEtapaDialogData {
  etapa: EtapaConResultado;
  previo: ResultadoEtapaPrevio;
  nombreCandidato?: string | null;
}

export interface ResultadoEtapaDialogResult {
  resultado: ResultadoEtapa;
  motivo: string;
}

const TEXTOS: Record<EtapaConResultado, {
  titulo: string;
  preguntaNoPaso: string;
  preguntaNoShow: string;
  ejemploNoShow: string;
}> = {
  prueba: {
    titulo: 'Resultado de la prueba técnica',
    preguntaNoPaso: '¿Por qué no pasó la prueba técnica?',
    preguntaNoShow: '¿Por qué no se presentó a la prueba técnica?',
    ejemploNoShow: 'Avisó que no podía, no contestó, se retiró del proceso...',
  },
  examen: {
    titulo: 'Resultado del examen médico',
    preguntaNoPaso: '¿Por qué no pasó el examen médico?',
    preguntaNoShow: '¿Por qué no se presentó al examen médico?',
    ejemploNoShow: 'No asistió a la cita, la reprogramó, se retiró del proceso...',
  },
};

@Component({
  selector: 'app-resultado-etapa-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule, MatDialogModule, MatButtonModule,
    MatFormFieldModule, MatIconModule, MatInputModule,
  ],
  template: `
    <div class="re-wrap">
      <!-- Encabezado con el color de la etapa: azul para prueba técnica,
           verde azulado para examen médico. Ancla visualmente el diálogo. -->
      <header class="re-head" [class.re-head-examen]="data.etapa === 'examen'">
        <span class="re-head-ic">
          <mat-icon>{{ data.etapa === 'examen' ? 'medical_information' : 'assignment_ind' }}</mat-icon>
        </span>
        <div class="re-head-txt">
          <h2>{{ textos.titulo }}</h2>
          @if (data.nombreCandidato) {
            <p><mat-icon>person</mat-icon>{{ data.nombreCandidato }}</p>
          }
        </div>
        <button mat-icon-button class="re-cerrar" (click)="cancelar()" aria-label="Cerrar">
          <mat-icon>close</mat-icon>
        </button>
      </header>

      <mat-dialog-content class="re-body">
        <p class="re-label">Selecciona el resultado</p>

        <!-- Tarjetas en vez de radios: el color y el icono dicen el resultado
             de un vistazo y el área de click es toda la fila. -->
        <div class="re-opciones" role="radiogroup">
          @for (o of opciones; track o.valor) {
            <button type="button" class="re-op re-op-{{ o.tono }}"
              role="radio" [attr.aria-checked]="resultado() === o.valor"
              [class.activa]="resultado() === o.valor"
              (click)="elegir(o.valor)">
              <span class="re-op-barra" aria-hidden="true"></span>
              <span class="re-op-ic"><mat-icon>{{ o.icono }}</mat-icon></span>
              <span class="re-op-txt">
                <span class="re-op-tit">{{ o.titulo }}</span>
                <span class="re-op-sub">{{ o.sub }}</span>
              </span>
              <mat-icon class="re-op-check">
                {{ resultado() === o.valor ? 'check_circle' : 'radio_button_unchecked' }}
              </mat-icon>
            </button>
          }
        </div>

        @if (pideMotivo()) {
          <div class="re-motivo-box">
            <p class="re-label">
              {{ etiquetaMotivo() }}
              <span class="re-obligatorio">Obligatorio</span>
            </p>
            <mat-form-field appearance="outline" class="re-motivo" subscriptSizing="dynamic">
              <textarea matInput rows="3" [ngModel]="motivo()" (ngModelChange)="motivo.set($event)"
                [placeholder]="placeholderMotivo()" maxlength="500"></textarea>
            </mat-form-field>
            <div class="re-motivo-pie">
              <span [class.re-error]="!!errorMotivo()">
                @if (errorMotivo()) {
                  <mat-icon>error_outline</mat-icon>{{ errorMotivo() }}
                } @else {
                  <mat-icon>history_edu</mat-icon>Queda en el historial del candidato
                }
              </span>
              <span class="re-contador">{{ motivo().length }}/500</span>
            </div>
          </div>
        }
      </mat-dialog-content>

      <mat-dialog-actions class="re-actions">
        <button mat-button class="re-cancelar" (click)="cancelar()">Cancelar</button>
        <button mat-flat-button class="re-guardar" [disabled]="!puedeGuardar()" (click)="guardar()">
          <mat-icon>check</mat-icon> Guardar resultado
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    :host {
      --azul: #21263c;
      --azul-2: #343c5c;
      --teal: #0f5b57;
      --teal-2: #157a74;
      --ok: #2e7d32;
      --mal: #c62828;
      --noshow: #ef6c00;
      --linea: light-dark(#e8edf3, #233e63);
      --tinta: #0f172a;
      display: block;
    }

    .re-wrap { width: min(500px, 92vw); background: var(--surface); }

    /* ── Encabezado ── */
    .re-head {
      position: relative;
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 20px 52px 20px 22px;
      background: linear-gradient(135deg, var(--azul) 0%, var(--azul-2) 100%);
      color: #fff;
    }

    .re-head-examen { background: linear-gradient(135deg, var(--teal) 0%, var(--teal-2) 100%); }

    .re-head-ic {
      display: grid;
      place-items: center;
      width: 46px;
      height: 46px;
      border-radius: 14px;
      background: rgba(255, 255, 255, .16);
      border: 1px solid rgba(255, 255, 255, .22);
      flex: 0 0 auto;
    }

    .re-head-ic .mat-icon { width: 24px; height: 24px; font-size: 24px; }

    .re-head-txt { min-width: 0; }

    .re-head-txt h2 {
      margin: 0;
      font-size: 1.06rem;
      font-weight: 700;
      letter-spacing: .1px;
      line-height: 1.3;
    }

    .re-head-txt p {
      display: flex;
      align-items: center;
      gap: 5px;
      margin: 4px 0 0;
      font-size: .8rem;
      color: rgba(255, 255, 255, .82);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .re-head-txt p .mat-icon { width: 15px; height: 15px; font-size: 15px; flex: 0 0 auto; }

    .re-cerrar { position: absolute; top: 10px; right: 10px; color: rgba(255, 255, 255, .75); }
    .re-cerrar:hover { color: #fff; }

    /* ── Cuerpo ── */
    .re-body { padding: 20px 22px 6px !important; max-height: 62vh; }

    .re-label {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 10px;
      font-size: .72rem;
      font-weight: 700;
      letter-spacing: .6px;
      text-transform: uppercase;
      color: var(--muted);
    }

    .re-obligatorio {
      padding: 1px 7px;
      border-radius: 999px;
      background: #fef2f2; background: light-dark(#fef2f2, #351927);
      color: var(--mal);
      font-size: .62rem;
      letter-spacing: .3px;
    }

    .re-opciones { display: flex; flex-direction: column; gap: 9px; }

    .re-op {
      position: relative;
      display: flex;
      align-items: center;
      gap: 13px;
      width: 100%;
      padding: 12px 14px 12px 17px;
      border: 1.5px solid var(--linea);
      border-radius: 13px;
      background: var(--surface);
      cursor: pointer;
      text-align: left;
      font: inherit;
      overflow: hidden;
      transition: border-color .16s ease, background .16s ease, box-shadow .16s ease, transform .12s ease;
    }

    .re-op:hover {
      border-color: var(--border-strong);
      background: var(--surface);
      transform: translateY(-1px);
      box-shadow: 0 3px 10px rgba(16, 24, 40, .06);
    }

    .re-op:focus-visible { outline: 2px solid var(--azul); outline-offset: 2px; }

    /* Barra de color a la izquierda, solo visible en la seleccionada. */
    .re-op-barra {
      position: absolute;
      inset: 0 auto 0 0;
      width: 4px;
      background: transparent;
      transition: background .16s ease;
    }

    .re-op-ic {
      display: grid;
      place-items: center;
      width: 38px;
      height: 38px;
      border-radius: 11px;
      background: var(--surface-3);
      color: var(--text-faint);
      flex: 0 0 auto;
      transition: background .16s ease, color .16s ease;
    }

    .re-op-ic .mat-icon { width: 20px; height: 20px; font-size: 20px; }

    .re-op-txt { display: flex; flex-direction: column; flex: 1; min-width: 0; }
    .re-op-tit { font-size: .95rem; font-weight: 700; color: var(--tinta); color: light-dark(var(--tinta), var(--text)); line-height: 1.25; }
    .re-op-sub { font-size: .755rem; color: var(--muted); margin-top: 2px; }
    .re-op-check { color: #dbe3ec; flex: 0 0 auto; transition: color .16s ease; }

    .re-op.activa { box-shadow: 0 4px 14px rgba(16, 24, 40, .08); transform: none; }

    .re-op-ok.activa { border-color: var(--ok); background: var(--surface-2); }
    .re-op-ok.activa .re-op-barra { background: var(--ok); }
    .re-op-ok.activa .re-op-ic { background: var(--ok); color: #fff; }
    .re-op-ok.activa .re-op-check { color: var(--ok); color: light-dark(var(--ok), #ade1b0); }

    .re-op-mal.activa { border-color: var(--mal); background: var(--surface-2); }
    .re-op-mal.activa .re-op-barra { background: var(--mal); }
    .re-op-mal.activa .re-op-ic { background: var(--mal); color: #fff; }
    .re-op-mal.activa .re-op-check { color: var(--mal); }

    .re-op-noshow.activa { border-color: var(--noshow); background: #fff8f1; background: light-dark(#fff8f1, #382a24); }
    .re-op-noshow.activa .re-op-barra { background: var(--noshow); }
    .re-op-noshow.activa .re-op-ic { background: var(--noshow); color: #fff; }
    .re-op-noshow.activa .re-op-check { color: var(--noshow); }

    /* ── Motivo ── */
    .re-motivo-box {
      margin-top: 18px;
      padding-top: 16px;
      border-top: 1px dashed var(--linea);
    }

    .re-motivo { width: 100%; }

    .re-motivo-pie {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-top: 6px;
      font-size: .72rem;
      color: var(--muted);
    }

    .re-motivo-pie span { display: inline-flex; align-items: center; gap: 4px; }
    .re-motivo-pie .mat-icon { width: 14px; height: 14px; font-size: 14px; }
    .re-error { color: var(--mal); font-weight: 600; }
    .re-contador { font-variant-numeric: tabular-nums; flex: 0 0 auto; }

    /* ── Acciones ── */
    .re-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      padding: 14px 22px 18px !important;
      border-top: 1px solid var(--linea);
      background: var(--surface);
    }

    .re-cancelar { color: var(--muted); font-weight: 600; border-radius: 999px; }

    .re-guardar {
      --mdc-filled-button-container-color: var(--azul);
      background: var(--azul);
      color: #fff;
      font-weight: 600;
      letter-spacing: .2px;
      border-radius: 999px;
      padding: 0 22px;
      height: 42px;
      box-shadow: 0 4px 12px rgba(33, 38, 60, .22);
    }

    .re-guardar:hover:not([disabled]) { background: var(--azul-2); }
    .re-guardar[disabled] { opacity: .4; box-shadow: none; }

    @media (max-width: 520px) {
      .re-head { padding: 16px 46px 16px 16px; }
      .re-body { padding: 16px 16px 4px !important; }
      .re-actions { padding: 12px 16px 16px !important; }
    }
  `],
})
export class ResultadoEtapaDialogComponent {
  readonly textos: (typeof TEXTOS)[EtapaConResultado];

  /** Las tres salidas, con el color y el subtítulo que se muestran en la tarjeta. */
  readonly opciones: ReadonlyArray<{
    valor: ResultadoEtapa; titulo: string; sub: string; icono: string; tono: string;
  }> = [
    { valor: 'paso', titulo: 'Pasó', sub: 'Aprobó y sigue en el proceso', icono: 'thumb_up', tono: 'ok' },
    { valor: 'no_paso', titulo: 'No pasó', sub: 'Se presentó pero no aprobó', icono: 'thumb_down', tono: 'mal' },
    { valor: 'no_se_presento', titulo: 'No se presentó', sub: 'No asistió a la cita', icono: 'person_off', tono: 'noshow' },
  ];

  readonly resultado = signal<ResultadoEtapa | ''>('');
  readonly motivo = signal('');
  /** Solo se muestra el error cuando ya se intentó guardar. */
  private readonly intentado = signal(false);

  readonly pideMotivo = computed(() => this.resultado() === 'no_paso' || this.resultado() === 'no_se_presento');

  readonly etiquetaMotivo = computed(() =>
    this.resultado() === 'no_se_presento' ? this.textos.preguntaNoShow : this.textos.preguntaNoPaso,
  );

  readonly placeholderMotivo = computed(() =>
    this.resultado() === 'no_se_presento' ? this.textos.ejemploNoShow : '',
  );

  readonly errorMotivo = computed(() => {
    if (!this.intentado() || !this.pideMotivo()) return '';
    const t = this.motivo().trim();
    if (!t) return 'El motivo es obligatorio.';
    if (t.length < 5) return 'Amplía un poco más el motivo (mínimo 5 caracteres).';
    return '';
  });

  readonly puedeGuardar = computed(() => {
    if (!this.resultado()) return false;
    if (!this.pideMotivo()) return true;
    return this.motivo().trim().length >= 5;
  });

  constructor(
    private readonly ref: MatDialogRef<ResultadoEtapaDialogComponent, ResultadoEtapaDialogResult | null>,
    @Inject(MAT_DIALOG_DATA) public readonly data: ResultadoEtapaDialogData,
  ) {
    this.textos = TEXTOS[data.etapa];
    const previo = data.previo ?? {};
    if (previo.resultado && previo.resultado !== 'sin_resultado') {
      this.resultado.set(previo.resultado);
      this.motivo.set(
        (previo.resultado === 'no_se_presento' ? previo.motivoNoSePresento : previo.motivoNoPaso) ?? '',
      );
    }
  }

  elegir(valor: ResultadoEtapa): void {
    if (this.resultado() === valor) return;
    this.resultado.set(valor);
    const previo = this.data.previo ?? {};
    this.motivo.set(
      (valor === 'no_se_presento' ? previo.motivoNoSePresento : valor === 'no_paso' ? previo.motivoNoPaso : '') ?? '',
    );
  }

  guardar(): void {
    this.intentado.set(true);
    if (!this.puedeGuardar()) return;
    this.ref.close({
      resultado: this.resultado() as ResultadoEtapa,
      motivo: this.pideMotivo() ? this.motivo().trim() : '',
    });
  }

  cancelar(): void {
    this.ref.close(null);
  }
}
