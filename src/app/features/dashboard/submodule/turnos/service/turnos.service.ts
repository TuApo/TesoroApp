import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';

/**
 * Cliente de ms-turnos.
 *
 * <p>El servidor sirve snake_case (`tuapo.json.snake-case: true`), así que las interfaces lo
 * respetan tal cual. Renombrar a camelCase aquí obligaría a un mapeo por pantalla y, en
 * cuanto uno se olvide, el campo llega `undefined` sin que nada falle a la vista.
 */

// ── Oficinas y croquis ────────────────────────────────────────────────────────

export interface Oficina {
  id: string; sede_ref: string | null; sede_nombre: string | null;
  nombre: string; codigo: string; direccion: string | null; ciudad: string | null; telefono: string | null;
  hora_apertura: string | null; hora_cierre: string | null; dias_habiles: string;
  activa: boolean; ui_json: string | null;
  creado_en: string; actualizado_en: string;
  servicios: number; puntos: number; pantallas: number;
  tiene_croquis: boolean; cartel_codigo: string | null;
}

export interface OficinaIn {
  nombre: string; codigo: string; sede_ref?: string | null; sede_nombre?: string | null;
  direccion?: string | null; ciudad?: string | null; telefono?: string | null;
  hora_apertura?: string | null; hora_cierre?: string | null; dias_habiles?: string;
  activa?: boolean; ui_json?: string | null;
}

export type TipoArea = 'RECEPCION' | 'MODULO' | 'VENTANILLA' | 'PUESTO' | 'OFICINA' | 'AREA_ATENCION' | 'SALA_ESPERA'
  | 'PASILLO' | 'BANO' | 'SALIDA' | 'ENTRADA' | 'ESCALERA' | 'ASCENSOR' | 'OTRO';
export type FormaArea = 'RECTANGULO' | 'REDONDEADO' | 'CIRCULO' | 'POLIGONO';

export interface Area {
  id: string; oficina_id?: string; croquis_id?: string | null;
  nombre: string; codigo: string | null; tipo: TipoArea;
  x: number; y: number; ancho: number; alto: number; rotacion: number;
  forma: FormaArea; puntos_json: string | null;
  color: string | null; icono: string | null;
  referencia: string | null; piso: string | null; descripcion: string | null;
  orden: number; activa: boolean;
  /** Personas que atienden aquí (0 = no es puesto) y si la atención es móvil (apoyo). */
  capacidad: number; movil: boolean;
  /** Servicios que se atienden aquí (solo lectura). */
  servicios?: string[];
  /** Puestos que nacieron de esta área (solo lectura). */
  puestos?: PuestoDeArea[];
}

export interface PuestoDeArea {
  id: string; nombre: string; tipo: 'FIJO' | 'MOVIL'; indice: number; activo: boolean;
  usuario_ref: string | null; usuario_nombre: string | null;
}

/** Elemento decorativo del croquis (pared, puerta, sillas, texto, flecha…); vive en elementos_json. */
export interface ElementoCroquis {
  id: string;
  tipo: 'PARED' | 'PUERTA' | 'VENTANA' | 'SILLA' | 'TEXTO' | 'FLECHA' | 'ICONO' | 'MESA' | 'PLANTA' | 'MOSTRADOR';
  x: number; y: number; ancho: number; alto: number; rotacion: number;
  texto?: string; color?: string; grosor?: number; icono?: string; tamano?: number;
  /** Sillas: cuántas van pegadas en el módulo (1 a 4). */
  cantidad?: number;
}

/** Un piso del croquis: su propio lienzo y sus propios elementos. Las áreas llevan `piso`. */
export interface PisoCroquis {
  id: string; nombre: string; ancho: number; alto: number; elementos: ElementoCroquis[];
}

/** Formato v2 de elementos_json. Un array plano (v1) equivale a un solo piso. */
export interface ElementosJson { v: 2; pisos: PisoCroquis[]; }

export interface Croquis {
  id: string; oficina_id: string; nombre: string; version: number;
  ancho: number; alto: number; escala_cm_px: number | null;
  fondo_color: string | null; fondo_imagen_url: string | null; elementos_json: string | null;
  publicado: boolean; publicado_en: string | null; creado_en: string; actualizado_en: string;
  areas: Area[];
}

export interface CroquisIn {
  nombre?: string; ancho?: number; alto?: number; escala_cm_px?: number | null;
  fondo_color?: string | null; fondo_imagen_url?: string | null; elementos_json?: string | null;
  areas?: Partial<Area>[]; nueva_version?: boolean;
}

export interface Punto {
  id: string; oficina_id: string; area_id: string | null; area_nombre: string | null;
  area_tipo: TipoArea | null; area_piso: string | null;
  nombre: string; codigo: string | null; orden: number; activo: boolean;
  /** FIJO|MOVIL · posición en el área · CROQUIS (lo administra el plano) | MANUAL */
  tipo: 'FIJO' | 'MOVIL'; indice: number; origen: 'CROQUIS' | 'MANUAL';
  usuario_ref: string | null; usuario_nombre: string | null; ocupado_desde: string | null;
  servicios: string[];
}

export interface PuntoIn {
  nombre: string; codigo?: string | null; tipo?: 'FIJO' | 'MOVIL'; area_id?: string | null; orden?: number; activo?: boolean;
  servicios?: string[] | null;
}

export type PlantillaCartel = 'A4_VERTICAL' | 'A4_HORIZONTAL' | 'CARTA_VERTICAL' | 'MEDIA_CARTA' | 'ADHESIVO_10X15';

export interface Cartel {
  id: string; oficina_id: string; croquis_id: string | null;
  titulo: string; subtitulo: string | null; codigo_publico: string; plantilla: PlantillaCartel;
  mostrar_croquis: boolean; mostrar_qr: boolean; mostrar_servicios: boolean;
  instrucciones: string | null; pie: string | null; estilo_json: string | null;
  version: number; vigente: boolean; impreso_en: string | null; creado_en: string;
  url_qr: string; qr_data_uri: string | null;
}

export interface CartelIn {
  titulo?: string; subtitulo?: string | null; plantilla?: PlantillaCartel;
  mostrar_croquis?: boolean; mostrar_qr?: boolean; mostrar_servicios?: boolean;
  instrucciones?: string | null; pie?: string | null; estilo_json?: string | null; croquis_id?: string | null;
}

