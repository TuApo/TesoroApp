import { ChangeDetectionStrategy, Component, DestroyRef, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom, forkJoin } from 'rxjs';

import { BotService } from '../../services/bot.service';
import { ModoBot, Plataforma, SesionResumen } from '../../models/bot.model';
import { PLATAFORMAS, detectarPlataforma, esTerminal, esVivo, estadoInfo, isoDesdeLocal, modoSugerido } from '../../utils/bot';
import { mensajeError } from '../../../utils/texto';
import { duracionHumana, fechaHora } from '../../../utils/tiempo';

/** Refresco de las tarjetas de sesiones en vivo. */
export const REFRESCO_MS = 10_000;

interface Alta {
  url: string;
  titulo: string;
  cuando: 'ahora' | 'programada';
  fecha: string;
  modo: ModoBot;
  modoTocado: boolean;
}

/**
 * Inicio del asistente de reuniones: mandar el bot a una reunión (o capturar desde este
 * dispositivo), las sesiones en vivo, las invitaciones por aprobar, las programadas y el
 * historial. Las sesiones se refrescan cada 10 s mientras la pestaña está visible.
 */
@Component({
  selector: 'app-bot-inicio',
  standalone: true,
  imports: [RouterLink, MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './bot-inicio.component.html',
  styleUrls: ['../../../estilos/base.css', './bot-inicio.component.css'],
})
export class BotInicioComponent {
  private readonly api = inject(BotService);
  private readonly router = inject(Router);
  private readonly navegador = isPlatformBrowser(inject(PLATFORM_ID));

  readonly PLATAFORMAS = PLATAFORMAS;
  readonly estadoInfo = estadoInfo;
  readonly fechaHora = fechaHora;
  readonly duracionHumana = duracionHumana;

  readonly sesiones = signal<SesionResumen[]>([]);
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly accion = signal<string | null>(null);
  readonly errorAccion = signal('');

  readonly abierto = signal(false);
  readonly enviando = signal(false);
  readonly errorAlta = signal('');
  readonly alta = signal<Alta>(this.altaVacia());

  readonly plataformaDetectada = computed<Plataforma | null>(() => detectarPlataforma(this.alta().url));
  readonly urlValida = computed(() => this.plataformaDetectada() !== null);
  readonly puedeEnviar = computed(() => {
    const a = this.alta();
    if (a.modo === 'NAVEGADOR' && !this.urlValida()) return false;
    if (a.cuando === 'programada' && !isoDesdeLocal(a.fecha)) return false;
    return !this.enviando();
  });

  readonly enVivo = computed(() => this.sesiones().filter(s => esVivo(s.estado)));
  readonly porAprobar = computed(() => this.sesiones().filter(s => s.estado === 'PENDIENTE_APROBACION'));
  readonly programadas = computed(() => this.sesiones().filter(s => s.estado === 'PROGRAMADA')
    .sort((a, b) => (a.programada_para ?? '').localeCompare(b.programada_para ?? '')));
  readonly historial = computed(() => this.sesiones().filter(s => esTerminal(s.estado)));

  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    void this.cargar();
    if (this.navegador) {
      this.timer = setInterval(() => { if (!document.hidden) void this.cargar(true); }, REFRESCO_MS);
    }
    inject(DestroyRef).onDestroy(() => { if (this.timer) clearInterval(this.timer); });
  }

  async cargar(silencioso = false): Promise<void> {
    if (!silencioso) this.cargando.set(true);
    try {
      // Un pedido por grupo: así un historial largo nunca deja fuera a las que están en vivo.
      const [vivas, aprobar, programadas, historial] = await firstValueFrom(forkJoin([
        this.api.sesiones({ estado: 'VIVAS', size: 50 }),
        this.api.sesiones({ estado: 'POR_APROBAR', size: 50 }),
        this.api.sesiones({ estado: 'PROGRAMADAS', size: 50 }),
        this.api.sesiones({ estado: 'HISTORIAL', size: 30 }),
      ]));
      const todas = new Map<string, SesionResumen>();
      for (const p of [vivas, aprobar, programadas, historial]) for (const s of p.content ?? []) todas.set(s.id, s);
      this.sesiones.set([...todas.values()]);
      this.error.set('');
    } catch (e) {
      if (!silencioso) this.error.set(mensajeError(e, 'No se pudieron cargar las sesiones del asistente'));
    } finally {
      this.cargando.set(false);
    }
  }

  // ── Alta ──────────────────────────────────────────────────────────────────

  private altaVacia(): Alta {
    return { url: '', titulo: '', cuando: 'ahora', fecha: '', modo: 'NAVEGADOR', modoTocado: false };
  }

  abrir(): void {
    this.alta.set(this.altaVacia());
    this.errorAlta.set('');
    this.abierto.set(true);
  }

  campo<K extends keyof Alta>(k: K, v: Alta[K]): void {
    this.alta.update(a => {
      const n = { ...a, [k]: v };
      if (k === 'modo') n.modoTocado = true;
      // Pegar un enlace de WhatsApp sugiere el modo captura (si la persona no lo eligió a mano).
      if (k === 'url' && !n.modoTocado) n.modo = modoSugerido(detectarPlataforma(String(v)));
      return n;
    });
  }

  async enviar(): Promise<void> {
    if (!this.puedeEnviar()) return;
    const a = this.alta();
    this.enviando.set(true);
    this.errorAlta.set('');
    try {
      const s = await firstValueFrom(this.api.crear({
        join_url: a.url.trim() || null,
        titulo: a.titulo.trim() || null,
        programada_para: a.cuando === 'programada' ? isoDesdeLocal(a.fecha) : null,
        modo: a.modo,
      }));
      this.abierto.set(false);
      if (a.cuando === 'ahora') {
        void this.router.navigate(['/dashboard/reuniones/bot', s.id]);
      } else {
        void this.cargar(true);
      }
    } catch (e) {
      this.errorAlta.set(mensajeError(e, 'No se pudo enviar el bot'));
    } finally {
      this.enviando.set(false);
    }
  }

  /** Captura desde este dispositivo: crea la sesión y abre la sala, donde se arranca. */
  async capturar(): Promise<void> {
    this.accion.set('captura');
    this.errorAccion.set('');
    try {
      const s = await firstValueFrom(this.api.crear({ modo: 'CAPTURA', titulo: 'Captura desde el dispositivo' }));
      void this.router.navigate(['/dashboard/reuniones/bot', s.id]);
    } catch (e) {
      this.errorAccion.set(mensajeError(e, 'No se pudo empezar la captura'));
    } finally {
      this.accion.set(null);
    }
  }

  // ── Acciones por sesión ───────────────────────────────────────────────────

  async hacer(s: SesionResumen, que: 'aprobar' | 'rechazar' | 'cancelar'): Promise<void> {
    if (que === 'cancelar' && typeof confirm === 'function' && !confirm('¿Cancelar esta sesión del bot?')) return;
    this.accion.set(`${que}-${s.id}`);
    this.errorAccion.set('');
    try {
      const nueva = await firstValueFrom(
        que === 'aprobar' ? this.api.aprobar(s.id) : que === 'rechazar' ? this.api.rechazar(s.id) : this.api.cancelar(s.id));
      this.sesiones.update(l => l.map(x => (x.id === s.id ? { ...x, ...nueva } : x)));
    } catch (e) {
      this.errorAccion.set(mensajeError(e, 'No se pudo actualizar la sesión'));
    } finally {
      this.accion.set(null);
    }
  }

  plataforma(s: SesionResumen) { return PLATAFORMAS[s.plataforma] ?? PLATAFORMAS.OTRA; }

  /** Mínimo para `datetime-local`: ahora, en hora local. */
  ahoraLocal(): string {
    const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
    return d.toISOString().slice(0, 16);
  }
}
