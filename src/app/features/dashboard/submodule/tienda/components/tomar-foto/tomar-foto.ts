import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { ImagenAmpliableComponent } from '../../../../../../shared/components/imagen-ampliable/imagen-ampliable.component';
import { reducir } from '../../../../../economiapp/components/eco-captura-rostro';
import { TiendaService } from '../../service/tienda.service';

/**
 * Botón grande para tomar una o varias fotos con la cámara (o elegirlas de la galería),
 * reducirlas y subirlas a gestión documental. Emite los ids de documento. Se usa para la
 * foto de la persona al autorizar mercado y para el soporte de un pago (consignación,
 * voucher del datáfono, pantallazo del QR, extracto).
 */
@Component({
  selector: 'app-tomar-foto',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, ImagenAmpliableComponent],
  template: `
    <div class="tf">
      @for (d of docs(); track d) {
        <span class="tf-foto">
          <app-imagen-ampliable [doc]="d" [nombre]="etiqueta()" [tamano]="tamano()" />
          <button type="button" class="tf-quitar" aria-label="Quitar foto" (click)="quitar(d)"><mat-icon>close</mat-icon></button>
        </span>
      }
      @if (multiple() || docs().length === 0) {
        <label class="tf-boton" [class.tf-boton--ocupado]="subiendo() > 0" [class.tf-boton--falta]="obligatoria() && !docs().length">
          <mat-icon>{{ subiendo() ? 'hourglass_top' : icono() }}</mat-icon>
          <span>{{ subiendo() ? 'Subiendo…' : (docs().length ? 'Otra foto' : etiqueta()) }}</span>
          <input type="file" accept="image/*" [attr.capture]="camara()" [multiple]="multiple()" (change)="subir($event)" hidden />
        </label>
      }
      @if (error()) { <span class="tf-error">{{ error() }}</span> }
    </div>
  `,
  styles: [`
    .tf { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .tf-foto { position: relative; display: inline-flex; }
    .tf-quitar {
      position: absolute; top: -8px; right: -8px; width: 26px; height: 26px; min-height: 0 !important;
      padding: 0; border-radius: 999px; border: 0; background: #ef4444; color: #fff; display: grid; place-items: center; cursor: pointer;
    }
    .tf-quitar mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .tf-boton {
      display: inline-flex; align-items: center; gap: 8px; min-height: 52px; padding: 10px 16px;
      border-radius: 12px; border: 2px dashed var(--border, rgba(127,127,127,.4)); cursor: pointer;
      font-weight: 600; font-size: 14px;
    }
    .tf-boton--falta { border-color: #f59e0b; color: #b45309; }
    :host-context(html[data-theme='dark']) .tf-boton--falta { color: #fbbf24; }
    .tf-boton--ocupado { pointer-events: none; opacity: .7; }
    .tf-error { color: #ef4444; font-size: 13px; }
  `],
})
export class TomarFoto {
  private api = inject(TiendaService);

  /** Texto del botón. */
  readonly etiqueta = input('Tomar foto');
  readonly icono = input('photo_camera');
  /** 'user' = cámara frontal (selfie de la persona), 'environment' = trasera (comprobante). */
  readonly camara = input<'user' | 'environment'>('environment');
  readonly multiple = input(false);
  readonly obligatoria = input(false);
  readonly tamano = input(64);
  /** Tipo de dueño en gestión documental (STORE_PAGO, STORE_AUTORIZACION…). */
  readonly tipoDueno = input('STORE_SOPORTE');

  readonly cambio = output<string[]>();
  readonly docs = signal<string[]>([]);
  readonly subiendo = signal(0);
  readonly error = signal<string | null>(null);

  async subir(ev: Event): Promise<void> {
    const entrada = ev.target as HTMLInputElement;
    const archivos = Array.from(entrada.files ?? []);
    entrada.value = '';
    this.error.set(null);
    this.subiendo.set(archivos.length);
    for (const a of archivos) {
      try {
        const b = await reducir(a, 1600);
        const id = await firstValueFrom(this.api.subirArchivo(b, a.name || 'foto.jpg', '', this.tipoDueno()));
        this.docs.update(d => this.multiple() ? [...d, id] : [id]);
      } catch {
        this.error.set('No se pudo subir la foto. Intente de nuevo.');
      }
      this.subiendo.update(n => n - 1);
    }
    this.cambio.emit(this.docs());
  }

  quitar(doc: string): void {
    this.docs.update(d => d.filter(x => x !== doc));
    this.cambio.emit(this.docs());
  }

  /** Vacía las fotos (al terminar el pago o la autorización). */
  limpiar(): void { this.docs.set([]); this.error.set(null); }
}
