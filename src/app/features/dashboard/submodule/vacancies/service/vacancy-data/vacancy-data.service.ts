import { Injectable, computed, inject, signal } from '@angular/core';

import { VacantesService } from '../vacantes/vacantes.service';
import {
  ConteoEstados,
  DetalleCargoPayload,
  VacanteRow,
  aFecha,
  conteoVacio,
  salarioOMinimo,
} from '../../models/vacante.model';

/**
 * `detalles_cargo` → [{detalle, cantidad}] limpio.
 *
 * Se descartan las líneas sin texto y las cantidades quedan en entero ≥ 1: el
 * diálogo las pinta directamente en su FormArray y una fila con cantidad 0 o sin
 * detalle solo podría bloquear el guardado sin que se vea por qué.
 */
function normalizarDetalles(raw: unknown): DetalleCargoPayload[] {
  let lista: unknown = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return [];
    try { lista = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(lista)) return [];
  return lista
    .map((d: any): DetalleCargoPayload => ({
      detalle: (d?.detalle ?? '').toString().trim(),
      cantidad: Math.max(1, Math.trunc(Number(d?.cantidad)) || 1),
    }))
    .filter((d) => !!d.detalle);
}

/** Qué conjunto está cargado; el backend los sirve por separado. */
export type ConjuntoCargado = 'activas' | 'inactivas';

/**
 * Única fuente de las filas de vacantes de todo el submódulo.
 *
 * "Listado de Vacantes" e "Indicadores de Vacantes" son dos pantallas pero UN
 * solo universo de datos: si cada una pidiera y normalizara lo suyo acabarían
 * contando distinto (y pegándole dos veces al backend al cambiar de pestaña).
 * Aquí se centraliza la carga, el `mapRow` y los derivados del embudo; las
 * pantallas solo leen `rows()`.
 *
 * `cargar()` no repite la petición si el conjunto pedido ya está en memoria:
 * navegar entre las dos vistas no vuelve a llamar al backend. Después de
 * escribir (crear/editar/inactivar/eliminar) se usa `recargar()`, que sí fuerza.
 */
@Injectable({ providedIn: 'root' })
export class VacancyDataService {
  private readonly api = inject(VacantesService);

  private readonly _rows = signal<VacanteRow[]>([]);
  private readonly _loading = signal(false);
  private readonly _conjunto = signal<ConjuntoCargado | null>(null);

  /** Filas normalizadas del conjunto cargado (SIN filtrar). */
  readonly rows = this._rows.asReadonly();
  readonly loading = this._loading.asReadonly();
  /** Qué conjunto hay en memoria; `null` mientras no se ha cargado nada. */
  readonly conjunto = this._conjunto.asReadonly();
  readonly hayDatos = computed(() => this._rows().length > 0);

  /**
   * Trae activas o inactivas.
   *
   * @param soloInactivas pestaña "Inactivas".
   * @param force vuelve a pedir aunque el conjunto ya esté cargado.
   */
  cargar(soloInactivas: boolean, force = false): void {
    const pedido: ConjuntoCargado = soloInactivas ? 'inactivas' : 'activas';
    if (!force && this._conjunto() === pedido) return;

    this._loading.set(true);
    this._conjunto.set(pedido);

    this.api.listarVacantes(soloInactivas ? false : true).subscribe({
      next: (response: any) => {
        const filas = Array.isArray(response) ? response : [];
        this._rows.set(filas.map((r) => this.enrichComputed(this.mapRow(r))));
      },
      // Se conserva el comportamiento previo: el error no vacía lo que ya se
      // mostraba ni interrumpe con un modal; solo apaga el "cargando".
      error: () => { },
      complete: () => this._loading.set(false),
    });
  }

  /** Vuelve a pedir el conjunto que esté cargado. Tras crear/editar/borrar. */
  recargar(): void {
    this.cargar(this._conjunto() === 'inactivas', true);
  }

  /**
   * Descarta lo cargado. Lo llama el shell al salir del módulo: saltar entre
   * "Listado" e "Indicadores" reutiliza los datos (no repite la petición), pero
   * volver a entrar a Vacantes carga de cero, como antes de la separación.
   */
  limpiar(): void {
    this._rows.set([]);
    this._conjunto.set(null);
    this._loading.set(false);
  }

  /**
   * Reemplaza una fila en memoria (sin ir al backend).
   *
   * Lo usa el listado para el toggle Activo/Inactivo, que ya era optimista:
   * pintaba el cambio antes de la respuesta y revertía si fallaba.
   */
  reemplazarFila(id: number | string, cambios: Partial<VacanteRow>): void {
    this._rows.update((filas) =>
      filas.map((f) => (f.id === id ? this.enrichComputed({ ...f, ...cambios }) : f)),
    );
  }

