import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '@/environments/environment';

/** Un punto del analisis, siempre con el campo del que sale. */
export interface PuntoAnalisis {
  punto: string;
  evidencia?: string;
}

/** Cargo que la IA propone para la persona, con el porque. */
export interface CargoSugerido {
  cargo?: string;
  porque?: string;
}

/** Lectura de la trayectoria: cuánto dura en los trabajos y con qué cifras se dice. */
export interface EstabilidadLaboral {
  nivel?: 'alto' | 'medio' | 'bajo' | 'sin datos';
  porque?: string;
}

/**
 * Con quién vive, quién responde por los hijos y si sostiene sola/o el hogar.
 *
 * Es informacion de DISPONIBILIDAD —turnos, rutas, madrugadas—, no un juicio
 * sobre la persona: el prompt del analisis lo deja escrito y aqui se rotula
 * igual para que nadie lo lea como un criterio de descarte.
 */
export interface RedDeApoyo {
  resumen?: string;
  evidencia?: string;
}

export interface AnalisisCandidato {
  cedula?: string;
  resumen?: string;
  /** Sugerencia de cargo a partir de experiencia, formacion y entrevista. */
  cargoSugerido?: CargoSugerido;
  estabilidadLaboral?: EstabilidadLaboral;
  redDeApoyo?: RedDeApoyo;
  aFavor?: PuntoAnalisis[];
  enContra?: PuntoAnalisis[];
  riesgos?: PuntoAnalisis[];
  ajusteVacante?: { nivel?: 'alto' | 'medio' | 'bajo'; porque?: string };
  datosQueFaltan?: string[];
  preguntasSugeridas?: string[];
  /** La IA cortó la respuesta y se salvó lo que alcanzó a escribir. */
  parcial?: boolean;
  /** Qué decirle a quien lee cuando la lectura vino incompleta o no vino. */
  aviso?: string;
  /**
   * Gráficas que la IA haya querido acompañar (opciones de ECharts). No se le
   * piden, pero si llegan se pintan como gráficas y no como JSON.
   */
  graficas?: GraficaIa[];
  /**
   * Lo que el modelo añadió fuera del contrato (p. ej. "observaciones"). Se
   * guarda aparte, ya tipado, para pintarlo como una sección más del informe.
   */
  extras?: Record<string, unknown>;
  /** El expediente crudo con el que se produjo el analisis. */
  expediente?: unknown;
}

/** Una gráfica que viene de la IA: título opcional y opciones de ECharts. */
export interface GraficaIa {
  titulo?: string;
  opciones: Record<string, unknown>;
}

type Nivel = 'alto' | 'medio' | 'bajo';

const AVISO_INVALIDO = 'La IA no devolvió una lectura válida del expediente. Pulsa Rehacer.';
const AVISO_PARCIAL = 'La IA cortó la respuesta: se muestra lo que alcanzó a escribir. Pulsa Rehacer para la lectura completa.';

/**
 * Última defensa contra el JSON pintado en pantalla.
 *
 * Cuando el modelo se quedaba sin tokens, ms-ai no podía leer la respuesta y
 * la devolvía entera en `resumen`: el panel mostraba el JSON en vez de la
 * lectura. ms-ai ya repara el corte; esto cubre lo que llegue igual (una
 * versión vieja del servicio, otra forma de corte) leyendo el JSON aquí.
 */
export function normalizarAnalisis(a: AnalisisCandidato): AnalisisCandidato {
  const r = typeof a?.resumen === 'string' ? a.resumen.trim() : '';
  if (!r.startsWith('{') && !r.startsWith('```')) return tiparAnalisis(a);

  const leido = leerJsonTolerante(r);
  if (!leido) return tiparAnalisis({ ...a, resumen: undefined, parcial: true, aviso: AVISO_INVALIDO });
  return tiparAnalisis({
    ...(leido.valor as AnalisisCandidato),
    cedula: a.cedula,
    expediente: a.expediente,
    ...(leido.reparado ? { parcial: true, aviso: AVISO_PARCIAL } : {}),
  });
}

