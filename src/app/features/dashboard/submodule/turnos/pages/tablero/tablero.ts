import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

import { SelectorOficina } from '../../components/selector-oficina/selector-oficina';
import { ContextoTurnosService } from '../../service/contexto-turnos.service';
import { Pagina, Tablero, Turno, TurnosService } from '../../service/turnos.service';
import { etiquetaEstado } from '../../components/panel-atencion/panel-atencion';

/** Esperas, atención por asesor y horas pico, con barras SVG sin dependencias. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-turnos-tablero',
  imports: [CommonModule, FormsModule, MatIconModule, SelectorOficina],
  templateUrl: './tablero.html',
  styleUrls: ['../../styles/turnos-comun.css', './tablero.css'],
})
export class TableroTurnos implements OnInit {
  readonly ctx = inject(ContextoTurnosService);
  private api = inject(TurnosService);

  desde = new Date().toISOString().slice(0, 10);
  hasta = new Date().toISOString().slice(0, 10);
  readonly tablero = signal<Tablero | null>(null);
  readonly historial = signal<Pagina<Turno> | null>(null);
  readonly pagina = signal(0);
  readonly cargando = signal(false);

  readonly totales = computed(() => {
    const f = this.tablero()?.por_servicio ?? [];
    const emitidos = f.reduce((s, r) => s + r.emitidos, 0);
    const atendidos = f.reduce((s, r) => s + r.atendidos, 0);
    const ausentes = f.reduce((s, r) => s + r.ausentes, 0);
    const conEspera = f.filter(r => r.espera_prom_seg);
    const espera = conEspera.length ? Math.round(conEspera.reduce((s, r) => s + (r.espera_prom_seg ?? 0), 0) / conEspera.length / 60) : null;
    const maxEspera = f.reduce((m, r) => Math.max(m, r.espera_max_seg ?? 0), 0);
    return { emitidos, atendidos, ausentes, espera, maxEspera: Math.round(maxEspera / 60) };
  });
  readonly maxHora = computed(() => Math.max(1, ...(this.tablero()?.por_hora ?? []).map(h => h.emitidos)));
  readonly maxAsesor = computed(() => Math.max(1, ...(this.tablero()?.por_asesor ?? []).map(a => a.atendidos)));
  readonly horas = computed(() => {
    const mapa = new Map((this.tablero()?.por_hora ?? []).map(h => [h.hora, h]));
    return Array.from({ length: 24 }, (_, h) => mapa.get(h) ?? { hora: h, emitidos: 0, espera_prom_seg: null });
  });

  constructor() {
    effect(() => {
      const id = this.ctx.oficinaId();
      untracked(() => this.cargar(id));
    });
  }

  ngOnInit(): void { this.ctx.cargar(); }

  rango(dias: number): void {
    const h = new Date();
    const d = new Date(Date.now() - (dias - 1) * 86400000);
    this.desde = d.toISOString().slice(0, 10);
    this.hasta = h.toISOString().slice(0, 10);
    this.cargar(this.ctx.oficinaId());
  }

  cargar(id: string | null): void {
    if (!id) { this.tablero.set(null); this.historial.set(null); return; }
    this.cargando.set(true);
    this.api.tablero(id, this.desde, this.hasta).subscribe({ next: t => { this.tablero.set(t); this.cargando.set(false); }, error: () => this.cargando.set(false) });
    this.pagina.set(0);
    this.cargarHistorial();
  }

  cargarHistorial(): void {
    const id = this.ctx.oficinaId();
    if (!id) return;
    this.api.historial(id, this.desde, this.hasta, this.pagina(), 40).subscribe({ next: h => this.historial.set(h), error: () => {} });
  }

  irPagina(d: number): void { this.pagina.update(p => Math.max(0, p + d)); this.cargarHistorial(); }

  estado(t: Turno): string { return etiquetaEstado(t.estado); }
  min(seg: number | null): string { return seg == null ? '—' : `${Math.round(seg / 60)} min`; }
  claseEstado(e: string): string {
    return { ATENDIDO: 'tn-chip--ok', EN_ATENCION: 'tn-chip--ok', LLAMADO: 'tn-chip--warn', NO_SE_PRESENTO: 'tn-chip--danger', CANCELADO: 'tn-chip--danger', TRANSFERIDO: 'tn-chip--violet' }[e] ?? '';
  }
}
