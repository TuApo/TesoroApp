import { TestBed } from '@angular/core/testing';
import { NavigationEnd, NavigationError, Router } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { Subject } from 'rxjs';

import { ActualizacionAppService } from './actualizacion-app.service';

describe('ActualizacionAppService', () => {
  // Un Subject por prueba: si se compartiera, las instancias del servicio de pruebas
  // anteriores seguirían suscritas y se llevarían el evento (y la marca de sessionStorage).
  let eventos: Subject<unknown>;
  let servicio: ActualizacionAppService;
  let recargas: string[];

  beforeEach(() => {
    recargas = [];
    eventos = new Subject<unknown>();
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { events: eventos.asObservable(), url: '/dashboard' } },
        { provide: SwUpdate, useValue: { isEnabled: false } },
      ],
    });
    servicio = TestBed.inject(ActualizacionAppService);
    spyOn(servicio as unknown as { activarYRecargar: (u: string) => Promise<void> }, 'activarYRecargar').and.callFake(async (u: string) => { recargas.push(u); });
    // Por si algún camino llega a la recarga real: nunca recargar la página de Karma.
    spyOn(servicio as unknown as { recargar: () => void }, 'recargar').and.stub();
    try { sessionStorage.clear(); } catch { /* sin storage */ }
    servicio.iniciar();
  });

  it('un chunk perdido recarga en la ruta destino, una sola vez por ruta', () => {
    eventos.next(new NavigationError(1, '/dashboard/turnos/voz', new Error('Failed to fetch dynamically imported module: chunk-ABC.js')));
    expect(recargas).toEqual(['/dashboard/turnos/voz']);
    eventos.next(new NavigationError(2, '/dashboard/turnos/voz', new Error('Loading chunk 123 failed')));
    expect(recargas.length).toBe(1);
    // Tras navegar bien a esa ruta, un fallo futuro vuelve a poder recargar.
    eventos.next(new NavigationEnd(3, '/dashboard/turnos/voz', '/dashboard/turnos/voz'));
    eventos.next(new NavigationError(4, '/dashboard/turnos/voz', new Error('ChunkLoadError')));
    expect(recargas.length).toBe(2);
  });

  it('otros errores de navegación no recargan', () => {
    eventos.next(new NavigationError(1, '/dashboard/x', new Error('Cannot match any routes')));
    expect(recargas).toEqual([]);
  });

  it('la recarga real pasa por la costura recargar()', () => {
    const svc = servicio as unknown as { recargar: () => void; activarYRecargar: (u: string) => Promise<void> };
    (svc.activarYRecargar as jasmine.Spy).and.callThrough();
    return svc.activarYRecargar('/dashboard/turnos/voz').then(() => {
      expect(svc.recargar).toHaveBeenCalledTimes(1);
    });
  });
});
