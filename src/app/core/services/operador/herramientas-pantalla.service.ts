import { DestroyRef, Injectable, signal } from '@angular/core';

/**
 * Herramientas de pantalla para el asistente operador, con la forma de WebMCP.
 *
 * WebMCP es un borrador del W3C Web Machine Learning Community Group (20-oct-2026): la página
 * declara herramientas (nombre, descripción, JSON Schema de entrada y `execute`) y un agente
 * —el de la propia página o el del navegador— las ejecuta ahí mismo, con la sesión de la
 * persona. Chrome lo expone solo en origin trial (149 a 156) y pasó de `navigator.modelContext`
 * a `document.modelContext`. Electron y el APK no lo tienen.
 *
 * Por eso el registro es propio y siempre funciona: el asistente operador manda los
 * descriptores a ms-ai en cada mensaje y ejecuta aquí lo que el modelo pide. Donde el navegador
 * tenga WebMCP, las mismas herramientas se registran también allá (mejora progresiva), así su
 * agente puede usarlas. Nunca se depende de eso.
 */

/** Anotaciones de WebMCP. Lo que no se declara de solo lectura se trata como acción con consecuencias. */
export interface AnotacionesHerramienta {
  readOnlyHint?: boolean;
  consequentialHint?: boolean;
}

export interface HerramientaPantalla {
  /** ^[a-z][a-z0-9_]{1,47}$ (lo exige ms-ai). */
  name: string;
  title?: string;
  description: string;
  /** JSON Schema del objeto de entrada (type: 'object'). */
  inputSchema?: Record<string, unknown>;
  annotations?: AnotacionesHerramienta;
  execute: (input: Record<string, unknown>) => Promise<unknown> | unknown;
}

/** Lo que viaja a ms-ai: la herramienta sin su función. */
export type DescriptorHerramienta = Omit<HerramientaPantalla, 'execute'>;

const NOMBRE_VALIDO = /^[a-z][a-z0-9_]{1,47}$/;
const MAX_HERRAMIENTAS = 25;

interface ModelContextNavegador {
  registerTool?: (tool: unknown, opts?: { signal?: AbortSignal }) => unknown;
  unregisterTool?: (name: string) => unknown;
}

@Injectable({ providedIn: 'root' })
export class HerramientasPantallaService {

  private readonly registro = new Map<string, { h: HerramientaPantalla; nativa?: AbortController }>();
  private readonly lista = signal<DescriptorHerramienta[]>([]);

  /** Descriptores de las herramientas de la pantalla abierta (máx. 25, como acepta ms-ai). */
  readonly herramientas = this.lista.asReadonly();

  registrarHerramienta(tool: HerramientaPantalla, opts?: { signal?: AbortSignal }): void {
    if (!NOMBRE_VALIDO.test(tool.name) || !tool.description?.trim()) {
      console.warn('[herramientas-pantalla] nombre o descripción inválidos:', tool.name);
      return;
    }
    if (opts?.signal?.aborted) return;
    this.quitar(tool.name);
    const nativa = this.registrarNativa(tool);
    this.registro.set(tool.name, { h: tool, nativa });
    opts?.signal?.addEventListener('abort', () => {
      // Solo se quita si sigue siendo la misma (otra pantalla pudo registrar el mismo nombre después).
      if (this.registro.get(tool.name)?.h === tool) this.quitar(tool.name);
    }, { once: true });
    this.publicar();
  }

  /** Registra varias herramientas y las quita al destruirse el componente que las ofrece. */
  registrarEnPantalla(destroyRef: DestroyRef, tools: HerramientaPantalla[]): void {
    const ctl = new AbortController();
    for (const t of tools) this.registrarHerramienta(t, { signal: ctl.signal });
    destroyRef.onDestroy(() => ctl.abort());
  }

  // ── Contexto de pantalla ──

  private readonly contextos = new Map<string, () => unknown>();

