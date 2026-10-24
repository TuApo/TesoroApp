import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';

import { ETIQUETA_ALERTA, ETIQUETA_ROSTRO, EstadoRostro, FuenteUbicacion, Marcacion } from '../../campo.models';
import { CampoApiService } from '../../services/campo-api.service';
import { horaCorta, hoyIso, mensajeDe } from '../../services/campo.service';

type Pestana = 'TODAS' | 'POR_REVISAR' | 'VALIDADAS' | 'SIN_SELFIE';

/** Estados que piden ojo humano: la comparación falló o no hay contra qué comparar. */
const POR_REVISAR: ReadonlySet<EstadoRostro> = new Set<EstadoRostro>(['NO_COINCIDE', 'ERROR', 'SIN_REFERENCIA']);
const VALIDADAS: ReadonlySet<EstadoRostro> = new Set<EstadoRostro>(['VALIDADA', 'APROBADA_MANUAL']);

const LIMITE = 300;
const DIA_MS = 86_400_000;

const ETIQUETA_FUENTE: Record<FuenteUbicacion, string> = {
  GPS: 'GPS', RED: 'Red celular o Wi-Fi', MAPA: 'Punto elegido en el mapa', NINGUNA: 'Sin ubicación',
};

/** Medianoche de Bogotá (UTC-5 fijo, Colombia no tiene horario de verano) en epoch ms. */
function inicioDiaBogota(iso: string): number {
  return Date.parse(`${iso}T00:00:00-05:00`);
}

function sinTildes(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/** "2 h 5 min", "12 min", "3 d 4 h": cuánto tardó en llegar algo marcado sin señal. */
function duracion(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 24) return m ? `${h} h ${m} min` : `${h} h`;
  const d = Math.floor(h / 24), hr = h % 24;
  return hr ? `${d} d ${hr} h` : `${d} d`;
}

/**
 * Revisión de marcaciones (`/dashboard/campo/revision`) para supervisores.
 *
 * Lista las entradas y salidas del rango con su selfie, ubicación y alertas, y deja
 * resolver a mano las que la validación de rostro no pudo: aprobar, aprobar y dejar la
 * selfie como foto de referencia (cuando la persona aún no tenía), o marcar que no es la
 * persona. La respuesta del servidor reemplaza la tarjeta.
 *
 * El servidor filtra por rango (y por "sin selfie"); "por revisar", "validadas", "solo con
 * alertas" y la búsqueda se hacen aquí sobre lo traído.
 */
