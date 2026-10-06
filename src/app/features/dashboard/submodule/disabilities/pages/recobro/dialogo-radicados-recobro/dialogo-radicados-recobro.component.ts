/**
 * "Ver radicados" de una incapacidad en recobro: TODOS sus radicados (el inicial y cada recobro)
 * con su fecha, canal y quien lo registro, como pidio la funcional para el seguimiento. Un recobro
 * mal digitado se ANULA (no se borra: queda tachado); el radicado inicial no se anula, se corrige
 * volviendo a radicar desde Radicacion.
 */
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import Swal from 'sweetalert2';

import { swalEnDialogo } from '../../../../../../../shared/utils/swal-en-dialogo';
import type { RadicadoItem, RecobroItem } from '../../../models/incapacidad-salud.model';
import { IncapacidadSaludService } from '../../../services/incapacidad-salud/incapacidad-salud.service';
import {
  ICONO_DONDE,
  codigoVisible,
  entidadDe,
  escaparHtml,
  etiquetaDonde,
  fechaCorta,
  fechaHora,
  mensajeError,
  periodo,
} from '../../radicacion/radicacion.utils';
import { causalHomologada, rotularRadicados } from '../recobro.utils';

export interface DatosDialogoRadicados {
  item: RecobroItem;
}

/** Al cerrar: `recargar` si se anulo algo y la bandeja debe refrescarse. */
export interface ResultadoDialogoRadicados {
  recargar: boolean;
}

export const ANCHO_DIALOGO_RADICADOS = '720px';

@Component({
  selector: 'app-dialogo-radicados-recobro',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatProgressBarModule, MatTooltipModule],
  templateUrl: './dialogo-radicados-recobro.component.html',
  styleUrls: [
    '../../gestion-incapacidades.comun.css',
    '../../radicacion/radicacion.comun.css',
    './dialogo-radicados-recobro.component.css',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogoRadicadosRecobroComponent implements OnInit {
  private readonly srv = inject(IncapacidadSaludService);
  private readonly ref = inject<MatDialogRef<DialogoRadicadosRecobroComponent, ResultadoDialogoRadicados>>(MatDialogRef);
  private readonly destroyRef = inject(DestroyRef);
  readonly datos = inject<DatosDialogoRadicados>(MAT_DIALOG_DATA);

  readonly radicados = signal<RadicadoItem[]>([]);
  readonly cargando = signal(false);
  readonly error = signal('');
  readonly anulando = signal<number | null>(null);
  private huboCambios = false;

  readonly lineas = computed(() => rotularRadicados(this.radicados()));
  readonly vigentes = computed(() => this.radicados().filter((r) => !r.anulado).length);

  readonly inc = this.datos.item.incapacidad;
  readonly negacion = this.datos.item.negacion;
  readonly homologada = causalHomologada(this.datos.item);
  readonly codigo = codigoVisible(this.inc);
  readonly entidad = entidadDe(this.inc);
  readonly periodo = periodo(this.inc);
  readonly iconos = ICONO_DONDE;
  readonly fechaCorta = fechaCorta;
  readonly fechaHora = fechaHora;
  readonly etiquetaDonde = etiquetaDonde;

  constructor() {
    // Cerrar por fondo o Esc tambien debe avisar si se anulo algo: se maneja aqui en vez de
    // dejar que el CDK cierre sin resultado (con un Swal abierto, el Esc es del Swal).
    this.ref.disableClose = true;
    this.ref.backdropClick().pipe(takeUntilDestroyed()).subscribe(() => this.cerrar());
    this.ref
      .keydownEvents()
      .pipe(takeUntilDestroyed())
      .subscribe((e) => {
        if (e.key === 'Escape' && !Swal.isVisible()) this.cerrar();
      });
  }

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.error.set('');
    this.srv
      .radicadosDe(this.inc.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (lista) => {
          this.radicados.set(lista ?? []);
          this.cargando.set(false);
        },
        error: (e: unknown) => {
          this.cargando.set(false);
          this.error.set(mensajeError(e, 'No se pudieron cargar los radicados de la incapacidad.'));
        },
      });
  }

  /** Solo un recobro vigente y con id (el inicial historico llega sintetico, sin id). */
  puedeAnular(r: RadicadoItem): boolean {
    return r.tipo === 'RECOBRO' && r.id != null && !r.anulado;
  }

  async anular(r: RadicadoItem): Promise<void> {
    if (!this.puedeAnular(r) || this.anulando() !== null) return;
    const respuesta = await Swal.fire({
      ...swalEnDialogo(),
      icon: 'warning',
      title: 'Anular el recobro',
      html:
        `<p style="margin:0 0 8px">Radicado <b>${escaparHtml(r.numeroRadicado)}</b> del ${escaparHtml(fechaCorta(r.fechaRadicado))}.</p>` +
        '<p style="margin:0;font-size:13px;color:#64748b">No se borra: queda anulado en el historial y deja de contar como recobro.</p>',
      input: 'textarea',
      inputLabel: 'Motivo (opcional)',
      inputPlaceholder: 'Por ejemplo: número mal digitado',
      showCancelButton: true,
      confirmButtonText: 'Anular recobro',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#c62828',
      reverseButtons: true,
    });
    if (!respuesta.isConfirmed) return;
    const motivo = typeof respuesta.value === 'string' && respuesta.value.trim() ? respuesta.value.trim() : undefined;
    this.anulando.set(r.id);
    this.srv
      .anularRadicado(r.id as number, motivo)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.anulando.set(null);
          this.huboCambios = true;
          this.cargar();
        },
        error: (e: unknown) => {
          this.anulando.set(null);
          void Swal.fire({
            ...swalEnDialogo(),
            icon: 'error',
            title: 'No se pudo anular',
            text: mensajeError(e, 'Intente de nuevo en un momento.'),
          });
        },
      });
  }

  cerrar(): void {
    this.ref.close({ recargar: this.huboCambios });
  }
}
