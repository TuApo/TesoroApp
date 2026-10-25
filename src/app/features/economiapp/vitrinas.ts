/**
 * Vitrinas especiales: categorías que se venden con una página propia (portada con
 * publicidad, mosaico de subcategorías, rieles, marcas y beneficios) en vez del listado
 * genérico de Explorar.
 *
 * <p>Se amarran al CÓDIGO de la categoría raíz (store_categoria.codigo), no al id: el
 * árbol se puede reordenar o recrear sin tocar esto. Si la tienda que se está mirando no
 * tiene esa categoría (p. ej. Importados es solo de Flora Market), la vitrina no se ofrece.
 *
 * <p>Las imágenes viven en `public/economiapp/vitrinas/` (generadas con Higgsfield a partir
 * de los productos reales). Cada portada tiene versión de celular (4:5) y de escritorio
 * (21:9), cada una en dos tamaños para no bajar 2400 px en un teléfono.
 */
export interface BeneficioVitrina { icono: string; titulo: string; texto: string; }

export interface Vitrina {
  slug: string;
  /** Código de la categoría raíz en db_store. */
  codigo: string;
  nombre: string;
  etiqueta: string;
  eslogan: string;
  bajada: string;
  cta: string;
  /** Subcategoría a la que lleva el botón principal (sin ella, baja a los productos). */
  ctaCodigo?: string;
  /** Imagen pequeña para el círculo de la categoría en la portada. */
  miniatura: string;
  /** Rieles por subcategoría (catálogo grande) o rejilla completa (catálogo corto). */
  disposicion: 'rieles' | 'rejilla';
  hero: { escritorio: string; escritorioChico: string; movil: string; movilChico: string };
  carrusel: { grande: string; chico: string };
  /** Foto del mosaico por código de subcategoría. */
  mosaicos: Record<string, string>;
  /** Colores de la página (se aplican como variables CSS). */
  tema: { fondo: string; fondo2: string; acento: string; acentoTinta: string };
  beneficios: BeneficioVitrina[];
  /** Pregunta sugerida para MatIA desde la vitrina. */
  preguntaMatia: string;
  /** Sello sobre la foto de cada producto de la vitrina (vacío = ninguno). */
  insignia?: string;
  /** Muestra la fila de marcas (filtro "marca" de la familia). */
  marcas: boolean;
  /** Texto corto para la tarjeta de la portada de EconomiAPP. */
  promo: { titulo: string; texto: string };
  /** Se anuncia en la portada (tarjeta grande y carrusel). Las demás salen como círculo con foto. */
  destacada?: boolean;
  /** Ancho real (px) de las imágenes de escritorio [chica, grande], para el srcset. */
  anchosEscritorio?: [number, number];
  /** Leyenda obligatoria o aviso (licores, medicamentos) que se muestra en la portada. */
  aviso?: string;
  /** Subcategorías que no se promocionan en la vitrina (siguen en Explorar). */
  ocultar?: string[];
}

const R = 'economiapp/vitrinas/';
const C = 'economiapp/categorias/';

