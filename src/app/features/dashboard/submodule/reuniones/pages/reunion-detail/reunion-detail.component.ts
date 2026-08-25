import {
  ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, inject, signal, viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ScrollingModule } from '@angular/cdk/scrolling';

import { ReunionesService } from '../../services/reuniones.service';
import { ReunionUploadService } from '../../services/reunion-upload.service';
import { GrabadorService } from '../../services/grabador.service';
import {
  Coincidencia, ETAPAS_EN_CURSO, ETAPA_LABEL, Grabacion, Participante, ReunionDetalle,
  SegmentoTranscripcion, Transcripcion,
} from '../../models/reunion.model';

type Pestana = 'resumen' | 'grabacion' | 'transcripcion';

/** Cada cuánto se pregunta por el avance del pipeline mientras hay trabajo en curso. */
const SONDEO_MS = 5000;

/**
 * Ficha de una reunión: datos, participantes, grabaciones y transcripción sincronizada.
 *
 * El avance del pipeline se consulta por sondeo mientras haya una grabación en proceso.
 * No es la solución bonita —lo sería SSE—, pero hoy ningún microservicio de la
 * plataforma expone streaming, y montarlo aquí sería estrenar un patrón para un caso.
 * El sondeo se apaga solo cuando todas las grabaciones terminan.
 */
@Component({
  selector: 'app-reunion-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MatIconModule, MatTooltipModule, ScrollingModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reunion-detail.component.html',
  styleUrl: './reunion-detail.component.css',
})
export class ReunionDetailComponent implements OnDestroy {
  private readonly ruta = inject(ActivatedRoute);
  private readonly api = inject(ReunionesService);
  readonly subidas = inject(ReunionUploadService);
  readonly grabador = inject(GrabadorService);

  private readonly audio = viewChild<ElementRef<HTMLAudioElement>>('reproductor');

  readonly reunionId = signal<string>('');
  readonly detalle = signal<ReunionDetalle | null>(null);
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly pestana = signal<Pestana>('resumen');

  // ── Grabaciones y pipeline ────────────────────────────────────────────────
  readonly grabaciones = signal<Grabacion[]>([]);
  readonly grabacionActiva = signal<Grabacion | null>(null);
  readonly puedeGrabar = GrabadorService.soportado();

  readonly hayTrabajoEnCurso = computed(() =>
    this.grabaciones().some(g => ETAPAS_EN_CURSO.includes(g.status)));

  // ── Transcripción ─────────────────────────────────────────────────────────
  readonly transcripcion = signal<Transcripcion | null>(null);
  readonly segmentos = signal<SegmentoTranscripcion[]>([]);
  readonly cargandoTranscripcion = signal(false);
  readonly urlAudio = signal<string | null>(null);
  readonly posicionMs = signal(0);
  readonly consulta = signal('');
  readonly coincidencias = signal<Coincidencia[] | null>(null);
  readonly editandoSegmento = signal<number | null>(null);
  readonly textoEditado = signal('');

  /** Segmento que suena ahora mismo: es lo que se resalta en la transcripción. */
  readonly segmentoActivo = computed(() => {
    const ms = this.posicionMs();
    return this.segmentos().find(s => ms >= s.start_ms && ms < s.end_ms)?.id ?? null;
  });

  // ── Participantes ─────────────────────────────────────────────────────────
  readonly nuevoParticipante = signal<Partial<Participante>>({ participant_type: 'USUARIO_FUNCIONAL' });
  readonly agregandoParticipante = signal(false);

  readonly TIPOS_PARTICIPANTE = [
    'SOLICITANTE', 'USUARIO_FUNCIONAL', 'ANALISTA_FUNCIONAL', 'DESARROLLADOR', 'LIDER_TECNICO',
    'PRODUCT_OWNER', 'ADMINISTRADOR', 'INVITADO', 'PROVEEDOR', 'CLIENTE', 'OTRO',
  ];

  private sondeo: ReturnType<typeof setInterval> | null = null;

  constructor() {
    const id = this.ruta.snapshot.paramMap.get('id') ?? '';
    this.reunionId.set(id);
    this.cargar();
  }

  ngOnDestroy(): void { this.detenerSondeo(); }

  // ── Carga ─────────────────────────────────────────────────────────────────

