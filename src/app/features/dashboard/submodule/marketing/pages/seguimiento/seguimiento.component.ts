import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';

import {
  Adjunto, DetalleSeguimiento, MarketingService, PostGenerado, VacanteSeguimiento,
} from '../../service/marketing.service';

/**
 * Seguimiento de vacantes.
 *
 * <p><b>Para qué existe.</b> El módulo sabía generar material para UNA vacante que alguien
 * fuera a buscar. No había forma de mirar las que están abiertas y ver cuáles salieron a la
 * calle y cuáles no. Por eso la lista arranca ordenada por las que <b>no tienen material</b>:
 * lo que se ve primero es lo que falta.
 */
@Component({
  selector: 'app-mk-seguimiento',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './seguimiento.component.html',
  styleUrl: './seguimiento.component.css',
})
export class SeguimientoComponent implements OnInit, OnDestroy {
  private readonly api = inject(MarketingService);

  readonly cargando = signal(true);
  readonly lista = signal<VacanteSeguimiento[]>([]);
  readonly total = signal(0);
  readonly sinMaterial = signal(0);
  readonly aviso = signal<string | null>(null);

  readonly filtro = signal('');
  readonly busca = signal('');

  readonly abierta = signal<VacanteSeguimiento | null>(null);
  readonly detalle = signal<DetalleSeguimiento | null>(null);
  readonly cargandoDetalle = signal(false);
  readonly trabajando = signal<string | null>(null);
  readonly previas = signal<Record<string, string>>({});

  readonly estados = [
    { clave: '', etiqueta: 'Todas' },
    { clave: 'SIN_MATERIAL', etiqueta: 'Sin material' },
    { clave: 'EN_PROCESO', etiqueta: 'En proceso' },
    { clave: 'LISTA', etiqueta: 'Listas' },
    { clave: 'PUBLICADA', etiqueta: 'Publicadas' },
  ];

  readonly tiposContenido = [
    { clave: 'FOTO_LUGAR', etiqueta: 'Foto del lugar' },
    { clave: 'FOTO_EQUIPO', etiqueta: 'Foto del equipo' },
    { clave: 'FOTO_PRODUCTO', etiqueta: 'Foto del producto' },
    { clave: 'VIDEO', etiqueta: 'Video' },
    { clave: 'AUDIO', etiqueta: 'Audio' },
    { clave: 'DOCUMENTO', etiqueta: 'Documento' },
    { clave: 'OTRO', etiqueta: 'Otro' },
  ];

  /** Lo que hay que resolver, en una cifra. */
  readonly urgente = computed(() => this.sinMaterial());

  ngOnInit(): void { this.cargar(); }

  ngOnDestroy(): void {
    for (const url of Object.values(this.previas())) URL.revokeObjectURL(url);
  }

  cargar(): void {
    this.cargando.set(true);
    this.api.seguimiento(this.filtro() || undefined, this.busca() || undefined).subscribe({
      next: (r) => {
        this.lista.set(r.vacantes);
        this.total.set(r.total);
        this.sinMaterial.set(r.sin_material ?? 0);
        this.aviso.set(r.aviso ?? null);
        this.cargando.set(false);
      },
      error: () => { this.cargando.set(false); this.aviso.set('No se pudo cargar el listado.'); },
    });
  }

  filtrar(estado: string): void { this.filtro.set(estado); this.cargar(); }
  buscar(q: string): void { this.busca.set(q); this.cargar(); }

  // ── detalle ─────────────────────────────────────────────────────────────

  abrir(v: VacanteSeguimiento): void {
    this.abierta.set(v);
    this.detalle.set(null);
    this.cargandoDetalle.set(true);
    this.api.detalleSeguimiento(v.vacante_id).subscribe({
      next: (d) => {
        this.detalle.set(d);
        this.cargandoDetalle.set(false);
        for (const a of d.adjuntos) if (a.es_imagen) this.previa(a);
      },
      error: () => this.cargandoDetalle.set(false),
    });
  }

  cerrar(): void { this.abierta.set(null); this.detalle.set(null); }

  private refrescar(): void {
    const v = this.abierta();
    if (v) this.abrir(v);
    this.cargar();
  }

  previa(a: Adjunto): void {
    if (this.previas()[a.id]) return;
    this.api.archivoAdjunto(a.id).subscribe({
      next: (b) => this.previas.set({ ...this.previas(), [a.id]: URL.createObjectURL(b) }),
      error: () => {},
    });
  }

  urlPrevia(a: Adjunto): string | null { return this.previas()[a.id] ?? null; }

  // ── acciones ────────────────────────────────────────────────────────────

  generarPiezas(): void {
    const v = this.abierta();
    if (!v) return;
    this.trabajando.set('piezas');
    this.api.generarPiezasDe(v.vacante_id).subscribe({
      next: (r) => {
        this.trabajando.set(null);
        this.refrescar();
        Swal.fire({ icon: 'success', title: 'Material generado',
                    text: `${r.generadas} nuevas, ${r.reutilizadas} reutilizadas.`,
                    timer: 2200, showConfirmButton: false });
      },
      error: () => { this.trabajando.set(null);
                     Swal.fire({ icon: 'error', title: 'No se pudieron generar las piezas' }); },
    });
  }

