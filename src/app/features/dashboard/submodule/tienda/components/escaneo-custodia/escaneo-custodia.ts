import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { reducir } from '../../../../../economiapp/components/eco-captura-rostro';
import { DocumentoCustodia, TiendaService } from '../../service/tienda.service';

interface Hoja {
  nombre: string; blob: Blob; vista: string;
  estado: 'esperando' | 'subiendo' | 'ok' | 'sin_qr' | 'error';
  numero?: string; huella?: string; qr?: boolean; mensaje?: string; asignar?: string;
}

/**
 * Digitalizar por lotes los papeles firmados: se sube el PDF del escáner (o fotos), cada
 * página va al servidor, que lee el QR de la hoja ("SPB:numero:id") y la pega a su solicitud
 * con la huella sha256 del archivo. La hoja sin QR legible se asigna a mano.
 */
@Component({
  selector: 'app-escaneo-custodia',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule],
  styleUrls: ['../../styles/tienda-comun.css'],
  template: `
    <section class="tienda-tarjeta escaneo">
      <div class="cab">
        <h2><mat-icon>document_scanner</mat-icon> Digitalizar papeles firmados</h2>
        <button type="button" class="x" (click)="cerrar.emit()" aria-label="Cerrar"><mat-icon>close</mat-icon></button>
      </div>
      <p class="muted">Suba el PDF del escáner (varias hojas) o fotos. Cada hoja de la solicitud trae un QR: con él sabemos a qué préstamo pertenece y guardamos el archivo con su huella.</p>
      <div class="entradas">
        <label class="boton"><mat-icon>upload_file</mat-icon> PDF o imágenes
          <input type="file" accept="application/pdf,image/*" multiple hidden (change)="elegir($event)" /></label>
        <label class="boton secundario"><mat-icon>photo_camera</mat-icon> Tomar foto
          <input type="file" accept="image/*" capture="environment" hidden (change)="elegir($event)" /></label>
      </div>
      @if (preparando()) { <p class="muted">Preparando las páginas…</p> }
      @if (hojas().length) {
        <ul class="hojas">
          @for (h of hojas(); track $index) {
            <li [attr.data-e]="h.estado">
              <img [src]="h.vista" alt="" />
              <div class="info">
                <b>{{ h.nombre }}</b>
                @switch (h.estado) {
                  @case ('esperando') { <small>En cola</small> }
                  @case ('subiendo') { <small>Leyendo el QR…</small> }
                  @case ('ok') { <small class="ok"><mat-icon>check_circle</mat-icon> {{ h.numero }} · {{ h.qr ? 'QR leído' : 'asignada a mano' }} · #{{ h.huella }}</small> }
                  @case ('error') { <small class="mal">{{ h.mensaje }}</small> }
                  @case ('sin_qr') {
                    <small class="mal">{{ h.mensaje }}</small>
                    <div class="asignar">
                      <select [ngModel]="h.asignar" (ngModelChange)="h.asignar = $event">
                        <option [ngValue]="undefined">¿De cuál solicitud es?</option>
                        @for (d of documentos(); track d.id) { <option [ngValue]="d.id">{{ d.numero }} · {{ d.nombre }} · {{ d.cedula }}</option> }
                      </select>
                      <button type="button" class="boton secundario" [disabled]="!h.asignar" (click)="subir(h, h.asignar)">Asignar</button>
                    </div>
                  }
                }
              </div>
            </li>
          }
        </ul>
        <p class="muted">{{ hechas() }} de {{ hojas().length }} hojas digitalizadas.</p>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .escaneo { display: flex; flex-direction: column; gap: 10px; }
    .cab { display: flex; justify-content: space-between; align-items: center; }
    .cab h2 { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 16px; }
    .x { border: 0; background: none; cursor: pointer; color: var(--muted); }
    .muted { color: var(--muted); font-size: 12.5px; margin: 0; }
    .entradas { display: flex; flex-wrap: wrap; gap: 8px; }
    .entradas .boton { cursor: pointer; flex: 1 1 160px; justify-content: center; }
    .hojas { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 420px; overflow: auto; }
    .hojas li { display: flex; gap: 10px; align-items: center; padding: 6px; border: 1px solid var(--border); border-radius: 10px; }
    .hojas li[data-e='ok'] { border-color: #86efac; }
    .hojas li[data-e='sin_qr'], .hojas li[data-e='error'] { border-color: #fca5a5; }
    .hojas img { width: 48px; height: 62px; object-fit: cover; border-radius: 6px; background: #f1f5f9; flex: none; }
    .info { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; font-size: 13px; }
    .info b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ok { color: #047857; display: inline-flex; align-items: center; gap: 4px; }
    .ok mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .mal { color: #b91c1c; }
    .asignar { display: flex; flex-wrap: wrap; gap: 6px; }
    .asignar select { flex: 1 1 200px; min-height: 40px; max-width: 100%; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text); }
  `],
})
export class EscaneoCustodia {
  private api = inject(TiendaService);
  /** Solicitudes candidatas para asignar a mano una hoja sin QR legible. */
  readonly documentos = input<DocumentoCustodia[]>([]);
  readonly cerrar = output<void>();
  readonly cambio = output<void>();
  readonly hojas = signal<Hoja[]>([]);
  readonly preparando = signal(false);

