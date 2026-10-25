import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { DireccionGuardada, LugarMapa, MediosTienda, TiendaService, VerificacionResumen } from '../../../dashboard/submodule/tienda/service/tienda.service';
import { EcoImagen } from '../../components/eco-imagen';
import { EcoMapa } from '../../components/eco-mapa';
import { CapturaRostro, EcoCapturaRostro, reducir } from '../../components/eco-captura-rostro';
import { EcoFirma } from '../../components/eco-firma';
import { CONSENTIMIENTO_VERSION, TEXTO_AUTORIZA_TERCERO, TEXTO_TITULAR, huellaDelTexto } from '../../consentimiento-biometrico';
import { EconomiaStore } from '../../economia.store';
import { SonidosService } from '../../sonidos.service';
import { fechaLlegada, iconoCategoria, llegada, mensajeError, pesos, usuarioEnSesion } from '../../economia.util';

type Entrega = 'RECOGE_TIENDA' | 'RECOGE_OFICINA' | 'DOMICILIO';
type Pago = 'NOMINA' | 'EFECTIVO' | 'BONO' | 'TRANSFERENCIA' | 'NEQUI' | 'DAVIPLATA' | 'LLAVE' | 'PSE' | 'QR' | 'TARJETA';
/** Una parte del pago cuando se divide (bono + efectivo + cupo…). */
interface PartePago { metodo: Pago; monto: number; referencia: string; }
export const METODOS_PAGO: Array<{ valor: Pago; nombre: string; icono: string; ayuda: string; referencia?: string }> = [
  { valor: 'NOMINA', nombre: 'Bono mercado', icono: 'account_balance_wallet', ayuda: 'Se descuenta al entregarle' },
  { valor: 'EFECTIVO', nombre: 'Efectivo', icono: 'payments', ayuda: 'Paga al recibir' },
  { valor: 'BONO', nombre: 'Vale o bono de regalo', icono: 'card_giftcard', ayuda: 'La tienda verifica el vale', referencia: 'Código o número del vale' },
  { valor: 'NEQUI', nombre: 'Nequi', icono: 'phone_iphone', ayuda: 'La tienda verifica la transferencia', referencia: 'Número de la transacción' },
  { valor: 'DAVIPLATA', nombre: 'Daviplata', icono: 'phone_iphone', ayuda: 'La tienda verifica la transferencia', referencia: 'Número de la transacción' },
  { valor: 'LLAVE', nombre: 'Llave (Bre-B)', icono: 'key', ayuda: 'La tienda verifica la transferencia', referencia: 'Número de la transacción' },
  { valor: 'TRANSFERENCIA', nombre: 'Transferencia', icono: 'account_balance', ayuda: 'La tienda verifica la transferencia', referencia: 'Número de la transacción' },
  { valor: 'PSE', nombre: 'PSE', icono: 'account_balance', ayuda: 'Paga en línea con el link de la tienda', referencia: 'Número de la transacción PSE' },
  { valor: 'QR', nombre: 'Código QR', icono: 'qr_code_2', ayuda: 'Escanee el QR de la tienda con su app del banco', referencia: 'Número de la transacción' },
  { valor: 'TARJETA', nombre: 'Tarjeta', icono: 'credit_card', ayuda: 'Datáfono al recibir o link de pago de la tienda' },
];

/**
 * Carrito y pago en una sola pantalla, como en las apps de domicilios: arriba lo que lleva,
 * abajo cómo lo recibe, cuándo y con qué paga, y un solo botón para confirmar.
 *
 * <p>"Apartar" es recoger: al confirmar, la tienda reserva la mercancía y tesorería aparta el
 * cupo (todavía no lo descuenta). Domicilio es lo mismo, pero se lo llevan.
 *
 * <p>Sobre el dinero: lo que decide si alcanza es el servidor al confirmar, que vuelve a
 * preguntarle a tesorería. Aquí solo se avisa, comparando contra el disponible que ya dio
 * el motor — nunca se le resta nada en el navegador.
 */
@Component({
  selector: 'eco-carrito',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, NgTemplateOutlet, MatIconModule, RouterLink, EcoImagen, EcoMapa, EcoCapturaRostro, EcoFirma],
  templateUrl: './carrito.html',
  styleUrls: ['../../economiapp.css', './carrito.css'],
})
export class EconomiaCarrito {
  readonly store = inject(EconomiaStore);
  private sonidos = inject(SonidosService);
  private api = inject(TiendaService);
  private router = inject(Router);

