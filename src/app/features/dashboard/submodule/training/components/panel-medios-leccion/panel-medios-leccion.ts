import {
  ChangeDetectionStrategy, Component, DestroyRef, EventEmitter, Input, OnInit, Output, computed, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';

import { Capacidades, Medio, MediosService, TipoMedio, medioOcupado } from '../../service/medios.service';
import { mensajeDeError } from '../../service/disenador.service';
import { MedioTarjeta } from '../medio-tarjeta/medio-tarjeta';

/**
 * Panel lateral de la consola: los medios con IA de UNA clase ya creada. Proponer con IA,
 * ajustar, generar y ponerlos en la clase (solo si la versión es borrador).
 */
@Component({
  selector: 'app-panel-medios-leccion',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MedioTarjeta],
  template: `
    <div class="pml-velo" (click)="cerrar.emit()"></div>
    <aside class="pml" role="dialog" aria-label="Medios con IA de la clase">
      <header class="pml-cab">
        <div>
          <span class="pml-eyebrow"><mat-icon>auto_awesome</mat-icon> Medios con IA</span>
          <h2>{{ lessonNombre }}</h2>
        </div>
        <button type="button" class="pml-x" (click)="cerrar.emit()" aria-label="Cerrar"><mat-icon>close</mat-icon></button>
      </header>
      @if (!editable) {
        <p class="pml-aviso"><mat-icon>lock</mat-icon> Esta versión está publicada: puedes preparar medios, pero para ponerlos en la clase crea un borrador nuevo.</p>
      }
      <div class="pml-acc">
        <button type="button" class="pml-btn pml-btn--primario" [disabled]="planificando() || !capacidades()?.ia" (click)="proponer()">
          <mat-icon>auto_awesome</mat-icon> {{ planificando() ? 'Pensando…' : 'Proponer con IA' }}
        </button>
        @for (t of tipos; track t.tipo) {
          <button type="button" class="pml-tipo" (click)="agregar(t.tipo)" [title]="'Agregar ' + t.nombre"><mat-icon>{{ t.icono }}</mat-icon>{{ t.nombre }}</button>
        }
      </div>
      @if (error()) { <p class="pml-error">{{ error() }}</p> }
      <div class="pml-lista">
        @for (m of medios(); track m.id; let i = $index) {
          <app-medio-tarjeta [medio]="m" [capacidades]="capacidades()" [puedeInsertar]="editable" [abierta]="i === 0"
                             (cambio)="actualizado($event)" (eliminado)="eliminado($event)" />
        } @empty {
          <p class="pml-vacio">{{ planificando() ? 'La IA está pensando los medios de esta clase…' : 'Sin medios. Pídeselos a la IA o agrégalos a mano.' }}</p>
        }
      </div>
    </aside>
  `,
  styles: [`
    :host { position: fixed; inset: 0; z-index: 1000; font-family: var(--font-sans); color: var(--text); }
    .pml-velo { position: absolute; inset: 0; background: var(--overlay); }
    .pml { position: absolute; top: 0; right: 0; bottom: 0; width: min(720px, 100vw); background: var(--bg); box-shadow: var(--shadow-lg);
      display: flex; flex-direction: column; gap: 12px; padding: 18px; overflow-y: auto; box-sizing: border-box; }
    .pml-cab { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
    .pml-cab h2 { margin: 4px 0 0; font-size: 20px; font-weight: 800; }
    .pml-eyebrow { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; color: var(--violet-fg); }
    .pml-eyebrow mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .pml-x { width: 44px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; display: grid; place-items: center; }
    .pml-aviso { display: flex; gap: 6px; align-items: flex-start; margin: 0; padding: 10px 12px; border-radius: 12px; background: var(--warn-bg); color: var(--warn-fg); font-size: 13px; }
    .pml-acc { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .pml-btn { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; border: 1px solid var(--border-strong); padding: 0 16px; font: 700 13.5px var(--font-sans); cursor: pointer; }
    .pml-btn--primario { background: var(--primary); border-color: var(--primary); color: #fff; }
    .pml-btn:disabled { opacity: .55; cursor: not-allowed; }
    .pml-tipo { display: inline-flex; align-items: center; gap: 4px; border: 1px dashed var(--border-strong); background: var(--surface); color: var(--text); border-radius: 999px; padding: 0 10px; min-height: 36px !important; font: 600 12.5px var(--font-sans); cursor: pointer; }
    .pml-tipo mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--primary); }
    .pml-lista { display: grid; gap: 10px; }
    .pml-vacio { color: var(--muted); text-align: center; padding: 30px 10px; }
    .pml-error { color: var(--danger-fg); font-size: 13px; margin: 0; }
  `],
})
export class PanelMediosLeccion implements OnInit {
  @Input({ required: true }) lessonId!: string;
  @Input() lessonNombre = '';
  @Input() editable = false;
  @Output() cerrar = new EventEmitter<void>();
  /** Algo entró a la clase: la consola recarga el contenido. */
  @Output() insertado = new EventEmitter<void>();

