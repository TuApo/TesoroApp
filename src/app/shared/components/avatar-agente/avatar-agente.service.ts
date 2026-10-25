import { HttpClient } from '@angular/common/http';
import { Injectable, PLATFORM_ID, Signal, WritableSignal, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable } from 'rxjs';

import { environment } from '@/environments/environment';
import { AssetAvatar, EstadoAvatarAgent, MediosAvatar, Personaje, PersonajeAdmin, TipoAsset } from './avatar-agente.modelos';
import { ELENCO_BASE, MEDIOS_EMPAQUETADOS } from './elenco-base';
import { personajeDeModulo, personajeDeRuta } from './tramos';

/**
 * Avatar Agent (ms-ai `/api/v1/ai/avatar-agent`): el elenco de personajes del chat y sus
 * retratos/clips. El elenco se pide una vez por sesión; mientras llega (o si el servidor falla)
 * se usa el elenco base empaquetado, así el chat siempre tiene a quién mostrar.
 *
 * <p>Los archivos del servidor exigen sesión, así que se bajan como blob (una vez por id; un id
 * no cambia de contenido) y se pintan con una URL local.
 */
@Injectable({ providedIn: 'root' })
export class AvatarAgenteService {
  private http = inject(HttpClient);
  private navegador = isPlatformBrowser(inject(PLATFORM_ID));
  private base = `${environment.apiUrl}/api/v1/ai/avatar-agent`;

  private readonly _elenco = signal<Personaje[]>(ELENCO_BASE);
  readonly elenco: Signal<Personaje[]> = this._elenco.asReadonly();
  private pedido = false;
  private blobs = new Map<number, WritableSignal<string | null>>();

  /** Pide el elenco del servidor (una vez). Lo del servidor pisa al base; lo que solo está en el base se conserva. */
  cargar(forzar = false): void {
    if ((this.pedido && !forzar) || !this.navegador) return;
    this.pedido = true;
    this.http.get<Personaje[]>(`${this.base}/personajes`).subscribe({
      next: (lista) => {
        if (!Array.isArray(lista) || !lista.length) return;
        const claves = new Set(lista.map((p) => p.clave));
        this._elenco.set([...lista, ...ELENCO_BASE.filter((p) => !claves.has(p.clave))]);
      },
      error: () => { this.pedido = false; },
    });
  }

  personaje(clave: string | null | undefined): Personaje {
    const e = this._elenco();
    return e.find((p) => p.clave === clave) ?? e.find((p) => p.clave === 'presidente') ?? ELENCO_BASE[0];
  }

  /** Quién atiende un módulo del chat. */
  deModulo(modulo: string | null | undefined): Personaje {
    return personajeDeModulo(this._elenco(), modulo) ?? this.personaje('presidente');
  }

  /** Quién atiende una pantalla (asistente operador). */
  deRuta(ruta: string | null | undefined): Personaje {
    return personajeDeRuta(this._elenco(), ruta) ?? this.personaje('presidente');
  }

  /** Retrato y clips de un personaje: los del servidor si los hay; si no, los empaquetados. */
  medios(p: Personaje): Signal<MediosAvatar> {
    const retrato = this.fuente(p, 'ESTATICO', 'retrato.webp', 'retrato');
    const idle = this.fuente(p, 'IDLE', 'idle.mp4', 'idle');
    const hablando = this.fuente(p, 'HABLANDO', 'hablando.mp4', 'hablando');
    return computed(() => ({ retrato: retrato(), idle: idle(), hablando: hablando() }));
  }

  private fuente(p: Personaje, tipo: TipoAsset, archivo: string, clave: 'retrato' | 'idle' | 'hablando'): Signal<string | null> {
    const id = p.assets?.[tipo];
    const empaquetado = MEDIOS_EMPAQUETADOS[p.clave]?.[clave] ? `avatares/${p.clave}/${archivo}` : null;
    if (!id || !this.navegador) return signal(empaquetado);
    const s = this.blob(id);
    return computed(() => s() ?? empaquetado);
  }

  private blob(id: number): Signal<string | null> {
    let s = this.blobs.get(id);
    if (!s) {
      s = signal<string | null>(null);
      this.blobs.set(id, s);
      const destino = s;
      this.http.get(`${this.base}/assets/${id}/contenido`, { responseType: 'blob' }).subscribe({
        next: (b) => destino.set(URL.createObjectURL(b)),
        error: () => this.blobs.delete(id),
      });
    }
    return s;
  }

  // ── Administración ──

  estado(): Observable<EstadoAvatarAgent> {
    return this.http.get<EstadoAvatarAgent>(`${this.base}/admin/estado`);
  }

  todos(): Observable<PersonajeAdmin[]> {
    return this.http.get<PersonajeAdmin[]>(`${this.base}/admin/personajes`);
  }

  crear(p: Partial<PersonajeAdmin>): Observable<PersonajeAdmin> {
    return this.http.post<PersonajeAdmin>(`${this.base}/admin/personajes`, p);
  }

  actualizar(clave: string, p: Partial<PersonajeAdmin>): Observable<PersonajeAdmin> {
    return this.http.patch<PersonajeAdmin>(`${this.base}/admin/personajes/${encodeURIComponent(clave)}`, p);
  }

  prompt(clave: string): Observable<{ prompt: string }> {
    return this.http.get<{ prompt: string }>(`${this.base}/admin/personajes/${encodeURIComponent(clave)}/prompt`);
  }

  assets(clave: string): Observable<AssetAvatar[]> {
    return this.http.get<AssetAvatar[]>(`${this.base}/admin/personajes/${encodeURIComponent(clave)}/assets`);
  }

  generarRetratos(clave: string, n: number, prompt?: string | null): Observable<AssetAvatar[]> {
    return this.http.post<AssetAvatar[]>(`${this.base}/admin/personajes/${encodeURIComponent(clave)}/retratos`, { n, prompt: prompt || null });
  }

  animar(retratoId: number, tipo: 'IDLE' | 'HABLANDO'): Observable<AssetAvatar> {
    return this.http.post<AssetAvatar>(`${this.base}/admin/assets/${retratoId}/animar`, { tipo });
  }

  subir(clave: string, tipo: TipoAsset, archivo: File): Observable<AssetAvatar> {
    const f = new FormData();
    f.append('tipo', tipo);
    f.append('archivo', archivo, archivo.name);
    return this.http.post<AssetAvatar>(`${this.base}/admin/personajes/${encodeURIComponent(clave)}/assets`, f);
  }

  seleccionar(id: number): Observable<AssetAvatar> {
    return this.http.put<AssetAvatar>(`${this.base}/admin/assets/${id}/seleccionar`, {});
  }

  eliminar(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.base}/admin/assets/${id}`);
  }

  /** La URL local de un asset cualquiera (para la galería del administrador). */
  urlAsset(id: number): Signal<string | null> {
    return this.blob(id);
  }
}
