export type Temporal = 'APOYO LABORAL SAS' | 'TU ALIANZA SAS';

export type DocSeccion =
  | 'generales'
  | 'contrato'
  | 'entrega-empresa'
  | 'flores'
  | 'sagaro'
  | 'ipanema'
  | 'subir-manual';

export interface PerfilEmpresa {
  /** Nombre descriptivo del perfil — se usa en logs. */
  nombre: string;
  /** Mayor número = mayor prioridad. Resuelve cuando varios perfiles aplican. */
  prioridad: number;
  /** Si está, la temporal de la vacante DEBE coincidir. */
  matchTemporal?: Temporal;
  /** Si está, alguna regex DEBE matchear `empresaUsuariaSolicita` (normalizada). */
  matchEmpresa?: RegExp[];
  /** Si está, alguna regex DEBE matchear `finca` (normalizada). */
  matchFinca?: RegExp[];
  /** Whitelist exacta de títulos visibles. Lo que no esté acá NO se muestra. */
  documentos: string[];
}

// Sets reutilizables para no repetir en cada perfil
const COMUN_BASE_APOYO_BLU = [
  'Ficha Técnica',
  'Ficha Social',
  'Cédula',
  'Autorización Ingreso',
  'Contrato',
  'Inducción',
  'ARL',
  'Hoja de Vida Minerva',
  'Figura Humana',
  'Prueba Lectoescritura',
  'SST',
  'Prueba SST',
  'Otras Pruebas',
  'EPS',
  'CCF',
  'Pago Seguridad Social',
  'Diplomas y Certificados de Estudios',
  'Referencias (1 personal, 1 familiar, 2 laborales)',
  'Carnet',
];

const COMUN_BASE_TA = [
  'Ficha Técnica',
  'Cédula',
  'Entrevista de Ingreso Tu Alianza',
  'Contrato',
  'Contratos Otrosí',
  'ARL',
  'Hoja de Vida Minerva',
  'Figura Humana',
  'Prueba Lectoescritura',
  'SST',
  'Prueba SST',
  'Otras Pruebas',
  'EPS',
  'CCF',
  'Pago Seguridad Social',
  'Diplomas y Certificados de Estudios',
  'Referencias (1 personal, 1 familiar, 2 laborales)',
  // Cartas transversales a la temporal: aplican a cualquier candidato de
  // Tu Alianza, no sólo a Jardines de los Andes. Se generan como PDF
  // (ver `cartas-tu-alianza-fill.ts`).
  'Carta Descuento de Flor',
  'Formato Timbre Ingreso/Salida',
  'Carta Autorización Correo Electrónico',
];

/** Las tres cartas de arriba, para los perfiles TA que no heredan COMUN_BASE_TA. */
const CARTAS_TA = [
  'Carta Descuento de Flor',
  'Formato Timbre Ingreso/Salida',
  'Carta Autorización Correo Electrónico',
];

