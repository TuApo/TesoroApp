import { Component, OnInit, ChangeDetectionStrategy, ViewChild, signal, computed } from '@angular/core';
import { SharedModule } from '@/app/shared/shared.module';
import { ModulosService, ModuloCreateDTO } from '../../services/modulos/modulos.service';
import { MatTree, MatTreeModule } from '@angular/material/tree';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { ChangeDetectorRef } from '@angular/core';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDialog } from '@angular/material/dialog';
import { ModuloDialogComponent } from './components/modulo-dialog/modulo-dialog.component';
import Swal from 'sweetalert2';

interface ModuloNode {
  id: string;
  nombre: string;
  ruta?: string | null;
  icono?: string | null;
  orden?: number;
  modulo_padre?: string | null;
  submodulos?: ModuloNode[];
}

@Component({
  selector: 'app-gestion-modulos',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule, MatTreeModule, MatIconModule, MatButtonModule, MatProgressBarModule],
  templateUrl: './gestion-modulos.component.html',
  styleUrl: './gestion-modulos.component.css'
})
export class GestionModulosComponent implements OnInit {
  @ViewChild(MatTree, { static: true }) tree!: MatTree<ModuloNode>;

  allData = signal<ModuloNode[]>([]);
  loading = signal(false);
  searchTerm = signal('');

  /** El árbol visible deriva de los datos + la búsqueda; no hay que sincronizarlo a mano. */
  dataSource = computed<ModuloNode[]>(() => {
    const term = this.searchTerm();
    const data = this.allData();
    return term ? this.filterTree(data, term) : data;
  });

  constructor(
    private modulosService: ModulosService,
    private cdr: ChangeDetectorRef,
    private dialog: MatDialog
  ) { }

  ngOnInit(): void { this.cargar(); }

  childrenAccessor = (node: ModuloNode) => node.submodulos ?? [];
  hasChild = (_: number, node: ModuloNode) => !!node.submodulos && node.submodulos.length > 0;

  cargar(): void {
    this.loading.set(true);
    this.modulosService.tree().subscribe({
      next: (modulos: any) => {
        this.allData.set(Array.isArray(modulos) ? modulos : []);
        this.loading.set(false);
        this.expandAllSoon();
      },
      error: () => {
        this.loading.set(false);
        Swal.fire({ icon: 'error', title: 'Error', text: 'Error cargando módulos' });
      }
    });
  }

  // ===== Stats (para tira informativa) =====
  totalModulos = computed(() => this.countNodes(this.allData()));
  modulosRaiz = computed(() => this.allData().length);
  profundidadMax = computed(() => this.depth(this.allData(), 0));

  private countNodes(nodes: ModuloNode[]): number {
    return nodes.reduce((acc, n) => acc + 1 + this.countNodes(n.submodulos ?? []), 0);
  }
  private depth(nodes: ModuloNode[], current: number): number {
    if (!nodes.length) return current;
    return Math.max(...nodes.map(n => this.depth(n.submodulos ?? [], current + 1)));
  }

  // ===== Búsqueda inline =====
  onSearch(value: string): void {
    this.searchTerm.set((value || '').trim().toLowerCase());
    this.expandAllSoon();
  }

  limpiarBusqueda(): void {
    this.searchTerm.set('');
    this.expandAllSoon();
  }

  private filterTree(nodes: ModuloNode[], term: string): ModuloNode[] {
    const out: ModuloNode[] = [];
    for (const n of nodes) {
      const matchSelf =
        (n.nombre || '').toLowerCase().includes(term) ||
        (n.ruta || '').toLowerCase().includes(term);
      const childrenFiltered = n.submodulos?.length ? this.filterTree(n.submodulos, term) : [];
      if (matchSelf || childrenFiltered.length) {
        out.push({ ...n, submodulos: matchSelf ? n.submodulos : childrenFiltered });
      }
    }
    return out;
  }

  /** Expande todo el árbol apenas se haya renderizado */
  private expandAllSoon(): void {
    queueMicrotask(() => {
      if (!this.tree) return;
      const anyTree = this.tree as any;
      if (typeof anyTree.expandAll === 'function') {
        anyTree.expandAll();
      } else {
        this.expandNodesRec(this.dataSource());
      }
      // La expansión del árbol es imperativa (no pasa por signals): hay que pedir el repintado.
      this.cdr.markForCheck();
    });
  }

