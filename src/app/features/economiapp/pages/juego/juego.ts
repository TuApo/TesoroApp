import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { firstValueFrom, map } from 'rxjs';

import { JuegoResumen, PartidaIniciada, ResultadoPartida, TiendaService } from '../../../dashboard/submodule/tienda/service/tienda.service';
import { TemporadaService } from '../../../../core/services/temporada.service';
import { EcoConfeti } from '../../components/eco-confeti';
import { FinDeJuego } from '../../components/juegos/azar';
import { JuegoAtrapa } from '../../components/juegos/juego-atrapa';
import { JuegoMemoria } from '../../components/juegos/juego-memoria';
import { JuegoPrecio } from '../../components/juegos/juego-precio';
import { EconomiaStore } from '../../economia.store';
import { mensajeError, usuarioEnSesion } from '../../economia.util';
import { SonidosService } from '../../sonidos.service';

type Fase = 'intro' | 'preparando' | 'cuenta' | 'jugando' | 'enviando' | 'fin';

/**
 * Anfitrión de un minijuego: presentación (mi marca, el récord, el premio si es el torneo),
 * cuenta regresiva, la partida a pantalla completa y el resultado (puesto en el ranking,
 * récord nuevo). La partida se abre en el servidor ANTES de jugar (le da la semilla y la hora
 * de inicio) y se cierra con el puntaje: el servidor decide si cuenta.
 */
@Component({
  selector: 'eco-juego',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, RouterLink, EcoConfeti, JuegoAtrapa, JuegoMemoria, JuegoPrecio],
  templateUrl: './juego.html',
  styleUrls: ['../../economiapp.css', './juego.css'],
})
export class EconomiaJuego {
  readonly store = inject(EconomiaStore);
  private api = inject(TiendaService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private sonidos = inject(SonidosService);
  private temporada = inject(TemporadaService);

  readonly codigo = toSignal(this.route.paramMap.pipe(map(p => (p.get('codigo') || '').toUpperCase())), { initialValue: (this.route.snapshot.paramMap.get('codigo') || '').toUpperCase() });
  readonly halloween = computed(() => this.temporada.clave() === 'halloween');
  readonly info = signal<JuegoResumen | null>(null);
  readonly premios = signal<{ primero: number; segundo: number; tercero: number } | null>(null);
  readonly cierra = signal<string | null>(null);
  readonly fase = signal<Fase>('intro');
  readonly partida = signal<PartidaIniciada | null>(null);
  readonly cuenta = signal(3);
  readonly resultado = signal<ResultadoPartida | null>(null);
  readonly error = signal<string | null>(null);
  readonly cargando = signal(true);

  constructor() {
    // La misma pantalla sirve a todos los juegos: al cambiar de /juego/atrapa a /juego/memoria
    // el router la reutiliza, así que se reinicia y se recarga con el juego nuevo.
    effect(() => {
      this.codigo();
      untracked(() => {
        this.fase.set('intro'); this.partida.set(null); this.resultado.set(null); this.error.set(null); this.premios.set(null);
        this.cargar();
      });
    });
    inject(DestroyRef).onDestroy(() => document.body.classList.remove('eco-jugando'));
  }

  private async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const r = await firstValueFrom(this.api.juegos());
      const j = r.juegos.find(x => x.codigo === this.codigo()) ?? null;
      this.info.set(j);
      if (j?.torneo) this.premios.set(r.semana.premios);
      this.cierra.set(r.semana.cierra_en);
    } catch (e) {
      this.error.set(mensajeError(e, 'No pudimos cargar el juego.'));
    } finally {
      this.cargando.set(false);
    }
  }

  /** Abre la partida en el servidor y arranca la cuenta regresiva cuando el juego está listo. */
  async jugar(): Promise<void> {
    if (this.fase() === 'preparando' || this.fase() === 'cuenta') return;
    this.error.set(null);
    this.resultado.set(null);
    try {
      const p = await firstValueFrom(this.api.iniciarPartida(this.codigo(), this.store.tiendaId(), usuarioEnSesion().nombre));
      this.partida.set(p);
      this.fase.set('preparando');
      document.body.classList.add('eco-jugando');
    } catch (e) {
      this.error.set(mensajeError(e, 'No se pudo empezar la partida.'));
      this.sonidos.tocar('error');
    }
  }

  /** El juego cargó lo que necesita (productos, tablero): 3, 2, 1… ¡ya! */
  alEstarListo(): void {
    if (this.fase() !== 'preparando') return;
    this.fase.set('cuenta');
    this.cuenta.set(3);
    this.sonidos.tocar('cuenta');
    const paso = () => {
      const n = this.cuenta() - 1;
      if (n <= 0) { this.sonidos.tocar('ya'); this.fase.set('jugando'); return; }
      this.cuenta.set(n);
      this.sonidos.tocar('cuenta');
      setTimeout(paso, 800);
    };
    setTimeout(paso, 800);
  }

  async alTerminar(f: FinDeJuego): Promise<void> {
    const p = this.partida();
    if (!p || this.fase() === 'enviando' || this.fase() === 'fin') return;
    this.fase.set('enviando');
    try {
      const r = await firstValueFrom(this.api.terminarPartida(p.id, f.puntaje, f.detalle));
      this.resultado.set(r);
      if (r.nuevo_record) this.sonidos.tocar('nivel');
      else if (r.mejor_semana) this.sonidos.tocar('festejo');
      this.info.update(i => i ? {
        ...i, partidas_hoy: i.partidas_hoy + 1,
        mi_mejor_semana: r.aceptada ? Math.max(i.mi_mejor_semana ?? 0, r.puntaje) : i.mi_mejor_semana,
        mi_record: r.aceptada ? Math.max(i.mi_record ?? 0, r.puntaje) : i.mi_record, record: r.record ?? i.record,
      } : i);
    } catch (e) {
      this.resultado.set({ id: p.id, juego: p.juego, estado: 'ERROR', aceptada: false, motivo: mensajeError(e, 'No se pudo guardar el puntaje.'),
        puntaje: f.puntaje, nuevo_record: false, mejor_semana: false, yo: null, record: null, participantes: 0 });
    } finally {
      document.body.classList.remove('eco-jugando');
      this.fase.set('fin');
    }
  }

  salir(): void {
    document.body.classList.remove('eco-jugando');
    this.router.navigate(['/economiapp/juegos']);
  }

  readonly quedan = computed(() => {
    const i = this.info();
    return i ? Math.max(0, i.partidas_dia - i.partidas_hoy) : 0;
  });
}
