import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { HttpErrorResponse } from '@angular/common/http';
import { forkJoin } from 'rxjs';
import Swal from 'sweetalert2';

import {
  BannerAdmin, CatalogoBanners, PlantillaBanner, PuntoSerie, ResultadoSimulacion,
} from '../../carrusel/carrusel.models';
import { CarruselService } from '../../carrusel/carrusel.service';
import { BannerSlideComponent } from '../../carrusel/banner-slide.component';
import { BannerEditorComponent } from './banner-editor.component';
import { PlantillasBannerComponent } from './plantillas-banner.component';
import { EventosPlataformaComponent } from './eventos-plataforma.component';
import { AudienceCatalogService, Sujeto } from '../../../dynamic-forms/services/audience-catalog.service';
import { normalizarTexto } from '@/app/core/services/permissions.service';

type Pestana = 'banners' | 'plantillas' | 'eventos' | 'simulador';
type Filtro = 'TODOS' | 'EN_AIRE' | 'PROGRAMADO' | 'BORRADOR' | 'PAUSADO' | 'VENCIDO' | 'ARCHIVADO';

/**
 * Marketing › Carrusel del home.
 *
 * Desde aquí se administra lo primero que ve cualquier persona al entrar a la plataforma:
 * qué banners hay, en qué orden salen (arrastrando), a quién le salen y cuánto rinden. El
 * simulador responde la pregunta que más se hace antes de publicar: "¿esto le va a salir
 * a fulano?".
 */
