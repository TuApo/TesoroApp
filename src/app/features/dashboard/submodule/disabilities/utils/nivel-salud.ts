/**
 * Niveles de Salud (reunion funcional 2026-10-20 con Nathalia Ovalle; Excel "Usuarios para
 * incapacidades 2026", columna Perfil).
 *
 * Los niveles son ROLES SECUNDARIOS de db_admin y los MODULOS que ve cada uno los decide el menu
 * (permisos por rol). Aqui solo se lee la lista de roles vigentes del usuario para lo que el menu
 * no puede decidir: el formulario simplificado del nivel 1 y el aviso de alcance por finca.
 *
 * | Nivel | Rol db_admin        | Que ve                                                   |
 * |-------|---------------------|----------------------------------------------------------|
 * | 1     | SALUD-N1-SUBE       | Registro (simplificado), Consulta y Correos              |
 * | 2     | SALUD-N2-RADICA     | Todo Incapacidades, todo Radicacion y SEVENET            |
 * | 3     | SALUD-N3-LIQUIDA    | Todo Salud (incluida Liquidacion)                         |
 * | 4     | SALUD-N4-CONSULTA   | Consulta de incapacidades (solo ver) y Correos            |
 * | Todos | SALUD-TODOS / ADMIN | Todo, y lo que venga (contabilidad)                      |
 *
 * Alcance por finca: un rol limitador `SALUD-ALCANCE-*` (hoy ANDES-MONTEVERDE para los
 * coordinadores de Flores de los Andes). El servidor ya recorta los datos; el front solo avisa.
 *
 * COORDINADOR (2026-10-22): sin un nivel de Salud mayor cuenta como nivel 1 (registro simplificado)
 * y el servidor le recorta las incapacidades a las de SU oficina (sus sedes en db_admin), salvo que
 * tenga ADMIN, GERENCIA, SALUD-TODOS, N2 o N3.
 */

export const ROL_N1 = 'SALUD-N1-SUBE';
export const ROL_N2 = 'SALUD-N2-RADICA';
export const ROL_N3 = 'SALUD-N3-LIQUIDA';
export const ROL_N4 = 'SALUD-N4-CONSULTA';
export const ROL_TODOS = 'SALUD-TODOS';
export const PREFIJO_ALCANCE = 'SALUD-ALCANCE-';
export const ROL_COORDINADOR = 'COORDINADOR';

/** Con cualquiera de estos el COORDINADOR no se recorta por oficina (espejo de ms-hr). */
const ROLES_SIN_RECORTE_OFICINA = ['ADMIN', 'GERENCIA', ROL_TODOS, ROL_N2, ROL_N3];

export type NivelSalud = 'N1' | 'N2' | 'N3' | 'N4' | 'TODOS';

/** Etiquetas legibles de los roles limitadores conocidos. */
const ETIQUETAS_ALCANCE: Readonly<Record<string, string>> = {
  'SALUD-ALCANCE-ANDES-MONTEVERDE': 'Andes y Monteverde',
};

function normalizar(roles: readonly (string | null | undefined)[] | null | undefined): string[] {
  return (roles ?? [])
    .map((r) => (r ?? '').toString().trim().toUpperCase())
    .filter((r) => r.length > 0);
}

/**
 * El nivel MAS ALTO entre los roles del usuario (ADMIN cuenta como "todos los niveles").
 * `null` si no tiene ningun rol de Salud: sus pantallas se comportan como siempre.
 */
export function nivelSalud(roles: readonly (string | null | undefined)[] | null | undefined): NivelSalud | null {
  const r = new Set(normalizar(roles));
  if (r.has('ADMIN') || r.has(ROL_TODOS)) return 'TODOS';
  if (r.has(ROL_N3)) return 'N3';
  if (r.has(ROL_N2)) return 'N2';
  if (r.has(ROL_N1)) return 'N1';
  if (r.has(ROL_N4)) return 'N4';
  // Coordinador sin nivel de Salud: radica con el formulario simplificado (2026-10-22).
  if (r.has(ROL_COORDINADOR)) return 'N1';
  return null;
}

