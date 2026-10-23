import { Injectable, inject } from '@angular/core';
import { NotificationCenterService } from '../../../../../core/services/notification-center.service';

/**
 * Enlace con la campana de la plataforma (Centro de Notificaciones): cuando la persona
 * lee un chat, los avisos de ese chat que tenga sin leer en la campana quedan leídos.
 *
 * Espera un par de segundos antes de barrer: el aviso lo crea ms-auth-admin a partir del
 * evento de Kafka y puede llegar un instante DESPUÉS del mensaje que se está leyendo.
 */
@Injectable({ providedIn: 'root' })
export class AvisosChatService {
  private readonly centro = inject(NotificationCenterService);
  private readonly pendientes = new Set<string>();
  private espera: ReturnType<typeof setTimeout> | null = null;

  marcarLeidos(conversacionId: string | null | undefined): void {
    if (!conversacionId) return;
    this.pendientes.add(conversacionId);
    if (this.espera) clearTimeout(this.espera);
    this.espera = setTimeout(() => this.barrer(), 2500);
  }

  private barrer(): void {
    const ids = [...this.pendientes];
    this.pendientes.clear();
    this.espera = null;
    if (!ids.length) return;
    this.centro.list({ soloNoLeidas: true, size: 100 }).subscribe({
      next: avisos => {
        for (const n of avisos ?? []) {
          const destino = n.destino_valor ?? '';
          if (!n.leida && ids.some(id => destino.includes(`c=${id}`))) {
            this.centro.markRead(n.id).subscribe({ error: () => undefined });
          }
        }
      },
      error: () => undefined,
    });
  }
}
