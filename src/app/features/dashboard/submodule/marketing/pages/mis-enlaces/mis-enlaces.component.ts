import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';

import { EnlacePropio, MarketingService } from '../../service/marketing.service';

/**
 * El codigo de referido de cada persona y los enlaces que ha creado.
 *
 * <p>Esta pantalla la ve <b>todo el mundo</b>, no solo administracion: el valor del
 * referido esta en el volumen de gente compartiendo, y pedir permiso para sacar tu propio
 * enlace mata el mecanismo.
 */
@Component({
  selector: 'app-mis-enlaces',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './mis-enlaces.component.html',
  styleUrl: './mis-enlaces.component.css',
})
export class MisEnlacesComponent implements OnInit {
  private readonly api = inject(MarketingService);

  readonly cargando = signal(true);
  readonly codigo = signal<string | null>(null);
  readonly enlaces = signal<EnlacePropio[]>([]);
  readonly puedeCompartir = signal(typeof navigator !== 'undefined' && !!navigator.share);

  ngOnInit(): void {
    this.api.misEnlaces().subscribe({
      next: (r) => { this.codigo.set(r.codigo); this.enlaces.set(r.enlaces); this.cargando.set(false); },
      error: () => this.cargando.set(false),
    });
  }

  async copiar(texto: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(texto);
      Swal.fire({ icon: 'success', title: 'Copiado', timer: 1200, showConfirmButton: false });
    } catch {
      Swal.fire({ icon: 'info', title: 'Copia esto', text: texto });
    }
  }

  /**
   * Compartir nativo. En el movil es un toque y el enlace ya esta en WhatsApp; la
   * friccion entre copiar y compartir es donde se pierde la mitad de la difusion.
   */
  async compartir(e: EnlacePropio): Promise<void> {
    try {
      await navigator.share({
        title: 'Vacante disponible',
        text: 'Estamos contratando. Inscríbete aquí:',
        url: e.url,
      });
    } catch { /* el usuario cancelo el menu de compartir */ }
  }

  trackEnlace = (_: number, e: EnlacePropio) => e.codigo;
}
