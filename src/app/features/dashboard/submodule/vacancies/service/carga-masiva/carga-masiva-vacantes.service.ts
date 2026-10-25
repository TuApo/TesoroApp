import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom, forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';
import { sedeOfrecidaEnSeleccion } from '@/app/shared/utils/sedes-seleccion';
import {
  CargoAutorizado,
  CentroGrupoPago,
  CentroVacante,
  ConfiguracionCentroCargo,
  EmpresaVacante,
  GrupoPago,
  ParametrizacionVacantesService,
} from '../../../users/services/parametrizacion-vacantes/parametrizacion-vacantes.service';
import { OpcionTemporal, VacancyCascadeService, canonicalTemporal } from '../vacancy-cascade/vacancy-cascade.service';
import { VacantesService } from '../vacantes/vacantes.service';
import { PRODUCTO_NO_APLICA, conNoAplica, productosParaGuardar } from '../../models/producto-finca';

/**
 * CARGA MASIVA DE VACANTES DESDE EXCEL
 * ====================================
 *
 * Tres pasos, todos en el navegador:
 *
 *   1. `descargarPlantilla()` arma el Excel con los catálogos VIVOS (centros habilitados,
 *      cargos por centro, perfiles, oficinas, grupos de pago, municipios) y desplegables
 *      que apuntan a ellos. Se genera al pedirla: una plantilla guardada de hace un mes
 *      ofrecería centros que ya no están habilitados.
 *
 *   2. `validar()` lee el archivo y pasa CADA fila por los mismos resolutores que usa el
 *      diálogo de Crear Vacante (modo del centro, áreas, cargos autorizados, labor, grupo
 *      de pago y casino). Lo que el diálogo no deja guardar, aquí es un ERROR; lo que el
 *      diálogo solo avisa (labor o casino sin resolver), aquí es una ADVERTENCIA.
 *
 *   3. `crear()` publica fila por fila con el mismo POST del diálogo. Si una falla, se
 *      BORRAN las que ya se habían creado en esta carga: o entran todas o ninguna. Una
 *      vacante recién creada no tiene procesos colgando, así que borrarla es seguro.
 *
 * LO QUE NO HACE, A PROPÓSITO
 * ---------------------------
 * - No asigna grupos de pago a los centros. El diálogo sí lo hace (pidiendo el
 *   calendario), pero aquí sería escribir en el parametrizador por cada fila de un Excel
 *   sin que nadie lo vea: un grupo que el centro no tiene es un error de la fila.
 * - No acepta centros del maestro (temporales sin parametrizar). El maestro no tiene id
 *   y el nombre de la finca se repite entre empresas: sería volver a elegir por nombre.
 */

// ════════════════════════════════════════════════════════════════════════════
// Tipos
// ════════════════════════════════════════════════════════════════════════════

/** Centro habilitado del parametrizador, con lo que la plantilla necesita. */
export interface CentroCatalogo {
  id: number;
  /** Lo que se escribe en la columna: único gracias al [P<id>] del final. */
  etiqueta: string;
  finca: string;
  empresa: string | null;
  temporal: 'APOYO LABORAL SAS' | 'TU ALIANZA SAS' | null;
  direccion: string | null;
  salario: number | null;
  auxilio_transporte: boolean | null;
  ciudad: string | null;
}

export interface Catalogos {
  temporales: OpcionTemporal[];
  centros: CentroCatalogo[];
  configuraciones: ConfiguracionCentroCargo[];
  perfiles: string[];
  sedes: string[];
  municipios: string[];
  gruposPago: GrupoPago[];
}

export type EstadoFila = 'ok' | 'advertencia' | 'error';

export interface FilaValidada {
  /** Número de fila en el Excel (la cabecera es la 1). */
  fila: number;
  estado: EstadoFila;
  errores: string[];
  advertencias: string[];
  /** Resumen para la tabla de vista previa. */
  resumen: {
    centro: string;
    cargo: string;
    personas: number | null;
    vinculacion: string;
    fecha: string;
    labor: string | null;
    grupoPago: string | null;
  };
  /** Cuerpo del POST; solo cuando la fila no tiene errores. */
  payload: Record<string, unknown> | null;
}

export interface ResultadoCreacion {
  ok: boolean;
  creadas: number;
  /** Fila del Excel que falló y por qué (solo si `ok` es false). */
  filaFallida?: number;
  mensaje?: string;
  /** Ids que no se pudieron borrar al deshacer: hay que revisarlos a mano. */
  sinDeshacer?: Array<number | string>;
}

// ════════════════════════════════════════════════════════════════════════════
// Columnas de la plantilla
// ════════════════════════════════════════════════════════════════════════════

/**
 * Clave interna → cabecera visible. El orden es el de la plantilla.
 *
 * Todo lo que existe parametrizado se elige de una LISTA, nunca se escribe: así nadie
 * tiene que copiar nombres de otra hoja. Centro, área, cargo y grupo de pago son listas
 * ENCADENADAS (cada una depende de lo elegido a su izquierda). Perfil, oficina y
 * municipio admiten varios valores, y como una celda de Excel solo deja elegir uno, van
 * en columnas numeradas.
 */
const COLUMNAS = [
  { clave: 'temporal', titulo: 'TEMPORAL *', ancho: 22, nota: 'Elige de la lista.' },
  { clave: 'centro', titulo: 'CENTRO DE COSTO *', ancho: 55, nota: 'La lista muestra solo los centros de la temporal elegida. El código [P…] del final identifica el centro.' },
  { clave: 'area', titulo: 'ÁREA OPERATIVA', ancho: 16, nota: 'La lista muestra las áreas del centro elegido. Si sale vacía, el centro no trabaja por área: déjala en blanco.' },
  { clave: 'cargo', titulo: 'CARGO *', ancho: 40, nota: 'La lista muestra los cargos autorizados en ese centro (y área). Elige primero centro y área.' },
  { clave: 'perfil_1', titulo: 'PRODUCTO FINCA 1', ancho: 18, nota: 'Opcional. Elige de la lista. Vacío = No aplica.' },
  { clave: 'perfil_2', titulo: 'PRODUCTO FINCA 2', ancho: 18, nota: 'Opcional: otro producto.' },
  { clave: 'perfil_3', titulo: 'PRODUCTO FINCA 3', ancho: 18, nota: 'Opcional: otro producto.' },
  { clave: 'personas', titulo: 'PERSONAS SOLICITADAS *', ancho: 14, nota: 'Número entero, mínimo 1.' },
  { clave: 'detalle', titulo: 'DETALLE DEL CARGO', ancho: 32, nota: 'Desglose del total: «Corte:2; Poscosecha:1». La suma debe ser igual al total. Vacío = una sola línea con el nombre del cargo.' },
  { clave: 'tipo', titulo: 'TIPO DE CONTRATACIÓN', ancho: 22, nota: 'Vacío = Obra Labor. El rol CONTRATACIÓN solo puede publicar Obra Labor.' },
  { clave: 'experiencia', titulo: 'EXPERIENCIA *', ancho: 13, nota: 'Elige de la lista.' },
  { clave: 'descripcion', titulo: 'CARACTERÍSTICAS DEL CARGO *', ancho: 40, nota: 'Texto libre (lo que en el formulario es «Características del cargo»).' },
  { clave: 'codigo_bot', titulo: 'CÓDIGO BOT', ancho: 12, nota: 'Opcional.' },
  { clave: 'grupo_pago', titulo: 'GRUPO DE PAGO', ancho: 16, nota: 'La lista muestra los grupos asignados al centro elegido. Vacío = el único que tenga el centro.' },
  { clave: 'vinculacion', titulo: 'VINCULACIÓN *', ancho: 24, nota: 'Elige de la lista.' },
  { clave: 'fecha_ingreso', titulo: 'FECHA DE INGRESO', ancho: 15, nota: 'dd/mm/aaaa. Obligatoria en contratación inmediata; opcional en prueba técnica. De ella sale la labor.' },
  { clave: 'fecha_prueba', titulo: 'FECHA DE PRUEBA', ancho: 15, nota: 'dd/mm/aaaa. Obligatoria en prueba técnica. No puede ser posterior al ingreso.' },
  { clave: 'hora_prueba', titulo: 'HORA DE PRUEBA', ancho: 12, nota: 'Elige de la lista o escribe HH:mm (24 h). Obligatoria en prueba técnica.' },
  { clave: 'ubicacion_prueba', titulo: 'UBICACIÓN DE LA PRUEBA', ancho: 26, nota: 'Opcional.' },
  { clave: 'oficina_1', titulo: 'OFICINA QUE CONTRATA 1 *', ancho: 18, nota: 'Elige de la lista.' },
  { clave: 'oficina_2', titulo: 'OFICINA QUE CONTRATA 2', ancho: 18, nota: 'Opcional: otra oficina.' },
  { clave: 'oficina_3', titulo: 'OFICINA QUE CONTRATA 3', ancho: 18, nota: 'Opcional: otra oficina.' },
  { clave: 'municipio_1', titulo: 'MUNICIPIO 1 *', ancho: 20, nota: 'Elige de la lista (puedes escribir las primeras letras).' },
  { clave: 'cantidad_1', titulo: 'CANTIDAD MUNICIPIO 1', ancho: 11, nota: 'Personas para este municipio. Con un solo municipio puede ir vacía (= el total).' },
  { clave: 'municipio_2', titulo: 'MUNICIPIO 2', ancho: 20, nota: 'Opcional.' },
  { clave: 'cantidad_2', titulo: 'CANTIDAD MUNICIPIO 2', ancho: 11, nota: 'Obligatoria si hay municipio 2.' },
  { clave: 'municipio_3', titulo: 'MUNICIPIO 3', ancho: 20, nota: 'Opcional.' },
  { clave: 'cantidad_3', titulo: 'CANTIDAD MUNICIPIO 3', ancho: 11, nota: 'Obligatoria si hay municipio 3. La suma de cantidades debe ser igual al total.' },
  { clave: 'salario', titulo: 'SALARIO', ancho: 14, nota: 'Vacío = el del centro o, si no lo trae, el mínimo legal.' },
  { clave: 'auxilio', titulo: 'AUXILIO TRANSPORTE', ancho: 14, nota: 'Elige de la lista. Vacío = el del centro.' },
] as const;

