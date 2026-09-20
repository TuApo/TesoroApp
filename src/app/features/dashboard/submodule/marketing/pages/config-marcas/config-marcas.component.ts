import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';

import {
  ActivoMarca, DetalleMarcaConfig, MarcaConfig, MarketingService, PuntoCompletitud, Tono,
} from '../../service/marketing.service';

/**
 * Configuración de IA y marcas.
 *
 * <p><b>Por qué lo obligatorio va separado de lo ampliado.</b> Sin lo obligatorio el módulo
 * produce material incorrecto sin avisar: una marca sin paleta genera piezas con los
 * colores del navegador, y una sin tono hace que la IA escriba en un castellano neutro que
 * no es el de nadie. Lo ampliado no rompe nada, solo acerca el material a la marca.
 * Mezclarlo todo en una lista de veinte huecos hace que no se empiece ninguna.
 */
@Component({
  selector: 'app-mk-config-marcas',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './config-marcas.component.html',
  styleUrl: './config-marcas.component.css',
})
export class ConfigMarcasComponent implements OnInit {
  private readonly api = inject(MarketingService);

  readonly cargando = signal(true);
  readonly marcas = signal<MarcaConfig[]>([]);
  readonly detalle = signal<DetalleMarcaConfig | null>(null);
  readonly pestana = signal<'estado' | 'tonos' | 'paleta' | 'logos' | 'identidad'>('estado');
  readonly activos = signal<ActivoMarca[]>([]);
  readonly subiendo = signal(false);

  /**
   * Los tipos de activo, con para qué sirve cada uno.
   *
   * <p>El texto no es decorativo: sin él, «isotipo» y «logo horizontal» son dos casillas
   * que nadie sabe cuál rellenar, y se acaba subiendo el mismo archivo en las dos.
   */
  readonly tiposActivo = [
    { clave: 'LOGO_PRINCIPAL', etiqueta: 'Logo principal', ayuda: 'El de siempre, a color sobre fondo claro.' },
    { clave: 'LOGO_BLANCO', etiqueta: 'Logo en blanco', ayuda: 'Para fondos de color, donde el de color desaparece.' },
    { clave: 'LOGO_HORIZONTAL', etiqueta: 'Logo horizontal', ayuda: 'Para cabeceras anchas y banners.' },
    { clave: 'ISOTIPO', etiqueta: 'Isotipo', ayuda: 'El símbolo solo, sin el nombre.' },
    { clave: 'MARCA_AGUA', etiqueta: 'Marca de agua', ayuda: 'Versión tenue para superponer sobre fotos.' },
    { clave: 'FONDO', etiqueta: 'Fondo', ayuda: 'Imagen de fondo reutilizable.' },
    { clave: 'TEXTURA', etiqueta: 'Textura', ayuda: 'Trama o patrón de marca.' },
    { clave: 'ICONO', etiqueta: 'Icono', ayuda: 'Pictograma suelto del sistema gráfico.' },
    { clave: 'FUENTE_WOFF2', etiqueta: 'Tipografía (.woff2)', ayuda: 'Se incrusta en cada pieza. Necesita la familia CSS.' },
  ];
  readonly guardando = signal(false);

  /** El tono que se está editando; `null` = el formulario está cerrado. */
  readonly editandoTono = signal<Partial<Tono> | null>(null);

  readonly canales = ['WHATSAPP', 'FACEBOOK', 'INSTAGRAM', 'CARTELERA', 'LINKEDIN'];

  ngOnInit(): void { this.cargar(); }

  private cargar(): void {
    this.cargando.set(true);
    this.api.marcasConfig().subscribe({
      next: (l) => {
        this.marcas.set(l);
        this.cargando.set(false);
        if (l.length && !this.detalle()) this.abrir(l[0]);
      },
      error: () => this.cargando.set(false),
    });
  }

  abrir(m: MarcaConfig): void {
    this.api.detalleMarcaConfig(m.id).subscribe({
      next: (d) => this.detalle.set(d),
      error: () => Swal.fire({ icon: 'error', title: 'No se pudo abrir la marca' }),
    });
    this.api.activosDeMarca(m.id).subscribe({
      next: (a) => this.activos.set(a),
      error: () => this.activos.set([]),
    });
  }

  // ── logos y activos ─────────────────────────────────────────────────────

  /** Qué está cargado de cada tipo, para pintar la rejilla completa y no solo lo que hay. */
  activoDe(tipo: string): ActivoMarca | null {
    return this.activos().find((a) => a.tipo === tipo && a.tiene_archivo) ?? null;
  }

  async subirActivo(evento: Event, tipo: string, etiqueta: string): Promise<void> {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0];
    const d = this.detalle();
    if (!archivo || !d) return;
    input.value = '';

    // Una fuente sin familia CSS no sirve de nada: la plantilla no sabría cómo pedirla y
    // el render caería a la del sistema sin avisar. El backend la exige; se pide aquí.
    let familia = '';
    if (tipo === 'FUENTE_WOFF2') {
      const r = await Swal.fire({
        title: 'Familia CSS de la fuente',
        input: 'text', inputPlaceholder: 'Archivo',
        inputValidator: (v) => (v?.trim() ? null : 'Sin familia, la plantilla no puede usarla'),
        showCancelButton: true, confirmButtonText: 'Subir', cancelButtonText: 'Cancelar',
      });
      if (!r.isConfirmed) return;
      familia = r.value.trim();
    }

    const fd = new FormData();
    fd.append('archivo', archivo);
    fd.append('tipo', tipo);
    fd.append('nombre', etiqueta);
    if (familia) fd.append('familiaCss', familia);

