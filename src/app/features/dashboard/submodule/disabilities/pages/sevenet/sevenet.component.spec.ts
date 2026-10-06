/**
 * Pruebas de la pantalla SEVENET (reunion 2026-10-05): rango semanal (lunes a sabado), eje de
 * fecha, conteo previo con los MISMOS filtros del trabajo, generacion del ZIP_SEVENET con
 * sondeo y descarga automatica, y el boton del archivo plano deshabilitado.
 */
import { provideZonelessChangeDetection } from '@angular/core';
import {
  ComponentFixture,
  TestBed,
  discardPeriodicTasks,
  fakeAsync,
  tick,
} from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { environment } from '@/environments/environment';
import { ExportJob } from '../../models/incapacidad-v2.model';
import { aIsoCorto } from '../../utils/fechas';
import { INTERVALO_SONDEO_MS } from '../consulta-incapacidades/dialogos/dialogo-export-masivo/dialogo-export-masivo.component';
import {
  AVISO_ARCHIVO_PLANO,
  MS_ESPERA_CONTEO,
  SevenetComponent,
  filtrosSevenet,
  semanaCartera,
} from './sevenet.component';

const BASE = `${environment.apiUrl}/Incapacidades/v2`;

function job(parcial: Partial<ExportJob> = {}): ExportJob {
  return {
    id: 'job-7',
    tipo: 'ZIP_SEVENET',
    tipoEtiqueta: 'ZIP SEVENET (primera hoja)',
    estado: 'PENDIENTE',
    estadoEtiqueta: 'Pendiente',
    totalRegistros: null,
    procesados: null,
    nombreResultado: null,
    tamanoBytes: null,
    mensajeError: null,
    creadoEn: '2026-10-06T10:00:00',
    ...parcial,
  };
}

/** `yyyy-MM-dd` de un Date local (lo que deben llevar los filtros). */
const iso = (d: Date) => aIsoCorto(d);

describe('semanaCartera (lunes a sabado, como la semana de cartera)', () => {
  it('un miercoles cae en la semana de su lunes al sabado', () => {
    const s = semanaCartera(new Date(2026, 9, 7)); // miercoles 7 de octubre de 2026
    expect(iso(s.inicio)).toBe('2026-10-05');
    expect(iso(s.fin)).toBe('2026-10-10');
  });

  it('el domingo pertenece a la semana que empezo el lunes anterior', () => {
    const s = semanaCartera(new Date(2026, 9, 11)); // domingo
    expect(iso(s.inicio)).toBe('2026-10-05');
    expect(iso(s.fin)).toBe('2026-10-10');
  });

  it('el lunes abre semana nueva y la semana anterior es la de 7 dias antes', () => {
    expect(iso(semanaCartera(new Date(2026, 9, 12)).inicio)).toBe('2026-10-12');
    const anterior = semanaCartera(new Date(2026, 9, 7), -1);
    expect(iso(anterior.inicio)).toBe('2026-09-28');
    expect(iso(anterior.fin)).toBe('2026-10-03');
  });

  it('cruza el cambio de ano sin desfase', () => {
    const s = semanaCartera(new Date(2027, 0, 1)); // viernes 1 de enero de 2027
    expect(iso(s.inicio)).toBe('2026-12-28');
    expect(iso(s.fin)).toBe('2027-01-02');
  });
});

describe('filtrosSevenet', () => {
  it('por registro usa registradoDesde/Hasta y por inicio desde/hasta (contrato de ms-hr)', () => {
    expect(filtrosSevenet('REGISTRO', '2026-10-05', '2026-10-10')).toEqual({
      registradoDesde: '2026-10-05',
      registradoHasta: '2026-10-10',
    });
    expect(filtrosSevenet('INICIO', '2026-10-05', '2026-10-10')).toEqual({
      desde: '2026-10-05',
      hasta: '2026-10-10',
    });
  });
});

