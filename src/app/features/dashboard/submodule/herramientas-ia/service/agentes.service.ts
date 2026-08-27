import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';

// ── Contratos del puente de agentes (espejo de /var/www/agentes/bridge) ──────

export type EstadoTarea =
  | 'pendiente' | 'asignada' | 'en_curso'
  | 'ok' | 'error' | 'limite' | 'cancelada' | 'interrumpida';

export type EstadoCuenta =
  | 'lista' | 'trabajando' | 'enfriando' | 'pausada' | 'sin_sesion' | 'sesion_caducada';

export interface AgenteCatalogo {
  clave: string;
  nombre: string;
  categoria: string;
  categoriaNombre: string;
  tipo: string;
  color: string | null;
  prioridad: string;
  descripcion: string;
  capacidades: string[];
  personaResumen: string;
  personaLineas: number;
  fichero: string;
}

export interface CategoriaCatalogo { clave: string; nombre: string; total: number; }
export interface Catalogo { generado: number; categorias: CategoriaCatalogo[]; agentes: AgenteCatalogo[]; }

export interface Repo { clave: string; nombre: string; ruta: string; }

export interface Cuenta {
  id: string;
  nombre: string;
  titular: string | null;
  notas: string | null;
  tipo: 'sesion' | 'apikey';
  suscripcion: string | null;
  configDir: string;
  pausada: boolean;
  maxSimultaneas: number;
  autenticada: boolean;
  sesionExpiraEn: number | null;
  estado: EstadoCuenta;
  enCurso: number;
  enfriamientoHasta: number | null;
  motivoEnfriamiento: string | null;
  totalTareas: number;
  totalOk: number;
  totalError: number;
  totalLimites: number;
  ultimoUso: number | null;
  ultimoError: string | null;
}

export interface HerramientaUso { nombre: string; veces: number; }

export interface Tarea {
  id: string;
  creada: number;
  actualizada: number;
  inicio?: number;
  fin?: number;
  duracionMs: number;
  estado: EstadoTarea;
  titulo: string | null;
  objetivo: string;
  contexto?: string | null;
  agente: string | null;
  agenteNombre?: string;
  repo: string;
  modelo: string | null;
  modeloReal?: string;
  permiso: string;
  minutos: number;
  prioridad: number;
  origen: 'panel' | 'vigilante' | 'enjambre';
  enjambreId: string | null;
  vigilanteId?: string;
  esperaA?: string | null;
  cuentaId: string | null;
  cuentaNombre?: string;
  sesionId?: string;
  intentos: number;
  turnos: number;
  costeUsd: number;
  tokens: { entrada: number; salida: number };
  herramientas: HerramientaUso[];
  ultimaHerramienta?: string;
  archivosTocados: string[];
  resumen?: string | null;
  error?: string | null;
  avisoUltimoIntento?: string;
  solicitante?: string | null;
}

export interface EventoBitacora {
  ts: number;
  tipo: 'arranque' | 'sesion' | 'texto' | 'herramienta' | 'resultado' | 'fin' | 'fallo';
  texto?: string;
  nombre?: string;
  detalle?: string;
  error?: boolean;
  desenlace?: string;
  motivo?: string;
  cuenta?: string;
  modelo?: string;
  sesionId?: string;
  agente?: string;
  cwd?: string;
  permiso?: string;
  herramientas?: number;
}

export interface Vigilante {
  id: string;
  nombre: string;
  agente: string;
  repo: string;
  cadaMinutos: number;
  activo: boolean;
  objetivo: string;
  ultimaEjecucion: number;
  proxima: number | null;
  faltanMs: number | null;
}

export interface Enjambre {
  id: string;
  creado: number;
  objetivo: string;
  total: number;
  vivas: number;
  ok: number;
  fallidas: number;
  tareas: Tarea[];
}

export interface EstadoAgentes {
  servicio: { arranque: number; enPieMs: number; version: string; workspace: string; maxSimultaneas: number };
  pool: { cuentas: number; listas: number; trabajando: number; enfriando: number; sinSesion: number; pausadas: number };
  trabajo: { enCurso: number; enCola: number; hoyTotal: number; hoyOk: number; hoyError: number; agentesDistintosHoy: number };
  cuentas: Cuenta[];
  enCurso: Tarea[];
  cola: Tarea[];
  ultimas: Tarea[];
  vigilantes: Vigilante[];
  catalogo: { total: number };
}

export interface NuevaTarea {
  objetivo: string;
  contexto?: string | null;
  agente?: string | null;
  repo?: string;
  modelo?: string | null;
  permiso?: string;
  minutos?: number;
  prioridad?: number;
  titulo?: string | null;
}

