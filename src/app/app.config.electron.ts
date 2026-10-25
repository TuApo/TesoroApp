import { APP_INITIALIZER, ApplicationConfig, DEFAULT_CURRENCY_CODE, LOCALE_ID, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';
import { routes } from './app.routes';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { interceptor } from './core/interceptors/auth.interceptor';
import { offlineInterceptor } from './core/interceptors/offline.interceptor';
import { actividadInterceptor } from './core/actividad/actividad.interceptor';
import { OfflineSyncService } from './core/services/offline-sync.service';
import { PipelinePreloadService } from './core/services/pipeline-preload.service';

/**
 * Electron-specific config: always uses HashLocationStrategy.
 * Hash routing (/#/dashboard) is required for file:// protocol;
 * without it, Ctrl+R reloads a non-existent filesystem path.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    { provide: LOCALE_ID, useValue: 'es-CO' },
    { provide: DEFAULT_CURRENCY_CODE, useValue: 'COP' },
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withHashLocation()),
    provideHttpClient(
      withFetch(),
      withInterceptors([interceptor, offlineInterceptor, actividadInterceptor])
    ),
    provideAnimations(),
    // Instancia temprana: el sync escucha isOnline$ y procesa la cola SQLite
    // al recuperar red; sin esto la cola crecería pero no se vaciaría.
    {
      provide: APP_INITIALIZER,
      useFactory: () => () => {},
      deps: [OfflineSyncService, PipelinePreloadService],
      multi: true,
    },
  ],
};