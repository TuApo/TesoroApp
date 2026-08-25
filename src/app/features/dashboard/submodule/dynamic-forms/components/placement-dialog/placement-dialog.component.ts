import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import Swal from 'sweetalert2';

import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { PlacementService } from '../../services/placement.service';
import { ModuleNode, Placement, PlacementRequest } from '../../models/placement.models';
import { ApiProblem } from '../../models/dynamic-forms.models';
import { ModuleTreePickerComponent } from '../module-tree-picker/module-tree-picker.component';

/** Con qué se abre el diálogo. `current` solo en modo 'move'. */
export interface PlacementDialogData {
  formId: number;
  formName: string;
  current?: Placement;
  mode: 'publish' | 'move';
}

/**
 * Deriva el slug en cliente (solo para la VISTA PREVIA; la ruta canónica la
 * calcula el backend): minúsculas, NFD sin diacríticos, no-alfanumérico→'-',
 * sin guiones sobrantes en los extremos.
 */
export function derivarSlug(texto: string): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * DIÁLOGO DE UBICACIÓN de un formulario dinámico en el menú.
 *
 * Publica (POST /placement, idempotente) o mueve/renombra/reordena (PATCH). El
 * formulario es una VISTA de un módulo anfitrión: se elige el módulo padre con
 * el árbol, la etiqueta, el icono y el orden. El backend crea UNA sola entrada de
 * menú; Formulario, Respuestas, Soportes y Analítica son tabs dentro de esa pantalla
 * (los de gestión solo los ve el dueño/admin). Muestra en vivo la ruta final y cómo
 * se verá la entrada en el sidebar.
 *
 * Al confirmar: si la respuesta trae `warnings` o `placement_status === 'FAILED'`
 * los muestra y NO cierra; si queda LINKED cierra devolviendo el Placement.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-placement-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule,
    MatSnackBarModule,
    ModuleTreePickerComponent,
  ],
  template: `
    <h2 mat-dialog-title class="pd-titulo">
      <span class="material-symbols-outlined pd-titulo-icon" aria-hidden="true">
        {{ esMover ? 'drive_file_move' : 'playlist_add' }}
      </span>
      <span>{{ esMover ? 'Mover / renombrar' : 'Publicar en el menú' }} — {{ data.formName }}</span>
    </h2>

    <mat-dialog-content class="pd-contenido">

      @if (esMover) {
        <p class="pd-aviso-mover" role="note">
          <span class="material-symbols-outlined" aria-hidden="true">alt_route</span>
          La URL anterior quedará como redirección.
        </p>
      }

      <div class="pd-grid">
        <!-- Padre en el menú -->
        <section class="pd-bloque">
          <h3 class="pd-bloque-titulo">Módulo padre <span class="pd-req" aria-hidden="true">*</span></h3>
          <p class="pd-ayuda">Dónde aparecerá el formulario dentro del menú lateral.</p>
          <app-module-tree-picker [value]="padre()"
                                  (valueChange)="padre.set($event)"
                                  (nodeChange)="padreNodo.set($event)" />
        </section>

        <!-- Datos de la entrada -->
        <section class="pd-bloque">
          <h3 class="pd-bloque-titulo">Entrada del menú</h3>

          <mat-form-field appearance="outline" class="pd-campo" subscriptSizing="dynamic">
            <mat-label>Etiqueta</mat-label>
            <input matInput maxlength="120" [ngModel]="menuLabel()"
                   (ngModelChange)="menuLabel.set($event)" placeholder="Nombre visible en el menú" />
          </mat-form-field>

          <div class="pd-fila-icono">
            <mat-form-field appearance="outline" class="pd-campo pd-campo--icono" subscriptSizing="dynamic">
              <mat-label>Icono (Material Symbol)</mat-label>
              <input matInput maxlength="60" [ngModel]="icono()"
                     (ngModelChange)="icono.set($event)" placeholder="dynamic_form" />
              <mat-hint>Nombre del símbolo, p. ej. description, assignment</mat-hint>
            </mat-form-field>
            <span class="pd-icono-preview" [attr.title]="icono() || 'dynamic_form'">
              <span class="material-symbols-outlined" aria-hidden="true">{{ icono() || 'dynamic_form' }}</span>
            </span>
          </div>

          <mat-form-field appearance="outline" class="pd-campo pd-campo--orden" subscriptSizing="dynamic">
            <mat-label>Orden</mat-label>
            <input matInput type="number" inputmode="numeric" min="0" step="1"
                   [ngModel]="orden()" (ngModelChange)="orden.set($event)"
                   placeholder="Automático" />
            <mat-hint>Opcional. Posición entre los hermanos.</mat-hint>
          </mat-form-field>

          <!-- El backend crea UNA entrada; las 4 vistas son tabs de la misma pantalla. -->
          <p class="pd-info-vistas" role="note">
            <span class="material-symbols-outlined" aria-hidden="true">info</span>
            Se creará una única entrada en el menú. Respuestas, Soportes y Analítica
            aparecen como pestañas dentro de esa pantalla (solo para quien gestiona el
            formulario).
          </p>
        </section>
      </div>

      <!-- Vista previa -->
      @if (padreNodo()) {
        <section class="pd-preview" aria-label="Vista previa de la ubicación">
          <div class="pd-preview-ruta">
            <span class="material-symbols-outlined" aria-hidden="true">link</span>
            <code>{{ rutaPreview() }}</code>
          </div>
          <div class="pd-preview-sidebar" aria-label="Vista previa en el menú">
            <span class="pd-preview-sidebar-label">Se verá así en el menú:</span>
            <span class="pd-sidebar-item">
              <span class="material-symbols-outlined" aria-hidden="true">{{ icono() || 'dynamic_form' }}</span>
              <span class="pd-sidebar-item-texto">{{ menuLabel().trim() || data.formName }}</span>
            </span>
          </div>
        </section>
      } @else {
        <p class="pd-ayuda">Elige un módulo padre para ver la ruta final.</p>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button type="button" [disabled]="guardando()" (click)="cerrar()">Cancelar</button>
      <button mat-flat-button type="button" class="pd-btn-confirmar"
              [disabled]="guardando() || !padre()" (click)="confirmar()">
        <span class="material-symbols-outlined" aria-hidden="true">
          {{ esMover ? 'drive_file_move' : 'rocket_launch' }}
        </span>
        {{ guardando() ? 'Guardando…' : (esMover ? 'Mover' : 'Publicar') }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .pd-titulo {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 1.1rem;
      overflow: hidden;
    }
    .pd-titulo span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pd-titulo-icon { color: var(--navy); flex-shrink: 0; }

    .pd-contenido {
      display: flex;
      flex-direction: column;
      gap: 14px;
      min-width: min(680px, 80vw);
    }

    .pd-aviso-mover {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      padding: 8px 12px;
      border-radius: 10px;
      background: var(--warn-bg);
      color: var(--warn-fg);
      border: 1px solid var(--warn-border);
      font-size: 0.85rem;
    }
    .pd-aviso-mover .material-symbols-outlined { font-size: 20px; }

    .pd-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    @media (max-width: 640px) { .pd-grid { grid-template-columns: 1fr; } }

    .pd-bloque { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    .pd-bloque-titulo { margin: 0; font-size: 0.95rem; font-weight: 600; color: var(--navy); }
    .pd-req { color: var(--danger); }
    .pd-ayuda { margin: 0; font-size: 0.8rem; color: var(--muted); }
    .pd-ayuda--sutil { font-style: italic; }

    .pd-campo { width: 100%; }

    .pd-fila-icono { display: flex; align-items: flex-start; gap: 10px; }
    .pd-campo--icono { flex: 1 1 auto; }
    .pd-icono-preview {
      flex-shrink: 0;
      width: 48px;
      height: 48px;
      margin-top: 4px;
      border: 1px solid var(--slate-200);
      border-radius: 10px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: var(--slate-50);
    }
    .pd-icono-preview .material-symbols-outlined { font-size: 26px; color: var(--navy); }

    .pd-campo--orden { max-width: 200px; }

    .pd-info-vistas {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin: 6px 0 0;
      padding: 8px 12px;
      border-radius: 10px;
      background: var(--slate-50);
      border: 1px solid var(--slate-200);
      color: var(--slate-700);
      font-size: 0.82rem;
    }
    .pd-info-vistas .material-symbols-outlined { font-size: 20px; color: var(--navy); flex-shrink: 0; }

    .pd-preview {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 12px;
      border: 1px dashed var(--slate-200);
      border-radius: 12px;
      background: var(--slate-50);
    }
    .pd-preview-ruta {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      color: var(--slate-700);
    }
    .pd-preview-ruta .material-symbols-outlined { font-size: 20px; color: var(--slate-500); flex-shrink: 0; }
    .pd-preview-ruta code {
      overflow-x: auto;
      white-space: nowrap;
      font-family: 'Roboto Mono', monospace;
      font-size: 0.82rem;
      color: var(--navy);
    }
    .pd-preview-sidebar { display: flex; flex-direction: column; gap: 6px; }
    .pd-preview-sidebar-label { font-size: 0.78rem; color: var(--muted); }
    .pd-sidebar-item {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      align-self: flex-start;
      padding: 8px 14px;
      border-radius: 10px;
      background: var(--navy);
      color: #fff;
      max-width: 100%;
    }
    .pd-sidebar-item .material-symbols-outlined { font-size: 20px; color: var(--lime); flex-shrink: 0; }
    .pd-sidebar-item-texto { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .pd-btn-confirmar {
      background-color: var(--navy) !important;
      color: var(--lime) !important;
      border-radius: 8px !important;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .pd-btn-confirmar:disabled { opacity: 0.5; }
    .pd-btn-confirmar .material-symbols-outlined { font-size: 20px; }
  `],
})
export class PlacementDialogComponent {
  private svc = inject(PlacementService);
  private snack = inject(MatSnackBar);
  private ref = inject<MatDialogRef<PlacementDialogComponent, Placement>>(MatDialogRef);
  readonly data = inject<PlacementDialogData>(MAT_DIALOG_DATA);

