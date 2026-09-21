import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { DatosVista, NOMBRE_BLOQUE, VistaRender, bloqueNuevo } from './vista-render';
import { Media, Vista } from '../../service/turnos.service';

function pieza(p: Partial<Media>): Media {
  return { id: 'p', tipo: 'TEXTO', titulo: 'Pieza', descripcion: null, url: null, archivo_nombre: null, mime: null, bytes: null, ancho: null, alto: null,
    duracion_seg: 5, ajuste: 'CONTENER', silenciado: true, curso_ref: null, curso_url: null, vigente_desde: null, vigente_hasta: null, activo: true,
    etiquetas: null, creado_en: '', creado_por_nombre: null, alcances: [], vigente: true, emisiones: null, voz_texto: null, voz_id: null, voz_audio_id: null,
    cama_media_id: null, cama_volumen: 25, es_cama: false, intervalo_min: null, horario_json: null, ...p };
}

const VISTA: Vista = {
  id: 'v1', oficina_id: null, nombre: 'Prueba', descripcion: null, orientacion: 'HORIZONTAL', fondo: { tipo: 'DEGRADADO', color: '#000', color2: '#111', angulo: 90 },
  bloques: [
    { ...bloqueNuevo('OFICINA'), id: 'of' },
    { ...bloqueNuevo('RELOJ'), id: 'rl', props: { formato: '12h', mostrar_fecha: false } },
    { ...bloqueNuevo('TURNO_LLAMADO'), id: 'tl' },
    { ...bloqueNuevo('PUBLICIDAD'), id: 'pb' },
    { ...bloqueNuevo('TEXTO'), id: 'tx', props: { texto: 'Hola sala' } },
  ],
  activa: true, creado_en: '', actualizado_en: '', usada_por: [],
};

function datos(p: Partial<DatosVista> = {}): DatosVista {
  return { oficina_nombre: 'Suba', ahora: new Date(2026, 8, 21, 14, 5), llamado: null, en_curso: [], en_espera: [], piezas: [], playlists: {}, croquis: null, url_turno: null, ...p };
}

describe('VistaRender', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [VistaRender], providers: [provideHttpClient(), provideHttpClientTesting()] });
  });

  function crear(v: Vista = VISTA, d: DatosVista = datos()) {
    const f = TestBed.createComponent(VistaRender);
    f.componentRef.setInput('vista', v);
    f.componentRef.setInput('datos', d);
    f.componentRef.setInput('animar', false);
    f.componentRef.setInput('sonido', false);
    f.detectChanges();
    return f;
  }

  it('bloqueNuevo da un bloque válido de cada tipo con id propio', () => {
    for (const tipo of Object.keys(NOMBRE_BLOQUE) as Array<keyof typeof NOMBRE_BLOQUE>) {
      const b = bloqueNuevo(tipo);
      expect(b.tipo).toBe(tipo);
      expect(b.id).toBeTruthy();
      expect(b.w).toBeGreaterThan(0);
      expect(b.h).toBeGreaterThan(0);
      expect(b.x + b.w).toBeLessThanOrEqual(100);
      expect(b.y + b.h).toBeLessThanOrEqual(100);
    }
    expect(bloqueNuevo('QR').id).not.toBe(bloqueNuevo('QR').id);
  });

  it('pinta todos los bloques en su posición y el fondo degradado', () => {
    const f = crear();
    const cajas = f.nativeElement.querySelectorAll('.bq');
    expect(cajas.length).toBe(5);
    const oficina = f.nativeElement.querySelector('.bq--OFICINA') as HTMLElement;
    expect(oficina.textContent).toContain('Suba');
    expect(oficina.style.left).toBe('4%');
    const fondo = (f.nativeElement.querySelector('.vr') as HTMLElement).style.background;
    expect(fondo).toContain('linear-gradient');
    expect(f.nativeElement.querySelector('.bq--TEXTO').textContent).toContain('Hola sala');
  });

  it('el reloj respeta el formato de 12 horas', () => {
    const f = crear();
    expect(f.nativeElement.querySelector('.reloj__hora').textContent.trim()).toBe('2:05 p. m.');
  });

  it('el turno llamado muestra el código y el puesto; sin turnos muestra la invitación', () => {
    const vacio = crear();
    expect(vacio.nativeElement.querySelector('.llamado--vacio')).toBeTruthy();
    const t = { id: 't1', codigo: 'A-014', punto_nombre: 'Módulo 2', area_nombre: 'Contratación', nombre: 'CAMILO H.', estado: 'LLAMADO' } as never;
    const f = crear(VISTA, datos({ llamado: t, en_curso: [t] }));
    const bloque = f.nativeElement.querySelector('.bq--TURNO_LLAMADO');
    expect(bloque.querySelector('.llamado__codigo').textContent).toContain('A-014');
    expect(bloque.querySelector('.llamado__punto').textContent).toContain('Módulo 2');
    expect(bloque.querySelector('.llamado--pulso')).toBeTruthy();
  });

  it('la publicidad excluye camas y perifoneos y usa la lista del bloque si la pide', () => {
    const normal = pieza({ id: 'n', titulo: 'Normal' });
    const cama = pieza({ id: 'c', tipo: 'AUDIO', es_cama: true });
    const peri = pieza({ id: 'p', tipo: 'AUDIO', intervalo_min: 30 });
    const f = crear(VISTA, datos({ piezas: [cama, normal, peri], playlists: { l1: [pieza({ id: 'x', titulo: 'De lista' })] } }));
    const c = f.componentInstance;
    const bloque = VISTA.bloques.find(b => b.tipo === 'PUBLICIDAD')!;
    expect(c.piezasDe(bloque).map(p => p.id)).toEqual(['n']);
    expect(c.piezasDe({ ...bloque, props: { playlist_id: 'l1' } }).map(p => p.id)).toEqual(['x']);
    expect(f.nativeElement.querySelector('.bq--PUBLICIDAD .aviso h2').textContent).toContain('Normal');
  });

  it('una pieza de audio muestra la tarjeta y no reproduce si el sonido está apagado', () => {
    const audio = pieza({ id: 'a', tipo: 'AUDIO', titulo: 'Aviso', voz_texto: 'Recuerde su cédula', url: '/api/v1/public/turnos/voz/audio/1' });
    const f = crear(VISTA, datos({ piezas: [audio] }));
    const bloque = f.nativeElement.querySelector('.bq--PUBLICIDAD');
    expect(bloque.querySelector('.audio h2').textContent).toContain('Aviso');
    expect(bloque.querySelector('.audio p').textContent).toContain('Recuerde su cédula');
    expect(bloque.querySelector('audio')).toBeNull();
  });
});
