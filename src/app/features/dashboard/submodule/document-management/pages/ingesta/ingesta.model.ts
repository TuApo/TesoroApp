/**
 * Modelo de la mesa de ingesta documental.
 *
 * Una sola vista para los cuatro orígenes (archivos, escáner, ZIP y PDF único
 * repartido en paquetes): todos producen FICHAS, y una ficha es "un documento
 * que voy a registrar a nombre de alguien". Lo que cambia entre orígenes es de
 * dónde sale el binario, no lo que hay que decidir sobre él.
 */

/** De dónde entró el archivo. Solo afecta a la trazabilidad y al icono. */
export type OrigenIngesta = 'archivos' | 'escaner' | 'zip' | 'paquete';

/**
 * Estado de una ficha ANTES de registrar (los tres últimos son de después).
 *
 * El orden importa: `estadoDeFicha` devuelve el primero que aplique, y los
 * bloqueantes van antes que los informativos. Un archivo sin tipo no se puede
 * registrar aunque además reemplace a otro.
 */
export type EstadoFicha =
  | 'sin_persona'   // no hay cédula, o la cédula no está en contratación
  | 'sin_tipo'      // falta el tipo documental
  | 'duplicado'     // mismo archivo (nombre y tamaño) ya está en el expediente
  | 'reemplaza'     // ya hay un vigente de ese tipo: este pasa a ser el último
  | 'listo'         // nuevo, no pisa nada
  | 'omitido'       // el usuario lo sacó de la tanda
  | 'subiendo'
  | 'registrado'
  | 'error';

/** Un dato suelto que la lectura automática sacó del texto del PDF. */
export interface DatoLeido {
  etiqueta: string;
  valor: string;
}

/**
 * Lo que se pudo leer del archivo sin preguntarle a nadie.
 *
 * `requiereOcr` es la pieza importante para el usuario: un PDF escaneado no
 * tiene capa de texto, así que aquí no se puede resumir y el contenido solo
 * aparecerá cuando el ocr-worker lo procese. Decirlo por adelantado evita la
 * pregunta "¿por qué no me sale el resumen?".
 */
export interface LecturaAutomatica {
  /** Texto de las primeras páginas. Vacío en un escaneado. */
  texto: string;
  paginas: number | null;
  esFactura: boolean;
  /** Tres o cuatro frases, sacadas del propio texto (no inventadas). */
  resumen: string[];
  datos: DatoLeido[];
  requiereOcr: boolean;
  /** Cédulas encontradas dentro del texto; sirven para proponer destinatario. */
  cedulasDetectadas: string[];
}

/** Tipo documental propuesto automáticamente, con el porqué a la vista. */
export interface SugerenciaTipo {
  typeId: number;
  typeName: string;
  /** 0–1. Por debajo de 0,5 la UI la muestra pero no la aplica sola. */
  confianza: number;
  porque: string;
}

/** Un documento que YA está en el expediente de la persona. */
export interface DocumentoExistente {
  documentId: number;
  typeId: number | null;
  typeName: string;
  titulo: string;
  subidoEn: string | null;
  fileUrl: string | null;
  vigente: boolean;
  contrato: string | null;
}

/** Un contrato de la persona, tal como lo devuelve expediente-contrato. */
export interface ContratoPersona {
  procesoId: number | null;
  codigoContrato: string | null;
  fechaIngreso: string | null;
  fechaRetiro: string | null;
  activo: boolean | null;
  empresaUsuaria: string | null;
  oficina: string | null;
  contratado: boolean | null;
}

/**
 * Todo lo que sabemos de la persona destinataria.
 *
 * `existe` es false cuando contratación no la conoce: en ese caso NO se bloquea
 * la carga a ciegas, se avisa. Hay documentos legítimos de gente que todavía no
 * tiene proceso (un postulado que manda papeles antes de la entrevista), y
 * bloquearlos dejaría el documento sin ningún sitio donde quedar.
 */
export interface ContextoPersona {
  cedula: string;
  existe: boolean;
  nombre: string;
  finca: string;
  fechaIngreso: string;
  contratos: ContratoPersona[];
  documentos: DocumentoExistente[];
  faltantes: string[];
  /** Mensaje corto para la UI cuando algo no cuadra. */
  aviso: string;
  cargando: boolean;
}

/** Una ficha: un archivo con todo lo que hay que decidir sobre él. */
export interface FichaIngesta {
  id: string;
  file: File;
  nombre: string;
  tamano: number;
  origen: OrigenIngesta;
  /** Ruta dentro del ZIP o rango de páginas del PDF repartido. */
  procedencia: string;

  cedula: string;
  typeId: number | null;
  contrato: string;
  titulo: string;

  estado: EstadoFicha;
  motivo: string;

  sugerencia: SugerenciaTipo | null;
  lectura: LecturaAutomatica | null;
  /** Vigente del mismo tipo que este archivo va a desplazar, si lo hay. */
  reemplazaA: DocumentoExistente | null;

  /** Resultado del registro. */
  documentId: number | null;
  enColaIa: boolean;
  enColaOffline: boolean;
}

/** Una línea del acta: lo que quedó registrado, para copiar o archivar. */
export interface LineaActa {
  nombre: string;
  cedula: string;
  persona: string;
  tipo: string;
  contrato: string;
  documentId: number | null;
  resultado: 'registrado' | 'reemplazo' | 'error' | 'cola';
  detalle: string;
}
