import { Component, ChangeDetectionStrategy, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import {
  TutorIaService, ReferenciaTutor
} from '../../submodule/training/service/tutor-ia.service';

/**
 * Botón flotante del tutor de capacitaciones.
 *
 * **Cuelga del shell pero solo se pinta en Capacitaciones.** Vive en el shell porque el panel
 * tiene que sobrevivir a moverse entre el catálogo, una lección y los certificados sin perder
 * la conversación; se acota a ese módulo porque un botón flotante encima de la nómina o de la
 * lista de trabajadores no es una ayuda, es algo que tapa una fila.
 *
 * **Dos condiciones, y las dos hacen falta.** `disponible` dice si el tutor SABE responder
 * —hay material transcrito y la IA está configurada—; `enCapacitaciones` dice si TOCA
 * ofrecerlo. Un botón que solo sabe responder "no encontré nada" enseña a la gente a
 * ignorarlo, y uno que aparece donde no viene a cuento, también.
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

  /** El tutor sabe responder: hay material transcrito y la IA está configurada. */
  readonly disponible = signal(false);
  /** Estamos dentro de Capacitaciones, que es donde toca ofrecerlo. */
  readonly enCapacitaciones = signal(false);
  readonly abierto = signal(false);
  readonly pensando = signal(false);
  readonly pregunta = signal('');
  readonly turnos = signal<Turno[]>([]);

  /** Qué está viendo la persona, si es que está viendo algo. Lo publica el reproductor. */
  readonly contexto = this.api.contexto;

  /** Lo único que decide si esto se pinta. Las dos condiciones, no una. */
  readonly visible = computed(() => this.disponible() && this.enCapacitaciones());

  readonly puedeEnviar = computed(() =>
    this.pregunta().trim().length > 2 && !this.pensando());

  constructor() {
    this.enCapacitaciones.set(esDeCapacitaciones(this.router.url));
    // El componente vive lo que vive el shell, así que hay que seguir la navegación: sin
    // esto se quedaría con el módulo en el que se cargó la aplicación.
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      takeUntilDestroyed(),
    ).subscribe(e => {
      const dentro = esDeCapacitaciones(e.urlAfterRedirects);
      this.enCapacitaciones.set(dentro);
      // Al salir del módulo se cierra el panel. Si no, al volver aparecería abierto sobre
      // una conversación de hace media hora, que ya no viene a cuento.
      if (!dentro) this.abierto.set(false);
    });
  }

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

/** La raíz del módulo de capacitaciones. Todo lo que cuelga de aquí es submódulo suyo. */
const RAIZ = '/dashboard/capacitaciones';

/**
 * ¿Esta url es de Capacitaciones o de uno de sus submódulos?
 *
 * Se compara contra la ruta sola —sin query ni fragmento— y se exige que lo siguiente sea el
 * final o una barra: un `startsWith` pelado daría por bueno `/dashboard/capacitaciones-algo`,
 * que sería otro módulo.
 */
function esDeCapacitaciones(url: string): boolean {
  const ruta = (url ?? '').split('?')[0].split('#')[0];
  return ruta === RAIZ || ruta.startsWith(RAIZ + '/');
}
