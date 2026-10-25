import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { CanjePuntos, PremioPuntos, TiendaService } from '../../../dashboard/submodule/tienda/service/tienda.service';
import { TemporadaService } from '../../../../core/services/temporada.service';
import { PREMIOS_NEUTRO } from '../../../../../theme/temporadas/temporadas';
import { EcoConfeti } from '../../components/eco-confeti';
import { EcoImagen } from '../../components/eco-imagen';
import { EconomiaStore } from '../../economia.store';
import { SonidosService } from '../../sonidos.service';
import { mensajeError, pesos, usuarioEnSesion } from '../../economia.util';

type QrFn = (texto: string, opciones: { margin: number; width: number }) => Promise<string>;
type Filtro = 'todos' | 'ya' | string;

const NIVELES: Record<string, { nombre: string; icono: string; color: string }> = {
  BRONCE: { nombre: 'Bronce', icono: 'military_tech', color: '#B45309' },
  PLATA: { nombre: 'Plata', icono: 'workspace_premium', color: '#64748B' },
  ORO: { nombre: 'Oro', icono: 'emoji_events', color: '#CA8A04' },
  DIAMANTE: { nombre: 'Diamante', icono: 'diamond', color: '#0891B2' },
};

const ICONO_REGLA: Record<string, string> = {
  INGRESO_DIARIO: 'login', BONO_RACHA_7: 'local_fire_department', PESOS_POR_PUNTO: 'shopping_bag',
  MULTIPLICADOR_PROMOCION: 'local_offer', PRIMERA_COMPRA_MES: 'calendar_month',
};

/**
 * Premios: los puntos como un juego. Arriba el saldo y el nivel; la racha de la semana (cada
 * día que entra suma y el séptimo abre el cofre); el próximo premio con lo que le falta; el
 * CAMINO de premios que se van desbloqueando a medida que suma (y los grandes, por nivel); el
 * catálogo; cómo ganar más; y sus canjes con el QR para que se lo entreguen.
 *
 * <p>Canjear descuenta los puntos de una y deja un código: en la tienda lo escanean (o le
 * buscan por cédula en la caja) y le entregan el premio. Si no lo reclama a tiempo o lo
 * cancela, los puntos vuelven solos.
 */
@Component({
  selector: 'eco-premios',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, RouterLink, EcoImagen, EcoConfeti],
  templateUrl: './premios.html',
  styleUrls: ['../../economiapp.css', './premios.css'],
})
export class EconomiaPremios implements OnDestroy {
  readonly store = inject(EconomiaStore);
  private sonidos = inject(SonidosService);
  private api = inject(TiendaService);
  private temporada = inject(TemporadaService);

  readonly premios = signal<PremioPuntos[]>([]);
  readonly canjes = signal<CanjePuntos[]>([]);
  readonly qr = signal<Record<string, string>>({});
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly filtro = signal<Filtro>('todos');
  readonly abierto = signal<PremioPuntos | null>(null);
  readonly canjeando = signal(false);
  readonly recienCanjeado = signal<CanjePuntos | null>(null);
  readonly verHistorial = signal(false);
  /** Saldo que se muestra subiendo de 0 al real (efecto de contador). */
  readonly saldoVisible = signal(0);
  private animacion = 0;

  readonly imagenes = computed(() => this.temporada.activa()?.imagenes?.premios ?? PREMIOS_NEUTRO);
  readonly enHalloween = computed(() => this.temporada.clave() === 'halloween');
  readonly puntos = computed(() => this.store.puntos());
  readonly saldo = computed(() => this.puntos()?.saldo ?? 0);
  readonly nivel = computed(() => NIVELES[this.puntos()?.nivel?.codigo ?? 'BRONCE'] ?? NIVELES['BRONCE']);

