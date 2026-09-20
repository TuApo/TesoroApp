# Tabla estándar (`<app-tabla-estandar>`)

Todas las tablas de listado de la plataforma usan este componente. La pantalla
**no pinta su tabla: la describe** con un arreglo de columnas, y la tabla
resuelve lo demás igual en todas partes:

| Necesidad | Cómo |
|---|---|
| Responsive | Columnas con `prioridad` 1/2/3 que se ocultan según el ancho; en móvil arranca en tarjetas. Scroll horizontal dentro de su contenedor. |
| Tabla ⇄ Tarjetas | Botón en la barra. Se recuerda por pantalla (`tabla:<id>:vista`) y sobrevive al logout. |
| Búsqueda global | Busca en el texto de todas las columnas. |
| Filtro por columna | Embudo en cada encabezado: A→Z / Z→A, «contiene» y lista de valores (en cascada con los demás filtros). |
| Paginación | 25 / 50 / 100 / 250 / Todas (`filasPorPagina`, 0 la apaga). |
| Selección tipo Excel | Celda, rango (arrastre o Shift+clic), columna, fila, todo; flechas; auto-scroll. |
| Copiar / Excel | Ctrl+C o botón (TSV + HTML); descarga `.xlsx` real con encabezado de marca. |
| Detalle | Si la pantalla escucha `(filaClick)`: botón «Ver» y doble clic. |
| Tema | Solo tokens (`--surface`, `--text`…): funciona en claro y oscuro sin más. |

## Uso mínimo

```ts
import { ColumnaTabla, TABLA_ESTANDAR } from '@/app/shared/components/tabla-estandar';

@Component({ imports: [...TABLA_ESTANDAR, MatButtonModule, MatIconModule], … })
export class MiPantalla {
  filas = signal<Empleado[]>([]);
  cargando = signal(false);

  readonly columnas: ColumnaTabla<Empleado>[] = [
    { id: 'nombre', header: 'Nombre', valor: (e) => e.nombre, tarjeta: 'titulo' },
    { id: 'cedula', header: 'Cédula', valor: (e) => e.cedula, tarjeta: 'subtitulo' },
    { id: 'sede', header: 'Sede', valor: (e) => e.sede, prioridad: 2 },
    { id: 'salario', header: 'Salario', align: 'right', prioridad: 3,
      valor: (e) => e.salario,                                  // número: ordena y suma bien
      formato: (e) => formatCurrency(e.salario, 'es-CO', '$', 'COP', '1.0-0'),
      copiaTexto: (e) => String(e.salario) },                   // a Excel va el número limpio
    { id: 'estado', header: 'Estado', align: 'center', tarjeta: 'badge',
      valor: (e) => e.activo ? 'Activo' : 'Retirado',
      badge: (e) => ({ texto: e.activo ? 'Activo' : 'Retirado', tono: e.activo ? 'ok' : 'neutro' }) },
  ];
  readonly idFila = (e: Empleado) => e.id;
}
```

```html
<app-tabla-estandar
  id="nomina-empleados"            <!-- estable y único: clave de la vista guardada -->
  titulo="Empleados"               <!-- nombre del Excel y de su hoja -->
  modulo="Nómina"
  [datos]="filas()"
  [columnas]="columnas"
  [filaId]="idFila"
  [cargando]="cargando()"
  (filaClick)="abrir($event)">     <!-- opcional: aparece «Ver» + doble clic -->

  <ng-template tablaAcciones let-e>
    <button mat-icon-button (click)="editar(e)" matTooltip="Editar"><mat-icon>edit</mat-icon></button>
  </ng-template>

  <ng-template tablaCelda="nombre" let-e>          <!-- celda rica (opcional) -->
    <strong>{{ e.nombre }}</strong>
  </ng-template>
</app-tabla-estandar>
```

## La columna (`ColumnaTabla<T>`)

La clave es **`valor`**: devuelve el dato **plano** (texto, número, fecha,
booleano). De ahí salen búsqueda, filtros, orden y copiado. Lo visual va aparte:

* `formato(fila)` → texto visible distinto del valor (moneda, fecha formateada, `'—'` si vacío).
* `badge(fila)` → chip de estado `{ texto, tono: 'ok'|'warn'|'danger'|'info'|'violet'|'neutro', icono? }`.
* `<ng-template tablaCelda="id" let-fila>` → cualquier cosa (enlaces, avatares, inputs).
* Prioridad de pintado: plantilla > `badge` > `formato` > `valor`.

Otros campos: `copiaTexto`, `align`, `prioridad` (1 siempre · 2 desde 640 px · 3 desde 1024 px),
`ordenable`, `filtrable`, `copiable`, `interactiva` (la celda tiene controles: queda fuera de la
selección), `tarjeta` (`titulo|subtitulo|badge|cuerpo|meta|oculto`), `ancho`, `minAncho`.

