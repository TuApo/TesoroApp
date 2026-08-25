/**
 * REGISTRO DE PARAMETRIZACIÓN (catálogos / tablas maestras).
 *
 * El caché offline se llena solo con lo que el usuario ya visitó: si nunca
 * abrió una pantalla estando en línea, sus desplegables salen vacíos al
 * quedarse sin conexión. Los catálogos son justo lo que rompe ese modelo —
 * son pocos, casi no cambian y los necesita TODO formulario, así que se
 * precargan enteros (CatalogPreloadService) en vez de esperar a que alguien
 * los visite.
 *
 * Este archivo es la ÚNICA lista de qué es "parametrización". Lo consumen:
 *   · CatalogPreloadService  → qué precargar.
 *   · offline-response.ts    → cómo agruparlo en el diálogo de sincronización.
 *   · OfflineSyncService     → qué excluir de refreshCache() (tiene refresco propio).
 *
 * Las rutas se declaran EXACTAMENTE como las pide el servicio de cada módulo
 * (incluida la barra final y el querystring), porque la clave de caché es
 * `pathname + search`: un `?activo=true` de más o de menos es otra entrada y
 * el acierto offline se pierde. Al tocar un servicio de catálogos, revisa
 * también su entrada aquí.
 */

export interface CatalogEndpoint {
  /** Ruta relativa al gateway, tal cual la pide la app (con query si la usa). */
  path: string;
  /** Etiqueta legible; se muestra en el diálogo de sincronización. */
  label: string;
  /**
   * Ruta del módulo en el árbol de permisos. Si se declara, solo se precarga
   * cuando el usuario puede leer ese módulo. `canReadRoute` es fail-open: si
   * la ruta no está modelada en el árbol, se precarga igual.
   */
  ruta?: string;
}

/** Listado de tablas parametrizadas genéricas (meta_tablas, ms-auth-admin). */
export const META_TABLAS_PATH = '/gestion_catalogos/meta/tablas/';

/**
 * Valores de una tabla parametrizada, con el MISMO querystring que arma
 * `GestionParametrizacionService.listMetaValoresByTablaCodigo(codigo, {activo:true})`.
 */
export function metaValoresPath(codigo: string): string {
  return `${META_TABLAS_PATH}${encodeURIComponent(codigo)}/valores/?activo=true`;
}

/**
 * Catálogos propios de cada módulo (los que no viven en meta_tablas).
 * Sin `ruta` = transversal, lo usa medio sistema.
 */
export const MODULE_CATALOGS: CatalogEndpoint[] = [
  // ── Transversales ──────────────────────────────────────────────────────
  { path: '/gestion_admin/sedes/', label: 'Sedes / sucursales' },
  { path: '/gestion_admin/empresas/', label: 'Empresas' },
  { path: '/gestion_admin/roles/', label: 'Roles' },
  { path: '/gestion_cargos/cargos/', label: 'Cargos' },
  { path: '/gestion_centros_costos/', label: 'Centros de costo' },
  { path: '/gestion_centros_costos/fincas/', label: 'Fincas' },
  { path: '/gestion_documental/document-types/', label: 'Tipos de documento' },

  // ── Usuarios y permisos ────────────────────────────────────────────────
  { path: '/gestion_admin/modulos/', label: 'Módulos', ruta: '/dashboard/users' },
  { path: '/gestion_admin/modulos/arbol/', label: 'Árbol de módulos', ruta: '/dashboard/users' },
  { path: '/gestion_admin/modulos/arbol-permisos/?incluir_vacios=true', label: 'Árbol de permisos', ruta: '/dashboard/users' },

  // ── Nómina ─────────────────────────────────────────────────────────────
  // Los querystring replican los que arma NominaService en la carga inicial de
  // cada pantalla; sin ellos la entrada de caché sería otra y no habría acierto.
  { path: '/api/nomina/conceptos/', label: 'Conceptos de nómina', ruta: '/dashboard/nomina' },
  { path: '/api/nomina/centros-costos/', label: 'Centros de costo (nómina)', ruta: '/dashboard/nomina' },
  { path: '/api/nomina/organizaciones/', label: 'Organizaciones', ruta: '/dashboard/nomina' },
  { path: '/api/nomina/organizaciones/?tipo=EMPRESA_USUARIA&activo=true', label: 'Empresas usuarias', ruta: '/dashboard/nomina' },
  { path: '/api/nomina/entidades-externas?activo=true', label: 'Entidades externas', ruta: '/dashboard/nomina' },

  // ── Jurídico ───────────────────────────────────────────────────────────
  { path: '/legal/catalogos/tipos', label: 'Tipos de proceso', ruta: '/dashboard/gestion-legal' },
  { path: '/legal/catalogos/estados', label: 'Estados de proceso', ruta: '/dashboard/gestion-legal' },
  { path: '/legal/catalogos/documento-tipos', label: 'Tipos de documento (jurídico)', ruta: '/dashboard/gestion-legal' },

  // ── Salud / incapacidades ──────────────────────────────────────────────
  { path: '/Incapacidades/v2/catalogos', label: 'Catálogos de incapacidades', ruta: '/dashboard/disabilities' },
  { path: '/Incapacidades/v2/eps-matriz', label: 'Matriz de EPS', ruta: '/dashboard/disabilities' },
  { path: '/Incapacidades/traerTodaslistas', label: 'Listas de incapacidades', ruta: '/dashboard/disabilities' },

  // ── Selección y contratación ───────────────────────────────────────────
  { path: '/vetados/categorias', label: 'Categorías de vetados', ruta: '/dashboard/hiring' },

  // ── Comercializadora ───────────────────────────────────────────────────
  { path: '/opciones_formulario/categorias/31', label: 'Categorías de mercancía', ruta: '/dashboard/merchandise' },

  // ── Formularios dinámicos ──────────────────────────────────────────────
  // Sin `ruta`: los orígenes de opciones los resuelve CUALQUIER formulario al
  // llenarse, no solo la pantalla de administración que los edita.
  { path: '/api/dynamic-forms/catalogs', label: 'Catálogos de formularios' },
  { path: '/api/dynamic-forms/option-sources?include_inactive=false', label: 'Orígenes de opciones' },
];

