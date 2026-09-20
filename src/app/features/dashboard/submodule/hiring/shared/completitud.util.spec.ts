import { FormControl, Validators } from '@angular/forms';
import {
  aNumero, esImporteValido, esPorcentajeValido, estadoDeControl, estadoDeValor,
} from './completitud.util';

/**
 * El verde del sub-tab de Contratación.
 *
 * Lo que se prueba aquí no es el color sino la SEMÁNTICA, que es donde estaba el
 * riesgo: un `value != null` marcaría "Horas extras: NO" como pendiente, dejaría
 * en gris el salario que llega resuelto de la vacante (deshabilitado ⇒ Angular lo
 * reporta como inválido) y pintaría de verde una tarjeta de 12 dígitos.
 */
describe('estadoDeControl', () => {
  it('un campo vacío no está completo', () => {
    expect(estadoDeControl(new FormControl(''))).toBe('normal');
    expect(estadoDeControl(new FormControl(null))).toBe('normal');
    // Solo espacios: sigue vacío.
    expect(estadoDeControl(new FormControl('   '))).toBe('normal');
  });

  it('un campo con valor válido está completo', () => {
    expect(estadoDeControl(new FormControl('PORVENIR'))).toBe('completo');
  });

  it('un campo inválido y tocado es error, nunca verde', () => {
    const c = new FormControl('123', Validators.pattern(/^\d{16,18}$/));
    c.markAsTouched();

    expect(estadoDeControl(c)).toBe('error');
  });

  it('un obligatorio vacío y sin tocar no se marca en rojo, pero tampoco en verde', () => {
    // El rojo prematuro lo decide Material; aquí solo importa que no llegue a verde.
    const c = new FormControl('', Validators.required);

    expect(estadoDeControl(c)).toBe('normal');
  });

  it('tener contenido no basta si el contenido es inválido', () => {
    const c = new FormControl('123456789012', Validators.pattern(/^\d{16,18}$/));
    c.markAsDirty();

    expect(estadoDeControl(c)).toBe('error');
  });

  // ── Booleanos: el caso que más se equivoca ────────────────────────────────
  it('un booleano en false está completo: un NO también es una respuesta', () => {
    expect(estadoDeControl(new FormControl(false))).toBe('completo');
  });

  it('un booleano en true está completo', () => {
    expect(estadoDeControl(new FormControl(true))).toBe('completo');
  });

  it('un booleano sin responder (null) no está completo', () => {
    expect(estadoDeControl(new FormControl(null))).toBe('normal');
  });

  // ── Readonly / deshabilitados ─────────────────────────────────────────────
  it('un deshabilitado con dato está completo aunque Angular lo reporte inválido', () => {
    // Salario y auxilio llegan resueltos de la vacante y van deshabilitados con
    // Validators.required: `.valid` es false porque el status es DISABLED.
    const c = new FormControl({ value: 1750905, disabled: true }, Validators.required);

    expect(c.valid).toBeFalse();
    expect(estadoDeControl(c)).toBe('completo');
  });

  it('un deshabilitado sin dato no está completo', () => {
    const c = new FormControl({ value: null, disabled: true }, Validators.required);

    expect(estadoDeControl(c)).toBe('normal');
  });

  it('un deshabilitado con dato inválido según su regla es error', () => {
    const c = new FormControl({ value: -5, disabled: true });

    expect(estadoDeControl(c, { valido: esImporteValido })).toBe('error');
  });

  // ── Condicionales ─────────────────────────────────────────────────────────
  it('un condicional que no aplica nunca se pinta, aunque tenga valor viejo', () => {
    // Contraseña de tarjeta con forma de pago Daviplata: el campo ni se muestra.
    const c = new FormControl('CLAVE');

    expect(estadoDeControl(c, { aplica: false })).toBe('normal');
  });

  it('un condicional que no aplica tampoco se marca en error', () => {
    const c = new FormControl('', Validators.required);
    c.markAsTouched();

    expect(estadoDeControl(c, { aplica: false })).toBe('normal');
  });

  it('el mismo control aplica y con valor sí se pinta', () => {
    expect(estadoDeControl(new FormControl('CLAVE'), { aplica: true })).toBe('completo');
  });

  it('un control inexistente no rompe', () => {
    expect(estadoDeControl(null)).toBe('normal');
    expect(estadoDeControl(undefined)).toBe('normal');
  });

  // ── Reglas propias del dato ───────────────────────────────────────────────
  it('un porcentaje fuera de rango es error aunque el control lo acepte', () => {
    const c = new FormControl(150);

    expect(estadoDeControl(c, { valido: esPorcentajeValido })).toBe('error');
  });

  it('un porcentaje en 0 está completo', () => {
    expect(estadoDeControl(new FormControl(0), { valido: esPorcentajeValido })).toBe('completo');
  });
});

describe('estadoDeValor', () => {
  it('sirve para los datos de solo lectura sin control propio', () => {
    // Temporal y cargo salen de la vacante.
    expect(estadoDeValor('TA')).toBe('completo');
    expect(estadoDeValor('')).toBe('normal');
    expect(estadoDeValor(null)).toBe('normal');
  });

  it('respeta la condición de aplicabilidad', () => {
    expect(estadoDeValor('TA', { aplica: false })).toBe('normal');
  });
});

describe('helpers numéricos', () => {
  it('acepta coma decimal, como el resto del formulario', () => {
    // El %ARL ya se guardaba con coma ("0,522"); el nuevo % de HE hace lo mismo.
    expect(aNumero('0,522')).toBe(0.522);
    expect(aNumero('0.522')).toBe(0.522);
  });

  it('un texto que no es número no es un valor', () => {
    expect(aNumero('abc')).toBeNull();
    expect(aNumero('')).toBeNull();
    expect(aNumero(null)).toBeNull();
  });

  it('un importe de 0 es válido: una ruta puede no cobrarse', () => {
    expect(esImporteValido(0)).toBeTrue();
    expect(esImporteValido('0')).toBeTrue();
  });

  it('un importe negativo no es válido', () => {
    expect(esImporteValido(-1)).toBeFalse();
  });

  it('el porcentaje vive entre 0 y 100', () => {
    expect(esPorcentajeValido(0)).toBeTrue();
    expect(esPorcentajeValido(25)).toBeTrue();
    expect(esPorcentajeValido(100)).toBeTrue();
    expect(esPorcentajeValido(100.1)).toBeFalse();
    expect(esPorcentajeValido(-0.1)).toBeFalse();
  });
});
