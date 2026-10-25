import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '@/environments/environment';
import { isPlatformBrowser } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { NetworkStatusService } from '../../../core/services/network-status.service';

@Injectable({ providedIn: 'root' })
export class LoginService {
  private apiUrl = `${environment.apiUrl}/gestion_admin/auth`;

  constructor(
    private http: HttpClient,
    @Inject(PLATFORM_ID) private platformId: Object,
    private networkStatus: NetworkStatusService
  ) { }

  // Register
  async register(user: any): Promise<any> {
    return firstValueFrom(this.http.post(`${this.apiUrl}/register/`, user));
  }

  // Login (correo o documento)
  async login(login: string, password: string): Promise<{ token: string; user: any }> {
    if (!this.networkStatus.isOnline) {
      const local = await this.loginSinRed(login, password);
      if (local) return local;
      throw new Error('Sin conexión: credenciales incorrectas o no registradas localmente.');
    }

    let result: { token: string; user: any };
    try {
      result = await firstValueFrom(
        this.http.post<{ token: string; user: any }>(`${this.apiUrl}/login/`, { login, password })
      );
    } catch (e: any) {
      // Red local pero sin internet: el heartbeat tarda cerca de un minuto en marcar offline y el
      // POST de login no pasa por el interceptor offline. Si la credencial guardada coincide, se entra.
      if (e?.status === 0) {
        const local = await this.loginSinRed(login, password);
        if (local) {
          this.networkStatus.markOffline();
          return local;
        }
      }
      throw e;
    }

    if (result) await this.guardarCredencialOffline(login, password, result);
    return result;
  }

  // ── Credencial para entrar sin red (solo escritorio) ─────────────────────────
  // Se guarda un verificador PBKDF2 con sal, no la contraseña: antes la clave del registro era
  // `auth_<login>_<contraseña>`, con la contraseña en claro dentro del SQLite. Junto al verificador
  // va la respuesta del último login (token + usuario), igual que antes. El logout y el 401 borran
  // la caché y con ella esta entrada (sesion.service, auth.interceptor), como hasta ahora.

  private get dbEscritorio(): any {
    return isPlatformBrowser(this.platformId) ? (window as any).electron?.db ?? null : null;
  }

  private claveOffline(login: string): string {
    return `auth_offline_${login.trim().toLowerCase()}`;
  }

  private async derivar(password: string, salB64: string): Promise<string> {
    const sal = Uint8Array.from(atob(salB64), c => c.charCodeAt(0));
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: 150_000 }, base, 256);
    return btoa(String.fromCharCode(...new Uint8Array(bits)));
  }

  private async loginSinRed(login: string, password: string): Promise<{ token: string; user: any } | null> {
    const db = this.dbEscritorio;
    if (!db || !globalThis.crypto?.subtle) return null;
    try {
      const guardada = await db.cacheGet(this.claveOffline(login));
      if (guardada?.sal && guardada?.hash && guardada?.datos) {
        return (await this.derivar(password, guardada.sal)) === guardada.hash ? guardada.datos : null;
      }
      // Equipo que viene de una versión anterior: la entrada vieja se migra al verificador.
      const vieja = await db.cacheGet(`auth_${login}_${password}`);
      if (vieja) {
        await this.guardarCredencialOffline(login, password, vieja);
        return vieja;
      }
    } catch { /* sin credencial local */ }
    return null;
  }

  private async guardarCredencialOffline(login: string, password: string, datos: any): Promise<void> {
    const db = this.dbEscritorio;
    if (!db || !globalThis.crypto?.subtle) return;
    try {
      const sal = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
      const hash = await this.derivar(password, sal);
      await db.cacheSave({ url: this.claveOffline(login), data: JSON.stringify({ v: 1, sal, hash, datos }) });
      // Borrar las entradas viejas con la contraseña en claro en la clave.
      const urls: string[] = (await db.cacheGetAllUrls?.()) || [];
      for (const u of urls) {
        if (typeof u === 'string' && u.startsWith('auth_') && !u.startsWith('auth_offline_')) {
          await db.cacheInvalidatePrefix(u).catch(() => null);
        }
      }
    } catch { /* el login online ya funcionó; solo se pierde el acceso sin red */ }
  }

  // OTP Recovery — Paso 1: solicitar código
  async solicitarOtp(login: string): Promise<{ correo_enmascarado: string }> {
    return firstValueFrom(
      this.http.post<{ correo_enmascarado: string }>(`${this.apiUrl}/solicitar-otp/`, { login })
    );
  }

  // OTP Recovery — Paso 2: verificar código
  async verificarOtp(login: string, codigo: string): Promise<{ reset_token: string }> {
    return firstValueFrom(
      this.http.post<{ reset_token: string }>(`${this.apiUrl}/verificar-otp/`, { login, codigo })
    );
  }

  // OTP Recovery — Paso 3: nueva contraseña
  async resetContrasena(resetToken: string, nuevaContrasena: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`${this.apiUrl}/reset-contrasena/`, {
        reset_token: resetToken,
        nueva_contrasena: nuevaContrasena,
      })
    );
  }
}
