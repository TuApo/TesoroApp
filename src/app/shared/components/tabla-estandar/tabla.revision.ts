import { textoDeValor, type BadgeCelda, type ColumnaTabla, type ValorCelda } from './tabla.tipos';

/**
 * FICHA DE UN REGISTRO — lo que se enseña al revisar la selección.
 *
 * La tabla solo pinta las columnas que la pantalla declaró, pero cada fila
 * suele traer bastante más: fotos, rutas de soportes, fechas de auditoría,
 * banderas. Aquí se mira el registro entero y se ordena por lo que ES cada
 * dato, no por el orden en que venga, para que todas las pantallas enseñen su
 * detalle igual.
 */

export type TipoCampo = 'texto' | 'numero' | 'fecha' | 'booleano' | 'estado' | 'enlace' | 'lista' | 'vacio';

export interface CampoFicha {
  clave: string;
  etiqueta: string;
  tipo: TipoCampo;
  /** Ya formateado para leer. */
  texto: string;
  badge?: BadgeCelda | null;
  /** Solo en 'enlace': a dónde apunta. */
  url?: string;
  /** Viene de una columna de la tabla (no de los datos crudos). */
  declarado: boolean;
}

export interface MedioFicha {
  clave: string;
  etiqueta: string;
  url: string;
  /** Extensión en mayúsculas para el distintivo del documento. */
  extension: string;
}

export interface FichaRegistro {
  nombre: string;
  id: string;
  /** Primera foto, si la hay: es la miniatura del carrusel. */
  portada: string | null;
  fotos: MedioFicha[];
  documentos: MedioFicha[];
  grupos: { titulo: string; icono: string; campos: CampoFicha[] }[];
  totalCampos: number;
}

