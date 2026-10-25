import { GuiaPantalla } from './guia-salud.modelo';

/**
 * Guias de las pantallas de los niveles 2, 3 y "todos" (reunion 2026-10-20), escritas sobre las
 * etiquetas REALES de cada plantilla (inventario del 2026-10-20). Desde el 2026-10-21 llevan anclas
 * (`data-guia` en las plantillas) y, donde no toca datos, acciones de simulacion: abrir pestañas,
 * atajos de fecha, escribir en filtros. Nunca se simula guardar, aplicar, enviar ni descargar.
 */

const PESTANA = (n: number): string => `[role="tab"]:nth-of-type(${n})`;

export const GUIA_RADICACION: GuiaPantalla = {
  clave: 'radicacion',
  titulo: 'Radicar incapacidades',
  icono: 'send',
  ruta: '/dashboard/disabilities/radicacion',
  resumen: 'Registra el número de radicado que dio la EPS (o la ARL) para una o varias incapacidades a la vez.',
  niveles: ['N2', 'N3', 'TODOS'],
  pasos: [
    {
      icono: 'qr_code',
      titulo: 'Junta las incapacidades',
      texto: 'Escribe el código único y pulsa Enter o «Agregar»; con «Pegar varios» pegas muchos de una vez. También puedes marcar filas en «Pendientes por radicar» y pulsar «Agregar a radicar».',
      ancla: 'entrada',
      listo: { tipo: 'valor', selector: 'input' },
      practica: 'escribe un código único (cédula + fecha de inicio aaaammdd) y pulsa Enter.',
    },
    {
      icono: 'inbox',
      titulo: 'Pendientes por radicar',
      texto: 'Abajo están las incapacidades validadas o recibidas sin radicado. Márcalas y usa «Agregar a radicar» para subirlas a la lista sin escribir códigos. En la otra pestaña ves los «Radicados recientes».',
      ancla: 'pendientes',
      acciones: [{ tipo: 'clic', selector: PESTANA(2) }, { tipo: 'pausa', ms: 900 }, { tipo: 'clic', selector: PESTANA(1) }],
    },
    {
      icono: 'fact_check',
      titulo: 'Revisa la lista',
      texto: 'Mira el aviso de cada fila y deja marcadas solo las correctas («Marcar las listas» / «Desmarcar»).',
      ancla: 'lista',
    },
    {
      icono: 'edit_note',
      titulo: 'Datos del radicado',
      texto: 'Llena «Número de radicado», «Fecha de radicado» y «¿Dónde se radicó?» (Página web, Correo o Presencial). Las observaciones son opcionales.',
      ancla: 'datos',
      listo: { tipo: 'valor', selector: 'input[formcontrolname="numeroRadicado"]' },
      practica: 'escribe el número de radicado, la fecha y dónde se radicó.',
    },
    {
      icono: 'save',
      titulo: 'Guarda',
      texto: 'Pulsa «Guardar radicado (N)» y confirma con «Sí, guardar». Lee el resumen (guardadas / con error) y compruébalo en «Radicados recientes».\nLa simulación no guarda: eso lo haces tú con un radicado real.',
      ancla: 'guardar',
    },
  ],
  consejos: [
    'El código general es la cédula seguida de la fecha de inicio aaaammdd, sin espacios.',
    'Máximo 500 códigos por búsqueda o guardado; la fecha no puede ser posterior a hoy.',
    'Si ya tenía radicado, guardar lo reemplaza (corrección) y el anterior queda en el historial.',
  ],
};

