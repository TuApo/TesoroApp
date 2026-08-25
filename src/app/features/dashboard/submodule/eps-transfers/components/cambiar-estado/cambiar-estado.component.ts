import {  Component, Inject , ChangeDetectionStrategy } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import Swal from 'sweetalert2';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-cambiar-estado',
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatDatepickerModule,
    MatNativeDateModule
],
  templateUrl: './cambiar-estado.component.html',
  styleUrls: ['./cambiar-estado.component.css'],
  providers: [DatePipe]
} )
export class CambiarEstadoComponent {
  estados: string[] = [
    'En proceso', 'Personal Activo EPS Adress', 'No cumple tiempo EPS Activa',
    'Persona Regimen Subsidiado', 'Falta Información', 'Ya Registrado SAT',
    'Validar 24 Horas', 'Validar 10 Horas', 'Validar Días', 'Reporte en la EPS',
    'No se encuentra en ADRES', 'Retirado', 'Segundo cotizante', 'Aceptado', 'Otro'
  ];

  form: FormGroup;

  constructor(
    public dialogRef: MatDialogRef<CambiarEstadoComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any,
    private fb: FormBuilder,
    private datePipe: DatePipe
  ) {
    this.form = this.fb.group({
      // '' (string vacío), NO ['']: un array de longitud 1 pasa Validators.required
      // como válido → se podía guardar sin elegir estado y mandaba [""] al backend.
      estado: ['', Validators.required],
      fechaConfirmacion: [''],
      numeroRadicado: [''],
      numeroBeneficiarios: [''],
      epsTraslado: [''],
      observaciones: ['']
    });

      // Agrega validaciones condicionales
  this.form.get('estado')?.valueChanges.subscribe((estado) => {
    if (estado === 'Aceptado') {
      this.form.get('fechaConfirmacion')?.setValidators(Validators.required);
      this.form.get('numeroRadicado')?.setValidators(Validators.required);
      this.form.get('numeroBeneficiarios')?.setValidators(Validators.required);
      this.form.get('epsTraslado')?.setValidators(Validators.required);
    } else {
      this.form.get('fechaConfirmacion')?.clearValidators();
      this.form.get('numeroRadicado')?.clearValidators();
      this.form.get('numeroBeneficiarios')?.clearValidators();
      this.form.get('epsTraslado')?.clearValidators();
    }
    // Actualiza los estados de los campos
    this.form.get('fechaConfirmacion')?.updateValueAndValidity();
    this.form.get('numeroRadicado')?.updateValueAndValidity();
    this.form.get('numeroBeneficiarios')?.updateValueAndValidity();
    this.form.get('epsTraslado')?.updateValueAndValidity();
  });

  }

  onNoClick(): void {
    this.dialogRef.close();
  }

  onSaveClick(): void {
    if (!this.form.valid) {
      Swal.fire('Error', 'Por favor complete todos los campos obligatorios', 'error');
      return;
    }

    const formData = this.form.value;
    if (formData.fechaConfirmacion) {
      formData.fechaConfirmacion = this.datePipe.transform(formData.fechaConfirmacion, 'dd/MM/yyyy');
    }
    this.dialogRef.close(formData);
  }

}
