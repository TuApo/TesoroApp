import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, PLATFORM_ID, WritableSignal, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subscription, finalize } from 'rxjs';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';
import saveAs from 'file-saver';
import Swal from 'sweetalert2';

import { SharedModule } from '@/app/shared/shared.module';
import { ColumnaTabla, TABLA_ESTANDAR } from '@/app/shared/components/tabla-estandar';
import { provideEchartsTema } from '@/app/shared/utils/echarts-tema';
import { SedeScopeService } from '@/app/shared/services/sede-scope/sede-scope.service';
import { SedesSeleccionService } from '@/app/shared/services/sedes-seleccion/sedes-seleccion.service';
import { EstadoCandidatosService } from '../../service/estado-candidatos/estado-candidatos.service';
import {
  FilaContratado, FilaEspera, FilaInscrito, FilaRechazo, FiltrosEstado, ListaEstado, OficinaEstado, ResumenEstado,
  SECCIONES, TRAMOS, TRAMOS_COMPLETITUD, Vista,
  diasDelRango, etiqueta, etiquetaMes, etiquetaSeccion, filtrosIniciales, formatoFecha, isoLocal, nombreArchivoEstado, pares, pct,
  tonoDespues, tonoTramo, tramoCompletitud,
} from '../../service/estado-candidatos/estado-candidatos.util';
import { abrirLineaTiempoPersona } from '../../components/linea-tiempo-persona/linea-tiempo-persona.dialog';

/** Tope del rango en días contando ambos extremos: el mismo que aplica ms-hr (400 si se pasa). */
const MAX_DIAS_RANGO = 400;
/** Igual que EstadoCandidatosExcel.MAX_FILAS_FORMULARIO en ms-hr. */
const MAX_FILAS_EXCEL = 5000;
const VISTAS: Vista[] = ['resumen', 'en-espera', 'rechazados', 'contratados', 'inscritos'];

/** Colores de los estados: los mismos tonos que los chips (ok / warn / danger) y la temporal. */
const COLOR = { APLICA: '#10b981', EN_ESPERA: '#f59e0b', NO_APLICA: '#e11d48', AL: '#065f46', TA: '#0ea5e9', OTRA: '#94a3b8' };

/**
 * Estado de candidatos (Contratación, aprobado el 16-oct-2026): quién quedó en espera, a quién
 * se rechazó y quién se contrató, con su estadística. Cinco pestañas sobre los mismos filtros
 * (rango, oficina, cédula o nombre); cada lista se pide al abrir su pestaña y pagina en el
 * servidor. La fuente es la observación del evaluador del proceso (ver EstadoCandidatosService
 * de ms-hr) y cada quien ve solo las oficinas de su alcance.
 *
 * <p>La quinta, Inscritos (21-oct-2026), es la otra punta del embudo: quién llenó el formulario de
 * inscripción y qué porcentaje tiene diligenciado (reglas en InscripcionCampos de ms-hr).
 */
