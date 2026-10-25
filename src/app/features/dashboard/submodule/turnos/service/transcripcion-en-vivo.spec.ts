import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';

import {
  CapturaCanal, ClienteStt, EstadoCanal, GuardadoPorLotes, LineaEnVivo, SESION_ESTABLE_MS, SocketStt, TranscripcionEnVivo, URL_WORKLET_CAPTURA,
  armarUrlStt, errorDeToken, esRechazoDefinitivo, esperaReconexion, interpretarMensajeStt, nuevoClienteId, unirLineas, urlWorkletCaptura,
} from './transcripcion-en-vivo';
import { LineaTranscripcionIn, TokenTranscripcion, TurnosService } from './turnos.service';

/** WebSocket falso: se abre, recibe y se cae cuando la prueba lo dice. */
class SocketFalso implements SocketStt {
  static creados: SocketFalso[] = [];
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  enviados: Record<string, unknown>[] = [];
  constructor(readonly url: string) { SocketFalso.creados.push(this); }
  send(d: string): void { this.enviados.push(JSON.parse(d)); }
  close(code = 1000, reason = ''): void { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.({ code, reason }); }
  abrir(): void { this.readyState = 1; this.onopen?.({}); }
  llega(m: Record<string, unknown>): void { this.onmessage?.({ data: JSON.stringify(m) }); }
  caer(code = 1006): void { this.readyState = 3; this.onclose?.({ code, reason: '' }); }
}

const TOKEN = (n = 1): TokenTranscripcion => ({ token: `sutkn_${n}`, url: 'wss://api.elevenlabs.io/v1/speech-to-text/realtime', modelo: 'scribe_v2_realtime', idioma: 'es', sample_rate: 16000 });

function clienteDePrueba(opciones: Partial<{ pedirToken: () => Promise<TokenTranscripcion>; maxIntentos: number }> = {}) {
  const parciales: string[] = [];
  const confirmadas: string[] = [];
  const estados: { estado: EstadoCanal; detalle: string | null }[] = [];
  let n = 0;
  const pedirToken = jasmine.createSpy('pedirToken').and.callFake(opciones.pedirToken ?? (() => Promise.resolve(TOKEN(++n))));
  const c = new ClienteStt({
    hablante: 'PERSONA', pedirToken, crearSocket: url => new SocketFalso(url), maxIntentos: opciones.maxIntentos,
    alParcial: t => parciales.push(t), alConfirmada: t => confirmadas.push(t), alEstado: (estado, detalle) => estados.push({ estado, detalle }),
  });
  return { c, parciales, confirmadas, estados, pedirToken, ultimo: () => SocketFalso.creados[SocketFalso.creados.length - 1] };
}

