/**
 * Prueba de RENDER de la tabla (con TestBed, a diferencia del resto de specs del
 * submódulo, que son de lógica pura).
 *
 * Existe por un fallo real en producción: se renombraron columnas en el HTML
 * pero quedó un id huérfano en `displayedColumns`. MatTable lanza
 * "Could not find column with id ..." y deja la tabla COMPLETAMENTE vacía,
 * aunque el contador siga diciendo "4 cuenta(s)". Ninguna prueba sin TestBed
 * puede detectar eso: hay que montar el componente.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';

import { CorreosElectronicosComponent } from './correos-electronicos.component';
import { CorreosService } from '../../services/correos.service';
import { CorreoCuenta, CuotaResumen } from '../../models/correo-cuenta.model';

function cuenta(over: Partial<CorreoCuenta> = {}): CorreoCuenta {
  return {
    id: 'id-1',
    direccion: 'correspondencia.tuapo01@apoyolaboralts.com',
    nombre_mostrar: 'Correspondencia TuApo',
    proveedor: 'SMTP_PROPIO',
    proposito: 'Envios masivos',
    smtp_host: 'smtp-relay.gmail.com',
    smtp_port: 587,
    smtp_usuario: null,
    cuota_diaria: 1500,
    limite_efectivo: 1350,
    umbral_corte_pct: 90,
    enviados_hoy: 0,
    disponible_hoy: 1350,
    estado_verificacion: 'VERIFICADA',
    ultima_verificacion: '2026-08-04T16:48:00Z',
    mensaje_ultima_verificacion: null,
    activo: true,
    notas: null,
    credencial_configurada: false,
    aporta_cuota: true,
    creado_por: null,
    creado_en: '2026-08-04T03:23:00Z',
    actualizado_por: null,
    actualizado_en: null,
    ...over,
  };
}

const RESUMEN: CuotaResumen = {
  cuentas_activas: 4,
  cuentas_verificadas: 4,
  cuota_total: 6000,
  limite_efectivo_total: 5400,
  umbral_corte_pct: 90,
  enviados_hoy: 0,
  disponible_hoy: 5400,
};

describe('CorreosElectronicos — render de la tabla', () => {
  let fixture: ComponentFixture<CorreosElectronicosComponent>;
  let componente: CorreosElectronicosComponent;

  const filas = [
    cuenta({ id: '1', direccion: 'correspondencia.tuapo01@apoyolaboralts.com' }),
    cuenta({ id: '2', direccion: 'correspondencia.tuapo02@apoyolaboralts.com' }),
    cuenta({ id: '3', direccion: 'correspondencia.tuapo03@apoyolaboralts.com', enviados_hoy: 200, disponible_hoy: 1150 }),
    cuenta({ id: '4', direccion: 'correspondencia.tuapo04@apoyolaboralts.com' }),
  ];

  beforeEach(async () => {
    const servicio: Partial<CorreosService> = {
      listar: () => of(filas),
      resumenCuota: () => of(RESUMEN),
    };

    await TestBed.configureTestingModule({
      imports: [CorreosElectronicosComponent, NoopAnimationsModule],
      providers: [{ provide: CorreosService, useValue: servicio }],
    }).compileComponents();

    fixture = TestBed.createComponent(CorreosElectronicosComponent);
    componente = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => componente.ngOnDestroy());

  it('pinta una fila por cuenta (no una tabla vacía)', () => {
    const filasDom = fixture.nativeElement.querySelectorAll('tr[mat-row]');
    expect(filasDom.length).withContext('la tabla debe pintar las 4 cuentas').toBe(4);
  });

  it('cada columna declarada tiene su definición en el HTML', () => {
    const encabezados = fixture.nativeElement.querySelectorAll('th[mat-header-cell]');
    expect(encabezados.length)
      .withContext('displayedColumns y los matColumnDef del HTML deben cuadrar')
      .toBe(componente.displayedColumns.length);
  });

  it('muestra el consumo real y el disponible restante', () => {
    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('Enviados hoy');
    expect(texto).toContain('Disponible');
    expect(texto).withContext('el restante de la cuenta que ya envió 200').toMatch(/1[.,]150/);
  });

  it('pinta los indicadores con los datos del resumen', () => {
    const texto = fixture.nativeElement.textContent as string;
    // El separador de miles depende del locale (es: 6.000 / en: 6,000): se acepta cualquiera.
    expect(texto).withContext('disponible declarado').toMatch(/6[.,]000/);
    expect(texto).withContext('disponible hoy').toMatch(/5[.,]400/);
    expect(texto).toContain('corte al 90%');
  });
});