export const PERFILES_EMPRESA: PerfilEmpresa[] = [
  // ════════════════════════════════════════════════════════════════
  // PRIORIDAD 100 — Por finca (gana sobre la empresa)
  // ════════════════════════════════════════════════════════════════
  {
    nombre: 'Administrativos',
    prioridad: 100,
    matchEmpresa: [/ADMINISTRATIV/i],
    matchFinca:   [/ADMINISTRATIV/i],
    documentos: [
      'Hoja de Vida Minerva',
      'Cédula',
      'Tarjeta de Propiedad',
      'Licencia de Conducción',
      'Diplomas y Certificados de Estudios',
      'Referencias (1 personal, 1 familiar, 2 laborales)',
      'Autorización Ingreso',
      'Ficha Técnica',
      'Contrato',
      'Inducción Administrativos',
      'Acta de Funciones',
      'Acta de Herramientas de Trabajo',
      'Acta de Dotaciones',
      'ARL',
      'Colinesterasa',
      'Entrevista de Ingreso Tu Alianza',
      'Visita Domiciliaria',
      'Fotografías Visita Domiciliaria',
      'Prueba de Conocimiento',
      'Figura Humana',
      'Test del Árbol',
      'Acta de Funciones de SST',
      'Planilla SST',
      'Evaluación SST',
      'CCF',
      'EPS',
      'Pago Seguridad Social',
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // PRIORIDAD 90 — APOYO LABORAL específicos
  // ════════════════════════════════════════════════════════════════
  {
    // Grupo Elite: 7 empresas comparten la misma matriz V11
    // (THE ELITE FLOWER, FANTASY FLOWERS, MERCEDES, WAYUU FLOWERS, PETALIA, SAN JUAN, FLORALEZA)
    nombre: 'Elite (grupo de 7 empresas)',
    prioridad: 90,
    matchEmpresa: [
      /THE\s+ELITE\s+FLOWER/i,
      /FANTASY\s+FLOWERS/i,
      /\bMERCEDES\b/i,
      /WAYUU\s+FLOWERS/i,
      /\bPETALIA\b/i,
      /\bSAN\s+JUAN\b/i,
      /\bFLORALEZA\b/i,
    ],
    documentos: [
      ...COMUN_BASE_APOYO_BLU,
      'Manejo Imagen',
      'Colinesterasa',
      'Historial Laboral (Semanas Cotizadas)',
      'Formato Resultado Prueba Valanti',
    ],
  },
  {
    nombre: 'Elite Blu',
    prioridad: 90,
    matchEmpresa: [/ELITE\s+BLU/i],
    documentos: [
      ...COMUN_BASE_APOYO_BLU,
      'Manejo Imagen',
      'Referenciación',
      'Prueba Técnica Formato Elite',
      'Colinesterasa',
      'Curso Manipulación de Alimentos',
      'Historial Laboral (Semanas Cotizadas)',
      'Formato Resultado Prueba Valanti',
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // PRIORIDAD 90 — TU ALIANZA específicos
  // ════════════════════════════════════════════════════════════════
  {
    nombre: 'Jardines de los Andes',
    prioridad: 90,
    matchEmpresa: [
      /JARDINES\s+DE\s+LOS\s+ANDES/i,
      /\bAMANCAY\b/i,
      /\bVALMAR\b/i,
      /\bCALAFATE\b/i,
      /CAMPO\s+VERDE/i,
      /\bHMVE\b/i,
      /YUNDAMA|CURUBITAL/i,
    ],
    documentos: [
      // Las 3 cartas ya vienen en COMUN_BASE_TA.
      ...COMUN_BASE_TA.filter(t => t !== 'Inducción'),
      'Inducción Jardines de los Andes',
      'Autorización de Datos',
      'Colinesterasa',
      'OTRO SI Jornada Laboral',
    ],
  },
  {
    nombre: 'Agricola Cardenal',
    prioridad: 90,
    matchEmpresa: [/AGRICOLA\s+CARDENAL/i],
    documentos: [
      // Lista restrictiva — no incluye Otros si (per matriz oficial V6)
      'Ficha Técnica',
      'Cédula',
      'Entrevista de Ingreso Tu Alianza',
      'Contrato',
      'Inducción Agrícola',
      'ARL',
      'Colinesterasa',
      'Hoja de Vida Minerva',
      'Referencias (1 personal, 1 familiar, 2 laborales)',
      'Diplomas y Certificados de Estudios',
      'Prueba Lectoescritura',
      'Figura Humana',
      'SST',
      'Prueba SST',
      'Otras Pruebas',
      'CCF',
      'EPS',
      'Pago Seguridad Social',
      ...CARTAS_TA,
    ],
  },
  {
    nombre: 'Sagaro',
    prioridad: 90,
    matchEmpresa: [/SAGARO/i],
    matchFinca:   [/SAGARO/i],
    documentos: [
      ...COMUN_BASE_TA,
      'Inducción Sagaro',
      'Sagaro Lockers',
      'Sagaro Imagen',
      'Sagaro Celular',
      'OTRO SI Sagaro Fumigador',
      'Formato de Bonificación Ipanema',
      'Prueba Psicotécnica',
    ],
  },
  {
    nombre: 'Ipanema',
    prioridad: 90,
    matchEmpresa: [/(I|IM)PANEMA/i],
    matchFinca:   [/IPANEMA/i],
    documentos: [
      ...COMUN_BASE_TA,
      'Inducción Ipanema',
      'Inducción Ipanema Foráneos',
      'Formato de Bonificación Ipanema',
      'Prueba Psicotécnica',
    ],
  },
  {
    nombre: 'Flores de los Andes',
    prioridad: 90,
    matchEmpresa: [/FLORES\s+DE\s+LOS\s+ANDES/i],
    matchFinca:   [/FLORES\s+DE\s+LOS\s+ANDES/i],
    documentos: [
      ...COMUN_BASE_TA,
      'Inducción Flores de los Andes',
      'Formato de Bonificación Ipanema',
      'Prueba Psicotécnica',
    ],
  },
  {
    nombre: 'Rebaño',
    prioridad: 90,
    matchEmpresa: [/REBA[ÑN]O/i],
    matchFinca:   [/REBA[ÑN]O/i],
    documentos: [
      ...COMUN_BASE_TA,
      'Inducción Rebaño',
      'Formato de Bonificación Ipanema',
      'Prueba Psicotécnica',
    ],
  },
  {
    nombre: 'Melody',
    prioridad: 90,
    matchEmpresa: [/MELODY/i],
    documentos: [
      ...COMUN_BASE_TA,
      'Inducción Melody',
      'Formato de Bonificación Ipanema',
      'Prueba Psicotécnica',
    ],
  },
  {
    nombre: 'Sin Casino (whitelist)',
    prioridad: 90,
    matchTemporal: 'TU ALIANZA SAS',
    matchEmpresa: [
      /^AGROIDEA/i,
      /BALLESTEROS\s+GOMEZ\s+MARIBEL/i,
      /CASA\s+DENTAL\s+EDUARDO\s+DAZA/i,
      /^DANIELA\s+LEON/i,
      /DELI\s+POLLO/i,
      /^FRUITSFULL/i,
      /^COMERCIALIZADORA\s+TS/i,
      /^TURFLOR/i,
      /YES\s+CREMALLERAS/i,
    ],
    documentos: [
      ...COMUN_BASE_TA,
      'Inducción Tu Alianza sin Casino',
      'Formato de Bonificación Ipanema',
      'Prueba Psicotécnica',
    ],
  },
  {
    nombre: 'Flores del Rio',
    prioridad: 90,
    matchEmpresa: [/FLORES\s+DEL\s+RIO/i],
    matchFinca:   [/FLORES\s+DEL\s+RIO/i],
    documentos: [
      // Mezcla: lista restrictiva de Agrícola + operativos de finca
      'Ficha Técnica',
      'Cédula',
      'Entrevista de Ingreso Tu Alianza',
      'Contrato',
      'Inducción Agrícola',
      'ARL',
      'Colinesterasa',
      'Hoja de Vida Minerva',
      'Referencias (1 personal, 1 familiar, 2 laborales)',
      'Diplomas y Certificados de Estudios',
      'Prueba Lectoescritura',
      'Figura Humana',
      'SST',
      'Prueba SST',
      'Otras Pruebas',
      'CCF',
      'EPS',
      'Pago Seguridad Social',
      ...CARTAS_TA,
      // Operativos
      'Entrega Carnets',
      'Inducción Capacitación',
      'Formato Solicitud',
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // PRIORIDAD 80 — Empresas agrupadas (heredan default + extras)
  // ════════════════════════════════════════════════════════════════
  {
    nombre: 'Bouquets Mixtos (heredado de Agrícola)',
    prioridad: 80,
    matchEmpresa: [/BOUQUETS\s+MIXTOS/i],
    documentos: [
      ...COMUN_BASE_TA.filter(t => t !== 'Inducción'),
      'Inducción Agrícola',
      'Formato de Bonificación Ipanema',
      'Prueba Psicotécnica',
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // PRIORIDAD 10 — Defaults por temporal (fallback)
  // ════════════════════════════════════════════════════════════════
  {
    nombre: 'Tu Alianza default',
    prioridad: 10,
    matchTemporal: 'TU ALIANZA SAS',
    documentos: [
      // Set rico, sin Inducción (ninguna específica aplica para empresas no listadas)
      ...COMUN_BASE_TA,
      'Formato de Bonificación Ipanema',
      'Prueba Psicotécnica',
    ],
  },
  {
    nombre: 'Apoyo Laboral default',
    prioridad: 10,
    matchTemporal: 'APOYO LABORAL SAS',
    documentos: [
      // Elite Blu menos los específicos de Elite/Elite Blu
      ...COMUN_BASE_APOYO_BLU,
      // El acuerdo de uso de imagen lo emite Apoyo Laboral, no la empresa
      // usuaria: aplica a cualquier vacante de la temporal que no tenga
      // perfil propio (p.ej. FLORAPACK COLOMBIA), no solo al grupo Elite.
      'Manejo Imagen',
    ],
  },
];

// ────────────────────────────────────────────────────────────────
// Sections (para UI: agrupado dentro de cada tab)
// ────────────────────────────────────────────────────────────────

export const SECCION_LABELS: { key: DocSeccion; label: string; icon: string }[] = [
  { key: 'generales',       label: 'Generales',             icon: 'description' },
  { key: 'contrato',        label: 'Contrato y Ficha',      icon: 'assignment' },
  { key: 'entrega-empresa', label: 'Inducción y operativos',icon: 'business' },
  { key: 'flores',          label: 'Operativos de finca',   icon: 'spa' },
  { key: 'sagaro',          label: 'Específicos Sagaro',    icon: 'lock' },
  { key: 'ipanema',         label: 'Específicos Ipanema',   icon: 'star' },
  { key: 'subir-manual',    label: 'Documentos a subir',    icon: 'cloud_upload' },
];

const SECCION_BY_TITLE: Record<string, DocSeccion> = {
  // Generales
  'Autorización de Datos':                                'generales',
  'Manejo Imagen':                                        'generales',
  'Ficha Social':                                         'generales',
  'Entrevista de Ingreso':                                'generales',
  'Entrevista de Ingreso Tu Alianza':                     'generales',
  'Hoja de Vida Minerva':                                 'generales',
  'Contratos Otrosí':                                     'generales',
  'OTRO SI Jornada Laboral':                              'generales',
  'Carnet':                                               'generales',
  'Auxilio Alimentación':                                 'generales',
  'Autorización Daños Pérdidas':                          'generales',
  // Contrato
  'Ficha Técnica':                                        'contrato',
  'Contrato':                                             'contrato',
  // Inducción y operativos por empresa
  'Inducción':                                            'entrega-empresa',
  'Inducción Agrícola':                                   'entrega-empresa',
  'Inducción Jardines de los Andes':                      'entrega-empresa',
  'Inducción Sagaro':                                     'entrega-empresa',
  'Inducción Flores de los Andes':                        'entrega-empresa',
  'Inducción Ipanema':                                    'entrega-empresa',
  'Inducción Ipanema Foráneos':                           'entrega-empresa',
  'Inducción Rebaño':                                     'entrega-empresa',
  'Inducción Melody':                                     'entrega-empresa',
  'Inducción Tu Alianza sin Casino':                      'entrega-empresa',
  'Inducción Administrativos':                            'entrega-empresa',
  'Carta Descuento de Flor':                              'entrega-empresa',
  'Formato Timbre Ingreso/Salida':                        'entrega-empresa',
  'Carta Autorización Correo Electrónico':                'entrega-empresa',
  'Acta de Funciones':                                    'entrega-empresa',
  'Acta de Herramientas de Trabajo':                      'entrega-empresa',
  'Acta de Dotaciones':                                   'entrega-empresa',
  'Acta de Funciones de SST':                             'entrega-empresa',
  // Flores del Rio operativos
  'Entrega Carnets':                                      'flores',
  'Inducción Capacitación':                               'flores',
  'Formato Solicitud':                                    'flores',
  // Sagaro extras
  'Sagaro Lockers':                                       'sagaro',
  'Sagaro Imagen':                                        'sagaro',
  'Sagaro Celular':                                       'sagaro',
  'OTRO SI Sagaro Fumigador':                             'sagaro',
  // Ipanema (subir-only)
  'Formato de Bonificación Ipanema':                      'ipanema',
  // Subir manual
  'Cédula':                                               'subir-manual',
  'ARL':                                                  'subir-manual',
  'EPS':                                                  'subir-manual',
  'CCF':                                                  'subir-manual',
  'Pago Seguridad Social':                                'subir-manual',
  'Autorización Ingreso':                                 'subir-manual',
  'Diplomas y Certificados de Estudios':                  'subir-manual',
  'Referencias (1 personal, 1 familiar, 2 laborales)':    'subir-manual',
  'Referenciación':                                       'subir-manual',
  'Pruebas Psicológicas':                                 'subir-manual',
  'Prueba Psicotécnica':                                  'subir-manual',
  'Prueba Lectoescritura':                                'subir-manual',
  'Figura Humana':                                        'subir-manual',
  'Test del Árbol':                                       'subir-manual',
  'Prueba de Conocimiento':                               'subir-manual',
  'Prueba Técnica Formato Elite':                         'subir-manual',
  'Otras Pruebas':                                        'subir-manual',
  'Colinesterasa':                                        'subir-manual',
  'Curso Manipulación de Alimentos':                      'subir-manual',
  'Historial Laboral (Semanas Cotizadas)':                'subir-manual',
  'Formato Resultado Prueba Valanti':                     'subir-manual',
  'Prueba SST':                                           'subir-manual',
  'SST':                                                  'subir-manual',
  'Planilla SST':                                         'subir-manual',
  'Evaluación SST':                                       'subir-manual',
  'Visita Domiciliaria':                                  'subir-manual',
  'Fotografías Visita Domiciliaria':                      'subir-manual',
  'Tarjeta de Propiedad':                                 'subir-manual',
  'Licencia de Conducción':                               'subir-manual',
};

// ────────────────────────────────────────────────────────────────
// Normalización + Resolución de perfil
// ────────────────────────────────────────────────────────────────

function normalizeTitle(s: string | null | undefined): string {
  return (s || '')
    .toString()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeNombre(s: string | null | undefined): string {
  return (s || '')
    .toString()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\bS\.?\s*A\.?\s*S\.?\b/g, ' ')
    .replace(/\bS\.?\s*A\.?\b/g, ' ')
    .replace(/\bC\.?\s*I\.?\b/g, ' ')
    .replace(/\bLTDA\.?\b/g, ' ')
    .replace(/&\s*CIA/g, ' ')
    .replace(/[.,&()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SECCION_BY_TITLE_KEY = (() => {
  const m = new Map<string, DocSeccion>();
  for (const [titulo, seccion] of Object.entries(SECCION_BY_TITLE)) {
    m.set(normalizeTitle(titulo), seccion);
  }
  return m;
})();

export function getDocSeccion(titulo: string): DocSeccion | null {
  return SECCION_BY_TITLE_KEY.get(normalizeTitle(titulo)) ?? null;
}

interface FilterCtx {
  temporal?: string | null;
  empresaUsuaria?: string | null;
  finca?: string | null;
}

function perfilMatches(p: PerfilEmpresa, empUsu: string, finca: string, temp: string): boolean {
  if (p.matchTemporal && p.matchTemporal !== temp) return false;

  const wantsEmp = !!p.matchEmpresa?.length;
  const wantsFinca = !!p.matchFinca?.length;

  if (wantsEmp || wantsFinca) {
    const okEmp = p.matchEmpresa?.some(rx => rx.test(empUsu)) ?? false;
    const okFinca = p.matchFinca?.some(rx => rx.test(finca)) ?? false;
    if (!okEmp && !okFinca) return false;
  } else if (!p.matchTemporal) {
    // Sin ningún criterio el perfil no debería matchear
    return false;
  }

  return true;
}

export function resolverPerfil(ctx: FilterCtx): PerfilEmpresa | null {
  const empUsu = normalizeNombre(ctx.empresaUsuaria);
  const finca = normalizeNombre(ctx.finca);
  const temp = (ctx.temporal || '').toString();

  const candidates = PERFILES_EMPRESA
    .filter(p => perfilMatches(p, empUsu, finca, temp))
    .sort((a, b) => b.prioridad - a.prioridad);

  return candidates[0] ?? null;
}

const MINIMOS = ['Cédula', 'Contrato', 'Hoja de Vida Minerva'];
const MINIMOS_KEYS = new Set(MINIMOS.map(normalizeTitle));

/**
 * Documentos que NO dependen de la empresa usuaria ni de la finca: los emite la
 * temporal, así que basta con que la vacante tenga una temporal reconocida
 * (Apoyo Laboral / Tu Alianza). Quedan fuera de la whitelist por perfil.
 */
const SOLO_POR_TEMPORAL = ['Autorización de Datos'];
const SOLO_POR_TEMPORAL_KEYS = new Set(SOLO_POR_TEMPORAL.map(normalizeTitle));

/** ¿La temporal de la vacante es Apoyo Laboral o Tu Alianza? */
export function esTemporalReconocida(temporal: string | null | undefined): boolean {
  const t = normalizeNombre(temporal);
  return t.includes('APOYO') || t.includes('ALIANZA');
}

export function isDocumentoVisible(titulo: string, ctx: FilterCtx): boolean {
  const k = normalizeTitle(titulo);

  // Se resuelve ANTES que el perfil: ni la empresa usuaria ni la finca deben
  // poder esconder un documento que depende solo de la temporal.
  if (SOLO_POR_TEMPORAL_KEYS.has(k)) {
    return esTemporalReconocida(ctx.temporal);
  }

  const perfil = resolverPerfil(ctx);

  if (!perfil) {
    // Sin perfil: solo lo mínimo
    return MINIMOS_KEYS.has(k);
  }

  return perfil.documentos.some(t => normalizeTitle(t) === k);
}
