import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { FotosEvidencia } from '../../components/fotos-evidencia/fotos-evidencia';
import { SelectorTienda } from '../../components/selector-tienda/selector-tienda';
import { ContextoTiendaService } from '../../service/contexto-tienda.service';
import { CuadreTurno, TiendaService, TurnoCajaFila } from '../../service/tienda.service';

const BILLETES = [100000, 50000, 20000, 10000, 5000, 2000, 1000];
const MONEDAS = [1000, 500, 200, 100, 50];
const TIPOS: Record<string, { nombre: string; icono: string; signo: 1 | -1; ayuda: string }> = {
  GASTO: { nombre: 'Gasto', icono: 'receipt_long', signo: -1, ayuda: 'Compras menores: bolsas, aseo, transporte…' },
  RETIRO: { nombre: 'Retiro a caja fuerte', icono: 'lock', signo: -1, ayuda: 'Para no tener mucho efectivo en el cajón' },
  CONSIGNACION: { nombre: 'Consignación', icono: 'account_balance', signo: -1, ayuda: 'Efectivo llevado al banco' },
  INGRESO: { nombre: 'Ingreso', icono: 'savings', signo: 1, ayuda: 'Sencillo o efectivo que entra al cajón' },
  REEMBOLSO: { nombre: 'Reembolso', icono: 'undo', signo: -1, ayuda: 'Devolución pagada en efectivo' },
};
const METODO: Record<string, string> = { EFECTIVO: 'Efectivo', NOMINA: 'Bono mercado', NEQUI: 'Nequi', DAVIPLATA: 'Daviplata', LLAVE: 'Llave', TRANSFERENCIA: 'Transferencia', PSE: 'PSE', QR: 'QR', TARJETA: 'Tarjeta', BONO: 'Vale', OTRO: 'Otro' };

