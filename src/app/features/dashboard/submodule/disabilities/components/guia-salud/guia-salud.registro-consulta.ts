import { GuiaPantalla } from './guia-salud.modelo';

/**
 * Guias de las dos pantallas del NIVEL 1 (las primeras de la capacitacion, reunion 2026-10-20).
 * Los pasos con `ancla` se recorren resaltando la parte real del formulario (`data-guia`); los que
 * ademas traen `acciones` se SIMULAN sobre la pantalla (2026-10-21): en "mira como se hace" la guia
 * escribe, abre las listas y elige; en "practica" le pide a la persona hacerlo y espera (`listo`).
 *
 * La simulacion del registro NO guarda: la pantalla se limpia al empezar, el boton Guardar queda
 * bloqueado mientras dura y al terminar se muestra la ventana del radicado de EJEMPLO.
 */

export const GUIA_REGISTRO: GuiaPantalla = {
  clave: 'registro',
  titulo: 'Registrar una incapacidad',
  icono: 'note_add',
  ruta: '/dashboard/disabilities/registro',
  resumen:
    'Recibe la incapacidad del trabajador, revisa sus datos, adjunta el documento y entrégale el número de radicado.',
  niveles: ['N1', 'N2', 'N3', 'TODOS'],
  pasos: [
    {
      icono: 'person_search',
      titulo: 'Busca al trabajador',
      texto:
        'Elige el tipo de documento (CC, CE, PPT…) y escribe el número de documento o el nombre. Toca la persona correcta en la lista: sus datos llegan solos desde contratación.\nOjo: hay cédulas muy parecidas. Antes de seguir, confirma el NOMBRE y la cédula con el trabajador.',
      ancla: 'busqueda',
      acciones: [
        { tipo: 'clic', selector: 'mat-select' },
        { tipo: 'opcion', contiene: ['CC ·', 'CC'], oPrimera: true },
        { tipo: 'escribir', selector: 'app-buscador-remoto input', valor: 'MAR' },
        { tipo: 'opcion', contiene: [], oPrimera: true },
        { tipo: 'esperar', selector: '[data-guia-persona]' },
      ],
      listo: { tipo: 'aparece', selector: '[data-guia-persona]' },
      practica: 'elige el tipo de documento, escribe el número o el nombre del trabajador y tócalo en la lista.',
    },
    {
      icono: 'store',
      titulo: 'Revisa la oficina',
      texto:
        'Se llena sola con tu sede. Si tienes varias sedes asignadas, elige la oficina donde recibiste la incapacidad.',
      ancla: 'oficina',
    },
    {
      icono: 'contact_phone',
      titulo: 'Confirma los datos de contacto',
      texto:
        'Verifica con el trabajador el celular, el WhatsApp y el correo. Si algo cambió, corrígelo: por ahí se le avisa.',
      ancla: 'personal',
      soloSimplificado: true,
    },
    {
      icono: 'account_circle',
      titulo: 'Revisa la información personal',
      texto:
        'Lo que llegó de contratación queda con candado. Lo que no llegó queda editable y marcado "Completar manualmente".',
      ancla: 'personal',
      soloCompleto: true,
    },
    {
      icono: 'event',
      titulo: 'Tipo de incapacidad y fechas',
      texto:
        'Elige el tipo (enfermedad general, accidente de trabajo, licencia…) y marca la fecha de inicio y la fecha final tal como aparecen en el documento. Los días se calculan solos.',
      ancla: 'tipo-fechas',
      acciones: [
        { tipo: 'clic', selector: 'mat-select[formcontrolname="tipoIncapacidad"]' },
        { tipo: 'opcion', contiene: ['accidente de trabajo', 'accidente'], oPrimera: true },
        { tipo: 'clic', selector: 'input[formcontrolname="fechaInicio"]' },
        { tipo: 'calendario', dia: 1 },
        { tipo: 'clic', selector: 'input[formcontrolname="fechaFin"]' },
        { tipo: 'calendario', dia: 3 },
      ],
      listo: { tipo: 'valor', selector: 'input[formcontrolname="fechaFin"]' },
      practica: 'elige el tipo de incapacidad y marca en el calendario la fecha de inicio y la final.',
    },
    {
      icono: 'troubleshoot',
      titulo: 'Código de diagnóstico',
      texto:
        'Escribe el código CIE-10 o parte de la descripción (mínimo 3 letras) y elígelo de la lista. La descripción se llena sola.',
      ancla: 'diagnostico',
      acciones: [
        { tipo: 'escribir', selector: 'app-buscador-remoto input', valor: 'J00' },
        { tipo: 'opcion', contiene: ['J00'], oPrimera: true },
      ],
      listo: { tipo: 'aparece', selector: '[data-guia-diagnostico]' },
      practica: 'escribe el código o parte del diagnóstico y elígelo de la lista.',
    },
    {
      icono: 'local_hospital',
      titulo: 'A quién se cobra: EPS o ARL',
      texto:
        'Se llena con la EPS del trabajador. Si es ACCIDENTE DE TRABAJO, la casilla cambia sola a ARL SURA: un accidente de trabajo se cobra siempre a la ARL, nunca a la EPS.\nSi el documento vino a nombre de la EPS, pídele al trabajador que lo haga corregir.',
      ancla: 'entidad',
    },
    {
      icono: 'domain',
      titulo: 'IPS y número de la incapacidad',
      texto:
        'Busca la IPS que la expidió por NIT o nombre, y copia el número de incapacidad impreso en el documento.',
      ancla: 'ips',
      acciones: [
        { tipo: 'escribir', selector: 'app-buscador-remoto input', valor: 'CLINICA' },
        { tipo: 'opcion', contiene: [], oPrimera: true },
        { tipo: 'escribir', selector: '@input[formcontrolname="numeroIncapacidad"]', valor: '123456' },
      ],
      listo: { tipo: 'valor', selector: '@input[formcontrolname="numeroIncapacidad"]' },
      practica: 'busca la IPS, elígela de la lista y escribe el número de la incapacidad.',
    },
    {
      icono: 'notes',
      titulo: 'Observaciones',
      texto: 'Anota lo que cartera deba saber (por ejemplo: "trae solo la primera hoja").',
      ancla: 'observaciones',
      acciones: [{ tipo: 'escribir', valor: 'Ejemplo de la simulación: trae solo la primera hoja.' }],
      listo: { tipo: 'valor' },
      practica: 'escribe una observación corta.',
    },
    {
      icono: 'upload_file',
      titulo: 'Adjunta los soportes',
      texto:
        'La INCAPACIDAD MÉDICA es obligatoria para recibirla. Los demás (historia clínica, FURAT…) se pueden completar después, editando el registro desde la consulta.\nEn la simulación no se adjunta nada.',
      ancla: 'soportes',
    },
    {
      icono: 'policy',
      titulo: 'Validación en vivo',
      texto:
        'El panel de la derecha calcula los días de la empresa y de la entidad, detecta prórrogas y traslapes, y avisa si algo impide pagarla.',
      ancla: 'validacion',
      soloCompleto: true,
    },
    {
      icono: 'save',
      titulo: 'Guarda y entrega el radicado',
      texto:
        'Toca "Guardar como Recibida". Aparece una ventana con el NÚMERO DE RADICADO (por ejemplo APFPR001): dáselo al trabajador; el botón "Copiar el número" lo copia.\nEn la simulación no se guarda nada: al pulsar Terminar verás la ventana de ejemplo y el formulario vuelve a quedar en blanco.',
      ancla: 'guardar',
    },
  ],
  consejos: [
    'Si el trabajador no aparece en la búsqueda, revisa el tipo de documento: la búsqueda solo trae ese tipo.',
    'Una incapacidad mal registrada se corrige desde Consulta (botón editar) sin volver a crearla.',
    'Si la pantalla dice "Faltan datos", la barra de abajo dice exactamente cuáles.',
  ],
};

