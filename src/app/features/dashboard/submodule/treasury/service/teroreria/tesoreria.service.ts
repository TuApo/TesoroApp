import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '@/environments/environment';

export interface PersonaTesoreriaPage {
  count: number;
  next: string | null;
  previous: string | null;
  results: PersonaTesoreriaItem[];
}

export interface PersonaTesoreriaItem {
  numero_documento: string;
  codigo?: string | null;
  nombre?: string | null;
  ingreso?: string | null;
  temporal?: string | null;
  finca?: string | null;

  salario?: number | string | null;
  saldos?: number | string | null;
  fondos?: number | string | null;
  mercados?: number | string | null;
  cuotas_mercados?: number | string | null;
  prestamo_para_descontar?: number | string | null;
  cuotas_prestamos_para_descontar?: number | string | null;
  casino?: number | string | null;
  valor_anchetas?: number | string | null;
  cuotas_anchetas?: number | string | null;
  fondo?: number | string | null;
  carnet?: number | string | null;
  seguro_funerario?: number | string | null;
  prestamo_para_hacer?: number | string | null;
  cuotas_prestamo_para_hacer?: number | string | null;
  anticipo_liquidacion?: number | string | null;
  cuentas?: number | string | null;

  bloqueado?: boolean;
  fecha_bloqueo?: string | null;
  observacion_bloqueo?: string | null;
  observacion_desbloqueo?: string | null;
  fecha_desbloqueo?: string | null;

  activo?: boolean;
  saldo_pendiente?: number | string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ExcelImportResponse {
  total_rows: number;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  deactivated?: number;
  errors_count: number;
  errors_sample: { row: number, error: string }[];
}

@Injectable({ providedIn: 'root' })
export class TesoreriaService {
  private apiUrl = environment.apiUrl;

  constructor(
    private http: HttpClient,
    @Inject(PLATFORM_ID) private platformId: Object
  ) { }

  private handleError(error: any) {
    return throwError(() => error);
  }

  // ===================================================================
  // Adaptador de contrato con ms-payroll:
  // el backend responde ARRAY plano en camelCase e IGNORA limit/page.
  // El frontend (este componente) trabaja en snake_case y espera {results}.
  // Convertimos las claves en ambos sentidos y paginamos en cliente.
  // ===================================================================
  private static camelToSnake(k: string): string {
    return k.replace(/([A-Z])/g, m => '_' + m.toLowerCase());
  }
  private static snakeToCamel(k: string): string {
    return k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  }
  // Campos Instant que el backend serializa como epoch en SEGUNDOS. El pipe
  // date los lee como ms → mostraba 21/01/1970. Los convertimos a Date aquí.
  private static readonly DATE_FIELDS = new Set(
    ['fecha_bloqueo', 'fecha_desbloqueo', 'fecha_corte', 'created_at', 'updated_at']);

