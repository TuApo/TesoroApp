import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { AsistenteIaComponent } from '../../../herramientas-ia/pages/asistente-ia/asistente-ia.component';

/** El chat de la atención remota le pasa a ms-ai la conversación en curso como `contexto`. */
describe('Chat IA de la atención remota · contextoExtra', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AsistenteIaComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), provideNoopAnimations()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  function crear(embebido: boolean) {
    const f = TestBed.createComponent(AsistenteIaComponent);
    f.componentRef.setInput('embebido', embebido);
    f.componentRef.setInput('cedulaContexto', '1020304');
    f.componentRef.setInput('nombreContexto', 'Ana Pérez');
    f.componentRef.setInput('contextoExtra', 'Atención remota por videollamada en curso.\n[01:22] Persona (Ana Pérez): me cambié a Bancolombia');
    f.detectChanges();
    http.match(() => true); // capacidades, módulos, carpetas y conversaciones: no importan aquí
    return f;
  }

  it('embebido: cada mensaje lleva la cédula y el contexto de la llamada', () => {
    const f = crear(true);
    f.componentInstance.draft.set('¿Qué cambió en sus datos?');
    f.componentInstance.enviar();
    const req = http.expectOne(r => r.method === 'POST' && r.url.endsWith('/ia/asistente/mensajes'));
    expect(req.request.body.cedulaContexto).toBe('1020304');
    expect(req.request.body.nombreContexto).toBe('Ana Pérez');
    expect(req.request.body.contexto).toContain('me cambié a Bancolombia');
    req.flush({ conversacionId: 1, mensaje: { id: 1, rol: 'assistant', contenido: 'Cambió de banco.', adjuntosJson: null, createdAt: '' }, modeloUsado: 'x' });
    http.match(() => true);
  });

  it('como página propia no manda contexto', () => {
    const f = crear(false);
    f.componentInstance.draft.set('Hola');
    f.componentInstance.enviar();
    const req = http.expectOne(r => r.method === 'POST' && r.url.endsWith('/ia/asistente/mensajes'));
    expect(req.request.body.contexto).toBeUndefined();
    expect(req.request.body.cedulaContexto).toBeUndefined();
    http.match(() => true);
  });
});
