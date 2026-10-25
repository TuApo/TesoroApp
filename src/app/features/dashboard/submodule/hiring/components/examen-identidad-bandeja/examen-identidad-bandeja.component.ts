import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import Swal from 'sweetalert2';
import {
  ExamenIdentidadApi,
  ItemBandejaIdentidad,
} from '../../pages/recruitment-pipeline/examen-identidad';

/**
 * Exámenes médicos que no son (o no se sabe si son) del trabajador al que se
 * le cargaron. Llegan sobre todo por la sincronización del legacy, donde nadie
 * está mirando la pantalla al cargar: ms-documents los verifica cada 5 minutos
 * y los deja aquí para que alguien los revise.
 */
@Component({
  selector: 'app-examen-identidad-bandeja',
  standalone: true,
  imports: [DatePipe, MatButtonModule, MatIconModule, MatProgressBarModule, MatTooltipModule],
  templateUrl: './examen-identidad-bandeja.component.html',
  styleUrl: './examen-identidad-bandeja.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExamenIdentidadBandejaComponent implements OnInit {
  private readonly api = inject(ExamenIdentidadApi);

  readonly items = signal<ItemBandejaIdentidad[]>([]);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly verRevisados = signal(false);

  readonly noCoinciden = computed(() => this.items().filter((i) => i.resultado === 'NO_COINCIDE' && !i.revision).length);
  readonly ilegibles = computed(() => this.items().filter((i) => i.resultado === 'NO_VERIFICABLE' && !i.revision).length);

  ngOnInit(): void {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const r = await firstValueFrom(this.api.bandeja(this.verRevisados()));
      this.items.set(r.items ?? []);
    } catch {
      this.error.set('No se pudo cargar la lista. Intenta de nuevo.');
    } finally {
      this.cargando.set(false);
    }
  }

  alternarRevisados(): void {
    this.verRevisados.update((v) => !v);
    void this.cargar();
  }

  etiquetaRevision(r: string | null): string {
    switch (r) {
      case 'ES_DEL_TRABAJADOR': return 'Confirmado: es del trabajador';
      case 'ES_DE_OTRA_PERSONA': return 'Es de otra persona';
      case 'CARGADO_CON_JUSTIFICACION': return 'Cargado con justificación';
      default: return '';
    }
  }

  async revisar(item: ItemBandejaIdentidad, decision: 'ES_DEL_TRABAJADOR' | 'ES_DE_OTRA_PERSONA'): Promise<void> {
    const otra = decision === 'ES_DE_OTRA_PERSONA';
    const r = await Swal.fire({
      icon: otra ? 'warning' : 'question',
      title: otra ? 'Marcar como examen de otra persona' : 'Confirmar que es del trabajador',
      html: otra
        ? 'Queda registrado. Después <b>retira o reemplaza el PDF</b> en el expediente y pide el examen correcto a la IPS.'
        : 'Queda registrado quién lo confirmó y por qué.',
      input: 'textarea',
      inputPlaceholder: otra ? 'Ej.: el examen es de Carlos Díaz, CC 79…' : 'Ej.: lo abrí y la cédula sí es la del trabajador.',
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      reverseButtons: true,
      inputValidator: (v) => (!v || v.trim().length < 5) ? 'Escribe el motivo.' : undefined,
    });
    if (!r.isConfirmed) return;
    try {
      await firstValueFrom(this.api.revisar(item.document_id, decision, String(r.value).trim()));
      await this.cargar();
    } catch {
      await Swal.fire({ icon: 'error', title: 'No se pudo guardar', text: 'Revisa la conexión e inténtalo de nuevo.' });
    }
  }
}
