import {
  Acuerdo, HablanteInsight, InsightsReunion, Participante, SegmentoTranscripcion, TIPO_ACUERDO_LABEL,
} from '../models/reunion.model';
import { duracionHumana, fechaCorta, fechaLocalIso, porcentaje, reloj } from './tiempo';
import { normalizar } from './texto';
import { agruparTurnos } from './turnos';
import { ordenarHablantes } from './hablantes';

export interface DatosActa {
  reunion: { code: string; name: string; held_on: string | null; objective?: string | null };
  insights: InsightsReunion;
  segmentos: SegmentoTranscripcion[];
  participantes?: Participante[];
  /** Para pruebas deterministas; por defecto, ahora. */
  generadoEn?: Date;
}

/** Nombre de quien dijo un segmento, con el mismo criterio en toda la vista. */
export function nombreDeSegmento(s: SegmentoTranscripcion, hablantes: Map<string, HablanteInsight>): string {
  const h = s.speaker_id ? hablantes.get(s.speaker_id) : undefined;
  return h?.display_name || s.speaker_name || s.speaker_label || 'Sin identificar';
}

/** Responsable de un acuerdo: nombre resuelto por el backend, hablante, participante o texto libre. */
export function responsableDe(
  a: Acuerdo, hablantes: Map<string, HablanteInsight>, participantes: Participante[] = [],
): string | null {
  if (a.owner_name) return a.owner_name;
  if (a.owner_speaker_id) {
    const h = hablantes.get(a.owner_speaker_id);
    if (h) return h.display_name;
  }
  if (a.owner_participant_id) {
    const p = participantes.find(x => x.id === a.owner_participant_id);
    if (p) return p.display_name;
  }
  return a.owner_text || null;
}

/**
 * Acta de la reunión en Markdown, generada en el navegador: resumen, temas, acuerdos por
 * persona y la transcripción completa con nombres y minutos. Pura: los mismos datos dan
 * el mismo texto (salvo la fecha de generación, que entra por parámetro).
 */
