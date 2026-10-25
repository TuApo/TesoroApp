import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';

import { environment } from '../../../environments/environment';
import { interceptor } from '../interceptors/auth.interceptor';
import { QuickAccessService } from '../security/quick-access.service';
import { SesionService } from './sesion.service';

const LOGOUT_URL = `${environment.apiUrl}/gestion_admin/auth/logout/`;

// El borrado de la caché va a IndexedDB (puente offline), que no corre en la zona falsa de
// fakeAsync: se espera de verdad a que llegue la navegación final.
async function esperar(cond: () => boolean, ms = 5000): Promise<void> {
  const fin = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fin) throw new Error('tiempo agotado esperando la condición');
    await new Promise((r) => setTimeout(r, 10));
  }
}
const pausa = () => new Promise((r) => setTimeout(r, 0));

describe('SesionService.cerrarSesion', () => {
  let service: SesionService;
  let http: HttpTestingController;
  let router: jasmine.SpyObj<Router>;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('token', 'abc.def.ghi');
    router = jasmine.createSpyObj<Router>('Router', ['navigate', 'navigateByUrl']);
    router.navigate.and.resolveTo(true);
    router.navigateByUrl.and.resolveTo(true);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([interceptor])),
        provideHttpClientTesting(),
        { provide: Router, useValue: router },
        { provide: QuickAccessService, useValue: { olvidar: () => Promise.resolve() } },
      ],
    });
    service = TestBed.inject(SesionService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('revoca en el servidor con el token de la sesión y después borra el equipo', async () => {
    let terminado = false;
    service.cerrarSesion(0).then(() => (terminado = true));
    await pausa();

    const req = http.expectOne(LOGOUT_URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Authorization')).toBe('Bearer abc.def.ghi');
    // El token sigue ahí mientras el logout está en vuelo: si se borrara antes, el interceptor
    // no tendría qué mandar.
    expect(localStorage.getItem('token')).toBe('abc.def.ghi');

    req.flush({ ok: true });
    await esperar(() => terminado && router.navigate.calls.any());

    expect(localStorage.getItem('token')).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(['']);
  });

  it('si el servidor falla, la sesión se cierra igual en el equipo', async () => {
    service.cerrarSesion(0);
    await pausa();

    http.expectOne(LOGOUT_URL).flush('caído', { status: 503, statusText: 'Service Unavailable' });
    await esperar(() => router.navigate.calls.any());

    expect(localStorage.getItem('token')).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(['']);
  });

  it('si el servidor no responde, sale a los 3 s sin esperar más', async () => {
    const inicio = Date.now();
    service.cerrarSesion(0);
    await pausa();
    const req = http.expectOne(LOGOUT_URL);

    await esperar(() => router.navigate.calls.any(), 6000);
    expect(Date.now() - inicio).toBeLessThan(4500);

    expect(req.cancelled).toBeTrue();
    expect(localStorage.getItem('token')).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(['']);
  }, 8000);

  it('con envíos pendientes y Cancelar, no revoca ni borra nada', async () => {
    spyOn(Swal, 'fire').and.resolveTo({ isConfirmed: false, isDenied: false, isDismissed: true } as any);

    await service.cerrarSesion(2);
    await pausa();

    http.expectNone(LOGOUT_URL);
    expect(localStorage.getItem('token')).toBe('abc.def.ghi');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('con envíos pendientes y «Mantener pendientes», revoca antes de borrar', async () => {
    spyOn(Swal, 'fire').and.resolveTo({ isConfirmed: true, isDenied: false, isDismissed: false } as any);

    service.cerrarSesion(2);
    await pausa();

    const req = http.expectOne(LOGOUT_URL);
    expect(req.request.headers.get('Authorization')).toBe('Bearer abc.def.ghi');
    req.flush({ ok: true });
    await esperar(() => router.navigate.calls.any());

    expect(localStorage.getItem('token')).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(['']);
  });
});
