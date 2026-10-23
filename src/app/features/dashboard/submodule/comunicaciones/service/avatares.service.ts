import { Injectable, Signal, inject, signal } from '@angular/core';
import { ComunicacionesApiService } from './comunicaciones-api.service';

/**
 * Fotos de perfil (las de ms-auth-admin, servidas por ms-comunicaciones). Se
 * piden una vez por persona y sesión; quien no tiene foto muestra sus iniciales.
 */
@Injectable({ providedIn: 'root' })
export class AvataresService {
  private readonly api = inject(ComunicacionesApiService);
  private readonly fotos = new Map<string, ReturnType<typeof signal<string | null>>>();

  foto(usuarioId: string | null | undefined, tieneFoto: boolean): Signal<string | null> {
    if (!usuarioId || !tieneFoto) return NULA;
    let s = this.fotos.get(usuarioId);
    if (!s) {
      s = signal<string | null>(null);
      this.fotos.set(usuarioId, s);
      const destino = s;
      this.api.foto(usuarioId).subscribe({ next: r => destino.set(r?.foto ?? null), error: () => undefined });
    }
    return s;
  }
}

const NULA = signal<string | null>(null).asReadonly();
