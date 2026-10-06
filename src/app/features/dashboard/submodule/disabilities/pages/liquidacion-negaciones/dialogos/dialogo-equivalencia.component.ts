/**
 * Equivalencia de causal por EPS: el texto (o codigo) con que responde una EPS -> causal interna.
 * Cada EPS escribe distinto (Nueva EPS "causal 51", Sanitas "uno y dos dias no cumple"...), asi
 * que la homologacion es explicita y editable: el sistema nunca adivina.
 *
 * Tres usos:
 *  - 'crear'     : alta libre desde la pestana de equivalencias (con "reaplicar" opcional);
 *  - 'homologar' : desde "Sin homologar", con el texto de la EPS fijo y reaplicando siempre;
 *  - 'editar'    : cambia causal, EPS, texto o la desactiva.
 * Guarda aqui mismo (un 409 por equivalencia repetida deja el dialogo abierto con el mensaje).
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';

import { IncapacidadSaludService } from '../../../services/incapacidad-salud/incapacidad-salud.service';
import {
  CausalNegacion,
  EquivalenciaCausal,
  ResultadoEquivalencia,
} from '../../../models/incapacidad-salud.model';
import { EPS_TODAS, claseAccion, etiquetaAccion, mensajeDeError } from '../../liquidacion/liquidacion.utils';

export type ModoDialogoEquivalencia = 'crear' | 'homologar' | 'editar';

export interface DatosDialogoEquivalencia {
  modo: ModoDialogoEquivalencia;
  /** Solo en 'editar'. */
  equivalencia?: EquivalenciaCausal | null;
  /** 'homologar': texto de la EPS (fijo) y la EPS que lo uso. */
  textoExterno?: string;
  eps?: string | null;
  /** Causales internas (se ofrecen las activas y, al editar, la actual aunque este inactiva). */
  causales: CausalNegacion[];
  /** Sugerencias de EPS (matriz oficial). */
  epsOpciones: string[];
}

export type ResultadoDialogoEquivalencia =
  | { tipo: 'creada'; resultado: ResultadoEquivalencia }
  | { tipo: 'editada'; equivalencia: EquivalenciaCausal };

type Alcance = 'TODAS' | 'EPS';