  hechas(): number { return this.hojas().filter(h => h.estado === 'ok').length; }

  async elegir(ev: Event): Promise<void> {
    const archivos = Array.from((ev.target as HTMLInputElement).files ?? []);
    (ev.target as HTMLInputElement).value = '';
    if (!archivos.length) return;
    this.preparando.set(true);
    const nuevas: Hoja[] = [];
    try {
      for (const a of archivos) {
        if (a.type === 'application/pdf' || a.name.toLowerCase().endsWith('.pdf')) {
          (await paginasPdf(a)).forEach((b, i) => nuevas.push(this.hoja(`${a.name} · pág. ${i + 1}`, b)));
        } else {
          nuevas.push(this.hoja(a.name, await reducir(a, 2400)));
        }
      }
    } catch { /* un PDF dañado: se informa en la hoja */ }
    finally { this.preparando.set(false); }
    this.hojas.update(h => [...h, ...nuevas]);
    for (const h of nuevas) await this.subir(h);
    this.cambio.emit();
  }

  private hoja(nombre: string, blob: Blob): Hoja {
    return { nombre, blob, vista: URL.createObjectURL(blob), estado: 'esperando' };
  }

  async subir(h: Hoja, documentoId?: string): Promise<void> {
    this.actualizar(h, { estado: 'subiendo', mensaje: undefined });
    try {
      const r = await firstValueFrom(this.api.escanearCustodia(h.blob, h.nombre.replace(/[^\w.-]+/g, '_') + '.jpg', documentoId));
      if (!r.identificado) this.actualizar(h, { estado: 'sin_qr', mensaje: r.mensaje ?? 'No se leyó el QR de la hoja' });
      else this.actualizar(h, { estado: 'ok', numero: r.numero, qr: !!r.qr_leido, huella: (r.escaneo_sha256 ?? '').slice(0, 12) });
      if (documentoId) this.cambio.emit();
    } catch (e: any) {
      this.actualizar(h, { estado: documentoId ? 'sin_qr' : 'error', mensaje: e?.error?.error ?? 'No se pudo subir la hoja' });
    }
  }

  private actualizar(h: Hoja, cambios: Partial<Hoja>): void {
    Object.assign(h, cambios);
    this.hojas.update(l => [...l]);
  }
}

/** Cada página del PDF del escáner como JPEG (a ~200 ppp para que el QR se lea). */
async function paginasPdf(archivo: Blob): Promise<Blob[]> {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerPort) {
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(
      // Ruta relativa: el bundler de workers no resuelve especificadores de paquete.
      new URL('../../../../../../../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' });
  }
  const tarea = pdfjs.getDocument({ data: new Uint8Array(await archivo.arrayBuffer()) });
  const salida: Blob[] = [];
  try {
    const pdf = await tarea.promise;
    for (let n = 1; n <= Math.min(pdf.numPages, 60); n++) {
      const page = await pdf.getPage(n);
      const ancho = page.getViewport({ scale: 1 }).width;
      const viewport = page.getViewport({ scale: Math.min(3, 1700 / ancho) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      salida.push(await new Promise<Blob>((ok, mal) => canvas.toBlob(b => b ? ok(b) : mal(new Error('sin imagen')), 'image/jpeg', 0.9)));
    }
  } finally { void tarea.destroy(); }
  return salida;
}
