import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';
import { Aula, AulasService, EquipoAula, ParticipanteAula } from '../../service/aulas.service';
import { mensajeDeError } from '../../service/disenador.service';

/**
 * Trabajo en equipo: quien dirige arma los equipos (reparte a los conectados o los deja vacíos),
 * les da una consigna, los abre (cada quien pasa a la sala de su equipo), les avisa algo a todos a
 * la vez, los visita y los hace volver. Quien participa ve su equipo y entra o vuelve.
 */
@Component({
  selector: 'app-aula-equipos',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule],
  template: `
    @if (dirijo) {
      <section class="eq-caja">
        <h4>Armar equipos</h4>
        <div class="eq-fila">
          <label>Cantidad <input type="number" min="1" max="40" [(ngModel)]="cantidad" /></label>
          <select [(ngModel)]="modo" aria-label="Cómo repartir">
            <option value="AUTO">Repartir a los conectados</option>
            <option value="VACIOS">Vacíos (asigno yo)</option>
          </select>
        </div>
        <textarea rows="2" [(ngModel)]="consigna" placeholder="Consigna: qué tiene que hacer cada equipo"></textarea>
        <button type="button" class="eq-btn eq-btn--primario" [disabled]="ocupado()" (click)="crear()"><mat-icon>groups</mat-icon> Crear equipos</button>
      </section>
    }
    @if (equipos().length) {
      @if (dirijo) {
        <div class="eq-acciones">
          @if (!abiertos) {
            <button type="button" class="eq-btn eq-btn--lima" [disabled]="ocupado()" (click)="abrir()"><mat-icon>call_split</mat-icon> Enviar a los equipos</button>
          } @else {
            <button type="button" class="eq-btn eq-btn--primario" [disabled]="ocupado()" (click)="cerrar()"><mat-icon>call_merge</mat-icon> Todos de vuelta</button>
            <button type="button" class="eq-btn" (click)="avisar()"><mat-icon>campaign</mat-icon> Avisar a todos</button>
          }
        </div>
      }
      @for (e of equipos(); track e.id) {
        <section class="eq-equipo" [class.mio]="e.id === miEquipo">
          <header>
            <strong>{{ e.nombre }}</strong>
            <span>{{ e.miembros.length }} persona{{ e.miembros.length === 1 ? '' : 's' }}</span>
            @if (dirijo && abiertos) { <button type="button" class="eq-btn eq-btn--chico" (click)="visitar.emit(e.id)"><mat-icon>login</mat-icon> Visitar</button> }
            @if (!dirijo && e.id === miEquipo && abiertos && !enEquipo) { <button type="button" class="eq-btn eq-btn--chico eq-btn--lima" (click)="visitar.emit(e.id)">Ir a mi equipo</button> }
          </header>
          @if (e.consigna) { <p class="eq-consigna">{{ e.consigna }}</p> }
          <ul>
            @for (u of e.miembros; track u) { <li>{{ nombre(u) }}</li> }
          </ul>
        </section>
      }
      @if (dirijo) {
        <section class="eq-caja">
          <h4>Asignar a mano</h4>
          @for (p of participantes(); track p.user_id) {
            @if (p.rol !== 'ANFITRION' && p.rol !== 'COPRESENTADOR') {
              <div class="eq-asignar">
                <span>{{ p.nombre }}{{ p.conectado ? '' : ' · desconectado' }}</span>
                <select [ngModel]="p.team_id ?? ''" (ngModelChange)="asignar(p, $event)" [attr.aria-label]="'Equipo de ' + p.nombre">
                  <option value="">Sin equipo</option>
                  @for (e of equipos(); track e.id) { <option [value]="e.id">{{ e.nombre }}</option> }
                </select>
              </div>
            }
          }
        </section>
      }
    } @else if (!dirijo) {
      <p class="eq-vacio">Cuando quien dirige arme los equipos, aquí verás el tuyo.</p>
    }
  `,
  styles: [`
    :host { display: block; overflow-y: auto; height: 100%; }
    h4 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
    .eq-caja { border: 1px solid var(--border); border-radius: 12px; padding: 10px; display: grid; gap: 8px; margin-bottom: 10px; }
    .eq-fila { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .eq-fila label { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; }
    input, select, textarea { font: 13px var(--font-sans); padding: 7px 9px; border-radius: 9px; border: 1px solid var(--border-strong); background: var(--surface-2); color: var(--text); min-width: 0; }
    .eq-fila input { width: 64px; }
    textarea { width: 100%; box-sizing: border-box; resize: vertical; }
    .eq-acciones { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
    .eq-btn { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--text); border-radius: 999px; padding: 0 12px; min-height: 36px !important; font: 700 12.5px var(--font-sans); cursor: pointer; justify-self: start; }
    .eq-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .eq-btn--primario { background: var(--primary); border-color: var(--primary); color: #fff; }
    .eq-btn--lima { background: var(--mt-accent); border-color: var(--mt-accent); color: var(--mt-accent-ink); }
    .eq-btn--chico { min-height: 30px !important; padding: 0 8px; margin-left: auto; }
    .eq-equipo { border: 1px solid var(--border); border-radius: 12px; padding: 8px 10px; margin-bottom: 8px; }
    .eq-equipo.mio { border-color: var(--mt-accent-2); background: var(--mt-accent-soft); }
    html[data-theme='dark'] .eq-equipo.mio { background: rgb(140 213 10 / .10); }
    .eq-equipo header { display: flex; align-items: center; gap: 8px; }
    .eq-equipo header span { font-size: 12px; color: var(--muted); }
    .eq-consigna { margin: 6px 0; font-size: 13px; color: var(--text-2); white-space: pre-wrap; }
    .eq-equipo ul { margin: 4px 0 0; padding-left: 18px; font-size: 13px; }
    .eq-asignar { display: flex; align-items: center; gap: 8px; justify-content: space-between; font-size: 13px; }
    .eq-asignar span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .eq-vacio { color: var(--muted); font-size: 13px; text-align: center; padding: 20px 6px; }
  `],
})
export class PanelEquipos implements OnChanges {
  @Input({ required: true }) aula!: Aula;
  @Input() dirijo = false;
  @Input() abiertos = false;
  @Input() miEquipo: string | null = null;
  @Input() enEquipo = false;
  @Input() refresco = 0;
  @Output() visitar = new EventEmitter<string>();
  @Output() cambio = new EventEmitter<void>();