@Component({
  selector: 'app-revision-campo',
  standalone: true,
  imports: [MatIconModule],
  templateUrl: './revision.component.html',
  styleUrls: ['../../campo-ui.css', './revision.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RevisionComponent {
  private readonly api = inject(CampoApiService);
  private readonly destroy = inject(DestroyRef);

  readonly etiquetaAlerta = ETIQUETA_ALERTA;
  readonly etiquetaRostro = ETIQUETA_ROSTRO;
  readonly etiquetaFuente = ETIQUETA_FUENTE;
  readonly limite = LIMITE;
  readonly pestanas: { valor: Pestana; nombre: string }[] = [
    { valor: 'TODAS', nombre: 'Todas' },
    { valor: 'POR_REVISAR', nombre: 'Por revisar' },
    { valor: 'VALIDADAS', nombre: 'Validadas' },
    { valor: 'SIN_SELFIE', nombre: 'Sin selfie' },
  ];

  readonly hoy = hoyIso();
  readonly desde = signal(this.hoy);
  readonly hasta = signal(this.hoy);
  readonly pestana = signal<Pestana>('POR_REVISAR');
  readonly soloAlertas = signal(false);
  readonly busqueda = signal('');

  readonly marcaciones = signal<Marcacion[]>([]);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  /** Ids con una acción en vuelo. */
  readonly enProceso = signal<ReadonlySet<string>>(new Set());
  /** La tarjeta que está pidiendo confirmación de "No es la persona". */
  readonly confirmando = signal<string | null>(null);
  readonly errores = signal<Record<string, string>>({});

  private peticion: Subscription | null = null;

  /** Varios días: entonces cada tarjeta muestra también la fecha. */
  readonly variosDias = computed(() => this.desde() !== this.hasta());

  readonly porRevisar = computed(() => this.marcaciones().filter(m => POR_REVISAR.has(m.rostro_estado)).length);

  readonly visibles = computed(() => {
    const p = this.pestana();
    const q = sinTildes(this.busqueda().trim());
    const alertas = this.soloAlertas();
    return this.marcaciones().filter(m => {
      if (p === 'POR_REVISAR' && !POR_REVISAR.has(m.rostro_estado)) return false;
      if (p === 'VALIDADAS' && !VALIDADAS.has(m.rostro_estado)) return false;
      if (p === 'SIN_SELFIE' && m.rostro_estado !== 'SIN_SELFIE' && m.selfie_url) return false;
      if (alertas && !m.alertas?.length) return false;
      if (q && !sinTildes(`${m.usuario_nombre} ${m.finca_nombre ?? ''}`).includes(q)) return false;
      return true;
    });
  });

  constructor() {
    this.cargar();
    this.destroy.onDestroy(() => this.peticion?.unsubscribe());
  }

  cargar(): void {
    const d = this.desde() || this.hoy;
    const h = this.hasta() && this.hasta() >= d ? this.hasta() : d;
    this.peticion?.unsubscribe();
    this.cargando.set(true);
    this.error.set(null);
    this.peticion = this.api.marcaciones({
      desdeMs: inicioDiaBogota(d),
      hastaMs: inicioDiaBogota(h) + DIA_MS,
      rostro: this.pestana() === 'SIN_SELFIE' ? 'SIN_SELFIE' : '',
      limite: LIMITE,
    }).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: l => {
        this.marcaciones.set([...l].sort((a, b) => b.capturado_ms - a.capturado_ms));
        this.cargando.set(false);
      },
      error: e => {
        this.marcaciones.set([]);
        this.error.set(mensajeDe(e, 'No se pudieron cargar las marcaciones'));
        this.cargando.set(false);
      },
    });
  }

  cambiarDesde(v: string): void {
    this.desde.set(v);
    if (v && this.hasta() < v) this.hasta.set(v);
    this.cargar();
  }

  cambiarHasta(v: string): void {
    this.hasta.set(v);
    if (v && this.desde() > v) this.desde.set(v);
    this.cargar();
  }

  atajo(dias: number): void {
    const fin = this.hoy;
    const ini = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' })
      .format(new Date(inicioDiaBogota(fin) - (dias - 1) * DIA_MS + 12 * 3_600_000));
    this.desde.set(ini);
    this.hasta.set(fin);
    this.cargar();
  }

  elegirPestana(p: Pestana): void {
    const antes = this.pestana();
    this.pestana.set(p);
    // Solo "sin selfie" filtra en el servidor: entrar o salir de ella pide otra consulta.
    if ((antes === 'SIN_SELFIE') !== (p === 'SIN_SELFIE')) this.cargar();
  }

  revisar(m: Marcacion, aprobada: boolean, usarComoReferencia = false): void {
    if (this.enProceso().has(m.id)) return;
    this.confirmando.set(null);
    this.enProceso.update(s => new Set(s).add(m.id));
    this.errores.update(e => { const n = { ...e }; delete n[m.id]; return n; });
    this.api.revisarRostro(m.id, aprobada, usarComoReferencia).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: r => {
        this.marcaciones.update(l => l.map(x => x.id === m.id ? r : x));
        this.quitarProceso(m.id);
      },
      error: e => {
        this.errores.update(x => ({ ...x, [m.id]: mensajeDe(e, 'No se pudo guardar la revisión') }));
        this.quitarProceso(m.id);
      },
    });
  }

  private quitarProceso(id: string): void {
    this.enProceso.update(s => { const n = new Set(s); n.delete(id); return n; });
  }

  // ─── Ayudas de la plantilla ─────────────────────────────────────────────

  pideRevision(m: Marcacion): boolean { return POR_REVISAR.has(m.rostro_estado); }
  validada(m: Marcacion): boolean { return VALIDADAS.has(m.rostro_estado); }

  selfie(m: Marcacion): string | null { return this.api.absoluta(m.selfie_url); }

  hora(ms: number): string { return horaCorta(ms); }

  fecha(ms: number): string {
    return new Date(ms).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/Bogota' });
  }

  retraso(m: Marcacion): string { return duracion(m.recibido_ms - m.capturado_ms); }

  distancia(m: number | null): string {
    if (m == null) return '';
    return m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`;
  }

  confianza(c: number | null): string {
    if (c == null) return '';
    return `${Math.round(c <= 1 ? c * 100 : c)} %`;
  }

  claseRostro(e: EstadoRostro): string {
    if (VALIDADAS.has(e)) return 'ok';
    if (e === 'NO_COINCIDE' || e === 'ERROR') return 'mal';
    if (e === 'SIN_REFERENCIA' || e === 'SIN_SELFIE') return 'aviso';
    return 'info';
  }

  iniciales(nombre: string): string {
    const p = nombre.trim().split(/\s+/).filter(Boolean);
    return ((p[0]?.[0] ?? '?') + (p.length > 2 ? p[2][0] : p[1]?.[0] ?? '')).toUpperCase();
  }

  leerTexto(e: Event): string { return (e.target as HTMLInputElement).value; }
  leerMarca(e: Event): boolean { return (e.target as HTMLInputElement).checked; }
}
