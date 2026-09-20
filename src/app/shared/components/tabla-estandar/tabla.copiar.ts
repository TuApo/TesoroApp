import type { BloqueCopiado } from './tabla.tipos';

/** Evento de trazabilidad: qué se copió o descargó, nunca el contenido. */
export interface EventoCopia {
  accion: 'COPIAR' | 'DESCARGAR';
  modulo: string;
  descripcion: string;
  entidad?: string;
  detalle: {
    tabla: string;
    origen: 'seleccion' | 'todo' | 'descarga';
    filas: number;
    columnas: string[];
  };
}

let registrador: ((evento: EventoCopia) => void | Promise<void>) | null = null;

/**
 * Conecta el registro de copias con el log de actividad. Hoy no hay endpoint
 * para esto en el backend (el de auditoría solo recibe cambios de entidades),
 * así que nadie lo llama y no se registra nada: se deja listo para cuando exista.
 */
export function configurarRegistroCopia(
  fn: ((evento: EventoCopia) => void | Promise<void>) | null,
): void {
  registrador = fn;
}

/** Excel separa columnas por tabulador y filas por salto de línea. */
function celdaPlana(valor: string): string {
  return valor.replace(/[\t\r\n]+/g, ' ').trim();
}

export function aTSV(bloque: BloqueCopiado): string {
  const filas = bloque.encabezados.length ? [bloque.encabezados, ...bloque.filas] : bloque.filas;
  return filas.map((f) => f.map(celdaPlana).join('\t')).join('\r\n');
}

function escaparHtml(valor: string): string {
  return valor.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Excel respeta el HTML del portapapeles: el pegado conserva los encabezados y
 * no rompe los valores con comas o tildes.
 */
export function aHTML(bloque: BloqueCopiado): string {
  const thead = bloque.encabezados.length
    ? `<thead><tr>${bloque.encabezados.map((h) => `<th>${escaparHtml(celdaPlana(h))}</th>`).join('')}</tr></thead>`
    : '';
  const tbody = `<tbody>${bloque.filas
    .map((fila) => `<tr>${fila.map((c) => `<td>${escaparHtml(celdaPlana(c))}</td>`).join('')}</tr>`)
    .join('')}</tbody>`;
  return `<table border="1">${thead}${tbody}</table>`;
}

/** Copia con textarea para navegadores (o WebViews) sin API asíncrona. */
function copiarLegado(texto: string): boolean {
  try {
    const area = document.createElement('textarea');
    area.value = texto;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export async function copiarBloque(bloque: BloqueCopiado): Promise<boolean> {
  const tsv = aTSV(bloque);
  if (!tsv) return false;
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([tsv], { type: 'text/plain' }),
          'text/html': new Blob([aHTML(bloque)], { type: 'text/html' }),
        }),
      ]);
      return true;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(tsv);
      return true;
    }
  } catch {
    /* cae al método legado */
  }
  return copiarLegado(tsv);
}

export interface DatosCopia {
  modulo: string;
  entidad?: string;
  titulo: string;
  filas: number;
  columnas: string[];
  origen: 'seleccion' | 'todo' | 'descarga';
}

/** Evita duplicar el log cuando alguien repite Ctrl+C sobre lo mismo. */
let ultimaFirma = '';
let ultimoInstante = 0;

/** Deja rastro de qué se copió o descargó (tabla, filas, columnas). Nunca el contenido. */
export async function registrarCopia(datos: DatosCopia): Promise<void> {
  if (!registrador) return;
  const firma = `${datos.titulo}|${datos.origen}|${datos.filas}|${datos.columnas.join(',')}`;
  const ahora = Date.now();
  if (firma === ultimaFirma && ahora - ultimoInstante < 4000) return;
  ultimaFirma = firma;
  ultimoInstante = ahora;

  const verbo =
    datos.origen === 'descarga' ? 'Descargó' : datos.origen === 'todo' ? 'Copió la tabla completa' : 'Copió una selección';
  const descripcion = `${verbo} de ${datos.titulo}: ${datos.filas} fila(s) × ${datos.columnas.length} columna(s)`;

  try {
    await registrador({
      accion: datos.origen === 'descarga' ? 'DESCARGAR' : 'COPIAR',
      modulo: datos.modulo,
      descripcion,
      entidad: datos.entidad,
      detalle: { tabla: datos.titulo, origen: datos.origen, filas: datos.filas, columnas: datos.columnas },
    });
  } catch (e) {
    console.error('registrarCopia', e);
  }
}

