import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { TicketDetalle, TicketFila, TiendaService } from '../../../dashboard/submodule/tienda/service/tienda.service';
import { EconomiaStore } from '../../economia.store';
import { mensajeError, usuarioEnSesion } from '../../economia.util';

const AREAS = [
  { codigo: 'TIENDA', nombre: 'Mi pedido o la tienda', icono: 'storefront', ayuda: 'Pedido incompleto, equivocado, demorado o atención en el punto' },
  { codigo: 'PRODUCTO', nombre: 'Un producto', icono: 'devices', ayuda: 'Llegó dañado, garantía, cambio o devolución' },
  { codigo: 'PAGOS', nombre: 'Pagos y bono mercado', icono: 'payments', ayuda: 'Cobros, descuentos de nómina, reembolsos' },
  { codigo: 'REPARTIDOR', nombre: 'El domicilio', icono: 'two_wheeler', ayuda: 'No llegó, llegó a otro lado, trato del repartidor' },
  { codigo: 'PLATAFORMA', nombre: 'La aplicación', icono: 'phone_iphone', ayuda: 'Errores, acceso, notificaciones o sugerencias' },
];
const ESTADO: Record<string, { texto: string; tono: string }> = {
  ABIERTO: { texto: 'Recibida', tono: 'aviso' }, EN_PROCESO: { texto: 'En proceso', tono: 'info' },
  ESPERANDO_CLIENTE: { texto: 'Esperando su respuesta', tono: 'accion' }, RESUELTO: { texto: 'Resuelta', tono: 'ok' },
  CERRADO: { texto: 'Cerrada', tono: 'neutro' },
};

/**
 * "Mis solicitudes": lo que la persona reportó (ella o MatIA por ella), con la
 * conversación con soporte. Lo más rápido sigue siendo contarle a MatIA; el formulario
 * es para quien prefiere escribir directo.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'eco-soporte',
  imports: [MatIconModule, RouterLink, DatePipe, FormsModule],
  templateUrl: './soporte.html',
  styleUrls: ['../../economiapp.css', './soporte.css'],
})
export class EconomiaSoporte {
  readonly store = inject(EconomiaStore);
  private api = inject(TiendaService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  /** /economiapp/soporte/:id abre la conversación. */
  readonly id = input<string | undefined>();

  readonly AREAS = AREAS;
  readonly ESTADO = ESTADO;
  readonly tickets = signal<TicketFila[]>([]);
  readonly ticket = signal<TicketDetalle | null>(null);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly enviando = signal(false);
  readonly respuesta = signal('');

  // Formulario
  readonly nuevo = signal(false);
  readonly area = signal<string | null>(null);
  readonly asunto = signal('');
  readonly descripcion = signal('');
  readonly pedidoId = signal<string | null>(null);

  readonly pedidos = computed(() => this.store.misPedidos().slice(0, 10));
  readonly puedeEnviar = computed(() => !!this.area() && this.asunto().trim().length >= 4 && this.descripcion().trim().length >= 10 && !this.enviando());

  constructor() {
    const q = this.route.snapshot.queryParamMap;
    if (q.get('pedido')) { this.pedidoId.set(q.get('pedido')); this.nuevo.set(true); }
    effect(() => {
      const id = this.id();
      untracked(() => id ? this.abrir(id) : this.cargar());
    });
    this.store.cargarPedidos();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true); this.ticket.set(null);
    try { this.tickets.set(await firstValueFrom(this.api.misTickets())); this.error.set(null); }
    catch (e) { this.error.set(mensajeError(e, 'No pudimos cargar sus solicitudes')); }
    finally { this.cargando.set(false); }
  }

  async abrir(id: string): Promise<void> {
    this.cargando.set(true);
    try { this.ticket.set(await firstValueFrom(this.api.miTicket(id))); this.error.set(null); }
    catch (e) { this.error.set(mensajeError(e, 'No encontramos esa solicitud')); }
    finally { this.cargando.set(false); }
  }

  async enviar(): Promise<void> {
    if (!this.puedeEnviar()) return;
    this.enviando.set(true);
    const u = usuarioEnSesion();
    try {
      const r = await firstValueFrom(this.api.abrirTicket({
        area: this.area()!, asunto: this.asunto().trim(), descripcion: this.descripcion().trim(),
        pedido_id: this.pedidoId(), nombre: u.nombre || null, telefono: u.telefono || null,
      }));
      this.store.avisar(r.duplicado ? `Agregamos su mensaje a la solicitud ${r.numero}` : `Solicitud ${r.numero} recibida. Le avisaremos por notificación.`, 'ok');
      this.nuevo.set(false); this.area.set(null); this.asunto.set(''); this.descripcion.set(''); this.pedidoId.set(null);
      this.router.navigate(['/economiapp/soporte', r.id]);
    } catch (e) { this.store.avisar(mensajeError(e, 'No se pudo enviar'), 'error'); }
    finally { this.enviando.set(false); }
  }

  async responder(): Promise<void> {
    const t = this.ticket(); const texto = this.respuesta().trim();
    if (!t || !texto) return;
    this.enviando.set(true);
    try { this.ticket.set(await firstValueFrom(this.api.responderMiTicket(t.id, texto, usuarioEnSesion().nombre || null))); this.respuesta.set(''); }
    catch (e) { this.store.avisar(mensajeError(e, 'No se pudo enviar'), 'error'); }
    finally { this.enviando.set(false); }
  }

  async calificar(n: number): Promise<void> {
    const t = this.ticket(); if (!t) return;
    try { await firstValueFrom(this.api.calificarTicket(t.id, n)); this.store.avisar('¡Gracias por calificar!', 'ok'); this.abrir(t.id); }
    catch (e) { this.store.avisar(mensajeError(e, 'No se pudo calificar'), 'error'); }
  }

  areaDe(c: string) { return AREAS.find(a => a.codigo === c); }
}
