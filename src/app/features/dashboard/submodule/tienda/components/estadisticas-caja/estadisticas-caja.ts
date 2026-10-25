import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';
import { RegistroCaja, ResumenCaja, TiendaService } from '../../service/tienda.service';

const MEDIO: Record<string, string> = {
  EFECTIVO: 'Efectivo', NOMINA: 'Bono mercado', NEQUI: 'Nequi', DAVIPLATA: 'Daviplata', LLAVE: 'Llave',
  TRANSFERENCIA: 'Transferencia', PSE: 'PSE', QR: 'QR', TARJETA: 'Tarjeta', BONO: 'Vale', OTRO: 'Otro',
};

function hoyBogota(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

function pesos(n: unknown): string {
  return '$' + Math.round(Number(n ?? 0)).toLocaleString('es-CO');
}

/**
 * Estadísticas y registro de la caja de una tienda: cuánto se vendió, con qué medios
 * (bono mercado, efectivo, QR, tarjeta…), a qué horas, quién vendió, lo más vendido, vueltas
 * entregadas, pagos por verificar, ventas bajo pedido y el registro venta por venta con su
 * observación y soportes.
 */
@Component({
  selector: 'app-estadisticas-caja',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, ...TABLA_ESTANDAR],
  template: `
    <div class="ec">
      <div class="ec-rango">
        <div class="campo"><label>Desde</label><input type="date" [ngModel]="desde()" (ngModelChange)="desde.set($event)" /></div>
        <div class="campo"><label>Hasta</label><input type="date" [ngModel]="hasta()" (ngModelChange)="hasta.set($event)" /></div>
        <button type="button" class="boton secundario" (click)="rango(0)">Hoy</button>
        <button type="button" class="boton secundario" (click)="rango(6)">7 días</button>
        <button type="button" class="boton secundario" (click)="rango(29)">30 días</button>
      </div>

      @if (resumen(); as r) {
        <div class="ec-kpis">
          <div class="ec-kpi"><span>Ventas</span><strong>{{ r.totales.ventas }}</strong></div>
          <div class="ec-kpi"><span>Total vendido</span><strong>{{ pesos(r.totales.total) }}</strong></div>
          <div class="ec-kpi"><span>Ticket promedio</span><strong>{{ pesos(r.totales.ticket_promedio) }}</strong></div>
          <div class="ec-kpi"><span>Margen</span><strong>{{ pesos(r.totales.margen) }}</strong></div>
          <div class="ec-kpi"><span>Colaboradores / mostrador</span><strong>{{ r.totales.ventas_colaborador || 0 }} / {{ r.totales.ventas_mostrador || 0 }}</strong></div>
          <div class="ec-kpi"><span>Bono mercado</span><strong>{{ pesos(r.bono.monto) }}</strong><small>{{ r.bono.pagos }} pago(s) · {{ r.bono.con_autorizacion || 0 }} con autorización</small></div>
          <div class="ec-kpi"><span>Vueltas entregadas</span><strong>{{ pesos(vueltas()) }}</strong></div>
          <div class="ec-kpi"><span>Bajo pedido</span><strong>{{ pesos(r.bajo_pedido.monto) }}</strong><small>{{ r.bajo_pedido.ventas }} venta(s)</small></div>
          <div class="ec-kpi"><span>Abiertas ahora / anuladas</span><strong>{{ r.abiertas }} / {{ r.anuladas }}</strong></div>
        </div>

        <div class="ec-paneles">
          <section class="tienda-tarjeta">
            <h3>Por medio de pago</h3>
            @for (m of r.por_medio; track m.metodo) {
              <div class="ec-barra">
                <span class="ec-barra-nombre">{{ medio(m.metodo) }}</span>
                <span class="ec-barra-pista"><span class="ec-barra-valor" [style.width.%]="pct(m.monto, maxMedio())"></span></span>
                <strong>{{ pesos(m.monto) }}</strong>
                <small>{{ m.pagos }} pago(s)@if (m.por_verificar) { · {{ m.por_verificar }} por verificar }</small>
              </div>
            } @empty { <p class="nota">Sin ventas en el rango.</p> }
          </section>

          <section class="tienda-tarjeta">
            <h3>Por hora</h3>
            <div class="ec-horas">
              @for (h of horas(); track h.hora) {
                <div class="ec-hora" [title]="h.hora + ':00 · ' + h.ventas + ' venta(s) · ' + pesos(h.total)">
                  <span class="ec-hora-barra" [style.height.%]="pct(h.total, maxHora())"></span>
                  <small>{{ h.hora }}</small>
                </div>
              }
            </div>
          </section>

          <section class="tienda-tarjeta">
            <h3>Lo más vendido</h3>
            <ol class="ec-lista">
              @for (p of r.top_productos; track p.producto_id) {
                <li><span>{{ p.descripcion }}@if (p.bajo_pedido) { <small> · bajo pedido</small> }</span><span>{{ p.cantidad | number:'1.0-2' }} u · <strong>{{ pesos(p.total) }}</strong></span></li>
              } @empty { <p class="nota">Sin ventas en el rango.</p> }
            </ol>
          </section>

          <section class="tienda-tarjeta">
            <h3>Por vendedor</h3>
            <ol class="ec-lista">
              @for (v of r.por_vendedor; track v.vendedor) {
                <li><span>{{ v.vendedor }}</span><span>{{ v.ventas }} · <strong>{{ pesos(v.total) }}</strong></span></li>
              } @empty { <p class="nota">Sin ventas en el rango.</p> }
            </ol>
          </section>
        </div>
      }

      <app-tabla-estandar
        id="tienda-registro-caja"
        titulo="Registro de la caja"
        modulo="Tienda"
        vacio="No hay ventas de mostrador en el rango."
        [cargando]="cargando()"
        [datos]="registro()"
        [columnas]="columnas"
        [filaId]="idFila" />
    </div>
  `,
  styleUrls: ['../../styles/tienda-comun.css'],
  styles: [`
    .ec { display: grid; gap: 14px; }
    .ec-rango { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; }
    .ec-kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }
    .ec-kpi { display: grid; gap: 2px; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface); }
    .ec-kpi span { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
    .ec-kpi strong { font-size: 20px; font-variant-numeric: tabular-nums; }
    .ec-kpi small { font-size: 12px; color: var(--muted); }
    .ec-paneles { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; }
    .ec-paneles h3 { margin: 0 0 10px; font-size: 15px; }
    .ec-barra { display: grid; grid-template-columns: 110px minmax(0, 1fr) auto; gap: 4px 8px; align-items: center; margin-bottom: 8px; }
    .ec-barra small { grid-column: 2 / -1; font-size: 11.5px; color: var(--muted); }
    .ec-barra-pista { height: 12px; border-radius: 999px; background: var(--surface-2); overflow: hidden; }
    .ec-barra-valor { display: block; height: 100%; border-radius: 999px; background: #0b6b58; }
    .ec-barra strong { font-variant-numeric: tabular-nums; }
    .ec-horas { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(14px, 1fr); gap: 4px; align-items: end; height: 140px; }
    .ec-hora { display: grid; grid-template-rows: 1fr auto; height: 100%; align-items: end; justify-items: center; }
    .ec-hora-barra { width: 100%; min-height: 2px; border-radius: 4px 4px 0 0; background: #0b6b58; }
    .ec-hora small { font-size: 10px; color: var(--muted); }
    .ec-lista { margin: 0; padding-left: 18px; display: grid; gap: 6px; font-size: 13.5px; }
    .ec-lista li > span:first-child { margin-right: 8px; }
    .ec-lista li { display: list-item; }
    .ec-lista li span:last-child { float: right; font-variant-numeric: tabular-nums; }
    .nota { margin: 0; font-size: 13px; color: var(--muted); }
  `],
})
export class EstadisticasCaja {
  private api = inject(TiendaService);
  readonly tiendaId = input.required<string>();

