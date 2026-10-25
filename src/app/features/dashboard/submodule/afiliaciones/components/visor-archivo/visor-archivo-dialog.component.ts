import { ChangeDetectionStrategy, Component, OnDestroy, inject, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ArchivoHistoricoService, DocumentoArchivo } from '../../services/archivo-historico.service';
import { ETIQUETA_EMPRESA, ETIQUETA_TRAMITE, etiqueta } from '../../pages/archivo-historico/archivo-historico.etiquetas';

/**
 * Visor de un documento del archivo histórico. Lo pide como blob autenticado (cada apertura queda
 * registrada en ms-hr) y libera la URL al cerrar.
 */
@Component({
  selector: 'app-visor-archivo-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="visor-cabecera">
      <div class="visor-titulo">
        <mat-icon>description</mat-icon>
        <div>
          <strong>{{ doc.cedula || 'Sin cédula' }} · {{ tramite }}</strong>
          <span class="visor-sub">{{ empresa }} · {{ doc.fecha || periodo }}{{ doc.entidad ? ' · ' + doc.entidad : '' }}</span>
        </div>
      </div>
      <div class="visor-acciones">
        <button mat-stroked-button type="button" (click)="descargar()" [disabled]="cargando()">
          <mat-icon>download</mat-icon> Descargar
        </button>
        <button mat-icon-button type="button" mat-dialog-close aria-label="Cerrar"><mat-icon>close</mat-icon></button>
      </div>
    </div>
    <div class="visor-cuerpo">
      @if (cargando()) {
        <div class="visor-estado"><mat-spinner diameter="36"></mat-spinner><span>Abriendo documento…</span></div>
      } @else if (error()) {
        <div class="visor-estado visor-error"><mat-icon>error_outline</mat-icon><span>{{ error() }}</span></div>
      } @else if (url()) {
        @if (esImagen) {
          <img class="visor-imagen" [src]="url()" alt="Documento {{ doc.cedula }}">
        } @else if (esPdf) {
          <iframe class="visor-pdf" [src]="url()" title="Documento {{ doc.cedula }}"></iframe>
        } @else {
          <div class="visor-estado"><mat-icon>insert_drive_file</mat-icon>
            <span>Este tipo de archivo ({{ doc.extension }}) no se puede previsualizar. Usa «Descargar».</span></div>
        }
      }
    </div>
    <p class="visor-pie">Ruta original: <code>{{ doc.ruta_original }}</code></p>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: min(88vh, 960px); background: var(--surface); color: var(--text); }
    .visor-cabecera { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
    .visor-titulo { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .visor-titulo strong { display: block; }
    .visor-sub { display: block; font-size: 12px; color: var(--text-faint); }
    .visor-acciones { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
    .visor-cuerpo { flex: 1; min-height: 0; background: var(--surface-3); }
    .visor-pdf { width: 100%; height: 100%; border: 0; background: #fff; }
    .visor-imagen { display: block; max-width: 100%; max-height: 100%; margin: 0 auto; object-fit: contain; }
    .visor-estado { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: var(--text-faint); padding: 24px; text-align: center; }
    .visor-error { color: var(--danger); }
    .visor-pie { margin: 0; padding: 8px 16px; font-size: 11px; color: var(--text-faint); border-top: 1px solid var(--border); overflow-wrap: anywhere; }
    @media (max-width: 640px) { .visor-acciones button[mat-stroked-button] { padding: 0 8px; } }
  `],
})
export class VisorArchivoDialogComponent implements OnDestroy {
  readonly doc = inject<DocumentoArchivo>(MAT_DIALOG_DATA);
  private readonly api = inject(ArchivoHistoricoService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly url = signal<SafeResourceUrl | null>(null);
  private urlCruda: string | null = null;

  readonly esPdf = (this.doc.extension ?? '').toLowerCase() === 'pdf' || (this.doc.extension ?? '').toLowerCase() === 'com';
  readonly esImagen = ['jpg', 'jpeg', 'png'].includes((this.doc.extension ?? '').toLowerCase());
  readonly tramite = etiqueta(ETIQUETA_TRAMITE, this.doc.tramite);
  readonly empresa = etiqueta(ETIQUETA_EMPRESA, this.doc.empresa);
  readonly periodo = this.doc.anio && this.doc.mes ? `${this.doc.anio}-${String(this.doc.mes).padStart(2, '0')}` : '';

  constructor() {
    this.api.archivo(this.doc.id).subscribe({
      next: blob => {
        this.urlCruda = URL.createObjectURL(blob);
        this.url.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.urlCruda));
        this.cargando.set(false);
      },
      error: e => {
        this.error.set(e?.status === 404 ? 'El archivo no está disponible en el servidor.' :
                       e?.status === 401 ? 'Tu sesión venció: vuelve a ingresar.' : 'No se pudo abrir el documento.');
        this.cargando.set(false);
      },
    });
  }

  descargar(): void {
    this.api.archivo(this.doc.id, true).subscribe(blob => {
      const u = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = u;
      a.download = `${this.doc.cedula || 'documento'}_${this.doc.tramite || ''}_${this.doc.fecha || this.periodo}.${this.esPdf ? 'pdf' : this.doc.extension}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(u), 1000);
    });
  }

  ngOnDestroy(): void {
    if (this.urlCruda) URL.revokeObjectURL(this.urlCruda);
  }
}
