import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subject, catchError, debounceTime, distinctUntilChanged, of, switchMap, tap } from 'rxjs';

import { ReunionesService } from '../../services/reuniones.service';
import {
  CoincidenciaGlobal, CrearReunion, EstadoReunion, Persona, ResultadoBusquedaGlobal, ReunionResumen,
} from '../../models/reunion.model';
import { AvatarHablanteComponent } from '../../components/avatar-hablante/avatar-hablante.component';
import { estadoReunionHumano } from '../../utils/estado';
import { colorVar, idxDeClave } from '../../utils/hablantes';
import { fragmentoAlrededor, mensajeError, nombreCorto, normalizar, partirCoincidencias } from '../../utils/texto';
import { duracionHumana, fechaCorta, porcentaje, reloj } from '../../utils/tiempo';

type Pestana = 'reuniones' | 'personas';

/** Mínimo de letras para buscar en todo lo transcrito. */
export const MINIMO_BUSQUEDA = 3;
export const ESPERA_BUSQUEDA_MS = 350;

/**
 * Inicio de Reuniones: el buscador en TODO lo que se ha dicho es lo principal; debajo,
 * las reuniones (con quién habló y de qué) y el directorio de personas.
 *
 * La pestaña y la búsqueda viven en la URL (`?vista=personas`, `?q=`, `?persona=`): al
 * abrir un resultado y volver atrás, la persona encuentra lo que estaba mirando.
 * El alta pide sólo lo imprescindible; el resto se completa dentro de la reunión.
 */
