import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { NavegacionService } from '../navegacion.service';
import { HerramientasPantallaService } from './herramientas-pantalla.service';

/**
 * Lo que la persona ve AHORA, como JSON compacto, para que el asistente operador tenga siempre el
 * contexto de la pantalla («¿qué es este valor?», «¿por qué sale así esta tabla?»).
 *
 * Primero lo que aportan las pantallas (HerramientasPantallaService.registrarContexto: la tabla
 * estándar, Mis tareas, Reportes); después una lectura genérica del área principal: títulos,
 * tarjetas de indicadores, tablas visibles, el diálogo abierto, el formulario, pestañas, filtros y
 * el texto seleccionado. Fuera queda el propio asistente, el chat, el menú y lo marcado
 * [data-ia-privado]; claves, tarjetas y códigos de un solo uso nunca se leen.
 */
export interface Instantanea {
  ruta: string;
  titulo: string;
  modulo?: string | null;
  migas?: string[];
  pantalla?: Record<string, unknown>;
  titulos?: string[];
  indicadores?: string[];
  tablas?: { titulo?: string; columnas: string[]; filas: string[][]; total_visibles: number }[];
  dialogo?: { titulo: string; texto?: string };
  formulario?: Record<string, string>;
  pestanas?: string[];
  filtros?: string[];
  seleccion?: string;
  recortado?: boolean;
}

const EXCLUIR = 'app-operador, app-chat-ia, app-chat-dock, app-navbar, app-sidebar, app-smart-menu, app-ai-tutor, app-panel-atencion, '
  + '.mat-mdc-snack-bar-container, [data-ia-privado], [aria-hidden="true"], script, style, noscript';
const SENSIBLE = /clave|contraseñ|password|token|cvv|cvc|tarjeta|pin\b|secreto/i;
const MAX_TOTAL = 8000;

@Injectable({ providedIn: 'root' })
export class LectorPantallaService {
  private router = inject(Router);
  private nav = inject(NavegacionService);
  private hp = inject(HerramientasPantallaService);

  /** Solo ruta y título (cuando la persona apaga «compartir pantalla»). */
  basica(): Instantanea {
    return { ruta: this.ruta(), titulo: this.titulo() };
  }

  instantanea(): Instantanea {
    const base = this.basica();
    try {
      if (typeof document === 'undefined') return base;
      const r: Instantanea = { ...base, modulo: this.nav.modulo() };
      const migas = this.textos('nav[aria-label*="miga" i] a, nav[aria-label*="breadcrumb" i] a, .breadcrumb a, .migas a, .breadcrumb li', 6, 60);
      if (migas.length) r.migas = migas;

      const aportes = this.hp.leerContextos();
      const conProveedor = Object.keys(aportes).length > 0;
      if (conProveedor) r.pantalla = aportes;

      const raiz = this.raiz();
      const titulos = this.visibles(raiz.querySelectorAll('h1, h2, h3')).map(e => limpio(e.textContent, 120)).filter(Boolean);
      if (titulos.length) r.titulos = unicos(titulos).slice(0, 10);

      const kpis = this.visibles(raiz.querySelectorAll('mat-card, .mat-mdc-card, .kpi, .kpis > *, .tarjeta, .indicador, [class*="kpi-"]'))
        .filter(e => !e.querySelector('table'))
        .map(e => limpio(e.textContent, 200)).filter(t => t && /\d/.test(t));
      if (kpis.length) r.indicadores = unicos(kpis).slice(0, 12);

      // Las tablas que ya describe un proveedor (la tabla estándar) no se repiten.
      const tablas = this.visibles(raiz.querySelectorAll('table'))
        .filter(t => !(conProveedor && t.closest('app-tabla-estandar')))
        .slice(0, 3).map(t => this.tabla(t)).filter(t => t.columnas.length || t.filas.length);
      if (tablas.length) r.tablas = tablas;

      const dlg = this.visibles(document.querySelectorAll('mat-dialog-container, .mat-mdc-dialog-container, [role="dialog"]'))
        .filter(d => !d.closest('app-operador')).at(-1);
      if (dlg) {
        r.dialogo = {
          titulo: limpio(dlg.querySelector('[mat-dialog-title], .mat-mdc-dialog-title, h1, h2, h3')?.textContent, 120),
          texto: limpio(this.texto(dlg), 800),
        };
      }

      const form = this.formulario(dlg ?? raiz);
      if (Object.keys(form).length) r.formulario = form;

      const pest = this.textos('.mdc-tab--active, .mat-mdc-tab.mdc-tab--active, [role="tab"][aria-selected="true"]', 6, 60, raiz);
      if (pest.length) r.pestanas = pest;

      const filtros = this.textos('mat-chip-option[aria-selected="true"], .mat-mdc-chip-selected, .mat-mdc-chip-highlighted, .filtro-activo, .chip-activo', 10, 60, raiz);
      if (filtros.length) r.filtros = filtros;

      const sel = typeof window !== 'undefined' ? window.getSelection?.()?.toString() ?? '' : '';
      if (sel.trim() && !this.selEnAsistente()) r.seleccion = limpio(sel, 600);

      return this.acotar(r);
    } catch {
      return base;
    }
  }

  // ── piezas ──

  private ruta(): string {
    try { return this.router.url; } catch { return ''; }
  }

  private titulo(): string {
    try {
      const t = this.nav.titulo();
      if (t && t !== 'Inicio') return t;
      const h1 = typeof document !== 'undefined' ? document.querySelector('main h1, h1') : null;
      return limpio(h1?.textContent, 120) || (typeof document !== 'undefined' ? document.title : '') || t || '';
    } catch {
      return '';
    }
  }

