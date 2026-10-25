import { ChangeDetectionStrategy, Component, computed, signal, inject } from '@angular/core';
import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { CapturaRostro, EcoCapturaRostro } from '../../../../../economiapp/components/eco-captura-rostro';
import {
  CONSENTIMIENTO_VERSION, TEXTO_TERCERO, TEXTO_TITULAR, huellaDelTexto,
} from '../../../../../economiapp/consentimiento-biometrico';
import { Activacion, CanjePuntos, Pedido, TerceroReclamo, TiendaService, VerificacionResumen } from '../../service/tienda.service';
import { ContextoTiendaService } from '../../service/contexto-tienda.service';
import { EscanerCodigoComponent } from '@/app/shared/components/escaner-codigo/escaner-codigo.component';

type Via = 'rostro' | 'cedula';

/**
 * Redimir un servicio o bono en el mostrador.
 *
 * <p>Orden fijo, sin atajos: código → quién reclama (el titular o la persona que él
 * autorizó) → verificar (rostro contra la referencia, o cédula original si la persona no
 * autoriza biometría) → redimir. El botón de redimir no existe hasta que hay una
 * verificación que aprueba; el servidor lo vuelve a exigir y además bloquea el código para
 * que no se redima dos veces. Al redimir se descuenta del cupo y todo queda en la traza.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-tienda-redimir',
  imports: [FormsModule, MatIconModule, DatePipe, CurrencyPipe, DecimalPipe, EcoCapturaRostro, EscanerCodigoComponent],
  templateUrl: './redimir.html',
  styleUrls: ['../../styles/tienda-comun.css', './redimir.css'],
})
export class Redimir {
  private api = inject(TiendaService);
  private ctx = inject(ContextoTiendaService);

  /** Premio por puntos (canje de EconomiAPP) leído en vez de un servicio o bono. */
  readonly canje = signal<CanjePuntos | null>(null);

  readonly codigo = signal('');
  readonly datos = signal<{ activacion: Activacion; pedido: Pedido; terceros: TerceroReclamo[]; vencida: boolean } | null>(null);
  readonly quien = signal<string>('TITULAR');
  readonly via = signal<Via>('rostro');
  readonly acepta = signal(false);
  readonly cedulaPresentada = signal('');
  readonly comentario = signal('');
  readonly verificacion = signal<VerificacionResumen | null>(null);
  readonly ocupado = signal(false);
  readonly error = signal<string | null>(null);
  readonly hecho = signal<string | null>(null);

  readonly tercero = computed(() => this.datos()?.terceros.find(t => t.id === this.quien()) ?? null);
  readonly textoConsentimiento = computed(() => this.tercero() ? TEXTO_TERCERO : TEXTO_TITULAR);
  readonly redimible = computed(() => {
    const d = this.datos();
    return !!d && d.activacion.estado === 'ACTIVA' && !d.vencida;
  });

  async buscar(): Promise<void> {
    const crudo = this.codigo().trim();
    // El QR de un premio por puntos trae "CANJE:"; un código tecleado puede ser de cualquiera
    // de los dos: si no es un servicio o bono, se busca como premio.
    const esCanje = /^canje:/i.test(crudo);
    const c = crudo.replace(/^canje:/i, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (c.length < 6) return;
    this.reiniciar(false);
    this.ocupado.set(true);
    try {
      if (esCanje) { this.canje.set(await firstValueFrom(this.api.canjePorCodigo(c))); return; }
      try {
        this.datos.set(await firstValueFrom(this.api.consultarCodigo(c)));
      } catch (e: any) {
        if (e?.status !== 404 && e?.status !== 403) throw e;
        this.canje.set(await firstValueFrom(this.api.canjePorCodigo(c)));
      }
    } catch (e) {
      this.error.set(this.mensaje(e, 'Ese código no existe o no es de su tienda'));
    } finally {
      this.ocupado.set(false);
    }
  }

  /** Entrega el premio por puntos: si escribió la cédula que le muestran, el servidor la compara. */
  async entregarCanje(): Promise<void> {
    const k = this.canje();
    if (!k || this.ocupado()) return;
    this.ocupado.set(true); this.error.set(null);
    try {
      const r = await firstValueFrom(this.api.entregarCanje(k.codigo, {
        canal: 'MOSTRADOR', tienda_id: k.tienda_id ?? this.ctx.tiendaId(), cedula_presentada: this.cedulaPresentada().trim() || null,
      }));
      this.canje.set(r);
      this.hecho.set(`Premio entregado: ${r.premio_nombre} a ${r.nombre || r.cedula}.`);
    } catch (e) {
      this.error.set(this.mensaje(e, 'No se pudo entregar el premio'));
    } finally {
      this.ocupado.set(false);
    }
  }

  async conRostro(c: CapturaRostro): Promise<void> {
    const d = this.datos();
    if (!d) return;
    this.ocupado.set(true);
    this.error.set(null);
    try {
      const v = await firstValueFrom(this.api.verificarCodigo(d.activacion.codigo, c.blob, c.vivacidad,
        this.tercero()?.id ?? null, { version: CONSENTIMIENTO_VERSION, sha256: await huellaDelTexto(this.textoConsentimiento()) }));
      this.verificacion.set(v);
      if (!v.aprueba) this.error.set(v.resultado === 'DUDOSA'
        ? 'No hay certeza de que sea la misma persona. Repita la foto o verifique con la cédula.'
        : 'La cara no coincide con la foto de referencia.');
    } catch (e) {
      this.error.set(this.mensaje(e, 'No se pudo verificar con el rostro'));
    } finally {
      this.ocupado.set(false);
    }
  }

  async conCedula(): Promise<void> {
    const d = this.datos();
    if (!d || !this.cedulaPresentada().trim() || !this.comentario().trim()) return;
    this.ocupado.set(true);
    this.error.set(null);
    try {
      this.verificacion.set(await firstValueFrom(this.api.verificarCodigoPresencial(d.activacion.codigo, {
        cedula_presentada: this.cedulaPresentada().trim(), tercero_id: this.tercero()?.id ?? null,
        comentario: this.comentario().trim(),
      })));
    } catch (e) {
      this.error.set(this.mensaje(e, 'No se pudo registrar la verificación'));
    } finally {
      this.ocupado.set(false);
    }
  }

  async redimir(): Promise<void> {
    const d = this.datos();
    const v = this.verificacion();
    if (!d || !v?.aprueba) return;
    this.ocupado.set(true);
    this.error.set(null);
    try {
      const r = await firstValueFrom(this.api.redimirCodigo(d.activacion.codigo, v.id));
      this.hecho.set(r.pedido_cerrado
        ? `Redimido. Se descontó de su cupo y el pedido ${d.pedido.numero} quedó entregado.`
        : 'Redimido. Quedan otros códigos de este pedido por reclamar.');
      this.datos.set({ ...d, activacion: r.activacion });
    } catch (e) {
      this.error.set(this.mensaje(e, 'No se pudo redimir'));
    } finally {
      this.ocupado.set(false);
    }
  }

  reiniciar(todo = true): void {
    if (todo) { this.codigo.set(''); this.datos.set(null); }
    this.canje.set(null);
    this.quien.set('TITULAR');
    this.via.set('rostro');
    this.acepta.set(false);
    this.cedulaPresentada.set('');
    this.comentario.set('');
    this.verificacion.set(null);
    this.error.set(null);
    this.hecho.set(null);
  }

  private mensaje(e: unknown, porDefecto: string): string {
    const err = e as { error?: { error?: string; message?: string } };
    return err?.error?.error || err?.error?.message || porDefecto;
  }
}