    this.subiendo.set(true);
    this.api.subirActivoMarca(d.id, fd).subscribe({
      next: () => {
        this.subiendo.set(false);
        this.refrescarActivos();
        Swal.fire({ icon: 'success', title: 'Cargado', timer: 1300, showConfirmButton: false });
      },
      error: (e) => {
        this.subiendo.set(false);
        Swal.fire({ icon: 'error', title: 'No se pudo cargar', text: e?.error?.error ?? '' });
      },
    });
  }

  private refrescarActivos(): void {
    const d = this.detalle();
    if (!d) return;
    this.api.activosDeMarca(d.id).subscribe({ next: (a) => this.activos.set(a) });
    this.api.detalleMarcaConfig(d.id).subscribe({ next: (x) => this.detalle.set(x) });
    this.api.marcasConfig().subscribe({ next: (l) => this.marcas.set(l) });
  }

  private refrescar(): void {
    const d = this.detalle();
    if (d) this.api.detalleMarcaConfig(d.id).subscribe({ next: (x) => this.detalle.set(x) });
    this.api.marcasConfig().subscribe({ next: (l) => this.marcas.set(l) });
  }

  // ── tonos ───────────────────────────────────────────────────────────────

  nuevoTono(): void {
    this.editandoTono.set({
      clave: '', nombre: '', descripcion: '', instruccion: '', ejemplo: '',
      canal_sugerido: 'WHATSAPP', formalidad: 3, usa_emojis: false, longitud_max: 600,
    });
  }

  editarTono(t: Tono): void { this.editandoTono.set({ ...t }); }
  cerrarTono(): void { this.editandoTono.set(null); }

  campoTono<K extends keyof Tono>(k: K, v: Tono[K]): void {
    this.editandoTono.set({ ...this.editandoTono(), [k]: v });
  }

  guardarTono(): void {
    const d = this.detalle();
    const t = this.editandoTono();
    if (!d || !t?.nombre || !t?.instruccion) return;
    this.guardando.set(true);
    const obs = t.id
      ? this.api.editarTono(d.id, t.id, t)
      : this.api.crearTono(d.id, { ...t, clave: t.clave || t.nombre });
    obs.subscribe({
      next: () => { this.guardando.set(false); this.editandoTono.set(null); this.refrescar(); },
      error: (e) => {
        this.guardando.set(false);
        Swal.fire({ icon: 'error', title: 'Un momento', text: e?.error?.error ?? 'No se pudo guardar' });
      },
    });
  }

  hacerPredeterminado(t: Tono): void {
    const d = this.detalle();
    if (!d) return;
    this.api.editarTono(d.id, t.id, { predeterminado: true }).subscribe({
      next: () => this.refrescar(),
      error: () => Swal.fire({ icon: 'error', title: 'No se pudo cambiar' }),
    });
  }

  async desactivarTono(t: Tono): Promise<void> {
    const d = this.detalle();
    if (!d) return;
    const r = await Swal.fire({
      icon: 'warning', title: `¿Desactivar «${t.nombre}»?`,
      text: 'Los textos ya escritos con este tono no cambian.',
      showCancelButton: true, confirmButtonText: 'Desactivar', cancelButtonText: 'Cancelar',
    });
    if (!r.isConfirmed) return;
    this.api.desactivarTono(d.id, t.id).subscribe({
      next: () => this.refrescar(),
      error: (e) => Swal.fire({ icon: 'error', title: 'No se puede',
                                text: e?.error?.error ?? '' }),
    });
  }

  // ── paleta e identidad ──────────────────────────────────────────────────

  async editarToken(clave: string, valorActual: string, etiqueta: string): Promise<void> {
    const d = this.detalle();
    if (!d) return;
    const r = await Swal.fire({
      title: etiqueta || clave,
      input: 'text', inputValue: valorActual,
      inputPlaceholder: clave.includes('color') || valorActual.startsWith('#') ? '#RRGGBB' : '',
      showCancelButton: true, confirmButtonText: 'Guardar', cancelButtonText: 'Cancelar',
    });
    if (!r.isConfirmed || !r.value?.trim()) return;
    this.api.fijarToken(d.id, { clave, valor: r.value.trim() }).subscribe({
      next: () => this.refrescar(),
      error: (e) => Swal.fire({ icon: 'error', title: 'No se pudo guardar',
                                text: e?.error?.error ?? '' }),
    });
  }

  async editarIdentidad(campo: 'nombre' | 'descripcion' | 'tono_de_voz',
                        etiqueta: string, actual: string): Promise<void> {
    const d = this.detalle();
    if (!d) return;
    const r = await Swal.fire({
      title: etiqueta,
      input: campo === 'nombre' ? 'text' : 'textarea',
      inputValue: actual ?? '',
      showCancelButton: true, confirmButtonText: 'Guardar', cancelButtonText: 'Cancelar',
    });
    if (!r.isConfirmed) return;
    this.api.editarIdentidad(d.id, { [campo]: r.value ?? '' }).subscribe({
      next: () => this.refrescar(),
      error: () => Swal.fire({ icon: 'error', title: 'No se pudo guardar' }),
    });
  }

  // ── presentación ────────────────────────────────────────────────────────

  esColor(valor: string): boolean { return /^#[0-9a-fA-F]{3,8}$/.test(valor ?? ''); }

  /** Texto legible sobre un color, según su luminancia. Sin esto, blanco sobre blanco. */
  contraste(hex: string): string {
    const h = (hex ?? '').replace('#', '');
    if (h.length < 6) return '#0f172a';
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#0f172a' : '#ffffff';
  }

  tokensDe(grupo: string): DetalleMarcaConfig['tokens'] {
    return (this.detalle()?.tokens ?? []).filter((t) => t.grupo === grupo);
  }

  faltan(puntos: PuntoCompletitud[]): PuntoCompletitud[] {
    return puntos.filter((p) => !p.cumple);
  }
}
