import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';
import type { ConceptoExamen } from '../recruitment-pipeline/examen-medico.rules';
import type { EstadoCarga, EstadoCruce } from './examenes-masivos.util';

/** Un archivo del lote, tal como lo devuelve ms-hr. */
export interface ItemLote {
  id: number;
  lote_id: number;
  archivo: string;
  tamano_bytes: number | null;
  cedula: string | null;
  candidato_id: number | null;
  proceso_id: number | null;
  nombre: string | null;
  estado_cruce: EstadoCruce;
  subible: boolean;
  mensaje: string | null;
  concepto: ConceptoExamen | null;
  restricciones: string | null;
  fecha_examen: string | null;
  estado_carga: EstadoCarga;
  error: string | null;
  documento_id: number | null;
  codigo_contrato: string | null;
}

export interface LoteExamenes {
  id: number;
  creado_por: string | null;
  ips: string | null;
  total: number;
  subidos: number;
  fallidos: number;
  estado: 'REVISION' | 'CARGANDO' | 'TERMINADO' | 'CON_ERRORES' | string;
  created_at: string | null;
  updated_at: string | null;
}

export interface RespuestaLote {
  lote: LoteExamenes;
  items: ItemLote[];
}

/** Lo que el operador confirmó para un archivo. */
export interface ItemParaSubir {
  item_id: number;
  concepto: ConceptoExamen;
  restricciones: string | null;
  fecha_examen: string | null;
}

/**
 * API de la carga masiva de exámenes (ms-hr,
 * `/gestion_contratacion/examenes-masivos`, pedido #11).
 */
@Injectable({ providedIn: 'root' })
export class ExamenesMasivosService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/gestion_contratacion/examenes-masivos`;

  /** Lee la cédula de cada nombre y la cruza con el proceso abierto. No sube nada. */
  preview(archivos: { nombre: string; tamano: number; cedula?: string | null }[],
          ips?: string | null, loteId?: number | null): Observable<RespuestaLote> {
    return this.http.post<RespuestaLote>(`${this.base}/preview/`, {
      archivos, ips: ips || null, lote_id: loteId ?? null,
    });
  }

  /** Vuelve a cruzar una fila con la cédula escrita a mano. */
  corregirCedula(itemId: number, cedula: string): Observable<ItemLote> {
    return this.http.patch<ItemLote>(`${this.base}/items/${itemId}/`, { cedula });
  }

  /** Sube una tanda: `archivos[i]` es el PDF de `items[i]`. */
  subir(loteId: number, tanda: { archivo: File; item: ItemParaSubir }[]): Observable<RespuestaLote> {
    const fd = new FormData();
    for (const t of tanda) fd.append('archivos', t.archivo, t.archivo.name);
    fd.append('items', JSON.stringify(tanda.map((t) => t.item)));
    return this.http.post<RespuestaLote>(`${this.base}/lotes/${loteId}/subir/`, fd);
  }

  lote(id: number): Observable<RespuestaLote> {
    return this.http.get<RespuestaLote>(`${this.base}/lotes/${id}/`);
  }

  recientes(): Observable<LoteExamenes[]> {
    return this.http.get<LoteExamenes[]>(`${this.base}/lotes/`);
  }
}
