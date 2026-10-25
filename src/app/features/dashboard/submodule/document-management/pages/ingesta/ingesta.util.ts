/**
 * Lógica pura de la mesa de ingesta: leer nombres de archivo, proponer tipo,
 * resumir el texto de un PDF y decidir el estado de cada ficha.
 *
 * Todo aquí es función pura y sin dependencias de Angular, a propósito: es la
 * parte que decide lo que el usuario ve en rojo o en verde, y es la que hay que
 * poder probar sin levantar un navegador (ver ingesta.util.spec.ts).
 */

import {
  ContextoPersona,
  DatoLeido,
  DocumentoExistente,
  EstadoFicha,
  FichaIngesta,
  LecturaAutomatica,
  SugerenciaTipo,
} from './ingesta.model';

/** Sin acentos, minúsculas, separadores unificados a un espacio. */
export function normalizar(s: string): string {
  return (s ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Una cédula colombiana razonable: 6 a 12 dígitos seguidos.
 *
 * Los límites se miran contra DÍGITOS, no contra palabra: `CC1032456789.pdf`
 * es como llegan la mitad de los archivos y con `\b` la letra pegada impedía
 * el reconocimiento. Lo que sí hay que evitar es cortar un número más largo
 * por la mitad, y de eso se encargan los lookarounds.
 */
const RE_CEDULA = /(?<!\d)\d{6,12}(?!\d)/g;

/**
 * Lee `cedula_tipo.pdf`, que es la convención de la ingesta masiva.
 *
 * Tolera lo que llega de verdad: `1032456789 - contrato.pdf`,
 * `CC1032456789_ARL.PDF`, `1032456789.pdf` a secas, y rutas con carpetas
 * (`BOGOTA/1032456789_eps.pdf`), donde la carpeta suele ser la categoría.
 */
export function leerNombreArchivo(ruta: string): { cedula: string; pista: string; carpeta: string } {
  const partes = (ruta ?? '').split('/').filter(Boolean);
  const base = partes.pop() ?? '';
  const carpeta = partes.length ? partes[partes.length - 1] : '';

  const sinExt = base.replace(/\.[a-z0-9]+$/i, '');
  const limpio = normalizar(sinExt);

  const encontrados = limpio.match(RE_CEDULA) ?? [];
  // La primera secuencia larga es la cédula: en `1032456789 arl 2026` el año
  // también casa como número, pero tiene 4 dígitos y el filtro lo descarta.
  const cedula = encontrados[0] ?? '';

  const pista = (cedula ? limpio.replace(cedula, ' ') : limpio)
    .replace(/\bcc\b|\bti\b|\bce\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { cedula, pista, carpeta: normalizar(carpeta) };
}

/** Palabras que no distinguen nada y solo ensucian el parecido. */
const VACIAS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'y', 'o', 'a', 'en', 'por', 'para',
  'documento', 'documentos', 'archivo', 'pdf', 'scan', 'escaneado', 'copia',
  'final', 'firmado', 'nuevo', 'v1', 'v2',
]);

function tokens(s: string): string[] {
  return normalizar(s).split(' ').filter(t => t.length > 2 && !VACIAS.has(t));
}

/**
 * Propone el tipo documental a partir del nombre del archivo y de la carpeta.
 *
 * Es parecido por tokens, no coincidencia exacta: los nombres reales son
 * `1032456789_examen_ingreso.pdf` y el tipo se llama "EXAMEN MEDICO DE
 * INGRESO". Se exige al menos un token en común, y la confianza es la fracción
 * de tokens del tipo que aparecen en el nombre — así "ARL" no le gana a "ARL
 * CERTIFICADO AFILIACION" cuando el archivo dice las tres palabras.
 */
export function sugerirTipo(
  pista: string,
  carpeta: string,
  tipos: { id: number; name: string }[]
): SugerenciaTipo | null {
  const base = `${pista} ${carpeta}`.trim();
  const tks = tokens(base);
  if (!tks.length || !tipos?.length) return null;

  let mejor: SugerenciaTipo | null = null;

  for (const t of tipos) {
    const tt = tokens(t.name);
    if (!tt.length) continue;

    const comunes = tt.filter(x => tks.includes(x));
    if (!comunes.length) continue;

    // Fracción del TIPO cubierta, con un pequeño premio si además el nombre del
    // archivo no trae mucho ruido alrededor.
    const cobertura = comunes.length / tt.length;
    const precision = comunes.length / tks.length;
    const confianza = Math.min(1, cobertura * 0.75 + precision * 0.25);

    if (!mejor || confianza > mejor.confianza) {
      mejor = {
        typeId: t.id,
        typeName: t.name,
        confianza: Number(confianza.toFixed(2)),
        porque: `Coincide «${comunes.join(' ')}» en el nombre del archivo`,
      };
    }
  }

  return mejor;
}

/** Umbral a partir del cual la sugerencia se aplica sola. Por debajo, se propone. */
export const CONFIANZA_AUTOMATICA = 0.6;

const PALABRAS_FACTURA = [
  'factura', 'facturacion', 'cuenta de cobro', 'nit', 'iva', 'subtotal',
  'total a pagar', 'valor total', 'retefuente', 'cufe', 'resolucion dian',
];

/** ¿Esto parece una factura? Se mira el texto y, si no hay, el nombre. */
export function pareceFactura(texto: string, nombre: string): boolean {
  const n = normalizar(`${texto} ${nombre}`);
  // "nit" e "iva" solos dan falsos positivos (una hoja de vida trae el NIT de
  // la empresa), así que se exigen dos señales salvo que diga "factura".
  if (/\bfactura\b|\bcuenta de cobro\b|\bcufe\b/.test(n)) return true;
  const señales = PALABRAS_FACTURA.filter(p => n.includes(p)).length;
  return señales >= 2;
}

const RE_NIT = /\bnit[^0-9]{0,8}(\d[\d.\-]{6,15}\d)/i;
const RE_FECHA = /\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2})\b/;
const RE_MONEDA = /\$\s?\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?/;

