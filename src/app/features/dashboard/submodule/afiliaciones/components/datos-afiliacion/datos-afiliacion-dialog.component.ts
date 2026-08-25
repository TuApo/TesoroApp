import { ChangeDetectorRef, Component, Inject, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import {
  AfiliacionDatosService, DatosAfiliacion, FichaAfiliacion, EdicionDato
} from '../../services/afiliacion-datos.service';

/** Con qué se abre el diálogo: basta el candidato; el nombre es para el encabezado. */
export interface DatosAfiliacionDialogData {
  candidatoId: number;
  nombre?: string;
  cedula?: string;
}

/** Un bloque del formulario. Se recorre desde la plantilla con un @for TIPADO: metido en un
 *  `ng-template` el contexto llega como `any` y `form[c.key]` deja de compilar con
 *  `strictTemplates` (TS7053). */
interface SeccionForm {
  titulo: string;
  icono: string;
  campos: CampoForm[];
}

/** Un campo del formulario: cómo se pinta y de qué tipo es. */
interface CampoForm {
  key: keyof DatosAfiliacion;
  /** Etiqueta EXACTA del formato que usa el área, para poder cotejar contra el Excel. */
  label: string;
  tipo: 'texto' | 'fecha' | 'select' | 'email' | 'tel';
  opciones?: string[];
  /** Ocupa las dos columnas de la rejilla. */
  ancho?: boolean;
  ayuda?: string;
}

/**
 * FICHA DE DATOS DE AFILIACIÓN — los 23 campos que alimentan los documentos.
 *
 * Es la pantalla donde afiliaciones verifica a la persona ANTES de generar sus documentos y,
 * si algo viene mal del formulario de contratación, lo corrige aquí mismo.
 *
 * Lo que se guarda va a las tablas REALES de contratación (no a una copia), así que la
 * corrección también arregla el tablero de contratación y los documentos de vinculación. A
 * cambio, cada cambio queda firmado: el historial de abajo muestra quién cambió qué y cuándo.
 *
 * Dos reglas que explican el comportamiento del formulario:
 *  - Un campo que se deja vacío NO borra el dato: significa "no lo toques".
 *  - La cédula y la temporal se pueden editar (decisión del 2026-08-10) pero avisan, porque la
 *    cédula es la llave con la que se cruzan documentos, ADRES y traslados.
 */
@Component({
  selector: 'app-datos-afiliacion-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatDialogModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatTooltipModule, MatProgressBarModule, MatExpansionModule, MatSnackBarModule
  ],
  templateUrl: './datos-afiliacion-dialog.component.html',
  styleUrl: './datos-afiliacion-dialog.component.css'
})
export class DatosAfiliacionDialogComponent {
  private svc = inject(AfiliacionDatosService);
  private snack = inject(MatSnackBar);
  private ref = inject(MatDialogRef<DatosAfiliacionDialogComponent>);
  /** La app corre zoneless: lo async se marca a mano. */
  private cdr = inject(ChangeDetectorRef);

  cargando = true;
  guardando = false;
  error: string | null = null;

  ficha: FichaAfiliacion | null = null;
  /** Lo que el operador está editando. */
  form!: DatosAfiliacion;
  /** Copia de lo que llegó del servidor, para saber qué tocó y para poder deshacer. */
  private original!: DatosAfiliacion;

  historial: EdicionDato[] = [];
  verHistorial = false;

  /** Campos que se precargaron con una sugerencia y todavía nadie confirmó. */
  sugeridos = new Set<keyof DatosAfiliacion>();

  /** Avisos del último guardado (cédula cambiada, contrato ausente…). Se dejan a la vista. */
  avisos: string[] = [];
  /** Si se guardó algo, al cerrar se le pide a la pantalla que refresque la tabla. */
  private huboGuardado = false;

  // ── Definición del formulario, en el orden del formato del área ──────

