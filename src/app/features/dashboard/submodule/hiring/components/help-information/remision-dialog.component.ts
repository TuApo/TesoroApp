/**
 * Genera la REMISIÓN PARA ENTREVISTA Y/O PRUEBA TÉCNICA (Apoyo / Tu Alianza).
 *
 * Llega con todo prellenado desde la vacante y el candidato; lo que el sistema
 * no sabe (a quién preguntar en la empresa, el consecutivo del formato) queda
 * como campo editable, y todo lo demás se puede corregir antes de imprimir sin
 * tener que volver al formulario.
 *
 * La temporal se deduce de la vacante (empresa usuaria / temporal) porque es lo
 * que decide el logo y el código del formato; igual se puede cambiar a mano.
 */
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import QRCode from 'qrcode';
import Swal from 'sweetalert2';

import { ElectronWindowService } from '@/app/core/services/electron-window.service';
import { DatosRemision, TemporalRemision, buildRemisionPdf } from './remision-fill';

/**
 * A dónde apunta el QR del formato: el formulario público de contratación.
 * Se muestra en el diálogo para poder verificarlo/cambiarlo antes de imprimir.
 */
const URL_REGISTRO_DEFAULT = 'https://formulario.tsservicios.co/dashboard/formulario';

const LOGOS: Record<TemporalRemision, string> = {
  apoyo: 'logos/Logo_AL.png',
  alianza: 'logos/Logo_TA.png',
};

export type RemisionDialogData = Partial<Omit<DatosRemision, 'logoDataUrl' | 'qrDataUrl'>>;

