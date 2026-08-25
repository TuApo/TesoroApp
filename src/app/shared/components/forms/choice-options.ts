import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import { FieldOption } from './field.model';

/**
 * Contrato para que un campo de selección saque sus opciones de un ORIGEN DE DATOS
 * (una tabla parametrizada) en vez del array estático del schema.
 *
 * Vive en shared —con los componentes de campo— pero SIN implementación: quien resuelve
 * es el submódulo de Formularios Dinámicos, que registra su servicio contra este token en
 * app.config.ts. Así shared/ no termina dependiendo de features/, y un campo sin origen
 * (o una app donde nadie provea el token) sigue funcionando con sus opciones estáticas.
 */

/** Lo que el campo declara en su schema: qué origen y de qué campo depende. */
export interface ChoiceOptionsSource {
  /** Código del origen (df_option_source.code). */
  source: string;
  /** Nombre del campo del que depende la cascada; su valor filtra este. */
  parent_field?: string | null;
}

/**
 * Resultado de resolver un origen. `restricted` con lista vacía NO es un error: es la
 * respuesta legítima de "no te corresponde ninguna opción" o "falta elegir el campo
 * anterior", y por eso viene con `reason` para poder decirlo en pantalla.
 */
export interface ChoiceOptionsResult {
  options: FieldOption[];
  restricted: boolean;
  reason?: string | null;
  truncated?: boolean;
}

export interface ChoiceOptionsResolver {
  resolveOptions(source: string, parent: string | null): Observable<ChoiceOptionsResult>;
}

export const CHOICE_OPTIONS_RESOLVER = new InjectionToken<ChoiceOptionsResolver>('CHOICE_OPTIONS_RESOLVER');

/** Mensaje para el usuario según por qué el origen no devolvió opciones. */
export function choiceRestrictionMessage(reason: string | null | undefined): string {
  switch (reason) {
    case 'espera_padre': return 'Elige primero el campo anterior';
    case 'sin_permiso':
    case 'sin_rol': return 'No tienes acceso a estas opciones';
    case 'sin_empresa': return 'Tu usuario no tiene empresa asignada';
    case 'sin_sede': return 'Tu usuario no tiene sede asignada';
    case 'sin_sesion': return 'Estas opciones requieren iniciar sesión';
    case 'origen_inactivo': return 'El origen de datos está desactivado';
    case 'catalogo_no_disponible':
    case 'contexto_no_disponible': return 'No se pudieron cargar las opciones';
    default: return 'Sin opciones disponibles';
  }
}