const RE_IMAGEN = /\.(png|jpe?g|webp|gif|avif|bmp|svg)(\?|#|$)/i;
const RE_DOC = /\.(pdf|docx?|xlsx?|pptx?|csv|txt|zip|rar|xml|json)(\?|#|$)/i;
const RE_URL = /^(https?:\/\/|\/|data:image\/)/i;
const CLAVE_FOTO = /foto|imagen|image|avatar|selfie|photo|portada|huella/i;
const CLAVE_DOC = /documento|archivo|soporte|adjunto|anexo|contrato|certificad|pdf|file|url/i;
const CLAVE_ID = /^(id|codigo|c[oó]digo|uuid|consecutivo)$|_id$|^n[uú]mero_?doc|^cedula$|^documento$|identificaci/i;
const CLAVE_FECHA = /fecha|_at$|_en$|creado|actualizado|vence|inicio|fin|nacimiento/i;
const OCULTAS = /^(password|clave|token|secret|hash)/i;

/** 'fecha_de_ingreso' o 'fechaDeIngreso' → 'Fecha de ingreso'. */
export function etiquetaDeClave(clave: string): string {
  const roto = clave
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return roto.charAt(0).toUpperCase() + roto.slice(1);
}

function extensionDe(url: string): string {
  const m = /\.([a-z0-9]{2,5})(\?|#|$)/i.exec(url);
  return m ? m[1].toUpperCase() : 'ARCHIVO';
}

function esImagen(clave: string, valor: string): boolean {
  if (valor.startsWith('data:image/')) return true;
  if (!RE_URL.test(valor)) return false;
  return RE_IMAGEN.test(valor) || (CLAVE_FOTO.test(clave) && !RE_DOC.test(valor));
}

function esDocumento(clave: string, valor: string): boolean {
  if (!RE_URL.test(valor)) return false;
  return RE_DOC.test(valor) || CLAVE_DOC.test(clave);
}

/** Tipo de un valor suelto de los datos crudos. */
function tipoDeValor(clave: string, v: unknown): TipoCampo {
  if (v === null || v === undefined || v === '') return 'vacio';
  if (typeof v === 'boolean') return 'booleano';
  if (typeof v === 'number') return 'numero';
  if (v instanceof Date) return 'fecha';
  if (Array.isArray(v)) return 'lista';
  if (typeof v === 'object') return 'lista';
  const texto = String(v);
  if (RE_URL.test(texto)) return 'enlace';
  if (CLAVE_FECHA.test(clave) && /^\d{4}-\d{2}-\d{2}/.test(texto)) return 'fecha';
  return 'texto';
}

function textoDeCrudo(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.length ? `${v.length} elemento(s)` : 'Vacío';
  if (v instanceof Date) return v.toLocaleString();
  if (typeof v === 'object') return Object.keys(v as object).length ? 'Ver detalle' : 'Vacío';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  return String(v);
}

/** En qué bloque cae cada campo. El orden de esta lista es el de la ficha. */
const GRUPOS: { titulo: string; icono: string; acepta: (c: CampoFicha) => boolean }[] = [
  { titulo: 'Identificación', icono: 'badge', acepta: (c) => CLAVE_ID.test(c.clave) },
  { titulo: 'Estados', icono: 'flag', acepta: (c) => c.tipo === 'estado' || c.tipo === 'booleano' },
  { titulo: 'Fechas', icono: 'event', acepta: (c) => c.tipo === 'fecha' },
  { titulo: 'Números', icono: 'tag', acepta: (c) => c.tipo === 'numero' },
  { titulo: 'Enlaces', icono: 'link', acepta: (c) => c.tipo === 'enlace' },
  { titulo: 'Datos', icono: 'notes', acepta: () => true },
];

/**
 * Arma la ficha de una fila: sus columnas declaradas (con el formato que ya
 * usa la tabla) más el resto de campos del registro, sin repetir.
 */
export function fichaDeRegistro<T>(
  fila: T,
  columnas: ColumnaTabla<T>[],
  formatoFecha: (v: ValorCelda) => string | null,
): FichaRegistro {
  const campos: CampoFicha[] = [];
  const fotos: MedioFicha[] = [];
  const documentos: MedioFicha[] = [];
  const vistas = new Set<string>();

  const agregarMedio = (clave: string, texto: string): boolean => {
    if (esImagen(clave, texto)) {
      fotos.push({ clave, etiqueta: etiquetaDeClave(clave), url: texto, extension: extensionDe(texto) });
      return true;
    }
    if (esDocumento(clave, texto)) {
      documentos.push({ clave, etiqueta: etiquetaDeClave(clave), url: texto, extension: extensionDe(texto) });
      return true;
    }
    return false;
  };

  // 1) Lo que la pantalla declaró como columnas: manda su etiqueta y su formato.
  for (const c of columnas) {
    if (c.tarjeta === 'oculto') continue;
    let valor: ValorCelda;
    try {
      valor = c.valor(fila);
    } catch {
      continue;
    }
    const badge = c.badge ? c.badge(fila) : null;
    const plano = textoDeValor(valor);
    if (plano && agregarMedio(c.id, plano)) { vistas.add(c.id); continue; }
    let texto = '';
    try {
      texto = c.formato ? c.formato(fila) : (formatoFecha(valor) ?? plano);
    } catch {
      texto = plano;
    }
    const tipo: TipoCampo = badge ? 'estado'
      : valor instanceof Date ? 'fecha'
        : typeof valor === 'number' ? 'numero'
          : typeof valor === 'boolean' ? 'booleano'
            : tipoDeValor(c.id, valor);
    campos.push({
      clave: c.id, etiqueta: c.header, tipo,
      texto: texto || (tipo === 'vacio' ? '—' : plano), badge,
      url: tipo === 'enlace' ? plano : undefined,
      declarado: true,
    });
    vistas.add(c.id);
  }

  // 2) El resto del registro: lo que la tabla no enseña pero el operador
  //    necesita para decidir (fotos, soportes, auditoría…).
  const crudo = (fila ?? {}) as Record<string, unknown>;
  if (crudo && typeof crudo === 'object') {
    for (const clave of Object.keys(crudo)) {
      if (vistas.has(clave) || OCULTAS.test(clave)) continue;
      const v = crudo[clave];
      const tipo = tipoDeValor(clave, v);
      if (tipo === 'vacio') continue;
      const texto = textoDeCrudo(v);
      if (typeof v === 'string' && agregarMedio(clave, v)) continue;
      campos.push({
        clave, etiqueta: etiquetaDeClave(clave), tipo,
        texto, url: tipo === 'enlace' ? texto : undefined, declarado: false,
      });
    }
  }

  const grupos = GRUPOS
    .map((g) => ({ titulo: g.titulo, icono: g.icono, campos: [] as CampoFicha[] }));
  for (const campo of campos) {
    const i = GRUPOS.findIndex((g) => g.acepta(campo));
    grupos[i === -1 ? grupos.length - 1 : i].campos.push(campo);
  }

  return {
    nombre: nombreDeRegistro(campos),
    id: idDeRegistro(campos, crudo),
    portada: fotos[0]?.url ?? null,
    fotos,
    documentos,
    grupos: grupos.filter((g) => g.campos.length),
    totalCampos: campos.length,
  };
}

/** El nombre que se enseña en el carrusel: el primer texto con sustancia. */
function nombreDeRegistro(campos: CampoFicha[]): string {
  const candidato = campos.find(
    (c) => c.declarado && c.tipo === 'texto' && c.texto.trim().length > 1 && !CLAVE_ID.test(c.clave));
  return candidato?.texto.trim() || campos.find((c) => c.texto.trim())?.texto.trim() || 'Registro';
}

/** El id que se enseña bajo el nombre: lo primero que identifique de verdad. */
function idDeRegistro(campos: CampoFicha[], crudo: Record<string, unknown>): string {
  const porClave = campos.find((c) => CLAVE_ID.test(c.clave) && c.texto.trim());
  if (porClave) return porClave.texto.trim();
  for (const k of ['id', 'codigo', 'code', 'uuid']) {
    const v = crudo?.[k];
    if (v !== undefined && v !== null && v !== '') return String(v);
  }
  return '';
}
