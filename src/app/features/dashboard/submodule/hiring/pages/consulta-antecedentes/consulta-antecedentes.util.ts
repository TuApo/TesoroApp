/**
 * Reglas puras de Consulta de antecedentes (sin Angular, para poder probarlas).
 *
 * La pantalla consulta cédulas que todavía NO son candidatos: llegan escritas a
 * mano o en un Excel con cualquier formato (puntos de miles, espacios, celdas
 * numéricas, encabezados distintos), así que todo pasa por aquí antes de encolar.
 */

/** Tope por carga: la flota completa ~100 personas/hora y los portales bloquean por volumen. */
export const MAX_CEDULAS_CARGA = 300;

/** Tipos de documento que entiende la cola del robot. */
export const TIPOS_DOC = ['CC', 'CE', 'PPT', 'PEP', 'TI'] as const;
export type TipoDoc = (typeof TIPOS_DOC)[number];

export interface CedulaLeida {
  cedula: string;
  tipo: TipoDoc;
}

export interface LecturaCedulas {
  validas: CedulaLeida[];
  /** Lo que se escribió y no parece una cédula (texto, muy corta o muy larga). */
  invalidas: string[];
  /** Cédulas repetidas dentro de la misma carga (se encolan una vez). */
  duplicadas: number;
}

/**
 * Cédula limpia o null. Acepta "1.122.415.324", " 1122415324 ", 1122415324 (número de
 * Excel) y "CC 1122415324". Solo dígitos, 5 a 11.
 */
export function limpiarCedula(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  let s = typeof v === 'number' ? String(Math.trunc(v)) : String(v);
  s = s.trim();
  if (!s) return null;
  // Un Excel puede traer "1122415324.0" o notación científica si la celda era número.
  if (/^\d+(\.0+)?$/.test(s)) s = s.replace(/\.0+$/, '');
  else if (/^\d+(\.\d+)?e\+?\d+$/i.test(s)) s = String(Math.trunc(Number(s)));
  const digitos = s.replace(/[^\d]/g, '');
  // Si había letras además del tipo de documento, no es una cédula.
  const resto = s.replace(/[\d\s.,\-]/g, '').toUpperCase();
  if (resto && !(TIPOS_DOC as readonly string[]).includes(resto)) return null;
  if (digitos.length < 5 || digitos.length > 11) return null;
  return digitos.replace(/^0+(?=\d{5})/, '');
}

export function tipoDocCanonico(v: unknown): TipoDoc {
  const t = String(v ?? '').toUpperCase().replace(/[\s._-]/g, '');
  if (t === 'PET') return 'PPT';
  return (TIPOS_DOC as readonly string[]).includes(t) ? (t as TipoDoc) : 'CC';
}

/** Junta valores (texto pegado o celdas) en cédulas válidas, sin repetidas. */
export function leerCedulas(entradas: { valor: unknown; tipo?: unknown }[]): LecturaCedulas {
  const vistas = new Set<string>();
  const validas: CedulaLeida[] = [];
  const invalidas: string[] = [];
  let duplicadas = 0;
  for (const e of entradas) {
    const crudo = String(e.valor ?? '').trim();
    if (!crudo) continue;
    const ced = limpiarCedula(e.valor);
    if (!ced) {
      invalidas.push(crudo);
      continue;
    }
    if (vistas.has(ced)) {
      duplicadas++;
      continue;
    }
    vistas.add(ced);
    validas.push({ cedula: ced, tipo: tipoDocCanonico(e.tipo) });
  }
  return { validas, invalidas, duplicadas };
}

/** Texto pegado: una cédula por línea, o separadas por coma, punto y coma o tabulador. */
export function partirTexto(texto: string): { valor: unknown }[] {
  return String(texto ?? '')
    .split(/[\n\r;,\t]+/)
    .map((v) => ({ valor: v }));
}

