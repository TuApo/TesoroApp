import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { RankingJuego, ResumenJuegos, TiendaService } from '../../../dashboard/submodule/tienda/service/tienda.service';
import { TemporadaService } from '../../../../core/services/temporada.service';
import { EconomiaStore } from '../../economia.store';
import { mensajeError } from '../../economia.util';

/**
 * Juegos: el torneo de la semana arriba (premio que sube con los jugadores, cuenta regresiva
 * hasta el domingo a medianoche, podio), la ruleta del día, los demás juegos con mis marcas,
 * el ranking de cada uno y el salón de la fama de las semanas anteriores.
 */
@Component({
  selector: 'eco-juegos',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, RouterLink],
  templateUrl: './juegos.html',
  styleUrls: ['../../economiapp.css', './juegos.css'],
})
export class EconomiaJuegos {
  readonly store = inject(EconomiaStore);
  private api = inject(TiendaService);
  private route = inject(ActivatedRoute);
  private temporada = inject(TemporadaService);

  readonly datos = signal<ResumenJuegos | null>(null);
  readonly error = signal<string | null>(null);
  readonly rankingSel = signal<string | null>(null);
  readonly ranking = signal<RankingJuego | null>(null);
  readonly cargandoRanking = signal(false);
  readonly faltan = signal('');
  readonly halloween = computed(() => this.temporada.clave() === 'halloween');

  readonly torneo = computed(() => {
    const d = this.datos();
    return d ? d.juegos.find(j => j.codigo === d.semana.juego) ?? null : null;
  });
  readonly otros = computed(() => (this.datos()?.juegos ?? []).filter(j => !j.torneo));
  /** Avance hacia el siguiente nivel de premio (0–100). */
  readonly avance = computed(() => {
    const s = this.datos()?.semana;
    if (!s?.siguiente?.jugadores) return 100;
    const desde = s.premios.nivel === 'BASE' ? 0 : (s.niveles.find(n => n.nivel === 'MEDIO')?.jugadores ?? 0);
    return Math.min(100, Math.round(100 * (s.participantes - desde) / Math.max(1, s.siguiente.jugadores - desde)));
  });
  readonly podio = computed(() => {
    const p = this.datos()?.semana.podio ?? [];
    // Orden visual del podio: 2º, 1º, 3º.
    return [p[1], p[0], p[2]].map((x, i) => ({ puesto: [2, 1, 3][i], x }));
  });

  constructor() {
    const r = this.route.snapshot.queryParamMap.get('ranking');
    this.cargar(r);
    const reloj = setInterval(() => this.contar(), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(reloj));
    if (!this.store.ruleta()) void this.store.cargarRuleta();
  }

  private async cargar(ranking: string | null): Promise<void> {
    try {
      const d = await firstValueFrom(this.api.juegos());
      this.datos.set(d);
      this.contar();
      await this.verRanking(ranking?.toUpperCase() || d.semana.juego, !!ranking);
    } catch (e) {
      this.error.set(mensajeError(e, 'No pudimos cargar los juegos.'));
    }
  }

  async verRanking(codigo: string, desplazar = false): Promise<void> {
    this.rankingSel.set(codigo);
    this.cargandoRanking.set(true);
    try {
      this.ranking.set(await firstValueFrom(this.api.rankingJuego(codigo)));
      if (desplazar) setTimeout(() => document.getElementById('ranking')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch { this.ranking.set(null); }
    finally { this.cargandoRanking.set(false); }
  }

  private contar(): void {
    const c = this.datos()?.semana.cierra_en;
    if (!c) return;
    const ms = Math.max(0, Date.parse(c) - Date.now());
    const d = Math.floor(ms / 86_400_000), h = Math.floor(ms / 3_600_000) % 24, m = Math.floor(ms / 60_000) % 60, s = Math.floor(ms / 1000) % 60;
    this.faltan.set(d > 0 ? `${d} d ${h} h ${m} min` : `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
  }

  nombreJuego(codigo: string): string { return this.datos()?.juegos.find(j => j.codigo === codigo)?.nombre ?? codigo; }
  medalla(p: number): string { return p === 1 ? '🥇' : p === 2 ? '🥈' : p === 3 ? '🥉' : '#' + p; }
  premioDe(p: number): number {
    const s = this.datos()?.semana.premios;
    return !s ? 0 : p === 1 ? s.primero : p === 2 ? s.segundo : s.tercero;
  }
  fecha(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
  }
  abrirRuleta(): void { this.store.ruletaAbierta.set(true); }
}
