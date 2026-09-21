import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

import { PanelAtencion, etiquetaEstado } from '../../components/panel-atencion/panel-atencion';
import { ContextoTurnosService } from '../../service/contexto-turnos.service';
import { Cola, Turno, TurnosService } from '../../service/turnos.service';
import { conectarSse, ConexionSse, tokenActual } from '../../service/sse.util';

/**
 * El panel de atención a pantalla completa: el mismo componente del colapsador (modo
 * página) y, debajo, la cola de la oficina en vivo para llamar un turno concreto.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-turnos-atencion',
  imports: [CommonModule, MatIconModule, PanelAtencion],
  template: `
    <div class="tn-pagina">
      <header class="tn-encabezado">
        <div>
          <h1 class="tn-titulo"><mat-icon>support_agent</mat-icon> Panel de atención</h1>
          <p class="tn-subtitulo">Abra su puesto, llame turnos y lleve varios casos a la vez. El mismo panel queda plegado bajo la barra superior en cualquier pantalla.</p>
        </div>
      </header>

      <app-panel-atencion modo="pagina" />

      @if (cola(); as c) {
        <div class="tn-tarjeta">
          <h3><mat-icon>groups</mat-icon> En espera en {{ c.oficina_nombre }} <span class="n">{{ c.en_espera.length }}</span>
            <span class="estado-canal" [class.ok]="canal() === 'conectado'">{{ canal() === 'conectado' ? 'en vivo' : canal() }}</span></h3>
          @if (!c.en_espera.length) {
            <div class="tn-vacio"><mat-icon>hourglass_empty</mat-icon><span>Nadie esperando.</span></div>
          } @else {
            <div class="tn-tabla-marco">
              <table class="tn-tabla">
                <thead><tr><th>Turno</th><th>Servicio</th><th>Persona</th><th>Prioridad</th><th>Llegó</th><th>Espera</th><th class="acciones"></th></tr></thead>
                <tbody>
                  @for (t of c.en_espera; track t.id) {
                    <tr>
                      <td><span class="tn-codigo grande">{{ t.codigo }}</span></td>
                      <td><span class="punto-color" [style.background]="t.servicio_color || 'var(--brand-blue)'"></span>{{ t.servicio_nombre }}</td>
                      <td>{{ t.nombre || '—' }} @if (t.documento) { <span class="doc">· {{ t.documento }}</span> }</td>
                      <td>@if (t.prioridad !== 'NORMAL') { <span class="tn-chip tn-chip--violet">{{ t.prioridad }}</span> } @else { — }</td>
                      <td>{{ t.creado_en | date:'HH:mm' }}</td>
                      <td>{{ espera(t) }}</td>
                      <td class="acciones">
                        <button type="button" class="tn-boton" (click)="llamar(t)" [disabled]="!ctx.puestoAbierto() || !!ctx.turnoActual()" title="Llamar este turno a mi puesto"><mat-icon>campaign</mat-icon> Llamar</button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </div>

        @if (c.en_curso.length) {
          <div class="tn-tarjeta">
            <h3><mat-icon>desk</mat-icon> Siendo atendidos ahora</h3>
            <div class="en-curso">
              @for (t of c.en_curso; track t.id) {
                <div class="en-curso__item">
                  <span class="tn-codigo grande">{{ t.codigo }}</span>
                  <span class="tn-chip" [class.tn-chip--warn]="t.estado === 'LLAMADO'" [class.tn-chip--ok]="t.estado === 'EN_ATENCION'">{{ estado(t) }}</span>
                  <span class="muted">{{ t.punto_nombre }} · {{ t.atendido_por_nombre }}</span>
                </div>
              }
            </div>
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .n { font-size: 12px; color: var(--muted); font-weight: 700; margin-left: 4px; }
    .estado-canal { margin-left: auto; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--warning); }
    .estado-canal.ok { color: var(--lime-ink); }
    .grande { font-size: 16px; color: var(--text); }
    .doc { color: var(--muted); font-variant-numeric: tabular-nums; }
    .punto-color { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
    .en-curso { display: flex; flex-wrap: wrap; gap: 8px; }
    .en-curso__item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 12px; background: var(--surface-2); border: 1px solid var(--border); }
    .muted { color: var(--muted); font-size: 12.5px; }
  `],
  styleUrls: ['../../styles/turnos-comun.css'],
})
export class Atencion implements OnInit {
  readonly ctx = inject(ContextoTurnosService);
  private api = inject(TurnosService);
  private destroyRef = inject(DestroyRef);

  readonly cola = signal<Cola | null>(null);
  readonly canal = signal<string>('cerrado');
  readonly ahora = signal(Date.now());
  private conexion: ConexionSse | null = null;
  private refresco: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const id = this.ctx.oficinaId();
      untracked(() => this.conectar(id));
    });
    const reloj = setInterval(() => this.ahora.set(Date.now()), 15000);
    this.destroyRef.onDestroy(() => { clearInterval(reloj); this.conexion?.cerrar(); });
  }

  ngOnInit(): void { this.ctx.cargar(); }

  llamar(t: Turno): void {
    const punto = this.ctx.atencion()?.punto_id;
    if (!punto) return;
    this.api.llamar(punto, t.id).subscribe({
      next: r => { this.ctx.aplicarTurno(r); this.api.estadoAtencion().subscribe({ next: e => this.ctx.aplicarAtencion(e) }); this.recargar(); },
      error: () => this.recargar(),
    });
  }

  estado(t: Turno): string { return etiquetaEstado(t.estado); }

  espera(t: Turno): string {
    const min = Math.max(0, Math.floor((this.ahora() - new Date(t.creado_en).getTime()) / 60000));
    return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
  }

  private conectar(oficinaId: string | null): void {
    this.conexion?.cerrar();
    this.conexion = null;
    if (!oficinaId) { this.cola.set(null); return; }
    this.recargar();
    const token = tokenActual();
    if (!token) return;
    this.conexion = conectarSse(this.api.urlEventosOficina(oficinaId), {
      token,
      onEstado: e => this.canal.set(e),
      onEvento: nombre => { if (nombre.startsWith('turno-') || nombre.startsWith('puesto-')) this.recargarPronto(); },
    });
  }

  /** Varios eventos seguidos (un llamado dispara dos) se agrupan en una sola recarga. */
  private recargarPronto(): void {
    if (this.refresco) clearTimeout(this.refresco);
    this.refresco = setTimeout(() => this.recargar(), 250);
  }

  private recargar(): void {
    const id = this.ctx.oficinaId();
    if (!id) return;
    this.api.cola(id).subscribe({ next: c => this.cola.set(c), error: () => {} });
  }
}
