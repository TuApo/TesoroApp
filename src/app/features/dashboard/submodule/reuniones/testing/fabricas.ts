/**
 * Datos falsos para las pruebas del módulo (sólo los importan los *.spec.ts).
 * Reproducen la reunión de prueba del contrato: Marcela (Nómina), Javier (Sistemas) y
 * Damián (Contratación), con una decisión y dos compromisos.
 */
import {
  Acuerdo, FichaPersona, HablanteInsight, InsightsReunion, Participante, Persona, ReunionDetalle,
  ReunionResumen, SegmentoTranscripcion, Tema,
} from '../models/reunion.model';

export function segmento(parcial: Partial<SegmentoTranscripcion> & { id: number }): SegmentoTranscripcion {
  return {
    idx: parcial.id,
    start_ms: 0,
    end_ms: 1000,
    speaker_id: null,
    speaker_label: null,
    speaker_name: null,
    text: '',
    text_original: null,
    confidence: 0.95,
    edited: false,
    ...parcial,
  };
}

export function hablante(parcial: Partial<HablanteInsight> & { id: string }): HablanteInsight {
  return {
    label: 'Persona 1',
    participant_id: null,
    participant_name: null,
    participant_source: null,
    display_name: 'Persona 1',
    color_idx: 0,
    talk_ms: 0,
    talk_pct: 0,
    segments_count: 0,
    words_count: 0,
    first_at_ms: 0,
    summary: null,
    suggested_name: null,
    suggested_role: null,
    suggestion_reason: null,
    suggestion_at_ms: null,
    ...parcial,
  };
}

export function acuerdo(parcial: Partial<Acuerdo> & { id: string }): Acuerdo {
  return {
    kind: 'COMPROMISO',
    text: '',
    quote: null,
    speaker_id: null,
    owner_speaker_id: null,
    owner_participant_id: null,
    owner_name: null,
    due_text: null,
    topic_id: null,
    start_ms: null,
    end_ms: null,
    status: 'ABIERTO',
    source: 'IA',
    ...parcial,
  };
}

export function participante(parcial: Partial<Participante> & { id: string }): Participante {
  return {
    usuario_id: null,
    first_name: null,
    last_name: null,
    display_name: '',
    position: null,
    area: null,
    company: null,
    email: null,
    phone: null,
    meeting_role: null,
    participant_type: 'USUARIO_FUNCIONAL',
    is_external: false,
    ...parcial,
  };
}

export const HABLANTES: HablanteInsight[] = [
  hablante({
    id: 'h1', label: 'Persona 1', display_name: 'Marcela Gómez', participant_id: 'p1', participant_name: 'Marcela Gómez',
    participant_source: 'MANUAL', color_idx: 0, talk_ms: 12000, talk_pct: 31.2, segments_count: 2, first_at_ms: 0,
    summary: 'Pidió cerrar la nómina el viernes.', person_key: 'u:42',
  }),
  hablante({
    id: 'h2', label: 'Persona 2', display_name: 'Persona 2', color_idx: 1, talk_ms: 14000, talk_pct: 36.5,
    segments_count: 2, first_at_ms: 12000, suggested_name: 'Javier', suggested_role: 'Sistemas',
    suggestion_reason: 'Soy Javier, de sistemas', suggestion_at_ms: 12000,
  }),
  hablante({
    id: 'h3', label: 'Persona 3', display_name: 'Persona 3', color_idx: 2, talk_ms: 9000, talk_pct: 23.4,
    segments_count: 1, first_at_ms: 26000,
  }),
];

