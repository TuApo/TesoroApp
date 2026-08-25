import {
  Component, ChangeDetectionStrategy, OnInit, signal, computed, inject, input, effect,
  ViewChild, ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule } from '@angular/material/menu';

import { MarkdownMessageComponent } from './markdown-message.component';
import { ChatSeed } from './chat-seed';
import { NominaService, Client, CostCenter } from '../../service/nomina/nomina.service';
import {
  AnaliticaIaService, AnalisisNomina, FolderDto, ConversacionDto, MensajeDto, Adjunto, Capacidades,
} from '../../service/analitica-ia/analitica-ia.service';

/**
 * Tab "Chat": asistente de nómina con historial (carpetas + conversaciones),
 * preguntas recomendadas, render Markdown + gráficas, adjuntos, grabación de
 * audio con transcripción y búsqueda web (estas dos, si el backend las habilita).
 */
@Component({
  selector: 'app-chat-tab',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatButtonModule, MatIconModule, MatTooltipModule, MatProgressSpinnerModule, MatMenuModule,
    MarkdownMessageComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './chat-tab.component.html',
  styleUrls: ['./chat-tab.component.css'],
})
export class ChatTabComponent implements OnInit {
  private svc = inject(AnaliticaIaService);
  private nomina = inject(NominaService);
  seed = input<ChatSeed | null>(null);

  @ViewChild('scrollBox') scrollBox?: ElementRef<HTMLElement>;
  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;

  // ── Estado de historial ──────────────────────────────────────────────────
  folders = signal<FolderDto[]>([]);
  conversaciones = signal<ConversacionDto[]>([]);
  selectedFolder = signal<number | null>(null);      // filtro de la lista
  activeConvId = signal<number | null>(null);
  mensajes = signal<MensajeDto[]>([]);
  loadingConv = signal<boolean>(false);
  sidebarOpen = signal<boolean>(false);              // móvil

  // ── Estado de composición ────────────────────────────────────────────────
  draft = signal<string>('');
  adjuntos = signal<Adjunto[]>([]);
  sending = signal<boolean>(false);
  webSearchOn = signal<boolean>(false);
  recording = signal<boolean>(false);
  transcribing = signal<boolean>(false);
  error = signal<string | null>(null);
  capacidades = signal<Capacidades>({ transcripcion: false, webSearch: false });

  // ── Filtro de datos (finca = centro de costo / empresa / año) ──────────────
  // Define el ALCANCE con el que se responde: al fijarlo, se trae el análisis
  // real de nómina de ms-payroll y se inyecta como contexto en cada pregunta,
  // para que la IA responda con cifras reales de la base de datos.
  empresas = signal<Client[]>([]);
  fincas = signal<CostCenter[]>([]);
  selectedEmpresa = signal<number | null>(null);
  selectedFincas = signal<number[]>([]);
  anios = signal<number[]>([]);
  selectedAnio = signal<number | null>(null);
  analisisScope = signal<AnalisisNomina | null>(null);
  loadingDatos = signal<boolean>(false);

  private lastNonce = 0;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  conversacionesFiltradas = computed<ConversacionDto[]>(() => {
    const f = this.selectedFolder();
    const list = this.conversaciones();
    return f == null ? list : list.filter((c) => c.folderId === f);
  });
  activeTitulo = computed<string>(() => {
    const id = this.activeConvId();
    return this.conversaciones().find((c) => c.id === id)?.titulo ?? 'Nueva conversación';
  });
  vacio = computed<boolean>(() => this.mensajes().length === 0);

  readonly preguntas: string[] = [
    '¿Cuáles son las principales anomalías de la última nómina?',
    'Compara el neto pagado de las últimas quincenas y genera una gráfica.',
    '¿Qué empresa usuaria tuvo la mayor variación de neto?',
    'Explícame la diferencia entre devengado, deducido y neto.',
    '¿Cómo se calculan los aportes de salud y pensión sobre el IBC?',
    '¿Qué novedades impactaron más la nómina y por qué?',
    '¿Por qué pudo cambiar el IBC entre periodos?',
    'Dame recomendaciones para revisar inconsistencias de nómina.',
  ];

