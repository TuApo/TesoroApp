import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { tap } from 'rxjs';
import { RegistroActividadService } from './registro-actividad.service';

/** Anota cada llamada a la API (método, ruta, resultado y duración) para "Actividad del personal". */
export const actividadInterceptor: HttpInterceptorFn = (req, next) => {
  const registro = inject(RegistroActividadService);
  if (!registro.debeRegistrar(req.url)) return next(req);
  const t0 = performance.now();
  return next(req).pipe(tap({
    next: ev => { if (ev instanceof HttpResponse) registro.peticion(req.method, req.urlWithParams, ev.status, performance.now() - t0); },
    error: (e: unknown) => registro.peticion(req.method, req.urlWithParams, e instanceof HttpErrorResponse ? e.status : 0, performance.now() - t0),
  }));
};
