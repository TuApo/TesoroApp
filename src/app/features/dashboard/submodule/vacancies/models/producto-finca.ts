/**
 * «Producto finca» (antes «Perfil vacante»): la línea de producto de la vacante
 * ('Rosa', 'Clavel'…). Se guarda en la columna `area` de la publicación.
 *
 * Es OPCIONAL: no todas las vacantes son de flor. Lo que no tiene producto se guarda
 * como «No aplica», que no vive en el catálogo del parametrizador sino aquí, para que
 * siempre esté disponible aunque el catálogo cambie o falle.
 */
export const PRODUCTO_NO_APLICA = 'No aplica';

/** El catálogo con «No aplica» al principio (sin duplicarlo si ya viniera). */
export function conNoAplica(catalogo: string[]): string[] {
  const resto = catalogo.filter((p) => p.trim().toLowerCase() !== PRODUCTO_NO_APLICA.toLowerCase());
  return [PRODUCTO_NO_APLICA, ...resto];
}

/**
 * Lista elegida → lo que se guarda. Vacío = «No aplica». Si eligieron «No aplica»
 * junto a productos reales, gana lo real: «No aplica, Rosa» no tiene sentido.
 */
export function productosParaGuardar(elegidos: string[]): string[] {
  const reales = elegidos.filter((p) => p.trim().toLowerCase() !== PRODUCTO_NO_APLICA.toLowerCase());
  return reales.length ? reales : [PRODUCTO_NO_APLICA];
}
