import { Injectable } from '@angular/core';
import {
  vaultGet, vaultSet, vaultDelete, elegirBackend, electronSecure, secureStorageDisponible,
} from './secure-store';
import {
  SelloCifrado, aesDecrypt, aesEncrypt, b64uDecode, b64uEncode, randomBytes, sha256B64u,
} from './crypto.util';

const K_DEVICE_KEY = 'device.key';
const K_DEVICE_ID = 'device.id';
const K_DEVICE_HUELLA = 'device.huella';

/** Cómo quedó atado un secreto a este dispositivo. */
export type TipoBinding = 'webcrypto' | 'sistema-operativo';

/** Secreto envuelto por la capa de dispositivo. Se guarda tal cual. */
export type SelloDispositivo =
  | { tipo: 'webcrypto'; sello: SelloCifrado }
  | { tipo: 'sistema-operativo'; b64: string };

/**
 * Identidad criptográfica del dispositivo. Ofrece una única operación —
 * envolver y desenvolver un secreto — implementada de dos maneras según lo que
 * el entorno permita:
 *
 * **`webcrypto`** (navegador y APK Android): una clave AES-256 generada con
 * `extractable: false` y guardada en IndexedDB. El navegador puede cifrar con
 * ella, pero nadie puede leer sus bytes: `exportKey()` sobre ella lanza
 * excepción por diseño, así que ni el propio código, ni un XSS, ni copiar el
 * perfil a otra máquina permiten recuperarla.
 *
 * **`sistema-operativo`** (Electron): `safeStorage` del SO — DPAPI en Windows,
 * Keychain en macOS, libsecret en Linux. El blob solo lo puede descifrar la
 * misma cuenta de usuario en el mismo equipo. En escritorio esto es mejor que
 * WebCrypto, porque la ventana carga con `file://` y ese origen no garantiza
 * la persistencia del almacenamiento web.
 *
 * En ambos casos el resultado es el mismo: lo guardado no viaja. Limpiar los
 * datos de la app o desinstalarla destruye el anclaje y con él el acceso
 * rápido; eso es intencional, no hay copia de respaldo posible ni debería.
 */
@Injectable({ providedIn: 'root' })
export class DeviceKeyService {
  private cacheKey: CryptoKey | null = null;
  private cacheId: string | null = null;

  async disponible(): Promise<boolean> {
    return secureStorageDisponible();
  }

  /** Qué mecanismo ancla los secretos en este equipo. */
  async tipoBinding(): Promise<TipoBinding | null> {
    const backend = await elegirBackend();
    if (backend === 'electron') return 'sistema-operativo';
    if (backend === 'indexeddb') return 'webcrypto';
    return null;
  }

  // ─── Envolver / desenvolver ────────────────────────────────────────────

  /** Ata un secreto a este dispositivo. */
  async envolver(secreto: Uint8Array, aad: string): Promise<SelloDispositivo> {
    const tipo = await this.tipoBinding();

    if (tipo === 'sistema-operativo') {
      const b64 = await electronSecure().protect(b64uEncode(secreto));
      if (!b64) throw new Error('El sistema operativo no pudo proteger el secreto.');
      return { tipo: 'sistema-operativo', b64 };
    }

    const clave = await this.obtenerClave();
    if (!clave) throw new Error('No se pudo crear la llave de este dispositivo.');
    return { tipo: 'webcrypto', sello: await aesEncrypt(clave, secreto, aad) };
  }

  /** Recupera un secreto atado. Lanza si el sello no es de este dispositivo. */
  async desenvolver(sello: SelloDispositivo, aad: string): Promise<Uint8Array> {
    if (sello.tipo === 'sistema-operativo') {
      const secure = electronSecure();
      if (!secure) throw new Error('Este equipo ya no puede abrir el acceso guardado.');
      const texto = await secure.unprotect(sello.b64);
      if (!texto) throw new Error('El sistema operativo rechazó el secreto guardado.');
      return b64uDecode(texto);
    }

    const clave = await this.obtenerClave();
    if (!clave) throw new Error('La llave de este dispositivo ya no existe.');
    return aesDecrypt(clave, sello.sello, aad);
  }

  // ─── Clave WebCrypto no extraíble ──────────────────────────────────────

  private async obtenerClave(): Promise<CryptoKey | null> {
    if (this.cacheKey) return this.cacheKey;

    const guardada = await vaultGet<CryptoKey>(K_DEVICE_KEY);
    // Comprobamos que sea un CryptoKey real y no un objeto corrupto de una
    // versión anterior del vault.
    if (guardada && typeof (guardada as any).algorithm === 'object') {
      this.cacheKey = guardada;
      return guardada;
    }

    try {
      const nueva = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false, // ← NO extraíble: el punto entero de este servicio
        ['encrypt', 'decrypt'],
      );
      await vaultSet(K_DEVICE_KEY, nueva);
      this.cacheKey = nueva;
      return nueva;
    } catch {
      return null;
    }
  }

  // ─── Identidad y huella ────────────────────────────────────────────────

  /** Identificador aleatorio y estable del dispositivo (no es un fingerprint). */
  async obtenerId(): Promise<string> {
    if (this.cacheId) return this.cacheId;
    const guardado = await vaultGet<string>(K_DEVICE_ID);
    if (guardado) {
      this.cacheId = guardado;
      return guardado;
    }
    const nuevo = b64uEncode(randomBytes(16));
    await vaultSet(K_DEVICE_ID, nuevo);
    this.cacheId = nuevo;
    return nuevo;
  }

  /**
   * Huella débil del entorno (origen + plataforma + user agent). No sirve como
   * seguridad por sí sola — se falsifica en un minuto — pero detecta que el
   * perfil fue trasplantado a otro navegador y permite invalidar el registro
   * antes incluso de intentar descifrar.
   */
  async calcularHuella(): Promise<string> {
    const partes = [
      typeof location !== 'undefined' ? location.origin : '',
      typeof navigator !== 'undefined' ? navigator.userAgent : '',
      typeof navigator !== 'undefined' ? (navigator as any).platform ?? '' : '',
      typeof navigator !== 'undefined' ? navigator.language : '',
    ];
    return sha256B64u(partes.join('|'));
  }

  async fijarHuella(): Promise<void> {
    await vaultSet(K_DEVICE_HUELLA, await this.calcularHuella());
  }

  /** Destruye la identidad del dispositivo. Todo lo atado a ella queda ilegible. */
  async destruir(): Promise<void> {
    this.cacheKey = null;
    this.cacheId = null;
    await vaultDelete(K_DEVICE_KEY);
    await vaultDelete(K_DEVICE_ID);
    await vaultDelete(K_DEVICE_HUELLA);
  }
}
