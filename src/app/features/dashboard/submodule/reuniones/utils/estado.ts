import {
  ETAPAS_EN_CURSO, ETAPA_HUMANA, EstadoAnalisis, EstadoGrabacion, EstadoReunion, PASOS_PIPELINE,
  ReunionResumen,
} from '../models/reunion.model';

export type Tono = 'neutro' | 'progreso' | 'ok' | 'aviso' | 'error';

export interface EstadoHumano {
  texto: string;
  tono: Tono;
  icono: string;
}

const ESTADO_REUNION: Record<EstadoReunion, string> = {
  BORRADOR: 'Borrador',
  PROGRAMADA: 'Programada',
  GRABADA: 'Grabada',
  PROCESANDO: 'Procesando',
  EN_REVISION: 'En revisión',
  CERRADA: 'Cerrada',
  ERROR: 'Con error',
};

export function etiquetaEstadoReunion(e: EstadoReunion | string | null | undefined): string {
  return (e && ESTADO_REUNION[e as EstadoReunion]) || (e ?? '');
}

export function enCurso(etapa: EstadoGrabacion | null | undefined): boolean {
  return !!etapa && ETAPAS_EN_CURSO.includes(etapa);
}

/**
 * La grabación se quedó QUIETA en una etapa intermedia con un motivo: el worker no pudo
 * seguir y no va a seguir solo (p. ej. SEGMENTING + "Transcripción no configurada (falta
 * ELEVENLABS_API_KEY)"). No es "procesando": no hay que sondear ni mostrar el avance, sino
 * el motivo. Una etapa en curso sin error sigue siendo trabajo en marcha.
 */
export function detenida(p: { status: EstadoGrabacion | null; stage_error: string | null } | null | undefined): boolean {
  return !!p && enCurso(p.status) && !!p.stage_error?.trim();
}

export function analisisEnCurso(a: EstadoAnalisis | null | undefined): boolean {
  return a === 'PENDIENTE' || a === 'EN_PROCESO';
}

/**
 * En qué va una reunión, dicho para quien la busca en el listado: si ya se puede leer,
 * si se está transcribiendo o si falló. Mezcla el estado de la última grabación, el de la
 * transcripción y el del análisis; el estado administrativo de la reunión queda detrás.
 */
export function estadoReunionHumano(r: ReunionResumen): EstadoHumano {
  const p = r.pipeline_status ?? null;
  const t = r.transcript_status ?? null;
  const a = r.analysis_status ?? null;

  if (!r.recordings_count && !p) {
    return r.status === 'CERRADA'
      ? { texto: 'Cerrada sin grabación', tono: 'neutro', icono: 'lock' }
      : { texto: 'Sin grabación', tono: 'neutro', icono: 'mic_none' };
  }
  if (enCurso(p)) return { texto: `${ETAPA_HUMANA[p!]}…`, tono: 'progreso', icono: 'autorenew' };
  if (p === 'FAILED' && t !== 'LISTA') return { texto: 'No se pudo procesar', tono: 'error', icono: 'error_outline' };

  if (t === 'LISTA' || p === 'COMPLETED' || p === 'PENDING_REVIEW') {
    if (analisisEnCurso(a)) return { texto: 'Resumiendo…', tono: 'progreso', icono: 'autorenew' };
    if (a === 'ERROR') return { texto: 'Transcrita, sin resumen', tono: 'aviso', icono: 'report' };
    if (a === 'LISTA') {
      return r.status === 'CERRADA'
        ? { texto: 'Cerrada', tono: 'ok', icono: 'task_alt' }
        : { texto: 'Transcrita y resumida', tono: 'ok', icono: 'task_alt' };
    }
    return { texto: 'Transcrita', tono: 'ok', icono: 'subject' };
  }
  if (r.status === 'ERROR') return { texto: 'Con error', tono: 'error', icono: 'error_outline' };
  return { texto: etiquetaEstadoReunion(r.status), tono: 'neutro', icono: 'schedule' };
}

/** Paso visible del pipeline (1..N) para la barra de avance del banner. */
export function pasoPipeline(etapa: EstadoGrabacion | null | undefined): { paso: number; total: number; texto: string } {
  const total = PASOS_PIPELINE.length;
  if (!etapa) return { paso: 0, total, texto: '' };
  const i = PASOS_PIPELINE.findIndex(p => p.etapas.includes(etapa));
  const paso = i >= 0 ? i + 1 : (etapa === 'COMPLETED' || etapa === 'PENDING_REVIEW' ? total : 1);
  return { paso, total, texto: ETAPA_HUMANA[etapa] ?? etapa };
}
