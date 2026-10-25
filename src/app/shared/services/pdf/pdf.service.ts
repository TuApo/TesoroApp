import { Injectable } from '@angular/core';
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';

@Injectable({
    providedIn: 'root'
})
export class PdfService {

    constructor() { }

    /**
     * Une múltiples archivos PDF en uno solo.
     * @param files Lista de archivos (File) a unir.
     * @param filenameNombre Nombre del archivo resultante.
     * @param onProgress Callback opcional para reportar el progreso (índice actual, total).
     * @returns Promesa con el archivo (File) fusionado.
     */
    async mergePdfs(
        files: File[],
        filename: string,
        onProgress?: (current: number, total: number) => void
    ): Promise<File> {
        const pdfDoc = await PDFDocument.create();
        const total = files.length;

        // Leer buffers en paralelo
        const buffers = await Promise.all(files.map(f => f.arrayBuffer()));

        for (let i = 0; i < total; i++) {
            try {
                const src = await PDFDocument.load(buffers[i], { updateMetadata: false });
                const copiedPages = await pdfDoc.copyPages(src, src.getPageIndices());
                copiedPages.forEach(p => pdfDoc.addPage(p));
            } catch (error) {
                console.error(`Error al procesar el archivo ${files[i].name}`, error);
                // Podríamos decidir si fallar todo o continuar con los válidos.
                // Por ahora, solo logueamos y continuamos la fusión.
            }

            if (onProgress) {
                onProgress(i + 1, total);
            }

            // Ceder control al event loop para no congelar la UI en procesos pesados
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        const bytes = await pdfDoc.save({ addDefaultPage: false });

        // Crear Uint8Array y luego File
        const ab = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(ab).set(bytes);

        return new File([ab], filename, { type: 'application/pdf' });
    }

    /**
     * Une los PDF de los exámenes médicos y deja escrito en el documento el
     * resultado de cada uno: una portada con la lista (examen → APTO / NO APTO)
     * y, en cada página, un rótulo con el examen y su resultado.
     */
    async unirExamenesConResultados(
        items: { file: File; examen: string; resultado: string | null }[],
        resumen: { examen: string; resultado: string | null; conSoporte: boolean }[],
        portada: { titulo: string; lineas: string[] },
        filename: string,
        onProgress?: (current: number, total: number) => void
    ): Promise<File> {
        const pdfDoc = await PDFDocument.create();
        const fuente = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const negrita = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        this.dibujarPortadaExamenes(pdfDoc, fuente, negrita, portada, resumen);

        const buffers = await Promise.all(items.map(it => it.file.arrayBuffer()));
        for (let i = 0; i < items.length; i++) {
            try {
                const src = await PDFDocument.load(buffers[i], { updateMetadata: false });
                const paginas = await pdfDoc.copyPages(src, src.getPageIndices());
                const rotulo = `${items[i].examen} - ${items[i].resultado ?? 'SIN RESULTADO'}`;
                paginas.forEach(p => {
                    pdfDoc.addPage(p);
                    this.dibujarRotulo(p, negrita, rotulo, items[i].resultado);
                });
            } catch (error) {
                console.error(`Error al procesar el archivo ${items[i].file.name}`, error);
            }
            onProgress?.(i + 1, items.length);
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        const bytes = await pdfDoc.save({ addDefaultPage: false });
        const ab = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(ab).set(bytes);
        return new File([ab], filename, { type: 'application/pdf' });
    }

    /** Las fuentes estándar solo codifican WinAnsi: lo demás se cambia por '?'. */
    private textoPdf(t: string): string {
        return String(t ?? '').replace(/[\u2013\u2014]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
    }

    private colorResultado(resultado: string | null) {
        return resultado === 'APTO' ? rgb(0.09, 0.5, 0.25)
            : resultado === 'NO APTO' ? rgb(0.75, 0.11, 0.11) : rgb(0.4, 0.4, 0.4);
    }

    private dibujarRotulo(p: PDFPage, negrita: PDFFont, texto: string, resultado: string | null): void {
        const t = this.textoPdf(texto);
        const { width, height } = p.getSize();
        const size = 9;
        const ancho = Math.min(negrita.widthOfTextAtSize(t, size) + 14, width - 20);
        const x = width - ancho - 10;
        const y = height - 24;
        p.drawRectangle({ x, y, width: ancho, height: 16, color: rgb(1, 1, 1),
            borderColor: this.colorResultado(resultado), borderWidth: 1.2, opacity: 0.92 });
        p.drawText(t, { x: x + 7, y: y + 4.5, size, font: negrita, color: this.colorResultado(resultado),
            maxWidth: ancho - 14 });
    }

    private dibujarPortadaExamenes(
        pdfDoc: PDFDocument, fuente: PDFFont, negrita: PDFFont,
        portada: { titulo: string; lineas: string[] },
        resumen: { examen: string; resultado: string | null; conSoporte: boolean }[],
    ): void {
        let p = pdfDoc.addPage([595.28, 841.89]); // A4
        const margen = 56;
        let y = 841.89 - margen;
        p.drawText(this.textoPdf(portada.titulo), { x: margen, y, size: 16, font: negrita });
        y -= 22;
        for (const l of portada.lineas) {
            p.drawText(this.textoPdf(l), { x: margen, y, size: 10, font: fuente, color: rgb(0.3, 0.3, 0.3) });
            y -= 14;
        }
        y -= 14;
        const colRes = 360, colSop = 455;
        const cabecera = () => {
            p.drawText('Examen', { x: margen, y, size: 10, font: negrita });
            p.drawText('Resultado', { x: colRes, y, size: 10, font: negrita });
            p.drawText('Soporte', { x: colSop, y, size: 10, font: negrita });
            y -= 6;
            p.drawLine({ start: { x: margen, y }, end: { x: 595.28 - margen, y }, thickness: 0.8 });
            y -= 16;
        };
        cabecera();
        for (const r of resumen) {
            if (y < margen) { p = pdfDoc.addPage([595.28, 841.89]); y = 841.89 - margen; cabecera(); }
            p.drawText(this.textoPdf(r.examen), { x: margen, y, size: 10, font: fuente, maxWidth: colRes - margen - 10 });
            p.drawText(r.resultado ?? 'SIN RESULTADO', { x: colRes, y, size: 10, font: negrita,
                color: this.colorResultado(r.resultado) });
            p.drawText(r.conSoporte ? 'Adjunto' : 'Sin PDF', { x: colSop, y, size: 10, font: fuente,
                color: rgb(0.3, 0.3, 0.3) });
            y -= 18;
        }
    }

    /**
     * Verifica si un archivo es PDF por su tipo MIME o extensión.
     */
    isPdf(file?: File | null): boolean {
        return !!file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name));
    }
}
