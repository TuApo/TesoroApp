/**
 * Llenado del formulario "Ficha Técnica" (Docs/Ficha tecnica.pdf) — variante
 * **Apoyo Laboral** (la temporal "apoyo").
 *
 * El PDF tiene 2 páginas y 242 widgets (236 TextFields + 6 botones de imagen
 * para logo, firmas, foto y huella).
 *
 * Datos consumidos provienen de `gestion_contratacion.CandidatoDetailSerializer`
 * (snake_case nativo). Si un campo del candidato no existe se deja en blanco;
 * NUNCA lanza error.
 *
 * Las imágenes (firmas, foto, huella, logo) se inyectan fuera de este helper
 * porque dependen de servicios del componente.
 */

import type { PDFForm, PDFFont } from 'pdf-lib';
import { centroDeCostosDe } from '../../shared/contrato-campos';
import { esReferenciaFamiliar, separarReferencias } from './referencias.util';
import { sanitizedString } from './winansi.util';
import { tituloOUltimoGrado } from './escolaridad.util';

type Cand = any;

const s = (v: any): string => sanitizedString(v);
const upper = (v: any): string => s(v).toUpperCase();
const norm = (v: any): string => s(v).normalize('NFC');

/** Convierte fecha ISO (YYYY-MM-DD) a DD/MM/YYYY. */
function parseDateToDDMMYYYY(iso: any): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s(iso));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s(iso);
}

/** Formato $ 1.234.567 (peso colombiano sin decimales). */
function formatMoneyCOP(v: any): string {
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n) || n === 0) return '';
  return '$ ' + n.toLocaleString('es-CO', { maximumFractionDigits: 0 });
}

function getFamiliar(familiares: any[], tipo: string): any | null {
  if (!Array.isArray(familiares)) return null;
  return familiares.find(f => upper(f?.tipo) === tipo) || null;
}

/** "SI"/"NO"/"" según valor booleano-ish. */
function siNo(v: any): string {
  if (v === true || upper(v) === 'TRUE' || upper(v) === 'SI' || upper(v) === 'SÍ' || upper(v) === '1' || upper(v) === 'Y') return 'SI';
  if (v === false || upper(v) === 'FALSE' || upper(v) === 'NO' || upper(v) === '0' || upper(v) === 'N') return 'NO';
  return '';
}

/** Datos derivados que el componente prepara y entrega al helper. */
export interface FichaTecnicaContext {
  /** Código de contrato a imprimir en cabecera (puede venir promptado). */
  codigoContrato: string;
  /** Nombre de la sede del usuario logueado. */
  sedeNombre: string;
  /** Empresa usuaria (cliente) — `vacante.empresa_usuaria_solicita`. */
  empUsuaria: string;
  /**
   * Temporal empleadora — `vacante.temporal` (Apoyo Laboral / Tu Alianza).
   * La autorización de estudios de seguridad cubre a las DOS empresas: quien
   * contrata y donde se presta el servicio.
   */
  temporal: string;
  /** Nombre de quien firma como representante administrativo (verificador refs). */
  personaQueFirma: string;
  /** Resultado de getRutaInfo del componente: `usaRuta` (texto) y demás. */
  usaRuta: string;
  /** Auxilio de transporte de la vacante (texto crudo). */
  auxilio_transporte: string;
  /**
   * Centro de costos TAL COMO SALE EN EL CONTRATO (`centroCostoDoc`:
   * `contrato.centro_costo_obra` → `vacante.finca`). La ficha debe imprimir el
   * mismo valor que el contrato; la pestaña de nómina (`Ccentro_de_costos`)
   * queda vieja cuando reasignan la vacante y las dos hojas salían distintas.
   */
  centroCosto: string;
  /** Cargo de la vacante tal como sale impreso en el contrato. */
  cargo: string;
  /** Pool de descripciones aleatorias para referencias personales (REFERENCIAS_A). */
  referenciasA: readonly string[];
  /** Pool de descripciones aleatorias para referencias familiares (REFERENCIAS_F). */
  referenciasF: readonly string[];
}

