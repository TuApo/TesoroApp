/**
 * Motor de exportacion de la consulta de incapacidades.
 *
 * Aqui vive TODA la logica pura (que columnas existen, como se saca el valor de
 * cada una, como se arma el CSV). El dialogo solo orquesta: pide las paginas al
 * backend, muestra el progreso y dispara la descarga.
 *
 * Separarlo asi permite probar "la exportacion respeta la seleccion de columnas"
 * sin montar ningun componente ni ningun navegador.
 *
 * REGLA HEREDADA DEL MODULO VIEJO (y que aqui NO se repite): el export anterior
 * decia "exportar todo" pero mandaba unicamente la pagina que estaba cargada en
 * memoria. Por eso el alcance es una decision explicita del usuario y el modo
 * "todos los resultados" recorre de verdad todas las paginas del backend.
 */

import { EstadoDocumento, EstadoIncapacidad, ResponsablePago, TipoIncapacidad } from '../../models/incapacidad-v2.model';
import { parsearFechaFlexible } from '../../utils/fechas';
import { codigoSinGuion } from '../../utils/codigos';
import { IncapacidadResumenExtendido, humanizarCodigo } from './consulta-incapacidades.model';

/** Resolutores de etiqueta (vienen del catalogo del backend). */
export interface EtiquetasExportacion {
  tipoIncapacidad: (codigo: TipoIncapacidad | string | null | undefined) => string;
  estado: (codigo: EstadoIncapacidad | string | null | undefined) => string;
  estadoDocumento: (codigo: EstadoDocumento | string | null | undefined) => string;
  responsablePago: (codigo: ResponsablePago | string | null | undefined) => string;
}

/** Respaldo: humaniza el codigo. Se usa en pruebas y si el catalogo no cargo. */
export const ETIQUETAS_HUMANIZADAS: EtiquetasExportacion = {
  tipoIncapacidad: humanizarCodigo,
  estado: humanizarCodigo,
  estadoDocumento: humanizarCodigo,
  responsablePago: humanizarCodigo,
};

/** Una columna que el usuario puede marcar/desmarcar en el dialogo. */
export interface ColumnaExportable {
  /** Clave estable (coincide con el `name` de la columna de la tabla cuando existe). */
  clave: string;
  /** Cabecera que aparecera en el Excel/CSV. */
  etiqueta: string;
  /** `true` si por defecto se muestra en la tabla (opcion "las visibles"). */
  enTabla: boolean;
  /**
   * `true` si la columna pertenece al CONSOLIDADO oficial de 42 columnas que dicto la
   * funcional (reunion 2026-08-20). Esas son las marcadas por defecto al abrir el dialogo.
   */
  enConsolidado?: boolean;
  /** Extrae el valor ya formateado para el archivo. */
  obtener: (fila: IncapacidadResumenExtendido, etiquetas: EtiquetasExportacion) => string | number;
}