@Component({
  selector: 'app-estado-candidatos',
  standalone: true,
  imports: [SharedModule, MatProgressBarModule, NgxEchartsDirective, ...TABLA_ESTANDAR],
  providers: [provideEchartsTema()],
  templateUrl: './estado-candidatos.component.html',
  styleUrl: './estado-candidatos.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EstadoCandidatosComponent implements OnInit {
  private readonly api = inject(EstadoCandidatosService);
  private readonly sedeScope = inject(SedeScopeService);
  private readonly sedesSeleccion = inject(SedesSeleccionService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private cargas: Partial<Record<Vista, Subscription>> = {};

  readonly etiqueta = etiqueta;
  readonly etiquetaTramo = (id: string) => TRAMOS.find((t) => t.id === id)?.etiqueta ?? id;
  readonly pct = pct;
  readonly pares = pares;
  readonly etiquetaSeccion = etiquetaSeccion;
  readonly tramoCompletitud = tramoCompletitud;
  readonly tonoDespues = tonoDespues;
  readonly secciones = SECCIONES;

  filtros: FiltrosEstado = filtrosIniciales();
  /** Tope de los calendarios: no hay datos del futuro. */
  readonly hoy = new Date();
  readonly oficinas = signal<string[]>([]);
  readonly pestana = signal(0);
  readonly error = signal('');
  readonly descargando = signal(false);

  // ---- facetas de cada lista
  readonly soloVigentes = signal(true);
  readonly motivoEspera = signal('');
  readonly tramo = signal('');
  readonly etapa = signal<string>('EVALUACION');
  readonly motivoRechazo = signal('');
  readonly temporal = signal('');
  readonly completitud = signal('');
  readonly seccion = signal('');
  readonly despues = signal('');

  // ---- datos
  readonly resumen = signal<ResumenEstado | null>(null);
  readonly espera = signal<ListaEstado<FilaEspera> | null>(null);
  readonly rechazos = signal<ListaEstado<FilaRechazo> | null>(null);
  readonly contratos = signal<ListaEstado<FilaContratado> | null>(null);
  readonly inscritos = signal<ListaEstado<FilaInscrito> | null>(null);
  readonly cargando = signal<Partial<Record<Vista, boolean>>>({});
  readonly pagina = signal<Record<Exclude<Vista, 'resumen'>, { page: number; size: number }>>({
    'en-espera': { page: 0, size: 50 },
    rechazados: { page: 0, size: 50 },
    contratados: { page: 0, size: 50 },
    inscritos: { page: 0, size: 50 },
  });

  readonly vista = computed(() => VISTAS[this.pestana()] ?? 'resumen');

  // ---------------------------------------------------------------- KPIs del resumen
  readonly kpis = computed(() => {
    const r = this.resumen();
    if (!r) return null;
    const esp = r.recuperacion.EN_ESPERA;
    return {
      evaluados: r.evaluados,
      aplica: r.por_estado.APLICA ?? 0,
      espera: r.por_estado.EN_ESPERA ?? 0,
      noAplica: r.por_estado.NO_APLICA ?? 0,
      vigentes: r.en_espera_vigentes,
      etapa: r.rechazos_etapa,
      recuperados: pct(esp.ingresaron, esp.total),
      diasRecuperacion: esp.dias_promedio,
    };
  });

  readonly recuperacion = computed(() => {
    const r = this.resumen()?.recuperacion;
    if (!r) return [];
    const e = r.EN_ESPERA, n = r.NO_APLICA;
    return [
      { texto: 'Estuvo en espera y luego ingresó', n: e.ingresaron, total: e.total, color: COLOR.APLICA },
      { texto: 'Sigue sin ingresar tras la espera', n: e.total - e.ingresaron, total: e.total, color: COLOR.EN_ESPERA },
      { texto: 'No aplicó y luego ingresó', n: n.ingresaron, total: n.total, color: COLOR.APLICA },
      { texto: 'No aplicó y volvió a presentarse', n: n.volvieron, total: n.total, color: '#94a3b8' },
    ];
  });

  readonly graficaMes = computed<EChartsOption>(() => {
    const r = this.resumen();
    if (!r) return {};
    const meses = r.por_mes.map((m) => etiquetaMes(m.mes));
    const serie = (k: 'APLICA' | 'EN_ESPERA' | 'NO_APLICA') => ({
      name: etiqueta(k), type: 'bar' as const, stack: 'obs', barMaxWidth: 28,
      itemStyle: { color: COLOR[k] }, data: r.por_mes.map((m) => Number(m[k]) || 0),
    });
    return barras(meses, [serie('APLICA'), serie('EN_ESPERA'), serie('NO_APLICA')]);
  });

  readonly graficaIngresos = computed<EChartsOption>(() => {
    const r = this.resumen();
    if (!r) return {};
    const meses = r.ingresos_por_mes.map((m) => etiquetaMes(m.mes));
    const serie = (k: 'AL' | 'TA' | 'OTRA') => ({
      name: etiqueta(k), type: 'bar' as const, stack: 'ing', barMaxWidth: 28,
      itemStyle: { color: COLOR[k] }, data: r.ingresos_por_mes.map((m) => Number(m[k]) || 0),
    });
    return barras(meses, [serie('AL'), serie('TA'), serie('OTRA')]);
  });

  readonly graficaAntiguedad = computed<EChartsOption>(() => {
    const r = this.resumen();
    if (!r) return {};
    const tramos = TRAMOS.map((t) => t.id);
    const colores: Record<string, string> = { ok: COLOR.APLICA, warn: COLOR.EN_ESPERA, danger: COLOR.NO_APLICA };
    return {
      animation: false,
      grid: { left: 8, right: 8, top: 24, bottom: 4, containLabel: true },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'category', data: TRAMOS.map((t) => t.etiqueta.replace(' días', ' d')), axisLabel: { fontSize: 10 } },
      yAxis: { type: 'value', axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { opacity: 0.5 } } },
      series: [{
        type: 'bar', barMaxWidth: 36, name: 'Personas',
        label: { show: true, position: 'top', fontSize: 11, fontWeight: 600 },
        data: tramos.map((t, i) => ({ value: r.antiguedad_espera[t] ?? 0, itemStyle: { color: colores[TRAMOS[i].tono] } })),
      }],
    } as EChartsOption;
  });

  // ---------------------------------------------------------------- inscripción (resumen)
  readonly inscripcion = computed(() => this.resumen()?.inscripcion ?? null);

  /** Embudo inscritos → evaluados → aplica → contratados, con la tasa sobre la etapa anterior. */
  readonly embudo = computed(() => {
    const e = this.inscripcion()?.embudo;
    if (!e) return [];
    const max = Math.max(1, e.inscritos);
    return [
      { texto: 'Inscritos', n: e.inscritos, tasa: null as number | null, color: '#64748b' },
      { texto: 'Evaluados', n: e.evaluados, tasa: e.tasas.evaluados, color: '#0ea5e9' },
      { texto: 'Aplica', n: e.aplica, tasa: e.tasas.aplica, color: COLOR.APLICA },
      { texto: 'Contratados', n: e.contratados, tasa: e.tasas.contratados, color: COLOR.AL },
    ].map((f) => ({ ...f, ancho: Math.max(2, Math.round((f.n / max) * 100)) }));
  });

  /** Secciones del formulario por % de inscritos que la tienen incompleta, de la peor a la mejor. */
  readonly seccionesIncompletas = computed(() => {
    const m = this.inscripcion()?.secciones_incompletas;
    if (!m) return [];
    return SECCIONES.map((s) => ({ id: s.id, texto: s.etiqueta, pct: m[s.id] ?? 0 })).sort((a, b) => b.pct - a.pct);
  });

  readonly graficaCompletitud = computed<EChartsOption>(() => {
    const i = this.inscripcion();
    if (!i) return {};
    return {
      animation: false,
      grid: { left: 8, right: 8, top: 24, bottom: 4, containLabel: true },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'category', data: TRAMOS_COMPLETITUD.map((t) => t.etiqueta), axisLabel: { fontSize: 10 } },
      yAxis: { type: 'value', axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { opacity: 0.5 } } },
      series: [{
        type: 'bar', barMaxWidth: 36, name: 'Inscritos',
        label: { show: true, position: 'top', fontSize: 11, fontWeight: 600 },
        data: TRAMOS_COMPLETITUD.map((t) => ({ value: i.por_completitud[t.id] ?? 0, itemStyle: { color: t.color } })),
      }],
    } as EChartsOption;
  });

  /** Inscritos por mes junto a los evaluados del mismo mes (la serie de observaciones de arriba). */
  readonly graficaInscritos = computed<EChartsOption>(() => {
    const r = this.resumen();
    const i = r?.inscripcion;
    if (!r || !i) return {};
    const evaluados = new Map(r.por_mes.map((m) => [m.mes, (Number(m['APLICA']) || 0) + (Number(m['EN_ESPERA']) || 0) + (Number(m['NO_APLICA']) || 0)]));
    return barras(i.por_mes.map((m) => etiquetaMes(m.mes)), [
      { name: 'Inscritos', type: 'bar', barMaxWidth: 28, itemStyle: { color: '#64748b' }, data: i.por_mes.map((m) => m.inscritos) },
      { name: 'Evaluados', type: 'line', smooth: true, symbolSize: 6, itemStyle: { color: '#0ea5e9' }, data: i.por_mes.map((m) => evaluados.get(m.mes) ?? 0) },
    ]);
  });

  /** Barras horizontales de motivos: [etiqueta, n, % del máximo]. */
  readonly motivosEspera = computed(() => barrasMotivo(this.resumen()?.motivos_espera));
  readonly motivosNoAplica = computed(() => barrasMotivo(this.resumen()?.motivos_no_aplica));

  // ---------------------------------------------------------------- columnas
  readonly columnasOficina: ColumnaTabla<OficinaEstado>[] = [
    { id: 'oficina', header: 'Oficina', valor: (o) => o.oficina, tarjeta: 'titulo' },
    { id: 'evaluados', header: 'Evaluados', align: 'right', valor: (o) => o.evaluados },
    { id: 'APLICA', header: 'Aplica', align: 'right', valor: (o) => o.APLICA },
    { id: 'EN_ESPERA', header: 'En espera', align: 'right', valor: (o) => o.EN_ESPERA },
    {
      id: 'pct_espera', header: '% espera', align: 'right', valor: (o) => pct(o.EN_ESPERA, o.evaluados),
      badge: (o) => ({ texto: `${pct(o.EN_ESPERA, o.evaluados)} %`, tono: pct(o.EN_ESPERA, o.evaluados) > 20 ? 'warn' : 'neutro' }),
    },
    { id: 'NO_APLICA', header: 'No aplica', align: 'right', valor: (o) => o.NO_APLICA },
    {
      id: 'pct_na', header: '% no aplica', align: 'right', valor: (o) => pct(o.NO_APLICA, o.evaluados),
      badge: (o) => ({ texto: `${pct(o.NO_APLICA, o.evaluados)} %`, tono: pct(o.NO_APLICA, o.evaluados) > 10 ? 'danger' : 'neutro' }),
    },
    { id: 'ingresos', header: 'Ingresos', align: 'right', valor: (o) => o.ingresos },
    { id: 'inscritos', header: 'Inscritos', align: 'right', valor: (o) => o.inscritos ?? 0 },
    {
      id: 'completitud', header: '% formulario', align: 'right', valor: (o) => o.completitud_promedio ?? '',
      badge: (o) => o.completitud_promedio == null ? null
        : { texto: `${o.completitud_promedio} %`, tono: tramoCompletitud(tramoDe(o.completitud_promedio)).tono },
    },
  ];
  readonly idOficina = (o: OficinaEstado) => o.oficina;
  readonly pieOficina = (filas: OficinaEstado[]) => {
    const s = (k: keyof OficinaEstado) => filas.reduce((a, o) => a + (Number(o[k]) || 0), 0);
    return {
      evaluados: s('evaluados'), APLICA: s('APLICA'), EN_ESPERA: s('EN_ESPERA'), NO_APLICA: s('NO_APLICA'),
      ingresos: s('ingresos'), inscritos: s('inscritos'),
    };
  };

  readonly columnasEspera: ColumnaTabla<FilaEspera>[] = [
    { id: 'nombre', header: 'Candidato', ordenable: false, valor: (f) => f.nombre ?? '', tarjeta: 'titulo', minAncho: '200px' },
    { id: 'cedula', header: 'Documento', ordenable: false, valor: (f) => f.cedula ?? '', formato: (f) => docTexto(f.tipo_documento, f.cedula), prioridad: 1 },
    { id: 'oficina', header: 'Oficina', ordenable: false, valor: (f) => f.oficina ?? '', formato: (f) => f.oficina || '—', tarjeta: 'subtitulo' },
    { id: 'fecha', header: 'Evaluado', ordenable: false, valor: (f) => f.fecha ?? '', formato: (f) => formatoFecha(f.fecha), tarjeta: 'meta' },
    {
      id: 'dias', header: 'Esperando', ordenable: false, align: 'center', tarjeta: 'badge', valor: (f) => f.dias,
      badge: (f) => ({ texto: `${f.dias} días`, tono: tonoTramo(f.antiguedad), icono: 'hourglass_top' }),
    },
    {
      id: 'categoria', header: 'Motivo', ordenable: false, valor: (f) => etiqueta(f.categoria),
      badge: (f) => ({ texto: etiqueta(f.categoria), tono: 'warn' }),
    },
    { id: 'motivo', header: 'Motivo escrito', ordenable: false, valor: (f) => f.motivo ?? '', formato: (f) => f.motivo || '—', prioridad: 2, tarjeta: 'cuerpo', minAncho: '200px' },
    { id: 'experiencia', header: 'Experiencia', ordenable: false, valor: (f) => f.experiencia ?? '', formato: (f) => f.experiencia || '—', prioridad: 3 },
    { id: 'evaluador', header: 'Evaluador', ordenable: false, valor: (f) => f.evaluador ?? '', formato: (f) => f.evaluador || '—', prioridad: 3 },
    {
      id: 'despues', header: 'Después', ordenable: false, valor: (f) => f.despues,
      badge: (f) => ({ texto: f.despues, tono: f.sigue_en_espera ? 'warn' : f.despues.startsWith('Ingresó') ? 'ok' : 'neutro' }),
    },
  ];

  readonly columnasRechazo: ColumnaTabla<FilaRechazo>[] = [
    { id: 'nombre', header: 'Candidato', ordenable: false, valor: (f) => f.nombre ?? '', tarjeta: 'titulo', minAncho: '200px' },
    { id: 'cedula', header: 'Documento', ordenable: false, valor: (f) => f.cedula ?? '', formato: (f) => docTexto(f.tipo_documento, f.cedula), prioridad: 1 },
    {
      id: 'etapa', header: 'Etapa', ordenable: false, align: 'center', tarjeta: 'badge', valor: (f) => etiqueta(f.etapa),
      badge: (f) => ({ texto: etiqueta(f.etapa), tono: 'danger' }),
    },
    { id: 'fecha', header: 'Fecha', ordenable: false, valor: (f) => f.fecha ?? '', formato: (f) => formatoFecha(f.fecha), tarjeta: 'meta' },
    {
      id: 'categoria', header: 'Motivo', ordenable: false, valor: (f) => etiqueta(f.categoria),
      badge: (f) => ({ texto: etiqueta(f.categoria), tono: 'neutro' }),
    },
    { id: 'motivo', header: 'Motivo escrito', ordenable: false, valor: (f) => f.motivo ?? '', formato: (f) => f.motivo || '—', prioridad: 2, tarjeta: 'cuerpo', minAncho: '200px' },
    { id: 'oficina', header: 'Oficina', ordenable: false, valor: (f) => f.oficina ?? '', formato: (f) => f.oficina || '—', tarjeta: 'subtitulo' },
    { id: 'evaluador', header: 'Evaluador', ordenable: false, valor: (f) => f.evaluador ?? '', formato: (f) => f.evaluador || '—', prioridad: 3 },
    { id: 'cargo', header: 'Cargo', ordenable: false, valor: (f) => f.cargo ?? '', formato: (f) => f.cargo || '—', prioridad: 3 },
    {
      id: 'despues', header: 'Después', ordenable: false, valor: (f) => f.despues,
      badge: (f) => ({ texto: f.despues, tono: f.despues_tono }),
    },
  ];

  readonly columnasContrato: ColumnaTabla<FilaContratado>[] = [
    { id: 'nombre', header: 'Candidato', ordenable: false, valor: (f) => f.nombre ?? '', tarjeta: 'titulo', minAncho: '200px' },
    { id: 'cedula', header: 'Documento', ordenable: false, valor: (f) => f.cedula ?? '', formato: (f) => docTexto(f.tipo_documento, f.cedula), prioridad: 1 },
    { id: 'codigo', header: 'Código', ordenable: false, valor: (f) => f.codigo_contrato ?? '', formato: (f) => f.codigo_contrato || '—' },
    { id: 'ingreso', header: 'Ingreso', ordenable: false, valor: (f) => f.fecha_ingreso ?? '', formato: (f) => formatoFecha(f.fecha_ingreso), tarjeta: 'meta' },
    {
      id: 'temporal', header: 'Temporal', ordenable: false, align: 'center', tarjeta: 'badge', valor: (f) => f.temporal ?? '',
      badge: (f) => f.temporal ? { texto: f.temporal, tono: f.temporal === 'AL' ? 'ok' : f.temporal === 'TA' ? 'info' : 'neutro' } : null,
    },
    { id: 'empresa', header: 'Empresa usuaria', ordenable: false, valor: (f) => f.empresa_usuaria ?? '', formato: (f) => f.empresa_usuaria || '—', prioridad: 2, minAncho: '220px' },
    { id: 'oficina', header: 'Oficina', ordenable: false, valor: (f) => f.oficina ?? '', formato: (f) => f.oficina || '—', tarjeta: 'subtitulo' },
    { id: 'contrato', header: 'Contrató', ordenable: false, valor: (f) => f.usuario_contrata ?? '', formato: (f) => f.usuario_contrata || '—', prioridad: 3 },
    {
      id: 'dias', header: 'Días desde la evaluación', ordenable: false, align: 'right', prioridad: 2,
      valor: (f) => f.dias_desde_evaluacion ?? '', formato: (f) => f.dias_desde_evaluacion == null ? '—' : String(f.dias_desde_evaluacion),
    },
    {
      id: 'antes', header: 'Antes estuvo', ordenable: false, prioridad: 2,
      valor: (f) => f.antes_estuvo ? `${etiqueta(f.antes_estuvo)} ${f.antes_dias ?? ''}`.trim() : '',
      badge: (f) => f.antes_estuvo
        ? { texto: `${etiqueta(f.antes_estuvo)} · hace ${f.antes_dias} días`, tono: f.antes_estuvo === 'EN_ESPERA' ? 'warn' : 'danger' }
        : null,
    },
  ];

  readonly columnasInscrito: ColumnaTabla<FilaInscrito>[] = [
    { id: 'nombre', header: 'Candidato', ordenable: false, valor: (f) => f.nombre ?? '', tarjeta: 'titulo', minAncho: '200px' },
    { id: 'cedula', header: 'Documento', ordenable: false, valor: (f) => f.cedula ?? '', formato: (f) => docTexto(f.tipo_documento, f.cedula), prioridad: 1 },
    { id: 'fecha', header: 'Inscrito', ordenable: false, valor: (f) => f.fecha_inscripcion ?? '', formato: (f) => formatoFecha(f.fecha_inscripcion), tarjeta: 'meta' },
    { id: 'oficina', header: 'Oficina', ordenable: false, valor: (f) => f.oficina ?? '', formato: (f) => f.oficina || '—', tarjeta: 'subtitulo' },
    // Celda rica (barra + % por sección en el tooltip): plantilla `tablaCelda="completitud"`.
    { id: 'completitud', header: 'Formulario', ordenable: false, valor: (f) => f.completitud, copiaTexto: (f) => `${f.completitud} %`, tarjeta: 'badge', minAncho: '170px' },
    {
      id: 'faltantes', header: 'Le falta', ordenable: false, prioridad: 2, tarjeta: 'cuerpo', minAncho: '260px',
      valor: (f) => f.faltantes.join(', '), formato: (f) => faltantesCorto(f.faltantes),
    },
    {
      id: 'despues', header: 'Después', ordenable: false, valor: (f) => etiqueta(f.despues),
      badge: (f) => ({
        texto: f.despues === 'CONTRATADO' && f.fecha_ingreso ? `Contratado · ${formatoFecha(f.fecha_ingreso)}` : etiqueta(f.despues),
        tono: tonoDespues(f.despues),
      }),
    },
    { id: 'actualizado', header: 'Última actualización', ordenable: false, prioridad: 3, valor: (f) => f.actualizado ?? '', formato: (f) => formatoFecha(f.actualizado) },
  ];

  /** Tooltip de la barra: el % de cada paso del formulario. */
  detalleSecciones(f: FilaInscrito): string {
    const lineas = SECCIONES.map((s) => {
      const v = f.secciones?.[s.id];
      return `${s.etiqueta}: ${v == null ? 'no aplica' : v + ' %'}`;
    });
    return `${f.campos_llenos} de ${f.campos_aplican} campos\n${lineas.join('\n')}`;
  }

  readonly idInscrito = (f: FilaInscrito) => f.candidato_id;
  readonly idEspera = (f: FilaEspera) => f.proceso_id;
  readonly idRechazo = (f: FilaRechazo) => `${f.proceso_id}-${f.etapa}`;
  readonly idContrato = (f: FilaContratado) => f.proceso_id;

  ngOnInit(): void {
    if (!this.isBrowser) return;
    this.sedesSeleccion.nombres()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((nombres) => this.oficinas.set(this.sedeScope.opciones(nombres)));
    const vista = VISTAS.indexOf(location.hash.replace('#', '') as Vista);
    if (vista > 0) this.pestana.set(vista);
    this.consultar();
  }

  // ---------------------------------------------------------------- acciones

  /** 'YYYY-MM-DD' → Date LOCAL para el calendario (new Date('2026-10-21') sería medianoche UTC = día anterior). */
  fecha(iso: string): Date | null {
    // Misma instancia para el mismo texto: la plantilla lo pide en cada detección de cambios
    // y un Date nuevo cada vez haría que el calendario revalidara min/max sin necesidad.
    if (!this.fechas.has(iso)) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
      this.fechas.set(iso, m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null);
    }
    return this.fechas.get(iso) ?? null;
  }
  private readonly fechas = new Map<string, Date | null>();

  /** El calendario devuelve un Date; los filtros y ms-hr siguen hablando en 'YYYY-MM-DD'. */
  ponerFecha(campo: 'desde' | 'hasta', d: Date | null): void {
    this.filtros = { ...this.filtros, [campo]: d ? isoLocal(d) : '' };
  }

  /** Aplica los filtros: recarga el resumen (conteos de pestañas) y la pestaña abierta. */
  consultar(): void {
    if (this.filtros.desde && this.filtros.hasta && this.filtros.hasta < this.filtros.desde) {
      this.error.set('La fecha final es anterior a la inicial.');
      return;
    }
    if (this.rangoExcedido()) return;
    this.error.set('');
    this.espera.set(null);
    this.rechazos.set(null);
    this.contratos.set(null);
    this.inscritos.set(null);
    this.pagina.update((p) => ({
      'en-espera': { ...p['en-espera'], page: 0 },
      rechazados: { ...p.rechazados, page: 0 },
      contratados: { ...p.contratados, page: 0 },
      inscritos: { ...p.inscritos, page: 0 },
    }));
    this.cargar('resumen');
    if (this.vista() !== 'resumen') this.cargar(this.vista());
  }

  cambiarPestana(i: number): void {
    this.pestana.set(i);
    const v = this.vista();
    if (this.isBrowser) history.replaceState(null, '', `${location.pathname}${location.search}${i ? '#' + v : ''}`);
    if (v === 'en-espera' && !this.espera()) this.cargar(v);
    if (v === 'rechazados' && !this.rechazos()) this.cargar(v);
    if (v === 'contratados' && !this.contratos()) this.cargar(v);
    if (v === 'inscritos' && !this.inscritos()) this.cargar(v);
  }

  /** Clic en una faceta (chip): filtra; otro clic sobre la misma la quita. */
  faceta(s: WritableSignal<string>, valor: string, vista: Exclude<Vista, 'resumen'>): void {
    s.set(s() === valor ? '' : valor);
    this.irAPagina(vista, 0);
  }

  cambiarVigentes(v: boolean): void {
    this.soloVigentes.set(v);
    this.irAPagina('en-espera', 0);
  }

  cambiarEtapa(e: string): void {
    this.etapa.set(this.etapa() === e ? '' : e);
    this.motivoRechazo.set('');
    this.irAPagina('rechazados', 0);
  }

  paginar(vista: Exclude<Vista, 'resumen'>, e: { pagina: number; porPagina: number }): void {
    const size = e.porPagina > 0 ? Math.min(e.porPagina, 500) : 500;
    this.pagina.update((p) => ({ ...p, [vista]: { page: e.pagina, size } }));
    this.cargar(vista);
  }

  private irAPagina(vista: Exclude<Vista, 'resumen'>, page: number): void {
    this.pagina.update((p) => ({ ...p, [vista]: { ...p[vista], page } }));
    this.cargar(vista);
  }

  /** Línea de tiempo de la persona (la misma de la ficha del candidato). */
  verPersona(f: { cedula: string | null; nombre: string | null }): void {
    if (!f.cedula) return;
    abrirLineaTiempoPersona(this.dialog, { documento: f.cedula, nombre: f.nombre });
  }

  /** Abre el proceso en Selección y contratación con la cédula cargada. */
  abrirProceso(f: { cedula: string | null }): void {
    if (!f.cedula) return;
    this.router.navigate(['/dashboard/hiring/recruitment-pipeline'], { queryParams: { cedula: f.cedula } });
  }

  descargarExcel(): void {
    const vista = this.vista();
    if (vista === 'resumen' || this.rangoExcedido()) return;
    // El Excel trae el formulario completo de cada persona (columnas de la Consulta de
    // formularios): el backend admite hasta MAX_FILAS_EXCEL filas por descarga.
    const total = { 'en-espera': this.espera, rechazados: this.rechazos, contratados: this.contratos, inscritos: this.inscritos }[vista]()?.total ?? 0;
    if (total > MAX_FILAS_EXCEL) {
      Swal.fire({
        icon: 'info', title: 'Demasiadas filas para el Excel',
        text: `El Excel trae el formulario completo de cada persona y admite hasta ${MAX_FILAS_EXCEL.toLocaleString('es-CO')} filas; `
          + `esta consulta tiene ${total.toLocaleString('es-CO')}. Acorte el rango de fechas, elija una oficina o aplique un filtro.`,
      });
      return;
    }
    this.descargando.set(true);
    this.api.excel(vista, this.filtros, this.extra(vista))
      .pipe(finalize(() => this.descargando.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resp) => {
          if (resp.body) saveAs(resp.body, nombreArchivoEstado(resp.headers.get('Content-Disposition'), vista, this.filtros));
        },
        error: async (err) => {
          // Con responseType 'blob' el JSON de error llega como Blob: se lee para mostrar el motivo.
          let texto = 'Intente de nuevo en un momento.';
          try {
            const cuerpo = err?.error instanceof Blob ? JSON.parse(await err.error.text()) : err?.error;
            if (cuerpo?.message) texto = cuerpo.message;
          } catch { /* sin cuerpo legible: mensaje genérico */ }
          Swal.fire({ icon: 'error', title: 'No se pudo generar el Excel', text: texto });
        },
      });
  }

  // ---------------------------------------------------------------- carga

  private extra(vista: Exclude<Vista, 'resumen'>): Record<string, string | number | boolean> {
    const p = this.pagina()[vista];
    const base = { page: p.page, size: p.size };
    if (vista === 'en-espera') return { ...base, vigentes: this.soloVigentes(), motivo: this.motivoEspera(), antiguedad: this.tramo() };
    if (vista === 'rechazados') return { ...base, etapa: this.etapa(), motivo: this.motivoRechazo() };
    if (vista === 'inscritos') return { ...base, completitud: this.completitud(), seccion: this.seccion(), despues: this.despues() };
    return { ...base, temporal: this.temporal() };
  }

  private cargar(vista: Vista): void {
    // Con clics rápidos, la respuesta vieja no debe pisar a la nueva.
    this.cargas[vista]?.unsubscribe();
    this.cargando.update((c) => ({ ...c, [vista]: true }));
    const fin = () => this.cargando.update((c) => ({ ...c, [vista]: false }));
    const fallo = (err: { status?: number; error?: { message?: string } }) => this.error.set(
      err?.status === 403 ? 'No tiene acceso a esa oficina.' : err?.error?.message || 'No se pudo cargar la información.');

    let peticion: Observable<unknown>;
    let destino: (r: never) => void;
    if (vista === 'resumen') {
      peticion = this.api.resumen(this.filtros);
      destino = (r: ResumenEstado) => this.resumen.set(r);
    } else if (vista === 'en-espera') {
      peticion = this.api.enEspera(this.filtros, this.extra(vista));
      destino = (r: ListaEstado<FilaEspera>) => this.espera.set(r);
    } else if (vista === 'rechazados') {
      peticion = this.api.rechazados(this.filtros, this.extra(vista));
      destino = (r: ListaEstado<FilaRechazo>) => this.rechazos.set(r);
    } else if (vista === 'inscritos') {
      peticion = this.api.inscritos(this.filtros, this.extra(vista));
      destino = (r: ListaEstado<FilaInscrito>) => this.inscritos.set(r);
    } else {
      peticion = this.api.contratados(this.filtros, this.extra(vista));
      destino = (r: ListaEstado<FilaContratado>) => this.contratos.set(r);
    }
    this.cargas[vista] = peticion
      .pipe(finalize(fin), takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (r) => destino(r as never), error: fallo });
  }

  private rangoExcedido(): boolean {
    const dias = diasDelRango(this.filtros.desde, this.filtros.hasta);
    if (dias !== null && dias > MAX_DIAS_RANGO) {
      this.error.set(`El rango no puede pasar de ${MAX_DIAS_RANGO} días (algo más de un año). Divida la consulta en rangos más cortos.`);
      return true;
    }
    return false;
  }

  esta(vista: Vista): boolean {
    return !!this.cargando()[vista];
  }

  conteo(lista: ListaEstado<unknown> | null, faceta: string): Array<[string, number]> {
    return pares(lista?.conteos?.[faceta]);
  }
}