export interface ServicioEnCartel {
  nombre: string; prefijo: string; color: string | null; icono: string | null;
  area: string | null; referencia: string | null; piso: string | null; descripcion: string | null;
}

export interface CartelImprimible {
  cartel: Cartel; oficina: Oficina; croquis: Croquis | null; servicios: ServicioEnCartel[];
}

// ── Servicios y turnos ────────────────────────────────────────────────────────

export interface Servicio {
  id: string; oficina_id: string; area_id: string | null; area_nombre: string | null; area_referencia: string | null;
  nombre: string; descripcion: string | null; prefijo: string; color: string | null; icono: string | null;
  prioridad: number; tiempo_estimado_min: number; requiere_documento: boolean; requiere_cita: boolean;
  cupo_diario: number; hora_apertura: string | null; hora_cierre: string | null; dias_habiles: string | null;
  publico: boolean; orden: number; activo: boolean;
  en_espera: number; espera_estimada_min: number;
}

export interface ServicioIn {
  nombre: string; descripcion?: string | null; prefijo: string; area_id?: string | null;
  color?: string | null; icono?: string | null; prioridad?: number; tiempo_estimado_min?: number;
  requiere_documento?: boolean; requiere_cita?: boolean; cupo_diario?: number;
  hora_apertura?: string | null; hora_cierre?: string | null; dias_habiles?: string | null;
  publico?: boolean; orden?: number; activo?: boolean;
}

export type EstadoTurno = 'EN_ESPERA' | 'LLAMADO' | 'EN_ATENCION' | 'ATENDIDO' | 'NO_SE_PRESENTO'
  | 'CANCELADO' | 'TRANSFERIDO' | 'APLAZADO';

export interface Turno {
  id: string; oficina_id: string; servicio_id: string; servicio_nombre: string | null; servicio_color: string | null;
  fecha: string; numero: number; codigo: string; estado: EstadoTurno;
  prioridad: 'NORMAL' | 'PREFERENCIAL' | 'CITA'; canal: string;
  documento: string | null; nombre: string | null; telefono: string | null; correo: string | null;
  empresa_usuaria_ref: number | null; empresa_usuaria_nombre: string | null;
  punto_id: string | null; punto_nombre: string | null; punto_tipo: 'FIJO' | 'MOVIL' | null;
  /** Reserva de recepción: puesto y persona a quien se le guardó el turno. */
  asignado_punto_id: string | null; asignado_punto_nombre: string | null;
  asignado_usuario_ref: string | null; asignado_usuario_nombre: string | null;
  /** Enlace al registro de la persona en contratación. */
  persona_ref: string | null; persona_origen: string | null;
  atendido_por: string | null; atendido_por_nombre: string | null;
  area_id: string | null; area_nombre: string | null; area_referencia: string | null;
  creado_en: string; llamado_en: string | null; iniciado_en: string | null; finalizado_en: string | null;
  espera_seg: number | null; atencion_seg: number | null; llamadas: number;
  motivo: string | null; observaciones: string | null;
  delante: number | null; espera_estimada_min: number | null;
}

export interface TomarTurnoIn {
  servicio_id: string; prioridad?: string; canal?: string;
  documento?: string | null; nombre?: string | null; telefono?: string | null; correo?: string | null;
  empresa_usuaria_ref?: number | null; empresa_usuaria_nombre?: string | null; observaciones?: string | null;
  /** Recepción: reservar para un puesto (quién lo atiende) y enlazar la persona encontrada. */
  asignado_punto_id?: string | null; persona_ref?: string | null; persona_origen?: string | null;
}

/** Una persona encontrada en contratación (mismo buscador que el pipeline). */
export interface PersonaContratacion {
  id: number; numero_documento: string; nombre: string | null;
  primer_nombre: string | null; segundo_nombre: string | null; primer_apellido: string | null; segundo_apellido: string | null;
  email: string | null; celular: string | null; whatsapp: string | null; oficina: string | null;
  proceso_id: number | null; contratado: number | null; vacante_cargo: string | null; vacante_empresa: string | null;
  vacante_finca: string | null; codigo_contrato: string | null; contrato_activo: number | null; documentos: number;
}

export interface Tiquete {
  turno: Turno; oficina_nombre: string; oficina_codigo: string; servicio_nombre: string;
  area_nombre: string | null; area_referencia: string | null; mensaje: string; url_seguimiento: string;
}

export interface ResumenServicio {
  servicio_id: string; servicio: string; prefijo: string;
  emitidos: number; atendidos: number; ausentes: number; cancelados: number; en_espera: number;
  espera_prom_seg: number | null; atencion_prom_seg: number | null; espera_max_seg: number | null;
}

export interface Cola {
  oficina_id: string; oficina_nombre: string; fecha: string;
  en_espera: Turno[]; en_curso: Turno[]; por_servicio: ResumenServicio[];
  puestos_abiertos: number; generado_en: string;
}

export interface ResumenAsesor {
  usuario_ref: string; usuario: string; atendidos: number; atencion_prom_seg: number | null; atencion_total_seg: number;
}
export interface ResumenHora { hora: number; emitidos: number; espera_prom_seg: number | null; }

export interface Tablero {
  oficina_id: string; desde: string; hasta: string;
  por_servicio: ResumenServicio[]; por_asesor: ResumenAsesor[]; por_hora: ResumenHora[];
}

export interface EstadoAtencion {
  oficina_id: string | null; oficina_nombre: string | null;
  punto_id: string | null; punto_nombre: string | null;
  turno_actual: Turno | null; siguiente: Turno | null;
  en_espera: number; atendidos_hoy: number; atencion_prom_seg: number | null;
  /** Segundos que lleva esperando quien más lleva; alimenta el semáforo. */
  espera_max_seg: number | null;
  /** true si no hay puesto abierto y los datos son de la oficina preferida. */
  sin_puesto: boolean;
}

export interface EventoTurno {
  id: number; tipo: string; de_estado: string | null; a_estado: string | null;
  usuario_nombre: string | null; punto_id: string | null; detalle: string | null; creado_en: string;
}

// ── Pantallas y piezas ────────────────────────────────────────────────────────

export type TipoMedia = 'IMAGEN' | 'VIDEO' | 'YOUTUBE' | 'VIMEO' | 'HTML' | 'CURSO' | 'TEXTO' | 'AUDIO';
/** Perifoneo: días ISO (1 = lunes … 7 = domingo) y franja horaria. */
export interface HorarioPieza { dias: number[]; desde: string; hasta: string; }
export type TipoAlcance = 'GLOBAL' | 'OFICINA' | 'SEDE' | 'EMPRESA' | 'EMPRESA_USUARIA' | 'CIUDAD';

