import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { SeguridadVivoService } from '../../services/seguridad-vivo.service';

/**
 * Marco del módulo: cabecera con el estado del canal en vivo y los incidentes sin
 * reconocer, y las pestañas. Abre la conexión SSE al entrar y la cierra al salir.
 */
@Component({
  selector: 'app-seguridad-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.html',
  styleUrls: ['../../styles/seguridad-comun.css', './shell.css'],
})
export class SeguridadShell {
  readonly vivo = inject(SeguridadVivoService);

  readonly pestanas = [
    { ruta: 'resumen', texto: 'Resumen', icono: 'shield' },
    { ruta: 'monitoreo', texto: 'Centro de monitoreo', icono: 'videocam' },
    { ruta: 'grabaciones', texto: 'Grabaciones', icono: 'video_library' },
    { ruta: 'analitica', texto: 'Analítica IA', icono: 'insights' },
    { ruta: 'rostros', texto: 'Rostros', icono: 'face' },
    { ruta: 'domotica', texto: 'Domótica y accesos', icono: 'door_sensor' },
    { ruta: 'audio', texto: 'Audio y parlantes', icono: 'campaign' },
    { ruta: 'alertas', texto: 'Alertas y protocolos', icono: 'notification_important' },
    { ruta: 'configuracion', texto: 'Configuración', icono: 'tune' },
  ];

  readonly canalTexto = computed(() => {
    switch (this.vivo.canal()) {
      case 'conectado': return 'En vivo';
      case 'conectando': return 'Conectando…';
      case 'reconectando': return 'Reconectando…';
      default: return 'Desconectado';
    }
  });
  readonly canalTono = computed(() => {
    const c = this.vivo.canal();
    return c === 'conectado' ? 'ok' : c === 'cerrado' ? 'danger' : 'warn';
  });

  constructor() {
    this.vivo.abrir();
    inject(DestroyRef).onDestroy(() => this.vivo.cerrar());
  }
}
