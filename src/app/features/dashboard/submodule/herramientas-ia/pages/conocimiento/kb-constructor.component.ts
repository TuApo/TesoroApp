import {
  ChangeDetectionStrategy, Component, ElementRef, ViewEncapsulation, computed, effect, inject, input, output, signal,
  untracked, viewChild,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonToggleModule } from '@angular/material/button-toggle';

import { ConocimientoService, DocDetalle, DocDto, ModuloKbDto } from '../../service/conocimiento.service';
import { markdownToHtml } from '../../../nomina/pages/analitica-nomina-ia/markdown-lite';
import { mensajeDeError } from '../../../../../../shared/utils/mensaje-error';

interface Burbuja { rol: 'persona' | 'ia'; texto: string; html: string; adjunto?: string; }

const BIENVENIDA = `Hola. Construyamos juntos una base de conocimiento: cuéntame **qué proceso, política o tema** quieres que la IA domine,
pega el texto que tengas o **adjunta un archivo** (PDF, Word, Excel, imagen…): lo paso por Docling y lo integro al borrador.

Iré armando el documento a la derecha y te preguntaré lo que falte.`;

const INICIOS = [
  'Quiero documentar el proceso de contratación de un trabajador en misión',
  'Voy a adjuntar el reglamento interno para convertirlo en base',
  'Ayúdame a escribir las preguntas frecuentes de nómina',
];

/**
 * Constructor conversacional: la IA va redactando un Markdown con lo que la persona cuenta y
 * adjunta, y al final se guarda como base (nueva, o actualiza la que se abrió para seguir
 * construyendo). El borrador es editable a mano en cualquier momento.
 */
