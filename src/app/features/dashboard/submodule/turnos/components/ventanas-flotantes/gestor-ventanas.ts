import { Injectable, computed, signal } from '@angular/core';
import { Subject } from 'rxjs';

import { ClaveModulo } from '../../service/turnos.service';
import { getLocalStorageItem, setLocalStorageItem } from '../../../../../../core/utils/safe-storage';

/**
 * Ventanas flotantes de la atención remota: un módulo (pipeline, documentos, formas de
 * pago…) abierto encima de la videollamada sin salir de ella. Se mueven, se redimensionan,
 * se minimizan a una pestaña, se ponen grandes y vuelven a su tamaño.
 *
 * <p>Las funciones de geometría son puras (se prueban sin DOM); el gestor guarda el estado en
 * señales y recuerda la posición y el tamaño de cada módulo en `localStorage`.
 */

export interface Rect { x: number; y: number; w: number; h: number; }
export type EstadoVentana = 'minimizada' | 'normal' | 'maximizada';

export interface Ventana {
  /** Clave de deduplicación: el mismo tema en el mismo módulo es la misma ventana. */
  id: string;
  modulo: ClaveModulo;
  titulo: string;
  /** Qué se va a hacer allí (la acción del tema) o de qué persona es. */
  subtitulo: string | null;
  icono: string;
  url: string;
  urlExterna: string;
  estado: EstadoVentana;
  /** Dónde y de qué tamaño la quiere la persona; lo que se pinta se acota al viewport (rectVisible). */
  rect: Rect;
  z: number;
  /** La sugirió la IA y aún nadie la abrió: la pestaña se resalta. */
  nueva: boolean;
  /** Ya se abrió al menos una vez: el iframe existe y se conserva al minimizar. */
  cargada: boolean;
  /** Cómo estaba antes de minimizarse, para volver igual. */
  estadoPrevio: 'normal' | 'maximizada';
}

export interface AperturaVentana {
  modulo: ClaveModulo;
  temaClave?: string | null;
  titulo: string;
  subtitulo?: string | null;
  icono: string;
  url: string;
  urlExterna: string;
}

export const MARGEN = 8;
export const MIN_ANCHO = 320;
export const MIN_ALTO = 220;
export const ANCHO_MOVIL = 600;
const Z_BASE = 900;
const Z_TOPE = 990;
const CLAVE_STORAGE = 'tuapo.turnos.ventanas';

/** Una ventana por tema y módulo (sin tema: una por módulo). */
export function claveVentana(modulo: ClaveModulo, temaClave?: string | null): string {
  return `${modulo}|${(temaClave ?? '').trim() || 'manual'}`;
}

/** Deja la ventana entera dentro del viewport (y de un tamaño usable). */
export function acotarAlViewport(r: Rect, vw: number, vh: number, margen = MARGEN): Rect {
  const maxW = Math.max(160, vw - 2 * margen);
  const maxH = Math.max(120, vh - 2 * margen);
  const w = Math.round(Math.min(maxW, Math.max(Math.min(MIN_ANCHO, maxW), r.w)));
  const h = Math.round(Math.min(maxH, Math.max(Math.min(MIN_ALTO, maxH), r.h)));
  const x = Math.round(Math.min(Math.max(margen, r.x), vw - margen - w));
  const y = Math.round(Math.min(Math.max(margen, r.y), vh - margen - h));
  return { x, y, w, h };
}

/** Dónde nace una ventana nueva: a la derecha, escalonada para que no se tapen del todo. */
export function rectInicial(indice: number, vw: number, vh: number): Rect {
  const w = Math.min(880, Math.round(vw * 0.56));
  const h = Math.min(720, Math.round(vh * 0.78));
  const paso = 28 * (indice % 6);
  return acotarAlViewport({ x: vw - w - 24 - paso, y: 72 + paso, w, h }, vw, vh);
}

export function esMovil(vw: number): boolean { return vw < ANCHO_MOVIL; }

/** Un rectángulo guardado sirve solo si sus cuatro números son finitos y el tamaño positivo. */
export function rectValido(r: unknown): r is Rect {
  const v = r as Partial<Rect> | null;
  return !!v && typeof v === 'object'
    && [v.x, v.y, v.w, v.h].every(n => typeof n === 'number' && Number.isFinite(n))
    && (v.w as number) > 0 && (v.h as number) > 0;
}

