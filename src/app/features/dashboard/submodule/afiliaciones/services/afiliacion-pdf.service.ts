import { Injectable } from '@angular/core';
import type { RowInput } from 'jspdf-autotable';

import { ContratacionRow } from '../models/afiliaciones-dashboard.models';

/** Opciones de la generación (todas opcionales: hay defaults razonables). */
export interface AfiliacionPdfOpts {
  /** Nombre del archivo, SIN extensión. */
  archivo?: string;
  /** Quién lo generó — va en el pie de cada página. */
  usuario?: string;
  /** Texto que explica de dónde salió la lista (selección de la tabla, pegado, …). */
  origen?: string;
}

/** Una fila de la sección: etiqueta + valor. */
type Campo = [string, string];

/**
 * FORMATO DE AFILIACIÓN — generador de PDF.
 *
 * Produce el mismo documento en los tres flujos de la pantalla de afiliaciones (individual desde
 * la fila, masivo desde la selección y masivo desde el pegado de cédulas): una página por persona
 * con identificación, vinculación, entidades de seguridad social, lo que el robot vio en ADRES y
 * el estado de las 4 validaciones, más espacio de firmas.
 *
 * Cuando son varias personas se antepone una RELACIÓN (listado tabular) para que la carpeta
 * impresa tenga índice y se pueda cotejar contra lo que se radica en la entidad.
 *
 * Todo se arma con los datos que ya trae la fila de `v_afiliacion_contratos` — el PDF NO inventa
 * ni consulta nada: si un campo está vacío en la base, sale vacío aquí. Esa es justamente la
 * utilidad de imprimirlo antes de radicar.
 *
 * jsPDF y autoTable se cargan bajo demanda para no meter ~400 KB en el chunk de afiliaciones.
 */
@Injectable({ providedIn: 'root' })
export class AfiliacionPdfService {

  // Carta en milímetros.
  private static readonly ANCHO = 215.9;
  private static readonly ALTO = 279.4;
  private static readonly M = 14;
  private static readonly CONTENIDO = AfiliacionPdfService.ANCHO - AfiliacionPdfService.M * 2;

  private static readonly AZUL: [number, number, number] = [30, 64, 175];
  private static readonly PIZARRA: [number, number, number] = [51, 65, 85];
  private static readonly GRIS: [number, number, number] = [148, 163, 184];
  private static readonly BORDE: [number, number, number] = [203, 213, 225];

  /** Formato de una sola persona. */
  async generarIndividual(row: ContratacionRow, opts: AfiliacionPdfOpts = {}): Promise<void> {
    const nombre = this.limpiarNombreArchivo(
      `Afiliacion_${row.numero_documento || 's-doc'}_${row.nombre_completo || ''}`);
    await this.generar([row], { ...opts, archivo: opts.archivo || nombre });
  }

  /**
   * Formato de varias personas: relación al frente + una página por persona.
   * Con una sola persona se comporta igual que `generarIndividual` (sin relación).
   */
  async generarMasivo(rows: ContratacionRow[], opts: AfiliacionPdfOpts = {}): Promise<void> {
    if (!rows.length) return;
    if (rows.length === 1) { await this.generarIndividual(rows[0], opts); return; }
    const archivo = opts.archivo || `Afiliaciones_${rows.length}_${this.selloArchivo()}`;
    await this.generar(rows, { ...opts, archivo });
  }

  // ────────────────────────────────────────────────────────────────────
  // Armado del documento
  // ────────────────────────────────────────────────────────────────────

