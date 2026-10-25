import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { ActivatedRoute } from '@angular/router';
import { EstadisticasCaja } from '../../components/estadisticas-caja/estadisticas-caja';
import { FotosEvidencia } from '../../components/fotos-evidencia/fotos-evidencia';
import { SelectorTienda } from '../../components/selector-tienda/selector-tienda';
import { ContextoTiendaService } from '../../service/contexto-tienda.service';
import { DevolucionFila, Pago, PagoBandeja, TiendaService, Venta, VentaConSaldo } from '../../service/tienda.service';
import { DocViewerService } from '@/app/shared/services/doc-viewer/doc-viewer.service';
import { environment } from '../../../../../../../environments/environment';
import { EscanerCodigoComponent } from '@/app/shared/components/escaner-codigo/escaner-codigo.component';

const METODO: Record<string, string> = { EFECTIVO: 'Efectivo', NOMINA: 'Bono mercado', NEQUI: 'Nequi', DAVIPLATA: 'Daviplata', LLAVE: 'Llave', TRANSFERENCIA: 'Transferencia', PSE: 'PSE', QR: 'QR', TARJETA: 'Tarjeta', BONO: 'Vale', OTRO: 'Otro' };
const ESTADO: Record<string, string> = { BORRADOR: 'Abierta', CONFIRMADA: 'Confirmada', ANULADA: 'Anulada', DEVUELTA_PARCIAL: 'Devuelta en parte', DEVUELTA: 'Devuelta',
  PENDIENTE: 'Por verificar', VERIFICADO: 'Verificado', RECHAZADO: 'Rechazado', REGISTRADA: 'Registrada', APLICADA: 'Aplicada', FALLIDA: 'Falló' };
const DESTINOS = [
  { v: 'STOCK', n: 'Vuelve al inventario' },
  { v: 'MERMA', n: 'Merma (dañado)' },
  { v: 'GARANTIA', n: 'Garantía con el proveedor' },
];

interface LineaVenta { id: string; descripcion: string; cantidad: number; precio_unitario: number; total: number }

