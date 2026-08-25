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
      if ((window as any).electron?.db) {
        const cached = await (window as any).electron.db.cacheGet(`auth_${login}_${password}`);
        if (cached) return cached;
      }
      throw new Error('Sin conexión: credenciales incorrectas o no registradas localmente.');
    }

    const result = await firstValueFrom(
      this.http.post<{ token: string; user: any }>(`${this.apiUrl}/login/`, { login, password })
    );

    if (result && (window as any).electron?.db) {
      // Guardar caché para modo offline (Desktop local)
      await (window as any).electron.db.cacheSave({
        url: `auth_${login}_${password}`,
        data: JSON.stringify(result)
      });
    }

    return result;
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
