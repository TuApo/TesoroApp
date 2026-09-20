import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { take } from 'rxjs/operators';

import { SharedModule } from '@/app/shared/shared.module';
import {
  ComprobacionCorreoService, EstadoComprobacionCorreo,
} from '../../service/comprobacion-correo/comprobacion-correo.service';

export interface ContactoComprobarData {
  modo: 'correo' | 'whatsapp';
  nombre: string | null;
  cedula: string | null;
  /** Correo o número al que se va a escribir. */
  destino: string | null;
  /** Contraseña ya registrada, si la hay. */
  password: string | null;
}

/** El diálogo solo cierra en `true` cuando la comprobación salió bien. */
export type ContactoComprobarResultado = { confirmado: true } | undefined;

/** Dónde entra la gente. Se escribe una vez y viaja en los dos mensajes. */
const URL_PLATAFORMA = 'https://tesoro.tuapo.co';

/**
 * Comprobar que el correo y el WhatsApp de la persona EXISTEN.
 *
 * Antes esto era un `Swal` con un textarea que no enviaba nada: se escribía un
 * mensaje, se pulsaba "Confirmar" y el contacto quedaba marcado como
 * comprobado sin que saliera un solo correo. O sea, se comprobaba la intención
 * del operador, no el contacto de la persona.
 *
 *   - Correo (2026-09-16, sin plantilla): se le manda un correo con un CÓDIGO
 *     de 6 dígitos y un BOTÓN. Queda comprobado si quien contrata teclea el
 *     código que la persona le dicta, o si la persona pulsa el botón (el
 *     diálogo lo detecta solo). Las dos vías marcan la ficha en el backend.
 *   - WhatsApp: se arma el mensaje con el enlace de ingreso, el usuario y la
 *     contraseña, y se abre WhatsApp con el texto puesto. Marcar queda a un
 *     paso aparte, porque quien sabe si el mensaje llegó es quien lo mandó.
 */
