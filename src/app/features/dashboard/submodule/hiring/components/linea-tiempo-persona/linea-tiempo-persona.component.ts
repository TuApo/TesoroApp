import {
  ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Subscription } from 'rxjs';

import {
  EventoLineaTiempo, LineaTiempoPagina, LineaTiempoService, TipoEventoLinea,
} from '../../service/linea-tiempo/linea-tiempo.service';
import {
  GrupoDia, TIPOS_LINEA, agruparPorDia, alternarTipo, etiquetaTipo, horaDe, hoyBogota, iconoDe,
} from './linea-tiempo.util';

/** Lo que se cuenta de la persona al terminar la primera carga (para el título del diálogo). */
export interface PersonaLineaTiempo {
  numero_documento: string;
  nombre: string | null;
  encontrado: boolean;
  total: number;
}

interface ChipTipo {
  tipo: TipoEventoLinea;
  etiqueta: string;
  icono: string;
  n: number;
  activo: boolean;
}

/**
 * Línea de tiempo de una persona (pedido #13, Fase 1: solo lectura).
 *
 * Todo lo que ha pasado con ella, del más reciente al más viejo: cada etapa de
 * cada proceso (entrevista, aplica / no aplica / en espera, prueba, examen,
 * contratación, ingreso, retiro, rechazo), vetos, incapacidades (solo fechas y
 * días) y cambios de datos. Antes eso estaba repartido entre el Historial
 * laboral (una fila por proceso), el módulo de vetados y el de incapacidades.
 *
 * El servidor ordena, filtra y pagina; aquí solo se agrupa por día y se pinta.
 * Los chips filtran por tipo y cada cambio de filtro vuelve a la página 0.
 */
@Component({
  selector: 'app-linea-tiempo-persona',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule, MatProgressSpinnerModule],
  templateUrl: './linea-tiempo-persona.component.html',
  styleUrls: ['./linea-tiempo-persona.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineaTiempoPersonaComponent {
  private readonly api = inject(LineaTiempoService);

  /** Cédula de la persona, como se tecleó (acepta la X inicial). */
  readonly documento = input.required<string>();
  /** Hitos por página. */
  readonly tamano = input<number>(30);

  readonly personaCargada = output<PersonaLineaTiempo>();

  readonly eventos = signal<EventoLineaTiempo[]>([]);
  readonly meta = signal<LineaTiempoPagina | null>(null);
  readonly estado = signal<'cargando' | 'listo' | 'error'>('cargando');
  readonly error = signal<string | null>(null);
  readonly cargandoMas = signal(false);
  readonly errorMas = signal<string | null>(null);
  /** `[]` = todos. */
  readonly tiposActivos = signal<TipoEventoLinea[]>([]);

  /** Se toma una vez: una línea de tiempo abierta no cruza la medianoche de forma relevante. */
  private readonly hoy = hoyBogota();

  readonly grupos = computed<GrupoDia[]>(() => agruparPorDia(this.eventos(), this.hoy));

  readonly total = computed(() => this.meta()?.total ?? 0);

  /** Chips con al menos un hito (o prendidos), con su conteo SIN filtrar. */
  readonly chips = computed<ChipTipo[]>(() => {
    const porTipo: Partial<Record<TipoEventoLinea, number>> = this.meta()?.por_tipo ?? {};
    const activos = new Set(this.tiposActivos());
    return TIPOS_LINEA
      .map((t) => ({ ...t, n: porTipo[t.tipo] ?? 0, activo: activos.has(t.tipo) }))
      .filter((c) => c.n > 0 || c.activo);
  });

  readonly avisos = computed(() => this.meta()?.avisos ?? []);
  readonly notas = computed(() => this.meta()?.notas ?? []);
  readonly hayMas = computed(() => !!this.meta()?.hay_mas);
  readonly filtrando = computed(() => this.tiposActivos().length > 0);

  /** Petición en curso: al cambiar de filtro o de persona se cancela la anterior. */
  private solicitud?: Subscription;
  private pagina = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.solicitud?.unsubscribe());

    // Nueva persona = empezar de cero. `untracked` para que la carga no quede
    // suscrita a las señales que toca por dentro (ver tormenta de 429).
    effect(() => {
      this.documento();
      untracked(() => {
        this.tiposActivos.set([]);
        this.recargar();
      });
    });
  }

  // ── Acciones ────────────────────────────────────────────────────────────

  alternar(tipo: TipoEventoLinea): void {
    this.tiposActivos.set(alternarTipo(this.tiposActivos(), tipo));
    this.recargar();
  }

  verTodo(): void {
    if (!this.tiposActivos().length) return;
    this.tiposActivos.set([]);
    this.recargar();
  }

  recargar(): void {
    this.pagina = 0;
    this.estado.set('cargando');
    this.error.set(null);
    this.errorMas.set(null);
    this.cargandoMas.set(false);
    this.pedir(0, (r) => {
      this.eventos.set(r.results ?? []);
      this.meta.set(r);
      this.estado.set('listo');
      this.personaCargada.emit({
        numero_documento: r.numero_documento,
        nombre: r.nombre,
        encontrado: r.encontrado,
        total: r.total,
      });
    }, (msg) => {
      this.error.set(msg);
      this.estado.set('error');
    });
  }

  cargarMas(): void {
    if (this.cargandoMas() || !this.hayMas()) return;
    const siguiente = this.pagina + 1;
    this.cargandoMas.set(true);
    this.errorMas.set(null);
    this.pedir(siguiente, (r) => {
      this.pagina = siguiente;
      this.eventos.update((prev) => [...prev, ...(r.results ?? [])]);
      this.meta.set(r);
      this.cargandoMas.set(false);
    }, (msg) => {
      this.errorMas.set(msg);
      this.cargandoMas.set(false);
    });
  }

  // ── Presentación ────────────────────────────────────────────────────────

  icono(e: EventoLineaTiempo): string { return iconoDe(e); }
  hora(e: EventoLineaTiempo): string | null { return horaDe(e); }
  etiquetaTipo(t: TipoEventoLinea): string { return etiquetaTipo(t); }

  // ── Privado ─────────────────────────────────────────────────────────────

  private pedir(
    page: number,
    ok: (r: LineaTiempoPagina) => void,
    fallo: (msg: string) => void,
  ): void {
    const doc = (this.documento() ?? '').trim();
    this.solicitud?.unsubscribe();
    if (!doc) {
      fallo('No hay un documento para consultar.');
      return;
    }
    this.solicitud = this.api.obtener(doc, {
      page,
      size: this.tamano(),
      tipos: this.tiposActivos(),
    }).subscribe({
      next: ok,
      error: (err: unknown) => fallo(this.mensaje(err)),
    });
  }

  private mensaje(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) return 'Sin conexión con el servidor. Revisa la red e intenta de nuevo.';
      if (err.status === 400) return 'El documento no es válido.';
      if (err.status === 401 || err.status === 403) return 'Tu sesión no tiene permiso para ver esta información.';
    }
    return 'No se pudo cargar la línea de tiempo. Intenta de nuevo.';
  }
}
