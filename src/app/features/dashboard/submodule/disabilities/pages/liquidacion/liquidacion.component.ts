/**
 * Modulo "Liquidacion" (reunion funcional 2026-10-05): Ligia sube UNA plantilla con dos hojas,
 * Pagos y Negaciones, con lo que cada EPS liquido (cada EPS tiene su formato; la plantilla
 * propia los unifica).
 *
 * Flujo simular -> revision -> aplicar (mismo patron que la carga de Tarjetas):
 *  1. SIMULAR: ms-hr lee el archivo y cruza cada fila con una incapacidad SIN tocar nada. Sale la
 *     ALERTA que pidio la funcional ("Subiste N pagos y M negaciones: X cruzan, Y no cruzan").
 *  2. REVISION: las que no cruzan casi siempre son porque la EPS reporto otra fecha de inicio; el
 *     backend sugiere las de la misma cedula y aqui se asignan con un clic. Las negaciones con un
 *     texto de causal desconocido se homologan a una causal interna (nunca se adivina).
 *  3. APLICAR: solo las filas que cruzan se vuelven pagos / negaciones y ms-hr recalcula el estado
 *     de cada incapacidad ("Usted acaba de liquidar N incapacidades").
 * Una carga aplicada se puede ANULAR desde el historial (anula sus pagos y negaciones).
 */
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { saveAs } from 'file-saver';
import { Observable, catchError, from, map, mergeMap, of, toArray } from 'rxjs';
import Swal from 'sweetalert2';
import type * as XLSX from 'xlsx';

import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';
import { IncapacidadSaludService } from '../../services/incapacidad-salud/incapacidad-salud.service';
import {
  CargaLiquidacion,
  CargaLiquidacionDetalle,
  CausalNegacion,
  FilaLiquidacion,
  HojaLiquidacion,
  IncapacidadRef,
  RESULTADO_FILA_ETIQUETA,
  ResultadoAplicacion,
  ResultadoFilaLiquidacion,
} from '../../models/incapacidad-salud.model';
import {
  DatosDialogoHomologarFila,
  DialogoHomologarFilaComponent,
  ResultadoDialogoHomologarFila,
} from './dialogos/dialogo-homologar-fila.component';
import {
  ETIQUETA_ESTADO_CARGA,
  NOMBRE_PLANTILLA,
  RUTA_NEGACIONES,
  RUTA_PAGOS,
  TAMANO_MAXIMO_PLANTILLA,
  alertaDeCarga,
  claseAccion,
  claseEstadoCarga,
  claseEstadoIncapacidad,
  claseResultadoFila,
  codigoVisible,
  entero,
  escaparHtml,
  escribirLibro,
  etiquetaAccion,
  fechaComoDate,
  fechaCorta,
  fechaHora,
  filasSinCruce,
  libroFilasSinCruce,
  marcaDeTiempo,
  mensajeDeError,
  mismaEps,
  normalizarCausal,
  pesos,
  plural,
  resumenVigente,
  tonoDeChip,
} from './liquidacion.utils';

/** Filtro rapido de la tabla de revision. */
export type FiltroFilas = 'TODAS' | ResultadoFilaLiquidacion | 'SIN_HOMOLOGAR';

/** Peticiones simultaneas al homologar las filas hermanas (mismo texto y EPS) de una carga. */
const CONCURRENCIA_HERMANAS = 4;

