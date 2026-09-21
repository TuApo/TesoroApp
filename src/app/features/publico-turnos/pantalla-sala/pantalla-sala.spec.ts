import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { PantallaSala, deletrear } from './pantalla-sala';

describe('PantallaSala', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [PantallaSala], providers: [provideHttpClient(), provideHttpClientTesting()] });
  });

  it('deletrea el código para que la voz lo lea bien', () => {
    expect(deletrear('A-014')).toBe('A, 14');
    expect(deletrear('AB-7')).toBe('A B, 7');
    expect(deletrear('sin-numero')).toBe('sin-numero');
  });

  it('el perifoneo respeta días y horario', () => {
    const f = TestBed.createComponent(PantallaSala);
    f.componentRef.setInput('codigo', 'X');
    const c = f.componentInstance as unknown as { enHorario: (p: { horario_json: string | null }) => boolean };
    const hoy = new Date();
    const dia = hoy.getDay() === 0 ? 7 : hoy.getDay();
    const otro = dia === 1 ? 2 : 1;
    expect(c.enHorario({ horario_json: null })).toBeTrue();
    expect(c.enHorario({ horario_json: JSON.stringify({ dias: [dia], desde: '00:00', hasta: '23:59' }) })).toBeTrue();
    expect(c.enHorario({ horario_json: JSON.stringify({ dias: [otro], desde: '00:00', hasta: '23:59' }) })).toBeFalse();
    expect(c.enHorario({ horario_json: JSON.stringify({ dias: [dia], desde: '23:58', hasta: '23:59' }) })).toBe(hoy.getHours() === 23 && hoy.getMinutes() >= 58);
    expect(c.enHorario({ horario_json: '{no es json' })).toBeTrue();
  });

  it('arranca sin diseño y arma los datos del renderizador desde la cola', () => {
    const f = TestBed.createComponent(PantallaSala);
    f.componentRef.setInput('codigo', 'X');
    const c = f.componentInstance;
    expect(c.conDiseno()).toBeFalse();
    expect(c.datosVista().en_espera).toEqual([]);
    expect(c.urlCama({ cama_media_id: 'c1' } as never)).toContain('/api/v1/public/turnos/media/c1/archivo');
    expect(c.urlCama({ cama_media_id: null } as never)).toBeNull();
  });
});
