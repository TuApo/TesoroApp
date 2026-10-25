import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { TiendaService } from '../../service/tienda.service';
import { FRANJAS, diaCorto, franjaAcordada, proximosDias } from '../../util/fechas-entrega';

export interface PedidoHora {
  id: string; numero: string; cliente_nombre: string | null; cliente_telefono?: string | null;
  fecha_compromiso?: string | null; programado_en?: string | null; programado_hasta?: string | null; hora_confirmada_en?: string | null;
}

/**
 * Confirmar con la persona el día y la franja de entrega. Se le puede proponer por WhatsApp
 * con un mensaje listo; lo acordado queda en el pedido, a la persona le llega el aviso y sin
 * esto no se sale a ruta.
 */
@Component({
  selector: 'app-confirmar-hora',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule],
  styleUrls: ['../../styles/tienda-comun.css'],
  template: `
    <div class="hora">
      @if (actual(); as a) { <p class="ya"><mat-icon>event_available</mat-icon> Acordado: {{ a }}. Puede cambiarlo.</p> }
      <span class="et">Día</span>
      <div class="chips">
        @for (d of dias(); track d) {
          <button type="button" [class.on]="fecha() === d" [class.tarde]="tarde(d)" (click)="fecha.set(d)">{{ diaCorto(d) }}</button>
        }
        <input type="date" class="campo" [ngModel]="fecha()" (ngModelChange)="fecha.set($event)" aria-label="Otro día" />
      </div>
      @if (pedido().fecha_compromiso) { <small class="muted">Compromiso: a más tardar el {{ diaCorto(pedido().fecha_compromiso) }}.</small> }
      <span class="et">Franja</span>
      <div class="chips">
        @for (f of FRANJAS; track f.desde) {
          <button type="button" [class.on]="desde() === f.desde && hasta() === f.hasta" (click)="desde.set(f.desde); hasta.set(f.hasta)">{{ f.etiqueta }}</button>
        }
      </div>
      <div class="filas">
        <label>Desde <input type="time" class="campo" [ngModel]="desde()" (ngModelChange)="desde.set($event)" /></label>
        <label>Hasta <input type="time" class="campo" [ngModel]="hasta()" (ngModelChange)="hasta.set($event)" /></label>
      </div>
      @if (pedido().cliente_telefono) {
        <a class="boton wa" [href]="propuesta()" target="_blank" rel="noopener"><mat-icon>chat</mat-icon> Proponer por WhatsApp</a>
      }
      <span class="et">¿Cómo lo confirmó?</span>
      <div class="chips">
        @for (v of VIAS; track v[0]) { <button type="button" [class.on]="via() === v[0]" (click)="via.set($any(v[0]))">{{ v[1] }}</button> }
      </div>
      <input class="campo ancho" [placeholder]="tarde(fecha()) ? 'Motivo (obligatorio: pasa del compromiso)' : 'Nota (opcional)'" [ngModel]="nota()" (ngModelChange)="nota.set($event)" />
      @if (error()) { <p class="err">{{ error() }}</p> }
      <div class="acciones">
        <button type="button" class="boton secundario" (click)="cancelar.emit()">Cerrar</button>
        <button type="button" class="boton" [disabled]="!listo() || ocupado()" (click)="guardar()"><mat-icon>event_available</mat-icon> Confirmar hora</button>
      </div>
    </div>
  `,
  styles: [`
    .hora { display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface); }
    .et { font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .chips button { border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 999px; padding: 6px 12px; font: inherit;
                    font-size: 13px; cursor: pointer; min-height: 38px !important; }
    .chips button.on { background: #0b6b58; border-color: #0b6b58; color: #fff; }
    .chips button.tarde:not(.on) { border-style: dashed; color: #b45309; }
    .campo { min-height: 38px; padding: 4px 8px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font: inherit; max-width: 100%; box-sizing: border-box; }
    .campo.ancho { width: 100%; }
    .filas { display: flex; gap: 10px; flex-wrap: wrap; font-size: 13px; color: var(--muted); }
    .filas label { display: flex; align-items: center; gap: 6px; }
    .boton.wa { background: #25d366; border-color: #25d366; color: #fff; justify-content: center; text-decoration: none; }
    .acciones { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
    .ya { display: flex; gap: 6px; align-items: center; margin: 0; color: #065f46; font-size: 13.5px; }
    .muted { color: var(--muted); font-size: 12px; }
    .err { color: #b91c1c; margin: 0; font-size: 13px; }
  `],
})
export class ConfirmarHora {
  private api = inject(TiendaService);
  readonly pedido = input.required<PedidoHora>();
  readonly confirmada = output<{ fecha: string; franja: string }>();
  readonly cancelar = output<void>();

  readonly FRANJAS = FRANJAS;
  readonly VIAS = [['LLAMADA', 'Llamada'], ['WHATSAPP', 'WhatsApp'], ['PERSONA', 'En persona']];
  readonly diaCorto = diaCorto;
  readonly dias = signal(proximosDias(6));
  readonly fecha = signal(proximosDias(1)[0]);
  readonly desde = signal('');
  readonly hasta = signal('');
  readonly via = signal<'LLAMADA' | 'WHATSAPP' | 'PERSONA'>('LLAMADA');
  readonly nota = signal('');
  readonly error = signal<string | null>(null);
  readonly ocupado = signal(false);

  readonly actual = computed(() => this.pedido().hora_confirmada_en ? franjaAcordada(this.pedido().programado_en, this.pedido().programado_hasta) : null);
  readonly listo = computed(() => !!this.fecha() && !!this.desde() && !!this.hasta() && this.hasta() > this.desde()
    && (!this.tarde(this.fecha()) || !!this.nota().trim()));
  readonly propuesta = computed(() => {
    const p = this.pedido();
    let n = (p.cliente_telefono ?? '').replace(/\D/g, '');
    if (n.length === 10 && n.startsWith('3')) n = '57' + n;
    const nombre = (p.cliente_nombre ?? '').split(' ')[0] || 'buen día';
    const franja = this.desde() && this.hasta() ? ` entre las ${hora(this.desde())} y las ${hora(this.hasta())}` : '';
    const texto = `Hola ${nombre}, le escribimos de EconomiAPP por su pedido ${p.numero}. ¿Le podemos entregar el ${diaCorto(this.fecha())}${franja}? Responda SÍ para confirmar o díganos qué hora le queda mejor.`;
    return `https://wa.me/${n}?text=${encodeURIComponent(texto)}`;
  });

  tarde(d: string): boolean { const c = this.pedido().fecha_compromiso; return !!c && !!d && d > c.slice(0, 10); }

  async guardar(): Promise<void> {
    this.ocupado.set(true); this.error.set(null);
    try {
      const r = await firstValueFrom(this.api.confirmarHoraEntrega(this.pedido().id, {
        fecha: this.fecha(), desde: this.desde(), hasta: this.hasta(), via: this.via(), nota: this.nota().trim() || null }));
      this.confirmada.emit({ fecha: r.fecha, franja: r.franja });
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo confirmar la hora'); }
    finally { this.ocupado.set(false); }
  }
}

function hora(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const h12 = h % 12 || 12;
  return `${h12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}
