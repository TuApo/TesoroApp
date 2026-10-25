import { APP_INITIALIZER, ApplicationConfig, DEFAULT_CURRENCY_CODE, LOCALE_ID, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter, withHashLocation, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { interceptor } from './core/interceptors/auth.interceptor';
import { offlineInterceptor } from './core/interceptors/offline.interceptor';
import { actividadInterceptor } from './core/actividad/actividad.interceptor';
import { OfflineSyncService } from './core/services/offline-sync.service';
import { PipelinePreloadService } from './core/services/pipeline-preload.service';
import { provideServiceWorker } from '@angular/service-worker';
import {
  ActualizacionAppService, serviceWorkerHabilitado,
} from './core/services/actualizacion-app.service';
import { InstalacionPwaService } from './core/services/instalacion-pwa.service';
import { environment } from '@/environments/environment';

/**
 * Web/SSR config: uses PathLocationStrategy (default).
 * Hash routing is NOT needed for web deployments.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    // Pesos colombianos en toda la app: $ 1.234.567 (punto de miles), fechas y números en
    // español de Colombia. main.ts ya registra los datos del locale.
    { provide: LOCALE_ID, useValue: 'es-CO' },
    { provide: DEFAULT_CURRENCY_CODE, useValue: 'COP' },
    provideRouter(routes, withHashLocation(), withComponentInputBinding()),
    provideClientHydration(withEventReplay()),
    provideHttpClient(
      withFetch(),
      withInterceptors([interceptor, offlineInterceptor, actividadInterceptor])
    ),
    provideAnimations(),
    // App instalable: el service worker sirve el caparazón desde la caché, así
    // que abre sin red. Solo en el navegador (ver serviceWorkerHabilitado).
    provideServiceWorker('ngsw-worker.js', {
      enabled: serviceWorkerHabilitado(environment.production),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    // Instanciar servicios offline temprano para que escuchen isOnline$
    {
      provide: APP_INITIALIZER,
      // Los tres van en `deps` para que Angular los instancie; la factory recibe
      // los tres EN ORDEN, así que el de actualización es el tercero (antes
      // llegaba OfflineSyncService y arrancaba con «iniciar is not a function»,
      // dejando la aplicación en blanco).
      useFactory: (
        _offline: OfflineSyncService,
        _pipeline: PipelinePreloadService,
        actualizacion: ActualizacionAppService,
      ) => () => actualizacion.iniciar(),
      deps: [OfflineSyncService, PipelinePreloadService, ActualizacionAppService],
      multi: true,
    },
  ],
};