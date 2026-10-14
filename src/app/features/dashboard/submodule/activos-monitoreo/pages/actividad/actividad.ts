import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

import { EndpointMon, MonitoreoService } from '../../monitoreo.service';
import { ActividadService, PerfilActividad, ResumenActividad } from '../../actividad/actividad.service';

const COLOR_CAT: Record<string, string> = {
  CORREO: '#2563eb', NAVEGACION: '#0ea5e9', OFIMATICA: '#16a34a', DESARROLLO: '#7c3aed',
  PLATAFORMA: '#ea580c', COMUNICACION: '#db2777', DISENO: '#d97706', MULTIMEDIA: '#9333ea',
  SISTEMA: '#64748b', OTRO: '#94a3b8',
};

/**
 * Gráficas de actividad por usuario: en qué pasa el tiempo (categorías), a qué horas (horas pico),
 * qué apps, y el MAPA DE PROCESO (transiciones). Más el perfil que redacta la IA — "qué hace a
 * diario" — pensado para entender el proceso funcional y, luego, que un agente ayude a operarlo.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-actividad',
  imports: [CommonModule, FormsModule, MatIconModule],
  template: `
    <div class="act">
      <header class="act__cab">
        <h1><mat-icon>insights</mat-icon> Actividad y proceso</h1>
        <span class="act__flex"></span>
        <select [(ngModel)]="endpointId" (ngModelChange)="cargar()">
          <option [ngValue]="null">Elige un equipo…</option>
          @for (e of endpoints(); track e.id) { <option [ngValue]="e.id">{{ e.hostname || e.machineUid }} · {{ e.usuarioActivo || '—' }}</option> }
        </select>
        <input type="date" [(ngModel)]="desde" (ngModelChange)="cargar()">
        <input type="date" [(ngModel)]="hasta" (ngModelChange)="cargar()">
        <button class="btn" (click)="recalcular()" title="Recalcular agregados del día anterior"><mat-icon>sync</mat-icon></button>
      </header>

      @if (!endpointId) { <p class="act__vacio">Elige un equipo para ver su actividad.</p> }
      @else if (cargando()) { <p class="act__vacio"><mat-icon class="girar">progress_activity</mat-icon> Cargando…</p> }
      @else if (resumen(); as r) {
        <div class="act__tiles">
          <div class="tile"><span class="n">{{ horas(r.totalSegundos) }}</span><span class="l">Tiempo total</span></div>
          <div class="tile"><span class="n">{{ r.categorias.length }}</span><span class="l">Categorías</span></div>
          <div class="tile"><span class="n">{{ r.transiciones.length }}</span><span class="l">Transiciones</span></div>
        </div>

        <div class="act__grid">
          <section class="card">
            <h2>Horas pico</h2>
            <div class="horas">
              @for (h of r.horasPico; track h.hora) {
                <div class="hbar" [title]="h.hora + 'h · ' + min(h.segundos) + ' min'">
                  <div class="hbar__fill" [style.height.%]="altura(h.segundos, maxHora(r))"></div>
                  <span class="hbar__lbl">{{ h.hora }}</span>
                </div>
              }
            </div>
          </section>

          <section class="card">
            <h2>En qué pasa el tiempo</h2>
            @for (c of r.categorias; track c.categoria) {
              <div class="brow">
                <span class="brow__lbl">{{ c.categoria }}</span>
                <div class="brow__track"><div class="brow__fill" [style.width.%]="c.pct" [style.background]="color(c.categoria)"></div></div>
                <span class="brow__val">{{ c.pct }}% · {{ horas(c.segundos) }}</span>
              </div>
            }
            @if (!r.categorias.length) { <p class="act__vacio">Sin datos de uso en el periodo.</p> }
          </section>

          <section class="card">
            <h2>Aplicaciones</h2>
            @for (a of r.topApps; track a.app) {
              <div class="brow">
                <span class="brow__lbl">{{ a.app }}</span>
                <div class="brow__track"><div class="brow__fill" [style.width.%]="altura(a.segundos, maxApp(r))" style="background:#334155"></div></div>
                <span class="brow__val">{{ horas(a.segundos) }}</span>
              </div>
            }
            @if (!r.topApps.length) { <p class="act__vacio">Sin apps registradas.</p> }
          </section>

          <section class="card">
            <h2>Mapa de proceso</h2>
            <div class="nodos">
              @for (c of r.categorias; track c.categoria) {
                <span class="nodo" [style.background]="color(c.categoria)" [style.opacity]="0.4 + 0.6 * c.pct / 100">{{ c.categoria }}</span>
              }
            </div>
            <div class="aristas">
              @for (t of r.transiciones.slice(0, 12); track t.desde + t.hacia) {
                <div class="arista"><b>{{ t.desde }}</b> <mat-icon>arrow_forward</mat-icon> <b>{{ t.hacia }}</b> <span>×{{ t.conteo }}</span></div>
              }
              @if (!r.transiciones.length) { <p class="act__vacio">Aún no hay transiciones (hace falta más uso).</p> }
            </div>
          </section>
        </div>

        <section class="card">
          <h2>Perfil del proceso (IA)
            <button class="link" (click)="generarPerfil()" [disabled]="generando()">{{ generando() ? 'Generando…' : 'Generar con IA' }}</button>
          </h2>
          @if (perfil(); as p) {
            <p class="narrativa">{{ p.narrativa || 'Sin perfil todavía. Pulsa "Generar con IA".' }}</p>
            @for (proc of p.procesos; track $index) {
              <div class="proc"><mat-icon>account_tree</mat-icon><div><b>{{ proc['nombre'] }}</b><p>{{ proc['descripcion'] }}</p></div></div>
            }
            @if (p.generado) { <p class="act__meta">Generado: {{ p.generado | date:'short' }}</p> }
          } @else { <p class="narrativa">Sin perfil todavía. Pulsa "Generar con IA" para que describa el proceso de este usuario.</p> }
        </section>
      }
      @if (aviso()) { <div class="act__aviso">{{ aviso() }}</div> }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .act { padding: 12px 16px; color: var(--text, #0f1b2d); }
    .act__cab { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .act__cab h1 { font-size: 18px; font-weight: 800; display: flex; align-items: center; gap: 8px; margin: 0; }
    .act__flex { flex: 1; }
    .act__cab select, .act__cab input { padding: 7px 9px; border: 1px solid var(--border, #cbd5e1); border-radius: 8px; font-size: 13px; }
    .btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border, #cbd5e1); background: var(--surface, #fff); color: inherit; border-radius: 10px; padding: 7px 10px; min-height: 40px; cursor: pointer; }
    .btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .link { border: 0; background: transparent; color: var(--brand-blue, #2b59f0); cursor: pointer; font-weight: 700; font-size: 12px; margin-left: 8px; }
    .act__vacio { color: #94a3b8; font-size: 14px; display: flex; align-items: center; gap: 6px; padding: 12px 0; }
    .girar { animation: actg 1s linear infinite; } @keyframes actg { to { transform: rotate(360deg); } }
    .act__tiles { display: flex; gap: 10px; margin: 12px 0; flex-wrap: wrap; }
    .tile { background: var(--surface, #fff); border: 1px solid var(--border, #e2e8f0); border-radius: 12px; padding: 10px 14px; }
    .tile .n { font-size: 22px; font-weight: 800; display: block; } .tile .l { font-size: 12px; color: #64748b; }
    .act__grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .card { background: var(--surface, #fff); border: 1px solid var(--border, #e2e8f0); border-radius: 12px; padding: 12px 14px; }
    .card h2 { font-size: 14px; margin: 0 0 10px; display: flex; align-items: center; }
    .horas { display: flex; align-items: flex-end; gap: 2px; height: 120px; }
    .hbar { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; }
    .hbar__fill { width: 70%; min-height: 1px; background: var(--brand-blue, #2b59f0); border-radius: 3px 3px 0 0; }
    .hbar__lbl { font-size: 8px; color: #94a3b8; margin-top: 2px; }
    .brow { display: grid; grid-template-columns: 120px 1fr auto; gap: 8px; align-items: center; margin: 5px 0; font-size: 12px; }
    .brow__lbl { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 700; }
    .brow__track { background: #f1f5f9; border-radius: 6px; height: 12px; overflow: hidden; }
    .brow__fill { height: 100%; border-radius: 6px; min-width: 2px; }
    .brow__val { color: #475569; white-space: nowrap; }
    .nodos { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .nodo { color: #fff; border-radius: 999px; padding: 3px 10px; font-size: 11px; font-weight: 800; }
    .aristas { display: flex; flex-direction: column; gap: 3px; }
    .arista { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #334155; }
    .arista mat-icon { font-size: 14px; width: 14px; height: 14px; color: #94a3b8; }
    .arista span { color: #94a3b8; margin-left: auto; }
    .narrativa { font-size: 13px; line-height: 1.5; }
    .proc { display: flex; gap: 8px; align-items: flex-start; margin: 6px 0; font-size: 12px; }
    .proc mat-icon { color: var(--brand-blue, #2b59f0); } .proc p { margin: 1px 0 0; color: #475569; }
    .act__meta { font-size: 11px; color: #94a3b8; }
    .act__aviso { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); background: #0f172a; color: #fff; padding: 8px 16px; border-radius: 999px; font-size: 13px; }
    @media (max-width: 900px) { .act__grid { grid-template-columns: 1fr; } }
  `],
})
export class Actividad implements OnInit {
  private readonly api = inject(ActividadService);
  private readonly mon = inject(MonitoreoService);

  readonly endpoints = signal<EndpointMon[]>([]);
  readonly resumen = signal<ResumenActividad | null>(null);
  readonly perfil = signal<PerfilActividad | null>(null);
  readonly cargando = signal(false);
  readonly generando = signal(false);
  readonly aviso = signal<string | null>(null);

  endpointId: number | null = null;
  desde = this.haceDias(6);
  hasta = this.hoy();

  ngOnInit(): void {
    this.mon.endpoints().subscribe({ next: l => this.endpoints.set(l), error: () => {} });
  }

  cargar(): void {
    if (!this.endpointId) return;
    this.cargando.set(true);
    this.perfil.set(null);
    this.api.resumen(this.endpointId, this.desde, this.hasta).subscribe({
      next: r => { this.resumen.set(r); this.cargando.set(false); },
      error: () => { this.resumen.set(null); this.cargando.set(false); },
    });
    this.api.perfil(this.endpointId).subscribe({ next: p => this.perfil.set(p), error: () => {} });
  }

  recalcular(): void {
    this.api.recalcular().subscribe({ next: r => { this.flash(`Recalculado (${r.equipos} equipos)`); this.cargar(); }, error: () => this.flash('No se pudo recalcular') });
  }

  generarPerfil(): void {
    if (!this.endpointId) return;
    this.generando.set(true);
    this.api.generarPerfil(this.endpointId, this.desde, this.hasta).subscribe({
      next: p => { this.perfil.set(p); this.generando.set(false); },
      error: () => { this.generando.set(false); this.flash('No se pudo generar el perfil'); },
    });
  }

  color(cat: string): string { return COLOR_CAT[cat] ?? COLOR_CAT['OTRO']; }
  horas(seg: number): string { const h = seg / 3600; return h >= 1 ? h.toFixed(1) + ' h' : Math.round(seg / 60) + ' min'; }
  min(seg: number): number { return Math.round(seg / 60); }
  altura(v: number, max: number): number { return max > 0 ? Math.round(v * 100 / max) : 0; }
  maxHora(r: ResumenActividad): number { return Math.max(1, ...r.horasPico.map(h => h.segundos)); }
  maxApp(r: ResumenActividad): number { return Math.max(1, ...r.topApps.map(a => a.segundos)); }

  private flash(m: string): void { this.aviso.set(m); setTimeout(() => this.aviso.set(null), 3000); }
  private hoy(): string { return new Date().toISOString().slice(0, 10); }
  private haceDias(n: number): string { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }
}
