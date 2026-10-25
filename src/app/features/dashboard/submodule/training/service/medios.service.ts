import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '@/environments/environment';
import { Diseno } from './disenador.service';

/**
 * Medios de clase (fichas, audio, podcast, clips, YouTube) e Interoperabilidad de
 * Capacitaciones (learning-ms). Contrato en snake_case como el resto del módulo.
 */

export type TipoMedio = 'FICHA' | 'AUDIO' | 'PODCAST' | 'CLIP' | 'YOUTUBE';
export type EstadoMedio = 'PROPUESTO' | 'APROBADO' | 'GENERANDO' | 'LISTO' | 'ERROR' | 'DESCARTADO';

export interface Tarjeta { frente: string; reverso: string; }
export interface LineaDialogo { voz: 'A' | 'B'; texto: string; }
export interface VideoYoutube { video_id: string; titulo?: string | null; canal?: string | null; miniatura?: string | null; }

export interface Medio {
  id: string;
  design_id: string | null;
  leccion_clave: string | null;
  lesson_id: string | null;
  tipo: TipoMedio;
  titulo: string;
  proposito: string | null;
  guion: string | null;
  dialogo: LineaDialogo[] | null;
  prompt_visual: string | null;
  tarjetas: Tarjeta[] | null;
  puntos: string[] | null;
  consulta: string | null;
  video: VideoYoutube | null;
  candidatos: VideoYoutube[] | null;
  inicio_seg: number | null;
  fin_seg: number | null;
  proveedor: string | null;
  estado: EstadoMedio;
  modo: 'ESCENA' | 'DIAPOSITIVA' | null;
  costo_estimado: number | null;
  duracion_seg: number | null;
  document_id: string | null;
  mime: string | null;
  block_id: string | null;
  error: string | null;
  orden: number;
  updated_at: string;
}

export interface EditarMedio {
  titulo?: string | null;
  proposito?: string | null;
  guion?: string | null;
  dialogo?: LineaDialogo[] | null;
  prompt_visual?: string | null;
  tarjetas?: Tarjeta[] | null;
  puntos?: string[] | null;
  consulta?: string | null;
  video_url?: string | null;
  inicio_seg?: number | null;
  fin_seg?: number | null;
}

export interface Capacidades {
  ia: boolean;
  voz: boolean;
  video: boolean;
  youtube: boolean;
  modo_clip: 'ESCENA' | 'DIAPOSITIVA';
  notas: Record<string, string>;
}

export interface MediosDeLeccion { planificando: boolean; error: string; medios: Medio[]; }

export interface Integracion {
  proveedor: 'ELEVENLABS' | 'HIGGSFIELD' | 'YOUTUBE' | 'LIVEKIT' | 'PISTON';
  nombre: string;
  descripcion: string;
  usos: string[];
  lleva_secreto: boolean;
  variable_entorno: string | null;
  formato_secreto: string | null;
  origen: 'ENTORNO' | 'GUARDADA' | 'NINGUNO';
  pista: string | null;
  habilitado: boolean;
  configurado: boolean;
  ajustes: Record<string, string>;
  ajustes_fijados: string[];
  ajustes_disponibles: string[];
  estado_prueba: 'SIN_PROBAR' | 'OK' | 'ERROR';
  mensaje_prueba: string | null;
  probado_at: string | null;
  actualizado_por: string | null;
  documentacion: string | null;
}

export interface ResumenIntegraciones { ia_texto: boolean; puede_guardar_secretos: boolean; proveedores: Integracion[]; }
export interface VozEleven { voz_id: string; nombre: string; idioma: string | null; acento: string | null; genero: string | null; muestra_url: string | null; }

export function medioOcupado(m: Medio): boolean {
  return m.estado === 'APROBADO' || m.estado === 'GENERANDO';
}

@Injectable({ providedIn: 'root' })
export class MediosService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/api/v1/learning`;

  capacidades(): Promise<Capacidades> {
    return firstValueFrom(this.http.get<Capacidades>(`${this.base}/medios/capacidades`));
  }

  deDiseno(designId: string): Promise<Medio[]> {
    return firstValueFrom(this.http.get<Medio[]>(`${this.base}/disenador/disenos/${designId}/medios`));
  }

  planificarDiseno(designId: string, claves: string[] = []): Promise<Diseno> {
    return firstValueFrom(this.http.post<Diseno>(`${this.base}/disenador/disenos/${designId}/medios/planificar`, { claves }));
  }

  crearEnDiseno(designId: string, leccionClave: string, tipo: TipoMedio, titulo?: string): Promise<Medio> {
    return firstValueFrom(this.http.post<Medio>(`${this.base}/disenador/disenos/${designId}/medios`,
      { leccion_clave: leccionClave, tipo, titulo: titulo ?? null }));
  }

  deLeccion(lessonId: string): Promise<MediosDeLeccion> {
    return firstValueFrom(this.http.get<MediosDeLeccion>(`${this.base}/lessons/${lessonId}/medios`));
  }

  planificarLeccion(lessonId: string): Promise<void> {
    return firstValueFrom(this.http.post<void>(`${this.base}/lessons/${lessonId}/medios/planificar`, {}));
  }

  crearEnLeccion(lessonId: string, tipo: TipoMedio, titulo?: string): Promise<Medio> {
    return firstValueFrom(this.http.post<Medio>(`${this.base}/lessons/${lessonId}/medios`, { tipo, titulo: titulo ?? null }));
  }

  editar(id: string, req: EditarMedio): Promise<Medio> {
    return firstValueFrom(this.http.put<Medio>(`${this.base}/medios/${id}`, req));
  }

  aprobar(ids: string[]): Promise<Medio[]> {
    return firstValueFrom(this.http.post<Medio[]>(`${this.base}/medios/aprobar`, { ids }));
  }

  descartar(id: string): Promise<Medio> {
    return firstValueFrom(this.http.post<Medio>(`${this.base}/medios/${id}/descartar`, {}));
  }

  restaurar(id: string): Promise<Medio> {
    return firstValueFrom(this.http.post<Medio>(`${this.base}/medios/${id}/restaurar`, {}));
  }

  insertar(id: string): Promise<Medio> {
    return firstValueFrom(this.http.post<Medio>(`${this.base}/medios/${id}/insertar`, {}));
  }

  eliminar(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/medios/${id}`));
  }

  /** El audio o video generado, como blob (el proxy exige el JWT, un <audio src> no lo manda). */
  archivo(id: string): Promise<Blob> {
    return firstValueFrom(this.http.get(`${this.base}/medios/${id}/archivo`, { responseType: 'blob' }));
  }

  // ── Interoperabilidad ──

  integraciones(): Promise<ResumenIntegraciones> {
    return firstValueFrom(this.http.get<ResumenIntegraciones>(`${this.base}/integraciones`));
  }

  guardarIntegracion(proveedor: string, req: { habilitado?: boolean; ajustes?: Record<string, string>; secreto?: string | null }): Promise<Integracion> {
    return firstValueFrom(this.http.put<Integracion>(`${this.base}/integraciones/${proveedor}`, req));
  }

  probarIntegracion(proveedor: string): Promise<{ ok: boolean; mensaje: string }> {
    return firstValueFrom(this.http.post<{ ok: boolean; mensaje: string }>(`${this.base}/integraciones/${proveedor}/probar`, {}));
  }

  voces(): Promise<VozEleven[]> {
    return firstValueFrom(this.http.get<VozEleven[]>(`${this.base}/integraciones/elevenlabs/voces`));
  }
}
