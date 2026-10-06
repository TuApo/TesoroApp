/**
 * Formulario del radicado (reunion funcional 2026-10-05): numero que entrego la EPS, fecha,
 * donde se radico (Pagina web / Correo / Presencial) y observaciones. Lo usan Radicacion,
 * "Recobro por codigo" y el dialogo de recobro: el mismo formulario para el radicado inicial
 * y para los de recobro, como lo pidio la funcional.
 *
 * "Quien radico" NO se digita: lo pone el backend con el usuario de la sesion (JWT > cuerpo).
 * Aqui solo se muestra para que quede claro a nombre de quien queda.
 */
import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import type { DondeRadicado } from '../../../../models/incapacidad-v2.model';
import { DONDE_RADICADO_OPCIONES } from '../../../../models/incapacidad-salud.model';
import { IncapacidadSaludService } from '../../../../services/incapacidad-salud/incapacidad-salud.service';
import { parsearFechaFlexible } from '../../../../utils/fechas';
import {
  DatosRadicado,
  ICONO_DONDE,
  MAX_LARGO_OBSERVACIONES,
  MAX_LARGO_RADICADO,
  esFechaFutura,
  hoyIso,
} from '../../radicacion.utils';

/** Un numero hecho solo de espacios no es un radicado. */
function sinSoloEspacios(control: AbstractControl<string | null>): ValidationErrors | null {
  const valor = control.value ?? '';
  return valor.length > 0 && valor.trim().length === 0 ? { required: true } : null;
}

/** Fecha legible y no futura (la EPS no entrega radicados de manana). */
function fechaValida(control: AbstractControl<string | null>): ValidationErrors | null {
  const valor = control.value;
  if (!valor) return null; // de eso se encarga `required`
  if (!parsearFechaFlexible(valor)) return { fechaInvalida: true };
  return esFechaFutura(valor) ? { fechaFutura: true } : null;
}

@Component({
  selector: 'app-formulario-radicado',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './formulario-radicado.component.html',
  styleUrl: './formulario-radicado.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormularioRadicadoComponent {
  /** Incapacidades marcadas: el boton dice cuantas y no se puede guardar con cero. */
  readonly cantidad = input(0);
  readonly textoBoton = input('Guardar radicado');
  readonly guardando = input(false);
  /** Aviso extra junto al boton (por ejemplo: "supera el tope de 500"). */
  readonly bloqueo = input<string | null>(null);
  /** Se emite solo con el formulario valido; la vista confirma y llama al backend. */
  readonly enviar = output<DatosRadicado>();

  readonly opciones = DONDE_RADICADO_OPCIONES;
  readonly iconos = ICONO_DONDE;
  readonly maxRadicado = MAX_LARGO_RADICADO;
  readonly maxObservaciones = MAX_LARGO_OBSERVACIONES;
  readonly hoy = hoyIso();
  /** A nombre de quien queda el radicado (el mismo actor que viaja al backend). */
  readonly usuario = inject(IncapacidadSaludService).cuerpoActor().actor ?? null;

  readonly formulario = new FormGroup({
    numeroRadicado: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(MAX_LARGO_RADICADO), sinSoloEspacios],
    }),
    fechaRadicado: new FormControl(hoyIso(), { nonNullable: true, validators: [Validators.required, fechaValida] }),
    dondeRadicado: new FormControl<DondeRadicado | null>(null, { validators: [Validators.required] }),
    observaciones: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(MAX_LARGO_OBSERVACIONES)],
    }),
  });

  /**
   * true tras intentar guardar: el selector de canal no tiene "touched" propio visible. Es
   * senal para que la vista (OnPush, sin zone.js) se repinte sola al cambiar.
   */
  private readonly intentado = signal(false);

  largoNumero(): number {
    return this.formulario.controls.numeroRadicado.value.length;
  }

  errorNumero(): string {
    const c = this.formulario.controls.numeroRadicado;
    if (c.hasError('required')) return 'Escriba el número de radicado que entregó la EPS.';
    if (c.hasError('maxlength')) return `Máximo ${MAX_LARGO_RADICADO} caracteres.`;
    return '';
  }

  errorFecha(): string {
    const c = this.formulario.controls.fechaRadicado;
    if (c.hasError('required')) return 'Indique la fecha del radicado.';
    if (c.hasError('fechaInvalida')) return 'La fecha no es válida.';
    if (c.hasError('fechaFutura')) return 'La fecha no puede ser posterior a hoy.';
    return '';
  }

  dondeConError(): boolean {
    const c = this.formulario.controls.dondeRadicado;
    return c.invalid && (c.touched || this.intentado());
  }

  /** Valida y, si todo esta bien, entrega los datos limpios a la vista. */
  guardar(): void {
    this.intentado.set(true);
    this.formulario.markAllAsTouched();
    if (this.formulario.invalid || this.cantidad() === 0 || this.guardando() || this.bloqueo()) return;
    const v = this.formulario.getRawValue();
    const observaciones = v.observaciones.trim();
    this.enviar.emit({
      numeroRadicado: v.numeroRadicado.trim(),
      fechaRadicado: v.fechaRadicado,
      dondeRadicado: v.dondeRadicado as DondeRadicado,
      observaciones: observaciones || null,
    });
  }

  /**
   * Despues de guardar: se limpian numero y observaciones, pero se conservan fecha y canal
   * porque lo normal es seguir anotando radicados del mismo dia y del mismo portal.
   */
  reiniciar(): void {
    this.intentado.set(false);
    this.formulario.controls.numeroRadicado.reset('');
    this.formulario.controls.observaciones.reset('');
    this.formulario.markAsUntouched();
  }
}
