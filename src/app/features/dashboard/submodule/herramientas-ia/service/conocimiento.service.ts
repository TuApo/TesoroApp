import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';

// ── DTOs (mirror de KbDtos.java) ─────────────────────────────────────────────

export type EstadoKb = 'PROCESANDO' | 'LISTO' | 'ERROR';
export type OrigenKb = 'archivo' | 'texto' | 'constructor' | 'agente' | 'fuente';

export interface DocDto {
  id: number; nombre: string; tipoMime: string; modulos: string[];
  longitud: number; preview: string | null; usuarioId: string;
  createdAt: string | number; updatedAt: string | number | null;
  // v2: Docling + red semántica
  origen?: OrigenKb | null; estado?: EstadoKb | null; estadoDetalle?: string | null; motor?: string | null;
  archivoNombre?: string | null; archivoBytes?: number | null; paginas?: number | null;
  vectorizado?: boolean; fragmentos?: number; resumen?: string | null; grafoAt?: string | number | null;
}

export interface SubirDocReq {
  nombre: string; tipoMime: string; contenido: string; modulos: string[];
}

export interface SeccionDto { nivel: number; ruta: string; titulo: string; }
export interface ConceptoDto { clave: string; nombre: string; tipo: string; descripcion: string | null; peso: number; }
export interface RelacionDto { origen: string; destino: string; tipo: string; }
export interface FragmentoDto { id: number; posicion: number; seccion: string | null; contenido: string; }

export interface DocDetalle {
  doc: DocDto; contenido: string; secciones: SeccionDto[];
  conceptos: ConceptoDto[]; relaciones: RelacionDto[];
}

export interface NodoDto {
  id: string; nombre: string; categoria: string; valor: number; detalle: string | null; documentoId: number | null;
}
export interface EnlaceDto { origen: string; destino: string; tipo: string; peso: number; }
export interface GrafoDto { nodos: NodoDto[]; enlaces: EnlaceDto[]; meta: Record<string, number>; }

export interface ModuloKbDto { clave: string; nombre: string; icono: string; chat: boolean; bases: number; }

export interface ConceptoTop { clave: string; nombre: string; tipo: string; bases: number; }

export interface ResumenKb {
  bases: number; fragmentos: number; conceptos: number; relaciones: number; vectorizadas: number;
  procesando: number; conError: number; sinRed: number;
  porModulo: Record<string, number>; porOrigen: Record<string, number>; porMotor: Record<string, number>;
  conceptosTop: ConceptoTop[];
  docai: { ok?: boolean; motores?: Record<string, boolean>; fragmentos?: number; configurado?: boolean; error?: string } | null;
}

export interface HallazgoDto {
  documentoId: number | null; documento: string | null; seccion: string | null;
  texto: string; puntaje: number | null; via: 'palabras' | 'significado';
}
export interface BuscarResp {
  consulta: string; modulos: string[]; palabras: HallazgoDto[]; significado: HallazgoDto[]; contexto: string;
}

export interface LoteResp { simulado: boolean; candidatas: number; ids: number[]; nota: string; }

export interface MensajeConstructor { rol: 'persona' | 'ia'; texto: string; }
export interface ConstructorReq {
  historial: MensajeConstructor[]; mensaje: string; borrador: string;
  nombre: string; modulos: string[]; adjuntoNombre?: string | null; adjuntoTexto?: string | null;
}
export interface ConstructorResp {
  respuesta: string; borrador: string; nombre: string; modulos: string[]; sugerencias: string[];
}
export interface AdjuntoDto { nombre: string; markdown: string; paginas: number | null; motor: string; aviso: string | null; }

// ── Fuentes externas (FuentesDtos.java) ──────────────────────────────────────

