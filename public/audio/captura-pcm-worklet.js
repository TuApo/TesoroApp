/*
 * Procesador de AudioWorklet de la transcripción en vivo (Atención remota de Turnos).
 *
 * Vive como archivo estático del propio origen —y no como un blob: armado en tiempo de
 * ejecución— para que lo cubra `script-src 'self'` de la CSP sin abrirla. Lo carga
 * `service/transcripcion-en-vivo.ts` (CapturaCanal); si no puede, la captura cae al
 * ScriptProcessor.
 *
 * Junta los bloques de 128 muestras que entrega WebAudio, mezcla a mono y manda trozos de
 * 2048 muestras al hilo principal (allí se baja a 16 kHz y se parte en bloques de 100 ms).
 * El mensaje 'fin' lo apaga: devolver false deja que el navegador lo libere aunque el
 * contexto de audio siga abierto (pausar y reanudar crean nodos nuevos).
 *
 * Quien lo carga le añade `?v=N` (URL_WORKLET_CAPTURA): nginx cachea los .js un año, así que
 * un cambio aquí exige subir ese número.
 */
class CapturaPcmTuapo extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(2048);
    this.n = 0;
    this.vivo = true;
    this.port.onmessage = (ev) => { if (ev.data === 'fin') this.vivo = false; };
  }

  process(inputs) {
    if (!this.vivo) return false;
    const entrada = inputs[0];
    if (entrada && entrada.length) {
      const canales = entrada.length;
      const largo = entrada[0].length;
      for (let i = 0; i < largo; i++) {
        let s = 0;
        for (let c = 0; c < canales; c++) s += entrada[c][i];
        this.buf[this.n++] = s / canales;
        if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
      }
    }
    return true;
  }
}

registerProcessor('captura-pcm-tuapo', CapturaPcmTuapo);