@Component({
  selector: 'app-dialogo-equivalencia',
  standalone: true,
  imports: [
    FormsModule, MatDialogModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatIconModule,
    MatInputModule, MatProgressBarModule, MatRadioModule, MatSelectModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title class="de-titulo"><mat-icon>{{ icono }}</mat-icon> {{ titulo }}</h2>
    <mat-dialog-content class="de-contenido">
      @if (datos.modo === 'homologar') {
        <p class="de-etiqueta">Causal que escribió la EPS</p>
        <blockquote class="de-texto">{{ textoExterno() }}</blockquote>
      } @else {
        <mat-form-field appearance="outline">
          <mat-label>Texto o código de la EPS</mat-label>
          <textarea matInput rows="2" [ngModel]="textoExterno()" (ngModelChange)="textoExterno.set($event)" maxlength="1000" required
                    placeholder="Tal como viene en la respuesta de la EPS"></textarea>
          <mat-hint>Se compara sin tildes, mayúsculas ni signos</mat-hint>
        </mat-form-field>
      }

      <p class="de-etiqueta">¿Para qué EPS aplica?</p>
      <mat-radio-group class="de-alcance" [ngModel]="alcance()" (ngModelChange)="alcance.set($event)" aria-label="Alcance">
        <mat-radio-button value="EPS">Solo una EPS</mat-radio-button>
        <mat-radio-button value="TODAS">Todas las EPS</mat-radio-button>
      </mat-radio-group>
      @if (alcance() === 'EPS') {
        <mat-form-field appearance="outline">
          <mat-label>EPS</mat-label>
          <input matInput [ngModel]="eps()" (ngModelChange)="eps.set($event)" list="de-eps" maxlength="160" required />
          <datalist id="de-eps">@for (e of datos.epsOpciones; track e) { <option [value]="e"></option> }</datalist>
        </mat-form-field>
      }

      <mat-form-field appearance="outline">
        <mat-label>Causal interna</mat-label>
        <mat-select [ngModel]="causalId()" (ngModelChange)="causalId.set($event)" required>
          @for (c of causalesOfrecidas(); track c.id) {
            <mat-option [value]="c.id">{{ c.nombre }} · {{ accion(c.accion) }}{{ c.activo ? '' : ' (inactiva)' }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      @if (seleccionada(); as c) {
        <p class="de-efecto">
          <span [class]="'ges-chip ' + clase(c.accion)">{{ accion(c.accion) }}</span>
          {{ c.accion === 'FINALIZA' ? 'Las negaciones con este texto finalizan la incapacidad.' : 'Las negaciones con este texto pasan a recobro.' }}
        </p>
      }

      @if (datos.modo === 'crear') {
        <mat-checkbox [ngModel]="reaplicar()" (ngModelChange)="reaplicar.set($event)">
          Homologar también las negaciones ya cargadas sin homologar que tengan este texto
        </mat-checkbox>
      } @else if (datos.modo === 'homologar') {
        <div class="ges-aviso ges-aviso-info">
          <mat-icon>info</mat-icon>
          <span>Se homologan también las negaciones ya cargadas con este texto y se recalcula el estado de sus incapacidades.</span>
        </div>
      } @else {
        <mat-checkbox [ngModel]="activo()" (ngModelChange)="activo.set($event)">Activa</mat-checkbox>
      }

      @if (error()) { <p class="de-error" role="alert"><mat-icon>error</mat-icon> {{ error() }}</p> }
      @if (guardando()) { <mat-progress-bar mode="indeterminate" /> }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="ref.close(undefined)">Cancelar</button>
      <button mat-flat-button color="primary" type="button" [disabled]="guardando()" (click)="guardar()"><mat-icon>save</mat-icon> {{ datos.modo === 'homologar' ? 'Homologar' : 'Guardar' }}</button>
    </mat-dialog-actions>
  `,
  styleUrls: ['../../gestion-incapacidades.comun.css'],
  styles: [`
    /* El CSS comun da fondo y alto de pagina al :host; en un dialogo sobran. */
    :host { background: transparent !important; min-height: 0 !important; }
    .de-titulo { display: flex; align-items: center; gap: 8px; font-weight: 800; }
    .de-contenido { display: flex; flex-direction: column; gap: 6px; min-width: min(600px, 88vw); }
    .de-etiqueta { margin: 4px 0 0; font-size: 12.5px; color: var(--disab-text-muted); font-weight: 600; }
    .de-texto { margin: 0 0 8px; padding: 8px 12px; border-left: 3px solid var(--disab-warn); background: var(--surface-2); border-radius: 6px; font-size: 13px; white-space: pre-wrap; word-break: break-word; }
    .de-alcance { display: flex; gap: 18px; flex-wrap: wrap; margin-bottom: 4px; }
    .de-efecto { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0 0 6px; font-size: 13px; }
    .de-error { display: flex; align-items: center; gap: 6px; color: #c62828; color: light-dark(#c62828, #eca2a2); margin: 0; font-size: 13px; }
  `],
})
export class DialogoEquivalenciaComponent {
  readonly ref = inject(MatDialogRef<DialogoEquivalenciaComponent, ResultadoDialogoEquivalencia | undefined>);
  readonly datos = inject<DatosDialogoEquivalencia>(MAT_DIALOG_DATA);
  private readonly srv = inject(IncapacidadSaludService);

  private readonly actual = this.datos.equivalencia ?? null;
  private readonly epsInicial = this.actual?.eps ?? this.datos.eps ?? null;

  readonly textoExterno = signal(this.actual?.textoExterno ?? this.datos.textoExterno ?? '');
  /** Con EPS conocida se propone "solo esa EPS" (cada EPS usa sus propios textos). */
  readonly alcance = signal<Alcance>(this.epsInicial && this.epsInicial !== EPS_TODAS ? 'EPS' : 'TODAS');
  readonly eps = signal(this.epsInicial && this.epsInicial !== EPS_TODAS ? this.epsInicial : '');
  readonly causalId = signal<number | null>(this.actual?.causalId ?? null);
  readonly reaplicar = signal(true);
  readonly activo = signal(this.actual?.activo ?? true);
  readonly guardando = signal(false);
  readonly error = signal('');

  readonly causalesOfrecidas = computed(() =>
    this.datos.causales.filter((c) => c.activo || c.id === this.actual?.causalId),
  );
  readonly seleccionada = computed(() => this.datos.causales.find((c) => c.id === this.causalId()) ?? null);

  readonly titulo =
    this.datos.modo === 'editar' ? 'Editar equivalencia' : this.datos.modo === 'homologar' ? 'Homologar causal de la EPS' : 'Nueva equivalencia';
  readonly icono = this.datos.modo === 'editar' ? 'edit' : this.datos.modo === 'homologar' ? 'rule' : 'add_link';
  readonly accion = etiquetaAccion;
  readonly clase = claseAccion;

  /** '*' para todas; si no, la EPS escrita. */
  epsElegida(): string {
    return this.alcance() === 'TODAS' ? EPS_TODAS : this.eps().trim();
  }

  guardar(): void {
    const texto = this.textoExterno().trim();
    const causalId = this.causalId();
    const eps = this.epsElegida();
    if (!texto) {
      this.error.set('Escribe el texto o código que usa la EPS.');
      return;
    }
    if (!eps) {
      this.error.set('Escribe la EPS o elige «Todas las EPS».');
      return;
    }
    if (!causalId) {
      this.error.set('Elige la causal interna.');
      return;
    }
    this.guardando.set(true);
    this.error.set('');

    if (this.datos.modo === 'editar' && this.actual) {
      this.srv
        .actualizarEquivalencia(this.actual.id, { causalId, eps, textoExterno: texto, activo: this.activo() })
        .subscribe({
          next: (equivalencia) => this.ref.close({ tipo: 'editada', equivalencia }),
          error: (e: unknown) => this.fallo(e),
        });
      return;
    }
    const reaplicar = this.datos.modo === 'homologar' ? true : this.reaplicar();
    this.srv.crearEquivalencia({ causalId, eps, textoExterno: texto, reaplicar }).subscribe({
      next: (resultado) => this.ref.close({ tipo: 'creada', resultado }),
      error: (e: unknown) => this.fallo(e),
    });
  }

  private fallo(e: unknown): void {
    this.guardando.set(false);
    this.error.set(mensajeDeError(e, 'No se pudo guardar la equivalencia.'));
  }
}
