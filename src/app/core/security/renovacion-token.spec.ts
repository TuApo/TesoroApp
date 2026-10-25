import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';

import { environment } from '../../../environments/environment';
import { interceptor } from '../interceptors/auth.interceptor';
import { tokenVigente } from '../utils/sesion-vigente';
import { CLAVE_REFRESH, renovarToken, tokenParaUsar } from './renovacion-token';

const API = environment.apiUrl;
const URL_RENOVAR = `${API}/gestion_admin/auth/refresh/`;

/** JWT sin firma válida: el front solo lee `exp`. */
function jwt(nombre: string, expEnSeg: number): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'HS512' })}.${b64({ sub: nombre, exp: Math.floor(Date.now() / 1000) + expEnSeg })}.firma`;
}

const VIGENTE = jwt('vigente', 3600);
const VENCIDO = jwt('vencido', -10);
const REFRESH = jwt('refresh', 7 * 24 * 3600);
const NUEVO = jwt('nuevo', 900);
const REFRESH_NUEVO = jwt('refresh-nuevo', 7 * 24 * 3600);

const pausa = () => new Promise((r) => setTimeout(r, 0));
async function esperar(cond: () => boolean, ms = 3000): Promise<void> {
  const fin = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fin) throw new Error('tiempo agotado esperando la condición');
    await new Promise((r) => setTimeout(r, 5));
  }
}

function respuestaRenovar(status = 200, cuerpo: object = { token: NUEVO, refresh_token: REFRESH_NUEVO }) {
  return Promise.resolve(new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } }));
}

describe('renovación del access token', () => {
  let fetchSpy: jasmine.Spy;

  beforeEach(() => {
    localStorage.clear();
    fetchSpy = spyOn(window, 'fetch').and.callFake(() => respuestaRenovar());
  });

  afterEach(() => localStorage.clear());

  describe('módulo', () => {
    it('con el token vigente no renueva', async () => {
      localStorage.setItem('token', VIGENTE);
      localStorage.setItem(CLAVE_REFRESH, REFRESH);
      expect(await tokenParaUsar()).toBe(VIGENTE);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('vencido con refresh: renueva, guarda el par nuevo y lo devuelve', async () => {
      localStorage.setItem('token', VENCIDO);
      localStorage.setItem(CLAVE_REFRESH, REFRESH);

      expect(await tokenParaUsar()).toBe(NUEVO);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.calls.mostRecent().args;
      expect(url).toBe(URL_RENOVAR);
      expect(JSON.parse(init.body)).toEqual({ refresh_token: REFRESH });
      expect(localStorage.getItem('token')).toBe(NUEVO);
      expect(localStorage.getItem(CLAVE_REFRESH)).toBe(REFRESH_NUEVO);
    });

    it('varias renovaciones a la vez gastan UN solo refresh (el backend lo rota)', async () => {
      localStorage.setItem('token', VENCIDO);
      localStorage.setItem(CLAVE_REFRESH, REFRESH);

      const r = await Promise.all([renovarToken(), renovarToken(), tokenParaUsar()]);

      expect(r).toEqual([NUEVO, NUEVO, NUEVO]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('si otra pestaña ya renovó, usa su token sin volver a renovar', async () => {
      localStorage.setItem('token', VENCIDO);
      localStorage.setItem(CLAVE_REFRESH, REFRESH);
      // Simula la otra pestaña: escribe el token nuevo mientras esta espera el cerrojo.
      const locks = (navigator as any).locks;
      if (!locks?.request) { pending('Web Locks no disponible en este navegador'); return; }
      let soltar: (() => void) | undefined;
      const ocupado = locks.request('tuapo-renovar-token', () => new Promise<void>((r) => (soltar = r)));
      await esperar(() => !!soltar);

      const p = renovarToken();
      localStorage.setItem('token', NUEVO);
      soltar!();
      await ocupado;

      expect(await p).toBe(NUEVO);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('refresh rechazado (401): lo borra y devuelve null', async () => {
      fetchSpy.and.callFake(() => respuestaRenovar(401, { error: 'Refresh token revocado' }));
      localStorage.setItem('token', VENCIDO);
      localStorage.setItem(CLAVE_REFRESH, REFRESH);

      expect(await renovarToken()).toBeNull();
      expect(localStorage.getItem(CLAVE_REFRESH)).toBeNull();
    });

    it('servidor caído (503): conserva el refresh para después', async () => {
      fetchSpy.and.callFake(() => respuestaRenovar(503, {}));
      localStorage.setItem('token', VENCIDO);
      localStorage.setItem(CLAVE_REFRESH, REFRESH);

      expect(await renovarToken()).toBeNull();
      expect(localStorage.getItem(CLAVE_REFRESH)).toBe(REFRESH);
    });

    it('sin refresh no hace nada (backend con refresh apagado)', async () => {
      localStorage.setItem('token', VENCIDO);
      expect(await tokenParaUsar()).toBe(VENCIDO);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('tokenVigente: access vencido con refresh vigente cuenta como sesión', () => {
      localStorage.setItem('token', VENCIDO);
      expect(tokenVigente()).toBeFalse();
      localStorage.setItem(CLAVE_REFRESH, REFRESH);
      expect(tokenVigente()).toBeTrue();
      localStorage.setItem(CLAVE_REFRESH, jwt('refresh-vencido', -10));
      expect(tokenVigente()).toBeFalse();
    });
  });

  describe('interceptor', () => {
    let http: HttpClient;
    let ctrl: HttpTestingController;
    let router: jasmine.SpyObj<Router>;

    beforeEach(() => {
      router = jasmine.createSpyObj<Router>('Router', ['navigate', 'navigateByUrl']);
      router.navigateByUrl.and.resolveTo(true);
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(withInterceptors([interceptor])),
          provideHttpClientTesting(),
          { provide: Router, useValue: router },
        ],
      });
      http = TestBed.inject(HttpClient);
      ctrl = TestBed.inject(HttpTestingController);
    });

    afterEach(() => ctrl.verify());

    it('401 con refresh: renueva y reintenta con el token nuevo, sin cerrar sesión', async () => {
      localStorage.setItem('token', VIGENTE);
      localStorage.setItem(CLAVE_REFRESH, REFRESH);
      let resultado: any;
      http.post(`${API}/gestion_nomina/novedades`, { a: 1 }).subscribe((r) => (resultado = r));

      const primera = ctrl.expectOne(`${API}/gestion_nomina/novedades`);
      expect(primera.request.headers.get('Authorization')).toBe(`Bearer ${VIGENTE}`);
      primera.flush(null, { status: 401, statusText: 'Unauthorized' });

      await esperar(() => fetchSpy.calls.count() === 1);
      await pausa();
      const reintento = ctrl.expectOne(`${API}/gestion_nomina/novedades`);
      expect(reintento.request.headers.get('Authorization')).toBe(`Bearer ${NUEVO}`);
      expect(reintento.request.body).toEqual({ a: 1 });
      reintento.flush({ ok: true });

      expect(resultado).toEqual({ ok: true });
      expect(localStorage.getItem('token')).toBe(NUEVO);
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('token ya vencido con refresh: renueva ANTES de enviar', async () => {
      localStorage.setItem('token', VENCIDO);
      localStorage.setItem(CLAVE_REFRESH, REFRESH);
      http.get(`${API}/gestion_hr/personas`).subscribe();

      ctrl.expectNone(`${API}/gestion_hr/personas`);
      await esperar(() => fetchSpy.calls.count() === 1);
      await pausa();
      const req = ctrl.expectOne(`${API}/gestion_hr/personas`);
      expect(req.request.headers.get('Authorization')).toBe(`Bearer ${NUEVO}`);
      req.flush([]);
    });

    it('401 y la renovación falla: cierra sesión como siempre', async () => {
      fetchSpy.and.callFake(() => respuestaRenovar(401, {}));
      localStorage.setItem('token', VIGENTE);
      localStorage.setItem(CLAVE_REFRESH, REFRESH);
      let error: any;
      http.get(`${API}/gestion_hr/personas`).subscribe({ error: (e) => (error = e) });

      ctrl.expectOne(`${API}/gestion_hr/personas`).flush(null, { status: 401, statusText: 'Unauthorized' });
      await esperar(() => error !== undefined);

      expect(error.status).toBe(401);
      expect(localStorage.getItem('token')).toBeNull();
      await esperar(() => router.navigateByUrl.calls.any());
      expect(router.navigateByUrl).toHaveBeenCalledWith('/');
    });

    it('401 sin refresh: no intenta renovar (comportamiento anterior)', async () => {
      localStorage.setItem('token', VIGENTE);
      let error: any;
      http.get(`${API}/gestion_hr/personas`).subscribe({ error: (e) => (error = e) });

      ctrl.expectOne(`${API}/gestion_hr/personas`).flush(null, { status: 401, statusText: 'Unauthorized' });
      await esperar(() => error !== undefined);

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(localStorage.getItem('token')).toBeNull();
    });

    it('el reintento vuelve a dar 401: no entra en bucle, cierra sesión', async () => {
      localStorage.setItem('token', VIGENTE);
      localStorage.setItem(CLAVE_REFRESH, REFRESH);
      let error: any;
      http.get(`${API}/gestion_hr/personas`).subscribe({ error: (e) => (error = e) });

      ctrl.expectOne(`${API}/gestion_hr/personas`).flush(null, { status: 401, statusText: 'Unauthorized' });
      await esperar(() => fetchSpy.calls.count() === 1);
      await pausa();
      ctrl.expectOne(`${API}/gestion_hr/personas`).flush(null, { status: 401, statusText: 'Unauthorized' });
      await esperar(() => error !== undefined);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(error.status).toBe(401);
    });

    it('las rutas de auth (logout) no se renuevan', async () => {
      localStorage.setItem('token', VENCIDO);
      localStorage.setItem(CLAVE_REFRESH, REFRESH);
      http.post(`${API}/gestion_admin/auth/logout/`, null).subscribe({ error: () => undefined });

      const req = ctrl.expectOne(`${API}/gestion_admin/auth/logout/`);
      expect(req.request.headers.get('Authorization')).toBe(`Bearer ${VENCIDO}`);
      req.flush(null, { status: 401, statusText: 'Unauthorized' });
      await pausa();

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
