import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { InfraVivoService } from '../../services/infra-vivo.service';
import { hora } from '../../utils/formato';

/**
 * Marco del módulo: cabecera con el pulso del canal en vivo y las pestañas. Abre la
 * conexión SSE al entrar y la cierra al salir; todas las pestañas leen de ella.
 */
@Component({
  selector: 'app-infra-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.html',
  styleUrls: ['../../styles/infra-comun.css', './shell.css'],
})
export class InfraShell {
  readonly vivo = inject(InfraVivoService);

  readonly pestanas = [
    { ruta: 'resumen', texto: 'Resumen', icono: 'monitor_heart' },
    { ruta: '3d', texto: 'Vista 3D', icono: 'view_in_ar' },
    { ruta: 'servicios', texto: 'Servicios', icono: 'dns' },
    { ruta: 'sitios', texto: 'Sitios', icono: 'language' },
    { ruta: 'red', texto: 'Red', icono: 'lan' },
    { ruta: 'datos', texto: 'Datos', icono: 'storage' },
    { ruta: 'cluster', texto: 'Clúster', icono: 'hub' },
    { ruta: 'ubicaciones', texto: 'Ubicaciones', icono: 'travel_explore' },
    { ruta: 'alertas', texto: 'Alertas y logs', icono: 'notifications_active' },
    { ruta: 'informes', texto: 'Informes', icono: 'summarize' },
    { ruta: 'devops', texto: 'DevOps', icono: 'rocket_launch' },
  ];

  readonly salud = computed(() => this.vivo.snapshot()?.salud ?? null);

  readonly canalTexto = computed(() => {
    const c = this.vivo.canal();
    const s = this.vivo.snapshot();
    const edad = this.vivo.antiguedad();
    if (c === 'conectado' && s) return edad > 20 ? `Sin datos nuevos hace ${edad} s` : `En vivo · ${hora(s.ts)}`;
    if (c === 'conectando') return 'Conectando…';
    if (c === 'reconectando') return 'Reconectando…';
    return 'Desconectado';
  });

  readonly canalTono = computed(() => {
    const c = this.vivo.canal();
    if (c === 'conectado' && this.vivo.antiguedad() <= 20) return 'ok';
    if (c === 'cerrado') return 'danger';
    return 'warn';
  });

  constructor() {
    this.vivo.abrir();
    inject(DestroyRef).onDestroy(() => this.vivo.cerrar());
  }
}
