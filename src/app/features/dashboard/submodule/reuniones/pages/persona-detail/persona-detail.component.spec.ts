import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { PersonaDetailComponent } from './persona-detail.component';
import { ReunionesService } from '../../services/reuniones.service';
import { ficha } from '../../testing/fabricas';

describe('PersonaDetailComponent (render)', () => {
  let fixture: ComponentFixture<PersonaDetailComponent>;
  let api: jasmine.SpyObj<ReunionesService>;

  async function montar(clave = 'u:42'): Promise<HTMLElement> {
    fixture = TestBed.createComponent(PersonaDetailComponent);
    fixture.componentRef.setInput('key', clave);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    api = jasmine.createSpyObj<ReunionesService>('ReunionesService', ['persona', 'actualizarAcuerdo']);
    api.persona.and.returnValue(of(ficha()));
    TestBed.configureTestingModule({
      imports: [PersonaDetailComponent],
      providers: [provideZonelessChangeDetection(), provideRouter([]), { provide: ReunionesService, useValue: api }],
    });
  });

  it('pinta la cabecera, las cifras y pide la ficha por su clave', async () => {
    const el = await montar();
    expect(api.persona).toHaveBeenCalledWith('u:42');
    expect(el.querySelector('h1')?.textContent).toContain('Marcela Gómez');
    expect(el.querySelector('.cargo')?.textContent).toContain('Analista · Nómina');
    const cifras = el.querySelector('.cifras')?.textContent ?? '';
    expect(cifras).toContain('Reuniones');
    expect(cifras).toContain('12 min');           // 720 000 ms hablados
    expect(el.querySelector('app-reu-avatar')?.textContent?.trim()).toBe('MG');
  });

  it('lista las reuniones con lo que aportó y marca las que no habló', async () => {
    const el = await montar();
    const reuniones = el.querySelectorAll('.reunion');
    expect(reuniones.length).toBe(2);
    expect(reuniones[0].textContent).toContain('Cierre de nómina de septiembre');
    expect(reuniones[0].textContent).toContain('Pidió cerrar la nómina el viernes.');
    expect(reuniones[0].textContent).toContain('31 % del tiempo');
    expect(reuniones[1].classList).toContain('callada');
  });

  it('enlaza compromisos, decisiones y citas al minuto exacto', async () => {
    const el = await montar();
    const cita = el.querySelector<HTMLAnchorElement>('.cita');
    expect(cita?.getAttribute('href')).toContain('/dashboard/reuniones/m1?t=6000');
    expect(el.querySelectorAll('.acuerdo').length).toBe(2);
    const enlaces = [...el.querySelectorAll<HTMLAnchorElement>('.a-reunion')].map(a => a.getAttribute('href'));
    expect(enlaces).toContain('/dashboard/reuniones/m1?t=9000');
    expect(enlaces).toContain('/dashboard/reuniones/m1?t=6500');
    expect(el.textContent).toContain('el lunes');
  });

  it('marcar un compromiso como hecho manda el cuerpo completo con status HECHO', async () => {
    const f = ficha();
    api.actualizarAcuerdo.and.returnValue(of({ ...f.commitments[0], status: 'HECHO' }));
    const el = await montar();
    el.querySelector<HTMLButtonElement>('.check')!.click();
    await fixture.whenStable();
    expect(api.actualizarAcuerdo).toHaveBeenCalledWith('c1', jasmine.objectContaining({
      kind: 'COMPROMISO', text: 'Enviar el cronograma', due_text: 'el lunes', start_ms: 9000, status: 'HECHO',
    }));
    expect(el.querySelector('.acuerdo')?.getAttribute('data-estado')).toBe('HECHO');
  });

  it('muestra un error legible si la persona no existe', async () => {
    api.persona.and.returnValue(throwError(() => ({ status: 404 })));
    const el = await montar('u:999');
    expect(el.querySelector('.vacio')?.textContent).toContain('No encontramos a esta persona');
  });

  it('secciones vacías con su explicación', async () => {
    api.persona.and.returnValue(of(ficha({ meetings: [], commitments: [], decisions: [], quotes: [] })));
    const el = await montar();
    expect(el.textContent).toContain('No tiene compromisos registrados.');
    expect(el.textContent).toContain('Todavía no aparece en ninguna reunión.');
  });
});
