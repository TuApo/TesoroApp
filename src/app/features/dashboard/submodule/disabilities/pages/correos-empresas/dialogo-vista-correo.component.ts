/**
 * Vista de un correo tal como llega al buzon (lectura estilo Gmail), para usarla como SOPORTE
 * del envio (revision funcional 2026-09-28): remitente, para/cc, fecha, el HTML exacto que se
 * envio y los adjuntos reales con la miniatura de su primera pagina. Se guarda como PDF
 * (dialogo de impresion) o como imagen PNG.
 *
 * La vista se pinta en un iframe aislado (sandbox, sin scripts). Para imprimir y para la imagen
 * se arma un iframe aparte del mismo origen con el mismo documento (cuerpo saneado).
 */
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { saveAs } from 'file-saver';
import { firstValueFrom } from 'rxjs';

import { AdjuntoCorreo } from '../../models/incapacidad-gestion.model';
import { IncapacidadGestionService } from '../../services/incapacidad-gestion/incapacidad-gestion.service';
import { componerCorreoGmail, listaCorreos, sanearCuerpo } from './correo-gmail';

/** Nombre con el que salen las cuentas del pool de correspondencia (admin_correo_cuenta). */
export const NOMBRE_REMITENTE = 'Correspondencia TuApo';
/** Tope de miniaturas: cada una baja el PDF y lo pinta con pdf.js. */
const MAX_MINIATURAS = 12;

export interface DatosVistaCorreo {
  titulo: string;
  asunto: string | null;
  destinatario: string | null;
  copias: string[] | string | null;
  cuerpoHtml: string;
  estado?: string | null;
  mensajeError?: string | null;
  /** Cuenta que lo envio (null en envios viejos o en la vista previa). */
  remitente?: string | null;
  /** Instante ISO del envio; null = aun no se envia (vista previa del lote de hoy). */
  enviadoEn?: string | null;
  modo?: 'PRUEBA' | 'ACTIVO' | null;
  /** "Lote #2", "Envio #3"... para el pie del soporte. */
  referencia?: string | null;
  /** De donde salen los adjuntos: del envio/lote real, o solo nombres (vista previa). */
  adjuntos?: { tipo: 'envio' | 'lote'; id: number } | { nombres: string[] } | null;
}

interface AdjuntoCargado {
  nombre: string;
  documentId: number | null;
  miniatura: string | null;
}

