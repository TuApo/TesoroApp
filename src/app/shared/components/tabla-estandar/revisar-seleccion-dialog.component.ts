import {
  ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { fichaDeRegistro, type FichaRegistro } from './tabla.revision';
import type { AccionMasiva, ColumnaTabla, ValorCelda } from './tabla.tipos';

/** Lo que la tabla le pasa a la vista de revisión. */
export interface DatosRevisarSeleccion<T = any> {
  titulo: string;
  modulo: string;
  filas: T[];
  columnas: ColumnaTabla<T>[];
  /** Escribe fechas con el formato elegido en la tabla. */
  formatoFecha: (v: ValorCelda) => string | null;
  /** Acciones masivas de la pantalla: se pueden lanzar desde aquí («revisar → aplicar»). */
  acciones?: AccionMasiva<T, any>[];
}

/** Lo que devuelve al cerrar: las filas que el operador dejó fuera y, si
 *  eligió una, la acción masiva que quiere correr sobre lo que quedó. */
export interface ResultadoRevision<T = any> {
  descartadas: T[];
  accion?: string;
}

/**
 * REVISAR LA SELECCIÓN — vista estándar de la plataforma.
 *
 * Antes de una acción masiva hay que poder mirar QUÉ se marcó, y una tabla de
 * 8 columnas no lo cuenta todo: faltan las fotos, los soportes y la mitad de
 * los campos. Aquí cada registro se ve entero — foto, documentos y sus datos
 * agrupados por lo que son — y se pasa de uno a otro por el carrusel de
 * arriba, que lleva nombre e id para ubicarse de un vistazo.
 *
 * Lo que se descarta aquí sale de la selección al cerrar: es el último filtro
 * antes de aplicar el cambio masivo.
 */
@Component({
  selector: 'app-revisar-seleccion-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatTooltipModule],
  templateUrl: './revisar-seleccion-dialog.component.html',
  styleUrl: './revisar-seleccion-dialog.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RevisarSeleccionDialogComponent {
  readonly datos = inject<DatosRevisarSeleccion>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<RevisarSeleccionDialogComponent, ResultadoRevision>>(MatDialogRef);

  /** Ficha = uno a uno; mosaico = todos a la vez, para comparar de un vistazo. */
  readonly vista = signal<'ficha' | 'mosaico'>('ficha');
  /** Filtro del carrusel: con 40 marcados, encontrar uno a ojo no es opción. */
  readonly busqueda = signal('');

  /** Las filas que siguen dentro (descartar quita de aquí). */
  readonly filas = signal<any[]>([...this.datos.filas]);
  private readonly descartadas: any[] = [];
  readonly indice = signal(0);
  readonly fotoAbierta = signal<string | null>(null);

  /** Las fichas se calculan una vez por lista, no en cada repintado. */
  readonly fichas = computed<FichaRegistro[]>(() =>
    this.filas().map((f) => fichaDeRegistro(f, this.datos.columnas, this.datos.formatoFecha)));

  readonly actual = computed<FichaRegistro | null>(() => this.fichas()[this.indice()] ?? null);
  readonly total = computed(() => this.filas().length);

  /**
   * Índices que pasan el filtro. Se trabaja con índices y no con fichas sueltas
   * para que «el 3 de 12» siga refiriéndose a la selección completa, no al
   * resultado de la búsqueda.
   */
  readonly visibles = computed<number[]>(() => {
    const q = this.busqueda().trim().toLowerCase();
    const fichas = this.fichas();
    const todos = fichas.map((_, i) => i);
    if (!q) return todos;
    return todos.filter((i) => {
      const f = fichas[i];
      return f.nombre.toLowerCase().includes(q) || f.id.toLowerCase().includes(q);
    });
  });

  /** El buscador solo estorba con pocos registros. */
  readonly conBuscador = computed(() => this.total() > 8);

  /**
   * Acciones con algo sobre lo que actuar entre lo que sigue dentro: revisar
   * y aplicar sin volver a la tabla. El conteo se recalcula al descartar.
   */
  readonly acciones = computed(() => {
    const filas = this.filas();
    return (this.datos.acciones ?? [])
      .map((accion) => ({ accion, cuantas: accion.aplicaA ? filas.filter(accion.aplicaA).length : filas.length }))
      .filter((a) => a.cuantas > 0);
  });

  private readonly hostRef = inject<ElementRef<HTMLElement>>(ElementRef);

  ir(i: number): void {
    const n = this.total();
    if (!n) return;
    this.indice.set(((i % n) + n) % n);
    this.fotoAbierta.set(null);
    this.acercarChipActivo();
  }

  /**
   * El carrusel sigue al registro abierto: si no, al pasar con las flechas la
   * tira se queda atrás y se pierde la referencia de dónde se está.
   */
  private acercarChipActivo(): void {
    requestAnimationFrame(() => {
      const chip = this.hostRef.nativeElement.querySelectorAll<HTMLElement>('.rs-chip')[this.indice()];
      chip?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    });
  }

  anterior(): void { this.ir(this.indice() - 1); }
  siguiente(): void { this.ir(this.indice() + 1); }

  /** Desde el mosaico: abrir la ficha de ese registro. */
  abrirFicha(i: number): void {
    this.vista.set('ficha');
    this.ir(i);
  }

  alternarVista(): void {
    this.vista.update((v) => (v === 'ficha' ? 'mosaico' : 'ficha'));
    if (this.vista() === 'ficha') this.acercarChipActivo();
  }

  /** Resumen corto para la tarjeta del mosaico: lo declarado por la pantalla. */
  resumen(f: FichaRegistro): { etiqueta: string; texto: string }[] {
    const campos = f.grupos.flatMap((g) => g.campos).filter((c) => c.declarado && c.texto && c.texto !== '—');
    return campos.slice(0, 4).map((c) => ({ etiqueta: c.etiqueta, texto: c.texto }));
  }

  /** Saca el registro abierto de la selección (se aplica al cerrar). */
  descartar(): void {
    this.descartarIndice(this.indice());
  }

  /** Saca un registro concreto (desde el mosaico). */
  descartarIndice(i: number, ev?: Event): void {
    ev?.stopPropagation();
    const fila = this.filas()[i];
    if (fila === undefined) return;
    this.descartadas.push(fila);
    this.filas.update((fs) => fs.filter((_, j) => j !== i));
    const n = this.total();
    if (!n) { this.cerrar(); return; }
    // Si se quitó uno anterior al abierto, el abierto corre un puesto.
    const actual = this.indice();
    this.indice.set(Math.min(actual > i ? actual - 1 : actual, n - 1));
  }

  /** Cierra pidiendo a la tabla que corra esa acción sobre lo que quedó. */
  aplicar(id: string): void {
    this.ref.close({ descartadas: this.descartadas, accion: id });
  }

  /** La ficha a texto plano, para pegarla en un correo o un ticket. */
  copiarFicha(): void {
    const f = this.actual();
    if (!f) return;
    const lineas = [`${f.nombre}${f.id ? ` (${f.id})` : ''}`];
    for (const g of f.grupos) {
      lineas.push('', g.titulo.toUpperCase());
      for (const c of g.campos) lineas.push(`${c.etiqueta}: ${c.texto}`);
    }
    if (f.documentos.length) {
      lineas.push('', 'DOCUMENTOS');
      for (const d of f.documentos) lineas.push(`${d.etiqueta}: ${d.url}`);
    }
    navigator.clipboard?.writeText(lineas.join('\n')).catch(() => undefined);
  }

  cerrar(): void {
    this.ref.close({ descartadas: this.descartadas });
  }

  /** Flechas para moverse sin soltar el teclado. */
  alPulsarTecla(ev: KeyboardEvent): void {
    if (this.fotoAbierta()) {
      if (ev.key === 'Escape') { this.fotoAbierta.set(null); ev.stopPropagation(); }
      return;
    }
    if (this.vista() !== 'ficha') return;
    if (ev.key === 'ArrowRight') { this.siguiente(); ev.preventDefault(); }
    if (ev.key === 'ArrowLeft') { this.anterior(); ev.preventDefault(); }
    if (ev.key === 'Home') { this.ir(0); ev.preventDefault(); }
    if (ev.key === 'End') { this.ir(this.total() - 1); ev.preventDefault(); }
  }

  /** Iniciales para la miniatura cuando el registro no tiene foto. */
  iniciales(nombre: string): string {
    const partes = nombre.trim().split(/\s+/).slice(0, 2);
    return partes.map((p) => p.charAt(0).toUpperCase()).join('') || '#';
  }
}
