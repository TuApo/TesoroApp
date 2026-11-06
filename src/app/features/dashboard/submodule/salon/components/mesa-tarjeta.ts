import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';

import { ESTADOS_MESA, ETIQUETA_ALERTA, ETIQUETA_ESTADO, EstadoMesa, MesaPlano } from '../models/salon.models';
import { CronometroPipe } from './cronometro.pipe';

/**
 * Una mesa del plano: color por estado, cronómetro que avanza solo, badge de alerta,
 * «se libera en ~X min» y acciones (atendida / limpia / cambiar estado).
 *
 * <p>El cronómetro no se calcula con un interval propio por tarjeta (con 40 mesas serían 40
 * relojes): recibe `ahora` del padre, que tiene UN reloj de 1 s, y `recibidoEn` (cuándo
 * llegó el plano) para sumar lo transcurrido a `segundos_en_estado` cuando no hay `desde`.
 */
@Component({
  selector: 'app-mesa-tarjeta',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatMenuModule, CronometroPipe],
  template: `
    <article class="mesa" [class]="'mesa mesa--' + clase()" [class.mesa--compacta]="compacta()" [class.mesa--redonda]="mesa().forma === 'REDONDA'"
      [attr.aria-label]="mesa().nombre + ': ' + etiqueta()">
      <header class="mesa-cab">
        <strong class="mesa-nombre">{{ mesa().nombre }}</strong>
        <span class="mesa-cap" title="Capacidad"><mat-icon>chair</mat-icon>{{ mesa().personas ?? 0 }}/{{ mesa().capacidad }}</span>
      </header>
      <div class="mesa-estado">{{ etiqueta() }}</div>
      <div class="mesa-reloj" [class.mesa-reloj--tarde]="tarde()">
        <mat-icon>timer</mat-icon><span>{{ segundos() | cronometro }}</span>
      </div>
      @if (mesa().estado === 'OCUPADA' && mesa().minutos_para_liberar !== null) {
        <div class="mesa-libera"><mat-icon>schedule</mat-icon>se libera en ~{{ mesa().minutos_para_liberar }} min</div>
      }
      @if (mesa().alerta; as a) {
        <span class="mesa-alerta" [class.mesa-alerta--grave]="a.tipo === 'ESCALADO'">
          <mat-icon>{{ a.tipo === 'LIMPIEZA' ? 'cleaning_services' : 'notification_important' }}</mat-icon>{{ etiquetaAlerta(a.tipo) }}
        </span>
      } @else if (mesa().estado === 'OCUPADA' && mesa().segundos_sin_atencion !== null) {
        <span class="mesa-sinat" title="Tiempo sin personal cerca">
          <mat-icon>{{ mesa().atendida ? 'check_circle' : 'hourglass_top' }}</mat-icon>{{ sinAtencion() | cronometro }} sin atención
        </span>
      }
      @if (puedeOperar()) {
        <footer class="mesa-acciones">
          @if (mesa().estado === 'OCUPADA') {
            <button type="button" class="mesa-btn" (click)="atendida.emit(mesa())" title="Marcar atendida"><mat-icon>room_service</mat-icon></button>
          }
          @if (mesa().estado === 'POR_LIMPIAR') {
            <button type="button" class="mesa-btn" (click)="limpia.emit(mesa())" title="Marcar limpia"><mat-icon>cleaning_services</mat-icon></button>
          }
          <button type="button" class="mesa-btn" [matMenuTriggerFor]="menu" title="Cambiar estado"><mat-icon>swap_horiz</mat-icon></button>
          <mat-menu #menu="matMenu">
            @for (e of estados; track e) {
              <button mat-menu-item [disabled]="e === mesa().estado" (click)="cambiarEstado.emit({ mesa: mesa(), estado: e })">
                <span class="menu-punto" [class]="'menu-punto menu-punto--' + claseDe(e)"></span>{{ etiquetaDe(e) }}
              </button>
            }
          </mat-menu>
        </footer>
      }
    </article>
  `,
  styles: [`
    :host { display: block; height: 100%; min-width: 0; }
    .mesa { height: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; border-radius: var(--r-md);
      border: 2px solid var(--mesa-borde); background: var(--mesa-fondo); color: var(--mesa-texto); overflow: hidden; container-type: inline-size; }
    .mesa--redonda { border-radius: 28px; }
    .mesa--libre { --mesa-borde: var(--mesa-libre); --mesa-fondo: var(--mesa-libre-bg); --mesa-texto: var(--mesa-libre-fg); }
    .mesa--ocupada { --mesa-borde: var(--mesa-ocupada); --mesa-fondo: var(--mesa-ocupada-bg); --mesa-texto: var(--mesa-ocupada-fg); }
    .mesa--limpiar { --mesa-borde: var(--mesa-limpiar); --mesa-fondo: var(--mesa-limpiar-bg); --mesa-texto: var(--mesa-limpiar-fg); }
    .mesa--reservada { --mesa-borde: var(--mesa-reservada); --mesa-fondo: var(--mesa-reservada-bg); --mesa-texto: var(--mesa-reservada-fg); }
    .mesa-cab { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; }
    .mesa-nombre { font-size: 1.05rem; font-weight: 800; }
    .mesa-cap { display: inline-flex; align-items: center; gap: 2px; font-size: .8rem; font-weight: 700; opacity: .85; }
    .mesa-cap mat-icon, .mesa-reloj mat-icon, .mesa-libera mat-icon, .mesa-alerta mat-icon, .mesa-sinat mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .mesa-estado { font-size: .78rem; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
    .mesa-reloj { display: inline-flex; align-items: center; gap: 4px; font-variant-numeric: tabular-nums; font-weight: 800; font-size: 1.1rem; }
    .mesa-reloj--tarde { animation: sl-latido 1.2s ease-in-out infinite; }
    .mesa-libera, .mesa-sinat { display: inline-flex; align-items: center; gap: 4px; font-size: .78rem; font-weight: 600; }
    .mesa-alerta { display: inline-flex; align-items: center; gap: 4px; align-self: flex-start; padding: 2px 8px; border-radius: 999px;
      background: var(--danger); color: #fff; font-size: .75rem; font-weight: 800; }
    .mesa-alerta--grave { animation: sl-latido .8s ease-in-out infinite; }
    .mesa-acciones { margin-top: auto; display: flex; gap: 4px; justify-content: flex-end; }
    .mesa-btn { width: 36px; height: 36px; border-radius: 10px; border: 1px solid var(--mesa-borde); background: var(--surface); color: var(--mesa-texto);
      display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; }
    .mesa-btn mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .mesa-btn:hover { background: var(--surface-3); }
    .menu-punto { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 8px; }
    .menu-punto--libre { background: var(--mesa-libre); } .menu-punto--ocupada { background: var(--mesa-ocupada); }
    .menu-punto--limpiar { background: var(--mesa-limpiar); } .menu-punto--reservada { background: var(--mesa-reservada); }
    /* Mesa chica dentro del plano: solo nombre, estado y reloj. */
    .mesa--compacta .mesa-libera, .mesa--compacta .mesa-sinat, .mesa--compacta .mesa-cap { display: none; }
    @container (max-width: 120px) { .mesa-estado, .mesa-libera, .mesa-sinat { display: none; } .mesa-reloj { font-size: .95rem; } .mesa-nombre { font-size: .95rem; } }
    @keyframes sl-latido { 50% { opacity: .55; } }
  `],
})
export class MesaTarjeta {
  readonly mesa = input.required<MesaPlano>();
  /** `Date.now()` del reloj del padre (1 s). */
  readonly ahora = input.required<number>();
  /** Cuándo llegó el plano que trae esta mesa (ms). */
  readonly recibidoEn = input.required<number>();
  readonly puedeOperar = input(true);
  /** Dentro del plano a escala: oculta lo secundario. */
  readonly compacta = input(false);
  /** Minutos a partir de los que el reloj de una mesa ocupada parpadea (regla `minutos_sin_atencion`). */
  readonly minutosAviso = input(5);

