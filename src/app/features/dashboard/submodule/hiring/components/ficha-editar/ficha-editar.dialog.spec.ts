import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';

import { FichaEditarDialogComponent, FichaEditarData } from './ficha-editar.dialog';

/**
 * El diálogo escribe sobre el formulario REAL del candidato. Lo que se prueba
 * aquí es justo lo que se puede romper con eso: que "editar este bloque" no
 * saque a la superficie campos de otro, que Cancelar deshaga de verdad y que
 * Guardar no cierre dejando un obligatorio vacío.
 */
describe('FichaEditarDialogComponent', () => {
  let form: FormGroup;
  let cerrado: jasmine.Spy;

  function crear(bloques: FichaEditarData['bloques']): ComponentFixture<FichaEditarDialogComponent> {
    const fb = new FormBuilder();
    form = fb.group({
      // identificación
      oficina: ['SOACHA', Validators.required],
      tipo_doc: ['CC', Validators.required],
      numero_documento: ['1004803288', Validators.required],
      fecha_expedicion: ['', Validators.required],
      mpio_expedicion: ['BOGOTÁ', Validators.required],
      // personales
      primer_nombre: ['ANA', Validators.required],
      segundo_nombre: [''],
      primer_apellido: ['GÓMEZ', Validators.required],
      segundo_apellido: [''],
      fecha_nacimiento: ['', Validators.required],
      mpio_nacimiento: ['CHÍA', Validators.required],
      sexo: ['F', Validators.required],
      estado_civil: ['S', Validators.required],
      // contacto
      correo_electronico: ['a@b.co', Validators.required],
      password: [''],
      celular: ['3001234567', Validators.required],
      whatsapp: [''],
      direccion_de_residencia: ['CL 1', Validators.required],
      barrio: ['CENTRO', Validators.required],
      personas_con_quien_convive: ['SOLO', Validators.required],
      hace_cuanto_vive: ['2 AÑOS', Validators.required],
      // familia
      tieneHijos: [true, Validators.required],
      numeroHijos: [2],
      cuidadorHijos: ['ABUELA'],
      nombreReferenciaFamiliar1: [''],
      parentescoReferenciaFamiliar1: [''],
      nombreReferenciaFamiliar2: [''],
      parentescoReferenciaFamiliar2: [''],
      nombreReferenciaPersonal1: [''],
      parentescoReferenciaPersonal1: [''],
      nombreReferenciaPersonal2: [''],
      parentescoReferenciaPersonal2: [''],
    });

    cerrado = jasmine.createSpy('close');

    const data: FichaEditarData = {
      form,
      bloques,
      titulo: 'Prueba',
      oficinas: ['SOACHA', 'BOGOTÁ'],
      ciudades: ['BOGOTÁ', 'CHÍA', 'SOACHA'],
      tipoDoc$: of([{ codigo: 'CC', descripcion: 'Cédula' }] as any),
      estadoCivil$: of([{ codigo: 'S', descripcion: 'Soltero' }] as any),
      conQuienVive$: of([{ codigo: 'SOLO', descripcion: 'Solo' }] as any),
      parentescos$: of([{ codigo: 'MADRE', descripcion: 'Madre' }] as any),
    };

    TestBed.configureTestingModule({
      imports: [FichaEditarDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close: cerrado } },
      ],
    });

    const f = TestBed.createComponent(FichaEditarDialogComponent);
    f.detectChanges();
    return f;
  }

  function rotulos(f: ComponentFixture<FichaEditarDialogComponent>): string[] {
    return Array.from(f.nativeElement.querySelectorAll('.fe-bloque-head h3'))
      .map((e) => (e as HTMLElement).textContent!.trim());
  }

  it('editando un bloque solo pinta ese bloque', () => {
    const f = crear(['contacto']);
    expect(rotulos(f)).toEqual(['Contacto y domicilio']);
    // Un campo de otro bloque no puede estar en pantalla.
    expect(f.nativeElement.querySelector('[formControlName="primer_nombre"]')).toBeNull();
    expect(f.nativeElement.querySelector('[formControlName="celular"]')).not.toBeNull();
  });

  it('el lápiz de la cabecera pinta los cuatro bloques', () => {
    const f = crear(['identificacion', 'personales', 'contacto', 'familia']);
    expect(rotulos(f)).toEqual([
      'Identificación y documento',
      'Datos personales',
      'Contacto y domicilio',
      'Familia y referencias',
    ]);
  });

  it('Cancelar deshace lo escrito sobre el formulario real', () => {
    const f = crear(['contacto']);
    form.get('celular')!.setValue('3009999999');
    f.componentInstance.cancelar();

    expect(form.get('celular')!.value).toBe('3001234567');
    expect(cerrado).toHaveBeenCalledWith();
  });

  it('Guardar no cierra si queda un obligatorio del bloque vacío', () => {
    const f = crear(['contacto']);
    form.get('barrio')!.setValue('');
    f.componentInstance.guardar();

    expect(cerrado).not.toHaveBeenCalled();
    expect(form.get('barrio')!.touched).toBeTrue();
  });

  it('un obligatorio vacío de OTRO bloque no impide guardar este', () => {
    // `fecha_expedicion` es obligatorio y está vacío, pero es de
    // Identificación: bloquear por él dejaría el diálogo de Contacto sin
    // salida y sin decir por qué.
    const f = crear(['contacto']);
    f.componentInstance.guardar();

    expect(cerrado).toHaveBeenCalledWith('guardar');
  });
});
