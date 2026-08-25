import {
  ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { FieldTypeInfo, FieldType } from '../../models/dynamic-forms.models';
import { ContextoFormulario, SeccionBorrador } from '../../models/form-drafts';
import {
  PLANTILLAS_FORMULARIO, PROMPTS_BORRADOR, PlantillaFormulario,
} from '../../models/form-templates';
import { BorradorIa, FormAiService } from '../../services/form-ai.service';

/** Punto de partida elegido en la portada del constructor. */
export interface InicioElegido {
  /** 'excel' no trae contenido: pide abrir el diálogo de carga por Excel. */
  origen: 'blanco' | 'plantilla' | 'ia' | 'excel';
  nombre?: string;
  descripcion?: string;
  categoria?: string;
  /** Solo plantilla: preset de tema e icono con los que se ve bien. */
  preset?: string;
  icono?: string;
  secciones?: SeccionBorrador[];
}

type Pestana = 'plantillas' | 'ia' | 'excel' | 'blanco';

/**
 * CÓMO EMPEZAR un formulario nuevo.
 *
 * Antes el constructor abría con una sección vacía y una paleta de 17 tipos: quien no
 * arma formularios a diario se quedaba mirando la pantalla. Aquí se elige el punto de
 * partida —una plantilla revisada, un borrador que propone la IA a partir de una idea
 * escrita, o el lienzo en blanco de siempre— y a partir de ahí todo es el mismo
 * constructor de siempre: lo que entra es un BORRADOR editable, no algo cerrado.
 *
 * No guarda nada: emite lo elegido y se cierra. La única llamada que hace es la de la
 * IA (texto, sin costo de imagen).
 */
@Component({
  selector: 'app-form-start',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fs-fondo">
      <div class="fs-hoja" role="dialog" aria-modal="true" aria-labelledby="fs-titulo">

        <div class="fs-head">
          <div class="fs-head__texto">
            <h2 class="fs-titulo" id="fs-titulo">
              {{ edicion() ? 'Plantillas y borrador con IA' : '¿Cómo quieres empezar?' }}
            </h2>
            <p class="fs-sub">
              @if (edicion()) {
                Lo que elijas se agrega al final o reemplaza lo actual; te preguntamos antes.
              } @else {
                Elige un punto de partida. Todo se puede editar después.
              }
            </p>
          </div>
          <button type="button" class="fs-cerrar" (click)="enBlanco()" aria-label="Cerrar">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>

        <div class="fs-tabs" role="tablist">
          <button type="button" role="tab" class="fs-tab" [class.fs-tab--activa]="pestana() === 'plantillas'"
                  [attr.aria-selected]="pestana() === 'plantillas'" (click)="pestana.set('plantillas')">
            <span class="material-symbols-outlined" aria-hidden="true">grid_view</span>
            Plantillas
          </button>
          <button type="button" role="tab" class="fs-tab" [class.fs-tab--activa]="pestana() === 'ia'"
                  [attr.aria-selected]="pestana() === 'ia'" (click)="pestana.set('ia')">
            <span class="material-symbols-outlined" aria-hidden="true">auto_awesome</span>
            Diseñar con IA
          </button>
          <button type="button" role="tab" class="fs-tab" [class.fs-tab--activa]="pestana() === 'excel'"
                  [attr.aria-selected]="pestana() === 'excel'" (click)="pestana.set('excel')">
            <span class="material-symbols-outlined" aria-hidden="true">table_view</span>
            Desde Excel
          </button>
          @if (!edicion()) {
            <button type="button" role="tab" class="fs-tab" [class.fs-tab--activa]="pestana() === 'blanco'"
                    [attr.aria-selected]="pestana() === 'blanco'" (click)="pestana.set('blanco')">
              <span class="material-symbols-outlined" aria-hidden="true">draft</span>
              En blanco
            </button>
          }
        </div>

        <div class="fs-cuerpo">

          <!-- ── Plantillas ─────────────────────────────────────────── -->
          @if (pestana() === 'plantillas') {
            <label class="fs-buscar">
              <span class="material-symbols-outlined" aria-hidden="true">search</span>
              <input type="text" placeholder="Buscar plantilla…" aria-label="Buscar plantilla"
                     [ngModel]="filtro()" (ngModelChange)="filtro.set($event)" />
            </label>

            <div class="fs-grid">
              @for (p of plantillasVisibles(); track p.id) {
                <article class="fs-card" [class.fs-card--abierta]="detalle() === p.id">
                  <button type="button" class="fs-card__head" (click)="alternarDetalle(p.id)"
                          [attr.aria-expanded]="detalle() === p.id">
                    <span class="material-symbols-outlined fs-card__icono" aria-hidden="true">{{ p.icono }}</span>
                    <span class="fs-card__texto">
                      <span class="fs-card__nombre">{{ p.nombre }}</span>
                      <span class="fs-card__desc">{{ p.descripcion }}</span>
                      <span class="fs-card__meta">{{ resumenPlantilla(p) }}</span>
                    </span>
                  </button>

                  @if (detalle() === p.id) {
                    <div class="fs-card__detalle">
                      @for (s of p.secciones; track $index) {
                        <div class="fs-seccion">
                          <p class="fs-seccion__titulo">{{ s.titulo }}</p>
                          <ul class="fs-preguntas">
                            @for (c of s.campos; track $index) {
                              <li>
                                <span class="material-symbols-outlined" aria-hidden="true">{{ icono(c.type) }}</span>
                                <span class="fs-pregunta__label">{{ c.label }}</span>
                                @if (c.required) { <span class="fs-chip fs-chip--req">obligatorio</span> }
                                <span class="fs-chip">{{ nombreTipo(c.type) }}</span>
                              </li>
                            }
                          </ul>
                        </div>
                      }
                    </div>
                  }

                  <div class="fs-card__pie">
                    <button type="button" class="fs-btn fs-btn--claro" (click)="alternarDetalle(p.id)">
                      {{ detalle() === p.id ? 'Ocultar preguntas' : 'Ver preguntas' }}
                    </button>
                    <button type="button" class="fs-btn fs-btn--primary" (click)="usarPlantilla(p)">
                      <span class="material-symbols-outlined" aria-hidden="true">bolt</span>
                      Usar plantilla
                    </button>
                  </div>
                </article>
              } @empty {
                <p class="fs-vacio">Ninguna plantilla coincide con «{{ filtro() }}».</p>
              }
            </div>
          }

          <!-- ── Diseñar con IA ─────────────────────────────────────── -->
          @if (pestana() === 'ia') {
            @if (borrador(); as b) {
              <!-- Propuesta lista: se revisa antes de cargarla al constructor -->
              <div class="fs-ia__resultado">
                <div class="fs-ia__cabecera">
                  <div>
                    <p class="fs-ia__nombre">{{ b.nombre || 'Formulario sin nombre' }}</p>
                    @if (b.descripcion) { <p class="fs-ia__desc">{{ b.descripcion }}</p> }
                    <p class="fs-card__meta">{{ resumenBorrador(b) }}</p>
                  </div>
                  <button type="button" class="fs-btn fs-btn--claro" (click)="borrador.set(null)">
                    <span class="material-symbols-outlined" aria-hidden="true">edit</span>
                    Cambiar la idea
                  </button>
                </div>

                @if (b.resumen) { <p class="fs-ia__resumen">{{ b.resumen }}</p> }

                @for (s of b.secciones; track $index) {
                  <div class="fs-seccion">
                    <p class="fs-seccion__titulo">{{ s.titulo }}</p>
                    <ul class="fs-preguntas">
                      @for (c of s.campos; track $index) {
                        <li>
                          <span class="material-symbols-outlined" aria-hidden="true">{{ icono(c.type) }}</span>
                          <span class="fs-pregunta__label">{{ c.label }}</span>
                          @if (c.required) { <span class="fs-chip fs-chip--req">obligatorio</span> }
                          <span class="fs-chip">{{ nombreTipo(c.type) }}</span>
                        </li>
                      }
                    </ul>
                  </div>
                }

                @if (b.tips.length) {
                  <ul class="fs-tips">
                    @for (t of b.tips; track $index) { <li>{{ t }}</li> }
                  </ul>
                }

                <div class="fs-ia__acciones">
                  <button type="button" class="fs-btn fs-btn--claro" (click)="generar()" [disabled]="generando()">
                    <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
                    Proponer otro
                  </button>
                  <button type="button" class="fs-btn fs-btn--primary" (click)="usarBorrador(b)">
                    <span class="material-symbols-outlined" aria-hidden="true">check</span>
                    Usar este borrador
                  </button>
                </div>
              </div>
            } @else {
              <p class="fs-ayuda">
                Cuenta qué necesitas preguntar y para qué. La IA propone las secciones y las
                preguntas con su tipo; tú las revisas antes de que entren al constructor.
              </p>
              @if (edicion()) {
                <p class="fs-ayuda fs-ayuda--nota">
                  Como el formulario ya tiene preguntas, se le manda lo que hay para que
                  proponga lo que <b>falta</b> en vez de repetirlo.
                </p>
              }

              <textarea class="fs-textarea" rows="5" maxlength="1200"
                        [ngModel]="idea()" (ngModelChange)="idea.set($event)"
                        aria-label="Qué quieres preguntar"
                        placeholder="Ej. Registro de visitas a fincas: datos del predio, cultivo, estado sanitario, fotos y compromisos con fecha de seguimiento"></textarea>

              <p class="fs-ayuda fs-ayuda--chips">O parte de una de estas ideas:</p>
              <div class="fs-chips">
                @for (p of promptsSugeridos; track p.titulo) {
                  <button type="button" class="fs-chip-btn" (click)="idea.set(p.prompt)">
                    <span class="material-symbols-outlined" aria-hidden="true">bolt</span>
                    {{ p.titulo }}
                  </button>
                }
              </div>

              <div class="fs-ia__barra">
                <label class="fs-campo">
                  <span>Basarse en una plantilla (opcional)</span>
                  <select [ngModel]="base()" (ngModelChange)="base.set($event)">
                    <option value="">Sin plantilla</option>
                    @for (p of plantillas; track p.id) {
                      <option [value]="p.nombre">{{ p.nombre }}</option>
                    }
                  </select>
                </label>
                <button type="button" class="fs-btn fs-btn--primary fs-btn--generar"
                        (click)="generar()" [disabled]="generando()">
                  <span class="material-symbols-outlined" aria-hidden="true">auto_awesome</span>
                  {{ generando() ? 'Armando el borrador…' : 'Generar borrador' }}
                </button>
              </div>

              @if (error(); as e) {
                <p class="fs-error" role="alert">
                  <span class="material-symbols-outlined" aria-hidden="true">error</span>
                  {{ e }}
                </p>
              }
            }
          }

          <!-- ── Desde Excel ────────────────────────────────────────── -->
          @if (pestana() === 'excel') {
            <div class="fs-blanco">
              <span class="material-symbols-outlined fs-blanco__icono" aria-hidden="true">table_view</span>
              <p class="fs-ayuda">
                Descarga una plantilla de Excel ya parametrizada —a quién se le presta, en qué
                módulo queda, visibilidad y recorrido—, llénala con las preguntas y súbela: el
                formulario aparece aquí mismo con todo cargado, listo para revisar.
              </p>
              <p class="fs-ayuda fs-ayuda--nota">
                La plantilla explica cada tipo de dato y trae un ejemplo de pregunta de cada uno.
                Sirve para un formulario o para varios de una sola carga.
              </p>
              <button type="button" class="fs-btn fs-btn--primary" (click)="desdeExcel()">
                <span class="material-symbols-outlined" aria-hidden="true">upload_file</span>
                Abrir la carga por Excel
              </button>
            </div>
          }

          <!-- ── En blanco ──────────────────────────────────────────── -->
          @if (pestana() === 'blanco') {
            <div class="fs-blanco">
              <span class="material-symbols-outlined fs-blanco__icono" aria-hidden="true">draft</span>
              <p class="fs-ayuda">
                Una sección vacía y la paleta de tipos de campo. Siempre puedes pedirle
                preguntas a la IA más adelante, desde el botón «Asistente IA».
              </p>
              <button type="button" class="fs-btn fs-btn--primary" (click)="enBlanco()">
                <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
                Empezar en blanco
              </button>
            </div>
          }

        </div>
      </div>
    </div>
  `,
  styles: [`
    .fs-fondo {
      position: fixed;
      inset: 0;
      z-index: 1200;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: rgba(15, 23, 42, 0.52);
    }
    .fs-hoja {
      display: flex;
      flex-direction: column;
      width: min(880px, 100%);
      max-height: min(86vh, 820px);
      background: var(--surface, #fff);
      border-radius: var(--r-md, 16px);
      box-shadow: var(--shadow-lg, 0 24px 70px rgba(15, 23, 42, 0.28));
      overflow: hidden;
    }
    .fs-head { display: flex; align-items: flex-start; gap: 10px; padding: 18px 18px 12px; }
    .fs-head__texto { flex: 1; min-width: 0; }
    .fs-titulo { margin: 0; font-size: 1.15rem; font-weight: 700; color: var(--navy, #21263c); }
    .fs-sub { margin: 3px 0 0; font-size: 0.82rem; color: var(--slate-500, #64748b); }
    .fs-cerrar {
      display: inline-flex; align-items: center; justify-content: center;
      width: 36px; height: 36px; flex: none; border: none; border-radius: 10px;
      background: var(--slate-100, #f1f5f9); color: var(--slate-700, #334155); cursor: pointer;
    }
    .fs-cerrar:hover { background: var(--slate-200, #e8edf3); }

    .fs-tabs { display: flex; gap: 6px; padding: 0 18px; border-bottom: 1px solid var(--slate-200, #e8edf3); }
    .fs-tab {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 10px 12px; border: none; background: none; cursor: pointer;
      font-size: 0.86rem; font-weight: 600; color: var(--slate-500, #64748b);
      border-bottom: 2px solid transparent;
    }
    .fs-tab:hover { color: var(--navy, #21263c); }
    .fs-tab--activa { color: var(--navy, #21263c); border-bottom-color: var(--lime, #8cd50a); }
    .fs-tab .material-symbols-outlined { font-size: 18px; }

    .fs-cuerpo { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 18px 20px; }

    .fs-buscar {
      display: flex; align-items: center; gap: 8px; margin-bottom: 12px;
      padding: 8px 12px; border: 1px solid var(--slate-200, #e8edf3); border-radius: 10px;
      background: var(--slate-50, #f8fafc); color: var(--slate-500, #64748b);
    }
    .fs-buscar input { flex: 1; border: none; background: none; outline: none; font-size: 0.9rem; color: var(--navy, #21263c); }

    .fs-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); }
    .fs-card {
      display: flex; flex-direction: column;
      border: 1px solid var(--slate-200, #e8edf3); border-radius: 14px;
      background: var(--surface, #fff); overflow: hidden;
    }
    .fs-card--abierta { border-color: var(--lime, #8cd50a); }
    .fs-card__head {
      display: flex; gap: 12px; align-items: flex-start; text-align: left;
      padding: 14px; border: none; background: none; cursor: pointer; width: 100%;
    }
    .fs-card__icono {
      display: inline-flex; align-items: center; justify-content: center;
      width: 40px; height: 40px; flex: none; border-radius: 11px;
      background: var(--slate-100, #f1f5f9); color: var(--navy, #21263c);
    }
    .fs-card__texto { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .fs-card__nombre { font-size: 0.95rem; font-weight: 700; color: var(--navy, #21263c); }
    .fs-card__desc { font-size: 0.8rem; color: var(--slate-500, #64748b); }
    .fs-card__meta { font-size: 0.74rem; color: var(--slate-400, #94a3b8); }
    .fs-card__detalle { padding: 0 14px 6px; }
    .fs-card__pie { display: flex; gap: 8px; justify-content: flex-end; padding: 10px 14px 14px; }

    .fs-seccion { margin-bottom: 12px; }
    .fs-seccion__titulo {
      margin: 0 0 6px; font-size: 0.78rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.03em; color: var(--slate-500, #64748b);
    }
    .fs-preguntas { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
    .fs-preguntas li {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      font-size: 0.85rem; color: var(--navy, #21263c);
    }
    .fs-preguntas .material-symbols-outlined { font-size: 18px; color: var(--slate-400, #94a3b8); }
    .fs-pregunta__label { flex: 1; min-width: 140px; }
    .fs-chip {
      padding: 1px 8px; border-radius: 999px; font-size: 0.7rem;
      background: var(--slate-100, #f1f5f9); color: var(--slate-500, #64748b);
    }
    .fs-chip--req { background: #fef3c7; color: #92400e; }

    .fs-ayuda { margin: 0 0 10px; font-size: 0.84rem; color: var(--slate-500, #64748b); }
    .fs-ayuda--chips { margin-top: 12px; }
    .fs-ayuda--nota {
      padding: 8px 11px; border-radius: 10px;
      background: var(--slate-50, #f8fafc); color: var(--slate-700, #334155);
    }
    .fs-textarea {
      width: 100%; padding: 12px; border-radius: 12px; resize: vertical;
      border: 1px solid var(--slate-200, #e8edf3); background: var(--slate-50, #f8fafc);
      font: inherit; font-size: 0.9rem; color: var(--navy, #21263c);
    }
    .fs-textarea:focus { outline: 2px solid var(--lime, #8cd50a); outline-offset: 1px; }

    .fs-chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .fs-chip-btn {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 6px 11px; border-radius: 999px; cursor: pointer;
      border: 1px solid var(--slate-200, #e8edf3); background: var(--surface, #fff);
      font-size: 0.8rem; font-weight: 600; color: var(--slate-700, #334155);
    }
    .fs-chip-btn:hover { border-color: var(--lime, #8cd50a); color: var(--navy, #21263c); }
    .fs-chip-btn .material-symbols-outlined { font-size: 16px; color: var(--lime, #8cd50a); }

    .fs-ia__barra {
      display: flex; align-items: flex-end; justify-content: space-between;
      gap: 12px; flex-wrap: wrap; margin-top: 14px;
    }
    .fs-campo { display: flex; flex-direction: column; gap: 4px; font-size: 0.78rem; color: var(--slate-500, #64748b); }
    .fs-campo select {
      padding: 8px 10px; border-radius: 10px; font: inherit; font-size: 0.85rem;
      border: 1px solid var(--slate-200, #e8edf3); background: var(--surface, #fff); color: var(--navy, #21263c);
    }
    .fs-btn--generar { margin-left: auto; }

    .fs-ia__resultado { display: flex; flex-direction: column; gap: 12px; }
    .fs-ia__cabecera { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .fs-ia__nombre { margin: 0; font-size: 1rem; font-weight: 700; color: var(--navy, #21263c); }
    .fs-ia__desc { margin: 2px 0 0; font-size: 0.84rem; color: var(--slate-500, #64748b); }
    .fs-ia__resumen {
      margin: 0; padding: 10px 12px; border-radius: 10px; font-size: 0.84rem;
      background: var(--slate-50, #f8fafc); color: var(--slate-700, #334155);
    }
    .fs-ia__acciones { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
    .fs-tips { margin: 0; padding-left: 18px; font-size: 0.8rem; color: var(--slate-500, #64748b); }

    .fs-blanco { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; padding: 26px 10px; }
    .fs-blanco__icono { font-size: 44px; color: var(--slate-300, #cbd5e1); }

    .fs-vacio { font-size: 0.86rem; color: var(--slate-500, #64748b); }
    .fs-error {
      display: flex; align-items: center; gap: 8px; margin: 12px 0 0;
      padding: 10px 12px; border-radius: 10px; font-size: 0.84rem;
      background: #fef2f2; color: #b91c1c;
    }
    .fs-error .material-symbols-outlined { font-size: 18px; }

    .fs-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 14px; border-radius: 10px; border: none; cursor: pointer;
      font-size: 0.85rem; font-weight: 600;
    }
    .fs-btn .material-symbols-outlined { font-size: 18px; }
    .fs-btn--claro { background: var(--slate-100, #f1f5f9); color: var(--slate-700, #334155); }
    .fs-btn--claro:hover { background: var(--slate-200, #e8edf3); }
    .fs-btn--primary { background: var(--navy, #21263c); color: #fff; }
    .fs-btn--primary:hover { background: #2d3450; }
    .fs-btn:disabled { opacity: 0.6; cursor: default; }

    @media (max-width: 640px) {
      .fs-fondo { padding: 0; }
      .fs-hoja { width: 100%; height: 100%; max-height: 100%; border-radius: 0; }
      .fs-grid { grid-template-columns: 1fr; }
    }
  `],
})
export class FormStartComponent {
  private ai = inject(FormAiService);
  private destroyRef = inject(DestroyRef);

  /** Catálogo real de tipos (ms-forms): nombres, iconos y lo que la IA puede usar. */
  tipos = input<FieldTypeInfo[]>([]);
  /** Abierta sobre un formulario que ya tiene contenido: cambia el discurso, no la mecánica. */
  edicion = input(false);
  /** Lo que el formulario ya pregunta: la IA lo recibe para complementar, no repetir. */
  contexto = input<ContextoFormulario | null>(null);

  elegir = output<InicioElegido>();

  readonly plantillas = PLANTILLAS_FORMULARIO;
  readonly promptsSugeridos = PROMPTS_BORRADOR;

  pestana = signal<Pestana>('plantillas');
  filtro = signal('');
  detalle = signal<string | null>(null);

  idea = signal('');
  base = signal('');
  generando = signal(false);
  borrador = signal<BorradorIa | null>(null);
  error = signal<string | null>(null);

  readonly plantillasVisibles = computed(() => {
    const q = this.filtro().trim().toLowerCase();
    if (!q) return this.plantillas;
    return this.plantillas.filter(p =>
      `${p.nombre} ${p.descripcion} ${p.categoria} ${p.etiquetas.join(' ')}`.toLowerCase().includes(q));
  });

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

  alternarDetalle(id: string): void {
    this.detalle.set(this.detalle() === id ? null : id);
  }

  resumenPlantilla(p: PlantillaFormulario): string {
    const preguntas = p.secciones.reduce((a, s) => a + s.campos.length, 0);
    return `${p.categoria} · ${p.secciones.length} secciones · ${preguntas} preguntas`;
  }

  resumenBorrador(b: BorradorIa): string {
    const preguntas = b.secciones.reduce((a, s) => a + s.campos.length, 0);
    const cat = b.categoria ? `${b.categoria} · ` : '';
    return `${cat}${b.secciones.length} secciones · ${preguntas} preguntas`;
  }

  enBlanco(): void {
    this.elegir.emit({ origen: 'blanco' });
  }

  /**
   * La carga por Excel no produce contenido aquí: pide al constructor que abra su propio
   * diálogo (que sí conoce roles, módulos y el API de importación). Esta portada solo
   * elige el punto de partida.
   */
  desdeExcel(): void {
    this.elegir.emit({ origen: 'excel' });
  }

  usarPlantilla(p: PlantillaFormulario): void {
    this.elegir.emit({
      origen: 'plantilla',
      nombre: p.nombre,
      descripcion: p.descripcion,
      categoria: p.categoria,
      preset: p.preset,
      icono: p.icono,
      // Copia: la plantilla es una constante del bundle, el constructor la va a mutar.
      secciones: structuredClone(p.secciones),
    });
  }

  usarBorrador(b: BorradorIa): void {
    this.elegir.emit({
      origen: 'ia',
      nombre: b.nombre,
      descripcion: b.descripcion,
      categoria: b.categoria,
      secciones: b.secciones,
    });
  }

  generar(): void {
    const objetivo = this.idea().trim();
    const base = this.base().trim();
    if (!objetivo && !base) {
      this.error.set('Escribe qué quieres preguntar, o elige una plantilla de la que partir.');
      return;
    }
    this.error.set(null);
    this.generando.set(true);
    const ctx = this.contexto();
    this.ai.borrador({
      objetivo,
      base,
      nombre: ctx?.nombre ?? '',
      categoria: ctx?.categoria ?? '',
      contenido: ctx?.contenido ?? [],
      tipos: this.tipos().map(t => t.code),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: b => {
          this.generando.set(false);
          if (!b.secciones.length) {
            this.error.set('La IA no propuso preguntas; describe con un poco más de detalle qué necesitas.');
            return;
          }
          this.borrador.set(b);
        },
        error: (err: unknown) => {
          this.generando.set(false);
          this.error.set(this.mensaje(err, 'No se pudo armar el borrador. Intenta de nuevo.'));
        },
      });
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
