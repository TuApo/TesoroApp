import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { HablanteInsight, Participante } from '../../models/reunion.model';
import { AvatarHablanteComponent } from '../avatar-hablante/avatar-hablante.component';
import { claveDePersona, colorIdxDe, colorVar, participanteDeSugerencia } from '../../utils/hablantes';
import { duracionHumana, porcentaje, reloj } from '../../utils/tiempo';

type Identidad = 'confirmada' | 'por-confirmar' | 'sugerida' | 'desconocida';

interface FilaHablante {
  h: HablanteInsight;
  color: number;
  identidad: Identidad;
  /** Participante que coincide con la sugerencia de la IA (exactamente uno), si lo hay. */
  coincide: Participante | null;
  /** Participante asignado. */
  participante: Participante | null;
  /** Clave de persona que manda el backend (hablante o participante), para enlazar a su ficha. */
  clave: string | null;
  rol: string | null;
}

/**
 * "Quién habló": cada voz con su color, su tiempo y su identidad. Aquí se responde
 * "¿quién es Persona 2?": eligiendo un participante, aceptando lo que dedujo la IA (con
 * la cita en la que la persona se presentó) o creando el participante desde esa
 * sugerencia. Clic en la persona = ver sólo lo que dijo.
 *
 * No llama a la API: emite y la ficha decide, para que todo recargue en un solo lugar.
 */
@Component({
  selector: 'app-reu-hablantes',
  standalone: true,
  imports: [RouterLink, MatIconModule, MatTooltipModule, AvatarHablanteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './panel-hablantes.component.html',
  styleUrls: ['../../estilos/base.css', './panel-hablantes.component.css'],
})
export class PanelHablantesComponent {
  readonly hablantes = input<HablanteInsight[]>([]);
  readonly participantes = input<Participante[]>([]);
  readonly filtro = input<string[]>([]);
  /** Id del hablante con una operación en curso (deshabilita sus botones). */
  readonly ocupado = input<string | null>(null);
  readonly diarizacion = input<string | null>(null);
  readonly hablandoAhora = input<string | null>(null);

  readonly alternarFiltro = output<string>();
  readonly limpiarFiltro = output<void>();
  readonly asignar = output<{ hablanteId: string; participanteId: string | null }>();
  readonly confirmar = output<string>();
  readonly crearDesdeSugerencia = output<string>();
  readonly saltar = output<number>();
  readonly gestionarParticipantes = output<void>();

  /** Hablante cuyo selector de participante está abierto. */
  readonly eligiendo = signal<string | null>(null);

  readonly filas = computed<FilaHablante[]>(() => {
    const ps = this.participantes();
    return this.hablantes().map((h, i) => {
      const participante = h.participant_id ? ps.find(p => p.id === h.participant_id) ?? null : null;
      const identidad: Identidad = h.participant_id
        ? (h.participant_source === 'IA' ? 'por-confirmar' : 'confirmada')
        : (h.suggested_name ? 'sugerida' : 'desconocida');
      return {
        h,
        color: colorIdxDe(h, i),
        identidad,
        coincide: identidad === 'sugerida' ? participanteDeSugerencia(h.suggested_name, ps) : null,
        participante,
        clave: h.participant_id ? claveDePersona(h, participante) : null,
        rol: participante
          ? [participante.position, participante.area].filter(Boolean).join(' · ') || null
          : h.suggested_role,
      };
    });
  });

  readonly sinConfirmar = computed(() => this.filas().filter(f => f.identidad !== 'confirmada').length);

  readonly avisoSeparacion = computed(() => {
    switch (this.diarizacion()) {
      case 'pauses': return 'Las voces se separaron por las pausas: puede haber frases asignadas a quien no era. Corrige la identidad de cada una.';
      case 'none': return 'Esta grabación no trae voces separadas: todo aparece como una sola persona.';
      case 'model-blocks': return 'La reunión era muy larga y se procesó por bloques: una misma persona puede aparecer con dos etiquetas.';
      default: return null;
    }
  });

  readonly colorVar = colorVar;
  readonly duracionHumana = duracionHumana;
  readonly porcentaje = porcentaje;
  readonly reloj = reloj;

  enFiltro(id: string): boolean { return this.filtro().includes(id); }

  abrirSelector(id: string): void { this.eligiendo.set(this.eligiendo() === id ? null : id); }

  elegir(hablanteId: string, valor: string): void {
    this.eligiendo.set(null);
    this.asignar.emit({ hablanteId, participanteId: valor || null });
  }
}
