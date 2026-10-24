import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, computed, inject, input, signal, viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Compromiso, MensajeLlamada, Momento, Pista, Segmento, Transcripcion } from '../../modelos';
import { ChatStoreService } from '../../service/chat-store.service';
import { ComunicacionesApiService } from '../../service/comunicaciones-api.service';
import { colorDe, duracionLarga, iconoAdjunto, mmss, textoConEnlaces } from '../../utiles';
import { ComAvatar } from '../avatar/avatar';
import { ComCompromiso, PersonaRef } from '../compromiso/compromiso-item';
import { ComAsistentePanel } from '../asistente/asistente-panel';
import { ETIQUETA_TIPO } from '../llamada/llamada-envivo';

/** Abre el acta de una llamada en un diálogo. */
export function abrirActa(dialog: MatDialog, llamadaId: string): void {
  dialog.open(ActaDialog, { data: { llamadaId }, width: 'min(980px, 100vw)', maxWidth: '100vw', height: 'min(88vh, 900px)',
    panelClass: 'com-acta-panel', autoFocus: false });
}

/** Una entrada de la línea de tiempo del acta: algo que se dijo o algo que se escribió en el chat. */
export interface EntradaActa { clave: string; ms: number; voz?: Segmento; chat?: MensajeLlamada }

/**
 * El acta de una llamada: resumen, decisiones, pendientes, compromisos y la
 * transcripción completa por hablante, con el audio de cada quien para oír el
 * momento exacto de una frase, intercalada con lo que se escribieron en el chat.
 */
@Component({
  selector: 'app-com-acta',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatTooltipModule, ComAvatar, ComCompromiso, ComAsistentePanel],
  templateUrl: './acta.html',
  styleUrl: './acta.css',
})
export class ComActa implements OnInit {
  readonly api = inject(ComunicacionesApiService);
  private readonly store = inject(ChatStoreService);
  private readonly destroyRef = inject(DestroyRef);

  readonly llamadaId = input.required<string>();
  readonly t = signal<Transcripcion | null>(null);
  readonly error = signal<string | null>(null);
  readonly filtro = signal('');
  readonly sonando = signal<number | null>(null);
  private readonly audio = viewChild<ElementRef<HTMLAudioElement>>('audio');
  private finDeTramo: number | null = null;

  readonly procesando = computed(() => ['PENDIENTE', 'PROCESANDO'].includes(this.t()?.llamada.transcripcion_estado ?? ''));
  readonly personas = computed<PersonaRef[]>(() =>
    (this.t()?.llamada.participantes ?? []).map(p => ({ usuario_id: p.usuario_id, nombre: p.nombre })));
  readonly segmentos = computed(() => {
    const f = this.filtro().trim().toLowerCase();
    const s = this.t()?.segmentos ?? [];
    return f ? s.filter(x => x.texto.toLowerCase().includes(f) || x.nombre.toLowerCase().includes(f)) : s;
  });
  readonly hayChat = computed(() => (this.t()?.chat ?? []).length > 0);
  readonly momentos = computed<Momento[]>(() => this.t()?.momentos ?? []);
  /** A la derecha: la transcripción o el asistente de IA sobre esta llamada. */
  readonly vistaDer = signal<'transcripcion' | 'ia'>('transcripcion');
  /** Lo dicho y lo escrito en orden de tiempo (a igual momento, primero lo dicho). */
  readonly linea = computed<EntradaActa[]>(() => {
    const f = this.filtro().trim().toLowerCase();
    const chat = (this.t()?.chat ?? []).filter(m => !f || (m.texto ?? '').toLowerCase().includes(f)
      || (m.autor_nombre ?? '').toLowerCase().includes(f) || m.adjuntos.some(a => a.nombre.toLowerCase().includes(f)));
    const todo: EntradaActa[] = [
      ...this.segmentos().map(s => ({ clave: 's' + s.id, ms: s.inicio_ms, voz: s })),
      ...chat.map(m => ({ clave: 'm' + m.id, ms: m.momento_ms, chat: m })),
    ];
    return todo.sort((a, b) => a.ms - b.ms || (a.voz ? 0 : 1) - (b.voz ? 0 : 1));
  });
  readonly asistentes = computed(() => (this.t()?.llamada.participantes ?? []).filter(p => p.unido_en));

