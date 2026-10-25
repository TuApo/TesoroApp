import { Bloqueador, MUESTRAS_POR_BLOQUE, Remuestreador, aMono, aPcm16, bytesABase64, nivelVoz, pcm16ABytes } from './audio-pcm';

function seno(frecuencia: number, tasa: number, muestras: number, amplitud = 0.5): Float32Array {
  const f = new Float32Array(muestras);
  for (let i = 0; i < muestras; i++) f[i] = amplitud * Math.sin((2 * Math.PI * frecuencia * i) / tasa);
  return f;
}

describe('audio-pcm (de WebAudio a PCM16 16 kHz)', () => {
  it('48 kHz → 16 kHz: 4800 muestras dan exactamente 1600', () => {
    const r = new Remuestreador(48_000);
    expect(r.procesar(new Float32Array(4800)).length).toBe(1600);
  });

  it('44,1 kHz → 16 kHz: un segundo da 16000 muestras (±1) aunque llegue en trozos de 128', () => {
    const r = new Remuestreador(44_100);
    let total = 0;
    for (let i = 0; i < 44_100; i += 128) total += r.procesar(new Float32Array(Math.min(128, 44_100 - i))).length;
    expect(Math.abs(total - 16_000)).toBeLessThanOrEqual(1);
  });

  it('partir el audio en trozos da lo mismo que procesarlo de una vez', () => {
    const entrada = seno(440, 48_000, 9600);
    const deUna = new Remuestreador(48_000).procesar(entrada);
    const r = new Remuestreador(48_000);
    const partes: number[] = [];
    for (let i = 0; i < entrada.length; i += 333) partes.push(...r.procesar(entrada.subarray(i, i + 333)));
    expect(partes.length).toBe(deUna.length);
    for (let i = 0; i < deUna.length; i++) expect(partes[i]).toBeCloseTo(deUna[i], 6);
  });

  it('conserva la voz (300 Hz) casi sin perder amplitud', () => {
    const salida = new Remuestreador(48_000).procesar(seno(300, 48_000, 48_000, 0.5));
    const pico = salida.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(pico).toBeGreaterThan(0.48);
    expect(pico).toBeLessThanOrEqual(0.5);
  });

  it('a la misma tasa no toca nada', () => {
    const e = seno(200, 16_000, 100);
    expect(Array.from(new Remuestreador(16_000).procesar(e))).toEqual(Array.from(e));
  });

  it('mezcla estéreo a mono', () => {
    expect(Array.from(aMono([[1, 0, -1], [0, 0, 1]]))).toEqual([0.5, 0, 0]);
    expect(aMono([]).length).toBe(0);
  });

  it('PCM16 con recorte y en little-endian', () => {
    const pcm = aPcm16(new Float32Array([0, 1, -1, 2, -2, 0.5]));
    expect(Array.from(pcm)).toEqual([0, 32767, -32768, 32767, -32768, 16384]);
    const bytes = pcm16ABytes(new Int16Array([0x0102, -2]));
    expect(Array.from(bytes)).toEqual([0x02, 0x01, 0xfe, 0xff]);
    expect(bytesABase64(new Uint8Array([104, 111, 108, 97]))).toBe('aG9sYQ==');
  });

  it('bloques de 100 ms (3200 bytes) y guarda el sobrante', () => {
    const b = new Bloqueador();
    expect(b.agregar(new Float32Array(1000)).length).toBe(0);
    expect(b.enEspera).toBe(1000);
    const bloques = b.agregar(new Float32Array(2400));
    expect(bloques.length).toBe(2);
    expect(b.enEspera).toBe(3400 - 2 * MUESTRAS_POR_BLOQUE);
    expect(atob(bloques[0]).length).toBe(3200);
  });

  it('nivel de voz: silencio 0, voz normal a media escala, saturado 1', () => {
    expect(nivelVoz(new Float32Array(512))).toBe(0);
    const medio = nivelVoz(seno(300, 16_000, 1600, 0.05));
    expect(medio).toBeGreaterThan(0.3);
    expect(medio).toBeLessThan(0.9);
    expect(nivelVoz(seno(300, 16_000, 1600, 1))).toBe(1);
  });
});
