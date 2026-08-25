import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

import { CarnetCardComponent } from '../../components/carnet-card/carnet-card.component';
import { CarnetService } from '../../services/carnet.service';
import { Carnet } from '../../models/carnet.model';
import { UtilityServiceService } from '../../../../../../shared/services/utilityService/utility-service.service';
import { ProfilePhotoService } from '../../../../../../shared/services/profile-photo/profile-photo.service';

/**
 * Página "Mi carné". Mismo contenido que el diálogo del header, con sitio para explicar cómo
 * se usa y qué significa cada cosa — la primera vez que alguien ve un QR en su carné suele
 * preguntar si sirve para marcar entrada.
 */
@Component({
  selector: 'app-mi-carnet',
  standalone: true,
  imports: [CommonModule, MatIconModule, CarnetCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './mi-carnet.component.html',
  styleUrl: './mi-carnet.component.css',
})
export class MiCarnetComponent {
  private readonly carnets = inject(CarnetService);
  private readonly util = inject(UtilityServiceService);
  private readonly fotos = inject(ProfilePhotoService);

  readonly carnet = signal<Carnet | null>(null);
  readonly foto = signal<string | null>(null);
  readonly cargando = signal(true);
  readonly error = signal('');

  readonly nombreFallback = signal('');
  readonly cargoFallback = signal('');

  constructor() {
    const user: any = this.util.getUser?.();
    this.nombreFallback.set(
      [user?.datos_basicos?.nombres, user?.datos_basicos?.apellidos].filter(Boolean).join(' '),
    );
    this.cargoFallback.set(user?.rol?.nombre ?? '');
    this.fotos.reload();
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
        this.error.set(
          err?.status === 404
            ? 'Tu usuario todavía no tiene ficha para emitir carné. Avisa a Gestión Humana.'
            : err?.status === 503
              ? 'El carné digital no está configurado en el servidor. Avisa a soporte.'
              : err?.error?.error || 'No se pudo cargar tu carné. Revisa la conexión.',
        );
      },
    });
  }
}
