import { SeccionBorrador } from './form-drafts';

/**
 * PLANTILLAS de formularios de la plataforma.
 *
 * Punto de partida para quien no quiere empezar en blanco NI gastar una llamada a la
 * IA: son borradores fijos, revisados, de los formularios que más se repiten en RRHH,
 * tesorería y operaciones. Se cargan en el constructor como cualquier otro borrador y
 * desde ahí se editan; la plantilla no queda "vinculada" a nada.
 *
 * Viven en el front a propósito: son contenido de producto, no datos del cliente, y
 * agregar una no debe implicar migración ni despliegue de backend.
 */
export interface PlantillaFormulario {
  id: string;
  nombre: string;
  /** Para qué sirve — se ofrece también como descripción del formulario. */
  descripcion: string;
  categoria: string;
  /** Material Symbol de la tarjeta y del tema. */
  icono: string;
  /** Preset de PRESETS_TEMA con el que se ve bien. */
  preset: string;
  /** Etiquetas cortas para el buscador de la galería. */
  etiquetas: string[];
  secciones: SeccionBorrador[];
}

export const PLANTILLAS_FORMULARIO: PlantillaFormulario[] = [
  {
    id: 'permiso-laboral',
    nombre: 'Solicitud de permiso laboral',
    descripcion: 'Permisos, calamidades y ausencias con soporte y visto bueno del jefe.',
    categoria: 'Gestión humana',
    icono: 'event_busy',
    preset: 'institucional',
    etiquetas: ['rrhh', 'ausencias', 'permisos'],
    secciones: [
      {
        titulo: 'Quién solicita',
        campos: [
          { label: 'Nombre completo', type: 'TEXT_SHORT', required: true },
          { label: 'Documento de identidad', type: 'TEXT_SHORT', required: true },
          { label: 'Cargo', type: 'TEXT_SHORT' },
          { label: 'Área o sede', type: 'TEXT_SHORT' },
        ],
      },
      {
        titulo: 'Permiso solicitado',
        campos: [
          {
            label: 'Tipo de permiso', type: 'SINGLE_CHOICE', required: true,
            options: ['Cita médica', 'Calamidad doméstica', 'Licencia no remunerada', 'Estudio', 'Otro'],
          },
          { label: 'Desde', type: 'DATE', required: true },
          { label: 'Hasta', type: 'DATE', required: true },
          { label: 'Hora de salida', type: 'TIME' },
          { label: 'Motivo', type: 'TEXT_LONG', required: true, placeholder: 'Explica brevemente el motivo' },
          { label: 'Soporte', type: 'FILE', description: 'Incapacidad, citación o cualquier documento que respalde el permiso' },
        ],
      },
      {
        titulo: 'Aprobación',
        campos: [
          { label: 'Jefe inmediato', type: 'TEXT_SHORT' },
          { label: 'Firma del solicitante', type: 'SIGNATURE', required: true },
        ],
      },
    ],
  },
  {
    id: 'clima-laboral',
    nombre: 'Encuesta de clima laboral',
    descripcion: 'Percepción del equipo sobre ambiente, liderazgo y carga de trabajo.',
    categoria: 'Gestión humana',
    icono: 'sentiment_satisfied',
    preset: 'violeta',
    etiquetas: ['encuesta', 'clima', 'satisfacción'],
    secciones: [
      {
        titulo: 'Antes de empezar',
        campos: [
          {
            label: 'Nota de confidencialidad', type: 'COMMENT',
            text: 'Tus respuestas se analizan de forma agregada. Responde con la mayor sinceridad posible.',
          },
          { label: 'Área a la que perteneces', type: 'DROPDOWN', options: ['Administrativa', 'Operativa', 'Comercial', 'Gestión humana', 'Otra'] },
          { label: 'Tiempo en la empresa', type: 'SINGLE_CHOICE', options: ['Menos de 6 meses', 'De 6 meses a 2 años', 'De 2 a 5 años', 'Más de 5 años'] },
        ],
      },
      {
        titulo: 'Tu experiencia',
        campos: [
          { label: 'Ambiente de trabajo en tu equipo', type: 'RATING', required: true, rating: { scale_max: 5, mode: 'STARS' } },
          { label: 'Acompañamiento de tu jefe inmediato', type: 'RATING', required: true, rating: { scale_max: 5, mode: 'STARS' } },
          { label: 'Carga de trabajo', type: 'SINGLE_CHOICE', required: true, options: ['Muy baja', 'Adecuada', 'Alta', 'Insostenible'] },
          { label: 'Herramientas para hacer bien tu trabajo', type: 'RATING', rating: { scale_max: 5, mode: 'STARS' } },
          { label: '¿Recomendarías la empresa como lugar para trabajar?', type: 'SINGLE_CHOICE', required: true, options: ['Sí, sin dudarlo', 'Sí, con reservas', 'No'] },
        ],
      },
      {
        titulo: 'Cierre',
        campos: [
          { label: '¿Qué cambiarías primero?', type: 'TEXT_LONG', placeholder: 'Una sola cosa, la que más te pesa' },
          { label: 'Algo que quieras destacar', type: 'TEXT_LONG' },
        ],
      },
    ],
  },
  {
    id: 'incidente-sst',
    nombre: 'Reporte de incidente (SST)',
    descripcion: 'Accidentes e incidentes de seguridad y salud en el trabajo, con evidencia.',
    categoria: 'SST',
    icono: 'report',
    preset: 'atardecer',
    etiquetas: ['seguridad', 'sst', 'incidente'],
    secciones: [
      {
        titulo: 'Qué pasó',
        campos: [
          { label: 'Fecha del incidente', type: 'DATE', required: true },
          { label: 'Hora aproximada', type: 'TIME', required: true },
          { label: 'Lugar', type: 'TEXT_SHORT', required: true, placeholder: 'Sede, área o punto exacto' },
          { label: 'Ubicación GPS', type: 'LOCATION' },
          {
            label: 'Tipo de evento', type: 'SINGLE_CHOICE', required: true,
            options: ['Accidente con lesión', 'Incidente sin lesión', 'Condición insegura', 'Acto inseguro'],
          },
          { label: 'Descripción de lo ocurrido', type: 'TEXT_LONG', required: true },
        ],
      },
      {
        titulo: 'Personas involucradas',
        campos: [
          { label: 'Nombre de la persona afectada', type: 'TEXT_SHORT' },
          { label: 'Documento', type: 'TEXT_SHORT' },
          { label: '¿Requirió atención médica?', type: 'SINGLE_CHOICE', required: true, options: ['No', 'Primeros auxilios', 'Traslado a urgencias'] },
          { label: 'Testigos', type: 'TEXT_LONG', description: 'Nombres y forma de contacto' },
        ],
      },
      {
        titulo: 'Evidencia y cierre',
        campos: [
          { label: 'Fotos del lugar', type: 'PHOTO', description: 'Hasta donde sea seguro tomarlas' },
          { label: 'Acciones inmediatas tomadas', type: 'TEXT_LONG', required: true },
          { label: 'Firma de quien reporta', type: 'SIGNATURE', required: true },
        ],
      },
    ],
  },
  {
    id: 'inspeccion-campo',
    nombre: 'Inspección en campo',
    descripcion: 'Visitas y verificaciones en sitio con lista de chequeo y evidencia fotográfica.',
    categoria: 'Operaciones',
    icono: 'checklist',
    preset: 'bosque',
    etiquetas: ['operaciones', 'visita', 'checklist'],
    secciones: [
      {
        titulo: 'Datos de la visita',
        campos: [
          { label: 'Fecha de la visita', type: 'DATE', required: true },
          { label: 'Responsable de la inspección', type: 'TEXT_SHORT', required: true },
          { label: 'Sitio inspeccionado', type: 'TEXT_SHORT', required: true },
          { label: 'Ubicación GPS', type: 'LOCATION', required: true },
        ],
      },
      {
        titulo: 'Verificación',
        campos: [
          { label: 'Orden y aseo', type: 'SINGLE_CHOICE', required: true, options: ['Cumple', 'Cumple parcialmente', 'No cumple', 'No aplica'] },
          { label: 'Señalización', type: 'SINGLE_CHOICE', required: true, options: ['Cumple', 'Cumple parcialmente', 'No cumple', 'No aplica'] },
          { label: 'Elementos de protección personal', type: 'SINGLE_CHOICE', required: true, options: ['Cumple', 'Cumple parcialmente', 'No cumple', 'No aplica'] },
          { label: 'Hallazgos', type: 'TEXT_LONG', placeholder: 'Qué se encontró fuera de lo esperado' },
          { label: 'Evidencia fotográfica', type: 'PHOTO', required: true },
        ],
      },
      {
        titulo: 'Cierre',
        campos: [
          { label: 'Compromisos acordados', type: 'TEXT_LONG' },
          { label: 'Fecha de seguimiento', type: 'DATE' },
          { label: 'Firma del responsable del sitio', type: 'SIGNATURE' },
        ],
      },
    ],
  },
  {
    id: 'reembolso-gastos',
    nombre: 'Solicitud de reembolso',
    descripcion: 'Gastos por legalizar con valor, categoría y soporte de la factura.',
    categoria: 'Tesorería',
    icono: 'receipt_long',
    preset: 'oceano',
    etiquetas: ['tesorería', 'gastos', 'reembolso'],
    secciones: [
      {
        titulo: 'Quién solicita',
        campos: [
          { label: 'Nombre completo', type: 'TEXT_SHORT', required: true },
          { label: 'Documento de identidad', type: 'TEXT_SHORT', required: true },
          { label: 'Área o centro de costo', type: 'TEXT_SHORT' },
        ],
      },
      {
        titulo: 'Gasto',
        campos: [
          { label: 'Fecha del gasto', type: 'DATE', required: true },
          {
            label: 'Concepto', type: 'DROPDOWN', required: true,
            options: ['Transporte', 'Alimentación', 'Hospedaje', 'Papelería', 'Herramientas', 'Otro'],
          },
          { label: 'Valor', type: 'CURRENCY', required: true },
          { label: 'Descripción del gasto', type: 'TEXT_LONG', required: true },
          { label: 'Factura o recibo', type: 'PHOTO', required: true, description: 'Debe verse legible el valor y la fecha' },
        ],
      },
      {
        titulo: 'Pago',
        campos: [
          { label: 'Banco', type: 'TEXT_SHORT' },
          { label: 'Tipo de cuenta', type: 'SINGLE_CHOICE', options: ['Ahorros', 'Corriente'] },
          { label: 'Número de cuenta', type: 'TEXT_SHORT' },
          { label: 'Firma del solicitante', type: 'SIGNATURE', required: true },
        ],
      },
    ],
  },
  {
    id: 'requisicion-personal',
    nombre: 'Requisición de personal',
    descripcion: 'Solicitud de una vacante nueva con perfil, justificación y condiciones.',
    categoria: 'Gestión humana',
    icono: 'group_add',
    preset: 'institucional',
    etiquetas: ['contratación', 'vacante', 'rrhh'],
    secciones: [
      {
        titulo: 'La vacante',
        campos: [
          { label: 'Cargo solicitado', type: 'TEXT_SHORT', required: true },
          { label: 'Área', type: 'TEXT_SHORT', required: true },
          { label: 'Número de vacantes', type: 'NUMBER', required: true },
          { label: 'Tipo de vacante', type: 'SINGLE_CHOICE', required: true, options: ['Cargo nuevo', 'Reemplazo', 'Temporal'] },
          { label: 'Fecha en que se necesita', type: 'DATE', required: true },
        ],
      },
      {
        titulo: 'Perfil',
        campos: [
          { label: 'Formación requerida', type: 'TEXT_SHORT' },
          { label: 'Experiencia mínima', type: 'TEXT_SHORT', placeholder: 'Ej. 2 años en cargos similares' },
          { label: 'Funciones principales', type: 'TEXT_LONG', required: true },
          { label: 'Competencias clave', type: 'MULTIPLE_CHOICE', options: ['Trabajo en equipo', 'Servicio al cliente', 'Liderazgo', 'Manejo de Excel', 'Conducción', 'Bilingüe'] },
        ],
      },
      {
        titulo: 'Condiciones',
        campos: [
          { label: 'Tipo de contrato', type: 'SINGLE_CHOICE', required: true, options: ['Término fijo', 'Término indefinido', 'Obra o labor', 'Aprendizaje'] },
          { label: 'Salario propuesto', type: 'CURRENCY', required: true },
          { label: 'Jornada', type: 'SINGLE_CHOICE', options: ['Diurna', 'Nocturna', 'Turnos rotativos'] },
          { label: 'Justificación de la solicitud', type: 'TEXT_LONG', required: true },
        ],
      },
    ],
  },
  {
    id: 'entrega-dotacion',
    nombre: 'Entrega de dotación',
    descripcion: 'Acta de entrega de uniformes, EPP o equipos, firmada por quien recibe.',
    categoria: 'Operaciones',
    icono: 'inventory_2',
    preset: 'grafito',
    etiquetas: ['dotación', 'epp', 'acta'],
    secciones: [
      {
        titulo: 'Quién recibe',
        campos: [
          { label: 'Nombre completo', type: 'TEXT_SHORT', required: true },
          { label: 'Documento de identidad', type: 'TEXT_SHORT', required: true },
          { label: 'Cargo', type: 'TEXT_SHORT' },
          { label: 'Fecha de entrega', type: 'DATE', required: true },
        ],
      },
      {
        titulo: 'Elementos entregados',
        campos: [
          {
            label: 'Elementos', type: 'MULTIPLE_CHOICE', required: true,
            options: ['Camisa', 'Pantalón', 'Botas', 'Casco', 'Guantes', 'Gafas de seguridad', 'Chaleco', 'Equipo de cómputo'],
          },
          { label: 'Cantidad total de elementos', type: 'NUMBER', required: true },
          { label: 'Observaciones', type: 'TEXT_LONG' },
          { label: 'Foto de la entrega', type: 'PHOTO' },
        ],
      },
      {
        titulo: 'Compromiso',
        campos: [
          {
            label: 'Declaración', type: 'COMMENT',
            text: 'Declaro que recibí los elementos relacionados en buen estado y me comprometo a usarlos y conservarlos según las normas de la empresa.',
          },
          { label: 'Firma de quien recibe', type: 'SIGNATURE', required: true },
        ],
      },
    ],
  },
  {
    id: 'pqrs',
    nombre: 'PQRS',
    descripcion: 'Peticiones, quejas, reclamos y sugerencias con datos de contacto y soporte.',
    categoria: 'Servicio',
    icono: 'support_agent',
    preset: 'oceano',
    etiquetas: ['pqrs', 'servicio', 'atención'],
    secciones: [
      {
        titulo: 'Datos de contacto',
        campos: [
          { label: 'Nombre completo', type: 'TEXT_SHORT', required: true },
          { label: 'Documento de identidad', type: 'TEXT_SHORT' },
          { label: 'Correo electrónico', type: 'TEXT_SHORT', required: true, placeholder: 'nombre@correo.com' },
          { label: 'Teléfono', type: 'TEXT_SHORT', required: true },
        ],
      },
      {
        titulo: 'Tu solicitud',
        campos: [
          { label: 'Tipo de solicitud', type: 'SINGLE_CHOICE', required: true, options: ['Petición', 'Queja', 'Reclamo', 'Sugerencia', 'Felicitación'] },
          { label: 'Asunto', type: 'TEXT_SHORT', required: true },
          { label: 'Descripción', type: 'TEXT_LONG', required: true, placeholder: 'Cuéntanos qué pasó, con fechas y nombres si los tienes' },
          { label: 'Soportes', type: 'FILE', description: 'Documentos o imágenes que respalden tu solicitud' },
          { label: '¿Cómo prefieres que te respondamos?', type: 'SINGLE_CHOICE', options: ['Correo electrónico', 'Llamada telefónica', 'WhatsApp'] },
        ],
      },
    ],
  },
];

