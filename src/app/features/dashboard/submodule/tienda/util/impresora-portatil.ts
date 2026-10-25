import { Injectable, computed, signal } from '@angular/core';
import QRCode from 'qrcode';

/**
 * Impresora térmica portátil (58 u 80 mm, ESC/POS) para el alistador y el domiciliario.
 *
 * <p>Tres caminos, porque las impresoras baratas no hablan todas igual:
 * <ol>
 *   <li><b>Bluetooth directo</b> (Web Bluetooth, Chrome en Android o computador): para las
 *       impresoras con Bluetooth LE. Se conecta una vez y se queda conectada mientras la
 *       pantalla esté abierta.</li>
 *   <li><b>RawBT</b> (app gratuita de Android): para las que solo tienen Bluetooth clásico,
 *       que el navegador no puede ver. Se le pasa el mismo ESC/POS y ella imprime.</li>
 *   <li><b>Sistema</b>: el diálogo de impresión normal (impresora de la oficina o el PDF).</li>
 * </ol>
 *
 * <p>La preferencia (camino, ancho, tildes) se recuerda en este equipo solo por comodidad.
 */
@Injectable({ providedIn: 'root' })
export class ImpresoraPortatil {
  private static readonly CLAVE = 'tuapo.tienda.impresora';
  /** Servicios BLE de las impresoras térmicas más comunes (genéricas chinas, Xprinter, Goojprt, MTP, ISSC). */
  private static readonly SERVICIOS = [
    '000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '0000ff00-0000-1000-8000-00805f9b34fb',
    '0000ffe0-0000-1000-8000-00805f9b34fb', '49535343-fe7d-4ae5-8fa9-9fafd205e455', '0000fee7-0000-1000-8000-00805f9b34fb',
    '0000ae30-0000-1000-8000-00805f9b34fb', '0000ff12-0000-1000-8000-00805f9b34fb',
  ];

  readonly modo = signal<'bluetooth' | 'rawbt' | 'sistema'>('sistema');
  readonly ancho = signal<58 | 80>(58);
  readonly tildes = signal(true);
  readonly bloque = signal(100);
  readonly nombre = signal<string | null>(null);
  readonly conectada = signal(false);
  readonly ocupada = signal(false);
  readonly error = signal<string | null>(null);

  readonly bluetoothDisponible = typeof navigator !== 'undefined' && !!(navigator as any).bluetooth;
  readonly esAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
  /** ¿Hay una impresora térmica lista para recibir ESC/POS? */
  readonly lista = computed(() => this.modo() === 'rawbt' || (this.modo() === 'bluetooth' && this.conectada()));
  readonly columnas = computed(() => this.ancho() === 80 ? 48 : 32);

  private dispositivo: any = null;
  private caracteristica: any = null;

  constructor() {
    try {
      const g = JSON.parse(localStorage.getItem(ImpresoraPortatil.CLAVE) || '{}');
      if (g.modo) this.modo.set(g.modo === 'bluetooth' ? 'sistema' : g.modo); // Bluetooth se reconecta a mano
      if (g.ancho === 80 || g.ancho === 58) this.ancho.set(g.ancho);
      if (typeof g.tildes === 'boolean') this.tildes.set(g.tildes);
      if (g.bloque) this.bloque.set(g.bloque);
    } catch { /* sin almacenamiento: valores por defecto */ }
  }

  private guardar(): void {
    try {
      localStorage.setItem(ImpresoraPortatil.CLAVE, JSON.stringify({
        modo: this.modo(), ancho: this.ancho(), tildes: this.tildes(), bloque: this.bloque(),
      }));
    } catch { /* ignorar */ }
  }

  configurar(c: { modo?: 'bluetooth' | 'rawbt' | 'sistema'; ancho?: 58 | 80; tildes?: boolean; bloque?: number }): void {
    if (c.modo) this.modo.set(c.modo);
    if (c.ancho) this.ancho.set(c.ancho);
    if (c.tildes != null) this.tildes.set(c.tildes);
    if (c.bloque) this.bloque.set(c.bloque);
    this.guardar();
  }

