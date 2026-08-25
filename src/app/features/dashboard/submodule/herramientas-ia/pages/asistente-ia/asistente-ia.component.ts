import {
  Component, ChangeDetectionStrategy, OnInit, signal, computed, inject,
  ViewChild, ElementRef, DestroyRef, PLATFORM_ID,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule } from '@angular/material/menu';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';

import { MarkdownMessageComponent } from '../../../nomina/pages/analitica-nomina-ia/markdown-message.component';
import {
  AsistenteIaService, FolderAst, ConvAst, MensajeAst, ModuloDisponible, AdjuntoAst, Capacidades,
} from '../../service/asistente-ia.service';

const TODOS_MODULOS = ['nomina', 'contratacion', 'documentos', 'tesoreria', 'afiliaciones', 'salud'];

@Component({
  selector: 'app-asistente-ia',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule,
    MatCardModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatIconModule, MatTooltipModule, MatProgressSpinnerModule,
    MatMenuModule, MatCheckboxModule, MatChipsModule,
    MarkdownMessageComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './asistente-ia.component.html',
  styleUrls: ['./asistente-ia.component.css'],
})
export class AsistenteIaComponent implements OnInit {
  private svc = inject(AsistenteIaService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  @ViewChild('scrollBox') scrollBox?: ElementRef<HTMLElement>;
  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;

  // ── Estado historial ─────────────────────────────────────────────────────────
  folders = signal<FolderAst[]>([]);
  conversaciones = signal<ConvAst[]>([]);
  selectedFolder = signal<number | null>(null);
  activeConvId = signal<number | null>(null);
  mensajes = signal<MensajeAst[]>([]);
  loadingConv = signal<boolean>(false);
  sidebarOpen = signal<boolean>(false);

  // ── Módulos disponibles ──────────────────────────────────────────────────────
  modulosDisponibles = signal<ModuloDisponible[]>([]);
  // Módulos activos para la conversación actual (o la próxima a crear)
  modulosActivos = signal<string[]>([...TODOS_MODULOS]);
  modulosPanelOpen = signal<boolean>(false);

  // ── Composición ──────────────────────────────────────────────────────────────
  draft = signal<string>('');
  adjuntos = signal<AdjuntoAst[]>([]);
  sending = signal<boolean>(false);
  error = signal<string | null>(null);
  webSearchOn = signal<boolean>(false);
  recording = signal<boolean>(false);
  transcribing = signal<boolean>(false);
  capacidades = signal<Capacidades>({ transcripcion: false, webSearch: false });

  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  // ── Computadas ───────────────────────────────────────────────────────────────
  conversacionesFiltradas = computed<ConvAst[]>(() => {
    const f = this.selectedFolder();
    const list = this.conversaciones();
    return f == null ? list : list.filter((c) => c.folderId === f);
  });

  activeTitulo = computed<string>(() => {
    const id = this.activeConvId();
    return this.conversaciones().find((c) => c.id === id)?.titulo ?? 'Nueva conversación';
  });

  vacio = computed<boolean>(() => this.mensajes().length === 0);

  modulosEtiqueta = computed<string>(() => {
    const activos = this.modulosActivos();
    if (activos.length === TODOS_MODULOS.length) return 'Todos los módulos';
    if (activos.length === 0) return 'Ningún módulo';
    const nombres = this.modulosDisponibles()
      .filter((m) => activos.includes(m.clave))
      .map((m) => m.nombre);
    return nombres.length <= 2 ? nombres.join(', ') : `${nombres.length} módulos`;
  });

  readonly preguntas: string[] = [
    '¿Cuántos empleados activos hay actualmente?',
    'Resume el estado de las afiliaciones a EPS y pensión.',
    '¿Qué documentos están pendientes de carga?',
    'Explícame el flujo de contratación de principio a fin.',
    '¿Cuáles son las novedades de nómina más frecuentes?',
    '¿Hay traslados de EPS pendientes de procesar?',
    '¿Cómo funciona el módulo de tesorería?',
    'Dame una visión general del estado de la plataforma.',
  ];

  ngOnInit(): void {
    this.svc.capacidades().subscribe({ next: (c) => this.capacidades.set(c), error: () => {} });
    this.svc.modulosDisponibles().subscribe({ next: (m) => this.modulosDisponibles.set(m ?? []), error: () => {} });
    this.cargarFolders();
    this.cargarConversaciones();
    this.escucharPreguntaDeLaUrl();
  }

  /**
   * Pregunta que llega desde el menú inteligente del header (`?q=`): abre una
   * conversación nueva con ella y la envía sola, para que el usuario no tenga
   * que volver a escribirla. El parámetro se limpia de la URL enseguida, así
   * recargar la pantalla (o volver atrás) no reenvía la misma pregunta.
   * Se escucha el stream y no el snapshot porque, estando ya en el asistente,
   * preguntar otra vez desde el header no vuelve a construir el componente.
   */
  private escucharPreguntaDeLaUrl(): void {
    if (!this.isBrowser) return;

    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const pregunta = (params.get('q') ?? '').trim();
        if (!pregunta || this.sending()) return;

        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: {},
          replaceUrl: true,
        });