/** Datos sueltos que ayudan a reconocer el documento de un vistazo. */
export function extraerDatos(texto: string): DatoLeido[] {
  const out: DatoLeido[] = [];
  if (!texto) return out;

  const nit = texto.match(RE_NIT);
  if (nit) out.push({ etiqueta: 'NIT', valor: nit[1] });

  const fecha = texto.match(RE_FECHA);
  if (fecha) out.push({ etiqueta: 'Fecha', valor: fecha[1] });

  const monto = texto.match(RE_MONEDA);
  if (monto) out.push({ etiqueta: 'Valor', valor: monto[0].replace(/\s+/g, ' ') });

  return out;
}

/** Cédulas que aparecen DENTRO del texto, de la más repetida a la menos. */
export function cedulasEnTexto(texto: string): string[] {
  if (!texto) return [];
  const conteo = new Map<string, number>();
  for (const m of texto.match(RE_CEDULA) ?? []) {
    // Un año o un código postal no son cédulas; 7 dígitos es el piso real.
    if (m.length < 7) continue;
    conteo.set(m, (conteo.get(m) ?? 0) + 1);
  }
  return [...conteo.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([c]) => c);
}

/**
 * Resumen extractivo: frases REALES del documento, nunca texto inventado.
 *
 * Se eligen las primeras frases con sustancia (descartando cabeceras sueltas y
 * líneas de guiones). No es un modelo de lenguaje y no pretende serlo: es lo
 * que se puede afirmar con certeza sin gastar una llamada a la IA, y es lo que
 * el usuario necesita para decidir si el archivo es el que cree que es.
 */
export function resumirTexto(texto: string, maximo = 4): string[] {
  if (!texto) return [];

  const frases = texto
    .replace(/\s+/g, ' ')
    .split(/(?<=[.;:])\s+|\n+/)
    .map(f => f.trim())
    .filter(f => f.length >= 25 && f.length <= 260)
    .filter(f => /[a-záéíóúñ]{4,}/i.test(f));

  const vistas = new Set<string>();
  const out: string[] = [];
  for (const f of frases) {
    const clave = normalizar(f).slice(0, 40);
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    out.push(f);
    if (out.length >= maximo) break;
  }
  return out;
}

/** Arma la lectura automática a partir del texto que dio el visor de PDF. */
export function analizarTexto(texto: string, nombre: string, paginas: number | null): LecturaAutomatica {
  const limpio = (texto ?? '').trim();
  // Un PDF escaneado devuelve cuatro caracteres sueltos del sello, no texto.
  const requiereOcr = limpio.replace(/\s/g, '').length < 40;

  return {
    texto: limpio,
    paginas,
    esFactura: pareceFactura(limpio, nombre),
    resumen: requiereOcr ? [] : resumirTexto(limpio),
    datos: extraerDatos(limpio),
    requiereOcr,
    cedulasDetectadas: cedulasEnTexto(limpio),
  };
}

