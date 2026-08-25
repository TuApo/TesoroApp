/**
 * Capa de biometría con dos backends, elegidos en tiempo de ejecución:
 *
 *  1. **Plugin nativo de Capacitor** (`@aparajita/capacitor-biometric-auth`),
 *     en el APK Android: huella, rostro o iris del propio teléfono, con caída
 *     al PIN/patrón del sistema. Se carga con `import()` dinámico, así que la
 *     versión web nunca descarga ese chunk.
 *
 *  2. **WebAuthn / passkey de plataforma** en el navegador: huella, Face ID o
 *     Windows Hello. Si el autenticador soporta la extensión `prf`, además
 *     devuelve material de clave: la huella deja de ser un simple portero y
 *     pasa a ser parte de la llave que descifra las credenciales.
 *
 * En Electron no hay ninguno de los dos: la ventana carga con `file://` y ese
 * origen no puede actuar como rp de WebAuthn. Allí el factor humano es el PIN
 * y el binding lo pone el cifrado del sistema operativo (ver `secure-store`).
 *
 * Cuando el backend nativo actúa como portero (sin PRF), el criptograma sigue
 * protegido por la clave de dispositivo: saltarse el portero editando el
 * almacenamiento no basta para leer nada.
 */

import { b64uDecode, b64uEncode, randomBytes, toBytes } from './crypto.util';
import { detectarPlataforma } from './plataforma.util';

export type BackendBiometrico = 'webauthn' | 'nativo' | 'ninguno';

export interface SoporteBiometrico {
  disponible: boolean;
  backend: BackendBiometrico;
  /** Texto para la UI: "Huella digital", "Windows Hello"… */
  etiqueta: string;
}

export interface RegistroBiometrico {
  backend: BackendBiometrico;
  /** Id de la credencial WebAuthn (base64url). */
  credentialId?: string;
  /** Sal fija de la extensión PRF; sin ella el secreto derivado no se reproduce. */
  prfSalt?: string;
  /** true si el autenticador entregó secreto PRF en el registro. */
  prf?: boolean;
}

interface PluginNativo {
  verificar: () => Promise<void>;
  etiqueta: string;
}

/**
 * Carga el plugin nativo solo en Android/iOS y solo la primera vez. El
 * `import()` dinámico deja el plugin en su propio chunk: la web no lo descarga.
 */
async function detectarPluginNativo(): Promise<PluginNativo | null> {
  const plataforma = detectarPlataforma();
  if (plataforma !== 'android' && plataforma !== 'ios') return null;

  try {
    const mod = await import('@aparajita/capacitor-biometric-auth');
    const info = await mod.BiometricAuth.checkBiometry();
    if (!info?.isAvailable) return null;

    return {
      etiqueta: etiquetaTipoBiometria(info.biometryType, mod.BiometryType),
      verificar: () => mod.BiometricAuth.authenticate({
        reason: 'Desbloquear Tu Apo',
        androidTitle: 'Verifica tu identidad',
        androidSubtitle: 'Usa tu huella o rostro para entrar',
        cancelTitle: 'Cancelar',
        // Permite caer al PIN/patrón del teléfono si la biometría falla: el
        // usuario sigue demostrando que es el dueño del dispositivo.
        allowDeviceCredential: true,
        androidBiometryStrength: mod.AndroidBiometryStrength.weak,
      }),
    };
  } catch {
    // Plugin ausente en el APK (build antiguo) o biometría no disponible.
    return null;
  }
}

function etiquetaTipoBiometria(tipo: unknown, tipos: any): string {
  switch (tipo) {
    case tipos?.faceId: return 'Face ID';
    case tipos?.touchId: return 'Touch ID';
    case tipos?.faceAuthentication: return 'Reconocimiento facial del teléfono';
    case tipos?.irisAuthentication: return 'Reconocimiento de iris del teléfono';
    case tipos?.fingerprintAuthentication: return 'Huella digital del teléfono';
    default: return 'Huella o rostro del dispositivo';
  }
}

function webauthnPosible(): boolean {
  try {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    if (typeof (window as any).PublicKeyCredential === 'undefined') return false;
    if (!navigator.credentials?.create) return false;
    // WebAuthn exige contexto seguro. En el WebView de Capacitor el origen es
    // localhost/capacitor y el navegador suele rechazarlo: por eso ahí el
    // camino bueno es el plugin nativo, y este backend queda como reserva.
    return location.protocol === 'https:' || location.hostname === 'localhost';
  } catch {
    return false;
  }
}

