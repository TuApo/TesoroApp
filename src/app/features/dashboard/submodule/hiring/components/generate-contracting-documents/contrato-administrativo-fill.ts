/**
 * Contrato Individual de Trabajo a Término Fijo Inferior a un Año (Administrativos).
 *
 * Reemplaza las dos plantillas Excel originales con un PDF generado por jsPDF, en el
 * mismo estilo visual que `generarContratoTrabajo()` del componente:
 *   - public/Docs/contrato a termino fijo inferior a un año administrativos apyo laboral.xlsx
 *   - public/Docs/CONTRATO A TERMINO FIJO INFERIORI A UN AÑO TU ALIANZA.xlsx
 *
 * Selección de plantilla (logo, NIT, empleador, domicilio, código de versión, etc.)
 * se hace con `opts.empresa` ya normalizado por el componente: 'APOYO LABORAL SAS'
 * | 'TU ALIANZA SAS'. El cuerpo de las cláusulas es idéntico entre las dos
 * plantillas salvo el nombre de la sociedad citada en la cláusula PRIMERA, numeral
 * 2; eso se interpola con `{{RAZON_SOCIAL}}`.
 */

import jsPDF from 'jspdf';
import { sanitizedString, sanitizeWinAnsi } from './winansi.util';
import { salarioContratoCO, SMMLV_VIGENTE } from './salario.util';

export type Empresa = 'APOYO LABORAL SAS' | 'TU ALIANZA SAS';

export interface BuildContratoAdministrativoOpts {
  empresa: Empresa | string;
  candidato: any;
  vacante: any;
  cedula: string;
  codigoContratacion: string;
  sede: string;
  /** base64 (con o sin prefijo data:image/png;base64,) o '' si no hay */
  firmaTrabajadorBase64: string;
  /** base64 del firmador administrativo / asesor que está procesando el contrato */
  firmaAdministrativoBase64: string;
  /** snapshot de this.user (para testigo 2) */
  user: any;
  /** nombre completo del usuario logueado (testigo 2) */
  nombreCompletoLogin: string;
}

interface EmpresaConfig {
  logoPath: string;
  nit: string;
  razonSocial: string;
  empleadorNombre: string;
  /** ej. "C.E. 332.318" / "C.C. 52.440.635" */
  empleadorIdentificacion: string;
  /** ciudad/municipio del domicilio del empleador */
  domicilio: string;
  direccion: string;
  /** código de la plantilla, ej. "ADAP24100" */
  codigoPlantilla: string;
  versionPlantilla: string;
  fechaEmisionPlantilla: string;
  /** firma escaneada del representante legal/empleador (relativa a public/) */
  firmaEmpleadorPath: string;
}

const EMPRESA_CONFIGS: Record<string, EmpresaConfig> = {
  'APOYO LABORAL SAS': {
    logoPath: 'logos/Logo_AL.png',
    nit: '900.814.587 - 1',
    razonSocial: 'APOYO LABORAL TS S.A.S',
    empleadorNombre: 'MAYRA HUAMANI LOPEZ',
    empleadorIdentificacion: 'C.E. 332.318',
    domicilio: 'FACATATIVÁ',
    direccion: 'CARRERA 2 # 8 - 156',
    codigoPlantilla: 'ADAP24100',
    versionPlantilla: 'V1',
    fechaEmisionPlantilla: 'Mayo 16-24',
    firmaEmpleadorPath: 'firma/FirmaMayra.png',
  },
  'TU ALIANZA SAS': {
    logoPath: 'logos/Logo_TA.png',
    nit: '900.864.596 - 1',
    razonSocial: 'TU ALIANZA S.A.S',
    empleadorNombre: 'HEIDY JACKELINNE TORRES SOTELO',
    empleadorIdentificacion: 'C.C. 52.440.635',
    domicilio: 'MADRID',
    direccion: 'CALLE 7 # 4 - 49',
    codigoPlantilla: 'ADTA24084',
    versionPlantilla: 'V1',
    fechaEmisionPlantilla: 'Mayo 16-24',
    firmaEmpleadorPath: 'firma/heidyTorres.png',
  },
};

/** Resuelve la empresa al config correspondiente (admite alias / mayúsculas/minúsculas). */
function resolveEmpresa(empresa: string): EmpresaConfig | null {
  const k = (empresa ?? '').toUpperCase().trim();
  if (k.includes('ALIANZA')) return EMPRESA_CONFIGS['TU ALIANZA SAS'];
  if (k.includes('APOYO')) return EMPRESA_CONFIGS['APOYO LABORAL SAS'];
  return null;
}

const s = (v: any): string => sanitizedString(v);

/** Convierte fecha ISO o Date a dd/mm/yyyy. Devuelve string vacío si no parsea. */
function fechaCO(input: any): string {
  if (!input) return '';
  const d = input instanceof Date ? input : new Date(String(input));
  if (isNaN(d.getTime())) return s(input);
  return [
    String(d.getDate()).padStart(2, '0'),
    String(d.getMonth() + 1).padStart(2, '0'),
    d.getFullYear(),
  ].join('/');
}

/** Suma N años a una fecha (ISO/Date). Devuelve dd/mm/yyyy o '' si no parsea. */
function fechaCOSumandoAnios(input: any, anios: number): string {
  if (!input) return '';
  const d = input instanceof Date ? new Date(input.getTime()) : new Date(String(input));
  if (isNaN(d.getTime())) return '';
  d.setFullYear(d.getFullYear() + anios);
  return [
    String(d.getDate()).padStart(2, '0'),
    String(d.getMonth() + 1).padStart(2, '0'),
    d.getFullYear(),
  ].join('/');
}

function nombreCompletoCandidato(cand: any): string {
  return [
    cand?.primer_apellido,
    cand?.segundo_apellido,
    cand?.primer_nombre,
    cand?.segundo_nombre,
  ]
    .map(s)
    .filter(Boolean)
    .join(' ')
    .toUpperCase();
}

function cargoDeVacante(vac: any): string {
  if (!vac) return '';
  if (vac?.cargo?.nombre_cargo_empresa) return s(vac.cargo.nombre_cargo_empresa);
  if (vac?._id_cargo?.nombre_cargo_empresa) return s(vac._id_cargo.nombre_cargo_empresa);
  if (vac?.cargo?.nombre_cargo) return s(vac.cargo.nombre_cargo);
  if (vac?.nombre_cargo) return s(vac.nombre_cargo);
  if (typeof vac?.cargo === 'string') return s(vac.cargo);
  return '';
}

/* ----------------------------------------------------------------------------
 * Cuerpo del contrato (cláusulas), tomado verbatim de los XLSX originales.
 * Las dos plantillas comparten el cuerpo; la única referencia que cambia es la
 * razón social citada en la cláusula PRIMERA numeral 2 — se interpola.
 * ------------------------------------------------------------------------- */

