/**
 * Tipo de documento CANONICO del trabajador (reunion funcional 2026-10-05).
 *
 * En el registro de incapacidades se escoge primero el tipo de documento y luego se busca
 * (la base de contratacion tiene el mismo numero en fichas de tipos distintos: CC y PPT,
 * PET y PPT...). La base guarda el tipo crudo con muchas grafias ("C.C", "P.P.T", "PET",
 * "PAS"), asi que todo se reduce a cinco tipos.
 *
 * Espejo de `TipoDocumentoCanonico` de ms-hr: CC <- {CC, C.C, C.C., CEDULA, CEDULA DE
 * CIUDADANIA}; PPT <- {PPT, P.P.T, PET, PT, PEP, P.E.P}; CE <- {CE, C.E}; TI <- {TI, T.I};
 * PA <- {PA, PAS, PASAPORTE}; cualquier otra cosa -> null (no se adivina).
 */
export type TipoDocumentoCanonico = 'CC' | 'CE' | 'PPT' | 'TI' | 'PA';

export interface OpcionTipoDocumento {
  valor: TipoDocumentoCanonico;
  etiqueta: string;
}

/** Orden en el que se ofrecen (el mas comun primero). NIT no aplica a un trabajador. */
export const TIPOS_DOCUMENTO_CANONICOS: readonly OpcionTipoDocumento[] = [
  { valor: 'CC', etiqueta: 'Cédula de ciudadanía' },
  { valor: 'CE', etiqueta: 'Cédula de extranjería' },
  { valor: 'PPT', etiqueta: 'Permiso por protección temporal (incluye PEP/PET)' },
  { valor: 'TI', etiqueta: 'Tarjeta de identidad' },
  { valor: 'PA', etiqueta: 'Pasaporte' },
];

/**
 * Grafias reconocidas, ya SIN puntos ni tildes y en mayusculas (por eso "C.C." y "C.C"
 * caen en "CC" y "P.E.P" en "PEP").
 */
const ALIAS: Readonly<Record<string, TipoDocumentoCanonico>> = {
  CC: 'CC',
  CEDULA: 'CC',
  'CEDULA DE CIUDADANIA': 'CC',
  PPT: 'PPT',
  PET: 'PPT',
  PT: 'PPT',
  PEP: 'PPT',
  CE: 'CE',
  TI: 'TI',
  PA: 'PA',
  PAS: 'PA',
  PASAPORTE: 'PA',
};

/** El canonico de un tipo crudo, o `null` si no se reconoce (nunca se adivina). */
export function canonizarTipoDocumento(crudo: string | null | undefined): TipoDocumentoCanonico | null {
  const clave = (crudo ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return ALIAS[clave] ?? null;
}

/** Etiqueta legible de un tipo canonico ('' si no lo es). */
export function etiquetaTipoDocumento(tipo: string | null | undefined): string {
  return TIPOS_DOCUMENTO_CANONICOS.find((t) => t.valor === tipo)?.etiqueta ?? '';
}

/**
 * Lo escrito en el buscador es un NUMERO de documento (tiene digitos) y no un nombre. Una X
 * inicial seguida de digitos es la marca con la que contratacion guardaba los PPT/PEP.
 */
export function pareceNumeroDocumento(texto: string | null | undefined): boolean {
  return /\d/.test(texto ?? '');
}

/** El numero empieza por X (marca de PPT/PEP en la base de contratacion). */
export function empiezaConX(texto: string | null | undefined): boolean {
  return /^\s*x/i.test(texto ?? '') && pareceNumeroDocumento(texto);
}