const normalizar = (v: unknown) =>
  String(v ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Filas de la primera hoja → entradas. Busca en las 5 primeras filas un encabezado
 * de cédula (cedula, documento, identificacion, numero_documento, cc…) y, si lo hay,
 * uno de tipo de documento. Sin encabezado se toma la primera columna con cédulas.
 */
export function entradasDeHoja(filas: unknown[][]): { valor: unknown; tipo?: unknown }[] {
  const esCol = (h: string) =>
    ['cedula', 'cedulas', 'documento', 'numerodocumento', 'numerodedocumento', 'nodocumento', 'numerodeidentificacion',
      'identificacion', 'numeroidentificacion', 'cc', 'nit', 'numerocedula'].includes(h);
  const esTipo = (h: string) => ['tipo', 'tipodocumento', 'tipodedocumento', 'tipodoc', 'tipoidentificacion', 'tipodeidentificacion'].includes(h);

  let filaEnc = -1;
  let colCed = -1;
  let colTipo = -1;
  for (let i = 0; i < Math.min(5, filas.length) && filaEnc < 0; i++) {
    const f = filas[i] ?? [];
    f.forEach((c, j) => {
      const h = normalizar(c);
      if (colCed < 0 && esCol(h)) colCed = j;
      if (colTipo < 0 && esTipo(h)) colTipo = j;
    });
    if (colCed >= 0) filaEnc = i;
    else colTipo = -1;
  }

  if (colCed < 0) {
    // Sin encabezado: la primera columna donde haya al menos una cédula.
    const ancho = Math.max(0, ...filas.map((f) => (f ?? []).length));
    for (let j = 0; j < ancho && colCed < 0; j++) {
      if (filas.some((f) => limpiarCedula((f ?? [])[j]))) colCed = j;
    }
    if (colCed < 0) return [];
  }

  return filas
    .slice(filaEnc + 1)
    .map((f) => ({ valor: (f ?? [])[colCed], tipo: colTipo >= 0 ? (f ?? [])[colTipo] : undefined }));
}

/* ------------------------------------------------------------------ */
/*  Fuentes                                                            */
/* ------------------------------------------------------------------ */

export interface FuenteAntecedente {
  /** Sufijo en la cola (`estado_<cola>`). */
  cola: string;
  /** Clave del veredicto en /Robots/resultados-antecedentes. */
  veredicto: string;
  etiqueta: string;
  /** Las 6 bloqueantes cuentan para "completa"; AFP y RNMC son opcionales. */
  obligatoria: boolean;
}

export const FUENTES: FuenteAntecedente[] = [
  { cola: 'adress', veredicto: 'eps', etiqueta: 'ADRES (EPS)', obligatoria: true },
  { cola: 'procuraduria', veredicto: 'procuraduria', etiqueta: 'Procuraduría', obligatoria: true },
  { cola: 'contraloria', veredicto: 'contraloria', etiqueta: 'Contraloría', obligatoria: true },
  { cola: 'policivo', veredicto: 'policivos', etiqueta: 'Policía', obligatoria: true },
  { cola: 'ofac', veredicto: 'ofac', etiqueta: 'OFAC', obligatoria: true },
  { cola: 'sisben', veredicto: 'sisben', etiqueta: 'Sisbén', obligatoria: true },
  { cola: 'fondo_pension', veredicto: 'afp', etiqueta: 'AFP', obligatoria: false },
  { cola: 'medidas_correctivas', veredicto: 'medidas_correctivas', etiqueta: 'Medidas correctivas', obligatoria: false },
];

/** Tipos de documento (ms-documents) de los PDF de antecedentes, igual que el `typeMap` de la ficha. */
export const TIPOS_PDF_ANTECEDENTES: Record<number, string> = {
  7: 'ADRES (EPS)', 3: 'Procuraduría', 4: 'Contraloría', 6: 'Policía', 12: 'Rama judicial',
  5: 'OFAC', 8: 'Sisbén', 11: 'AFP', 10: 'Medidas correctivas',
};

export type EstadoFuente = 'sin_fila' | 'en_cola' | 'consultando' | 'bloqueado' | 'consultado';

export function estadoFuente(estadoCola: string | null | undefined): EstadoFuente {
  switch (String(estadoCola ?? '').toUpperCase()) {
    case '': return 'sin_fila';
    case 'SIN_CONSULTAR': return 'en_cola';
    case 'EN_PROGRESO': return 'consultando';
    case 'BLOQUEADO': return 'bloqueado';
    case 'FINALIZADO': return 'consultado';
    default: return 'en_cola';
  }
}

/** Partir una lista en tandas de `n`. */
export function enTandas<T>(lista: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n));
  return out;
}
