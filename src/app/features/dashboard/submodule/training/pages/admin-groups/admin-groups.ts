import { Component, ChangeDetectionStrategy, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';
import {
  TrainingAdminService, Grupo, GrupoRequest, Matricula, Asistencia, Curso, Version
} from '../../service/training-admin.service';

/**
 * Grupos: cohortes, matrícula y asistencia.
 *
 * Un grupo es un conjunto de personas haciendo la MISMA versión del curso, con sus fechas y su
 * instructor. No todo curso necesita grupo —un autogestionado se matricula sin cohorte— pero
 * todo lo que tiene fecha, sala o lista de asistencia sí.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-admin-groups',
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './admin-groups.html',
  styleUrl: './admin-groups.css'
})
export class AdminGroups implements OnInit {
  private api = inject(TrainingAdminService);

  readonly grupos = signal<Grupo[]>([]);
  readonly cursos = signal<Curso[]>([]);
  readonly versionesPorCurso = signal<Record<string, Version[]>>({});
  readonly grupoActivo = signal<Grupo | null>(null);
  readonly matriculados = signal<Matricula[]>([]);
  readonly asistencia = signal<Asistencia[]>([]);

  readonly cargando = signal(true);
  readonly ocupado = signal(false);
  readonly error = signal<string | null>(null);
  readonly pestana = signal<'gente' | 'asistencia'>('gente');

  readonly nuevoGrupo = signal<(GrupoRequest & { courseId?: string }) | null>(null);
  /** Cédulas pegadas para matricular en bloque. */
  readonly cedulasPegadas = signal('');
  readonly fechaLista = signal(new Date().toISOString().slice(0, 10));
  readonly marcas = signal<Record<string, string>>({});

  readonly versionesDelCursoElegido = computed(() => {
    const cid = this.nuevoGrupo()?.courseId;
    return cid ? (this.versionesPorCurso()[cid] ?? []) : [];
  });

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const [grupos, cursos] = await Promise.all([
        this.api.listarGrupos(),
        this.api.listarCursos(0, 100),
      ]);
      this.grupos.set(grupos.content ?? []);
      this.cursos.set(cursos.content ?? []);
    } catch (e: any) {
      this.error.set(e?.status === 403
        ? 'Tu rol no tiene permiso para gestionar grupos.'
        : 'No pudimos cargar los grupos.');
    } finally {
      this.cargando.set(false);
    }
  }

  // ── Crear grupo ───────────────────────────────────────────────────────────

  abrirNuevo(): void {
    this.nuevoGrupo.set({
      course_version_id: '', nombre: '', modalidad: 'PRESENCIAL',
      cupo: null, fecha_inicio: null, fecha_fin: null, courseId: '',
    });
  }

  /** Al elegir curso hay que traer sus versiones: solo se matricula en la PUBLICADA. */
  async elegirCurso(courseId: string): Promise<void> {
    this.nuevoGrupo.update(f => f ? { ...f, courseId, course_version_id: '' } : f);
    if (!courseId || this.versionesPorCurso()[courseId]) return;
    const versiones = await this.api.versiones(courseId);
    this.versionesPorCurso.update(m => ({ ...m, [courseId]: versiones }));

    // Se preselecciona la publicada: es la unica en la que se puede matricular gente.
    const publicada = versiones.find(v => v.estado === 'PUBLICADA');
    if (publicada) {
      this.nuevoGrupo.update(f => f ? { ...f, course_version_id: publicada.id } : f);
    }
  }

  async guardarGrupo(): Promise<void> {
    const f = this.nuevoGrupo();
    if (!f?.nombre.trim() || !f.course_version_id) {
      Swal.fire('Faltan datos', 'El grupo necesita nombre y una versión del curso.', 'info');
      return;
    }
    this.ocupado.set(true);
    try {
      const { courseId, ...req } = f;
      await this.api.crearGrupo({ ...req, nombre: f.nombre.trim() });
      this.nuevoGrupo.set(null);
      await this.cargar();
    } catch (e: any) {
      Swal.fire('No se pudo crear', e?.error?.message ?? '', 'error');
    } finally {
      this.ocupado.set(false);
    }
  }

  // ── Detalle ───────────────────────────────────────────────────────────────

  async abrir(g: Grupo): Promise<void> {
    this.grupoActivo.set(g);
    this.pestana.set('gente');
    this.cedulasPegadas.set('');
    this.matriculados.set(await this.api.matriculados(g.id));
  }

  cerrar(): void {
    this.grupoActivo.set(null);
    this.matriculados.set([]);
    this.asistencia.set([]);
  }

  async cambiarEstado(estado: string): Promise<void> {
    const g = this.grupoActivo();
    if (!g) return;
    if (estado === 'CERRADO') {
      const r = await Swal.fire({
        title: '¿Cerrar el grupo?',
        text: 'Deja de admitir matrículas nuevas. Es lo que evita que alguien entre a una '
            + 'cohorte que ya terminó y figure como que la cursó.',
        icon: 'question', showCancelButton: true,
        confirmButtonText: 'Cerrar grupo', cancelButtonText: 'Cancelar',
      });
      if (!r.isConfirmed) return;
    }
    const actualizado = await this.api.cambiarEstadoGrupo(g.id, estado);
    this.grupoActivo.set(actualizado);
    await this.cargar();
  }

  // ── Matrícula masiva ──────────────────────────────────────────────────────

  async matricular(): Promise<void> {
    const g = this.grupoActivo();
    const texto = this.cedulasPegadas().trim();
    if (!g || !texto) return;

    // Se acepta lo que RRHH tiene a mano: una lista pegada de un Excel, con lo que venga
    // de separador. Se limpia aquí en vez de pedirle a la persona que la formatee.
    const cedulas = texto.split(/[\s,;]+/).map(c => c.trim()).filter(Boolean);
    if (cedulas.length === 0) return;

    this.ocupado.set(true);
    try {
      const r = await this.api.matricularPorCedulas(g.id, cedulas);
      this.cedulasPegadas.set('');
      this.matriculados.set(await this.api.matriculados(g.id));
      await this.cargar();

      const detalle = r.omisiones.map(o => `• ${o.motivo}`).join('<br>');
      await Swal.fire({
        title: `${r.matriculadas} matriculada(s)`,
        html: r.omitidas > 0
          ? `<p>${r.omitidas} no se pudieron matricular:</p><div style="text-align:left">${detalle}</div>`
          : 'Todas quedaron matriculadas.',
        icon: r.omitidas > 0 ? 'warning' : 'success',
      });
    } catch (e: any) {
      Swal.fire('No se pudo matricular', e?.error?.message ?? '', 'error');
    } finally {
      this.ocupado.set(false);
    }
  }

  async anular(m: Matricula): Promise<void> {
    const r = await Swal.fire({
      title: `¿Anular la matrícula de ${m.persona_nombre}?`,
      text: 'No se borra: su progreso y su asistencia siguen siendo evidencia.',
      icon: 'warning', showCancelButton: true,
      confirmButtonText: 'Anular', cancelButtonText: 'Cancelar',
    });
    if (!r.isConfirmed) return;
    try {
      await this.api.anularMatricula(m.id);
      this.matriculados.set(await this.api.matriculados(this.grupoActivo()!.id));
    } catch (e: any) {
      Swal.fire('No se pudo anular', e?.error?.message ?? '', 'error');
    }
  }

  // ── Asistencia ────────────────────────────────────────────────────────────

  async verAsistencia(): Promise<void> {
    this.pestana.set('asistencia');
    await this.cargarAsistencia();
  }

  async cargarAsistencia(): Promise<void> {
    const g = this.grupoActivo();
    if (!g) return;
    const filas = await this.api.asistencia(g.id, this.fechaLista());
    this.asistencia.set(filas);
    // Se precargan las marcas del día para que pasar lista sea corregir, no empezar de cero.
    const marcas: Record<string, string> = {};
    filas.forEach(f => marcas[f.enrollment_id] = f.estado);
    this.marcas.set(marcas);
  }

  marcar(enrollmentId: string, estado: string): void {
    this.marcas.update(m => ({ ...m, [enrollmentId]: estado }));
  }

  marcaDe(enrollmentId: string): string {
    return this.marcas()[enrollmentId] ?? '';
  }

  async guardarLista(): Promise<void> {
    const g = this.grupoActivo();
    if (!g) return;
    const registros = Object.entries(this.marcas())
      .filter(([, estado]) => !!estado)
      .map(([enrollment_id, estado]) => ({ enrollment_id, estado }));
    if (registros.length === 0) {
      Swal.fire('Nada que guardar', 'Marca al menos a una persona.', 'info');
      return;
    }
    this.ocupado.set(true);
    try {
      await this.api.pasarLista(g.id, this.fechaLista(), registros);
      await this.cargarAsistencia();
      Swal.fire('Lista guardada', `${registros.length} registro(s) guardados.`, 'success');
    } catch (e: any) {
      // El backend rechaza fechas futuras y matrículas de otro grupo, con su motivo.
      Swal.fire('No se pudo guardar', e?.error?.message ?? '', 'error');
    } finally {
      this.ocupado.set(false);
    }
  }

  claseEstado(estado: string): string {
    switch (estado) {
      case 'ABIERTO': return 'chip-abierto';
      case 'EN_CURSO': return 'chip-curso';
      default: return 'chip-cerrado';
    }
  }

  claseMatricula(estado: string): string {
    switch (estado) {
      case 'APROBADO': return 'chip-ok';
      case 'REPROBADO': return 'chip-mal';
      case 'ANULADO': return 'chip-cerrado';
      default: return 'chip-curso';
    }
  }
}
