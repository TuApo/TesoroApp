import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { SolicitudPrestamo, TiendaService } from '../../dashboard/submodule/tienda/service/tienda.service';
import { CONSENTIMIENTO_VERSION, TEXTO_TITULAR, huellaDelTexto } from '../consentimiento-biometrico';
import { EconomiaStore } from '../economia.store';
import { mensajeError, pesos, usuarioEnSesion } from '../economia.util';
import { CapturaRostro, EcoCapturaRostro } from './eco-captura-rostro';
import { EcoFirma } from './eco-firma';

/**
 * La solicitud de préstamo del bono mercado, para firmar en la app: se lee, se verifica
 * con el rostro contra la foto de contratación y se firma en pantalla. Al recibir se firma
 * también el papel impreso.
 */
@Component({
  selector: 'eco-firmar-prestamo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, DatePipe, EcoCapturaRostro, EcoFirma],
  template: `
    @if (sol(); as s) {
      @if (s.existe) {
        <section class="tarjeta bloque prestamo" [attr.data-estado]="s.estado">
          <h2><mat-icon>draw</mat-icon> Solicitud de préstamo bono mercado</h2>
          <p class="muted">{{ s.numero }} · {{ pesos(s.monto) }} en {{ s.cuotas }} {{ s.cuotas === 1 ? 'cuota' : 'cuotas' }}</p>
          @if (s.estado === 'PENDIENTE_FIRMA') {
            <details class="texto" [open]="paso() !== 'inicio'"><summary>Leer la solicitud</summary><pre>{{ s.texto }}</pre></details>
            @switch (paso()) {
              @case ('inicio') {
                <p class="aviso info"><mat-icon>info</mat-icon><span>Fírmela antes de recibir: sin esta firma la tienda no puede entregar lo que va por bono mercado.</span></p>
                <button type="button" class="eco-btn" (click)="paso.set('consentimiento')"><mat-icon>draw</mat-icon> Leer y firmar</button>
              }
              @case ('consentimiento') {
                <div class="legal">{{ TEXTO_TITULAR }}</div>
                <label class="check"><input type="checkbox" [checked]="acepta()" (change)="acepta.set($any($event.target).checked)" />
                  <span>Leí la solicitud y autorizo verificar mi identidad con mi rostro.</span></label>
                <p class="muted nota">¿Prefiere no usar reconocimiento facial? Puede firmar solo en papel, recibiendo usted mismo con su cédula original.</p>
                <button type="button" class="eco-btn" [disabled]="!acepta()" (click)="paso.set('rostro')"><mat-icon>face</mat-icon> Verificar que soy yo</button>
              }
              @case ('rostro') {
                <p class="muted">Comparamos su cara con su foto de contratación. Busque buena luz.</p>
                <eco-captura-rostro [frontal]="true" [conVivacidad]="true" (capturado)="conRostro($event)" />
              }
              @case ('verificando') { <p class="muted centro"><mat-icon>hourglass_top</mat-icon> Verificando…</p> }
              @case ('firma') {
                <p class="ok-verif"><mat-icon>verified_user</mat-icon> Identidad verificada. Ahora firme:</p>
                <eco-firma texto="Firme aquí con el dedo" [pie]="'Firma de ' + titular" (firma)="trazo.set($event)" />
                <button type="button" class="eco-btn" [disabled]="!trazo() || enviando()" (click)="firmar()">{{ enviando() ? 'Firmando…' : 'Firmar solicitud' }}</button>
              }
              @case ('fallo') {
                <p class="aviso warn"><mat-icon>error</mat-icon><span>{{ error() }}</span></p>
                <button type="button" class="eco-btn secundario" (click)="paso.set('rostro')">Intentar de nuevo</button>
              }
            }
          } @else {
            <p class="ok-verif"><mat-icon>task_alt</mat-icon>
              Firmada en la app el {{ s.firmado_virtual_en | date:'d MMM, h:mm a' }}.
              @if (s.estado === 'FIRMADO_VIRTUAL') { Al recibir firmará también el papel impreso. }
              @else { Papel firmado el {{ s.firmado_fisico_en | date:'d MMM' }}. }
            </p>
          }
        </section>
      }
    }
  `,
  styles: [`
    .prestamo h2 { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 17px; }
    .prestamo[data-estado='PENDIENTE_FIRMA'] { border-color: color-mix(in srgb, #f59e0b 50%, transparent); }
    .texto summary { cursor: pointer; font-weight: 700; color: var(--eco-ink); padding: 6px 0; }
    .texto pre { white-space: pre-wrap; font: inherit; font-size: 13px; line-height: 1.5; max-height: 280px; overflow: auto; padding: 10px; border-radius: 12px; background: var(--surface-2); margin: 0; }
    .legal { font-size: 12.5px; color: var(--text-2); max-height: 140px; overflow: auto; padding: 8px; border-radius: 10px; background: var(--surface-2); white-space: pre-line; }
    .check { display: flex; gap: 8px; align-items: flex-start; font-size: 13.5px; }
    .nota { font-size: 12.5px; }
    .ok-verif { display: flex; gap: 6px; align-items: center; color: var(--eco-ink); font-weight: 600; margin: 0; }
    .centro { display: flex; gap: 6px; align-items: center; justify-content: center; }
  `],
  styleUrls: ['../economiapp.css'],
})
export class EcoFirmarPrestamo {
  private api = inject(TiendaService);
  readonly store = inject(EconomiaStore);
  readonly titular = usuarioEnSesion().nombre || 'el titular';
  readonly pedidoId = input.required<string>();
  readonly TEXTO_TITULAR = TEXTO_TITULAR;
  readonly pesos = pesos;
  readonly sol = signal<SolicitudPrestamo | null>(null);
  readonly paso = signal<'inicio' | 'consentimiento' | 'rostro' | 'verificando' | 'firma' | 'fallo'>('inicio');
  readonly acepta = signal(false);
  readonly trazo = signal<Blob | null>(null);
  readonly enviando = signal(false);
  readonly error = signal<string | null>(null);
  private verificacionId: string | null = null;

  constructor() {
    effect(() => { const id = this.pedidoId(); untracked(() => this.cargar(id)); });
  }

  async cargar(id: string): Promise<void> {
    try { this.sol.set(await firstValueFrom(this.api.miSolicitudPrestamo(id))); } catch { this.sol.set(null); }
  }

  async conRostro(c: CapturaRostro): Promise<void> {
    this.paso.set('verificando');
    try {
      const v = await firstValueFrom(this.api.verificarTitular(c.blob, c.vivacidad,
        { version: CONSENTIMIENTO_VERSION, sha256: await huellaDelTexto(TEXTO_TITULAR) }));
      if (v.aprueba) { this.verificacionId = v.id; this.paso.set('firma'); }
      else { this.error.set(v.resultado === 'DUDOSA' ? 'No quedó claro: repita con mejor luz y de frente.' : 'Su rostro no coincidió con la foto de contratación.'); this.paso.set('fallo'); }
    } catch (e) { this.error.set(mensajeError(e, 'No pudimos verificar su identidad ahora')); this.paso.set('fallo'); }
  }

  async firmar(): Promise<void> {
    const f = this.trazo(); if (!f || !this.verificacionId) return;
    this.enviando.set(true);
    try {
      this.sol.set(await firstValueFrom(this.api.firmarSolicitudPrestamo(this.pedidoId(), f, this.verificacionId)));
      this.store.avisar('Solicitud firmada');
    } catch (e) { this.error.set(mensajeError(e, 'No se pudo firmar')); this.paso.set('fallo'); }
    finally { this.enviando.set(false); }
  }
}