export type TipoFuente = 'WEB' | 'API' | 'MCP' | 'CLIMA';
export interface BaseDeFuente { id: number; nombre: string; estado: EstadoKb; parte: string | null; updatedAt: string | number | null; }
export interface FuenteDto {
  id: number; nombre: string; tipo: TipoFuente; descripcion: string | null; config: any; tieneSecreto: boolean;
  modulos: string[]; frecuenciaMin: number; conRed: boolean; transformacion: 'ninguna' | 'ia'; instruccionesIa: string | null;
  activo: boolean; ultimoEstado: 'EJECUTANDO' | 'OK' | 'SIN_CAMBIOS' | 'ERROR' | null; ultimoDetalle: string | null;
  ultimaEjecucion: string | number | null; proximaEjecucion: string | number | null; creadoPor: string | null; bases: BaseDeFuente[];
}
export interface FuenteReq {
  nombre?: string; tipo?: TipoFuente; descripcion?: string | null; config?: any; secreto?: string | null; borrarSecreto?: boolean;
  modulos?: string[]; frecuenciaMin?: number; conRed?: boolean; transformacion?: 'ninguna' | 'ia'; instruccionesIa?: string | null; activo?: boolean;
}
export interface EjecucionDto { id: number; inicio: string | number; fin: string | number | null; estado: string; disparo: string; documentos: number; bytes: number; detalle: string | null; }
export interface PruebaResp { partes: { parte: string; titulo: string; markdown: string; caracteres: number }[]; avisos: string[]; milisegundos: number; }
export interface SugerenciaDto {
  nombre: string; tipo: TipoFuente; descripcion: string; porque: string; config: any; modulos: string[]; frecuenciaMin: number;
  transformacion: 'ninguna' | 'ia'; instruccionesIa: string | null; verificada: boolean; verificacion: string;
}
export interface McpServidorDto { id: string; nombre: string; estado: string; herramientas: { nombre: string; titulo: string | null; descripcion: string | null; inputSchema: any }[]; }

