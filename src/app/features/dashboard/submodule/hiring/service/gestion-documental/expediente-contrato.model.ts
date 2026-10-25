/**
 * Contrato de `GET /gestion_documental/expediente-contrato` (ms-documents) y
 * utilidades puras del expediente por contrato (pedido #14).
 *
 * El "contrato" es el proceso de contratación de ms-hr: `proceso_id` es el id
 * de `tabla_contratacion_ProcesoCandidato` (el mismo que viaja en
 * `entrevistas[i].proceso.id`) y también la llave de la fila de contrato.
 */

/** OK = hay documento · SIN_ASIGNAR = solo uno viejo sin contrato · FALTA = no hay. */
export type EstadoExigido = 'OK' | 'SIN_ASIGNAR' | 'FALTA';

/** PERSONA vale para todos los contratos (cédula, foto, firma…); CONTRATO es de un vínculo. */
export type NivelDocumento = 'PERSONA' | 'CONTRATO';

/** Por qué el documento se considera de este contrato. */
export type AsignacionDocumento = 'PROCESO' | 'CODIGO' | 'UNICO_CONTRATO' | 'PERSONA' | 'SIN_ASIGNAR';

export interface ContratoExpediente {
  proceso_id: number;
  codigo_contrato: string | null;
  fecha_ingreso: string | null;
  fecha_retiro: string | null;
  contrato_activo: boolean | null;
  temporal: string | null;
  empresa_usuaria: string | null;
  oficina: string | null;
  contratado: boolean | null;
  contratado_at: string | null;
  proceso_creado_at: string | null;
  tiene_contrato: boolean;
  seleccionado: boolean;
}

export interface DocumentoExpediente {
  document_id: number;
  version_id: number | null;
  type_id: number | null;
  type_name: string | null;
  nivel: NivelDocumento;
  title: string | null;
  contract_number: string | null;
  proceso_id: number | null;
  file_url: string | null;
  uploaded_at: string | null;
  asignacion: AsignacionDocumento;
  vigente: boolean;
}

export interface ExigidoExpediente {
  type_id: number;
  type_name: string;
  nivel: NivelDocumento;
  estado: EstadoExigido;
  document_id: number | null;
  file_url: string | null;
  uploaded_at: string | null;
  asignacion: AsignacionDocumento | null;
}

export interface ExpedienteContrato {
  cedula: string;
  proceso_id: number | null;
  contract_number: string | null;
  contrato: ContratoExpediente | null;
  contratos: ContratoExpediente[];
  exigidos: ExigidoExpediente[];
  documentos_contrato: DocumentoExpediente[];
  documentos_persona: DocumentoExpediente[];
  sin_asignar: DocumentoExpediente[];
  resumen: {
    exigidos: number;
    ok: number;
    sin_asignar: number;
    faltantes: number;
    documentos_contrato: number;
    documentos_persona: number;
    de_otros_contratos: number;
  };
  avisos: string[];
}

/**
 * `proceso_id` listo para mandar, o null. Nunca manda "undefined", "null", 0
 * ni texto: un proceso mal formado no debe etiquetar un documento.
 */
export function procesoValido(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!/^\d+$/.test(s)) return null;
  return Number(s) > 0 ? String(Number(s)) : null;
}

/** Texto corto de un contrato para chips y encabezados: "726312 · ingreso 2026-08-19". */
export function etiquetaContrato(c: ContratoExpediente | null | undefined): string {
  if (!c) return 'Sin contrato';
  const codigo = (c.codigo_contrato ?? '').trim() || (c.tiene_contrato ? 'Sin código' : 'Proceso sin contrato');
  const partes = [codigo];
  if (c.fecha_ingreso) partes.push(`ingreso ${c.fecha_ingreso}`);
  if (c.fecha_retiro) partes.push(`retiro ${c.fecha_retiro}`);
  return partes.join(' · ');
}

/** Estado de un exigido como chip de la tabla estándar. */
export function tonoEstado(e: EstadoExigido | null | undefined): { texto: string; tono: 'ok' | 'warn' | 'danger' } {
  switch (e) {
    case 'OK': return { texto: 'Entregado', tono: 'ok' };
    case 'SIN_ASIGNAR': return { texto: 'Sin asignar', tono: 'warn' };
    default: return { texto: 'Falta', tono: 'danger' };
  }
}

/** Explicación en palabras de la asignación de un documento. */
export function textoAsignacion(a: AsignacionDocumento | null | undefined): string {
  switch (a) {
    case 'PROCESO': return 'Subido a este contrato';
    case 'CODIGO': return 'Por número de contrato';
    case 'UNICO_CONTRATO': return 'Único contrato de la persona';
    case 'PERSONA': return 'De la persona (vale para todos)';
    case 'SIN_ASIGNAR': return 'Sin contrato asignado';
    default: return '';
  }
}

/** Fecha ISO → 'YYYY-MM-DD' local (sin corrimiento de zona); '' si no hay. */
export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return '';
  const s = String(iso).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (isNaN(d.getTime())) return s.slice(0, 10);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}
