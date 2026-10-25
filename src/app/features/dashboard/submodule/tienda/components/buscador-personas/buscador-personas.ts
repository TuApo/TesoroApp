import {
  ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Subject, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ImagenAmpliableComponent } from '../../../../../../shared/components/imagen-ampliable/imagen-ampliable.component';
import { PersonaTarjeta, TiendaService } from '../../service/tienda.service';
import { TomarFoto } from '../tomar-foto/tomar-foto';
import { EscanerCodigoComponent } from '@/app/shared/components/escaner-codigo/escaner-codigo.component';
import { cedulaDesdeCodigo } from '@/app/shared/components/escaner-codigo/cedula-desde-codigo';

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
  imports: [CommonModule, FormsModule, MatIconModule, ImagenAmpliableComponent, TomarFoto, EscanerCodigoComponent],
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
  /** Foto que se le toma a la persona al autorizar: queda como soporte con la cédula de quien autoriza. */
  readonly fotoAutorizacion = signal<string | null>(null);
  solicitud = { monto: 0, cuotas: 1, observacion: '' };

  readonly ajustandoTope = signal(false);
  readonly guardandoTope = signal(false);
  ajuste: { tope: number | null; motivo: string; vigente_hasta: string } = { tope: null, motivo: '', vigente_hasta: '' };

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

  /** Lee el código de la cédula (PDF417 del reverso o QR de la digital) y busca por el número. */
  cedulaLeida(texto: string): void {
    const c = cedulaDesdeCodigo(texto);
    if (c) this.escribir(c);
    else this.error.set('No encontramos un número de cédula en ese código');
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
        this.fotoAutorizacion.set(null);
        this.solicitud = { monto: ficha.cupo_mercado_disponible, cuotas: 1, observacion: '' };
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
      foto_doc_id: this.fotoAutorizacion() ?? undefined,
      observacion: this.solicitud.observacion || undefined,
    }).subscribe({
      next: r => {
        this.aviso.set(`Autorización ${r['codigo_autorizacion']} creada por `
          + `$${Number(r['monto']).toLocaleString('es-CO')}${r['por_excepcion'] ? ' (por encima del tope de tesorería, con excepción)' : ''}. `
          + 'El cupo queda apartado hasta que se use en la caja.');
        this.pidiendoMercado.set(false);
        this.elegir(p);
      },
      error: e => {
        const cuerpo = (e as { error?: { error?: string } })?.error;
        this.error.set(cuerpo?.error ?? 'No se pudo crear la autorización');
      },
    });
  }

  abrirAjusteTope(): void {
    const p = this.elegida();
    if (!p) return;
    this.ajuste = { tope: p.tope_ajustado?.tope ?? p.cupo_mercado_limite, motivo: '', vigente_hasta: '' };
    this.ajustandoTope.set(true);
  }

  /** Guarda el tope ajustado (o lo quita con `quitar`). Vuelve a pedir la ficha con las cifras nuevas. */
  guardarTope(quitar = false): void {
    const p = this.elegida();
    if (!p) return;
    this.guardandoTope.set(true);
    this.error.set(null);
    this.api.ajustarTope(p.cedula, this.tiendaId, {
      tope: quitar ? null : this.ajuste.tope,
      motivo: this.ajuste.motivo || (quitar ? 'Vuelve al tope de tesorería' : ''),
      vigente_hasta: this.ajuste.vigente_hasta || null,
    }).subscribe({
      next: () => {
        this.guardandoTope.set(false);
        this.ajustandoTope.set(false);
        this.aviso.set(quitar ? 'Se quitó el ajuste: manda otra vez el tope de tesorería.' : 'Tope ajustado.');
        this.elegir(p);
      },
      error: e => {
        this.guardandoTope.set(false);
        const cuerpo = (e as { error?: { error?: string } })?.error;
        this.error.set(cuerpo?.error ?? 'No se pudo ajustar el tope');
      },
    });
  }

  /** De dónde sale el tope, en palabras del mostrador. */
  origenTope(p: PersonaTarjeta): string {
    if (p.origen_tope === 'AJUSTE_TIENDA') return 'ajustado en tienda';
    if (p.origen_tope === 'TESORERIA') return 'según tesorería';
    return 'por antigüedad';
  }

  campo(a: Record<string, unknown>, k: string): any { return a[k]; }

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
