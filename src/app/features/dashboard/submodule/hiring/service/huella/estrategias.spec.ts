import { EstrategiaAgenteLocal, permisoRedLocal } from './estrategias';
import { HuellaError } from './huella.model';

/**
 * SIMULACIÓN DE LOS TRES CASOS DEL AGENTE LOCAL, sin hardware:
 *
 *   1. Chrome tiene el permiso de red local en `denied`  → no se hace NINGUNA
 *      petición y el motivo es `sin-permiso` (antes era un "Failed to fetch"
 *      idéntico al de un agente apagado).
 *   2. Permiso `granted` y nadie contesta en 127.0.0.1   → `sin-agente`.
 *   3. Permiso `granted` y el agente devuelve la huella  → captura correcta.
 *
 * Más los bordes que importan: `prompt` (el sondeo dispara el aviso de Chrome
 * y se respeta lo que la persona conteste) y un navegador sin la API.
 */
describe('EstrategiaAgenteLocal · Local Network Access de Chrome', () => {
  const BASE = 'http://127.0.0.1:52181';
  let fetchSpy: jasmine.Spy;
  let querySpy: jasmine.Spy;

  /** Deja `navigator.permissions.query` contestando con estos estados, por nombre. */
  const permisos = (estados: Record<string, PermissionState | Error>) => {
    querySpy = jasmine.createSpy('permissions.query').and.callFake(async (d: { name: string }) => {
      const v = estados[d.name];
      if (v === undefined || v instanceof Error) throw v ?? new TypeError(`'${d.name}' is not a valid enum value`);
      return { state: v } as PermissionStatus;
    });
    spyOnProperty(navigator, 'permissions', 'get').and.returnValue({ query: querySpy } as any);
  };

  const respuesta = (cuerpo: unknown, status = 200) =>
    new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });

  beforeEach(() => {
    fetchSpy = spyOn(window, 'fetch');
  });

  describe('permisoRedLocal()', () => {
    it('pregunta primero por loopback-network (Chrome 145+)', async () => {
      permisos({ 'loopback-network': 'granted', 'local-network-access': 'denied' });
      expect(await permisoRedLocal()).toBe('granted');
      expect(querySpy).toHaveBeenCalledTimes(1);
    });

    it('cae al alias local-network-access en Chrome 142-144', async () => {
      permisos({ 'local-network-access': 'denied' });
      expect(await permisoRedLocal()).toBe('denied');
      expect(querySpy).toHaveBeenCalledTimes(2);
    });

    it('devuelve desconocido en un navegador sin la API', async () => {
      permisos({});
      expect(await permisoRedLocal()).toBe('desconocido');
    });
  });

  describe('caso 1 · permiso bloqueado por el navegador', () => {
    beforeEach(() => permisos({ 'loopback-network': 'denied' }));

    it('comprobar(): no toca la red y dice sin-permiso', async () => {
      const e = new EstrategiaAgenteLocal(BASE);
      expect(await e.comprobar()).toEqual({ disponible: false, motivo: 'sin-permiso' });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(e.permiso).toBe('denied');
      expect(e.detalleFallo).toContain('bloqueado');
    });

    it('capturar(): tampoco toca la red y el error lleva el motivo', async () => {
      const e = new EstrategiaAgenteLocal(BASE);
      await expectAsync(e.capturar()).toBeRejectedWith(
        jasmine.objectContaining({ name: 'HuellaError', motivo: 'sin-permiso' }));
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('caso 2 · permiso concedido, agente apagado o colgado', () => {
    beforeEach(() => permisos({ 'loopback-network': 'granted' }));

    it('comprobar(): conexión rechazada → sin-agente, sin culpar al navegador', async () => {
      fetchSpy.and.rejectWith(new TypeError('Failed to fetch'));
      const e = new EstrategiaAgenteLocal(BASE);
      expect(await e.comprobar()).toEqual({ disponible: false, motivo: 'sin-agente' });
      expect(e.detalleFallo).toContain('escuchando');
      // No hace falta el tiro en no-cors: el permiso ya dijo que Chrome no estorba.
      expect(fetchSpy.calls.allArgs().some(([, init]) => (init as RequestInit)?.mode === 'no-cors')).toBeFalse();
    });

    it('comprobar(): agente colgado → sin-agente por tiempo', async () => {
      fetchSpy.and.callFake((_u: any, init: RequestInit) => new Promise((_r, rej) => {
        init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }));
      const e = new EstrategiaAgenteLocal(BASE, 20);
      expect(await e.comprobar()).toEqual({ disponible: false, motivo: 'sin-agente' });
      expect(e.detalleFallo).toContain('a tiempo');
    });

    it('capturar(): el error lleva motivo sin-agente y manda a abrir el programa', async () => {
      fetchSpy.and.rejectWith(new TypeError('Failed to fetch'));
      const e = new EstrategiaAgenteLocal(BASE);
      const err = await e.capturar().catch((x) => x) as HuellaError;
      expect(err.motivo).toBe('sin-agente');
      expect(err.message).toContain('Ábrelo o reinícialo');
    });
  });

  describe('caso 3 · permiso concedido y captura correcta', () => {
    beforeEach(() => permisos({ 'loopback-network': 'granted' }));

    it('comprobar(): el agente ve el lector', async () => {
      fetchSpy.and.resolveTo(respuesta({ ok: true, dispositivo: 'U.are.U 4500' }));
      const e = new EstrategiaAgenteLocal(BASE);
      expect(await e.comprobar()).toEqual({ disponible: true });
      expect(fetchSpy.calls.mostRecent().args[0]).toBe(`${BASE}/ping`);
    });

    it('capturar(): devuelve la huella como data URL', async () => {
      fetchSpy.and.resolveTo(respuesta({ imagenBase64: 'AAAA', dispositivo: 'U.are.U 4500', width: 357, height: 392, dpi: 500 }));
      const e = new EstrategiaAgenteLocal(BASE);
      const c = await e.capturar();
      expect(c.dataUrl).toBe('data:image/png;base64,AAAA');
      expect(c.origen).toBe('agente-local');
      expect(c.ancho).toBe(357);
      expect(fetchSpy.calls.mostRecent().args[0]).toBe(`${BASE}/capturar`);
    });

    it('lector conectado pero sin dedo: el texto del agente, sin motivo de red', async () => {
      fetchSpy.and.resolveTo(respuesta({ error: 'No se detectó ningún dedo en 25 s' }, 500));
      const e = new EstrategiaAgenteLocal(BASE);
      const err = await e.capturar().catch((x) => x) as HuellaError;
      expect(err.message).toContain('ningún dedo');
      expect(err.motivo).toBeUndefined();
    });

    it('agente responde pero no ve el USB → sin-lector', async () => {
      fetchSpy.and.resolveTo(respuesta({ ok: false, error: 'sin-lector' }));
      const e = new EstrategiaAgenteLocal(BASE);
      expect(await e.comprobar()).toEqual({ disponible: false, motivo: 'sin-lector' });
    });
  });

  describe('permiso en prompt · el sondeo dispara el aviso de Chrome', () => {
    it('la petición sale con plazo largo y si la persona bloquea, queda sin-permiso', async () => {
      let llamadas = 0;
      querySpy = jasmine.createSpy('q').and.callFake(async () => ({ state: llamadas++ === 0 ? 'prompt' : 'denied' }));
      spyOnProperty(navigator, 'permissions', 'get').and.returnValue({ query: querySpy } as any);
      fetchSpy.and.rejectWith(new TypeError('Failed to fetch'));

      const e = new EstrategiaAgenteLocal(BASE, 20, 30000, 500);
      expect(await e.comprobar()).toEqual({ disponible: false, motivo: 'sin-permiso' });
      expect(fetchSpy).toHaveBeenCalled();
      expect(e.permiso).toBe('denied');
    });

    it('si la persona permite, el sondeo vale', async () => {
      let llamadas = 0;
      querySpy = jasmine.createSpy('q').and.callFake(async () => ({ state: llamadas++ === 0 ? 'prompt' : 'granted' }));
      spyOnProperty(navigator, 'permissions', 'get').and.returnValue({ query: querySpy } as any);
      fetchSpy.and.resolveTo(respuesta({ ok: true, dispositivo: 'U.are.U 4500' }));

      const e = new EstrategiaAgenteLocal(BASE);
      expect(await e.comprobar()).toEqual({ disponible: true });
    });
  });

  describe('navegador sin la API de permisos', () => {
    it('sigue el camino de antes (tiro en no-cors para distinguir)', async () => {
      permisos({});
      fetchSpy.and.rejectWith(new TypeError('Failed to fetch'));
      const e = new EstrategiaAgenteLocal(BASE);
      const r = await e.comprobar();
      expect(r.disponible).toBeFalse();
      expect(fetchSpy.calls.allArgs().some(([, init]) => (init as RequestInit)?.mode === 'no-cors')).toBeTrue();
    });
  });
});
