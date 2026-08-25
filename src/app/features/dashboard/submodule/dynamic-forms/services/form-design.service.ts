import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, switchMap } from 'rxjs';

import { environment } from '@/environments/environment';
import { DocumentRef, FormTheme } from '../models/dynamic-forms.models';
import { MediaOffloadService, TIPO_DOC_PORTADA } from './media-offload.service';

/** Lo que devuelve ms-ai al pedirle una identidad visual para el formulario. */
export interface SugerenciaDiseno {
  theme: FormTheme;
  cover_prompt: string;
  resumen: string;
  tips: string[];
  images_enabled: boolean;
}

/** Prompt de portada ya pasado por los estándares de la plataforma. */
export interface PromptRefinado {
  prompt: string;
  resumen: string;
  tips: string[];
  images_enabled: boolean;
}

/** Estilos que ofrece el constructor al refinar (los valida ms-ai con lista blanca). */
export const ESTILOS_PORTADA = [
  { id: 'abstracto', nombre: 'Abstracto' },
  { id: 'geometrico', nombre: 'Geométrico' },
  { id: 'ilustracion', nombre: 'Ilustración' },
  { id: 'minimalista', nombre: 'Minimalista' },
  { id: 'isometrico', nombre: 'Isométrico' },
  { id: 'fotografico', nombre: 'Fotográfico' },
] as const;

export type EstiloPortada = (typeof ESTILOS_PORTADA)[number]['id'];

interface ImagenGenerada {
  b64: string;
  mime_type: string;
  model: string;
}

/**
 * DISEÑO ASISTIDO de un formulario dinámico (constructor → ms-ai → ms-documents).
 *
 * Dos ayudas, las dos opcionales:
 *  · `sugerir()` pide una paleta/icono/portada COHERENTES CON EL TEMA del formulario
 *    (se le mandan nombre, descripción y etiquetas de los campos, nada del contenido
 *    de las respuestas).
 *  · `generarPortada()` genera la imagen y la SUBE a ms-documents, porque el tema solo
 *    puede guardar referencias: un base64 dentro de ui_json viajaría en cada carga del
 *    formulario.
 */
@Injectable({ providedIn: 'root' })
export class FormDesignService {
  private http = inject(HttpClient);
  private media = inject(MediaOffloadService);

  private base = `${environment.apiUrl}/api/v1/ai/diseno-formulario`;

  sugerir(datos: {
    nombre: string;
    descripcion?: string | null;
    categoria?: string | null;
    campos: string[];
  }): Observable<SugerenciaDiseno> {
    return this.http.post<SugerenciaDiseno>(`${this.base}/sugerir`, {
      nombre: datos.nombre,
      descripcion: datos.descripcion ?? '',
      categoria: datos.categoria ?? '',
      campos: datos.campos.slice(0, 40),
    });
  }

  /**
   * REFINA el prompt de portada contra los estándares de la plataforma (ilustración
   * corporativa, sin texto, apaisada, coherente con la paleta). Solo texto: se puede
   * iterar las veces que haga falta antes de gastar una generación de imagen.
   */
  refinarPrompt(datos: {
    prompt: string;
    nombre: string;
    descripcion?: string | null;
    campos: string[];
    paleta: string[];
    estilo?: EstiloPortada | '';
  }): Observable<PromptRefinado> {
    return this.http.post<PromptRefinado>(`${this.base}/prompt-portada`, {
      prompt: datos.prompt,
      nombre: datos.nombre,
      descripcion: datos.descripcion ?? '',
      campos: datos.campos.slice(0, 40),
      paleta: datos.paleta,
      estilo: datos.estilo ?? '',
    });
  }

  /**
   * Genera la portada y la deja subida en ms-documents.
   * @param formId formulario dueño del documento (0 mientras el formulario no existe:
   *               la imagen queda igual guardada y el tema apunta a ella).
   */
  generarPortada(prompt: string, formId: number, ownerKey: string): Observable<DocumentRef> {
    return this.http
      .post<ImagenGenerada>(`${this.base}/imagen`, { prompt, size: '1536x1024' })
      .pipe(
        map(img => this.comoArchivo(img)),
        switchMap(file => this.subirPortada(file, formId, ownerKey)),
      );
  }

  /**
   * Portada elegida a mano: misma tubería que la generada (ms-documents).
   *
   * `ownerKey` identifica la portada DE ESTE formulario. ms-documents deduplica por
   * (ownerId, typeCode): si todas las portadas colgaran del usuario, cambiar la de un
   * formulario reescribiría la versión vigente del documento que los otros ya apuntan.
   */
  subirPortada(file: File, formId: number, ownerKey: string): Observable<DocumentRef> {
    return this.media.upload(file, formId, { typeCode: TIPO_DOC_PORTADA, ownerId: ownerKey });
  }

  /** Motivo legible de un fallo de subida (lo resuelve el offload de media). */
  motivoDeFallo(err: unknown, porDefecto: string): string {
    return this.media.motivoDeFallo(err, porDefecto);
  }

  /**
   * URL mostrable de la portada. Un documento de ms-documents exige JWT, y un <img> no
   * manda cabeceras: se baja como blob (el auth.interceptor sí actúa) y se devuelve un
   * objectURL. Quien lo use debe revocarlo al destruirse.
   */
  portadaBlobUrl(documentId: number): Observable<string> {
    return this.http
      .get(`${environment.apiUrl}/api/v1/documents/${documentId}/download`, { responseType: 'blob' })
      .pipe(map(blob => URL.createObjectURL(blob)));
  }

  private comoArchivo(img: ImagenGenerada): File {
    const binario = atob(img.b64);
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    const tipo = img.mime_type || 'image/png';
    const ext = tipo.includes('jpeg') ? 'jpg' : 'png';
    return new File([bytes], `portada-formulario-${Date.now()}.${ext}`, { type: tipo });
  }
}
