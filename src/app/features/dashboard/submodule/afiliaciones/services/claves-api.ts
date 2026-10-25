/**
 * Alias camelCase para las respuestas de ms-hr.
 *
 * POR QUÉ: ms-hr serializa en snake_case (`SPRING_JACKSON_PROPERTY_NAMING_STRATEGY=SNAKE_CASE`
 * en el compose), pero los servicios de Afiliaciones se escribieron contra camelCase, que es lo
 * que devolvía el servicio cuando el ObjectMapper de Kafka desplazaba al de Boot. Desde que
 * manda el snake_case, TODO campo de más de una palabra llegaba `undefined` y la tabla salía
 * con el nombre, la fecha de ingreso, la de contratación, la EPS y la empresa usuaria vacías;
 * las de una sola palabra (cedula, empresa, oficina, finca) seguían viéndose, que es lo que
 * hacía el fallo tan desconcertante.
 *
 * En vez de reescribir las ~70 referencias de cada servicio —y arriesgar una errata silenciosa
 * por campo— se añade el alias camelCase junto a la clave original. El código sigue leyendo
 * como siempre y la pantalla deja de depender de qué convención esté activa, que ya cambió una
 * vez y puede volver a cambiar.
 */
export function conAliasCamel<T>(valor: T): T {
  if (Array.isArray(valor)) {
    return valor.map(v => conAliasCamel(v)) as unknown as T;
  }
  if (valor === null || typeof valor !== 'object' || valor instanceof Date) {
    return valor;
  }
  const origen = valor as Record<string, unknown>;
  const salida: Record<string, unknown> = {};
  for (const clave of Object.keys(origen)) {
    const v = conAliasCamel(origen[clave]);
    salida[clave] = v;
    if (clave.indexOf('_') >= 0) {
      const camel = clave.replace(/_+([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
      if (camel !== clave && salida[camel] === undefined) {
        salida[camel] = v;
      }
    }
  }
  return salida as unknown as T;
}

/**
 * Inversa de {@link conAliasCamel} para los CUERPOS que se envían a ms-hr: con
 * `SNAKE_CASE` global, Jackson ignora en silencio las claves camelCase y el guardado de una
 * plantilla llegaba sin eps_key, campos ni posiciones. Las claves que ya vienen en snake_case
 * pasan tal cual.
 */
export function aSnake<T>(valor: T): T {
  if (Array.isArray(valor)) {
    return valor.map(v => aSnake(v)) as unknown as T;
  }
  if (valor === null || typeof valor !== 'object' || valor instanceof Date) {
    return valor;
  }
  const origen = valor as Record<string, unknown>;
  const salida: Record<string, unknown> = {};
  for (const clave of Object.keys(origen)) {
    if (clave.startsWith('_')) continue;            // estado solo del front (_uid)
    const snake = clave.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
    salida[snake] = aSnake(origen[clave]);
  }
  return salida as unknown as T;
}
