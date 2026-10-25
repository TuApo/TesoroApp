import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { of } from 'rxjs';
import { switchMap, tap } from 'rxjs/operators';

import { obtenerUsuarioActual } from '../../../../../../core/utils/usuario-actual';
import { PermissionsService } from '../../../../../../core/services/permissions.service';
import { SedeScopeService } from '../../../../../../shared/services/sede-scope/sede-scope.service';
import {
  AlcanceResumen,
  CasoPendiente,
  ESTADO_DEVUELTO,
  EstadisticaFormulario,
  FormularioCoordinador,
  GRUPOS_COORDINADORES,
  GrupoCoordinadores,
  SIN_ESTADO,
} from '../../models/coordinadores.models';
import { CoordinadoresFormulariosService } from '../../services/coordinadores-formularios.service';
import {
  IncapacidadesOficinaService,
  KpisIncapacidadesOficina,
} from '../../services/incapacidades-oficina.service';
import { LineaTiempoMiniComponent } from '../../components/linea-tiempo-mini/linea-tiempo-mini.component';

/** Un grupo del menú con sus formularios, listo para pintar. */
interface GrupoVista extends GrupoCoordinadores {
  formularios: FormularioCoordinador[];
}

/** Enlace a una pantalla de Incapacidades, solo si está en el menú del usuario. */
interface EnlaceIncapacidad { ruta: string; nombre: string; icono: string }

const RUTAS_INCAPACIDADES: readonly EnlaceIncapacidad[] = [
  { ruta: '/dashboard/disabilities/registro', nombre: 'Registrar incapacidad', icono: 'post_add' },
  { ruta: '/dashboard/disabilities/consulta', nombre: 'Consultar incapacidades', icono: 'fact_check' },
];

/** Cuántos pendientes se muestran antes de "ver todos". */
const PENDIENTES_VISIBLES = 6;

/**
 * Inicio del módulo Coordinadores (`/dashboard/coordinadores`).
 *
 * Una sola pantalla para tres públicos, gobernada por lo que el backend dice que puede
 * cada uno (no por el nombre del rol):
 *  · COORDINADOR — llena, ve respuestas y el control del proceso; sin analítica.
 *  · JEFE-DE-AREA — además revisa y tiene analítica (línea de tiempo + estado del caso).
 *  · GERENCIA — consulta: respuestas y analítica, sin llenar ni proceso.
 */
