import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';
import { ImportResult, ImportedForm, TemplateConfig } from '../models/form-import.models';

/**
 * CARGA POR EXCEL de Formularios Dinámicos.
 *
 * Dos llamadas y un buzón:
 *  - `plantilla()` baja el .xlsx ya parametrizado con el destino y los roles elegidos;
 *  - `cargar()` sube el archivo lleno y devuelve los formularios COMO QUEDARÍAN, sin
 *    guardar nada (el alta la sigue haciendo el constructor con createBuilder);
 *  - `pendiente` es el buzón para llevar un formulario leído desde el listado hasta el
 *    constructor: la ruta /builder no admite un objeto por parámetro y meterlo en la URL
 *    (o en sessionStorage) sería arrastrar el formulario entero por un canal de texto.
 */
@Injectable({ providedIn: 'root' })
export class FormImportService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/api/dynamic-forms`;

  /**
   * Formulario leído del Excel que espera a que el constructor lo recoja. Se consume
   * UNA vez (`tomarPendiente`) para que un F5 en /builder no vuelva a cargarlo.
   */
  readonly pendiente = signal<ImportedForm | null>(null);

  dejarPendiente(f: ImportedForm): void {
    this.pendiente.set(f);
  }

  tomarPendiente(): ImportedForm | null {
    const f = this.pendiente();
    if (f) this.pendiente.set(null);
    return f;
  }

  /** Plantilla .xlsx (blob) parametrizada con lo que el usuario ya eligió. */
  plantilla(config: TemplateConfig): Observable<Blob> {
    return this.http.post(`${this.base}/import/template`, config, { responseType: 'blob' });
  }

  /** Lee el archivo lleno. No persiste nada: devuelve lo que quedaría. */
  cargar(archivo: File): Observable<ImportResult> {
    const fd = new FormData();
    fd.append('file', archivo, archivo.name);
    return this.http.post<ImportResult>(`${this.base}/import/parse`, fd);
  }
}

/** Descarga un blob con el nombre dado (el navegador no lo hace solo desde XHR). */
export function descargarBlob(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  // El objectURL vive hasta que se revoca; sin esto se filtra el blob completo.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
