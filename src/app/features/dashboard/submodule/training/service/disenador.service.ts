import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '@/environments/environment';

/**
 * Diseñador de cursos con IA (learning-ms `/disenador`).
 *
 * Todos los pasos de IA responden al instante con el trabajo EN_COLA: la pantalla vuelve a
 * pedir el diseño cada pocos segundos hasta que `trabajo.estado` deja de ser EN_COLA/PROCESANDO.
 * Así ninguna petición se acerca al corte de 30 s del gateway.
 */

export type ContextoFormacion = 'EDUCATIVO' | 'CORPORATIVO';
export type EstadoDiseno = 'MATERIAL' | 'ENTREVISTA' | 'ESTRUCTURA' | 'CONTENIDO' | 'APLICADO';
export type TipoFuente = 'ARCHIVO' | 'TEXTO' | 'VOZ' | 'ENLACE';

export interface TrabajoDiseno {
  tipo: 'ANALIZAR' | 'PREGUNTAR' | 'ESTRUCTURAR' | 'DETALLAR';
  estado: 'EN_COLA' | 'PROCESANDO' | 'LISTO' | 'ERROR';
  progreso: number | null;
  total: number | null;
  mensaje: string | null;
}

export interface FuenteDiseno {
  id: string;
  tipo: TipoFuente;
  titulo: string | null;
  document_id: string | null;
  mime: string | null;
  bytes: number | null;
  url: string | null;
  estado: 'PENDIENTE' | 'PROCESANDO' | 'LISTO' | 'ERROR';
  error: string | null;
  caracteres: number | null;
  extracto: string | null;
  created_at: string;
}

export interface TurnoDiseno {
  id: string;
  rol: 'IA' | 'PROFESOR';
  texto: string;
  tema: string | null;
  sugerencias: string[];
  pide_material: boolean;
  via: 'TEXTO' | 'VOZ';
  pregunta_id: string | null;
  orden: number;
  created_at: string;
}

export interface TemaMapa { clave: string; titulo: string; puntos?: string[]; fuentes?: string[]; }
export interface MapaMaterial {
  resumen?: string;
  temas?: TemaMapa[];
  glosario?: { termino: string; definicion: string }[];
  vacios?: string[];
  nivel_sugerido?: string;
  muestreado?: boolean;
}

export interface Decisiones {
  publico?: string | null;
  nivel_previo?: string | null;
  objetivos?: string[] | null;
  alcance?: string | null;
  duracion?: string | null;
  modalidad?: string | null;
  evaluacion?: string | null;
  practica?: string | null;
  estilo?: string | null;
  recursos?: string | null;
  otros?: string | null;
}

export interface OpcionP { texto: string; correcta?: boolean; }
export interface PreguntaP { enunciado: string; tipo: 'OPCION_MULTIPLE' | 'VERDADERO_FALSO'; opciones: OpcionP[]; explicacion?: string | null; }
export interface ActividadP { titulo: string; tipo: 'TEXTO' | 'EVIDENCIA_FOTO' | 'FORMULARIO'; instrucciones?: string | null; }
export interface LeccionP {
  clave: string;
  titulo: string;
  objetivos?: string[];
  resumen?: string | null;
  duracion_min?: number | null;
  temas?: string[];
  preguntas_quiz?: number | null;
  actividades?: ActividadP[];
  contenido_html?: string | null;
  preguntas?: PreguntaP[];
  estado_detalle?: 'PENDIENTE' | 'LISTO' | 'ERROR';
  error_detalle?: string | null;
  lesson_id?: string | null;
}
export interface ModuloP { clave: string; titulo: string; objetivo?: string | null; lecciones: LeccionP[]; }
export interface CursoP {
  titulo?: string | null;
  descripcion?: string | null;
  objetivos?: string[];
  publico?: string | null;
  duracion_horas?: number | null;
  modalidad?: 'AUTOGESTIONADO' | 'VIRTUAL_SINCRONICO' | 'PRESENCIAL' | null;
}
export interface EvaluacionFinalP { incluir?: boolean; preguntas?: number | null; nota_minima?: number | null; }
export interface Propuesta { curso?: CursoP; modulos: ModuloP[]; evaluacion_final?: EvaluacionFinalP | null; avisos?: string[]; }

