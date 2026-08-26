import { TestBed } from '@angular/core/testing';

import { SedeScopeService } from './sede-scope.service';
import { UtilityServiceService } from '../utilityService/utility-service.service';

/**
 * Reglas del alcance por sede (V62) de las que dependen los filtros de los tableros:
 *  - ADMIN/GERENCIA no se recortan: ven todas las oficinas;
 *  - con varias sedes se abre el selector y solo se ofrecen las suyas;
 *  - con una sola sede el comportamiento es el de siempre (filtro anclado);
 *  - la comparación ignora tildes y guiones bajos (FONTIBÓN vs FONTIBON, MONTE_VERDE
 *    vs "MONTE VERDE"), que es como difieren los nombres entre catálogos.
 */
describe('SedeScopeService', () => {
  let usuario: any;

  function crear(): SedeScopeService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        SedeScopeService,
        { provide: UtilityServiceService, useValue: { getUser: () => usuario } },
      ],
    });
    return TestBed.inject(SedeScopeService);
  }

  const sede = (nombre: string, principal = false, temporal = false) => ({
    id: nombre.toLowerCase(), nombre, activa: true,
    es_principal: principal, temporal, vigente_hasta: temporal ? '2999-01-01T00:00:00Z' : null,
  });

  it('no recorta a ADMIN aunque solo tenga una sede', () => {
    usuario = { rol: { nombre: 'ADMIN' }, sede: sede('FUNZA', true), sedes: [sede('FUNZA', true)] };
    const s = crear();

    expect(s.sinLimite()).toBeTrue();
    expect(s.alcanza('BOSA')).toBeTrue();
    expect(s.opciones(['BOSA', 'FUNZA', 'MADRID'])).toEqual(['BOSA', 'FUNZA', 'MADRID']);
    expect(s.puedeElegirOficina()).toBeTrue();
  });

  it('recorta a un rol común a sus sedes asignadas', () => {
    usuario = {
      rol: { nombre: 'COORDINADOR' },
      sede: sede('FUNZA', true),
      sedes: [sede('FUNZA', true), sede('MADRID', false, true)],
    };
    const s = crear();

    expect(s.sinLimite()).toBeFalse();
    expect(s.tieneVarias()).toBeTrue();
    expect(s.puedeElegirOficina()).toBeTrue();
    expect(s.activa()).toBe('FUNZA');
    expect(s.nombres()).toEqual(['FUNZA', 'MADRID']);
    expect(s.alcanza('MADRID')).toBeTrue();
    expect(s.alcanza('BOSA')).toBeFalse();
    expect(s.opciones(['BOSA', 'FUNZA', 'MADRID'])).toEqual(['FUNZA', 'MADRID']);
  });

  it('con una sola sede no abre el selector', () => {
    usuario = { rol: { nombre: 'COORDINADOR' }, sede: sede('BOSA', true), sedes: [sede('BOSA', true)] };
    const s = crear();

    expect(s.tieneVarias()).toBeFalse();
    expect(s.puedeElegirOficina()).toBeFalse();
  });

  it('compara ignorando tildes y guiones bajos', () => {
    usuario = {
      rol: { nombre: 'COORDINADOR' },
      sede: sede('FONTIBÓN', true),
      sedes: [sede('FONTIBÓN', true), sede('MONTE_VERDE')],
    };
    const s = crear();

    expect(s.alcanza('FONTIBON')).toBeTrue();
    expect(s.alcanza('MONTE VERDE')).toBeTrue();
    expect(s.alcanza('SOACHA')).toBeFalse();
  });

  it('una fila sin oficina no se esconde: no hay dato por el que excluirla', () => {
    usuario = { rol: { nombre: 'COORDINADOR' }, sede: sede('BOSA', true), sedes: [sede('BOSA', true)] };
    const s = crear();

    expect(s.alcanza('')).toBeTrue();
    expect(s.alcanza(null)).toBeTrue();
    expect(s.alcanza(undefined)).toBeTrue();
  });

  it('cae al singular legacy cuando la sesión es anterior al multi-sede', () => {
    usuario = { rol: { nombre: 'COORDINADOR' }, sede: { id: 'x', nombre: 'ANDES' } };
    const s = crear();

    expect(s.nombres()).toEqual(['ANDES']);
    expect(s.activa()).toBe('ANDES');
    expect(s.tieneVarias()).toBeFalse();
  });
});
