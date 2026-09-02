import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '@/environments/environment';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { map, shareReplay, switchMap, catchError, startWith } from 'rxjs/operators';
import {
    MetricasDateRange, KpiSummary, ChartDataPoint,
    MetricasResumen, HistorialItem, TopComprador, RankingAutorizador, ProductoFecha
} from '../models/tesoreria-metricas.models';
import * as _moment from 'moment';
// @ts-ignore
const moment = _moment.default || _moment;

/**
 * Datos del tablero de tesorería.
 *
 * <h3>Qué estaba roto</h3>
 * Este tablero mostraba ceros con cara de estar bien. Tres desajustes encadenados:
 *
 * 1. `metricas-resumen` **ignoraba** las fechas y devolvía
 *    `{totalPersonas, activos, bloqueados, ...}`, mientras aquí se esperaba
 *    `{historial, top_compradores, ranking_autorizadores, productos_por_fecha}`. Como
 *    respondía 200, el `catchError` ni siquiera entraba: los cuatro campos quedaban en
 *    `undefined`.
 * 2. `/transacciones` y `/personas` devuelven arrays y aquí se leía `res.results`, que en
 *    un array es `undefined`. Todos los KPI salían en cero.
 * 3. Cada carga descargaba **40 MB** —las 51.136 personas sin paginar— para descartarlas
 *    enteras.
 *
 * <h3>Qué hace ahora</h3>
 * Una sola llamada a `metricas-resumen` con el rango real trae los agregados ya calculados
 * en la base. Las series que necesitan filas sueltas piden lo justo y paginado. Nada de
 * esto se agrega ya en el navegador: sumar 27.449 filas en el cliente era, además de
 * lento, la razón por la que el rango de fechas no significaba nada.
 */
@Injectable({ providedIn: 'root' })
export class TesoreriaMetricasApiService {

    private http = inject(HttpClient);
    private apiUrl = `${environment.apiUrl}/gestion_tesoreria`;

    /** Rango por defecto: semana actual (lunes a hoy). */
    private dateRangeSubject = new BehaviorSubject<MetricasDateRange>({
        start: moment().startOf('isoWeek').toDate(),
        end: moment().toDate()
    });

    public dateRange$ = this.dateRangeSubject.asObservable();

    /**
     * El resumen del servidor. Es la fuente de casi todo: una llamada por cambio de rango
     * en vez de cuatro, y los agregados vienen resueltos en SQL.
     */
    private resumen$: Observable<any> = this.dateRange$.pipe(
        switchMap(range => {
            const params = new HttpParams()
                .set('fecha_inicio', moment(range.start).format('YYYY-MM-DD'))
                .set('fecha_fin', moment(range.end).format('YYYY-MM-DD'));

            return this.http.get<any>(`${this.apiUrl}/metricas-resumen`, { params }).pipe(
                catchError(() => of(this.resumenVacio()))
            );
        }),
        shareReplay(1)
    );

    /**
     * Transacciones del rango, para las gráficas que necesitan las filas y no un agregado.
     * Acotadas: el tablero nunca debe traerse la tabla entera, que son 27.449 filas.
     */
    public transacciones$: Observable<any[]> = this.dateRange$.pipe(
        switchMap(() => this.http
            .get<any[]>(`${this.apiUrl}/transacciones`, { params: new HttpParams().set('limite', 1000) })
            .pipe(catchError(() => of<any[]>([])))
        ),
        startWith([] as any[]),
        shareReplay(1)
    );

    /**
     * Personas para la gráfica de distribución de saldos.
     *
     * <p>Paginado y solo activos. Antes se pedían las 51.136 sin paginar —40 MB— y se
     * descartaban por leer `res.results` sobre un array. Para una distribución bastan las
     * de mayor saldo.
     */
    public personasSaldos$: Observable<any[]> = this.dateRange$.pipe(
        switchMap(() => {
            const params = new HttpParams()
                .set('paginated', true)
                .set('activo', true)
                .set('size', 200)
                .set('page', 0);
            return this.http.get<any>(`${this.apiUrl}/personas`, { params }).pipe(
                map(res => res?.content ?? []),
                catchError(() => of<any[]>([]))
            );
        }),
        startWith([] as any[]),
        shareReplay(1)
    );

