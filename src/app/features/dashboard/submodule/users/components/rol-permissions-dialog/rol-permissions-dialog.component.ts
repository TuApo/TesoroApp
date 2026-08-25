import {
  Component, Inject, ChangeDetectionStrategy, OnInit, signal, computed
} from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';

import { MatSlideToggleModule } from '@angular/material/slide-toggle';

import { MatTableModule } from '@angular/material/table';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';

import { take } from 'rxjs/operators';
import Swal from 'sweetalert2';

import { GestionRolesSService, Rol } from '../../services/gestion-roles/gestion-roles-s.service';
import { PermisosService } from '../../services/permiso/permisos.service';
import { ModulosService } from '../../services/modulos/modulos.service';

export interface RolePermissionsData {
  rol: Rol;
}

/**
 * Permiso tal y como llega de /gestion_admin/modulos/arbol-permisos/.
 *
 * OJO con `accion`: el backend (ModuloService.toConPermisos) la serializa como
 * STRING plano —`"accion": "LEER"`— no como objeto. Este tipo la declaraba solo
 * como `{nombre, etiqueta}`, así que el código hacía `p.accion?.nombre` sobre
 * una cadena: daba undefined, ningún permiso se indexaba y el diálogo salía sin
 * un solo interruptor. Se aceptan las dos formas para no depender de que
 * backend y frontend se desplieguen a la vez.
 */
export interface PermisoNode {
  id: string;
  nombre: string;                   // p.ej. "COMERCIALIZADORA:LEER"
  accion?: string | { nombre?: string; etiqueta?: string } | null;
}

/** Nodo de módulo según tu JSON real */
export interface NodoModulo {
  id: string;
  nombre: string;
  descripcion?: string | null;
  submodulos?: NodoModulo[];
  permisos?: PermisoNode[];
}

/** Acciones manejadas en UI */
type ActionCanonical = 'LEER' | 'CREAR' | 'ACTUALIZAR' | 'ELIMINAR';

/** Filas de la tabla (ahora con level para indentar y elegir icono) */
type TableGroupRow = { kind: 'group'; id: string; titulo: string; level: number };
type TableDataRow = {
  kind: 'data';
  modulo_id: string;
  modulo_nombre: string;
  level: number;
  LEER: boolean;
  CREAR: boolean;
  ACTUALIZAR: boolean;
  ELIMINAR: boolean;
};

