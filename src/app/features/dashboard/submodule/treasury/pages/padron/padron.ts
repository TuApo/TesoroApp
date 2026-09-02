import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';

import {
  CargaPadron, FormatoPadron, ResultadoCargaPadron, TesoreriaApiService,
} from '../../service/tesoreria-api.service';

/**
 * Padrón de activos: la carga de la que sale el tope REAL y el paz y salvo.
 *
 * <h3>Por qué manda este archivo</h3>
 * El tope que calcula la regla de antigüedad es una estimación a partir de una fecha de
 * ingreso que en tesorería es texto libre en cuatro formatos. El archivo de personal
 * activo lo arma quien conoce la nómina de esa quincena: sabe quién entró, quién salió,
 * quién quedó debiendo y cuánto se le puede autorizar.
 *
 * <h3>Por qué subir y activar son dos pasos</h3>
 * Activar cambia el tope de miles de personas a la vez. Poder ver antes cuántas filas
 * entraron, cuántas fallaron y cuánta gente del archivo ni siquiera existe en tesorería
 * evita descubrirlo por una llamada del mostrador media hora después.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-tesoreria-padron',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './padron.html',
  styleUrls: ['../../styles/tesoreria-comun.css', './padron.css'],
})
export class PadronActivos implements OnInit {

  private api = inject(TesoreriaApiService);

  readonly cargas = signal<CargaPadron[]>([]);
  readonly vigente = signal<any>(null);
  readonly formato = signal<FormatoPadron | null>(null);
  readonly resumen = signal<any>(null);

  readonly cargando = signal(true);
  readonly subiendo = signal(false);
  readonly ultimoResultado = signal<ResultadoCargaPadron | null>(null);
  readonly verFormato = signal(false);

  archivo: File | null = null;
  fechaCorte = new Date().toISOString().slice(0, 10);
  observacion = '';
  activarAlSubir = false;

  ngOnInit(): void { this.cargar(); }

  private cargar(): void {
    this.cargando.set(true);
    this.api.cargasDePadron().subscribe({
      next: c => { this.cargas.set(c); this.cargando.set(false); },
      error: () => this.cargando.set(false),
    });
    this.api.padronVigente().subscribe({ next: v => this.vigente.set(v) });
    this.api.formatoDelPadron().subscribe({ next: f => this.formato.set(f) });
  }

  alElegirArchivo(evento: Event): void {
    const input = evento.target as HTMLInputElement;
    this.archivo = input.files?.[0] ?? null;
  }

  subir(): void {
    if (!this.archivo) {
      Swal.fire({ icon: 'warning', title: 'Falta el archivo',
        text: 'Elige el Excel de personal activo.' });
      return;
    }
    this.subiendo.set(true);
    this.ultimoResultado.set(null);

    this.api.subirPadron(this.archivo, this.fechaCorte, this.activarAlSubir, this.observacion)
      .subscribe({
        next: r => {
          this.subiendo.set(false);
          this.ultimoResultado.set(r);
          this.archivo = null;
          this.cargar();

          if (r.filas_error > 0) {
            Swal.fire({ icon: 'warning', title: 'Cargado con errores',
              html: `Entraron <b>${r.filas_ok}</b> filas y fallaron <b>${r.filas_error}</b>.
                     Revisa el detalle abajo.` });
          } else {
            Swal.fire({ icon: 'success', title: 'Padrón cargado',
              html: `<b>${r.filas_ok}</b> personas.` +
                    (r.activada ? ` Ya está vigente y se cruzaron
                                    <b>${r.personas_cruzadas}</b> con tesorería.`
                                : ' Revisa el resumen y actívalo cuando esté bien.'),
              timer: r.activada ? undefined : 4000,
            });
          }
        },
        error: e => {
          this.subiendo.set(false);
          Swal.fire({ icon: 'error', title: 'No se pudo cargar',
            text: e?.error?.error ?? 'Revisa que el archivo sea un Excel válido.' });
        },
      });
  }

  async activar(c: CargaPadron): Promise<void> {
    const { isConfirmed } = await Swal.fire({
      icon: 'question',
      title: 'Activar este padrón',
      html: `<p style="text-align:left;font-size:13.5px;color:#5c6660">
               Pasa a ser el padrón vigente. A partir de ese momento, el tope y el paz y
               salvo de <b>${c.filas_ok}</b> personas salen de esta carga
               (corte ${c.fecha_corte}).<br><br>
               Quien no aparezca aquí deja de figurar como activo en el padrón.
             </p>`,
      showCancelButton: true,
      confirmButtonText: 'Activar',
      cancelButtonText: 'Volver',
      confirmButtonColor: '#0b6b58',
    });
    if (!isConfirmed) return;

    this.api.activarCarga(c.id).subscribe({
      next: (r: any) => {
        Swal.fire({ icon: 'success', title: 'Padrón activado',
          text: `${r.personas_cruzadas} personas cruzadas con tesorería.` });
        this.cargar();
      },
      error: e => Swal.fire({ icon: 'error', title: 'No se pudo activar',
        text: e?.error?.error ?? '' }),
    });
  }

  async anular(c: CargaPadron): Promise<void> {
    const { value: motivo, isConfirmed } = await Swal.fire({
      icon: 'warning',
      title: 'Anular esta carga',
      html: c.vigente
        ? `<p style="text-align:left;font-size:13.5px;color:#5c6660">
             Es la carga <b>vigente</b>. Al anularla, el padrón se queda sin carga activa y
             las condiciones que dependen de él pasan a «sin datos».
           </p>`
        : `<p style="text-align:left;font-size:13.5px;color:#5c6660">
             La carga queda marcada como anulada y no se podrá activar.</p>`,
      input: 'text',
      inputPlaceholder: '¿Por qué se anula?',
      inputValidator: v => (!v || !v.trim()) ? 'Di por qué se anula' : null,
      showCancelButton: true,
      confirmButtonText: 'Anular',
      cancelButtonText: 'Volver',
      confirmButtonColor: '#a33328',
    });
    if (!isConfirmed || !motivo) return;

    this.api.anularCarga(c.id, motivo).subscribe({
      next: () => this.cargar(),
      error: e => Swal.fire({ icon: 'error', title: 'No se pudo anular',
        text: e?.error?.error ?? '' }),
    });
  }

  verResumen(c: CargaPadron): void {
    this.resumen.set(null);
    this.api.resumenDeCarga(c.id).subscribe({
      next: r => this.resumen.set(r),
      error: () => this.resumen.set({ error: 'No se pudo cargar el resumen.' }),
    });
  }

  cerrarResumen(): void { this.resumen.set(null); }

  claseDeCarga(c: CargaPadron): string {
    if (c.estado === 'ANULADA') return 'gris';
    if (c.vigente) return 'verde';
    if (c.estado === 'CON_ERRORES') return 'ambar';
    return 'azul';
  }

  textoDeCarga(c: CargaPadron): string {
    if (c.estado === 'ANULADA') return 'Anulada';
    if (c.vigente) return 'Vigente';
    if (c.estado === 'CON_ERRORES') return 'Con errores';
    return 'Cargada';
  }
}