Para fechas, que `valor` devuelva un `Date` (o ISO) y `formato` el texto: así ordena bien.

## Entradas y salidas

| Entrada | Default | |
|---|---|---|
| `id` (req.) | — | Clave de la vista guardada. Formato `modulo-pantalla`. |
| `datos`, `columnas` (req.) | — | |
| `filaId` | posición | Clave única de fila para el `track`. |
| `titulo`, `modulo`, `entidad` | `'Tabla'`, `'Sistema'` | Excel y registro de copias. |
| `vistaInicial` | `'auto'` | `'auto'` = tarjetas < 768 px. Si el usuario eligió, manda lo guardado. |
| `busqueda` | `true` | `false` la oculta; un texto cambia el placeholder. |
| `filasPorPagina` | `50` | `0` sin paginación. |
| `copiable`, `descargable` | `true` | |
| `cargando` | `false` | Esqueleto sin datos; barra fina si ya hay filas. |
| `vacio` | — | Texto sin filas (o plantilla `tablaVacio`). |
| `filaClase` | — | Clases **de la tabla**: `te-fila--atenuada`, `te-fila--alerta`, `te-fila--peligro`, `te-fila--ok`, `te-fila--info`, `te-fila--destacada`. El CSS de la pantalla no llega a las filas. |
| `pie` | — | `(filas) => ({ idColumna: total })` sobre lo filtrado. |
| `seleccion` | — | `SelectionModel` de la pantalla → casillas para acciones masivas. |
| `detalle` | auto | Fuerza/apaga el botón «Ver». |
| `totalServidor` | `null` | **Modo servidor** (ver abajo). |
| `paginaServidor` | `null` | Modo servidor: página (base 0) que pidió la pantalla; la tabla se sincroniza. |
| `opcionesPorPagina` | 25/50/100/250/Todas | Tamaños del paginador (p. ej. `[25, 50, 100, 200]` si el backend topa en 200). |
| `minAnchoTarjeta`, `tarjetaSinMarco`, `textoDetalle`, `ayuda` | | Presentación. |

| Salida | |
|---|---|
| `(filaClick)` | Botón «Ver», doble clic en fila o clic en tarjeta. |
| `(ordenCambio)` | `{ columna, direccion } \| null`. Siempre se emite. |
| `(paginaCambio)`, `(busquedaCambio)` | Solo en modo servidor. |

Proyección: `<div tablaHerramientas>` (filtros de negocio dentro de la barra, a la izquierda),
`<div tablaAccionesBarra>` (botones propios, a la derecha), plantillas `tablaCelda`,
`tablaAcciones`, `tablaTarjeta`, `tablaEncabezado`, `tablaVacio`.

## Modo servidor

Para conjuntos grandes (miles de filas) que el backend pagina:

```html
<app-tabla-estandar id="tesoreria-trabajadores" [datos]="pagina()" [columnas]="columnas"
  [totalServidor]="total()" [filasPorPagina]="50"
  (paginaCambio)="cargar($event.pagina, $event.porPagina)"
  (busquedaCambio)="buscar($event)" (ordenCambio)="ordenar($event)" />
```

`datos` es la página actual; la tabla no filtra ni ordena por su cuenta, solo avisa. Al buscar u
ordenar, quien escucha vuelve a la página 0 (la tabla no emite una página extra).

## Migrar una tabla existente

1. **Columnas**: por cada `matColumnDef`/`<th>`, una `ColumnaTabla` con el mismo `header`.
   `valor` = el dato plano que se pintaba; `formato`/`badge`/`tablaCelda` para lo visual.
2. **Acciones**: los botones de la columna de acciones van a `<ng-template tablaAcciones>`.
3. **Se elimina**: `MatTableDataSource`, `MatSort`, `MatPaginator`, el buscador propio de la
   página (la tabla trae uno), el contador de filas, el spinner y el mensaje de vacío propios.
4. **Se conserva**: filtros de negocio que consultan al backend (fechas, sede, estado…),
   encima de la tabla o en `<div tablaHerramientas>`.
5. **CSS**: quitar lo de la tabla vieja (`.mat-mdc-table`, `th`, `td`, `::ng-deep` de la tabla).
   Lo de las plantillas `tablaCelda` sí se queda (esas celdas son de la pantalla).
6. **Colores** siempre con tokens (`var(--surface)`, `var(--text)`, `var(--ok-bg)`…), nunca hex.
7. **No migrar**: matrices de permisos con casillas, rejillas editables celda a celda,
   tablas de 2–5 filas de clave-valor dentro de un diálogo, y documentos que se imprimen.

`<app-standard-filter-table>` ya es un adaptador de esta tabla: las pantallas que lo usan no
necesitan migrarse.
