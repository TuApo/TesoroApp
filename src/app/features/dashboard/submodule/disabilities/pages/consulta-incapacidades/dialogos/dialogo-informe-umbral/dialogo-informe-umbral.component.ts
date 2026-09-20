import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subscription } from 'rxjs';
import * as XLSX from 'xlsx';

import { ColumnaTabla, TABLA_ESTANDAR, TonoBadge } from '../../../../../../../../shared/components/tabla-estandar';
import {
  FilaInformeUmbral,
  InformeUmbral,
} from '../../../../models/incapacidad-v2.model';
import { IncapacidadV2Service } from '../../../../services/incapacidad-v2/incapacidad-v2.service';
import {
  ESTILO_CHIP_NEUTRO,
  EstiloChip,
} from '../../consulta-incapacidades.model';
import { fechaLegible } from '../../exportacion-incapacidades';

/** Tramos del informe (mismo literal que envia el backend). */
export type TramoUmbral = FilaInformeUmbral['tramo'];

/** Margenes de anticipacion que ofrece el selector, en dias. */
export const MARGENES_UMBRAL: readonly number[] = [15, 30, 60];

/** Margen con el que se abre el dialogo. */
export const MARGEN_UMBRAL_POR_DEFECTO = 30;

/**
 * Colores de los chips por tramo, con el mismo patron `EstiloChip`
 * (fondo suave + texto) de la consulta:
 *  - ambar para los "proximos" a un umbral;
 *  - rojo para quien ya SUPERA los 180 (el pago pasa al fondo de pensiones);
 *  - morados para el umbral de 540 (el pago vuelve a la EPS).
 */
export const COLOR_TRAMO: Readonly<Record<TramoUmbral, EstiloChip>> = {
  PROXIMO_180: { color: '#b26a00', background: '#fff8e1' },
  SUPERA_180: { color: '#c62828', background: '#ffebee' },
  PROXIMO_540: { color: '#6a1b9a', background: '#f3e5f5' },
  SUPERA_540: { color: '#4527a0', background: '#ede7f6' },
};

/**
 * Tono del chip de la tabla estandar por tramo (mismos significados que
 * COLOR_TRAMO, pero con los tonos de la tabla: se ven bien en claro y oscuro).
 */
export const TONO_TRAMO: Readonly<Record<TramoUmbral, TonoBadge>> = {
  PROXIMO_180: 'warn',
  SUPERA_180: 'danger',
  PROXIMO_540: 'violet',
  SUPERA_540: 'violet',
};

/** Fecha del backend como Date local (un 'yyyy-MM-dd' con `new Date()` se leeria en UTC). */
function aFechaLocal(v: string | null | undefined): Date | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/** Definicion visual de cada contador de la cabecera. */
export interface DefinicionTramo {
  tramo: TramoUmbral;
  etiqueta: string;
  icono: string;
  ayuda: string;
}

/** Los 4 contadores, en el orden en que se pintan. */
export const TRAMOS_UMBRAL: readonly DefinicionTramo[] = [
  {
    tramo: 'PROXIMO_180',
    etiqueta: 'Proximo a 180',
    icono: 'schedule',
    ayuda: 'A menos del margen elegido de los 180 dias: el pago pasara al fondo de pensiones',
  },
  {
    tramo: 'SUPERA_180',
    etiqueta: 'Supera 180',
    icono: 'flag',
    ayuda: 'Ya supero los 180 dias: el pago esta a cargo del fondo de pensiones',
  },
  {
    tramo: 'PROXIMO_540',
    etiqueta: 'Proximo a 540',
    icono: 'hourglass_top',
    ayuda: 'A menos del margen elegido de los 540 dias: el pago volvera a la EPS',
  },
  {
    tramo: 'SUPERA_540',
    etiqueta: 'Supera 540',
    icono: 'report',
    ayuda: 'Ya supero los 540 dias: el pago vuelve a estar a cargo de la EPS',
  },
];

/** Cabeceras del Excel, en el orden de las columnas del archivo. */
const CABECERAS_INFORME: readonly string[] = [
  'Cedula',
  'Nombre',
  'Empresa',
  'EPS',
  'AFP',
  'Codigo diagnostico',
  'Diagnostico',
  'Dias acumulados',
  'Fin ultima incapacidad',
  'Responsable de pago',
  'Tramo',
];

/** Anchos de columna del Excel (en caracteres), alineados con las cabeceras. */
const ANCHOS_INFORME: { wch: number }[] = [
  { wch: 14 }, // Cedula
  { wch: 30 }, // Nombre
  { wch: 26 }, // Empresa
  { wch: 18 }, // EPS
  { wch: 16 }, // AFP
  { wch: 12 }, // Codigo diagnostico
  { wch: 38 }, // Diagnostico
  { wch: 14 }, // Dias acumulados
  { wch: 18 }, // Fin ultima incapacidad
  { wch: 22 }, // Responsable de pago
  { wch: 16 }, // Tramo
];