/** Formatea `yyyy-MM-dd` (o los formatos sucios reales) a `dd/MM/yyyy`. */
export function fechaLegible(valor: unknown): string {
  const fecha = parsearFechaFlexible(valor);
  if (!fecha) return '';
  const dia = String(fecha.getDate()).padStart(2, '0');
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}/${fecha.getFullYear()}`;
}

/**
 * Fecha CON hora para los campos de auditoria (`creadoEn` llega ISO 8601).
 * No usa `toISOString()` (en UTC-5 restaria un dia).
 */
export function fechaHoraLegible(valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return '';
  const texto = String(valor);
  const fecha = new Date(texto);
  if (isNaN(fecha.getTime())) return fechaLegible(valor);
  const dia = String(fecha.getDate()).padStart(2, '0');
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const hora = String(fecha.getHours()).padStart(2, '0');
  const min = String(fecha.getMinutes()).padStart(2, '0');
  return `${dia}/${mes}/${fecha.getFullYear()} ${hora}:${min}`;
}

/** Texto o cadena vacia (nunca "null" ni "undefined" en el archivo). */
function texto(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  return String(valor).trim();
}

/** Numero o cadena vacia (para que Excel no meta ceros inventados). */
function numero(valor: unknown): string | number {
  if (valor === null || valor === undefined || valor === '') return '';
  const n = typeof valor === 'number' ? valor : Number(valor);
  return isNaN(n) ? '' : n;
}

/** Indicador "n/m" de soportes; vacio si el backend aun no lo envia. */
export function indicadorSoportes(fila: IncapacidadResumenExtendido): string {
  const cargados = fila.soportesAdjuntos;
  const exigidos = fila.soportesExigidos;
  if (cargados === null || cargados === undefined) return '';
  if (exigidos === null || exigidos === undefined) return String(cargados);
  return `${cargados}/${exigidos}`;
}

/** `true` si la fila tiene todos sus soportes; `null` si no se puede saber. */
export function soportesCompletos(fila: IncapacidadResumenExtendido): boolean | null {
  if (fila.soportesCompletos === true || fila.soportesCompletos === false) {
    return fila.soportesCompletos;
  }
  const cargados = fila.soportesAdjuntos;
  const exigidos = fila.soportesExigidos;
  if (typeof cargados !== 'number' || typeof exigidos !== 'number') return null;
  return cargados >= exigidos;
}

/** SI/NO para el archivo (mismo formato que el Excel del servidor); vacio si no hay dato. */
function siNo(valor: boolean | null | undefined): string {
  return valor === true ? 'SI' : valor === false ? 'NO' : '';
}

/**
 * Catalogo completo de columnas exportables.
 * El orden de este array es el orden de las columnas del archivo.
 *
 * Las 42 primeras (marcadas `enConsolidado`) son EXACTAMENTE el consolidado oficial que
 * dicto la funcional en la reunion del 2026-08-20, en su orden. El Excel consolidado del
 * SERVIDOR (ExportJobService de ms-hr) usa estas mismas cabeceras: si se toca aqui, tocar
 * tambien alla.
 */
export const COLUMNAS_EXPORTABLES: readonly ColumnaExportable[] = [
  {
    clave: 'semanaRadicacion',
    etiqueta: 'Semana',
    enTabla: true,
    enConsolidado: true,
    obtener: (f) => numero(f.semanaRadicacion),
  },
  {
    clave: 'oficina',
    etiqueta: 'Lugar radicado',
    enTabla: false,
    enConsolidado: true,
    obtener: (f) => texto(f.oficina),
  },
  {
    clave: 'consecutivoSistema',
    etiqueta: 'Codigo unico',
    enTabla: true,
    enConsolidado: true,
    // V47: manda el codigo visible de cartera (TASB018); historicas caen al tecnico,
    // que desde la reunion 2026-08-26 sale SIN guion bajo (igual que el consolidado
    // del servidor: ExportJobService.sinGuionBajo).
    obtener: (f) => texto(codigoSinGuion(f.codigoConsecutivo ?? f.consecutivoSistema ?? f.codigoUnico)),
  },
  {
    clave: 'codigoSede',
    etiqueta: 'Codigo sede',
    enTabla: false,
    enConsolidado: true,
    obtener: (f) => texto(f.codigoSede),
  },
  {
    clave: 'numeroContrato',
    etiqueta: 'Numero contrato',
    enTabla: false,
    enConsolidado: true,
    obtener: (f) => texto(f.numeroContrato),
  },
  {
    clave: 'entidadGrupo',
    etiqueta: 'Empleador',
    enTabla: true,
    enConsolidado: true,
    obtener: (f) => texto(f.entidadGrupoEtiqueta ?? f.entidadGrupo),
  },
  {
    clave: 'creadoEn',
    etiqueta: 'Fecha registro',
    enTabla: true,
    enConsolidado: true,
    obtener: (f) => fechaHoraLegible(f.creadoEn),
  },
  {
    clave: 'tipoDocumento',
    etiqueta: 'Tipo documento',
    enTabla: false,
    enConsolidado: true,
    obtener: (f) => texto(f.tipoDocumento),
  },
  {
    clave: 'cedula',
    etiqueta: 'Cedula',
    enTabla: true,
    enConsolidado: true,
    obtener: (f) => texto(f.cedula),
  },
  {
    clave: 'nombreCompleto',
    etiqueta: 'Nombre completo',
    enTabla: true,
    enConsolidado: true,
    obtener: (f) => texto(f.nombreCompleto),
  },
  {
    clave: 'empresa',
    etiqueta: 'Empresa / Finca',
    enTabla: true,
    enConsolidado: true,
    obtener: (f) => texto(f.empresa),
  },
  {
    clave: 'tipoIncapacidad',
    etiqueta: 'Tipo de incapacidad',
    enTabla: true,
    enConsolidado: true,
    obtener: (f, e) => e.tipoIncapacidad(f.tipoIncapacidad),
  },
  {
    clave: 'codigoDiagnostico',
    etiqueta: 'Codigo diagnostico',
    enTabla: false,
    enConsolidado: true,
    obtener: (f) => texto(f.codigoDiagnostico),
  },
  {
    clave: 'descripcionDiagnostico',
    etiqueta: 'Descripcion diagnostico',
    enTabla: false,
    enConsolidado: true,
    obtener: (f) => texto(f.descripcionDiagnostico),
  },
  {
    clave: 'fechaInicio',
    etiqueta: 'Fecha inicio',
    enTabla: true,
    enConsolidado: true,
    obtener: (f) => fechaLegible(f.fechaInicio),
  },
  {
    clave: 'fechaFin',
    etiqueta: 'Fecha fin',
    enTabla: true,
    enConsolidado: true,
    obtener: (f) => fechaLegible(f.fechaFin),
  },
  {
    clave: 'dias',
    etiqueta: 'Dias',
    enTabla: true,
    enConsolidado: true,
    obtener: (f) => numero(f.dias),
  },
  {
    clave: 'edad',
    etiqueta: 'Edad',
    enTabla: false,
    enConsolidado: true,
    obtener: (f) => numero(f.edad),
  },
  {
    clave: 'sexo',
    etiqueta: 'Genero',
    enTabla: false,
    enConsolidado: true,
    obtener: (f) => texto(f.sexo),
  },
  {
    clave: 'fechaIngreso',
    etiqueta: 'Fecha de ingreso',
    enTabla: false,
    enConsolidado: true,
    obtener: (f) => fechaLegible(f.fechaIngreso),
  },
  {
    clave: 'celular',
    etiqueta: 'Telefono',
    enTabla: false,
    enConsolidado: true,
    obtener: (f) => texto(f.celular),
  },
  {
    clave: 'correo',
    etiqueta: 'Correo electronico',
    enTabla: false,
    enConsolidado: true,
    obtener: (f) => texto(f.correo),
  },
  {
    clave: 'eps',
    etiqueta: 'EPS',
    enTabla: true,
    enConsolidado: true,
    obtener: (f) => texto(f.eps),
  },
  {
    clave: 'estadoDocumento',
    etiqueta: 'Estado documento',
    enTabla: true,
    enConsolidado: true,
    obtener: (f, e) => e.estadoDocumento(f.estadoDocumento),
  },
  {
    clave: 'esProrroga',
    etiqueta: 'Prorroga',
    enTabla: false,
    enConsolidado: true,
    obtener: (f) => siNo(f.esProrroga),
  },
  {
    clave: 'transcrita',
    etiqueta: 'Transcrita',
    enTabla: false,
    enConsolidado: true,
    obtener: (f) => siNo(f.transcrita),
  },
  {
    clave: 'numeroIncapacidad',
    etiqueta: 'Numero incapacidad',
    enTabla: false,
    enConsolidado: true,
    obtener: (f) => texto(f.numeroIncapacidad),
  },
  {
    clave: 'ipsNombre',
    etiqueta: 'Nombre IPS',
    enTabla: false,
    enConsolidado: true,
    obtener: (f) => texto(f.ipsNombre),
  },
  {
    clave: 'recibidoPor',
    etiqueta: 'Usuario que radica',
    enTabla: false,
    enConsolidado: true,
    obtener: (f) => texto(f.recibidoPor ?? f.creadoPor),
  },
  {
    clave: 'centroCosto',
    etiqueta: 'Centro de costo',
    enTabla: true,
    enConsolidado: true,
    obtener: (f) => texto(f.centroCosto),
  },
  {
    clave: 'afp',
    etiqueta: 'AFP',
    enTabla: false,
    enConsolidado: true,
    obtener: (f) => texto(f.afp),
  },
  {
    clave: 'estado',
    etiqueta: 'Estado',
    enTabla: true,
    enConsolidado: true,
    obtener: (f, e) => e.estado(f.estado),
  },
  {
    clave: 'responsablePago',
    etiqueta: 'Responsable de pago',
    enTabla: true,
    enConsolidado: true,
    obtener: (f, e) => e.responsablePago(f.responsablePago),
  },
  {
    clave: 'diasEmpresa',
    etiqueta: 'Dias empresa',
    enTabla: true,
    enConsolidado: true,
    obtener: (f) => numero(f.diasEmpresa),
  },
  {
    clave: 'diasEntidad',
    etiqueta: 'Dias entidad',
    enTabla: true,
    enConsolidado: true,
    obtener: (f) => numero(f.diasEntidad),
  },
  {
    clave: 'tieneTraslape',
    etiqueta: 'Traslape',
    enTabla: false,
    enConsolidado: true,
    obtener: (f) => siNo(f.tieneTraslape),
  },
  {
    clave: 'estaPrescrita',
    etiqueta: 'Prescrita',
    enTabla: false,
    enConsolidado: true,
    obtener: (f) => siNo(f.estaPrescrita),
  },
  {
    clave: 'tieneSoportes',
    etiqueta: 'Tiene soportes',
    enTabla: false,
    enConsolidado: true,
    obtener: (f) =>
      siNo(
        f.tieneSoportes ??
          (typeof f.soportesAdjuntos === 'number' ? f.soportesAdjuntos > 0 : null),
      ),
  },
  {
    clave: 'fechaRadicado',
    etiqueta: 'Fecha radicado',
    enTabla: true,
    enConsolidado: true,
    obtener: (f) => fechaLegible(f.fechaRadicado),
  },
  {
    clave: 'numeroRadicado',
    etiqueta: 'Numero radicado',
    enTabla: true,
    enConsolidado: true,
    obtener: (f) => texto(f.numeroRadicado),
  },
  {
    clave: 'dondeRadicado',
    etiqueta: 'Donde se radico',
    enTabla: true,
    enConsolidado: true,
    obtener: (f) => texto(f.dondeRadicadoEtiqueta ?? f.dondeRadicado),
  },
  {
    clave: 'radicadoPor',
    etiqueta: 'Radicado por',
    enTabla: true,
    enConsolidado: true,
    obtener: (f) => texto(f.radicadoPor),
  },
  // ── Extras fuera del consolidado oficial (se marcan a mano si se quieren) ──
  { clave: 'temporal', etiqueta: 'Temporal', enTabla: false, obtener: (f) => texto(f.temporal) },
  {
    clave: 'soportes',
    etiqueta: 'Soportes (n/m)',
    enTabla: true,
    obtener: (f) => indicadorSoportes(f),
  },
  {
    clave: 'creadoPor',
    etiqueta: 'Registrado por',
    enTabla: true,
    obtener: (f) => texto(f.creadoPor),
  },
  {
    clave: 'actualizadoEn',
    etiqueta: 'Ultima modificacion',
    enTabla: false,
    obtener: (f) => fechaHoraLegible(f.actualizadoEn),
  },
  { clave: 'id', etiqueta: 'Id interno', enTabla: false, obtener: (f) => numero(f.id) },
];

/**
 * Claves marcadas por defecto al abrir el dialogo: el consolidado oficial COMPLETO
 * (reunion 2026-08-20), no solo lo visible en la tabla.
 */
export const CLAVES_EXPORTACION_POR_DEFECTO: readonly string[] = COLUMNAS_EXPORTABLES.filter(
  (c) => c.enConsolidado,
).map((c) => c.clave);

/** Busca una columna por su clave. */
export function columnaExportable(clave: string): ColumnaExportable | undefined {
  return COLUMNAS_EXPORTABLES.find((c) => c.clave === clave);
}

/**
 * Convierte las filas del backend en filas de archivo, **respetando el orden y
 * la seleccion de columnas** que hizo el usuario.
 *
 * Las claves de cada objeto resultante son las ETIQUETAS (cabeceras), porque es
 * lo que `XLSX.utils.json_to_sheet` usa como fila de encabezado.
 *
 * @param filas datos crudos del backend.
 * @param claves claves seleccionadas; las desconocidas se ignoran en silencio.
 * @param etiquetas resolutores de etiqueta de los enums.
 */
export function construirFilasExportacion(
  filas: readonly IncapacidadResumenExtendido[],
  claves: readonly string[],
  etiquetas: EtiquetasExportacion = ETIQUETAS_HUMANIZADAS,
): Record<string, string | number>[] {
  const columnas = clavesAColumnas(claves);

  return (filas ?? []).map((fila) => {
    const salida: Record<string, string | number> = {};
    for (const columna of columnas) {
      salida[columna.etiqueta] = columna.obtener(fila, etiquetas);
    }
    return salida;
  });
}

/**
 * Traduce claves a columnas conservando el ORDEN CANONICO de
 * {@link COLUMNAS_EXPORTABLES} (no el orden en que el usuario las marco).
 */
export function clavesAColumnas(claves: readonly string[]): ColumnaExportable[] {
  const seleccionadas = new Set(claves ?? []);
  return COLUMNAS_EXPORTABLES.filter((c) => seleccionadas.has(c.clave));
}

/** Cabeceras (en orden) de una seleccion de claves. */
export function cabecerasExportacion(claves: readonly string[]): string[] {
  return clavesAColumnas(claves).map((c) => c.etiqueta);
}

/** Escapa un campo para CSV (comillas dobles, separador o salto de linea). */
function escaparCsv(valor: string | number, separador: string): string {
  const texto0 = valor === null || valor === undefined ? '' : String(valor);
  const necesitaComillas =
    texto0.includes(separador) ||
    texto0.includes('"') ||
    texto0.includes('\n') ||
    texto0.includes('\r');
  if (!necesitaComillas) return texto0;
  return `"${texto0.replace(/"/g, '""')}"`;
}

