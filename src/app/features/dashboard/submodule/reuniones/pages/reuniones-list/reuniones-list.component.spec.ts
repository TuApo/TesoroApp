import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { ESPERA_BUSQUEDA_MS, ReunionesListComponent } from './reuniones-list.component';
import { ReunionesService } from '../../services/reuniones.service';
import { PERSONAS, resumen } from '../../testing/fabricas';
import { ResultadoBusquedaGlobal } from '../../models/reunion.model';

const esperar = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('ReunionesListComponent (render)', () => {
  let fixture: ComponentFixture<ReunionesListComponent>;
  let api: jasmine.SpyObj<ReunionesService>;

  const resultados: ResultadoBusquedaGlobal = {
    query: 'viernes',
    total: 3,
    matches: [
      { meeting_id: 'm1', meeting_code: 'REU-0001', meeting_name: 'Cierre de nómina', held_on: '2026-09-12', recording_id: 'r1',
        segment_id: 2, start_ms: 6000, end_ms: 12000, speaker_id: 'h1', speaker_name: 'Marcela Gómez', color_idx: 0,
        text: 'Necesitamos cerrar la nómina el viernes.' },
      { meeting_id: 'm1', meeting_code: 'REU-0001', meeting_name: 'Cierre de nómina', held_on: '2026-09-12', recording_id: 'r1',
        segment_id: 4, start_ms: 19000, end_ms: 26000, speaker_id: 'h2', speaker_name: 'Javier Ruiz', color_idx: 1,
        text: 'Me comprometo a enviar el reporte el viernes 15.' },
      { meeting_id: 'm2', meeting_code: 'REU-0002', meeting_name: 'Seguimiento', held_on: null, recording_id: 'r2',
        segment_id: 9, start_ms: 60000, end_ms: 64000, speaker_id: null, speaker_name: null, color_idx: null,
        text: 'Lo vemos el viernes.' },
    ],
  };

  async function montar(): Promise<HTMLElement> {
    fixture = TestBed.createComponent(ReunionesListComponent);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    api = jasmine.createSpyObj<ReunionesService>('ReunionesService', ['listar', 'personas', 'buscarGlobal', 'crear']);
    api.listar.and.returnValue(of({
      content: [
        resumen(),
        resumen({ id: 'm2', code: 'REU-0002', name: 'Reunión sin audio', recordings_count: 0, pipeline_status: null,
          transcript_status: null, analysis_status: null, summary_snippet: null, topics: [], speakers: [], total_duration_ms: null }),
      ],
      totalElements: 2, totalPages: 1, number: 0, size: 20,
    }));
    api.personas.and.returnValue(of(PERSONAS));
    api.buscarGlobal.and.returnValue(of(resultados));
    TestBed.configureTestingModule({
      imports: [ReunionesListComponent],
      providers: [provideZonelessChangeDetection(), provideRouter([]), { provide: ReunionesService, useValue: api }],
    });
  });

  it('pinta las tarjetas con estado humano, duración, temas, huella de voz y quién habló', async () => {
    const el = await montar();
    const tarjetas = el.querySelectorAll('.tarjeta');
    expect(tarjetas.length).toBe(2);
    const primera = tarjetas[0];
    expect(primera.querySelector('h3')?.textContent).toContain('Cierre de nómina de septiembre');
    expect(primera.querySelector('.tono')?.textContent).toContain('Transcrita y resumida');
    expect(primera.textContent).toContain('38 s');
    expect(primera.textContent).toContain('12 sep 2026');
    expect(primera.querySelectorAll('.temas .chip').length).toBe(2);
    expect(primera.querySelectorAll('.huella span').length).toBe(3);
    expect(primera.querySelectorAll('.apilados app-reu-avatar').length).toBe(3);
    // Leyenda ordenada por quien más habló.
    expect(primera.querySelector('.leyenda')?.textContent?.trim()).toBe('Javier 37 % · Marcela 31 % · Persona 3 23 %');
    expect(primera.querySelector('a')?.getAttribute('href')).toBe('/dashboard/reuniones/m1');

    const segunda = tarjetas[1];
    expect(segunda.querySelector('.tono')?.textContent).toContain('Sin grabación');
    expect(segunda.querySelector('.sin-voces')).not.toBeNull();
  });

  it('la pestaña Personas carga el directorio y enlaza a cada ficha', async () => {
    fixture = TestBed.createComponent(ReunionesListComponent);
    fixture.componentRef.setInput('vista', 'personas');
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(api.personas).toHaveBeenCalled();
    const personas = el.querySelectorAll('.persona');
    expect(personas.length).toBe(2);
    expect(personas[0].textContent).toContain('Marcela Gómez');
    expect(personas[0].textContent).toContain('1 compromiso abierto');
    expect(personas[0].getAttribute('href')).toBe('/dashboard/reuniones/personas/u:42');
    expect(personas[1].textContent).toContain('Externa');
    expect(personas[1].textContent).toContain('no ha intervenido');
    expect(el.querySelector('.tarjeta')).toBeNull();
  });

  it('busca en todo lo transcrito tras la espera y agrupa por reunión con la coincidencia resaltada', async () => {
    const el = await montar();
    fixture.componentInstance.alEscribir('vi');     // menos de 3 letras: no busca
    await esperar(ESPERA_BUSQUEDA_MS + 50);
    await fixture.whenStable();
    expect(api.buscarGlobal).not.toHaveBeenCalled();
    expect(el.querySelector('.pista-busqueda')?.textContent).toContain('al menos 3 letras');

    fixture.componentInstance.alEscribir('viernes');
    await esperar(ESPERA_BUSQUEDA_MS + 50);
    await fixture.whenStable();
    expect(api.buscarGlobal).toHaveBeenCalledOnceWith('viernes', { persona: null, limit: 100 });

    const grupos = el.querySelectorAll('.grupo');
    expect(grupos.length).toBe(2);
    expect(el.querySelector('.resultados-cab h2')?.textContent).toContain('3 veces en 2 reuniones');
    expect(grupos[0].querySelectorAll('.coincidencia').length).toBe(2);
    const primera = grupos[0].querySelector<HTMLAnchorElement>('.coincidencia')!;
    expect(primera.getAttribute('href')).toBe('/dashboard/reuniones/m1?t=6000');
    expect(primera.querySelector('mark')?.textContent).toBe('viernes');
    expect(primera.textContent).toContain('Marcela Gómez');
    expect(primera.textContent).toContain('00:06');
    expect(grupos[1].textContent).toContain('Sin identificar');
    // Mientras se busca, las pestañas se apartan.
    expect(el.querySelector('.pestanas')).toBeNull();

    fixture.componentInstance.limpiarBusqueda();
    await fixture.whenStable();
    expect(el.querySelector('.pestanas')).not.toBeNull();
  });

  it('estado vacío con la acción siguiente cuando no hay reuniones', async () => {
    api.listar.and.returnValue(of({ content: [], totalElements: 0, totalPages: 0, number: 0, size: 20 }));
    const el = await montar();
    expect(el.querySelector('.vacio h3')?.textContent).toContain('Todavía no hay reuniones');
    expect(el.querySelector('.vacio .btn.primario')?.textContent).toContain('Nueva reunión');
  });
});