export const GUIA_RECOBRO: GuiaPantalla = {
  clave: 'recobro',
  titulo: 'Registrar un recobro',
  icono: 'replay',
  ruta: '/dashboard/disabilities/radicacion/recobro',
  resumen: 'Registra el radicado de recobro de las incapacidades que la EPS no pagó o negó.',
  niveles: ['N2', 'N3', 'TODOS'],
  pasos: [
    {
      icono: 'inbox',
      titulo: 'Abre la bandeja',
      texto: 'En «Bandeja de recobro» filtra por situación, cédula, código, nombre o EPS. La otra pestaña, «Recobro por código», sirve para escribir o pegar códigos.',
      ancla: 'bandeja',
      acciones: [{ tipo: 'clic', selector: PESTANA(2) }, { tipo: 'pausa', ms: 900 }, { tipo: 'clic', selector: PESTANA(1) }],
    },
    { icono: 'checklist', titulo: 'Marca las filas', texto: 'Marca las incapacidades a recobrar y pulsa «Registrar radicado de recobro (N)».', ancla: 'bandeja' },
    {
      icono: 'edit_note',
      titulo: 'Datos del recobro',
      texto: 'Llena el número, la fecha y el canal; pulsa «Registrar recobro» y confirma con «Sí, registrar».\nLa simulación no registra nada.',
      ancla: 'datos',
    },
    { icono: 'history', titulo: 'Historial', texto: 'Con «Ver radicados» consultas todo lo radicado de una incapacidad; un recobro se puede «Anular» con un motivo.', ancla: 'bandeja' },
  ],
  consejos: [
    'El recobro queda como un radicado más: no cambia el radicado inicial ni su estado.',
    'La incapacidad solo se finaliza con una respuesta de pago.',
  ],
};

export const GUIA_SEVENET: GuiaPantalla = {
  clave: 'sevenet',
  titulo: 'Descargar para SEVENET',
  icono: 'folder_zip',
  ruta: '/dashboard/disabilities/sevenet',
  resumen: 'Descarga la primera hoja de cada incapacidad de la semana, renombrada, para cargarla al archivo digital SEVENET.',
  niveles: ['N2', 'N3', 'TODOS'],
  pasos: [
    {
      icono: 'date_range',
      titulo: 'Elige la semana',
      texto: 'Pulsa «Esta semana» o «Semana anterior» (de lunes a domingo), o elige las fechas. En «Buscar por» escoge fecha de registro o de inicio y mira el conteo.',
      ancla: 'rango',
      acciones: [{ tipo: 'clic', selector: 'button' }],
      listo: { tipo: 'clic' },
      practica: 'pulsa «Esta semana» o «Semana anterior».',
    },
    {
      icono: 'tag',
      titulo: 'Datos del cargue',
      texto: 'Escribe la «Semana SEVENET» y revisa la «Carpeta base en el computador».',
      ancla: 'cargue',
      listo: { tipo: 'valor', selector: 'input[formcontrolname="semana"]' },
      practica: 'escribe el número de la semana SEVENET.',
    },
    {
      icono: 'merge_type',
      titulo: 'Apoyo y Alianza juntas',
      texto: 'Con el interruptor «Unir Apoyo y Alianza en una sola carpeta» todo queda en SEMANA N; apágalo si las necesitas separadas.',
      ancla: 'unir',
    },
    {
      icono: 'download',
      titulo: 'Genera y descarga',
      texto: 'Pulsa «Generar carpeta y archivo plano (ZIP)» (o «Solo archivo plano»). La descarga arranca sola al terminar; descomprime el ZIP dentro de la carpeta base.\nLa simulación no genera nada.',
      ancla: 'descargar',
    },
  ],
  consejos: [
    'La semana es obligatoria (número entre 1 y 9999) y se exige fecha inicial y final.',
    '_PENDIENTES.txt lista lo que no tenía soporte, no se pudo leer o no tiene centro de costo.',
    'Puedes salir de la pantalla: el servidor termina igual, pero la descarga solo arranca aquí.',
  ],
};

