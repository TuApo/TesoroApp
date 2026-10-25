/**
 * Azar con semilla (mulberry32): la semilla la da el servidor al abrir la partida, así que el
 * tablero sale de esa partida y no de Math.random. No es seguridad (el puntaje se valida en el
 * servidor); es para que cada partida tenga su propio orden reproducible.
 */
export function azarConSemilla(semilla: number): () => number {
  let a = (semilla >>> 0) ^ Math.floor(semilla / 4294967296);
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function barajar<T>(lista: T[], azar: () => number): T[] {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Lo que un juego entrega al terminar. */
export interface FinDeJuego { puntaje: number; detalle: string; }
