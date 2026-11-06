/**
 * Tipos del «Salón inteligente», calcados de `microservices/workers/salon-vision/CONTRATO-API.md`
 * (§1 y §4). Los nombres van en snake_case tal cual los serializa ms-store: renombrarlos a
 * camelCase obligaría a un mapeo por pantalla y el primer olvido llegaría como `undefined`
 * sin que nada falle a la vista.
 */

/** §1 — estados de mesa. `RESERVADA` solo la pone el panel, nunca la visión. */
export type EstadoMesa = 'LIBRE' | 'OCUPADA' | 'POR_LIMPIAR' | 'RESERVADA';
export const ESTADOS_MESA: readonly EstadoMesa[] = ['LIBRE', 'OCUPADA', 'POR_LIMPIAR', 'RESERVADA'];

export type FormaMesa = 'RECTA' | 'REDONDA';
export type TipoAlerta = 'ATENCION' | 'ESCALADO' | 'LIMPIEZA' | 'CAMARA';
export type EstadoAlerta = 'ABIERTA' | 'ATENDIDA' | 'CERRADA' | 'FALSO_POSITIVO';
export type EstadoSaludCamara = 'OK' | 'SIN_SENAL' | 'ERROR' | 'DESACTIVADA';
/** Estados de la lista de espera (los que nombra el contrato: AVISADO, SENTADO; el resto por inferencia). */
export type EstadoEspera = 'ESPERANDO' | 'AVISADO' | 'SENTADO' | 'CANCELADO' | 'NO_LLEGO';
export type CanalEspera = 'ANFITRION' | 'QR';
/** Punto normalizado 0..1 respecto al fotograma. */
export type Punto = [number, number];
export type Poligono = Punto[];

// ── §4.1 Estructura ─────────────────────────────────────────────────────────
export interface Salon {
  id: string;
  tienda_id: string;
  nombre: string;
  ancho_plano: number;
  alto_plano: number;
  activo: boolean;
  /** Cuántas mesas activas cuelgan del salón. */
  mesas: number;
}
export interface SalonForm { nombre: string; ancho_plano: number; alto_plano: number; }

export interface Mesa {
  id: string;
  salon_id: string;
  tienda_id: string;
  nombre: string;
  capacidad: number;
  /** 0..1 del plano. */
  pos_x: number;
  pos_y: number;
  ancho: number;
  alto: number;
  forma: FormaMesa;
  activa: boolean;
  camara_id: string | null;
  tiene_poligono: boolean;
}
export interface MesaForm {
  nombre: string;
  capacidad: number;
  pos_x: number;
  pos_y: number;
  ancho: number;
  alto: number;
  forma: FormaMesa;
}

// ── §4.2 Cámaras y calibración ──────────────────────────────────────────────
export interface Camara {
  id: string;
  tienda_id: string;
  nombre: string;
  host: string;
  usuario: string | null;
  ruta: string | null;
  fps: number;
  activa: boolean;
  worker: string | null;
  estado_salud: EstadoSaludCamara | null;
  fps_medido: number | null;
  latencia_ms: number | null;
  ultimo_latido_en: string | null;
  mesas_calibradas: number;
}
/** Alta/edición: `url_rtsp` completa con credenciales; vacío en PUT = no cambiar. */
export interface CamaraForm { nombre: string; url_rtsp: string; fps: number; activa: boolean; }
/** Respuesta de `POST /camaras/probar` (proxy a §3). */
export interface PruebaCamara { ok: boolean; ancho: number | null; alto: number | null; latencia_ms: number | null; error: string | null; }
/** Respuesta de `POST /camaras/{id}/proponer-poligonos` (proxy a §3). */
export interface PropuestasPoligono { propuestas: Array<{ poligono: Poligono; confianza: number }>; }
export interface PoligonoMesa {
  mesa_id: string;
  mesa_nombre: string;
  poligono: Poligono;
  zona_personal: Poligono | null;
  version: number;
}
export interface PoligonoForm { camara_id: string; poligono: Poligono; zona_personal: Poligono | null; }

// ── §4.3 Plano en vivo ──────────────────────────────────────────────────────
export interface AlertaResumen { id: string; tipo: TipoAlerta; creada_en: string; }

export interface MesaPlano {
  id: string;
  nombre: string;
  capacidad: number;
  pos_x: number;
  pos_y: number;
  ancho: number;
  alto: number;
  forma: FormaMesa;
  estado: EstadoMesa;
  /** Cuándo entró en el estado actual. */
  desde: string | null;
  segundos_en_estado: number;
  personas: number | null;
  ultimo_personal_en: string | null;
  segundos_sin_atencion: number | null;
  atendida: boolean;
  prediccion_liberacion_en: string | null;
  minutos_para_liberar: number | null;
  alerta: AlertaResumen | null;
}
export interface SalonPlano {
  id: string;
  nombre: string;
  ancho_plano: number;
  alto_plano: number;
  mesas: MesaPlano[];
}
export interface ResumenPlano {
  libres: number;
  ocupadas: number;
  por_limpiar: number;
  reservadas: number;
  alertas_abiertas: number;
  en_espera: number;
}
export interface Plano {
  tienda_id: string;
  generado_en: string;
  modo_manual: boolean;
  vision_ok: boolean;
  salones: SalonPlano[];
  resumen: ResumenPlano;
}

