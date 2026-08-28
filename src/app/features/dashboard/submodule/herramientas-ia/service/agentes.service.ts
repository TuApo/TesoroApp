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
  /** acción = se le encarga algo puntual · evento = cuelga de un disparador. */
  modo?: 'accion' | 'evento';
  /** true si lo creó alguien desde el panel: solo esos se pueden editar y borrar. */
  propio?: boolean;
  autor?: string | null;
}

export interface CategoriaCatalogo { clave: string; nombre: string; total: number; }
export interface Catalogo { generado: number; categorias: CategoriaCatalogo[]; agentes: AgenteCatalogo[]; }

export interface Repo { clave: string; nombre: string; ruta: string; }

export interface Cuenta {
  id: string;
  nombre: string;
  titular: string | null;
  /** Cuenta realmente autenticada, según el propio CLI. El titular se teclea; esto no. */
  cuenta?: string | null;
  organizacion?: string | null;
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

/**
 * La petición en bruto, ya ordenada por la IA.
 * `preguntas` es lo que NO pudo deducir y hay que decidir a mano: si viene con algo,
 * conviene contestarlo antes de encargar, porque el agente lo va a tener que adivinar.
 */
export interface EncargoOrdenado {
  titulo: string;
  objetivo: string;
  contexto: string;
  metas: string[];
  preguntas: string[];
  /** El reparto viaja siempre con la petición ordenada, no en una llamada aparte. */
  enjambre: SugerenciaAgentes;
}

/** Una combinación de agentes que ya sabemos que funciona, con su esqueleto de encargo. */
export interface PlantillaEnjambre {
  id: string;
  nombre: string;
  para: string;
  agentes: string[];
  agentesDetalle: { clave: string; nombre: string; descripcion: string; existe: boolean }[];
  modo: 'paralelo' | 'secuencial';
  objetivo: string;
  metas: string[];
  permiso: string;
  minutos: number;
  propia: boolean;
  /** false si alguno de sus agentes ya no existe: se puede ver, no conviene lanzarla. */
  completa: boolean;
}

export interface SugerenciaAgentes {
  agentes: { clave: string; porque: string }[];
  enjambre: boolean;
  modo: 'paralelo' | 'secuencial';
}

/** Un fichero que acompaña a un agente o a un encargo. */
export interface Adjunto {
  nombre: string;
  bytes: number;
  subido?: number;
}

/** Ficha completa: el agente con su persona, su `.md` crudo y sus ficheros. */
export interface AgenteFicha extends AgenteCatalogo {
  persona: string;
  crudo: string | null;
  editable: boolean;
  adjuntos: Adjunto[];
}

/**
 * Cómo se dispara una misión.
 *  - recurrente: cada N minutos
 *  - diario:     a una hora, opcionalmente solo ciertos días (0=domingo)
 *  - cron:       expresión de 5 campos
 *  - unaVez:     una fecha y hora concretas
 */
export interface DisparoMision {
  tipo: 'recurrente' | 'diario' | 'cron' | 'unaVez';
  cadaMinutos?: number;
  hora?: string;
  dias?: number[];
  cron?: string;
  cuando?: number;
}

export interface Mision {
  id: string;
  nombre: string;
  objetivo: string;
  metas: string[];
  agentes: string[];
  repo: string;
  modo: 'paralelo' | 'secuencial';
  disparo: DisparoMision;
  prioridad: number;
  permiso: string;
  minutos: number;
  activo: boolean;
  ultimaEjecucion: number;
  ultimaTareaId: string | null;
  proxima: number | null;
  faltanMs: number | null;
  /** La ejecución viva de esta misión, si la hay. */
  enCurso?: Tarea | null;
  /** Las últimas que terminaron, de la más reciente a la más vieja. */
  historial?: Tarea[];
  totalEjecuciones?: number;
  okEjecuciones?: number;
  /** Media SOLO de las que acabaron bien: las cortadas falsean el promedio. */
  duracionMediaMs?: number | null;
  costeMedioUsd?: number | null;
}

/** Un informe concreto: lo que el agente escribió una vez que corrió. */
export interface ReporteMision {
  id: string;
  cuando: number;
  estado: EstadoTarea;
  duracionMs: number;
  costeUsd: number;
  turnos: number;
  agente: string;
  archivosTocados: string[];
  resumen: string | null;
  error: string | null;
}

/** Todo lo que una misión ha hecho, con lo agregado ya calculado en el puente. */
export interface ReportesMision {
  mision: { id: string; nombre: string; objetivo: string; agentes: string[]; repo: string; activo: boolean };
  resumen: {
    total: number; ok: number; fallidas: number; canceladas: number;
    duracionMediaMs: number | null; duracionMaxMs: number | null;
    costeTotalUsd: number; turnosMedios: number | null;
    ficherosTocados: number; primera: number | null; ultima: number | null;
  };
  porEstado: Record<string, number>;
  herramientas: { nombre: string; veces: number }[];
  serie: { id: string; cuando: number; estado: EstadoTarea; duracionMs: number; costeUsd: number; turnos: number; ficheros: number }[];
  reportes: ReporteMision[];
}

/** Cuánto suele tardar un reparto, según lo que esos agentes ya hicieron. */
export interface Estimacion {
  porAgente: { clave: string; mediaMs: number | null; muestras: number; costeMedioUsd: number | null }[];
  totalMs: number | null;
  modo: 'paralelo' | 'secuencial';
  /** false si algún agente no tiene historial: el total es una cota inferior. */
  completa: boolean;
  costeTotalUsd: number | null;
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
  /** Cuándo está bien hecho. Van en su propio bloque del prompt, no dentro del objetivo. */
  metas?: string[];
  /** Documentos que acompañan al encargo. Viajan con él para que estén antes de arrancar. */
  adjuntos?: { nombre: string; contenidoBase64: string }[];
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

