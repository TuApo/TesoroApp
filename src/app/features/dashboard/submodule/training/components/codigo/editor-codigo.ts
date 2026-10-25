import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output,
  SimpleChanges, ViewChild,
} from '@angular/core';
import { EditorView, basicSetup } from 'codemirror';
import { Compartment, EditorState, Extension } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { oneDark } from '@codemirror/theme-one-dark';

/**
 * Editor de código de una sola persona (el colaborativo del aula es otro). Se usa con
 * [(valor)] y cambia de lenguaje y de tema claro/oscuro en caliente.
 */
@Component({
  selector: 'app-editor-codigo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="ec" #host [style.min-height]="alto" [style.height]="altoFijo ? alto : null"></div>`,
  styles: [`
    :host { display: block; min-width: 0; }
    .ec { border: 1px solid var(--border-strong); border-radius: 12px; overflow: hidden; background: var(--surface); display: flex; flex-direction: column; }
    .ec ::ng-deep .cm-editor { flex: 1; min-height: inherit; }
    .ec ::ng-deep .cm-focused { outline: none; }
  `],
})
export class EditorCodigo implements AfterViewInit, OnChanges, OnDestroy {
  @Input() lenguaje = 'python';
  @Input() valor = '';
  @Input() soloLectura = false;
  @Input() alto = '240px';
  /** true = el alto es fijo (con scroll adentro) en vez de un mínimo que crece. */
  @Input() altoFijo = false;
  /** Modo examen: no se puede pegar código de afuera. */
  @Input() bloqueaPegado = false;
  @Input() etiqueta = 'Editor de código';
  @Output() valorChange = new EventEmitter<string>();

  @ViewChild('host', { static: true }) host!: ElementRef<HTMLDivElement>;

  private vista: EditorView | null = null;
  private idioma = new Compartment();
  private tema = new Compartment();
  private lectura = new Compartment();
  private observador: MutationObserver | null = null;

  ngAfterViewInit(): void {
    this.vista = new EditorView({
      parent: this.host.nativeElement,
      state: EditorState.create({
        doc: this.valor ?? '',
        extensions: [
          basicSetup,
          this.idioma.of(extensionDe(this.lenguaje)),
          this.tema.of(oscuro() ? oneDark : []),
          this.lectura.of(EditorState.readOnly.of(this.soloLectura)),
          EditorView.theme({ '&': { fontSize: '14px' }, '.cm-scroller': { fontFamily: 'var(--font-mono)', minHeight: this.alto } }),
          EditorView.contentAttributes.of({ 'aria-label': this.etiqueta }),
          EditorView.domEventHandlers({
            paste: () => this.bloqueaPegado,
            drop: () => this.bloqueaPegado,
          }),
          EditorView.updateListener.of(u => {
            if (u.docChanged) this.valorChange.emit(u.state.doc.toString());
          }),
        ],
      }),
    });
    // El tema de la app cambia con data-theme en <html>: el editor lo sigue.
    this.observador = new MutationObserver(() => {
      this.vista?.dispatch({ effects: this.tema.reconfigure(oscuro() ? oneDark : []) });
    });
    this.observador.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  ngOnChanges(c: SimpleChanges): void {
    if (!this.vista) return;
    if (c['lenguaje']) this.vista.dispatch({ effects: this.idioma.reconfigure(extensionDe(this.lenguaje)) });
    if (c['soloLectura']) this.vista.dispatch({ effects: this.lectura.reconfigure(EditorState.readOnly.of(this.soloLectura)) });
    if (c['valor']) {
      const actual = this.vista.state.doc.toString();
      if ((this.valor ?? '') !== actual) {
        this.vista.dispatch({ changes: { from: 0, to: actual.length, insert: this.valor ?? '' } });
      }
    }
  }

  ngOnDestroy(): void {
    this.observador?.disconnect();
    this.vista?.destroy();
  }
}

function oscuro(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

export function extensionDe(l: string): Extension {
  switch (l) {
    case 'python': return python();
    case 'javascript': return javascript();
    case 'java': return java();
    case 'c': case 'cpp': return cpp();
    default: return [];
  }
}