  // ================== Normalización (movido tal cual del componente) ==================

  private mapRow(r: any): VacanteRow {
    const municipioArr = Array.isArray(r?.municipio)
      ? r.municipio
      : (Array.isArray(r?.municipios) ? r.municipios : []);

    // ms-automation pasó a snake_case (`tuapo.json.snake-case`, 26-ago) y estas
    // dos claves se quedaron leyéndose en camelCase, así que llegaban vacías:
    //   · sin `municipiosDistribucion`, editar una vacante existente abría la
    //     distribución en blanco y el guardado se bloqueaba con "faltan
    //     municipios" para TODOS los municipios de la vacante;
    //   · sin `ubicacionPruebaTecnica`, el campo abría vacío y el siguiente
    //     guardado borraba la ubicación guardada.
    // Se normaliza aquí, que es el único sitio por el que entran las filas, en
    // vez de en cada consumidor. Se aceptan las dos grafías: el backend también
    // las acepta al escribir, así que un rollback del servicio no rompe nada.
    const distribucion = Array.isArray(r?.municipiosDistribucion)
      ? r.municipiosDistribucion
      : (Array.isArray(r?.municipios_distribucion) ? r.municipios_distribucion : []);
    const ubicacionPrueba = r?.ubicacionPruebaTecnica ?? r?.ubicacion_prueba_tecnica ?? null;

    // Desglose por detalle de cargo (columna JSON `detalles_cargo`, V17). Llega como
    // array —el backend la sirve cruda con @JsonRawValue— pero se tolera el texto JSON
    // por si algún consumidor la reenvía ya serializada. Las vacantes anteriores a la
    // columna llegan sin ella: [] y el diálogo la siembra al abrirse.
    const detalles = normalizarDetalles(r?.detallesCargo ?? r?.detalles_cargo);

    return {
      ...r,
      activo: typeof r?.activo === 'boolean' ? r.activo : true,
      motivo_inactivacion: r?.motivo_inactivacion ?? '',

      salario: salarioOMinimo(r?.salario),
      municipio: municipioArr,
      observacionVacante: r?.observacion ?? '',
      preseleccionados: Array.isArray(r?.preseleccionados) ? r.preseleccionados : [],
      contratados: Array.isArray(r?.contratados) ? r.contratados : [],
      personas_solicitadas: Number(r?.personas_solicitadas) || 0,
      municipiosDistribucion: distribucion,
      detallesCargo: detalles,
      ubicacionPruebaTecnica: ubicacionPrueba,
      // Las fechas se normalizan a Date LOCAL y no se dejan como 'YYYY-MM-DD'.
      // La tabla las pinta con `new Date(valor)`, y sobre un texto así JS lo
      // interpreta en UTC: en Colombia (UTC-5) '2026-09-01' se mostraba como
      // 31/08. `aFecha` lo arma en local, y todos los consumidores —filtros,
      // días de demora, ingreso vencido y el diálogo de edición— ya aceptan Date.
      fecha_publicado: aFecha(r?.fecha_publicado),
      fechadeIngreso: aFecha(r?.fechadeIngreso ?? r?.fecha_de_ingreso),
      fechadePruebatecnica: aFecha(r?.fechadePruebatecnica ?? r?.fecha_de_prueba_tecnica),
      cargo: r?.cargo ?? null,
      finca: r?.finca ?? '',
      experiencia: r?.experiencia ?? '',
      auxilio_transporte: r?.auxilio_transporte ?? 'No',
      tipo_contratacion: r?.tipo_contratacion ?? '',
      conteo_estados: (r?.conteo_estados as ConteoEstados) || conteoVacio(),
    } as VacanteRow;
  }

  /** Derivados del embudo: requeridos, faltantes, etapas y % de cumplimiento. */
  private enrichComputed(row: any): VacanteRow {
    const req = Number(row?.personas_solicitadas) || 0;
    const ce = this.ce(row);

    const entrev = ce.entrevistado;
    const prueba = ce.prueba_tecnica;
    const auto = ce.autorizado;
    const exm = ce.examenes_medicos;
    const firm = ce.contratado;
    const ing = ce.ingreso;

    const falt = Math.max(0, req - firm);
    const cumpl = req ? Math.max(0, Math.min(100, Math.round((firm / req) * 100))) : 0;

    return {
      ...row,
      req,
      falt,
      entrev,
      prueba,
      auto,
      exm,
      firm,
      ing,
      cumpl,
      municipioLabel: Array.isArray(row?.municipio) ? row.municipio.join(', ') : '',
    } as VacanteRow;
  }

  private ce(v: any): ConteoEstados {
    return (v?.conteo_estados as ConteoEstados) || conteoVacio();
  }
}
