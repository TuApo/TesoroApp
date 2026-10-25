import type {
  EventoLineaTiempo, TipoEventoLinea,
} from '../../service/linea-tiempo/linea-tiempo.service';

/**
 * Lógica pura de la línea de tiempo (sin Angular), para poder probarla sola:
 * etiquetas, íconos, días en hora de Bogotá y el filtro por tipo.
 */

export interface TipoLinea {
  tipo: TipoEventoLinea;
  etiqueta: string;
  icono: string;
}

/** Los grupos del filtro, en el orden en que se muestran los chips. */
export const TIPOS_LINEA: readonly TipoLinea[] = [
  { tipo: 'SELECCION', etiqueta: 'Selección', icono: 'how_to_reg' },
  { tipo: 'PRUEBA', etiqueta: 'Prueba técnica', icono: 'engineering' },
  { tipo: 'EXAMEN', etiqueta: 'Examen médico', icono: 'medical_services' },
  { tipo: 'CONTRATO', etiqueta: 'Contrato', icono: 'handshake' },
  { tipo: 'VETO', etiqueta: 'Vetos', icono: 'gpp_bad' },
  { tipo: 'INCAPACIDAD', etiqueta: 'Incapacidades', icono: 'healing' },
  { tipo: 'DATOS', etiqueta: 'Cambios de datos', icono: 'edit_note' },
];

/** Ícono de cada hito. Lo que no esté aquí cae al ícono de su grupo. */
const ICONO_SUBTIPO: Readonly<Record<string, string>> = {
  APERTURA: 'person_add',
  PRE_REGISTRO: 'assignment_ind',
  ENTREVISTA: 'record_voice_over',
  APLICA: 'thumb_up',
  NO_APLICA: 'thumb_down',
  EN_ESPERA: 'hourglass_top',
  DECISION: 'rule',
  AUTORIZACION: 'verified_user',
  REMISION_PRUEBA: 'send',
  PRUEBA_PASO: 'task_alt',
  PRUEBA_NO_PASO: 'cancel',
  PRUEBA_NO_SE_PRESENTO: 'event_busy',
  EXAMEN: 'medical_services',
  EXAMEN_PASO: 'task_alt',
  EXAMEN_NO_PASO: 'cancel',
  EXAMEN_NO_SE_PRESENTO: 'event_busy',
  CONTRATACION: 'handshake',
  INGRESO: 'login',
  RETIRO: 'logout',
  RECHAZO: 'block',
  MODIFICACION_FORZADA: 'warning',
  VETO_REPORTE: 'gpp_bad',
  VETO_REVISION: 'gpp_maybe',
  INCAPACIDAD: 'healing',
  CAMBIO_PROPUESTO: 'edit_note',
  CAMBIO_APROBADO: 'published_with_changes',
  CAMBIO_RECHAZADO: 'unpublished',
  AFILIACION_EDICION: 'manage_accounts',
};

export function iconoDe(e: Pick<EventoLineaTiempo, 'tipo' | 'subtipo'>): string {
  return ICONO_SUBTIPO[e.subtipo]
    ?? TIPOS_LINEA.find((t) => t.tipo === e.tipo)?.icono
    ?? 'radio_button_checked';
}

export function etiquetaTipo(tipo: TipoEventoLinea): string {
  return TIPOS_LINEA.find((t) => t.tipo === tipo)?.etiqueta ?? tipo;
}

const ZONA = 'America/Bogota';
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const YMD = /^(\d{4})-(\d{2})-(\d{2})/;
/** El backend manda las horas ya en Bogotá: con este offset se leen tal cual. */
const EN_BOGOTA = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2})?-05:00$/;

