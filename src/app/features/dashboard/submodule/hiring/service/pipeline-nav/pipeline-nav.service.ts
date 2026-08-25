import { Injectable, signal } from '@angular/core';
import { Avance, pctDe, sumarAvances } from '../../shared/progreso.util';

/** Sub-pestañas que viven dentro del área de trabajo de Selección. */
export type PanelSeleccion = 'entrevista' | 'formacion' | 'remision' | 'ia';

/** Cada bloque que reporta cuánto lleva llenado. */
export type ClaveAvance =
  | 'entrevista'
  | 'formacion'
  | 'antecedentes'
  | 'remision'
  | 'examenes'
  | 'pago'
  | 'obra'
  | 'referencias'
  | 'traslados'
  | 'huella'
  | 'documentos';

/**
 * Estado compartido de los dos railes del pipeline.
 *
 * El pipeline pinta la navegación completa —capa 1 (Selección / Contratación)
 * y capa 2 (los sub-pasos de la que esté abierta)—, pero quien SABE en qué
 * sub-paso va y cuánto lleva llenado cada uno son los hijos, que están dentro
 * de los `mat-tab` y no pueden hablar con el rail por `@Input`/`@Output` sin
 * atravesar tres componentes.
 *
 * Este servicio es ese canal. Se provee en `RecruitmentPipelineComponent`, no
 * en root: es estado de UNA pantalla y tiene que morir con ella.
 */
@Injectable()
export class PipelineNavService {
  /** Sub-pestaña abierta dentro de Selección. La escribe el rail o el hijo. */
  readonly panelSeleccion = signal<PanelSeleccion>('entrevista');

  /** Sub-paso abierto dentro de Contratación (índice del mat-tab-group hijo). */
  readonly subContratacion = signal<number>(0);

  /**
   * Bloque de la ficha que se pidió editar, o `null` cuando no hay nada pedido.
   *
   * La ficha la pinta el pipeline, pero los CAMPOS viven en el formulario de
   * `form-entrevista`, tres componentes más abajo. El lápiz publica aquí qué
   * quiere editar y el dueño del formulario abre el diálogo: es el mismo
   * camino que ya usan el rail y los avances.
   *
   * `'todos'` = la ficha entera; si no, el id del bloque.
   */
  readonly edicionFicha = signal<string | null>(null);

  pedirEdicion(bloque: string): void {
    this.edicionFicha.set(bloque);
  }

  private readonly _avances = signal<Readonly<Partial<Record<ClaveAvance, Avance>>>>({});
  readonly avances = this._avances.asReadonly();

  /**
   * Publica cuánto lleva llenado un bloque.
   *
   * Ignora la republicación idéntica: los formularios emiten `valueChanges` en
   * ráfagas (prellenado desde la vacante, `patchValue` por campo) y sin este
   * corte cada tecleo repintaría los dos railes enteros.
   */
  publicar(clave: ClaveAvance, avance: Avance): void {
    const actual = this._avances()[clave];
    if (actual && actual.hechos === avance.hechos && actual.total === avance.total) return;
    this._avances.update((m) => ({ ...m, [clave]: avance }));
  }

  avance(clave: ClaveAvance): Avance | null {
    return this._avances()[clave] ?? null;
  }

  pct(clave: ClaveAvance): number {
    return pctDe(this._avances()[clave]);
  }

  /** Avance de un paso entero = suma del de sus sub-pasos. */
  agregado(claves: readonly ClaveAvance[]): Avance {
    const m = this._avances();
    return sumarAvances(claves.map((k) => m[k]));
  }

  /** Persona nueva: los contadores del anterior no sirven para nada. */
  reiniciar(): void {
    this._avances.set({});
    this.panelSeleccion.set('entrevista');
    this.subContratacion.set(0);
    this.edicionFicha.set(null);
  }
}
