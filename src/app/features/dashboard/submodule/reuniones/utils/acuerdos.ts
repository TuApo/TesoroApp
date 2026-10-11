import { Acuerdo, EstadoAcuerdo, GuardarAcuerdo } from '../models/reunion.model';

/** Cuerpo completo para PUT /items/{id}: el backend recibe todos los campos, no un parche. */
export function cuerpoDe(a: Acuerdo, cambios: Partial<GuardarAcuerdo> = {}): GuardarAcuerdo {
  return {
    kind: a.kind,
    text: a.text,
    owner_speaker_id: a.owner_speaker_id,
    owner_participant_id: a.owner_participant_id,
    owner_text: a.owner_text ?? null,
    due_text: a.due_text,
    start_ms: a.start_ms,
    status: a.status,
    ...cambios,
  };
}

/** Abiertos primero, luego hechos, luego descartados. */
export function ordenEstado(s: EstadoAcuerdo): number {
  return s === 'ABIERTO' ? 0 : s === 'HECHO' ? 1 : 2;
}
