import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';

import {
  ContextoFormacion, DisenadorService, DisenoResumen, mensajeDeError,
} from '../../service/disenador.service';
import { GrabadoraVoz } from '../../components/grabadora-voz/grabadora-voz';

/**
 * Portada del diseñador de cursos con IA: empezar uno nuevo y retomar los que están a medias.
 *
 * El formulario de inicio pide solo tres cosas —cómo se llama, si es educativo o corporativo y
 * la idea en palabras del profesor— porque todo lo demás lo pregunta la IA después, con el
 * material a la vista. Un formulario largo al principio es donde la gente abandona.
 */
@Component({
  selector: 'app-disenador-lista',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, DatePipe, GrabadoraVoz],
  templateUrl: './disenador-lista.html',
  styleUrl: './disenador-lista.css',
})
export class DisenadorLista implements OnInit {
  private api = inject(DisenadorService);
  private router = inject(Router);

  readonly disenos = signal<DisenoResumen[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly creando = signal(false);
  readonly dictando = signal(false);

  titulo = '';
  contexto: ContextoFormacion = 'CORPORATIVO';
  idea = '';

  readonly pasos = [
    { icono: 'upload_file', titulo: 'Tu material', texto: 'Manuales, diapositivas, audios, videos, enlaces o lo que dictes.' },
    { icono: 'forum', titulo: 'Te pregunta', texto: 'Para quién es, qué deben saber hacer, cuánto tiempo hay. Escribiendo o hablando.' },
    { icono: 'account_tree', titulo: 'Propone la estructura', texto: 'Módulos, clases, actividades y quices alineados con los objetivos.' },
    { icono: 'auto_stories', titulo: 'Escribe las clases', texto: 'Con tu material como fuente. Tú revisas y ajustas.' },
    { icono: 'rocket_launch', titulo: 'Crea el curso', texto: 'Queda en borrador para revisarlo y publicarlo.' },
  ];

  readonly etiquetaEstado: Record<string, string> = {
    MATERIAL: 'Material', ENTREVISTA: 'Entrevista', ESTRUCTURA: 'Estructura',
    CONTENIDO: 'Clases escritas', APLICADO: 'Curso creado',
  };

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      this.disenos.set(await this.api.listar());
    } catch (e) {
      this.error.set(mensajeDeError(e, 'No se pudieron cargar tus diseños'));
    } finally {
      this.cargando.set(false);
    }
  }

  async empezar(): Promise<void> {
    if (!this.titulo.trim() || this.creando()) return;
    this.creando.set(true);
    try {
      const d = await this.api.crear({ titulo: this.titulo.trim(), contexto: this.contexto, idea: this.idea.trim() || null });
      await this.router.navigate(['/dashboard/capacitaciones/disenar', d.id]);
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo empezar', text: mensajeDeError(e) });
    } finally {
      this.creando.set(false);
    }
  }

  /** El dictado de la idea necesita un diseño para transcribir: se crea con lo escrito hasta ahí. */
  async dictarIdea(audio: Blob): Promise<void> {
    this.dictando.set(true);
    try {
      if (!this.titulo.trim()) this.titulo = 'Curso nuevo';
      const d = await this.api.crear({ titulo: this.titulo.trim(), contexto: this.contexto, idea: this.idea.trim() || null });
      const { texto } = await this.api.dictado(d.id, audio);
      const idea = [this.idea.trim(), texto].filter(Boolean).join(' ');
      await this.api.actualizar(d.id, { titulo: this.titulo.trim(), contexto: this.contexto, idea });
      await this.router.navigate(['/dashboard/capacitaciones/disenar', d.id]);
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo transcribir', text: mensajeDeError(e) });
    } finally {
      this.dictando.set(false);
    }
  }

  abrir(d: DisenoResumen): void {
    this.router.navigate(['/dashboard/capacitaciones/disenar', d.id]);
  }

  async borrar(d: DisenoResumen, ev: Event): Promise<void> {
    ev.stopPropagation();
    const r = await Swal.fire({
      icon: 'warning', title: '¿Borrar este diseño?',
      text: d.course_id ? 'El curso que ya se creó no se toca.' : 'Se pierde la entrevista y la propuesta.',
      showCancelButton: true, confirmButtonText: 'Borrar', cancelButtonText: 'Cancelar',
    });
    if (!r.isConfirmed) return;
    try {
      await this.api.eliminar(d.id);
      this.disenos.update(l => l.filter(x => x.id !== d.id));
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo borrar', text: mensajeDeError(e) });
    }
  }

  progreso(d: DisenoResumen): number {
    return ['MATERIAL', 'ENTREVISTA', 'ESTRUCTURA', 'CONTENIDO', 'APLICADO'].indexOf(d.estado) + 1;
  }
}
