import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { mensajeDeError } from '../../../shared/utils/mensaje-error';
import { SgImagen } from '../../dashboard/submodule/seguridad/components/imagen-segura/imagen-segura';
import { AccionAcuse, Acuse, ESTADOS_ACTIVOS, NOMBRE_ESTADO_INCIDENTE, NOMBRE_SEVERIDAD } from '../../dashboard/submodule/seguridad/models/seguridad.models';
import { SeguridadPublicoService } from '../../dashboard/submodule/seguridad/services/seguridad-publico.service';
import { fechaHora, hace, tonoSeveridad } from '../../dashboard/submodule/seguridad/utils/formato';

/**
 * El enlace que llega en el mensaje de una alarma (Telegram, correo, WhatsApp). Sin sesión:
 * el token firmado identifica al contacto y al incidente. Muestra qué pasó y la captura, y
 * tres botones grandes: "Recibido, voy", "Lo estoy viendo" y "Falsa alarma". Cualquiera de
 * los dos primeros detiene el escalamiento y queda en la bitácora con el nombre del contacto.
 */
@Component({
  selector: 'app-acuse-alarma',
  standalone: true,
  imports: [FormsModule, MatIconModule, SgImagen],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './acuse.html',
  styleUrls: ['../../dashboard/submodule/seguridad/styles/seguridad-comun.css', './acuse.css'],
})
export class AcuseAlarma implements OnInit {
  readonly token = input.required<string>();
  private readonly api = inject(SeguridadPublicoService);

  readonly acuse = signal<Acuse | null>(null);
  readonly error = signal<string | null>(null);
  readonly enviando = signal<AccionAcuse | null>(null);
  readonly respuesta = signal<{ ok: boolean; mensaje: string } | null>(null);
  readonly confirmarFalsa = signal(false);
  nota = '';

  readonly nombreSev = NOMBRE_SEVERIDAD;
  readonly nombreEstado = NOMBRE_ESTADO_INCIDENTE;
  readonly f = { fechaHora, hace, tonoSeveridad };
  readonly captura = computed(() => (this.acuse()?.captura_url ? this.api.urlCapturaAcuse(this.token()) : null));
  readonly activa = computed(() => { const a = this.acuse(); return !!a && ESTADOS_ACTIVOS.includes(a.incidente.estado); });

  ngOnInit(): void { this.cargar(); }

  cargar(): void {
    this.api.acuse(this.token()).subscribe({
      next: (a) => { this.acuse.set(a); this.error.set(null); },
      error: (e) => {
        const st = (e as { status?: number })?.status;
        this.error.set(st === 401 || st === 403 || st === 404 || st === 410
          ? 'Este enlace no es válido o ya venció. Si la alarma sigue activa, comuníquese con el centro de monitoreo.'
          : mensajeDeError(e, 'No se pudo abrir la alarma. Revise la conexión e intente de nuevo.'));
      },
    });
  }

  async responder(accion: AccionAcuse): Promise<void> {
    if (accion === 'FALSA_ALARMA' && !this.confirmarFalsa()) { this.confirmarFalsa.set(true); return; }
    this.enviando.set(accion);
    this.respuesta.set(null);
    try {
      const r = await firstValueFrom(this.api.responderAcuse(this.token(), accion, this.nota.trim() || null));
      this.respuesta.set({ ok: r.ok, mensaje: r.mensaje || (r.ok ? 'Listo: quedó registrado.' : 'No se pudo registrar.') });
      this.confirmarFalsa.set(false);
      this.cargar();
    } catch (e) {
      this.respuesta.set({ ok: false, mensaje: mensajeDeError(e, 'No se pudo enviar la respuesta. Intente de nuevo.') });
    } finally { this.enviando.set(null); }
  }
}
