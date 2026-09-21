import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

import { ContextoTurnosService } from '../../service/contexto-turnos.service';
import { Caso, CasoDetalle, Pagina, TurnosService } from '../../service/turnos.service';
import { formatearDuracion } from '../../components/panel-atencion/panel-atencion';

/** Historial de casos del asesor: qué atendió, cuánto le tomó y qué anotó. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-turnos-casos',
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="tn-pagina">
      <header class="tn-encabezado">
        <div>
          <h1 class="tn-titulo"><mat-icon>folder_shared</mat-icon> Mis casos</h1>
          <p class="tn-subtitulo">Todo lo que he atendido, con el tiempo real que le dediqué a cada caso y sus notas. Los abiertos se manejan en el panel plegable.</p>
        </div>
      </header>
      @if (pagina(); as p) {
        <div class="tn-tarjeta">
          <div class="tn-tabla-marco"><table class="tn-tabla">
            <thead><tr><th>Caso</th><th>Persona</th><th>Motivo</th><th>Estado</th><th>Abierto</th><th>Cerrado</th><th class="numero">Tiempo</th><th>Resultado</th><th class="acciones"></th></tr></thead>
            <tbody>
              @for (c of p.content; track c.id) {
                <tr>
                  <td><strong>{{ c.nombre }}</strong>@if (c.turno_codigo) { <span class="tn-codigo"> {{ c.turno_codigo }}</span> }</td>
                  <td>{{ c.persona_nombre || '—' }}@if (c.documento) { <span class="muted"> · {{ c.documento }}</span> }</td>
                  <td>{{ c.motivo || '—' }}</td>
                  <td><span class="tn-chip" [class.tn-chip--ok]="c.estado === 'ABIERTO'" [class.tn-chip--warn]="c.estado === 'PAUSADO'">{{ c.estado }}</span></td>
                  <td>{{ c.creado_en | date:'dd/MM HH:mm' }}</td>
                  <td>{{ c.cerrado_en ? (c.cerrado_en | date:'dd/MM HH:mm') : '—' }}</td>
                  <td class="numero">{{ tiempo(c) }}</td>
                  <td>{{ c.resultado || '—' }}</td>
                  <td class="acciones">
                    <button type="button" class="tn-boton tn-boton--fantasma tn-boton--icono" (click)="ver(c)" title="Ver notas"><mat-icon>visibility</mat-icon></button>
                    @if (c.estado === 'CERRADO') { <button type="button" class="tn-boton tn-boton--fantasma tn-boton--icono" (click)="reabrir(c)" title="Reabrir"><mat-icon>restore</mat-icon></button> }
                  </td>
                </tr>
              }
            </tbody>
          </table></div>
          <div class="pie">
            <span class="tn-subtitulo">{{ p.total_elements }} casos</span>
            <span class="paginador"><button type="button" class="tn-boton tn-boton--fantasma tn-boton--icono" (click)="ir(-1)" [disabled]="n() === 0"><mat-icon>chevron_left</mat-icon></button>{{ n() + 1 }} / {{ p.total_pages || 1 }}<button type="button" class="tn-boton tn-boton--fantasma tn-boton--icono" (click)="ir(1)" [disabled]="n() + 1 >= p.total_pages"><mat-icon>chevron_right</mat-icon></button></span>
          </div>
        </div>
      }
      @if (detalle(); as d) {
        <div class="velo" (click)="detalle.set(null)">
          <div class="velo__caja" (click)="$event.stopPropagation()">
            <h3>{{ d.caso.nombre }}</h3>
            <p class="tn-subtitulo">{{ d.caso.persona_nombre }} {{ d.caso.documento ? '· ' + d.caso.documento : '' }} {{ d.caso.telefono ? '· ' + d.caso.telefono : '' }} · {{ tiempo(d.caso) }} de atención</p>
            @if (d.turno) { <p class="tn-subtitulo">Turno <span class="tn-codigo">{{ d.turno.codigo }}</span> · {{ d.turno.servicio_nombre }} · {{ d.turno.estado }}</p> }
            @if (!d.notas.length) { <p class="tn-subtitulo">Sin notas.</p> }
            <ul class="notas">@for (n of d.notas; track n.id) { <li><span class="muted">{{ n.creado_en | date:'dd/MM HH:mm' }}</span> {{ n.texto }}</li> }</ul>
            <button type="button" class="tn-boton" (click)="detalle.set(null)">Cerrar</button>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .muted { color: var(--muted); }
    .pie { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
    .paginador { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--muted); }
    .velo { position: fixed; inset: 0; background: var(--overlay); display: flex; align-items: center; justify-content: center; z-index: 200; padding: 16px; }
    .velo__caja { background: var(--surface); border-radius: 18px; padding: 22px; display: flex; flex-direction: column; gap: 8px; max-width: 560px; width: 100%; max-height: 80vh; overflow: auto; }
    .velo__caja h3 { margin: 0; }
    .notas { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
    .notas li { padding: 8px 10px; border-radius: 10px; background: var(--surface-2); }
  `],
  styleUrls: ['../../styles/turnos-comun.css'],
})
export class MisCasos implements OnInit {
  readonly ctx = inject(ContextoTurnosService);
  private api = inject(TurnosService);
  readonly pagina = signal<Pagina<Caso> | null>(null);
  readonly n = signal(0);
  readonly detalle = signal<CasoDetalle | null>(null);

  ngOnInit(): void { this.ctx.cargar(); this.cargar(); }
  cargar(): void { this.api.historialCasos(this.n(), 30).subscribe({ next: p => this.pagina.set(p), error: () => {} }); }
  ir(d: number): void { this.n.update(v => Math.max(0, v + d)); this.cargar(); }
  ver(c: Caso): void { this.api.caso(c.id).subscribe({ next: d => this.detalle.set(d), error: () => {} }); }
  reabrir(c: Caso): void { this.api.reabrirCaso(c.id).subscribe({ next: () => { this.cargar(); this.ctx.recargarPanel(); }, error: e => alert(e?.error?.message || 'No se pudo reabrir') }); }
  tiempo(c: Caso): string { return formatearDuracion(c.segundos_activo ?? 0); }
}
