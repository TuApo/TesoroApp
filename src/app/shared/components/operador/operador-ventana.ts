import { signal } from '@angular/core';

import { VistaOperador } from '../../../core/services/operador/operador.modelos';

/** Lo que se recuerda de la ventana por persona (localStorage). */
interface Guardado { x: number; y: number; w: number; h: number; vista: VistaOperador; }

const ANCHO = 420;
const ALTO = 620;
const MIN_ANCHO = 320;
const MIN_ALTO = 380;
/** Margen con los bordes de la pantalla y espacio para las pestañas del dock a la derecha. */
const MARGEN = 12;
const RESERVA_DERECHA = 52;

/**
 * Posición y tamaño de la ventana flotante del asistente: se arrastra por la cabecera, se
 * redimensiona desde la esquina, nunca se sale de la pantalla y se recuerda por persona.
 * Puntero (mouse, táctil y lápiz) con captura, sin librerías.
 */
export class VentanaFlotante {
  readonly x = signal(0);
  readonly y = signal(0);
  readonly w = signal(ANCHO);
  readonly h = signal(ALTO);
  readonly moviendo = signal(false);

  private clave: string | null = null;
  private inicio: { px: number; py: number; x: number; y: number; w: number; h: number } | null = null;
  private modo: 'mover' | 'tamano' | null = null;

  /** Carga lo guardado (o la posición por defecto: abajo a la derecha, junto a las pestañas). */
  cargar(usuarioId: string): VistaOperador | null {
    this.clave = `operador:ventana:${usuarioId}`;
    let g: Partial<Guardado> | null = null;
    try { g = JSON.parse(localStorage.getItem(this.clave) || 'null'); } catch { g = null; }
    const vw = this.vw(), vh = this.vh();
    this.w.set(Math.min(Math.max(g?.w ?? ANCHO, MIN_ANCHO), vw - 2 * MARGEN));
    this.h.set(Math.min(Math.max(g?.h ?? ALTO, MIN_ALTO), vh - 2 * MARGEN));
    this.x.set(g?.x ?? vw - this.w() - RESERVA_DERECHA - MARGEN);
    this.y.set(g?.y ?? vh - this.h() - MARGEN * 2);
    this.ajustar();
    return g?.vista === 'flotante' || g?.vista === 'acoplado' ? g.vista : null;
  }

  guardar(vista: VistaOperador): void {
    if (!this.clave) return;
    const g: Guardado = { x: Math.round(this.x()), y: Math.round(this.y()), w: Math.round(this.w()), h: Math.round(this.h()), vista };
    try { localStorage.setItem(this.clave, JSON.stringify(g)); } catch { /* sin storage: no se recuerda */ }
  }

  /** La pantalla cambió de tamaño: la ventana se vuelve a meter completa. */
  ajustar(): void {
    const vw = this.vw(), vh = this.vh();
    this.w.set(Math.min(this.w(), vw - 2 * MARGEN));
    this.h.set(Math.min(this.h(), vh - 2 * MARGEN));
    this.x.set(Math.min(Math.max(this.x(), MARGEN), vw - this.w() - MARGEN));
    this.y.set(Math.min(Math.max(this.y(), MARGEN), vh - this.h() - MARGEN));
  }

  empezar(e: PointerEvent, modo: 'mover' | 'tamano'): void {
    if (e.button !== 0) return;
    // Mover solo desde la cabecera: sus botones siguen funcionando normal.
    if (modo === 'mover' && (e.target as HTMLElement).closest('button, input, select, textarea, a')) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    this.modo = modo;
    this.inicio = { px: e.clientX, py: e.clientY, x: this.x(), y: this.y(), w: this.w(), h: this.h() };
    this.moviendo.set(true);
  }

  mover(e: PointerEvent): void {
    if (!this.inicio || !this.modo) return;
    const dx = e.clientX - this.inicio.px;
    const dy = e.clientY - this.inicio.py;
    if (this.modo === 'mover') {
      this.x.set(this.inicio.x + dx);
      this.y.set(this.inicio.y + dy);
    } else {
      this.w.set(Math.max(MIN_ANCHO, this.inicio.w + dx));
      this.h.set(Math.max(MIN_ALTO, this.inicio.h + dy));
    }
    this.ajustar();
  }

  /** Suelta; devuelve true si de verdad se movió o cambió de tamaño (para guardar). */
  terminar(): boolean {
    const hubo = !!this.inicio;
    this.inicio = null;
    this.modo = null;
    this.moviendo.set(false);
    return hubo;
  }

  /** Vuelve a la esquina de siempre (doble clic en la cabecera). */
  restablecer(): void {
    this.w.set(Math.min(ANCHO, this.vw() - 2 * MARGEN));
    this.h.set(Math.min(ALTO, this.vh() - 2 * MARGEN));
    this.x.set(this.vw() - this.w() - RESERVA_DERECHA - MARGEN);
    this.y.set(this.vh() - this.h() - MARGEN * 2);
    this.ajustar();
  }

  private vw(): number { return typeof window === 'undefined' ? 1280 : window.innerWidth; }
  private vh(): number { return typeof window === 'undefined' ? 800 : window.innerHeight; }
}