@Component({
  selector: 'app-reuniones-list',
  standalone: true,
  imports: [RouterLink, MatIconModule, MatTooltipModule, AvatarHablanteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reuniones-list.component.html',
  styleUrls: ['../../estilos/paleta-hablantes.css', '../../estilos/base.css', './reuniones-list.component.css'],
})
export class ReunionesListComponent {
  private readonly api = inject(ReunionesService);
  private readonly router = inject(Router);

  /** Query params (withComponentInputBinding). */
  readonly vista = input<string | undefined>(undefined);
  readonly q = input<string | undefined>(undefined);
  readonly persona = input<string | undefined>(undefined);

  readonly pestana = computed<Pestana>(() => (this.vista() === 'personas' ? 'personas' : 'reuniones'));

  // ── Reuniones ─────────────────────────────────────────────────────────────
  readonly reuniones = signal<ReunionResumen[]>([]);
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly total = signal(0);
  readonly pagina = signal(0);
  readonly filtroTexto = signal('');
  readonly filtroEstado = signal<'' | EstadoReunion>('');
  readonly hayMas = computed(() => this.reuniones().length < this.total());

  // ── Alta ──────────────────────────────────────────────────────────────────
  readonly creando = signal(false);
  readonly guardando = signal(false);
  readonly errorAlta = signal('');
  readonly nueva = signal<CrearReunion>(this.reunionVacia());

  // ── Búsqueda global ───────────────────────────────────────────────────────
  readonly texto = signal('');
  readonly filtroPersona = signal<string>('');
  readonly resultados = signal<ResultadoBusquedaGlobal | null>(null);
  readonly buscando = signal(false);
  readonly errorBusqueda = signal('');
  private readonly busqueda$ = new Subject<{ q: string; persona: string }>();
  /** Último `q` que esta pantalla escribió en la URL (para no pisar lo que se sigue tecleando). */
  private qEnUrl: string | null = null;

  readonly modoBusqueda = computed(() => normalizar(this.texto()).length >= MINIMO_BUSQUEDA);

  // ── Personas ──────────────────────────────────────────────────────────────
  readonly personas = signal<Persona[]>([]);
  readonly cargandoPersonas = signal(false);
  readonly errorPersonas = signal('');
  readonly filtroPersonas = signal('');
  private personasCargadas = false;

  readonly personasVisibles = computed(() => {
    const f = normalizar(this.filtroPersonas());
    if (!f) return this.personas();
    return this.personas().filter(p =>
      normalizar([p.display_name, p.area, p.position, p.company].filter(Boolean).join(' ')).includes(f));
  });

  readonly ESTADOS: { valor: '' | EstadoReunion; etiqueta: string }[] = [
    { valor: '', etiqueta: 'Todos los estados' },
    { valor: 'BORRADOR', etiqueta: 'Borrador' },
    { valor: 'PROGRAMADA', etiqueta: 'Programada' },
    { valor: 'GRABADA', etiqueta: 'Grabada' },
    { valor: 'PROCESANDO', etiqueta: 'Procesando' },
    { valor: 'EN_REVISION', etiqueta: 'En revisión' },
    { valor: 'CERRADA', etiqueta: 'Cerrada' },
    { valor: 'ERROR', etiqueta: 'Con error' },
  ];

  readonly TIPOS = [
    { valor: 'LEVANTAMIENTO', etiqueta: 'Levantamiento' },
    { valor: 'SEGUIMIENTO', etiqueta: 'Seguimiento' },
    { valor: 'VALIDACION', etiqueta: 'Validación' },
    { valor: 'REVISION_TECNICA', etiqueta: 'Revisión técnica' },
    { valor: 'PRUEBAS', etiqueta: 'Pruebas' },
    { valor: 'CIERRE', etiqueta: 'Cierre' },
  ];

  readonly reloj = reloj;
  readonly fechaCorta = fechaCorta;
  readonly duracionHumana = duracionHumana;
  readonly porcentaje = porcentaje;
  readonly colorVar = colorVar;
  readonly idxDeClave = idxDeClave;
  readonly MINIMO = MINIMO_BUSQUEDA;

  /** Tarjetas ya calculadas: estado humano, voces y leyenda. */
  readonly tarjetas = computed(() => this.reuniones().map(r => {
    const voces = [...(r.speakers ?? [])].sort((a, b) => (b.talk_pct ?? 0) - (a.talk_pct ?? 0));
    return {
      r,
      estado: estadoReunionHumano(r),
      duracion: r.total_duration_ms ? duracionHumana(r.total_duration_ms) : (r.duration_min ? `${r.duration_min} min` : ''),
      voces,
      huella: [...(r.speakers ?? [])].sort((a, b) => (a.color_idx ?? 99) - (b.color_idx ?? 99)),
      leyenda: voces.slice(0, 3).map(v => `${nombreCorto(v.display_name)} ${porcentaje(v.talk_pct)}`).join(' · '),
      temas: (r.topics ?? []).slice(0, 4),
    };
  }));

  /** Resultados agrupados por reunión, con el fragmento y sus partes resaltadas. */
  readonly grupos = computed(() => {
    const r = this.resultados();
    if (!r) return [];
    const q = r.query || this.texto();
    const mapa = new Map<string, {
      meeting_id: string; code: string; name: string; held_on: string | null;
      matches: (CoincidenciaGlobal & { partes: ReturnType<typeof partirCoincidencias> })[];
    }>();
    for (const m of r.matches ?? []) {
      let g = mapa.get(m.meeting_id);
      if (!g) {
        g = { meeting_id: m.meeting_id, code: m.meeting_code, name: m.meeting_name, held_on: m.held_on, matches: [] };
        mapa.set(m.meeting_id, g);
      }
      g.matches.push({ ...m, partes: partirCoincidencias(fragmentoAlrededor(m.text, q), q) });
    }
    return [...mapa.values()];
  });

  constructor() {
    this.cargar();

    this.busqueda$.pipe(
      debounceTime(ESPERA_BUSQUEDA_MS),
      distinctUntilChanged((a, b) => a.q === b.q && a.persona === b.persona),
      tap(({ q, persona }) => this.escribirUrl({ q: q || null, persona: persona || null })),
      switchMap(({ q, persona }) => {
        if (normalizar(q).length < MINIMO_BUSQUEDA) return of(null);
        this.buscando.set(true);
        this.errorBusqueda.set('');
        return this.api.buscarGlobal(q, { persona: persona || null, limit: 100 }).pipe(
          catchError((e) => {
            this.errorBusqueda.set(mensajeError(e, 'No se pudo buscar en las reuniones'));
            return of(null);
          }),
        );
      }),
      takeUntilDestroyed(),
    ).subscribe((r) => {
      this.resultados.set(r);
      this.buscando.set(false);
    });

    // La URL manda cuando cambia desde fuera (atrás/adelante, un enlace compartido).
    effect(() => {
      const q = this.q() ?? '';
      const persona = this.persona() ?? '';
      untracked(() => {
        if (q === (this.qEnUrl ?? '') && persona === this.filtroPersona()) return;
        this.qEnUrl = q;
        this.texto.set(q);
        this.filtroPersona.set(persona);
        if (persona) this.cargarPersonas();
        this.busqueda$.next({ q: q.trim(), persona });
      });
    });

    effect(() => {
      if (this.pestana() === 'personas') untracked(() => this.cargarPersonas());
    });
  }

  // ── Búsqueda global ───────────────────────────────────────────────────────

  alEscribir(valor: string): void {
    this.texto.set(valor);
    if (normalizar(valor).length >= MINIMO_BUSQUEDA) {
      this.buscando.set(true);
      this.cargarPersonas();
    }
    this.busqueda$.next({ q: valor.trim(), persona: this.filtroPersona() });
  }

  cambiarPersonaBusqueda(clave: string): void {
    this.filtroPersona.set(clave);
    this.busqueda$.next({ q: this.texto().trim(), persona: clave });
  }

  limpiarBusqueda(): void {
    this.texto.set('');
    this.filtroPersona.set('');
    this.resultados.set(null);
    this.errorBusqueda.set('');
    this.busqueda$.next({ q: '', persona: '' });
  }

  private escribirUrl(params: { q?: string | null; persona?: string | null; vista?: string | null }): void {
    if ('q' in params) this.qEnUrl = params.q ?? '';
    this.router.navigate([], { queryParams: params, queryParamsHandling: 'merge', replaceUrl: true })
      .catch(() => undefined);
  }

  irAPestana(p: Pestana): void {
    this.router.navigate([], {
      queryParams: { vista: p === 'personas' ? 'personas' : null },
      queryParamsHandling: 'merge',
    }).catch(() => undefined);
  }

  // ── Reuniones ─────────────────────────────────────────────────────────────

  cargar(pagina = 0): void {
    this.cargando.set(true);
    this.error.set('');
    this.api.listar({
      q: this.filtroTexto() || undefined,
      status: this.filtroEstado() || undefined,
      page: pagina,
      size: 20,
    }).subscribe({
      next: (p) => {
        this.reuniones.set(pagina === 0 ? p.content : [...this.reuniones(), ...p.content]);
        this.total.set(p.totalElements ?? p.page?.totalElements ?? p.content.length);
        this.pagina.set(p.number ?? p.page?.number ?? pagina);
        this.cargando.set(false);
      },
      error: (e) => {
        this.error.set(mensajeError(e, 'No se pudieron cargar las reuniones'));
        this.cargando.set(false);
      },
    });
  }

  filtrar(): void { this.cargar(0); }
  masResultados(): void { this.cargar(this.pagina() + 1); }

  // ── Personas ──────────────────────────────────────────────────────────────

  cargarPersonas(forzar = false): void {
    if ((this.personasCargadas && !forzar) || this.cargandoPersonas()) return;
    this.cargandoPersonas.set(true);
    this.errorPersonas.set('');
    this.api.personas().subscribe({
      next: (ps) => {
        this.personas.set(ps ?? []);
        this.personasCargadas = true;
        this.cargandoPersonas.set(false);
      },
      error: (e) => {
        this.errorPersonas.set(mensajeError(e, 'No se pudo cargar el directorio de personas'));
        this.cargandoPersonas.set(false);
      },
    });
  }

  cargoDe(p: Persona): string {
    return [p.position, p.area, p.company].filter(Boolean).join(' · ');
  }

  // ── Alta ──────────────────────────────────────────────────────────────────

  abrirAlta(): void {
    this.nueva.set(this.reunionVacia());
    this.errorAlta.set('');
    this.creando.set(true);
  }

  cerrarAlta(): void { this.creando.set(false); }

  crear(): void {
    const datos = this.nueva();
    if (!datos.name?.trim()) {
      this.errorAlta.set('Ponle un nombre a la reunión.');
      return;
    }
    this.guardando.set(true);
    this.errorAlta.set('');
    this.api.crear({ ...datos, name: datos.name.trim() }).subscribe({
      next: (detalle) => {
        this.guardando.set(false);
        this.creando.set(false);
        this.router.navigate(['/dashboard/reuniones', detalle.resumen.id]);
      },
      error: (e) => {
        this.guardando.set(false);
        this.errorAlta.set(mensajeError(e, 'No se pudo crear la reunión'));
      },
    });
  }

  actualizarCampo<K extends keyof CrearReunion>(campo: K, valor: CrearReunion[K]): void {
    this.nueva.update(r => ({ ...r, [campo]: valor }));
  }

  private reunionVacia(): CrearReunion {
    const hoy = new Date();
    const iso = `${hoy.getFullYear()}-${`${hoy.getMonth() + 1}`.padStart(2, '0')}-${`${hoy.getDate()}`.padStart(2, '0')}`;
    return {
      name: '',
      meeting_type: 'LEVANTAMIENTO',
      modality: 'VIRTUAL',
      held_on: iso,
      objective: '',
      confidentiality: 'INTERNA',
    };
  }
}