export interface Alcance { id?: number; tipo: TipoAlcance; valor_ref: string | null; valor_nombre: string | null; }

export interface Media {
  id: string; tipo: TipoMedia; titulo: string; descripcion: string | null;
  url: string | null; archivo_nombre: string | null; mime: string | null; bytes: number | null;
  ancho: number | null; alto: number | null; duracion_seg: number; ajuste: 'CONTENER' | 'CUBRIR' | 'ESTIRAR';
  silenciado: boolean; curso_ref: string | null; curso_url: string | null;
  vigente_desde: string | null; vigente_hasta: string | null; activo: boolean; etiquetas: string | null;
  creado_en: string; creado_por_nombre: string | null; alcances: Alcance[];
  vigente: boolean; emisiones: number | null;
  /** AUDIO con voz: texto locutado, voz y audio generado; cama musical; perifoneo. */
  voz_texto: string | null; voz_id: string | null; voz_audio_id: string | null;
  cama_media_id: string | null; cama_volumen: number; es_cama: boolean;
  intervalo_min: number | null; horario_json: string | null;
}

export interface MediaIn {
  tipo?: TipoMedia; titulo: string; descripcion?: string | null; url?: string | null;
  duracion_seg?: number; ajuste?: string; silenciado?: boolean;
  curso_ref?: string | null; curso_url?: string | null;
  vigente_desde?: string | null; vigente_hasta?: string | null; activo?: boolean; etiquetas?: string | null;
  alcances?: Alcance[] | null;
  voz_texto?: string | null; voz_id?: string | null; cama_media_id?: string | null; cama_volumen?: number;
  es_cama?: boolean; intervalo_min?: number | null; horario_json?: string | null;
}

// ── Voz y locución (ElevenLabs) ────────────────────────────────────────────────

export interface VozDisponible {
  voz_id: string; nombre: string; categoria: string | null; idioma: string | null; acento: string | null;
  genero: string | null; edad: string | null; uso: string | null; descripcion: string | null; preview_url: string | null;
}
export interface VozSuscripcion {
  plan: string | null; estado: string | null; caracteres_usados: number; caracteres_limite: number;
  proximo_reinicio_unix: number; voces_limite: number; voces_usadas: number; puede_clonar: boolean;
}
export interface VozEstado {
  habilitada: boolean; suscripcion: VozSuscripcion | null; error_cuenta: string | null;
  audios_en_cache: number; caracteres_sintetizados: number; reutilizaciones: number; bytes_en_disco: number;
}
export interface VozAjustes {
  id: string | null; oficina_id: string | null; origen: 'PROPIO' | 'GLOBAL' | 'DEFECTO';
  voz_id: string | null; voz_nombre: string | null; modelo_llamado: string; modelo_locucion: string;
  estabilidad: number; similitud: number; estilo: number; velocidad: number;
  plantilla_llamado: string; plantilla_llamado_movil: string; cantar_con_voz: boolean;
  usar_nombre: boolean; musica_fondo_media_id: string | null; musica_fondo_titulo: string | null; musica_fondo_volumen: number; atenuar_volumen: number;
  actualizado_en: string | null;
}
export interface VozPublica { cantar_con_voz: boolean; usar_nombre: boolean; atenuar_volumen: number; musica_fondo_url: string | null; musica_fondo_volumen: number; }
/** Una frase del catálogo del turnero con su texto vigente y el audio (si existe) para la voz consultada. */
export interface VozFrase {
  clave: string; nombre: string; cuando: string; con_variables: boolean; rapida: boolean;
  texto: string; origen: 'PROPIO' | 'GLOBAL' | 'DEFECTO'; texto_defecto: string; ejemplo: string; audio: VozAudio | null;
}
export interface VozAjustesIn {
  oficina_id?: string | null; voz_id?: string | null; voz_nombre?: string | null; modelo_llamado?: string; modelo_locucion?: string;
  estabilidad?: number; similitud?: number; estilo?: number; velocidad?: number;
  plantilla_llamado?: string; plantilla_llamado_movil?: string; cantar_con_voz?: boolean;
  usar_nombre?: boolean; musica_fondo_media_id?: string | null; musica_fondo_volumen?: number; atenuar_volumen?: number;
}
export interface VozAudio {
  id: string; texto: string; voz_id: string; voz_nombre: string | null; modelo: string; uso: 'LLAMADO' | 'LOCUCION' | 'PRUEBA' | 'BIBLIOTECA'; clave: string | null;
  bytes: number; duracion_ms: number | null; caracteres: number; veces: number; creado_en: string; ultimo_uso: string | null;
  url: string; de_cache: boolean;
}
export interface VozModelo { id: string; nombre: string; para: string; }

export interface PlaylistItem { id: number; media_id: string; orden: number; duracion_seg: number | null; media: Media; }

export interface Playlist {
  id: string; nombre: string; descripcion: string | null; oficina_id: string | null;
  modo: 'SECUENCIAL' | 'ALEATORIO'; activa: boolean; creado_en: string;
  items: PlaylistItem[]; duracion_total_seg: number;
}

export interface PlaylistIn {
  nombre: string; descripcion?: string | null; oficina_id?: string | null; modo?: string; activa?: boolean;
  items?: { media_id: string; orden?: number; duracion_seg?: number | null }[] | null;
}

export interface Pantalla {
  id: string; oficina_id: string; oficina_nombre: string | null;
  nombre: string; codigo_publico: string; layout: 'TURNOS_MEDIA' | 'SOLO_TURNOS' | 'SOLO_MEDIA' | 'MEDIA_DESTACADO';
  orientacion: 'HORIZONTAL' | 'VERTICAL'; turnos_visibles: number;
  mostrar_reloj: boolean; mostrar_croquis: boolean; sonido: boolean; voz: boolean; voz_plantilla: string;
  tema: 'OSCURO' | 'CLARO' | 'CORPORATIVO'; estilo_json: string | null; servicios: string[]; activa: boolean;
  ultima_conexion: string | null; en_linea: boolean; creado_en: string; playlists: string[];
  url: string; qr_data_uri: string | null;
  /** Guion que le toca hoy y de dónde sale (PANTALLA|OFICINA|GLOBAL|NINGUNO). */
  diseno_nombre: string | null; diseno_origen: OrigenDiseno;
}

