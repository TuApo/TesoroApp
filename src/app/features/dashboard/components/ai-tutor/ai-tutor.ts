import { Component, ChangeDetectionStrategy, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import {
  TutorIaService, ReferenciaTutor
} from '../../submodule/training/service/tutor-ia.service';

/**
 * Botón flotante del tutor de capacitaciones.
 *
 * **Por qué es global y no vive dentro del reproductor.** La pregunta llega cuando llega: en
 * medio de una tarea, revisando un pago, antes de entrar a una finca. Encerrarlo en el
 * reproductor obligaría a acordarse de abrir el curso para poder preguntar por el curso.
 *
 * **Por qué se pregunta antes por la disponibilidad.** Un botón de tutor que solo sabe
 * responder "no encontré nada" es peor que no tenerlo: enseña a la gente a ignorarlo. Si la
 * persona no tiene cursos con material transcrito —o la IA no está configurada en este
 * entorno— este componente no pinta absolutamente nada.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-ai-tutor',
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './ai-tutor.html',
  styleUrl: './ai-tutor.css'
})
export class AiTutor implements OnInit {
  private api = inject(TutorIaService);
  private router = inject(Router);

  readonly disponible = signal(false);
  readonly abierto = signal(false);
  readonly pensando = signal(false);
  readonly pregunta = signal('');
  readonly turnos = signal<Turno[]>([]);

  /** Qué está viendo la persona, si es que está viendo algo. Lo publica el reproductor. */
  readonly contexto = this.api.contexto;

  readonly puedeEnviar = computed(() =>
    this.pregunta().trim().length > 2 && !this.pensando());

  async ngOnInit(): Promise<void> {
    try {
      this.disponible.set((await this.api.disponibilidad()).disponible);
    } catch {
      // Sin capacitaciones en este entorno, o sin sesión todavía: el botón no aparece y ya.
      this.disponible.set(false);
    }
  }

  alternar(): void {
    this.abierto.update(v => !v);
  }

  async enviar(): Promise<void> {
    const texto = this.pregunta().trim();
    if (!this.puedeEnviar()) return;

    this.pregunta.set('');
    this.turnos.update(t => [...t, { rol: 'yo', texto }]);
    this.pensando.set(true);
    try {
      const r = await this.api.preguntar(texto, this.contexto());
      this.turnos.update(t => [...t, {
        rol: 'tutor', texto: r.respuesta, referencias: r.referencias ?? []
      }]);
    } catch {
      this.turnos.update(t => [...t, {
        rol: 'tutor',
        texto: 'No pude consultar el material ahora mismo. Revisa tu conexión e inténtalo otra vez.',
        referencias: []
      }]);
    } finally {
      this.pensando.set(false);
    }
  }

  /** Enter envía; Shift+Enter hace salto de línea, como en cualquier chat. */
  alTeclear(evento: KeyboardEvent): void {
    if (evento.key === 'Enter' && !evento.shiftKey) {
      evento.preventDefault();
      void this.enviar();
    }
  }

  /**
   * Lleva a la persona al punto exacto del vídeo.
   *
   * Si hay matrícula va al reproductor con la lección y el segundo en la URL —así el enlace
   * también funciona pegado o recargado—. Sin matrícula (administración) lleva a la consola
   * del curso, que es donde esa persona sí puede abrir el material.
   */
  async ir(ref: ReferenciaTutor): Promise<void> {
    this.abierto.set(false);
    if (ref.enrollment_id) {
      await this.router.navigate(['/dashboard/capacitaciones', ref.enrollment_id], {
        queryParams: { leccion: ref.lesson_id, t: ref.segundos ?? 0 }
      });
      return;
    }
    await this.router.navigate(['/dashboard/capacitaciones/catalogo', ref.course_id]);
  }

  minuto(segundos?: number | null): string {
    const s = Math.max(0, Math.floor(segundos ?? 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  limpiar(): void {
    this.turnos.set([]);
  }
}

interface Turno {
  rol: 'yo' | 'tutor';
  texto: string;
  referencias?: ReferenciaTutor[];
}
