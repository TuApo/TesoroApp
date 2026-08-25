import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatButtonModule } from '@angular/material/button';

import { PlacementService } from '../../services/placement.service';
import { ModuleNode } from '../../models/placement.models';

/** Normaliza para buscar: minúsculas, sin tildes, recortado. */
function normalizar(s: string | null | undefined): string {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Fila ya aplanada del árbol lista para pintar (evita recursión en el template). */
interface FilaNodo {
  node: ModuleNode;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

/**
 * SELECTOR DE MÓDULO ANFITRIÓN para la ubicación de un formulario dinámico.
 *
 * Muestra el árbol de módulos donde el usuario PUEDE colgar el formulario
 * (`PlacementService.moduleTree(true)`), con buscador y expand/colapso. Se puede
 * elegir CUALQUIER nodo administrable —hoja o raíz—; los nodos con
 * `manageable === false` salen deshabilitados (radio bloqueado) con el tooltip
 * "Sin permiso de administración", pero siguen siendo navegables/expandibles.
 *
 * Contrato: `[(value)]` = id del nodo elegido. Además emite `nodeChange` con el
 * ModuleNode completo (lo usan el diálogo y el builder para la vista previa de la
 * ruta sin volver a pedir el árbol).
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-module-tree-picker',
  standalone: true,
  imports: [CommonModule, MatTooltipModule, MatProgressBarModule, MatButtonModule],
  template: `
    <div class="mtp">
      <div class="mtp-buscador">
        <span class="material-symbols-outlined mtp-buscador-icon" aria-hidden="true">search</span>
        <input #q type="text" class="mtp-buscador-input" autocomplete="off"
               placeholder="Buscar módulo…" aria-label="Buscar módulo del menú"
               (input)="filtro.set(q.value)" />
        @if (q.value) {
          <button type="button" class="mtp-buscador-limpiar" aria-label="Limpiar búsqueda"
                  (click)="q.value = ''; filtro.set('')">
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        }
      </div>

      @if (cargando()) {
        <mat-progress-bar mode="indeterminate" aria-label="Cargando módulos"></mat-progress-bar>
      }

      @if (errorCarga()) {
        <div class="mtp-estado" role="alert">
          <span class="material-symbols-outlined mtp-estado-icon" aria-hidden="true">cloud_off</span>
          <p>No se pudo cargar el árbol de módulos.</p>
          <button mat-stroked-button type="button" (click)="cargar()">
            <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
            Reintentar
          </button>
        </div>
      } @else if (!cargando() && filas().length === 0) {
        <div class="mtp-estado">
          <span class="material-symbols-outlined mtp-estado-icon" aria-hidden="true">folder_off</span>
          <p>
            @if (filtro().trim()) { Ningún módulo coincide con la búsqueda. }
            @else { No hay módulos donde puedas ubicar el formulario. }
          </p>
        </div>
      } @else {
        <div class="mtp-arbol" role="tree" aria-label="Módulos del menú">
          @for (fila of filas(); track fila.node.id) {
            <div class="mtp-fila" role="treeitem"
                 [attr.aria-level]="fila.depth + 1"
                 [attr.aria-expanded]="fila.hasChildren ? fila.expanded : null"
                 [attr.aria-selected]="estaSeleccionado(fila.node.id)"
                 [style.padding-left.px]="fila.depth * 20 + 6">

              @if (fila.hasChildren) {
                <button type="button" class="mtp-chevron"
                        (click)="alternar(fila.node.id)"
                        [attr.aria-label]="fila.expanded ? 'Contraer ' + fila.node.label : 'Expandir ' + fila.node.label">
                  <span class="material-symbols-outlined" aria-hidden="true">
                    {{ fila.expanded ? 'expand_more' : 'chevron_right' }}
                  </span>
                </button>
              } @else {
                <span class="mtp-chevron mtp-chevron--vacio" aria-hidden="true"></span>
              }

              <label class="mtp-nodo"
                     [class.mtp-nodo--sel]="estaSeleccionado(fila.node.id)"
                     [class.mtp-nodo--off]="fila.node.manageable === false"
                     [matTooltip]="fila.node.manageable === false ? 'Sin permiso de administración' : ''"
                     matTooltipPosition="right">
                <input type="radio" class="mtp-radio" [name]="radioName"
                       [checked]="estaSeleccionado(fila.node.id)"
                       [disabled]="fila.node.manageable === false"
                       (change)="seleccionar(fila.node)"
                       [attr.aria-label]="'Ubicar dentro de ' + fila.node.label" />
                <span class="material-symbols-outlined mtp-nodo-icon" aria-hidden="true">
                  {{ fila.node.icon || 'folder' }}
                </span>
                <span class="mtp-nodo-label">{{ fila.node.label }}</span>
                @if (fila.node.manageable === false) {
                  <span class="material-symbols-outlined mtp-nodo-lock" aria-hidden="true">lock</span>
                }
              </label>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .mtp {
      display: flex;
      flex-direction: column;
      gap: 8px;
      border: 1px solid var(--slate-200);
      border-radius: 12px;
      background: var(--surface);
      padding: 8px;
      min-width: 0;
    }

    .mtp-buscador {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      border: 1px solid var(--slate-200);
      border-radius: 8px;
      background: var(--slate-50);
    }
    .mtp-buscador-icon { font-size: 20px; color: var(--slate-500); flex-shrink: 0; }
    .mtp-buscador-input {
      flex: 1 1 auto;
      min-width: 0;
      border: none;
      background: transparent;
      outline: none;
      font-size: 0.9rem;
      color: var(--text);
    }
    .mtp-buscador-limpiar {
      border: none;
      background: transparent;
      cursor: pointer;
      display: inline-flex;
      color: var(--slate-500);
      padding: 2px;
    }
    .mtp-buscador-limpiar .material-symbols-outlined { font-size: 18px; }

    .mtp-arbol {
      max-height: 320px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .mtp-fila {
      display: flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
    }

    .mtp-chevron {
      flex-shrink: 0;
      width: 24px;
      height: 24px;
      border: none;
      background: transparent;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--slate-500);
      border-radius: 6px;
    }
    .mtp-chevron:hover { background: var(--slate-100, #f1f5f9); }
    .mtp-chevron .material-symbols-outlined { font-size: 20px; }
    .mtp-chevron--vacio { cursor: default; }

    .mtp-nodo {
      flex: 1 1 auto;
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      padding: 6px 8px;
      border-radius: 8px;
      cursor: pointer;
      user-select: none;
    }
    .mtp-nodo:hover { background: var(--slate-50); }
    .mtp-nodo--sel {
      background: color-mix(in srgb, var(--lime) 18%, transparent);
      outline: 1px solid var(--lime);
    }
    .mtp-nodo--sel:hover { background: color-mix(in srgb, var(--lime) 24%, transparent); }
    .mtp-nodo--off {
      cursor: not-allowed;
      opacity: 0.55;
    }
    .mtp-nodo--off:hover { background: transparent; }

    .mtp-radio { accent-color: var(--navy); flex-shrink: 0; }
    .mtp-nodo-icon { font-size: 20px; color: var(--navy); flex-shrink: 0; }
    .mtp-nodo-label {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 0.9rem;
      color: var(--text);
    }
    .mtp-nodo-lock { font-size: 16px; color: var(--slate-400, #94a3b8); flex-shrink: 0; }

    .mtp-estado {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 22px 12px;
      color: var(--muted);
      text-align: center;
    }
    .mtp-estado-icon { font-size: 40px; color: var(--slate-300, #cbd5e1); }
    .mtp-estado p { margin: 0; }
  `],
})
export class ModuleTreePickerComponent {
  private svc = inject(PlacementService);

  /** Nombre único del grupo de radios: evita que dos pickers en la misma página
   *  (p. ej. padre + padre de respuestas en el diálogo) se agrupen entre sí. */
  private static seq = 0;
  readonly radioName = `mtp-radio-${++ModuleTreePickerComponent.seq}`;

  /** Id del nodo elegido (banana-in-box `[(value)]`). */
  private readonly valorSel = signal<string | null>(null);
  @Input() set value(v: string | null) { this.valorSel.set(v ?? null); }
  get value(): string | null { return this.valorSel(); }
  @Output() valueChange = new EventEmitter<string | null>();
  /** Nodo completo elegido (para la vista previa de ruta; evita re-pedir el árbol). */
  @Output() nodeChange = new EventEmitter<ModuleNode | null>();

  readonly nodos = signal<ModuleNode[]>([]);
  readonly cargando = signal(false);
  readonly errorCarga = signal(false);
  readonly filtro = signal('');
  private readonly expandido = signal<ReadonlySet<string>>(new Set());

  /** Árbol aplanado y filtrado, recomputado ante cambios de nodos/filtro/expansión. */
  readonly filas = computed<FilaNodo[]>(() => this.aplanar());

  constructor() {
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.errorCarga.set(false);
    this.svc.moduleTree(true).subscribe({
      next: arbol => {
        this.nodos.set(arbol ?? []);
        this.cargando.set(false);
        this.sincronizarPreseleccion();
      },
      error: () => {
        this.cargando.set(false);
        this.errorCarga.set(true);
      },
    });
  }

  estaSeleccionado(id: string): boolean {
    return this.valorSel() === id;
  }

  seleccionar(n: ModuleNode): void {
    if (n.manageable === false) return;
    this.valorSel.set(n.id);
    this.valueChange.emit(n.id);
    this.nodeChange.emit(n);
  }

  alternar(id: string): void {
    const s = new Set(this.expandido());
    if (s.has(id)) s.delete(id); else s.add(id);
    this.expandido.set(s);
  }

  // ── Interno ──────────────────────────────────────────────────────────

  /**
   * Si al cargar el árbol ya hay un `value` preseleccionado (caso "mover"),
   * expande la ruta hasta él y avisa el nodo por `nodeChange` para que el
   * contenedor pueda pintar la vista previa sin volver a pedir el árbol.
   */
  private sincronizarPreseleccion(): void {
    const id = this.valorSel();
    if (!id) return;
    const ruta = this.rutaHasta(this.nodos(), id);
    if (!ruta) return;
    if (ruta.length > 1) {
      const s = new Set(this.expandido());
      for (let i = 0; i < ruta.length - 1; i++) s.add(ruta[i].id);
      this.expandido.set(s);
    }
    this.nodeChange.emit(ruta[ruta.length - 1]);
  }

  /** Camino raíz→nodo (inclusive) o null si no está. */
  private rutaHasta(nodos: ModuleNode[], id: string): ModuleNode[] | null {
    for (const n of nodos) {
      if (n.id === id) return [n];
      const sub = this.rutaHasta(n.children ?? [], id);
      if (sub) return [n, ...sub];
    }
    return null;
  }

  private aplanar(): FilaNodo[] {
    const q = normalizar(this.filtro());
    const filtrando = q.length > 0;
    const abiertos = this.expandido();
    const filas: FilaNodo[] = [];

    const coincideSubarbol = (n: ModuleNode): boolean => {
      if (normalizar(n.label).includes(q)) return true;
      return (n.children ?? []).some(coincideSubarbol);
    };

    const visitar = (nodos: ModuleNode[], depth: number): void => {
      for (const n of nodos) {
        if (filtrando && !coincideSubarbol(n)) continue;
        const hijos = n.children ?? [];
        const hasChildren = hijos.length > 0;
        // Al filtrar se muestra todo el camino a las coincidencias (ignora colapso).
        const expanded = filtrando ? hasChildren : (hasChildren && abiertos.has(n.id));
        filas.push({ node: n, depth, hasChildren, expanded });
        if (hasChildren && expanded) visitar(hijos, depth + 1);
      }
    };

    visitar(this.nodos(), 0);
    return filas;
  }
}
