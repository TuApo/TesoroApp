import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ReunionesService } from '../../services/reuniones.service';
import {
  ETAPA_HUMANA, Grabacion, Nota, Participante, ReunionDetalle, TipoParticipante,
} from '../../models/reunion.model';
import { CapturaAudioComponent } from '../captura-audio/captura-audio.component';
import { claveDePersona } from '../../utils/hablantes';
import { enCurso } from '../../utils/estado';
import { mensajeError } from '../../utils/texto';
import { duracionHumana, fechaCorta, fechaHora, reloj } from '../../utils/tiempo';

export const TIPO_PARTICIPANTE_LABEL: Record<TipoParticipante, string> = {
  SOLICITANTE: 'Solicitante',
  USUARIO_FUNCIONAL: 'Usuario funcional',
  ANALISTA_FUNCIONAL: 'Analista funcional',
  DESARROLLADOR: 'Desarrollador',
  LIDER_TECNICO: 'Líder técnico',
  PRODUCT_OWNER: 'Product owner',
  ADMINISTRADOR: 'Administrador',
  INVITADO: 'Invitado',
  PROVEEDOR: 'Proveedor',
  CLIENTE: 'Cliente',
  OTRO: 'Otro',
};

/** "LEVANTAMIENTO" → "Levantamiento", "REVISION_TECNICA" → "Revision tecnica". */
export function legible(codigo: string | null | undefined): string {
  if (!codigo) return '';
  const t = codigo.replace(/_/g, ' ').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Pestaña Detalles: lo administrativo de la reunión (datos, participantes, notas y
 * grabaciones). Queda en segundo plano a propósito: lo primero es lo que se habló.
 */
@Component({
  selector: 'app-reu-detalles',
  standalone: true,
  imports: [RouterLink, MatIconModule, MatTooltipModule, CapturaAudioComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './detalles-reunion.component.html',
  styleUrls: ['../../estilos/base.css', './detalles-reunion.component.css'],
})
export class DetallesReunionComponent {
  private readonly api = inject(ReunionesService);

  readonly detalle = input.required<ReunionDetalle>();
  readonly grabaciones = input<Grabacion[]>([]);
  readonly posicionMs = input(0);

  /** Cambiaron participantes: la ficha recarga (afecta a "¿Quién es?"). */
  readonly cambio = output<void>();
  readonly grabacionCreada = output<string>();
  readonly saltar = output<number>();

  readonly error = signal('');

  // Participantes
  readonly nuevo = signal<Partial<Participante>>({ participant_type: 'USUARIO_FUNCIONAL' });
  readonly agregando = signal(false);
  readonly TIPOS = Object.keys(TIPO_PARTICIPANTE_LABEL) as TipoParticipante[];
  readonly TIPO_LABEL = TIPO_PARTICIPANTE_LABEL;

  // Notas
  readonly notas = signal<Nota[]>([]);
  readonly cargandoNotas = signal(true);
  readonly textoNota = signal('');
  readonly anclarNota = signal(true);
  readonly guardandoNota = signal(false);

  readonly reloj = reloj;
  readonly fechaCorta = fechaCorta;
  readonly fechaHora = fechaHora;
  readonly duracionHumana = duracionHumana;
  readonly legible = legible;

  readonly datos = computed(() => {
    const d = this.detalle();
    const r = d.resumen;
    const filas: { etiqueta: string; valor: string }[] = [
      { etiqueta: 'Tipo', valor: legible(r.meeting_type) },
      { etiqueta: 'Modalidad', valor: legible(r.modality) },
      { etiqueta: 'Fecha', valor: fechaCorta(r.held_on) },
      { etiqueta: 'Hora', valor: r.started_at_time?.slice(0, 5) ?? '' },
      { etiqueta: 'Duración prevista', valor: r.duration_min ? `${r.duration_min} min` : '' },
      { etiqueta: 'Sistema', valor: r.system_name ?? '' },
      { etiqueta: 'Módulo', valor: r.module_name ?? '' },
      { etiqueta: 'Área solicitante', valor: d.requesting_area ?? '' },
      { etiqueta: 'Lugar', valor: d.location ?? '' },
      { etiqueta: 'Confidencialidad', valor: r.confidentiality === 'RESTRINGIDA' ? 'Restringida' : 'Interna' },
    ];
    return filas.filter(f => f.valor);
  });

  /** Sólo el id: recargar participantes no debe volver a pedir las notas. */
  private readonly reunionId = computed(() => this.detalle().resumen.id);

  constructor() {
    effect(() => {
      const id = this.reunionId();
      untracked(() => this.cargarNotas(id));
    });
  }

  /** Clave de persona que manda el backend (null con un backend viejo: sin enlace). */
  clave(p: Participante): string | null { return claveDePersona(p); }
  cargoDe(p: Participante): string { return [p.position, p.area].filter(Boolean).join(' · '); }
  etapa(g: Grabacion): string { return ETAPA_HUMANA[g.status] ?? g.status; }
  enCurso(g: Grabacion): boolean { return enCurso(g.status); }

  pesoLegible(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const unidades = ['KB', 'MB', 'GB'];
    let valor = bytes / 1024;
    let i = 0;
    while (valor >= 1024 && i < unidades.length - 1) { valor /= 1024; i++; }
    return `${valor.toFixed(valor < 10 ? 1 : 0).replace('.', ',')} ${unidades[i]}`;
  }

  // ── Participantes ─────────────────────────────────────────────────────────

  actualizarNuevo<K extends keyof Participante>(campo: K, valor: Participante[K]): void {
    this.nuevo.update(p => ({ ...p, [campo]: valor }));
  }

  agregarParticipante(): void {
    const p = this.nuevo();
    if (!p.first_name?.trim() && !p.email?.trim()) {
      this.error.set('Escribe al menos el nombre o el correo del participante.');
      return;
    }
    this.agregando.set(true);
    this.error.set('');
    this.api.agregarParticipante(this.detalle().resumen.id, p).subscribe({
      next: () => {
        this.agregando.set(false);
        this.nuevo.set({ participant_type: 'USUARIO_FUNCIONAL' });
        this.cambio.emit();
      },
      error: (e) => {
        this.agregando.set(false);
        this.error.set(mensajeError(e, 'No se pudo agregar el participante'));
      },
    });
  }

  quitarParticipante(p: Participante): void {
    this.api.quitarParticipante(this.detalle().resumen.id, p.id).subscribe({
      next: () => this.cambio.emit(),
      error: (e) => this.error.set(mensajeError(e, 'No se pudo quitar el participante')),
    });
  }

  // ── Notas ─────────────────────────────────────────────────────────────────

  private cargarNotas(id: string): void {
    this.cargandoNotas.set(true);
    this.api.notas(id).subscribe({
      next: (n) => { this.notas.set(n); this.cargandoNotas.set(false); },
      error: () => { this.notas.set([]); this.cargandoNotas.set(false); },
    });
  }

  agregarNota(): void {
    const body = this.textoNota().trim();
    if (!body) return;
    this.guardandoNota.set(true);
    this.error.set('');
    const atMs = this.anclarNota() && this.posicionMs() > 0 ? this.posicionMs() : null;
    this.api.agregarNota(this.detalle().resumen.id, { at_ms: atMs, body }).subscribe({
      next: (n) => {
        this.guardandoNota.set(false);
        this.textoNota.set('');
        this.notas.update(ns => [...ns, n]);
      },
      error: (e) => {
        this.guardandoNota.set(false);
        this.error.set(mensajeError(e, 'No se pudo guardar la nota'));
      },
    });
  }
}
