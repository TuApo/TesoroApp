import {
  ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, output, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import Swal from 'sweetalert2';

import {
  BannerAdmin, BannerItem, BannerPeticion, CatalogoBanners, DestinoTipo, Diseno, MedioBanner, Orientacion,
  PlantillaBanner, ReglaAudiencia,
} from '../../carrusel/carrusel.models';
import { CarruselService } from '../../carrusel/carrusel.service';
import { BannerSlideComponent } from '../../carrusel/banner-slide.component';
import { SelectorAudienciaComponent } from './selector-audiencia.component';
import { ModuloAccesible, PermissionsService } from '@/app/core/services/permissions.service';

/** Lo que el navegador midió de un archivo antes de subirlo. */
interface Medicion { ancho: number; alto: number; duracionMs?: number; esVideo: boolean; }

const LIMITES_POR_DEFECTO = {
  max_imagen_mb: 8, max_video_mb: 40, min_proporcion_horizontal: 1.3, max_proporcion_vertical: 0.9,
};

/**
 * Editor de un banner del carrusel.
 *
 * Lo que guía el diseño de esta pantalla:
 * - **La vista previa es el componente real del home** (BannerSlideComponent), en sus dos
 *   versiones. Lo que se ve aquí es lo que va a ver la gente.
 * - **Las dos versiones son obligatorias y se validan dos veces**: aquí, midiendo el archivo
 *   antes de subirlo (para decir el problema al instante y no después de subir 30 MB), y en
 *   el backend con las dimensiones reales del archivo, que es la regla de verdad.
 * - **No hay "publicar de todos modos"**: el botón dice exactamente qué falta, con las
 *   mismas palabras que el backend.
 */
@Component({
  selector: 'app-banner-editor',
  standalone: true,
  imports: [FormsModule, MatIconModule, BannerSlideComponent, SelectorAudienciaComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './banner-editor.component.html',
  styleUrl: './banner-editor.component.css',
  host: { '(document:keydown.escape)': 'cerrar()' },
})
export class BannerEditorComponent implements OnInit {
  private readonly api = inject(CarruselService);
  private readonly permisos = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  /** null = banner nuevo. */
  readonly bannerId = input<string | null>(null);
  readonly plantillas = input<PlantillaBanner[]>([]);
  readonly catalogo = input<CatalogoBanners | null>(null);
  /** Plantilla con la que arranca un banner nuevo. */
  readonly plantillaInicial = input<string | null>(null);

  /** true si algo cambió en el servidor (la lista debe recargarse). */
  readonly cerrado = output<boolean>();

  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly banner = signal<BannerAdmin | null>(null);
  readonly form = signal<BannerPeticion>(this.vacio());
  readonly vista = signal<Orientacion>('HORIZONTAL');
  readonly subiendo = signal<Record<Orientacion, boolean>>({ HORIZONTAL: false, VERTICAL: false });
  readonly errorMedio = signal<Record<Orientacion, string>>({ HORIZONTAL: '', VERTICAL: '' });
  /** Archivo recién elegido, para verlo en la vista previa mientras sube. */
  readonly locales = signal<Record<Orientacion, { url: string; video: boolean } | null>>({ HORIZONTAL: null, VERTICAL: null });
  readonly problemas = signal<string[]>([]);
  readonly modulos = signal<ModuloAccesible[]>([]);
  readonly sucio = signal(false);
  private huboCambios = false;

  readonly plantilla = computed(() => this.plantillas().find((p) => p.id === this.form().plantilla_id) ?? null);
  readonly limites = computed(() => this.catalogo()?.limites ?? LIMITES_POR_DEFECTO);
  readonly estado = computed(() => this.banner()?.estado ?? 'BORRADOR');
  readonly publicado = computed(() => this.estado() === 'PUBLICADO');

  readonly orientaciones: Orientacion[] = ['HORIZONTAL', 'VERTICAL'];

  readonly disenos: { valor: Diseno; nombre: string }[] = [
    { valor: 'TEXTO_IZQUIERDA', nombre: 'Texto a la izquierda' },
    { valor: 'TEXTO_CENTRO', nombre: 'Texto centrado' },
    { valor: 'FRANJA_INFERIOR', nombre: 'Franja inferior' },
    { valor: 'TARJETA_LATERAL', nombre: 'Tarjeta lateral' },
    { valor: 'SOLO_MEDIA', nombre: 'Solo imagen o video' },
  ];

  readonly destinos: { valor: DestinoTipo; nombre: string; ayuda: string; icono: string }[] = [
    { valor: 'NINGUNO', nombre: 'Sin enlace', ayuda: 'Solo informa', icono: 'block' },
    { valor: 'DETALLE', nombre: 'Ver detalle', ayuda: 'Abre la descripción completa', icono: 'article' },
    { valor: 'RUTA_INTERNA', nombre: 'Pantalla de la plataforma', ayuda: 'Un módulo o vista', icono: 'dashboard' },
    { valor: 'FORMULARIO', nombre: 'Formulario', ayuda: 'De la plataforma o enlace público', icono: 'assignment' },
    { valor: 'URL_EXTERNA', nombre: 'Enlace externo', ayuda: 'Página fuera de la plataforma', icono: 'open_in_new' },
  ];

  readonly superficies = computed(() => this.catalogo()?.superficies ?? [
    { valor: 'TESORO', nombre: 'Plataforma (web, escritorio y celular)', ayuda: '' },
  ]);

  /** Sugerencias de destino: las pantallas que la persona puede abrir (formularios incluidos). */
  readonly sugerencias = computed(() => {
    const tipo = this.form().destino_tipo;
    const todos = this.modulos();
    if (tipo === 'FORMULARIO') {
      const forms = todos.filter((m) => /formulario|solicitud|encuesta|registro|inscrip/i.test(`${m.nombre} ${m.ruta}`));
      return forms.length ? forms : todos;
    }
    return todos;
  });

  readonly medioH = computed(() => this.medio('HORIZONTAL'));
  readonly medioV = computed(() => this.medio('VERTICAL'));
  /** Miniaturas de cada versión: el medio solo, sin texto encima. */
  readonly muestraH = computed(() => this.soloMedio(this.medioH()));
  readonly muestraV = computed(() => this.soloMedio(this.medioV()));
  /** Escrito como dato: unas llaves dobles literales en la plantilla serían interpolación. */
  readonly variableNombre = '{{nombre}}';

  /** Lo que se pinta en la vista previa: el formulario + lo heredado de la plantilla. */
  readonly previa = computed<BannerItem>(() => {
    const f = this.form();
    const t = this.plantilla();
    const b = this.banner();
    const destinoTipo = f.destino_tipo ?? 'NINGUNO';
    return {
      id: b?.id ?? 'previa',
      titulo: f.titulo || (t?.titulo_ejemplo && !b ? t.titulo_ejemplo : f.titulo) || '',
      subtitulo: f.subtitulo || (t?.subtitulo_ejemplo && !b ? t.subtitulo_ejemplo : f.subtitulo) || '',
      descripcion: f.descripcion,
      etiqueta: f.etiqueta || t?.etiqueta_defecto || null,
      cta_texto: destinoTipo === 'NINGUNO' ? null : (f.cta_texto || t?.cta_defecto || 'Ver más'),
      texto_alternativo: f.texto_alternativo,
      diseno: (f.diseno || t?.diseno || 'TEXTO_IZQUIERDA') as Diseno,
      color_fondo: f.color_fondo || t?.color_fondo || '#0f172a',
      color_texto: f.color_texto || t?.color_texto || '#ffffff',
      color_acento: f.color_acento || t?.color_acento || '#f59e0b',
      oscurecer: f.oscurecer ?? t?.oscurecer ?? 45,
      icono: t?.icono ?? null,
      tipo_comunicado: t?.tipo_comunicado ?? null,
      destino: { tipo: destinoTipo, valor: f.destino_valor, nueva_pestana: f.destino_nueva_pestana },
      duracion_segundos: f.duracion_segundos,
      descartable: f.descartable,
      horizontal: this.medioH(),
      vertical: this.medioV(),
    };
  });

  /** Lo que falta para publicar, calculado aquí para avisar mientras se edita. */
  readonly faltantes = computed(() => {
    const f = this.form();
    const p = this.previa();
    const out: string[] = [];
    if (!f.nombre_interno?.trim()) out.push('Ponle un nombre interno.');
    if (!this.medioH()) out.push('Falta la versión horizontal (computador).');
    if (!this.medioV()) out.push('Falta la versión vertical (celular).');
    if (p.diseno !== 'SOLO_MEDIA' && !f.titulo?.trim()) out.push('Falta el título.');
    if (p.diseno === 'SOLO_MEDIA' && !f.texto_alternativo?.trim() && !f.titulo?.trim()) {
      out.push('Escribe el texto alternativo (qué dice la pieza).');
    }
    if ((f.destino_tipo === 'RUTA_INTERNA' || f.destino_tipo === 'FORMULARIO' || f.destino_tipo === 'URL_EXTERNA')
        && !f.destino_valor?.trim()) out.push('Falta a dónde lleva el botón.');
    if (f.destino_tipo === 'DETALLE' && !f.descripcion?.trim()) out.push('El destino «Ver detalle» necesita la descripción.');
    if (!f.superficies.length) out.push('Elige dónde mostrarlo.');
    return out;
  });

  ngOnInit(): void {
    this.modulos.set(this.permisos.listReadableModules().filter((m) => !!m.ruta));
    const id = this.bannerId();
    if (!id) {
      const t = this.plantillas().find((p) => p.id === this.plantillaInicial()) ?? this.plantillas().find((p) => p.activo) ?? null;
      this.form.set({
        ...this.vacio(),
        plantilla_id: t?.id ?? null,
        etiqueta: t?.etiqueta_defecto ?? null,
        cta_texto: t?.cta_defecto ?? null,
      });
      this.cargando.set(false);
      return;
    }
    this.api.detalle(id).subscribe({
      next: (b) => { this.aplicarServidor(b, true); this.cargando.set(false); },
      error: () => { this.cargando.set(false); Swal.fire('Error', 'No se pudo abrir el banner.', 'error'); this.cerrado.emit(false); },
    });
    this.destroyRef.onDestroy(() => this.liberarLocales());
  }

  // ── formulario ────────────────────────────────────────────────────────────

  campo<K extends keyof BannerPeticion>(k: K, v: BannerPeticion[K]): void {
    this.form.update((f) => ({ ...f, [k]: v }));
    this.sucio.set(true);
  }

  numero(k: 'prioridad' | 'duracion_segundos' | 'oscurecer' | 'max_vistas_usuario', v: string | number | null): void {
    const n = v === '' || v === null || v === undefined ? null : Number(v);
    this.campo(k, (Number.isFinite(n as number) ? n : null) as never);
  }

  elegirPlantilla(t: PlantillaBanner): void {
    const anterior = this.plantilla();
    this.form.update((f) => ({
      ...f,
      plantilla_id: t.id,
      // Etiqueta y botón siguen a la plantilla mientras nadie los haya escrito a mano.
      etiqueta: !f.etiqueta || f.etiqueta === anterior?.etiqueta_defecto ? (t.etiqueta_defecto ?? null) : f.etiqueta,
      cta_texto: !f.cta_texto || f.cta_texto === anterior?.cta_defecto ? (t.cta_defecto ?? null) : f.cta_texto,
    }));
    this.sucio.set(true);
  }

  /** El color efectivo (propio o heredado) para el <input type="color">. */
  colorEfectivo(k: 'color_fondo' | 'color_texto' | 'color_acento'): string {
    return this.form()[k] || this.plantilla()?.[k] || '#000000';
  }

  heredado(k: 'color_fondo' | 'color_texto' | 'color_acento' | 'diseno' | 'oscurecer'): boolean {
    const v = this.form()[k];
    return v === null || v === undefined || v === '';
  }

  alternarSuperficie(valor: string, on: boolean): void {
    const s = new Set(this.form().superficies);
    if (on) s.add(valor); else s.delete(valor);
    this.campo('superficies', [...s]);
  }

  audiencia(reglas: ReglaAudiencia[]): void { this.campo('audiencia', reglas); }

  elegirSugerencia(ruta: string): void {
    const m = this.modulos().find((x) => x.ruta === ruta);
    this.form.update((f) => ({ ...f, destino_valor: ruta, destino_etiqueta: m ? [...m.padres, m.nombre].join(' › ') : f.destino_etiqueta }));
    this.sucio.set(true);
  }

  nombreModulo(ruta: string | null | undefined): string {
    if (!ruta) return '';
    const m = this.modulos().find((x) => x.ruta === ruta);
    return m ? [...m.padres, m.nombre].join(' › ') : '';
  }

  // ── medios ────────────────────────────────────────────────────────────────

  /** El medio a mostrar: el archivo local mientras sube, si no el del servidor. */
  private medio(o: Orientacion): MedioBanner | null {
    const local = this.locales()[o];
    if (local) {
      return { id: 'local-' + o, url: local.url, tipo: local.video ? 'VIDEO' : 'IMAGEN', mime: '', ancho: 0, alto: 0 };
    }
    const b = this.banner();
    return (o === 'HORIZONTAL' ? b?.horizontal : b?.vertical) ?? null;
  }

  async elegirArchivo(o: Orientacion, ev: Event): Promise<void> {
    const inputEl = ev.target as HTMLInputElement;
    const archivo = inputEl.files?.[0];
    inputEl.value = '';
    if (!archivo) return;
    await this.procesarArchivo(o, archivo);
  }

  async soltar(o: Orientacion, ev: DragEvent): Promise<void> {
    ev.preventDefault();
    const archivo = ev.dataTransfer?.files?.[0];
    if (archivo) await this.procesarArchivo(o, archivo);
  }

  private async procesarArchivo(o: Orientacion, archivo: File): Promise<void> {
    this.errorMedio.update((e) => ({ ...e, [o]: '' }));
    const problema = await this.revisarArchivo(o, archivo);
    if (problema) {
      this.errorMedio.update((e) => ({ ...e, [o]: problema }));
      return;
    }
    // Hace falta el banner guardado para colgarle el archivo: si es nuevo, se guarda como
    // borrador en ese momento (con un nombre provisional si no lo tiene).
    if (!this.banner()) {
      if (!this.form().nombre_interno?.trim()) {
        this.campo('nombre_interno', `Banner del ${new Date().toLocaleDateString('es-CO')}`);
      }
      const ok = await this.guardar(false);
      if (!ok) return;
    }
    const id = this.banner()!.id;
    this.ponerLocal(o, { url: URL.createObjectURL(archivo), video: archivo.type.startsWith('video/') });
    this.subiendo.update((s) => ({ ...s, [o]: true }));
    this.api.subirMedio(id, o, archivo).subscribe({
      next: (b) => {
        this.huboCambios = true;
        this.aplicarServidor(b, false);
        this.subiendo.update((s) => ({ ...s, [o]: false }));
        this.ponerLocal(o, null);
      },
      error: (e: HttpErrorResponse) => {
        this.subiendo.update((s) => ({ ...s, [o]: false }));
        this.ponerLocal(o, null);
        this.errorMedio.update((x) => ({ ...x, [o]: this.mensaje(e, 'No se pudo subir el archivo.') }));
      },
    });
  }

  private ponerLocal(o: Orientacion, local: { url: string; video: boolean } | null): void {
    const viejo = this.locales()[o];
    if (viejo && viejo.url !== local?.url) URL.revokeObjectURL(viejo.url);
    this.locales.update((l) => ({ ...l, [o]: local }));
  }

  private liberarLocales(): void {
    for (const l of Object.values(this.locales())) if (l) URL.revokeObjectURL(l.url);
  }

  /**
   * La misma regla que el backend, medida en el navegador: tipo, peso y forma. Si aquí no
   * se puede medir (un formato raro), se deja pasar y decide el servidor.
   */
  private async revisarArchivo(o: Orientacion, f: File): Promise<string | null> {
    const lim = this.limites();
    const esVideo = f.type.startsWith('video/');
    const esImagen = f.type.startsWith('image/');
    if (!esVideo && !esImagen) return 'Formato no admitido: sube JPG, PNG, WEBP, GIF o un video MP4.';
    if (esVideo && f.type !== 'video/mp4') return 'El video debe ser MP4 (H.264). Los .MOV del iPhone hay que exportarlos a MP4.';
    if (f.type === 'image/svg+xml') return 'SVG no se admite: expórtalo a PNG o JPG.';
    const maxMb = esVideo ? lim.max_video_mb : lim.max_imagen_mb;
    if (f.size > maxMb * 1048576) {
      return `Pesa ${(f.size / 1048576).toFixed(1)} MB y el máximo es ${maxMb} MB.`;
    }
    const m = await this.medir(f, esVideo).catch(() => null);
    if (!m || !m.ancho || !m.alto) return null;
    const p = m.ancho / m.alto;
    if (o === 'HORIZONTAL' && p < lim.min_proporcion_horizontal) {
      return `Mide ${m.ancho} × ${m.alto}: es ${p <= lim.max_proporcion_vertical ? 'vertical' : 'casi cuadrado'}. `
        + 'Aquí va la versión HORIZONTAL (ideal 1920 × 640).';
    }
    if (o === 'VERTICAL' && p > lim.max_proporcion_vertical) {
      return `Mide ${m.ancho} × ${m.alto}: es ${p >= lim.min_proporcion_horizontal ? 'horizontal' : 'casi cuadrado'}. `
        + 'Aquí va la versión VERTICAL para celular (ideal 1080 × 1350).';
    }
    return null;
  }

  private medir(f: File, esVideo: boolean): Promise<Medicion> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(f);
      const fin = (m: Medicion | null) => { URL.revokeObjectURL(url); m ? resolve(m) : reject(new Error('sin medidas')); };
      if (esVideo) {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.muted = true;
        v.onloadedmetadata = () => fin({ ancho: v.videoWidth, alto: v.videoHeight, duracionMs: v.duration * 1000, esVideo: true });
        v.onerror = () => fin(null);
        v.src = url;
      } else {
        const img = new Image();
        img.onload = () => fin({ ancho: img.naturalWidth, alto: img.naturalHeight, esVideo: false });
        img.onerror = () => fin(null);
        img.src = url;
      }
    });
  }

  // ── guardar y publicar ────────────────────────────────────────────────────

  /** Guarda (crea o edita). Devuelve si salió bien. */
  guardar(avisar = true): Promise<boolean> {
    const f = this.form();
    if (!f.nombre_interno?.trim()) {
      this.problemas.set(['Ponle un nombre interno al banner (solo lo ve Marketing).']);
      return Promise.resolve(false);
    }
    this.guardando.set(true);
    this.problemas.set([]);
    const b = this.banner();
    const peticion: Observable<BannerAdmin> = b ? this.api.editar(b.id, this.limpio(f)) : this.api.crear(this.limpio(f));
    return new Promise((resolve) => {
      peticion.subscribe({
        next: (r) => {
          this.huboCambios = true;
          this.aplicarServidor(r, false);
          this.guardando.set(false);
          this.sucio.set(false);
          if (avisar) this.toast('Guardado');
          resolve(true);
        },
        error: (e: HttpErrorResponse) => {
          this.guardando.set(false);
          this.problemas.set(e.error?.problemas ?? [this.mensaje(e, 'No se pudo guardar.')]);
          resolve(false);
        },
      });
    });
  }

  async publicar(): Promise<void> {
    if (this.sucio() || !this.banner()) {
      const ok = await this.guardar(false);
      if (!ok) return;
    }
    this.cambiarEstado('PUBLICADO', 'Publicado: ya sale en el home de su audiencia.');
  }

  pausar(): void { this.cambiarEstado('PAUSADO', 'Pausado: dejó de mostrarse.'); }

  private cambiarEstado(estado: string, mensaje: string): void {
    const b = this.banner();
    if (!b) return;
    this.guardando.set(true);
    this.api.cambiarEstado(b.id, estado).subscribe({
      next: (r) => {
        this.huboCambios = true;
        this.aplicarServidor(r, false);
        this.guardando.set(false);
        this.problemas.set([]);
        this.toast(mensaje);
      },
      error: (e: HttpErrorResponse) => {
        this.guardando.set(false);
        this.problemas.set(e.error?.problemas ?? [this.mensaje(e, 'No se pudo cambiar el estado.')]);
      },
    });
  }

  async cerrar(): Promise<void> {
    if (this.sucio()) {
      const r = await Swal.fire({
        title: '¿Salir sin guardar?', text: 'Hay cambios que no se han guardado.', icon: 'question',
        showCancelButton: true, confirmButtonText: 'Salir sin guardar', cancelButtonText: 'Seguir editando',
      });
      if (!r.isConfirmed) return;
    }
    this.cerrado.emit(this.huboCambios);
  }

  // ── auxiliares ────────────────────────────────────────────────────────────

  private soloMedio(m: MedioBanner | null): BannerItem | null {
    if (!m) return null;
    return {
      id: m.id, diseno: 'SOLO_MEDIA', color_fondo: '#111111', color_texto: '#ffffff', color_acento: '#ffffff',
      oscurecer: 0, destino: { tipo: 'NINGUNO' }, duracion_segundos: 7, descartable: false, horizontal: m, vertical: m,
    };
  }

  private aplicarServidor(b: BannerAdmin, cargarFormulario: boolean): void {
    this.banner.set(b);
    if (cargarFormulario) {
      const p = b.propios ?? {};
      this.form.set({
        nombre_interno: b.nombre_interno,
        plantilla_id: b.plantilla_id ?? null,
        campana_id: b.campana_id ?? null,
        titulo: p.titulo ?? null,
        subtitulo: p.subtitulo ?? null,
        descripcion: p.descripcion ?? null,
        etiqueta: p.etiqueta ?? null,
        cta_texto: p.cta_texto ?? null,
        texto_alternativo: p.texto_alternativo ?? null,
        diseno: (p.diseno ?? null) as Diseno | null,
        color_fondo: p.color_fondo ?? null,
        color_texto: p.color_texto ?? null,
        color_acento: p.color_acento ?? null,
        oscurecer: p.oscurecer ?? null,
        destino_tipo: (p.destino_tipo ?? 'NINGUNO') as DestinoTipo,
        destino_valor: p.destino_valor ?? null,
        destino_etiqueta: p.destino_etiqueta ?? null,
        destino_nueva_pestana: !!p.destino_nueva_pestana,
        vigente_desde: b.vigente_desde_local ?? null,
        vigente_hasta: b.vigente_hasta_local ?? null,
        prioridad: b.prioridad ?? 50,
        fijado: !!b.fijado,
        duracion_segundos: p.duracion_segundos ?? 7,
        descartable: p.descartable ?? true,
        max_vistas_usuario: b.max_vistas_usuario ?? null,
        superficies: b.superficies?.length ? b.superficies : ['TESORO'],
        audiencia: (b.audiencia ?? []).map((r) => ({ tipo: r.tipo, valor: r.valor, etiqueta: r.etiqueta, excluir: !!r.excluir })),
      });
      this.sucio.set(false);
    }
  }

  private limpio(f: BannerPeticion): BannerPeticion {
    const t = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);
    return {
      ...f,
      nombre_interno: f.nombre_interno.trim(),
      titulo: t(f.titulo), subtitulo: t(f.subtitulo), descripcion: t(f.descripcion), etiqueta: t(f.etiqueta),
      cta_texto: t(f.cta_texto), texto_alternativo: t(f.texto_alternativo),
      destino_valor: t(f.destino_valor), destino_etiqueta: t(f.destino_etiqueta),
      vigente_desde: t(f.vigente_desde), vigente_hasta: t(f.vigente_hasta),
    };
  }

  private vacio(): BannerPeticion {
    return {
      nombre_interno: '', plantilla_id: null, titulo: null, subtitulo: null, descripcion: null, etiqueta: null,
      cta_texto: null, texto_alternativo: null, diseno: null, color_fondo: null, color_texto: null, color_acento: null,
      oscurecer: null, destino_tipo: 'NINGUNO', destino_valor: null, destino_etiqueta: null, destino_nueva_pestana: false,
      vigente_desde: null, vigente_hasta: null, prioridad: 50, fijado: false, duracion_segundos: 7, descartable: true,
      max_vistas_usuario: null, superficies: ['TESORO'], audiencia: [],
    };
  }

  private mensaje(e: HttpErrorResponse, defecto: string): string {
    if (e.status === 0) return 'Sin conexión con el servidor.';
    if (e.status === 413) return 'El archivo es demasiado grande para el servidor.';
    if (e.status === 403) return 'Solo el equipo de Marketing puede administrar el carrusel.';
    return e.error?.error || defecto;
  }

  private toast(texto: string): void {
    void Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: texto, timer: 2200, showConfirmButton: false });
  }
}