export const GUIA_LIQUIDACION: GuiaPantalla = {
  clave: 'liquidacion',
  titulo: 'Cargar la liquidación',
  icono: 'request_quote',
  ruta: '/dashboard/disabilities/liquidacion',
  resumen: 'Sube la plantilla de pagos y negaciones de las EPS, revisa el cruce y aplícala.',
  niveles: ['N3', 'TODOS'],
  pasos: [
    { icono: 'download', titulo: 'Prepara la plantilla', texto: 'Pulsa «Descargar plantilla» y llena las hojas Pagos y Negaciones.', ancla: 'plantilla' },
    { icono: 'upload_file', titulo: 'Cárgala', texto: 'Arrástrala o haz clic para buscarla (.xlsx, máximo 10 MB). Lee la alerta «Subiste N pagos y M negaciones…».', ancla: 'cargar' },
    { icono: 'rule', titulo: 'Corrige el cruce', texto: 'Usa «Asignar» en las sugerencias, «Homologar» en las causales, o «Exportar filas sin cruce» para revisarlas aparte.', ancla: 'revision' },
    { icono: 'done_all', titulo: 'Aplica', texto: 'Pulsa «Aplicar N filas» y confirma (o «Descartar»). Nada se registra hasta que apliques la carga.', ancla: 'aplicar' },
    { icono: 'history', titulo: 'Historial de cargas', texto: 'Cada carga queda abajo con su estado; una carga simulada se puede retomar y una aplicada, anular (escribiendo ANULAR).', ancla: 'historial' },
  ],
  consejos: [
    'Las filas que no cruzan, ya registradas o con error no se aplican.',
    'Una negación sin homologar pasa a recobro.',
    'Anular una carga pide escribir ANULAR y no se puede deshacer.',
  ],
};

export const GUIA_PAGOS: GuiaPantalla = {
  clave: 'pagos',
  titulo: 'Pagos de incapacidades',
  icono: 'payments',
  ruta: '/dashboard/disabilities/liquidacion/pagos',
  resumen: 'Consulta, totaliza y exporta los pagos registrados al aplicar la liquidación.',
  niveles: ['N3', 'TODOS'],
  pasos: [
    {
      icono: 'filter_alt',
      titulo: 'Filtra',
      texto: 'Escribe cédula, código o nombre, la EPS y el rango de «Fecha de pago»; pulsa «Filtrar».',
      ancla: 'filtros',
      listo: { tipo: 'valor', selector: 'input' },
      practica: 'escribe una cédula o un nombre y pulsa «Filtrar».',
    },
    { icono: 'functions', titulo: 'Revisa', texto: 'Mira la tabla y los totales «Pagos con este filtro» y «Valor total pagado».', ancla: 'tabla' },
    { icono: 'table_view', titulo: 'Exporta', texto: 'Pulsa «Exportar a Excel» si lo necesitas.', ancla: 'exportar' },
    { icono: 'block', titulo: 'Anula si hace falta', texto: 'Con «Anular pago» (motivo opcional) el pago queda anulado —no se borra— y se recalcula el estado de la incapacidad.', ancla: 'tabla' },
  ],
  consejos: ['Los pagos se registran al aplicar la plantilla en Liquidación, no en esta pantalla.'],
};

export const GUIA_NEGACIONES: GuiaPantalla = {
  clave: 'negaciones',
  titulo: 'Negaciones y causales',
  icono: 'gpp_bad',
  ruta: '/dashboard/disabilities/liquidacion/negaciones',
  resumen: 'Homologa las causales de negación de las EPS para saber si la incapacidad finaliza o pasa a recobro.',
  niveles: ['N3', 'TODOS'],
  pasos: [
    {
      icono: 'help_center',
      titulo: 'Abre «Sin homologar»',
      texto: 'Ahí están los textos de negación que aún no tienen causal interna.',
      ancla: 'pestanas',
      acciones: [{ tipo: 'clic', selector: PESTANA(4) }],
      listo: { tipo: 'clic', selector: PESTANA(4) },
      practica: 'abre la pestaña «Sin homologar».',
    },
    { icono: 'link', titulo: 'Homologa', texto: 'Pulsa «Homologar», elige la «Causal interna» y confirma.', ancla: 'pestanas' },
    {
      icono: 'search',
      titulo: 'Comprueba',
      texto: 'En «Negaciones», activa «Solo sin homologar» para ver lo que falta.',
      ancla: 'pestanas',
      acciones: [{ tipo: 'clic', selector: PESTANA(1) }],
    },
    {
      icono: 'tune',
      titulo: 'Causales y equivalencias',
      texto: 'En «Causales internas» y «Equivalencias por EPS» mantienes el catálogo («Nueva causal», «Nueva equivalencia»).',
      ancla: 'pestanas',
      acciones: [{ tipo: 'clic', selector: PESTANA(2) }, { tipo: 'pausa', ms: 900 }, { tipo: 'clic', selector: PESTANA(3) }],
    },
  ],
  consejos: [
    'Solo «1 y 2 días no reconocidos» y «sin aportes en las 4 semanas anteriores» deberían finalizar la incapacidad; las demás causales pasan a recobro.',
    'Mientras no se homologuen, esas incapacidades quedan en recobro.',
  ],
};

