import { CelebracionDelDia, Tipografia } from './celebracion.models';

/**
 * Tipografías de la escena. Salen de Google Fonts (la CSP ya permite fonts.googleapis.com y
 * fonts.gstatic.com) y se piden SOLO el día que hay celebración: la plataforma no carga ni
 * un byte de más el resto del año. Sin red caen a la de respaldo y la escena se ve igual de
 * ordenada, solo menos festiva.
 */
export const FUENTES: Record<Tipografia, { familia: string; css: string | null; muestra: string }> = {
  FESTIVA: {
    familia: "'Fredoka', 'Manrope Variable', 'Manrope', system-ui, sans-serif",
    css: 'family=Fredoka:wght@500;600;700', muestra: '700 48px Fredoka',
  },
  ELEGANTE: {
    familia: "'Playfair Display', Georgia, 'Times New Roman', serif",
    css: 'family=Playfair+Display:ital,wght@0,500;0,700;1,500;1,700', muestra: 'italic 700 48px "Playfair Display"',
  },
  MANUSCRITA: {
    familia: "'Caveat', 'Segoe Print', 'Bradley Hand', cursive",
    css: 'family=Caveat:wght@500;700', muestra: '700 48px Caveat',
  },
  CONDENSADA: {
    familia: "'Oswald', 'Arial Narrow', 'Roboto Condensed', sans-serif",
    css: 'family=Oswald:wght@500;600;700', muestra: '600 48px Oswald',
  },
  MARCA: { familia: "'Manrope Variable', 'Manrope', system-ui, sans-serif", css: null, muestra: '' },
};

const pedidas = new Set<string>();

function conTope<T>(p: Promise<T>, ms: number): Promise<T | void> {
  return Promise.race([p, new Promise<void>((r) => setTimeout(r, ms))]);
}

/** Inyecta la hoja de la tipografía (una vez) y espera a que esté, con tope. */
export function cargarTipografia(t: Tipografia, tope = 1500): Promise<unknown> {
  const f = FUENTES[t] ?? FUENTES.FESTIVA;
  if (!f.css || typeof document === 'undefined') return Promise.resolve();
  if (!pedidas.has(f.css)) {
    pedidas.add(f.css);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?${f.css}&display=swap`;
    document.head.appendChild(link);
  }
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts?.load) return Promise.resolve();
  // La hoja tarda en llegar: hasta que llega, load() resuelve vacío. Se reintenta hasta el tope.
  const inicio = performance.now();
  const intentar = (): Promise<unknown> =>
    fonts.load(f.muestra).then((caras) => {
      if (caras.length || performance.now() - inicio > tope) return caras;
      return new Promise((r) => setTimeout(r, 120)).then(intentar);
    }).catch(() => undefined);
  return conTope(intentar(), tope);
}

/** Baja las fotos antes de empezar: una animación de 8 s con los marcos vacíos no sirve. */
export function precargarFotos(urls: string[], tope = 2500): Promise<unknown> {
  const unas = urls.filter(Boolean).map((u) => new Promise<void>((r) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => (img.decode ? img.decode().catch(() => undefined).then(() => r()) : r());
    img.onerror = () => r();
    img.src = u;
  }));
  return conTope(Promise.all(unas), tope);
}

/**
 * El video del fondo: espera a que se pueda reproducir (con tope). Si no llega, la escena
 * arranca igual con el póster y el video entra cuando esté.
 */
export function precargarVideo(url: string, tope = 2500): Promise<unknown> {
  if (!url || typeof document === 'undefined') return Promise.resolve();
  return conTope(new Promise<void>((r) => {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.oncanplaythrough = () => r();
    v.onerror = () => r();
    v.src = url;
    v.load();
  }), tope);
}

/** Tipografía + fotos + fondo, en paralelo y con tope: la escena nunca espera más de ~2,5 s. */
export function prepararCelebracion(d: CelebracionDelDia, urlFoto: (u: string | null | undefined) => string,
                                    orientacion?: 'h' | 'v'): Promise<unknown> {
  const t = (d.plantilla?.tipografia ?? 'FESTIVA') as Tipografia;
  const o = orientacion ?? (typeof window !== 'undefined' && window.innerWidth < window.innerHeight ? 'v' : 'h');
  // Con una sola persona y fondo propio, ese es el fondo; si no, el de la plantilla.
  const propio = d.personas.length === 1 ? d.personas[0].fondo : null;
  const f = d.plantilla?.fondo;
  const imagen = propio ? (o === 'h' ? propio.imagen_h : propio.imagen_v) : f ? (o === 'h' ? f.imagen_h : f.imagen_v) : '';
  const video = propio ? (o === 'h' ? propio.video_h : propio.video_v) : f ? (o === 'h' ? f.video_h : f.video_v) : '';
  // Los fondos propios de cada persona (varias): sus pósters, para que el cambio no salga en blanco.
  const propios = d.personas.length > 1
    ? d.personas.map((p) => (p.fondo ? (o === 'h' ? p.fondo.imagen_h : p.fondo.imagen_v) : '')) : [];
  return Promise.all([
    cargarTipografia(t),
    precargarFotos([...d.personas.map((p) => urlFoto(p.foto_url)), urlFoto(imagen), ...propios.map((x) => urlFoto(x))].filter(Boolean)),
    video ? precargarVideo(urlFoto(video)) : Promise.resolve(),
  ]);
}

/** Hoy en Bogotá como AAAA-MM-DD (el navegador puede estar en otro huso). */
export function hoyBogota(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());
}

/** «viernes 17 de octubre». */
export function fechaLarga(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number);
  if (!a || !m || !d) return '';
  return new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(a, m - 1, d, 12)));
}
