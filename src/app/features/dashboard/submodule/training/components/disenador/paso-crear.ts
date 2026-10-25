import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';

import { AplicarResultado, Diseno, DisenadorService, mensajeDeError } from '../../service/disenador.service';

/**
 * Paso 5: resumen y creación. El curso se crea en BORRADOR: nada llega a la gente hasta que
 * quien administra formación lo revise y lo publique en la consola, que es a donde lleva el
 * botón final.
 */
@Component({
  selector: 'app-paso-crear',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule],
  templateUrl: './paso-crear.html',
  styleUrls: ['./pasos.css', './paso-crear.css'],
})
export class PasoCrear {
  @Input({ required: true }) diseno!: Diseno;
  @Input() ocupado = false;
  @Output() cambio = new EventEmitter<Diseno>();
  @Output() ir = new EventEmitter<'clases' | 'estructura' | 'medios'>();

  private api = inject(DisenadorService);
  private router = inject(Router);

  readonly creando = signal(false);
  readonly resultado = signal<AplicarResultado | null>(null);

  get lecciones() {
    return (this.diseno.propuesta?.modulos ?? []).flatMap(m => m.lecciones);
  }
  get escritas(): number { return this.lecciones.filter(l => l.estado_detalle === 'LISTO').length; }
  get preguntas(): number { return this.lecciones.reduce((n, l) => n + (l.preguntas?.length ?? 0), 0); }
  get actividades(): number { return this.lecciones.reduce((n, l) => n + (l.actividades?.length ?? 0), 0); }
  get minutos(): number { return this.lecciones.reduce((n, l) => n + (l.duracion_min ?? 0), 0); }

  async crear(): Promise<void> {
    const faltan = this.lecciones.length - this.escritas;
    if (faltan > 0) {
      const r = await Swal.fire({ icon: 'question', title: `${faltan} clase${faltan === 1 ? '' : 's'} sin escribir`,
        text: 'Se crearán solo con su resumen y objetivos; podrás completarlas en la consola del curso.',
        showCancelButton: true, confirmButtonText: 'Crear igual', cancelButtonText: 'Volver' });
      if (!r.isConfirmed) return;
    }
    this.creando.set(true);
    try {
      this.resultado.set(await this.api.aplicar(this.diseno.id));
      this.cambio.emit(await this.api.obtener(this.diseno.id));
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo crear el curso', text: mensajeDeError(e) });
    } finally {
      this.creando.set(false);
    }
  }

  abrirCurso(): void {
    const id = this.resultado()?.course_id ?? this.diseno.course_id;
    if (id) this.router.navigate(['/dashboard/capacitaciones/catalogo', id]);
  }
}
