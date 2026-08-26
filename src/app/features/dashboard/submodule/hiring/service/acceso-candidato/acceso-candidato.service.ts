import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '@/environments/environment';

export interface ReenviarAccesoRespuesta {
  ok: boolean;
  /** Correo enmascarado al que salió el código (m***o@gmail.com). Solo si `ok`. */
  correo?: string;
  mensaje: string;
}

/**
 * Acceso del candidato a su propia ficha.
 *
 * El candidato NO tiene contraseña: entra con un código de un solo uso que le llega al
 * correo registrado. Este servicio cubre la vía del PERSONAL —reenviar ese código desde la
 * ficha—; la vía pública (el candidato pidiéndolo él mismo) vive en el formulario.
 *
 * El endpoint cuelga de `/api/v1/admin/`, que exige JWT en el gateway y en ms-auth-admin.
 */
@Injectable({ providedIn: 'root' })
export class AccesoCandidatoService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  /**
   * Reenvía el código al correo que el candidato tiene registrado.
   *
   * @param numeroDocumento documento del candidato tal como está en la ficha.
   */
  async reenviar(numeroDocumento: string): Promise<ReenviarAccesoRespuesta> {
    return firstValueFrom(
      this.http.post<ReenviarAccesoRespuesta>(
        `${this.apiUrl}/api/v1/admin/acceso-candidato/reenviar`,
        { numeroDocumento },
      ),
    );
  }
}
