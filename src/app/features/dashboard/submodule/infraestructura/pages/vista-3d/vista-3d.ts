import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, PLATFORM_ID, afterNextRender, computed, effect,
  inject, signal, untracked, viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';

import { GraficaSerie } from '../../components/grafica-serie/grafica-serie';
import { Contenedor, Evento, NOMBRE_GRUPO } from '../../models/infra.models';
import { InfraVivoService } from '../../services/infra-vivo.service';
import { bps, bytes, duracion, estadoContenedor, hace, ms, num, pct } from '../../utils/formato';
import type { Calidad, EscenaInfra, InfoHover, Seleccion } from './escena-infra';

/**
 * La infraestructura en 3D y en vivo. El componente solo hace de puente: le pasa a la
 * escena cada foto del canal SSE y cada evento (para la onda sobre el contenedor), y
 * pinta encima la leyenda, el buscador, el tooltip y la ficha de lo elegido.
 */
@Component({
  selector: 'app-infra-vista-3d',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatTooltipModule, RouterLink, GraficaSerie],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './vista-3d.html',
  styleUrls: ['../../styles/infra-comun.css', './vista-3d.css'],
})
export class InfraVista3d {
  private readonly vivo = inject(InfraVivoService);
  private readonly zona = inject(NgZone);
  private readonly esNavegador = isPlatformBrowser(inject(PLATFORM_ID));

  readonly f = { bps, bytes, duracion, hace, ms, num, pct };
  readonly nombreGrupo = NOMBRE_GRUPO;

  readonly cajaRef = viewChild<ElementRef<HTMLDivElement>>('caja');
  readonly lienzoRef = viewChild<ElementRef<HTMLCanvasElement>>('lienzo');
  readonly hudRef = viewChild<ElementRef<HTMLDivElement>>('hud');

  readonly fallo = signal<string | null>(null);
  readonly montada = signal(false);
  readonly pantallaCompleta = signal(false);

  // Controles
  readonly flujos = signal(true);
  readonly etiquetas = signal(false);
  readonly rotacion = signal(false);
  readonly observabilidad = signal(true);
  readonly pruebas = signal(false);
  readonly calidad = signal<Calidad>('alta');
  readonly leyendaAbierta = signal(true);
  readonly busqueda = signal('');

  readonly hover = signal<{ info: InfoHover; x: number; y: number } | null>(null);
  readonly elegido = signal<Seleccion | null>(null);
  readonly avisos = signal<Evento[]>([]);

  readonly s = computed(() => this.vivo.snapshot());
  readonly opcionesBusqueda = computed(() => (this.s()?.contenedores ?? []).map((c) => c.nombre).sort());

  readonly ficha = computed(() => {
    const sel = this.elegido();
    const s = this.s();
    if (!sel || !s) return null;
    if (sel.tipo === 'contenedor') {
      const c = s.contenedores.find((x) => x.nombre === sel.nombre);
      return c ? { tipo: 'contenedor' as const, c } : null;
    }
    if (sel.tipo === 'pod') {
      const p = s.pods.find((x) => `${x.ns}/${x.nombre}` === sel.clave);
      return p ? { tipo: 'pod' as const, p } : null;
    }
    const h = s.hosts.find((x) => x.id === sel.id);
    const n = s.nodos.find((x) => x.nombre === sel.id);
    return h || n ? { tipo: 'host' as const, h, n } : null;
  });