export const VITRINAS: Vitrina[] = [
  {
    slug: 'tecnologia',
    codigo: 'TEC',
    nombre: 'Tecnología',
    etiqueta: 'Catálogo global · Paga con su bono mercado',
    eslogan: 'La tecnología que quiere, al alcance de su bono',
    bajada: 'Celulares, computadores, audio, relojes y gaming. Lo encarga hoy, le llega a su tienda y se descuenta solo cuando lo recibe.',
    cta: 'Ver celulares',
    ctaCodigo: 'GLB-CEL',
    miniatura: R + 'tec-tile-cel.webp',
    disposicion: 'rieles',
    hero: {
      escritorio: R + 'tec-hero-desk.webp', escritorioChico: R + 'tec-hero-desk-1400.webp',
      movil: R + 'tec-hero-movil.webp', movilChico: R + 'tec-hero-movil-720.webp',
    },
    carrusel: { grande: R + 'tec-carrusel.webp', chico: R + 'tec-carrusel-900.webp' },
    mosaicos: {
      'GLB-CEL': R + 'tec-tile-cel.webp', 'GLB-PC': R + 'tec-tile-pc.webp', 'GLB-TAB': R + 'tec-tile-tab.webp',
      'GLB-AUD': R + 'tec-tile-aud.webp', 'GLB-REL': R + 'tec-tile-rel.webp', 'GLB-GAM': R + 'tec-tile-gam.webp',
      'GLB-ACC': R + 'tec-tile-acc.webp', 'GLB-HOG': R + 'tec-tile-hog.webp', 'GLB-MOV': R + 'tec-tile-mov.webp',
      'TEC-CUIDADO': R + 'tec-tile-cui.webp',
    },
    tema: { fondo: '#060B1F', fondo2: '#141B4D', acento: '#5B8CFF', acentoTinta: '#FFFFFF' },
    beneficios: [
      { icono: 'account_balance_wallet', titulo: 'Con su bono mercado', texto: 'Se aparta al pedir y se descuenta solo cuando lo recibe.' },
      { icono: 'local_shipping', titulo: 'Llega a su tienda', texto: 'Cada producto dice en cuántos días llega.' },
      { icono: 'verified', titulo: 'Nuevo y con garantía', texto: 'La condición y la garantía van en cada ficha.' },
      { icono: 'support_agent', titulo: 'MatIA le ayuda a elegir', texto: 'Pregúntele cuál le sirve según su presupuesto.' },
    ],
    preguntaMatia: '¿Qué celular me recomiendas con mi bono mercado?',
    marcas: true,
    promo: { titulo: 'Tecnología', texto: 'Celulares, audio y más con su bono mercado' },
    destacada: true,
    anchosEscritorio: [1400, 2400],
  },
  {
    slug: 'importados',
    codigo: 'IMP',
    nombre: 'Importados',
    etiqueta: 'Nueva mercancía importada',
    eslogan: '¿Mercancía? ¡Sí hay!',
    bajada: 'Llegó mercancía importada para su casa: organizadores, belleza, aseo, bicicletas y tecnología a precio de importador.',
    cta: 'Ver todo lo nuevo',
    miniatura: R + 'imp-tile-tec.webp',
    disposicion: 'rejilla',
    hero: {
      escritorio: R + 'imp-hero-desk.webp', escritorioChico: R + 'imp-hero-desk-1400.webp',
      movil: R + 'imp-hero-movil.webp', movilChico: R + 'imp-hero-movil-720.webp',
    },
    carrusel: { grande: R + 'imp-carrusel.webp', chico: R + 'imp-carrusel-900.webp' },
    mosaicos: {
      'IMP-TEC': R + 'imp-tile-tec.webp', 'IMP-HOG': R + 'imp-tile-hog.webp',
      'IMP-BEL': R + 'imp-tile-bel.webp', 'IMP-ASE': R + 'imp-tile-ase.webp',
    },
    tema: { fondo: '#0A1A55', fondo2: '#1846C4', acento: '#3DCB5A', acentoTinta: '#05210C' },
    beneficios: [
      { icono: 'inventory_2', titulo: '¡Sí hay!', texto: 'Mercancía disponible para llevar.' },
      { icono: 'sell', titulo: 'Precio de importador', texto: 'Directo, sin intermediarios.' },
      { icono: 'storefront', titulo: 'Recoja o le llevamos', texto: 'En la tienda, su oficina o su casa.' },
      { icono: 'account_balance_wallet', titulo: 'Con su bono mercado', texto: 'O en efectivo, como prefiera.' },
    ],
    preguntaMatia: '¿Qué productos importados tienen para organizar la casa?',
    marcas: false,
    insignia: 'Importado',
    promo: { titulo: '¿Mercancía? ¡Sí hay!', texto: 'Importados para el hogar, belleza y más' },
    destacada: true,
    anchosEscritorio: [1400, 2400],
  },
];

// ── El resto de las categorías: misma vitrina, imágenes por convención ──────────────
// public/economiapp/categorias/<slug>/{panoramica(-900),movil(-720),miniatura,sub-*}.webp

const BENEFICIOS_TIENDA: BeneficioVitrina[] = [
  { icono: 'storefront', titulo: 'Para hoy', texto: 'Lo aparta y lo recoge hoy, o se lo llevamos.' },
  { icono: 'account_balance_wallet', titulo: 'Con su bono mercado', texto: 'O en efectivo, como prefiera.' },
  { icono: 'stars', titulo: 'Gana puntos', texto: 'Cada compra suma para canjear premios.' },
  { icono: 'local_offer', titulo: 'Ofertas', texto: 'En promoción gana el doble de puntos.' },
];

