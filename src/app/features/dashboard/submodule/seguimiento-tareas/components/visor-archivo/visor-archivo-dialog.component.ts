import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TareasApiService } from '../../services/tareas-api.service';
import { ModoVista, iconoArchivo, mensajeError, modoVista, tamano } from '../../utils/tareas-ui';

/** Un archivo a mostrar: ya subido (uuid) o local, todavía sin subir (File). */
export interface ArchivoVisor {
  nombre: string;
  mime: string | null;
  tamano: number;
  uuid?: string;
  archivo?: File;
}

interface Hoja { nombre: string; filas: string[][] }

/**
 * Vista previa de archivos de cualquier tipo, con navegación entre los archivos de la tarea
 * o del tablero. Imagen, PDF, video y audio se ven tal cual; Excel y CSV como tabla; Word y
 * PowerPoint como texto (lo extrae el servidor); el resto ofrece descargar.
 */
@Component({
  selector: 'app-visor-archivo-dialog',
  standalone: true,
  imports: [MatDialogModule, MatIconModule, MatButtonModule, MatTooltipModule, MatProgressSpinnerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let a = actual();
    <div class="va">
      <header class="va-cab">
        <mat-icon class="va-ico">{{ icono(a) }}</mat-icon>
        <div class="va-tit">
          <strong [title]="a.nombre">{{ a.nombre }}</strong>
          <small>{{ tamano(a.tamano) }}{{ data.archivos.length > 1 ? ' · ' + (indice() + 1) + ' de ' + data.archivos.length : '' }}</small>
        </div>
        @if (data.archivos.length > 1) {
          <button mat-icon-button (click)="mover(-1)" aria-label="Anterior" matTooltip="Anterior (←)"><mat-icon>chevron_left</mat-icon></button>
          <button mat-icon-button (click)="mover(1)" aria-label="Siguiente" matTooltip="Siguiente (→)"><mat-icon>chevron_right</mat-icon></button>
        }
        @if (urlCruda()) {
          <a mat-icon-button [href]="urlCruda()" target="_blank" rel="noopener" aria-label="Abrir en otra pestaña" matTooltip="Abrir en otra pestaña"><mat-icon>open_in_new</mat-icon></a>
        }
        <button mat-icon-button (click)="descargar()" aria-label="Descargar" matTooltip="Descargar"><mat-icon>download</mat-icon></button>
        <button mat-icon-button (click)="ref.close()" aria-label="Cerrar"><mat-icon>close</mat-icon></button>
      </header>

      <div class="va-cuerpo" [attr.data-modo]="modo()">
        @if (cargando()) {
          <div class="va-centro"><mat-spinner diameter="36" /></div>
        } @else if (error()) {
          <div class="va-centro va-vacio"><mat-icon>error_outline</mat-icon><p>{{ error() }}</p></div>
        } @else {
          @switch (modo()) {
            @case ('imagen') { <img class="va-img" [src]="url()" [alt]="a.nombre"> }
            @case ('pdf') { <iframe class="va-frame" [src]="url()" [title]="a.nombre"></iframe> }
            @case ('video') { <video class="va-media" [src]="url()" controls></video> }
            @case ('audio') { <div class="va-centro"><mat-icon class="va-grande">audiotrack</mat-icon><audio [src]="url()" controls></audio></div> }
            @case ('texto') { <pre class="va-texto">{{ texto() }}</pre> }
            @case ('html') {
              <!-- Página renderizada en un marco aislado: sin scripts, formularios ni navegación. -->
              <iframe class="va-frame" sandbox="" [src]="url()" [title]="a.nombre"></iframe>
            }
            @case ('documento') {
              @if (texto()) {
                <p class="va-nota"><mat-icon>info</mat-icon>Vista de texto del documento (sin formato). Descárgalo para verlo con su diseño original.</p>
                <pre class="va-texto va-texto--doc">{{ texto() }}</pre>
              } @else {
                <div class="va-centro va-vacio"><mat-icon>description</mat-icon><p>{{ a.uuid ? 'Este documento no tiene texto legible.' : 'La vista previa de Word y PowerPoint está disponible después de guardar el archivo.' }}</p></div>
              }
            }
            @case ('hoja') {}
            @case ('csv') {}
            @default {
              <div class="va-centro va-vacio">
                <mat-icon class="va-grande">{{ icono(a) }}</mat-icon>
                <p>No hay vista previa para este tipo de archivo.</p>
                <button mat-flat-button (click)="descargar()"><mat-icon>download</mat-icon>Descargar</button>
              </div>
            }
          }
          @if (hojas().length) {
            @if (hojas().length > 1) {
              <div class="va-hojas">
                @for (h of hojas(); track h.nombre; let i = $index) {
                  <button type="button" [class.va-hoja--on]="hoja() === i" (click)="hoja.set(i)">{{ h.nombre }}</button>
                }
              </div>
            }
            <div class="va-tabla-wrap">
              <table class="va-tabla">
                @for (f of hojas()[hoja()].filas; track $index; let r = $index) {
                  <tr [class.va-th]="r === 0">@for (c of f; track $index) { <td>{{ c }}</td> }</tr>
                }
              </table>
            </div>
            @if (recortado()) { <p class="va-nota"><mat-icon>info</mat-icon>Se muestran las primeras 300 filas.</p> }
          }
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .va { display: flex; flex-direction: column; height: min(86vh, 900px); width: 100%; font-family: var(--font-sans); }
    .va-cab { display: flex; align-items: center; gap: 6px; padding: 10px 12px 10px 18px; border-bottom: 1px solid var(--border); }
    .va-ico { color: var(--muted); }
    .va-tit { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .va-tit strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
    .va-tit small { color: var(--muted); font-size: 12px; }
    .va-cuerpo { flex: 1; min-height: 0; overflow: auto; background: var(--surface-3); display: flex; flex-direction: column; }
    .va-centro { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 24px; }
    .va-vacio { color: var(--muted); text-align: center; }
    .va-vacio mat-icon { font-size: 44px; width: 44px; height: 44px; }
    .va-grande { font-size: 64px !important; width: 64px !important; height: 64px !important; color: var(--text-faint); }
    .va-img { max-width: 100%; max-height: 100%; object-fit: contain; margin: auto; display: block; }
    .va-frame { flex: 1; width: 100%; border: 0; background: #fff; }
    .va-media { max-width: 100%; max-height: 100%; margin: auto; background: #000; }
    .va-texto { margin: 0; padding: 18px 22px; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--font-mono); font-size: 13px;
                line-height: 1.5; color: var(--text); background: var(--surface); flex: 1; }
    .va-texto--doc { font-family: var(--font-sans); font-size: 14px; max-width: 860px; margin: 0 auto; width: 100%; box-sizing: border-box; }
    .va-nota { display: flex; align-items: center; gap: 6px; margin: 0; padding: 8px 14px; font-size: 12.5px; color: var(--info-fg); background: var(--info-bg); }
    .va-nota mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .va-hojas { display: flex; gap: 4px; padding: 8px 10px 0; overflow-x: auto; }
    .va-hojas button { border: 1px solid var(--border); background: var(--surface); border-radius: 8px 8px 0 0; padding: 5px 12px; font: inherit;
                       font-size: 12.5px; font-weight: 700; color: var(--text-2); cursor: pointer; white-space: nowrap; min-height: 0 !important; }
    .va-hoja--on { background: var(--primary) !important; color: #fff !important; border-color: var(--primary) !important; }
    .va-tabla-wrap { overflow: auto; flex: 1; background: var(--surface); }
    .va-tabla { border-collapse: collapse; font-size: 12.5px; min-width: 100%; }
    .va-tabla td { border: 1px solid var(--border); padding: 4px 8px; white-space: nowrap; max-width: 320px; overflow: hidden; text-overflow: ellipsis; color: var(--text); }
    .va-th td { background: var(--surface-2); font-weight: 800; position: sticky; top: 0; }
  `],
  host: { '(document:keydown.arrowleft)': 'mover(-1)', '(document:keydown.arrowright)': 'mover(1)' },
})
export class VisorArchivoDialogComponent implements OnDestroy {
  readonly data = inject<{ archivos: ArchivoVisor[]; indice: number }>(MAT_DIALOG_DATA);
  readonly ref = inject(MatDialogRef<VisorArchivoDialogComponent>);
  private readonly api = inject(TareasApiService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly indice = signal(this.data.indice ?? 0);
  readonly actual = computed(() => this.data.archivos[this.indice()]);
  readonly modo = computed<ModoVista>(() => modoVista(this.actual().nombre, this.actual().mime));
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly url = signal<SafeResourceUrl | null>(null);
  readonly urlCruda = signal<string | null>(null);
  readonly texto = signal<string | null>(null);
  readonly hojas = signal<Hoja[]>([]);
  readonly hoja = signal(0);
  readonly recortado = signal(false);
  private blob: Blob | null = null;

  constructor() { this.cargar(); }

  ngOnDestroy(): void { this.liberar(); }

  icono(a: ArchivoVisor): string { return iconoArchivo(a.nombre, a.mime); }
  tamano = tamano;

  mover(d: number): void {
    const n = this.data.archivos.length;
    if (n < 2) return;
    this.indice.set((this.indice() + d + n) % n);
    this.cargar();
  }

  /** Blob de la vista previa HTML: no se ofrece "abrir en otra pestaña" (ahí sí se ejecutaría). */
  private urlHtml: string | null = null;

  private liberar(): void {
    const u = this.urlCruda();
    if (u) URL.revokeObjectURL(u);
    if (this.urlHtml) URL.revokeObjectURL(this.urlHtml);
    this.urlHtml = null;
    this.url.set(null);
    this.urlCruda.set(null);
  }

  private async cargar(): Promise<void> {
    this.liberar();
    this.cargando.set(true);
    this.error.set(null);
    this.texto.set(null);
    this.hojas.set([]);
    this.hoja.set(0);
    this.recortado.set(false);
    const a = this.actual();
    try {
      this.blob = a.archivo ?? (a.uuid ? await this.api.descargarAdjunto(a.uuid) : null);
      if (!this.blob) throw new Error('Archivo no disponible');
      const modo = this.modo();
      if (modo === 'imagen' || modo === 'pdf' || modo === 'video' || modo === 'audio') {
        // El blob debe llevar el tipo correcto o el navegador no lo muestra en línea.
        const tipo = a.mime || (modo === 'pdf' ? 'application/pdf' : this.blob.type);
        const u = URL.createObjectURL(tipo && this.blob.type !== tipo ? new Blob([this.blob], { type: tipo }) : this.blob);
        this.urlCruda.set(u);
        this.url.set(this.sanitizer.bypassSecurityTrustResourceUrl(u));
      } else if (modo === 'html') {
        // Como blob text/html dentro de un iframe con sandbox vacío: se ve con su diseño, sin ejecutar nada.
        const u = URL.createObjectURL(new Blob([await this.blob.text()], { type: 'text/html' }));
        this.urlHtml = u;
        this.url.set(this.sanitizer.bypassSecurityTrustResourceUrl(u));
      } else if (modo === 'texto') {
        const t = await this.blob.text();
        this.texto.set(t.length > 400_000 ? t.slice(0, 400_000) + '\n… (recortado)' : t);
      } else if (modo === 'csv') {
        this.mostrarTabla([{ nombre: a.nombre, filas: this.csv(await this.blob.text()) }]);
      } else if (modo === 'hoja') {
        const XLSX = await import('xlsx');
        const wb = XLSX.read(await this.blob.arrayBuffer(), { type: 'array' });
        this.mostrarTabla(wb.SheetNames.map(n => ({
          nombre: n,
          filas: (XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: false }) as unknown[][])
            .map(f => f.map(c => String(c ?? ''))),
        })));
      } else if (modo === 'documento' && a.uuid) {
        const r = await this.api.textoArchivo(a.uuid);
        this.texto.set(r.texto);
      }
    } catch (e) {
      this.error.set(mensajeError(e, 'No se pudo abrir el archivo.'));
    } finally {
      this.cargando.set(false);
    }
  }

  private mostrarTabla(hojas: Hoja[]): void {
    let recortado = false;
    this.hojas.set(hojas.map(h => {
      if (h.filas.length > 300) recortado = true;
      return { nombre: h.nombre, filas: h.filas.slice(0, 300) };
    }));
    this.recortado.set(recortado);
  }

  private csv(t: string): string[][] {
    const sep = (t.split('\n')[0].match(/;/g)?.length ?? 0) > (t.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ',';
    const filas: string[][] = [];
    let fila: string[] = [], campo = '', comillas = false;
    for (let i = 0; i < t.length && filas.length < 301; i++) {
      const ch = t[i];
      if (comillas) {
        if (ch === '"' && t[i + 1] === '"') { campo += '"'; i++; }
        else if (ch === '"') comillas = false;
        else campo += ch;
      } else if (ch === '"') comillas = true;
      else if (ch === sep) { fila.push(campo); campo = ''; }
      else if (ch === '\n') { fila.push(campo.replace(/\r$/, '')); filas.push(fila); fila = []; campo = ''; }
      else campo += ch;
    }
    if (campo || fila.length) { fila.push(campo); filas.push(fila); }
    return filas;
  }

  async descargar(): Promise<void> {
    const a = this.actual();
    const b = this.blob ?? (a.uuid ? await this.api.descargarAdjunto(a.uuid) : a.archivo ?? null);
    if (!b) return;
    const u = URL.createObjectURL(b);
    const link = document.createElement('a');
    link.href = u;
    link.download = a.nombre || 'archivo';
    link.click();
    setTimeout(() => URL.revokeObjectURL(u), 5000);
  }
}