const CLAUSULAS: Array<{ titulo: string; texto: string }> = [
  {
    titulo: 'PRIMERA. - OBJETO.',
    texto:
      'EL EMPLEADOR contrata los servicios personales de EL TRABAJADOR (A) para desempeñar el cargo indicado en el encabezamiento del presente contrato y en virtud del cual EL TRABAJADOR (A) se obliga a: 1. Incorporar al servicio de EL EMPLEADOR toda su capacidad normal de trabajo. Esta será realizada en forma exclusiva, en el desempeño de todas las funciones propias del empleo y las labores anexas y complementarias que se originen del mismo cargo, todo de conformidad con las normas e instrucciones que en forma verbal o escrita le imparta EL EMPLEADOR o sus representantes. 2.- Igualmente se obliga a no prestar directa ni indirectamente servicios laborales a otros empleadores, ni a trabajar por cuenta propia en el mismo o en cualquier oficio durante la vigencia de este contrato. No obstante, lo pactado acuerdan los contratantes y en razón a la vinculación comercial de EL EMPLEADOR con la sociedad {{RAZON_SOCIAL}}, que EL TRABAJADOR (A), bajo la subordinación del EMPLEADOR y en el evento en que este así lo disponga, ejecutará las mismas funciones para la mencionada empresa, en cumplimiento de su jornada laboral, sin que se entienda por tanto violación a la exclusividad pactada o que EL TRABAJADOR (A) celebra contrato de trabajo con la citada sociedad, en consecuencia en el salario pactado se encuentra incluida la remuneración de esas actividades. 3.- El servicio antes dicho lo prestará personalmente EL TRABAJADOR (A) teniendo como base de operación la ciudad de Bogotá pero la obligación de prestar el servicio contratado en todo el territorio nacional; sin embargo y teniendo en cuenta que EL EMPLEADOR desarrolla su actividad productiva y comercial a nivel nacional, las partes convienen en que EL EMPLEADOR podrá trasladar la base de operaciones de EL TRABAJADOR (A), en cualquier tiempo, a cualquier otro lugar donde desarrolle tales actividades, siempre que el cambio no implique desmejora de la remuneración ni de la categoría de EL TRABAJADOR (A), conforme al organigrama de categorías y jerarquías de cargos que tenga establecido EL EMPLEADOR. 4.- Guardar en el desempeño de sus funciones y fuera de ellas, la discreción, confidencia, sigilo y lealtad que debe a EL EMPLEADOR, absteniéndose por lo tanto de revelar cualquier secreto o información confidencial, que llegare a su conocimiento por razones o no de su oficio sobre las operaciones, procedimientos industriales o comerciales, de informática, o cualquier otra clase de información que pueda perjudicar los intereses de EL EMPLEADOR. 5.- Responder por todos y cada uno de los elementos de trabajo que le entregue EL EMPLEADOR para el desempeño de su cargo. 6.- Devolver oportunamente los equipos, valores, documentos, muestrarios, carpetas y demás elementos de trabajo que le entregue EL EMPLEADOR para el desempeño de su cargo. 7.- Entregar oportunamente de conformidad con las instrucciones y los procedimientos establecidos, todos los equipos, valores, documentos, sumas de dinero y demás, que con destino a este reciba de terceros en ejercicio de su cargo. 8.- Consagrar toda su actividad en el desempeño de sus funciones, absteniéndose de ejecutar labores u ocupaciones que puedan entorpecer dicho desempeño o menoscabar su rendimiento personal, así como todas aquellas que emanen de la naturaleza de la labor contratada. 9.- Conservar y restituir en buen estado, salvo el deterioro natural, los instrumentos, máquinas, útiles y demás elementos que se le hayan facilitado. 10.- Guardar rigurosamente la moral con sus superiores y demás compañeros de trabajo. 11.- Comunicar oportunamente a EL EMPLEADOR las observaciones que estime conducentes a evitarle daños y perjuicios. 12.- Prestar la colaboración posible en caso de siniestro o de riesgos inminentes que amenacen las personas y las cosas de EL EMPLEADOR. 13.- Observar las medidas preventivas higiénicas prescritas en el reglamento de higiene y seguridad industrial, el médico de la empresa o las autoridades del ramo. 14.- Registrar en las oficinas de EL EMPLEADOR, su dirección, número de teléfono y domicilio y dar aviso inmediato de cualquier cambio que ocurra. 15.- Destinar a su uso en las labores contratadas el vestuario que le suministre EL EMPLEADOR. 16.- Utilizar los elementos que EL EMPLEADOR le suministre para la realización de su trabajo. 17.- Avisar oportunamente a su superior inmediato sobre cualquier deficiencia que tengan los vehículos, máquinas, equipos o implementos de labor con el fin de evitar accidentes, daños o costos adicionales. 19.- Legalizar ante el Departamento de Contabilidad de EL EMPLEADOR, mediante la presentación de los respectivos soportes o recibos, dentro de los tres días siguientes a la fecha de pago, todos los gastos para los cuales se le hubiese efectuado anticipos de dinero, en el evento de que EL TRABAJADOR (A) omita efectuar tal legalización dentro del término señalado, autoriza al EMPLEADOR, para que descuente tal anticipo de sus salarios y en caso de retiro de cualquier suma que resulte liquidada a su favor por cualquier derecho. 20.- Respetar y someterse al Reglamento de Trabajo vigente en la sociedad EMPLEADORA en todas sus partes, cuyo texto manifiesta conocer en todas sus partes. De igual manera se obliga a EL TRABAJADOR (A) al cumplimiento de las funciones descritas en el Plan Táctico Empresarial. PARÁGRAFO. - CONFIDENCIALIDAD. - EL TRABAJADOR (A) se obliga especialmente a no hacer uso en beneficio propio o de alguna otra persona natural o jurídica, del conocimiento adquirido sobre actividades, planes o programas del EMPLEADOR, o la información y documentos a que hubiere tenido acceso en ejercicio de las funciones propias de su cargo y a mantener un alto grado de confidencialidad en relación con esta información.',
  },
  {
    titulo: 'SEGUNDA. - REMUNERACIÓN:',
    texto:
      'EL EMPLEADOR reconocerá y pagará como retribución por los servicios del TRABAJADOR (A) el salario indicado en el encabezamiento del presente contrato, pagadero por quincenas vencidas. Dentro de este pago se encuentra incluida la remuneración de los descansos dominicales y festivos de que tratan los capítulos I, II y III del Título VII del C.S.T. PARÁGRAFO 1.- Se aclara y se conviene que en los casos en que EL TRABAJADOR (A) devengue comisiones o cualquier otra modalidad de salario variable, el 82.5% de dichos ingresos, constituye remuneración de labor realizada, y el 17.5% restante está destinado a remunerar el descanso en los días dominicales y festivos de que tratan los capítulos I, II y III del Título VII del C.S.T. PARÁGRAFO 2: EL TRABAJADOR (A), autoriza que el pago del salario y demás conceptos laborales que se realicen por causa o con ocasión de este Contrato, se efectúen a través de cuenta bancaria de la institución que designe EL EMPLEADOR y así mismo acepta que para facilitar el retiro del dinero, se haga con Tarjeta Débito o el medio técnico ágil que tenga el banco. Lo anterior de conformidad con lo expresado por el Artículo 138 del Código Sustantivo del Trabajo, de igual manera autoriza al EMPLEADOR, en el evento en que se niegue o no sea posible recibirla directamente, para que deposite en la mencionada cuenta el monto de su liquidación final de contrato de trabajo. PARÁGRAFO 3: EL TRABAJADOR (A), tendrá un término de treinta (30) días calendario contados desde el día en que se le hace efectivo el pago del salario en cada período quincenal, para reclamar por escrito al EMPLEADOR cualquier inconformidad que tuviere sobre la liquidación o pago del salario; por consiguiente, de no hacerse reclamación alguna durante el término aquí estipulado, las partes acuerdan que existirá tácita aceptación por parte del TRABAJADOR (A), de la liquidación y pago de las horas laboradas. PARÁGRAFO 4: DEDUCCIONES: EL TRABAJADOR (A) autoriza en forma expresa al EMPLEADOR para retener, deducir y/o compensar de sus salarios, prestaciones sociales, indemnizaciones y/o cualquier otra acreencia laboral (si el salario fuere insuficiente), cualquier suma de dinero que EL TRABAJADOR (A), llegare a adeudar por cualquier concepto y/o a cualquier título al EMPLEADOR, sin necesidad de requerimiento alguno, constitución en mora, decisión judicial u orden escrita especial del TRABAJADOR (A), pues el presente Contrato la suple; esta autorización la imparte EL TRABAJADOR (A), de acuerdo con los Artículos 59 y 149, en sus Numerales 1° del Código Sustantivo del Trabajo, se incluyen en esta autorización en forma expresa la autorización de cualquier suma que EMPLEADOR cancele en exceso al TRABAJADOR (A), o sin que este tenga derecho a percibirla, así mismo como es obligación esencial del TRABAJADOR (A), responder por los útiles, maquinaria, equipo y elementos relacionados con su labor, que EL EMPLEADOR haya puesto bajo su responsabilidad y cuidado; cuando ocurran daños o pérdidas no imputables al desgaste por uso normal o corriente de dichos elementos, sino a la culpa y descuido del TRABAJADOR (A), éste reconocerá y pagará el valor comercial o precio del arreglo del objeto o material dañado o perdido, siempre que sea posible a juicio del EMPLEADOR; por ello autoriza expresamente al EMPLEADOR para retener, deducir o compensar de sus salarios, comisiones y aún de sus prestaciones sociales y liquidación definitiva, el valor correspondiente, sin necesidad de requerimiento alguno, constitución en mora, decisión judicial u orden escrita especial del TRABAJADOR (A) pues el presente Contrato la suple; esta autorización la imparte EL TRABAJADOR (A) de acuerdo con los Artículos 59 y 149, en sus Numerales 1° del Código Sustantivo del Trabajo. PARÁGRAFO 5.- BENEFICIOS EXTRALEGALES: Las partes acuerdan que en los casos en que se le reconozca al TRABAJADOR (A) beneficios diferentes al salario, por concepto de alimentación, habitación o vivienda, transporte y vestuario, se considerarán tales beneficios o reconocimientos como no salariales y por tanto no se tendrán en cuenta como factor salarial para la liquidación de acreencias laborales, ni el pago de aportes parafiscales, de conformidad con los Arts. 15 y 16 de la Ley 50/90, en concordancia con el Art. 17 de la Ley 311/96. Así mismo las partes estipulan que por tratarse de beneficios extralegales no constitutivos de salario y por mera liberalidad de EL EMPLEADOR, éste se reservará el derecho de modificarlos o suprimirlos en forma unilateral en cualquier momento cuando las condiciones de la empresa así lo exijan, sin que ello implique desmejora alguna en las condiciones laborales de EL TRABAJADOR (A). PARÁGRAFO 6.- En razón a que EL EMPLEADOR suministra a EL TRABAJADOR (A) alimentación a bajo costo, EL TRABAJADOR (A) autoriza a EL EMPLEADOR sean deducidas de su nómina mensual de salarios, el monto de alimentación acordado.',
  },
  {
    titulo: 'TERCERA. - TRABAJO NOCTURNO, SUPLEMENTARIO, DOMINICAL Y/O FESTIVO.',
    texto:
      'Todo trabajo nocturno, suplementario o en horas extras y todo trabajo el domingo o festivo en los que legalmente debe concederse descanso, se remunerará conforme lo dispone expresamente la ley, salvo acuerdo en contrario contenido en convención, pacto colectivo o laudo arbitral. Para el reconocimiento y pago del trabajo suplementario, nocturno, dominical o festivo, EL EMPLEADOR o sus representantes deben autorizarlo previamente y por escrito. Cuando la necesidad de este trabajo se presente de manera imprevista o inaplazable, deberá ejecutarse y darse cuenta de él por escrito, a la mayor brevedad, a EL EMPLEADOR o a sus representantes para su aprobación. EL EMPLEADOR, en consecuencia, no reconocerá ningún trabajo suplementario o trabajo nocturno o en días de descanso legalmente obligatorio que no haya sido autorizado previamente o avisado inmediatamente, como queda dicho.',
  },
  {
    titulo: 'CUARTA. - JORNADA DE TRABAJO.',
    texto:
      'EL TRABAJADOR, salvo estipulación expresa y escrita en contratación, se obliga a laborar la jornada máxima legal cumpliendo con los turnos y horarios que señale EL EMPLEADOR, quien podrá cambiarlos o ajustarlos cuando lo estime conveniente. Por el acuerdo expreso o tácito de las partes, podrán repartirse total o parcialmente las horas de la jornada ordinaria con base en lo dispuesto por el Art. 164 del C.S.T., modificado por el artículo 23 de la Ley 50 de 1990, teniendo en cuenta que los tiempos de descanso entre las secciones de la jornada no se computan dentro de la misma, según el artículo 167 ibidem. De igual manera, las partes podrán acordar que se preste el servicio en los turnos de jornada flexible contemplados en el Artículo 51 de la Ley 789 de 2002.',
  },
  {
    titulo: 'QUINTA. - DURACIÓN DEL CONTRATO.',
    texto:
      'El presente contrato tendrá vigencia definida, en el periodo comprendido en dicho contrato, pero es renovable por tres períodos iguales siempre y cuando antes de la fecha del vencimiento del término estipulado, ninguna de las partes avisare por escrito a la otra su determinación de no prorrogarlo, con una antelación no inferior a treinta (30) días, finalizada la tercera prórroga las sucesivas se entenderán celebradas por un año. PERIODO DE PRUEBA. La quinta parte del periodo inicialmente pactado, sin que en ningún caso supere 2 meses, se considera como periodo de prueba y, por consiguiente, cualquiera de las partes podrá terminar unilateralmente, en cualquier momento durante dicho periodo sin que por este hecho se cause el pago de indemnización alguna.',
  },
  {
    titulo: 'SEXTA. - TERMINACIÓN UNILATERAL.',
    texto:
      'Son justas causas para dar por terminado unilateralmente este contrato, por cualquiera de las partes, las enumeradas en los Arts. 62 y 63 del C.S.T., modificados por el Art. 7 del Decreto 2351/65 y además, por parte del EMPLEADOR, las faltas que para efecto se califiquen como graves en reglamentos y demás documentos que contengan reglamentaciones, órdenes, instrucciones o prohibiciones de carácter general o particular, pactos, convenciones colectivas, laudos arbitrales, y las que expresamente convengan calificar así en escritos que formarán parte integrante del presente contrato. Expresamente se califican en este acto como faltas graves la violación a las obligaciones y prohibiciones contenidas en la cláusula primera del presente contrato y expresamente las siguientes: 1) la violación por parte del TRABAJADOR (A) de cualquiera de sus obligaciones y/o prohibiciones legales contractuales o reglamentarias; 2) la ejecución por parte del TRABAJADOR (A) de labores remuneradas a servicios de terceros sin autorización del EMPLEADOR, por cuanto constituye violación a la exclusividad pactada en la cláusula primera del presente contrato; 3) La revelación de secretos y datos reservados de la empresa o cualquier violación de la confidencialidad de que da cuenta el parágrafo de la cláusula primera del presente contrato; 4) Las repetidas desavenencias con los demás trabajadores de la empresa; 5) El hecho de que EL TRABAJADOR se presente al trabajo embriagado, bajo el influjo de bebidas alcohólicas, o ingiera bebidas embriagantes o alucinógenos en el lugar de trabajo, aún por la primera vez, por cuanto el consumo de alcohol, narcóticos o cualquier otra droga enervante, afecta de manera directa el desempeño laboral del trabajador en todos y cada uno de los cargos de la organización, tal y como lo señala y aclara la sentencia C-636 de 2016. 6) La no asistencia a una sección completa de la jornada de trabajo o más sin justificación; 7) Replicar mensajes por correo electrónico de divulgación general o de advertencias públicas recibidos de fuentes externas; 8) Omitir el cumplimiento de sus responsabilidades respecto de la seguridad de la información, creada, procesada o utilizada en el soporte del negocio, sin importar el medio, formato, presentación o lugar donde se encuentre; 9) Cargar, instalar o archivar en los recursos informáticos, hardware o software de cualquier tipo en especial software de desarrollo o programación, software de crackeo (utilizando para descifrar claves de programas, sitios en Internet o claves colocadas a archivos de Word y de Excel) sin previa autorización formal de Líder de Seguridad informática de EL EMPLEADOR; 10) Bajar cualquier tipo de software o programa no autorizado desde Internet para instalarlo en su computador, instalar software de uso personal, en especial juegos, videos, protectores de pantalla, reproductores de mp3, copia archivos de música (mp3, avi, mpeg, midi) en el disco duro de la estación de trabajo, software que entregan con revistas o promociones y en general cualquier programa licenciado para uso personal; 11) Alterar el código fuente de los programas instalados, y la configuración del sistema operativo de su computador; 12) El hecho de que EL TRABAJADOR (A): a) no deposite a órdenes del EMPLEADOR dentro del término de veinticuatro (24) horas, luego de su recibo o de su regreso a Bogotá, cualquier género de valores o dinero que le fuese entregado por terceros con destino al EMPLEADOR; b) entregue informes falsos sobre su trabajo, actitud que constituye un grave engaño para EL EMPLEADOR; c) no de aviso inmediato al EMPLEADOR sobre la ocurrencia de un accidente de trabajo que sufra, cualquiera que sea la magnitud del mismo.',
  },
  {
    titulo: 'SEPTIMA. - MODIFICACIÓN DE LAS CONDICIONES LABORALES.',
    texto:
      'EL TRABAJADOR (A) acepta desde ahora expresamente todas las modificaciones de sus condiciones laborales determinadas por EL EMPLEADOR en ejercicio de su poder subordinante, tales como los turnos y jornadas de trabajo, el lugar de prestación de servicio, el cargo u oficio y/o funciones y la forma de remuneración, siempre que tales modificaciones no afecten su honor, dignidad de sus derechos mínimos ni impliquen desmejoras sustanciales o graves perjuicios para él, de conformidad por lo dispuesto por el Art. 23 del C.S.T. modificado por el Art. 1 de la Ley 50/90. Los gastos que se originen con el traslado del lugar de prestación de servicios serán cubiertos por EL EMPLEADOR, de conformidad por el numeral 8 del Art. 57 del C.S.T.',
  },
  {
    titulo: 'OCTAVA. - DOMICILIO CONTRACTUAL – TRASLADOS.',
    texto:
      'Para todos los efectos legales, el contrato tendrá como domicilio principal la ciudad de Bogotá, lugar donde se suscribe e inicia la ejecución del mismo, no obstante lo anterior, teniendo en cuenta que el cargo para el cual se contrata a EL TRABAJADOR (A) implica en esencia su movilización y traslado por diversas regiones y poblaciones del territorio nacional, EL TRABAJADOR (A) manifiesta en forma expresa, libre y voluntaria que acepta tales condiciones como parte integral del contrato y en consecuencia declara desde ya que tales traslados o movilizaciones del domicilio principal no constituyen desmejora alguna de sus condiciones salariales, ni implican de manera alguna perjuicios morales para él o los miembros de su familia. Los gastos que se originen con el traslado serán cubiertos por EL EMPLEADOR, de conformidad con el numeral 8º del artículo 57 del Código Sustantivo del Trabajo y demás normas concordantes.',
  },
  {
    titulo: 'NOVENA. - DIRECCIÓN DEL TRABAJADOR (A).',
    texto:
      'Para todos los efectos legales y en especial para la aplicación del parágrafo 1 del artículo 29 de la Ley 789 de 2002, norma que modificó el art. 65 C.S.T, se compromete a informar por escrito y de manera inmediata a EL EMPLEADOR cualquier cambio en su dirección de residencia, teniéndose en todo caso como suya la última dirección de su hoja de vida.',
  },
  {
    titulo: 'DÉCIMA. - TECNOLOGÍA E INFORMÁTICA.',
    texto:
      'De igual manera EL TRABAJADOR (A) se obliga de manera especial a lo siguiente: a) Reconocer que los equipos de computación y software, propiedad de la empresa están destinados para propósitos propios de la organización. b) A no instalar bajo ninguna circunstancia software aplicativo personal en equipos de la entidad. Aquellos requerimientos especiales para aplicaciones no estándares, deben estar acompañados por una justificación de negocio y deben ser manejados sólo por personal del área de informática debidamente autorizado. c) A no usar los equipos y software instalados en la empresa, para crear, bajar de Internet, o distribuir material sexual, ofensivo o inapropiado. d) A manejar con el debido cuidado los equipos por lo tanto las comidas, bebidas y otros objetos similares se deben mantener lejos de ellos. Las computadoras portátiles deben mantenerse en todo momento en un lugar seguro. e) no está facultado(a) para enviar correos electrónicos en forma discriminada a todo el personal de la empresa, clientes o amigos sin la autorización previa de la Gerencia General. f) EL TRABAJADOR (A) es responsable del mantenimiento y buen estado del equipo que tiene asignado, es decir, que igualmente es responsable de lo que en dicho equipo se encuentre o se dañe por uso inapropiado. Por lo tanto, se deben tomar todas las precauciones necesarias y evitar que otras personas utilicen el equipo asignado sin autorización, ya que podrían instalar, borrar, dañar o copiar software o archivos no permitidos. g) A no utilizar los equipos de propiedad de la empresa que sirvan para la creación, almacenamiento e intercambio electrónico de datos, tales como ordenadores (computadoras), faxes, celulares, equipos o cualquier otro similar, para atender asuntos o realizar actividades distintas a las que la empresa le encomienda. h) A abstenerse de crear o utilizar cuentas de correo electrónico personales o cuentas en proveedores de servicios de comunicaciones nacionales o internacionales tales como mensajería instantánea, video conferencia o teleconferencia o cualquier otro que sirva para el intercambio de información por medios electrónicos o digitales o a través de la Internet. i) A autorizar expresamente a EL EMPLEADOR para retirar en cualquier momento los equipos que le hubieren sido asignados y para inspeccionarlos con fines de detección de soporte lógico malicioso (virus), caso en el cual informará inmediatamente si existe información de carácter privilegiado que deba ser sometida a reserva o a custodia. j) A usar las herramientas tecnológicas del software que EL EMPLEADOR ha puesto a disposición del empleado, especialmente las concernientes a gestión documental, gestión humana y operación (servicio al cliente, compras, presupuesto, contratos, comercial, entre otras).',
  },
  {
    titulo: 'DÉCIMA PRIMERA. - SARLAFT.',
    texto:
      'SISTEMA DE ADMINISTRACIÓN DEL RIESGO PARA EL LAVADO DE ACTIVOS Y FINANCIACIÓN DEL TERRORISMO: EL TRABAJADOR (A) acepta, entiende y conoce que EL EMPLEADOR, tiene la obligación legal de prevenir y controlar el lavado de activos y la financiación del terrorismo, por tanto, expresa de manera voluntaria e inequívoca, que no se encuentra vinculado ni ha sido condenado por parte de las autoridades nacionales e internacionales en cualquier tipo de investigación por delitos de narcotráfico, terrorismo, secuestro, lavado de activos, financiación del terrorismo y administración de recursos relacionados con actividades terroristas y/o cualquier delito colateral o subyacente a estos; ni se encuentra incluido en listas para el control de lavado de activos y financiación del terrorismo, administradas por cualquier autoridad nacional o extranjera. Convienen las partes, conforme a lo establecido en el numeral 6º del artículo séptimo del decreto 2351 de 1.965, que la inexactitud en la manifestación de EL TRABAJADOR (A) contenida en la presente adición al contrato de trabajo, constituye falta grave y dará lugar a la terminación del contrato de trabajo por justa causa de despido.',
  },
  {
    titulo: 'DÉCIMA SEGUNDA. - AUTORIZACIÓN PARA TRATAMIENTO DE DATOS PERSONALES:',
    texto:
      'En los términos previstos por el literal a) del artículo 6 de la Ley Estatutaria 1581 de 2012 y por el Decreto 1377 de 2013, EL TRABAJADOR (A) autoriza explícitamente al EMPLEADOR, en forma previa, expresa e informada, para que directamente o a través de sus empleados, asesores, consultores, empresas usuarias, proveedores de servicios de selección, contratación, exámenes ocupacionales, estudios de seguridad, dotación y elementos de protección personal, capacitaciones, cursos de manipulación alimentos, alturas, entre otros, y/o terceros encargados del tratamiento de datos, relacionados con su vinculación laboral, como Entidades del Estado, Entidades financieras, Fondos de empleados, Fondos funerarios, Empresas del Sistema de Seguridad Social: Fondos de Pensiones, EPS, Administradoras de Riesgos Laborales, Cajas de Compensación Familiar, entre otros: 1. A realizar cualquier operación que tenga una finalidad lícita, tales como la recolección, el almacenamiento, el uso, la circulación, supresión, transferencia y transmisión (el "Tratamiento") de los datos personales relacionados con su vinculación laboral y con la ejecución, desarrollo y terminación del presente contrato de trabajo, cuya finalidad incluye, pero no se limita, a los procesos verificación de la aptitud física del TRABAJADOR (A) para desempeñar en forma eficiente las labores sin impactar negativamente su salud o la de terceros, las afiliaciones del TRABAJADOR (A) y sus beneficiarios al Sistema general de seguridad social y parafiscales, la remisión del TRABAJADOR (A) para que realice apertura de cuenta de nómina, archivo y procesamiento de nómina, gestión y archivo de procesos disciplinarios, archivo de documentos soporte de su vinculación contractual, reporte ante autoridades administrativas, laborales, fiscales o judiciales, entre otras, así como el cumplimiento de obligaciones legales o contractuales del EMPLEADOR con terceros, la debida ejecución del Contrato de trabajo, el cumplimiento de las políticas internas del EMPLEADOR, la verificación del cumplimiento de las obligaciones del TRABAJADOR (A), la administración de sus sistemas de información y comunicaciones, la generación de copias y archivos de seguridad de la información en los equipos proporcionados por EL EMPLEADOR. Además, la información personal se recibirá y utilizará para efectos de administración del factor humano en temas de capacitación laboral, bienestar social, cumplimiento de normas de seguridad laboral y seguridad social, siendo necesario, en algunos eventos, recibir información sensible sobre estados de salud e información de menores de edad beneficiarios de esquemas de seguridad social, así como la información necesaria para el cumplimiento de obligaciones laborales de orden legal y extralegal. Toda la anterior información se tratará conforme a las exigencias legales en cada caso. EL TRABAJADOR (A) autoriza al EMPLEADOR para que, con una cualquiera de las finalidades antes anotadas, acceda y consulte datos personales que se encuentren almacenados en bases de datos y archivos de operadores o entidades públicas y privadas nacionales y extranjeras. 2. EL TRABAJADOR (A) conoce el carácter facultativo de entregar o no al EMPLEADOR sus datos sensibles. 3. EL TRABAJADOR (A) reconoce y acepta que el Tratamiento de sus Datos Personales efectuado por fuera del territorio colombiano puede regirse para algunos efectos por leyes extranjeras. 4. EL TRABAJADOR (A) reconoce que ha sido informado de los derechos que le asisten en su calidad de titular de Datos Personales, entre los que se encuentran los siguientes: i) conocer, actualizar y rectificar sus Datos Personales frente al EMPLEADOR o quienes por cuenta de éste realicen el Tratamiento de sus Datos Personales; ii) solicitar prueba de la autorización otorgada al EMPLEADOR salvo cuando la ley no lo requiera; iii) previa solicitud, ser informado sobre el uso que se ha dado a sus Datos Personales, por EL EMPLEADOR o quienes por cuenta de éste realicen el Tratamiento de sus Datos Personales; iv) presentar ante las autoridades competentes quejas por violaciones al régimen legal colombiano de protección de datos personales; v) revocar la presente autorización y/o solicitar la supresión de sus Datos Personales cuando la autoridad competente determine que EL EMPLEADOR incurrió en conductas contrarias a la ley y a la Constitución; y vi) acceder en forma gratuita a sus Datos Personales que hayan sido objeto de Tratamiento. 5. EL TRABAJADOR (A) autoriza al responsable del tratamiento de los datos, para que este pueda compartir los datos del titular, con cualquier organización con la que exista relación alguna, siempre y cuando los datos se compartan para dar cumplimiento a la relación laboral existente. 6. EL TRABAJADOR (A) autoriza al responsable del tratamiento de manera expresa a dar tratamiento a los datos sensibles del titular, siendo estos datos los siguientes: origen racial o étnico, orientación sexual, filiación política o religiosa, datos referentes a la salud, datos biométricos, actividad en organizaciones sindicales o de derechos humanos. 7. EL TRABAJADOR (A) da autorización expresa al responsable del tratamiento para que capture y use la información personal y sensible de sus hijos menores de edad. 8. EL TRABAJADOR (A) declara que conoce y acepta el Manual Política Uso de Datos Personales e Información del EMPLEADOR, y que la información proporcionada por él es veraz, completa, exacta, actualizada y verificable. Mediante la firma del presente documento, manifiesta que conoce y acepta que cualquier consulta o reclamación relacionada con el Tratamiento de sus datos personales podrá ser elevada por escrito ante EL EMPLEADOR, como responsable del Tratamiento al correo protecciondedatos.tuapo@gmail.com; persona contacto: oficial de cumplimiento de datos personales.',
  },
  {
    titulo: 'DÉCIMA TERCERA. - INCAPACIDADES MÉDICAS:',
    texto:
      'Si EL TRABAJADOR, por causa de enfermedad o accidente, no asistiere a su trabajo, deberá presentar a EL EMPLEADOR, a la mayor brevedad, la respectiva incapacidad, a cuyo efecto se establece que exclusivamente será válida la expedida por los médicos de la respectiva Entidad Promotora de Salud, para justificar las ausencias antedichas.',
  },
  {
    titulo: 'DÉCIMA CUARTA. - AUTORIZACIÓN DE ACCESO A HISTORIA CLÍNICA:',
    texto:
      'De acuerdo con lo establecido en el artículo 34 de la Ley 23 de 1981 y la Resolución 1995 de 1999 expedida por el Ministerio de Salud, EL TRABAJADOR autoriza expresamente a EL EMPLEADOR para que tenga acceso y copia de su historia clínica, así como de todos aquellos datos que en aquélla se registren o lleguen a ser registrados en general y para adelantar todos los trámites que sean necesarios ante entidades como Empresas Promotoras de Salud (EPS), Administradoras de Riesgos Laborales (ARL), Administradoras de Fondos de Pensiones (AFP), Instituciones Prestadoras de Salud (IPS), médicos particulares y demás entidades de la Seguridad Social.',
  },
  {
    titulo: 'DÉCIMA QUINTA. - LIQUIDACIÓN.',
    texto:
      'EL TRABAJADOR acepta desde ahora que si a la finalización del presente contrato de trabajo a EL EMPLEADOR se le presentaren circunstancias que le impidieren efectuar oportunamente la liquidación del contrato, dicho EMPLEADOR dispondrá de quince (15) días hábiles contados desde la aludida terminación para tales efectos.',
  },
  {
    titulo: 'DÉCIMA SEXTA. - REGLAMENTO DE TRABAJO Y DE HIGIENE Y SEGURIDAD INDUSTRIAL.',
    texto:
      'EL TRABAJADOR deja constancia de que conoce y acepta el Reglamento de Trabajo y el Reglamento de Higiene y Seguridad Industrial DEL EMPLEADO.',
  },
  {
    titulo: 'DÉCIMA SEPTIMA. - AUTORIZACIÓN DE EXÁMENES DE ALCOHOLEMIA Y TÉCNICAS DE POLÍGRAFO.',
    texto:
      'EL TRABAJADOR autoriza de manera expresa AL EMPLEADOR para que le sean practicados cuestionarios y/o pruebas de selección directa o aleatoria de confiabilidad con la utilización de técnicas de polígrafo y/o exámenes fisiológicos en virtud de la investigación disciplinaria que realice la Empresa y que lo amerite, o en cualquier momento cuando así lo estime pertinente la Compañía, y que los podrá utilizar como pruebas para los mismos fines. Por su parte EL EMPLEADOR garantiza en este acto que el trabajador tendrá entrevista con el profesional que aplicará la evaluación, donde recibirá explicación previa acerca del funcionamiento del polígrafo, precisando desde ya, que la práctica de la misma atenderá los requisitos normativos, entendiéndose, por consiguiente, que la misma no contraviene la dignidad humana ni los derechos fundamentales que le asisten al trabajador. Así mismo, el trabajador autoriza AL EMPLEADOR para custodiar y utilizar los resultados de las pruebas, judicial o extrajudicialmente para los fines que estime pertinentes, reiterando al referido trabajador que dichos procedimientos no constituirán en ningún caso un atentado contra la dignidad humana o sus derechos fundamentales.',
  },
  {
    titulo: 'DÉCIMA OCTAVA. - REQUISAS Y CHEQUEOS.',
    texto:
      'De acuerdo con la obligación especial que le impone el artículo 57 numeral 9 del Código Sustantivo del Trabajo, consistente en "cumplir el reglamento y mantener el orden, la moralidad y el respeto a las leyes", la empresa podrá implementar requisas y chequeos encaminados a evitar el hurto de elementos, equipos y herramientas de propiedad de la empresa o de los demás trabajadores, o para impedir el ingreso de elementos que la empresa ha prohibido ingresar, pero siempre dentro de la racionalidad y el respeto de la intimidad.',
  },
  {
    titulo: 'DÉCIMA NOVENA. - TRABAJO EN CASA.',
    texto:
      'EL EMPLEADOR podrá en cualquier momento de la ejecución del contrato modificar temporalmente el lugar del trabajo del TRABAJADOR de manera unilateral, cambiando la manera física de la prestación del servicio en las instalaciones de la empresa, a la dirección de domicilio que designe el TRABAJADOR, subsistiendo mientras tanto todas las obligaciones recíprocas contenidas en este contrato. PARÁGRAFO PRIMERO. Durante el tiempo de ejecución de las labores desde la residencia del TRABAJADOR el empleador deberá suministrar los equipos necesarios para la consecución de las labores, haciendo salvedad de que el TRABAJADOR debe prestar el cuidado necesario para los equipos y materiales dispuestos. PARÁGRAFO SEGUNDO. Con el fin de hacer seguimiento a las labores realizadas por el TRABAJADOR, el EMPLEADOR podrá solicitar informes, tiempo de reporte y instalar en los equipos todos los programas necesarios para realizar control sobre el trabajo ejercido de manera remota. PARÁGRAFO TERCERO. Se reconocerá en favor del TRABAJADOR el subsidio de conectividad en reemplazo del subsidio de transporte mientras se ejecuten las labores bajo esta modalidad de trabajo.',
  },
  {
    titulo: 'VIGÉSIMA. - REGLAMENTO DE TRABAJO.',
    texto:
      'Con la firma del presente documento el trabajador acepta haber recibido leído y entendido el Reglamento de Trabajo de la empresa y se obliga sin ninguna condición al cumplimiento del mismo.',
  },
  {
    titulo: 'VIGÉSIMA PRIMERA. - EFECTOS.',
    texto:
      'El presente contrato reemplaza en su integridad y deja sin efecto cualquier otro contrato verbal o escrito, celebrado entre las partes con anterioridad, pudiendo las partes convenir por escrito modificaciones al mismo, las que formarán parte integrante de este contrato.',
  },
];

