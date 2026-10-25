import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Subject } from 'rxjs';

import { AtencionRemota } from './remoto';
import { ContextoTurnosService } from '../../service/contexto-turnos.service';
import { AnalisisConversacion, Turno } from '../../service/turnos.service';
import { GestorVentanas } from '../../components/ventanas-flotantes/gestor-ventanas';
import { ORIGEN_APP } from '../../components/ventanas-flotantes/modulos';
import { PermissionsService } from '../../../../../../core/services/permissions.service';
import { AsistenteIaComponent } from '../../../herramientas-ia/pages/asistente-ia/asistente-ia.component';

const API = 'https://api.tuapo.co';
const BASE = `${API}/api/v1/turnos`;

const TURNO: Turno = {
  id: 'T1', oficina_id: 'OF2', servicio_id: 'S1', servicio_nombre: 'Contratación', servicio_color: '#2B59F0', fecha: '2026-09-27', numero: 7, codigo: 'C-007',
  estado: 'EN_ATENCION', prioridad: 'NORMAL', canal: 'QR', documento: '1020304', nombre: 'Ana Pérez', telefono: '3001234567', correo: null,
  empresa_usuaria_ref: null, empresa_usuaria_nombre: null, punto_id: null, punto_nombre: null, punto_tipo: null, asignado_punto_id: null, asignado_punto_nombre: null,
  asignado_usuario_ref: null, asignado_usuario_nombre: null, persona_ref: null, persona_origen: null, atendido_por: 'U1', atendido_por_nombre: 'Laura Gómez',
  area_id: null, area_nombre: null, area_referencia: null, creado_en: '2026-09-27T14:00:00Z', llamado_en: '2026-09-27T14:05:00Z', iniciado_en: '2026-09-27T14:06:00Z',
  finalizado_en: null, espera_seg: 300, atencion_seg: null, llamadas: 1, motivo: null, observaciones: null, agendado_para: null, confirmado_en: null,
  formulario_estado: 'COMPLETO', formulario_paso: 5, formulario_etiqueta: 'Formulario completo', formulario_url: null, formulario_listo: true,
  escalado_en: null, escalado_motivo: null, remoto: true, atendido_desde_oficina_id: 'OF1', atendido_desde_oficina_nombre: 'Suba', video_estado: 'EN_CURSO',
  clasificacion: null, clasificacion_nombre: null, devuelto_en: null, devuelto_motivo: null, devoluciones: 0, delante: null, espera_estimada_min: null,
};

const ANALISIS: AnalisisConversacion = {
  resumen: 'Ana confirmó sus datos y pidió cambiar la cuenta de nómina a Bancolombia.',
  temas: [
    { clave: 'cuenta-bancaria', titulo: 'Cuenta bancaria', tipo: 'DATO', resumen: 'Dice que cambió de banco', campo: 'banco', valor_ficha: 'Davivienda', valor_dicho: 'Bancolombia',
      hablante: 'PERSONA', at_ms: 83_000, cita: 'me cambié a Bancolombia', modulo: 'nomina-formas-pago', accion: 'Actualizar forma de pago' },
    { clave: 'incapacidad', titulo: 'Incapacidad pendiente', tipo: 'ALERTA', resumen: 'Tiene una incapacidad sin radicar', hablante: 'PERSONA', at_ms: 120_000, cita: null, modulo: null, accion: null },
  ],
  modelo: 'deepseek-flash', actualizado_en: new Date().toISOString(), error: null,
};

function contextoFalso() {
  const actual = signal<Turno | null>(TURNO);
  return {
    actual,
    turnoActual: computed(() => actual()),
    oficina: signal({ id: 'OF1', nombre: 'Suba' }),
    oficinaId: signal('OF1'),
    ahora: signal(Date.now()),
    preferencia: signal(null),
    videoSenal$: new Subject(),
    cargar: jasmine.createSpy('cargar'),
    refrescarEstado: jasmine.createSpy('refrescarEstado'),
    aplicarCaso: jasmine.createSpy('aplicarCaso'),
    aplicarTurno: jasmine.createSpy('aplicarTurno').and.callFake((t: Turno) => actual.set(t.estado === 'LLAMADO' || t.estado === 'EN_ATENCION' ? t : null)),
  };
}

