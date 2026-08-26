import { AbstractControl, FormGroup } from '@angular/forms';

/**
 * Cuánto lleva llenado un bloque del pipeline.
 *
 * Es lo que pintan los dos railes: el grande dice cómo va el paso completo y
 * el pequeño cómo va cada sub-paso. `total` es el número de casillas que hay
 * que llenar y `hechos` las que ya tienen respuesta válida; cuando `total` es
 * 0 el bloque no se mide (p. ej. la pestaña de IA, que no es un formulario).
 */
export interface Avance {
  hechos: number;
  total: number;
}

export const AVANCE_VACIO: Avance = { hechos: 0, total: 0 };

/** Porcentaje entero 0..100. Sin casillas medibles devuelve 0. */
export function pctDe(a: Avance | null | undefined): number {
  if (!a || a.total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((a.hechos / a.total) * 100)));
}

/** Suma de avances: así el rail grande se arma con los de sus sub-pasos. */
export function sumarAvances(avances: ReadonlyArray<Avance | null | undefined>): Avance {
  let hechos = 0;
  let total = 0;
  for (const a of avances) {
    if (!a) continue;
    hechos += a.hechos;
    total += a.total;
  }
  return { hechos, total };
}

/**
 * ¿El control es obligatorio?
 *
 * No basta con `hasValidator(Validators.required)`: media plataforma pone y
 * quita obligatoriedad en caliente con `setValidators([...])` y ahí la
 * referencia de función ya no es la misma. Se le pregunta al validador
 * compuesto con un valor vacío, que es la forma que sí sobrevive a eso.
 */
export function esObligatorio(c: AbstractControl | null | undefined): boolean {
  if (!c?.validator) return false;
  try {
    return !!c.validator({ value: null } as AbstractControl)?.['required'];
  } catch {
    // Validadores que miran `control.parent` o el DOM revientan con el control
    // de mentira. No poder preguntarlo no es motivo para romper el contador.
    return false;
  }
}

/** Valor "respondido". `false` cuenta: un NO también es una respuesta. */
export function tieneValor(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/**
 * Avance de un formulario.
 *
 * Por defecto cuenta los OBLIGATORIOS habilitados: son los que impiden guardar
 * y los que el usuario necesita ver como pendientes. Si el bloque no tiene
 * ninguno (Referencias, Datos de obra…) mide sobre todos los campos
 * habilitados, para que la barra siga diciendo algo útil en vez de quedarse en
 * 0 o en 100.
 *
 * Con `soloObligatorios: false` mide TODOS los campos habilitados del bloque.
 * Es lo que pide la ficha del candidato: ahí cada campo del bloque está a la
 * vista, así que un 100 % con un "—" en pantalla se lee como un error del
 * contador. Contando todos, el número dice exactamente lo que se ve.
 *
 * Los deshabilitados quedan fuera en los dos modos a propósito: no se pueden
 * llenar, así que contarlos como pendientes sería mentirle a quien captura.
 */
export function avanceDeForm(
  form: FormGroup | null | undefined,
  campos?: readonly string[],
  opciones?: { soloObligatorios?: boolean },
): Avance {
  if (!form) return AVANCE_VACIO;
  const nombres = campos?.length ? campos : Object.keys(form.controls);
  const vivos = nombres
    .map((n) => form.get(n))
    .filter((c): c is AbstractControl => !!c && c.enabled);
  const obligatorios = opciones?.soloObligatorios === false ? [] : vivos.filter(esObligatorio);
  const base = obligatorios.length ? obligatorios : vivos;
  const hechos = base.filter((c) => tieneValor(c.value) && c.valid).length;
  return { hechos, total: base.length };
}

/** Avance de cosas que no son campos (una huella capturada, un PDF subido…). */
export function avanceDeBanderas(banderas: readonly boolean[]): Avance {
  return { hechos: banderas.filter(Boolean).length, total: banderas.length };
}
