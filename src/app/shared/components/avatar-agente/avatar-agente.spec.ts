import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { AvatarAgente } from './avatar-agente';
import { AvatarAgenteService } from './avatar-agente.service';
import { ELENCO_BASE } from './elenco-base';
import { RespuestaAvatares } from './respuesta-avatares';
import { partirTramos, personajeDeModulo, personajeDeRuta, sinMarcas } from './tramos';

describe('Avatar Agent: tramos y quién atiende', () => {
  it('parte la respuesta por personaje y funde marcas seguidas', () => {
    const t = partirTramos('Van 12 contratados.\n\n[[nomina]]\nEntran en la quincena del 15.\n[[nomina]]\nY con auxilio.\n**[[contratacion]]**\nSigo yo.', 'contratacion');
    expect(t.map(x => x.clave)).toEqual(['contratacion', 'nomina', 'contratacion']);
    expect(t[1].texto).toBe('Entran en la quincena del 15.\n\nY con auxilio.');
  });

  it('sin marcas es un solo tramo del principal', () => {
    expect(partirTramos('Hola', 'tienda')).toEqual([{ clave: 'tienda', texto: 'Hola' }]);
    expect(partirTramos('', 'tienda')).toEqual([]);
  });

  it('quita las marcas para copiar o leer', () => {
    expect(sinMarcas('Uno. [[nomina]]\nDos.')).toBe('Uno. Dos.');
  });

  it('resuelve como ms-ai: módulo exacto, submódulo y presidente', () => {
    expect(personajeDeModulo(ELENCO_BASE, 'contratacion')?.clave).toBe('contratacion');
    expect(personajeDeModulo(ELENCO_BASE, 'tienda.logis')?.clave).toBe('tienda');
    expect(personajeDeModulo(ELENCO_BASE, 'economiapp')?.clave).toBe('economiapp');
    expect(personajeDeModulo(ELENCO_BASE, 'herramientas-ia.asistente')?.clave).toBe('presidente');
    expect(personajeDeModulo(ELENCO_BASE, 'cualquiera')?.clave).toBe('presidente');
  });

  it('la ruta más larga gana y la del asesor es de MatIA', () => {
    expect(personajeDeRuta(ELENCO_BASE, '/dashboard/metricas/contratacion')?.clave).toBe('contratacion');
    expect(personajeDeRuta(ELENCO_BASE, '/dashboard/metricas/otra')?.clave).toBe('reportes');
    expect(personajeDeRuta(ELENCO_BASE, '/economiapp/asesor')?.clave).toBe('economiapp');
    expect(personajeDeRuta(ELENCO_BASE, '/dashboard/tiendas-x')?.clave).toBe('presidente');
    expect(personajeDeRuta(ELENCO_BASE, '/dashboard/home')?.clave).toBe('presidente');
  });
});

describe('Avatar Agent: componentes', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });

  it('con retrato empaquetado lo pinta y marca el estado', () => {
    const f = TestBed.createComponent(AvatarAgente);
    f.componentRef.setInput('personaje', ELENCO_BASE.find(p => p.clave === 'contratacion')!);
    f.componentRef.setInput('estado', 'pensando');
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('img')?.getAttribute('src')).toBe('avatares/contratacion/retrato.webp');
    expect(el.classList).toContain('av--pensando');
    expect(el.getAttribute('aria-label')).toContain('Camila Reyes');
    expect(el.style.getPropertyValue('--av-c1')).toBe('#DB2777');
  });

  it('sin retrato muestra las iniciales', () => {
    const f = TestBed.createComponent(AvatarAgente);
    f.componentRef.setInput('personaje', { clave: 'nuevo', nombre: 'Laura Gómez', nombreCorto: 'Laura', cargo: 'Directora', rango: 'DIRECTOR' });
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('.av-iniciales')?.textContent?.trim()).toBe('LA');
  });

  it('una respuesta de dos áreas sale en dos tramos con su nombre', () => {
    const f = TestBed.createComponent(RespuestaAvatares);
    f.componentRef.setInput('contenido', 'Van 12.\n[[nomina]]\nEntran el 15.');
    f.componentRef.setInput('principal', 'contratacion');
    f.detectChanges();
    const tramos = (f.nativeElement as HTMLElement).querySelectorAll('.ra-tramo--varios');
    expect(tramos.length).toBe(2);
    expect(tramos[1].querySelector('.ra-quien b')?.textContent).toContain('Ernesto');
  });

  it('el elenco del servidor pisa al base y conserva los que no trae', () => {
    const s = TestBed.inject(AvatarAgenteService);
    s.cargar();
    const req = http.expectOne(r => r.url.endsWith('/api/v1/ai/avatar-agent/personajes'));
    req.flush([{ clave: 'presidente', nombre: 'Apolinar', nombreCorto: 'Apolinar', cargo: 'Presidente', rango: 'PRESIDENTE', assets: {} }]);
    expect(s.personaje('presidente').nombre).toBe('Apolinar');
    expect(s.personaje('nomina').nombre).toBe('Ernesto Quintero');
    expect(s.personaje('no-existe').clave).toBe('presidente');
  });

  afterEach(() => http.verify());
});
