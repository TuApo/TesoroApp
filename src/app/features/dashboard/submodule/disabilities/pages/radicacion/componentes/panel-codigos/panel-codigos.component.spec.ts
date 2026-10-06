import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { environment } from '@/environments/environment';
import type { ResultadoAsignacionRadicado, ResultadoBusquedaCodigos } from '../../../../models/incapacidad-salud.model';
import { encontradoPrueba, refPrueba, resultadoPrueba, swalEspiable } from '../../radicacion.datos-prueba';
import type { DatosRadicado } from '../../radicacion.utils';
import { PanelCodigosComponent } from './panel-codigos.component';

const BASE = `${environment.apiUrl}/Incapacidades/v2`;

const DATOS: DatosRadicado = {
  numeroRadicado: 'RAD-2026-77',
  fechaRadicado: '2026-10-05',
  dondeRadicado: 'PAGINA',
  observaciones: null,
};

/** Respuesta tipica de la busqueda colectiva: lista, ya radicada, no radicable y ambigua. */
const BUSQUEDA: ResultadoBusquedaCodigos = {
  encontrados: [
    encontradoPrueba({ codigo: 'TASB018' }, { id: 1 }),
    encontradoPrueba(
      { codigo: '200', yaRadicada: true },
      { id: 2, codigoOficina: 'TASB019', codigoUnico: '200', numeroRadicado: 'VIEJO-1', estado: 'RADICADA' },
    ),
    encontradoPrueba(
      { codigo: '300', puedeRadicar: false, motivo: 'Debe validarse antes de radicar' },
      { id: 3, codigoOficina: null, codigoUnico: '300', estado: 'RECIBIDA' },
    ),
    encontradoPrueba({ codigo: '400', ambiguo: true }, { id: 4, codigoOficina: null, codigoUnico: '400' }),
    encontradoPrueba({ codigo: '400', ambiguo: true }, { id: 5, codigoOficina: null, codigoUnico: '400-2' }),
  ],
  noEncontrados: ['999', '888'],
};

