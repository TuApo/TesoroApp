/**
 * Elige EN QUÉ CELDA de la hoja se imprime el carnet y CÓMO se voltea la hoja
 * para el reverso.
 *
 * La hoja trae una grilla de 9 carnets. Al imprimir de a uno, la hoja queda con
 * 8 espacios sin usar; recortando solo el carnet impreso se puede volver a
 * pasar la MISMA hoja y usar el siguiente hueco. Este diálogo es el que lleva
 * la cuenta de qué celdas ya se usaron.
 *
 * Lo usado se guarda en `localStorage` (no en el servidor) porque es un dato
 * del papel que tiene el operador en su escritorio, no del candidato: cada
 * puesto lleva su propia hoja. "Hoja nueva" reinicia el conteo. El volteo se
 * guarda igual, pero es un dato de la impresora del puesto: se elige una vez.
 */
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Inject, Optional, computed, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { CARNETS_POR_HOJA, CARNET_COLUMNAS } from './carnet-apoyo-fill';
import { CarnetImpresionComponent } from './carnet-impresion.component';
import { ConfigImpresionCarnet, FormatoCarnet, leerImpresion } from './carnet-impresion';

const CLAVE_USADAS = 'carnet.hoja.celdas_usadas';

/** Celdas ya recortadas de la hoja actual. */
export function celdasUsadas(): number[] {
  try {
    const crudo = localStorage.getItem(CLAVE_USADAS);
    const arr = crudo ? JSON.parse(crudo) : [];
    return Array.isArray(arr)
      ? arr.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n < CARNETS_POR_HOJA)
      : [];
  } catch {
    return [];
  }
}

export function marcarCeldaUsada(celda: number): void {
  try {
    const usadas = new Set(celdasUsadas());
    usadas.add(celda);
    localStorage.setItem(CLAVE_USADAS, JSON.stringify([...usadas].sort((a, b) => a - b)));
  } catch {
    /* sin localStorage (modo privado): se pierde el conteo, no es crítico */
  }
}

export function reiniciarHoja(): void {
  try {
    localStorage.removeItem(CLAVE_USADAS);
  } catch {
    /* idem */
  }
}

/** Formato que se va a imprimir; solo cambia el texto de ayuda del volteo. */
export interface CarnetPosicionData {
  formato?: FormatoCarnet;
}

/** Lo que devuelve el diálogo: dónde se imprime y cómo se voltea la hoja. */
export interface CarnetPosicionResult {
  celda: number;
  impresion: ConfigImpresionCarnet;
}

