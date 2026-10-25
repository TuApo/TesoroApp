import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { EcoMapa, PuntoMapa } from '../../../../../economiapp/components/eco-mapa';
import { ActaEntrega } from '../../components/acta-entrega/acta-entrega';
import { ImpresoraBoton } from '../../components/impresora/impresora';
import { CasoPedidoPanel } from '../../components/caso-pedido/caso-pedido';
import { ConfirmarHora } from '../../components/confirmar-hora/confirmar-hora';
import { compromiso, franjaAcordada } from '../../util/fechas-entrega';
import {
  BolsaDomicilios, DomicilioEnBolsa, EstadoEntrega, PapelFirmado, ParadaRuta, Repartidor, RutaEntrega, TiendaService,
} from '../../service/tienda.service';
import { reducir } from '../../../../../economiapp/components/eco-captura-rostro';
import { ImpresoraPortatil } from '../../util/impresora-portatil';
import { abrirPdf, avisar, hace, minutosDesde, pedirPermisoAvisos, utc } from '../../util/alerta-nuevos';
import { EscanerCodigoComponent, ResultadoEscaneo } from '@/app/shared/components/escaner-codigo/escaner-codigo.component';

type Pestana = 'bolsa' | 'ruta';

/**
 * La app del domiciliario, pensada para el celular (al estilo de las apps de domicilios, con
 * los domiciliarios propios de la empresa):
 *
 * <ol>
 *   <li><b>Disponibles</b>: se conecta y ve los domicilios de sus tiendas que nadie ha tomado,
 *       del más cercano al más lejano. Escoge uno o varios de una misma tienda y los toma.</li>
 *   <li><b>Recoger</b>: en la tienda escanea el sticker de cada bulto. No sale a ruta con un
 *       pedido incompleto.</li>
 *   <li><b>Ruta</b>: las paradas se ordenan solas; en cada una tiene llamar, WhatsApp con
 *       mensajes listos, navegar (Google Maps o Waze), "llegué" y las personas autorizadas.</li>
 *   <li><b>Entregar</b>: acta con verificación (rostro o cédula), foto del documento, firma, y
 *       la autorización de descuento firmada en pantalla con rostro o en papel (foto). Puede
 *       imprimir la autorización y el comprobante en la impresora portátil.</li>
 * </ol>
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-domicilios',
  imports: [CommonModule, FormsModule, MatIconModule, EcoMapa, ActaEntrega, EscanerCodigoComponent, ImpresoraBoton, CasoPedidoPanel, ConfirmarHora],
  templateUrl: './domicilios.html',
  styleUrls: ['../../styles/tienda-comun.css', './domicilios.css'],
})
export class Domicilios implements OnInit, OnDestroy {
  private api = inject(TiendaService);
  readonly imp = inject(ImpresoraPortatil);
  /** ?tab=ruta (las rutas viejas de "Mi ruta" llegan así). */
  readonly tab = input<string | undefined>();

  readonly pestana = signal<Pestana>('bolsa');
  readonly bolsa = signal<BolsaDomicilios | null>(null);
  readonly ruta = signal<RutaEntrega | null>(null);
  readonly repartidor = signal<Repartidor | null>(null);
  readonly seleccion = signal<Set<string>>(new Set());
  readonly cargando = signal(true);
  readonly ocupado = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);
  readonly yo = signal<{ lat: number; lng: number } | null>(null);
  readonly codigoManual = signal('');
  readonly fallando = signal<string | null>(null);
  readonly motivo = signal('');
  readonly actaDe = signal<string | null>(null);
  readonly contactoDe = signal<string | null>(null);
  /** Pedido con el panel de caso abierto (línea de tiempo, evidencias, casos). */
  readonly casoDe = signal<string | null>(null);
  /** Parada con el formulario de "confirmar hora" abierto. */
  readonly horaDe = signal<string | null>(null);
  /** Formatos de mercado firmados que tengo: por escanear y por entregar en la tienda. */
  readonly papeles = signal<PapelFirmado[]>([]);
  readonly escaneandoPapel = signal<string | null>(null);
  readonly papelesSinEscanear = computed(() => this.papeles().filter(p => !p.escaneo_doc_id).length);
  readonly perfilAbierto = signal(false);
  readonly perfil = signal({ telefono: '', vehiculo: 'MOTO', placa: '' });
  /** Actas registradas en esta sesión, para el comprobante. */
  readonly actas = signal<Record<string, EstadoEntrega>>({});
  readonly MOTIVOS = ['No había nadie', 'Dirección no encontrada', 'No contesta el teléfono', 'Rechazó el pedido', 'No tenía el dinero', 'Zona insegura'];
  readonly VEHICULOS = [['MOTO', 'Moto'], ['BICICLETA', 'Bicicleta'], ['CARRO', 'Carro'], ['A_PIE', 'A pie']];

  readonly disponible = computed(() => !!+(this.repartidor()?.disponible ?? 0));
  readonly pedidosBolsa = computed(() => this.bolsa()?.pedidos ?? []);
  readonly listosBolsa = computed(() => this.pedidosBolsa().filter(p => p.listo).length);
  /** Una ruta sale de una sola tienda: la de la ruta abierta o la del primer pedido escogido. */
  readonly tiendaFija = computed(() => {
    const r = this.ruta();
    if (r && r.estado === 'CARGANDO' && r.paradas.length) return r.tienda_id;
    const s = [...this.seleccion()];
    return s.length ? this.pedidosBolsa().find(p => p.id === s[0])?.tienda_id ?? null : null;
  });
  readonly escogidos = computed(() => this.pedidosBolsa().filter(p => this.seleccion().has(p.id)));
  /** El mapa de la bolsa: la tienda (centro de distribución) y cada domicilio numerado por cercanía a ella. */
  readonly puntosBolsa = computed<PuntoMapa[]>(() => {
    const ps: PuntoMapa[] = [];
    const tiendas = new Map<string, DomicilioEnBolsa>();
    for (const p of this.pedidosBolsa()) if (p.tienda_lat != null && !tiendas.has(p.tienda_id)) tiendas.set(p.tienda_id, p);
    for (const t of tiendas.values()) ps.push({ lat: +t.tienda_lat!, lng: +t.tienda_lng!, etiqueta: 'T', titulo: t.tienda, tono: 'origen' });
    this.pedidosBolsa().forEach((p, i) => {
      if (p.latitud == null) return;
      ps.push({ lat: +p.latitud, lng: +p.longitud!, etiqueta: String(i + 1), clave: p.id,
        titulo: `${i + 1}. ${p.numero} · ${p.barrio ?? p.direccion_texto ?? ''}${p.km_entrega != null ? ' · ' + this.km(p.km_entrega) + ' de la tienda' : ''}`,
        tono: this.seleccion().has(p.id) ? 'ok' : p.listo ? 'pendiente' : 'espera' });
    });
    return ps;
  });
  readonly cobroEscogidos = computed(() => this.escogidos().reduce((s, p) => s + +p.por_cobrar, 0));
  readonly bloqueadoPorRuta = computed(() => this.ruta()?.estado === 'EN_CURSO');

  readonly pendientes = computed(() => (this.ruta()?.paradas ?? []).filter(p => p.estado === 'CARGADO'));
  readonly sinHora = computed(() => this.pendientes().filter(p => !p.hora_confirmada_en));
  readonly siguiente = computed(() => this.pendientes()[0] ?? null);
  readonly sinRecoger = computed(() => this.pendientes().filter(p => !p.recogido_en));
  readonly porCobrar = computed(() => this.pendientes().reduce((s, p) => s + +p.por_cobrar, 0));
  readonly puntos = computed<PuntoMapa[]>(() => {
    const r = this.ruta(); if (!r) return [];
    const ps: PuntoMapa[] = [];
    if (r.origen_lat != null && r.estado === 'CARGANDO') ps.push({ lat: +r.origen_lat, lng: +r.origen_lng!, etiqueta: 'T', titulo: r.tienda?.nombre, tono: 'origen' });
    const y = this.yo(); if (y && r.estado === 'EN_CURSO') ps.push({ ...y, tono: 'yo', titulo: 'Usted' });
    r.paradas.forEach((p, i) => { if (p.lat != null) ps.push({ lat: +p.lat, lng: +p.lng!, etiqueta: String(i + 1), titulo: p.numero, tono: p.estado === 'ENTREGADO' ? 'ok' : p.estado === 'FALLIDO' ? 'falla' : 'pendiente' }); });
    return ps;
  });
  readonly rutaCompleta = computed(() => {
    const ps = this.pendientes().filter(p => p.lat != null);
    if (!ps.length) return null;
    const ult = ps[ps.length - 1];
    const medio = ps.slice(0, -1).slice(0, 9).map(p => `${p.lat},${p.lng}`).join('|');
    return `https://www.google.com/maps/dir/?api=1&destination=${ult.lat},${ult.lng}${medio ? '&waypoints=' + encodeURIComponent(medio) : ''}&travelmode=driving`;
  });

  private reloj: ReturnType<typeof setInterval> | null = null;
  private vigia: number | null = null;
  private ultimoEnvio = 0;
  private conocidos: Set<string> | null = null;

  ngOnInit(): void {
    if (this.tab() === 'ruta') this.pestana.set('ruta');
    pedirPermisoAvisos();
    this.posicionActual().then(p => { if (p) this.yo.set(p); this.cargar(); });
    this.reloj = setInterval(() => this.refrescar(), 15_000);
  }
  ngOnDestroy(): void {
    if (this.reloj) clearInterval(this.reloj);
    this.apagarGps();
  }

  // ── Carga ──

  async cargar(): Promise<void> {
    this.cargando.set(true);
    await Promise.all([this.cargarBolsa(), this.cargarRuta(), this.cargarPapeles()]);
    if (this.tab() !== 'ruta' && this.ruta()?.paradas.length) this.pestana.set('ruta');
    this.cargando.set(false);
  }

  private async refrescar(): Promise<void> {
    if (this.ocupado() || this.actaDe()) return;
    if (this.pestana() === 'bolsa' || this.disponible()) await this.cargarBolsa(true);
  }

  private async cargarBolsa(silencioso = false): Promise<void> {
    try {
      const y = this.yo();
      const b = await firstValueFrom(this.api.bolsaDomicilios(y?.lat, y?.lng));
      const nuevos = b.pedidos.filter(p => p.listo && this.conocidos && !this.conocidos.has(p.id + ':L'));
      if (nuevos.length && +(b.repartidor?.disponible ?? 0)) {
        avisar(nuevos.length === 1 ? `Domicilio disponible · ${nuevos[0].tienda}` : `${nuevos.length} domicilios disponibles`,
          nuevos.map(p => `${p.numero} ${p.barrio ?? ''}`).join(' · '));
      }
      this.conocidos = new Set(b.pedidos.map(p => p.id + (p.listo ? ':L' : '')));
      this.bolsa.set(b);
      this.repartidor.set(b.repartidor);
      // Lo escogido que ya no está (lo tomó otro) se suelta solo.
      const ids = new Set(b.pedidos.map(p => p.id));
      const s = [...this.seleccion()].filter(id => ids.has(id));
      if (s.length !== this.seleccion().size) this.seleccion.set(new Set(s));
      if (!silencioso) this.error.set(null);
    } catch (e: any) {
      if (!silencioso) this.error.set(e?.error?.error ?? 'No se pudo cargar la bolsa de domicilios');
    }
  }

  private async cargarRuta(): Promise<void> {
    try {
      const r = await firstValueFrom(this.api.miRuta());
      this.poner('id' in r ? r : null);
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo cargar su ruta'); }
  }

  private poner(r: RutaEntrega | null): void {
    this.ruta.set(r);
    if (r?.aviso) this.aviso.set(r.aviso);
    if (r?.estado === 'EN_CURSO') this.prenderGps(); else this.apagarGps();
  }

  async cargarPapeles(): Promise<void> {
    try { this.papeles.set(await firstValueFrom(this.api.misPapeles())); } catch { /* no bloquea la pantalla */ }
  }

  /** Escanear (foto) un formato firmado que tengo. Si la foto trae el QR, tiene que ser de ese formato. */
  async escanearPapel(p: PapelFirmado, ev: Event): Promise<void> {
    const f = (ev.target as HTMLInputElement).files?.[0];
    (ev.target as HTMLInputElement).value = '';
    if (!f) return;
    this.escaneandoPapel.set(p.id); this.error.set(null);
    try {
      const r = await firstValueFrom(this.api.escanearMiPapel(p.id, await reducir(f, 2400), `formato-${p.numero}.jpg`));
      this.aviso.set(`Formato ${p.numero} escaneado${r.qr_leido ? ' (QR verificado)' : ''}. Entréguelo en la tienda.`);
      await this.cargarPapeles();
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo subir el escaneo'); }
    finally { this.escaneandoPapel.set(null); }
  }

  // ── Conexión y perfil ──

  async alternarDisponible(): Promise<void> {
    this.ocupado.set(true); this.error.set(null);
    try {
      const y = await this.posicionActual();
      if (y) this.yo.set(y);
      const r = await firstValueFrom(this.api.disponibleDomiciliario(!this.disponible(), y?.lat ?? null, y?.lng ?? null));
      this.repartidor.set(r);
      this.aviso.set(+r.disponible ? 'Conectado: le avisamos cuando haya domicilios nuevos (deje esta pantalla abierta).' : 'Desconectado.');
      if (+r.disponible) await this.cargarBolsa(true);
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo cambiar su estado'); }
    finally { this.ocupado.set(false); }
  }

  abrirPerfil(): void {
    const r = this.repartidor();
    this.perfil.set({ telefono: r?.telefono ?? '', vehiculo: r?.vehiculo ?? 'MOTO', placa: r?.placa ?? '' });
    this.perfilAbierto.set(true);
  }

  async guardarPerfil(): Promise<void> {
    this.ocupado.set(true);
    try {
      this.repartidor.set(await firstValueFrom(this.api.perfilDomiciliario(this.perfil())));
      this.perfilAbierto.set(false);
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo guardar'); }
    finally { this.ocupado.set(false); }
  }

  // ── Bolsa ──

  escogible(p: DomicilioEnBolsa): boolean {
    const t = this.tiendaFija();
    return !this.bloqueadoPorRuta() && (!t || t === p.tienda_id);
  }

  /** Tocar un domicilio en el mapa lo escoge o lo suelta, igual que en la lista. */
  alternarId(id: string): void {
    const p = this.pedidosBolsa().find(x => x.id === id);
    if (p) this.alternar(p);
  }

  alternar(p: DomicilioEnBolsa): void {
    if (!this.escogible(p)) return;
    const s = new Set(this.seleccion());
    s.has(p.id) ? s.delete(p.id) : s.add(p.id);
    this.seleccion.set(s);
  }

  async tomar(): Promise<void> {
    const ids = [...this.seleccion()]; if (!ids.length) return;
    this.ocupado.set(true); this.error.set(null); this.aviso.set(null);
    try {
      const y = this.yo();
      const r = await firstValueFrom(this.api.tomarDomicilios(ids, y?.lat ?? null, y?.lng ?? null));
      this.poner(r);
      this.seleccion.set(new Set());
      this.pestana.set('ruta');
      navigator.vibrate?.(80);
      this.cargarBolsa(true);
    } catch (e: any) {
      this.error.set(e?.error?.error ?? 'No se pudieron tomar los pedidos');
      this.cargarBolsa(true);
    } finally { this.ocupado.set(false); }
  }

  // ── Recoger (escanear stickers) ──

  readonly procesarSticker = async (codigo: string): Promise<ResultadoEscaneo> => {
    this.error.set(null); this.aviso.set(null);
    try {
      const r = await firstValueFrom(this.api.escanearParaRuta(codigo));
      this.poner(r);
      this.pestana.set('ruta');
      const faltan = r.paradas.filter(p => p.estado === 'CARGADO' && !p.recogido_en).length;
      return { ok: true, texto: r.aviso || 'Bulto recogido', detalle: faltan ? `Faltan ${faltan} pedido${faltan === 1 ? '' : 's'} por recoger` : 'Todo recogido: puede salir' };
    } catch (e: any) {
      return { ok: false, texto: e?.error?.error ?? 'No se pudo recoger ese pedido', detalle: codigo };
    }
  };

  async manual(): Promise<void> {
    const c = this.codigoManual().trim(); if (!c) return;
    if (!confirm(`¿Confirma que tiene en la mano TODOS los bultos del pedido ${c}? Queda anotado que no se escaneó.`)) return;
    await this.accion(() => this.api.escanearParaRuta(c));
    this.codigoManual.set('');
  }

  recogidos(p: ParadaRuta): number { return (p.bultos_recogidos ?? '').split(',').filter(Boolean).length; }

  async liberar(p: ParadaRuta): Promise<void> {
    const r = this.ruta(); if (!r || !confirm(`¿Soltar el pedido ${p.numero}? Vuelve a la bolsa para otro domiciliario.`)) return;
    await this.accion(() => this.api.descargarDeRuta(r.id, p.pedido_id), `Pedido ${p.numero} liberado`);
    this.cargarBolsa(true);
  }

  async salir(): Promise<void> {
    const r = this.ruta(); if (!r) return;
    this.ocupado.set(true);
    const pos = await this.posicionActual();
    this.ocupado.set(false);
    await this.accion(() => this.api.iniciarRuta(r.id, pos?.lat ?? null, pos?.lng ?? null), 'Ruta iniciada. A cada cliente le avisamos que va en camino.');
  }

  // ── En ruta ──

  async llegue(p: ParadaRuta): Promise<void> {
    const r = this.ruta(); if (!r) return;
    await this.accion(() => this.api.llegueParada(r.id, p.pedido_id), 'Le avisamos a la persona que usted llegó');
  }

  /** El acta ya quedó registrada: ahora sí se marca entregado (y el efectivo recibido). */
  async entregar(p: ParadaRuta, e: EstadoEntrega): Promise<void> {
    const r = this.ruta(); if (!r) return;
    this.actas.update(a => ({ ...a, [p.pedido_id]: e }));
    const cobro = +p.por_cobrar > 0 ? `Confirme que recibió ${this.pesos(p.por_cobrar)} en efectivo.` : '';
    if (cobro && !confirm(cobro)) return;
    await this.accion(() => this.api.entregarParada(r.id, p.pedido_id, e.acta?.receptor_nombre ?? null), `Pedido ${p.numero} entregado`);
    this.actaDe.set(null);
    this.cargarPapeles();
  }

  async fallar(p: ParadaRuta): Promise<void> {
    const r = this.ruta(); const m = this.motivo().trim(); if (!r || !m) return;
    await this.accion(() => this.api.fallarParada(r.id, p.pedido_id, m), `Pedido ${p.numero}: no entregado. Devuélvalo a la tienda.`);
    this.fallando.set(null); this.motivo.set('');
  }

  private async accion(fn: () => any, ok?: string): Promise<void> {
    this.ocupado.set(true); this.error.set(null); this.aviso.set(null);
    try {
      this.poner(await firstValueFrom(fn()));
      if (ok) this.aviso.set(ok);
      if (this.ruta()?.estado === 'FINALIZADA') this.aviso.set('¡Ruta terminada! Entregue el efectivo, los papeles firmados y lo no entregado en la tienda.');
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo completar'); }
    finally { this.ocupado.set(false); }
  }

  nuevaRuta(): void { this.ruta.set(null); this.pestana.set('bolsa'); this.aviso.set(null); this.cargarBolsa(); }

  /** Hora acordada: se recarga la ruta para ver el cambio (y habilitar la salida). */
  async horaConfirmada(): Promise<void> {
    this.horaDe.set(null);
    this.aviso.set('Hora confirmada. A la persona le llega el aviso.');
    await this.cargarRuta();
  }

  compromiso = compromiso;
  franja(p: { programado_en?: string | null; programado_hasta?: string | null; hora_confirmada_en?: string | null }): string | null {
    return p.hora_confirmada_en ? franjaAcordada(p.programado_en, p.programado_hasta) : null;
  }

  // ── Contacto ──

  /** Número para WhatsApp: celular colombiano de 10 dígitos → con el 57 adelante. */
  wa(tel: string | null | undefined, texto: string): string {
    let n = (tel ?? '').replace(/\D/g, '');
    if (n.length === 10 && n.startsWith('3')) n = '57' + n;
    return `https://wa.me/${n}?text=${encodeURIComponent(texto)}`;
  }
  tel(t: string | null | undefined): string { return 'tel:' + (t ?? '').replace(/[^\d+]/g, ''); }

  mensajes(p: ParadaRuta): { etiqueta: string; texto: string }[] {
    const r = this.ruta();
    const nombre = (p.cliente_nombre ?? '').split(' ')[0] || 'buen día';
    const yo = r?.repartidor_nombre ? `soy ${r.repartidor_nombre}, ` : '';
    const cobro = +p.por_cobrar > 0 ? ` El valor a pagar en efectivo es ${this.pesos(p.por_cobrar)}.` : '';
    const firma = p.prestamo_estado === 'PENDIENTE_FIRMA' ? ' Tenga a mano su cédula: al recibir firma la autorización del bono mercado.' : ' Tenga a mano su cédula para recibir.';
    return [
      { etiqueta: 'Voy en camino', texto: `Hola ${nombre}, ${yo}domiciliario de EconomiAPP. Voy en camino con su pedido ${p.numero}.${cobro}${firma}` },
      { etiqueta: 'Ya llegué', texto: `Hola ${nombre}, ya estoy en ${p.direccion_texto ?? 'su dirección'} con su pedido ${p.numero}. ¿Me puede recibir?` },
      { etiqueta: 'No encuentro la dirección', texto: `Hola ${nombre}, ${yo}tengo su pedido ${p.numero} pero no encuentro ${p.direccion_texto ?? 'la dirección'}. ¿Me envía su ubicación o una referencia?` },
      { etiqueta: 'No contesta', texto: `Hola ${nombre}, estoy afuera con su pedido ${p.numero} y no he podido comunicarme. Por favor respóndame para entregárselo.` },
    ];
  }

  registrarContacto(p: ParadaRuta, canal: 'LLAMADA' | 'WHATSAPP', destino: 'TITULAR' | 'TERCERO' | 'TIENDA' = 'TITULAR'): void {
    const r = this.ruta(); if (!r) return;
    this.api.contactoParada(r.id, p.pedido_id, canal, destino).subscribe({ error: () => {} });
  }

  navegar(p: ParadaRuta): string {
    const destino = p.lat != null ? `${p.lat},${p.lng}` : encodeURIComponent(p.direccion_texto ?? '');
    return `https://www.google.com/maps/dir/?api=1&destination=${destino}&travelmode=driving`;
  }
  waze(p: ParadaRuta): string {
    return p.lat != null ? `https://waze.com/ul?ll=${p.lat},${p.lng}&navigate=yes` : `https://waze.com/ul?q=${encodeURIComponent(p.direccion_texto ?? '')}&navigate=yes`;
  }
  irATienda(): string | null {
    const t = this.ruta()?.tienda; const r = this.ruta();
    if (r?.origen_lat != null) return `https://www.google.com/maps/dir/?api=1&destination=${r.origen_lat},${r.origen_lng}&travelmode=driving`;
    return t?.direccion ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t.direccion)}` : null;
  }

  // ── Papeles ──

  async autorizacionPdf(p: ParadaRuta): Promise<void> {
    this.ocupado.set(true); this.error.set(null);
    try { abrirPdf(await firstValueFrom(this.api.autorizacionPdf(p.pedido_id)), `autorizacion-${p.numero}.pdf`); }
    catch (e: any) { this.error.set(await mensaje(e, 'No se pudo generar la autorización')); }
    finally { this.ocupado.set(false); }
  }

  /** La autorización en la impresora portátil, para que el titular la firme ahí mismo. */
  async autorizacionPortatil(p: ParadaRuta): Promise<void> {
    this.ocupado.set(true); this.error.set(null);
    try {
      const e = await firstValueFrom(this.api.imprimirSolicitudPrestamo(p.pedido_id));
      await this.imp.enviar((await this.imp.autorizacion(e, 'Copia para custodia', p.numero)).bytes());
      if (confirm('¿Imprimir también la copia para la persona?')) {
        await this.imp.enviar((await this.imp.autorizacion(e, 'Copia para la persona', p.numero)).bytes());
      }
    } catch (e: any) { this.error.set(e?.error?.error ?? e?.message ?? 'No se pudo imprimir la autorización'); }
    finally { this.ocupado.set(false); }
  }

  async comprobante(p: ParadaRuta): Promise<void> {
    this.ocupado.set(true); this.error.set(null);
    try {
      const e = this.actas()[p.pedido_id] ?? await firstValueFrom(this.api.estadoEntrega(p.pedido_id));
      if (!e.acta) throw new Error('Este pedido no tiene acta de entrega');
      const t = await this.imp.comprobante({
        numero: p.numero, tienda: this.ruta()?.tienda?.nombre, receptor_nombre: e.acta.receptor_nombre, receptor_cedula: e.acta.receptor_cedula,
        via: e.acta.via, modo_autorizacion: e.acta.modo_autorizacion, acta_sha256: e.acta.acta_sha256, creado_en: utc(e.acta.creado_en) ?? undefined,
        por_cobrar: +p.por_cobrar, repartidor: this.ruta()?.repartidor_nombre, pedido_id: p.pedido_id,
      });
      await this.imp.enviar(t.bytes());
    } catch (e: any) { this.error.set(e?.error?.error ?? e?.message ?? 'No se pudo imprimir el comprobante'); }
    finally { this.ocupado.set(false); }
  }

  // ── GPS ──

  private posicionActual(): Promise<{ lat: number; lng: number } | null> {
    if (!navigator.geolocation) return Promise.resolve(null);
    return new Promise(res => navigator.geolocation.getCurrentPosition(
      p => res({ lat: p.coords.latitude, lng: p.coords.longitude }), () => res(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 }));
  }

  private prenderGps(): void {
    if (this.vigia !== null || !navigator.geolocation) return;
    this.vigia = navigator.geolocation.watchPosition(p => {
      const y = { lat: p.coords.latitude, lng: p.coords.longitude };
      this.yo.set(y);
      const r = this.ruta();
      // Cada 20 s basta para ver el avance y no gasta los datos del domiciliario.
      if (r && r.estado === 'EN_CURSO' && Date.now() - this.ultimoEnvio > 20_000) {
        this.ultimoEnvio = Date.now();
        this.api.posicionRuta(r.id, y.lat, y.lng, Math.round(p.coords.accuracy)).subscribe({ error: () => {} });
      }
    }, () => {}, { enableHighAccuracy: true, maximumAge: 10_000 });
  }

  private apagarGps(): void {
    if (this.vigia !== null) { navigator.geolocation.clearWatch(this.vigia); this.vigia = null; }
  }

  terceros(p: ParadaRuta) { return (p.terceros ?? []).filter(t => t.estado !== 'RECHAZADO'); }
  esperando(p: DomicilioEnBolsa): string { return hace(p.minutos_esperando ?? minutosDesde(p.alistado_en ?? p.confirmado_en)); }
  hora(s: string | null | undefined): string | null { return utc(s); }
  pesos(v: number | null | undefined): string { return v == null ? '' : '$' + Math.round(+v).toLocaleString('es-CO'); }
  km(v: number | null | undefined): string { return v == null ? '' : (+v).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' km'; }
}

async function mensaje(e: any, porDefecto: string): Promise<string> {
  try { if (e?.error instanceof Blob) return JSON.parse(await e.error.text())?.error ?? porDefecto; } catch { /* no era JSON */ }
  return e?.error?.error ?? porDefecto;
}
