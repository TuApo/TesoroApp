import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { environment } from '@/environments/environment';
import { IncapacidadGestionService } from './incapacidad-gestion.service';

/** Contrato HTTP de los submodulos nuevos: rutas, params sin vacios y cuerpos con actor. */
describe('IncapacidadGestionService', () => {
  let servicio: IncapacidadGestionService;
  let http: HttpTestingController;
  const base = `${environment.apiUrl}/Incapacidades/v2`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    servicio = TestBed.inject(IncapacidadGestionService);
    http = TestBed.inject(HttpTestingController);
    localStorage.setItem('user', JSON.stringify({ email: 'daniel@tuapo.co' }));
  });

  afterEach(() => {
    http.verify();
    localStorage.removeItem('user');
  });

  it('lee y actualiza la configuracion del envio con el actor en el cuerpo', () => {
    servicio.correoConfig().subscribe();
    http.expectOne(`${base}/correos/config`).flush({});

    servicio.actualizarCorreoConfig({ envioModo: 'INMEDIATO', envioHora: '18:30' }).subscribe();
    const put = http.expectOne(`${base}/correos/config`);
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ envioModo: 'INMEDIATO', envioHora: '18:30', actor: 'daniel@tuapo.co' });
    put.flush({});
  });

  it('el directorio omite params vacios y la baja es DELETE', () => {
    servicio.directorio('', false).subscribe();
    const get = http.expectOne((r) => r.url === `${base}/correos/empresas`);
    expect(get.request.params.keys()).toEqual([]);
    get.flush([]);

    servicio.directorio('ALIANZA', true).subscribe();
    const conParams = http.expectOne((r) => r.url === `${base}/correos/empresas`);
    expect(conParams.request.params.get('grupo')).toBe('ALIANZA');
    expect(conParams.request.params.get('incluirInactivos')).toBe('true');
    conParams.flush([]);

    servicio.desactivarCorreoEmpresa(7).subscribe();
    expect(http.expectOne(`${base}/correos/empresas/7`).request.method).toBe('DELETE');
  });

  it('previsualiza y envia el lote; el cuerpo del envio se pide como texto', () => {
    servicio.previsualizarLote('2026-09-08').subscribe();
    const prev = http.expectOne((r) => r.url === `${base}/correos/lotes/previsualizar`);
    expect(prev.request.params.get('fecha')).toBe('2026-09-08');
    prev.flush({});

    servicio.enviarLoteAhora().subscribe();
    const post = http.expectOne(`${base}/correos/lotes/enviar`);
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({ actor: 'daniel@tuapo.co' });
    post.flush({});

    servicio.cuerpoEnvio(3).subscribe((html) => expect(html).toContain('<p>'));
    const cuerpo = http.expectOne(`${base}/correos/envios/3/cuerpo`);
    expect(cuerpo.request.responseType).toBe('text');
    cuerpo.flush('<p>hola</p>');
  });

  it('informes, alertas y SST usan las rutas nuevas', () => {
    servicio.informeGlobal({ desde: '2026-01-01', hasta: '', grupo: 'APOYO' }).subscribe();
    const g = http.expectOne((r) => r.url === `${base}/informes/global`);
    expect(g.request.params.get('desde')).toBe('2026-01-01');
    expect(g.request.params.has('hasta')).toBeFalse();
    expect(g.request.params.get('grupo')).toBe('APOYO');
    g.flush({});

    servicio.informeRecurrencia({}, 2, 3).subscribe();
    const r = http.expectOne((x) => x.url === `${base}/informes/recurrencia`);
    expect(r.request.params.get('minEventos')).toBe('3');
    r.flush({});

    servicio.atenderAlerta(9, 'ATENDIDA', 'ok').subscribe();
    const a = http.expectOne(`${base}/alertas/9/atender`);
    expect(a.request.body).toEqual({ estado: 'ATENDIDA', nota: 'ok', actor: 'daniel@tuapo.co' });
    a.flush({});

    const archivo = new File(['%PDF-1.4'], 'inv.pdf', { type: 'application/pdf' });
    servicio.sstSubirArchivo(5, archivo).subscribe();
    const s = http.expectOne(`${base}/sst/5/investigacion/archivo`);
    expect(s.request.body instanceof FormData).toBeTrue();
    expect((s.request.body as FormData).get('actor')).toBe('daniel@tuapo.co');
    s.flush({});
  });
});
