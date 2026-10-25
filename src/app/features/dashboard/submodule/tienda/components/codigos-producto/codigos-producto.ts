import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

import { EscanerCodigoComponent } from '../../../../../../shared/components/escaner-codigo/escaner-codigo.component';
import { svgCodigoBarras } from '../../../../../../shared/utils/codigo-barras';
import { CodigoProducto, TiendaService } from '../../service/tienda.service';
import { imprimirEtiquetas } from '../../util/etiquetas';

const TIPOS: Record<string, string> = { BARRAS: 'Barras del fabricante', GENERADO: 'Barras interno', INTERNO: 'Código interno', ORIGEN: 'Código del sistema anterior' };

/**
 * Códigos con los que se encuentra el producto en la caja y en los buscadores: barras del
 * fabricante (varios si hay presentaciones), barras internas generadas por la tienda,
 * código interno y el del sistema anterior. Imprime la etiqueta de góndola.
 */
@Component({
  selector: 'app-codigos-producto',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule, EscanerCodigoComponent],
  template: `
    <div class="cp">
      @for (c of codigos(); track c.id) {
        <div class="cp-fila" [class.principal]="c.principal">
          @if (c.tipo === 'BARRAS' || c.tipo === 'GENERADO') { <span class="cp-svg" [innerHTML]="svg(c.codigo)"></span> }
          <div class="cp-datos">
            <span class="mono">{{ c.codigo }}</span>
            <small>{{ TIPOS[c.tipo] || c.tipo }}@if (c.principal) { · principal }</small>
          </div>
          @if ((c.tipo === 'BARRAS' || c.tipo === 'GENERADO') && !c.principal) {
            <button type="button" class="mini" title="Usar como principal" (click)="principal(c)"><mat-icon>star_outline</mat-icon></button>
          }
          @if (c.tipo === 'BARRAS' || c.tipo === 'GENERADO') {
            <button type="button" class="mini" title="Imprimir etiqueta" (click)="etiqueta(c.codigo)"><mat-icon>print</mat-icon></button>
          }
          <button type="button" class="mini" title="Quitar" (click)="quitar(c)"><mat-icon>delete</mat-icon></button>
        </div>
      } @empty { <p class="nota">Sin códigos: no se puede leer con el lector de la caja.</p> }
      <div class="cp-agregar">
        <input [(ngModel)]="nuevo" placeholder="Leer o escribir otro código de barras" (keydown.enter)="agregar()" aria-label="Nuevo código" />
        <app-escaner-codigo (leido)="nuevo = $event; agregar()" />
        <button type="button" class="boton secundario" (click)="agregar()" [disabled]="!nuevo.trim()"><mat-icon>add</mat-icon> Agregar</button>
        <button type="button" class="boton secundario" (click)="generar()" title="EAN-13 interno con prefijo 29 para lo que no trae código"><mat-icon>auto_awesome</mat-icon> Generar código interno</button>
      </div>
      @if (error()) { <p class="mal">{{ error() }}</p> }
    </div>
  `,
  styleUrls: ['../../styles/tienda-comun.css'],
  styles: [`
    .cp { display: flex; flex-direction: column; gap: 8px; }
    .cp-fila { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 10px; flex-wrap: wrap; }
    .cp-fila.principal { border-color: #0b6b58; }
    .cp-svg { width: 150px; height: 44px; display: block; background: #fff; border-radius: 4px; }
    :host ::ng-deep .cp-svg svg { width: 100%; height: 100%; }
    .cp-datos { display: flex; flex-direction: column; flex: 1; min-width: 120px; }
    .cp-datos small { color: var(--muted); }
    .cp-agregar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .cp-agregar input { flex: 1 1 200px; min-width: 0; min-height: 44px; }
    .mono { font-family: ui-monospace, monospace; }
    .mini { display: inline-flex; padding: 6px; border: none; border-radius: 8px; min-height: 0 !important; background: transparent; color: var(--muted); cursor: pointer; }
    .nota { margin: 0; font-size: 13px; color: var(--muted); }
    .mal { color: #b91c1c; margin: 0; font-size: 13px; }
  `],
})
export class CodigosProducto {
  private api = inject(TiendaService);
  private san = inject(DomSanitizer);
  readonly productoId = input.required<string>();
  readonly nombre = input('');
  readonly precio = input<number | null>(null);
  readonly TIPOS = TIPOS;
  readonly codigos = signal<CodigoProducto[]>([]);
  readonly error = signal<string | null>(null);
  nuevo = '';
  private cacheSvg = new Map<string, SafeHtml>();

  constructor() {
    effect(() => { const id = this.productoId(); untracked(() => this.cargar(id)); });
  }

  svg(codigo: string): SafeHtml {
    if (!this.cacheSvg.has(codigo)) this.cacheSvg.set(codigo, this.san.bypassSecurityTrustHtml(svgCodigoBarras(codigo, { alto: 40 })));
    return this.cacheSvg.get(codigo)!;
  }

  private cargar(id: string): void {
    this.api.codigosProducto(id).subscribe({ next: c => this.codigos.set(c), error: () => this.codigos.set([]) });
  }

  agregar(): void {
    const c = this.nuevo.trim();
    if (!c) return;
    const primero = !this.codigos().some(x => x.principal && (x.tipo === 'BARRAS' || x.tipo === 'GENERADO'));
    this.api.agregarCodigo(this.productoId(), { codigo: c, tipo: 'BARRAS', principal: primero }).subscribe({
      next: () => { this.nuevo = ''; this.error.set(null); this.cargar(this.productoId()); },
      error: e => this.error.set(e?.error?.error ?? 'No se pudo agregar el código'),
    });
  }

  principal(c: CodigoProducto): void {
    this.api.agregarCodigo(this.productoId(), { codigo: c.codigo, tipo: c.tipo, principal: true })
      .subscribe({ next: () => this.cargar(this.productoId()), error: e => this.error.set(e?.error?.error ?? 'No se pudo cambiar') });
  }

  quitar(c: CodigoProducto): void {
    if (!confirm(`¿Quitar el código ${c.codigo}? El lector ya no encontrará el producto con él.`)) return;
    this.api.quitarCodigo(this.productoId(), c.id).subscribe({ next: () => this.cargar(this.productoId()) });
  }

  generar(): void {
    this.api.generarCodigo(this.productoId()).subscribe({
      next: () => this.cargar(this.productoId()),
      error: e => this.error.set(e?.error?.error ?? 'No se pudo generar'),
    });
  }

  etiqueta(codigo: string): void {
    imprimirEtiquetas([{ nombre: this.nombre(), precio: this.precio(), codigo }], this.nombre());
  }
}
