import { Component, ChangeDetectionStrategy, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';
import {
  TrainingAdminService, Curso, Version, ContenidoVersion, Modulo, Leccion
} from '../../service/training-admin.service';

/**
 * Armado del contenido de un curso: versiones, módulos, lecciones y material.
 *
 * La regla que gobierna esta pantalla: **una versión publicada es inmutable**. Todo lo que
 * edita comprueba primero que la versión esté en BORRADOR, y si no lo está la interfaz lo dice
 * y ofrece crear una versión nueva. Sin eso, corregir una lección reescribiría lo que ya cursó
 * quien tiene certificado.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-admin-course-detail',
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './admin-course-detail.html',
  styleUrl: './admin-course-detail.css'
})
export class AdminCourseDetail implements OnInit {
  private api = inject(TrainingAdminService);
  private ruta = inject(ActivatedRoute);
  private router = inject(Router);

  readonly curso = signal<Curso | null>(null);
  readonly versiones = signal<Version[]>([]);
  readonly versionActivaId = signal<string | null>(null);
  readonly contenido = signal<ContenidoVersion | null>(null);
  readonly cargando = signal(true);
  readonly ocupado = signal(false);
  readonly error = signal<string | null>(null);
  readonly subiendo = signal<string | null>(null);

  /** Formularios abiertos. null = cerrado. */
  readonly nuevoModulo = signal<{ nombre: string; descripcion: string } | null>(null);
  readonly nuevaLeccion = signal<{ moduleId: string; nombre: string; tipo: string;
                                   contenido: string; duracion_min?: number } | null>(null);

  private courseId = '';

  readonly version = computed(() =>
    this.versiones().find(v => v.id === this.versionActivaId()) ?? null);

  readonly editable = computed(() => this.version()?.estado === 'BORRADOR');

  readonly totalLecciones = computed(() =>
    (this.contenido()?.modulos ?? []).reduce((n, m) => n + (m.lecciones?.length ?? 0), 0));

  async ngOnInit(): Promise<void> {
    this.courseId = this.ruta.snapshot.paramMap.get('courseId') ?? '';
    await this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const [curso, versiones] = await Promise.all([
        this.api.obtenerCurso(this.courseId),
        this.api.versiones(this.courseId),
      ]);
      this.curso.set(curso);
      this.versiones.set(versiones);

      // Se abre en la versión que se puede editar; si no hay ninguna, en la más reciente.
      const editable = versiones.find(v => v.estado === 'BORRADOR');
      const elegida = editable ?? versiones[0];
      this.versionActivaId.set(elegida?.id ?? null);
      if (elegida) await this.cargarContenido(elegida.id);
    } catch (e: any) {
      this.error.set(e?.status === 403
        ? 'Tu rol no tiene permiso para administrar formación.'
        : 'No pudimos abrir el curso. Vuelve a intentar en un momento.');
    } finally {
      this.cargando.set(false);
    }
  }

  async cambiarVersion(id: string): Promise<void> {
    this.versionActivaId.set(id);
    await this.cargarContenido(id);
  }

  private async cargarContenido(versionId: string): Promise<void> {
    this.contenido.set(await this.api.contenido(this.courseId, versionId));
  }

  volver(): void {
    this.router.navigate(['/dashboard/capacitaciones/catalogo']);
  }

  // ── Versiones ─────────────────────────────────────────────────────────────

  /** Crea un borrador clonando lo publicado: corregir sobre lo que ya existe es lo normal. */
  async nuevaVersion(): Promise<void> {
    const publicada = this.versiones().find(v => v.estado === 'PUBLICADA');
    const r = await Swal.fire({
      title: 'Crear una versión nueva',
      text: publicada
        ? 'Se copia el contenido de la versión publicada para que lo corrijas. La publicada '
          + 'sigue intacta hasta que publiques esta.'
        : 'Se crea un borrador vacío.',
      icon: 'question', showCancelButton: true,
      confirmButtonText: 'Crear', cancelButtonText: 'Cancelar',
    });
    if (!r.isConfirmed) return;

    this.ocupado.set(true);
    try {
      await this.api.crearVersion(this.courseId, publicada?.id);
      await this.cargar();
    } catch (e: any) {
      Swal.fire('No se pudo crear', e?.error?.message ?? 'Inténtalo de nuevo.', 'error');
    } finally {
      this.ocupado.set(false);
    }
  }

  async publicar(): Promise<void> {
    const v = this.version();
    if (!v) return;
    const r = await Swal.fire({
      title: `¿Publicar la versión ${v.version}?`,
      html: 'A partir de ahí <strong>el contenido queda congelado</strong> y ya se puede '
          + 'matricular gente.<br>Para cambiar algo habrá que crear otra versión.',
      icon: 'warning', showCancelButton: true,
      confirmButtonText: 'Publicar', cancelButtonText: 'Todavía no',
    });
    if (!r.isConfirmed) return;

    this.ocupado.set(true);
    try {
      await this.api.publicar(this.courseId, v.id);
      await this.cargar();
      Swal.fire('Publicado', 'Ya puedes matricular personas en este curso.', 'success');
    } catch (e: any) {
      // El backend rechaza publicar sin lecciones, con un quiz vacío o con una evaluación
      // imposible de armar. El motivo exacto es lo único útil aquí.
      Swal.fire('No se puede publicar todavía',
        e?.error?.message ?? 'Revisa que el curso tenga contenido.', 'error');
    } finally {
      this.ocupado.set(false);
    }
  }

  // ── Módulos ───────────────────────────────────────────────────────────────

  abrirNuevoModulo(): void {
    this.nuevoModulo.set({ nombre: '', descripcion: '' });
  }

  async guardarModulo(): Promise<void> {
    const form = this.nuevoModulo();
    const v = this.version();
    if (!form?.nombre.trim() || !v) return;
    this.ocupado.set(true);
    try {
      await this.api.crearModulo(v.id, {
        nombre: form.nombre.trim(),
        descripcion: form.descripcion,
        orden: this.contenido()?.modulos?.length ?? 0,
      });
      this.nuevoModulo.set(null);
      await this.cargarContenido(v.id);
    } catch (e: any) {
      Swal.fire('No se pudo crear el módulo', e?.error?.message ?? '', 'error');
    } finally {
      this.ocupado.set(false);
    }
  }

  async eliminarModulo(m: Modulo): Promise<void> {
    const r = await Swal.fire({
      title: `¿Eliminar "${m.nombre}"?`,
      text: `Se eliminan también sus ${m.lecciones?.length ?? 0} lección(es).`,
      icon: 'warning', showCancelButton: true,
      confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar',
    });
    if (!r.isConfirmed) return;
    await this.api.eliminarModulo(m.id);
    await this.cargarContenido(this.versionActivaId()!);
  }

  // ── Lecciones ─────────────────────────────────────────────────────────────

  abrirNuevaLeccion(m: Modulo): void {
    this.nuevaLeccion.set({ moduleId: m.id, nombre: '', tipo: 'VIDEO', contenido: '' });
  }

  async guardarLeccion(): Promise<void> {
    const form = this.nuevaLeccion();
    if (!form?.nombre.trim()) return;
    this.ocupado.set(true);
    try {
      const modulo = this.contenido()?.modulos.find(m => m.id === form.moduleId);
      await this.api.crearLeccion(form.moduleId, {
        nombre: form.nombre.trim(),
        tipo: form.tipo,
        contenido: form.contenido,
        duracion_min: form.duracion_min,
        obligatoria: true,
        orden: modulo?.lecciones?.length ?? 0,
      });
      this.nuevaLeccion.set(null);
      await this.cargarContenido(this.versionActivaId()!);
    } catch (e: any) {
      Swal.fire('No se pudo crear la lección', e?.error?.message ?? '', 'error');
    } finally {
      this.ocupado.set(false);
    }
  }

  async eliminarLeccion(l: Leccion): Promise<void> {
    const r = await Swal.fire({
      title: `¿Eliminar "${l.nombre}"?`, icon: 'warning', showCancelButton: true,
      confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar',
    });
    if (!r.isConfirmed) return;
    await this.api.eliminarLeccion(l.id);
    await this.cargarContenido(this.versionActivaId()!);
  }

  // ── Material ──────────────────────────────────────────────────────────────

  /**
   * Sube el archivo a ms-documents y lo cuelga de la lección.
   *
   * El vídeo no pasa por learning-ms: iría a ms-documents de todos modos, así que enviarlo
   * dos veces solo serviría para duplicar el tráfico de un archivo que puede pesar cientos
   * de megas.
   */
  async subirMaterial(l: Leccion, evento: Event): Promise<void> {
    const input = evento.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';

    const limiteMb = 500;
    if (file.size > limiteMb * 1024 * 1024) {
      Swal.fire('Archivo demasiado grande',
        `El material no puede pasar de ${limiteMb} MB. Comprime el vídeo o súbelo por partes.`,
        'info');
      return;
    }

    this.subiendo.set(l.id);
    try {
      const documentId = await this.api.subirArchivo(file, l.id);
      await this.api.agregarRecurso(l.id, {
        tipo: l.tipo === 'VIDEO' ? 'VIDEO' : 'DOCUMENTO',
        titulo: file.name,
        document_id: documentId,
        orden: l.recursos?.length ?? 0,
      });
      await this.cargarContenido(this.versionActivaId()!);
    } catch (e: any) {
      Swal.fire('No se pudo subir',
        e?.error?.message ?? 'Revisa el archivo y la conexión, e inténtalo de nuevo.', 'error');
    } finally {
      this.subiendo.set(null);
    }
  }

  async agregarEnlace(l: Leccion): Promise<void> {
    const { value: url } = await Swal.fire({
      title: 'Enlace del material',
      input: 'url',
      inputPlaceholder: 'https://…',
      showCancelButton: true, confirmButtonText: 'Agregar', cancelButtonText: 'Cancelar',
    });
    if (!url) return;
    await this.api.agregarRecurso(l.id, { tipo: 'ENLACE', titulo: url, url, orden: l.recursos?.length ?? 0 });
    await this.cargarContenido(this.versionActivaId()!);
  }

  async quitarRecurso(recursoId: string): Promise<void> {
    await this.api.eliminarRecurso(recursoId);
    await this.cargarContenido(this.versionActivaId()!);
  }

  iconoDe(tipo: string): string {
    switch (tipo) {
      case 'VIDEO': return 'play_circle';
      case 'PDF': return 'picture_as_pdf';
      case 'ENLACE': return 'link';
      default: return 'article';
    }
  }
}
