import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, finalize } from 'rxjs';
import saveAs from 'file-saver';
import Swal from 'sweetalert2';

import { SharedModule } from '@/app/shared/shared.module';
import { ColumnaTabla, TABLA_ESTANDAR } from '@/app/shared/components/tabla-estandar';
import { SedeScopeService } from '@/app/shared/services/sede-scope/sede-scope.service';
import { SedesSeleccionService } from '@/app/shared/services/sedes-seleccion/sedes-seleccion.service';
import { ReportePresentadosService } from '../../service/reporte-presentados/reporte-presentados.service';
import {
  ConteoOficinaPresentados,
  ESTADOS_PRESENTADO,
  EstadoPresentado,
  FilaPresentado,
  FiltrosPresentados,
  RespuestaPresentados,
  etiquetaEstado,
  filtrosIniciales,
  nombreArchivoPresentados,
  pct,
} from '../../service/reporte-presentados/reporte-presentados.util';

/** Tope del rango en días contando ambos extremos: el mismo que aplica ms-hr (400 si se pasa). */
const MAX_DIAS_RANGO = 93;

/** Días de `desde` a `hasta` (YYYY-MM-DD) contando ambos extremos; null si falta alguna fecha. */
function diasDelRango(desde: string, hasta: string): number | null {
  if (!desde || !hasta) return null;
  const a = Date.parse(`${desde}T00:00:00Z`);
  const b = Date.parse(`${hasta}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * Reporte del personal que se presenta en la temporal (pedido #8, 24-sep-2026).
 *
 * Una fila por entrevista del rango (fecha en que la persona se presentó) con su veredicto:
 * APLICA / NO APLICA / EN ESPERA de vacante, o SIN CLASIFICAR si el evaluador no lo marcó.
 * Los chips de estado muestran el conteo del rango y además filtran la tabla; debajo va el
 * conteo por oficina. ms-hr recorta por el alcance de sedes: cada quien ve sus oficinas.
 *
 * La tabla va en modo servidor (un mes de importación masiva pasa de 29.000 entrevistas).
 */
@Component({
  selector: 'app-reporte-presentados',
  standalone: true,
  imports: [SharedModule, ...TABLA_ESTANDAR],
  templateUrl: './reporte-presentados.component.html',
  styleUrl: './reporte-presentados.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportePresentadosComponent implements OnInit {
  private readonly api = inject(ReportePresentadosService);
  private readonly sedeScope = inject(SedeScopeService);
  private readonly sedesSeleccion = inject(SedesSeleccionService);
  private readonly destroyRef = inject(DestroyRef);
  private cargaEnCurso?: Subscription;
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly estados = ESTADOS_PRESENTADO;
  readonly pct = pct;

  /** Filtros de la consulta (ngModel); se aplican con `buscar()`. */
  filtros: FiltrosPresentados = filtrosIniciales();

  readonly respuesta = signal<RespuestaPresentados | null>(null);
  readonly cargando = signal(false);
  readonly descargando = signal(false);
  readonly error = signal('');
  readonly page = signal(0);
  readonly size = signal(50);
  /** Estado activo (chip) para pintar el resaltado sin depender del ngModel. */
  readonly estadoActivo = signal<EstadoPresentado | ''>('');

  /** Oficinas del selector: las que Selección ofrece, dentro de su alcance. */
  readonly oficinas = signal<string[]>([]);

  readonly filas = computed(() => this.respuesta()?.filas ?? []);
  readonly total = computed(() => this.respuesta()?.total ?? 0);
  readonly kpis = computed(() => this.respuesta()?.kpis ?? null);
  readonly porOficina = computed(() => this.kpis()?.por_oficina ?? []);

  readonly columnas: ColumnaTabla<FilaPresentado>[] = [
    {
      id: 'fecha', header: 'Fecha', ordenable: false, ancho: '140px',
      valor: (f) => f.fecha ?? '',
      formato: (f) => formatoFecha(f.fecha),
      tarjeta: 'meta',
    },
    { id: 'oficina', header: 'Oficina', ordenable: false, valor: (f) => f.oficina ?? '', tarjeta: 'subtitulo' },
    { id: 'cedula', header: 'Cédula', ordenable: false, valor: (f) => f.cedula ?? '', prioridad: 1 },
    { id: 'nombre', header: 'Nombre', ordenable: false, valor: (f) => f.nombre ?? '', tarjeta: 'titulo', minAncho: '200px' },
    {
      id: 'estado', header: 'Estado', ordenable: false, align: 'center', tarjeta: 'badge',
      valor: (f) => etiquetaEstado(f.estado),
      badge: (f) => {
        const e = ESTADOS_PRESENTADO.find((x) => x.id === f.estado);
        return e ? { texto: e.etiqueta, tono: e.tono, icono: e.icono } : null;
      },
    },
    { id: 'motivo', header: 'Motivo', ordenable: false, valor: (f) => f.motivo ?? '', formato: (f) => f.motivo || '—', prioridad: 2, tarjeta: 'cuerpo', minAncho: '180px' },
    { id: 'evaluador', header: 'Evaluador', ordenable: false, valor: (f) => f.evaluador ?? '', formato: (f) => f.evaluador || '—', prioridad: 3 },
    {
      id: 'cargo', header: 'Vacante / cargo', ordenable: false, prioridad: 2, minAncho: '180px',
      valor: (f) => [f.cargo, f.cargo_especifico].filter(Boolean).join(' — '),
      formato: (f) => [f.cargo, f.cargo_especifico].filter(Boolean).join(' — ') || '—',
    },
    { id: 'empresa', header: 'Empresa usuaria', ordenable: false, valor: (f) => f.empresa_usuaria ?? '', formato: (f) => f.empresa_usuaria || '—', prioridad: 3 },
  ];
  readonly idFila = (f: FilaPresentado) => f.entrevista_id ?? `${f.cedula}-${f.fecha}`;

  readonly columnasOficina: ColumnaTabla<ConteoOficinaPresentados>[] = [
    { id: 'oficina', header: 'Oficina', valor: (o) => o.oficina, tarjeta: 'titulo' },
    { id: 'total', header: 'Presentados', align: 'right', valor: (o) => o.total },
    ...ESTADOS_PRESENTADO.map((e) => ({
      id: e.id, header: e.etiqueta, align: 'right' as const,
      valor: (o: ConteoOficinaPresentados) => o[e.id] ?? 0,
    })),
  ];
  readonly idOficina = (o: ConteoOficinaPresentados) => o.oficina;
  readonly pieOficina = (filas: ConteoOficinaPresentados[]) => {
    const suma = (k: keyof ConteoOficinaPresentados) =>
      filas.reduce((acc, o) => acc + (Number(o[k]) || 0), 0);
    const pie: Record<string, number> = { total: suma('total') };
    for (const e of ESTADOS_PRESENTADO) pie[e.id] = suma(e.id);
    return pie;
  };

  ngOnInit(): void {
    if (!this.isBrowser) return;
    // Pedido #3: solo las oficinas que Selección ofrece (sin ANDES ni MONTE_VERDE), y de
    // esas las de su alcance. Los datos viejos de esas oficinas siguen saliendo en "Todas".
    this.sedesSeleccion.nombres()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((nombres) => this.oficinas.set(this.sedeScope.opciones(nombres)));
    this.cargar();
  }

  /** Aplica los filtros desde la primera página. */
  buscar(): void {
    if (this.filtros.desde && this.filtros.hasta && this.filtros.hasta < this.filtros.desde) {
      this.error.set('La fecha final es anterior a la inicial.');
      return;
    }
    if (this.rangoExcedido()) return;
    this.page.set(0);
    this.cargar();
  }

  /** Chip de estado: filtra la tabla (otro clic sobre el mismo lo quita). */
  filtrarEstado(e: EstadoPresentado | ''): void {
    const nuevo = this.filtros.estado === e ? '' : e;
    this.filtros = { ...this.filtros, estado: nuevo };
    this.estadoActivo.set(nuevo);
    this.buscar();
  }

  paginar(e: { pagina: number; porPagina: number }): void {
    this.page.set(e.pagina);
    // "Todas" (0) no aplica en modo servidor: el backend topa en 500.
    this.size.set(e.porPagina > 0 ? Math.min(e.porPagina, 500) : 500);
    this.cargar();
  }

  /** true (y deja el mensaje) si el rango pasa del tope del servidor. */
  private rangoExcedido(): boolean {
    const dias = diasDelRango(this.filtros.desde, this.filtros.hasta);
    if (dias !== null && dias > MAX_DIAS_RANGO) {
      this.error.set(`El rango no puede pasar de ${MAX_DIAS_RANGO} días (unos 3 meses). Divida la consulta en rangos más cortos.`);
      return true;
    }
    return false;
  }

  cargar(): void {
    // Con clics rápidos en chips o páginas, la respuesta vieja no debe pisar a la nueva.
    this.cargaEnCurso?.unsubscribe();
    this.cargando.set(true);
    this.error.set('');
    this.cargaEnCurso = this.api.consultar(this.filtros, this.page(), this.size())
      .pipe(finalize(() => this.cargando.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => this.respuesta.set(r),
        error: (err) => {
          this.respuesta.set(null);
          this.error.set(
            err?.status === 403
              ? 'No tiene acceso a esa oficina.'
              : err?.error?.message || 'No se pudo cargar el reporte.',
          );
        },
      });
  }

  descargarExcel(): void {
    if (this.rangoExcedido()) return;
    this.descargando.set(true);
    this.api.excel(this.filtros)
      .pipe(finalize(() => this.descargando.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resp) => {
          if (!resp.body) return;
          saveAs(resp.body, nombreArchivoPresentados(resp.headers.get('Content-Disposition'), this.filtros));
        },
        error: () => {
          Swal.fire({ icon: 'error', title: 'No se pudo generar el Excel', text: 'Intente de nuevo en un momento.' });
        },
      });
  }

  conteo(e: EstadoPresentado): number {
    return this.kpis()?.por_estado?.[e] ?? 0;
  }
}

/** '2026-09-25T19:23:38' → '25/09/2026 19:23'. */
function formatoFecha(v: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : (v || '—');
}
