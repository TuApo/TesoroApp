import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { AtencionPersona, TurnosService } from '../../service/turnos.service';

/**
 * La etiqueta "atendido remotamente por…" en el registro de la persona: contratación
 * sabe quién la atendió por videollamada y desde qué oficina. Solo se pinta si hay
 * alguna atención remota; el resto de atenciones va en el título.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-etiqueta-atencion-remota',
  imports: [MatIconModule],
  template: `
    @if (remota(); as a) {
      <span class="etiqueta" [title]="titulo()">
        <mat-icon>video_camera_front</mat-icon>
        Atendido remotamente{{ a.atendido_por_nombre ? ' por ' + a.atendido_por_nombre : '' }}{{ a.atendido_desde_oficina_nombre ? ' desde ' + a.atendido_desde_oficina_nombre : '' }}{{ fecha(a) ? ' · ' + fecha(a) : '' }}
      </span>
    }
  `,
  styles: [`
    :host { display: contents; }
    .etiqueta { display: inline-flex; align-items: center; gap: 5px; margin-top: 4px; padding: 3px 10px; border-radius: 999px; font-size: 11.5px; font-weight: 700; background: var(--info-bg, #dbeafe); color: var(--info-fg, #1e40af); border: 1px solid var(--info-border, #93c5fd); max-width: 100%; }
    .etiqueta mat-icon { font-size: 15px; width: 15px; height: 15px; }
  `],
})
export class EtiquetaAtencionRemota {
  readonly documento = input<string | null>(null);
  private api = inject(TurnosService);
  readonly remota = signal<AtencionPersona | null>(null);
  readonly titulo = signal('');

  constructor() {
    effect(() => {
      const doc = (this.documento() || '').replace(/\./g, '').trim();
      untracked(() => this.cargar(doc));
    });
  }

  private cargar(doc: string): void {
    this.remota.set(null);
    if (!/^[xX]?\d{4,}$/.test(doc)) return;
    this.api.atencionesDePersona(doc).subscribe({
      next: lista => {
        const remotas = lista.filter(a => a.remoto);
        this.remota.set(remotas[0] ?? null);
        const total = lista.length;
        this.titulo.set(`${remotas.length} atención${remotas.length === 1 ? '' : 'es'} remota${remotas.length === 1 ? '' : 's'} de ${total} en turnos` + (remotas[0]?.servicio_nombre ? ` · última: ${remotas[0].servicio_nombre}` : ''));
      },
      error: () => this.remota.set(null),
    });
  }

  fecha(a: AtencionPersona): string {
    const iso = a.iniciado_en || a.finalizado_en;
    if (!iso) return a.fecha;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? a.fecha : d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
  }
}
