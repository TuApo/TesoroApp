/**
 * Pruebas del formulario de cuenta remitente. Se instancia el componente con un
 * FormBuilder real (sin TestBed) y se ejecuta ngOnInit, que es donde vive toda
 * la lógica de validación y de credenciales.
 *
 * Cubre: validaciones, obligatoriedad de la contraseña según proveedor,
 * conservación vs. reemplazo de la credencial y detección del cambio sensible
 * que obliga a re-verificar.
 */
import { FormBuilder } from '@angular/forms';
import { of } from 'rxjs';

import { CorreoFormDialogComponent } from './correo-form-dialog.component';
import { CorreoCuenta } from '../../models/correo-cuenta.model';

function cuenta(over: Partial<CorreoCuenta> = {}): CorreoCuenta {
  return {
    id: 'id-1',
    direccion: 'nomina@tuapo.co',
    nombre_mostrar: 'Nómina TuApo',
    proveedor: 'GMAIL',
    proposito: 'Nómina',
    smtp_host: 'smtp.gmail.com',
    smtp_port: 465,
    smtp_usuario: 'nomina@tuapo.co',
    cuota_diaria: 500,
    limite_efectivo: 450,
    umbral_corte_pct: 90,
    enviados_hoy: 0,
    disponible_hoy: 450,
    estado_verificacion: 'VERIFICADA',
    ultima_verificacion: '2026-08-03T10:00:00Z',
    mensaje_ultima_verificacion: null,
    activo: true,
    notas: null,
    credencial_configurada: true,
    aporta_cuota: true,
    creado_por: null,
    creado_en: null,
    actualizado_por: null,
    actualizado_en: null,
    ...over,
  };
}

function nuevoDialogo(
  data: { cuenta: CorreoCuenta | null; umbralCortePct?: number },
  svc: any = {},
): CorreoFormDialogComponent {
  const dialogRef: any = { close: jasmine.createSpy('close') };
  const snackBar: any = { open: () => {} };
  const cdr: any = { markForCheck: () => {} };
  const c = new CorreoFormDialogComponent(new FormBuilder(), dialogRef, data, svc, snackBar, cdr);
  c.ngOnInit();
  return c;
}

describe('CorreoFormDialog — validaciones', () => {
  it('exige dirección con formato de correo y proveedor', () => {
    const d = nuevoDialogo({ cuenta: null });
    expect(d.form.valid).toBeFalse();

    d.form.patchValue({ direccion: 'no-es-correo' });
    expect(d.form.get('direccion')?.hasError('email')).toBeTrue();

    d.form.patchValue({ direccion: 'valido@tuapo.co' });
    expect(d.form.get('direccion')?.valid).toBeTrue();
    expect(d.form.get('proveedor')?.hasError('required')).toBeTrue();
  });

  it('rechaza una cuota negativa', () => {
    const d = nuevoDialogo({ cuenta: null });
    d.form.patchValue({ cuota_diaria: -1 });
    expect(d.form.get('cuota_diaria')?.hasError('min')).toBeTrue();
  });

  it('el corte automatico es el 90% del disponible escrito, truncado', () => {
    const d = nuevoDialogo({ cuenta: null });
    d.form.patchValue({ cuota_diaria: 1500 });
    expect(d.limiteEfectivo()).toBe(1350);
    d.form.patchValue({ cuota_diaria: 500 });
    expect(d.limiteEfectivo()).toBe(450);
    d.form.patchValue({ cuota_diaria: 5 });
    expect(d.limiteEfectivo()).toBe(4);
    d.form.patchValue({ cuota_diaria: 0 });
    expect(d.limiteEfectivo()).toBe(0);
  });

  it('el umbral llega desde el backend, no cableado', () => {
    const d = nuevoDialogo({ cuenta: null, umbralCortePct: 90 } as any);
    d.form.patchValue({ cuota_diaria: 1000 });
    expect(d.UMBRAL_CORTE).toBe(90);
    expect(d.limiteEfectivo()).toBe(900);
  });

  it('rechaza puertos fuera de 1..65535', () => {
    const d = nuevoDialogo({ cuenta: null });
    d.form.patchValue({ smtp_port: 0 });
    expect(d.form.get('smtp_port')?.hasError('min')).toBeTrue();
    d.form.patchValue({ smtp_port: 70000 });
    expect(d.form.get('smtp_port')?.hasError('max')).toBeTrue();
    d.form.patchValue({ smtp_port: 587 });
    expect(d.form.get('smtp_port')?.valid).toBeTrue();
  });

  it('al elegir un proveedor conocido autocompleta host y puerto', () => {
    const d = nuevoDialogo({ cuenta: null });
    d.form.patchValue({ proveedor: 'OUTLOOK' });
    d.onProveedorChange();
    expect(d.form.get('smtp_host')?.value).toBe('smtp.office365.com');
    expect(d.form.get('smtp_port')?.value).toBe(587);
  });

  it('SMTP propio exige host y puerto explícitos', () => {
    const d = nuevoDialogo({ cuenta: null });
    d.form.patchValue({ proveedor: 'SMTP_PROPIO' });
    d.onProveedorChange();
    expect(d.form.get('smtp_host')?.hasError('required')).toBeTrue();
    expect(d.form.get('smtp_port')?.hasError('required')).toBeTrue();
  });
});

