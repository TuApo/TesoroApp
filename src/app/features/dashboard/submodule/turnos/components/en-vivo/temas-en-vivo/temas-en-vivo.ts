import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { AnalisisConversacion, TemaConversacion, TipoTema } from '../../../service/turnos.service';
import { moduloPorClave } from '../../ventanas-flotantes/modulos';
import { Nombres, formatoTiempo, hayDiferencia } from '../en-vivo.util';

const TIPOS: Record<TipoTema, { etiqueta: string; icono: string }> = {
  DATO: { etiqueta: 'Dato', icono: 'badge' },
  TRAMITE: { etiqueta: 'Trámite', icono: 'assignment' },
  ALERTA: { etiqueta: 'Alerta', icono: 'warning' },
  PREGUNTA: { etiqueta: 'Pregunta', icono: 'help' },
};

/**
 * Temas de la conversación en vivo: lo que salió de lo hablado cruzado con los datos de la
 * persona. Cada tarjeta dice qué es, qué hay en la ficha frente a lo que se dijo, la cita con
 * su minuto (lleva a la frase) y, si toca, el botón que abre el módulo en ventana flotante.
 */
@Component({
  selector: 'app-temas-en-vivo',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './temas-en-vivo.html',
  styleUrl: './temas-en-vivo.css',
})
export class TemasEnVivo {
  readonly analisis = input<AnalisisConversacion | null>(null);
  readonly cargando = input(false);
  readonly error = input<string | null>(null);
  readonly nombres = input<Nombres>({ ASESOR: 'Asesor', PERSONA: 'Persona' });
  /** La transcripción está corriendo (los temas se actualizan solos). */
  readonly enVivo = input(false);
  /** Frases confirmadas hasta ahora. */
  readonly frases = input(0);
  /** Frases que aún no ha visto la IA. */
  readonly nuevas = input(0);
  /** Hora del reloj compartido (para "hace 12 s"). */
  readonly ahora = input(Date.now());
  /** Módulos que este usuario puede abrir. */
  readonly permitidos = input<ReadonlySet<string> | null>(null);

  readonly actualizar = output<void>();
  readonly abrirModulo = output<TemaConversacion>();
  readonly irACita = output<TemaConversacion>();

  readonly formato = formatoTiempo;
  readonly diferencia = hayDiferencia;

  readonly temas = computed(() => this.analisis()?.temas ?? []);
  readonly hace = computed(() => {
    const iso = this.analisis()?.actualizado_en;
    if (!iso) return null;
    const t = new Date(iso).getTime();
    if (isNaN(t)) return null;
    const s = Math.max(0, Math.round((this.ahora() - t) / 1000));
    return s < 10 ? 'justo ahora' : s < 60 ? `hace ${s} s` : s < 3600 ? `hace ${Math.floor(s / 60)} min` : new Date(t).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  });

  modulo(t: TemaConversacion) { return moduloPorClave(t.modulo); }

  /** El backend valida el tipo, pero si llegara uno nuevo se pinta como dato. */
  tipoDe(t: TemaConversacion): { etiqueta: string; icono: string } {
    return (TIPOS as Record<string, { etiqueta: string; icono: string }>)[t.tipo] ?? TIPOS.DATO;
  }

  puedeAbrir(t: TemaConversacion): boolean {
    const p = this.permitidos();
    return !!t.modulo && (!p || p.has(t.modulo));
  }

  quien(t: TemaConversacion): string {
    return t.hablante === 'ASESOR' ? this.nombres().ASESOR : t.hablante === 'PERSONA' ? this.nombres().PERSONA : '';
  }
}