  readonly esMover = this.data.mode === 'move';

  // Estado del formulario (signals → OnPush repinta con la vista previa en vivo).
  readonly padre = signal<string | null>(this.data.current?.parent_module_id ?? null);
  readonly padreNodo = signal<ModuleNode | null>(null);
  readonly menuLabel = signal<string>(this.data.current?.menu_label || this.data.formName);
  readonly icono = signal<string>(this.data.current?.module_icon || 'dynamic_form');
  readonly orden = signal<number | null>(this.data.current?.module_order_no ?? null);

  readonly guardando = signal(false);

  /** Ruta final estimada: /dashboard/{route_path del padre}/{slug de la etiqueta}. */
  readonly rutaPreview = computed(() => {
    const n = this.padreNodo();
    if (!n) return '';
    const rp = (n.route_path ?? '').replace(/^\/+|\/+$/g, '');
    const slug = derivarSlug(this.menuLabel()) || '…';
    return `/dashboard/${rp ? rp + '/' : ''}${slug}`;
  });

  cerrar(): void {
    if (this.guardando()) return;
    this.ref.close();
  }

  confirmar(): void {
    const padre = this.padre();
    if (!padre) {
      this.snack.open('Elige un módulo padre para la ubicación.', 'Cerrar', { duration: 4000 });
      return;
    }

    // El backend crea UNA entrada (las vistas son tabs); no se envía responses_menu_enabled.
    const req: PlacementRequest = {
      parent_module_id: padre,
      menu_label: this.menuLabel().trim() || this.data.formName,
      icon: this.icono().trim() || 'dynamic_form',
    };
    const orden = this.orden();
    if (orden != null && Number.isFinite(Number(orden))) req.order_no = Number(orden);

    this.guardando.set(true);
    const op$ = this.esMover ? this.svc.move(this.data.formId, req) : this.svc.place(this.data.formId, req);
    op$.subscribe({
      next: placement => {
        this.guardando.set(false);
        const conAvisos = (placement.warnings?.length ?? 0) > 0;
        if (placement.placement_status === 'FAILED' || conAvisos) {
          this.mostrarAvisos(placement); // NO cierra
          return;
        }
        this.ref.close(placement); // LINKED
      },
      error: (err: unknown) => {
        this.guardando.set(false);
        this.mostrarError(err);
      },
    });
  }

