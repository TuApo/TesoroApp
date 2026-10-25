/**
 * Simulacion sobre la pantalla real (pedido del 2026-10-21: "casi como una simulacion que los guie de
 * como se debe hacer"). Cada paso de la guia puede traer ACCIONES, que el recorrido ejecuta en modo
 * demostracion (escribe letra a letra, abre listas, elige opciones, toca dias del calendario) y una
 * CONDICION, que en modo practica dice cuando la persona ya hizo lo que se le pidio.
 *
 * Todo trabaja sobre el DOM de la pantalla real: los valores entran por el mismo evento `input` que
 * dispara el teclado, asi Angular (formularios, autocompletes, datepickers) reacciona igual que con
 * una persona escribiendo. No se llama a ningun servicio ni se toca ningun componente.
 */

export type AccionSimulada =
  /** Escribe en el input (o textarea) del selector, dentro del ancla; sin selector, en el primero. */
  | { tipo: 'escribir'; valor: string; selector?: string; deUnaVez?: boolean }
  /** Hace clic en el elemento del selector (o en el ancla). Entiende mat-select, mat-slide-toggle y mat-checkbox. */
  | { tipo: 'clic'; selector?: string }
  /** Elige, en la lista desplegada (autocomplete o mat-select), la opcion cuyo texto contiene alguno de los textos; si ninguna coincide y `oPrimera`, la primera. */
  | { tipo: 'opcion'; contiene: readonly string[]; oPrimera?: boolean }
  /** En el calendario abierto, toca el dia del mes. */
  | { tipo: 'calendario'; dia: number }
  /** Espera a que exista y se vea algo (en toda la pagina). */
  | { tipo: 'esperar'; selector: string; ms?: number }
  | { tipo: 'pausa'; ms: number };

export type CondicionLista =
  /** Un input/textarea del selector (o el primero del ancla) tiene texto. */
  | { tipo: 'valor'; selector?: string }
  /** Existe y se ve un elemento (en toda la pagina). */
  | { tipo: 'aparece'; selector: string }
  /** La persona hizo clic dentro del selector (o del ancla). */
  | { tipo: 'clic'; selector?: string };

export interface ResultadoAcciones {
  /** Todas las acciones se ejecutaron. */
  completo: boolean;
  /** Por que se detuvo (texto para la persona), si no fue completo. */
  motivo?: string;
}

const ESPERA_MS = 6000;
const PASO_ESPERA_MS = 120;

/** Quita tildes y pasa a minusculas, para comparar textos de opciones. */
export function compactarTexto(texto: string | null | undefined): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function seVe(el: Element | null): el is HTMLElement {
  return !!el && el.getClientRects().length > 0;
}

/**
 * El elemento sobre el que actua una accion: `selector` dentro del ancla, o el ancla misma. Un
 * selector que empieza por `@` se busca en toda la pagina (campos vecinos del ancla, dialogos).
 */
export function resolverElemento(doc: Document, ancla: HTMLElement, selector?: string): HTMLElement | null {
  if (!selector) return ancla;
  if (selector.startsWith('@')) return doc.querySelector<HTMLElement>(selector.substring(1));
  if (ancla.matches(selector)) return ancla;
  return ancla.querySelector<HTMLElement>(selector);
}

/** El control donde se escribe: el elemento si es input/textarea, o el primero que haya dentro. */
function controlDeTexto(el: HTMLElement | null): HTMLInputElement | HTMLTextAreaElement | null {
  if (!el) return null;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el;
  return el.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([readonly]), textarea',
  );
}

/** Donde hay que hacer clic para que un componente de Material reaccione. */
function objetivoDeClic(el: HTMLElement): HTMLElement {
  const tag = el.tagName.toLowerCase();
  if (tag === 'mat-select') return el.querySelector<HTMLElement>('.mat-mdc-select-trigger') ?? el;
  if (tag === 'mat-slide-toggle') return el.querySelector<HTMLElement>('button[role="switch"], button, input') ?? el;
  if (tag === 'mat-checkbox' || tag === 'mat-radio-button') return el.querySelector<HTMLElement>('input') ?? el;
  if (tag === 'mat-form-field') return controlDeTexto(el) ?? el;
  return el;
}

