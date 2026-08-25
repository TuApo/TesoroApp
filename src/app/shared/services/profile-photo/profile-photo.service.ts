import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import {
  getLocalStorageItem,
  setLocalStorageItem,
  removeLocalStorageItem,
} from '../../../core/utils/safe-storage';
import { UtilityServiceService } from '../utilityService/utility-service.service';

/**
 * Foto de perfil del usuario logueado.
 *
 * Se guarda como data-URL (JPEG ya reescalado por quien la sube) en
 * `localStorage`, con clave por documento del usuario para que dos cuentas en
 * el mismo dispositivo no compartan avatar. Es un almacenamiento 100 % en el
 * cliente: no toca el backend ni ningún dato real de la BD, así que subir o
 * quitar la foto nunca es destructivo.
 *
 * El `BehaviorSubject` mantiene sincronizados en vivo el menú de perfil del
 * header y la página de Cuenta: al cambiar la foto en un sitio, el otro se
 * actualiza sin recargar.
 */
@Injectable({ providedIn: 'root' })
export class ProfilePhotoService {
  private static readonly PREFIX = 'profile_photo_';

  private readonly _photo$ = new BehaviorSubject<string | null>(null);
  /** Foto actual (data-URL) o `null` si no hay. Emite el valor vigente al suscribirse. */
  readonly photo$: Observable<string | null> = this._photo$.asObservable();

  constructor(private readonly util: UtilityServiceService) {
    this.reload();
  }

  /** Valor sincrónico actual. */
  getPhoto(): string | null {
    return this._photo$.value;
  }

  /** Re-lee la foto del usuario vigente (llamar al entrar a una vista o tras login). */
  reload(): void {
    this._photo$.next(getLocalStorageItem(this.storageKey()));
  }

  /** Guarda y difunde una nueva foto (data-URL ya optimizada por el llamante). */
  setPhoto(dataUrl: string): void {
    setLocalStorageItem(this.storageKey(), dataUrl);
    this._photo$.next(dataUrl);
  }

  /** Elimina la foto del usuario vigente. */
  clearPhoto(): void {
    removeLocalStorageItem(this.storageKey());
    this._photo$.next(null);
  }

  private storageKey(): string {
    const user: any = this.util.getUser?.();
    const doc = user?.numero_de_documento ?? 'anon';
    return `${ProfilePhotoService.PREFIX}${doc}`;
  }
}