/* ----------------------------------------------------------------------------
 * Render principal
 * ------------------------------------------------------------------------- */

const PAGE_W = 215.9; // letter en mm (8.5")
const PAGE_H = 279.4; // letter en mm (11")
const MARGIN_X = 8; // 8mm a cada lado → área útil = 199.9mm
const HEADER_TOP = 5;
const HEADER_H = 13;
const HEADER_BOTTOM = HEADER_TOP + HEADER_H; // y=18
const TABLE_W = PAGE_W - 2 * MARGIN_X; // 199.9mm — el header usa este mismo ancho
const BODY_TOP = HEADER_BOTTOM + 4; // y=22, deja aire bajo el header
const BODY_BOTTOM = PAGE_H - 12; // y=267.4, margen inferior 12mm
const LH = 3.4; // line-height por línea de cuerpo (fontSize 6.5)

function drawHeader(
  doc: jsPDF,
  cfg: EmpresaConfig,
  codigoContratacion: string,
  pagina: number,
  totalPaginas: number
): void {
  const startX = MARGIN_X;
  const startY = HEADER_TOP;
  const logoBoxW = 50;
  const tableW = TABLE_W - logoBoxW;

  // Limpia el área del header por si encima ya hay tinta (ej. al repaginar al final).
  doc.setFillColor(255, 255, 255);
  doc.rect(startX, startY, TABLE_W, HEADER_H, 'F');

  // Caja izquierda (logo + NIT)
  doc.setLineWidth(0.1);
  doc.rect(startX, startY, logoBoxW, HEADER_H);

  try {
    doc.addImage(cfg.logoPath, 'PNG', startX + 2, startY + 1.5, 27, 10);
  } catch {
    /* logo opcional */
  }

  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('NIT', startX + 32, startY + 7);
  doc.setFont('helvetica', 'normal');
  doc.text(cfg.nit, startX + 32, startY + 10);

  // Caja derecha (tabla con código/versión/fecha/página)
  const tableStartX = startX + logoBoxW;
  doc.rect(tableStartX, startY, tableW, HEADER_H);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  // Centra el rótulo "PROCESO DE CONTRATACIÓN" en la mitad izquierda y deja el código a la derecha
  doc.text('PROCESO DE CONTRATACIÓN', tableStartX + 4, startY + 3);
  doc.text(s(codigoContratacion), tableStartX + tableW - 36, startY + 3);
  doc.text(
    'CONTRATO INDIVIDUAL DE TRABAJO A TÉRMINO FIJO INFERIOR A UN AÑO',
    tableStartX + 4,
    startY + 7
  );

  // 4 columnas iguales en la fila inferior del header (código, versión, fecha emisión, página)
  const colW = tableW / 4;
  const cx0 = tableStartX;
  const cx1 = tableStartX + colW;
  const cx2 = tableStartX + 2 * colW;
  const cx3 = tableStartX + 3 * colW;

  doc.line(tableStartX, startY + 4, tableStartX + tableW, startY + 4);
  doc.line(tableStartX, startY + 8, tableStartX + tableW, startY + 8);
  doc.line(cx1, startY + 8, cx1, startY + HEADER_H);
  doc.line(cx2, startY + 8, cx2, startY + HEADER_H);
  doc.line(cx3, startY + 8, cx3, startY + HEADER_H);

  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'bold');
  doc.text(`Código: ${cfg.codigoPlantilla}`, cx0 + 1.5, startY + 11.5);
  doc.text(`Versión: ${cfg.versionPlantilla}`, cx1 + 1.5, startY + 11.5);
  doc.text(`Fecha Emisión: ${cfg.fechaEmisionPlantilla}`, cx2 + 1.5, startY + 11.5);
  doc.text(`Página: ${pagina} de ${totalPaginas}`, cx3 + 1.5, startY + 11.5);
}

