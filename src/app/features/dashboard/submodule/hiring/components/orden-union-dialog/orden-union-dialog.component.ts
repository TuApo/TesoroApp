import {  Component, Inject, computed, signal , ChangeDetectionStrategy } from '@angular/core';

import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxChange, MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatBadgeModule } from '@angular/material/badge';
import { MatTooltipModule } from '@angular/material/tooltip';

type Item = { id: number; name: string };

/** Un paquete predefinido: el destinatario y el orden exacto de sus documentos. */
type Paquete = {
  key: string;
  label: string;
  icon: string;
  hint: string;
  order: number[];
};

/**
 * Paquete completo de contratación (superset interno).
 * Incluye tipos que el empalme no lista pero que la temporal sí archiva
 * (entrevista de ingreso, bonificación Ipanema, psicotécnica).
 */
const DEFAULT_ORDER: number[] = [
  111,  // FICHA_COMPLETA (el usuario decide si la deja o usa la técnica)
  34,   // FICHA_TECNICA
  29,   // CEDULA
  6,    // POLICIVOS
  3,    // PROCURADURIA
  4,    // CONTRALORIA
  5,    // OFAC
  103,  // ENTREVISTA_INGRESO
  32,   // EXAMENES_MEDICOS
  107,  // COLINESTERASA
  112,  // AUTORIZACION_INGRESO
  25,   // CONTRATO
  104,  // CONTRATOS_OTROS_SI
  30,   // ARL
  27,   // ENTREGA_DE_DOCUMENTOS
  46,   // MANEJO_IMAGEN
  26,   // AUTORIZACION_TRATAMIENTOS_DE_DATOS
  102,  // CARNET
  113,  // BONIFICACION_IPANEMA
  114,  // PRUEBA_PSICOTECNICA
  7,    // ADRES
  8,    // SISBEN (el empalme lo llama "RUI")
  11,   // AFP
  33,   // SEMANAS_COTIZADAS (historia laboral)
  212,  // FORMATO_RESULTADO_PRUEBA_VALANTI
  28,   // HOJA_DE_VIDA_M
  16,   // REFERENCIA_PERSONAL
  17,   // REFERENCIA_FAMILIAR
  86,   // REFERENCIA_LABORAL
  101,  // CERTIFICADOS_ESTUDIOS
  20,   // PRUEBA_LECTRO_ESCRITURA
  31,   // FIGURA_HUMANA
  91,   // SST
  115,  // OTRAS_PRUEBAS
  36,   // EPS
  37,   // CAJA
  38,   // PAGO_SEGURIDAD_SOCIAL
];

/**
 * Columna "TEMPORAL (Archivo)" del empalme V12 — los 30 ítems, en su orden.
 * Los ítems 11 y 12 del empalme (acuerdo de imagen / derechos de imagen)
 * comparten el tipo 46, así que aparece una sola vez.
 */
const ARCHIVO_ORDER: number[] = [
  111, 34,    //  1 FICHA INTEGRAL
  29,         //  2 Cédula al 150%
  3,          //  3 Antecedentes Procuraduría
  4,          //  4 Antecedentes Contraloría
  5,          //  5 Ofac / Lista Clinton
  6,          //  6 Antecedentes policivos
  7,          //  7 Adres o Fosyga
  8,          //  8 RUI (= Sisbén)
  112,        //  9 Autorización de Ingreso
  25, 104,    // 10 Contrato Laboral (+ otrosí)
  46,         // 11-12 Autorizaciones de uso de imagen
  27,         // 13 Entrega de documentos y autorizaciones
  30,         // 14 ARL
  32,         // 15 Examen de Salud Ocupacional (Original)
  107,        // 16 Colinesterasa y paraclínicos
  11,         // 17 AFP - RUAF - Afiliación AFP
  33,         // 18 Historia Laboral (semanas cotizadas)
  212,        // 19 Formato resultado prueba Valanti
  28,         // 20 Hoja de Vida con foto
  16, 17, 86, // 21 Referencias (1 personal, 1 familiar, 2 laborales)
  101,        // 22 Diplomas y certificados de estudio
  20,         // 23 Prueba de Lectoescritura
  31,         // 24 Figura Humana
  91,         // 25 Evaluación SST
  114, 115,   // 26 Otras Pruebas
  26,         // 27 Autorización TTO de Datos
  37,         // 28 Afiliación CCF
  36,         // 29 Afiliación EPS
  38,         // 30 Planilla Pago Seguridad
];

/** Columna "SCANER CENTRO DE COSTO USUARIA - FINCA" del empalme V12 — 19 ítems. */
const FINCA_ORDER: number[] = [
  111, 34,   //  1 FICHA INTEGRAL
  29,        //  2 Cédula al 150%
  3,         //  3 Antecedentes Procuraduría
  4,         //  4 Antecedentes Contraloría
  5,         //  5 Ofac / Lista Clinton
  6,         //  6 Antecedentes policivos
  7,         //  7 Adres
  8,         //  8 Sisbén
  112,       //  9 Autorización de Ingreso
  25, 104,   // 10 Contrato Laboral (+ otrosí)
  46,        // 11-12 Autorizaciones de uso de imagen
  27,        // 13 Entrega de documentos (Una Huella)
  30,        // 14 ARL
  32,        // 15 Examen de Salud Ocupacional (Original)
  107,       // 16 Colinesterasa y paraclínicos
  11,        // 17 AFP - RUAF - Afiliación AFP
  33,        // 18 Historia Laboral (semanas cotizadas)
  212,       // 19 Formato resultado prueba Valanti
];