interface DefCategoria {
  slug: string; codigo: string; nombre: string; eslogan: string; bajada: string; cta?: string;
  disposicion: 'rieles' | 'rejilla'; tema: Vitrina['tema']; pregunta: string; promo: string;
  subs?: Record<string, string>; destacada?: boolean; aviso?: string; ocultar?: string[];
  beneficios?: BeneficioVitrina[]; marcas?: boolean;
}

function categoria(d: DefCategoria): Vitrina {
  const b = C + d.slug + '/';
  return {
    slug: d.slug, codigo: d.codigo, nombre: d.nombre, etiqueta: d.nombre + ' en su tienda', eslogan: d.eslogan, bajada: d.bajada,
    cta: d.cta ?? 'Ver todo', miniatura: b + 'miniatura.webp', disposicion: d.disposicion,
    hero: { escritorio: b + 'panoramica.webp', escritorioChico: b + 'panoramica-900.webp', movil: b + 'movil.webp', movilChico: b + 'movil-720.webp' },
    carrusel: { grande: b + 'panoramica.webp', chico: b + 'panoramica-900.webp' },
    mosaicos: Object.fromEntries(Object.entries(d.subs ?? {}).map(([cod, archivo]) => [cod, b + 'sub-' + archivo + '.webp'])),
    tema: d.tema, beneficios: d.beneficios ?? BENEFICIOS_TIENDA, preguntaMatia: d.pregunta, marcas: d.marcas ?? true,
    promo: { titulo: d.nombre, texto: d.promo }, destacada: d.destacada, anchosEscritorio: [900, 1600], aviso: d.aviso, ocultar: d.ocultar,
  };
}

