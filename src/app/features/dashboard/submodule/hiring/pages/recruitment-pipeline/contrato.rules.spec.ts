import {
  esContratoReal,
  esContratoRealMini,
  estadoContratoPill,
  procesoDeAntecedentes,
  procesoContratoEnCurso,
  procesoDelContrato,
  procesoVigente,
  tieneContratoActivoReal,
  turnoTrasBaja,
  esAnteriorA,
  contratoFirmado,
  contratoEnCurso,
  esDocumentoDeOtroContrato,
  filtroOtroContrato,
  PRIMER_PROCESO_FECHA_FIABLE,
  PRIMER_PROCESO_PLATAFORMA_NUEVA,
} from './contrato.rules';

/** Proceso tal como llega en candidato.entrevistas[0].proceso. */
function proceso(over: Record<string, any> = {}, contrato: Record<string, any> | null = {}) {
  return {
    contratado: false,
    ...over,
    contrato: contrato === null ? null : {
      codigo_contrato: 'COSUBA_0141-26',
      contrato_activo: true,
      fecha_ingreso: null,
      fecha_retiro: null,
      ...contrato,
    },
  };
}

describe('contrato.rules', () => {
  // Caso real detectado en prod (CC 1128324722): fila de contrato creada solo
  // para reservar el código, contrato_activo=true por default del modelo,
  // proceso apenas remitido a prueba técnica.
  it('una fila con solo el código reservado NO es contrato activo ni bloquea', () => {
    const p = proceso({ contratado: false, prueba_tecnica: true });
    expect(esContratoReal(p)).toBeFalse();
    expect(tieneContratoActivoReal(p)).toBeFalse();
    expect(estadoContratoPill(p)).toBe('en_tramite');
  });

  it('contratado=true con contrato_activo=true bloquea (pill verde)', () => {
    const p = proceso({ contratado: true });
    expect(tieneContratoActivoReal(p)).toBeTrue();
    expect(estadoContratoPill(p)).toBe('activo');
  });

  it('contrato legacy: contratado=false pero con fecha_ingreso cuenta como real', () => {
    const p = proceso({ contratado: false }, { fecha_ingreso: '2026-01-15' });
    expect(esContratoReal(p)).toBeTrue();
    expect(tieneContratoActivoReal(p)).toBeTrue();
    expect(estadoContratoPill(p)).toBe('activo');
  });

  // Desde la plataforma nueva la fecha de ingreso se guarda ANTES de contratar
  // (la piden los documentos): solo `contratado` marca el contrato como real.
  describe('plataforma nueva (id >= PRIMER_PROCESO_PLATAFORMA_NUEVA)', () => {
    const NUEVO = PRIMER_PROCESO_PLATAFORMA_NUEVA;

    it('fecha de ingreso sin "Contratar" es un trámite: no bloquea ni pinta CONTRATADO', () => {
      const p = proceso({ id: 113137, contratado: false }, { fecha_ingreso: '2026-09-28' });
      expect(esContratoReal(p)).toBeFalse();
      expect(tieneContratoActivoReal(p)).toBeFalse();
      expect(estadoContratoPill(p)).toBe('en_tramite');
      expect(esContratoRealMini({ id: 113137, contratado: false, contrato_fecha_ingreso: '2026-09-28' })).toBeFalse();
    });

    it('con "Contratar" (contratado=true) sí es contrato activo', () => {
      const p = proceso({ id: NUEVO, contratado: true }, { fecha_ingreso: '2026-09-28' });
      expect(tieneContratoActivoReal(p)).toBeTrue();
      expect(estadoContratoPill(p)).toBe('activo');
      expect(esContratoRealMini({ id: NUEVO, contratado: true })).toBeTrue();
    });

    it('un proceso de Django (id menor) conserva la regla de la fecha de ingreso', () => {
      const p = proceso({ id: NUEVO - 1, contratado: false }, { fecha_ingreso: '2026-04-19' });
      expect(esContratoReal(p)).toBeTrue();
      expect(esContratoRealMini({ id: 76847, contratado: false, contrato_fecha_ingreso: '2026-07-01' })).toBeTrue();
    });

    it('el id puede llegar como texto', () => {
      const p = proceso({ id: String(NUEVO + 10), contratado: false }, { fecha_ingreso: '2026-09-28' });
      expect(esContratoReal(p)).toBeFalse();
    });
  });

  it('contrato dado de baja → retirado, aunque haya sido real', () => {
    const p = proceso({ contratado: true }, { contrato_activo: false, fecha_retiro: '2026-06-30' });
    expect(tieneContratoActivoReal(p)).toBeFalse();
    expect(estadoContratoPill(p)).toBe('retirado');
  });

  it('fila inactiva sin fecha de retiro y nunca contratada no es un retiro: sin pill', () => {
    const p = proceso({ contratado: false }, { contrato_activo: false, fecha_retiro: null });
    expect(estadoContratoPill(p)).toBe('sin_fila');
  });

  it('la baja apaga contratado pero deja fecha_retiro → sigue siendo retirado', () => {
    const p = proceso({ id: PRIMER_PROCESO_PLATAFORMA_NUEVA, contratado: false }, { contrato_activo: false, fecha_retiro: '2026-09-24' });
    expect(estadoContratoPill(p)).toBe('retirado');
  });

  it('sin fila de contrato ni contratado no hay pill ni bloqueo', () => {
    const p = proceso({}, null);
    expect(esContratoReal(p)).toBeFalse();
    expect(tieneContratoActivoReal(p)).toBeFalse();
    expect(estadoContratoPill(p)).toBe('sin_fila');
    expect(estadoContratoPill(null)).toBe('sin_fila');
    expect(estadoContratoPill(undefined)).toBe('sin_fila');
  });

  // Caso real (CC 1006913166): el historial laboral decía CONTRATADO y el
  // header no pintaba pill, así que no había forma de dar de baja.
  it('contratado=true SIN fila de contrato sigue siendo contrato activo', () => {
    const p = proceso({ contratado: true }, null);
    expect(esContratoReal(p)).toBeTrue();
    expect(tieneContratoActivoReal(p)).toBeTrue();
    expect(estadoContratoPill(p)).toBe('activo');
  });

  // contrato_activo es nullable en el modelo: NULL no es una baja. Exigir
  // `=== true` dejaba estas filas en "en trámite", sin botón de baja, mientras
  // el historial las mostraba CONTRATADO.
  it('contratado=true con contrato_activo NULL sigue activo (NULL no es baja)', () => {
    const p = proceso({ contratado: true }, { contrato_activo: null });
    expect(tieneContratoActivoReal(p)).toBeTrue();
    expect(estadoContratoPill(p)).toBe('activo');
  });

  it('sin contratar y con contrato_activo NULL sigue siendo solo trámite', () => {
    const p = proceso({ contratado: false }, { contrato_activo: null });
    expect(tieneContratoActivoReal(p)).toBeFalse();
    expect(estadoContratoPill(p)).toBe('en_tramite');
  });

  describe('procesoVigente / procesoDeAntecedentes', () => {
    const cand = (procesos: any[], extra: Record<string, any> = {}) => ({
      ...extra,
      entrevistas: procesos.map(proc => (proc === null ? {} : { proceso: proc })),
    });

    it('obedece el proceso_vigente_id que resolvió el servidor', () => {
      const abierto = { id: 9 };
      const c = cand([{ id: 4, contratado: true }, abierto], { proceso_vigente_id: 9 });
      expect(procesoVigente(c)).toBe(abierto);
      expect(procesoDeAntecedentes(c)).toBe(abierto);
    });

    it('sin proceso_vigente_id (backend viejo) cae al primero que exista', () => {
      const primero = { id: 4 };
      expect(procesoVigente(cand([primero, { id: 9 }]))).toBe(primero);
    });

    it('un id que no está en la lista no rompe: cae a la heurística', () => {
      const primero = { id: 4 };
      expect(procesoVigente(cand([primero], { proceso_vigente_id: 999 }))).toBe(primero);
    });

    it('salta la entrevista sin proceso (turno nuevo recién abierto)', () => {
      const proc = { id: 7 };
      expect(procesoVigente(cand([null, proc]))).toBe(proc);
    });

    it('sin entrevistas / sin procesos devuelve null', () => {
      expect(procesoVigente(null)).toBeNull();
      expect(procesoVigente({ entrevistas: [] })).toBeNull();
      expect(procesoVigente(cand([null]))).toBeNull();
    });
  });

  describe('procesoDelContrato', () => {
    const cand = (procesos: any[], extra: Record<string, any> = {}) => ({
      ...extra,
      entrevistas: procesos.map(proc => ({ proceso: proc })),
    });

    it('obedece el proceso_contrato_id del servidor aunque no sea el vigente', () => {
      const conContrato = { id: 4, contratado: true };
      const c = cand([{ id: 9 }, conContrato], { proceso_contrato_id: 4 });
      expect(procesoDelContrato(c)).toBe(conContrato);
    });

    // Caso CC 1006913166: el contrato vive en el turno anterior, ya terminal,
    // mientras el vigente es el turno nuevo sin contrato.
    it('sin ids del servidor encuentra el contrato en un turno anterior', () => {
      const conContrato = { id: 4, contratado: true, contrato: { contrato_activo: true } };
      expect(procesoDelContrato(cand([{ id: 9 }, conContrato]))).toBe(conContrato);
    });
  });

  describe('esContratoRealMini (filas planas de by-document-min)', () => {
    it('fila esqueleto: contratado=false y sin contrato_fecha_ingreso → no real', () => {
      expect(esContratoRealMini({ contratado: false, contrato_fecha_ingreso: null })).toBeFalse();
    });

    it('contratado=true → real', () => {
      expect(esContratoRealMini({ contratado: true })).toBeTrue();
    });

    it('legacy con contrato_fecha_ingreso → real', () => {
      expect(esContratoRealMini({ contratado: false, contrato_fecha_ingreso: '2026-01-15' })).toBeTrue();
    });

    it('fila vacía / null → no real', () => {
      expect(esContratoRealMini({})).toBeFalse();
      expect(esContratoRealMini(null)).toBeFalse();
    });
  });

  // Tras dar de baja, ms-hr abre entrevista + proceso nuevos: la contratación arranca de cero.
  describe('turno tras baja', () => {
    const viejo = { id: 113136, contratado: false, rechazado: true,
      contrato: { contrato_activo: false, fecha_retiro: '2026-09-24' } };
    const nuevo = { id: 113200, contratado: false, contrato: null };
    const cand = { entrevistas: [
      { id: 2, created_at: '2026-09-24T21:00:00Z', proceso: nuevo },
      { id: 1, created_at: '2026-09-16T23:05:44Z', proceso: viejo },
    ] };

    it('el header sigue diciendo Sin contrato y lo vigente es el proceso nuevo', () => {
      expect(estadoContratoPill(procesoDelContrato(cand))).toBe('retirado');
      expect(procesoVigente(cand).id).toBe(113200);
      expect(turnoTrasBaja(cand)).toEqual({ procesoId: '113200', inicio: '2026-09-24T21:00:00Z' });
    });

    it('lo generado antes del proceso nuevo no cuenta', () => {
      expect(esAnteriorA('2026-09-24T13:16:13Z', '2026-09-24T21:00:00Z')).toBeTrue();
      expect(esAnteriorA('2026-09-24T22:00:00Z', '2026-09-24T21:00:00Z')).toBeFalse();
    });

    it('el contrato en curso es el proceso nuevo, no el retirado', () => {
      expect(procesoContratoEnCurso(cand)).toBe(nuevo);
    });

    it('sin proceso posterior a la baja el contrato en curso sigue siendo el retirado', () => {
      expect(procesoContratoEnCurso({ entrevistas: [{ proceso: viejo }] })).toBe(viejo);
    });

    it('un contrato vigente en un turno anterior sigue mandando', () => {
      const activo = { id: 113136, contratado: true, contrato: { contrato_activo: true } };
      expect(procesoContratoEnCurso({ entrevistas: [{ proceso: nuevo }, { proceso: activo }] })).toBe(activo);
    });

    it('sin contrato dado de baja en otro proceso no hay turno tras baja', () => {
      expect(turnoTrasBaja({ entrevistas: [{ created_at: '2026-09-24T21:00:00Z', proceso: nuevo }] })).toBeNull();
    });
  });

  // Recontratación: lo del contrato anterior no se ve ni cuenta en el proceso en curso.
  describe('contrato en curso', () => {
    const viejo = { id: 200000, contratado: true, contrato: { contrato_activo: true } };
    const nuevo = { id: 320000, contratado: false, contrato: null };
    const cand = { entrevistas: [
      { id: 2, created_at: '2026-10-14T15:00:00Z', proceso: nuevo },
      { id: 1, created_at: '2026-10-11T05:00:00Z', proceso: viejo },
    ] };
    const curso = contratoEnCurso(cand);

    it('con un contrato anterior (activo o retirado) el proceso en curso es el nuevo', () => {
      expect(curso).toEqual({ procesoId: '320000', inicio: '2026-10-14T15:00:00Z', anterior: true });
      const retirado = { ...viejo, contratado: false, contrato: { contrato_activo: false } };
      expect(contratoEnCurso({ entrevistas: [cand.entrevistas[0], { id: 1, proceso: retirado }] })?.anterior)
        .toBeTrue();
    });

    // CC 1122415324: el proceso dado de baja no tenía entrevista y no llegaba en el sobre;
    // su contrato y su ficha salían en verde en el contrato nuevo.
    it('el proceso anterior sin entrevista no impide esconder lo suyo (por fecha)', () => {
      const ivan = contratoEnCurso({ entrevistas: [
        { id: 392363, created_at: '2026-10-14T23:47:15Z',
          proceso: { id: 319720, created_at: '2026-10-14T23:47:15Z', contratado: true, contrato: { contrato_activo: true } } },
        { id: 392142, created_at: '2026-10-14T13:54:31Z', proceso: null },
      ] });
      expect(ivan).toEqual({ procesoId: '319720', inicio: '2026-10-14T23:47:15Z', anterior: false });
      expect(esDocumentoDeOtroContrato({ type: 25, created_at: '2026-10-14T20:17:57Z' }, ivan)).toBeTrue();
      expect(esDocumentoDeOtroContrato({ type: 34, created_at: '2026-10-14T20:17:57Z' }, ivan)).toBeTrue();
      expect(esDocumentoDeOtroContrato({ type: 32, created_at: '2026-10-14T23:50:15Z' }, ivan)).toBeFalse();
      // sin el anterior a la vista, lo que puede ser previo al proceso (robots) no se esconde
      expect(esDocumentoDeOtroContrato({ type: 3, created_at: '2026-10-14T20:10:22Z' }, ivan)).toBeFalse();
    });

    it('si el proceso en curso viene de una carga masiva solo cuenta la etiqueta', () => {
      const cargado = { id: PRIMER_PROCESO_FECHA_FIABLE - 1, contratado: true, contrato: { contrato_activo: true } };
      expect(contratoEnCurso({ entrevistas: [{ id: 1, created_at: '2026-10-11T05:00:00Z', proceso: cargado }] })).toBeNull();
      const c = contratoEnCurso({ entrevistas: [
        { id: 2, created_at: '2026-10-11T05:00:00Z', proceso: cargado },
        { id: 1, created_at: '2026-10-11T05:00:00Z', proceso: { id: 150000, contratado: true, contrato: { contrato_activo: false } } },
      ] });
      expect(c).toEqual({ procesoId: String(PRIMER_PROCESO_FECHA_FIABLE - 1), inicio: null, anterior: true });
      expect(esDocumentoDeOtroContrato({ type: 32, created_at: '2026-01-01T00:00:00Z' }, c)).toBeFalse();
      expect(esDocumentoDeOtroContrato({ type: 32, proceso_id: 150000 }, c)).toBeTrue();
    });

    it('etiquetado con proceso: solo cuenta el del proceso en curso', () => {
      expect(esDocumentoDeOtroContrato({ type: 32, proceso_id: 200000, created_at: '2026-10-15T00:00:00Z' }, curso)).toBeTrue();
      expect(esDocumentoDeOtroContrato({ type: 32, proceso_id: 320000 }, curso)).toBeFalse();
    });

    it('sin etiqueta: lo subido antes de arrancar el proceso en curso es del anterior', () => {
      expect(esDocumentoDeOtroContrato({ type: 32, created_at: '2026-10-13T10:00:00Z' }, curso)).toBeTrue();
      expect(esDocumentoDeOtroContrato({ type: 3, created_at: '2026-10-13T10:00:00Z' }, curso)).toBeTrue();
      expect(esDocumentoDeOtroContrato({ type: 32, created_at: '2026-10-14T16:00:00Z' }, curso)).toBeFalse();
    });

    it('los documentos de la persona valen para todos sus contratos', () => {
      for (const type of [15, 28, 29, 87, 88, 89, 237, 238]) {
        expect(esDocumentoDeOtroContrato({ type, proceso_id: 200000, created_at: '2026-01-01T00:00:00Z' }, curso)).toBeFalse();
      }
      expect(esDocumentoDeOtroContrato({ type: { id: 29 }, proceso_id: 200000 }, curso)).toBeFalse();
    });
  });

  // Antecedentes: en un contrato nuevo se vuelven a consultar (fecha más reciente).
  describe('filtro con la lista de documentos', () => {
    const ivan = contratoEnCurso({ entrevistas: [
      { id: 392363, created_at: '2026-10-14T23:47:15Z',
        proceso: { id: 319720, created_at: '2026-10-14T23:47:15Z', contratado: true, contrato: { contrato_activo: true } } },
    ] });

    it('documentos de contrato anteriores al proceso delatan un proceso anterior: antecedentes fuera', () => {
      const lista = [
        { type: 25, created_at: '2026-10-14T20:17:57Z' },
        { type: 3, created_at: '2026-10-14T20:10:22Z' },
        { type: 32, created_at: '2026-10-14T23:50:15Z' },
        { type: 29, created_at: '2026-09-16T23:05:54Z' },
      ];
      const esOtro = filtroOtroContrato(ivan, lista);
      expect(lista.filter(d => !esOtro(d)).map(d => d.type)).toEqual([32, 29]);
    });

    it('el proceso anterior que manda ms-hr aparte también cuenta', () => {
      const c = contratoEnCurso({
        entrevistas: [{ id: 2, created_at: '2026-10-14T23:47:15Z', proceso: { id: 319720, created_at: '2026-10-14T23:47:15Z' } }],
        proceso_anterior: { id: 319595, contratado: false, rechazado: true, contrato: { contrato_activo: false } },
      });
      expect(c?.anterior).toBeTrue();
      expect(filtroOtroContrato(c, [])({ type: 3, created_at: '2026-10-14T20:10:22Z' })).toBeTrue();
    });

    it('quien llega por primera vez conserva los antecedentes consultados al crear la cuenta', () => {
      const c = contratoEnCurso({ entrevistas: [
        { id: 1, created_at: '2026-10-14T10:00:00Z', proceso: { id: 320500, created_at: '2026-10-14T10:05:00Z' } },
      ] });
      const lista = [{ type: 29, created_at: '2026-10-14T09:00:00Z' }, { type: 3, created_at: '2026-10-14T09:01:00Z' }];
      const esOtro = filtroOtroContrato(c, lista);
      expect(lista.filter(d => !esOtro(d)).length).toBe(2);
    });
  });
});