/**
 * Prefijos que identifican una URL de parametrización. Cubre tanto las rutas
 * fijas de arriba como las derivadas (valores por tabla, opciones por origen,
 * checklist por tipo de proceso), que se generan en tiempo de ejecución.
 */
const CATALOG_URL_PATTERNS: RegExp[] = [
  /\/gestion_catalogos\/meta\//,
  /\/gestion_admin\/(sedes|empresas|roles|modulos)\//,
  /\/gestion_cargos\/cargos\//,
  /\/gestion_centros_costos\//,
  /\/gestion_documental\/document-types\//,
  /\/api\/nomina\/(conceptos|centros-costos|organizaciones|entidades-externas)\b/,
  /\/api\/nomina\/reportes\/novedades\/tipos\//,
  /\/legal\/catalogos\//,
  /\/Incapacidades\/(v2\/(catalogos|eps-matriz)|traerTodaslistas)/i,
  /\/vetados\/categorias/,
  /\/opciones_formulario\//,
  /\/api\/dynamic-forms\/(catalogs|option-sources)/,
];

/** True si la URL sirve datos de parametrización (catálogos / tablas maestras). */
export function isCatalogUrl(url: string): boolean {
  if (!url) return false;
  return CATALOG_URL_PATTERNS.some(re => re.test(url));
}

/**
 * Etiqueta legible de una URL de parametrización. Primero busca coincidencia
 * exacta en el registro; si no, deduce por familia (los derivados no están en
 * la lista fija). Devuelve null si la URL no es de parametrización.
 */
export function catalogLabel(url: string): string | null {
  if (!isCatalogUrl(url)) return null;

  const path = url.startsWith('http')
    ? url.slice(url.indexOf('/', url.indexOf('//') + 2))
    : url;

  const exacto = MODULE_CATALOGS.find(c => c.path === path);
  if (exacto) return exacto.label;

  const sinQuery = path.split('?')[0];
  const porRuta = MODULE_CATALOGS.find(c => c.path.split('?')[0] === sinQuery);
  if (porRuta) return porRuta.label;

  // Derivados: /gestion_catalogos/meta/tablas/TIPOS_IDENTIFICACION/valores/
  const meta = /\/gestion_catalogos\/meta\/tablas\/([^/?]+)\/valores/.exec(sinQuery);
  if (meta) return decodeURIComponent(meta[1]).replace(/_/g, ' ');
  if (sinQuery.includes('/gestion_catalogos/meta/tablas')) return 'Tablas parametrizadas';

  const origen = /\/option-sources\/([^/?]+)\/options/.exec(sinQuery);
  if (origen) return `Opciones: ${decodeURIComponent(origen[1])}`;

  if (sinQuery.includes('/legal/catalogos/checklist')) return 'Checklist de procesos';
  if (sinQuery.includes('/legal/catalogos/estados')) return 'Estados de proceso';

  return 'Parametrización';
}
