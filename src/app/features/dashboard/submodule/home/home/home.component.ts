import {  Component, ElementRef, OnInit, ViewChild , ChangeDetectionStrategy } from '@angular/core';

import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';

import Swal from 'sweetalert2';
import * as XLSX from 'xlsx';
// El dibujo del carnet es UNO SOLO, compartido con la generación individual de
// Contratación. Antes había una copia inline acá y las correcciones no llegaban
// a los dos lados.
import {
  ARL_ALIANZA,
  CarnetMasivoRow,
  TELEFONO_COORDINADOR_ALIANZA,
  buildCarnetsMasivoPdf,
} from '../../hiring/components/generate-contracting-documents/carnet-masivo-fill';
import { leerImpresion } from '../../hiring/components/generate-contracting-documents/carnet-impresion';
import { UtilityServiceService } from '../../../../../shared/services/utilityService/utility-service.service';
import { MerchandisingMerchandiseComponent } from '../components/merchandising-merchandise/merchandising-merchandise.component';
import { MigrationPanelComponent } from '../components/migration-panel/migration-panel.component';
import { InfoCardComponent } from '@/app/shared/components/info-card/info-card.component';
import { HomeDashboardComponent } from '../components/home-dashboard/home-dashboard.component';
import {
  HomeService,
  PdfKey,
  ProgresoRow,
  ProgresoPrioridadesAllResponse,
} from '../service/home.service';
import { DateRangeDialogComponent } from '@/app/shared/components/date-rang-dialog/date-rang-dialog.component';
import { ColumnDefinition } from '../../../../../shared/models/advanced-table-interface';
import * as fontkit from 'fontkit';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFImage, PDFPage, PDFName } from 'pdf-lib';
import { firstValueFrom, from, of } from 'rxjs';
import { concatMap, reduce, catchError } from 'rxjs/operators';

type PdfOption = { key: PdfKey; label: string };
import JSZip from 'jszip';
import QRCode from 'qrcode';

type ProgresoTipoPrioridadRow = {
  pdf: PdfKey;
  tipo: string;
  prioridad: string;
  llevas: number;
  faltan: number;
  total: number;
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-home',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatIconModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatTooltipModule,
    MatSelectModule,
    MerchandisingMerchandiseComponent,
    MigrationPanelComponent,
    InfoCardComponent,
    HomeDashboardComponent,
],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css'],
} )
export class HomeComponent implements OnInit {
  user: any;

  general = false;
  comercializadora = false;
  admin = false;
  traslado = false;

  isSidebarHidden = false;
  personaContratacion = '';

  // Header
  nombreUsuario = '';
  fechaHoy = '';

  // Slide panel
  activePanel: 'robots' | 'reportes' | 'contratacion' | 'migracion' | null = null;
  private readonly panelTitles: Record<string, string> = {
    robots: 'Robots',
    reportes: 'Reportes',
    contratacion: 'Contratación',
    migracion: 'Migración gestion_documental',
  };
  get panelTitle(): string {
    return this.activePanel ? this.panelTitles[this.activePanel] ?? '' : '';
  }

  openPanel(panel: 'robots' | 'reportes' | 'contratacion' | 'migracion'): void {
    this.activePanel = panel;
  }

  closePanel(): void {
    this.activePanel = null;
  }

  // ViewChild refs for file inputs
  @ViewChild('fileInput') fileInputRef!: ElementRef<HTMLInputElement>;
  @ViewChild('fileInputSoloActualizar') fileInputSoloActualizarRef!: ElementRef<HTMLInputElement>;
  @ViewChild('fileInputResetContratado') fileInputResetRef!: ElementRef<HTMLInputElement>;
  @ViewChild('fileInputExcelCandidatos') fileInputCandidatosRef!: ElementRef<HTMLInputElement>;
  @ViewChild('fileInputCarnets') fileInputCarnetsRef!: ElementRef<HTMLInputElement>;
  @ViewChild('fileInputLimpiarExcel') fileInputLimpiarExcelRef!: ElementRef<HTMLInputElement>;
  @ViewChild('fileInputAdresCedulas') fileInputAdresCedulasRef!: ElementRef<HTMLInputElement>;
  @ViewChild('fileInputAdresCedulasActualizar') fileInputAdresCedulasActualizarRef!: ElementRef<HTMLInputElement>;
  @ViewChild('fileInputSoloActualizarAntecedentes') fileInputSoloActualizarAntecedentesRef!: ElementRef<HTMLInputElement>;
  @ViewChild('fileInputAntecedentesCedulas') fileInputAntecedentesCedulasRef!: ElementRef<HTMLInputElement>;
  @ViewChild('fileInputAntecedentesCedulasActualizar') fileInputAntecedentesCedulasActualizarRef!: ElementRef<HTMLInputElement>;

  // Las 4 fuentes de antecedentes que se re-consultan juntas. El backend las
  // mapea a estado_policivo/estado_procuraduria/estado_contraloria/estado_ofac
  // y deja las otras 4 fuentes en FINALIZADO (los robots no las pickean).
  private readonly FUENTES_ANTECEDENTES = ['policivo', 'procuraduria', 'contraloria', 'ofac'];

  // El backend responde los estado_* que forzó; esto es solo para el resumen.
  private readonly ETIQUETA_FUENTE: Record<string, string> = {
    estado_adress: 'ADRES',
    estado_policivo: 'Policivos',
    estado_procuraduria: 'Procuraduria',
    estado_contraloria: 'Contraloria',
    estado_ofac: 'OFAC',
    estado_sisben: 'Sisben',
    estado_fondo_pension: 'Fondo de pension',
    estado_medidas_correctivas: 'Medidas correctivas',
  };

  // Progreso
  isLoadingProgresoAll = false;
  totalRegistros = 0;
  progreso: ProgresoRow[] = [];
  progresoColumns: ColumnDefinition[] = [];
  currentPdfLabel = '—';

  paqueteCtrl = new FormControl<string>('', { nonNullable: true });
  paquetes: string[] = [];

  private readonly HEADER_ALIASES: Record<string, string[]> = {
    Identificación: [
      'identificación',
      'identificacion',
      'cédula',
      'cedula',
      'documento',
      'numero_documento',
      'número de documento',
      'numero de documento',
      'id',
    ],
    'Tipo documento': ['tipo documento', 'tipo_documento', 'tipo doc', 'tipo'],
    PAQUETE: ['paquete', 'oficina', 'sede'],
    'Nombre Y Apellidos': [
      'nombre y apellidos',
      'nombres y apellidos',
      'nombre y apellido',
      'nombres y apellido',
    ],
    'Primer Nombre': ['primer nombre', 'pn'],
    'Segundo Nombre': ['segundo nombre', 'sn'],
    'Primer Apellido': ['primer apellido', 'pa'],
    'Segundo Apellido': ['segundo apellido', 'sa'],
    // Columna opcional de la imagen de referencia (ej. "ADRESS"). El backend la
    // lee vía DOCS_FALTANTES_KEYS; la registramos aquí para no depender del
    // passthrough de headers desconocidos. En modo "solo actualizar" el backend
    // la ignora y fuerza ADRES-only de todos modos.
    'Documentación faltante': [
      'documentación faltante',
      'documentacion faltante',
      'documentación_faltante',
      'documentacion_faltante',
      'documentos faltantes',
      'docs faltantes',
      'docs_faltantes',
      'faltantes',
      'pendientes',
      'pendiente',
    ],
  };