export const SEGMENTOS: SegmentoTranscripcion[] = [
  segmento({ id: 1, start_ms: 0, end_ms: 6000, speaker_id: 'h1', speaker_label: 'Persona 1', text: 'Buenos días, soy Marcela, de nómina.' }),
  segmento({ id: 2, start_ms: 6000, end_ms: 12000, speaker_id: 'h1', speaker_label: 'Persona 1', text: 'Necesitamos cerrar la nómina el viernes.' }),
  segmento({ id: 3, start_ms: 12000, end_ms: 19000, speaker_id: 'h2', speaker_label: 'Persona 2', text: 'Soy Javier, de sistemas. Yo reviso los accesos.' }),
  segmento({ id: 4, start_ms: 19000, end_ms: 26000, speaker_id: 'h2', speaker_label: 'Persona 2', text: 'Me comprometo a enviar el reporte el viernes 15.' }),
  segmento({ id: 5, start_ms: 26000, end_ms: 35000, speaker_id: 'h3', speaker_label: 'Persona 3', text: 'Desde contratación aprobamos la decisión.' }),
];

export const TEMAS: Tema[] = [
  { id: 't1', idx: 0, title: 'Cierre de nómina', summary: 'Fecha del cierre.', keywords: ['nómina', 'cierre'],
    start_ms: 0, end_ms: 12000, speakers: [{ speaker_id: 'h1', talk_ms: 12000 }] },
  { id: 't2', idx: 1, title: 'Accesos y reporte', summary: 'Javier revisa accesos.', keywords: ['accesos'],
    start_ms: 12000, end_ms: 38400, speakers: [{ speaker_id: 'h2', talk_ms: 14000 }, { speaker_id: 'h3', talk_ms: 9000 }] },
];

export const ACUERDOS: Acuerdo[] = [
  acuerdo({ id: 'a1', kind: 'DECISION', text: 'Cerrar la nómina el viernes', speaker_id: 'h1', start_ms: 6500 }),
  acuerdo({ id: 'a2', kind: 'COMPROMISO', text: 'Enviar el reporte de accesos', speaker_id: 'h2', owner_speaker_id: 'h2',
    owner_name: 'Javier', due_text: 'el viernes 15', start_ms: 19500, quote: 'Me comprometo a enviar el reporte' }),
  acuerdo({ id: 'a3', kind: 'COMPROMISO', text: 'Validar contratos nuevos', owner_text: 'Luisa', status: 'HECHO', start_ms: 27000 }),
];

export function insights(parcial: Partial<InsightsReunion> = {}): InsightsReunion {
  return {
    recording_id: 'r1',
    transcript_id: 'tr1',
    duration_ms: 38400,
    transcript_status: 'LISTA',
    diarization: 'model',
    pipeline: { status: 'COMPLETED', stage_error: null },
    analysis: { id: 'an1', status: 'LISTA', summary: 'Se acordó cerrar la nómina el viernes.\nJavier enviará el reporte.',
      model: 'deepseek-chat', error: null, generated_at: '2026-09-26T15:00:00Z', version: 1 },
    speakers: HABLANTES,
    topics: TEMAS,
    items: ACUERDOS,
    ...parcial,
  };
}

export function resumen(parcial: Partial<ReunionResumen> = {}): ReunionResumen {
  return {
    id: 'm1', code: 'REU-0001', name: 'Cierre de nómina de septiembre', project_id: null, meeting_type: 'SEGUIMIENTO',
    system_name: 'TesoroApp', module_name: 'Nómina', held_on: '2026-09-12', started_at_time: '10:00:00', duration_min: 30,
    modality: 'VIRTUAL', status: 'EN_REVISION', confidentiality: 'INTERNA', owner_user_id: null, analyst_user_id: null,
    participants_count: 3, recordings_count: 1, created_at: '2026-09-12T15:00:00Z', updated_at: '2026-09-12T15:00:00Z',
    total_duration_ms: 38400, transcript_status: 'LISTA', analysis_status: 'LISTA', pipeline_status: 'COMPLETED',
    summary_snippet: 'Se acordó cerrar la nómina el viernes.', topics: ['Cierre de nómina', 'Accesos y reporte'],
    speakers: [
      { display_name: 'Marcela Gómez', color_idx: 0, talk_pct: 31.2 },
      { display_name: 'Javier Ruiz', color_idx: 1, talk_pct: 36.5 },
      { display_name: 'Persona 3', color_idx: 2, talk_pct: 23.4 },
    ],
    ...parcial,
  };
}

