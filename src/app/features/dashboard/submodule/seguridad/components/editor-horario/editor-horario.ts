import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { DIAS_SEMANA, TramoHorario } from '../../models/seguridad.models';

const aMin = (h: string) => { const [a, b] = (h || '0:0').split(':').map(Number); return (a || 0) * 60 + (b || 0); };

/** Noches de toda la semana 19→06 + sábado y domingo de día: cubre todo sin huecos ni 23:59. */
export const HORARIO_FUERA_LABORAL: TramoHorario[] = [
  { dias: [1, 2, 3, 4, 5, 6, 7], desde: '19:00', hasta: '06:00' },
  { dias: [6, 7], desde: '06:00', hasta: '19:00' },
];

interface Segmento { izq: number; ancho: number; tramo: number; arrastre: boolean; texto: string; }

/**
 * Horario de armado semanal de una regla. Salida = el arreglo `horario` del contrato:
 * `[{dias:[1..7], desde:"HH:mm", hasta:"HH:mm"}]` (1 = lunes). Un tramo con `desde` mayor
 * que `hasta` cruza la medianoche (lunes 19:00 → martes 06:00) y así se pinta: la parte de
 * después de medianoche aparece en el día siguiente, más tenue. Sin tramos = armada 24/7.
 */
@Component({
  selector: 'sg-editor-horario',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './editor-horario.html',
  styleUrls: ['./editor-horario.css'],
})
export class EditorHorario {
  readonly horario = model<TramoHorario[]>([]);
  readonly soloLectura = input(false);

  readonly dias = DIAS_SEMANA;
  readonly marcas = [0, 6, 12, 18, 24];

  // Formulario para agregar un tramo
  readonly diasNuevo = signal<number[]>([1, 2, 3, 4, 5]);
  desde = '19:00';
  hasta = '06:00';
  readonly error = signal<string | null>(null);

  readonly siempre = computed(() => this.horario().length === 0);

  /** Segmentos a pintar por día (1..7), incluyendo la cola de los tramos que cruzan medianoche. */
  readonly segmentos = computed(() => {
    const m = new Map<number, Segmento[]>();
    for (const d of DIAS_SEMANA) m.set(d.n, []);
    this.horario().forEach((t, idx) => {
      const a = aMin(t.desde), b = aMin(t.hasta);
      const texto = `${t.desde}–${t.hasta}`;
      for (const d of t.dias) {
        if (a < b) m.get(d)?.push({ izq: a / 14.4, ancho: (b - a) / 14.4, tramo: idx, arrastre: false, texto });
        else {
          m.get(d)?.push({ izq: a / 14.4, ancho: (1440 - a) / 14.4, tramo: idx, arrastre: false, texto });
          const sig = d === 7 ? 1 : d + 1;
          if (b > 0) m.get(sig)?.push({ izq: 0, ancho: b / 14.4, tramo: idx, arrastre: true, texto: `${texto} (viene del día anterior)` });
        }
      }
    });
    return m;
  });

  /** Para la lista: "Lun–Vie · 19:00 → 06:00 (día siguiente)". */
  descripcion(t: TramoHorario): string {
    const ds = [...t.dias].sort((a, b) => a - b);
    let dias: string;
    const seguidos = ds.length > 2 && ds.every((d, i) => i === 0 || d === ds[i - 1] + 1);
    if (ds.length === 7) dias = 'Todos los días';
    else if (seguidos) dias = `${DIAS_SEMANA[ds[0] - 1].corto}–${DIAS_SEMANA[ds[ds.length - 1] - 1].corto}`;
    else dias = ds.map((d) => DIAS_SEMANA[d - 1]?.corto).join(', ');
    const cruza = aMin(t.desde) >= aMin(t.hasta);
    return `${dias} · ${t.desde} → ${t.hasta}${cruza ? ' (día siguiente)' : ''}`;
  }

  alternarDia(n: number): void {
    this.diasNuevo.update((l) => (l.includes(n) ? l.filter((x) => x !== n) : [...l, n].sort((a, b) => a - b)));
  }

  /** "+" de una fila: deja ese día solo en el formulario. */
  preparar(n: number): void { this.diasNuevo.set([n]); }

  agregar(): void {
    this.error.set(null);
    if (!this.diasNuevo().length) { this.error.set('Elija al menos un día.'); return; }
    if (!/^\d{2}:\d{2}$/.test(this.desde) || !/^\d{2}:\d{2}$/.test(this.hasta)) { this.error.set('Escriba las horas como HH:mm.'); return; }
    if (this.desde === this.hasta) { this.error.set('"Desde" y "hasta" no pueden ser iguales. Para todo el día use 00:00 → 23:59, o deje el horario vacío (24/7).'); return; }
    this.horario.set([...this.horario(), { dias: [...this.diasNuevo()], desde: this.desde, hasta: this.hasta }]);
  }

  quitar(i: number): void { this.horario.set(this.horario().filter((_, k) => k !== i)); }

  presetFueraLaboral(): void { this.horario.set(HORARIO_FUERA_LABORAL.map((t) => ({ ...t, dias: [...t.dias] }))); }
  preset247(): void { this.horario.set([]); }
  presetLaboral(): void { this.horario.set([{ dias: [1, 2, 3, 4, 5], desde: '07:00', hasta: '19:00' }]); }
}
