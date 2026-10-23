/**
 * Contratos de ms-infra (8105, /api/v1/infra). El servidor responde en snake_case y
 * las interfaces lo respetan tal cual (mismo criterio que turnos y comunicaciones).
 * Los campos opcionales llegan ausentes cuando no hay dato (NON_NULL en el servidor).
 */

export type Severidad = 'critico' | 'serio' | 'atencion' | 'info';
export type EstadoSalud = 'ok' | 'atencion' | 'critico';
export type Grupo =
  | 'borde' | 'nucleo' | 'microservicio' | 'datos' | 'worker'
  | 'tiempo-real' | 'frontend' | 'observabilidad' | 'otro' | 'pruebas';

export interface Hallazgo {
  id: string;
  severidad: Severidad;
  categoria: string;
  titulo: string;
  detalle?: string;
  objeto?: string;
  recomendacion?: string;
}

export interface Salud {
  puntaje: number;
  estado: EstadoSalud;
  hallazgos: Hallazgo[];
}

export interface Kpis {
  contenedores: number;
  contenedores_activos: number;
  contenedores_con_problema: number;
  contenedores_fuera: number;
  microservicios: number;
  microservicios_up: number;
  nodos: number;
  nodos_listos: number;
  pods: number;
  pods_activos: number;
  req_s?: number;
  err5xx_pct?: number;
  lat_media_ms?: number;
  cpu_pct?: number;
  mem_pct?: number;
  temp_c?: number;
  red_rx_bps?: number;
  red_tx_bps?: number;
  alertas: number;
  alertas_criticas: number;
  sitios: number;
  sitios_caidos: number;
  visitas_min?: number;
}

export interface Disco { montaje: string; dispositivo: string; tipo: string; total: number; libre: number; pct: number; }
export interface Interfaz { nombre: string; rx_bps: number; tx_bps: number; }

/** Tarjeta gráfica (exportador gpu-exporter). lectura 'parcial' = el driver no da uso/memoria; motivo dice por qué. */
export interface Gpu {
  pci: string;
  fabricante: string;
  modelo: string;
  chip?: string;
  ensamblador?: string;
  driver: string;
  tipo: 'discreta' | 'integrada' | string;
  principal: boolean;
  lectura: 'completa' | 'parcial' | string;
  motivo?: string;
  estado: 'ok' | 'atencion' | 'critico';
  energia?: string;
  temp_c?: number;
  ventilador_rpm?: number;
  ventilador_pct?: number;
  potencia_w?: number;
  uso_pct?: number;
  vram_total?: number;
  vram_usada?: number;
  vram_fuente?: 'driver' | 'ficha' | string;
  pcie_gts?: number;
  pcie_gts_max?: number;
  carriles?: number;
  carriles_max?: number;
  frecuencia_mhz?: number;
  salidas: number;
  pantallas: number;
}

export interface Host {
  id: string;
  nombre: string;
  ip?: string;
  tipo: 'servidor' | 'nodo-k3s' | 'almacenamiento' | 'internet' | string;
  rol?: string;
  estado: 'ok' | 'atencion' | 'critico' | 'desconocido';
  origen: string;
  cpu_pct?: number;
  nucleos?: number;
  mem_pct?: number;
  mem_total?: number;
  mem_usada?: number;
  temp_c?: number;
  carga1?: number;
  uptime_seg?: number;
  red_rx_bps?: number;
  red_tx_bps?: number;
  latencia_ms?: number;
  discos?: Disco[];
  interfaces?: Interfaz[];
  detalle?: string;
  gpus?: Gpu[];
}

export interface Contenedor {
  id: string;
  nombre: string;
  servicio: string;
  imagen: string;
  grupo: Grupo;
  host: string;
  estado: string;
  salud?: 'healthy' | 'unhealthy' | 'starting' | string;
  reinicios?: number;
  inicio?: number;
  creado?: number;
  cpu_pct?: number;
  mem_bytes?: number;
  mem_limite?: number;
  red_rx_bps?: number;
  red_tx_bps?: number;
  req_s?: number;
  err_pct?: number;
  lat_ms?: number;
  eureka?: string;
  proyecto?: string;
  puertos?: string[];
  redes?: string[];
  heap_pct?: number;
  db_activas?: number;
  db_max?: number;
  produccion: boolean;
}