  private api = inject(AulasService);
  readonly equipos = signal<EquipoAula[]>([]);
  readonly participantes = signal<ParticipanteAula[]>([]);
  readonly ocupado = signal(false);
  cantidad = 3;
  modo: 'AUTO' | 'VACIOS' = 'AUTO';
  consigna = '';

  async ngOnChanges(): Promise<void> {
    await this.cargar();
  }

  async cargar(): Promise<void> {
    try {
      const [eq, ps] = await Promise.all([this.api.equipos(this.aula.id), this.api.participantes(this.aula.id)]);
      this.equipos.set(eq);
      this.participantes.set(ps);
    } catch { /* sin equipos */ }
  }

  nombre(uid: string): string {
    return this.participantes().find(p => p.user_id === uid)?.nombre ?? 'Participante';
  }

  private async hacer(f: () => Promise<unknown>): Promise<void> {
    this.ocupado.set(true);
    try { await f(); await this.cargar(); this.cambio.emit(); }
    catch (e) { Swal.fire({ icon: 'error', title: 'No se pudo', text: mensajeDeError(e) }); }
    finally { this.ocupado.set(false); }
  }

  crear(): Promise<void> { return this.hacer(() => this.api.crearEquipos(this.aula.id, this.cantidad, this.modo, this.consigna || null)); }
  abrir(): Promise<void> { return this.hacer(() => this.api.abrirEquipos(this.aula.id)); }
  cerrar(): Promise<void> { return this.hacer(() => this.api.cerrarEquipos(this.aula.id)); }
  asignar(p: ParticipanteAula, teamId: string): Promise<void> { return this.hacer(() => this.api.asignar(this.aula.id, p.user_id, teamId || null)); }

  async avisar(): Promise<void> {
    const r = await Swal.fire({ title: 'Aviso a todos los equipos', input: 'text', inputPlaceholder: 'Ej.: quedan 5 minutos', showCancelButton: true, confirmButtonText: 'Enviar', cancelButtonText: 'Cancelar' });
    if (r.isConfirmed && r.value) await this.hacer(() => this.api.avisarEquipos(this.aula.id, r.value));
  }
}
