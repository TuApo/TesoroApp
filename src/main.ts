import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { instalarDescargasNativas } from './app/core/nativo/descargas-nativas';

// 👇 Agrega estas 2 líneas antes del bootstrap
import { registerLocaleData } from '@angular/common';
import localeEsCo from '@angular/common/locales/es-CO';
registerLocaleData(localeEsCo, 'es-CO');

// En el APK, las descargas (PDF, Excel…) se guardan y se abren con el menú del sistema.
instalarDescargasNativas();

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
