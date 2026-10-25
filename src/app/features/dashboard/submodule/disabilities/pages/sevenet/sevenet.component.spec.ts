/**
 * Pruebas de la pantalla SEVENET (reunion 2026-10-05): rango semanal (lunes a domingo), eje de
 * fecha, conteo previo con los MISMOS filtros del trabajo, generacion del ZIP_SEVENET con
 * sondeo y descarga automatica. Fase 2 (respuesta 2026-10-07): semana SEVENET obligatoria y
 * carpeta base (recordadas en localStorage, tolerante a fallos), "Solo archivo plano" y las
 * `opciones` que viajan al trabajo.
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
import { clearLocalStorage } from '../../../../../../core/utils/safe-storage';
import { ExportJob } from '../../models/incapacidad-v2.model';
import { aIsoCorto } from '../../utils/fechas';
import { INTERVALO_SONDEO_MS } from '../consulta-incapacidades/dialogos/dialogo-export-masivo/dialogo-export-masivo.component';
import {
  CARPETA_BASE_POR_DEFECTO,
  CLAVE_MEMORIA_SEVENET,
  MS_ESPERA_CONTEO,
  MemoriaSevenet,
  SevenetComponent,
  filtrosSevenet,
  guardarMemoriaSevenet,
  leerMemoriaSevenet,
  normalizarCarpetaBase,
  problemaSemana,
  rutaImagenEjemplo,
  semanaCartera,
  semanaSugerida,
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

describe('semanaCartera (lunes a domingo: el domingo no queda fuera)', () => {
  it('un miercoles cae en la semana de su lunes al domingo', () => {
    const s = semanaCartera(new Date(2026, 9, 7)); // miercoles 7 de octubre de 2026
    expect(iso(s.inicio)).toBe('2026-10-05');
    expect(iso(s.fin)).toBe('2026-10-11');
  });

  it('el domingo pertenece a la semana que empezo el lunes anterior', () => {
    const s = semanaCartera(new Date(2026, 9, 11)); // domingo
    expect(iso(s.inicio)).toBe('2026-10-05');
    expect(iso(s.fin)).toBe('2026-10-11');
  });

  it('el lunes abre semana nueva y la semana anterior es la de 7 dias antes', () => {
    expect(iso(semanaCartera(new Date(2026, 9, 12)).inicio)).toBe('2026-10-12');
    const anterior = semanaCartera(new Date(2026, 9, 7), -1);
    expect(iso(anterior.inicio)).toBe('2026-09-28');
    expect(iso(anterior.fin)).toBe('2026-10-04');
  });

  it('cruza el cambio de ano sin desfase', () => {
    const s = semanaCartera(new Date(2027, 0, 1)); // viernes 1 de enero de 2027
    expect(iso(s.inicio)).toBe('2026-12-28');
    expect(iso(s.fin)).toBe('2027-01-03');
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

describe('semana SEVENET y carpeta base (helpers puros)', () => {
  it('la semana es obligatoria y entera de 1 a 9999', () => {
    expect(problemaSemana(null)).toBe('Escribe la semana SEVENET.');
    expect(problemaSemana(Number.NaN)).toBe('Escribe la semana SEVENET.');
    expect(problemaSemana(0)).toContain('entre 1 y 9999');
    expect(problemaSemana(1.5)).toContain('entero');
    expect(problemaSemana(10000)).toContain('entre 1 y 9999');
    expect(problemaSemana(1)).toBe('');
    expect(problemaSemana(9999)).toBe('');
  });

  it('la carpeta base por defecto es la de las plantillas de la funcional', () => {
    expect(CARPETA_BASE_POR_DEFECTO).toBe('C:\\Users\\AUXCART1\\Desktop\\SEVENET\\');
    expect(normalizarCarpetaBase('   ')).toBe(CARPETA_BASE_POR_DEFECTO);
    expect(normalizarCarpetaBase(null)).toBe(CARPETA_BASE_POR_DEFECTO);
    expect(normalizarCarpetaBase('  D:\\SEV\\ ')).toBe('D:\\SEV\\');
  });

  it('la ruta de ejemplo es carpeta base + SEMANA N GRUPO + cedula, con la barra final garantizada', () => {
    expect(rutaImagenEjemplo(CARPETA_BASE_POR_DEFECTO, 41, 'APOYO')).toBe(
      'C:\\Users\\AUXCART1\\Desktop\\SEVENET\\SEMANA 41 APOYO\\CEDULA.pdf',
    );
    expect(rutaImagenEjemplo('D:\\SEV', 7, 'ALIANZA')).toBe('D:\\SEV\\SEMANA 7 ALIANZA\\CEDULA.pdf');
    expect(rutaImagenEjemplo('', null, 'APOYO')).toBe(
      'C:\\Users\\AUXCART1\\Desktop\\SEVENET\\SEMANA N APOYO\\CEDULA.pdf',
    );
  });

  it('con las temporales unidas la ruta de ejemplo no lleva grupo (reunion 2026-10-20)', () => {
    expect(rutaImagenEjemplo('D:\\SEV', 7, null)).toBe('D:\\SEV\\SEMANA 7\\CEDULA.pdf');
  });

  it('la ruta de ejemplo normaliza las barras finales igual que ms-hr (una sola \\)', () => {
    // OpcionesSevenet.normalizar: replaceAll("[\\\\/]+$", "") + "\\".
    expect(rutaImagenEjemplo('D:\\SEV/', 7, 'APOYO')).toBe('D:\\SEV\\SEMANA 7 APOYO\\CEDULA.pdf');
    expect(rutaImagenEjemplo('D:\\SEV\\\\', 7, 'APOYO')).toBe('D:\\SEV\\SEMANA 7 APOYO\\CEDULA.pdf');
    expect(rutaImagenEjemplo('D:\\SEV\\/ ', 7, 'ALIANZA')).toBe('D:\\SEV\\SEMANA 7 ALIANZA\\CEDULA.pdf');
  });

  describe('semanaSugerida', () => {
    const memoria = (semana: number, fecha: string): MemoriaSevenet => ({
      semana,
      fecha,
      carpetaBase: CARPETA_BASE_POR_DEFECTO,
    });

    it('sin memoria no sugiere nada', () => {
      expect(semanaSugerida(null, new Date(2026, 9, 7))).toBeNull();
      expect(semanaSugerida(memoria(0, ''), new Date(2026, 9, 7))).toBeNull();
    });

    it('en la misma semana (lunes a domingo) sugiere la misma: rehacer el cargue', () => {
      expect(semanaSugerida(memoria(41, '2026-10-05'), new Date(2026, 9, 11))).toBe(41); // lunes -> domingo
    });

    it('suma las semanas transcurridas, tambien cruzando el ano', () => {
      expect(semanaSugerida(memoria(41, '2026-10-07'), new Date(2026, 9, 12))).toBe(42);
      expect(semanaSugerida(memoria(41, '2026-10-11'), new Date(2026, 9, 25))).toBe(43); // domingo a domingo
      expect(semanaSugerida(memoria(41, '2026-10-11'), new Date(2026, 9, 26))).toBe(44);
      expect(semanaSugerida(memoria(52, '2026-12-30'), new Date(2027, 0, 6))).toBe(53);
    });

    it('una fecha guardada en el futuro no resta y el tope es 9999', () => {
      expect(semanaSugerida(memoria(41, '2026-11-30'), new Date(2026, 9, 7))).toBe(41);
      expect(semanaSugerida(memoria(9999, '2026-09-28'), new Date(2026, 9, 7))).toBe(9999);
    });
  });

  describe('memoria en localStorage (tolerante a fallos)', () => {
    afterEach(() => localStorage.removeItem(CLAVE_MEMORIA_SEVENET));

    it('guarda y lee la semana, su fecha y la carpeta', () => {
      guardarMemoriaSevenet({ semana: 41, fecha: '2026-10-07', carpetaBase: 'D:\\SEV\\' });
      expect(leerMemoriaSevenet()).toEqual({ semana: 41, fecha: '2026-10-07', carpetaBase: 'D:\\SEV\\' });
    });

    it('vacia o con JSON roto da null', () => {
      localStorage.removeItem(CLAVE_MEMORIA_SEVENET);
      expect(leerMemoriaSevenet()).toBeNull();
      localStorage.setItem(CLAVE_MEMORIA_SEVENET, '{no es json');
      expect(leerMemoriaSevenet()).toBeNull();
      localStorage.setItem(CLAVE_MEMORIA_SEVENET, 'null');
      expect(leerMemoriaSevenet()).toBeNull();
    });

    it('descarta los campos malos: semana fuera de rango o sin fecha, carpeta vacia o larga', () => {
      localStorage.setItem(
        CLAVE_MEMORIA_SEVENET,
        JSON.stringify({ semana: 0, fecha: '2026-10-07', carpetaBase: 'D:\\SEV\\' }),
      );
      expect(leerMemoriaSevenet()).toEqual({ semana: 0, fecha: '', carpetaBase: 'D:\\SEV\\' });

      localStorage.setItem(
        CLAVE_MEMORIA_SEVENET,
        JSON.stringify({ semana: 41, fecha: '07/10/2026', carpetaBase: 'x'.repeat(201) }),
      );
      expect(leerMemoriaSevenet()).toEqual({ semana: 0, fecha: '', carpetaBase: CARPETA_BASE_POR_DEFECTO });
    });

    it('sobrevive al cierre de sesion (clearLocalStorage conserva la clave)', () => {
      // clearLocalStorage vacia TODO el localStorage: se guarda y se repone lo del navegador de pruebas.
      const previo = Object.keys(localStorage).map((k) => [k, localStorage.getItem(k) ?? ''] as const);
      try {
        guardarMemoriaSevenet({ semana: 41, fecha: '2026-10-07', carpetaBase: 'D:\\SEV\\' });
        localStorage.setItem('token', 'Bearer x');
        clearLocalStorage();
        expect(localStorage.getItem('token')).toBeNull();
        expect(leerMemoriaSevenet()).toEqual({ semana: 41, fecha: '2026-10-07', carpetaBase: 'D:\\SEV\\' });
      } finally {
        localStorage.removeItem('token');
        for (const [k, v] of previo) localStorage.setItem(k, v);
      }
    });

    it('si el navegador bloquea el almacenamiento no revienta', () => {
      spyOn(Storage.prototype, 'getItem').and.throwError('bloqueado');
      spyOn(Storage.prototype, 'setItem').and.throwError('QuotaExceededError');
      expect(leerMemoriaSevenet()).toBeNull();
      expect(() =>
        guardarMemoriaSevenet({ semana: 41, fecha: '2026-10-07', carpetaBase: CARPETA_BASE_POR_DEFECTO }),
      ).not.toThrow();
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

  /** La semana SEVENET es obligatoria para generar. */
  function conSemana(semana = 41): void {
    comp.cargue.controls.semana.setValue(semana);
  }

  function boton(textoBoton: string): HTMLButtonElement | undefined {
    fixture.detectChanges();
    const botones = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ) as HTMLButtonElement[];
    return botones.find((b) => (b.textContent ?? '').includes(textoBoton));
  }

  beforeEach(async () => {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    localStorage.removeItem(CLAVE_MEMORIA_SEVENET);
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
    localStorage.removeItem(CLAVE_MEMORIA_SEVENET);
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
    expect(t).toContain('Generar carpeta y archivo plano (ZIP)');
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
    conSemana();
    tick(MS_ESPERA_CONTEO);
    http.expectOne(esConteo).flush({ error: 'Servidor ocupado' }, { status: 503, statusText: 'x' });

    expect(comp.errorConteo()).toBe('Servidor ocupado');
    expect(comp.conteo()).toBeNull();
    expect(comp.puedeGenerar()).toBeTrue();
  }));

  it('genera ZIP_SEVENET, sondea con progreso y descarga sola con el nombre del servidor', fakeAsync(() => {
    crear();
    responderConteo(12);
    conSemana(41);
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
    expect(post.request.body.opciones).toEqual({
      semanaSevenet: 41,
      carpetaBase: CARPETA_BASE_POR_DEFECTO,
      soloPlano: false,
      unirTemporales: true,
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
    const nombre = `sevenet_semana41_${iso(semana.inicio)}_${iso(semana.fin)}.zip`;
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

  it('si el servidor no da nombre, descarga como sevenet_semana{N}_{desde}_{hasta}.zip', fakeAsync(() => {
    crear();
    responderConteo(2);
    conSemana(7);
    const semana = semanaCartera(new Date());
    const guardar = spyOn(comp, 'guardarArchivo');

    comp.generar();
    http.expectOne(`${BASE}/exports`).flush(job());
    tick(0);
    http.expectOne(`${BASE}/exports/job-7`).flush(job({ estado: 'COMPLETADO', estadoEtiqueta: 'Completado' }));
    http.expectOne(`${BASE}/exports/job-7/descargar`).flush(new Blob(['zip']));

    expect(guardar).toHaveBeenCalledWith(
      jasmine.any(Blob),
      `sevenet_semana7_${iso(semana.inicio)}_${iso(semana.fin)}.zip`,
    );
  }));

  it('un ERROR del trabajo muestra el motivo y permite generar de nuevo', fakeAsync(() => {
    crear();
    responderConteo(2);
    conSemana();

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

  it('sin semana SEVENET no deja generar y lo dice; con ella se habilitan los dos botones', fakeAsync(() => {
    crear();
    responderConteo(3);

    expect(comp.semana()).toBeNull();
    expect(comp.problemaCargue()).toBe('Escribe la semana SEVENET.');
    expect(comp.puedeGenerar()).toBeFalse();
    expect(texto()).toContain('Escribe la semana SEVENET.');
    expect(boton('Generar carpeta y archivo plano (ZIP)')?.disabled).toBeTrue();
    expect(boton('Solo archivo plano')?.disabled).toBeTrue();
    comp.generar();
    comp.generar(true);
    http.expectNone(`${BASE}/exports`);

    conSemana(41);
    expect(comp.puedeGenerar()).toBeTrue();
    expect(boton('Generar carpeta y archivo plano (ZIP)')?.disabled).toBeFalse();
    expect(boton('Solo archivo plano')?.disabled).toBeFalse();
    // Ya no hay aviso de "pendiente con Angela".
    expect(texto()).not.toContain('Pendiente: se define con Ángela');
    expect(texto()).toContain('Descomprime el ZIP dentro de la carpeta base');
    expect(texto()).toContain('SEMANA 41 APOYO');
  }));

  it('una carpeta base de mas de 200 caracteres bloquea; vacia se manda la de las plantillas', fakeAsync(() => {
    crear();
    responderConteo(3);
    conSemana(41);

    comp.cargue.controls.carpetaBase.setValue('C:\\' + 'x'.repeat(200));
    expect(comp.problemaCargue()).toContain('200 caracteres');
    expect(comp.puedeGenerar()).toBeFalse();

    comp.cargue.controls.carpetaBase.setValue('   ');
    expect(comp.carpetaBase()).toBe(CARPETA_BASE_POR_DEFECTO);
    comp.generar();
    const post = http.expectOne(`${BASE}/exports`);
    expect(post.request.body.opciones.carpetaBase).toBe(CARPETA_BASE_POR_DEFECTO);
    post.flush(job());
    tick(0);
    http.expectOne(`${BASE}/exports/job-7`).flush(job({ estado: 'ERROR', estadoEtiqueta: 'Error' }));
  }));

  it('la ayuda de la semana (dos lineas) agranda el campo en vez de montarse sobre la ruta', fakeAsync(() => {
    crear();
    responderConteo(1);
    texto();
    const campo = (fixture.nativeElement as HTMLElement).querySelector('.sev-campo-semana');
    expect(campo?.querySelector('.mat-mdc-form-field-subscript-dynamic-size')).not.toBeNull();
  }));

  it('"Volver a la carpeta por defecto" restablece la de las plantillas', fakeAsync(() => {
    crear();
    responderConteo(1);
    comp.cargue.controls.carpetaBase.setValue('D:\\OTRA\\');
    // Reunion 2026-10-20: por defecto Apoyo y Alianza van unidas (SEMANA N, sin grupo).
    expect(comp.rutaEjemplo()).toBe('D:\\OTRA\\SEMANA N\\CEDULA.pdf');

    comp.restablecerCarpeta();
    expect(comp.cargue.controls.carpetaBase.value).toBe(CARPETA_BASE_POR_DEFECTO);
  }));

  it('arranca con la semana sugerida y la carpeta recordadas', fakeAsync(() => {
    const haceUnaSemana = new Date();
    haceUnaSemana.setDate(haceUnaSemana.getDate() - 7);
    localStorage.setItem(
      CLAVE_MEMORIA_SEVENET,
      JSON.stringify({ semana: 40, fecha: iso(haceUnaSemana), carpetaBase: 'D:\\SEVENET\\' }),
    );
    crear();
    responderConteo(5);

    expect(comp.semana()).toBe(41);
    expect(comp.cargue.controls.carpetaBase.value).toBe('D:\\SEVENET\\');
    expect(comp.puedeGenerar()).toBeTrue();
    expect(texto()).toContain('Sugerida a partir de la 40');
    expect(comp.rutaEjemplo()).toBe('D:\\SEVENET\\SEMANA 41\\CEDULA.pdf');
  }));

  it('con "Unir Apoyo y Alianza" apagado separa las carpetas como antes y lo recuerda', fakeAsync(() => {
    crear();
    responderConteo(3);
    conSemana(43);
    expect(comp.unirTemporales()).toBeTrue();
    comp.unirTemporales.set(false);
    expect(comp.rutaEjemplo()).toContain('SEMANA 43 APOYO\\CEDULA.pdf');

    comp.generar();
    const post = http.expectOne(`${BASE}/exports`);
    expect(post.request.body.opciones.unirTemporales).toBeFalse();
    expect(leerMemoriaSevenet()?.unirTemporales).toBeFalse();
    post.flush(job());
    tick(0);
    // Un estado final corta el sondeo: no quedan peticiones abiertas.
    http.expectOne(`${BASE}/exports/job-7`).flush(
      job({ estado: 'ERROR', estadoEtiqueta: 'Error', mensajeError: 'prueba' }),
    );
    discardPeriodicTasks();
  }));

  it('"Solo archivo plano" manda soloPlano, recuerda semana y carpeta y lo dice al armar', fakeAsync(() => {
    crear();
    responderConteo(4);
    conSemana(42);
    comp.cargue.controls.carpetaBase.setValue('D:\\SEV\\');

    comp.generar(true);
    const post = http.expectOne(`${BASE}/exports`);
    expect(post.request.body.tipo).toBe('ZIP_SEVENET');
    expect(post.request.body.opciones).toEqual({
      semanaSevenet: 42,
      carpetaBase: 'D:\\SEV\\',
      soloPlano: true,
      unirTemporales: true,
    });
    expect(leerMemoriaSevenet()).toEqual({
      semana: 42,
      fecha: iso(new Date()),
      carpetaBase: 'D:\\SEV\\',
      unirTemporales: true,
    });
    post.flush(job());

    tick(0);
    http.expectOne(`${BASE}/exports/job-7`).flush(job({ estado: 'EN_PROCESO', estadoEtiqueta: 'En proceso' }));
    expect(comp.soloPlanoGenerado()).toBeTrue();
    const t = texto();
    expect(t).toContain('Armando el archivo plano');
    expect(t).toContain('Semana 42 (solo archivo plano)');
    expect(boton('Solo archivo plano')).toBeUndefined(); // el boton dice "Generando…"

    tick(INTERVALO_SONDEO_MS);
    http.expectOne(`${BASE}/exports/job-7`).flush(
      job({ estado: 'ERROR', estadoEtiqueta: 'Error', mensajeError: 'Sin espacio en disco.' }),
    );
    expect(texto()).toContain('No se pudo armar el archivo plano.');
  }));
});