export const GUIA_CONSULTA: GuiaPantalla = {
  clave: 'consulta',
  titulo: 'Consultar incapacidades',
  icono: 'fact_check',
  ruta: '/dashboard/disabilities/consulta',
  resumen: 'Busca cualquier incapacidad, revisa su estado y sus soportes, y descarga reportes.',
  niveles: ['N1', 'N2', 'N3', 'N4', 'TODOS'],
  pasos: [
    {
      icono: 'search',
      titulo: 'Busca',
      texto:
        'Escribe una cédula, un nombre, el número de radicado (APFPR001), el código único o el número de incapacidad. La búsqueda se hace en el servidor: no hace falta cargar nada antes.',
      ancla: 'buscador',
      acciones: [{ tipo: 'escribir', selector: 'input', valor: 'MAR' }],
      listo: { tipo: 'valor', selector: 'input' },
      practica: 'escribe una cédula, un nombre o un número de radicado.',
    },
    {
      icono: 'filter_alt',
      titulo: 'Filtra',
      texto: 'Acota por fechas, tipo, estado, EPS, empresa u oficina. Cada filtro activo aparece como una etiqueta que puedes quitar.',
      ancla: 'filtros',
      listo: { tipo: 'clic' },
      practica: 'abre los filtros con el botón «Filtros» y mira las opciones.',
    },
    {
      icono: 'insights',
      titulo: 'Indicadores',
      texto: 'Los totales de arriba se calculan con los filtros que tengas; tocar uno filtra la tabla.',
      ancla: 'kpis',
    },
    {
      icono: 'table_view',
      titulo: 'Revisa la tabla y abre el detalle',
      texto:
        'Cada fila es una incapacidad. La columna EPS dice a quién se cobra (en accidentes de trabajo, la ARL). Con el botón «Ver» (el ojo) o doble clic en la fila abres el detalle.',
      ancla: 'tabla',
      acciones: [
        { tipo: 'clic', selector: '.te-ver' },
        { tipo: 'esperar', selector: '[data-guia="detalle"]' },
      ],
      listo: { tipo: 'aparece', selector: '[data-guia="detalle"]' },
      practica: 'abre el detalle de una fila con el botón «Ver» (el ojo).',
    },
    {
      icono: 'description',
      titulo: 'El detalle',
      texto:
        'Aquí están los datos, el estado, los radicados y los soportes para descargar. Ciérralo con la X de arriba.',
      ancla: 'detalle',
      acciones: [
        { tipo: 'pausa', ms: 1500 },
        { tipo: 'clic', selector: '.det-cerrar' },
      ],
      listo: { tipo: 'clic', selector: '.det-cerrar' },
      practica: 'revísalo y ciérralo con la X.',
    },
    {
      icono: 'download',
      titulo: 'Descarga',
      texto:
        'Exporta lo filtrado a Excel o CSV, o usa la Exportación masiva para el Excel consolidado del servidor y el ZIP de soportes.',
      ancla: 'exportar',
    },
  ],
  consejos: [
    'Si no encuentras algo, quita los filtros: una fecha o un estado olvidados esconden registros.',
    'Los cambios de otra persona se ven al tocar "Actualizar".',
  ],
};