export interface NodoK8s {
  nombre: string;
  ip?: string;
  roles: string[];
  listo: boolean;
  version?: string;
  so?: string;
  kernel?: string;
  runtime?: string;
  creado?: number;
  cpu_capacidad?: number;
  mem_capacidad?: number;
  cpu_uso_milli?: number;
  mem_uso?: number;
  pods?: number;
  condiciones: string[];
}

export interface Pod {
  ns: string;
  nombre: string;
  nodo?: string;
  fase: string;
  listos: number;
  total: number;
  reinicios: number;
  cpu_milli?: number;
  mem_bytes?: number;
  inicio?: number;
  app?: string;
  ip?: string;
}

export interface Enlace {
  origen: string;
  destino: string;
  tipo: 'http' | 'db' | 'kafka' | 'cache' | 'media' | 'red';
  rps?: number;
  err_pct?: number;
  intensidad?: number;
}

export interface Alerta { nombre: string; severidad: Severidad; objeto?: string; resumen?: string; desde?: number; origen: string; }

export interface Evento { id: string; ts: number; tipo: string; severidad: Severidad; objeto?: string; mensaje: string; }

export interface Fuente { id: string; nombre: string; ok: boolean; actualizado?: number; error?: string; }

export interface Snapshot {
  ts: number;
  salud: Salud;
  kpis: Kpis;
  hosts: Host[];
  contenedores: Contenedor[];
  nodos: NodoK8s[];
  pods: Pod[];
  enlaces: Enlace[];
  alertas: Alerta[];
  eventos: Evento[];
  fuentes: Fuente[];
  /** Ubicaciones remotas (con agentes), para la vista 3D. */
  ubicaciones?: UbicacionRemota[];
}

export interface UbicacionRemota {
  id: string; nombre: string; tipo: string; ciudad?: string; estado: 'ok' | 'atencion' | 'critico' | 'sin-equipos';
  equipos: number; en_linea: number; caidos: number; respaldos: number; respaldos_con_problema: number;
}

// ── Pestañas ────────────────────────────────────────────────────────────────

export type Rango = '1h' | '6h' | '24h' | '7d' | '30d';

export type Eficiencia = 'ajustado' | 'sobredimensionado' | 'al-limite' | 'ocioso';

export interface UsoServicio {
  servicio: string;
  contenedor: string;
  grupo: Grupo;
  estado: string;
  peticiones: number;
  rps_medio?: number;
  rps_max?: number;
  err5xx: number;
  err_pct?: number;
  lat_media_ms?: number;
  lat_max_ms?: number;
  cpu_medio?: number;
  cpu_max?: number;
  mem_media?: number;
  mem_max?: number;
  mem_limite?: number;
  cpu_estrangulada_pct?: number;
  reinicios?: number;
  oom?: number;
  logs_error?: number;
  logs_warn?: number;
  heap_max_pct?: number;
  uptime_seg?: number;
  rutas?: string[];
  recomendaciones?: string[];
  eficiencia?: Eficiencia;
}

export interface UsoRuta {
  ruta: string;
  servicio: string;
  peticiones: number;
  err4xx: number;
  err5xx: number;
  lat_media_ms?: number;
  por_estado?: Record<string, number>;
}

export interface UsoGlobal {
  rango: Rango;
  servicios: UsoServicio[];
  rutas: UsoRuta[];
  totales: {
    peticiones: number;
    err_5xx: number;
    peticiones_gateway: number;
    cpu_total_medio?: number;
    mem_total_media?: number;
    mem_limites?: number;
    servicios_sin_trafico?: number;
  };
}

export interface Conteo { clave: string; n: number; }

export interface Sitio {
  dominio: string;
  destino?: string;
  descripcion?: string;
  origen: 'caddy' | 'externo' | 'logs';
  estado: 'ok' | 'caido' | 'desconocido' | 'sin-sonda';
  codigo?: number;
  latencia_ms?: number;
  error?: string;
  dns?: string;
  cert_vence?: number;
  cert_dias?: number;
  cert_emisor?: string;
  peticiones?: number;
  visitantes?: number;
  err4xx?: number;
  err5xx?: number;
  abortadas?: number;
  bytes?: number;
  p50_ms?: number;
  p95_ms?: number;
  rpm?: number;
  bots?: number;
  top_rutas?: Conteo[];
  top_ips?: Conteo[];
  top_agentes?: Conteo[];
  serie?: [number, number][];
}

