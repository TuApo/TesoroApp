import {
  ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Injector, Input, OnChanges, Output,
  ViewChild, afterNextRender, computed, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';

import { Diseno, DisenadorService, TurnoDiseno, mensajeDeError } from '../../service/disenador.service';
import { GrabadoraVoz } from '../grabadora-voz/grabadora-voz';

/**
 * Paso 2: la entrevista. La IA pregunta de a una cosa; el profesor responde escribiendo, tocando
 * una respuesta sugerida, dictando o adjuntando el documento que la pregunta pide.
 *
 * A la derecha está lo que la IA va entendiendo (el mapa del material y las decisiones), para
 * que el profesor corrija a tiempo si algo quedó mal: "no, no es para supervisores".
 */
@Component({
  selector: 'app-paso-entrevista',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, GrabadoraVoz],
  templateUrl: './paso-entrevista.html',
  styleUrls: ['./pasos.css', './paso-entrevista.css'],
})
export class PasoEntrevista implements OnChanges {
  @Input({ required: true }) diseno!: Diseno;
  @Input() ocupado = false;
  @Output() cambio = new EventEmitter<Diseno>();
  @Output() ir = new EventEmitter<'material' | 'estructura'>();

  @ViewChild('hilo') hilo?: ElementRef<HTMLElement>;

  private api = inject(DisenadorService);
  private injector = inject(Injector);

  respuesta = '';
  readonly via = signal<'TEXTO' | 'VOZ'>('TEXTO');
  readonly enviando = signal(false);
  readonly transcribiendo = signal(false);
  readonly adjuntando = signal(false);
  readonly temaAbierto = signal<string | null>(null);
  private ultimoLargo = 0;

  readonly etiquetasTema: Record<string, string> = {
    PUBLICO: 'Público', OBJETIVOS: 'Objetivos', ALCANCE: 'Alcance', DURACION: 'Duración',
    MODALIDAD: 'Modalidad', EVALUACION: 'Evaluación', PRACTICA: 'Práctica', ESTILO: 'Estilo',
    RECURSOS: 'Recursos', OTROS: 'Otros',
  };

  readonly camposDecision: { clave: keyof Diseno['decisiones']; etiqueta: string }[] = [
    { clave: 'publico', etiqueta: 'Para quién' },
    { clave: 'nivel_previo', etiqueta: 'Qué saben ya' },
    { clave: 'alcance', etiqueta: 'Alcance' },
    { clave: 'duracion', etiqueta: 'Duración' },
    { clave: 'modalidad', etiqueta: 'Modalidad' },
    { clave: 'evaluacion', etiqueta: 'Evaluación' },
    { clave: 'practica', etiqueta: 'Práctica' },
    { clave: 'estilo', etiqueta: 'Estilo' },
    { clave: 'recursos', etiqueta: 'Recursos' },
  ];

  private readonly dis = signal<Diseno | null>(null);

  /** La pregunta que está esperando respuesta: la última de la IA sin respuesta detrás. */
  readonly pendiente = computed<TurnoDiseno | null>(() => {
    const conv = this.dis()?.conversacion ?? [];
    for (let i = conv.length - 1; i >= 0; i--) {
      const t = conv[i];
      if (t.rol === 'PROFESOR') return null;
      if (t.tema && t.tema !== 'LISTO') return t;
    }
    return null;
  });

  readonly respuestas = computed(() => (this.dis()?.conversacion ?? []).filter(t => t.rol === 'PROFESOR').length);

  ngOnChanges(): void {
    this.dis.set(this.diseno);
    const largo = this.diseno.conversacion.length + (this.ocupado ? 1 : 0);
    if (largo !== this.ultimoLargo) {
      this.ultimoLargo = largo;
      afterNextRender(() => {
        const el = this.hilo?.nativeElement;
        if (el) el.scrollTop = el.scrollHeight;
      }, { injector: this.injector });
    }
  }

  usarSugerencia(s: string): void {
    this.respuesta = this.respuesta.trim() ? `${this.respuesta.trim()} ${s}` : s;
  }

  async dictado(audio: Blob): Promise<void> {
    this.transcribiendo.set(true);
    try {
      const { texto } = await this.api.dictado(this.diseno.id, audio);
      if (texto) {
        this.respuesta = this.respuesta.trim() ? `${this.respuesta.trim()} ${texto}` : texto;
        this.via.set('VOZ');
      }
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo transcribir', text: mensajeDeError(e) });
    } finally {
      this.transcribiendo.set(false);
    }
  }

  async adjuntar(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length) return;
    this.adjuntando.set(true);
    try {
      let d: Diseno | null = null;
      for (const f of files) {
        const documentId = await this.api.subirMaterial(f, f.name);
        d = await this.api.agregarFuente(this.diseno.id, {
          tipo: 'ARCHIVO', titulo: f.name, document_id: documentId, mime: f.type || null, bytes: f.size,
        });
      }
      if (d) this.cambio.emit(d);
      const nombres = files.map(f => f.name).join(', ');
      this.respuesta = `${this.respuesta.trim()} (Adjunté: ${nombres})`.trim();
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo adjuntar', text: mensajeDeError(e) });
    } finally {
      this.adjuntando.set(false);
    }
  }

  async enviar(saltar = false): Promise<void> {
    if (this.enviando() || this.ocupado) return;
    if (!saltar && !this.respuesta.trim()) return;
    this.enviando.set(true);
    try {
      const d = await this.api.responder(this.diseno.id, {
        texto: saltar ? null : this.respuesta.trim(), pregunta_id: this.pendiente()?.id ?? null,
        via: this.via(), saltar,
      });
      this.respuesta = '';
      this.via.set('TEXTO');
      this.cambio.emit(d);
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo enviar', text: mensajeDeError(e) });
    } finally {
      this.enviando.set(false);
    }
  }

  teclado(ev: KeyboardEvent): void {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); this.enviar(); }
  }

  async empezar(): Promise<void> {
    try {
      this.cambio.emit(await this.api.analizar(this.diseno.id));
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo empezar', text: mensajeDeError(e) });
    }
  }

  async estructurar(): Promise<void> {
    try {
      this.cambio.emit(await this.api.estructurar(this.diseno.id));
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo pedir la estructura', text: mensajeDeError(e) });
    }
  }

  valor(clave: keyof Diseno['decisiones']): string | null {
    const v = this.diseno.decisiones?.[clave];
    if (Array.isArray(v)) return v.length ? v.join(' · ') : null;
    return (v as string | null | undefined) || null;
  }

  alternarTema(clave: string): void {
    this.temaAbierto.set(this.temaAbierto() === clave ? null : clave);
  }
}
