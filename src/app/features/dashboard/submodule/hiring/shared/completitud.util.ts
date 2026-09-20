import { AbstractControl } from '@angular/forms';
import { tieneValor } from './progreso.util';

/**
 * ESTADO DE COMPLETITUD DE UN CAMPO, para pintarlo en verde a medida que se llena.
 *
 * Vive aparte del componente —y no como una expresión en la plantilla— porque la
 * regla no es `value != null`: hay cuatro casos que esa comparación resuelve mal y
 * que aquí se tratan explícitamente.
 *
 *  1. `false` ES una respuesta. "Horas extras: NO" está contestado; pintarlo como
 *     pendiente manda a revisar un campo que ya se llenó. (Es la misma razón por la
 *     que `tieneValor` de `progreso.util` devuelve `true` para `false`, y por eso se
 *     reutiliza en vez de escribir otra: dos definiciones de "lleno" acabarían
 *     discrepando entre el rail de avance y el color del campo.)
 *
 *  2. Los DESHABILITADOS no son inválidos, están fuera de juego. Angular les pone
 *     `status = 'DISABLED'`, así que `control.valid` es `false` aunque el dato esté
 *     perfecto. Salario y auxilio de transporte llegan resueltos de la vacante y
 *     tienen que verse verdes: se miran solo por su valor.
 *
 *  3. Un campo INVÁLIDO nunca es verde, tenga o no contenido. Un número de tarjeta
 *     de 12 dígitos está escrito pero está mal.
 *
 *  4. Los CONDICIONALES que no aplican no cuentan. La contraseña de la tarjeta no
 *     está pendiente cuando la forma de pago es Daviplata: es que no existe.
 *
 * Prioridad: ERROR > COMPLETO > NORMAL.
 */
export type EstadoCampo = 'error' | 'completo' | 'normal';

export interface OpcionesEstado {
  /**
   * `false` cuando el campo no aplica en el estado actual del formulario (está
   * oculto, o depende de otra respuesta). Devuelve siempre 'normal': ni bloquea ni
   * se pinta.
   */
  aplica?: boolean;
  /**
   * Validación propia del dato, más allá de los `Validators` del control. Se usa
   * para lo que el formulario acepta pero el negocio no —un importe negativo, un
   * porcentaje fuera de rango—, que si no saldría verde.
   */
  valido?: (valor: unknown) => boolean;
}

/**
 * Estado de un valor suelto (los de solo lectura que no tienen control propio:
 * temporal y cargo salen de la vacante y se muestran, no se capturan).
 */
export function estadoDeValor(valor: unknown, opciones?: OpcionesEstado): EstadoCampo {
  if (opciones?.aplica === false) return 'normal';
  if (!tieneValor(valor)) return 'normal';
  if (opciones?.valido && !opciones.valido(valor)) return 'error';
  return 'completo';
}

/**
 * Estado de un control del formulario.
 *
 * Un control deshabilitado se juzga solo por su valor (caso 2 de arriba); el resto
 * tiene que estar además `valid` para llegar a verde.
 */
export function estadoDeControl(
  control: AbstractControl | null | undefined,
  opciones?: OpcionesEstado,
): EstadoCampo {
  if (!control) return 'normal';
  if (opciones?.aplica === false) return 'normal';

  const lleno = tieneValor(control.value);

  if (control.disabled) return estadoDeValor(control.value, opciones);

  // Inválido y ya tocado: es un error que el usuario está viendo. Inválido pero aún
  // sin tocar (un obligatorio vacío recién abierto) no se marca en rojo —eso lo
  // decide Material— pero tampoco puede ponerse verde, así que cae a 'normal'.
  if (control.invalid) return control.touched || control.dirty ? 'error' : 'normal';

  if (!lleno) return 'normal';
  if (opciones?.valido && !opciones.valido(control.value)) return 'error';
  return 'completo';
}

/** Número escrito con coma o punto decimal. `null` si no es un número. */
export function aNumero(valor: unknown): number | null {
  if (valor === null || valor === undefined || String(valor).trim() === '') return null;
  const n = Number(String(valor).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Importe válido: número y no negativo. Cero es válido (una ruta puede no cobrarse). */
export function esImporteValido(valor: unknown): boolean {
  const n = aNumero(valor);
  return n !== null && n >= 0;
}

/** Porcentaje válido: número entre 0 y 100. */
export function esPorcentajeValido(valor: unknown): boolean {
  const n = aNumero(valor);
  return n !== null && n >= 0 && n <= 100;
}
