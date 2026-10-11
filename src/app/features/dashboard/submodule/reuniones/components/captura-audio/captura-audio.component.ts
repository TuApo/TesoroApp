import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { GrabadorService } from '../../services/grabador.service';
import { ReunionUploadService } from '../../services/reunion-upload.service';
import { reloj } from '../../utils/tiempo';
import { mensajeError } from '../../utils/texto';

/**
 * Grabar la reunión aquí mismo o subir el audio. Reutiliza `GrabadorService` (sube un
 * trozo cada 15 s mientras se graba) y `ReunionUploadService` (subida por partes,
 * reanudable). Avisa con `grabacionCreada` cuando el servidor ya tiene la grabación.
 *
 * `compacto` es la versión de la pestaña Detalles (agregar otra grabación); la grande
 * es el estado vacío de una reunión sin audio.
 */
@Component({
  selector: 'app-reu-captura',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './captura-audio.component.html',
  styleUrls: ['../../estilos/base.css', './captura-audio.component.css'],
})
export class CapturaAudioComponent {
  readonly grabador = inject(GrabadorService);
  readonly subidas = inject(ReunionUploadService);

  readonly reunionId = input.required<string>();
  readonly compacto = input(false);
  readonly grabacionCreada = output<string>();

  readonly motivoNoGraba = GrabadorService.motivoNoSoportado();
  readonly error = signal('');

  readonly grabando = computed(() => {
    const f = this.grabador.estado().fase;
    return f === 'preparando' || f === 'grabando' || f === 'pausado' || f === 'finalizando';
  });
  readonly subiendo = computed(() => {
    const f = this.subidas.estado().fase;
    return f === 'iniciando' || f === 'subiendo' || f === 'ensamblando';
  });

  readonly reloj = reloj;

  async grabar(conVideo = false): Promise<void> {
    this.error.set('');
    try {
      await this.grabador.iniciar(this.reunionId(), conVideo);
    } catch (e) {
      this.error.set((e as Error)?.message || 'No se pudo empezar a grabar.');
    }
  }

  async finalizar(): Promise<void> {
    this.error.set('');
    try {
      const id = await this.grabador.finalizar();
      this.grabacionCreada.emit(id);
    } catch (e) {
      this.error.set(mensajeError(e, 'No se pudo guardar la grabación'));
    }
  }

  async descartar(): Promise<void> {
    await this.grabador.cancelar().catch(() => undefined);
  }

  async elegirArchivo(evento: Event): Promise<void> {
    const entrada = evento.target as HTMLInputElement;
    const archivo = entrada.files?.[0];
    if (!archivo) return;
    this.error.set('');
    try {
      const id = await this.subidas.subir(this.reunionId(), archivo);
      entrada.value = '';
      this.grabacionCreada.emit(id);
    } catch (e) {
      entrada.value = '';
      if ((e as Error)?.message !== 'Subida pausada') {
        this.error.set(mensajeError(e, 'No se pudo subir la grabación'));
      }
    }
  }
}
