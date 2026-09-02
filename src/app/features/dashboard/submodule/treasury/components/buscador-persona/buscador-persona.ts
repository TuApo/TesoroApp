import {
  ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Output, ViewChild,
  inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Subject, debounceTime, distinctUntilChanged, switchMap, catchError, of } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ResultadoBusqueda, TesoreriaApiService } from '../../service/tesoreria-api.service';

/**
 * El buscador del mostrador: cédula, nombre o código de contrato.
 *
 * <p>Hasta ahora había que teclear la cédula completa y exacta. Quien llegaba sin recordar
 * su número, o con el carné en la mano, no se podía atender. Este busca por lo que sea que
 * traiga la persona.
 *
 * <p><b>Cada resultado dice ya si se puede atender.</b> El semáforo (habilitado, bloqueado,
 * retirado, en mora) va en la lista y no dentro de la ficha: si hay que abrir cada
 * resultado para descubrir que la persona está bloqueada, el buscador no sirve de nada
 * cuando hay cinco homónimos.
 *
 * <p>El debounce y el `distinctUntilChanged` no son cosmética: sin ellos, teclear una
 * cédula de diez dígitos dispara diez búsquedas sobre una tabla de 51.136 filas.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-buscador-persona',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './buscador-persona.html',
  styleUrls: ['../../styles/tesoreria-comun.css', './buscador-persona.css'],
})
export class BuscadorPersona {

  private api = inject(TesoreriaApiService);

  /** Persona elegida. El contenedor decide qué hacer con ella. */
  @Output() seleccionada = new EventEmitter<ResultadoBusqueda>();

  @ViewChild('entrada') entrada?: ElementRef<HTMLInputElement>;

  readonly termino = signal('');
  readonly resultados = signal<ResultadoBusqueda[]>([]);
  readonly buscando = signal(false);
  readonly abierto = signal(false);
  readonly error = signal<string | null>(null);
  /** Índice resaltado por teclado. -1 = ninguno. */
  readonly resaltado = signal(-1);

  private tecleo$ = new Subject<string>();

  constructor() {
    this.tecleo$.pipe(
      debounceTime(250),
      distinctUntilChanged(),
      switchMap(q => {
        if (!q || q.trim().length < 2) {
          this.buscando.set(false);
          return of<ResultadoBusqueda[]>([]);
        }
        this.buscando.set(true);
        return this.api.buscarPersonas(q).pipe(
          catchError(() => {
            this.error.set('No se pudo buscar. Revisa la conexión e intenta de nuevo.');
            return of<ResultadoBusqueda[]>([]);
          }),
        );
      }),
      takeUntilDestroyed(),
    ).subscribe(res => {
      this.resultados.set(res);
      this.buscando.set(false);
      this.resaltado.set(-1);
      this.abierto.set(true);
    });
  }

  alTeclear(valor: string): void {
    this.termino.set(valor);
    this.error.set(null);
    this.tecleo$.next(valor);
  }

  elegir(p: ResultadoBusqueda): void {
    this.termino.set(`${p.numero_documento} · ${p.nombre ?? ''}`.trim());
    this.abierto.set(false);
    this.resultados.set([]);
    this.seleccionada.emit(p);
  }

  limpiar(): void {
    this.termino.set('');
    this.resultados.set([]);
    this.abierto.set(false);
    this.error.set(null);
    this.entrada?.nativeElement.focus();
  }

  /**
   * Navegación con teclado. El mostrador teclea rápido y no siempre suelta el teclado
   * para coger el ratón; sin flechas y Enter, cada búsqueda cuesta un gesto de más.
   */
  alPulsarTecla(evento: KeyboardEvent): void {
    const lista = this.resultados();
    if (!this.abierto() || lista.length === 0) return;

    switch (evento.key) {
      case 'ArrowDown':
        evento.preventDefault();
        this.resaltado.set(Math.min(this.resaltado() + 1, lista.length - 1));
        break;
      case 'ArrowUp':
        evento.preventDefault();
        this.resaltado.set(Math.max(this.resaltado() - 1, 0));
        break;
      case 'Enter': {
        const i = this.resaltado();
        // Con un solo resultado, Enter lo elige aunque no se haya bajado con la flecha:
        // es el caso de quien pega una cédula completa.
        const elegido = i >= 0 ? lista[i] : (lista.length === 1 ? lista[0] : null);
        if (elegido) { evento.preventDefault(); this.elegir(elegido); }
        break;
      }
      case 'Escape':
        this.abierto.set(false);
        break;
    }
  }

  /**
   * El blur se retrasa: sin ese margen, el `mousedown` sobre un resultado cierra la lista
   * antes de que llegue el `click` y la selección se pierde.
   */
  alPerderFoco(): void {
    setTimeout(() => this.abierto.set(false), 180);
  }

  claseDeEstado(estado: string): string {
    switch (estado) {
      case 'HABILITADO': return 'verde';
      case 'BLOQUEADO':  return 'rojo';
      case 'RETIRADO':   return 'gris';
      case 'EN_MORA':    return 'ambar';
      default:           return 'gris';
    }
  }

  textoDeEstado(estado: string): string {
    switch (estado) {
      case 'HABILITADO': return 'Habilitado';
      case 'BLOQUEADO':  return 'Bloqueado';
      case 'RETIRADO':   return 'Retirado';
      case 'EN_MORA':    return 'En mora';
      default:           return estado;
    }
  }
}