function leerGuardadas(): Record<string, Rect> {
  try {
    const crudo = getLocalStorageItem(CLAVE_STORAGE);
    const v = crudo ? JSON.parse(crudo) : {};
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
}

@Injectable()
export class GestorVentanas {
  readonly ventanas = signal<Ventana[]>([]);
  /** Una ventana se está arrastrando o redimensionando: los iframes no deben tragarse el puntero. */
  readonly arrastrando = signal(false);
  readonly viewport = signal<{ w: number; h: number }>(GestorVentanas.medir());
  readonly movil = computed(() => esMovil(this.viewport().w));
  readonly visibles = computed(() => this.ventanas().filter(v => v.estado !== 'minimizada'));
  readonly alFrente = computed<string | null>(() => {
    const vis = this.visibles();
    return vis.length ? vis.reduce((a, b) => (b.z > a.z ? b : a)).id : null;
  });
  private z = Z_BASE;

  private static medir(): { w: number; h: number } {
    return typeof window === 'undefined' ? { w: 1280, h: 800 } : { w: window.innerWidth, h: window.innerHeight };
  }

  /**
   * Abre (o trae) la ventana de un módulo. Si ya existe la misma (tema + módulo) no se
   * duplica: se muestra y pasa al frente, salvo que se pida minimizada (sugerencia de la IA),
   * en cuyo caso se deja como está.
   */
  abrir(a: AperturaVentana, opciones: { minimizada?: boolean } = {}): Ventana {
    const id = claveVentana(a.modulo, a.temaClave);
    const ya = this.ventanas().find(v => v.id === id);
    if (ya) {
      if (!opciones.minimizada) this.mostrar(id);
      return this.ventanas().find(v => v.id === id)!;
    }
    const { w, h } = this.viewport();
    const guardada = leerGuardadas()[a.modulo];
    // Lo guardado lo pudo tocar otra versión o una extensión: sin números válidos la ventana quedaría en NaN.
    const rect = rectValido(guardada) ? { x: guardada.x, y: guardada.y, w: guardada.w, h: guardada.h } : rectInicial(this.ventanas().length, w, h);
    const nueva: Ventana = {
      id, modulo: a.modulo, titulo: a.titulo, subtitulo: a.subtitulo ?? null, icono: a.icono, url: a.url, urlExterna: a.urlExterna,
      estado: opciones.minimizada ? 'minimizada' : 'normal',
      rect, z: this.siguienteZ(), nueva: !!opciones.minimizada, cargada: !opciones.minimizada, estadoPrevio: 'normal',
    };
    this.ventanas.update(l => [...l, nueva]);
    return nueva;
  }

  minimizar(id: string): void { this.cambiar(id, { estado: 'minimizada' }); }

  /** A la vista y al frente, sin cambiarle el tamaño (minimizada vuelve a como estaba). */
  mostrar(id: string): void {
    const v = this.ventanas().find(x => x.id === id);
    if (!v) return;
    if (v.estado === 'minimizada') this.restaurar(id);
    else this.cambiar(id, { nueva: false, cargada: true, z: this.alFrente() === id ? v.z : this.siguienteZ() });
  }

  maximizar(id: string): void { this.cambiar(id, { estado: 'maximizada', nueva: false, cargada: true, z: this.siguienteZ() }); }

  /** Vuelve a su tamaño (o, minimizada, a como estaba). En móvil se ve siempre a pantalla completa. */
  restaurar(id: string): void {
    const v = this.ventanas().find(x => x.id === id);
    if (!v) return;
    const estado: EstadoVentana = v.estado === 'minimizada' ? v.estadoPrevio : 'normal';
    this.cambiar(id, { estado, nueva: false, cargada: true, z: this.siguienteZ() });
  }

  /** Doble clic en la barra, o el botón: grande ↔ su tamaño. */
  alternarMaximizar(id: string): void {
    const v = this.ventanas().find(x => x.id === id);
    if (!v) return;
    if (v.estado === 'maximizada') this.cambiar(id, { estado: 'normal', z: this.siguienteZ() });
    else this.maximizar(id);
  }

  /** Cómo se ve: en móvil una ventana "normal" ocupa la pantalla entera. */
  estadoVisible(v: Ventana): EstadoVentana {
    return this.movil() && v.estado === 'normal' ? 'maximizada' : v.estado;
  }

  /** Dónde se pinta: la que quiere la persona, acotada al viewport actual (si crece de nuevo, vuelve a su tamaño). */
  rectVisible(v: Ventana): Rect {
    const { w, h } = this.viewport();
    return acotarAlViewport(v.rect, w, h);
  }

  /** Pestaña: si está al frente se minimiza; si no, se muestra y pasa al frente. */
  alternarDesdePestana(id: string): void {
    const v = this.ventanas().find(x => x.id === id);
    if (!v) return;
    if (v.estado !== 'minimizada' && this.alFrente() === id) this.minimizar(id);
    else this.mostrar(id);
  }

  /** La persona cerró una ventana (no se emite al cerrar todas al terminar el turno). */
  readonly cerradas$ = new Subject<Ventana>();

  cerrar(id: string): void {
    const v = this.ventanas().find(x => x.id === id);
    if (!v) return;
    this.ventanas.update(l => l.filter(x => x.id !== id));
    this.cerradas$.next(v);
  }

  cerrarTodas(): void { this.ventanas.set([]); }

  traerAlFrente(id: string): void {
    const v = this.ventanas().find(x => x.id === id);
    if (!v || (this.alFrente() === id && v.estado !== 'minimizada')) return;
    this.cambiar(id, { z: this.siguienteZ() });
  }

  mover(id: string, x: number, y: number): void {
    const v = this.ventanas().find(k => k.id === id);
    if (!v || this.estadoVisible(v) !== 'normal') return;
    const { w, h } = this.viewport();
    this.cambiar(id, { rect: acotarAlViewport({ ...this.rectVisible(v), x, y }, w, h) });
  }

  redimensionar(id: string, ancho: number, alto: number): void {
    const v = this.ventanas().find(k => k.id === id);
    if (!v || this.estadoVisible(v) !== 'normal') return;
    const { w, h } = this.viewport();
    const actual = this.rectVisible(v);
    // Al crecer no se corre: se recorta contra el borde derecho/inferior.
    const r = { ...actual, w: Math.min(ancho, w - MARGEN - actual.x), h: Math.min(alto, h - MARGEN - actual.y) };
    this.cambiar(id, { rect: acotarAlViewport(r, w, h) });
  }

  /** Al soltar: se recuerda dónde y de qué tamaño quedó ese módulo. */
  recordar(id: string): void {
    const v = this.ventanas().find(k => k.id === id);
    if (!v) return;
    const guardadas = leerGuardadas();
    guardadas[v.modulo] = v.rect;
    try { setLocalStorageItem(CLAVE_STORAGE, JSON.stringify(guardadas)); } catch { /* sin storage */ }
  }

  /**
   * La ventana del navegador cambió de tamaño: todas se pintan dentro (rectVisible). No se
   * pisa el tamaño que eligió la persona: si el navegador vuelve a crecer, vuelven a él.
   */
  alCambiarViewport(w: number, h: number): void {
    this.viewport.set({ w, h });
  }

  private cambiar(id: string, cambio: Partial<Ventana>): void {
    this.ventanas.update(l => l.map(v => {
      if (v.id !== id) return v;
      const sig = { ...v, ...cambio };
      // Se recuerda cómo estaba antes de minimizar para volver igual.
      if (cambio.estado === 'minimizada' && v.estado !== 'minimizada') sig.estadoPrevio = v.estado;
      return sig;
    }));
  }

  private siguienteZ(): number {
    if (this.z >= Z_TOPE) {
      // Se renumeran en su orden actual para no pasar por encima de menús y diálogos (1000).
      const orden = [...this.ventanas()].sort((a, b) => a.z - b.z);
      const nuevas = new Map(orden.map((v, i) => [v.id, Z_BASE + i + 1]));
      this.ventanas.update(l => l.map(v => ({ ...v, z: nuevas.get(v.id) ?? v.z })));
      this.z = Z_BASE + orden.length;
    }
    return ++this.z;
  }
}
