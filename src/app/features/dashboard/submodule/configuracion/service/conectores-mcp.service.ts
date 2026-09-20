import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';

/**
 * Conectores MCP: la plataforma como CLIENTE de servidores de herramientas.
 *
 * <p>Lo que hace especial a MCP, y la razon de que esta pantalla no lleve ni un parametro
 * cableado: el servidor DESCRIBE sus herramientas con un JSON Schema por cada campo. La
 * pantalla lo lee y dibuja el formulario. Aparece una herramienta nueva en el servidor, se
 * sincroniza el catalogo, y sale sola.
 */

export type EstadoConector = 'SIN_AUTORIZAR' | 'AUTORIZADO' | 'ERROR' | 'REVOCADO';
export type AlcanceConector = 'PLATAFORMA' | 'USUARIO';

export interface Conector {
  id: string;
  nombre: string;
  descripcion: string | null;
  url: string;
  auth_tipo: 'OAUTH2' | 'BEARER' | 'NINGUNA';
  estado: EstadoConector;
  protocolo_version: string | null;
  sincronizado_en: string | null;
  ultimo_error: string | null;
}

/** Una entrada de la libreria de servidores ya hechos. */
export interface EntradaDirectorio {
  clave: string;
  nombre: string;
  descripcion: string | null;
  url: string;
  categoria: string;
  icono: string | null;
  docs_url: string | null;
  alcance_sugerido: AlcanceConector;
  verificado: boolean;
}

/** El esquema es JSON Schema tal cual lo declara la herramienta. */
export interface HerramientaMcp {
  nombre: string;
  titulo: string | null;
  descripcion: string | null;
  input_schema: string | null;
  habilitada: boolean;
  ausente: boolean;
}

export interface Sondeo { auth_tipo: string; alcanzable: boolean; detalle: string; }
export interface ResumenSync { nuevas: number; actualizadas: number; ausentes: number; total: number; }
export interface Invocacion {
  id: string; herramienta: string; estado: 'ENVIADA' | 'LISTA' | 'ERROR';
  resultado: string | null; error_detalle: string | null;
  duracion_ms: number | null; creado_en: string;
}

@Injectable({ providedIn: 'root' })
export class ConectoresMcpService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/v1/ai/mcp`;

  listar(): Observable<Conector[]> {
    return this.http.get<Conector[]>(`${this.base}/servidores`);
  }

  directorio(): Observable<EntradaDirectorio[]> {
    return this.http.get<EntradaDirectorio[]>(`${this.base}/directorio`);
  }

  /** Toca la puerta del servidor para saber que exige, antes de darlo de alta. */
  sondear(url: string): Observable<Sondeo> {
    return this.http.post<Sondeo>(`${this.base}/sondear`, { url });
  }

  crear(nombre: string, url: string, descripcion?: string): Observable<Conector> {
    return this.http.post<Conector>(`${this.base}/servidores`, { nombre, url, descripcion });
  }

  desactivar(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/servidores/${id}`);
  }

  /** Devuelve la URL a la que hay que mandar el navegador para autorizar. */
  autorizar(id: string): Observable<{ url_autorizacion: string; estado: string }> {
    return this.http.post<{ url_autorizacion: string; estado: string }>(
      `${this.base}/servidores/${id}/autorizar`, {});
  }

  sincronizar(id: string): Observable<ResumenSync> {
    return this.http.post<ResumenSync>(`${this.base}/servidores/${id}/sincronizar`, {});
  }

  herramientas(id: string, todas = false): Observable<HerramientaMcp[]> {
    return this.http.get<HerramientaMcp[]>(
      `${this.base}/servidores/${id}/herramientas?todas=${todas}`);
  }

  invocar(id: string, herramienta: string, argumentos: Record<string, unknown>): Observable<Invocacion> {
    return this.http.post<Invocacion>(
      `${this.base}/servidores/${id}/invocar`, { herramienta, argumentos });
  }

  historial(id: string): Observable<Invocacion[]> {
    return this.http.get<Invocacion[]>(`${this.base}/servidores/${id}/invocaciones`);
  }
}

// ── Lectura de JSON Schema para pintar formularios ───────────────────────────

export interface CampoSchema {
  clave: string;
  etiqueta: string;
  tipo: 'texto' | 'texto-largo' | 'numero' | 'booleano' | 'opcion';
  descripcion: string | null;
  obligatorio: boolean;
  opciones: string[];
  minimo: number | null;
  maximo: number | null;
  valorPorDefecto: unknown;
}

/**
 * Convierte el JSON Schema de una herramienta en la lista de campos a pintar.
 *
 * <p>Se traduce solo lo que un formulario sabe representar de verdad: texto, numero,
 * booleano y lista de opciones. Un objeto anidado o un array complejo se dejan como texto
 * largo, para que la persona pueda escribir el JSON a mano en vez de quedarse sin poder
 * mandar el parametro — que es lo que pasaria si se ocultara.
 */
export function camposDe(inputSchema: string | null): CampoSchema[] {
  if (!inputSchema) return [];
  let esquema: any;
  try { esquema = typeof inputSchema === 'string' ? JSON.parse(inputSchema) : inputSchema; }
  catch { return []; }

  const propiedades = esquema?.properties ?? {};
  const obligatorios: string[] = Array.isArray(esquema?.required) ? esquema.required : [];

  return Object.keys(propiedades).map((clave) => {
    const p = propiedades[clave] ?? {};
    const enumeracion: string[] = Array.isArray(p.enum) ? p.enum.map(String) : [];
    let tipo: CampoSchema['tipo'] = 'texto';
    if (enumeracion.length) tipo = 'opcion';
    else if (p.type === 'number' || p.type === 'integer') tipo = 'numero';
    else if (p.type === 'boolean') tipo = 'booleano';
    else if (p.type === 'object' || p.type === 'array') tipo = 'texto-largo';
    // Un prompt es un campo de varias lineas aunque el esquema solo diga "string".
    else if (/prompt|description|texto|body/i.test(clave)) tipo = 'texto-largo';

    return {
      clave,
      etiqueta: p.title ?? clave.replace(/_/g, ' '),
      tipo,
      descripcion: p.description ?? null,
      obligatorio: obligatorios.includes(clave),
      opciones: enumeracion,
      minimo: typeof p.minimum === 'number' ? p.minimum : null,
      maximo: typeof p.maximum === 'number' ? p.maximum : null,
      valorPorDefecto: p.default ?? null,
    };
  });
}
