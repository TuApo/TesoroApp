import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { ReunionDetailComponent, SONDEO_MS } from './reunion-detail.component';
import { ReunionesService } from '../../services/reuniones.service';
import { HABLANTES, SEGMENTOS, detalle, insights, participante } from '../../testing/fabricas';

describe('ReunionDetailComponent (render)', () => {
  let fixture: ComponentFixture<ReunionDetailComponent>;
  let api: jasmine.SpyObj<ReunionesService>;

  const pagina = { content: SEGMENTOS, totalElements: SEGMENTOS.length, totalPages: 1, number: 0, size: 500 };

  beforeEach(() => {
    api = jasmine.createSpyObj<ReunionesService>('ReunionesService', [
      'detalle', 'insights', 'segmentos', 'grabaciones', 'urlDeMedia', 'notas', 'asignarHablante', 'confirmarHablante',
      'participanteDesdeSugerencia', 'analizar', 'crearAcuerdo', 'actualizarAcuerdo', 'eliminarAcuerdo', 'editarSegmento',
    ]);
    api.detalle.and.returnValue(of(detalle()));
    api.insights.and.returnValue(of(insights()));
    api.segmentos.and.returnValue(of(pagina));
    api.grabaciones.and.returnValue(of(detalle().recordings));
    api.urlDeMedia.and.callFake(() => Promise.reject(new Error('sin permiso de escucha')));
    api.notas.and.returnValue(of([]));
    TestBed.configureTestingModule({
      imports: [ReunionDetailComponent],
      providers: [provideZonelessChangeDetection(), provideRouter([]), { provide: ReunionesService, useValue: api }],
    });
  });

  async function montar(t?: string): Promise<HTMLElement> {
    fixture = TestBed.createComponent(ReunionDetailComponent);
    fixture.componentRef.setInput('id', 'm1');
    if (t) fixture.componentRef.setInput('t', t);
    await fixture.whenStable();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('pinta la conversación por turnos, quién habló, la línea de tiempo y lo que se habló', async () => {
    const el = await montar();
    expect(api.segmentos).toHaveBeenCalledWith('r1', 0, 500);
    expect(el.querySelector('h1')?.textContent).toContain('Cierre de nómina de septiembre');

    // Conversación: 3 turnos (Marcela ×2, Persona 2 ×2, Persona 3 ×1).
    const turnos = el.querySelectorAll('app-reu-transcripcion .turno');
    expect(turnos.length).toBe(3);
    expect(turnos[0].querySelector('.turno-nombre')?.textContent).toContain('Marcela Gómez');
    expect(turnos[0].querySelectorAll('.seg').length).toBe(2);
    // Marcas de decisión/compromiso donde se dijeron.
    expect(el.querySelector('#seg-2 .marca[data-tipo="DECISION"]')).not.toBeNull();
    expect(el.querySelector('#seg-4 .marca[data-tipo="COMPROMISO"]')).not.toBeNull();

    // Quién habló, con la sugerencia de la IA que coincide con un participante.
    const hablantes = el.querySelectorAll('app-reu-hablantes .hablante');
    expect(hablantes.length).toBe(HABLANTES.length);
    expect(hablantes[1].textContent).toContain('Soy Javier, de sistemas');
    expect(hablantes[1].textContent).toContain('Sí, es Javier Ruiz');

    // Línea de tiempo: un carril por persona y las bandas de temas.
    expect(el.querySelectorAll('app-reu-linea-tiempo .carril').length).toBe(3);
    expect(el.querySelectorAll('app-reu-linea-tiempo .banda').length).toBe(2);

    // Lo que se habló: el resumen.
    expect(el.querySelector('app-reu-lo-hablado .resumen')?.textContent).toContain('Se acordó cerrar la nómina el viernes.');
    // Sin permiso de audio, la transcripción se sigue leyendo.
    expect(el.querySelector('.sin-audio')?.textContent).toContain('No tienes permiso');
  });

  it('aceptar la sugerencia asigna el participante y relee los insights', async () => {
    api.asignarHablante.and.returnValue(of({ ...HABLANTES[1], participant_id: 'p2', display_name: 'Javier Ruiz', participant_source: 'MANUAL' }));
    const el = await montar();
    const boton = [...el.querySelectorAll<HTMLButtonElement>('app-reu-hablantes .hablante:nth-child(2) .btn')]
      .find(b => b.textContent?.includes('Sí, es Javier Ruiz'))!;
    boton.click();
    await fixture.whenStable();
    expect(api.asignarHablante).toHaveBeenCalledWith('h2', 'p2');
    expect(api.insights).toHaveBeenCalledTimes(2);
  });

  it('clic en una persona filtra la conversación a lo que ella dijo', async () => {
    const el = await montar();
    el.querySelector<HTMLButtonElement>('app-reu-hablantes .hablante .cabeza')!.click();
    await fixture.whenStable();
    const turnos = el.querySelectorAll('app-reu-transcripcion .turno');
    expect(turnos.length).toBe(1);
    expect(el.querySelector('app-reu-transcripcion .filtros')?.textContent).toContain('Marcela Gómez');
  });

  it('?t= resalta la frase de ese minuto', async () => {
    const el = await montar('19500');
    expect(el.querySelector('#seg-4')?.classList).toContain('activo');
    expect(el.querySelector('.fila-medio .tiempo')?.textContent).toContain('00:19');
  });

  it('sin grabación ofrece grabar o subir', async () => {
    api.insights.and.returnValue(of(insights({
      recording_id: null, transcript_id: null, transcript_status: null, pipeline: null, analysis: null,
      speakers: [], topics: [], items: [], duration_ms: null,
    })));
    api.detalle.and.returnValue(of(detalle({ recordings: [] })));
    const el = await montar();
    expect(el.querySelector('app-reu-captura')).not.toBeNull();
    expect(el.textContent).toContain('Esta reunión todavía no tiene grabación');
    expect(el.textContent).toContain('Grabar ahora');
  });

  it('los enlaces a la ficha usan la clave de persona del backend, sin recalcularla', async () => {
    // Con "Doctora" y guion el front calcularía "n:doctora marcela gomez-ruiz": la ficha
    // quedaría vacía. La clave buena es la que manda el backend.
    const marcela = participante({
      id: 'p1', first_name: 'Doctora Marcela', last_name: 'Gómez-Ruiz', display_name: 'Doctora Marcela Gómez-Ruiz',
      person_key: 'n:marcela gomez ruiz',
    });
    const sinClave = participante({ id: 'p9', first_name: 'Luisa', display_name: 'Luisa' });   // backend viejo
    api.detalle.and.returnValue(of(detalle({ participants: [marcela, sinClave] })));
    api.insights.and.returnValue(of(insights({
      speakers: [{ ...HABLANTES[0], display_name: marcela.display_name, participant_name: marcela.display_name,
        person_key: 'n:marcela gomez ruiz' }, HABLANTES[1], HABLANTES[2]],
    })));
    const el = await montar();
    const ruta = (a: Element | null) => decodeURIComponent(a?.getAttribute('href') ?? '');

    // Quién habló: sólo la voz con participante enlaza, y con la clave del backend.
    const enlaces = el.querySelectorAll('app-reu-hablantes a[href*="/personas/"]');
    expect(enlaces.length).toBe(1);
    expect(ruta(enlaces[0])).toBe('/dashboard/reuniones/personas/n:marcela gomez ruiz');

    // Lo que se habló · Por persona.
    fixture.componentInstance.pestanaHablado.set('personas');
    await fixture.whenStable();
    expect([...el.querySelectorAll('app-reu-lo-hablado a[href*="/personas/"]')].map(ruta))
      .toEqual(['/dashboard/reuniones/personas/n:marcela gomez ruiz']);

    // Detalles: el participante sin clave del backend se muestra sin enlace (no uno inventado).
    fixture.componentInstance.vista.set('detalles');
    await fixture.whenStable();
    expect([...el.querySelectorAll('app-reu-detalles a.p-nombre')].map(ruta))
      .toEqual(['/dashboard/reuniones/personas/n:marcela gomez ruiz']);
    expect(el.querySelector('app-reu-detalles span.p-nombre')?.textContent).toContain('Luisa');
  });

  it('exportar acta copia el Markdown con resumen y transcripción', async () => {
    const copiar = spyOn(navigator.clipboard, 'writeText').and.returnValue(Promise.resolve());
    await montar();
    await fixture.componentInstance.copiarActa();
    const md = copiar.calls.mostRecent().args[0] as string;
    expect(md).toContain('# Acta de reunión: Cierre de nómina de septiembre');
    expect(md).toContain('**[00:00] Marcela Gómez:**');
  });

  describe('sondeo del pipeline', () => {
    beforeEach(() => jasmine.clock().install());
    afterEach(() => jasmine.clock().uninstall());

    it('pregunta cada 5 s mientras se procesa, carga al terminar y se apaga', () => {
      const procesando = insights({
        recording_id: null, transcript_status: 'EN_PROCESO', pipeline: { status: 'TRANSCRIBING', stage_error: null },
        analysis: null, speakers: [], topics: [], items: [],
      });
      api.insights.and.returnValues(of(procesando), of(insights()), of(insights()));
      fixture = TestBed.createComponent(ReunionDetailComponent);
      fixture.componentRef.setInput('id', 'm1');
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.proceso')?.textContent).toContain('Transcribiendo lo que se dijo');
      expect(api.insights).toHaveBeenCalledTimes(1);
      expect(api.segmentos).not.toHaveBeenCalled();

      jasmine.clock().tick(SONDEO_MS);
      expect(api.insights).toHaveBeenCalledTimes(2);
      expect(api.segmentos).toHaveBeenCalledWith('r1', 0, 500);

      jasmine.clock().tick(SONDEO_MS * 3);
      expect(api.insights).toHaveBeenCalledTimes(2);    // terminó: no se sigue preguntando
    });

    it('una grabación detenida con motivo (sin proveedor) no se sondea para siempre y dice por qué', () => {
      const detenida = insights({
        recording_id: null, transcript_id: null, transcript_status: null, analysis: null, speakers: [], topics: [], items: [],
        pipeline: { status: 'SEGMENTING', stage_error: 'Transcripción no configurada (falta ELEVENLABS_API_KEY)' },
      });
      api.insights.and.returnValue(of(detenida));
      fixture = TestBed.createComponent(ReunionDetailComponent);
      fixture.componentRef.setInput('id', 'm1');
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.proceso')).toBeNull();
      expect(el.querySelector('.fallo')?.textContent).toContain('falta ELEVENLABS_API_KEY');
      jasmine.clock().tick(SONDEO_MS * 4);
      expect(api.insights).toHaveBeenCalledTimes(1);
    });

    it('si la reunión desaparece a mitad del proceso (404) deja de preguntar', () => {
      const procesando = insights({
        recording_id: null, transcript_status: 'EN_PROCESO', pipeline: { status: 'TRANSCRIBING', stage_error: null },
        analysis: null, speakers: [], topics: [], items: [],
      });
      api.insights.and.returnValues(of(procesando), throwError(() => new HttpErrorResponse({ status: 404 })));
      fixture = TestBed.createComponent(ReunionDetailComponent);
      fixture.componentRef.setInput('id', 'm1');
      fixture.detectChanges();
      jasmine.clock().tick(SONDEO_MS);
      expect(api.insights).toHaveBeenCalledTimes(2);
      jasmine.clock().tick(SONDEO_MS * 4);
      expect(api.insights).toHaveBeenCalledTimes(2);
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('no se encontró');
    });

    it('al salir de la pantalla se detiene el sondeo', () => {
      const procesando = insights({
        recording_id: null, transcript_status: 'EN_PROCESO', pipeline: { status: 'TRANSCRIBING', stage_error: null },
        analysis: null, speakers: [], topics: [], items: [],
      });
      api.insights.and.returnValue(of(procesando));
      fixture = TestBed.createComponent(ReunionDetailComponent);
      fixture.componentRef.setInput('id', 'm1');
      fixture.detectChanges();
      jasmine.clock().tick(SONDEO_MS);
      expect(api.insights).toHaveBeenCalledTimes(2);
      fixture.destroy();
      jasmine.clock().tick(SONDEO_MS * 4);
      expect(api.insights).toHaveBeenCalledTimes(2);
    });
  });
});
