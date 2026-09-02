/**
 * Regla: qué falta —además de "Pago y Transporte"— para poder ENTRAR a generar
 * la documentación.
 *
 * Se valida contra lo GUARDADO en el backend (`proceso.publicacion` y
 * `proceso.contrato`), no contra el form de los sub-tabs: igual que
 * `pago-transporte.rules`, `generate-contracting-documents` es otra ruta que
 * recarga el candidato por cédula, así que lo escrito y sin guardar no llega y
 * los documentos saldrían con los campos en blanco.
 *
 * Por qué hace falta: los getters de obra de `generate-contracting-documents`
 * encadenan `contrato || vacante || ''`. Sin vacante remitida y sin datos de
 * obra guardados el PDF se generaba igual, mudo pero con pinta de válido —el
 * mismo síntoma traicionero de siempre: sale, se firma, y nadie mira que la
 * empresa usuaria y la descripción de obra venían vacías.
 *
 * Vive aparte del componente para poder probarse sin levantar la página entera.
 */

/**
 * La vacante se elige y se guarda en Contratación → Vacantes (`guardarVacantes()`
 * en help-information). Al guardarla el proceso queda con `publicacion = <id>`;
 * mientras sea null, la persona está remitida sin vacante.
 */
export const FALTA_VACANTE = 'Seleccionar y GUARDAR la vacante en Contratación → Vacantes.';

export const FALTA_GUARDAR_OBRA = 'Guardar el sub-tab "Datos de obra" de Contratación.';

/**
 * Los cuatro campos que imprimen los documentos, con el nombre que usa
 * `ContratoCandidatoSerializer`. Son justo los que alimentan
 * `empresaUsuariaDoc`, `centroCostoDoc`, `direccionDoc` y `descripcionObraDoc`.
 */
export const CAMPOS_DATOS_OBRA: ReadonlyArray<{ campo: string; etiqueta: string }> = [
  { campo: 'empresa_usuaria', etiqueta: 'Empresa usuaria' },
  { campo: 'centro_costo_obra', etiqueta: 'Centro de costo / obra' },
  { campo: 'direccion_empresa', etiqueta: 'Dirección de la empresa' },
  { campo: 'descripcion_de_obra', etiqueta: 'Descripción de obra' },
];

/** Mismo criterio que `pago-transporte.rules`: `0` es un dato, `''` no. */
function vacio(valor: any): boolean {
  return valor === null || valor === undefined || String(valor).trim() === '';
}

/** ¿Falta elegir y guardar la vacante? Se mide por `publicacion`, no por el form. */
export function faltaVacante(proceso: any): boolean {
  return proceso?.publicacion == null;
}

/** Etiquetas de lo que falta en "Datos de obra". Vacío = ese sub-tab está listo. */
export function faltantesDeDatosObra(contrato: any): string[] {
  // Sin fila de contrato no tiene sentido enumerar los cuatro campos: el
  // problema es que nunca se guardó el sub-tab.
  if (!contrato) return [FALTA_GUARDAR_OBRA];

  return CAMPOS_DATOS_OBRA
    .filter(({ campo }) => vacio(contrato[campo]))
    .map(({ etiqueta }) => etiqueta);
}