describe('Transcripción en vivo · funciones puras', () => {
  it('arma la URL del STT completando lo que el backend no mande', () => {
    const u = new URL(armarUrlStt(TOKEN()));
    expect(u.origin + u.pathname).toBe('wss://api.elevenlabs.io/v1/speech-to-text/realtime');
    expect(u.searchParams.get('token')).toBe('sutkn_1');
    expect(u.searchParams.get('model_id')).toBe('scribe_v2_realtime');
    expect(u.searchParams.get('language_code')).toBe('es');
    expect(u.searchParams.get('audio_format')).toBe('pcm_16000');
    expect(u.searchParams.get('commit_strategy')).toBe('vad');
    // Si la URL ya trae parámetros (p. ej. un proxy propio), se respetan.
    const u2 = new URL(armarUrlStt({ ...TOKEN(), url: 'wss://proxy.tuapo.co/stt?token=otro&commit_strategy=manual' }));
    expect(u2.searchParams.get('token')).toBe('otro');
    expect(u2.searchParams.get('commit_strategy')).toBe('manual');
    expect(armarUrlStt({ ...TOKEN(), url: '' })).toContain('api.elevenlabs.io');
  });

  it('interpreta parciales, confirmadas, sesión y errores legibles', () => {
    expect(interpretarMensajeStt('{"message_type":"session_started","config":{}}')).toEqual({ tipo: 'sesion' });
    expect(interpretarMensajeStt({ message_type: 'partial_transcript', text: 'hola' })).toEqual({ tipo: 'parcial', texto: 'hola' });
    expect(interpretarMensajeStt({ message_type: 'committed_transcript', text: 'Hola.' })).toEqual({ tipo: 'confirmada', texto: 'Hola.', conMarcas: false });
    expect(interpretarMensajeStt({ message_type: 'committed_transcript_with_timestamps', text: 'Hola.' })).toEqual({ tipo: 'confirmada', texto: 'Hola.', conMarcas: true });
    const cuota = interpretarMensajeStt({ message_type: 'quota_exceeded', error: 'x' });
    expect(cuota).toEqual(jasmine.objectContaining({ tipo: 'error', fatal: true, reconectar: false }));
    expect((cuota as { mensaje: string }).mensaje).toContain('saldo');
    const raro = interpretarMensajeStt({ message_type: 'some_new_error', message: 'algo pasó' });
    expect(raro).toEqual(jasmine.objectContaining({ tipo: 'error', fatal: false }));
    expect((raro as { mensaje: string }).mensaje).toContain('algo pasó');
    expect(interpretarMensajeStt('no es json')).toEqual({ tipo: 'otro' });
    expect(interpretarMensajeStt({ message_type: 'commit_throttled' })).toEqual({ tipo: 'otro' });
  });

  it('errores del token: 503/429/403 son definitivos y traen el texto del servidor', () => {
    expect(errorDeToken(new HttpErrorResponse({ status: 503, error: { error: 'La transcripción en vivo no está configurada' } })))
      .toEqual({ mensaje: 'La transcripción en vivo no está configurada', fatal: true });
    expect(errorDeToken(new HttpErrorResponse({ status: 429, error: null })).fatal).toBeTrue();
    expect(errorDeToken(new HttpErrorResponse({ status: 403, error: null })).mensaje).toContain('Solo quien atiende');
    expect(errorDeToken(new HttpErrorResponse({ status: 0 })).fatal).toBeFalse();
    expect(errorDeToken(new HttpErrorResponse({ status: 500 })).fatal).toBeFalse();
  });

  it('espera creciente entre reintentos, con tope de 15 s', () => {
    expect([1, 2, 3, 4, 5, 6, 9].map(esperaReconexion)).toEqual([1000, 2000, 4000, 8000, 15000, 15000, 15000]);
  });

  it('cliente_id es un uuid v4 distinto cada vez', () => {
    const a = nuevoClienteId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(nuevoClienteId()).not.toBe(a);
  });

  it('une lo guardado con lo local sin duplicar (por cliente_id o, si el servidor no lo devuelve, por texto y segundo)', () => {
    const local: LineaEnVivo[] = [
      { cliente_id: 'c1', id: null, hablante: 'ASESOR', texto: 'Buenos días', inicio_ms: 1000, fin_ms: 2000, guardada: false },
      { cliente_id: 'c2', id: null, hablante: 'PERSONA', texto: 'Hola, ¿cómo está?', inicio_ms: 3000, fin_ms: 4000, guardada: false },
      { cliente_id: 'c3', id: null, hablante: 'PERSONA', texto: 'Nueva', inicio_ms: 9000, fin_ms: 9500, guardada: false },
    ];
    const r = unirLineas(local, [
      { id: 1, hablante: 'ASESOR', texto: 'Buenos días', inicio_ms: 1000, fin_ms: 2000, cliente_id: 'c1' },
      { id: 2, hablante: 'PERSONA', texto: 'hola como esta', inicio_ms: 3200, fin_ms: 4000 },
      { id: 3, hablante: 'ASESOR', texto: 'Anterior', inicio_ms: 500, fin_ms: 900 },
    ]);
    expect(r.map(l => l.texto)).toEqual(['Anterior', 'Buenos días', 'hola como esta', 'Nueva']);
    expect(r.find(l => l.texto === 'Buenos días')!.guardada).toBeTrue();
    expect(r.find(l => l.texto === 'Nueva')!.guardada).toBeFalse();
  });
});