export const GUIA_INFORMES: GuiaPantalla = {
  clave: 'informes',
  titulo: 'Informes de incapacidades',
  icono: 'insights',
  ruta: '/dashboard/disabilities/informes',
  resumen: 'Estadísticas globales, personas en 180/540 días, recurrencia de incapacidades cortas y top de personas.',
  niveles: ['N2', 'N3', 'TODOS'],
  pasos: [
    { icono: 'date_range', titulo: 'Filtra', texto: 'Elige «Desde», «Hasta» (fecha de inicio) y el empleador: la página recarga sola.', ancla: 'filtros' },
    {
      icono: 'bar_chart',
      titulo: 'Global',
      texto: 'Lee las tarjetas y las gráficas por tipo, mes, oficina, finca y EPS.',
      ancla: 'pestanas',
      acciones: [{ tipo: 'clic', selector: PESTANA(1) }],
    },
    {
      icono: 'hourglass_bottom',
      titulo: '180 / 540 días',
      texto: 'Quién pasa al fondo de pensiones (día 181) y quién vuelve a la EPS (día 541).',
      ancla: 'pestanas',
      acciones: [{ tipo: 'clic', selector: PESTANA(2) }],
      listo: { tipo: 'clic', selector: PESTANA(2) },
      practica: 'abre la pestaña «180 / 540 dias».',
    },
    {
      icono: 'repeat',
      titulo: 'Recurrencia y top',
      texto: 'Ajusta «Días máximos por incapacidad» y «Mínimo de eventos en el mes»; exporta con «Exportar».',
      ancla: 'pestanas',
      acciones: [{ tipo: 'clic', selector: PESTANA(3) }, { tipo: 'pausa', ms: 900 }, { tipo: 'clic', selector: PESTANA(4) }],
    },
    { icono: 'download', titulo: 'Exporta', texto: '«Exportar a Excel» descarga el informe global con los filtros que tengas.', ancla: 'exportar' },
  ],
  consejos: ['Los totales incluyen el histórico importado.', 'Un solo día sin incapacidad reinicia la cuenta de 180/540.'],
};

export const GUIA_ALERTAS: GuiaPantalla = {
  clave: 'alertas',
  titulo: 'Alertas de incapacidades',
  icono: 'notification_important',
  ruta: '/dashboard/disabilities/alertas',
  resumen: 'Bandeja de avisos del sistema: falsedad, 180/540 días, traslapes y prescritas.',
  niveles: ['N2', 'N3', 'TODOS'],
  pasos: [
    { icono: 'filter_alt', titulo: 'Filtra', texto: 'Toca una tarjeta (Pendientes, Falsedad, 180/540, Traslapes, Prescritas) o usa Estado, Tipo, Dirigida a y Cédula.', ancla: 'kpis', listo: { tipo: 'clic' }, practica: 'toca una de las tarjetas.' },
    { icono: 'mark_email_read', titulo: 'Atiende', texto: 'Lee el mensaje y pulsa «Marcar atendida» o «Descartar», con una nota opcional.', ancla: 'bandeja' },
    { icono: 'undo', titulo: 'Corrige', texto: 'Si te equivocaste, «Reabrir» la deja pendiente otra vez.', ancla: 'bandeja' },
    {
      icono: 'hourglass_bottom',
      titulo: 'Umbrales 180 / 540',
      texto: 'La segunda pestaña muestra las personas que se acercan o pasan los 180 y 540 días.',
      ancla: 'bandeja',
      acciones: [{ tipo: 'clic', selector: PESTANA(2) }, { tipo: 'pausa', ms: 900 }, { tipo: 'clic', selector: PESTANA(1) }],
    },
  ],
  consejos: ['El bloqueo en contratación por incapacidad falsa aún está por coordinar: por ahora solo se muestra aquí.'],
};

