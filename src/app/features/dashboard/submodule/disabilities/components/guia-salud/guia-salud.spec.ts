import { GUIAS_SALUD, guiasDelNivel } from './guia-salud.contenido';
import { pantallaDeRuta } from './guia-salud.modelo';
import { pasosDelRecorrido, pasosParaUsuario } from './guia-salud.component';
import { iniciarRecorrido, pasosVisibles } from './recorrido-guiado';
import {
  celdaDelDia,
  condicionCumplida,
  ejecutarAcciones,
  elegirOpcion,
  opcionesDesplegadas,
  vigilarCondicion,
} from './simulacion';

/** Espera (hasta `ms`) a que la condicion se cumpla: la simulacion trabaja con promesas y timers. */
async function hastaQue(condicion: () => boolean, ms = 3000): Promise<void> {
  const limite = Date.now() + ms;
  while (!condicion() && Date.now() < limite) {
    await new Promise((r) => setTimeout(r, 20));
  }
  expect(condicion()).toBeTrue();
}

const tarjeta = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-recorrido="tarjeta"]');
const botonDeTarjeta = (texto: string): HTMLButtonElement | undefined =>
  Array.from(tarjeta()?.querySelectorAll('button') ?? []).find((b) => b.textContent === texto);
const estado = (): string => document.querySelector('[data-recorrido="estado"]')?.textContent ?? '';
const tapaVisible = (): boolean => {
  const t = document.querySelector<HTMLElement>('[data-recorrido="tapa"]');
  return !!t && t.style.display !== 'none';
};

