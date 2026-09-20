/**
 * Acceso seguro a `localStorage` y `sessionStorage`.
 *
 * Motivación:
 * - En SSR (Angular Universal) `window` y `localStorage` no existen.
 * - En Electron preload con sandbox a veces `window.localStorage` puede
 *   estar deshabilitado para un frame.
 * - Tener un helper centralizado evita repetir guards `isPlatformBrowser`
 *   y previene `ReferenceError` que tumban hidratación silenciosamente.
 *
 * No cambia la lógica de negocio: keys, valores y comportamiento de auth
 * quedan idénticos. Solo se evita acceder al objeto cuando no existe.
 */

function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function hasSessionStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
  } catch {
    return false;
  }
}

// ─── localStorage ────────────────────────────────────────────────────────

export function canUseBrowserStorage(): boolean {
  return hasLocalStorage();
}

export function getLocalStorageItem(key: string): string | null {
  if (!hasLocalStorage()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setLocalStorageItem(key: string, value: string): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* QuotaExceededError o políticas restrictivas: silenciar. */
  }
}

export function removeLocalStorageItem(key: string): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.removeItem(key);
  } catch { /* noop */ }
}

/**
 * Preferencias del DISPOSITIVO, no de la sesión: sobreviven al logout. El
 * cierre de sesión borra todo el localStorage, y sin esta lista el tema
 * elegido (claro/oscuro) volvía a claro cada vez que alguien salía y entraba.
 * Solo van aquí ajustes de apariencia, nunca datos del usuario ni tokens.
 */
const CLAVES_DE_DISPOSITIVO = ['tuapo.ui.tema', 'tuapo.ui.menu', 'tuapo.ui.acciones'];
/** Prefijos de lo mismo: la vista tabla/tarjetas que eligió cada quien por pantalla. */
const PREFIJOS_DE_DISPOSITIVO = ['tabla:'];

export function clearLocalStorage(): void {
  if (!hasLocalStorage()) return;
  try {
    const ls = window.localStorage;
    const conservadas: (readonly [string, string | null])[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && (CLAVES_DE_DISPOSITIVO.includes(k) || PREFIJOS_DE_DISPOSITIVO.some((p) => k.startsWith(p)))) {
        conservadas.push([k, ls.getItem(k)]);
      }
    }
    ls.clear();
    for (const [k, v] of conservadas) if (v !== null) ls.setItem(k, v);
  } catch { /* noop */ }
}

// ─── sessionStorage ──────────────────────────────────────────────────────

export function getSessionStorageItem(key: string): string | null {
  if (!hasSessionStorage()) return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setSessionStorageItem(key: string, value: string): void {
  if (!hasSessionStorage()) return;
  try {
    window.sessionStorage.setItem(key, value);
  } catch { /* noop */ }
}

export function removeSessionStorageItem(key: string): void {
  if (!hasSessionStorage()) return;
  try {
    window.sessionStorage.removeItem(key);
  } catch { /* noop */ }
}