export function generarActaMarkdown(d: DatosActa): string {
  const { reunion, insights } = d;
  const participantes = d.participantes ?? [];
  const hablantes = new Map(insights.speakers.map(h => [h.id, h]));
  const orden = ordenarHablantes(insights.speakers);
  const duracion = insights.duration_ms
    ?? d.segmentos.reduce((m, s) => Math.max(m, s.end_ms), 0);
  const acuerdos = insights.items.filter(i => i.status !== 'DESCARTADO');
  const lineas: string[] = [];
  const l = (...xs: string[]) => lineas.push(...xs);

  l(`# Acta de reunión: ${reunion.name}`, '');
  l(`- **Código:** ${reunion.code}`);
  if (reunion.held_on) l(`- **Fecha:** ${fechaCorta(reunion.held_on)}`);
  if (duracion) l(`- **Duración:** ${duracionHumana(duracion)}`);
  if (orden.length) l(`- **Personas que hablaron:** ${orden.length}`);
  if (reunion.objective?.trim()) l(`- **Objetivo:** ${unaLinea(reunion.objective)}`);
  l('');

  if (orden.length) {
    l('## Quiénes hablaron', '');
    for (const h of orden) {
      const rol = h.suggested_role && !h.participant_id ? ` (${h.suggested_role})` : '';
      l(`- **${h.display_name}**${rol}: ${duracionHumana(h.talk_ms)}, ${porcentaje(h.talk_pct)} del tiempo`);
    }
    l('');
  }

  l('## Resumen', '');
  const resumen = insights.analysis?.status === 'LISTA' ? insights.analysis.summary?.trim() : '';
  l(resumen || '_Sin resumen generado._', '');

  if (insights.topics.length) {
    l('## Temas', '');
    [...insights.topics].sort((a, b) => a.start_ms - b.start_ms).forEach((t, i) => {
      const rango = `[${reloj(t.start_ms)}–${reloj(t.end_ms)}]`;
      l(`${i + 1}. **${unaLinea(t.title)}** ${rango}${t.summary ? `: ${unaLinea(t.summary)}` : ''}`);
    });
    l('');
  }

  l('## Acuerdos', '');
  if (!acuerdos.length) l('_No se registraron acuerdos._', '');
  const porTiempo = (a: Acuerdo, b: Acuerdo) => (a.start_ms ?? 0) - (b.start_ms ?? 0);
  const minuto = (a: Acuerdo) => (a.start_ms != null ? ` · [${reloj(a.start_ms)}]` : '');

  const decisiones = acuerdos.filter(a => a.kind === 'DECISION').sort(porTiempo);
  if (decisiones.length) {
    l(`### ${TIPO_ACUERDO_LABEL.DECISION.varios}`, '');
    for (const a of decisiones) {
      const quien = a.speaker_id ? hablantes.get(a.speaker_id)?.display_name : null;
      l(`- ${unaLinea(a.text)}${quien ? ` _(planteó: ${quien})_` : ''}${minuto(a)}`);
    }
    l('');
  }

  const compromisos = acuerdos.filter(a => a.kind === 'COMPROMISO').sort(porTiempo);
  if (compromisos.length) {
    l(`### ${TIPO_ACUERDO_LABEL.COMPROMISO.varios} por persona`, '');
    const grupos = new Map<string, Acuerdo[]>();
    for (const a of compromisos) {
      const r = responsableDe(a, hablantes, participantes) ?? 'Sin responsable';
      grupos.set(r, [...(grupos.get(r) ?? []), a]);
    }
    // Primero en el orden en que hablaron; "Sin responsable" al final.
    const ordenNombres = orden.map(h => normalizar(h.display_name));
    const nombres = [...grupos.keys()].sort((x, y) => {
      if (x === 'Sin responsable') return 1;
      if (y === 'Sin responsable') return -1;
      const ix = ordenNombres.indexOf(normalizar(x));
      const iy = ordenNombres.indexOf(normalizar(y));
      return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy) || x.localeCompare(y, 'es');
    });
    for (const n of nombres) {
      l(`**${n}**`, '');
      for (const a of grupos.get(n)!) {
        const marca = a.status === 'HECHO' ? '[x]' : '[ ]';
        l(`- ${marca} ${unaLinea(a.text)}${a.due_text ? ` (para: ${unaLinea(a.due_text)})` : ''}${minuto(a)}`);
      }
      l('');
    }
  }

  for (const tipo of ['PENDIENTE', 'RIESGO'] as const) {
    const lista = acuerdos.filter(a => a.kind === tipo).sort(porTiempo);
    if (!lista.length) continue;
    l(`### ${TIPO_ACUERDO_LABEL[tipo].varios}`, '');
    for (const a of lista) {
      const r = responsableDe(a, hablantes, participantes);
      l(`- ${unaLinea(a.text)}${r ? ` _(responsable: ${r})_` : ''}${minuto(a)}`);
    }
    l('');
  }

  const aportes = orden.filter(h => h.summary?.trim());
  if (aportes.length) {
    l('## Lo que aportó cada persona', '');
    for (const h of aportes) l(`- **${h.display_name}:** ${unaLinea(h.summary!)}`);
    l('');
  }

  l('## Transcripción completa', '');
  if (!d.segmentos.length) l('_Sin transcripción._', '');
  const turnos = agruparTurnos(d.segmentos, {
    pausaMaxMs: Number.POSITIVE_INFINITY, maxSegmentos: Number.POSITIVE_INFINITY,
  });
  for (const t of turnos) {
    const nombre = nombreDeSegmento(t.segmentos[0], hablantes);
    l(`**[${reloj(t.startMs)}] ${nombre}:** ${t.segmentos.map(s => unaLinea(s.text)).join(' ')}`, '');
  }

  l('---', `_Acta generada desde TuApo el ${fechaCorta(fechaLocalIso(d.generadoEn ?? new Date()))}._`, '');
  return lineas.join('\n');
}

/** Nombre de archivo seguro: `acta-REU-0003-levantamiento-de-nomina.md`. */
export function nombreArchivoActa(code: string, name: string): string {
  const slug = normalizar(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  const codigo = (code || 'reunion').replace(/[^A-Za-z0-9-]+/g, '');
  return `acta-${codigo}${slug ? `-${slug}` : ''}.md`;
}

/** Los saltos de línea dentro de un renglón de lista rompen el Markdown. */
function unaLinea(texto: string): string {
  return (texto ?? '').replace(/\s*\n+\s*/g, ' ').trim();
}