  /** Abre el selector de Bluetooth del navegador y se queda con la primera característica escribible. */
  async conectar(): Promise<boolean> {
    this.error.set(null);
    const bt = (navigator as any).bluetooth;
    if (!bt) {
      this.error.set('Este navegador no tiene Bluetooth web. Use Chrome en Android, o la app RawBT.');
      return false;
    }
    this.ocupada.set(true);
    try {
      this.dispositivo = await bt.requestDevice({ acceptAllDevices: true, optionalServices: ImpresoraPortatil.SERVICIOS });
      this.dispositivo.addEventListener('gattserverdisconnected', () => { this.conectada.set(false); this.caracteristica = null; });
      const servidor = await this.dispositivo.gatt.connect();
      this.caracteristica = null;
      for (const servicio of await servidor.getPrimaryServices()) {
        for (const c of await servicio.getCharacteristics()) {
          if (c.properties.writeWithoutResponse || c.properties.write) { this.caracteristica = c; break; }
        }
        if (this.caracteristica) break;
      }
      if (!this.caracteristica) throw new Error('La impresora no ofrece un canal de escritura conocido. Pruebe con RawBT.');
      this.nombre.set(this.dispositivo.name || 'Impresora');
      this.conectada.set(true);
      this.configurar({ modo: 'bluetooth' });
      return true;
    } catch (e: any) {
      if (e?.name !== 'NotFoundError') this.error.set(e?.message ?? 'No se pudo conectar la impresora');
      this.conectada.set(false);
      return false;
    } finally { this.ocupada.set(false); }
  }

  desconectar(): void {
    try { this.dispositivo?.gatt?.disconnect(); } catch { /* ya estaba */ }
    this.conectada.set(false); this.caracteristica = null; this.nombre.set(null);
    this.configurar({ modo: 'sistema' });
  }

