import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Compromiso, CompromisoReq, EstadoCompromiso } from '../../modelos';
import { ComunicacionesApiService } from '../../service/comunicaciones-api.service';
import { mmss } from '../../utiles';
import { ComAvatar } from '../avatar/avatar';

export interface PersonaRef { usuario_id: string; nombre: string; tiene_foto?: boolean }

/** Un compromiso: qué, quién y para cuándo, con su estado y el origen (minuto de la llamada o mensaje). */
@Component({
  selector: 'app-com-compromiso',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatMenuModule, MatTooltipModule, ComAvatar],
  template: `
    <div class="comp" [class.hecho]="c().estado === 'CUMPLIDO'" [class.cancelado]="c().estado === 'CANCELADO'" [class.vencido]="c().vencido">
      <button type="button" class="check" (click)="alternarCumplido()" [attr.aria-label]="c().estado === 'CUMPLIDO' ? 'Reabrir' : 'Marcar cumplido'"
              [matTooltip]="c().estado === 'CUMPLIDO' ? 'Reabrir' : 'Marcar cumplido'">
        <mat-icon>{{ c().estado === 'CUMPLIDO' ? 'check_circle' : 'radio_button_unchecked' }}</mat-icon>
      </button>
      @if (!editando()) {
        <div class="cuerpo">
          <div class="desc">{{ c().descripcion }}</div>
          <div class="datos">
            @if (c().responsable_nombre) {
              <span class="chip"><app-com-avatar [usuarioId]="c().responsable_id" [nombre]="c().responsable_nombre" [tam]="18" />
                {{ c().responsable_nombre }}@if (!c().responsable_id) { <em>(sin enlazar)</em> }</span>
            } @else { <span class="chip tenue">Sin responsable</span> }
            @if (c().fecha_limite) {
              <span class="chip" [class.rojo]="c().vencido"><mat-icon>event</mat-icon>{{ fecha(c().fecha_limite!) }}</span>
            }
            <span class="chip estado" [attr.data-e]="c().estado">{{ etiquetaEstado() }}</span>
            @if (mostrarOrigen()) {
              <button type="button" class="chip origen" (click)="irOrigen.emit(c())">
                <mat-icon>{{ c().origen === 'LLAMADA' ? 'call' : c().origen === 'CHAT' ? 'chat' : 'edit_note' }}</mat-icon>
                <span>{{ mostrarConversacion() ? (c().conversacion_nombre ?? '') : (c().origen === 'LLAMADA' ? 'Minuto' : 'Chat') }}</span>
                @if (c().momento_ms != null) { <b>{{ tiempo(c().momento_ms) }}</b> }
              </button>
            }
            @if (c().generado_ia) { <span class="ia" matTooltip="Propuesto por la IA a partir de lo conversado"><mat-icon>auto_awesome</mat-icon></span> }
          </div>
          @if (c().evidencia) { <div class="evid">“{{ c().evidencia }}”</div> }
        </div>
        <button type="button" class="mas" [matMenuTriggerFor]="menu" aria-label="Opciones"><mat-icon>more_vert</mat-icon></button>
        <mat-menu #menu="matMenu">
          <button mat-menu-item (click)="editando.set(true)"><mat-icon>edit</mat-icon> Editar</button>
          @for (e of estados; track e.v) {
            @if (e.v !== c().estado) { <button mat-menu-item (click)="cambiar({ estado: e.v })"><mat-icon>{{ e.i }}</mat-icon> {{ e.t }}</button> }
          }
          <button mat-menu-item (click)="borrar()"><mat-icon>delete</mat-icon> Eliminar</button>
        </mat-menu>
      } @else {
        <div class="form">
          <textarea #d rows="2" [value]="c().descripcion"></textarea>
          <div class="form-fila">
            <select #r [value]="c().responsable_id ?? ''">
              <option value="">Sin responsable</option>
              @for (p of personas(); track p.usuario_id) { <option [value]="p.usuario_id">{{ p.nombre }}</option> }
            </select>
            <input #f type="date" [value]="c().fecha_limite ?? ''" />
          </div>
          <div class="form-fila fin">
            <button type="button" (click)="editando.set(false)">Cancelar</button>
            <button type="button" class="ok" (click)="guardar(d.value, r.value, f.value)">Guardar</button>
          </div>
        </div>
      }
    </div>`,
  styles: [`
    .comp { display: flex; gap: .45rem; align-items: flex-start; padding: .55rem .5rem; border: 1px solid var(--border);
      border-radius: 12px; background: var(--surface); }
    .comp.vencido { border-color: var(--danger-border); background: color-mix(in srgb, var(--danger-bg) 35%, var(--surface)); }
    .comp.hecho .desc { text-decoration: line-through; color: var(--muted); }
    .comp.cancelado { opacity: .6; }
    .check { border: 0; background: transparent; cursor: pointer; color: var(--muted); padding: 0; display: flex; }
    .comp.hecho .check { color: #16A34A; }
    .cuerpo { flex: 1; min-width: 0; }
    .desc { font-size: .88rem; font-weight: 600; color: var(--text); }
    .datos { display: flex; flex-wrap: wrap; gap: .3rem; margin-top: .3rem; align-items: center; }
    .chip { display: inline-flex; align-items: center; gap: .25rem; font-size: .72rem; padding: .1rem .5rem; border-radius: 999px;
      background: var(--surface-3); color: var(--text-2); border: 0; font-family: inherit; white-space: nowrap; max-width: 100%;
      min-height: 0; height: auto; line-height: 1.35; box-shadow: none; }
    .chip > span { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .chip > b { font-weight: 700; font-variant-numeric: tabular-nums; }
    .chip mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .chip em { color: var(--muted); font-style: normal; }
    .chip.tenue { color: var(--muted); }
    .chip.rojo { background: var(--danger-bg); color: var(--danger-fg); font-weight: 700; }
    .chip.origen { cursor: pointer; background: var(--info-bg); color: var(--info-fg); }
    .estado[data-e='CUMPLIDO'] { background: var(--ok-bg); color: var(--ok-fg); }
    .estado[data-e='EN_CURSO'] { background: var(--warn-bg); color: var(--warn-fg); }
    .ia mat-icon { font-size: 15px; width: 15px; height: 15px; color: #7C3AED; }
    .evid { margin-top: .3rem; font-size: .75rem; color: var(--muted); font-style: italic; }
    .mas { border: 0; background: transparent; color: var(--muted); cursor: pointer; border-radius: 50%; width: 28px; height: 28px;
      display: inline-flex; align-items: center; justify-content: center; }
    .mas:hover { background: var(--surface-3); }
    .form { flex: 1; display: flex; flex-direction: column; gap: .4rem; }
    .form textarea, .form select, .form input { font: inherit; font-size: .85rem; border: 1px solid var(--border); border-radius: 8px;
      padding: .35rem .5rem; background: var(--surface); color: var(--text); }
    .form-fila { display: flex; gap: .4rem; flex-wrap: wrap; }
    .form-fila select { flex: 1; min-width: 150px; }
    .fin { justify-content: flex-end; }
    .form button { border: 1px solid var(--border); background: var(--surface); border-radius: 999px; padding: .3rem .8rem; cursor: pointer; font: inherit; }
    .form .ok { background: var(--primary); color: #fff; border-color: var(--primary); }
  `],
})
export class ComCompromiso {
  private readonly api = inject(ComunicacionesApiService);
  readonly c = input.required<Compromiso>();
  readonly personas = input<PersonaRef[]>([]);
  readonly mostrarOrigen = input(true);
  /** false dentro del acta o del panel de la conversación: ahí ya se sabe de qué conversación es. */
  readonly mostrarConversacion = input(true);
  readonly cambio = output<Compromiso>();
  readonly borrado = output<string>();
  readonly irOrigen = output<Compromiso>();
  readonly editando = signal(false);

