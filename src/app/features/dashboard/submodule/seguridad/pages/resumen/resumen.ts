import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';

import { mensajeDeError } from '../../../../../../shared/utils/mensaje-error';
import { SgImagen } from '../../components/imagen-segura/imagen-segura';
import { Evento, NOMBRE_ORIGEN, NOMBRE_SEVERIDAD, Tablero } from '../../models/seguridad.models';
import { SeguridadService } from '../../services/seguridad.service';
import { SeguridadVivoService } from '../../services/seguridad-vivo.service';
import { cronometro, hace, horaCorta, tonoSeveridad } from '../../utils/formato';

/**
 * Primera pantalla: ¿está todo en orden ahora? KPIs, una tarjeta por sede (armada, cámaras en
 * línea, ocupación, alarmas) y la bitácora de eventos en vivo.
 */
@Component({
  selector: 'app-seguridad-resumen',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule, RouterLink, SgImagen],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './resumen.html',
  styleUrls: ['../../styles/seguridad-comun.css', './resumen.css'],
})
export class SeguridadResumen {
  private readonly api = inject(SeguridadService);
  readonly vivo = inject(SeguridadVivoService);

  readonly tablero = signal<Tablero | null>(null);
  readonly error = signal<string | null>(null);
  readonly ahora = signal(Date.now());

  readonly f = { hace, horaCorta, cronometro, tonoSeveridad };
  readonly nombreSev = NOMBRE_SEVERIDAD;
  readonly nombreOrigen = NOMBRE_ORIGEN;

  /** Los eventos en vivo mandan sobre los que traía el tablero. */
  readonly eventos = computed<Evento[]>(() => this.vivo.eventos().slice(0, 30));
  readonly incidentes = computed(() => this.vivo.incidentes().slice(0, 6));

  constructor() {
    this.cargar();
    const t = setInterval(() => this.cargar(), 60_000);
    const r = setInterval(() => this.ahora.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => { clearInterval(t); clearInterval(r); });
  }

  cargar(): void {
    this.api.tablero().subscribe({
      next: (t) => { this.tablero.set(t); this.error.set(null); },
      error: (e) => this.error.set(mensajeDeError(e, 'No se pudo leer el tablero de seguridad.')),
    });
  }

  segundosDesde(iso: string): number { return Math.max(0, (this.ahora() - new Date(iso).getTime()) / 1000); }
}
