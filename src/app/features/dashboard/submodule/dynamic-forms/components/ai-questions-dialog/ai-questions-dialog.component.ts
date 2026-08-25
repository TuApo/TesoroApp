import {
  ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { FieldType, FieldTypeInfo } from '../../models/dynamic-forms.models';
import { CampoBorrador, ContextoFormulario } from '../../models/form-drafts';
import { PROMPTS_PREGUNTAS } from '../../models/form-templates';
import { FormAiService, PreguntaIa } from '../../services/form-ai.service';

/**
 * Una propuesta aceptada: la pregunta y DÓNDE va.
 * `seccionIndex === -1` ⇒ crear una sección nueva titulada `nuevaSeccion`.
 */
export type { ContextoFormulario };

export interface PropuestaAceptada {
  campo: CampoBorrador;
  seccionIndex: number;
  nuevaSeccion?: string;
}

/**
 * ASISTENTE DE PREGUNTAS.
 *
 * Propone lo que le FALTA al formulario que se está armando o editando, y el usuario
 * marca lo que quiere. Es aditivo por diseño: nunca reescribe ni borra lo que ya hay
 * —en edición eso publicaría una versión con preguntas que nadie revisó—, y cada
 * propuesta llega con su sección destino, cambiable antes de insertar.
 */
@Component({
  selector: 'app-ai-questions-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="aq-fondo" (click)="cerrar.emit()">
      <div class="aq-hoja" role="dialog" aria-modal="true" aria-labelledby="aq-titulo"
           (click)="$event.stopPropagation()">

        <div class="aq-head">
          <div class="aq-head__texto">
            <h2 class="aq-titulo" id="aq-titulo">Asistente de preguntas</h2>
            <p class="aq-sub">La IA propone lo que falta; tú eliges qué entra y en qué sección.</p>
          </div>
          <button type="button" class="aq-cerrar" (click)="cerrar.emit()" aria-label="Cerrar">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>

        <div class="aq-cuerpo">
          <textarea class="aq-textarea" rows="3" maxlength="1200"
                    [ngModel]="instruccion()" (ngModelChange)="instruccion.set($event)"
                    aria-label="Qué quieres agregar"
                    placeholder="Ej. faltan los datos del vehículo y la evidencia fotográfica del estado en que se recibe"></textarea>

          <div class="aq-chips">
            @for (p of prompts; track p.titulo) {
              <button type="button" class="aq-chip-btn" (click)="instruccion.set(p.prompt)">
                <span class="material-symbols-outlined" aria-hidden="true">bolt</span>
                {{ p.titulo }}
              </button>
            }
          </div>

          <div class="aq-barra">
            <label class="aq-campo">
              <span>Cuántas proponer</span>
              <select [ngModel]="cantidad()" (ngModelChange)="cantidad.set($event)">
                @for (n of cantidades; track n) { <option [ngValue]="n">{{ n }}</option> }
              </select>
            </label>
            <button type="button" class="aq-btn aq-btn--primary" (click)="generar()" [disabled]="generando()">
              <span class="material-symbols-outlined" aria-hidden="true">auto_awesome</span>
              {{ generando() ? 'Pensando…' : (propuestas().length ? 'Proponer otras' : 'Proponer preguntas') }}
            </button>
          </div>

          @if (error(); as e) {
            <p class="aq-error" role="alert">
              <span class="material-symbols-outlined" aria-hidden="true">error</span>
              {{ e }}
            </p>
          }

          @if (resumen(); as r) { <p class="aq-resumen">{{ r }}</p> }

          @if (propuestas().length) {
            <div class="aq-lista">
              @for (p of propuestas(); track $index; let i = $index) {
                <div class="aq-item" [class.aq-item--off]="!marcadas()[i]">
                  <input type="checkbox" [checked]="marcadas()[i]" (change)="alternar(i)"
                         [attr.aria-label]="'Incluir ' + p.label" />
                  <span class="aq-item__cuerpo">
                    <span class="aq-item__linea" (click)="alternar(i)">
                      <span class="material-symbols-outlined aq-item__icono" aria-hidden="true">{{ icono(p.type) }}</span>
                      <span class="aq-item__label">{{ p.label }}</span>
                      @if (p.required) { <span class="aq-tag aq-tag--req">obligatorio</span> }
                      <span class="aq-tag">{{ nombreTipo(p.type) }}</span>
                    </span>
                    @if (p.motivo) { <span class="aq-item__motivo">{{ p.motivo }}</span> }
                    @if (p.options?.length) {
                      <span class="aq-item__opciones">{{ opcionesTexto(p) }}</span>
                    }
                    <span class="aq-item__destino">
                      <span class="material-symbols-outlined" aria-hidden="true">subdirectory_arrow_right</span>
                      <select [ngModel]="destinos()[i]" (ngModelChange)="fijarDestino(i, $event)"
                              [attr.aria-label]="'Sección para ' + p.label">
                        @for (s of secciones(); track $index; let k = $index) {
                          <option [ngValue]="k">{{ s || 'Sección ' + (k + 1) }}</option>
                        }
                        <option [ngValue]="-1">Sección nueva: {{ tituloNuevo(p) }}</option>
                      </select>
                    </span>
                  </span>
                </div>
              }
            </div>

            @if (tips().length) {
              <ul class="aq-tips">
                @for (t of tips(); track $index) { <li>{{ t }}</li> }
              </ul>
            }
          } @else if (!generando()) {
            <p class="aq-ayuda">
              Se le manda el nombre, la descripción y las preguntas que ya tiene el
              formulario —nunca las respuestas de nadie— para que proponga solo lo que falta.
            </p>
          }
        </div>

        <div class="aq-pie">
          <button type="button" class="aq-btn aq-btn--claro" (click)="cerrar.emit()">Cancelar</button>
          <button type="button" class="aq-btn aq-btn--primary"
                  [disabled]="totalMarcadas() === 0" (click)="insertarMarcadas()">
            <span class="material-symbols-outlined" aria-hidden="true">playlist_add</span>
            Agregar {{ totalMarcadas() }} {{ totalMarcadas() === 1 ? 'pregunta' : 'preguntas' }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .aq-fondo {
      position: fixed; inset: 0; z-index: 1200;
      display: flex; align-items: center; justify-content: center; padding: 20px;
      background: rgba(15, 23, 42, 0.52);
    }
    .aq-hoja {
      display: flex; flex-direction: column; width: min(720px, 100%);
      max-height: min(86vh, 800px); overflow: hidden;
      background: var(--surface, #fff); border-radius: var(--r-md, 16px);
      box-shadow: var(--shadow-lg, 0 24px 70px rgba(15, 23, 42, 0.28));
    }
    .aq-head { display: flex; align-items: flex-start; gap: 10px; padding: 18px 18px 10px; }
    .aq-head__texto { flex: 1; min-width: 0; }
    .aq-titulo { margin: 0; font-size: 1.1rem; font-weight: 700; color: var(--navy, #21263c); }
    .aq-sub { margin: 3px 0 0; font-size: 0.82rem; color: var(--slate-500, #64748b); }
    .aq-cerrar {
      display: inline-flex; align-items: center; justify-content: center;
      width: 36px; height: 36px; flex: none; border: none; border-radius: 10px;
      background: var(--slate-100, #f1f5f9); color: var(--slate-700, #334155); cursor: pointer;
    }
    .aq-cerrar:hover { background: var(--slate-200, #e8edf3); }

    .aq-cuerpo { flex: 1; min-height: 0; overflow-y: auto; padding: 6px 18px 16px; }

    .aq-textarea {
      width: 100%; padding: 11px; border-radius: 12px; resize: vertical;
      border: 1px solid var(--slate-200, #e8edf3); background: var(--slate-50, #f8fafc);
      font: inherit; font-size: 0.88rem; color: var(--navy, #21263c);
    }
    .aq-textarea:focus { outline: 2px solid var(--lime, #8cd50a); outline-offset: 1px; }

    .aq-chips { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 10px; }
    .aq-chip-btn {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 5px 10px; border-radius: 999px; cursor: pointer;
      border: 1px solid var(--slate-200, #e8edf3); background: var(--surface, #fff);
      font-size: 0.78rem; font-weight: 600; color: var(--slate-700, #334155);
    }
    .aq-chip-btn:hover { border-color: var(--lime, #8cd50a); color: var(--navy, #21263c); }
    .aq-chip-btn .material-symbols-outlined { font-size: 15px; color: var(--lime, #8cd50a); }

    .aq-barra { display: flex; align-items: flex-end; gap: 12px; margin-top: 12px; flex-wrap: wrap; }
    .aq-campo { display: flex; flex-direction: column; gap: 4px; font-size: 0.76rem; color: var(--slate-500, #64748b); }
    .aq-campo select, .aq-item__destino select {
      padding: 7px 9px; border-radius: 9px; font: inherit; font-size: 0.82rem;
      border: 1px solid var(--slate-200, #e8edf3); background: var(--surface, #fff); color: var(--navy, #21263c);
    }
    .aq-barra .aq-btn { margin-left: auto; }

    .aq-resumen {
      margin: 12px 0 0; padding: 9px 12px; border-radius: 10px; font-size: 0.83rem;
      background: var(--slate-50, #f8fafc); color: var(--slate-700, #334155);
    }
    .aq-ayuda { margin: 14px 0 0; font-size: 0.82rem; color: var(--slate-500, #64748b); }

    .aq-lista { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
    .aq-item {
      display: flex; gap: 10px; align-items: flex-start;
      padding: 11px 12px; border-radius: 12px;
      border: 1px solid var(--slate-200, #e8edf3); background: var(--surface, #fff);
    }
    .aq-item--off { opacity: 0.55; }
    .aq-item input[type="checkbox"] { margin-top: 3px; accent-color: var(--lime, #8cd50a); }
    .aq-item__cuerpo { display: flex; flex-direction: column; gap: 5px; min-width: 0; flex: 1; }
    .aq-item__linea { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; cursor: pointer; }
    .aq-item__icono { font-size: 18px; color: var(--slate-400, #94a3b8); }
    .aq-item__label { font-size: 0.9rem; font-weight: 600; color: var(--navy, #21263c); }
    .aq-item__motivo { font-size: 0.79rem; color: var(--slate-500, #64748b); }
    .aq-item__opciones { font-size: 0.76rem; color: var(--slate-400, #94a3b8); }
    .aq-item__destino { display: inline-flex; align-items: center; gap: 6px; }
    .aq-item__destino .material-symbols-outlined { font-size: 16px; color: var(--slate-400, #94a3b8); }
    .aq-tag {
      padding: 1px 8px; border-radius: 999px; font-size: 0.69rem;
      background: var(--slate-100, #f1f5f9); color: var(--slate-500, #64748b);
    }
    .aq-tag--req { background: #fef3c7; color: #92400e; }
    .aq-tips { margin: 12px 0 0; padding-left: 18px; font-size: 0.79rem; color: var(--slate-500, #64748b); }

    .aq-error {
      display: flex; align-items: center; gap: 8px; margin: 12px 0 0;
      padding: 10px 12px; border-radius: 10px; font-size: 0.83rem;
      background: #fef2f2; color: #b91c1c;
    }
    .aq-error .material-symbols-outlined { font-size: 18px; }

    .aq-pie {
      display: flex; gap: 8px; justify-content: flex-end;
      padding: 12px 18px; border-top: 1px solid var(--slate-200, #e8edf3);
    }
    .aq-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 14px; border-radius: 10px; border: none; cursor: pointer;
      font-size: 0.85rem; font-weight: 600;
    }
    .aq-btn .material-symbols-outlined { font-size: 18px; }
    .aq-btn--claro { background: var(--slate-100, #f1f5f9); color: var(--slate-700, #334155); }
    .aq-btn--claro:hover { background: var(--slate-200, #e8edf3); }
    .aq-btn--primary { background: var(--navy, #21263c); color: #fff; }
    .aq-btn--primary:hover { background: #2d3450; }
    .aq-btn:disabled { opacity: 0.55; cursor: default; }

    @media (max-width: 640px) {
      .aq-fondo { padding: 0; }
      .aq-hoja { width: 100%; height: 100%; max-height: 100%; border-radius: 0; }
    }
  `],
})
export class AiQuestionsDialogComponent {
  private ai = inject(FormAiService);
  private destroyRef = inject(DestroyRef);

  contexto = input.required<ContextoFormulario>();
  tipos = input<FieldTypeInfo[]>([]);
  /** Sección abierta en el constructor: destino por defecto si la IA no dice cuál. */
  seccionActiva = input<number>(0);

  cerrar = output<void>();
  insertar = output<PropuestaAceptada[]>();

  readonly prompts = PROMPTS_PREGUNTAS;
  readonly cantidades = [3, 4, 6, 8, 10, 12];

  instruccion = signal('');
  cantidad = signal(6);
  generando = signal(false);
  error = signal<string | null>(null);
  resumen = signal<string | null>(null);
  tips = signal<string[]>([]);

  propuestas = signal<PreguntaIa[]>([]);
  marcadas = signal<boolean[]>([]);
  destinos = signal<number[]>([]);

  readonly secciones = computed(() => this.contexto().secciones);
  readonly totalMarcadas = computed(() => this.marcadas().filter(Boolean).length);

  private readonly porCodigo = computed(() => {
    const mapa = new Map<string, FieldTypeInfo>();
    for (const t of this.tipos()) mapa.set(t.code, t);
    return mapa;
  });

  nombreTipo(code: FieldType): string {
    return this.porCodigo().get(code)?.name ?? code;
  }

  icono(code: FieldType): string {
    return this.porCodigo().get(code)?.icon || 'help';
  }

  opcionesTexto(p: PreguntaIa): string {
    const labels = (p.options ?? []).map(o => (typeof o === 'string' ? o : o.label));
    return labels.length ? `Opciones: ${labels.join(' · ')}` : '';
  }

  /** Título de la sección nueva que propone la IA para esta pregunta. */
  tituloNuevo(p: PreguntaIa): string {
    return p.seccion?.trim() || 'Preguntas sugeridas';
  }

  alternar(i: number): void {
    this.marcadas.update(m => m.map((v, k) => (k === i ? !v : v)));
  }

  fijarDestino(i: number, valor: number): void {
    this.destinos.update(d => d.map((v, k) => (k === i ? valor : v)));
  }

  generar(): void {
    const ctx = this.contexto();
    this.error.set(null);
    this.generando.set(true);
    this.ai.preguntas({
      instruccion: this.instruccion().trim(),
      nombre: ctx.nombre,
      descripcion: ctx.descripcion,
      categoria: ctx.categoria,
      secciones: ctx.secciones,
      contenido: ctx.contenido,
      tipos: this.tipos().map(t => t.code),
      cantidad: this.cantidad(),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: r => {
          this.generando.set(false);
          this.propuestas.set(r.preguntas);
          this.marcadas.set(r.preguntas.map(() => true));
          this.destinos.set(r.preguntas.map(p => this.destinoSugerido(p)));
          this.resumen.set(r.resumen || null);
          this.tips.set(r.tips ?? []);
          if (!r.preguntas.length) {
            this.error.set('La IA no propuso preguntas nuevas. Prueba a decirle qué te falta.');
          }
        },
        error: (err: unknown) => {
          this.generando.set(false);
          this.error.set(this.mensaje(err, 'No se pudieron proponer preguntas. Intenta de nuevo.'));
        },
      });
  }

  insertarMarcadas(): void {
    const propuestas = this.propuestas();
    const marcadas = this.marcadas();
    const destinos = this.destinos();
    const aceptadas: PropuestaAceptada[] = [];
    for (let i = 0; i < propuestas.length; i++) {
      if (!marcadas[i]) continue;
      const p = propuestas[i];
      const { seccion, motivo, ...campo } = p;
      aceptadas.push({
        campo,
        seccionIndex: destinos[i],
        ...(destinos[i] === -1 ? { nuevaSeccion: this.tituloNuevo(p) } : {}),
      });
    }
    if (aceptadas.length) this.insertar.emit(aceptadas);
  }

  /**
   * Sección destino sugerida: la que la IA nombró, buscada por título sin acentos ni
   * mayúsculas. Si no nombró ninguna se usa la sección abierta en el constructor; si
   * nombró una que no existe, se propone crearla (-1).
   */
  private destinoSugerido(p: PreguntaIa): number {
    const pedida = this.normalizar(p.seccion ?? '');
    if (!pedida) return Math.max(0, Math.min(this.seccionActiva(), this.secciones().length - 1));
    const idx = this.secciones().findIndex(s => this.normalizar(s) === pedida);
    return idx >= 0 ? idx : -1;
  }

  private normalizar(s: string): string {
    return (s ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim()
      .toLowerCase();
  }

  private mensaje(err: unknown, porDefecto: string): string {
    if (err instanceof HttpErrorResponse) {
      const detalle = (err.error as { error?: string } | null)?.error;
      if (detalle) return detalle;
      if (err.status === 429) return 'Demasiadas peticiones a la IA; espera unos segundos.';
    }
    return porDefecto;
  }
}