  readonly identificacion: CampoForm[] = [
    { key: 'cedula', label: 'Cedula', tipo: 'texto',
      ayuda: 'Es la llave con la que se cruzan documentos, ADRES y traslados. Cambiarla los desvincula.' },
    { key: 'tipoDocumento', label: 'Tipo_Documento', tipo: 'select',
      opciones: ['CC', 'CE', 'PEP', 'PPT', 'TI', 'PA', 'NIT'] },
    { key: 'primerApellido', label: 'Primer_Apellido', tipo: 'texto' },
    { key: 'segundoApellido', label: 'Segundo_Apellido', tipo: 'texto' },
    { key: 'primerNombre', label: 'Primer_Nombre', tipo: 'texto' },
    { key: 'segundoNombre', label: 'Segundo_Nombre', tipo: 'texto' },
    { key: 'fechaNacimiento', label: 'Fecha_Nacimiento', tipo: 'fecha' },
    { key: 'sexo', label: 'Sexo', tipo: 'select', opciones: ['MASCULINO', 'FEMENINO'] }
  ];

  readonly residencia: CampoForm[] = [
    { key: 'direccion', label: 'Direccion', tipo: 'texto', ancho: true },
    { key: 'localidad', label: 'Localidad', tipo: 'texto' },
    { key: 'municipioResidencia', label: 'Municipio_Residencia', tipo: 'texto' },
    { key: 'departamentoResidencia', label: 'Departamento_Residencia', tipo: 'texto' },
    { key: 'numeroMovil', label: 'Numero_Movil', tipo: 'tel' },
    { key: 'correo', label: 'Correo', tipo: 'email', ancho: true }
  ];

  readonly nacimiento: CampoForm[] = [
    { key: 'municipioNacimiento', label: 'Municipio_Nacimiento', tipo: 'texto' },
    { key: 'departamentoNacimiento', label: 'Departamento_Nacimiento', tipo: 'texto' },
    { key: 'nacionalidad', label: 'Nacionalidad', tipo: 'texto' },
    { key: 'pais', label: 'Pais', tipo: 'texto' }
  ];

  readonly vinculacion: CampoForm[] = [
    { key: 'salario', label: 'Salario', tipo: 'texto' },
    { key: 'fechaIngreso', label: 'Fecha_Ingreso', tipo: 'fecha' },
    { key: 'eps', label: 'EPS', tipo: 'texto' },
    { key: 'afp', label: 'AFP', tipo: 'texto' },
    { key: 'temporal', label: 'Temporal', tipo: 'select',
      opciones: ['APOYO LABORAL', 'TU ALIANZA'],
      ayuda: 'Define la empresa que contrata; cambiarla mueve a la persona de temporal.' }
  ];

  /** El formulario completo, en el orden del formato del área. */
  readonly secciones: SeccionForm[] = [
    { titulo: 'Identificación',            icono: 'badge',  campos: this.identificacion },
    { titulo: 'Residencia y contacto',     icono: 'home',   campos: this.residencia },
    { titulo: 'Nacimiento y nacionalidad', icono: 'public', campos: this.nacimiento },
    { titulo: 'Vinculación',               icono: 'work',   campos: this.vinculacion }
  ];

  constructor(@Inject(MAT_DIALOG_DATA) public data: DatosAfiliacionDialogData) {
    this.cargar();
  }

  private cargar(): void {
    this.cargando = true;
    this.error = null;
    this.svc.obtener(this.data.candidatoId).subscribe({
      next: f => {
        this.ficha = f;
        this.historial = f.historial || [];
        this.original = this.aFormulario(f);
        this.form = { ...this.original };
        this.aplicarSugerencias();
        this.cargando = false;
        this.cdr.markForCheck();
      },
      error: e => {
        this.cargando = false;
        this.error = e?.error?.error || 'No se pudieron cargar los datos de esta persona.';
        this.cdr.markForCheck();
      }
    });
  }

