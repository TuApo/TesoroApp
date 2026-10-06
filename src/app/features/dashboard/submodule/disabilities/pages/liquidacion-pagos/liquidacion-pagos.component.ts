/**
 * Submodulo "Pagos" de Liquidacion (reunion funcional 2026-10-05): lo que cada EPS pago por
 * incapacidad, con el soporte contable del extracto (la contabilidad va EN la plantilla de pagos,
 * no en un modulo aparte). Los pagos nacen al aplicar una carga en Liquidacion; aqui se consultan,
 * se exportan y, si hubo un error, se anulan uno a uno (ms-hr recalcula el estado).
 *
 * El KPI "Valor total" es la suma de TODO el filtro (`valorTotal` del backend), no de la pagina.
 */
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import Swal from 'sweetalert2';
import type * as XLSX from 'xlsx';

import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';
import { IncapacidadSaludService } from '../../services/incapacidad-salud/incapacidad-salud.service';
import { IncapacidadV2Service } from '../../services/incapacidad-v2/incapacidad-v2.service';
import { FiltrosPagos, PagoItem } from '../../models/incapacidad-salud.model';
import { aIsoCorto } from '../../utils/fechas';
import {
  MAX_PAGINAS_EXPORT,
  RUTA_LIQUIDACION,
  TAMANO_PAGINA_EXPORT,
  codigoVisible,
  entero,
  escaparHtml,
  escribirLibro,
  fechaComoDate,
  fechaCorta,
  fechaHora,
  libroDeFilas,
  marcaDeTiempo,
  mensajeDeError,
  pesos,
  traerTodasLasPaginas,
} from '../liquidacion/liquidacion.utils';

/** Filtros del formulario (las fechas como `Date` del datepicker). */
export interface FormularioPagos {
  q: string;
  eps: string;
  desde: Date | null;
  hasta: Date | null;
}

/** Filtros del formulario -> parametros del backend (fechas en yyyy-MM-dd sin desfase). */
export function filtrosDePagos(f: FormularioPagos, cargaId: number | null): FiltrosPagos {
  const filtros: FiltrosPagos = {};
  if (f.q.trim()) filtros.q = f.q.trim();
  if (f.eps.trim()) filtros.eps = f.eps.trim();
  const desde = aIsoCorto(f.desde);
  const hasta = aIsoCorto(f.hasta);
  if (desde) filtros.desde = desde;
  if (hasta) filtros.hasta = hasta;
  if (cargaId) filtros.cargaId = cargaId;
  return filtros;
}

