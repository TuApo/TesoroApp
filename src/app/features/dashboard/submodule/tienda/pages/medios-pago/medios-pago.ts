import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { SelectorTienda } from '../../components/selector-tienda/selector-tienda';
import { ContextoTiendaService } from '../../service/contexto-tienda.service';
import { ConfigPasarela, MedioPago, TiendaService } from '../../service/tienda.service';

const TIPOS: Record<string, { nombre: string; icono: string; numero?: string; enlace?: boolean }> = {
  EFECTIVO: { nombre: 'Efectivo', icono: 'payments' },
  NEQUI: { nombre: 'Nequi', icono: 'phone_iphone', numero: 'Celular Nequi' },
  DAVIPLATA: { nombre: 'Daviplata', icono: 'phone_iphone', numero: 'Celular Daviplata' },
  LLAVE: { nombre: 'Llave Bre-B', icono: 'key', numero: 'Llave (celular, correo, documento o alfanumérica)' },
  TRANSFERENCIA: { nombre: 'Cuenta bancaria', icono: 'account_balance', numero: 'Número de cuenta' },
  PSE: { nombre: 'PSE', icono: 'account_balance', enlace: true },
  QR: { nombre: 'Código QR', icono: 'qr_code_2' },
  TARJETA: { nombre: 'Tarjeta', icono: 'credit_card', enlace: true },
  BONO: { nombre: 'Vale o bono de regalo', icono: 'card_giftcard' },
};

/**
 * Con qué le pagan a esta tienda lo que no cubre el bono mercado. Cada local tiene sus
 * cuentas; en un pedido de varias tiendas la persona le paga a cada una con lo suyo.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-medios-pago',
  imports: [CommonModule, FormsModule, MatIconModule, SelectorTienda],
  templateUrl: './medios-pago.html',
  styleUrls: ['../../styles/tienda-comun.css', './medios-pago.css'],
})
export class MediosPago {
  private api = inject(TiendaService);
  readonly ctx = inject(ContextoTiendaService);
  readonly TIPOS = TIPOS;
  readonly LISTA = Object.keys(TIPOS);
  readonly medios = signal<Partial<MedioPago>[]>([]);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  /** Pasarela de la tienda (confirmación automática de pagos). Los secretos nunca vuelven del servidor. */
  readonly pasarela = signal<ConfigPasarela | null>(null);
  readonly METODOS_PASARELA = ['QR', 'TARJETA', 'NEQUI', 'PSE', 'DAVIPLATA', 'TRANSFERENCIA', 'LLAVE'];
  formPasarela = { ambiente: 'SANDBOX', llave_publica: '', llave_privada: '', secreto_integridad: '', secreto_eventos: '', metodos: [] as string[], activo: false };
  readonly guardandoPasarela = signal(false);

  constructor() {
    this.ctx.cargar();
    effect(() => { const t = this.ctx.tiendaId(); untracked(() => this.cargar(t)); });
  }

  async cargar(t: string | null): Promise<void> {
    this.medios.set([]); this.error.set(null); this.aviso.set(null);
    if (!t) return;
    try { this.medios.set(await firstValueFrom(this.api.mediosDeTienda(t))); }
    catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudieron cargar los medios'); }
    this.pasarela.set(null);
    try { this.ponerPasarela(await firstValueFrom(this.api.configPasarela(t))); } catch { /* sin permiso o sin configurar */ }
  }

  agregar(metodo: string): void {
    this.medios.update(m => [...m, { metodo, activo: true, requiere_comprobante: metodo !== 'EFECTIVO' }]);
  }
  quitar(i: number): void { this.medios.update(m => m.filter((_, j) => j !== i)); }
  cambiar(i: number, k: keyof MedioPago, v: unknown): void {
    this.medios.update(m => m.map((x, j) => j === i ? { ...x, [k]: v } : x));
  }

  readonly subiendoQr = signal<number | null>(null);
  /** Imagen del QR (Bre-B, Nequi, banco): la persona lo escanea desde su pedido. */
  async subirQr(i: number, ev: Event): Promise<void> {
    const f = (ev.target as HTMLInputElement).files?.[0]; const t = this.ctx.tiendaId(); if (!f || !t) return;
    this.subiendoQr.set(i);
    try { this.cambiar(i, 'qr_doc_id', await firstValueFrom(this.api.subirArchivo(f, f.name, t, 'STORE_MEDIO_PAGO_QR'))); }
    catch { this.error.set('No se pudo subir la imagen del QR'); }
    finally { this.subiendoQr.set(null); }
  }

  async guardar(): Promise<void> {
    const t = this.ctx.tiendaId(); if (!t) return;
    this.guardando.set(true); this.error.set(null); this.aviso.set(null);
    try {
      this.medios.set(await firstValueFrom(this.api.guardarMediosDeTienda(t, this.medios().map((m, i) => ({ ...m, orden: i })))));
      this.aviso.set('Medios de pago guardados. Ya los ven las personas al pagar.');
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo guardar'); }
    finally { this.guardando.set(false); }
  }

  private ponerPasarela(c: ConfigPasarela): void {
    this.pasarela.set(c);
    this.formPasarela = { ambiente: c.ambiente, llave_publica: c.llave_publica ?? '', llave_privada: '', secreto_integridad: '',
      secreto_eventos: '', metodos: [...c.metodos], activo: c.activo };
  }

  alternarMetodoPasarela(m: string): void {
    const ms = this.formPasarela.metodos;
    this.formPasarela.metodos = ms.includes(m) ? ms.filter(x => x !== m) : [...ms, m];
  }

  async guardarPasarela(activar?: boolean): Promise<void> {
    const t = this.ctx.tiendaId(); if (!t) return;
    this.guardandoPasarela.set(true); this.error.set(null); this.aviso.set(null);
    const f = this.formPasarela;
    try {
      this.ponerPasarela(await firstValueFrom(this.api.guardarPasarela(t, {
        ambiente: f.ambiente, llave_publica: f.llave_publica.trim() || null, llave_privada: f.llave_privada.trim() || null,
        secreto_integridad: f.secreto_integridad.trim() || null, secreto_eventos: f.secreto_eventos.trim() || null,
        metodos: f.metodos, activo: activar ?? f.activo,
      })));
      this.aviso.set(this.pasarela()?.activo ? 'Pasarela activa: la caja cobrará esos medios con QR y los confirmará sola.' : 'Pasarela guardada (inactiva).');
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo guardar la pasarela'); }
    finally { this.guardandoPasarela.set(false); }
  }

  async probarPasarela(): Promise<void> {
    const t = this.ctx.tiendaId(); if (!t) return;
    this.error.set(null);
    try {
      const r = await firstValueFrom(this.api.probarPasarela(t));
      this.aviso.set(`Conexión correcta con la pasarela${r.nombre_comercio ? ': comercio «' + r.nombre_comercio + '»' : ''}.`);
      this.ponerPasarela(await firstValueFrom(this.api.configPasarela(t)));
    } catch (e: any) { this.error.set(e?.error?.error ?? 'La pasarela no respondió'); }
  }
}