  generarPost(tonoId: string, tonoNombre: string): void {
    const v = this.abierta();
    if (!v) return;
    this.trabajando.set('post-' + tonoId);
    this.api.generarPost(v.vacante_id, tonoId).subscribe({
      next: () => { this.trabajando.set(null); this.refrescar(); },
      error: (e) => {
        this.trabajando.set(null);
        // El backend explica si fue la IA o el filtro legal: repetirlo es más útil que
        // un "error al generar" que no dice si reintentar sirve de algo.
        Swal.fire({ icon: 'warning', title: `No salió el post «${tonoNombre}»`,
                    text: e?.error?.error ?? 'No se pudo generar' });
      },
    });
  }

  async copiarPost(p: PostGenerado): Promise<void> {
    try {
      await navigator.clipboard.writeText(p.texto);
      Swal.fire({ icon: 'success', title: 'Copiado', timer: 1200, showConfirmButton: false });
    } catch {
      Swal.fire({ icon: 'info', title: 'Copia esto', text: p.texto });
    }
  }

  async editarPost(p: PostGenerado): Promise<void> {
    const r = await Swal.fire({
      title: 'Editar el texto',
      input: 'textarea',
      inputValue: p.texto,
      inputAttributes: { rows: '8' },
      showCancelButton: true, confirmButtonText: 'Guardar', cancelButtonText: 'Cancelar',
    });
    if (!r.isConfirmed || !r.value?.trim()) return;
    this.api.editarPost(p.id, { texto: r.value.trim() }).subscribe({
      next: () => this.refrescar(),
      error: () => Swal.fire({ icon: 'error', title: 'No se pudo guardar' }),
    });
  }

  cambiarEstadoPost(p: PostGenerado, estado: string): void {
    this.api.editarPost(p.id, { estado: estado as PostGenerado['estado'] }).subscribe({
      next: () => this.refrescar(),
      error: () => Swal.fire({ icon: 'error', title: 'No se pudo cambiar el estado' }),
    });
  }

  // ── adjuntos ────────────────────────────────────────────────────────────

  async adjuntar(evento: Event): Promise<void> {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0];
    const v = this.abierta();
    if (!archivo || !v) return;
    input.value = '';

    const opciones = this.tiposContenido
      .map((t) => `<option value="${t.clave}">${t.etiqueta}</option>`).join('');
    const r = await Swal.fire({
      title: 'Clasificar el archivo',
      html: `<input id="t" class="swal2-input" placeholder="Título" maxlength="200">
             <select id="k" class="swal2-select">${opciones}</select>
             <input id="d" class="swal2-input" placeholder="¿Qué se ve? (ayuda a la IA)">
             <label style="display:flex;gap:8px;align-items:center;margin-top:.7rem;font-size:.9rem">
               <input id="p" type="checkbox"> Salen personas identificables
             </label>`,
      focusConfirm: false, showCancelButton: true,
      confirmButtonText: 'Subir', cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const t = (document.getElementById('t') as HTMLInputElement).value.trim();
        if (!t) { Swal.showValidationMessage('Ponle un título'); return false; }
        return {
          titulo: t,
          tipo: (document.getElementById('k') as HTMLSelectElement).value,
          descripcion: (document.getElementById('d') as HTMLInputElement).value.trim(),
          personas: (document.getElementById('p') as HTMLInputElement).checked,
        };
      },
    });
    if (!r.isConfirmed || !r.value) return;

    const fd = new FormData();
    fd.append('archivo', archivo);
    fd.append('titulo', r.value.titulo);
    fd.append('tipoContenido', r.value.tipo);
    if (r.value.descripcion) fd.append('descripcion', r.value.descripcion);
    fd.append('tienePersonas', String(r.value.personas));

    this.trabajando.set('adjunto');
    this.api.adjuntar(v.vacante_id, fd).subscribe({
      next: (a) => {
        this.trabajando.set(null);
        this.refrescar();
        if (a.tiene_personas && !a.consentimiento_ok) {
          Swal.fire({ icon: 'info', title: 'Subido, pero no se usará todavía',
                      text: 'Marcaste que salen personas: hasta que no haya autorización '
                          + 'firmada, este archivo no entra en material público.' });
        }
      },
      error: (e) => { this.trabajando.set(null);
                      Swal.fire({ icon: 'error', title: 'No se pudo subir',
                                  text: e?.error?.error ?? '' }); },
    });
  }

  marcarConsentimiento(a: Adjunto): void {
    this.api.reclasificar(a.id, { consentimiento_ok: !a.consentimiento_ok }).subscribe({
      next: () => this.refrescar(),
      error: () => Swal.fire({ icon: 'error', title: 'No se pudo cambiar' }),
    });
  }

  async retirar(a: Adjunto): Promise<void> {
    const r = await Swal.fire({
      icon: 'warning', title: `¿Retirar «${a.titulo}»?`,
      text: 'Deja de estar disponible para el material de esta vacante.',
      showCancelButton: true, confirmButtonText: 'Retirar', cancelButtonText: 'Cancelar',
    });
    if (!r.isConfirmed) return;
    this.api.retirarAdjunto(a.id).subscribe({
      next: () => this.refrescar(),
      error: () => Swal.fire({ icon: 'error', title: 'No se pudo retirar' }),
    });
  }

  // ── presentación ────────────────────────────────────────────────────────

  etiquetaEstado(e: string): string {
    return this.estados.find((x) => x.clave === e)?.etiqueta ?? e;
  }

  /** Lo que le falta a esta vacante, en una frase. */
  queFalta(v: VacanteSeguimiento): string | null {
    if (v.piezas === 0) return 'Sin piezas gráficas';
    if (v.posts === 0) return 'Sin texto para publicar';
    return null;
  }
}