/**
 * Los números entran como número para que Excel los sume; el resto como texto.
 * Solo se convierte lo que vuelve idéntico al escribirlo, así `007` o `1/1`
 * conservan su forma.
 */
function valorExcel(valor: string): string | number {
  const texto = celdaPlana(valor);
  if (texto === '') return '';
  const numero = Number(texto);
  return Number.isFinite(numero) && String(numero) === texto ? numero : texto;
}

/** Azul marino de la marca, en ARGB para exceljs. */
const COLOR_ENCABEZADO = 'FF21263C';
const COLOR_BORDE = 'FF171B2E';

/**
 * Descarga la tabla como un .xlsx de verdad: encabezado con el color de la
 * marca, fila congelada, autofiltro y anchos según el contenido. `exceljs` se
 * carga bajo demanda para no engordar la pantalla mientras nadie descarga.
 */
export async function descargarExcel(bloque: BloqueCopiado, nombre: string, hoja = 'Datos'): Promise<void> {
  const mod: any = await import('exceljs');
  const Workbook = mod?.Workbook ?? mod?.default?.Workbook;
  if (!Workbook) throw new Error('No se pudo cargar ExcelJS');
  const wb = new Workbook();
  wb.creator = 'Tu Apo';
  wb.created = new Date();
  // Excel no admite : \ / ? * [ ] en el nombre de la hoja, ni más de 31 letras.
  const ws = wb.addWorksheet(hoja.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31) || 'Datos', {
    views: [{ state: 'frozen', ySplit: bloque.encabezados.length ? 1 : 0 }],
  });

  if (bloque.encabezados.length) ws.addRow(bloque.encabezados);
  for (const fila of bloque.filas) ws.addRow(fila.map(valorExcel));

  const todas = bloque.encabezados.length ? [bloque.encabezados, ...bloque.filas] : bloque.filas;
  const anchos = todas.reduce<number[]>((acc, fila) => {
    fila.forEach((c, i) => {
      acc[i] = Math.max(acc[i] ?? 10, Math.min(60, celdaPlana(c).length + 2));
    });
    return acc;
  }, []);
  anchos.forEach((ancho, i) => {
    ws.getColumn(i + 1).width = ancho;
  });

  if (bloque.encabezados.length) {
    const encabezado = ws.getRow(1);
    encabezado.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    encabezado.alignment = { vertical: 'middle' };
    encabezado.height = 20;
    encabezado.eachCell((cell: any) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ENCABEZADO } };
      cell.border = { bottom: { style: 'thin', color: { argb: COLOR_BORDE } } };
    });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  descargarBlob(blob, `${nombre}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/** CSV con BOM para que Excel en español abra bien las tildes. */
export function aCSV(bloque: BloqueCopiado): string {
  const filas = bloque.encabezados.length ? [bloque.encabezados, ...bloque.filas] : bloque.filas;
  return filas.map((f) => f.map((c) => `"${celdaPlana(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
}

export function descargarCSV(bloque: BloqueCopiado, nombre: string): void {
  const blob = new Blob(['﻿' + aCSV(bloque)], { type: 'text/csv;charset=utf-8;' });
  descargarBlob(blob, `${nombre}_${new Date().toISOString().slice(0, 10)}.csv`);
}

function descargarBlob(blob: Blob, archivo: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = archivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
