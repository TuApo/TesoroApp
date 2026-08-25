import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';

import { DynamicFormService } from '../../services/dynamic-form.service';
import { ApiProblem } from '../../models/dynamic-forms.models';
import { SupportDownloadLog } from '../../models/placement.models';

export interface SupportDownloadsData {
  formId: number;
  formName?: string | null;
}

/**
 * ACTIVIDAD DE DESCARGAS: quién se llevó soportes de este formulario, cuándo y cuáles.
 *
 * Los soportes son datos personales de gente real (cédulas, planillas, historias): que
 * salgan de la plataforma tiene que dejar rastro. El registro lo escribe el servidor en
 * cada descarga —individual o ZIP—, así que esta pantalla solo lo lee; no hay forma de
 * bajar un archivo "por fuera" del registro estando dentro del módulo.
 *
 * Cada fila se puede desplegar para ver los archivos concretos (los primeros 200 de un
 * ZIP grande: es evidencia de qué se llevaron, no un índice completo).
 */
@Component({
  selector: 'app-support-downloads-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, MatDialogModule, MatButtonModule, MatIconModule,
    MatPaginatorModule, MatProgressBarModule, MatTooltipModule,
  ],
  template: `
    <h2 mat-dialog-title class="sdd-titulo">
      <mat-icon aria-hidden="true">history</mat-icon>
      Actividad de descargas
      @if (data.formName) {
        <span class="sdd-form">· {{ data.formName }}</span>
      }
    </h2>

    @if (cargando()) {
      <mat-progress-bar mode="indeterminate" aria-label="Cargando actividad"></mat-progress-bar>
    }

    <mat-dialog-content class="sdd-contenido">
      @if (error()) {
        <div class="sdd-error" role="alert">
          <mat-icon aria-hidden="true">error</mat-icon>
          <span>{{ error() }}</span>
        </div>
      } @else if (!cargando() && filas().length === 0) {
        <p class="sdd-vacio">Todavía nadie ha descargado soportes de este formulario.</p>
      } @else {
        <ul class="sdd-lista">
          @for (d of filas(); track d.id) {
            <li class="sdd-item" [class.sdd-item--fallo]="!d.success">
              <span class="sdd-punto" [class.sdd-punto--zip]="d.mode === 'ZIP'" aria-hidden="true">
                <mat-icon>{{ d.mode === 'ZIP' ? 'folder_zip' : 'download' }}</mat-icon>
              </span>

              <div class="sdd-cuerpo">
                <div class="sdd-cabecera">
                  <span class="sdd-quien">{{ d.user_email || d.user_id || 'Usuario desconocido' }}</span>
                  @if (d.user_role) { <span class="sdd-chip">{{ d.user_role }}</span> }
                  <span class="sdd-cuando">{{ d.occurred_at | date:'dd/MM/yyyy HH:mm' }}</span>
                </div>

                <p class="sdd-resumen">
                  {{ d.mode === 'ZIP' ? 'Descargó un ZIP con' : 'Descargó' }}
                  <strong>{{ d.file_count }}</strong>
                  {{ d.file_count === 1 ? 'soporte' : 'soportes' }}
                  @if (d.total_bytes > 0) { <span class="sdd-peso">({{ peso(d.total_bytes) }})</span> }
                  @if (d.group_mode && d.group_mode !== 'NONE') {
                    <span class="sdd-chip sdd-chip--suave">{{ etiquetaGrupo(d.group_mode) }}</span>
                  }
                </p>

                @if (d.archive_name) {
                  <p class="sdd-archivo" [title]="d.archive_name">{{ d.archive_name }}</p>
                }

                @if (resumenFiltros(d); as f) {
                  <p class="sdd-filtros"><mat-icon aria-hidden="true">filter_alt</mat-icon>{{ f }}</p>
                }

                @if (!d.success) {
                  <p class="sdd-fallo">
                    <mat-icon aria-hidden="true">warning</mat-icon>
                    La descarga no se completó{{ d.error_code ? ' (' + d.error_code + ')' : '' }}
                  </p>
                }

                @if (d.items?.length) {
                  <button mat-button class="sdd-toggle" (click)="alternar(d.id)">
                    {{ abierto() === d.id ? 'Ocultar' : 'Ver' }} archivos
                  </button>
                  @if (abierto() === d.id) {
                    <ul class="sdd-archivos">
                      @for (it of d.items; track it.document_id + '-' + it.submission_id) {
                        <li>
                          <code>{{ it.entry_name }}</code>
                          <span class="sdd-detalle">
                            {{ it.field_label }} · respuesta #{{ it.submission_id }}
                          </span>
                        </li>
                      }
                    </ul>
                    @if (d.items && d.file_count > d.items.length) {
                      <p class="sdd-mas">
                        y {{ d.file_count - d.items.length }} archivo(s) más (el detalle se
                        guarda recortado)
                      </p>
                    }
                  }
                }
              </div>

              @if (d.ip) {
                <span class="sdd-ip" [matTooltip]="'Dirección IP de origen'">{{ d.ip }}</span>
              }
            </li>
          }
        </ul>

        <mat-paginator
          [length]="total()" [pageIndex]="pagina()" [pageSize]="tamano()"
          [pageSizeOptions]="[10, 25, 50]" (page)="onPage($event)"
          aria-label="Paginación de la actividad">
        </mat-paginator>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cerrar</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .sdd-titulo { display: flex; align-items: center; gap: 8px; }
    .sdd-form { color: #64748b; font-weight: 500; font-size: 0.9rem; }
    .sdd-contenido { min-width: min(620px, 82vw); max-height: 65vh; }

    .sdd-error { display: flex; align-items: center; gap: 8px; color: #b42318; padding: 12px 0; }
    .sdd-vacio { color: #64748b; padding: 24px 0; text-align: center; }

    .sdd-lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
    .sdd-item {
      display: flex; align-items: flex-start; gap: 12px;
      padding: 12px; border: 1px solid #e8edf3; border-radius: 12px; background: #ffffff;
    }
    .sdd-item--fallo { border-color: #fecdca; background: #fffbfa; }

    .sdd-punto {
      display: inline-flex; align-items: center; justify-content: center;
      width: 34px; height: 34px; flex: 0 0 auto; border-radius: 50%;
      background: #f1f5f9; color: #21263c;
    }
    .sdd-punto--zip { background: #21263c; color: #8cd50a; }
    .sdd-punto mat-icon { font-size: 20px; width: 20px; height: 20px; }

    .sdd-cuerpo { flex: 1 1 auto; min-width: 0; }
    .sdd-cabecera { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .sdd-quien { font-weight: 600; color: #1e293b; }
    .sdd-cuando { color: #64748b; font-size: 0.8rem; margin-left: auto; }

    .sdd-chip {
      padding: 1px 8px; border-radius: 999px; background: #eef2f7; color: #334155;
      font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.02em;
    }
    .sdd-chip--suave { text-transform: none; font-weight: 600; margin-left: 6px; }

    .sdd-resumen { margin: 6px 0 0 0; color: #334155; font-size: 0.88rem; }
    .sdd-peso { color: #64748b; }
    .sdd-archivo {
      margin: 4px 0 0 0; font-family: 'Roboto Mono', monospace; font-size: 0.76rem;
      color: #475569; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .sdd-filtros {
      margin: 4px 0 0 0; display: flex; align-items: center; gap: 4px;
      color: #64748b; font-size: 0.78rem;
    }
    .sdd-filtros mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .sdd-fallo { margin: 4px 0 0 0; display: flex; align-items: center; gap: 4px; color: #b42318; font-size: 0.8rem; }
    .sdd-fallo mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .sdd-toggle { padding: 0 !important; min-width: 0 !important; font-size: 0.78rem; }
    .sdd-archivos { list-style: none; margin: 4px 0 0 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
    .sdd-archivos li { display: flex; flex-direction: column; }
    .sdd-archivos code { font-size: 0.75rem; color: #1e293b; }
    .sdd-detalle { font-size: 0.72rem; color: #64748b; }
    .sdd-mas { margin: 4px 0 0 0; font-size: 0.75rem; color: #64748b; font-style: italic; }

    .sdd-ip { font-size: 0.72rem; color: #94a3b8; font-family: 'Roboto Mono', monospace; }
  `],
})
export class SupportDownloadsDialogComponent {
  readonly data = inject<SupportDownloadsData>(MAT_DIALOG_DATA);