@Component({
  selector: 'app-liquidacion',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatProgressBarModule,
    MatTabsModule,
    MatTooltipModule,
    ...TABLA_ESTANDAR,
  ],
  templateUrl: './liquidacion.component.html',
  styleUrls: ['../gestion-incapacidades.comun.css', './liquidacion.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiquidacionComponent implements OnInit {
  private readonly srv = inject(IncapacidadSaludService);
  private readonly dialogo = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);

  readonly rutaPagos = RUTA_PAGOS;
  readonly rutaNegaciones = RUTA_NEGACIONES;
  readonly tamanoMaximoTexto = '10 MB';

  // ── Carga en revision ─────────────────────────────────────────────────
  readonly detalle = signal<CargaLiquidacionDetalle | null>(null);
  readonly simulando = signal(false);
  readonly aplicando = signal(false);
  readonly descargandoPlantilla = signal(false);
  readonly arrastrando = signal(false);
  readonly errorCarga = signal('');
  /** Fila con una peticion en vuelo (asignar / soltar / homologar): se bloquean sus botones. */
  readonly filaOcupada = signal<number | null>(null);
  readonly hoja = signal<HojaLiquidacion>('PAGOS');
  readonly filtro = signal<FiltroFilas>('TODAS');
  private causalesActivas: CausalNegacion[] | null = null;

  // ── Historial ─────────────────────────────────────────────────────────
  readonly cargas = signal<CargaLiquidacion[]>([]);
  readonly totalCargas = signal(0);
  readonly paginaCargas = signal(0);
  readonly tamanoCargas = signal(25);
  readonly cargandoCargas = signal(false);
  readonly errorCargas = signal('');

  // ── Derivados ─────────────────────────────────────────────────────────
  readonly carga = computed(() => this.detalle()?.carga ?? null);
  readonly editable = computed(() => this.carga()?.estado === 'SIMULADA');
  readonly filas = computed(() => this.detalle()?.filas ?? []);
  readonly filasPagos = computed(() => this.filas().filter((f) => f.hoja === 'PAGOS'));
  readonly filasNegaciones = computed(() => this.filas().filter((f) => f.hoja === 'NEGACIONES'));
  readonly resumen = computed(() => resumenVigente(this.detalle()));
  readonly alerta = computed(() => alertaDeCarga(this.resumen()));

  /** Filas que se aplicarian: cruzan y aun no se aplicaron. */
  readonly filasAplicables = computed(() => this.filas().filter((f) => f.resultado === 'CRUZA' && !f.aplicada));
  readonly pagosAplicables = computed(() => this.filasAplicables().filter((f) => f.hoja === 'PAGOS'));
  readonly negacionesAplicables = computed(() => this.filasAplicables().filter((f) => f.hoja === 'NEGACIONES'));
  /** Valor de los pagos que entran al aplicar (o que entraron, si la carga ya se aplico). */
  readonly valorAplicable = computed(() => {
    const filas = this.editable()
      ? this.pagosAplicables()
      : this.filasPagos().filter((f) => f.aplicada);
    return filas.reduce((s, f) => s + Number(f.valorPagado ?? 0), 0);
  });
  readonly filasPorGestionar = computed(() => filasSinCruce(this.filas()));

  readonly filasVisibles = computed(() => {
    const base = this.hoja() === 'PAGOS' ? this.filasPagos() : this.filasNegaciones();
    const filtro = this.filtro();
    if (filtro === 'TODAS') return base;
    if (filtro === 'SIN_HOMOLOGAR') return base.filter((f) => f.sinHomologar);
    return base.filter((f) => f.resultado === filtro);
  });

  /** Chips de filtro rapido de la hoja visible, con su conteo. */
  readonly opcionesFiltro = computed(() => {
    const base = this.hoja() === 'PAGOS' ? this.filasPagos() : this.filasNegaciones();
    const contar = (r: ResultadoFilaLiquidacion) => base.filter((f) => f.resultado === r).length;
    const opciones: { valor: FiltroFilas; etiqueta: string; total: number; clase: string }[] = [
      { valor: 'TODAS', etiqueta: 'Todas', total: base.length, clase: 'ges-chip-neutro' },
      { valor: 'CRUZA', etiqueta: 'Cruzan', total: contar('CRUZA'), clase: claseResultadoFila('CRUZA') },
      { valor: 'NO_CRUZA', etiqueta: 'No cruzan', total: contar('NO_CRUZA'), clase: claseResultadoFila('NO_CRUZA') },
      { valor: 'AMBIGUA', etiqueta: 'Varias posibles', total: contar('AMBIGUA'), clase: claseResultadoFila('AMBIGUA') },
      { valor: 'DUPLICADA', etiqueta: 'Ya registradas', total: contar('DUPLICADA'), clase: claseResultadoFila('DUPLICADA') },
      { valor: 'ERROR', etiqueta: 'Con error', total: contar('ERROR'), clase: claseResultadoFila('ERROR') },
    ];
    if (this.hoja() === 'NEGACIONES') {
      opciones.push({
        valor: 'SIN_HOMOLOGAR', etiqueta: 'Sin homologar',
        total: base.filter((f) => f.sinHomologar).length, clase: 'ges-chip-aviso',
      });
    }
    return opciones;
  });

  // ── Helpers para la plantilla ─────────────────────────────────────────
  readonly pesos = pesos;
  readonly entero = entero;
  readonly fecha = fechaCorta;
  readonly fechaHora = fechaHora;
  readonly codigo = codigoVisible;
  readonly claseResultado = claseResultadoFila;
  readonly claseAccion = claseAccion;
  readonly claseEstadoCarga = claseEstadoCarga;
  readonly claseEstadoIncapacidad = claseEstadoIncapacidad;
  readonly etiquetaAccion = etiquetaAccion;
  readonly etiquetaEstadoCarga = ETIQUETA_ESTADO_CARGA;

  // ── Columnas ──────────────────────────────────────────────────────────

  /**
   * Columnas de la revision. El orden pone primero lo que se usa para decidir (resultado, cedula,
   * fecha de inicio e incapacidad cruzada con sus sugerencias) y deja al final los datos leidos de
   * la plantilla que solo se consultan; en pantallas medianas esos se ocultan (prioridad 3).
   */
  private readonly colFila: ColumnaTabla<FilaLiquidacion> =
    { id: 'fila', header: 'Fila', align: 'right', ancho: '56px', tarjeta: 'meta', valor: (f) => f.fila };
  private readonly colResultado: ColumnaTabla<FilaLiquidacion> = {
    id: 'resultado', header: 'Resultado', tarjeta: 'badge', minAncho: '130px',
    valor: (f) => f.resultadoEtiqueta || RESULTADO_FILA_ETIQUETA[f.resultado],
    badge: (f) => ({ texto: f.resultadoEtiqueta || RESULTADO_FILA_ETIQUETA[f.resultado], tono: tonoDeChip(claseResultadoFila(f.resultado)) }),
  };
  private readonly colCedula: ColumnaTabla<FilaLiquidacion> =
    { id: 'cedula', header: 'Cédula', tarjeta: 'titulo', valor: (f) => f.cedula ?? '', formato: (f) => f.cedula || '—' };
  private readonly colFechaInicio: ColumnaTabla<FilaLiquidacion> = {
    id: 'fechaInicio', header: 'Fecha inicio', tarjeta: 'meta',
    valor: (f) => fechaComoDate(f.fechaInicio), formato: (f) => fechaCorta(f.fechaInicio) || '—', copiaTexto: (f) => fechaCorta(f.fechaInicio),
  };
  private readonly colIncapacidad: ColumnaTabla<FilaLiquidacion> = {
    id: 'incapacidad', header: 'Incapacidad cruzada', interactiva: true, ordenable: false, tarjeta: 'cuerpo', minAncho: '280px',
    valor: (f) => (f.incapacidad ? `${codigoVisible(f.incapacidad)} ${f.incapacidad.nombreCompleto}` : ''),
    copiaTexto: (f) => codigoVisible(f.incapacidad),
  };
  private readonly colEps: ColumnaTabla<FilaLiquidacion> =
    { id: 'eps', header: 'EPS', prioridad: 2, tarjeta: 'subtitulo', minAncho: '110px', valor: (f) => f.eps ?? '', formato: (f) => f.eps || '—' };
  private readonly colCodigo: ColumnaTabla<FilaLiquidacion> =
    { id: 'codigo', header: 'Código leído', prioridad: 3, tarjeta: 'meta', valor: (f) => f.codigoLeido ?? '', formato: (f) => f.codigoLeido || '—' };
  private readonly colDiasLiquidados: ColumnaTabla<FilaLiquidacion> =
    { id: 'diasLiquidados', header: 'Días liq.', align: 'right', prioridad: 3, tarjeta: 'meta', valor: (f) => f.diasLiquidados };

  readonly columnasPagos: ColumnaTabla<FilaLiquidacion>[] = [
    this.colFila,
    this.colResultado,
    this.colCedula,
    this.colFechaInicio,
    this.colIncapacidad,
    { id: 'valor', header: 'Valor pagado', align: 'right', tarjeta: 'meta',
      valor: (f) => f.valorPagado, formato: (f) => pesos(f.valorPagado), copiaTexto: (f) => String(f.valorPagado ?? '') },
    { id: 'fechaPago', header: 'Fecha de pago', tarjeta: 'meta',
      valor: (f) => fechaComoDate(f.fechaPago), formato: (f) => fechaCorta(f.fechaPago) || '—', copiaTexto: (f) => fechaCorta(f.fechaPago) },
    this.colEps,
    this.colDiasLiquidados,
    { id: 'diasAutorizados', header: 'Días aut.', align: 'right', prioridad: 3, tarjeta: 'meta', valor: (f) => f.diasAutorizados },
    { id: 'numeroEps', header: 'N° EPS', prioridad: 3, tarjeta: 'meta', valor: (f) => f.numeroIncapacidadEps ?? '', formato: (f) => f.numeroIncapacidadEps || '—' },
    { id: 'soporte', header: 'Soporte contable', prioridad: 3, tarjeta: 'meta', valor: (f) => f.soporteContable ?? '', formato: (f) => f.soporteContable || '—' },
    this.colCodigo,
  ];

  readonly columnasNegaciones: ColumnaTabla<FilaLiquidacion>[] = [
    this.colFila,
    this.colResultado,
    this.colCedula,
    this.colFechaInicio,
    this.colIncapacidad,
    { id: 'causalEps', header: 'Causal (EPS)', tarjeta: 'cuerpo', minAncho: '200px', valor: (f) => f.causalTexto ?? '' },
    { id: 'causal', header: 'Causal homologada', interactiva: true, tarjeta: 'cuerpo', minAncho: '200px',
      valor: (f) => (f.sinHomologar ? 'Sin homologar' : f.causalNombre ?? f.causalCodigo ?? '') },
    { id: 'fechaRespuesta', header: 'Fecha respuesta', prioridad: 2, tarjeta: 'meta',
      valor: (f) => fechaComoDate(f.fechaRespuesta), formato: (f) => fechaCorta(f.fechaRespuesta) || '—', copiaTexto: (f) => fechaCorta(f.fechaRespuesta) },
    this.colEps,
    this.colDiasLiquidados,
    this.colCodigo,
  ];

  readonly columnasCargas: ColumnaTabla<CargaLiquidacion>[] = [
    { id: 'id', header: 'Carga', ordenable: false, tarjeta: 'meta', valor: (c) => `#${c.id}` },
    { id: 'fecha', header: 'Fecha', ordenable: false, tarjeta: 'subtitulo', valor: (c) => fechaHora(c.creadoEn) },
    { id: 'archivo', header: 'Archivo', ordenable: false, tarjeta: 'titulo', minAncho: '180px', valor: (c) => c.nombreArchivo ?? '', formato: (c) => c.nombreArchivo || '—' },
    { id: 'usuario', header: 'Usuario', ordenable: false, prioridad: 2, tarjeta: 'meta', valor: (c) => c.creadoPor ?? '', formato: (c) => c.creadoPor || '—' },
    { id: 'pagos', header: 'Pagos', ordenable: false, align: 'right', tarjeta: 'meta', valor: (c) => c.filasPagos },
    { id: 'negaciones', header: 'Negaciones', ordenable: false, align: 'right', tarjeta: 'meta', valor: (c) => c.filasNegaciones },
    { id: 'cruzadas', header: 'Cruzadas', ordenable: false, align: 'right', prioridad: 2, tarjeta: 'meta', valor: (c) => c.cruzadas },
    { id: 'noCruzadas', header: 'No cruzadas', ordenable: false, align: 'right', prioridad: 2, tarjeta: 'meta', valor: (c) => c.noCruzadas },
    { id: 'aplicadas', header: 'Aplicadas', ordenable: false, align: 'right', prioridad: 2, tarjeta: 'meta', valor: (c) => c.aplicadas },
    { id: 'estado', header: 'Estado', ordenable: false, tarjeta: 'badge',
      valor: (c) => ETIQUETA_ESTADO_CARGA[c.estado] ?? c.estadoEtiqueta,
      badge: (c) => ({ texto: ETIQUETA_ESTADO_CARGA[c.estado] ?? c.estadoEtiqueta ?? c.estado, tono: tonoDeChip(claseEstadoCarga(c.estado)) }) },
  ];

  readonly idFila = (f: FilaLiquidacion) => f.id;
  readonly idCarga = (c: CargaLiquidacion) => c.id;
  readonly claseFila = (f: FilaLiquidacion): string => {
    if (f.resultado === 'NO_CRUZA' || f.resultado === 'ERROR') return 'te-fila--peligro';
    if (f.resultado === 'AMBIGUA') return 'te-fila--alerta';
    if (f.resultado === 'DUPLICADA') return 'te-fila--atenuada';
    if (f.aplicada) return 'te-fila--ok';
    return f.asignadaManual ? 'te-fila--info' : '';
  };
  readonly claseCarga = (c: CargaLiquidacion): string =>
    c.estado === 'DESCARTADA' || c.estado === 'ANULADA' ? 'te-fila--atenuada' : c.estado === 'SIMULADA' ? 'te-fila--info' : '';

  ngOnInit(): void {
    this.cargarHistorial();
  }

  // ── Plantilla ─────────────────────────────────────────────────────────

  descargarPlantilla(): void {
    this.descargandoPlantilla.set(true);
    this.srv.descargarPlantillaLiquidacion().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (blob) => {
        this.descargandoPlantilla.set(false);
        this.guardarArchivo(blob, NOMBRE_PLANTILLA);
      },
      error: (e: unknown) => {
        this.descargandoPlantilla.set(false);
        void Swal.fire({ icon: 'error', title: 'No se pudo descargar la plantilla', text: mensajeDeError(e, 'Inténtalo de nuevo.') });
      },
    });
  }

  /** Envoltura de `saveAs` (se espia en las pruebas). */
  guardarArchivo(blob: Blob, nombre: string): void {
    saveAs(blob, nombre);
  }

  /** Envoltura de `XLSX.writeFile` (se espia en las pruebas). */
  guardarLibro(libro: XLSX.WorkBook, nombre: string): void {
    escribirLibro(libro, nombre);
  }

  // ── Seleccion del archivo ─────────────────────────────────────────────

  /** Valida extension y tamano y SIMULA de una vez: simular no toca ninguna incapacidad. */
  tomarArchivo(archivo: File): void {
    if (this.simulando()) return;
    if (!archivo.name.toLowerCase().endsWith('.xlsx')) {
      this.errorCarga.set('Solo se acepta la plantilla en Excel (.xlsx).');
      return;
    }
    if (archivo.size > TAMANO_MAXIMO_PLANTILLA) {
      this.errorCarga.set(`El archivo supera el tamaño máximo de ${this.tamanoMaximoTexto}.`);
      return;
    }
    this.simular(archivo);
  }

  alSeleccionarArchivo(evento: Event): void {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0];
    if (archivo) this.tomarArchivo(archivo);
    // Se limpia para que volver a elegir el MISMO archivo dispare `change`.
    input.value = '';
  }

  alArrastrarEncima(evento: DragEvent): void {
    evento.preventDefault();
    this.arrastrando.set(true);
  }

  alSalirArrastre(evento: DragEvent): void {
    evento.preventDefault();
    this.arrastrando.set(false);
  }

  alSoltar(evento: DragEvent): void {
    evento.preventDefault();
    this.arrastrando.set(false);
    const archivo = evento.dataTransfer?.files?.[0];
    if (archivo) this.tomarArchivo(archivo);
  }

  // ── Simular ───────────────────────────────────────────────────────────

  simular(archivo: File): void {
    this.errorCarga.set('');
    this.simulando.set(true);
    this.srv.simularCarga(archivo).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (d) => {
        this.simulando.set(false);
        // Sin conexion el interceptor offline de Electron responde un 200 falso: sin `carga` no
        // hubo simulacion de verdad.
        if (!d?.carga) {
          this.errorCarga.set('No hay conexión con el servidor: la plantilla no se procesó. Inténtalo de nuevo.');
          return;
        }
        this.mostrarDetalle(d);
        this.cargarHistorial();
      },
      error: (e: unknown) => {
        this.simulando.set(false);
        this.errorCarga.set(mensajeDeError(e, 'No se pudo leer la plantilla. Revisa que tenga las hojas Pagos y Negaciones.'));
      },
    });
  }

  private mostrarDetalle(d: CargaLiquidacionDetalle): void {
    this.detalle.set({ ...d, filas: d.filas ?? [] });
    this.filtro.set('TODAS');
    // Abre en la hoja que trae filas (una plantilla solo de negaciones abre en Negaciones).
    const pagos = (d.filas ?? []).some((f) => f.hoja === 'PAGOS') || (d.resumen?.pagos?.total ?? 0) > 0;
    this.hoja.set(pagos ? 'PAGOS' : 'NEGACIONES');
  }

  cambiarHoja(indice: number): void {
    this.hoja.set(indice === 1 ? 'NEGACIONES' : 'PAGOS');
    this.filtro.set('TODAS');
  }

  /** Clic en una tarjeta de la alerta: cambia de hoja y filtra por ese resultado. */
  filtrarPor(hoja: HojaLiquidacion, filtro: FiltroFilas): void {
    this.hoja.set(hoja);
    this.filtro.set(filtro);
  }

  cerrarRevision(): void {
    this.detalle.set(null);
    this.errorCarga.set('');
  }

  private reemplazarFila(fila: FilaLiquidacion): void {
    this.detalle.update((d) => (d ? { ...d, filas: d.filas.map((f) => (f.id === fila.id ? fila : f)) } : d));
  }

  // ── Revision: asignar / soltar ────────────────────────────────────────

  /** Un clic: la fila queda cruzada con la incapacidad sugerida (la EPS reporto otra fecha). */
  asignar(fila: FilaLiquidacion, incapacidad: IncapacidadRef): void {
    this.cambiarAsignacion(fila, incapacidad.id);
  }

  soltar(fila: FilaLiquidacion): void {
    this.cambiarAsignacion(fila, null);
  }

  private cambiarAsignacion(fila: FilaLiquidacion, incapacidadId: number | null): void {
    const carga = this.carga();
    if (!carga || !this.editable() || this.filaOcupada() !== null) return;
    this.filaOcupada.set(fila.id);
    this.srv.asignarFila(carga.id, fila.id, incapacidadId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (actualizada) => {
        this.filaOcupada.set(null);
        this.reemplazarFila(actualizada);
      },
      error: (e: unknown) => {
        this.filaOcupada.set(null);
        void Swal.fire({
          icon: 'error',
          title: incapacidadId ? 'No se pudo asignar la fila' : 'No se pudo soltar la fila',
          text: mensajeDeError(e, 'Inténtalo de nuevo.'),
        });
      },
    });
  }

  // ── Revision: homologar causal ────────────────────────────────────────

  homologar(fila: FilaLiquidacion): void {
    const carga = this.carga();
    if (!carga || !this.editable() || this.filaOcupada() !== null) return;
    this.conCausales((causales) => {
      this.dialogo
        .open<DialogoHomologarFilaComponent, DatosDialogoHomologarFila, ResultadoDialogoHomologarFila | undefined>(
          DialogoHomologarFilaComponent,
          { data: { fila, causales }, width: '620px', maxWidth: '96vw', maxHeight: '92vh', autoFocus: false, panelClass: 'disab-dialogo' },
        )
        .afterClosed()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((r) => {
          if (r) this.aplicarCausal(carga.id, fila, r);
        });
    });
  }

  /** Causales activas (cacheadas mientras viva la pantalla). */
  private conCausales(continuar: (causales: CausalNegacion[]) => void): void {
    if (this.causalesActivas) {
      continuar(this.causalesActivas);
      return;
    }
    this.srv.causales(false).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (c) => {
        this.causalesActivas = (c ?? []).filter((x) => x.activo).sort((a, b) => a.orden - b.orden);
        continuar(this.causalesActivas);
      },
      error: (e: unknown) =>
        void Swal.fire({ icon: 'error', title: 'No se pudieron cargar las causales', text: mensajeDeError(e, 'Inténtalo de nuevo.') }),
    });
  }

  /**
   * Homologa la fila y, si se pidio recordar, tambien las filas HERMANAS de la misma carga (misma
   * EPS y mismo texto normalizado) que siguen sin homologar: la equivalencia ya quedo creada con
   * la primera, a las demas se les manda `recordarEquivalencia=false`.
   */
  private aplicarCausal(cargaId: number, fila: FilaLiquidacion, r: ResultadoDialogoHomologarFila): void {
    this.filaOcupada.set(fila.id);
    this.srv.asignarCausalFila(cargaId, fila.id, r.causalId, r.recordar).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (actualizada) => {
        this.reemplazarFila(actualizada);
        const texto = normalizarCausal(fila.causalTexto);
        const hermanas = r.recordar
          ? this.filasNegaciones().filter(
              (f) => f.id !== fila.id && f.sinHomologar && mismaEps(f.eps, fila.eps) && normalizarCausal(f.causalTexto) === texto,
            )
          : [];
        if (hermanas.length === 0) {
          this.filaOcupada.set(null);
          return;
        }
        this.homologarHermanas(cargaId, hermanas, r.causalId).subscribe({
          next: (n) => {
            this.filaOcupada.set(null);
            void Swal.fire({
              icon: 'success',
              title: 'Causal homologada',
              text: `También se homologaron ${plural(n, 'fila', 'filas')} de esta carga con el mismo texto y la misma EPS.`,
              timer: 3500,
              showConfirmButton: false,
            });
          },
          error: () => this.filaOcupada.set(null),
        });
      },
      error: (e: unknown) => {
        this.filaOcupada.set(null);
        void Swal.fire({ icon: 'error', title: 'No se pudo homologar la causal', text: mensajeDeError(e, 'Inténtalo de nuevo.') });
      },
    });
  }

  /** Cuantas hermanas quedaron homologadas (una que falle no tumba a las demas). */
  private homologarHermanas(cargaId: number, hermanas: FilaLiquidacion[], causalId: number): Observable<number> {
    return from(hermanas).pipe(
      mergeMap(
        (h) =>
          this.srv.asignarCausalFila(cargaId, h.id, causalId, false).pipe(
            map((actualizada) => {
              this.reemplazarFila(actualizada);
              return 1;
            }),
            // Una hermana que falle se queda sin homologar y se ve en la tabla.
            catchError(() => of(0)),
          ),
        CONCURRENCIA_HERMANAS,
      ),
      toArray(),
      map((unos) => unos.reduce((s, v) => s + v, 0)),
      takeUntilDestroyed(this.destroyRef),
    );
  }

  // ── Aplicar / descartar ───────────────────────────────────────────────

  aplicar(): void {
    const carga = this.carga();
    const aplicables = this.filasAplicables().length;
    if (!carga || !this.editable() || aplicables === 0 || this.aplicando()) return;

    const pagos = this.pagosAplicables().length;
    const negaciones = this.negacionesAplicables();
    const finalizan = negaciones.filter((f) => f.accion === 'FINALIZA').length;
    const fuera = this.filas().length - aplicables;
    void Swal.fire({
      icon: 'question',
      title: `Aplicar la carga #${carga.id}`,
      html:
        `<p style="margin:0 0 8px">Se aplicarán <b>${plural(aplicables, 'fila', 'filas')}</b> que cruzan: ` +
        `<b>${plural(pagos, 'pago', 'pagos')}</b> por <b>${escaparHtml(pesos(this.valorAplicable()))}</b> y ` +
        `<b>${plural(negaciones.length, 'negación', 'negaciones')}</b> (${entero(finalizan)} finalizan, ` +
        `${entero(negaciones.length - finalizan)} pasan a recobro).</p>` +
        (fuera > 0
          ? `<p style="margin:0;font-size:13px;color:#b26a00">${plural(fuera, 'fila', 'filas')} que no cruzan, ya registradas o con error <b>no</b> se aplican.</p>`
          : ''),
      showCancelButton: true,
      confirmButtonText: `Aplicar ${plural(aplicables, 'fila', 'filas')}`,
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#1976d2',
    }).then((r) => {
      if (!r.isConfirmed) return;
      this.aplicando.set(true);
      this.srv.aplicarCarga(carga.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (res) => {
          this.aplicando.set(false);
          this.mostrarResultado(res);
          this.recargarDetalle(carga.id);
          this.cargarHistorial();
        },
        error: (e: unknown) => {
          this.aplicando.set(false);
          void Swal.fire({ icon: 'error', title: 'No se pudo aplicar la carga', text: mensajeDeError(e, 'Inténtalo de nuevo.') });
        },
      });
    });
  }

  /** La ventana que pidio la funcional: "Usted acaba de liquidar N incapacidades...". */
  private mostrarResultado(res: ResultadoAplicacion): void {
    const item = (etiqueta: string, valor: string) =>
      `<li style="display:flex;justify-content:space-between;gap:12px;padding:3px 0;border-bottom:1px solid #eee"><span>${etiqueta}</span><b>${valor}</b></li>`;
    void Swal.fire({
      icon: res.noAplicadas > 0 ? 'warning' : 'success',
      title: 'Liquidación aplicada',
      html:
        `<p style="margin:0 0 12px;font-size:15px"><b>${escaparHtml(res.mensaje)}</b></p>` +
        '<ul style="list-style:none;margin:0;padding:0;text-align:left;font-size:13.5px">' +
        item('Incapacidades liquidadas', entero(res.incapacidadesLiquidadas)) +
        item('Pagos aplicados', entero(res.pagosAplicados)) +
        item('Valor de los pagos', escaparHtml(pesos(res.valorTotalPagos))) +
        item('Negaciones aplicadas', entero(res.negacionesAplicadas)) +
        item('Finalizadas', entero(res.finalizadas)) +
        item('Pasan a recobro', entero(res.aRecobro)) +
        item('Filas no aplicadas', entero(res.noAplicadas)) +
        '</ul>',
      confirmButtonText: 'Entendido',
    });
  }

  descartar(): void {
    const carga = this.carga();
    if (!carga || !this.editable()) return;
    void Swal.fire({
      icon: 'warning',
      title: 'Descartar la carga',
      text: `La carga #${carga.id} (${carga.nombreArchivo ?? 'sin nombre'}) no se aplicará. No se toca ninguna incapacidad.`,
      showCancelButton: true,
      confirmButtonText: 'Descartar',
      cancelButtonText: 'Volver',
      confirmButtonColor: '#c62828',
    }).then((r) => {
      if (!r.isConfirmed) return;
      this.srv.descartarCarga(carga.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => {
          this.detalle.set(null);
          this.cargarHistorial();
        },
        error: (e: unknown) =>
          void Swal.fire({ icon: 'error', title: 'No se pudo descartar la carga', text: mensajeDeError(e, 'Inténtalo de nuevo.') }),
      });
    });
  }

  private recargarDetalle(cargaId: number): void {
    this.srv.detalleCarga(cargaId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (d) => {
        const hoja = this.hoja();
        this.detalle.set({ ...d, filas: d.filas ?? [] });
        this.hoja.set(hoja);
      },
      error: () => {
        // El resultado ya se mostro; si el detalle no llega se cierra la revision.
        this.detalle.set(null);
      },
    });
  }

  // ── Exportar ──────────────────────────────────────────────────────────

  exportarSinCruce(): void {
    const filas = this.filasPorGestionar();
    const carga = this.carga();
    if (!carga || filas.length === 0) return;
    this.guardarLibro(libroFilasSinCruce(filas), `liquidacion_sin_cruce_carga${carga.id}_${marcaDeTiempo()}.xlsx`);
  }

  // ── Historial ─────────────────────────────────────────────────────────

  cargarHistorial(): void {
    this.cargandoCargas.set(true);
    this.errorCargas.set('');
    this.srv.cargas(this.paginaCargas(), this.tamanoCargas()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (p) => {
        this.cargas.set(p.content ?? []);
        this.totalCargas.set(p.totalElements ?? 0);
        this.cargandoCargas.set(false);
      },
      error: (e: unknown) => {
        this.cargandoCargas.set(false);
        this.errorCargas.set(mensajeDeError(e, 'No se pudo cargar el historial de cargas.'));
      },
    });
  }

  paginarCargas(e: { pagina: number; porPagina: number }): void {
    this.paginaCargas.set(e.pagina);
    this.tamanoCargas.set(e.porPagina);
    this.cargarHistorial();
  }

  verCarga(c: CargaLiquidacion): void {
    this.srv.detalleCarga(c.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (d) => {
        this.errorCarga.set('');
        this.mostrarDetalle(d);
      },
      error: (e: unknown) =>
        void Swal.fire({ icon: 'error', title: 'No se pudo abrir la carga', text: mensajeDeError(e, 'Inténtalo de nuevo.') }),
    });
  }

  /** Anular una carga APLICADA: confirmacion fuerte (hay que escribir ANULAR). */
  anularCarga(c: CargaLiquidacion): void {
    if (c.estado !== 'APLICADA') return;
    void Swal.fire({
      icon: 'warning',
      title: `Anular la carga #${c.id}`,
      html:
        `<p style="margin:0 0 8px">Se anularán <b>todos los pagos y negaciones</b> que aplicó esta carga ` +
        `(${plural(c.aplicadas, 'fila aplicada', 'filas aplicadas')}) y se recalculará el estado de sus incapacidades.</p>` +
        `<p style="margin:0;font-size:13px;color:#c62828">Archivo: ${escaparHtml(c.nombreArchivo ?? '—')}. Esta acción no se puede deshacer.</p>`,
      input: 'text',
      inputLabel: 'Escribe ANULAR para confirmar',
      inputPlaceholder: 'ANULAR',
      inputValidator: (v) => ((v ?? '').trim().toUpperCase() === 'ANULAR' ? null : 'Escribe ANULAR para confirmar.'),
      showCancelButton: true,
      confirmButtonText: 'Anular carga',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#c62828',
    }).then((r) => {
      if (!r.isConfirmed) return;
      this.srv.anularCarga(c.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (anulada) => {
          void Swal.fire({
            icon: 'success',
            title: 'Carga anulada',
            text: `Se anularon los pagos y negaciones de la carga #${anulada.id}.`,
            timer: 3500,
            showConfirmButton: false,
          });
          if (this.carga()?.id === c.id) this.recargarDetalle(c.id);
          this.cargarHistorial();
        },
        error: (e: unknown) =>
          void Swal.fire({ icon: 'error', title: 'No se pudo anular la carga', text: mensajeDeError(e, 'Inténtalo de nuevo.') }),
      });
    });
  }
}
