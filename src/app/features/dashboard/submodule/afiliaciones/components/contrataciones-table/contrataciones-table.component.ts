import {
  Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, AfterViewInit,
  ChangeDetectionStrategy, ChangeDetectorRef, inject, viewChild
} from '@angular/core';
import { formatDate } from '@angular/common';
import {
  ColumnaTabla, OrdenTabla, TABLA_ESTANDAR, TablaEstandarComponent, TonoBadge, ValorCelda
} from '../../../../../../shared/components/tabla-estandar';
import { ContratacionRow } from '../../models/afiliaciones-dashboard.models';

const COLLATOR = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

/** 'aaaa-mm-dd' (o ISO con hora) → Date local, igual que el DatePipe; así ordena como fecha. */
function aFecha(v: string | null | undefined): Date | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/** dd/MM/aaaa, o '-' si no hay fecha. */
function fechaCorta(v: string | null | undefined): string {
  const d = aFecha(v);
  return d ? formatDate(d, 'dd/MM/yyyy', 'en-US') : '-';
}

/** Compara dos valores planos para el orden de la página; los vacíos siempre al final. */
function comparar(a: ValorCelda, b: ValorCelda, signo: number): number {
  const vacioA = a === null || a === undefined || a === '';
  const vacioB = b === null || b === undefined || b === '';
  if (vacioA || vacioB) return vacioA === vacioB ? 0 : vacioA ? 1 : -1;
  if (a instanceof Date && b instanceof Date) return (a.getTime() - b.getTime()) * signo;
  return COLLATOR.compare(String(a), String(b)) * signo;
}

/** Tono del chip de estado del proceso de contratación. */
function tonoEstado(estado: string): TonoBadge {
  const mapa: Record<string, TonoBadge> = {
    'Ingreso': 'ok',
    'Contratado': 'info',
    'Exámenes Médicos': 'warn',
    'En Proceso': 'info',
    'Entrevistado': 'violet',
    'Pendiente': 'warn',
    'Rechazado': 'danger'
  };
  return mapa[estado] || 'warn';
}

/**
 * Consolidado de contrataciones del dashboard de Afiliaciones, sobre la tabla estándar.
 *
 * La paginación es del servidor: `data` trae solo la página actual y cada cambio de página
 * o de tamaño sale por `pageChange`. El backend no busca ni ordena por columna, así que la
 * búsqueda de la tabla va apagada y el orden (como antes con MatSort) reordena solo la
 * página visible.
 */
