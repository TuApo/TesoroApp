import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';

import { CorreosService } from './correos.service';
import { environment } from '@/environments/environment';
import { CorreoCuenta, CorreoCuentaUpsert } from '../models/correo-cuenta.model';

/**
 * Contrato HTTP del submódulo Correos electrónicos contra ms-auth-admin.
 * Verifica rutas, verbos, filtros y —sobre todo— que la credencial solo viaja
 * cuando el operador escribió una nueva.
 */
describe('CorreosService', () => {
  let service: CorreosService;
  let httpMock: HttpTestingController;
  const base = `${environment.apiUrl}/api/v1/admin/correos`;

  const cuenta: CorreoCuenta = {
    id: '11111111-1111-1111-1111-111111111111',
    direccion: 'envios@tuapo.co',
    nombre_mostrar: 'Envíos TuApo',
    proveedor: 'GMAIL',
    proposito: 'Nómina',
    smtp_host: 'smtp.gmail.com',
    smtp_port: 465,
    smtp_usuario: 'envios@tuapo.co',
    cuota_diaria: 500,
    limite_efectivo: 450,
    umbral_corte_pct: 90,
    enviados_hoy: 0,
    disponible_hoy: 450,
    estado_verificacion: 'VERIFICADA',
    ultima_verificacion: '2026-08-03T10:00:00Z',
    mensaje_ultima_verificacion: 'Conexion y autenticacion SMTP correctas.',
    activo: true,
    notas: null,
    credencial_configurada: true,
    aporta_cuota: true,
    creado_por: null,
    creado_en: '2026-08-01T10:00:00Z',
    actualizado_por: null,
    actualizado_en: null,
  };

  const payload: CorreoCuentaUpsert = {
    direccion: 'envios@tuapo.co',
    nombre_mostrar: 'Envíos TuApo',
    proveedor: 'GMAIL',
    proposito: 'Nómina',
    smtp_host: 'smtp.gmail.com',
    smtp_port: 465,
    smtp_usuario: 'envios@tuapo.co',
    cuota_diaria: 500,
    notas: null,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    service = TestBed.inject(CorreosService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('listar() sin filtros hace GET plano', () => {
    service.listar().subscribe();
    const req = httpMock.expectOne(base);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys().length).toBe(0);
    req.flush([cuenta]);
  });

  it('listar() traduce los filtros a query params', () => {
    service.listar({ q: ' nomina ', proveedor: 'GMAIL', activo: false, estadoVerificacion: 'PENDIENTE', proposito: 'Nómina' })
      .subscribe();
    const req = httpMock.expectOne((r) => r.url === base);
    expect(req.request.params.get('q')).toBe('nomina');
    expect(req.request.params.get('proveedor')).toBe('GMAIL');
    expect(req.request.params.get('activo')).toBe('false');
    expect(req.request.params.get('estado_verificacion')).toBe('PENDIENTE');
    expect(req.request.params.get('proposito')).toBe('Nómina');
    req.flush([]);
  });

  it('crear() hace POST con la credencial cuando se capturó', () => {
    service.crear({ ...payload, smtp_password: 'clave-de-prueba' }).subscribe();
    const req = httpMock.expectOne(base);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.smtp_password).toBe('clave-de-prueba');
    req.flush(cuenta);
  });

  it('actualizar() sin smtp_password no envía el campo (conserva la credencial)', () => {
    service.actualizar(cuenta.id, payload).subscribe();
    const req = httpMock.expectOne(`${base}/${cuenta.id}`);
    expect(req.request.method).toBe('PUT');
    expect('smtp_password' in req.request.body).toBeFalse();
    req.flush(cuenta);
  });

  it('desactivar() y reactivar() usan PATCH sobre sus subrutas', () => {
    service.desactivar(cuenta.id).subscribe();
    const off = httpMock.expectOne(`${base}/${cuenta.id}/desactivar`);
    expect(off.request.method).toBe('PATCH');
    off.flush({ ...cuenta, activo: false });

    service.reactivar(cuenta.id).subscribe();
    const on = httpMock.expectOne(`${base}/${cuenta.id}/reactivar`);
    expect(on.request.method).toBe('PATCH');
    on.flush(cuenta);
  });

  it('verificar() hace POST y devuelve el resultado técnico', async () => {
    let recibido: any = null;
    service.verificar(cuenta.id).subscribe((r) => (recibido = r));
    const req = httpMock.expectOne(`${base}/${cuenta.id}/verificar`);
    expect(req.request.method).toBe('POST');
    req.flush({ verificada: true, estado_verificacion: 'VERIFICADA', mensaje: 'ok', cuenta });
    expect(recibido.verificada).toBeTrue();
  });

  it('resumenCuota() consulta el pool de cuota', () => {
    let recibido: any = null;
    service.resumenCuota().subscribe((r) => (recibido = r));
    const req = httpMock.expectOne(`${base}/cuota/resumen`);
    expect(req.request.method).toBe('GET');
    req.flush({
      cuentas_activas: 4, cuentas_verificadas: 3, cuota_total: 1000,
      limite_efectivo_total: 900, umbral_corte_pct: 90, enviados_hoy: 0, disponible_hoy: 900,
    });
    expect(recibido.limite_efectivo_total).toBe(900);
    expect(recibido.disponible_hoy).toBe(900);
  });

  it('no existe un método de borrado físico', () => {
    expect((service as any).eliminar).toBeUndefined();
    expect((service as any).borrar).toBeUndefined();
  });
});
