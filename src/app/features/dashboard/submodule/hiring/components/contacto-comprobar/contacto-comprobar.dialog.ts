import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { take } from 'rxjs/operators';

import { SharedModule } from '@/app/shared/shared.module';
import { PlantillasCorreoService } from '../../../plantillas-correo/services/plantillas-correo.service';
import {
  PlantillaResumen, ResultadoEnvio,
} from '../../../plantillas-correo/models/plantilla-correo.model';

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
 *   - Correo: se manda DE VERDAD con una plantilla publicada, por el motor de
 *     Plantillas de correo (queda en el ledger y consume cuota). Solo si el
 *     envío responde `enviado` se marca como comprobado; si rebota, se dice
 *     por qué y NO se marca.
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
  private readonly plantillas = inject(PlantillasCorreoService);

  readonly urlPlataforma = URL_PLATAFORMA;

  // ── Correo ────────────────────────────────────────────────────────────────
  readonly cargandoPlantillas = signal(false);
  readonly disponibles = signal<PlantillaResumen[]>([]);
  readonly plantillaId = signal<string | null>(null);
  readonly enviando = signal(false);
  readonly resultado = signal<ResultadoEnvio | null>(null);
  readonly error = signal<string | null>(null);

  // ── WhatsApp ──────────────────────────────────────────────────────────────
  readonly password = signal<string>('');
  readonly mensaje = signal<string>('');
  readonly abierto = signal(false);

  constructor() {
    if (this.data.modo === 'correo') {
      this.cargarPlantillas();
    } else {
      this.password.set(this.data.password ?? '');
      this.mensaje.set(this.textoWhatsapp());
    }
  }

  /** Usuario con el que entra: su correo si lo tiene, si no su documento. */
  readonly usuario = computed(() =>
    this.data.modo === 'correo'
      ? (this.data.destino || this.data.cedula || '')
      : (this.data.cedula || ''));

  private cargarPlantillas(): void {
    this.cargandoPlantillas.set(true);
    this.plantillas.listar({ estado: 'PUBLICADA' }).pipe(take(1)).subscribe({
      next: (l) => {
        const lista = l ?? [];
        this.disponibles.set(lista);
        // Se preselecciona la destacada, que es la que el área marcó como la
        // de uso corriente; si no hay, la primera.
        this.plantillaId.set((lista.find((p) => p.destacada) ?? lista[0])?.id ?? null);
        this.cargandoPlantillas.set(false);
      },
      error: () => {
        this.error.set('No se pudieron cargar las plantillas de correo.');
        this.cargandoPlantillas.set(false);
      },
    });
  }

  elegirPlantilla(ev: Event): void {
    this.plantillaId.set((ev.target as HTMLSelectElement).value || null);
    this.resultado.set(null);
    this.error.set(null);
  }

  enviarCorreo(): void {
    const id = this.plantillaId();
    const destino = (this.data.destino ?? '').trim();
    if (!id || !destino || this.enviando()) return;

    this.enviando.set(true);
    this.error.set(null);
    this.resultado.set(null);

    // `clave` es la cédula: es con lo que la plantilla resuelve sus variables
    // contra el origen de datos, así que el correo sale con los datos de ESTA
    // persona y no con los de una prueba genérica.
    this.plantillas
      .enviarPrueba(id, { destinatario: destino, clave: this.data.cedula, borrador: false })
      .pipe(take(1))
      .subscribe({
        next: (r) => {
          this.enviando.set(false);
          this.resultado.set(r);
          if (!r?.enviado) {
            this.error.set(r?.mensaje || 'El proveedor no confirmó el envío.');
          }
        },
        error: (e: { error?: { error?: string; message?: string } }) => {
          this.enviando.set(false);
          this.error.set(e?.error?.error || e?.error?.message
            || 'No se pudo enviar. Revisa la cuenta remitente y su cuota.');
        },
      });
  }

  /** Solo se confirma con un envío que el proveedor dio por bueno. */
  readonly puedeConfirmarCorreo = computed(() => this.resultado()?.enviado === true);

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
    this.ref.close();
  }
}