export interface DetalleSitios { rango: Rango; historia_lista: boolean; error?: string; sitios: Sitio[]; }

export interface DetalleRed {
  rango: Rango;
  contenedores: { contenedor: string; rx_bytes: number; tx_bytes: number }[];
  red_host: string[];
  interfaces: { interfaz: string; nombre: string; rx_bytes: number; tx_bytes: number; errores: number; descartados: number }[];
  redes_docker: { nombre: string; driver: string; subred?: string; contenedores: number }[];
  equipos: { id: string; nombre: string; tipo: string; destino: string; rol?: string; ok: boolean; latencia_ms?: number; error?: string }[];
  tiempo_real: { salas?: number; participantes?: number };
}

export interface GrupoKafka { grupo: string; estado?: string; miembros: number; lag: number; lag_por_topico: Record<string, number>; }

export interface DetalleDatos {
  mysql: {
    arriba: boolean; uptime_seg?: number; conexiones?: number; conexiones_max?: number; hilos_activos?: number;
    consultas_s?: number; lentas_24h?: number; conexiones_abortadas_24h?: number; buffer_pool_bytes?: number;
    buffer_pool_uso_pct?: number; recibido_bps?: number; enviado_bps?: number;
    esquemas: { nombre: string; bytes: number; filas: number; tablas: number }[];
  };
  redis: {
    arriba: boolean; memoria_bytes?: number; memoria_max_bytes?: number; clientes?: number; ops_s?: number;
    aciertos_pct?: number; llaves?: number; expulsadas_24h?: number;
  };
  kafka?: { brokers: number; controlador?: string; topicos: number; particiones: number; lista_topicos: string[]; grupos: GrupoKafka[]; lag_total: number };
  ocr: { pendientes?: number; completados_24h?: number; fallidos_24h?: number };
  respaldos: {
    ruta: string; descripcion?: string; accesible: boolean; ultimo_archivo?: string; ultimo_ts?: number;
    ultimo_bytes?: number; horas?: number; archivos?: number; error?: string;
  }[];
}

export interface DetalleCluster {
  disponible: boolean;
  motivo?: string;
  nodos: NodoK8s[];
  pods: Pod[];
  despliegues?: { ns: string; nombre: string; deseadas: number; listas: number; imagen?: string }[];
  servicios?: { ns: string; nombre: string; tipo: string; ip?: string; puertos: string[] }[];
  eventos?: { ns: string; tipo: string; razon: string; objeto: string; mensaje: string; veces: number; ts: string }[];
  error?: string;
}

export interface SerieDto { nombre: string; puntos: [number, number][]; }
export interface Grafica { clave: string; unidad: string; series: SerieDto[]; }

export interface LineaLog { ts: number; contenedor: string; linea: string; }

export interface InformeMeta {
  id: string;
  generado_en: number;
  rango: Rango;
  generado_por?: string;
  puntaje: number;
  estado: EstadoSalud;
  conteo: Record<string, number>;
  titular?: string;
}

export interface Informe extends InformeMeta {
  resumen: string[];
  hallazgos: Hallazgo[];
  host: Record<string, number | null>;
  uso: UsoGlobal;
  sitios: Sitio[];
  red: DetalleRed;
  datos: DetalleDatos;
  cluster: DetalleCluster;
  eventos: Evento[];
}

export const NOMBRE_GRUPO: Record<Grupo, string> = {
  borde: 'Borde (entrada)',
  nucleo: 'Núcleo',
  microservicio: 'Microservicios',
  datos: 'Datos y mensajería',
  worker: 'Workers',
  'tiempo-real': 'Voz y video',
  frontend: 'Frontends',
  observabilidad: 'Observabilidad',
  otro: 'Otros',
  pruebas: 'Fuera de producción',
};

export const ORDEN_GRUPO: Grupo[] = [
  'borde', 'nucleo', 'microservicio', 'datos', 'worker', 'tiempo-real', 'frontend', 'observabilidad', 'otro', 'pruebas',
];

export const NOMBRE_SEVERIDAD: Record<Severidad, string> = {
  critico: 'Crítico',
  serio: 'Serio',
  atencion: 'Atención',
  info: 'Info',
};

