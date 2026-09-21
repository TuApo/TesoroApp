import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

import { ContextoTurnosService } from '../../service/contexto-turnos.service';
import { Alcance, Media, MediaIn, Playlist, PlaylistIn, ReporteEmision, TipoAlcance, TipoMedia, TurnosService } from '../../service/turnos.service';
import { UtilityServiceService } from '../../../../../../shared/services/utilityService/utility-service.service';

interface Sede { id: string; nombre: string; }

/**
 * Piezas de publicidad y cursos de inducción, con su alcance (oficina, sede, ciudad,
 * empresa usuaria) y las listas de reproducción que las ordenan en cada pantalla.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-turnos-publicidad',
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './publicidad.html',
  styleUrls: ['../../styles/turnos-comun.css', './publicidad.css'],
})
export class Publicidad implements OnInit {
  readonly ctx = inject(ContextoTurnosService);
  readonly api = inject(TurnosService);
  private utilidades = inject(UtilityServiceService);

  readonly pestana = signal<'piezas' | 'listas' | 'reporte'>('piezas');
  readonly piezas = signal<Media[]>([]);
  readonly totalPiezas = signal(0);
  readonly pagina = signal(0);
  readonly q = signal('');
  readonly filtroTipo = signal('');
  readonly listas = signal<Playlist[]>([]);
  readonly sedes = signal<Sede[]>([]);
  readonly reporte = signal<ReporteEmision[]>([]);
  readonly ocupado = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  readonly formPieza = signal(false);
  readonly editandoPieza = signal<string | null>(null);
  pieza: MediaIn & { alcances: Alcance[] } = this.piezaVacia();
  archivo: File | null = null;
  readonly subiendo = signal(false);

  readonly formLista = signal(false);
  readonly editandoLista = signal<string | null>(null);
  lista: Omit<PlaylistIn, 'items'> & { items: { media_id: string; duracion_seg: number | null }[] } = this.listaVacia();
  readonly buscadorLista = signal('');

  reporteDesde = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  reporteHasta = new Date().toISOString().slice(0, 10);

  readonly TIPOS: { v: TipoMedia; n: string; icono: string }[] = [
    { v: 'IMAGEN', n: 'Imagen', icono: 'image' }, { v: 'VIDEO', n: 'Video propio', icono: 'movie' },
    { v: 'YOUTUBE', n: 'YouTube', icono: 'smart_display' }, { v: 'VIMEO', n: 'Vimeo', icono: 'smart_display' },
    { v: 'CURSO', n: 'Curso de inducción', icono: 'school' }, { v: 'TEXTO', n: 'Aviso de texto', icono: 'text_fields' },
    { v: 'HTML', n: 'HTML', icono: 'code' },
  ];
  readonly ALCANCES: { v: TipoAlcance; n: string }[] = [
    { v: 'OFICINA', n: 'Oficina' }, { v: 'SEDE', n: 'Sede' }, { v: 'CIUDAD', n: 'Ciudad' }, { v: 'EMPRESA_USUARIA', n: 'Empresa usuaria' },
  ];

  readonly piezasParaLista = computed(() => {
    const q = this.buscadorLista().trim().toLowerCase();
    return this.piezas().filter(p => p.activo && (!q || p.titulo.toLowerCase().includes(q)));
  });

  ngOnInit(): void {
    this.ctx.cargar();
    this.cargarPiezas();
    this.cargarListas();
    this.utilidades.traerSucursales().subscribe({
      next: (r: unknown) => {
        const l = Array.isArray(r) ? r : (r as { results?: unknown[] })?.results ?? [];
        this.sedes.set((l as Array<{ id: string; nombre: string }>).map(s => ({ id: String(s.id), nombre: s.nombre })));
      },
      error: () => this.sedes.set([]),
    });
  }

  // ── Piezas ──
  cargarPiezas(): void {
    this.api.buscarMedia(this.q() || undefined, this.filtroTipo() || undefined, null, this.pagina(), 60).subscribe({
      next: p => { this.piezas.set(p.content); this.totalPiezas.set(p.total_elements); },
      error: () => this.error.set('No se pudieron cargar las piezas'),
    });
  }

  nuevaPieza(): void { this.pieza = this.piezaVacia(); this.archivo = null; this.editandoPieza.set(null); this.formPieza.set(true); }

  editarPieza(m: Media): void {
    this.pieza = { tipo: m.tipo, titulo: m.titulo, descripcion: m.descripcion, url: m.url, duracion_seg: m.duracion_seg, ajuste: m.ajuste,
      silenciado: m.silenciado, curso_ref: m.curso_ref, curso_url: m.curso_url,
      vigente_desde: m.vigente_desde?.slice(0, 16) ?? null, vigente_hasta: m.vigente_hasta?.slice(0, 16) ?? null,
      activo: m.activo, etiquetas: m.etiquetas, alcances: m.alcances.map(a => ({ tipo: a.tipo, valor_ref: a.valor_ref, valor_nombre: a.valor_nombre })) };
    this.archivo = null;
    this.editandoPieza.set(m.id);
    this.formPieza.set(true);
  }

  agregarAlcance(): void { this.pieza.alcances = [...this.pieza.alcances, { tipo: 'OFICINA', valor_ref: null, valor_nombre: null }]; }
  quitarAlcance(i: number): void { this.pieza.alcances = this.pieza.alcances.filter((_, k) => k !== i); }
  alcanceValorCambiado(a: Alcance): void {
    if (a.tipo === 'OFICINA') a.valor_nombre = this.ctx.oficinas().find(o => o.id === a.valor_ref)?.nombre ?? null;
    else if (a.tipo === 'SEDE') a.valor_nombre = this.sedes().find(s => s.id === a.valor_ref)?.nombre ?? null;
    else a.valor_nombre = a.valor_ref;
  }

  seleccionarArchivo(e: Event): void {
    const f = (e.target as HTMLInputElement).files?.[0] ?? null;
    this.archivo = f;
    if (f && !this.pieza.titulo) this.pieza.titulo = f.name.replace(/\.[^.]+$/, '');
    if (f && (this.pieza.tipo === 'IMAGEN' || this.pieza.tipo === 'VIDEO' || !this.pieza.tipo)) {
      this.pieza.tipo = f.type.startsWith('video/') ? 'VIDEO' : 'IMAGEN';
    }
  }

  guardarPieza(): void {
    const cuerpo: MediaIn = { ...this.pieza, titulo: this.pieza.titulo.trim(),
      vigente_desde: this.pieza.vigente_desde || null, vigente_hasta: this.pieza.vigente_hasta || null,
      alcances: this.pieza.alcances.filter(a => a.valor_ref) };
    const id = this.editandoPieza();
    this.ocupado.set(true);
    this.error.set(null);
    (id ? this.api.actualizarMedia(id, cuerpo) : this.api.crearMedia(cuerpo)).subscribe({
      next: m => {
        if (this.archivo) {
          this.subiendo.set(true);
          this.api.subirArchivoMedia(m.id, this.archivo).subscribe({
            next: () => { this.subiendo.set(false); this.terminarPieza(id); },
            error: e => { this.subiendo.set(false); this.ocupado.set(false); this.error.set(e?.error?.message || 'La pieza se guardó pero el archivo no subió'); this.cargarPiezas(); },
          });
        } else {
          this.terminarPieza(id);
        }
      },
      error: e => { this.ocupado.set(false); this.error.set(e?.error?.message || 'No se pudo guardar la pieza'); },
    });
  }

  private terminarPieza(id: string | null): void {
    this.ocupado.set(false);
    this.formPieza.set(false);
    this.aviso.set(id ? 'Pieza actualizada' : 'Pieza creada');
    setTimeout(() => this.aviso.set(null), 2500);
    this.cargarPiezas();
  }

  desactivarPieza(m: Media): void {
    if (!confirm(`¿Retirar "${m.titulo}"? Sale de las listas y deja de circular; el reporte de emisiones se conserva.`)) return;
    this.api.desactivarMedia(m.id).subscribe({ next: () => this.cargarPiezas(), error: () => {} });
  }

  iconoTipo(t: string): string { return this.TIPOS.find(x => x.v === t)?.icono ?? 'image'; }
  urlPieza(m: Media): string | null { return this.api.urlMedia(m); }
  miniaturaYoutube(m: Media): string | null {
    const id = idYoutube(m.url);
    return id ? `https://img.youtube.com/vi/${id}/mqdefault.jpg` : null;
  }

  // ── Listas ──
  cargarListas(): void { this.api.playlists(null).subscribe({ next: l => this.listas.set(l), error: () => {} }); }

  nuevaLista(): void { this.lista = this.listaVacia(); this.editandoLista.set(null); this.formLista.set(true); }

  editarLista(p: Playlist): void {
    this.lista = { nombre: p.nombre, descripcion: p.descripcion, oficina_id: p.oficina_id, modo: p.modo, activa: p.activa,
      items: p.items.map(i => ({ media_id: i.media_id, duracion_seg: i.duracion_seg })) };
    this.editandoLista.set(p.id);
    this.formLista.set(true);
  }

  enLista(id: string): boolean { return this.lista.items.some(i => i.media_id === id); }
  alternarEnLista(m: Media): void {
    this.lista.items = this.enLista(m.id) ? this.lista.items.filter(i => i.media_id !== m.id) : [...this.lista.items, { media_id: m.id, duracion_seg: null }];
  }
  moverItem(i: number, d: -1 | 1): void {
    const j = i + d;
    if (j < 0 || j >= this.lista.items.length) return;
    const items = [...this.lista.items];
    [items[i], items[j]] = [items[j], items[i]];
    this.lista.items = items;
  }
  tituloPieza(id: string): string { return this.piezas().find(p => p.id === id)?.titulo ?? '(pieza)'; }

  guardarLista(): void {
    const cuerpo: PlaylistIn = { ...this.lista, nombre: this.lista.nombre.trim(), oficina_id: this.lista.oficina_id || null,
      items: this.lista.items.map((i, k) => ({ media_id: i.media_id, orden: k, duracion_seg: i.duracion_seg })) };
    const id = this.editandoLista();
    this.ocupado.set(true);
    (id ? this.api.actualizarPlaylist(id, cuerpo) : this.api.crearPlaylist(cuerpo)).subscribe({
      next: () => { this.ocupado.set(false); this.formLista.set(false); this.aviso.set('Lista guardada'); setTimeout(() => this.aviso.set(null), 2500); this.cargarListas(); },
      error: e => { this.ocupado.set(false); this.error.set(e?.error?.message || 'No se pudo guardar la lista'); },
    });
  }

  desactivarLista(p: Playlist): void {
    if (!confirm(`¿Retirar la lista "${p.nombre}"?`)) return;
    this.api.desactivarPlaylist(p.id).subscribe({ next: () => this.cargarListas(), error: () => {} });
  }

  // ── Reporte ──
  cargarReporte(): void {
    this.api.reporteEmisiones(this.reporteDesde, this.reporteHasta, this.ctx.oficinaId()).subscribe({ next: r => this.reporte.set(r), error: () => this.reporte.set([]) });
  }

  private piezaVacia(): MediaIn & { alcances: Alcance[] } {
    return { tipo: 'IMAGEN', titulo: '', descripcion: '', url: '', duracion_seg: 12, ajuste: 'CONTENER', silenciado: true,
      curso_ref: null, curso_url: '', vigente_desde: null, vigente_hasta: null, activo: true, etiquetas: '', alcances: [] };
  }
  private listaVacia(): Omit<PlaylistIn, 'items'> & { items: { media_id: string; duracion_seg: number | null }[] } {
    return { nombre: '', descripcion: '', oficina_id: null, modo: 'SECUENCIAL', activa: true, items: [] };
  }
}

export function idYoutube(url: string | null): string | null {
  if (!url) return null;
  const m = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/.exec(url);
  return m ? m[1] : null;
}
