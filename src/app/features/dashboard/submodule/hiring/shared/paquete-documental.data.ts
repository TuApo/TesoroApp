/**
 * EL PAQUETE DOCUMENTAL DE CONTRATACIÓN
 *
 * Los títulos, el tipo con el que los guarda gestión documental y cuáles NO se
 * generan sino que hay que subirlos a mano. Vivían dentro de
 * `GenerateContractingDocumentsComponent`, que son catorce mil líneas, y no
 * había forma de saber qué compone el paquete sin abrir esa pantalla. Al
 * sacarlos aquí, el módulo Documentos del pipeline y el generador leen la
 * MISMA lista: si mañana entra un documento nuevo, entra en los dos sitios.
 *
 * Qué documentos aplican a cada persona NO se decide aquí: eso depende de la
 * empresa usuaria y la finca, y lo resuelve `documentos-por-empresa.config`.
 */

export const DOCUMENTOS_PAQUETE: readonly string[] = [
  // Generales
  'Autorización de Datos',
  'Manejo Imagen',
  'Ficha Social',
  'Entrevista de Ingreso',
  'Entrevista de Ingreso Tu Alianza',
  'Hoja de Vida Minerva',
  'Contratos Otrosí',
  'Auxilio Alimentación',
  'Autorización Daños Pérdidas',
  // Contrato y ficha
  'Ficha Técnica',
  'Contrato',
  // Inducciones por empresa
  'Inducción',
  'Inducción Agrícola',
  'Inducción Jardines de los Andes',
  'Inducción Sagaro',
  'Inducción Flores de los Andes',
  'Inducción Ipanema',
  'Inducción Ipanema Foráneos',
  'Inducción Rebaño',
  'Inducción Melody',
  'Inducción Tu Alianza sin Casino',
  'Inducción Administrativos',
  // Operativos por empresa
  'Carta Descuento de Flor',
  'Formato Timbre Ingreso/Salida',
  'Carta Autorización Correo Electrónico',
  'Acta de Funciones',
  'Acta de Herramientas de Trabajo',
  'Acta de Dotaciones',
  'Acta de Funciones de SST',
  // Operativos Flores del Rio
  'Entrega Carnets',
  'Inducción Capacitación',
  'Formato Solicitud',
  // Sagaro extras
  'Sagaro Lockers',
  'Sagaro Imagen',
  'Sagaro Celular',
  'OTRO SI Sagaro Fumigador',
  'OTRO SI Jornada Laboral',
  'Carnet',
  // Subir manual: identidad / vinculación
  'Cédula',
  'ARL',
  'EPS',
  'CCF',
  'Pago Seguridad Social',
  'Autorización Ingreso',
  // Subir manual: estudios y referencias
  'Diplomas y Certificados de Estudios',
  'Referencias (1 personal, 1 familiar, 2 laborales)',
  'Referenciación',
  // Subir manual: pruebas
  'Pruebas Psicológicas',
  'Prueba Psicotécnica',
  'Prueba Lectoescritura',
  'Figura Humana',
  'Test del Árbol',
  'Prueba de Conocimiento',
  'Prueba Técnica Formato Elite',
  'Otras Pruebas',
  // Subir manual: salud / SST
  'Colinesterasa',
  'Curso Manipulación de Alimentos',
  'Historial Laboral (Semanas Cotizadas)',
  'Formato Resultado Prueba Valanti',
  'Prueba SST',
  'SST',
  'Planilla SST',
  'Evaluación SST',
  // Subir manual: visita / vehículo / bonificaciones
  'Visita Domiciliaria',
  'Fotografías Visita Domiciliaria',
  'Tarjeta de Propiedad',
  'Licencia de Conducción',
  'Formato de Bonificación Ipanema',
  ];

