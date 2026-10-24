import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  Canal, EstadoRostro, Finca, Marcacion, MarcacionPendiente, Miembro, Paquete, Punto, Rastro, Tablero, Tarea, Visita, Zona,
} from '../campo.models';

/** HTTP del trabajo de campo. El JWT lo pone el interceptor. */
@Injectable({ providedIn: 'root' })
export class CampoApiService {
  private readonly http = inject(HttpClient);
  readonly base = `${environment.apiUrl}/api/v1/comunicaciones/campo`;

  absoluta(url: string | null | undefined): string | null {
    if (!url) return null;
    return /^https?:\/\//.test(url) ? url : `${environment.apiUrl}${url}`;
  }

  private params(o: Record<string, unknown>): HttpParams {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined && v !== '') p = p.set(k, String(v));
    return p;
  }

  // ─── Coordinador ────────────────────────────────────────────────────────
  paquete(): Observable<Paquete> { return this.http.get<Paquete>(`${this.base}/mi-paquete`); }

  marcar(m: MarcacionPendiente, selfie?: Blob | null): Observable<Marcacion> {
    const { finca_nombre, distancia_m, dentro, qr_ok_local, ...datos } = m;
    const fd = new FormData();
    fd.append('datos', new Blob([JSON.stringify(datos)], { type: 'application/json' }));
    if (selfie) fd.append('selfie', selfie, `${m.id}.jpg`);
    return this.http.post<Marcacion>(`${this.base}/marcaciones`, fd);
  }

  misMarcaciones(desdeMs?: number): Observable<Marcacion[]> {
    return this.http.get<Marcacion[]>(`${this.base}/marcaciones/mias`, { params: this.params({ desdeMs }) });
  }

  posiciones(puntos: Punto[], bateria: number | null, red: string | null, plataforma: string): Observable<{ guardados: number; intervalo_seg: number }> {
    return this.http.post<{ guardados: number; intervalo_seg: number }>(`${this.base}/posiciones`, { puntos, bateria, red, plataforma });
  }

  estadoTarea(id: number, estado: string, nota?: string | null, hechaMs?: number): Observable<Tarea> {
    return this.http.put<Tarea>(`${this.base}/tareas/${id}/estado`, { estado, nota, hecha_ms: hechaMs });
  }

  // ─── Radio ──────────────────────────────────────────────────────────────
  canales(): Observable<Canal[]> { return this.http.get<Canal[]>(`${this.base}/radio/canales`); }
  crearCanal(c: { nombre: string; alcance: string; zona_id?: number | null; miembros?: string[] }): Observable<Canal> {
    return this.http.post<Canal>(`${this.base}/radio/canales`, c);
  }
  desactivarCanal(id: number): Observable<void> { return this.http.delete<void>(`${this.base}/radio/canales/${id}`); }
  transmitir(canalId: number, audio: Blob, clienteId: string, duracionMs: number, grabadoMs: number): Observable<any> {
    const fd = new FormData();
    const ext = audio.type.includes('ogg') ? 'ogg' : audio.type.includes('mp4') ? 'm4a' : 'webm';
    fd.append('audio', audio, `radio-${clienteId}.${ext}`);
    return this.http.post(`${this.base}/radio/canales/${canalId}/transmitir`, fd,
      { params: this.params({ clienteId, duracionMs, grabadoMs }) });
  }
  recientes(canalId: number, limite = 20): Observable<any[]> {
    return this.http.get<any[]>(`${this.base}/radio/canales/${canalId}/recientes`, { params: { limite } });
  }

  // ─── Supervisión ────────────────────────────────────────────────────────
  tablero(): Observable<Tablero> { return this.http.get<Tablero>(`${this.base}/tablero`); }
  marcaciones(f: { usuario?: string; desdeMs?: number; hastaMs?: number; fincaId?: number; rostro?: EstadoRostro | ''; limite?: number }): Observable<Marcacion[]> {
    return this.http.get<Marcacion[]>(`${this.base}/marcaciones`, { params: this.params(f) });
  }
  revisarRostro(id: string, aprobada: boolean, usarComoReferencia = false): Observable<Marcacion> {
    return this.http.put<Marcacion>(`${this.base}/marcaciones/${id}/rostro`, { aprobada, usar_como_referencia: usarComoReferencia });
  }
  rastro(usuario: string, fecha?: string): Observable<Rastro> {
    return this.http.get<Rastro>(`${this.base}/rastro/${usuario}`, { params: this.params({ fecha }) });
  }
  jerarquia(): Observable<Miembro[]> { return this.http.get<Miembro[]>(`${this.base}/jerarquia`); }
  guardarMiembro(usuario: string, c: { jefe_id?: string | null; cargo_campo?: string; zona_id?: number | null; activo?: boolean; quitar_jefe?: boolean }): Observable<Miembro[]> {
    return this.http.put<Miembro[]>(`${this.base}/jerarquia/${usuario}`, c);
  }

  // ─── Agenda y tareas ────────────────────────────────────────────────────
  agenda(f: { desde?: string; hasta?: string; coordinador?: string; fincaId?: number }): Observable<Visita[]> {
    return this.http.get<Visita[]>(`${this.base}/agenda`, { params: this.params(f) });
  }
  crearVisita(v: Partial<Visita> & { finca_id: number; fecha: string }): Observable<Visita> {
    return this.http.post<Visita>(`${this.base}/agenda`, v);
  }
  editarVisita(id: number, v: Partial<Visita> & { finca_id: number; fecha: string }): Observable<Visita> {
    return this.http.put<Visita>(`${this.base}/agenda/${id}`, v);
  }
  cancelarVisita(id: number): Observable<void> { return this.http.delete<void>(`${this.base}/agenda/${id}`); }

  tareas(f: { asignado?: string; estado?: string; fincaId?: number; visitaId?: number }): Observable<Tarea[]> {
    return this.http.get<Tarea[]>(`${this.base}/tareas`, { params: this.params(f) });
  }
  crearTarea(t: Partial<Tarea>): Observable<Tarea> { return this.http.post<Tarea>(`${this.base}/tareas`, t); }
  editarTarea(id: number, t: Partial<Tarea>): Observable<Tarea> { return this.http.put<Tarea>(`${this.base}/tareas/${id}`, t); }
  borrarTarea(id: number): Observable<void> { return this.http.delete<void>(`${this.base}/tareas/${id}`); }

  // ─── Parametrización ────────────────────────────────────────────────────
  fincas(inactivas = false): Observable<Finca[]> { return this.http.get<Finca[]>(`${this.base}/fincas`, { params: { inactivas } }); }
  crearFinca(f: { nombre: string; zona_id?: number | null; lat?: number | null; lon?: number | null; radio_m?: number }): Observable<Finca> {
    return this.http.post<Finca>(`${this.base}/fincas`, f);
  }
  editarFinca(id: number, f: Record<string, unknown>): Observable<Finca> { return this.http.put<Finca>(`${this.base}/fincas/${id}`, f); }
  asignarCoordinadores(id: number, usuarios: string[]): Observable<Finca> {
    return this.http.put<Finca>(`${this.base}/fincas/${id}/coordinadores`, { usuarios });
  }
  qr(id: number): Observable<{ finca_id: number; nombre: string; contenido: string; version: number }> {
    return this.http.get<{ finca_id: number; nombre: string; contenido: string; version: number }>(`${this.base}/fincas/${id}/qr`);
  }
  regenerarQr(id: number): Observable<{ finca_id: number; nombre: string; contenido: string; version: number }> {
    return this.http.post<{ finca_id: number; nombre: string; contenido: string; version: number }>(`${this.base}/fincas/${id}/qr/regenerar`, {});
  }
  sincronizarFincas(): Observable<{ nuevas: number }> { return this.http.post<{ nuevas: number }>(`${this.base}/fincas/sincronizar`, {}); }

  zonas(): Observable<Zona[]> { return this.http.get<Zona[]>(`${this.base}/zonas`); }
  guardarZona(id: number | null, z: Partial<Zona>): Observable<Zona> {
    return id == null ? this.http.post<Zona>(`${this.base}/zonas`, z) : this.http.put<Zona>(`${this.base}/zonas/${id}`, z);
  }
  borrarZona(id: number): Observable<void> { return this.http.delete<void>(`${this.base}/zonas/${id}`); }
}