@Component({
  selector: 'app-mk-banners',
  standalone: true,
  imports: [
    FormsModule, MatIconModule, DragDropModule, DatePipe, DecimalPipe, BannerSlideComponent, BannerEditorComponent,
    PlantillasBannerComponent, EventosPlataformaComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './banners.component.html',
  styleUrls: ['./pestanas-banners.css', './banners.component.css'],
})
export class BannersComponent implements OnInit {
  private readonly api = inject(CarruselService);
  private readonly audiencia = inject(AudienceCatalogService);

  readonly pestana = signal<Pestana>('banners');
  readonly cargando = signal(true);
  readonly sinPermiso = signal(false);
  readonly lista = signal<BannerAdmin[]>([]);
  readonly archivados = signal<BannerAdmin[] | null>(null);
  readonly plantillas = signal<PlantillaBanner[]>([]);
  readonly catalogo = signal<CatalogoBanners | null>(null);
  readonly filtro = signal<Filtro>('TODOS');

  /** Editor abierto: undefined = cerrado; null = nuevo; string = id. */
  readonly editorId = signal<string | null | undefined>(undefined);
  readonly plantillaParaNuevo = signal<string | null>(null);

  readonly metricasDe = signal<BannerAdmin | null>(null);
  readonly serie = signal<PuntoSerie[]>([]);

  // simulador
  readonly personas = signal<Sujeto[]>([]);
  readonly busquedaPersona = signal('');
  readonly persona = signal<Sujeto | null>(null);
  readonly cedulaSim = signal('');
  readonly fechaSim = signal('');
  readonly simulacion = signal<ResultadoSimulacion | null>(null);
  readonly simulando = signal(false);

  readonly conteos = computed(() => {
    const c: Record<string, number> = {};
    for (const b of this.lista()) c[b.situacion] = (c[b.situacion] ?? 0) + 1;
    return c;
  });

  readonly visibles = computed(() => {
    const f = this.filtro();
    if (f === 'ARCHIVADO') return this.archivados() ?? [];
    return f === 'TODOS' ? this.lista() : this.lista().filter((b) => b.situacion === f);
  });

  /** Arrastrar solo tiene sentido viendo la lista completa en su orden real. */
  readonly ordenable = computed(() => this.filtro() === 'TODOS' && this.lista().length > 1);

  readonly enAire = computed(() => this.lista().filter((b) => b.situacion === 'EN_AIRE').length);

  readonly personasFiltradas = computed(() => {
    const q = normalizarTexto(this.busquedaPersona());
    if (q.length < 3) return [];
    return this.personas().filter((p) => normalizarTexto(`${p.nombre} ${p.detalle ?? ''}`).includes(q)).slice(0, 12);
  });

  readonly maxSerie = computed(() => Math.max(1, ...this.serie().map((p) => p.vistas)));

  readonly filtros: { valor: Filtro; nombre: string }[] = [
    { valor: 'TODOS', nombre: 'Todos' },
    { valor: 'EN_AIRE', nombre: 'En el aire' },
    { valor: 'PROGRAMADO', nombre: 'Programados' },
    { valor: 'BORRADOR', nombre: 'Borradores' },
    { valor: 'PAUSADO', nombre: 'Pausados' },
    { valor: 'VENCIDO', nombre: 'Vencidos' },
    { valor: 'ARCHIVADO', nombre: 'Archivados' },
  ];

  ngOnInit(): void {
    forkJoin({ catalogo: this.api.catalogo(), plantillas: this.api.plantillas() }).subscribe({
      next: (r) => { this.catalogo.set(r.catalogo); this.plantillas.set(r.plantillas); },
      error: (e: HttpErrorResponse) => { if (e.status === 403) this.sinPermiso.set(true); },
    });
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.api.listar().subscribe({
      next: (l) => { this.lista.set(l); this.cargando.set(false); },
      error: (e: HttpErrorResponse) => {
        this.cargando.set(false);
        if (e.status === 403) this.sinPermiso.set(true);
      },
    });
    if (this.filtro() === 'ARCHIVADO') this.cargarArchivados();
  }

  elegirFiltro(f: Filtro): void {
    this.filtro.set(f);
    if (f === 'ARCHIVADO' && this.archivados() === null) this.cargarArchivados();
  }

  private cargarArchivados(): void {
    this.api.listar('ARCHIVADO').subscribe((l) => this.archivados.set(l));
  }

  recargarPlantillas(): void { this.api.plantillas().subscribe((p) => this.plantillas.set(p)); }

  // ── editor ────────────────────────────────────────────────────────────────

  nuevo(plantillaId: string | null = null): void {
    this.plantillaParaNuevo.set(plantillaId);
    this.editorId.set(null);
    this.pestana.set('banners');
  }

  editar(b: BannerAdmin): void { this.editorId.set(b.id); }

  alCerrarEditor(cambio: boolean): void {
    this.editorId.set(undefined);
    if (cambio) this.cargar();
  }

  // ── acciones de la lista ──────────────────────────────────────────────────

  soltar(ev: CdkDragDrop<BannerAdmin[]>): void {
    if (ev.previousIndex === ev.currentIndex) return;
    const l = [...this.lista()];
    moveItemInArray(l, ev.previousIndex, ev.currentIndex);
    this.lista.set(l);
    // Los fijados van primero siempre: se mandan todos y el backend reparte prioridades.
    this.api.reordenar(l.map((b) => b.id)).subscribe({
      next: (nueva) => this.lista.set(nueva),
      error: () => { Swal.fire('No se pudo reordenar', 'Se recarga la lista.', 'error'); this.cargar(); },
    });
  }

  mover(b: BannerAdmin, delta: number): void {
    const l = [...this.lista()];
    const i = l.findIndex((x) => x.id === b.id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= l.length) return;
    this.soltar({ previousIndex: i, currentIndex: j } as CdkDragDrop<BannerAdmin[]>);
  }

  publicar(b: BannerAdmin): void { this.estado(b, 'PUBLICADO'); }
  pausar(b: BannerAdmin): void { this.estado(b, 'PAUSADO'); }
  restaurar(b: BannerAdmin): void { this.estado(b, 'BORRADOR'); }

  private estado(b: BannerAdmin, estado: string): void {
    this.api.cambiarEstado(b.id, estado).subscribe({
      next: () => { this.archivados.set(null); this.cargar(); if (this.filtro() === 'ARCHIVADO') this.cargarArchivados(); },
      error: (e: HttpErrorResponse) => Swal.fire({
        icon: 'warning', title: 'No se pudo',
        html: (e.error?.problemas as string[] | undefined)?.map((p) => `• ${this.escapar(p)}`).join('<br>') || this.escapar(e.error?.error || ''),
      }),
    });
  }

  duplicar(b: BannerAdmin): void {
    this.api.duplicar(b.id).subscribe({
      next: (c) => { this.cargar(); this.editorId.set(c.id); },
      error: () => Swal.fire('No se pudo duplicar', '', 'error'),
    });
  }

  async archivar(b: BannerAdmin): Promise<void> {
    const r = await Swal.fire({
      title: '¿Archivar este banner?', text: `«${b.nombre_interno}» deja de mostrarse. Queda en Archivados y se puede restaurar.`,
      icon: 'question', showCancelButton: true, confirmButtonText: 'Archivar', cancelButtonText: 'Cancelar',
    });
    if (!r.isConfirmed) return;
    this.api.archivar(b.id).subscribe(() => { this.archivados.set(null); this.cargar(); });
  }

  verMetricas(b: BannerAdmin): void {
    this.metricasDe.set(b);
    this.serie.set([]);
    this.api.metricas(b.id, 30).subscribe((m) => this.serie.set(m.serie));
  }

  // ── simulador ─────────────────────────────────────────────────────────────

  abrirSimulador(): void {
    this.pestana.set('simulador');
    if (!this.personas().length) this.audiencia.personas().subscribe((p) => this.personas.set(p));
  }

  elegirPersona(p: Sujeto): void {
    this.persona.set(p);
    this.busquedaPersona.set('');
    const doc = (p.detalle ?? '').split('·')[0].trim();
    if (/^[0-9A-Za-z]{4,}$/.test(doc)) this.cedulaSim.set(doc);
  }

  simular(): void {
    const p = this.persona();
    if (!p && !this.cedulaSim().trim()) return;
    this.simulando.set(true);
    this.api.simular({
      usuario_id: p?.id ?? null, documento: this.cedulaSim().trim() || null, superficie: 'TESORO',
      fecha_hora: this.fechaSim() || null,
    }).subscribe({
      next: (r) => { this.simulacion.set(r); this.simulando.set(false); },
      error: (e: HttpErrorResponse) => {
        this.simulando.set(false);
        Swal.fire('No se pudo simular', e.error?.error || '', 'error');
      },
    });
  }

  // ── presentación ──────────────────────────────────────────────────────────

  situacionTexto(s: string): string {
    return ({
      EN_AIRE: 'En el aire', PROGRAMADO: 'Programado', VENCIDO: 'Vencido', BORRADOR: 'Borrador',
      PAUSADO: 'Pausado', ARCHIVADO: 'Archivado', PUBLICADO: 'Publicado',
    } as Record<string, string>)[s] ?? s;
  }

  vigencia(b: BannerAdmin): string {
    const f = (s?: string | null) => (s ? new Date(s).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '');
    if (!b.vigente_desde && !b.vigente_hasta) return 'Sin fechas: mientras esté publicado';
    if (!b.vigente_hasta) return `Desde ${f(b.vigente_desde)}`;
    if (!b.vigente_desde) return `Hasta ${f(b.vigente_hasta)}`;
    return `${f(b.vigente_desde)} → ${f(b.vigente_hasta)}`;
  }

  private escapar(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  }
}