/** Devuelve true si la palabra debe ir en negrita (todo-MAYÚSCULAS, incluye letras). */
function isBoldWord(word: string): boolean {
  return word === word.toUpperCase() && /[A-ZÁÉÍÓÚÜÑ]/.test(word);
}

/** Item interno: una palabra con su ancho medido y su estilo. */
interface WordItem { word: string; width: number; bold: boolean; }

/**
 * Pinta UNA línea ya justificada (ancho exacto = maxWidth) en (x,y).
 * Para la última línea de un párrafo se invoca con `isLastLine=true` y se
 * deja alineada a la izquierda (no se estira).
 */
function renderJustifiedLine(
  doc: jsPDF,
  line: WordItem[],
  x: number,
  y: number,
  maxWidth: number,
  isLastLine: boolean
): void {
  doc.setFont('helvetica', 'normal');
  const spaceW = doc.getTextWidth(' ');

  const totalTextW = line.reduce((sum, w) => sum + w.width, 0);
  const totalGaps = line.length - 1;
  const extra = maxWidth - totalTextW;
  const shouldJustify = !isLastLine && totalGaps > 0 && extra > 0;
  const gapW = shouldJustify ? extra / totalGaps : spaceW;

  // Para garantizar alineación derecha perfecta, fijamos la última palabra
  // sobre `x + maxWidth - lastWordWidth` cuando justificamos.
  const lastW = line[line.length - 1]?.width ?? 0;
  const xLast = shouldJustify ? x + maxWidth - lastW : 0;

  let cx = x;
  for (let i = 0; i < line.length; i++) {
    const it = line[i];
    doc.setFont('helvetica', it.bold ? 'bold' : 'normal');
    doc.text(it.word, cx, y);
    if (i < totalGaps) {
      cx = shouldJustify && i === totalGaps - 1
        ? xLast
        : cx + it.width + gapW;
    }
  }
  doc.setFont('helvetica', 'normal');
}

