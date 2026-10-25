/**
 * Rebotes de correo (ms-auth-admin, `/api/v1/admin/correos/rebotes`).
 * Fase 1: la plataforma solo MARCA; ningún envío se bloquea por esto.
 */

export type TipoRebote = 'DURO' | 'BLANDO' | 'POLITICA' | 'OTRO' | 'DEMORADO';

export interface ResumenRebotes {
  leidos: number;
  rebotes: number;
  demoras: number;
  sin_cruce: number;
  ignorados: number;
  errores: number;
}

export interface EstadoRebotes {
  configurado: boolean;
  habilitado: boolean;
  ultima_pasada: string | null;
  ultimo_error: string | null;
  ultimo_resumen: ResumenRebotes | null;
  buzones: string[];
}

export interface EnvioRebotado {
  id: number;
  id_cuenta: string;
  destinatario: string;
  asunto: string | null;
  origen: string | null;
  enviado_en: string;
  estado_entrega: 'REBOTADO' | 'DEMORADO';
  rebote_tipo: TipoRebote | null;
  rebote_codigo: string | null;
  rebote_detalle: string | null;
  rebote_en: string | null;
}

export interface DireccionRebotada {
  id: number;
  direccion: string;
  invalida: boolean;
  ultimo_tipo: TipoRebote;
  ultimo_codigo: string | null;
  ultimo_detalle: string | null;
  rebotes_duros: number;
  rebotes_blandos: number;
  primer_rebote: string;
  ultimo_rebote: string;
  id_envio_ultimo: number | null;
  origen_ultimo: string | null;
  desmarcada_en: string | null;
}

export const TIPO_REBOTE_META: Record<TipoRebote, { label: string; ayuda: string; tono: 'danger' | 'warn' | 'info' | 'neutro' | 'violet' }> = {
  DURO: { label: 'No existe', ayuda: 'La dirección no existe o está deshabilitada.', tono: 'danger' },
  BLANDO: { label: 'Buzón lleno', ayuda: 'El buzón está lleno. Al tercer aviso se marca como inválida.', tono: 'warn' },
  POLITICA: { label: 'Rechazado por política', ayuda: 'El servidor de destino rechazó el correo (spam o reputación). No dice nada de la dirección.', tono: 'violet' },
  OTRO: { label: 'Otro fallo', ayuda: 'Fallo permanente sin clasificar; revisar el detalle.', tono: 'neutro' },
  DEMORADO: { label: 'Demorado', ayuda: 'El servidor de destino lo sigue intentando; aún puede llegar.', tono: 'info' },
};