@Component({
  selector: 'app-remision-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatButtonToggleModule,
    MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule, MatTooltipModule,
  ],
  template: `
    <div class="rm-wrap">
      <header class="rm-head">
        <span class="rm-head-ic"><mat-icon>assignment</mat-icon></span>
        <div class="rm-head-txt">
          <h2>Remisión para entrevista y/o prueba técnica</h2>
          <p>Revisa los datos y genera el formato para imprimir.</p>
        </div>
        <button mat-icon-button class="rm-cerrar" (click)="cerrar()" aria-label="Cerrar">
          <mat-icon>close</mat-icon>
        </button>
      </header>

      <mat-dialog-content class="rm-body">
        <p class="rm-label">Temporal</p>
        <mat-button-toggle-group class="rm-temporal" [value]="d().temporal"
          (change)="set('temporal', $event.value)">
          <mat-button-toggle value="apoyo">Apoyo Laboral TS · AL SE-RE-4</mat-button-toggle>
          <mat-button-toggle value="alianza">Tu Alianza SAS · TA SE-RE-4</mat-button-toggle>
        </mat-button-toggle-group>

        <div class="rm-grid">
          <mat-form-field appearance="outline">
            <mat-label>Fecha</mat-label>
            <input matInput [ngModel]="d().fecha" (ngModelChange)="set('fecha', $event)" placeholder="dd/mm/aaaa">
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Código de contrato</mat-label>
            <input matInput [ngModel]="d().consecutivo" (ngModelChange)="set('consecutivo', $event)">
            <mat-hint>Va en el recuadro del formato. Vacío = recuadro en blanco.</mat-hint>
          </mat-form-field>

          <mat-form-field appearance="outline" class="rm-ancho">
            <mat-label>Empresa usuaria</mat-label>
            <input matInput [ngModel]="d().empresaUsuaria" (ngModelChange)="set('empresaUsuaria', $event)">
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Cargo</mat-label>
            <input matInput [ngModel]="d().cargo" (ngModelChange)="set('cargo', $event)">
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Experiencia en el sector</mat-label>
            <mat-select [ngModel]="d().experienciaSector" (ngModelChange)="set('experienciaSector', $event)">
              <mat-option value="SI">SI</mat-option>
              <mat-option value="NO">NO</mat-option>
              <mat-option value="">Sin dato</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>¿Cuánto tiempo?</mat-label>
            <input matInput [ngModel]="d().tiempoExperiencia" (ngModelChange)="set('tiempoExperiencia', $event)">
          </mat-form-field>

          <mat-form-field appearance="outline" class="rm-ancho">
            <mat-label>Nombre del candidato</mat-label>
            <input matInput [ngModel]="d().nombreCandidato" (ngModelChange)="set('nombreCandidato', $event)">
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Cédula</mat-label>
            <input matInput [ngModel]="d().cedula" (ngModelChange)="set('cedula', $event)">
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Área</mat-label>
            <input matInput [ngModel]="d().area" (ngModelChange)="set('area', $event)">
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Día</mat-label>
            <input matInput [ngModel]="d().dia" (ngModelChange)="set('dia', $event)" placeholder="dd/mm/aaaa">
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Hora</mat-label>
            <input matInput [ngModel]="d().hora" (ngModelChange)="set('hora', $event)" placeholder="HH:mm">
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Preguntar por</mat-label>
            <input matInput [ngModel]="d().preguntarPor" (ngModelChange)="set('preguntarPor', $event)">
          </mat-form-field>
          <mat-form-field appearance="outline" class="rm-ancho2">
            <mat-label>Dirección de la empresa</mat-label>
            <input matInput [ngModel]="d().direccionEmpresa" (ngModelChange)="set('direccionEmpresa', $event)">
          </mat-form-field>

          <mat-form-field appearance="outline" class="rm-ancho2">
            <mat-label>Gestión humana (firma)</mat-label>
            <input matInput [ngModel]="d().gestionHumana" (ngModelChange)="set('gestionHumana', $event)">
          </mat-form-field>

          <mat-form-field appearance="outline" class="rm-completo">
            <mat-label>URL del código QR</mat-label>
            <input matInput [ngModel]="urlQR()" (ngModelChange)="urlQR.set($event)">
            <mat-hint>Es la página de registro que abre el QR. Verifícala antes de imprimir.</mat-hint>
          </mat-form-field>
        </div>
      </mat-dialog-content>

      <mat-dialog-actions class="rm-actions">
        <button mat-button (click)="cerrar()">Cancelar</button>
        <span class="rm-spacer"></span>
        <button mat-flat-button class="rm-generar" [disabled]="generando()" (click)="generar()">
          <mat-icon>picture_as_pdf</mat-icon>
          {{ generando() ? 'Generando…' : 'Generar remisión' }}
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    :host { --azul: #21263c; --linea: light-dark(#e8edf3, #233e63); display: block; }

    /* El ancho lo fija el panel del MatDialog (ver dialog.open en
       help-information). Acá solo se ocupa el espacio disponible: si se fija
       un px propio, cuando el panel es más angosto (maxWidth por defecto de
       Material = 80vw) el contenido se sale y se corta por la derecha. */
    .rm-wrap { width: 100%; max-width: 100%; box-sizing: border-box; }

    .rm-head {
      position: relative; display: flex; align-items: center; gap: 14px;
      padding: 18px 52px 16px 20px; color: #fff;
      background: linear-gradient(135deg, #21263c 0%, #343c5c 100%);
    }
    .rm-head-txt { min-width: 0; }
    .rm-head-ic {
      display: grid; place-items: center; width: 42px; height: 42px;
      border-radius: 12px; background: rgba(255,255,255,.16);
      border: 1px solid rgba(255,255,255,.22); flex: 0 0 auto;
    }
    .rm-head-txt h2 { margin: 0; font-size: 1.02rem; font-weight: 700; }
    .rm-head-txt p { margin: 3px 0 0; font-size: .78rem; color: rgba(255,255,255,.8); }
    .rm-cerrar { position: absolute; top: 8px; right: 8px; color: rgba(255,255,255,.75); }

    .rm-body { padding: 16px 20px 4px !important; max-height: 66vh; overflow-x: hidden; }

    .rm-label {
      margin: 0 0 8px; font-size: .72rem; font-weight: 700; letter-spacing: .6px;
      text-transform: uppercase; color: var(--muted);
    }

    .rm-temporal { width: 100%; margin-bottom: 16px; }
    /* flex-wrap: los dos rótulos ("Apoyo Laboral TS · AL SE-RE-4") no caben en
       una línea cuando la ventana es angosta y empujaban el diálogo a lo ancho. */
    .rm-temporal { display: flex; flex-wrap: wrap; }
    .rm-temporal .mat-button-toggle { flex: 1 1 220px; min-width: 0; }

    .rm-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px 12px;
    }
    /* min-width:0 — un grid item por defecto no baja de su contenido mínimo, y
       los mat-form-field con texto largo desbordaban la columna. */
    .rm-grid > * { min-width: 0; }
    .rm-ancho { grid-column: span 2; }
    .rm-ancho2 { grid-column: span 2; }
    .rm-completo { grid-column: 1 / -1; }

    .rm-actions {
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      padding: 12px 20px 16px !important; border-top: 1px solid var(--linea); background: var(--surface);
    }
    .rm-spacer { flex: 1; }
    .rm-generar {
      --mdc-filled-button-container-color: var(--azul);
      background: var(--azul); color: #fff; font-weight: 600;
      border-radius: 999px; padding: 0 22px; height: 42px;
    }
    .rm-generar[disabled] { opacity: .45; }

    @media (max-width: 700px) {
      .rm-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .rm-ancho, .rm-ancho2 { grid-column: span 2; }
    }
    @media (max-width: 460px) {
      .rm-grid { grid-template-columns: minmax(0, 1fr); }
      .rm-ancho, .rm-ancho2, .rm-completo { grid-column: span 1; }
      .rm-head { padding: 14px 46px 12px 14px; }
      .rm-body { padding: 14px 14px 4px !important; }
      .rm-actions { padding: 12px 14px 14px !important; }
    }
  `],
})
export class RemisionDialogComponent {
  readonly d = signal<DatosRemision>({
    temporal: 'apoyo',
    fecha: '', empresaUsuaria: '', cargo: '', experienciaSector: '', tiempoExperiencia: '',
    nombreCandidato: '', cedula: '', area: '', dia: '', hora: '', preguntarPor: '',
    direccionEmpresa: '', gestionHumana: '', consecutivo: '',
  });