  private destroyRef = inject(DestroyRef);
  private formsSvc = inject(DynamicFormService);

  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly filas = signal<SupportDownloadLog[]>([]);
  readonly total = signal(0);
  readonly pagina = signal(0);
  readonly tamano = signal(25);
  /** Id de la descarga con el detalle desplegado (una a la vez). */
  readonly abierto = signal<number | null>(null);

  constructor() {
    this.cargar();
  }

  onPage(evento: PageEvent): void {
    this.pagina.set(evento.pageIndex);
    this.tamano.set(evento.pageSize);
    this.abierto.set(null);
    this.cargar();
  }

  alternar(id: number): void {
    this.abierto.set(this.abierto() === id ? null : id);
  }

  peso(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  }

  etiquetaGrupo(modo: string): string {
    return modo === 'FIELD' ? 'en carpetas por pregunta' : 'en carpetas por persona';
  }

  /** Una línea con el criterio de la descarga; null si se bajó sin filtrar nada. */
  resumenFiltros(d: SupportDownloadLog): string | null {
    const f = d.filters;
    if (!f) return null;
    const partes: string[] = [];
    if (f.q) partes.push(`búsqueda "${f.q}"`);
    if (f.fields?.length) partes.push(`${f.fields.length} pregunta(s)`);
    if (f.types?.length) partes.push(f.types.join(', '));
    return partes.length ? partes.join(' · ') : null;
  }

  private cargar(): void {
    this.cargando.set(true);
    this.error.set(null);
    this.formsSvc.supportDownloads(this.data.formId, this.pagina(), this.tamano())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: pag => {
          this.filas.set(pag.content ?? []);
          this.total.set(pag.total ?? 0);
          this.cargando.set(false);
        },
        error: (err: HttpErrorResponse) => {
          this.cargando.set(false);
          this.filas.set([]);
          const problema = err?.error as ApiProblem | null;
          this.error.set(problema?.detail?.trim()
            || 'No se pudo cargar la actividad de descargas.');
        },
      });
  }
}