@Component({
  selector: 'app-dialogo-vista-correo',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title class="vc-titulo"><mat-icon>mail</mat-icon> {{ datos.titulo }}</h2>
    <mat-dialog-content class="vc-contenido">
      <div class="vc-estado">
        @if (datos.estado) {
          <span class="vc-chip" [attr.data-estado]="datos.estado">{{ datos.estado }}</span>
        } @else if (!datos.enviadoEn) {
          <span class="vc-chip" data-estado="PREVIA">VISTA PREVIA · aún no se envía</span>
        }
        @if (datos.modo === 'PRUEBA') {
          <span class="vc-nota"><mat-icon>science</mat-icon> Modo prueba: salió a la casilla de pruebas; el destinatario real va anotado en el cuerpo.</span>
        }
        @if (datos.mensajeError) { <span class="vc-error">{{ datos.mensajeError }}</span> }
      </div>

      <iframe class="vc-marco" title="Correo como se ve en el buzón" sandbox="" [srcdoc]="vista()"></iframe>

      @if (adjuntos().length) {
        <div class="vc-adjuntos">
          <span class="vc-adj-titulo"><mat-icon>attach_file</mat-icon> Adjuntos</span>
          @for (a of adjuntos(); track a.nombre) {
            @if (a.documentId !== null) {
              <button type="button" mat-stroked-button class="vc-adj" (click)="descargarAdjunto(a)"
                      [matTooltip]="'Descargar ' + a.nombre">
                <mat-icon>picture_as_pdf</mat-icon><span>{{ a.nombre }}</span>
              </button>
            } @else {
              <span class="vc-adj vc-adj--pendiente"><mat-icon>schedule</mat-icon>{{ a.nombre }} · se adjunta al enviar</span>
            }
          }
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions class="vc-acciones">
      @if (cargandoAdjuntos()) { <span class="vc-cargando">Preparando adjuntos…</span> }
      <span class="vc-espacio"></span>
      <button mat-stroked-button type="button" (click)="descargarImagen()" [disabled]="trabajando()">
        <mat-icon>image</mat-icon> Descargar imagen
      </button>
      <button mat-stroked-button type="button" (click)="imprimir()" [disabled]="trabajando()"
              matTooltip="Abre el diálogo de impresión: elija «Guardar como PDF»">
        <mat-icon>picture_as_pdf</mat-icon> Guardar PDF
      </button>
      <button mat-flat-button color="primary" type="button" mat-dialog-close>Cerrar</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .vc-titulo { display: flex; align-items: center; gap: 8px; font-weight: 800; }
    .vc-contenido { display: flex; flex-direction: column; gap: 10px; min-width: min(980px, 92vw); }
    .vc-estado { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; font-size: 12.5px; }
    .vc-chip { padding: 2px 10px; border-radius: 999px; font-weight: 700; font-size: 11.5px; letter-spacing: .03em;
      background: rgb(var(--ink-rgb) / 0.08); color: var(--text); }
    .vc-chip[data-estado='ENVIADO'] { background: light-dark(#e6f4ea, #10301b); color: light-dark(#137333, #81c995); }
    .vc-chip[data-estado='FALLIDO'], .vc-chip[data-estado='SIN_DESTINATARIO'] { background: light-dark(#fce8e6, #3a1717); color: light-dark(#c5221f, #f28b82); }
    .vc-chip[data-estado='PREVIA'] { background: light-dark(#fef7e0, #33280a); color: light-dark(#b06000, #fdd663); }
    .vc-nota { display: inline-flex; align-items: center; gap: 4px; color: var(--muted); }
    .vc-nota mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .vc-error { color: light-dark(#c5221f, #f28b82); }
    .vc-marco { width: 100%; height: min(66vh, 720px); border: 1px solid rgb(var(--ink-rgb) / 0.12); border-radius: 10px; background: #f6f8fc; }
    .vc-adjuntos { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; }
    .vc-adj-titulo { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; font-weight: 700; color: var(--muted); }
    .vc-adj { font-size: 12.5px; max-width: 320px; }
    .vc-adj span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .vc-adj--pendiente { display: inline-flex; align-items: center; gap: 4px; color: var(--muted); }
    .vc-adj--pendiente mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .vc-acciones { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .vc-espacio { flex: 1 1 auto; }
    .vc-cargando { font-size: 12.5px; color: var(--muted); }
  `],
})
export class DialogoVistaCorreoComponent {
  readonly datos = inject<DatosVistaCorreo>(MAT_DIALOG_DATA);
  private readonly sanitizador = inject(DomSanitizer);
  private readonly srv = inject(IncapacidadGestionService);
  private readonly destroyRef = inject(DestroyRef);

  readonly adjuntos = signal<AdjuntoCargado[]>([]);
  readonly cargandoAdjuntos = signal(false);
  readonly trabajando = signal(false);

  private readonly cuerpo = sanearCuerpo(this.datos.cuerpoHtml || '<p>Sin contenido.</p>');

  /** El documento HTML completo de la vista (el mismo para pantalla, PDF e imagen). */
  readonly html = computed(() => {
    const fecha = this.datos.enviadoEn ? new Date(this.datos.enviadoEn) : null;
    return componerCorreoGmail({
      asunto: this.datos.asunto ?? '',
      remitenteNombre: NOMBRE_REMITENTE,
      remitenteCorreo: this.datos.remitente ?? null,
      para: listaCorreos(this.datos.destinatario),
      cc: listaCorreos(this.datos.copias),
      fecha: fecha && !isNaN(fecha.getTime()) ? fecha : null,
      cuerpoHtml: this.cuerpo,
      adjuntos: this.adjuntos().map((a) => ({ nombre: a.nombre, miniatura: a.miniatura })),
      pie: this.pie(),
    });
  });

  readonly vista = computed<SafeHtml>(() => this.sanitizador.bypassSecurityTrustHtml(this.html()));

  constructor() {
    this.cargarAdjuntos();
  }

  // ── Adjuntos ──────────────────────────────────────────────────────────

  private cargarAdjuntos(): void {
    const origen = this.datos.adjuntos;
    if (!origen) return;
    if ('nombres' in origen) {
      this.adjuntos.set(origen.nombres.map((nombre) => ({ nombre, documentId: null, miniatura: null })));
      return;
    }
    this.cargandoAdjuntos.set(true);
    const peticion = origen.tipo === 'lote' ? this.srv.adjuntosLote(origen.id) : this.srv.adjuntosEnvio(origen.id);
    peticion.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (lista) => {
        this.adjuntos.set(lista.map((a) => ({ nombre: a.nombre, documentId: a.documentId, miniatura: null })));
        void this.cargarMiniaturas(lista);
      },
      error: () => this.cargandoAdjuntos.set(false),
    });
  }

  private async cargarMiniaturas(lista: AdjuntoCorreo[]): Promise<void> {
    try {
      for (const a of lista.slice(0, MAX_MINIATURAS)) {
        try {
          const blob = await firstValueFrom(this.srv.descargarAdjunto(a.documentId));
          const png = await primeraPagina(blob);
          this.adjuntos.update((xs) => xs.map((x) => (x.documentId === a.documentId ? { ...x, miniatura: png } : x)));
        } catch {
          /* Sin miniatura: la tarjeta queda con el icono del PDF. */
        }
      }
    } finally {
      this.cargandoAdjuntos.set(false);
    }
  }

  descargarAdjunto(a: AdjuntoCargado): void {
    if (a.documentId === null) return;
    this.srv.descargarAdjunto(a.documentId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (blob) => saveAs(blob, a.nombre),
    });
  }

  // ── Soporte: PDF (impresion) e imagen ─────────────────────────────────

  async imprimir(): Promise<void> {
    this.trabajando.set(true);
    const marco = await documentoAparte(this.html());
    try {
      marco.contentWindow?.focus();
      marco.contentWindow?.print();
    } finally {
      // print() bloquea hasta que se cierra el dialogo de impresion.
      setTimeout(() => marco.remove(), 500);
      this.trabajando.set(false);
    }
  }

  async descargarImagen(): Promise<void> {
    this.trabajando.set(true);
    const marco = await documentoAparte(this.html());
    try {
      const { default: html2canvas } = await import('html2canvas');
      const cuerpo = marco.contentDocument!.body;
      const lienzo = await html2canvas(cuerpo, { backgroundColor: '#f6f8fc', scale: 2, useCORS: true, logging: false });
      const blob = await new Promise<Blob | null>((ok) => lienzo.toBlob(ok, 'image/png'));
      if (blob) saveAs(blob, `${nombreArchivo(this.datos.asunto)}.png`);
    } finally {
      marco.remove();
      this.trabajando.set(false);
    }
  }

  private pie(): string {
    const partes = ['Vista generada por TuApo a partir del registro del envío'];
    if (this.datos.referencia) partes[0] += ` (${this.datos.referencia})`;
    if (!this.datos.enviadoEn) partes.push('VISTA PREVIA: este correo aún no se ha enviado');
    if (this.datos.modo === 'PRUEBA') partes.push('modo prueba');
    partes.push(`generada el ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}`);
    return partes.join(' · ') + '.';
  }
}

/** Nombre de archivo a partir del asunto (sin caracteres que rompan en Windows). */
export function nombreArchivo(asunto: string | null): string {
  const base = (asunto || 'correo').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (base || 'correo').slice(0, 120);
}

/** Primera pagina de un PDF como PNG (mismo patron que hiring-questions). */
async function primeraPagina(blob: Blob): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerPort) {
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(
      // Ruta relativa: el bundler de workers no resuelve especificadores de paquete.
      new URL('../../../../../../../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url),
      { type: 'module' },
    );
  }
  const tarea = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
  try {
    const pdf = await tarea.promise;
    const pagina = await pdf.getPage(1);
    const ancho = pagina.getViewport({ scale: 1 }).width;
    const viewport = pagina.getViewport({ scale: 360 / ancho });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await pagina.render({ canvas, viewport }).promise;
    return canvas.toDataURL('image/png');
  } finally {
    void tarea.destroy();
  }
}

/**
 * Iframe fuera de pantalla, del mismo origen, con el documento ya cargado (fuentes e imagenes
 * listas): lo necesitan la impresion y html2canvas. El que lo pide lo retira.
 */
async function documentoAparte(html: string): Promise<HTMLIFrameElement> {
  const marco = document.createElement('iframe');
  marco.setAttribute('aria-hidden', 'true');
  marco.tabIndex = -1;
  Object.assign(marco.style, { position: 'fixed', left: '-10000px', top: '0', width: '980px', height: '1400px', border: '0' });
  const cargado = new Promise<void>((ok) => marco.addEventListener('load', () => ok(), { once: true }));
  marco.srcdoc = html;
  document.body.appendChild(marco);
  await cargado;
  const doc = marco.contentDocument;
  if (doc) {
    try { await doc.fonts?.ready; } catch { /* sin fuentes web: quedan las del sistema */ }
    await Promise.all(Array.from(doc.images).map((img) =>
      img.complete ? Promise.resolve() : new Promise<void>((ok) => { img.onload = img.onerror = () => ok(); })));
  }
  return marco;
}