/** Columna "TRABAJADOR" del empalme V12 — lo que se lleva la persona. */
const TRABAJADOR_ORDER: number[] = [
  25, 104,   // 1 Contrato Laboral (+ otrosí)
  27,        // 2 Formato Entrega de Documentos y Autorizaciones
  32,        // 3 Examen de salud Ocupacional (Copia)
  46,        // 4-5 Autorizaciones de uso de imagen
  102,       // 6 Carnet diligenciado y con foto
];

/** Columna "TRABAJADOR (FINCA)" del empalme V12 — lo que presenta al llegar a la finca. */
const TRABAJADOR_FINCA_ORDER: number[] = [
  111, 34,   // 1 FICHA INTEGRAL
  98,        // 2 FICHA SOCIAL (ELITE)
  29,        // 3 Cédula al 150%
  30,        // 4 ARL
];

/** Paquetes ofrecidos en el diálogo, en el orden en que se muestran. */
const PAQUETES: readonly Paquete[] = [
  {
    key: 'completo',
    label: 'Completo',
    icon: 'all_inbox',
    hint: 'Paquete completo de contratación (superset interno)',
    order: DEFAULT_ORDER,
  },
  {
    key: 'archivo',
    label: 'Al archivo',
    icon: 'inventory_2',
    hint: 'Empalme V12 · TEMPORAL (Archivo) — 30 ítems',
    order: ARCHIVO_ORDER,
  },
  {
    key: 'finca',
    label: 'A la finca',
    icon: 'agriculture',
    hint: 'Empalme V12 · Scáner centro de costo usuaria-finca — 19 ítems',
    order: FINCA_ORDER,
  },
  {
    key: 'trabajador',
    label: 'Al trabajador',
    icon: 'person',
    hint: 'Empalme V12 · TRABAJADOR — 6 ítems',
    order: TRABAJADOR_ORDER,
  },
  {
    key: 'trabajador-finca',
    label: 'Al trabajador (finca)',
    icon: 'badge',
    hint: 'Empalme V12 · TRABAJADOR (FINCA) — 4 ítems',
    order: TRABAJADOR_FINCA_ORDER,
  },
];

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

  /** Paquetes predefinidos (empalme V12) */
  readonly paquetes = PAQUETES;

  /** Paquete aplicado actualmente; null si el usuario ya tocó la lista a mano */
  readonly activePackage = signal<string | null>(null);

  /** Contador seleccionado */
  readonly selectedCount = computed(() => this.selected().size);

  /**
   * Posición final de cada ID seleccionado, siguiendo el ORDEN VISUAL de la lista.
   * Es la misma fuente de verdad que usa `confirmar()`, así que el número del
   * badge es literalmente la posición en la que quedará dentro del PDF unido.
   */
  private readonly orderMap = computed(() => {
    const s = this.selected();
    const map = new Map<number, number>();
    let pos = 0;
    for (const it of this.items()) {
      if (s.has(it.id)) map.set(it.id, ++pos);
    }
    return map;
  });

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
    this.activePackage.set(null);
  }

  toggleSelection(id: number, event: MatCheckboxChange) {
    const s = new Set(this.selected());
    event.checked ? s.add(id) : s.delete(id);
    this.selected.set(s);
    this.activePackage.set(null);
  }

  /** Número de orden 1..n basado en el ORDEN VISUAL de la lista */
  badgeNumber(id: number): string {
    return String(this.orderMap().get(id) ?? '');
  }

  selectAll() {
    this.selected.set(new Set(this.items().map(i => i.id)));
    this.activePackage.set(null);
  }

  clearAll() {
    this.selected.set(new Set());
    this.activePackage.set(null);
  }

  resetOrder() {
    this.items.set(this.initialOrder.map(a => ({ ...a })));
    this.selected.set(new Set<number>(this.initialOrder.map(a => a.id)));
    this.activePackage.set(null);
  }

  /**
   * Cuántos documentos del paquete existen realmente en el catálogo consultado.
   * Si el backend no expone alguno de los tipos, el paquete no puede incluirlo
   * y conviene que el operador lo vea antes de confirmar.
   */
  disponibles(p: Paquete): string {
    const ids = new Set(this.items().map(i => i.id));
    const hay = p.order.filter(id => ids.has(id)).length;
    return `${hay} de ${p.order.length}`;
  }

  /** Aplica un paquete: reordena y selecciona solo los IDs del paquete */
  applyPaquete(p: Paquete) {
    const all = this.items();
    const orderIndex = new Map(p.order.map((id, idx) => [id, idx]));
    const inPackage = all.filter(a => orderIndex.has(a.id));
    const notInPackage = all.filter(a => !orderIndex.has(a.id));

    inPackage.sort((a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0));

    this.items.set([...inPackage, ...notInPackage]);
    this.selected.set(new Set<number>(inPackage.map(a => a.id)));
    this.activePackage.set(p.key);
  }

  cancelar() {
    this.dialogRef.close();
  }

  confirmar() {
    // Devolvemos los IDs en el ORDEN VISUAL de la lista: es lo que el operador
    // ve, lo que arrastra y lo que muestra el badge. (Antes se devolvía el orden
    // de inserción del Set, así que arrastrar no cambiaba el PDF final.)
    const s = this.selected();
    this.dialogRef.close(this.items().filter(i => s.has(i.id)).map(i => i.id));
  }
}
