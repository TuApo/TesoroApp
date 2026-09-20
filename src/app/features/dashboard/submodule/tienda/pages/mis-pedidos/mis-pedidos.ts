import { ChangeDetectionStrategy, Component, LOCALE_ID, OnInit, inject, signal } from '@angular/core';
import { CommonModule, formatCurrency, formatDate, getCurrencySymbol } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

import { ColumnaTabla, TABLA_ESTANDAR, TonoBadge } from '../../../../../../shared/components/tabla-estandar';
import {
  MovimientoHistorial, Pedido, PedidoDetallado, TiendaService,
} from '../../service/tienda.service';

/**
 * "Mis pedidos": la vista del COMPRADOR, no la del operador.
 *
 * <p>No lleva selector de tienda ni valida alcance: aquí no hay operador, hay una persona
 * mirando lo que ella misma pidió. La cédula sale del token en el servidor, así que no hay
 * forma de pedir los pedidos de otro cambiando algo en la URL.
 *
 * <p>Cada pedido trae ya el cupo apartado, el tercero autorizado y el estado del descuento
 * por parte de la temporal, porque son exactamente las tres preguntas que la persona hace:
 * cuánto me apartaron, quién lo puede recoger y si ya me lo cobraron.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-mis-pedidos',
  imports: [CommonModule, FormsModule, MatIconModule, RouterLink, ...TABLA_ESTANDAR],
  templateUrl: './mis-pedidos.html',
  styleUrls: ['../../styles/tienda-comun.css', './mis-pedidos.css'],
})
export class MisPedidos implements OnInit {
  private api = inject(TiendaService);
  private readonly locale = inject(LOCALE_ID);

  readonly pedidos = signal<PedidoDetallado[]>([]);
  readonly historial = signal<MovimientoHistorial[]>([]);
  readonly seguimiento = signal<Record<string, Array<Record<string, unknown>>>>({});
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);
  readonly verHistorial = signal(false);

  /** Formulario de cita, abierto sobre un pedido concreto. */
  readonly citaDe = signal<string | null>(null);
  readonly fechaCita = signal('');
  readonly horaCita = signal('');

  /** Formulario del tercero, abierto sobre un pedido concreto. */
  readonly terceroDe = signal<string | null>(null);
  readonly tNombre = signal('');
  readonly tCedula = signal('');
  readonly tTelefono = signal('');
  readonly tParentesco = signal('');
  readonly tRostro = signal('');
  readonly tFrente = signal('');
  readonly tReverso = signal('');

  /** Historial de mercados en la tabla estándar: fecha como Date y valor como número. */
  readonly columnasHistorial: ColumnaTabla<MovimientoHistorial>[] = [
    { id: 'fecha', header: 'Fecha', tarjeta: 'subtitulo',
      valor: (m) => (m.fecha ? new Date(m.fecha) : null),
      formato: (m) => (m.fecha ? formatDate(m.fecha, 'short', this.locale) : ''),
      copiaTexto: (m) => (m.fecha ? formatDate(m.fecha, 'short', this.locale) : '') },
    { id: 'documento', header: 'Documento', valor: (m) => m.numero, tarjeta: 'titulo' },
    { id: 'donde', header: 'Dónde', prioridad: 2, tarjeta: 'meta',
      valor: (m) => (m.origen === 'VENTA' ? 'Mostrador' : 'Tienda virtual') },
    { id: 'valor', header: 'Valor', align: 'right', tarjeta: 'meta',
      valor: (m) => m.total, formato: (m) => this.pesos(m.total), copiaTexto: (m) => String(m.total ?? '') },
    { id: 'descuento', header: 'Descuento', tarjeta: 'badge',
      valor: (m) => (m.ejecutado ? 'Descontado' : m.cupo_estado === 'BLOQUEADO' ? 'Apartado' : ''),
      formato: () => '—',
      badge: (m) => m.ejecutado ? { texto: 'Descontado', tono: 'ok' }
        : m.cupo_estado === 'BLOQUEADO' ? { texto: 'Apartado', tono: 'info' } : null },
    { id: 'temporal', header: 'Temporal', tarjeta: 'badge',
      valor: (m) => this.textoPagoTemporal(m.estado_pago_temporal),
      formato: () => '—',
      badge: (m) => m.estado_pago_temporal
        ? { texto: this.textoPagoTemporal(m.estado_pago_temporal), tono: this.tonoPagoTemporal(m.estado_pago_temporal) }
        : null },
  ];
  readonly idMovimiento = (m: MovimientoHistorial) => m.id;

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.api.misPedidosDetallados().subscribe({
      next: p => { this.pedidos.set(p); this.cargando.set(false); },
      error: () => { this.error.set('No se pudieron cargar sus pedidos'); this.cargando.set(false); },
    });
  }

  alternarHistorial(): void {
    this.verHistorial.set(!this.verHistorial());
    if (this.verHistorial() && this.historial().length === 0) {
      this.api.miHistorial().subscribe({
        next: h => this.historial.set(h),
        error: () => this.error.set('No se pudo cargar su historial'),
      });
    }
  }

  verSeguimiento(p: Pedido): void {
    if (this.seguimiento()[p.id]) {
      const copia = { ...this.seguimiento() };
      delete copia[p.id];
      this.seguimiento.set(copia);
      return;
    }
    this.api.miPedidoDetallado(p.id).subscribe({
      next: d => this.seguimiento.set({
        ...this.seguimiento(),
        [p.id]: (d['seguimiento'] as Array<Record<string, unknown>>) ?? [],
      }),
      error: () => this.error.set('No se pudo cargar el seguimiento'),
    });
  }

  // ── La cita ─────────────────────────────────────────────────────────────

  abrirCita(p: Pedido): void {
    this.citaDe.set(this.citaDe() === p.id ? null : p.id);
    this.terceroDe.set(null);
    if (p.programado_en) {
      const d = new Date(p.programado_en);
      this.fechaCita.set(d.toISOString().slice(0, 10));
      this.horaCita.set(d.toTimeString().slice(0, 5));
    } else {
      this.fechaCita.set('');
      this.horaCita.set('');
    }
  }

  guardarCita(p: Pedido): void {
    const f = this.fechaCita();
    if (!f) { this.error.set('Escoja el día'); return; }
    const cuando = new Date(`${f}T${this.horaCita() || '09:00'}:00`);
    if (isNaN(cuando.getTime())) { this.error.set('Esa fecha no es válida'); return; }

    this.api.programarPedido(p.id, cuando.toISOString()).subscribe({
      next: () => {
        this.aviso.set(`Quedó anotado para el ${cuando.toLocaleString()}.`);
        this.citaDe.set(null);
        this.cargar();
      },
      error: e => this.error.set(this.mensaje(e, 'No se pudo guardar la cita')),
    });
  }

  // ── El tercero que recoge ───────────────────────────────────────────────

  abrirTercero(p: Pedido): void {
    this.terceroDe.set(this.terceroDe() === p.id ? null : p.id);
    this.citaDe.set(null);
    this.tNombre.set(''); this.tCedula.set(''); this.tTelefono.set('');
    this.tParentesco.set(''); this.tRostro.set(''); this.tFrente.set(''); this.tReverso.set('');
  }

  guardarTercero(p: Pedido): void {
    if (!this.tNombre().trim() || !this.tCedula().trim()) {
      this.error.set('Hacen falta el nombre y la cédula de quien va a recoger');
      return;
    }
    // Las dos caras se piden aquí y no solo en el servidor para que la persona no se entere
    // en el mostrador, con el mercado enfrente, de que le falta una foto.
    if (!this.tFrente().trim() || !this.tReverso().trim()) {
      this.error.set('Suba la cédula por las dos caras: sin el reverso no se la van a aprobar');
      return;
    }
    this.api.autorizarTercero(p.id, {
      nombre: this.tNombre().trim(),
      cedula: this.tCedula().trim(),
      telefono: this.tTelefono().trim() || undefined,
      parentesco: this.tParentesco().trim() || undefined,
      rostro_doc_id: this.tRostro().trim() || undefined,
      cedula_frente_doc_id: this.tFrente().trim(),
      cedula_reverso_doc_id: this.tReverso().trim(),
    }).subscribe({
      next: () => {
        this.aviso.set('Autorizado. En el punto le van a comparar la cara con la cédula.');
        this.terceroDe.set(null);
        this.cargar();
      },
      error: e => this.error.set(this.mensaje(e, 'No se pudo autorizar')),
    });
  }

  quitarTercero(p: Pedido, terceroId: string): void {
    this.api.quitarTercero(p.id, terceroId).subscribe({
      next: () => { this.aviso.set('Vuelve a recogerlo usted.'); this.cargar(); },
      error: e => this.error.set(this.mensaje(e, 'No se pudo quitar')),
    });
  }

  cancelar(p: Pedido): void {
    this.api.cancelarMiPedido(p.id, 'Cancelado por el comprador').subscribe({
      next: () => { this.aviso.set(`Pedido ${p.numero} cancelado.`); this.cargar(); },
      error: e => this.error.set(this.mensaje(e, 'No se pudo cancelar')),
    });
  }

  /** Solo se puede cancelar solo mientras nadie lo haya empezado a alistar. */
  cancelable(p: Pedido): boolean {
    return p.estado === 'CREADO' || p.estado === 'CONFIRMADO';
  }

  /** La cita y el tercero solo tienen sentido mientras el pedido siga vivo. */
  editable(p: Pedido): boolean {
    return !['ENTREGADO', 'CANCELADO', 'RECHAZADO'].includes(p.estado);
  }

  // ── Presentación ────────────────────────────────────────────────────────

  claseEstado(estado: string): string {
    if (estado === 'ENTREGADO') return 'exito';
    if (estado === 'CANCELADO' || estado === 'RECHAZADO') return 'peligro';
    if (estado === 'CREADO') return 'aviso';
    return 'info';
  }

  textoEstado(estado: string): string {
    const textos: Record<string, string> = {
      CREADO: 'Esperando que la tienda lo confirme',
      CONFIRMADO: 'Confirmado, en cola',
      ALISTANDO: 'La tienda lo está alistando',
      LISTO: 'Listo para recoger',
      EN_RUTA: 'En camino',
      ENTREGADO: 'Entregado',
      CANCELADO: 'Cancelado por usted',
      RECHAZADO: 'Rechazado por la tienda',
    };
    return textos[estado] ?? estado;
  }

  /**
   * Qué significa el cupo apartado, en cristiano.
   *
   * <p>La diferencia entre BLOQUEADO y EJECUTADO es justo lo que la gente no entiende y lo
   * que más pregunta: apartado no es cobrado.
   */
  textoCupo(estado: string | null | undefined): string {
    switch (estado) {
      case 'BLOQUEADO': return 'Apartado de su cupo · todavía no se le ha descontado';
      case 'EJECUTADO': return 'Descontado de su cupo';
      case 'LIBERADO': return 'Devuelto a su cupo';
      case 'FALLIDO': return 'No se pudo apartar';
      default: return '';
    }
  }

  textoPagoTemporal(estado: string | null | undefined): string {
    switch (estado) {
      case 'PENDIENTE': return 'La temporal aún no lo ha aplicado';
      case 'PAGADO': return 'La temporal ya lo pagó';
      case 'PARCIAL': return 'La temporal lo aplicó en parte';
      case 'INCONVENIENTE': return 'Hay un inconveniente';
      case 'ANULADO': return 'Anulado';
      default: return '';
    }
  }

  clasePagoTemporal(estado: string | null | undefined): string {
    if (estado === 'PAGADO') return 'exito';
    if (estado === 'INCONVENIENTE') return 'peligro';
    if (estado === 'PARCIAL') return 'aviso';
    return 'info';
  }

  /** Los mismos colores que `clasePagoTemporal`, en los tonos de la tabla estándar. */
  private tonoPagoTemporal(estado: string | null | undefined): TonoBadge {
    if (estado === 'PAGADO') return 'ok';
    if (estado === 'INCONVENIENTE') return 'danger';
    if (estado === 'PARCIAL') return 'warn';
    return 'info';
  }

  /** Lo mismo que el pipe `currency:'COP':'symbol-narrow':'1.0-0'` de la plantilla. */
  private pesos(valor: unknown): string {
    if (valor === null || valor === undefined || valor === '') return '';
    const n = Number(valor);
    if (isNaN(n)) return '';
    return formatCurrency(n, this.locale, getCurrencySymbol('COP', 'narrow', this.locale), 'COP', '1.0-0');
  }

  private mensaje(e: unknown, porDefecto: string): string {
    const err = e as { error?: { error?: string; message?: string } };
    return err?.error?.error || err?.error?.message || porDefecto;
  }
}
