import { FormNavigation, FormTheme, FormUi } from './dynamic-forms.models';

/**
 * TEMA DE DISEÑO de un formulario dinámico: presets, valores por defecto y traducción
 * a custom properties de CSS.
 *
 * Una sola fuente de verdad para las tres pantallas que pintan el formulario (runtime,
 * preview del constructor y, cuando se conecte, la página pública), así un formulario
 * se ve igual en todas. El CSS solo lee variables `--df-*`: ningún componente decide
 * colores por su cuenta.
 */

/** Look histórico de la plataforma: navy + lima. Es lo que ve un formulario sin tema. */
export const TEMA_POR_DEFECTO: Required<Omit<FormTheme,
  'preset' | 'cover_url' | 'cover_document_id' | 'cover_alt' | 'icon'>> & { icon: string } = {
  primary: '#8cd50a',
  on_primary: '#21263c',
  accent: '#21263c',
  surface: '#ffffff',
  bg: '#f6f7fb',
  text: '#334155',
  header_from: '#0f172a',
  header_to: '#334155',
  header_style: 'gradient',
  icon: 'edit_note',
  radius: 14,
  density: 'comoda',
};

export interface PresetTema {
  id: string;
  nombre: string;
  theme: FormTheme;
}

/**
 * Puntos de partida. No pretenden cubrir todo: son atajos para no dejar al usuario
 * frente a seis selectores de color en blanco. Todos cumplen contraste AA del texto
 * sobre su fondo y del `on_primary` sobre `primary`.
 */
export const PRESETS_TEMA: PresetTema[] = [
  {
    id: 'institucional',
    nombre: 'Institucional',
    theme: {
      preset: 'institucional',
      primary: '#8cd50a', on_primary: '#21263c', accent: '#21263c',
      surface: '#ffffff', bg: '#f6f7fb', text: '#334155',
      header_from: '#0f172a', header_to: '#334155', header_style: 'gradient',
      icon: 'edit_note', radius: 14, density: 'comoda',
    },
  },
  {
    id: 'oceano',
    nombre: 'Océano',
    theme: {
      preset: 'oceano',
      primary: '#0ea5e9', on_primary: '#ffffff', accent: '#0c4a6e',
      surface: '#ffffff', bg: '#f0f9ff', text: '#334155',
      header_from: '#082f49', header_to: '#0369a1', header_style: 'gradient',
      icon: 'water_drop', radius: 16, density: 'comoda',
    },
  },
  {
    id: 'bosque',
    nombre: 'Bosque',
    theme: {
      preset: 'bosque',
      primary: '#16a34a', on_primary: '#ffffff', accent: '#14532d',
      surface: '#ffffff', bg: '#f2f9f4', text: '#334155',
      header_from: '#052e16', header_to: '#166534', header_style: 'gradient',
      icon: 'park', radius: 14, density: 'comoda',
    },
  },
  {
    id: 'atardecer',
    nombre: 'Atardecer',
    theme: {
      preset: 'atardecer',
      primary: '#f97316', on_primary: '#ffffff', accent: '#7c2d12',
      surface: '#ffffff', bg: '#fff7ed', text: '#3f3f46',
      header_from: '#431407', header_to: '#c2410c', header_style: 'gradient',
      icon: 'wb_twilight', radius: 18, density: 'comoda',
    },
  },
  {
    id: 'violeta',
    nombre: 'Violeta',
    theme: {
      preset: 'violeta',
      primary: '#7c3aed', on_primary: '#ffffff', accent: '#3b0764',
      surface: '#ffffff', bg: '#faf5ff', text: '#3f3f46',
      header_from: '#2e1065', header_to: '#6d28d9', header_style: 'gradient',
      icon: 'auto_awesome', radius: 16, density: 'comoda',
    },
  },
  {
    id: 'grafito',
    nombre: 'Grafito',
    theme: {
      preset: 'grafito',
      primary: '#111827', on_primary: '#ffffff', accent: '#374151',
      surface: '#ffffff', bg: '#f4f4f5', text: '#27272a',
      header_from: '#18181b', header_to: '#52525b', header_style: 'solid',
      icon: 'draft', radius: 10, density: 'compacta',
    },
  },
];

/** Tema efectivo = defaults + lo que traiga el formulario (sin mutar el original). */
export function temaEfectivo(theme?: FormTheme | null): FormTheme {
  return { ...TEMA_POR_DEFECTO, ...(theme ?? {}) };
}

/**
 * Custom properties para el contenedor de la página. Se aplican con [style] en el
 * elemento raíz; todo el CSS del runtime lee estas variables con un fallback, así una
 * pantalla sin tema sigue viéndose exactamente como antes.
 */
export function variablesTema(theme?: FormTheme | null): Record<string, string> {
  const t = temaEfectivo(theme);
  const compacta = t.density === 'compacta';
  const vars: Record<string, string> = {
    '--df-primary': t.primary!,
    '--df-on-primary': t.on_primary!,
    '--df-accent': t.accent!,
    '--df-surface': t.surface!,
    '--df-bg': t.bg!,
    '--df-text': t.text!,
    '--df-header-from': t.header_from!,
    '--df-header-to': t.header_to!,
    '--df-radius': `${t.radius}px`,
    '--df-gap': compacta ? '10px' : '16px',
    '--df-pad': compacta ? '12px 14px' : '18px 20px',
    '--df-header-pad': compacta ? '16px 20px' : '22px 28px',
    '--df-borde': mezclarConBlanco(t.accent!, 0.86),
  };
  vars['--df-header-bg'] = t.header_style === 'solid'
    ? t.header_from!
    : `linear-gradient(135deg, ${t.header_from} 0%, ${t.header_to} 100%)`;
  return vars;
}

/**
 * Modo de recorrido efectivo. Regla acordada: un formulario con 2+ secciones se llena
 * PASO A PASO salvo que su tema diga explícitamente `single`. Con una sola sección el
 * asistente no aporta nada, así que nunca se activa.
 */
export function modoNavegacion(ui: FormUi | null | undefined, totalSecciones: number): 'wizard' | 'single' {
  if (totalSecciones < 2) return 'single';
  return ui?.navigation?.mode === 'single' ? 'single' : 'wizard';
}

export function navegacionEfectiva(nav?: FormNavigation | null): Required<FormNavigation> {
  return { mode: nav?.mode ?? 'wizard', progress: nav?.progress ?? true };
}

/** Mezcla un hex con blanco (0 = el color, 1 = blanco). Para bordes suaves derivados. */
function mezclarConBlanco(hex: string, factor: number): string {
  const c = normalizarHex(hex);
  if (!c) return '#e8edf3';
  const mezcla = (v: number) => Math.round(v + (255 - v) * factor);
  return `#${[mezcla(c[0]), mezcla(c[1]), mezcla(c[2])].map(n => n.toString(16).padStart(2, '0')).join('')}`;
}

function normalizarHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map(ch => ch + ch).join('') : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
