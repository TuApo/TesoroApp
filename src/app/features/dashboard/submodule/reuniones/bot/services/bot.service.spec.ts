import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { environment } from '@/environments/environment';
import { BotService } from './bot.service';

const BASE = `${environment.apiUrl}/api/v1/meetings/bot`;

describe('BotService', () => {
  let api: BotService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(BotService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('live: GET con cursor y versión de notas', () => {
    api.live('s1', 42, 3).subscribe();
    const req = http.expectOne(r => r.url === `${BASE}/sessions/s1/live`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('desde')).toBe('42');
    expect(req.request.params.get('notas_version')).toBe('3');
    req.flush({ sesion: {}, eventos: [], notas: null, compromisos: [], ultimo_id: 42 });
  });

  it('sesiones: filtra por grupo y omite filtros vacíos', () => {
    api.sesiones({ estado: 'VIVAS', page: undefined, size: 50 }).subscribe();
    const req = http.expectOne(r => r.url === `${BASE}/sessions`);
    expect(req.request.params.get('estado')).toBe('VIVAS');
    expect(req.request.params.get('size')).toBe('50');
    expect(req.request.params.has('page')).toBeFalse();
    req.flush({ content: [] });
  });

  it('crear y comandos: POST con el cuerpo del contrato', () => {
    api.crear({ join_url: 'https://meet.google.com/x', modo: 'NAVEGADOR' }).subscribe();
    const c = http.expectOne(`${BASE}/sessions`);
    expect(c.request.method).toBe('POST');
    expect(c.request.body).toEqual({ join_url: 'https://meet.google.com/x', modo: 'NAVEGADOR' });
    c.flush({});

    api.comando('s1', 'ENVIAR_CHAT', { texto: 'hola' }).subscribe();
    const k = http.expectOne(`${BASE}/sessions/s1/comandos`);
    expect(k.request.body).toEqual({ tipo: 'ENVIAR_CHAT', texto: 'hola' });
    k.flush({});
  });

  it('chat: 202 con la respuesta pendiente', () => {
    let r: unknown;
    api.chat('s1', '¿Qué se decidió?').subscribe(x => (r = x));
    const req = http.expectOne(`${BASE}/sessions/s1/chat`);
    expect(req.request.body).toEqual({ pregunta: '¿Qué se decidió?' });
    req.flush({ pregunta: { id: 9 }, respuesta: null }, { status: 202, statusText: 'Accepted' });
    expect(r).toEqual({ pregunta: { id: 9 }, respuesta: null } as never);
  });

  it('subirAudio: PUT crudo con seq y Content-Type sin parámetros de códec', () => {
    const blob = new Blob(['x'], { type: 'audio/webm;codecs=opus' });
    api.subirAudio('s1', 7, blob).subscribe();
    const req = http.expectOne(r => r.url === `${BASE}/sessions/s1/captura/audio`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.params.get('seq')).toBe('7');
    expect(req.request.headers.get('Content-Type')).toBe('audio/webm');
    expect(req.request.body).toBe(blob);
    req.flush({ seq: 7 });
  });

  it('absoluta: antepone el host del API a la URL firmada relativa', () => {
    expect(api.absoluta('/api/v1/meetings/media/bot/s/1?t=x')).toBe(`${environment.apiUrl}/api/v1/meetings/media/bot/s/1?t=x`);
    expect(api.absoluta('https://cdn/x')).toBe('https://cdn/x');
  });
});
