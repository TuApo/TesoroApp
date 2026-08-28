import {
  Component, ChangeDetectionStrategy, OnInit, OnDestroy, inject, signal, computed
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { BlockCard, TIPOS_DE_BLOQUE, metaDeBloque } from '../../components/block-card/block-card';
import Swal from 'sweetalert2';
import {
  TrainingAdminService, Curso, Version, ContenidoVersion, Modulo, Leccion,
  VersionIa, LeccionIa, MaterialIa, EtiquetaIa, Bloque, BloqueRequest, TipoBloque, Banco
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
  imports: [CommonModule, FormsModule, MatIconModule, BlockCard],
  templateUrl: './admin-course-detail.html',
  styleUrl: './admin-course-detail.css'
})
export class AdminCourseDetail implements OnInit, OnDestroy {
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

  /** Etiquetado por IA de la versión abierta. null = todavía no se ha podido leer. */
  readonly ia = signal<VersionIa | null>(null);
  readonly revisando = signal<string | null>(null);

  /**
   * Sondeo mientras haya material en cola.
   *
   * Transcribir un vídeo tarda minutos y el backend no puede avisar (no hay websocket en esta
   * app). Sin esto, quien sube una clase ve "En cola" para siempre hasta que recarga a mano y
   * concluye que el etiquetado no funciona. El temporizador SOLO vive mientras queda trabajo:
   * en cuanto todo está listo se apaga solo.
   */
  private sondeo?: ReturnType<typeof setInterval>;

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

  /** Índice por lección: la plantilla no puede recorrer un array por cada tarjeta. */
  readonly iaPorLeccion = computed<Map<string, LeccionIa>>(() =>
    new Map((this.ia()?.lecciones ?? []).map(l => [l.lesson_id, l])));

  readonly etiquetadoActivo = computed(() => this.ia()?.etiquetado_habilitado ?? false);

  readonly hayTrabajoEnCurso = computed(() =>
    (this.ia()?.lecciones ?? []).some(l =>
      l.materiales.some(m => m.estado === 'PENDIENTE' || m.estado === 'PROCESANDO')));

  async ngOnInit(): Promise<void> {
    this.courseId = this.ruta.snapshot.paramMap.get('courseId') ?? '';
    await this.cargar();
  }

  ngOnDestroy(): void {
    this.detenerSondeo();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const [curso, versiones] = await Promise.all([
        this.api.obtenerCurso(this.courseId),
        this.api.versiones(this.courseId),
      ]);
      // Para el selector de preguntas del quiz. Falla en silencio: no poder listar los bancos
      // no puede impedir armar el resto del curso.
      this.api.listarBancos().then(p => this.bancos.set(p.content ?? [])).catch(() => {});
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
    await this.cargarIa(versionId);
  }

  /**
   * El estado del etiquetado. Falla en silencio a propósito: si la IA no está configurada en
   * este entorno, el curso se tiene que poder seguir armando igual.
   */
  private async cargarIa(versionId: string): Promise<void> {
    try {
      this.ia.set(await this.api.estadoIa(versionId));
    } catch {
      this.ia.set(null);
    }
    this.ajustarSondeo(versionId);
  }

  private ajustarSondeo(versionId: string): void {
    this.detenerSondeo();
    if (!this.hayTrabajoEnCurso()) return;
    this.sondeo = setInterval(async () => {
      if (this.versionActivaId() !== versionId) { this.detenerSondeo(); return; }
      try {
        this.ia.set(await this.api.estadoIa(versionId));
      } catch { /* un fallo suelto no apaga el sondeo: la siguiente vuelta reintenta */ }
      if (!this.hayTrabajoEnCurso()) this.detenerSondeo();
    }, 15000);
  }

  private detenerSondeo(): void {
    if (this.sondeo) { clearInterval(this.sondeo); this.sondeo = undefined; }
  }

  // ── Etiquetado por IA ─────────────────────────────────────────────────────

  materialesDe(lessonId: string): MaterialIa[] {
    return this.iaPorLeccion().get(lessonId)?.materiales ?? [];
  }