        this.nuevaConversacion();
        this.draft.set(pregunta);
        this.enviar();
      });
  }

  // ── Historial ─────────────────────────────────────────────────────────────────
  private cargarFolders(): void {
    this.svc.listarFolders().subscribe({ next: (f) => this.folders.set(f ?? []), error: () => {} });
  }

  private cargarConversaciones(): void {
    this.svc.listarConversaciones().subscribe({ next: (c) => this.conversaciones.set(c ?? []), error: () => {} });
  }

  abrirConversacion(id: number): void {
    this.activeConvId.set(id);
    this.sidebarOpen.set(false);
    this.loadingConv.set(true);
    this.svc.obtenerConversacion(id).subscribe({
      next: (d) => {
        this.mensajes.set(d.mensajes ?? []);
        // Restaurar los módulos de la conversación
        const mods = d.conversacion?.modulos;
        if (mods?.length) this.modulosActivos.set(mods);
        this.loadingConv.set(false);
        this.scrollAlFinal();
      },
      error: () => { this.mensajes.set([]); this.loadingConv.set(false); },
    });
  }

  nuevaConversacion(): void {
    this.activeConvId.set(null);
    this.mensajes.set([]);
    this.draft.set('');
    this.adjuntos.set([]);
    this.modulosActivos.set([...TODOS_MODULOS]);
    this.sidebarOpen.set(false);
  }

  seleccionarFolder(id: number | null): void { this.selectedFolder.set(id); }

  crearCarpeta(): void {
    const nombre = window.prompt('Nombre de la carpeta:');
    if (!nombre?.trim()) return;
    this.svc.crearFolder(nombre.trim()).subscribe({
      next: (f) => this.folders.update((l) => [...l, f]),
      error: () => this.error.set('No se pudo crear la carpeta.'),
    });
  }

  eliminarCarpeta(f: FolderAst, ev: Event): void {
    ev.stopPropagation();
    if (!window.confirm(`¿Eliminar la carpeta "${f.nombre}"? Las conversaciones no se borran.`)) return;
    this.svc.eliminarFolder(f.id).subscribe({
      next: () => {
        this.folders.update((l) => l.filter((x) => x.id !== f.id));
        if (this.selectedFolder() === f.id) this.selectedFolder.set(null);
        this.cargarConversaciones();
      },
      error: () => this.error.set('No se pudo eliminar la carpeta.'),
    });
  }

  moverConversacion(conv: ConvAst, folderId: number | null): void {
    this.svc.moverConversacion(conv.id, folderId).subscribe({
      next: (c) => this.conversaciones.update((l) => l.map((x) => (x.id === c.id ? c : x))),
      error: () => this.error.set('No se pudo mover la conversación.'),
    });
  }

  renombrarConversacion(conv: ConvAst, ev: Event): void {
    ev.stopPropagation();
    const titulo = window.prompt('Nuevo título:', conv.titulo);
    if (!titulo?.trim()) return;
    this.svc.renombrarConversacion(conv.id, titulo.trim()).subscribe({
      next: (c) => this.conversaciones.update((l) => l.map((x) => (x.id === c.id ? c : x))),
      error: () => this.error.set('No se pudo renombrar.'),
    });
  }

  eliminarConversacion(conv: ConvAst, ev: Event): void {
    ev.stopPropagation();
    if (!window.confirm(`¿Eliminar la conversación "${conv.titulo}"?`)) return;
    this.svc.eliminarConversacion(conv.id).subscribe({
      next: () => {
        this.conversaciones.update((l) => l.filter((x) => x.id !== conv.id));
        if (this.activeConvId() === conv.id) this.nuevaConversacion();
      },
      error: () => this.error.set('No se pudo eliminar la conversación.'),
    });
  }

  // ── Módulos ───────────────────────────────────────────────────────────────────
  toggleModulo(clave: string): void {
    const activos = this.modulosActivos();
    const yaActivo = activos.includes(clave);
    const nuevos = yaActivo ? activos.filter((m) => m !== clave) : [...activos, clave];
    this.modulosActivos.set(nuevos);

    // Si hay conversación activa, persiste el cambio inmediatamente
    const id = this.activeConvId();
    if (id != null) {
      this.svc.actualizarModulos(id, nuevos).subscribe({ error: () => {} });
    }
  }

  moduloActivo(clave: string): boolean { return this.modulosActivos().includes(clave); }

  seleccionarTodos(): void {
    this.modulosActivos.set([...TODOS_MODULOS]);
    const id = this.activeConvId();
    if (id != null) this.svc.actualizarModulos(id, [...TODOS_MODULOS]).subscribe({ error: () => {} });
  }

  // ── Composición / envío ───────────────────────────────────────────────────────
  usarPregunta(q: string): void { this.draft.set(q); }

  enviar(): void {
    const texto = this.draft().trim();
    if ((!texto && this.adjuntos().length === 0) || this.sending()) return;
    this.error.set(null);

    const nowIso = new Date().toISOString();
    const userMsg: MensajeAst = { id: -Date.now(), rol: 'user', contenido: texto, adjuntosJson: null, createdAt: nowIso };
    this.mensajes.update((m) => [...m, userMsg]);

    const body = {
      contenido: texto || '(archivo adjunto)',
      modulos: this.modulosActivos(),
      adjuntos: this.adjuntos().length ? this.adjuntos() : undefined,
      webSearch: this.webSearchOn(),
    };
    this.draft.set('');
    this.adjuntos.set([]);
    this.sending.set(true);
    this.scrollAlFinal();

    const convId = this.activeConvId();
    const req$ = convId == null
      ? this.svc.enviarMensajeNuevo(body)
      : this.svc.enviarMensaje(convId, body);

    req$.subscribe({
      next: (r) => {
        this.activeConvId.set(r.conversacionId);
        this.mensajes.update((m) => [...m, r.mensaje]);
        this.sending.set(false);
        this.scrollAlFinal();
        this.cargarConversaciones();
      },
      error: () => {
        this.sending.set(false);
        const err: MensajeAst = {
          id: -Date.now(), rol: 'assistant',
          contenido: '_No se pudo obtener respuesta. Intenta de nuevo._',
          adjuntosJson: null, createdAt: new Date().toISOString(),
        };
        this.mensajes.update((m) => [...m, err]);
        this.scrollAlFinal();
      },
    });
  }

  onKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); this.enviar(); }
  }

  // ── Adjuntos ──────────────────────────────────────────────────────────────────
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

  toggleWebSearch(): void { this.webSearchOn.update((v) => !v); }

  // ── Grabación de audio ────────────────────────────────────────────────────────
  async toggleGrabar(): Promise<void> {
    if (this.recording()) { this.mediaRecorder?.stop(); return; }
    this.error.set(null);

    if (typeof window !== 'undefined' && !window.isSecureContext) {
      this.error.set('La grabación de voz requiere HTTPS.'); return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      this.error.set('Tu navegador no soporta grabación de audio.'); return;
    }

    try {
      const perm: any = await (navigator as any).permissions?.query?.({ name: 'microphone' as PermissionName });
      if (perm?.state === 'denied') {
        this.error.set('Micrófono bloqueado. Actívalo en el candado 🔒 de la barra de direcciones.'); return;
      }
    } catch { /* Permissions API no disponible */ }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e: any) {
      const name = e?.name || '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        this.error.set('Permiso de micrófono denegado. Actívalo en el candado 🔒 e intenta de nuevo.');
      } else if (name === 'NotFoundError') {
        this.error.set('No se detectó ningún micrófono conectado.');
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
      mr.ondataavailable = (e) => { if (e.data?.size) this.chunks.push(e.data); };
      mr.onerror = () => {
        stream.getTracks().forEach((t) => t.stop());
        this.recording.set(false);
        this.error.set('Error durante la grabación.');
      };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        this.recording.set(false);
        if (!this.chunks.length) { this.error.set('No se grabó audio. Intenta de nuevo.'); return; }
        const blob = new Blob(this.chunks, { type: mr.mimeType || mime || 'audio/webm' });
        this.transcribirAudio(blob);
      };
      mr.start();
      this.recording.set(true);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      this.recording.set(false);
      this.error.set('No se pudo iniciar la grabación.');
    }
  }

  private mejorMime(): string {
    const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    const MR: any = (window as any).MediaRecorder;
    if (MR?.isTypeSupported) {
      for (const c of cands) { try { if (MR.isTypeSupported(c)) return c; } catch { /* noop */ } }
    }
    return '';
  }

  private transcribirAudio(blob: Blob): void {
    if (blob.size < 1200) {
      this.error.set('Grabación muy corta. Habla un momento y vuelve a tocar el micrófono.'); return;
    }
    this.transcribing.set(true);
    const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    this.svc.transcribir(blob, `audio.${ext}`).subscribe({
      next: (r) => {
        const texto = (r?.texto || '').trim();
        if (texto) this.draft.update((v) => (v ? v + ' ' : '') + texto);
        else this.error.set('No se detectó voz. Intenta más cerca del micrófono.');
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

  private scrollAlFinal(): void {
    setTimeout(() => {
      const el = this.scrollBox?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 40);
  }
}