  cargar(): void {
    this.cargando.set(true);
    this.api.detalle(this.reunionId()).subscribe({
      next: (d) => {
        this.detalle.set(d);
        this.grabaciones.set(d.recordings);
        this.cargando.set(false);
        this.sincronizarSondeo();
        const lista = d.recordings;
        if (lista.length && !this.grabacionActiva()) this.seleccionarGrabacion(lista[lista.length - 1]);
      },
      error: (e) => {
        this.error.set(e?.error?.error ?? 'No se pudo cargar la reunión');
        this.cargando.set(false);
      },
    });
  }

  private refrescarGrabaciones(): void {
    this.api.grabaciones(this.reunionId()).subscribe({
      next: (gs) => {
        this.grabaciones.set(gs);
        const activa = this.grabacionActiva();
        if (activa) {
          const actualizada = gs.find(g => g.id === activa.id);
          if (actualizada) {
            const cambio = actualizada.status !== activa.status;
            this.grabacionActiva.set(actualizada);
            // Al terminar de transcribir, traer el texto sin que el usuario recargue.
            if (cambio && actualizada.segments_count) this.cargarTranscripcion(actualizada.id);
          }
        }
        this.sincronizarSondeo();
      },
      error: () => { /* el sondeo no molesta al usuario si falla una vuelta */ },
    });
  }

  private sincronizarSondeo(): void {
    if (this.hayTrabajoEnCurso() && !this.sondeo) {
      this.sondeo = setInterval(() => this.refrescarGrabaciones(), SONDEO_MS);
    } else if (!this.hayTrabajoEnCurso()) {
      this.detenerSondeo();
    }
  }

  private detenerSondeo(): void {
    if (this.sondeo) { clearInterval(this.sondeo); this.sondeo = null; }
  }

  // ── Subida ────────────────────────────────────────────────────────────────

