import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router } from '@angular/router';

import { MonitoreoService, ProcGrafo, ReporteEquipo } from '../../monitoreo.service';

interface NodoPos { clave: string; etiqueta: string; tipo: string; x: number; y: number; r: number; color: string; }
interface AristaPos { tipo: string; w: number; path: string; }
const PALETA = ['#2b59f0', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5'];

/**
 * Reporte integral de un equipo: TODO lo que se ve del PC en una página — identidad, dueño, foto,
 * inventario, disponibilidad (CPU/RAM), política/consentimiento, actividad, perfil IA, grafo de
 * proceso, hallazgos, comunicaciones, documentos, auditorías, eventos, capturas y procesos.
 * Imprimible/PDF con el botón (window.print).
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-reporte-equipo',
  imports: [CommonModule, FormsModule, MatIconModule],
  template: `
    <div class="rep">
      <header class="rep__barra no-print">
        <button class="ico" (click)="volver()" title="Volver"><mat-icon>arrow_back</mat-icon></button>
        <h1><mat-icon>summarize</mat-icon> Reporte del equipo</h1>
        <span class="rep__flex"></span>
        <label>Desde <input type="date" [(ngModel)]="desde"></label>
        <label>Hasta <input type="date" [(ngModel)]="hasta"></label>
        <button class="btn" (click)="cargar()"><mat-icon>refresh</mat-icon> Actualizar</button>
        <button class="btn btn--primario" (click)="imprimir()"><mat-icon>print</mat-icon> Imprimir / PDF</button>
      </header>

      @if (cargando()) { <p class="info">Cargando reporte…</p> }
      @else if (!r()) { <p class="info">No se pudo cargar el reporte.</p> }
      @else if (r(); as d) {
        <!-- Portada -->
        <section class="card portada">
          <div class="foto">
            @if (fotoUrl()) { <img [src]="fotoUrl()" alt="equipo"> } @else { <div class="foto__ph"><mat-icon>computer</mat-icon></div> }
          </div>
          <div class="portada__cab">
            <h2>{{ d.endpoint.hostname || d.endpoint.machineUid }}
              <span class="badge" [class]="'b--' + d.endpoint.estado.toLowerCase()">{{ d.endpoint.estado }}</span>
            </h2>
            <p class="dim">{{ d.endpoint.so }} {{ d.endpoint.soVersion }} · {{ d.endpoint.cpu }} · {{ ram(d.endpoint.ramMb) }}</p>
            <div class="kv">
              <div><span>Dueño</span><b>{{ d.endpoint.responsableNombre || '—' }}@if (d.endpoint.responsableDoc) { <small> · {{ d.endpoint.responsableDoc }}</small> }</b></div>
              <div><span>Usuario del equipo</span><b>{{ d.endpoint.usuarioActivo || '—' }}</b></div>
              <div><span>IP LAN</span><b>{{ d.endpoint.ipLan || '—' }}</b></div>
              <div><span>Último latido</span><b>{{ d.endpoint.ultimoLatido ? (d.endpoint.ultimoLatido | date:'short') : 'nunca' }}</b></div>
              <div><span>Machine UID</span><b class="mono">{{ d.endpoint.machineUid }}</b></div>
              <div><span>Enrolado</span><b>{{ d.endpoint.enroladoEn ? (d.endpoint.enroladoEn | date:'short') : '—' }}</b></div>
            </div>
            <p class="dim">Reporte {{ d.desde | date:'mediumDate' }} → {{ d.hasta | date:'mediumDate' }} · generado {{ d.generado | date:'short' }}</p>
          </div>
        </section>

        <!-- Disponibilidad / métricas -->
        <section class="card">
          <h3><mat-icon>monitor_heart</mat-icon> Disponibilidad y rendimiento</h3>
          <div class="metr">
            <div class="metr__kpis">
              <div class="kpi"><span class="n">{{ d.metricas.onlinePct }}%</span><span class="l">Tiempo encendido</span></div>
              <div class="kpi"><span class="n">{{ d.metricas.muestras }}</span><span class="l">Latidos</span></div>
              <div class="kpi"><span class="n" [style.color]="colorCpu(d)">{{ ultimoCpu(d) }}</span><span class="l">CPU actual</span></div>
              <div class="kpi"><span class="n">{{ ultimoRam(d) }}</span><span class="l">RAM actual</span></div>
            </div>
            @if (d.metricas.serie.length > 1) {
              <svg viewBox="0 0 300 70" class="spark" preserveAspectRatio="none">
                <polyline [attr.points]="serie(d,'cpu')" fill="none" stroke="#2b59f0" stroke-width="1.5"></polyline>
                <polyline [attr.points]="serie(d,'ram')" fill="none" stroke="#16a34a" stroke-width="1.5"></polyline>
              </svg>
              <div class="spark__leg"><span><i style="background:#2b59f0"></i> CPU %</span><span><i style="background:#16a34a"></i> RAM %</span></div>
            } @else { <p class="vacio">Sin serie de métricas en el rango.</p> }
          </div>
        </section>

        <!-- Inventario -->
        @if (d.inventario?.hardware; as hw) {
          <section class="card">
            <h3><mat-icon>memory</mat-icon> Inventario</h3>
            <div class="kv kv--grid">
              <div><span>CPU</span><b>{{ hw['cpu'] || d.endpoint.cpu }}</b></div>
              <div><span>Núcleos</span><b>{{ hw['nucleos'] }}</b></div>
              <div><span>RAM</span><b>{{ ram(asNum(hw['ramMb'])) }}</b></div>
              <div><span>SO</span><b>{{ hw['so'] }} {{ hw['soVersion'] }}</b></div>
              <div><span>Arquitectura</span><b>{{ hw['arquitectura'] }}</b></div>
              <div><span>Hostname</span><b>{{ hw['hostname'] }}</b></div>
            </div>
          </section>
        }

        <!-- Política y consentimiento -->
        @if (d.politica; as p) {
          <section class="card">
            <h3><mat-icon>policy</mat-icon> Política de recolección y consentimiento</h3>
            <div class="chips">
              <span class="chip" [class.on]="p.capInventario">Inventario</span>
              <span class="chip" [class.on]="p.capProcesos">Procesos</span>
              <span class="chip" [class.on]="p.capUso">Uso/actividad</span>
              <span class="chip" [class.on]="p.capEventos">Eventos</span>
              <span class="chip" [class.on]="p.capCaptura">Capturas</span>
              <span class="chip" [class.on]="p.capTexto">Texto/portapapeles</span>
              <span class="chip" [class.on]="p.guardarTitulos">Guardar títulos</span>
            </div>
            <p class="dim">Retención: {{ p.retencionDias }} días.
              @if (d.consentimiento) { Consentimiento aceptado {{ d.consentimiento.aceptadoEn | date:'short' }} (v{{ d.consentimiento.versionTxt }}). }
              @else { Sin registro de consentimiento. }</p>
          </section>
        }

        <!-- Actividad -->
        @if (d.actividad; as a) {
          <section class="card">
            <h3><mat-icon>insights</mat-icon> Actividad del periodo <small>{{ horas(a.totalSegundos) }} en total</small></h3>
            <div class="dos">
              <div>
                <h4>Categorías de trabajo</h4>
                @for (c of a.categorias; track c.categoria) {
                  <div class="barra"><span class="barra__l">{{ c.categoria }}</span>
                    <span class="barra__t"><i [style.width.%]="c.pct" [style.background]="catColor($index)"></i></span>
                    <span class="barra__v">{{ c.pct }}% · {{ horas(c.segundos) }}</span></div>
                }
                @if (!a.categorias?.length) { <p class="vacio">Sin actividad clasificada.</p> }
              </div>
              <div>
                <h4>Horas pico</h4>
                <div class="horas">
                  @for (h of a.horasPico; track h.hora) {
                    <span class="hbar" [style.height.%]="hpct(a, h.segundos)" [title]="h.hora + 'h'"></span>
                  }
                </div>
                <h4>Apps más usadas</h4>
                <ol class="apps">
                  @for (ap of topApps(a); track ap.app) { <li>{{ ap.app }} <small>{{ horas(ap.segundos) }}</small></li> }
                </ol>
              </div>
            </div>
          </section>
        }

        <!-- Perfil IA -->
        @if (d.perfil?.narrativa) {
          <section class="card">
            <h3><mat-icon>smart_toy</mat-icon> Perfil de proceso (IA)</h3>
            <p>{{ d.perfil.narrativa }}</p>
            @for (pr of d.perfil.procesos; track $index) {
              <div class="proc"><b>{{ pr['nombre'] }}</b> — {{ pr['descripcion'] }}</div>
            }
          </section>
        }

        <!-- Grafo de proceso -->
        <section class="card break">
          <h3><mat-icon>hub</mat-icon> Grafo de proceso <small>{{ d.grafo?.nodos?.length || 0 }} nodos</small></h3>
          @if (lienzo().nodos.length) {
            <svg viewBox="0 0 760 540" class="grafo" preserveAspectRatio="xMidYMid meet">
              @for (a of lienzo().aristas; track $index) {
                <path [attr.d]="a.path" [attr.stroke]="a.tipo === 'SECUENCIA' ? '#94a3b8' : '#cbd5e1'" [attr.stroke-width]="a.w"
                      fill="none" [attr.stroke-dasharray]="a.tipo !== 'SECUENCIA' ? '4 4' : ''" opacity="0.5"></path>
              }
              @for (n of lienzo().nodos; track n.clave) {
                <g>
                  <circle [attr.cx]="n.x" [attr.cy]="n.y" [attr.r]="n.r" [attr.fill]="n.color"
                          [attr.fill-opacity]="n.tipo === 'CATEGORIA' ? 0.9 : 0.45" [attr.stroke]="n.color"></circle>
                  <text [attr.x]="n.x" [attr.y]="n.y + n.r + 11" text-anchor="middle" class="g-et">{{ corta(n.etiqueta) }}</text>
                </g>
              }
            </svg>
          } @else { <p class="vacio">Sin grafo todavía. Usa "Levantar ahora" en Procesos o espera la corrida nocturna.</p> }
        </section>

        <!-- Hallazgos -->
        <section class="card">
          <h3><mat-icon>lightbulb</mat-icon> Hallazgos <small>{{ d.hallazgos.length }}</small></h3>
          @for (h of d.hallazgos; track h.id) {
            <div class="hall">
              <span class="tag">{{ h.tipo }}</span> <b>{{ h.titulo }}</b>
              @if (h.detalle) { <p>{{ h.detalle }}</p> }
              <small class="fuente"><mat-icon>my_location</mat-icon> {{ h.fuente || 'origen no registrado' }} @if (h.fechaFuente) { · {{ h.fechaFuente | date:'short' }} }</small>
            </div>
          }
          @if (!d.hallazgos.length) { <p class="vacio">Sin hallazgos.</p> }
        </section>

        <!-- Comunicaciones -->
        <section class="card">
          <h3><mat-icon>forum</mat-icon> Comunicaciones <small>{{ d.comunicaciones.length }}</small></h3>
          @for (c of d.comunicaciones; track c.id) {
            <div class="linea"><mat-icon class="mi">{{ iconoCanal(c.canal) }}</mat-icon>
              <b>{{ c.deNombre || '—' }}</b>@if (c.destino) { <span class="fl">→ {{ c.destino }}</span> }
              <span class="asunto">{{ c.asunto }}</span>
              <span class="ts">{{ c.ts ? (c.ts | date:'short') : '' }}</span></div>
          }
          @if (!d.comunicaciones.length) { <p class="vacio">Sin comunicaciones detectadas.</p> }
        </section>

        <!-- Documentos y datos -->
        <section class="card">
          <h3><mat-icon>content_paste</mat-icon> Documentos y datos <small>{{ d.fragmentos.length }}</small></h3>
          @for (f of d.fragmentos; track f.id) {
            <div class="linea"><span class="tag">{{ etiquetaOrigen(f.origen) }}</span>
              <span class="asunto">{{ f.resumen || '(sin texto)' }}</span>
              @if (f.sensible) { <mat-icon class="mi" style="color:#dc2626">lock</mat-icon> }
              <span class="ts">{{ f.app }} · {{ f.ts ? (f.ts | date:'short') : '' }}</span></div>
          }
          @if (!d.fragmentos.length) { <p class="vacio">Sin datos capturados (requiere la capa de texto activa).</p> }
        </section>

        <!-- Auditorías -->
        <section class="card">
          <h3><mat-icon>fact_check</mat-icon> Auditorías nocturnas <small>{{ d.auditorias.length }}</small></h3>
          @for (a of d.auditorias; track a.id) {
            <div class="aud" [class]="'aud--' + a.severidad.toLowerCase()">
              <b>{{ a.fecha }}</b> <span class="sev">{{ a.severidad }}</span>
              <p>{{ a.resumen }}</p>
            </div>
          }
          @if (!d.auditorias.length) { <p class="vacio">Sin auditorías.</p> }
        </section>

        <!-- Eventos -->
        <section class="card">
          <h3><mat-icon>bolt</mat-icon> Eventos del equipo <small>{{ d.eventos.length }}</small></h3>
          <div class="eventos">
            @for (e of d.eventos; track $index) {
              <span class="ev"><b>{{ e.tipo }}</b> {{ e.ts | date:'short' }}</span>
            }
          </div>
          @if (!d.eventos.length) { <p class="vacio">Sin eventos registrados.</p> }
        </section>

        <!-- Capturas -->
        @if (d.capturas.length) {
          <section class="card">
            <h3><mat-icon>photo_camera</mat-icon> Capturas de pantalla <small>{{ d.capturas.length }}</small></h3>
            @for (c of d.capturas; track $index) {
              <div class="linea"><span class="asunto">{{ c.motivo || 'Captura' }}</span>
                <span class="ts">{{ c.porUsuario }} · {{ c.ts | date:'short' }} · ref {{ c.docRef }}</span></div>
            }
          </section>
        }

        <!-- Procesos -->
        @if (d.procesosUltimo; as pu) {
          <section class="card">
            <h3><mat-icon>list_alt</mat-icon> Procesos (última foto) <small>{{ pu.total }} en total · {{ pu.ts | date:'short' }}</small></h3>
            <table class="tabla">
              <thead><tr><th>Proceso</th><th>PID</th><th>Mem</th></tr></thead>
              <tbody>
                @for (p of pu.top; track $index) { <tr><td>{{ p.name }}</td><td>{{ p.pid }}</td><td>{{ p.mem }}</td></tr> }
              </tbody>
            </table>
          </section>
        }
      }
      @if (aviso()) { <div class="aviso no-print">{{ aviso() }}</div> }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .rep { padding: 12px 16px; color: var(--text, #0f1b2d); max-width: 980px; margin: 0 auto; }
    .rep__barra { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; position: sticky; top: 0; background: var(--bg, #f1f5f9); padding: 6px 0; z-index: 5; }
    .rep__barra h1 { font-size: 18px; font-weight: 800; display: flex; align-items: center; gap: 8px; margin: 0; }
    .rep__barra label { font-size: 12px; color: #64748b; display: flex; flex-direction: column; }
    .rep__barra input { padding: 5px 7px; border: 1px solid var(--border, #cbd5e1); border-radius: 8px; }
    .rep__flex { flex: 1; }
    .ico { border: 1px solid var(--border, #cbd5e1); background: var(--surface, #fff); border-radius: 10px; width: 40px; height: 40px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; color: inherit; }
    .btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border, #cbd5e1); background: var(--surface, #fff); color: inherit; border-radius: 10px; padding: 6px 12px; min-height: 40px; cursor: pointer; font-weight: 700; font-size: 13px; }
    .btn--primario { background: var(--brand-blue, #2b59f0); color: #fff; border-color: transparent; }
    .btn mat-icon, .ico mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .info { color: #64748b; padding: 24px 0; }
    .card { background: var(--surface, #fff); border: 1px solid var(--border, #e2e8f0); border-radius: 12px; padding: 14px; margin: 12px 0; }
    .card h3 { font-size: 14px; margin: 0 0 10px; display: flex; align-items: center; gap: 6px; }
    .card h3 mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--brand-blue, #2b59f0); }
    .card h3 small { color: #94a3b8; font-weight: 600; margin-left: auto; }
    .card h4 { font-size: 12px; color: #64748b; margin: 10px 0 6px; text-transform: uppercase; letter-spacing: .3px; }
    .portada { display: flex; gap: 16px; align-items: flex-start; }
    .foto { width: 110px; height: 110px; flex: none; border-radius: 12px; overflow: hidden; border: 1px solid var(--border, #e2e8f0); }
    .foto img { width: 100%; height: 100%; object-fit: cover; }
    .foto__ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #e2e8f0; color: #94a3b8; }
    .foto__ph mat-icon { font-size: 44px; width: 44px; height: 44px; }
    .portada__cab { flex: 1; min-width: 0; }
    .portada__cab h2 { margin: 0 0 2px; font-size: 18px; display: flex; align-items: center; gap: 8px; }
    .dim { font-size: 12px; color: #64748b; margin: 2px 0; }
    .badge { font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 999px; background: #e2e8f0; color: #475569; }
    .b--online { background: #dcfce7; color: #15803d; } .b--offline { background: #e2e8f0; color: #64748b; }
    .b--inactivo { background: #fef3c7; color: #b45309; } .b--alerta { background: #fee2e2; color: #b91c1c; }
    .kv { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 16px; margin: 8px 0; }
    .kv--grid { grid-template-columns: repeat(3, 1fr); }
    .kv > div { display: flex; flex-direction: column; font-size: 13px; }
    .kv span { font-size: 11px; color: #94a3b8; } .kv b { font-weight: 700; } .mono { font-family: monospace; font-size: 11px; word-break: break-all; }
    .metr__kpis { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
    .kpi { flex: 1; min-width: 90px; background: var(--muted, #f8fafc); border-radius: 10px; padding: 8px 10px; display: flex; flex-direction: column; }
    .kpi .n { font-size: 20px; font-weight: 800; } .kpi .l { font-size: 11px; color: #64748b; }
    .spark { width: 100%; height: 70px; } .spark__leg { display: flex; gap: 14px; font-size: 11px; color: #64748b; }
    .spark__leg i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; vertical-align: middle; margin-right: 3px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 999px; background: #f1f5f9; color: #94a3b8; border: 1px solid transparent; }
    .chip.on { background: #eff6ff; color: #2b59f0; border-color: #bfdbfe; }
    .dos { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .barra { display: grid; grid-template-columns: 110px 1fr auto; gap: 8px; align-items: center; font-size: 12px; margin: 3px 0; }
    .barra__l { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .barra__t { background: #f1f5f9; border-radius: 6px; height: 12px; overflow: hidden; }
    .barra__t i { display: block; height: 100%; border-radius: 6px; }
    .barra__v { color: #64748b; white-space: nowrap; }
    .horas { display: flex; align-items: flex-end; gap: 2px; height: 56px; background: var(--muted, #f8fafc); border-radius: 8px; padding: 4px; }
    .hbar { flex: 1; background: #2b59f0; border-radius: 2px 2px 0 0; min-height: 1px; opacity: .8; }
    .apps { margin: 0; padding-left: 18px; font-size: 13px; } .apps small { color: #94a3b8; }
    .proc { font-size: 13px; margin: 4px 0; }
    .grafo { width: 100%; height: auto; max-height: 60vh; }
    .g-et { font-size: 10px; fill: #334155; }
    .hall { border-left: 3px solid #d97706; padding: 4px 10px; margin: 6px 0; background: var(--muted, #f8fafc); border-radius: 0 8px 8px 0; }
    .hall p { margin: 3px 0; font-size: 13px; }
    .tag { font-size: 10px; font-weight: 800; background: #e2e8f0; color: #475569; border-radius: 6px; padding: 2px 6px; }
    .fuente { display: inline-flex; align-items: center; gap: 4px; color: #64748b; font-style: italic; }
    .fuente mat-icon { font-size: 13px; width: 13px; height: 13px; color: #2b59f0; }
    .linea { display: flex; align-items: center; gap: 6px; font-size: 13px; padding: 5px 0; border-bottom: 1px dashed #eef2f7; flex-wrap: wrap; }
    .linea .mi { font-size: 16px; width: 16px; height: 16px; color: #64748b; }
    .linea .fl { color: #64748b; } .linea .asunto { flex: 1; min-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .linea .ts { color: #94a3b8; font-size: 11px; }
    .aud { border-left: 3px solid #cbd5e1; padding: 3px 10px; margin: 6px 0; background: var(--muted, #f8fafc); border-radius: 0 8px 8px 0; font-size: 13px; }
    .aud--aviso { border-left-color: #f59e0b; } .aud--alerta { border-left-color: #ef4444; }
    .aud .sev { font-weight: 800; font-size: 11px; margin-left: 6px; } .aud p { margin: 2px 0; }
    .eventos { display: flex; flex-wrap: wrap; gap: 6px; } .ev { font-size: 12px; background: var(--muted, #f8fafc); border-radius: 8px; padding: 3px 8px; }
    .tabla { width: 100%; border-collapse: collapse; font-size: 12px; }
    .tabla th, .tabla td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #eef2f7; }
    .vacio { color: #94a3b8; font-size: 13px; }
    .aviso { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); background: #0f172a; color: #fff; padding: 8px 16px; border-radius: 999px; font-size: 13px; }
    @media (max-width: 720px) { .dos { grid-template-columns: 1fr; } .kv, .kv--grid { grid-template-columns: 1fr 1fr; } .portada { flex-direction: column; } }
    @media print {
      :host { color: #000; }
      .no-print { display: none !important; }
      .rep { max-width: none; padding: 0; }
      .card { break-inside: avoid; border-color: #ddd; box-shadow: none; margin: 8px 0; }
      .break { break-before: page; }
    }
  `],
})
export class ReporteEquipoPage implements OnInit {
  private readonly api = inject(MonitoreoService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private id = 0;
  desde = '';
  hasta = '';

  readonly r = signal<ReporteEquipo | null>(null);
  readonly fotoUrl = signal<string | null>(null);
  readonly cargando = signal(false);
  readonly aviso = signal<string | null>(null);

  readonly lienzo = computed(() => this.construir(this.r()?.grafo ?? null));

  ngOnInit(): void {
    this.id = Number(this.route.snapshot.paramMap.get('id')) || 0;
    this.cargar();
  }

  cargar(): void {
    if (!this.id) return;
    this.cargando.set(true);
    this.api.reporte(this.id, this.desde || undefined, this.hasta || undefined).subscribe({
      next: d => {
        this.r.set(d);
        this.desde = String(d.desde).slice(0, 10);
        this.hasta = String(d.hasta).slice(0, 10);
        this.cargando.set(false);
        if (d.endpoint?.tieneFoto) this.api.foto(this.id).subscribe({ next: f => this.fotoUrl.set(f.data_url), error: () => {} });
      },
      error: () => { this.cargando.set(false); this.flash('No se pudo cargar el reporte'); },
    });
  }

  imprimir(): void { setTimeout(() => window.print(), 50); }
  volver(): void { this.router.navigate(['/dashboard/monitoreo-equipos']); }

  // ── Métricas ────────────────────────────────────────────────────────
  serie(d: ReporteEquipo, campo: 'cpu' | 'ram'): string {
    const s = d.metricas.serie;
    const n = s.length; if (n < 2) return '';
    return s.map((p, i) => {
      const v = Math.max(0, Math.min(100, Number(p[campo] ?? 0)));
      const x = (i / (n - 1)) * 300;
      const y = 68 - (v / 100) * 64;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }
  ultimoCpu(d: ReporteEquipo): string { const s = d.metricas.serie; const v = s.length ? s[s.length - 1].cpu : null; return v == null ? '—' : Math.round(Number(v)) + '%'; }
  ultimoRam(d: ReporteEquipo): string { const s = d.metricas.serie; const v = s.length ? s[s.length - 1].ram : null; return v == null ? '—' : Math.round(Number(v)) + '%'; }
  colorCpu(d: ReporteEquipo): string { const s = d.metricas.serie; const v = s.length ? Number(s[s.length - 1].cpu ?? 0) : 0; return v > 85 ? '#dc2626' : v > 60 ? '#d97706' : '#16a34a'; }

  // ── Actividad ───────────────────────────────────────────────────────
  topApps(a: { topApps?: Array<{ app: string; segundos: number }> }): Array<{ app: string; segundos: number }> {
    return (a.topApps || []).slice(0, 8);
  }
  hpct(a: { horasPico?: Array<{ segundos: number }> }, seg: number): number {
    const max = Math.max(1, ...(a.horasPico || []).map(h => h.segundos));
    return Math.round((seg / max) * 100);
  }
  catColor(i: number): string { return PALETA[i % PALETA.length]; }

  // ── Grafo (mismo layout que la página Procesos, compacto) ───────────
  private construir(g: ProcGrafo | null): { nodos: NodoPos[]; aristas: AristaPos[] } {
    const cx = 380, cy = 265;
    if (!g || !g.nodos?.length) return { nodos: [], aristas: [] };
    const cats = g.nodos.filter(n => n.tipo === 'CATEGORIA').sort((a, b) => b.peso - a.peso);
    const apps = g.nodos.filter(n => n.tipo !== 'CATEGORIA').sort((a, b) => b.peso - a.peso).slice(0, 26);
    const maxCat = Math.max(1, ...cats.map(n => n.peso));
    const maxApp = Math.max(1, ...apps.map(n => n.peso));
    const color = new Map<string, string>();
    cats.forEach((n, i) => color.set(n.clave, PALETA[i % PALETA.length]));
    const pos = new Map<string, NodoPos>();
    const Ri = cats.length > 1 ? 125 : 0, Ro = 220;
    cats.forEach((n, i) => {
      const ang = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, cats.length);
      pos.set(n.clave, { clave: n.clave, etiqueta: n.etiqueta || n.clave, tipo: 'CATEGORIA',
        x: cx + Ri * Math.cos(ang), y: cy + Ri * Math.sin(ang), r: 14 + 22 * (n.peso / maxCat), color: color.get(n.clave)! });
    });
    apps.forEach((n, i) => {
      const ang = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, apps.length);
      const usa = (g.aristas || []).filter(a => a.hacia === n.clave).sort((a, b) => b.peso - a.peso)[0];
      const col = usa && color.get(usa.desde) ? color.get(usa.desde)! : (n.tipo === 'DOCUMENTO' ? '#9333ea' : '#64748b');
      pos.set(n.clave, { clave: n.clave, etiqueta: n.etiqueta || n.clave, tipo: n.tipo,
        x: cx + Ro * Math.cos(ang), y: cy + Ro * Math.sin(ang), r: 7 + 11 * (n.peso / maxApp), color: col });
    });
    const maxCon = Math.max(1, ...(g.aristas || []).map(a => a.conteo));
    const aristas: AristaPos[] = [];
    for (const a of g.aristas || []) {
      const dd = pos.get(a.desde), hh = pos.get(a.hacia);
      if (!dd || !hh) continue;
      const w = 1 + 3.5 * (a.conteo / maxCon);
      let path: string;
      if (a.tipo === 'SECUENCIA') {
        const mx = (dd.x + hh.x) / 2, my = (dd.y + hh.y) / 2;
        const nx = -(hh.y - dd.y), ny = hh.x - dd.x; const len = Math.hypot(nx, ny) || 1;
        path = `M ${dd.x} ${dd.y} Q ${mx + (nx / len) * 24} ${my + (ny / len) * 24} ${hh.x} ${hh.y}`;
      } else { path = `M ${dd.x} ${dd.y} L ${hh.x} ${hh.y}`; }
      aristas.push({ tipo: a.tipo, w, path });
    }
    aristas.sort((a, b) => (a.tipo === 'SECUENCIA' ? 1 : 0) - (b.tipo === 'SECUENCIA' ? 1 : 0));
    return { nodos: [...pos.values()], aristas };
  }

  // ── Utilidades ──────────────────────────────────────────────────────
  corta(t: string): string { return t && t.length > 16 ? t.slice(0, 15) + '…' : t; }
  horas(seg: number): string {
    seg = Number(seg) || 0;
    if (seg >= 3600) return (seg / 3600).toFixed(1) + ' h';
    if (seg >= 60) return Math.round(seg / 60) + ' min';
    return Math.round(seg) + ' s';
  }
  ram(mb: number | null | undefined): string { return mb ? Math.round(Number(mb) / 1024) + ' GB RAM' : '—'; }
  asNum(v: unknown): number | null { const n = Number(v); return isNaN(n) ? null : n; }
  iconoCanal(canal: string): string {
    switch (canal) { case 'CHAT': return 'chat'; case 'REUNION': return 'videocam'; case 'LLAMADA': return 'call'; default: return 'mail'; }
  }
  etiquetaOrigen(o: string): string {
    switch (o) { case 'DOC': return 'DOCUMENTO'; case 'TECLA': return 'TECLEADO'; case 'SELECCION': return 'SELECCIÓN'; default: return 'PORTAPAPELES'; }
  }
  private flash(m: string): void { this.aviso.set(m); setTimeout(() => this.aviso.set(null), 3000); }
}
