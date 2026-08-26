/**
 * Llenado del formulario "Ficha Social" (Docs/Ficha social.pdf).
 *
 * El PDF tiene 1 página con 171 TextFields + 2 botones (firmas).
 * La mayoría de "checkboxes" del formato son TextFields donde se escribe "X" para
 * marcar (convención del PDF original — no son /Btn).
 *
 * Datos consumidos provienen de gestion_contratacion.CandidatoDetailSerializer
 * (snake_case nativo). Si un campo del candidato no existe se deja en blanco;
 * NUNCA lanza error.
 *
 * Las firmas (2 widgets del mismo /Btn `firma_af_image`: autorización y
 * trabajador, ambas del candidato) se manejan fuera de este helper porque
 * dependen de servicios del componente.
 */

import type { PDFForm } from 'pdf-lib';
import { esReferenciaFamiliar } from './referencias.util';
import { sanitizedString } from './winansi.util';

type Cand = any;

const s = (v: any): string => sanitizedString(v);

const upper = (v: any): string => s(v).toUpperCase();

/** Ya normaliza `s()`; se mantiene por los call sites que lo usan explícito. */
const norm = (v: any): string => s(v);

/** Devuelve "X" si `value` (o cualquier elemento del array) contiene alguna keyword. */
function mark(value: any, ...keywords: string[]): string {
  const haystack = Array.isArray(value)
    ? value.map(upper).join('|')
    : upper(value);
  if (!haystack) return '';
  return keywords.some(k => haystack.includes(upper(k))) ? 'X' : '';
}

/** Convierte fecha ISO (YYYY-MM-DD) a DD/MM/YYYY. Si no parsea, devuelve string vacío. */
function fechaCO(iso: any): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s(iso));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** Familiar por tipo (CONYUGUE / PADRE / MADRE / EMERGENCIA). */
function getFamiliar(familiares: any[], tipo: string): any | null {
  if (!Array.isArray(familiares)) return null;
  return familiares.find(f => upper(f?.tipo) === tipo) || null;
}

/** Última formación (más alta o más reciente). */
function getUltimaFormacion(formaciones: any[]): any | null {
  if (!Array.isArray(formaciones) || formaciones.length === 0) return null;
  // El serializer ordena por -anio_finalizacion, institucion → la primera ya es la más reciente.
  return formaciones[0];
}

/** Bool boolean coerce. */
function siNo(v: any): string {
  if (v === true || upper(v) === 'TRUE' || upper(v) === 'SI' || upper(v) === 'SÍ' || upper(v) === '1' || upper(v) === 'Y') return 'SI';
  if (v === false || upper(v) === 'FALSE' || upper(v) === 'NO' || upper(v) === '0' || upper(v) === 'N') return 'NO';
  return '';
}

/**
 * Llena la Ficha Social con los datos del candidato.
 * @param form pdfDoc.getForm() — debe ser de Ficha social.pdf
 * @param candidato CandidatoDetailSerializer
 * @param vacante (opcional) info de la vacante seleccionada
 * @param empresaFallback empresa por defecto si vacante no la trae
 */