@Component({
  selector: 'app-liquidacion-pagos',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatTooltipModule,
    ...TABLA_ESTANDAR,
  ],
  providers: [provideNativeDateAdapter(), { provide: MAT_DATE_LOCALE, useValue: 'es-CO' }],
  templateUrl: './liquidacion-pagos.component.html',
  styleUrls: ['../gestion-incapacidades.comun.css', './liquidacion-pagos.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiquidacionPagosComponent implements OnInit {
  private readonly srv = inject(IncapacidadSaludService);
  private readonly srvV2 = inject(IncapacidadV2Service);
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly rutaLiquidacion = RUTA_LIQUIDACION;

  formulario: FormularioPagos = { q: '', eps: '', desde: null, hasta: null };
  /** Filtro por carga (llega desde el historial de Liquidacion con `?cargaId=`). */
  readonly cargaId = signal<number | null>(null);

  readonly filas = signal<PagoItem[]>([]);
  readonly total = signal(0);
  readonly valorTotal = signal(0);
  readonly pagina = signal(0);
  readonly tamano = signal(50);
  readonly cargando = signal(false);
  readonly exportando = signal(false);
  readonly error = signal('');
  readonly epsOpciones = signal<string[]>([]);

  readonly pesos = pesos;
  readonly entero = entero;

  readonly columnas: ColumnaTabla<PagoItem>[] = [
    { id: 'codigo', header: 'Código', ordenable: false, tarjeta: 'subtitulo', valor: (p) => codigoVisible(p.incapacidad) },
    { id: 'cedula', header: 'Cédula', ordenable: false, tarjeta: 'meta', valor: (p) => p.incapacidad?.cedula ?? '' },
    { id: 'nombre', header: 'Nombre', ordenable: false, tarjeta: 'titulo', minAncho: '180px', valor: (p) => p.incapacidad?.nombreCompleto ?? '' },
    { id: 'eps', header: 'EPS', ordenable: false, tarjeta: 'meta', minAncho: '120px', valor: (p) => p.eps ?? p.incapacidad?.eps ?? '' },
    { id: 'fechaInicio', header: 'Fecha inicio', ordenable: false, prioridad: 2, tarjeta: 'meta',
      valor: (p) => fechaComoDate(p.incapacidad?.fechaInicio), formato: (p) => fechaCorta(p.incapacidad?.fechaInicio) || '—',
      copiaTexto: (p) => fechaCorta(p.incapacidad?.fechaInicio) },
    { id: 'valor', header: 'Valor pagado', ordenable: false, align: 'right', tarjeta: 'badge',
      valor: (p) => p.valorPagado, formato: (p) => pesos(p.valorPagado), copiaTexto: (p) => String(p.valorPagado ?? '') },
    { id: 'diasLiquidados', header: 'Días liquidados', ordenable: false, align: 'right', prioridad: 2, tarjeta: 'meta', valor: (p) => p.diasLiquidados },
    { id: 'diasAutorizados', header: 'Días autorizados', ordenable: false, align: 'right', prioridad: 3, tarjeta: 'meta', valor: (p) => p.diasAutorizados },
    { id: 'fechaPago', header: 'Fecha de pago', ordenable: false, tarjeta: 'meta',
      valor: (p) => fechaComoDate(p.fechaPago), formato: (p) => fechaCorta(p.fechaPago) || '—', copiaTexto: (p) => fechaCorta(p.fechaPago) },
    { id: 'numeroEps', header: 'N° incapacidad EPS', ordenable: false, prioridad: 2, tarjeta: 'meta',
      valor: (p) => p.numeroIncapacidadEps ?? '', formato: (p) => p.numeroIncapacidadEps || '—' },
    { id: 'soporte', header: 'Soporte contable', ordenable: false, prioridad: 2, tarjeta: 'meta',
      valor: (p) => p.soporteContable ?? '', formato: (p) => p.soporteContable || '—' },
    { id: 'carga', header: 'Carga', ordenable: false, prioridad: 3, tarjeta: 'meta', valor: (p) => (p.cargaId ? `#${p.cargaId}` : '—') },
    { id: 'usuario', header: 'Usuario', ordenable: false, prioridad: 3, tarjeta: 'meta', valor: (p) => p.creadoPor ?? '', formato: (p) => p.creadoPor || '—' },
  ];

  readonly idFila = (p: PagoItem) => p.id;
  readonly claseFila = (p: PagoItem) => (p.anulado ? 'te-fila--atenuada' : '');

  ngOnInit(): void {
    const carga = Number(this.ruta.snapshot.queryParamMap.get('cargaId'));
    if (Number.isInteger(carga) && carga > 0) this.cargaId.set(carga);
    this.srvV2.epsMatriz().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (m) => this.epsOpciones.set((m ?? []).map((e) => e.nombre)),
      error: () => this.epsOpciones.set([]),
    });
    this.cargar();
  }

  filtros(): FiltrosPagos {
    return filtrosDePagos(this.formulario, this.cargaId());
  }

  cargar(): void {
    this.cargando.set(true);
    this.error.set('');
    this.srv.pagos(this.filtros(), this.pagina(), this.tamano()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (p) => {
        this.filas.set(p.content ?? []);
        this.total.set(p.totalElements ?? 0);
        this.valorTotal.set(Number(p.valorTotal ?? 0));
        this.cargando.set(false);
      },
      error: (e: unknown) => {
        this.cargando.set(false);
        this.error.set(mensajeDeError(e, 'No se pudieron cargar los pagos.'));
      },
    });
  }

  filtrar(): void {
    this.pagina.set(0);
    this.cargar();
  }

  limpiar(): void {
    this.formulario = { q: '', eps: '', desde: null, hasta: null };
    this.filtrar();
  }

  quitarFiltroCarga(): void {
    this.cargaId.set(null);
    void this.router.navigate([], { relativeTo: this.ruta, queryParams: { cargaId: null }, queryParamsHandling: 'merge' });
    this.filtrar();
  }

  paginar(e: { pagina: number; porPagina: number }): void {
    this.pagina.set(e.pagina);
    this.tamano.set(e.porPagina);
    this.cargar();
  }

  // ── Anular ────────────────────────────────────────────────────────────

  anular(p: PagoItem): void {
    if (p.anulado) return;
    void Swal.fire({
      icon: 'warning',
      title: 'Anular pago',
      html:
        `<p style="margin:0 0 8px"><b>${escaparHtml(pesos(p.valorPagado))}</b> de ${escaparHtml(p.eps ?? p.incapacidad?.eps ?? '')} ` +
        `a la incapacidad <b>${escaparHtml(codigoVisible(p.incapacidad))}</b> (${escaparHtml(p.incapacidad?.nombreCompleto ?? '')}).</p>` +
        '<p style="margin:0;font-size:13px;color:#64748b">El pago queda anulado (no se borra) y se recalcula el estado de la incapacidad.</p>',
      input: 'textarea',
      inputLabel: 'Motivo (opcional)',
      inputPlaceholder: 'Por qué se anula',
      showCancelButton: true,
      confirmButtonText: 'Anular pago',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#c62828',
    }).then((r) => {
      if (!r.isConfirmed) return;
      const motivo = typeof r.value === 'string' && r.value.trim() ? r.value.trim() : undefined;
      this.srv.anularPago(p.id, motivo).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => {
          void Swal.fire({ icon: 'success', title: 'Pago anulado', timer: 2500, showConfirmButton: false });
          this.cargar();
        },
        error: (e: unknown) =>
          void Swal.fire({ icon: 'error', title: 'No se pudo anular el pago', text: mensajeDeError(e, 'Inténtalo de nuevo.') }),
      });
    });
  }

  // ── Exportar ──────────────────────────────────────────────────────────

  /** Todo lo filtrado (no solo la pagina), hasta 10.000 registros. */
  exportar(): void {
    if (this.exportando() || this.total() === 0) return;
    this.exportando.set(true);
    const filtros = this.filtros();
    traerTodasLasPaginas((pagina) => this.srv.pagos(filtros, pagina, TAMANO_PAGINA_EXPORT))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (pagos) => {
          this.exportando.set(false);
          this.guardarLibro(
            libroDeFilas('Pagos', pagos.map((p) => filaExcelPago(p)), [12, 18, 14, 34, 20, 12, 14, 10, 10, 12, 20, 20, 30, 8, 24, 16, 9]),
            `pagos_incapacidades_${marcaDeTiempo()}.xlsx`,
          );
          if (this.total() > TAMANO_PAGINA_EXPORT * MAX_PAGINAS_EXPORT) {
            void Swal.fire({
              icon: 'info',
              title: 'Exportación parcial',
              text: `Se exportaron los primeros ${entero(pagos.length)} de ${entero(this.total())} pagos. Acota el filtro para exportar el resto.`,
            });
          }
        },
        error: (e: unknown) => {
          this.exportando.set(false);
          void Swal.fire({ icon: 'error', title: 'No se pudo exportar', text: mensajeDeError(e, 'Inténtalo de nuevo.') });
        },
      });
  }

  /** Envoltura de `XLSX.writeFile` (se espia en las pruebas). */
  guardarLibro(libro: XLSX.WorkBook, nombre: string): void {
    escribirLibro(libro, nombre);
  }
}

/** Una fila del Excel de pagos: valores planos (numeros como numeros, fechas dd/MM/yyyy). */
export function filaExcelPago(p: PagoItem): Record<string, unknown> {
  return {
    'Código oficina': p.incapacidad?.codigoOficina ?? '',
    'Código único': p.incapacidad?.codigoUnico ?? '',
    Cédula: p.incapacidad?.cedula ?? '',
    Nombre: p.incapacidad?.nombreCompleto ?? '',
    EPS: p.eps ?? p.incapacidad?.eps ?? '',
    'Fecha inicio': fechaCorta(p.incapacidad?.fechaInicio),
    'Valor pagado': Number(p.valorPagado ?? 0),
    'Días liquidados': p.diasLiquidados ?? '',
    'Días autorizados': p.diasAutorizados ?? '',
    'Fecha de pago': fechaCorta(p.fechaPago),
    'N° incapacidad EPS': p.numeroIncapacidadEps ?? '',
    'Soporte contable': p.soporteContable ?? '',
    Observaciones: p.observaciones ?? '',
    Carga: p.cargaId ?? '',
    Usuario: p.creadoPor ?? '',
    Registrado: fechaHora(p.creadoEn),
    Anulado: p.anulado ? 'Sí' : 'No',
  };
}