  /** Los 7 días de la semana de racha: los ya cumplidos, hoy y el cofre del séptimo. */
  readonly semana = computed(() => {
    const p = this.puntos();
    const racha = p?.racha ?? 0;
    const hechos = p?.ingreso_hoy ? ((racha - 1) % 7) + 1 : racha % 7;
    return Array.from({ length: 7 }, (_, i) => ({
      dia: i + 1,
      hecho: i < hechos,
      hoy: p?.ingreso_hoy ? i === hechos - 1 : i === hechos,
      cofre: i === 6,
      // Con la ruleta, cada día es un giro; el séptimo además abre el cofre (bono de racha).
      puntos: i === 6 ? (p?.bono_racha ?? 50) : 0,
    }));
  });

  readonly canjeables = computed(() => this.premios().filter(p => p.alcanzable));
  /** El premio por el que vale la pena seguir sumando: el más cercano que todavía no alcanza. */
  readonly proximo = computed(() => this.premios()
    .filter(p => !p.alcanzable && !p.agotado && !p.limite_alcanzado && !p.bloqueado_por_nivel)
    .sort((a, b) => a.faltan - b.faltan)[0] ?? null);
  readonly categorias = computed(() => [...new Set(this.premios().map(p => p.categoria).filter((c): c is string => !!c))]);
  readonly visibles = computed(() => {
    const f = this.filtro();
    const ps = this.premios();
    if (f === 'todos') return ps;
    if (f === 'ya') return ps.filter(p => p.alcanzable);
    return ps.filter(p => p.categoria === f);
  });
  /** Camino: de menor a mayor; el marcador "usted" va después del último que ya alcanza. */
  readonly camino = computed(() => [...this.premios()].sort((a, b) => a.puntos - b.puntos));
  readonly posicion = computed(() => {
    const s = this.saldo();
    const c = this.camino();
    let i = -1;
    c.forEach((p, k) => { if (p.puntos <= s) i = k; });
    return i;
  });
  readonly pendientes = computed(() => this.canjes().filter(c => c.estado === 'SOLICITADO' && !Number(c.vencido)));
  readonly historialCanjes = computed(() => this.canjes().filter(c => c.estado !== 'SOLICITADO' || Number(c.vencido)));

  readonly pesos = pesos;
  readonly NIVELES = NIVELES;
  readonly ICONO_REGLA = ICONO_REGLA;

  constructor() {
    effect(() => {
      const t = this.store.tiendaId();
      untracked(() => { if (t) this.cargar(t); });
    });
    // Desde la ruleta («Ver mi canje») se llega con #canjes.
    const f = inject(ActivatedRoute).snapshot.fragment;
    if (f) setTimeout(() => this.irA(f), 900);
    if (!this.store.ruleta()) void this.store.cargarRuleta();
    // El saldo "sube" cada vez que cambia: así se nota lo que se ganó o se gastó.
    effect(() => {
      const meta = this.saldo();
      untracked(() => this.animarSaldo(meta));
    });
    this.store.refrescarPuntos();
  }

  ngOnDestroy(): void { cancelAnimationFrame(this.animacion); }

