import {
  ChangeDetectionStrategy, Component, ElementRef, OnInit, computed, inject, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ejecutarEnLote, type ResultadoLote } from '../../utils/lote';
import type { FichaRegistro } from './tabla.revision';
import type { AccionMasiva, ContextoLote, ResultadoAccionMasiva, TextoMasivo } from './tabla.tipos';

/** Nombre, id y foto de una fila: lo que se enseña en el carrusel. */
export type ResumenFila = Pick<FichaRegistro, 'nombre' | 'id' | 'portada'>;

/** Lo que la tabla le pasa al diálogo. */
export interface DatosAccionMasiva<T = any, C = unknown> {
  accion: AccionMasiva<T, C>;
  /** Las filas marcadas sobre las que aplica la acción, en el orden de la tabla. */
  filas: T[];
  /** Resumen de cada fila, en el mismo orden. */
  fichas: ResumenFila[];
  titulo: string;
  modulo: string;
  /** Lo que devolvió `preparar`, si la acción lo declaró. */
  datos: C | undefined;
}

/** Lo que devuelve al cerrar (undefined si se canceló antes de empezar). */
export interface CierreAccionMasiva<T = any> extends ResultadoAccionMasiva<T> {
  /** Dejar marcadas solo las que fallaron, para volver a intentarlo. */
  mantenerFallidas: boolean;
}

type Paso = 'confirmar' | 'corriendo' | 'resultado';

/**
 * APLICAR UNA ACCIÓN A LO MARCADO — vista estándar de la plataforma.
 *
 * Tres pasos, siempre iguales: (1) confirmar viendo QUÉ se va a tocar — el
 * carrusel de registros con nombre e id, de donde se puede sacar alguno —,
 * más el motivo o la opción que pida la acción; (2) la ejecución uno a uno,
 * con avance y la posibilidad de parar; (3) el cierre: cuántos salieron,
 * cuáles no, y qué hacer con esos.
 */