@Injectable({ providedIn: 'root' })
export class ConocimientoService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/ia/conocimiento`;

  // ── Panorama ────────────────────────────────────────────────────────────────
  resumen(): Observable<ResumenKb> {
    return this.http.get<ResumenKb>(`${this.base}/resumen`);
  }

  modulos(): Observable<ModuloKbDto[]> {
    return this.http.get<ModuloKbDto[]>(`${this.base}/modulos`);
  }

  grafoGlobal(opc: { modulo?: string | null; maxConceptos?: number; incluirAgentes?: boolean } = {}): Observable<GrafoDto> {
    let p = new HttpParams();
    if (opc.modulo) p = p.set('modulo', opc.modulo);
    if (opc.maxConceptos) p = p.set('maxConceptos', opc.maxConceptos);
    if (opc.incluirAgentes) p = p.set('incluirAgentes', true);
    return this.http.get<GrafoDto>(`${this.base}/grafo`, { params: p });
  }

  buscar(consulta: string, modulo: string | null, limite = 6): Observable<BuscarResp> {
    return this.http.post<BuscarResp>(`${this.base}/buscar`, { consulta, modulo, limite });
  }

  // ── Bases ───────────────────────────────────────────────────────────────────
  listarDocumentos(): Observable<DocDto[]> {
    return this.http.get<DocDto[]>(`${this.base}/documentos`);
  }

  detalle(id: number): Observable<DocDetalle> {
    return this.http.get<DocDetalle>(`${this.base}/documentos/${id}`);
  }

  fragmentos(id: number): Observable<FragmentoDto[]> {
    return this.http.get<FragmentoDto[]>(`${this.base}/documentos/${id}/fragmentos`);
  }

  grafoDocumento(id: number): Observable<GrafoDto> {
    return this.http.get<GrafoDto>(`${this.base}/documentos/${id}/grafo`);
  }

  subirDocumento(req: SubirDocReq): Observable<DocDto> {
    return this.http.post<DocDto>(`${this.base}/documentos`, req);
  }

  guardarTexto(nombre: string, contenido: string, modulos: string[], origen: 'constructor' | 'texto'): Observable<DocDto> {
    return this.http.post<DocDto>(`${this.base}/documentos/texto`, { nombre, contenido, modulos, origen });
  }

  /** Cualquier archivo → Docling en segundo plano. Responde con la base en PROCESANDO. */
  subirArchivo(archivo: File, nombre: string, modulos: string[], ocr: 'auto' | 'forzar' | 'no' = 'auto'): Observable<DocDto> {
    const fd = new FormData();
    fd.append('archivo', archivo, archivo.name);
    fd.append('nombre', nombre);
    fd.append('modulos', JSON.stringify(modulos));
    fd.append('ocr', ocr);
    return this.http.post<DocDto>(`${this.base}/documentos/archivo`, fd);
  }

  editar(id: number, cambios: { nombre?: string; contenido?: string; modulos?: string[] }): Observable<DocDto> {
    return this.http.put<DocDto>(`${this.base}/documentos/${id}`, cambios);
  }

  actualizarModulos(id: number, modulos: string[]): Observable<DocDto> {
    return this.http.put<DocDto>(`${this.base}/documentos/${id}/modulos`, { modulos });
  }

  reprocesar(id: number): Observable<DocDto> {
    return this.http.post<DocDto>(`${this.base}/documentos/${id}/reprocesar`, {});
  }

  reprocesarLote(simular: boolean, limite: number): Observable<LoteResp> {
    return this.http.post<LoteResp>(`${this.base}/reprocesar-lote`, { simular, limite, soloSinRed: true });
  }

  eliminarDocumento(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/documentos/${id}`);
  }

  /** Sube un archivo binario (PDF/DOCX/TXT) procesado server-side. Para la KB jurídica. */
  subirBinario(archivo: File, nombre: string, modulos: string[] = ['legal']): Observable<DocDto> {
    const fd = new FormData();
    fd.append('archivo', archivo, archivo.name);
    fd.append('nombre', nombre);
    fd.append('modulos', JSON.stringify(modulos));
    return this.http.post<DocDto>(`${this.base}/documentos/upload-binario`, fd);
  }

  // ── Constructor con IA ──────────────────────────────────────────────────────
  constructorMensaje(req: ConstructorReq): Observable<ConstructorResp> {
    return this.http.post<ConstructorResp>(`${this.base}/constructor/mensaje`, req);
  }

  constructorAdjunto(archivo: File): Observable<AdjuntoDto> {
    const fd = new FormData();
    fd.append('archivo', archivo, archivo.name);
    return this.http.post<AdjuntoDto>(`${this.base}/constructor/adjunto`, fd);
  }

  // ── Fuentes externas ────────────────────────────────────────────────────────
  fuentes(): Observable<FuenteDto[]> { return this.http.get<FuenteDto[]>(`${this.base}/fuentes`); }
  fuente(id: number): Observable<FuenteDto> { return this.http.get<FuenteDto>(`${this.base}/fuentes/${id}`); }
  crearFuente(req: FuenteReq): Observable<FuenteDto> { return this.http.post<FuenteDto>(`${this.base}/fuentes`, req); }
  editarFuente(id: number, req: FuenteReq): Observable<FuenteDto> { return this.http.put<FuenteDto>(`${this.base}/fuentes/${id}`, req); }
  eliminarFuente(id: number, conBases = true): Observable<void> {
    return this.http.delete<void>(`${this.base}/fuentes/${id}`, { params: { conBases } });
  }
  ejecutarFuente(id: number): Observable<FuenteDto> { return this.http.post<FuenteDto>(`${this.base}/fuentes/${id}/ejecutar`, {}); }
  ejecucionesFuente(id: number): Observable<EjecucionDto[]> { return this.http.get<EjecucionDto[]>(`${this.base}/fuentes/${id}/ejecuciones`); }
  probarFuente(req: FuenteReq, id?: number | null): Observable<PruebaResp> {
    return this.http.post<PruebaResp>(`${this.base}/fuentes/probar`, req, id ? { params: { id } } : {});
  }
  sugerirFuentes(modulo: string | null, necesidad: string | null): Observable<SugerenciaDto[]> {
    return this.http.post<SugerenciaDto[]>(`${this.base}/fuentes/sugerir`, { modulo, necesidad });
  }
  conectoresMcp(): Observable<McpServidorDto[]> { return this.http.get<McpServidorDto[]>(`${this.base}/fuentes/mcp`); }
}
