import { modoDemoActivo } from './modo-demo';
import { responderDemo } from './demo-datos';

/**
 * Sandbox de red del modo demostración (ver modo-demo.ts).
 *
 * Se parchea `fetch` y no un interceptor de HttpClient porque la app también llama al API con
 * `fetch` directo (SSE de turnos y comunicaciones, descargas…) y HttpClient va con `withFetch()`:
 * así una sola puerta cubre todo. WebSocket, XMLHttpRequest y sendBeacon se cierran también.
 * Cada parche revisa la marca en cada llamada: sin ella, todo pasa al original sin tocar.
 */
let instalado = false;

export function instalarSandboxDemo(apiUrl: string): void {
  if (instalado || typeof window === 'undefined') return;
  instalado = true;

  const apiHost = new URL(apiUrl).host;
  // El API y cualquier otro subdominio de tuapo.co que no sea el origen de la propia app
  // (en el APK la app se sirve como https://tesoro.tuapo.co desde el teléfono).
  const esDelApi = (url: URL) =>
    url.host === apiHost || (url.hostname.endsWith('tuapo.co') && url.host !== window.location.host);
  const resolver = (u: string | URL): URL | null => {
    try { return new URL(String(u), window.location.href); } catch { return null; }
  };
  const interceptar = (u: string | URL): URL | null => {
    if (!modoDemoActivo()) return null;
    const url = resolver(u);
    return url && esDelApi(url) ? url : null;
  };

  const fetchReal = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const crudo = typeof input === 'string' || input instanceof URL ? input : input.url;
    const url = interceptar(crudo);
    if (!url) return fetchReal(input, init);

    const req = new Request(input, init);
    if (req.signal.aborted) throw new DOMException('Aborted', 'AbortError');

    // SSE: un flujo abierto que nunca manda eventos. Si se cerrara, el cliente reconectaría en bucle.
    if ((req.headers.get('Accept') ?? '').includes('text/event-stream')) {
      const flujo = new ReadableStream<Uint8Array>({
        start(c) { req.signal.addEventListener('abort', () => c.error(new DOMException('Aborted', 'AbortError'))); },
      });
      return new Response(flujo, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }

    const cuerpo = req.method === 'GET' || req.method === 'HEAD' ? '' : await req.text().catch(() => '');
    const { status, body } = responderDemo(req.method, url.pathname, url.searchParams, cuerpo);
    // Una pausa corta, como la red: sin ella algunos indicadores de carga parpadean.
    await new Promise((r) => setTimeout(r, 150));
    if (req.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return new Response(status === 204 ? null : JSON.stringify(body ?? null), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const openReal = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...resto: any[]) {
    const destino = interceptar(url) ? 'data:application/json,%5B%5D' : url;
    return (openReal as any).call(this, method, destino, ...resto);
  } as typeof XMLHttpRequest.prototype.open;

  if (typeof navigator.sendBeacon === 'function') {
    const beaconReal = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url: string | URL, datos?: BodyInit | null) =>
      interceptar(url) ? true : beaconReal(url, datos);
  }

  // En demostración no se abre ningún socket (LiveKit, transcripción en vivo…): todos son de
  // servidores reales. El falso se cierra solo, como un servidor que no contesta.
  const WsReal = window.WebSocket;
  const WsSandbox = function (this: unknown, url: string | URL, protocolos?: string | string[]) {
    if (!modoDemoActivo()) return new WsReal(url, protocolos);
    return socketCerrado(String(url));
  } as unknown as typeof WebSocket;
  WsSandbox.prototype = WsReal.prototype;
  Object.assign(WsSandbox, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  window.WebSocket = WsSandbox;

  mostrarAviso();
}

function socketCerrado(url: string): WebSocket {
  const ws = new EventTarget() as any;
  Object.assign(ws, {
    url, protocol: '', extensions: '', binaryType: 'blob', bufferedAmount: 0, readyState: 3,
    CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3,
    onopen: null, onmessage: null, onerror: null, onclose: null,
    send() { /* sin conexión */ },
    close() { /* ya cerrado */ },
  });
  setTimeout(() => {
    const error = new Event('error');
    ws.onerror?.(error);
    ws.dispatchEvent(error);
    const cierre = new CloseEvent('close', { code: 1006, reason: 'Modo demostración', wasClean: false });
    ws.onclose?.(cierre);
    ws.dispatchEvent(cierre);
  }, 0);
  return ws as WebSocket;
}

/** Etiqueta fija para que nadie confunda los datos de ejemplo con los reales. */
function mostrarAviso(): void {
  const ID = 'aviso-modo-demo';
  const pintar = () => {
    let el = document.getElementById(ID);
    if (!modoDemoActivo()) { el?.remove(); return; }
    if (!document.body) return;
    if (!el) {
      el = document.createElement('div');
      el.id = ID;
      el.setAttribute('role', 'status');
      el.textContent = 'Modo demostración · datos ficticios / Demo mode · sample data';
      el.style.cssText = [
        'position:fixed', 'left:8px', 'z-index:2147483647', 'background:#111827', 'color:#fff',
        'font:600 11px/1.4 system-ui,sans-serif', 'padding:4px 10px', 'border-radius:999px', 'opacity:.85',
        'pointer-events:none',
      ].join(';');
      document.body.appendChild(el);
    }
    // Por debajo de 900 px la app pinta la barra de navegación abajo: la etiqueta va encima de ella.
    el.style.bottom = `calc(${window.innerWidth < 900 ? 80 : 8}px + env(safe-area-inset-bottom))`;
  };
  pintar();
  setInterval(pintar, 1500);
}