export interface Diseno {
  id: string;
  titulo: string;
  contexto: ContextoFormacion;
  idea: string | null;
  estado: EstadoDiseno;
  trabajo: TrabajoDiseno | null;
  fuentes: FuenteDiseno[];
  conversacion: TurnoDiseno[];
  mapa: MapaMaterial | null;
  mapa_desactualizado: boolean;
  decisiones: Decisiones;
  propuesta: Propuesta | null;
  preguntas_hechas: number;
  max_preguntas: number;
  entrevista_lista: boolean;
  course_id: string | null;
  autor_nombre: string | null;
  ia_disponible: boolean;
  dictado_disponible: boolean;
  created_at: string;
  updated_at: string;
}

export interface DisenoResumen {
  id: string;
  titulo: string;
  contexto: ContextoFormacion;
  estado: EstadoDiseno;
  fuentes: number;
  lecciones: number;
  course_id: string | null;
  autor_nombre: string | null;
  trabajo: TrabajoDiseno | null;
  created_at: string;
  updated_at: string;
}

export interface AplicarResultado {
  course_id: string;
  course_version_id: string;
  codigo: string;
  modulos: number;
  lecciones: number;
  preguntas: number;
  actividades: number;
  medios: number;
  avisos: string[];
}

/** true = hay algo corriendo en el servidor y conviene volver a preguntar pronto. */
export function disenoOcupado(d: Diseno | null): boolean {
  if (!d) return false;
  const t = d.trabajo;
  if (t && (t.estado === 'EN_COLA' || t.estado === 'PROCESANDO')) return true;
  return d.fuentes.some(f => f.estado === 'PENDIENTE' || f.estado === 'PROCESANDO');
}