  private async generar(rows: ContratacionRow[], opts: AfiliacionPdfOpts): Promise<void> {
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable')
    ]);

    const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' });
    const generado = new Date();

    if (rows.length > 1) this.relacion(doc, autoTable, rows, generado, opts);

    rows.forEach((row, i) => {
      if (i > 0 || rows.length > 1) doc.addPage();
      this.ficha(doc, autoTable, row, generado, opts);
    });

    this.pies(doc, generado, opts);
    doc.save(`${opts.archivo || 'afiliacion'}.pdf`);
  }

  /** Portada: listado de todas las personas del lote, para cotejar contra lo radicado. */
  private relacion(doc: any, autoTable: any, rows: ContratacionRow[], generado: Date,
                   opts: AfiliacionPdfOpts): void {
    const { M, CONTENIDO } = AfiliacionPdfService;

    let y = this.encabezado(doc, 'RELACIÓN DE AFILIACIÓN', `${rows.length} personas`, generado);

    if (opts.origen) {
      doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...AfiliacionPdfService.PIZARRA);
      doc.text(opts.origen, M, y);
      y += 5;
    }

    const body: RowInput[] = rows.map((r, i) => [
      String(i + 1),
      r.numero_documento || '',
      r.nombre_completo || '',
      this.corto(r.oficina, 22),
      this.corto(r.finca || r.centro_costo, 22),
      this.fecha(r.fecha_ingreso),
      this.corto(r.eps, 20),
      this.corto(r.afp, 18),
      this.banderas(r)
    ]);

    autoTable(doc, {
      startY: y,
      head: [['#', 'Cédula', 'Nombre', 'Oficina', 'Finca / CC', 'Ingreso', 'EPS', 'AFP', 'A C N P']],
      body,
      theme: 'grid',
      margin: { left: M, right: M },
      styles: {
        font: 'helvetica', fontSize: 7, cellPadding: { top: 1.3, bottom: 1.3, left: 1.6, right: 1.6 },
        lineColor: AfiliacionPdfService.BORDE, lineWidth: 0.1, overflow: 'linebreak'
      },
      headStyles: {
        fillColor: AfiliacionPdfService.AZUL, textColor: [255, 255, 255],
        fontSize: 6.8, fontStyle: 'bold', halign: 'center'
      },
      // Los anchos suman 165 mm; el resto (≈23 mm) queda para las banderas, que van en
      // monoespaciada y necesitan caber en UNA línea o la relación se descuadra entera.
      columnStyles: {
        0: { cellWidth: 8, halign: 'right' },
        1: { cellWidth: 22 },
        2: { cellWidth: 38 },
        3: { cellWidth: 22 },
        4: { cellWidth: 22 },
        5: { cellWidth: 17, halign: 'center' },
        6: { cellWidth: 20 },
        7: { cellWidth: 16 },
        8: { cellWidth: CONTENIDO - 165, halign: 'center', font: 'courier' }
      },
      alternateRowStyles: { fillColor: [248, 250, 252] }
    });

    const finalY = doc.lastAutoTable?.finalY ?? y;
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...AfiliacionPdfService.GRIS);
    doc.text(
      'A C N P = Afiliaciones · Coordinador de finca · Nómina · Pago de seguridad social. '
      + 'X = confirmado, · = pendiente.',
      M, Math.min(finalY + 5, AfiliacionPdfService.ALTO - 18));
  }

  /** Una página por persona: el formato propiamente dicho. */
  private ficha(doc: any, autoTable: any, r: ContratacionRow, generado: Date,
                opts: AfiliacionPdfOpts): void {
    const { M } = AfiliacionPdfService;

    let y = this.encabezado(doc, 'FORMATO DE AFILIACIÓN', r.empresa || '', generado);

    // Franja de identidad: lo que se lee de un vistazo al tomar la hoja.
    doc.setFillColor(241, 245, 249).setDrawColor(...AfiliacionPdfService.BORDE).setLineWidth(0.2);
    doc.roundedRect(M, y, AfiliacionPdfService.CONTENIDO, 13, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(15, 23, 42);
    doc.text(this.corto(r.nombre_completo, 52) || 'Sin nombre', M + 4, y + 5.6);
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...AfiliacionPdfService.PIZARRA);
    doc.text(
      `${r.tipo_documento || 'CC'} ${r.numero_documento || '—'}`
      + `   ·   Ingreso: ${this.fecha(r.fecha_ingreso) || '—'}`
      + `   ·   Contrato: ${r.codigo_contrato || '—'}`,
      M + 4, y + 10.4);
    y += 18;

    y = this.seccion(doc, autoTable, '1. Identificación del trabajador', [
      ['Tipo de documento', r.tipo_documento || ''],
      ['Número de documento', r.numero_documento || ''],
      ['Primer nombre', r.primer_nombre || ''],
      ['Segundo nombre', r.segundo_nombre || ''],
      ['Primer apellido', r.primer_apellido || ''],
      ['Segundo apellido', r.segundo_apellido || ''],
      ['Sexo', r.sexo || ''],
      ['Fecha de nacimiento', this.fecha(r.fecha_nacimiento)],
      ['Nacionalidad', r.nacionalidad || ''],
      ['País', r.pais || ''],
      ['Depto. de nacimiento', r.departamento_nacimiento || ''],
      ['Mpio. de nacimiento', r.municipio_nacimiento || ''],
      ['Dirección', r.direccion || ''],
      ['Barrio', r.barrio || ''],
      ['Localidad', r.localidad || ''],
      ['Municipio de residencia', r.municipio || ''],
      ['Departamento de residencia', r.departamento || ''],
      ['Celular', r.celular || ''],
      ['WhatsApp', r.whatsapp || ''],
      ['Correo electrónico', r.correo || ''],
      ['', '']
    ], y);

    y = this.seccion(doc, autoTable, '2. Vinculación laboral', [
      ['Empresa (temporal)', r.empresa || ''],
      ['Oficina', r.oficina || ''],
      ['Finca / Centro de costo', r.finca || r.centro_costo || ''],
      ['Cargo', r.cargo || ''],
      ['Salario', this.dinero(r.salario)],
      ['Código de contrato', r.codigo_contrato || ''],
      ['Firma de contrato', this.fecha(r.fecha_firma_contrato)],
      ['Fecha de ingreso', this.fecha(r.fecha_ingreso)],
      ['Estado del proceso', r.estado || ''],
      ['Responsable', r.usuario_responsable || '']
    ], y);

    y = this.seccion(doc, autoTable, '3. Entidades de seguridad social', [
      ['EPS (contrato)', r.eps || ''],
      ['Fondo de pensiones (AFP)', r.afp || ''],
      ['Caja de compensación', r.caja_compensacion || ''],
      ['ARL', r.arl_estado || ''],
      ['Estado de afiliación', r.estado_afiliacion || ''],
      ['', '']
    ], y);

    y = this.seccion(doc, autoTable, '4. Consulta ADRES (robot)', [
      ['EPS registrada en ADRES', r.adres_eps || 'Sin consulta'],
      ['Estado en ADRES', r.adres_estado || 'Sin consulta'],
      ['Fecha de la consulta', this.fechaHora(r.adres_fecha)],
      ['', '']
    ], y);

    y = this.seccion(doc, autoTable, '5. Validaciones de confirmación de ingreso', [
      ['Afiliaciones', this.siNo(r.ingreso_confirmado)],
      ['Coordinador de finca', this.siNo(r.coord_confirmado)],
      ['Nómina', this.siNo(r.nomina_confirmado)],
      ['Pago de seguridad social', this.siNo(r.pago_confirmado)]
    ], y);

    this.firmas(doc, y);
  }

  /**
   * Una sección: título y su rejilla de campos en dos columnas (etiqueta | valor).
   * Devuelve la Y en la que quedó, para encadenar la siguiente.
   */
  private seccion(doc: any, autoTable: any, titulo: string, campos: Campo[], y: number): number {
    const { M, CONTENIDO } = AfiliacionPdfService;

    doc.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(...AfiliacionPdfService.AZUL);
    doc.text(titulo.toUpperCase(), M, y + 3.4);
    doc.setDrawColor(...AfiliacionPdfService.AZUL).setLineWidth(0.4);
    doc.line(M, y + 4.8, M + CONTENIDO, y + 4.8);

    // Dos parejas por fila: etiqueta, valor, etiqueta, valor.
    const body: RowInput[] = [];
    for (let i = 0; i < campos.length; i += 2) {
      const a = campos[i];
      const b = campos[i + 1] || ['', ''];
      body.push([a[0], a[1] || '—', b[0], b[0] ? (b[1] || '—') : '']);
    }

    const ancho = CONTENIDO / 2;
    autoTable(doc, {
      startY: y + 6.5,
      body,
      theme: 'grid',
      margin: { left: M, right: M },
      // 7.5pt con poco relleno: la ficha son 5 secciones y 23 datos, y a 8pt el bloque de
      // firmas se caía a una segunda página en cuanto una dirección ocupaba dos líneas.
      styles: {
        font: 'helvetica', fontSize: 7.5, cellPadding: { top: 1.1, bottom: 1.1, left: 2, right: 2 },
        lineColor: AfiliacionPdfService.BORDE, lineWidth: 0.1, textColor: [15, 23, 42],
        overflow: 'linebreak'
      },
      columnStyles: {
        0: { cellWidth: ancho * 0.42, fontStyle: 'bold', textColor: AfiliacionPdfService.PIZARRA, fillColor: [248, 250, 252] },
        1: { cellWidth: ancho * 0.58 },
        2: { cellWidth: ancho * 0.42, fontStyle: 'bold', textColor: AfiliacionPdfService.PIZARRA, fillColor: [248, 250, 252] },
        3: { cellWidth: ancho * 0.58 }
      }
    });

    return (doc.lastAutoTable?.finalY ?? y + 20) + 5;
  }

  /** Banda superior de la página. Devuelve la Y libre bajo ella. */
  private encabezado(doc: any, titulo: string, subtitulo: string, generado: Date): number {
    const { M, ANCHO, CONTENIDO } = AfiliacionPdfService;

    doc.setFillColor(...AfiliacionPdfService.AZUL);
    doc.rect(0, 0, ANCHO, 20, 'F');

    doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(255, 255, 255);
    doc.text(titulo, M, 9.5);

    doc.setFont('helvetica', 'normal').setFontSize(8.5);
    if (subtitulo) doc.text(subtitulo, M, 15.5);

    const sello = `Generado ${this.fechaHoraCorta(generado)}`;
    doc.text(sello, M + CONTENIDO - doc.getTextWidth(sello), 15.5);

    doc.setTextColor(0, 0, 0);
    return 27;
  }

  /** Bloque de firmas al pie de la ficha (se ancla abajo si la página quedó corta). */
  private firmas(doc: any, y: number): void {
    const { M, ALTO, CONTENIDO } = AfiliacionPdfService;
    const base = Math.max(y + 8, ALTO - 42);
    const ancho = (CONTENIDO - 12) / 2;

    doc.setDrawColor(...AfiliacionPdfService.PIZARRA).setLineWidth(0.3);
    doc.line(M, base, M + ancho, base);
    doc.line(M + ancho + 12, base, M + CONTENIDO, base);

    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...AfiliacionPdfService.PIZARRA);
    doc.text('Firma del trabajador', M, base + 4.5);
    doc.text('Firma del responsable de afiliaciones', M + ancho + 12, base + 4.5);

    doc.setFontSize(7).setTextColor(...AfiliacionPdfService.GRIS);
    doc.text('C.C. ______________________', M, base + 9.5);
    doc.text('Fecha: ____________________', M + ancho + 12, base + 9.5);
  }

  /** Pie con paginación — se pinta al final, cuando ya se sabe el total de páginas. */
  private pies(doc: any, generado: Date, opts: AfiliacionPdfOpts): void {
    const { M, ALTO, CONTENIDO } = AfiliacionPdfService;
    const total = doc.getNumberOfPages();

    for (let p = 1; p <= total; p++) {
      doc.setPage(p);
      doc.setDrawColor(...AfiliacionPdfService.BORDE).setLineWidth(0.2);
      doc.line(M, ALTO - 12, M + CONTENIDO, ALTO - 12);

      doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...AfiliacionPdfService.GRIS);
      const izq = `TesoroApp · Gestión de Afiliaciones${opts.usuario ? ' · ' + opts.usuario : ''}`
        + ` · ${this.fechaHoraCorta(generado)}`;
      doc.text(izq, M, ALTO - 8);

      const der = `Página ${p} de ${total}`;
      doc.text(der, M + CONTENIDO - doc.getTextWidth(der), ALTO - 8);
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Formato de valores
  // ────────────────────────────────────────────────────────────────────

  /** Las 4 banderas en 4 caracteres, para que quepan en una columna de la relación. */
  private banderas(r: ContratacionRow): string {
    const m = (v?: boolean) => (v ? 'X' : '·');
    return `${m(r.ingreso_confirmado)} ${m(r.coord_confirmado)} ${m(r.nomina_confirmado)} ${m(r.pago_confirmado)}`;
  }

  private siNo(v?: boolean): string { return v ? 'SÍ' : 'NO'; }

  /** 'YYYY-MM-DD' o ISO → 'dd/MM/yyyy'. Lo que no parsea se devuelve tal cual. */
  private fecha(v?: string): string {
    if (!v) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    const d = new Date(v);
    return isNaN(d.getTime()) ? String(v) : this.fechaDe(d);
  }

  private fechaHora(v?: string): string {
    if (!v) return '';
    const d = new Date(v);
    if (isNaN(d.getTime())) return this.fecha(v);
    return `${this.fechaDe(d)} ${this.horaDe(d)}`;
  }

  private fechaHoraCorta(d: Date): string { return `${this.fechaDe(d)} ${this.horaDe(d)}`; }

  private fechaDe(d: Date): string {
    return `${this.dos(d.getDate())}/${this.dos(d.getMonth() + 1)}/${d.getFullYear()}`;
  }
  private horaDe(d: Date): string { return `${this.dos(d.getHours())}:${this.dos(d.getMinutes())}`; }
  private dos(n: number): string { return String(n).padStart(2, '0'); }

  /** Sello para el nombre del archivo: yyyyMMdd_HHmm. */
  private selloArchivo(): string {
    const d = new Date();
    return `${d.getFullYear()}${this.dos(d.getMonth() + 1)}${this.dos(d.getDate())}`
      + `_${this.dos(d.getHours())}${this.dos(d.getMinutes())}`;
  }

  /** El salario viene como texto libre; si es un número se formatea, si no se respeta. */
  private dinero(v?: string): string {
    if (!v) return '';
    const n = Number(String(v).replace(/[^\d.-]/g, ''));
    if (!isFinite(n) || n <= 0) return String(v);
    return '$ ' + n.toLocaleString('es-CO', { maximumFractionDigits: 0 });
  }

  private corto(v: string | undefined | null, max: number): string {
    const s = (v || '').trim();
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  private limpiarNombreArchivo(s: string): string {
    // \u0300-\u036f = marcas diacriticas que deja NFD (asi "Munoz" no queda "Mu_oz").
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
      .slice(0, 90);
  }

}
