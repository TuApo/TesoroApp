import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { firstValueFrom, map } from 'rxjs';
import { DocViewerService } from '@/app/shared/services/doc-viewer/doc-viewer.service';
import { environment } from '../../../../../environments/environment';

import {
  MedioPago, Activacion, CupoBloqueado, EstadoPagoTemporal, Pedido, PedidoGrupo, TerceroReclamo, TiendaService,
} from '../../../dashboard/submodule/tienda/service/tienda.service';
import { EconomiaStore } from '../../economia.store';
import { EcoAutorizarTercero } from '../../components/eco-autorizar-tercero';
import { EcoFirmarPrestamo } from '../../components/eco-firmar-prestamo';
import { ESTADO_CUPO, ESTADO_PEDIDO, PASOS_PEDIDO, TIPO_ENTREGA, mensajeError, pesos } from '../../economia.util';

type QrFn = (texto: string, opciones: { margin: number; width: number }) => Promise<string>;

interface Detalle {
  activaciones?: Activacion[];
  grupo?: PedidoGrupo | null;
  pedido: Pedido & { cliente_telefono?: string | null; indicaciones?: string | null; costo_domicilio?: number; subtotal?: number; metodo_pago_previsto?: string | null; motivo_rechazo?: string | null };
  lineas: Array<{ id: string; descripcion: string; cantidad: number; precio_unitario: number; total: number; disponibilidad: string; producto_id: string | null }>;
  seguimiento: Array<{ id: string; estado: string; comentario: string | null; ocurrido_en: string; usuario_nombre: string | null }>;
  cupo_bloqueado: CupoBloqueado | null;
  estado_pago_temporal: EstadoPagoTemporal | null;
  terceros: TerceroReclamo[];
  /** Desglose del pago: cada parte con su estado de verificación en la tienda. */
  pagos?: Array<{ id: string; metodo: string; monto: number; referencia: string | null; estado: 'PREVISTO' | 'VERIFICADO' | 'RECHAZADO'; nota: string | null; reportado_en?: string | null; comprobante_doc_id?: string | null }>;
}

const NOMBRE_METODO: Record<string, string> = {
  NOMINA: 'Bono mercado', EFECTIVO: 'Efectivo', BONO: 'Vale o bono de regalo', NEQUI: 'Nequi', DAVIPLATA: 'Daviplata',
  LLAVE: 'Llave (Bre-B)', TRANSFERENCIA: 'Transferencia', PSE: 'PSE', QR: 'Código QR', TARJETA: 'Tarjeta', OTRO: 'Otro', MIXTO: 'Pago dividido',
};


/**
 * Seguimiento de un pedido: en qué va, cuándo lo recoge, cuánto cupo tiene apartado, si la
 * temporal ya se lo descontó y quién más puede recogerlo.
 */
