import {  Component, Inject, computed, signal , ChangeDetectionStrategy } from '@angular/core';

import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxChange, MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatBadgeModule } from '@angular/material/badge';
import { MatTooltipModule } from '@angular/material/tooltip';

import {
  ORDEN_PAQUETE_COMPLETO,
  ORDEN_PAQUETE_FINCA,
} from '../../shared/orden-empalme.data';

type Item = { id: number; name: string };

/*
 * El orden vive en `shared/orden-empalme.data`: el empalme de UNA persona
 * (módulo Documentos del pipeline) tiene que salir en el MISMO orden que el
 * empalme en lote que se arma desde aquí.
 */
const DEFAULT_ORDER = ORDEN_PAQUETE_COMPLETO;
const FINCA_ORDER = ORDEN_PAQUETE_FINCA;

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-orden-union-dialog',
  imports: [
    MatDialogModule,
    DragDropModule,
    MatButtonModule,
    MatCheckboxModule,
    MatIconModule,
    MatBadgeModule,
    MatTooltipModule
],
  templateUrl: './orden-union-dialog.component.html',
  styleUrl: './orden-union-dialog.component.css'
} )
export class OrdenUnionDialogComponent {
  /** Orden editable en la vista */
  readonly items = signal<Item[]>([]);
  /** Copia para "Restablecer" */
  private readonly initialOrder: Item[] = [];

  /** Selección (IDs incluidos) */
  readonly selected = signal<Set<number>>(new Set<number>());

  /** Contador seleccionado */
  readonly selectedCount = computed(() => this.selected().size);

  constructor(
    public dialogRef: MatDialogRef<OrdenUnionDialogComponent, number[]>,
    @Inject(MAT_DIALOG_DATA) public data: { antecedentes: Item[] }
  ) {
    const raw = (data?.antecedentes ?? []).map(a => ({ ...a }));

    // Reordenar según el paquete por defecto:
    // 1. Los que están en DEFAULT_ORDER van primero, en ese orden
    // 2. Los que no están en DEFAULT_ORDER van al final (en el orden original)
    const orderIndex = new Map(DEFAULT_ORDER.map((id, idx) => [id, idx]));
    const source = [...raw].sort((a, b) => {
      const ia = orderIndex.get(a.id) ?? DEFAULT_ORDER.length;
      const ib = orderIndex.get(b.id) ?? DEFAULT_ORDER.length;
      return ia - ib;
    });

    this.items.set(source);
    this.initialOrder = source.map(a => ({ ...a }));
    // Por defecto: todo seleccionado
    this.selected.set(new Set<number>(source.map(a => a.id)));
  }

  drop(ev: CdkDragDrop<Item[]>) {
    const arr = [...this.items()];
    moveItemInArray(arr, ev.previousIndex, ev.currentIndex);
    this.items.set(arr);
  }

  toggleSelection(id: number, event: MatCheckboxChange) {
    const s = new Set(this.selected());
    event.checked ? s.add(id) : s.delete(id);
    this.selected.set(s);
  }

  /** Número de orden 1..n basado en el ORDEN DE SELECCIÓN */
  badgeNumber(id: number): string {
    const s = this.selected();
    if (!s.has(id)) return '';
    // Convertir Set a Array para obtener índice (orden de inserción)
    const index = [...s].indexOf(id);
    return String(index + 1);
  }

  selectAll() {
    this.selected.set(new Set(this.items().map(i => i.id)));
  }

  clearAll() {
    this.selected.set(new Set());
  }

  resetOrder() {
    this.items.set(this.initialOrder.map(a => ({ ...a })));
    this.selected.set(new Set<number>(this.initialOrder.map(a => a.id)));
  }

  /** Aplica un paquete: reordena y selecciona solo los IDs del paquete */
  private applyPackage(order: readonly number[]) {
    const all = this.items();
    const orderIndex = new Map(order.map((id, idx) => [id, idx]));
    const inPackage = all.filter(a => orderIndex.has(a.id));
    const notInPackage = all.filter(a => !orderIndex.has(a.id));

    inPackage.sort((a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0));

    this.items.set([...inPackage, ...notInPackage]);
    this.selected.set(new Set<number>(inPackage.map(a => a.id)));
  }

  /** Paquete completo de contratación */
  applyDefaultPackage() {
    this.applyPackage(DEFAULT_ORDER);
  }

  /** Paquete por finca (documentos esenciales) */
  applyFincaPackage() {
    this.applyPackage(FINCA_ORDER);
  }

  cancelar() {
    this.dialogRef.close();
  }

  confirmar() {
    // Devolvemos los IDs en el orden en que fueron SELECCIONADOS
    const s = this.selected();
    this.dialogRef.close([...s]);
  }
}