  constructor() {
    // Cuando el tab de Informe envía una semilla, abre una conversación nueva
    // sembrada con el resumen del informe.
    effect(() => {
      const s = this.seed();
      if (s && s.nonce !== this.lastNonce) {
        this.lastNonce = s.nonce;
        this.iniciarDesdeSemilla(s);
      }
    });
  }

  ngOnInit(): void {
    this.svc.capacidades().subscribe({ next: (c) => this.capacidades.set(c), error: () => {} });
    this.cargarFolders();
    this.cargarConversaciones();
    // Filtro de datos / grounding.
    const y = new Date().getFullYear();
    this.anios.set([y, y - 1, y - 2, y - 3]);
    this.selectedAnio.set(y);
    this.nomina.getClientesActivos().subscribe({ next: (cs) => this.empresas.set(cs ?? []), error: () => this.empresas.set([]) });
    this.cargarFincas();
    this.refetchDatos();
  }

  // ── Filtro de datos ─────────────────────────────────────────────────────────
  private cargarFincas(): void {
    const emp = this.selectedEmpresa();
    const req = emp != null ? this.nomina.getCentrosCostos(emp) : this.nomina.getCentrosCostos();
    req.subscribe({ next: (cc) => this.fincas.set(cc ?? []), error: () => this.fincas.set([]) });
  }
  onEmpresaDatos(id: number | null): void {
    this.selectedEmpresa.set(id); this.selectedFincas.set([]); this.cargarFincas(); this.refetchDatos();
  }
  onFincasDatos(ids: number[]): void { this.selectedFincas.set(ids ?? []); this.refetchDatos(); }
  onAnioDatos(a: number | null): void { this.selectedAnio.set(a); this.refetchDatos(); }

  private refetchDatos(): void {
    const params: any = {};
    const anio = this.selectedAnio();
    if (anio != null) { params.desde = `${anio}-01-01`; params.hasta = `${anio}-12-31`; }
    const emp = this.selectedEmpresa();
    if (emp != null) params.cliente_id = emp;
    const fs = this.selectedFincas();
    if (fs.length) params.cecos = fs;
    this.loadingDatos.set(true);
    this.svc.getAnalisis(params).subscribe({
      next: (a) => { this.analisisScope.set(a); this.loadingDatos.set(false); },
      error: () => { this.analisisScope.set(null); this.loadingDatos.set(false); },
    });
  }

  /** Etiqueta legible del alcance actual (para el chip informativo). */
  scopeLabel = computed<string>(() => {
    const fs = this.selectedFincas();
    if (fs.length) {
      const names = this.fincas().filter((c) => fs.includes(c.id_ceco)).map((c) => c.nombre);
      return names.length <= 2 ? names.join(', ') : `${names.length} fincas`;
    }
    const emp = this.selectedEmpresa();
    if (emp != null) return this.empresas().find((e) => e.id_entidad === emp)?.nombre_legal ?? 'Empresa';
    return 'Todas las fincas';
  });