/**
 * Arma el CSV completo (cabecera + filas).
 *
 * Separador `;` por defecto: es lo que espera Excel en configuracion regional
 * es-CO; con `,` abriria todo en una sola columna.
 */
export function construirCsv(
  filas: readonly Record<string, string | number>[],
  cabeceras: readonly string[],
  separador = ';',
): string {
  const lineas: string[] = [];
  lineas.push(cabeceras.map((c) => escaparCsv(c, separador)).join(separador));

  for (const fila of filas) {
    lineas.push(
      cabeceras
        .map((cabecera) => escaparCsv(fila[cabecera] ?? '', separador))
        .join(separador),
    );
  }

  return lineas.join('\r\n');
}

/** Nombre de archivo con marca de tiempo local (nunca `toISOString`). */
export function nombreArchivoExportacion(extension: 'xlsx' | 'csv', ahora = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const marca =
    `${ahora.getFullYear()}${p(ahora.getMonth() + 1)}${p(ahora.getDate())}` +
    `_${p(ahora.getHours())}${p(ahora.getMinutes())}`;
  return `incapacidades_${marca}.${extension}`;
}

/** Anchos de columna razonables para el Excel (en caracteres). */
export function anchosColumnas(claves: readonly string[]): { wch: number }[] {
  return clavesAColumnas(claves).map((c) => ({
    wch: Math.min(38, Math.max(12, c.etiqueta.length + 4)),
  }));
}