@Component({
  selector: 'eco-pedido',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, RouterLink, DatePipe, FormsModule, EcoAutorizarTercero, EcoFirmarPrestamo],
  templateUrl: './pedido.html',
  styleUrls: ['../../economiapp.css', './pedido.css'],
})
export class EconomiaPedido {
  readonly store = inject(EconomiaStore);
  private api = inject(TiendaService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  private readonly id = toSignal(this.route.paramMap.pipe(map(p => p.get('id'))), { initialValue: this.route.snapshot.paramMap.get('id') });
  readonly nuevo = this.route.snapshot.queryParamMap.get('nuevo') === '1';

  readonly d = signal<Detalle | null>(null);
  /** Cuentas de la tienda (Nequi, PSE, banco…) para pagarle lo que no es bono mercado ni efectivo. */
  readonly medios = signal<MedioPago[]>([]);
  /** Imagen del QR de cada medio (se baja con la sesión de la persona). */
  readonly qrs = signal<Record<string, string>>({});
  private visorQr = inject(DocViewerService);
  async cargarQrs(ms: MedioPago[]): Promise<void> {
    for (const m of ms) if (m.qr_doc_id && !this.qrs()[m.id]) {
      const u = await this.visorQr.toBlobUrl(`${environment.apiUrl}/api/v1/documents/${m.qr_doc_id}/download`);
      if (u) this.qrs.update(q => ({ ...q, [m.id]: u }));
    }
  }
  /** El pedido no avanza hasta que la persona pague lo que va por transferencia, Nequi, PSE o QR. */
  esperandoPago(det: Detalle): boolean {
    return det.pedido.estado === 'CREADO' && this.porPagar(det).length > 0;
  }
  readonly refPago = signal<Record<string, string>>({});
  readonly archivoPago = signal<Record<string, File | null>>({});
  readonly reportando = signal<string | null>(null);
  /** Partes que la persona tiene que pagarle a la tienda por su cuenta antes de que despache. */
  porPagar(det: Detalle) {
    // La tarjeta sin link de pago es datáfono al recibir: no se paga antes.
    const tarjetaEnLinea = this.mediosPara('TARJETA').some(m => !!m.enlace_pago);
    return (det.pagos ?? []).filter(p => !['NOMINA', 'EFECTIVO'].includes(p.metodo) && p.estado !== 'VERIFICADO'
      && (p.metodo !== 'TARJETA' || tarjetaEnLinea));
  }
  ponerRef(id: string, v: string): void { this.refPago.update(r => ({ ...r, [id]: v })); }
  mediosPara(metodo: string): MedioPago[] { return this.medios().filter(m => m.metodo === metodo); }
  copiar(t: string | null): void {
    if (!t) return;
    navigator.clipboard?.writeText(t).then(() => this.store.avisar('Copiado'), () => null);
  }
  elegirComprobante(id: string, ev: Event): void {
    const f = (ev.target as HTMLInputElement).files?.[0] ?? null;
    if (f && f.size > 8 * 1024 * 1024) { this.store.avisar('El comprobante pesa más de 8 MB', 'error'); return; }
    this.archivoPago.update(a => ({ ...a, [id]: f }));
  }
  async yaPague(pg: { id: string; metodo: string }): Promise<void> {
    const det = this.d(); if (!det) return;
    const ref = (this.refPago()[pg.id] ?? '').trim(); const f = this.archivoPago()[pg.id];
    if (!ref && !f) { this.store.avisar('Ponga el número de la transacción o la foto del comprobante', 'error'); return; }
    this.reportando.set(pg.id);
    try {
      const doc = f ? await firstValueFrom(this.api.subirArchivo(f, f.name, pg.id, 'STORE_PAGO_COMPROBANTE')) : null;
      await firstValueFrom(this.api.reportarPago(det.pedido.id, pg.id, ref || null, doc));
      this.store.avisar('Listo. La tienda verifica su pago y le avisamos.');
      this.cargar();
    } catch (e) { this.store.avisar(mensajeError(e, 'No se pudo reportar el pago'), 'error'); }
    finally { this.reportando.set(null); }
  }
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly trabajando = signal(false);

  // Cita
  readonly editandoCita = signal(false);
  readonly fecha = signal('');
  readonly hora = signal('');

  // Cancelar
  readonly confirmandoCancelar = signal(false);
  readonly motivo = signal('');

  // Tercero
  /** Si al pedir dijo que recibe otra persona, se abre de una el formulario para autorizarla. */
  readonly formTercero = signal(this.route.snapshot.queryParamMap.get('autorizar') === '1');

  // Pedido de oficina y códigos
  readonly grupoPedidos = signal<Pedido[]>([]);
  readonly qr = signal<Record<string, string>>({});

  readonly estado = computed(() => this.d()?.pedido.estado ?? '');
  readonly cerrado = computed(() => ['ENTREGADO', 'CANCELADO', 'RECHAZADO'].includes(this.estado()));
  readonly cancelable = computed(() => ['CREADO', 'CONFIRMADO'].includes(this.estado()));
  readonly pasos = computed(() => {
    const e = this.estado();
    const lista = this.d()?.pedido.tipo_entrega === 'DOMICILIO'
      ? ['CREADO', 'CONFIRMADO', 'ALISTANDO', 'EN_RUTA', 'ENTREGADO'] : PASOS_PEDIDO;
    const actual = lista.indexOf(e === 'LISTO' && lista.includes('EN_RUTA') ? 'ALISTANDO' : e);
    return lista.map((p, i) => ({ estado: p, hecho: actual >= i, actual: actual === i }));
  });

  readonly ESTADO = ESTADO_PEDIDO;
  readonly CUPO = ESTADO_CUPO;
  readonly ENTREGA = TIPO_ENTREGA;
  readonly pesos = pesos;
  readonly NOMBRE_METODO = NOMBRE_METODO;

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => { if (id) this.cargar(id); });
    });
  }

  cargar(id = this.id()): void {
    if (!id) return;
    this.cargando.set(!this.d());
    this.api.miPedidoDetallado(id).subscribe({
      next: r => {
        const det = r as unknown as Detalle;
        this.d.set(det);
        this.cargando.set(false);
        this.error.set(null);
        this.pintarCodigos(det.activaciones ?? []);
        if (det.pedido?.tienda_id && !this.medios().length) {
          this.api.mediosPago([det.pedido.tienda_id]).subscribe({ next: m => { const ms = m[det.pedido.tienda_id]?.medios ?? []; this.medios.set(ms); this.cargarQrs(ms); }, error: () => null });
        }
        if (det.grupo) this.api.grupo(det.grupo.id).subscribe({ next: g => this.grupoPedidos.set(g?.pedidos ?? []), error: () => null });
        else this.grupoPedidos.set([]);
      },
      error: e => { this.error.set(mensajeError(e, 'No encontramos este pedido')); this.cargando.set(false); },
    });
  }

  abrirCita(): void {
    const p = this.d()?.pedido;
    if (p?.programado_en) {
      const f = new Date(p.programado_en);
      this.fecha.set(f.toLocaleDateString('en-CA'));
      this.hora.set(f.toTimeString().slice(0, 5));
    }
    this.editandoCita.set(true);
  }

  async guardarCita(): Promise<void> {
    const p = this.d()?.pedido;
    if (!p || !this.fecha()) return;
    const cita = new Date(`${this.fecha()}T${this.hora() || '09:00'}:00`);
    if (isNaN(cita.getTime())) return;
    this.trabajando.set(true);
    try {
      await firstValueFrom(this.api.programarPedido(p.id, cita.toISOString()));
      this.editandoCita.set(false);
      this.store.avisar('Hora guardada');
      this.cargar();
    } catch (e) {
      this.store.avisar(mensajeError(e, 'No se pudo guardar la hora'), 'error');
    } finally {
      this.trabajando.set(false);
    }
  }

  async cancelar(): Promise<void> {
    const p = this.d()?.pedido;
    if (!p) return;
    this.trabajando.set(true);
    try {
      await firstValueFrom(this.api.cancelarMiPedido(p.id, this.motivo().trim() || 'Cancelado por el comprador'));
      this.confirmandoCancelar.set(false);
      this.store.avisar('Pedido cancelado. Si había bono mercado apartado, vuelve a estar disponible.');
      this.store.refrescarCupo();
      this.cargar();
    } catch (e) {
      this.store.avisar(mensajeError(e, 'No se pudo cancelar'), 'error');
    } finally {
      this.trabajando.set(false);
    }
  }

  /** QR con el código: en el mostrador se escanea o se teclea. */
  private async pintarCodigos(acts: Activacion[]): Promise<void> {
    // qrcode es CommonJS: según el empaquetado, la función queda en el módulo o en `default`.
    const mod = await import('qrcode') as unknown as { toDataURL?: QrFn; default?: { toDataURL: QrFn } };
    const toDataURL = mod.toDataURL ?? mod.default?.toDataURL;
    if (!toDataURL) return;
    const salida: Record<string, string> = {};
    for (const a of acts.filter(x => x.estado === 'ACTIVA')) {
      salida[a.id] = await toDataURL(a.codigo, { margin: 1, width: 220 });
    }
    this.qr.set(salida);
  }

  autorizado(): void {
    this.formTercero.set(false);
    this.store.avisar('Persona autorizada para reclamar');
    this.cargar();
  }

  async quitarTercero(t: TerceroReclamo): Promise<void> {
    const p = this.d()?.pedido;
    if (!p) return;
    this.trabajando.set(true);
    try {
      await firstValueFrom(this.api.quitarTercero(p.id, t.id));
      this.cargar();
    } catch (e) {
      this.store.avisar(mensajeError(e, 'No se pudo quitar'), 'error');
    } finally {
      this.trabajando.set(false);
    }
  }

  repetir(): void {
    // Volver a pedir lo mismo: se agregan las líneas al carrito actual.
    const lineas = this.d()?.lineas ?? [];
    const t = this.store.tiendaId();
    if (!t || !lineas.length) return;
    this.trabajando.set(true);
    Promise.all(lineas.filter(l => l.producto_id).map(l => firstValueFrom(this.api.agregarAlCarrito({
      tienda_id: t, producto_id: l.producto_id!, cantidad: Number(l.cantidad) || 1,
    })).catch(() => null))).then(async () => {
      await this.store.refrescarCarrito();
      this.trabajando.set(false);
      this.router.navigate(['/economiapp/carrito']);
    });
  }
}
