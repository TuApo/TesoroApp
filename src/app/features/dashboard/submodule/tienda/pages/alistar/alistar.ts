import { ChangeDetectionStrategy, Component, computed, inject, input, signal, effect, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import QRCode from 'qrcode';

import { Alistamiento, TiendaService } from '../../service/tienda.service';
import { EscanerCodigoComponent, ResultadoEscaneo } from '@/app/shared/components/escaner-codigo/escaner-codigo.component';
import { ImpresoraBoton } from '../../components/impresora/impresora';
import { ImpresoraPortatil } from '../../util/impresora-portatil';
import { abrirPdf, utc } from '../../util/alerta-nuevos';
import { CasoPedidoPanel } from '../../components/caso-pedido/caso-pedido';
import { ImagenAmpliableComponent } from '@/app/shared/components/imagen-ampliable/imagen-ampliable.component';
import { GrabarVideo } from '../../components/grabar-video/grabar-video';
import { reducir } from '../../../../../economiapp/components/eco-captura-rostro';
import { compromiso, franjaAcordada } from '../../util/fechas-entrega';
import { DocViewerService } from '@/app/shared/services/doc-viewer/doc-viewer.service';
import { environment } from '../../../../../../../environments/environment';

/**
 * Alistar un pedido: se marca cada línea a medida que entra a la bolsa, se dice en cuántos
 * bultos sale y se imprime un sticker por bulto. El QR del sticker ("ECO:<pedido>:k/n") es
 * lo que el repartidor escanea para cargarlo a su ruta.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-alistar',
  imports: [CommonModule, FormsModule, MatIconModule, RouterLink, EscanerCodigoComponent, ImpresoraBoton, CasoPedidoPanel, GrabarVideo, ImagenAmpliableComponent],
  templateUrl: './alistar.html',
  styleUrls: ['../../styles/tienda-comun.css', './alistar.css'],
})
export class Alistar {
  private api = inject(TiendaService);
  readonly imp = inject(ImpresoraPortatil);
  /** Viene de la ruta /alistar/:id (withComponentInputBinding). */
  readonly id = input.required<string>();
  /** ?desde=cola: se llegó desde la cola de alistamiento (el botón de atrás vuelve allá). */
  readonly desde = input<string | undefined>();
  readonly utc = utc;
  private visor = inject(DocViewerService);
  readonly casoAbierto = signal(false);
  readonly subiendo = signal<string | null>(null);
  readonly compromiso = computed(() => compromiso(this.datos()?.fecha_compromiso));
  readonly franja = computed(() => { const d = this.datos(); return d?.hora_confirmada_en ? franjaAcordada(d.programado_en, d.programado_hasta) : null; });
  readonly videos = computed(() => (this.datos()?.evidencias ?? []).filter(e => e.tipo === 'VIDEO_ALISTAMIENTO'));
  readonly fotos = computed(() => (this.datos()?.evidencias ?? []).filter(e => e.tipo === 'FOTO_ALISTAMIENTO'));

  readonly datos = signal<Alistamiento | null>(null);
  readonly marcados = signal<Set<string>>(new Set());
  readonly bultos = signal(1);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  readonly total = computed(() => this.datos()?.items.length ?? 0);
  readonly listos = computed(() => this.marcados().size);
  readonly completo = computed(() => this.total() > 0 && this.listos() === this.total());
  /** Para terminar: todo marcado y la foto final del pedido empacado. */
  readonly puedeTerminar = computed(() => this.completo() && this.fotos().length > 0);
  /** Solo se alista lo confirmado; de LISTO en adelante solo se reimprime el sticker. */
  readonly editable = computed(() => ['CONFIRMADO', 'ALISTANDO'].includes(this.datos()?.estado ?? ''));
  /** Lo está alistando otra persona: se ve pero no se toca (salvo reasignar desde la cola). */
  readonly deOtro = computed(() => { const d = this.datos(); return !!d?.alistador_id && !d.es_mio && this.editable(); });
  readonly volverA = computed(() => this.desde() === 'cola' ? '/dashboard/tienda/alistamiento' : '/dashboard/tienda/pedidos');

  constructor() {
    effect(() => { const id = this.id(); untracked(() => this.cargar(id)); });
  }

  async cargar(id: string): Promise<void> {
    this.error.set(null);
    try {
      const d = await firstValueFrom(this.api.alistamiento(id));
      this.poner(d);
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo cargar el pedido'); }
  }

  private poner(d: Alistamiento): void {
    this.datos.set(d);
    this.marcados.set(new Set(d.items.filter(i => !!+i.alistado).map(i => i.id)));
    if (d.bultos) this.bultos.set(d.bultos);
  }

  alternar(id: string): void {
    if (!this.editable()) return;
    const s = new Set(this.marcados());
    s.has(id) ? s.delete(id) : s.add(id);
    this.marcados.set(s);
  }
  /**
   * Alistar escaneando: el código del producto marca su línea (por código de barras o SKU;
   * si no coincide directo, se pregunta al catálogo por los demás códigos del producto).
   */
  readonly procesarAlistado = async (codigo: string): Promise<ResultadoEscaneo> => {
    const d = this.datos();
    if (!d || !this.editable()) return { ok: false, texto: 'Este pedido ya no se puede alistar' };
    const c = codigo.trim();
    let linea = d.items.find(i => !this.marcados().has(i.id) && (i.codigo_barras === c || i.sku === c));
    if (!linea) {
      try {
        const skus = new Set(((await firstValueFrom(this.api.productosPorCodigo(c))) ?? []).map(p => p.sku));
        linea = d.items.find(i => !this.marcados().has(i.id) && !!i.sku && skus.has(i.sku));
      } catch { /* sin conexión: se informa abajo */ }
    }
    if (!linea) {
      const yaEsta = d.items.some(i => this.marcados().has(i.id) && (i.codigo_barras === c || i.sku === c));
      return { ok: false, texto: yaEsta ? 'Ese artículo ya estaba marcado' : 'Ese producto no está en el pedido', detalle: c };
    }
    this.alternar(linea.id);
    return { ok: true, texto: `${+linea.cantidad} × ${linea.descripcion}`, detalle: `${this.listos()} de ${this.total()} marcados` };
  };

  todos(): void { this.marcados.set(new Set(this.datos()?.items.map(i => i.id) ?? [])); }
  cambiarBultos(d: number): void { this.bultos.update(b => Math.min(50, Math.max(1, b + d))); }

  async guardar(terminar: boolean): Promise<void> {
    const d = this.datos(); if (!d) return;
    this.guardando.set(true); this.error.set(null); this.aviso.set(null);
    try {
      const r = await firstValueFrom(this.api.alistar(d.id, [...this.marcados()], terminar ? this.bultos() : null));
      this.poner(r);
      this.aviso.set(r.estado === 'LISTO'
        ? (r.tipo_entrega === 'DOMICILIO' ? 'Pedido listo y en la bolsa de domiciliarios. Pegue un sticker en cada bulto y meta el paquete impreso.'
          : 'Pedido listo para recoger. Pegue un sticker en cada bulto.')
        : 'Avance guardado');
      if (r.estado === 'LISTO' && terminar) await this.imprimir();
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo guardar'); }
    finally { this.guardando.set(false); }
  }

  /** Video del empaque o foto final: se suben con su huella y quedan como evidencia del pedido. */
  async subirEvidencia(tipo: 'VIDEO_ALISTAMIENTO' | 'FOTO_ALISTAMIENTO', blob: Blob, nombre: string): Promise<void> {
    const d = this.datos(); if (!d) return;
    this.subiendo.set(tipo); this.error.set(null);
    try {
      const archivo = tipo === 'FOTO_ALISTAMIENTO' ? await reducir(blob, 2000) : blob;
      await firstValueFrom(this.api.evidenciaAlistamiento(d.id, tipo, archivo, nombre));
      this.poner(await firstValueFrom(this.api.alistamiento(d.id)));
      this.aviso.set(tipo === 'VIDEO_ALISTAMIENTO' ? 'Video del empaque guardado' : 'Foto final guardada');
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo subir la evidencia'); }
    finally { this.subiendo.set(null); }
  }

  /** Solo el formato de mercado (libranza oficial con los datos del cliente), en PDF. */
  async formatoMercado(): Promise<void> {
    const d = this.datos(); if (!d) return;
    this.guardando.set(true); this.error.set(null);
    try { abrirPdf(await firstValueFrom(this.api.autorizacionPdf(d.id)), `formato-mercado-${d.numero}.pdf`); }
    catch (e: any) {
      let m = 'No se pudo generar el formato';
      try { if (e?.error instanceof Blob) m = JSON.parse(await e.error.text())?.error ?? m; } catch { /* no JSON */ }
      this.error.set(m);
    } finally { this.guardando.set(false); }
  }

  /** El formato en la impresora térmica portátil. */
  async formatoPortatil(): Promise<void> {
    const d = this.datos(); if (!d) return;
    this.guardando.set(true); this.error.set(null);
    try {
      const f = await firstValueFrom(this.api.imprimirSolicitudPrestamo(d.id));
      await this.imp.enviar((await this.imp.autorizacion(f, '', d.numero)).bytes());
    } catch (e: any) { this.error.set(e?.error?.error ?? e?.message ?? 'No se pudo imprimir el formato'); }
    finally { this.guardando.set(false); }
  }

  fotoFinal(ev: Event): void {
    const f = (ev.target as HTMLInputElement).files?.[0];
    (ev.target as HTMLInputElement).value = '';
    if (f) this.subirEvidencia('FOTO_ALISTAMIENTO', f, 'pedido-empacado.jpg');
  }

  ver(docId: string): void { this.visor.openInNewTab(`${environment.apiUrl}/api/v1/documents/${docId}/download`); }

  async tomar(): Promise<void> {
    const d = this.datos(); if (!d) return;
    this.guardando.set(true); this.error.set(null);
    try { this.poner(await firstValueFrom(this.api.tomarAlistamiento(d.id))); }
    catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo tomar el pedido'); }
    finally { this.guardando.set(false); }
  }

  /** Orden (hoja de alistamiento) + formato de mercado (libranza, 2 copias) en PDF, para la impresora de la oficina. */
  async paquete(): Promise<void> {
    const d = this.datos(); if (!d) return;
    this.guardando.set(true); this.error.set(null);
    try {
      abrirPdf(await firstValueFrom(this.api.paquetePdf(d.id)), `paquete-${d.numero}.pdf`);
      this.datos.update(x => x ? { ...x, paquete_impreso_en: new Date().toISOString(),
        prestamo_impresiones: (x.prestamo_impresiones ?? 0) + (x.prestamo_numero ? 1 : 0) } : x);
    } catch (e: any) {
      let m = 'No se pudo generar el paquete';
      try { if (e?.error instanceof Blob) m = JSON.parse(await e.error.text())?.error ?? m; } catch { /* no JSON */ }
      this.error.set(m);
    } finally { this.guardando.set(false); }
  }

  async imprimir(): Promise<void> {
    const d = this.datos(); if (!d) return;
    try {
      const e = await firstValueFrom(this.api.etiquetaPedido(d.id));
      const n = e.bultos || this.bultos();
      if (this.imp.lista()) {
        // Impresora térmica portátil: un ticket con QR por bulto.
        for (let k = 1; k <= n; k++) await this.imp.enviar((await this.imp.sticker(e, k, n)).bytes());
        this.datos.set({ ...d, ...e });
        return;
      }
      const hojas: string[] = [];
      for (let k = 1; k <= n; k++) {
        const qr = await QRCode.toDataURL(`${e.codigo_qr}:${k}/${n}`, { margin: 1, width: 360, errorCorrectionLevel: 'M' });
        const destino = e.direccion_texto || (e.tipo_entrega === 'DOMICILIO' ? 'Domicilio' : 'Recoge en ' + e.tienda);
        hojas.push(`<div class="st"><div class="cab"><b>${esc(e.numero)}</b><span>${k}/${n}</span></div>
          <div class="cu"><img src="${qr}"><div class="da"><b>${esc(e.cliente_nombre ?? '')}</b>
          ${e.cliente_telefono ? `<span>Tel. ${esc(e.cliente_telefono)}</span>` : ''}<span>${esc(destino)}</span>
          ${+e.por_cobrar > 0 ? `<span class="co">COBRAR ${this.pesos(e.por_cobrar)}</span>` : '<span>PAGADO</span>'}
          <small>${esc(e.tienda)} · ${e.lineas} art.</small></div></div></div>`);
      }
      this.datos.set({ ...d, ...e });
      imprimirHtml(`<style>@page{size:100mm 70mm;margin:0}body{margin:0;font-family:system-ui,sans-serif;color:#000}
        .st{width:100mm;height:70mm;box-sizing:border-box;padding:4mm;display:flex;flex-direction:column;gap:2mm;break-after:page}
        .cab{display:flex;justify-content:space-between;border-bottom:.6mm solid #000;padding-bottom:1mm;font-size:16pt;font-weight:800}
        .cu{display:flex;gap:3mm;flex:1;min-height:0}.cu img{width:42mm;height:42mm;flex:none}
        .da{display:flex;flex-direction:column;gap:1mm;font-size:9pt;overflow:hidden}.da b{font-size:11pt}
        .co{font-weight:900;font-size:11pt;border:.5mm solid #000;padding:.5mm 1.5mm;align-self:flex-start}</style>${hojas.join('')}`);
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo generar el sticker'); }
  }

  pesos(v: number | null | undefined): string {
    return v == null ? '' : '$' + Math.round(+v).toLocaleString('es-CO');
  }
}

function esc(v: string): string {
  return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** Imprime solo los stickers: un iframe oculto con su propia hoja, sin el resto de la app. */
function imprimirHtml(cuerpo: string): void {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  const doc = f.contentDocument!;
  doc.open(); doc.write(`<!doctype html><html><head><meta charset="utf-8"></head><body>${cuerpo}</body></html>`); doc.close();
  const imgs = Array.from(doc.images);
  Promise.all(imgs.map(i => i.complete ? Promise.resolve() : new Promise(r => { i.onload = i.onerror = r; }))).then(() => {
    f.contentWindow!.focus();
    f.contentWindow!.print();
    setTimeout(() => f.remove(), 60_000);
  });
}