  constructor(
    private utilityService: UtilityServiceService,
    private homeService: HomeService,
    private dialog: MatDialog,
  ) { }

  ngOnInit(): void {
    this.initializeUserRoles();

    this.nombreUsuario = this.getNombreUsuario() || 'Usuario';
    this.fechaHoy = new Date().toLocaleDateString('es-CO', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    // Capitalize first letter
    this.fechaHoy = this.fechaHoy.charAt(0).toUpperCase() + this.fechaHoy.slice(1);

    if (!this.personaContratacion.trim()) {
      this.personaContratacion = this.nombreUsuario;
    }
  }

  private initializeUserRoles(): void {
    this.user = this.utilityService.getUser();

    const rol = this.user?.rol?.nombre ?? 'SIN-ASIGNAR';
    const correo = (this.user?.correo_electronico ?? '').toString().toLowerCase();

    if (!this.user || rol === 'SIN-ASIGNAR') {
      this.general = false;
      this.comercializadora = false;
      this.traslado = false;
      this.admin = false;
      return;
    }

    const isAdmin = rol === 'ADMIN';
    const isGerencia = rol === 'GERENCIA';
    const isTraslados = rol === 'TRASLADOS';
    const isComercial = rol === 'COMERCIALIZADORA';
    const isAliasTuAfiliacion = correo === 'tuafiliacion@tsservicios.co';

    this.general = !isTraslados;
    this.comercializadora = isComercial || isAdmin || isGerencia || isAliasTuAfiliacion;
    this.traslado = isTraslados || isAdmin || isGerencia || isAliasTuAfiliacion;
    this.admin = isGerencia || isAdmin;
  }

  // =========================================================
  // HISTORIAL BENEFICIOS
  // =========================================================
  extraerHistorialBeneficios(): void {
    this.dialog
      .open(DateRangeDialogComponent, {
        width: '400px',
        data: { title: 'Seleccionar rango de fechas' },
      })
      .afterClosed()
      .subscribe((result) => {
        if (!result) return;

        const { start, end } = result;

        this.homeService.traerHistorialInformeSoloFecha(start, end, true).subscribe({
          next: (blob) =>
            this.downloadBlob(blob, `historial_beneficios_${start}_a_${end}.xlsx`),
        });
      });
  }

  // =========================================================
  // DESCARGAR ADRES POR CEDULAS (sube Excel con cedulas)
  // Lee el archivo, extrae cedulas, las manda al backend y descarga el
  // Excel ADRES profesional con la informacion de cada una.
  // =========================================================
  triggerFileInputAdresCedulas(): void {
    const el = this.fileInputAdresCedulasRef?.nativeElement;
    if (!el) return;
    el.value = '';
    el.click();
  }

  // Extracción "modo actualizar": el PDF del Excel apunta a la ÚLTIMA versión
  // (la que el robot guardó como NO vigente bajo solo_actualizar).
  triggerFileInputAdresCedulasActualizar(): void {
    const el = this.fileInputAdresCedulasActualizarRef?.nativeElement;
    if (!el) return;
    el.value = '';
    el.click();
  }

  // Antecedentes (policivos + procuraduría + contraloría + OFAC): mismo flujo
  // que ADRES, un Excel con las 4 fuentes y una columna de PDF por fuente.
  triggerFileInputAntecedentesCedulas(): void {
    const el = this.fileInputAntecedentesCedulasRef?.nativeElement;
    if (!el) return;
    el.value = '';
    el.click();
  }

  triggerFileInputAntecedentesCedulasActualizar(): void {
    const el = this.fileInputAntecedentesCedulasActualizarRef?.nativeElement;
    if (!el) return;
    el.value = '';
    el.click();
  }

  descargarAdressPorCedulasDesdeExcel(evt: any): Promise<void> {
    return this._descargarPorCedulas(evt, false, 'adres');
  }

  descargarAdressPorCedulasActualizarDesdeExcel(evt: any): Promise<void> {
    return this._descargarPorCedulas(evt, true, 'adres');
  }

  descargarAntecedentesPorCedulasDesdeExcel(evt: any): Promise<void> {
    return this._descargarPorCedulas(evt, false, 'antecedentes');
  }

  descargarAntecedentesPorCedulasActualizarDesdeExcel(evt: any): Promise<void> {
    return this._descargarPorCedulas(evt, true, 'antecedentes');
  }

  private async _descargarPorCedulas(
    evt: any,
    modoActualizar: boolean,
    fuente: 'adres' | 'antecedentes',
  ): Promise<void> {
    const esAdres = fuente === 'adres';
    const etiqueta = esAdres ? 'ADRES' : 'ANTECEDENTES';
    const input = evt?.target as HTMLInputElement;
    const file: File | undefined = input?.files?.[0];

    if (!file) {
      await Swal.fire({ icon: 'error', title: 'Selecciona un archivo' });
      return;
    }

    Swal.fire({
      title: 'Leyendo Excel...',
      text: 'Extrayendo cedulas del archivo.',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    });

    try {
      const cedulas = await this.extraerCedulasDesdeExcel(file);

      if (!cedulas.length) {
        Swal.close();
        await Swal.fire({
          icon: 'warning',
          title: 'Sin cedulas',
          text: 'No se encontraron cedulas validas en el Excel.',
        });
        return;
      }

      Swal.update({
        title: `Generando Excel ${etiqueta}...`,
        text: `Consultando ${cedulas.length} cedulas en el servidor.`,
      });
      Swal.showLoading();

      const req = esAdres
        ? (modoActualizar
            ? this.homeService.descargarAdressPorCedulasActualizar(cedulas)
            : this.homeService.descargarAdressPorCedulas(cedulas))
        : (modoActualizar
            ? this.homeService.descargarAntecedentesPorCedulasActualizar(cedulas)
            : this.homeService.descargarAntecedentesPorCedulas(cedulas));

      const res = await firstValueFrom(req);
      const total = res.headers.get('X-Total-Rows');

      if (!res.body || res.body.size === 0) {
        Swal.close();
        await Swal.fire({
          icon: 'info',
          title: 'Sin coincidencias',
          text: `Ninguna de las cedulas tiene registro de ${etiqueta} en la BD.`,
        });
        return;
      }

      const prefijo = esAdres
        ? (modoActualizar ? 'adres_actualizar_por_cedulas' : 'adres_por_cedulas')
        : (modoActualizar ? 'antecedentes_actualizar_por_cedulas' : 'antecedentes_por_cedulas');
      const filename =
        this.getFilenameFromResponse(res) || `${prefijo}_${cedulas.length}.xlsx`;
      await this.saveToDownloads(res.body, filename);

      Swal.close();
      await Swal.fire({
        icon: 'success',
        title: 'Excel descargado',
        html: `Cedulas en archivo: <b>${cedulas.length}</b><br>` +
              `Encontradas con datos: <b>${total ?? '?'}</b><br>` +
              `Archivo: <code>${filename}</code>`,
      });
    } catch (err: any) {
      Swal.close();
      const msg =
        err?.error?.detail ||
        err?.message ||
        (err?.status === 0 ? 'Red/CORS: no se pudo contactar el servidor.' : 'No se pudo generar el Excel.');
      await Swal.fire({ icon: 'error', title: 'Error', text: msg });
    } finally {
      try { input.value = ''; } catch { }
    }
  }

  // =========================================================
  // DESCARGAR ADRES POR RANGO
  // Abre el date-range-dialog y descarga un Excel profesional con todas las
  // personas cuyo marca_temporal_adress cae dentro del rango seleccionado.
  // =========================================================
  descargarAdressPorRango(): void {
    this.dialog
      .open(DateRangeDialogComponent, {
        width: '420px',
        data: { title: 'Rango de fechas - ADRES' },
      })
      .afterClosed()
      .subscribe((result) => {
        if (!result || !result.start || !result.end) return;

        const { start, end } = result;

        Swal.fire({
          title: 'Generando Excel ADRES...',
          html: `Rango: <b>${start}</b> &rarr; <b>${end}</b><br>Consultando base de datos.`,
          allowOutsideClick: false,
          allowEscapeKey: false,
          didOpen: () => Swal.showLoading(),
        });

        this.homeService.descargarAdressPorRango(start, end).subscribe({
          next: async (res) => {
            const total = res.headers.get('X-Total-Rows');

            if (!res.body || res.body.size === 0) {
              Swal.close();
              await Swal.fire({
                icon: 'info',
                title: 'Sin registros',
                text: 'No se encontraron personas con marca_temporal_adress en ese rango.',
              });
              return;
            }

            const filename = this.getFilenameFromResponse(res) || `adres_${start}_a_${end}.xlsx`;
            await this.saveToDownloads(res.body, filename);

            Swal.close();
            await Swal.fire({
              icon: 'success',
              title: 'Excel descargado',
              html: `Filas: <b>${total ?? '?'}</b><br>Archivo: <code>${filename}</code>`,
            });
          },
          error: async (err) => {
            Swal.close();
            const msg =
              err?.error?.detail ||
              err?.message ||
              (err?.status === 0 ? 'Red/CORS: no se pudo contactar el servidor.' : 'No se pudo generar el Excel.');
            await Swal.fire({ icon: 'error', title: 'Error', text: msg });
          },
        });
      });
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  private async saveToDownloads(blob: Blob, filename: string): Promise<void> {
    const ext = (filename.split('.').pop() || '').toLowerCase();
    const mime =
      ext === 'zip'
        ? 'application/zip'
        : ext === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'application/octet-stream';

    try {
      // @ts-ignore
      if (window.showSaveFilePicker) {
        // @ts-ignore
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          startIn: 'downloads',
          types: [{ description: ext.toUpperCase(), accept: { [mime]: ['.' + ext] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      }
    } catch (_) { }

    this.downloadBlob(blob, filename);
  }

  private normalizeKey(s: string): string {
    return (s || '')
      .replace(/\u00a0|\u2007|\u202f/g, ' ')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  private toCanonical(h: string): string {
    const nk = this.normalizeKey(String(h || ''));
    for (const canonical of Object.keys(this.HEADER_ALIASES)) {
      const aliases = this.HEADER_ALIASES[canonical].map((a) => this.normalizeKey(a));
      if (aliases.includes(nk) || this.normalizeKey(canonical) === nk) return canonical;
    }
    return String(h || '').trim();
  }

  // Cargar solicitudes robots (Excel)
  triggerFileInput(): void {
    const el = this.fileInputRef?.nativeElement;
    if (!el) return;
    el.value = '';
    el.click();
  }

  // Botón "solo actualizar ADRES": misma carga, pero los PDFs que produzca el
  // robot NO se vuelven la versión vigente (las consultas siguen mostrando la
  // anterior). El backend solo deja ADRES en SIN_CONSULTAR.
  triggerFileInputSoloActualizar(): void {
    const el = this.fileInputSoloActualizarRef?.nativeElement;
    if (!el) return;
    el.value = '';
    el.click();
  }

  // Botón "solo actualizar antecedentes": igual que el de ADRES pero acotado a
  // policivos + procuraduría + contraloría + OFAC.
  triggerFileInputSoloActualizarAntecedentes(): void {
    const el = this.fileInputSoloActualizarAntecedentesRef?.nativeElement;
    if (!el) return;
    el.value = '';
    el.click();
  }

  cargarExcel(evt: any): void {
    this._procesarExcelEstados(evt, false);
  }

  cargarExcelSoloActualizar(evt: any): void {
    this._procesarExcelEstados(evt, true);
  }

  cargarExcelSoloActualizarAntecedentes(evt: any): void {
    this._procesarExcelEstados(evt, true, this.FUENTES_ANTECEDENTES);
  }

  private _procesarExcelEstados(evt: any, soloActualizar: boolean, soloFuentes?: string[]): void {
    const file: File | undefined = evt?.target?.files?.[0];
    if (!file) {
      void Swal.fire({ icon: 'error', title: 'Selecciona un archivo' });
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e: any) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });

        if (!rows.length) {
          void Swal.fire({ icon: 'error', title: 'Archivo vacío' });
          return;
        }

        const headerRow = (rows[0] || []).map((h) => String(h || ''));
        const canonicalHeaders = headerRow.map((h) => this.toCanonical(h));

        if (!canonicalHeaders.some((h) => h === 'Identificación')) {
          void Swal.fire({
            icon: 'error',
            title: 'Formato incorrecto',
            text: 'Falta la columna "Identificación".',
          });
          return;
        }

        const datos = rows
          .slice(1)
          .map((r) => {
            const o: any = {};
            canonicalHeaders.forEach((key, idx) => {
              if (!key) return;
              const val = r[idx];
              const sv = val === null || val === undefined ? '' : String(val).trim();
              if (sv !== '') o[key] = sv;
            });
            return o;
          })
          .filter((o) => !!o && typeof o === 'object' && String(o['Identificación'] || '').trim() !== '');

        if (!datos.length) {
          void Swal.fire({
            icon: 'warning',
            title: 'No hay filas válidas',
            text: 'Todas las filas carecen de Identificación.',
          });
          return;
        }

        datos.forEach((o) => {
          if (!o['Tipo documento']) o['Tipo documento'] = 'CC';
        });

        const payload: {
          candidatos_scope: 'nuevos' | 'todos' | 'ninguno';
          datos: any[];
          solo_actualizar?: boolean;
          solo_fuentes?: string[];
        } = {
          candidatos_scope: 'nuevos',
          datos,
        };
        if (soloActualizar) payload.solo_actualizar = true;
        // Sin solo_fuentes el backend mantiene el histórico: ADRES-only.
        if (soloFuentes?.length) payload.solo_fuentes = soloFuentes;

        this.homeService.enviarEstadosRobots(payload).subscribe({
          next: async (r: any) => {
            const ok = r?.message === 'success';

            const lines: string[] = [];
            if (soloActualizar) {
              const fuentes = Array.isArray(r?.solo_fuentes) && r.solo_fuentes.length
                ? r.solo_fuentes.map((f: string) => this.ETIQUETA_FUENTE[f] ?? f).join(', ')
                : 'ADRES';
              lines.push(`🔁 Modo: <b>solo actualizar ${fuentes}</b> (no cambia el documento vigente)`);
            }
            if (r?.recibidos != null)
              lines.push(`📋 Filas recibidas: <b>${r.recibidos}</b>`);
            if (r?.tasks_unicos != null)
              lines.push(`🔑 Registros únicos: <b>${r.tasks_unicos}</b>`);
            if (r?.estado_robot_creados != null)
              lines.push(`🆕 Estados creados: <b>${r.estado_robot_creados}</b>`);
            if (r?.estado_robot_actualizados != null)
              lines.push(`🔄 Estados actualizados: <b>${r.estado_robot_actualizados}</b>`);
            if (r?.candidatos_creados != null)
              lines.push(`👤 Candidatos creados: <b>${r.candidatos_creados}</b>`);
            if (r?.candidatos_actualizados != null)
              lines.push(`✏️ Candidatos actualizados: <b>${r.candidatos_actualizados}</b>`);
            if (r?.skipped)
              lines.push(`⚠️ Filas omitidas (sin ID): <b>${r.skipped}</b>`);
            if (Array.isArray(r?.errores) && r.errores.length)
              lines.push(`❌ Errores: <b>${r.errores.length}</b>`);

            await Swal.fire({
              icon: ok ? 'success' : 'error',
              title: ok ? 'Carga exitosa' : 'Carga con errores',
              html: lines.length ? lines.join('<br>') : (ok ? 'OK' : 'Revisa el servidor'),
            });
          },
          error: async (err) => {
            const msg = err?.error?.message || 'No se pudo cargar el Excel.';
            await Swal.fire({ icon: 'error', title: 'Error', text: msg });
          },
        });
      } catch {
        void Swal.fire({
          icon: 'error',
          title: 'Error al procesar',
          text: 'Verifica el formato del archivo.',
        });
      } finally {
        try {
          (evt.target as HTMLInputElement).value = '';
        } catch { }
      }
    };

    reader.readAsArrayBuffer(file);
  }

  // Reset contratado
  triggerFileInputResetContratado(): void {
    const el = this.fileInputResetRef?.nativeElement;
    if (!el) return;
    el.value = '';
    el.click();
  }

  async cargarExcelResetContratado(evt: any): Promise<void> {
    const input = evt?.target as HTMLInputElement;
    const file: File | undefined = input?.files?.[0];

    if (!file) {
      await Swal.fire({ icon: 'error', title: 'Selecciona un archivo' });
      return;
    }

    Swal.fire({
      title: 'Reseteando contratado...',
      text: 'Subiendo Excel y aplicando cambios.',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    });

    try {
      const res = await firstValueFrom(
        this.homeService.bulkResetUltimoProcesoWithFields(file, ['contratado'])
      );

      const body = res?.body || {};
      const counts = body?.counts || {};

      const updated = Number(counts.updated || 0);
      const notFound = Number(counts.not_found || 0);
      const noInterview = Number(counts.no_interview || 0);
      const noProcess = Number(counts.no_process || 0);
      const badRows = Number(counts.bad_rows || 0);

      const detalle =
        `Actualizados: ${updated}\n` +
        `No encontrados: ${notFound}\n` +
        `Sin entrevista: ${noInterview}\n` +
        `Sin proceso: ${noProcess}\n` +
        `Filas inválidas: ${badRows}`;

      await Swal.fire({
        icon: updated > 0 ? 'success' : (notFound + noInterview + noProcess + badRows) > 0 ? 'warning' : 'info',
        title: updated > 0 ? 'Listo' : 'Sin cambios',
        text: detalle,
      });
    } catch (err: any) {
      const msg =
        err?.message ||
        err?.error?.message ||
        err?.error?.detail ||
        'No se pudo procesar el Excel para resetear contratado.';
      await Swal.fire({ icon: 'error', title: 'Error', text: msg });
    } finally {
      try {
        input.value = '';
      } catch { }
    }
  }

  // Descargar Excel candidatos por cédulas
  triggerFileInputExcelCandidatos(): void {
    const el = this.fileInputCandidatosRef?.nativeElement;
    if (!el) return;
    el.value = '';
    el.click();
  }

  // Limpiar Excel de caracteres especiales
  triggerFileInputLimpiarExcel(): void {
    const el = this.fileInputLimpiarExcelRef?.nativeElement;
    if (!el) return;
    el.value = '';
    el.click();
  }

  async procesarYLimpiarExcel(evt: any): Promise<void> {
    const input = evt?.target as HTMLInputElement;
    const file: File | undefined = input?.files?.[0];

    if (!file) {
      await Swal.fire({ icon: 'error', title: 'Selecciona un archivo' });
      return;
    }

    Swal.fire({
      title: 'Limpiando Excel...',
      text: 'Removiendo tildes y caracteres especiales, preservando fechas.',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    });

    try {
      const data = await file.arrayBuffer();
      // Leemos sin alterar formatos (cellDates no es necesario aquí para preservar el raw value y format de excel)
      const wb = XLSX.read(data, { type: 'array' });

      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        
        for (const cellAddress in ws) {
          if (!ws.hasOwnProperty(cellAddress) || cellAddress[0] === '!') continue;
          
          const cell = ws[cellAddress];
          // Solo modificar texto
          if (cell && cell.t === 's' && typeof cell.v === 'string') {
            let val = cell.v;
            
            // Check si es una fecha como 20260330, 2026-03-30, 2026/03/30, 30-03-2026, etc.
            const valTrimmed = val.trim();
            const isDateString = /^\d{2,4}[-/]?\d{2}[-/]?\d{2,4}(?:\s+\d{1,2}:\d{2}(:\d{2})?)?$/.test(valTrimmed);

            if (isDateString) {
              // Si es fecha pura, no la tocamos para respetar el formato u separaciones
            } else {
              // Quitamos tildes, ñ -> n (normalize separa acentos)
              val = val.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
              // Conservamos letras, números, espacios y @ (para correos).
              val = val.replace(/[^a-zA-Z0-9\s@]/g, '');
              cell.v = val;
            }
          }
        }
      }

      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/octet-stream' });
      
      const newFilename = file.name.replace(/\.[^/.]+$/, "") + "_limpio.xlsx";
      await this.saveToDownloads(blob, newFilename);

      await Swal.fire({
        icon: 'success',
        title: 'Excel limpio',
        text: `El archivo ${newFilename} se ha generado correctamente.`,
      });
    } catch (err: any) {
      console.error(err);
      await Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'No se pudo procesar el archivo Excel.',
      });
    } finally {
      try {
        input.value = '';
      } catch { }
    }
  }

  async cargarExcelParaExportarCandidatos(evt: any): Promise<void> {
    const input = evt?.target as HTMLInputElement;
    const file: File | undefined = input?.files?.[0];

    if (!file) {
      await Swal.fire({ icon: 'error', title: 'Selecciona un archivo' });
      return;
    }

    Swal.fire({
      title: 'Generando Excel de candidatos...',
      text: 'Leyendo cédulas y consultando al servidor.',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    });

    try {
      const cedulas = await this.extraerCedulasDesdeExcel(file);
      if (!cedulas.length) {
        await Swal.fire({ icon: 'warning', title: 'Sin cédulas', text: 'No se encontraron cédulas válidas en el Excel.' });
        return;
      }

      const persona = this.personaContratacion.trim() || this.getNombreUsuario() || '';

      const res = await firstValueFrom(this.homeService.descargarCandidatosExcel(cedulas, persona));
      if (!res.body) throw new Error('Respuesta vacía');

      const filename = this.getFilenameFromResponse(res) || 'candidatos_export.xlsx';
      await this.saveToDownloads(res.body, filename);

      await Swal.fire({
        icon: 'success',
        title: 'Excel descargado',
        text: `Cédulas procesadas: ${cedulas.length}`,
      });
    } catch (err: any) {
      console.error(err);
      await Swal.fire({
        icon: 'error',
        title: 'Error',
        text: err?.status === 0 ? 'CORS o red: no se pudo contactar el servidor.' : 'Falló la descarga del Excel de candidatos.',
      });
    } finally {
      try {
        input.value = '';
      } catch { }
    }
  }

  /**
   * ✅ Extrae cédulas desde el Excel:
   * - Busca columna por header ("CEDULA/CC/DOCUMENTO/IDENTIFICACION")
   * - si no encuentra header, usa la primera columna
   */
  private async extraerCedulasDesdeExcel(file: File): Promise<string[]> {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: 'array', cellDates: true });

    const sheetName = wb.SheetNames?.[0];
    if (!sheetName) return [];

    const ws = wb.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });

    if (!rows.length) return [];

    const headerRow = (rows[0] || []).map(v => String(v ?? '').trim().toUpperCase());
    // Match en 2 pasadas:
    //  1. EXACTO contra una whitelist de nombres canonicos (mas confiable)
    //  2. INCLUDES pero rechazando cualquier header que arranque con 'TIPO'
    //     (sin esto, 'TIPO DOCUMENTO' matcheaba via 'DOCUMENTO' y se
    //     leia la columna equivocada -> ninguna cedula pasaba la
    //     validacion length>=6).
    const exactTargets = [
      'CEDULA', 'CÉDULA', 'IDENTIFICACION', 'IDENTIFICACIÓN',
      'NRO CC', 'N° CC', 'NUMERO DOCUMENTO', 'NÚMERO DOCUMENTO',
      'NUMERO_DOCUMENTO', 'DOCUMENTO',
    ];
    const looseTargets = ['CEDULA', 'CÉDULA', 'IDENTIFICACION', 'IDENTIFICACIÓN', 'CC', 'DOCUMENTO'];

    let colIdx = -1;

    // Pasada 1: match exacto
    for (let i = 0; i < headerRow.length; i++) {
      const h = headerRow[i];
      if (!h) continue;
      if (exactTargets.includes(h)) { colIdx = i; break; }
    }

    // Pasada 2: includes pero excluyendo 'TIPO ...'
    if (colIdx === -1) {
      for (let i = 0; i < headerRow.length; i++) {
        const h = headerRow[i];
        if (!h) continue;
        if (h.startsWith('TIPO')) continue;
        if (looseTargets.some(t => h.includes(t))) { colIdx = i; break; }
      }
    }

    if (colIdx === -1) colIdx = 0;

    const out: string[] = [];
    const seen = new Set<string>();

    for (let r = 1; r < rows.length; r++) {
      let v = String(rows[r]?.[colIdx] ?? '').trim();
      if (!v) continue;

      // limpia espacios/puntos/comas
      v = v.replace(/\s+/g, '').replace(/[.,]/g, '');

      // deja solo dígitos (tu backend normaliza X, pero aquí mejor enviar solo dígitos)
      v = v.replace(/\D+/g, '');

      if (!v || v.length < 6) continue;

      if (!seen.has(v)) {
        seen.add(v);
        out.push(v);
      }
    }

    return out;
  }

  private getFilenameFromResponse(res: any): string | null {
    const cd = res?.headers?.get?.('Content-Disposition') || res?.headers?.get?.('content-disposition') || '';
    if (!cd) return null;
    const m = cd.match(/filename\*?=(?:UTF-8''|")?([^;"']+)/i);
    if (!m) return null;
    try {
      return decodeURIComponent(String(m[1]).replace(/"/g, '')).trim();
    } catch {
      return String(m[1]).replace(/"/g, '').trim();
    }
  }

  private getNombreUsuario(): string {
    const nombres = (this.user?.datos_basicos?.nombres ?? '').toString().trim();
    const apellidos = (this.user?.datos_basicos?.apellidos ?? '').toString().trim();
    const full = `${nombres} ${apellidos}`.trim();
    return full || '';
  }


  private async fetchAsArrayBufferOrNull(url?: string): Promise<ArrayBuffer | null> {
    if (!url) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.arrayBuffer();
    } catch { return null; }
  }






  carnetContext: any = null;

  // Leer Excel para generar carnets
  triggerFileInputCarnets(): void {
    const el = this.fileInputCarnetsRef?.nativeElement;
    if (!el) return;
    el.value = '';
    el.click();
  }

  async cargarExcelCarnets(evt: any): Promise<void> {
    const input = evt?.target as HTMLInputElement;
    const file: File | undefined = input?.files?.[0];

    if (!file) {
      await Swal.fire({ icon: 'error', title: 'Selecciona un archivo' });
      return;
    }

    Swal.fire({
      title: 'Leyendo Excel para carnets...',
      text: 'Validando columnas CÉDULA, CÓDIGO y CENTRO COSTO.',
      allowOutsideClick: false,
      allowEscapeKey: false,
      didOpen: () => Swal.showLoading(),
    });

    try {
      // 1) Excel -> [{cedula,codigo,centroCosto}]
      const registros = await this.extraerCedulaCodigoDesdeExcel(file);

      if (!registros.length) {
        Swal.close();
        await Swal.fire({
          icon: 'warning',
          title: 'Sin datos válidos',
          text: 'No se encontraron filas con CÉDULA, CÓDIGO y CENTRO COSTO válidos.',
        });
        return;
      }

      // 2) Cédulas únicas (solo para consultar backend 1 vez por cédula)
      const cedulas: string[] = [];
      const seenCed = new Set<string>();
      for (const r of registros) {
        const ced = String(r?.cedula ?? '').trim();
        if (!ced) continue;
        if (seenCed.has(ced)) continue;
        seenCed.add(ced);
        cedulas.push(ced);
      }

      // 3) Lotes para evitar URL muy largo
      const BATCH_SIZE = 250;
      const chunks: string[][] = [];
      for (let i = 0; i < cedulas.length; i += BATCH_SIZE) {
        chunks.push(cedulas.slice(i, i + BATCH_SIZE));
      }

      Swal.update({
        title: 'Consultando candidatos...',
        text: `Consultando ${cedulas.length} cédulas en ${chunks.length} lote(s)...`,
      });

      // 4) Consulta por lotes SECUENCIAL
      const backendItems: any[] = [];
      for (let idx = 0; idx < chunks.length; idx++) {
        const chunk = chunks[idx];

        if (Swal.isVisible()) {
          Swal.update({
            title: 'Consultando candidatos...',
            text: `Lote ${idx + 1}/${chunks.length} (${chunk.length} cédulas)`,
          });
        }

        let resp: any = null;
        try {
          resp = await firstValueFrom(this.homeService.getCandidatosMini(chunk) as any);
        } catch (err) {
          console.error(`❌ Error en batch ${idx + 1}/${chunks.length}`, err);
          resp = null;
        }

        const items = Array.isArray(resp) ? resp : (resp?.ITEMS ?? resp?.items ?? []);
        if (Array.isArray(items) && items.length) backendItems.push(...items);
      }

      // 5) Map por cédula
      const byCedula = new Map<string, any>();
      for (const c of backendItems) {
        const key = String(
          c?.CEDULA ??
          c?.cedula ??
          c?.NUMERO_DOCUMENTO ??
          c?.numero_documento ??
          c?.documentNumber ??
          c?.document_number ??
          ''
        ).trim();

        if (key && !byCedula.has(key)) byCedula.set(key, c);
      }

      // 6) Helper para leer llaves MAYÚSCULAS/minúsculas
      const pickAny = (obj: any, keys: string[]) => {
        for (const k of keys) {
          const v = obj?.[k];
          if (v !== undefined && v !== null && String(v).trim() !== '') return v;
        }
        return '';
      };

      // 7) Une Excel + candidato (centroCosto viene del Excel)
      const registrosEnriquecidos = registros.map((r) => {
        const ced = String(r?.cedula ?? '').trim();
        const candidato = ced ? (byCedula.get(ced) ?? null) : null;
        return { ...r, candidato };
      });

      // 8) FINAL (lo que va directo al PDF)
      //    ✅ CENTRO_COSTO: SIEMPRE del Excel (ignora el del backend)
      const finalRows = registrosEnriquecidos.map((r, i) => {
        const c = r.candidato || {};
        if (i === 0) console.log('--- DEBUG HOME CANDIDATO DATA ---', c);

        return {
          CEDULA: String(r?.cedula ?? '').trim(),
          CODIGO: String(r?.codigo ?? '').trim(),

          APELLIDOS: String(pickAny(c, ['APELLIDOS', 'apellidos'])).trim(),
          // `candidatos-mini` devuelve los nombres en la llave NOMBRE (singular)
          // —ver ExportCandidatosMiniJsonView—, no en NOMBRES. Buscando solo
          // NOMBRES esto quedaba vacío y el carnet salía con puro apellido.
          NOMBRES: String(pickAny(c, ['NOMBRES', 'nombres', 'NOMBRE', 'nombre'])).trim(),
          NOMBRE: String(pickAny(c, ['NOMBRE', 'nombre'])).trim(), // fallback

          FECHA_INGRESO: String(pickAny(c, ['FECHA_INGRESO', 'fecha_ingreso'])).trim(),

          // ✅ del Excel (autoridad)
          CENTRO_COSTO: String(r?.centroCosto ?? '').trim(),

          FAMILIAR_EMERGENCIA_NOMBRE: String(
            pickAny(c?.contacto_emergencia, ['NOMBRES', 'nombres', 'NOMBRE_CONTACTO', 'nombre_contacto', 'NOMBRE', 'nombre']) ||
            pickAny(c?.contacto, ['NOMBRE_CONTACTO', 'nombre_contacto', 'NOMBRES', 'nombres', 'NOMBRE', 'nombre']) ||
            pickAny(c, [
              'FAMILIAR_EMERGENCIA', 'familiar_emergencia',
              'FAMILIAR_EMERGENCIA_NOMBRE', 'familiar_emergencia_nombre',
              'CONTACTO_EMERGENCIA_NOMBRE', 'contacto_emergencia_nombre',
              'NOMBRE_CONTACTO_EMERGENCIA', 'nombre_contacto_emergencia'
            ]) || pickAny(c?.datos_basicos, [
              'FAMILIAR_EMERGENCIA', 'familiar_emergencia',
              'FAMILIAR_EMERGENCIA_NOMBRE', 'familiar_emergencia_nombre',
              'CONTACTO_EMERGENCIA_NOMBRE', 'contacto_emergencia_nombre',
              'NOMBRE_CONTACTO_EMERGENCIA', 'nombre_contacto_emergencia'
            ])
          ).trim(),
          FAMILIAR_EMERGENCIA_TELEFONO: String(
            pickAny(c?.contacto_emergencia, ['TELEFONO', 'telefono', 'CELULAR', 'celular', 'CELULAR_CONTACTO', 'celular_contacto']) ||
            pickAny(c?.contacto, ['CELULAR_CONTACTO', 'celular_contacto', 'TELEFONO', 'telefono', 'CELULAR', 'celular']) ||
            pickAny(c, [
              'FAMILIAR_EMERGENCIA_TELEFONO', 'familiar_emergencia_telefono',
              'TELEFONO_FAMILIAR_EMERGENCIA', 'telefono_familiar_emergencia',
              'CONTACTO_EMERGENCIA_TELEFONO', 'contacto_emergencia_telefono',
              'TELEFONO_CONTACTO_EMERGENCIA', 'telefono_contacto_emergencia'
            ]) || pickAny(c?.datos_basicos, [
              'FAMILIAR_EMERGENCIA_TELEFONO', 'familiar_emergencia_telefono',
              'TELEFONO_FAMILIAR_EMERGENCIA', 'telefono_familiar_emergencia',
              'CONTACTO_EMERGENCIA_TELEFONO', 'contacto_emergencia_telefono',
              'TELEFONO_CONTACTO_EMERGENCIA', 'telefono_contacto_emergencia'
            ])
          ).trim(),

          DOCUMENTO_89_URL: String(pickAny(c, ['DOCUMENTO_89_URL', 'documento_89_url'])).trim(),
        };
      });

      const encontrados = finalRows.filter(
        (x) => !!x.APELLIDOS || !!x.NOMBRES || !!x.NOMBRE || !!x.FECHA_INGRESO || !!x.CENTRO_COSTO || !!x.DOCUMENTO_89_URL
      ).length;

      this.carnetContext = {
        ARCHIVO: { name: file.name, size: file.size, type: file.type },
        FINAL: {
          TOTAL: finalRows.length,
          ENCONTRADOS: encontrados,
          NO_ENCONTRADOS: finalRows.length - encontrados,
          FILAS: finalRows,
        },
      };

      console.log('🧾 CARNETS | CONTEXTO', {
        ARCHIVO: this.carnetContext.ARCHIVO,
        FINAL: {
          TOTAL: this.carnetContext.FINAL.TOTAL,
          ENCONTRADOS: this.carnetContext.FINAL.ENCONTRADOS,
          NO_ENCONTRADOS: this.carnetContext.FINAL.NO_ENCONTRADOS,
          SAMPLE: finalRows.slice(0, 10),
        },
      });

      await this.generarCarnets(finalRows);
    } catch (err: any) {
      console.error('❌ cargarExcelCarnets error:', err);
      Swal.close();
      await Swal.fire({
        icon: 'error',
        title: 'Error',
        text: err?.message || 'No se pudo leer el Excel / consultar candidatos-mini.',
      });
    } finally {
      try { input.value = ''; } catch { }
    }
  }

  private async extraerCedulaCodigoDesdeExcel(
    file: File
  ): Promise<Array<{ cedula: string; codigo: string; centroCosto: string }>> {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: 'array', cellDates: true });

    const sheetName = wb.SheetNames?.[0];
    if (!sheetName) return [];

    const ws = wb.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
    if (!rows.length) return [];

    const header = (rows[0] || []).map((v) => String(v ?? '').trim());

    const norm = (x: string) =>
      (x || '')
        .replace(/\u00a0|\u2007|\u202f/g, ' ')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();

    const headerN = header.map((h) => norm(h));

    const idxCedula = headerN.findIndex((h) =>
      ['cedula', 'cédula', 'identificacion', 'identificación', 'documento', 'numero_documento', 'nro documento'].some(
        (k) => h === norm(k) || h.includes(norm(k))
      )
    );

    const idxCodigo = headerN.findIndex((h) =>
      ['codigo', 'código', 'code', 'cod'].some((k) => h === norm(k) || h.includes(norm(k)))
    );

    const idxCentroCosto = headerN.findIndex((h) =>
      ['centro costo', 'centro de costo', 'centro_costo', 'centrocosto', 'ccosto', 'centrocostos'].some(
        (k) => h === norm(k) || h.includes(norm(k))
      )
    );

    if (idxCedula === -1 || idxCodigo === -1 || idxCentroCosto === -1) {
      throw new Error('Faltan headers: el Excel debe tener columnas CÉDULA, CÓDIGO y CENTRO COSTO.');
    }

    const out: Array<{ cedula: string; codigo: string; centroCosto: string }> = [];
    const seen = new Set<string>();

    for (let r = 1; r < rows.length; r++) {
      let cedula = String(rows[r]?.[idxCedula] ?? '').trim();
      let codigo = String(rows[r]?.[idxCodigo] ?? '').trim();
      let centroCosto = String(rows[r]?.[idxCentroCosto] ?? '').trim();

      if (!cedula || !codigo || !centroCosto) continue;

      cedula = cedula.replace(/\s+/g, '').replace(/[.,]/g, '').replace(/\D+/g, '');
      if (!cedula || cedula.length < 6) continue;

      codigo = codigo
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();

      centroCosto = centroCosto.replace(/\s+/g, ' ').trim(); // respeta texto, solo normaliza espacios

      const key = `${cedula}||${codigo}||${centroCosto}`;
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({ cedula, codigo, centroCosto });
    }

    return out;
  }


  // =========================================================
  // ✅ GENERAR CARNETS — Refactorizado para máxima compatibilidad (jsPDF)
  // =========================================================

  /**
   * Deja la foto "al derecho" antes de meterla al carnet.
   *
   * Las fotos se toman con cámara y llegan apaisadas, con la rotación solo en
   * el EXIF. `jsPDF.addImage` copia los píxeles tal cual y las imprimía
   * acostadas. Se decodifica con `imageOrientation: 'from-image'` para aplicar
   * el EXIF y, si aun así queda más ancha que alta, se gira 90° en sentido
   * horario — el mismo giro que usa la generación individual, para que la foto
   * salga igual en los dos lados.
   *
   * Si algo falla devuelve la original: nunca se queda sin foto por esto.
   */
  private async fotoAlDerechoDataUrl(dataUrl: string | null): Promise<string | null> {
    if (!dataUrl) return null;
    try {
      const resp = await fetch(dataUrl);
      const blob = await resp.blob();

      let bitmap: ImageBitmap | null = null;
      try {
        bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      } catch {
        bitmap = await createImageBitmap(blob).catch(() => null);
      }
      if (!bitmap) return dataUrl;

      const apaisada = bitmap.width > bitmap.height;
      const canvas = document.createElement('canvas');
      canvas.width = apaisada ? bitmap.height : bitmap.width;
      canvas.height = apaisada ? bitmap.width : bitmap.height;

      const ctx = canvas.getContext('2d');
      if (!ctx) { bitmap.close?.(); return dataUrl; }

      if (apaisada) {
        ctx.translate(canvas.width, 0);
        ctx.rotate(Math.PI / 2);
      }
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close?.();

      return canvas.toDataURL('image/jpeg', 0.92);
    } catch {
      return dataUrl;
    }
  }

  async generarCarnets(rowsParam?: any[]): Promise<void> {
    try {
      const rows: any[] = Array.isArray(rowsParam) && rowsParam.length ? rowsParam : this.carnetContext?.FINAL?.FILAS ?? [];

      if (!Array.isArray(rows) || rows.length === 0) {
        Swal.close();
        await Swal.fire({ icon: 'warning', title: 'Sin datos', text: 'Primero carga el Excel (cédula + código + centro costo).' });
        return;
      }

      if (!Swal.isVisible()) {
        Swal.fire({
          title: 'Generando carnets...',
          text: `Procesando ${rows.length} registros (9 por PDF)`,
          allowOutsideClick: false,
          allowEscapeKey: false,
          didOpen: () => Swal.showLoading(),
        });
      } else {
        Swal.update({ title: 'Generando carnets...', text: `Procesando ${rows.length} registros (9 por PDF)` });
        Swal.showLoading();
      }

      const PAGE_W = 612; // pt (8.5 inch)
      const PAGE_H = 792; // pt (11.0 inch)
      const MARGIN = 18;
      const GAP = 12;

      const CARD_W = Math.floor((PAGE_W - 2 * MARGIN - 2 * GAP) / 3);
      const CARD_H = Math.floor((PAGE_H - 2 * MARGIN - 2 * GAP) / 3);

      const BLUE_CORP = '#1E54C7';
      const BLUE_SUBTLE = '#EBF0FA';
      const TEXT_MAIN = '#1A1A1A';
      const TEXT_MUTED = '#737373';
      const WHITE = '#FFFFFF';
      const BLACK = '#000000';

      const bytesCache = new Map<string, Promise<string | null>>(); // Para jsPDF usamos Base64 directamente

      const isHttp = (u: string) => /^https?:\/\//i.test(u);
      const isDataUrl = (u: string) => /^data:image\//i.test(u);
      const normalizeAssetUrl = (u: string) => {
        const sv = String(u ?? '').trim();
        if (!sv) return '';
        if (isHttp(sv) || isDataUrl(sv)) return sv;
        return sv.replace(/^\/+/, '').replace(/^assets\//, '');
      };

      const fetchBase64WithFallback = async (mainUrl: string, alts: string[] = []): Promise<string | null> => {
        const tryFetch = async (u: string) => {
          try {
            const res = await fetch(u);
            if (res.ok) {
              const arrayBuffer = await res.arrayBuffer();
              const base64 = btoa(new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));
              let mime = 'image/jpeg';
              if (u.toLowerCase().endsWith('.png')) mime = 'image/png';
              // Deteccion basica
              const bv = new Uint8Array(arrayBuffer);
              if (bv.length >= 8 && bv[0] === 0x89 && bv[1] === 0x50 && bv[2] === 0x4e && bv[3] === 0x47) mime = 'image/png';
              return `data:${mime};base64,${base64}`;
            }
          } catch { }
          return null;
        };
        let b64 = await tryFetch(mainUrl);
        if (b64) return b64;
        for (const alt of alts) {
          b64 = await tryFetch(alt);
          if (b64) return b64;
        }
        return null;
      };

      const fetchImageBase64 = async (urlOrData?: string): Promise<string | null> => {
        const raw = String(urlOrData ?? '').trim();
        if (!raw) return null;
        if (isDataUrl(raw)) return raw;
        const clean = normalizeAssetUrl(raw);
        if (bytesCache.has(clean)) return await bytesCache.get(clean)!;
        const p = (async () => {
          if (isHttp(raw)) return await fetchBase64WithFallback(raw);
          return await fetchBase64WithFallback(clean, [`assets/${clean}`, `/${clean}`, `./${clean}`]);
        })();
        bytesCache.set(clean, p);
        return await p;
      };

      const buildQrDataUrl = async (payload: string): Promise<string> => {
        const key = String(payload ?? '').trim();
        if (!key) return '';
        try {
          return await (QRCode as any).toDataURL(key, { type: 'image/jpeg', errorCorrectionLevel: 'M', margin: 1, width: 300, color: { light: '#ffffffff' } });
        } catch { return ''; }
      };

      const safeTxt = (txt: any) => {
        let s = String(txt ?? '').trim().toUpperCase();
        s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // Sin tildes para evitar problemas de fuente
        return s.replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ');
      };
      const safeTxtMixed = (txt: any) => {
        let s = String(txt ?? '').trim();
        s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return s.replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ');
      }

      // Pre-cargar logo
      const logoB64 = await fetchImageBase64('logos/Logo_TA.png');

      const zip = new JSZip();
      const CHUNK_SIZE = 9;
      const totalPdfs = Math.ceil(rows.length / CHUNK_SIZE);

      for (let fileIdx = 0; fileIdx < totalPdfs; fileIdx++) {
        const chStart = fileIdx * CHUNK_SIZE;
        const chEnd = Math.min(chStart + CHUNK_SIZE, rows.length);
        const chunk = rows.slice(chStart, chEnd);

        Swal.update({
          title: 'Generando carnets...',
          text: `PDF ${fileIdx + 1}/${totalPdfs} (registros ${chStart + 1}-${chEnd})`,
        });

        // El dibujo del carnet vive en `carnet-masivo-fill.ts`, compartido con
        // la generación individual de Contratación. Antes estaba duplicado acá
        // y las correcciones solo llegaban a un lado: este archivo arrastraba
        // dos defectos ya resueltos allá —los apellidos largos se montaban
        // sobre los nombres (el cursor avanzaba una altura fija aunque el texto
        // ocupara dos renglones) y la foto no aplicaba la orientación EXIF, así
        // que las de cámara salían acostadas.
        const filas: CarnetMasivoRow[] = [];
        for (let si = 0; si < CHUNK_SIZE; si++) {
          const rv = chunk[si];
          if (!rv) continue;

          const fotoUrl = String(rv?.DOCUMENTO_89_URL ?? '').trim();
          const qrKey = `${String(rv?.CEDULA ?? '').trim()}|${String(rv?.CODIGO ?? '').trim()}`;
          const [fotoB64, qrB64] = await Promise.all([
            fetchImageBase64(fotoUrl),
            buildQrDataUrl(qrKey),
          ]);

          filas.push({
            CEDULA: String(rv?.CEDULA ?? ''),
            CODIGO: String(rv?.CODIGO ?? ''),
            APELLIDOS: String(rv?.APELLIDOS ?? ''),
            // `||` y no `??`: cuando la fila trae NOMBRES como cadena VACÍA el
            // `??` no cae al fallback (solo lo hace con null/undefined) y el
            // carnet se imprimía sin nombres.
            NOMBRES: String(rv?.NOMBRES || rv?.NOMBRE || ''),
            FECHA_INGRESO: String(rv?.FECHA_INGRESO ?? ''),
            CENTRO_COSTO: String(rv?.CENTRO_COSTO ?? ''),
            FAMILIAR_EMERGENCIA_NOMBRE: String(rv?.FAMILIAR_EMERGENCIA_NOMBRE ?? ''),
            FAMILIAR_EMERGENCIA_TELEFONO: String(rv?.FAMILIAR_EMERGENCIA_TELEFONO ?? ''),
            fotoDataUrl: await this.fotoAlDerechoDataUrl(fotoB64),
            qrDataUrl: qrB64 || null,
          });
        }

        const pdfBlob = buildCarnetsMasivoPdf(filas, {
          logoDataUrl: logoB64,
          telefonoCoordinador: TELEFONO_COORDINADOR_ALIANZA,
          arl: ARL_ALIANZA,
          // Cómo voltea la hoja la impresora de este puesto; se elige en el
          // bloque de impresión de los diálogos de carnet y queda guardado.
          impresion: leerImpresion(),
        });
        const pdfBytes = await pdfBlob.arrayBuffer();
        zip.file(`carnets_${String(fileIdx + 1).padStart(3, '0')}.pdf`, pdfBytes);
      }

      Swal.update({ title: 'Empaquetando ZIP...', text: `Creando ZIP con ${totalPdfs} PDF(s)` });
      const zipBlob = await zip.generateAsync({ type: 'blob' });

      const today = new Date();
      const yy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      await (this as any).saveToDownloads(zipBlob, `carnets_${yy}${mm}${dd}.zip`);

      Swal.close();
      await Swal.fire({ icon: 'success', title: 'Listo', text: `Se generaron ${totalPdfs} PDF(s) y se descargó el ZIP.` });

    } catch (error: any) {
      console.error('❌ Error generando carnets:', error);
      Swal.close();
      await Swal.fire({ icon: 'error', title: 'Error', text: error?.message || 'Ocurrió un error al generar carnets.' });
    }
  }

}

