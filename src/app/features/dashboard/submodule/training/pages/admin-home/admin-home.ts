import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

import {
  TrainingAdminService, TableroAdmin, FilaCurso, PendienteAdmin,
} from '../../service/training-admin.service';

/** Un atajo del panel. El icono acompaña; lo que informa es el texto. */
interface Atajo {
  ruta: string;
  icono: string;
  titulo: string;
  ayuda: string;
}

/**
 * TABLERO DE ADMINISTRACIÓN de cursos y talleres.
 *
 * <p>Responde tres preguntas, en este orden y por esta razón: <b>qué está mal ahora</b> (los
 * pendientes), <b>cómo va la cosa</b> (las cifras) y <b>quién está estudiando</b>. Los
 * pendientes van arriba porque son lo accionable: un tablero que solo informa se mira una vez
 * y no se vuelve a abrir.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-admin-home',
  imports: [CommonModule, MatIconModule],
  templateUrl: './admin-home.html',
  styleUrl: './admin-home.css',
})
export class AdminHome implements OnInit {
  private api = inject(TrainingAdminService);
  private router = inject(Router);

  readonly datos = signal<TableroAdmin | null>(null);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);

  readonly atajos: Atajo[] = [
    { ruta: 'catalogo', icono: 'school', titulo: 'Cursos',
      ayuda: 'Crear y editar cursos, lecciones y bloques' },
    { ruta: 'evaluaciones', icono: 'quiz', titulo: 'Bancos de preguntas',
      ayuda: 'Preguntas reutilizables para todos los quices' },
    { ruta: 'planes', icono: 'rule', titulo: 'Planes de asignación',
      ayuda: 'Quién debe tomar qué, por rol, área o persona' },
    { ruta: 'grupos', icono: 'groups', titulo: 'Grupos',
      ayuda: 'Convocatorias con cupo, fecha y asistencia' },
    { ruta: 'cumplimiento', icono: 'fact_check', titulo: 'Cumplimiento',
      ayuda: 'La matriz completa, persona por persona' },
  ];

  /** Los pendientes que bloquean a alguien hoy. Se separan porque no se leen igual. */
  readonly urgentes = computed(() =>
    (this.datos()?.pendientes ?? []).filter(p => p.severidad === 'ALTA'));

  readonly demasPendientes = computed(() =>
    (this.datos()?.pendientes ?? []).filter(p => p.severidad !== 'ALTA'));

  /** Cursos ordenados por lo que peor va: es el orden en que hay que mirarlos. */
  readonly cursosPorAtender = computed(() =>
    [...(this.datos()?.cursos ?? [])].sort((a, b) => {
      if (a.vencidos !== b.vencidos) return b.vencidos - a.vencidos;
      return a.porcentaje - b.porcentaje;
    }));

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      this.datos.set(await this.api.tableroAdmin());
    } catch {
      this.error.set('No pudimos cargar el tablero. Revisa la conexión e inténtalo de nuevo.');
    } finally {
      this.cargando.set(false);
    }
  }

  ir(ruta: string): void {
    // Las rutas del servidor vienen relativas al panel ("capacitaciones/catalogo") para que
    // una tarjeta de pendiente sea un enlace y no un aviso que hay que ir a buscar a mano.
    this.router.navigateByUrl('/dashboard/' + ruta.replace(/^\/+/, ''));
  }

  irAAtajo(a: Atajo): void {
    this.router.navigate(['/dashboard/capacitaciones', a.ruta]);
  }

  /** Ancho de cada tramo de la barra de un curso, en porcentaje sobre su gente. */
  tramo(c: FilaCurso, cuantos: number): string {
    return c.personas > 0 ? `${(cuantos * 100) / c.personas}%` : '0%';
  }

  claseSeveridad(p: PendienteAdmin): string {
    return p.severidad === 'ALTA' ? 'sev-alta'
         : p.severidad === 'MEDIA' ? 'sev-media' : 'sev-baja';
  }

  iconoPendiente(p: PendienteAdmin): string {
    switch (p.clave) {
      case 'cursos_sin_publicar': return 'unpublished';
      case 'sin_matricula': return 'person_off';
      case 'vencidos': return 'event_busy';
      case 'por_vencer': return 'schedule';
      case 'quices_vacios': return 'quiz';
      case 'material_error': return 'error_outline';
      case 'material_en_cola': return 'hourglass_top';
      case 'borradores': return 'edit_note';
      case 'preguntas_sin_atajo': return 'link_off';
      case 'etiquetas': return 'sell';
      default: return 'flag';
    }
  }

  /** «3 h 20 min» a partir de minutos: 200 min no le dice nada a nadie de un vistazo. */
  duracion(minutos: number): string {
    if (minutos < 60) return `${minutos} min`;
    const h = Math.floor(minutos / 60);
    const m = minutos % 60;
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
  }
}