describe('Transcripción en vivo · GET con cliente_id', () => {
  it('si el servidor devuelve cliente_id, se deduplica por él aunque el texto o el segundo no coincidan', () => {
    const local: LineaEnVivo[] = [
      { cliente_id: 'c9', id: null, hablante: 'PERSONA', texto: 'me cambié a Bancolombia ', inicio_ms: 83_400, fin_ms: 85_000, guardada: false },
    ];
    // El servidor guardó el texto recortado y otra sesión corrió la línea de tiempo: sin cliente_id serían dos frases.
    const r = unirLineas(local, [{ id: 7, hablante: 'PERSONA', texto: 'Me cambié a Bancolombia.', inicio_ms: 91_000, fin_ms: 92_000, cliente_id: 'c9' }]);
    expect(r.length).toBe(1);
    expect(r[0].id).toBe(7);
    expect(r[0].guardada).toBeTrue();
  });
});

describe('ClienteStt (WebSocket falso)', () => {
  beforeEach(() => { SocketFalso.creados = []; });

  it('parciales que se reemplazan y una sola confirmada por frase', fakeAsync(() => {
    const p = clienteDePrueba();
    void p.c.conectar();
    flushMicrotasks();
    const s = p.ultimo();
    expect(s.url).toContain('token=sutkn_1');
    s.abrir();
    s.llega({ message_type: 'session_started' });
    expect(p.c.estado).toBe('transcribiendo');
    s.llega({ message_type: 'partial_transcript', text: 'me cambié' });
    s.llega({ message_type: 'partial_transcript', text: 'me cambié a Bancolombia' });
    s.llega({ message_type: 'committed_transcript', text: 'Me cambié a Bancolombia.' });
    s.llega({ message_type: 'committed_transcript_with_timestamps', text: 'Me cambié a Bancolombia.' });
    s.llega({ message_type: 'committed_transcript', text: '   ' });
    expect(p.parciales).toEqual(['me cambié', 'me cambié a Bancolombia', '', '', '']);
    expect(p.confirmadas).toEqual(['Me cambié a Bancolombia.']);
    p.c.cerrar();
  }));

  it('manda el audio como pide el proveedor y guarda lo que llega mientras conecta', fakeAsync(() => {
    const p = clienteDePrueba();
    void p.c.conectar();
    p.c.enviarAudio('AAAA');
    flushMicrotasks();
    const s = p.ultimo();
    p.c.enviarAudio('BBBB');
    expect(s.enviados.length).toBe(0);
    s.abrir();
    expect(s.enviados).toEqual([
      { message_type: 'input_audio_chunk', audio_base_64: 'AAAA', commit: false, sample_rate: 16000 },
      { message_type: 'input_audio_chunk', audio_base_64: 'BBBB', commit: false, sample_rate: 16000 },
    ]);
    p.c.enviarAudio('CCCC');
    expect(s.enviados.length).toBe(3);
    p.c.confirmarFrase();
    expect(s.enviados[3]).toEqual({ message_type: 'input_audio_chunk', audio_base_64: '', commit: true, sample_rate: 16000 });
    p.c.cerrar();
  }));

  it('si el socket se cae: la frase a medias se confirma una vez y se reconecta con token nuevo sin duplicar', fakeAsync(() => {
    const p = clienteDePrueba();
    void p.c.conectar();
    flushMicrotasks();
    const s1 = p.ultimo();
    s1.abrir();
    s1.llega({ message_type: 'session_started' });
    s1.llega({ message_type: 'committed_transcript', text: 'Primera frase.' });
    s1.llega({ message_type: 'partial_transcript', text: 'y la segunda iba' });
    s1.caer(1006);
    expect(p.confirmadas).toEqual(['Primera frase.', 'y la segunda iba']);
    expect(p.c.estado).toBe('reconectando');
    tick(999);
    expect(p.pedirToken).toHaveBeenCalledTimes(1);
    tick(1);
    flushMicrotasks();
    expect(p.pedirToken).toHaveBeenCalledTimes(2);
    const s2 = p.ultimo();
    expect(s2).not.toBe(s1);
    expect(s2.url).toContain('token=sutkn_2');
    s2.abrir();
    s2.llega({ message_type: 'session_started' });
    s2.llega({ message_type: 'committed_transcript', text: 'Tercera.' });
    expect(p.confirmadas).toEqual(['Primera frase.', 'y la segunda iba', 'Tercera.']);
    expect(p.c.estado).toBe('transcribiendo');
    p.c.cerrar();
  }));

  it('un error recuperable (rate_limited) cierra y reconecta; uno definitivo (quota_exceeded) no', fakeAsync(() => {
    const p = clienteDePrueba();
    void p.c.conectar();
    flushMicrotasks();
    const s1 = p.ultimo();
    s1.abrir();
    s1.llega({ message_type: 'rate_limited' });
    expect(s1.readyState).toBe(3);
    tick(1000);
    flushMicrotasks();
    const s2 = p.ultimo();
    expect(s2).not.toBe(s1);
    s2.abrir();
    s2.llega({ message_type: 'quota_exceeded', error: 'Quota exceeded' });
    expect(p.c.estado).toBe('error');
    expect(p.estados[p.estados.length - 1].detalle).toContain('saldo');
    tick(60_000);
    flushMicrotasks();
    expect(SocketFalso.creados.length).toBe(2);
  }));

  it('token 503: error definitivo con el mensaje del servidor, sin reintentar', fakeAsync(() => {
    const p = clienteDePrueba({ pedirToken: () => Promise.reject(new HttpErrorResponse({ status: 503, error: { error: 'La transcripción en vivo no está configurada' } })) });
    void p.c.conectar();
    flushMicrotasks();
    expect(p.c.estado).toBe('error');
    expect(p.estados[p.estados.length - 1].detalle).toBe('La transcripción en vivo no está configurada');
    tick(60_000);
    expect(p.pedirToken).toHaveBeenCalledTimes(1);
    expect(SocketFalso.creados.length).toBe(0);
  }));

  it('se rinde tras varios intentos sin llegar a abrir', fakeAsync(() => {
    const p = clienteDePrueba({ maxIntentos: 2 });
    void p.c.conectar();
    flushMicrotasks();
    p.ultimo().caer();
    tick(1000); flushMicrotasks();
    p.ultimo().caer();
    tick(2000); flushMicrotasks();
    p.ultimo().caer();
    expect(p.c.estado).toBe('error');
    expect(p.estados[p.estados.length - 1].detalle).toContain('2 veces');
    tick(60_000); flushMicrotasks();
    expect(SocketFalso.creados.length).toBe(3);
  }));

  it('cerrar a propósito confirma la parcial, avisa el fin de frase y no reconecta', fakeAsync(() => {
    const p = clienteDePrueba();
    void p.c.conectar();
    flushMicrotasks();
    const s = p.ultimo();
    s.abrir();
    s.llega({ message_type: 'partial_transcript', text: 'hasta luego' });
    p.c.cerrar('pausado');
    expect(p.confirmadas).toEqual(['hasta luego']);
    expect(s.enviados[s.enviados.length - 1]).toEqual(jasmine.objectContaining({ commit: true }));
    expect(p.c.estado).toBe('pausado');
    tick(60_000); flushMicrotasks();
    expect(SocketFalso.creados.length).toBe(1);
  }));
});