  /** Solo los 23 editables; se quitan candidatoId/faltantes/historial de la ficha. */
  private aFormulario(f: FichaAfiliacion): DatosAfiliacion {
    const { candidatoId, procesoId, nombreCompleto, faltantes, historial, ...datos } = f;
    return { ...datos };
  }

  /**
   * Precarga COLOMBIA/COLOMBIANA cuando el campo está vacío. Se marcan como sugeridos para
   * pintarlos distinto: hasta que el operador guarde, en la base siguen vacíos.
   */
  private aplicarSugerencias(): void {
    this.sugeridos.clear();
    const s = AfiliacionDatosService.SUGERENCIAS;
    (Object.keys(s) as (keyof DatosAfiliacion)[]).forEach(k => {
      if (!this.form[k]) {
        this.form[k] = s[k] as string;
        this.sugeridos.add(k);
      }
    });
  }

  // ── Estado del formulario ───────────────────────────────────────────

  esSugerido(key: keyof DatosAfiliacion): boolean { return this.sugeridos.has(key); }

  /** Un campo cambiado respecto de lo que trajo el servidor (para resaltarlo). */
  cambiado(key: keyof DatosAfiliacion): boolean {
    if (!this.original) return false;
    return (this.form[key] || '').trim() !== (this.original[key] || '').trim();
  }

  /** Campo vacío = dato que falta para los documentos. */
  vacio(key: keyof DatosAfiliacion): boolean { return !(this.form[key] || '').trim(); }

  get camposCambiados(): (keyof DatosAfiliacion)[] {
    if (!this.original) return [];
    return (Object.keys(this.original) as (keyof DatosAfiliacion)[]).filter(k => this.cambiado(k));
  }
  get hayCambios(): boolean { return this.camposCambiados.length > 0; }

  /** Cuántos de los 23 siguen vacíos con lo que hay ahora en pantalla. */
  get totalVacios(): number {
    if (!this.original) return 0;
    return (Object.keys(this.original) as (keyof DatosAfiliacion)[]).filter(k => this.vacio(k)).length;
  }

  /** Aviso en vivo: la cédula es la llave de cruce de documentos/ADRES/traslados. */
  get cedulaCambiada(): boolean { return this.cambiado('cedula'); }

  deshacer(): void {
    this.form = { ...this.original };
    this.aplicarSugerencias();
  }

  // ── Guardar ─────────────────────────────────────────────────────────

  guardar(): void {
    if (!this.hayCambios || this.guardando) return;
    this.guardando = true;
    this.error = null;
    this.svc.guardar(this.data.candidatoId, this.form).subscribe({
      next: r => {
        this.guardando = false;
        if (r.cambios > 0) this.huboGuardado = true;
        this.ficha = r.datos;
        this.historial = r.datos.historial || [];
        this.original = this.aFormulario(r.datos);
        this.form = { ...this.original };
        this.aplicarSugerencias();

        this.snack.open(
          r.cambios === 0 ? 'No había nada que cambiar' : `${r.cambios} dato(s) actualizado(s)`,
          'Cerrar', { duration: 4000 });
        // Los avisos (cédula cambiada, sin proceso de contratación) se dejan a la vista: son
        // consecuencias que el operador necesita leer, no un snackbar que se va solo.
        this.avisos = r.avisos || [];
        this.cdr.markForCheck();
      },
      error: e => {
        this.guardando = false;
        this.error = e?.error?.error
          || (e?.status === 409
            ? 'Ya existe otra persona con esa cédula.'
            : 'No se pudieron guardar los cambios.');
        this.cdr.markForCheck();
      }
    });
  }

  /** Cierra devolviendo si hubo algún guardado, para que la tabla se refresque. */
  cerrar(): void {
    this.ref.close({ guardado: this.huboGuardado });
  }

  campoLabel(campo: string): string { return campo.replace(/_/g, ' '); }
}
