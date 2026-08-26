/**
 * EL CENTRO DE COSTOS, QUE SE LLAMA DE TRES FORMAS.
 *
 * En base la columna es `ccentro_de_costos` (con esa doble C heredada del
 * modelo viejo) y el campo Java es `ccentroDeCostos`, así que la API responde
 * **`ccentro_de_costos`**. El frontend, en cambio, lo escribe con C mayúscula
 * —`Ccentro_de_costos`— porque así se llama la clave que ACEPTA el guardado
 * (`contrato_detalle`), y esa asimetría se coló en todos los lectores.
 *
 * Consecuencias que se veían y que nadie ataba a esto:
 *  - "No se puede generar la documentación: falta Centro de costos", con el
 *    dato guardado desde hacía rato.
 *  - Ficha Técnica y carnet salían con el centro de costo EN BLANCO.
 *  - Al reabrir "Pago y Transporte" la casilla aparecía vacía, así que se
 *    volvía a teclear y a guardar lo mismo.
 *
 * Se lee por aquí y se acabó: escribir sigue siendo con `Ccentro_de_costos`,
 * que es lo que el backend espera.
 */
export function centroDeCostosDe(contrato: any): string {
  const v = contrato?.['Ccentro_de_costos']
         ?? contrato?.['ccentro_de_costos']
         ?? contrato?.['centro_de_costos']
         ?? '';
  return String(v ?? '').trim();
}

/**
 * El centro de costo que se IMPRIME (carnet, ficha): puede diferir del de
 * nómina, y cuando no está se cae al de nómina.
 */
export function centroDeCostosImpreso(contrato: any): string {
  const carnet = String(contrato?.['carnet_centro_costo'] ?? '').trim();
  return carnet || centroDeCostosDe(contrato);
}