describe('guia de Salud (reunion 2026-10-20)', () => {
  it('reconoce la pantalla por la URL, con las hijas antes que la padre', () => {
    expect(pantallaDeRuta('/dashboard/disabilities/registro')).toBe('registro');
    expect(pantallaDeRuta('/dashboard/disabilities/registro/55505')).toBe('registro');
    expect(pantallaDeRuta('/dashboard/disabilities/consulta?cedula=1')).toBe('consulta');
    expect(pantallaDeRuta('/dashboard/disabilities/radicacion/recobro')).toBe('recobro');
    expect(pantallaDeRuta('/dashboard/disabilities/radicacion')).toBe('radicacion');
    expect(pantallaDeRuta('/dashboard/disabilities/liquidacion/pagos')).toBe('pagos');
    expect(pantallaDeRuta('/dashboard/disabilities/liquidacion/negaciones')).toBe('negaciones');
    expect(pantallaDeRuta('/dashboard/disabilities/liquidacion')).toBe('liquidacion');
    expect(pantallaDeRuta('/dashboard/hiring/pipeline')).toBeNull();
    expect(pantallaDeRuta(null)).toBeNull();
  });

  it('cada nivel ve solo las guias de sus pantallas', () => {
    expect(guiasDelNivel('N1').map((g) => g.clave)).toEqual(['registro', 'consulta', 'correos']);
    expect(guiasDelNivel('N4').map((g) => g.clave)).toEqual(['consulta', 'correos']);
    const n2 = guiasDelNivel('N2').map((g) => g.clave);
    expect(n2).toContain('radicacion');
    expect(n2).toContain('sevenet');
    expect(n2).not.toContain('liquidacion');
    expect(guiasDelNivel('N3').map((g) => g.clave)).toContain('liquidacion');
    expect(guiasDelNivel('TODOS').length).toBe(12);
    expect(guiasDelNivel(null).length).toBe(12);
  });

  it('el registro del nivel 1 no menciona el panel de validacion ni la informacion completa', () => {
    const simple = pasosParaUsuario(GUIAS_SALUD.registro, true).map((p) => p.ancla);
    const completo = pasosParaUsuario(GUIAS_SALUD.registro, false).map((p) => p.ancla);
    expect(simple).not.toContain('validacion');
    expect(completo).toContain('validacion');
    expect(simple).toContain('entidad');
    expect(simple.filter((a) => a === 'personal').length).toBe(1);
  });

  it('todas las pantallas tienen recorrido y ninguna simulacion guarda, aplica, envia ni descarga', () => {
    for (const g of Object.values(GUIAS_SALUD)) {
      expect(g.pasos.some((p) => !!p.ancla)).withContext(g.clave).toBeTrue();
      for (const p of g.pasos) {
        for (const a of p.acciones ?? []) {
          if (a.tipo === 'clic') {
            expect(a.selector ?? '').withContext(`${g.clave}: ${p.titulo}`).not.toMatch(/guardar|aplicar|enviar|exportar|descargar|generar|anular/i);
          }
        }
        if (p.listo) expect(p.practica).withContext(`${g.clave}: ${p.titulo}`).toBeTruthy();
      }
    }
    const registro = pasosDelRecorrido(GUIAS_SALUD.registro.pasos);
    expect(registro.find((p) => p.ancla === 'guardar')?.acciones).toBeUndefined();
    expect(registro.find((p) => p.ancla === 'busqueda')?.acciones?.length).toBeGreaterThan(0);
  });

  describe('simulacion sobre el DOM', () => {
    let raiz: HTMLDivElement;
    let overlay: HTMLDivElement;

    beforeEach(() => {
      raiz = document.createElement('div');
      raiz.innerHTML =
        '<div data-guia="campo"><input id="texto"><textarea id="area"></textarea></div>' +
        '<div data-guia="lista"><mat-select><div class="mat-mdc-select-trigger">abrir</div></mat-select></div>' +
        '<div data-guia="boton"><button id="b1">uno</button></div>' +
        '<input id="vecino">';
      overlay = document.createElement('div');
      overlay.className = 'cdk-overlay-container';
      document.body.append(raiz, overlay);
    });

    afterEach(() => {
      raiz.remove();
      overlay.remove();
    });

    it('escribe como el teclado: valor + evento input, en el campo del ancla o en uno vecino (@)', async () => {
      const campo = raiz.querySelector<HTMLElement>('[data-guia="campo"]') as HTMLElement;
      const texto = raiz.querySelector<HTMLInputElement>('#texto') as HTMLInputElement;
      let eventos = 0;
      texto.addEventListener('input', () => eventos++);
      const r = await ejecutarAcciones(document, campo, [{ tipo: 'escribir', valor: 'MAR' }], { msPorLetra: 0 });
      expect(r.completo).toBeTrue();
      expect(texto.value).toBe('MAR');
      expect(eventos).toBe(1);
      await ejecutarAcciones(document, campo, [{ tipo: 'escribir', selector: 'textarea', valor: 'ok' }], { msPorLetra: 0 });
      expect((raiz.querySelector('#area') as HTMLTextAreaElement).value).toBe('ok');
      await ejecutarAcciones(document, campo, [{ tipo: 'escribir', selector: '@#vecino', valor: 'v' }], { msPorLetra: 0 });
      expect((raiz.querySelector('#vecino') as HTMLInputElement).value).toBe('v');
    });

    it('hace clic donde Material escucha (el trigger del mat-select) y elige la opcion desplegada', async () => {
      const lista = raiz.querySelector<HTMLElement>('[data-guia="lista"]') as HTMLElement;
      let abierto = 0;
      lista.querySelector('.mat-mdc-select-trigger')?.addEventListener('click', () => {
        abierto++;
        overlay.innerHTML =
          '<mat-option aria-disabled="true">Buscando…</mat-option>' +
          '<mat-option id="o1">Enfermedad general</mat-option>' +
          '<mat-option id="o2">Accidente de trabajo</mat-option>';
      });
      let elegida = '';
      overlay.addEventListener('click', (e) => (elegida = (e.target as HTMLElement).id));
      const r = await ejecutarAcciones(
        document,
        lista,
        [{ tipo: 'clic', selector: 'mat-select' }, { tipo: 'opcion', contiene: ['ACCIDENTE'] }],
        { msPorLetra: 0 },
      );
      expect(r.completo).toBeTrue();
      expect(abierto).toBe(1);
      expect(elegida).toBe('o2');
      expect(opcionesDesplegadas(document).length).toBe(2);
      expect(elegirOpcion(opcionesDesplegadas(document), ['nada'], true)?.id).toBe('o1');
      expect(elegirOpcion(opcionesDesplegadas(document), ['nada'], false)).toBeNull();
    });

    it('si no aparece lo esperado, se detiene y explica por que', async () => {
      const boton = raiz.querySelector<HTMLElement>('[data-guia="boton"]') as HTMLElement;
      const r = await ejecutarAcciones(document, boton, [{ tipo: 'esperar', selector: '#no-existe', ms: 60 }], { msPorLetra: 0 });
      expect(r.completo).toBeFalse();
      expect(r.motivo).toContain('No apareció');
      const r2 = await ejecutarAcciones(document, boton, [{ tipo: 'clic', selector: '#tampoco' }], { msPorLetra: 0 });
      expect(r2.motivo).toContain('clic');
    });

    it('encuentra el dia en el calendario abierto', () => {
      overlay.innerHTML =
        '<mat-calendar><button class="mat-calendar-body-cell" aria-disabled="true"><span class="mat-calendar-body-cell-content">1</span></button>' +
        '<button class="mat-calendar-body-cell" id="d3"><span class="mat-calendar-body-cell-content">3</span></button></mat-calendar>';
      expect(celdaDelDia(document, 3)?.id).toBe('d3');
      expect(celdaDelDia(document, 1)).toBeNull();
      expect(celdaDelDia(document, 9)).toBeNull();
    });

    it('sabe cuando la persona ya lo hizo: valor, aparece y clic', () => {
      const campo = raiz.querySelector<HTMLElement>('[data-guia="campo"]') as HTMLElement;
      const boton = raiz.querySelector<HTMLElement>('[data-guia="boton"]') as HTMLElement;
      expect(condicionCumplida(document, campo, { tipo: 'valor' }, new Set())).toBeFalse();
      (raiz.querySelector('#texto') as HTMLInputElement).value = 'x';
      expect(condicionCumplida(document, campo, { tipo: 'valor' }, new Set())).toBeTrue();
      expect(condicionCumplida(document, campo, { tipo: 'aparece', selector: '#b1' }, new Set())).toBeTrue();
      expect(condicionCumplida(document, campo, { tipo: 'aparece', selector: '#nada' }, new Set())).toBeFalse();
      const b1 = raiz.querySelector('#b1') as HTMLElement;
      expect(condicionCumplida(document, boton, { tipo: 'clic' }, new Set([b1]))).toBeTrue();
      expect(condicionCumplida(document, boton, { tipo: 'clic', selector: '#b1' }, new Set())).toBeFalse();
    });

    it('vigila la condicion y avisa una sola vez cuando se cumple', () => {
      const campo = raiz.querySelector<HTMLElement>('[data-guia="campo"]') as HTMLElement;
      const texto = raiz.querySelector<HTMLInputElement>('#texto') as HTMLInputElement;
      let avisos = 0;
      const parar = vigilarCondicion(document, campo, { tipo: 'valor' }, () => avisos++);
      expect(avisos).toBe(0);
      texto.value = 'listo';
      texto.dispatchEvent(new Event('input', { bubbles: true }));
      texto.dispatchEvent(new Event('input', { bubbles: true }));
      expect(avisos).toBe(1);
      parar();
    });
  });

  describe('recorrido guiado', () => {
    let raiz: HTMLDivElement;

    beforeEach(() => {
      raiz = document.createElement('div');
      raiz.innerHTML =
        '<div data-guia="uno" style="height:40px"><input id="campo-uno"></div>' +
        '<div data-guia="oculto" style="display:none">x</div>' +
        '<div data-guia="dos" style="height:40px"><button id="abre">abre</button></div>';
      document.body.appendChild(raiz);
    });

    afterEach(() => {
      raiz.remove();
      document.querySelectorAll('[data-recorrido]').forEach((e) => e.remove());
      document.body.removeAttribute('data-guia-simulacion');
    });

    it('salta las anclas que no existen o no se ven', () => {
      const pasos = pasosVisibles(document, [
        { ancla: 'uno', titulo: 'Uno', texto: '' },
        { ancla: 'oculto', titulo: 'Oculto', texto: '' },
        { ancla: 'no-existe', titulo: 'Nada', texto: '' },
        { ancla: 'dos', titulo: 'Dos', texto: '' },
      ]);
      expect(pasos.map((p) => p.ancla)).toEqual(['uno', 'dos']);
    });

    it('pinta la tarjeta, avanza y al terminar limpia todo y avisa', () => {
      let terminado = false;
      iniciarRecorrido(
        document,
        [
          { ancla: 'uno', titulo: 'Primero', texto: 'texto 1' },
          { ancla: 'dos', titulo: 'Segundo', texto: 'texto 2' },
        ],
        () => (terminado = true),
      );
      expect(tarjeta()?.textContent).toContain('Paso 1 de 2');
      expect(tarjeta()?.textContent).toContain('Primero');
      expect(document.body.getAttribute('data-guia-simulacion')).toBe('ver');
      expect(tapaVisible()).toBeTrue();
      botonDeTarjeta('Siguiente')?.click();
      expect(tarjeta()?.textContent).toContain('Paso 2 de 2');
      botonDeTarjeta('Terminar')?.click();
      expect(document.querySelector('[data-recorrido="capa"]')).toBeNull();
      expect(document.body.hasAttribute('data-guia-simulacion')).toBeFalse();
      expect(terminado).toBeTrue();
    });

    it('al salir avisa que NO se completo', () => {
      let resultado: boolean | null = null;
      iniciarRecorrido(document, [{ ancla: 'uno', titulo: 'x', texto: '' }], { alTerminar: (c) => (resultado = c) });
      botonDeTarjeta('Salir')?.click();
      expect(resultado as boolean | null).toBeFalse();
      expect(document.querySelector('[data-recorrido="tarjeta"]')).toBeNull();
    });

    it('sin pasos visibles no pinta nada', () => {
      const cerrar = iniciarRecorrido(document, [{ ancla: 'no-existe', titulo: 'x', texto: '' }]);
      expect(document.querySelector('[data-recorrido="capa"]')).toBeNull();
      expect(() => cerrar()).not.toThrow();
    });

    it('en demostracion ejecuta las acciones del paso y luego deja seguir', async () => {
      const campo = raiz.querySelector<HTMLInputElement>('#campo-uno') as HTMLInputElement;
      iniciarRecorrido(
        document,
        [
          { ancla: 'uno', titulo: 'Escribe', texto: '', acciones: [{ tipo: 'escribir', valor: 'MAR' }] },
          { ancla: 'dos', titulo: 'Fin', texto: '' },
        ],
        { modo: 'demo', msPorLetra: 0 },
      );
      expect(document.body.getAttribute('data-guia-simulacion')).toBe('demo');
      await hastaQue(() => campo.value === 'MAR');
      await hastaQue(() => estado().includes('Así se hace'));
      expect(tapaVisible()).toBeTrue();
      const siguiente = botonDeTarjeta('Siguiente');
      expect(siguiente?.disabled).toBeFalse();
      siguiente?.click();
      expect(tarjeta()?.textContent).toContain('Paso 2 de 2');
    });

    it('en practica abre el hueco, espera a la persona y celebra cuando lo hace', async () => {
      const campo = raiz.querySelector<HTMLInputElement>('#campo-uno') as HTMLInputElement;
      iniciarRecorrido(
        document,
        [
          { ancla: 'uno', titulo: 'Escribe', texto: '', listo: { tipo: 'valor' }, practica: 'escribe algo.', acciones: [{ tipo: 'escribir', valor: 'MAR' }] },
          { ancla: 'dos', titulo: 'Fin', texto: '' },
        ],
        { modo: 'practica', msPorLetra: 0 },
      );
      expect(tapaVisible()).toBeFalse();
      expect(estado()).toContain('Ahora tú: escribe algo.');
      expect(botonDeTarjeta('Saltar')).toBeDefined();
      expect(botonDeTarjeta('Hazlo por mí')).toBeDefined();
      campo.value = 'YO';
      campo.dispatchEvent(new Event('input', { bubbles: true }));
      await hastaQue(() => estado().includes('Bien hecho'));
      expect(botonDeTarjeta('Siguiente')).toBeDefined();
      botonDeTarjeta('Siguiente')?.click();
      expect(tarjeta()?.textContent).toContain('Paso 2 de 2');
      // El paso sin condicion vuelve a tapar la pantalla.
      expect(tapaVisible()).toBeTrue();
    });

    it('un paso cuya ancla aparece despues de una accion entra cuando le toca, y la navegacion sigue el orden pedido', async () => {
      raiz.querySelector('#abre')?.addEventListener('click', () => {
        const nuevo = document.createElement('div');
        nuevo.setAttribute('data-guia', 'tres');
        nuevo.style.height = '30px';
        nuevo.innerHTML = '<button id="cierra">cierra</button>';
        nuevo.querySelector('#cierra')?.addEventListener('click', () => nuevo.remove());
        raiz.append(nuevo);
      });
      iniciarRecorrido(
        document,
        [
          { ancla: 'uno', titulo: 'Uno', texto: '' },
          { ancla: 'dos', titulo: 'Dos', texto: '', acciones: [{ tipo: 'clic', selector: '#abre' }, { tipo: 'esperar', selector: '[data-guia="tres"]' }] },
          { ancla: 'tres', titulo: 'Tres', texto: '', acciones: [{ tipo: 'clic', selector: '#cierra' }] },
        ],
        { modo: 'demo', msPorLetra: 0 },
      );
      expect(tarjeta()?.textContent).toContain('Paso 1 de 2');
      botonDeTarjeta('Siguiente')?.click();
      await hastaQue(() => estado().includes('Así se hace'));
      expect(tarjeta()?.textContent).toContain('Paso 2 de 3');
      botonDeTarjeta('Siguiente')?.click();
      expect(tarjeta()?.textContent).toContain('Tres');
      await hastaQue(() => estado().includes('Así se hace'));
      // El ancla "tres" ya no existe: Terminar cierra sin volver al principio.
      expect(document.querySelector('[data-guia="tres"]')).toBeNull();
      expect(tarjeta()?.textContent).toContain('Paso 3 de 3');
      botonDeTarjeta('Terminar')?.click();
      expect(tarjeta()).toBeNull();
    });
  });
});
