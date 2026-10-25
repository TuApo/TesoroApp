import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import Swal from 'sweetalert2';

import { environment } from '@/environments/environment';
import {
  CorreosEmpresasComponent,
  agruparDirectorio,
  claseEstadoEnvio,
  filtrarDirectorio,
} from './correos-empresas.component';
import { CorreoConfig, CorreoEmpresa, LotePreview, ResultadoEnvioLote } from '../../models/incapacidad-gestion.model';
import { hoyIso } from '../informes-incapacidades/informes-incapacidades.component';

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

// ─────────────────────────────────────────────────────────────────────────
// Modo de envio: INMEDIATO = correo al registrar + resumen del dia (respuesta
// de la funcional 2026-10-07); DIARIO = lote automatico (sin cambios)
// ─────────────────────────────────────────────────────────────────────────

/** `Swal.fire` tiene varias sobrecargas: se expone con una firma simple para espiarla. */
function swalEspiable(): { fire: (...args: unknown[]) => Promise<unknown> } {
  return Swal as unknown as { fire: (...args: unknown[]) => Promise<unknown> };
}

/** Deja correr las promesas de SweetAlert2 (el `.then` de la confirmacion). */
async function microtareas(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

describe('CorreosEmpresasComponent (modo de envio y resumen del dia)', () => {
  let fixture: ComponentFixture<CorreosEmpresasComponent>;
  let http: HttpTestingController;
  const BASE = `${environment.apiUrl}/Incapacidades/v2`;
  const URL_LOTE = `${BASE}/correos/lotes/previsualizar`;
  const URL_RESUMEN = `${BASE}/correos/resumen/previsualizar`;

  const CONFIG: CorreoConfig = {
    envioModo: 'INMEDIATO',
    envioHora: '19:00',
    ventanaDias: 3,
    ultimaCorrida: '2026-10-05',
    resumenDiario: true,
    modoPlataforma: 'prueba',
    destinoPrueba: 'pruebas@correo.co',
  };

  const PREVIEW: LotePreview = {
    fecha: '2026-10-06',
    modoEnvio: 'INMEDIATO',
    prueba: true,
    destinoPrueba: 'pruebas@correo.co',
    totalIncapacidades: 0,
    totalCorreos: 0,
    grupos: [],
  };

  const PREVIEW_CON_UNA: LotePreview = {
    ...PREVIEW,
    totalIncapacidades: 1,
    totalCorreos: 1,
    grupos: [{
      clave: 'APOYO|BELCHITE', grupo: 'APOYO', empresaMatch: 'BELCHITE', destinatario: 'jefe@finca.co', copias: [],
      sinDestinatario: false, detalle: null, asunto: 'Resumen de incapacidades del dia 07/10/2026 - BELCHITE (1)',
      cuerpoHtml: '<p>resumen</p>',
      incapacidades: [{
        incapacidadId: 9, codigoConsecutivo: 'INC-9', cedula: '1005851505', nombreCompleto: 'ANA PEREZ',
        empresa: 'BELCHITE', centroCosto: 'BELCHITE', tipoIncapacidad: 'ENFERMEDAD_GENERAL',
        tipoIncapacidadEtiqueta: 'Enfermedad general', fechaInicio: '2026-10-07', fechaFin: '2026-10-09', dias: 3,
        creadoEn: '2026-10-07T09:00:00',
      }],
    }],
  };

  function texto(): string {
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  /**
   * Monta la pantalla: primero la configuracion y, segun su modo, la previsualizacion que toca
   * (resumen en INMEDIATO, lote en DIARIO). Comprueba que NO se pide la del otro modo.
   */
  async function montar(config: CorreoConfig | Omit<CorreoConfig, 'resumenDiario'>, preview: LotePreview = PREVIEW): Promise<HTMLElement> {
    fixture = TestBed.createComponent(CorreosEmpresasComponent);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    // Nada se previsualiza antes de saber el modo.
    http.expectNone((r) => r.url === URL_LOTE || r.url === URL_RESUMEN);
    http.expectOne(`${BASE}/correos/config`).flush(config);
    const resumen = config.envioModo === 'INMEDIATO';
    http.expectOne((r) => r.url === (resumen ? URL_RESUMEN : URL_LOTE)).flush(preview);
    http.expectNone((r) => r.url === (resumen ? URL_LOTE : URL_RESUMEN));
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  async function irAConfiguracion(): Promise<string> {
    fixture.componentInstance.cambiarTab(1);
    fixture.detectChanges();
    await fixture.whenStable();
    return texto();
  }

  beforeEach(async () => {
    localStorage.removeItem('user');
    await TestBed.configureTestingModule({
      imports: [CorreosEmpresasComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        { provide: MatDialog, useValue: { open: jasmine.createSpy('open') } },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    fixture.destroy();
    http.verify();
  });

  it('en INMEDIATO la primera pestaña es "Resumen del día" y su botón envía el resumen', async () => {
    const html = await montar(CONFIG);
    const t = html.textContent ?? '';

    expect(fixture.componentInstance.esResumen()).toBeTrue();
    expect(t).toContain('Resumen del día');
    expect(t).not.toContain('Lote de hoy');
    expect(t).toContain('automático al registrar + resumen del día');
    expect(t).toContain('A las 19:00 sale solo el resumen del día');
    expect(t).toContain('Enviar resumen del día ahora');
    expect(t).not.toContain('Enviar lote del día (pendientes)');
    expect(t).toContain('Hoy no se han registrado incapacidades con soporte.');
  });

  it('en DIARIO conserva "Lote de hoy", el lote automatico y su boton', async () => {
    const html = await montar({ ...CONFIG, envioModo: 'DIARIO' });
    const t = html.textContent ?? '';

    expect(fixture.componentInstance.esResumen()).toBeFalse();
    expect(t).toContain('Lote de hoy');
    expect(t).toContain('solo lote diario automático');
    expect(t).toContain('Enviar lote del día (pendientes)');
    expect(t).not.toContain('Enviar resumen del día ahora');
    expect(t).toContain('Correos que saldrían');
  });

  it('mientras llega la configuracion ya muestra que se esta armando y no deja actualizar', async () => {
    fixture = TestBed.createComponent(CorreosEmpresasComponent);
    http = TestBed.inject(HttpTestingController);
    // Antes la pestana quedaba en blanco (sin spinner) y "Actualizar" habilitado hasta el GET de la config.
    expect(texto()).toContain('Armando la previsualización');
    expect(fixture.componentInstance.cargandoPreview()).toBeTrue();
    const actualizar = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((b) => (b.textContent ?? '').includes('Actualizar')) as HTMLButtonElement;
    expect(actualizar.disabled).toBeTrue();

    http.expectOne(`${BASE}/correos/config`).flush(CONFIG);
    http.expectOne((r) => r.url === URL_RESUMEN).flush(PREVIEW);
    expect(fixture.componentInstance.cargandoPreview()).toBeFalse();
    expect(texto()).not.toContain('Armando la previsualización');
  });

  it('si "Actualizar" falla en INMEDIATO conserva el modo: sigue el resumen, nunca el lote de pendientes', async () => {
    await montar(CONFIG, PREVIEW_CON_UNA);

    fixture.componentInstance.cargarConfig();
    http.expectOne(`${BASE}/correos/config`).flush({ error: 'caido' }, { status: 503, statusText: 'x' });
    http.expectOne((r) => r.url === URL_RESUMEN).flush(PREVIEW_CON_UNA);
    http.expectNone((r) => r.url === URL_LOTE);

    expect(fixture.componentInstance.config()?.envioModo).toBe('INMEDIATO');
    expect(fixture.componentInstance.esResumen()).toBeTrue();
    const t = texto();
    expect(t).toContain('Enviar resumen del día ahora');
    expect(t).not.toContain('Enviar lote del día (pendientes)');
  });

  it('si la configuracion no carga muestra el lote de pendientes (lo de antes)', async () => {
    fixture = TestBed.createComponent(CorreosEmpresasComponent);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne(`${BASE}/correos/config`).flush({ error: 'caido' }, { status: 503, statusText: 'x' });
    http.expectOne((r) => r.url === URL_LOTE).flush(PREVIEW);
    expect(texto()).toContain('Lote de hoy');
  });

  it('un backend sin la clave resumenDiario cuenta como activado (defecto acordado)', async () => {
    const { resumenDiario: _sinClave, ...viejo } = CONFIG;
    await montar(viejo);
    expect(fixture.componentInstance.resumenDiario).toBeTrue();
    expect(texto()).toContain('A las 19:00 sale solo el resumen del día');
  });

  it('con el resumen automatico apagado pide enviarlo a mano', async () => {
    await montar({ ...CONFIG, resumenDiario: false });
    expect(fixture.componentInstance.resumenDiario).toBeFalse();
    expect(texto()).toContain('El resumen automático está apagado');
  });

  it('si ultimaCorrida es hoy avisa que el resumen ya salio', async () => {
    await montar({ ...CONFIG, ultimaCorrida: hoyIso() });
    expect(fixture.componentInstance.resumenYaSalioHoy()).toBeTrue();
    expect(texto()).toContain('El resumen de hoy ya salió');
  });

  it('la configuracion nombra los dos modos y la casilla del resumen solo en INMEDIATO', async () => {
    await montar(CONFIG);
    let t = await irAConfiguracion();

    expect(t).toContain('Automático al registrar + resumen del día');
    expect(t).toContain('Solo lote diario automático (19:00)');
    expect(t).toContain('Enviar el resumen automáticamente a las 19:00');

    fixture.componentInstance.modoEnvio = 'DIARIO';
    fixture.componentInstance.tab.set(1);
    // OnPush: el campo plano no avisa; se fuerza con un signal que la vista lee.
    fixture.componentInstance.config.set({ ...CONFIG });
    t = texto();
    expect(t).not.toContain('Enviar el resumen automáticamente');
  });

  it('guardar manda resumenDiario y, al pasar a DIARIO, vuelve a pedir el lote', async () => {
    const swal = spyOn(swalEspiable(), 'fire').and.returnValue(Promise.resolve({}));
    await montar(CONFIG);
    localStorage.setItem('user', JSON.stringify({ email: 'nathalia@tuapo.co' }));
    const comp = fixture.componentInstance;
    comp.modoEnvio = 'DIARIO';
    comp.resumenDiario = false;

    comp.guardarConfig();
    const put = http.expectOne(`${BASE}/correos/config`);
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({
      envioModo: 'DIARIO', envioHora: '19:00', ventanaDias: 3, resumenDiario: false, actor: 'nathalia@tuapo.co',
    });
    put.flush({ ...CONFIG, envioModo: 'DIARIO', resumenDiario: false });

    http.expectOne((r) => r.url === URL_LOTE).flush(PREVIEW);
    http.expectNone((r) => r.url === URL_RESUMEN);
    expect(swal).toHaveBeenCalled();
    expect(texto()).toContain('Lote de hoy');
    localStorage.removeItem('user');
  });

  it('"Enviar resumen del día ahora" confirma, llama al endpoint nuevo y recarga config y resumen', async () => {
    const swal = spyOn(swalEspiable(), 'fire').and.returnValue(Promise.resolve({ isConfirmed: true }));
    await montar(CONFIG, PREVIEW_CON_UNA);

    fixture.componentInstance.enviarResumenAhora();
    const confirmacion = swal.calls.mostRecent().args[0] as { title: string; html: string };
    expect(confirmacion.title).toBe('Enviar resumen del día');
    expect(confirmacion.html).toContain('Solo se adjuntan los soportes que no salieron');
    expect(confirmacion.html).toContain('Modo prueba');
    await microtareas();

    const post = http.expectOne(`${BASE}/correos/resumen/enviar`);
    expect(post.request.method).toBe('POST');
    http.expectNone(`${BASE}/correos/lotes/enviar`);
    const resultado: ResultadoEnvioLote = {
      fecha: '2026-10-07', grupos: 1, enviados: 1, fallidos: 0, sinDestinatario: 0, incapacidades: 1, lotes: [],
    };
    post.flush(resultado);

    // Recarga la configuracion (trae la nueva ultimaCorrida) y con ella el resumen.
    http.expectOne(`${BASE}/correos/config`).flush({ ...CONFIG, ultimaCorrida: hoyIso() });
    http.expectOne((r) => r.url === URL_RESUMEN).flush(PREVIEW_CON_UNA);
    expect(fixture.componentInstance.resumenYaSalioHoy()).toBeTrue();
    expect((swal.calls.mostRecent().args[0] as { title: string }).title).toBe('Resumen enviado');
  });

  it('con el resumen automatico apagado la confirmacion no promete evitar el envio de la hora', async () => {
    const swal = spyOn(swalEspiable(), 'fire').and.returnValue(Promise.resolve({ isConfirmed: false }));
    await montar({ ...CONFIG, resumenDiario: false }, PREVIEW_CON_UNA);

    fixture.componentInstance.enviarResumenAhora();
    const html = (swal.calls.mostRecent().args[0] as { html: string }).html;
    expect(html).not.toContain('ya no sale solo');
    await microtareas();
    http.expectNone(`${BASE}/correos/resumen/enviar`);

    // Con el automatico encendido si se avisa.
    fixture.componentInstance.config.set({ ...CONFIG, resumenDiario: true });
    fixture.componentInstance.enviarResumenAhora();
    expect((swal.calls.mostRecent().args[0] as { html: string }).html).toContain('Después ya no sale solo a las 19:00');
    await microtareas();
  });

  it('la vista previa del resumen no lista adjuntos (solo salen los que no se enviaron)', async () => {
    await montar(CONFIG, PREVIEW_CON_UNA);
    const dialogo = TestBed.inject(MatDialog) as unknown as { open: jasmine.Spy };

    fixture.componentInstance.verGrupo(PREVIEW_CON_UNA.grupos[0]);
    const datos = dialogo.open.calls.mostRecent().args[1].data as { titulo: string; referencia: string; adjuntos: unknown };
    expect(datos.titulo).toBe('Resumen del día a BELCHITE');
    expect(datos.referencia).toBe('resumen del día, vista previa');
    expect(datos.adjuntos).toBeNull();
  });
});
