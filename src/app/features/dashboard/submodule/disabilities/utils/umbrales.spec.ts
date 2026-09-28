import { CadenaUmbral } from '../models/incapacidad-gestion.model';
import {
  acumuladoAl,
  aFecha,
  cumpleCambio,
  enAlcance,
  estadoAlCorte,
  panorama,
  pagadorSegunDia,
  relativo,
  sumarDias,
} from './umbrales';

const HOY = new Date(2026, 8, 28); // 28/09/2026

function iso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Cadena vigente que HOY va en `diaHoy` y tiene registrado hasta `diasRestantes` mas. */
function vigente(diaHoy: number, diasRestantes: number, extra: Partial<CadenaUmbral> = {}): CadenaUmbral {
  const inicio = sumarDias(HOY, -(diaHoy - 1));
  const fin = sumarDias(HOY, diasRestantes);
  return base({
    situacion: 'VIGENTE',
    inicioCadena: iso(inicio),
    fechaFinUltima: iso(fin),
    diasAcumuladosFin: diaHoy + diasRestantes,
    diasAcumuladosHoy: diaHoy,
    ...extra,
  });
}

function base(extra: Partial<CadenaUmbral>): CadenaUmbral {
  return {
    incapacidadId: 1, codigoConsecutivo: 'APTC001', cedula: '1070982591', nombreCompleto: 'ANA PEREZ',
    empresa: 'ELITE', centroCosto: 'BELCHITE', oficina: 'TOCANCIPA', entidadGrupo: 'APOYO',
    eps: 'NUEVA EPS', afp: 'PORVENIR', codigoDiagnostico: 'M545', descripcionDiagnostico: 'Lumbago',
    fechaInicioUltima: null, fechaFinUltima: null, diasUltima: 10, origen: null,
    situacion: 'VIGENTE', situacionEtiqueta: 'Incapacitado hoy', motivoRevision: null,
    inicioCadena: null, diasAcumuladosFin: 0, diasAcumuladosHoy: 0,
    fechaPasaFondo: null, fondoCertificado: false, fechaVuelveEps: null, epsCertificado: false,
    pagadorHoy: 'EPS', pagadorHoyEtiqueta: 'EPS',
    ...extra,
  };
}

describe('umbrales 180/540 en el tiempo', () => {
  it('lee yyyy-MM-dd como fecha local (sin correrse un dia por UTC)', () => {
    const d = aFecha('2026-09-28')!;
    expect(d.getDate()).toBe(28);
    expect(d.getMonth()).toBe(8);
    expect(aFecha(null)).toBeNull();
  });

  it('pagador por dia: 1-180 EPS, 181-540 fondo, 541+ EPS de nuevo', () => {
    expect(pagadorSegunDia(180)).toBe('EPS');
    expect(pagadorSegunDia(181)).toBe('FONDO_PENSIONES');
    expect(pagadorSegunDia(540)).toBe('FONDO_PENSIONES');
    expect(pagadorSegunDia(541)).toBe('EPS_POST_540');
  });

  it('una cadena vigente suma hasta el fin registrado; con prorrogas, tambien despues', () => {
    const c = vigente(100, 10); // hoy dia 100, registrado hasta el dia 110
    expect(acumuladoAl(c, HOY, false)).toBe(100);
    expect(acumuladoAl(c, sumarDias(HOY, 30), false)).toBe(110);
    expect(acumuladoAl(c, sumarDias(HOY, 30), true)).toBe(130);
  });

  it('una cadena que ya termino no suma mas dias', () => {
    const c = base({ situacion: 'RECIENTE', diasAcumuladosFin: 200, diasAcumuladosHoy: 200 });
    expect(acumuladoAl(c, sumarDias(HOY, 60), true)).toBe(200);
  });

  it('detecta quien pasa al fondo entre hoy y la fecha de analisis', () => {
    const c = vigente(170, 5); // registrado hasta el dia 175
    const certificado = estadoAlCorte(c, HOY, sumarDias(HOY, 15), false);
    expect(certificado.pasaAlFondo).toBeFalse(); // solo con lo registrado no llega a 181
    const siSigue = estadoAlCorte(c, HOY, sumarDias(HOY, 15), true);
    expect(siSigue.diasAlCorte).toBe(185);
    expect(siSigue.pasaAlFondo).toBeTrue();
    expect(siSigue.pagadorAlCorte).toBe('FONDO_PENSIONES');
    expect(cumpleCambio(siSigue, 'PASAN_FONDO')).toBeTrue();
    expect(cumpleCambio(siSigue, 'CON_EPS')).toBeFalse();
  });

  it('el panorama cuenta SOLO los casos activos, hoy y a cada horizonte', () => {
    const cadenas = [
      vigente(170, 5),                                   // pasa al fondo si sigue
      vigente(200, 30),                                  // ya con el fondo
      vigente(535, 40),                                  // cruza 540 dentro de lo registrado
      base({ situacion: 'RECIENTE', diasAcumuladosFin: 250, diasAcumuladosHoy: 250 }),
      base({ situacion: 'HISTORICO', diasAcumuladosFin: 400, diasAcumuladosHoy: 400 }),
      base({ situacion: 'POR_REVISAR', diasAcumuladosFin: 328720, diasAcumuladosHoy: 328720 }),
    ];

    const [hoy, en15, en30] = panorama(cadenas, HOY, [15, 30], true);

    expect(hoy.dias).toBe(0);
    expect(hoy.conEps).toBe(1);
    expect(hoy.conFondo).toBe(3);  // 200 y 535 vigentes + 250 reciente
    expect(hoy.post540).toBe(0);
    expect(hoy.pasanAlFondo).toBe(0);

    expect(en15.conFondo).toBe(3); // la de 170 ya paso
    expect(en15.pasanAlFondo).toBe(1);
    expect(en15.post540).toBe(1);  // la de 535 cruza el dia 541
    expect(en15.vuelvenEps).toBe(1);

    expect(en30.fecha.getDate()).toBe(28);
    expect(en30.fecha.getMonth()).toBe(9); // 28/10
  });

  it('solo lo certificado: una cadena no pasa del fin registrado', () => {
    const [, en30] = panorama([vigente(170, 5)], HOY, [30], false);
    expect(en30.conEps).toBe(1);
    expect(en30.pasanAlFondo).toBe(0);
  });

  it('alcance: "activos" = incapacitado hoy + termino hace poco', () => {
    expect(enAlcance(base({ situacion: 'VIGENTE' }), 'ACTIVOS')).toBeTrue();
    expect(enAlcance(base({ situacion: 'RECIENTE' }), 'ACTIVOS')).toBeTrue();
    expect(enAlcance(base({ situacion: 'HISTORICO' }), 'ACTIVOS')).toBeFalse();
    expect(enAlcance(base({ situacion: 'POR_REVISAR' }), 'ACTIVOS')).toBeFalse();
    expect(enAlcance(base({ situacion: 'HISTORICO' }), 'HISTORICO')).toBeTrue();
  });

  it('textos relativos', () => {
    expect(relativo(HOY, HOY)).toBe('hoy');
    expect(relativo(sumarDias(HOY, 1), HOY)).toBe('mañana');
    expect(relativo(sumarDias(HOY, 12), HOY)).toBe('en 12 días');
    expect(relativo(sumarDias(HOY, -3), HOY)).toBe('hace 3 días');
  });
});
