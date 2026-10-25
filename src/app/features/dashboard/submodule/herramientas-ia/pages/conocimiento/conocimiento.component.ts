import {
  ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal,
} from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatTabsModule } from '@angular/material/tabs';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { forkJoin } from 'rxjs';

import {
  BuscarResp, ConocimientoService, DocDetalle, DocDto, GrafoDto, LoteResp, ModuloKbDto, NodoDto, ResumenKb,
} from '../../service/conocimiento.service';
import { GrafoKbComponent } from './grafo-kb.component';
import { KbDetalleComponent } from './kb-detalle.component';
import { KbConstructorComponent } from './kb-constructor.component';
import { KbFuentesComponent } from './kb-fuentes.component';
import { mensajeDeError } from '../../../../../../shared/utils/mensaje-error';

/** Pestañas fijas; la individual de una base se abre a continuación. */
const TAB = { panorama: 0, bases: 1, subir: 2, construir: 3, probar: 4, fuentes: 5, base: 6 } as const;

interface EnCola {
  id: number; archivo: File; nombre: string;
  estado: 'esperando' | 'subiendo' | 'procesando' | 'listo' | 'error';
  docId: number | null; detalle: string | null;
}

/**
 * Bases de Conocimiento: la memoria con la que opera la IA de la plataforma.
 *
 * Todo archivo entra por Docling (docai) y queda en Markdown con su estructura; cada base se
 * parte en fragmentos por sección, se vectoriza para buscar por significado y se le extrae una
 * red semántica. Los módulos a los que se asigna salen del catálogo del chat: asignar una base a
 * «Nómina» basta para que el chat de Nómina la use.
 */
