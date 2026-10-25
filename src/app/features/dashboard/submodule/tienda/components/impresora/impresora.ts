import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { ImpresoraPortatil } from '../../util/impresora-portatil';

/**
 * Botón de la impresora portátil: muestra si está lista y abre el panel para conectarla
 * (Bluetooth o RawBT), escoger el ancho del papel y probar.
 */
@Component({
  selector: 'app-impresora',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <button type="button" class="chip" [class.lista]="imp.lista()" (click)="abierto.set(!abierto())" [attr.aria-expanded]="abierto()">
      <mat-icon>{{ imp.lista() ? 'print' : 'print_disabled' }}</mat-icon>
      <span>{{ imp.modo() === 'bluetooth' && imp.conectada() ? (imp.nombre() || 'Impresora') : imp.modo() === 'rawbt' ? 'RawBT' : 'Impresora portátil' }}</span>
    </button>
    @if (abierto()) {
      <div class="panel" role="dialog" aria-label="Impresora portátil">
        <div class="fila">
          <b>Impresora térmica</b>
          <button type="button" class="x" (click)="abierto.set(false)" aria-label="Cerrar"><mat-icon>close</mat-icon></button>
        </div>
        @if (imp.error()) { <p class="err">{{ imp.error() }}</p> }
        @if (imp.conectada()) {
          <p class="ok"><mat-icon>bluetooth_connected</mat-icon> Conectada: {{ imp.nombre() }}</p>
          <button type="button" class="b sec" (click)="imp.desconectar()">Desconectar</button>
        } @else {
          <button type="button" class="b" [disabled]="!imp.bluetoothDisponible || imp.ocupada()" (click)="imp.conectar()">
            <mat-icon>bluetooth_searching</mat-icon> Conectar por Bluetooth
          </button>
          @if (!imp.bluetoothDisponible) { <small>Este navegador no tiene Bluetooth web (use Chrome en Android o computador).</small> }
          @if (imp.esAndroid) {
            <button type="button" class="b sec" [class.activa]="imp.modo() === 'rawbt'" (click)="imp.configurar({ modo: imp.modo() === 'rawbt' ? 'sistema' : 'rawbt' })">
              <mat-icon>apps</mat-icon> {{ imp.modo() === 'rawbt' ? 'Usando la app RawBT' : 'Usar la app RawBT' }}
            </button>
            <small>RawBT (Play Store) sirve para impresoras con Bluetooth clásico que el navegador no ve.</small>
          }
        }
        <div class="fila">
          <span>Papel</span>
          <div class="seg">
            <button type="button" [class.on]="imp.ancho() === 58" (click)="imp.configurar({ ancho: 58 })">58 mm</button>
            <button type="button" [class.on]="imp.ancho() === 80" (click)="imp.configurar({ ancho: 80 })">80 mm</button>
          </div>
        </div>
        <label class="chk"><input type="checkbox" [checked]="imp.tildes()" (change)="imp.configurar({ tildes: $any($event.target).checked })" /> Tildes y ñ (CP850)</label>
        <label class="chk"><input type="checkbox" [checked]="imp.bloque() === 20" (change)="imp.configurar({ bloque: $any($event.target).checked ? 20 : 100 })" /> Envío lento (si el ticket sale cortado)</label>
        <button type="button" class="b sec" [disabled]="!imp.lista() || imp.ocupada()" (click)="probar()"><mat-icon>receipt_long</mat-icon> Imprimir prueba</button>
      </div>
    }
  `,
  styles: [`
    :host { position: relative; display: inline-block; }
    .chip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border, #cbd5e1); background: var(--surface, #fff);
            color: var(--muted, #64748b); border-radius: 999px; padding: 4px 12px; font: inherit; font-size: 13px; cursor: pointer; min-height: 40px !important; }
    .chip.lista { color: #15803d; border-color: #86efac; background: #f0fdf4; }
    .chip mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .panel { position: absolute; right: 0; top: calc(100% + 6px); z-index: 30; width: min(320px, calc(100vw - 32px)); background: var(--surface, #fff);
             border: 1px solid var(--border, #e2e8f0); border-radius: 14px; box-shadow: 0 12px 32px rgba(0,0,0,.18); padding: 12px; display: grid; gap: 8px; }
    @media (max-width: 600px) { .panel { position: fixed; left: 16px; right: 16px; top: 96px; width: auto; } }
    .fila { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .x { border: 0; background: none; cursor: pointer; color: var(--muted, #64748b); min-height: 32px !important; }
    .b { display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 0; border-radius: 10px; padding: 8px 12px;
         background: var(--primary, #2563eb); color: #fff; font: inherit; cursor: pointer; }
    .b.sec { background: var(--surface-2, #f1f5f9); color: var(--text, #0f172a); }
    .b.activa { outline: 2px solid #22c55e; }
    .b:disabled { opacity: .5; cursor: default; }
    .seg { display: inline-flex; border: 1px solid var(--border, #cbd5e1); border-radius: 10px; overflow: hidden; }
    .seg button { border: 0; background: none; padding: 6px 10px; font: inherit; cursor: pointer; min-height: 36px !important; }
    .seg button.on { background: var(--primary, #2563eb); color: #fff; }
    .chk { display: flex; align-items: center; gap: 6px; font-size: 13px; }
    small { color: var(--muted, #64748b); font-size: 12px; }
    .err { color: #b91c1c; font-size: 13px; margin: 0; }
    .ok { color: #15803d; display: flex; align-items: center; gap: 6px; margin: 0; font-size: 13px; }
  `],
})
export class ImpresoraBoton {
  readonly imp = inject(ImpresoraPortatil);
  readonly abierto = signal(false);

  async probar(): Promise<void> {
    const t = this.imp.ticket();
    t.centro().negrita(true).linea('PRUEBA DE IMPRESORA').negrita(false).linea('Tildes: áéíóú ñ Ñ ¿¡').separador();
    await t.qr('ECO:prueba', 5);
    t.linea(new Date().toLocaleString('es-CO')).avanzar(3).cortar();
    try { await this.imp.enviar(t.bytes()); } catch { /* el error ya se muestra */ }
  }
}
