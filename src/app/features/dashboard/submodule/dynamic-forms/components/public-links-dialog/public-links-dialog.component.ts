import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import Swal from 'sweetalert2';

import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { PublicLinkService } from '../../services/public-link.service';
import { ApiProblem, PublicLink, PublicLinkCreateRequest } from '../../models/dynamic-forms.models';

/** Con qué se abre el diálogo: el formulario dueño de los links. */
export interface PublicLinksDialogData {
  formId: number;
  formName: string;
}

/** Estado derivado de un link (el backend no manda un enum: se calcula aquí). */
type EstadoLink = 'vigente' | 'expirado' | 'revocado';

/**
 * LINKS PÚBLICOS de un formulario dinámico.
 *
 * Lista los links compartibles (URL, expiración, usados/cupo, estado), permite
 * crear uno nuevo (expiración en días 1-365 y cupo de respuestas, ambos opcionales)
 * y revocar los vigentes. Revocar es definitivo: el link deja de aceptar respuestas
 * pero las ya recibidas se conservan.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-public-links-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatDialogModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule,
    MatTooltipModule, MatProgressBarModule, MatSnackBarModule,
  ],
  template: `
    <h2 mat-dialog-title class="pl-titulo">
      <mat-icon class="pl-titulo-icon">link</mat-icon>
      <span>Links públicos — {{ data.formName }}</span>
    </h2>

    <mat-dialog-content class="pl-contenido">

      <!-- Crear un link nuevo -->
      <section class="pl-crear" aria-label="Crear link público">
        <mat-form-field appearance="outline" class="pl-campo" subscriptSizing="dynamic">
          <mat-label>Expira en (días)</mat-label>
          <input matInput type="number" inputmode="numeric" min="1" max="365" step="1"
                 [(ngModel)]="expiraDias" name="expiraDias"
                 placeholder="Sin expiración" [disabled]="creando()"
                 [attr.aria-invalid]="!expiraValido">
          <mat-hint>Opcional, 1 a 365</mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline" class="pl-campo" subscriptSizing="dynamic">
          <mat-label>Cupo de respuestas</mat-label>
          <input matInput type="number" inputmode="numeric" min="1" step="1"
                 [(ngModel)]="cupoMaximo" name="cupoMaximo"
                 placeholder="Sin límite" [disabled]="creando()"
                 [attr.aria-invalid]="!cupoValido">
          <mat-hint>Opcional, mínimo 1</mat-hint>
        </mat-form-field>

        <button mat-flat-button class="pl-btn-crear" (click)="crear()"
                [disabled]="creando() || !formularioValido">
          <mat-icon>add_link</mat-icon>
          {{ creando() ? 'Creando…' : 'Crear link' }}
        </button>
      </section>

      @if (!formularioValido) {
        <p class="pl-error-form" role="alert">
          @if (!expiraValido) { <span>La expiración debe ser un entero entre 1 y 365 días. </span> }
          @if (!cupoValido) { <span>El cupo debe ser un entero mayor o igual a 1.</span> }
        </p>
      }

      @if (cargando()) {
        <mat-progress-bar mode="indeterminate" aria-label="Cargando links"></mat-progress-bar>
      }

      <!-- Listado -->
      @if (errorCarga()) {
        <div class="pl-vacio" role="alert">
          <span class="material-symbols-outlined pl-vacio-icon">cloud_off</span>
          <p>No se pudieron cargar los links.</p>
          <button mat-stroked-button (click)="cargar()">
            <mat-icon>refresh</mat-icon>
            Reintentar
          </button>
        </div>
      } @else if (!cargando() && links().length === 0) {
        <div class="pl-vacio">
          <span class="material-symbols-outlined pl-vacio-icon">link_off</span>
          <p>Este formulario aún no tiene links públicos.</p>
        </div>
      } @else if (links().length > 0) {
        <ul class="pl-lista" aria-label="Links públicos del formulario">
          @for (l of links(); track l.id) {
            <li class="pl-item" [class.pl-item-muerto]="estadoDe(l) !== 'vigente'">
              <div class="pl-item-url">
                <span class="pl-url" [attr.title]="l.url">{{ l.url }}</span>
                <button mat-icon-button matTooltip="Copiar al portapapeles"
                        [attr.aria-label]="'Copiar link ' + l.id" (click)="copiar(l)">
                  <mat-icon>content_copy</mat-icon>
                </button>
              </div>
              <div class="pl-item-meta">
                <span class="pl-meta">
                  <span class="material-symbols-outlined pl-meta-icon" aria-hidden="true">event</span>
                  @if (l.expires_at) { Expira {{ l.expires_at | date:'dd/MM/yyyy HH:mm' }} }
                  @else { Sin expiración }
                </span>
                <span class="pl-meta">
                  <span class="material-symbols-outlined pl-meta-icon" aria-hidden="true">inbox</span>
                  {{ l.submissions_count }}/{{ l.max_submissions ?? '∞' }} respuestas
                </span>
                <span class="pl-chip" [class.pl-chip-vigente]="estadoDe(l) === 'vigente'"
                      [class.pl-chip-expirado]="estadoDe(l) === 'expirado'"
                      [class.pl-chip-revocado]="estadoDe(l) === 'revocado'">
                  {{ etiquetaEstado(estadoDe(l)) }}
                </span>
                <span class="pl-grow"></span>
                @if (estadoDe(l) !== 'revocado') {
                  <button mat-stroked-button class="pl-btn-revocar" (click)="revocar(l)"
                          [disabled]="revocandoId() === l.id">
                    <mat-icon>link_off</mat-icon>
                    {{ revocandoId() === l.id ? 'Revocando…' : 'Revocar' }}
                  </button>
                }
              </div>
            </li>
          }
        </ul>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cerrar</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .pl-titulo {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 1.1rem;
      overflow: hidden;
    }
    .pl-titulo span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pl-titulo-icon { color: var(--navy); flex-shrink: 0; }

    .pl-contenido {
      display: flex;
      flex-direction: column;
      gap: 14px;
      min-width: 0;
    }

    .pl-crear {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      flex-wrap: wrap;
      padding: 12px;
      border: 1px solid var(--slate-200);
      border-radius: 12px;
      background: var(--slate-50);
    }
    .pl-campo { flex: 1 1 160px; min-width: 150px; }
    .pl-btn-crear {
      background-color: var(--navy) !important;
      color: var(--lime) !important;
      border-radius: 8px !important;
      height: 44px;
      margin-top: 4px;
    }
    .pl-btn-crear:disabled { opacity: 0.5; }

    .pl-error-form {
      margin: 0;
      font-size: 0.8rem;
      color: var(--danger);
    }

    .pl-lista {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-height: 46vh;
      overflow-y: auto;
    }
    .pl-item {
      border: 1px solid var(--slate-200);
      border-radius: 12px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
    }
    .pl-item-muerto { background: var(--slate-50); }
    .pl-item-muerto .pl-url { color: var(--slate-400); }

    .pl-item-url {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    .pl-url {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: 'Roboto Mono', monospace;
      font-size: 0.82rem;
      color: var(--slate-700);
    }

    .pl-item-meta {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      font-size: 0.78rem;
      color: var(--slate-500);
    }
    .pl-meta { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
    .pl-meta-icon { font-size: 16px; line-height: 1; }
    .pl-grow { flex: 1 1 auto; }

    .pl-chip {
      padding: 1px 10px;
      border-radius: 999px;
      font-weight: 600;
      font-size: 0.72rem;
      white-space: nowrap;
    }
    .pl-chip-vigente { background: var(--ok-bg); color: var(--ok-fg); border: 1px solid var(--ok-border); }
    .pl-chip-expirado { background: var(--warn-bg); color: var(--warn-fg); border: 1px solid var(--warn-border); }
    .pl-chip-revocado { background: #fdecea; color: var(--danger); border: 1px solid #f5c6c0; }

    .pl-btn-revocar {
      height: 30px !important;
      font-size: 0.75rem !important;
      color: var(--danger) !important;
      border-color: #f5c6c0 !important;
    }

    .pl-vacio {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 28px 12px;
      color: var(--muted);
      text-align: center;
    }
    .pl-vacio-icon { font-size: 44px; color: var(--slate-300); }
    .pl-vacio p { margin: 0; }
  `],
})
export class PublicLinksDialogComponent {
  private svc = inject(PublicLinkService);
  private snack = inject(MatSnackBar);
  readonly data = inject<PublicLinksDialogData>(MAT_DIALOG_DATA);

  // Zoneless: el estado de la vista va en signals.
  readonly links = signal<PublicLink[]>([]);
  readonly cargando = signal(false);
  readonly errorCarga = signal(false);
  readonly creando = signal(false);
  readonly revocandoId = signal<number | null>(null);

  /** Campos del formulario de creación (ngModel; los eventos de DOM repintan solos). */
  expiraDias: number | null = null;
  cupoMaximo: number | null = null;

  constructor() {
    this.cargar();
  }

  get expiraValido(): boolean {
    const d = this.expiraDias;
    return d == null || (Number.isInteger(d) && d >= 1 && d <= 365);
  }

  get cupoValido(): boolean {
    const c = this.cupoMaximo;
    return c == null || (Number.isInteger(c) && c >= 1);
  }

  get formularioValido(): boolean {
    return this.expiraValido && this.cupoValido;
  }

  cargar(): void {
    this.cargando.set(true);
    this.errorCarga.set(false);
    this.svc.list(this.data.formId).subscribe({
      next: ls => {
        this.links.set(ls);
        this.cargando.set(false);
      },
      error: () => {
        this.cargando.set(false);
        this.errorCarga.set(true);
      },
    });
  }

  crear(): void {
    if (this.creando() || !this.formularioValido) return;
    const req: PublicLinkCreateRequest = {};
    if (this.expiraDias != null) req.expires_in_days = this.expiraDias;
    if (this.cupoMaximo != null) req.max_submissions = this.cupoMaximo;

    this.creando.set(true);
    this.svc.create(this.data.formId, req).subscribe({
      next: nuevo => {
        this.creando.set(false);
        this.links.update(ls => [nuevo, ...ls]);
        this.expiraDias = null;
        this.cupoMaximo = null;
        this.snack.open('Link público creado', 'Cerrar', { duration: 4000 });
      },
      error: (err: unknown) => {
        this.creando.set(false);
        this.snack.open(this.mensajeError(err, 'No se pudo crear el link público'), 'Cerrar', { duration: 5000 });
      },
    });
  }

  copiar(l: PublicLink): void {
    navigator.clipboard.writeText(l.url).then(
      () => this.snack.open('Link copiado al portapapeles', 'Cerrar', { duration: 3000 }),
      () => this.snack.open('No se pudo copiar; selecciona la URL manualmente', 'Cerrar', { duration: 4000 }),
    );
  }

  revocar(l: PublicLink): void {
    if (this.revocandoId() !== null) return;
    Swal.fire({
      icon: 'warning',
      title: '¿Revocar este link?',
      text: 'Quien tenga el link ya no podrá enviar respuestas. Las respuestas recibidas se conservan. No se puede deshacer.',
      showCancelButton: true,
      confirmButtonText: 'Revocar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#b42318',
    }).then(res => {
      if (!res.isConfirmed) return;
      this.revocandoId.set(l.id);
      this.svc.revoke(l.id).subscribe({
        next: actualizado => {
          this.revocandoId.set(null);
          this.links.update(ls => ls.map(x => x.id === actualizado.id ? actualizado : x));
          this.snack.open('Link revocado', 'Cerrar', { duration: 4000 });
        },
        error: (err: unknown) => {
          this.revocandoId.set(null);
          this.snack.open(this.mensajeError(err, 'No se pudo revocar el link'), 'Cerrar', { duration: 5000 });
        },
      });
    });
  }

  /** revocado > expirado > vigente (un link revocado se pinta revocado aunque además haya expirado). */
  estadoDe(l: PublicLink): EstadoLink {
    if (l.revoked_at) return 'revocado';
    if (l.expires_at && new Date(l.expires_at).getTime() < Date.now()) return 'expirado';
    return 'vigente';
  }

  etiquetaEstado(e: EstadoLink): string {
    switch (e) {
      case 'revocado': return 'Revocado';
      case 'expirado': return 'Expirado';
      default: return 'Vigente';
    }
  }

  /** Extrae el `detail` del ProblemDetail RFC 7807; si no viene, el texto por defecto. */
  private mensajeError(err: unknown, porDefecto: string): string {
    if (err instanceof HttpErrorResponse) {
      const p = err.error as ApiProblem | null;
      if (p && typeof p === 'object' && typeof p.detail === 'string' && p.detail) return p.detail;
    }
    return porDefecto;
  }
}