@Component({
  selector: 'app-inicio-coordinadores',
  standalone: true,
  imports: [RouterLink, MatIconModule, DecimalPipe, LineaTiempoMiniComponent],
  templateUrl: './inicio-coordinadores.component.html',
  styleUrl: './inicio-coordinadores.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InicioCoordinadoresComponent {
  private readonly datos = inject(CoordinadoresFormulariosService);
  private readonly incapacidadesApi = inject(IncapacidadesOficinaService);
  private readonly permisos = inject(PermissionsService);
  private readonly sedeScope = inject(SedeScopeService);
  private readonly destroyRef = inject(DestroyRef);

  readonly ESTADO_DEVUELTO = ESTADO_DEVUELTO;
  readonly SIN_ESTADO = SIN_ESTADO;

  // ── Encabezado ──────────────────────────────────────────────────────────
  private readonly usuario = obtenerUsuarioActual();
  readonly nombre = this.usuario.nombreCompleto || 'Coordinador';
  readonly primerNombre = (this.usuario.nombreCompleto.split(' ')[0] || '').toLowerCase()
    .replace(/^\p{L}/u, (c) => c.toUpperCase());
  readonly rol = this.usuario.rol;
  readonly todasLasOficinas = this.sedeScope.sinLimite();
  readonly oficinas = this.usuario.sedes;

  // ── Formularios ─────────────────────────────────────────────────────────
  readonly cargandoFormularios = signal(true);
  readonly formularios = signal<FormularioCoordinador[]>([]);
  private readonly nombresGrupo = signal<Map<string, string>>(new Map());

  readonly grupos = computed<GrupoVista[]>(() => {
    const porGrupo = new Map<string, FormularioCoordinador[]>();
    for (const f of this.formularios()) {
      porGrupo.set(f.grupo, [...(porGrupo.get(f.grupo) ?? []), f]);
    }
    const conocidos = GRUPOS_COORDINADORES
      .filter((g) => porGrupo.has(g.slug))
      .map((g) => ({ ...g, nombre: this.nombresGrupo().get(g.slug) ?? g.nombre, formularios: porGrupo.get(g.slug)! }));
    const nuevos = [...porGrupo.keys()]
      .filter((slug) => !GRUPOS_COORDINADORES.some((g) => g.slug === slug))
      .map((slug) => ({
        slug, nombre: this.nombresGrupo().get(slug) ?? slug, icono: 'folder', descripcion: '',
        formularios: porGrupo.get(slug)!,
      }));
    return [...conocidos, ...nuevos];
  });

  /** Algún formulario deja llenar (COORDINADOR): cambia el texto de ayuda. */
  readonly puedeLlenarAlguno = computed(() => this.formularios().some((f) => f.acceso?.can_fill));
  /** Algún formulario tiene control del proceso: solo así hay "pendientes" que buscar. */
  readonly tieneProceso = computed(() => this.formularios().some((f) => f.acceso?.can_process));

  // ── Estadísticas ────────────────────────────────────────────────────────
  readonly cargandoStats = signal(false);
  /** false si el resumen no se pudo leer (403/404/caída): se ocultan cifras y pendientes. */
  readonly resumenDisponible = signal(false);
  readonly stats = signal<Map<number, EstadisticaFormulario>>(new Map());
  readonly pendientes = signal<CasoPendiente[]>([]);
  /** Pendientes totales (la lista viene topada a 50 por el backend). */
  readonly pendientesTotal = signal(0);
  /** Alcance por oficina con que el backend calculó las cifras ("Viendo: la oficina SUBA"). */
  readonly alcance = signal<AlcanceResumen | null>(null);
  readonly verTodosPendientes = signal(false);
  readonly pendientesVisibles = computed(() =>
    this.verTodosPendientes() ? this.pendientes() : this.pendientes().slice(0, PENDIENTES_VISIBLES));
  readonly devueltos = computed(() => this.pendientes().filter((p) => p.estado === ESTADO_DEVUELTO).length);
  /** Pendientes del histórico que no caben en la lista (el backend topa en 50). */
  readonly pendientesFuera = computed(() => Math.max(0, this.pendientesTotal() - this.pendientes().length));

  /** Totales del módulo (suma de lo que se pudo leer). */
  readonly resumen = computed(() => {
    let total = 0, mes = 0, mios = 0, hayMios = false, parcial = false;
    for (const s of this.stats().values()) {
      total += s.total ?? 0;
      mes += s.delMes ?? 0;
      if (s.mios != null) { mios += s.mios; hayMios = true; }
      parcial ||= s.delMesParcial;
    }
    return { total, mes, mios: hayMios ? mios : null, parcial, formularios: this.stats().size };
  });

  // ── Incapacidades ───────────────────────────────────────────────────────
  readonly cargandoIncapacidades = signal(true);
  readonly incapacidades = signal<KpisIncapacidadesOficina | null>(null);
  readonly enlacesIncapacidades: EnlaceIncapacidad[];

  constructor() {
    const legibles = new Set(this.permisos.listReadableModules().map((m) => m.ruta));
    this.enlacesIncapacidades = RUTAS_INCAPACIDADES.filter((e) => legibles.has(e.ruta));
    this.cargar();
  }

  cargar(): void {
    const { formularios, nombresGrupo } = this.datos.formulariosDelMenu();
    this.nombresGrupo.set(nombresGrupo);
    this.cargandoFormularios.set(true);

    this.datos.resolver(formularios).pipe(
      tap((resueltos) => {
        this.formularios.set(resueltos);
        this.cargandoFormularios.set(false);
        this.cargandoStats.set(true);
      }),
      // Una sola llamada: el resumen por categoría de ms-forms (cifras + pendientes de
      // todo el histórico, ya recortados por oficina). Si no hay formularios en el menú
      // no se pregunta nada.
      switchMap((resueltos) => resueltos.length ? this.datos.estadisticas(resueltos) : of(null)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (r) => {
        this.resumenDisponible.set(!!r);
        this.stats.set(r?.stats ?? new Map());
        this.pendientes.set(r?.pendientes ?? []);
        this.pendientesTotal.set(r?.pendientesTotal ?? 0);
        this.alcance.set(r?.alcance ?? null);
        this.cargandoStats.set(false);
      },
      error: () => {
        this.cargandoFormularios.set(false);
        this.cargandoStats.set(false);
      },
    });

    // Incapacidades: solo si el usuario tiene alguna pantalla del módulo en su menú;
    // sin ellas ms-hr respondería 403 y el bloque no tendría a dónde llevar.
    if (this.enlacesIncapacidades.length) {
      this.incapacidadesApi.kpis().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((k) => {
        this.incapacidades.set(k);
        this.cargandoIncapacidades.set(false);
      });
    } else {
      this.cargandoIncapacidades.set(false);
    }
  }

  stat(f: FormularioCoordinador): EstadisticaFormulario | null {
    return f.formId != null ? this.stats().get(f.formId) ?? null : null;
  }

  /** Ancho relativo de la barra de un estado dentro de su formulario. */
  porcentaje(s: EstadisticaFormulario, n: number): number {
    const total = s.estados.reduce((acc, e) => acc + e.total, 0);
    return total ? Math.max(2, Math.round((n / total) * 100)) : 0;
  }

  claseEstado(estado: string): string {
    switch (estado) {
      case 'Aprobado': return 'ok';
      case 'Archivado': return 'neutro';
      case ESTADO_DEVUELTO: return 'peligro';
      case 'En revisión': return 'aviso';
      case SIN_ESTADO: return 'vacio';
      default: return 'info';
    }
  }

  fechaCorta(iso: string | null): string {
    if (!iso) return '';
    const [y, m, d] = iso.slice(0, 10).split('-');
    const hora = iso.length > 10 ? ` ${iso.slice(11, 16)}` : '';
    return `${d}/${m}/${y}${hora}`;
  }
}
