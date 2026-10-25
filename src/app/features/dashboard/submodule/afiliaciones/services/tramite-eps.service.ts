import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import { conAliasCamel, aSnake } from './claves-api';

const BASE = `${environment.apiUrl}/gestion_afiliaciones/envios-eps`;

/** Etapas del trámite con soportes propios (V73). */
export type EtapaTramite = 'REMISION' | 'RESPUESTA' | 'AFILIACION' | 'OTRO';
export type EstadoTramite = 'POR_ENVIAR' | 'RADICADA' | 'CON_RESPUESTA' | 'CONFIRMADA' | 'RECHAZADA';

export interface DocumentoTramite {
  id: number; tramiteId: number; etapa: EtapaTramite; documentId: number; versionId: number | null;
  nombreArchivo: string | null; mime: string | null; tamanoBytes: number | null; nota: string | null;
  subidoPor: string | null; createdAt: string;
}
export interface EventoTramite {
  id: number; estadoAnterior: string | null; estadoNuevo: string; detalle: string | null; usuario: string | null; createdAt: string;
}
export interface TramiteEps {
  id: number; procesoId: number; cedula: string; nombre: string; epsKey: string; epsNombre: string;
  estado: EstadoTramite; canal: string | null; radicadoNumero: string | null; radicadoFecha: string | null;
  confirmacionFecha: string | null; rechazoMotivo: string | null; nota: string | null; updatedAt: string;
}
export interface TramiteDetalle { tramite: TramiteEps; documentos: DocumentoTramite[]; eventos: EventoTramite[]; }
export interface GeneracionDoc { plantilla: string | null; version: number | null; modo: string; generadoPor: string | null; generadoAt: string; }
export interface LineaTiempoEps { procesoId: number; generaciones: GeneracionDoc[]; tramites: TramiteDetalle[]; }
export interface ResultadoSubida { archivos: number; cargados: number; detalles: string[]; estado: EstadoTramite | null; }
export interface ResultadoMasivoEps { procesados: number; ok: number; omitidos: number; detalles: string[]; }

/** ms-hr acepta 15 MB por petición: los archivos viajan en tandas de hasta 12 MB. */
const TANDA_BYTES = 12 * 1024 * 1024;

/**
 * Control de la afiliación EPS por contrato (ms-hr V73): línea de tiempo, soportes por etapa y
 * carga en lote por cédula. Las transiciones de rechazo y reapertura son las de Envíos a EPS.
 */
@Injectable({ providedIn: 'root' })
export class TramiteEpsService {
  private http = inject(HttpClient);

  lineaTiempo(procesoId: number): Observable<LineaTiempoEps> {
    return this.http.get<LineaTiempoEps>(`${BASE}/linea-tiempo/${procesoId}`).pipe(map(r => conAliasCamel(r)));
  }

  iniciar(procesoIds: number[]): Observable<ResultadoMasivoEps> {
    return this.http.post<ResultadoMasivoEps>(`${BASE}/tramites/iniciar`, aSnake({ procesoIds })).pipe(map(r => conAliasCamel(r)));
  }

  /** Una tanda de archivos a una etapa. {@code avanzar} mueve el estado (solo en la primera tanda). */
  subir(tramiteId: number, etapa: EtapaTramite, archivos: File[], nota: string | null, avanzar: boolean): Observable<ResultadoSubida> {
    const fd = new FormData();
    fd.append('etapa', etapa);
    fd.append('avanzar', String(avanzar));
    if (nota) fd.append('nota', nota);
    archivos.forEach(f => fd.append('files', f, f.name));
    return this.http.post<ResultadoSubida>(`${BASE}/tramites/${tramiteId}/documentos`, fd).pipe(map(r => conAliasCamel(r)));
  }

  /** Lote: cada archivo va al trámite de la cédula que trae en el nombre, entre estos contratos. */
  subirLote(procesoIds: number[], etapa: EtapaTramite, archivos: File[], nota: string | null, avanzar: boolean): Observable<ResultadoSubida> {
    const fd = new FormData();
    procesoIds.forEach(id => fd.append('proceso_ids', String(id)));
    fd.append('etapa', etapa);
    fd.append('avanzar', String(avanzar));
    if (nota) fd.append('nota', nota);
    archivos.forEach(f => fd.append('files', f, f.name));
    return this.http.post<ResultadoSubida>(`${BASE}/documentos/lote`, fd).pipe(map(r => conAliasCamel(r)));
  }

  mover(tramiteId: number, etapa: EtapaTramite, nota: string | null, radicadoNumero?: string | null): Observable<ResultadoSubida> {
    return this.http.post<ResultadoSubida>(`${BASE}/tramites/${tramiteId}/mover`,
      aSnake({ etapa, nota, radicadoNumero: radicadoNumero || null })).pipe(map(r => conAliasCamel(r)));
  }

  rechazar(tramiteId: number, motivo: string): Observable<ResultadoMasivoEps> {
    return this.http.post<ResultadoMasivoEps>(`${BASE}/tramites/rechazar`, aSnake({ tramiteIds: [tramiteId], motivo })).pipe(map(r => conAliasCamel(r)));
  }

  reabrir(tramiteId: number, nota: string | null): Observable<ResultadoMasivoEps> {
    return this.http.post<ResultadoMasivoEps>(`${BASE}/tramites/reabrir`, aSnake({ tramiteIds: [tramiteId], nota })).pipe(map(r => conAliasCamel(r)));
  }

  descargar(documentoId: number): Observable<Blob> {
    return this.http.get(`${BASE}/documentos/${documentoId}`, { responseType: 'blob' });
  }

  /** Parte la lista de archivos en tandas que quepan en una petición. */
  static tandas(archivos: File[]): File[][] {
    const out: File[][] = [];
    let actual: File[] = [], peso = 0;
    for (const f of archivos) {
      if (actual.length && peso + f.size > TANDA_BYTES) { out.push(actual); actual = []; peso = 0; }
      actual.push(f); peso += f.size;
    }
    if (actual.length) out.push(actual);
    return out;
  }
}