@Component({
  selector: 'app-carnet-posicion-dialog',
  // Documento (se imprime o se captura): se queda en claro aunque la app esté en oscuro.
  host: { class: 'tema-claro-fijo' },
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, MatDialogModule, MatButtonModule, MatIconModule, MatTooltipModule,
    CarnetImpresionComponent,
  ],
  template: `
    <div class="cp-wrap">
      <header class="cp-head">
        <span class="cp-head-ic"><mat-icon>grid_view</mat-icon></span>
        <div class="cp-head-txt">
          <h2>¿En qué parte de la hoja?</h2>
          <p>Elige un espacio libre para reutilizar la hoja que ya recortaste.</p>
        </div>
      </header>

      <mat-dialog-content class="cp-body">
        <div class="cp-grid">
          @for (c of celdas; track c) {
            <button type="button" class="cp-celda"
              [class.usada]="usadas().includes(c)"
              [class.elegida]="seleccion() === c"
              [disabled]="usadas().includes(c)"
              [matTooltip]="usadas().includes(c)
                ? 'Este espacio ya se recortó: la hoja tiene un hueco ahí'
                : 'Imprimir el carnet en este espacio'"
              (click)="seleccion.set(c)">
              @if (usadas().includes(c)) {
                <mat-icon class="cp-ic-usada">content_cut</mat-icon>
              } @else if (seleccion() === c) {
                <mat-icon class="cp-ic-elegida">badge</mat-icon>
              } @else {
                <span class="cp-num">{{ c + 1 }}</span>
              }
            </button>
          }
        </div>

        <p class="cp-leyenda">
          <span class="cp-chip cp-chip-libre"></span> Libre
          <span class="cp-chip cp-chip-elegida"></span> Se imprime aquí
          <span class="cp-chip cp-chip-usada"></span> Ya recortado
        </p>

        @if (sinLibres()) {
          <p class="cp-aviso">
            <mat-icon>info</mat-icon>
            Esta hoja ya se usó completa. Pon una hoja nueva y pulsa "Hoja nueva".
          </p>
        }

        <app-carnet-impresion class="cp-impresion" [formato]="formato"></app-carnet-impresion>
      </mat-dialog-content>

      <mat-dialog-actions class="cp-actions">
        <button mat-stroked-button (click)="hojaNueva()" matTooltip="Vuelve a marcar los 9 espacios como libres">
          <mat-icon>note_add</mat-icon> Hoja nueva
        </button>
        <span class="cp-spacer"></span>
        <button mat-button (click)="cancelar()">Cancelar</button>
        <button mat-flat-button class="cp-imprimir" [disabled]="seleccion() === null" (click)="aceptar()">
          <mat-icon>print</mat-icon> Generar
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    :host { --azul: #21263c; --linea: #e2e8f0; --muted: #64748b; --ok: #2e7d32; display: block; }

    .cp-wrap { min-width: min(480px, 88vw); }

    .cp-head {
      display: flex; align-items: center; gap: 12px;
      padding: 16px 20px 14px; border-bottom: 1px solid var(--linea);
    }
    .cp-head-ic {
      display: grid; place-items: center; width: 40px; height: 40px;
      border-radius: 11px; background: var(--azul); color: #fff; flex: 0 0 auto;
    }
    .cp-head-txt h2 { margin: 0; font-size: 1.02rem; font-weight: 700; color: var(--azul); }
    .cp-head-txt p { margin: 2px 0 0; font-size: .78rem; color: var(--muted); }

    .cp-body { padding: 18px 20px 4px !important; }

    /* Proporción de hoja carta horizontal, para que se lea como la hoja real. */
    .cp-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      padding: 10px;
      border: 1px solid var(--linea);
      border-radius: 12px;
      background: #f8fafc;
    }

    .cp-celda {
      display: grid;
      place-items: center;
      aspect-ratio: 85.6 / 54;      /* tamaño real del carnet (CR80) */
      border: 1.5px dashed #cbd5e1;
      border-radius: 8px;
      background: #fff;
      cursor: pointer;
      color: var(--muted);
      font: inherit;
      transition: border-color .15s, background .15s, transform .1s;
    }

    .cp-celda:hover { border-color: #94a3b8; transform: translateY(-1px); }
    .cp-num { font-size: .82rem; font-weight: 700; color: #cbd5e1; }

    .cp-celda.elegida {
      border: 2px solid var(--azul);
      border-style: solid;
      background: #eef2ff;
      color: var(--azul);
    }

    .cp-celda.usada {
      border-style: solid;
      border-color: #e2e8f0;
      background: repeating-linear-gradient(45deg, #f1f5f9, #f1f5f9 5px, #e9eef5 5px, #e9eef5 10px);
      color: #94a3b8;
      cursor: not-allowed;
    }

    .cp-celda.usada:hover { transform: none; border-color: #e2e8f0; }

    .cp-ic-elegida { color: var(--azul); }
    .cp-ic-usada { width: 17px; height: 17px; font-size: 17px; }

    .cp-leyenda {
      display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
      margin: 12px 0 0; font-size: .74rem; color: var(--muted);
    }
    .cp-chip {
      display: inline-block; width: 12px; height: 12px; border-radius: 3px;
      border: 1.5px dashed #cbd5e1; background: #fff; margin-left: 8px;
    }
    .cp-chip:first-child { margin-left: 0; }
    .cp-chip-elegida { border: 2px solid var(--azul); background: #eef2ff; }
    .cp-chip-usada {
      border: 1.5px solid #e2e8f0;
      background: repeating-linear-gradient(45deg, #f1f5f9, #f1f5f9 3px, #e9eef5 3px, #e9eef5 6px);
    }

    .cp-aviso {
      display: flex; align-items: center; gap: 6px;
      margin: 10px 0 0; font-size: .76rem; color: #b45309;
    }
    .cp-aviso .mat-icon { width: 17px; height: 17px; font-size: 17px; }

    .cp-impresion { display: block; margin-top: 14px; }

    .cp-actions { display: flex; align-items: center; gap: 8px; padding: 8px 20px 16px !important; }
    .cp-spacer { flex: 1; }
    .cp-imprimir {
      --mdc-filled-button-container-color: var(--azul);
      background: var(--azul); color: #fff; font-weight: 600;
      border-radius: 999px; padding: 0 20px;
    }
    .cp-imprimir[disabled] { opacity: .45; }
  `],
})
export class CarnetPosicionDialogComponent {
  readonly celdas = Array.from({ length: CARNETS_POR_HOJA }, (_, i) => i);
  readonly columnas = CARNET_COLUMNAS;

  readonly usadas = signal<number[]>(celdasUsadas());
  readonly seleccion = signal<number | null>(null);

  readonly sinLibres = computed(() => this.usadas().length >= CARNETS_POR_HOJA);

  /** Formato elegido antes de abrir el diálogo; define el nombre del volteo. */
  readonly formato: FormatoCarnet;

  constructor(
    private readonly ref: MatDialogRef<CarnetPosicionDialogComponent, CarnetPosicionResult | null>,
    @Optional() @Inject(MAT_DIALOG_DATA) data: CarnetPosicionData | null,
  ) {
    this.formato = data?.formato ?? 'apoyo';
    this.seleccion.set(this.primeraLibre());
  }

  /** Sugerencia por defecto: el primer espacio que no se ha recortado. */
  private primeraLibre(): number | null {
    const usadas = new Set(this.usadas());
    for (const c of this.celdas) if (!usadas.has(c)) return c;
    return null;
  }

  hojaNueva(): void {
    reiniciarHoja();
    this.usadas.set([]);
    this.seleccion.set(0);
  }

  aceptar(): void {
    const c = this.seleccion();
    if (c === null) return;
    marcarCeldaUsada(c);
    // El volteo lo persiste el bloque de impresión al tocarlo; acá se lee el
    // valor vigente para armar el PDF con él.
    this.ref.close({ celda: c, impresion: leerImpresion() });
  }

  cancelar(): void {
    this.ref.close(null);
  }
}