  private escena: EscenaInfra | null = null;
  private eventosVistos = new Set<string>();

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (!this.esNavegador) return;
      this.zona.runOutsideAngular(() => void this.montar());
    });
    destroyRef.onDestroy(() => {
      this.escena?.destruir();
      this.escena = null;
      document.removeEventListener('fullscreenchange', this.alCambiarPantalla);
    });

    // Cada foto nueva → la escena (o cuando cambian los filtros de zonas).
    effect(() => {
      const s = this.s();
      const filtros = { observabilidad: this.observabilidad(), pruebas: this.pruebas() };
      if (!s || !this.montada()) return;
      untracked(() => this.escena?.aplicar(s, filtros));
    });
    effect(() => {
      const c = { flujos: this.flujos(), etiquetas: this.etiquetas(), rotacion: this.rotacion(), calidad: this.calidad() };
      if (!this.montada()) return;
      untracked(() => this.escena?.configurar(c));
    });
    // Eventos en vivo: onda sobre el contenedor y aviso flotante unos segundos.
    effect(() => {
      const evs = this.vivo.eventosVivos();
      if (!this.montada()) return;
      untracked(() => {
        for (const e of evs.slice(0, 10).reverse()) {
          if (this.eventosVistos.has(e.id)) continue;
          this.eventosVistos.add(e.id);
          if (e.objeto) this.escena?.destello(e.objeto, e.severidad);
          this.avisos.update((l) => [e, ...l].slice(0, 4));
          setTimeout(() => this.avisos.update((l) => l.filter((x) => x.id !== e.id)), 9000);
        }
      });
    });
    // El tema de la app (claro/oscuro) cambia la paleta de la maqueta.
    const obsTema = new MutationObserver(() => this.escena?.configurar({ oscuro: this.esOscuro() }));
    obsTema.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    destroyRef.onDestroy(() => obsTema.disconnect());
    // Los eventos que ya estaban al entrar no deben disparar ondas.
    for (const e of this.vivo.eventosVivos()) this.eventosVistos.add(e.id);
  }

  private esOscuro(): boolean {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }

  private async montar(): Promise<void> {
    const canvas = this.lienzoRef()?.nativeElement;
    const hud = this.hudRef()?.nativeElement;
    const caja = this.cajaRef()?.nativeElement;
    if (!canvas || !hud || !caja) return;
    try {
      const { EscenaInfra } = await import('./escena-infra');
      // Equipos con poca GPU o pantallas pequeñas arrancan en calidad baja.
      const baja = window.matchMedia('(max-width: 900px)').matches || (navigator.hardwareConcurrency ?? 8) <= 4;
      if (baja) this.calidad.set('baja');
      this.escena = new EscenaInfra({
        canvas, hud, contenedor: caja, calidad: baja ? 'baja' : 'alta', oscuro: this.esOscuro(),
        onHover: (info, x, y) => this.zona.run(() => this.hover.set(info ? { info, x, y } : null)),
        onElegir: (sel) => this.zona.run(() => this.elegido.set(sel)),
        describir: (sel) => this.describir(sel),
      });
      const reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.escena.configurar({ rotacion: !reducido && this.rotacion(), flujos: this.flujos(), etiquetas: this.etiquetas() });
      this.escena.arrancar();
      document.addEventListener('fullscreenchange', this.alCambiarPantalla);
      this.zona.run(() => this.montada.set(true));
      const s = this.s();
      if (s) this.escena.aplicar(s, { observabilidad: this.observabilidad(), pruebas: this.pruebas() });
    } catch (e) {
      this.zona.run(() => this.fallo.set(
        'Este equipo no pudo abrir la vista 3D (WebGL desactivado o sin aceleración gráfica). El resto del módulo funciona igual.'));
      console.warn('[infra-3d]', e);
    }
  }

  private describir(sel: Seleccion): InfoHover | null {
    const s = this.s();
    if (!s) return null;
    if (sel.tipo === 'contenedor') {
      const c = s.contenedores.find((x) => x.nombre === sel.nombre);
      if (!c) return null;
      const e = estadoContenedor(c.estado, c.salud);
      const l = [`${e.texto} · ${NOMBRE_GRUPO[c.grupo]}`];
      if (c.estado === 'running') {
        l.push(`CPU ${num(c.cpu_pct)} % · RAM ${bytes(c.mem_bytes)}${c.mem_limite ? ' / ' + bytes(c.mem_limite) : ''}`);
        if (c.req_s != null) l.push(`${num(c.req_s, 2)} req/s · ${ms(c.lat_ms)} · 5xx ${pct(c.err_pct, 1)}`);
      }
      if (c.reinicios) l.push(`${c.reinicios} reinicios`);
      return { titulo: c.nombre, lineas: l, tono: e.tono === 'info' ? 'warn' : (e.tono as InfoHover['tono']) };
    }
    if (sel.tipo === 'pod') {
      const p = s.pods.find((x) => `${x.ns}/${x.nombre}` === sel.clave);
      if (!p) return null;
      return {
        titulo: p.nombre,
        lineas: [`Pod · ${p.ns} · ${p.fase}`, `${p.listos}/${p.total} listos · ${p.reinicios} reinicios`,
          `CPU ${num(p.cpu_milli)} m · RAM ${bytes(p.mem_bytes)}`],
        tono: p.fase === 'Running' && p.listos >= p.total ? 'ok' : 'danger',
      };
    }
    const h = s.hosts.find((x) => x.id === sel.id);
    const n = s.nodos.find((x) => x.nombre === sel.id);
    if (h) {
      const l = [h.rol ?? h.tipo, h.ip ?? ''];
      if (h.cpu_pct != null) l.push(`CPU ${num(h.cpu_pct)} % · RAM ${num(h.mem_pct)} %`);
      if (h.latencia_ms != null) l.push(`Responde en ${num(h.latencia_ms, 1)} ms`);
      return { titulo: h.nombre, lineas: l, tono: h.estado === 'ok' ? 'ok' : h.estado === 'critico' ? 'danger' : 'warn' };
    }
    if (n) {
      return { titulo: n.nombre, lineas: [`Nodo K3s · ${n.roles.join(', ')}`, n.ip ?? '', n.listo ? 'Listo' : 'No listo'], tono: n.listo ? 'ok' : 'danger' };
    }
    return null;
  }

  // ── Acciones de la barra ───────────────────────────────────────────────

  buscar(nombre: string): void {
    const c = this.s()?.contenedores.find((x) => x.nombre === nombre.trim());
    if (!c) return;
    if (!c.produccion) this.pruebas.set(true);
    if (c.grupo === 'observabilidad') this.observabilidad.set(true);
    this.elegido.set({ tipo: 'contenedor', nombre: c.nombre });
    setTimeout(() => this.escena?.enfocar({ tipo: 'contenedor', nombre: c.nombre }), 50);
  }

  enfocarElegido(): void {
    const sel = this.elegido();
    if (sel) this.escena?.enfocar(sel);
  }

  vistaGeneral(): void {
    this.elegido.set(null);
    this.escena?.vistaGeneral();
  }

  cerrarFicha(): void {
    this.elegido.set(null);
  }

  alternarPantalla(): void {
    const el = this.cajaRef()?.nativeElement.parentElement;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  }

  private readonly alCambiarPantalla = () => {
    this.zona.run(() => this.pantallaCompleta.set(!!document.fullscreenElement));
    setTimeout(() => this.escena?.redimensionar(), 60);
  };

  estado(c: Contenedor) {
    return estadoContenedor(c.estado, c.salud);
  }
}