  /**
   * Una pantalla aporta lo que muestra (su tabla, sus filtros, el registro abierto) para que el
   * asistente sepa qué está viendo la persona. Gana sobre la lectura genérica del DOM.
   */
  registrarContexto(clave: string, proveedor: () => unknown, opts?: { signal?: AbortSignal }): void {
    if (opts?.signal?.aborted) return;
    this.contextos.set(clave, proveedor);
    opts?.signal?.addEventListener('abort', () => {
      if (this.contextos.get(clave) === proveedor) this.contextos.delete(clave);
    }, { once: true });
  }

  /** Registra el contexto y lo quita al destruirse el componente. */
  contextoEnPantalla(destroyRef: DestroyRef, clave: string, proveedor: () => unknown): void {
    const ctl = new AbortController();
    this.registrarContexto(clave, proveedor, { signal: ctl.signal });
    destroyRef.onDestroy(() => ctl.abort());
  }

  /** Lo que aportan las pantallas abiertas ({clave: valor}); un proveedor que falla se omite. */
  leerContextos(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, f] of this.contextos) {
      try {
        const v = f();
        if (v !== undefined && v !== null) out[k] = v;
      } catch { /* proveedor roto: se omite */ }
    }
    return out;
  }

  existe(nombre: string): boolean { return this.registro.has(nombre); }

  descriptor(nombre: string): DescriptorHerramienta | null {
    const r = this.registro.get(nombre);
    return r ? this.sinFuncion(r.h) : null;
  }

  /** ¿Pide confirmación? Todo lo que no se declara de solo lectura. */
  pideConfirmacion(nombre: string): boolean {
    const a = this.registro.get(nombre)?.h.annotations;
    return !a?.readOnlyHint || !!a?.consequentialHint;
  }

  async ejecutar(nombre: string, input: Record<string, unknown>): Promise<unknown> {
    const r = this.registro.get(nombre);
    if (!r) throw new Error(`La pantalla ya no ofrece «${nombre}».`);
    return await r.h.execute(input ?? {});
  }

  // ── internos ──

  private quitar(nombre: string): void {
    const r = this.registro.get(nombre);
    if (!r) return;
    r.nativa?.abort();
    this.registro.delete(nombre);
    this.publicar();
  }

  private publicar(): void {
    this.lista.set([...this.registro.values()].slice(0, MAX_HERRAMIENTAS).map(r => this.sinFuncion(r.h)));
  }

  private sinFuncion(h: HerramientaPantalla): DescriptorHerramienta {
    const { execute: _e, ...d } = h;
    return d;
  }

  /** WebMCP del navegador, si existe (document.modelContext nuevo o navigator.modelContext viejo). */
  private registrarNativa(tool: HerramientaPantalla): AbortController | undefined {
    try {
      const doc = typeof document !== 'undefined' ? (document as unknown as { modelContext?: ModelContextNavegador }).modelContext : undefined;
      const nav = typeof navigator !== 'undefined' ? (navigator as unknown as { modelContext?: ModelContextNavegador }).modelContext : undefined;
      const mc = doc?.registerTool ? doc : nav?.registerTool ? nav : undefined;
      if (!mc?.registerTool) return undefined;
      const ctl = new AbortController();
      const r = mc.registerTool({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
        annotations: tool.annotations,
        // En el origin trial los argumentos pueden llegar como texto JSON.
        execute: async (input: unknown) => {
          const obj = typeof input === 'string' ? JSON.parse(input || '{}') : (input ?? {});
          const res = await tool.execute(obj as Record<string, unknown>);
          return typeof res === 'string' ? res : JSON.stringify(res ?? { ok: true });
        },
      }, { signal: ctl.signal });
      // Versiones sin signal: se quita por nombre al abortar.
      ctl.signal.addEventListener('abort', () => { try { mc.unregisterTool?.(tool.name); } catch { /* sin soporte */ } }, { once: true });
      if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(() => undefined);
      return ctl;
    } catch {
      return undefined;
    }
  }
}