  private readonly yo = usuarioEnSesion();

  readonly entrega = signal<Entrega>('RECOGE_TIENDA');
  readonly pago = signal<Pago>('NOMINA');
  /** Pago dividido: varias partes que suman el total (bono + efectivo + cupo…). */
  readonly dividir = signal(false);
  readonly partes = signal<PartePago[]>([]);
  readonly referenciaUnica = signal('');
  /** Medios que recibe cada tienda del carrito (configurados por la tienda). */
  readonly mediosPorTienda = signal<Record<string, MediosTienda>>({});
  /** Varias tiendas: cuánto bono mercado va a cada una y con qué paga el resto. */
  readonly bonoTienda = signal<Record<string, number>>({});
  readonly restoTienda = signal<Record<string, Pago>>({});
  /** Lo que acepta una tienda: su bono mercado (si lo da y la persona tiene) y sus medios. */
  aceptados(tid: string): Pago[] {
    const m = this.mediosPorTienda()[tid];
    if (!m) return METODOS_PAGO.map(x => x.valor);
    const out: Pago[] = [];
    if (m.acepta_bono_mercado) out.push('NOMINA');
    for (const x of m.medios) if (!out.includes(x.metodo as Pago)) out.push(x.metodo as Pago);
    if (!m.medios.length) out.push('EFECTIVO');
    return out;
  }
  /** Una sola tienda: solo los medios que esa tienda recibe. */
  readonly METODOS_TIENDA = computed(() => {
    const pt = this.store.porTienda();
    if (pt.length !== 1) return METODOS_PAGO;
    const ok = this.aceptados(pt[0].tienda_id);
    return METODOS_PAGO.filter(m => ok.includes(m.valor));
  });
  get METODOS() { return this.METODOS_TIENDA(); }
  /** Total aproximado de cada tienda: el domicilio lo cobra la primera. */
  totalTienda(i: number): number {
    const t = this.store.porTienda()[i];
    return (t?.subtotal ?? 0) + (i === 0 ? this.costoDomicilio() : 0);
  }
  elegirResto(tid: string, m: Pago): void { this.restoTienda.update(r => ({ ...r, [tid]: m })); }
  cambiarBono(tid: string, v: number, maximo: number): void {
    this.bonoTienda.update(b => ({ ...b, [tid]: Math.max(0, Math.min(maximo, Math.round(Number(v) || 0))) }));
  }
  /** Reparte el bono mercado disponible entre las tiendas que lo aceptan, en orden. */
  private repartirBono(): void {
    let queda = this.store.puedeNomina() ? (this.store.cupo()?.disponible ?? 0) : 0;
    const b: Record<string, number> = {}; const r: Record<string, Pago> = {};
    this.store.porTienda().forEach((t, i) => {
      const ok = this.aceptados(t.tienda_id);
      const v = ok.includes('NOMINA') ? Math.min(queda, this.totalTienda(i)) : 0;
      b[t.tienda_id] = Math.round(v); queda -= v;
      r[t.tienda_id] = this.restoTienda()[t.tienda_id] && ok.includes(this.restoTienda()[t.tienda_id]) ? this.restoTienda()[t.tienda_id]
        : (ok.find(x => x !== 'NOMINA') ?? 'EFECTIVO');
    });
    this.bonoTienda.set(b); this.restoTienda.set(r);
  }
  readonly nombre = signal(this.yo.nombre);