/**
 * Las ventas del mostrador después de cobrar: consultar una venta, devolver con su
 * reembolso (efectivo sale del cajón, bono mercado vuelve al cupo) y conciliar los pagos
 * por transferencia, Nequi o QR contra el extracto.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-ventas',
  imports: [CommonModule, FormsModule, MatIconModule, SelectorTienda, FotosEvidencia, EstadisticasCaja, EscanerCodigoComponent],
  templateUrl: './ventas.html',
  styleUrls: ['../../styles/tienda-comun.css', '../caja/caja.css', './ventas.css'],
})
export class Ventas {
  private api = inject(TiendaService);
  private visor = inject(DocViewerService);
  readonly ctx = inject(ContextoTiendaService);
  readonly METODO = METODO;
  readonly ESTADO = ESTADO;
  readonly DESTINOS = DESTINOS;
  readonly METODOS_REEMBOLSO = ['EFECTIVO', 'NOMINA', 'NEQUI', 'DAVIPLATA', 'TRANSFERENCIA', 'LLAVE', 'TARJETA'];

  readonly METODOS_SALDO = ['EFECTIVO', 'NEQUI', 'DAVIPLATA', 'TRANSFERENCIA', 'LLAVE', 'QR', 'TARJETA'];

  readonly vista = signal<'ventas' | 'caja' | 'pagos' | 'saldos' | 'devoluciones'>(
    inject(ActivatedRoute).snapshot.queryParamMap.get('vista') === 'caja' ? 'caja' : 'ventas');
  readonly saldos = signal<VentaConSaldo[]>([]);
  readonly ventas = signal<Venta[]>([]);
  readonly pagina = signal(0);
  readonly totalVentas = signal(0);
  readonly filtro = signal('');
  readonly bandeja = signal<PagoBandeja[]>([]);
  readonly devoluciones = signal<DevolucionFila[]>([]);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);
  readonly ocupado = signal(false);

  // Detalle
  readonly sel = signal<Venta | null>(null);
  readonly lineas = signal<LineaVenta[]>([]);
  readonly pagos = signal<Pago[]>([]);
  readonly devVenta = signal<DevolucionFila[]>([]);
  readonly pendiente = signal(0);
  // Cobro de saldo
  readonly metodoSaldo = signal('EFECTIVO');
  readonly montoSaldo = signal<number | null>(null);
  readonly refSaldo = signal('');
  // Devolución en curso
  readonly devolviendo = signal(false);
  readonly cant = signal<Record<string, number>>({});
  readonly destino = signal<Record<string, string>>({});
  readonly motivo = signal('');
  readonly reembolso = signal('EFECTIVO');
  readonly ultimaDev = signal<string | null>(null);
  // Rechazo
  readonly rechazando = signal<string | null>(null);
  readonly motivoRechazo = signal('');

  readonly filtradas = computed(() => {
    const f = this.filtro().trim().toLowerCase();
    return !f ? this.ventas() : this.ventas().filter(v => [v.numero, v.cliente_nombre, v.cliente_cedula].some(x => (x ?? '').toLowerCase().includes(f)));
  });
  readonly paginas = computed(() => Math.max(1, Math.ceil(this.totalVentas() / 50)));
  readonly porVerificarTotal = computed(() => this.bandeja().reduce((s, p) => s + +p.monto, 0));
  readonly totalDevolver = computed(() => this.lineas().reduce((s, l) => s + (this.cant()[l.id] || 0) * (+l.total / (+l.cantidad || 1)), 0));
  readonly puedeDevolver = computed(() => ['CONFIRMADA', 'DEVUELTA_PARCIAL'].includes(this.sel()?.estado ?? ''));

  constructor() {
    this.ctx.cargar();
    effect(() => { const t = this.ctx.tiendaId(); untracked(() => { this.cerrarDetalle(); this.pagina.set(0); this.cargar(t); }); });
  }

  async cargar(t: string | null): Promise<void> {
    if (!t) return;
    this.error.set(null);
    try {
      const [vs, b, d, cs] = await Promise.all([
        firstValueFrom(this.api.ventas(t, this.pagina(), 50)),
        firstValueFrom(this.api.bandejaPagos(t)),
        firstValueFrom(this.api.devolucionesTienda(t)),
        firstValueFrom(this.api.ventasConSaldo(t)),
      ]);
      this.ventas.set(vs.content); this.totalVentas.set(vs.total_elements);
      this.bandeja.set(b); this.devoluciones.set(d.devoluciones); this.saldos.set(cs);
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudieron cargar las ventas'); }
  }

  irPagina(d: number): void { this.pagina.update(p => Math.max(0, p + d)); this.cargar(this.ctx.tiendaId()); }

  async abrir(v: Venta | string): Promise<void> {
    const id = typeof v === 'string' ? v : v.id;
    this.devolviendo.set(false); this.ultimaDev.set(null); this.error.set(null);
    try {
      const [det, dev] = await Promise.all([firstValueFrom(this.api.detalleVenta(id)), firstValueFrom(this.api.devolucionesVenta(id))]);
      this.sel.set(det.venta);
      this.lineas.set(det.lineas as unknown as LineaVenta[]);
      this.pagos.set(det.pagos);
      this.devVenta.set(dev.devoluciones);
      this.pendiente.set(Math.max(0, Math.round(+det.pendiente || 0)));
      this.montoSaldo.set(this.pendiente() || null); this.refSaldo.set(''); this.metodoSaldo.set('EFECTIVO');
      this.vista.set('ventas');
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo abrir la venta'); }
  }

  cerrarDetalle(): void { this.sel.set(null); this.devolviendo.set(false); }

  empezarDevolucion(): void {
    this.cant.set({});
    this.destino.set(Object.fromEntries(this.lineas().map(l => [l.id, 'STOCK'])));
    this.motivo.set('');
    this.reembolso.set(this.pagos().some(p => p.metodo === 'NOMINA') ? 'NOMINA' : 'EFECTIVO');
    this.devolviendo.set(true);
  }

  ponerCant(id: string, n: number, max: number): void { this.cant.update(c => ({ ...c, [id]: Math.min(max, Math.max(0, +n || 0)) })); }
  ponerDestino(id: string, d: string): void { this.destino.update(c => ({ ...c, [id]: d })); }

  async devolver(): Promise<void> {
    const v = this.sel(); if (!v) return;
    const lineas = this.lineas().filter(l => (this.cant()[l.id] || 0) > 0)
      .map(l => ({ venta_item_id: l.id, cantidad: this.cant()[l.id], destino: this.destino()[l.id] || 'STOCK' }));
    if (!lineas.length) { this.error.set('Indique cuántas unidades devuelve.'); return; }
    if (!this.motivo().trim()) { this.error.set('Escriba el motivo de la devolución.'); return; }
    const como = this.reembolso() === 'NOMINA' ? 'vuelve al bono mercado' : this.reembolso() === 'EFECTIVO' ? 'sale del cajón en efectivo' : 'se devuelve por ' + (METODO[this.reembolso()] ?? this.reembolso());
    if (!confirm(`¿Devolver ${this.pesos(this.totalDevolver())}? El dinero ${como}.`)) return;
    this.ocupado.set(true); this.error.set(null);
    try {
      const d = await firstValueFrom(this.api.registrarDevolucion({ venta_id: v.id, motivo: this.motivo().trim(), reembolso_metodo: this.reembolso(), lineas }));
      this.aviso.set(`Devolución ${d.numero} registrada por ${this.pesos(d.total)}. Puede adjuntar fotos del producto devuelto.`);
      await this.abrir(v.id);
      this.ultimaDev.set(d.id);
      this.cargar(this.ctx.tiendaId());
    } catch (e: any) { this.error.set(e?.error?.error ?? e?.error?.message ?? 'No se pudo registrar la devolución'); }
    finally { this.ocupado.set(false); }
  }

  async verificar(p: PagoBandeja, resultado: 'VERIFICADO' | 'RECHAZADO'): Promise<void> {
    if (resultado === 'RECHAZADO' && !this.motivoRechazo().trim()) { this.error.set('Para rechazar escriba el motivo.'); return; }
    this.ocupado.set(true); this.error.set(null);
    try {
      await firstValueFrom(this.api.verificarPago(p.id, resultado, resultado === 'RECHAZADO' ? this.motivoRechazo().trim() : undefined));
      this.aviso.set(`${METODO[p.metodo] ?? p.metodo} de ${this.pesos(p.monto)} (${p.venta_numero}) ${resultado === 'VERIFICADO' ? 'verificado' : 'rechazado'}.`);
      this.bandeja.update(b => b.filter(x => x.id !== p.id));
      this.rechazando.set(null); this.motivoRechazo.set('');
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo verificar el pago'); }
    finally { this.ocupado.set(false); }
  }

  async cobrarSaldo(): Promise<void> {
    const v = this.sel(); const monto = +(this.montoSaldo() ?? 0); if (!v || monto <= 0) return;
    const m = this.metodoSaldo();
    if (m !== 'EFECTIVO' && !this.refSaldo().trim()) { this.error.set('Escriba la referencia de la transacción.'); return; }
    if (!confirm(`¿Cobrar ${this.pesos(monto)} por ${METODO[m] ?? m} de la venta ${v.numero}?`)) return;
    this.ocupado.set(true); this.error.set(null);
    try {
      await firstValueFrom(this.api.cobrarSaldo(v.id, { metodo: m, monto, referencia: this.refSaldo().trim() || null }));
      this.aviso.set(m === 'EFECTIVO' ? `Cobrados ${this.pesos(monto)} en efectivo: entran al cuadre del turno abierto.`
        : `${METODO[m] ?? m} de ${this.pesos(monto)} registrado; queda en «Por verificar» hasta confirmar que llegó.`);
      await this.abrir(v.id);
      this.cargar(this.ctx.tiendaId());
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo cobrar el saldo'); }
    finally { this.ocupado.set(false); }
  }

  verSoporte(docId: string): void { this.visor.openInNewTab(`${environment.apiUrl}/api/v1/documents/${docId}/download`); }

  pesos(v: number | null | undefined): string { return v == null ? '—' : (v < 0 ? '−$' : '$') + Math.abs(Math.round(+v)).toLocaleString('es-CO'); }
}
