import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';

import {
  ContactoComprobarData, ContactoComprobarDialogComponent,
} from './contacto-comprobar.dialog';
import { PlantillasCorreoService } from '../../../plantillas-correo/services/plantillas-correo.service';

/**
 * Lo que importa aquí es que "comprobado" signifique algo: antes se marcaba sin
 * enviar nada. El contacto solo puede quedar confirmado si el proveedor dijo
 * que el correo salió.
 */
describe('ContactoComprobarDialogComponent', () => {
  let svc: jasmine.SpyObj<PlantillasCorreoService>;
  let cerrar: jasmine.Spy;

  function crear(data: Partial<ContactoComprobarData> = {}) {
    svc = jasmine.createSpyObj('PlantillasCorreoService', ['listar', 'enviarPrueba']);
    svc.listar.and.returnValue(of([
      { id: 'p1', nombre: 'Bienvenida', destacada: false, asunto_actual: 'Hola' },
      { id: 'p2', nombre: 'Ingreso', destacada: true, asunto_actual: 'Tus accesos' },
    ] as any));
    cerrar = jasmine.createSpy('close');

    const full: ContactoComprobarData = {
      modo: 'correo', nombre: 'ANA GÓMEZ', cedula: '1004803288',
      destino: 'ana@example.com', password: null, ...data,
    };

    TestBed.configureTestingModule({
      imports: [ContactoComprobarDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: full },
        { provide: MatDialogRef, useValue: { close: cerrar } },
        { provide: PlantillasCorreoService, useValue: svc },
      ],
    });
    const f: ComponentFixture<ContactoComprobarDialogComponent> =
      TestBed.createComponent(ContactoComprobarDialogComponent);
    f.detectChanges();
    return f;
  }

  describe('correo', () => {
    it('preselecciona la plantilla destacada', () => {
      const f = crear();
      expect(f.componentInstance.plantillaId()).toBe('p2');
    });

    it('no deja confirmar antes de enviar', () => {
      const f = crear();
      expect(f.componentInstance.puedeConfirmarCorreo()).toBeFalse();
    });

    it('manda la cedula como clave, para que salga con SUS datos', () => {
      const f = crear();
      svc.enviarPrueba.and.returnValue(of({ enviado: true } as any));
      f.componentInstance.enviarCorreo();
      expect(svc.enviarPrueba).toHaveBeenCalledWith('p2', jasmine.objectContaining({
        destinatario: 'ana@example.com', clave: '1004803288',
      }));
    });

    it('un envio confirmado habilita marcar como comprobado', () => {
      const f = crear();
      svc.enviarPrueba.and.returnValue(of({ enviado: true, remitente: 'no-reply@tuapo.co' } as any));
      f.componentInstance.enviarCorreo();
      expect(f.componentInstance.puedeConfirmarCorreo()).toBeTrue();
    });

    it('si el proveedor NO confirma, no se puede marcar y se dice por que', () => {
      const f = crear();
      svc.enviarPrueba.and.returnValue(of({ enviado: false, mensaje: 'Buzon inexistente' } as any));
      f.componentInstance.enviarCorreo();
      expect(f.componentInstance.puedeConfirmarCorreo()).toBeFalse();
      expect(f.componentInstance.error()).toBe('Buzon inexistente');
    });

    it('si el envio revienta tampoco se puede marcar', () => {
      const f = crear();
      svc.enviarPrueba.and.returnValue(throwError(() => ({ error: { error: 'Cuota agotada' } })));
      f.componentInstance.enviarCorreo();
      expect(f.componentInstance.puedeConfirmarCorreo()).toBeFalse();
      expect(f.componentInstance.error()).toBe('Cuota agotada');
    });
  });

  describe('whatsapp', () => {
    it('el mensaje lleva el enlace de ingreso y el usuario', () => {
      const f = crear({ modo: 'whatsapp', destino: '3001234567' });
      const m = f.componentInstance.mensaje();
      expect(m).toContain('https://tesoro.tuapo.co');
      expect(m).toContain('1004803288');
      expect(m).toContain('ANA GÓMEZ');
    });

    it('sin contrasena NO se inventa una: explica como crearla', () => {
      const f = crear({ modo: 'whatsapp', destino: '3001234567' });
      expect(f.componentInstance.mensaje()).toContain('¿Olvidaste tu contraseña?');
    });

    it('con contrasena, va en el mensaje', () => {
      const f = crear({ modo: 'whatsapp', destino: '3001234567', password: 'Abc12345' });
      expect(f.componentInstance.mensaje()).toContain('Contraseña: Abc12345');
    });

    it('no deja marcar sin haber abierto WhatsApp', () => {
      const f = crear({ modo: 'whatsapp', destino: '3001234567' });
      expect(f.componentInstance.abierto()).toBeFalse();
    });
  });
});