  readonly atendida = output<MesaPlano>();
  readonly limpia = output<MesaPlano>();
  readonly cambiarEstado = output<{ mesa: MesaPlano; estado: EstadoMesa }>();

  readonly estados = ESTADOS_MESA;

  readonly clase = computed(() => this.claseDe(this.mesa().estado));
  readonly etiqueta = computed(() => ETIQUETA_ESTADO[this.mesa().estado] ?? this.mesa().estado);

  /** Segundos en el estado actual, avanzando desde `desde` (o desde la llegada del plano). */
  readonly segundos = computed(() => {
    const m = this.mesa();
    const t = Date.parse(m.desde ?? '');
    if (!Number.isNaN(t)) return (this.ahora() - t) / 1000;
    return m.segundos_en_estado + (this.ahora() - this.recibidoEn()) / 1000;
  });
  readonly sinAtencion = computed(() => {
    const m = this.mesa();
    const t = Date.parse(m.ultimo_personal_en ?? '');
    if (!Number.isNaN(t)) return (this.ahora() - t) / 1000;
    return (m.segundos_sin_atencion ?? 0) + (this.ahora() - this.recibidoEn()) / 1000;
  });
  readonly tarde = computed(() => {
    const m = this.mesa();
    if (m.estado === 'OCUPADA') return !m.atendida && this.sinAtencion() >= this.minutosAviso() * 60;
    return false;
  });

  claseDe(e: EstadoMesa): string {
    return e === 'POR_LIMPIAR' ? 'limpiar' : e.toLowerCase();
  }
  etiquetaDe(e: EstadoMesa): string { return ETIQUETA_ESTADO[e]; }
  etiquetaAlerta(t: keyof typeof ETIQUETA_ALERTA): string { return ETIQUETA_ALERTA[t] ?? t; }
}
