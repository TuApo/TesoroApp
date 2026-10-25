import {
  ChangeDetectionStrategy, Component, DestroyRef, HostListener, OnInit, computed, effect, inject, signal, untracked, viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, firstValueFrom, switchMap, of, catchError } from 'rxjs';

import { getLocalStorageItem, removeLocalStorageItem, setLocalStorageItem } from '../../../../../../core/utils/safe-storage';
import { EscanerCodigoComponent, ResultadoEscaneo } from '../../../../../../shared/components/escaner-codigo/escaner-codigo.component';
import { ImagenAmpliableComponent } from '../../../../../../shared/components/imagen-ampliable/imagen-ampliable.component';
import { BuscadorPersonas } from '../../components/buscador-personas/buscador-personas';
import { SelectorTienda } from '../../components/selector-tienda/selector-tienda';
import { TomarFoto } from '../../components/tomar-foto/tomar-foto';
import { ContextoTiendaService } from '../../service/contexto-tienda.service';
import QRCode from 'qrcode';
import {
  CanjePuntos, LineaVenta, MedioPago, MediosCaja, Pago, PersonaTarjeta, ProductoCaja, ResumenCaja, TiendaService, Venta, VentaAbierta,
} from '../../service/tienda.service';

/** Medios de pago de la caja, en el orden en que se usan. Todos se pueden combinar. */
interface Medio {
  codigo: string; nombre: string; icono: string;
  /** Pide referencia o foto del comprobante (lo concilia alguien contra el extracto). */
  soporte: boolean;
  /** Solo para colaboradores (descuenta de nómina). */
  soloColaborador?: boolean;
}

const MEDIOS: Medio[] = [
  { codigo: 'NOMINA', nombre: 'Bono mercado', icono: 'redeem', soporte: false, soloColaborador: true },
  { codigo: 'EFECTIVO', nombre: 'Efectivo', icono: 'payments', soporte: false },
  { codigo: 'QR', nombre: 'QR', icono: 'qr_code_2', soporte: true },
  { codigo: 'TARJETA', nombre: 'Tarjeta', icono: 'credit_card', soporte: true },
  { codigo: 'NEQUI', nombre: 'Nequi', icono: 'phone_iphone', soporte: true },
  { codigo: 'DAVIPLATA', nombre: 'Daviplata', icono: 'smartphone', soporte: true },
  { codigo: 'TRANSFERENCIA', nombre: 'Transferencia', icono: 'account_balance', soporte: true },
  { codigo: 'LLAVE', nombre: 'Llave', icono: 'key', soporte: true },
  { codigo: 'BONO', nombre: 'Vale / bono regalo', icono: 'card_giftcard', soporte: false },
];

/** Billetes para tocar en vez de teclear lo que entrega la persona. */
const BILLETES = [2000, 5000, 10000, 20000, 50000, 100000];

const CLAVE_ACTIVA = 'tuapo.tienda.caja.activa.';