@Component({
  selector: 'app-contrataciones-table',
  standalone: true,
  imports: [...TABLA_ESTANDAR],
  template: `
    <app-tabla-estandar
      id="afiliaciones-consolidado-contrataciones"
      titulo="Consolidado de contrataciones"
      modulo="Afiliaciones"
      [busqueda]="false"
      vacio="No se encontraron registros de contratación para el rango seleccionado"
      [datos]="filas"
      [columnas]="columnas"
      [filaId]="idFila"
      [totalServidor]="total"
      [filasPorPagina]="pageSize"
      (paginaCambio)="onPage($event)"
      (ordenCambio)="onOrden($event)" />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ContratacionesTableComponent implements OnChanges, AfterViewInit {
  /** Filas de la página ACTUAL (la paginación es server-side). */
  @Input() data: ContratacionRow[] | null = [];
  /** Total de filas que coinciden con el filtro (para el paginador). */
  @Input() total = 0;
  /** Índice de página actual (fuente única: el estado del servicio). */
  @Input() pageIndex = 0;
  /** Tamaño de página actual. */
  @Input() pageSize = 50;
  /** Emite cuando el usuario cambia de página o de tamaño. */
  @Output() pageChange = new EventEmitter<{ page: number; size: number }>();

  private cdr = inject(ChangeDetectorRef);
  private readonly tabla = viewChild(TablaEstandarComponent);

  /** Página visible, ya ordenada si el usuario eligió un orden. */
  filas: ContratacionRow[] = [];
  private orden: OrdenTabla | null = null;

  readonly columnas: ColumnaTabla<ContratacionRow>[] = [
    { id: 'numero_documento', header: 'Documento', valor: (r) => r.numero_documento ?? '', tarjeta: 'subtitulo' },
    { id: 'nombre_completo', header: 'Nombre Completo', valor: (r) => r.nombre_completo ?? '',
      formato: (r) => r.nombre_completo || 'Sin nombre', tarjeta: 'titulo', minAncho: '180px' },
    { id: 'empresa', header: 'Empresa', valor: (r) => r.empresa ?? '', tarjeta: 'cuerpo',
      badge: (r) => (r.empresa ? { texto: r.empresa, tono: 'info' } : null) },
    { id: 'oficina', header: 'Oficina', valor: (r) => r.oficina ?? '', formato: (r) => r.oficina || '-', tarjeta: 'cuerpo' },
    // Finca o, si no hay, el centro de costo.
    { id: 'finca', header: 'Finca / CC', valor: (r) => r.finca || r.centro_costo || '',
      formato: (r) => r.finca || r.centro_costo || '-', prioridad: 2, tarjeta: 'cuerpo' },
    { id: 'cargo', header: 'Cargo', valor: (r) => r.cargo ?? '', formato: (r) => r.cargo || '-', prioridad: 2, tarjeta: 'cuerpo' },
    // Las dos fechas del negocio, juntas: la firma (anclaje del rango) y el ingreso.
    { id: 'fecha_firma_contrato', header: 'Firma Contrato', valor: (r) => aFecha(r.fecha_firma_contrato),
      formato: (r) => fechaCorta(r.fecha_firma_contrato), tarjeta: 'meta' },
    { id: 'fecha_ingreso', header: 'Fecha Ingreso', valor: (r) => aFecha(r.fecha_ingreso),
      formato: (r) => fechaCorta(r.fecha_ingreso), tarjeta: 'meta' },
    { id: 'estado', header: 'Estado', valor: (r) => r.estado ?? '', tarjeta: 'badge',
      badge: (r) => ({ texto: r.estado, tono: tonoEstado(r.estado) }) },
    { id: 'usuario_responsable', header: 'Responsable', valor: (r) => r.usuario_responsable ?? '',
      formato: (r) => r.usuario_responsable || '-', prioridad: 3, tarjeta: 'cuerpo' },
    { id: 'contratado_at', header: 'Contratado', valor: (r) => aFecha(r.contratado_at),
      formato: (r) => fechaCorta(r.contratado_at), prioridad: 3, tarjeta: 'oculto' },
    { id: 'examenes_medicos_at', header: 'Ex. Médicos', valor: (r) => aFecha(r.examenes_medicos_at),
      formato: (r) => fechaCorta(r.examenes_medicos_at), prioridad: 3, tarjeta: 'meta' },
  ];

  readonly idFila = (r: ContratacionRow) => r.id;

  ngOnChanges(changes: SimpleChanges) {
    if (changes['data']) this.ordenarPagina();
    if (changes['pageIndex']) this.sincronizarPagina();
  }

  ngAfterViewInit() {
    this.sincronizarPagina();
  }

  onPage(e: { pagina: number; porPagina: number }) {
    this.pageChange.emit({ page: e.pagina, size: e.porPagina });
  }

  /** El orden reordena solo la página visible (la paginación real es server-side). */
  onOrden(o: OrdenTabla | null) {
    this.orden = o;
    this.ordenarPagina();
    // Al ordenar, la tabla vuelve a la página 1; aquí no se consulta otra página, así que
    // se le devuelve el número de la que sigue en pantalla.
    this.sincronizarPagina();
    this.cdr.markForCheck();
  }

  private ordenarPagina(): void {
    const base = this.data || [];
    const o = this.orden;
    const col = o ? this.columnas.find((c) => c.id === o.columna) : undefined;
    if (!o || !col) { this.filas = base; return; }
    const signo = o.direccion === 'asc' ? 1 : -1;
    this.filas = [...base].sort((a, b) => comparar(col.valor(a), col.valor(b), signo));
  }

  /**
   * En modo servidor la tabla lleva su propio número de página. Cuando el servicio vuelve a
   * la primera (cambio de filtro o de rango) hay que decírselo, o el paginador quedaría
   * mostrando la página anterior.
   */
  private sincronizarPagina(): void {
    this.tabla()?.pagina.set(this.pageIndex);
  }
}