describe('ClienteStt · no gastar tokens en bucle', () => {
  beforeEach(() => { SocketFalso.creados = []; });

  it('un servicio que acepta y corta enseguida NO reinicia la cuenta: se rinde en vez de reconectar cada segundo', fakeAsync(() => {
    const p = clienteDePrueba({ maxIntentos: 3 });
    void p.c.conectar();
    flushMicrotasks();
    const esperas = [1000, 2000, 4000];
    for (let i = 0; i <= esperas.length; i++) {
      const s = p.ultimo();
      s.abrir();
      s.llega({ message_type: 'session_started' });
      s.caer(1006);
      if (i < esperas.length) { tick(esperas[i]); flushMicrotasks(); }
    }
    expect(p.c.estado).toBe('error');
    tick(120_000); flushMicrotasks();
    // 1 conexión + 3 reintentos: 4 tokens y ya. Antes, cada session_started ponía el contador en 0.
    expect(p.pedirToken).toHaveBeenCalledTimes(4);
    expect(SocketFalso.creados.length).toBe(4);
  }));

  it('una sesión que sí duró reinicia la espera: la reconexión sale al segundo', fakeAsync(() => {
    const p = clienteDePrueba({ maxIntentos: 3 });
    void p.c.conectar();
    flushMicrotasks();
    p.ultimo().caer(1006);              // primer fallo: intento 1
    tick(1000); flushMicrotasks();
    const s = p.ultimo();
    s.abrir();
    s.llega({ message_type: 'session_started' });
    tick(SESION_ESTABLE_MS);
    s.caer(1006);                       // tras una sesión sana: vuelve a 1 s, no a 2 s
    tick(999); flushMicrotasks();
    expect(p.pedirToken).toHaveBeenCalledTimes(2);
    tick(1); flushMicrotasks();
    expect(p.pedirToken).toHaveBeenCalledTimes(3);
    p.c.cerrar();
  }));

  it('silencio largo (insufficient_audio_activity): se duerme sin reconectar y despierta con la voz, sin perder lo que se dijo', fakeAsync(() => {
    const p = clienteDePrueba();
    void p.c.conectar();
    flushMicrotasks();
    const s1 = p.ultimo();
    s1.abrir();
    s1.llega({ message_type: 'session_started' });
    s1.llega({ message_type: 'insufficient_audio_activity', error: 'No audio' });
    expect(s1.readyState).toBe(3);
    expect(p.c.dormida).toBeTrue();
    expect(p.c.estado).toBe('transcribiendo');
    tick(10 * 60_000); flushMicrotasks();
    expect(p.pedirToken).toHaveBeenCalledTimes(1);   // diez minutos callados: cero tokens
    p.c.despertar();                                 // alguien habla
    p.c.enviarAudio('VOZ1');
    flushMicrotasks();
    expect(p.pedirToken).toHaveBeenCalledTimes(2);
    const s2 = p.ultimo();
    expect(s2).not.toBe(s1);
    s2.abrir();
    expect(s2.enviados.map(e => e['audio_base_64'])).toEqual(['VOZ1']);
    p.c.despertar();                                 // ya despierto: no pide otro
    flushMicrotasks();
    expect(p.pedirToken).toHaveBeenCalledTimes(2);
    p.c.cerrar();
  }));
});

