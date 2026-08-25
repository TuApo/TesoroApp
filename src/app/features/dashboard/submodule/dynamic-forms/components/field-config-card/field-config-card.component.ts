import {
  ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  DynamicField, FieldOption, FieldRoutingRule, FieldSchema, FieldType, FieldTypeInfo,
  FieldValidation, RatingConfig,
} from '../../models/dynamic-forms.models';
import { OptionSource } from '../../models/option-source.models';
import { OptionSourceService } from '../../services/option-source.service';

/**
 * Crea un DynamicField nuevo a partir de un tipo del catálogo, clonando su
 * default_config y garantizando los mínimos por tipo (1 opción en choices,
 * rating_config en RATING, texto vacío en COMMENT, children en SECTION).
 * Lo usan la página del builder (paleta) y la propia tarjeta (hijos de SECTION).
 */
export function crearCampoDesdeTipo(t: FieldTypeInfo): DynamicField {
  const schema: FieldSchema = t.default_config ? structuredClone(t.default_config) : {};
  if ((t.code === 'SINGLE_CHOICE' || t.code === 'DROPDOWN' || t.code === 'MULTIPLE_CHOICE')
      && !(schema.options?.length)) {
    schema.options = [{ value: 'opt_1', label: 'Opción 1' }];
  }
  if (t.code === 'RATING' && !schema.rating_config) {
    schema.rating_config = { scale_max: 5, mode: 'STARS', show_labels: false };
  }
  if (t.code === 'COMMENT' && schema.text == null) {
    schema.text = '';
  }
  const campo: DynamicField = { label: t.name, type: t.code, order_no: 0, required: false, schema };
  if (t.code === 'SECTION') campo.children = [];
  return campo;
}

/**
 * Clona un campo para DUPLICARLO: quita id y name (el backend los regenera desde
 * el label; conservarlos chocaría con el original) y sufija " (copia)" al label.
 */
export function clonarCampoParaDuplicar(f: DynamicField): DynamicField {
  const copia: DynamicField = structuredClone(f);
  delete copia.id;
  delete copia.name;
  copia.label = `${copia.label} (copia)`;
  if (copia.children) {
    copia.children = copia.children.map(c => {
      const hijo: DynamicField = { ...c };
      delete hijo.id;
      delete hijo.name;
      return hijo;
    });
  }
  return copia;
}

/**
 * Tarjeta de configuración de UN campo del builder.
 *
 * INMUTABLE: nunca muta el @Input field; toda edición emite (fieldChange) con un
 * objeto nuevo para que la página (signals + OnPush) repinte.
 *
 * SECTION se configura de forma recursiva: sus children son sub-tarjetas
 * [nested]=true SIN drag anidado (botones subir/bajar y "sacar de la sección",
 * que burbujea hasta la página vía extractChild).
 *
 * visible_if NO se expone: está reservado hasta que exista evaluador.
 */
