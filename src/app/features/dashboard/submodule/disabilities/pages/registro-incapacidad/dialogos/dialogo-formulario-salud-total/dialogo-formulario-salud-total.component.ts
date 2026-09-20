/**
 * Diligenciamiento EN LINEA del "Formato para descarte de evento laboral" de Salud Total
 * (M-GINT-F103). Reunion 2026-08-20: las oficinas no sabian cual era el formulario que la
 * EPS exige; ahora se les muestra el formato oficial, se les prellenan los datos del
 * trabajador, responden las 6 preguntas SI/NO y el PDF diligenciado queda ADJUNTO como
 * soporte FORMULARIO_SALUD_TOTAL sin salir de la pantalla.
 *
 * El PDF base es una copia local del formato oficial (`assets/incapacidades/`), porque el
 * sitio de Salud Total no permite fetch desde otro origen (CORS). El llenado usa pdf-lib
 * sobre los campos AcroForm REALES del formato: NOMBRES, APELLIDOS, TELEFONO, ARL, CARGO,
 * los pares de casillas 1SI/1NO..6SI/6NO, FECHA/HORA ACCIDENTE, RELATO y FIRMA RESPONSABLE.
 *
 * Reunion 2026-09-07 (Nathalia): el "responsable del diligenciamiento" es el PROPIO
 * TRABAJADOR (no el coordinador), asi que la firma se prellena con su nombre; y el formato
 * lleva fecha y hora del accidente, obligatorias cuando alguna respuesta es SI (hubo evento).
 *
 * Devuelve al cerrar un `File` PDF listo para adjuntar, o `undefined` si se cancela.
 */

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatRadioModule } from '@angular/material/radio';

/** Prellenado con lo que ya sabe el formulario de registro. */
export interface DatosFormularioSaludTotal {
  nombres: string;
  apellidos: string;
  telefono: string;
  arl: string;
  cargo: string;
  /** Nombre de quien diligencia: el TRABAJADOR (reunion 2026-09-07). */
  responsable: string;
  cedula: string;
}

/**
 * Fecha del accidente en el formato del formulario (dd/mm/aaaa) a partir del `type="date"`
 * del navegador (aaaa-mm-dd). Vacio si no hay fecha.
 */
export function fechaAccidenteLegible(iso: string | null | undefined): string {
  if (!iso) return '';
  const partes = iso.split('-');
  if (partes.length !== 3) return iso;
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

/** true si alguna de las 6 respuestas es SI: hubo un evento y la fecha/hora son obligatorias. */
export function huboAccidente(respuestas: readonly ('SI' | 'NO')[]): boolean {
  return respuestas.some((r) => r === 'SI');
}

/** Las 6 preguntas EXACTAS del formato oficial, en el orden en que aparecen impresas. */
export const PREGUNTAS_SALUD_TOTAL: readonly string[] = [
  '¿El accidente ocurrio en el sitio de trabajo?',
  '¿Cuando ocurrio el accidente, el colaborador se encontraba cumpliendo funciones relacionadas con su trabajo?',
  '¿Cuando ocurrio el accidente, el colaborador se encontraba en actividades recreativas o deportivas permitidas por la directiva de la empresa?',
  '¿Cuando el colaborador se accidento, cumplia ordenes de su jefe inmediato?',
  '¿El colaborador se encontraba conduciendo un vehiculo propiedad de la empresa?',
  '¿El colaborador viajaba en transporte pagado por la empresa?',
];

/** Ruta del formato oficial empacado con la app (copia local por CORS). */
export const RUTA_PDF_SALUD_TOTAL = 'assets/incapacidades/formato-salud-total-descarte.pdf';

/**
 * Llena el AcroForm del formato con pdf-lib y devuelve los bytes del PDF resultante.
 * Funcion PURA respecto del DOM (recibe los bytes del PDF base): se prueba sin navegador.
 */
export async function llenarFormatoSaludTotal(
  pdfBase: ArrayBuffer,
  datos: DatosFormularioSaludTotal,
  respuestas: readonly ('SI' | 'NO')[],
  extras: { fechaAccidente?: string; horaAccidente?: string; relato?: string },
): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(pdfBase);
  const form = doc.getForm();

  const poner = (campo: string, valor: string | undefined) => {
    if (!valor) return;
    try {
      form.getTextField(campo).setText(valor);
    } catch {
      // Si Salud Total renombra un campo en una version futura del formato, el resto
      // del PDF se genera igual; el usuario puede completarlo a mano al revisarlo.
    }
  };

  poner('NOMBRES', datos.nombres);
  poner('APELLIDOS', datos.apellidos);
  poner('TELEFONO', datos.telefono);
  poner('ARL', datos.arl);
  poner('CARGO', datos.cargo);
  poner('FECHA ACCIDENTE', extras.fechaAccidente);
  poner('HORA ACCIDENTE', extras.horaAccidente);
  poner('RELATO DEL ACCIDENTE', extras.relato);
  poner('FIRMA RESPONSABLE', datos.responsable);

  respuestas.forEach((respuesta, indice) => {
    const numero = indice + 1;
    try {
      form.getCheckBox(`${numero}${respuesta}`).check();
    } catch {
      // Igual que arriba: un renombre del formato no tumba la generacion.
    }
  });

  form.updateFieldAppearances();
  return doc.save();
}

