import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { LkPista } from './lk-pista.directive';
import type { Mosaico, Pantalla } from '../../aula/sala-en-vivo';

export type Disposicion = 'auto' | 'galeria' | 'presentacion' | 'multipantalla' | 'foco';

/**
 * El escenario del aula: cámaras y pantallas compartidas.
 *
 * <p>Disposiciones: GALERÍA (todas las cámaras en rejilla), PRESENTACIÓN (una pantalla grande y
 * las cámaras en tira), MULTIPANTALLA (todas las pantallas compartidas a la vez, en rejilla: el
 * profesor ve el trabajo de varios estudiantes o dos pantallas propias) y FOCO (una sola persona,
 * la que fija quien dirige o la que yo fije). AUTO elige: con pantallas, presentación o
 * multipantalla; sin pantallas, galería.
 *
 * <p>Los espectadores sin cámara no ocupan escenario: en un webinar de 200 personas el escenario
 * es de quien habla.
 */
@Component({
  selector: 'app-aula-escenario',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, LkPista, NgTemplateOutlet],
  templateUrl: './escenario.html',
  styleUrl: './escenario.css',
})
export class Escenario {
  private readonly _mosaicos = signal<Mosaico[]>([]);
  private readonly _pantallas = signal<Pantalla[]>([]);
  private readonly _disposicion = signal<Disposicion>('auto');
  private readonly _foco = signal<string | null>(null);
  readonly fijadoLocal = signal<string | null>(null);
  readonly pantallaGrande = signal<string | null>(null);

  @Input() set mosaicos(v: Mosaico[]) { this._mosaicos.set(v ?? []); }
  @Input() set pantallas(v: Pantalla[]) { this._pantallas.set(v ?? []); }
  @Input() set disposicion(v: Disposicion) { this._disposicion.set(v ?? 'auto'); }
  /** Identidad que quien dirige puso en foco para todos. */
  @Input() set foco(v: string | null) { this._foco.set(v); }
  @Output() fijar = new EventEmitter<string | null>();

  readonly visibles = computed(() => this._mosaicos().filter(m => m.rol !== 'ESPECTADOR' || m.camActiva || m.local));
  readonly pantallasL = computed(() => this._pantallas());

  readonly modo = computed<Exclude<Disposicion, 'auto'>>(() => {
    const d = this._disposicion();
    if (this.fijadoLocal() || (d === 'foco' && this._foco())) return 'foco';
    if (d !== 'auto') return d === 'foco' ? 'galeria' : d;
    const n = this._pantallas().length;
    return n === 0 ? 'galeria' : n === 1 ? 'presentacion' : 'multipantalla';
  });

  readonly enFoco = computed<Mosaico | null>(() => {
    const id = this.fijadoLocal() ?? this._foco();
    return this._mosaicos().find(m => m.identidad === id) ?? null;
  });

  readonly principal = computed<Pantalla | null>(() => {
    const ps = this._pantallas();
    return ps.find(p => p.clave === this.pantallaGrande()) ?? ps[0] ?? null;
  });

  readonly columnas = computed(() => {
    const n = this.modo() === 'multipantalla' ? this._pantallas().length : this.visibles().length;
    return n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : n <= 16 ? 4 : 5;
  });

  iniciales(nombre: string): string {
    return nombre.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase()).join('');
  }

  alternarFijado(m: Mosaico): void {
    this.fijadoLocal.set(this.fijadoLocal() === m.identidad ? null : m.identidad);
  }

  trackM = (_: number, m: Mosaico) => m.identidad;
  trackP = (_: number, p: Pantalla) => p.clave;
}
