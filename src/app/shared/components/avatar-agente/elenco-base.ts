import { Personaje } from './avatar-agente.modelos';

/**
 * El elenco con que nace Avatar Agent (la siembra de ms-ai V18). Sirve de respaldo cuando el
 * servidor no responde o aún no tiene el registro, para que el chat nunca quede sin cara.
 * Sus retratos y clips vienen empaquetados en `public/avatares/<clave>/`.
 */
export const ELENCO_BASE: Personaje[] = [
  { clave: 'presidente', modulos: ['general', 'operador', 'herramientas-ia.asistente'],
    rutas: [],
    nombre: 'Apo', nombreCorto: 'Apo', cargo: 'Presidente de TuApo', rango: 'PRESIDENTE',
    colorPrimario: '#4F46E5', colorSecundario: '#F59E0B', icono: 'workspace_premium',
    saludo: 'Soy Apo, el presidente de TuApo. Dígame qué necesita y lo resolvemos con el área que corresponda.' },
  { clave: 'contratacion', modulos: ['contratacion'],
    rutas: ['/dashboard/hiring', '/dashboard/vacancies', '/dashboard/positions', '/dashboard/seleccion-y-contratacion', '/dashboard/contratacion', '/dashboard/metricas/contratacion'],
    nombre: 'Camila Reyes', nombreCorto: 'Camila', cargo: 'Directora de Talento y Contratación', rango: 'DIRECTOR',
    padreClave: 'presidente', colorPrimario: '#DB2777', colorSecundario: '#F9A8D4', icono: 'person_search',
    saludo: 'Hola, soy Camila, directora de Talento y Contratación. ¿Revisamos candidatos, oficinas o vacantes?' },
  { clave: 'nomina', modulos: ['nomina'],
    rutas: ['/dashboard/nomina', '/dashboard/novedades', '/dashboard/disabilities', '/dashboard/payments'],
    nombre: 'Ernesto Quintero', nombreCorto: 'Ernesto', cargo: 'Director de Nómina', rango: 'DIRECTOR',
    padreClave: 'presidente', colorPrimario: '#0D9488', colorSecundario: '#99F6E4', icono: 'payments',
    saludo: 'Buenas, soy Ernesto, director de Nómina. ¿Qué periodo o empresa revisamos?' },
  { clave: 'tesoreria', modulos: ['tesoreria'],
    rutas: ['/dashboard/treasury', '/dashboard/tesoreria', '/dashboard/authorizations', '/dashboard/autorizaciones', '/dashboard/money-loan', '/dashboard/prestamo-de-dinero', '/dashboard/operaciones-de-tesoreria', '/dashboard/financiera', '/dashboard/contabilidad'],
    nombre: 'Valentina Ospina', nombreCorto: 'Valentina', cargo: 'Directora Financiera', rango: 'DIRECTOR',
    padreClave: 'presidente', colorPrimario: '#1D4ED8', colorSecundario: '#93C5FD', icono: 'account_balance',
    saludo: 'Hola, soy Valentina, directora Financiera. ¿Miramos cupos, préstamos o pendientes?' },
  { clave: 'documentos', modulos: ['documentos'],
    rutas: ['/dashboard/document-management', '/dashboard/gestion-documental', '/dashboard/plantillas-documentos'],
    nombre: 'Tomás Archila', nombreCorto: 'Tomás', cargo: 'Director de Gestión Documental', rango: 'DIRECTOR',
    padreClave: 'presidente', colorPrimario: '#B45309', colorSecundario: '#FCD34D', icono: 'folder_open',
    saludo: 'Hola, soy Tomás, de Gestión Documental. Deme la cédula y le digo cómo va el expediente.' },
  { clave: 'afiliaciones', modulos: ['afiliaciones'],
    rutas: ['/dashboard/afiliaciones', '/dashboard/eps-transfers', '/dashboard/traslados', '/dashboard/salud'],
    nombre: 'Lucía Benavides', nombreCorto: 'Lucía', cargo: 'Directora de Seguridad Social', rango: 'DIRECTOR',
    padreClave: 'presidente', colorPrimario: '#059669', colorSecundario: '#A7F3D0', icono: 'health_and_safety',
    saludo: 'Hola, soy Lucía, directora de Seguridad Social. ¿Revisamos afiliaciones, traslados o envíos a EPS?' },
  { clave: 'tienda', modulos: ['tienda', 'tienda.*'],
    rutas: ['/dashboard/tienda', '/dashboard/market', '/dashboard/mercado', '/dashboard/merchandise', '/dashboard/mercancia', '/dashboard/comercializadora'],
    nombre: 'Don Rafa Mercado', nombreCorto: 'Don Rafa', cargo: 'Director Comercial de Tiendas', rango: 'DIRECTOR',
    padreClave: 'presidente', colorPrimario: '#EA580C', colorSecundario: '#FDBA74', icono: 'storefront',
    saludo: '¡Quiubo! Soy Don Rafa, el director Comercial de las tiendas. ¿Miramos ventas, margen o inventario?' },
  { clave: 'economiapp', modulos: ['economiapp'],
    rutas: ['/economiapp'],
    nombre: 'MatIA', nombreCorto: 'MatIA', cargo: 'Asesora de compras de EconomiAPP', rango: 'ASESOR',
    padreClave: 'tienda', colorPrimario: '#F97316', colorSecundario: '#7C3AED', icono: 'shopping_bag',
    saludo: 'Hola, soy MatIA. ¿Le ayudo a armar el mercado para que el bono le rinda?' },
  { clave: 'reportes', modulos: ['reportes'],
    rutas: ['/dashboard/reportes', '/dashboard/metricas'],
    nombre: 'Sofía Lozano', nombreCorto: 'Sofía', cargo: 'Directora de Analítica', rango: 'DIRECTOR',
    padreClave: 'presidente', colorPrimario: '#7C3AED', colorSecundario: '#C4B5FD', icono: 'insights',
    saludo: 'Hola, soy Sofía, de Analítica. ¿Qué quiere medir?' },
];

/**
 * Qué archivos trae empaquetados cada personaje del elenco base. Los retratos se generaron con
 * gpt-image-1 (22-oct-2026; la cuenta de Higgsfield estaba sin créditos): la animación del chat
 * es por CSS hasta que el administrador genere o suba los clips desde Avatar Agent.
 */
export const MEDIOS_EMPAQUETADOS: Record<string, { retrato?: boolean; idle?: boolean; hablando?: boolean }> = Object.fromEntries(
  ['presidente', 'contratacion', 'nomina', 'tesoreria', 'documentos', 'afiliaciones', 'tienda', 'economiapp', 'reportes']
    .map((c) => [c, { retrato: true }]),
);
