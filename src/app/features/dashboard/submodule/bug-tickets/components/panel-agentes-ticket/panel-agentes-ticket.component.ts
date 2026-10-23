import {
  ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked,
} from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom } from 'rxjs';
import Swal from 'sweetalert2';
import { obtenerUsuarioActual } from '@/app/core/utils/usuario-actual';
import { BugTicket, TicketsService } from '../../services/tickets.service';
import {
  AccionSoporte, CasoSoporte, FaseSoporte, ResolucionSoporte, SoporteAgentesService,
} from '../../services/soporte-agentes.service';
import { getLocalStorageItem } from '@/app/core/utils/safe-storage';

const FASES: Record<FaseSoporte, { etiqueta: string; icono: string; tono: string }> = {
  triaje: { etiqueta: 'Analizando', icono: 'manage_search', tono: 'curso' },
  esperando_autorizacion: { etiqueta: 'Espera autorización', icono: 'how_to_reg', tono: 'ojo' },
  resolviendo: { etiqueta: 'Agentes resolviendo', icono: 'smart_toy', tono: 'curso' },
  solucion_lista: { etiqueta: 'Solución lista para revisar', icono: 'task_alt', tono: 'bien' },
  para_desarrollador: { etiqueta: 'Para un desarrollador', icono: 'engineering', tono: 'dev' },
  descartado: { etiqueta: 'Descartado', icono: 'block', tono: 'neutro' },
};

/**
 * Panel "Resolver con agentes" del detalle de un ticket.
 *
 * Elige quien lo resuelve (automatico, agentes o desarrollador). Siempre hay un triaje
 * primero: los agentes leen el ticket y el codigo, hacen el plan y proyectan cuanto
 * costaria. Si no compensa o no deben (base de datos, despliegue, riesgo alto, por
 * encima del tope), el plan queda para el desarrollador. Las propuestas de mejora las
 * autoriza siempre un desarrollador. Los agentes nunca despliegan: dejan commits para
 * revisar.
 */
@Component({
  selector: 'app-panel-agentes-ticket',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule, MatButtonModule, MatProgressSpinnerModule, DatePipe, DecimalPipe],
  templateUrl: './panel-agentes-ticket.component.html',
  styleUrl: './panel-agentes-ticket.component.css',
})
export class PanelAgentesTicketComponent {
  private readonly svc = inject(SoporteAgentesService);
  private readonly tickets = inject(TicketsService);

  readonly ticket = input.required<BugTicket>();

  /** null = sin acceso al pool (no ADMIN o puente caido): el panel no se pinta. */
  readonly disponible = signal<boolean | null>(null);
  readonly caso = signal<CasoSoporte | null>(null);
  readonly cargando = signal(false);
  readonly trabajando = signal(false);
  readonly verPlan = signal(false);
  resolucion: ResolucionSoporte = 'auto';

  readonly fase = computed(() => {
    const c = this.caso();
    return c ? FASES[c.fase] : null;
  });
  readonly enMarcha = computed(() => ['triaje', 'resolviendo'].includes(this.caso()?.fase ?? ''));

