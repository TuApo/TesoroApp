import { PDFDocument } from 'pdf-lib';
import { PdfService } from './pdf.service';

/** Portada + rótulo por página con el resultado de cada examen. */
describe('PdfService.unirExamenesConResultados', () => {
  const pdfDePaginas = async (n: number, nombre: string): Promise<File> => {
    const d = await PDFDocument.create();
    for (let i = 0; i < n; i++) d.addPage([300, 400]);
    const bytes = await d.save();
    return new File([bytes as BlobPart], nombre, { type: 'application/pdf' });
  };

  it('agrega la portada y conserva todas las páginas de los exámenes', async () => {
    const svc = new PdfService();
    const out = await svc.unirExamenesConResultados(
      [
        { file: await pdfDePaginas(2, 'a.pdf'), examen: 'Audiometría', resultado: 'APTO' },
        { file: await pdfDePaginas(1, 'b.pdf'), examen: 'Optometría — visión', resultado: 'NO APTO' },
      ],
      [
        { examen: 'Audiometría', resultado: 'APTO', conSoporte: true },
        { examen: 'Optometría — visión', resultado: 'NO APTO', conSoporte: true },
        { examen: 'Laboratorio 🧪', resultado: 'APTO', conSoporte: false },
      ],
      { titulo: 'Resultados de exámenes médicos de ingreso', lineas: ['CC 100 · Ñoño Pérez'] },
      'X.pdf',
    );
    expect(out.name).toBe('X.pdf');
    const leido = await PDFDocument.load(await out.arrayBuffer());
    expect(leido.getPageCount()).toBe(1 + 2 + 1);
  });
});