@Component({
  selector: 'app-dialogo-formulario-salud-total',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatRadioModule,
  ],
  templateUrl: './dialogo-formulario-salud-total.component.html',
  styleUrl: './dialogo-formulario-salud-total.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogoFormularioSaludTotalComponent {
  private readonly ref = inject(MatDialogRef<DialogoFormularioSaludTotalComponent, File | undefined>);
  readonly datos = inject<DatosFormularioSaludTotal>(MAT_DIALOG_DATA);

  readonly preguntas = PREGUNTAS_SALUD_TOTAL;
  readonly generando = signal(false);
  readonly error = signal('');

  /**
   * Las 6 respuestas arrancan en NO: el formato existe justamente para DESCARTAR el evento
   * laboral en una enfermedad general, asi que NO es la respuesta esperada; cualquier SI se
   * marca a conciencia.
   */
  readonly form = new FormGroup({
    respuestas: new FormGroup(
      Object.fromEntries(
        PREGUNTAS_SALUD_TOTAL.map((_, i) => [
          `p${i + 1}`,
          new FormControl<'SI' | 'NO'>('NO', { nonNullable: true, validators: [Validators.required] }),
        ]),
      ),
    ),
    relato: new FormControl('', { nonNullable: true }),
    fechaAccidente: new FormControl('', { nonNullable: true }),
    horaAccidente: new FormControl('', { nonNullable: true }),
    responsable: new FormControl(this.datos.responsable ?? '', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  /** Respuestas actuales (senal derivada del formulario). */
  readonly respuestasActuales = signal<('SI' | 'NO')[]>(PREGUNTAS_SALUD_TOTAL.map(() => 'NO'));
  /** Con algun SI, la fecha y la hora del accidente pasan a ser obligatorias. */
  readonly exigeFechaHora = computed(() => huboAccidente(this.respuestasActuales()));

  constructor() {
    this.form.controls.respuestas.valueChanges.subscribe(() => {
      const grupo = this.form.controls.respuestas.getRawValue() as Record<string, 'SI' | 'NO'>;
      this.respuestasActuales.set(PREGUNTAS_SALUD_TOTAL.map((_, i) => grupo[`p${i + 1}`]));
    });
  }

  /** Falta fecha u hora cuando el formulario las exige. */
  faltaFechaHora(): boolean {
    if (!this.exigeFechaHora()) return false;
    return !this.form.controls.fechaAccidente.value || !this.form.controls.horaAccidente.value;
  }

  cancelar(): void {
    this.ref.close(undefined);
  }

  async generar(): Promise<void> {
    if (this.form.invalid || this.generando() || this.faltaFechaHora()) {
      this.form.markAllAsTouched();
      if (this.faltaFechaHora()) {
        this.error.set('Hubo un accidente: indica la fecha y la hora del accidente.');
      }
      return;
    }
    this.generando.set(true);
    this.error.set('');
    try {
      const respuesta = await fetch(RUTA_PDF_SALUD_TOTAL);
      if (!respuesta.ok) {
        throw new Error(`No se pudo cargar el formato (${respuesta.status}).`);
      }
      const base = await respuesta.arrayBuffer();
      const grupo = this.form.controls.respuestas.getRawValue() as Record<string, 'SI' | 'NO'>;
      const respuestas = PREGUNTAS_SALUD_TOTAL.map((_, i) => grupo[`p${i + 1}`]);
      const bytes = await llenarFormatoSaludTotal(
        base,
        { ...this.datos, responsable: this.form.controls.responsable.value.trim() },
        respuestas,
        {
          relato: this.form.controls.relato.value.trim() || undefined,
          fechaAccidente: fechaAccidenteLegible(this.form.controls.fechaAccidente.value) || undefined,
          horaAccidente: this.form.controls.horaAccidente.value || undefined,
        },
      );
      const nombre = `formato-salud-total-${(this.datos.cedula || 'trabajador').trim()}.pdf`;
      this.ref.close(new File([new Uint8Array(bytes)], nombre, { type: 'application/pdf' }));
    } catch (e) {
      this.error.set(
        e instanceof Error && e.message
          ? `No se pudo generar el PDF: ${e.message}`
          : 'No se pudo generar el PDF diligenciado. Descarga el formato con el enlace y subelo a mano.',
      );
    } finally {
      this.generando.set(false);
    }
  }
}
