import { Injectable, NgZone, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { environment } from '@/environments/environment';
import { NavegacionService } from '@/app/core/services/navegacion.service';

interface Pagina { ruta: string; titulo: string | null; modulo: string | null; inicio_ms: number; duracion_seg?: number }
interface Peticion { metodo: string; ruta: string; consulta: string | null; estado: number; ms: number; ts: number }

const API = environment.apiUrl.replace(/\/+$/, '');
const DESTINO = `${API}/api/v1/seguimiento/actividad/eventos`;
/** Lo que no aporta a "qué hizo": canales en vivo (SSE), sondeos y la propia actividad. */
const IGNORAR = [/\/eventos(\?|$)/, /\/actividad\/eventos/, /\/stream(\?|$)/, /\/EstadosRobots\//];
const SENSIBLES = /^(token|access_token|password|clave|contrasena|secret|key|apikey|code|otp|firma|signature)$/i;

/**
 * "Actividad del personal": registra las pantallas que abre la persona y las llamadas a la
 * API que hace la app (método, ruta, resultado, duración) y las manda por lotes a
 * ms-seguimiento. Nunca manda cuerpos ni contraseñas; quién es lo saca el servidor del token.
 * No frena nada: si falla, se descarta.
 */
@Injectable({ providedIn: 'root' })
export class RegistroActividadService {
  private readonly router = inject(Router);
  private readonly nav = inject(NavegacionService);
  private readonly zona = inject(NgZone, { optional: true });

  private paginas: Pagina[] = [];
  private peticiones: Peticion[] = [];
  private actual: Pagina | null = null;
  private readonly sesion = (globalThis.crypto?.randomUUID?.() ?? String(Date.now())).slice(0, 36);
  private iniciado = false;

  iniciar(): void {
    if (this.iniciado || typeof window === 'undefined') return;
    this.iniciado = true;
    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)).subscribe(e => this.alNavegar(e.urlAfterRedirects));
    setInterval(() => this.vaciar(false), 20_000);
    // Pestaña oculta = la pantalla deja de contar tiempo; al volver se abre de nuevo.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { this.cerrarPagina(); this.vaciar(true); }
      else if (!this.actual) this.alNavegar(this.router.url);
    });
    window.addEventListener('pagehide', () => { this.cerrarPagina(); this.vaciar(true); });
    this.alNavegar(this.router.url);
  }

  debeRegistrar(url: string): boolean {
    return url.startsWith(API) && !IGNORAR.some(r => r.test(url));
  }

  peticion(metodo: string, url: string, estado: number, ms: number): void {
    if (!this.iniciado) this.iniciar();
    try {
      const u = new URL(url, window.location.origin);
      const q = new URLSearchParams();
      u.searchParams.forEach((v, k) => q.append(k, SENSIBLES.test(k) ? '***' : v.slice(0, 80)));
      const consulta = q.toString();
      this.peticiones.push({ metodo, ruta: u.pathname, consulta: consulta ? consulta.slice(0, 400) : null, estado, ms: Math.round(ms), ts: Date.now() });
      if (this.peticiones.length >= 60) this.vaciar(false);
    } catch { /* URL rara: no se registra */ }
  }

  private alNavegar(url: string): void {
    if (!url.startsWith('/dashboard')) return;
    this.cerrarPagina();
    const p: Pagina = { ruta: url.split('#')[0].slice(0, 480), titulo: null, modulo: null, inicio_ms: Date.now() };
    this.actual = p;
    // El título lo publica la barra superior un instante después de navegar.
    setTimeout(() => {
      if (this.actual === p) { p.titulo = this.nav.titulo(); p.modulo = this.nav.modulo(); }
    }, 1500);
  }

  private cerrarPagina(): void {
    const p = this.actual;
    if (!p) return;
    p.duracion_seg = Math.round((Date.now() - p.inicio_ms) / 1000);
    if (!p.titulo) { p.titulo = this.nav.titulo(); p.modulo = this.nav.modulo(); }
    this.paginas.push(p);
    this.actual = null;
  }

  private vaciar(saliendo: boolean): void {
    if (!this.paginas.length && !this.peticiones.length) return;
    const token = localStorage.getItem('token');
    if (!token) { this.paginas = []; this.peticiones = []; return; }
    const paginas = this.paginas.splice(0, 200);
    const peticiones = this.peticiones.splice(0, 500);
    const cuerpo = JSON.stringify({ sesion: this.sesion, dispositivo: this.dispositivo(), paginas, peticiones });
    const enviar = () => fetch(DESTINO, {
      method: 'POST', keepalive: saliendo && cuerpo.length < 60_000,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: cuerpo,
    }).catch(() => undefined);
    if (this.zona) this.zona.runOutsideAngular(enviar); else void enviar();
  }

  private dispositivo(): string {
    if (/electron/i.test(navigator.userAgent)) return 'escritorio';
    return window.matchMedia?.('(max-width: 600px)').matches ? 'movil' : 'web';
  }
}
