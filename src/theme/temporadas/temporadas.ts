/**
 * Temporadas de la plataforma (Halloween, Navidad…): cada una pinta la app con su paleta,
 * sus adornos animados y sus imágenes, y se guarda aquí para volver a usarla el año
 * siguiente. Para cambiar de temporada no se toca código de pantallas: se agrega una
 * entrada (y su hoja `temporadas/<clave>.css`) y las fechas deciden cuándo se activa.
 *
 * <p>Se puede forzar o apagar con `?temporada=<clave>` / `?temporada=off` en la URL (queda
 * guardado en el navegador) — sirve para revisar una temporada antes de su fecha.
 */
export interface Temporada {
  clave: string;
  nombre: string;
  /** Mes-día de inicio y fin, ambos incluidos (`'10-01'`). Si fin < inicio, cruza el año. */
  desde: string;
  hasta: string;
  /** Imágenes propias de la temporada (portada de premios, carrusel de la tienda). */
  imagenes?: {
    carrusel?: { grande: string; chico: string };
    premios?: { escritorio: string; escritorioChico: string; movil: string; movilChico: string; cofre: string };
  };
  /** Texto del banner de temporada en EconomiAPP. */
  banner?: { titulo: string; subtitulo: string; etiqueta: string; cta: string };
}

export const TEMPORADAS: Temporada[] = [
  {
    clave: 'halloween',
    nombre: 'Halloween',
    desde: '10-01',
    hasta: '11-02',
    imagenes: {
      carrusel: { grande: 'economiapp/temporadas/halloween/hal-carrusel.webp', chico: 'economiapp/temporadas/halloween/hal-carrusel-900.webp' },
      premios: {
        escritorio: 'economiapp/premios/pre-hero-desk.webp', escritorioChico: 'economiapp/premios/pre-hero-desk-1400.webp',
        movil: 'economiapp/premios/pre-hero-movil.webp', movilChico: 'economiapp/premios/pre-hero-movil-720.webp',
        cofre: 'economiapp/premios/pre-cofre.webp',
      },
    },
    banner: {
      titulo: '¡Dulce o premio! Halloween en su tienda',
      subtitulo: 'Cada compra suma puntos para canjear perros calientes, belleza, hogar… ¡y hasta una bicicleta!',
      etiqueta: 'Halloween',
      cta: 'Ver premios',
    },
  },
  // Navidad: agregar la entrada (10 dic – 6 ene) y src/theme/temporadas/navidad.css.
];

/** Imágenes de premios cuando no hay temporada (o la temporada no trae las suyas). */
export const PREMIOS_NEUTRO = {
  escritorio: 'economiapp/premios/neutro-hero-desk.webp', escritorioChico: 'economiapp/premios/neutro-hero-desk-1400.webp',
  movil: 'economiapp/premios/neutro-hero-movil.webp', movilChico: 'economiapp/premios/neutro-hero-movil-720.webp',
  cofre: 'economiapp/premios/neutro-cofre.webp',
};

export function temporadaEn(fecha: Date): Temporada | null {
  const md = `${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
  return TEMPORADAS.find(t => t.desde <= t.hasta ? md >= t.desde && md <= t.hasta : md >= t.desde || md <= t.hasta) ?? null;
}