export interface PantallaIn {
  nombre: string; layout?: string; orientacion?: string; turnos_visibles?: number;
  mostrar_reloj?: boolean; mostrar_croquis?: boolean; sonido?: boolean; voz?: boolean; voz_plantilla?: string;
  tema?: string; estilo_json?: string | null; servicios?: string[] | null; activa?: boolean; playlists?: string[] | null;
}

export interface VistaPantalla {
  pantalla_id: string; nombre: string; layout: Pantalla['layout']; orientacion: Pantalla['orientacion'];
  tema: Pantalla['tema']; estilo_json: string | null; mostrar_reloj: boolean; mostrar_croquis: boolean;
  sonido: boolean; voz: boolean; voz_plantilla: string; turnos_visibles: number;
  oficina_id: string; oficina_nombre: string;
  en_curso: Turno[]; en_espera: Turno[]; piezas: Media[]; croquis: Croquis | null;
  diseno: DisenoResuelto | null;
  /** Cómo canta la voz en esta oficina: atenuación de publicidad y música de fondo. */
  voz_marca: VozPublica | null;
  /** Avisos vigentes para la pantalla, en orden (bloque y pantalla completa). */
  avisos: Aviso[];
  generado_en: string;
}

// ── Avisos en pantalla ─────────────────────────────────────────────────────────

export type ModoAviso = 'BLOQUE' | 'PANTALLA_COMPLETA';
export interface Aviso {
  id: string; oficina_id: string | null; titulo: string; texto: string | null; modo: ModoAviso; duracion_seg: number;
  color: string | null; icono: string | null; con_voz: boolean; voz_audio_id: string | null; audio_url: string | null;
  orden: number; intervalo_min: number | null; vigente_desde: string | null; vigente_hasta: string | null;
  activo: boolean; vigente: boolean; creado_en: string; actualizado_en: string;
}
export interface AvisoIn {
  oficina_id?: string | null; titulo: string; texto?: string | null; modo: ModoAviso; duracion_seg?: number;
  color?: string | null; icono?: string | null; con_voz?: boolean; orden?: number; intervalo_min?: number | null;
  vigente_desde?: string | null; vigente_hasta?: string | null; activo?: boolean;
}

// ── Diseñador de pantallas: vistas y guiones ───────────────────────────────────

export type TipoBloque = 'TURNO_LLAMADO' | 'LISTA_ATENCION' | 'LISTA_ESPERA' | 'PUBLICIDAD' | 'RELOJ'
  | 'TEXTO' | 'IMAGEN' | 'CROQUIS' | 'QR' | 'OFICINA' | 'LOGO' | 'NOTIFICACIONES';
export type Transicion = 'NINGUNA' | 'FUNDIDO' | 'DESLIZAR_IZQUIERDA' | 'DESLIZAR_ARRIBA' | 'ZOOM';
export type AlcanceGuion = 'PANTALLAS' | 'OFICINA' | 'GLOBAL';
export type OrigenDiseno = 'PANTALLA' | 'OFICINA' | 'GLOBAL' | 'NINGUNO';

/** Estilo común a todo bloque; los tamaños van en % de la altura del televisor. */
export interface EstiloBloque {
  fondo?: string | null; color?: string | null; radio?: number; relleno?: number; opacidad?: number;
  tamano?: number; alinear?: 'izquierda' | 'centro' | 'derecha'; sombra?: boolean; borde?: string | null; negrita?: boolean;
}
export interface Bloque {
  id: string; tipo: TipoBloque; x: number; y: number; w: number; h: number; z?: number;
  estilo?: EstiloBloque; props?: Record<string, unknown>;
}
export interface FondoVista {
  tipo: 'COLOR' | 'DEGRADADO' | 'IMAGEN'; color?: string; color2?: string; angulo?: number; url?: string | null; ajuste?: 'CUBRIR' | 'CONTENER';
}
export interface Vista {
  id: string; oficina_id: string | null; nombre: string; descripcion: string | null;
  orientacion: 'HORIZONTAL' | 'VERTICAL'; fondo: FondoVista | null; bloques: Bloque[]; activa: boolean;
  creado_en: string; actualizado_en: string; usada_por: string[];
}
export interface VistaIn {
  nombre: string; descripcion?: string | null; oficina_id?: string | null; orientacion?: string;
  fondo?: FondoVista | null; bloques: Bloque[]; activa?: boolean;
}
export interface Paso { vista_id: string; duracion_seg: number; transicion: Transicion; transicion_ms: number; }
export interface Guion {
  id: string; oficina_id: string | null; nombre: string; descripcion: string | null; alcance: AlcanceGuion;
  pasos: Paso[]; al_llamar_vista_id: string | null; al_llamar_seg: number; activo: boolean;
  pantallas: string[]; duracion_total_seg: number; creado_en: string; actualizado_en: string;
}
export interface GuionIn {
  nombre: string; descripcion?: string | null; oficina_id?: string | null; alcance: AlcanceGuion;
  pasos: Paso[]; al_llamar_vista_id?: string | null; al_llamar_seg?: number; activo?: boolean; pantallas?: string[] | null;
}
/** El diseño ya resuelto para una pantalla: guion, vistas y piezas de las listas que piden sus bloques. */
export interface DisenoResuelto {
  origen: OrigenDiseno; guion: Guion | null; vistas: Vista[]; playlists: Record<string, Media[]>;
  url_turno: string | null; firma: string;
}

export interface ReporteEmision { media_id: string; titulo: string; tipo: string; emisiones: number; segundos: number; }

// ── Casos y panel ─────────────────────────────────────────────────────────────

export interface Caso {
  id: string; usuario_ref: string; oficina_id: string | null; turno_id: string | null;
  turno_codigo: string | null; turno_estado: EstadoTurno | null;
  nombre: string; nombre_manual: boolean;
  documento: string | null; persona_nombre: string | null; telefono: string | null; correo: string | null;
  empresa_usuaria_ref: number | null; empresa_usuaria_nombre: string | null; motivo: string | null;
  estado: 'ABIERTO' | 'PAUSADO' | 'CERRADO'; color: string | null; fijado: boolean; orden: number;
  contexto_json: string | null; segundos_activo: number; activado_en: string | null;
  creado_en: string; actualizado_en: string; cerrado_en: string | null; resultado: string | null; notas: number;
}

