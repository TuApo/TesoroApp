/**
 * Datos 100 % ficticios del modo demostración (ver modo-demo.ts). Nombres inventados con
 * «Demo / Ejemplo / Prueba» y documentos del rango 90000000xx, que no corresponde a cédulas reales.
 * Son los mismos con los que se tomaron las capturas de la ficha de Google Play.
 *
 * El menú sale de `permisos_tree` del usuario: solo trae las pantallas que tienen datos aquí.
 * Lo que no está simulado contesta vacío (`[]` a un GET, `{}` al resto) y nunca sale a la red.
 */

type Params = URLSearchParams;
type Manejador = (q: Params, cuerpo: any, ruta: string) => any;
export interface RespuestaDemo { status: number; body: any; }

const rutas: { metodo: string; re: RegExp; fn: Manejador }[] = [];
const on = (metodo: string, re: RegExp, fn: Manejador) => rutas.push({ metodo, re, fn });

// Módulos que no están en el menú de la demostración: contestan 403, como el gateway a un usuario
// sin ese permiso (el interceptor no cierra sesión con 403). Sus widgets flotantes —turnos, chat,
// asistente— se apagan solos en vez de pintarse vacíos o romperse con una respuesta incompleta.
const SIN_PERMISO = /^\/api\/v1\/(turnos|comunicaciones|ai)\//;

export function responderDemo(metodo: string, ruta: string, q: Params, cuerpoTexto: string): RespuestaDemo {
  if (SIN_PERMISO.test(ruta)) return { status: 403, body: { detail: 'Modo demostración: módulo no disponible' } };
  let cuerpo: any = null;
  try { cuerpo = cuerpoTexto ? JSON.parse(cuerpoTexto) : null; } catch { cuerpo = cuerpoTexto; }
  for (const r of rutas) {
    if (r.metodo === metodo && r.re.test(ruta)) return { status: 200, body: r.fn(q, cuerpo, ruta) };
  }
  return { status: 200, body: metodo === 'GET' ? [] : {} };
}

// ─── Sesión ──────────────────────────────────────────────────────────────

const ACCIONES = ['READ', 'CREATE', 'UPDATE', 'DELETE'];
let n = 0;
const hoja = (nombre: string, ruta: string, icono: string) =>
  ({ id: `demo-n${++n}`, nombre, ruta, icono, acciones: ACCIONES, hijos: [] });
const grupo = (nombre: string, icono: string, hijos: any[]) =>
  ({ id: `demo-g${++n}`, nombre, icono, acciones: ACCIONES, hijos });

const permisos_tree = [
  grupo('Tesorería', 'account_balance_wallet', [
    hoja('Consulta de persona', 'treasury/consulta', 'person_search'),
    hoja('Informe de tesorería', 'treasury/informe', 'insights'),
  ]),
  grupo('Autorizaciones', 'verified', [
    hoja('Bono de mercado', 'authorizations/market-bonus', 'shopping_cart'),
    hoja('Autorizar préstamo', 'authorizations/money-loan', 'request_quote'),
  ]),
  grupo('Carné digital', 'badge', [hoja('Mi carné', 'carnet/mi-carnet', 'badge')]),
];

const usuario = {
  id: 'demo-0001',
  numero_de_documento: '9000000000',
  primer_nombre: 'Laura',
  segundo_nombre: '',
  primer_apellido: 'Demo',
  segundo_apellido: 'Restrepo',
  nombre: 'Laura Demo Restrepo',
  datos_basicos: { nombres: 'Laura', apellidos: 'Demo Restrepo' },
  correo_electronico: 'laura.demo@ejemplo.com',
  rol: { id: 1, nombre: 'ADMIN' },
  sede: { id: 1, nombre: 'SEDE DEMO' },
  empresa: { id: 1, nombre: 'Empresa Demo S.A.S.' },
  estado_solicitudes: true,
  is_active: true,
  permisos_tree,
};