  // ── Asistente: 1 entrega, 2 pago, 3 confirmar ──
  readonly PASOS = [{ n: 1, t: 'Entrega' }, { n: 2, t: 'Pago' }, { n: 3, t: 'Confirmar' }];
  readonly paso = signal(1);
  /** El pago se arma siempre por tienda: bono mercado primero y el resto con un medio del local. */
  readonly porTienda = true;
  readonly TEXTO_TITULAR = TEXTO_TITULAR;
  readonly TEXTO_AUTORIZA_TERCERO = TEXTO_AUTORIZA_TERCERO;
  // Otra persona recibe
  readonly tNombre = signal('');
  readonly tCedula = signal('');
  readonly tTelefono = signal('');
  readonly tParentesco = signal('');
  readonly fotosT = signal<Record<'rostro' | 'cedula_frente' | 'cedula_reverso', Blob | null>>({ rostro: null, cedula_frente: null, cedula_reverso: null });
  readonly vistaT = signal<Record<'rostro' | 'cedula_frente' | 'cedula_reverso', string | null>>({ rostro: null, cedula_frente: null, cedula_reverso: null });
  readonly tomandoRostroT = signal(false);
  readonly aceptaTercero = signal(false);
  readonly terceroCompleto = computed(() => !!(this.tNombre().trim() && this.tCedula().trim() && this.fotosT().rostro && this.fotosT().cedula_frente && this.fotosT().cedula_reverso));
  // Identidad y firma
  readonly aceptaBio = signal(false);
  readonly sinBiometria = signal(false);
  readonly verificando = signal(false);
  readonly verificacion = signal<VerificacionResumen | null>(null);
  readonly errorVerif = signal<string | null>(null);
  readonly firmaPrestamo = signal<Blob | null>(null);

