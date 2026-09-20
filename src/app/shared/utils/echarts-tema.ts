import { provideEchartsCore } from 'ngx-echarts';

/**
 * ECharts pinta en <canvas>: el CSS del tema no le llega. En modo oscuro las
 * leyendas y los ejes quedaban en gris oscuro sobre el fondo oscuro. Este tema
 * se aplica al crear cada gráfica cuando <html> está en `data-theme="dark"`;
 * los colores que una gráfica declare en sus propias opciones siguen mandando.
 */
const TEMA_OSCURO = {
  backgroundColor: 'transparent',
  textStyle: { color: '#CBD5E1' },
  title: { textStyle: { color: '#E5EAF2' }, subtextStyle: { color: '#9AA8BC' } },
  legend: { textStyle: { color: '#CBD5E1' }, pageTextStyle: { color: '#9AA8BC' } },
  tooltip: {
    backgroundColor: '#1C283F',
    borderColor: '#354562',
    textStyle: { color: '#E5EAF2' },
  },
  categoryAxis: ejeOscuro(),
  valueAxis: ejeOscuro(),
  logAxis: ejeOscuro(),
  timeAxis: ejeOscuro(),
  dataZoom: { textStyle: { color: '#9AA8BC' }, borderColor: '#354562' },
  visualMap: { textStyle: { color: '#CBD5E1' } },
};

function ejeOscuro() {
  return {
    axisLine: { lineStyle: { color: '#354562' } },
    axisTick: { lineStyle: { color: '#354562' } },
    axisLabel: { color: '#9AA8BC' },
    splitLine: { lineStyle: { color: '#263349' } },
    nameTextStyle: { color: '#9AA8BC' },
  };
}

function temaActual(): object | null {
  if (typeof document === 'undefined') return null;
  return document.documentElement.getAttribute('data-theme') === 'dark' ? TEMA_OSCURO : null;
}

/** Reemplazo de `provideEchartsCore({ echarts: () => import('echarts') })` que respeta el tema. */
export function provideEchartsTema() {
  return provideEchartsCore({
    echarts: () => import('echarts'),
    // Getter: se evalúa cuando se crea cada gráfica, no una sola vez al
    // declarar el provider, así una pantalla abierta después de cambiar de
    // tema ya nace con los colores correctos.
    get theme() {
      return temaActual() as any;
    },
  } as any);
}
