import { Directive, TemplateRef, inject, input } from '@angular/core';

import type { ContextoFila } from './tabla.tipos';

/**
 * Plantillas que una pantalla puede proyectar dentro de `<app-tabla-estandar>`.
 *
 *   <ng-template tablaCelda="estado" let-fila> … </ng-template>   celda rica
 *   <ng-template tablaAcciones let-fila> … </ng-template>          botones de la fila
 *   <ng-template tablaTarjeta let-fila> … </ng-template>           tarjeta propia
 *   <ng-template tablaEncabezado="estado"> … </ng-template>        extra junto al título
 *   <ng-template tablaVacio> … </ng-template>                      mensaje sin filas
 */
@Directive({ selector: 'ng-template[tablaCelda]', standalone: true })
export class TablaCeldaDirective<T = any> {
  readonly columna = input.required<string>({ alias: 'tablaCelda' });
  readonly tpl = inject<TemplateRef<ContextoFila<T>>>(TemplateRef);

  static ngTemplateContextGuard<T>(_d: TablaCeldaDirective<T>, ctx: unknown): ctx is ContextoFila<T> {
    return true;
  }
}

@Directive({ selector: 'ng-template[tablaAcciones]', standalone: true })
export class TablaAccionesDirective<T = any> {
  readonly tpl = inject<TemplateRef<ContextoFila<T>>>(TemplateRef);

  static ngTemplateContextGuard<T>(_d: TablaAccionesDirective<T>, ctx: unknown): ctx is ContextoFila<T> {
    return true;
  }
}

@Directive({ selector: 'ng-template[tablaTarjeta]', standalone: true })
export class TablaTarjetaDirective<T = any> {
  readonly tpl = inject<TemplateRef<ContextoFila<T>>>(TemplateRef);

  static ngTemplateContextGuard<T>(_d: TablaTarjetaDirective<T>, ctx: unknown): ctx is ContextoFila<T> {
    return true;
  }
}

@Directive({ selector: 'ng-template[tablaEncabezado]', standalone: true })
export class TablaEncabezadoDirective {
  readonly columna = input.required<string>({ alias: 'tablaEncabezado' });
  readonly tpl = inject<TemplateRef<unknown>>(TemplateRef);
}

@Directive({ selector: 'ng-template[tablaVacio]', standalone: true })
export class TablaVacioDirective {
  readonly tpl = inject<TemplateRef<unknown>>(TemplateRef);
}