@Component({
  selector: 'app-field-config-card',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fc-card" [class.fc-card--nested]="nested">
      <!-- Cabecera: icono + label inline + requerido + acciones -->
      <div class="fc-head">
        <span class="material-symbols-outlined fc-icon" aria-hidden="true" [title]="tipoNombre">{{ icono }}</span>
        <div class="fc-head__main">
          <input class="fc-label" type="text"
                 [id]="uid + '-label'"
                 [ngModel]="field.label"
                 (ngModelChange)="cambiar({ label: $event })"
                 placeholder="Etiqueta del campo"
                 [attr.aria-label]="'Etiqueta del campo de tipo ' + tipoNombre" />
          <span class="fc-tipo">{{ tipoNombre }}</span>
        </div>

        @if (permiteRequerido) {
          <label class="fc-req" [title]="'Marcar como obligatorio'">
            <input type="checkbox"
                   [ngModel]="field.required"
                   (ngModelChange)="cambiar({ required: $event })" />
            <span>Obligatorio</span>
          </label>
        }

        @if (nested) {
          <button type="button" class="fc-btn" [disabled]="!canUp"
                  (click)="moveUp.emit()" title="Subir" aria-label="Subir campo">
            <span class="material-symbols-outlined">arrow_upward</span>
          </button>
          <button type="button" class="fc-btn" [disabled]="!canDown"
                  (click)="moveDown.emit()" title="Bajar" aria-label="Bajar campo">
            <span class="material-symbols-outlined">arrow_downward</span>
          </button>
          <button type="button" class="fc-btn"
                  (click)="extract.emit()" title="Sacar de la sección" aria-label="Sacar el campo de la sección">
            <span class="material-symbols-outlined">move_item</span>
          </button>
        }

        <button type="button" class="fc-btn" (click)="duplicateField.emit()"
                title="Duplicar campo" aria-label="Duplicar campo">
          <span class="material-symbols-outlined">content_copy</span>
        </button>
        <button type="button" class="fc-btn fc-btn--danger" (click)="removeField.emit()"
                title="Eliminar campo" aria-label="Eliminar campo">
          <span class="material-symbols-outlined">delete</span>
        </button>
        <button type="button" class="fc-btn" (click)="expandido.set(!expandido())"
                [attr.aria-expanded]="expandido()"
                [title]="expandido() ? 'Contraer configuración' : 'Expandir configuración'"
                [attr.aria-label]="expandido() ? 'Contraer configuración' : 'Expandir configuración'">
          <span class="material-symbols-outlined">{{ expandido() ? 'expand_less' : 'expand_more' }}</span>
        </button>
      </div>

      <!-- Cuerpo expandible: configuración POR TIPO -->
      @if (expandido()) {
        <div class="fc-body">

          @if (muestraPlaceholder) {
            <div class="fc-fila">
              <label [attr.for]="uid + '-ph'">Placeholder</label>
              <input type="text" [id]="uid + '-ph'"
                     [ngModel]="field.schema.placeholder ?? ''"
                     (ngModelChange)="cambiarSchema({ placeholder: textoONada($event) })"
                     placeholder="Texto guía dentro del control" />
            </div>
          }

          @if (muestraDescripcion) {
            <div class="fc-fila">
              <label [attr.for]="uid + '-desc'">Descripción / ayuda</label>
              <input type="text" [id]="uid + '-desc'"
                     [ngModel]="field.schema.description ?? ''"
                     (ngModelChange)="cambiarSchema({ description: textoONada($event) })"
                     placeholder="Se muestra bajo la etiqueta" />
            </div>
          }

          <!-- TEXT: longitudes -->
          @if (esTexto) {
            <div class="fc-fila fc-fila--doble">
              <div>
                <label [attr.for]="uid + '-minl'">Longitud mínima</label>
                <input type="number" min="0" [id]="uid + '-minl'"
                       [ngModel]="val.min_length ?? null"
                       (ngModelChange)="cambiarValidacionNum('min_length', $event)" />
              </div>
              <div>
                <label [attr.for]="uid + '-maxl'">Longitud máxima</label>
                <input type="number" min="1" [id]="uid + '-maxl'"
                       [ngModel]="val.max_length ?? null"
                       (ngModelChange)="cambiarValidacionNum('max_length', $event)" />
              </div>
            </div>
          }

          <!-- NUMBER / CURRENCY: rango -->
          @if (esNumero) {
            <div class="fc-fila fc-fila--doble">
              <div>
                <label [attr.for]="uid + '-minv'">Valor mínimo</label>
                <input type="number" [id]="uid + '-minv'"
                       [ngModel]="val.min_value ?? null"
                       (ngModelChange)="cambiarValidacionNum('min_value', $event)" />
              </div>
              <div>
                <label [attr.for]="uid + '-maxv'">Valor máximo</label>
                <input type="number" [id]="uid + '-maxv'"
                       [ngModel]="val.max_value ?? null"
                       (ngModelChange)="cambiarValidacionNum('max_value', $event)" />
              </div>
            </div>
          }

          <!-- DATE: rango de fechas -->
          @if (field.type === 'DATE') {
            <div class="fc-fila fc-fila--doble">
              <div>
                <label [attr.for]="uid + '-mind'">Fecha mínima</label>
                <input type="date" [id]="uid + '-mind'"
                       [ngModel]="val.min_date ?? ''"
                       (ngModelChange)="cambiarValidacionTexto('min_date', $event)" />
              </div>
              <div>
                <label [attr.for]="uid + '-maxd'">Fecha máxima</label>
                <input type="date" [id]="uid + '-maxd'"
                       [ngModel]="val.max_date ?? ''"
                       (ngModelChange)="cambiarValidacionTexto('max_date', $event)" />
              </div>
            </div>
          }

          <!-- TIME: rango de horas -->
          @if (field.type === 'TIME') {
            <div class="fc-fila fc-fila--doble">
              <div>
                <label [attr.for]="uid + '-mint'">Hora mínima</label>
                <input type="time" [id]="uid + '-mint'"
                       [ngModel]="val.min_time ?? ''"
                       (ngModelChange)="cambiarValidacionTexto('min_time', $event)" />
              </div>
              <div>
                <label [attr.for]="uid + '-maxt'">Hora máxima</label>
                <input type="time" [id]="uid + '-maxt'"
                       [ngModel]="val.max_time ?? ''"
                       (ngModelChange)="cambiarValidacionTexto('max_time', $event)" />
              </div>
            </div>
          }

          <!-- RATING: escala + etiquetas -->
          @if (field.type === 'RATING') {
            <div class="fc-fila fc-fila--doble">
              <div>
                <label [attr.for]="uid + '-esc'">Escala máxima (1 a 10)</label>
                <input type="number" min="1" max="10" [id]="uid + '-esc'"
                       [ngModel]="rating.scale_max"
                       (ngModelChange)="cambiarEscala($event)" />
              </div>
              <label class="fc-check">
                <input type="checkbox"
                       [ngModel]="rating.show_labels"
                       (ngModelChange)="cambiarRating({ show_labels: $event })" />
                <span>Mostrar etiquetas por número</span>
              </label>
            </div>
            @if (rating.show_labels) {
              <div class="fc-etiquetas">
                @for (n of escala; track n) {
                  <div class="fc-etiqueta">
                    <span class="fc-etiqueta__num">{{ n }}</span>
                    <input type="text"
                           [ngModel]="etiquetaDe(n)"
                           (ngModelChange)="cambiarEtiqueta(n, $event)"
                           [placeholder]="'Etiqueta para ' + n"
                           [attr.aria-label]="'Etiqueta para la calificación ' + n" />
                  </div>
                }
              </div>
            }
          }

          <!-- Choices: de dónde salen las opciones -->
          @if (esChoice) {
            <div class="fc-fila">
              <label [attr.for]="uid + '-origen'">Origen de las opciones</label>
              <select [id]="uid + '-origen'"
                      [ngModel]="origenActual"
                      (ngModelChange)="cambiarOrigen($event)">
                <option value="">Lista escrita aquí</option>
                @for (o of origenes(); track o.code) {
                  <option [value]="o.code">{{ o.name }} · tabla {{ o.catalog_code }}</option>
                }
              </select>
            </div>
          }

          @if (esChoice && origenActual) {
            <div class="fc-origen">
              <p class="fc-hint">
                Las opciones salen de la tabla parametrizada y se filtran con las reglas del
                origen para cada usuario. La lista de abajo deja de usarse.
              </p>
              <label [attr.for]="uid + '-padre'">Depende del campo</label>
              <select [id]="uid + '-padre'"
                      [ngModel]="padreActual"
                      (ngModelChange)="cambiarPadre($event)">
                <option value="">— Ninguno —</option>
                @for (h of siblings; track h.name) {
                  <option [value]="h.name">{{ h.label }}</option>
                }
              </select>
              @if (!siblings.length) {
                <p class="fc-hint">
                  Para encadenar (p. ej. Departamento → Municipio) necesitas otro campo de
                  selección simple en esta sección, ya guardado al menos una vez.
                </p>
              }
            </div>
          }

          <!-- Choices: editor de opciones -->
          @if (esChoice && !origenActual) {
            <div class="fc-opciones">
              <span class="fc-sub">Opciones</span>
              @for (opt of opciones; track opt.value; let i = $index) {
                <div class="fc-opcion">
                  <span class="fc-opcion__value" [title]="'Valor interno: ' + opt.value">{{ opt.value }}</span>
                  <input type="text"
                         [ngModel]="opt.label"
                         (ngModelChange)="renombrarOpcion(i, $event)"
                         [attr.aria-label]="'Etiqueta de la opción ' + opt.value"
                         placeholder="Etiqueta visible" />
                  <button type="button" class="fc-btn" [disabled]="i === 0"
                          (click)="moverOpcion(i, -1)" title="Subir opción" aria-label="Subir opción">
                    <span class="material-symbols-outlined">arrow_upward</span>
                  </button>
                  <button type="button" class="fc-btn" [disabled]="i === opciones.length - 1"
                          (click)="moverOpcion(i, 1)" title="Bajar opción" aria-label="Bajar opción">
                    <span class="material-symbols-outlined">arrow_downward</span>
                  </button>
                  <button type="button" class="fc-btn fc-btn--danger" [disabled]="opciones.length <= 1"
                          (click)="quitarOpcion(i)" title="Quitar opción" aria-label="Quitar opción">
                    <span class="material-symbols-outlined">close</span>
                  </button>
                </div>
              }
              <button type="button" class="fc-agregar" (click)="agregarOpcion()">
                <span class="material-symbols-outlined">add</span> Agregar opción
              </button>
            </div>
          }
          <!-- Ruta de respuestas: a dónde lleva cada opción -->
          @if (permiteRuta) {
            <div class="fc-ruta">
              <span class="fc-sub">
                <span class="material-symbols-outlined" aria-hidden="true">alt_route</span>
                Según la respuesta, ir a
              </span>
              <p class="fc-hint">
                Deja «Seguir el recorrido» y el formulario sigue como siempre. Solo se puede
                avanzar o terminar: así nunca queda un formulario imposible de enviar.
              </p>
              @for (opt of opciones; track opt.value) {
                <div class="fc-ruta__fila">
                  <span class="fc-ruta__opcion" [title]="opt.label">{{ opt.label }}</span>
                  <span class="material-symbols-outlined fc-ruta__flecha" aria-hidden="true">east</span>
                  <select [value]="destinoDeOpcion(opt.value)"
                          (change)="cambiarDestinoDeOpcion(opt.value, $any($event.target).value)"
                          [attr.aria-label]="'Destino cuando responden ' + opt.label">
                    <option value="">Seguir el recorrido</option>
                    @for (d of destinos; track d.code) {
                      <option [value]="d.code">{{ d.nombre }}</option>
                    }
                  </select>
                </div>
              }
            </div>
          }

          @if (esChoice && field.type === 'MULTIPLE_CHOICE') {
              <div class="fc-fila fc-fila--doble">
                <div>
                  <label [attr.for]="uid + '-mins'">Mínimo seleccionadas</label>
                  <input type="number" min="0" [id]="uid + '-mins'"
                         [ngModel]="val.min_selected ?? null"
                         (ngModelChange)="cambiarValidacionNum('min_selected', $event)" />
                </div>
                <div>
                  <label [attr.for]="uid + '-maxs'">Máximo seleccionadas</label>
                  <input type="number" min="1" [id]="uid + '-maxs'"
                         [ngModel]="val.max_selected ?? null"
                         (ngModelChange)="cambiarValidacionNum('max_selected', $event)" />
                </div>
              </div>
          }

          <!-- Media: archivos permitidos -->
          @if (esEscaneo) {
            <p class="fc-hint">{{ ayudaEscaneo }}</p>
          }
          @if (esMedia) {
            <div class="fc-fila fc-fila--doble">
              @if (field.type !== 'SIGNATURE') {
                <div>
                  <label [attr.for]="uid + '-maxf'">{{ etiquetaMaxArchivos }}</label>
                  <input type="number" min="1" [id]="uid + '-maxf'"
                         [ngModel]="val.max_files ?? null"
                         (ngModelChange)="cambiarValidacionNum('max_files', $event)" />
                </div>
              }
              <div>
                <label [attr.for]="uid + '-maxmb'">Tamaño máx. (MB)</label>
                <input type="number" min="1" [id]="uid + '-maxmb'"
                       [ngModel]="val.max_size_mb ?? null"
                       (ngModelChange)="cambiarValidacionNum('max_size_mb', $event)" />
              </div>
            </div>
            <div class="fc-fila">
              <label [attr.for]="uid + '-ext'">Extensiones permitidas</label>
              <div class="fc-chips">
                @for (ext of extensiones; track ext) {
                  <span class="fc-chip">
                    .{{ ext }}
                    <button type="button" (click)="quitarExtension(ext)"
                            [attr.aria-label]="'Quitar extensión ' + ext" title="Quitar">
                      <span class="material-symbols-outlined">close</span>
                    </button>
                  </span>
                }
                <input type="text" [id]="uid + '-ext'" class="fc-chips__input"
                       placeholder="ej. pdf + Enter"
                       (keydown.enter)="agregarExtension($event)" />
              </div>
            </div>
          }

          <!-- COMMENT: el texto ES el contenido -->
          @if (field.type === 'COMMENT') {
            <div class="fc-fila">
              <label [attr.for]="uid + '-txt'">Texto del comentario <span class="fc-req-mark" aria-hidden="true">*</span></label>
              <textarea rows="3" [id]="uid + '-txt'"
                        [ngModel]="field.schema.text ?? ''"
                        (ngModelChange)="cambiarSchema({ text: $event })"
                        placeholder="Texto informativo que verá quien llene el formulario"></textarea>
            </div>
          }

          <!-- SECTION: hijos como sub-tarjetas (sin drag anidado) -->
          @if (field.type === 'SECTION') {
            <div class="fc-hijos">
              <span class="fc-sub">Campos dentro de la sección</span>
              @for (hijo of hijos; track $index; let i = $index) {
                <app-field-config-card
                    [field]="hijo"
                    [types]="types"
                    [nested]="true"
                    [canUp]="i > 0"
                    [canDown]="i < hijos.length - 1"
                    (fieldChange)="cambiarHijo(i, $event)"
                    (duplicateField)="duplicarHijo(i)"
                    (removeField)="quitarHijo(i)"
                    (moveUp)="moverHijo(i, -1)"
                    (moveDown)="moverHijo(i, 1)"
                    (extract)="extractChild.emit(hijo)" />
              } @empty {
                <p class="fc-vacio">La sección aún no tiene campos.</p>
              }
              <div class="fc-agregar-hijo">
                <label class="sr-only" [attr.for]="uid + '-nuevo'">Tipo del campo a agregar</label>
                <select [id]="uid + '-nuevo'" [(ngModel)]="tipoNuevoHijo">
                  @for (t of tiposHijos; track t.code) {
                    <option [value]="t.code">{{ t.name }}</option>
                  }
                </select>
                <button type="button" class="fc-agregar" (click)="agregarHijo()">
                  <span class="material-symbols-outlined">add</span> Agregar campo
                </button>
              </div>
            </div>
          }

          <!-- Ancho completo (solo tipos donde no es forzado por regla) -->
          @if (permiteAnchoCompleto) {
            <label class="fc-check">
              <input type="checkbox"
                     [ngModel]="field.schema.ui?.full_width === true"
                     (ngModelChange)="cambiarAnchoCompleto($event)" />
              <span>Ocupar el ancho completo</span>
            </label>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .fc-card {
      background: var(--surface, #fff);
      border: 1px solid var(--slate-200, #e8edf3);
      border-radius: var(--r-sm, 10px);
    }
    .fc-card--nested { background: var(--slate-50, #f8fafc); }
    .fc-head {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      flex-wrap: wrap;
    }
    .fc-icon {
      font-size: 20px;
      color: var(--navy, #21263c);
      background: var(--slate-100, #f1f5f9);
      border-radius: 8px;
      padding: 5px;
    }
    .fc-head__main {
      flex: 1;
      min-width: 140px;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .fc-label {
      width: 100%;
      border: none;
      border-bottom: 1px dashed transparent;
      background: transparent;
      font: inherit;
      font-weight: 600;
      color: var(--navy-deep, #0f172a);
      padding: 2px 0;
    }
    .fc-label:hover { border-bottom-color: var(--slate-300, #d8e0ea); }
    .fc-label:focus-visible {
      outline: none;
      border-bottom: 1px solid var(--lime, #8cd50a);
    }
    .fc-tipo {
      font-size: 0.72rem;
      color: var(--slate-500, #64748b);
      text-transform: none;
    }
    .fc-req {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 0.78rem;
      color: var(--slate-700, #334155);
      cursor: pointer;
      white-space: nowrap;
    }
    .fc-req input { accent-color: var(--navy, #21263c); }
    .fc-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: var(--slate-500, #64748b);
      cursor: pointer;
      padding: 0;
    }
    .fc-btn .material-symbols-outlined { font-size: 19px; }
    .fc-btn:hover:not(:disabled) { background: var(--slate-100, #f1f5f9); color: var(--navy, #21263c); }
    .fc-btn:focus-visible { outline: 2px solid var(--lime, #8cd50a); outline-offset: 1px; }
    .fc-btn:disabled { opacity: 0.35; cursor: not-allowed; }
    .fc-btn--danger:hover:not(:disabled) { color: var(--danger, #b42318); background: #fdecea; }
    .fc-body {
      border-top: 1px solid var(--slate-200, #e8edf3);
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .fc-fila { display: flex; flex-direction: column; gap: 4px; }
    .fc-fila--doble {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      align-items: end;
    }
    .fc-fila--doble > div { display: flex; flex-direction: column; gap: 4px; }
    .fc-body label { font-size: 0.8rem; font-weight: 600; color: var(--navy, #21263c); }
    .fc-body input[type=text], .fc-body input[type=number], .fc-body input[type=date],
    .fc-body input[type=time], .fc-body textarea, .fc-body select {
      width: 100%;
      box-sizing: border-box;
      padding: 7px 10px;
      border: 1px solid var(--slate-300, #d8e0ea);
      border-radius: var(--r-sm, 10px);
      font: inherit;
      font-size: 0.86rem;
      background: var(--surface, #fff);
      color: var(--navy-deep, #0f172a);
    }
    .fc-body input:focus-visible, .fc-body textarea:focus-visible, .fc-body select:focus-visible {
      outline: 2px solid var(--lime, #8cd50a);
      outline-offset: 1px;
    }
    .fc-check {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.82rem;
      color: var(--slate-700, #334155);
      cursor: pointer;
    }
    .fc-check input { accent-color: var(--navy, #21263c); }
    .fc-sub {
      font-size: 0.8rem;
      font-weight: 700;
      color: var(--navy, #21263c);
    }
    .fc-req-mark { color: #c0392b; }
    .fc-opciones { display: flex; flex-direction: column; gap: 6px; }
    .fc-ruta { display: flex; flex-direction: column; gap: 6px; }
    .fc-ruta .fc-sub { display: flex; align-items: center; gap: 6px; }
    .fc-ruta .fc-sub .material-symbols-outlined { font-size: 18px; }
    .fc-ruta__fila { display: flex; align-items: center; gap: 8px; }
    .fc-ruta__opcion {
      flex: 0 1 40%;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 0.85rem;
      color: var(--navy, #21263c);
    }
    .fc-ruta__flecha { font-size: 16px; color: var(--slate-500, #64748b); flex-shrink: 0; }
    .fc-ruta__fila select { flex: 1 1 auto; min-width: 0; }
    .fc-origen { display: flex; flex-direction: column; gap: 6px; }
    .fc-hint { margin: 0; font-size: 0.78rem; color: var(--slate-500, #64748b); }
    .fc-opcion {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .fc-opcion__value {
      font-family: monospace;
      font-size: 0.72rem;
      color: var(--slate-500, #64748b);
      background: var(--slate-100, #f1f5f9);
      border-radius: 6px;
      padding: 4px 6px;
      white-space: nowrap;
    }
    .fc-opcion input { flex: 1; min-width: 0; }
    .fc-agregar {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      align-self: flex-start;
      border: 1px dashed var(--slate-300, #d8e0ea);
      border-radius: var(--r-sm, 10px);
      background: transparent;
      color: var(--navy, #21263c);
      font: inherit;
      font-size: 0.82rem;
      font-weight: 600;
      padding: 6px 12px;
      cursor: pointer;
    }
    .fc-agregar:hover { border-color: var(--navy, #21263c); background: var(--slate-50, #f8fafc); }
    .fc-agregar:focus-visible { outline: 2px solid var(--lime, #8cd50a); outline-offset: 1px; }
    .fc-agregar .material-symbols-outlined { font-size: 17px; }
    .fc-etiquetas { display: flex; flex-direction: column; gap: 6px; }
    .fc-etiqueta { display: flex; align-items: center; gap: 8px; }
    .fc-etiqueta__num {
      min-width: 24px;
      text-align: center;
      font-weight: 700;
      font-size: 0.82rem;
      color: var(--navy, #21263c);
      background: var(--slate-100, #f1f5f9);
      border-radius: 6px;
      padding: 4px 0;
    }
    .fc-etiqueta input { flex: 1; }
    .fc-chips {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      padding: 6px;
      border: 1px solid var(--slate-300, #d8e0ea);
      border-radius: var(--r-sm, 10px);
      background: var(--surface, #fff);
    }
    .fc-chip {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      background: var(--slate-100, #f1f5f9);
      border-radius: 999px;
      padding: 3px 6px 3px 10px;
      font-size: 0.8rem;
      color: var(--navy-deep, #0f172a);
    }
    .fc-chip button {
      display: inline-flex;
      border: none;
      background: transparent;
      cursor: pointer;
      color: var(--slate-500, #64748b);
      padding: 0;
    }
    .fc-chip button .material-symbols-outlined { font-size: 15px; }
    .fc-chip button:hover { color: var(--danger, #b42318); }
    .fc-chips__input {
      flex: 1;
      min-width: 110px;
      border: none !important;
      padding: 4px !important;
    }
    .fc-chips__input:focus-visible { outline: none !important; }
    .fc-hijos { display: flex; flex-direction: column; gap: 8px; }
    .fc-vacio {
      margin: 0;
      font-size: 0.82rem;
      color: var(--slate-500, #64748b);
      font-style: italic;
    }
    .fc-agregar-hijo {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .fc-agregar-hijo select { max-width: 220px; }
    .sr-only {
      position: absolute;
      width: 1px; height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
  `],
})
export class FieldConfigCardComponent {
  @Input({ required: true }) field!: DynamicField;
  /** Catálogo completo de tipos (para icono/nombre y para agregar hijos a SECTION). */
  @Input() types: FieldTypeInfo[] = [];
  /** true cuando la tarjeta es un hijo dentro de una SECTION (sin drag anidado). */
  @Input() nested = false;
  @Input() canUp = false;
  @Input() canDown = false;
  /** Campos de la sección que pueden ser el padre de una cascada de opciones. */
  @Input() siblings: Array<{ name: string; label: string }> = [];
  /**
   * Destinos a los que puede saltar una respuesta: las secciones POSTERIORES a la de
   * este campo, más "terminar el formulario". Los calcula la página (solo ella conoce
   * el orden de las secciones).
   */
  @Input() destinos: Array<{ code: string; nombre: string }> = [];

  /** Emite el campo COMPLETO reconstruido (inmutable) en cada edición. */
  @Output() fieldChange = new EventEmitter<DynamicField>();
  @Output() duplicateField = new EventEmitter<void>();
  @Output() removeField = new EventEmitter<void>();
  /** Solo nested: reordenar dentro de la SECTION padre. */
  @Output() moveUp = new EventEmitter<void>();
  @Output() moveDown = new EventEmitter<void>();
  /** Solo nested: pide al padre sacarlo de la sección. */
  @Output() extract = new EventEmitter<void>();
  /** Solo SECTION: un hijo pidió salir; la PÁGINA lo reubica tras la sección. */
  @Output() extractChild = new EventEmitter<DynamicField>();

  /** Estado de expansión local (se pierde al recrear la tarjeta; es cosmético). */
  expandido = signal(false);

  /**
   * Orígenes de opciones disponibles. Se piden una sola vez por tarjeta abierta; el
   * servicio ya cachea, así que un formulario con muchos campos no dispara N llamadas.
   */
  readonly origenes = signal<OptionSource[]>([]);
  private readonly optionSources = inject(OptionSourceService);

  /** Tipo por defecto del selector "agregar campo" de una SECTION. */
  tipoNuevoHijo: FieldType = 'TEXT_SHORT';

  constructor() {
    // Fallo silencioso a propósito: sin orígenes el selector se queda en "Lista escrita
    // aquí" y el constructor sigue siendo usable como siempre.
    this.optionSources.list().subscribe({
      next: list => this.origenes.set(list ?? []),
      error: () => this.origenes.set([]),
    });
  }

  private static seq = 0;
  /** Prefijo único para los id/for de los controles internos (a11y). */
  readonly uid = `fc${++FieldConfigCardComponent.seq}`;

  // ── Lookups del catálogo ────────────────────────────────────────────

  get info(): FieldTypeInfo | null {
    return this.types.find(t => t.code === this.field.type) ?? null;
  }
  get icono(): string { return this.info?.icon || 'category'; }
  get tipoNombre(): string { return this.info?.name ?? this.field.type; }
  get tiposHijos(): FieldTypeInfo[] {
    // Un solo nivel de anidación: una SECTION no puede contener otra SECTION.
    return this.types.filter(t => t.code !== 'SECTION');
  }

  // ── Predicados por tipo ─────────────────────────────────────────────

  get esTexto(): boolean { return this.field.type === 'TEXT_SHORT' || this.field.type === 'TEXT_LONG'; }
  get esNumero(): boolean { return this.field.type === 'NUMBER' || this.field.type === 'CURRENCY'; }
  get esChoice(): boolean {
    return this.field.type === 'SINGLE_CHOICE' || this.field.type === 'DROPDOWN' || this.field.type === 'MULTIPLE_CHOICE';
  }
  get esMedia(): boolean {
    return this.field.type === 'PHOTO' || this.field.type === 'VIDEO'
      || this.field.type === 'FILE' || this.field.type === 'SIGNATURE'
      || this.esEscaneo;
  }
  /** SCAN_DOC / SCAN_ID: media capturada con el escáner (PDF por documento). */
  get esEscaneo(): boolean {
    return this.field.type === 'SCAN_DOC' || this.field.type === 'SCAN_ID';
  }
  get muestraPlaceholder(): boolean { return this.esTexto || this.esNumero || this.field.type === 'DROPDOWN'; }
  get muestraDescripcion(): boolean { return this.field.type !== 'COMMENT' && this.field.type !== 'SECTION'; }
  get permiteRequerido(): boolean { return this.field.type !== 'COMMENT' && this.field.type !== 'SECTION'; }
  get permiteAnchoCompleto(): boolean {
    // TEXT_LONG y SECTION ya son full-width por regla fija; no tiene sentido el toggle.
    return this.field.type !== 'TEXT_LONG' && this.field.type !== 'SECTION';
  }

  // ── Accesos seguros ─────────────────────────────────────────────────

  /** En escaneo lo que se cuenta son DOCUMENTOS (cada uno un PDF), no archivos sueltos. */
  get etiquetaMaxArchivos(): string {
    if (this.field.type === 'SCAN_ID') return 'Máx. cédulas';
    if (this.field.type === 'SCAN_DOC') return 'Máx. documentos';
    return 'Máx. archivos';
  }

  get ayudaEscaneo(): string {
    return this.field.type === 'SCAN_ID'
      ? 'Al llenar se abre el escáner guiado: frente y reverso quedan en UN solo PDF. '
        + 'Sube el máximo a 2 o más si necesitas varias cédulas (titular, cónyuge…).'
      : 'Al llenar se abre el escáner: cada documento puede tener varias páginas y se '
        + 'guarda como un PDF. Sube el máximo si quieres permitir varios documentos.';
  }

  get val(): FieldValidation { return this.field.schema.validation ?? {}; }
  get opciones(): FieldOption[] { return this.field.schema.options ?? []; }
  get extensiones(): string[] { return this.val.allowed_extensions ?? []; }
  get hijos(): DynamicField[] { return this.field.children ?? []; }
  get rating(): RatingConfig {
    return this.field.schema.rating_config ?? { scale_max: 5, mode: 'STARS', show_labels: false };
  }
  get escala(): number[] {
    return Array.from({ length: this.rating.scale_max }, (_, i) => i + 1);
  }

  etiquetaDe(n: number): string {
    return this.rating.labels?.[String(n)] ?? '';
  }

  textoONada(v: string): string | undefined {
    return v?.trim() ? v : undefined;
  }

  // ── Mutaciones inmutables (todas emiten un campo NUEVO) ─────────────

  cambiar(p: Partial<DynamicField>): void {
    this.fieldChange.emit({ ...this.field, ...p });
  }

  // ── Ruta de respuestas ──────────────────────────────────────────────

  /**
   * La ruta se configura solo donde el servidor la acepta: selección ÚNICA con opciones
   * escritas a mano (con origen dinámico las opciones no se conocen al publicar) y
   * habiendo a dónde ir.
   */
  get permiteRuta(): boolean {
    return (this.field.type === 'SINGLE_CHOICE' || this.field.type === 'DROPDOWN')
      && !this.origenActual
      && this.opciones.length > 0
      && this.destinos.length > 0;
  }

  private get reglas(): FieldRoutingRule[] {
    return this.field.schema.routing?.rules ?? [];
  }

  /** Destino configurado para una opción ('' = seguir el recorrido normal). */
  destinoDeOpcion(value: string): string {
    return this.reglas.find(r => r.option === value)?.go_to ?? '';
  }

  cambiarDestinoDeOpcion(value: string, destino: string): void {
    const limpias = this.reglas.filter(r => r.option !== value);
    const rules = destino.trim()
      ? [...limpias, { option: value, go_to: destino.trim() }]
      : limpias;
    const schema: FieldSchema = { ...this.field.schema };
    if (rules.length === 0) delete schema.routing;
    else schema.routing = { rules };
    this.cambiar({ schema });
  }

  /** Código del origen configurado en el campo ('' = opciones escritas a mano). */
  get origenActual(): string {
    return this.field.schema?.options_source?.source ?? '';
  }

  get padreActual(): string {
    return this.field.schema?.options_source?.parent_field ?? '';
  }

  /**
   * Cambiar el origen NO borra las opciones escritas: si el usuario vuelve a "Lista
   * escrita aquí" las recupera tal cual. El backend ignora `options` cuando hay origen.
   */
  cambiarOrigen(code: string): void {
    if (!code) {
      const schema: FieldSchema = { ...this.field.schema };
      delete schema.options_source;
      // Sin origen vuelve a mandar la lista fija: si quedó vacía, se siembra una opción
      // para no dejar el campo en un estado que el backend rechaza al publicar.
      if (!schema.options?.length) schema.options = [{ value: 'opt_1', label: 'Opción 1' }];
      this.cambiar({ schema });
      return;
    }
    const parent = this.padreActual;
    this.cambiarSchema({
      options_source: { source: code, parent_field: parent || null },
    });
  }

  cambiarPadre(parentField: string): void {
    const source = this.origenActual;
    if (!source) return;
    this.cambiarSchema({
      options_source: { source, parent_field: parentField || null },
    });
  }

  cambiarSchema(p: Partial<FieldSchema>): void {
    this.cambiar({ schema: { ...this.field.schema, ...p } });
  }

  private cambiarValidacion(p: Partial<FieldValidation>): void {
    this.cambiarSchema({ validation: { ...this.val, ...p } });
  }

  cambiarValidacionNum(
    clave: 'min_length' | 'max_length' | 'min_value' | 'max_value'
      | 'min_selected' | 'max_selected' | 'max_files' | 'max_size_mb',
    v: number | null,
  ): void {
    const p: Partial<FieldValidation> = {};
    p[clave] = typeof v === 'number' && Number.isFinite(v) ? v : null;
    this.cambiarValidacion(p);
  }

  cambiarValidacionTexto(clave: 'min_date' | 'max_date' | 'min_time' | 'max_time', v: string | null): void {
    const p: Partial<FieldValidation> = {};
    p[clave] = v?.trim() ? v : null;
    this.cambiarValidacion(p);
  }

  cambiarAnchoCompleto(v: boolean): void {
    this.cambiarSchema({ ui: { ...(this.field.schema.ui ?? {}), full_width: v } });
  }

  // RATING
  cambiarRating(p: Partial<RatingConfig>): void {
    this.cambiarSchema({ rating_config: { ...this.rating, ...p } });
  }

  cambiarEscala(v: number | null): void {
    const n = Math.min(10, Math.max(1, Math.round(typeof v === 'number' && Number.isFinite(v) ? v : 5)));
    this.cambiarRating({ scale_max: n });
  }

  cambiarEtiqueta(n: number, texto: string): void {
    const labels: Record<string, string> = { ...(this.rating.labels ?? {}) };
    if (texto.trim()) labels[String(n)] = texto;
    else delete labels[String(n)];
    this.cambiarRating({ labels });
  }

  // Opciones (choices)
  agregarOpcion(): void {
    const opts = this.opciones;
    // El siguiente número parte del máximo existente para no repetir valores
    // aunque se hayan quitado opciones intermedias.
    const siguiente = opts.reduce((m, o) => {
      const n = Number(o.value.replace('opt_', ''));
      return Number.isFinite(n) && n > m ? n : m;
    }, 0) + 1;
    this.cambiarSchema({ options: [...opts, { value: `opt_${siguiente}`, label: `Opción ${siguiente}` }] });
  }

  renombrarOpcion(i: number, label: string): void {
    const opts = [...this.opciones];
    opts[i] = { ...opts[i], label };
    this.cambiarSchema({ options: opts });
  }

  quitarOpcion(i: number): void {
    this.cambiarSchema({ options: this.opciones.filter((_, k) => k !== i) });
  }

  moverOpcion(i: number, dir: -1 | 1): void {
    const opts = [...this.opciones];
    const j = i + dir;
    if (j < 0 || j >= opts.length) return;
    [opts[i], opts[j]] = [opts[j], opts[i]];
    this.cambiarSchema({ options: opts });
  }

  // Extensiones (media)
  agregarExtension(ev: Event): void {
    ev.preventDefault(); // que el Enter no dispare el submit de un form padre
    const input = ev.target as HTMLInputElement;
    const ext = input.value.trim().toLowerCase().replace(/^\./, '').replace(/[^a-z0-9]/g, '');
    if (ext && !this.extensiones.includes(ext)) {
      this.cambiarValidacion({ allowed_extensions: [...this.extensiones, ext] });
    }
    input.value = '';
  }

  quitarExtension(ext: string): void {
    this.cambiarValidacion({ allowed_extensions: this.extensiones.filter(e => e !== ext) });
  }

  // Hijos (SECTION)
  cambiarHijo(i: number, actualizado: DynamicField): void {
    const kids = [...this.hijos];
    kids[i] = actualizado;
    this.cambiar({ children: kids });
  }

  quitarHijo(i: number): void {
    this.cambiar({ children: this.hijos.filter((_, k) => k !== i) });
  }

  duplicarHijo(i: number): void {
    const kids = [...this.hijos];
    kids.splice(i + 1, 0, clonarCampoParaDuplicar(kids[i]));
    this.cambiar({ children: kids });
  }

  moverHijo(i: number, dir: -1 | 1): void {
    const kids = [...this.hijos];
    const j = i + dir;
    if (j < 0 || j >= kids.length) return;
    [kids[i], kids[j]] = [kids[j], kids[i]];
    this.cambiar({ children: kids });
  }

  agregarHijo(): void {
    const info = this.types.find(t => t.code === this.tipoNuevoHijo)
      ?? this.types.find(t => t.code === 'TEXT_SHORT');
    if (!info) return;
    this.cambiar({ children: [...this.hijos, crearCampoDesdeTipo(info)] });
  }
}
