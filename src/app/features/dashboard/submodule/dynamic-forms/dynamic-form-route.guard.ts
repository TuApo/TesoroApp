import { inject } from '@angular/core';
import { CanMatchFn, Route, Router, UrlSegment } from '@angular/router';
import { map, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { PlacementService } from './services/placement.service';

/**
 * Guard de ÚLTIMO RECURSO: se registra JUSTO ANTES del catch-all `**` del dashboard.
 * Toma la URL que no matcheó ninguna ruta real y pregunta al backend si corresponde a
 * un formulario dinámico colgado de un módulo. Si sí, deja cargar el runtime (que se
 * monta en la URL canónica del módulo anfitrión, indistinguible de una vista nativa).
 * Si es un alias antiguo, redirige a la ruta canónica. Si no es un formulario, devuelve
 * false y el router sigue al `**` (→ home), sin secuestrar el 404 real.
 */
export const dynamicFormRouteMatch: CanMatchFn = (_route: Route, segments: UrlSegment[]) => {
  const routePath = segments.map((s) => s.path).join('/');
  if (!routePath) return false;
  const placement = inject(PlacementService);
  const router = inject(Router);

  return placement.resolveRoute(routePath).pipe(
    map((res) => {
      if (!res) return false;
      // Alias antiguo → redirigir a la ruta canónica vigente (replaceUrl en la navegación).
      if (res.canonical_route_path && res.canonical_route_path !== routePath) {
        return router.parseUrl('/dashboard/' + res.canonical_route_path);
      }
      // Formulario válido (incluido UNLINKED, para poder mostrar el aviso en el runtime).
      return true;
    }),
    catchError(() => of(false)),
  );
};