  /** Manda el ESC/POS por el camino elegido. */
  async enviar(bytes: Uint8Array): Promise<void> {
    this.error.set(null);
    if (this.modo() === 'rawbt') {
      // RawBT recibe el ESC/POS en base64 por un intent de Android.
      let bin = '';
      bytes.forEach(b => bin += String.fromCharCode(b));
      window.location.href = `intent:base64,${btoa(bin)}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
      return;
    }
    if (!this.caracteristica) {
      if (this.dispositivo?.gatt && !this.dispositivo.gatt.connected) {
        // Se cayó la conexión (la impresora se apagó o se alejó): reintentar una vez.
        try { await this.dispositivo.gatt.connect(); } catch { /* sigue abajo */ }
      }
      if (!this.caracteristica) throw new Error('Conecte la impresora primero');
    }
    this.ocupada.set(true);
    try {
      const n = this.bloque();
      for (let i = 0; i < bytes.length; i += n) {
        const trozo = bytes.slice(i, i + n);
        if (this.caracteristica.properties.writeWithoutResponse && this.caracteristica.writeValueWithoutResponse) {
          await this.caracteristica.writeValueWithoutResponse(trozo);
          await espera(12);
        } else {
          await this.caracteristica.writeValue(trozo);
        }
      }
    } catch (e: any) {
      this.error.set('La impresora no recibió todo. Si se corta, active "envío lento".');
      throw e;
    } finally { this.ocupada.set(false); }
  }

  /** Un ticket nuevo con el ancho y la codificación de esta impresora. */
  ticket(): EscPos { return new EscPos(this.columnas(), this.tildes(), this.ancho() === 80 ? 576 : 384); }

  // ── Plantillas ──

  async sticker(e: { numero: string; codigo_qr: string; cliente_nombre: string | null; cliente_telefono: string | null;
                     direccion_texto: string | null; tipo_entrega: string; tienda: string; lineas: number; por_cobrar: number },
                k: number, n: number): Promise<EscPos> {
    const t = this.ticket();
    t.centro().doble().negrita(true).linea(`${e.numero}   ${k}/${n}`).normal().negrita(false);
    await t.qr(`${e.codigo_qr}:${k}/${n}`, 7);
    t.izquierda().negrita(true).linea(e.cliente_nombre ?? '').negrita(false);
    if (e.cliente_telefono) t.linea('Tel. ' + e.cliente_telefono);
    t.parrafo(e.direccion_texto || (e.tipo_entrega === 'DOMICILIO' ? 'Domicilio' : 'Recoge en ' + e.tienda));
    t.separador();
    t.centro().negrita(true).alto().linea(+e.por_cobrar > 0 ? 'COBRAR ' + pesos(e.por_cobrar) : 'PAGADO').normal().negrita(false);
    t.linea(`${e.tienda} · ${e.lineas} art.`).avanzar(3).cortar();
    return t;
  }

  /** El formato de mercado (autorización de libranza) en tirilla, con firma, huella y el QR del formato. */
  async autorizacion(d: { id?: string; numero?: string; texto?: string; texto_sha256?: string; cedula?: string; nombre?: string | null;
                          firmado_virtual_en?: string | null; empresa_nombre?: string | null; empresa_nit?: string | null;
                          centro_costo?: string | null; fecha_ingreso?: string | null; telefono?: string | null;
                          codigo_autorizacion?: string | null; cuotas?: number },
                     copia: string, pedido: string): Promise<EscPos> {
    const t = this.ticket();
    t.centro().negrita(true);
    if (d.empresa_nombre) t.linea(d.empresa_nombre);
    t.negrita(false);
    if (d.empresa_nit) t.linea(d.empresa_nit);
    t.negrita(true).linea('AUTORIZACION DE LIBRANZA').linea('Mercado EconomiAPP').negrita(false);
    if (copia) t.linea(copia.toUpperCase());
    t.linea(`N. ${d.codigo_autorizacion || d.numero || ''}  ·  Pedido ${pedido}`).izquierda().separador();
    t.parrafo(d.texto ?? '');
    t.linea('Cordialmente,').separador();
    t.linea('Ingreso: ' + (d.fecha_ingreso || 'No registrado'));
    t.linea('Centro de costo: ' + (d.centro_costo || 'No registrado'));
    t.linea('Forma de pago: Mercado EconomiAPP');
    if (d.telefono) t.linea('Telefono: ' + d.telefono);
    t.separador();
    if (d.firmado_virtual_en) t.parrafo('Firmada electronicamente con verificacion facial el ' + fecha(d.firmado_virtual_en) + '.');
    t.avanzar(4).linea('_'.repeat(this.columnas())).linea('Firma: ' + (d.nombre ?? '')).linea('C.C. ' + (d.cedula ?? ''));
    t.avanzar(1).linea('Huella indice:').avanzar(5).linea('_'.repeat(Math.min(16, this.columnas())));
    t.avanzar(1).linea('Fecha y hora: ____________________');
    t.centro();
    await t.qr(`SPB:${d.numero}`, 7);
    t.linea('Firme, escanee y entregue en la tienda').izquierda();
    t.parrafo('Huella del texto: ' + (d.texto_sha256 ?? '')).avanzar(3).cortar();
    return t;
  }

  async comprobante(c: { numero: string; tienda?: string | null; receptor_nombre: string | null; receptor_cedula: string; via: string;
                         modo_autorizacion?: string | null; acta_sha256?: string | null; creado_en?: string; por_cobrar?: number;
                         repartidor?: string | null; pedido_id: string }): Promise<EscPos> {
    const t = this.ticket();
    t.centro().negrita(true).linea('COMPROBANTE DE ENTREGA').doble().linea(c.numero).normal().negrita(false);
    if (c.tienda) t.linea(c.tienda);
    t.izquierda().separador();
    t.linea('Recibio: ' + (c.receptor_nombre ?? '')).linea('C.C. ' + c.receptor_cedula);
    t.linea('Verificacion: ' + (c.via === 'BIOMETRIA' ? 'rostro' : 'cedula en persona'));
    if (c.modo_autorizacion && c.modo_autorizacion !== 'SIN_PRESTAMO') {
      t.linea('Autorizacion: ' + (c.modo_autorizacion === 'DIGITAL' ? 'firma electronica' : 'firma en papel'));
    }
    if (c.por_cobrar && +c.por_cobrar > 0) t.linea('Pago en efectivo: ' + pesos(c.por_cobrar));
    t.linea('Fecha: ' + fecha(c.creado_en ?? new Date().toISOString()));
    if (c.repartidor) t.linea('Entrego: ' + c.repartidor);
    t.separador().parrafo('Huella del acta (SHA-256): ' + (c.acta_sha256 ?? ''));
    t.centro();
    await t.qr(`ACTA:${c.pedido_id}:${(c.acta_sha256 ?? '').slice(0, 16)}`, 5);
    t.linea('Gracias por comprar en EconomiAPP').avanzar(3).cortar();
    return t;
  }
}

/** Constructor de comandos ESC/POS. Texto en CP850 (ESC t 2) para las tildes y la ñ. */
export class EscPos {
  private partes: number[] = [];

  constructor(private columnas: number, private conTildes: boolean, private puntos: number) {
    this.cmd(0x1b, 0x40);                          // ESC @ reiniciar
    if (conTildes) this.cmd(0x1b, 0x74, 0x02);     // ESC t 2 = CP850
  }

  private cmd(...b: number[]): this { this.partes.push(...b); return this; }

  texto(s: string): this {
    for (const ch of String(s ?? '')) this.partes.push(this.codigo(ch));
    return this;
  }
  linea(s = ''): this { return this.texto(s).cmd(0x0a); }
  /** Texto largo partido por palabras al ancho del papel. */
  parrafo(s: string): this {
    const palabras = String(s ?? '').split(/\s+/).filter(Boolean);
    let actual = '';
    for (const p of palabras) {
      if ((actual + ' ' + p).trim().length > this.columnas) {
        if (actual) this.linea(actual);
        actual = p.length > this.columnas ? p.slice(0, this.columnas) : p;
        let resto = p.slice(this.columnas);
        while (resto.length) { this.linea(actual); actual = resto.slice(0, this.columnas); resto = resto.slice(this.columnas); }
      } else actual = (actual + ' ' + p).trim();
    }
    if (actual) this.linea(actual);
    return this;
  }
  separador(): this { return this.linea('-'.repeat(this.columnas)); }
  izquierda(): this { return this.cmd(0x1b, 0x61, 0x00); }
  centro(): this { return this.cmd(0x1b, 0x61, 0x01); }
  negrita(si: boolean): this { return this.cmd(0x1b, 0x45, si ? 1 : 0); }
  doble(): this { return this.cmd(0x1d, 0x21, 0x11); }
  alto(): this { return this.cmd(0x1d, 0x21, 0x01); }
  normal(): this { return this.cmd(0x1d, 0x21, 0x00); }
  avanzar(n: number): this { return this.cmd(0x1b, 0x64, Math.max(0, Math.min(10, n))); }
  cortar(): this { return this.cmd(0x1d, 0x56, 0x42, 0x00); }

  /**
   * QR como imagen (GS v 0): funciona en todas las térmicas, incluso las que no traen el
   * comando de QR nativo. {@code modulo} = puntos por módulo del QR.
   */
  async qr(contenido: string, modulo = 6): Promise<this> {
    const lienzo = document.createElement('canvas');
    await QRCode.toCanvas(lienzo, contenido, { margin: 1, scale: modulo, errorCorrectionLevel: 'M' });
    return this.imagen(lienzo);
  }

  imagen(lienzo: HTMLCanvasElement): this {
    let fuente = lienzo;
    if (lienzo.width > this.puntos) {
      const f = this.puntos / lienzo.width;
      fuente = document.createElement('canvas');
      fuente.width = this.puntos; fuente.height = Math.round(lienzo.height * f);
      fuente.getContext('2d')!.drawImage(lienzo, 0, 0, fuente.width, fuente.height);
    }
    const w = fuente.width, h = fuente.height, bytesFila = Math.ceil(w / 8);
    const datos = fuente.getContext('2d')!.getImageData(0, 0, w, h).data;
    this.cmd(0x1d, 0x76, 0x30, 0x00, bytesFila & 0xff, bytesFila >> 8, h & 0xff, h >> 8);
    for (let y = 0; y < h; y++) {
      for (let bx = 0; bx < bytesFila; bx++) {
        let b = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = bx * 8 + bit;
          if (x < w) {
            const i = (y * w + x) * 4;
            const lum = datos[i] * 0.3 + datos[i + 1] * 0.59 + datos[i + 2] * 0.11;
            if (datos[i + 3] > 128 && lum < 140) b |= 0x80 >> bit;
          }
        }
        this.partes.push(b);
      }
    }
    return this.cmd(0x0a);
  }

  bytes(): Uint8Array { return Uint8Array.from(this.partes); }

  private codigo(ch: string): number {
    if (!this.conTildes) {
      const sin = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      const c = sin.charCodeAt(0);
      return c < 128 ? c : 0x3f;
    }
    const c = ch.charCodeAt(0);
    if (c < 128) return c;
    return CP850[ch] ?? 0x3f;
  }
}

const CP850: Record<string, number> = {
  'á': 0xa0, 'é': 0x82, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5, 'ü': 0x81, 'Ü': 0x9a,
  'Á': 0xb5, 'É': 0x90, 'Í': 0xd6, 'Ó': 0xe0, 'Ú': 0xe9, '¿': 0xa8, '¡': 0xad, '°': 0xf8, '·': 0xfa, '…': 0x2e,
};

function espera(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }
export function pesos(v: number | string | null | undefined): string {
  return v == null ? '' : '$' + Math.round(+v).toLocaleString('es-CO');
}
function fecha(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
}
