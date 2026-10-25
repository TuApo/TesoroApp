import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '@/environments/environment';
import { PermissionsService } from '../permissions.service';
import {
  Automatizacion, CatalogoPersonalidades, DestinoNavegacion, NuevaPersonalidad, PersonalidadOperador, EjecucionAutomatizacion, EstadoTarea, EstadoVozOperador, NuevaAutomatizacion, NuevaTarea, PaginaTareas,
  PerfilOperador, PersonaPlataforma, PlantillaAutomatizacion, ResultadoHerramienta, TareaDesarrollo, TareaOperador, VistaOperador,
} from './operador.modelos';

/** Nodo de menú que da acceso a EconomiAPP (el mismo que revisa su guard). */
const RUTA_PERMISO_TIENDA = '/dashboard/tienda/marketplace';
const MAX_DESTINOS = 400;

/** Pantallas de EconomiAPP: viven fuera de /dashboard y por eso no están en el árbol del menú. */
const DESTINOS_ECONOMIAPP: DestinoNavegacion[] = [
  { nombre: 'Inicio', ruta: '/economiapp', jerarquia: 'EconomiAPP' },
  { nombre: 'Explorar', ruta: '/economiapp/explorar', jerarquia: 'EconomiAPP' },
  { nombre: 'Premios', ruta: '/economiapp/premios', jerarquia: 'EconomiAPP' },
  { nombre: 'Juegos', ruta: '/economiapp/juegos', jerarquia: 'EconomiAPP' },
  { nombre: 'Asesor MatIA', ruta: '/economiapp/asesor', jerarquia: 'EconomiAPP' },
  { nombre: 'Carrito', ruta: '/economiapp/carrito', jerarquia: 'EconomiAPP' },
  { nombre: 'Mis pedidos', ruta: '/economiapp/pedidos', jerarquia: 'EconomiAPP' },
  { nombre: 'Soporte', ruta: '/economiapp/soporte', jerarquia: 'EconomiAPP' },
  { nombre: 'Mi cuenta', ruta: '/economiapp/cuenta', jerarquia: 'EconomiAPP' },
];

/**
 * Cliente del Asistente operador (ms-ai `/api/v1/ai/operador`) y el estado que comparten el
 * botón flotante y quien lo quiera abrir (p. ej. el botón de la barra de EconomiAPP).
 */
@Injectable({ providedIn: 'root' })
export class OperadorService {
  private http = inject(HttpClient);
  private permisos = inject(PermissionsService);
  private base = `${environment.apiUrl}/api/v1/ai/operador`;

  /** Perfil del operador para la persona en sesión (null mientras carga o si no está disponible). */
  readonly perfil = signal<PerfilOperador | null>(null);
  /** Ventana abierta (false = minimizada en la pestaña del dock o en el orbe). */
  readonly abierto = signal(false);
  /** Cómo se muestra la ventana cuando está abierta. */
  readonly vista = signal<VistaOperador>('flotante');
  /**
   * El dock de chat del dashboard pinta la pestaña «IA» junto a la de Chat: mientras esté, el
   * asistente no pinta su propio orbe (EconomiAPP no tiene dock y sí lo pinta).
   */
  readonly anclaEnDock = signal(false);
  /** Qué hace la voz (escuchando, pensando, hablando): lo animan la pestaña y el orbe. */
  readonly estadoVoz = signal<EstadoVozOperador>('inactivo');
  /** Otra pantalla pide abrir una conversación del asistente (p. ej. el módulo de automatizaciones). */
  readonly conversacionPedida = signal<number | null>(null);
  /** Catálogo de personalidades (se carga al abrir el selector o la página de personalidades). */
  readonly personalidades = signal<CatalogoPersonalidades | null>(null);
  /** Resultados de automatizaciones que llegaron sin el panel abierto. */
  readonly noLeidos = signal(0);
  /**
   * Cuándo corrió por última vez cada gancho en esta pestaña (clave `id|ruta`): el botón se
   * monta en el dashboard y en EconomiAPP, y al pasar de uno a otro no debe repetirlos.
   */
  readonly ganchosCorridos = new Map<string, number>();

  abrir(vista?: VistaOperador): void {
    if (vista) this.vista.set(vista);
    this.abierto.set(true);
  }
  /** Minimiza: la conversación sigue; se vuelve a abrir desde la pestaña o el orbe. */
  cerrar(): void { this.abierto.set(false); }
  minimizar(): void { this.abierto.set(false); }
  alternar(): void { this.abierto.update(v => !v); }

  /** Abre el asistente en esa conversación (la ventana la carga al recibirla). */
  abrirConversacion(id: number): void {
    this.conversacionPedida.set(id);
    if (this.vista() === 'compacto') this.vista.set('flotante');
    this.abierto.set(true);
  }

  /**
   * Pantallas a las que esta persona puede ir: las del menú que puede leer (mismas reglas que el
   * navbar) y, si tiene la tienda, las de EconomiAPP. El servidor solo deja navegar a estas.
   */
  destinos(): DestinoNavegacion[] {
    const out: DestinoNavegacion[] = this.permisos.listReadableModules().map(m => ({
      nombre: m.nombre,
      ruta: m.ruta,
      jerarquia: (m.padres ?? []).join(' › '),
    }));
    if (this.permisos.canReadRoute(RUTA_PERMISO_TIENDA)) {
      const vistas = new Set(out.map(d => d.ruta));
      for (const d of DESTINOS_ECONOMIAPP) if (!vistas.has(d.ruta)) out.push(d);
    }
    return out.slice(0, MAX_DESTINOS);
  }