/** Asigna el valor como lo haria el teclado: setter nativo + evento `input` (asi lo ve Angular). */
function asignarValor(control: HTMLInputElement | HTMLTextAreaElement, valor: string): void {
  const proto = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(control, valor);
  else control.value = valor;
  control.dispatchEvent(new Event('input', { bubbles: true }));
}

function espera(win: Window, ms: number): Promise<void> {
  return new Promise((resolver) => win.setTimeout(resolver, ms));
}

/** Espera hasta `ms` a que `buscar()` devuelva algo visible. */
async function hastaQue<T extends Element>(
  win: Window,
  buscar: () => T | null,
  ms: number,
  cancelado: () => boolean,
): Promise<T | null> {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (cancelado()) return null;
    const el = buscar();
    if (el && seVe(el)) return el;
    await espera(win, PASO_ESPERA_MS);
  }
  return null;
}

/** Opciones desplegadas ahora mismo (autocomplete o select), sin las deshabilitadas ni las de estado. */
export function opcionesDesplegadas(doc: Document): HTMLElement[] {
  return Array.from(
    doc.querySelectorAll<HTMLElement>('.cdk-overlay-container mat-option, .cdk-overlay-container [role="option"]'),
  ).filter((o) => seVe(o) && o.getAttribute('aria-disabled') !== 'true' && !o.classList.contains('mdc-list-item--disabled'));
}

export function elegirOpcion(opciones: readonly HTMLElement[], contiene: readonly string[], oPrimera: boolean): HTMLElement | null {
  for (const texto of contiene) {
    const aguja = compactarTexto(texto);
    const hallada = opciones.find((o) => compactarTexto(o.textContent).includes(aguja));
    if (hallada) return hallada;
  }
  return oPrimera ? (opciones[0] ?? null) : null;
}

/** Celda del dia en el calendario abierto (solo las del mes visible y habilitadas). */
export function celdaDelDia(doc: Document, dia: number): HTMLElement | null {
  const celdas = Array.from(
    doc.querySelectorAll<HTMLElement>('.cdk-overlay-container .mat-calendar-body-cell, .cdk-overlay-container [role="gridcell"] button'),
  );
  return (
    celdas.find((c) => {
      const contenido = c.querySelector('.mat-calendar-body-cell-content') ?? c;
      return (contenido.textContent ?? '').trim() === String(dia) && c.getAttribute('aria-disabled') !== 'true' && seVe(c);
    }) ?? null
  );
}

export interface OpcionesEjecucion {
  /** Milisegundos entre letra y letra (0 en pruebas). */
  msPorLetra?: number;
  /** Para abortar (la persona salio del recorrido). */
  cancelado?: () => boolean;
}

/**
 * Ejecuta las acciones de un paso, en orden, sobre el ancla. Se detiene en la primera que no pueda
 * hacerse (no hay lista, no aparece el elemento…) y lo cuenta en `motivo`, para que el recorrido le
 * pida a la persona terminarlo a mano.
 */
