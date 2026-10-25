import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

import { CroquisSvg, leerMetaAreas, leerPisos, resolverDestino } from '../croquis-svg/croquis-svg';
import { Plano3d } from '../plano-3d/plano-3d';
import type { DestinoPlano } from '../plano-3d/motor-plano-3d';
import type { Croquis } from '../../service/turnos.service';

/** Lo mínimo de un turno que hace falta para saber a dónde va la persona. */
export interface TurnoDestino {
  codigo?: string | null;
  punto_id?: string | null;
  punto_nombre?: string | null;
  punto_tipo?: string | null;
  area_id?: string | null;
  area_nombre?: string | null;
  area_referencia?: string | null;
}

/**
 * El plano de la oficina para el televisor y las pantallas públicas: muestra el piso donde
 * está el puesto llamado y, MIENTRAS DURA EL LLAMADO, lo ilumina (baliza, anillos, luces del
 * área parpadeando) para que la persona sepa a dónde ir. Fuera del llamado, el plano queda
 * tranquilo (en 3D gira despacio).
 *
 * <p>3D por defecto; si el TV no tiene WebGL, o `modo="2d"`, usa el mismo dibujo 2D del cartel.
 */
@Component({
  selector: 'app-plano-oficina',
  standalone: true,
  imports: [CroquisSvg, Plano3d],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (croquis(); as c) {
      @if (usa3d()) {
        <app-plano-3d class="plano" modo="tv" calidad="baja"
          [pisos]="pisos()" [areas]="c.areas" [meta]="meta()" [escala]="escala()" [pisoId]="pisoId()" [fondo]="c.fondo_color"
          [destino]="destino3d()" (fallo)="sin3d.set(true)" />
      } @else {
        <app-croquis-svg class="plano plano--2d" [croquis]="c" [piso]="pisoId()" [resaltar]="destino()?.areaId ?? null"
          [resaltarPuesto]="destino()?.puntoId ?? null" [llamando]="llamando()" [mostrarPuestos]="mostrarPuestos()" />
      }
    }
  `,
  styles: [`
    :host { display: block; position: relative; width: 100%; height: 100%; min-height: 0; }
    .plano { display: block; width: 100%; height: 100%; }
    .plano--2d { height: auto; max-height: 100%; }
  `],
})
export class PlanoOficina {
  readonly croquis = input<Croquis | null>(null);
  readonly turno = input<TurnoDestino | null>(null);
  /** true mientras se está cantando el turno: enciende la baliza y vuela la cámara al puesto. */
  readonly llamando = input(false);
  /** 'auto' y '3d' intentan 3D (con caída a 2D); '2d' fuerza el dibujo plano. */
  readonly modo = input<'auto' | '3d' | '2d'>('auto');
  readonly mostrarPuestos = input(false);

  readonly sin3d = signal(false);
  readonly usa3d = computed(() => this.modo() !== '2d' && !this.sin3d());
  readonly pisos = computed(() => leerPisos(this.croquis()));
  readonly meta = computed(() => leerMetaAreas(this.croquis()?.elementos_json));
  readonly escala = computed(() => Number(this.croquis()?.escala_cm_px) || 2);
  readonly destino = computed(() => resolverDestino(this.croquis(), this.turno()));
  readonly pisoId = computed(() => {
    const d = this.destino();
    const pisos = this.pisos();
    return d?.pisoId && pisos.some(p => p.id === d.pisoId) ? d.pisoId : pisos[0]?.id ?? null;
  });
  readonly destino3d = computed<DestinoPlano | null>(() => {
    const d = this.destino();
    const t = this.turno();
    if (!d || !this.llamando() || !t) return null;
    const lugar = t.punto_tipo === 'MOVIL' ? `Lo atenderán en ${t.area_nombre ?? ''}` : (t.punto_nombre || t.area_nombre || '');
    return {
      areaId: d.areaId, indice: d.indice,
      titulo: t.codigo ?? null,
      subtitulo: [lugar, t.area_referencia].filter(Boolean).join(' · ') || null,
    };
  });
}
