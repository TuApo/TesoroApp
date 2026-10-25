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
    // EconomiAPP: la tienda virtual del colaborador como app aparte, a pantalla completa
    // (fuera del marco del dashboard). Se entra desde "Tienda / Marketplace" del menú.
    {
        path: 'economiapp',
        loadChildren: () =>
            import('./features/economiapp/economiapp.routes').then((m) => m.routes),
    },
    // Agente de Supervisión del dispositivo (ms-devicemgmt): indicador visible,
    // consentimiento y reporte transparente. Es la pantalla del agente en el APK.
    {
        path: 'agente-supervision',
        loadChildren: () =>
            import('./features/agente-supervision/agente-supervision.routes').then((m) => m.routes),
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
    // Superficie pública del módulo Seguridad, SIN sesión: el parlante de la sede en modo
    // quiosco (/parlante/<código>) y el enlace de acuse de una alarma (/seguridad/r/<token>).
    {
        path: 'parlante',
        loadChildren: () =>
            import('./features/publico-seguridad/routes').then((m) => m.routesParlante),
    },
    {
        path: 'seguridad',
        loadChildren: () =>
            import('./features/publico-seguridad/routes').then((m) => m.routesSeguridadPublica),
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