describe('contratoFirmado (aviso de contrato activo solo tras firmar)', () => {
  const nuevo = { id: 319600, created_at: '2026-10-21T08:00:00', contratado: true };

  it('proceso nuevo sin solicitud de firma: no firmado', () => {
    expect(contratoFirmado(nuevo, null)).toBeFalse();
  });

  it('solicitud pendiente: no firmado', () => {
    expect(contratoFirmado(nuevo, { estado: 'PENDIENTE', firmada_en: null })).toBeFalse();
  });

  it('firmada después de arrancar el proceso (formato de ms-templates): firmado', () => {
    expect(contratoFirmado(nuevo, { estado: 'FIRMADA', firmada_en: '21/10/2026 10:15:00' })).toBeTrue();
  });

  it('firma de un contrato anterior: no vale', () => {
    expect(contratoFirmado(nuevo, { estado: 'FIRMADA', firmada_en: '14/10/2026 10:15:00' })).toBeFalse();
  });

  it('procesos de cargas masivas / Django cuentan como firmados', () => {
    expect(contratoFirmado({ id: 319000, contratado: true }, null)).toBeTrue();
  });

  it('esAnteriorA entiende dd/MM/yyyy HH:mm:ss', () => {
    expect(esAnteriorA('20/10/2026 23:59:59', '2026-10-21T00:00:00')).toBeTrue();
    expect(esAnteriorA('21/10/2026 00:00:01', '2026-10-21T00:00:00')).toBeFalse();
  });
});