/**
 * La caja del día: abrir con base, ver en vivo cuánto debe haber, registrar gastos,
 * retiros e ingresos con su soporte, y cerrar contando billetes y monedas.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-caja',
  imports: [CommonModule, FormsModule, MatIconModule, SelectorTienda, FotosEvidencia],
  templateUrl: './caja.html',
  styleUrls: ['../../styles/tienda-comun.css', './caja.css'],
})
export class Caja {
  private api = inject(TiendaService);
  readonly ctx = inject(ContextoTiendaService);
  readonly BILLETES = BILLETES;
  readonly MONEDAS = MONEDAS;
  readonly TIPOS = TIPOS;
  readonly LISTA_TIPOS = ['GASTO', 'RETIRO', 'CONSIGNACION', 'INGRESO'];
  readonly METODO = METODO;

  readonly cajas = signal<{ id: string; nombre: string }[]>([]);
  readonly cajaId = signal<string | null>(null);
  readonly turnos = signal<TurnoCajaFila[]>([]);
  readonly cuadre = signal<CuadreTurno | null>(null);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);
  readonly ocupado = signal(false);
  readonly base = signal(100000);
  readonly nuevaCaja = signal('Caja 1');
  // Movimiento
  readonly tipo = signal('GASTO');
  readonly concepto = signal('');
  readonly monto = signal<number | null>(null);
  readonly referencia = signal('');
  readonly fotosMov = signal<string | null>(null);
  // Cierre
  readonly cerrando = signal(false);
  readonly conteo = signal<Record<string, number>>({});
  readonly otros = signal<Record<string, number>>({});
  readonly observacion = signal('');

  readonly abierto = computed(() => this.turnos().find(t => t.estado === 'ABIERTO' && (!this.cajaId() || t.caja_id === this.cajaId())) ?? null);
  readonly historial = computed(() => this.turnos().filter(t => t.estado === 'CERRADO').slice(0, 30));
  readonly contado = computed(() => Object.entries(this.conteo()).reduce((s, [k, n]) => s + Number(k.slice(1)) * (Number(n) || 0), 0));
  readonly diferencia = computed(() => this.contado() - +(this.cuadre()?.efectivo_esperado ?? 0));

  constructor() {
    this.ctx.cargar();
    effect(() => { const t = this.ctx.tiendaId(); untracked(() => this.cargar(t)); });
  }

  async cargar(t: string | null): Promise<void> {
    this.cuadre.set(null); this.cerrando.set(false);
    if (!t) return;
    try {
      const [cs, ts] = await Promise.all([firstValueFrom(this.api.cajasDeTienda(t)), firstValueFrom(this.api.turnosCaja(t))]);
      this.cajas.set(cs); this.turnos.set(ts);
      if (!this.cajaId() || !cs.some(c => c.id === this.cajaId())) this.cajaId.set(cs[0]?.id ?? null);
      const a = this.abierto(); if (a) await this.refrescar(a.id);
      this.error.set(null);
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo cargar la caja'); }
  }

  async refrescar(id: string): Promise<void> {
    try { this.cuadre.set(await firstValueFrom(this.api.cuadreTurno(id))); } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo cargar el cuadre'); }
  }

  async crearCaja(): Promise<void> {
    const t = this.ctx.tiendaId(); if (!t || !this.nuevaCaja().trim()) return;
    try { const c = await firstValueFrom(this.api.crearCaja(t, this.nuevaCaja().trim())); this.cajaId.set(c.id); this.cargar(t); }
    catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo crear la caja'); }
  }

  async abrir(): Promise<void> {
    const c = this.cajaId(); if (!c) return;
    this.ocupado.set(true);
    try { await firstValueFrom(this.api.abrirTurnoCaja(c, +this.base() || 0)); this.aviso.set('Turno abierto. Ya puede vender.'); await this.cargar(this.ctx.tiendaId()); }
    catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo abrir el turno'); }
    finally { this.ocupado.set(false); }
  }

  async registrar(): Promise<void> {
    const a = this.abierto(); if (!a || !this.monto()) return;
    this.ocupado.set(true); this.error.set(null);
    try {
      const m = await firstValueFrom(this.api.movimientoCaja(a.id, { tipo: this.tipo(), concepto: this.concepto().trim(), monto: +this.monto()!, referencia: this.referencia().trim() || null }));
      this.fotosMov.set(m.id);
      this.aviso.set(`${TIPOS[this.tipo()].nombre} registrado. Agregue la foto del soporte si la tiene.`);
      this.concepto.set(''); this.monto.set(null); this.referencia.set('');
      await this.refrescar(a.id);
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo registrar'); }
    finally { this.ocupado.set(false); }
  }

  /** Clave 'b100000' (billete) o 'm500' (moneda): hay billete y moneda de $1.000. */
  ponerConteo(k: string, n: number): void { this.conteo.update(c => ({ ...c, [k]: Math.max(0, Math.floor(+n || 0)) })); }
  ponerOtro(m: string, v: number): void { this.otros.update(o => ({ ...o, [m]: +v || 0 })); }

  async cerrar(): Promise<void> {
    const a = this.abierto(); if (!a) return;
    const dif = this.diferencia();
    if (Math.abs(dif) >= 1 && !this.observacion().trim()) { this.error.set('Hay diferencia: escriba la explicación antes de cerrar.'); return; }
    if (!confirm(`¿Cerrar el turno con ${this.pesos(this.contado())} en efectivo${Math.abs(dif) >= 1 ? ' (diferencia ' + this.pesos(dif) + ')' : ''}?`)) return;
    this.ocupado.set(true);
    try {
      const t = await firstValueFrom(this.api.cerrarTurnoCaja(a.id, { declarado: { ...this.otros(), EFECTIVO: this.contado() }, observacion: this.observacion().trim() || null, conteo: this.conteo() }));
      this.aviso.set(`Turno cerrado. Diferencia: ${this.pesos(t.diferencia)}.`);
      this.conteo.set({}); this.otros.set({}); this.observacion.set(''); this.cerrando.set(false);
      await this.cargar(this.ctx.tiendaId());
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo cerrar'); }
    finally { this.ocupado.set(false); }
  }

  pesos(v: number | null | undefined): string { return v == null ? '—' : (v < 0 ? '−$' : '$') + Math.abs(Math.round(+v)).toLocaleString('es-CO'); }
  declarado(t: TurnoCajaFila): number | null { try { return JSON.parse(t.totales_declarado_json || '{}').EFECTIVO ?? null; } catch { return null; } }
}
