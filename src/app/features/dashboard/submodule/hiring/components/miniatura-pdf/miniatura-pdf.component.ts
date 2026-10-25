import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { ArchivosBackendService } from '../../service/archivos/archivos-backend.service';

/**
 * MINIATURA DE UN PDF (primera página) para las tarjetas de antecedentes.
 *
 * `fuente` es lo mismo que guarda la tarjeta: la ruta protegida del backend
 * (`/api/v1/documents/{id}/download…`) o el `File` recién adjuntado. Se pinta
 * con pdf.js, el mismo camino que la miniatura de la cédula en hiring-questions.
 *
 * Diez tarjetas = diez descargas + diez renders: se cachean por ruta (cambiar de
 * pestaña o el polling del robot no vuelven a bajar nada) y se pintan de a dos
 * para no trabar la pantalla ni el gateway.
 */
@Component({
  selector: 'app-miniatura-pdf',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <button type="button" class="mini" [class.vacia]="!fuente()" [disabled]="!fuente()"
      [attr.aria-label]="fuente() ? 'Ver ' + (titulo() || 'documento') : 'Sin documento'"
      (click)="abrir.emit()">
      @if (png(); as src) {
        <img [src]="src" alt="" />
        <span class="mini-ver"><mat-icon>open_in_new</mat-icon> Ver</span>
      } @else if (cargando() || pintando()) {
        <span class="mini-msg"><mat-icon class="giro">progress_activity</mat-icon> Cargando…</span>
      } @else if (fuente()) {
        <span class="mini-msg"><mat-icon>picture_as_pdf</mat-icon> Ver documento</span>
      } @else {
        <span class="mini-msg"><mat-icon>description</mat-icon> Sin documento</span>
      }
    </button>
  `,
  styles: [`
    :host { display: block; }
    .mini {
      position: relative; display: flex; align-items: center; justify-content: center;
      width: 100%; height: 132px; padding: 0; overflow: hidden; cursor: pointer;
      border: 1px solid var(--border); border-radius: 10px;
      background: var(--surface-2, #f8fafc); color: var(--muted);
      transition: border-color .15s ease, box-shadow .15s ease;
    }
    .mini:hover:not(:disabled) { border-color: var(--border-strong); box-shadow: 0 2px 8px rgba(16, 24, 40, .08); }
    .mini:disabled { cursor: default; }
    .mini.vacia { border-style: dashed; }
    .mini img {
      width: 100%; height: 100%; object-fit: cover; object-position: top center;
      background: #fff; display: block;
    }
    .mini-msg { display: inline-flex; align-items: center; gap: 6px; font-size: .74rem; font-weight: 600; }
    .mini-msg mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .mini-ver {
      position: absolute; right: 6px; bottom: 6px; display: inline-flex; align-items: center; gap: 3px;
      padding: 2px 8px; border-radius: 999px; font-size: .68rem; font-weight: 700;
      background: rgba(15, 23, 42, .72); color: #fff; opacity: 0; transition: opacity .15s ease;
    }
    .mini-ver mat-icon { font-size: 13px; width: 13px; height: 13px; }
    .mini:hover .mini-ver, .mini:focus-visible .mini-ver { opacity: 1; }
    .giro { animation: giro 1s linear infinite; }
    @keyframes giro { to { transform: rotate(360deg); } }
  `],
})
export class MiniaturaPdfComponent {
  readonly fuente = input<File | string | null | undefined>(null);
  /** La tarjeta todavía está trayendo la lista de documentos. */
  readonly cargando = input(false);
  readonly titulo = input<string | undefined>(undefined);
  readonly abrir = output<void>();
  /**
   * Texto de las primeras páginas ('' sin documento o si no es un PDF con texto).
   * La tarjeta EPS lo usa para buscar la observación de régimen de excepción de ADRES.
   */
  readonly texto = output<string>();

  private readonly archivos = inject(ArchivosBackendService);
  readonly png = signal<string | null>(null);
  readonly pintando = signal(false);

  constructor() {
    effect(() => {
      const f = this.fuente();
      this.png.set(null);
      this.pintando.set(false);
      // Fuera del ciclo de detección: quien escucha cambia su propio estado.
      const avisar = (t: string) => queueMicrotask(() => { if (this.fuente() === f) this.texto.emit(t); });
      if (!f || typeof document === 'undefined') { avisar(''); return; }
      const enCache = cache.get(f);
      if (enCache !== undefined) { this.png.set(enCache.png); avisar(enCache.texto); return; }
      this.pintando.set(true);
      void enCola(() => this.leer(f)).then((r) => {
        if (r !== undefined) {
          // Tope: un día de selección pasa por cientos de candidatos.
          if (cache.size >= 150) cache.delete(cache.keys().next().value!);
          cache.set(f, r);
        }
        if (this.fuente() !== f) return; // otra persona u otro documento mientras llegaba
        this.png.set(r?.png ?? null);
        this.pintando.set(false);
        avisar(r?.texto ?? '');
      });
    });
  }

  private async leer(f: File | string): Promise<Leido | undefined> {
    let blob: Blob;
    if (typeof f === 'string' && /^(blob:|data:)/i.test(f)) {
      blob = await (await fetch(f)).blob();
    } else if (typeof f === 'string') {
      const r = await this.archivos.resolverBlob(f);
      if (!r) return undefined; // fallo de red: sin cachear, se reintenta en el próximo cambio
      URL.revokeObjectURL(r.url); // solo se necesita el blob
      blob = r.blob;
    } else {
      blob = f;
    }
    try {
      const cabecera = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
      if (String.fromCharCode(...cabecera) !== '%PDF') {
        // Una imagen subida como soporte también se puede mostrar.
        return { png: blob.type.startsWith('image/') ? await comoDataUrl(blob) : null, texto: '' };
      }
      return await primeraPagina(blob);
    } catch {
      return { png: null, texto: '' }; // PDF que pdf.js no abre: queda el recuadro "Ver documento"
    }
  }
}

interface Leido {
  /** Imagen de la primera página (null = no se pudo pintar). */
  png: string | null;
  /** Texto de las primeras páginas. */
  texto: string;
}

/** Ruta del backend o File → lo ya leído. */
const cache = new Map<File | string, Leido>();

const SIMULTANEAS = 2;
let activas = 0;
const espera: (() => void)[] = [];

async function enCola<T>(tarea: () => Promise<T>): Promise<T> {
  if (activas >= SIMULTANEAS) await new Promise<void>((ok) => espera.push(ok));
  activas++;
  try {
    return await tarea();
  } finally {
    activas--;
    espera.shift()?.();
  }
}

function comoDataUrl(blob: Blob): Promise<string> {
  return new Promise((ok, mal) => {
    const lector = new FileReader();
    lector.onload = () => ok(String(lector.result));
    lector.onerror = () => mal(lector.error);
    lector.readAsDataURL(blob);
  });
}

async function primeraPagina(blob: Blob): Promise<Leido> {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerPort) {
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(
      // Ruta relativa: el bundler de workers no resuelve especificadores de paquete.
      new URL('../../../../../../../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url),
      { type: 'module' },
    );
  }
  const tarea = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
  try {
    const pdf = await tarea.promise;
    const pagina = await pdf.getPage(1);
    const ancho = pagina.getViewport({ scale: 1 }).width;
    const viewport = pagina.getViewport({ scale: 420 / ancho });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await pagina.render({ canvas, viewport }).promise;
    const png = canvas.toDataURL('image/jpeg', 0.82);

    const partes: string[] = [];
    for (let n = 1; n <= Math.min(pdf.numPages, 3); n++) {
      const contenido = await (n === 1 ? pagina : await pdf.getPage(n)).getTextContent();
      partes.push(contenido.items.map((it) => ('str' in it ? it.str : '')).join(' '));
    }
    return { png, texto: partes.join('\n') };
  } finally {
    void tarea.destroy();
  }
}