describe('CorreoFormDialog — credenciales', () => {
  it('en creación con proveedor que autentica la contraseña es obligatoria', () => {
    const d = nuevoDialogo({ cuenta: null });
    d.form.patchValue({ proveedor: 'GMAIL' });
    d.onProveedorChange();
    expect(d.requiereCredencial()).toBeTrue();
    expect(d.form.get('smtp_password')?.hasError('required')).toBeTrue();
  });

  it('un relay SMTP propio sin usuario no exige contraseña', () => {
    const d = nuevoDialogo({ cuenta: null });
    d.form.patchValue({ proveedor: 'SMTP_PROPIO', smtp_usuario: '' });
    d.onProveedorChange();
    expect(d.requiereCredencial()).toBeFalse();
    expect(d.form.get('smtp_password')?.hasError('required')).toBeFalse();
  });

  it('en edición NUNCA se precarga la credencial almacenada', () => {
    const d = nuevoDialogo({ cuenta: cuenta() });
    expect(d.isEditing).toBeTrue();
    expect(d.form.get('smtp_password')?.value).toBe('');
    expect(d.form.get('smtp_password')?.hasError('required')).toBeFalse();
  });

  it('en edición sin contraseña el payload NO incluye smtp_password (se conserva)', () => {
    const d = nuevoDialogo({ cuenta: cuenta() });
    const payload = d.construirPayload();
    expect('smtp_password' in payload).toBeFalse();
    expect(payload.direccion).toBe('nomina@tuapo.co');
  });

  it('escribir una contraseña nueva la manda en el payload (reemplaza la actual)', () => {
    const d = nuevoDialogo({ cuenta: cuenta() });
    d.form.patchValue({ smtp_password: '  clave-nueva  ' });
    const payload = d.construirPayload();
    expect(payload.smtp_password).toBe('clave-nueva');
  });

  it('los campos vacíos viajan como null, no como cadena vacía', () => {
    const d = nuevoDialogo({ cuenta: cuenta({ nombre_mostrar: null, proposito: null }) });
    const payload = d.construirPayload();
    expect(payload.nombre_mostrar).toBeNull();
    expect(payload.proposito).toBeNull();
  });
});

describe('CorreoFormDialog — aviso de re-verificación', () => {
  it('no hay cambio sensible al editar solo nombre, propósito o cuotas', () => {
    const d = nuevoDialogo({ cuenta: cuenta() });
    d.form.patchValue({ nombre_mostrar: 'Otro nombre', proposito: 'Tesorería', cuota_diaria: 800 });
    expect(d.cambioSensible).toBeFalse();
  });

  it('cambiar host, puerto, usuario, proveedor o contraseña marca cambio sensible', () => {
    for (const cambio of [
      { smtp_host: 'smtp.otro.co' },
      { smtp_port: 587 },
      { smtp_usuario: 'otro@tuapo.co' },
      { proveedor: 'YANDEX' },
      { smtp_password: 'clave-nueva' },
    ]) {
      const d = nuevoDialogo({ cuenta: cuenta() });
      d.form.patchValue(cambio);
      expect(d.cambioSensible).withContext(JSON.stringify(cambio)).toBeTrue();
    }
  });

  it('en creación nunca se muestra el aviso de re-verificación', () => {
    const d = nuevoDialogo({ cuenta: null });
    expect(d.cambioSensible).toBeFalse();
  });
});

describe('CorreoFormDialog — guardado', () => {
  it('crear cierra el diálogo con true', () => {
    const svc: any = { crear: jasmine.createSpy('crear').and.returnValue(of(cuenta())) };
    const d = nuevoDialogo({ cuenta: null }, svc);
    d.form.patchValue({
      direccion: 'nuevo@tuapo.co', proveedor: 'GMAIL',
      smtp_password: 'clave-de-prueba', cuota_diaria: 300,
    });
    d.onProveedorChange();

    d.guardar();

    expect(svc.crear).toHaveBeenCalled();
    expect((d as any).dialogRef.close).toHaveBeenCalledWith(true);
  });

  it('editar llama a actualizar con el id de la cuenta', () => {
    const svc: any = { actualizar: jasmine.createSpy('actualizar').and.returnValue(of(cuenta())) };
    const d = nuevoDialogo({ cuenta: cuenta() }, svc);

    d.guardar();

    expect(svc.actualizar).toHaveBeenCalled();
    expect(svc.actualizar.calls.mostRecent().args[0]).toBe('id-1');
  });
});
