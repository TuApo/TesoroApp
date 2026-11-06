import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';
import { ECO_CONTEXTO_TIENDA, mensajeError, pesos } from '../kanban/eco-portable';
import { DetalleFiado, FiadoApi, ResumenFiado } from './fiado-api.service';

/**
 * Fiado: el cuaderno del comercio. Cuentas por persona con cupo, saldo y mora; fiar,
 * abonar, bloquear, cerrar y mandar un recordatorio de pago (que respeta la Ley 2300).
 *
 * <p>Portable: standalone; usa `<app-tabla-estandar>` (lista) y los tokens de `eco-portable.ts`.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'eco-fiado',
  imports: [CommonModule, FormsModule, MatIconModule, ...TABLA_ESTANDAR],
  templateUrl: './fiado.html',
  styleUrl: './fiado.css',
})
export class Fiado implements OnInit {
  private api = inject(FiadoApi);
  readonly ctx = inject(ECO_CONTEXTO_TIENDA);

  readonly tiendaId = input<string | null>(null);
  readonly sinSelector = input(false);
  readonly tienda = computed(() => this.tiendaId() ?? this.ctx.tiendaId());
  readonly puedeAdministrar = computed(() => ['ADMIN_NEGOCIO', 'ADMIN_TIENDA'].includes(this.ctx.rolEnTienda() ?? ''));

  readonly cuentas = signal<ResumenFiado[]>([]);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);
  readonly filtro = signal<'TODAS' | 'MORA' | 'CON_SALDO' | 'BLOQUEADA' | 'CERRADA'>('TODAS');
  readonly detalle = signal<DetalleFiado | null>(null);
  readonly abriendo = signal(false);

  nueva = { cedula: '', nombre: '', telefono: '', cupo: null as number | null, dias_plazo: 30, nota: '' };
  cargo = { monto: null as number | null, nota: '' };
  abono = { monto: null as number | null, medio: 'EFECTIVO', referencia: '', nota: '' };
  readonly MEDIOS = ['EFECTIVO', 'NEQUI', 'DAVIPLATA', 'BREB', 'TRANSFERENCIA', 'OTRO'];

  readonly visibles = computed(() => {
    const f = this.filtro();
    return this.cuentas().filter(r => f === 'TODAS' ? r.cuenta.estado !== 'CERRADA'
      : f === 'MORA' ? r.en_mora : f === 'CON_SALDO' ? +r.cuenta.saldo > 0 : r.cuenta.estado === f);
  });
  readonly totalSaldo = computed(() => this.visibles().reduce((s, r) => s + +r.cuenta.saldo, 0));
  readonly enMora = computed(() => this.cuentas().filter(r => r.en_mora).length);

  readonly columnas: ColumnaTabla<ResumenFiado>[] = [
    { id: 'cliente', header: 'Persona', valor: r => r.cuenta.cliente_nombre || r.cuenta.cliente_cedula, tarjeta: 'titulo' },
    { id: 'cedula', header: 'Cédula', valor: r => r.cuenta.cliente_cedula, prioridad: 2 },
    { id: 'saldo', header: 'Debe', valor: r => +r.cuenta.saldo, formato: r => pesos(r.cuenta.saldo), align: 'right', copiaTexto: r => String(r.cuenta.saldo) },
    { id: 'cupo', header: 'Cupo', valor: r => r.cuenta.cupo == null ? null : +r.cuenta.cupo, formato: r => r.cuenta.cupo == null ? 'Sin tope' : pesos(r.cuenta.cupo), align: 'right', prioridad: 2 },
    { id: 'estado', header: 'Estado', valor: r => r.en_mora ? 'EN MORA' : r.cuenta.estado,
      badge: r => r.en_mora ? { texto: `Mora ${r.dias_mora} d`, tono: 'danger' } : r.cuenta.estado === 'ACTIVA' ? { texto: 'Activa', tono: 'ok' } : r.cuenta.estado === 'BLOQUEADA' ? { texto: 'Bloqueada', tono: 'warn' } : { texto: 'Cerrada', tono: 'neutro' } },
    { id: 'ultimo', header: 'Último cargo', valor: r => r.cuenta.ultimo_cargo_en, prioridad: 3 },
  ];
  readonly filaId = (r: ResumenFiado) => r.cuenta.id;

  constructor() { effect(() => { this.tienda(); untracked(() => this.cargar()); }); }
  ngOnInit(): void { if (!this.tiendaId()) this.ctx.cargar(); }

  async cargar(): Promise<void> {
    const t = this.tienda(); if (!t) { this.cuentas.set([]); return; }
    this.cargando.set(true);
    try { this.cuentas.set(await firstValueFrom(this.api.cuentas(t))); this.error.set(null); }
    catch (e) { this.error.set(mensajeError(e, 'No se pudieron cargar las cuentas')); }
    finally { this.cargando.set(false); }
  }

  async abrirCuenta(): Promise<void> {
    const t = this.tienda(); if (!t) return;
    if (!this.nueva.cedula.trim()) { this.error.set('Escriba la cédula de la persona.'); return; }
    try {
      const c = await firstValueFrom(this.api.abrir(t, { cedula: this.nueva.cedula.trim(), nombre: this.nueva.nombre || undefined, telefono: this.nueva.telefono || undefined,
        cupo: this.nueva.cupo, dias_plazo: this.nueva.dias_plazo, nota: this.nueva.nota || undefined }));
      this.aviso.set(`Cuenta de ${c.cliente_nombre || c.cliente_cedula} lista`); this.error.set(null);
      this.nueva = { cedula: '', nombre: '', telefono: '', cupo: null, dias_plazo: 30, nota: '' };
      this.abriendo.set(false);
      await this.cargar(); await this.ver(c.id);
    } catch (e) { this.error.set(mensajeError(e, 'No se pudo abrir la cuenta')); }
  }

  async ver(id: string): Promise<void> {
    if (this.detalle()?.cuenta.id === id) { this.detalle.set(null); return; }
    try { this.detalle.set(await firstValueFrom(this.api.detalle(id))); this.cargo = { monto: null, nota: '' }; this.abono = { monto: null, medio: 'EFECTIVO', referencia: '', nota: '' }; }
    catch (e) { this.error.set(mensajeError(e, 'No se pudo abrir la cuenta')); }
  }
  private async refrescar(): Promise<void> {
    const d = this.detalle(); if (!d) return;
    this.detalle.set(await firstValueFrom(this.api.detalle(d.cuenta.id)));
    await this.cargar();
  }

  async fiar(): Promise<void> {
    const d = this.detalle(); if (!d || !this.cargo.monto) return;
    try {
      await firstValueFrom(this.api.cargar(d.cuenta.id, this.cargo.monto, { nota: this.cargo.nota || undefined }));
      this.aviso.set(`Fiado ${pesos(this.cargo.monto)} a ${d.cuenta.cliente_nombre || d.cuenta.cliente_cedula}`); this.error.set(null);
      await this.refrescar();
    } catch (e) { this.error.set(mensajeError(e, 'No se pudo fiar')); }
  }

  async abonar(): Promise<void> {
    const d = this.detalle(); if (!d || !this.abono.monto) return;
    try {
      await firstValueFrom(this.api.abonar(d.cuenta.id, this.abono.monto, { medio: this.abono.medio, referencia: this.abono.referencia || undefined, nota: this.abono.nota || undefined }));
      this.aviso.set(`Abono de ${pesos(this.abono.monto)} registrado`); this.error.set(null);
      await this.refrescar();
    } catch (e) { this.error.set(mensajeError(e, 'No se pudo abonar')); }
  }

  async estado(estado: 'ACTIVA' | 'BLOQUEADA' | 'CERRADA'): Promise<void> {
    const d = this.detalle(); if (!d) return;
    const texto = { ACTIVA: '¿Reactivar la cuenta?', BLOQUEADA: '¿Bloquear la cuenta? No se le fía más hasta que se desbloquee.', CERRADA: '¿Cerrar la cuenta? Solo se cierra con saldo en cero.' }[estado];
    if (!confirm(texto)) return;
    try { await firstValueFrom(this.api.estado(d.cuenta.id, estado)); await this.refrescar(); this.error.set(null); }
    catch (e) { this.error.set(mensajeError(e, 'No se pudo cambiar el estado')); }
  }

  async ajustar(): Promise<void> {
    const d = this.detalle(); if (!d) return;
    const v = prompt('Nuevo saldo (solo administración; queda escrito como ajuste):', String(d.cuenta.saldo));
    if (v == null) return;
    const motivo = prompt('Motivo del ajuste:');
    if (!motivo || !motivo.trim()) return;
    try { await firstValueFrom(this.api.ajustar(d.cuenta.id, +v, motivo.trim())); await this.refrescar(); this.error.set(null); }
    catch (e) { this.error.set(mensajeError(e, 'No se pudo ajustar')); }
  }

  async recordar(): Promise<void> {
    const d = this.detalle(); if (!d) return;
    try {
      const r = await firstValueFrom(this.api.recordar(d.cuenta.id));
      this.aviso.set(r.estado === 'PENDIENTE' ? 'Recordatorio programado: sale en la próxima franja permitida (Ley 2300)' : `Recordatorio ${r.estado.toLowerCase()}`);
      this.error.set(null); await this.refrescar();
    } catch (e) { this.error.set(mensajeError(e, 'No se pudo programar el recordatorio')); }
  }

  readonly pesos = pesos;
  tipoTexto(t: string): string { return ({ CARGO: 'Fiado', ABONO: 'Abono', AJUSTE: 'Ajuste' } as Record<string, string>)[t] ?? t; }
  cambiarTienda(ev: Event): void { this.ctx.seleccionar((ev.target as HTMLSelectElement).value || null); }
}
