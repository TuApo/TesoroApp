import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ReunionesService } from '../../services/reuniones.service';
import { AcuerdoDePersona, EstadoAcuerdo, FichaPersona } from '../../models/reunion.model';
import { AvatarHablanteComponent } from '../../components/avatar-hablante/avatar-hablante.component';
import { cuerpoDe, ordenEstado } from '../../utils/acuerdos';
import { etiquetaEstadoReunion } from '../../utils/estado';
import { colorVar, idxDeClave } from '../../utils/hablantes';
import { mensajeError } from '../../utils/texto';
import { duracionHumana, fechaCorta, marcaDeTiempo, porcentaje, reloj } from '../../utils/tiempo';

/**
 * Ficha de una persona a través de todas las reuniones: dónde habló y qué aportó en
 * cada una, qué compromisos quedaron a su cargo, qué decisiones planteó y sus frases,
 * todo con salto al minuto exacto de la grabación.
 */
@Component({
  selector: 'app-persona-detail',
  standalone: true,
  imports: [RouterLink, MatIconModule, MatTooltipModule, AvatarHablanteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './persona-detail.component.html',
  styleUrls: ['../../estilos/paleta-hablantes.css', '../../estilos/base.css', './persona-detail.component.css'],
})
export class PersonaDetailComponent {
  private readonly api = inject(ReunionesService);

  /** Parámetro de ruta `personas/:key` (withComponentInputBinding). */
  readonly key = input<string>('');

  readonly ficha = signal<FichaPersona | null>(null);
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly errorAccion = signal('');
  readonly ocupado = signal<string | null>(null);

  readonly reloj = reloj;
  readonly fechaCorta = fechaCorta;
  readonly duracionHumana = duracionHumana;
  readonly porcentaje = porcentaje;
  readonly etiquetaEstado = etiquetaEstadoReunion;

  readonly colorIdx = computed(() => idxDeClave(this.key()));
  readonly color = computed(() => colorVar(this.colorIdx()));

  readonly cargo = computed(() => {
    const p = this.ficha()?.person;
    return p ? [p.position, p.area, p.company].filter(Boolean).join(' · ') : '';
  });

  readonly reuniones = computed(() => {
    const ms = this.ficha()?.meetings ?? [];
    // held_on puede llegar como [2026, 9, 27] (ver FechaApi): se ordena por marca de tiempo.
    return [...ms].sort((a, b) => marcaDeTiempo(b.held_on) - marcaDeTiempo(a.held_on));
  });

  readonly compromisos = computed(() =>
    [...(this.ficha()?.commitments ?? [])].sort((a, b) =>
      ordenEstado(a.status) - ordenEstado(b.status) || (a.meeting_name ?? '').localeCompare(b.meeting_name ?? '')));

  readonly decisiones = computed(() => this.ficha()?.decisions ?? []);
  readonly citas = computed(() => this.ficha()?.quotes ?? []);
  readonly abiertos = computed(() => this.compromisos().filter(c => c.status === 'ABIERTO').length);

  constructor() {
    effect(() => {
      const k = this.key();
      untracked(() => this.cargar(k));
    });
  }

  cargar(clave = this.key()): void {
    if (!clave) { this.cargando.set(false); this.error.set('Falta indicar la persona.'); return; }
    this.cargando.set(true);
    this.error.set('');
    this.api.persona(clave).subscribe({
      next: (f) => {
        this.ficha.set({
          ...f,
          meetings: f.meetings ?? [],
          commitments: f.commitments ?? [],
          decisions: f.decisions ?? [],
          quotes: f.quotes ?? [],
        });
        this.cargando.set(false);
      },
      error: (e) => {
        this.ficha.set(null);
        this.cargando.set(false);
        this.error.set((e as { status?: number })?.status === 404
          ? 'No encontramos a esta persona en las reuniones que puedes ver.'
          : mensajeError(e, 'No se pudo cargar la ficha de la persona'));
      },
    });
  }

  alternarHecho(c: AcuerdoDePersona): void {
    const status: EstadoAcuerdo = c.status === 'HECHO' ? 'ABIERTO' : 'HECHO';
    this.ocupado.set(c.id);
    this.errorAccion.set('');
    this.api.actualizarAcuerdo(c.id, cuerpoDe(c, { status })).subscribe({
      next: (a) => {
        this.ocupado.set(null);
        this.ficha.update(f => f ? {
          ...f,
          commitments: f.commitments.map(x => (x.id === c.id ? { ...x, ...a, meeting_id: x.meeting_id, meeting_name: x.meeting_name } : x)),
        } : f);
      },
      error: (e) => {
        this.ocupado.set(null);
        this.errorAccion.set(mensajeError(e, 'No se pudo cambiar el compromiso'));
      },
    });
  }
}
