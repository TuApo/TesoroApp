import {
  ChangeDetectionStrategy, Component, DestroyRef, ViewEncapsulation, computed, effect, inject, input, output, signal, untracked,
} from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonToggleModule } from '@angular/material/button-toggle';

import {
  ConocimientoService, DocDetalle, DocDto, FragmentoDto, GrafoDto, ModuloKbDto, NodoDto,
} from '../../service/conocimiento.service';
import { markdownToHtml } from '../../../nomina/pages/analitica-nomina-ia/markdown-lite';
import { GrafoKbComponent, colorCategoria, nombreCategoria } from './grafo-kb.component';
import { mensajeDeError } from '../../../../../../shared/utils/mensaje-error';

type Vista = 'red' | 'contenido' | 'fragmentos' | 'conceptos';

/**
 * Vista individual de una base: cómo quedó después de Docling (Markdown), en qué fragmentos
 * la parte el buscador, qué conceptos le sacó la IA y cómo se conecta con las demás bases.
 * Mientras la base se procesa, la vista se refresca sola.
 */
@Component({
  selector: 'app-kb-detalle',
  standalone: true,
  imports: [
    DatePipe, DecimalPipe, FormsModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule,
    MatTooltipModule, MatButtonToggleModule, GrafoKbComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // El Markdown se pinta con [innerHTML]: sus estilos van sin encapsular, namespaced en .kbd-md.
  encapsulation: ViewEncapsulation.None,
  templateUrl: './kb-detalle.component.html',
  styleUrls: ['./kb-detalle.component.css'],
})
export class KbDetalleComponent {
  private svc = inject(ConocimientoService);
  private destroyRef = inject(DestroyRef);

  readonly docId = input.required<number>();
  readonly modulos = input<ModuloKbDto[]>([]);
  readonly cambiado = output<DocDto>();
  readonly eliminado = output<number>();
  readonly construir = output<DocDetalle>();
  readonly abrirBase = output<number>();

  readonly detalle = signal<DocDetalle | null>(null);
  readonly grafo = signal<GrafoDto | null>(null);
  readonly fragmentos = signal<FragmentoDto[] | null>(null);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly vista = signal<Vista>('red');
  readonly editandoNombre = signal(false);
  readonly nombreEdit = signal('');
  readonly filtroFrag = signal('');
  readonly ocupado = signal(false);

  readonly doc = computed(() => this.detalle()?.doc ?? null);
  readonly procesando = computed(() => this.doc()?.estado === 'PROCESANDO');
  readonly html = computed(() => markdownToHtml(this.detalle()?.contenido ?? ''));
  readonly nombresModulo = computed(() => Object.fromEntries(this.modulos().map((m) => [m.clave, m.nombre])));

  readonly fragmentosFiltrados = computed(() => {
    const f = this.fragmentos() ?? [];
    const q = this.filtroFrag().trim().toLowerCase();
    return q ? f.filter((x) => x.contenido.toLowerCase().includes(q) || (x.seccion ?? '').toLowerCase().includes(q)) : f;
  });

  /** Conceptos agrupados por tipo, para la pestaña «Conceptos». */
  readonly conceptosPorTipo = computed(() => {
    const grupos = new Map<string, { tipo: string; color: string; nombre: string; items: DocDetalle['conceptos'] }>();
    for (const c of this.detalle()?.conceptos ?? []) {
      const cat = 'concepto:' + c.tipo;
      if (!grupos.has(cat)) grupos.set(cat, { tipo: c.tipo, color: colorCategoria(cat), nombre: nombreCategoria(cat), items: [] });
      grupos.get(cat)!.items.push(c);
    }
    return [...grupos.values()].sort((a, b) => b.items.length - a.items.length);
  });

  readonly nombreConcepto = computed(() => {
    const m = new Map<string, string>();
    for (const c of this.detalle()?.conceptos ?? []) m.set(c.clave, c.nombre);
    return m;
  });

  private sondeo: ReturnType<typeof setInterval> | null = null;

  constructor() {
    effect(() => {
      const id = this.docId();
      untracked(() => {
        this.detalle.set(null);
        this.grafo.set(null);
        this.fragmentos.set(null);
        this.vista.set('red');
        this.cargar(id);
      });
    });
    // Mientras Docling/IA trabajan, refrescar cada 4 s; al terminar, traer la red.
    effect(() => {
      const proc = this.procesando();
      untracked(() => {
        if (proc && !this.sondeo) {
          this.sondeo = setInterval(() => this.cargar(this.docId(), true), 4000);
        } else if (!proc && this.sondeo) {
          clearInterval(this.sondeo);
          this.sondeo = null;
        }
      });
    });
    this.destroyRef.onDestroy(() => { if (this.sondeo) clearInterval(this.sondeo); });
  }

  private cargar(id: number, silencioso = false): void {
    if (!silencioso) this.cargando.set(true);
    const antes = this.doc()?.estado;
    this.svc.detalle(id).subscribe({
      next: (d) => {
        this.detalle.set(d);
        this.cargando.set(false);
        if (antes && antes !== d.doc.estado) this.cambiado.emit(d.doc);
        if (!silencioso || antes !== d.doc.estado) this.cargarGrafo(id);
        if (this.vista() === 'fragmentos' && (!silencioso || antes !== d.doc.estado)) this.cargarFragmentos();
      },
      error: (e) => { this.cargando.set(false); this.error.set(mensajeDeError(e, 'No se pudo abrir la base.')); },
    });
  }

  private cargarGrafo(id: number): void {
    this.svc.grafoDocumento(id).subscribe({
      next: (g) => this.grafo.set(g),
      error: () => this.grafo.set({ nodos: [], enlaces: [], meta: {} }),
    });
  }

  cambiarVista(v: Vista): void {
    this.vista.set(v);
    if (v === 'fragmentos' && this.fragmentos() === null) this.cargarFragmentos();
  }

  private cargarFragmentos(): void {
    this.svc.fragmentos(this.docId()).subscribe({
      next: (f) => this.fragmentos.set(f),
      error: () => this.fragmentos.set([]),
    });
  }

  // ── Acciones ────────────────────────────────────────────────────────────────
  moduloActivo(clave: string): boolean { return (this.doc()?.modulos ?? []).includes(clave); }

  toggleModulo(clave: string): void {
    const d = this.doc();
    if (!d || this.procesando()) return;
    const act = d.modulos ?? [];
    const nuevos = act.includes(clave) ? act.filter((m) => m !== clave) : [...act.filter((m) => m !== 'todos' || clave === 'todos'), clave];
    this.svc.editar(d.id, { modulos: nuevos.length ? nuevos : ['todos'] }).subscribe({
      next: (doc) => this.aplicar(doc),
      error: (e) => this.error.set(mensajeDeError(e, 'No se pudieron cambiar los módulos.')),
    });
  }

  empezarRenombrar(): void {
    this.nombreEdit.set(this.doc()?.nombre ?? '');
    this.editandoNombre.set(true);
  }

  guardarNombre(): void {
    const d = this.doc();
    const n = this.nombreEdit().trim();
    this.editandoNombre.set(false);
    if (!d || !n || n === d.nombre) return;
    this.svc.editar(d.id, { nombre: n }).subscribe({
      next: (doc) => this.aplicar(doc),
      error: (e) => this.error.set(mensajeDeError(e, 'No se pudo renombrar.')),
    });
  }

  reprocesar(): void {
    const d = this.doc();
    if (!d) return;
    this.ocupado.set(true);
    this.svc.reprocesar(d.id).subscribe({
      next: (doc) => { this.ocupado.set(false); this.aplicar(doc); },
      error: (e) => { this.ocupado.set(false); this.error.set(mensajeDeError(e, 'No se pudo reprocesar.')); },
    });
  }

  eliminar(): void {
    const d = this.doc();
    if (!d || !window.confirm(`¿Eliminar «${d.nombre}»? La IA dejará de usarla en todos los módulos.`)) return;
    this.svc.eliminarDocumento(d.id).subscribe({
      next: () => this.eliminado.emit(d.id),
      error: (e) => this.error.set(mensajeDeError(e, 'No se pudo eliminar.')),
    });
  }

  seguirConstruyendo(): void {
    const d = this.detalle();
    if (d) this.construir.emit(d);
  }

  alClicNodo(n: NodoDto): void {
    if (n.categoria === 'base-relacionada' && n.documentoId) this.abrirBase.emit(n.documentoId);
    if (n.categoria === 'seccion') {
      this.filtroFrag.set(n.nombre);
      this.cambiarVista('fragmentos');
    }
  }

  private aplicar(doc: DocDto): void {
    const d = this.detalle();
    if (d) this.detalle.set({ ...d, doc });
    this.cambiado.emit(doc);
  }

  // ── Formato ─────────────────────────────────────────────────────────────────
  nombreModulo(clave: string): string {
    return this.modulos().find((m) => m.clave === clave)?.nombre ?? clave;
  }

  etiquetaOrigen(o?: string | null): string {
    return ({ archivo: 'Archivo', texto: 'Texto', constructor: 'Construida con IA', agente: 'Agente de guardia', fuente: 'Fuente externa' } as Record<string, string>)[o ?? 'texto'] ?? 'Texto';
  }

  etiquetaMotor(m?: string | null): string {
    return ({ docling: 'Docling', local: 'Extractor local', texto: 'Texto directo', fuente: 'Fuente externa' } as Record<string, string>)[m ?? 'texto'] ?? (m ?? '—');
  }

  bytes(n?: number | null): string {
    if (!n) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }
}