/**
 * El vigente del mismo tipo que este archivo va a desplazar.
 *
 * Ojo con el matiz del backend: cada subida crea un Document NUEVO con su
 * versión 1; el anterior no se borra ni se marca histórico. Así que "reemplaza"
 * aquí significa "a partir de ahora el último de este tipo será este", que es
 * lo que ve quien consulta el expediente, no que el otro desaparezca.
 */
export function vigenteDelTipo(
  contexto: ContextoPersona | null,
  typeId: number | null,
  contrato: string
): DocumentoExistente | null {
  if (!contexto || !typeId) return null;

  const mismos = contexto.documentos.filter(d => d.typeId === typeId);
  if (!mismos.length) return null;

  const delContrato = contrato
    ? mismos.filter(d => !d.contrato || d.contrato === contrato)
    : mismos;

  const candidatos = delContrato.length ? delContrato : mismos;
  const vigentes = candidatos.filter(d => d.vigente);
  const lista = vigentes.length ? vigentes : candidatos;

  return [...lista].sort((a, b) => (b.subidoEn ?? '').localeCompare(a.subidoEn ?? ''))[0] ?? null;
}

/** ¿Este mismo archivo ya está cargado? Se compara por título, sin extensión. */
export function esDuplicadoExacto(ficha: FichaIngesta, contexto: ContextoPersona | null): boolean {
  if (!contexto) return false;
  const mio = normalizar(ficha.nombre.replace(/\.[a-z0-9]+$/i, ''));
  if (!mio) return false;
  return contexto.documentos.some(
    d => d.typeId === ficha.typeId && normalizar((d.titulo ?? '').replace(/\.[a-z0-9]+$/i, '')) === mio
  );
}

/**
 * Estado de la ficha. El primero que aplique gana; los bloqueantes van primero.
 *
 * No se recalcula sobre fichas ya procesadas: una vez registrada o fallida, el
 * estado es un hecho y no una evaluación.
 */
export function estadoDeFicha(ficha: FichaIngesta, contexto: ContextoPersona | null): { estado: EstadoFicha; motivo: string } {
  if (ficha.estado === 'omitido' || ficha.estado === 'subiendo'
    || ficha.estado === 'registrado' || ficha.estado === 'error') {
    return { estado: ficha.estado, motivo: ficha.motivo };
  }

  if (!ficha.cedula) {
    return { estado: 'sin_persona', motivo: 'Falta la cédula del destinatario' };
  }
  if (contexto && contexto.cedula === ficha.cedula && !contexto.cargando && !contexto.existe) {
    return {
      estado: 'sin_persona',
      motivo: `La cédula ${ficha.cedula} no figura en contratación`,
    };
  }
  if (!ficha.typeId) {
    return { estado: 'sin_tipo', motivo: 'Falta el tipo documental' };
  }
  if (esDuplicadoExacto(ficha, contexto)) {
    return { estado: 'duplicado', motivo: 'Ya hay un documento con este mismo nombre y tipo' };
  }
  if (ficha.reemplazaA) {
    return {
      estado: 'reemplaza',
      motivo: `Pasa a ser el último «${ficha.reemplazaA.typeName}» del expediente`,
    };
  }
  return { estado: 'listo', motivo: 'Nuevo en el expediente' };
}

/** Estados que impiden registrar. `duplicado` NO bloquea: avisa y deja decidir. */
export const ESTADOS_BLOQUEANTES: EstadoFicha[] = ['sin_persona', 'sin_tipo'];

export function puedeRegistrarse(ficha: FichaIngesta): boolean {
  return !ESTADOS_BLOQUEANTES.includes(ficha.estado)
    && ficha.estado !== 'omitido'
    && ficha.estado !== 'registrado'
    && ficha.estado !== 'subiendo';
}

/** Etiquetas de estado para la UI, en un solo sitio. */
export const ETIQUETA_ESTADO: Record<EstadoFicha, string> = {
  sin_persona: 'Sin persona',
  sin_tipo: 'Sin tipo',
  duplicado: 'Ya existe',
  reemplaza: 'Reemplaza',
  listo: 'Nuevo',
  omitido: 'Omitido',
  subiendo: 'Registrando…',
  registrado: 'Registrado',
  error: 'Error',
};

/** Tamaño legible, con la coma decimal que usa el resto de la plataforma. */
export function tamanoLegible(bytes: number): string {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}
