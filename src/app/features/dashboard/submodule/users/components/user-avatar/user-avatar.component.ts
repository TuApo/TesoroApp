import { ChangeDetectionStrategy, Component, Input, OnInit, inject, signal } from '@angular/core';
import { AdminService } from '../../services/admin.service';

/**
 * Avatar de una fila de la tabla de usuarios.
 *
 * Carga su propia foto en ngOnInit a propósito. La tabla sólo instancia las filas de la
 * página visible (10 por defecto), así que esto son ~10 peticiones por página en vez de
 * las 8.000 que costaría traer las fotos dentro del listado. Sin foto —o si la petición
 * falla— pinta las iniciales, nunca un hueco roto.
 */
@Component({
  selector: 'app-user-avatar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (foto()) {
      <img class="ua-img" [src]="foto()" [alt]="'Foto de ' + (iniciales || 'usuario')">
    } @else {
      <span class="ua-iniciales">{{ iniciales || '?' }}</span>
    }
  `,
  styles: [`
    :host {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      overflow: hidden;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      flex: 0 0 36px;
    }
    .ua-img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .ua-iniciales { font-size: 12px; font-weight: 600; color: #64748b; letter-spacing: .5px; }
  `],
})
export class UserAvatarComponent implements OnInit {
  private readonly adminService = inject(AdminService);

  @Input({ required: true }) userId!: string;
  /** Viene del listado: evita pedir una foto que sabemos que no existe. */
  @Input() tieneFoto = false;
  @Input() iniciales = '';

  readonly foto = signal<string | null>(null);

  ngOnInit(): void {
    if (!this.tieneFoto || !this.userId) return;
    this.adminService.obtenerFoto(this.userId).subscribe({
      next: r => this.foto.set(r?.foto ?? null),
      error: () => this.foto.set(null),
    });
  }
}