describe('SevenetComponent', () => {
  let fixture: ComponentFixture<SevenetComponent>;
  let comp: SevenetComponent;
  let http: HttpTestingController;

  const esConteo = (r: { url: string; method: string }) => r.url === BASE && r.method === 'GET';

  function crear(): void {
    fixture = TestBed.createComponent(SevenetComponent);
    comp = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  }

  /** Deja correr la espera del conteo y responde la UNICA cuenta pendiente. */
  function responderConteo(total: number): TestRequest {
    tick(MS_ESPERA_CONTEO);
    const req = http.expectOne(esConteo);
    req.flush({ content: [], number: 0, size: 1, totalElements: total, totalPages: total });
    return req;
  }

  function texto(): string {
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  beforeEach(async () => {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    await TestBed.configureTestingModule({
      imports: [SevenetComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
      ],
    }).compileComponents();
  });

  afterEach(() => {
    fixture?.destroy();
    http.verify();
  });

  it('arranca con esta semana por fecha de registro y cuenta con esos mismos filtros', fakeAsync(() => {
    crear();
    const semana = semanaCartera(new Date());

    expect(comp.eje()).toBe('REGISTRO');
    expect(comp.atajo()).toBe('ACTUAL');
    // Nada se pide antes de la espera.
    http.expectNone(esConteo);

    const req = responderConteo(12);
    expect(req.request.params.get('page')).toBe('0');
    expect(req.request.params.get('size')).toBe('1');
    expect(req.request.params.get('registradoDesde')).toBe(iso(semana.inicio));
    expect(req.request.params.get('registradoHasta')).toBe(iso(semana.fin));
    expect(req.request.params.has('desde')).toBeFalse();

    expect(comp.conteo()).toBe(12);
    const t = texto();
    expect(t).toContain('SEVENET');
    expect(t).toContain('12');
    expect(t).toContain('incapacidades registradas');
    expect(t).toContain('Generar carpeta (ZIP)');
  }));

  it('"Semana anterior" + eje de inicio cuentan UNA vez con desde/hasta', fakeAsync(() => {
    crear();
    responderConteo(3);

    comp.aplicarSemana(-1);
    comp.form.controls.eje.setValue('INICIO');
    const anterior = semanaCartera(new Date(), -1);

    const req = responderConteo(5);
    expect(req.request.params.get('desde')).toBe(iso(anterior.inicio));
    expect(req.request.params.get('hasta')).toBe(iso(anterior.fin));
    expect(req.request.params.has('registradoDesde')).toBeFalse();
    expect(comp.atajo()).toBe('ANTERIOR');
    expect(texto()).toContain('que inician');
  }));

  it('las dos fechas son obligatorias y la inicial no puede ser posterior a la final', fakeAsync(() => {
    crear();
    responderConteo(4);

    comp.form.patchValue({ inicial: new Date(2026, 9, 10), final: new Date(2026, 9, 5) });
    tick(MS_ESPERA_CONTEO);
    http.expectNone(esConteo);
    expect(comp.problemaRango()).toContain('posterior');
    expect(comp.filtros()).toBeNull();
    expect(comp.puedeGenerar()).toBeFalse();
    expect(texto()).toContain('La fecha inicial no puede ser posterior a la final.');

    comp.form.patchValue({ inicial: null });
    tick(MS_ESPERA_CONTEO);
    http.expectNone(esConteo);
    expect(comp.problemaRango()).toBe('Elige la fecha inicial.');

    comp.generar();
    http.expectNone(`${BASE}/exports`);
  }));

  it('con 0 incapacidades en el rango no deja generar y lo dice', fakeAsync(() => {
    crear();
    responderConteo(0);

    expect(comp.puedeGenerar()).toBeFalse();
    expect(texto()).toContain('No hay nada que comprimir');
    comp.generar();
    http.expectNone(`${BASE}/exports`);
  }));

  it('si el conteo falla avisa pero deja generar la carpeta', fakeAsync(() => {
    crear();
    tick(MS_ESPERA_CONTEO);
    http.expectOne(esConteo).flush({ error: 'Servidor ocupado' }, { status: 503, statusText: 'x' });

    expect(comp.errorConteo()).toBe('Servidor ocupado');
    expect(comp.conteo()).toBeNull();
    expect(comp.puedeGenerar()).toBeTrue();
  }));

  it('genera ZIP_SEVENET, sondea con progreso y descarga sola con el nombre del servidor', fakeAsync(() => {
    crear();
    responderConteo(12);
    const semana = semanaCartera(new Date());
    const guardar = spyOn(comp, 'guardarArchivo');

    comp.generar();
    const post = http.expectOne(`${BASE}/exports`);
    expect(post.request.method).toBe('POST');
    expect(post.request.body.tipo).toBe('ZIP_SEVENET');
    expect(post.request.body.filtros).toEqual({
      registradoDesde: iso(semana.inicio),
      registradoHasta: iso(semana.fin),
    });
    post.flush(job());
    expect(comp.enCurso()).toBeTrue();
    expect(comp.puedeGenerar()).toBeFalse();

    tick(0);
    http.expectOne(`${BASE}/exports/job-7`).flush(
      job({ estado: 'EN_PROCESO', estadoEtiqueta: 'En proceso', totalRegistros: 12, procesados: 6 }),
    );
    expect(comp.fase()).toBe('progreso');
    expect(comp.progreso()).toBe(50);
    expect(texto()).toContain('6 de 12 incapacidades');

    tick(INTERVALO_SONDEO_MS);
    const nombre = `sevenet_${iso(semana.inicio)}_${iso(semana.fin)}.zip`;
    http.expectOne(`${BASE}/exports/job-7`).flush(
      job({
        estado: 'COMPLETADO',
        estadoEtiqueta: 'Completado',
        totalRegistros: 12,
        procesados: 12,
        nombreResultado: nombre,
        tamanoBytes: 2 * 1024 * 1024,
      }),
    );
    const descarga = http.expectOne(`${BASE}/exports/job-7/descargar`);
    expect(descarga.request.responseType).toBe('blob');
    descarga.flush(new Blob(['zip'], { type: 'application/zip' }));

    expect(guardar).toHaveBeenCalledOnceWith(jasmine.any(Blob), nombre);
    expect(comp.fase()).toBe('completado');
    expect(texto()).toContain('Carpeta lista');

    // El estado terminal corta el sondeo: no sale otro GET de estado.
    tick(INTERVALO_SONDEO_MS * 2);
    http.expectNone(`${BASE}/exports/job-7`);

    // "Descargar de nuevo" vuelve a bajar el blob sin sondear.
    comp.descargar();
    http.expectOne(`${BASE}/exports/job-7/descargar`).flush(new Blob(['zip']));
    expect(guardar).toHaveBeenCalledTimes(2);
    discardPeriodicTasks();
  }));

  it('si el servidor no da nombre, descarga como sevenet_{desde}_{hasta}.zip', fakeAsync(() => {
    crear();
    responderConteo(2);
    const semana = semanaCartera(new Date());
    const guardar = spyOn(comp, 'guardarArchivo');

    comp.generar();
    http.expectOne(`${BASE}/exports`).flush(job());
    tick(0);
    http.expectOne(`${BASE}/exports/job-7`).flush(job({ estado: 'COMPLETADO', estadoEtiqueta: 'Completado' }));
    http.expectOne(`${BASE}/exports/job-7/descargar`).flush(new Blob(['zip']));

    expect(guardar).toHaveBeenCalledWith(
      jasmine.any(Blob),
      `sevenet_${iso(semana.inicio)}_${iso(semana.fin)}.zip`,
    );
  }));

  it('un ERROR del trabajo muestra el motivo y permite generar de nuevo', fakeAsync(() => {
    crear();
    responderConteo(2);

    comp.generar();
    http.expectOne(`${BASE}/exports`).flush(job());
    tick(0);
    http.expectOne(`${BASE}/exports/job-7`).flush(
      job({ estado: 'ERROR', estadoEtiqueta: 'Error', mensajeError: 'Sin espacio en disco.' }),
    );

    expect(comp.fase()).toBe('error');
    expect(texto()).toContain('Sin espacio en disco.');
    expect(comp.puedeGenerar()).toBeTrue();
  }));

  it('el boton "Archivo plano para cargue" esta deshabilitado con el aviso de Angela', fakeAsync(() => {
    crear();
    responderConteo(1);
    texto();

    const botones = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ) as HTMLButtonElement[];
    const plano = botones.find((b) => (b.textContent ?? '').includes('Archivo plano para cargue'));
    expect(plano).toBeDefined();
    expect(plano?.disabled).toBeTrue();
    expect(texto()).toContain(AVISO_ARCHIVO_PLANO);
    expect(AVISO_ARCHIVO_PLANO).toBe('Pendiente: se define con Ángela (estructura del archivo árbol)');
  }));
});
