import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { mensajeDeError } from '../../../../../../shared/utils/mensaje-error';
import {
  ESTADOS_ACTIVOS, IncidenteDetalle, NOMBRE_ESTADO_INCIDENTE, NOMBRE_ORIGEN, NOMBRE_SEVERIDAD,
} from '../../models/seguridad.models';
import { AccionesSeguridad } from '../../services/acciones.service';
import { SeguridadService } from '../../services/seguridad.service';
import { SeguridadVivoService } from '../../services/seguridad-vivo.service';
import { cronometro, fechaHora, hora, tonoSeveridad } from '../../utils/formato';
import { SgImagen } from '../imagen-segura/imagen-segura';

const ICONO_BITACORA: Record<string, string> = {
  CREADO: 'add_alert', NOTIFICACION: 'send', AVISO: 'send', RECONOCIDO: 'task_alt', COMENTARIO: 'chat', ESCALADO: 'trending_up',
  CERRADO: 'check_circle', DISPOSITIVO: 'settings_remote', PARLANTE: 'campaign', SIN_RESPUESTA: 'phone_missed', ERROR: 'error',
};

/**
 * Ficha completa de una alarma: captura, estado del escalamiento, acciones, eventos (con sus
 * capturas) y la bitácora como línea de tiempo (quién fue avisado, por dónde, quién no
 * respondió, quién la reconoció). Se recarga sola cuando llega un cambio por el canal en vivo.
 */
@Component({
  selector: 'sg-detalle-incidente',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule, SgImagen],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './detalle-incidente.html',
  styleUrls: ['../../styles/seguridad-comun.css', './detalle-incidente.css'],
})
export class DetalleIncidente {
  private readonly api = inject(SeguridadService);
  private readonly vivo = inject(SeguridadVivoService);
  readonly acciones = inject(AccionesSeguridad);

  readonly incidenteId = input.required<string>();
  readonly cerrar = output<void>();
  readonly verCamara = output<string>();

  readonly detalle = signal<IncidenteDetalle | null>(null);
  readonly error = signal<string | null>(null);
  readonly ahora = signal(Date.now());

  readonly f = { fechaHora, hora, cronometro, tonoSeveridad };
  readonly nombreSev = NOMBRE_SEVERIDAD;
  readonly nombreEstado = NOMBRE_ESTADO_INCIDENTE;
  readonly nombreOrigen = NOMBRE_ORIGEN;

  readonly activo = computed(() => { const d = this.detalle(); return !!d && ESTADOS_ACTIVOS.includes(d.estado); });
  readonly sinReconocer = computed(() => { const d = this.detalle(); return !!d && (d.estado === 'ABIERTO' || d.estado === 'NOTIFICANDO'); });
  readonly bitacora = computed(() => [...(this.detalle()?.bitacora ?? [])].sort((a, b) => (a.creado_en || '').localeCompare(b.creado_en || '')));

  constructor() {
    effect(() => {
      const id = this.incidenteId();
      this.vivo.versionIncidentes();
      untracked(() => this.cargar(id));
    });
    const t = setInterval(() => this.ahora.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
  }

  cargar(id = this.incidenteId()): void {
    this.api.incidente(id).subscribe({
      next: (d) => { this.detalle.set(d); this.error.set(null); },
      error: (e) => this.error.set(mensajeDeError(e, 'No se pudo leer la alarma.')),
    });
  }

  desde(iso: string | null): number { return iso ? Math.max(0, (this.ahora() - new Date(iso).getTime()) / 1000) : 0; }
  hasta(iso: string | null): number | null { return iso ? Math.round((new Date(iso).getTime() - this.ahora()) / 1000) : null; }
  icono(tipo: string): string { return ICONO_BITACORA[tipo] ?? 'radio_button_checked'; }

  async reconocer(): Promise<void> { const d = this.detalle(); if (d && await this.acciones.reconocer(d, true)) this.cargar(); }
  async comentar(): Promise<void> { const d = this.detalle(); if (d && await this.acciones.comentar(d)) this.cargar(); }
  async escalar(): Promise<void> { const d = this.detalle(); if (d && await this.acciones.escalar(d)) this.cargar(); }
  async cerrarIncidente(): Promise<void> { const d = this.detalle(); if (d && await this.acciones.cerrar(d)) this.cargar(); }
}
