import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { Canal } from '../../campo.models';
import { CampoApiService } from '../../services/campo-api.service';
import { CampoService, haceCuanto, mensajeDe } from '../../services/campo.service';
import { RadioService } from '../../services/radio.service';

/**
 * Radio de campo: elegir canal y mantener pulsado para hablar. En el escritorio también con
 * la barra espaciadora. Lo que llega suena solo; el historial queda para escuchar después.
 */
@Component({
  selector: 'app-campo-radio',
  standalone: true,
  imports: [MatIconModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../campo-ui.css'],
  styles: [`
    .radio { max-width: 720px; }
    .ptt-zona { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 24px 16px; }
    .ptt { width: min(58vw, 220px); aspect-ratio: 1; border-radius: 50%; border: 0; cursor: pointer; touch-action: none;
           background: radial-gradient(circle at 35% 30%, #4B5563, var(--navy)); color: #fff; display: grid; place-items: center;
           box-shadow: 0 10px 30px rgb(15 23 42 / .35), inset 0 -6px 0 rgb(0 0 0 / .25); user-select: none; -webkit-user-select: none;
           -webkit-touch-callout: none; transition: transform .08s; position: relative; }
    .ptt mat-icon { font-size: 72px; width: 72px; height: 72px; }
    .ptt.activo { background: radial-gradient(circle at 35% 30%, #F87171, #B91C1C); transform: scale(.96); }
    .ptt:disabled { opacity: .5; }
    .anillo { position: absolute; inset: -10px; border-radius: 50%; border: 6px solid #F87171; opacity: .6; pointer-events: none; }
    .estado { font: 700 16px var(--font-sans); min-height: 22px; text-align: center; }
    .hablando { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 14px; background: var(--info-bg); color: var(--brand-blue); font-weight: 700; }
    .ondas { display: inline-flex; gap: 3px; align-items: flex-end; height: 18px; }
    .ondas i { width: 4px; background: currentColor; border-radius: 2px; animation: onda .9s ease-in-out infinite; }
    .ondas i:nth-child(2) { animation-delay: .15s } .ondas i:nth-child(3) { animation-delay: .3s }
    @keyframes onda { 0%,100% { height: 4px } 50% { height: 18px } }
    .tx .cuerpo small { display: flex; gap: 6px; align-items: center; }
  `],
  template: `
    <div class="pagina radio">
      <header class="cabecera">
        <a class="boton chico" routerLink="/dashboard/coordinadores" aria-label="Volver"><mat-icon>arrow_back</mat-icon></a>
        <h1>Radio de campo</h1>
        <button type="button" class="boton chico" (click)="radio.alternarAuto()" [attr.aria-pressed]="radio.autoReproducir()">
          <mat-icon>{{ radio.autoReproducir() ? 'volume_up' : 'volume_off' }}</mat-icon> {{ radio.autoReproducir() ? 'Suena solo' : 'Silenciada' }}
        </button>
      </header>

      @if (canales().length) {
        <nav class="pestanas" aria-label="Canales">
          @for (c of canales(); track c.id) {
            <button type="button" [class.activa]="c.id === radio.canalId()" (click)="radio.cambiarCanal(c.id)">
              {{ c.nombre }} · {{ c.en_linea }}/{{ c.miembros }}
            </button>
          }
        </nav>
      } @else if (!cargando()) {
        <div class="tarjeta vacio"><mat-icon>settings_input_antenna</mat-icon>
          <span>{{ campo.enLinea() ? 'Aún no estás en ningún canal de radio.' : 'Sin señal y sin canales guardados: conéctate una vez para tenerlos.' }}</span>
          @if (campo.perfil() === 'ADMIN') {
            <button type="button" class="boton primario" (click)="crearGeneral()">Crear canal "Todo el equipo"</button>
          }
        </div>
      }
      @if (error()) { <p class="chip mal">{{ error() }}</p> }

      @if (radio.canalId() != null) {
        <section class="tarjeta ptt-zona">
          @if (radio.hablando(); as t) {
            <div class="hablando"><span class="ondas"><i></i><i></i><i></i></span> {{ t.autorNombre }} está hablando</div>
          }
          <button type="button" class="ptt" [class.activo]="radio.grabando()" aria-label="Mantén pulsado para hablar"
                  (pointerdown)="hablar($event)" (pointerup)="callar()" (pointerleave)="callar()" (pointercancel)="callar()"
                  (contextmenu)="$event.preventDefault()">
            @if (radio.grabando()) { <span class="anillo" [style.transform]="'scale(' + (1 + radio.nivel() * 0.25) + ')'"></span> }
            <mat-icon>{{ radio.grabando() ? 'mic' : 'mic_none' }}</mat-icon>
          </button>
          <div class="estado">{{ estado() }}</div>
          <small class="chip" [class.ok]="campo.enLinea()" [class.aviso]="!campo.enLinea()">
            {{ campo.enLinea() ? 'Con señal: se escucha al instante' : 'Sin señal: se envía al volver la conexión' }}
          </small>
          @if (radio.error()) { <p class="chip mal">{{ radio.error() }}</p> }
          <small class="ayuda">Mantén pulsado para hablar · en el computador, mantén la barra espaciadora</small>
        </section>

        <section class="tarjeta">
          <h2><mat-icon>history</mat-icon> Últimas transmisiones</h2>
          <ul class="lista">
            @for (t of radio.historial(); track t.id) {
              <li class="fila clic tx" (click)="radio.reproducir(t)" (keydown.enter)="radio.reproducir(t)" tabindex="0">
                <span class="avatar" [style.background]="t.mia ? 'var(--lime)' : 'var(--navy)'" [style.color]="t.mia ? 'var(--ink)' : '#fff'">
                  <mat-icon>{{ radio.hablando()?.id === t.id ? 'graphic_eq' : 'play_arrow' }}</mat-icon>
                </span>
                <span class="cuerpo">
                  <strong>{{ t.mia ? 'Tú' : t.autorNombre }}</strong>
                  <small>{{ hace(t.creadoMs) }} · {{ segundos(t.duracionMs) }}
                    @if (t.enCola) { <span class="chip aviso">por enviar</span> }
                    @if (t.tarde) { <span class="chip">grabado sin señal</span> }
                  </small>
                </span>
              </li>
            } @empty {
              <li class="vacio"><mat-icon>graphic_eq</mat-icon> Nada todavía en este canal</li>
            }
          </ul>
        </section>
      }
    </div>
  `,
})
export class RadioComponent {
  readonly campo = inject(CampoService);
  readonly radio = inject(RadioService);
  private readonly api = inject(CampoApiService);
  private readonly destroy = inject(DestroyRef);

  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  private readonly canalesRed = signal<Canal[] | null>(null);
  readonly canales = computed<Canal[]>(() => this.canalesRed() ?? this.campo.paquete()?.canales ?? []);
  private teclaAbajo = false;

  readonly estado = computed(() => this.radio.grabando() ? 'Hablando… suelta para enviar' : 'Mantén pulsado para hablar');

  constructor() {
    this.campo.iniciar();
    this.radio.escuchar();
    void this.cargar();
    // Sin canal elegido: el primero disponible.
    effect(() => {
      const l = this.canales();
      if (l.length && (this.radio.canalId() == null || !l.some(c => c.id === this.radio.canalId()))) this.radio.cambiarCanal(l[0].id);
    });
    this.destroy.onDestroy(() => { void this.radio.soltar(); this.radio.soltarMicrofono(); });
  }

  private async cargar(): Promise<void> {
    await this.campo.esperar();
    if (this.campo.enLinea()) {
      try { this.canalesRed.set(await firstValueFrom(this.api.canales())); } catch { /* quedan los del paquete */ }
    }
    this.cargando.set(false);
  }

  async crearGeneral(): Promise<void> {
    try {
      const c = await firstValueFrom(this.api.crearCanal({ nombre: 'Todo el equipo', alcance: 'TODOS' }));
      this.canalesRed.update(l => [...(l ?? []), c]);
      this.radio.cambiarCanal(c.id);
    } catch (e) {
      this.error.set(mensajeDe(e, 'No se pudo crear el canal'));
    }
  }

  hablar(e: PointerEvent): void {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    void this.radio.presionar();
  }

  callar(): void { void this.radio.soltar(); }

  @HostListener('window:keydown', ['$event'])
  teclaPresionada(e: KeyboardEvent): void {
    if (e.code !== 'Space' || this.teclaAbajo || esCampoDeTexto(e.target)) return;
    e.preventDefault();
    this.teclaAbajo = true;
    void this.radio.presionar();
  }

  @HostListener('window:keyup', ['$event'])
  teclaSoltada(e: KeyboardEvent): void {
    if (e.code !== 'Space' || !this.teclaAbajo) return;
    this.teclaAbajo = false;
    void this.radio.soltar();
  }

  hace(ms: number): string { return haceCuanto(ms); }

  segundos(ms: number | null): string { return ms ? `${Math.max(1, Math.round(ms / 1000))} s` : 'audio'; }
}

function esCampoDeTexto(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

