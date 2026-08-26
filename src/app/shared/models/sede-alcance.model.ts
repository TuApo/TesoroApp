/**
 * Alcance de sedes de un usuario (ms-auth-admin V62).
 *
 * Un usuario puede operar sobre VARIAS sedes a la vez. Una es la activa (`es_principal`)
 * y es la que ven el header y los filtros por defecto; el resto amplía sobre qué datos
 * puede trabajar. Las concesiones que un usuario no administrador se da a sí mismo son
 * TEMPORALES y caducan a las 24 h (`vigente_hasta`).
 */
export interface SedeOperativa {
  id: string;
  nombre: string;
  activa: boolean;
  es_principal: boolean;
  /** true si la concesión caduca; false = permanente (la dio un administrador). */
  temporal: boolean;
  /** ISO-8601 de caducidad, o null si es permanente. */
  vigente_hasta: string | null;
}

export interface AlcanceSedes {
  usuario_id: string;
  es_admin: boolean;
  /**
   * true cuando el alcance es "todas las sedes activas" en vez de una lista guardada:
   * es el caso del administrador, y significa que una sede nueva le queda incluida sola.
   */
  todas: boolean;
  principal: SedeOperativa | null;
  sedes: SedeOperativa[];
}
