import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
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

      <div class="qu-puntos" [class.qu-puntos--error]="!!error()">
        @for (i of ranuras; track i) {
          @if (i < Math.max(4, pin().length)) {
            <span class="qu-punto" [class.qu-punto--on]="i < pin().length"></span>
          }
        }
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

    .qu-puntos { display: flex; justify-content: center; gap: 10px; min-height: 16px; margin-bottom: 8px; }
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
export class QuickAccessUnlockComponent {
  private readonly ref = inject(MatDialogRef<QuickAccessUnlockComponent, CredencialesGuardadas | null>);
  private readonly qa = inject(QuickAccessService);
  readonly datos = inject<DatosUnlockAcceso>(MAT_DIALOG_DATA);

  readonly Math = Math;
  readonly teclas = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'x'];
  /** Ranuras posibles del PIN (máx. 12); se pintan tantas como dígitos lleve. */
  readonly ranuras = Array.from({ length: 12 }, (_, i) => i);

  readonly pin = signal('');
  readonly error = signal('');
  readonly cargando = signal(false);
  readonly intentos = signal(this.datos.intentosRestantes);

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