/** `yyyy-MM-dd` de un instante, en hora de Bogotá. */
function ymdEnBogota(d: Date): string {
  // en-CA formatea la fecha como yyyy-MM-dd.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

/** Hoy en Bogotá, `yyyy-MM-dd`. */
export function hoyBogota(ahora: Date = new Date()): string {
  return ymdEnBogota(ahora);
}

/** Día (`yyyy-MM-dd`, Bogotá) al que pertenece un hito; `null` si no trae fecha legible. */
export function diaDe(e: Pick<EventoLineaTiempo, 'fecha' | 'solo_fecha'>): string | null {
  const f = (e.fecha ?? '').trim();
  if (!f) return null;
  // Un día sin hora NO pasa por Date: sería medianoche UTC, o sea el día anterior en Bogotá.
  if (e.solo_fecha) return YMD.test(f) ? f.slice(0, 10) : null;
  const b = EN_BOGOTA.exec(f);
  if (b) return b[1];
  const d = new Date(f);
  return isNaN(d.getTime()) ? null : ymdEnBogota(d);
}

/** Hora del hito ("10:30 a. m."), o `null` si es un día sin hora. */
export function horaDe(e: Pick<EventoLineaTiempo, 'fecha' | 'solo_fecha'>): string | null {
  const f = (e.fecha ?? '').trim();
  if (!f || e.solo_fecha) return null;
  let h: number;
  let m: string;
  const b = EN_BOGOTA.exec(f);
  if (b) {
    h = Number(b[2]);
    m = b[3];
  } else {
    const d = new Date(f);
    if (isNaN(d.getTime())) return null;
    const partes = new Intl.DateTimeFormat('en-GB', {
      timeZone: ZONA, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d).split(':');
    h = Number(partes[0]) % 24;
    m = partes[1] ?? '00';
  }
  return `${h % 12 || 12}:${m} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}

function desplazar(ymd: string, dias: number): string {
  const [y, mo, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d + dias));
  return t.toISOString().slice(0, 10);
}

/** "Hoy", "Ayer", "Mañana" o "lunes 22 sep 2026". */
export function etiquetaDia(dia: string, hoy: string): string {
  if (dia === hoy) return 'Hoy';
  if (dia === desplazar(hoy, -1)) return 'Ayer';
  if (dia === desplazar(hoy, 1)) return 'Mañana';
  const m = YMD.exec(dia);
  if (!m) return dia;
  const y = Number(m[1]);
  const mes = Number(m[2]);
  const d = Number(m[3]);
  const semana = DIAS[new Date(Date.UTC(y, mes - 1, d)).getUTCDay()];
  return `${semana} ${d} ${MESES[mes - 1]} ${y}`;
}

/** Un día posterior a hoy: ingreso programado, incapacidad que aún no empieza… */
export function esFuturo(dia: string | null, hoy: string): boolean {
  return !!dia && dia > hoy;
}

export interface GrupoDia {
  /** `yyyy-MM-dd` o `'sin-fecha'`. */
  dia: string;
  etiqueta: string;
  futuro: boolean;
  eventos: EventoLineaTiempo[];
}

/**
 * Agrupa por día SIN reordenar: el orden lo decide el servidor (más reciente
 * primero, y en empate la etapa posterior). Solo se juntan hitos contiguos
 * del mismo día.
 */
export function agruparPorDia(eventos: readonly EventoLineaTiempo[], hoy: string): GrupoDia[] {
  const grupos: GrupoDia[] = [];
  for (const e of eventos) {
    const dia = diaDe(e) ?? 'sin-fecha';
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.dia === dia) {
      ultimo.eventos.push(e);
    } else {
      grupos.push({
        dia,
        etiqueta: dia === 'sin-fecha' ? 'Sin fecha' : etiquetaDia(dia, hoy),
        futuro: dia !== 'sin-fecha' && esFuturo(dia, hoy),
        eventos: [e],
      });
    }
  }
  return grupos;
}

/**
 * Prende o apaga un tipo del filtro. Devuelve los tipos en el orden de los
 * chips; `[]` significa "todos" (también cuando quedan todos prendidos).
 */
export function alternarTipo(
  activos: readonly TipoEventoLinea[], tipo: TipoEventoLinea,
): TipoEventoLinea[] {
  const set = new Set(activos);
  if (set.has(tipo)) set.delete(tipo); else set.add(tipo);
  const orden = TIPOS_LINEA.map((t) => t.tipo).filter((t) => set.has(t));
  return orden.length === TIPOS_LINEA.length ? [] : orden;
}