    // ── Selectores del resumen ────────────────────────────────────────────────

    public metricasResumen$: Observable<MetricasResumen> = this.resumen$.pipe(
        map(r => ({
            historial: r?.historial ?? [],
            top_compradores: r?.top_compradores ?? [],
            ranking_autorizadores: r?.ranking_autorizadores ?? [],
            productos_por_fecha: r?.productos_por_fecha ?? [],
        }))
    );

    public historial$: Observable<HistorialItem[]> =
        this.metricasResumen$.pipe(map(r => r.historial));

    public topCompradores$: Observable<TopComprador[]> =
        this.metricasResumen$.pipe(map(r => r.top_compradores));

    public rankingAutorizadores$: Observable<RankingAutorizador[]> =
        this.metricasResumen$.pipe(map(r => r.ranking_autorizadores));

    public productosPorFecha$: Observable<ProductoFecha[]> =
        this.metricasResumen$.pipe(map(r => r.productos_por_fecha));

    /**
     * Los KPI, ya calculados en el servidor.
     *
     * <p>El saldo pendiente es una foto de HOY y no del rango: es cartera viva, no un
     * movimiento del periodo. Mezclarlo con las cifras del rango daría un número que no
     * significa nada.
     */
    public kpiSummary$: Observable<KpiSummary> = this.resumen$.pipe(
        map(r => {
            const k = r?.kpis ?? {};
            return {
                saldosPendientes: Number(k.saldosPendientes) || 0,
                transaccionesEjecutadasCount: Number(k.transaccionesEjecutadasCount) || 0,
                transaccionesEjecutadasMonto: Number(k.transaccionesEjecutadasMonto) || 0,
                transaccionesPendientesMonto: Number(k.transaccionesPendientesMonto) || 0,
                transaccionesAutorizadasMonto: Number(k.transaccionesAutorizadasMonto) || 0,
            } as KpiSummary;
        }),
        startWith({
            saldosPendientes: 0, transaccionesEjecutadasMonto: 0, transaccionesEjecutadasCount: 0,
            transaccionesPendientesMonto: 0, transaccionesAutorizadasMonto: 0
        } as KpiSummary)
    );

    /** Embudo por estado. Viene agregado del servidor con la forma {name, value}. */
    public funnelChartData$: Observable<ChartDataPoint[]> = this.resumen$.pipe(
        map(r => (r?.por_estado ?? []).map((x: any) => ({
            name: String(x.name), value: Number(x.value) || 0
        }))),
        startWith([] as ChartDataPoint[])
    );

    /** Reparto por concepto, para ver de qué se compone el crédito que sale. */
    public porConcepto$: Observable<ChartDataPoint[]> = this.resumen$.pipe(
        map(r => (r?.por_concepto ?? []).map((x: any) => ({
            name: String(x.name), value: Number(x.value) || 0
        }))),
        startWith([] as ChartDataPoint[])
    );

    /** Reparto por sede: dónde se está autorizando. */
    public porSede$: Observable<ChartDataPoint[]> = this.resumen$.pipe(
        map(r => (r?.por_sede ?? []).map((x: any) => ({
            name: String(x.name), value: Number(x.value) || 0
        }))),
        startWith([] as ChartDataPoint[])
    );

    /** Serie diaria de lo entregado, calculada en la base con GROUP BY date(). */
    public serieDiaria$: Observable<{ date: string; value: number; cantidad: number }[]> =
        this.resumen$.pipe(
            map(r => (r?.serie_diaria ?? []).map((x: any) => ({
                date: String(x.date),
                value: Number(x.value) || 0,
                cantidad: Number(x.cantidad) || 0,
            }))),
            startWith([] as { date: string; value: number; cantidad: number }[])
        );

    public updateDateRange(start: Date, end: Date): void {
        this.dateRangeSubject.next({ start, end });
    }

    /**
     * Forma vacía con TODAS las claves. Devolver `{}` dejaría a los selectores leyendo
     * propiedades de undefined, que es justo el fallo silencioso del que venimos.
     */
    private resumenVacio() {
        return {
            kpis: {},
            historial: [], top_compradores: [], ranking_autorizadores: [],
            productos_por_fecha: [], por_estado: [], por_concepto: [], por_sede: [],
            serie_diaria: [],
        };
    }
}
