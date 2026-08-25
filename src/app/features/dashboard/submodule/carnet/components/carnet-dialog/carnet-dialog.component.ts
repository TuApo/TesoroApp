import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';

import { CarnetCardComponent } from '../carnet-card/carnet-card.component';
import { CarnetService } from '../../services/carnet.service';
import { Carnet } from '../../models/carnet.model';
import { UtilityServiceService } from '../../../../../../shared/services/utilityService/utility-service.service';
import { ProfilePhotoService } from '../../../../../../shared/services/profile-photo/profile-photo.service';

/**
 * "Mi carné" en un diálogo, que es como se abre desde el avatar del header.
 *
 * Existe además de la página `/dashboard/carnet/mi-carnet` porque el caso de uso real es
 * enseñárselo a alguien que lo está pidiendo: dos toques y la tarjeta en pantalla, sin perder
 * lo que se estuviera haciendo detrás.
 */
@Component({
  selector: 'app-carnet-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatIconModule, CarnetCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './carnet-dialog.component.html',
  styleUrl: './carnet-dialog.component.css',
})
export class CarnetDialogComponent {
  private readonly carnets = inject(CarnetService);
  private readonly util = inject(UtilityServiceService);
  private readonly fotos = inject(ProfilePhotoService);
  private readonly router = inject(Router);
  private readonly ref = inject(MatDialogRef<CarnetDialogComponent>);

  readonly carnet = signal<Carnet | null>(null);
  readonly foto = signal<string | null>(null);
  readonly cargando = signal(true);
  readonly error = signal<string>('');

  /** De la sesión, para el personal sin ficha en contratación (el backend los manda vacíos). */
  readonly nombreFallback = signal('');
  readonly cargoFallback = signal('');

  constructor() {
    const user: any = this.util.getUser?.();
    this.nombreFallback.set(
      [user?.datos_basicos?.nombres, user?.datos_basicos?.apellidos].filter(Boolean).join(' '),
    );
    this.cargoFallback.set(user?.rol?.nombre ?? '');
    // Foto local mientras llega (o si no hay) la biométrica: es la que el usuario ya se puso
    // en Configuración › Cuenta y la que ve en el avatar del header.
    this.foto.set(this.fotos.getPhoto());

    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.error.set('');
    this.carnets.miCarnet().subscribe({
      next: async c => {
        this.carnet.set(c);
        this.cargando.set(false);
        if (c.fotoUrl) {
          const biometrica = await this.carnets.fotoDataUrl(c.fotoUrl);
          if (biometrica) this.foto.set(biometrica);
        }
      },
      error: err => {
        this.cargando.set(false);
        this.error.set(this.mensajeError(err));
      },
    });
  }

  verCompleto(): void {
    this.ref.close();
    this.router.navigate(['/dashboard/carnet/mi-carnet']);
  }

  cerrar(): void {
    this.ref.close();
  }

  private mensajeError(err: any): string {
    if (err?.status === 404) {
      return 'Tu usuario todavía no tiene ficha para emitir carné. Avisa a Gestión Humana.';
    }
    if (err?.status === 503) {
      return 'El carné digital no está configurado en el servidor. Avisa a soporte.';
    }
    return err?.error?.error || 'No se pudo cargar tu carné. Revisa la conexión e inténtalo de nuevo.';
  }
}
