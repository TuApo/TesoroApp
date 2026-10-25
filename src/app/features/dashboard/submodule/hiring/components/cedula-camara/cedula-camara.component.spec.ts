import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import Swal from 'sweetalert2';
import { CedulaCamaraComponent } from './cedula-camara.component';
import { CedulaCamaraService, FalloCedulaCamara } from './cedula-camara.service';
import { CedulaArmada } from './cedula-camara.util';

describe('CedulaCamaraComponent', () => {
  let fixture: ComponentFixture<CedulaCamaraComponent>;
  let comp: CedulaCamaraComponent;
  let dialog: jasmine.SpyObj<MatDialog>;
  let svc: jasmine.SpyObj<CedulaCamaraService>;
  let swal: jasmine.Spy;

  const jpg = (n: string) => new File([new Uint8Array([0xff, 0xd8, 0xff])], n, { type: 'image/jpeg' });
  const cerrarCon = (valor: unknown) => dialog.open.and.returnValue({ afterClosed: () => of(valor) } as any);

  beforeEach(async () => {
    dialog = jasmine.createSpyObj('MatDialog', ['open']);
    svc = jasmine.createSpyObj('CedulaCamaraService', ['subirYArmar']);
    swal = spyOn(Swal, 'fire').and.returnValue(Promise.resolve({} as any));

    await TestBed.configureTestingModule({
      imports: [CedulaCamaraComponent],
      providers: [
        { provide: MatDialog, useValue: dialog },
        { provide: CedulaCamaraService, useValue: svc },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CedulaCamaraComponent);
    comp = fixture.componentInstance;
  });

  it('sin persona avisa y no abre la cámara', async () => {
    fixture.componentRef.setInput('cedula', '  ');
    await comp.tomar();
    expect(dialog.open).not.toHaveBeenCalled();
    expect(swal).toHaveBeenCalled();
  });

  it('abre el escáner en modo cédula con salida en imágenes, sube y avisa con la hoja', async () => {
    const caras = { frente: jpg('f.jpg'), reverso: jpg('r.jpg') };
    const armada: CedulaArmada = { cedula: 'X9999001', id: 900, estado: 'CREADA' };
    cerrarCon(caras);
    svc.subirYArmar.and.returnValue(Promise.resolve(armada));
    fixture.componentRef.setInput('cedula', 'X9999001');
    fixture.componentRef.setInput('nombreDocumento', 'Cédula de extranjería');

    const listos: CedulaArmada[] = [];
    const ocupado: boolean[] = [];
    comp.listo.subscribe(a => listos.push(a));
    comp.ocupado.subscribe(o => ocupado.push(o));

    await comp.tomar();

    const cfg = dialog.open.calls.mostRecent().args[1] as any;
    expect(cfg.data).toEqual(jasmine.objectContaining({ modo: 'cedula', salida: 'imagenes', docName: 'Cédula de extranjería' }));
    expect(svc.subirYArmar).toHaveBeenCalledWith('X9999001', caras, jasmine.any(Function));
    expect(listos).toEqual([armada]);
    expect(ocupado).toEqual([true, false]);
    expect(comp.trabajando()).toBeFalse();
    // La tarjeta de Contratación avisa por su cuenta: aquí no se repite.
    expect(swal).not.toHaveBeenCalled();
  });

  it('con avisarExito (la ficha) muestra él mismo el "listo"', async () => {
    cerrarCon({ frente: jpg('f.jpg'), reverso: jpg('r.jpg') });
    svc.subirYArmar.and.returnValue(Promise.resolve({ cedula: '123', id: 1, estado: 'CREADA' }));
    fixture.componentRef.setInput('cedula', '123');
    fixture.componentRef.setInput('avisarExito', true);

    await comp.tomar();

    expect((swal.calls.mostRecent().args[0] as any).icon).toBe('success');
  });

  it('si se cierra el escáner sin terminar no sube nada ni muestra error', async () => {
    cerrarCon(undefined);
    fixture.componentRef.setInput('cedula', '123');
    await comp.tomar();
    expect(svc.subirYArmar).not.toHaveBeenCalled();
    expect(swal).not.toHaveBeenCalled();
  });

  it('un fallo dice en qué paso quedó y libera el botón', async () => {
    cerrarCon({ frente: jpg('f.jpg'), reverso: jpg('r.jpg') });
    svc.subirYArmar.and.returnValue(Promise.reject(new FalloCedulaCamara('reverso', { status: 500 })));
    fixture.componentRef.setInput('cedula', '123');
    const ocupado: boolean[] = [];
    comp.ocupado.subscribe(o => ocupado.push(o));

    await comp.tomar();

    const texto = String((swal.calls.mostRecent().args[0] as any).text);
    expect(texto).toContain('El frente quedó guardado');
    expect(ocupado).toEqual([true, false]);
    expect(comp.trabajando()).toBeFalse();
  });
});
