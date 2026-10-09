/**
 * Contrato del carrusel del home (ms-marketing, /api/v1/marketing/carrusel y /banners).
 *
 * El backend responde en snake_case escrito a mano y acepta snake_case en las peticiones
 * (@JsonAlias), así que aquí todo va en snake_case: no hay traducción en medio.
 */

export type Orientacion = 'HORIZONTAL' | 'VERTICAL';
export type TipoMedio = 'IMAGEN' | 'VIDEO';
export type Diseno = 'TEXTO_IZQUIERDA' | 'TEXTO_CENTRO' | 'FRANJA_INFERIOR' | 'TARJETA_LATERAL' | 'SOLO_MEDIA';
export type DestinoTipo = 'NINGUNO' | 'DETALLE' | 'RUTA_INTERNA' | 'FORMULARIO' | 'URL_EXTERNA';
export type EstadoBanner = 'BORRADOR' | 'PUBLICADO' | 'PAUSADO' | 'ARCHIVADO';
export type Situacion = 'EN_AIRE' | 'PROGRAMADO' | 'VENCIDO' | EstadoBanner;
export type TipoAudiencia = 'ROL' | 'SEDE' | 'GRUPO' | 'EMPRESA' | 'USUARIO' | 'DOCUMENTO' | 'EVENTO';
export type TipoInteraccion = 'VISTA' | 'CLIC' | 'DESCARTE';

export interface MedioBanner {
  id: string;
  /** Relativa a apiUrl y firmada: va tal cual a un <img> o <video>. */
  url: string;
  tipo: TipoMedio;
  mime: string;
  ancho: number;
  alto: number;
  duracion_ms?: number | null;
  tamano_bytes?: number | null;
}

export interface DestinoBanner {
  tipo: DestinoTipo;
  valor?: string | null;
  nueva_pestana?: boolean;
}

/** Lo que pinta el carrusel. */
export interface BannerItem {
  id: string;
  titulo?: string | null;
  subtitulo?: string | null;
  descripcion?: string | null;
  etiqueta?: string | null;
  cta_texto?: string | null;
  texto_alternativo?: string | null;
  diseno: Diseno;
  color_fondo: string;
  color_texto: string;
  color_acento: string;
  oscurecer: number;
  icono?: string | null;
  tipo_comunicado?: string | null;
  destino: DestinoBanner;
  duracion_segundos: number;
  descartable: boolean;
  horizontal: MedioBanner | null;
  vertical: MedioBanner | null;
  evento?: string | null;
  evento_nombre?: string | null;
}

export interface MetricasBanner {
  vistas: number;
  alcance: number;
  clics: number;
  personas_clic: number;
  descartes: number;
  tasa_clic: number;
}

export interface ReglaAudiencia {
  id?: string;
  tipo: TipoAudiencia;
  valor: string;
  etiqueta?: string | null;
  excluir: boolean;
}

/** Fila de la lista de administración (item + datos de gestión). */
export interface BannerAdmin extends BannerItem {
  nombre_interno: string;
  plantilla_id?: string | null;
  plantilla_nombre?: string | null;
  campana_id?: string | null;
  estado: EstadoBanner;
  situacion: Situacion;
  vigente_desde?: string | null;
  vigente_hasta?: string | null;
  vigente_desde_local?: string | null;
  vigente_hasta_local?: string | null;
  prioridad: number;
  fijado: boolean;
  max_vistas_usuario?: number | null;
  superficies: string[];
  audiencia_resumen: string;
  publicado_en?: string | null;
  actualizado_en?: string | null;
  problemas_para_publicar: string[];
  metricas?: MetricasBanner;
  /** Solo en el detalle: los valores propios (sin heredar de la plantilla). */
  propios?: Partial<BannerPeticion>;
  audiencia?: ReglaAudiencia[];
}

/** Lo que se manda al crear o editar. */
export interface BannerPeticion {
  nombre_interno: string;
  plantilla_id?: string | null;
  campana_id?: string | null;
  titulo?: string | null;
  subtitulo?: string | null;
  descripcion?: string | null;
  etiqueta?: string | null;
  cta_texto?: string | null;
  texto_alternativo?: string | null;
  diseno?: Diseno | null;
  color_fondo?: string | null;
  color_texto?: string | null;
  color_acento?: string | null;
  oscurecer?: number | null;
  destino_tipo: DestinoTipo;
  destino_valor?: string | null;
  destino_etiqueta?: string | null;
  destino_nueva_pestana?: boolean;
  /** Hora de Bogotá, formato de <input type="datetime-local">. */
  vigente_desde?: string | null;
  vigente_hasta?: string | null;
  prioridad: number;
  fijado: boolean;
  duracion_segundos: number;
  descartable: boolean;
  max_vistas_usuario?: number | null;
  superficies: string[];
  audiencia: ReglaAudiencia[];
}

export interface PlantillaBanner {
  id: string;
  codigo: string;
  nombre: string;
  descripcion?: string | null;
  tipo_comunicado: string;
  diseno: Diseno;
  color_fondo: string;
  color_texto: string;
  color_acento: string;
  oscurecer: number;
  icono?: string | null;
  etiqueta_defecto?: string | null;
  cta_defecto?: string | null;
  titulo_ejemplo?: string | null;
  subtitulo_ejemplo?: string | null;
  orden: number;
  sistema: boolean;
  activo: boolean;
}

export interface OpcionCatalogo { valor: string; nombre: string; ayuda: string; }

export interface CatalogoBanners {
  disenos: OpcionCatalogo[];
  destinos: OpcionCatalogo[];
  superficies: OpcionCatalogo[];
  tipos_audiencia: TipoAudiencia[];
  limites: {
    max_imagen_mb: number;
    max_video_mb: number;
    min_proporcion_horizontal: number;
    max_proporcion_vertical: number;
    ideal_horizontal: string;
    ideal_vertical: string;
    formatos: string;
    maximo_en_carrusel: number;
  };
}

export interface EventoTipo {
  codigo: string;
  nombre: string;
  descripcion?: string | null;
  icono?: string | null;
  duracion_dias: number;
  variables?: string | null;
  sistema: boolean;
  activo: boolean;
  vigentes?: number;
}

export interface OcurrenciaEvento {
  id: string;
  evento_codigo: string;
  usuario_id?: string | null;
  documento?: string | null;
  vigente_desde: string;
  vigente_hasta: string;
  vigente_ahora: boolean;
  datos?: string | null;
  origen: 'MANUAL' | 'INTERNO';
  referencia?: string | null;
}

export interface PersonaEvento { usuario_id?: string | null; documento?: string | null; nombre?: string | null; }

export interface ResultadoSimulacion {
  perfil: { audiencia_resuelta: boolean; roles: string[]; sedes: string[]; grupos: string[]; eventos: string[] };
  veria: BannerItem[];
  no_veria: { id: string; nombre_interno: string; motivo: string }[];
}

export interface PuntoSerie { dia: string; vistas: number; alcance: number; clics: number; descartes: number; }