export interface CasoIn {
  turno_id?: string | null; oficina_id?: string | null; nombre?: string | null;
  documento?: string | null; persona_nombre?: string | null; telefono?: string | null; correo?: string | null;
  empresa_usuaria_ref?: number | null; empresa_usuaria_nombre?: string | null; motivo?: string | null;
  color?: string | null; activar?: boolean;
}

export interface CasoPatch {
  nombre?: string | null; nombre_automatico?: boolean;
  documento?: string | null; persona_nombre?: string | null; telefono?: string | null; correo?: string | null;
  empresa_usuaria_ref?: number | null; empresa_usuaria_nombre?: string | null; motivo?: string | null;
  color?: string | null; fijado?: boolean; orden?: number; contexto_json?: string | null;
}

export interface Nota { id: number; texto: string; usuario_ref: string | null; usuario_nombre: string | null; creado_en: string; }
export interface CasoDetalle { caso: Caso; turno: Turno | null; notas: Nota[]; }

export interface Preferencia {
  usuario_ref: string; oficina_id: string | null; punto_id: string | null;
  panel_abierto: boolean; panel_alto: number; caso_activo_id: string | null; auto_llamar: boolean; sonido: boolean;
}

export interface Panel { preferencia: Preferencia; atencion: EstadoAtencion; casos: Caso[]; max_casos_abiertos: number; }

export interface Pagina<T> { content: T[]; total_elements: number; total_pages: number; number: number; size: number; }

@Injectable({ providedIn: 'root' })
export class TurnosService {
  private http = inject(HttpClient);
  readonly base = `${environment.apiUrl}/api/v1/turnos`;
  readonly basePublica = `${environment.apiUrl}/api/v1/public/turnos`;

  // ── Oficinas ──
  oficinas(soloActivas = true): Observable<Oficina[]> {
    return this.http.get<Oficina[]>(`${this.base}/oficinas`, { params: { soloActivas } });
  }
  oficina(id: string): Observable<Oficina> { return this.http.get<Oficina>(`${this.base}/oficinas/${id}`); }
  crearOficina(in_: OficinaIn): Observable<Oficina> { return this.http.post<Oficina>(`${this.base}/oficinas`, in_); }
  actualizarOficina(id: string, in_: OficinaIn): Observable<Oficina> { return this.http.put<Oficina>(`${this.base}/oficinas/${id}`, in_); }
  desactivarOficina(id: string): Observable<void> { return this.http.delete<void>(`${this.base}/oficinas/${id}`); }
  soyAdmin(): Observable<{ admin: boolean }> { return this.http.get<{ admin: boolean }>(`${this.base}/soy-admin`); }

  // ── Puntos ──
  puntos(oficinaId: string): Observable<Punto[]> { return this.http.get<Punto[]>(`${this.base}/oficinas/${oficinaId}/puntos`); }
  crearPunto(oficinaId: string, in_: PuntoIn): Observable<Punto> { return this.http.post<Punto>(`${this.base}/oficinas/${oficinaId}/puntos`, in_); }
  actualizarPunto(id: string, in_: PuntoIn): Observable<Punto> { return this.http.put<Punto>(`${this.base}/puntos/${id}`, in_); }
  eliminarPunto(id: string): Observable<void> { return this.http.delete<void>(`${this.base}/puntos/${id}`); }

  // ── Croquis ──
  croquis(oficinaId: string, borrador = false): Observable<Croquis | null> {
    return this.http.get<Croquis | null>(`${this.base}/oficinas/${oficinaId}/croquis`, { params: { borrador } });
  }
  versionesCroquis(oficinaId: string): Observable<Croquis[]> { return this.http.get<Croquis[]>(`${this.base}/oficinas/${oficinaId}/croquis/versiones`); }
  croquisPorId(id: string): Observable<Croquis> { return this.http.get<Croquis>(`${this.base}/croquis/${id}`); }
  guardarCroquis(oficinaId: string, in_: CroquisIn): Observable<Croquis> { return this.http.put<Croquis>(`${this.base}/oficinas/${oficinaId}/croquis`, in_); }
  publicarCroquis(id: string): Observable<Croquis> { return this.http.post<Croquis>(`${this.base}/croquis/${id}/publicar`, {}); }

  // ── Cartel ──
  carteles(oficinaId: string): Observable<Cartel[]> { return this.http.get<Cartel[]>(`${this.base}/oficinas/${oficinaId}/carteles`); }
  guardarCartel(oficinaId: string, in_: CartelIn): Observable<Cartel> { return this.http.put<Cartel>(`${this.base}/oficinas/${oficinaId}/cartel`, in_); }
  cartelImprimible(id: string): Observable<CartelImprimible> { return this.http.get<CartelImprimible>(`${this.base}/carteles/${id}/imprimible`); }
  marcarImpreso(id: string): Observable<Cartel> { return this.http.post<Cartel>(`${this.base}/carteles/${id}/impreso`, {}); }

  // ── Servicios ──
  servicios(oficinaId: string, soloPublicos = false): Observable<Servicio[]> {
    return this.http.get<Servicio[]>(`${this.base}/oficinas/${oficinaId}/servicios`, { params: { soloPublicos } });
  }
  crearServicio(oficinaId: string, in_: ServicioIn): Observable<Servicio> { return this.http.post<Servicio>(`${this.base}/oficinas/${oficinaId}/servicios`, in_); }
  actualizarServicio(id: string, in_: ServicioIn): Observable<Servicio> { return this.http.put<Servicio>(`${this.base}/servicios/${id}`, in_); }
  desactivarServicio(id: string): Observable<void> { return this.http.delete<void>(`${this.base}/servicios/${id}`); }

