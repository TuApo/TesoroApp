import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { environment } from '@/environments/environment';

/** Tipo documental ya anidado (con `subtypes` resuelto). */
export interface TipoDocumentalNode {
  id: number;
  name: string;
  estado: boolean;
  codigoContrato?: boolean;
  parentId: number | null;
  subtypes: TipoDocumentalNode[];
  [key: string]: any;
}

/**
 * El endpoint /document-types devuelve una lista PLANA donde cada tipo apunta
 * hacia ARRIBA (`parent` anidado) y nunca trae `subtypes`. Esta función invierte
 * esa relación y entrega las raíces del árbol.
 *
 * Vive en el servicio a propósito: varias vistas necesitan el mismo árbol y dos
 * implementaciones paralelas de esto terminan divergiendo.
 */
export function construirArbolTiposDocumentales(flat: any[]): TipoDocumentalNode[] {
  const byId = new Map<number, TipoDocumentalNode>();

  for (const raw of flat || []) {
    const { parent, ...rest } = raw;
    byId.set(raw.id, { ...rest, parentId: parent?.id ?? null, subtypes: [] } as TipoDocumentalNode);
  }

  const desciendeDe = (candidato: TipoDocumentalNode, nodo: TipoDocumentalNode): boolean => {
    let actual: TipoDocumentalNode | undefined = candidato;
    const vistos = new Set<number>();
    while (actual && !vistos.has(actual.id)) {
      if (actual.id === nodo.id) return true;
      vistos.add(actual.id);
      actual = actual.parentId != null ? byId.get(actual.parentId) : undefined;
    }
    return false;
  };

  const roots: TipoDocumentalNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId != null ? byId.get(node.parentId) : undefined;
    // Padre ausente o referencia cíclica -> se degrada a raíz: así el nodo nunca
    // desaparece de la vista ni provoca recursión infinita al recorrer el árbol.
    if (parent && parent !== node && !desciendeDe(parent, node)) {
      parent.subtypes.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

/** Un grupo del selector: la etiqueta es el nombre del tipo padre. */
export interface GrupoTipos {
  padre: string;
  hijos: any[];
}

/**
 * Agrupa CADA tipo bajo el nombre de su padre, para que los selectores reflejen
 * la jerarquía real en vez de una lista plana.
 *
 * Se listan también los contenedores, no solo las hojas: hay documentos cargados
 * directamente contra contenedores (p. ej. HOJA_DE_VIDA), así que ocultarlos
 * rompería flujos en uso. Van marcados con `esCategoria`.
 */
export function agruparTiposPorPadre(raices: TipoDocumentalNode[]): GrupoTipos[] {
  const grupos: GrupoTipos[] = [];

  const walk = (nodos: TipoDocumentalNode[], etiquetaPadre: string) => {
    if (!nodos.length) return;
    grupos.push({
      padre: etiquetaPadre,
      hijos: nodos.map(n => ({ ...n, esCategoria: n.subtypes.length > 0 })),
    });
    // Recorrido en profundidad: cada categoría abre su propio grupo justo después.
    for (const n of nodos) walk(n.subtypes, n.name);
  };

  walk(raices, 'Nivel raíz');
  return grupos;
}

@Injectable({
  providedIn: 'root',
})
export class DocumentacionService {
  private apiUrl = environment.apiUrl;

  constructor(
    private http: HttpClient,
    @Inject(PLATFORM_ID) private platformId: Object
  ) { }

  private handleError(error: any): Observable<never> {
    throw error;
  }

  /**
   * Crea/actualiza un Document. Si la persona NO es CC, pasar
   * `tipo_documento` para que el backend prefije owner_id con "x".
   */
  guardarDocumento(
    title: any,
    owner_id: any,
    type: number,
    file: File,
    contract_number?: string,
    tipo_documento?: string
  ): Observable<any> {
    const formData = new FormData();
    formData.append('title', title);
    formData.append('owner_id', owner_id);
    formData.append('type', type.toString());
    formData.append('file', file);
    if (contract_number) formData.append('contract_number', contract_number);
    if (tipo_documento) formData.append('tipo_documento', tipo_documento);

    return this.http.post(
      `${this.apiUrl}/gestion_documental/documentos/`,
      formData
    );
  }

  // Buscar en contratacion por cedula para sacar los numeros
  public mostrar_jerarquia_gestion_documental(): Observable<any> {

    return this.http
      .get(`${this.apiUrl}/gestion_documental/document-types/`,)
      .pipe(
        map((response: any) => response),
        catchError(this.handleError)
      );
  }

  /**
   * Misma fuente que `mostrar_jerarquia_gestion_documental`, pero ya anidada.
   * Úsala cuando necesites la jerarquía real; el método plano se conserva
   * porque otras vistas dependen de la forma cruda del backend.
   */
  public mostrar_jerarquia_anidada(): Observable<TipoDocumentalNode[]> {
    return this.mostrar_jerarquia_gestion_documental()
      .pipe(map((flat: any[]) => construirArbolTiposDocumentales(flat)));
  }



  // document-type/ put
  public editar_tipo_documento(id: number, data: any): Observable<any> {

    return this.http
      .put(`${this.apiUrl}/gestion_documental/document-types/${id}`, data,)
      .pipe(
        map((response: any) => response),
        catchError(this.handleError)
      );
  }

  // Agregar un nuevo tipo de documento (POST)
  public crear_tipo_documento(data: any): Observable<any> {

    return this.http
      .post(`${this.apiUrl}/gestion_documental/document-types-create/`, data,)
      .pipe(
        map((response: any) => response),
        catchError(this.handleError)
      );
  }

  //  document-search/
  public buscar_documentos(data: any): Observable<any> {

    return this.http
      .get(`${this.apiUrl}/gestion_documental/document-search/`, {
        params: data,
      })
      .pipe(
        map((response: any) => response),
        catchError(this.handleError)
      );
  }

  //  permisos/
  public mostrar_permisos(): Observable<any> {

    return this.http
      .get(`${this.apiUrl}/gestion_documental/permisos/`,)
      .pipe(
        map((response: any) => response),
        catchError(this.handleError)
      );
  }

  // permisos/<int:pk>/
  public crear_permiso(data: {
    cedula: string;
    tipo_documental_id: number;
  }): Observable<any> {

    return this.http
      .post(`${this.apiUrl}/gestion_documental/permisos/`, data,)
      .pipe(
        map((response: any) => response),
        catchError(this.handleError)
      );
  }

  actualizarDocumento(
    title: string,
    owner_id: string,
    type: number,
    file: Blob,
    filename: string,
    contract_number?: string
  ): Observable<any> {
    const formData = new FormData();
    formData.append('title', title);
    formData.append('owner_id', owner_id);
    formData.append('type', type.toString());
    formData.append('file', file, filename);
    if (contract_number) formData.append('contract_number', contract_number);

    return this.http
      .post(`${this.apiUrl}/gestion_documental/documentos/`, formData)
      .pipe(
        map((response: any) => response),
        catchError(this.handleError)
      );
  }

  bulkZipUpload(
    zipFile: File,
    opts?: { contract_from_filename?: boolean; default_contract?: string }
  ): Observable<any> {
    const form = new FormData();
    form.append('zip_file', zipFile, zipFile.name);
    if (opts?.contract_from_filename !== undefined) {
      form.append('contract_from_filename', String(!!opts.contract_from_filename));
    }
    if (opts?.default_contract) {
      form.append('default_contract', opts.default_contract);
    }

    // si tu backend expone directamente /bulk-zip-upload/ en la raíz de apiUrl:
    const url = `${this.apiUrl}/gestion_documental/bulk-zip-upload/`;
    // si lo tienes con prefijo (ej. /api/gestion-documental/bulk-zip-upload/), ajusta arriba.

    return this.http.post<any>(url, form);
    // no pongas Content-Type: multipart/form-data manualmente;
    // HttpClient gestiona boundary y headers automáticamente.
  }



}