  private toSnake<T = any>(obj: any): T {
    if (obj == null || typeof obj !== 'object') return obj;
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => {
        const sk = TesoreriaService.camelToSnake(k);
        if (TesoreriaService.DATE_FIELDS.has(sk) && typeof v === 'number') {
          v = new Date(v * 1000);
        }
        return [sk, v];
      })
    ) as T;
  }
  private toCamel<T = any>(obj: any): T {
    if (obj == null || typeof obj !== 'object') return obj;
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [TesoreriaService.snakeToCamel(k), v])
    ) as T;
  }

  // --- Mass Excel Imports ---

  async importarPersonasExcel(file: File): Promise<ExcelImportResponse> {
    const url = `${this.apiUrl}/gestion_tesoreria/personas/import-excel/`;
    const formData = new FormData();
    formData.append('file', file);
    return firstValueFrom(this.http.post<ExcelImportResponse>(url, formData).pipe(catchError(this.handleError)));
  }

  async importarSaldosFondosExcel(file: File): Promise<ExcelImportResponse> {
    const url = `${this.apiUrl}/gestion_tesoreria/personas/saldos/import-excel/`;
    const formData = new FormData();
    formData.append('file', file);
    return firstValueFrom(this.http.post<ExcelImportResponse>(url, formData).pipe(catchError(this.handleError)));
  }

  async importarEstadosExcel(file: File): Promise<ExcelImportResponse> {
    const url = `${this.apiUrl}/gestion_tesoreria/personas/estados/import-excel/`;
    const formData = new FormData();
    formData.append('file', file);
    return firstValueFrom(this.http.post<ExcelImportResponse>(url, formData).pipe(catchError(this.handleError)));
  }

  // --- CRUD PersonaTesoreria ---

  /** Contadores de cabecera sin traerse el universo solo para contar. */
  async traerResumenPersonas(): Promise<{ total: number; activos: number }> {
    const r = await firstValueFrom(
      this.http.get<any>(`${this.apiUrl}/gestion_tesoreria/personas/resumen`)
        .pipe(catchError(this.handleError))
    );
    return { total: r?.total ?? 0, activos: r?.activos ?? 0 };
  }

  /**
   * Página real desde el servidor. `?paginated=true` es opt-in en el backend:
   * sin él, /personas sigue devolviendo el array plano de siempre (otras vistas
   * dependen de esa forma). Una página de 50 pesa ~38 KB frente a los 37,3 MB
   * del universo completo.
   */
  async traerDatosbasePaginado(page = 0, size = 50, search = '', soloActivos = true): Promise<PersonaTesoreriaPage> {
    const params = new URLSearchParams({
      paginated: 'true',
      page: String(page),
      size: String(size),
    });
    if (soloActivos) params.set('activo', 'true');
    const term = (search || '').trim();
    if (term) params.set('search', term);

    const raw = await firstValueFrom(
      this.http.get<any>(`${this.apiUrl}/gestion_tesoreria/personas/?${params.toString()}`)
        .pipe(catchError(this.handleError))
    );

    // Spring devuelve un Page: {content, totalElements, ...}
    const arr: any[] = Array.isArray(raw?.content) ? raw.content : [];
    return {
      count: raw?.totalElements ?? arr.length,
      next: null,
      previous: null,
      results: arr.map(x => this.toSnake<PersonaTesoreriaItem>(x)),
    };
  }

  async traerDatosbaseGeneral(_limit = 500, _offset = 0, search: string = '', soloActivos = false): Promise<PersonaTesoreriaPage> {
    // El backend devuelve un array plano en camelCase e IGNORA limit/page/search:
    // entrega TODO el universo en una sola respuesta. La tabla del componente
    // (MatTableDataSource + MatPaginator) pagina en cliente, así que devolvemos
    // el universo completo para no ocultar trabajadores. Toleramos también
    // {results} por si algún día se pagina en servidor.
    //
    // PERO sí soporta ?activo=true, y ahí está la diferencia entre cargar y no cargar:
    //   findAll()      -> 37,3 MB / 50.190 filas  (el navegador se ahoga)
    //   ?activo=true   ->  4,9 MB /  6.662 filas
    // La vista arranca sin inactivos, así que por defecto pedimos solo activos en
    // vez de traerse 43.000 filas para tirarlas en el cliente.
    const url = soloActivos
      ? `${this.apiUrl}/gestion_tesoreria/personas/?activo=true`
      : `${this.apiUrl}/gestion_tesoreria/personas/`;

    const raw = await firstValueFrom(
      this.http.get<any>(url).pipe(
        catchError(this.handleError)
      )
    );

    const arr: any[] = Array.isArray(raw)
      ? raw
      : (Array.isArray(raw?.results) ? raw.results : []);

    let items: PersonaTesoreriaItem[] = arr.map(x => this.toSnake<PersonaTesoreriaItem>(x));

    const term = (search || '').trim().toLowerCase();
    if (term) {
      items = items.filter(w =>
        String(w.numero_documento ?? '').toLowerCase().includes(term) ||
        String(w.nombre ?? '').toLowerCase().includes(term)
      );
    }

    return {
      count: items.length,
      next: null,
      previous: null,
      results: items,
    };
  }

  async traerTodosLosDatos(): Promise<PersonaTesoreriaItem[]> {
    // El backend entrega todo el universo en una sola respuesta;
    // pedimos un límite muy alto para no cortar y devolvemos el array completo.
    const first = await this.traerDatosbaseGeneral(1_000_000, 0);
    return first.results;
  }

  async traerDatosbasePorDocumento(doc: string): Promise<PersonaTesoreriaItem | null> {
    const url = `${this.apiUrl}/gestion_tesoreria/personas/${encodeURIComponent(doc)}/`;
    try {
      const response = await firstValueFrom(
        this.http.get<any>(url).pipe(
          catchError(this.handleError)
        )
      );
      return response ? this.toSnake<PersonaTesoreriaItem>(response) : null;
    } catch (e: any) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  async actualizarDatosbaseCompleto(numero_documento: string, payload: PersonaTesoreriaItem): Promise<any> {
    const url = `${this.apiUrl}/gestion_tesoreria/personas/${encodeURIComponent(numero_documento)}/`;
    // PATCH (merge por-campo-no-nulo) en vez de PUT: el PUT hacía save() con
    // reemplazo total y borraba saldo_actual/saldo_disponible/fecha_corte
    // (columnas que el diálogo NO envía). Con PATCH esos snapshots quedan intactos.
    return firstValueFrom(
      this.http.patch<any>(url, this.toCamel(payload)).pipe(
        catchError(this.handleError)
      )
    );
  }

  async actualizarParcial(numero_documento: string, cambios: Partial<PersonaTesoreriaItem>): Promise<any> {
    const url = `${this.apiUrl}/gestion_tesoreria/personas/${encodeURIComponent(numero_documento)}/`;
    return firstValueFrom(
      this.http.patch<any>(url, this.toCamel(cambios)).pipe(
        catchError(this.handleError)
      )
    );
  }

  async actualizarEstado(
    numero_documento: string,
    cambios: {
      bloqueado?: boolean;
      activo?: boolean;
      fecha_bloqueo?: string | null;
      fecha_desbloqueo?: string | null;
      observacion_bloqueo?: string;
      observacion_desbloqueo?: string;
    }
  ): Promise<any> {
    const url = `${this.apiUrl}/gestion_tesoreria/personas/${encodeURIComponent(numero_documento)}/`;
    return firstValueFrom(
      this.http.patch<any>(url, this.toCamel(cambios)).pipe(
        catchError(this.handleError)
      )
    );
  }

  // --- Old endpoints kept for compatibility or not yet refactored ---

  async resetearValoresQuincena(): Promise<any> {
    // Si tienes un endpoint para esto, sino dejar el original
    const urlcompleta = `${this.apiUrl}/gestion_tesoreria/personas/reset-quincena/`;
    return firstValueFrom(
      this.http.post<any>(urlcompleta, {}).pipe(
        catchError(this.handleError)
      )
    );
  }
}
