import { AnalisisCandidato, PuntoAnalisis } from './analisis-ia.service';

/**
 * La lectura del expediente escrita como informe en Markdown.
 *
 * El modelo devuelve una estructura fija (resumen, indicadores, puntos a
 * favor…) y el formato lo pone esta función, no el modelo: así el informe sale
 * siempre igual de ordenado, se puede copiar tal cual a una nota o a un
 * correo, y el modelo no gasta tokens en maquetar.
 */
export function informeAnalisisMd(a: AnalisisCandidato): string {
  const md: string[] = [];
  const seccion = (titulo: string, ...cuerpo: string[]) => md.push(`### ${titulo}`, '', ...cuerpo, '');

  const resumen = (a.resumen ?? '').trim();
  if (resumen) seccion('Resumen ejecutivo', resumen);

  const filas: string[] = [];
  if (a.ajusteVacante?.nivel || a.ajusteVacante?.porque) {
    filas.push(fila('Ajuste a la vacante', nivel(a.ajusteVacante.nivel), a.ajusteVacante.porque));
  }
  if (a.estabilidadLaboral?.nivel || a.estabilidadLaboral?.porque) {
    filas.push(fila('Estabilidad laboral', nivel(a.estabilidadLaboral.nivel ?? 'sin datos'), a.estabilidadLaboral.porque));
  }
  if (a.cargoSugerido?.cargo || a.cargoSugerido?.porque) {
    const cargo = linea(a.cargoSugerido.cargo);
    filas.push(fila('Cargo sugerido', cargo ? `**${cargo}**` : 'Sin propuesta', a.cargoSugerido.porque));
  }
  if (filas.length) {
    seccion('Indicadores clave',
      '| Indicador | Valoración | Fundamento |',
      '| --- | --- | --- |',
      ...filas);
  }

  // Con quién vive y quién responde por los hijos: se rotula como logística a
  // propósito, igual que en el prompt, para que nadie lo lea como un criterio
  // de descarte.
  if (a.redDeApoyo?.resumen?.trim()) {
    const cuerpo = [linea(a.redDeApoyo.resumen)];
    if (a.redDeApoyo.evidencia?.trim()) cuerpo.push('', `*Fuente: ${sinAsteriscos(a.redDeApoyo.evidencia)}*`);
    cuerpo.push('', '> Dato de logística (turnos, rutas, horarios), no un criterio de selección.');
    seccion('Red de apoyo y disponibilidad', ...cuerpo);
  }

  seccion('Puntos a favor', ...puntos(a.aFavor, 'El expediente no da puntos a favor.'));
  seccion('Puntos en contra', ...puntos(a.enContra, 'El expediente no da puntos en contra.'));
  seccion('Riesgos a verificar', ...puntos(a.riesgos, 'No se señalan riesgos.'));

  const faltan = textos(a.datosQueFaltan);
  if (faltan.length) seccion('Información pendiente antes de decidir', ...faltan.map(d => `- ${d}`));

  const preguntas = textos(a.preguntasSugeridas);
  if (preguntas.length) seccion('Preguntas sugeridas para la entrevista', ...preguntas.map((p, i) => `${i + 1}. ${p}`));

  // Lo que el modelo añadió por su cuenta: se pinta como una sección más, con
  // su nombre en español legible, en vez de tirar el JSON en pantalla.
  for (const [clave, valor] of Object.entries(a.extras ?? {})) {
    const cuerpo = valorMd(valor);
    if (cuerpo.length) seccion(rotulo(clave), ...cuerpo);
  }

  return md.join('\n').trim();
}

/** "observacionesGenerales" / "datos_extra" → "Observaciones generales" / "Datos extra". */
function rotulo(clave: string): string {
  const t = clave.replace(/([a-záéíóúñ])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Otros datos';
}

/**
 * Un valor cualquiera como Markdown: texto → párrafo, lista de textos → viñetas,
 * lista de objetos → tabla, objeto → "Clave: valor". Nunca JSON.
 */
function valorMd(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  if (typeof v !== 'object') return [linea(String(v))].filter(Boolean);
  if (Array.isArray(v)) {
    const items = v.filter(x => x !== null && x !== undefined && x !== '');
    if (!items.length) return [];
    if (items.every(x => typeof x !== 'object')) return items.map(x => `- ${linea(String(x))}`);
    const objs = items.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x));
    const cols = [...new Set(objs.flatMap(o => Object.keys(o)))];
    if (!cols.length) return [];
    return [
      `| ${cols.map(rotulo).join(' | ')} |`,
      `| ${cols.map(() => '---').join(' | ')} |`,
      ...objs.map(o => `| ${cols.map(c => celda(simple(o[c]))).join(' | ')} |`),
    ];
  }
  return Object.entries(v as Record<string, unknown>)
    .filter(([, x]) => x !== null && x !== undefined && x !== '')
    .map(([k, x]) => `- **${rotulo(k)}:** ${linea(simple(x))}`);
}