  private sondeo: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Al cambiar de ticket se mira si ya tiene caso. untracked: la peticion HTTP no
    // debe registrar dependencias del effect (ver la tormenta de 429 de sep-2026).
    effect(() => {
      const t = this.ticket();
      untracked(() => this.cargar(t.id));
    });
    inject(DestroyRef).onDestroy(() => this.pararSondeo());
  }

  private async cargar(ticketId: string): Promise<void> {
    this.pararSondeo();
    this.cargando.set(true);
    try {
      const casos = await firstValueFrom(this.svc.casosDeTicket(ticketId));
      this.disponible.set(true);
      this.caso.set(casos[0] ?? null);
      this.ajustarSondeo();
    } catch {
      this.disponible.set(false);
      this.caso.set(null);
    } finally {
      this.cargando.set(false);
    }
  }

  /** Mientras los agentes trabajan, se refresca solo cada 15 s. */
  private ajustarSondeo(): void {
    if (!this.enMarcha()) return this.pararSondeo();
    if (this.sondeo) return;
    this.sondeo = setInterval(async () => {
      const c = this.caso();
      if (!c) return this.pararSondeo();
      try {
        this.caso.set(await firstValueFrom(this.svc.caso(c.id)));
        this.ajustarSondeo();
      } catch { /* el siguiente sondeo lo reintenta */ }
    }, 15_000);
  }

  private pararSondeo(): void {
    if (this.sondeo) { clearInterval(this.sondeo); this.sondeo = null; }
  }

  async enviar(): Promise<void> {
    this.trabajando.set(true);
    try {
      const c = await firstValueFrom(this.svc.abrir(this.ticket(), this.resolucion));
      this.caso.set(c);
      this.ajustarSondeo();
      const quien = { auto: 'los agentes deciden', agentes: 'agentes', desarrollador: 'desarrollador' }[this.resolucion];
      this.comentar(`Enviado al pool de agentes (resolución: ${quien}). Primero analizan el ticket y hacen el plan.`);
    } catch (e: any) {
      Swal.fire('No se pudo enviar', e?.error?.error || e?.message || 'El servicio de agentes no respondió.', 'error');
    } finally {
      this.trabajando.set(false);
    }
  }

  async hacer(accion: AccionSoporte): Promise<void> {
    const c = this.caso();
    if (!c) return;
    const textos: Record<AccionSoporte, { titulo: string; texto: string; boton: string }> = {
      autorizar: { titulo: '¿Autorizar a los agentes?', texto: 'Lo resuelven en su copia aislada siguiendo el plan y dejan un commit para que lo revises. No despliegan nada.', boton: 'Autorizar' },
      tomar: { titulo: '¿Lo resuelves tú?', texto: 'Si los agentes están trabajando en él, se detienen. Te quedas con el plan.', boton: 'Lo tomo yo' },
      descartar: { titulo: '¿Descartar?', texto: 'No se hará. Queda anotado en el ticket.', boton: 'Descartar' },
      repetir: { titulo: '¿Repetir el análisis?', texto: 'Útil si el ticket se aclaró con nuevos comentarios.', boton: 'Repetir' },
    };
    const t = textos[accion];
    const r = await Swal.fire({
      title: t.titulo, text: t.texto, icon: 'question', showCancelButton: true,
      confirmButtonText: t.boton, cancelButtonText: 'Cancelar',
      input: 'text', inputPlaceholder: 'Nota (opcional)',
    });
    if (!r.isConfirmed) return;
    this.trabajando.set(true);
    try {
      const nuevo = await firstValueFrom(this.svc.accion(c.id, accion, this.usuario(), r.value || undefined));
      this.caso.set(nuevo);
      this.ajustarSondeo();
      const verbo = { autorizar: 'autorizó a los agentes', tomar: 'tomó el ticket', descartar: 'descartó la propuesta', repetir: 'pidió repetir el análisis' }[accion];
      this.comentar(`${this.usuario()} ${verbo}.${r.value ? ` Nota: ${r.value}` : ''}`);
      if (accion === 'tomar') {
        // El ticket queda a cargo del usuario en sesión (por id; el nombre es solo la foto).
        this.tickets.asignarTicket(this.ticket().id, obtenerUsuarioActual().id || null, this.usuario()).subscribe({ error: () => undefined });
      }
    } catch (e: any) {
      Swal.fire('No se pudo', e?.error?.error || e?.message || 'Error', 'error');
    } finally {
      this.trabajando.set(false);
    }
  }

  /** Deja rastro en la conversacion del ticket: quien decidio que y cuando. */
  private comentar(mensaje: string): void {
    this.tickets.agregarComentario(this.ticket().id, `[Agentes] ${mensaje}`).subscribe({ error: () => undefined });
  }

  private usuario(): string {
    try {
      const u = JSON.parse(getLocalStorageItem('user') || '{}');
      return [u?.datos_basicos?.nombres, u?.datos_basicos?.apellidos].filter(Boolean).join(' ')
        || u?.numero_de_documento || 'desarrollador';
    } catch { return 'desarrollador'; }
  }

  etiquetaFase(f: FaseSoporte): string { return FASES[f]?.etiqueta ?? f; }
}