  readonly desde = signal(hoyBogota());
  readonly hasta = signal(hoyBogota());
  readonly resumen = signal<ResumenCaja | null>(null);
  readonly registro = signal<RegistroCaja[]>([]);
  readonly cargando = signal(false);
  readonly pesos = pesos;

  readonly vueltas = computed(() => (this.resumen()?.por_medio ?? []).reduce((s, m) => s + Number(m.vueltas ?? 0), 0));
  readonly maxMedio = computed(() => Math.max(1, ...(this.resumen()?.por_medio ?? []).map(m => Number(m.monto))));
  readonly horas = computed(() => {
    const por = new Map((this.resumen()?.por_hora ?? []).map(h => [Number(h.hora), h]));
    const lista = [];
    for (let h = 6; h <= 22; h++) lista.push(por.get(h) ?? { hora: h, ventas: 0, total: 0 });
    return lista;
  });
  readonly maxHora = computed(() => Math.max(1, ...this.horas().map(h => Number(h.total))));

  readonly columnas: ColumnaTabla<RegistroCaja>[] = [
    { id: 'numero', header: 'Venta', valor: r => r.numero, tarjeta: 'titulo' },
    { id: 'fecha', header: 'Fecha', valor: r => r.confirmada_en || r.creado_en,
      formato: r => new Date(r.confirmada_en || r.creado_en).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }), tarjeta: 'meta' },
    { id: 'estado', header: 'Estado', valor: r => r.estado,
      badge: r => ({ texto: ({ BORRADOR: 'Abierta', CONFIRMADA: 'Confirmada', ANULADA: 'Anulada', DEVUELTA: 'Devuelta', DEVUELTA_PARCIAL: 'Devuelta en parte' } as Record<string, string>)[r.estado] ?? r.estado,
        tono: r.estado === 'CONFIRMADA' ? 'ok' : r.estado === 'BORRADOR' ? 'info' : r.estado === 'ANULADA' ? 'danger' : 'warn' }) },
    { id: 'tipo', header: 'Cliente', valor: r => r.cliente_tipo === 'COLABORADOR' ? 'Colaborador' : 'Mostrador', prioridad: 2 },
    { id: 'cliente', header: 'Nombre', valor: r => r.cliente_nombre || r.etiqueta || '', tarjeta: 'subtitulo' },
    { id: 'cedula', header: 'Cédula', valor: r => r.cliente_cedula, prioridad: 3 },
    { id: 'medios', header: 'Medios de pago', minAncho: '180px',
      valor: r => (r.medios ?? '').split(' + ').filter(Boolean).map(x => { const [m, v] = x.split(':'); return `${MEDIO[m] ?? m} ${pesos(v)}`; }).join(' + ') },
    { id: 'total', header: 'Total', align: 'right', valor: r => Number(r.total), formato: r => pesos(r.total), copiaTexto: r => String(r.total) },
    { id: 'vueltas', header: 'Vueltas', align: 'right', prioridad: 2, valor: r => Number(r.vueltas), formato: r => Number(r.vueltas) ? pesos(r.vueltas) : '' },
    { id: 'verificar', header: 'Por verificar', align: 'right', prioridad: 2, valor: r => Number(r.por_verificar) || null },
    { id: 'soportes', header: 'Soportes', align: 'right', prioridad: 3, valor: r => Number(r.soportes) || null },
    { id: 'pedido', header: 'Bajo pedido', align: 'right', prioridad: 3, valor: r => Number(r.lineas_bajo_pedido) || null },
    { id: 'observacion', header: 'Observación', valor: r => r.observacion, minAncho: '160px', tarjeta: 'cuerpo' },
    { id: 'vendedor', header: 'Vendedor', valor: r => r.vendedor_nombre, prioridad: 3 },
  ];
  readonly idFila = (r: RegistroCaja) => r.id;

  constructor() {
    effect(() => {
      const t = this.tiendaId(), d = this.desde(), h = this.hasta();
      untracked(() => this.cargar(t, d, h));
    });
  }

  rango(dias: number): void {
    const hoy = hoyBogota();
    const d = new Date(hoy + 'T12:00:00');
    d.setDate(d.getDate() - dias);
    this.hasta.set(hoy);
    this.desde.set(d.toISOString().slice(0, 10));
  }

  medio(c: string): string { return MEDIO[c] ?? c; }
  pct(v: number, max: number): number { return Math.max(0, Math.min(100, (Number(v) / max) * 100)); }

  private cargar(t: string, d: string, h: string): void {
    if (!t || !d || !h) return;
    this.cargando.set(true);
    this.api.resumenCaja(t, d, h).subscribe({ next: r => this.resumen.set(r), error: () => this.resumen.set(null) });
    this.api.registroCaja(t, d, h).subscribe({
      next: r => { this.registro.set(r); this.cargando.set(false); },
      error: () => { this.registro.set([]); this.cargando.set(false); },
    });
  }
}
