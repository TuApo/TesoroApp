import { ChangeDetectionStrategy, Component, DestroyRef, afterNextRender, inject, signal } from '@angular/core';
import { tokenVigente } from '@/app/core/utils/sesion-vigente';
import { CelebracionDelDia } from './celebracion.models';
import { CelebracionService } from './celebracion.service';
import { CelebracionEscenaComponent } from './celebracion-escena.component';
import { hoyBogota, prepararCelebracion } from './preparar';

const PREFIJO = 'tuapo.celebracion.';
/** Sin nadie que celebrar hoy, se vuelve a preguntar pasado este rato (Marketing pudo agregar a alguien). */
const REPREGUNTAR_MS = 20 * 60_000;

/**
 * Cuelga del shell del dashboard y decide si hoy hay que mostrar la celebración.
 *
 * Sale UNA vez al día por persona: la primera vez que entra (o abre la app) ese día. Lo
 * decide el servidor (`ya_vista`), que es el que sabe si ya la vio en el celular; el
 * navegador solo guarda una marca para no preguntar en cada recarga. Se marca como vista
 * AL MOSTRARLA, no al cerrarla: si se recarga a mitad, no vuelve a salir.
 *
 * Si la pestaña está en segundo plano espera a que vuelva: que no se gaste la celebración
 * en una pestaña que nadie está mirando. Y si la app queda abierta de un día para otro, al
 * volver a ella revisa el día nuevo.
 */
@Component({
  selector: 'app-celebracion-lanzador',
  standalone: true,
  imports: [CelebracionEscenaComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (datos(); as d) {
      <app-celebracion-escena [datos]="d" (cerrada)="alCerrar(d, $event.antes)" />
    }
  `,
})
export class CelebracionLanzadorComponent {
  private readonly api = inject(CelebracionService);
  readonly datos = signal<CelebracionDelDia | null>(null);
  private ocupado = false;
  private ultimoDia = '';

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      // Un respiro: primero se pinta el home y su carrusel; luego la celebración.
      const t = setTimeout(() => this.revisar(), 1200);
      const alVolver = () => {
        if (document.visibilityState === 'visible' && this.ultimoDia && this.ultimoDia !== hoyBogota()) this.revisar();
      };
      document.addEventListener('visibilitychange', alVolver);
      const sub = this.api.revisarAhora$.subscribe(() => this.revisar(true));
      destroyRef.onDestroy(() => {
        clearTimeout(t);
        document.removeEventListener('visibilitychange', alVolver);
        sub.unsubscribe();
      });
    });
  }

  /** `forzar`: el botón de prueba de Marketing; se salta solo la marca local, no la del servidor. */
  revisar(forzar = false): void {
    if (this.ocupado || this.datos() || !tokenVigente()) return;
    const uid = usuarioActual();
    if (!uid) return;
    const hoy = hoyBogota();
    this.ultimoDia = hoy;
    const clave = `${PREFIJO}${uid}.${hoy}`;
    if (!forzar) {
      const marca = leer(clave);
      if (marca === 'vista') return;
      if (marca?.startsWith('nada:') && Date.now() - Number(marca.slice(5)) < REPREGUNTAR_MS) return;
    }
    this.ocupado = true;
    this.api.hoy().subscribe({
      next: (d) => { void this.decidir(d, clave); },
      error: () => { this.ocupado = false; },
    });
  }

  private async decidir(d: CelebracionDelDia | null, clave: string): Promise<void> {
    try {
      // Sin respuesta (sin red, ms-marketing caído): no se marca nada, se intentará luego.
      if (!d) return;
      if (!d.personas?.length) { escribir(clave, `nada:${Date.now()}`); return; }
      if (d.ya_vista) { escribir(clave, 'vista'); return; }
      await prepararCelebracion(d, (u) => this.api.urlFoto(u));
      await visible();
      if (this.datos()) return;
      escribir(clave, 'vista');
      this.api.apuntar(d.fecha, 'MOSTRADA', d.superficie ?? 'TESORO');
      this.datos.set(d);
    } finally {
      this.ocupado = false;
    }
  }

  alCerrar(d: CelebracionDelDia, antes: boolean): void {
    if (antes) this.api.apuntar(d.fecha, 'CERRADA_ANTES', d.superficie ?? 'TESORO');
    this.datos.set(null);
  }
}

/** El id de quien tiene la sesión: el `sub` del JWT (un UUID) o, si no, el id del usuario guardado. */
function usuarioActual(): string | null {
  try {
    let raw = localStorage.getItem('token') || localStorage.getItem('Authorization');
    let user: { id?: unknown; token?: string; jwt?: string; access_token?: string; accessToken?: string } | null = null;
    const u = localStorage.getItem('user');
    if (u) user = JSON.parse(u);
    if (!raw && user) raw = user.token || user.jwt || user.access_token || user.accessToken || null;
    if (raw) {
      const partes = raw.replace(/^Bearer\s+/i, '').split('.');
      if (partes.length === 3) {
        const carga = JSON.parse(atob(partes[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (carga?.sub) return String(carga.sub);
      }
    }
    return user?.id != null ? String(user.id) : null;
  } catch {
    return null;
  }
}

function leer(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}

/** Guarda la marca de hoy y borra las de días anteriores (no se acumulan). */
function escribir(k: string, v: string): void {
  try {
    const hoy = k.slice(k.lastIndexOf('.') + 1);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const x = localStorage.key(i);
      if (x && x.startsWith(PREFIJO) && !x.endsWith(`.${hoy}`)) localStorage.removeItem(x);
    }
    localStorage.setItem(k, v);
  } catch { /* modo privado o almacenamiento bloqueado: decide el servidor */ }
}

function visible(): Promise<void> {
  if (typeof document === 'undefined' || document.visibilityState === 'visible') return Promise.resolve();
  return new Promise((r) => {
    const f = () => {
      if (document.visibilityState === 'visible') { document.removeEventListener('visibilitychange', f); r(); }
    };
    document.addEventListener('visibilitychange', f);
  });
}