/** Un valor anidado dentro de una celda o viñeta, en una sola línea legible. */
function simple(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(simple).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${rotulo(k)}: ${simple(x)}`).join('; ');
  }
  return String(v);
}

const VALOR_NIVEL: Record<string, number> = { bajo: 1, medio: 2, alto: 3 };

/**
 * Gráficas del análisis, una por bloque ```echarts que pinta el mismo
 * `app-markdown-message` del chat. Van aparte del informe para que "Copiar
 * informe" siga pegando texto limpio.
 *
 * Salen de los datos ya tipados (conteos y semáforo), así que no dependen de
 * que el modelo las dibuje; si el modelo sí mandó las suyas, se añaden.
 */
export function graficasAnalisisMd(a: AnalisisCandidato): string[] {
  const bloques: string[] = [];
  const bloque = (titulo: string, opciones: object) =>
    bloques.push(`#### ${titulo}\n\n\`\`\`echarts\n${JSON.stringify(opciones)}\n\`\`\``);

  const conteos = [
    { name: 'A favor', value: (a.aFavor ?? []).length, color: '#16a34a' },
    { name: 'En contra', value: (a.enContra ?? []).length, color: '#dc2626' },
    { name: 'Riesgos', value: (a.riesgos ?? []).length, color: '#d97706' },
    { name: 'Datos que faltan', value: (a.datosQueFaltan ?? []).length, color: '#64748b' },
  ];
  if (conteos.some(c => c.value > 0)) {
    bloque('Balance del perfil', {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 8, right: 16, top: 12, bottom: 8, containLabel: true },
      xAxis: { type: 'value', minInterval: 1 },
      yAxis: { type: 'category', inverse: true, data: conteos.map(c => c.name) },
      series: [{
        type: 'bar', barMaxWidth: 22,
        label: { show: true, position: 'right' },
        data: conteos.map(c => ({ value: c.value, itemStyle: { color: c.color, borderRadius: [0, 4, 4, 0] } })),
      }],
    });
  }

  const semaforo = [
    { name: 'Ajuste a la vacante', nivel: a.ajusteVacante?.nivel },
    { name: 'Estabilidad laboral', nivel: a.estabilidadLaboral?.nivel },
  ].filter(x => x.nivel && VALOR_NIVEL[x.nivel]);
  if (semaforo.length) {
    const color: Record<string, string> = { alto: '#16a34a', medio: '#d97706', bajo: '#dc2626' };
    // El nivel va en el rótulo del eje: ECharts no traduce 1-2-3 a texto sin
    // una función, y aquí solo viajan opciones en JSON.
    const rot = (x: { name: string; nivel?: string }) =>
      `${x.name}: ${x.nivel!.charAt(0).toUpperCase()}${x.nivel!.slice(1)}`;
    bloque('Semáforo', {
      tooltip: { show: false },
      grid: { left: 8, right: 16, top: 12, bottom: 8, containLabel: true },
      xAxis: { type: 'value', min: 0, max: 3, interval: 1, axisLabel: { show: false } },
      yAxis: { type: 'category', inverse: true, data: semaforo.map(rot) },
      series: [{
        type: 'bar', barMaxWidth: 22,
        data: semaforo.map(x => ({
          value: VALOR_NIVEL[x.nivel!],
          itemStyle: { color: color[x.nivel!], borderRadius: [0, 4, 4, 0] },
        })),
      }],
    });
  }

  (a.graficas ?? []).forEach((g, i) => bloque(g.titulo ?? `Gráfica ${i + 1}`, g.opciones));
  return bloques;
}

/** "alto" → "**Alto**": la valoración en negrita para que se lea de un vistazo. */
function nivel(n?: string | null): string {
  const t = (n ?? '').trim();
  return t ? `**${t.charAt(0).toUpperCase()}${t.slice(1)}**` : '—';
}

function fila(indicador: string, valoracion: string, fundamento?: string | null): string {
  return `| ${indicador} | ${celda(valoracion)} | ${celda(fundamento)} |`;
}

/** Texto del modelo en una sola línea: un salto de línea partiría el renglón del informe. */
function linea(s?: string | null): string {
  return (s ?? '').replace(/\s*\n+\s*/g, ' ').trim();
}

/** Una barra vertical dentro de una celda la partiría en dos columnas. */
function celda(s?: string | null): string {
  return linea(s).replace(/\|/g, '/') || '—';
}

/** La evidencia va en cursiva: un asterisco suyo cerraría la cursiva antes de tiempo. */
function sinAsteriscos(s: string): string {
  return linea(s).replace(/\*/g, '');
}

function puntos(lista: PuntoAnalisis[] | undefined, vacio: string): string[] {
  const validos = (lista ?? []).filter(p => p?.punto?.trim());
  if (!validos.length) return [`*${vacio}*`];
  return validos.map((p, i) => {
    const evidencia = p.evidencia?.trim() ? ` — *${sinAsteriscos(p.evidencia)}*` : '';
    return `${i + 1}. ${linea(p.punto)}${evidencia}`;
  });
}

function textos(lista: string[] | undefined): string[] {
  return (lista ?? []).map(linea).filter(Boolean);
}