/**
 * Ideas listas para el asistente de IA cuando se arranca un formulario. No son
 * plantillas: son PROMPTS de ejemplo que se cargan en el cuadro de texto y se editan.
 * Están para resolver el "no sé ni cómo pedirlo", que es donde se abandona la pantalla.
 */
export const PROMPTS_BORRADOR: ReadonlyArray<{ titulo: string; prompt: string }> = [
  {
    titulo: 'Encuesta de satisfacción',
    prompt: 'Encuesta de satisfacción para los empleados sobre el servicio de la oficina de gestión humana, '
      + 'con escalas de 1 a 5, una pregunta de recomendación y un comentario abierto al final.',
  },
  {
    titulo: 'Inspección con evidencia',
    prompt: 'Inspección de vehículo antes de salir a ruta: estado de llantas, luces, frenos y documentos, '
      + 'con fotos del estado, ubicación GPS y firma del conductor.',
  },
  {
    titulo: 'Solicitud interna',
    prompt: 'Solicitud de dotación para un empleado: datos de quien solicita, elementos y tallas requeridas, '
      + 'justificación, fecha en que se necesita y visto bueno del jefe.',
  },
  {
    titulo: 'Registro de visita',
    prompt: 'Registro de visita a cliente: datos del cliente, motivo de la visita, temas tratados, '
      + 'compromisos con fecha, evidencia fotográfica y ubicación.',
  },
  {
    titulo: 'Novedades de nómina',
    prompt: 'Reporte de novedades de nómina del mes: tipo de novedad (horas extra, incapacidad, licencia, '
      + 'descuento), fechas, cantidad de horas o días, valor y soporte adjunto.',
  },
  {
    titulo: 'Evaluación de desempeño',
    prompt: 'Evaluación de desempeño de un colaborador por parte de su jefe: cumplimiento de metas, '
      + 'competencias con escala de 1 a 5, fortalezas, oportunidades de mejora y plan de acción.',
  },
];

/**
 * Peticiones frecuentes para el asistente de preguntas (formulario ya empezado). El
 * asistente PROPONE y el usuario elige: por eso las ideas son de "qué me falta", no
 * de "reescribe lo que tengo".
 */
export const PROMPTS_PREGUNTAS: ReadonlyArray<{ titulo: string; prompt: string }> = [
  { titulo: 'Qué me falta', prompt: 'Revisa el formulario y propón las preguntas que faltan para que quede completo.' },
  { titulo: 'Identificar a quien responde', prompt: 'Agrega las preguntas necesarias para identificar a quien responde y su área.' },
  { titulo: 'Evidencia y cierre', prompt: 'Agrega evidencia fotográfica, soportes y una firma de cierre.' },
  { titulo: 'Fechas y trazabilidad', prompt: 'Agrega fechas, responsables y datos que permitan hacerle seguimiento después.' },
  { titulo: 'Medir satisfacción', prompt: 'Agrega preguntas para medir satisfacción con escalas y un comentario abierto.' },
  { titulo: 'Detalle de costos', prompt: 'Desglosa los costos: valores, conceptos y el soporte de cada uno.' },
];