  async elegirArchivo(evento: Event): Promise<void> {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0];
    if (!archivo) return;
    this.error.set('');
    try {
      await this.subidas.subir(this.reunionId(), archivo);
      input.value = '';
      this.refrescarGrabaciones();
    } catch (e: any) {
      this.error.set(e?.error?.error ?? e?.message ?? 'No se pudo subir la grabación');
    }
  }

  // ── Grabar en la app ──────────────────────────────────────────────────────

  async iniciarGrabacion(conVideo = false): Promise<void> {
    this.error.set('');
    try {
      await this.grabador.iniciar(this.reunionId(), conVideo);
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo iniciar la grabación');
    }
  }

  async finalizarGrabacion(): Promise<void> {
    try {
      await this.grabador.finalizar();
      this.refrescarGrabaciones();
    } catch (e: any) {
      this.error.set(e?.error?.error ?? e?.message ?? 'No se pudo cerrar la grabación');
    }
  }

  // ── Transcripción ─────────────────────────────────────────────────────────

  async seleccionarGrabacion(g: Grabacion): Promise<void> {
    this.grabacionActiva.set(g);
    this.urlAudio.set(null);
    this.coincidencias.set(null);
    if (g.segments_count) this.cargarTranscripcion(g.id);
    else { this.transcripcion.set(null); this.segmentos.set([]); }

    if (g.audio_ready || g.status === 'COMPLETED' || g.segments_count) {
      try { this.urlAudio.set(await this.api.urlDeMedia(g.id)); }
      catch { /* sin permiso de escucha: la transcripción se sigue leyendo */ }
    }
  }

  private cargarTranscripcion(grabacionId: string): void {
    this.cargandoTranscripcion.set(true);
    this.api.transcripcion(grabacionId).subscribe({
      next: (t) => {
        this.transcripcion.set(t);
        this.cargarSegmentos(grabacionId, 0, []);
      },
      error: () => { this.cargandoTranscripcion.set(false); this.transcripcion.set(null); },
    });
  }

  /** Trae los segmentos por páginas y los acumula; el listado se pinta con virtual scroll. */
  private cargarSegmentos(grabacionId: string, pagina: number, acumulado: SegmentoTranscripcion[]): void {
    this.api.segmentos(grabacionId, pagina, 500).subscribe({
      next: (p) => {
        const todos = [...acumulado, ...p.content];
        this.segmentos.set(todos);
        if (pagina + 1 < p.totalPages) this.cargarSegmentos(grabacionId, pagina + 1, todos);
        else this.cargandoTranscripcion.set(false);
      },
      error: () => this.cargandoTranscripcion.set(false),
    });
  }

  alAvanzar(): void {
    const el = this.audio()?.nativeElement;
    if (el) this.posicionMs.set(Math.floor(el.currentTime * 1000));
  }

  saltarA(ms: number): void {
    const el = this.audio()?.nativeElement;
    if (!el) return;
    el.currentTime = ms / 1000;
    el.play().catch(() => { /* el navegador puede exigir un gesto previo */ });
  }

  buscar(): void {
    const g = this.grabacionActiva();
    const q = this.consulta().trim();
    if (!g || q.length < 3) { this.coincidencias.set(null); return; }
    this.api.buscarEnTranscripcion(g.id, q).subscribe({
      next: (r) => this.coincidencias.set(r.matches),
      error: (e) => this.error.set(e?.error?.error ?? 'No se pudo buscar'),
    });
  }

  empezarEdicion(s: SegmentoTranscripcion): void {
    this.editandoSegmento.set(s.id);
    this.textoEditado.set(s.text);
  }

  guardarEdicion(s: SegmentoTranscripcion): void {
    const texto = this.textoEditado().trim();
    if (!texto || texto === s.text) { this.editandoSegmento.set(null); return; }
    this.api.editarSegmento(s.id, texto).subscribe({
      next: (actualizado) => {
        this.segmentos.update(lista => lista.map(x => x.id === s.id ? actualizado : x));
        this.editandoSegmento.set(null);
      },
      error: (e) => this.error.set(e?.error?.error ?? 'No se pudo guardar la corrección'),
    });
  }

  asignarHablante(hablanteId: string, participanteId: string): void {
    const valor = participanteId || null;
    this.api.asignarHablante(hablanteId, valor).subscribe({
      next: () => {
        // Renombrar NO re-transcribe: sólo se vuelve a leer la cabecera y los segmentos.
        const g = this.grabacionActiva();
        if (g) this.cargarTranscripcion(g.id);
      },
      error: (e) => this.error.set(e?.error?.error ?? 'No se pudo asignar el hablante'),
    });
  }

  // ── Participantes ─────────────────────────────────────────────────────────

  agregarParticipante(): void {
    const p = this.nuevoParticipante();
    if (!p.first_name?.trim() && !p.email?.trim()) {
      this.error.set('El participante necesita al menos nombre o correo');
      return;
    }
    this.agregandoParticipante.set(true);
    this.api.agregarParticipante(this.reunionId(), p).subscribe({
      next: () => {
        this.agregandoParticipante.set(false);
        this.nuevoParticipante.set({ participant_type: 'USUARIO_FUNCIONAL' });
        this.cargar();
      },
      error: (e) => {
        this.agregandoParticipante.set(false);
        this.error.set(e?.error?.error ?? 'No se pudo agregar el participante');
      },
    });
  }

  quitarParticipante(id: string): void {
    this.api.quitarParticipante(this.reunionId(), id).subscribe({
      next: () => this.cargar(),
      error: (e) => this.error.set(e?.error?.error ?? 'No se pudo quitar el participante'),
    });
  }

  actualizarNuevo<K extends keyof Participante>(campo: K, valor: Participante[K]): void {
    this.nuevoParticipante.update(p => ({ ...p, [campo]: valor }));
  }

  // ── Presentación ──────────────────────────────────────────────────────────

  etiquetaEtapa(g: Grabacion): string { return ETAPA_LABEL[g.status] ?? g.status; }

  /** trackBy del virtual scroll: por id, para no repintar miles de filas al editar una. */
  porId = (_: number, s: SegmentoTranscripcion) => s.id;

  enCurso(g: Grabacion): boolean { return ETAPAS_EN_CURSO.includes(g.status); }

  /** ms → 01:24:32 (o 24:32 si no llega a la hora). */
  reloj(ms: number | null | undefined): string {
    if (ms == null) return '--:--';
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const dosDigitos = (n: number) => `${n}`.padStart(2, '0');
    return h > 0 ? `${dosDigitos(h)}:${dosDigitos(m)}:${dosDigitos(s)}`
                 : `${dosDigitos(m)}:${dosDigitos(s)}`;
  }

  pesoLegible(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const unidades = ['KB', 'MB', 'GB'];
    let valor = bytes / 1024;
    let i = 0;
    while (valor >= 1024 && i < unidades.length - 1) { valor /= 1024; i++; }
    return `${valor.toFixed(valor < 10 ? 1 : 0)} ${unidades[i]}`;
  }
}