@Component({
  selector: 'app-accion-masiva-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatIconModule, MatTooltipModule],
  templateUrl: './accion-masiva-dialog.component.html',
  styleUrl: './accion-masiva-dialog.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccionMasivaDialogComponent<T = any> implements OnInit {
  readonly datos = inject<DatosAccionMasiva<T>>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<AccionMasivaDialogComponent<T>, CierreAccionMasiva<T>>>(MatDialogRef);
  private readonly hostRef = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly accion = this.datos.accion;
  readonly confirmacion = this.accion.confirmar === false ? null : (this.accion.confirmar ?? {});

  readonly paso = signal<Paso>('confirmar');

  /** Fila + su resumen, juntos para poder sacar registros sin desalinear. */
  readonly items = signal<{ fila: T; ficha: ResumenFila }[]>(
    this.datos.filas.map((fila, i) => ({ fila, ficha: this.datos.fichas[i] })));
  readonly total = computed(() => this.items().length);

  readonly nota = signal('');
  readonly notaFaltante = signal(false);
  readonly opciones = computed(() => {
    const op = this.confirmacion?.opciones;
    return op ? op.valores(this.items().map((i) => i.fila)) : [];
  });
  readonly opcion = signal<string | null>(null);

  /** Avance del lote: para pintar «3 de 12 · Nombre». */
  readonly avance = signal({ hechos: 0, fallidos: 0, total: 0, actual: '' });
  readonly porcentaje = computed(() => {
    const a = this.avance();
    return a.total ? Math.round(((a.hechos + a.fallidos) / a.total) * 100) : 0;
  });
  private pararPedido = false;
  readonly parando = signal(false);

  readonly resultado = signal<ResultadoLote<T> | null>(null);
  readonly fallidasResumen = computed<ResumenFila[]>(() => {
    const r = this.resultado();
    if (!r) return [];
    const porFila = new Map(this.items().map((i) => [i.fila, i.ficha]));
    return r.elementosFallidos.map((f) => porFila.get(f) ?? { nombre: this.etiquetaDe(f), id: '', portada: null });
  });
  readonly copiado = signal(false);

  readonly titulo = computed(() => this.texto(this.confirmacion?.titulo) || `${this.accion.etiqueta} ${this.total()}`);
  readonly explicacion = computed(() => this.texto(this.confirmacion?.texto));
  readonly textoBoton = computed(() => this.confirmacion?.boton ?? `${this.accion.etiqueta} ${this.total()}`);
  readonly verbo = this.accion.verbo ?? 'procesada(s)';

  ngOnInit(): void {
    const primera = this.opciones()[0];
    if (primera) this.opcion.set(primera.valor);
    // Sin paso de confirmación (la acción ya lo hizo en `preparar`): a correr.
    if (!this.confirmacion) void this.empezar();
  }

  private texto(t: TextoMasivo<T> | undefined): string {
    if (!t) return '';
    return typeof t === 'function' ? t(this.items().map((i) => i.fila)) : t;
  }

  private etiquetaDe(fila: T): string {
    if (this.accion.etiquetaFila) return this.accion.etiquetaFila(fila);
    const item = this.items().find((i) => i.fila === fila);
    if (!item) return 'registro';
    return item.ficha.id ? `${item.ficha.nombre} (${item.ficha.id})` : item.ficha.nombre;
  }

  /** Iniciales para la miniatura cuando el registro no tiene foto. */
  iniciales(nombre: string): string {
    const partes = nombre.trim().split(/\s+/).slice(0, 2);
    return partes.map((p) => p.charAt(0).toUpperCase()).join('') || '#';
  }

  /** Saca un registro de la tanda antes de confirmar. */
  quitar(i: number): void {
    if (this.paso() !== 'confirmar') return;
    this.items.update((lista) => lista.filter((_, j) => j !== i));
    if (!this.total()) this.cancelar();
  }

  async empezar(): Promise<void> {
    if (this.paso() !== 'confirmar') return;
    if (this.confirmacion?.notaObligatoria && !this.nota().trim()) {
      this.notaFaltante.set(true);
      this.hostRef.nativeElement.querySelector<HTMLElement>('.am-nota textarea')?.focus();
      return;
    }
    const filas = this.items().map((i) => i.fila);
    const contexto: ContextoLote<unknown> = {
      nota: this.nota().trim(),
      opcion: this.opciones().length ? this.opcion() : null,
      datos: this.datos.datos,
    };
    this.paso.set('corriendo');
    this.ref.disableClose = true;
    this.avance.set({ hechos: 0, fallidos: 0, total: filas.length, actual: this.items()[0]?.ficha.nombre ?? '' });
    const r = await ejecutarEnLote(
      filas,
      (f) => this.accion.ejecutar(f, contexto as ContextoLote<any>),
      (f) => this.etiquetaDe(f),
      {
        alAvanzar: (a) => {
          const siguiente = this.items()[a.hechos + a.fallidos]?.ficha.nombre ?? '';
          this.avance.set({ hechos: a.hechos, fallidos: a.fallidos, total: a.total, actual: siguiente });
        },
        cancelado: () => this.pararPedido,
      },
    );
    this.ref.disableClose = false;
    this.resultado.set(r);
    this.paso.set('resultado');
  }

  /** Para después del registro en curso: lo ya hecho, hecho está. */
  parar(): void {
    this.pararPedido = true;
    this.parando.set(true);
  }

  /** Los que fallaron, uno por línea, para revisarlos en otro lado. */
  copiarFallidas(): void {
    const r = this.resultado();
    if (!r?.fallidos.length) return;
    navigator.clipboard?.writeText(r.fallidos.join('\n')).then(() => {
      this.copiado.set(true);
      setTimeout(() => this.copiado.set(false), 2000);
    }).catch(() => undefined);
  }

  cancelar(): void {
    this.ref.close();
  }

  terminar(mantenerFallidas = false): void {
    const r = this.resultado();
    if (!r) { this.ref.close(); return; }
    this.ref.close({
      hechos: r.elementosHechos,
      fallidos: r.elementosFallidos,
      cancelado: r.cancelado,
      mantenerFallidas,
    });
  }
}