export async function detectarBiometria(): Promise<SoporteBiometrico> {
  const nativo = await detectarPluginNativo();
  if (nativo) {
    return { disponible: true, backend: 'nativo', etiqueta: nativo.etiqueta };
  }

  if (webauthnPosible()) {
    try {
      const ok = await (window as any).PublicKeyCredential
        .isUserVerifyingPlatformAuthenticatorAvailable();
      if (ok) {
        const esWindows = /Windows/i.test(navigator.userAgent);
        const esApple = /Mac|iPhone|iPad/i.test(navigator.userAgent);
        return {
          disponible: true,
          backend: 'webauthn',
          etiqueta: esWindows ? 'Windows Hello (huella, rostro o PIN del equipo)'
            : esApple ? 'Touch ID / Face ID'
            : 'Huella o rostro del dispositivo',
        };
      }
    } catch { /* sin autenticador de plataforma */ }
  }

  return { disponible: false, backend: 'ninguno', etiqueta: '' };
}

function bufferFuente(b: Uint8Array): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

/**
 * Da de alta el factor biométrico. Devuelve el registro a persistir y, si el
 * autenticador soporta PRF, el secreto derivado para envolver la clave.
 */
export async function registrarBiometria(
  usuarioId: string,
  usuarioNombre: string,
  usuarioVisible: string,
): Promise<{ registro: RegistroBiometrico; secreto: Uint8Array | null }> {
  const nativo = await detectarPluginNativo();
  if (nativo) {
    await nativo.verificar(); // confirma que el usuario puede autenticarse ya
    return { registro: { backend: 'nativo' }, secreto: null };
  }

  const prfSaltBytes = randomBytes(32);
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: bufferFuente(randomBytes(32)),
      rp: { name: 'Tu Apo', id: location.hostname },
      user: {
        id: bufferFuente(toBytes(usuarioId)),
        name: usuarioNombre,
        displayName: usuarioVisible,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },   // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'preferred',
        userVerification: 'required',
      },
      timeout: 60_000,
      attestation: 'none',
      extensions: { prf: { eval: { first: bufferFuente(prfSaltBytes) } } } as any,
    },
  }) as PublicKeyCredential | null;

  if (!cred) throw new Error('No se pudo registrar la biometría.');

  const ext: any = cred.getClientExtensionResults?.() ?? {};
  const prfBruto: ArrayBuffer | undefined = ext?.prf?.results?.first;
  const secreto = prfBruto ? new Uint8Array(prfBruto) : null;

  return {
    registro: {
      backend: 'webauthn',
      credentialId: b64uEncode(new Uint8Array(cred.rawId)),
      prfSalt: b64uEncode(prfSaltBytes),
      prf: !!secreto,
    },
    secreto,
  };
}

/**
 * Pide la verificación biométrica. Lanza si el usuario cancela o falla.
 * Devuelve el secreto PRF cuando el registro se hizo con esa extensión.
 */
export async function verificarBiometria(reg: RegistroBiometrico): Promise<Uint8Array | null> {
  if (reg.backend === 'nativo') {
    const nativo = await detectarPluginNativo();
    if (!nativo) throw new Error('La biometría ya no está disponible en este dispositivo.');
    await nativo.verificar();
    return null;
  }

  if (!reg.credentialId) throw new Error('Registro biométrico incompleto.');
  const prfSalt = reg.prfSalt ? b64uDecode(reg.prfSalt) : null;

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: bufferFuente(randomBytes(32)),
      rpId: location.hostname,
      allowCredentials: [{ type: 'public-key', id: bufferFuente(b64uDecode(reg.credentialId)) }],
      userVerification: 'required',
      timeout: 60_000,
      ...(prfSalt ? { extensions: { prf: { eval: { first: bufferFuente(prfSalt) } } } as any } : {}),
    },
  }) as PublicKeyCredential | null;

  if (!assertion) throw new Error('Verificación biométrica cancelada.');

  const ext: any = assertion.getClientExtensionResults?.() ?? {};
  const prfBruto: ArrayBuffer | undefined = ext?.prf?.results?.first;

  if (reg.prf && !prfBruto) {
    // El registro se selló con PRF; sin el secreto no hay forma de descifrar.
    throw new Error('El autenticador no devolvió la clave biométrica.');
  }
  return prfBruto ? new Uint8Array(prfBruto) : null;
}
