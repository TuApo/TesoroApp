import {  Component, OnInit , ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { PaymentsService } from '../../services/payments.service';
import { SharedModule } from '@/app/shared/shared.module';

import Swal from 'sweetalert2';
import * as XLSX from 'xlsx';
import { FormsModule } from '@angular/forms';
import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';
import { ColumnDefinition } from '@/app/shared/models/advanced-table-interface';
import { StandardFilterTable } from '@/app/shared/components/standard-filter-table/standard-filter-table';
import { environment } from '@/environments/environment';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-pay-slips',
  standalone: true,
  imports: [
    SharedModule,
    FormsModule,
    StandardFilterTable
  ],
  templateUrl: './pay-slips.component.html',
  styleUrl: './pay-slips.component.css'
} )

export class PaySlipsComponent implements OnInit {
  cedula: string = '';

  // Definición de columnas para la tabla estándar
  columns: ColumnDefinition[] = [
    { name: 'no', header: 'No', type: 'text', filterable: true },
    { name: 'cedula', header: 'Cédula', type: 'text', filterable: true },
    { name: 'nombre', header: 'Nombre', type: 'text', filterable: true },
    { name: 'ingreso', header: 'Ingreso', type: 'text', filterable: true },
    { name: 'retiro', header: 'Retiro', type: 'text', filterable: true },
    { name: 'finca', header: 'Finca', type: 'text', filterable: true },
    { name: 'telefono', header: 'Teléfono', type: 'text', filterable: true },
    { name: 'concepto', header: 'Concepto', type: 'text', filterable: true },
    // Columnas con prefijo 'type_' para usar template personalizado (links)
    { name: 'type_desprendibles', header: 'Desprendibles', type: 'text', filterable: false },
    { name: 'type_certificaciones', header: 'Certificaciones', type: 'text', filterable: false },
    { name: 'type_cartas_retiro', header: 'Cartas Retiro', type: 'text', filterable: false },
    { name: 'type_carta_cesantias', header: 'Carta Cesantías', type: 'text', filterable: false },
    { name: 'type_entrevista_retiro', header: 'Entrevista Retiro', type: 'text', filterable: false },
    { name: 'correo', header: 'Correo', type: 'text', filterable: true },
    { name: 'confirmacion_envio', header: 'Confirmación Envío', type: 'text', filterable: true }
  ];

  dataList: any[] = [];



  user: any
  correo: any;

  /** Correos autorizados para gestionar (descargar/cargar) desprendibles. */
  private readonly correosGestionDesprendibles = new Set<string>([
    'nominacentral4@gmail.com',
    'nomina.rtc@gmail.com',
    'programador.ts@gmail.com',
    'nomina.gandes@gmail.com',
    'nominacentral7@gmail.com',
    'antcontable4.ts@gmail.com',
    'nominacentral6@gmail.com',
    'nominacentral9@gmail.com',
  ]);

  /** true si el usuario puede descargar/cargar desprendibles. */
  get puedeGestionarDesprendibles(): boolean {
    return this.correosGestionDesprendibles.has(this.correo);
  }

  claves = ["No", "Cedula", "Nombre", "Ingreso",
    "Retiro", "Finca", "Telefono", "CONCEPTO",
    "Desprendibles", "Certificaciones", "Cartas_Retiro",
    "Carta_Cesantias", "Entrevista_Retiro", "Correo",
    "Confirmacion_Envio"];

  constructor(
    private paymentsService: PaymentsService,
    private utilityService: UtilityServiceService,
    private cdr: ChangeDetectorRef,
  ) { }

  async ngOnInit(): Promise<void> {
    this.user = await this.utilityService.getUser();
    if (this.user) {
      this.correo = this.user.correo_electronico;
    }
  }

  // isValidLink se usa en el HTML ahora
  isValidLink(url: string): boolean {
    return typeof url === 'string' && url.startsWith('https://');
  }