export function detalle(parcial: Partial<ReunionDetalle> = {}): ReunionDetalle {
  return {
    resumen: resumen(),
    location: null, meeting_url: null, tech_lead_user_id: null, requesting_area: 'Nómina', related_areas: [],
    objective: 'Definir la fecha de cierre', context: null, notes: null, parent_meeting_id: null, relation_type: null,
    participants: [
      participante({ id: 'p1', first_name: 'Marcela', last_name: 'Gómez', display_name: 'Marcela Gómez', area: 'Nómina', usuario_id: '42',
        person_key: 'u:42' }),
      participante({ id: 'p2', first_name: 'Javier', last_name: 'Ruiz', display_name: 'Javier Ruiz', area: 'Sistemas',
        person_key: 'n:javier ruiz' }),
    ],
    recordings: [{
      id: 'r1', kind: 'AUDIO', source: 'UPLOAD', original_filename: 'reunion.mp3', mime_type: 'audio/mpeg', size_bytes: 600000,
      duration_ms: 38400, status: 'COMPLETED', stage_error: null, segments_count: 5, audio_ready: true, original_purged: false,
      created_at: '2026-09-12T15:00:00Z', updated_at: '2026-09-12T15:00:00Z',
    }],
    ...parcial,
  };
}

export const PERSONAS: Persona[] = [
  { person_key: 'u:42', display_name: 'Marcela Gómez', usuario_id: '42', area: 'Nómina', position: 'Analista', company: null,
    is_external: false, meetings_count: 3, spoke_in_count: 2, talk_ms: 720000, open_commitments: 1, last_meeting_on: '2026-09-12' },
  { person_key: 'e:damian@proveedor.co', display_name: 'Damián Torres', usuario_id: null, area: 'Contratación', position: null,
    company: 'Proveedor SAS', is_external: true, meetings_count: 1, spoke_in_count: 0, talk_ms: 0, open_commitments: 0, last_meeting_on: '2026-09-10' },
];

export function ficha(parcial: Partial<FichaPersona> = {}): FichaPersona {
  return {
    person: PERSONAS[0],
    meetings: [
      { meeting_id: 'm1', code: 'REU-0001', name: 'Cierre de nómina de septiembre', held_on: '2026-09-12', status: 'EN_REVISION',
        talk_ms: 12000, talk_pct: 31.2, speaker_summary: 'Pidió cerrar la nómina el viernes.', role: 'Solicitante' },
      { meeting_id: 'm2', code: 'REU-0002', name: 'Seguimiento de accesos', held_on: '2026-09-05', status: 'CERRADA',
        talk_ms: 0, talk_pct: 0, speaker_summary: null, role: null },
    ],
    commitments: [
      { ...acuerdo({ id: 'c1', kind: 'COMPROMISO', text: 'Enviar el cronograma', owner_speaker_id: 'h1', due_text: 'el lunes', start_ms: 9000 }),
        meeting_id: 'm1', meeting_name: 'Cierre de nómina de septiembre' },
    ],
    decisions: [
      { ...acuerdo({ id: 'd1', kind: 'DECISION', text: 'Cerrar la nómina el viernes', speaker_id: 'h1', start_ms: 6500 }),
        meeting_id: 'm1', meeting_name: 'Cierre de nómina de septiembre' },
    ],
    quotes: [
      { meeting_id: 'm1', meeting_name: 'Cierre de nómina de septiembre', recording_id: 'r1', start_ms: 6000,
        text: 'Necesitamos cerrar la nómina el viernes.' },
    ],
    ...parcial,
  };
}
