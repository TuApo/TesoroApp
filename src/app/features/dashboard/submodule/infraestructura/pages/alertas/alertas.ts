import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

import { Evento, LineaLog, NOMBRE_SEVERIDAD, Severidad } from '../../models/infra.models';
import { InfraService } from '../../services/infra.service';
import { InfraVivoService } from '../../services/infra-vivo.service';
import { fecha, hace, hora } from '../../utils/formato';

const ICONO: Record<Severidad, string> = { critico: 'error', serio: 'warning', atencion: 'info', info: 'bolt' };

/** Alertas de Alertmanager, la bitácora completa de cambios y un visor de logs por contenedor. */
@Component({
  selector: 'app-infra-alertas',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './alertas.html',
  styleUrls: ['../../styles/infra-comun.css', './alertas.css'],
})
export class InfraAlertas {
  private readonly api = inject(InfraService);
  readonly vivo = inject(InfraVivoService);
  readonly f = { fecha, hace, hora };
  readonly icono = ICONO;
  readonly nombreSev = NOMBRE_SEVERIDAD;

  readonly historia = signal<Evento[]>([]);
  readonly filtroSev = signal<Severidad | ''>('');
  readonly filtroTexto = signal('');

  readonly eventos = computed(() => {
    const ids = new Set<string>();
    const todos = [...this.vivo.eventos(), ...this.historia()].filter((e) => (ids.has(e.id) ? false : (ids.add(e.id), true)));
    const sev = this.filtroSev();
    const q = this.filtroTexto().trim().toLowerCase();
    return todos
      .filter((e) => !sev || e.severidad === sev)
      .filter((e) => !q || `${e.mensaje} ${e.objeto ?? ''} ${e.tipo}`.toLowerCase().includes(q))
      .sort((a, b) => b.ts - a.ts);
  });

  readonly contenedores = computed(() => (this.vivo.snapshot()?.contenedores ?? [])
    .filter((c) => c.nombre.startsWith('tuapo-')).map((c) => c.nombre).sort());
  readonly contenedorLogs = signal('');
  readonly nivel = signal<'error' | 'warn' | 'todo'>('error');
  readonly logs = signal<LineaLog[] | null>(null);
  readonly cargandoLogs = signal(false);
  readonly errorLogs = signal<string | null>(null);

  constructor() {
    this.api.eventos(500).subscribe({ next: (l) => this.historia.set(l) });
  }

  leerLogs() {
    const c = this.contenedorLogs();
    if (!c) return;
    this.cargandoLogs.set(true);
    this.errorLogs.set(null);
    this.api.logs(c, this.nivel(), 150).subscribe({
      next: (l) => { this.logs.set(l); this.cargandoLogs.set(false); },
      error: (e) => { this.cargandoLogs.set(false); this.logs.set(null); this.errorLogs.set(e?.error?.message ?? 'No se pudieron leer los logs.'); },
    });
  }
}