  // ── Documentos internos (sustituyen al enlace de Drive) ───────────────────

  /**
   * id de la fila de desprendibles → documentos ya migrados a gestión
   * documental para esa quincena.
   *
   * El emparejamiento fila↔documento lo hace ms-payroll por quincena canónica,
   * no aquí: la hoja escribe "Nom. 01 al 15 de Agosto de 2026" y la carpeta
   * "pdf NOMINA 1Q AGOSTO 2026", y reconciliarlas en TypeScript sería duplicar
   * el parser del backend y acabar divergiendo.
   */
  private documentosPorFila = new Map<number, any[]>();

  /** Qué tipo documental corresponde a cada columna de la tabla. */
  private static readonly TIPO_POR_COLUMNA: Record<string, string[]> = {
    type_desprendibles: ['DESPRENDIBLE', 'LIQUIDACION', 'NOMINA'],
    type_certificaciones: ['CERTIFICACION'],
    type_cartas_retiro: ['CARTA_RETIRO'],
    type_carta_cesantias: ['CESANTIAS'],
    type_entrevista_retiro: ['ENTREVISTA'],
  };

  private cargarDocumentosInternos(cedula: string): void {
    this.paymentsService.historialPersonaConDocumentos(cedula).subscribe((resp: any) => {
      this.documentosPorFila.clear();
      for (const fila of resp?.content ?? []) {
        if (fila?.id != null && (fila.documentos?.length ?? 0) > 0) {
          this.documentosPorFila.set(fila.id, fila.documentos);
        }
      }
      this.cdr.markForCheck();
    });
  }

  /** Documento interno de esa fila y columna, o null si aún no se ha migrado. */
  documentoInterno(row: any, columna: string): any | null {
    const docs = this.documentosPorFila.get(row?.id);
    if (!docs?.length) return null;
    const prefijos = PaySlipsComponent.TIPO_POR_COLUMNA[columna] ?? [];
    return docs.find((d: any) =>
      prefijos.some((p) => (d?.type_name ?? '').toUpperCase().includes(p))) ?? null;
  }

  /**
   * Abre el documento interno.
   *
   * No vale `window.open(url)`: `/api/v1/documents/**` exige JWT en el gateway
   * y una navegación directa responde 401 — el documento no abre nunca. Se baja
   * por HttpClient (el authInterceptor pone el token) y se abre desde un object
   * URL local.
   */
  abrirDocumentoInterno(doc: any): void {
    if (!doc?.document_id) return;
    this.paymentsService.descargarDocumento(doc.document_id).subscribe({
      next: (blob: Blob) => {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank', 'noopener');
        // Se revoca con holgura: si se libera al instante, la pestaña nueva
        // puede no haber terminado de leerlo.
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      },
      error: () => Swal.fire({
        icon: 'error', title: 'Error',
        text: 'No se pudo abrir el documento.',
      }),
    });
  }


  public buscarDesprendibles(cedula: string): void {
    // Mantener la primera letra (si existe) y limpiar el resto
    let cleanedCedula: string;

    if (/^[A-Za-z]/.test(cedula)) {
      cleanedCedula = cedula[0].toUpperCase() + cedula.slice(1).replace(/[^\d]/g, '');
    } else {
      cleanedCedula = cedula.replace(/[^\d]/g, '');
    }

    // Convertir todo en mayúsculas
    cleanedCedula = cleanedCedula.toUpperCase();

    if (!cleanedCedula) {
      Swal.fire({
        icon: 'info',
        title: 'Información',
        text: 'Ingresa un número de cédula válido para buscar.'
      });
      return;
    }

    // Modal de carga mientras se consulta la información.
    Swal.fire({
      title: 'Buscando información...',
      text: 'Por favor espera un momento.',
      icon: 'info',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      }
    });

