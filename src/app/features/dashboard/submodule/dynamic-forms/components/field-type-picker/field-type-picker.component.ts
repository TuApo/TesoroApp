import {
  ChangeDetectionStrategy, Component, computed, input, output, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FieldTypeInfo } from '../../models/dynamic-forms.models';

/**
 * SELECTOR DE TIPO DE CAMPO en hoja modal.
 *
 * Es la ÚNICA vía para agregar un campo (antes convivía con una paleta lateral, que
 * solo servía en escritorio y comía una columna del lienzo): la abre el botón
 * "Agregar campo" de cada sección y los puntos de inserción que hay entre pregunta y
 * pregunta; se busca por nombre y al elegir un tipo el campo entra en ESA sección, en
 * la posición desde la que se abrió (el texto de `ubicacion` la describe).
 *
 * No conoce el estado del constructor: recibe el catálogo y emite el tipo elegido.
 */
@Component({
  selector: 'app-field-type-picker',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ftp-fondo" (click)="cerrar.emit()">
      <div class="ftp-hoja" role="dialog" aria-modal="true" aria-labelledby="ftp-titulo"
           (click)="$event.stopPropagation()">
        <div class="ftp-head">
          <div class="ftp-head__texto">
            <h2 class="ftp-titulo" id="ftp-titulo">Agregar campo</h2>
            <p class="ftp-sub">{{ ubicacion() || ('Se añade al final de ' + (destino() || 'la sección') + '.') }}</p>
          </div>
          <button type="button" class="ftp-cerrar" (click)="cerrar.emit()" aria-label="Cerrar">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>

        <label class="ftp-buscar">
          <span class="material-symbols-outlined" aria-hidden="true">search</span>
          <input type="text" placeholder="Buscar tipo de campo…"
                 [ngModel]="filtro()" (ngModelChange)="filtro.set($event)"
                 aria-label="Buscar tipo de campo" />
        </label>

        <div class="ftp-lista">
          @for (t of visibles(); track t.code) {
            <button type="button" class="ftp-item" (click)="elegir.emit(t)">
              <span class="material-symbols-outlined ftp-item__icon" aria-hidden="true">{{ t.icon || 'category' }}</span>
              <span class="ftp-item__texto">
                <span class="ftp-item__name">{{ t.name }}</span>
                @if (t.description) { <span class="ftp-item__desc">{{ t.description }}</span> }
              </span>
              <span class="material-symbols-outlined ftp-item__plus" aria-hidden="true">add</span>
            </button>
          } @empty {
            <p class="ftp-vacio">
              @if (types().length === 0) {
                Cargando el catálogo de tipos…
              } @else {
                Ningún tipo coincide con «{{ filtro() }}».
              }
            </p>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .ftp-fondo {
      position: fixed;
      inset: 0;
      z-index: 1200;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: rgba(15, 23, 42, 0.48);
    }
    .ftp-hoja {
      display: flex;
      flex-direction: column;
      width: min(520px, 100%);
      max-height: min(72vh, 640px);
      background: var(--surface, #fff);
      border-radius: var(--r-md, 14px);
      box-shadow: var(--shadow-lg, 0 24px 70px rgba(15, 23, 42, 0.26));
      overflow: hidden;
    }
    .ftp-head {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 16px 16px 10px;
    }
    .ftp-head__texto { flex: 1; min-width: 0; }
    .ftp-titulo {
      margin: 0;
      font-size: 1.05rem;
      font-weight: 700;
      color: var(--navy, #21263c);
    }
    .ftp-sub {
      margin: 2px 0 0;
      font-size: 0.8rem;
      color: var(--slate-500, #64748b);
    }
    .ftp-cerrar {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      flex: none;
      border: none;
      border-radius: 10px;
      background: var(--slate-100, #f1f5f9);
      color: var(--slate-700, #334155);
      cursor: pointer;
    }
    .ftp-cerrar:hover { background: var(--slate-200, #e8edf3); }
    .ftp-cerrar:focus-visible { outline: 2px solid var(--lime, #8cd50a); outline-offset: 2px; }

    .ftp-buscar {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 16px 10px;
      padding: 8px 12px;
      border: 1px solid var(--slate-300, #d8e0ea);
      border-radius: var(--r-sm, 10px);
      background: var(--slate-50, #f8fafc);
      color: var(--slate-500, #64748b);
    }
    .ftp-buscar input {
      flex: 1;
      min-width: 0;
      border: none;
      background: none;
      font: inherit;
      font-size: 0.9rem;
      color: var(--navy-deep, #0f172a);
      outline: none;
    }
    .ftp-buscar:focus-within {
      border-color: var(--navy, #21263c);
      outline: 2px solid var(--lime, #8cd50a);
      outline-offset: 1px;
    }

    .ftp-lista {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 0 16px 16px;
      overflow-y: auto;
    }
    .ftp-item {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
      padding: 11px 12px;
      border: 1px solid var(--slate-200, #e8edf3);
      border-radius: var(--r-sm, 10px);
      background: var(--surface, #fff);
      color: var(--navy-deep, #0f172a);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .ftp-item:hover { border-color: var(--navy, #21263c); background: var(--slate-50, #f8fafc); }
    .ftp-item:focus-visible { outline: 2px solid var(--lime, #8cd50a); outline-offset: 1px; }
    .ftp-item__icon { font-size: 22px; color: var(--navy, #21263c); flex: none; }
    .ftp-item__texto { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .ftp-item__name { font-size: 0.92rem; font-weight: 600; }
    .ftp-item__desc {
      font-size: 0.76rem;
      color: var(--slate-500, #64748b);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ftp-item__plus { font-size: 20px; color: var(--slate-400, #94a3b8); flex: none; }
    .ftp-vacio {
      margin: 6px 0;
      font-size: 0.85rem;
      color: var(--slate-500, #64748b);
      text-align: center;
    }

    /* Móvil: hoja pegada abajo, al alcance del pulgar. */
    @media (max-width: 640px) {
      .ftp-fondo { align-items: flex-end; padding: 0; }
      .ftp-hoja {
        width: 100%;
        max-height: 86vh;
        border-radius: var(--r-md, 14px) var(--r-md, 14px) 0 0;
      }
      .ftp-item { padding: 13px 12px; }
    }
  `],
})
export class FieldTypePickerComponent {
  /**
   * Catálogo servido por el backend, ya ordenado por order_no.
   *
   * Entrada de SEÑAL a propósito: el catálogo llega por HTTP y puede aterrizar con el
   * selector ya abierto; con un @Input clásico la lista filtrada quedaría cacheada en
   * el vacío y el selector se vería permanentemente "cargando".
   */
  readonly types = input<FieldTypeInfo[]>([]);
  /** Nombre de la sección destino, solo para el subtítulo. */
  readonly destino = input('');
  /**
   * Frase completa de dónde va a caer el campo ("Se inserta en Sección 1, antes de
   * «Día»."). Si viene vacía se cae al texto de siempre: al final de la sección.
   */
  readonly ubicacion = input('');

  readonly elegir = output<FieldTypeInfo>();
  readonly cerrar = output<void>();

  filtro = signal('');

  /** Filtro por nombre o descripción, sin tildes ni mayúsculas. */
  readonly visibles = computed(() => {
    const q = normalizar(this.filtro());
    const todos = this.types();
    if (!q) return todos;
    return todos.filter(t =>
      normalizar(t.name).includes(q) || normalizar(t.description ?? '').includes(q));
  });
}

function normalizar(texto: string): string {
  return (texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