/**
 * Render de párrafo con justificación palabra-por-palabra y paginación segura.
 *  - Cada línea interna se estira al ancho exacto de `maxWidth`.
 *  - La ÚLTIMA línea del párrafo se deja a la izquierda (evita estirones feos).
 *  - Detecta palabras en MAYÚSCULAS y las pinta en negrita.
 *  - Pagina si la siguiente línea no cabe; los headers los dibuja `repaginate`.
 */
function renderJustifiedParagraph(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  fontSize: number = 6.5
): number {
  // Se sanea AQUI, en la entrada del justificado: por este camino pasa el
  // cuerpo del contrato (nombres, direcciones) y las palabras se parten
  // antes de llegar a doc.text, asi que no hay otro punto unico.
  const clean = sanitizeWinAnsi(
    String(text ?? '').replace(/\r/g, '').replace(/\s+/g, ' ').trim(),
  );
  if (!clean) return y;

  doc.setFontSize(fontSize);
  doc.setFont('helvetica', 'normal');
  const spaceW = doc.getTextWidth(' ');

  const words = clean.split(' ');
  const wordsBold = words.map(w => isBoldWord(w));

  // Mide cada palabra con su estilo real (bold/normal)
  const wordWidths: number[] = new Array(words.length);
  for (let i = 0; i < words.length; i++) {
    doc.setFont('helvetica', wordsBold[i] ? 'bold' : 'normal');
    const w = doc.getTextWidth(words[i]);
    wordWidths[i] = Number.isFinite(w) ? w : 0;
  }
  doc.setFont('helvetica', 'normal');

  // Arma líneas greedy
  const lines: WordItem[][] = [];
  let cur: WordItem[] = [];
  let curW = 0;
  for (let i = 0; i < words.length; i++) {
    const itemW = wordWidths[i];
    const addSpace = cur.length > 0 ? spaceW : 0;
    const tentative = curW + itemW + addSpace;
    if (tentative > maxWidth && cur.length > 0) {
      lines.push(cur);
      cur = [{ word: words[i], width: itemW, bold: wordsBold[i] }];
      curW = itemW;
    } else {
      cur.push({ word: words[i], width: itemW, bold: wordsBold[i] });
      curW = tentative;
    }
  }
  if (cur.length) lines.push(cur);

  // Pinta línea por línea, paginando si hace falta
  for (let li = 0; li < lines.length; li++) {
    if (y + lineHeight > BODY_BOTTOM) {
      doc.addPage();
      y = BODY_TOP;
    }
    const isLast = li === lines.length - 1;
    renderJustifiedLine(doc, lines[li], x, y, maxWidth, isLast);
    y += lineHeight;
  }
  doc.setFont('helvetica', 'normal');
  return y;
}