@Component({
  selector: 'app-conocimiento',
  standalone: true,
  imports: [
    DatePipe, DecimalPipe, FormsModule,
    MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule, MatTabsModule,
    MatSlideToggleModule, MatButtonToggleModule,
    GrafoKbComponent, KbDetalleComponent, KbConstructorComponent, KbFuentesComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './conocimiento.component.html',
  styleUrls: ['./conocimiento.component.css'],
})
export class ConocimientoComponent implements OnInit {
  private svc = inject(ConocimientoService);
  private destroyRef = inject(DestroyRef);

  readonly TAB = TAB;
  readonly tab = signal<number>(TAB.panorama);
  readonly error = signal<string | null>(null);

  // ── Datos compartidos ───────────────────────────────────────────────────────
  readonly documentos = signal<DocDto[]>([]);
  readonly modulos = signal<ModuloKbDto[]>([]);
  readonly resumen = signal<ResumenKb | null>(null);
  readonly cargando = signal(false);

  readonly nombresModulo = computed(() => Object.fromEntries(this.modulos().map((m) => [m.clave, m.nombre])));

  // ── Panorama ────────────────────────────────────────────────────────────────
  readonly grafoGlobal = signal<GrafoDto | null>(null);
  readonly grafoCargando = signal(false);
  readonly filtroGrafoModulo = signal<string>('');
  readonly incluirAgentes = signal(false);
  readonly maxConceptos = signal(120);
  readonly lote = signal<LoteResp | null>(null);
  readonly loteOcupado = signal(false);

  readonly motores = computed(() => {
    const d = this.resumen()?.docai;
    const m = d?.motores ?? {};
    return [
      { clave: 'docling', nombre: 'Docling', ok: !!m['docling'], ayuda: 'Convierte PDF, Office e imágenes a Markdown con OCR' },
      { clave: 'embeddings', nombre: 'Embeddings', ok: !!m['embeddings'], ayuda: 'Vectoriza el texto (bge-m3) para buscar por significado' },
      { clave: 'qdrant', nombre: 'Qdrant', ok: !!m['qdrant'], ayuda: 'Guarda los vectores y responde la búsqueda semántica' },
    ];
  });

  /** Barras por módulo (ordenadas), con el nombre del catálogo. */
  readonly barrasModulo = computed(() => {
    const r = this.resumen();
    if (!r) return [];
    const nombres = this.nombresModulo();
    const filas = Object.entries(r.porModulo).map(([k, v]) => ({ clave: k, nombre: nombres[k] ?? k, valor: v }));
    filas.sort((a, b) => b.valor - a.valor);
    const max = Math.max(1, ...filas.map((f) => f.valor));
    return filas.map((f) => ({ ...f, pct: Math.round((f.valor / max) * 100) }));
  });

  // ── Bases ───────────────────────────────────────────────────────────────────
  readonly busqueda = signal('');
  readonly filtroModulo = signal<string>('');
  readonly filtroOrigen = signal<string>('');
  readonly ocultarAgentes = signal(true);

  readonly documentosFiltrados = computed(() => {
    const q = this.busqueda().trim().toLowerCase();
    const mod = this.filtroModulo();
    const ori = this.filtroOrigen();
    return this.documentos().filter((d) => {
      if (this.ocultarAgentes() && d.origen === 'agente' && ori !== 'agente') return false;
      if (mod && !(d.modulos ?? []).includes(mod)) return false;
      if (ori && (d.origen ?? 'texto') !== ori) return false;
      if (q && !(d.nombre.toLowerCase().includes(q) || (d.resumen ?? d.preview ?? '').toLowerCase().includes(q))) return false;
      return true;
    });
  });

  readonly agentesOcultos = computed(() => this.documentos().filter((d) => d.origen === 'agente').length);

  // ── Base abierta (vista individual) ────────────────────────────────────────
  readonly baseAbierta = signal<number | null>(null);
  readonly nombreBaseAbierta = computed(() => {
    const id = this.baseAbierta();
    return this.documentos().find((d) => d.id === id)?.nombre ?? 'Base';
  });

  // ── Constructor ─────────────────────────────────────────────────────────────
  readonly semillaConstructor = signal<DocDetalle | null>(null);

  // ── Subir ───────────────────────────────────────────────────────────────────
  readonly cola = signal<EnCola[]>([]);
  readonly modulosSubida = signal<string[]>([]);
  readonly ocr = signal<'auto' | 'forzar' | 'no'>('auto');
  readonly arrastrando = signal(false);
  private secuencia = 0;
  private subiendo = false;

  readonly colaActiva = computed(() => this.cola().some((c) => c.estado === 'esperando' || c.estado === 'subiendo' || c.estado === 'procesando'));

  // ── Probar ──────────────────────────────────────────────────────────────────
  readonly consulta = signal('');
  readonly moduloPrueba = signal<string>('');
  readonly prueba = signal<BuscarResp | null>(null);
  readonly probando = signal(false);

  private sondeo: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.cargarTodo();
    this.destroyRef.onDestroy(() => { if (this.sondeo) clearInterval(this.sondeo); });
  }

  cargarTodo(): void {
    this.cargando.set(true);
    forkJoin({ docs: this.svc.listarDocumentos(), mods: this.svc.modulos(), res: this.svc.resumen() }).subscribe({
      next: ({ docs, mods, res }) => {
        this.documentos.set(docs ?? []);
        this.modulos.set(mods ?? []);
        this.resumen.set(res);
        this.cargando.set(false);
        this.vigilarProcesando();
      },
      error: (e) => { this.cargando.set(false); this.error.set(mensajeDeError(e, 'No se pudo cargar la base de conocimiento.')); },
    });
    this.cargarGrafo();
  }

  cargarGrafo(): void {
    this.grafoCargando.set(true);
    this.svc.grafoGlobal({
      modulo: this.filtroGrafoModulo() || null, maxConceptos: this.maxConceptos(), incluirAgentes: this.incluirAgentes(),
    }).subscribe({
      next: (g) => { this.grafoGlobal.set(g); this.grafoCargando.set(false); },
      error: () => { this.grafoGlobal.set({ nodos: [], enlaces: [], meta: {} }); this.grafoCargando.set(false); },
    });
  }

  private refrescarListaYResumen(): void {
    this.svc.listarDocumentos().subscribe({ next: (d) => { this.documentos.set(d ?? []); this.actualizarCola(); this.vigilarProcesando(); } });
    this.svc.resumen().subscribe({ next: (r) => this.resumen.set(r) });
  }

  /** Mientras haya bases procesándose, refresca la lista cada 5 s; al terminar, también la red global. */
  private vigilarProcesando(): void {
    const hay = this.documentos().some((d) => d.estado === 'PROCESANDO');
    if (hay && !this.sondeo) {
      this.sondeo = setInterval(() => this.refrescarListaYResumen(), 5000);
    } else if (!hay && this.sondeo) {
      clearInterval(this.sondeo);
      this.sondeo = null;
      this.cargarGrafo();
    }
  }

  // ── Navegación ──────────────────────────────────────────────────────────────
  abrirBase(id: number): void {
    this.baseAbierta.set(id);
    this.tab.set(TAB.base);
  }

  cerrarBase(): void {
    this.baseAbierta.set(null);
    this.tab.set(TAB.bases);
  }

  alClicNodoGlobal(n: NodoDto): void {
    if (n.documentoId && (n.categoria === 'base' || n.categoria === 'base-relacionada')) this.abrirBase(n.documentoId);
    else if (n.categoria === 'modulo') { this.filtroGrafoModulo.set(n.id.slice(2)); this.cargarGrafo(); }
  }

  irAConstruir(semilla: DocDetalle | null = null): void {
    this.semillaConstructor.set(semilla);
    this.tab.set(TAB.construir);
  }

  alCambiarBase(doc: DocDto): void {
    this.documentos.update((l) => (l.some((x) => x.id === doc.id) ? l.map((x) => (x.id === doc.id ? doc : x)) : [doc, ...l]));
    this.vigilarProcesando();
  }

  alEliminarBase(id: number): void {
    this.documentos.update((l) => l.filter((x) => x.id !== id));
    this.cerrarBase();
    this.refrescarListaYResumen();
    this.cargarGrafo();
  }

  /** Una fuente terminó de traer datos: lista, indicadores y red al día. */
  refrescarTrasFuente(): void {
    this.refrescarListaYResumen();
    this.cargarGrafo();
  }

  alGuardarConstructor(doc: DocDto): void {
    this.alCambiarBase(doc);
    this.svc.resumen().subscribe({ next: (r) => this.resumen.set(r) });
  }

  // ── Panorama: lote de bases antiguas ────────────────────────────────────────
  simularLote(): void {
    this.loteOcupado.set(true);
    this.svc.reprocesarLote(true, 10).subscribe({
      next: (r) => { this.lote.set(r); this.loteOcupado.set(false); },
      error: (e) => { this.loteOcupado.set(false); this.error.set(mensajeDeError(e, 'No se pudo simular el lote.')); },
    });
  }

  ejecutarLote(): void {
    const l = this.lote();
    if (!l || !window.confirm(`Se procesarán ${l.ids.length} bases (una llamada a la IA por cada una). ¿Continuar?`)) return;
    this.loteOcupado.set(true);
    this.svc.reprocesarLote(false, l.ids.length).subscribe({
      next: (r) => { this.lote.set(r); this.loteOcupado.set(false); this.refrescarListaYResumen(); },
      error: (e) => { this.loteOcupado.set(false); this.error.set(mensajeDeError(e, 'No se pudo lanzar el lote.')); },
    });
  }

  // ── Subir con Docling ───────────────────────────────────────────────────────
  moduloSubidaActivo(c: string): boolean { return this.modulosSubida().includes(c); }

  toggleModuloSubida(c: string): void {
    this.modulosSubida.update((l) => (l.includes(c) ? l.filter((x) => x !== c) : [...l, c]));
  }

  alSoltar(ev: DragEvent): void {
    ev.preventDefault();
    this.arrastrando.set(false);
    if (ev.dataTransfer?.files?.length) this.agregarArchivos(ev.dataTransfer.files);
  }

  alArrastrar(ev: DragEvent, dentro: boolean): void {
    ev.preventDefault();
    this.arrastrando.set(dentro);
  }

  alElegirArchivos(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    if (input.files?.length) this.agregarArchivos(input.files);
    input.value = '';
  }

  private agregarArchivos(lista: FileList): void {
    const nuevos: EnCola[] = [];
    for (const f of Array.from(lista)) {
      if (f.size > 40 * 1024 * 1024) {
        this.error.set(`«${f.name}» supera 40 MB y no se agregó.`);
        continue;
      }
      nuevos.push({ id: ++this.secuencia, archivo: f, nombre: f.name.replace(/\.[^.]+$/, ''), estado: 'esperando', docId: null, detalle: null });
    }
    this.cola.update((c) => [...c, ...nuevos]);
  }

  renombrarEnCola(id: number, nombre: string): void {
    this.cola.update((c) => c.map((x) => (x.id === id ? { ...x, nombre } : x)));
  }

  quitarDeCola(id: number): void {
    this.cola.update((c) => c.filter((x) => x.id !== id || x.estado === 'subiendo'));
  }

  limpiarTerminados(): void {
    this.cola.update((c) => c.filter((x) => x.estado !== 'listo' && x.estado !== 'error'));
  }

  readonly pendientesDeSubir = computed(() => this.cola().filter((c) => c.estado === 'esperando').length);

  subirCola(): void {
    if (this.subiendo) return;
    const sig = this.cola().find((c) => c.estado === 'esperando');
    if (!sig) return;
    this.subiendo = true;
    this.patchCola(sig.id, { estado: 'subiendo' });
    const mods = this.modulosSubida().length ? this.modulosSubida() : ['todos'];
    this.svc.subirArchivo(sig.archivo, sig.nombre.trim() || sig.archivo.name, mods, this.ocr()).subscribe({
      next: (doc) => {
        this.subiendo = false;
        this.patchCola(sig.id, { estado: doc.estado === 'PROCESANDO' ? 'procesando' : 'listo', docId: doc.id, detalle: doc.estadoDetalle ?? null });
        this.alCambiarBase(doc);
        this.subirCola();
      },
      error: (e) => {
        this.subiendo = false;
        this.patchCola(sig.id, { estado: 'error', detalle: mensajeDeError(e, 'No se pudo subir.') });
        this.subirCola();
      },
    });
  }

  private patchCola(id: number, cambios: Partial<EnCola>): void {
    this.cola.update((c) => c.map((x) => (x.id === id ? { ...x, ...cambios } : x)));
  }

  /** Lleva el estado de las bases recién subidas a la cola (las refresca el sondeo de la lista). */
  private actualizarCola(): void {
    const porId = new Map(this.documentos().map((d) => [d.id, d]));
    this.cola.update((c) => c.map((x) => {
      if (x.estado !== 'procesando' || !x.docId) return x;
      const d = porId.get(x.docId);
      if (!d || d.estado === 'PROCESANDO') return d ? { ...x, detalle: d.estadoDetalle ?? x.detalle } : x;
      return { ...x, estado: d.estado === 'ERROR' ? 'error' : 'listo', detalle: d.estadoDetalle ?? null };
    }));
  }

  // ── Probar la IA ────────────────────────────────────────────────────────────
  probar(): void {
    const q = this.consulta().trim();
    if (q.length < 2 || this.probando()) return;
    this.probando.set(true);
    this.svc.buscar(q, this.moduloPrueba() || null).subscribe({
      next: (r) => { this.prueba.set(r); this.probando.set(false); },
      error: (e) => { this.probando.set(false); this.error.set(mensajeDeError(e, 'No se pudo probar la búsqueda.')); },
    });
  }

  // ── Formato ─────────────────────────────────────────────────────────────────
  nombreModulo(clave: string): string {
    return this.nombresModulo()[clave] ?? clave;
  }

  iconoModulo(clave: string): string {
    return this.modulos().find((m) => m.clave === clave)?.icono ?? 'label';
  }

  iconoOrigen(o?: string | null): string {
    return ({ archivo: 'upload_file', constructor: 'forum', agente: 'smart_toy', texto: 'notes', fuente: 'travel_explore' } as Record<string, string>)[o ?? 'texto'] ?? 'notes';
  }

  etiquetaOrigen(o?: string | null): string {
    return ({ archivo: 'Archivo', texto: 'Texto', constructor: 'Construida con IA', agente: 'Agente de guardia', fuente: 'Fuente externa' } as Record<string, string>)[o ?? 'texto'] ?? 'Texto';
  }

  iconoCola(e: EnCola['estado']): string {
    return ({ listo: 'check_circle', error: 'error', esperando: 'schedule', subiendo: 'cloud_upload', procesando: 'autorenew' })[e];
  }

  bytes(n?: number | null): string {
    if (!n) return '0 B';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  porcentaje(n: number | null | undefined): string {
    return n == null ? '' : `${Math.round(n * 100)} %`;
  }
}
