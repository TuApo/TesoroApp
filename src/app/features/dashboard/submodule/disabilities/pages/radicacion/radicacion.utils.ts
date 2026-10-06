/**
 * Utilidades puras de Radicacion y Recobro (reunion funcional 2026-10-05).
 *
 * Luis Carlos radica a mano en el portal de cada EPS y vuelve a la plataforma a anotar el
 * numero que le devolvieron. Lo comun a las dos pantallas (y a sus dialogos) vive aqui:
 * partir lo que se pega desde Excel o un correo, fechas sin desfase de zona, etiquetas y
 * la confirmacion antes de guardar. Todo sin estado para poder probarlo aislado.
 */
import Swal from 'sweetalert2';

import type { TonoBadge } from '../../../../../../shared/components/tabla-estandar';
import { swalEnDialogo } from '../../../../../../shared/utils/swal-en-dialogo';
import type { DondeRadicado, EstadoIncapacidad } from '../../models/incapacidad-v2.model';
import {
  type CodigoEncontrado,
  DONDE_RADICADO_OPCIONES,
  type IncapacidadRef,
  type ModoBusquedaRadicacion,
} from '../../models/incapacidad-salud.model';
import { codigoSinGuion } from '../../utils/codigos';
import { aIsoCorto, parsearFechaFlexible } from '../../utils/fechas';

/** Tope del contrato para `POST /radicacion/buscar`, `/radicacion/asignar` y `/recobros`. */
export const MAX_CODIGOS_POR_BUSQUEDA = 500;
/** Largo de `incapacidad.numero_radicado` (VARCHAR(80)). */
export const MAX_LARGO_RADICADO = 80;
export const MAX_LARGO_OBSERVACIONES = 500;
/** Tamanos del paginador de los listados: el backend topa `tamano` en 200. */
export const OPCIONES_POR_PAGINA = [25, 50, 100, 200];

/** Los datos que el usuario digita para un radicado (inicial o de recobro). */
export interface DatosRadicado {
  numeroRadicado: string;
  /** `yyyy-MM-dd`. */
  fechaRadicado: string;
  dondeRadicado: DondeRadicado;
  observaciones: string | null;
}

/** Icono de cada canal, para los botones del formulario y los listados. */
export const ICONO_DONDE: Readonly<Record<DondeRadicado, string>> = {
  PAGINA: 'language',
  CORREO: 'mail',
  PUNTO_FISICO: 'storefront',
};

/**
 * Parte lo pegado en codigos sueltos: uno por linea, o separados por coma, punto y coma,
 * espacio o tabulacion (una columna copiada de Excel llega con saltos de linea; una fila,
 * con tabulaciones). Quita comillas que deja Excel, pasa a mayusculas (el codigo de
 * oficina es TASB018) y descarta repetidos; un codigo con y sin guion bajo es el MISMO,
 * porque el general viejo era `cedula_yyyyMMdd`.
 */
