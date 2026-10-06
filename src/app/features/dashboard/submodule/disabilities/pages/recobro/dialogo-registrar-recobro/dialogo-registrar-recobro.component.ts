/**
 * "Registrar radicado de recobro" para las incapacidades marcadas en la bandeja (una o varias:
 * la EPS tambien puede devolver un solo radicado para la PQR de varias). Mismo formulario que la
 * radicacion: numero, fecha, donde y observaciones; quien radico lo pone el backend.
 *
 * No cambia el radicado inicial ni el estado de la incapacidad: queda como un radicado mas,
 * amarrado a la ultima negacion. Las que fallan se quedan en el dialogo con su motivo.
 */
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import Swal from 'sweetalert2';

import { swalEnDialogo } from '../../../../../../../shared/utils/swal-en-dialogo';
import type { RecobroItem, ResultadoAsignacionRadicado } from '../../../models/incapacidad-salud.model';
import { IncapacidadSaludService } from '../../../services/incapacidad-salud/incapacidad-salud.service';
import { FormularioRadicadoComponent } from '../../radicacion/componentes/formulario-radicado/formulario-radicado.component';
import { ResultadoRadicadoComponent } from '../../radicacion/componentes/resultado-radicado/resultado-radicado.component';
import {
  DatosRadicado,
  MAX_CODIGOS_POR_BUSQUEDA,
  avisarGuardadoEnCola,
  codigoVisible,
  confirmarRadicado,
  entidadDe,
  fechaCorta,
  mensajeError,
  quedoEnCola,
} from '../../radicacion/radicacion.utils';
import { causalHomologada, ultimoRecobro } from '../recobro.utils';

export interface DatosDialogoRegistrarRecobro {
  items: RecobroItem[];
}

export interface ResultadoDialogoRegistrarRecobro {
  recargar: boolean;
}

export const ANCHO_DIALOGO_REGISTRAR_RECOBRO = '760px';

@Component({
  selector: 'app-dialogo-registrar-recobro',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    FormularioRadicadoComponent,
    ResultadoRadicadoComponent,
  ],
  templateUrl: './dialogo-registrar-recobro.component.html',
  styleUrls: [
    '../../gestion-incapacidades.comun.css',
    '../../radicacion/radicacion.comun.css',
    './dialogo-registrar-recobro.component.css',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogoRegistrarRecobroComponent {
  private readonly srv = inject(IncapacidadSaludService);
  private readonly ref = inject<MatDialogRef<DialogoRegistrarRecobroComponent, ResultadoDialogoRegistrarRecobro>>(MatDialogRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly datos = inject<DatosDialogoRegistrarRecobro>(MAT_DIALOG_DATA);
  private readonly formulario = viewChild(FormularioRadicadoComponent);

  /** Las que faltan por registrar (las guardadas salen de la lista). */
  readonly items = signal<RecobroItem[]>([...(this.datos.items ?? [])]);
  readonly errores = signal<ReadonlyMap<number, string>>(new Map());
  readonly guardando = signal(false);
  readonly resultado = signal<ResultadoAsignacionRadicado | null>(null);
  readonly numeroGuardado = signal<string | null>(null);
  readonly total = this.datos.items?.length ?? 0;
  private huboCambios = false;

  readonly codigoVisible = codigoVisible;
  readonly entidadDe = entidadDe;
  readonly fechaCorta = fechaCorta;
  readonly causalHomologada = causalHomologada;
  readonly ultimoRecobro = ultimoRecobro;

  constructor() {
    // Cerrar por fondo o Esc tambien debe avisar si algo quedo guardado.
    this.ref.disableClose = true;
    this.ref.backdropClick().pipe(takeUntilDestroyed()).subscribe(() => this.cerrar());
    this.ref
      .keydownEvents()
      .pipe(takeUntilDestroyed())
      .subscribe((e) => {
        if (e.key === 'Escape' && !Swal.isVisible() && !this.guardando()) this.cerrar();
      });
  }

  bloqueo(): string | null {
    const n = this.items().length;
    return n > MAX_CODIGOS_POR_BUSQUEDA ? `Máximo ${MAX_CODIGOS_POR_BUSQUEDA} por registro.` : null;
  }

  quitar(item: RecobroItem): void {
    this.items.update((l) => l.filter((x) => x.incapacidad.id !== item.incapacidad.id));
  }

  async guardar(datos: DatosRadicado): Promise<void> {
    const items = this.items();
    if (!items.length || this.guardando()) return;
    const confirmado = await confirmarRadicado({ modo: 'RECOBRO', datos, cantidad: items.length, enDialogo: true });
    if (!confirmado) return;

    this.guardando.set(true);
    this.srv
      .registrarRecobro({ incapacidadIds: items.map((i) => i.incapacidad.id), ...datos })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          this.guardando.set(false);
          // 200 falso de la cola offline: no llego al servidor; las incapacidades se quedan.
          if (quedoEnCola(r)) {
            avisarGuardadoEnCola(true);
            return;
          }
          const resultados = r?.resultados ?? [];
          const okIds = new Set(resultados.filter((x) => x.ok).map((x) => x.incapacidadId));
          const errores = new Map<number, string>();
          for (const x of resultados) if (!x.ok) errores.set(x.incapacidadId, x.mensaje || 'Error sin detalle');
          this.items.update((l) => l.filter((i) => !okIds.has(i.incapacidad.id)));
          this.errores.set(errores);
          this.resultado.set(r);
          this.numeroGuardado.set(datos.numeroRadicado);
          if (okIds.size > 0) {
            this.huboCambios = true;
            this.formulario()?.reiniciar();
          }
        },
        error: (e: unknown) => {
          this.guardando.set(false);
          void Swal.fire({
            ...swalEnDialogo(),
            icon: 'error',
            title: 'No se pudo registrar el recobro',
            text: mensajeError(e, 'Intente de nuevo en un momento.'),
          });
        },
      });
  }

  /**
   * Mientras guarda no se cierra (ni por fondo, ni Esc, ni boton): cerrar cancelaba la suscripcion,
   * el backend podia guardar igual y la bandeja no se enteraba ni el usuario veia el resultado.
   */
  cerrar(): void {
    if (this.guardando()) return;
    this.ref.close({ recargar: this.huboCambios });
  }
}
