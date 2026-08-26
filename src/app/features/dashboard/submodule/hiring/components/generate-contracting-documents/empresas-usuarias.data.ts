/**
 * Datos legales de las empresas usuarias (NIT, domicilio social y
 * representante legal) para los documentos que los exigen: Acuerdo y
 * Autorización de Uso de Imagen (AL CO-RE-12 / AL CO-RE-13) y similares.
 *
 * ── Por qué vive acá y no en la BD ─────────────────────────────────────────
 * El backend NO tiene esta información: `CentroCosto` guarda empresa,
 * dirección y ciudad, y `Publicacion` guarda `empresa_usuaria_solicita`,
 * `finca` y `direccion`. Ninguno tiene NIT ni representante legal. Sin este
 * archivo los documentos salen con "___________" en esos campos.
 *
 * ── Procedencia de los datos ───────────────────────────────────────────────
 * Transcritos de "CENTROS DE COSTO APOYO Y ALIANZA V2.xlsx", hojas
 * "CENTROS DE COSTO APOYO" y "ELITE BLU". OJO: en esa hoja los encabezados
 * están corridos — la columna G está rotulada "EMPRESA USUARIA" pero contiene
 * el NOMBRE del representante legal. El mapeo real es:
 *   D = empresa · E = ciudad · F = teléfono · G = representante · H = cédula · I = NIT
 * Ese Excel NO forma parte del repositorio, por eso los datos se fijan acá:
 * una versión de TesoroApp no puede depender de un archivo externo.
 *
 * ── Cómo agregar una empresa ───────────────────────────────────────────────
 * Una entrada nueva en EMPRESAS_USUARIAS. `match` debe tolerar las variantes
 * de escritura que existen en `Publicacion.empresa_usuaria_solicita`, que es
 * texto libre: hay 49 grafías distintas en producción para ~15 empresas
 * ("THE ELITE FLOWER S.A.S. C.I.", "THE ELITE FLOWERS", "THE ELITE FLOWER SAS"…).
 * El orden importa: gana la primera que coincida.
 */

export interface EmpresaUsuariaLegal {
  /** Nombre canónico, para trazabilidad. */
  nombre: string;
  /** Variantes que aparecen en `empresa_usuaria_solicita` (texto libre). */
  match: RegExp;
  nit: string;
  /**
   * Domicilio SOCIAL de la empresa, no la finca donde se presta el servicio.
   * `Publicacion.direccion` trae el sitio de trabajo (p. ej. The Elite Flower
   * aparece como "KM 25 VIA SIBATÉ"), que no sirve para un documento legal.
   */
  domicilio: string;
  representante: string;
  ccRepresentante: string;
}

export const EMPRESAS_USUARIAS: EmpresaUsuariaLegal[] = [
  // ELITE BLU antes que ELITE FLOWER: si no, "ELITE" haría match cruzado.
  {
    nombre: 'ELITE BLU S.A.S',
    match: /ELITE\s*BLU/i,
    nit: '901.236.507-4',
    domicilio: 'Sotaquirá, Boyacá',
    representante: 'JUAN GUILLERMO GONZALEZ',
    ccRepresentante: '10.001.240',
  },
  {
    nombre: 'THE ELITE FLOWER S.A.S. C.I.',
    match: /ELITE\s*FLOWER/i,
    nit: '800.141.506-1',
    domicilio: 'Km. 31 Vía Bogotá - Facatativá, Cundinamarca',
    representante: 'RICHARD STANLEY DECKERS STEFFENS',
    ccRepresentante: '79.445.468',
  },
  {
    nombre: 'FANTASY FLOWERS S.A.S.',
    match: /FANTASY/i,
    nit: '830.093.741-9',
    domicilio: 'Vereda Moyano, Facatativá - Cundinamarca',
    representante: 'ADRIANA IREGUI CARRILLO',
    ccRepresentante: '35.393.265',
  },
  {
    nombre: 'FLORAPACK COLOMBIA S.A.S',
    match: /FLORAPACK/i,
    nit: '901.197.689-8',
    domicilio: 'Funza, Cundinamarca',
    representante: 'RICHARD STANLEY DECKERS STEFFENS',
    ccRepresentante: '79.445.468',
  },
  {
    nombre: 'FLORALEZA S.A.S',
    match: /FLORALEZA/i,
    nit: '901.948.984-1',
    domicilio: 'Nemocón, Cundinamarca',
    representante: 'RICHARD STANLEY DECKERS STEFFENS',
    ccRepresentante: '79.445.468',
  },
  {
    nombre: 'FLORES SAN JUAN S.A.S',
    match: /FLORES\s+SAN\s+JUAN|^\s*SAN\s+JUAN\s*$/i,
    nit: '800.154.771-3',
    domicilio: 'Funza, Cundinamarca',
    representante: 'RICHARD STANLEY DECKERS STEFFENS',
    ccRepresentante: '79.445.468',
  },
  {
    nombre: 'FUNDACION FERNANDO BORRERO CAICEDO',
    match: /FERNANDO\s+BORRERO/i,
    nit: '830.069.880-3',
    domicilio: 'Facatativá, Cundinamarca',
    representante: 'MARIO DE JESUS SERRANO PINILLA',
    ccRepresentante: '13.845.426',
  },
  {
    nombre: 'LUISIANA FARMS S.A.S.',
    match: /LUISIANA/i,
    nit: '800.149.419-5',
    domicilio: 'Nemocón, Cundinamarca',
    representante: 'RICHARD STANLEY DECKERS STEFFENS',
    ccRepresentante: '79.445.468',
  },
  {
    nombre: 'MERCEDES S.A.S.',
    match: /\bMERCEDES\b/i,
    nit: '860.353.641-6',
    domicilio: 'Facatativá, Cundinamarca',
    representante: 'RICHARD STANLEY DECKERS STEFFENS',
    ccRepresentante: '79.445.468',
  },
  {
    nombre: 'PETALIA S.A.S.',
    match: /\bPETALIA\b/i,
    nit: '901.949.109-6',
    domicilio: 'Funza, Cundinamarca',
    representante: 'RICHARD STANLEY DECKERS STEFFENS',
    ccRepresentante: '79.445.468',
  },
  {
    nombre: 'WAYUU FLOWERS S.A.S.',
    match: /WAYUU/i,
    nit: '800.214.937-7',
    domicilio: 'Tocancipá, Cundinamarca',
    representante: 'RICHARD STANLEY DECKERS STEFFENS',
    ccRepresentante: '79.445.468',
  },
  {
    nombre: 'APOYO LABORAL TS S.A.S.',
    match: /APOYO\s+LABORAL/i,
    nit: '900.814.587-1',
    domicilio: 'Carrera 2 # 8 - 156, Facatativá, Cundinamarca',
    representante: 'MAYRA HUAMANÍ LÓPEZ',
    ccRepresentante: '332.318',
  },
];

const VACIO: Omit<EmpresaUsuariaLegal, 'match'> = {
  nombre: '',
  nit: '',
  domicilio: '',
  representante: '',
  ccRepresentante: '',
};

/**
 * Resuelve los datos legales a partir del nombre libre de la empresa usuaria.
 * Devuelve campos vacíos si no hay entrada: el llamador decide qué imprimir.
 */
export function resolverEmpresaUsuaria(nombre: string | null | undefined): Omit<EmpresaUsuariaLegal, 'match'> {
  const n = String(nombre ?? '').trim();
  if (!n) return VACIO;
  const hit = EMPRESAS_USUARIAS.find(e => e.match.test(n));
  if (!hit) return VACIO;
  const { match, ...datos } = hit;
  return datos;
}