  // ── Perfil ──

  // ── Personalidades ──

  catalogoPersonalidades(): Observable<CatalogoPersonalidades> {
    return this.http.get<CatalogoPersonalidades>(`${this.base}/personalidades`);
  }

  crearPersonalidad(p: NuevaPersonalidad): Observable<PersonalidadOperador> {
    return this.http.post<PersonalidadOperador>(`${this.base}/personalidades`, p);
  }

  cambiarPersonalidad(id: number, p: Partial<NuevaPersonalidad>): Observable<PersonalidadOperador> {
    return this.http.patch<PersonalidadOperador>(`${this.base}/personalidades/${id}`, p);
  }

  borrarPersonalidad(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.base}/personalidades/${id}`);
  }

  activarPersonalidad(clave: string): Observable<{ activa: string }> {
    return this.http.put<{ activa: string }>(`${this.base}/personalidades/activa`, { clave });
  }

  cargarPerfil(): Observable<PerfilOperador> {
    return this.http.get<PerfilOperador>(`${this.base}/perfil`);
  }

  modoDesarrollador(activo: boolean): Observable<PerfilOperador> {
    return this.http.put<PerfilOperador>(`${this.base}/modo-desarrollador`, { activo });
  }

  // ── Tareas ──

  tareas(f: { estado?: string | null; tipo?: string | null; pagina?: number; tamano?: number } = {}): Observable<PaginaTareas> {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(f)) if (v !== null && v !== undefined && v !== '') p = p.set(k, String(v));
    return this.http.get<PaginaTareas>(`${this.base}/tareas`, { params: p });
  }

  /** Devuelve a ms-ai el resultado de una herramienta de pantalla que pidió la IA (el turno la espera). */
  responderHerramienta(id: string, r: ResultadoHerramienta): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${this.base}/herramientas/${encodeURIComponent(id)}`, r);
  }

  crearTarea(t: NuevaTarea): Observable<TareaOperador> {
    return this.http.post<TareaOperador>(`${this.base}/tareas`, t);
  }

  cambiarTarea(id: number, estado: EstadoTarea): Observable<TareaOperador> {
    return this.http.patch<TareaOperador>(`${this.base}/tareas/${id}`, { estado });
  }

  /** Personas de la plataforma por nombre, correo o cédula (mín. 2 letras). */
  personas(q: string): Observable<PersonaPlataforma[]> {
    return this.http.get<PersonaPlataforma[]>(`${this.base}/personas`, { params: new HttpParams().set('q', q) });
  }

  // ── Automatizaciones ──

  plantillas(): Observable<PlantillaAutomatizacion[]> {
    return this.http.get<PlantillaAutomatizacion[]>(`${this.base}/automatizaciones/plantillas`);
  }

  automatizaciones(): Observable<Automatizacion[]> {
    return this.http.get<Automatizacion[]>(`${this.base}/automatizaciones`);
  }

  crearAutomatizacion(a: NuevaAutomatizacion): Observable<Automatizacion> {
    return this.http.post<Automatizacion>(`${this.base}/automatizaciones`, a);
  }

  cambiarAutomatizacion(id: number, cambios: Partial<NuevaAutomatizacion> & { activa?: boolean }): Observable<Automatizacion> {
    return this.http.patch<Automatizacion>(`${this.base}/automatizaciones/${id}`, cambios);
  }

  borrarAutomatizacion(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.base}/automatizaciones/${id}`);
  }

  /**
   * Corre una automatización. Los ganchos mandan solo la ruta (el servidor las limita: una vez al
   * día las de "al entrar", cada 4 h las de pantalla); `manual` = el botón "Ejecutar ahora", que siempre corre.
   */
  ejecutarAutomatizacion(id: number, ruta?: string | null, manual = false): Observable<EjecucionAutomatizacion> {
    const cuerpo: { ruta?: string; manual?: boolean } = {};
    if (ruta) cuerpo.ruta = ruta;
    if (manual) cuerpo.manual = true;
    return this.http.post<EjecucionAutomatizacion>(`${this.base}/automatizaciones/${id}/ejecutar`, cuerpo);
  }

  // ── Modo desarrollador (solo administración, con el modo encendido) ──

  tareasDesarrollo(): Observable<{ tareas: TareaDesarrollo[] }> {
    return this.http.get<{ tareas: TareaDesarrollo[] }>(`${this.base}/desarrollo/tareas`);
  }

  crearTareaDesarrollo(objetivo: string, contexto?: string | null): Observable<TareaDesarrollo> {
    return this.http.post<TareaDesarrollo>(`${this.base}/desarrollo/tareas`, { objetivo, contexto: contexto || null });
  }

  cancelarTareaDesarrollo(id: string): Observable<unknown> {
    return this.http.post(`${this.base}/desarrollo/tareas/${encodeURIComponent(id)}/cancelar`, {});
  }
}
