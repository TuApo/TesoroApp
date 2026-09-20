import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';

import { Campana, Marca, MarketingService, ResumenCampana } from '../../service/marketing.service';

/**
 * Las campañas.
 *
 * <p><b>Una campaña no es una etiqueta.</b> Si solo agrupara piezas bastaría un campo de
 * texto; lo que la justifica es poder preguntar "la convocatoria de temporada alta, ¿cuánta
 * gente trajo?" y que el número salga solo. Por eso cada tarjeta se abre a su propio
 * embudo, medido dentro de su periodo y no en los últimos treinta días.
 */
@Component({
  selector: 'app-mk-campanas',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './campanas.component.html',
  styleUrl: './campanas.component.css',
})
export class CampanasComponent implements OnInit {
  private readonly api = inject(MarketingService);

  readonly cargando = signal(true);
  readonly marcas = signal<Marca[]>([]);
  readonly marcaId = signal('');
  readonly lista = signal<Campana[]>([]);
  readonly editando = signal<Partial<Campana> | null>(null);
  readonly guardando = signal(false);

  /** La campaña abierta y sus cifras. */
  readonly abierta = signal<ResumenCampana | null>(null);
  readonly cargandoResumen = signal(false);

  ngOnInit(): void {
    this.api.marcas().subscribe({
      next: (m) => {
        this.marcas.set(m);
        const pred = m.find((x) => x.predeterminada) ?? m[0];
        if (pred) { this.marcaId.set(pred.id); this.cargar(); } else { this.cargando.set(false); }
      },
      error: () => this.cargando.set(false),
    });
  }

  cambiarMarca(id: string): void { this.marcaId.set(id); this.cargar(); }

  private cargar(): void {
    this.cargando.set(true);
    this.api.campanas(this.marcaId()).subscribe({
      next: (l) => { this.lista.set(l); this.cargando.set(false); },
      error: () => this.cargando.set(false),
    });
  }

  // ── formulario ──────────────────────────────────────────────────────────

  nueva(): void {
    this.editando.set({ marca_id: this.marcaId(), nombre: '', objetivo: '', publico: '' });
  }

  editar(c: Campana): void { this.editando.set({ ...c }); }
  cerrarForm(): void { this.editando.set(null); }

  campo<K extends keyof Campana>(k: K, v: Campana[K]): void {
    this.editando.set({ ...this.editando(), [k]: v });
  }

  guardar(): void {
    const e = this.editando();
    if (!e?.nombre) return;
    this.guardando.set(true);
    const cuerpo: Partial<Campana> = {
      marca_id: this.marcaId(), nombre: e.nombre, objetivo: e.objetivo,
      publico: e.publico, desde: e.desde || null, hasta: e.hasta || null,
    };
    const obs = e.id ? this.api.editarCampana(e.id, cuerpo) : this.api.crearCampana(cuerpo);
    obs.subscribe({
      next: () => {
        this.guardando.set(false); this.editando.set(null); this.cargar();
        Swal.fire({ icon: 'success', title: 'Guardada', timer: 1300, showConfirmButton: false });
      },
      error: (err) => {
        this.guardando.set(false);
        // El backend explica en castellano qué falta; repetirlo es más útil que un genérico.
        Swal.fire({ icon: 'error', title: 'Un momento',
                    text: err?.error?.error ?? 'No se pudo guardar' });
      },
    });
  }

  // ── estado ──────────────────────────────────────────────────────────────

  cambiarEstado(c: Campana, estado: string): void {
    this.api.estadoCampana(c.id, estado).subscribe({
      next: () => { this.cargar(); const a = this.abierta(); if (a?.campana.id === c.id) this.abrir(c); },
      error: (err) => Swal.fire({ icon: 'error', title: 'No se pudo cambiar',
                                  text: err?.error?.error ?? '' }),
    });
  }

  // ── detalle ─────────────────────────────────────────────────────────────

  abrir(c: Campana): void {
    this.cargandoResumen.set(true);
    this.abierta.set(null);
    this.api.resumenCampana(c.id).subscribe({
      next: (r) => { this.abierta.set(r); this.cargandoResumen.set(false); },
      error: () => this.cargandoResumen.set(false),
    });
  }

  cerrarDetalle(): void { this.abierta.set(null); }

  // ── presentación ────────────────────────────────────────────────────────

  periodo(c: Campana): string {
    if (!c.desde || !c.hasta) return 'Sin periodo declarado';
    return `Del ${c.desde} al ${c.hasta}`;
  }

  /** Lo que hay que hacer con esta campaña ahora mismo, en una frase. */
  aviso(c: Campana): string | null {
    if (c.estado === 'CERRADA') return null;
    if (c.estado === 'ACTIVA' && !c.en_plazo && c.hasta) return `Terminó el ${c.hasta}. Ciérrala o amplía la fecha.`;
    if (c.estado === 'ACTIVA' && c.dias_restantes !== null && c.dias_restantes <= 7) {
      return `Le quedan ${c.dias_restantes} día${c.dias_restantes === 1 ? '' : 's'}.`;
    }
    if (c.estado === 'BORRADOR') return 'En borrador: todavía no etiqueta nada.';
    return null;
  }
}
