import { DynamicField } from '@/app/shared/components/forms/field.model';

/**
 * MAQUETA de los campos: regla ÚNICA de cuándo un campo ocupa la fila entera de la
 * grilla de dos columnas.
 *
 * La comparten las pantallas que pintan el formulario en ancho de escritorio (el
 * runtime y la vista previa del constructor) para que la maqueta del constructor no
 * mienta sobre cómo quedará el formulario publicado. En ancho de teléfono no aplica:
 * ahí todo va a una sola columna.
 */
export function ocupaFilaCompleta(f: DynamicField): boolean {
  return (
    f.type === 'TEXT_LONG' ||
    f.type === 'SECTION' ||
    f.schema?.ui?.full_width === true ||
    (f.type === 'MULTIPLE_CHOICE' && (f.schema?.options?.length ?? 0) > 6)
  );
}
