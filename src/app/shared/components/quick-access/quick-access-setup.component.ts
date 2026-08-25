import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { SharedModule } from '../../shared.module';
import { MetodoAcceso, DIAS_VIGENCIA } from '../../../core/security/quick-access.service';

export interface DatosSetupAcceso {
  metodos: MetodoAcceso[];
  etiquetaBiometria: string;
  etiquetaUsuario: string;
}

export interface ResultadoSetupAcceso {
  metodo: MetodoAcceso;
  pin?: string;
}

interface OpcionMetodo {
  metodo: MetodoAcceso;
  icono: string;
  titulo: string;
  detalle: string;
  nivel: 'alto' | 'medio';
}

/**
 * Diálogo para activar el acceso rápido: el usuario elige CÓMO quiere volver a
 * entrar. Se muestra una sola vez tras un login correcto, y se puede rehacer
 * desde Configuración → Cuenta.
 */
@Component({
  selector: 'app-quick-access-setup',
  standalone: true,
  imports: [SharedModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="qa-dialog">
      <div class="qa-head">
        <mat-icon class="qa-head-icon">lock_open</mat-icon>
        <div>
          <h2>Entrar más rápido la próxima vez</h2>
          <p>
            Guardamos tus datos <b>cifrados y solo en este dispositivo</b>.
            Elige cómo quieres desbloquear.
          </p>
        </div>
      </div>

      <div class="qa-opciones">
        @for (op of opciones(); track op.metodo) {
          <button type="button" class="qa-opcion"
                  [class.qa-opcion--sel]="metodo() === op.metodo"
                  (click)="elegir(op.metodo)">
            <mat-icon>{{ op.icono }}</mat-icon>
            <span class="qa-op-txt">
              <span class="qa-op-titulo">
                {{ op.titulo }}
                <span class="qa-badge" [class.qa-badge--medio]="op.nivel === 'medio'">
                  {{ op.nivel === 'alto' ? 'Más seguro' : 'Menos seguro' }}
                </span>
              </span>
              <span class="qa-op-detalle">{{ op.detalle }}</span>
            </span>
            <mat-icon class="qa-check">{{ metodo() === op.metodo ? 'radio_button_checked' : 'radio_button_unchecked' }}</mat-icon>
          </button>
        }
      </div>

      @if (metodo() === 'pin') {
        <div class="qa-pin">
          <mat-form-field appearance="outline" class="qa-campo">
            <mat-label>PIN (4 a 12 dígitos)</mat-label>
            <input matInput [type]="verPin() ? 'text' : 'password'" inputmode="numeric"
                   autocomplete="off" maxlength="12" [(ngModel)]="pin" name="pin" />
            <button mat-icon-button matSuffix type="button" (click)="verPin.set(!verPin())"
                    aria-label="Mostrar u ocultar el PIN">
              <mat-icon>{{ verPin() ? 'visibility' : 'visibility_off' }}</mat-icon>
            </button>
          </mat-form-field>

          <mat-form-field appearance="outline" class="qa-campo">
            <mat-label>Repite el PIN</mat-label>
            <input matInput [type]="verPin() ? 'text' : 'password'" inputmode="numeric"
                   autocomplete="off" maxlength="12" [(ngModel)]="pin2" name="pin2" />
          </mat-form-field>
        </div>
      }

      @if (metodo() === 'dispositivo') {
        <div class="qa-aviso">
          <mat-icon>warning</mat-icon>
          <span>
            Cualquiera que use este dispositivo podrá entrar a tu cuenta sin pedir nada.
            Úsalo solo en un equipo personal con contraseña de bloqueo.
          </span>
        </div>
      }

      @if (error()) {
        <div class="qa-error"><mat-icon>error_outline</mat-icon><span>{{ error() }}</span></div>
      }

      <p class="qa-nota">
        Caduca a los {{ diasVigencia() }} días sin usarse y se borra solo tras 5 intentos
        fallidos. Puedes desactivarlo cuando quieras desde Configuración → Cuenta.
      </p>

      <div class="qa-acciones">
        <button mat-button type="button" (click)="cancelar()">Ahora no</button>
        <button mat-flat-button color="primary" type="button" (click)="confirmar()">
          Activar acceso rápido
        </button>
      </div>
    </div>
  `,
  styles: [`
    .qa-dialog { padding: 4px 4px 0; max-width: 520px; }
    .qa-head { display: flex; gap: 14px; align-items: flex-start; margin-bottom: 18px; }
    .qa-head-icon {
      font-size: 32px; width: 32px; height: 32px; color: #1157FB; flex: 0 0 auto; margin-top: 2px;
    }
    .qa-head h2 { margin: 0 0 4px; font-size: 1.15rem; font-weight: 700; }
    .qa-head p { margin: 0; font-size: .88rem; color: #5a6472; line-height: 1.45; }

    .qa-opciones { display: flex; flex-direction: column; gap: 10px; }
    .qa-opcion {
      display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
      padding: 12px 14px; border: 1.5px solid #dfe4ec; border-radius: 12px;
      background: #fff; cursor: pointer; transition: border-color .15s, background .15s;
    }
    .qa-opcion:hover { border-color: #b9c6da; background: #f8fafd; }
    .qa-opcion--sel { border-color: #1157FB; background: #eef5ff; }
    .qa-opcion > mat-icon { color: #1157FB; flex: 0 0 auto; }
    .qa-op-txt { display: flex; flex-direction: column; gap: 2px; flex: 1 1 auto; min-width: 0; }
    .qa-op-titulo { font-weight: 600; font-size: .95rem; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .qa-op-detalle { font-size: .8rem; color: #667085; line-height: 1.35; }
    .qa-badge {
      font-size: .66rem; font-weight: 700; letter-spacing: .3px; text-transform: uppercase;
      padding: 2px 7px; border-radius: 20px; background: #dcfce7; color: #166534;
    }
    .qa-badge--medio { background: #fef3c7; color: #92400e; }
    .qa-check { color: #1157FB; flex: 0 0 auto; }

    .qa-pin { display: flex; gap: 12px; margin-top: 16px; flex-wrap: wrap; }
    .qa-campo { flex: 1 1 200px; }

    .qa-aviso, .qa-error {
      display: flex; gap: 10px; align-items: flex-start; margin-top: 14px;
      padding: 10px 12px; border-radius: 10px; font-size: .82rem; line-height: 1.4;
    }
    .qa-aviso { background: #fffbeb; color: #92400e; }
    .qa-error { background: #fef2f2; color: #b91c1c; }
    .qa-aviso mat-icon, .qa-error mat-icon { font-size: 20px; width: 20px; height: 20px; }

    .qa-nota { margin: 16px 0 0; font-size: .76rem; color: #8a94a6; line-height: 1.45; }
    .qa-acciones { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }

    @media (max-width: 520px) {
      .qa-head h2 { font-size: 1.02rem; }
      .qa-acciones { flex-direction: column-reverse; }
      .qa-acciones button { width: 100%; }
    }
  `],
})
export class QuickAccessSetupComponent {
  private readonly ref = inject(MatDialogRef<QuickAccessSetupComponent, ResultadoSetupAcceso | null>);
  readonly datos = inject<DatosSetupAcceso>(MAT_DIALOG_DATA);

  readonly metodo = signal<MetodoAcceso>(this.datos.metodos[0] ?? 'pin');
  readonly error = signal('');
  readonly verPin = signal(false);
  pin = '';
  pin2 = '';

  readonly opciones = signal<OpcionMetodo[]>(
    this.datos.metodos.map(m => this.describir(m)),
  );

  diasVigencia(): number {
    return DIAS_VIGENCIA[this.metodo()];
  }

  private describir(metodo: MetodoAcceso): OpcionMetodo {
    switch (metodo) {
      case 'biometria':
        return {
          metodo,
          icono: 'fingerprint',
          titulo: 'Huella o rostro',
          detalle: this.datos.etiquetaBiometria
            || 'Desbloquea con la biometría que ya usas en este dispositivo.',
          nivel: 'alto',
        };
      case 'pin':
        return {
          metodo,
          icono: 'pin',
          titulo: 'PIN de acceso',
          detalle: 'Un PIN corto solo para esta app. No es tu contraseña.',
          nivel: 'alto',
        };
      default:
        return {
          metodo,
          icono: 'devices',
          titulo: 'Solo este dispositivo',
          detalle: 'Entra de una vez, sin escribir nada. Cómodo, pero sin candado propio.',
          nivel: 'medio',
        };
    }
  }

  elegir(metodo: MetodoAcceso): void {
    this.metodo.set(metodo);
    this.error.set('');
  }

  confirmar(): void {
    const metodo = this.metodo();
    if (metodo === 'pin') {
      const pin = (this.pin ?? '').trim();
      if (!/^\d{4,12}$/.test(pin)) {
        this.error.set('El PIN debe tener entre 4 y 12 dígitos.');
        return;
      }
      if (pin !== (this.pin2 ?? '').trim()) {
        this.error.set('Los dos PIN no coinciden.');
        return;
      }
      if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) {
        this.error.set('Ese PIN es demasiado fácil de adivinar. Elige otro.');
        return;
      }
      this.ref.close({ metodo, pin });
      return;
    }
    this.ref.close({ metodo });
  }

  cancelar(): void {
    this.ref.close(null);
  }
}
