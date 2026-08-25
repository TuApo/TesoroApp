/**
 * En qué envoltorio corre la app. Determina qué puede ofrecer el acceso
 * rápido, porque cada entorno tiene capacidades distintas:
 *
 *  · `android` (APK Capacitor) → biometría real vía plugin nativo.
 *  · `electron` (escritorio)   → cifrado del sistema operativo (safeStorage:
 *                                 DPAPI en Windows, Keychain en macOS,
 *                                 libsecret en Linux). Sin WebAuthn: la
 *                                 ventana carga con `file://` y ese origen no
 *                                 puede ser una rp de WebAuthn.
 *  · `web` (navegador)         → WebAuthn (huella / Windows Hello / Face ID)
 *                                 y almacenamiento persistente a petición.
 */
export type Plataforma = 'android' | 'ios' | 'electron' | 'web' | 'servidor';

export function detectarPlataforma(): Plataforma {
  if (typeof window === 'undefined') return 'servidor';

  try {
    const cap = (window as any).Capacitor;
    if (cap?.isNativePlatform?.()) {
      const p = cap.getPlatform?.();
      if (p === 'android') return 'android';
      if (p === 'ios') return 'ios';
    }
  } catch { /* seguimos probando */ }

  try {
    if ((window as any).electron) return 'electron';
  } catch { /* noop */ }

  return 'web';
}

/** App instalada (APK o escritorio): el dispositivo es personal por defecto. */
export function esAppInstalada(): boolean {
  const p = detectarPlataforma();
  return p === 'android' || p === 'ios' || p === 'electron';
}

/**
 * Pide al navegador que NO desaloje los datos de esta app cuando ande escaso
 * de espacio. Sin esto, en web el acceso guardado puede desaparecer solo y el
 * usuario acaba escribiendo la contraseña sin entender por qué.
 *
 * Chrome lo concede según el uso del sitio (o si está instalada como PWA);
 * Firefox pregunta al usuario. Devuelve el estado real, no una promesa vacía.
 */
export async function asegurarPersistencia(): Promise<'concedida' | 'denegada' | 'no-soportada'> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return 'no-soportada';
    if (await navigator.storage.persisted?.()) return 'concedida';
    return (await navigator.storage.persist()) ? 'concedida' : 'denegada';
  } catch {
    return 'no-soportada';
  }
}