  private async cargar(tienda: string): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const [ps, cs] = await Promise.all([
        firstValueFrom(this.api.premiosComprador(tienda)),
        firstValueFrom(this.api.misCanjes()),
      ]);
      this.premios.set(ps ?? []);
      this.canjes.set(cs ?? []);
      this.pintarQr(cs ?? []);
    } catch (e) {
      this.error.set(mensajeError(e, 'No pudimos cargar los premios'));
    } finally {
      this.cargando.set(false);
    }
  }

  private animarSaldo(meta: number): void {
    cancelAnimationFrame(this.animacion);
    const desde = this.saldoVisible();
    if (desde === meta || typeof requestAnimationFrame === 'undefined') { this.saldoVisible.set(meta); return; }
    const inicio = performance.now(), dur = 900;
    const paso = (t: number) => {
      const k = Math.min(1, (t - inicio) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      this.saldoVisible.set(Math.round(desde + (meta - desde) * e));
      if (k < 1) this.animacion = requestAnimationFrame(paso);
    };
    this.animacion = requestAnimationFrame(paso);
  }

  private async pintarQr(cs: CanjePuntos[]): Promise<void> {
    const activos = cs.filter(c => c.estado === 'SOLICITADO');
    if (!activos.length) return;
    const mod = await import('qrcode') as unknown as { toDataURL?: QrFn; default?: { toDataURL: QrFn } };
    const toDataURL = mod.toDataURL ?? mod.default?.toDataURL;
    if (!toDataURL) return;
    const salida: Record<string, string> = { ...this.qr() };
    for (const c of activos) {
      if (!salida[c.id]) salida[c.id] = await toDataURL('CANJE:' + c.codigo, { margin: 1, width: 240 });
    }
    this.qr.set(salida);
  }

  progreso(p: PremioPuntos): number {
    return Math.max(0, Math.min(100, Math.round(100 * this.saldo() / Math.max(1, p.puntos))));
  }

  motivo(p: PremioPuntos): string {
    if (p.agotado) return 'Agotado';
    if (p.limite_alcanzado) return 'Ya lo canjeó';
    if (p.bloqueado_por_nivel) return 'Se desbloquea en nivel ' + (NIVELES[p.nivel_minimo]?.nombre ?? p.nivel_minimo);
    if (!p.alcanzable) return `Le faltan ${this.miles(p.faltan)} puntos`;
    return '¡Ya lo puede canjear!';
  }

  miles(n: number | null | undefined): string { return new Intl.NumberFormat('es-CO').format(Number(n) || 0); }

  codigoVisible(c: string): string { return c.length === 8 ? c.slice(0, 4) + '-' + c.slice(4) : c; }

  venceEn(c: CanjePuntos): string {
    const ms = new Date(c.vence_en).getTime() - Date.now();
    if (ms <= 0) return 'vencido';
    const dias = Math.floor(ms / 86_400_000);
    if (dias >= 1) return `vence en ${dias} día${dias === 1 ? '' : 's'}`;
    const horas = Math.max(1, Math.floor(ms / 3_600_000));
    return `vence en ${horas} hora${horas === 1 ? '' : 's'}`;
  }

  abrir(p: PremioPuntos): void {
    this.recienCanjeado.set(null);
    this.abierto.set(p);
    this.sonidos.tocar(p.alcanzable ? 'cofre' : 'abrir');
  }

  cerrar(): void {
    if (this.abierto()) this.sonidos.tocar('cerrar');
    this.abierto.set(null);
    this.recienCanjeado.set(null);
  }

  async canjear(p: PremioPuntos): Promise<void> {
    const tienda = this.store.tiendaId();
    if (!tienda || !p.alcanzable || this.canjeando()) return;
    this.canjeando.set(true);
    try {
      const c = await firstValueFrom(this.api.canjearPremio(p.id, tienda, usuarioEnSesion().nombre));
      this.recienCanjeado.set(c);
      this.sonidos.tocar('canje');
      try { navigator.vibrate?.([40, 60, 40]); } catch { /* opcional */ }
      await this.store.refrescarPuntos();
      await this.cargar(tienda);
    } catch (e) {
      this.store.avisar(mensajeError(e, 'No se pudo canjear'), 'error');
    } finally {
      this.canjeando.set(false);
    }
  }

  async cancelar(c: CanjePuntos): Promise<void> {
    if (!confirm(`¿Cancelar el canje de «${c.premio_nombre}»? Los ${this.miles(c.puntos)} puntos vuelven a su saldo.`)) return;
    try {
      await firstValueFrom(this.api.cancelarCanje(c.id));
      this.sonidos.tocar('monedas');
      this.store.avisar('Canje cancelado: sus puntos volvieron');
      await this.store.refrescarPuntos();
      const t = this.store.tiendaId();
      if (t) await this.cargar(t);
    } catch (e) {
      this.store.avisar(mensajeError(e, 'No se pudo cancelar'), 'error');
    }
  }

  irA(id: string): void { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

  etiquetaOrigen(o: string): string {
    return ({ INGRESO: 'Ingreso diario', RACHA: 'Bono de racha', COMPRA_PEDIDO: 'Compra', COMPRA_CAJA: 'Compra en caja', PRIMERA_COMPRA: 'Primera compra del mes',
      CANJE: 'Canje', DEVOLUCION_CANJE: 'Devolución', REVERSA: 'Reversa', AJUSTE: 'Ajuste' } as Record<string, string>)[o] ?? o;
  }
}
