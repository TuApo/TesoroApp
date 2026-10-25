import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { environment } from '@/environments/environment';

import { TarjetasPanelComponent } from './tarjetas-panel.component';

const BASE = `${environment.apiUrl}/tarjetas`;

const PAGINA = {
  content: [
    { id: 1, identification_number: '9000000874', card_number: '5555555555554444',
      created_at: '2026-09-20T10:00:00Z', origen: 'IMPORTACION', import_batch_id: 7,
      imported_by: 'heidy@tuapo.co' },
  ],
  total_elements: 55588,
  total_pages: 1112,
  page: 0,
  size: 50,
};

describe('TarjetasPanelComponent', () => {
  let fixture: ComponentFixture<TarjetasPanelComponent>;
  let componente: TarjetasPanelComponent;
  let http: HttpTestingController;

  /** La primera consulta la lanza el constructor. */
  function responderCargaInicial() {
    const p = http.expectOne((r) => r.url === `${BASE}/consulta`);
    p.flush(PAGINA);
    return p;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TarjetasPanelComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TarjetasPanelComponent);
    componente = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('consulta paginando en el servidor, no descargando las 55.000 filas', () => {
    const peticion = responderCargaInicial();

    expect(peticion.request.params.get('page')).toBe('0');
    expect(peticion.request.params.get('size')).toBe('50');
    expect(componente.total()).toBe(55588);
    expect(componente.data().length).toBe(1);
  });

  it('la tabla declara la columna «actions», que es la que la tabla estándar reconoce', () => {
    responderCargaInicial();
    // Si esta columna se renombra, los botones de editar y eliminar desaparecen sin avisar.
    expect(componente.columns.some((c) => c.name === 'actions')).toBeTrue();
  });

  it('la búsqueda se resuelve contra el backend y vuelve a la primera página', () => {
    responderCargaInicial();
    componente.pagina.set(4);

    componente.alBuscar('5116');

    const peticion = http.expectOne((r) => r.url === `${BASE}/consulta` && r.params.get('search') === '5116');
    expect(peticion.request.params.get('page')).toBe('0');
    peticion.flush(PAGINA);
  });

  it('el orden lo aplica el servidor con el nombre de campo que él entiende', () => {
    responderCargaInicial();

    componente.alOrdenar({ active: 'card_number', direction: 'asc' });

    const peticion = http.expectOne((r) => r.url === `${BASE}/consulta` && r.params.get('sort') === 'cardNumber');
    expect(peticion.request.params.get('direction')).toBe('asc');
    peticion.flush(PAGINA);
  });

  it('exportar manda los filtros actuales, no la página visible', () => {
    responderCargaInicial();
    componente.busqueda.set('5116');
    componente.origen.set('IMPORTACION');

    componente.exportarExcel();

    const peticion = http.expectOne((r) => r.url === `${BASE}/export.xlsx`);
    expect(peticion.request.params.get('search')).toBe('5116');
    expect(peticion.request.params.get('origen')).toBe('IMPORTACION');
    // No viaja ni la página ni el tamaño: el Excel es del filtro completo.
    expect(peticion.request.params.get('page')).toBeNull();
    peticion.flush(new Blob(['x']));
  });

  it('filtrar por lote deja ver exactamente lo que entró en una carga', () => {
    responderCargaInicial();

    componente.verLote(7);

    const peticion = http.expectOne((r) => r.url === `${BASE}/consulta` && r.params.get('lote_id') === '7');
    peticion.flush(PAGINA);
  });

  it('limpiar filtros vuelve a consultar sin ninguno', () => {
    responderCargaInicial();
    componente.busqueda.set('5116');
    componente.origen.set('MANUAL');

    componente.limpiarFiltros();

    const peticion = http.expectOne((r) => r.url === `${BASE}/consulta`);
    expect(peticion.request.params.get('search')).toBeNull();
    expect(peticion.request.params.get('origen')).toBeNull();
    peticion.flush(PAGINA);
  });
});