/**
 * Cabeceras de la primera versión de la plantilla (2026-10-12), que juntaba varios
 * valores en una celda. Se siguen leyendo para no rechazar archivos ya diligenciados.
 */
const COLUMNAS_ANTERIORES = [
  { clave: 'perfil', titulo: 'PERFIL VACANTE' },
  // Plantillas bajadas antes de renombrar «Perfil vacante» a «Producto finca» (2026-10-13).
  { clave: 'perfil_1', titulo: 'PERFIL VACANTE 1' },
  { clave: 'perfil_2', titulo: 'PERFIL VACANTE 2' },
  { clave: 'perfil_3', titulo: 'PERFIL VACANTE 3' },
  { clave: 'oficinas', titulo: 'OFICINAS QUE CONTRATAN' },
  { clave: 'municipios', titulo: 'MUNICIPIOS' },
] as const;

/** Obligatorias: cada entrada se cumple con CUALQUIERA de sus claves. */
const OBLIGATORIAS: ReadonlyArray<readonly ClaveColumna[]> = [
  ['temporal'], ['centro'], ['cargo'], ['personas'], ['experiencia'], ['descripcion'], ['vinculacion'],
  ['oficina_1', 'oficinas'], ['municipio_1', 'municipios'],
];

/** Cuántos perfiles, oficinas y municipios caben en la plantilla. */
const N_PERFILES = 3;
const N_OFICINAS = 3;
const N_MUNICIPIOS = 3;

type ClaveColumna = (typeof COLUMNAS)[number]['clave'] | (typeof COLUMNAS_ANTERIORES)[number]['clave'];

const TIPOS_CONTRATACION = ['Obra Labor', 'Fijo Inferior a un año', 'Fijo a un año', 'Indefinido'];
const TIPO_UNICO_CONTRATACION = 'Obra Labor';
const ROL_RESTRINGIDO = 'CONTRATACION';
/** Espejo de `PublicacionController.ROLES_SIN_LIMITE` y del diálogo. */
const ROLES_SIN_LIMITE = ['ADMIN', 'GERENCIA', 'JEFE-DE-AREA'];

/** Salario mínimo legal mensual vigente: el mismo valor por defecto del diálogo. */
const SALARIO_MINIMO = 1750905;

/** Tope de filas por archivo: cada fila son varias consultas al parametrizador. */
export const MAX_FILAS = 200;

const HOJA_DATOS = 'Vacantes';

// ════════════════════════════════════════════════════════════════════════════
// Utilidades puras
// ════════════════════════════════════════════════════════════════════════════

/** Mayúsculas sin tildes ni espacios de sobra, para comparar textos. */
export function normalizar(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[_\s]+/g, ' ')
    .trim();
}

/** Texto de una celda de ExcelJS (rich text, hipervínculo, fórmula…). */
function textoCelda(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const o = v as any;
    if (Array.isArray(o.richText)) return o.richText.map((r: any) => r?.text ?? '').join('').trim();
    if (o.text != null) return String(o.text).trim();
    if (o.result != null) return textoCelda(o.result);
    return '';
  }
  return String(v).trim();
}

/** Valor "útil" de una celda: resuelve fórmulas, conserva Date y número. */
function valorCelda(v: unknown): unknown {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const o = v as any;
    if (o.result !== undefined) return valorCelda(o.result);
    return textoCelda(v);
  }
  return v;
}

/**
 * Fecha de la celda como 'YYYY-MM-DD'.
 *
 * ExcelJS entrega las celdas de fecha como Date en UTC a medianoche, así que se leen
 * con los getters UTC: con los locales, en Colombia (UTC-5) salía el día anterior.
 */
function leerFecha(v: unknown): string | null {
  const x = valorCelda(v);
  if (x == null || x === '') return null;
  if (x instanceof Date) {
    if (isNaN(x.getTime())) return null;
    return ymd(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate());
  }
  if (typeof x === 'number') {
    // Número de serie de Excel (días desde 1899-12-30).
    const d = new Date(Math.round((x - 25569) * 86400000));
    return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = String(x).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    const anio = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return ymd(anio, +m[2], +m[1]);
  }
  return 'INVALIDA';
}

function ymd(y: number, m: number, d: number): string | null {
  const f = new Date(Date.UTC(y, m - 1, d));
  if (f.getUTCFullYear() !== y || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return 'INVALIDA';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Hora de la celda como 'HH:mm'. Acepta Date, fracción de día y texto (14:00, 2:00 pm). */
function leerHora(v: unknown): string | null {
  const x = valorCelda(v);
  if (x == null || x === '') return null;
  let minutos: number | null = null;
  if (x instanceof Date) {
    minutos = x.getUTCHours() * 60 + x.getUTCMinutes();
  } else if (typeof x === 'number') {
    minutos = Math.round((x % 1) * 24 * 60);
  } else {
    const m = String(x).trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?$/);
    if (!m) return 'INVALIDA';
    let h = +m[1];
    const min = m[2] ? +m[2] : 0;
    const sufijo = (m[3] ?? '').replace(/[.\s]/g, '');
    if (sufijo === 'pm' && h < 12) h += 12;
    if (sufijo === 'am' && h === 12) h = 0;
    minutos = h * 60 + min;
  }
  if (minutos == null || minutos < 0 || minutos >= 24 * 60) return 'INVALIDA';
  return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
}

/** Entero de la celda; null si no es un entero. */
function leerEntero(v: unknown): number | null {
  const x = valorCelda(v);
  if (x == null || x === '') return null;
  const n = typeof x === 'number' ? x : Number(String(x).replace(/[.\s]/g, '').replace(',', '.'));
  return Number.isFinite(n) && Math.trunc(n) === n ? n : null;
}

/** Número (salario). Acepta "1.750.905" y "$ 1,750,905". */
function leerNumero(v: unknown): number | null {
  const x = valorCelda(v);
  if (x == null || x === '') return null;
  if (typeof x === 'number') return x;
  const limpio = String(x).replace(/[^\d]/g, '');
  return limpio ? Number(limpio) : null;
}

/** "Bogotá:3; Funza:2" → [{nombre, cantidad}]. Cantidad null si no viene. */
function partirReparto(texto: string): Array<{ nombre: string; cantidad: number | null; crudo: string }> {
  return texto
    .split(/[;\n]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const m = p.match(/^(.*?)[:=]\s*(-?\d+)\s*$/);
      return m
        ? { nombre: m[1].trim(), cantidad: Number(m[2]), crudo: p }
        : { nombre: p, cantidad: null, crudo: p };
    });
}

function partirLista(texto: string): string[] {
  return texto.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
}

