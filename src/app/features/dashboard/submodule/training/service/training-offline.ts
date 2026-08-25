import { Injectable, inject, signal } from '@angular/core';
import { OfflineSyncService } from '../../../../../core/services/offline-sync.service';
import { NetworkStatusService } from '../../../../../core/services/network-status.service';

/**
 * Lo que hace falta para que el módulo funcione sin señal, y NADA más.
 *
 * La app ya tiene la maquinaria offline: `offlineInterceptor` cachea las GET y encola las
 * escrituras cuando no hay red (IndexedDB en web/Android, SQLite en Electron). Reimplementar
 * eso aquí sería tener dos colas que se pisan. Lo que falta y sí vive aquí son dos cosas:
 *
 * 1. **El `client_event_id` estable.** El backend deduplica por ese id: si la app lo regenera
 *    en cada reintento, la deduplicación no sirve de nada y el mismo avance se cuenta dos
 *    veces. Aquí se genera UNA vez por (tipo, recurso) y se conserva hasta que el envío se
 *    confirma.
 * 2. **Saber cuánto falta por sincronizar**, para poder decírselo a la persona. En finca, "se
 *    guardó" y "llegó al servidor" no son lo mismo, y quien está cumpliendo una capacitación
 *    obligatoria necesita saber en cuál de los dos está.
 *
 * La cuenta se pide a `OfflineSyncService` y no a la base directamente porque ese servicio ya
 * filtra la cola por el usuario logueado: en un equipo compartido (el caso normal en oficina)
 * leer la cola cruda mostraría los pendientes de otra persona.
 */
@Injectable({ providedIn: 'root' })
export class TrainingOffline {
  private sync = inject(OfflineSyncService);
  private network = inject(NetworkStatusService);

  private static readonly PREFIJO = 'cap.evt.';

  /** Cambios que todavía no llegaron al servidor. La UI lo muestra sin adornos. */
  readonly pendientes = signal(0);

  get enLinea(): boolean {
    return this.network.isOnline;
  }

  /**
   * Id de evento estable para un recurso.
   *
   * Sobrevive a recargas de la página y a reintentos porque vive en localStorage: el caso real
   * es la persona que completa la lección sin señal, cierra la app, y vuelve dos días después.
   */
  idDeEvento(tipo: string, recursoId: string): string {
    const clave = `${TrainingOffline.PREFIJO}${tipo}.${recursoId}`;
    let id = localStorage.getItem(clave);
    if (!id) {
      id = this.uuid();
      localStorage.setItem(clave, id);
    }
    return id;
  }

  /**
   * Confirma que el envío llegó: el siguiente cambio sobre ese recurso será un evento nuevo.
   * Sin esto, marcar dos lecciones distintas reutilizaría el mismo id y la segunda se
   * descartaría por duplicada.
   */
  confirmar(tipo: string, recursoId: string): void {
    localStorage.removeItem(`${TrainingOffline.PREFIJO}${tipo}.${recursoId}`);
  }

  /** Momento REAL del hecho. El backend distingue esto de cuándo se enteró. */
  ahora(): string {
    return new Date().toISOString();
  }

  async refrescarPendientes(): Promise<void> {
    try {
      const cola = await this.sync.getPendingRequests();
      this.pendientes.set(cola.filter(i => i.url.includes('/learning/')).length);
    } catch {
      // Sin almacenamiento offline (SSR o navegador viejo) simplemente no se muestra el contador.
      this.pendientes.set(0);
    }
  }

  private uuid(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    // Navegadores de gama baja sin crypto.randomUUID: no hace falta que sea criptográfico,
    // solo que no colisione con los eventos de esta misma persona.
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }
}
