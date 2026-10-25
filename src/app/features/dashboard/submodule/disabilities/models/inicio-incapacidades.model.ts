/**
 * Contrato de `GET /Incapacidades/v2/inicio` (ms-hr, 2026-10-23). Claves camelCase FIJADAS en el
 * backend con @JsonProperty (igual que los informes): ms-hr corre Jackson en snake_case global.
 */

/** Una barra/porcion: clave tecnica (enum o texto), etiqueta legible, cantidad y dias. */
export interface SerieInicio {
  clave: string;
  etiqueta: string;
  cantidad: number;
  dias: number;
}

export interface MesInicio {
  anio: number;
  mes: number;
  /** "Oct 2026" */
  etiqueta: string;
  cantidad: number;
  dias: number;
}

export interface DiagnosticoInicio {
  codigo: string;
  descripcion: string | null;
  cantidad: number;
  dias: number;
}

export interface AlcanceInicio {
  /** true si el servidor recorto los datos (coordinador / SALUD-ALCANCE-*). */
  restringido: boolean;
  /** "la oficina SUBA", "Andes y Monteverde" o "toda la empresa". */
  etiqueta: string;
  /** "Viendo: la oficina SUBA" */
  texto: string;
}

export interface KpisInicio {
  total: number;
  dias: number;
  personas: number;
  /** fecha_inicio <= hoy <= fecha_fin (no depende del periodo). */
  activasHoy: number;
  mesActual: MesInicio;
  mesAnterior: MesInicio;
  /** % de cambio del mes en curso frente al anterior; null si el anterior fue 0. */
  variacionMesPct: number | null;
  prorrogas: number;
  sinSoporte: number;
  diasEmpresa: number;
  diasEntidad: number;
  porEstado: SerieInicio[];
  porEstadoDocumento: SerieInicio[];
}

export interface SeriesInicio {
  /** 12 meses que terminan en el mes de `hasta`, con ceros. */
  porMes: MesInicio[];
  porTipo: SerieInicio[];
  porTemporal: SerieInicio[];
  porOficina: SerieInicio[];
  porEmpresa: SerieInicio[];
  porCentroCosto: SerieInicio[];
  porEps: SerieInicio[];
  diagnosticos: DiagnosticoInicio[];
  /** EMPRESA vs ENTIDAD (cantidad = dias). */
  diasCargo: SerieInicio[];
  /** EPS vs ARL (entidad_responsable). */
  porEntidad: SerieInicio[];
}

export interface InicioIncapacidades {
  desde: string;
  hasta: string;
  hoy: string;
  alcance: AlcanceInicio;
  temporal: string | null;
  oficina: string | null;
  kpis: KpisInicio;
  series: SeriesInicio;
  opciones: { temporales: string[]; oficinas: string[] };
}

export interface FiltrosInicioIncapacidades {
  desde?: string;
  hasta?: string;
  temporal?: string;
  oficina?: string;
}
