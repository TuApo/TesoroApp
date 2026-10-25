/**
 * Ejecuta el código del aula.
 *
 * <p><b>JavaScript, HTML y Python corren en el navegador de cada quien</b>, dentro de un iframe
 * `sandbox="allow-scripts"` SIN `allow-same-origin`: origen opaco, sin acceso al token, al
 * almacenamiento ni a las cookies de la plataforma. Es código que escribió otra persona del aula
 * y se ejecuta en tu sesión: aislarlo no es opcional.
 *
 * <p>Python usa Pyodide (Python compilado a WebAssembly), servido desde /pyodide/ de la propia
 * plataforma, en un Worker dentro del iframe para poder cortarlo si se queda en un bucle.
 * Java, C, C++ y compañía van al servidor (Piston) por la API del aula.
 */

export interface Salida { ok: boolean; salida: string; errores: string; ms: number; html?: string; }

export const LENGUAJES = [
  { id: 'python', nombre: 'Python', donde: 'navegador' },
  { id: 'javascript', nombre: 'JavaScript', donde: 'navegador' },
  { id: 'html', nombre: 'HTML + CSS + JS', donde: 'navegador' },
  { id: 'java', nombre: 'Java', donde: 'servidor' },
  { id: 'c', nombre: 'C', donde: 'servidor' },
  { id: 'cpp', nombre: 'C++', donde: 'servidor' },
  { id: 'csharp', nombre: 'C#', donde: 'servidor' },
  { id: 'go', nombre: 'Go', donde: 'servidor' },
] as const;

export function enNavegador(lenguaje: string): boolean {
  return ['python', 'javascript', 'html'].includes(lenguaje);
}

const TIEMPO_MAX_MS = 10_000;

/** El programa del iframe: recibe {lenguaje, codigo, entrada, base} y devuelve la salida. */
function programaDelIframe(): string {
  return `
<script>
(function () {
  function responder(r) { parent.postMessage(Object.assign({ tipo: 'resultado' }, r), '*'); }
  function trabajadorPython(base) {
    return \`
      let py = null;
      self.onmessage = async (e) => {
        const { codigo, entrada } = e.data;
        const out = [], err = [];
        const t0 = performance.now();
        try {
          if (!py) {
            const m = await import('\${base}pyodide.mjs');
            py = await m.loadPyodide({ indexURL: '\${base}', stdout: s => out.push(s), stderr: s => err.push(s) });
          } else {
            py.setStdout({ batched: s => out.push(s) });
            py.setStderr({ batched: s => err.push(s) });
          }
          const lineas = (entrada || '').split('\\\\n');
          py.setStdin({ stdin: () => lineas.length ? lineas.shift() : null });
          await py.loadPackagesFromImports(codigo).catch(() => {});
          await py.runPythonAsync(codigo);
          self.postMessage({ ok: true, salida: out.join('\\\\n'), errores: err.join('\\\\n'), ms: performance.now() - t0 });
        } catch (x) {
          self.postMessage({ ok: false, salida: out.join('\\\\n'), errores: (err.join('\\\\n') + '\\\\n' + String(x && x.message || x)).trim(), ms: performance.now() - t0 });
        }
      };\`;
  }
  let py = null;
  window.addEventListener('message', async function (e) {
    const d = e.data || {};
    if (d.tipo !== 'ejecutar') return;
    const t0 = performance.now();
    if (d.lenguaje === 'javascript') {
      const out = [], err = [];
      const fmt = a => a.map(x => typeof x === 'string' ? x : (function () { try { return JSON.stringify(x); } catch (_) { return String(x); } })()).join(' ');
      const consola = { log: (...a) => out.push(fmt(a)), info: (...a) => out.push(fmt(a)), warn: (...a) => err.push(fmt(a)), error: (...a) => err.push(fmt(a)) };
      try {
        const f = new Function('console', 'entrada', '"use strict";\\n' + d.codigo);
        const r = f(consola, d.entrada || '');
        if (r && typeof r.then === 'function') await r;
        responder({ ok: true, salida: out.join('\\n'), errores: err.join('\\n'), ms: performance.now() - t0 });
      } catch (x) {
        responder({ ok: false, salida: out.join('\\n'), errores: (err.join('\\n') + '\\n' + String(x && x.stack || x)).trim(), ms: performance.now() - t0 });
      }
      return;
    }
    if (d.lenguaje === 'python') {
      // data: y no blob: un Worker de módulo hecho desde blob: en un origen opaco (este iframe)
      // no arranca en Chrome; desde data: sí, y queda también con origen opaco.
      if (!py) py = new Worker('data:text/javascript,' + encodeURIComponent(trabajadorPython(d.base)), { type: 'module' });
      py.onmessage = ev => responder(ev.data);
      py.onerror = ev => responder({ ok: false, salida: '', errores: 'No se pudo cargar Python: ' + (ev.message || 'error'), ms: performance.now() - t0 });
      py.postMessage({ codigo: d.codigo, entrada: d.entrada });
    }
  });
  parent.postMessage({ tipo: 'listo' }, '*');
})();
<\/script>`;
}

/**
 * Un ejecutor por panel de código: mantiene su iframe (y su Python ya cargado) entre
 * ejecuciones, y lo tira y lo rehace si una ejecución se pasa de tiempo.
 */
export class EjecutorNavegador {
  private iframe: HTMLIFrameElement | null = null;
  private listo: Promise<void> | null = null;

  constructor(private contenedor: HTMLElement, private basePyodide: string) {}

  private preparar(): Promise<void> {
    if (this.listo) return this.listo;
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts');
    f.style.display = 'none';
    f.title = 'Ejecutor de código aislado';
    f.srcdoc = programaDelIframe();
    this.listo = new Promise<void>(resolve => {
      const oir = (e: MessageEvent) => {
        if (e.source === f.contentWindow && e.data?.tipo === 'listo') { window.removeEventListener('message', oir); resolve(); }
      };
      window.addEventListener('message', oir);
    });
    this.contenedor.appendChild(f);
    this.iframe = f;
    return this.listo;
  }

  async ejecutar(lenguaje: string, codigo: string, entrada = ''): Promise<Salida> {
    if (lenguaje === 'html') return { ok: true, salida: '', errores: '', ms: 0, html: codigo };
    await this.preparar();
    const f = this.iframe!;
    return new Promise<Salida>(resolve => {
      const t = setTimeout(() => {
        window.removeEventListener('message', oir);
        this.reiniciar();
        resolve({ ok: false, salida: '', errores: `Se detuvo: tardó más de ${TIEMPO_MAX_MS / 1000} s (¿un bucle infinito?)`, ms: TIEMPO_MAX_MS });
      }, lenguaje === 'python' ? TIEMPO_MAX_MS * 3 : TIEMPO_MAX_MS);
      const oir = (e: MessageEvent) => {
        if (e.source !== f.contentWindow || e.data?.tipo !== 'resultado') return;
        clearTimeout(t);
        window.removeEventListener('message', oir);
        resolve({ ok: !!e.data.ok, salida: String(e.data.salida ?? ''), errores: String(e.data.errores ?? ''), ms: Math.round(e.data.ms ?? 0) });
      };
      window.addEventListener('message', oir);
      f.contentWindow?.postMessage({ tipo: 'ejecutar', lenguaje, codigo, entrada, base: this.basePyodide }, '*');
    });
  }

  reiniciar(): void {
    this.iframe?.remove();
    this.iframe = null;
    this.listo = null;
  }

  destruir(): void {
    this.reiniciar();
  }
}
