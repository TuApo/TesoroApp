/**
 * Alta / edicion de una causal INTERNA de negacion. La lista definitiva la estandarizan la
 * funcional y Daniel (reunion 2026-10-05): la pantalla deja crearla y editarla, y avisa (sin
 * impedirlo) si se marca como FINALIZA una causal distinta de las dos acordadas.
 *
 * Guarda aqui mismo (como el directorio de correos): un 409 por codigo repetido deja el dialogo
 * abierto con el mensaje. Devuelve la causal guardada o `undefined` si se cancela.
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

import { IncapacidadSaludService } from '../../../services/incapacidad-salud/incapacidad-salud.service';
import { AccionCausal, CausalNegacion, CausalNegacionRequest } from '../../../models/incapacidad-salud.model';
import { CAUSALES_QUE_FINALIZAN, mensajeDeError } from '../../liquidacion/liquidacion.utils';

export interface DatosDialogoCausal {
  /** Causal a editar; null = alta. */
  causal: CausalNegacion | null;
  /** Orden sugerido para una causal nueva (al final de la lista). */
  ordenSugerido?: number;
}

/** Codigo interno: mayusculas, digitos y guion bajo, hasta 40 (regla del backend). */
export const PATRON_CODIGO_CAUSAL = /^[A-Z0-9_]{1,40}$/;