/** Campos del contrato; lo demás que mande el modelo va a `extras`. */
const CONOCIDOS = new Set([
  'cedula', 'resumen', 'cargoSugerido', 'estabilidadLaboral', 'redDeApoyo', 'aFavor', 'enContra',
  'riesgos', 'ajusteVacante', 'datosQueFaltan', 'preguntasSugeridas', 'parcial', 'aviso',
  'graficas', 'extras', 'expediente',
]);

/**
 * Deja la respuesta con la forma exacta de {@link AnalisisCandidato}.
 *
 * El modelo no siempre respeta el contrato: manda "Alto" en vez de "alto",
 * puntos como texto suelto en vez de {punto, evidencia}, un objeto donde iba
 * un texto… Sin esto la plantilla terminaba pintando `[object Object]` o el
 * JSON de un campo. Aquí todo queda con su tipo o no queda.
 */
export function tiparAnalisis(crudo: unknown): AnalisisCandidato {
  const o = (crudo && typeof crudo === 'object' ? crudo : {}) as Record<string, unknown>;
  const a: AnalisisCandidato = {};

  const cedula = texto(o['cedula']);
  if (cedula) a.cedula = cedula;
  const resumen = texto(o['resumen']);
  if (resumen) a.resumen = resumen;

  const cargo = objeto(o['cargoSugerido']);
  if (cargo) a.cargoSugerido = limpio({ cargo: texto(cargo['cargo']), porque: texto(cargo['porque']) });
  const est = objeto(o['estabilidadLaboral']);
  if (est) a.estabilidadLaboral = limpio({ nivel: nivel(est['nivel'], true), porque: texto(est['porque']) });
  const red = objeto(o['redDeApoyo']);
  if (red) a.redDeApoyo = limpio({ resumen: texto(red['resumen']), evidencia: texto(red['evidencia']) });
  const ajuste = objeto(o['ajusteVacante']);
  if (ajuste) a.ajusteVacante = limpio({ nivel: nivel(ajuste['nivel'], false) as Nivel | undefined, porque: texto(ajuste['porque']) });

  a.aFavor = puntos(o['aFavor']);
  a.enContra = puntos(o['enContra']);
  a.riesgos = puntos(o['riesgos']);
  a.datosQueFaltan = textos(o['datosQueFaltan']);
  a.preguntasSugeridas = textos(o['preguntasSugeridas']);

  const graficas = graficasIa(o['graficas']);
  if (graficas.length) a.graficas = graficas;

  const extras: Record<string, unknown> = { ...(objeto(o['extras']) ?? {}) };
  for (const [k, v] of Object.entries(o)) {
    if (!CONOCIDOS.has(k) && v !== null && v !== undefined && v !== '') extras[k] = v;
  }
  if (Object.keys(extras).length) a.extras = extras;

  if (o['parcial'] === true) a.parcial = true;
  const aviso = texto(o['aviso']);
  if (aviso) a.aviso = aviso;
  if (o['expediente'] !== undefined) a.expediente = o['expediente'];
  return a;
}