// ── Ubicaciones remotas, sus equipos (agentes) y respaldos (/api/v1/infra/ubicaciones) ──

export interface Ubicacion { id: string; nombre: string; tipo: 'oficina' | 'datacenter' | 'nube' | 'otro' | string; ciudad?: string; lat?: number; lon?: number; notas?: string; creada: number; }

export interface DiscoR { montaje?: string; dispositivo?: string; tipo?: string; total?: number; libre?: number; }
export interface GpuR { fabricante?: string; modelo?: string; driver?: string; temp_c?: number; uso_pct?: number; vram_total?: number; vram_usada?: number; potencia_w?: number; }
export interface ChequeoR { nombre: string; destino?: string; ok?: boolean; latencia_ms?: number; detalle?: string; }
export interface NodoR { nombre: string; listo?: boolean; roles?: string[]; cpu_capacidad?: number; mem_capacidad?: number; cpu_uso_milli?: number; mem_uso?: number; gpus?: number; }
export interface ClusterR { nombre?: string; version?: string; nodos?: number; nodos_listos?: number; pods?: number; pods_corriendo?: number; pods_con_problema?: number; gpus?: number; nodos_detalle?: NodoR[]; }

/** Último reporte de un agente (o lo que ms-infra ve de un equipo de la sede principal). */
export interface ReporteEquipo {
  version?: string; modo?: 'host' | 'cluster' | string; hostname?: string; so?: string; kernel?: string; arquitectura?: string; cpu_modelo?: string;
  nucleos?: number; cpu_pct?: number; mem_total?: number; mem_usada?: number; carga1?: number; uptime_seg?: number; temp_c?: number;
  red_rx_bps?: number; red_tx_bps?: number; ips?: string[];
  discos?: DiscoR[]; gpus?: GpuR[];
  contenedores?: { total?: number; corriendo?: number; con_problema?: number; problemas?: string[] };
  servicios_caidos?: string[]; chequeos?: ChequeoR[]; cluster?: ClusterR; errores?: string[];
}

/** estado: al-dia | vencido | fallo | sin-datos. */
export interface RespaldoVista {
  equipo: string; nombre: string; destino?: string; estado: 'al-dia' | 'vencido' | 'fallo' | 'sin-datos'; ultimo_exito?: number; ultimo_intento?: number;
  horas_desde_exito?: number; rpo_horas?: number; bytes?: number; verificado?: boolean; fuera_del_sitio?: boolean; detalle?: string;
}

/** estado (agente): en-linea | atrasado | caido | nunca | inactivo; (local): ok | atencion | critico | desconocido. */
export interface EquipoVista {
  id: string; nombre: string; tipo: string; descripcion?: string; estado: string; salud: 'ok' | 'atencion' | 'critico' | 'desconocido' | string;
  ultimo_reporte?: number; ip?: string; origen: 'agente' | 'local'; token_pista?: string; activo?: boolean;
  reporte?: ReporteEquipo; respaldos: RespaldoVista[]; problemas: string[];
}

export interface UbicacionVista {
  ubicacion: Ubicacion; principal: boolean; estado: 'ok' | 'atencion' | 'critico' | 'sin-equipos'; equipos: number; en_linea: number; caidos: number;
  respaldos_al_dia: number; respaldos_con_problema: number; equipos_detalle: EquipoVista[]; respaldos: RespaldoVista[];
}

export interface ResumenUbicaciones { ubicaciones: number; equipos: number; en_linea: number; caidos: number; respaldos: number; respaldos_con_problema: number; lista: UbicacionVista[]; }

export interface AgenteInfra { id: string; ubicacion_id: string; nombre: string; tipo: 'servidor' | 'cluster'; descripcion?: string; token_pista?: string; creado: number; creado_por?: string; activo: boolean; }
/** El token viaja UNA sola vez (alta o regeneración). */
export interface AltaAgente { agente: AgenteInfra; token: string; central_url: string; }
export interface UbicacionIn { nombre?: string; tipo?: string; ciudad?: string; lat?: number | null; lon?: number | null; notas?: string; }
export interface AgenteIn { nombre?: string; tipo?: 'servidor' | 'cluster'; descripcion?: string; ubicacion_id?: string; activo?: boolean; }