describe('GuardadoPorLotes', () => {
  const linea = (id: string, texto = 'x'): LineaTranscripcionIn => ({ cliente_id: id, hablante: 'ASESOR', texto, inicio_ms: 0, fin_ms: 1 });

  it('junta lo que llega y lo manda en un lote; repetir un cliente_id no duplica', fakeAsync(() => {
    const lotes: LineaTranscripcionIn[][] = [];
    const g = new GuardadoPorLotes({ enviar: l => { lotes.push(l); return Promise.resolve(); }, esperaMs: 2500 });
    g.agregar(linea('a')); g.agregar(linea('b')); g.agregar(linea('a'));
    tick(2499);
    expect(lotes.length).toBe(0);
    tick(1); flushMicrotasks();
    expect(lotes.length).toBe(1);
    expect(lotes[0].map(l => l.cliente_id)).toEqual(['a', 'b']);
    expect(g.pendientes).toBe(0);
  }));

  it('lote lleno sale enseguida (máx. 50) y recorta textos a 2000', fakeAsync(() => {
    const lotes: LineaTranscripcionIn[][] = [];
    const g = new GuardadoPorLotes({ enviar: l => { lotes.push(l); return Promise.resolve(); }, tamano: 2 });
    g.agregar(linea('a', 'y'.repeat(2500))); g.agregar(linea('b'));
    tick(0); flushMicrotasks();
    expect(lotes.length).toBe(1);
    expect(lotes[0][0].texto.length).toBe(2000);
  }));

  it('si falla, reintenta el MISMO lote (mismos cliente_id) con espera creciente y avisa', fakeAsync(() => {
    const lotes: string[][] = [];
    let falla = 2;
    const errores: (string | null)[] = [];
    const guardadas: string[][] = [];
    const g = new GuardadoPorLotes({
      enviar: l => { lotes.push(l.map(x => x.cliente_id)); return falla-- > 0 ? Promise.reject(new Error('red')) : Promise.resolve(); },
      alError: m => errores.push(m), alGuardar: ids => guardadas.push(ids), esperaMs: 100,
    });
    g.agregar(linea('a')); g.agregar(linea('b'));
    tick(100); flushMicrotasks();
    expect(lotes).toEqual([['a', 'b']]);
    expect(errores[0]).toContain('2 frase');
    tick(2000); flushMicrotasks();
    expect(lotes.length).toBe(2);
    g.agregar(linea('c'));
    tick(4000); flushMicrotasks();
    expect(lotes[2]).toEqual(['a', 'b', 'c']);
    expect(guardadas).toEqual([['a', 'b', 'c']]);
    expect(errores[errores.length - 1]).toBeNull();
  }));

  it('un rechazo definitivo (409/403/400) no se reintenta en bucle: se avisa y se sigue con lo nuevo', fakeAsync(() => {
    const lotes: string[][] = [];
    const errores: (string | null)[] = [];
    const descartadas: string[][] = [];
    let respuesta: () => Promise<unknown> = () => Promise.reject(new HttpErrorResponse({ status: 409, error: { error: 'El turno C-007 ya está atendido' } }));
    const g = new GuardadoPorLotes({
      enviar: l => { lotes.push(l.map(x => x.cliente_id)); return respuesta(); },
      alError: m => errores.push(m), alDescartar: ids => descartadas.push(ids), esperaMs: 100,
    });
    g.agregar(linea('a')); g.agregar(linea('b'));
    tick(100); flushMicrotasks();
    expect(descartadas).toEqual([['a', 'b']]);
    expect(errores[errores.length - 1]).toContain('El turno C-007 ya está atendido');
    tick(120_000); flushMicrotasks();
    expect(lotes.length).toBe(1);                 // nada de reintentos
    respuesta = () => Promise.resolve();
    g.agregar(linea('c'));
    tick(100); flushMicrotasks();
    expect(lotes[1]).toEqual(['c']);
    expect(esRechazoDefinitivo(new HttpErrorResponse({ status: 403 }))).toBeTrue();
    expect(esRechazoDefinitivo(new HttpErrorResponse({ status: 503 }))).toBeFalse();
    expect(esRechazoDefinitivo(new HttpErrorResponse({ status: 0 }))).toBeFalse();
    expect(esRechazoDefinitivo(new HttpErrorResponse({ status: 401 }))).toBeFalse();
  }));

  it('terminar() (al colgar) no pierde lo pendiente si justo falla la red: reintenta y luego se apaga', fakeAsync(() => {
    const lotes: string[][] = [];
    let falla = 2;
    const g = new GuardadoPorLotes({
      enviar: l => { lotes.push(l.map(x => x.cliente_id)); return falla-- > 0 ? Promise.reject(new HttpErrorResponse({ status: 0 })) : Promise.resolve(); },
      esperaMs: 60_000,
    });
    g.agregar(linea('a')); g.agregar(linea('b'));
    let listo = false;
    void g.terminar().then(() => (listo = true));
    flushMicrotasks();
    expect(lotes.length).toBe(1);
    tick(1000); flushMicrotasks();
    expect(lotes.length).toBe(2);
    tick(2000); flushMicrotasks();
    expect(lotes.length).toBe(3);
    expect(g.pendientes).toBe(0);
    expect(listo).toBeTrue();
    g.agregar(linea('z'));                       // ya apagado: no acepta más
    tick(120_000); flushMicrotasks();
    expect(lotes.length).toBe(3);
  }));

  it('terminar() se rinde al vencer el plazo (no reintenta para siempre)', fakeAsync(() => {
    let envios = 0;
    const g = new GuardadoPorLotes({ enviar: () => { envios++; return Promise.reject(new HttpErrorResponse({ status: 502 })); }, esperaMs: 60_000 });
    g.agregar(linea('a'));
    let listo = false;
    void g.terminar(5_000).then(() => (listo = true));
    tick(10_000); flushMicrotasks();
    expect(listo).toBeTrue();
    const hechos = envios;
    tick(300_000); flushMicrotasks();
    expect(envios).toBe(hechos);
    expect(hechos).toBeLessThanOrEqual(4);
  }));

  it('vaciar() manda ya lo pendiente', async () => {
    const lotes: LineaTranscripcionIn[][] = [];
    const g = new GuardadoPorLotes({ enviar: l => { lotes.push(l); return Promise.resolve(); }, esperaMs: 60_000 });
    g.agregar(linea('a'));
    await g.vaciar();
    expect(lotes.length).toBe(1);
    g.detener();
  });
});