  private api = inject(MediosService);
  readonly medios = signal<Medio[]>([]);
  readonly planificando = signal(false);
  readonly error = signal<string | null>(null);
  readonly capacidades = signal<Capacidades | null>(null);
  private readonly ocupados = computed(() => this.medios().some(medioOcupado));
  private temporizador: ReturnType<typeof setTimeout> | null = null;
  private vivo = true;
  private bloquesVistos = new Set<string>();

  readonly tipos: { tipo: TipoMedio; nombre: string; icono: string }[] = [
    { tipo: 'FICHA', nombre: 'Fichas', icono: 'style' }, { tipo: 'AUDIO', nombre: 'Audio', icono: 'headphones' },
    { tipo: 'PODCAST', nombre: 'Podcast', icono: 'podcasts' }, { tipo: 'CLIP', nombre: 'Clip', icono: 'movie' },
    { tipo: 'YOUTUBE', nombre: 'YouTube', icono: 'smart_display' },
  ];

  constructor() {
    inject(DestroyRef).onDestroy(() => { this.vivo = false; if (this.temporizador) clearTimeout(this.temporizador); });
  }

  async ngOnInit(): Promise<void> {
    this.api.capacidades().then(c => this.capacidades.set(c)).catch(() => undefined);
    await this.recargar(true);
  }

  async recargar(primera = false): Promise<void> {
    try {
      const r = await this.api.deLeccion(this.lessonId);
      this.planificando.set(r.planificando);
      this.error.set(r.error || null);
      // Un medio que el worker insertó solo mientras el panel estaba abierto: recargar la clase.
      const nuevos = r.medios.filter(m => m.block_id && !this.bloquesVistos.has(m.block_id));
      nuevos.forEach(m => this.bloquesVistos.add(m.block_id!));
      if (!primera && nuevos.length) this.insertado.emit();
      this.medios.set(r.medios);
    } catch (e) {
      this.error.set(mensajeDeError(e));
    }
    if (this.temporizador) clearTimeout(this.temporizador);
    if (this.vivo && (this.planificando() || this.ocupados())) this.temporizador = setTimeout(() => this.recargar(), 3000);
  }

  async proponer(): Promise<void> {
    try {
      await this.api.planificarLeccion(this.lessonId);
      this.planificando.set(true);
      this.recargar();
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo', text: mensajeDeError(e) });
    }
  }

  async agregar(tipo: TipoMedio): Promise<void> {
    try {
      const m = await this.api.crearEnLeccion(this.lessonId, tipo);
      this.medios.update(l => [...l, m]);
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo', text: mensajeDeError(e) });
    }
  }

  actualizado(m: Medio): void {
    const antes = this.medios().find(x => x.id === m.id);
    this.medios.update(l => l.map(x => x.id === m.id ? m : x));
    if (m.block_id && !antes?.block_id) {
      this.bloquesVistos.add(m.block_id);
      this.insertado.emit();
    }
    this.recargar();
  }

  eliminado(id: string): void {
    this.medios.update(l => l.filter(x => x.id !== id));
  }
}