export function fillFichaSocialPdf(
  form: PDFForm,
  candidato: Cand,
  vacante: Cand | null = null,
  empresaFallback: string = ''
): void {
  const setText = (campo: string, valor: any): void => {
    if (valor === undefined || valor === null) return;
    const v = s(valor);
    if (!v) return;
    try {
      const field = form.getTextField(campo);
      field.setText(v);
    } catch {
      // campo no existe en el template — se ignora silenciosamente
    }
  };

  /** Variante de setText que fija el tamaño de fuente; útil para campos cuyo
   *  rect es pequeño y el contenido sería demasiado largo para auto-fit
   *  (ej. `nombre_empresa_usuaria` con razones sociales largas). */
  const setTextSized = (campo: string, valor: any, fontSize: number): void => {
    if (valor === undefined || valor === null) return;
    const v = s(valor);
    if (!v) return;
    try {
      const field = form.getTextField(campo);
      field.setFontSize(fontSize);
      field.setText(v);
      // No llamamos updateAppearances() porque exige un PDFFont concreto;
      // pdf-lib regenerará appearances al guardar usando el DA del campo,
      // que ya respeta nuestro setFontSize.
    } catch {
      // campo no existe — se ignora
    }
  };

  const setMark = (campo: string, value: any, ...keywords: string[]): void => {
    const x = mark(value, ...keywords);
    if (x) setText(campo, x);
  };

  // ─────── derivados ───────
  const cand: Cand = candidato || {};
  const contacto: Cand = cand.contacto || {};
  const residencia: Cand = cand.residencia || {};
  const vivienda: Cand = cand.vivienda || {};
  const familiares: Cand[] = Array.isArray(cand.familiares) ? cand.familiares : [];
  const referencias: Cand[] = Array.isArray(cand.referencias) ? cand.referencias : [];
  const formaciones: Cand[] = Array.isArray(cand.formaciones) ? cand.formaciones : [];
  const hijos: Cand[] = Array.isArray(cand.hijos) ? cand.hijos : [];

  const conyuge = getFamiliar(familiares, 'CONYUGUE');
  const emergencia =
    getFamiliar(familiares, 'EMERGENCIA') ||
    referencias.find(r => esReferenciaFamiliar(r?.tipo)) ||
    null;

  // Personas que conviven (texto libre, hacemos contains case-insensitive).
  const conviven = upper(vivienda.personas_con_quien_convive);

  // ════════════════════════════════════════════════════════════════════
  // CABECERA — Tipo doc, nombres, apellidos
  // ════════════════════════════════════════════════════════════════════
  setText('Row1', upper(cand.tipo_doc));
  setText('NombresRow1', norm([s(cand.primer_nombre), s(cand.segundo_nombre)].filter(Boolean).join(' ')));
  setText('1er ApellidoRow1', norm(cand.primer_apellido));
  setText('2do ApellidoRow1', norm(cand.segundo_apellido));

  // ════════════════════════════════════════════════════════════════════
  // CONTACTO + ESTADO CIVIL + DISPOSITIVOS
  // ════════════════════════════════════════════════════════════════════
  setText('Estado CivilRow1', upper(cand.estado_civil));
  setText('TeléfonoRow1', s(contacto.celular));
  setText('Correo ElectrónicoRow1', s(contacto.email));
  // Sin data específica → asumimos SI por defecto (es el comportamiento previo del componente).
  setText('Teléfono InteligenteRow1', 'SI');
  setText('Posee Plan de DatosRow1', 'SI');

  // ════════════════════════════════════════════════════════════════════
  // DOMICILIO
  // ════════════════════════════════════════════════════════════════════
  setText('Dirección de DomicilioRow1', norm(residencia.direccion));
  setText('BarrioRow1', norm(residencia.barrio));
  setText('Ciudad DomicilioRow1', norm(cand.municipio));
  setText('DepartamentoRow1', norm(cand.departamento));

  // ════════════════════════════════════════════════════════════════════
  // PERSONAS QUE CONVIVEN (X marca presencia)
  // ════════════════════════════════════════════════════════════════════
  setMark('ConyugueCompañeroaRow1', conviven, 'CONYUGE', 'CÓNYUGE', 'COMPAÑER', 'ESPOS');
  setMark('Hijo aRow1', conviven, 'HIJO', 'HIJA');
  setMark('MadreRow1', conviven, 'MADRE', 'MAMÁ', 'MAMA');
  setMark('PadreRow1', conviven, 'PADRE', 'PAPÁ', 'PAPA');
  setMark('HermanoaRow1', conviven, 'HERMANO', 'HERMANA');
  setMark('TíoRow1', conviven, 'TIO', 'TÍO', 'TIA', 'TÍA');
  setMark('SobrinoRow1', conviven, 'SOBRINO', 'SOBRINA');
  setMark('CuñadoaRow1', conviven, 'CUÑADO', 'CUÑADA');
  setMark('SuegroaRow1', conviven, 'SUEGRO', 'SUEGRA');
  // "Otro" si nada de lo anterior matchea pero hay texto.
  if (
    conviven &&
    !/CONYUGE|CÓNYUGE|COMPAÑER|ESPOS|HIJO|HIJA|MADRE|MAMÁ|MAMA|PADRE|PAPÁ|PAPA|HERMAN|T[IÍ]O|T[IÍ]A|SOBRIN|CUÑAD|SUEGR/.test(conviven)
  ) {
    setText('OtroRow1', 'X');
    setText('CúalRow1', s(vivienda.personas_con_quien_convive));
  }

  // Familia con un solo ingreso
  const unSoloIngreso = siNo(vivienda.familia_un_solo_ingreso);
  if (unSoloIngreso) setText('Familia con un solo ingresoRow1', unSoloIngreso);

  // ════════════════════════════════════════════════════════════════════
  // TIPO DE VIVIENDA
  // ════════════════════════════════════════════════════════════════════
  const tipoViv = upper(vivienda.tipo_vivienda);
  setMark('CasaRow1', tipoViv, 'CASA');
  setMark('ApartamentoRow1', tipoViv, 'APARTAMENTO', 'APTO');
  setMark('FincaRow1', tipoViv, 'FINCA');
  setMark('HabitaciónRow1', tipoViv, 'HABITACION', 'HABITACIÓN', 'PIEZA', 'CUARTO');

  setText('No HabitacionesRow1', s(vivienda.num_habitaciones));
  setText('No Personas por habitaciónRow1', s(vivienda.personas_por_habitacion));

  // ════════════════════════════════════════════════════════════════════
  // TENENCIA (tipo_vivienda_alt) + ESTADO (caracteristicas_vivienda)
  // ════════════════════════════════════════════════════════════════════
  const tenencia = upper(vivienda.tipo_vivienda_alt);
  setMark('Propia Totalmente PagaRow1', tenencia, 'PROPIA TOTAL', 'TOTALMENTE PAGA', 'PAGA');
  setMark('Propia la están pagandoRow1', tenencia, 'PAGANDO', 'CRÉDITO', 'CREDITO', 'HIPOTECA');
  setMark('ArriendoRow1', tenencia, 'ARRIENDO', 'ALQUIL');
  setMark('FamiliarRow1', tenencia, 'FAMILIAR');

  const estado = upper(vivienda.caracteristicas_vivienda);
  setMark('Obra NegraRow1', estado, 'OBRA NEGRA', 'NEGRA');
  setMark('Obra GrisRow1', estado, 'OBRA GRIS', 'GRIS');
  setMark('TerminadaRow1', estado, 'TERMINADA', 'TERMINADO');

  // ════════════════════════════════════════════════════════════════════
  // SERVICIOS PÚBLICOS (campo `vivienda.servicios` — string CSV o lista)
  // ════════════════════════════════════════════════════════════════════
  const servs = vivienda.servicios;
  setMark('EnergíaRow1', servs, 'ENERGIA', 'ENERGÍA', 'LUZ', 'ELÉCTRIC', 'ELECTRIC');
  setMark('AcueductoRow1', servs, 'ACUEDUCTO', 'AGUA');
  setMark('AlcantarilladoRow1', servs, 'ALCANTARILLADO');
  setMark('Recolección BasurasRow1', servs, 'BASURA', 'RECOLECCION', 'RECOLECCIÓN', 'ASEO');
  setMark('Gas NaturalRow1', servs, 'GAS');
  setMark('Teléfono FijoRow1', servs, 'TELEFONO', 'TELÉFONO');
  setMark('InternetRow1', servs, 'INTERNET', 'WIFI');

  // EQUIPAMIENTO de casa — no hay datos en `gestion_contratacion`, se omite.

  // ════════════════════════════════════════════════════════════════════
  // EDUCACIÓN — la última formación
  // ════════════════════════════════════════════════════════════════════
  const ultimaForm = getUltimaFormacion(formaciones);
  if (ultimaForm) {
    setText('Grado Escolaridad', upper(ultimaForm.nivel));
    setText('Institución', upper(ultimaForm.institucion));
    setText('Titulo Obtenido o Último Año Cursado', upper(ultimaForm.titulo_obtenido));
    setText('Año Finalización', s(ultimaForm.anio_finalizacion));
  }

  // ════════════════════════════════════════════════════════════════════
  // CONTACTO DE EMERGENCIA
  // ════════════════════════════════════════════════════════════════════
  if (emergencia) {
    const apNom = norm(
      [s(emergencia.apellido), s(emergencia.nombre)].filter(Boolean).join(' ')
    );
    setText('Apellidos y NombresRow1', apNom || norm(emergencia.nombre));
    setText('ParentescoRow1', upper(emergencia.parentesco));
    setText('TeléfonoRow1_2', s(emergencia.telefono));
    setText('DirecciónRow1', norm(emergencia.direccion));
    setText('Barrio MunicipioRow1', norm(emergencia.barrio));
  }

  // ════════════════════════════════════════════════════════════════════
  // CÓNYUGE
  // ════════════════════════════════════════════════════════════════════
  if (conyuge) {
    setText('NombresRow1_2', norm(conyuge.nombre));
    setText('ApellidosRow1', norm(conyuge.apellido));
    setText('No Doc IdentidadRow1', s(conyuge.numero_de_documento));
    // `vive_con` vino del payload original; si está vacío, asumimos SI cuando hay cónyuge registrado.
    const viveCony = siNo(conyuge.vive_con);
    setText('Vive SNRow1', viveCony || 'SI');
    setText('DirecciónRow1_2', norm(conyuge.direccion));
    setText('TeléfonoRow1_3', s(conyuge.telefono));
    setText('Barrio MunicipioRow1_2', norm(conyuge.barrio));
    setText('OcupaciónRow1', upper(conyuge.ocupacion));
    // Teléfono / Dirección Laboral — no hay data, se omite.
  }

  // ════════════════════════════════════════════════════════════════════
  // INFORMACIÓN DE LOS HIJOS (6 filas)
  // ════════════════════════════════════════════════════════════════════
  // Layout especial: el primer hijo usa `Row1_2` para "Apellidos y Nombres",
  // pero el resto de columnas (fecha, doc, género, vive_con, estudia, ocupación)
  // del primer hijo usan `Row1`. Los demás (filas 2..6) usan `Row{i}` para todo.
  type HijoRow = {
    apNom: string;
    fecha: string;
    doc: string;
    genero: string;
    vive: string;
    estudia: string;
    ocupacion: string;
    nivelEdu: string;
    discapacidad: string;
    empleadoCia: string;
    nombreOtroPadre: string;
    docOtroPadre: string;
    otroPadreEmpleado: string;
    hijastro: string;
    custodia: string;
  };
  const hijoRows: HijoRow[] = [
    {
      apNom: 'Apellidos y NombresRow1_2',
      fecha: 'Fecha de NacimientoRow1',
      doc: 'No Documento de IdentidadRow1',
      genero: 'GéneroRow1',
      vive: 'Vive con el Trabajador SNRow1',
      estudia: 'Estudia en la Fundación SNRow1',
      ocupacion: 'Ocupación EstudiaTrabajaRow1',
      nivelEdu: 'Nivel EducativoRow1',
      discapacidad: 'Posee  alguna Discapacidad SNRow1',
      empleadoCia: 'Es Empleado de la Compañía SNRow1',
      nombreOtroPadre: 'Nombre Otro PadreRow1',
      docOtroPadre: 'Documento Identidad Otro PadreRow1',
      otroPadreEmpleado: 'Otro Padre Trabaja en la CompañíaRow1',
      hijastro: 'Es Hijastro SNRow1',
      custodia: 'Custodia Legal SNRow1',
    },
    ...[2, 3, 4, 5, 6].map(i => ({
      apNom: `Apellidos y NombresRow${i}`,
      fecha: `Fecha de NacimientoRow${i}`,
      doc: `No Documento de IdentidadRow${i}`,
      genero: `GéneroRow${i}`,
      vive: `Vive con el Trabajador SNRow${i}`,
      estudia: `Estudia en la Fundación SNRow${i}`,
      ocupacion: `Ocupación EstudiaTrabajaRow${i}`,
      nivelEdu: `Nivel EducativoRow${i}`,
      discapacidad: `Posee  alguna Discapacidad SNRow${i}`,
      empleadoCia: `Es Empleado de la Compañía SNRow${i}`,
      nombreOtroPadre: `Nombre Otro PadreRow${i}`,
      docOtroPadre: `Documento Identidad Otro PadreRow${i}`,
      otroPadreEmpleado: `Otro Padre Trabaja en la CompañíaRow${i}`,
      hijastro: `Es Hijastro SNRow${i}`,
      custodia: `Custodia Legal SNRow${i}`,
    })),
  ];

  // El "otro padre" de cada hijo: si hay cónyuge registrado, usamos su nombre
  // como "otro padre" por defecto. Es la asunción habitual (sin data específica
  // por hijo en el modelo).
  const otroPadreNombre = conyuge
    ? norm([s(conyuge.nombre), s(conyuge.apellido)].filter(Boolean).join(' '))
    : '';
  const otroPadreDoc = conyuge ? s(conyuge.numero_de_documento) : '';

  hijos.slice(0, 6).forEach((h: Cand, i: number) => {
    const row = hijoRows[i];

    setText(row.apNom, norm(h.nombre));
    setText(row.fecha, fechaCO(h.fecha_nac));
    setText(row.doc, s(h.numero_de_documento));

    // Género: M / F
    const sx = upper(h.sexo);
    if (sx === 'M' || sx === 'MASCULINO' || sx === 'HOMBRE') setText(row.genero, 'M');
    else if (sx === 'F' || sx === 'FEMENINO' || sx === 'MUJER') setText(row.genero, 'F');

    // Vive con el trabajador — no tenemos campo directo. Asumimos "SI" si el
    // candidato indicó dependientes económicos (o por defecto SI cuando hay hijos).
    setText(row.vive, 'SI');
    setText(row.estudia, 'NO');

    // Ocupación: si estudia o trabaja, mostramos curso/ocupación. `estudia_trabaja` es BooleanField.
    const curso = s(h.curso);
    if (curso) setText(row.ocupacion, upper(curso));
    else if (h.estudia_trabaja === true) setText(row.ocupacion, 'ESTUDIA');

    // Bloque extendido (mismo i)
    setText(row.nivelEdu, upper(curso));
    setText(row.discapacidad, 'NO');
    setText(row.empleadoCia, 'NO');
    setText(row.nombreOtroPadre, otroPadreNombre);
    setText(row.docOtroPadre, otroPadreDoc);
    setText(row.otroPadreEmpleado, 'NO');
    setText(row.hijastro, 'NO');
    setText(row.custodia, 'SI');
  });

  // ════════════════════════════════════════════════════════════════════
  // EXPECTATIVAS DE VIDA
  // ════════════════════════════════════════════════════════════════════
  const expectativas = vivienda.expectativas_de_vida;
  setMark('Educación PropiaRow1', expectativas, 'EDUCACI', 'ESTUDI', 'CARRERA');
  setMark('Educación de los hijosRow1', expectativas, 'HIJOS', 'EDUCACIÓN HIJOS', 'EDUCACION HIJOS');
  setMark('Compra de ViviendaRow1', expectativas, 'VIVIENDA', 'CASA', 'APARTAMENTO');
  setMark('Compra de AutomóvilRow1', expectativas, 'AUTOM', 'CARRO', 'VEHICULO', 'VEHÍCULO', 'MOTO');
  setMark('ViajarRow1', expectativas, 'VIAJ', 'CONOCER');
  // "Otro - Cuál" — guardamos texto crudo si no matchea ninguna keyword conocida.
  const expU = upper(expectativas);
  if (expU && !/EDUCACI|ESTUDI|CARRERA|HIJOS|VIVIENDA|CASA|APARTAMENTO|AUTOM|CARRO|VEHIC|VEHÍC|MOTO|VIAJ|CONOCER/.test(expU)) {
    setText('Otro CuálRow1', s(expectativas));
  }

  // ════════════════════════════════════════════════════════════════════
  // FOOTER — Empresa, fecha, firma autorización
  // ════════════════════════════════════════════════════════════════════
  // El rect de `nombre_empresa_usuaria` es ~75pt de ancho × 11pt de alto, y va
  // inline con el texto del párrafo. Forzamos 4pt para que empate visualmente
  // con el texto que lo rodea (que es muy pequeño).
  setTextSized('nombre_empresa_usuaria', upper(vacante?.empresa_usuaria_solicita || empresaFallback || 'LA EMPRESA'), 4);

  const now = new Date();
  const txtFecha = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;
  setText('fechaactual', txtFecha);

  // En el bloque de firma, "DOCUMENTO No" es el nº de cédula del trabajador.
  setText('DOCUMENTO No', s(cand.numero_documento));
}