@Component({
  selector: 'app-contacto-comprobar-dialog',
  standalone: true,
  imports: [SharedModule, MatDialogModule, MatIconModule],
  templateUrl: './contacto-comprobar.dialog.html',
  styleUrls: ['./contacto-comprobar.dialog.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContactoComprobarDialogComponent {
  readonly data = inject<ContactoComprobarData>(MAT_DIALOG_DATA);
  private readonly ref =
    inject<MatDialogRef<ContactoComprobarDialogComponent, ContactoComprobarResultado>>(MatDialogRef);
  private readonly comprobacion = inject(ComprobacionCorreoService);

  readonly urlPlataforma = URL_PLATAFORMA;

  // ── Correo ────────────────────────────────────────────────────────────────
  readonly enviando = signal(false);
  readonly verificando = signal(false);
  /** Último correo enviado y su estado. `null` = todavía no se ha enviado. */
  readonly estado = signal<EstadoComprobacionCorreo | null>(null);
  readonly codigo = signal('');
  readonly error = signal<string | null>(null);
  /** Consulta periódica: detecta cuando la persona pulsa el botón del correo. */
  private sondeo: ReturnType<typeof setInterval> | null = null;

  // ── WhatsApp ──────────────────────────────────────────────────────────────
  readonly password = signal<string>('');
  readonly mensaje = signal<string>('');
  readonly abierto = signal(false);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.pararSondeo());
    if (this.data.modo !== 'correo') {
      this.password.set(this.data.password ?? '');
      this.mensaje.set(this.textoWhatsapp());
    }
  }

  /** Usuario con el que entra: su correo si lo tiene, si no su documento. */
  readonly usuario = computed(() =>
    this.data.modo === 'correo'
      ? (this.data.destino || this.data.cedula || '')
      : (this.data.cedula || ''));

  enviarCorreo(): void {
    const destino = (this.data.destino ?? '').trim();
    const cedula = (this.data.cedula ?? '').trim();
    if (!destino || !cedula || this.enviando()) return;

    this.enviando.set(true);
    this.error.set(null);
    this.codigo.set('');
    this.comprobacion.enviar(cedula, destino).pipe(take(1)).subscribe({
      next: (e) => {
        this.enviando.set(false);
        this.estado.set(e);
        this.iniciarSondeo();
      },
      error: (e: { error?: { mensaje?: string; error?: string } }) => {
        this.enviando.set(false);
        this.error.set(e?.error?.mensaje || e?.error?.error
          || 'No se pudo enviar el correo. Revisa la cuenta remitente y su cuota.');
      },
    });
  }

  alEscribirCodigo(ev: Event): void {
    this.codigo.set((ev.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6));
    this.error.set(null);
  }

  verificarCodigo(): void {
    const e = this.estado();
    if (!e || this.codigo().length !== 6 || this.verificando()) return;
    this.verificando.set(true);
    this.error.set(null);
    this.comprobacion.verificar(e.id, this.codigo()).pipe(take(1)).subscribe({
      next: (r) => {
        this.verificando.set(false);
        this.estado.set(r);
        if (r.confirmado) this.pararSondeo();
      },
      error: (err: { error?: { mensaje?: string } }) => {
        this.verificando.set(false);
        this.error.set(err?.error?.mensaje || 'No se pudo verificar el código.');
      },
    });
  }

  /** Cada 5 s mientras el diálogo está abierto y falta confirmar. */
  private iniciarSondeo(): void {
    this.pararSondeo();
    this.sondeo = setInterval(() => {
      const e = this.estado();
      if (!e || e.confirmado || !e.vigente) { this.pararSondeo(); return; }
      this.comprobacion.estado(e.id).pipe(take(1)).subscribe({
        next: (r) => {
          this.estado.set(r);
          if (r.confirmado || !r.vigente) this.pararSondeo();
        },
        error: () => { /* un fallo de red puntual no corta la espera */ },
      });
    }, 5000);
  }

  private pararSondeo(): void {
    if (this.sondeo) clearInterval(this.sondeo);
    this.sondeo = null;
  }

  /** Solo se marca con el código correcto o con el botón del correo pulsado. */
  readonly puedeConfirmarCorreo = computed(() => this.estado()?.confirmado === true);

  // ── WhatsApp ──────────────────────────────────────────────────────────────
  private textoWhatsapp(): string {
    const nombre = (this.data.nombre ?? '').trim();
    const clave = this.password().trim();
    const partes = [
      `Hola${nombre ? ' ' + nombre : ''}, te damos la bienvenida al equipo.`,
      '',
      'Para entrar a la plataforma:',
      URL_PLATAFORMA,
      `Usuario: ${this.data.destino && this.data.modo === 'correo' ? this.data.destino : (this.data.cedula || '—')}`,
    ];
    // Sin contraseña NO se inventa una: se le dice cómo obtenerla. Mandar una
    // que no funciona es peor que no mandar ninguna.
    partes.push(clave
      ? `Contraseña: ${clave}`
      : 'Contraseña: usa "¿Olvidaste tu contraseña?" en esa página para crearla con tu documento.');
    partes.push('', 'Por favor confírmanos que recibiste este mensaje.');
    return partes.join('\n');
  }

  alEscribirPassword(ev: Event): void {
    this.password.set((ev.target as HTMLInputElement).value);
    this.mensaje.set(this.textoWhatsapp());
  }

  alEscribirMensaje(ev: Event): void {
    this.mensaje.set((ev.target as HTMLTextAreaElement).value);
  }

  /** Solo dígitos: `wa.me` no acepta espacios ni guiones. */
  private numeroLimpio(): string {
    const n = (this.data.destino ?? '').replace(/\D/g, '');
    // Colombia: los diez dígitos locales necesitan el indicativo.
    return n.length === 10 ? `57${n}` : n;
  }

  abrirWhatsapp(): void {
    const n = this.numeroLimpio();
    if (!n) return;
    window.open(`https://wa.me/${n}?text=${encodeURIComponent(this.mensaje())}`, '_blank', 'noopener');
    this.abierto.set(true);
  }

  confirmar(): void {
    this.ref.close({ confirmado: true });
  }

  cerrar(): void {
    // Si la persona ya confirmó (botón del correo), la ficha está marcada en el backend:
    // cerrar con `confirmado` hace que el pipeline lo refleje aunque se pulse Cancelar.
    this.ref.close(this.puedeConfirmarCorreo() ? { confirmado: true } : undefined);
  }
}
