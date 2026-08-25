import { saveAs } from 'file-saver';

/**
 * Descarga un blob con nombre. El backend ya manda `Content-Disposition`, pero
 * cuando la respuesta se pide como blob el navegador no lo aplica: hay que
 * dispararla desde el código.
 */
export function descargar(blob: Blob, nombre: string): void {
  saveAs(blob, nombre);
}

/** Nombre de archivo consistente en toda la app: «Reporte - 2026-08-21.xlsx». */
export function nombreArchivo(titulo: string, formato: 'XLSX' | 'CSV' | 'PDF'): string {
  const base = (titulo || 'Reporte').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80).trim();
  const ext = formato === 'CSV' ? 'csv' : formato === 'PDF' ? 'pdf' : 'xlsx';
  return `${base} - ${new Date().toISOString().slice(0, 10)}.${ext}`;
}
