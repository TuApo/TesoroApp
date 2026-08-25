/**
 * Primitivas criptográficas del acceso rápido. Todo con Web Crypto nativo:
 * cero dependencias nuevas, cero implementaciones caseras de AES o PBKDF2.
 *
 * Convenciones:
 *  - Cifrado simétrico: AES-256-GCM (autenticado: si alguien altera un byte
 *    del blob guardado, el descifrado falla en vez de devolver basura).
 *  - Todo lo que se persiste va en base64url, seguro para JSON e IndexedDB.
 *  - Cada `encrypt` usa un IV aleatorio de 12 bytes (nunca reutilizado) y un
 *    AAD que ata el criptograma a su contexto (dispositivo + método + versión).
 *    Así un blob no puede reutilizarse en otro registro aunque se copie.
 */

export interface SelloCifrado {
  /** IV (nonce) de 12 bytes, base64url. */
  iv: string;
  /** Criptograma + tag GCM, base64url. */
  ct: string;
}

// ─── Codificación ────────────────────────────────────────────────────────

export function toBytes(texto: string): Uint8Array {
  return new TextEncoder().encode(texto);
}

export function fromBytes(bytes: ArrayBuffer | Uint8Array): string {
  return new TextDecoder().decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

export function b64uEncode(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let bin = '';
  // Trocear evita "Maximum call stack size exceeded" con buffers grandes.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64uDecode(texto: string): Uint8Array {
  const norm = texto.replace(/-/g, '+').replace(/_/g, '/');
  const pad = norm.length % 4 === 0 ? '' : '='.repeat(4 - (norm.length % 4));
  const bin = atob(norm + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/** Buffer real para las APIs de WebCrypto (evita SharedArrayBuffer en los tipos). */
function buf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

// ─── AES-GCM ─────────────────────────────────────────────────────────────

export async function importAesKey(raw: Uint8Array, extractable = false): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', buf(raw), { name: 'AES-GCM' }, extractable, ['encrypt', 'decrypt']);
}

export async function generarAesKeyRaw(): Promise<Uint8Array> {
  return randomBytes(32);
}

export async function aesEncrypt(key: CryptoKey, datos: Uint8Array, aad: string): Promise<SelloCifrado> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: buf(iv), additionalData: buf(toBytes(aad)), tagLength: 128 },
    key,
    buf(datos),
  );
  return { iv: b64uEncode(iv), ct: b64uEncode(ct) };
}

/** Lanza si la clave es incorrecta o el blob fue manipulado (tag GCM inválido). */
export async function aesDecrypt(key: CryptoKey, sello: SelloCifrado, aad: string): Promise<Uint8Array> {
  const plano = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: buf(b64uDecode(sello.iv)),
      additionalData: buf(toBytes(aad)),
      tagLength: 128,
    },
    key,
    buf(b64uDecode(sello.ct)),
  );
  return new Uint8Array(plano);
}

// ─── Derivación desde PIN ────────────────────────────────────────────────

/**
 * Iteraciones de PBKDF2-SHA256. 310.000 es la recomendación OWASP vigente.
 * Un PIN de 6 dígitos solo tiene 10^6 combinaciones, así que el coste por
 * intento es la única defensa real contra fuerza bruta offline — y por eso
 * el registro además se autodestruye a los 5 intentos fallidos.
 */
export const PBKDF2_ITERACIONES = 310_000;

export async function derivarClaveDePin(
  pin: string,
  salt: Uint8Array,
  iteraciones = PBKDF2_ITERACIONES,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', buf(toBytes(pin)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: buf(salt), iterations: iteraciones, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Deriva una clave AES desde el secreto que devuelve la extensión PRF de
 * WebAuthn (cuando el autenticador la soporta). En ese caso la huella no es
 * solo un "portero": produce material de clave real, y sin el dedo correcto
 * el blob es matemáticamente indescifrable.
 */
export async function derivarClaveDeSecreto(secreto: Uint8Array, info: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', buf(secreto), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: buf(toBytes(info)) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function sha256B64u(texto: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', buf(toBytes(texto)));
  return b64uEncode(h);
}
