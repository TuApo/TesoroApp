import {
  ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal,
} from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs/operators';
import Swal from 'sweetalert2';

import { PermissionsService } from '@/app/core/services/permissions.service';
import { PlacementService } from '../../services/placement.service';
import { FormView, RouteResolution } from '../../models/placement.models';
import { FormAccess } from '../../models/process.models';

import { FormRuntimeComponent } from '../form-runtime/form-runtime.component';
import { FormResponsesComponent } from '../form-responses/form-responses.component';
import { FormAnalyticsComponent } from '../form-analytics/form-analytics.component';
import { FormSupportsComponent } from '../form-supports/form-supports.component';
import { FormProcessComponent } from '../form-process/form-process.component';

/** Estado de resolución de la ruta a una vista de formulario. */
type EstadoHost = 'cargando' | 'listo' | 'error';

/** Un tab del host: vista + etiqueta + sufijo de ruta ('' = ruta base → llenado). */
interface TabVista {
  view: FormView;
  label: string;
  icon: string;
  sufijo: string;
}

/**
 * Submódulo de gestión donde vive el CONSTRUCTOR y desde donde se abre un formulario por
 * id. Fijo, como en el listado: es la ruta del módulo sembrado en db_admin.
 */
const RUTA_GESTION = 'gestion-del-programa/formularios-dinamicos';

/** Las cinco vistas, en el orden en que se leen: el formulario, su dato, su análisis. */
const TABS: TabVista[] = [
  { view: 'fill', label: 'Formulario', icon: 'edit_note', sufijo: '' },
  { view: 'responses', label: 'Respuestas', icon: 'quick_reference_all', sufijo: '/respuestas' },
  { view: 'process', label: 'Control del proceso', icon: 'fact_check', sufijo: '/proceso' },
  { view: 'supports', label: 'Soportes', icon: 'attach_file', sufijo: '/soportes' },
  { view: 'analytics', label: 'Analítica', icon: 'monitoring', sufijo: '/analitica' },
];

/** Sufijos de URL que son una vista del formulario (los usa también el matcher de rutas). */
const VISTA_POR_SUFIJO: ReadonlyMap<string, FormView> = new Map([
  ['respuestas', 'responses'],
  ['proceso', 'process'],
  ['soportes', 'supports'],
  ['analitica', 'analytics'],
  ['formulario', 'fill'],
]);

/**
 * DISPATCHER de las vistas de un formulario dinámico. Una sola pantalla con pestañas para
 * las CINCO vistas, se entre por donde se entre:
 *
 * <ul>
 *   <li><b>Por el menú</b> — el formulario está publicado como vista de un módulo; la URL
 *       es la del módulo anfitrión y se resuelve contra el backend (GET /forms/resolve).</li>
 *   <li><b>Por el listado</b> — /formularios-dinamicos/{id}[/vista]; se resuelve por id
 *       (GET /forms/{id}/resolve), así también se abren los que aún no están en el menú.</li>
 * </ul>
 *
 * Qué pestañas se pintan lo decide el ACCESO EFECTIVO que devuelve el backend, no el hecho
 * de ser dueño: un rol al que se le concedió el control del proceso ve esa pestaña sin
 * gestionar el formulario, y un rol de solo llenado ve el formulario pelado, sin barra.
 * El mismo criterio lo aplican los endpoints de datos, así que un tab nunca promete algo
 * que el backend vaya a negar.
 *
 * Se re-resuelve en cada NavigationEnd: saltar entre pestañas del MISMO formulario reutiliza
 * el host (una sola ruta con matcher) y solo cambian `vista()` y `fid()`.
 */