/**
 * Informe pedido por la funcional: personas proximas a (o por encima de) los
 * umbrales de incapacidad acumulada.
 *
 *  - 180 dias: el pago pasa al fondo de pensiones.
 *  - 540 dias: el pago vuelve a la EPS.
 *
 * El dialogo abre pidiendo el informe con margen de 30 dias, deja cambiar el
 * margen (15/30/60) y exporta a Excel. La busqueda (cedula, nombre…), los
 * filtros por columna y el orden los da la tabla estandar.
 * Es SOLO LECTURA: no modifica ninguna incapacidad.
 */
@Component({
  selector: 'app-dialogo-informe-umbral',
  standalone: true,
  imports: [
    MatDialogModule,
    MatIconModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatTooltipModule,
    ...TABLA_ESTANDAR,
  ],
  templateUrl: './dialogo-informe-umbral.component.html',
  styleUrl: './dialogo-informe-umbral.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogoInformeUmbralComponent implements OnDestroy {
  private readonly ref = inject<MatDialogRef<DialogoInformeUmbralComponent>>(MatDialogRef);
  private readonly srv = inject(IncapacidadV2Service);

  /** Peticion en vuelo (se cancela al recargar o al cerrar). */
  private peticion?: Subscription;

  readonly margenes = MARGENES_UMBRAL;
  readonly tramos = TRAMOS_UMBRAL;

  // ── Estado ────────────────────────────────────────────────────────────

  readonly margen = signal<number>(MARGEN_UMBRAL_POR_DEFECTO);
  readonly cargando = signal(false);
  readonly error = signal('');
  /** Ultimo informe recibido (`null` mientras no ha llegado ninguno). */
  private readonly informe = signal<InformeUmbral | null>(null);

  // ── Derivados ─────────────────────────────────────────────────────────

  /** Cuantas personas trae el informe. */
  readonly totalInforme = computed(() => this.informe()?.filas.length ?? 0);

  /** Filas del informe ordenadas por dias acumulados, de mayor a menor (lo que recibe la tabla). */
  readonly filasOrdenadas = computed<FilaInformeUmbral[]>(() => {
    const filas = this.informe()?.filas ?? [];
    return [...filas].sort(
      (a, b) => (b.diasAcumulados ?? 0) - (a.diasAcumulados ?? 0),
    );
  });

  /** Conteo por tramo sobre TODO el informe (los filtros de la tabla no lo alteran). */
  readonly conteosPorTramo = computed<Record<TramoUmbral, number>>(() => {
    const conteos: Record<TramoUmbral, number> = {
      PROXIMO_180: 0,
      SUPERA_180: 0,
      PROXIMO_540: 0,
      SUPERA_540: 0,
    };
    for (const fila of this.informe()?.filas ?? []) {
      if (fila.tramo in conteos) conteos[fila.tramo] += 1;
    }
    return conteos;
  });

  /** El informe llego y no trae a nadie. */
  readonly informeVacio = computed(
    () =>
      !this.cargando() &&
      !this.error() &&
      this.informe() !== null &&
      this.totalInforme() === 0,
  );

  readonly puedeExportar = computed(
    () => !this.cargando() && this.filasOrdenadas().length > 0,
  );

  // ── Tabla (estandar) ──────────────────────────────────────────────────

  readonly columnas: ColumnaTabla<FilaInformeUmbral>[] = [
    { id: 'cedula', header: 'Cedula', valor: (f) => f.cedula, tarjeta: 'subtitulo' },
    { id: 'nombre', header: 'Nombre', valor: (f) => f.nombreCompleto, tarjeta: 'titulo', minAncho: '150px' },
    { id: 'empresa', header: 'Empresa', valor: (f) => f.empresa ?? '', formato: (f) => f.empresa || '—', tarjeta: 'cuerpo' },
    { id: 'eps', header: 'EPS', valor: (f) => f.eps ?? '', formato: (f) => f.eps || '—', prioridad: 2, tarjeta: 'meta' },
    { id: 'afp', header: 'AFP', valor: (f) => f.afp ?? '', formato: (f) => f.afp || '—', prioridad: 3, tarjeta: 'meta' },
    { id: 'diagnostico', header: 'Diagnostico', valor: (f) => f.codigoDiagnostico ?? '', prioridad: 2,
      tarjeta: 'cuerpo', minAncho: '160px' },
    { id: 'dias', header: 'Dias acum.', valor: (f) => f.diasAcumulados, align: 'right', tarjeta: 'meta' },
    { id: 'fin', header: 'Fin ultima', valor: (f) => aFechaLocal(f.fechaFinUltima),
      formato: (f) => this.fecha(f.fechaFinUltima), copiaTexto: (f) => fechaLegible(f.fechaFinUltima),
      prioridad: 2, tarjeta: 'meta' },
    { id: 'responsable', header: 'Responsable de pago', prioridad: 3, tarjeta: 'meta',
      valor: (f) => f.responsablePagoEtiqueta || f.responsablePago || '',
      formato: (f) => f.responsablePagoEtiqueta || f.responsablePago || '—' },
    { id: 'tramo', header: 'Tramo', valor: (f) => this.etiquetaTramo(f), tarjeta: 'badge',
      badge: (f) => ({
        texto: this.etiquetaTramo(f),
        tono: TONO_TRAMO[f.tramo] ?? 'neutro',
        icono: this.tramos.find((t) => t.tramo === f.tramo)?.icono,
      }) },
  ];

  readonly idFila = (f: FilaInformeUmbral) => f.incapacidadId;

  constructor() {
    this.cargar();
  }

  // ── Carga ─────────────────────────────────────────────────────────────

  /** Pide el informe con el margen actual. Cancela la peticion anterior. */
  cargar(): void {
    this.peticion?.unsubscribe();
    this.cargando.set(true);
    this.error.set('');

    this.peticion = this.srv.proximosUmbral(this.margen()).subscribe({
      next: (informe) => {
        this.informe.set(informe);
        this.cargando.set(false);
      },
      error: () => {
        this.cargando.set(false);
        this.error.set(
          'No se pudo cargar el informe de umbrales. Intentalo de nuevo.',
        );
      },
    });
  }

  /** Cambia el margen de anticipacion y recarga. Ignora valores desconocidos. */
  cambiarMargen(valor: number): void {
    if (!this.margenes.includes(valor) || valor === this.margen()) return;
    this.margen.set(valor);
    this.cargar();
  }

  reintentar(): void {
    this.cargar();
  }

  cerrar(): void {
    this.peticion?.unsubscribe();
    this.ref.close();
  }

  // ── Presentacion ──────────────────────────────────────────────────────

  estiloTramo(tramo: TramoUmbral): EstiloChip {
    return COLOR_TRAMO[tramo] ?? ESTILO_CHIP_NEUTRO;
  }

  conteoTramo(tramo: TramoUmbral): number {
    return this.conteosPorTramo()[tramo] ?? 0;
  }

  /** Etiqueta del tramo: la del backend y, si no llega, la local. */
  etiquetaTramo(fila: FilaInformeUmbral): string {
    const propia = (fila.tramoEtiqueta ?? '').trim();
    if (propia) return propia;
    return (
      this.tramos.find((t) => t.tramo === fila.tramo)?.etiqueta ?? fila.tramo
    );
  }

  /** `dd/MM/yyyy` o guion largo si el backend no envia la fecha. */
  fecha(valor: string | null | undefined): string {
    return fechaLegible(valor) || '—';
  }

  // ── Exportacion ───────────────────────────────────────────────────────

  /**
   * Genera el .xlsx en el CLIENTE (SheetJS, como el dialogo de exportar) con
   * el informe completo y el formato de la funcional (AFP, codigo y
   * descripcion del diagnostico por separado). Para bajar solo lo filtrado
   * esta el boton «Excel» de la propia tabla.
   */
  exportarExcel(): void {
    if (!this.puedeExportar()) return;

    const datos = this.filasOrdenadas().map((fila) => ({
      Cedula: fila.cedula ?? '',
      Nombre: fila.nombreCompleto ?? '',
      Empresa: fila.empresa ?? '',
      EPS: fila.eps ?? '',
      AFP: fila.afp ?? '',
      'Codigo diagnostico': fila.codigoDiagnostico ?? '',
      Diagnostico: fila.descripcionDiagnostico ?? '',
      'Dias acumulados': fila.diasAcumulados ?? '',
      'Fin ultima incapacidad': fechaLegible(fila.fechaFinUltima),
      'Responsable de pago':
        fila.responsablePagoEtiqueta ?? fila.responsablePago ?? '',
      Tramo: this.etiquetaTramo(fila),
    }));

    const hoja = XLSX.utils.json_to_sheet(datos, {
      header: [...CABECERAS_INFORME],
    });
    hoja['!cols'] = ANCHOS_INFORME;
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Informe umbral');
    XLSX.writeFile(libro, this.nombreArchivo());
  }

  /** `informe_umbral_30dias_20260818_1030.xlsx`. */
  private nombreArchivo(ahora = new Date()): string {
    const p = (n: number) => String(n).padStart(2, '0');
    const marca =
      `${ahora.getFullYear()}${p(ahora.getMonth() + 1)}${p(ahora.getDate())}` +
      `_${p(ahora.getHours())}${p(ahora.getMinutes())}`;
    return `informe_umbral_${this.margen()}dias_${marca}.xlsx`;
  }

  ngOnDestroy(): void {
    this.peticion?.unsubscribe();
  }
}