  readonly estados: { v: EstadoCompromiso; t: string; i: string }[] = [
    { v: 'PENDIENTE', t: 'Pendiente', i: 'radio_button_unchecked' },
    { v: 'EN_CURSO', t: 'En curso', i: 'pending' },
    { v: 'CUMPLIDO', t: 'Cumplido', i: 'check_circle' },
    { v: 'CANCELADO', t: 'Cancelado', i: 'block' },
  ];
  readonly etiquetaEstado = computed(() => this.estados.find(e => e.v === this.c().estado)?.t ?? this.c().estado);

  alternarCumplido(): void { this.cambiar({ estado: this.c().estado === 'CUMPLIDO' ? 'PENDIENTE' : 'CUMPLIDO' }); }

  cambiar(req: CompromisoReq): void {
    this.api.actualizarCompromiso(this.c().id, req).subscribe({ next: c => { this.editando.set(false); this.cambio.emit(c); } });
  }

  guardar(descripcion: string, responsable: string, fecha: string): void {
    this.cambiar({
      descripcion: descripcion.trim() || undefined,
      responsable_id: responsable || null, quitar_responsable: !responsable,
      fecha_limite: fecha || null, quitar_fecha: !fecha,
    });
  }

  borrar(): void {
    if (!confirm('¿Eliminar este compromiso?')) return;
    this.api.eliminarCompromiso(this.c().id).subscribe({ next: () => this.borrado.emit(this.c().id) });
  }

  fecha(f: string): string {
    const d = new Date(f + 'T12:00:00');
    return d.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  tiempo(ms: number | null): string { return mmss(ms); }
}
