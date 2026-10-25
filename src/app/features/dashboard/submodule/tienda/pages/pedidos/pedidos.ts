import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { DocViewerService } from '@/app/shared/services/doc-viewer/doc-viewer.service';
import { environment } from '../../../../../../../environments/environment';

import { SelectorTienda } from '../../components/selector-tienda/selector-tienda';
import { ContextoTiendaService } from '../../service/contexto-tienda.service';
import { PagoPedido, Pedido, RegistroPedidos, TiendaService } from '../../service/tienda.service';

export const METODO_NOMBRE: Record<string, string> = {
  NOMINA: 'Bono mercado', EFECTIVO: 'Efectivo', BONO: 'Vale / bono regalo', NEQUI: 'Nequi', DAVIPLATA: 'Daviplata',
  LLAVE: 'Llave', TRANSFERENCIA: 'Transferencia', TARJETA: 'Tarjeta', OTRO: 'Otro', MIXTO: 'Dividido',
};

/**
 * Bandeja de pedidos de la tienda virtual.
 *
 * <p>El orden es por antigüedad ascendente: lo primero que se ve es lo que lleva más
 * esperando. Un listado por fecha descendente esconde justo lo que hay que atender.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-tienda-pedidos',
  imports: [CommonModule, FormsModule, MatIconModule, SelectorTienda, RouterLink],
  templateUrl: './pedidos.html',
  styleUrls: ['../../styles/tienda-comun.css', './pedidos.css'],
})
export class Pedidos implements OnInit {
  private api = inject(TiendaService);
  readonly ctx = inject(ContextoTiendaService);

  readonly pedidos = signal<Pedido[]>([]);
  readonly detalle = signal<Record<string, unknown> | null>(null);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  motivoRechazo = '';

  readonly pestana = signal<'bandeja' | 'registro'>('bandeja');
  readonly METODO = METODO_NOMBRE;
  readonly metodosTienda = ['EFECTIVO', 'BONO', 'NEQUI', 'DAVIPLATA', 'LLAVE', 'TRANSFERENCIA', 'TARJETA', 'OTRO'];

  // ── Verificación de pagos del pedido abierto ──
  readonly pagos = computed(() => ((this.detalle()?.['pagos'] as PagoPedido[] | undefined) ?? []));
  readonly totalAbierto = computed(() => Number((this.detalle()?.['pedido'] as Pedido | undefined)?.total ?? 0));
  readonly verificado = computed(() => this.pagos().filter(p => p.estado === 'VERIFICADO').reduce((s, p) => s + Number(p.monto), 0));
  readonly pendientePago = computed(() => this.pagos().filter(p => p.estado === 'PREVISTO').reduce((s, p) => s + Number(p.monto), 0));
  readonly soloEfectivoPendiente = computed(() => this.pagos().filter(p => p.estado === 'PREVISTO').every(p => p.metodo === 'EFECTIVO' || p.metodo === 'TARJETA'));
  refPago: Record<string, string> = {};
  notaPago: Record<string, string> = {};
  nuevoPago = { metodo: 'EFECTIVO', monto: 0, referencia: '', verificado: true };

  // ── Registro ──
  readonly registro = signal<RegistroPedidos | null>(null);
  readonly cargandoRegistro = signal(false);
  filtro = { desde: '', hasta: '', estado: '', metodo: '', q: '' };
  readonly paginaRegistro = signal(0);
  readonly TAM = 50;

  /** Estados a los que se puede avanzar desde cada estado actual. */
  readonly siguientes: Record<string, Array<{ codigo: string; nombre: string }>> = {
    CONFIRMADO: [{ codigo: 'ALISTANDO', nombre: 'Empezar a alistar' }],
    ALISTANDO: [{ codigo: 'LISTO', nombre: 'Marcar como listo' }],
    LISTO: [
      { codigo: 'EN_RUTA', nombre: 'Salió a domicilio' },
      { codigo: 'ENTREGADO', nombre: 'Entregado' },
    ],
    EN_RUTA: [{ codigo: 'ENTREGADO', nombre: 'Entregado' }],
  };

  private visor = inject(DocViewerService);
  /** Comprobante que subió la persona al reportar el pago. */
  verComprobante(docId: string): void {
    this.visor.openInNewTab(`${environment.apiUrl}/api/v1/documents/${docId}/download`);
  }

  constructor() {
    effect(() => { this.ctx.tiendaId(); this.cargar(); });
  }

  ngOnInit(): void {
    this.ctx.cargar();
  }

  cargar(): void {
    const tienda = this.ctx.tiendaId();
    if (!tienda) return;
    this.cargando.set(true);
    this.api.pedidosPendientes(tienda).subscribe({
      next: p => { this.pedidos.set(p); this.cargando.set(false); },
      error: () => { this.error.set('No se pudieron cargar los pedidos'); this.cargando.set(false); },
    });
  }

  ver(p: Pedido): void {
    if ((this.detalle()?.['pedido'] as Pedido | undefined)?.id === p.id) { this.detalle.set(null); return; }
    this.recargarDetalle(p.id);
  }

  private recargarDetalle(id: string): void {
    this.api.detallePedido(id).subscribe({
      next: d => { this.detalle.set(d); this.refPago = {}; this.notaPago = {}; }, error: e => this.fallo(e),
    });
  }

  verificarPago(p: Pedido, pago: PagoPedido, estado: 'VERIFICADO' | 'RECHAZADO' | 'PREVISTO'): void {
    const nota = this.notaPago[pago.id]?.trim();
    if (estado === 'RECHAZADO' && !nota) { this.error.set('Para rechazar un pago escriba el motivo: el comprador lo va a leer.'); return; }
    this.api.verificarPagoPedido(p.id, pago.id, { estado, referencia: this.refPago[pago.id]?.trim() || undefined, nota: nota || undefined }).subscribe({
      next: () => {
        this.aviso.set(`${this.METODO[pago.metodo] ?? pago.metodo} de ${this.formatoPesos(pago.monto)}: ${estado === 'VERIFICADO' ? 'verificado' : estado === 'RECHAZADO' ? 'rechazado' : 'vuelve a pendiente'}.`);
        this.error.set(null);
        this.recargarDetalle(p.id);
      },
      error: e => this.fallo(e),
    });
  }

  agregarPago(p: Pedido): void {
    if (!(this.nuevoPago.monto > 0)) { this.error.set('Escriba el monto del pago'); return; }
    this.api.agregarPagoPedido(p.id, { ...this.nuevoPago, referencia: this.nuevoPago.referencia.trim() || undefined }).subscribe({
      next: () => {
        this.aviso.set(`Pago registrado en el pedido ${p.numero}.`);
        this.nuevoPago = { metodo: 'EFECTIVO', monto: 0, referencia: '', verificado: true };
        this.recargarDetalle(p.id);
      },
      error: e => this.fallo(e),
    });
  }

  /** Lo que falta para cubrir el pedido, para precargar "registrar pago". */
  faltante(): number {
    return Math.max(0, Math.round(this.totalAbierto() - this.verificado() - this.pendientePago()));
  }

  // ── Registro ──

  cargarRegistro(pagina = 0): void {
    this.cargandoRegistro.set(true);
    this.paginaRegistro.set(pagina);
    this.api.registroPedidos({ tienda: this.ctx.tiendaId() ?? undefined, ...this.filtro, pagina, tamano: this.TAM }).subscribe({
      next: r => { this.registro.set(r); this.cargandoRegistro.set(false); },
      error: e => { this.fallo(e); this.cargandoRegistro.set(false); },
    });
  }

  verRegistro(): void {
    this.pestana.set('registro');
    if (!this.registro()) this.cargarRegistro(0);
  }

  /** Excel con el filtro actual (hasta 5.000 pedidos), una fila por pedido y columnas por método. */
  async exportar(): Promise<void> {
    const XLSX = await import('xlsx');
    this.api.registroPedidos({ tienda: this.ctx.tiendaId() ?? undefined, ...this.filtro, pagina: 0, tamano: 500 }).subscribe(async r => {
      const metodos = [...new Set(r.pedidos.flatMap(x => x.pagos.map(pg => pg.metodo)))];
      const filas = r.pedidos.map(x => {
        const fila: Record<string, unknown> = {
          Numero: x.numero, Grupo: x.grupo ?? '', Fecha: x.creado_en, Tienda: x.tienda, Estado: x.estado, Entrega: x.tipo_entrega,
          Cedula: x.cliente_cedula, Cliente: x.cliente_nombre ?? '', Telefono: x.cliente_telefono ?? '', Total: Number(x.total),
          Pago: this.METODO[x.metodo_pago_previsto ?? ''] ?? x.metodo_pago_previsto ?? '',
          'Pagos sin verificar': x.pagos.filter(pg => pg.estado === 'PREVISTO').reduce((s, pg) => s + Number(pg.monto), 0),
          Entregado: x.entregado_en ?? '',
        };
        for (const m of metodos) fila[this.METODO[m] ?? m] = x.pagos.filter(pg => pg.metodo === m && pg.estado !== 'RECHAZADO').reduce((s, pg) => s + Number(pg.monto), 0);
        fila['Referencias'] = x.pagos.filter(pg => pg.referencia).map(pg => `${pg.metodo}: ${pg.referencia}`).join(' | ');
        return fila;
      });
      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filas), 'Pedidos');
      XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(r.por_metodo.map(m => ({
        Metodo: this.METODO[m.metodo] ?? m.metodo, Estado: m.estado, Partes: m.partes, Monto: Number(m.monto) }))), 'Por metodo');
      XLSX.writeFile(libro, `registro_pedidos_${new Date().toISOString().slice(0, 10)}.xlsx`);
    });
  }

  totalMetodo(metodo: string, estado?: string): number {
    return (this.registro()?.por_metodo ?? []).filter(m => m.metodo === metodo && (!estado || m.estado === estado))
      .reduce((s, m) => s + Number(m.monto), 0);
  }

  metodosDelRegistro(): string[] {
    return [...new Set((this.registro()?.por_metodo ?? []).map(m => m.metodo))];
  }

  private formatoPesos(v: number): string {
    return '$' + Math.round(Number(v)).toLocaleString('es-CO');
  }

  confirmar(p: Pedido): void {
    this.api.confirmarPedido(p.id).subscribe({
      next: () => {
        this.recargarDetalle(p.id);
        this.aviso.set(`Pedido ${p.numero} confirmado. El stock quedó apartado`
          + (p.bajo_pedido ? ' y se generó el traslado de lo que hay que traer.' : '.'));
        this.cargar();
      },
      error: e => this.fallo(e),
    });
  }

  avanzar(p: Pedido, estado: string): void {
    // Al entregar se cobra lo que va en efectivo o tarjeta: se pregunta para dejarlo verificado.
    let efectivo = false;
    if (estado === 'ENTREGADO' && this.pagos().some(x => x.estado === 'PREVISTO' && (x.metodo === 'EFECTIVO' || x.metodo === 'TARJETA'))) {
      efectivo = confirm('¿Recibió el pago en efectivo/tarjeta de este pedido?');
      if (!efectivo) { this.error.set('Para entregar, el pago tiene que estar completo.'); return; }
    }
    this.api.cambiarEstadoPedido(p.id, estado, undefined, efectivo).subscribe({
      next: () => {
        this.aviso.set(`Pedido ${p.numero}: ${estado.toLowerCase()}. El comprador lo ve al instante.`);
        this.cargar();
        this.detalle.set(null);
      },
      error: e => this.fallo(e),
    });
  }

  rechazar(p: Pedido): void {
    if (!this.motivoRechazo.trim()) {
      this.error.set('Rechazar un pedido exige decir por qué: el comprador lo va a leer');
      return;
    }
    this.api.rechazarPedido(p.id, this.motivoRechazo).subscribe({
      next: () => {
        this.aviso.set(`Pedido ${p.numero} rechazado. Lo apartado se liberó.`);
        this.motivoRechazo = '';
        this.cargar();
        this.detalle.set(null);
      },
      error: e => this.fallo(e),
    });
  }

  claseEstado(estado: string): string {
    if (estado === 'ENTREGADO') return 'exito';
    if (estado === 'CANCELADO' || estado === 'RECHAZADO') return 'peligro';
    if (estado === 'CREADO') return 'aviso';
    return 'info';
  }

  private fallo(e: unknown): void {
    const cuerpo = (e as { error?: { error?: string } })?.error;
    this.error.set(cuerpo?.error ?? 'No se pudo completar la operación');
    this.aviso.set(null);
  }
}
