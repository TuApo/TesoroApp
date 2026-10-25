import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { ImpresoraBoton } from '../../components/impresora/impresora';
import { CasoPedidoPanel } from '../../components/caso-pedido/caso-pedido';
import { ConfirmarHora } from '../../components/confirmar-hora/confirmar-hora';
import { compromiso, franjaAcordada } from '../../util/fechas-entrega';
import { ContextoTiendaService } from '../../service/contexto-tienda.service';
import { PedidoEnCola, TiendaService } from '../../service/tienda.service';
import { abrirPdf, avisar, hace, minutosDesde, pedirPermisoAvisos, utc } from '../../util/alerta-nuevos';

type Vista = 'cola' | 'mios' | 'listos';

/**
 * La cola del alistador. Le llegan los pedidos confirmados de sus tiendas (suena y vibra
 * cuando entra uno), toma uno — queda a su nombre y nadie más lo alista —, lo junta artículo
 * por artículo, imprime la orden + el formato de mercado (libranza) y los
 * stickers, y lo deja LISTO: ahí sale a la bolsa de los domiciliarios.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-alistamiento',
  imports: [CommonModule, FormsModule, MatIconModule, RouterLink, ImpresoraBoton, CasoPedidoPanel, ConfirmarHora],
  templateUrl: './alistamiento.html',
  styleUrls: ['../../styles/tienda-comun.css', './alistamiento.css'],
})
export class Alistamiento implements OnInit, OnDestroy {
  private api = inject(TiendaService);
  private router = inject(Router);
  readonly ctx = inject(ContextoTiendaService);

  readonly pedidos = signal<PedidoEnCola[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly ocupado = signal<string | null>(null);
  readonly vista = signal<Vista>('cola');
  readonly tienda = signal<string>('');
  readonly sonido = signal(true);
  readonly actualizado = signal<Date | null>(null);
  readonly casoDe = signal<string | null>(null);
  readonly horaDe = signal<string | null>(null);
  readonly compromiso = compromiso;

  readonly porAlistar = computed(() => this.pedidos().filter(p => ['CONFIRMADO', 'ALISTANDO'].includes(p.estado) && !this.esMio(p)));
  readonly mios = computed(() => this.pedidos().filter(p => ['CONFIRMADO', 'ALISTANDO'].includes(p.estado) && this.esMio(p)));
  readonly listos = computed(() => this.pedidos().filter(p => p.estado === 'LISTO'));
  readonly visibles = computed(() => this.vista() === 'mios' ? this.mios() : this.vista() === 'listos' ? this.listos() : this.porAlistar());

  private reloj: ReturnType<typeof setInterval> | null = null;
  private conocidos: Set<string> | null = null;

  ngOnInit(): void {
    this.ctx.cargar();
    pedirPermisoAvisos();
    this.cargar();
    this.reloj = setInterval(() => { if (document.visibilityState === 'visible' || this.sonido()) this.cargar(true); }, 20_000);
  }
  ngOnDestroy(): void { if (this.reloj) clearInterval(this.reloj); }

  async cargar(silencioso = false): Promise<void> {
    if (!silencioso) this.cargando.set(true);
    try {
      const lista = await firstValueFrom(this.api.colaAlistamiento(this.tienda() || null));
      const nuevos = lista.filter(p => p.estado === 'CONFIRMADO' && !p.alistador_id && this.conocidos && !this.conocidos.has(p.id));
      if (nuevos.length && this.sonido()) {
        avisar(nuevos.length === 1 ? `Pedido ${nuevos[0].numero} por alistar` : `${nuevos.length} pedidos nuevos por alistar`,
          nuevos.map(p => `${p.tienda}: ${p.lineas} artículos`).join(' · '));
      }
      this.conocidos = new Set(lista.map(p => p.id));
      this.pedidos.set(lista);
      this.actualizado.set(new Date());
      this.error.set(null);
    } catch (e: any) {
      if (!silencioso) this.error.set(e?.error?.error ?? 'No se pudo cargar la cola de alistamiento');
    } finally { this.cargando.set(false); }
  }

  esMio(p: PedidoEnCola): boolean { return !!+(p.es_mio ?? 0); }
  franja(p: PedidoEnCola): string | null { return p.hora_confirmada_en ? franjaAcordada(p.programado_en, p.programado_hasta) : null; }
  async horaConfirmada(): Promise<void> { this.horaDe.set(null); await this.cargar(true); }

  async tomar(p: PedidoEnCola, reasignar = false): Promise<void> {
    if (reasignar && !confirm(`${p.alistador_nombre} está alistando ${p.numero}. ¿Quitárselo y tomarlo usted?`)) return;
    this.ocupado.set(p.id); this.error.set(null);
    try {
      await firstValueFrom(this.api.tomarAlistamiento(p.id, reasignar));
      this.router.navigate(['/dashboard/tienda/alistar', p.id], { queryParams: { desde: 'cola' } });
    } catch (e: any) {
      this.error.set(e?.error?.error ?? 'No se pudo tomar el pedido');
      this.cargar(true);
    } finally { this.ocupado.set(null); }
  }

  async soltar(p: PedidoEnCola): Promise<void> {
    if (!confirm(`¿Soltar ${p.numero} para que otro lo aliste? Lo marcado se conserva.`)) return;
    this.ocupado.set(p.id);
    try { await firstValueFrom(this.api.soltarAlistamiento(p.id)); await this.cargar(true); }
    catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo soltar'); }
    finally { this.ocupado.set(null); }
  }

  async paquete(p: PedidoEnCola): Promise<void> {
    this.ocupado.set(p.id); this.error.set(null);
    try {
      abrirPdf(await firstValueFrom(this.api.paquetePdf(p.id)), `paquete-${p.numero}.pdf`);
      this.cargar(true);
    } catch (e: any) { this.error.set(await mensaje(e, 'No se pudo generar el paquete')); }
    finally { this.ocupado.set(null); }
  }

  minutos(p: PedidoEnCola): number | null {
    return minutosDesde(p.alistado_en && p.estado === 'LISTO' ? p.alistado_en : p.confirmado_en || p.creado_en);
  }
  hace = hace;
  utc = utc;
  pesos(v: number | null | undefined): string { return v == null ? '' : '$' + Math.round(+v).toLocaleString('es-CO'); }
}

/** El error de una respuesta Blob viene como Blob: hay que leerlo para mostrar el motivo. */
async function mensaje(e: any, porDefecto: string): Promise<string> {
  try {
    if (e?.error instanceof Blob) return JSON.parse(await e.error.text())?.error ?? porDefecto;
  } catch { /* no era JSON */ }
  return e?.error?.error ?? porDefecto;
}