const SUPER = 'D-SUPERMERCADO-';
VITRINAS.push(
  categoria({
    slug: 'comidas', codigo: 'COMIDAS', nombre: 'Comidas rápidas', eslogan: 'Antojo resuelto: perros calientes y más',
    bajada: 'Perro sencillo o especial, recién hecho en Flora Market. Pídalo y recójalo caliente, o se lo llevamos.',
    disposicion: 'rejilla', tema: { fondo: '#2A0606', fondo2: '#9F1239', acento: '#FBBF24', acentoTinta: '#2A1300' },
    pregunta: '¿Qué me recomiendas para almorzar rápido?', promo: 'Perros calientes recién hechos', destacada: true, marcas: false,
  }),
  categoria({
    slug: 'supermercado', codigo: 'D-SUPERMERCADO', nombre: 'Supermercado', eslogan: 'Su mercado completo, sin hacer fila',
    bajada: 'Arroz, granos, lácteos, aceite, café y todo lo de la semana, listo para recoger hoy en su tienda.',
    disposicion: 'rieles', tema: { fondo: '#052E16', fondo2: '#15803D', acento: '#A3E635', acentoTinta: '#1A2E05' },
    pregunta: 'Ármame el mercado de la semana con mi bono', promo: 'Todo el mercado de la semana', destacada: true,
    subs: {
      [SUPER + 'ARROZ']: 'arroz', [SUPER + 'AVENA']: 'avena', [SUPER + 'BEBIDA-INSTANT']: 'bebida-instantanea', [SUPER + 'CAFE']: 'cafe',
      [SUPER + 'CEREAL']: 'cereal', [SUPER + 'COMIDA-INSTANT']: 'comida-instantanea', [SUPER + 'CONDIMENTOS']: 'condimentos',
      [SUPER + 'DULCERIA']: 'dulceria', [SUPER + 'EMBUTIDOS']: 'embutidos', [SUPER + 'ENLATADOS']: 'enlatados', [SUPER + 'GRANOS']: 'granos',
      [SUPER + 'GRASAS']: 'grasas', [SUPER + 'HARINAS']: 'harinas', [SUPER + 'HUEVOS']: 'huevos', [SUPER + 'LACTEOS']: 'lacteos',
      [SUPER + 'PAN']: 'pan', [SUPER + 'PASTAS']: 'pastas', [SUPER + 'SALSAS']: 'salsas', [SUPER + 'SANDUCHION']: 'sanduchon',
      [SUPER + 'SUPER-RICAS']: 'paquetes',
    },
  }),
  categoria({
    slug: 'aseo', codigo: 'D-ASEO', nombre: 'Aseo', eslogan: 'La casa reluciente',
    bajada: 'Blanqueadores, detergentes, suavizantes y todo para dejar la casa limpia y oliendo rico.',
    disposicion: 'rieles', tema: { fondo: '#082F49', fondo2: '#0284C7', acento: '#67E8F9', acentoTinta: '#083344' },
    pregunta: '¿Qué necesito para el aseo de la casa este mes?', promo: 'Limpieza para toda la casa',
    subs: { 'D-ASEO-ASEO-HOGAR': 'aseo-hogar', 'D-ASEO-DETERGENTE': 'detergente', 'D-ASEO-SUAVIZANTE': 'suavizante' },
  }),
  categoria({
    slug: 'cuidado-personal', codigo: 'GLB-CUI', nombre: 'Cuidado personal', eslogan: 'Lo de todos los días, siempre a la mano',
    bajada: 'Champú, jabón, crema dental, desodorante y lo que usa cada día, al precio de su tienda.',
    disposicion: 'rieles', tema: { fondo: '#042F2E', fondo2: '#0D9488', acento: '#5EEAD4', acentoTinta: '#042F2E' },
    pregunta: '¿Qué productos de aseo personal me alcanzan con mi bono?', promo: 'Aseo personal de todos los días',
  }),
  categoria({
    slug: 'belleza', codigo: 'D-BELLEZA', nombre: 'Belleza', eslogan: 'Maquillaje y perfumes para brillar',
    bajada: 'Labiales, sombras, brochas y perfumes para todos los días y para las ocasiones especiales.',
    disposicion: 'rieles', tema: { fondo: '#3B0820', fondo2: '#BE185D', acento: '#F9A8D4', acentoTinta: '#500724' },
    pregunta: 'Recomiéndame un kit de maquillaje básico', promo: 'Maquillaje y perfumes',
    subs: { 'D-BELLEZA-MAQUILLAJE': 'maquillaje', 'D-BELLEZA-PERFUMES': 'perfumes' },
  }),
  categoria({
    slug: 'bebidas', codigo: 'D-BEBIDAS', nombre: 'Bebidas', eslogan: 'Para refrescar el día',
    bajada: 'Gaseosas, jugos, avenas, café y bebidas para la lonchera, frías y listas.',
    disposicion: 'rieles', tema: { fondo: '#3A1206', fondo2: '#C2410C', acento: '#FDBA74', acentoTinta: '#431407' },
    pregunta: '¿Qué bebidas me sirven para la lonchera de la semana?', promo: 'Gaseosas, jugos y más',
  }),
  categoria({
    slug: 'hogar', codigo: 'D-HOGAR', nombre: 'Hogar', eslogan: 'Todo para su hogar',
    bajada: 'Electrodomésticos y artículos para la cocina y la casa, al alcance de su bono.',
    disposicion: 'rejilla', tema: { fondo: '#3B1A05', fondo2: '#B45309', acento: '#FCD34D', acentoTinta: '#3B1A05' },
    pregunta: '¿Qué electrodomésticos tienen para la cocina?', promo: 'Cocina y casa',
    subs: { 'D-HOGAR-ELECTRODOMESTI': 'electrodomesticos' },
  }),
  categoria({
    slug: 'drogueria', codigo: 'D-DROGUERIA', nombre: 'Droguería', eslogan: 'Su botiquín al día',
    bajada: 'Lo básico para el botiquín de la casa, sin salir a buscarlo.',
    disposicion: 'rejilla', tema: { fondo: '#022C22', fondo2: '#059669', acento: '#6EE7B7', acentoTinta: '#022C22' },
    pregunta: '¿Qué debería tener un botiquín básico en casa?', promo: 'El botiquín de la casa', marcas: false,
    aviso: 'Medicamentos de venta libre. Ante cualquier duda, consulte a su médico o farmacéutico.',
  }),
  categoria({
    slug: 'licores', codigo: 'D-LICORES', nombre: 'Licores', eslogan: 'Para celebrar con moderación',
    bajada: 'Vinos, rones, aguardiente y cervezas para sus reuniones. Venta solo a mayores de edad.',
    disposicion: 'rieles', tema: { fondo: '#1C1209', fondo2: '#78350F', acento: '#F59E0B', acentoTinta: '#1C1209' },
    pregunta: '¿Qué vino me recomiendas para una cena?', promo: 'Solo para mayores de edad',
    aviso: 'El exceso de alcohol es perjudicial para la salud. Prohíbase el expendio de bebidas embriagantes a menores de edad.',
    // Ley 1335 de 2009: el tabaco no se promociona; sigue disponible en Explorar.
    ocultar: ['D-LICORES-TABACO'],
  }),
  categoria({
    slug: 'mascotas', codigo: 'D-MASCOTAS', nombre: 'Mascotas', eslogan: 'Los consentidos de la casa',
    bajada: 'Comida, golosinas y accesorios para perros y gatos.',
    disposicion: 'rejilla', tema: { fondo: '#172554', fondo2: '#2563EB', acento: '#93C5FD', acentoTinta: '#172554' },
    pregunta: '¿Qué comida para perro tienen y cuánto dura el paquete?', promo: 'Comida y accesorios para su mascota',
  }),
  categoria({
    slug: 'escolar', codigo: 'D-ESCOLAR', nombre: 'Escolar', eslogan: 'Listos para el colegio',
    bajada: 'Cuadernos, colores, lápices y todo lo de la lista escolar en un solo lugar.',
    disposicion: 'rejilla', tema: { fondo: '#1E1B4B', fondo2: '#4F46E5', acento: '#FDE047', acentoTinta: '#1E1B4B' },
    pregunta: 'Ayúdame con la lista escolar de mi hijo', promo: 'La lista escolar completa',
  }),
  categoria({
    slug: 'jugueteria', codigo: 'D-JUGUETERIA', nombre: 'Juguetería', eslogan: 'A jugar se dijo',
    bajada: 'Juguetes para todas las edades: para regalar, para premiar y para compartir.',
    disposicion: 'rieles', tema: { fondo: '#3B0A45', fondo2: '#C026D3', acento: '#FDE047', acentoTinta: '#3B0A45' },
    pregunta: '¿Qué juguete me recomiendas para un niño de 6 años?', promo: 'Juguetes para regalar',
  }),
  categoria({
    slug: 'moda', codigo: 'D-MODA', nombre: 'Moda', eslogan: 'Estilo para todos los días',
    bajada: 'Ropa para mujer y hombre, accesorios y joyería, con su bono mercado.',
    disposicion: 'rieles', tema: { fondo: '#18181B', fondo2: '#9D174D', acento: '#FBCFE8', acentoTinta: '#18181B' },
    pregunta: '¿Qué ropa tienen para mujer en tendencia?', promo: 'Ropa, accesorios y joyería',
    subs: {
      'D-MODA-ACCESORIOS-HOM': 'accesorios-hombre', 'D-MODA-ACCESORIOS-MUJ': 'accesorios-mujer', 'D-MODA-JOYERIA': 'joyeria',
      'D-MODA-ROPA': 'ropa', 'D-MODA-ROPA-MUJER': 'ropa-mujer',
    },
  }),
  categoria({
    slug: 'varios', codigo: 'D-VARIOS', nombre: 'Varios', eslogan: 'De todo un poco para la casa',
    bajada: 'Organizadores, utensilios, velas, pilas y esas cosas que siempre hacen falta.',
    disposicion: 'rieles', tema: { fondo: '#0F172A', fondo2: '#475569', acento: '#E2E8F0', acentoTinta: '#0F172A' },
    pregunta: '¿Qué artículos para organizar la casa tienen?', promo: 'Lo que siempre hace falta',
    subs: { 'D-VARIOS-HOGAR': 'hogar' },
  }),
);

export function vitrinaPorSlug(slug: string | null | undefined): Vitrina | null {
  return VITRINAS.find(v => v.slug === slug) ?? null;
}

export function vitrinaPorCodigo(codigo: string | null | undefined): Vitrina | null {
  return VITRINAS.find(v => v.codigo === codigo) ?? null;
}