export function separarCodigos(texto: string | null | undefined): string[] {
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const crudo of (texto ?? '').split(/[\s,;]+/)) {
    const codigo = crudo.replace(/^["']+|["']+$/g, '').trim().toUpperCase();
    if (!codigo) continue;
    const clave = codigoSinGuion(codigo);
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push(codigo);
  }
  return salida;
}

/** Hoy en `yyyy-MM-dd` (calendario local, nunca `toISOString`). */
export function hoyIso(hoy: Date = new Date()): string {
  return aIsoCorto(hoy);
}

/** La EPS no entrega radicados del futuro: una fecha posterior a hoy es un error de digitacion. */
export function esFechaFutura(valor: unknown, hoy: Date = new Date()): boolean {
  const iso = aIsoCorto(parsearFechaFlexible(valor));
  return !!iso && iso > hoyIso(hoy);
}

/** `yyyy-MM-dd` (o ISO) → `dd/MM/yyyy`; vacio si no hay fecha. */
export function fechaCorta(valor: string | null | undefined): string {
  const fecha = parsearFechaFlexible(valor);
  if (!fecha) return '';
  const dia = String(fecha.getDate()).padStart(2, '0');
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}/${fecha.getFullYear()}`;
}

/**
 * Instante ISO-8601 (`creadoEn`) → `dd/MM/yyyy HH:mm`. Aqui SI se usa `new Date()`: es un
 * instante con hora, no una fecha de calendario, asi que el navegador lo pasa bien a hora local.
 */
export function fechaHora(valor: string | null | undefined): string {
  if (!valor) return '';
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return '';
  const hora = String(fecha.getHours()).padStart(2, '0');
  const minuto = String(fecha.getMinutes()).padStart(2, '0');
  return `${fechaCorta(aIsoCorto(fecha))} ${hora}:${minuto}`;
}

/** Fecha del backend como `Date` local: la tabla estandar ordena por fecha con esto. */
export function aFechaLocal(valor: string | null | undefined): Date | null {
  return parsearFechaFlexible(valor);
}

export function periodo(ref: Pick<IncapacidadRef, 'fechaInicio' | 'fechaFin'>): string {
  const inicio = fechaCorta(ref.fechaInicio);
  const fin = fechaCorta(ref.fechaFin);
  return inicio || fin ? `${inicio} – ${fin}` : '';
}

/** Canal con las palabras de la funcional (Pagina web / Correo / Presencial). */
export function etiquetaDonde(donde: DondeRadicado | null | undefined): string {
  return DONDE_RADICADO_OPCIONES.find((o) => o.valor === donde)?.etiqueta ?? '';
}

/** Codigo que se muestra primero: el de oficina (TASB018) si existe; si no, el general. */
export function codigoVisible(ref: Pick<IncapacidadRef, 'codigoOficina' | 'codigoUnico'>): string {
  return ref.codigoOficina || codigoSinGuion(ref.codigoUnico);
}

/** Entidad ante la que se radica: la EPS, o la ARL para accidente/enfermedad laboral. */
export function entidadDe(ref: Pick<IncapacidadRef, 'entidadRadicacion' | 'eps'>): string {
  return ref.entidadRadicacion || ref.eps || '';
}

export function etiquetaGrupo(grupo: string | null | undefined): string {
  if (grupo === 'APOYO') return 'Apoyo';
  if (grupo === 'ALIANZA') return 'Alianza';
  return '';
}

/** Tono del chip de estado (mismos colores de la consulta, con tonos que sirven en oscuro). */
export function tonoEstado(estado: EstadoIncapacidad | null | undefined): TonoBadge {
  switch (estado) {
    case 'VALIDADA':
    case 'PAGADA':
    case 'CONCILIADA':
      return 'ok';
    case 'PENDIENTE_RADICACION':
    case 'PENDIENTE_CONCILIACION':
      return 'warn';
    case 'NEGADA':
      return 'danger';
    case 'RECOBRO':
    case 'EN_REVISION_EPS':
    case 'NUEVA_RESPUESTA':
      return 'violet';
    case 'RECIBIDA':
    case 'RADICADA':
      return 'info';
    default:
      return 'neutro';
  }
}

/** Solo se marca sola la fila que se puede radicar y que no deja dudas de cual incapacidad es. */
export function marcadaPorDefecto(e: CodigoEncontrado): boolean {
  return e.puedeRadicar && !e.ambiguo;
}

/**
 * Suma una busqueda nueva a la lista de trabajo sin duplicar incapacidades (la misma puede
 * llegar por su codigo general y por el de oficina). Lo que ya estaba conserva su lugar pero
 * toma los datos frescos del servidor; lo nuevo va al final.
 */
export function fusionarEncontrados(
  actuales: readonly CodigoEncontrado[],
  nuevos: readonly CodigoEncontrado[],
): CodigoEncontrado[] {
  const frescos = new Map<number, CodigoEncontrado>();
  for (const e of nuevos) frescos.set(e.incapacidad.id, e);
  const salida = actuales.map((e) => frescos.get(e.incapacidad.id) ?? e);
  const yaEstaban = new Set(actuales.map((e) => e.incapacidad.id));
  for (const e of frescos.values()) {
    if (!yaEstaban.has(e.incapacidad.id)) salida.push(e);
  }
  return salida;
}

/** Mensaje legible de un error HTTP del modulo (`{ error: '...' }` de ms-hr). */
export function mensajeError(e: unknown, porDefecto: string): string {
  const err = e as { status?: number; error?: { error?: string; message?: string } | string } | null;
  if (err && typeof err.error === 'object' && err.error) {
    const texto = err.error.error || err.error.message;
    if (texto) return texto;
  }
  if (err?.status === 0) return 'No hay conexión con el servidor. Revise su red e intente de nuevo.';
  return porDefecto;
}

export function escaparHtml(valor: string | null | undefined): string {
  return (valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Lista corta para un Swal: los primeros N y "y X mas". */
export function listaCorta(valores: readonly string[], maximo = 8): string {
  if (valores.length <= maximo) return valores.join(', ');
  return `${valores.slice(0, maximo).join(', ')} y ${valores.length - maximo} más`;
}

export interface OpcionesConfirmacion {
  modo: ModoBusquedaRadicacion;
  datos: DatosRadicado;
  cantidad: number;
  /** Codigos que ya tenian radicado (solo en RADICACION): guardar los corrige. */
  correcciones?: readonly string[];
  /** true si se abre desde un MatDialog (el Swal debe montarse dentro del overlay). */
  enDialogo?: boolean;
}

/**
 * Confirmacion antes de escribir el radicado. Si hay correcciones se advierte que el numero
 * actual se reemplaza (el anterior queda en el historial de radicados, no se pierde).
 */
export async function confirmarRadicado(op: OpcionesConfirmacion): Promise<boolean> {
  const { modo, datos, cantidad } = op;
  const correcciones = op.correcciones ?? [];
  const recobro = modo === 'RECOBRO';
  const plural = cantidad === 1 ? 'incapacidad' : 'incapacidades';
  const detalle =
    `<p style="margin:0 0 8px">${recobro ? 'Radicado de recobro' : 'Radicado'} <b>${escaparHtml(datos.numeroRadicado)}</b>` +
    ` del ${escaparHtml(fechaCorta(datos.fechaRadicado))} (${escaparHtml(etiquetaDonde(datos.dondeRadicado))})` +
    ` para <b>${cantidad}</b> ${plural}.</p>`;
  const nota = recobro
    ? '<p style="margin:0;font-size:13px;color:#64748b">Queda como un radicado más de cada incapacidad: no cambia el radicado inicial ni su estado.</p>'
    : '';
  const aviso = correcciones.length
    ? `<p style="margin:10px 0 0;padding:8px 10px;border-radius:8px;background:#fff8e1;color:#7c4a03;font-size:13px">` +
      `<b>${correcciones.length}</b> ya ${correcciones.length === 1 ? 'tenía' : 'tenían'} radicado ` +
      `(${escaparHtml(listaCorta(correcciones))}): se reemplaza su número por este y el anterior queda en el historial.</p>`
    : '';
  const r = await Swal.fire({
    ...(op.enDialogo ? swalEnDialogo() : {}),
    icon: correcciones.length ? 'warning' : 'question',
    title: recobro ? '¿Registrar el recobro?' : '¿Guardar el radicado?',
    html: detalle + nota + aviso,
    showCancelButton: true,
    confirmButtonText: recobro ? 'Sí, registrar' : 'Sí, guardar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#1976d2',
    reverseButtons: true,
  });
  return !!r.isConfirmed;
}
