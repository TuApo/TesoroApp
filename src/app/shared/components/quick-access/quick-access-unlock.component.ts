import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, HostListener, ViewChild,
  inject, signal,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { SharedModule } from '../../shared.module';
import {
  CredencialesGuardadas, ErrorAccesoRapido, QuickAccessService,
} from '../../../core/security/quick-access.service';

export interface DatosUnlockAcceso {
  etiquetaUsuario: string;
  loginEnmascarado: string;
  intentosRestantes: number;
}

/**
 * Diálogo de PIN. Habla directamente con `QuickAccessService` para que el
 * usuario pueda reintentar sin que el diálogo se cierre y se vuelva a abrir,
 * y para que el PIN no viaje de vuelta al componente de login: lo único que
 * sale de aquí son las credenciales ya descifradas.
 *
 * Teclado propio en vez del teclado del sistema: en el APK evita el salto de
 * layout del teclado nativo y deja el PIN fuera del historial de autocompletado.
 * Aun así hay un campo real bajo los puntos, para que el teclado físico (o uno
 * externo en el móvil) escriba directo y Enter entre. En pantallas táctiles el
 * campo no toma el foco solo: el teclado del sistema aparece únicamente si el
 * usuario toca los puntos, y sale en modo numérico.
 */
@Component({
  selector: 'app-quick-access-unlock',
  standalone: true,
  imports: [SharedModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="qu-dialog">
      <div class="qu-avatar">{{ iniciales }}</div>
      <h2>Hola, {{ datos.etiquetaUsuario }}</h2>
      <p class="qu-sub">{{ datos.loginEnmascarado }}</p>
      <p class="qu-instr">Escribe tu PIN para entrar</p>

      <div class="qu-campo" (click)="enfocarCampo()">
        <input #campo class="qu-campo-input" type="text" inputmode="numeric"
               pattern="[0-9]*" enterkeyhint="go" maxlength="12" tabindex="-1"
               autocomplete="off" autocorrect="off" autocapitalize="off"
               spellcheck="false" aria-label="PIN" [value]="pin()"
               (input)="alEscribir($event)" (keydown)="alTeclearCampo($event)" />
        <div class="qu-puntos" [class.qu-puntos--error]="!!error()">
          @for (i of ranuras; track i) {
            @if (i < Math.max(4, pin().length)) {
              <span class="qu-punto" [class.qu-punto--on]="i < pin().length"></span>
            }
          }
        </div>
      </div>

      @if (error()) {
        <div class="qu-error">{{ error() }}</div>
      } @else {
        <div class="qu-hint">
          Quedan {{ intentos() }} {{ intentos() === 1 ? 'intento' : 'intentos' }}
        </div>
      }

      <div class="qu-teclado">
        @for (t of teclas; track t) {
          @if (t === 'x') {
            <button type="button" class="qu-tecla qu-tecla--acc" (click)="borrar()"
                    [disabled]="cargando()" aria-label="Borrar">
              <mat-icon>backspace</mat-icon>
            </button>
          } @else if (t === '') {
            <span class="qu-tecla qu-tecla--vacia"></span>
          } @else {
            <button type="button" class="qu-tecla" (click)="pulsar(t)" [disabled]="cargando()">
              {{ t }}
            </button>
          }
        }
      </div>

      <button mat-flat-button color="primary" class="qu-entrar" type="button"
              [disabled]="pin().length < 4 || cargando()" (click)="entrar()">
        {{ cargando() ? 'Verificando...' : 'Entrar' }}
      </button>

      <button mat-button type="button" class="qu-otra" (click)="cancelar()" [disabled]="cargando()">
        Usar mi contraseña
      </button>
    </div>
  `,
  styles: [`
    .qu-dialog { padding: 8px 4px 0; text-align: center; max-width: 340px; margin: 0 auto; }
    .qu-avatar {
      width: 60px; height: 60px; margin: 0 auto 12px; border-radius: 50%;
      background: linear-gradient(135deg, #1157FB, #4d8bff); color: #fff;
      display: flex; align-items: center; justify-content: center;
      font-size: 1.35rem; font-weight: 700; letter-spacing: .5px;
    }
    h2 { margin: 0; font-size: 1.1rem; font-weight: 700; }
    .qu-sub { margin: 2px 0 0; font-size: .82rem; color: #8a94a6; }
    .qu-instr { margin: 14px 0 10px; font-size: .88rem; color: #5a6472; }

    .qu-campo { position: relative; padding: 8px 0; margin-bottom: 4px; cursor: text; }
    /* Invisible y encima de los puntos: captura el teclado sin taparlos. */
    .qu-campo-input {
      position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%;
      opacity: 0; border: 0; padding: 0; background: none; text-align: center;
      color: transparent; caret-color: transparent;
      font-size: 16px; /* < 16px hace que iOS haga zoom al enfocar */
    }
    .qu-puntos { display: flex; justify-content: center; gap: 10px; min-height: 16px; }
    .qu-punto {
      width: 12px; height: 12px; border-radius: 50%; border: 1.5px solid #c3cbd8;
      transition: background .12s, border-color .12s, transform .12s;
    }
    .qu-punto--on { background: #1157FB; border-color: #1157FB; transform: scale(1.08); }
    .qu-puntos--error .qu-punto { border-color: #ef4444; }

    .qu-error { font-size: .78rem; color: #b91c1c; line-height: 1.4; min-height: 34px; padding: 0 4px; }
    .qu-hint { font-size: .74rem; color: #a0aab8; min-height: 34px; }

    .qu-teclado {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
      margin: 4px auto 16px; max-width: 260px;
    }
    .qu-tecla {
      height: 56px; border: none; border-radius: 14px; background: #f1f4f9;
      font-size: 1.3rem; font-weight: 600; color: #22303f; cursor: pointer;
      transition: background .12s, transform .08s;
    }
    .qu-tecla:hover:not(:disabled) { background: #e2e8f2; }
    .qu-tecla:active:not(:disabled) { transform: scale(.95); }
    .qu-tecla:disabled { opacity: .5; cursor: default; }
    .qu-tecla--acc { background: transparent; color: #5a6472; }
    .qu-tecla--vacia { background: transparent; }

    .qu-entrar { width: 100%; }
    .qu-otra { width: 100%; margin-top: 4px; font-size: .82rem; }
  `],
})
export class QuickAccessUnlockComponent implements AfterViewInit {
  private readonly ref = inject(MatDialogRef<QuickAccessUnlockComponent, CredencialesGuardadas | null>);
  private readonly qa = inject(QuickAccessService);
  readonly datos = inject<DatosUnlockAcceso>(MAT_DIALOG_DATA);

  @ViewChild('campo') private campo?: ElementRef<HTMLInputElement>;

  readonly Math = Math;
  readonly teclas = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'x'];
  /** Ranuras posibles del PIN (máx. 12); se pintan tantas como dígitos lleve. */
  readonly ranuras = Array.from({ length: 12 }, (_, i) => i);

  readonly pin = signal('');
  readonly error = signal('');
  readonly cargando = signal(false);
  readonly intentos = signal(this.datos.intentosRestantes);

  ngAfterViewInit(): void {
    // Sólo donde hay puntero fino (equipo con teclado): en táctil, enfocar aquí
    // abriría el teclado del sistema encima del diálogo. Va en `afterOpened`
    // porque el focus-trap del diálogo mueve el foco después de la animación.
    if (window.matchMedia?.('(pointer: fine)').matches) {
      this.ref.afterOpened().subscribe(() => this.campo?.nativeElement.focus());
    }
  }

  /** Toque sobre los puntos: en móvil abre el teclado numérico del sistema. */
  enfocarCampo(): void {
    if (!this.cargando()) this.campo?.nativeElement.focus();
  }

  /** Teclado del sistema (móvil) y teclado físico con el campo enfocado. */
  alEscribir(ev: Event): void {
    const el = ev.target as HTMLInputElement;
    if (this.cargando()) { el.value = this.pin(); return; }
    const limpio = el.value.replace(/\D+/g, '').slice(0, 12);
    // Rebota lo que no sea dígito o pase del máximo: el binding no lo haría
    // cuando el valor saneado coincide con el que ya tiene la señal.
    if (el.value !== limpio) el.value = limpio;
    this.error.set('');
    this.pin.set(limpio);
  }

  alTeclearCampo(ev: KeyboardEvent): void {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    this.entrar();
  }

  /**
   * Teclado físico cuando el foco no está en el campo (p. ej. tras pulsar una
   * tecla del teclado propio con el ratón).
   */
  @HostListener('document:keydown', ['$event'])
  alTeclearGlobal(ev: KeyboardEvent): void {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const destino = ev.target as HTMLElement | null;
    if (destino === this.campo?.nativeElement) return;

    if (ev.key === 'Enter') {
      // Un botón que no sea del teclado propio ya hace lo suyo con Enter.
      if (destino?.closest?.('button:not(.qu-tecla)')) return;
      ev.preventDefault();
      this.entrar();
      return;
    }
    if (this.cargando()) return;
    if (ev.key === 'Backspace' || ev.key === 'Delete') {
      ev.preventDefault();
      this.borrar();
      return;
    }
    if (ev.key.length === 1 && ev.key >= '0' && ev.key <= '9') {
      ev.preventDefault();
      this.pulsar(ev.key);
    }
  }

  pulsar(t: string): void {
    if (this.pin().length >= 12) return;
    this.error.set('');
    this.pin.update(v => v + t);
  }

  borrar(): void {
    this.error.set('');
    this.pin.update(v => v.slice(0, -1));
  }

  async entrar(): Promise<void> {
    if (this.pin().length < 4 || this.cargando()) return;
    this.cargando.set(true);
    this.error.set('');
    try {
      const credenciales = await this.qa.desbloquear(this.pin());
      this.ref.close(credenciales);
    } catch (e) {
      const err = e as ErrorAccesoRapido;
      this.pin.set('');
      this.error.set(err?.message ?? 'No se pudo verificar el PIN.');
      if (err?.codigo === 'bloqueado' || err?.codigo === 'sin-registro') {
        // El registro ya se destruyó: no tiene sentido dejar el diálogo abierto.
        setTimeout(() => this.ref.close(null), 2600);
        return;
      }
      this.intentos.set(err?.intentosRestantes ?? this.intentos());
    } finally {
      this.cargando.set(false);
    }
  }

  cancelar(): void {
    this.ref.close(null);
  }

  get iniciales(): string {
    const partes = (this.datos.etiquetaUsuario || '?').trim().split(/\s+/);
    return ((partes[0]?.[0] ?? '') + (partes[1]?.[0] ?? '')).toUpperCase() || '?';
  }
}