  readonly urlQR = signal(URL_REGISTRO_DEFAULT);
  readonly generando = signal(false);

  constructor(
    private readonly ref: MatDialogRef<RemisionDialogComponent, boolean>,
    private readonly ventanas: ElectronWindowService,
    @Inject(MAT_DIALOG_DATA) data: RemisionDialogData,
  ) {
    this.d.set({ ...this.d(), ...(data ?? {}) } as DatosRemision);
  }

  set<K extends keyof DatosRemision>(campo: K, valor: DatosRemision[K]): void {
    this.d.set({ ...this.d(), [campo]: valor });
  }

  /**
   * El PDF se abre por `ElectronWindowService`, no por `window.open`: el main
   * process de TesoroApp deniega TODO `window.open` (`setWindowOpenHandler` en
   * app.js) y las URLs blob: no se pueden delegar al navegador del SO, así que
   * el botón no abría nada. La fachada usa `pdf.openInWindow` (BrowserWindow
   * hija) en Electron y cae a blob + window.open solo fuera de Electron.
   *
   * El try/catch es necesario: la app no registra un ErrorHandler global, así
   * que un throw de jsPDF dejaba el diálogo mudo, sin PDF y sin mensaje.
   */
  async generar(): Promise<void> {
    this.generando.set(true);
    try {
      const [logoDataUrl, qrDataUrl] = await Promise.all([
        this.aDataUrl(LOGOS[this.d().temporal]),
        this.qr(this.urlQR()),
      ]);

      const blob = buildRemisionPdf({ ...this.d(), logoDataUrl, qrDataUrl });
      await this.ventanas.openPdfFromBlob(blob, { title: 'Remisión para entrevista' });
      this.ref.close(true);
    } catch (e) {
      console.error('[remision] no se pudo generar el formato', e);
      Swal.fire(
        'No se pudo generar la remisión',
        'Revisa los datos del formato e intenta de nuevo.',
        'error',
      );
    } finally {
      this.generando.set(false);
    }
  }

  /** El PDF se genera igual si el logo o el QR fallan: no se bloquea la impresión. */
  private async aDataUrl(url: string): Promise<string | null> {
    try {
      const resp = await fetch(url);
      if (!resp.ok) return null;
      const buf = await resp.arrayBuffer();
      let bin = '';
      const u8 = new Uint8Array(buf);
      for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
      return `data:image/png;base64,${btoa(bin)}`;
    } catch {
      return null;
    }
  }

  private async qr(texto: string): Promise<string | null> {
    const t = String(texto ?? '').trim();
    if (!t) return null;
    try {
      return await QRCode.toDataURL(t, { margin: 1, width: 420, errorCorrectionLevel: 'M' });
    } catch {
      return null;
    }
  }

  cerrar(): void {
    this.ref.close(false);
  }
}
