/**
 * Audio para la transcripción en vivo: de lo que entrega WebAudio (Float32 a 44,1 o 48 kHz,
 * a veces estéreo) a lo que pide el STT en tiempo real (PCM16 little-endian, mono, 16 kHz,
 * en bloques de 100 ms codificados en base64).
 *
 * <p>Todo aquí es puro y sin DOM: se prueba con arreglos y no necesita micrófono.
 */

export const TASA_STT = 16_000;
/** 100 ms a 16 kHz: 1600 muestras = 3200 bytes, el tamaño de bloque que recomienda el proveedor. */
export const MUESTRAS_POR_BLOQUE = 1_600;

/**
 * Cambia la tasa de muestreo de un flujo que llega por trozos.
 *
 * <p>Promedia las muestras que caen en cada muestra de salida (filtro de caja). Para voz es
 * suficiente: el contenido útil de la palabra está por debajo de 4 kHz y el promedio ya
 * atenúa lo que se doblaría por encima de 8 kHz. Guarda la fase y el sobrante entre trozos,
 * así que partir el audio en bloques de cualquier tamaño da el mismo resultado que de una vez.
 */
export class Remuestreador {
  private resto = new Float32Array(0);
  private fase = 0;

  constructor(readonly tasaEntrada: number, readonly tasaSalida = TASA_STT) {
    if (!(tasaEntrada > 0) || !(tasaSalida > 0)) throw new Error('Tasa de muestreo inválida');
  }

  procesar(entrada: Float32Array): Float32Array {
    if (this.tasaEntrada === this.tasaSalida) return entrada.slice();
    const datos = concatenar(this.resto, entrada);
    const paso = this.tasaEntrada / this.tasaSalida;
    const n = Math.max(0, Math.floor((datos.length - this.fase) / paso + 1e-9));
    const salida = new Float32Array(n);
    let inicio = this.fase;
    for (let i = 0; i < n; i++) {
      const fin = inicio + paso;
      const a = Math.floor(inicio);
      const b = Math.min(datos.length, Math.max(a + 1, Math.ceil(fin - 1e-9)));
      let suma = 0;
      for (let k = a; k < b; k++) suma += datos[k];
      salida[i] = suma / (b - a);
      inicio = fin;
    }
    const consumido = Math.min(datos.length, Math.floor(inicio + 1e-9));
    this.resto = datos.slice(consumido);
    this.fase = Math.max(0, inicio - consumido);
    return salida;
  }

  reiniciar(): void {
    this.resto = new Float32Array(0);
    this.fase = 0;
  }
}

/** Mezcla los canales de un bloque de WebAudio a uno solo. */
export function aMono(canales: ArrayLike<number>[]): Float32Array {
  if (!canales.length) return new Float32Array(0);
  if (canales.length === 1) return Float32Array.from(canales[0]);
  const n = canales[0].length;
  const salida = new Float32Array(n);
  for (const c of canales) for (let i = 0; i < n; i++) salida[i] += c[i] / canales.length;
  return salida;
}

/** Float32 [-1, 1] → PCM16 con recorte (lo que sature no da la vuelta). */
export function aPcm16(muestras: Float32Array): Int16Array {
  const salida = new Int16Array(muestras.length);
  for (let i = 0; i < muestras.length; i++) {
    const s = Math.max(-1, Math.min(1, muestras[i] || 0));
    salida[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return salida;
}

/** Bytes little-endian del PCM16 (explícito: no depende del orden de bytes del equipo). */
export function pcm16ABytes(pcm: Int16Array): Uint8Array {
  const bytes = new Uint8Array(pcm.length * 2);
  const vista = new DataView(bytes.buffer);
  for (let i = 0; i < pcm.length; i++) vista.setInt16(i * 2, pcm[i], true);
  return bytes;
}

export function bytesABase64(bytes: Uint8Array): string {
  let binario = '';
  const TROZO = 0x8000;
  for (let i = 0; i < bytes.length; i += TROZO) {
    binario += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + TROZO)));
  }
  return btoa(binario);
}

/**
 * Nivel de voz de un bloque, 0 a 1, en escala de decibeles (-60 dB = 0, -12 dB = 1): es lo que
 * mueve el medidor de cada canal. Lineal, un susurro no movería nada y una voz normal
 * pegaría el medidor al tope.
 */
export function nivelVoz(muestras: Float32Array): number {
  if (!muestras.length) return 0;
  let suma = 0;
  for (let i = 0; i < muestras.length; i++) suma += muestras[i] * muestras[i];
  const rms = Math.sqrt(suma / muestras.length);
  const db = 20 * Math.log10(rms + 1e-9);
  return Math.max(0, Math.min(1, (db + 60) / 48));
}

/** Junta muestras de 16 kHz y devuelve bloques completos de 100 ms listos para enviar. */
export class Bloqueador {
  private pendiente = new Float32Array(0);

  constructor(readonly tamano = MUESTRAS_POR_BLOQUE) {}

  agregar(muestras: Float32Array): string[] {
    const datos = concatenar(this.pendiente, muestras);
    const bloques: string[] = [];
    let i = 0;
    for (; i + this.tamano <= datos.length; i += this.tamano) {
      bloques.push(bytesABase64(pcm16ABytes(aPcm16(datos.subarray(i, i + this.tamano)))));
    }
    this.pendiente = datos.slice(i);
    return bloques;
  }

  /** Muestras que esperan completar bloque. */
  get enEspera(): number { return this.pendiente.length; }

  reiniciar(): void { this.pendiente = new Float32Array(0); }
}

function concatenar(a: Float32Array, b: Float32Array): Float32Array {
  if (!a.length) return b;
  if (!b.length) return a;
  const c = new Float32Array(a.length + b.length);
  c.set(a, 0);
  c.set(b, a.length);
  return c;
}