/**
 * Formulario de registro simplificado (reunion 2026-10-20): SOLO si su nivel mas alto es el 1.
 * Los niveles 2 y 3 "pueden ver todo el formulario" (cargan incapacidades que llegan a Fontibon).
 */
export function usaFormularioSimplificado(roles: readonly (string | null | undefined)[] | null | undefined): boolean {
  return nivelSalud(roles) === 'N1';
}

/**
 * Etiqueta del alcance por finca ("Andes y Monteverde"), "tu oficina" para un COORDINADOR sin rol
 * mayor (el servidor lo recorta a sus sedes), las dos unidas si aplica, o '' si el usuario ve todo.
 */
export function alcanceSalud(roles: readonly (string | null | undefined)[] | null | undefined): string {
  const lista = normalizar(roles);
  const etiquetas = lista
    .filter((r) => r.startsWith(PREFIJO_ALCANCE))
    .map(
      (r) =>
        ETIQUETAS_ALCANCE[r] ??
        r
          .substring(PREFIJO_ALCANCE.length)
          .split('-')
          .filter(Boolean)
          .map((p) => p.charAt(0) + p.substring(1).toLowerCase())
          .join(' y '),
    );
  if (lista.includes(ROL_COORDINADOR) && !ROLES_SIN_RECORTE_OFICINA.some((x) => lista.includes(x))) {
    etiquetas.push('tu oficina');
  }
  return Array.from(new Set(etiquetas)).join(', ');
}

/** "Nivel 1", "Nivel 2"... o "Todos los niveles", para la guia y los avisos. */
export function etiquetaNivel(nivel: NivelSalud | null): string {
  switch (nivel) {
    case 'N1':
      return 'Nivel 1';
    case 'N2':
      return 'Nivel 2';
    case 'N3':
      return 'Nivel 3';
    case 'N4':
      return 'Nivel 4';
    case 'TODOS':
      return 'Todos los niveles';
    default:
      return '';
  }
}

/**
 * Divide el nombre escrito en UN solo campo (formulario del nivel 1) en los cuatro que guarda el
 * backend, con la convencion de la plataforma: APELLIDOS primero. 4+ palabras: dos apellidos, primer
 * nombre y el resto como segundo nombre; 3: dos apellidos y un nombre; 2: apellido y nombre; 1:
 * solo el apellido (el formulario pedira el nombre).
 */
export function dividirNombreCompleto(texto: string | null | undefined): {
  primerApellido: string;
  segundoApellido: string;
  primerNombre: string;
  segundoNombre: string;
} {
  const p = (texto ?? '').replace(/\s+/g, ' ').trim().toUpperCase().split(' ').filter(Boolean);
  if (p.length >= 4) {
    return { primerApellido: p[0], segundoApellido: p[1], primerNombre: p[2], segundoNombre: p.slice(3).join(' ') };
  }
  if (p.length === 3) {
    return { primerApellido: p[0], segundoApellido: p[1], primerNombre: p[2], segundoNombre: '' };
  }
  if (p.length === 2) {
    return { primerApellido: p[0], segundoApellido: '', primerNombre: p[1], segundoNombre: '' };
  }
  return { primerApellido: p[0] ?? '', segundoApellido: '', primerNombre: '', segundoNombre: '' };
}

/** Los cuatro campos del nombre en uno solo, apellidos primero. */
export function unirNombreCompleto(partes: {
  primerApellido?: string | null;
  segundoApellido?: string | null;
  primerNombre?: string | null;
  segundoNombre?: string | null;
}): string {
  return [partes.primerApellido, partes.segundoApellido, partes.primerNombre, partes.segundoNombre]
    .map((x) => (x ?? '').trim())
    .filter(Boolean)
    .join(' ');
}
