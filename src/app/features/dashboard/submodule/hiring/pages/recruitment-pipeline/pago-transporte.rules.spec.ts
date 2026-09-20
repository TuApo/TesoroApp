import { CAMPOS_PAGO_TRANSPORTE, FALTA_GUARDAR, faltantesDePagoTransporte } from './pago-transporte.rules';

/** Contrato tal como lo devuelve ContratoCandidatoSerializer, todo completo. */
function contratoCompleto(over: Record<string, any> = {}) {
  return {
    forma_de_pago: 'Bancolombia',
    numero_para_pagos: '1234567890123456',
    identification_number_tarjeta: '9988',
    Ccentro_de_costos: 'CC-1',
    subcentro_de_costos: 'SUB-1',
    porcentaje_arl: '0.522',
    cesantias: 'Porvenir',
    grupo: 'G1',
    categoria: 'CAT1',
    operacion: 'OP1',
    fecha_ingreso: '2026-07-01',
    fecha_contrato: '2026-07-01',
    seguro_funerario: false,
    horas_extras: false,
    ...over,
  };
}

describe('faltantesDePagoTransporte', () => {
  it('solo exige campos que el serializer realmente devuelve', () => {
    // Copiado de ContratoCandidatoSerializer.Meta.fields
    // (back-tu-apo-django/gestion_contratacion/serializers.py:158-192).
    // `contrasenia_asignada` NO está: es write_only. Si se colara en la lista,
    // el valor llegaría siempre undefined y bloquearía a todo candidato que no
    // sea Daviplata, sin forma de desbloquearlo.
    const EXPUESTOS = [
      'proceso', 'codigo_contrato', 'forma_de_pago', 'numero_para_pagos', 'seguro_funerario',
      'Ccentro_de_costos', 'porcentaje_arl', 'cesantias', 'subcentro_de_costos', 'grupo',
      'categoria', 'operacion', 'horas_extras', 'fecha_ingreso', 'fecha_contrato',
      'desea_trasladarse', 'seleccion_eps', 'identification_number_tarjeta', 'carnet_generado',
      'carnet_fecha_ingreso', 'carnet_codigo', 'carnet_centro_costo', 'contrato_activo',
      'fecha_retiro', 'motivo_retiro', 'descripcion_de_obra', 'centro_costo_obra',
      'direccion_empresa', 'empresa_usuaria', 'created_at', 'updated_at',
    ];

    const exigidos = CAMPOS_PAGO_TRANSPORTE.map((c) => c.campo);

    expect(exigidos.length).toBeGreaterThan(0);
    exigidos.forEach((campo) => expect(EXPUESTOS).withContext(campo).toContain(campo));
    expect(exigidos).not.toContain('contrasenia_asignada');
  });

  it('con todo guardado no falta nada', () => {
    expect(faltantesDePagoTransporte(contratoCompleto())).toEqual([]);
  });

  it('sin contrato guardado pide guardar el sub-tab', () => {
    expect(faltantesDePagoTransporte(null)).toEqual([FALTA_GUARDAR]);
    expect(faltantesDePagoTransporte(undefined)).toEqual([FALTA_GUARDAR]);
  });

  it('nombra en español cada campo que falta', () => {
    const faltan = faltantesDePagoTransporte(contratoCompleto({
      Ccentro_de_costos: '',
      grupo: null,
      fecha_ingreso: null,
    }));

    expect(faltan).toEqual(['Centro de costos', 'Grupo', 'Fecha de ingreso']);
  });

  it('acepta 0 en un numérico exigido sin tratarlo como vacío', () => {
    // Con un chequeo por falsy, un 0 legítimo bloquearía la generación.
    expect(faltantesDePagoTransporte(contratoCompleto({ grupo: 0 }))).toEqual([]);
  });

  it('trata los espacios en blanco como vacío', () => {
    expect(faltantesDePagoTransporte(contratoCompleto({ grupo: '   ' }))).toEqual(['Grupo']);
  });

  it('no exige número de tarjeta con Daviplata', () => {
    const contrato = contratoCompleto({ forma_de_pago: 'Daviplata', identification_number_tarjeta: null });

    expect(faltantesDePagoTransporte(contrato)).toEqual([]);
  });

  it('ya NO exige número de tarjeta: la casilla salió de la ficha', () => {
    // Exigir lo que no se puede responder = bloqueo permanente de la documentación
    // para todo contrato que no sea Daviplata.
    const contrato = contratoCompleto({ forma_de_pago: 'Bancolombia', identification_number_tarjeta: '' });

    expect(faltantesDePagoTransporte(contrato)).toEqual([]);
  });

  it('tampoco exige cesantías ni porcentaje ARL, que salieron de la pantalla', () => {
    const contrato = contratoCompleto({ porcentaje_arl: null, cesantias: null });

    expect(faltantesDePagoTransporte(contrato)).toEqual([]);
  });

  it('no exige tarjeta si aún no se eligió forma de pago (ya se reporta esa)', () => {
    const contrato = contratoCompleto({ forma_de_pago: '', identification_number_tarjeta: '' });

    expect(faltantesDePagoTransporte(contrato)).toEqual(['Forma de pago']);
  });

  it('los booleanos en false no bloquean', () => {
    const contrato = contratoCompleto({ seguro_funerario: false, horas_extras: false });

    expect(faltantesDePagoTransporte(contrato)).toEqual([]);
  });

  it('un contrato recién creado y vacío lista todo lo que falta', () => {
    const faltan = faltantesDePagoTransporte({ codigo_contrato: 'ABC-1' });

    expect(faltan).toEqual(CAMPOS_PAGO_TRANSPORTE.map((c) => c.etiqueta));
  });

  // ── Ruta y recargo de HE (V57) ────────────────────────────────────────────
  // Se añadieron al tab pero NO a esta regla, y es deliberado: hay 89.982
  // contratos históricos sin esos datos y ninguno de los tres entra en la ficha
  // técnica, el carnet ni el contrato. Exigirlos dejaría sin documentación a
  // todo el histórico para pintar tres casillas que los documentos no leen.
  it('no bloquea la documentación por los campos de ruta y recargo', () => {
    const contrato = contratoCompleto({
      usa_ruta: null,
      valor_transporte: null,
      porcentaje_horas_extras: null,
    });

    expect(faltantesDePagoTransporte(contrato)).toEqual([]);
  });

  it('un contrato histórico sin las columnas nuevas sigue siendo completo', () => {
    // Tal como llega de la BD antes de que nadie reabra el tab: las claves ni
    // existen en la respuesta.
    const contrato = contratoCompleto();
    delete (contrato as any).usa_ruta;

    expect(faltantesDePagoTransporte(contrato)).toEqual([]);
  });

  it('tampoco exige la temporal, que se resuelve sola desde el maestro', () => {
    expect(faltantesDePagoTransporte(contratoCompleto({ temporal: null }))).toEqual([]);
  });

  it('el porcentaje ARL y el de horas extras siguen siendo campos distintos', () => {
    // Ninguno bloquea ya, pero no pueden confundirse: son claves separadas y el
    // contrato guarda las dos por su lado.
    const contrato: any = contratoCompleto({ porcentaje_arl: 0.522, porcentaje_horas_extras: 25 });

    expect(String(contrato.porcentaje_arl) === String(contrato.porcentaje_horas_extras)).toBeFalse();
    expect(faltantesDePagoTransporte(contrato)).toEqual([]);
  });
});
