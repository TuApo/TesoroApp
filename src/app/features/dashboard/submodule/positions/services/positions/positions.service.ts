// src/app/features/positions/services/positions.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';

export interface Cargo {
  nombre: string;           // PK
  porcentaje_arl: number;   // 0..100
}

export interface CargoListParams {
  q?: string;
  porcentaje_arl?: number;  // exacto (0..100)
  arl?: number;             // alias permitido por el backend (exacto)
  arl_min?: number;         // rango mínimo (0..100)
  arl_max?: number;         // rango máximo (0..100)
}

export interface CargoImportResult {
  ok: boolean;
  creados: number;
  actualizados: number;
  filas_sin_nombre: number;
  errores: Array<{ row: number; nombre: string; error: string }>;
}

@Injectable({ providedIn: 'root' })
export class PositionsService {
  private readonly http = inject(HttpClient);
  /** Ajusta si tu API tiene prefijo distinto */
  private readonly base = `${environment.apiUrl}/gestion_cargos/cargos/`;

  // ---------- LIST ----------
  list(params?: CargoListParams): Observable<Cargo[]> {
    return this.http.get<Cargo[]>(this.base, { params: this.buildParams(params) });
  }

  // ---------- RETRIEVE ----------
  get(nombre: string): Observable<Cargo> {
    return this.http.get<Cargo>(this.base + encodeURIComponent(nombre) + '/');
  }

  // ---------- CREATE ----------
  create(body: Cargo): Observable<Cargo> {
    return this.http.post<Cargo>(this.base, body);
  }

  // ---------- UPDATE (nota: no cambia el PK 'nombre') ----------
  update(nombre: string, body: Partial<Cargo>): Observable<Cargo> {
    return this.http.put<Cargo>(this.base + encodeURIComponent(nombre) + '/', body);
  }

  // ---------- PATCH ----------
  patch(nombre: string, body: Partial<Cargo>): Observable<Cargo> {
    return this.http.patch<Cargo>(this.base + encodeURIComponent(nombre) + '/', body);
  }

  // ---------- DELETE ----------
  remove(nombre: string): Observable<void> {
    return this.http.delete<void>(this.base + encodeURIComponent(nombre) + '/');
  }

  // ---------- IMPORTAR EXCEL ----------
  importExcel(file: File | Blob): Observable<CargoImportResult> {
    const form = new FormData();
    form.append('file', file, (file as any).name || 'cargos.xlsx');
    return this.http.post<CargoImportResult>(this.base + 'importar-excel/', form);
  }

  // ---------- EXPORTAR EXCEL (Blob) ----------
  exportExcel(params?: CargoListParams): Observable<Blob> {
    return this.http.get(this.base + 'exportar-excel/', {
      params: this.buildParams(params),
      responseType: 'blob'
    });
  }

  // ---------- Helper: descargar directo ----------
  downloadExcel(params?: CargoListParams, filename = this.makeFilename()): void {
    this.exportExcel(params).subscribe({
      next: (blob: any) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 0);
      },
    });
  }

  // ---------- Helpers ----------
  private buildParams(params?: CargoListParams): HttpParams {
    let p = new HttpParams();
    if (!params) return p;

    const setNum = (key: string, val?: number) => {
      if (val !== undefined && val !== null && !Number.isNaN(val)) {
        p = p.set(key, String(val));
      }
    };

    if (params.q) p = p.set('q', params.q);
    setNum('porcentaje_arl', params.porcentaje_arl);
    setNum('arl', params.arl);           // alias aceptado por el backend
    setNum('arl_min', params.arl_min);
    setNum('arl_max', params.arl_max);

    return p;
  }

  private makeFilename(): string {
    const d = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `cargos_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.xlsx`;
  }
}
