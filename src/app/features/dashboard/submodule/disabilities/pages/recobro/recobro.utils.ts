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
 * (es el filtro mismo); en TODOS se deduce como `RecobroService.porSituacion`: hay recobro radicado
 * si EXISTE alguno vigente amarrado a la ultima negacion (`negacionId`) o registrado (`creadoEn`) a
 * la par o despues de ella. Se revisan TODOS, no solo el ultimo de la lista: la lista va por fecha
 * de radicado y un recobro anotado hoy con fecha de la semana pasada queda antes de uno viejo. Sin
 * hora para comparar, cuenta (igual que el backend: con NULL no hay negacion "posterior").
 */
export function situacionDe(item: RecobroItem, filtro: SituacionRecobro = 'TODOS'): Exclude<SituacionRecobro, 'TODOS'> {
  if (filtro !== 'TODOS') return filtro;
  const vigentes = (item.recobros ?? []).filter((r) => !r.anulado);
  if (!vigentes.length) return 'PENDIENTE';
  const negacion = item.negacion;
  if (!negacion) return 'RADICADO';
  const tNegacion = Date.parse(negacion.creadoEn ?? '');
  const cubre = (r: RadicadoItem): boolean => {
    if (r.negacionId != null && r.negacionId === negacion.id) return true;
    const tRecobro = Date.parse(r.creadoEn ?? '');
    return Number.isNaN(tRecobro) || Number.isNaN(tNegacion) || tRecobro >= tNegacion;
  };
  return vigentes.some(cubre) ? 'RADICADO' : 'PENDIENTE';
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
 * Nombre de cada radicado en la linea de tiempo. De radicacion, "Radicación inicial" es el que se
 * REGISTRO primero (el sintetico sin id de las historicas, o el de menor `creadoEn`); los demas son
 * correcciones: volver a radicar con otro numero, o con el mismo y otra fecha o canal (ahi el backend
 * deja fila sin `numeroAnterior`). No vale "el primero de la lista": va por fecha de radicado y una
 * correccion de la fecha hacia atras quedaria arriba. Los recobros se numeran en orden (1, 2, 3...)
 * sin contar los anulados.
 */
export function rotularRadicados(radicados: readonly RadicadoItem[]): Array<{ radicado: RadicadoItem; rotulo: string }> {
  const inicial = radicadoInicial(radicados);
  let n = 0;
  return radicados.map((radicado) => {
    if (radicado.tipo !== 'RECOBRO') {
      const correccion = radicado !== inicial || !!radicado.numeroAnterior;
      return { radicado, rotulo: correccion ? 'Radicación (corrección)' : 'Radicación inicial' };
    }
    if (radicado.anulado) return { radicado, rotulo: 'Recobro anulado' };
    n += 1;
    return { radicado, rotulo: `Recobro ${n}` };
  });
}

/** El radicado de RADICACION registrado primero (ver `rotularRadicados`). */
function radicadoInicial(radicados: readonly RadicadoItem[]): RadicadoItem | null {
  let inicial: RadicadoItem | null = null;
  const orden = (r: RadicadoItem): [number, number] => {
    // El sintetico (id null) es anterior a toda fila de la traza; sin hora, despues de las que si tienen.
    if (r.id == null) return [-Infinity, -Infinity];
    const t = Date.parse(r.creadoEn ?? '');
    return [Number.isNaN(t) ? Infinity : t, r.id];
  };
  for (const r of radicados) {
    if (r.tipo === 'RECOBRO') continue;
    if (!inicial) {
      inicial = r;
      continue;
    }
    const [ta, ia] = orden(r);
    const [tb, ib] = orden(inicial);
    if (ta < tb || (ta === tb && ia < ib)) inicial = r;
  }
  return inicial;
}
