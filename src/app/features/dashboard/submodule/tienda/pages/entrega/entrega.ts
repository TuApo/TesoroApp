import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

import {
  Expediente, PedidoParaEntregar, TiendaService, ValidacionReclamo,
} from '../../service/tienda.service';

/**
 * La pantalla de quien entrega los mercados.
 *
 * <p>Sustituye a la llamada telefónica: hoy el del punto canta una cédula y alguien al
 * otro lado mira una carpeta. Aquí la teclea — o la lee de la fotocopia que le dan — y le
 * salen la foto de contratación, los documentos y los pedidos de esa persona.
 *
 * <p>Busca también por la cédula del TERCERO autorizado, que es el caso en el que lo que
 * tiene en la mano no es el documento del titular.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-entrega',
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './entrega.html',
  styleUrls: ['../../styles/tienda-comun.css', './entrega.css'],
})
export class Entrega {
  private api = inject(TiendaService);

  readonly cedula = signal('');
  readonly expediente = signal<Expediente | null>(null);
  readonly seleccionado = signal<PedidoParaEntregar | null>(null);
  readonly validaciones = signal<ValidacionReclamo[]>([]);
  readonly sospechosas = signal<ValidacionReclamo[]>([]);

  readonly buscando = signal(false);
  readonly enviando = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);
  readonly verBandeja = signal(false);

  /** Lo que el revisor decide, con su motivo. */
  readonly medio = signal<'CEDULA' | 'FOTOCOPIA' | 'DIGITAL'>('CEDULA');
  readonly comentario = signal('');

  buscar(): void {
    const doc = this.cedula().trim();
    if (!doc) return;
    this.buscando.set(true);
    this.error.set(null);
    this.aviso.set(null);
    this.seleccionado.set(null);
    this.validaciones.set([]);

    this.api.expediente(doc).subscribe({
      next: e => {
        this.expediente.set(e);
        this.buscando.set(false);
        // Si solo tiene un pedido pendiente, se abre solo: en el mostrador cada clic de
        // más es tiempo con una persona esperando enfrente.
        if (e.pedidos.length === 1) this.elegir(e.pedidos[0]);
      },
      error: e => {
        this.buscando.set(false);
        this.expediente.set(null);
        this.error.set(this.mensaje(e, 'No se pudo consultar esa cédula'));
      },
    });
  }

  elegir(p: PedidoParaEntregar): void {
    this.seleccionado.set(p);
    this.comentario.set('');
    this.api.validacionesDe(p.id).subscribe({
      next: v => this.validaciones.set(v),
      error: () => this.validaciones.set([]),
    });
  }

  /**
   * Registra la decisión.
   *
   * <p>Tres resultados y no dos. `SOSPECHOSA` está porque el del punto casi nunca tiene la
   * certeza de que un documento sea falso: tiene una duda. Si solo pudiera aprobar o
   * rechazar, la duda se resolvería aprobando y no quedaría rastro de que la hubo.
   */
  decidir(resultado: 'APROBADA' | 'RECHAZADA' | 'SOSPECHOSA'): void {
    const p = this.seleccionado();
    const e = this.expediente();
    if (!p || !e) return;

    if (resultado !== 'APROBADA' && !this.comentario().trim()) {
      this.error.set('Escriba por qué no lo aprueba');
      return;
    }

    this.enviando.set(true);
    this.error.set(null);
    this.api.validarReclamo(p.id, {
      cedula_presentada: e.cedula,
      medio: this.medio(),
      resultado,
      comentario: this.comentario().trim() || undefined,
      tercero_id: p.tercero?.id,
    }).subscribe({
      next: () => {
        this.enviando.set(false);
        this.aviso.set(resultado === 'APROBADA'
          ? 'Aprobado. Ya puede entregar el mercado.'
          : `Registrado como ${resultado.toLowerCase()}. El pedido queda detenido.`);
        this.buscar();
      },
      error: err => {
        this.enviando.set(false);
        this.error.set(this.mensaje(err, 'No se pudo registrar la decisión'));
      },
    });
  }

  abrirBandeja(): void {
    this.verBandeja.set(!this.verBandeja());
    if (this.verBandeja()) {
      this.api.validacionesSospechosas().subscribe({
        next: v => this.sospechosas.set(v),
        error: () => this.error.set('No se pudo cargar la bandeja'),
      });
    }
  }

  // ── Presentación ────────────────────────────────────────────────────────

  /**
   * `tiene_foto` en null NO es "no tiene foto": es "no se pudo preguntar a contratación".
   * Son cosas distintas y quien entrega tiene que poder distinguirlas.
   */
  estadoFoto(e: Expediente): 'SI' | 'NO' | 'DESCONOCIDO' {
    if (e.tiene_foto === null || e.tiene_foto === undefined) return 'DESCONOCIDO';
    return e.tiene_foto ? 'SI' : 'NO';
  }

  claseValidacion(estado: string): string {
    switch (estado) {
      case 'APROBADA': return 'ok';
      case 'RECHAZADA': return 'malo';
      case 'SOSPECHOSA': return 'dudoso';
      case 'PENDIENTE': return 'espera';
      default: return '';
    }
  }

  textoValidacion(estado: string): string {
    switch (estado) {
      case 'NO_REQUERIDA': return 'Lo recoge el titular';
      case 'PENDIENTE': return 'Falta validar';
      case 'APROBADA': return 'Validado';
      case 'RECHAZADA': return 'Rechazado';
      case 'SOSPECHOSA': return 'Marcado como dudoso';
      default: return estado;
    }
  }

  private mensaje(e: unknown, porDefecto: string): string {
    const err = e as { error?: { error?: string; message?: string } };
    return err?.error?.error || err?.error?.message || porDefecto;
  }
}
