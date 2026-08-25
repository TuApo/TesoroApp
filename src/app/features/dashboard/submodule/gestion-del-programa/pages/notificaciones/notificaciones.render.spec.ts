/**
 * Prueba de RENDER de las dos tablas (con TestBed).
 *
 * Existe por el mismo fallo que cubre la de Correos electrónicos: basta un id en
 * `columnasReglas`/`columnasTipos` sin su `matColumnDef` en el HTML para que
 * MatTable lance "Could not find column with id …" y deje la tabla
 * COMPLETAMENTE vacía, aunque el contador siga diciendo el número correcto.
 * Ninguna prueba de lógica pura detecta eso: hay que montar el componente.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatTabGroup } from '@angular/material/tabs';
import { of } from 'rxjs';
import Swal from 'sweetalert2';

import { NotificacionesComponent } from './notificaciones.component';
import { NotificacionesConfigService } from '../../services/notificaciones-config.service';
import { NotificationType, NotifRegla } from '../../models/notificacion-config.model';

function tipo(over: Partial<NotificationType> = {}): NotificationType {
  return {
    id: 'tipo-1',
    clave: 'MATDER_ASSIGNMENT',
    nombre: 'Matder · Asignación',
    descripcion: null,
    icono: 'assignment_ind',
    color: '#2563eb',
    urgencia_default: 'INFO',
    modulo_id: null,
    agrupable: false,
    activo: true,
    orden: 1,
    ...over,
  };
}

function regla(over: Partial<NotifRegla> = {}): NotifRegla {
  return {
    id: 'regla-1',
    evento_clave: 'matder.assignment',
    tipo_id: 'tipo-1',
    tipo_clave: 'MATDER_ASSIGNMENT',
    nombre: 'Matder · Asignación de tarjeta',
    descripcion: 'Puente de doble escritura',
    activo: true,
    condicion_json: null,
    audiencia_modo: 'PAYLOAD',
    audiencia_json: null,
    excluir_actor: false,
    canales: ['IN_APP'],
    plantilla_titulo: '{{titulo}}',
    plantilla_mensaje: '{{mensaje}}',
    destino_tipo: 'RUTA',
    destino_valor: 'matder/{{link}}',
    dedup_ventana_min: null,
    urgencia: null,
    urgencia_efectiva: 'INFO',
    creado_en: '2026-08-19T14:00:00Z',
    actualizado_en: null,
    ...over,
  };
}

describe('Notificaciones — render de las tablas', () => {
  let fixture: ComponentFixture<NotificacionesComponent>;
  let componente: NotificacionesComponent;
  let alternarActivo: jasmine.Spy;

  const tipos = [
    tipo({ id: 'tipo-1' }),
    tipo({ id: 'tipo-2', clave: 'COMUNICADO', nombre: 'Comunicado', urgencia_default: 'IMPORTANTE' }),
  ];
  const reglas = [
    regla({ id: 'regla-1' }),
    regla({ id: 'regla-2', nombre: 'Aviso general', activo: false,
            audiencia_modo: 'ROLES', audiencia_json: '["r1","r2"]',
            canales: ['IN_APP', 'EMAIL'], urgencia_efectiva: 'URGENTE' }),
    regla({ id: 'regla-3', nombre: 'A toda la empresa', audiencia_modo: 'TODOS' }),
  ];

  beforeEach(async () => {
    alternarActivo = jasmine.createSpy('alternarActivo')
      .and.callFake((id: string, activo: boolean) => of(regla({ id, activo })));

    const servicio: Partial<NotificacionesConfigService> = {
      listarTipos: () => of(tipos),
      listarReglas: () => of(reglas),
      listarEventos: () => of(['matder.assignment']),
      alternarActivo,
    };

    await TestBed.configureTestingModule({
      imports: [NotificacionesComponent, NoopAnimationsModule],
      providers: [{ provide: NotificacionesConfigService, useValue: servicio }],
    }).compileComponents();

    fixture = TestBed.createComponent(NotificacionesComponent);
    componente = fixture.componentInstance;
    fixture.detectChanges();
  });

  /**
   * Cada tabla se busca por su clase propia y no por posición: MatTabBody monta
   * solo la pestaña ACTIVA y desmonta la anterior, así que el índice dentro de
   * `table.nt-tabla` cambia según qué pestaña esté abierta.
   */
  function tabla(clase: 'reglas' | 'tipos'): HTMLElement | null {
    return fixture.nativeElement.querySelector(`table.nt-tabla-${clase}`) as HTMLElement | null;
  }

  /** La tabla de tipos no existe en el DOM hasta que se abre su pestaña. */
  async function abrirPestana(indice: number): Promise<void> {
    const grupo = fixture.debugElement.query(By.directive(MatTabGroup))
      .componentInstance as MatTabGroup;
    grupo.selectedIndex = indice;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('pinta una fila por regla (no una tabla vacía)', () => {
    expect(tabla('reglas')!.querySelectorAll('tr[mat-row]').length)
      .withContext('las 3 reglas').toBe(3);
  });

  it('cada columna de reglas declarada tiene su definición en el HTML', () => {
    expect(tabla('reglas')!.querySelectorAll('th[mat-header-cell]').length)
      .withContext('columnasReglas y los matColumnDef deben cuadrar')
      .toBe(componente.columnasReglas.length);
  });

  it('pinta una fila por tipo y cuadra sus columnas', async () => {
    await abrirPestana(1);
    const tablaTipos = tabla('tipos');
    expect(tablaTipos).withContext('la pestaña de tipos debe montar su tabla').toBeTruthy();
    expect(tablaTipos!.querySelectorAll('tr[mat-row]').length).toBe(2);
    expect(tablaTipos!.querySelectorAll('th[mat-header-cell]').length)
      .withContext('columnasTipos y los matColumnDef deben cuadrar')
      .toBe(componente.columnasTipos.length);
  });

  it('los indicadores cuentan solo lo activo', () => {
    expect(componente.reglasActivas).withContext('regla-2 está desactivada').toBe(2);
    expect(componente.tiposActivos).toBe(2);
    expect(componente.eventosCubiertos).withContext('las 3 reglas comparten evento').toBe(1);
    expect(componente.reglasConCorreo)
      .withContext('regla-2 manda correo pero está desactivada').toBe(0);
  });

  it('resume la audiencia con su tamaño y destaca el alcance total', () => {
    expect(componente.audienciaDe(reglas[1])).toContain('(2)');
    expect(componente.audienciaDe(reglas[2])).toBe('Toda la organización');
    expect(fixture.nativeElement.textContent).toContain('Toda la organización');
  });

  it('una audiencia por ids sin seleccionar se marca, no se pinta como vacía', () => {
    expect(componente.audienciaDe(regla({ audiencia_modo: 'ROLES', audiencia_json: null })))
      .toContain('sin seleccionar');
  });

  describe('activar una regla', () => {
    /** El toggle real; solo interesa su `checked`, que es lo que ve el usuario. */
    function toggleFalso(checked: boolean): MatSlideToggle {
      return { checked } as MatSlideToggle;
    }

    it('pide confirmación antes de encender', async () => {
      const fire = spyOn(Swal, 'fire').and.resolveTo({ isConfirmed: true } as never);

      await componente.alternar(reglas[1], true, toggleFalso(true));

      expect(fire).toHaveBeenCalled();
      expect(alternarActivo).toHaveBeenCalledWith('regla-2', true);
    });

    it('cancelar devuelve el interruptor a su sitio y no llama al backend', async () => {
      // El binding [checked] es de una sola vía y su valor no cambia al cancelar,
      // así que sin revertirlo a mano el interruptor se queda encendido mintiendo.
      spyOn(Swal, 'fire').and.resolveTo({ isConfirmed: false } as never);
      const toggle = toggleFalso(true);

      await componente.alternar(reglas[1], true, toggle);

      expect(toggle.checked).withContext('regla-2 sigue desactivada').toBe(false);
      expect(alternarActivo).not.toHaveBeenCalled();
    });

    it('apagar no pide confirmación: siempre es la salida segura', async () => {
      const fire = spyOn(Swal, 'fire');

      await componente.alternar(reglas[0], false, toggleFalso(false));

      expect(fire).not.toHaveBeenCalled();
      expect(alternarActivo).toHaveBeenCalledWith('regla-1', false);
    });

    it('avisa del alcance cuando la audiencia es toda la organización', async () => {
      const fire = spyOn(Swal, 'fire').and.resolveTo({ isConfirmed: false } as never);

      await componente.alternar(reglas[2], true, toggleFalso(true));

      const opciones = fire.calls.mostRecent().args[0] as unknown as { html: string };
      const html = opciones.html;
      expect(html).toContain('toda la organización');
    });
  });
});