  ngOnInit(): void {
    this.cargar();
    // Cuando termina de transcribir (o cambia un compromiso) se refresca sola.
    this.store.eventos$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(({ nombre, datos }) => {
      if ((nombre === 'transcripcion' || nombre === 'memoria') && datos?.llamada_id === this.llamadaId()) this.cargar();
    });
  }

  cargar(): void {
    this.api.transcripcion(this.llamadaId()).subscribe({
      next: t => { this.t.set(t); this.error.set(null); },
      error: e => this.error.set(e?.status === 403 ? 'No participaste en esta llamada.' : 'No se pudo cargar el acta.'),
    });
  }

  reprocesar(): void {
    this.api.reprocesar(this.llamadaId()).subscribe({ next: () => this.cargar() });
  }

  titulo(): string {
    const t = this.t();
    if (!t) return 'Acta';
    const f = new Date(t.llamada.creada_en).toLocaleString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
    return t.llamada.titulo || (t.llamada.tipo === 'VIDEO' ? 'Videollamada' : 'Llamada') + ' del ' + f;
  }

  fechaLarga(iso: string): string {
    return new Date(iso).toLocaleString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  color(id: string | null): string { return colorDe(id); }
  etiquetaTipo(tipo: string | null): string { return tipo ? ETIQUETA_TIPO[tipo] ?? tipo : ''; }

  /** Lleva la transcripción al tramo de un momento. */
  irAMomentoGuardado(m: Momento): void {
    this.vistaDer.set('transcripcion');
    this.filtro.set('');
    const s = (this.t()?.segmentos ?? []).reduce<Segmento | null>((mejor, x) =>
      Math.abs(x.inicio_ms - m.momento_ms) < Math.abs((mejor?.inicio_ms ?? Infinity) - m.momento_ms) ? x : mejor, null);
    if (s) setTimeout(() => document.getElementById('seg-' + s.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }
  html(m: MensajeLlamada): string { return textoConEnlaces(m.texto); }
  icono(clase: string, mime: string): string { return iconoAdjunto(clase, mime); }
  abs(u: string | null): string | null { return this.api.absoluta(u); }
  tiempo(ms: number): string { return mmss(ms); }
  dur(s: number | null): string { return duracionLarga(s); }

  pistaDe(s: Segmento): Pista | undefined {
    const ps = (this.t()?.pistas ?? []).filter(p => p.usuario_id === s.usuario_id && p.audio_url);
    // La pista que contiene ese instante (una persona puede tener varias si se reconectó).
    return [...ps].reverse().find(p => p.desfase_ms <= s.inicio_ms) ?? ps[0];
  }

  /** Reproduce solo esa frase, desde el audio de quien la dijo. */
  escuchar(s: Segmento): void {
    const p = this.pistaDe(s);
    const el = this.audio()?.nativeElement;
    if (!p?.audio_url || !el) return;
    const url = this.api.absoluta(p.audio_url)!;
    if (el.src !== url) el.src = url;
    el.currentTime = Math.max(0, (s.inicio_ms - p.desfase_ms) / 1000 - 0.3);
    this.finDeTramo = (s.fin_ms - p.desfase_ms) / 1000 + 0.4;
    this.sonando.set(s.id);
    void el.play().catch(() => this.sonando.set(null));
  }

  alAvanzar(): void {
    const el = this.audio()?.nativeElement;
    if (el && this.finDeTramo != null && el.currentTime >= this.finDeTramo) { el.pause(); this.sonando.set(null); this.finDeTramo = null; }
  }

  irAMomento(c: Compromiso): void {
    if (c.momento_ms == null) return;
    const s = (this.t()?.segmentos ?? []).reduce<Segmento | null>((mejor, x) =>
      Math.abs(x.inicio_ms - c.momento_ms!) < Math.abs((mejor?.inicio_ms ?? Infinity) - c.momento_ms!) ? x : mejor, null);
    if (!s) return;
    this.filtro.set('');
    setTimeout(() => document.getElementById('seg-' + s.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }

  actualizarCompromiso(c: Compromiso): void {
    this.t.update(t => t ? { ...t, compromisos: t.compromisos.map(x => x.id === c.id ? c : x) } : t);
  }

  quitarCompromiso(id: string): void {
    this.t.update(t => t ? { ...t, compromisos: t.compromisos.filter(x => x.id !== id) } : t);
  }

  nuevoCompromiso(desc: HTMLInputElement): void {
    const t = this.t();
    const texto = desc.value.trim();
    if (!t || !texto) return;
    this.api.crearCompromiso({ conversacion_id: t.llamada.conversacion_id, descripcion: texto }).subscribe({
      next: c => { this.t.update(x => x ? { ...x, compromisos: [...x.compromisos, c] } : x); desc.value = ''; },
    });
  }

  /** El acta como texto plano (para pegar en un correo o guardar). */
  comoTexto(): string {
    const t = this.t();
    if (!t) return '';
    const r = t.resumen;
    const l: string[] = [this.titulo(), this.fechaLarga(t.llamada.creada_en) + ' · ' + this.dur(t.llamada.duracion_seg), ''];
    l.push('Participantes: ' + this.asistentes().map(p => p.nombre).join(', '), '');
    if (r) {
      l.push('RESUMEN', r.resumen, '');
      if (r.decisiones.length) l.push('DECISIONES', ...r.decisiones.map(d => '- ' + d), '');
      if (r.pendientes.length) l.push('PENDIENTES', ...r.pendientes.map(d => '- ' + d), '');
    }
    if (this.momentos().length) {
      l.push('MOMENTOS IMPORTANTES', ...this.momentos().map(m => `- [${mmss(m.momento_ms)}] ${m.titulo ?? 'Momento'}`
        + (m.tipo ? ` (${this.etiquetaTipo(m.tipo)})` : '') + (m.origen === 'IA' ? ' · detectado por la IA' : ` · guardado por ${m.creado_por_nombre}`)), '');
    }
    if (t.compromisos.length) {
      l.push('COMPROMISOS', ...t.compromisos.map(c => `- ${c.descripcion} · ${c.responsable_nombre ?? 'sin responsable'}`
        + (c.fecha_limite ? ` · para el ${c.fecha_limite}` : '') + ` [${c.estado}]`), '');
    }
    const todo = [
      ...t.segmentos.map(s => ({ ms: s.inicio_ms, orden: 0, txt: `[${mmss(s.inicio_ms)}] ${s.nombre}: ${s.texto}` })),
      ...(t.chat ?? []).map(m => ({
        ms: m.momento_ms, orden: 1,
        txt: `[${mmss(m.momento_ms)}] ${m.autor_nombre ?? 'Participante'} (chat): ${m.texto ?? ''}`
          + (m.adjuntos.length ? ` [archivos: ${m.adjuntos.map(a => a.nombre).join(', ')}]` : ''),
      })),
    ].sort((a, b) => a.ms - b.ms || a.orden - b.orden);
    l.push(t.chat?.length ? 'TRANSCRIPCIÓN Y CHAT' : 'TRANSCRIPCIÓN', ...todo.map(x => x.txt));
    return l.join('\n');
  }

  copiar(): void { void navigator.clipboard?.writeText(this.comoTexto()); }

  descargar(): void {
    const blob = new Blob([this.comoTexto()], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (this.t()?.llamada.titulo || 'acta-llamada').replace(/[^\p{L}\p{N} _-]/gu, '') + '.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
}

@Component({
  selector: 'app-com-acta-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ComActa, MatIconModule],
  template: `
    <button type="button" class="cerrar" (click)="ref.close()" aria-label="Cerrar"><mat-icon>close</mat-icon></button>
    <app-com-acta [llamadaId]="data.llamadaId" />`,
  styles: [`
    :host { display: block; height: 100%; position: relative; }
    .cerrar { position: absolute; top: .6rem; right: .6rem; z-index: 2; border: 0; background: var(--surface-3); width: 36px; height: 36px;
      border-radius: 50%; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; color: var(--text); }
  `],
})
export class ActaDialog {
  readonly data = inject<{ llamadaId: string }>(MAT_DIALOG_DATA);
  readonly ref = inject(MatDialogRef<ActaDialog>);
}
