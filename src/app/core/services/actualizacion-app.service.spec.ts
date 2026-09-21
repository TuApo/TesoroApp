import { TestBed } from '@angular/core/testing';
import { NavigationEnd, NavigationError, Router } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { Subject } from 'rxjs';

import { ActualizacionAppService } from './actualizacion-app.service';

describe('ActualizacionAppService', () => {
  const eventos = new Subject<unknown>();
  let servicio: ActualizacionAppService;
  let recargas: string[];

  beforeEach(() => {
    recargas = [];
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { events: eventos.asObservable(), url: '/dashboard' } },
        { provide: SwUpdate, useValue: { isEnabled: false } },
      ],
    });
    servicio = TestBed.inject(ActualizacionAppService);
    spyOn(servicio as unknown as { activarYRecargar: (u: string) => Promise<void> }, 'activarYRecargar').and.callFake(async (u: string) => { recargas.push(u); });
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
});
