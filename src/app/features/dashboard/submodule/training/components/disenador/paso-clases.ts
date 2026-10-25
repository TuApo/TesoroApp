import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';

import { Diseno, DisenadorService, LeccionP, ModuloP, mensajeDeError } from '../../service/disenador.service';

/**
 * Paso 4: las clases escritas. A la izquierda el temario con el estado de cada clase; a la
 * derecha la clase elegida tal como la verá quien la curse: el texto, las preguntas (con la
 * correcta marcada, para revisarla) y las actividades.
 *
 * Una clase que no quedó bien se reescribe sola, sin tocar las demás.
 */
@Component({
  selector: 'app-paso-clases',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule],
  templateUrl: './paso-clases.html',
  styleUrls: ['./pasos.css', './paso-clases.css'],
})
export class PasoClases implements OnChanges {
  @Input({ required: true }) diseno!: Diseno;
  @Input() ocupado = false;
  @Output() cambio = new EventEmitter<Diseno>();
  @Output() ir = new EventEmitter<'estructura' | 'medios' | 'crear'>();

  private api = inject(DisenadorService);
  private readonly dis = signal<Diseno | null>(null);
  readonly elegida = signal<string | null>(null);

  readonly modulos = computed<ModuloP[]>(() => this.dis()?.propuesta?.modulos ?? []);
  readonly lecciones = computed<LeccionP[]>(() => this.modulos().flatMap(m => m.lecciones));
  readonly listas = computed(() => this.lecciones().filter(l => l.estado_detalle === 'LISTO').length);
  readonly conError = computed(() => this.lecciones().filter(l => l.estado_detalle === 'ERROR').length);
  readonly actual = computed<LeccionP | null>(() => {
    const clave = this.elegida();
    const ls = this.lecciones();
    return ls.find(l => l.clave === clave) ?? ls.find(l => l.estado_detalle === 'LISTO') ?? ls[0] ?? null;
  });

  ngOnChanges(): void {
    this.dis.set(this.diseno);
  }

  estado(l: LeccionP): 'LISTO' | 'ERROR' | 'PENDIENTE' {
    return l.estado_detalle === 'LISTO' ? 'LISTO' : l.estado_detalle === 'ERROR' ? 'ERROR' : 'PENDIENTE';
  }

  async escribir(claves: string[] = [], rehacer = false): Promise<void> {
    try {
      this.cambio.emit(await this.api.detallar(this.diseno.id, claves, rehacer));
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo empezar', text: mensajeDeError(e) });
    }
  }

  letra(i: number): string {
    return String.fromCharCode(65 + i);
  }
}
