import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';

import { QuickAccessService } from '../security/quick-access.service';
import { clearLocalStorage } from '../utils/safe-storage';
import { puenteOffline } from '../offline/puente-offline';

/**
 * Cierre de sesión. Vivía en el menú lateral; se movió aquí para poder salir
 * desde el menú del perfil (arriba a la derecha) sin duplicar la lógica.
 */
@Injectable({ providedIn: 'root' })
export class SesionService {
  private readonly router = inject(Router);
  private readonly quickAccess = inject(QuickAccessService);

  /**
   * Si hay envíos encolados sin sincronizar, AVISA antes de borrar. Antes el
   * logout silencioso evaporaba 30 PDFs encolados sin forma de recuperarlos.
   * La cola sobrevive al logout normal y solo se borra si la persona lo confirma.
   */
  async cerrarSesion(pendientes: number): Promise<void> {
    // Puente al almacén local: SQLite en Electron, IndexedDB en navegador/APK.
    // Tiene que ser el mismo que usa la cola, o el logout no borraría nada fuera
    // del escritorio y el siguiente usuario del equipo heredaría la caché.
    const electronApi = puenteOffline();

    if (pendientes > 0) {
      const result = await Swal.fire({
        icon: 'warning',
        title: `Tienes ${pendientes} envío(s) pendiente(s)`,
        html:
          'Hay datos / archivos esperando subir cuando vuelvas a tener red.<br><br>' +
          '<b>Mantener pendientes:</b> se reproducirán cuando vuelvas a entrar con tu usuario.<br>' +
          '<b>Borrar y salir:</b> se perderán definitivamente.',
        showDenyButton: true,
        showCancelButton: true,
        confirmButtonText: 'Mantener pendientes y salir',
        denyButtonText: 'Borrar y salir',
        cancelButtonText: 'Cancelar',
        reverseButtons: true,
      });

      if (result.isDismissed) return;

      if (result.isDenied) {
        clearLocalStorage();
        // "Borrar y salir" significa dejar el equipo limpio: eso incluye el
        // acceso rápido guardado. El logout normal NO lo toca, porque su razón
        // de ser es sobrevivir al cierre de sesión.
        await this.quickAccess.olvidar().catch(() => null);
        const wipe: Promise<any> = electronApi?.db?.clearUserData
          ? electronApi.db.clearUserData().catch(() => null)
          : Promise.resolve();
        wipe.finally(() => this.router.navigate(['']));
        return;
      }

      // Mantener la cola: borrar SOLO el caché de GETs.
      clearLocalStorage();
      const cache: Promise<any> = electronApi?.db?.clearCache
        ? electronApi.db.clearCache().catch(() => null)
        : Promise.resolve();
      cache.finally(() => this.router.navigate(['']));
      return;
    }

    // Sin pendientes: solo se borra el caché (la cola está vacía).
    clearLocalStorage();
    const cache: Promise<any> = electronApi?.db?.clearCache
      ? electronApi.db.clearCache().catch(() => null)
      : electronApi?.db?.clearUserData
        ? electronApi.db.clearUserData().catch(() => null)
        : Promise.resolve();
    cache.finally(() => this.router.navigate(['']));
  }
}
