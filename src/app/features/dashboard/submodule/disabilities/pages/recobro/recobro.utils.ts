/**
 * Utilidades puras de Recobro (reunion funcional 2026-10-05): cuando la EPS niega por una causal
 * que NO finaliza (no se evidencia pago de seguridad social, incapacidad incompleta, cotizante
 * no registrado...) toca una PQR = un nuevo radicado bajo el MISMO codigo unico. Puede haber 3,
 * 5 o 10 por incapacidad, cada uno con su fecha, y no se finaliza hasta una respuesta de pago.
 */
import type { TonoBadge } from '../../../../../../shared/components/tabla-estandar';
import type { RadicadoItem, RecobroItem, SituacionRecobro } from '../../models/incapacidad-salud.model';

export const SITUACIONES_RECOBRO: ReadonlyArray<{ valor: SituacionRecobro; etiqueta: string; icono: string }> = [
  { valor: 'PENDIENTE', etiqueta: 'Pendientes de recobro', icono: 'pending_actions' },
  { valor: 'RADICADO', etiqueta: 'Recobro radicado', icono: 'mark_email_read' },
  { valor: 'TODOS', etiqueta: 'Todos', icono: 'select_all' },
];

/** Ultimo radicado de recobro vigente (la lista llega del mas viejo al mas nuevo). */
export function ultimoRecobro(item: RecobroItem): RadicadoItem | null {
  const vigentes = (item.recobros ?? []).filter((r) => !r.anulado);
  return vigentes.length ? vigentes[vigentes.length - 1] : null;
}

/**
 * Situacion de una fila para el chip. Con el filtro PENDIENTE o RADICADO la decide el backend
 * (es el filtro mismo); en TODOS se deduce igual que el backend: hay recobro radicado si alguno
 * es posterior a la ultima negacion (o quedo amarrado a ella por `negacionId`).
 */
export function situacionDe(item: RecobroItem, filtro: SituacionRecobro = 'TODOS'): Exclude<SituacionRecobro, 'TODOS'> {
  if (filtro !== 'TODOS') return filtro;
  const ultimo = ultimoRecobro(item);
  if (!ultimo) return 'PENDIENTE';
  const negacion = item.negacion;
  if (!negacion) return 'RADICADO';
  if (ultimo.negacionId != null && ultimo.negacionId === negacion.id) return 'RADICADO';
  const tRecobro = Date.parse(ultimo.creadoEn ?? '');
  const tNegacion = Date.parse(negacion.creadoEn ?? '');
  if (!Number.isNaN(tRecobro) && !Number.isNaN(tNegacion)) return tRecobro >= tNegacion ? 'RADICADO' : 'PENDIENTE';
  return 'PENDIENTE';
}

export function etiquetaSituacion(s: Exclude<SituacionRecobro, 'TODOS'>): string {
  return s === 'RADICADO' ? 'Recobro radicado' : 'Pendiente de recobro';
}

export function tonoSituacion(s: Exclude<SituacionRecobro, 'TODOS'>): TonoBadge {
  return s === 'RADICADO' ? 'info' : 'warn';
}

/** Causal homologada ("COD · Nombre") o vacio si la EPS uso un texto aun sin equivalencia. */
export function causalHomologada(item: Pick<RecobroItem, 'negacion'>): string {
  const n = item.negacion;
  if (!n || (!n.causalCodigo && !n.causalNombre)) return '';
  return [n.causalCodigo, n.causalNombre].filter(Boolean).join(' · ');
}

/**
 * Nombre de cada radicado en la linea de tiempo: el inicial es "Radicación inicial" y los de
 * recobro se numeran en orden (1, 2, 3...) sin contar los anulados.
 */
export function rotularRadicados(radicados: readonly RadicadoItem[]): Array<{ radicado: RadicadoItem; rotulo: string }> {
  let n = 0;
  return radicados.map((radicado) => {
    if (radicado.tipo !== 'RECOBRO') {
      return { radicado, rotulo: radicado.numeroAnterior ? 'Radicación (corrección)' : 'Radicación inicial' };
    }
    if (radicado.anulado) return { radicado, rotulo: 'Recobro anulado' };
    n += 1;
    return { radicado, rotulo: `Recobro ${n}` };
  });
}
