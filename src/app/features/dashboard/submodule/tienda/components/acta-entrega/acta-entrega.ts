import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { DocViewerService } from '@/app/shared/services/doc-viewer/doc-viewer.service';
import { environment } from '../../../../../../../environments/environment';
import { CapturaRostro, EcoCapturaRostro, reducir } from '../../../../../economiapp/components/eco-captura-rostro';
import { EcoFirma } from '../../../../../economiapp/components/eco-firma';
import { CONSENTIMIENTO_VERSION, TEXTO_TERCERO, TEXTO_TITULAR, huellaDelTexto } from '../../../../../economiapp/consentimiento-biometrico';
import { EstadoEntrega, TiendaService, TipoEvidencia, VerificacionResumen } from '../../service/tienda.service';
import { esc, imprimirHtml } from '../../util/imprimir';
import { ImpresoraPortatil } from '../../util/impresora-portatil';
import { abrirPdf } from '../../util/alerta-nuevos';

/**
 * Acta de entrega, igual en el punto que a domicilio:
 * quién recibe → verificarlo (rostro contra su foto, o cédula original en persona) →
 * foto de su documento → si va por bono mercado, la autorización de descuento → su firma de
 * recibido → acta. Sin acta el pedido no pasa a ENTREGADO.
 *
 * <p>La autorización tiene dos caminos y la persona escoge:
 * <ul>
 *   <li><b>Digital</b>: el titular, verificado con su rostro, firma en esta pantalla. El
 *       servidor congela el texto con su huella y guarda la firma con la suya.</li>
 *   <li><b>Papel</b>: firma la hoja impresa (viene en el paquete, o se imprime aquí en la
 *       portátil) y se le toma la foto, que es la digitalización del papel.</li>
 * </ul>
 * Cada foto y firma sube por ms-store, que calcula su sha256; el acta queda con la huella de
 * todo junto.
 */
@Component({
  selector: 'app-acta-entrega',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, EcoCapturaRostro, EcoFirma],
  templateUrl: './acta-entrega.html',
  styleUrls: ['../../styles/tienda-comun.css', './acta-entrega.css'],
})
export class ActaEntrega {
  private api = inject(TiendaService);
  private visor = inject(DocViewerService);
  readonly imp = inject(ImpresoraPortatil);
  readonly pedidoId = input.required<string>();
  readonly canal = input<'PUNTO' | 'DOMICILIO'>('PUNTO');
  readonly listo = output<EstadoEntrega>();
  readonly cancelar = output<void>();

  readonly estado = signal<EstadoEntrega | null>(null);
  readonly error = signal<string | null>(null);
  readonly ocupado = signal(false);
  /** null = titular; si no, id del tercero autorizado. */
  readonly receptor = signal<string | null | undefined>(undefined);
  readonly modo = signal<'rostro' | 'cedula'>('rostro');
  readonly aceptaBio = signal(false);
  readonly cedulaVista = signal('');
  readonly comentario = signal('Cédula original revisada: la foto y los datos coinciden con la persona.');
  readonly verificacion = signal<VerificacionResumen | null>(null);
  readonly fotoReceptor = signal<string | null>(null);
  readonly fotoDocumento = signal<string | null>(null);
  readonly papelFirmado = signal<string | null>(null);
  readonly firma = signal<Blob | null>(null);
  readonly subiendo = signal<string | null>(null);
  /** Cómo autoriza el titular el descuento: firma en pantalla con rostro, o papel. */
  readonly autoriza = signal<'digital' | 'papel'>('digital');
  readonly firmaAutoriza = signal<Blob | null>(null);
  readonly aceptaTexto = signal(false);
  readonly huellas = signal<Record<string, string>>({});
  /**
   * Entrega simple (la de todos los días a domicilio): quién recibe, su cédula, su foto y,
   * si la autorización va en papel, la foto del papel firmado. La completa (rostro, documento,
   * firma en pantalla) sigue a un toque.
   */
  readonly simple = signal(true);
  readonly cedulaRecibe = signal('');
  readonly vioCedula = signal(false);
  /** Firmó el formato en papel y quien entrega lo escanea después (queda en su poder hasta entregarlo en la tienda). */
  readonly papelDespues = signal(false);
  readonly completoSimple = computed(() => this.receptor() !== undefined && !!this.fotoReceptor() && !!this.cedulaRecibe().trim()
    && this.vioCedula() && (!this.doc() || this.firmadaDigital() || !!this.papelFirmado() || this.papelDespues()));
  private pos: { lat: number; lng: number } | null = null;