@Component({
  selector: 'app-kb-constructor',
  standalone: true,
  imports: [DecimalPipe, FormsModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule, MatButtonToggleModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  templateUrl: './kb-constructor.component.html',
  styleUrls: ['./kb-constructor.component.css'],
})
export class KbConstructorComponent {
  private svc = inject(ConocimientoService);

  readonly modulos = input<ModuloKbDto[]>([]);
  /** Base existente para seguir construyéndola (desde la vista individual). */
  readonly semilla = input<DocDetalle | null>(null);
  readonly guardado = output<DocDto>();

  private readonly hilo = viewChild<ElementRef<HTMLElement>>('hilo');
  private readonly archivoInput = viewChild<ElementRef<HTMLInputElement>>('archivo');

  readonly burbujas = signal<Burbuja[]>([this.burbuja('ia', BIENVENIDA)]);
  readonly mensaje = signal('');
  readonly pensando = signal(false);
  readonly sugerencias = signal<string[]>(INICIOS);
  readonly borrador = signal('');
  readonly nombre = signal('');
  readonly modulosSel = signal<string[]>([]);
  readonly documentoId = signal<number | null>(null);
  readonly vistaBorrador = signal<'vista' | 'editar'>('vista');
  readonly adjunto = signal<{ nombre: string; markdown: string; motor: string; aviso: string | null } | null>(null);
  readonly leyendoAdjunto = signal(false);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  readonly htmlBorrador = computed(() => markdownToHtml(this.borrador()));
  readonly puedeGuardar = computed(() => this.borrador().trim().length > 20 && this.nombre().trim().length > 0 && !this.guardando());
  readonly palabras = computed(() => (this.borrador().trim().match(/\S+/g) ?? []).length);

  constructor() {
    effect(() => {
      const s = this.semilla();
      if (!s) return;
      untracked(() => {
        this.documentoId.set(s.doc.id);
        this.nombre.set(s.doc.nombre);
        this.borrador.set(s.contenido ?? '');
        this.modulosSel.set(s.doc.modulos ?? []);
        this.burbujas.set([this.burbuja('ia',
          `Abrí **${s.doc.nombre}** para seguir construyéndola. ¿Qué le agregamos o corregimos? Al guardar se actualiza la misma base y se rehace su red semántica.`)]);
        this.sugerencias.set(['Revisa qué le falta a este documento', 'Agrega una sección de preguntas frecuentes', 'Resume los pasos en una tabla']);
      });
    });
  }

  private burbuja(rol: 'persona' | 'ia', texto: string, adjunto?: string): Burbuja {
    return { rol, texto, html: markdownToHtml(texto), adjunto };
  }

  // ── Chat ────────────────────────────────────────────────────────────────────
  enviar(texto?: string): void {
    const msg = (texto ?? this.mensaje()).trim();
    const adj = this.adjunto();
    if ((!msg && !adj) || this.pensando()) return;
    const historial = this.burbujas().slice(1).map((b) => ({ rol: b.rol, texto: b.texto }));
    this.burbujas.update((l) => [...l, this.burbuja('persona', msg || '(adjunto)', adj?.nombre)]);
    this.mensaje.set('');
    this.adjunto.set(null);
    this.sugerencias.set([]);
    this.pensando.set(true);
    this.error.set(null);
    this.bajar();

    this.svc.constructorMensaje({
      historial, mensaje: msg, borrador: this.borrador(), nombre: this.nombre(), modulos: this.modulosSel(),
      adjuntoNombre: adj?.nombre ?? null, adjuntoTexto: adj?.markdown ?? null,
    }).subscribe({
      next: (r) => {
        this.pensando.set(false);
        this.burbujas.update((l) => [...l, this.burbuja('ia', r.respuesta || 'Listo, actualicé el borrador.')]);
        if (r.borrador) this.borrador.set(r.borrador);
        if (r.nombre && !this.nombre().trim()) this.nombre.set(r.nombre);
        if (r.modulos?.length && this.modulosSel().length === 0) {
          const validas = new Set(this.modulos().map((m) => m.clave));
          this.modulosSel.set(r.modulos.filter((m) => validas.has(m)));
        }
        this.sugerencias.set(r.sugerencias ?? []);
        this.bajar();
      },
      error: (e) => {
        this.pensando.set(false);
        this.error.set(mensajeDeError(e, 'La IA no respondió. Intenta de nuevo.'));
      },
    });
  }

  alTeclear(ev: KeyboardEvent): void {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      this.enviar();
    }
  }

  abrirArchivo(): void { this.archivoInput()?.nativeElement.click(); }

  alElegirArchivo(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    if (f.size > 40 * 1024 * 1024) { this.error.set('El archivo supera 40 MB.'); return; }
    this.leyendoAdjunto.set(true);
    this.error.set(null);
    this.svc.constructorAdjunto(f).subscribe({
      next: (a) => {
        this.leyendoAdjunto.set(false);
        this.adjunto.set({ nombre: a.nombre, markdown: a.markdown, motor: a.motor, aviso: a.aviso });
      },
      error: (e) => { this.leyendoAdjunto.set(false); this.error.set(mensajeDeError(e, 'No se pudo leer el archivo.')); },
    });
  }

  private bajar(): void {
    setTimeout(() => {
      const el = this.hilo()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  // ── Borrador ────────────────────────────────────────────────────────────────
  moduloActivo(c: string): boolean { return this.modulosSel().includes(c); }

  toggleModulo(c: string): void {
    this.modulosSel.update((l) => (l.includes(c) ? l.filter((x) => x !== c) : [...l, c]));
  }

  guardar(): void {
    if (!this.puedeGuardar()) return;
    const mods = this.modulosSel().length ? this.modulosSel() : ['todos'];
    this.guardando.set(true);
    this.error.set(null);
    const id = this.documentoId();
    const peticion = id
      ? this.svc.editar(id, { nombre: this.nombre().trim(), contenido: this.borrador(), modulos: mods })
      : this.svc.guardarTexto(this.nombre().trim(), this.borrador(), mods, 'constructor');
    peticion.subscribe({
      next: (doc) => {
        this.guardando.set(false);
        this.documentoId.set(doc.id);
        this.aviso.set(id ? 'Base actualizada: se está rehaciendo su red semántica.' : 'Base creada: la IA ya la puede consultar mientras se arma su red.');
        this.guardado.emit(doc);
      },
      error: (e) => { this.guardando.set(false); this.error.set(mensajeDeError(e, 'No se pudo guardar la base.')); },
    });
  }

  nueva(): void {
    if (this.borrador().trim() && !window.confirm('¿Empezar una base nueva? Se descarta la conversación actual.')) return;
    this.burbujas.set([this.burbuja('ia', BIENVENIDA)]);
    this.borrador.set('');
    this.nombre.set('');
    this.modulosSel.set([]);
    this.documentoId.set(null);
    this.adjunto.set(null);
    this.aviso.set(null);
    this.error.set(null);
    this.sugerencias.set(INICIOS);
  }
}