describe('Atención remota en vivo (render con turno en curso)', () => {
  let http: HttpTestingController;
  let ctx: ReturnType<typeof contextoFalso>;

  beforeEach(() => {
    try { localStorage.removeItem('tuapo.turnos.ventanas'); sessionStorage.removeItem('tuapo.turnos.transcripcion.t0.T1'); } catch { /* sin storage */ }
    ctx = contextoFalso();
    TestBed.configureTestingModule({
      imports: [AtencionRemota],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]), provideNoopAnimations(),
        { provide: ContextoTurnosService, useValue: ctx },
        { provide: PermissionsService, useValue: { canReadRoute: (r: string) => !r.includes('gestion-legal') } },
        // Otro origen: las ventanas no enmarcan nada durante la prueba.
        { provide: ORIGEN_APP, useValue: 'https://prueba.invalid/' },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  async function crear() {
    const f = TestBed.createComponent(AtencionRemota);
    f.detectChanges();
    http.expectOne(`${BASE}/remoto/cola`).flush([]);
    http.expectOne(r => r.url === `${API}/gestion_contratacion/documento/buscar`).flush([{
      id: 9, numero_documento: '1020304', nombre: 'Ana Pérez', primer_nombre: 'Ana', segundo_nombre: null, primer_apellido: 'Pérez', segundo_apellido: null,
      email: 'ana@correo.co', celular: '3001234567', whatsapp: null, oficina: 'Suba', proceso_id: 4, contratado: 0, vacante_cargo: 'Operaria de flores',
      vacante_empresa: 'Flores SAS', vacante_finca: null, codigo_contrato: null, contrato_activo: 0, documentos: 3,
    }]);
    http.expectOne(r => r.url === `${BASE}/formulario/estado`).flush({ documento: '1020304', estado: 'COMPLETO', paso: 5, completo: true, listo: true, etiqueta: 'Formulario completo', nombre: null, telefono: null, correo: null, url: null });
    http.expectOne(`${BASE}/personas/1020304/atenciones`).flush([]);
    http.expectOne(`${BASE}/remoto/T1/transcripcion`).flush({
      lineas: [
        { id: 1, hablante: 'ASESOR', texto: 'Buenas tardes, Ana. ¿Me confirma sus datos?', inicio_ms: 60_000, fin_ms: 63_000 },
        { id: 2, hablante: 'PERSONA', texto: 'Sí, claro. Ahora me cambié a Bancolombia.', inicio_ms: 82_000, fin_ms: 86_000 },
      ],
      analisis: ANALISIS,
    });
    await respirar();
    f.detectChanges();
    return f;
  }

  it('pinta la conversación con quién habla, las pestañas y los temas, y sugiere el módulo como pestaña minimizada', async () => {
    const f = await crear();
    const el: HTMLElement = f.nativeElement;
    // La cola se pliega a una tira mientras se atiende.
    expect(el.querySelector('.cola__tira')).not.toBeNull();
    // Conversación: cada frase con su hablante, nombre y minuto.
    const frases = el.querySelectorAll('.frase');
    expect(frases.length).toBe(2);
    expect(frases[0].getAttribute('data-h')).toBe('asesor');
    expect(frases[0].querySelector('.frase__quien')!.textContent).toContain('Laura Gómez');
    expect(frases[0].querySelector('.frase__hora')!.textContent).toContain('01:00');
    expect(frases[1].getAttribute('data-h')).toBe('persona');
    expect(frases[1].querySelector('.frase__quien')!.textContent).toContain('Ana Pérez');
    expect(el.querySelector('.canal[data-h="asesor"] b')!.textContent).toContain('Laura Gómez');
    // Pestañas.
    const pestanas = Array.from(el.querySelectorAll('[role="tab"]')).map(b => b.textContent!.trim());
    expect(pestanas[0]).toContain('Temas');
    expect(pestanas[1]).toContain('Persona');
    expect(pestanas[2]).toContain('Chat IA');
    // Temas: tipo, diferencia ficha/dicho, cita y acción.
    const temas = el.querySelectorAll('.tema');
    expect(temas.length).toBe(2);
    expect(temas[0].querySelector('.tema__titulo')!.textContent).toContain('Cuenta bancaria');
    expect(temas[0].querySelector('.tema__dif s')!.textContent).toContain('Davivienda');
    expect(temas[0].querySelector('.tema__dif b')!.textContent).toContain('Bancolombia');
    expect(temas[0].querySelector('.tema__accion')!.textContent).toContain('Actualizar forma de pago');
    expect(temas[1].querySelector('.tema__accion')).toBeNull();
    expect(el.querySelector('.tm__resumen')!.textContent).toContain('Bancolombia');
    // El tema con módulo quedó como pestaña flotante minimizada y resaltada.
    const g = f.debugElement.injector.get(GestorVentanas);
    expect(g.ventanas().length).toBe(1);
    expect(g.ventanas()[0].estado).toBe('minimizada');
    expect(g.ventanas()[0].nueva).toBeTrue();
    expect(el.querySelector('.pestana--nueva')!.textContent).toContain('Formas de pago');
    f.destroy();
  });

  it('el botón del tema abre el módulo en ventana (sin duplicar) y la cita resalta la frase', async () => {
    const f = await crear();
    const el: HTMLElement = f.nativeElement;
    (el.querySelector('.tema__accion') as HTMLButtonElement).click();
    f.detectChanges();
    const g = f.debugElement.injector.get(GestorVentanas);
    expect(g.ventanas().length).toBe(1);
    expect(g.ventanas()[0].estado).not.toBe('minimizada');
    expect(g.ventanas()[0].url).toBe('https://prueba.invalid/#/dashboard/payments/payments-method?embebido=1');
    expect(el.querySelector('.vf:not(.vf--min) .vf__titulos')!.textContent).toContain('Actualizar forma de pago');
    // Cita → frase resaltada.
    (el.querySelector('.tema__cita') as HTMLButtonElement).click();
    await new Promise(r => setTimeout(r, 30));
    f.detectChanges();
    await respirar();
    f.detectChanges();
    expect(el.querySelector('.frase--destello')?.textContent).toContain('Bancolombia');
    // Cerrar la ventana: no se vuelve a sugerir con el siguiente análisis.
    (el.querySelector('.vf:not(.vf--min) .vf__btn--cerrar') as HTMLButtonElement).click();
    f.detectChanges();
    expect(g.ventanas().length).toBe(0);
    f.componentInstance.analisis.set({ ...ANALISIS });
    f.detectChanges();
    expect(g.ventanas().length).toBe(0);
    f.destroy();
  });

  it('"Abrir módulo" lista el catálogo y respeta permisos; Persona conserva validación y opciones', async () => {
    const f = await crear();
    const el: HTMLElement = f.nativeElement;
    const c = f.componentInstance;
    expect(c.modulosMenu().length).toBe(12);
    expect(c.modulosMenu().find(m => m.clave === 'juridico')!.permitido).toBeFalse();
    (el.querySelector('[data-pestana="persona"]') as HTMLButtonElement).click();
    f.detectChanges();
    expect(el.querySelector('.checklist')!.textContent).toContain('Está en contratación');
    const opcion = Array.from(el.querySelectorAll('.opciones .tn-boton')).find(b => b.textContent!.includes('Entrevista y ficha')) as HTMLButtonElement;
    opcion.click();
    f.detectChanges();
    const g = f.debugElement.injector.get(GestorVentanas);
    const pipeline = g.ventanas().find(v => v.modulo === 'pipeline')!;
    expect(pipeline.url).toContain('/dashboard/hiring/recruitment-pipeline?cedula=1020304&embebido=1');
    expect(pipeline.estado).not.toBe('minimizada');
    f.destroy();
  });

  it('Chat IA: embebe el asistente con la cédula, el nombre y la conversación como contexto', async () => {
    const f = await crear();
    const el: HTMLElement = f.nativeElement;
    expect(el.querySelector('app-asistente-ia')).toBeNull();
    (el.querySelector('[data-pestana="chat"]') as HTMLButtonElement).click();
    f.detectChanges();
    const chat = f.debugElement.query(d => d.componentInstance instanceof AsistenteIaComponent);
    expect(chat).not.toBeNull();
    const a = chat.componentInstance as AsistenteIaComponent;
    expect(a.embebido()).toBeTrue();
    expect(a.cedulaContexto()).toBe('1020304');
    expect(a.nombreContexto()).toBe('Ana Pérez');
    const ctxExtra = a.contextoExtra()!;
    expect(ctxExtra.length).toBeLessThanOrEqual(3800);
    expect(ctxExtra).toContain('Persona (Ana Pérez): Sí, claro. Ahora me cambié a Bancolombia.');
    expect(ctxExtra).toContain('Cuenta bancaria');
    // Al cambiar de pestaña el chat se conserva (oculto), no se destruye.
    (el.querySelector('[data-pestana="temas"]') as HTMLButtonElement).click();
    f.detectChanges();
    expect(el.querySelector('.lateral__chat--oculto app-asistente-ia')).not.toBeNull();
    http.match(() => true);
    f.destroy();
  });

  it('el cierre sigue igual: clasificación + nota (propone lo conversado) y cierra el turno', async () => {
    const f = await crear();
    const el: HTMLElement = f.nativeElement;
    const finalizar = Array.from(el.querySelectorAll('.cabecera__acciones .tn-boton')).find(b => b.textContent!.includes('Finalizar atención')) as HTMLButtonElement;
    finalizar.click();
    f.detectChanges();
    http.expectOne(r => r.url === `${BASE}/clasificaciones`).flush([
      { id: 'c1', clave: 'RESUELTO', nombre: 'Resuelto', descripcion: null, color: '#16a34a', icono: 'check', orden: 1, activo: true },
    ]);
    f.detectChanges();
    await respirar();
    f.detectChanges();
    const nota = el.querySelector('app-cierre-turno textarea') as HTMLTextAreaElement;
    expect(nota).not.toBeNull();
    expect(nota.value).toContain('Bancolombia');
    (el.querySelector('.cierre-turno__chip') as HTMLButtonElement).click();
    f.detectChanges();
    (Array.from(el.querySelectorAll('app-cierre-turno .tn-boton--exito'))[0] as HTMLButtonElement).click();
    f.detectChanges();
    const cierre = http.expectOne(`${BASE}/atencion/cerrar`);
    expect(cierre.request.body).toEqual(jasmine.objectContaining({ turno_id: 'T1', resultado: 'ATENDIDO', clasificacion: 'RESUELTO', observaciones: ANALISIS.resumen }));
    cierre.flush({ ...TURNO, estado: 'ATENDIDO' });
    f.detectChanges();
    http.expectOne(`${API}/gestion_contratacion/candidatos/mark-attended/`).flush({});
    http.match(`${BASE}/remoto/cola`).forEach(r => r.flush([]));
    expect(ctx.aplicarTurno).toHaveBeenCalled();
    f.detectChanges();
    expect(el.querySelector('.vacio h3')!.textContent).toContain('Elija un turno');
    expect(f.debugElement.injector.get(GestorVentanas).ventanas().length).toBe(0);
    f.destroy();
  });
});

/** Deja correr promesas y temporizadores cortos (las pantallas tienen intervalos: whenStable no termina). */
function respirar(ms = 10): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