export const GUIA_SST: GuiaPantalla = {
  clave: 'sst',
  titulo: 'Seguridad y salud en el trabajo',
  icono: 'health_and_safety',
  ruta: '/dashboard/disabilities/sst',
  resumen: 'Seguimiento de la investigación de cada accidente de trabajo o enfermedad laboral.',
  niveles: ['N2', 'N3', 'TODOS'],
  pasos: [
    { icono: 'report', titulo: 'Busca las pendientes', texto: 'Toca «Sin investigación» y revisa la columna Plazo («Quedan N d» / «Vencido hace N d»).', ancla: 'kpis', listo: { tipo: 'clic' }, practica: 'toca la tarjeta «Sin investigación».' },
    { icono: 'filter_alt', titulo: 'Acota por fechas', texto: 'Con «Desde», «Hasta» y el estado reduces la lista.', ancla: 'filtros' },
    { icono: 'upload_file', titulo: 'Sube la investigación', texto: 'En la fila, pulsa «Subir investigación» (PDF, JPG o PNG).', ancla: 'tabla' },
    { icono: 'edit', titulo: 'Seguimiento', texto: 'En «Editar seguimiento» registra estado, fecha, responsable SST y observaciones; pulsa «Guardar».', ancla: 'tabla' },
  ],
  consejos: ['El plazo es de 15 días desde el inicio de la incapacidad.'],
};

export const GUIA_CORREOS: GuiaPantalla = {
  clave: 'correos',
  titulo: 'Correos a empresas usuarias',
  icono: 'forward_to_inbox',
  ruta: '/dashboard/disabilities/correos',
  resumen: 'El aviso de incapacidades a cada finca: directorio de correos, envío del día y enviados.',
  // Todos los niveles, desde el 1 (pedido del 2026-10-21).
  niveles: ['N1', 'N2', 'N3', 'N4', 'TODOS'],
  pasos: [
    {
      icono: 'contacts',
      titulo: 'Directorio al día',
      texto: 'En «Directorio de correos» agrega, edita, haz principal o retira correos de cada finca.',
      ancla: 'pestanas',
      acciones: [{ tipo: 'clic', selector: PESTANA(3) }],
      listo: { tipo: 'clic', selector: PESTANA(3) },
      practica: 'abre la pestaña «Directorio de correos».',
    },
    {
      icono: 'preview',
      titulo: 'Revisa el envío',
      texto: 'En la primera pestaña usa «Ver correo tal como saldrá» y corrige las fincas «Sin destinatario».',
      ancla: 'pestanas',
      acciones: [{ tipo: 'clic', selector: PESTANA(1) }],
    },
    { icono: 'send', titulo: 'Envía si hace falta', texto: 'El envío es automático; a mano usa el botón de enviar del día y confirma.\nLa simulación no envía nada.', ancla: 'pestanas' },
    {
      icono: 'outbox',
      titulo: 'Enviados',
      texto: 'Revisa «Enviados» y reenvía los fallidos.',
      ancla: 'pestanas',
      acciones: [{ tipo: 'clic', selector: PESTANA(4) }, { tipo: 'pausa', ms: 900 }, { tipo: 'clic', selector: PESTANA(1) }],
    },
  ],
  consejos: [
    'El contacto principal recibe el correo y los demás van en copia.',
    'El nombre del trabajador no viaja en el correo.',
  ],
};