describe('TranscripcionEnVivo (servicio) y rutas del contrato', () => {
  let http: HttpTestingController;
  let api: TurnosService;
  const BASE = 'https://api.tuapo.co/api/v1/turnos';

  beforeEach(() => {
    SocketFalso.creados = [];
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), TranscripcionEnVivo] });
    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(TurnosService);
    try { sessionStorage.removeItem('tuapo.turnos.transcripcion.t0.T1'); } catch { /* sin storage */ }
  });

  afterEach(() => http.verify({ ignoreCancelled: true }));

  it('TurnosService usa las rutas y cuerpos del contrato', () => {
    api.tokenTranscripcion('T1').subscribe();
    const t = http.expectOne(`${BASE}/remoto/T1/transcripcion/token`);
    expect(t.request.method).toBe('POST');
    t.flush(TOKEN());
    api.guardarLineasTranscripcion('T1', [{ cliente_id: 'c', hablante: 'PERSONA', texto: 'hola', inicio_ms: 1, fin_ms: 2 }]).subscribe();
    const l = http.expectOne(`${BASE}/remoto/T1/transcripcion/lineas`);
    expect(l.request.body).toEqual({ lineas: [{ cliente_id: 'c', hablante: 'PERSONA', texto: 'hola', inicio_ms: 1, fin_ms: 2 }] });
    l.flush({ guardadas: 1 });
    api.transcripcionDeTurno('T1').subscribe();
    const g = http.expectOne(`${BASE}/remoto/T1/transcripcion`);
    expect(g.request.method).toBe('GET');
    g.flush({ lineas: [], analisis: null });
    api.temasDeConversacion('T1', { nombre: 'Ana' }).subscribe();
    const m = http.expectOne(`${BASE}/remoto/T1/temas`);
    expect(m.request.body).toEqual({ ficha: { nombre: 'Ana' } });
    m.flush({ resumen: null, temas: [], actualizado_en: null });
  });

  it('cargar() trae lo guardado del turno y lo deja en orden', async () => {
    const s = TestBed.inject(TranscripcionEnVivo);
    const p = s.cargar('T1');
    http.expectOne(`${BASE}/remoto/T1/transcripcion`).flush({
      lineas: [
        { id: 2, hablante: 'PERSONA', texto: 'Hola', inicio_ms: 4000, fin_ms: 5000 },
        { id: 1, hablante: 'ASESOR', texto: 'Buenas', inicio_ms: 1000, fin_ms: 2000 },
      ],
      analisis: { resumen: 'Saludo', temas: [], actualizado_en: '2026-09-27T10:00:00Z' },
    });
    const r = await p;
    expect(r?.analisis?.resumen).toBe('Saludo');
    expect(s.lineas().map(l => l.texto)).toEqual(['Buenas', 'Hola']);
    // La línea de tiempo sigue después de lo guardado.
    expect(s.ahoraMs()).toBeGreaterThanOrEqual(5000);
  });

  it('dos canales, cada uno con su hablante: pide un token por canal, arma las líneas y las guarda', async () => {
    const s = TestBed.inject(TranscripcionEnVivo);
    s.crearSocket = url => new SocketFalso(url);
    const ctxPrueba = new AudioContext();
    const pista = () => ctxPrueba.createMediaStreamDestination().stream;
    const inicio = s.iniciar('T1', pista(), pista());
    await inicio;
    // Un token por canal (match() consume las peticiones: se van juntando).
    const tokens: TestRequest[] = [];
    await esperar(() => { tokens.push(...http.match(`${BASE}/remoto/T1/transcripcion/token`)); return tokens.length >= 2; }, 5000);
    expect(tokens.length).toBe(2);
    for (const r of tokens) r.flush(TOKEN());
    await esperar(() => SocketFalso.creados.length === 2, 3000);
    const [a, b] = SocketFalso.creados;
    a.abrir(); b.abrir();
    a.llega({ message_type: 'session_started' }); b.llega({ message_type: 'session_started' });
    expect(s.estado()).toBe('transcribiendo');
    // No se sabe qué socket nació primero: cada uno se identifica por lo que confirma.
    a.llega({ message_type: 'partial_transcript', text: 'Buenos' });
    expect(Object.values(s.parciales()).filter(Boolean).length).toBe(1);
    a.llega({ message_type: 'committed_transcript', text: 'Buenos días.' });
    b.llega({ message_type: 'committed_transcript', text: 'Hola, buenos días.' });
    const hablantes = s.lineas().map(l => l.hablante).sort();
    expect(hablantes).toEqual(['ASESOR', 'PERSONA']);
    expect(s.lineas().every(l => !!l.cliente_id && l.fin_ms !== null)).toBeTrue();
    const vaciado = s.vaciarGuardado();
    const lote = http.expectOne(`${BASE}/remoto/T1/transcripcion/lineas`);
    expect(lote.request.body.lineas.length).toBe(2);
    expect(lote.request.body.lineas.map((l: LineaTranscripcionIn) => l.texto).sort()).toEqual(['Buenos días.', 'Hola, buenos días.']);
    lote.flush({ guardadas: 2 });
    await vaciado;
    expect(s.lineas().every(l => l.guardada)).toBeTrue();
    // Pausar cierra los dos sockets; detener libera todo.
    s.pausar();
    expect(s.estado()).toBe('pausada');
    expect(a.readyState).toBe(3);
    expect(b.readyState).toBe(3);
    await s.detener();
    expect(s.estado()).toBe('apagada');
    await ctxPrueba.close();
  });
});

