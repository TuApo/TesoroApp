import { ChangeDetectionStrategy, Component, inject, input, output, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { TiendaService, VerificacionResumen } from '../../dashboard/submodule/tienda/service/tienda.service';
import {
  CONSENTIMIENTO_VERSION, TEXTO_AUTORIZA_TERCERO, TEXTO_TITULAR, huellaDelTexto,
} from '../consentimiento-biometrico';
import { mensajeError } from '../economia.util';
import { CapturaRostro, EcoCapturaRostro, reducir } from './eco-captura-rostro';

type Paso = 'consentimiento' | 'selfie' | 'verificando' | 'resultado' | 'tercero' | 'enviando' | 'listo';
type Foto = 'rostro' | 'cedula_frente' | 'cedula_reverso';

/**
 * Autorizar a otra persona a reclamar un pedido, bono o servicio.
 *
 * <p>Tres pasos, en este orden y sin atajos:
 * <ol>
 *   <li>El titular acepta el tratamiento de su dato biométrico (texto versionado; se envía
 *       el sha256 del texto exacto que vio). Si no acepta, se le dice cómo hacerlo en persona.</li>
 *   <li>Se toma una selfie con prueba de vida y el servidor la compara con su foto de
 *       contratación. Solo si coincide sigue.</li>
 *   <li>Registra a la persona (nombre, cédula, foto de su cara y de la cédula por ambos lados)
 *       y declara que esos datos son de ella y que tiene su permiso. Los archivos van al
 *       servidor, que guarda el sha256 de cada uno: esa es la evidencia del descuento.</li>
 * </ol>
 */
@Component({
  selector: 'eco-autorizar-tercero',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule, EcoCapturaRostro],
  templateUrl: './eco-autorizar-tercero.html',
  styleUrls: ['../economiapp.css', './eco-autorizar-tercero.css'],
})
export class EcoAutorizarTercero {
  private api = inject(TiendaService);

  readonly pedidoId = input.required<string>();
  readonly listo = output<void>();
  readonly cancelar = output<void>();

  readonly TEXTO_TITULAR = TEXTO_TITULAR;
  readonly TEXTO_AUTORIZA_TERCERO = TEXTO_AUTORIZA_TERCERO;

  readonly paso = signal<Paso>('consentimiento');
  readonly aceptaBiometria = signal(false);
  readonly aceptaDeclaracion = signal(false);
  readonly verificacion = signal<VerificacionResumen | null>(null);
  readonly error = signal<string | null>(null);

  readonly nombre = signal('');
  readonly cedula = signal('');
  readonly telefono = signal('');
  readonly parentesco = signal('');
  readonly fotos = signal<Record<Foto, Blob | null>>({ rostro: null, cedula_frente: null, cedula_reverso: null });
  readonly vistas = signal<Record<Foto, string | null>>({ rostro: null, cedula_frente: null, cedula_reverso: null });
  readonly tomandoRostro = signal(false);

  readonly completo = computed(() => {
    const f = this.fotos();
    return !!(this.nombre().trim() && this.cedula().trim() && f.rostro && f.cedula_frente && f.cedula_reverso
      && this.aceptaDeclaracion());
  });

  async conSelfie(c: CapturaRostro): Promise<void> {
    this.paso.set('verificando');
    this.error.set(null);
    try {
      const v = await firstValueFrom(this.api.verificarTitular(c.blob, c.vivacidad,
        { version: CONSENTIMIENTO_VERSION, sha256: await huellaDelTexto(TEXTO_TITULAR) }));
      this.verificacion.set(v);
      this.paso.set(v.aprueba ? 'tercero' : 'resultado');
    } catch (e) {
      this.error.set(mensajeError(e, 'No pudimos verificar su identidad ahora'));
      this.paso.set('resultado');
    }
  }

  async rostroTercero(c: CapturaRostro): Promise<void> {
    this.tomandoRostro.set(false);
    this.ponerFoto('rostro', c.blob);
  }

  async archivo(cual: Foto, ev: Event): Promise<void> {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return;
    this.ponerFoto(cual, await reducir(f, 1600));
  }

  private ponerFoto(cual: Foto, blob: Blob): void {
    const previa = this.vistas()[cual];
    if (previa) URL.revokeObjectURL(previa);
    this.fotos.set({ ...this.fotos(), [cual]: blob });
    this.vistas.set({ ...this.vistas(), [cual]: URL.createObjectURL(blob) });
  }

  async enviar(): Promise<void> {
    const v = this.verificacion();
    const f = this.fotos();
    if (!v || !this.completo()) return;
    this.paso.set('enviando');
    this.error.set(null);
    try {
      await firstValueFrom(this.api.autorizarTerceroVerificado(this.pedidoId(), {
        nombre: this.nombre().trim(), cedula: this.cedula().trim(),
        telefono: this.telefono().trim() || undefined, parentesco: this.parentesco().trim() || undefined,
        verificacion_id: v.id,
        consentimiento_version: CONSENTIMIENTO_VERSION,
        consentimiento_sha256: await huellaDelTexto(TEXTO_AUTORIZA_TERCERO),
        rostro: f.rostro!, cedula_frente: f.cedula_frente!, cedula_reverso: f.cedula_reverso!,
      }));
      this.paso.set('listo');
      this.listo.emit();
    } catch (e) {
      this.error.set(mensajeError(e, 'No se pudo registrar a la persona'));
      this.paso.set('tercero');
    }
  }

  reintentar(): void {
    this.error.set(null);
    this.paso.set('selfie');
  }
}
