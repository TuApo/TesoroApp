/**
 * El plano de la oficina: convierte lo que responde el puente de agentes
 * (catalogo + estado + tareas) en departamentos, escritorios y estados vivos.
 *
 * agents-office traia 6 departamentos y 33 agentes escritos a mano. Aqui no hay
 * nada escrito a mano: los departamentos son las categorias reales del catalogo
 * de ruflo y los escritorios, sus 81 agentes. Si mañana el catalogo crece, la
 * oficina crece sola — por eso el reparto en planta se calcula, no se declara.
 */
import type {
  AgenteCatalogo, Catalogo, Cuenta, EstadoAgentes, Tarea,
} from '../../../service/agentes.service';
import { hashTexto } from './oficina-util';
import type { NodoCerebro } from './oficina-util';
import type { DocDto } from '../../../service/conocimiento.service';

// ── Paleta ──────────────────────────────────────────────────────────────────
// Los tonos pastel de agents-office. El catalogo trae `color` por agente a
// veces; cuando falta, la categoria elige por hash y siempre cae en el mismo.

export interface Tono {
  chip: string;
  ink: string;
  floor: string;
}

export const TONOS: Tono[] = [
  { chip: '#5ADEB7', ink: '#1E9070', floor: '#E9F6EF' },
  { chip: '#8FD3F4', ink: '#2E86AB', floor: '#E6F4FB' },
  { chip: '#EADC8F', ink: '#A08A1E', floor: '#F6F1DA' },
  { chip: '#E69393', ink: '#C46060', floor: '#FAE9E7' },
  { chip: '#98A5EF', ink: '#5B66CE', floor: '#EAEDFA' },
  { chip: '#BFA2E3', ink: '#7449A9', floor: '#F2ECFA' },
  { chip: '#F2B84B', ink: '#9A6C10', floor: '#FBF0DC' },
  { chip: '#7FC8A9', ink: '#2F7D5B', floor: '#E8F4EE' },
];

export const TONO_CEREBRO: Tono = { chip: '#D1DECD', ink: '#4C7A57', floor: '#E9EFE4' };

export function tonoDe(clave: string): Tono {
  return TONOS[hashTexto(clave) % TONOS.length];
}

// Tonos de pelo y piel: el muñeco necesita variedad o la oficina parece clonada.
const PELOS = ['#2b2b2b', '#3b2b1d', '#111111', '#7a3b12', '#4a2a10', '#5a2d0c', '#1c1c2e', '#26140a', '#8a4a1f', '#552200'];
const PIELES = ['#E8B98E', '#F0C9A0', '#C68B59', '#F5D5B0', '#D89F70', '#E0A878', '#B07850', '#9C6B43', '#D9A97E', '#8A5A32'];

// ── Modelo de la oficina ────────────────────────────────────────────────────

export type EstadoPuesto = 'trabajando' | 'en_cola' | 'reposo' | 'error';

export interface PuestoPlano {
  clave: string;
  nombre: string;
  depto: string;
  /** Casilla [columna, fila] dentro del plinto del departamento. */
  grid: [number, number];
  /** El primero de cada categoria hace de jefe: corbata y pin. */
  lead: boolean;
  pelo: string;
  piel: string;
  descripcion: string;
  capacidades: string[];
}

export interface DeptoPlano {
  clave: string;
  nombre: string;
  tono: Tono;
  /** Centro del plinto en el plano XZ. */
  pos: [number, number];
  w: number;
  d: number;
  cols: number;
  puestos: PuestoPlano[];
}

export interface PlanoOficina {
  deptos: DeptoPlano[];
  puestos: PuestoPlano[];
  cerebro: { radio: number; nodos: NodoCerebro[] };
}

/** Lo que cambia cada 3 s: quien trabaja, en que, y con que cuenta. */
export interface PuestoVivo {
  clave: string;
  estado: EstadoPuesto;
  tarea: Tarea | null;
  cuenta: string | null;
  titulo: string;
  lineas: string[];
}

export interface EstadoVivo {
  puestos: Map<string, PuestoVivo>;
  trabajando: number;
  enCola: number;
}

// ── Reparto en planta ───────────────────────────────────────────────────────

const PASO_X = 8.6;   // separacion entre escritorios de una fila
const PASO_Z = 6.4;   // separacion entre filas
const MAX_COLS = 4;
const RADIO_CEREBRO = 16;
const HUECO = 7;      // aire entre plintos vecinos

function medidasDepto(n: number): { cols: number; rows: number; w: number; d: number } {
  const cols = Math.max(1, Math.min(MAX_COLS, Math.ceil(Math.sqrt(n))));
  const rows = Math.max(1, Math.ceil(n / cols));
  return { cols, rows, w: cols * PASO_X + 5, d: rows * PASO_Z + 7 };
}