// Documento → ID de tipo en gestión documental.
//
// El ID ES el contrato con el backend: la subida manda el número, no el
// nombre. Los del rango 201..220 estuvieron un tiempo como "placeholders a la
// espera de crearse"; ya existen y están sembrados por la V15 de ms-documents,
// así que si aquí se toca un número hay que tocarlo también allá.
export const TYPE_ID_POR_TITULO: Readonly<Record<string, number>> = {
  // El carnet lo genera el pipeline (tipo 102, CARNET). Faltaba en el mapa, así
  // que en el módulo Documentos salía como "sin tipo" y no se podía ni ver ni
  // resubir, aunque el tipo llevaba tiempo creado.
  'Carnet': 102,
  // Existentes
  'Contrato': 25,
  'Autorización de Datos': 26,
  'Inducción': 27,
  'Inducción Agrícola': 27,
  'Inducción Jardines de los Andes': 27,
  'Inducción Sagaro': 27,
  'Inducción Flores de los Andes': 27,
  'Inducción Ipanema': 27,
  'Inducción Ipanema Foráneos': 27,
  'Inducción Administrativos': 27,
  'Inducción Rebaño': 27,
  'Inducción Melody': 27,
  'Inducción Tu Alianza sin Casino': 27,
  'Ficha Técnica': 34,
  'Entrevista de Ingreso': 103,
  'Contratos Otrosí': 104,
  'Auxilio Alimentación': 105,
  'Autorización Daños Pérdidas': 106,
  'Cédula': 29,
  'ARL': 30,
  'Figura Humana': 31,
  'EPS': 36,
  'CCF': 37,                                 // antes 'Caja'
  'Pago Seguridad Social': 38,
  'Entrega Carnets': 95,
  'Inducción Capacitación': 96,
  'Formato Solicitud': 97,
  'Pruebas Psicológicas': 19,
  'Autorización Ingreso': 112,
  'Formato de Bonificación Ipanema': 113,    // antes 'Bonificación Ipanema'
  'Prueba Psicotécnica': 114,
  'Diplomas y Certificados de Estudios': 101,// antes 'Certificados Estudios'
  'SST': 91,
  'Otras Pruebas': 115,
  'Hoja de Vida Minerva': 28,
  'Prueba Lectoescritura': 20,
  'Visita Domiciliaria': 41,
  'Prueba SST': 24,
  'Manejo Imagen': 46,
  'Ficha Social': 98,
  'Sagaro Lockers': 108,
  'Sagaro Imagen': 109,
  'Sagaro Celular': 110,
  'OTRO SI Sagaro Fumigador': 220, // OTROSI_SAGARO_FUMIGADOR (tipo real creado en BD prod)
  // Mismo tipo documental que 'Contratos Otrosí' (104): son dos otrosí
  // distintos en contenido pero se archivan bajo el mismo tipo.
  'OTRO SI Jornada Laboral': 104,
  'Referencias (1 personal, 1 familiar, 2 laborales)': 118, // antes 'Referenciación'
  'Referenciación': 118,                     // alias temporal para backward compat
  // Tipos reales creados en BD prod (ids 201-220). Entrevista y Colinesterasa reusan tipos preexistentes (103/107).
  'Entrevista de Ingreso Tu Alianza': 103, // ENTREVISTA_INGRESO (tipo real ya existente en BD)
  'Carta Descuento de Flor': 201,
  'Formato Timbre Ingreso/Salida': 202,
  'Carta Autorización Correo Electrónico': 203,
  'Acta de Funciones': 204,
  'Acta de Herramientas de Trabajo': 205,
  'Acta de Dotaciones': 206,
  'Acta de Funciones de SST': 207,
  'Prueba Técnica Formato Elite': 208,
  'Colinesterasa': 107, // COLINESTERASA (tipo real existente en BD)
  'Curso Manipulación de Alimentos': 210,
  'Historial Laboral (Semanas Cotizadas)': 211,
  'Formato Resultado Prueba Valanti': 212,
  'Tarjeta de Propiedad': 213,
  'Licencia de Conducción': 214,
  'Fotografías Visita Domiciliaria': 215,
  'Prueba de Conocimiento': 216,
  'Test del Árbol': 217,
  'Planilla SST': 218,
  'Evaluación SST': 219,
  };

/**
 * Documentos que la plataforma NO genera: llegan en papel o de otro sistema y
 * hay que subirlos. Todo lo demás del paquete se genera desde el generador.
 */
export const DOCUMENTOS_SOLO_SUBIR: readonly string[] = [

    // Existentes (con renames aplicados)
    'Cédula', 'ARL', 'Figura Humana', 'EPS', 'CCF', 'Pago Seguridad Social',
    'Pruebas Psicológicas', 'Prueba Lectoescritura', 'Visita Domiciliaria', 'Prueba SST',
    'Autorización Ingreso', 'Formato de Bonificación Ipanema', 'Prueba Psicotécnica',
    'Diplomas y Certificados de Estudios', 'SST', 'Otras Pruebas',
    'Referencias (1 personal, 1 familiar, 2 laborales)', 'Referenciación',
    // NUEVOS subir-only
    'Prueba Técnica Formato Elite', 'Colinesterasa', 'Curso Manipulación de Alimentos',
    'Historial Laboral (Semanas Cotizadas)', 'Formato Resultado Prueba Valanti',
    'Tarjeta de Propiedad', 'Licencia de Conducción', 'Fotografías Visita Domiciliaria',
    'Prueba de Conocimiento', 'Test del Árbol', 'Planilla SST', 'Evaluación SST',
    // Los que pasaron de stub a subir-only (no se generan, solo se suben)
    // (Carta Descuento de Flor / Formato Timbre / Carta Autorización Correo
    //  ya se generan: ver `cartas-tu-alianza-fill.ts`)
    'Acta de Funciones',
    'Acta de Herramientas de Trabajo',
    'Acta de Dotaciones',
    'Acta de Funciones de SST',
];

const SOLO_SUBIR = new Set<string>(DOCUMENTOS_SOLO_SUBIR);

/** ¿Este documento hay que subirlo a mano? */
export function esSoloSubir(titulo: string): boolean {
  return SOLO_SUBIR.has(titulo);
}
