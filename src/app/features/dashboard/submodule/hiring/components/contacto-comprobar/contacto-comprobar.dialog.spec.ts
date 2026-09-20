import { ComponentFixture, TestBed, fakeAsync, tick, discardPeriodicTasks } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';

import {
  ContactoComprobarData, ContactoComprobarDialogComponent,
} from './contacto-comprobar.dialog';
import {
  ComprobacionCorreoService, EstadoComprobacionCorreo,
} from '../../service/comprobacion-correo/comprobacion-correo.service';

/**
 * Lo que importa aquí es que "comprobado" signifique algo: solo se marca con el código
 * correcto que dicta la persona o cuando ella pulsa el botón del correo.
 */
describe('ContactoComprobarDialogComponent', () => {
  let svc: jasmine.SpyObj<ComprobacionCorreoService>;
  let cerrar: jasmine.Spy;

  const pendiente: EstadoComprobacionCorreo = {
    id: 'c1', correo: 'ana@example.com', confirmado: false, confirmado_por: null,
    confirmado_en: null, expira_en: '2026-09-17T20:00:00Z', vigente: true, intentos_restantes: 5,
  };

  function crear(data: Partial<ContactoComprobarData> = {}) {
    svc = jasmine.createSpyObj('ComprobacionCorreoService', ['enviar', 'estado', 'verificar']);
    svc.enviar.and.returnValue(of(pendiente));
    svc.estado.and.returnValue(of(pendiente));
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
        { provide: ComprobacionCorreoService, useValue: svc },
      ],
    });
    const f: ComponentFixture<ContactoComprobarDialogComponent> =
      TestBed.createComponent(ContactoComprobarDialogComponent);
    f.detectChanges();
    return f;
  }

  describe('correo', () => {
    it('envia con la cedula y el correo de la ficha, sin plantilla', () => {
      const f = crear();
      f.componentInstance.enviarCorreo();
      expect(svc.enviar).toHaveBeenCalledWith('1004803288', 'ana@example.com');
      f.componentInstance['pararSondeo']();
    });

    it('enviar NO deja marcar como comprobado', () => {
      const f = crear();
      f.componentInstance.enviarCorreo();
      expect(f.componentInstance.puedeConfirmarCorreo()).toBeFalse();
      f.componentInstance['pararSondeo']();
    });

    it('el codigo correcto habilita marcar como comprobado', () => {
      const f = crear();
      f.componentInstance.enviarCorreo();
      svc.verificar.and.returnValue(of({ ...pendiente, confirmado: true, confirmado_por: 'CODIGO' }));
      f.componentInstance.codigo.set('123456');
      f.componentInstance.verificarCodigo();
      expect(svc.verificar).toHaveBeenCalledWith('c1', '123456');
      expect(f.componentInstance.puedeConfirmarCorreo()).toBeTrue();
    });

    it('un codigo incorrecto no marca y dice por que', () => {
      const f = crear();
      f.componentInstance.enviarCorreo();
      svc.verificar.and.returnValue(throwError(() => ({ error: { mensaje: 'El código no coincide. Quedan 4 intento(s).' } })));
      f.componentInstance.codigo.set('000000');
      f.componentInstance.verificarCodigo();
      expect(f.componentInstance.puedeConfirmarCorreo()).toBeFalse();
      expect(f.componentInstance.error()).toContain('no coincide');
      f.componentInstance['pararSondeo']();
    });

    it('detecta solo cuando la persona pulsa el boton del correo', fakeAsync(() => {
      const f = crear();
      f.componentInstance.enviarCorreo();
      svc.estado.and.returnValue(of({ ...pendiente, confirmado: true, confirmado_por: 'ENLACE' }));
      tick(5000);
      expect(f.componentInstance.puedeConfirmarCorreo()).toBeTrue();
      discardPeriodicTasks();
    }));

    it('si el envio falla tampoco se puede marcar', () => {
      const f = crear();
      svc.enviar.and.returnValue(throwError(() => ({ error: { mensaje: 'Cuota agotada' } })));
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