export async function ejecutarAcciones(
  doc: Document,
  ancla: HTMLElement,
  acciones: readonly AccionSimulada[],
  opciones: OpcionesEjecucion = {},
): Promise<ResultadoAcciones> {
  const win = doc.defaultView;
  if (!win) return { completo: false, motivo: 'Sin ventana' };
  const cancelado = opciones.cancelado ?? (() => false);
  const msPorLetra = opciones.msPorLetra ?? 55;

  for (const accion of acciones) {
    if (cancelado()) return { completo: false, motivo: 'Cancelado' };
    switch (accion.tipo) {
      case 'escribir': {
        const control = controlDeTexto(resolverElemento(doc, ancla, accion.selector));
        if (!control || control.disabled) return { completo: false, motivo: 'No encontré dónde escribir.' };
        control.focus();
        if (accion.deUnaVez || msPorLetra === 0) {
          asignarValor(control, accion.valor);
        } else {
          let escrito = '';
          for (const letra of accion.valor) {
            if (cancelado()) return { completo: false, motivo: 'Cancelado' };
            escrito += letra;
            asignarValor(control, escrito);
            await espera(win, msPorLetra);
          }
        }
        break;
      }
      case 'clic': {
        const el = resolverElemento(doc, ancla, accion.selector);
        if (!seVe(el)) return { completo: false, motivo: 'No encontré dónde hacer clic.' };
        const objetivo = objetivoDeClic(el);
        objetivo.scrollIntoView({ block: 'center' });
        objetivo.click();
        await espera(win, msPorLetra ? 350 : 0);
        break;
      }
      case 'opcion': {
        let elegida: HTMLElement | null = null;
        await hastaQue(
          win,
          () => (elegida = elegirOpcion(opcionesDesplegadas(doc), accion.contiene, !!accion.oPrimera)),
          ESPERA_MS,
          cancelado,
        );
        if (!elegida) return { completo: false, motivo: 'No apareció ninguna opción en la lista.' };
        await espera(win, msPorLetra ? 450 : 0);
        (elegida as HTMLElement).click();
        await espera(win, msPorLetra ? 350 : 0);
        break;
      }
      case 'calendario': {
        const celda = await hastaQue(win, () => celdaDelDia(doc, accion.dia), ESPERA_MS, cancelado);
        if (!celda) return { completo: false, motivo: 'No se abrió el calendario.' };
        await espera(win, msPorLetra ? 450 : 0);
        celda.click();
        await espera(win, msPorLetra ? 350 : 0);
        break;
      }
      case 'esperar': {
        const el = await hastaQue(win, () => doc.querySelector<HTMLElement>(accion.selector), accion.ms ?? ESPERA_MS, cancelado);
        if (!el) return { completo: false, motivo: 'No apareció lo que esperaba.' };
        break;
      }
      case 'pausa':
        await espera(win, msPorLetra ? accion.ms : 0);
        break;
    }
  }
  return { completo: true };
}

/** `true` si la condicion ya se cumple sobre el ancla (sin esperar). */
export function condicionCumplida(doc: Document, ancla: HTMLElement, condicion: CondicionLista, clics: ReadonlySet<Element>): boolean {
  switch (condicion.tipo) {
    case 'valor': {
      const control = controlDeTexto(resolverElemento(doc, ancla, condicion.selector));
      return !!control && control.value.trim().length > 0;
    }
    case 'aparece':
      return seVe(doc.querySelector(condicion.selector));
    case 'clic': {
      const el = resolverElemento(doc, ancla, condicion.selector);
      if (!el) return false;
      for (const c of clics) if (el === c || el.contains(c)) return true;
      return false;
    }
  }
}

/**
 * Vigila la condicion y avisa UNA vez cuando se cumple. Escucha los eventos de la persona (clic,
 * teclado, cambios) y revisa la pagina periodicamente para lo que cambia solo (listas, dialogos).
 * Devuelve la funcion para dejar de vigilar.
 */
export function vigilarCondicion(
  doc: Document,
  ancla: HTMLElement,
  condicion: CondicionLista,
  alCumplirse: () => void,
): () => void {
  const win = doc.defaultView;
  const clics = new Set<Element>();
  let avisado = false;
  const revisar = (): void => {
    if (avisado) return;
    if (condicionCumplida(doc, ancla, condicion, clics)) {
      avisado = true;
      parar();
      alCumplirse();
    }
  };
  const alClic = (e: Event): void => {
    if (e.target instanceof Element) clics.add(e.target);
    revisar();
  };
  const alCambio = (): void => revisar();
  doc.addEventListener('click', alClic, true);
  doc.addEventListener('input', alCambio, true);
  doc.addEventListener('change', alCambio, true);
  doc.addEventListener('keyup', alCambio, true);
  const intervalo = win?.setInterval(revisar, 400);
  function parar(): void {
    doc.removeEventListener('click', alClic, true);
    doc.removeEventListener('input', alCambio, true);
    doc.removeEventListener('change', alCambio, true);
    doc.removeEventListener('keyup', alCambio, true);
    if (intervalo !== undefined) win?.clearInterval(intervalo);
  }
  revisar();
  return parar;
}