describe('Captura de audio · worklet estático del propio origen', () => {
  it('la URL del worklet es un archivo del mismo origen (lo cubre script-src \'self\'), no un blob:', () => {
    const u = new URL(urlWorkletCaptura());
    expect(u.origin).toBe(location.origin);
    expect(u.protocol).not.toBe('blob:');
    expect(URL_WORKLET_CAPTURA).toMatch(/^audio\/captura-pcm-worklet\.js\?v=\d+$/);
  });

  it('con el archivo servido, la captura usa el AudioWorklet (no el ScriptProcessor)', async () => {
    // El builder de pruebas sirve public/**: se busca dónde quedó el archivo.
    const candidatos = [urlWorkletCaptura(), new URL('/' + URL_WORKLET_CAPTURA, location.origin).href, new URL('/base/' + URL_WORKLET_CAPTURA, location.origin).href];
    let url: string | null = null;
    for (const c of candidatos) {
      try {
        const r = await fetch(c);
        if (r.ok && (await r.text()).includes("registerProcessor('captura-pcm-tuapo'")) { url = c; break; }
      } catch { /* siguiente */ }
    }
    if (!url) { pending('El servidor de pruebas no sirve public/audio: se verifica en el build y el harness'); return; }
    const ctx = new AudioContext();
    try {
      const osc = ctx.createOscillator();
      const destino = ctx.createMediaStreamDestination();
      osc.connect(destino);
      osc.start();
      const bloques: string[] = [];
      const captura = new CapturaCanal(ctx, destino.stream, b => bloques.push(b), () => {}, url);
      expect(await captura.iniciar()).toBe('worklet');
      if (ctx.state === 'running') {
        await esperar(() => bloques.length > 0, 3000);
        // 100 ms de PCM16 a 16 kHz = 3200 bytes → 4268 caracteres en base64.
        expect(atob(bloques[0]).length).toBe(3200);
      }
      captura.detener();
      osc.stop();
    } finally {
      await ctx.close();
    }
  });
});