  // ── Creador de agentes ────────────────────────────────────────────────────
  fichaAgente(clave: string): Observable<AgenteFicha> {
    return this.http.get<AgenteFicha>(`${this.base}/catalogo/${clave}`);
  }
  crearAgente(datos: Partial<AgenteFicha> & { clave: string; persona: string }): Observable<AgenteFicha> {
    return this.http.post<AgenteFicha>(`${this.base}/catalogo`, datos);
  }
  editarAgente(clave: string, cambios: Partial<AgenteFicha>): Observable<AgenteFicha> {
    return this.http.put<AgenteFicha>(`${this.base}/catalogo/${clave}`, cambios);
  }
  borrarAgente(clave: string): Observable<unknown> {
    return this.http.delete(`${this.base}/catalogo/${clave}`);
  }
  duplicarAgente(clave: string, datos: { clave?: string; nombre?: string }): Observable<AgenteFicha> {
    return this.http.post<AgenteFicha>(`${this.base}/catalogo/${clave}/duplicar`, datos);
  }
  subirAdjuntoAgente(clave: string, nombre: string, contenidoBase64: string): Observable<Adjunto> {
    return this.http.post<Adjunto>(`${this.base}/catalogo/${clave}/adjuntos`, { nombre, contenidoBase64 });
  }
  borrarAdjuntoAgente(clave: string, nombre: string): Observable<unknown> {
    return this.http.delete(`${this.base}/catalogo/${clave}/adjuntos/${encodeURIComponent(nombre)}`);
  }

  // ── Encargo guiado ────────────────────────────────────────────────────────
  capacidadesEncargo(): Observable<{ asistente: boolean; transcripcion: boolean }> {
    return this.http.get<{ asistente: boolean; transcripcion: boolean }>(`${this.base}/encargo/capacidades`);
  }
  /** Reordena lo tecleado y/o lo dictado en un encargo ejecutable. */
  mejorarEncargo(datos: { objetivo: string; contexto?: string; transcripcion?: string }): Observable<EncargoOrdenado> {
    return this.http.post<EncargoOrdenado>(`${this.base}/encargo/mejorar`, datos);
  }
  /** Propone qué agentes del catálogo encajan con el encargo. */
  sugerirAgentes(objetivo: string): Observable<SugerenciaAgentes> {
    return this.http.post<SugerenciaAgentes>(`${this.base}/encargo/sugerir`, { objetivo });
  }
  transcribir(audio: Blob, nombre: string): Observable<{ texto: string }> {
    const fd = new FormData();
    fd.append('file', audio, nombre);
    return this.http.post<{ texto: string }>(`${this.base}/encargo/transcribir`, fd);
  }

  /** Empuja a la base de conocimiento los informes de esta guardia que falten. */
  publicarEnConocimiento(id: string): Observable<{ publicados: number }> {
    return this.http.post<{ publicados: number }>(`${this.base}/misiones/${id}/publicar`, {});
  }
  estadoConocimiento(): Observable<{ publicados: number; modulos: string[] }> {
    return this.http.get<{ publicados: number; modulos: string[] }>(`${this.base}/conocimiento/estado`);
  }

  reportesDeMision(id: string, limite = 50): Observable<ReportesMision> {
    return this.http.get<ReportesMision>(`${this.base}/misiones/${id}/reportes`, { params: { limite } });
  }

  estimar(agentes: string[], modo: 'paralelo' | 'secuencial'): Observable<Estimacion> {
    return this.http.post<Estimacion>(`${this.base}/estimacion`, { agentes, modo });
  }

  plantillas(): Observable<PlantillaEnjambre[]> {
    return this.http.get<PlantillaEnjambre[]>(`${this.base}/plantillas`);
  }

  // ── Misiones ──────────────────────────────────────────────────────────────
  misiones(): Observable<Mision[]> {
    return this.http.get<Mision[]>(`${this.base}/misiones`);
  }
  crearMision(m: Partial<Mision>): Observable<Mision> {
    return this.http.post<Mision>(`${this.base}/misiones`, m);
  }
  editarMision(id: string, cambios: Partial<Mision>): Observable<Mision> {
    return this.http.put<Mision>(`${this.base}/misiones/${id}`, cambios);
  }
  borrarMision(id: string): Observable<unknown> {
    return this.http.delete(`${this.base}/misiones/${id}`);
  }
  lanzarMision(id: string): Observable<Tarea> {
    return this.http.post<Tarea>(`${this.base}/misiones/${id}/lanzar`, {});
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
  /** Paso 1: devuelve la URL de autorización para abrirla en el navegador. */
  iniciarLogin(id: string): Observable<{ url: string; caducaEn: number }> {
    return this.http.post<{ url: string; caducaEn: number }>(`${this.base}/cuentas/${id}/login`, {});
  }
  /** Paso 2: el código que devuelve esa página. De un solo uso. */
  completarLogin(id: string, codigo: string): Observable<unknown> {
    return this.http.post(`${this.base}/cuentas/${id}/login/codigo`, { codigo });
  }
  cancelarLogin(id: string): Observable<unknown> {
    return this.http.delete(`${this.base}/cuentas/${id}/login`);
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
