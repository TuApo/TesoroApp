import { Component, ChangeDetectionStrategy, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';
import {
  TrainingAdminService, Banco, Pregunta, PreguntaRequest, Opcion, Curso
} from '../../service/training-admin.service';

/** Borrador de pregunta que se está escribiendo. */
interface FormPregunta {
  id?: string;
  enunciado: string;
  tipo: 'OPCION_MULTIPLE' | 'VERDADERO_FALSO' | 'EMPAREJAR';
  explicacion: string;
  opciones: Opcion[];
  /** true = la pregunta ya fue respondida, así que guardar creará una versión nueva. */
  versionar: boolean;
}

/**
 * Bancos de preguntas y sus preguntas.
 *
 * Un banco es la bolsa de la que salen los quices y el examen. Cuelga del CURSO y no de su
 * versión: si viviera dentro de la versión, cada corrección de una lección obligaría a
 * duplicar las 40 preguntas y mantenerlas en paralelo. Con el curso vacío, el banco es
 * transversal y lo puede usar cualquiera.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-admin-question-banks',
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './admin-question-banks.html',
  styleUrl: './admin-question-banks.css'
})
export class AdminQuestionBanks implements OnInit {
  private api = inject(TrainingAdminService);

  readonly bancos = signal<Banco[]>([]);
  readonly cursos = signal<Curso[]>([]);
  readonly bancoActivo = signal<Banco | null>(null);
  readonly preguntas = signal<Pregunta[]>([]);
  readonly cargando = signal(true);
  readonly ocupado = signal(false);
  readonly error = signal<string | null>(null);

  readonly nuevoBanco = signal<{ nombre: string; course_id: string } | null>(null);
  readonly form = signal<FormPregunta | null>(null);

  readonly activas = computed(() => this.preguntas().filter(p => p.activa).length);

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const [bancos, cursos] = await Promise.all([
        this.api.listarBancos(),
        this.api.listarCursos(0, 100),
      ]);
      this.bancos.set(bancos.content ?? []);
      this.cursos.set(cursos.content ?? []);
    } catch (e: any) {
      this.error.set(e?.status === 403
        ? 'Tu rol no tiene permiso para administrar formación.'
        : 'No pudimos cargar los bancos de preguntas.');
    } finally {
      this.cargando.set(false);
    }
  }

  // ── Bancos ────────────────────────────────────────────────────────────────

  abrirNuevoBanco(): void {
    this.nuevoBanco.set({ nombre: '', course_id: '' });
  }

  async guardarBanco(): Promise<void> {
    const f = this.nuevoBanco();
    if (!f?.nombre.trim()) return;
    this.ocupado.set(true);
    try {
      await this.api.crearBanco({ nombre: f.nombre.trim(), course_id: f.course_id || null });
      this.nuevoBanco.set(null);
      await this.cargar();
    } catch (e: any) {
      Swal.fire('No se pudo crear', e?.error?.message ?? '', 'error');
    } finally {
      this.ocupado.set(false);
    }
  }

  async abrirBanco(b: Banco): Promise<void> {
    this.bancoActivo.set(b);
    this.form.set(null);
    this.preguntas.set(await this.api.preguntas(b.id));
  }

  cerrarBanco(): void {
    this.bancoActivo.set(null);
    this.preguntas.set([]);
  }

  async eliminarBanco(b: Banco): Promise<void> {
    const r = await Swal.fire({
      title: `¿Eliminar "${b.nombre}"?`, icon: 'warning', showCancelButton: true,
      confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar',
    });
    if (!r.isConfirmed) return;
    try {
      await this.api.eliminarBanco(b.id);
      await this.cargar();
    } catch (e: any) {
      // El backend rechaza borrar un banco con preguntas: hay que vaciarlo primero, porque
      // esas preguntas pueden estar dentro de quices ya respondidos.
      Swal.fire('No se pudo eliminar', e?.error?.message ?? '', 'error');
    }
  }

  // ── Preguntas ─────────────────────────────────────────────────────────────

  nuevaPregunta(): void {
    this.form.set({
      enunciado: '', tipo: 'OPCION_MULTIPLE', explicacion: '', versionar: false,
      opciones: [
        { texto: '', correcta: true }, { texto: '', correcta: false },
      ],
    });
  }

  editarPregunta(p: Pregunta): void {
    this.form.set({
      id: p.id,
      enunciado: p.enunciado,
      tipo: p.tipo,
      explicacion: p.explicacion ?? '',
      // Una pregunta ya respondida NO se edita: se versiona. La interfaz lo dice antes de
      // que la persona escriba, no después de que el guardado falle con un 409.
      versionar: p.ya_respondida,
      opciones: p.opciones.map(o => ({ ...o })),
    });
  }

  cambiarTipo(tipo: FormPregunta['tipo']): void {
    this.form.update(f => {
      if (!f) return f;
      if (tipo === 'VERDADERO_FALSO') {
        return { ...f, tipo, opciones: [
          { texto: 'Verdadero', correcta: true }, { texto: 'Falso', correcta: false },
        ] };
      }
      if (tipo === 'EMPAREJAR') {
        return { ...f, tipo, opciones: [
          { texto: '', correcta: false, pareja_clave: 'a' },
          { texto: '', correcta: false, pareja_clave: 'a' },
          { texto: '', correcta: false, pareja_clave: 'b' },
          { texto: '', correcta: false, pareja_clave: 'b' },
        ] };
      }
      return { ...f, tipo, opciones: [
        { texto: '', correcta: true }, { texto: '', correcta: false },
      ] };
    });
  }

  agregarOpcion(): void {
    this.form.update(f => f ? { ...f, opciones: [...f.opciones, { texto: '', correcta: false }] } : f);
  }

  /** En emparejar las opciones van de dos en dos: una pareja = dos filas con la misma clave. */
  agregarPareja(): void {
    this.form.update(f => {
      if (!f) return f;
      const clave = String.fromCharCode(97 + Math.floor(f.opciones.length / 2));
      return { ...f, opciones: [
        ...f.opciones,
        { texto: '', correcta: false, pareja_clave: clave },
        { texto: '', correcta: false, pareja_clave: clave },
      ] };
    });
  }

  quitarOpcion(i: number): void {
    this.form.update(f => f ? { ...f, opciones: f.opciones.filter((_, x) => x !== i) } : f);
  }

  marcarCorrecta(i: number): void {
    this.form.update(f => {
      if (!f) return f;
      if (f.tipo === 'VERDADERO_FALSO') {
        // Exactamente una correcta: marcar una desmarca la otra.
        return { ...f, opciones: f.opciones.map((o, x) => ({ ...o, correcta: x === i })) };
      }
      return { ...f, opciones: f.opciones.map((o, x) => x === i ? { ...o, correcta: !o.correcta } : o) };
    });
  }

  async guardarPregunta(): Promise<void> {
    const f = this.form();
    const b = this.bancoActivo();
    if (!f || !b) return;
    if (!f.enunciado.trim()) {
      Swal.fire('Falta el enunciado', 'La pregunta necesita un enunciado.', 'info');
      return;
    }

    const req: PreguntaRequest = {
      enunciado: f.enunciado.trim(),
      tipo: f.tipo,
      explicacion: f.explicacion || undefined,
      activa: true,
      opciones: f.opciones.map((o, i) => ({ ...o, texto: o.texto.trim(), orden: i })),
    };

    this.ocupado.set(true);
    try {
      if (f.id && f.versionar) {
        await this.api.nuevaVersionPregunta(f.id, req);
      } else if (f.id) {
        await this.api.actualizarPregunta(f.id, req);
      } else {
        await this.api.crearPregunta(b.id, req);
      }
      this.form.set(null);
      this.preguntas.set(await this.api.preguntas(b.id));
      await this.cargar();
    } catch (e: any) {
      // Los mensajes del backend son concretos ("marca al menos una opción como correcta",
      // "cada pareja son exactamente 2"), así que se muestran tal cual.
      Swal.fire('Revisa la pregunta', e?.error?.message ?? 'No se pudo guardar.', 'error');
    } finally {
      this.ocupado.set(false);
    }
  }

  async retirar(p: Pregunta): Promise<void> {
    await this.api.retirarPregunta(p.id);
    this.preguntas.set(await this.api.preguntas(this.bancoActivo()!.id));
  }

  async reactivar(p: Pregunta): Promise<void> {
    await this.api.reactivarPregunta(p.id);
    this.preguntas.set(await this.api.preguntas(this.bancoActivo()!.id));
  }

  async eliminarPregunta(p: Pregunta): Promise<void> {
    const r = await Swal.fire({
      title: '¿Eliminar la pregunta?',
      text: 'Solo se puede si nadie la ha respondido nunca.',
      icon: 'warning', showCancelButton: true,
      confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar',
    });
    if (!r.isConfirmed) return;
    try {
      await this.api.eliminarPregunta(p.id);
      this.preguntas.set(await this.api.preguntas(this.bancoActivo()!.id));
    } catch (e: any) {
      Swal.fire('No se puede eliminar', e?.error?.message ?? '', 'error');
    }
  }

  etiquetaTipo(tipo: string): string {
    switch (tipo) {
      case 'OPCION_MULTIPLE': return 'Opción múltiple';
      case 'VERDADERO_FALSO': return 'Verdadero / Falso';
      case 'EMPAREJAR': return 'Emparejar';
      default: return tipo;
    }
  }
}
