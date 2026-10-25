import { environment } from '../../../environments/environment';

/**
 * Modo demostración para la revisión de Google Play.
 *
 * Los revisores de Google entran desde fuera de Colombia, donde api.tuapo.co no responde, y no se
 * les puede dar una cuenta con datos de personas reales. Con la cuenta de revisión la app NO sale
 * al API: `demo-sandbox.ts` contesta cada llamada con los datos 100 % ficticios de `demo-datos.ts`.
 *
 * La marca vive en localStorage y `clearLocalStorage()` la borra al cerrar sesión (no es clave de
 * dispositivo), así que el siguiente login va al servidor real aunque el sandbox siga instalado:
 * el sandbox revisa la marca en cada petición.
 */
export const CLAVE_MODO_DEMO = 'tuapo_modo_demo';

// La cuenta que se declara en Play Console › Detalles de acceso. Nunca existe en el servidor.
const CUENTA_REVISION = 'thisisatestaccount@test.com';
const CLAVE_REVISION = 'thisisatestaccount23#';

export function esCuentaDeRevision(login: string, password: string): boolean {
  return login.trim().toLowerCase() === CUENTA_REVISION && password === CLAVE_REVISION;
}

export function modoDemoActivo(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(CLAVE_MODO_DEMO) === '1';
  } catch {
    return false;
  }
}

/** Pone la marca e instala el sandbox ANTES de la primera llamada al API (el login). */
export async function activarModoDemo(): Promise<void> {
  localStorage.setItem(CLAVE_MODO_DEMO, '1');
  await prepararModoDemo();
}

/**
 * Al arrancar la app (main.ts, antes del bootstrap): si quedó una sesión de demostración abierta,
 * el sandbox tiene que estar puesto antes de que los servicios hagan su primera petición.
 * El código del sandbox y los datos van en un chunk aparte: nadie más los descarga.
 */
export async function prepararModoDemo(): Promise<void> {
  if (!modoDemoActivo()) return;
  const { instalarSandboxDemo } = await import('./demo-sandbox');
  instalarSandboxDemo(environment.apiUrl);
}
