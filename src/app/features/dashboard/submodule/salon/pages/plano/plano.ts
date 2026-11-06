import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnDestroy, computed, effect, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';

import { MesaTarjeta } from '../../components/mesa-tarjeta';
import { SalonEncabezado } from '../../components/salon-encabezado';
import { ETIQUETA_ALERTA, ETIQUETA_ESTADO, EstadoMesa, MesaPlano, SalonPlano } from '../../models/salon.models';
import { SALON_CONTEXTO, permisosDeContexto } from '../../services/salon-contexto.token';
import { SalonStreamService } from '../../services/salon-stream.service';
import { SalonService, mensajeError } from '../../services/salon.service';

const CLAVE_VISTA = 'salon:plano:vista';

/**
 * Plano del salón en vivo: cada mesa en su posición (0..1 del plano) con el color del
 * estado y un cronómetro que avanza solo; resumen arriba; toasts cuando llega una alerta
 * por el canal SSE. «Lista» es la misma información en tarjetas iguales (móvil).
 */
@Component({
  selector: 'app-salon-plano',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, SalonEncabezado, MesaTarjeta],
  templateUrl: './plano.html',
  styleUrls: ['../../salon-comun.css', './plano.css'],
})
export class SalonPlanoPage implements OnDestroy {
  readonly ctx = inject(SALON_CONTEXTO);
  readonly permisos = permisosDeContexto(this.ctx);
  readonly stream = inject(SalonStreamService);
  private api = inject(SalonService);
  private snack = inject(MatSnackBar);
  private destroyRef = inject(DestroyRef);
  private raiz = viewChild<ElementRef<HTMLElement>>('raiz');

  readonly vista = signal<'plano' | 'lista'>(leerVista());
  readonly pantallaCompleta = signal(false);
  readonly minutosAviso = signal(5);
  readonly ocupado = signal<string | null>(null);

  readonly plano = this.stream.plano;
  readonly resumen = computed(() => this.plano()?.resumen ?? null);
  readonly salones = computed<SalonPlano[]>(() => this.plano()?.salones ?? []);
  readonly todasLasMesas = computed(() => this.salones().flatMap(s => s.mesas.map(m => ({ ...m, salon: s.nombre }))));
  readonly leyenda: Array<{ estado: EstadoMesa; clase: string }> = [
    { estado: 'LIBRE', clase: 'libre' }, { estado: 'OCUPADA', clase: 'ocupada' },
    { estado: 'POR_LIMPIAR', clase: 'limpiar' }, { estado: 'RESERVADA', clase: 'reservada' },
  ];

  private tiendaEnUso: string | null = null;

  constructor() {
    // La sede puede cambiar en caliente (selector): se suelta el canal viejo y se abre el nuevo.
    effect(() => {
      const id = this.ctx.tiendaId();
      if (this.tiendaEnUso) { this.stream.soltar(); this.tiendaEnUso = null; }
      if (id) {
        this.stream.usar(id);
        this.tiendaEnUso = id;
        this.api.reglas(id).subscribe({ next: r => this.minutosAviso.set(r.minutos_sin_atencion || 5), error: () => { /* el valor por defecto vale */ } });
      }
    });
    this.stream.alerta$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(a => {
      const quien = a.mesa_nombre ? `Mesa ${a.mesa_nombre}` : 'Cámara';
      this.snack.open(`${quien}: ${ETIQUETA_ALERTA[a.tipo] ?? a.tipo}${a.detalle ? ' · ' + a.detalle : ''}`, 'OK', { duration: 6000 });
    });
    if (typeof document !== 'undefined') {
      const alCambiar = () => this.pantallaCompleta.set(!!document.fullscreenElement);
      document.addEventListener('fullscreenchange', alCambiar);
      this.destroyRef.onDestroy(() => document.removeEventListener('fullscreenchange', alCambiar));
    }
  }

  ngOnDestroy(): void {
    if (this.tiendaEnUso) this.stream.soltar();
  }

  etiqueta(e: EstadoMesa): string { return ETIQUETA_ESTADO[e]; }
  /** Hora local corta de un ISO (sin CommonModule: el submódulo no depende de pipes del shell). */
  hora(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  /** Caja de cada mesa dentro del salón, en % del plano. */
  estiloMesa(m: MesaPlano): Record<string, string> {
    return { left: `${m.pos_x * 100}%`, top: `${m.pos_y * 100}%`, width: `${m.ancho * 100}%`, height: `${m.alto * 100}%` };
  }
  /** Proporción del salón (ancho_plano / alto_plano) para que el dibujo no se deforme. */
  proporcion(s: SalonPlano): string { return `${s.ancho_plano || 1} / ${s.alto_plano || 0.6}`; }

  cambiarVista(v: 'plano' | 'lista'): void {
    this.vista.set(v);
    try { localStorage.setItem(CLAVE_VISTA, v); } catch { /* sin storage */ }
  }

  alternarPantallaCompleta(): void {
    const el = this.raiz()?.nativeElement;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => { /* nada */ });
    else el.requestFullscreen?.().catch(() => this.snack.open('El navegador no permite pantalla completa aquí', 'OK', { duration: 3000 }));
  }

  atendida(m: MesaPlano): void { this.accion(m.id, this.api.marcarAtendida(m.id), `Mesa ${m.nombre}: atendida`); }
  limpia(m: MesaPlano): void { this.accion(m.id, this.api.marcarLimpia(m.id), `Mesa ${m.nombre}: lista`); }
  cambiarEstado(ev: { mesa: MesaPlano; estado: EstadoMesa }): void {
    const motivo = `Cambio manual desde el plano (${ETIQUETA_ESTADO[ev.mesa.estado]} → ${ETIQUETA_ESTADO[ev.estado]})`;
    this.accion(ev.mesa.id, this.api.cambiarEstado(ev.mesa.id, ev.estado, motivo), `Mesa ${ev.mesa.nombre}: ${ETIQUETA_ESTADO[ev.estado]}`);
  }

  private accion(mesaId: string, peticion: { subscribe: (o: { next: () => void; error: (e: unknown) => void }) => unknown }, ok: string): void {
    if (this.ocupado()) return;
    this.ocupado.set(mesaId);
    peticion.subscribe({
      next: () => { this.ocupado.set(null); this.snack.open(ok, 'OK', { duration: 2500 }); this.stream.refrescar(); },
      error: e => { this.ocupado.set(null); this.snack.open(mensajeError(e), 'OK', { duration: 5000 }); },
    });
  }
}

function leerVista(): 'plano' | 'lista' {
  try { return localStorage.getItem(CLAVE_VISTA) === 'lista' ? 'lista' : 'plano'; } catch { return 'plano'; }
}
