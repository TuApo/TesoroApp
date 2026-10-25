/**
 * Recorrido guiado (reunion funcional 2026-10-20: "un instructivo dentro del mismo programa") y, desde
 * el 2026-10-21, SIMULACION sobre la pantalla real: en modo demostracion el recorrido ejecuta las
 * acciones de cada paso (escribe, abre listas, elige, marca fechas) y en modo practica le abre a la
 * persona solo la parte de la pantalla que toca y espera a que lo haga.
 *
 * Oscurece la pantalla, resalta la parte real marcada con `data-guia="<ancla>"` y muestra una tarjeta
 * con el paso. Todo se pinta con estilos EN LINEA sobre `document.body`: no depende de CSS global ni
 * de ninguna libreria. Lo que la simulacion escribe entra por los mismos eventos que el teclado
 * (ver `simulacion.ts`).
 *
 * Teclado: flecha derecha / Enter = siguiente (cuando no se esta escribiendo), flecha izquierda =
 * anterior, Esc = salir.
 */
import { AccionSimulada, CondicionLista, ejecutarAcciones, seVe, vigilarCondicion } from './simulacion';

export type ModoRecorrido = 'ver' | 'demo' | 'practica';

export interface PasoRecorrido {
  /** Valor del atributo `data-guia` del elemento a resaltar. */
  ancla: string;
  titulo: string;
  texto: string;
  /** Lo que la simulacion hace en este paso (demostracion) o le pide a la persona (practica). */
  acciones?: readonly AccionSimulada[];
  /** Como saber, en modo practica, que la persona ya lo hizo. */
  listo?: CondicionLista;
  /** Instruccion corta para el modo practica ("Escribe la cedula y elige a la persona"). */
  practica?: string;
}

export interface OpcionesRecorrido {
  modo?: ModoRecorrido;
  /** Milisegundos entre letra y letra al escribir (0 = instantaneo, para pruebas). */
  msPorLetra?: number;
  /** Se llama al cerrar: `true` si la persona llego hasta "Terminar". */
  alTerminar?: (completado: boolean) => void;
}

const Z = 2147483000;
const ATRIBUTO_CUERPO = 'data-guia-simulacion';

function buscarAncla(doc: Document, ancla: string): HTMLElement | null {
  return doc.querySelector<HTMLElement>(`[data-guia="${ancla}"]`);
}

/** Pasos cuya ancla existe y se ve en pantalla AHORA (los ocultos por nivel o por estado se saltan). */
export function pasosVisibles(doc: Document, pasos: readonly PasoRecorrido[]): PasoRecorrido[] {
  return pasos.filter((p) => seVe(buscarAncla(doc, p.ancla)));
}

/**
 * Arranca el recorrido. Devuelve la funcion para cerrarlo (tambien se cierra solo al terminar).
 * Sin pasos visibles no pinta nada y devuelve una funcion vacia. La lista de pasos se vuelve a
 * mirar en cada avance: un paso cuya ancla aparece despues (un dialogo que abre una accion) entra
 * cuando le toca.
 */
