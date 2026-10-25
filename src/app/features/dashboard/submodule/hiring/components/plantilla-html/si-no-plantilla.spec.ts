import { leerPreguntas, marcarRespuesta, normalizarSiNo, pintarPendientes, sinResponder } from './si-no-plantilla';

/** Documento como lo devuelve ms-templates /vista para la Entrega de documentos (sintético). */
function documento(casinoMarcado = ''): Document {
  const doc = document.implementation.createHTMLDocument('entrega');
  doc.body.innerHTML = `
    <div class="sino" data-control="si_no" data-campo="Autoriza Descuento Casino">
      SI (<span class="mk"><span class="chk ph-edit" data-expr='Autoriza Descuento Casino == "SI"'
        data-control="si_no" data-campo="Autoriza Descuento Casino" data-opcion="SI"></span></span>)
      NO (<span class="mk"><span class="chk ph-edit" data-expr='Autoriza Descuento Casino == "NO"'
        data-control="si_no" data-campo="Autoriza Descuento Casino" data-opcion="NO">${casinoMarcado}</span></span>)
    </div>
    <div class="sino" data-control="si_no" data-campo="Autoriza Plan Funeral">
      <span class="chk ph-edit" data-control="si_no" data-campo="Autoriza Plan Funeral" data-opcion="SI"></span>
      <span class="chk ph-edit" data-control="si_no" data-campo="Autoriza Plan Funeral" data-opcion="NO"></span>
    </div>
    <span class="chk ph-edit" data-expr='Estado civil == "SO"'>X</span>`;
  return doc;
}

function casillas(doc: Document, campo: string): string[] {
  return Array.from(doc.querySelectorAll<HTMLElement>(`span[data-campo="${campo}"]`)).map((s) => (s.textContent ?? '').trim());
}

describe('si-no-plantilla', () => {
  it('normaliza la respuesta', () => {
    expect(normalizarSiNo(' sí ')).toBe('SI');
    expect(normalizarSiNo('no')).toBe('NO');
    expect(normalizarSiNo('X')).toBeNull();
    expect(normalizarSiNo(null)).toBeNull();
  });

  it('lee las preguntas en orden; la casilla que llega con X es la respuesta inicial', () => {
    const preguntas = leerPreguntas(documento('X'));
    expect(preguntas).toEqual([
      { campo: 'Autoriza Descuento Casino', valor: 'NO' },
      { campo: 'Autoriza Plan Funeral', valor: null },
    ]);
    expect(sinResponder(preguntas)).toEqual(['Autoriza Plan Funeral']);
  });

  it('usa el valor por defecto de /vista cuando ninguna casilla viene marcada', () => {
    const preguntas = leerPreguntas(documento(), [
      { campo: 'Autoriza Plan Funeral', tipo: 'si_no', opciones: ['SI', 'NO'], valor: 'si', obligatorio: true },
    ]);
    expect(preguntas[1]).toEqual({ campo: 'Autoriza Plan Funeral', valor: 'SI' });
    expect(preguntas[0].valor).toBeNull();
  });

  it('marcar una opción pone la X ahí y vacía la otra (radio)', () => {
    const doc = documento('X');
    marcarRespuesta(doc, 'Autoriza Descuento Casino', 'SI');
    expect(casillas(doc, 'Autoriza Descuento Casino')).toEqual(['X', '']);
    marcarRespuesta(doc, 'Autoriza Descuento Casino', 'NO');
    expect(casillas(doc, 'Autoriza Descuento Casino')).toEqual(['', 'X']);
    // Las demás preguntas y las casillas normales no se tocan.
    expect(casillas(doc, 'Autoriza Plan Funeral')).toEqual(['', '']);
    expect(doc.querySelector('span[data-expr=\'Estado civil == "SO"\']')?.textContent).toBe('X');
  });

  it('el paréntesis es el radio: resaltado mientras falta, verde el elegido', () => {
    const doc = documento();
    pintarPendientes(doc, leerPreguntas(doc));
    const cajas = Array.from(doc.querySelectorAll<HTMLElement>('.mk'));
    expect(cajas.every((c) => c.classList.contains('ph-radio') && c.classList.contains('ph-radio-falta'))).toBeTrue();

    marcarRespuesta(doc, 'Autoriza Descuento Casino', 'SI');
    pintarPendientes(doc, [{ campo: 'Autoriza Descuento Casino', valor: 'SI' }, { campo: 'Autoriza Plan Funeral', valor: null }]);
    expect(cajas[0].classList.contains('ph-radio-elegido')).toBeTrue();
    expect(cajas[1].classList.contains('ph-radio-elegido')).toBeFalse();
    expect(cajas.some((c) => c.classList.contains('ph-radio-falta'))).toBeFalse();
    // Las del plan funeral (sin .mk) siguen pendientes.
    const funeral = Array.from(doc.querySelectorAll<HTMLElement>('span[data-campo="Autoriza Plan Funeral"]'));
    expect(funeral.every((c) => c.classList.contains('ph-radio-falta'))).toBeTrue();
  });

  it('solo se puede guardar con todas respondidas', () => {
    expect(sinResponder([{ campo: 'A', valor: 'SI' }, { campo: 'B', valor: 'NO' }])).toEqual([]);
    expect(sinResponder([{ campo: 'A', valor: null }])).toEqual(['A']);
  });

  it('una pregunta opcional puede quedar sin responder', () => {
    expect(sinResponder([{ campo: 'A', valor: null, obligatorio: false }, { campo: 'B', valor: null }])).toEqual(['B']);
    const doc = documento();
    const preguntas = leerPreguntas(doc, [
      { campo: 'Autoriza Plan Funeral', tipo: 'si_no', opciones: ['SI', 'NO'], valor: null, obligatorio: false },
    ]);
    expect(preguntas.find((p) => p.campo === 'Autoriza Plan Funeral')?.obligatorio).toBeFalse();
    expect(preguntas.find((p) => p.campo === 'Autoriza Descuento Casino')?.obligatorio).toBeTrue();
    expect(sinResponder(preguntas)).toEqual(['Autoriza Descuento Casino']);
    // Sin responder se ve en amarillo aunque sea opcional.
    pintarPendientes(doc, preguntas);
    const funeral = Array.from(doc.querySelectorAll<HTMLElement>('span[data-campo="Autoriza Plan Funeral"]'));
    expect(funeral.every((c) => c.classList.contains('ph-radio-falta'))).toBeTrue();
  });
});