@Component({
  selector: 'app-form-view-host',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Solo la vista de LLENADO gobierna su propio alto (cabecera y botones fijos, scroll
  // únicamente en los campos). Las demás scrollean con el wrapper del dashboard.
  host: { '[class.fvh-lleno]': 'esLlenado()' },
  imports: [
    FormRuntimeComponent, FormResponsesComponent, FormAnalyticsComponent,
    FormSupportsComponent, FormProcessComponent,
  ],
  template: `
    @switch (estado()) {
      @case ('cargando') {
        <div class="fvh-estado" role="status" aria-live="polite">
          <span class="fvh-spinner" aria-hidden="true"></span>
          <p>Cargando vista…</p>
        </div>
      }
      @case ('error') {
        <div class="fvh-estado fvh-estado--error" role="alert">
          <span class="material-symbols-outlined" aria-hidden="true">block</span>
          <p>{{ errorMsg() }}</p>
        </div>
      }
      @default {
        @if (tabs().length > 1) {
          <div class="fvh-tabs-fila">
            <div class="fvh-tabs-scroll">
              <nav class="fvh-tabs" role="tablist" [attr.aria-label]="'Vistas de ' + (titulo() || 'formulario')">
                @for (tab of tabs(); track tab.view) {
                  <button
                    type="button"
                    role="tab"
                    class="fvh-tab"
                    [class.fvh-tab--activa]="vistaActiva() === tab.view"
                    [attr.aria-selected]="vistaActiva() === tab.view"
                    (click)="irA(tab)"
                  >
                    <span class="material-symbols-outlined fvh-tab-icono" aria-hidden="true">{{ tab.icon }}</span>
                    <span class="fvh-tab-texto">{{ tab.label }}</span>
                  </button>
                }
              </nav>
            </div>

            <!-- Editar la ESTRUCTURA: solo quien gestiona el formulario (dueño o admin).
                 Los tabs cambian de vista; esto sale del formulario al constructor. -->
            @if (puedeGestionar()) {
              <button
                type="button"
                class="fvh-editar"
                (click)="editarEstructura()"
                [attr.aria-label]="'Editar la estructura de ' + (titulo() || 'este formulario')"
                title="Editar la estructura del formulario (crea una versión nueva)"
              >
                <span class="material-symbols-outlined fvh-editar-icono" aria-hidden="true">design_services</span>
                <span class="fvh-editar-texto">Editar formulario</span>
              </button>
            }
          </div>
        }
        @switch (vistaActiva()) {
          @case ('responses') { <app-form-responses [formIdInput]="fid()" /> }
          @case ('process')   { <app-form-process   [formIdInput]="fid()" [accessInput]="acceso()" /> }
          @case ('supports')  { <app-form-supports  [formIdInput]="fid()" /> }
          @case ('analytics') { <app-form-analytics [formIdInput]="fid()" /> }
          @default            { <app-form-runtime   [formIdInput]="fid()" /> }
        }
      }
    }
  `,
  styles: [`
    :host { display: block; }

    /* La vista de llenado llena EXACTAMENTE el wrapper: así el wrapper no scrollea y
       la única barra de la pantalla es la de los campos (antes convivían las dos). */
    :host(.fvh-lleno) {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      overflow: hidden;
    }
    /* Con la barra de tabs como hermana, el runtime toma el resto del alto (su :host
       trae height:100%, que aquí se resuelve por flex). */
    :host(.fvh-lleno) app-form-runtime {
      flex: 1 1 auto;
      min-height: 0;
      height: auto;
    }

    /* Control SEGMENTADO (píldoras): riel claro + píldora activa navy con icono lima,
       la pareja de marca del sidebar. El riel scrollea horizontal en pantallas chicas. */
    .fvh-tabs-fila {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px 4px;
    }
    /* El riel de tabs scrollea horizontal en pantallas chicas; el botón de editar
       se queda fijo a su derecha en vez de irse fuera con el scroll. */
    .fvh-tabs-scroll {
      flex: 1 1 auto;
      min-width: 0;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .fvh-tabs-scroll::-webkit-scrollbar { display: none; }
    .fvh-tabs {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 4px;
      border-radius: 999px;
      background: var(--slate-100, #eef2f7);
      border: 1px solid var(--slate-200, #e2e8f0);
    }
    .fvh-tab {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 8px 16px;
      border: none;
      border-radius: 999px;
      background: transparent;
      color: var(--muted, #64748b);
      font: inherit;
      font-size: 0.855rem;
      font-weight: 600;
      letter-spacing: 0.01em;
      cursor: pointer;
      white-space: nowrap;
      transition: color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
    }
    .fvh-tab-icono { font-size: 19px; transition: color 0.18s ease; }
    .fvh-tab:hover {
      color: var(--navy, #21263c);
      background: #fff;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.10);
    }
    .fvh-tab:focus-visible {
      outline: 2px solid var(--lime, #8cd50a);
      outline-offset: 2px;
    }
    .fvh-tab--activa,
    .fvh-tab--activa:hover {
      color: #fff;
      background: var(--navy, #21263c);
      box-shadow: 0 2px 8px rgba(33, 38, 60, 0.35);
    }
    .fvh-tab--activa .fvh-tab-icono { color: var(--lime, #8cd50a); }
    @media (prefers-reduced-motion: reduce) {
      .fvh-tab, .fvh-tab-icono { transition: none; }
    }
    @media (max-width: 480px) {
      .fvh-tabs-fila { padding: 10px 10px 2px; }
      .fvh-tab { padding: 8px 12px; }
    }

    .fvh-editar {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      flex-shrink: 0;
      padding: 8px 16px;
      border: 1px solid var(--slate-300, #cbd5e1);
      border-radius: 999px;
      background: #fff;
      color: var(--navy, #21263c);
      font: inherit;
      font-size: 0.855rem;
      font-weight: 600;
      letter-spacing: 0.01em;
      cursor: pointer;
      white-space: nowrap;
      transition: border-color 0.18s ease, box-shadow 0.18s ease, color 0.18s ease;
    }
    .fvh-editar-icono { font-size: 19px; color: var(--muted, #64748b); transition: color 0.18s ease; }
    .fvh-editar:hover {
      border-color: var(--navy, #21263c);
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.10);
    }
    .fvh-editar:hover .fvh-editar-icono { color: var(--navy, #21263c); }
    .fvh-editar:focus-visible {
      outline: 2px solid var(--lime, #8cd50a);
      outline-offset: 2px;
    }
    @media (prefers-reduced-motion: reduce) {
      .fvh-editar, .fvh-editar-icono { transition: none; }
    }
    /* En móvil el botón se queda solo con el icono: el riel de tabs manda. */
    @media (max-width: 640px) {
      .fvh-editar { padding: 8px 10px; }
      .fvh-editar-texto { display: none; }
    }

    .fvh-estado {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      min-height: 40vh;
      padding: 32px 16px;
      color: var(--muted, #64748b);
      text-align: center;
    }
    .fvh-estado p { margin: 0; font-weight: 600; color: var(--slate-700, #334155); }
    .fvh-estado--error .material-symbols-outlined { font-size: 44px; color: var(--danger, #b42318); }
    .fvh-estado--error p { color: var(--danger, #b42318); }
    .fvh-spinner {
      width: 34px;
      height: 34px;
      border: 3px solid var(--slate-200, #e8edf3);
      border-top-color: var(--navy, #21263c);
      border-radius: 50%;
      animation: fvh-giro 0.8s linear infinite;
    }
    @keyframes fvh-giro { to { transform: rotate(360deg); } }
  `],
})
export class FormViewHostComponent {
  private router = inject(Router);
  private placement = inject(PlacementService);
  private permisos = inject(PermissionsService);
  private titleService = inject(Title);
  private destroyRef = inject(DestroyRef);

  readonly estado = signal<EstadoHost>('cargando');
  readonly errorMsg = signal<string>('');
  readonly vista = signal<FormView | null>(null);
  readonly fid = signal<number>(0);
  readonly titulo = signal<string>('');

  /** Ruta base canónica del formulario (relativa a /dashboard) cuando entra por el menú. */
  private readonly rutaBase = signal<string>('');
  /** Acceso efectivo del usuario: gobierna qué pestañas existen. */
  readonly acceso = signal<FormAccess | null>(null);

  /** true si el backend confirmó que el usuario gestiona el formulario (dueño/admin). */
  readonly puedeGestionar = computed(() => this.acceso()?.can_manage === true);

  /**
   * Pestañas visibles. Una sola (el formulario) NO pinta barra: quien solo llena no tiene
   * por qué ver un control de navegación de un solo elemento.
   */
  readonly tabs = computed<TabVista[]>(() => {
    const a = this.acceso();
    if (!a) return [];
    const visible = (v: FormView): boolean => {
      switch (v) {
        case 'fill': return a.can_fill || a.can_manage;
        case 'responses': return a.can_view_responses;
        // El backend ya cruza el permiso con process_enabled: si el formulario no tiene
        // control del proceso encendido, can_process llega en false.
        case 'process': return a.can_process;
        case 'supports': return a.can_view_supports;
        case 'analytics': return a.can_view_analytics;
        default: return false;
      }
    };
    return TABS.filter(t => visible(t.view));
  });

  /** Vista activa normalizada (null = llenado, la vista por defecto del switch). */
  readonly vistaActiva = computed<FormView>(() => this.vista() ?? 'fill');

  /** true cuando lo montado es el runtime de llenado. */
  readonly esLlenado = computed(() => this.estado() === 'listo' && this.vistaActiva() === 'fill');

  /** Última ruta ya resuelta: evita re-resolver el mismo NavigationEnd. */
  private rutaResuelta = '';

  constructor() {
    this.resolver();
    // Re-resolver al navegar entre vistas del mismo formulario (host reutilizado).
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      takeUntilDestroyed(),
    ).subscribe(() => this.resolver());
  }

  irA(tab: TabVista): void {
    this.router.navigateByUrl(this.urlDe(tab.sufijo));
  }

  /**
   * Al CONSTRUCTOR, en modo edición del formulario que se está viendo (crea versión nueva
   * al guardar; las respuestas existentes conservan su esquema).
   *
   * El botón se pinta con `can_manage`, que es permiso SOBRE EL FORMULARIO; entrar al
   * constructor exige además lectura del submódulo de gestión en el árbol de permisos.
   * Si el rol no lo tiene, el guard global redirige a /dashboard sin explicar nada: se
   * comprueba antes para poder decir qué falta.
   */
  editarEstructura(): void {
    const id = this.fid();
    if (!id) return;
    const destino = `/dashboard/${RUTA_GESTION}/${id}/editar`;
    if (!this.permisos.canReadRoute(destino)) {
      void Swal.fire({
        icon: 'info',
        title: 'Sin acceso al constructor',
        text: 'Puedes gestionar este formulario, pero tu rol no tiene acceso al módulo '
          + 'Formularios Dinámicos, que es donde se edita la estructura. Pídeselo a un administrador.',
        confirmButtonText: 'Entendido',
      });
      return;
    }
    this.router.navigateByUrl(destino);
  }

  // ---------- Resolución ----------

  private resolver(): void {
    const ruta = this.rutaActual();
    if (!ruta) {
      this.rutaResuelta = ruta;
      this.mostrarError('Esta vista no está disponible.');
      return;
    }
    if (ruta === this.rutaResuelta) return; // ya resuelta esta URL
    this.rutaResuelta = ruta;
    this.estado.set('cargando');

    // Entrada por el LISTADO: /gestion-del-programa/formularios-dinamicos/{id}[/vista].
    const porId = this.parsearRutaDeGestion(ruta);
    if (porId) {
      this.placement.resolveForm(porId.formId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: res => this.aplicar(res, porId.vista, ''),
        error: () => this.mostrarError('No se pudo abrir el formulario. Puede que no exista o que no tengas acceso.'),
      });
      return;
    }

    // Entrada por el MENÚ: la URL es la del módulo anfitrión.
    this.placement.resolveRoute(ruta).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: res => {
        if (!res || !res.form_id) {
          this.mostrarError('Esta vista no corresponde a ningún formulario disponible.');
          return;
        }
        // Alias antiguo → redirigir a la ruta canónica vigente.
        if (res.canonical_route_path && res.canonical_route_path !== ruta) {
          this.router.navigateByUrl('/dashboard/' + res.canonical_route_path, { replaceUrl: true });
          return;
        }
        this.aplicar(res, res.view ?? 'fill', res.route_path ?? '');
      },
      error: () => this.mostrarError('No se pudo cargar la vista. Intenta de nuevo.'),
    });
  }

  private aplicar(res: RouteResolution, vista: FormView, rutaBase: string): void {
    if (!res || !res.form_id) {
      this.mostrarError('Esta vista no corresponde a ningún formulario disponible.');
      return;
    }
    this.fid.set(res.form_id);
    this.vista.set(vista);
    this.rutaBase.set(rutaBase);
    // El backend puede no traer `access` (versión anterior desplegada): en ese caso se cae
    // al criterio de siempre — gestiona, ve todo; no gestiona, solo el formulario.
    this.acceso.set(res.access ?? this.accesoDeCompatibilidad(res));
    this.titulo.set(res.menu_label ?? '');
    if (res.menu_label) this.titleService.setTitle(res.menu_label);
    this.estado.set('listo');
  }

  /** Fallback si el backend aún no envía `access`: el comportamiento previo a V14. */
  private accesoDeCompatibilidad(res: RouteResolution): FormAccess {
    const manda = res.can_manage === true;
    return {
      form_id: res.form_id,
      access_mode: 'OWNER',
      can_manage: manda,
      can_fill: true,
      can_view_responses: manda,
      can_edit_responses: manda,
      can_review: manda,
      can_view_supports: manda,
      can_view_analytics: manda,
      can_process: false,
      can_bulk_load: false,
      can_export: manda,
      process_enabled: false,
      allow_edit_submitted: false,
      editable_fields: null,
      visible_fields: null,
    };
  }

  /** URL de una pestaña, según se haya entrado por el listado o por el menú. */
  private urlDe(sufijo: string): string {
    const base = this.rutaBase();
    if (base) return `/dashboard/${base}${sufijo}`;
    return `/dashboard/${RUTA_GESTION}/${this.fid()}${sufijo}`;
  }

  /** ¿La URL es .../formularios-dinamicos/{id}[/vista]? Devuelve el id y la vista. */
  private parsearRutaDeGestion(ruta: string): { formId: number; vista: FormView } | null {
    if (!ruta.startsWith(RUTA_GESTION + '/')) return null;
    const resto = ruta.substring(RUTA_GESTION.length + 1).split('/');
    const id = Number(resto[0]);
    if (!Number.isInteger(id) || id <= 0) return null;
    if (resto.length === 1) return { formId: id, vista: 'fill' };
    if (resto.length === 2) {
      const vista = VISTA_POR_SUFIJO.get(resto[1]);
      if (vista) return { formId: id, vista };
    }
    return null;
  }

  private mostrarError(mensaje: string): void {
    this.errorMsg.set(mensaje);
    this.estado.set('error');
  }

  /** URL actual relativa a /dashboard (sin query ni fragment), como espera el backend. */
  private rutaActual(): string {
    let url = this.router.url.split('?')[0].split('#')[0];
    if (url.startsWith('/dashboard/')) url = url.substring('/dashboard/'.length);
    else if (url.startsWith('/')) url = url.substring(1);
    return url.replace(/\/+$/, '');
  }
}
