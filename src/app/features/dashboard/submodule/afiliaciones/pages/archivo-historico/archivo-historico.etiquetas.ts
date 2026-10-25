/** Etiquetas legibles de los códigos del archivo histórico (el backend guarda códigos). */

export const ETIQUETA_EMPRESA: Record<string, string> = {
  TU_ALIANZA: 'Tu Alianza',
  APOYO_LABORAL: 'Apoyo Laboral',
  SIN_DATO: 'Sin empresa',
};

export const ETIQUETA_TRAMITE: Record<string, string> = {
  EPS: 'EPS',
  EPS_EXTEMPORANEAS: 'EPS extemporánea',
  CAJA: 'Caja de compensación',
  CAJA_EXTEMPORANEA: 'Caja extemporánea',
  PENSION: 'Fondo de pensiones',
  BENEFICIARIOS: 'Beneficiarios',
  PLANOS_CARGUE: 'Planos de cargue',
  SIN_DATO: 'Sin trámite',
};

export const ETIQUETA_UBICACION: Record<string, string> = {
  ARCHIVO: 'Archivo',
  COMPARTIDO: 'Compartido',
  POR_REVISAR: 'Por revisar',
  DUPLICADO: 'Duplicado',
};

export const ETIQUETA_ESTADO: Record<string, string> = {
  OK: 'OK',
  SUBIDO: 'Subido',
  RADICADO: 'Radicado',
  PENDIENTE: 'Pendiente',
  POR_SUBIR: 'Por subir',
  POR_DESCARGAR: 'Por descargar',
  POR_IMPRIMIR: 'Por imprimir',
  DESCARGA: 'Descargado sin renombrar',
  CARGUE_SEVENET: 'Cargue Sevenet',
  CORREO: 'Correo',
  EXTRA: 'Extra',
  VARIAS: 'Varias',
  REPETIDA: 'Repetida',
};

export const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function etiqueta(mapa: Record<string, string>, clave: string | null | undefined): string {
  if (!clave) return '—';
  return mapa[clave] ?? clave.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());
}

/** 'aaaa-mm' → 'ene 2024'. */
export function periodoCorto(p: string): string {
  const [a, m] = p.split('-');
  return `${MESES_CORTOS[Number(m) - 1] ?? m} ${a}`;
}