  // ── Cola / tablero ──
  cola(oficinaId: string, fecha?: string): Observable<Cola> {
    let params = new HttpParams();
    if (fecha) params = params.set('fecha', fecha);
    return this.http.get<Cola>(`${this.base}/oficinas/${oficinaId}/cola`, { params });
  }
  tablero(oficinaId: string, desde?: string, hasta?: string): Observable<Tablero> {
    let params = new HttpParams();
    if (desde) params = params.set('desde', desde);
    if (hasta) params = params.set('hasta', hasta);
    return this.http.get<Tablero>(`${this.base}/oficinas/${oficinaId}/tablero`, { params });
  }
  historial(oficinaId: string, desde?: string, hasta?: string, page = 0, size = 50): Observable<Pagina<Turno>> {
    let params = new HttpParams().set('page', page).set('size', size);
    if (desde) params = params.set('desde', desde);
    if (hasta) params = params.set('hasta', hasta);
    return this.http.get<Pagina<Turno>>(`${this.base}/oficinas/${oficinaId}/historial`, { params });
  }
  turno(id: string): Observable<Turno> { return this.http.get<Turno>(`${this.base}/turnos/${id}`); }
  eventosDeTurno(id: string): Observable<EventoTurno[]> { return this.http.get<EventoTurno[]>(`${this.base}/turnos/${id}/eventos`); }
  emitirTurno(oficinaId: string, in_: TomarTurnoIn): Observable<Tiquete> { return this.http.post<Tiquete>(`${this.base}/oficinas/${oficinaId}/turnos`, in_); }
  cancelarEnEspera(turnoId: string, motivo?: string): Observable<Turno> { return this.http.post<Turno>(`${this.base}/turnos/${turnoId}/cancelar`, { motivo: motivo ?? null }); }
  /** Reservar un turno en espera para un puesto (null = cola general). */
  asignarTurno(turnoId: string, puntoId: string | null): Observable<Turno> { return this.http.post<Turno>(`${this.base}/turnos/${turnoId}/asignar`, { punto_id: puntoId }); }

  /** Búsqueda amplia de personas en contratación: documento, nombre, correo o teléfono (mín. 3 caracteres). */
  buscarPersonas(q: string): Observable<PersonaContratacion[]> {
    return this.http.get<PersonaContratacion[]>(`${environment.apiUrl}/gestion_contratacion/documento/buscar`, { params: { q } });
  }

  // ── Atención (en nombre de quien llama) ──
  estadoAtencion(): Observable<EstadoAtencion> { return this.http.get<EstadoAtencion>(`${this.base}/atencion/estado`); }
  abrirPuesto(puntoId: string, servicios?: string[] | null): Observable<EstadoAtencion> {
    return this.http.post<EstadoAtencion>(`${this.base}/atencion/abrir`, { punto_id: puntoId, servicios: servicios ?? null });
  }
  cerrarPuesto(): Observable<EstadoAtencion> { return this.http.post<EstadoAtencion>(`${this.base}/atencion/cerrar-puesto`, {}); }
  llamar(puntoId: string, turnoId?: string | null): Observable<Turno> {
    return this.http.post<Turno>(`${this.base}/atencion/llamar`, { punto_id: puntoId, turno_id: turnoId ?? null });
  }
  iniciar(turnoId: string): Observable<Turno> { return this.http.post<Turno>(`${this.base}/atencion/iniciar/${turnoId}`, {}); }
  cerrarTurno(turnoId: string, resultado: 'ATENDIDO' | 'NO_SE_PRESENTO' | 'CANCELADO', motivo?: string | null, observaciones?: string | null): Observable<Turno> {
    return this.http.post<Turno>(`${this.base}/atencion/cerrar`, { turno_id: turnoId, resultado, motivo: motivo ?? null, observaciones: observaciones ?? null });
  }
  transferir(turnoId: string, servicioDestinoId: string, motivo?: string | null, mantenerPrioridad = true): Observable<Turno> {
    return this.http.post<Turno>(`${this.base}/atencion/transferir`, { turno_id: turnoId, servicio_destino_id: servicioDestinoId, motivo: motivo ?? null, mantener_prioridad: mantenerPrioridad });
  }
  aplazar(turnoId: string, motivo?: string | null): Observable<Turno> { return this.http.post<Turno>(`${this.base}/atencion/aplazar/${turnoId}`, { motivo: motivo ?? null }); }

  // ── Pantallas ──
  pantallas(oficinaId: string): Observable<Pantalla[]> { return this.http.get<Pantalla[]>(`${this.base}/oficinas/${oficinaId}/pantallas`); }
  crearPantalla(oficinaId: string, in_: PantallaIn): Observable<Pantalla> { return this.http.post<Pantalla>(`${this.base}/oficinas/${oficinaId}/pantallas`, in_); }
  actualizarPantalla(id: string, in_: PantallaIn): Observable<Pantalla> { return this.http.put<Pantalla>(`${this.base}/pantallas/${id}`, in_); }
  rotarCodigoPantalla(id: string): Observable<Pantalla> { return this.http.post<Pantalla>(`${this.base}/pantallas/${id}/rotar-codigo`, {}); }
  desactivarPantalla(id: string): Observable<void> { return this.http.delete<void>(`${this.base}/pantallas/${id}`); }

  // ── Piezas ──
  buscarMedia(q?: string, tipo?: string, activo?: boolean | null, page = 0, size = 30): Observable<Pagina<Media>> {
    let params = new HttpParams().set('page', page).set('size', size);
    if (q) params = params.set('q', q);
    if (tipo) params = params.set('tipo', tipo);
    if (activo !== null && activo !== undefined) params = params.set('activo', activo);
    return this.http.get<Pagina<Media>>(`${this.base}/media`, { params });
  }
  media(id: string): Observable<Media> { return this.http.get<Media>(`${this.base}/media/${id}`); }
  crearMedia(in_: MediaIn): Observable<Media> { return this.http.post<Media>(`${this.base}/media`, in_); }
  actualizarMedia(id: string, in_: MediaIn): Observable<Media> { return this.http.put<Media>(`${this.base}/media/${id}`, in_); }
  subirArchivoMedia(id: string, archivo: File): Observable<Media> {
    const form = new FormData();
    form.append('archivo', archivo, archivo.name);
    return this.http.post<Media>(`${this.base}/media/${id}/archivo`, form);
  }
  desactivarMedia(id: string): Observable<void> { return this.http.delete<void>(`${this.base}/media/${id}`); }
  reporteEmisiones(desde: string, hasta: string, oficinaId?: string | null): Observable<ReporteEmision[]> {
    let params = new HttpParams().set('desde', desde).set('hasta', hasta);
    if (oficinaId) params = params.set('oficinaId', oficinaId);
    return this.http.get<ReporteEmision[]>(`${this.base}/media/reporte`, { params });
  }
  /** URL absoluta de una pieza (las rutas propias vienen relativas a la API). */
  urlMedia(m: Pick<Media, 'url'>): string | null {
    if (!m.url) return null;
    return m.url.startsWith('http') ? m.url : `${environment.apiUrl}${m.url}`;
  }

