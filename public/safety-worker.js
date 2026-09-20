/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

// tslint:disable:no-console

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());

  event.waitUntil(
    self.registration.unregister().then(() => {
      console.log('NGSW Safety Worker - unregistered old service worker');
    }),
  );

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      const ngswCacheNames = cacheNames.filter((name) => /^ngsw:/.test(name));
      return Promise.all(ngswCacheNames.map((name) => caches.delete(name)));
    }),
  );
});

// Copiado de @angular/service-worker en el despliegue de la PWA (2026-09-20).
// Salida de emergencia: si un service worker deja a la gente atrapada en una
// versión rota, se publica ESTE archivo como /ngsw-worker.js y el navegador lo
// instala en su lugar; al arrancar borra el registro y las cachés, y la app
// vuelve a servirse directa desde la red. No se borra "por limpieza".
