import { Evento } from '../models/bot.model';
import {
  detectarPlataforma, esTerminal, esVivo, fusionarEventos, markdownSimple, modoSugerido, nombreDiceBot, ultimoId,
} from './bot';

const ev = (id: number, extra: Partial<Evento> = {}): Evento => ({
  id, tipo: 'TRANSCRIPCION', t_ms: id * 1000, hablante: null, texto: `t${id}`, payload: null,
  archivo: false, mime: null, importante: false, autor: 'BOT', creado_en: '2026-10-23T10:00:00Z', ...extra,
});

describe('bot utils', () => {
  describe('detectarPlataforma', () => {
    it('reconoce las plataformas por el dominio', () => {
      expect(detectarPlataforma('https://meet.google.com/abc-defg-hij')).toBe('MEET');
      expect(detectarPlataforma('meet.google.com/abc-defg-hij')).toBe('MEET');
      expect(detectarPlataforma('https://us02web.zoom.us/j/123?pwd=x')).toBe('ZOOM');
      expect(detectarPlataforma('https://teams.microsoft.com/l/meetup-join/19%3a…')).toBe('TEAMS');
      expect(detectarPlataforma('https://teams.live.com/meet/9381')).toBe('TEAMS');
      expect(detectarPlataforma('https://empresa.webex.com/meet/ana')).toBe('WEBEX');
      expect(detectarPlataforma('https://meet.jit.si/sala')).toBe('JITSI');
      expect(detectarPlataforma('https://call.whatsapp.com/video/abc')).toBe('WHATSAPP');
      expect(detectarPlataforma('https://otra.cosa.com/x')).toBe('OTRA');
    });

    it('no se deja engañar por un subdominio falso ni por texto que no es URL', () => {
      expect(detectarPlataforma('https://meet.google.com.malo.io/x')).toBe('OTRA');
      expect(detectarPlataforma('hola')).toBeNull();
      expect(detectarPlataforma('')).toBeNull();
      expect(detectarPlataforma(null)).toBeNull();
    });

    it('WhatsApp sugiere el modo captura', () => {
      expect(modoSugerido('WHATSAPP')).toBe('CAPTURA');
      expect(modoSugerido('MEET')).toBe('NAVEGADOR');
      expect(modoSugerido(null)).toBe('NAVEGADOR');
    });
  });

  describe('fusionarEventos', () => {
    it('agrega lo nuevo en orden y sin repetir un lote reintentado', () => {
      const a = [ev(1), ev(2)];
      const r = fusionarEventos(a, [ev(3), ev(2), ev(4)]);
      expect(r.map(e => e.id)).toEqual([1, 2, 3, 4]);
      expect(fusionarEventos(r, [ev(3), ev(4)]).length).toBe(4);
    });

    it('un evento que vuelve reemplaza al anterior (p. ej. captura marcada importante)', () => {
      const r = fusionarEventos([ev(5, { tipo: 'CAPTURA' })], [ev(5, { tipo: 'CAPTURA', importante: true })]);
      expect(r.length).toBe(1);
      expect(r[0].importante).toBeTrue();
    });

    it('sin nuevos devuelve la misma referencia (no dispara signals)', () => {
      const a = [ev(1)];
      expect(fusionarEventos(a, [])).toBe(a);
    });

    it('ultimoId es el cursor siguiente', () => {
      expect(ultimoId([ev(3), ev(9), ev(4)])).toBe(9);
      expect(ultimoId([], 7)).toBe(7);
    });
  });

  it('estados terminales y vivos', () => {
    expect(esTerminal('FINALIZADA')).toBeTrue();
    expect(esTerminal('EN_CURSO')).toBeFalse();
    expect(esVivo('SALA_ESPERA')).toBeTrue();
    expect(esVivo('PROGRAMADA')).toBeFalse();
  });

  it('el nombre del bot tiene que decir bot', () => {
    expect(nombreDiceBot('Asistente de Ana (bot)')).toBeTrue();
    expect(nombreDiceBot('Bot TuApo')).toBeTrue();
    expect(nombreDiceBot('Ana Robotina')).toBeFalse();
    expect(nombreDiceBot('')).toBeFalse();
  });

  it('markdownSimple escapa HTML y arma listas', () => {
    const html = markdownSimple('# Título\n- uno **fuerte**\n- <script>x</script>\n\nTexto');
    expect(html).toContain('<h4>Título</h4>');
    expect(html).toContain('<ul><li>uno <strong>fuerte</strong></li>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<p>Texto</p>');
  });
});
