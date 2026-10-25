import { obtenerUsuarioActual } from '../utils/usuario-actual';
import { ArchivosNativos } from '../nativo/archivos-nativos';
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom, timeout } from 'rxjs';
import Swal from 'sweetalert2';

import { environment } from '../../../environments/environment';

import { QuickAccessService } from '../security/quick-access.service';
import { leerRefresh } from '../security/renovacion-token';
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
  private readonly http = inject(HttpClient);

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
    // Lo que el teléfono guardó para trabajar sin señal es de ESTA persona: la lista de su
    // personal (datos personales de terceros) sale siempre al cerrar sesión; sus envíos
    // pendientes se quedan, igual que la cola, salvo «Borrar y salir».
    const usuario = obtenerUsuarioActual().id;
    if (usuario) await ArchivosNativos.borrar(usuario, 'personal/mi-personal.json').catch(() => null);

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

      await this.revocarEnServidor();

      if (result.isDenied) {
        clearLocalStorage();
        // "Borrar y salir" significa dejar el equipo limpio: eso incluye el
        // acceso rápido guardado. El logout normal NO lo toca, porque su razón
        // de ser es sobrevivir al cierre de sesión.
        await this.quickAccess.olvidar().catch(() => null);
        if (usuario) await ArchivosNativos.borrarUsuario(usuario).catch(() => null);
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
    await this.revocarEnServidor();
    clearLocalStorage();
    const cache: Promise<any> = electronApi?.db?.clearCache
      ? electronApi.db.clearCache().catch(() => null)
      : electronApi?.db?.clearUserData
        ? electronApi.db.clearUserData().catch(() => null)
        : Promise.resolve();
    cache.finally(() => this.router.navigate(['']));
  }

  /**
   * Avisa al backend para que revoque el JWT (su jti queda en Redis hasta que venza). Sin esto el
   * token seguía sirviendo las 8 h completas después de salir: cualquiera que lo hubiera copiado
   * del equipo lo podía seguir usando. Va ANTES de clearLocalStorage porque el interceptor lee el
   * token en el momento de enviar. Nunca bloquea la salida: sin red, con el servidor caído o con el
   * token ya vencido, la sesión se cierra igual en el equipo (tope de 3 s).
   */
  private async revocarEnServidor(): Promise<void> {
    // El refresh también se revoca: si no, quien lo copiara podría sacar access tokens nuevos 7 días.
    const refresh = leerRefresh();
    try {
      await firstValueFrom(
        this.http.post(`${environment.apiUrl}/gestion_admin/auth/logout/`, refresh ? { refresh_token: refresh } : null)
          .pipe(timeout(3000)),
      );
    } catch {
      // Sin revocar en servidor: el token vence solo. No hay nada que hacer en el front.
    }
  }
}
