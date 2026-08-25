import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '@/environments/environment';
import {
  getLocalStorageItem, removeLocalStorageItem, setLocalStorageItem,
} from '@/app/core/utils/safe-storage';

/** Estado observable de una subida en curso. */
export interface EstadoSubida {
  fase: 'inactiva' | 'iniciando' | 'subiendo' | 'pausada' | 'ensamblando' | 'lista' | 'error';
  porcentaje: number;
  bytesEnviados: number;
  bytesTotales: number;
  partesPendientes: number;
  mensaje: string | null;
  reanudada: boolean;
}

interface CargaIniciada {
  upload_id: string;
  chunk_size: number;
  total_chunks: number;
  expires_at: string;
}

interface EstadoCarga {
  upload_id: string;
  status: string;
  total_chunks: number;
  received_chunks: number;
  bytes_received: number;
  total_bytes: number;
  missing: number[];
  expires_at: string;
  error: string | null;
}

const CONCURRENCIA = 3;
const REINTENTOS = 5;
const PREFIJO_LS = 'mtg-upload:';

/**
 * Subida de grabaciones por partes, reanudable.
 *
 * Por qué no un POST normal: una reunión de 4 h pesa varios GB, y el borde corta en
 * 500 MB (Caddy) y a los 300 s. Con partes de 8 MB cada petición dura segundos y se
 * puede reintentar sola.
 *
 * Reanudación: el `upload_id` se guarda en localStorage junto con la identidad del
 * archivo (nombre + tamaño + fecha). Si el usuario cierra el navegador y vuelve a
 * elegir el MISMO archivo, se le pregunta al backend qué partes faltan y se sigue desde
 * ahí. Se compara la identidad del archivo a propósito: reanudar una sesión con un
 * archivo distinto produciría un ensamblado corrupto.
 */
