import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Router, RouterLink } from '@angular/router';

import { Informe, InformeMeta, NOMBRE_GRUPO, NOMBRE_SEVERIDAD, Rango, Severidad } from '../../models/infra.models';
import { InfraService } from '../../services/infra.service';
import { bytes, compacto, fecha, ms, num, pct } from '../../utils/formato';

const ICONO: Record<Severidad, string> = { critico: 'error', serio: 'warning', atencion: 'info', info: 'check_circle' };

/**
 * Informes de infraestructura: se generan solos (diario, semanal y mensual) o a pedido.
 * Cada uno es una foto del periodo con resumen escrito, hallazgos, uso por servicio,
 * sitios, red y datos; se imprime o se guarda como PDF desde el navegador.
 */
@Component({
  selector: 'app-infra-informes',
  standalone: true,
  imports: [MatIconModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './informes.html',
  styleUrls: ['../../styles/infra-comun.css', './informes.css'],
})
export class InfraInformes {
  private readonly api = inject(InfraService);
  private readonly router = inject(Router);
  readonly f = { bytes, compacto, fecha, ms, num, pct };
  readonly icono = ICONO;
  readonly nombreSev = NOMBRE_SEVERIDAD;
  readonly nombreGrupo = NOMBRE_GRUPO;

  /** Con id en la ruta se ve el informe; sin él, la lista. */
  readonly id = input<string | undefined>(undefined);

  readonly lista = signal<InformeMeta[]>([]);
  readonly informe = signal<Informe | null>(null);
  readonly generando = signal<Rango | null>(null);
  readonly error = signal<string | null>(null);

  readonly ociosos = computed(() => (this.informe()?.uso.servicios ?? []).filter((s) => s.eficiencia === 'ocioso'));
  readonly conSugerencias = computed(() => (this.informe()?.uso.servicios ?? []).filter((s) => (s.recomendaciones?.length ?? 0) > 0));

  constructor() {
    this.cargarLista();
    effect(() => {
      const id = this.id();
      untracked(() => {
        this.informe.set(null);
        this.error.set(null);
        if (id) this.api.informe(id).subscribe({ next: (i) => this.informe.set(i), error: () => this.error.set('No se encontró ese informe.') });
      });
    });
  }

  cargarLista() {
    this.api.informes().subscribe({ next: (l) => this.lista.set(l) });
  }

  generar(r: Rango) {
    this.generando.set(r);
    this.error.set(null);
    this.api.generarInforme(r).subscribe({
      next: (i) => { this.generando.set(null); this.cargarLista(); void this.router.navigate(['/dashboard/infraestructura/informes', i.id]); },
      error: () => { this.generando.set(null); this.error.set('No se pudo generar el informe. Inténtelo de nuevo en un minuto.'); },
    });
  }

  imprimir() {
    window.print();
  }

  nombreRango(r: Rango): string {
    return r === '24h' ? 'Diario (24 h)' : r === '7d' ? 'Semanal (7 días)' : r === '30d' ? 'Mensual (30 días)' : r;
  }
}
