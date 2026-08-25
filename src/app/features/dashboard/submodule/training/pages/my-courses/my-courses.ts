import { Component, ChangeDetectionStrategy, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { TrainingS, ResumenCurso } from '../../service/training-s';
import { TrainingOffline } from '../../service/training-offline';

/**
 * "Mis cursos": la pantalla de entrada del colaborador.
 *
 * Diseñada para un operario en campo con un celular de gama baja y sol de frente: tarjetas
 * grandes, un solo botón por curso, y el estado dicho en palabras además de en color — quien
 * mira esto a mediodía en un invernadero no distingue un chip verde de uno amarillo.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-my-courses',
  imports: [CommonModule, MatIconModule, MatProgressBarModule],
  templateUrl: './my-courses.html',
  styleUrl: './my-courses.css'
})
export class MyCourses implements OnInit {
  private api = inject(TrainingS);
  private router = inject(Router);
  readonly offline = inject(TrainingOffline);

  readonly cursos = signal<ResumenCurso[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);

  /** Lo pendiente primero: es lo que la persona vino a hacer. */
  readonly ordenados = computed(() =>
    [...this.cursos()].sort((a, b) => {
      const pesoA = a.estado_matricula === 'APROBADO' ? 1 : 0;
      const pesoB = b.estado_matricula === 'APROBADO' ? 1 : 0;
      if (pesoA !== pesoB) return pesoA - pesoB;
      return b.porcentaje_curso - a.porcentaje_curso;
    })
  );

  async ngOnInit(): Promise<void> {
    await this.cargar();
    await this.offline.refrescarPendientes();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      this.cursos.set(await this.api.misCursos());
    } catch {
      // El interceptor ya sirve la última versión cacheada si la hay; si llegamos aquí es que
      // no hay ni caché, y decirlo claro vale más que una pantalla vacía.
      this.error.set('No pudimos cargar tus cursos. Conéctate a internet e intenta de nuevo.');
    } finally {
      this.cargando.set(false);
    }
  }

  abrir(curso: ResumenCurso): void {
    this.router.navigate(['/dashboard/capacitaciones', curso.enrollment_id]);
  }

  verCertificados(): void {
    this.router.navigate(['/dashboard/capacitaciones/mis-certificados']);
  }

  /** Etiqueta en palabras. El color acompaña, no informa por sí solo. */
  etiqueta(curso: ResumenCurso): string {
    if (curso.estado_matricula === 'APROBADO') return 'Aprobado';
    if (curso.estado_matricula === 'REPROBADO') return 'No aprobado';
    if (curso.contenido_completo && curso.requiere_evaluacion) return 'Falta la evaluación';
    if (curso.porcentaje_curso > 0) return 'En curso';
    return 'Sin empezar';
  }

  clase(curso: ResumenCurso): string {
    if (curso.estado_matricula === 'APROBADO') return 'estado-ok';
    if (curso.estado_matricula === 'REPROBADO') return 'estado-mal';
    if (curso.contenido_completo && curso.requiere_evaluacion) return 'estado-atencion';
    return 'estado-curso';
  }

  textoBoton(curso: ResumenCurso): string {
    if (curso.estado_matricula === 'APROBADO') return 'Ver curso';
    if (curso.porcentaje_curso > 0) return 'Continuar';
    return 'Empezar';
  }
}
