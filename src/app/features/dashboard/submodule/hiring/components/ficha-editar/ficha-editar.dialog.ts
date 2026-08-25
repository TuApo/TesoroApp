import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { DateAdapter, MAT_DATE_FORMATS, MAT_DATE_LOCALE } from '@angular/material/core';
import { MomentDateAdapter, MatMomentDateModule } from '@angular/material-moment-adapter';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatIconModule } from '@angular/material/icon';
import { Observable } from 'rxjs';

import { SharedModule } from '@/app/shared/shared.module';
import { CatalogValue } from '../../../users/services/gestion-parametrizacion/gestion-parametrizacion.service';

/**
 * Mismo formato que usa el pipeline. Se declara aquí y no se importa de allá:
 * ese import cerraba un ciclo de módulos (pipeline → help-information →
 * form-entrevista → este diálogo → pipeline) y la clase del formulario quedaba
 * sin inicializar al cargar.
 */
const FORMATO_FECHA = {
  parse: { dateInput: 'DD/MM/YYYY' },
  display: {
    dateInput: 'DD/MM/YYYY',
    monthYearLabel: 'MMMM YYYY',
    dateA11yLabel: 'LL',
    monthYearA11yLabel: 'MMMM YYYY',
  },
};

/** Los cuatro bloques en los que la ficha agrupa los datos de la persona. */
export type BloqueFicha = 'identificacion' | 'personales' | 'contacto' | 'familia';

export interface FichaEditarData {
  /** El formulario REAL de `form-entrevista`, no una copia. */
  form: FormGroup;
  /** Qué bloques se pintan. Uno solo cuando se pidió "editar este bloque". */
  bloques: readonly BloqueFicha[];
  titulo: string;
  oficinas: readonly string[];
  ciudades: readonly string[];
  tipoDoc$: Observable<CatalogValue[]>;
  estadoCivil$: Observable<CatalogValue[]>;
  conQuienVive$: Observable<CatalogValue[]>;
  parentescos$: Observable<CatalogValue[]>;
}

/** Controles que pinta cada bloque. Es el mismo reparto que muestra la ficha. */
const CAMPOS_POR_BLOQUE: Record<BloqueFicha, readonly string[]> = {
  identificacion: ['oficina', 'tipo_doc', 'numero_documento', 'fecha_expedicion', 'mpio_expedicion'],
  personales: [
    'primer_nombre', 'segundo_nombre', 'primer_apellido', 'segundo_apellido',
    'fecha_nacimiento', 'mpio_nacimiento', 'sexo', 'estado_civil',
  ],
  contacto: [
    'correo_electronico', 'password', 'celular', 'whatsapp',
    'direccion_de_residencia', 'barrio', 'personas_con_quien_convive', 'hace_cuanto_vive',
  ],
  familia: [
    'tieneHijos', 'numeroHijos', 'cuidadorHijos',
    'nombreReferenciaFamiliar1', 'parentescoReferenciaFamiliar1',
    'nombreReferenciaFamiliar2', 'parentescoReferenciaFamiliar2',
    'nombreReferenciaPersonal1', 'parentescoReferenciaPersonal1',
    'nombreReferenciaPersonal2', 'parentescoReferenciaPersonal2',
  ],
};

/**
 * Edición de los datos de la persona.
 *
 * Estos campos —oficina, documento, nombres, contacto, familia— se quedaron sin
 * pantalla cuando la ficha subió al pipeline: la ficha vieja se editaba en
 * sitio, la nueva es solo de lectura. Eran obligatorios y sin sitio donde
 * llenarlos, así que guardar la entrevista fallaba señalando campos que no
 * estaban en ninguna parte.
 *
 * Trabaja sobre el FormGroup REAL, no sobre una copia: así el guardado, los
 * validadores y los catálogos siguen siendo los de siempre y no hay dos
 * verdades que sincronizar. Como eso implica que escribir aquí ya modifica el
 * formulario, al abrir se guarda una foto de los campos y "Cancelar" la
 * restituye.
 */
@Component({
  selector: 'app-ficha-editar-dialog',
  standalone: true,
  imports: [
    SharedModule, ReactiveFormsModule, MatDialogModule,
    MatDatepickerModule, MatMomentDateModule, MatIconModule,
  ],
  templateUrl: './ficha-editar.dialog.html',
  styleUrls: ['./ficha-editar.dialog.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    // El diálogo vive en un overlay, fuera del árbol del pipeline, así que no
    // hereda su adaptador de fechas: sin esto los datepicker saldrían en
    // formato nativo y no en DD/MM/YYYY como el resto de la plataforma.
    { provide: MAT_DATE_LOCALE, useValue: 'es-CO' },
    { provide: DateAdapter, useClass: MomentDateAdapter, deps: [MAT_DATE_LOCALE] },
    { provide: MAT_DATE_FORMATS, useValue: FORMATO_FECHA },
  ],
})
export class FichaEditarDialogComponent {
  readonly data = inject<FichaEditarData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<FichaEditarDialogComponent, 'guardar' | undefined>>(MatDialogRef);

  /** Foto de los campos al abrir, para poder deshacer. */
  private readonly original: Record<string, unknown>;

  /** Municipios filtrados por lo que se va escribiendo. */
  readonly ciudadesExpedicion = signal<readonly string[]>([]);
  readonly ciudadesNacimiento = signal<readonly string[]>([]);

  constructor() {
    this.original = {};
    for (const c of this.camposVisibles()) {
      this.original[c] = this.data.form.get(c)?.value ?? null;
    }
    this.filtrarCiudades('mpio_expedicion');
    this.filtrarCiudades('mpio_nacimiento');
  }

  tiene(bloque: BloqueFicha): boolean {
    return this.data.bloques.includes(bloque);
  }

  private camposVisibles(): string[] {
    return this.data.bloques.flatMap((b) => [...CAMPOS_POR_BLOQUE[b]]);
  }

  /** ¿Algún campo de los que se están editando quedó inválido? */
  get hayErrores(): boolean {
    return this.camposVisibles().some((c) => !!this.data.form.get(c)?.invalid);
  }

  filtrarCiudades(campo: 'mpio_expedicion' | 'mpio_nacimiento'): void {
    const q = String(this.data.form.get(campo)?.value ?? '');
    const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    const t = norm(q);
    const lista = t
      ? this.data.ciudades.filter((c) => norm(c).includes(t)).slice(0, 50)
      : this.data.ciudades.slice(0, 50);
    (campo === 'mpio_expedicion' ? this.ciudadesExpedicion : this.ciudadesNacimiento).set(lista);
  }

  guardar(): void {
    // Se marca todo para que los obligatorios vacíos se pinten en rojo aquí,
    // dentro del diálogo, en vez de en un formulario que no está a la vista.
    for (const c of this.camposVisibles()) this.data.form.get(c)?.markAsTouched();
    if (this.hayErrores) return;
    this.ref.close('guardar');
  }

  cancelar(): void {
    // Se escribió sobre el formulario real: sin restituir, "Cancelar" dejaría
    // los cambios puestos y el siguiente guardado se los llevaría.
    this.data.form.patchValue(this.original, { emitEvent: true });
    for (const c of this.camposVisibles()) this.data.form.get(c)?.markAsPristine();
    this.ref.close();
  }
}