@Component({
  selector: 'app-rol-permissions-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatTableModule,
    MatCheckboxModule,
    MatSlideToggleModule, // Added
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    MatDividerModule,
  ],
  templateUrl: './rol-permissions-dialog.component.html',
  styleUrl: './rol-permissions-dialog.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RolPermissionsDialogComponent implements OnInit {

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: RolePermissionsData,
    private dialogRef: MatDialogRef<RolPermissionsDialogComponent, { ok: boolean } | null>,
    private rolesSvc: GestionRolesSService,
    private permisosSvc: PermisosService,
    private modulosSvc: ModulosService,
    @Inject(DOCUMENT) private document: Document,
  ) { }

  // --------- Estado UI ---------
  loading = signal(true);
  saving = signal(false);

  // --------- Datos base (árbol y selección actual) ---------
  private tree = signal<NodoModulo[]>([]);
  private selected = signal<Set<string>>(new Set<string>()); // IDs de permisos del rol

  // Computed count of LEAF MODULES that have at least one permission active
  selectedModulesCount = computed(() => {
    return this.rows().filter(r => {
      if (r.kind !== 'data') return false;
      const d = r as TableDataRow;
      return d.LEER || d.CREAR || d.ACTUALIZAR || d.ELIMINAR;
    }).length;
  });

  rootTitle = computed(() => (this.tree() ?? []).map(r => r.nombre).join(' · ') || 'Permisos');
  rolNombre = computed(() => this.data.rol?.nombre || '—');
  // --------- Índices auxiliares ---------
  private readonly ACTIONS: ActionCanonical[] = ['LEER', 'CREAR', 'ACTUALIZAR', 'ELIMINAR'];

  private actionSynonyms: Record<string, ActionCanonical> = {
    'LEER': 'LEER', 'READ': 'LEER', 'VER': 'LEER',
    'CREAR': 'CREAR', 'CREATE': 'CREAR',
    'ACTUALIZAR': 'ACTUALIZAR', 'UPDATE': 'ACTUALIZAR', 'EDITAR': 'ACTUALIZAR',
    'ELIMINAR': 'ELIMINAR', 'DELETE': 'ELIMINAR', 'BORRAR': 'ELIMINAR',
  };

  /** Mapa: modulo_id -> { LEER?: permisoId, ... } (para cualquier nodo, hoja o no) */
  private permsByModule = signal<Map<string, Partial<Record<ActionCanonical, string>>>>(new Map());
  /** Mapa: modulo_id -> nombre (para render en filas data) */
  private moduleNameById = signal<Map<string, string>>(new Map());

  // --------- Tabla ---------
  displayedColumns: Array<'modulo' | 'leer' | 'crear' | 'actualizar' | 'eliminar'> =
    ['modulo', 'leer', 'crear', 'actualizar', 'eliminar'];

  /** Predicados para filas */
  isGroup = (_: number, r: TableGroupRow | TableDataRow) => r?.kind === 'group';
  isData = (_: number, r: TableGroupRow | TableDataRow) => r?.kind === 'data';

  /** Filas calculadas (grupos + hojas) con niveles para indentación */
  rows = computed<(TableGroupRow | TableDataRow)[]>(() => {
    const roots = this.tree() ?? [];
    const sel = this.selected();
    const idx = this.permsByModule();
    const nameById = this.moduleNameById();

    const out: (TableGroupRow | TableDataRow)[] = [];

    const pushDataRow = (modId: string, level: number) => {
      const permMap = idx.get(modId) || {};
      // sólo agregamos fila si tiene al menos una acción soportada
      if (!this.ACTIONS.some(a => !!permMap[a])) return;

      out.push({
        kind: 'data',
        modulo_id: modId,
        modulo_nombre: nameById.get(modId) || '—',
        level,
        LEER: !!(permMap.LEER && sel.has(permMap.LEER)),
        CREAR: !!(permMap.CREAR && sel.has(permMap.CREAR)),
        ACTUALIZAR: !!(permMap.ACTUALIZAR && sel.has(permMap.ACTUALIZAR)),
        ELIMINAR: !!(permMap.ELIMINAR && sel.has(permMap.ELIMINAR)),
      });
    };

    // DFS: todo nodo con hijos -> fila de grupo (título). Sólo hojas -> filas de datos.
    const dfs = (node: NodoModulo, level = 0) => {
      const children = node.submodulos ?? [];
      if (children.length > 0) {
        out.push({ kind: 'group', id: node.id, titulo: node.nombre, level });
        for (const ch of children) {
          if ((ch.submodulos?.length ?? 0) > 0) {
            dfs(ch, level + 1);      // subgrupo
          } else {
            pushDataRow(ch.id, level + 1); // hoja
          }
        }
      } else {
        // raíz sin hijos -> hoja directa
        pushDataRow(node.id, level);
      }
    };

    roots.forEach(r => dfs(r, 0));
    return out;
  });

  ngOnInit(): void {
    // 1) Árbol de módulos con permisos
    this.modulosSvc.treePermisos({ include_empty: true })
      .pipe(take(1))
      .subscribe({
        next: (tree: NodoModulo[] = []) => {
          this.tree.set(tree ?? []);
          this.buildIndexes(tree ?? []);

          // 2) IDs de permisos ya asignados al rol
          this.permisosSvc.getRolePermisoIds(this.data.rol.id)
            .pipe(take(1))
            .subscribe({
              next: (ids: string[]) => {
                this.selected.set(new Set(ids ?? []));
                this.loading.set(false);
              },
              error: () => {
                this.loading.set(false);
                Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudieron cargar los permisos del rol.' });
              }
            });
        },
        error: () => {
          this.loading.set(false);
          Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo cargar el árbol de módulos.' });
        }
      });
  }

  // ---------- Indexación del árbol ----------
  private buildIndexes(roots: NodoModulo[]) {
    const permsMap = new Map<string, Partial<Record<ActionCanonical, string>>>();
    const nameMap = new Map<string, string>();

    const toCanonical = (raw?: string | null): ActionCanonical | undefined => {
      if (!raw) return undefined;
      const key = raw.toString().trim().toUpperCase();
      return this.actionSynonyms[key];
    };

    /**
     * De dónde sacar la acción de un permiso. El backend manda `accion` como
     * string ("LEER"); toleramos también la forma objeto y, como último recurso,
     * el sufijo de `nombre` ("COMERCIALIZADORA:LEER" -> "LEER"), que es como se
     * componen los nombres de permiso.
     */
    const accionDe = (p: PermisoNode): string | undefined => {
      const a = p.accion;
      if (typeof a === 'string' && a.trim()) return a;
      if (a && typeof a === 'object') return a.nombre || a.etiqueta || undefined;
      const tras = p.nombre?.split(':').pop();
      return tras && tras !== p.nombre ? tras : undefined;
    };

    const visit = (n: NodoModulo) => {
      nameMap.set(n.id, n.nombre);

      if (n.permisos?.length) {
        const acc = permsMap.get(n.id) || {};
        for (const p of n.permisos) {
          const can = toCanonical(accionDe(p));
          if (can && this.ACTIONS.includes(can)) acc[can] = p.id;
        }
        permsMap.set(n.id, acc);
      }

      (n.submodulos ?? []).forEach(visit);
    };

    roots.forEach(visit);

    this.permsByModule.set(permsMap);
    this.moduleNameById.set(nameMap);
  }

  // ---------- Helpers ----------
  private getPermId(moduloId: string, action: ActionCanonical): string | undefined {
    return this.permsByModule().get(moduloId)?.[action];
  }

  /** Útil si en el HTML decides mostrar una X cuando la acción no exista */
  hasAction(moduloId: string, action: ActionCanonical): boolean {
    return !!this.getPermId(moduloId, action);
  }

  // ---------- Acciones de UI ----------
  toggleCell(moduloId: string, action: ActionCanonical, checked: boolean) {
    const permId = this.getPermId(moduloId, action);
    if (!permId) {
      // UI should prevent this, but fail silently if forced
      return;
    }
    const next = new Set(this.selected());
    if (checked) next.add(permId); else next.delete(permId);
    this.selected.set(next);
  }

  /** Quitar todos los permisos definidos para ese módulo (solo ese módulo hoja) */
  quitarModulo(moduloId: string) {
    const m = this.permsByModule().get(moduloId) || {};
    const next = new Set(this.selected());
    this.ACTIONS.forEach(a => { const id = m[a]; if (id) next.delete(id); });
    this.selected.set(next);
  }

  // ---------- Guardar ----------
  save() {
    this.saving.set(true);
    const ids = Array.from(this.selected());
    this.permisosSvc.assignPermissions(this.data.rol.id, ids)
      .pipe(take(1))
      .subscribe({
        next: (res: any) => {
          this.saving.set(false);
          Swal.fire({
            icon: 'success',
            title: 'Permisos actualizados',
            text: `Asignados: ${res.total_asignados} / Enviados: ${res.total_recibidos}`
          });
          this.dialogRef.close({ ok: true });
        },
        error: (err: any) => {
          this.saving.set(false);
          Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudieron guardar los permisos.' });
        }
      });
  }

  close() {
    this.dialogRef.close(null);
  }
}
