import {
  componerCorreoGmail,
  escapar,
  fechaCabecera,
  fechaDetalle,
  listaCorreos,
  sanearCuerpo,
  tituloAdjuntos,
} from './correo-gmail';
import { nombreAdjunto } from './correos-empresas.component';

// 2026-09-08T19:00:00-05:00 (hora de Bogota) = 2026-09-09T00:00:00Z.
const ENVIO = new Date('2026-09-09T00:00:00Z');

describe('vista del correo como llega al buzon', () => {
  it('fechas en la hora de Bogota, con el formato del buzon', () => {
    expect(fechaCabecera(ENVIO)).toBe('mar, 8 sept 2026, 19:00');
    expect(fechaDetalle(ENVIO)).toBe('8 sept 2026, 19:00');
  });

  it('separa destinatarios y copias venga como texto o como lista', () => {
    expect(listaCorreos('a@x.co, b@y.co;c@z.co')).toEqual(['a@x.co', 'b@y.co', 'c@z.co']);
    expect(listaCorreos(['a@x.co', ' '])).toEqual(['a@x.co']);
    expect(listaCorreos(null)).toEqual([]);
  });

  it('sanea el cuerpo: sin scripts, iframes, on* ni javascript:', () => {
    const limpio = sanearCuerpo(
      '<p onclick="x()">Hola</p><script>alert(1)</script><iframe src="x"></iframe>'
      + '<a href="javascript:alert(1)">l</a><table style="color:red"><tr><td>ok</td></tr></table>');
    expect(limpio).toContain('<p>Hola</p>');
    expect(limpio).not.toContain('script');
    expect(limpio).not.toContain('iframe');
    expect(limpio).not.toContain('onclick');
    expect(limpio).not.toContain('javascript:');
    expect(limpio).toContain('style="color:red"'); // el formato del correo se conserva
  });

  it('compone la vista: asunto, remitente, para/cc, detalle, cuerpo, adjuntos y pie', () => {
    const html = componerCorreoGmail({
      asunto: 'Notificacion de incapacidades - BELCHITE II',
      remitenteNombre: 'Correspondencia TuApo',
      remitenteCorreo: 'correspondencia.tuapo04@apoyolaboralts.com',
      para: ['coordinadornorte2.ts@gmail.com'],
      cc: ['lmpachon@eliteflower.com', 'lmesa@eliteflower.com'],
      fecha: ENVIO,
      cuerpoHtml: '<p>Cordial saludo,</p>',
      adjuntos: [
        { nombre: '1070982591 12082026 Notificacion.pdf', miniatura: 'data:image/png;base64,AAAA' },
        { nombre: '52123456 01092026 Notificacion.pdf', miniatura: null },
      ],
      pie: 'Vista generada por TuApo a partir del registro del envío (lote #2).',
    });
    expect(html).toContain('<title>Notificacion de incapacidades - BELCHITE II</title>');
    expect(html).toContain('<b>Correspondencia TuApo</b> <span>&lt;correspondencia.tuapo04@apoyolaboralts.com&gt;</span>');
    expect(html).toContain('para coordinadornorte2.ts@gmail.com, cc: lmpachon@eliteflower.com, lmesa@eliteflower.com');
    expect(html).toContain('mar, 8 sept 2026, 19:00');
    expect(html).toContain('<th>enviado por:</th><td>apoyolaboralts.com</td>');
    expect(html).toContain('<p>Cordial saludo,</p>');
    expect(html).toContain('2 archivos adjuntos');
    expect(html).toContain('<img src="data:image/png;base64,AAAA"');
    expect(html).toContain('lote #2');
    expect(html).not.toContain('<script');
  });

  it('vista previa (sin fecha) y sin cuenta conocida', () => {
    const html = componerCorreoGmail({
      asunto: 'x', remitenteNombre: 'Correspondencia TuApo', remitenteCorreo: null,
      para: [], cc: [], fecha: null, cuerpoHtml: '', adjuntos: [], pie: '',
    });
    expect(html).toContain('Borrador · sin enviar');
    expect(html).toContain('para (sin destinatario)');
    expect(html).not.toContain('enviado por:');
    expect(html).not.toContain('archivo adjunto');
  });

  it('escapa lo que viene del registro', () => {
    expect(escapar('<b>"x"</b>')).toBe('&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
    expect(tituloAdjuntos(1)).toBe('Un archivo adjunto');
  });

  it('nombre del adjunto igual al del backend: "{cedula} {ddMMyyyy} Notificacion.pdf"', () => {
    expect(nombreAdjunto('1070982591', '2026-08-12')).toBe('1070982591 12082026 Notificacion.pdf');
  });
});
