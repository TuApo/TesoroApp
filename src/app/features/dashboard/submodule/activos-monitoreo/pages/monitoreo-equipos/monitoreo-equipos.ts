import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';

import { Auditoria, Comando, EndpointMon, MonitoreoService, Soporte } from '../../monitoreo.service';

/** Acceso al agente de escritorio (solo cuando la app corre dentro de Electron). */
interface PuenteEndpoint {
  status(): Promise<{ enrolado: boolean; endpointId: number | null }>;
  enrol(pin: string): Promise<{ enrolado: boolean; endpointId: number }>;
}
function puenteEndpoint(): PuenteEndpoint | null {
  const w = window as unknown as { electron?: { endpoint?: PuenteEndpoint } };
  return w.electron?.endpoint ?? null;
}

/**
 * Monitoreo de equipos (admin de sistemas): tablero encendido/apagado, lista de endpoints, acciones
 * de soporte (inventario/procesos/captura/soporte remoto), auditorías nocturnas y enrolamiento.
 * Cuando corre en el escritorio, además permite activar ESTE equipo con un PIN.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-monitoreo-equipos',
  imports: [CommonModule, FormsModule, MatIconModule],
  template: `
    <div class="mon">
      <header class="mon__cab">
        <h1><mat-icon>devices</mat-icon> Monitoreo de equipos</h1>
        <span class="mon__flex"></span>
        <button class="btn" (click)="irAActividad()"><mat-icon>insights</mat-icon> Actividad</button>
        <button class="btn" (click)="irAProcesos()"><mat-icon>hub</mat-icon> Procesos</button>
        <button class="btn" (click)="irAEtiquetas()"><mat-icon>qr_code_2</mat-icon> Etiquetas</button>
        <button class="btn" (click)="generarPin()"><mat-icon>vpn_key</mat-icon> Generar PIN</button>
        <button class="btn" (click)="cargar()"><mat-icon>refresh</mat-icon></button>
      </header>

      @if (pin()) {
        <div class="mon__pin">
          PIN de enrolamiento: <b>{{ pin()!.pin }}</b> · válido hasta {{ pin()!.expira | date:'short' }}.
          Instálalo en el equipo y pégalo al activar el agente. <button class="x" (click)="pin.set(null)">×</button>
        </div>
      }

      @if (esEscritorio && !esteEquipoEnrolado()) {
        <div class="mon__activar">
          <mat-icon>desktop_windows</mat-icon>
          <div>
            <strong>Activar monitoreo en este equipo</strong>
            <p>Pega el PIN que te dio el admin de sistemas para registrar este computador.</p>
          </div>
          <input [(ngModel)]="pinLocal" placeholder="PIN" maxlength="12">
          <button class="btn btn--primario" [disabled]="activando()" (click)="activarEsteEquipo()">Activar</button>
        </div>
      }

      @if (tab(); as t) {
        <div class="mon__tablero">
          <div class="tile"><span class="n">{{ t.total }}</span><span class="l">Equipos</span></div>
          <div class="tile tile--on"><span class="n">{{ t.online }}</span><span class="l">Encendidos</span></div>
          <div class="tile tile--off"><span class="n">{{ t.offline }}</span><span class="l">Apagados</span></div>
          <div class="tile tile--inact"><span class="n">{{ t.inactivos }}</span><span class="l">Inactivos</span></div>
        </div>
      }

      <div class="mon__cuerpo">
        <section class="mon__lista">
          <input class="buscar" [(ngModel)]="q" (ngModelChange)="filtrar()" placeholder="Buscar por equipo o usuario…">
          @for (e of endpoints(); track e.id) {
            <button class="fila" [class.fila--sel]="sel()?.id === e.id" (click)="elegir(e)">
              <span class="punto" [class]="'punto--' + e.estado.toLowerCase()"></span>
              <span class="fila__nom">{{ e.hostname || e.machineUid }}</span>
              <span class="fila__user">{{ e.usuarioActivo || '—' }}</span>
              <span class="fila__est">{{ e.estado }}</span>
            </button>
          }
          @if (!endpoints().length) { <p class="vacio">Sin equipos. Genera un PIN y activa el agente en un computador.</p> }
        </section>

        @if (sel(); as e) {
          <aside class="mon__detalle">
            <h2>{{ e.hostname || e.machineUid }}</h2>
            <p class="meta">{{ e.so }} {{ e.soVersion }} · {{ e.cpu }} · {{ ram(e) }}</p>
            <p class="meta">Usuario del equipo (sesión): {{ e.usuarioActivo || '—' }} · IP: {{ e.ipLan || '—' }} ·
              Último latido: {{ e.ultimoLatido ? (e.ultimoLatido | date:'short') : 'nunca' }}</p>

            <!-- Ficha: foto del equipo + a qué usuario de la plataforma pertenece -->
            <div class="ficha">
              <label class="foto" title="Subir/cambiar foto del equipo">
                @if (fotoUrl()) { <img [src]="fotoUrl()" alt="equipo"> } @else { <div class="foto__ph"><mat-icon>photo_camera</mat-icon></div> }
                <input type="file" accept="image/*" hidden (change)="onFoto($event, e)">
                <span class="foto__cam"><mat-icon>add_a_photo</mat-icon></span>
              </label>
              <div class="ficha__due">
                <span class="ficha__lbl">Dueño (usuario de la plataforma)</span>
                @if (e.responsableNombre) {
                  <div class="ficha__user"><mat-icon>person</mat-icon> <b>{{ e.responsableNombre }}</b>@if (e.responsableDoc) { <small> · {{ e.responsableDoc }}</small> }
                    <button class="x" (click)="quitarDue(e)" title="Quitar dueño"><mat-icon>close</mat-icon></button>
                  </div>
                } @else { <span class="ficha__sin">Sin asignar</span> }
                <input type="text" class="ficha__buscar" [(ngModel)]="qUsuario" (ngModelChange)="buscarUsuarios($event)" placeholder="Asignar a usuario…">
                @if (usuarios().length) {
                  <div class="ficha__res">
                    @for (u of usuarios(); track $index) {
                      <button (click)="elegirUsuario(e, u)"><mat-icon>person</mat-icon> {{ nombreU(u) }} <small>{{ correoU(u) }}</small></button>
                    }
                  </div>
                }
              </div>
            </div>

            <div class="acciones">
              <button class="btn btn--primario" (click)="irAReporte(e)"><mat-icon>summarize</mat-icon> Ver reporte completo</button>
              <button class="btn" (click)="comando(e, 'INVENTARIO')"><mat-icon>inventory_2</mat-icon> Inventario</button>
              <button class="btn" (click)="comando(e, 'PROCESOS')"><mat-icon>list_alt</mat-icon> Procesos</button>
              <button class="btn" (click)="comando(e, 'CAPTURA')"><mat-icon>photo_camera</mat-icon> Captura</button>
              <button class="btn" (click)="soporte(e)"><mat-icon>support_agent</mat-icon> Soporte</button>
              <button class="btn btn--peligro" (click)="revocar(e)"><mat-icon>link_off</mat-icon> Revocar</button>
            </div>

            <h3>Auditorías nocturnas
              <button class="link" (click)="correrAuditoria()">Correr ahora</button>
            </h3>
            @for (a of auditorias(); track a.id) {
              <div class="aud" [class]="'aud--' + a.severidad.toLowerCase()">
                <span class="aud__fecha">{{ a.fecha }}</span>
                <span class="aud__sev">{{ a.severidad }}</span>
                <p>{{ a.resumen }}</p>
                @if (a.hallazgos?.length) {
                  <ul>@for (h of a.hallazgos; track $index) { <li>{{ h['titulo'] }} — {{ h['detalle'] }}</li> }</ul>
                }
              </div>
            }
            @if (!auditorias().length) { <p class="vacio">Sin auditorías todavía.</p> }

            <h3>Comandos recientes</h3>
            @for (c of comandos(); track c.id) {
              <div class="cmd"><span>{{ c.tipo }}</span><span class="cmd__est">{{ c.estado }}</span><span>{{ c.creado | date:'short' }}</span></div>
            }
          </aside>
        }
      </div>
      @if (aviso()) { <div class="mon__aviso">{{ aviso() }}</div> }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .mon { padding: 12px 16px; color: var(--text, #0f1b2d); }
    .mon__cab { display: flex; align-items: center; gap: 8px; }
    .mon__cab h1 { font-size: 18px; font-weight: 800; display: flex; align-items: center; gap: 8px; margin: 0; }
    .mon__flex { flex: 1; }
    .btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border, #cbd5e1); background: var(--surface, #fff); color: inherit; border-radius: 10px; padding: 6px 12px; min-height: 40px; cursor: pointer; font-weight: 700; font-size: 13px; }
    .btn--primario { background: var(--brand-blue, #2b59f0); color: #fff; border-color: transparent; }
    .btn--peligro { color: #b91c1c; }
    .btn:disabled { opacity: .5; }
    .btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .link { border: 0; background: transparent; color: var(--brand-blue, #2b59f0); cursor: pointer; font-weight: 700; font-size: 12px; margin-left: 8px; }
    .mon__pin { margin: 10px 0; padding: 8px 12px; background: #ecfccb; border: 1px solid #a3e635; border-radius: 10px; font-size: 13px; }
    .mon__pin .x { float: right; border: 0; background: transparent; cursor: pointer; font-size: 16px; }
    .mon__activar { margin: 10px 0; padding: 10px 12px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 12px; display: flex; align-items: center; gap: 12px; }
    .mon__activar p { margin: 2px 0 0; font-size: 12px; color: #475569; }
    .mon__activar input { padding: 7px 9px; border: 1px solid var(--border, #cbd5e1); border-radius: 8px; width: 120px; text-transform: uppercase; }
    .mon__tablero { display: flex; gap: 10px; margin: 12px 0; flex-wrap: wrap; }
    .tile { flex: 1; min-width: 110px; background: var(--surface, #fff); border: 1px solid var(--border, #e2e8f0); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; }
    .tile .n { font-size: 26px; font-weight: 800; } .tile .l { font-size: 12px; color: #64748b; }
    .tile--on .n { color: #16a34a; } .tile--off .n { color: #64748b; } .tile--inact .n { color: #d97706; }
    .mon__cuerpo { display: flex; gap: 14px; align-items: flex-start; }
    .mon__lista { flex: 1; min-width: 280px; display: flex; flex-direction: column; gap: 4px; }
    .buscar { padding: 8px 10px; border: 1px solid var(--border, #cbd5e1); border-radius: 8px; margin-bottom: 6px; }
    .fila { display: grid; grid-template-columns: 14px 1fr auto auto; gap: 10px; align-items: center; border: 1px solid transparent; background: var(--surface, #fff); border-radius: 8px; padding: 9px 10px; cursor: pointer; text-align: left; }
    .fila--sel { border-color: var(--brand-blue, #2b59f0); }
    .fila__user { color: #64748b; font-size: 12px; } .fila__est { font-size: 11px; font-weight: 700; }
    .punto { width: 12px; height: 12px; border-radius: 50%; background: #94a3b8; }
    .punto--online { background: #22c55e; } .punto--offline { background: #94a3b8; }
    .punto--inactivo { background: #f59e0b; } .punto--alerta { background: #ef4444; }
    .mon__detalle { width: 380px; background: var(--surface, #fff); border: 1px solid var(--border, #e2e8f0); border-radius: 12px; padding: 14px; }
    .mon__detalle h2 { margin: 0 0 2px; font-size: 16px; } .mon__detalle h3 { font-size: 13px; margin: 14px 0 6px; }
    .ficha { display: flex; gap: 12px; margin: 10px 0; padding: 10px; background: var(--muted, #f8fafc); border-radius: 10px; }
    .foto { position: relative; width: 84px; height: 84px; flex: none; border-radius: 10px; overflow: hidden; cursor: pointer; border: 1px solid var(--border, #e2e8f0); }
    .foto img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .foto__ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #e2e8f0; color: #94a3b8; }
    .foto__cam { position: absolute; right: 2px; bottom: 2px; background: var(--brand-blue, #2b59f0); color: #fff; border-radius: 50%; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; }
    .foto__cam mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .ficha__due { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .ficha__lbl { font-size: 11px; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: .3px; }
    .ficha__user { display: flex; align-items: center; gap: 4px; font-size: 13px; }
    .ficha__user mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--brand-blue, #2b59f0); }
    .ficha__user .x { margin-left: auto; border: 0; background: transparent; color: #ef4444; cursor: pointer; }
    .ficha__sin { font-size: 13px; color: #94a3b8; }
    .ficha__buscar { padding: 6px 8px; border: 1px solid var(--border, #cbd5e1); border-radius: 8px; font-size: 12px; }
    .ficha__res { background: var(--surface, #fff); border: 1px solid var(--border, #e2e8f0); border-radius: 8px; max-height: 160px; overflow: auto; }
    .ficha__res button { display: flex; align-items: center; gap: 6px; width: 100%; border: 0; border-bottom: 1px solid var(--border, #f1f5f9); background: transparent; padding: 7px 8px; cursor: pointer; font-size: 12px; text-align: left; }
    .ficha__res button:hover { background: var(--muted, #f1f5f9); } .ficha__res small { color: #94a3b8; margin-left: auto; }
    .ficha__res mat-icon { font-size: 15px; width: 15px; height: 15px; color: #94a3b8; }
    .meta { font-size: 12px; color: #64748b; margin: 2px 0; }
    .acciones { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .aud { border-left: 3px solid #cbd5e1; padding: 4px 8px; margin: 6px 0; background: #f8fafc; border-radius: 0 8px 8px 0; font-size: 12px; }
    .aud p { margin: 2px 0; } .aud ul { margin: 2px 0 2px 16px; padding: 0; }
    .aud--aviso { border-left-color: #f59e0b; } .aud--alerta { border-left-color: #ef4444; }
    .aud__sev { font-weight: 800; margin-left: 6px; }
    .cmd { display: flex; justify-content: space-between; font-size: 12px; padding: 3px 0; border-bottom: 1px dashed #e2e8f0; }
    .cmd__est { color: #64748b; }
    .vacio { color: #94a3b8; font-size: 13px; padding: 8px 0; }
    .mon__aviso { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); background: #0f172a; color: #fff; padding: 8px 16px; border-radius: 999px; font-size: 13px; }
    @media (max-width: 900px) { .mon__cuerpo { flex-direction: column; } .mon__detalle { width: 100%; } }
  `],
})
export class MonitoreoEquipos implements OnInit {
  private readonly api = inject(MonitoreoService);
  private readonly router = inject(Router);

  readonly esEscritorio = !!puenteEndpoint();
  pinLocal = '';
  q = '';

  readonly tab = signal<import('../../monitoreo.service').Tablero | null>(null);
  readonly endpoints = signal<EndpointMon[]>([]);
  readonly sel = signal<EndpointMon | null>(null);
  readonly auditorias = signal<Auditoria[]>([]);
  readonly comandos = signal<Comando[]>([]);
  readonly pin = signal<{ pin: string; expira: string } | null>(null);
  readonly aviso = signal<string | null>(null);
  readonly activando = signal(false);
  readonly fotoUrl = signal<string | null>(null);
  readonly usuarios = signal<Array<Record<string, unknown>>>([]);
  qUsuario = '';
  private readonly esteId = signal<number | null>(null);

  readonly esteEquipoEnrolado = computed(() => this.esteId() != null);

  ngOnInit(): void {
    this.cargar();
    const p = puenteEndpoint();
    if (p) p.status().then(s => this.esteId.set(s.enrolado ? s.endpointId : null)).catch(() => {});
  }

  cargar(): void {
    this.api.tablero().subscribe({ next: t => this.tab.set(t), error: () => {} });
    this.filtrar();
  }

  filtrar(): void {
    this.api.endpoints(this.q || undefined).subscribe({ next: l => this.endpoints.set(l), error: () => this.endpoints.set([]) });
  }

  elegir(e: EndpointMon): void {
    this.sel.set(e);
    this.usuarios.set([]); this.qUsuario = '';
    this.fotoUrl.set(null);
    if (e.tieneFoto) this.api.foto(e.id).subscribe({ next: r => this.fotoUrl.set(r.data_url), error: () => {} });
    this.api.auditoriasDe(e.id).subscribe({ next: a => this.auditorias.set(a), error: () => this.auditorias.set([]) });
    this.api.comandos(e.id).subscribe({ next: c => this.comandos.set(c), error: () => this.comandos.set([]) });
  }

  // ── Foto + dueño ────────────────────────────────────────────────────
  onFoto(ev: Event, e: EndpointMon): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.api.subirFoto(e.id, file).subscribe({
      next: ep => { this.reemplazar(ep); this.fotoUrl.set(null); this.api.foto(ep.id).subscribe({ next: r => this.fotoUrl.set(r.data_url), error: () => {} }); this.flash('Foto guardada'); },
      error: () => this.flash('No se pudo subir la foto'),
    });
    input.value = '';
  }

  buscarUsuarios(q: string): void {
    if (!q || q.trim().length < 2) { this.usuarios.set([]); return; }
    this.api.buscarUsuarios(q.trim()).subscribe({ next: l => this.usuarios.set(Array.isArray(l) ? l.slice(0, 8) : []), error: () => this.usuarios.set([]) });
  }

  elegirUsuario(e: EndpointMon, u: Record<string, unknown>): void {
    const ref = String(u['id'] ?? '');
    this.api.asignarResponsable(e.id, ref, this.nombreU(u), this.docU(u)).subscribe({
      next: ep => { this.reemplazar(ep); this.usuarios.set([]); this.qUsuario = ''; this.flash('Dueño asignado'); },
      error: () => this.flash('No se pudo asignar'),
    });
  }

  quitarDue(e: EndpointMon): void {
    this.api.asignarResponsable(e.id, null, null, null).subscribe({ next: ep => this.reemplazar(ep), error: () => {} });
  }

  nombreU(u: Record<string, unknown>): string {
    const g = (...k: string[]) => { for (const x of k) { const v = u[x]; if (v) return String(v); } return ''; };
    const n = g('nombre_completo', 'nombreCompleto', 'nombre', 'nombres', 'primer_nombre');
    const a = g('apellidos', 'apellido', 'primer_apellido');
    return (n + ' ' + a).trim() || this.correoU(u) || 'Usuario';
  }
  correoU(u: Record<string, unknown>): string {
    for (const k of ['correo_electronico', 'correoElectronico', 'correo', 'email']) { const v = u[k]; if (v) return String(v); }
    return '';
  }
  private docU(u: Record<string, unknown>): string | null {
    for (const k of ['numero_de_documento', 'numeroDeDocumento', 'documento', 'cedula']) { const v = u[k]; if (v) return String(v); }
    return null;
  }
  private reemplazar(ep: EndpointMon): void {
    this.sel.set(ep);
    this.endpoints.update(l => l.map(x => x.id === ep.id ? ep : x));
  }

  comando(e: EndpointMon, tipo: string): void {
    this.api.crearComando(e.id, tipo).subscribe({ next: () => { this.flash(`Comando ${tipo} encolado`); this.elegir(e); }, error: () => this.flash('No se pudo encolar') });
  }

  soporte(e: EndpointMon): void {
    const motivo = prompt('Motivo del soporte remoto (el usuario verá un aviso):') || undefined;
    this.api.pedirSoporte(e.id, motivo).subscribe({ next: () => this.flash('Soporte solicitado (el equipo mostrará el aviso)'), error: () => this.flash('No se pudo solicitar') });
  }

  revocar(e: EndpointMon): void {
    if (!confirm('Revocar el agente de este equipo. Dejará de reportar hasta re-enrolarlo. ¿Continuar?')) return;
    this.api.revocar(e.id).subscribe({ next: () => { this.flash('Agente revocado'); this.filtrar(); }, error: () => this.flash('No se pudo revocar') });
  }

  correrAuditoria(): void {
    this.api.correrAuditoria(undefined, true).subscribe({
      next: r => { this.flash(`Auditoría corrida (${r.equipos} equipos)`); const e = this.sel(); if (e) this.elegir(e); },
      error: () => this.flash('No se pudo correr la auditoría'),
    });
  }

  generarPin(): void {
    this.api.generarPin().subscribe({ next: p => this.pin.set(p), error: () => this.flash('No se pudo generar el PIN') });
  }

  async activarEsteEquipo(): Promise<void> {
    const p = puenteEndpoint();
    if (!p || !this.pinLocal.trim()) return;
    this.activando.set(true);
    try {
      const r = await p.enrol(this.pinLocal.trim());
      this.esteId.set(r.endpointId);
      this.flash('Este equipo quedó activado');
      this.filtrar();
    } catch {
      this.flash('No se pudo activar (¿PIN válido?)');
    } finally {
      this.activando.set(false);
    }
  }

  irAEtiquetas(): void { this.router.navigate(['/dashboard/monitoreo-equipos/etiquetas']); }
  irAActividad(): void { this.router.navigate(['/dashboard/monitoreo-equipos/actividad']); }
  irAProcesos(): void { this.router.navigate(['/dashboard/monitoreo-equipos/procesos']); }
  irAReporte(e: EndpointMon): void { this.router.navigate(['/dashboard/monitoreo-equipos/reporte', e.id]); }

  ram(e: EndpointMon): string { return e.ramMb ? Math.round(e.ramMb / 1024) + ' GB RAM' : ''; }

  private flash(msg: string): void { this.aviso.set(msg); setTimeout(() => this.aviso.set(null), 3000); }
}