/**
 * Wrapper de compatibilidad con la firma anterior — paginería + justificación.
 * Ya no necesita el `cfg`/`codigoContratacion` (lo conserva por API), porque
 * `repaginate` redibuja los headers al final.
 */
function renderTextWithHeader(
  doc: jsPDF,
  _cfg: EmpresaConfig,
  _codigoContratacion: string,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
): number {
  return renderJustifiedParagraph(doc, text, x, y, maxWidth, lineHeight);
}

/** Renderiza una cláusula con título en negrita + cuerpo paginado de forma segura. */
function renderClausula(
  doc: jsPDF,
  cfg: EmpresaConfig,
  codigoContratacion: string,
  titulo: string,
  texto: string,
  startY: number,
  ensureSpaceBeforeBodyMm: number = 12
): number {
  let y = startY;

  // Si no cabe ni el título + 2 líneas de cuerpo, salta de página primero.
  // El encabezado de la nueva página lo pinta `repaginate` al final.
  if (y + ensureSpaceBeforeBodyMm > BODY_BOTTOM) {
    doc.addPage();
    y = BODY_TOP;
  }

  // Título (negrita)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text(titulo, MARGIN_X, y);
  y += 3.5;

  // Cuerpo (paginación + header redibujado por la helper interna)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  y = renderTextWithHeader(doc, cfg, codigoContratacion, texto, MARGIN_X, y, TABLE_W, LH);

  // Espacio entre cláusulas
  return y + 2.5;
}

