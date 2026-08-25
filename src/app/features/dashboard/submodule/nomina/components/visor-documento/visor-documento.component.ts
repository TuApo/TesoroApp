import {
  ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';

import { EnvioCorreosService } from '../../service/envio-correos/envio-correos.service';

export interface VisorDocumentoData {
  documentId: number;
  titulo?: string | null;
  nombreArchivo?: string | null;
  cedula?: string | null;
}

/**
 * Visor del documento interno de gestión documental.
 *
 * <h3>Por qué no es un simple `window.open`</h3>
 * `/api/v1/documents/**` NO está en `GATEWAY_AUTH_PUBLIC_PATHS`, así que el
 * gateway exige JWT. Una navegación directa (o el `src` de un iframe) no lleva
 * la cabecera `Authorization` y responde **401**: el documento no abre nunca.
 *
 * Por eso se descarga por `HttpClient` —donde el `authInterceptor` sí añade el
 * token— y se muestra desde un **object URL** local, que ya no necesita
 * autenticación. Es el patrón que usan afiliaciones y gestión documental.
 */
@Component({
  selector: 'app-visor-documento',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, MatProgressBarModule],
  templateUrl: './visor-documento.component.html',
  styleUrl: './visor-documento.component.css',
})
export class VisorDocumentoComponent implements OnDestroy {
  private srv = inject(EnvioCorreosService);
  private sanitizer = inject(DomSanitizer);
  private ref = inject(MatDialogRef<VisorDocumentoComponent>);
  readonly data = inject<VisorDocumentoData>(MAT_DIALOG_DATA);

  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly urlSegura = signal<SafeResourceUrl | null>(null);

  /** Se libera en ngOnDestroy: si no, el blob queda en memoria toda la sesión. */
  private objectUrl: string | null = null;

  readonly titulo = computed(() =>
    this.data.titulo || this.data.nombreArchivo || `Documento ${this.data.documentId}`);

  constructor() {
    this.abrir();
  }

  private async abrir(): Promise<void> {
    try {
      const blob = await firstValueFrom(this.srv.descargarDocumento(this.data.documentId));
      this.objectUrl = URL.createObjectURL(blob);
      this.urlSegura.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.objectUrl));
    } catch (e: any) {
      this.error.set(e?.status === 404
        ? 'El documento ya no existe en gestión documental.'
        : 'No se pudo abrir el documento.');
    } finally {
      this.cargando.set(false);
    }
  }

  /** Descarga el fichero al equipo, reutilizando el blob ya traído. */
  descargar(): void {
    if (!this.objectUrl) return;
    const a = document.createElement('a');
    a.href = this.objectUrl;
    a.download = this.data.nombreArchivo || `documento-${this.data.documentId}.pdf`;
    a.click();
  }

  cerrar(): void {
    this.ref.close();
  }

  ngOnDestroy(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
  }
}
