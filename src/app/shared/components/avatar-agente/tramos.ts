import { Personaje, Tramo } from './avatar-agente.modelos';

/** Una marca de hablante en su propia línea: [[nomina]] (con negrita o espacios alrededor). */
const MARCA = /^[ \t*_]*\[\[([a-z0-9._-]{1,40})\]\][ \t*_:]*$\n?/gm;

/**
 * Parte una respuesta en tramos por personaje. El servidor ya depuró las marcas (solo quedan las
 * de colegas invitados), así que aquí solo se corta; marcas seguidas del mismo se funden.
 */
export function partirTramos(texto: string, principal: string): Tramo[] {
  const out: Tramo[] = [];
  if (!texto) return out;
  const agregar = (clave: string, t: string) => {
    const limpio = t.trim();
    if (!limpio) return;
    const ultimo = out[out.length - 1];
    if (ultimo?.clave === clave) ultimo.texto += '\n\n' + limpio;
    else out.push({ clave, texto: limpio });
  };
  let actual = principal;
  let desde = 0;
  MARCA.lastIndex = 0;
  for (let m = MARCA.exec(texto); m; m = MARCA.exec(texto)) {
    agregar(actual, texto.slice(desde, m.index));
    actual = m[1];
    desde = m.index + m[0].length;
  }
  agregar(actual, texto.slice(desde));
  return out;
}

/** El texto sin marcas (para copiar o leer en voz alta). */
export function sinMarcas(texto: string): string {
  return (texto ?? '').replace(/\[\[[a-z0-9._-]{1,40}\]\]\s*/g, '');
}

function normalizarRuta(ruta: string): string {
  let r = ruta.trim().split('?')[0];
  if (r.startsWith('#')) r = r.slice(1);
  if (!r.startsWith('/')) r = '/' + r;
  while (r.length > 1 && r.endsWith('/')) r = r.slice(0, -1);
  return r.toLowerCase();
}

/** Igual que ms-ai: exacto, comodín (tienda.*) o módulo padre; si no, el presidente. */
export function personajeDeModulo(elenco: Personaje[], modulo: string | null | undefined): Personaje | undefined {
  const m = (modulo ?? '').trim();
  if (m) {
    const exacto = elenco.find((p) => p.modulos?.includes(m));
    if (exacto) return exacto;
    const punto = m.indexOf('.');
    if (punto > 0) {
      const raiz = m.slice(0, punto);
      const hijo = elenco.find((p) => p.modulos?.includes(raiz + '.*')) ?? elenco.find((p) => p.modulos?.includes(raiz));
      if (hijo) return hijo;
    }
  }
  return elenco.find((p) => p.clave === 'presidente');
}

/** Igual que ms-ai: el prefijo de ruta más largo gana; si nada coincide, el presidente. */
export function personajeDeRuta(elenco: Personaje[], ruta: string | null | undefined): Personaje | undefined {
  if (!ruta?.trim()) return elenco.find((p) => p.clave === 'presidente');
  const r = normalizarRuta(ruta);
  let mejor: Personaje | undefined;
  let largo = -1;
  for (const p of elenco) {
    for (const pre of p.rutas ?? []) {
      const pr = normalizarRuta(pre);
      if (pr === '/' || !pr) continue;
      if ((r === pr || r.startsWith(pr + '/')) && pr.length > largo) {
        mejor = p;
        largo = pr.length;
      }
    }
  }
  return mejor ?? elenco.find((p) => p.clave === 'presidente');
}