/** "Sin aportes 4 semanas" -> "SIN_APORTES_4_SEMANAS" (sugerencia al escribir el nombre). */
export function codigoDesdeNombre(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

@Component({
  selector: 'app-dialogo-causal-negacion',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, MatRadioModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title class="dc-titulo"><mat-icon>{{ datos.causal ? 'edit' : 'playlist_add' }}</mat-icon> {{ datos.causal ? 'Editar causal interna' : 'Nueva causal interna' }}</h2>
    <mat-dialog-content class="dc-contenido">
      <mat-form-field appearance="outline">
        <mat-label>Nombre</mat-label>
        <input matInput [ngModel]="nombre()" (ngModelChange)="cambiarNombre($event)" maxlength="200" required />
        <mat-hint align="end">{{ nombre().length }}/200</mat-hint>
      </mat-form-field>
      <div class="dc-fila">
        <mat-form-field appearance="outline" class="dc-ancho">
          <mat-label>Código</mat-label>
          <input matInput class="dc-mono" [ngModel]="codigo()" (ngModelChange)="cambiarCodigo($event)" maxlength="40" required />
          <mat-hint>Mayúsculas, números y guion bajo (máx. 40)</mat-hint>
        </mat-form-field>
        <mat-form-field appearance="outline" class="dc-orden">
          <mat-label>Orden</mat-label>
          <input matInput type="number" min="0" [ngModel]="orden()" (ngModelChange)="orden.set($event)" />
        </mat-form-field>
      </div>

      <p class="dc-etiqueta">¿Qué pasa con la incapacidad cuando la EPS la niega por esta causal?</p>
      <mat-radio-group class="dc-acciones" [ngModel]="accion()" (ngModelChange)="accion.set($event)" aria-label="Acción">
        <mat-radio-button value="RECOBRO"><strong>Pasa a recobro</strong> — se radica de nuevo ante la EPS</mat-radio-button>
        <mat-radio-button value="FINALIZA"><strong>Finaliza</strong> — la incapacidad queda cerrada (no se recobra)</mat-radio-button>
      </mat-radio-group>
      @if (avisoFinaliza()) {
        <div class="ges-aviso" role="alert">
          <mat-icon>warning_amber</mat-icon>
          <span>Solo «1 y 2 días no reconocidos» y «sin aportes en las 4 semanas anteriores» deberían finalizar (reunión 2026-10-05). Cualquier otra causal debería ir a recobro.</span>
        </div>
      }
      @if (cambiaAccion()) {
        <div class="ges-aviso ges-aviso-info">
          <mat-icon>info</mat-icon>
          <span>Al cambiar la acción se re-evalúan las negaciones que ya tienen esta causal y se recalcula el estado de sus incapacidades.</span>
        </div>
      }

      <mat-form-field appearance="outline">
        <mat-label>Terminación (respuesta fin incapacidad)</mat-label>
        <input matInput [ngModel]="terminacion()" (ngModelChange)="terminacion.set($event)" maxlength="120" placeholder="Ej.: FINALIZADO NEGADO 1 Y 2 DIAS" />
        <mat-hint>Texto que sale en el consolidado cuando la causal finaliza</mat-hint>
      </mat-form-field>
      <mat-checkbox [ngModel]="activo()" (ngModelChange)="activo.set($event)">Activa (se puede elegir al homologar)</mat-checkbox>

      @if (error()) { <p class="dc-error" role="alert"><mat-icon>error</mat-icon> {{ error() }}</p> }
      @if (guardando()) { <mat-progress-bar mode="indeterminate" /> }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="ref.close(undefined)">Cancelar</button>
      <button mat-flat-button color="primary" type="button" [disabled]="guardando()" (click)="guardar()"><mat-icon>save</mat-icon> Guardar</button>
    </mat-dialog-actions>
  `,
  styleUrls: ['../../gestion-incapacidades.comun.css'],
  styles: [`
    /* El CSS comun da fondo y alto de pagina al :host; en un dialogo sobran. */
    :host { background: transparent !important; min-height: 0 !important; }
    .dc-titulo { display: flex; align-items: center; gap: 8px; font-weight: 800; }
    .dc-contenido { display: flex; flex-direction: column; gap: 6px; min-width: min(600px, 88vw); }
    .dc-fila { display: flex; gap: 10px; flex-wrap: wrap; }
    .dc-ancho { flex: 2 1 260px; }
    .dc-orden { flex: 0 1 120px; }
    .dc-mono { font-family: var(--font-mono, ui-monospace, monospace); }
    .dc-etiqueta { margin: 6px 0 2px; font-size: 13px; font-weight: 600; color: var(--disab-text); }
    .dc-acciones { display: flex; flex-direction: column; gap: 4px; margin-bottom: 6px; }
    .dc-error { display: flex; align-items: center; gap: 6px; color: #c62828; color: light-dark(#c62828, #eca2a2); margin: 0; font-size: 13px; }
  `],
})
export class DialogoCausalNegacionComponent {
  readonly ref = inject(MatDialogRef<DialogoCausalNegacionComponent, CausalNegacion | undefined>);
  readonly datos = inject<DatosDialogoCausal>(MAT_DIALOG_DATA);
  private readonly srv = inject(IncapacidadSaludService);

  readonly nombre = signal(this.datos.causal?.nombre ?? '');
  readonly codigo = signal(this.datos.causal?.codigo ?? '');
  readonly accion = signal<AccionCausal>(this.datos.causal?.accion ?? 'RECOBRO');
  readonly terminacion = signal(this.datos.causal?.terminacion ?? '');
  readonly orden = signal<number | string>(this.datos.causal?.orden ?? this.datos.ordenSugerido ?? 50);
  readonly activo = signal(this.datos.causal?.activo ?? true);
  readonly guardando = signal(false);
  readonly error = signal('');
  /** Mientras el usuario no toque el codigo, se sugiere desde el nombre (solo en el alta). */
  private codigoTocado = !!this.datos.causal;

  readonly avisoFinaliza = computed(
    () => this.accion() === 'FINALIZA' && !CAUSALES_QUE_FINALIZAN.includes(this.codigo().trim().toUpperCase()),
  );
  readonly cambiaAccion = computed(() => !!this.datos.causal && this.datos.causal.accion !== this.accion());

  cambiarNombre(v: string): void {
    this.nombre.set(v ?? '');
    if (!this.codigoTocado) this.codigo.set(codigoDesdeNombre(v ?? ''));
  }

  cambiarCodigo(v: string): void {
    this.codigoTocado = true;
    this.codigo.set((v ?? '').toUpperCase());
  }

  /** Cuerpo para el backend (sin actor: lo pone el servicio). */
  cuerpo(): CausalNegacionRequest {
    const orden = Number(this.orden());
    return {
      codigo: this.codigo().trim().toUpperCase(),
      nombre: this.nombre().trim(),
      accion: this.accion(),
      terminacion: this.terminacion().trim() || null,
      orden: Number.isFinite(orden) ? Math.max(0, Math.trunc(orden)) : 0,
      activo: this.activo(),
    };
  }

  guardar(): void {
    const cuerpo = this.cuerpo();
    if (!cuerpo.nombre) {
      this.error.set('El nombre es obligatorio.');
      return;
    }
    if (!PATRON_CODIGO_CAUSAL.test(cuerpo.codigo)) {
      this.error.set('El código solo admite mayúsculas, números y guion bajo (máximo 40).');
      return;
    }
    this.guardando.set(true);
    this.error.set('');
    const peticion = this.datos.causal
      ? this.srv.actualizarCausal(this.datos.causal.id, cuerpo)
      : this.srv.crearCausal(cuerpo);
    peticion.subscribe({
      next: (c) => this.ref.close(c),
      error: (e: unknown) => {
        this.guardando.set(false);
        this.error.set(mensajeDeError(e, 'No se pudo guardar la causal.'));
      },
    });
  }
}