  /** Lo descartado no se pinta: la pantalla es para decidir, no para revisar lo ya decidido. */
  etiquetasDe(lessonId: string): EtiquetaIa[] {
    return (this.iaPorLeccion().get(lessonId)?.etiquetas ?? [])
      .filter(t => t.estado !== 'DESCARTADA');
  }

  estadoTexto(m: MaterialIa): string {
    switch (m.estado) {
      case 'PENDIENTE':  return 'En cola para etiquetar';
      case 'PROCESANDO': return 'Transcribiendo…';
      case 'LISTO':      return m.duracion_seg ? `Transcrito · ${Math.round(m.duracion_seg / 60)} min`
                                               : 'Transcrito';
      case 'FALLIDO':    return 'No se pudo transcribir';
      default:           return 'Sin transcripción';
    }
  }

  iconoEstado(m: MaterialIa): string {
    switch (m.estado) {
      case 'PENDIENTE':  return 'schedule';
      case 'PROCESANDO': return 'autorenew';
      case 'LISTO':      return 'auto_awesome';
      case 'FALLIDO':    return 'error_outline';
      default:           return 'remove_circle_outline';
    }
  }

  async confirmarEtiqueta(t: EtiquetaIa): Promise<void> {
    await this.revisar(t.id, () => this.api.confirmarEtiqueta(t.id));
  }

  async descartarEtiqueta(t: EtiquetaIa): Promise<void> {
    await this.revisar(t.id, () => this.api.descartarEtiqueta(t.id));
  }

  private async revisar(id: string, accion: () => Promise<EtiquetaIa>): Promise<void> {
    this.revisando.set(id);
    try {
      await accion();
      await this.cargarIa(this.versionActivaId()!);
    } catch (e: any) {
      Swal.fire('No se pudo guardar', e?.error?.message ?? 'Inténtalo de nuevo.', 'error');
    } finally {
      this.revisando.set(null);
    }
  }

  async agregarEtiqueta(l: Leccion): Promise<void> {
    const { value: etiqueta } = await Swal.fire({
      title: 'Etiqueta de la lección',
      input: 'text',
      inputPlaceholder: 'Ej: manejo de agroquímicos',
      inputAttributes: { maxlength: '80' },
      showCancelButton: true, confirmButtonText: 'Agregar', cancelButtonText: 'Cancelar',
    });
    if (!etiqueta?.trim()) return;
    try {
      await this.api.agregarEtiqueta(l.id, etiqueta.trim());
      await this.cargarIa(this.versionActivaId()!);
    } catch (e: any) {
      Swal.fire('No se pudo agregar', e?.error?.message ?? 'Inténtalo de nuevo.', 'error');
    }
  }