describe('TranscripcionEnVivo · recursos', () => {
  let http: HttpTestingController;
  const BASE = 'https://api.tuapo.co/api/v1/turnos';

  beforeEach(() => {
    SocketFalso.creados = [];
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), TranscripcionEnVivo] });
    http = TestBed.inject(HttpTestingController);
  });

  it('si se pausa mientras carga el audio, esa apertura no pide tokens, no abre sockets ni marca error', async () => {
    const s = TestBed.inject(TranscripcionEnVivo);
    s.crearSocket = url => new SocketFalso(url);
    const ctxPrueba = new AudioContext();
    const pista = () => ctxPrueba.createMediaStreamDestination().stream;
    await s.iniciar('T1', pista(), pista());   // los dos canales quedan cargando el worklet
    s.pausar();
    await new Promise(r => setTimeout(r, 600));
    expect(http.match(`${BASE}/remoto/T1/transcripcion/token`).length).toBe(0);
    expect(SocketFalso.creados.length).toBe(0);
    expect(Object.values(s.canales()).map(c => c.estado)).not.toContain('error');
    expect(s.estado()).toBe('pausada');
    await s.detener();
    await ctxPrueba.close();
  });
});

async function esperar(cond: () => boolean, ms: number): Promise<void> {
  const fin = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fin) throw new Error('Tiempo agotado esperando la condición');
    await new Promise(r => setTimeout(r, 20));
  }
}