/** Bloque de datos básicos a 2 columnas (empleador / empleado). */
function renderDatosBasicos(
  doc: jsPDF,
  cfg: EmpresaConfig,
  o: BuildContratoAdministrativoOpts,
  startY: number
): number {
  // 2 columnas: cada una ocupa la mitad del ancho útil. Dentro de cada columna,
  // el rótulo va en la mitad izquierda y el valor en la derecha — así nunca se solapan.
  const colW = TABLE_W / 2;             // ancho de columna ≈ 99.95mm
  const labelW = 48;                    // mm reservados al rótulo dentro de la columna
  const lineH = 3.5;
  const xL = MARGIN_X;
  const xR = MARGIN_X + colW + 2;       // 2mm de gutter entre columnas

  const cargo = cargoDeVacante(o.vacante) || s(o.vacante?.cargo);
  // El salario se imprime en cifra + letras ("$ 2.500.000 DOS MILLONES ... PESOS
  // M/C"): antes salia el valor crudo del serializer ("1750905.00"). Si la
  // vacante no trae salario se cae al minimo legal, que es el piso de ley.
  const salario =
    salarioContratoCO(
      o.vacante?.salario ??
        o.candidato?.entrevistas?.[0]?.proceso?.vacante_salario ??
        o.candidato?.entrevistas?.[0]?.proceso?.contrato?.salario
    ) || salarioContratoCO(SMMLV_VIGENTE);

  // fecha de iniciación: viene del proceso/contrato o de la vacante
  const fechaIngresoISO =
    o.vacante?.fechaIngreso ??
    o.candidato?.entrevistas?.[0]?.proceso?.contrato?.fecha_ingreso ??
    '';
  const fechaIngreso = fechaCO(fechaIngresoISO);
  // FECHA DE TERMINACIÓN = fecha de iniciación + 1 año (contrato a término fijo
  // inferior a un año). Si no hay fecha de iniciación, se deja en blanco.
  const fechaFin = fechaCOSumandoAnios(fechaIngresoISO, 1);

  const empresaUsuaria = s(o.vacante?.empresa_usuaria_solicita);
  const finca = s(o.vacante?.finca);
  const lugarLabores = [empresaUsuaria, finca].filter(Boolean).join(' - ') || s(cfg.razonSocial);

  const empleadoNombre = nombreCompletoCandidato(o.candidato);
  const residencia = o.candidato?.residencia ?? {};
  const contacto = o.candidato?.contacto ?? {};
  const infoCc = o.candidato?.info_cc ?? {};

  // Celular: el modelo ContactoCandidato sólo tiene `celular`. Se mantienen
  // fallbacks por si el JSON viene con nombres legados (pj. numCelular).
  const celular = s(
    contacto?.celular ??
      o.candidato?.numCelular ??
      contacto?.whatsapp ??
      ''
  );

  // Departamento: el modelo ResidenciaCandidato no tiene `departamento`. Se usa
  // el departamento de expedición de la cédula (info_cc.depto_expedicion) como
  // mejor proxy del domicilio del trabajador, con fallback a depto_nacimiento.
  const departamentoTrabajador = s(
    residencia?.departamento ??
      infoCc?.depto_expedicion ??
      infoCc?.depto_nacimiento ??
      ''
  );

  const fnac = s(o.candidato?.fecha_nacimiento);
  const lugarNac = s(
    o.candidato?.lugar_nacimiento ??
      infoCc?.mpio_nacimiento ??
      residencia?.municipio ??
      ''
  );
  const fechaYLugarNac = [fechaCO(fnac), lugarNac].filter(Boolean).join('  ');

  // 10 ítems a la izquierda (empleador + identificación del trabajador)
  const left: Array<[string, string]> = [
    ['EMPLEADOR', cfg.empleadorNombre],
    ['EMPRESA', cfg.razonSocial],
    ['DOMICILIO', cfg.domicilio],
    ['DIRECCIÓN DEL EMPLEADOR', cfg.direccion],
    ['NIT', cfg.nit],
    ['TIPO DE CONTRATO', 'TÉRMINO FIJO'],
    ['EMPLEADO', empleadoNombre],
    ['DOCUMENTO DE IDENTIDAD', s(o.cedula)],
    ['DOMICILIO', departamentoTrabajador],
    ['DIRECCIÓN DE RESIDENCIA', [s(residencia?.direccion), s(residencia?.barrio)].filter(Boolean).join(' ')],
  ];

  // 9 ítems a la derecha (contacto + datos del contrato)
  const right: Array<[string, string]> = [
    ['NÚMERO DE CELULAR', celular],
    ['FECHA Y LUGAR DE NACIMIENTO', fechaYLugarNac],
    ['CARGO DE DESEMPEÑO', cargo],
    ['SALARIO', salario],
    ['PERIODOS DE PAGO', 'QUINCENALES'],
    ['FECHA DE INICIACIÓN DE LABORES', fechaIngreso],
    ['FECHA DE TERMINACIÓN', fechaFin || '_______________________________'],
    ['CIUDAD DONDE HA SIDO CONTRATADO', s(o.sede || 'BOGOTÁ').toUpperCase()],
    ['LUGAR DE DESEMPEÑO DE LABORES', lugarLabores],
  ];

  doc.setFontSize(6.5);

  const valueMaxW = colW - labelW - 1; // ancho disponible para el valor en cada columna

  /** Pinta una fila "rótulo: valor" dentro de una columna; envuelve el valor si no cabe. */
  const renderRow = (xCol: number, yCol: number, label: string, value: string): number => {
    doc.setFont('helvetica', 'normal');
    doc.text(`${label}:`, xCol, yCol);
    doc.setFont('helvetica', 'bold');
    const lines = doc.splitTextToSize(s(value), valueMaxW) as string[];
    let lineY = yCol;
    for (const ln of lines) {
      doc.text(ln, xCol + labelW, lineY);
      lineY += lineH;
    }
    return Math.max(yCol + lineH, lineY);
  };

  let yL = startY;
  for (const [t, v] of left) yL = renderRow(xL, yL, t, v);

  let yR = startY;
  for (const [t, v] of right) yR = renderRow(xR, yR, t, v);

  return Math.max(yL, yR) + 2;
}