/** Texto legible de un error HTTP. El backend responde {campo: [mensaje]} (forma DRF). */
function mensajeDeError(error: any): string {
  if (!error) return 'Error al guardar.';
  if (typeof error === 'string') return error;
  const e = error.error ?? error;
  if (typeof e === 'string' && e.trim()) return e;
  if (e && typeof e === 'object') {
    if (e.detail) return String(e.detail);
    const msgs = Object.entries(e)
      .filter(([k]) => !['status', 'timestamp', 'path', 'trace'].includes(k))
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`);
    if (msgs.length) return msgs.join(' | ');
  }
  return error.status ? `Error ${error.status} al guardar.` : (error.message ?? 'Error al guardar.');
}

/**
 * Lo que se ve en la celda del centro. Sin `*`, `?` ni `~` (COUNTIF los toma como
 * comodines y la lista encadenada saldría vacía) y corta: COUNTIF no admite textos de
 * más de 255 caracteres. Lo que identifica el centro es el [P<id>] del final.
 */
function etiquetaCentro(finca: string, empresa: string | null, id: number): string {
  const limpio = (t: string) => t.replace(/[*?~]/g, '').replace(/\s+/g, ' ').trim();
  const cuerpo = `${limpio(finca)}${empresa ? ` · ${limpio(empresa)}` : ''}`.slice(0, 150);
  return `${cuerpo} [P${id}]`;
}

function hoyYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dmy(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// ════════════════════════════════════════════════════════════════════════════
// Servicio
// ════════════════════════════════════════════════════════════════════════════

@Injectable({ providedIn: 'root' })
export class CargaMasivaVacantesService {
  private readonly http = inject(HttpClient);
  private readonly param = inject(ParametrizacionVacantesService);
  private readonly cascada = inject(VacancyCascadeService);
  private readonly vacantes = inject(VacantesService);
  private readonly utilidad = inject(UtilityServiceService);

  // ── Catálogos ────────────────────────────────────────────────────────────

  /**
   * Todo lo que la plantilla ofrece y la validación consulta, en una tanda.
   * Los centros salen SOLO del parametrizador, de las temporales con alcance.
   */
  async cargarCatalogos(): Promise<Catalogos> {
    const base = await firstValueFrom(
      forkJoin({
        temporales: this.cascada.listarTemporales(),
        empresas: this.param.listarEmpresas(true).pipe(catchError(() => of([] as EmpresaVacante[]))),
        configuraciones: this.param.listarConfiguraciones().pipe(catchError(() => of([] as ConfiguracionCentroCargo[]))),
        perfiles: this.param.listarPerfilesVacante(true).pipe(catchError(() => of([]))),
        sedes: this.utilidad.traerSucursales().pipe(catchError(() => of([]))),
        municipios: this.http.get<Array<{ ciudades: string[] }>>('./util/colombia.json').pipe(catchError(() => of([]))),
        gruposPago: this.param.listarGruposPago(true).pipe(catchError(() => of([] as GrupoPago[]))),
      }),
    );

    const conAlcance = new Set(base.temporales.filter((t) => t.parametrizada).map((t) => t.configRef));
    const refs = (base.empresas ?? [])
      .filter((e) => e.temporal_config_ref != null && conAlcance.has(e.temporal_config_ref))
      .map((e) => e.empresa_usuaria_ref);
    const centrosCrudos: CentroVacante[] = refs.length
      ? await firstValueFrom(this.param.listarCentros(refs).pipe(catchError(() => of([] as CentroVacante[]))))
      : [];

    const centros = (centrosCrudos ?? [])
      .filter((c) => c.habilitado_vacantes !== false)
      .map((c): CentroCatalogo => {
        const finca = (c.finca ?? c.centro_de_costo ?? '').trim();
        const empresa = c.empresa_nombre ?? null;
        return {
          id: c.id,
          etiqueta: etiquetaCentro(finca, empresa, c.id),
          finca,
          empresa,
          temporal: canonicalTemporal(c.temporal),
          direccion: c.direccion ?? null,
          salario: c.salario ?? null,
          auxilio_transporte: c.auxilio_transporte ?? null,
          ciudad: c.ciudad ?? null,
        };
      })
      .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es'));

    const idsCentros = new Set(centros.map((c) => c.id));

    const perfiles = conNoAplica((base.perfiles ?? [])
      .map((p: any) => String(p?.nombre ?? '').trim())
      .filter(Boolean));

    const sedes = (Array.isArray(base.sedes) ? base.sedes : [])
      .filter((s: any) => sedeOfrecidaEnSeleccion(s))
      .map((s: any) => String(s?.nombre ?? '').trim())
      .filter(Boolean)
      .sort((a: string, b: string) => a.localeCompare(b, 'es'));

    const municipios = [...new Set(
      (base.municipios ?? []).flatMap((d) => (Array.isArray(d?.ciudades) ? d.ciudades : []))
        .map((c) => String(c ?? '').trim())
        .filter(Boolean),
    )].sort((a, b) => a.localeCompare(b, 'es'));

    return {
      temporales: base.temporales,
      centros,
      configuraciones: (base.configuraciones ?? []).filter(
        (c) => c.activo !== false && idsCentros.has(c.centro_costo_id),
      ),
      perfiles,
      sedes,
      municipios,
      gruposPago: (base.gruposPago ?? []).filter((g) => g.activo !== false)
        .sort((a, b) => (a.numero ?? 0) - (b.numero ?? 0)),
    };
  }

  /**
   * Grupos de pago ASIGNADOS a cada centro, para la lista de la plantilla. No hay una
   * consulta en bloque: es una por centro, de ocho en ocho.
   */
  private async gruposAsignadosPorCentro(centros: CentroCatalogo[]): Promise<Map<number, string[]>> {
    const out = new Map<number, string[]>();
    let i = 0;
    const trabajador = async () => {
      while (i < centros.length) {
        const c = centros[i++];
        const grupos = await firstValueFrom(this.cascada.gruposPagoDe(c.id));
        const asignados = grupos.filter((g) => g.asignada).sort((a, b) => a.numero - b.numero).map((g) => g.nombre);
        if (asignados.length) out.set(c.id, asignados);
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, centros.length) }, trabajador));
    return out;
  }

  // ── Plantilla ────────────────────────────────────────────────────────────

  async descargarPlantilla(cat: Catalogos): Promise<void> {
    const gruposPorCentro = await this.gruposAsignadosPorCentro(cat.centros);
    const mod: any = await import('exceljs');
    const Workbook = mod?.Workbook ?? mod?.default?.Workbook;
    const wb = new Workbook();
    wb.creator = 'TuApo';
    wb.created = new Date();

    const azul = 'FF1F4E79';
    const cabecera = (ws: any, titulos: string[], anchos: number[]) => {
      ws.addRow(titulos);
      ws.columns = anchos.map((w) => ({ width: w }));
      const fila = ws.getRow(1);
      fila.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      fila.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: azul } };
      fila.alignment = { vertical: 'middle', wrapText: true };
      fila.height = 32;
      ws.views = [{ state: 'frozen', ySplit: 1 }];
    };

    // ── Instrucciones ──
    const ins = wb.addWorksheet('Instrucciones');
    ins.columns = [{ width: 30 }, { width: 100 }];
    ins.addRow(['CARGA MASIVA DE VACANTES']).font = { bold: true, size: 14, color: { argb: azul } };
    ins.addRow([]);
    [
      ['Cómo se usa', 'Llena una fila por vacante en la hoja «Vacantes» (desde la fila 2). Las columnas con * son obligatorias. No cambies los títulos de la fila 1.'],
      ['Listas', 'Todo lo que está parametrizado se ELIGE de la lista de la celda (flechita a la derecha), no se escribe. Ve de izquierda a derecha: la temporal decide qué centros salen, el centro decide sus áreas y grupos de pago, y centro + área deciden los cargos.'],
      ['Si una lista sale vacía', 'Falta elegir la columna anterior (temporal, centro o área). Si el área sale vacía con el centro ya elegido, ese centro no trabaja por área: déjala en blanco.'],
      ['Varios valores', 'Producto finca (opcional, vacío = No aplica), oficina y municipio tienen columnas 1, 2 y 3: usa una por valor. Cada municipio lleva su cantidad; la suma debe ser igual a las personas solicitadas.'],
      ['Subir', 'En Vacantes → menú ⋮ → «Carga masiva de vacantes (Excel)». Se valida cada fila y se muestra una vista previa antes de crear nada.'],
      ['Todo o nada', 'Si alguna fila tiene errores no se crea ninguna. Si una falla al guardarse, se borran las que ya se habían creado en esa carga.'],
      ['Grupo de pago', 'Si el centro tiene un solo grupo, puedes dejarlo vacío. Si necesitas un grupo que el centro no tiene, asígnalo antes en Parametrización de vacantes.'],
      ['Fechas', 'Formato dd/mm/aaaa. Contratación inmediata exige fecha de ingreso; prueba técnica exige fecha y hora de prueba. La labor se resuelve con el mes de la fecha de ingreso.'],
      ['Programa', 'Las listas encadenadas funcionan en Microsoft Excel y LibreOffice. En Google Sheets no: ahí las listas dependientes salen vacías.'],
      ['Límite', `Máximo ${MAX_FILAS} vacantes por archivo.`],
      ['Generada', `${new Date().toLocaleString('es-CO')} — las listas son las de este momento. Descarga una nueva si cambia la parametrización.`],
    ].forEach(([a, b]) => {
      const r = ins.addRow([a, b]);
      r.getCell(1).font = { bold: true };
      r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    });

    // ── Vacantes (la hoja de datos) ──
    const ws = wb.addWorksheet(HOJA_DATOS);
    cabecera(ws, COLUMNAS.map((c) => c.titulo), COLUMNAS.map((c) => c.ancho));
    COLUMNAS.forEach((c, i) => { ws.getRow(1).getCell(i + 1).note = c.nota; });

    // ── Datos de las listas encadenadas ──
    // Cada lista dependiente es un bloque de dos columnas (CLAVE, VALOR) ordenado por
    // CLAVE, de modo que las opciones de una clave quedan contiguas y la celda las toma
    // con OFFSET(primera fila de la clave, cuántas tiene). No se usan rangos con nombre
    // por centro: serían cientos y un nombre de Excel no admite estos textos.
    const etiquetaDe = new Map(cat.centros.map((c) => [c.id, c.etiqueta]));
    const areasDe = new Map<number, Set<string>>();
    const cargosDe = new Map<string, Set<string>>();
    for (const c of cat.configuraciones) {
      const et = etiquetaDe.get(c.centro_costo_id);
      const cargo = (c.cargo_nombre_origen ?? '').trim();
      if (!et || !cargo) continue;
      if (c.area_codigo) {
        if (!areasDe.has(c.centro_costo_id)) areasDe.set(c.centro_costo_id, new Set());
        areasDe.get(c.centro_costo_id)!.add(c.area_codigo);
      }
      const k = `${et}|${c.area_codigo ?? ''}`;
      if (!cargosDe.has(k)) cargosDe.set(k, new Set());
      cargosDe.get(k)!.add(cargo);
    }
    const porClave = (pares: Array<[string, string]>) =>
      pares.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1], 'es'));

    const bloqueCentros = porClave(cat.centros.filter((c) => c.temporal).map((c) => [c.temporal!, c.etiqueta]));
    const bloqueAreas = porClave(cat.centros.flatMap((c) =>
      [...(areasDe.get(c.id) ?? [])].map((a): [string, string] => [c.etiqueta, a])));
    const bloqueCargos = porClave([...cargosDe.entries()].flatMap(([k, set]) =>
      [...set].map((cargo): [string, string] => [k, cargo])));
    const bloqueGrupos = porClave(cat.centros.flatMap((c) =>
      (gruposPorCentro.get(c.id) ?? []).map((g): [string, string] => [c.etiqueta, g])));

    const horas: string[] = [];
    for (let m = 5 * 60; m <= 19 * 60; m += 30) {
      horas.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
    }
    const simples: Array<[string, string[]]> = [
      ['TEMPORAL', ['APOYO LABORAL SAS', 'TU ALIANZA SAS']],
      ['PERFIL', cat.perfiles],
      ['TIPO', TIPOS_CONTRATACION],
      ['EXPERIENCIA', ['SI', 'NO', 'AMBAS']],
      ['VINCULACION', ['Prueba técnica', 'Contratación inmediata']],
      ['SI_NO', ['Si', 'No']],
      ['OFICINA', cat.sedes],
      ['MUNICIPIO', cat.municipios],
      ['HORA', horas],
    ];

    const HL = '_listas';
    const hl = wb.addWorksheet(HL);
    // Columnas: A-B centros, D-E áreas, G-H cargos, J-K grupos, M en adelante las simples.
    const bloques: Array<{ col: number; titulo: [string, string]; datos: Array<[string, string]> }> = [
      { col: 1, titulo: ['TEMPORAL', 'CENTRO'], datos: bloqueCentros },
      { col: 4, titulo: ['CENTRO', 'AREA'], datos: bloqueAreas },
      { col: 7, titulo: ['CENTRO|AREA', 'CARGO'], datos: bloqueCargos },
      { col: 10, titulo: ['CENTRO', 'GRUPO'], datos: bloqueGrupos },
    ];
    const COL_SIMPLES = 13;
    const fila1 = hl.getRow(1);
    for (const b of bloques) {
      fila1.getCell(b.col).value = b.titulo[0];
      fila1.getCell(b.col + 1).value = b.titulo[1];
      b.datos.forEach(([k, v], i) => {
        const r = hl.getRow(i + 2);
        r.getCell(b.col).value = k;
        r.getCell(b.col + 1).value = v;
      });
    }
    simples.forEach(([t, v], j) => {
      fila1.getCell(COL_SIMPLES + j).value = t;
      v.forEach((x, i) => { hl.getRow(i + 2).getCell(COL_SIMPLES + j).value = x; });
    });
    hl.state = 'hidden';

    // ── Validaciones de la hoja de datos ──
    const letra = (n: number) => {
      let s = '';
      for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
      return s;
    };
    const colDatos = (clave: ClaveColumna) => COLUMNAS.findIndex((c) => c.clave === clave) + 1;
    const ref = (clave: ClaveColumna) => `$${letra(colDatos(clave))}2`;
    const rangoCol = (clave: ClaveColumna) => `${letra(colDatos(clave))}2:${letra(colDatos(clave))}${MAX_FILAS + 1}`;

    const simple = (t: string) => {
      const j = simples.findIndex(([x]) => x === t);
      const col = letra(COL_SIMPLES + j);
      return `'${HL}'!$${col}$2:$${col}$${Math.max(2, simples[j][1].length + 1)}`;
    };
    // Opciones de `criterio` dentro de un bloque: desde su primera aparición, tantas filas
    // como veces aparece. Las referencias de fila son relativas ($A2): Excel las desplaza
    // en cada fila del rango validado.
    const dependiente = (bloque: number, criterio: string) => {
      const b = bloques.find((x) => x.col === bloque)!;
      const n = Math.max(2, b.datos.length + 1);
      const clave = `'${HL}'!$${letra(b.col)}$2:$${letra(b.col)}$${n}`;
      return `OFFSET('${HL}'!$${letra(b.col + 1)}$1,MATCH(${criterio},${clave},0),0,COUNTIF(${clave},${criterio}),1)`;
    };

    const lista = (clave: ClaveColumna, formula: string, estricta = true) => {
      ws.dataValidations.add(rangoCol(clave), {
        type: 'list',
        allowBlank: true,
        formulae: [formula],
        showErrorMessage: estricta,
        errorStyle: 'stop',
        errorTitle: 'Valor no válido',
        error: 'Elige un valor de la lista. Si la lista está vacía, completa primero las columnas de la izquierda.',
      });
    };
    lista('temporal', simple('TEMPORAL'));
    lista('centro', dependiente(1, ref('temporal')));
    lista('area', dependiente(4, ref('centro')));
    lista('cargo', dependiente(7, `${ref('centro')}&"|"&${ref('area')}`));
    lista('grupo_pago', dependiente(10, ref('centro')));
    for (let i = 1; i <= N_PERFILES; i++) lista(`perfil_${i}` as ClaveColumna, simple('PERFIL'));
    lista('tipo', simple('TIPO'));
    lista('experiencia', simple('EXPERIENCIA'));
    lista('vinculacion', simple('VINCULACION'));
    for (let i = 1; i <= N_OFICINAS; i++) lista(`oficina_${i}` as ClaveColumna, simple('OFICINA'));
    for (let i = 1; i <= N_MUNICIPIOS; i++) {
      lista(`municipio_${i}` as ClaveColumna, simple('MUNICIPIO'));
      ws.dataValidations.add(rangoCol(`cantidad_${i}` as ClaveColumna), {
        type: 'whole', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0],
        showErrorMessage: true, errorTitle: 'Cantidad no válida', error: 'Escribe un número entero (0 o más).',
      });
    }
    lista('hora_prueba', simple('HORA'), false);
    lista('auxilio', simple('SI_NO'));
    ws.dataValidations.add(rangoCol('personas'), {
      type: 'whole', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [1],
      showErrorMessage: true, errorTitle: 'Personas no válidas', error: 'Escribe un número entero mayor o igual a 1.',
    });
    for (const clave of ['fecha_ingreso', 'fecha_prueba'] as ClaveColumna[]) {
      ws.getColumn(colDatos(clave)).numFmt = 'dd/mm/yyyy';
      ws.dataValidations.add(rangoCol(clave), {
        type: 'date', operator: 'greaterThan', allowBlank: true, formulae: [new Date(Date.UTC(2020, 0, 1))],
        showErrorMessage: true, errorTitle: 'Fecha no válida', error: 'Escribe una fecha dd/mm/aaaa.',
      });
    }
    ws.getColumn(colDatos('hora_prueba')).numFmt = '@';
    ws.getColumn(colDatos('salario')).numFmt = '#,##0';

    // ── Centros y cargos por centro: consulta para quien llena ──
    const hc = wb.addWorksheet('Centros');
    cabecera(hc, ['CENTRO DE COSTO', 'TEMPORAL', 'EMPRESA USUARIA', 'FINCA', 'DIRECCIÓN', 'CIUDAD', 'ÁREAS', 'GRUPOS DE PAGO'], [60, 20, 40, 30, 40, 18, 22, 22]);
    for (const c of cat.centros) {
      hc.addRow([c.etiqueta, c.temporal ?? '', c.empresa ?? '', c.finca, c.direccion ?? '', c.ciudad ?? '',
        [...(areasDe.get(c.id) ?? [])].sort().join(', ') || '(no trabaja por área)',
        (gruposPorCentro.get(c.id) ?? []).join(', ')]);
    }
    hc.autoFilter = { from: 'A1', to: 'H1' };

    const hg = wb.addWorksheet('Cargos por centro');
    cabecera(hg, ['CENTRO DE COSTO', 'ÁREA OPERATIVA', 'NOMBRE ÁREA', 'CARGO', 'ESQUEMA'], [60, 14, 26, 40, 14]);
    [...cat.configuraciones]
      .sort((a, b) =>
        (etiquetaDe.get(a.centro_costo_id) ?? '').localeCompare(etiquetaDe.get(b.centro_costo_id) ?? '', 'es')
        || (a.area_codigo ?? '').localeCompare(b.area_codigo ?? '')
        || (a.cargo_nombre_origen ?? '').localeCompare(b.cargo_nombre_origen ?? '', 'es'))
      .forEach((c) => hg.addRow([
        etiquetaDe.get(c.centro_costo_id) ?? '', c.area_codigo ?? '', c.area_nombre ?? '',
        c.cargo_nombre_origen ?? '', c.esquema_codigo ?? '',
      ]));
    hg.autoFilter = { from: 'A1', to: 'E1' };

    // ── Ejemplo (en su propia hoja: en la de datos se subiría como una vacante) ──
    const he = wb.addWorksheet('Ejemplo');
    cabecera(he, COLUMNAS.map((c) => c.titulo), COLUMNAS.map((c) => c.ancho));
    // Un centro que use todas las listas: con área, cargo y un solo grupo.
    const c0 = cat.centros.find((c) => areasDe.has(c.id) && (gruposPorCentro.get(c.id)?.length ?? 0) === 1)
      ?? cat.centros.find((c) => areasDe.has(c.id)) ?? cat.centros[0];
    const area0 = c0 ? [...(areasDe.get(c0.id) ?? [])].sort()[0] ?? '' : '';
    const cargo0 = c0 ? [...(cargosDe.get(`${c0.etiqueta}|${area0}`) ?? [])].sort()[0] ?? '' : '';
    const oficinas0 = cat.sedes.filter((s) => ['SUBA', 'FUNZA'].includes(normalizar(s)));
    const ejemplo: Partial<Record<ClaveColumna, unknown>> = {
      temporal: c0?.temporal ?? 'APOYO LABORAL SAS',
      centro: c0?.etiqueta ?? '',
      area: area0,
      cargo: cargo0,
      perfil_1: cat.perfiles[1] ?? PRODUCTO_NO_APLICA,
      perfil_2: '',
      personas: 3,
      detalle: 'Corte:2; Fumigador:1',
      tipo: 'Obra Labor',
      experiencia: 'AMBAS',
      descripcion: 'Mayores de 18 años, disponibilidad inmediata',
      grupo_pago: (c0 && gruposPorCentro.get(c0.id)?.[0]) ?? '',
      vinculacion: 'Prueba técnica',
      fecha_ingreso: new Date(Date.UTC(2026, 10, 3)),
      fecha_prueba: new Date(Date.UTC(2026, 9, 29)),
      hora_prueba: '14:00',
      ubicacion_prueba: 'Oficina Suba',
      oficina_1: oficinas0[0] ?? cat.sedes[0] ?? '',
      oficina_2: oficinas0[1] ?? '',
      municipio_1: cat.municipios.find((m) => normalizar(m) === 'BOGOTA') ?? cat.municipios[0] ?? '',
      cantidad_1: 2,
      municipio_2: cat.municipios.find((m) => normalizar(m) === 'FUNZA') ?? '',
      cantidad_2: 1,
      auxilio: 'Si',
    };
    he.addRow(COLUMNAS.map((c) => ejemplo[c.clave] ?? ''));
    for (const clave of ['fecha_ingreso', 'fecha_prueba'] as ClaveColumna[]) he.getColumn(colDatos(clave)).numFmt = 'dd/mm/yyyy';

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `plantilla_carga_masiva_vacantes_${hoyYmd()}.xlsx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ── Lectura ──────────────────────────────────────────────────────────────

  /**
   * Filas con datos de la hoja «Vacantes» (o de la primera si no existe), indexadas por
   * clave de columna. Las cabeceras se reconocen por nombre normalizado, no por posición:
   * mover una columna no rompe la carga.
   */
  async leerArchivo(file: File): Promise<Array<{ fila: number; celdas: Partial<Record<ClaveColumna, unknown>> }>> {
    const mod: any = await import('exceljs');
    const Workbook = mod?.Workbook ?? mod?.default?.Workbook;
    const wb = new Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.getWorksheet(HOJA_DATOS) ?? wb.worksheets[0];
    if (!ws) throw new Error('El archivo no tiene hojas.');

    const porTitulo = new Map<string, ClaveColumna>(
      [...COLUMNAS, ...COLUMNAS_ANTERIORES].map((c) => [normalizar(c.titulo.replace('*', '')), c.clave]),
    );
    const indice = new Map<number, ClaveColumna>();
    ws.getRow(1).eachCell((cell: any, col: number) => {
      const clave = porTitulo.get(normalizar(textoCelda(cell.value).replace('*', '')));
      if (clave) indice.set(col, clave);
    });
    const presentes = new Set(indice.values());
    const faltan = OBLIGATORIAS.filter((alternativas) => !alternativas.some((k) => presentes.has(k)));
    if (faltan.length) {
      const titulo = (k: ClaveColumna) => COLUMNAS.find((c) => c.clave === k)?.titulo.replace(' *', '') ?? k;
      throw new Error(`Faltan columnas en la hoja «${ws.name}»: ${faltan.map((a) => titulo(a[0])).join(', ')}. Usa la plantilla.`);
    }

    const filas: Array<{ fila: number; celdas: Partial<Record<ClaveColumna, unknown>> }> = [];
    ws.eachRow({ includeEmpty: false }, (row: any, n: number) => {
      if (n === 1) return;
      const celdas: Partial<Record<ClaveColumna, unknown>> = {};
      let algo = false;
      indice.forEach((clave, col) => {
        const v = row.getCell(col).value;
        celdas[clave] = v;
        if (textoCelda(v) !== '') algo = true;
      });
      if (algo) filas.push({ fila: n, celdas });
    });
    return filas;
  }

  // ── Validación ───────────────────────────────────────────────────────────

  /**
   * Valida todas las filas. Las consultas por centro (modo, áreas, cargos, pago) se
   * cachean: 50 vacantes del mismo centro no son 50 veces las mismas preguntas.
   */
  async validar(
    filas: Array<{ fila: number; celdas: Partial<Record<ClaveColumna, unknown>> }>,
    cat: Catalogos,
    progreso?: (hechas: number) => void,
  ): Promise<FilaValidada[]> {
    const cache = new Map<string, Promise<unknown>>();
    const memo = <T>(k: string, f: () => Observable<T>): Promise<T> => {
      if (!cache.has(k)) cache.set(k, firstValueFrom(f()));
      return cache.get(k) as Promise<T>;
    };

    const ctx: ContextoValidacion = {
      cat,
      soloObraLabor: this.soloObraLabor(),
      quienPublica: this.quienPublica(),
      modo: (id) => memo(`modo:${id}`, () => this.cascada.modoDe(id)),
      areas: (id) => memo(`areas:${id}`, () => this.cascada.areasDe(id)),
      cargos: (id, area) => memo(`cargos:${id}:${area ?? ''}`, () => this.cascada.cargosDe(id, area)),
      modoPago: (id) => memo(`mpago:${id}`, () => this.cascada.modoPagoDe(id)),
      grupos: (id) => memo(`grupos:${id}`, () => this.cascada.gruposPagoDe(id)),
      labor: (q) => memo(`labor:${q.centroId}:${q.cargoId ?? ''}:${q.cargoNombre}:${q.fechaIngreso}`,
        () => this.cascada.resolverLabor(q)),
      pagoCasino: (q) => memo(`pc:${q.centroId}:${q.grupoPagoId}`, () => this.cascada.resolverPagoCasino(q)),
    };

    const salida: FilaValidada[] = new Array(filas.length);
    // Cuatro filas a la vez: más rápido que una por una sin saturar el parametrizador.
    let siguiente = 0;
    let hechas = 0;
    const trabajador = async () => {
      while (siguiente < filas.length) {
        const i = siguiente++;
        try {
          salida[i] = await validarFila(filas[i].fila, filas[i].celdas, ctx);
        } catch (e) {
          salida[i] = filaConError(filas[i].fila, `No se pudo validar: ${(e as Error)?.message ?? e}`);
        }
        progreso?.(++hechas);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, filas.length) }, trabajador));

    marcarDuplicadas(salida);
    return salida;
  }

  // ── Creación ─────────────────────────────────────────────────────────────

  /**
   * Publica las filas en orden con el mismo POST del diálogo. Si una falla se borran
   * las creadas en esta carga y se informa la fila: o entran todas o ninguna.
   */
  async crear(filas: FilaValidada[], progreso?: (hechas: number) => void): Promise<ResultadoCreacion> {
    const creadas: Array<number | string> = [];
    for (const f of filas) {
      if (!f.payload) continue;
      try {
        const res: any = await firstValueFrom(this.vacantes.enviarVacante(f.payload));
        if (res?.id != null) creadas.push(res.id);
        progreso?.(creadas.length);
      } catch (e: any) {
        const mensaje = mensajeDeError(e);
        const sinDeshacer: Array<number | string> = [];
        for (const id of creadas) {
          const ok = await firstValueFrom(
            this.vacantes.eliminarVacante(id).pipe(map(() => true), catchError(() => of(false))),
          );
          if (!ok) sinDeshacer.push(id);
        }
        return { ok: false, creadas: 0, filaFallida: f.fila, mensaje, sinDeshacer };
      }
    }
    return { ok: true, creadas: creadas.length };
  }

  // ── Usuario ──────────────────────────────────────────────────────────────

  /** Misma regla que el diálogo: CONTRATACION sin un rol superior solo publica Obra Labor. */
  private soloObraLabor(): boolean {
    const user = this.utilidad.getUser();
    const crudo = user?.rol ?? user?.roles ?? [];
    const lista: any[] = Array.isArray(crudo) ? crudo : [crudo];
    const roles = lista
      .map((r) => (typeof r === 'string' ? r : r?.nombre))
      .filter(Boolean)
      .map((r: string) => normalizar(r));
    if (!roles.length) return false;
    if (roles.some((r) => ROLES_SIN_LIMITE.includes(r))) return false;
    return roles.includes(ROL_RESTRINGIDO);
  }

  private quienPublica(): string {
    const u = this.utilidad.getUser();
    return `${u?.datos_basicos?.nombres ?? ''} ${u?.datos_basicos?.apellidos ?? ''}`.trim() || 'Carga masiva';
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Validación de una fila
// ════════════════════════════════════════════════════════════════════════════

interface ContextoValidacion {
  cat: Catalogos;
  soloObraLabor: boolean;
  quienPublica: string;
  modo: (centroId: number) => Promise<{ trabaja_por_area: boolean } | null>;
  areas: (centroId: number) => Promise<Array<{ id: number; codigo: string; nombre: string | null }>>;
  cargos: (centroId: number, areaId?: number) => Promise<CargoAutorizado[]>;
  modoPago: (centroId: number) => Promise<{ exige_grupo_pago: boolean } | null>;
  grupos: (centroId: number) => Promise<CentroGrupoPago[]>;
  labor: (q: { centroId: number; cargoId?: number | null; cargoNombre: string; fechaIngreso: string }) =>
    Promise<{ ok: true; resolucion: any } | { ok: false; codigo: string; mensaje: string }>;
  pagoCasino: (q: { centroId: number; grupoPagoId: number }) =>
    Promise<{ ok: true; resolucion: any } | { ok: false; codigo: string; mensaje: string }>;
}

function filaConError(fila: number, error: string): FilaValidada {
  return {
    fila, estado: 'error', errores: [error], advertencias: [], payload: null,
    resumen: { centro: '', cargo: '', personas: null, vinculacion: '', fecha: '', labor: null, grupoPago: null },
  };
}

async function validarFila(
  fila: number,
  celdas: Partial<Record<ClaveColumna, unknown>>,
  ctx: ContextoValidacion,
): Promise<FilaValidada> {
  const errores: string[] = [];
  const avisos: string[] = [];
  const txt = (k: ClaveColumna) => textoCelda(valorCelda(celdas[k]));

  // ── Temporal ──
  const temporal = canonicalTemporal(txt('temporal'));
  if (!txt('temporal')) errores.push('Falta la temporal.');
  else if (!temporal) errores.push(`Temporal «${txt('temporal')}» no reconocida (APOYO LABORAL SAS o TU ALIANZA SAS).`);
  else if (!ctx.cat.temporales.some((t) => t.valor === temporal && t.parametrizada)) {
    errores.push(`${temporal} no tiene centros en el parametrizador: créala con el formulario.`);
  }

  // ── Centro: por el código [P<id>]; si no viene, por nombre y solo si es único ──
  const centroTxt = txt('centro');
  let centro: CentroCatalogo | null = null;
  if (!centroTxt) {
    errores.push('Falta el centro de costo.');
  } else {
    const m = centroTxt.match(/\[\s*P\s*(\d+)\s*\]\s*$/i);
    if (m) {
      centro = ctx.cat.centros.find((c) => c.id === Number(m[1])) ?? null;
      if (!centro) errores.push(`El centro ${m[0]} no existe o no está habilitado para vacantes.`);
    } else {
      const n = normalizar(centroTxt);
      const candidatos = ctx.cat.centros.filter(
        (c) => (normalizar(c.finca) === n || normalizar(c.etiqueta) === n) && (!temporal || c.temporal === temporal),
      );
      if (candidatos.length === 1) centro = candidatos[0];
      else if (candidatos.length > 1) {
        errores.push(`Hay ${candidatos.length} centros «${centroTxt}» en distintas empresas: elígelo de la lista (con su código [P…]).`);
      } else errores.push(`Centro «${centroTxt}» no encontrado entre los habilitados para vacantes.`);
    }
    if (centro && temporal && centro.temporal && centro.temporal !== temporal) {
      errores.push(`El centro ${centro.finca} es de ${centro.temporal}, no de ${temporal}.`);
    }
  }

  // ── Personas, detalle y municipios (no dependen del backend) ──
  const total = leerEntero(celdas.personas);
  if (total == null || total < 1) errores.push('Personas solicitadas debe ser un entero mayor o igual a 1.');

  // ── Área y cargo ──
  const cargoTxt = txt('cargo');
  const areaTxt = txt('area');
  let areaCodigo: string | null = null;
  let cargoSel: CargoAutorizado | null = null;
  let cargoNombre = cargoTxt;
  if (!cargoTxt) errores.push('Falta el cargo.');

  if (centro) {
    const modo = await ctx.modo(centro.id);
    let areaId: number | undefined;
    if (modo?.trabaja_por_area) {
      const areas = await ctx.areas(centro.id);
      if (!areaTxt) {
        errores.push(`El centro trabaja por área: falta el área operativa (${areas.map((a) => a.codigo).join(', ') || 'sin áreas'}).`);
      } else {
        const area = areas.find((a) => normalizar(a.codigo) === normalizar(areaTxt) || normalizar(a.nombre) === normalizar(areaTxt));
        if (!area) errores.push(`Área «${areaTxt}» no permitida en este centro (${areas.map((a) => a.codigo).join(', ') || 'sin áreas'}).`);
        else { areaId = area.id; areaCodigo = area.codigo; }
      }
    } else if (areaTxt) {
      avisos.push('Este centro no trabaja por área: el área se ignora.');
    }

    if (cargoTxt && (!modo?.trabaja_por_area || areaId != null)) {
      const autorizados = await ctx.cargos(centro.id, areaId);
      if (autorizados.length) {
        cargoSel = autorizados.find((c) => normalizar(c.cargo_nombre) === normalizar(cargoTxt)) ?? null;
        if (!cargoSel) {
          errores.push(`Cargo «${cargoTxt}» no autorizado en este centro${areaCodigo ? ` y área ${areaCodigo}` : ''}.`);
        } else {
          cargoNombre = cargoSel.cargo_nombre;
        }
      } else {
        // Misma válvula de escape del diálogo: centro habilitado sin configuraciones.
        avisos.push('El centro no tiene cargos parametrizados: se usa el cargo tal cual, sin traza de labor.');
      }
    }
  }

  // ── Perfiles ──
  const perfiles: string[] = [];
  const perfilesTxt = [
    ...Array.from({ length: N_PERFILES }, (_, i) => txt(`perfil_${i + 1}` as ClaveColumna)),
    ...partirLista(txt('perfil')),
  ].filter(Boolean);
  // «Producto finca» es opcional: vacío = «No aplica».
  for (const p of perfilesTxt) {
    const enCat = ctx.cat.perfiles.find((x) => normalizar(x) === normalizar(p));
    if (enCat) { if (!perfiles.includes(enCat)) perfiles.push(enCat); } else errores.push(`Producto finca «${p}» no existe en el catálogo.`);
  }

  // ── Detalle del cargo ──
  let detalles: Array<{ detalle: string; cantidad: number }> = [];
  const detalleTxt = txt('detalle');
  if (detalleTxt) {
    for (const d of partirReparto(detalleTxt)) {
      const cant = d.cantidad ?? (partirReparto(detalleTxt).length === 1 ? total : null);
      if (!d.nombre) errores.push(`Detalle del cargo «${d.crudo}» sin nombre.`);
      else if (cant == null || cant < 1) errores.push(`Detalle del cargo «${d.crudo}»: falta la cantidad (Nombre:cantidad).`);
      else detalles.push({ detalle: d.nombre, cantidad: cant });
    }
  } else if (cargoNombre && total != null && total >= 1) {
    detalles = [{ detalle: cargoNombre, cantidad: total }];
  }
  const sumaDet = detalles.reduce((a, d) => a + d.cantidad, 0);
  if (detalles.length && total != null && total >= 1 && sumaDet !== total) {
    errores.push(`Detalle del cargo suma ${sumaDet}, debe sumar ${total}.`);
  }

  // ── Tipo de contratación ──
  const tipoTxt = txt('tipo');
  const tipo = tipoTxt ? TIPOS_CONTRATACION.find((t) => normalizar(t) === normalizar(tipoTxt)) ?? null : TIPO_UNICO_CONTRATACION;
  if (!tipo) errores.push(`Tipo de contratación «${tipoTxt}» no válido (${TIPOS_CONTRATACION.join(', ')}).`);
  else if (ctx.soloObraLabor && tipo !== TIPO_UNICO_CONTRATACION) {
    errores.push('Tu rol solo puede crear vacantes por Obra Labor.');
  }

  // ── Experiencia y características ──
  const expN = normalizar(txt('experiencia'));
  const experiencia = expN === 'SI' || expN === 'NO' || expN === 'AMBAS' ? expN : null;
  if (!experiencia) errores.push(txt('experiencia') ? `Experiencia «${txt('experiencia')}» no válida (SI, NO o AMBAS).` : 'Falta la experiencia.');
  const descripcion = txt('descripcion');
  if (!descripcion) errores.push('Faltan las características del cargo.');

  // ── Vinculación y fechas ──
  const vinN = normalizar(txt('vinculacion'));
  const esPrueba = vinN.startsWith('PRUEBA');
  const esContratacion = vinN.startsWith('CONTRATACION');
  if (!esPrueba && !esContratacion) {
    errores.push(txt('vinculacion') ? `Vinculación «${txt('vinculacion')}» no válida (Prueba técnica o Contratación inmediata).` : 'Falta la vinculación.');
  }
  const fIngreso = leerFecha(celdas.fecha_ingreso);
  const fPrueba = esPrueba ? leerFecha(celdas.fecha_prueba) : null;
  const hPrueba = esPrueba ? leerHora(celdas.hora_prueba) : null;
  if (fIngreso === 'INVALIDA') errores.push('Fecha de ingreso no válida (dd/mm/aaaa).');
  if (fPrueba === 'INVALIDA') errores.push('Fecha de prueba no válida (dd/mm/aaaa).');
  if (hPrueba === 'INVALIDA') errores.push('Hora de prueba no válida (HH:mm).');
  if (esContratacion && !fIngreso) errores.push('Contratación inmediata exige fecha de ingreso.');
  if (esPrueba && !fPrueba) errores.push('Prueba técnica exige fecha de prueba.');
  if (esPrueba && !hPrueba) errores.push('Prueba técnica exige hora de prueba.');
  const ingresoOk = fIngreso && fIngreso !== 'INVALIDA' ? fIngreso : null;
  const pruebaOk = fPrueba && fPrueba !== 'INVALIDA' ? fPrueba : null;
  if (ingresoOk && pruebaOk && pruebaOk > ingresoOk) errores.push('La fecha de prueba no puede ser posterior a la de ingreso.');
  if (!esPrueba && (txt('fecha_prueba') || txt('hora_prueba'))) avisos.push('Contratación inmediata: la fecha y hora de prueba se ignoran.');
  const hoy = hoyYmd();
  if (ingresoOk && ingresoOk < hoy) avisos.push(`La fecha de ingreso (${dmy(ingresoOk)}) ya pasó.`);
  if (pruebaOk && pruebaOk < hoy) avisos.push(`La fecha de prueba (${dmy(pruebaOk)}) ya pasó.`);

  // ── Oficinas ──
  const oficinas: string[] = [];
  const oficinasTxt = [
    ...Array.from({ length: N_OFICINAS }, (_, i) => txt(`oficina_${i + 1}` as ClaveColumna)),
    ...partirLista(txt('oficinas')),
  ].filter(Boolean);
  if (!oficinasTxt.length) errores.push('Faltan las oficinas que contratan.');
  for (const o of oficinasTxt) {
    const s = ctx.cat.sedes.find((x) => normalizar(x).replace(/\s/g, '') === normalizar(o).replace(/\s/g, ''));
    if (s) { if (!oficinas.includes(s)) oficinas.push(s); } else errores.push(`Oficina «${o}» no existe o no contrata.`);
  }

  // ── Municipios ──
  const reparto: Array<{ municipio: string; cantidad: number }> = [];
  // Columnas MUNICIPIO n / CANTIDAD n de la plantilla, más el texto «Bogotá:2; Funza:1»
  // de la primera versión.
  const partes: Array<{ nombre: string; cantidad: number | null; crudo: string }> = [];
  for (let i = 1; i <= N_MUNICIPIOS; i++) {
    const nombre = txt(`municipio_${i}` as ClaveColumna);
    const cantTxt = txt(`cantidad_${i}` as ClaveColumna);
    if (!nombre) {
      if (cantTxt) errores.push(`Hay cantidad en «Cantidad municipio ${i}» pero falta el municipio ${i}.`);
      continue;
    }
    const cant = leerEntero(celdas[`cantidad_${i}` as ClaveColumna]);
    if (cantTxt && cant == null) errores.push(`Cantidad del municipio ${i} («${cantTxt}») no es un número entero.`);
    partes.push({ nombre, cantidad: cant, crudo: cantTxt ? `${nombre}:${cantTxt}` : nombre });
  }
  partes.push(...partirReparto(txt('municipios')));
  if (!partes.length) errores.push('Faltan los municipios.');
  for (const p of partes) {
    const muni = ctx.cat.municipios.find((x) => normalizar(x) === normalizar(p.nombre));
    const cant = p.cantidad ?? (partes.length === 1 ? total : null);
    if (!muni) errores.push(`Municipio «${p.nombre}» no encontrado.`);
    else if (cant == null || cant < 0) errores.push(`Falta la cantidad del municipio ${muni} (con varios municipios cada uno lleva la suya).`);
    else if (reparto.some((r) => r.municipio === muni)) errores.push(`Municipio ${muni} repetido.`);
    else reparto.push({ municipio: muni, cantidad: cant });
  }
  const sumaMun = reparto.reduce((a, r) => a + r.cantidad, 0);
  if (reparto.length && total != null && total >= 1 && sumaMun !== total) {
    errores.push(`El reparto por municipio suma ${sumaMun}, debe sumar ${total}.`);
  }

  // ── Salario y auxilio ──
  let salario = leerNumero(celdas.salario);
  if (txt('salario') && (salario == null || salario <= 0)) errores.push(`Salario «${txt('salario')}» no válido.`);
  if (salario == null || salario <= 0) {
    salario = centro?.salario != null && Number(centro.salario) > 0 ? Number(centro.salario) : SALARIO_MINIMO;
  } else if (salario < SALARIO_MINIMO) {
    avisos.push(`Salario por debajo del mínimo legal (${SALARIO_MINIMO.toLocaleString('es-CO')}).`);
  }
  const auxN = normalizar(txt('auxilio'));
  let auxilio: 'Si' | 'No';
  if (!auxN) auxilio = centro?.auxilio_transporte ? 'Si' : 'No';
  else if (auxN === 'SI') auxilio = 'Si';
  else if (auxN === 'NO') auxilio = 'No';
  else { errores.push(`Auxilio de transporte «${txt('auxilio')}» no válido (Si o No).`); auxilio = 'No'; }

  // ── Grupo de pago, fechas de pago y casino ──
  const trazaPago: Record<string, unknown> = {};
  let grupoNombre: string | null = null;
  if (centro) {
    const [modoPago, grupos] = await Promise.all([ctx.modoPago(centro.id), ctx.grupos(centro.id)]);
    const asignados = grupos.filter((g) => g.asignada);
    const grupoTxt = txt('grupo_pago');
    let grupo: CentroGrupoPago | null = null;
    if (grupoTxt) {
      const n = normalizar(grupoTxt);
      grupo = grupos.find((g) => normalizar(g.nombre) === n || String(g.numero) === grupoTxt.trim()) ?? null;
      if (!grupo) errores.push(`Grupo de pago «${grupoTxt}» no existe.`);
      else if (!grupo.asignada) {
        errores.push(`El grupo ${grupo.nombre} no está asignado a ${centro.finca}: asígnalo en Parametrización de vacantes o crea esta vacante con el formulario.`);
        grupo = null;
      }
    } else if (modoPago?.exige_grupo_pago) {
      if (asignados.length === 1) grupo = asignados[0];
      else if (asignados.length === 0) errores.push(`${centro.finca} no tiene grupos de pago configurados.`);
      else errores.push(`${centro.finca} tiene ${asignados.length} grupos de pago (${asignados.map((g) => g.nombre).join(', ')}): indica cuál.`);
    }
    if (grupo) {
      grupoNombre = grupo.nombre;
      trazaPago['grupo_pago_ref'] = grupo.grupo_pago_id;
      trazaPago['grupo_pago_nombre_snapshot'] = grupo.nombre;
      const pc = await ctx.pagoCasino({ centroId: centro.id, grupoPagoId: grupo.grupo_pago_id });
      if (pc.ok) {
        const r = pc.resolucion;
        Object.assign(trazaPago, {
          grupo_pago_ref: r.grupo_pago_id,
          grupo_pago_nombre_snapshot: r.grupo_pago_nombre,
          calendario_pago_ref: r.calendario_pago_id,
          fechas_pago_texto_snapshot: r.fechas_pago_texto,
          politica_casino_ref: r.politica_casino_id,
          casino_origen_resolucion: r.casino_origen,
          casino_texto_snapshot: r.casino_texto,
        });
        if (r.advertencias?.length) avisos.push(`Pago: ${r.advertencias.join(', ')}.`);
      } else {
        avisos.push(`No se resolvieron fechas de pago/casino (${pc.codigo}).`);
      }
    }
  }

  // ── Labor (solo con fecha de ingreso, como el diálogo) ──
  const trazaLabor: Record<string, unknown> = {};
  let labor: string | null = null;
  if (centro && cargoNombre && ingresoOk && (cargoSel || errores.length === 0)) {
    const res = await ctx.labor({
      centroId: centro.id,
      cargoId: cargoSel?.cargo_id ?? undefined,
      cargoNombre,
      fechaIngreso: ingresoOk,
    });
    if (res.ok && res.resolucion?.labor) {
      const r = res.resolucion;
      labor = r.labor;
      Object.assign(trazaLabor, {
        configuracion_centro_cargo_id: r.configuracion_id ?? cargoSel?.configuracion_id ?? null,
        regla_labor_id: r.regla_labor_id ?? null,
        labor_codigo_snapshot: r.codigo_labor ?? null,
        labor_descripcion_snapshot: r.labor,
        esquema_labor_codigo: r.esquema?.codigo ?? cargoSel?.esquema_codigo ?? null,
        labor_origen_resolucion: r.origen_resolucion ?? null,
      });
    } else {
      avisos.push(`Labor sin resolver (${res.ok ? 'RESOLUCION_VACIA' : res.codigo}): la vacante queda sin traza de labor.`);
    }
  } else if (centro && !ingresoOk && esPrueba) {
    avisos.push('Sin fecha de ingreso no se resuelve la labor.');
  }
  if (cargoSel && !trazaLabor['configuracion_centro_cargo_id']) {
    trazaLabor['configuracion_centro_cargo_id'] = cargoSel.configuracion_id;
    if (cargoSel.esquema_codigo) trazaLabor['esquema_labor_codigo'] = cargoSel.esquema_codigo;
  }
  if (areaCodigo) trazaLabor['area_operativa_codigo'] = areaCodigo;
  // Sin valor no viaja la clave: misma regla que `trazaLabor` del listado.
  for (const k of Object.keys(trazaLabor)) if (trazaLabor[k] == null || trazaLabor[k] === '') delete trazaLabor[k];
  for (const k of Object.keys(trazaPago)) if (trazaPago[k] == null || trazaPago[k] === '') delete trazaPago[k];

  const resumen = {
    centro: centro ? `${centro.finca}${centro.empresa ? ` · ${centro.empresa}` : ''}` : centroTxt,
    cargo: cargoNombre,
    personas: total,
    vinculacion: esPrueba ? 'Prueba técnica' : esContratacion ? 'Contratación inmediata' : txt('vinculacion'),
    fecha: esPrueba ? `Prueba ${dmy(pruebaOk)}${ingresoOk ? ` · ingreso ${dmy(ingresoOk)}` : ''}` : dmy(ingresoOk),
    labor,
    grupoPago: grupoNombre,
  };

  if (errores.length) {
    return { fila, estado: 'error', errores, advertencias: avisos, resumen, payload: null };
  }

  // Mismo cuerpo que arma `vacancy-list.openModal()` para el diálogo.
  const payload: Record<string, unknown> = {
    cargo: cargoNombre,
    area: productosParaGuardar(perfiles).join(', '),
    empresa_usuaria_solicita: centro!.empresa,
    finca: centro!.finca,
    ubicacionPruebaTecnica: esPrueba ? (txt('ubicacion_prueba') || null) : null,
    experiencia,
    direccion: centro!.direccion,
    fechadePruebatecnica: esPrueba ? pruebaOk : null,
    horade_pruebatecnica: esPrueba ? hPrueba : null,
    fechadeIngreso: ingresoOk,
    prueba_ocontratacion: esPrueba ? 'Prueba' : 'Contratación',
    temporal,
    descripcion,
    fecha_publicado: hoy,
    quienpublicolavacante: ctx.quienPublica,
    estadovacante: 'Activa',
    salario,
    codigo_elite: txt('codigo_bot') || null,
    personas_solicitadas: total,
    municipiosDistribucion: reparto,
    detallesCargo: detalles,
    oficinas_que_contratan: oficinas.map((nombre) => ({ nombre })),
    tipo_contratacion: tipo,
    municipio: reparto.map((r) => r.municipio),
    auxilio_transporte: auxilio,
    ...trazaLabor,
    ...trazaPago,
  };

  if (!centro!.empresa) avisos.push('El centro no trae empresa usuaria en el parametrizador.');
  if (!centro!.direccion) avisos.push('El centro no trae dirección en el parametrizador.');

  return {
    fila,
    estado: avisos.length ? 'advertencia' : 'ok',
    errores,
    advertencias: avisos,
    resumen,
    payload,
  };
}

/** Avisa de filas idénticas en lo esencial (mismo centro, cargo, fechas y total). */
function marcarDuplicadas(filas: FilaValidada[]): void {
  const vistas = new Map<string, number>();
  for (const f of filas) {
    if (!f.payload) continue;
    const p = f.payload;
    const k = [p['finca'], p['empresa_usuaria_solicita'], p['cargo'], p['fechadeIngreso'], p['fechadePruebatecnica'], p['personas_solicitadas']].join('|');
    const previa = vistas.get(k);
    if (previa != null) {
      f.advertencias.push(`Parece repetida de la fila ${previa}.`);
      if (f.estado === 'ok') f.estado = 'advertencia';
    } else {
      vistas.set(k, f.fila);
    }
  }
}