  // ── Listas ──
  playlists(oficinaId?: string | null): Observable<Playlist[]> {
    let params = new HttpParams();
    if (oficinaId) params = params.set('oficinaId', oficinaId);
    return this.http.get<Playlist[]>(`${this.base}/playlists`, { params });
  }
  crearPlaylist(in_: PlaylistIn): Observable<Playlist> { return this.http.post<Playlist>(`${this.base}/playlists`, in_); }
  actualizarPlaylist(id: string, in_: PlaylistIn): Observable<Playlist> { return this.http.put<Playlist>(`${this.base}/playlists/${id}`, in_); }
  desactivarPlaylist(id: string): Observable<void> { return this.http.delete<void>(`${this.base}/playlists/${id}`); }

  // ── Casos y panel ──
  panel(): Observable<Panel> { return this.http.get<Panel>(`${this.base}/panel`); }
  preferencias(): Observable<Preferencia> { return this.http.get<Preferencia>(`${this.base}/preferencias`); }
  guardarPreferencias(in_: Partial<Preferencia>): Observable<Preferencia> { return this.http.put<Preferencia>(`${this.base}/preferencias`, in_); }
  casos(): Observable<Caso[]> { return this.http.get<Caso[]>(`${this.base}/casos`); }
  historialCasos(page = 0, size = 30): Observable<Pagina<Caso>> {
    return this.http.get<Pagina<Caso>>(`${this.base}/casos/historial`, { params: { page, size } });
  }
  caso(id: string): Observable<CasoDetalle> { return this.http.get<CasoDetalle>(`${this.base}/casos/${id}`); }
  abrirCaso(in_: CasoIn): Observable<Caso> { return this.http.post<Caso>(`${this.base}/casos`, in_); }
  actualizarCaso(id: string, in_: CasoPatch): Observable<Caso> { return this.http.patch<Caso>(`${this.base}/casos/${id}`, in_); }
  activarCaso(id: string): Observable<Caso> { return this.http.post<Caso>(`${this.base}/casos/${id}/activar`, {}); }
  pausarCaso(id: string): Observable<Caso> { return this.http.post<Caso>(`${this.base}/casos/${id}/pausar`, {}); }
  cerrarCaso(id: string, resultado?: string | null): Observable<Caso> { return this.http.post<Caso>(`${this.base}/casos/${id}/cerrar`, { resultado: resultado ?? null }); }
  reabrirCaso(id: string): Observable<Caso> { return this.http.post<Caso>(`${this.base}/casos/${id}/reabrir`, {}); }
  reordenarCasos(ids: string[]): Observable<Caso[]> { return this.http.put<Caso[]>(`${this.base}/casos/orden`, ids); }
  agregarNota(casoId: string, texto: string): Observable<Nota> { return this.http.post<Nota>(`${this.base}/casos/${casoId}/notas`, { texto }); }

  // ── Superficie pública (sin sesión) ──
  // ── Voz y locución ──
  vozEstado(): Observable<VozEstado> { return this.http.get<VozEstado>(`${this.base}/voz/estado`); }
  vozVoces(refrescar = false): Observable<VozDisponible[]> { return this.http.get<VozDisponible[]>(`${this.base}/voz/voces`, { params: new HttpParams().set('refrescar', refrescar) }); }
  vozModelos(): Observable<VozModelo[]> { return this.http.get<VozModelo[]>(`${this.base}/voz/modelos`); }
  vozAjustes(oficinaId?: string | null): Observable<VozAjustes> {
    const params = oficinaId ? new HttpParams().set('oficinaId', oficinaId) : undefined;
    return this.http.get<VozAjustes>(`${this.base}/voz/ajustes`, { params });
  }
  guardarVozAjustes(in_: VozAjustesIn): Observable<VozAjustes> { return this.http.put<VozAjustes>(`${this.base}/voz/ajustes`, in_); }
  quitarVozAjustes(oficinaId: string): Observable<void> { return this.http.delete<void>(`${this.base}/voz/ajustes/${oficinaId}`); }
  vozProbar(texto: string, vozId?: string | null, modelo?: string | null, oficinaId?: string | null): Observable<VozAudio> {
    return this.http.post<VozAudio>(`${this.base}/voz/probar`, { texto, voz_id: vozId ?? null, modelo: modelo ?? null, oficina_id: oficinaId ?? null });
  }
  vozProbarLlamado(in_: { oficina_id?: string | null; codigo?: string; punto?: string; area?: string | null; nombre?: string | null; tipo_punto?: 'FIJO' | 'MOVIL' }): Observable<VozAudio> {
    return this.http.post<VozAudio>(`${this.base}/voz/probar-llamado`, in_);
  }
  vozBiblioteca(uso?: string | null, q?: string | null, page = 0, size = 40): Observable<Pagina<VozAudio>> {
    let params = new HttpParams().set('page', page).set('size', size);
    if (uso) params = params.set('uso', uso);
    if (q) params = params.set('q', q);
    return this.http.get<Pagina<VozAudio>>(`${this.base}/voz/biblioteca`, { params });
  }
  vozBorrarAudio(id: string): Observable<void> { return this.http.delete<void>(`${this.base}/voz/biblioteca/${id}`); }
  vozFrases(oficinaId?: string | null, vozId?: string | null): Observable<VozFrase[]> {
    let params = new HttpParams();
    if (oficinaId) params = params.set('oficinaId', oficinaId);
    if (vozId) params = params.set('vozId', vozId);
    return this.http.get<VozFrase[]>(`${this.base}/voz/frases`, { params });
  }
  guardarVozFrase(clave: string, oficinaId: string | null, texto: string): Observable<VozFrase> { return this.http.put<VozFrase>(`${this.base}/voz/frases/${clave}`, { oficina_id: oficinaId, texto }); }
  quitarVozFrase(clave: string, oficinaId: string | null): Observable<void> {
    const params = oficinaId ? new HttpParams().set('oficinaId', oficinaId) : undefined;
    return this.http.delete<void>(`${this.base}/voz/frases/${clave}`, { params });
  }
  escucharVozFrase(clave: string, oficinaId: string | null, vozId: string | null): Observable<VozAudio> {
    let params = new HttpParams();
    if (oficinaId) params = params.set('oficinaId', oficinaId);
    if (vozId) params = params.set('vozId', vozId);
    return this.http.post<VozAudio>(`${this.base}/voz/frases/${clave}/escuchar`, {}, { params });
  }
  generarBiblioteca(oficinaId: string | null, vozId: string | null, claves?: string[]): Observable<VozAudio[]> {
    return this.http.post<VozAudio[]>(`${this.base}/voz/biblioteca/generar`, { oficina_id: oficinaId, voz_id: vozId, claves: claves ?? null });
  }
  // ── Avisos en pantalla ──
  avisos(oficinaId?: string | null): Observable<Aviso[]> {
    const params = oficinaId ? new HttpParams().set('oficinaId', oficinaId) : undefined;
    return this.http.get<Aviso[]>(`${this.base}/avisos`, { params });
  }
  crearAviso(in_: AvisoIn): Observable<Aviso> { return this.http.post<Aviso>(`${this.base}/avisos`, in_); }
  actualizarAviso(id: string, in_: AvisoIn): Observable<Aviso> { return this.http.put<Aviso>(`${this.base}/avisos/${id}`, in_); }
  desactivarAviso(id: string): Observable<void> { return this.http.delete<void>(`${this.base}/avisos/${id}`); }
  emitirAviso(id: string): Observable<Aviso> { return this.http.post<Aviso>(`${this.base}/avisos/${id}/emitir`, {}); }
  publicoAvisos(codigo: string): Observable<Aviso[]> { return this.http.get<Aviso[]>(`${this.basePublica}/pantalla/${codigo}/avisos`); }
  vozClonar(nombre: string, descripcion: string | null, archivos: File[]): Observable<{ voz_id: string; nombre: string }> {
    const form = new FormData();
    form.append('nombre', nombre);
    if (descripcion) form.append('descripcion', descripcion);
    for (const a of archivos) form.append('archivos', a);
    return this.http.post<{ voz_id: string; nombre: string }>(`${this.base}/voz/clonar`, form);
  }
  vozMusica(prompt: string, segundos: number, titulo?: string | null): Observable<Media> {
    return this.http.post<Media>(`${this.base}/voz/musica`, { prompt, segundos, titulo: titulo ?? null });
  }
  /** URL absoluta de un audio generado o de un archivo (el televisor no comparte origen con el API). */
  urlAudio(ruta: string | null): string | null { return this.urlMedia({ url: ruta }); }
  urlAudioLlamado(codigoPantalla: string, turnoId: string): string { return `${this.basePublica}/voz/pantalla/${codigoPantalla}/llamado/${turnoId}`; }
  urlArchivoMedia(mediaId: string): string { return `${this.basePublica}/media/${mediaId}/archivo`; }