/** Evento `alerta` del SSE. */
export interface AlertaEvento {
  id: string;
  tipo: TipoAlerta;
  mesa_id: string | null;
  mesa_nombre: string | null;
  estado: EstadoAlerta;
  creada_en: string;
  detalle: string | null;
}
export type EventoStreamSalon =
  | { nombre: 'plano'; datos: Plano }
  | { nombre: 'alerta'; datos: AlertaEvento };

export interface Reglas {
  minutos_sin_atencion: number;
  minutos_escalado: number;
  histeresis_ocupada_seg: number;
  histeresis_libre_seg: number;
  minutos_limpieza: number;
  min_confianza: number;
  modo_manual: boolean;
  guardar_recorte_alertas: boolean;
  /** Minutos por tamaño de grupo cuando no hay histórico: claves "1".."6". */
  duracion_defecto_min: Record<string, number>;
  /** §4.6: mesas que atiende un mesero (def. 4). */
  mesas_por_mesero?: number;
}

export interface Salud {
  vision_ok: boolean;
  worker: string | null;
  ultimo_latido_en: string | null;
  camaras: Camara[];
  alertas_camara: number;
}

// ── §4.4 Alertas ────────────────────────────────────────────────────────────
export interface Alerta {
  id: string;
  tienda_id: string;
  mesa_id: string | null;
  mesa_nombre: string | null;
  tipo: TipoAlerta;
  estado: EstadoAlerta;
  creada_en: string;
  atendida_en: string | null;
  atendida_por: string | null;
  detalle: string | null;
  segundos_para_atender: number | null;
}
export interface FiltroAlertas { estado?: EstadoAlerta | null; desde?: string | null; hasta?: string | null; }

// ── §4.5 Predicción y espera ────────────────────────────────────────────────
export interface Prediccion {
  mesa_id: string;
  mesa_nombre: string;
  capacidad: number;
  personas: number | null;
  ocupada_desde: string;
  minutos_transcurridos: number;
  minutos_para_liberar: number;
  liberacion_estimada_en: string;
  base: 'HISTORICO' | 'DEFECTO';
}
export interface Espera {
  id: string;
  tienda_id: string;
  nombre: string;
  personas: number;
  telefono: string | null;
  canal: CanalEspera;
  estado: EstadoEspera;
  posicion: number | null;
  creado_en: string;
  avisado_en: string | null;
  sentado_en: string | null;
  mesa_id: string | null;
  minutos_estimados: number | null;
}
export interface EsperaForm { nombre: string; personas: number; telefono: string | null; canal: 'ANFITRION'; }

// ── §4.6 Analítica ──────────────────────────────────────────────────────────
/** `dia_semana` 1 = lunes … 7 = domingo. */
export interface MapaCalorCelda { dia_semana: number; hora: number; ocupacion_pct: number; grupos: number; }
export interface RotacionMesa { mesa_id: string; mesa_nombre: string; grupos: number; minutos_medios_ocupada: number; minutos_medios_limpieza: number; }
export interface AlertasAnalitica { total: number; atencion: number; escalado: number; limpieza: number; falsos_positivos: number; pct_falsos_positivos: number; }
export interface RecomendacionMeseros { dia_semana: number; franja: string; mesas_ocupadas_medias: number; meseros: number; }
export interface DuracionPorTamano { personas: number; minutos_medios: number; muestras: number; }
export interface Analitica {
  desde: string;
  hasta: string;
  mapa_calor: MapaCalorCelda[];
  rotacion_por_mesa: RotacionMesa[];
  tiempo_medio_atencion_seg: number | null;
  tiempo_medio_limpieza_seg: number | null;
  alertas: AlertasAnalitica;
  recomendacion_meseros: RecomendacionMeseros[];
  duracion_por_tamano: DuracionPorTamano[];
}

// ── Alcance de tiendas (ms-store `/tiendas/mi-alcance`, misma forma que tienda.service.ts) ──
export interface TiendaSalon {
  id: string;
  negocio_id: string;
  codigo: string;
  nombre: string;
  tipo: string;
  municipio: string | null;
  activa: boolean;
  rol_en_la_tienda: string | null;
}
export interface AlcanceSalon {
  super_admin: boolean;
  ve_todo: boolean;
  tiendas: TiendaSalon[];
  nodos: string[];
}

export const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;
export function nombreDia(diaSemana: number): string { return DIAS_SEMANA[(diaSemana - 1 + 7) % 7]; }

export const ETIQUETA_ESTADO: Record<EstadoMesa, string> = {
  LIBRE: 'Libre', OCUPADA: 'Ocupada', POR_LIMPIAR: 'Por limpiar', RESERVADA: 'Reservada',
};
export const ETIQUETA_ALERTA: Record<TipoAlerta, string> = {
  ATENCION: 'Sin atención', ESCALADO: 'Escalado', LIMPIEZA: 'Limpieza', CAMARA: 'Cámara',
};
