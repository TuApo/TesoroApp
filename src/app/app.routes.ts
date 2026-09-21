import { Routes } from '@angular/router';

export const routes: Routes = [
    {
        path: '',
        loadChildren: () =>
            import('./features/auth/routes').then((m) => m.routes),
    },
    {
        path: 'dashboard',
        loadChildren: () =>
            import('./features/dashboard/routes').then((m) => m.routes),
    },
    // Superficie pública del módulo de turnos, SIN sesión: el televisor de la sala
    // (/pantalla/<código>) y tomar/seguir turno desde el QR del cartel (/t/<código>).
    {
        path: 'pantalla',
        loadChildren: () =>
            import('./features/publico-turnos/routes').then((m) => m.routesPantalla),
    },
    {
        path: 't',
        loadChildren: () =>
            import('./features/publico-turnos/routes').then((m) => m.routesTurno),
    },
    { path: '**', redirectTo: '' },
];