describe('PanelCodigosComponent', () => {
  let fixture: ComponentFixture<PanelCodigosComponent>;
  let componente: PanelCodigosComponent;
  let httpMock: HttpTestingController;
  let guardados: ResultadoAsignacionRadicado[];

  beforeEach(async () => {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    await TestBed.configureTestingModule({
      imports: [PanelCodigosComponent],
      providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(PanelCodigosComponent);
    componente = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    guardados = [];
    componente.guardado.subscribe((r) => guardados.push(r));
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
    fixture.destroy();
  });

  /** Atiende la busqueda pendiente y devuelve su cuerpo. */
  const responderBusqueda = (r: ResultadoBusquedaCodigos = BUSQUEDA): { codigos: string[]; modo: string } => {
    const req = httpMock.expectOne(`${BASE}/radicacion/buscar`);
    expect(req.request.method).toBe('POST');
    const cuerpo = req.request.body as { codigos: string[]; modo: string };
    req.flush(r);
    return cuerpo;
  };

  describe('busqueda', () => {
    it('un codigo con Enter/Agregar busca en modo RADICACION y limpia el campo', () => {
      componente.codigo.set(' tasb018 ');
      componente.agregarCodigo();
      const cuerpo = responderBusqueda({ encontrados: [BUSQUEDA.encontrados[0]], noEncontrados: [] });
      expect(cuerpo).toEqual({ codigos: ['TASB018'], modo: 'RADICACION' });
      expect(componente.codigo()).toBe('');
      expect(componente.encontrados().length).toBe(1);
    });

    it('la busqueda colectiva manda todos los codigos pegados en una sola peticion', () => {
      componente.alternarPegar();
      componente.textoPegado.set('TASB018\n200\t300, 400\n999\n888\nTASB018');
      expect(componente.codigosPegados().length).toBe(6);
      componente.buscarPegados();
      const cuerpo = responderBusqueda();
      expect(cuerpo.codigos).toEqual(['TASB018', '200', '300', '400', '999', '888']);
      expect(componente.pegarAbierto()).toBeFalse();
      expect(componente.textoPegado()).toBe('');
    });

    it('marca por defecto solo las que se pueden radicar y no son ambiguas', () => {
      componente.textoPegado.set('x y');
      componente.buscarPegados();
      responderBusqueda();
      expect(componente.encontrados().length).toBe(5);
      expect([...componente.marcados()].sort()).toEqual([1, 2]);
      expect(componente.cantidadMarcadas()).toBe(2);
      expect(componente.noSePueden()).toBe(1);
      expect(componente.ambiguas()).toBe(2);
      // La ya radicada marcada es una correccion.
      expect(componente.correcciones().map((e) => e.incapacidad.id)).toEqual([2]);
    });

    it('cada fila dice por que no se puede, si es correccion o si es ambigua', () => {
      componente.textoPegado.set('x y');
      componente.buscarPegados();
      responderBusqueda();
      const [lista, corregir, bloqueada, ambigua] = componente.encontrados();
      expect(componente.avisoDe(lista).tono).toBe('ok');
      expect(componente.avisoDe(corregir).texto).toContain('VIEJO-1');
      expect(componente.avisoDe(corregir).texto).toContain('corrección');
      expect(componente.avisoDe(bloqueada)).toEqual(jasmine.objectContaining({ tono: 'peligro', texto: 'Debe validarse antes de radicar' }));
      expect(componente.avisoDe(ambigua).tono).toBe('aviso');
    });

    it('no deja marcar una que no se puede radicar; las ambiguas se marcan a mano', () => {
      componente.textoPegado.set('x y');
      componente.buscarPegados();
      responderBusqueda();
      const [, , bloqueada, ambigua] = componente.encontrados();
      componente.alternar(bloqueada, true);
      componente.alternar(ambigua, true);
      expect(componente.marcados().has(3)).toBeFalse();
      expect(componente.marcados().has(4)).toBeTrue();
      componente.desmarcarTodas();
      expect(componente.cantidadMarcadas()).toBe(0);
      componente.marcarListas();
      expect([...componente.marcados()].sort()).toEqual([1, 2]);
    });

    it('lista los no encontrados y deja quitarlos uno a uno o todos', () => {
      componente.textoPegado.set('x y');
      componente.buscarPegados();
      responderBusqueda();
      expect(componente.noEncontrados()).toEqual(['999', '888']);
      componente.quitarNoEncontrado('999');
      expect(componente.noEncontrados()).toEqual(['888']);
      componente.quitarNoEncontrados();
      expect(componente.noEncontrados()).toEqual([]);
    });

    it('buscar otra vez suma a la lista sin duplicar y saca de no encontrados lo que aparecio', () => {
      componente.codigo.set('TASB018 999');
      componente.agregarCodigo();
      responderBusqueda({ encontrados: [BUSQUEDA.encontrados[0]], noEncontrados: ['999'] });
      componente.codigo.set('TASB018 999');
      componente.agregarCodigo();
      responderBusqueda({
        encontrados: [BUSQUEDA.encontrados[0], encontradoPrueba({ codigo: '999' }, { id: 9, codigoUnico: '999' })],
        noEncontrados: [],
      });
      expect(componente.encontrados().map((e) => e.incapacidad.id)).toEqual([1, 9]);
      expect(componente.noEncontrados()).toEqual([]);
    });

    it('mas de 500 codigos no se mandan: se pide partir la busqueda', () => {
      componente.textoPegado.set(Array.from({ length: 501 }, (_, i) => `C${i}`).join('\n'));
      componente.buscarPegados();
      httpMock.expectNone(`${BASE}/radicacion/buscar`);
      expect(componente.errorBusqueda()).toContain('máximo 500');
    });

    it('un error del servidor se muestra sin romper la lista', () => {
      componente.codigo.set('TASB018');
      componente.agregarCodigo();
      httpMock.expectOne(`${BASE}/radicacion/buscar`).flush({ error: 'Codigos invalidos' }, { status: 400, statusText: 'Bad Request' });
      expect(componente.errorBusqueda()).toBe('Codigos invalidos');
      expect(componente.buscando()).toBeFalse();
    });

    it('pegar una lista en el campo simple la pasa al cuadro de pegar varios', () => {
      const datos = new DataTransfer();
      datos.setData('text', '111\n222');
      const evento = new ClipboardEvent('paste', { clipboardData: datos, cancelable: true });
      componente.alPegarEnCampo(evento);
      expect(componente.pegarAbierto()).toBeTrue();
      expect(componente.textoPegado()).toBe('111\n222');
      expect(evento.defaultPrevented).toBeTrue();
    });
  });

  describe('desde pendientes por radicar', () => {
    it('agregarIncapacidades re-consulta y deja solo las elegidas, sin marca de ambiguedad', () => {
      const elegida = refPrueba({ id: 4, codigoOficina: null, codigoUnico: '400' });
      componente.agregarIncapacidades([elegida]);
      const cuerpo = responderBusqueda({
        // El codigo base trae tambien a su hermana -2, que el usuario NO eligio.
        encontrados: [BUSQUEDA.encontrados[3], BUSQUEDA.encontrados[4]],
        noEncontrados: [],
      });
      expect(cuerpo.codigos).toEqual(['400']);
      expect(componente.encontrados().map((e) => e.incapacidad.id)).toEqual([4]);
      expect(componente.encontrados()[0].ambiguo).toBeFalse();
      expect(componente.marcados().has(4)).toBeTrue();
    });

    it('si una elegida ya no aparece, su codigo queda en no encontrados', () => {
      componente.agregarIncapacidades([refPrueba({ id: 7, codigoOficina: 'TASB099', codigoUnico: '700' })]);
      responderBusqueda({ encontrados: [], noEncontrados: ['700'] });
      expect(componente.encontrados().length).toBe(0);
      expect(componente.noEncontrados()).toEqual(['TASB099']);
    });
  });

  describe('asignacion colectiva', () => {
    beforeEach(() => {
      componente.textoPegado.set('x y');
      componente.buscarPegados();
      responderBusqueda();
    });

    it('confirma advirtiendo la correccion y asigna el mismo radicado a todas las marcadas', async () => {
      const fire = spyOn(swalEspiable(), 'fire').and.returnValue(Promise.resolve({ isConfirmed: true }));
      await componente.guardar(DATOS);

      const opciones = fire.calls.mostRecent().args[0] as { html: string };
      expect(opciones.html).toContain('ya tenía radicado');
      expect(opciones.html).toContain('TASB019');

      const req = httpMock.expectOne(`${BASE}/radicacion/asignar`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(
        jasmine.objectContaining({
          incapacidadIds: [1, 2],
          numeroRadicado: 'RAD-2026-77',
          fechaRadicado: '2026-10-05',
          dondeRadicado: 'PAGINA',
          observaciones: null,
        }),
      );
      req.flush(resultadoPrueba([{ id: 1, ok: true }, { id: 2, ok: false, mensaje: 'Estado no permite radicar' }]));

      // La guardada sale de la lista; la fallida se queda marcada y con su motivo.
      expect(componente.encontrados().map((e) => e.incapacidad.id)).toEqual([2, 3, 4, 5]);
      expect(componente.marcados().has(2)).toBeTrue();
      expect(componente.avisoDe(componente.encontrados()[0]).texto).toBe('No se guardó: Estado no permite radicar');
      expect(componente.resultado()?.exitosos).toBe(1);
      expect(guardados.length).toBe(1);
    });

    it('si el usuario cancela no se escribe nada', async () => {
      spyOn(swalEspiable(), 'fire').and.returnValue(Promise.resolve({ isConfirmed: false }));
      await componente.guardar(DATOS);
      httpMock.expectNone(`${BASE}/radicacion/asignar`);
      expect(componente.encontrados().length).toBe(5);
    });

    it('sin marcadas no confirma ni llama al backend', async () => {
      const fire = spyOn(swalEspiable(), 'fire');
      componente.desmarcarTodas();
      await componente.guardar(DATOS);
      expect(fire).not.toHaveBeenCalled();
      httpMock.expectNone(`${BASE}/radicacion/asignar`);
    });

    it('si todas fallan no avisa a la pantalla (nada que recargar)', async () => {
      spyOn(swalEspiable(), 'fire').and.returnValue(Promise.resolve({ isConfirmed: true }));
      await componente.guardar(DATOS);
      httpMock.expectOne(`${BASE}/radicacion/asignar`).flush(resultadoPrueba([{ id: 1, ok: false }, { id: 2, ok: false }]));
      expect(guardados.length).toBe(0);
      expect(componente.encontrados().length).toBe(5);
    });

    it('un error HTTP se informa con Swal y no pierde la lista', async () => {
      const fire = spyOn(swalEspiable(), 'fire').and.returnValue(Promise.resolve({ isConfirmed: true }));
      await componente.guardar(DATOS);
      httpMock.expectOne(`${BASE}/radicacion/asignar`).flush({ error: 'Radicado invalido' }, { status: 400, statusText: 'Bad Request' });
      const ultimo = fire.calls.mostRecent().args[0] as { icon: string; text: string };
      expect(ultimo.icon).toBe('error');
      expect(ultimo.text).toBe('Radicado invalido');
      expect(componente.encontrados().length).toBe(5);
      expect(componente.guardando()).toBeFalse();
    });

    it('vaciar una lista larga pide confirmacion y luego quita todo', async () => {
      const fire = spyOn(swalEspiable(), 'fire').and.returnValues(
        Promise.resolve({ isConfirmed: false }),
        Promise.resolve({ isConfirmed: true }),
      );
      await componente.vaciarLista();
      expect(componente.encontrados().length).toBe(5);
      await componente.vaciarLista();
      expect(fire).toHaveBeenCalledTimes(2);
      expect(componente.encontrados().length).toBe(0);
      expect(componente.cantidadMarcadas()).toBe(0);
      expect(componente.noEncontrados().length).toBe(0);
    });
  });

  describe('modo RECOBRO', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('modo', 'RECOBRO');
      fixture.detectChanges();
    });

    it('busca en modo RECOBRO y registra en /recobros sin hablar de correcciones', async () => {
      componente.codigo.set('TASB019');
      componente.agregarCodigo();
      const cuerpo = responderBusqueda({ encontrados: [BUSQUEDA.encontrados[1]], noEncontrados: [] });
      expect(cuerpo.modo).toBe('RECOBRO');
      expect(componente.correcciones().length).toBe(0);

      const fire = spyOn(swalEspiable(), 'fire').and.returnValue(Promise.resolve({ isConfirmed: true }));
      await componente.guardar({ ...DATOS, dondeRadicado: 'CORREO', observaciones: 'PQR' });
      expect((fire.calls.mostRecent().args[0] as { title: string }).title).toBe('¿Registrar el recobro?');

      const req = httpMock.expectOne(`${BASE}/recobros`);
      expect(req.request.body).toEqual(
        jasmine.objectContaining({ incapacidadIds: [2], dondeRadicado: 'CORREO', observaciones: 'PQR' }),
      );
      req.flush(resultadoPrueba([{ id: 2, ok: true }]));
      httpMock.expectNone(`${BASE}/radicacion/asignar`);
      expect(componente.encontrados().length).toBe(0);
      expect(guardados.length).toBe(1);
    });
  });
});
