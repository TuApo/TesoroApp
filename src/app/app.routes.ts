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
    {
        path: 'agendar',
        loadChildren: () =>
            import('./features/publico-turnos/routes').then((m) => m.routesAgenda),
    },
    // El QR pegado en cada finca es una URL (/campo/qr?f=&t=): leído con la cámara del
    // sistema abre la app y lleva directo a marcar con ese QR (el login, si hace falta, lo
    // pide el dashboard).
    {
        path: 'campo/qr',
        loadComponent: () =>
            import('./features/dashboard/submodule/campo/pages/qr-entrada/qr-entrada.component').then((m) => m.QrEntradaComponent),
    },
    { path: '**', redirectTo: '' },
];