@Injectable({ providedIn: 'root' })
export class DisenadorService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/api/v1/learning/disenador`;
  private documentos = `${environment.apiUrl}/api/v1/documents`;

  disponibilidad(): Promise<{ puede_disenar: boolean }> {
    return firstValueFrom(this.http.get<{ puede_disenar: boolean }>(`${this.base}/disponibilidad`));
  }

  listar(todos = false): Promise<DisenoResumen[]> {
    return firstValueFrom(this.http.get<DisenoResumen[]>(`${this.base}/disenos`, { params: { todos } }));
  }

  crear(req: { titulo: string; contexto: ContextoFormacion; idea?: string | null }): Promise<Diseno> {
    return firstValueFrom(this.http.post<Diseno>(`${this.base}/disenos`, req));
  }

  obtener(id: string): Promise<Diseno> {
    return firstValueFrom(this.http.get<Diseno>(`${this.base}/disenos/${id}`));
  }

  actualizar(id: string, req: { titulo: string; contexto: ContextoFormacion; idea?: string | null }): Promise<Diseno> {
    return firstValueFrom(this.http.put<Diseno>(`${this.base}/disenos/${id}`, req));
  }

  eliminar(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/disenos/${id}`));
  }

  agregarFuente(id: string, req: {
    tipo: TipoFuente; titulo?: string | null; texto?: string | null; document_id?: string | null;
    mime?: string | null; bytes?: number | null; url?: string | null;
  }): Promise<Diseno> {
    return firstValueFrom(this.http.post<Diseno>(`${this.base}/disenos/${id}/fuentes`, req));
  }

  eliminarFuente(id: string, fuenteId: string): Promise<Diseno> {
    return firstValueFrom(this.http.delete<Diseno>(`${this.base}/disenos/${id}/fuentes/${fuenteId}`));
  }

  reintentarFuente(id: string, fuenteId: string): Promise<Diseno> {
    return firstValueFrom(this.http.post<Diseno>(`${this.base}/disenos/${id}/fuentes/${fuenteId}/reintentar`, {}));
  }

  analizar(id: string): Promise<Diseno> {
    return firstValueFrom(this.http.post<Diseno>(`${this.base}/disenos/${id}/analizar`, {}));
  }

  responder(id: string, req: { texto?: string | null; pregunta_id?: string | null; via?: 'TEXTO' | 'VOZ'; saltar?: boolean }): Promise<Diseno> {
    return firstValueFrom(this.http.post<Diseno>(`${this.base}/disenos/${id}/respuestas`, req));
  }

  dictado(id: string, audio: Blob): Promise<{ texto: string }> {
    const fd = new FormData();
    fd.append('file', audio, nombreGrabacion(audio));
    return firstValueFrom(this.http.post<{ texto: string }>(`${this.base}/disenos/${id}/dictado`, fd));
  }

  estructurar(id: string, indicaciones?: string | null): Promise<Diseno> {
    return firstValueFrom(this.http.post<Diseno>(`${this.base}/disenos/${id}/estructura`, { indicaciones: indicaciones ?? null }));
  }

  guardarPropuesta(id: string, propuesta: Propuesta): Promise<Diseno> {
    return firstValueFrom(this.http.put<Diseno>(`${this.base}/disenos/${id}/propuesta`, { propuesta }));
  }

  detallar(id: string, claves: string[] = [], rehacer = false): Promise<Diseno> {
    return firstValueFrom(this.http.post<Diseno>(`${this.base}/disenos/${id}/detalle`, { claves, rehacer }));
  }

  cancelar(id: string): Promise<Diseno> {
    return firstValueFrom(this.http.post<Diseno>(`${this.base}/disenos/${id}/cancelar`, {}));
  }

  aplicar(id: string): Promise<AplicarResultado> {
    return firstValueFrom(this.http.post<AplicarResultado>(`${this.base}/disenos/${id}/aplicar`, {}));
  }

  /**
   * Sube una pieza de material a ms-documents. Igual que el material de las lecciones: dueño
   * propio por subida (upload-by-owner versiona por dueño+tipo y `owner_id` es varchar(40)).
   */
  async subirMaterial(file: Blob, nombre: string): Promise<string> {
    const fd = new FormData();
    fd.append('ownerId', crypto.randomUUID());
    fd.append('typeCode', 'CAPACITACION_MATERIAL');
    fd.append('ownerType', 'LEARNING_DESIGN');
    fd.append('sourceService', 'tesoro-capacitaciones');
    fd.append('file', file, nombre);
    const r = await firstValueFrom(this.http.post<{ document_id: number }>(`${this.documentos}/upload-by-owner`, fd));
    if (!r?.document_id) throw new Error('ms-documents no confirmó la subida');
    return String(r.document_id);
  }
}

/** Nombre con la extensión que corresponde al formato que grabó el navegador. */
export function nombreGrabacion(b: Blob): string {
  const t = b.type || '';
  const ext = t.includes('ogg') ? 'ogg' : t.includes('mp4') || t.includes('aac') ? 'm4a' : 'webm';
  return `grabacion-${Date.now()}.${ext}`;
}

/** Mensaje legible de un error HTTP del backend (cuerpo {message}). */
export function mensajeDeError(e: unknown, porDefecto = 'No se pudo completar la acción'): string {
  const any = e as { status?: number; error?: { message?: string } | string; message?: string };
  if (any?.status === 0) return 'Sin conexión con el servidor';
  if (any?.status === 503) return (typeof any.error === 'object' && any.error?.message) || 'El servicio de IA no está disponible ahora';
  if (typeof any?.error === 'object' && any.error?.message) return any.error.message;
  if (typeof any?.error === 'string' && any.error.length < 300) return any.error;
  return porDefecto;
}
