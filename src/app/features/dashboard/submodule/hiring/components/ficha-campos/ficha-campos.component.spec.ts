import { Component, Input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';

import { anclaSeccion, FichaCamposComponent, SeccionFicha } from './ficha-campos.component';
import { SaludAdres } from '../../shared/salud-adres.util';

/**
 * Vienen del diálogo que este componente sustituye. Lo que cambia es el
 * contrato: ya no hay guardar/cancelar —se guarda con el "Enviar" de la
 * entrevista— y cada sección tiene que llevar su ancla, que es a donde saltan
 * los accesos directos del panel.
 */
/**
 * El componente toma el formulario del `<form [formGroup]>` que lo envuelve, así
 * que la prueba tiene que envolverlo igual que el panel de Entrevista. Montarlo
 * suelto no reproduce el caso real —y el caso real es justo el que falló: dos
 * `FormGroupDirective` sobre los mismos controles dejaban los campos en blanco.
 */
@Component({
  standalone: true,
  imports: [ReactiveFormsModule, FichaCamposComponent],
  template: `
    <form [formGroup]="form">
      <app-ficha-campos [secciones]="secciones" [ciudades]="ciudades" [hijos]="hijos" [saludAdres]="saludAdres"
                        [tipoDoc$]="cat" [conQuienVive$]="cat" [estadoCivil$]="cat"
                        [parentescos$]="cat" [ocupaciones$]="cat"></app-ficha-campos>
    </form>
  `,
})
class HostPrueba {
  @Input() form!: FormGroup;
  @Input() secciones: readonly SeccionFicha[] = [];
  @Input() hijos: ReadonlyArray<{ nombre: string; edad: string }> = [];
  @Input() saludAdres: SaludAdres | null = null;
  ciudades = ['BOGOTÁ', 'CHÍA', 'SOACHA'];
  cat = of([{ codigo: 'CC', descripcion: 'Cédula' }] as any);
}

describe('FichaCamposComponent', () => {
  let form: FormGroup;

  function crear(secciones: readonly SeccionFicha[], saludAdres: SaludAdres | null = null): ComponentFixture<HostPrueba> {
    const fb = new FormBuilder();
    form = fb.group({
      oficina: ['SOACHA', Validators.required],
      tipo_doc: ['CC', Validators.required],
      numero_documento: ['1004803288', Validators.required],
      fecha_expedicion: [''],
      mpio_expedicion: ['BOGOTÁ'],
      primer_nombre: ['ANA', Validators.required],
      segundo_nombre: [''],
      primer_apellido: ['GÓMEZ', Validators.required],
      segundo_apellido: [''],
      fecha_nacimiento: [''],
      edad: [{ value: 34, disabled: true }],
      mpio_nacimiento: ['CHÍA'],
      sexo: ['F'],
      estado_civil: ['S'],
      rh: [''],
      correo_electronico: ['a@b.co'],
      password: [''],
      celular: ['3001234567'],
      whatsapp: [''],
      direccion_de_residencia: ['CL 1'],
      barrio: ['CENTRO'],
      personas_con_quien_convive: [[]],
      hace_cuanto_vive: ['2 AÑOS'],
      relacionFamiliar: [''],
      tieneHijos: [true],
      numeroHijos: [0],
      cuidadorHijos: [''],
      hijos: fb.array([]),
      nombreReferenciaFamiliar1: [''], parentescoReferenciaFamiliar1: [''],
      nombreReferenciaFamiliar2: [''], parentescoReferenciaFamiliar2: [''],
      nombreReferenciaPersonal1: [''], parentescoReferenciaPersonal1: [''],
      nombreReferenciaPersonal2: [''], parentescoReferenciaPersonal2: [''],
      telefonoReferenciaFamiliar1: [''], ocupacionReferenciaFamiliar1: [''], direccionReferenciaFamiliar1: [''],
      telefonoReferenciaFamiliar2: [''], ocupacionReferenciaFamiliar2: [''], direccionReferenciaFamiliar2: [''],
      telefonoReferenciaPersonal1: [''], ocupacionReferenciaPersonal1: [''], direccionReferenciaPersonal1: [''],
      telefonoReferenciaPersonal2: [''], ocupacionReferenciaPersonal2: [''], direccionReferenciaPersonal2: [''],
      viveConyuge: [''], nombresConyuge: [''], apellidosConyuge: [''],
      documentoConyuge: [''], telefonoConyuge: [''], ocupacionConyuge: [''],
      municipioConyuge: [''], barrioConyuge: [''], direccionConyuge: [''],
      elPadreVive: [''], nombresPadre: [''], apellidosPadre: [''], telefonoPadre: [''],
      ocupacionPadre: [''], municipioPadre: [''], barrioPadre: [''], direccionPadre: [''],
      madreVive: [''], nombresMadre: [''], apellidosMadre: [''], telefonoMadre: [''],
      ocupacionMadre: [''], municipioMadre: [''], barrioMadre: [''], direccionMadre: [''],
      nombresFamiliarEmergencia: [''], apellidosFamiliarEmergencia: [''],
      parentescoFamiliarEmergencia: [''], telefonoFamiliarEmergencia: [''],
      ocupacionFamiliarEmergencia: [''], municipioFamiliarEmergencia: [''],
      barrioFamiliarEmergencia: [''], direccionFamiliarEmergencia: [''],
      tallaChaqueta: [null], tallaPantalon: [null], tallaCamisa: [null], tallaCalzado: [null],
    });

    TestBed.configureTestingModule({
      imports: [HostPrueba, NoopAnimationsModule],
    });

    const f = TestBed.createComponent(HostPrueba);
    f.componentInstance.form = form;
    f.componentInstance.secciones = secciones;
    f.componentInstance.saludAdres = saludAdres;
    f.detectChanges();
    return f;
  }

  function rotulos(f: ComponentFixture<HostPrueba>): string[] {
    return Array.from(f.nativeElement.querySelectorAll('.fe-bloque-head h3'))
      .map((e) => (e as HTMLElement).textContent!.trim());
  }

  it('pinta las nueve secciones del formulario de la vacante, en orden', () => {
    const f = crear([
      'identificacion', 'personales', 'contacto',
      'pareja', 'padres', 'hijos', 'referencias', 'emergencia', 'dotacion',
    ]);
    expect(rotulos(f)).toEqual([
      'Identificación y documento',
      'Datos personales',
      'Contacto y domicilio',
      'Estado civil y pareja',
      'Datos de sus padres',
      'Familia e hijos',
      'Referencias',
      'Contacto de emergencia',
      'Tallas de dotación',
    ]);
  });

  it('cada sección lleva su ancla: sin ella los accesos directos no saltan', () => {
    const f = crear(['pareja', 'dotacion']);
    expect(f.nativeElement.querySelector('#' + anclaSeccion('pareja'))).not.toBeNull();
    expect(f.nativeElement.querySelector('#' + anclaSeccion('dotacion'))).not.toBeNull();
  });

  it('acotar las secciones pinta solo esas', () => {
    const f = crear(['contacto']);
    expect(rotulos(f)).toEqual(['Contacto y domicilio']);
    expect(f.nativeElement.querySelector('[formControlName="primer_nombre"]')).toBeNull();
    expect(f.nativeElement.querySelector('[formControlName="celular"]')).not.toBeNull();
  });

  it('no pinta lo que no se pregunta en la entrevista', () => {
    const f = crear(['contacto']);
    // La contraseña es la credencial de la cuenta del candidato: no se corrige aquí.
    expect(f.nativeElement.querySelector('[formControlName="password"]')).toBeNull();
  });

  it('"con quién vive" sí se pinta: la hoja de entrevista lo pregunta', () => {
    const f = crear(['contacto']);
    expect(f.nativeElement.querySelector('[formControlName="personas_con_quien_convive"]')).not.toBeNull();
  });

  it('identificación no pinta la oficina, y datos personales no pinta el RH', () => {
    const f = crear(['identificacion', 'personales']);
    expect(f.nativeElement.querySelector('[formControlName="oficina"]')).toBeNull();
    expect(f.nativeElement.querySelector('[formControlName="rh"]')).toBeNull();
    // La edad sí: es la que se lee en la entrevista, calculada de la fecha.
    expect(f.nativeElement.querySelector('[formControlName="edad"]')).not.toBeNull();
  });

  function hijo(fb: FormBuilder, v: Record<string, any>): FormGroup {
    return fb.group({
      numero_de_documento: [''], fecha_nac: [null], tipo_documento: ['RC'],
      primer_nombre: [''], segundo_nombre: [''], primer_apellido: [''], segundo_apellido: [''],
      sexo: [''], ocupacion: [''], curso: [''], vive_con_trabajador: [''], tiene_discapacidad: [''],
      cual_discapacidad: [''], es_hijastro: [''], custodia_legal: [''], otro_padre_nombre: [''],
      otro_padre_documento: [''], otro_padre_en_compania: [''], estudia_fundacion: [''], nivel_educativo: [''], ...v,
    });
  }

  it('cada hijo trae los campos del formulario de la vacante, editables', () => {
    const f = crear(['hijos']);
    for (const c of ['relacionFamiliar', 'tieneHijos', 'numeroHijos', 'cuidadorHijos']) {
      expect(f.nativeElement.querySelector('[formControlName="' + c + '"]')).not.toBeNull();
    }
    const fb = new FormBuilder();
    (form.get('hijos') as FormArray).push(hijo(fb, { primer_nombre: 'SARA', primer_apellido: 'GÓMEZ' }));
    f.componentInstance.hijos = [{ nombre: 'SARA GÓMEZ', edad: '' }];
    f.detectChanges();
    const tarjeta: HTMLElement = f.nativeElement.querySelector('.fe-hijo');
    expect(tarjeta.textContent).toContain('SARA GÓMEZ');
    // Cerrada por defecto: solo la cabecera. Se abre al tocarla.
    expect(tarjeta.querySelector('[formControlName="primer_nombre"]')).toBeNull();
    (tarjeta.querySelector('.fe-hijo-toggle') as HTMLElement).click();
    f.detectChanges();
    for (const c of ['primer_nombre', 'sexo', 'fecha_nac', 'tipo_documento', 'numero_de_documento',
      'ocupacion', 'curso', 'vive_con_trabajador', 'tiene_discapacidad', 'es_hijastro',
      'custodia_legal', 'otro_padre_nombre', 'otro_padre_documento', 'otro_padre_en_compania',
      'estudia_fundacion', 'nivel_educativo']) {
      expect(tarjeta.querySelector('[formControlName="' + c + '"]')).not.toBeNull();
    }
  });

  it('la edad del hijo sale de la fecha: meses por debajo del año', () => {
    const f = crear(['hijos']);
    const hace8Meses = new Date();
    hace8Meses.setMonth(hace8Meses.getMonth() - 8);
    (form.get('hijos') as FormArray).push(hijo(new FormBuilder(), { fecha_nac: hace8Meses }));
    f.componentInstance.hijos = [{ nombre: '', edad: '' }];
    f.detectChanges();
    expect(f.nativeElement.querySelector('.fe-hijo-edad').textContent).toContain('8 meses');
  });

  it('las referencias son DOS personales y DOS familiares, con nombre y parentesco', () => {
    const f = crear(['referencias']);
    for (const c of [
      'nombreReferenciaPersonal1', 'parentescoReferenciaPersonal1',
      'nombreReferenciaPersonal2', 'parentescoReferenciaPersonal2',
      'nombreReferenciaFamiliar1', 'parentescoReferenciaFamiliar1',
      'nombreReferenciaFamiliar2', 'parentescoReferenciaFamiliar2',
    ]) {
      expect(f.nativeElement.querySelector('[formControlName="' + c + '"]')).not.toBeNull();
    }
    // Teléfono, ocupación y dirección salieron de la vista; sus controles siguen
    // en el formulario y se guardan igual.
    for (const c of [
      'telefonoReferenciaPersonal1', 'ocupacionReferenciaPersonal1', 'direccionReferenciaPersonal1',
      'telefonoReferenciaFamiliar1', 'ocupacionReferenciaFamiliar1', 'direccionReferenciaFamiliar1',
    ]) {
      expect(f.nativeElement.querySelector('[formControlName="' + c + '"]')).toBeNull();
    }
  });

  it('PINTA el valor que ya trae el formulario (regresión del <form> anidado)', () => {
    // Con un <form [formGroup]> propio dentro del <form> del panel había dos
    // FormGroupDirective sobre los mismos controles y los campos salían vacíos
    // aunque el formulario tuviera los datos.
    const f = crear(['personales']);
    const input: HTMLInputElement =
      f.nativeElement.querySelector('[formControlName="primer_nombre"]');
    expect(input.value).toBe('ANA');
  });

  it('escribe sobre el formulario REAL: no hay copia que sincronizar', () => {
    const f = crear(['personales']);
    const input: HTMLInputElement =
      f.nativeElement.querySelector('[formControlName="primer_nombre"]');
    input.value = 'LUZ';
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
    expect(form.get('primer_nombre')!.value).toBe('LUZ');
  });

  // Pedido #6: salud según ADRES en el bloque de identificación.
  it('sin datos de ADRES no pinta chip ni aviso', () => {
    const f = crear(['identificacion']);
    expect(f.nativeElement.querySelector('.fc-adres')).toBeNull();
  });

  it('régimen de excepción: chip "Régimen especial/excepción" con el detalle', () => {
    const f = crear(['identificacion'], {
      excepcion: { regimen: 'ESPECIAL', entidad: 'FOMAG', estado: null, fecha: null },
      sinRegistro: false,
    });
    const txt = (f.nativeElement.querySelector('.fc-adres--excepcion') as HTMLElement).textContent!;
    expect(txt).toContain('Régimen especial/excepción');
    expect(txt).toContain('Entidad: FOMAG');
  });

  it('ADRES sin registro: aviso suave de verificar la afiliación', () => {
    const f = crear(['identificacion'], { excepcion: null, sinRegistro: true });
    const el = f.nativeElement.querySelector('.fc-adres--verificar') as HTMLElement;
    expect(el.textContent).toContain('Verificar afiliación: ADRES sin registro');
    expect(f.nativeElement.querySelector('.fc-adres--excepcion')).toBeNull();
  });
});
