/**
 * Autorizaciones para el tratamiento de datos biométricos en EconomiAPP.
 *
 * <p>Los rasgos faciales son DATO SENSIBLE (Ley 1581 de 2012, art. 5; Decreto 1377 de 2013,
 * compilado en el Decreto 1074 de 2015). Eso obliga a tres cosas que esta app respeta:
 *  1. La autorización es previa, expresa e informada, y se guarda con fecha, versión y huella
 *     (sha256 del texto exacto que la persona vio). Por eso el texto es una constante
 *     VERSIONADA: si se cambia una coma, se sube la versión.
 *  2. Se le dice a la persona que NO está obligada a entregar datos sensibles.
 *  3. Ningún servicio se condiciona a entregarlos: quien no acepta puede verificar su
 *     identidad en persona, con su cédula, en el punto de entrega.
 *
 * <p>BORRADOR PROVISIONAL redactado el 2026-10-08 para revisión del área jurídica. Los
 * campos entre corchetes los completa la empresa responsable.
 */
export const CONSENTIMIENTO_VERSION = 'BIO-ECO-v1-2026-10-08';

export const RESPONSABLE = {
  razonSocial: '[RAZÓN SOCIAL DE LA EMPRESA DE SERVICIOS TEMPORALES]',
  nit: '[NIT]',
  correo: '[correo de protección de datos]',
  politica: '[URL de la Política de Tratamiento de Datos Personales]',
};

/** Lo que acepta el TITULAR (el trabajador) para verificar que es él. */
export const TEXTO_TITULAR = `AUTORIZACIÓN PARA EL TRATAMIENTO DE DATOS BIOMÉTRICOS — VERIFICACIÓN DE IDENTIDAD EN ECONOMIAPP

Yo, como titular de la información, autorizo de manera previa, expresa e informada a ${RESPONSABLE.razonSocial} (NIT ${RESPONSABLE.nit}), en calidad de responsable del tratamiento, para que:

1. Capture una fotografía de mi rostro en este momento y la compare, mediante un sistema automatizado de reconocimiento facial, con la fotografía que entregué en mi proceso de contratación.
2. Use esa comparación con la única finalidad de confirmar que soy yo quien solicita, autoriza o reclama un pedido, bono o servicio en EconomiAPP, y de soportar el descuento por nómina que corresponda a mis compras, que yo autorizo por aparte.
3. Conserve la fotografía capturada, el resultado de la comparación y una huella digital (hash) de cada archivo como evidencia de la operación, durante el tiempo de la relación laboral y hasta por el término exigido por la ley para soportar los descuentos realizados.

Declaro que me informaron que:
• Los datos biométricos son datos sensibles y NO estoy obligado(a) a autorizar su tratamiento. Si no acepto, puedo verificar mi identidad en persona, presentando mi cédula original en el punto de entrega, sin perder el acceso a la tienda ni a mi cupo.
• La comparación se hace en servidores de la empresa; las imágenes no se entregan a terceros ni se usan para otra finalidad.
• Tengo derecho a conocer, actualizar, rectificar y solicitar la supresión de mis datos, a revocar esta autorización y a presentar quejas ante la Superintendencia de Industria y Comercio, escribiendo a ${RESPONSABLE.correo}, conforme a la Política de Tratamiento de Datos Personales publicada en ${RESPONSABLE.politica}. La revocatoria no procede mientras exista una obligación legal o contractual que exija conservar la evidencia.`;

/**
 * Lo que declara el TITULAR al dejar a OTRA persona como responsable de reclamar. Los datos
 * del tercero son de él, no del titular: por eso el titular declara que cuenta con su
 * autorización, y el tercero la ratifica en persona al reclamar ({@link TEXTO_TERCERO}).
 */
export const TEXTO_AUTORIZA_TERCERO = `AUTORIZACIÓN PARA QUE UN TERCERO RECLAME EN MI NOMBRE

Designo a la persona cuyos datos registro a continuación como responsable de reclamar mi pedido, bono o servicio. Declaro que:

1. Los datos, la fotografía y las imágenes del documento de identidad que estoy cargando corresponden a esa persona y son auténticos.
2. Cuento con su autorización previa y expresa para entregar sus datos personales, incluidos datos sensibles (fotografía de su rostro), a ${RESPONSABLE.razonSocial} con la única finalidad de verificar su identidad al momento de la entrega, y le informé sus derechos y que puede negarse.
3. Lo que esa persona reclame se entiende recibido por mí, y acepto que se aplique el descuento por nómina correspondiente, igual que si lo hubiera reclamado personalmente.
4. Puedo retirar esta designación desde EconomiAPP mientras el pedido no haya sido entregado.

Mi identidad como titular quedó verificada en este mismo acto, y la operación queda registrada con fecha, hora y huella digital (hash) de cada archivo.`;

/** Lo que ratifica el TERCERO en el punto, antes de que se le tome la foto de verificación. */
export const TEXTO_TERCERO = `Autorizo a ${RESPONSABLE.razonSocial} a tomar una fotografía de mi rostro y compararla con la que el titular registró, con la única finalidad de verificar mi identidad para entregarme este pedido. Sé que no estoy obligado(a) a hacerlo y que, si no acepto, puedo identificarme con mi cédula original ante el encargado del punto. Mis derechos los puedo ejercer en ${RESPONSABLE.correo}.`;

/** sha256 hex del texto exacto, para guardar con la aceptación (qué vio la persona). */
export async function huellaDelTexto(texto: string): Promise<string> {
  const datos = new TextEncoder().encode(texto);
  const hash = await crypto.subtle.digest('SHA-256', datos);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}
