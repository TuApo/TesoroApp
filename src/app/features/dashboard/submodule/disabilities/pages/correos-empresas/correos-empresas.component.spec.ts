import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { environment } from '@/environments/environment';
import {
  CorreosEmpresasComponent,
  agruparDirectorio,
  claseEstadoEnvio,
  filtrarDirectorio,
} from './correos-empresas.component';
import { CorreoConfig, CorreoEmpresa, LotePreview } from '../../models/incapacidad-gestion.model';

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
// Textos del modo acordado en la reunion 2026-10-05 (sin cambios de logica)
// ─────────────────────────────────────────────────────────────────────────

describe('CorreosEmpresasComponent (textos del modo de envio)', () => {
  let fixture: ComponentFixture<CorreosEmpresasComponent>;
  let http: HttpTestingController;
  const BASE = `${environment.apiUrl}/Incapacidades/v2`;

  const CONFIG: CorreoConfig = {
    envioModo: 'INMEDIATO',
    envioHora: '19:00',
    ventanaDias: 3,
    ultimaCorrida: '2026-10-05',
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

  async function montar(config: CorreoConfig): Promise<HTMLElement> {
    fixture = TestBed.createComponent(CorreosEmpresasComponent);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne(`${BASE}/correos/config`).flush(config);
    http.expectOne((r) => r.url === `${BASE}/correos/lotes/previsualizar`).flush(PREVIEW);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
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

  it('en INMEDIATO explica el automatico al registrar + lote manual y el boton envia el lote del dia', async () => {
    const html = await montar(CONFIG);
    const texto = html.textContent ?? '';

    expect(texto).toContain('automático al registrar + lote manual');
    expect(texto).toContain('Enviar lote del día (pendientes)');
    expect(texto).not.toContain('Enviar correos de hoy ahora');
  });

  it('en DIARIO explica que solo sale el lote diario automatico', async () => {
    const html = await montar({ ...CONFIG, envioModo: 'DIARIO' });
    expect(html.textContent ?? '').toContain('solo lote diario automático');
  });

  it('la configuracion nombra los dos modos acordados', async () => {
    await montar(CONFIG);
    fixture.componentInstance.cambiarTab(1);
    fixture.detectChanges();
    await fixture.whenStable();
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(texto).toContain('Automático al registrar + lote manual');
    expect(texto).toContain('Solo lote diario automático (19:00)');
  });
});
