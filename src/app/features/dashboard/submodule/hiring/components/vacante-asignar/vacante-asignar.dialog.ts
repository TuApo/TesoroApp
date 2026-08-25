import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { SharedModule } from '@/app/shared/shared.module';

/** Lo que la lista necesita saber de cada vacante. */
export interface VacanteOpcion {
  id: number;
  empresa: string;
  finca: string;
  cargo: string;
  codigo: string | null;
  temporal: string | null;
  oficinas: string;
  publicada: string | null;
  /** Cupos pedidos y cuántos faltan por llenar. */
  requeridos: number;
  faltantes: number;
  /** Ya no admite gente, pero se muestra si es la que está asignada. */
  cerrada: boolean;
}

export interface VacanteAsignarData {
  opciones: readonly VacanteOpcion[];
  /** La que tiene ahora, para marcarla y para no esconderla si está cerrada. */
  actual: number | null;
  candidato: string | null;
}

/** Lo que devuelve el diálogo: una vacante, o quitar la que tenga. */
export type VacanteAsignarResultado = { id: number } | { quitar: true };

/** Sin tildes y en minúscula: se busca como se teclea, no como se escribe. */
function normalizar(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * A qué vacante se remite a la persona.
 *
 * El `mat-select` de Remisión servía cuando había pocas: es un desplegable
 * agrupado por empresa y finca, con un filtro que exige que TODO lo tecleado
 * aparezca seguido en un mismo campo. Con cientos de publicaciones abiertas,
 * buscar "jardines rosas cosecha" no encontraba nada aunque esas tres palabras
 * estuvieran —cada una en un campo distinto— en la vacante que se buscaba.
 *
 * Aquí cada palabra se busca por separado y tienen que estar TODAS, sin
 * importar el orden ni en qué campo caiga cada una. Es lo que la gente ya hace
 * sin pensarlo: teclear tres pedazos de lo que recuerda.
 */
@Component({
  selector: 'app-vacante-asignar-dialog',
  standalone: true,
  imports: [SharedModule, MatDialogModule, MatIconModule],
  templateUrl: './vacante-asignar.dialog.html',
  styleUrls: ['./vacante-asignar.dialog.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VacanteAsignarDialogComponent {
  readonly data = inject<VacanteAsignarData>(MAT_DIALOG_DATA);
  private readonly ref =
    inject<MatDialogRef<VacanteAsignarDialogComponent, VacanteAsignarResultado | undefined>>(MatDialogRef);

  readonly consulta = signal<string>('');

  /** Cuántas se pintan de una vez: más allá, la lista deja de leerse. */
  private readonly TOPE = 60;

  /** Texto sobre el que se busca, precalculado una vez por vacante. */
  private readonly indice = computed(() => {
    const m = new Map<number, string>();
    for (const o of this.data.opciones) {
      m.set(o.id, normalizar([
        o.empresa, o.finca, o.cargo, o.codigo, o.temporal, o.oficinas,
      ].filter(Boolean).join(' ')));
    }
    return m;
  });

  readonly resultados = computed<VacanteOpcion[]>(() => {
    const tokens = normalizar(this.consulta()).split(/\s+/).filter(Boolean);
    const idx = this.indice();

    const pasa = (o: VacanteOpcion) => {
      // La asignada siempre se ve: si no, quitarla obligaría a buscarla.
      if (o.id === this.data.actual) return true;
      if (o.cerrada) return false;
      if (!tokens.length) return true;
      const texto = idx.get(o.id) ?? '';
      // TODAS las palabras, en cualquier campo y en cualquier orden.
      return tokens.every((t) => texto.includes(t));
    };

    return this.data.opciones.filter(pasa);
  });

  readonly visibles = computed(() => this.resultados().slice(0, this.TOPE));
  readonly ocultas = computed(() => Math.max(0, this.resultados().length - this.TOPE));

  elegir(o: VacanteOpcion): void {
    this.ref.close({ id: o.id });
  }

  quitar(): void {
    this.ref.close({ quitar: true });
  }

  cerrar(): void {
    this.ref.close();
  }

  limpiar(): void {
    this.consulta.set('');
  }

  alEscribir(ev: Event): void {
    this.consulta.set((ev.target as HTMLInputElement).value);
  }
}