  readonly doc = computed(() => this.estado()?.documento ?? null);
  readonly tercero = computed(() => this.estado()?.terceros.find(t => t.id === this.receptor()) ?? null);
  readonly nombreReceptor = computed(() => this.receptor() ? this.tercero()?.nombre : this.estado()?.cliente_nombre);
  readonly cedulaReceptor = computed(() => this.receptor() ? this.tercero()?.cedula : this.estado()?.cliente_cedula);
  /** La autorización aún no está firmada: solo puede recibir el titular (un tercero nunca firma el préstamo). */
  readonly sinFirmar = computed(() => this.doc()?.estado === 'PENDIENTE_FIRMA');
  readonly firmadaDigital = computed(() => !!this.doc() && this.doc()!.estado !== 'PENDIENTE_FIRMA');
  /** Firmar en pantalla exige que al titular lo haya verificado el ROSTRO en esta entrega. */
  readonly puedeFirmarDigital = computed(() => {
    const v = this.verificacion();
    return !!v?.aprueba && v.via === 'BIOMETRIA' && this.receptor() === null;
  });
  readonly textoConsentimiento = computed(() => this.receptor() ? TEXTO_TERCERO : TEXTO_TITULAR);
  readonly completo = computed(() => !!this.verificacion()?.aprueba && !!this.fotoDocumento() && !!this.firma()
    && (!this.doc() || this.firmadaDigital() || !!this.papelFirmado()));

  constructor() {
    effect(() => { const id = this.pedidoId(); untracked(() => this.cargar(id)); });
  }

