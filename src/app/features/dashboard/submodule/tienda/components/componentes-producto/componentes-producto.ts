import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { Producto, TiendaService } from '../../service/tienda.service';

interface Linea { componente_id: string; nombre: string; cantidad: number }

/**
 * Paquete o presentación compuesta: el six pack se vende como un producto, pero descuenta
 * 6 unidades de la lata del inventario. Lista vacía = producto normal.
 */
@Component({
  selector: 'app-componentes-producto',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule],
  template: `
    <div class="cp">
      @for (l of lineas(); track l.componente_id; let i = $index) {
        <div class="cp-fila">
          <span class="cp-nombre">{{ l.nombre }}</span>
          <input type="number" min="0.001" step="1" [ngModel]="l.cantidad" (ngModelChange)="cantidad(i, $event)" aria-label="Cantidad" />
          <span class="nota">unidades por paquete</span>
          <button type="button" class="mini" (click)="quitar(i)" aria-label="Quitar"><mat-icon>close</mat-icon></button>
        </div>
      } @empty { <p class="nota">No es un paquete: se descuenta él mismo del inventario.</p> }
      <div class="cp-buscar">
        <input [(ngModel)]="texto" (ngModelChange)="buscar()" placeholder="Buscar el producto que contiene (nombre o código)" aria-label="Buscar componente" />
      </div>
      @if (resultados().length) {
        <ul class="cp-res">@for (r of resultados(); track r.id) { <li><button type="button" (click)="agregar(r)">{{ r.nombre }} <small>{{ r.sku }}</small></button></li> }</ul>
      }
      @if (cambiado()) { <button type="button" class="boton" (click)="guardar()"><mat-icon>save</mat-icon> Guardar paquete</button> }
      @if (mensaje()) { <p class="nota">{{ mensaje() }}</p> }
    </div>
  `,
  styleUrls: ['../../styles/tienda-comun.css'],
  styles: [`
    .cp { display: flex; flex-direction: column; gap: 8px; }
    .cp-fila { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .cp-nombre { flex: 1 1 200px; font-weight: 600; }
    .cp-fila input { width: 90px; }
    .cp-buscar input { width: 100%; min-height: 44px; }
    .cp-res { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; max-height: 220px; overflow: auto; }
    .cp-res button { width: 100%; text-align: left; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); padding: 8px; cursor: pointer; }
    .cp-res small { color: var(--muted); }
    .nota { margin: 0; font-size: 13px; color: var(--muted); }
    .mini { display: inline-flex; padding: 6px; border: none; border-radius: 8px; min-height: 0 !important; background: transparent; color: var(--muted); cursor: pointer; }
  `],
})
export class ComponentesProducto {
  private api = inject(TiendaService);
  readonly productoId = input.required<string>();
  readonly lineas = signal<Linea[]>([]);
  readonly resultados = signal<Producto[]>([]);
  readonly cambiado = signal(false);
  readonly mensaje = signal<string | null>(null);
  texto = '';
  private reloj: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => { const id = this.productoId(); untracked(() => this.cargar(id)); });
  }

  private async cargar(id: string): Promise<void> {
    this.cambiado.set(false); this.mensaje.set(null);
    try {
      const cs = await firstValueFrom(this.api.componentesProducto(id));
      const lineas: Linea[] = [];
      for (const c of cs) {
        let nombre = c.componente_id;
        try { nombre = (await firstValueFrom(this.api.producto(c.componente_id))).nombre; } catch { /* id */ }
        lineas.push({ componente_id: c.componente_id, nombre, cantidad: Number(c.cantidad) });
      }
      this.lineas.set(lineas);
    } catch { this.lineas.set([]); }
  }

  buscar(): void {
    if (this.reloj) clearTimeout(this.reloj);
    const q = this.texto.trim();
    if (q.length < 2) { this.resultados.set([]); return; }
    this.reloj = setTimeout(() => this.api.productos({ texto: q, tamano: 10 }).subscribe({
      next: p => this.resultados.set(p.content.filter(x => x.id !== this.productoId())), error: () => {},
    }), 250);
  }

  agregar(p: Producto): void {
    if (!this.lineas().some(l => l.componente_id === p.id)) this.lineas.update(l => [...l, { componente_id: p.id, nombre: p.nombre, cantidad: 1 }]);
    this.texto = ''; this.resultados.set([]); this.cambiado.set(true);
  }
  cantidad(i: number, v: number): void { this.lineas.update(l => l.map((x, j) => j === i ? { ...x, cantidad: Number(v) } : x)); this.cambiado.set(true); }
  quitar(i: number): void { this.lineas.update(l => l.filter((_, j) => j !== i)); this.cambiado.set(true); }

  guardar(): void {
    this.api.fijarComponentes(this.productoId(), this.lineas().map(l => ({ componente_id: l.componente_id, cantidad: l.cantidad }))).subscribe({
      next: () => { this.cambiado.set(false); this.mensaje.set('Paquete guardado: al venderlo se descuentan sus unidades.'); },
      error: e => this.mensaje.set(e?.error?.error ?? 'No se pudo guardar'),
    });
  }
}