  // ── Diseñador: vistas y guiones ──
  vistas(oficinaId?: string | null): Observable<Vista[]> {
    const params = oficinaId ? new HttpParams().set('oficinaId', oficinaId) : undefined;
    return this.http.get<Vista[]>(`${this.base}/vistas`, { params });
  }
  crearVista(in_: VistaIn): Observable<Vista> { return this.http.post<Vista>(`${this.base}/vistas`, in_); }
  actualizarVista(id: string, in_: VistaIn): Observable<Vista> { return this.http.put<Vista>(`${this.base}/vistas/${id}`, in_); }
  duplicarVista(id: string): Observable<Vista> { return this.http.post<Vista>(`${this.base}/vistas/${id}/duplicar`, {}); }
  desactivarVista(id: string): Observable<void> { return this.http.delete<void>(`${this.base}/vistas/${id}`); }
  guiones(oficinaId?: string | null): Observable<Guion[]> {
    const params = oficinaId ? new HttpParams().set('oficinaId', oficinaId) : undefined;
    return this.http.get<Guion[]>(`${this.base}/guiones`, { params });
  }
  crearGuion(in_: GuionIn): Observable<Guion> { return this.http.post<Guion>(`${this.base}/guiones`, in_); }
  actualizarGuion(id: string, in_: GuionIn): Observable<Guion> { return this.http.put<Guion>(`${this.base}/guiones/${id}`, in_); }
  desactivarGuion(id: string): Observable<void> { return this.http.delete<void>(`${this.base}/guiones/${id}`); }
  disenoDePantalla(pantallaId: string): Observable<DisenoResuelto> { return this.http.get<DisenoResuelto>(`${this.base}/pantallas/${pantallaId}/diseno`); }

  publicoVistaPantalla(codigo: string): Observable<VistaPantalla> { return this.http.get<VistaPantalla>(`${this.basePublica}/pantalla/${codigo}`); }
  publicoDiseno(codigo: string): Observable<DisenoResuelto> { return this.http.get<DisenoResuelto>(`${this.basePublica}/pantalla/${codigo}/diseno`); }
  publicoPiezas(codigo: string): Observable<Media[]> { return this.http.get<Media[]>(`${this.basePublica}/pantalla/${codigo}/piezas`); }
  publicoLatido(codigo: string): Observable<unknown> { return this.http.post(`${this.basePublica}/pantalla/${codigo}/latido`, {}); }
  publicoEmision(codigo: string, mediaId: string, segundos: number): Observable<unknown> {
    return this.http.post(`${this.basePublica}/pantalla/${codigo}/emision`, { media_id: mediaId, segundos });
  }
  publicoCartel(codigo: string): Observable<CartelImprimible> { return this.http.get<CartelImprimible>(`${this.basePublica}/cartel/${codigo}`); }
  publicoServicios(codigo: string): Observable<Servicio[]> { return this.http.get<Servicio[]>(`${this.basePublica}/cartel/${codigo}/servicios`); }
  publicoTomarTurno(codigo: string, in_: TomarTurnoIn): Observable<Tiquete> { return this.http.post<Tiquete>(`${this.basePublica}/cartel/${codigo}/turno`, in_); }
  publicoSeguimiento(turnoId: string): Observable<Turno> { return this.http.get<Turno>(`${this.basePublica}/turno/${turnoId}`); }
  publicoCancelar(turnoId: string): Observable<Turno> { return this.http.post<Turno>(`${this.basePublica}/turno/${turnoId}/cancelar`, {}); }

  /** URL del canal SSE de una oficina (con sesión) y de una pantalla (sin sesión). */
  urlEventosOficina(oficinaId: string): string { return `${this.base}/eventos/oficina/${oficinaId}`; }
  urlEventosMios(): string { return `${this.base}/eventos/mios`; }
  urlEventosPantalla(codigo: string): string { return `${this.basePublica}/pantalla/${codigo}/eventos`; }
  urlEventosTurno(turnoId: string): string { return `${this.basePublica}/turno/${turnoId}/eventos`; }
}