  private expandNodesRec(nodes: ModuloNode[]): void {
    const anyTree = this.tree as any;
    for (const n of nodes) {
      if (this.hasChild(0, n)) {
        if (typeof anyTree.expand === 'function') anyTree.expand(n);
        if (n.submodulos?.length) this.expandNodesRec(n.submodulos);
      }
    }
  }

  // ===== CRUD (Optimistic UI) =====
  async crear(parent?: ModuloNode): Promise<void> {
    const nextOrden = this.nextOrdenForParent(parent?.id ?? null);
    const vals = await this.promptModulo({
      title: parent ? 'Nuevo submódulo' : 'Nuevo módulo',
      parentName: parent?.nombre,
      parentRuta: parent?.ruta ?? null,
      orden: nextOrden,
      autoOrden: true
    });
    if (!vals) return;

    const tmpId = `tmp-${Date.now()}`;
    const nuevo: ModuloNode = {
      id: tmpId,
      nombre: vals.nombre,
      ruta: vals.ruta || null,
      icono: vals.icono || 'widgets',
      orden: vals.orden ?? nextOrden,
      modulo_padre: parent?.id ?? null,
      submodulos: []
    };

    this.allData.update(d => this.withInsertedChild(d, parent?.id ?? null, nuevo));
    this.flashNode(tmpId);

    const dto: ModuloCreateDTO = {
      nombre: vals.nombre,
      ruta: vals.ruta || null,
      icono: vals.icono || 'widgets',
      orden: vals.orden ?? nextOrden,
      modulo_padre: parent?.id ?? null
    };

    this.modulosService.create(dto).subscribe({
      next: (real) => {
        this.allData.update(d => this.withUpdatedNode(d, tmpId, n => ({ ...n, id: real.id })));
        this.expandAllSoon();
        this.flashNode(real.id);
        Swal.fire({ icon: 'success', title: 'Creado', text: 'Módulo creado correctamente', timer: 1500, showConfirmButton: false });
      },
      error: (err) => {
        this.allData.update(d => this.withDeletedNode(d, tmpId));
        const msg = err?.error?.nombre?.[0] || err?.error?.detail || 'Error creando el módulo';
        Swal.fire({ icon: 'error', title: 'Error', text: msg });
      }
    });
  }

  async editar(node: ModuloNode): Promise<void> {
    const original: ModuloNode = { ...node };
    const padre = node.modulo_padre ? this.findNode(this.allData(), node.modulo_padre) : null;
    const vals = await this.promptModulo({
      title: 'Editar módulo',
      parentName: padre?.nombre,
      parentRuta: padre?.ruta ?? null,
      nombre: node.nombre,
      ruta: node.ruta ?? '',
      icono: node.icono ?? 'widgets',
      orden: node.orden ?? 0,
      autoOrden: false
    });
    if (!vals) return;

    this.allData.update(d => this.withUpdatedNode(d, node.id, n => ({
      ...n,
      nombre: vals.nombre,
      ruta: vals.ruta || null,
      icono: vals.icono || 'widgets',
      orden: vals.orden ?? 0
    })));
    this.flashNode(node.id);

    const dto: ModuloCreateDTO = {
      nombre: vals.nombre,
      ruta: vals.ruta || null,
      icono: vals.icono || 'widgets',
      orden: vals.orden ?? 0,
      modulo_padre: node.modulo_padre ?? null
    };

    this.modulosService.update(node.id, dto).subscribe({
      next: () => {
        this.expandAllSoon();
        this.flashNode(node.id);
        Swal.fire({ icon: 'success', title: 'Actualizado', text: 'Módulo actualizado', timer: 1500, showConfirmButton: false });
      },
      error: (err) => {
        this.allData.update(d => this.withUpdatedNode(d, node.id, _ => original));
        const msg = err?.error?.nombre?.[0] || err?.error?.detail || 'Error actualizando el módulo';
        Swal.fire({ icon: 'error', title: 'Error', text: msg });
      }
    });
  }

  eliminar(node: ModuloNode): void {
    const parentId = this.findParentId(this.allData(), node.id);

    Swal.fire({
      icon: 'warning',
      title: 'Eliminar módulo',
      text: `¿Eliminar "${node.nombre}"? Esta acción no se puede deshacer.`,
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    }).then(res => {
      if (!res.isConfirmed) return;

      const snapshot = node;
      this.allData.update(d => this.withDeletedNode(d, node.id));

      this.modulosService.remove(node.id).subscribe({
        next: () => {
          Swal.fire({ icon: 'success', title: 'Eliminado', text: 'Módulo eliminado', timer: 1500, showConfirmButton: false });
        },
        error: (err) => {
          this.allData.update(d => this.withInsertedChild(d, parentId, snapshot));
          const msg = err?.error?.detail || 'No se pudo eliminar (revise dependencias)';
          Swal.fire({ icon: 'error', title: 'Error', text: msg });
        }
      });
    });
  }

