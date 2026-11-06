# Salón inteligente (submódulo portable)

Panel del «Salón inteligente» (ms-store `salon` + worker `salon-vision`): plano en vivo con
estado y cronómetro por mesa, calibración de polígonos sobre la cámara, anfitrión (lista de
espera + predicción de liberación), alertas, analítica y configuración.

Contrato de API: `microservices/workers/salon-vision/CONTRATO-API.md` (§1 y §4). Los tipos de
`models/salon.models.ts` están calcados de ahí, en **snake_case**.

## Cómo montarlo en otra app (EconomiaNegocio)

La carpeta `salon/` se copia **tal cual** (p. ej. a `src/app/features/salon/`). Dentro no se
importa nada del shell de TesoroApp: solo `@angular/*` (Material/CDK), `rxjs`, `echarts` /
`ngx-echarts`, `environments/environment` y, como **única dependencia externa**,
`<app-tabla-estandar>` (`@/app/shared/components/tabla-estandar`, usada en Alertas y
Analítica; hay que copiarla o tener el alias `@/` apuntando a `src/`).

### 1. Ruta

```ts
import { SALON_ROUTES } from './features/salon/salon.routes';   // o m.routes (alias)
{ path: 'salon', loadChildren: () => import('./features/salon/salon.routes').then(m => m.SALON_ROUTES) }
```

Rutas hijas relativas: `''` (plano), `plano` (→ `''`), `calibracion`, `anfitrion`, `alertas`,
`analitica`, `configuracion`.

### 2. Tokens de inyección (todos con valor por defecto; se sobreescriben en `providers` de la ruta)

| Token (`services/salon-api.token.ts` / `salon-contexto.token.ts`) | Por defecto | Para qué |
|---|---|---|
| `SALON_API_BASE` | `environment.apiUrl + '/api/v1/store/salon'` | Base del API §4 |
| `SALON_CONTEXTO` | `SalonContextoService` | `{ tiendaId: Signal<string|null>; tenantId: Signal<string|null> }`: la sede actual |
| `SALON_RUTA_BASE` | `'/dashboard/salon'` | Prefijo con el que se montó (pestañas del encabezado) |
| `SALON_ALCANCE_URL` | `environment.apiUrl + '/api/v1/store/tiendas/mi-alcance'` | Solo lo usa `SalonContextoService` para el selector de sede |
| `SALON_TOKEN_JWT` | lee `localStorage` (`token` / `Authorization` / `user.token`) | `() => Promise<string|null>` para la cabecera `Authorization` del SSE |

Ejemplo en una app con su propio contexto de sede:

```ts
{
  path: 'salon',
  providers: [
    { provide: SALON_RUTA_BASE, useValue: '/salon' },
    { provide: SALON_CONTEXTO, useExisting: SedeService },          // implementa SalonContexto
    { provide: SALON_TOKEN_JWT, useValue: () => miAuth.tokenVigente() },
  ],
  loadChildren: () => import('./features/salon/salon.routes').then(m => m.SALON_ROUTES),
}
```

### 3. Selector de sede

`components/selector-sede.ts` solo se pinta cuando el `SALON_CONTEXTO` inyectado **es**
`SalonContextoService` (`instanceof`). Con un contexto propio de la app no aparece. El servicio
propio: recuerda la sede en `localStorage` (`salon:tienda`), acepta `?tienda=<id>` en la URL
(gana sobre lo guardado) y lee el alcance de `SALON_ALCANCE_URL` (forma `Alcance` de ms-store:
`{ super_admin, ve_todo, tiendas: [{ id, nombre, rol_en_la_tienda, … }], nodos }`).

Los permisos de pantalla (`permisosDeContexto`) salen de `rol_en_la_tienda` con el servicio
propio; con un contexto ajeno se pinta todo y manda el servidor (403).

### 4. Dependencias

- Angular 21 standalone + signals; Angular Material 21 (`MatIcon`, `MatMenu`, `MatSnackBar`,
  `MatTabs`); `FormsModule`.
- `ngx-echarts` 21 + `echarts` 6 (mapa de calor; el componente provee su propio
  `provideEchartsCore`).
- `<app-tabla-estandar>` (Alertas, Analítica).
- Tokens de tema `src/theme/tokens.css` (`--surface`, `--text`, `--ok-bg`…). Los semáforos de
  mesa (`--mesa-libre|ocupada|limpiar|reservada`) están en `salon-comun.css` con variante para
  `html[data-theme='dark']`.
- Interceptor HTTP de la app que añada `Authorization: Bearer …` a `environment.apiUrl`.

### 5. Canal en vivo

`services/salon-stream.service.ts` abre `GET /tiendas/{id}/stream` (SSE sobre `fetch`, token en
cabecera), reconecta con espera exponencial (≤ 30 s) y, si no levanta tras 2 intentos, sondea
`/plano` cada 15 s hasta que el SSE vuelva. Expone `plano`, `estado`, `ahora` (reloj de 1 s para
los cronómetros) y `alerta$` (toasts).

## Estructura

```
salon/
  salon.routes.ts          SALON_ROUTES (+ alias routes), javadoc con nodos de menú
  salon-comun.css          estilos comunes + semáforos de mesa
  models/salon.models.ts   tipos del contrato
  services/                salon-api.token.ts · salon-contexto.token.ts · salon-contexto.service.ts
                           salon.service.ts (HTTP §4) · salon-stream.service.ts (SSE + sondeo)
  components/              salon-encabezado · selector-sede · mesa-tarjeta · editor-poligono
                           mapa-calor · cronometro.pipe
  pages/                   plano · calibracion · anfitrion · alertas · analitica · configuracion
```
