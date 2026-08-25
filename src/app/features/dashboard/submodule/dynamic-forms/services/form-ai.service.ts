import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '@/environments/environment';
import { FieldType } from '../models/dynamic-forms.models';
import { CampoBorrador, SeccionBorrador } from '../models/form-drafts';

/** Formulario entero propuesto por la IA a partir de una idea en texto libre. */
export interface BorradorIa {
  nombre: string;
  descripcion: string;
  categoria: string;
  secciones: SeccionBorrador[];
  resumen: string;
  tips: string[];
}

/** Una pregunta propuesta para un formulario que ya tiene contenido. */
export interface PreguntaIa extends CampoBorrador {
  /** Sección donde encajaría (título tal cual lo devolvió la IA). */
  seccion: string;
  /** Por qué la propone. */
  motivo: string;
}

export interface PreguntasIa {
  preguntas: PreguntaIa[];
  resumen: string;
  tips: string[];
}

/** Lo que ms-ai devuelve en el wire (snake_case, campos siempre presentes). */
interface CampoWire {
  label: string;
  type: string;
  required?: boolean;
  description?: string;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  text?: string;
  seccion?: string;
  motivo?: string;
}

interface BorradorWire {
  nombre?: string;
  descripcion?: string;
  categoria?: string;
  secciones?: Array<{ titulo?: string; campos?: CampoWire[] }>;
  resumen?: string;
  tips?: string[];
}

interface PreguntasWire {
  preguntas?: CampoWire[];
  resumen?: string;
  tips?: string[];
}

/**
 * CONTENIDO ASISTIDO de un formulario dinámico (constructor → ms-ai).
 *
 * Hermano de FormDesignService: aquel pide cómo SE VE el formulario, este pide QUÉ
 * PREGUNTA. Las dos operaciones son propuestas: devuelven borradores que el usuario
 * revisa y edita en el constructor, y nada se guarda hasta que él publica.
 *
 * El catálogo de tipos viaja en cada llamada (`tipos`) porque el que manda es el de
 * ms-forms: si mañana aparece un tipo nuevo, la IA puede usarlo sin tocar ms-ai.
 */
@Injectable({ providedIn: 'root' })
export class FormAiService {
  private http = inject(HttpClient);

  private base = `${environment.apiUrl}/api/v1/ai/contenido-formulario`;

  /** Formulario completo a partir de una idea escrita por el usuario. */
  borrador(datos: {
    objetivo: string;
    nombre?: string;
    categoria?: string;
    /** Plantilla de la que se parte, si eligió una. */
    base?: string;
    /** Lo que ya hay en el constructor: la IA no debe repetirlo. */
    contenido?: string[];
    tipos: FieldType[];
  }): Observable<BorradorIa> {
    return this.http.post<BorradorWire>(`${this.base}/borrador`, {
      objetivo: datos.objetivo,
      nombre: datos.nombre ?? '',
      categoria: datos.categoria ?? '',
      base: datos.base ?? '',
      contenido: (datos.contenido ?? []).slice(0, 60),
      tipos: datos.tipos,
    }).pipe(map(r => this.aBorrador(r)));
  }

  /** Preguntas ADICIONALES para el formulario que se está armando o editando. */
  preguntas(datos: {
    instruccion: string;
    nombre: string;
    descripcion?: string | null;
    categoria?: string | null;
    secciones: string[];
    contenido: string[];
    tipos: FieldType[];
    cantidad?: number;
  }): Observable<PreguntasIa> {
    return this.http.post<PreguntasWire>(`${this.base}/preguntas`, {
      instruccion: datos.instruccion,
      nombre: datos.nombre,
      descripcion: datos.descripcion ?? '',
      categoria: datos.categoria ?? '',
      secciones: datos.secciones.slice(0, 8),
      contenido: datos.contenido.slice(0, 60),
      tipos: datos.tipos,
      cantidad: datos.cantidad ?? 6,
    }).pipe(map(r => this.aPreguntas(r)));
  }

  private aBorrador(r: BorradorWire): BorradorIa {
    return {
      nombre: r.nombre ?? '',
      descripcion: r.descripcion ?? '',
      categoria: r.categoria ?? '',
      secciones: (r.secciones ?? []).map(s => ({
        titulo: s.titulo ?? '',
        campos: (s.campos ?? []).map(c => this.aCampo(c)),
      })).filter(s => s.campos.length > 0),
      resumen: r.resumen ?? '',
      tips: r.tips ?? [],
    };
  }

  private aPreguntas(r: PreguntasWire): PreguntasIa {
    return {
      preguntas: (r.preguntas ?? []).map(c => ({
        ...this.aCampo(c),
        seccion: c.seccion ?? '',
        motivo: c.motivo ?? '',
      })),
      resumen: r.resumen ?? '',
      tips: r.tips ?? [],
    };
  }

  /**
   * Wire → borrador. `type` llega como texto: ms-ai ya lo validó contra el catálogo
   * que le mandamos, así que aquí solo se tipa.
   */
  private aCampo(c: CampoWire): CampoBorrador {
    return {
      label: c.label,
      type: c.type as FieldType,
      required: !!c.required,
      description: c.description || undefined,
      placeholder: c.placeholder || undefined,
      options: c.options?.length ? c.options : undefined,
      text: c.text || undefined,
    };
  }
}