  irA(n: number): void { if (n <= this.paso()) { this.paso.set(n); window.scrollTo({ top: 0, behavior: 'smooth' }); } }
  siguiente(): void { if (!this.motivoPaso()) { this.paso.update(p => Math.min(3, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); } }

  async rostroTercero(c: CapturaRostro): Promise<void> { this.tomandoRostroT.set(false); this.ponerFotoT('rostro', c.blob); }
  async fotoTercero(cual: 'cedula_frente' | 'cedula_reverso', ev: Event): Promise<void> {
    const f = (ev.target as HTMLInputElement).files?.[0]; if (f) this.ponerFotoT(cual, await reducir(f, 1600));
  }
  private ponerFotoT(cual: 'rostro' | 'cedula_frente' | 'cedula_reverso', b: Blob): void {
    const previa = this.vistaT()[cual]; if (previa) URL.revokeObjectURL(previa);
    this.fotosT.update(f => ({ ...f, [cual]: b }));
    this.vistaT.update(v => ({ ...v, [cual]: URL.createObjectURL(b) }));
  }

  async verificarme(c: CapturaRostro): Promise<void> {
    this.verificando.set(true); this.errorVerif.set(null);
    try {
      const v = await firstValueFrom(this.api.verificarTitular(c.blob, c.vivacidad, { version: CONSENTIMIENTO_VERSION, sha256: await huellaDelTexto(TEXTO_TITULAR) }));
      this.verificacion.set(v);
      if (!v.aprueba) this.errorVerif.set(v.resultado === 'DUDOSA' ? 'No quedó claro: repita de frente y con más luz.' : 'Su rostro no coincidió con la foto de contratación. Intente de nuevo.');
    } catch (e) { this.errorVerif.set(mensajeError(e, 'No pudimos verificar su identidad ahora')); }
    finally { this.verificando.set(false); }
  }

  /** Lo que falta para pasar del paso actual (null = puede seguir). */
  readonly motivoPaso = computed(() => {
    if (this.paso() === 1) {
      if (this.faltaDireccion()) return !this.direccion().trim() ? 'Escriba la dirección del domicilio.' : 'Marque la ubicación en el mapa.';
      if (this.recibe() === 'TERCERO' && !this.terceroCompleto()) return 'Complete los datos y las fotos de quien recibe.';
      return null;
    }
    if (this.paso() === 2) {
      if (!this.nombre().trim()) return 'Escriba su nombre.';
      if (this.superaCupo()) return 'Lo que va por bono mercado supera su disponible.';
      if (this.montoNomina() > 0 && this.store.motivoSinCupo()) return this.store.motivoSinCupo();
      return null;
    }
    return null;
  });
  readonly motivoConfirmar = computed(() => {
    if (this.motivoPaso()) return this.motivoPaso();
    if (!this.verificacion()?.aprueba && !this.sinBiometria()) return 'Confirme que es usted con la foto de su cara.';
    if (this.montoNomina() > 0 && this.verificacion()?.aprueba && !this.firmaPrestamo()) return 'Firme la solicitud de préstamo.';
    if (this.recibe() === 'TERCERO' && (!this.verificacion()?.aprueba || !this.aceptaTercero())) return 'Acepte la declaración para autorizar a ' + (this.tNombre() || 'la persona') + '.';
    return null;
  });
  readonly telefono = signal(this.yo.telefono);
  readonly direccion = signal('');
  /** Quién va a recibir: si es otra persona, se autoriza (con foto y documento) al terminar. */
  readonly recibe = signal<'TITULAR' | 'TERCERO'>('TITULAR');
  /** Punto exacto del domicilio: sin él no se puede ordenar la ruta del repartidor. */
  readonly ubicacion = signal<{ lat: number; lng: number } | null>(leerUbicacion());
  readonly ubicando = signal(false);
  /** Direcciones guardadas de la persona (Casa, Trabajo…) y la elegida. */
  readonly misDirecciones = signal<DireccionGuardada[]>([]);
  readonly direccionElegida = signal<string | null>(null);
  readonly busqueda = signal('');
  readonly resultados = signal<LugarMapa[]>([]);
  readonly buscando = signal(false);
  /** Nombre con que se guarda la dirección nueva al confirmar; vacío = no guardar. */
  readonly guardarComo = signal('Casa');
  private buscarTimer: ReturnType<typeof setTimeout> | null = null;

  usarDireccion(d: DireccionGuardada): void {
    this.direccionElegida.set(d.id);
    this.direccion.set([d.direccion, d.barrio, d.municipio].filter(Boolean).join(', '));
    this.indicaciones.set(d.indicaciones ?? '');
    this.ubicacion.set({ lat: +d.latitud, lng: +d.longitud });
    this.resultados.set([]);
  }
  zona(l: LugarMapa): string { return [l.barrio, l.municipio, l.departamento].filter(Boolean).join(', '); }
  nuevaDireccion(): void {
    const usados = this.misDirecciones().map(d => d.nombre.toLowerCase());
    this.guardarComo.set(['Casa', 'Trabajo', 'Familia', 'Otra'].find(n => !usados.includes(n.toLowerCase())) ?? '');
    this.direccionElegida.set(null); this.direccion.set(''); this.indicaciones.set(''); this.ubicacion.set(null); this.busqueda.set('');
  }
  buscarDireccion(v: string): void {
    this.busqueda.set(v);
    if (this.buscarTimer) clearTimeout(this.buscarTimer);
    if (v.trim().length < 4) { this.resultados.set([]); return; }
    this.buscarTimer = setTimeout(() => {
      this.buscando.set(true);
      const t = this.store.tienda() as any;
      const cerca = this.ubicacion() ?? (t?.latitud != null ? { lat: +t.latitud, lng: +t.longitud } : null);
      this.api.geocodificar(v.trim(), cerca).subscribe({
        next: r => { this.resultados.set(r); this.buscando.set(false); },
        error: () => { this.resultados.set([]); this.buscando.set(false); },
      });
    }, 550);
  }
  elegirLugar(l: LugarMapa): void {
    this.direccion.set(this.busqueda().trim() || [l.direccion, l.barrio, l.municipio].filter(Boolean).join(', '));
    this.ubicacion.set({ lat: +l.latitud, lng: +l.longitud });
    this.resultados.set([]);
    if (!l.exacta) this.store.avisar('Ubicamos la calle: toque el mapa justo en su casa para afinar el punto.');
  }
  /** Al mover el punto a mano, la dirección guardada deja de ser la elegida. */
  moverPunto(p: { lat: number; lng: number }): void {
    this.ubicacion.set(p);
    this.direccionElegida.set(null);
  }
  readonly errorUbicacion = signal<string | null>(null);
  readonly indicaciones = signal('');
  readonly fecha = signal('');
  readonly hora = signal('');
  readonly observacion = signal('');

  readonly enviando = signal(false);
  readonly error = signal<string | null>(null);

  private readonly esActivable = (l: { tipo?: string }) => l.tipo === 'SERVICIO' || l.tipo === 'BONO';
  readonly paraHoy = computed(() => this.store.lineas().filter(l => !this.esActivable(l) && l.disponibilidad === 'EN_STOCK'));
  readonly porEncargo = computed(() => this.store.lineas().filter(l => !this.esActivable(l) && l.disponibilidad !== 'EN_STOCK'));
  readonly servicios = computed(() => this.store.lineas().filter(l => this.esActivable(l)));
  readonly soloServicios = computed(() => this.store.lineas().length > 0 && this.servicios().length === this.store.lineas().length);
  readonly varias = computed(() => this.store.porTienda().length > 1);

  readonly costoDomicilio = computed(() =>
    this.entrega() === 'DOMICILIO' ? this.store.costoDomicilio() : 0);
  readonly totalPedido = computed(() => this.store.total() + this.costoDomicilio());

  /** La cita no puede ser antes de que llegue lo encargado. */
  readonly fechaMinima = computed(() => {
    const d = new Date();
    d.setDate(d.getDate() + (this.store.diasMax() ?? 0));
    return d.toISOString().slice(0, 10);
  });

  /** El plan que se manda: una sola parte por el total, o las partes del pago dividido. */
  readonly plan = computed<PartePago[]>(() => this.dividir()
    ? this.partes().filter(p => Number(p.monto) > 0)
    : [{ metodo: this.pago(), monto: this.totalPedido(), referencia: this.referenciaUnica() }]);
  readonly sumaPlan = computed(() => this.plan().reduce((s, p) => s + Number(p.monto || 0), 0));
  readonly falta = computed(() => this.porTienda ? 0 : Math.round(this.totalPedido() - this.sumaPlan()));
  readonly montoNomina = computed(() => this.porTienda
    ? Object.values(this.bonoTienda()).reduce((s, v) => s + Number(v || 0), 0)
    : this.plan().filter(p => p.metodo === 'NOMINA').reduce((s, p) => s + Number(p.monto || 0), 0));

  readonly superaCupo = computed(() => {
    const c = this.store.cupo();
    return this.montoNomina() > 0 && !!c && !this.store.motivoSinCupo() && this.montoNomina() > c.disponible;
  });

  readonly faltaDireccion = computed(() => this.entrega() === 'DOMICILIO' && (!this.direccion().trim() || !this.ubicacion()));
  readonly puedeConfirmar = computed(() =>
    this.store.lineas().length > 0 && !this.enviando() && !this.superaCupo() && !this.faltaDireccion()
    && !!this.nombre().trim() && Math.abs(this.falta()) <= 1
    && !(this.montoNomina() > 0 && !!this.store.motivoSinCupo()) && this.paso() === 3 && !this.motivoConfirmar());

  readonly pesos = pesos;
  readonly llegada = llegada;
  readonly fechaLlegada = fechaLlegada;

  constructor() {
    // Sin cupo usable se arranca en efectivo, en vez de dejarle armar un pedido que no va a pasar.
    effect(() => {
      const sinCupo = !this.store.puedeNomina();
      untracked(() => { if (sinCupo) this.pago.set('EFECTIVO'); });
    });
    // Medios de cada tienda del carrito: cambian las opciones de pago.
    effect(() => {
      const ids = this.store.porTienda().map(t => t.tienda_id).sort().join(',');
      untracked(() => {
        if (!ids) return;
        this.api.mediosPago(ids.split(',')).subscribe({
          next: m => {
            this.mediosPorTienda.set(m);
            const ok = this.METODOS_TIENDA().map(x => x.valor);
            if (ok.length && !ok.includes(this.pago())) this.pago.set(ok[0]);
            this.repartirBono();
          },
          error: () => {},
        });
      });
    });
    this.api.misDirecciones().subscribe({
      next: ds => {
        this.misDirecciones.set(ds);
        const p = ds.find(d => +d.principal) ?? ds[0];
        if (p && !this.direccion().trim()) this.usarDireccion(p);
      },
      error: () => null,
    });
    // El bono mercado se reparte apenas se conoce el disponible (llega despues que el carrito).
    effect(() => { this.store.cupo(); this.mediosPorTienda(); untracked(() => { if (Object.keys(this.mediosPorTienda()).length) this.repartirBono(); }); });
    this.store.refrescarCarrito();
    this.store.refrescarCupo();
  }

  metodo(v: Pago) { return METODOS_PAGO.find(m => m.valor === v)!; }

  /** Al dividir se arranca con lo más común: lo que alcance del cupo y el resto en efectivo. */
  activarDivision(): void {
    const total = this.totalPedido();
    const cupo = this.store.puedeNomina() ? Math.min(Math.floor(this.store.cupo()?.disponible ?? 0), total) : 0;
    this.partes.set(cupo > 0 && cupo < total
      ? [{ metodo: 'NOMINA', monto: cupo, referencia: '' }, { metodo: 'EFECTIVO', monto: total - cupo, referencia: '' }]
      : [{ metodo: this.pago(), monto: Math.round(total / 2), referencia: '' }, { metodo: 'EFECTIVO', monto: total - Math.round(total / 2), referencia: '' }]);
    this.dividir.set(true);
  }

  cambiarParte(i: number, cambios: Partial<PartePago>): void {
    this.partes.update(ps => ps.map((p, j) => j === i ? { ...p, ...cambios, monto: Math.max(0, Number(cambios.monto ?? p.monto) || 0) } : p));
  }

  agregarParte(): void {
    const falta = Math.max(0, this.falta());
    const usados = new Set(this.partes().map(p => p.metodo));
    const metodo = (['EFECTIVO', 'BONO', 'NEQUI', 'TRANSFERENCIA', 'TARJETA'] as Pago[]).find(m => !usados.has(m)) ?? 'EFECTIVO';
    this.partes.update(ps => [...ps, { metodo, monto: falta, referencia: '' }]);
  }

  quitarParte(i: number): void {
    this.partes.update(ps => ps.filter((_, j) => j !== i));
    if (this.partes().length <= 1) {
      const unica = this.partes()[0];
      if (unica) { this.pago.set(unica.metodo); this.referenciaUnica.set(unica.referencia); }
      this.dividir.set(false);
    }
  }

  /** El resto que falta se lo lleva esta parte. */
  completar(i: number): void {
    const p = this.partes()[i];
    this.cambiarParte(i, { monto: Number(p.monto || 0) + this.falta() });
  }

  iconoDe(categoriaId: string | null): string {
    const c = this.store.categorias().find(x => x.id === categoriaId);
    return iconoCategoria(c?.nombre, c?.icono);
  }

  usarMiUbicacion(): void {
    if (!navigator.geolocation) { this.errorUbicacion.set('Este navegador no da la ubicación: toque el punto en el mapa.'); this.ubicacion.set({ lat: 4.711, lng: -74.0721 }); return; }
    this.ubicando.set(true); this.errorUbicacion.set(null);
    navigator.geolocation.getCurrentPosition(p => {
      const u = { lat: +p.coords.latitude.toFixed(7), lng: +p.coords.longitude.toFixed(7) };
      this.ubicacion.set(u); this.ubicando.set(false); this.direccionElegida.set(null);
      if (!this.direccion().trim()) {
        this.api.geocodificarInversa(u.lat, u.lng).subscribe({
          next: l => { if (!this.direccion().trim() && l?.direccion) this.direccion.set([l.direccion, l.barrio, l.municipio].filter(Boolean).join(', ')); },
          error: () => null,
        });
      }
      try { localStorage.setItem('eco.ubicacion', JSON.stringify(u)); } catch { /* sin almacenamiento */ }
    }, e => {
      this.ubicando.set(false);
      this.errorUbicacion.set(e.code === 1 ? 'No dio permiso de ubicación. Actívelo en el candado de la barra o toque el punto en el mapa.' : 'No pudimos ubicarlo. Toque el punto en el mapa.');
      if (!this.ubicacion()) this.ubicacion.set({ lat: 4.711, lng: -74.0721 });
    }, { enableHighAccuracy: true, timeout: 10_000 });
  }

  /**
   * Un solo pedido aunque el carrito tenga varias tiendas: el servidor crea una orden por
   * tienda (y aparte los servicios/bonos, que quedan activos con su código al instante).
   */
  async confirmar(): Promise<void> {
    if (!this.puedeConfirmar()) return;
    this.enviando.set(true);
    this.error.set(null);
    try {
      const r = await firstValueFrom(this.api.crearPedidoOficina({
        tiendas: this.store.porTienda().map(t => t.tienda_id),
        nombre: this.nombre().trim(),
        telefono: this.telefono().trim() || null,
        tipo_entrega: this.soloServicios() ? 'RECOGE_TIENDA' : this.entrega(),
        direccion: this.entrega() === 'DOMICILIO' ? this.direccion().trim() : null,
        latitud: this.entrega() === 'DOMICILIO' ? this.ubicacion()?.lat ?? null : null,
        longitud: this.entrega() === 'DOMICILIO' ? this.ubicacion()?.lng ?? null : null,
        indicaciones: this.indicaciones().trim() || null,
        recibe: this.recibe(),
        metodo_pago_previsto: 'MIXTO',
        pagos: null,
        // Un pago a cada local con sus medios: bono mercado primero y el resto (monto null) lo cuadra el servidor.
        pagos_por_tienda: this.porTienda ? Object.fromEntries(this.store.porTienda().map(t => [t.tienda_id, [
          ...(this.bonoTienda()[t.tienda_id] > 0 ? [{ metodo: 'NOMINA', monto: this.bonoTienda()[t.tienda_id], referencia: null }] : []),
          { metodo: this.restoTienda()[t.tienda_id] ?? 'EFECTIVO', monto: null, referencia: null },
        ]])) : null,
        observacion: this.observacion().trim() || null,
      }));
      if (this.entrega() === 'DOMICILIO' && !this.direccionElegida() && this.guardarComo().trim() && this.ubicacion()) {
        this.api.guardarDireccion({ nombre: this.guardarComo().trim(), direccion: this.direccion().trim(), indicaciones: this.indicaciones().trim() || null,
          latitud: this.ubicacion()!.lat, longitud: this.ubicacion()!.lng }).subscribe({ error: () => null });
      }
      const cita = this.citaIso();
      if (cita) {
        // La cita aplica a lo que se recoge o se lleva; los servicios se reclaman con código.
        for (const p of r.pedidos.filter(x => x.tipo_entrega !== 'RECOGE_TIENDA' || !this.soloServicios())) {
          await firstValueFrom(this.api.programarPedido(p.id, cita)).catch(() =>
            this.store.avisar('Pedido creado. No se pudo guardar la hora en todas las tiendas.', 'error'));
        }
      }
      // Firma de la solicitud de préstamo (si lleva bono mercado) y autorización de quien recibe,
      // con la misma verificación facial que acaba de hacer.
      const v = this.verificacion();
      for (const p of r.pedidos) {
        if (v?.aprueba && this.firmaPrestamo() && this.montoNomina() > 0) {
          await firstValueFrom(this.api.firmarSolicitudPrestamo(p.id, this.firmaPrestamo()!, v.id)).catch(() => null);
        }
        if (v?.aprueba && this.recibe() === 'TERCERO' && this.terceroCompleto()) {
          const f = this.fotosT();
          await firstValueFrom(this.api.autorizarTerceroVerificado(p.id, {
            nombre: this.tNombre().trim(), cedula: this.tCedula().trim(), telefono: this.tTelefono().trim() || undefined,
            parentesco: this.tParentesco().trim() || undefined, verificacion_id: v.id, consentimiento_version: CONSENTIMIENTO_VERSION,
            consentimiento_sha256: await huellaDelTexto(TEXTO_AUTORIZA_TERCERO), rostro: f.rostro!, cedula_frente: f.cedula_frente!, cedula_reverso: f.cedula_reverso!,
          })).catch(e => this.store.avisar(mensajeError(e, 'Pedido creado, pero no se pudo registrar a quien recibe: autorícelo desde el pedido'), 'error'));
        }
      }
      await this.store.refrescarCarrito();
      this.store.refrescarCupo();
      const primero = r.pedidos[0];
      this.sonidos.tocar('pedido');
      this.store.cargarPedidos();
      this.router.navigate(['/economiapp/pedidos', primero.id], { queryParams: { nuevo: 1 } });
    } catch (e) {
      this.error.set(mensajeError(e, 'No pudimos crear su pedido. Revise los datos e intente de nuevo.'));
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    } finally {
      this.enviando.set(false);
    }
  }

  /** Junta fecha y hora en un instante ISO. Vacío si no puso cita: es opcional. */
  private citaIso(): string | null {
    const f = this.fecha();
    if (!f) return null;
    const d = new Date(`${f}T${this.hora() || '09:00'}:00`);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
}

function leerUbicacion(): { lat: number; lng: number } | null {
  try { const v = JSON.parse(localStorage.getItem('eco.ubicacion') ?? 'null'); return v && isFinite(v.lat) && isFinite(v.lng) ? v : null; }
  catch { return null; }
}