/**
 * Caja registradora táctil.
 *
 * <p>Varias ventas abiertas a la vez (una por persona que se atiende), guardadas en el
 * servidor: si se recarga la página o se cambia de equipo, siguen ahí. Se vende a
 * colaboradores (pueden pagar con bono mercado, ya autorizado o directo) y a clientes de
 * mostrador (venta natural, sin bono). Los pagos se acumulan en cualquier combinación —
 * bono + efectivo + QR + tarjeta…— y los digitales llevan foto del comprobante. El efectivo
 * calcula las vueltas.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-punto-de-venta',
  imports: [CommonModule, FormsModule, MatIconModule, RouterLink, SelectorTienda, BuscadorPersonas, TomarFoto, ImagenAmpliableComponent, EscanerCodigoComponent],
  templateUrl: './pos.html',
  styleUrls: ['../../styles/tienda-comun.css', './pos.css'],
})
export class PuntoDeVenta implements OnInit {
  private api = inject(TiendaService);
  readonly ctx = inject(ContextoTiendaService);
  private destroy = inject(DestroyRef);

  readonly medios = MEDIOS;
  readonly billetes = BILLETES;
  readonly teclas = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', '⌫'];

  // ── Sesiones ────────────────────────────────────────────────────────────
  readonly abiertas = signal<VentaAbierta[]>([]);
  readonly venta = signal<Venta | null>(null);
  readonly lineas = signal<LineaVenta[]>([]);
  readonly pagos = signal<Pago[]>([]);
  readonly cobrado = signal(0);
  readonly pendiente = signal(0);

  /** Nueva venta: elegir tipo de cliente. */
  readonly nueva = signal<null | 'elegir' | 'colaborador' | 'mostrador'>(null);
  readonly personaNueva = signal<PersonaTarjeta | null>(null);
  mostrador = { nombre: '', telefono: '', cedula: '', etiqueta: '' };

  /** Persona (ficha completa) por cédula: la caja la reutiliza al cobrar con bono. */
  readonly personas = signal<Record<string, PersonaTarjeta>>({});
  /** Premios por puntos que cada persona canjeó en EconomiAPP y tiene por reclamar, y su saldo. */
  readonly premiosPorCedula = signal<Record<string, CanjePuntos[]>>({});
  readonly puntosPorCedula = signal<Record<string, number>>({});
  /** Canje leído con el escáner o el lector USB (QR "CANJE:…"), esperando confirmación. */
  readonly canjeLeido = signal<CanjePuntos | null>(null);
  readonly avisoPremio = signal<string | null>(null);
  readonly premiosPendientes = computed(() => this.premiosPorCedula()[this.venta()?.cliente_cedula ?? ''] ?? []);
  readonly puntosCliente = computed(() => this.puntosPorCedula()[this.venta()?.cliente_cedula ?? '']);
  /** Ventas en las que ya se verificó la identidad contra la foto. */
  readonly verificadas = signal<Set<string>>(new Set());
  readonly asignandoPersona = signal(false);

  etiqueta = '';
  observacion = '';

  // ── Catálogo ────────────────────────────────────────────────────────────
  readonly texto = signal('');
  readonly productos = signal<ProductoCaja[]>([]);
  readonly totalProductos = signal(0);
  readonly buscandoProductos = signal(false);
  readonly eligiendoVariante = signal<ProductoCaja | null>(null);
  /** Un código de barras repetido en varios productos: se elige cuál. */
  readonly eligiendoEntre = signal<{ codigo: string; cantidad: number; opciones: ProductoCaja[] } | null>(null);
  readonly leyendo = signal(false);
  private teclasLector = '';
  private ultimaTecla = 0;
  /** Foto por producto (de la caja y de las líneas) para pintar el tiquete. */
  readonly fotos = signal<Record<string, string>>({});
  private busquedas = new Subject<string>();

  // ── Cobro ───────────────────────────────────────────────────────────────
  readonly metodo = signal<string>('EFECTIVO');
  /** Lo que se teclea: en efectivo es lo recibido; en los demás, el monto del pago. */
  readonly teclado = signal('');
  readonly referencia = signal('');
  readonly soportes = signal<string[]>([]);
  readonly autorizacionElegida = signal<string | null>(null);
  cuotas = 1;
  readonly fotoPago = viewChild(TomarFoto);

  /** Cuentas de la tienda (Nequi, llave, banco, QR…) y pasarela activa. */
  readonly mediosCaja = signal<MediosCaja | null>(null);
  /** Cobro por pasarela en curso: QR del enlace de pago mientras la persona paga. */
  readonly cobro = signal<{ pago: Pago; url: string; qr: string | null } | null>(null);
  private sondeo: ReturnType<typeof setInterval> | null = null;

  readonly resumen = signal<ResumenCaja | null>(null);
  readonly exito = signal<{ numero: string; total: number; vueltas: number; medios: string } | null>(null);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);
  readonly trabajando = signal(false);

  readonly turno = signal<{ usuario_nombre: string | null; abierto_en: string } | null | undefined>(undefined);

  // ── Derivados ───────────────────────────────────────────────────────────
  readonly hayVenta = computed(() => this.venta() !== null);
  readonly esColaborador = computed(() => this.venta()?.cliente_tipo === 'COLABORADOR' && !!this.venta()?.cliente_cedula);
  readonly persona = computed(() => {
    const c = this.venta()?.cliente_cedula;
    return c ? this.personas()[c] ?? null : null;
  });
  readonly identidadVerificada = computed(() => !!this.venta() && this.verificadas().has(this.venta()!.id));
  readonly medioActual = computed(() => MEDIOS.find(m => m.codigo === this.metodo()) ?? MEDIOS[1]);
  readonly mediosDisponibles = computed(() => MEDIOS.filter(m => !m.soloColaborador || this.esColaborador()));
  readonly valorTecleado = computed(() => Number(this.teclado() || '0'));
  readonly unidades = computed(() => this.lineas().reduce((s, l) => s + Number(l.cantidad), 0));
  readonly vueltasTotales = computed(() => this.pagos().reduce((s, p) => s + Number(p.cambio ?? 0), 0));

  /** Monto que se aplicará a la venta con el pago que se está armando. */
  readonly montoAplicado = computed(() => {
    const v = this.valorTecleado();
    if (this.metodo() === 'EFECTIVO') return Math.min(v, this.pendiente());
    return v;
  });
  /** Vueltas del efectivo que se está recibiendo. */
  readonly vueltas = computed(() => this.metodo() === 'EFECTIVO' ? Math.max(0, this.valorTecleado() - this.pendiente()) : 0);

  readonly autorizaciones = computed(() => (this.persona()?.autorizaciones ?? []) as Array<Record<string, any>>);
  readonly autorizacionActual = computed(() =>
    this.autorizaciones().find(a => a['codigo_autorizacion'] === this.autorizacionElegida()) ?? null);

  readonly puedeAgregarPago = computed(() => {
    if (!this.hayVenta() || this.trabajando() || this.pendiente() <= 0) return false;
    const monto = this.montoAplicado();
    if (monto <= 0) return false;
    if (this.metodo() !== 'EFECTIVO' && monto > this.pendiente()) return false;
    if (this.metodo() === 'NOMINA') {
      if (!this.identidadVerificada()) return false;
      const a = this.autorizacionActual();
      if (a && monto > Number(a['autorizacion_monto'])) return false;
    }
    return true;
  });
  /** El medio elegido se cobra por la pasarela (QR de pago y confirmación automática). */
  readonly usaPasarela = computed(() => {
    const p = this.mediosCaja()?.pasarela;
    return !!p?.activa && p.metodos.includes(this.metodo());
  });
  /** Datos de la cuenta de la tienda para el medio elegido (lo que se le muestra a quien paga). */
  readonly datosMedio = computed<MedioPago[]>(() => {
    const m = this.metodo();
    return (this.mediosCaja()?.medios ?? []).filter(x => x.metodo === m);
  });
  readonly faltaSoporte = computed(() => !this.usaPasarela() && this.medioActual().soporte && !this.referencia().trim() && !this.soportes().length);
  /** Hay un cobro por pasarela sin aprobar: no se confirma (la persona se iría sin pagar). */
  readonly esperandoPasarela = computed(() => this.pagos().some(p => !!p.pasarela && p.estado === 'PENDIENTE'));
  readonly puedeConfirmar = computed(() =>
    this.hayVenta() && this.lineas().length > 0 && this.pendiente() === 0 && !this.trabajando() && !this.esperandoPasarela());

  private readonly vigilarTienda = effect(() => {
    const t = this.ctx.tiendaId();
    untracked(() => this.cambioDeTienda(t));
  });

  constructor() {
    this.destroy.onDestroy(() => this.pararSondeo());
  }

  ngOnInit(): void {
    this.ctx.cargar();
    this.busquedas.pipe(
      debounceTime(250),
      switchMap(q => {
        const t = this.ctx.tiendaId();
        if (!t) return of(null);
        this.buscandoProductos.set(true);
        return this.api.catalogoCaja(t, q.trim(), 0, 30).pipe(catchError(() => of(null)));
      }),
      takeUntilDestroyed(this.destroy),
    ).subscribe(r => {
      this.buscandoProductos.set(false);
      if (!r) return;
      this.productos.set(r.items);
      this.totalProductos.set(r.total);
      this.fotos.update(f => {
        const n = { ...f };
        for (const p of r.items) if (p.imagen) n[p.id] = p.imagen;
        return n;
      });
    });
  }

  // ── Tienda, turno y sesiones ────────────────────────────────────────────

  private cambioDeTienda(t: string | null): void {
    this.cerrarSesionLocal();
    this.abiertas.set([]);
    this.resumen.set(null);
    this.turno.set(undefined);
    if (!t) return;
    this.mediosCaja.set(null);
    this.api.mediosCaja(t).subscribe({ next: m => this.mediosCaja.set(m), error: () => this.mediosCaja.set(null) });
    this.api.turnosCaja(t, true).subscribe({ next: ts => this.turno.set(ts[0] ?? null), error: () => this.turno.set(undefined) });
    this.cargarResumen();
    this.busquedas.next(this.texto());
    this.api.ventasAbiertas(t).subscribe({
      next: vs => {
        this.abiertas.set(vs);
        const guardada = getLocalStorageItem(CLAVE_ACTIVA + t);
        const retomar = vs.find(v => v.id === guardada) ?? null;
        if (retomar) this.abrirSesion(retomar.id);
        else if (!vs.length) this.nueva.set('elegir');
      },
      error: () => this.nueva.set('elegir'),
    });
  }

  private recargarAbiertas(): void {
    const t = this.ctx.tiendaId();
    if (!t) return;
    this.api.ventasAbiertas(t).subscribe({ next: vs => this.abiertas.set(vs), error: () => {} });
  }

  cargarResumen(): void {
    const t = this.ctx.tiendaId();
    if (!t) return;
    this.api.resumenCaja(t).subscribe({ next: r => this.resumen.set(r), error: () => this.resumen.set(null) });
  }

  abrirSesion(id: string): void {
    this.nueva.set(null);
    this.exito.set(null);
    this.limpiarPago();
    this.error.set(null);
    this.asignandoPersona.set(false);
    this.api.detalleVenta(id).subscribe({
      next: d => {
        this.aplicarDetalle(d);
        const t = this.ctx.tiendaId();
        if (t) setLocalStorageItem(CLAVE_ACTIVA + t, id);
        this.etiqueta = d.venta.etiqueta ?? '';
        this.observacion = d.venta.observacion ?? '';
        const ced = d.venta.cliente_cedula;
        if (ced && d.venta.cliente_tipo === 'COLABORADOR' && !this.personas()[ced]) this.cargarPersona(ced);
        this.metodo.set(this.esColaborador() && this.persona()?.tiene_autorizacion_mercado ? 'NOMINA' : 'EFECTIVO');
      },
      error: e => this.fallo(e),
    });
  }

  private cargarPersona(cedula: string): void {
    const t = this.ctx.tiendaId();
    if (!t) return;
    this.cargarPremios(cedula);
    this.api.personaDetalle(cedula, t).subscribe({
      next: p => {
        this.personas.update(m => ({ ...m, [cedula]: p }));
        // Ventas abiertas solo con la cédula: se completa el nombre para reconocerlas.
        const v = this.venta();
        if (v && v.cliente_cedula === cedula && !v.cliente_nombre && p.nombre) {
          this.api.actualizarVenta(v.id, { cliente_nombre: p.nombre }).subscribe({
            next: nv => { this.venta.set({ ...v, ...nv }); this.recargarAbiertas(); }, error: () => {},
          });
        }
      },
      error: () => {},
    });
  }

  /** Premios por reclamar y saldo de puntos de la persona: se ofrecen al atenderla. */
  private cargarPremios(cedula: string): void {
    const t = this.ctx.tiendaId();
    this.api.canjesPendientes(cedula, t).subscribe({
      next: ks => this.premiosPorCedula.update(m => ({ ...m, [cedula]: ks ?? [] })), error: () => {},
    });
    this.api.puntosDePersona(cedula).subscribe({
      next: r => this.puntosPorCedula.update(m => ({ ...m, [cedula]: r.saldo })), error: () => {},
    });
  }

  async entregarPremio(k: CanjePuntos, confirmar = true): Promise<void> {
    const v = this.venta();
    const quien = k.nombre || k.cedula;
    if (confirmar && !confirm(`¿Entregar «${k.premio_nombre}» (${k.puntos} puntos) a ${quien}?`)) return;
    try {
      const r = await firstValueFrom(this.api.entregarCanje(k.codigo, {
        canal: 'CAJA', tienda_id: k.tienda_id ?? this.ctx.tiendaId(), venta_id: v?.id ?? null,
        cedula_presentada: v?.cliente_tipo === 'COLABORADOR' && v.cliente_cedula === k.cedula ? v.cliente_cedula : null,
      }));
      this.canjeLeido.set(null);
      this.avisoPremio.set(`Premio entregado: ${r.premio_nombre} a ${quien}.`);
      setTimeout(() => this.avisoPremio.set(null), 6000);
      this.cargarPremios(k.cedula);
    } catch (e: any) {
      this.error.set(e?.error?.error ?? e?.error?.mensaje ?? 'No se pudo entregar el premio');
    }
  }

  /** QR de un premio (CANJE:…) leído en la caja: se consulta y se pide confirmar la entrega. */
  private async leerCanje(crudo: string): Promise<{ ok: boolean; texto: string; detalle?: string }> {
    try {
      const k = await firstValueFrom(this.api.canjePorCodigo(crudo));
      if (k.estado !== 'SOLICITADO' || Number(k.vencido)) {
        return { ok: false, texto: `${k.premio_nombre}: ${Number(k.vencido) ? 'venció' : k.estado.toLowerCase()}` };
      }
      this.canjeLeido.set(k);
      return { ok: true, texto: `Premio: ${k.premio_nombre}`, detalle: `${k.nombre || k.cedula} · cierre la cámara y confirme la entrega` };
    } catch {
      return { ok: false, texto: 'Ese código de premio no existe' };
    }
  }

  nuevaVenta(): void {
    this.cerrarSesionLocal();
    this.personaNueva.set(null);
    this.mostrador = { nombre: '', telefono: '', cedula: '', etiqueta: '' };
    this.nueva.set('elegir');
  }

  personaElegidaNueva(p: PersonaTarjeta): void {
    this.personaNueva.set(p);
    this.personas.update(m => ({ ...m, [p.cedula]: p }));
  }

  abrirVenta(tipo: 'COLABORADOR' | 'MOSTRADOR'): void {
    const tienda = this.ctx.tiendaId();
    if (!tienda) return;
    const p = this.personaNueva();
    this.trabajando.set(true);
    this.api.abrirVenta(tipo === 'COLABORADOR' && p ? {
      tienda_id: tienda, cliente_cedula: p.cedula, cliente_nombre: p.nombre ?? undefined, cliente_tipo: 'COLABORADOR',
      etiqueta: (p.nombre ?? p.cedula).split(' ').slice(0, 2).join(' '),
    } : {
      tienda_id: tienda, cliente_tipo: 'MOSTRADOR',
      cliente_nombre: this.mostrador.nombre.trim() || undefined,
      cliente_telefono: this.mostrador.telefono.trim() || undefined,
      cliente_cedula: this.mostrador.cedula.trim() || undefined,
      etiqueta: this.mostrador.etiqueta.trim() || this.mostrador.nombre.trim() || `Cliente ${this.abiertas().length + 1}`,
    }).subscribe({
      next: v => {
        this.trabajando.set(false);
        // Abrir con cédula de mostrador no la vuelve colaborador.
        if (tipo === 'MOSTRADOR' && v.cliente_tipo !== 'MOSTRADOR') {
          this.api.actualizarVenta(v.id, { cliente_tipo: 'MOSTRADOR' }).subscribe({ next: () => {}, error: () => {} });
        }
        this.recargarAbiertas();
        this.abrirSesion(v.id);
      },
      error: e => { this.trabajando.set(false); this.fallo(e); },
    });
  }

  private cerrarSesionLocal(): void {
    this.pararSondeo();
    this.cobro.set(null);
    this.venta.set(null);
    this.lineas.set([]);
    this.pagos.set([]);
    this.cobrado.set(0);
    this.pendiente.set(0);
    this.limpiarPago();
  }

  // ── Datos de la sesión ──────────────────────────────────────────────────

  guardarEtiqueta(): void {
    const v = this.venta();
    if (!v || (v.etiqueta ?? '') === this.etiqueta.trim()) return;
    this.api.actualizarVenta(v.id, { etiqueta: this.etiqueta.trim() || null }).subscribe({
      next: nv => { this.venta.set({ ...v, ...nv }); this.recargarAbiertas(); },
      error: e => this.fallo(e),
    });
  }

  guardarObservacion(): void {
    const v = this.venta();
    if (!v || (v.observacion ?? '') === this.observacion.trim()) return;
    this.api.actualizarVenta(v.id, { observacion: this.observacion.trim() || null }).subscribe({
      next: nv => { this.venta.set({ ...v, ...nv }); this.aviso.set('Observación guardada.'); },
      error: e => this.fallo(e),
    });
  }

  /** Convierte la sesión en venta a un colaborador (para poder pagar con bono). */
  asignarPersona(p: PersonaTarjeta): void {
    const v = this.venta();
    if (!v) return;
    this.personas.update(m => ({ ...m, [p.cedula]: p }));
    this.api.actualizarVenta(v.id, {
      cliente_cedula: p.cedula, cliente_nombre: p.nombre, cliente_tipo: 'COLABORADOR',
      etiqueta: v.etiqueta || (p.nombre ?? p.cedula).split(' ').slice(0, 2).join(' '),
    }).subscribe({
      next: nv => {
        this.venta.set({ ...v, ...nv });
        this.etiqueta = nv.etiqueta ?? this.etiqueta;
        this.asignandoPersona.set(false);
        this.recargarAbiertas();
        if (p.tiene_autorizacion_mercado) this.elegirMetodo('NOMINA');
      },
      error: e => this.fallo(e),
    });
  }

  quitarPersona(): void {
    const v = this.venta();
    if (!v) return;
    this.api.actualizarVenta(v.id, { cliente_cedula: null, cliente_tipo: 'MOSTRADOR' }).subscribe({
      next: nv => { this.venta.set({ ...v, ...nv }); this.recargarAbiertas(); if (this.metodo() === 'NOMINA') this.elegirMetodo('EFECTIVO'); },
      error: e => this.fallo(e),
    });
  }

  confirmarIdentidad(coincide: boolean): void {
    const v = this.venta();
    const p = this.persona();
    if (!v) return;
    const resultado = coincide ? 'CONFIRMADA' : (p?.tiene_foto === false ? 'SIN_FOTO' : 'RECHAZADA');
    this.api.verificarIdentidad(v.id, resultado).subscribe({
      next: () => {
        if (coincide) this.verificadas.update(s => new Set(s).add(v.id));
        this.aviso.set(coincide ? 'Identidad verificada: ya puede cobrar con bono mercado.'
          : 'Quedó registrado que no coincide. No se puede cobrar con bono mercado.');
      },
      error: e => this.fallo(e),
    });
  }

  // ── Productos ───────────────────────────────────────────────────────────

  escribir(valor: string): void {
    this.texto.set(valor);
    this.busquedas.next(valor);
  }

  /** Enter en el buscador: el lector de códigos manda el código y Enter. */
  enterBuscador(): void {
    const crudo = this.texto().trim();
    if (/^canje:/i.test(crudo)) { this.escribir(''); void this.leerCanje(crudo); return; }
    if (/^(\d+\s*\*\s*)?[0-9A-Za-z-]{4,}$/.test(crudo) && /\d{4,}|\*/.test(crudo)) {
      this.escribir('');
      this.leerCodigo(crudo);
      return;
    }
    const q = crudo.toLowerCase();
    if (!q) return;
    const exacto = this.productos().find(p => p.codigo_barras?.toLowerCase() === q || p.sku.toLowerCase() === q)
      ?? (this.productos().length === 1 ? this.productos()[0] : null);
    if (exacto) { this.tocarProducto(exacto); this.escribir(''); }
  }

  /**
   * Un código leído (lector USB, cámara o tecleado). Acepta "3*7702…" para vender 3 de una
   * vez. Busca en el servidor por barras, código interno o del sistema anterior.
   */
  leerCodigo(entrada: string): void {
    if (/^canje:/i.test(entrada.trim())) { void this.leerCanje(entrada.trim()); return; }
    const m = entrada.trim().match(/^(?:(\d+)\s*\*\s*)?(.+)$/);
    if (!m) return;
    const cantidad = Math.max(1, Math.min(999, Number(m[1] ?? 1)));
    const codigo = m[2].trim();
    const t = this.ctx.tiendaId();
    if (!t) return;
    if (!this.hayVenta()) { this.error.set('Abra una venta antes de leer productos.'); return; }
    this.leyendo.set(true);
    this.api.catalogoCaja(t, codigo, 0, 10).subscribe({
      next: r => {
        this.leyendo.set(false);
        const exactos = r.items.filter(x => x.coincide_codigo);
        if (exactos.length === 1) { this.agregarLeido(exactos[0], cantidad); return; }
        if (exactos.length > 1) { this.eligiendoEntre.set({ codigo, cantidad, opciones: exactos }); return; }
        this.error.set(`No hay ningún producto con el código ${codigo} en esta tienda.`);
      },
      error: e => { this.leyendo.set(false); this.fallo(e); },
    });
  }

  /**
   * Lector de cámara en modo continuo: cada producto leído entra al tiquete sin cerrar la
   * cámara. Si el código es de varios productos o el producto tiene opciones, se avisa y la
   * caja pregunta al cerrar (las mismas ventanas que con el lector USB).
   */
  readonly procesarCodigoCamara = async (entrada: string): Promise<ResultadoEscaneo> => {
    if (/^canje:/i.test(entrada.trim())) return this.leerCanje(entrada.trim());
    const m = entrada.trim().match(/^(?:(\d+)\s*\*\s*)?(.+)$/);
    const t = this.ctx.tiendaId();
    if (!m || !t) return { ok: false, texto: 'Elija la tienda primero' };
    if (!this.hayVenta()) return { ok: false, texto: 'Abra una venta antes de leer productos' };
    const cantidad = Math.max(1, Math.min(999, Number(m[1] ?? 1)));
    const codigo = m[2].trim();
    try {
      const r = await firstValueFrom(this.api.catalogoCaja(t, codigo, 0, 10));
      const exactos = r.items.filter(x => x.coincide_codigo);
      if (!exactos.length) return { ok: false, texto: 'No hay producto con ese código en esta tienda', detalle: codigo };
      if (exactos.length > 1) {
        this.eligiendoEntre.set({ codigo, cantidad, opciones: exactos });
        return { ok: false, texto: `${exactos.length} productos con el mismo código`, detalle: 'Cierre la cámara y elija cuál es' };
      }
      const p = exactos[0];
      if (p.estado === 'NO_DISPONIBLE') return { ok: false, texto: `«${p.nombre}» no está disponible aquí` };
      if (p.variantes.length > 1) {
        this.eligiendoVariante.set(p);
        return { ok: false, texto: p.nombre, detalle: 'Tiene opciones: cierre la cámara y elija' };
      }
      this.agregar(p, p.variantes[0]?.id, cantidad);
      return { ok: true, texto: `${cantidad > 1 ? cantidad + ' × ' : ''}${p.nombre}`, detalle: p.precio != null ? this.formatoPesos(p.precio) : null };
    } catch {
      return { ok: false, texto: 'No se pudo buscar el código', detalle: 'Revise la conexión' };
    }
  };

  private formatoPesos(v: number): string {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v);
  }

  agregarLeido(p: ProductoCaja, cantidad: number): void {
    this.eligiendoEntre.set(null);
    if (p.estado === 'NO_DISPONIBLE') { this.error.set(`«${p.nombre}» no está disponible en esta tienda.`); return; }
    if (p.variantes.length > 1) { this.eligiendoVariante.set(p); return; }
    this.agregar(p, p.variantes[0]?.id, cantidad);
  }

  /**
   * Lector USB (teclado): escribe el código muy rápido y Enter. Si el cursor no está en un
   * campo, igual se captura aquí para no perder la lectura.
   */
  @HostListener('document:keydown', ['$event'])
  teclaGlobal(ev: KeyboardEvent): void {
    const destino = ev.target as HTMLElement | null;
    if (destino && (['INPUT', 'TEXTAREA', 'SELECT'].includes(destino.tagName) || destino.isContentEditable)) return;
    if (!this.hayVenta()) return;
    const ahora = Date.now();
    if (ahora - this.ultimaTecla > 60) this.teclasLector = '';
    this.ultimaTecla = ahora;
    if (ev.key === 'Enter') {
      if (this.teclasLector.length >= 6) { ev.preventDefault(); this.leerCodigo(this.teclasLector); }
      this.teclasLector = '';
    } else if (ev.key.length === 1) {
      this.teclasLector += ev.key;
    }
  }

  tocarProducto(p: ProductoCaja): void {
    if (!this.hayVenta()) { this.error.set('Abra una venta primero.'); return; }
    if (p.estado === 'NO_DISPONIBLE') { this.error.set(`«${p.nombre}» no está disponible en esta tienda.`); return; }
    if (p.variantes.length > 1) { this.eligiendoVariante.set(p); return; }
    this.agregar(p, p.variantes[0]?.id);
  }

  agregar(p: ProductoCaja, varianteId?: string, cantidad = 1): void {
    const v = this.venta();
    if (!v) return;
    this.eligiendoVariante.set(null);
    if (p.imagen) this.fotos.update(f => ({ ...f, [p.id]: p.imagen! }));
    // Si ya está en el tiquete, se suma uno a esa línea en vez de abrir otra.
    const existente = this.lineas().find(l => l.producto_id === p.id && (l.variante_id ?? undefined) === varianteId);
    if (existente) { this.cambiarCantidad(existente, cantidad); return; }
    this.api.agregarLinea(v.id, { producto_id: p.id, variante_id: varianteId, cantidad }).subscribe({
      next: () => this.refrescar(),
      error: e => this.fallo(e),
    });
  }

  cambiarCantidad(l: LineaVenta, delta: number): void {
    const nueva = Number(l.cantidad) + delta;
    if (nueva <= 0) { this.quitar(l); return; }
    this.lineas.update(ls => ls.map(x => x.id === l.id ? { ...x, cantidad: nueva } : x));
    this.api.cambiarCantidadLinea(l.id, nueva).subscribe({
      next: () => this.refrescar(),
      error: e => { this.fallo(e); this.refrescar(); },
    });
  }

  quitar(l: LineaVenta): void {
    this.api.quitarLinea(l.id).subscribe({ next: () => this.refrescar(), error: e => this.fallo(e) });
  }

  textoEstado(p: { estado: string; existencias: number; dias_entrega: number | null; controla_stock?: boolean; compuesto?: boolean }): string {
    if (p.estado === 'EN_STOCK' && p.controla_stock === false && Number(p.existencias) <= 0) return 'Disponible (sin conteo)';
    if (p.estado === 'EN_STOCK') return Number(p.existencias) >= 9999 ? 'Disponible' : `${Number(p.existencias)} disp.`;
    if (p.estado === 'BAJO_PEDIDO') return p.dias_entrega ? `Bajo pedido · ${p.dias_entrega} días` : 'Bajo pedido';
    return 'No disponible';
  }

  // ── Cobro ───────────────────────────────────────────────────────────────

  elegirMetodo(codigo: string): void {
    this.metodo.set(codigo);
    this.referencia.set('');
    this.soportes.set([]);
    this.fotoPago()?.limpiar();
    this.cuotas = 1;
    const pend = this.pendiente();
    if (codigo === 'EFECTIVO') { this.teclado.set(''); return; }
    if (codigo === 'NOMINA') {
      const auts = this.autorizaciones();
      const a = auts.length ? auts[0] : null;
      this.autorizacionElegida.set(a ? a['codigo_autorizacion'] : null);
      const tope = a ? Math.min(pend, Number(a['autorizacion_monto'])) : pend;
      this.teclado.set(String(Math.max(0, Math.round(tope))));
      return;
    }
    this.teclado.set(pend > 0 ? String(Math.round(pend)) : '');
  }

  elegirAutorizacion(codigo: string | null): void {
    this.autorizacionElegida.set(codigo);
    const a = this.autorizacionActual();
    const pend = this.pendiente();
    this.teclado.set(String(Math.round(a ? Math.min(pend, Number(a['autorizacion_monto'])) : pend)));
  }

  tecla(t: string): void {
    if (t === '⌫') { this.teclado.update(v => v.slice(0, -1)); return; }
    this.teclado.update(v => (v === '0' ? '' : v) + t);
    if (this.teclado().length > 10) this.teclado.update(v => v.slice(0, 10));
  }

  sumarBillete(b: number): void { this.teclado.set(String(this.valorTecleado() + b)); }
  exacto(): void { this.teclado.set(String(Math.round(this.pendiente()))); }
  borrarTeclado(): void { this.teclado.set(''); }

  agregarPago(): void {
    const v = this.venta();
    if (!v || !this.puedeAgregarPago()) return;
    if (this.faltaSoporte()) { this.error.set('Tome la foto del comprobante o escriba la referencia.'); return; }
    const metodo = this.metodo();
    const docs = this.soportes();
    const monto = this.montoAplicado();
    this.trabajando.set(true);
    this.error.set(null);
    this.api.agregarPago(v.id, {
      metodo,
      monto,
      recibido: metodo === 'EFECTIVO' ? this.valorTecleado() : undefined,
      referencia: this.referencia().trim() || undefined,
      evidencia_doc_id: docs[0],
      cuotas: metodo === 'NOMINA' && !this.autorizacionElegida() ? this.cuotas : undefined,
      codigo_autorizacion: metodo === 'NOMINA' ? this.autorizacionElegida() ?? undefined : undefined,
    }).subscribe({
      next: async pago => {
        // El primer soporte va en el pago; los demás quedan como evidencias del mismo pago.
        for (const doc of docs.slice(1)) {
          try { await firstValueFrom(this.api.adjuntarEvidencia({ entidad_tipo: 'PAGO', entidad_id: pago.id, doc_id: doc })); } catch { /* sigue */ }
        }
        this.trabajando.set(false);
        if (metodo === 'EFECTIVO' && Number(pago.cambio ?? 0) > 0) {
          this.aviso.set(`Entregue vueltas: ${this.pesos(Number(pago.cambio))}`);
        }
        this.limpiarPago();
        this.refrescar();
      },
      error: e => { this.trabajando.set(false); this.fallo(e); },
    });
  }

  // ── Pasarela ───────────────────────────────────────────────────────────

  /** Genera el cobro en la pasarela y muestra el QR; se confirma solo cuando la persona paga. */
  generarCobro(): void {
    const v = this.venta();
    if (!v || !this.puedeAgregarPago()) return;
    this.trabajando.set(true);
    this.error.set(null);
    this.api.cobroPasarela(v.id, this.metodo(), this.montoAplicado()).subscribe({
      next: c => { this.trabajando.set(false); this.mostrarCobro(c.pago, c.url); this.refrescar(); },
      error: e => { this.trabajando.set(false); this.fallo(e); },
    });
  }

  private async mostrarCobro(pago: Pago, url: string): Promise<void> {
    this.cobro.set({ pago, url, qr: null });
    try {
      const qr = await QRCode.toDataURL(url, { width: 360, margin: 1, errorCorrectionLevel: 'M' });
      if (this.cobro()?.pago.id === pago.id) this.cobro.set({ pago, url, qr });
    } catch { /* se puede abrir el enlace */ }
    this.pararSondeo();
    this.sondeo = setInterval(() => this.consultarCobro(), 3000);
  }

  private consultarCobro(): void {
    const c = this.cobro();
    if (!c) { this.pararSondeo(); return; }
    this.api.consultarPasarela(c.pago.id).subscribe({
      next: p => {
        if (p.estado === 'VERIFICADO') {
          this.pararSondeo();
          this.cobro.set(null);
          this.aviso.set(`Pago aprobado por la pasarela: ${this.pesos(p.monto)} (${this.nombreMedio(p.metodo)}).`);
          this.refrescar();
        } else if (p.estado === 'RECHAZADO') {
          this.pararSondeo();
          this.cobro.set(null);
          this.error.set(`La pasarela no aprobó el pago: ${p.motivo_rechazo ?? p.pasarela_estado ?? 'rechazado'}. Intente de nuevo o con otro medio.`);
          this.refrescar();
        } else {
          this.cobro.set({ ...c, pago: p });
        }
      },
      error: () => { /* reintenta en la próxima vuelta */ },
    });
  }

  cancelarCobro(): void {
    const c = this.cobro();
    if (!c) return;
    this.api.cancelarPasarela(c.pago.id).subscribe({
      next: () => { this.pararSondeo(); this.cobro.set(null); this.aviso.set('Cobro cancelado.'); this.refrescar(); },
      error: e => this.fallo(e),
    });
  }

  private pararSondeo(): void {
    if (this.sondeo) { clearInterval(this.sondeo); this.sondeo = null; }
  }

  quitarPago(p: Pago): void {
    this.api.quitarPago(p.id).subscribe({ next: () => this.refrescar(), error: e => this.fallo(e) });
  }

  confirmar(): void {
    const v = this.venta();
    if (!v || !this.puedeConfirmar()) return;
    this.trabajando.set(true);
    const vueltas = this.vueltasTotales();
    const medios = this.pagos().map(p => this.nombreMedio(p.metodo)).join(' + ');
    this.api.confirmarVenta(v.id).subscribe({
      next: c => {
        this.trabajando.set(false);
        const t = this.ctx.tiendaId();
        if (t) removeLocalStorageItem(CLAVE_ACTIVA + t);
        this.exito.set({ numero: c.numero, total: Number(c.total), vueltas, medios });
        this.cerrarSesionLocal();
        this.recargarAbiertas();
        this.cargarResumen();
        this.busquedas.next(this.texto());
        const ced = v.cliente_cedula;
        if (ced) this.personas.update(m => { const n = { ...m }; delete n[ced]; return n; });
      },
      error: e => { this.trabajando.set(false); this.fallo(e); },
    });
  }

  anular(): void {
    const v = this.venta();
    if (!v) return;
    if (!confirm(`¿Anular la venta ${v.numero}? Se liberan los productos apartados.`)) return;
    this.api.anularVenta(v.id, 'Anulada desde la caja').subscribe({
      next: () => {
        const t = this.ctx.tiendaId();
        if (t) removeLocalStorageItem(CLAVE_ACTIVA + t);
        this.aviso.set(`Venta ${v.numero} anulada.`);
        this.cerrarSesionLocal();
        this.recargarAbiertas();
        this.nueva.set('elegir');
      },
      error: e => this.fallo(e),
    });
  }

  despuesDeExito(): void {
    this.exito.set(null);
    this.nuevaVenta();
  }

  nombreMedio(codigo: string): string { return MEDIOS.find(m => m.codigo === codigo)?.nombre ?? codigo; }
  iconoMedio(codigo: string): string { return MEDIOS.find(m => m.codigo === codigo)?.icono ?? 'payments'; }

  pesos(n: number | null | undefined): string {
    return '$' + Math.round(Number(n ?? 0)).toLocaleString('es-CO');
  }

  nombreSesion(s: VentaAbierta): string {
    return s.etiqueta || s.cliente_nombre?.split(' ').slice(0, 2).join(' ') || s.numero;
  }

  // ── Interior ────────────────────────────────────────────────────────────

  private refrescar(): void {
    const v = this.venta();
    if (!v) return;
    this.api.detalleVenta(v.id).subscribe({
      next: d => {
        this.aplicarDetalle(d);
        this.recargarAbiertas();
        if (this.pendiente() > 0 && this.metodo() !== 'EFECTIVO' && !this.teclado()) this.elegirMetodo(this.metodo());
      },
      error: e => this.fallo(e),
    });
  }

  private aplicarDetalle(d: { venta: Venta; lineas: Array<Record<string, unknown>>; pagos: Pago[]; cobrado: number; pendiente: number }): void {
    this.venta.set(d.venta);
    const lineas = d.lineas as unknown as LineaVenta[];
    this.lineas.set(lineas);
    this.pagos.set(d.pagos);
    this.cobrado.set(Number(d.cobrado));
    this.pendiente.set(Number(d.pendiente));
    const enCurso = d.pagos.find(p => p.pasarela && p.estado === 'PENDIENTE' && p.pasarela_url);
    if (enCurso && this.cobro()?.pago.id !== enCurso.id) this.mostrarCobro(enCurso, enCurso.pasarela_url!);
    const sinFoto = lineas.map(l => l.producto_id).filter((id): id is string => !!id && !(id in this.fotos()));
    if (sinFoto.length) {
      this.api.imagenesPrincipales(sinFoto).subscribe({
        next: m => this.fotos.update(f => ({ ...f, ...m })),
        error: () => {},
      });
    }
  }

  private limpiarPago(): void {
    this.teclado.set('');
    this.referencia.set('');
    this.soportes.set([]);
    this.fotoPago()?.limpiar();
    this.cuotas = 1;
    if (this.metodo() !== 'NOMINA') this.autorizacionElegida.set(null);
  }

  private fallo(e: unknown): void {
    const cuerpo = (e as { error?: { error?: string; message?: string } })?.error;
    this.error.set(cuerpo?.error ?? cuerpo?.message ?? 'No se pudo completar la operación');
    this.aviso.set(null);
  }
}