/**
 * Coloca N plintos en corona alrededor del cerebro. El radio se busca por
 * tanteo: crece hasta que la suma de los anchos angulares cabe en la vuelta
 * completa. Con 22 categorias esto da un anillo amplio; con 6, uno apretado
 * parecido al de agents-office.
 */
function repartirEnCorona(medidas: { w: number; d: number }[]): { pos: [number, number] }[] {
  const n = medidas.length;
  if (!n) return [];
  if (n === 1) return [{ pos: [0, RADIO_CEREBRO + medidas[0].d / 2 + HUECO] }];

  const anchoAngular = (r: number) =>
    medidas.reduce((acc, m) => acc + 2 * Math.atan((m.w / 2 + HUECO / 2) / r), 0);

  let radio = RADIO_CEREBRO + 14;
  for (let i = 0; i < 60 && anchoAngular(radio) > Math.PI * 2; i++) radio *= 1.08;

  // El sobrante angular se reparte a partes iguales para que no queden pegados.
  const usado = anchoAngular(radio);
  const sobra = Math.max(0, Math.PI * 2 - usado) / n;

  const salida: { pos: [number, number] }[] = [];
  let az = -Math.PI / 2; // el primer departamento arranca arriba de la pantalla
  for (const m of medidas) {
    const paso = 2 * Math.atan((m.w / 2 + HUECO / 2) / radio) + sobra;
    const centro = az + paso / 2;
    // El radio de cada plinto sube con su fondo: los grandes se apartan mas.
    const r = radio + m.d / 2;
    salida.push({ pos: [r * Math.cos(centro), r * Math.sin(centro)] });
    az += paso;
  }
  return salida;
}

// ── Construccion del plano ──────────────────────────────────────────────────

/**
 * @param catalogo    los 81 agentes y sus categorias, tal cual los da el puente
 * @param docs        documentos del modulo Conocimiento; alimentan el cerebro
 * @param maxPuestos  tope de escritorios construidos (cada uno son ~25 mallas)
 */
export function construirPlano(
  catalogo: Catalogo | null,
  docs: DocDto[],
  maxPuestos = 96,
): PlanoOficina {
  const agentes = catalogo?.agentes ?? [];
  const categorias = catalogo?.categorias ?? [];

  // Solo las categorias que traen gente, en el orden del catalogo.
  const porCategoria = new Map<string, AgenteCatalogo[]>();
  for (const a of agentes) {
    const l = porCategoria.get(a.categoria) ?? [];
    l.push(a);
    porCategoria.set(a.categoria, l);
  }

  // Reparto del tope: proporcional al tamaño de cada categoria, minimo 1.
  const total = agentes.length;
  const recorte = total > maxPuestos;

  const vivas = categorias.filter((c) => (porCategoria.get(c.clave)?.length ?? 0) > 0);
  for (const [clave, lista] of porCategoria) {
    if (!vivas.some((c) => c.clave === clave)) {
      vivas.push({ clave, nombre: clave, total: lista.length });
    }
  }

  const cupos = new Map<string, number>();
  for (const c of vivas) {
    const n = porCategoria.get(c.clave)?.length ?? 0;
    cupos.set(c.clave, recorte ? Math.max(1, Math.round((n / total) * maxPuestos)) : n);
  }

  const deptosPrev = vivas.map((c) => {
    const lista = (porCategoria.get(c.clave) ?? []).slice(0, cupos.get(c.clave) ?? 0);
    return { cat: c, lista, med: medidasDepto(lista.length) };
  });

  const sitios = repartirEnCorona(deptosPrev.map((d) => d.med));

  const deptos: DeptoPlano[] = [];
  const puestos: PuestoPlano[] = [];

  deptosPrev.forEach((d, i) => {
    const tono = tonoDe(d.cat.clave);
    const misPuestos: PuestoPlano[] = d.lista.map((a, j) => {
      const p: PuestoPlano = {
        clave: a.clave,
        nombre: a.nombre || a.clave,
        depto: d.cat.clave,
        grid: [j % d.med.cols, Math.floor(j / d.med.cols)],
        lead: j === 0,
        pelo: PELOS[hashTexto(a.clave) % PELOS.length],
        piel: PIELES[hashTexto(a.clave + '·') % PIELES.length],
        descripcion: a.descripcion ?? '',
        capacidades: a.capacidades ?? [],
      };
      puestos.push(p);
      return p;
    });

    deptos.push({
      clave: d.cat.clave,
      nombre: d.cat.nombre || d.cat.clave,
      tono,
      pos: sitios[i]?.pos ?? [0, 0],
      w: d.med.w,
      d: d.med.d,
      cols: d.med.cols,
      puestos: misPuestos,
    });
  });

  return {
    deptos,
    puestos,
    cerebro: { radio: RADIO_CEREBRO / 2.6, nodos: nodosCerebro(docs) },
  };
}