// Con forma de JWT (el front lee `exp` para renovar), pero sin firma válida: no sirve en el API.
const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const TOKEN = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
  sub: 'demo-0001', iss: 'tuapo-demo', rol: 'ADMIN', exp: 1924992000, iat: 1761000000,
})}.demo`;

on('POST', /\/gestion_admin\/auth\/login\/?$/, () =>
  ({ token: TOKEN, refresh_token: 'refresh-demo', user: usuario, debe_cambiar_password: false }));
on('POST', /\/gestion_admin\/auth\/refresh\/?$/, () => ({ token: TOKEN, refresh_token: 'refresh-demo' }));
on('POST', /\/logout\/?$/, () => ({ ok: true }));
on('GET', /\/health\/?$/, () => ({ status: 'UP' }));
on('GET', /\/gestion_admin\/usuarios\/demo-0001\/?$/, () => usuario);
on('GET', /\/admin\/notificaciones\/no-leidas\/?$/, () => ({ count: 0 }));

// ─── Tesorería ───────────────────────────────────────────────────────────

const personas: [string, string, string, string, number][] = [
  ['9000000011', 'MARIANA ISABEL QUINTERO DEMO', 'FINCA LOS ALMENDROS', 'HABILITADO', 0],
  ['9000000012', 'JULIÁN ANDRÉS PRIETO EJEMPLO', 'FINCA EL MIRADOR', 'HABILITADO', 85000],
  ['9000000013', 'SOFÍA VALENTINA MORA PRUEBA', 'FINCA LA ESPERANZA', 'EN_MORA', 412000],
  ['9000000014', 'CAMILO ESTEBAN ROJAS DEMO', 'FINCA SAN RAFAEL', 'HABILITADO', 120000],
  ['9000000015', 'DANIELA PAOLA SUÁREZ EJEMPLO', 'FINCA LOS ALMENDROS', 'BLOQUEADO', 0],
  ['9000000016', 'SANTIAGO DAVID LÓPEZ PRUEBA', 'FINCA EL MIRADOR', 'HABILITADO', 45000],
  ['9000000017', 'VALERIA ALEJANDRA RUIZ DEMO', 'FINCA LA ESPERANZA', 'HABILITADO', 0],
  ['9000000018', 'MATEO NICOLÁS HERRERA EJEMPLO', 'FINCA SAN RAFAEL', 'RETIRADO', 0],
];
const lista = personas.map(([doc, nombre, finca, estado, saldo], i) => ({
  numero_documento: doc, nombre, codigo: `CT-2026-${String(410 + i).padStart(4, '0')}`, finca,
  temporal: i % 2 ? 'TEMPORAL DEMO S.A.S.' : 'SERVICIOS EJEMPLO S.A.S.', ingreso: `2025-0${(i % 8) + 1}-15`,
  activo: estado !== 'RETIRADO', bloqueado: estado === 'BLOQUEADO',
  observacion_bloqueo: estado === 'BLOQUEADO' ? 'Bloqueo de demostración' : null,
  en_padron_activos: estado !== 'RETIRADO', paz_y_salvo: saldo === 0, saldo_pendiente: saldo, estado,
}));

const regla = (codigo: string, nombre: string, tipo: string, estado: string, mensaje: string, severidad = 'BLOQUEA') =>
  ({ codigo, nombre, tipo, severidad, estado, mensaje, bloquea: false, advierte: false, detalle: {} });

const evaluacion = (concepto: string, monto: number | null) => {
  const tope = concepto === 'PRESTAMO' ? 600000 : 350000;
  const saldo = 85000, comprometido = 40000, cupo = tope - saldo - comprometido;
  return {
    concepto, aprobado: monto == null || monto <= cupo, motivo: monto != null && monto > cupo ? 'El monto supera el cupo disponible' : null,
    tope_base: tope, tope_aplicado: tope, origen_tope: 'TRAMO_ANTIGUEDAD', origen_tope_texto: 'Tope por antigüedad (7 a 12 meses)',
    saldo_pendiente: saldo, monto_comprometido: comprometido, cupo_disponible: cupo, monto_solicitado: monto ?? null,
    dias_trabajados: 287, meses_trabajados: 9, con_excepcion_de_rol: false, advertencias: [],
    reglas: [
      regla('ACTIVO_PADRON', 'Activo en el padrón vigente', 'PADRON', 'CUMPLE', 'Aparece en el corte del 23/10/2026'),
      regla('ANTIGUEDAD_MIN', 'Antigüedad mínima', 'ANTIGUEDAD', 'CUMPLE', '287 días trabajados (mínimo 30)'),
      regla('TOPE_TRAMO', 'Tope por antigüedad', 'TOPE_TRAMOS', 'CUMPLE', `Tope de $${tope.toLocaleString('es-CO')} para 7 a 12 meses`),
      regla('SIN_BLOQUEO', 'Sin bloqueo vigente', 'BLOQUEO', 'CUMPLE', 'La persona no tiene bloqueos'),
      regla('MAX_PENDIENTES', 'Máximo de solicitudes pendientes', 'CONTEO', 'CUMPLE', '1 pendiente de 2 permitidas', 'ADVIERTE'),
    ],
  };
};

const solicitud = (id: number, concepto: string, monto: number, estado: string, fecha: string, ejecutado: boolean) => ({
  id, codigo_autorizacion: `AUT-${70000 + id}`, codigo_ejecucion: estado === 'EJECUTADA' ? `EJE-${50000 + id}` : null,
  concepto, monto_autorizado: monto, monto_ejecutado: estado === 'EJECUTADA' ? monto : null, cuotas: concepto === 'PRÉSTAMO' ? 2 : 1,
  estado, estado_texto: estado === 'PENDIENTE' ? 'Pendiente de entrega' : estado === 'EJECUTADA' ? 'Entregado' : 'Anulada',
  vencida: false, es_reversa: false, dias_para_vencer: estado === 'PENDIENTE' ? 6 : undefined,
  autorizado_por: 'Laura Demo Restrepo', autorizado_en: `${fecha}T09:12:00`, sede_autorizacion: 'SEDE DEMO',
  ejecutado_por: ejecutado ? 'Carlos Ejemplo' : null, ejecutado_en: ejecutado ? `${fecha}T15:40:00` : null,
  sede_ejecucion: ejecutado ? 'SEDE DEMO' : null, forma_pago: concepto === 'MERCADO' ? 'Bono de mercado' : 'Daviplata',
  numero_pago: null, nombre_quien_entrego: ejecutado ? 'Carlos Ejemplo' : null, observacion: null,
  motivo_anulacion: estado === 'ANULADA' ? 'Solicitud duplicada (demo)' : null,
  vence_en: estado === 'PENDIENTE' ? '2026-10-30' : null, origen: 'APP',
});

const ficha = (doc: string, concepto: string, monto: number | null) => {
  const p = lista.find((x) => x.numero_documento === doc) ?? lista[1];
  const alterno = concepto === 'PRESTAMO' ? 'MERCADO' : 'PRESTAMO';
  return {
    numero_documento: doc, existe: true,
    persona: {
      numero_documento: p.numero_documento, nombre: p.nombre, codigo: p.codigo, finca: p.finca, temporal: p.temporal, salario: 1423500,
      ingreso_texto: '09/01/2026', ingreso: '2026-01-09', dias_trabajados: 287, meses_trabajados: 9, activo: true, bloqueado: false,
      observacion_bloqueo: null, fecha_bloqueo: null, observacion_desbloqueo: null, fecha_desbloqueo: null,
      actualizado_en: '2026-10-23T05:30:00', ingreso_ilegible: false, en_padron_activos: true, paz_y_salvo: null, tope_padron: null,
    },
    deuda: { total: 85000, desglose: { MERCADO: 45000, PRESTAMO: 40000 }, comprometido: 40000, cuotas: { MERCADO: 1, PRESTAMO: 2 } },
    evaluacion: evaluacion(concepto, monto),
    evaluacion_alterna: {
      concepto: alterno, aprobado: true, motivo: null,
      tope_aplicado: alterno === 'PRESTAMO' ? 600000 : 350000, cupo_disponible: alterno === 'PRESTAMO' ? 475000 : 225000,
    },
    solicitudes: [
      solicitud(1, 'PRÉSTAMO', 80000, 'PENDIENTE', '2026-10-20', false),
      solicitud(2, 'MERCADO', 45000, 'EJECUTADA', '2026-10-08', true),
      solicitud(3, 'PRÉSTAMO', 150000, 'EJECUTADA', '2026-09-12', true),
      solicitud(4, 'MERCADO', 60000, 'ANULADA', '2026-08-29', false),
    ],
    resumen_solicitudes: { pendientes: 1, ejecutadas: 2, anuladas: 1, monto_comprometido: 40000 },
    alertas: [{ nivel: 'aviso', titulo: 'Préstamo pendiente de entrega', detalle: 'Hay un préstamo autorizado el 20/10/2026 que vence el 30/10/2026.' }],
    notas: [],
  };
};

const sinTildes = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const numero = (v: string | null) => (v ? Number(v) : null);

on('GET', /\/gestion_tesoreria\/personas\/buscar\/?$/, (q) => {
  const t = sinTildes(q.get('q') ?? '');
  if (t.length < 2) return [];
  return lista.filter((p) => sinTildes(p.nombre).includes(t) || p.numero_documento.includes(t) || p.codigo.includes(t) || t === 'DEMO');
});
on('GET', /\/gestion_tesoreria\/personas\/[^/]+\/ficha\/?$/, (q, _c, ruta) =>
  ficha(/personas\/([^/]+)\/ficha/.exec(ruta)![1], q.get('concepto') ?? 'MERCADO', numero(q.get('monto'))));
on('GET', /\/gestion_tesoreria\/evaluar\/?$/, (q) => evaluacion(q.get('concepto') ?? 'MERCADO', numero(q.get('monto'))));
on('GET', /\/gestion_tesoreria\/personas\/resumen\/?$/, () => ({ total: 1311, activos: 1248, bloqueados: 37 }));

// La autorización se «crea» en la demostración: devuelve un código y no guarda nada.
on('POST', /\/gestion_tesoreria\/transacciones\/autorizar\/?$/, (_q, c) => ({
  id: 90001, codigo_autorizacion: `AUT-DEMO-${Math.floor(10000 + Math.random() * 89999)}`, estado: 'PENDIENTE',
  numero_documento: c?.numero_documento ?? null, concepto: c?.autorizacion_concepto ?? null, monto_autorizado: c?.autorizacion_monto ?? null,
  vence_en: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10),
}));

const corte = {
  id: 31, fecha_corte: '2026-10-23', generado_en: '2026-10-23T05:30:12', generado_por: null, origen: 'AUTOMATICO', duracion_ms: 4210,
  personas_evaluadas: 1248, reglas_omitidas: null, detalle_disponible: true,
  resumen: {
    fecha_corte: '2026-10-23', personas_activas: 1248, bloqueadas: 37, con_deuda: 412, deuda_total: 48650000, deuda_mercado: 21300000,
    deuda_prestamo: 27350000, comprometido_total: 6120000, con_comprometido: 88,
    mercado: {
      elegibles: 1102, con_cupo: 934, cupo_agotado: 168, sin_tope: 0, no_elegibles: 146, capacidad: 385700000, cupo_disponible: 312400000,
      utilizacion: 0.19, cupo_promedio: 334500, motivos: { 'Antigüedad menor a 30 días': 98, 'Bloqueado': 37, 'Fuera del padrón': 11 },
    },
    prestamo: {
      elegibles: 986, con_cupo: 801, cupo_agotado: 185, sin_tope: 0, no_elegibles: 262, capacidad: 591600000, cupo_disponible: 517900000,
      utilizacion: 0.12, cupo_promedio: 646500, motivos: { 'Antigüedad menor a 90 días': 214, 'Bloqueado': 37, 'En mora': 11 },
    },
    uso: { usaron_30d: 356, usaron_90d: 701, nunca_usaron: 302, penetracion_90d: 0.56 },
    oportunidad: { personas: 547, cupo_mercado: 182900000 },
  },
};
const cortes = Array.from({ length: 12 }, (_, i) => {
  const r = JSON.parse(JSON.stringify(corte.resumen));
  const fecha = new Date(Date.UTC(2026, 9, 23 - i * 7)).toISOString().slice(0, 10);
  r.fecha_corte = fecha;
  r.personas_activas = Math.round(1248 * (1 - i * 0.025));
  r.deuda_total = Math.round(48650000 * (0.8 + i * 0.03));
  r.mercado.utilizacion = 0.19 + (i % 4) * 0.02;
  r.prestamo.utilizacion = 0.12 + (i % 3) * 0.02;
  return { ...corte, id: 31 - i, fecha_corte: fecha, resumen: r };
});
on('GET', /\/gestion_tesoreria\/informe\/estado\/?$/, () => ({
  corte,
  padron: { total: 1311, activos: 1248, bloqueados: 37, ultima_actualizacion: '2026-10-23T05:30:00', activos_desactualizados: 0 },
  pendientes: {
    autorizaciones: 88, personas: 81, monto: 6120000, viejas_30d: 4, personas_viejas_30d: 4, monto_viejas_30d: 210000,
    sin_vencimiento: 0, montos_atipicos: 0, mas_antigua: '2026-09-18',
  },
  nombres_reglas: { ACTIVO_PADRON: 'Activo en el padrón vigente', ANTIGUEDAD_MIN: 'Antigüedad mínima', TOPE_TRAMO: 'Tope por antigüedad' },
  monto_atipico: 2000000, generando: false, ultimo_error: null,
}));
on('GET', /\/gestion_tesoreria\/informe\/cortes\/?$/, () => cortes);

// ─── Inicio: indicadores de contratación ─────────────────────────────────

const sedes = ['SEDE NORTE', 'SEDE CENTRO', 'SEDE SUR', 'SEDE DEMO', 'SEDE OCCIDENTE'];
const procesos = Array.from({ length: 140 }, (_, i) => {
  const etapa = i % 7, f = `2026-10-${String((i % 22) + 1).padStart(2, '0')}T10:00:00`;
  return {
    id: i + 1, oficina_creacion: sedes[i % 5], entrevistado_at: f, prueba_tecnica_at: etapa >= 1 ? f : null,
    examenes_medicos_at: etapa >= 2 ? f : null, contratado_at: etapa >= 3 ? f : null, ingreso_at: etapa >= 5 ? f : null,
    rechazado_at: etapa === 6 && i % 2 ? f : null,
  };
});
on('GET', /\/gestion_contratacion\/procesos\/?$/, () => ({ count: procesos.length, results: procesos }));
on('GET', /\/publicacion\/publicaciones\/?$/, () => ({ results: Array.from({ length: 18 }, (_, i) => ({ id: i, activo: i < 12 })) }));
on('GET', /\/gestion_afiliaciones\/contratos\/resumen\/?$/, () => ({
  kpis: { totalPendientes: 23, totalIngresos: 61 },
  porOficina: sedes.map((o, i) => ({ clave: o, oficina: o, total: 20 + i * 4, contratados: 15 + i * 3, pendientes: 5 + i })),
}));
on('GET', /\/gestion_afiliaciones\/contratos\/timeline\/?$/, () => Array.from({ length: 22 }, (_, m) => ({
  fecha: `${2025 + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}-01`, clave: 'SEDE DEMO',
  total: 40 + Math.round(25 * Math.sin(m / 2.5)) + m * 2,
})));

// ─── Carné digital ───────────────────────────────────────────────────────

const FOTO = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 360"><defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1">'
  + '<stop offset="0" stop-color="#dbeafe"/><stop offset="1" stop-color="#bfdbfe"/></linearGradient></defs>'
  + '<rect width="300" height="360" fill="url(#f)"/><path d="M60 360c0-70 40-110 90-110s90 40 90 110z" fill="#1e3a8a"/>'
  + '<path d="M128 238h44v30l-22 18-22-18z" fill="#f1c7a4"/><ellipse cx="150" cy="160" rx="62" ry="74" fill="#5b3a29"/>'
  + '<ellipse cx="150" cy="172" rx="50" ry="60" fill="#f6d2b3"/>'
  + '<path d="M96 150c8-48 40-66 66-62 30 4 46 30 44 62-20-18-58-26-110 0z" fill="#5b3a29"/>'
  + '<circle cx="131" cy="172" r="5" fill="#3b2a20"/><circle cx="169" cy="172" r="5" fill="#3b2a20"/>'
  + '<path d="M136 204q14 10 28 0" stroke="#b45b4d" stroke-width="4" fill="none" stroke-linecap="round"/></svg>');

on('GET', /\/gestion_contratacion\/carnet\/mi-carnet\/?$/, () => ({
  cedula: '9000000000', tipoDocumento: 'CC', nombreCompleto: 'LAURA DEMO RESTREPO', cargo: 'AUXILIAR DE TESORERÍA',
  empresa: 'EMPRESA DEMO S.A.S.', oficina: 'SEDE DEMO', centroCosto: 'ADMINISTRATIVO', temporal: 'TEMPORAL DEMO S.A.S.',
  eps: 'EPS EJEMPLO', afp: 'FONDO EJEMPLO', arl: 'ARL EJEMPLO', rh: 'O+', numeroContrato: 'CT-2026-0001', codigoCarnet: 'TA-000123',
  fechaIngreso: '2025-02-03', fechaRetiro: '', estado: 'ACTIVO', esEmpleado: true, fotoUrl: FOTO,
  qrToken: 'demo.' + 'x'.repeat(120), emitidoEn: new Date().toISOString(), expiraEn: new Date(Date.now() + 864e5).toISOString(),
}));