  async reintentarEtiquetado(m: MaterialIa): Promise<void> {
    try {
      await this.api.reprocesarMaterial(m.resource_id);
      await this.cargarIa(this.versionActivaId()!);
    } catch (e: any) {
      Swal.fire('No se pudo reencolar', e?.error?.message ?? 'Inténtalo de nuevo.', 'error');
    }
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

  /**
   * Descarta el borrador entero.
   *
   * Un curso admite un solo borrador a la vez, así que sin esto un intento a medias dejaba el
   * curso bloqueado: no se podía abrir otro ni volver a empezar. El diálogo obliga a escribir
   * DESCARTAR porque no hay deshacer y se lleva por delante todo el contenido de la versión.
   */
  async descartarBorrador(): Promise<void> {
    const v = this.version();
    if (!v) return;
    const esLaUnica = this.versiones().length === 1;

    const r = await Swal.fire({
      title: `¿Descartar la versión ${v.version}?`,
      html: 'Se elimina <strong>todo</strong> su contenido: módulos, lecciones, material, '
          + 'actividades y el quiz.<br><strong>Esto no se puede deshacer.</strong>'
          + (esLaUnica
              ? '<br><br>Es la única versión del curso: quedará vacío y tendrás que crear una nueva.'
              : ''),
      icon: 'warning',
      input: 'text',
      inputPlaceholder: 'Escribe DESCARTAR',
      showCancelButton: true,
      confirmButtonText: 'Descartar', cancelButtonText: 'Cancelar',
      confirmButtonColor: '#c62828',
      inputValidator: valor =>
        valor?.trim().toUpperCase() === 'DESCARTAR' ? null : 'Escribe DESCARTAR para confirmar',
    });
    if (!r.isConfirmed) return;

    this.ocupado.set(true);
    try {
      await this.api.descartarBorrador(this.courseId, v.id);
      await this.cargar();
      Swal.fire('Borrador descartado',
        esLaUnica ? 'El curso quedó sin versiones. Crea una nueva para empezar.'
                  : 'Ya puedes crear otra versión.', 'success');
    } catch (e: any) {
      Swal.fire('No se pudo descartar', e?.error?.message ?? 'Inténtalo de nuevo.', 'error');
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

  // ── Bloques de la lección ─────────────────────────────────────────────────
  //
  // Esto sustituye a la subida suelta de archivos y al "agregar enlace" que vivían aquí. No es
  // limpieza cosmética: aquellos creaban recursos SIN bloque, así que el archivo no aparecía
  // en el recorrido y no había forma de colocarlo ni de quitarlo desde esta pantalla. Ahora
  // todo el contenido entra por `agregarBloque`, que crea el bloque y su carga en la misma
  // transacción del backend.

  /**
   * El catálogo de bloques. Se importa de la tarjeta en vez de repetirse aquí: el menú de
   * "agregar" y la cabecera de cada bloque tienen que decir lo mismo, y dos listas paralelas
   * es cómo se acaba con un icono en el menú y otro en la tarjeta.
   */
  readonly tiposDeBloque = TIPOS_DE_BLOQUE;

  /** Bancos de preguntas, para el selector del quiz dentro de la tarjeta. */
  readonly bancos = signal<Banco[]>([]);

  /** Lección con el menú de bloques abierto. null = ninguno. */
  readonly menuBloques = signal<string | null>(null);
  readonly guardandoBloque = signal<string | null>(null);

  /** La tarjeta guardó algo por su cuenta; hay que releer el árbol. */
  async refrescarContenido(): Promise<void> {
    const v = this.versionActivaId();
    if (v) await this.cargarContenido(v);
  }

  bloquesDe(l: Leccion): Bloque[] {
    return l.bloques ?? [];
  }

  metaDe(tipo: string) {
    return metaDeBloque(tipo);
  }

  /** El quiz es uno por lección: si ya está puesto, el menú lo muestra deshabilitado. */
  yaTieneQuiz(l: Leccion): boolean {
    return this.bloquesDe(l).some(b => b.tipo === 'QUIZ');
  }

  abrirMenuBloques(l: Leccion): void {
    this.menuBloques.set(this.menuBloques() === l.id ? null : l.id);
  }

  /**
   * Agrega el bloque y lo deja listo para editar en su tarjeta.
   *
   * Salvo los archivos, NO se pregunta nada antes: el bloque nace vacío al elegir el tipo y se
   * redacta en sitio, como un campo en el constructor de formularios. Antes cada tipo abría un
   * diálogo, y armar un taller de diez bloques eran diez ventanas que tapaban justo lo que hay
   * que mirar: el conjunto. Un bloque a medias no deja publicar, así que nada se escapa.
   *
   * Los archivos son la excepción porque el bloque no existe sin su document_id.
   */
  async agregarBloque(l: Leccion, tipo: TipoBloque): Promise<void> {
    this.menuBloques.set(null);
    const necesitaArchivo = tipo === 'VIDEO' || tipo === 'DOCUMENTO'
                         || tipo === 'PRESENTACION' || tipo === 'IMAGEN';
    if (necesitaArchivo) return this.pedirArchivo(l, tipo);
    await this.crearBloque(l, { tipo });
  }




  /**
   * Sube el archivo a gestión documental y cuelga el bloque de la referencia.
   *
   * El archivo NO pasa por learning-ms: acabaría en gestión documental de todos modos, y
   * mandarlo dos veces solo duplica el tráfico de algo que puede pesar cientos de megas.
   */
  private async pedirArchivo(l: Leccion, tipo: TipoBloque): Promise<void> {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = this.aceptaDe(tipo);
    const archivo = await new Promise<File | null>(resolve => {
      input.onchange = () => resolve(input.files?.[0] ?? null);
      input.oncancel = () => resolve(null);
      input.click();
    });
    if (!archivo) return;

    const limiteMb = 500;
    if (archivo.size > limiteMb * 1024 * 1024) {
      Swal.fire('Archivo demasiado grande',
        `El material no puede pasar de ${limiteMb} MB. Comprime el vídeo o súbelo por partes.`,
        'info');
      return;
    }

    this.guardandoBloque.set(l.id);
    try {
      const documentId = await this.api.subirArchivo(archivo, l.id);
      await this.crearBloque(l, {
        tipo, titulo: archivo.name, document_id: documentId,
        mime: archivo.type || undefined, bytes: archivo.size,
      });
    } catch (e: any) {
      Swal.fire('No se pudo subir',
        e?.error?.message ?? 'Revisa el archivo y la conexión, e inténtalo de nuevo.', 'error');
    } finally {
      this.guardandoBloque.set(null);
    }
  }

  private aceptaDe(tipo: TipoBloque): string {
    switch (tipo) {
      case 'VIDEO':        return 'video/*,audio/*';
      case 'IMAGEN':       return 'image/*';
      case 'PRESENTACION': return '.ppt,.pptx,.odp,application/pdf';
      default:             return '.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,application/pdf';
    }
  }

  private async crearBloque(l: Leccion, req: BloqueRequest): Promise<void> {
    this.guardandoBloque.set(l.id);
    try {
      await this.api.crearBloque(l.id, req);
      await this.cargarContenido(this.versionActivaId()!);
    } catch (e: any) {
      Swal.fire('No se pudo agregar el bloque', e?.error?.message ?? 'Inténtalo de nuevo.', 'error');
    } finally {
      this.guardandoBloque.set(null);
    }
  }



  /**
   * Sube o baja un bloque. Se manda el orden COMPLETO y no el movimiento: con movimientos
   * sueltos, dos pestañas abiertas dejan el recorrido con huecos o con empates.
   */
  async moverBloque(l: Leccion, b: Bloque, salto: -1 | 1): Promise<void> {
    const orden = this.bloquesDe(l).map(x => x.id);
    const i = orden.indexOf(b.id);
    const j = i + salto;
    if (i < 0 || j < 0 || j >= orden.length) return;
    [orden[i], orden[j]] = [orden[j], orden[i]];

    this.guardandoBloque.set(l.id);
    try {
      await this.api.reordenarBloques(l.id, orden);
      await this.cargarContenido(this.versionActivaId()!);
    } catch (e: any) {
      Swal.fire('No se pudo reordenar', e?.error?.message ?? 'Inténtalo de nuevo.', 'error');
    } finally {
      this.guardandoBloque.set(null);
    }
  }

  async eliminarBloque(b: Bloque): Promise<void> {
    const meta = this.metaDe(b.tipo);
    const r = await Swal.fire({
      title: `¿Quitar el bloque de ${meta.nombre.toLowerCase()}?`,
      text: b.tipo === 'QUIZ'
        ? 'El quiz sale del recorrido pero NO se borra: sus preguntas y los intentos ya '
          + 'presentados se conservan.'
        : 'Se elimina también su contenido.',
      icon: 'warning', showCancelButton: true,
      confirmButtonText: 'Quitar', cancelButtonText: 'Cancelar',
    });
    if (!r.isConfirmed) return;
    try {
      await this.api.eliminarBloque(b.id);
      await this.cargarContenido(this.versionActivaId()!);
    } catch (e: any) {
      Swal.fire('No se pudo quitar', e?.error?.message ?? 'Inténtalo de nuevo.', 'error');
    }
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
