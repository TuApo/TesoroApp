import { Component, ChangeDetectionStrategy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';
import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';
import { TrainingAdminService, Curso, CursoRequest } from '../../service/training-admin.service';

/**
 * Catálogo de cursos: la pantalla desde la que se crea la formación.
 *
 * El curso es la identidad estable ("Inducción SST"); su CONTENIDO vive en versiones y se
 * edita en el detalle. Por eso aquí solo se ve y se define lo que no cambia al corregir una
 * lección: código, obligatoriedad, cada cuánto hay que recertificar y quién capacita.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-admin-courses',
  imports: [CommonModule, FormsModule, MatIconModule, ...TABLA_ESTANDAR],
  templateUrl: './admin-courses.html',
  styleUrl: './admin-courses.css'
})
export class AdminCourses implements OnInit {
  private api = inject(TrainingAdminService);
  private router = inject(Router);

  readonly cursos = signal<Curso[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly guardando = signal(false);

  /** Formulario del curso que se está creando o editando; null = panel cerrado. */
  readonly editando = signal<(CursoRequest & { id?: string }) | null>(null);

  /** La búsqueda por nombre o código, el orden y los filtros los hace la tabla estándar. */
  readonly columnas: ColumnaTabla<Curso>[] = [
    { id: 'curso', header: 'Curso', valor: (c) => c.nombre, tarjeta: 'titulo', minAncho: '200px' },
    { id: 'codigo', header: 'Código', valor: (c) => c.codigo, tarjeta: 'subtitulo' },
    { id: 'modalidad', header: 'Modalidad', valor: (c) => c.modalidad_default, prioridad: 2, tarjeta: 'meta' },
    { id: 'vigencia', header: 'Vigencia', prioridad: 2, tarjeta: 'meta',
      valor: (c) => (c.vigencia_meses ? c.vigencia_meses + ' meses' : 'No vence') },
    { id: 'estado', header: 'Estado', tarjeta: 'badge', valor: (c) => this.estadoTexto(c),
      badge: (c) => ({ texto: this.estadoTexto(c), tono: c.estado === 'ARCHIVADO' ? 'neutro' : c.version_publicada ? 'ok' : 'warn' }) },
  ];
  readonly idCurso = (c: Curso) => c.id;

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const pagina = await this.api.listarCursos(0, 100);
      this.cursos.set(pagina.content ?? []);
    } catch (e: any) {
      this.error.set(e?.status === 403
        ? 'Tu rol no tiene permiso para administrar formación.'
        : 'No pudimos cargar el catálogo. Vuelve a intentar en un momento.');
    } finally {
      this.cargando.set(false);
    }
  }

  nuevo(): void {
    this.editando.set({
      codigo: '', nombre: '', descripcion: '', obligatorio: true,
      modalidad_default: 'AUTOGESTIONADO', entidad_capacitadora: 'Apoyo Laboral TS',
    });
  }

  editar(c: Curso): void {
    this.editando.set({
      id: c.id, codigo: c.codigo, nombre: c.nombre, descripcion: c.descripcion,
      obligatorio: c.obligatorio, vigencia_meses: c.vigencia_meses,
      entidad_capacitadora: c.entidad_capacitadora, modalidad_default: c.modalidad_default,
    });
  }

  cerrar(): void {
    this.editando.set(null);
  }

  async guardar(): Promise<void> {
    const form = this.editando();
    if (!form || this.guardando()) return;
    if (!form.nombre?.trim()) {
      Swal.fire('Falta el nombre', 'El curso necesita un nombre para poder crearse.', 'info');
      return;
    }
    // El código se usa para identificar el curso en reportes y en el importador; si no lo
    // ponen, se deriva del nombre en vez de obligar a inventarlo.
    const req: CursoRequest = {
      ...form,
      codigo: (form.codigo?.trim() || form.nombre).toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
      nombre: form.nombre.trim(),
    };

    this.guardando.set(true);
    try {
      if (form.id) {
        await this.api.actualizarCurso(form.id, req);
      } else {
        const creado = await this.api.crearCurso(req);
        // Un curso recién creado no sirve de nada vacío: se abre su contenido directamente.
        this.editando.set(null);
        await this.cargar();
        this.abrir(creado);
        return;
      }
      this.editando.set(null);
      await this.cargar();
    } catch (e: any) {
      Swal.fire('No se pudo guardar',
        e?.error?.message ?? 'Revisa los datos e inténtalo de nuevo.', 'error');
    } finally {
      this.guardando.set(false);
    }
  }

  abrir(c: Curso): void {
    this.router.navigate(['/dashboard/capacitaciones/catalogo', c.id]);
  }

  async archivar(c: Curso): Promise<void> {
    const r = await Swal.fire({
      title: `¿Archivar "${c.nombre}"?`,
      text: 'Deja de aparecer en el catálogo. Las matrículas y certificados que ya existen '
          + 'se conservan.',
      icon: 'warning', showCancelButton: true,
      confirmButtonText: 'Archivar', cancelButtonText: 'Cancelar',
    });
    if (!r.isConfirmed) return;
    try {
      await this.api.archivarCurso(c.id);
      await this.cargar();
    } catch {
      Swal.fire('No se pudo archivar', 'Vuelve a intentar en un momento.', 'error');
    }
  }

  estadoTexto(c: Curso): string {
    if (c.estado === 'ARCHIVADO') return 'Archivado';
    return c.version_publicada ? `Publicado · v${c.version_publicada}` : 'Sin publicar';
  }
}
