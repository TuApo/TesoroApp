import { InjectionToken, Signal, inject } from '@angular/core';
import { environment } from '../../../../../../../environments/environment';
import { tokenParaUsar } from '@/app/core/security/renovacion-token';
import { ContextoTiendaService } from '../../service/contexto-tienda.service';

/**
 * Puntos de sustitución para montar el kanban, las zonas y el fiado en OTRA app (la app del
 * comercio, `frontend/EconomiaNegocio`). Los componentes no importan nada del shell del
 * dashboard: solo estos tres tokens, los tokens de tema (`src/theme`) y `<app-tabla-estandar>`.
 *
 * En TesoroApp los valores por defecto salen de `environment`, del token de sesión y del
 * `ContextoTiendaService` del módulo Tienda. Otra app provee los tres en su `app.config`:
 *
 *   { provide: ECO_API_BASE, useValue: 'https://api.laeconomia.app/api/v1/store' },
 *   { provide: ECO_TOKEN, useValue: () => Promise.resolve(miSesion.token) },
 *   { provide: ECO_CONTEXTO_TIENDA, useExisting: MiContextoDeSede },
 */

/** Base del API de ms-store, sin barra final. */
export const ECO_API_BASE = new InjectionToken<string>('ECO_API_BASE', {
  providedIn: 'root',
  factory: () => `${environment.apiUrl}/api/v1/store`,
});

/** Devuelve el JWT vigente (sin `Bearer`), o null si no hay sesión. Se consulta en cada (re)conexión SSE. */
export const ECO_TOKEN = new InjectionToken<() => Promise<string | null>>('ECO_TOKEN', {
  providedIn: 'root',
  factory: () => () => tokenParaUsar(),
});

export interface TiendaPortable { id: string; nombre: string; rol_en_la_tienda?: string | null; latitud?: number | null; longitud?: number | null; }

/** Lo mínimo que una pantalla necesita saber de "la sede sobre la que trabajo". */
export interface ContextoTiendaPortable {
  readonly tiendaId: Signal<string | null>;
  readonly tiendas: Signal<TiendaPortable[]>;
  /** Rol de quien mira EN la sede elegida (ADMIN_NEGOCIO, ADMIN_TIENDA, TENDERO…), si se conoce. */
  readonly rolEnTienda: Signal<string | null>;
  seleccionar(id: string | null): void;
  cargar(): void;
}

export const ECO_CONTEXTO_TIENDA = new InjectionToken<ContextoTiendaPortable>('ECO_CONTEXTO_TIENDA', {
  providedIn: 'root',
  factory: () => {
    const ctx = inject(ContextoTiendaService);
    return {
      tiendaId: ctx.tiendaId,
      tiendas: ctx.tiendas,
      rolEnTienda: ctx.rolEnTienda,
      seleccionar: id => ctx.seleccionar(id),
      cargar: () => ctx.cargar(),
    };
  },
});

// ── SSE sobre fetch (el JWT va en Authorization; EventSource no admite cabeceras) ──

export interface ConexionSse { cerrar(): void; }
export type EstadoSse = 'conectando' | 'conectado' | 'reconectando' | 'cerrado';

export function conectarSse(url: string, token: () => Promise<string | null>,
                            onEvento: (nombre: string, datos: unknown) => void,
                            onEstado?: (e: EstadoSse) => void): ConexionSse {
  let cerrado = false;
  let controlador: AbortController | null = null;
  let intento = 0;
  let temporizador: ReturnType<typeof setTimeout> | null = null;

  const reconectar = () => {
    if (cerrado) return;
    intento++;
    onEstado?.('reconectando');
    temporizador = setTimeout(abrir, Math.min(30_000, 1_000 * 2 ** Math.min(intento, 5)));
  };

  const bloque = (texto: string) => {
    let nombre = 'message';
    const datos: string[] = [];
    for (const linea of texto.split(/\r?\n/)) {
      if (!linea || linea.startsWith(':')) continue;
      const i = linea.indexOf(':');
      const campo = i < 0 ? linea : linea.slice(0, i);
      const valor = i < 0 ? '' : linea.slice(i + 1).replace(/^ /, '');
      if (campo === 'event') nombre = valor; else if (campo === 'data') datos.push(valor);
    }
    if (!datos.length) return;
    const crudo = datos.join('\n');
    let parseado: unknown = crudo;
    try { parseado = JSON.parse(crudo); } catch { /* texto plano */ }
    onEvento(nombre, parseado);
  };

  const abrir = async () => {
    if (cerrado) return;
    controlador = new AbortController();
    onEstado?.(intento === 0 ? 'conectando' : 'reconectando');
    try {
      const jwt = await token();
      const cabeceras: Record<string, string> = { Accept: 'text/event-stream' };
      if (jwt) cabeceras['Authorization'] = jwt.startsWith('Bearer ') ? jwt : `Bearer ${jwt}`;
      const r = await fetch(url, { headers: cabeceras, signal: controlador.signal, cache: 'no-store' });
      if (!r.ok || !r.body) throw new Error(`SSE ${r.status}`);
      intento = 0;
      onEstado?.('conectado');
      const lector = r.body.getReader();
      const dec = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await lector.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        let corte: number;
        while ((corte = buffer.search(/\r?\n\r?\n/)) >= 0) {
          const b = buffer.slice(0, corte);
          buffer = buffer.slice(corte).replace(/^\r?\n\r?\n/, '');
          bloque(b);
        }
      }
      if (!cerrado) { intento = 0; reconectar(); }
    } catch {
      if (!cerrado) reconectar();
    }
  };
  abrir();
  return {
    cerrar() {
      cerrado = true;
      if (temporizador) clearTimeout(temporizador);
      try { controlador?.abort(); } catch { /* ya cerrado */ }
      onEstado?.('cerrado');
    },
  };
}

/** "$12.300". */
export function pesos(v: number | string | null | undefined): string {
  if (v == null || v === '') return '';
  return '$' + Math.round(+v).toLocaleString('es-CO');
}

/** Mensaje de error del backend (409/400 traen `error`), o uno genérico. */
export function mensajeError(e: unknown, porDefecto: string): string {
  const err = (e as { error?: { error?: string } })?.error;
  return err?.error ?? porDefecto;
}