function texto(v: unknown): string | undefined {
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

function objeto(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

/** "Alto", "ALTO ", "sin_datos" → la clave en minúscula que usa la pantalla. */
function nivel(v: unknown, admiteSinDatos: boolean): EstabilidadLaboral['nivel'] {
  const t = (texto(v) ?? '').toLowerCase().replace(/[_-]+/g, ' ').trim();
  if (t === 'alto' || t === 'alta') return 'alto';
  if (t === 'medio' || t === 'media') return 'medio';
  if (t === 'bajo' || t === 'baja') return 'bajo';
  if (admiteSinDatos && t) return 'sin datos';
  return undefined;
}

function puntos(v: unknown): PuntoAnalisis[] {
  if (!Array.isArray(v)) return [];
  const out: PuntoAnalisis[] = [];
  for (const x of v) {
    const o = objeto(x);
    const punto = o ? texto(o['punto']) : texto(x);
    if (!punto) continue;
    const evidencia = o ? texto(o['evidencia']) : undefined;
    out.push(evidencia ? { punto, evidencia } : { punto });
  }
  return out;
}

function textos(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(x => texto(x) ?? texto(objeto(x)?.['punto'])).filter((x): x is string => !!x);
}

/** Acepta `[{titulo, opciones}]` o directamente opciones de ECharts (con `series`). */
function graficasIa(v: unknown): GraficaIa[] {
  const lista = Array.isArray(v) ? v : v ? [v] : [];
  const out: GraficaIa[] = [];
  for (const x of lista) {
    const o = objeto(x);
    if (!o) continue;
    const opciones = objeto(o['opciones']) ?? objeto(o['options']) ?? (o['series'] ? o : null);
    if (!opciones || !opciones['series']) continue;
    const titulo = texto(o['titulo']) ?? texto(o['title']);
    out.push(titulo ? { titulo, opciones } : { opciones });
  }
  return out;
}

/** Quita las claves vacías: un objeto sin nada útil no debe pintar una fila. */
function limpio<T extends object>(o: T): T | undefined {
  const e = Object.entries(o).filter(([, v]) => v !== undefined);
  return e.length ? Object.fromEntries(e) as T : undefined;
}

/** Lee el objeto aunque venga entre ``` o cortado a medias (mismo criterio que ms-ai). */
function leerJsonTolerante(texto: string): { valor: object; reparado: boolean } | null {
  const ini = texto.indexOf('{');
  if (ini < 0) return null;
  const t = texto.slice(ini);
  const fin = t.lastIndexOf('}');
  const completo = parsearObjeto(fin > 0 ? t.slice(0, fin + 1) : t);
  if (completo) return { valor: completo, reparado: false };
  for (const c of reparacionesJson(t)) {
    const v = parsearObjeto(c);
    if (v) return { valor: v, reparado: true };
  }
  return null;
}

function parsearObjeto(s: string): object | null {
  try {
    const v: unknown = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Cierres posibles de un JSON cortado: primero tal cual (cerrando la cadena y
 * las llaves abiertas) y luego desde la última coma o cierre fuera de una
 * cadena, que pierde el elemento a medias pero salva lo completo.
 */
function reparacionesJson(s: string): string[] {
  const pila: string[] = [];
  let enCadena = false;
  let escape = false;
  let corte = -1;
  let cierresEnCorte = '';
  const cierres = () => [...pila].reverse().join('');

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (enCadena) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') enCadena = false;
      continue;
    }
    if (c === '"') enCadena = true;
    else if (c === '{') pila.push('}');
    else if (c === '[') pila.push(']');
    else if (c === '}' || c === ']') {
      if (!pila.length) return [];
      pila.pop();
      if (!pila.length) return [];
      corte = i + 1;
      cierresEnCorte = cierres();
    } else if (c === ',') {
      corte = i;
      cierresEnCorte = cierres();
    }
  }
  if (!pila.length) return [];

  const tal = (enCadena ? (escape ? s.slice(0, -1) : s) + '"' : s) + cierres();
  return corte > 0 ? [tal, s.slice(0, corte) + cierresEnCorte] : [tal];
}

/**
 * IA sobre la persona que se tiene al frente.
 *
 * El expediente lo arma ms-ai juntando ms-hr, ms-documents y ms-payroll: se
 * pide alla y no aqui para no hacer cinco viajes desde el navegador ni pasear
 * el JWT por todos los servicios.
 */
@Injectable({ providedIn: 'root' })
export class AnalisisIaService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/ia/candidatos`;

  /**
   * Analiza al candidato frente a la vacante a la que va.
   * @param vacante datos de la obra remitida; el analisis los usa para el ajuste.
   */
  analizar(cedula: string, vacante?: unknown): Observable<AnalisisCandidato> {
    return this.http.post<AnalisisCandidato>(
      `${this.base}/${encodeURIComponent(cedula)}/analisis`,
      { vacante: vacante ?? null },
    ).pipe(map(normalizarAnalisis));
  }

  /** Expediente crudo, sin pasar por el modelo. */
  expediente(cedula: string): Observable<unknown> {
    return this.http.get(`${this.base}/${encodeURIComponent(cedula)}/expediente`);
  }
}
