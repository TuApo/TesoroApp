import { agruparDirectorio, claseEstadoEnvio, filtrarDirectorio } from './correos-empresas.component';
import { CorreoEmpresa } from '../../models/incapacidad-gestion.model';

/** Helpers puros del directorio de correos: agrupado por finca y filtro de texto. */
describe('CorreosEmpresas helpers', () => {
  const fila = (id: number, empresa: string, correo: string, extra: Partial<CorreoEmpresa> = {}): CorreoEmpresa => ({
    id, grupo: 'APOYO', empresa, correo, rol: 'OTRO', esPrincipal: false, orden: 1, contactoNombre: null,
    oficinaResponsable: null, telefono: null, extension: null, activo: true, actualizadoPor: null, creadoEn: null, ...extra,
  });

  it('agrupa por finca conservando el orden y toma el asistente/oficina de la primera fila que lo tenga', () => {
    const grupos = agruparDirectorio([
      fila(1, 'BELCHITE', 'a@x.co'),
      fila(2, 'BELCHITE', 'b@x.co', { contactoNombre: 'FERNANDA', oficinaResponsable: 'TOCANCIPA' }),
      fila(3, 'PALMAS', 'p@x.co'),
    ]);
    expect(grupos.map((g) => g.empresa)).toEqual(['BELCHITE', 'PALMAS']);
    expect(grupos[0].filas.length).toBe(2);
    expect(grupos[0].contactoNombre).toBe('FERNANDA');
    expect(grupos[0].oficinaResponsable).toBe('TOCANCIPA');
  });

  it('filtra por finca, correo o contacto sin importar tildes ni mayusculas', () => {
    const grupos = agruparDirectorio([
      fila(1, 'BELCHITE II', 'coordinadornorte2.ts@gmail.com', { contactoNombre: 'Fernanda Cabrera' }),
      fila(2, 'PALMAS', 'p@x.co', { oficinaResponsable: 'TOCANCIPA' }),
    ]);
    expect(filtrarDirectorio(grupos, 'belchité').map((g) => g.empresa)).toEqual(['BELCHITE II']);
    expect(filtrarDirectorio(grupos, 'NORTE2').map((g) => g.empresa)).toEqual(['BELCHITE II']);
    expect(filtrarDirectorio(grupos, 'cabrera').map((g) => g.empresa)).toEqual(['BELCHITE II']);
    expect(filtrarDirectorio(grupos, 'tocan').map((g) => g.empresa)).toEqual(['PALMAS']);
    expect(filtrarDirectorio(grupos, '').length).toBe(2);
  });

  it('colorea el estado del envio', () => {
    expect(claseEstadoEnvio('ENVIADO')).toBe('ges-chip-ok');
    expect(claseEstadoEnvio('FALLIDO')).toBe('ges-chip-peligro');
    expect(claseEstadoEnvio('SIN_DESTINATARIO')).toBe('ges-chip-aviso');
    expect(claseEstadoEnvio(null)).toBe('ges-chip-neutro');
  });
});
