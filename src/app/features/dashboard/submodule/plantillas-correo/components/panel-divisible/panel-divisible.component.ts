import {
  ChangeDetectionStrategy, Component, ElementRef, HostListener, OnInit,
  computed, inject, input, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

/**
 * Dos paneles lado a lado con un divisor que se arrastra.
 *
 * <h3>Por qué el editor lo necesita</h3>
 * Antes, diseño y vista previa eran dos pestañas: había que cambiar de una a
 * otra para ver el efecto de cada cambio, y ese ida y vuelta es exactamente lo
 * que hace que la gente deje de mirar la previa y publique a ciegas. Con los dos
 * a la vez, el correo se ve mientras se arma.
 *
 * <h3>La proporción se recuerda</h3>
 * En `localStorage`, por clave. Quien trabaja en una pantalla ancha quiere más
 * previa; quien trabaja en un portátil quiere más lienzo. Reajustarlo en cada
 * apertura es una molestia pequeña que se repite cien veces.
 *
 * <h3>Detalles del arrastre que no son opcionales</h3>
 * Durante el arrastre se pone `user-select: none` en el documento y
 * `pointer-events: none` en los paneles: sin lo primero el navegador selecciona
 * texto de toda la pantalla, y sin lo segundo el puntero se "pierde" al pasar
 * sobre el iframe de la vista previa —que se traga los eventos de ratón— y el
 * divisor se queda enganchado.
 */
@Component({
  selector: 'app-panel-divisible',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatTooltipModule],
  template: `
    <div class="pd" [class.pd--arrastrando]="arrastrando()" [class.pd--colapsado]="colapsado()">
      <div class="pd__panel" [style.flex-basis.%]="colapsado() ? 100 : porcentaje()">
        <ng-content select="[panelIzquierdo]"></ng-content>
      </div>

      @if (!colapsado()) {
        <div class="pd__divisor" role="separator" tabindex="0"
             [attr.aria-valuenow]="porcentaje()" aria-orientation="vertical"
             [attr.aria-label]="'Ajustar el ancho de ' + etiquetaIzquierda()"
             (mousedown)="iniciar($event)" (touchstart)="iniciarTactil($event)"
             (keydown)="teclado($event)"
             matTooltip="Arrastra para repartir el espacio. Doble clic para volver a la mitad.">
          <div class="pd__asa" (dblclick)="porcentaje.set(50); guardar()">
            <mat-icon>drag_indicator</mat-icon>
          </div>
        </div>

        <div class="pd__panel pd__panel--der" [style.flex-basis.%]="100 - porcentaje()">
          <ng-content select="[panelDerecho]"></ng-content>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; min-height: 0; }
    .pd { display: flex; align-items: stretch; gap: 0; min-height: 0; width: 100%; }
    .pd__panel { min-width: 0; overflow: visible; }
    .pd__panel--der { display: flex; flex-direction: column; min-height: 0; }

    /* Durante el arrastre, los paneles dejan de recibir el puntero: si no, el
       iframe de la previa se traga el mousemove y el divisor se queda pegado. */
    .pd--arrastrando .pd__panel { pointer-events: none; }

    .pd__divisor {
      flex: 0 0 14px; align-self: stretch; display: flex; align-items: center; justify-content: center;
      cursor: col-resize; position: relative; touch-action: none;
    }
    .pd__divisor::before {
      content: ''; position: absolute; top: 0; bottom: 0; width: 2px;
      background: #e2e8f0; border-radius: 2px; transition: background .12s;
    }
    .pd__divisor:hover::before, .pd--arrastrando .pd__divisor::before { background: #0f766e; }
    .pd__divisor:focus-visible { outline: 2px solid #0f766e; outline-offset: -2px; border-radius: 4px; }
    .pd__asa {
      position: relative; display: flex; align-items: center; justify-content: center;
      width: 14px; height: 34px; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 4px;
    }
    .pd__asa mat-icon { font-size: 14px; width: 14px; height: 14px; color: #94a3b8; }
    .pd__divisor:hover .pd__asa { border-color: #0f766e; background: #ecfdf5; }

    @media (max-width: 1100px) {
      .pd { flex-direction: column; }
      .pd__panel, .pd__panel--der { flex-basis: auto !important; width: 100%; }
      .pd__divisor { display: none; }
    }
  `],
})
export class PanelDivisibleComponent implements OnInit {
  private host = inject(ElementRef<HTMLElement>);

  /** Clave de `localStorage`; distinta por sitio donde se use el componente. */
  readonly clave = input<string>('panel-divisible');
  readonly inicial = input<number>(58);
  readonly minimo = input<number>(25);
  readonly maximo = input<number>(80);
  /** Oculta el panel derecho por completo (el editor lo usa para dar todo el ancho al lienzo). */
  readonly colapsado = input<boolean>(false);
  readonly etiquetaIzquierda = input<string>('el panel izquierdo');

  readonly porcentaje = signal(58);
  readonly arrastrando = signal(false);

  ngOnInit(): void {
    const guardado = Number(localStorage.getItem(`pd:${this.clave()}`));
    this.porcentaje.set(
      Number.isFinite(guardado) && guardado >= this.minimo() && guardado <= this.maximo()
        ? guardado
        : this.inicial());
  }

  iniciar(ev: MouseEvent): void {
    ev.preventDefault();
    this.arrastrando.set(true);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  }

  iniciarTactil(ev: TouchEvent): void {
    ev.preventDefault();
    this.arrastrando.set(true);
  }

  @HostListener('document:mousemove', ['$event'])
  mover(ev: MouseEvent): void {
    if (this.arrastrando()) this.aplicar(ev.clientX);
  }

  @HostListener('document:touchmove', ['$event'])
  moverTactil(ev: TouchEvent): void {
    if (this.arrastrando() && ev.touches.length) this.aplicar(ev.touches[0].clientX);
  }

  @HostListener('document:mouseup')
  @HostListener('document:touchend')
  soltar(): void {
    if (!this.arrastrando()) return;
    this.arrastrando.set(false);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    this.guardar();
  }

  /** Flechas para quien no usa ratón; el divisor es enfocable a propósito. */
  teclado(ev: KeyboardEvent): void {
    const paso = ev.shiftKey ? 10 : 2;
    if (ev.key === 'ArrowLeft') { this.acotar(this.porcentaje() - paso); ev.preventDefault(); }
    if (ev.key === 'ArrowRight') { this.acotar(this.porcentaje() + paso); ev.preventDefault(); }
    if (ev.key === 'Home') { this.porcentaje.set(50); ev.preventDefault(); }
    if (['ArrowLeft', 'ArrowRight', 'Home'].includes(ev.key)) this.guardar();
  }

  private aplicar(clientX: number): void {
    const caja = (this.host.nativeElement as HTMLElement).getBoundingClientRect();
    if (caja.width <= 0) return;
    this.acotar(((clientX - caja.left) / caja.width) * 100);
  }

  private acotar(valor: number): void {
    this.porcentaje.set(Math.min(this.maximo(), Math.max(this.minimo(), Math.round(valor))));
  }

  guardar(): void {
    try {
      localStorage.setItem(`pd:${this.clave()}`, String(this.porcentaje()));
    } catch {
      // Modo privado o cuota llena: no poder recordar la proporción no es motivo
      // para romper el editor.
    }
  }
}
