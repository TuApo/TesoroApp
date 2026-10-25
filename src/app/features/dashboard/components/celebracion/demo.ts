import { CelebracionDelDia, PersonaCelebrada, PlantillaCelebracion, PlantillaCelebracionAdmin } from './celebracion.models';

/** Personas de muestra para probar una plantilla sin nadie programado (sin foto: salen con iniciales). */
const MUESTRA: Omit<PersonaCelebrada, 'id'>[] = [
  { nombre: 'Ana María Rojas', primer_nombre: 'Ana', cargo: 'Analista de nómina · Funza', dedicatoria: 'Gracias por tu alegría de todos los días', enfoque_x: 50, enfoque_y: 40 },
  { nombre: 'Pedro Gómez', primer_nombre: 'Pedro', cargo: 'Coordinador de selección', enfoque_x: 50, enfoque_y: 40 },
  { nombre: 'Luisa Fernanda Díaz', primer_nombre: 'Luisa', cargo: 'Tesorería', enfoque_x: 50, enfoque_y: 40 },
  { nombre: 'Jorge Iván Castro', primer_nombre: 'Jorge', cargo: 'Sistemas', enfoque_x: 50, enfoque_y: 40 },
  { nombre: 'Daniela Vargas', primer_nombre: 'Daniela', cargo: 'Marketing', enfoque_x: 50, enfoque_y: 40 },
  { nombre: 'Camilo Herrera', primer_nombre: 'Camilo', cargo: 'Operaciones · Madrid', enfoque_x: 50, enfoque_y: 40 },
  { nombre: 'Sofía Mejía', primer_nombre: 'Sofía', cargo: 'Contratación', enfoque_x: 50, enfoque_y: 40 },
  { nombre: 'Andrés Ruiz', primer_nombre: 'Andrés', cargo: 'Bienestar', enfoque_x: 50, enfoque_y: 40 },
];

export function personasDemo(n: number): PersonaCelebrada[] {
  return MUESTRA.slice(0, Math.max(1, Math.min(n, MUESTRA.length))).map((p, i) => ({ ...p, id: `demo-${i}`, es_usted: false }));
}

/** El mismo criterio que TextosCelebracion.unir del backend. */
export function unirNombres(nombres: string[]): string {
  const n = nombres.map((x) => (x || '').trim()).filter(Boolean);
  if (!n.length) return '';
  if (n.length === 1) return n[0];
  if (n.length <= 4) return `${n.slice(0, -1).join(', ')} y ${n[n.length - 1]}`;
  const resto = n.length - 4;
  return `${n.slice(0, 4).join(', ')} y ${resto === 1 ? '1 compañero más' : `${resto} compañeros más`}`;
}

export function resolverTexto(t: string | null | undefined, nombres: string, nombre = ''): string {
  return (t ?? '').replace(/\{\{\s*nombres\s*}}/g, nombres).replace(/\{\{\s*nombre\s*}}/g, nombre).replace(/\s+/g, ' ').trim();
}

export function publica(p: PlantillaCelebracionAdmin): PlantillaCelebracion {
  const { id, codigo, nombre, animacion, tipografia, color_fondo, color_fondo_2, color_texto, color_acento, color_acento_2,
    duracion_segundos, fondo } = p;
  return { id, codigo, nombre, animacion, tipografia, color_fondo, color_fondo_2, color_texto, color_acento, color_acento_2,
    duracion_segundos, fondo: fondo ?? null };
}

/**
 * Arma en el navegador la celebración que vería la gente con una plantilla y unas personas:
 * es lo que usa el probador para cambiar de plantilla o de cantidad de personas al instante.
 */
export function armarLocal(o: {
  fecha: string;
  plantilla: PlantillaCelebracionAdmin;
  personas: PersonaCelebrada[];
  titulo?: string | null;
  mensaje?: string | null;
  comoCumpleanero?: boolean;
}): CelebracionDelDia {
  const nombres = unirNombres(o.personas.map((p) => p.nombre));
  const personas = o.personas.map((p, i) => ({ ...p, es_usted: !!o.comoCumpleanero && i === 0 }));
  const d: CelebracionDelDia = {
    fecha: o.fecha,
    vista_previa: true,
    plantilla: publica(o.plantilla),
    titulo: resolverTexto(o.titulo || o.plantilla.titulo, nombres),
    mensaje: resolverTexto(o.mensaje || o.plantilla.mensaje, nombres),
    personas,
    es_cumpleanero: !!o.comoCumpleanero && personas.length > 0,
  };
  if (d.es_cumpleanero) {
    const primero = personas[0].primer_nombre || personas[0].nombre.split(' ')[0];
    d.saludo_personal = `Hoy es tu día, ${primero}`;
    d.mensaje_personal = resolverTexto(o.plantilla.mensaje_personal || '{{nombre}}, todo el equipo te desea un feliz cumpleaños.', nombres, primero);
  }
  return d;
}