/** Saca 2 strings distintos de un pool (con normalización). */
function pickTwoDistinct(arr: readonly string[]): [string, string] {
  const norm = (x: unknown) => String(x ?? '').trim().replace(/\s+/g, ' ');
  const unique = Array.from(new Set((arr ?? []).map(norm).filter(v => v.length > 0)));
  if (unique.length === 0) return ['', ''];
  if (unique.length === 1) return [unique[0], ''];
  const i = Math.floor(Math.random() * unique.length);
  const j = (i + 1 + Math.floor(Math.random() * (unique.length - 1))) % unique.length;
  return [unique[i], unique[j]];
}

export function fillFichaTecnicaPdf(
  form: PDFForm,
  customFont: PDFFont | undefined,
  candidato: Cand,
  vacante: Cand | null,
  ctx: FichaTecnicaContext
): void {
  // ─────── helpers de escritura ───────
  // Tamaño por defecto para los campos del PDF: la fuente del DA original es
  // muy pequeña, así que forzamos 7pt (legible) cuando no se especifique otro.
  const DEFAULT_FONT_SIZE = 7;

  const setText = (campo: string, valor: any, fontSize: number = DEFAULT_FONT_SIZE): void => {
    if (valor === undefined || valor === null) return;
    const v = s(valor);
    if (!v) return;
    try {
      const field = form.getTextField(campo);
      if (fontSize > 0) field.setFontSize(fontSize);
      field.setText(v);
      if (customFont) {
        try { field.updateAppearances(customFont); } catch { /* ignore */ }
      }
    } catch {
      // campo no existe — se ignora
    }
  };

  /** Marca con "X" el campo si la condición es verdadera. */
  const setXIf = (campo: string, cond: boolean): void => {
    if (cond) setText(campo, 'X');
  };

  // ─────── derivados del candidato ───────
  const cand: Cand = candidato || {};
  const vac: Cand = vacante || {};
  const contacto: Cand = cand.contacto || {};
  const residencia: Cand = cand.residencia || {};
  const infoCc: Cand = cand.info_cc || {};
  const dotacion: Cand = cand.dotacion || {};
  const familiares: Cand[] = Array.isArray(cand.familiares) ? cand.familiares : [];
  const referencias: Cand[] = Array.isArray(cand.referencias) ? cand.referencias : [];
  const formaciones: Cand[] = Array.isArray(cand.formaciones) ? cand.formaciones : [];
  const experiencias: Cand[] = Array.isArray(cand.experiencias) ? cand.experiencias : [];
  const hijos: Cand[] = Array.isArray(cand.hijos) ? cand.hijos : [];

  const entrevista: Cand = (Array.isArray(cand.entrevistas) && cand.entrevistas[0]) || {};
  const proceso: Cand = entrevista.proceso || {};
  const contrato: Cand = proceso.contrato || {};
  const antecedentes: Cand[] = Array.isArray(proceso.antecedentes) ? proceso.antecedentes : [];

  const findAnte = (nombre: string) =>
    antecedentes.find(a => upper(a?.nombre) === upper(nombre));
  const epsAnte = s(findAnte('EPS')?.observacion);
  const afpAnte = s(findAnte('AFP')?.observacion);

  const conyuge = getFamiliar(familiares, 'CONYUGUE');
  const padre = getFamiliar(familiares, 'PADRE');
  const madre = getFamiliar(familiares, 'MADRE');
  const emergencia =
    getFamiliar(familiares, 'EMERGENCIA') ||
    referencias.find(r => esReferenciaFamiliar(r?.tipo)) || null;

  // Composición de nombres
  const apellidos = norm([s(cand.primer_apellido), s(cand.segundo_apellido)].filter(Boolean).join(' '));
  const nombres = norm([s(cand.primer_nombre), s(cand.segundo_nombre)].filter(Boolean).join(' '));
  const nombreCompleto = norm([nombres, apellidos].filter(Boolean).join(' '));

  // ════════════════════════════════════════════════════════════════════
  // CABECERA
  // ════════════════════════════════════════════════════════════════════
  setText('CodContrato', ctx.codigoContrato, 7.2);
  // El PDF a veces tiene un campo `codigo_contrato` redundante.
  setText('codigo_contrato', ctx.codigoContrato, 7.2);
  setText('sede', ctx.sedeNombre, 7.2);

  // ════════════════════════════════════════════════════════════════════
  // IDENTIFICACIÓN
  // ════════════════════════════════════════════════════════════════════
  setText('1er ApellidoRow1', norm(cand.primer_apellido));
  setText('2do ApellidoRow1', norm(cand.segundo_apellido));
  setText('NombresRow1', nombres);
  setText('Tipo Documento IdentificaciónRow1', upper(cand.tipo_doc));
  setText('Número de IdentificaciónRow1', s(cand.numero_documento));

  // Expedición
  setText('Fecha de ExpediciónRow1', parseDateToDDMMYYYY(infoCc.fecha_expedicion));
  setText('Departamento de ExpediciónRow1', norm(infoCc.depto_expedicion));
  setText('Municipio de ExpediciónRow1', norm(infoCc.mpio_expedicion));

  // Nacimiento + género
  setText('GeneroRow1', norm(cand.sexo));
  setText('Fecha de NacimientoRow1', parseDateToDDMMYYYY(cand.fecha_nacimiento));
  setText('Departamento de NacimientoRow1', norm(infoCc.depto_nacimiento));
  setText('Municipio de NacimientoRow1', norm(infoCc.mpio_nacimiento));

  // Estado civil — marca con "X" en la opción que corresponde.
  const ec = upper(cand.estado_civil);
  setXIf('SolteroEstado Civil',     ['SO', 'SOLTERO', 'S'].includes(ec) || ec.includes('SOLTER'));
  setXIf('CasadoEstado Civil',      ['CA', 'CASADO'].includes(ec) || ec.includes('CASAD'));
  setXIf('Unión LibreEstado Civil', ['UN', 'UL'].includes(ec) || ec.includes('UNION') || ec.includes('UNIÓN'));
  setXIf('SeparadoEstado Civil',    ['SE', 'SEP', 'SEPARADO'].includes(ec) || ec.includes('SEPARAD'));
  setXIf('ViudoEstado Civil',       ['VI', 'VIUDO'].includes(ec) || ec.includes('VIUD'));
  // "Otro" si no matchea ninguno y hay valor
  const conocidos = /SOLTER|CASAD|UNI[ÓO]N|UN\b|UL\b|SEPARAD|VIUD|^SO$|^CA$|^SE$|^VI$/;
  if (ec && !conocidos.test(ec)) setXIf('OtroEstado Civil', true);

  // ════════════════════════════════════════════════════════════════════
  // CONTACTO / RESIDENCIA / RH / MANO
  // ════════════════════════════════════════════════════════════════════
  setText('Dirección de DomicilioRow1', norm(residencia.direccion));
  setText('BarrioRow1', norm(residencia.barrio));
  setText('Ciudad DomicilioRow1', norm(cand.municipio));
  setText('DepartamentoRow1', norm(cand.departamento));
  setText('CelularRow1', s(contacto.celular));
  setText('Correo ElectrónicoRow1', s(contacto.email));

  // Grupo sanguíneo + estatura/peso (algunos templates los tienen separados)
  setText('CelularGrupo Sanguineo y RH', upper(cand.rh));

  // Mano hábil
  const mano = upper(cand.zurdo_diestro);
  setXIf('Diestro', mano.includes('DIESTRO'));
  setXIf('Zurdo', mano.includes('ZURDO'));

  // ════════════════════════════════════════════════════════════════════
  // INFORMACIÓN LABORAL / SALARIAL
  // ════════════════════════════════════════════════════════════════════
  const fechaIngreso = s(vac.fechadeIngreso || contrato.fecha_ingreso);
  setText('Fecha de Ingreso', parseDateToDDMMYYYY(fechaIngreso));
  setText('Sueldo Básico', formatMoneyCOP(vac.salario || proceso.vacante_salario || ''));

  setText('Nombre de la RutaUsa Ruta', s(ctx.usaRuta));
  setText('Nombre de la RutaAuxilio Trasporte', s(ctx.auxilio_transporte));

  // Horas extras
  const hext = contrato.horas_extras;
  setText('Horas extras', hext === true ? 'SI' : hext === false ? 'NO' : s(hext));

  // Banco / Cuenta
  setText('Banco', s(contrato.forma_de_pago));
  setText('Cuenta', s(contrato.numero_para_pagos));

  // Centro de costo / sede — mismo valor que el contrato (ctx.centroCosto);
  // solo si el contrato no trae nada se cae a la pestaña de nómina.
  setText('Centro de Costo', s(ctx.centroCosto) || centroDeCostosDe(contrato));
  setText('SubCentro de Costo', s(contrato.subcentro_de_costos));
  setText('Sucursal', s(entrevista.oficina));

  // ════════════════════════════════════════════════════════════════════
  // SEGURIDAD SOCIAL
  // ════════════════════════════════════════════════════════════════════
  setText('EPS SaludRow1', epsAnte || s(contrato.seleccion_eps));
  setText('AFP PensiónRow1', afpAnte);
  setText('AFC CesantiasRow1', s(contrato.cesantias));
  setText('Porcentaje ARLARL SURA', s(contrato.porcentaje_arl));

  // ════════════════════════════════════════════════════════════════════
  // EDUCACIÓN — la última formación (más reciente)
  // ════════════════════════════════════════════════════════════════════
  const f0 = formaciones[0] || {};
  setText('Seleccione el Grado de Escolaridad', norm(f0.nivel));
  setText('Institución', norm(f0.institucion));
  // Con nivel 1..11 el titulo suele venir vacio: ahi lo que aplica es el
  // ultimo grado cursado. Y si hay estudios adicionales reales, se anexan.
  setText('Titulo Obtenido o Ultimo año Cursado', norm(tituloOUltimoGrado(f0)));
  setText('Año Finalización', s(f0.anio_finalizacion));

  // ════════════════════════════════════════════════════════════════════
  // CONTACTO DE EMERGENCIA
  // ════════════════════════════════════════════════════════════════════
  if (emergencia) {
    const apNom = norm([s(emergencia.nombre), s(emergencia.apellido)].filter(Boolean).join(' '));
    setText('Apellidos y NombresRow1', apNom);
    setText('Número de ContactoRow1', s(emergencia.telefono));
  }

  // ════════════════════════════════════════════════════════════════════
  // PADRE / MADRE / CÓNYUGE
  // ════════════════════════════════════════════════════════════════════
  if (padre) {
    setText('Nombre y Apellido PadreRow1', norm([s(padre.nombre), s(padre.apellido)].filter(Boolean).join(' ')));
    setText('ViveRow1', siNo(padre.vive_con) || 'SI');
    setText('OcupaciónRow1', norm(padre.ocupacion));
    setText('DirecciónRow1', norm(padre.direccion));
    setText('TeléfonoRow1', s(padre.telefono));
    setText('BarrioMunicipioRow1', norm(padre.barrio));
  }
  if (madre) {
    setText('Nombre y Apellido MadreRow1', norm([s(madre.nombre), s(madre.apellido)].filter(Boolean).join(' ')));
    setText('ViveRow1_2', siNo(madre.vive_con) || 'SI');
    setText('OcupaciónRow1_2', norm(madre.ocupacion));
    setText('DirecciónRow1_2', norm(madre.direccion));
    setText('TeléfonoRow1_2', s(madre.telefono));
    setText('BarrioMunicipioRow1_2', norm(madre.barrio));
  }
  if (conyuge) {
    setText('Nombre y ApellidoconyugeRow1', norm([s(conyuge.nombre), s(conyuge.apellido)].filter(Boolean).join(' ')));
    setText('ViveRow1_3', siNo(conyuge.vive_con) || 'SI');
    setText('OcupaciónRow1_3', norm(conyuge.ocupacion));
    setText('DirecciónRow1_3', norm(conyuge.direccion));
    setText('TeléfonoRow1_3', s(conyuge.telefono));
    setText('BarrioMunicipioRow1_3', norm(conyuge.barrio));
  }

  // ════════════════════════════════════════════════════════════════════
  // HIJOS (hasta 6) — el modelo separa hijos en su propia tabla
  // ════════════════════════════════════════════════════════════════════
  for (let i = 0; i < Math.min(6, hijos.length); i++) {
    const h = hijos[i];
    const idx = i + 1;
    setText(`Apellidos y Nombres${idx}`, norm(h.nombre));
    setText(`F de Nacimiento${idx}`, parseDateToDDMMYYYY(h.fecha_nac));
    setText(` de Identificación${idx}`, s(h.numero_de_documento));
    // Género: M / F
    const sx = upper(h.sexo);
    if (sx === 'M' || sx === 'MASCULINO' || sx === 'HOMBRE') setText(`Gen${idx}`, 'M');
    else if (sx === 'F' || sx === 'FEMENINO' || sx === 'MUJER') setText(`Gen${idx}`, 'F');
    setText(`Vive con el Trabajador${idx}`, 'SI');
    setText(`Estudia en la Fundación SN${idx}`, 'NO');
    if (h.estudia_trabaja === true && s(h.curso)) {
      setText(`Ocupación${idx}`, 'ESTUDIA');
    }
    setText(`Curso${idx}`, norm(h.curso));
    // Bloque extendido (Nivel Educativo, Otro Padre, etc.)
    setText(`Nivel Educativo${idx}`, norm(h.curso));
    setText(`Posee alguna Discapacidad SN${idx}`, 'NO');
    setText(`Es Empleado de la Compañía${idx}`, 'NO');
    if (conyuge) {
      setText(
        `Nombre Otro Padre${idx}`,
        norm([s(conyuge.nombre), s(conyuge.apellido)].filter(Boolean).join(' '))
      );
      setText(`Documento Identidad Otro Padre${idx}`, s(conyuge.numero_de_documento));
    }
    setText(`Otro Padre Trabaja en la Compañía${idx}`, 'NO');
    setText(`Es Hijastro SN${idx}`, 'NO');
    setText(`Custodia Legal SN${idx}`, 'SI');
  }

  // ════════════════════════════════════════════════════════════════════
  // EXPERIENCIA LABORAL (P2) — hasta 2 empresas
  // ════════════════════════════════════════════════════════════════════
  const expsOrdenadas = [...experiencias].sort((a, b) => {
    const da = a?.fecha_retiro ? Date.parse(a.fecha_retiro) : Number.POSITIVE_INFINITY;
    const db = b?.fecha_retiro ? Date.parse(b.fecha_retiro) : Number.POSITIVE_INFINITY;
    return db - da; // más reciente / actual primero
  });
  const [exp1, exp2] = expsOrdenadas;
  if (exp1) {
    setText('Nombre Empresa 1Row1', norm(exp1.empresa));
    setText('Dirección EmpresaRow1', norm(exp1.direccion));
    setText('TeléfonosRow1', s(exp1.telefonos));
    setText('Jefe InmediatoRow1', norm(exp1.nombre_jefe));
    setText('CargoRow1', norm(exp1.cargo));
    setText('F de RetiroRow1', parseDateToDDMMYYYY(exp1.fecha_retiro));
    setText('Motivo de RetiroRow1', norm(exp1.motivo_retiro));
  }
  if (exp2) {
    setText('Nombre Empresa 2Row1', norm(exp2.empresa));
    setText('Dirección EmpresaRow1_2', norm(exp2.direccion));
    setText('TeléfonosRow1_2', s(exp2.telefonos));
    setText('Jefe InmediatoRow1_2', norm(exp2.nombre_jefe));
    setText('CargoRow1_2', norm(exp2.cargo));
    setText('F de RetiroRow1_2', parseDateToDDMMYYYY(exp2.fecha_retiro));
    setText('Motivo de RetiroRow1_2', norm(exp2.motivo_retiro));
  }

  // ════════════════════════════════════════════════════════════════════
  // REFERENCIAS PERSONALES Y FAMILIARES (P2)
  // ════════════════════════════════════════════════════════════════════
  // `tipo` llega como PERSONAL/PERSONAL1/PERSONAL2 y FAMILIAR/FAMILIAR1/
  // FAMILIAR2 según la época del registro: se clasifica por prefijo y se ordena
  // por el sufijo. Comparar por igualdad exacta dejaba en blanco las
  // referencias de todos los candidatos recientes.
  const { personales: refsP, familiares: refsF } = separarReferencias(referencias);

  if (refsP[0]) {
    setText('Nombre Referencia 1Row1', norm(refsP[0].nombre));
    setText('TeléfonosRow1_3', s(refsP[0].telefono));
    setText('OcupaciónRow1_4', norm(refsP[0].ocupacion));
    setText('PersonaRefencia1P', norm(refsP[0].nombre));
    setText('Comentarios de las Referencias Pesonales 1', s(refsP[0].referenciacion));
  }
  if (refsP[1]) {
    setText('Nombre Referencia 2Row1', norm(refsP[1].nombre));
    setText('TeléfonosRow1_4', s(refsP[1].telefono));
    setText('OcupaciónRow1_5', norm(refsP[1].ocupacion));
    setText('PersonaRefencia2P', norm(refsP[1].nombre));
    setText('Comentarios de las Referencias Pesonales 2', s(refsP[1].referenciacion));
  }
  if (refsF[0]) {
    setText('Nombre Referencia 1Row1_2', norm(refsF[0].nombre));
    setText('TeléfonosRow1_5', s(refsF[0].telefono));
    setText('OcupaciónRow1_6', norm(refsF[0].ocupacion));
    setText('PersonaRefencia1F', norm(refsF[0].nombre));
    setText('Comentario referencia Familiar', s(refsF[0].referenciacion));
  }
  if (refsF[1]) {
    setText('Nombre Referencia 1Row1_3', norm(refsF[1].nombre));
    setText('TeléfonosRow1_6', s(refsF[1].telefono));
    setText('OcupaciónRow1_7', norm(refsF[1].ocupacion));
    setText('PersonaRefencia2F', norm(refsF[1].nombre));
    setText('Comentario referencia Familiar 2', s(refsF[1].referenciacion));
  }

  // ════════════════════════════════════════════════════════════════════
  // BLOQUE DE REFERENCIAS DETALLADO (nombre-* / descripcion-* / parentesco_*)
  // Estos campos los renderiza el PDF con un layout más amplio (ver capturas).
  // Replica el comportamiento de `generarFichaTecnicaTuAlianzaCompleta`.
  // ════════════════════════════════════════════════════════════════════
  setText('nombre-referencia-peronal1', norm(refsP[0]?.nombre));
  setText('nombre-referencia-peronal2', norm(refsP[1]?.nombre));
  setText('nombre-referencia-familiar1', norm(refsF[0]?.nombre));
  setText('nombre-referencia-familiar2', norm(refsF[1]?.nombre));

  // Descripciones aleatorias del pool (sin repetir en el par)
  const [descPersonal1, descPersonal2] = pickTwoDistinct(ctx.referenciasA);
  setText('descripcion-personal1', descPersonal1);
  setText('descripcion-personal2', descPersonal2);

  const [descFamiliar1, descFamiliar2] = pickTwoDistinct(ctx.referenciasF);
  setText('descripcion-familiar1', descFamiliar1);
  setText('descripcion-familiar2', descFamiliar2);

  // Parentesco / relación de las referencias
  setText('parentesco_familiar_1', upper(refsF[0]?.parentesco));
  setText('parentesco_familiar_2', upper(refsF[1]?.parentesco));
  setText('parentesco_personal_1', upper(refsP[0]?.parentesco));
  setText('parentesco_personal_2', upper(refsP[1]?.parentesco));

  // Descripción laboral 1 = primer empleo (empresa - tiempo - labores)
  if (exp1) {
    const partesLab = [
      s(exp1.empresa),
      s(exp1.tiempo_trabajado),
      s(exp1.labores_realizadas),
      s(exp1.labores_principales),
    ].filter(Boolean);
    setText('descripcion-laboral1', partesLab.join(' - '));
  }

  // ════════════════════════════════════════════════════════════════════
  // DOTACIÓN / TALLAS (P2)
  // ════════════════════════════════════════════════════════════════════
  setText('TALLA CHAQUETARow1', s(dotacion.chaqueta));
  setText('TALLA PANTALONRow1', s(dotacion.pantalon));
  // El modelo nuevo no tiene "overol" como campo dedicado.
  setText('No calzadoRow1', s(dotacion.calzado));
  // Botas / zapatones — no existen como campos, quedan vacíos.

  // ════════════════════════════════════════════════════════════════════
  // TEXTOS ESPECIALES / AUTORIZACIÓN EMPRESA
  // ════════════════════════════════════════════════════════════════════
  setText('empresa', upper(ctx.empUsuaria), 7);

  // ── Datos de nómina (pestaña "Pago y Transporte" del contrato) ──
  // Los nombres de campo son los de la plantilla, con sus tildes y el typo
  // "Sublador"; no se pueden "corregir" sin romper el mapeo con el PDF.
  const contratoNom: any = cand?.entrevistas?.[0]?.proceso?.contrato ?? {};
  setText('Empresa Grupo Elite', upper(contratoNom.empresa_grupo_elite), 6);
  // Apoyo siempre opera con la compañía 001.
  setText('Código Compañía', s(contratoNom.codigo_compania) || '001', 6);
  setText('Sucursal', upper(contratoNom.sucursal), 6);
  // Centro de costo: mismo valor que el CONTRATO (obra/finca), no el de nómina,
  // para que las dos hojas nunca salgan con centros distintos.
  setText('Centro de Costo', upper(ctx.centroCosto) || upper(centroDeCostosDe(contratoNom)), 6);
  setText('SubCentro de Costo', upper(contratoNom.subcentro_de_costos), 6);
  setText('CÓDIGOCiudad de Labor', upper(contratoNom.ciudad_labor), 6);
  setText('CÓDIGOClasificador 2Categoría', upper(contratoNom.categoria), 6);
  setText('CÓDIGOClasificador 3Operación', upper(contratoNom.operacion), 6);
  // Acá va el CARGO de la vacante (igual que en el contrato y que en la versión
  // previa del generador); la sublabor de nómina salía distinta al contrato.
  // El cargo es corto y aguanta el 6pt del bloque; la sublabor (solo fallback
  // si la vacante no trae cargo) es larga y mantiene su 4.5pt histórico.
  const cargoContrato = upper(ctx.cargo);
  if (cargoContrato) setText('CÓDIGOClasificador 4Sublador', cargoContrato, 6);
  else setText('CÓDIGOClasificador 4Sublador', upper(contratoNom.sublabor), 4.5);
  setText('Apoyo Laboral TSClasificador 6Grupo', upper(contratoNom.grupo), 6);

  // Domicilio: ambos campos llevan el municipio de residencia.
  const municipioResidencia = upper(cand?.residencia?.municipio ?? cand?.municipio);
  setText('Ciudad DomicilioRow1', municipioResidencia, 6);
  setText('DepartamentoRow1', municipioResidencia, 6);
  // El rect de `CedulaAutorizacion` es muy estrecho (~52pt × 7pt). Sin fontSize
  // fijo el número se ve gigante y se desborda; forzamos 6pt.
  setText('CedulaAutorizacion', s(cand.numero_documento), 6);

  if (ctx.empUsuaria) {
    // Este campo es SOLO el espacio en blanco de la plantilla, que ya trae
    // impreso "...autorizo a ______ a consultar ante las centrales de riesgo".
    // Antes se le metía el párrafo completo, que no cabe en el rect y salía
    // cortado en "estudios de seguridad. De conformidad con lo dispuesto...".
    // Va únicamente el nombre de las dos empresas autorizadas.
    const autorizadas = [ctx.temporal, ctx.empUsuaria]
      .map(v => String(v ?? '').trim())
      .filter(Boolean)
      .join(' - ');
    setText('AutorizacionDeEstudiosSeguridad2', autorizadas, 6);
    setText(
      'TEXTOCARNET',
      `me comprometo a presentar ante ${ctx.empUsuaria} fotocopia del denuncio correspondiente y en el caso de aparecer el carnet perdido lo devolveré a la empresa para su respectiva anulación.`,
      6
    );
  }

  // Texto de entrega de loker (TEXTOLOCKER5)
  let tipoDocFormal = upper(cand.tipo_doc);
  if (tipoDocFormal.includes('CC') || tipoDocFormal.includes('CIUDADAN')) tipoDocFormal = 'Cedula de Ciudadania';
  else if (tipoDocFormal.includes('CE') || tipoDocFormal.includes('EXTRANJE')) tipoDocFormal = 'Cedula de Extranjeria';
  else if (tipoDocFormal.includes('PEP') || tipoDocFormal.includes('PET')) tipoDocFormal = 'Permiso Especial de Permanencia';
  else if (tipoDocFormal.includes('PA')) tipoDocFormal = 'Pasaporte';

  setText(
    'TEXTOLOCKER5',
    `Yo, ${nombreCompleto} identificado(a) con ${tipoDocFormal} No ${s(cand.numero_documento)} declaro haber recibido el Loker relacionado abajo y me comprometo a seguir las recomendaciones y políticas de uso y cuidado de estós, y a devolver el Loker en el mismo estado en que me fue asignado al momento de la finalización de mi relación laboral y antes de la entrega de la liquidación de contrato.`,
    6
  );

  // Persona que firma como verificadora de referencias
  setText('Persona que firma', upper(ctx.personaQueFirma));
}
