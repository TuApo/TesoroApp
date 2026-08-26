import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { EditorComponent } from './editor.component';
import { FilaMapeoGuardar } from '../../models/plantillas.models';

/**
 * Guardar el mapeo desde el editor NO puede perder lo que el editor no toca.
 *
 * Pasó de verdad: `guardar()` armaba cada fila desde cero con los seis campos
 * que se editan en pantalla, así que al pulsar «Guardar mapeo» se borraron las
 * OCHO casillas excluyentes de la Ficha Técnica —las seis del estado civil y el
 * par diestro/zurdo—. El documento pasó a marcarlas TODAS. No falló nada: se
 * vio mirando la vista del formato.
 */
describe('EditorComponent · guardar el mapeo', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [EditorComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), provideNoopAnimations()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify({ ignoreCancelled: true }));

  /** Monta el componente con un estado mínimo, sin pasar por la carga real. */
  function editorCon(filas: unknown[]): EditorComponent {
    const fixture = TestBed.createComponent(EditorComponent);
    const c = fixture.componentInstance as unknown as Record<string, any>;
    c['versiones'].set([{ id: 7, plantilla_id: 1, numero: 1, estado: 'BORRADOR' }]);
    c['filas'].set(filas);
    return fixture.componentInstance;
  }

  function filaBase(extra: Record<string, unknown> = {}) {
    return {
      id: 'pdf:Soltero', campoPdf: 'Soltero', placeholder: null, libre: false,
      tipoPdf: 'TEXTO', pagina: 1, esperaImagen: false,
      x: 10, y: 20, ancho: 30, alto: 8, movido: false, fontSize: null,
      campoClave: 'candidato.estado_civil', indice: null, obligatorio: false,
      sugerido: false, confianza: 0, crudo: null,
      ...extra,
    };
  }

  it('conserva la condición de una casilla excluyente', () => {
    const editor = editorCon([filaBase({
      crudo: {
        campo_pdf: 'Soltero', campo_clave: 'candidato.estado_civil',
        valor_condicion: 'SOLTERO', tipo_render: 'CHECK', formato: null,
        indice: null, placeholder: null, valor_literal: null,
        pagina: 1, obligatorio: false, orden: 0, activo: true,
      },
    })]);

    editor.guardar();
    const req = http.expectOne(r => r.method === 'PUT' && r.url.includes('/version/7/mapeo'));
    const enviado = req.request.body as FilaMapeoGuardar[];

    expect(enviado.length).toBe(1);
    expect(enviado[0].valor_condicion)
      .withContext('sin la condición, el documento marcaría TODAS las casillas del grupo')
      .toBe('SOLTERO');
    req.flush({ version_id: 7, campos_guardados: 1 });
  });

  it('no manda la posición de una casilla que nadie movió', () => {
    const editor = editorCon([filaBase()]);
    editor.guardar();
    const req = http.expectOne(r => r.method === 'PUT' && r.url.includes('/version/7/mapeo'));
    const enviado = req.request.body as FilaMapeoGuardar[];

    // Mandarla obligaría al motor a recolocar las 243 casillas para dejarlas
    // donde ya estaban, y el redondeo se acumularía en cada guardado.
    expect(enviado[0].pos_x).toBeUndefined();
    req.flush({ version_id: 7, campos_guardados: 1 });
  });

  it('manda la posición y el nombre de una casilla dibujada a mano', () => {
    const editor = editorCon([filaBase({
      id: 'libre:Nota', campoPdf: '', placeholder: 'Nota', libre: true,
      movido: true, fontSize: 9, campoClave: 'evaluacion.observaciones',
    })]);
    editor.guardar();
    const req = http.expectOne(r => r.method === 'PUT' && r.url.includes('/version/7/mapeo'));
    const enviado = req.request.body as FilaMapeoGuardar[];

    expect(enviado[0].campo_pdf).toBeNull();
    expect(enviado[0].placeholder).toBe('Nota');
    expect(enviado[0].pos_x).toBe(10);
    expect(enviado[0].font_size).toBe(9);
    req.flush({ version_id: 7, campos_guardados: 1 });
  });
});