    this.paymentsService.buscarDesprendibles(cleanedCedula).subscribe(
      (response: any) => {
        // El backend puede responder con un array directo [...] o con un
        // objeto { desprendibles: [...] }. Normalizamos a un array siempre
        // para no romper si la cédula no existe (antes lanzaba
        // "Cannot read properties of undefined (reading 'sort')").
        const lista: any[] = Array.isArray(response)
          ? response
          : Array.isArray(response?.desprendibles)
            ? response.desprendibles
            : [];

        if (lista.length === 0) {
          this.dataList = [];
          this.cdr.markForCheck();
          Swal.fire({
            icon: 'info',
            title: 'Información',
            text: 'No se encontraron desprendibles para la cédula ingresada'
          });
          return;
        }

        const desprendibles = [...lista]
          .sort((a: any, b: any) => (b?.id ?? 0) - (a?.id ?? 0));

        // Mapear datos para las columnas type_
        this.dataList = desprendibles.map((item: any) => ({
          ...item,
          type_desprendibles: item.desprendibles,
          type_certificaciones: item.certificaciones,
          type_cartas_retiro: item.cartas_retiro,
          type_carta_cesantias: item.carta_cesantias,
          type_entrevista_retiro: item.entrevista_retiro
        }));
        // Enriquecer con los documentos ya migrados a gestión documental. Va
        // aparte y sin bloquear: si falla, la tabla queda con los enlaces de
        // Drive, igual que antes.
        this.cargarDocumentosInternos(cleanedCedula);
        // OnPush: la respuesta llega async; hay que marcar para que se
        // renderice sin necesidad de un segundo click.
        this.cdr.markForCheck();
        Swal.close();
      },
      (error: any) => {
        // Algunas versiones del backend responden 404 cuando no hay registros;
        // eso no es un error real, es "no encontrado".
        if (error?.status === 404) {
          this.dataList = [];
          this.cdr.markForCheck();
          Swal.fire({
            icon: 'info',
            title: 'Información',
            text: 'No se encontraron desprendibles para la cédula ingresada'
          });
          return;
        }
        Swal.fire({
          icon: 'error',
          title: 'Error',
          text: 'Ha ocurrido un error al buscar la información'
        });
      }
    );
  }


  triggerFileInput(tipo: 'desprendibles' | 'correos'): void {
    const id = tipo === 'desprendibles' ? 'fileInput' : 'fileInputEmails';
    const fileInput = document.getElementById(id) as HTMLInputElement | null;
    if (fileInput) {
      fileInput.value = ''; // reinicia para permitir recargar el mismo archivo
      fileInput.click();
    }
  }

  descargarPlantillaDesprendibles(): void {
    try {
      const headers = [...this.claves];
      const ws = XLSX.utils.aoa_to_sheet([headers]);
      ws['!cols'] = headers.map(h => ({ wch: Math.max(12, h.length + 2) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Desprendibles');
      const fileName = `Plantilla_Desprendibles_${new Date().toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(wb, fileName, { bookType: 'xlsx', compression: true });
    } catch (e) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'No se pudo generar la plantilla. Inténtalo nuevamente.'
      });
    }
  }

  descargarPlantillaCorreos(): void {
    try {
      const headers = ['Cedula', 'Correo'];
      const example = ['1010101010', 'ejemplo@dominio.com'];
      const ws = XLSX.utils.aoa_to_sheet([headers, example]);
      ws['!cols'] = [{ wch: 18 }, { wch: 32 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Correos');
      const fileName = `Plantilla_Correos_${new Date().toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(wb, fileName, { bookType: 'xlsx', compression: true });
    } catch (e) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'No se pudo generar la plantilla. Inténtalo nuevamente.'
      });
    }
  }

  cargarExcel(event: any): void {
    const file = event.target.files[0];
    const reader = new FileReader();

    // Mostrar modal de carga
    Swal.fire({
      title: 'Procesando archivo...',
      text: 'Por favor espera mientras se carga la información.',
      icon: 'info',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      }
    });

    reader.onload = (e: any) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true, cellNF: false, cellText: false });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: "dd/mm/yyyy" });

        const modifiedRows = this.asignarClaves(rows);

        // Validar que tenga exactamente 15 columnas
        if (
          modifiedRows.length === 0 ||
          Object.keys(modifiedRows[0]).length !== 15
        ) {
          Swal.fire({
            icon: 'error',
            title: 'Error de formato',
            text: 'El archivo no tiene el formato correcto. Verifique que tenga exactamente 15 columnas válidas.'
          });
          return;
        }

        // Eliminar fila de encabezados
        modifiedRows.shift();

        this.resetFileInput('fileInput');

        this.paymentsService.subirExcelDesprendibles(modifiedRows).then((response: any) => {
          if (response.message === 'success') {
            Swal.fire({
              icon: 'success',
              title: 'Éxito',
              text: 'Los datos han sido cargados correctamente.'
            });
          } else {
            Swal.fire({
              icon: 'error',
              title: 'Error',
              text: 'Ocurrió un problema al cargar los datos. Inténtalo nuevamente.'
            });
          }
        }).catch((error: any) => {
          Swal.fire({
            icon: 'error',
            title: 'Error inesperado',
            text: 'Ha ocurrido un error durante la carga del archivo.'
          });
        });
      } catch (error) {
        Swal.fire({
          icon: 'error',
          title: 'Error de lectura',
          text: 'No se pudo procesar el archivo. Asegúrese de que sea un archivo válido.'
        });
      }
    };
    reader.readAsArrayBuffer(file);
  }


  asignarClaves(data: any[]): any[] {
    return data.map((row: any) => {
      let modifiedRow: any = {};
      this.claves.forEach((clave: string, index: number) => {
        modifiedRow[clave] = row[index] !== undefined && row[index] !== null ? row[index] : '-';
      });
      return modifiedRow;
    });
  }

  resetFileInput(id: 'fileInput' | 'fileInputEmails'): void {
    const input = document.getElementById(id) as HTMLInputElement | null;
    if (input) input.value = '';
  }



  // ============================================
  // NUEVO: CARGA MASIVA DE CORREOS (FILA 2 = DATA)
  // ============================================
  cargarCorreosMasivos(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];

    const validExtensions = ['xlsx', 'xls'];
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !validExtensions.includes(ext)) {
      Swal.fire({ icon: 'error', title: 'Archivo no válido', text: 'Selecciona un Excel (.xlsx o .xls)' });
      input.value = '';
      return;
    }

    Swal.fire({
      title: 'Leyendo Excel...',
      html: 'Procesando correos y cédulas desde la fila 2.',
      icon: 'info',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const wb = XLSX.read(new Uint8Array(reader.result as ArrayBuffer), { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

        if (!rows.length || rows.length < 2) {
          Swal.fire({ icon: 'error', title: 'Sin datos', text: 'El archivo debe tener encabezados en la fila 1 y datos desde la fila 2.' });
          return;
        }

        // Detectar columnas por encabezado (flexible) o fallback [0]=cedula, [1]=correo
        const headers = rows[0].map((h: any) => String(h || '').toLowerCase().trim());
        const cedCandidates = ['cedula', 'cédula', 'documento', 'doc', 'numero de documento', 'numerodeceduladepersona', 'num_doc'];
        const mailCandidates = ['correo', 'email', 'e-mail', 'primercorreoelectronico'];

        const findIndex = (list: string[]) => {
          for (const key of list) {
            const idx = headers.findIndex(h => h === key || h.includes(key));
            if (idx !== -1) return idx;
          }
          return -1;
        };

        let cedIdx = findIndex(cedCandidates);
        let mailIdx = findIndex(mailCandidates);

        if (cedIdx === -1 || mailIdx === -1) {
          // fallback simple si no hay encabezados claros
          cedIdx = 0;
          mailIdx = 1;
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

        const seen = new Map<string, string>(); // doc -> email (último valor gana)
        const invalidRows: number[] = [];
        const invalidEmails: Array<{ row: number, email: string }> = [];
        const incompleteRows: number[] = [];

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i] || [];
          const rawDoc = String(row[cedIdx] ?? '').replace(/\u00A0/g, '').trim();
          const rawMail = String(row[mailIdx] ?? '').trim();

          const emptyRow = !rawDoc && !rawMail;
          if (emptyRow) continue; // salta filas vacías

          if (!rawDoc || !rawMail) {
            incompleteRows.push(i + 1); // +1 por base 1 de Excel
            continue;
          }
          if (!emailRegex.test(rawMail)) {
            invalidEmails.push({ row: i + 1, email: rawMail });
            continue;
          }
          // Guarda (último valor gana)
          seen.set(rawDoc, rawMail);
        }

        const payload = Array.from(seen.entries()).map(([numerodeceduladepersona, primercorreoelectronico]) => ({
          numerodeceduladepersona,
          primercorreoelectronico
        }));

        if (!payload.length) {
          Swal.fire({
            icon: 'error',
            title: 'Nada para enviar',
            html: 'No se encontraron filas válidas.<br>Revisa encabezados y datos desde la fila 2.'
          });
          this.resetFileInput('fileInputEmails');
          return;
        }

        // Confirmación previa con resumen
        const resumenHtml = `
          <div style="text-align:left">
            <p><b>Registros válidos:</b> ${payload.length}</p>
            ${invalidRows.length ? `<p><b>Filas inválidas (formato):</b> ${invalidRows.join(', ')}</p>` : ''}
            ${incompleteRows.length ? `<p><b>Filas incompletas (faltan columnas):</b> ${incompleteRows.join(', ')}</p>` : ''}
            ${invalidEmails.length ? `<p><b>Correos no válidos:</b> ${invalidEmails.map(i => `F${i.row}(${i.email})`).join(', ')}</p>` : ''}
          </div>
        `;
        Swal.fire({
          title: '¿Enviar actualización masiva?',
          html: resumenHtml,
          icon: 'question',
          showCancelButton: true,
          confirmButtonText: 'Sí, enviar',
          cancelButtonText: 'Cancelar'
        }).then((res) => {
          if (!res.isConfirmed) {
            this.resetFileInput('fileInputEmails');
            return;
          }

          Swal.fire({
            title: 'Actualizando correos...',
            html: 'Procesando en el servidor.',
            icon: 'info',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
          });

          this.paymentsService.actualizarCorreosMasivos(payload)
            .then((response: any) => {
              // El backend devuelve summary y details (según lo que hicimos)
              const s = response?.summary || {};
              const d = response?.details || {};
              const html = `
                <div style="text-align:left">
                  <p><b>Recibidos:</b> ${s.received ?? '-'}</p>
                  <p><b>Documentos únicos:</b> ${s.unique_docs ?? '-'}</p>
                  <p><b>Actualizados:</b> ${s.updated ?? '-'}</p>
                  <p><b>Sin cambio:</b> ${s.unchanged ?? '-'}</p>
                  <p><b>No encontrados:</b> ${s.not_found ?? '-'}</p>
                  <p><b>Duplicados en archivo:</b> ${s.duplicates_in_payload ?? '-'}</p>
                </div>`;
              Swal.fire({ icon: 'success', title: 'Actualización completada', html });
            })
            .catch((err: any) => {
              const msg = err?.error?.detail || 'Error al actualizar correos.';
              Swal.fire({ icon: 'error', title: 'Error', text: msg });
            })
            .finally(() => this.resetFileInput('fileInputEmails'));
        });

      } catch (e) {
        Swal.fire({ icon: 'error', title: 'Error de lectura', text: 'No se pudo procesar el archivo Excel.' });
        this.resetFileInput('fileInputEmails');
      }
    };

    reader.readAsArrayBuffer(file);
  }

}