export interface NuevoEnjambre extends NuevaTarea {
  agentes: string[];
  modo: 'paralelo' | 'secuencial';
}

@Injectable({ providedIn: 'root' })
export class AgentesService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/ia/agentes`;

  estado(): Observable<EstadoAgentes> {
    return this.http.get<EstadoAgentes>(`${this.base}/estado`);
  }

  catalogo(): Observable<Catalogo> {
    return this.http.get<Catalogo>(`${this.base}/catalogo`);
  }

  repos(): Observable<Repo[]> {
    return this.http.get<Repo[]>(`${this.base}/repos`);
  }

  // ── Cuentas ───────────────────────────────────────────────────────────────
  cuentas(): Observable<Cuenta[]> {
    return this.http.get<Cuenta[]>(`${this.base}/cuentas`);
  }
  editarCuenta(id: string, cambios: Partial<Pick<Cuenta, 'nombre' | 'titular' | 'notas' | 'pausada' | 'maxSimultaneas'>>): Observable<unknown> {
    return this.http.put(`${this.base}/cuentas/${id}`, cambios);
  }
  despertarCuenta(id: string): Observable<unknown> {
    return this.http.post(`${this.base}/cuentas/${id}/despertar`, {});
  }
  crearCuenta(datos: { id: string; nombre: string; titular: string }): Observable<Cuenta> {
    return this.http.post<Cuenta>(`${this.base}/cuentas`, datos);
  }
  borrarCuenta(id: string): Observable<unknown> {
    return this.http.delete(`${this.base}/cuentas/${id}`);
  }
  /**
   * Deja la ranura autenticada con una credencial YA emitida (API key de Anthropic o
   * el token largo de `claude setup-token`). El OAuth de `claude auth login` abre una
   * página en un navegador y no tiene modo headless: eso sigue siendo del servidor.
   *
   * El valor no vuelve nunca: la respuesta solo dice de qué tipo es.
   */
  guardarCredencial(id: string, tipo: 'apikey' | 'token', valor: string): Observable<unknown> {
    return this.http.post(`${this.base}/cuentas/${id}/credencial`, { tipo, valor });
  }
  olvidarCredencial(id: string): Observable<unknown> {
    return this.http.delete(`${this.base}/cuentas/${id}/credencial`);
  }

  // ── Tareas ────────────────────────────────────────────────────────────────
  tareas(opts: { estado?: string; origen?: string; limite?: number } = {}): Observable<Tarea[]> {
    const params: Record<string, string> = {};
    if (opts.estado) params['estado'] = opts.estado;
    if (opts.origen) params['origen'] = opts.origen;
    if (opts.limite) params['limite'] = String(opts.limite);
    return this.http.get<Tarea[]>(`${this.base}/tareas`, { params });
  }
  crearTarea(body: NuevaTarea): Observable<Tarea> {
    return this.http.post<Tarea>(`${this.base}/tareas`, body);
  }
  tarea(id: string): Observable<Tarea> {
    return this.http.get<Tarea>(`${this.base}/tareas/${id}`);
  }
  bitacora(id: string, desde = 0): Observable<EventoBitacora[]> {
    return this.http.get<EventoBitacora[]>(`${this.base}/tareas/${id}/bitacora`, {
      params: { desde: String(desde) },
    });
  }
  cancelar(id: string): Observable<unknown> {
    return this.http.post(`${this.base}/tareas/${id}/cancelar`, {});
  }

  // ── Enjambres ─────────────────────────────────────────────────────────────
  enjambres(): Observable<Enjambre[]> {
    return this.http.get<Enjambre[]>(`${this.base}/enjambres`);
  }
  crearEnjambre(body: NuevoEnjambre): Observable<{ enjambreId: string; modo: string; tareas: Tarea[] }> {
    return this.http.post<{ enjambreId: string; modo: string; tareas: Tarea[] }>(`${this.base}/enjambres`, body);
  }

  // ── Vigilantes ────────────────────────────────────────────────────────────
  vigilantes(): Observable<Vigilante[]> {
    return this.http.get<Vigilante[]>(`${this.base}/vigilantes`);
  }
  editarVigilante(id: string, cambios: Partial<Pick<Vigilante, 'activo' | 'cadaMinutos' | 'objetivo' | 'agente' | 'repo' | 'nombre'>>): Observable<Vigilante> {
    return this.http.put<Vigilante>(`${this.base}/vigilantes/${id}`, cambios);
  }
  dispararVigilante(id: string): Observable<Tarea> {
    return this.http.post<Tarea>(`${this.base}/vigilantes/${id}/disparar`, {});
  }
}
