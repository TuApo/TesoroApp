import { Urgencia } from './notification-center.service';

/**
 * Los tres niveles con los que la gente habla de esto: qué tan rápido hay que
 * reaccionar.
 *
 * <p>El backend guarda cuatro urgencias, y hace bien: CRITICA además no se
 * puede silenciar ni por preferencias. Pero para quien mira la campana CRITICA
 * y URGENTE son lo mismo —hay que ir ahora—, y pedirle que distinga cuatro
 * grados de prisa es pedirle que no distinga ninguno.</p>
 *
 * <p>Vive en `core` y no dentro de un componente porque la campana y el
 * historial tienen que clasificar exactamente igual: si el panel dice
 * «atención inmediata» y la página lo llama de otra forma, el usuario acaba
 * pensando que son dos cosas distintas.</p>
 */
export type Prioridad = 'INMEDIATA' | 'MEDIA' | 'LEVE';

const POR_URGENCIA: Record<Urgencia, Prioridad> = {
  CRITICA: 'INMEDIATA',
  URGENTE: 'INMEDIATA',
  IMPORTANTE: 'MEDIA',
  INFO: 'LEVE',
};

export interface NivelPrioridad {
  clave: Prioridad;
  /** Para el semáforo, donde el espacio es de tres columnas. */
  corto: string;
  /** Para la cabecera del grupo, donde se puede ser explícito. */
  largo: string;
  /** Qué se espera de quien la recibe. Va en el tooltip. */
  ayuda: string;
}

/** Orden de lectura: lo que apremia primero, siempre. */
export const NIVELES: NivelPrioridad[] = [
  { clave: 'INMEDIATA', corto: 'Inmediata', largo: 'Atención inmediata', ayuda: 'Requiere que actúes ahora' },
  { clave: 'MEDIA', corto: 'Media', largo: 'Prioridad media', ayuda: 'Resuélvelo hoy' },
  { clave: 'LEVE', corto: 'Leve', largo: 'Informativas', ayuda: 'Para que estés al tanto' },
];

export function prioridadDe(urgencia: Urgencia | null | undefined): Prioridad {
  return (urgencia && POR_URGENCIA[urgencia]) || 'LEVE';
}

/** Etiqueta de la acción según a dónde lleve el clic. Se lee antes de pulsar. */
export function etiquetaDestino(destinoTipo: string): string {
  switch (destinoTipo) {
    case 'MODULO': return 'Abrir módulo';
    case 'FORM_DINAMICO':
    case 'FORM_PUBLICO': return 'Abrir formulario';
    case 'URL': return 'Abrir enlace';
    default: return 'Abrir';
  }
}