/** Los documentos del modulo Conocimiento, tal como los quiere `makeCerebro`. */
export function nodosCerebro(docs: DocDto[]): NodoCerebro[] {
  return docs.map((d) => ({
    id: d.id,
    nombre: d.nombre,
    modulos: d.modulos ?? [],
    peso: (d.modulos?.length ?? 0) > 1 ? 2 : 1,
  }));
}

/** Posicion en el mundo del escritorio de un puesto. */
export function posicionPuesto(depto: DeptoPlano, p: PuestoPlano): [number, number] {
  const gx = (p.grid[0] - (depto.cols - 1) / 2) * PASO_X;
  const filas = Math.max(1, Math.ceil(depto.puestos.length / depto.cols));
  const gz = (p.grid[1] - (filas - 1) / 2) * PASO_Z;
  return [depto.pos[0] + gx, depto.pos[1] + gz];
}

// ── Estado vivo ─────────────────────────────────────────────────────────────

const HACE_POCO_MS = 5 * 60 * 1000;

/**
 * Cruza el estado del puente con el plano.
 *
 * OJO con los arrays: el puente mete en `enCurso[]` tareas que todavia estan en
 * `pendiente` (con el pool sin sesion, las tres del vigilante salen ahi y el
 * contador `trabajo.enCurso` dice 0). Asi que el estado se saca de `tarea.estado`,
 * que es el campo autoritativo, y los arrays solo sirven para saber que tareas
 * mirar. Si no, la oficina enseñaria gente "trabajando" con el pool parado.
 */
export function estadoVivo(estado: EstadoAgentes | null, ahora = Date.now()): EstadoVivo {
  const puestos = new Map<string, PuestoVivo>();
  if (!estado) return { puestos, trabajando: 0, enCola: 0 };

  const cuentas = new Map<string, Cuenta>();
  for (const c of estado.cuentas) cuentas.set(c.id, c);

  let trabajando = 0;

  const poner = (t: Tarea) => {
    if (!t.agente) return;
    const e = estadoDeTarea(t, ahora);
    if (!e) return;
    const previo = puestos.get(t.agente);
    if (previo && prioridadEstado(previo.estado) >= prioridadEstado(e)) return;
    if (previo?.estado === 'trabajando') trabajando--;
    if (e === 'trabajando') trabajando++;
    const cuenta = t.cuentaId ? cuentas.get(t.cuentaId) : undefined;
    puestos.set(t.agente, {
      clave: t.agente,
      estado: e,
      tarea: t,
      cuenta: cuenta?.nombre ?? t.cuentaNombre ?? null,
      titulo: tituloPantalla(t, e),
      lineas: lineasPantalla(t, e),
    });
  };

  for (const t of estado.enCurso) poner(t);
  for (const t of estado.cola) poner(t);
  for (const t of estado.ultimas) poner(t);

  return { puestos, trabajando, enCola: estado.trabajo.enCola };
}

/** El estado del puesto sale del estado de la tarea, no del array que la trajo. */
function estadoDeTarea(t: Tarea, ahora: number): EstadoPuesto | null {
  switch (t.estado) {
    case 'en_curso':
    case 'asignada':
      return 'trabajando';
    case 'pendiente':
      return 'en_cola';
    case 'error':
    case 'limite':
      // Un fallo de hace horas ya no es noticia: el aviso caduca.
      return ahora - (t.fin ?? t.actualizada) <= HACE_POCO_MS ? 'error' : null;
    default:
      return null; // ok, cancelada, interrumpida: el agente vuelve al reposo
  }
}

function prioridadEstado(e: EstadoPuesto): number {
  switch (e) {
    case 'trabajando': return 3;
    case 'en_cola': return 2;
    case 'error': return 1;
    default: return 0;
  }
}

function tituloPantalla(t: Tarea, e: EstadoPuesto): string {
  if (e === 'trabajando') return '● trabajando';
  if (e === 'en_cola') return t.esperaA ? '◌ esperando' : '◌ en cola';
  if (e === 'error') return t.estado === 'limite' ? '▲ tope de uso' : '▲ fallo';
  return '○ en reposo';
}

function lineasPantalla(t: Tarea, e: EstadoPuesto): string[] {
  const ls: string[] = [];
  if (t.titulo) ls.push('▸ ' + t.titulo);
  else if (t.objetivo) ls.push('▸ ' + t.objetivo);
  if (e === 'trabajando') {
    if (t.ultimaHerramienta) ls.push('▸ ' + t.ultimaHerramienta);
    if (t.turnos) ls.push(`▸ turno ${t.turnos}`);
    const tocados = t.archivosTocados?.length ?? 0;
    if (tocados) ls.push(`▸ ${tocados} fichero${tocados === 1 ? '' : 's'}`);
  } else if (e === 'error') {
    if (t.error) ls.push('▸ ' + t.error);
  } else if (e === 'en_cola') {
    ls.push(t.esperaA ? '▸ espera a otra tarea' : '▸ esperando cuenta libre');
  }
  return ls.length ? ls : ['▸ …'];
}
