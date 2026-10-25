import { TestBed } from '@angular/core/testing';

import { PanelTranscripcion } from './panel-transcripcion';
import { ItemConversacion } from '../en-vivo.util';

const item = (clave: string, hablante: 'ASESOR' | 'PERSONA', texto: string, inicio_ms: number, provisional = false, primeroDelGrupo = true): ItemConversacion =>
  ({ clave, hablante, texto, inicio_ms, provisional, primeroDelGrupo });

describe('PanelTranscripcion', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [PanelTranscripcion] }));

  function crear(entradas: Record<string, unknown>) {
    const f = TestBed.createComponent(PanelTranscripcion);
    f.componentRef.setInput('nombres', { ASESOR: 'Laura Gómez', PERSONA: 'Ana Pérez' });
    for (const [k, v] of Object.entries(entradas)) f.componentRef.setInput(k, v);
    f.detectChanges();
    return f;
  }

  it('transcribiendo: estado, aviso a la vista, medidores por canal y la parcial en gris con cursor', () => {
    const f = crear({
      estado: 'transcribiendo', enLlamada: true, metodo: 'script',
      canales: { ASESOR: { estado: 'transcribiendo', detalle: null }, PERSONA: { estado: 'transcribiendo', detalle: null } },
      niveles: { ASESOR: 0.8, PERSONA: 0 },
      items: [item('c:1', 'ASESOR', 'Buenas tardes', 1000), item('parcial:PERSONA', 'PERSONA', 'hola buenas', 5000, true)],
    });
    const el: HTMLElement = f.nativeElement;
    expect(el.querySelector('.tx__estado')!.textContent).toContain('Transcribiendo');
    expect(el.querySelector('.tx__aviso')!.textContent).toContain('Se está transcribiendo esta atención');
    expect(el.querySelector('.tx')!.getAttribute('data-captura')).toBe('script');
    expect((el.querySelector('.canal[data-h="asesor"] .canal__medidor') as HTMLElement).style.getPropertyValue('--nivel')).toBe('0.8');
    const parcial = el.querySelector('.frase--provisional')!;
    expect(parcial.getAttribute('data-h')).toBe('persona');
    expect(parcial.querySelector('.frase__cursor')).not.toBeNull();
    expect(el.querySelector('.frase[data-h="asesor"] .frase__hora')!.textContent).toContain('00:01');
    // Solo la frase cerrada se anuncia al lector de pantalla.
    expect(el.querySelector('.solo-lector')!.textContent).toContain('Laura Gómez: Buenas tardes');
  });

  it('botones según el estado: pausar, reanudar, reintentar y transcribir esta llamada', () => {
    const f = crear({ estado: 'transcribiendo' });
    const el: HTMLElement = f.nativeElement;
    const eventos: string[] = [];
    f.componentInstance.pausar.subscribe(() => eventos.push('pausar'));
    f.componentInstance.reanudar.subscribe(() => eventos.push('reanudar'));
    f.componentInstance.reintentar.subscribe(() => eventos.push('reintentar'));
    f.componentInstance.iniciar.subscribe(() => eventos.push('iniciar'));
    f.componentInstance.automaticaCambio.subscribe(v => eventos.push('auto:' + v));
    (el.querySelector('.tx__acciones .tx__btn') as HTMLButtonElement).click();
    f.componentRef.setInput('estado', 'pausada'); f.detectChanges();
    (el.querySelector('.tx__acciones .tx__btn') as HTMLButtonElement).click();
    f.componentRef.setInput('estado', 'error'); f.componentRef.setInput('motivo', 'Se agotó el saldo'); f.detectChanges();
    expect(el.querySelector('.tx__motivo--error')!.textContent).toContain('Se agotó el saldo');
    (el.querySelector('.tx__acciones .tx__btn') as HTMLButtonElement).click();
    f.componentRef.setInput('estado', 'apagada'); f.componentRef.setInput('enLlamada', true); f.detectChanges();
    (el.querySelector('.tx__acciones .tx__btn') as HTMLButtonElement).click();
    (el.querySelector('.tx__auto input') as HTMLInputElement).click();
    expect(eventos).toEqual(['pausar', 'reanudar', 'reintentar', 'iniciar', 'auto:false']);
  });

  it('vacío sin llamada invita a conectar; audio bloqueado ofrece activarlo', () => {
    const f = crear({ estado: 'apagada', enLlamada: false, audioBloqueado: true });
    const el: HTMLElement = f.nativeElement;
    expect(el.querySelector('.tx__vacio')!.textContent).toContain('Cuando la videollamada se conecte');
    let activado = false;
    f.componentInstance.activarAudio.subscribe(() => (activado = true));
    (el.querySelector('.tx__desbloquear') as HTMLButtonElement).click();
    expect(activado).toBeTrue();
  });

  it('si la persona sube a leer, deja de seguir y cuenta las frases nuevas', () => {
    const f = crear({ estado: 'transcribiendo', items: [item('c:1', 'ASESOR', 'Uno', 0)] });
    const c = f.componentInstance;
    c.seguir.set(false);
    f.componentRef.setInput('items', [item('c:1', 'ASESOR', 'Uno', 0), item('c:2', 'PERSONA', 'Dos', 1000), item('c:3', 'PERSONA', 'Tres', 2000, false, false)]);
    f.detectChanges();
    f.detectChanges();
    const el: HTMLElement = f.nativeElement;
    expect(el.querySelector('.tx__nuevas')!.textContent).toContain('2 frases nuevas');
    (el.querySelector('.tx__nuevas') as HTMLButtonElement).click();
    f.detectChanges();
    f.detectChanges();
    expect(c.seguir()).toBeTrue();
    expect(el.querySelector('.tx__nuevas')).toBeNull();
  });
});