/** 'CC 9000000002' — el tipo solo si viene. */
function docTexto(tipo: string | null, cedula: string | null): string {
  if (!cedula) return '—';
  return tipo ? `${tipo} ${cedula}` : cedula;
}

/** Tramo de un % (mismos cortes que InscripcionCampos.tramo de ms-hr). */
function tramoDe(p: number): string {
  if (p <= 25) return '0-25';
  if (p <= 50) return '26-50';
  if (p <= 75) return '51-75';
  if (p < 100) return '76-99';
  return '100';
}

/** Los tres primeros faltantes y cuántos más: la lista entera va en el Excel. */
function faltantesCorto(f: string[]): string {
  if (!f.length) return '—';
  return f.length <= 3 ? f.join(', ') : `${f.slice(0, 3).join(', ')} y ${f.length - 3} más`;
}

function barrasMotivo(m: Record<string, number> | null | undefined) {
  const filas = pares(m, true).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...filas.map(([, n]) => n));
  return filas.map(([codigo, n]) => ({ codigo, texto: etiqueta(codigo), n, ancho: Math.round((n / max) * 100) }));
}

function barras(categorias: string[], series: object[]): EChartsOption {
  return {
    animation: false,
    grid: { left: 8, right: 8, top: 34, bottom: 4, containLabel: true },
    legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 8, textStyle: { fontSize: 11 } },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'category', data: categorias, axisLabel: { fontSize: 10, hideOverlap: true } },
    yAxis: { type: 'value', axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { opacity: 0.5 } } },
    series,
  } as EChartsOption;
}
