import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, EventEmitter, Input, OnChanges, OnInit, Output,
  SimpleChanges, ViewChild, computed, inject, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';
import { EditorView, basicSetup } from 'codemirror';
import { Compartment, EditorState, Extension } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { html } from '@codemirror/lang-html';
import { oneDark } from '@codemirror/theme-one-dark';
import { yCollab } from 'y-codemirror.next';
import * as Y from 'yjs';

import { AulasService, Espacio } from '../../service/aulas.service';
import { mensajeDeError } from '../../service/disenador.service';
import { SalaEnVivo } from '../../aula/sala-en-vivo';
import { YjsSala } from '../../aula/yjs-sala';
import { EjecutorNavegador, LENGUAJES, Salida, enNavegador } from '../../aula/ejecutores';

const COLORES = ['#2B59F0', '#8CD50A', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4', '#EC4899', '#10B981'];

const PLANTILLAS: Record<string, string> = {
  python: '# Escribe tu programa aquí\nnombre = "mundo"\nprint(f"Hola, {nombre}")\n',
  javascript: '// Escribe tu programa aquí\nconst nombre = "mundo";\nconsole.log(`Hola, ${nombre}`);\n',
  html: '<!doctype html>\n<h1>Hola</h1>\n<p>Edita y pulsa Ejecutar.</p>\n<style> h1 { color: #2B59F0 } </style>\n',
  java: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hola, mundo");\n    }\n}\n',
  c: '#include <stdio.h>\n\nint main(void) {\n    printf("Hola, mundo\\n");\n    return 0;\n}\n',
  cpp: '#include <iostream>\n\nint main() {\n    std::cout << "Hola, mundo" << std::endl;\n    return 0;\n}\n',
  csharp: 'using System;\n\nclass Program {\n    static void Main() {\n        Console.WriteLine("Hola, mundo");\n    }\n}\n',
  go: 'package main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hola, mundo")\n}\n',
};

/**
 * Código compartido del aula (o del equipo): varios archivos, todos editan a la vez (Yjs), cada
 * quien ejecuta en su navegador (Python, JavaScript, HTML) o compila en el servidor (Java, C,
 * C++…), y se entrega como trabajo del taller.
 */
@Component({
  selector: 'app-aula-codigo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule],
  templateUrl: './panel-codigo.html',
  styleUrl: './panel-codigo.css',
})
export class PanelCodigo implements OnInit, OnChanges {
  @Input({ required: true }) aulaId!: string;
  @Input({ required: true }) sala!: SalaEnVivo;
  @Input() equipoId: string | null = null;
  @Input() dirijo = false;
  @Input() ejecutorServidor = false;
  @Input() oscuro = false;
  /** Pide al aula que muestre este archivo en el escenario de todos. */
  @Output() alEscenario = new EventEmitter<string>();
  @ViewChild('editor', { static: true }) editorEl!: ElementRef<HTMLElement>;
  @ViewChild('ejecutor', { static: true }) ejecutorEl!: ElementRef<HTMLElement>;

  private api = inject(AulasService);
  private san = inject(DomSanitizer);

  readonly archivos = signal<Espacio[]>([]);
  readonly actual = signal<Espacio | null>(null);
  readonly salida = signal<Salida | null>(null);
  readonly ejecutando = signal(false);
  readonly vista = signal<SafeHtml | null>(null);
  readonly creando = signal(false);
  readonly lenguajes = LENGUAJES;
  readonly lenguaje = computed(() => this.actual()?.lenguaje ?? 'python');
  readonly dondeCorre = computed(() => enNavegador(this.lenguaje()) ? 'en tu navegador' : 'en el servidor');

  nuevoNombre = '';
  nuevoLenguaje = 'python';
  entrada = '';

  private vistaEditor: EditorView | null = null;
  private yjs: YjsSala | null = null;
  private ejecutor: EjecutorNavegador | null = null;
  private tema = new Compartment();
  private idioma = new Compartment();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.soltar());
  }

  async ngOnInit(): Promise<void> {
    this.ejecutor = new EjecutorNavegador(this.ejecutorEl.nativeElement, `${location.origin}/pyodide/`);
    await this.cargar();
  }

  ngOnChanges(c: SimpleChanges): void {
    if (c['oscuro'] && this.vistaEditor) {
      this.vistaEditor.dispatch({ effects: this.tema.reconfigure(this.oscuro ? oneDark : []) });
    }
  }

  async cargar(abrir?: string): Promise<void> {
    try {
      const todos = (await this.api.espacios(this.aulaId)).filter(e => e.tipo === 'CODIGO' && (e.team_id ?? null) === this.equipoId);
      this.archivos.set(todos);
      const elegir = todos.find(e => e.id === (abrir ?? this.actual()?.id)) ?? todos[0] ?? null;
      if (elegir && elegir.id !== this.actual()?.id) await this.abrir(elegir);
    } catch (e) {
      Swal.fire({ toast: true, position: 'top-end', timer: 3000, showConfirmButton: false, icon: 'error', title: mensajeDeError(e) });
    }
  }

  async crear(): Promise<void> {
    this.creando.set(true);
    try {
      const e = await this.api.crearEspacio(this.aulaId, {
        tipo: 'CODIGO', lenguaje: this.nuevoLenguaje, team_id: this.equipoId,
        nombre: this.nuevoNombre.trim() || null,
      });
      // El archivo nuevo arranca con una plantilla; se guarda como estado Yjs para que todos la vean igual.
      const d = new Y.Doc();
      d.getText('codigo').insert(0, PLANTILLAS[this.nuevoLenguaje] ?? '');
      const b = btoa(String.fromCharCode(...Y.encodeStateAsUpdate(d)));
      await this.api.guardarEspacio(this.aulaId, e.id, { yjs_estado: b, contenido: d.getText('codigo').toString() });
      d.destroy();
      this.nuevoNombre = '';
      this.sala.enviar('aula.espacios', { accion: 'nuevo', id: e.id });
      await this.cargar(e.id);
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'No se pudo crear el archivo', text: mensajeDeError(err) });
    } finally {
      this.creando.set(false);
    }
  }

  async abrir(e: Espacio): Promise<void> {
    await this.soltarDocumento();
    // Traigo la última foto guardada, por si alguien la cambió antes de que yo entrara.
    const fresco = (await this.api.espacios(this.aulaId)).find(x => x.id === e.id) ?? e;
    this.actual.set(fresco);
    this.salida.set(null);
    this.vista.set(null);
    const color = COLORES[Math.abs([...this.sala.identidad].reduce((a, c) => a + c.charCodeAt(0), 0)) % COLORES.length];
    this.yjs = new YjsSala(this.sala, fresco.id, {
      estadoInicial: fresco.yjs_estado,
      responsable: () => this.dirijo,
      usuario: { nombre: this.sala.nombre, color },
      guardar: async (b64, doc) => {
        await this.api.guardarEspacio(this.aulaId, fresco.id, { yjs_estado: b64, contenido: doc.getText('codigo').toString() });
      },
    });
    const texto = this.yjs.doc.getText('codigo');
    if (!texto.length && !fresco.yjs_estado && fresco.contenido) texto.insert(0, fresco.contenido);
    this.vistaEditor = new EditorView({
      parent: this.editorEl.nativeElement,
      state: EditorState.create({
        doc: texto.toString(),
        extensions: [
          basicSetup,
          this.idioma.of(this.extensionDe(fresco.lenguaje ?? 'python')),
          this.tema.of(this.oscuro ? oneDark : []),
          EditorView.theme({ '&': { height: '100%', fontSize: '14px' }, '.cm-scroller': { fontFamily: 'var(--font-mono)' } }),
          yCollab(texto, this.yjs.awareness),
        ],
      }),
    });
  }

  private extensionDe(l: string): Extension {
    switch (l) {
      case 'python': return python();
      case 'javascript': return javascript();
      case 'html': return html();
      case 'java': return java();
      case 'c': case 'cpp': return cpp();
      default: return [];
    }
  }

  codigo(): string {
    return this.yjs?.doc.getText('codigo').toString() ?? '';
  }

  async ejecutar(): Promise<void> {
    const e = this.actual();
    if (!e || this.ejecutando()) return;
    this.ejecutando.set(true);
    this.salida.set(null);
    try {
      const l = e.lenguaje ?? 'python';
      if (enNavegador(l)) {
        const r = await this.ejecutor!.ejecutar(l, this.codigo(), this.entrada);
        if (r.html !== undefined) this.vista.set(this.san.bypassSecurityTrustHtml(r.html));
        this.salida.set(r);
      } else {
        const r = await this.api.ejecutar(l, [{ nombre: e.nombre, contenido: this.codigo() }], this.entrada);
        this.salida.set({ ok: r.ok, salida: r.salida, errores: r.fase === 'COMPILACION' && r.errores ? 'Error de compilación:\n' + r.errores : r.errores, ms: r.milisegundos });
      }
    } catch (err) {
      this.salida.set({ ok: false, salida: '', errores: mensajeDeError(err, 'No se pudo ejecutar'), ms: 0 });
    } finally {
      this.ejecutando.set(false);
    }
  }

  async entregar(): Promise<void> {
    const e = this.actual();
    if (!e) return;
    const r = await Swal.fire({ title: 'Entregar este código', input: 'text', inputValue: `${e.nombre}`, inputLabel: 'Título de la entrega',
      showCancelButton: true, confirmButtonText: 'Entregar', cancelButtonText: 'Cancelar' });
    if (!r.isConfirmed) return;
    try {
      await this.api.entregar(this.aulaId, { titulo: r.value || e.nombre, contenido: this.codigo(), lenguaje: e.lenguaje, team_id: this.equipoId, workspace_id: e.id });
      this.sala.enviar('aula.entregas', { accion: 'nueva' });
      Swal.fire({ toast: true, position: 'top-end', timer: 2500, showConfirmButton: false, icon: 'success', title: 'Entregado' });
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'No se pudo entregar', text: mensajeDeError(err) });
    }
  }

  async guardarAhora(): Promise<void> {
    await this.yjs?.guardarSiToca(true);
  }

  private async soltarDocumento(): Promise<void> {
    this.vistaEditor?.destroy();
    this.vistaEditor = null;
    await this.yjs?.cerrar();
    this.yjs = null;
  }

  private soltar(): void {
    this.soltarDocumento();
    this.ejecutor?.destruir();
  }
}