  // ===== UI helpers =====
  countHijos(node: ModuloNode): number {
    return node.submodulos?.length ?? 0;
  }

  private flashNode(id: string) {
    setTimeout(() => {
      const el = document.querySelector(`[data-node-id="${id}"]`) as HTMLElement | null;
      if (!el) return;
      el.classList.add('flash');
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      setTimeout(() => el.classList.remove('flash'), 1200);
    }, 0);
  }

  private nextOrdenForParent(parentId: string | null): number {
    const siblings = parentId == null
      ? this.allData()
      : (this.findNode(this.allData(), parentId)?.submodulos ?? []);
    if (!siblings.length) return 0;
    return Math.max(...siblings.map(s => s.orden ?? 0)) + 1;
  }

  private findNode(nodes: ModuloNode[], id: string): ModuloNode | null {
    for (const n of nodes) {
      if (n.id === id) return n;
      if (n.submodulos?.length) {
        const f = this.findNode(n.submodulos, id);
        if (f) return f;
      }
    }
    return null;
  }

  // ===== Árbol helpers =====
  private withInsertedChild(nodes: ModuloNode[], parentId: string | null, child: ModuloNode): ModuloNode[] {
    if (parentId == null) return [...nodes, child];
    let changed = false;
    const out = nodes.map(n => {
      if (n.id === parentId) { changed = true; return { ...n, submodulos: [...(n.submodulos ?? []), child] }; }
      if (n.submodulos?.length) {
        const ns = this.withInsertedChild(n.submodulos, parentId, child);
        if (ns !== n.submodulos) { changed = true; return { ...n, submodulos: ns }; }
      }
      return n;
    });
    return changed ? out : nodes;
  }

  private withUpdatedNode(nodes: ModuloNode[], id: string, updater: (n: ModuloNode) => ModuloNode): ModuloNode[] {
    let changed = false;
    const walk = (arr: ModuloNode[]): ModuloNode[] =>
      arr.map(n => {
        if (n.id === id) { changed = true; return updater(n); }
        if (n.submodulos?.length) {
          const ns = walk(n.submodulos);
          if (ns !== n.submodulos) { changed = true; return { ...n, submodulos: ns }; }
        }
        return n;
      });
    const res = walk(nodes);
    return changed ? res : nodes;
  }

  private withDeletedNode(nodes: ModuloNode[], id: string): ModuloNode[] {
    let changed = false;
    const walk = (arr: ModuloNode[]): ModuloNode[] => {
      const next: ModuloNode[] = [];
      for (const n of arr) {
        if (n.id === id) { changed = true; continue; }
        if (n.submodulos?.length) {
          const ns = walk(n.submodulos);
          if (ns !== n.submodulos) { changed = true; next.push({ ...n, submodulos: ns }); continue; }
        }
        next.push(n);
      }
      return next;
    };
    const res = walk(nodes);
    return changed ? res : nodes;
  }

  private findParentId(nodes: ModuloNode[], id: string, parent: string | null = null): string | null {
    for (const n of nodes) {
      if (n.id === id) return parent;
      if (n.submodulos?.length) {
        const found = this.findParentId(n.submodulos, id, n.id);
        if (found !== null) return found;
      }
    }
    return null;
  }

  private async promptModulo(initial: {
    title: string;
    parentName?: string;
    parentRuta?: string | null;
    nombre?: string;
    ruta?: string;
    icono?: string;
    orden?: number;
    autoOrden?: boolean;
  }): Promise<{ nombre: string; ruta?: string; icono?: string; orden?: number } | null> {
    const dialogRef = this.dialog.open(ModuloDialogComponent, {
      width: '560px',
      maxWidth: '95vw',
      panelClass: 'sf-filters-dialog-panel',
      backdropClass: 'sf-filters-backdrop',
      disableClose: true,
      autoFocus: 'first-tabbable',
      data: initial
    });

    const result = await dialogRef.afterClosed().toPromise();
    return result || null;
  }
}