  // ── Avisos / errores ─────────────────────────────────────────────────

  private mostrarAvisos(p: Placement): void {
    const esFallo = p.placement_status === 'FAILED';
    const items = (p.warnings ?? []).map(w => `<li>${this.esc(w)}</li>`).join('');
    const detalle = p.placement_error ? `<p>${this.esc(p.placement_error)}</p>` : '';
    void Swal.fire({
      icon: esFallo ? 'error' : 'warning',
      title: esFallo ? 'La ubicación quedó en error' : 'Ubicación aplicada con advertencias',
      html: `${detalle}${items ? `<ul style="text-align:left;margin:8px 0 0;padding-left:18px">${items}</ul>` : ''}`
        || 'Revisa la configuración e intenta de nuevo.',
      confirmButtonText: 'Entendido',
    });
  }

  private mostrarError(err: unknown): void {
    const p = this.comoProblema(err);
    const porCodigo = this.mensajePorCodigo(p?.code);
    void Swal.fire({
      icon: 'error',
      title: this.esMover ? 'No se pudo mover' : 'No se pudo publicar',
      text: porCodigo || p?.detail || 'Error inesperado del servidor. Intenta de nuevo.',
      confirmButtonText: 'Cerrar',
    });
  }

  private mensajePorCodigo(code?: string): string | null {
    switch (code) {
      case 'df_route_taken':
        return 'Ya existe una entrada de menú con esa ruta. Cambia la etiqueta o el módulo padre.';
      case 'df_parent_not_found':
        return 'El módulo padre elegido ya no existe. Actualiza el árbol y elige otro.';
      case 'df_parent_not_manageable':
        return 'No tienes permiso de administración sobre el módulo padre elegido.';
      case 'df_label_required':
        return 'La etiqueta del menú es obligatoria.';
      default:
        return null;
    }
  }

  private comoProblema(err: unknown): ApiProblem | null {
    return err instanceof HttpErrorResponse ? (err.error as ApiProblem | null) : null;
  }

  private esc(s: string): string {
    const mapa: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return s.replace(/[&<>"']/g, c => mapa[c] ?? c);
  }
}
