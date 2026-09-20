import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ContextoTiendaService } from '../../service/contexto-tienda.service';

/**
 * Selector de tienda, presente en casi todas las pantallas del módulo.
 *
 * <p>Cuando el usuario tiene una sola tienda no se pinta un desplegable: se muestra su
 * nombre. Un selector con una única opción es ruido que obliga a leer para descubrir que
 * no hay nada que decidir.
 *
 * <p>Cuando no tiene ninguna, dice por qué — y distingue los dos casos, porque llevan a
 * sitios distintos: al super administrador de un sistema recién montado le faltan tiendas
 * por crear; a un tendero sin asignación le falta que alguien se la dé.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-selector-tienda',
  imports: [CommonModule, MatIconModule],
  templateUrl: './selector-tienda.html',
  styleUrls: ['../../styles/tienda-comun.css', './selector-tienda.css'],
})
export class SelectorTienda implements OnInit {
  readonly ctx = inject(ContextoTiendaService);

  ngOnInit(): void {
    this.ctx.cargar();
  }

  cambiar(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    this.ctx.seleccionar(valor || null);
  }
}