@Injectable({ providedIn: 'root' })
export class ReunionUploadService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/v1/meetings`;

  readonly estado = signal<EstadoSubida>(this.inicial());

  private cancelado = false;

  private inicial(): EstadoSubida {
    return {
      fase: 'inactiva', porcentaje: 0, bytesEnviados: 0, bytesTotales: 0,
      partesPendientes: 0, mensaje: null, reanudada: false,
    };
  }

  reiniciar(): void {
    this.cancelado = false;
    this.estado.set(this.inicial());
  }

  cancelar(): void {
    this.cancelado = true;
    this.estado.update(e => ({ ...e, fase: 'pausada', mensaje: 'Subida pausada' }));
  }

  /**
   * Sube el archivo completo y devuelve el id de la grabación creada.
   * `origen` distingue un archivo elegido a mano de una grabación hecha en la app.
   */
  async subir(reunionId: string, archivo: File, origen: 'UPLOAD' | 'RECORDED' = 'UPLOAD'): Promise<string> {
    this.cancelado = false;
    this.estado.set({ ...this.inicial(), fase: 'iniciando', bytesTotales: archivo.size });

    const { sesion, faltantes, reanudada } = await this.abrirOReanudar(reunionId, archivo, origen);
    const totalPartes = sesion.total_chunks;

    this.estado.set({
      fase: 'subiendo',
      porcentaje: Math.round(((totalPartes - faltantes.length) / totalPartes) * 100),
      bytesEnviados: (totalPartes - faltantes.length) * sesion.chunk_size,
      bytesTotales: archivo.size,
      partesPendientes: faltantes.length,
      mensaje: reanudada ? 'Reanudando la subida donde se quedó' : null,
      reanudada,
    });

    await this.subirPartes(archivo, sesion, faltantes);

    if (this.cancelado) throw new Error('Subida pausada');

    this.estado.update(e => ({ ...e, fase: 'ensamblando', porcentaje: 100, mensaje: 'Uniendo las partes' }));
    const { recording_id } = await firstValueFrom(
      this.http.post<{ recording_id: string }>(`${this.base}/uploads/${sesion.upload_id}/complete`, {}),
    );

    removeLocalStorageItem(this.clave(reunionId, archivo));
    this.estado.update(e => ({ ...e, fase: 'lista', mensaje: 'Grabación subida' }));
    return recording_id;
  }

  // ── Sesión ────────────────────────────────────────────────────────────────

  private async abrirOReanudar(reunionId: string, archivo: File, origen: 'UPLOAD' | 'RECORDED') {
    const guardado = this.leerSesionGuardada(reunionId, archivo);
    if (guardado) {
      try {
        const estado = await firstValueFrom(
          this.http.get<EstadoCarga>(`${this.base}/uploads/${guardado}`),
        );
        if (estado.status === 'OPEN' && estado.total_bytes === archivo.size) {
          return {
            sesion: {
              upload_id: estado.upload_id,
              chunk_size: Math.ceil(estado.total_bytes / estado.total_chunks),
              total_chunks: estado.total_chunks,
              expires_at: estado.expires_at,
            } as CargaIniciada,
            faltantes: estado.missing,
            reanudada: true,
          };
        }
      } catch {
        // La sesión venció o ya no existe: se empieza limpio, no es un error del usuario.
      }
      removeLocalStorageItem(this.clave(reunionId, archivo));
    }

    const sesion = await firstValueFrom(
      this.http.post<CargaIniciada>(`${this.base}/${reunionId}/uploads`, {
        filename: archivo.name,
        mime_type: archivo.type || null,
        total_bytes: archivo.size,
        source: origen,
      }),
    );
    setLocalStorageItem(this.clave(reunionId, archivo), sesion.upload_id);
    return {
      sesion,
      faltantes: Array.from({ length: sesion.total_chunks }, (_, i) => i),
      reanudada: false,
    };
  }

  // ── Envío de partes ───────────────────────────────────────────────────────

  private async subirPartes(archivo: File, sesion: CargaIniciada, faltantes: number[]): Promise<void> {
    const cola = [...faltantes];
    let enviadas = sesion.total_chunks - faltantes.length;
    let fallo: unknown = null;

    const trabajador = async () => {
      while (cola.length && !this.cancelado && !fallo) {
        const idx = cola.shift()!;
        try {
          await this.subirParteConReintentos(archivo, sesion, idx);
          enviadas++;
          const porcentaje = Math.min(99, Math.round((enviadas / sesion.total_chunks) * 100));
          this.estado.update(e => ({
            ...e,
            porcentaje,
            bytesEnviados: Math.min(archivo.size, enviadas * sesion.chunk_size),
            partesPendientes: sesion.total_chunks - enviadas,
          }));
        } catch (e) {
          fallo = e;
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, cola.length || 1) }, trabajador));

    if (fallo) {
      // No se borra la sesión: el avance queda en el servidor y se puede reanudar.
      this.estado.update(e => ({
        ...e, fase: 'error',
        mensaje: 'Se interrumpió la subida. Vuelva a elegir el mismo archivo para continuar.',
      }));
      throw fallo;
    }
  }

  private async subirParteConReintentos(archivo: File, sesion: CargaIniciada, idx: number): Promise<void> {
    const inicio = idx * sesion.chunk_size;
    const trozo = archivo.slice(inicio, Math.min(inicio + sesion.chunk_size, archivo.size));

    for (let intento = 1; intento <= REINTENTOS; intento++) {
      if (this.cancelado) throw new Error('Subida pausada');
      try {
        await firstValueFrom(this.http.put(
          `${this.base}/uploads/${sesion.upload_id}/parts/${idx}`,
          trozo,
          { headers: new HttpHeaders({ 'Content-Type': 'application/octet-stream' }) },
        ));
        return;
      } catch (e) {
        if (intento === REINTENTOS) throw e;
        // Backoff exponencial con tope: una red intermitente no debe convertirse en
        // una tormenta de reintentos contra el gateway.
        await this.esperar(Math.min(8000, 500 * 2 ** (intento - 1)));
      }
    }
  }

  private esperar(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ── Persistencia del handle de reanudación ────────────────────────────────

  /** Identidad del archivo: reanudar con otro distinto ensamblaría basura. */
  private clave(reunionId: string, archivo: File): string {
    return `${PREFIJO_LS}${reunionId}:${archivo.name}:${archivo.size}:${archivo.lastModified}`;
  }

  private leerSesionGuardada(reunionId: string, archivo: File): string | null {
    return getLocalStorageItem(this.clave(reunionId, archivo));
  }
}
