import {
  ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Subject, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { PersonaTarjeta, TiendaService } from '../../service/tienda.service';

/**
 * Buscador de personas del mostrador.
 *
 * <p>Sustituye al campo de cédula a ciegas. Busca contratados por nombre o documento y
 * cada resultado ya viene con lo que decide la venta: si está bloqueada, cuánto debe, si
 * <b>ya tiene autorización de mercado</b> y, si no la tiene, si hoy se le puede dar y por
 * cuánto.
 *
 * <p>Busca cuando la persona deja de escribir, no en cada tecla: cada búsqueda cruza
 * contratación con tesorería, y dispararla por pulsación convertiría el buscador en una
 * tormenta de llamadas.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-buscador-personas',
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './buscador-personas.html',
  styleUrls: ['../../styles/tienda-comun.css', './buscador-personas.css'],
})
export class BuscadorPersonas {
  private api = inject(TiendaService);

  /** Tienda sobre la que se busca. Sin ella el servidor no autoriza la consulta. */
  @Input({ required: true }) tiendaId!: string;

  /** Quien administra la tienda puede además crear autorizaciones de mercado. */
  @Input() puedeAutorizar = false;

  @Output() seleccionada = new EventEmitter<PersonaTarjeta>();

  readonly texto = signal('');
  readonly resultados = signal<PersonaTarjeta[]>([]);
  readonly buscando = signal(false);
  readonly buscado = signal(false);
  readonly elegida = signal<PersonaTarjeta | null>(null);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  readonly pidiendoMercado = signal(false);
  readonly identidadConfirmada = signal(false);
  solicitud = { monto: 0, cuotas: 1 };

  private teclas = new Subject<string>();

  constructor() {
    this.teclas.pipe(
      debounceTime(350),
      distinctUntilChanged(),
      switchMap(q => {
        if (q.trim().length < 3 || !this.tiendaId) {
          this.buscando.set(false);
          this.resultados.set([]);
          this.buscado.set(false);
          return [];
        }
        this.buscando.set(true);
        return this.api.buscarPersonas(q, this.tiendaId);
      }),
      takeUntilDestroyed(),
    ).subscribe({
      next: r => { this.resultados.set(r); this.buscando.set(false); this.buscado.set(true); },
      error: () => {
        this.buscando.set(false);
        this.error.set('No se pudo buscar. Intente de nuevo.');
      },
    });
  }

  escribir(valor: string): void {
    this.texto.set(valor);
    this.error.set(null);
    this.teclas.next(valor);
  }

  /** Al elegir se pide la ficha completa: la foto solo se trae para quien se va a atender. */
  elegir(p: PersonaTarjeta): void {
    this.api.personaDetalle(p.cedula, this.tiendaId).subscribe({
      next: ficha => {
        this.elegida.set(ficha);
        this.resultados.set([]);
        this.identidadConfirmada.set(false);
        this.solicitud = { monto: ficha.cupo_mercado_disponible, cuotas: 1 };
        this.seleccionada.emit(ficha);
      },
      error: () => this.error.set('No se pudo cargar la ficha de la persona'),
    });
  }

  limpiar(): void {
    this.elegida.set(null);
    this.texto.set('');
    this.resultados.set([]);
    this.buscado.set(false);
    this.pidiendoMercado.set(false);
    this.aviso.set(null);
  }

  solicitarMercado(): void {
    const p = this.elegida();
    if (!p) return;
    this.api.autorizarMercado(p.cedula, this.tiendaId, {
      monto: this.solicitud.monto,
      cuotas: this.solicitud.cuotas,
      identidad_verificada: this.identidadConfirmada(),
    }).subscribe({
      next: r => {
        this.aviso.set(`Autorización ${r['codigo_autorizacion']} creada por `
          + `${Number(r['monto']).toLocaleString('es-CO')}. El cupo queda apartado hasta que se ejecute.`);
        this.pidiendoMercado.set(false);
        this.elegir(p);
      },
      error: e => {
        const cuerpo = (e as { error?: { error?: string } })?.error;
        this.error.set(cuerpo?.error ?? 'No se pudo crear la autorización');
      },
    });
  }

  /** El estado que resume la fila, para pintarla de un vistazo. */
  estado(p: PersonaTarjeta): { clase: string; texto: string } {
    if (!p.en_tesoreria) return { clase: 'aviso', texto: 'sin ficha en tesorería' };
    if (p.bloqueado) return { clase: 'peligro', texto: 'bloqueada' };
    if (!p.activo) return { clase: 'peligro', texto: 'retirada' };
    if (p.tiene_autorizacion_mercado) return { clase: 'exito', texto: 'con autorización de mercado' };
    if (p.puede_solicitar_mercado) return { clase: 'info', texto: 'puede pedir mercado' };
    return { clase: 'neutra', texto: 'sin autorización' };
  }
}