/** Reescribe el campo "Página: X de Y" en cada página tras conocer el total. */
function repaginate(
  doc: jsPDF,
  cfg: EmpresaConfig,
  codigoContratacion: string
): void {
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    // Limpiamos solo el rectángulo donde va "Página X de Y" cubriéndolo y reescribiendo.
    // Más simple: redibujamos toda la cabecera.
    doc.setFillColor(255, 255, 255);
    doc.rect(MARGIN_X, 5, TABLE_W, HEADER_H, 'F');
    drawHeader(doc, cfg, codigoContratacion, i, total);
  }
}

/** Bloque de firmas + testigo al final del contrato. */
function renderFirmas(
  doc: jsPDF,
  cfg: EmpresaConfig,
  o: BuildContratoAdministrativoOpts,
  yStart: number
): void {
  let y = yStart;

  const SIG_BLOCK_H = 80; // alto total estimado del bloque firmas + testigo
  if (y + SIG_BLOCK_H > BODY_BOTTOM) {
    doc.addPage();
    y = BODY_TOP;
  }

  // Geometría de las dos columnas (mismo ancho que los datos básicos)
  const colW = TABLE_W / 2;
  const xL = MARGIN_X;
  const xR = MARGIN_X + colW + 2;
  const sigImgW = 35;
  const sigImgH = 17;

  // Línea introductoria (con wrap por si el nombre de la sede es largo)
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  const ciudad = s(o.sede || 'BOGOTÁ').toUpperCase();
  const fechaContratoRaw = o.candidato?.entrevistas?.[0]?.proceso?.contrato?.fecha_contrato;
  const fechaContrato = (() => {
    if (!fechaContratoRaw) return new Date();
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fechaContratoRaw).trim());
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const d = new Date(String(fechaContratoRaw));
    return isNaN(d.getTime()) ? new Date() : d;
  })();
  const dia = String(fechaContrato.getDate()).padStart(2, '0');
  const intro = `Para constancia de todo lo anterior, se firma el presente contrato de trabajo en la ciudad de ${ciudad} el día ${dia}.`;
  const introLines = doc.splitTextToSize(intro, TABLE_W) as string[];
  for (const ln of introLines) {
    doc.text(ln, MARGIN_X, y);
    y += 4;
  }
  y += 6; // espacio antes de firmas

  // Caja de firmas: imagen (si hay) → línea horizontal → labels debajo
  doc.setLineWidth(0.1);
  const lineY = y + sigImgH + 1;
  doc.line(xL, lineY, xL + colW - 4, lineY);                 // firma empleador
  doc.line(xR, lineY, xR + colW - 4, lineY);                 // firma trabajador

  // Firma del EMPLEADOR (representante legal): siempre la imagen estática del
  // archivo de la empresa correspondiente (Mayra para Apoyo, Heidy para Tu Alianza).
  if (cfg.firmaEmpleadorPath) {
    try { doc.addImage(cfg.firmaEmpleadorPath, 'PNG', xL + 4, y, sigImgW, sigImgH); }
    catch { /* firma opcional */ }
  }
  // Firma del TRABAJADOR: biometría del candidato (base64 vía opts).
  if (o.firmaTrabajadorBase64) {
    try { doc.addImage(o.firmaTrabajadorBase64, 'PNG', xR + 4, y, sigImgW, sigImgH); }
    catch { /* firma opcional */ }
  }

  // Labels bajo las líneas (mismo y para ambas columnas, sin solapamiento)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  let yEmp = lineY + 4;
  const labelLineH = 3.2;
  const labelMaxW = colW - 6;

  const writeStacked = (xCol: number, lines: string[], yTop: number) => {
    let yi = yTop;
    for (const raw of lines) {
      const wrapped = doc.splitTextToSize(raw, labelMaxW) as string[];
      for (const w of wrapped) {
        doc.text(w, xCol, yi);
        yi += labelLineH;
      }
    }
    return yi;
  };

  const yEmpEnd = writeStacked(xL, [
    'EL EMPLEADOR',
    cfg.empleadorNombre,
    'REPRESENTANTE LEGAL',
    cfg.razonSocial,
    `NIT ${cfg.nit}`,
  ], yEmp);

  const yTrabEnd = writeStacked(xR, [
    'EL TRABAJADOR',
    nombreCompletoCandidato(o.candidato),
    `C.C. ${s(o.cedula)}`,
    `EMAIL: ${s(o.candidato?.contacto?.email ?? '')}`,
    `CELULAR: ${s(o.candidato?.contacto?.numerocelular1 ?? '')}`,
  ], yEmp);

  // Testigo, debajo de ambas columnas
  let yT = Math.max(yEmpEnd, yTrabEnd) + 6;
  if (yT + 14 > BODY_BOTTOM) {
    doc.addPage();
    yT = BODY_TOP;
  }
  // Firma del testigo: SIEMPRE la del usuario logueado (firmaPersonalAdministrativo).
  // Si no hay firma cargada, no se pinta imagen — la línea queda vacía.
  if (o.firmaAdministrativoBase64) {
    try { doc.addImage(o.firmaAdministrativoBase64, 'PNG', xL + 4, yT - 11, sigImgW, sigImgH); }
    catch { /* firma opcional */ }
  }
  doc.line(xL, yT + 6, xL + colW - 4, yT + 6);
  doc.setFont('helvetica', 'bold');
  doc.text('TESTIGO', xL, yT + 10);
  doc.setFont('helvetica', 'normal');
  doc.text(s(o.nombreCompletoLogin) || 'ANDREA SOTELO JIMENEZ', xL, yT + 13);
  doc.text(`C.C. ${s(o.user?.numero_de_documento ?? '1019034641')}`, xL, yT + 16);
}

export function buildContratoAdministrativoPdf(
  o: BuildContratoAdministrativoOpts
): jsPDF {
  const cfg = resolveEmpresa(o.empresa);
  if (!cfg) {
    throw new Error(
      `Empresa no soportada para contrato administrativo: "${o.empresa}". ` +
        `Esperado APOYO LABORAL SAS o TU ALIANZA SAS.`
    );
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true });
  doc.setProperties({
    title: 'Contrato_Trabajo_Administrativo.pdf',
    creator: cfg.razonSocial,
    author: cfg.razonSocial,
  });

  // El encabezado de cada página se pinta al final con `repaginate`, una sola vez
  // por página y con la numeración correcta. Aquí solo escribimos el cuerpo.

  // Datos básicos a 2 columnas
  let y = renderDatosBasicos(doc, cfg, o, BODY_TOP + 6);

  // Intro — "Entre los suscritos..."
  const empleadoNombre = nombreCompletoCandidato(o.candidato);
  const intro =
    `Entre los suscritos, a saber ${cfg.empleadorNombre}, mayor de edad, identificado con ${cfg.empleadorIdentificacion}, ` +
    `por una parte, quien en adelante se llamará EL EMPLEADOR, y por la otra ${empleadoNombre}, identificado con la cédula ` +
    `de ciudadanía Nº ${s(o.cedula)}, quien en adelante se llamará EL TRABAJADOR, acuerdan celebrar el presente Contrato ` +
    `de Trabajo A TÉRMINO FIJO, el cual se regirá por las normas del Código Sustantivo del Trabajo conforme a las siguientes cláusulas:`;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  y = renderTextWithHeader(doc, cfg, s(o.codigoContratacion), intro, MARGIN_X, y, TABLE_W, LH);
  y += 3;

  // Cláusulas (interpolando la razón social en PRIMERA / numeral 2)
  for (const c of CLAUSULAS) {
    const texto = c.texto.replace('{{RAZON_SOCIAL}}', cfg.razonSocial);
    y = renderClausula(doc, cfg, s(o.codigoContratacion), c.titulo, texto, y);
  }

  // Firmas
  renderFirmas(doc, cfg, o, y + 4);

  // Re-pinta la cabecera en todas las páginas con el total correcto
  repaginate(doc, cfg, s(o.codigoContratacion));

  return doc;
}