  private raiz(): Element {
    return document.querySelector('main') ?? document.querySelector('.dashboard-content, .contenido') ?? document.body;
  }

  /** Visible: renderizado, sin estar en una zona excluida y dentro (o cerca) de la ventana. */
  private visibles(lista: NodeListOf<Element> | Element[]): HTMLElement[] {
    const alto = typeof window !== 'undefined' ? window.innerHeight : 1000;
    const out: HTMLElement[] = [];
    for (const e of Array.from(lista) as HTMLElement[]) {
      if (!(e instanceof HTMLElement) || e.closest(EXCLUIR)) continue;
      if (e.offsetParent === null && getComputedStyle(e).position !== 'fixed') continue;
      const b = e.getBoundingClientRect();
      if (b.width < 2 || b.height < 2 || b.bottom < -alto * 0.25 || b.top > alto * 1.25) continue;
      out.push(e);
    }
    return out;
  }

  private textos(sel: string, max: number, largo: number, raiz: ParentNode = document): string[] {
    return unicos(this.visibles(raiz.querySelectorAll(sel)).map(e => limpio(e.textContent, largo)).filter(Boolean)).slice(0, max);
  }

  private tabla(t: HTMLElement): { titulo?: string; columnas: string[]; filas: string[][]; total_visibles: number } {
    const columnas = Array.from(t.querySelectorAll('thead th')).map(th => limpio(th.textContent, 40));
    const trs = Array.from(t.querySelectorAll('tbody tr')).filter(tr => (tr as HTMLElement).offsetParent !== null);
    const filas = trs.slice(0, 10).map(tr => Array.from(tr.querySelectorAll('td')).map(td => this.celda(td as HTMLElement)));
    const cab = t.closest('mat-card, section, .card, .tarjeta')?.querySelector('h1, h2, h3, h4, mat-card-title');
    return { titulo: cab ? limpio(cab.textContent, 80) : undefined, columnas, filas, total_visibles: trs.length };
  }

  private celda(td: HTMLElement): string {
    if (td.closest('[data-ia-privado]') || td.querySelector('input[type="password"]')) return '•••';
    return limpio(td.textContent, 60);
  }

  /** Etiqueta → valor de los campos visibles; nunca claves, tarjetas ni códigos de un solo uso. */
  private formulario(raiz: Element): Record<string, string> {
    const out: Record<string, string> = {};
    const campos = this.visibles(raiz.querySelectorAll('input, textarea, mat-select, select'));
    for (const c of campos.slice(0, 40)) {
      if (Object.keys(out).length >= 25) break;
      const tipo = (c.getAttribute('type') || '').toLowerCase();
      const auto = (c.getAttribute('autocomplete') || '').toLowerCase();
      if (['password', 'hidden', 'file', 'button', 'submit'].includes(tipo) || auto.startsWith('cc-') || auto === 'one-time-code') continue;
      const etiqueta = this.etiqueta(c);
      if (!etiqueta) continue;
      let valor = '';
      if (c instanceof HTMLInputElement) {
        if (tipo === 'radio' && !c.checked) continue;
        valor = tipo === 'checkbox' ? (c.checked ? 'sí' : 'no') : c.value;
      } else if (c instanceof HTMLTextAreaElement || c instanceof HTMLSelectElement) {
        valor = c.value;
      } else {
        valor = limpio(c.querySelector('.mat-mdc-select-value, .mat-mdc-select-min-line')?.textContent, 80);
      }
      valor = limpio(valor, 120);
      if (!valor) continue;
      out[etiqueta] = SENSIBLE.test(etiqueta) ? '•••' : valor;
    }
    return out;
  }

  private etiqueta(c: HTMLElement): string {
    const ff = c.closest('mat-form-field');
    const l = ff?.querySelector('mat-label, label')?.textContent
      || (c.id ? document.querySelector(`label[for="${CSS.escape(c.id)}"]`)?.textContent : '')
      || c.getAttribute('aria-label') || c.getAttribute('placeholder') || c.getAttribute('name') || '';
    return limpio(l, 50).replace(/\s*\*$/, '');
  }

  private texto(e: Element): string {
    const copia = e.cloneNode(true) as Element;
    copia.querySelectorAll('input, textarea, select, button, mat-icon, [data-ia-privado], script, style').forEach(x => x.remove());
    return copia.textContent ?? '';
  }

  private selEnAsistente(): boolean {
    const n = window.getSelection?.()?.anchorNode;
    const el = n instanceof Element ? n : n?.parentElement;
    return !!el?.closest('app-operador');
  }

  /** Recorta hasta ~8.000 caracteres quitando primero lo menos útil. */
  private acotar(r: Instantanea): Instantanea {
    const tam = () => JSON.stringify(r).length;
    if (tam() <= MAX_TOTAL) return r;
    r.recortado = true;
    if (r.tablas) for (const t of r.tablas) t.filas = t.filas.slice(0, 5);
    if (tam() > MAX_TOTAL && r.indicadores) r.indicadores = r.indicadores.slice(0, 6);
    if (tam() > MAX_TOTAL && r.dialogo?.texto) r.dialogo.texto = r.dialogo.texto.slice(0, 300);
    if (tam() > MAX_TOTAL) delete r.tablas;
    if (tam() > MAX_TOTAL && r.pantalla) {
      const js = JSON.stringify(r.pantalla);
      r.pantalla = { resumen: js.slice(0, Math.max(1000, MAX_TOTAL - 2500)) + '…' };
    }
    if (tam() > MAX_TOTAL) delete r.formulario;
    return r;
  }
}

function limpio(s: string | null | undefined, max: number): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

function unicos(l: string[]): string[] {
  return [...new Set(l)];
}