  /** Contexto de datos reales de nómina para inyectar en cada pregunta. */
  private datosContexto(): string {
    const a = this.analisisScope();
    if (!a) return '';
    const L: string[] = [];
    L.push(`INSTRUCCIÓN: responde las preguntas de nómina usando ESTOS DATOS REALES de la base de datos (alcance: ${this.scopeLabel()}, año ${this.selectedAnio() ?? 's/d'}). Si una cifra puntual no está aquí, dilo; no inventes.`);
    L.push(`Periodos analizados: ${a.meta.periodos}. Empleados último periodo: ${a.meta.empleadosUltimoPeriodo}.`);
    if (a.kpis?.length) {
      L.push('Indicadores (último periodo vs anterior):');
      for (const k of a.kpis) {
        const v = k.formato === 'MONEDA' ? this.money(k.valorActual) : this.int(k.valorActual);
        const d = k.deltaPct != null ? ` (${k.deltaPct > 0 ? '+' : ''}${k.deltaPct}%)` : '';
        L.push(`  - ${k.etiqueta}: ${v}${d}`);
      }
    }
    if (a.serie?.length) {
      L.push('Evolución por periodo (neto / devengado / deducido / IBC / aportes / empleados / #novedades):');
      for (const p of a.serie.slice(-12)) {
        L.push(`  ${p.etiqueta}: ${this.money(p.neto)} / ${this.money(p.devengado)} / ${this.money(p.deducido)} / ${this.money(p.ibc)} / ${this.money(p.aportes)} / ${p.empleados} / ${p.novedadesConteo}`);
      }
    }
    if (a.anomalias?.length) {
      L.push(`Anomalías detectadas (${a.anomalias.length}):`);
      for (const an of a.anomalias.slice(0, 10)) L.push(`  [${an.severidad}] ${an.mensaje}`);
    }
    if (a.topCecos?.length) {
      L.push('Top fincas/centros de costo por neto: ' + a.topCecos.slice(0, 8).map((c) => `${c.etiqueta}=${this.money(c.valor)}`).join('; '));
    }
    if (a.topNovedades?.length) {
      L.push('Top novedades por valor: ' + a.topNovedades.slice(0, 8).map((c) => `${c.etiqueta}=${this.money(c.valor)}`).join('; '));
    }
    if (a.facturacion?.disponible) {
      L.push(`Facturación: factura ${this.money(a.facturacion.totalFactura)}, costo ${this.money(a.facturacion.totalCosto)}, margen ${this.money(a.facturacion.margen)} (${a.facturacion.margenPct}%).`);
    }
    return L.join('\n');
  }

  private readonly fMoney = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
  private readonly fInt = new Intl.NumberFormat('es-CO');
  money(v: number | null | undefined): string { return this.fMoney.format(Number(v) || 0); }
  int(v: number | null | undefined): string { return this.fInt.format(Number(v) || 0); }

  // ── Historial ──────────────────────────────────────────────────────────────
  private cargarFolders(): void {
    this.svc.listarFolders().subscribe({ next: (f) => this.folders.set(f ?? []), error: () => this.folders.set([]) });
  }
  private cargarConversaciones(): void {
    this.svc.listarConversaciones().subscribe({ next: (c) => this.conversaciones.set(c ?? []), error: () => this.conversaciones.set([]) });
  }

  abrirConversacion(id: number): void {
    this.activeConvId.set(id);
    this.sidebarOpen.set(false);
    this.loadingConv.set(true);
    this.svc.obtenerConversacion(id).subscribe({
      next: (d) => { this.mensajes.set(d.mensajes ?? []); this.loadingConv.set(false); this.scrollAlFinal(); },
      error: () => { this.mensajes.set([]); this.loadingConv.set(false); },
    });
  }

  nuevaConversacion(): void {
    this.activeConvId.set(null);
    this.mensajes.set([]);
    this.draft.set('');
    this.adjuntos.set([]);
    this.sidebarOpen.set(false);
  }

  private iniciarDesdeSemilla(s: ChatSeed): void {
    this.svc.crearConversacion({ titulo: s.titulo, contextoJson: s.contexto }).subscribe({
      next: (c) => {
        this.conversaciones.update((list) => [c, ...list]);
        this.activeConvId.set(c.id);
        this.mensajes.set([]);
        this.draft.set('Resume los hallazgos clave de este informe y señala las anomalías más importantes.');
      },
      error: () => this.error.set('No se pudo iniciar la conversación desde el informe.'),
    });
  }

  seleccionarFolder(id: number | null): void { this.selectedFolder.set(id); }

  crearCarpeta(): void {
    const nombre = window.prompt('Nombre de la carpeta:');
    if (!nombre || !nombre.trim()) return;
    this.svc.crearFolder(nombre.trim()).subscribe({
      next: (f) => this.folders.update((l) => [...l, f]),
      error: () => this.error.set('No se pudo crear la carpeta.'),
    });
  }

  eliminarCarpeta(f: FolderDto, ev: Event): void {
    ev.stopPropagation();
    if (!window.confirm(`¿Eliminar la carpeta "${f.nombre}"? Las conversaciones no se borran.`)) return;
    this.svc.eliminarFolder(f.id).subscribe({
      next: () => { this.folders.update((l) => l.filter((x) => x.id !== f.id)); if (this.selectedFolder() === f.id) this.selectedFolder.set(null); this.cargarConversaciones(); },
      error: () => this.error.set('No se pudo eliminar la carpeta.'),
    });
  }