export function iniciarRecorrido(
  doc: Document,
  pasosPedidos: readonly PasoRecorrido[],
  opciones: OpcionesRecorrido | ((completado: boolean) => void) = {},
): () => void {
  const op: OpcionesRecorrido = typeof opciones === 'function' ? { alTerminar: opciones } : opciones;
  const modo: ModoRecorrido = op.modo ?? 'ver';
  const msPorLetra = op.msPorLetra ?? 55;
  const win = doc.defaultView;
  const primero = pasosVisibles(doc, pasosPedidos)[0];
  if (!primero || !win) return () => undefined;

  let actual: PasoRecorrido = primero;
  let cerrado = false;
  let ejecucion = 0;
  let pararVigilancia: (() => void) | null = null;
  let pasoListo = false;

  const fijo = (extra: Partial<CSSStyleDeclaration>): Partial<CSSStyleDeclaration> => ({ position: 'fixed', ...extra });

  // Capa que bloquea la pagina alrededor del elemento resaltado (4 paneles) y, cuando el paso no es
  // para que la persona actue, tambien encima de el (tapa).
  const capa = doc.createElement('div');
  capa.setAttribute('data-recorrido', 'capa');
  Object.assign(capa.style, fijo({ inset: '0', zIndex: String(Z), pointerEvents: 'none' }));
  const paneles = ['arriba', 'abajo', 'izquierda', 'derecha'].map((lado) => {
    const p = doc.createElement('div');
    p.setAttribute('data-recorrido', `bloqueo-${lado}`);
    Object.assign(p.style, fijo({ pointerEvents: 'auto', background: 'transparent' }));
    capa.append(p);
    return p;
  });
  const tapa = doc.createElement('div');
  tapa.setAttribute('data-recorrido', 'tapa');
  Object.assign(tapa.style, fijo({ pointerEvents: 'auto', background: 'transparent', cursor: 'default' }));
  capa.append(tapa);

  const foco = doc.createElement('div');
  foco.setAttribute('data-recorrido', 'foco');
  Object.assign(
    foco.style,
    fijo({
      zIndex: String(Z + 1), borderRadius: '14px', pointerEvents: 'none',
      boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.62), 0 0 0 3px #42a5f5, 0 0 24px 6px rgba(66, 165, 245, 0.55)',
      transition: 'top .25s ease, left .25s ease, width .25s ease, height .25s ease',
    }),
  );

  const tarjeta = doc.createElement('div');
  tarjeta.setAttribute('role', 'dialog');
  tarjeta.setAttribute('data-recorrido', 'tarjeta');
  tarjeta.setAttribute('aria-live', 'polite');
  Object.assign(
    tarjeta.style,
    fijo({
      zIndex: String(Z + 2), maxWidth: '400px', width: 'calc(100vw - 32px)',
      background: '#ffffff', color: '#1f2937', borderRadius: '16px', padding: '18px 18px 14px',
      boxShadow: '0 18px 48px rgba(0,0,0,.35)', fontFamily: 'inherit', fontSize: '15px', lineHeight: '1.45',
      transition: 'top .25s ease, left .25s ease',
    }),
  );

  const contador = doc.createElement('div');
  Object.assign(contador.style, { fontSize: '12px', fontWeight: '700', letterSpacing: '.06em', color: '#1976d2', textTransform: 'uppercase' });
  const titulo = doc.createElement('div');
  Object.assign(titulo.style, { fontSize: '17px', fontWeight: '800', margin: '4px 0 6px', color: '#0d47a1' });
  const texto = doc.createElement('div');
  Object.assign(texto.style, { color: '#374151', whiteSpace: 'pre-line' });
  const estado = doc.createElement('div');
  estado.setAttribute('data-recorrido', 'estado');
  Object.assign(estado.style, {
    display: 'none', marginTop: '12px', padding: '10px 12px', borderRadius: '12px', fontWeight: '700', fontSize: '14px',
    background: '#e3f2fd', color: '#0d47a1',
  });

  const barra = doc.createElement('div');
  Object.assign(barra.style, { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '14px', flexWrap: 'wrap' });

  const boton = (etiqueta: string, primario: boolean): HTMLButtonElement => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = etiqueta;
    Object.assign(b.style, {
      border: primario ? '0' : '1px solid #90a4ae', background: primario ? '#1976d2' : '#ffffff',
      color: primario ? '#ffffff' : '#37474f', borderRadius: '20px', padding: '7px 16px', cursor: 'pointer',
      fontSize: '14px', fontWeight: '600',
    } as Partial<CSSStyleDeclaration>);
    return b;
  };
  const salir = boton('Salir', false);
  const anterior = boton('Anterior', false);
  const hazlo = boton('Hazlo por mí', false);
  hazlo.setAttribute('data-recorrido', 'hazlo');
  const siguiente = boton('Siguiente', true);
  siguiente.setAttribute('data-recorrido', 'siguiente');
  barra.append(salir, anterior, hazlo, siguiente);
  tarjeta.append(contador, titulo, texto, estado, barra);
  doc.body.append(capa, foco, tarjeta);
  doc.body.setAttribute(ATRIBUTO_CUERPO, modo);

  const visibles = (): PasoRecorrido[] => pasosVisibles(doc, pasosPedidos);
  const objetivo = (): HTMLElement | null => buscarAncla(doc, actual.ancla);

  const pintarEstado = (mensaje: string, tono: 'info' | 'ok' | 'aviso'): void => {
    estado.textContent = mensaje;
    estado.style.display = 'block';
    estado.style.background = tono === 'ok' ? '#e8f5e9' : tono === 'aviso' ? '#fff8e1' : '#e3f2fd';
    estado.style.color = tono === 'ok' ? '#1b5e20' : tono === 'aviso' ? '#7a4f01' : '#0d47a1';
  };

  const habilitar = (b: HTMLButtonElement, si: boolean): void => {
    b.disabled = !si;
    b.style.opacity = si ? '1' : '0.45';
    b.style.cursor = si ? 'pointer' : 'default';
  };

  const posicionar = (): void => {
    if (cerrado) return;
    const el = objetivo();
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margen = 8;
    const top = Math.max(r.top - margen, 4);
    const left = Math.max(r.left - margen, 4);
    const ancho = Math.min(r.width + margen * 2, win.innerWidth - 8);
    const alto = Math.min(r.height + margen * 2, win.innerHeight - 8);
    Object.assign(foco.style, { top: `${top}px`, left: `${left}px`, width: `${ancho}px`, height: `${alto}px` });
    const [arriba, abajo, izquierda, derecha] = paneles;
    Object.assign(arriba.style, { top: '0', left: '0', width: '100vw', height: `${top}px` });
    Object.assign(abajo.style, { top: `${top + alto}px`, left: '0', width: '100vw', height: `${Math.max(0, win.innerHeight - top - alto)}px` });
    Object.assign(izquierda.style, { top: `${top}px`, left: '0', width: `${left}px`, height: `${alto}px` });
    Object.assign(derecha.style, { top: `${top}px`, left: `${left + ancho}px`, width: `${Math.max(0, win.innerWidth - left - ancho)}px`, height: `${alto}px` });
    Object.assign(tapa.style, { top: `${top}px`, left: `${left}px`, width: `${ancho}px`, height: `${alto}px` });

    const altoTarjeta = tarjeta.offsetHeight || 180;
    const anchoTarjeta = tarjeta.offsetWidth || 360;
    const debajo = r.bottom + margen + 12;
    const encima = r.top - margen - 12 - altoTarjeta;
    const topTarjeta =
      debajo + altoTarjeta <= win.innerHeight ? debajo : encima >= 8 ? encima : Math.max(8, win.innerHeight - altoTarjeta - 8);
    const leftTarjeta = Math.min(Math.max(8, r.left), Math.max(8, win.innerWidth - anchoTarjeta - 8));
    Object.assign(tarjeta.style, { top: `${topTarjeta}px`, left: `${leftTarjeta}px` });
  };

  const abrirHueco = (abierto: boolean): void => {
    tapa.style.display = abierto ? 'none' : 'block';
  };

  const detenerPaso = (): void => {
    ejecucion++;
    pararVigilancia?.();
    pararVigilancia = null;
  };

  // La navegacion sigue el ORDEN PEDIDO y salta lo que no se ve en ese momento: un paso cuya ancla
  // acaba de desaparecer (se cerro el dialogo) no desorienta al siguiente.
  const visible = (p: PasoRecorrido): boolean => seVe(buscarAncla(doc, p.ancla));
  const siguienteVisible = (): PasoRecorrido | null =>
    pasosPedidos.slice(pasosPedidos.indexOf(actual) + 1).find(visible) ?? null;
  const anteriorVisible = (): PasoRecorrido | null => {
    const previos = pasosPedidos.slice(0, Math.max(0, pasosPedidos.indexOf(actual))).filter(visible);
    return previos.length ? previos[previos.length - 1] : null;
  };
  const esUltimo = (): boolean => siguienteVisible() === null;

  /** "Paso i de n" con lo visible AHORA (una accion puede hacer aparecer el paso siguiente). */
  const pintarContador = (): void => {
    const lista = visibles();
    const antes = pasosPedidos.slice(0, Math.max(0, pasosPedidos.indexOf(actual))).filter(visible).length;
    contador.textContent = `Paso ${antes + 1} de ${lista.length + (lista.includes(actual) ? 0 : 1)}`;
  };

  /** Ejecuta las acciones del paso actual (demostracion o "Hazlo por mi"). */
  const demostrar = async (): Promise<void> => {
    const el = objetivo();
    const acciones = actual.acciones ?? [];
    if (!el || !acciones.length) return;
    const miEjecucion = ++ejecucion;
    abrirHueco(false);
    habilitar(siguiente, false);
    habilitar(hazlo, false);
    pintarEstado('Mira cómo se hace…', 'info');
    const resultado = await ejecutarAcciones(doc, el, acciones, {
      msPorLetra,
      cancelado: () => cerrado || miEjecucion !== ejecucion,
    });
    if (cerrado || miEjecucion !== ejecucion) return;
    habilitar(siguiente, true);
    pintarContador();
    if (resultado.completo) {
      pasoListo = true;
      pintarEstado(modo === 'practica' ? 'Listo: quedó hecho. Ahora sigue tú.' : 'Así se hace. Pulsa Siguiente.', 'ok');
      siguiente.textContent = etiquetaSiguiente();
      abrirHueco(modo === 'practica');
    } else {
      pintarEstado(`${resultado.motivo ?? 'No pude terminarlo.'} Termínalo tú en la pantalla y pulsa Siguiente.`, 'aviso');
      abrirHueco(true);
    }
    habilitar(hazlo, true);
    posicionar();
    siguiente.focus({ preventScroll: true });
  };

  const etiquetaSiguiente = (): string => {
    if (modo === 'practica' && actual.listo && !pasoListo) return 'Saltar';
    return esUltimo() ? 'Terminar' : 'Siguiente';
  };

  const mostrar = (): void => {
    detenerPaso();
    pasoListo = false;
    pintarContador();
    titulo.textContent = actual.titulo;
    texto.textContent = actual.texto;
    estado.style.display = 'none';
    habilitar(anterior, anteriorVisible() !== null);
    habilitar(siguiente, true);
    hazlo.style.display = 'none';

    const conAcciones = !!actual.acciones?.length;
    const practicando = modo === 'practica' && !!actual.listo;
    if (practicando && actual.listo) {
      abrirHueco(true);
      pintarEstado(`Ahora tú: ${actual.practica ?? 'hazlo en la pantalla.'}`, 'info');
      hazlo.style.display = conAcciones ? 'inline-block' : 'none';
      habilitar(hazlo, true);
      const el = objetivo();
      if (el) {
        pararVigilancia = vigilarCondicion(doc, el, actual.listo, () => {
          if (cerrado) return;
          pasoListo = true;
          pintarEstado('¡Bien hecho! Pulsa Siguiente.', 'ok');
          siguiente.textContent = etiquetaSiguiente();
          siguiente.focus({ preventScroll: true });
        });
      }
    } else if (modo !== 'ver' && conAcciones) {
      void demostrar();
    } else {
      abrirHueco(false);
    }
    siguiente.textContent = etiquetaSiguiente();
    objetivo()?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // Primero en el sitio actual y luego cuando el scroll suave termina.
    posicionar();
    win.setTimeout(posicionar, 380);
    // Con la simulacion escribiendo o la persona practicando, el foco es de la pantalla.
    if (!practicando && !(modo !== 'ver' && conAcciones)) siguiente.focus({ preventScroll: true });
  };

  const cerrar = (completado = false): void => {
    if (cerrado) return;
    cerrado = true;
    detenerPaso();
    win.removeEventListener('resize', posicionar);
    win.removeEventListener('scroll', posicionar, true);
    doc.removeEventListener('keydown', teclado, true);
    capa.remove();
    foco.remove();
    tarjeta.remove();
    doc.body.removeAttribute(ATRIBUTO_CUERPO);
    op.alTerminar?.(completado);
  };

  const avanzar = (): void => {
    const proximo = siguienteVisible();
    if (proximo) {
      actual = proximo;
      mostrar();
    } else {
      cerrar(true);
    }
  };
  const retroceder = (): void => {
    const previo = anteriorVisible();
    if (previo) {
      actual = previo;
      mostrar();
    }
  };

  /** La persona esta escribiendo en la pantalla (modo practica): el teclado es suyo. */
  const escribiendo = (): boolean => {
    const activo = doc.activeElement;
    return !!activo && activo !== doc.body && !tarjeta.contains(activo);
  };

  function teclado(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      cerrar(false);
      return;
    }
    if (escribiendo()) {
      // Enter dentro de un formulario real enviaria el formulario: en la simulacion nunca.
      if (e.key === 'Enter' && e.target instanceof HTMLInputElement) e.preventDefault();
      return;
    }
    if (e.key === 'ArrowRight' || e.key === 'Enter') {
      if (siguiente.disabled) return;
      e.preventDefault();
      avanzar();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      retroceder();
    }
  }

  salir.addEventListener('click', () => cerrar(false));
  anterior.addEventListener('click', retroceder);
  hazlo.addEventListener('click', () => void demostrar());
  siguiente.addEventListener('click', avanzar);
  for (const p of paneles) p.addEventListener('click', () => modo === 'ver' && avanzar());
  win.addEventListener('resize', posicionar);
  win.addEventListener('scroll', posicionar, true);
  doc.addEventListener('keydown', teclado, true);
  mostrar();
  return () => cerrar(false);
}
