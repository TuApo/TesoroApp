import { Injectable, computed, inject, signal } from '@angular/core';
import { BandejaApiService } from './bandeja-api.service';
import { ResumenBandeja } from './bandeja.models';
import { obtenerUsuarioActual } from '@/app/core/utils/usuario-actual';

/**
 * Estado compartido por las vistas de la Bandeja (lo provee el marco de la bandeja).
 * `usuario` = la bandeja que se mira: null es la propia; otro id es supervisión (solo lectura).
 */
@Injectable()
export class BandejaEstadoService {
  private readonly api = inject(BandejaApiService);

  readonly usuario = signal<string | null>(null);
  readonly nombreSupervisado = signal<string | null>(null);
  readonly resumen = signal<ResumenBandeja | null>(null);
  readonly cargando = signal(false);
  readonly yo = obtenerUsuarioActual();

  /** Mirando la bandeja de otra persona (solo lectura). */
  readonly supervisando = computed(() => !!this.usuario() && this.usuario() !== this.yo.id);

  async refrescar(): Promise<void> {
    this.cargando.set(true);
    try {
      this.resumen.set(await this.api.resumen(this.supervisando() ? this.usuario() : null));
    } catch {
      this.resumen.set(null);
    } finally {
      this.cargando.set(false);
    }
  }
}