  moverAConversacion(conv: ConversacionDto, folderId: number | null): void {
    this.svc.moverConversacion(conv.id, folderId).subscribe({
      next: (c) => this.conversaciones.update((l) => l.map((x) => (x.id === c.id ? c : x))),
      error: () => this.error.set('No se pudo mover la conversación.'),
    });
  }

  renombrarConversacion(conv: ConversacionDto, ev: Event): void {
    ev.stopPropagation();
    const titulo = window.prompt('Nuevo título:', conv.titulo);
    if (!titulo || !titulo.trim()) return;
    this.svc.renombrarConversacion(conv.id, titulo.trim()).subscribe({
      next: (c) => this.conversaciones.update((l) => l.map((x) => (x.id === c.id ? c : x))),
      error: () => this.error.set('No se pudo renombrar.'),
    });
  }

  eliminarConversacion(conv: ConversacionDto, ev: Event): void {
    ev.stopPropagation();
    if (!window.confirm(`¿Eliminar la conversación "${conv.titulo}"?`)) return;
    this.svc.eliminarConversacion(conv.id).subscribe({
      next: () => { this.conversaciones.update((l) => l.filter((x) => x.id !== conv.id)); if (this.activeConvId() === conv.id) this.nuevaConversacion(); },
      error: () => this.error.set('No se pudo eliminar la conversación.'),
    });
  }

  // ── Composición / envío ─────────────────────────────────────────────────────
  usarPregunta(q: string): void { this.draft.set(q); }

  enviar(): void {
    const texto = this.draft().trim();
    if ((!texto && this.adjuntos().length === 0) || this.sending()) return;
    this.error.set(null);

    const nowIso = new Date().toISOString();
    const userMsg: MensajeDto = { id: -Date.now(), rol: 'user', contenido: texto, adjuntosJson: null, createdAt: nowIso };
    this.mensajes.update((m) => [...m, userMsg]);

    const body = {
      contenido: texto || '(archivo adjunto)',
      adjuntos: this.adjuntos().length ? this.adjuntos() : undefined,
      // El agente consulta la BD por sí mismo: le pasamos el filtro (scope) como
      // alcance por defecto, no un volcado de datos.
      scope: { clienteId: this.selectedEmpresa(), cecos: this.selectedFincas(), anio: this.selectedAnio() },
      webSearch: this.webSearchOn(),
    };
    this.draft.set('');
    this.adjuntos.set([]);
    this.sending.set(true);
    this.scrollAlFinal();

    const convId = this.activeConvId();
    const req$ = convId == null ? this.svc.enviarMensajeNuevo(body) : this.svc.enviarMensaje(convId, body);
    req$.subscribe({
      next: (r) => {
        this.activeConvId.set(r.conversacionId);
        this.mensajes.update((m) => [...m, r.mensaje]);
        this.sending.set(false);
        this.scrollAlFinal();
        // Refresca la lista para reflejar título/orden si la conversación es nueva.
        this.cargarConversaciones();
      },
      error: () => {
        this.sending.set(false);
        this.mensajes.update((m) => [...m, { id: -Date.now(), rol: 'assistant', contenido: '_No se pudo obtener respuesta. Intenta de nuevo._', adjuntosJson: null, createdAt: new Date().toISOString() }]);
        this.scrollAlFinal();
      },
    });
  }

  onKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); this.enviar(); }
  }

  // ── Adjuntos ────────────────────────────────────────────────────────────────
  abrirArchivos(): void { this.fileInput?.nativeElement.click(); }

  async onFiles(ev: Event): Promise<void> {
    const inputEl = ev.target as HTMLInputElement;
    const files = inputEl.files ? Array.from(inputEl.files) : [];
    for (const f of files) {
      let texto: string | null = null;
      if (this.esTexto(f) && f.size <= 1_000_000) {
        try { texto = await f.text(); } catch { texto = null; }
      }
      this.adjuntos.update((a) => [...a, { nombre: f.name, tipo: f.type || 'application/octet-stream', tamano: f.size, textoExtraido: texto }]);
    }
    inputEl.value = '';
  }

  private esTexto(f: File): boolean {
    const t = (f.type || '').toLowerCase();
    if (t.startsWith('text/') || t.includes('json') || t.includes('csv') || t.includes('xml')) return true;
    return /\.(txt|md|csv|json|log|xml|yml|yaml)$/i.test(f.name);
  }

  quitarAdjunto(i: number): void { this.adjuntos.update((a) => a.filter((_, idx) => idx !== i)); }

  // ── Audio (grabar + transcribir) ─────────────────────────────────────────────
  async toggleGrabar(): Promise<void> {
    if (this.recording()) { this.mediaRecorder?.stop(); return; }
    this.error.set(null);

    // Requisitos del entorno.
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      this.error.set('La grabación de voz requiere una conexión segura (HTTPS).'); return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      this.error.set('Tu navegador no soporta grabación de audio. Usa Chrome, Edge o Firefox actualizado.'); return;
    }

    // Verifica el estado del permiso (si el navegador expone la Permissions API).
    try {
      const perm: any = await (navigator as any).permissions?.query?.({ name: 'microphone' as PermissionName });
      if (perm && perm.state === 'denied') {
        this.error.set('El micrófono está bloqueado para este sitio. Actívalo en el candado 🔒 de la barra de direcciones y recarga.');
        return;
      }
    } catch { /* Permissions API no disponible: getUserMedia pedirá el permiso igual. */ }

    // Solicita el micrófono (esto dispara el prompt de permiso si aún no se ha dado).
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e: any) {
      const name = e?.name || '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
        this.error.set('Permiso de micrófono denegado. Actívalo en el candado 🔒 de la barra de direcciones e intenta de nuevo.');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        this.error.set('No se detectó ningún micrófono conectado.');
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        this.error.set('El micrófono está en uso por otra aplicación. Ciérrala e intenta de nuevo.');
      } else {
        this.error.set('No se pudo acceder al micrófono.');
      }
      return;
    }

    try {
      this.chunks = [];
      const mime = this.mejorMime();
      const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      this.mediaRecorder = mr;
      mr.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
      mr.onerror = () => {
        stream.getTracks().forEach((t) => t.stop());
        this.recording.set(false);
        this.error.set('Ocurrió un error durante la grabación.');
      };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        this.recording.set(false);
        if (!this.chunks.length) { this.error.set('No se grabó audio. Intenta de nuevo.'); return; }
        const blob = new Blob(this.chunks, { type: mr.mimeType || mime || 'audio/webm' });
        this.transcribir(blob);
      };
      mr.start();
      this.recording.set(true);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      this.recording.set(false);
      this.error.set('No se pudo iniciar la grabación.');
    }
  }

  /** Elige un contenedor/códec de audio soportado por el navegador. */
  private mejorMime(): string {
    const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    const MR: any = (window as any).MediaRecorder;
    if (MR && typeof MR.isTypeSupported === 'function') {
      for (const c of cands) { try { if (MR.isTypeSupported(c)) return c; } catch { /* noop */ } }
    }
    return '';
  }

  private transcribir(blob: Blob): void {
    if (blob.size < 1200) {
      this.error.set('La grabación fue muy corta. Toca el micrófono, habla un momento y vuelve a tocarlo.');
      return;
    }
    this.transcribing.set(true);
    const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    this.svc.transcribir(blob, `audio.${ext}`).subscribe({
      next: (r) => {
        const texto = (r?.texto || '').trim();
        if (texto) this.draft.update((v) => (v ? v + ' ' : '') + texto);
        else this.error.set('No se detectó voz en el audio. Intenta de nuevo, más cerca del micrófono.');
        this.transcribing.set(false);
      },
      error: (e: any) => {
        this.transcribing.set(false);
        this.error.set(e?.status === 503
          ? 'La transcripción de voz no está habilitada en el servidor.'
          : 'No se pudo transcribir el audio. Intenta de nuevo.');
      },
    });
  }

  toggleWebSearch(): void { this.webSearchOn.update((v) => !v); }

  // ── Utilidades ───────────────────────────────────────────────────────────────
  private scrollAlFinal(): void {
    setTimeout(() => {
      const el = this.scrollBox?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 40);
  }
}
