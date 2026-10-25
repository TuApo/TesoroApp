import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';

import {
  Comunicacion, Fragmento, Hallazgo, MonitoreoService, ProcGrafo, ProcPersona,
} from '../../monitoreo.service';

interface NodoPos { clave: string; etiqueta: string; tipo: string; x: number; y: number; r: number; color: string; peso: number; veces: number; }
interface AristaPos { x1: number; y1: number; x2: number; y2: number; tipo: string; w: number; path: string; conteo: number; }
interface Lienzo { nodos: NodoPos[]; aristas: AristaPos[]; vacio: boolean; }

const PALETA = ['#2b59f0', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5'];

/**
 * Levantamiento de procesos: visualiza el GRAFO de proceso que crece con el tiempo (categorías de
 * trabajo + apps + cómo se encadenan), los HALLAZGOS con su procedencia (de dónde se sacó cada dato)
 * y las COMUNICACIONES (correos/chats) detectadas. Se puede ver por persona o de toda la compañía.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-procesos',
  imports: [CommonModule, FormsModule, MatIconModule],
  template: `
    <div class="pr">
      <header class="pr__cab">
        <button class="ico" (click)="volver()" title="Volver"><mat-icon>arrow_back</mat-icon></button>
        <h1><mat-icon>hub</mat-icon> Levantamiento de procesos</h1>
        <span class="pr__flex"></span>
        <select class="sel" [(ngModel)]="persona" (ngModelChange)="cambiarPersona($event)">
          <option value="">Toda la compañía</option>
          @for (p of personas(); track p.persona) { <option [value]="p.persona">{{ p.nombre }}</option> }
        </select>
        <button class="btn" [disabled]="levantando()" (click)="levantar()">
          <mat-icon>{{ levantando() ? 'hourglass_empty' : 'auto_awesome' }}</mat-icon> Levantar ahora
        </button>
        <button class="btn" (click)="cargar()"><mat-icon>refresh</mat-icon></button>
      </header>

      <nav class="pr__tabs">
        <button [class.on]="tab() === 'grafo'" (click)="tab.set('grafo')"><mat-icon>account_tree</mat-icon> Grafo ({{ grafo()?.nodos?.length || 0 }})</button>
        <button [class.on]="tab() === 'hallazgos'" (click)="tab.set('hallazgos')"><mat-icon>lightbulb</mat-icon> Hallazgos ({{ hallazgos().length }})</button>
        <button [class.on]="tab() === 'comunicaciones'" (click)="tab.set('comunicaciones')"><mat-icon>forum</mat-icon> Comunicaciones ({{ comunicaciones().length }})</button>
        <button [class.on]="tab() === 'fragmentos'" (click)="tab.set('fragmentos')"><mat-icon>content_paste</mat-icon> Documentos y datos ({{ fragmentos().length }})</button>
      </nav>

      <!-- ── GRAFO ── -->
      @if (tab() === 'grafo') {
        <section class="pr__grafo">
          @if (lienzo().vacio) {
            <div class="vacio-box">
              <mat-icon>hub</mat-icon>
              <p>Todavía no hay grafo de proceso. Pulsa <b>Levantar ahora</b> para construirlo con la actividad registrada.</p>
            </div>
          } @else {
            <svg [attr.viewBox]="VB" preserveAspectRatio="xMidYMid meet" class="svg">
              <g>
                @for (a of lienzo().aristas; track $index) {
                  <path [attr.d]="a.path" [attr.stroke]="a.tipo === 'SECUENCIA' ? '#94a3b8' : '#cbd5e1'"
                        [attr.stroke-width]="a.w" fill="none" [attr.stroke-dasharray]="a.tipo === 'USA' ? '4 4' : ''"
                        opacity="0.55" [attr.marker-end]="a.tipo === 'SECUENCIA' ? 'url(#flecha)' : ''"></path>
                }
              </g>
              <defs>
                <marker id="flecha" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                  <path d="M0,0 L7,3 L0,6 Z" fill="#94a3b8"></path>
                </marker>
              </defs>
              <g>
                @for (n of lienzo().nodos; track n.clave) {
                  <g class="nodo" [class.nodo--sel]="selNodo()?.clave === n.clave" (click)="selNodo.set(n)">
                    <circle [attr.cx]="n.x" [attr.cy]="n.y" [attr.r]="n.r" [attr.fill]="n.color"
                            [attr.fill-opacity]="n.tipo === 'CATEGORIA' ? 0.92 : 0.5"
                            [attr.stroke]="n.color" stroke-width="1.5"></circle>
                    <text [attr.x]="n.x" [attr.y]="n.y + n.r + 11" text-anchor="middle" class="et"
                          [attr.font-weight]="n.tipo === 'CATEGORIA' ? 700 : 400">{{ etiquetaCorta(n) }}</text>
                  </g>
                }
              </g>
            </svg>
            <div class="leyenda">
              <span><i class="p" style="background:#2b59f0"></i> Categoría de trabajo</span>
              <span><i class="p" style="background:#2b59f0;opacity:.5"></i> App / herramienta</span>
              <span><i class="l"></i> Secuencia (A→B)</span>
              <span><i class="l l--dash"></i> Usa</span>
            </div>
            @if (selNodo(); as n) {
              <div class="nodo-info">
                <b>{{ n.etiqueta || n.clave }}</b> <small>{{ n.tipo === 'CATEGORIA' ? 'Categoría' : 'App' }}</small>
                <span>⏱ {{ horas(n.peso) }} · {{ n.veces }} aperturas</span>
                <button class="x" (click)="selNodo.set(null)"><mat-icon>close</mat-icon></button>
              </div>
            }
          }
        </section>
      }

      <!-- ── HALLAZGOS ── -->
      @if (tab() === 'hallazgos') {
        <section class="pr__hall">
          @for (h of hallazgos(); track h.id) {
            <article class="hall" [class]="'hall--' + h.tipo.toLowerCase()">
              <header>
                <span class="tag">{{ h.tipo }}</span>
                <b>{{ h.titulo }}</b>
                <span class="conf">{{ (h.confianza * 100) | number:'1.0-0' }}%</span>
              </header>
              @if (h.detalle) { <p>{{ h.detalle }}</p> }
              <footer>
                <mat-icon>my_location</mat-icon>
                <span class="fuente">{{ h.fuente || 'origen no registrado' }}</span>
                @if (h.fechaFuente) { <span class="fecha">{{ h.fechaFuente | date:'short' }}</span> }
              </footer>
            </article>
          }
          @if (!hallazgos().length) { <p class="vacio">Sin hallazgos. La IA los extrae al levantar el proceso del día.</p> }
        </section>
      }

      <!-- ── COMUNICACIONES ── -->
      @if (tab() === 'comunicaciones') {
        <section class="pr__comu">
          @for (c of comunicaciones(); track c.id) {
            <div class="comu">
              <span class="comu__canal" [class]="'cn--' + c.canal.toLowerCase()"><mat-icon>{{ iconoCanal(c.canal) }}</mat-icon></span>
              <div class="comu__cuerpo">
                <div class="comu__lin">
                  <b>{{ c.deNombre || '—' }}</b>
                  @if (c.destino) { <mat-icon class="fl">arrow_forward</mat-icon> <span>{{ c.destino }}</span> }
                  <span class="comu__ts">{{ c.ts ? (c.ts | date:'short') : '' }}</span>
                </div>
                @if (c.asunto) { <p class="comu__asunto">{{ c.asunto }}</p> }
                <small class="comu__fuente">{{ c.canal }} · {{ c.fuente }}</small>
              </div>
            </div>
          }
          @if (!comunicaciones().length) { <p class="vacio">Sin comunicaciones detectadas todavía.</p> }
        </section>
      }

      <!-- ── DOCUMENTOS Y DATOS (fragmentos capturados) ── -->
      @if (tab() === 'fragmentos') {
        <section class="pr__frag">
          @for (f of fragmentos(); track f.id) {
            <details class="frag">
              <summary>
                <span class="frag__org" [class]="'og--' + f.origen.toLowerCase()">{{ etiquetaOrigen(f.origen) }}</span>
                <span class="frag__res">{{ f.resumen || '(sin texto)' }}</span>
                @if (f.sensible) { <mat-icon class="frag__lock" title="Se enmascararon datos sensibles">lock</mat-icon> }
                <span class="frag__ts">{{ f.ts ? (f.ts | date:'short') : '' }}</span>
              </summary>
              <div class="frag__det">
                <div class="frag__fuente"><mat-icon>my_location</mat-icon> {{ f.app || '?' }}@if (f.tituloVentana) { <span> · {{ f.tituloVentana }}</span> } · {{ f.bytes }} B</div>
                <pre class="frag__cont">{{ f.contenido }}</pre>
              </div>
            </details>
          }
          @if (!fragmentos().length) {
            <p class="vacio">Sin datos capturados. Requiere activar la capa <b>cap_texto</b> en la política del equipo (portapapeles, documentos y texto, con consentimiento).</p>
          }
        </section>
      }

      @if (aviso()) { <div class="pr__aviso">{{ aviso() }}</div> }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .pr { padding: 12px 16px; color: var(--text, #0f1b2d); }
    .pr__cab { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .pr__cab h1 { font-size: 18px; font-weight: 800; display: flex; align-items: center; gap: 8px; margin: 0; }
    .pr__flex { flex: 1; }
    .ico { border: 1px solid var(--border, #cbd5e1); background: var(--surface, #fff); border-radius: 10px; width: 40px; height: 40px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; color: inherit; }
    .btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border, #cbd5e1); background: var(--surface, #fff); color: inherit; border-radius: 10px; padding: 6px 12px; min-height: 40px; cursor: pointer; font-weight: 700; font-size: 13px; }
    .btn:disabled { opacity: .5; }
    .btn mat-icon, .ico mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .sel { padding: 8px 10px; border: 1px solid var(--border, #cbd5e1); border-radius: 10px; background: var(--surface, #fff); color: inherit; min-height: 40px; font-weight: 700; font-size: 13px; max-width: 240px; }
    .pr__tabs { display: flex; gap: 6px; margin: 12px 0; flex-wrap: wrap; }
    .pr__tabs button { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border, #e2e8f0); background: var(--surface, #fff); color: #64748b; border-radius: 999px; padding: 7px 14px; cursor: pointer; font-weight: 700; font-size: 13px; }
    .pr__tabs button.on { background: var(--brand-blue, #2b59f0); color: #fff; border-color: transparent; }
    .pr__tabs mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .pr__grafo { position: relative; background: var(--surface, #fff); border: 1px solid var(--border, #e2e8f0); border-radius: 14px; padding: 8px; }
    .svg { width: 100%; height: auto; max-height: 72vh; display: block; }
    .nodo { cursor: pointer; } .nodo:hover circle { stroke-width: 3; }
    .nodo--sel circle { stroke: #0f172a; stroke-width: 3; }
    .et { font-size: 11px; fill: var(--text, #334155); pointer-events: none; }
    .leyenda { display: flex; gap: 16px; flex-wrap: wrap; font-size: 12px; color: #64748b; padding: 6px 10px; }
    .leyenda i.p { display: inline-block; width: 11px; height: 11px; border-radius: 50%; vertical-align: middle; margin-right: 3px; }
    .leyenda i.l { display: inline-block; width: 18px; height: 0; border-top: 2px solid #94a3b8; vertical-align: middle; margin-right: 3px; }
    .leyenda i.l--dash { border-top-style: dashed; }
    .nodo-info { position: absolute; left: 12px; bottom: 44px; background: #0f172a; color: #fff; border-radius: 10px; padding: 8px 34px 8px 12px; font-size: 13px; display: flex; flex-direction: column; gap: 2px; }
    .nodo-info small { opacity: .7; } .nodo-info .x { position: absolute; right: 4px; top: 4px; border: 0; background: transparent; color: #fff; cursor: pointer; }
    .nodo-info .x mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .vacio-box { text-align: center; padding: 48px 16px; color: #64748b; } .vacio-box mat-icon { font-size: 44px; width: 44px; height: 44px; opacity: .4; }
    .pr__hall { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; }
    .hall { background: var(--surface, #fff); border: 1px solid var(--border, #e2e8f0); border-left: 4px solid #94a3b8; border-radius: 10px; padding: 10px 12px; }
    .hall--documento { border-left-color: #2b59f0; } .hall--contacto { border-left-color: #16a34a; }
    .hall--proceso { border-left-color: #9333ea; } .hall--riesgo { border-left-color: #dc2626; } .hall--dato { border-left-color: #d97706; }
    .hall header { display: flex; align-items: center; gap: 8px; }
    .hall header b { flex: 1; font-size: 14px; } .tag { font-size: 10px; font-weight: 800; background: #f1f5f9; color: #475569; border-radius: 6px; padding: 2px 6px; }
    .conf { font-size: 11px; color: #94a3b8; font-weight: 700; }
    .hall p { margin: 6px 0; font-size: 13px; color: #334155; }
    .hall footer { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #64748b; border-top: 1px dashed #e2e8f0; padding-top: 6px; }
    .hall footer mat-icon { font-size: 14px; width: 14px; height: 14px; color: #2b59f0; }
    .hall .fuente { flex: 1; font-style: italic; } .hall .fecha { white-space: nowrap; }
    .pr__comu { display: flex; flex-direction: column; gap: 6px; max-width: 760px; }
    .comu { display: flex; gap: 10px; background: var(--surface, #fff); border: 1px solid var(--border, #e2e8f0); border-radius: 10px; padding: 8px 10px; }
    .comu__canal { width: 34px; height: 34px; flex: none; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: #eff6ff; color: #2b59f0; }
    .comu__canal mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .cn--chat { background: #f0fdf4; color: #16a34a; } .cn--reunion { background: #faf5ff; color: #9333ea; }
    .comu__cuerpo { flex: 1; min-width: 0; } .comu__lin { display: flex; align-items: center; gap: 6px; font-size: 13px; flex-wrap: wrap; }
    .comu__lin .fl { font-size: 14px; width: 14px; height: 14px; color: #94a3b8; }
    .comu__ts { margin-left: auto; color: #94a3b8; font-size: 11px; }
    .comu__asunto { margin: 2px 0; font-size: 13px; color: #334155; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .comu__fuente { color: #94a3b8; font-size: 11px; }
    .pr__frag { display: flex; flex-direction: column; gap: 6px; max-width: 820px; }
    .frag { background: var(--surface, #fff); border: 1px solid var(--border, #e2e8f0); border-radius: 10px; padding: 0; }
    .frag summary { display: flex; align-items: center; gap: 8px; padding: 9px 12px; cursor: pointer; list-style: none; }
    .frag summary::-webkit-details-marker { display: none; }
    .frag__org { font-size: 10px; font-weight: 800; border-radius: 6px; padding: 2px 6px; background: #eff6ff; color: #2b59f0; flex: none; }
    .og--doc { background: #faf5ff; color: #9333ea; } .og--tecla { background: #fef3c7; color: #b45309; } .og--seleccion { background: #ecfeff; color: #0891b2; }
    .frag__res { flex: 1; min-width: 0; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .frag__lock { font-size: 15px; width: 15px; height: 15px; color: #dc2626; }
    .frag__ts { color: #94a3b8; font-size: 11px; white-space: nowrap; }
    .frag__det { padding: 0 12px 10px; }
    .frag__fuente { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #64748b; margin: 2px 0 6px; }
    .frag__fuente mat-icon { font-size: 14px; width: 14px; height: 14px; color: #2b59f0; }
    .frag__cont { margin: 0; background: var(--muted, #f8fafc); border: 1px solid var(--border, #eef2f7); border-radius: 8px; padding: 8px; font-size: 12px; white-space: pre-wrap; word-break: break-word; max-height: 320px; overflow: auto; }
    .vacio { color: #94a3b8; font-size: 13px; padding: 16px 0; }
    .pr__aviso { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); background: #0f172a; color: #fff; padding: 8px 16px; border-radius: 999px; font-size: 13px; z-index: 20; }
    @media (max-width: 600px) { .sel { max-width: 150px; } }
  `],
})
export class Procesos implements OnInit {
  private readonly api = inject(MonitoreoService);
  private readonly router = inject(Router);

  readonly VB = '0 0 760 560';
  persona = '';

  readonly tab = signal<'grafo' | 'hallazgos' | 'comunicaciones' | 'fragmentos'>('grafo');
  readonly personas = signal<ProcPersona[]>([]);
  readonly grafo = signal<ProcGrafo | null>(null);
  readonly hallazgos = signal<Hallazgo[]>([]);
  readonly comunicaciones = signal<Comunicacion[]>([]);
  readonly fragmentos = signal<Fragmento[]>([]);
  readonly selNodo = signal<NodoPos | null>(null);
  readonly levantando = signal(false);
  readonly aviso = signal<string | null>(null);

  readonly lienzo = computed<Lienzo>(() => this.construir(this.grafo()));

  ngOnInit(): void {
    this.api.procPersonas().subscribe({ next: p => this.personas.set(p), error: () => {} });
    this.cargar();
  }

  cambiarPersona(p: string): void { this.persona = p; this.cargar(); }

  cargar(): void {
    const p = this.persona || undefined;
    this.selNodo.set(null);
    this.api.procGrafo(p).subscribe({ next: g => this.grafo.set(g), error: () => this.grafo.set(null) });
    this.api.procHallazgos(p).subscribe({ next: h => this.hallazgos.set(h), error: () => this.hallazgos.set([]) });
    this.api.procComunicaciones(p).subscribe({ next: c => this.comunicaciones.set(c), error: () => this.comunicaciones.set([]) });
    this.api.procFragmentos(p).subscribe({ next: f => this.fragmentos.set(f), error: () => this.fragmentos.set([]) });
  }

  levantar(): void {
    this.levantando.set(true);
    this.api.procLevantar().subscribe({
      next: () => { this.flash('Proceso levantado'); this.levantando.set(false); this.cargar(); },
      error: () => { this.flash('No se pudo levantar'); this.levantando.set(false); },
    });
  }

  // ── Layout del grafo (categorías en anillo interior, apps en el exterior) ──
  private construir(g: ProcGrafo | null): Lienzo {
    const cx = 380, cy = 270;
    if (!g || !g.nodos?.length) return { nodos: [], aristas: [], vacio: true };
    const cats = g.nodos.filter(n => n.tipo === 'CATEGORIA').sort((a, b) => b.peso - a.peso);
    const apps = g.nodos.filter(n => n.tipo === 'APP').sort((a, b) => b.peso - a.peso).slice(0, 26);
    const maxCat = Math.max(1, ...cats.map(n => n.peso));
    const maxApp = Math.max(1, ...apps.map(n => n.peso));
    const pos = new Map<string, NodoPos>();
    const color = new Map<string, string>();
    cats.forEach((n, i) => color.set(n.clave, PALETA[i % PALETA.length]));

    const Ri = cats.length > 1 ? 130 : 0, Ro = 225;
    cats.forEach((n, i) => {
      const ang = (-Math.PI / 2) + (2 * Math.PI * i) / Math.max(1, cats.length);
      const p: NodoPos = {
        clave: n.clave, etiqueta: n.etiqueta || n.clave, tipo: 'CATEGORIA',
        x: cx + Ri * Math.cos(ang), y: cy + Ri * Math.sin(ang),
        r: 14 + 24 * (n.peso / maxCat), color: color.get(n.clave)!, peso: n.peso, veces: n.veces,
      };
      pos.set(n.clave, p);
    });
    apps.forEach((n, i) => {
      const ang = (-Math.PI / 2) + (2 * Math.PI * i) / Math.max(1, apps.length);
      // Hereda el color de la categoría que más la usa.
      const usa = (g.aristas || []).filter(a => a.tipo === 'USA' && a.hacia === n.clave).sort((a, b) => b.peso - a.peso)[0];
      const col = usa && color.get(usa.desde) ? color.get(usa.desde)! : '#64748b';
      pos.set(n.clave, {
        clave: n.clave, etiqueta: n.etiqueta || n.clave, tipo: 'APP',
        x: cx + Ro * Math.cos(ang), y: cy + Ro * Math.sin(ang),
        r: 7 + 12 * (n.peso / maxApp), color: col, peso: n.peso, veces: n.veces,
      });
    });

    const maxCon = Math.max(1, ...(g.aristas || []).map(a => a.conteo));
    const aristas: AristaPos[] = [];
    for (const a of g.aristas || []) {
      const d = pos.get(a.desde), h = pos.get(a.hacia);
      if (!d || !h) continue;
      const w = 1 + 4 * (a.conteo / maxCon);
      let path: string;
      if (a.tipo === 'SECUENCIA') {
        const mx = (d.x + h.x) / 2, my = (d.y + h.y) / 2;
        const nx = -(h.y - d.y), ny = (h.x - d.x);
        const len = Math.hypot(nx, ny) || 1;
        path = `M ${d.x} ${d.y} Q ${mx + (nx / len) * 26} ${my + (ny / len) * 26} ${h.x} ${h.y}`;
      } else {
        path = `M ${d.x} ${d.y} L ${h.x} ${h.y}`;
      }
      aristas.push({ x1: d.x, y1: d.y, x2: h.x, y2: h.y, tipo: a.tipo, w, path, conteo: a.conteo });
    }
    // Dibujar primero las "USA" (fondo) y luego las "SECUENCIA".
    aristas.sort((a, b) => (a.tipo === 'USA' ? 0 : 1) - (b.tipo === 'USA' ? 0 : 1));
    return { nodos: [...pos.values()], aristas, vacio: false };
  }

  etiquetaCorta(n: NodoPos): string {
    const t = n.etiqueta || n.clave;
    return t.length > 18 ? t.slice(0, 17) + '…' : t;
  }
  horas(seg: number): string {
    if (seg >= 3600) return (seg / 3600).toFixed(1) + ' h';
    if (seg >= 60) return Math.round(seg / 60) + ' min';
    return Math.round(seg) + ' s';
  }
  iconoCanal(canal: string): string {
    switch (canal) { case 'CHAT': return 'chat'; case 'REUNION': return 'videocam'; case 'LLAMADA': return 'call'; default: return 'mail'; }
  }
  etiquetaOrigen(o: string): string {
    switch (o) { case 'DOC': return 'DOCUMENTO'; case 'TECLA': return 'TECLEADO'; case 'SELECCION': return 'SELECCIÓN'; default: return 'PORTAPAPELES'; }
  }

  volver(): void { this.router.navigate(['/dashboard/monitoreo-equipos']); }
  private flash(m: string): void { this.aviso.set(m); setTimeout(() => this.aviso.set(null), 3000); }
}