  async cargar(id: string): Promise<void> {
    try {
      const e = await firstValueFrom(this.api.estadoEntrega(id));
      this.estado.set(e);
      if (e.acta) this.listo.emit(e);
      if (e.terceros.length === 0 || e.documento?.estado === 'PENDIENTE_FIRMA') this.elegir(null);
      // En el punto se sigue usando la verificación completa; a domicilio, la simple.
      if (this.canal() === 'PUNTO') this.simple.set(false);
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo cargar el pedido'); }
    if (this.canal() === 'DOMICILIO') posicion().then(p => this.pos = p);
  }

  elegir(id: string | null): void {
    this.receptor.set(id); this.verificacion.set(null); this.cedulaVista.set('');
    this.cedulaRecibe.set(id ? (this.estado()?.terceros.find(t => t.id === id)?.cedula ?? '') : (this.estado()?.cliente_cedula ?? ''));
    this.vioCedula.set(false);
  }

  /** Entregar y cerrar en modo simple. */
  async entregarSimple(): Promise<void> {
    if (!this.completoSimple()) return;
    this.ocupado.set(true); this.error.set(null);
    try {
      const pos = this.canal() === 'DOMICILIO' ? (this.pos ?? await posicion()) : null;
      const e = await firstValueFrom(this.api.entregaSimple(this.pedidoId(), {
        canal: this.canal(), tercero_id: this.receptor() ?? null, cedula: this.cedulaRecibe().trim(),
        foto_receptor_doc_id: this.fotoReceptor()!, papel_firmado_doc_id: this.firmadaDigital() ? null : this.papelFirmado(),
        papel_despues: !this.firmadaDigital() && !this.papelFirmado() && this.papelDespues(),
        latitud: pos?.lat ?? null, longitud: pos?.lng ?? null }));
      this.estado.set(e);
      this.listo.emit(e);
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo registrar la entrega'); }
    finally { this.ocupado.set(false); }
  }

  async conRostro(c: CapturaRostro): Promise<void> {
    this.ocupado.set(true); this.error.set(null);
    try {
      const sha = await huellaDelTexto(this.textoConsentimiento());
      const v = await firstValueFrom(this.api.verificarRostroPedido(this.pedidoId(), c.blob, c.vivacidad, this.receptor() ?? null,
        { version: CONSENTIMIENTO_VERSION, sha256: sha }));
      this.verificacion.set(v);
      if (!v.aprueba) this.error.set(v.resultado === 'DUDOSA' ? 'No quedó claro: repita con mejor luz, o verifique con la cédula.' : 'El rostro no coincide. Verifique con la cédula original o no entregue.');
      else this.fotoReceptor.set(await this.subir(c.blob, 'receptor.jpg', 'FOTO_RECEPTOR'));
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo verificar'); }
    finally { this.ocupado.set(false); }
  }

  async conCedula(): Promise<void> {
    this.ocupado.set(true); this.error.set(null);
    try {
      this.verificacion.set(await firstValueFrom(this.api.verificarPresencialPedido(this.pedidoId(), this.cedulaVista().trim(),
        this.receptor() ?? null, this.comentario().trim())));
      // Sin rostro no hay firma electrónica: la autorización va en papel.
      if (this.sinFirmar()) this.autoriza.set('papel');
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo registrar la verificación'); }
    finally { this.ocupado.set(false); }
  }

  async foto(cual: 'documento' | 'papel' | 'receptor', ev: Event): Promise<void> {
    const f = (ev.target as HTMLInputElement).files?.[0]; if (!f) return;
    this.subiendo.set(cual); this.error.set(null);
    try {
      // El papel se reduce menos: es un documento y tiene que leerse la letra y el QR.
      const tipo: TipoEvidencia = cual === 'documento' ? 'FOTO_DOCUMENTO' : cual === 'papel' ? 'PAPEL_FIRMADO' : 'FOTO_RECEPTOR';
      const id = await this.subir(await reducir(f, cual === 'papel' ? 2400 : 1800), `${cual}.jpg`, tipo);
      (cual === 'documento' ? this.fotoDocumento : cual === 'papel' ? this.papelFirmado : this.fotoReceptor).set(id);
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo subir la foto. Intente de nuevo.'); }
    finally { this.subiendo.set(null); (ev.target as HTMLInputElement).value = ''; }
  }

  /** Sube por ms-store: el servidor calcula el sha256 sobre lo que llegó. */
  private async subir(b: Blob, nombre: string, tipo: TipoEvidencia): Promise<string> {
    const r = await firstValueFrom(this.api.subirEvidencia(this.pedidoId(), tipo, b, nombre, this.pos));
    this.huellas.update(h => ({ ...h, [r.doc_id]: r.sha256 }));
    return r.doc_id;
  }

  huella(docId: string | null): string { return docId ? (this.huellas()[docId] ?? '').slice(0, 12) : ''; }

  /** El titular firma la autorización en esta pantalla (rostro ya verificado). */
  async firmarDigital(): Promise<void> {
    const v = this.verificacion(), f = this.firmaAutoriza();
    if (!v || !f || !this.puedeFirmarDigital()) return;
    this.ocupado.set(true); this.error.set(null);
    try {
      const d = await firstValueFrom(this.api.firmarPrestamoEnEntrega(this.pedidoId(), f, v.id));
      this.estado.update(e => e && e.documento ? { ...e, documento: { ...e.documento, ...d, estado: 'FIRMADO_VIRTUAL', firma_canal: 'ENTREGA' } } : e);
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo firmar la autorización'); }
    finally { this.ocupado.set(false); }
  }

  /** Dos copias en papel carta: una para la persona y otra para custodia (PDF del servidor, con QR). */
  async imprimir(): Promise<void> {
    this.ocupado.set(true); this.error.set(null);
    try {
      abrirPdf(await firstValueFrom(this.api.autorizacionPdf(this.pedidoId())), `autorizacion-${this.estado()?.numero}.pdf`);
      this.estado.update(e => e ? { ...e, documento: e.documento ? { ...e.documento, impresiones: (e.documento.impresiones ?? 0) + 1 } : null } : e);
    } catch {
      // Sin PDF (red lenta o navegador sin visor): la hoja HTML de siempre.
      await this.imprimirHtml();
    } finally { this.ocupado.set(false); }
  }

  /** En la impresora térmica portátil, para firmarla ahí mismo. */
  async imprimirPortatil(): Promise<void> {
    this.ocupado.set(true); this.error.set(null);
    try {
      const d = await firstValueFrom(this.api.imprimirSolicitudPrestamo(this.pedidoId()));
      await this.imp.enviar((await this.imp.autorizacion(d, 'Copia para custodia', this.estado()?.numero ?? '')).bytes());
      if (confirm('¿Imprimir también la copia para la persona?')) {
        await this.imp.enviar((await this.imp.autorizacion(d, 'Copia para la persona', this.estado()?.numero ?? '')).bytes());
      }
      this.estado.update(e => e ? { ...e, documento: e.documento ? { ...e.documento, impresiones: (e.documento.impresiones ?? 0) + 1 } : null } : e);
    } catch (e: any) { this.error.set(e?.error?.error ?? e?.message ?? 'No se pudo imprimir'); }
    finally { this.ocupado.set(false); }
  }

  private async imprimirHtml(): Promise<void> {
    try {
      const d = await firstValueFrom(this.api.imprimirSolicitudPrestamo(this.pedidoId()));
      let firmaApp = '';
      if (d.firma_virtual_doc_id) {
        const url = await this.visor.toBlobUrl(`${environment.apiUrl}/api/v1/documents/${d.firma_virtual_doc_id}/download`);
        if (url) firmaApp = `<img src="${url}" style="height:60px">`;
      }
      const hoja = (copia: string) => `<div class="h"><div class="c">${copia}</div><pre>${esc(d.texto)}</pre>
        <table><tr><td>${firmaApp || '&nbsp;'}<div class="l">Firma electrónica (verificada con rostro)${d.firma_virtual_doc_id ? '' : ': NO FIRMADA'}</div></td>
        <td><div class="e"></div><div class="l">Firma del titular en papel · C.C. ${esc(d.cedula)}</div></td></tr>
        <tr><td><div class="e"></div><div class="l">Recibido por (nombre y C.C.) si es otra persona</div></td><td><div class="e"></div><div class="l">Huella (opcional)</div></td></tr></table>
        <div class="p">Pedido ${esc(this.estado()?.numero)} · ${esc(d.numero)} · huella del texto ${esc((d.texto_sha256 || '').slice(0, 16))}…</div></div>`;
      imprimirHtml(`<style>@page{size:letter;margin:16mm}body{font-family:system-ui,sans-serif;color:#000;font-size:11pt}
        .h{break-after:page}.c{text-align:right;font-weight:800;font-size:9pt;text-transform:uppercase}
        pre{white-space:pre-wrap;font:inherit;line-height:1.45}table{width:100%;border-collapse:collapse;margin-top:14mm}
        td{width:50%;vertical-align:bottom;padding:6mm 4mm 0}.e{height:18mm}.l{border-top:.3mm solid #000;font-size:8.5pt;padding-top:1mm}
        .p{margin-top:10mm;font-size:8pt;color:#444}</style>${hoja('Copia para la persona')}${hoja('Copia para custodia')}`);
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo imprimir'); }
  }

  async registrar(): Promise<void> {
    if (!this.completo()) return;
    this.ocupado.set(true); this.error.set(null);
    try {
      const firmaId = await this.subir(this.firma()!, 'firma-recibe.png', 'FIRMA_RECIBE');
      const pos = this.canal() === 'DOMICILIO' ? (this.pos ?? await posicion()) : null;
      const e = await firstValueFrom(this.api.registrarActa(this.pedidoId(), {
        canal: this.canal(), verificacion_id: this.verificacion()!.id, foto_receptor_doc_id: this.fotoReceptor(),
        foto_documento_doc_id: this.fotoDocumento()!, firma_receptor_doc_id: firmaId,
        papel_firmado_doc_id: this.firmadaDigital() && this.autoriza() === 'digital' ? null : this.papelFirmado(),
        latitud: pos?.lat ?? null, longitud: pos?.lng ?? null,
      }));
      this.estado.set(e);
      this.listo.emit(e);
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo registrar el acta'); }
    finally { this.ocupado.set(false); }
  }
}

function posicion(): Promise<{ lat: number; lng: number } | null> {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise(r => navigator.geolocation.getCurrentPosition(p => r({ lat: p.coords.latitude, lng: p.coords.longitude }), () => r(null), { timeout: 6000 }));
}
