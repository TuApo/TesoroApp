import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef, OnDestroy, NgZone, ApplicationRef, DestroyRef, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators, FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import * as XLSX from 'xlsx';
import * as FileSaver from 'file-saver';
import * as ExcelJS from 'exceljs';
import Swal from 'sweetalert2';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

// Models & Shared
import { SharedModule } from '@/app/shared/shared.module';
import { MatTableDataSource } from '@angular/material/table';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatNativeDateModule } from '@angular/material/core';


import { ValidationPreviewDialogComponent } from '@/app/shared/components/validation-preview-dialog/validation-preview-dialog.component';
import {
  PreviewIssue
} from 'src/app/shared/model/validation-preview';

import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';
import { SedeScopeService } from '@/app/shared/services/sede-scope/sede-scope.service';
import { isOfflineQueued } from '@/app/core/utils/offline-response';
import { environment } from '@/environments/environment';
import { HiringService } from '../../service/hiring.service';
import { RegistroProcesoContratacion } from '../../service/registro-proceso-contratacion/registro-proceso-contratacion';
import { GestionDocumentalService } from '../../service/gestion-documental/gestion-documental.service';
import { TrasladosService } from '../../../eps-transfers/service/traslados.service';
import { CruceValidationHelper, CruceRow } from './cruce-validation.helper';
import { ReportesService } from '../../service/reportes/reportes.service';

// Tipos definidos localmente o importados
type UploadControl = 'cedulasEscaneadas' | 'cruceDiario' | 'arl' | 'induccionSSO' | 'traslados';

interface ReportForm {
  sede: FormControl<any>;
  esDeHoy: FormControl<string>;
  fecha: FormControl<Date | null>;
  contratosHoy: FormControl<string>;

  // Archivos (Checkboxes)
  cedulasEscaneadas: FormControl<boolean>;
  cruceDiario: FormControl<boolean>;
  arl: FormControl<boolean>;
  induccionSSO: FormControl<boolean>;
  traslados: FormControl<boolean>;

  // Counts & Notes
  cantidadContratosTuAlianza: FormControl<number | null>;
  cantidadContratosApoyoLaboral: FormControl<number | null>;
  notas: FormControl<string>;
}

interface DocConfig {
  key: UploadControl;
  label: string;
  accept: string;
  multiple: boolean;
  directory: boolean;
  hint: string;
  previewType?: 'cedulas' | 'traslados';
}

@Component({
  selector: 'app-hiring-report',
  standalone: true,
  imports: [
    SharedModule,
    ReactiveFormsModule,
    MatDatepickerModule,
    MatCheckboxModule,
    MatNativeDateModule,
    MatDialogModule
],
  templateUrl: './hiring-report.component.html',
  styleUrls: ['./hiring-report.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HiringReportComponent implements OnInit, OnDestroy {

  // Typed Form
  reporteForm!: FormGroup<ReportForm>;

  // Data
  sedes: any[] = [];
  nombre = '';

  // File State
  files: Partial<Record<UploadControl, File[]>> = {};
  fileNames: Partial<Record<UploadControl, string>> = {};

  // Validation Flags
  isCruceValidado = false;
  isArlValidado = false;

  // Processed Data
  datoscruced: string[][] = []; // Rows normalizadas del cruce
  arlRows: any[][] = []; // Rows leídas del ARL
  private cruceHeaderRow: string[] = []; // Headers originales del cruce

  // Errors & Previews
  erroresValidacion = new MatTableDataSource<any>([]);
  cedulasPreview: any[] = [];
  trasladosPreview: any[] = [];
  arlErrors: { cedula: string; error: string }[] = [];

  // Config
  readonly DOCS: DocConfig[] = [
    { key: 'cedulasEscaneadas', label: 'Cédulas Escaneadas', accept: '.pdf', multiple: true, directory: true, hint: 'PDFs individuales. Obligatorio: DOCUMENTO-Nombre.pdf', previewType: 'cedulas' },
    { key: 'cruceDiario', label: 'Cruce Diario (Excel)', accept: '.xls,.xlsx', multiple: false, directory: false, hint: 'Excel del día. Columna 3 define si es AL o TA.' },
    { key: 'arl', label: 'Archivo ARL (Excel)', accept: '.xls,.xlsx', multiple: false, directory: false, hint: 'Reporte descargado de ARL. Debe contener "DNI TRABAJADOR".' },
    { key: 'induccionSSO', label: 'Inducción SST', accept: '.pdf', multiple: false, directory: false, hint: 'Constancia de inducción grouping.' },
    { key: 'traslados', label: 'Traslados', accept: '.pdf', multiple: true, directory: true, hint: 'PDFs traslados EPS. Nombre: DOCUMENTO-EPS.pdf', previewType: 'traslados' },
  ];

  private readonly BLOCKED_FILES = new Set<string>(['thumbs.db', 'desktop.ini', '.ds_store']);
  private readonly destroyRef = inject(DestroyRef);

  // Worker para ARL
  private arlWorker: Worker | undefined;

  constructor(
    private readonly fb: FormBuilder,
    private readonly utilityService: UtilityServiceService,
    private readonly sedeScope: SedeScopeService,
    private readonly hiringService: HiringService,
    private readonly registroProcesoService: RegistroProcesoContratacion,
    private readonly gestionDocumentalService: GestionDocumentalService,
    private readonly trasladosService: TrasladosService,
    private readonly reportesService: ReportesService, // Inyectado
    private readonly dialog: MatDialog,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    private readonly cdr: ChangeDetectorRef,
    private readonly zone: NgZone,
    private readonly appRef: ApplicationRef
  ) {
    this.initWorker();
  }

  /** Promesa de `loadSedes()`: la precarga automática necesita las sedes listas. */
  private sedesReady: Promise<void> = Promise.resolve();

  ngOnInit(): void {
    this.initForm();
    this.loadUser();
    this.sedesReady = this.loadSedes();

    // Llegada desde el botón "Cerrar contratación" del pipeline: se precarga
    // el cierre del día automáticamente (base de contratados de HOY).
    if (this.route.snapshot.queryParamMap.get('auto') === 'hoy') {
      void this.precargarCierreDeHoy();
    }
  }

  /**
   * Carga automática del cierre del día (botón "Cerrar contratación" del
   * pipeline). Deja el reporte listo salvo ARL y SST, que siguen manuales:
   *
   *  1. Autoselecciona la SEDE del usuario logueado.
   *  2. Pide a gestion_contratacion las cédulas con contrato generado HOY en
   *     ESA oficina (`reporte/contratados-del-dia/`) y arma la base del cruce
   *     con `reporte/candidatos-excel/` (misma lógica de "sacar la base por
   *     cédula"); la adjunta como Cruce Diario.
   *  3. Marca "sí hubo contratación" y "es de hoy".
   *  4. Trae del sistema la CÉDULA escaneada (gestion_documental, tipo 29) y
   *     el TRASLADO EPS (traslados.TrasladoDocumento) de cada persona, y los
   *     adjunta con el nombre que exige la validación (CEDULA-Nombre.pdf /
   *     CEDULA-EPS.pdf).
   *  5. Dispara la MISMA validación del flujo manual (frontend + backend +
   *     diálogos de corrección).
   */
  private async precargarCierreDeHoy(): Promise<void> {
    this.showLoading('Preparando cierre...', 'Descargando la contratación de HOY desde el sistema...');
    try {
      await this.sedesReady;

      // 1) Sede del logueado (mismo catálogo gestion_admin.Sede en user.sede y
      //    en traerSucursales(), así que el nombre empata literal).
      const sedeNombre = String(
        this.sedeScope.activa() || this.utilityService.getUser()?.sede?.nombre || '',
      ).trim();
      const sedeObj = this.sedes.find(s => String(s?.nombre ?? '').trim() === sedeNombre) || null;
      if (sedeObj) this.reporteForm.patchValue({ sede: sedeObj });

      // 2) Cédulas contratadas HOY según gestion_contratacion (la fuente viva
      //    del pipeline). procesoContratacion se llena DESPUÉS, con este mismo
      //    cierre, así que NO sirve como origen.
      const hoy = new Date();
      const fecha = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
      const respDia: any = await firstValueFrom(
        this.registroProcesoService.contratadosDelDia(fecha, sedeNombre || undefined)
      );
      const personas: { cedula: string; nombre: string }[] = (respDia?.contratados ?? [])
        .map((c: any) => ({ cedula: String(c?.cedula ?? '').trim(), nombre: String(c?.nombre ?? '').trim() }))
        .filter((p: any) => /^\d+$/.test(p.cedula));

      if (!personas.length) {
        this.closeSwal();
        Swal.fire({
          icon: 'info',
          title: 'Sin contratados hoy',
          html:
            (sedeNombre ? `La oficina <b>${sedeNombre}</b> no tiene` : 'El sistema aún no tiene') +
            ' contratos generados <b>HOY</b>.<br>' +
            'Puedes adjuntar el Cruce Diario manualmente, o volver cuando haya contratación.',
        });
        return;
      }

      // Base del cruce armada desde gestion_contratacion — misma lógica de
      // "sacar la base por cédula" (reporte/candidatos-excel, POST masivo).
      this.updateSwalProgress('Armando la base del cruce...', 0, personas.length);
      const blob = await firstValueFrom(
        this.registroProcesoService.exportarBaseCandidatos(personas.map(p => p.cedula), this.nombre)
      );
      const file = new File([blob], `cruce_diario_${fecha}.xlsx`, {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      // 3) Adjuntar el cruce como si el usuario lo hubiera seleccionado a mano.
      this.files.cruceDiario = [file];
      this.fileNames.cruceDiario = `${file.name} (autocargado: ${personas.length} persona(s))`;
      this.reporteForm.patchValue({ contratosHoy: 'si', esDeHoy: 'true', cruceDiario: true });

      // 4) Cédulas escaneadas y traslados EPS desde el sistema, por persona.
      const cedulaFiles: File[] = [];
      const trasladoFiles: File[] = [];
      const sinCedula: string[] = [];
      const sinTraslado: string[] = [];
      const tipoDe = (d: any): number => { const t = d?.type; return Number(t && typeof t === 'object' ? t.id : t); };

      // Lotes de 5 en paralelo: cada persona son 2 consultas + 2 descargas y en
      // secuencial el cierre de una oficina grande se hacía eterno.
      const CONCURRENCIA = 5;
      const procesarPersona = async (p: { cedula: string; nombre: string }): Promise<void> => {
        // Cédula escaneada (DocumentType CEDULA = id 29 en gestion_documental).
        try {
          const docs: any[] = await firstValueFrom(this.gestionDocumentalService.getDocumentosDeCandidato(p.cedula));
          const docCedula = (docs || []).find(d => tipoDe(d) === 29);
          const url = docCedula?.file_url || docCedula?.file || docCedula?.current_file?.url || '';
          const pdf = url ? await this.descargarArchivo(url) : null;
          if (pdf) {
            const nombreArchivo = (p.nombre || 'CEDULA').replace(/[\\/:*?"<>|]/g, ' ').trim();
            cedulaFiles.push(new File([pdf], `${p.cedula}-${nombreArchivo}.pdf`, { type: 'application/pdf' }));
          } else {
            sinCedula.push(`${p.cedula} ${p.nombre}`.trim());
          }
        } catch { sinCedula.push(`${p.cedula} ${p.nombre}`.trim()); }

        // Traslado EPS (solicitud vinculada en traslados.TrasladoDocumento).
        try {
          const traslados: any[] = await firstValueFrom(this.trasladosService.buscarAfiliacionPorId(p.cedula));
          const conDoc = (Array.isArray(traslados) ? traslados : []).find(t => t?.solicitud_doc?.file_url);
          const eps = this.resolveEps(String(conDoc?.eps_a_trasladar || conDoc?.eps_trasladada || ''));
          const pdf = conDoc && eps ? await this.descargarArchivo(conDoc.solicitud_doc.file_url) : null;
          if (pdf && eps) {
            trasladoFiles.push(new File([pdf], `${p.cedula}-${eps}.pdf`, { type: 'application/pdf' }));
          } else {
            sinTraslado.push(`${p.cedula} ${p.nombre}`.trim());
          }
        } catch { sinTraslado.push(`${p.cedula} ${p.nombre}`.trim()); }
      };

      for (let i = 0; i < personas.length; i += CONCURRENCIA) {
        const lote = personas.slice(i, i + CONCURRENCIA);
        const avance = Math.min(i + CONCURRENCIA, personas.length);
        this.updateSwalProgress(`Trayendo cédulas y traslados... (${avance}/${personas.length})`, avance, personas.length);
        await Promise.all(lote.map(procesarPersona));
      }

      if (cedulaFiles.length) {
        this.files.cedulasEscaneadas = cedulaFiles;
        this.fileNames.cedulasEscaneadas = `${cedulaFiles.length} de ${personas.length} cédula(s) autocargada(s)`;
        this.reporteForm.patchValue({ cedulasEscaneadas: true });
        this.generateCedulasPreview(cedulaFiles);
      }
      if (trasladoFiles.length) {
        this.files.traslados = trasladoFiles;
        this.fileNames.traslados = `${trasladoFiles.length} de ${personas.length} traslado(s) autocargado(s)`;
        this.reporteForm.patchValue({ traslados: true });
        this.generateTrasladosPreview(trasladoFiles);
      }
      this.cdr.markForCheck();
      this.closeSwal();

      // 5) Resumen de faltantes. ARL y SST siempre quedan manuales.
      if (sinCedula.length || sinTraslado.length) {
        const li = (arr: string[]) =>
          arr.slice(0, 15).map(x => `<li>${x}</li>`).join('') +
          (arr.length > 15 ? `<li>… y ${arr.length - 15} más</li>` : '');
        await Swal.fire({
          icon: 'warning',
          title: 'Precarga con pendientes',
          html:
            `<div style="text-align:left; max-height:320px; overflow:auto;">` +
            (sinCedula.length ? `<b>Sin cédula escaneada (${sinCedula.length}):</b><ul>${li(sinCedula)}</ul>` : '') +
            (sinTraslado.length ? `<b>Sin traslado EPS (${sinTraslado.length}):</b><ul>${li(sinTraslado)}</ul>` : '') +
            `</div>Puedes adjuntarlos manualmente antes de enviar. La <b>ARL</b> y la <b>SST</b> se adjuntan manual.`,
        });
      }

      // 6) Misma validación del flujo manual (frontend + backend + diálogos).
      await this.validarTodo();
    } catch (e) {
      this.closeSwal();
      console.error('[precargarCierreDeHoy] no se pudo precargar:', e);
      Swal.fire({
        icon: 'error',
        title: 'No se pudo precargar el cierre',
        text: 'No fue posible descargar la contratación de hoy desde el sistema. Adjunta los archivos manualmente.',
      });
    }
  }

  /**
   * Descarga un archivo de media como Blob.
   *
   * Las rutas relativas (`/media/...`, como las devuelve el endpoint de
   * traslados) se resuelven contra `environment.mediaUrl` — el dominio FIJO de
   * prod donde viven los archivos físicos — y NUNCA contra `apiUrl`: el Django
   * de la LAN no sirve /media (eso lo hace nginx en el dominio). Mismo patrón
   * que `resolveSolicitudUrl` de eps-transfers.
   */
  private async descargarArchivo(url: string): Promise<Blob | null> {
    try {
      let abs = String(url ?? '').trim().replace(/\\/g, '/');
      if (!/^https?:\/\//i.test(abs)) {
        const mediaBase = String((environment as any).mediaUrl || '').replace(/\/+$/, '');
        const idx = abs.toLowerCase().indexOf('/media/');
        const path = idx >= 0 ? abs.substring(idx) : (abs.startsWith('/') ? abs : `/${abs}`);
        abs = `${mediaBase}${path}`;
      }
      const resp = await fetch(abs);
      return resp.ok ? await resp.blob() : null;
    } catch {
      return null;
    }
  }

  ngOnDestroy(): void {
    this.terminateWorker();
  }

  // ---------------------------------------------------------------------------
  // INIT & WORKER
  // ---------------------------------------------------------------------------

  private initWorker() {
    if (typeof Worker !== 'undefined') {
      try {
        this.arlWorker = new Worker(new URL('./arl-export.worker', import.meta.url));
        this.arlWorker.onmessage = ({ data }) => {
          if (data.success) {
            this.handleWorkerSuccess(data.fileData);
          } else {
            this.handleWorkerError(data.error);
          }
        };
      } catch (e) {
        console.warn('Worker init failed', e);
      }
    }
  }

  private terminateWorker() {
    this.arlWorker?.terminate();
  }

  private initForm() {
    this.reporteForm = this.fb.group<ReportForm>({
      sede: new FormControl(null, Validators.required),
      esDeHoy: new FormControl('false', { nonNullable: true }),
      fecha: new FormControl(null),
      contratosHoy: new FormControl('', { validators: [Validators.required], nonNullable: true }),

      cedulasEscaneadas: new FormControl(false, { nonNullable: true }),
      cruceDiario: new FormControl(true, { nonNullable: true }),
      arl: new FormControl(false, { nonNullable: true }),
      induccionSSO: new FormControl(false, { nonNullable: true }),
      traslados: new FormControl(false, { nonNullable: true }),

      cantidadContratosTuAlianza: new FormControl(null),
      cantidadContratosApoyoLaboral: new FormControl(null),
      notas: new FormControl('', { nonNullable: true }),
    });

    // Validaciones reactivas
    this.reporteForm.controls.esDeHoy.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(val => {
      if (val === 'true') {
        this.reporteForm.controls.fecha.clearValidators();
        this.reporteForm.controls.fecha.setValue(null);
      } else {
        this.reporteForm.controls.fecha.setValidators(Validators.required);
      }
      this.reporteForm.controls.fecha.updateValueAndValidity();
    });

    this.reporteForm.controls.contratosHoy.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(val => {
      this.handleContratosChange(val);
      this.cdr.markForCheck();
    });
  }

  private async loadUser() {
    const user = this.utilityService.getUser();
    if (user?.datos_basicos) {
      this.nombre = `${user.datos_basicos.nombres} ${user.datos_basicos.apellidos}`;
      this.cdr.markForCheck();
    }
  }

  private async loadSedes() {
    try {
      const data: any = await firstValueFrom(this.utilityService.traerSucursales());
      if (Array.isArray(data)) {
        const activas = data
          .filter(s => s.activa)
          .sort((a, b) => a.nombre.localeCompare(b.nombre));
        // Multi-sede (V62): el reporte solo puede cerrarse sobre una oficina del
        // alcance del usuario. ADMIN/GERENCIA no se recortan; el resto ve las suyas.
        this.sedes = activas.filter(s => this.sedeScope.alcanza(s?.nombre));
        if (!this.sedes.length) this.sedes = activas;
        this.cdr.markForCheck();
      }
    } catch (e) {
      console.error('Error cargando sedes', e);
    }
  }

  // ---------------------------------------------------------------------------
  // GETTERS & UI HELPERS
  // ---------------------------------------------------------------------------

  get totalFilesLoaded(): number {
    return Object.values(this.fileNames).filter(Boolean).length;
  }

  get isFormValid(): boolean {
    return this.reporteForm.valid;
  }

  get showValidateButton(): boolean {
    return this.reporteForm.controls.contratosHoy.value === 'si';
  }

  get arlErrorStats(): {
    total: number;
    sinArl: number;
    fechaDiff: number;
    duplicados: number;
    cedulasAfectadas: number;
  } {
    const errs = this.arlErrors ?? [];
    let sinArl = 0, fechaDiff = 0, duplicados = 0;
    const cedulas = new Set<string>();

    for (const e of errs) {
      const msg = String(e?.error ?? '');
      if (e?.cedula) cedulas.add(String(e.cedula));

      if (msg.startsWith('No existe en ARL')) sinArl++;
      else if (msg.startsWith('Múltiples registros en ARL')) duplicados++;
      else if (msg.startsWith('Fecha de ingreso')) fechaDiff++;
    }

    return {
      total: errs.length,
      sinArl,
      fechaDiff,
      duplicados,
      cedulasAfectadas: cedulas.size,
    };
  }

  // ---------------------------------------------------------------------------
  // FILE HANDLING
  // ---------------------------------------------------------------------------

  onCheckboxChange(checked: boolean, key: UploadControl) {
    // El Cruce Diario es obligatorio: no se puede desmarcar.
    if (key === 'cruceDiario' && !checked) {
      this.reporteForm.get(key)?.setValue(true);
      Swal.fire({
        icon: 'info',
        title: 'Cruce Diario obligatorio',
        text: 'El archivo de Cruce Diario debe adjuntarse en todo reporte. No se puede desactivar.',
        timer: 2400,
        showConfirmButton: false,
      });
      this.cdr.markForCheck();
      return;
    }

    this.reporteForm.get(key)?.setValue(checked);
    if (!checked) {
      this.clearFile(key);
    }
    this.cdr.markForCheck();
  }

  onFileSelect(event: Event, key: UploadControl) {
    const input = event.target as HTMLInputElement;
    const rawFiles = input.files ? Array.from(input.files) : [];
    input.value = ''; // Reset input

    if (!rawFiles.length) return;

    // Filter Files
    const allowed: File[] = [];
    const ignored: { name: string; razon: string }[] = [];

    const labelFor = (k: UploadControl): string => ({
      cedulasEscaneadas: 'Cédulas Escaneadas',
      cruceDiario: 'Cruce Diario',
      arl: 'ARL',
      induccionSSO: 'Inducción SSO',
      traslados: 'Traslados',
    })[k];

    for (const f of rawFiles) {
      const lower = f.name.toLowerCase();

      if (this.BLOCKED_FILES.has(lower)) {
        ignored.push({
          name: f.name,
          razon: 'Nombre de archivo no permitido (archivo de sistema o plantilla vacía).',
        });
        continue;
      }

      const ext = lower.split('.').pop() || '';
      const isExcel = ['xls', 'xlsx', 'csv'].includes(ext);
      const isPdf = ext === 'pdf';

      if (['cedulasEscaneadas', 'induccionSSO', 'traslados'].includes(key) && !isPdf) {
        ignored.push({
          name: f.name,
          razon: `El campo "${labelFor(key)}" solo acepta archivos PDF (recibido: .${ext || 'sin extensión'}).`,
        });
        continue;
      }
      if (['cruceDiario', 'arl'].includes(key) && !isExcel) {
        ignored.push({
          name: f.name,
          razon: `El campo "${labelFor(key)}" solo acepta Excel (.xls, .xlsx) o .csv (recibido: .${ext || 'sin extensión'}).`,
        });
        continue;
      }

      allowed.push(f);
    }

    if (ignored.length) {
      const items = ignored
        .map(i => `<li><b>${i.name}</b> — ${i.razon}</li>`)
        .join('');
      Swal.fire({
        icon: 'warning',
        title: `${ignored.length} archivo(s) no se cargaron`,
        html: `
          <p style="margin:0 0 8px 0; text-align:left;">Estos archivos fueron ignorados:</p>
          <ul style="text-align:left; max-height:260px; overflow:auto; padding-left:18px;">${items}</ul>
          <p style="margin:10px 0 0 0; font-size:0.9em; text-align:left; color:#475569;">
            Corrige el tipo de archivo o el nombre y vuelve a intentarlo.
          </p>`,
      });
    }

    if (allowed.length > 0) {
      // Set files
      this.files[key] = allowed;
      this.fileNames[key] = allowed.length > 1 ? `${allowed.length} archivos` : allowed[0].name;

      // Reset invalidation states
      if (['cruceDiario', 'cedulasEscaneadas', 'traslados'].includes(key)) this.isCruceValidado = false;
      if (key === 'arl') this.isArlValidado = false;

      // Direct Previews
      if (key === 'cedulasEscaneadas') {
        this.generateCedulasPreview(allowed);
        const invalid = this.cedulasPreview.filter(p => !p.valido);
        if (invalid.length > 0) {
          this.checkAndShowPreviewErrors(this.cedulasPreview, 'cedulas');
          // Auditoría silenciosa de lo que muestra el previsualizador.
          void this.saveErrorsSilently(
            invalid.map(p => ({
              cedula: String(p.documento || p.nombreArchivo || 'SIN_CEDULA'),
              error: `Archivo "${p.nombreArchivo}": ${p.error}`,
            })),
            'Cédulas Escaneadas - Previsualizador',
          );
        }
      }
      if (key === 'traslados') {
        this.generateTrasladosPreview(allowed);
        const invalid = this.trasladosPreview.filter(p => !p.valido);
        if (invalid.length > 0) {
          this.checkAndShowPreviewErrors(this.trasladosPreview, 'traslados');
          void this.saveErrorsSilently(
            invalid.map(p => ({
              cedula: String(p.documento || p.nombreArchivo || 'SIN_CEDULA'),
              error: `Archivo "${p.nombreArchivo}": ${p.error}`,
            })),
            'Traslados - Previsualizador',
          );
        }
      }

      if (key === 'arl') {
        void this.validateArlOnUpload(allowed[0]);
      }
    }

    this.cdr.markForCheck();
  }

  private clearFile(key: UploadControl) {
    delete this.files[key];
    delete this.fileNames[key];

    if (key === 'cedulasEscaneadas') this.cedulasPreview = [];
    if (key === 'traslados') this.trasladosPreview = [];

    if (['cruceDiario', 'cedulasEscaneadas', 'traslados'].includes(key)) this.isCruceValidado = false;
    if (key === 'arl') this.isArlValidado = false;
  }

  private handleContratosChange(val: string) {
    if (val !== 'si') {
      // Reset all EXCEPT cruceDiario (obligatorio para todo reporte).
      ['cedulasEscaneadas', 'arl', 'induccionSSO', 'traslados'].forEach(k => {
        this.reporteForm.get(k)?.setValue(false);
        this.clearFile(k as UploadControl);
      });
      // cruceDiario siempre debe seguir marcado; no borramos el archivo ya seleccionado.
      this.reporteForm.controls.cruceDiario.setValue(true);
      this.reporteForm.patchValue({
        cantidadContratosTuAlianza: null,
        cantidadContratosApoyoLaboral: null,
        notas: ''
      });
      this.arlRows = [];
    }
  }

  // ---------------------------------------------------------------------------
  // LOGIC & PREVIEWS
  // ---------------------------------------------------------------------------

  openPreview(type: 'cedulas' | 'traslados') {
    const items = type === 'cedulas' ? this.cedulasPreview : this.trasladosPreview;
    this.checkAndShowPreviewErrors(items, type, true);
  }

  private generateCedulasPreview(files: File[]) {
    this.cedulasPreview = files.map(f => {
      const name = f.name;

      // Obligatorio que tenga un guión
      const match = name.match(/^\s*([a-zA-Z0-9]+)\s*-\s*(.+?)\.pdf$/i);

      if (match) {
        const doc = match[1];
        const normalized = this.normalizeIdentity(doc);
        const isValidDoc = /^(\d+|X[a-zA-Z0-9]+)$/i.test(normalized);

        return {
          nombreArchivo: name,
          documento: normalized, // Important: pass normalized doc to preview/validation
          valido: isValidDoc,
          error: isValidDoc ? null : 'Documento inválido (Solo números o X...)'
        };
      }

      return { nombreArchivo: name, valido: false, error: 'Formato inválido. Use CEDULA-Nombre.pdf (requiere guión)' };
    });
  }

  private generateTrasladosPreview(files: File[]) {
    this.trasladosPreview = files.map(f => {
      const name = f.name;
      if (!name.toLowerCase().endsWith('.pdf')) return { nombreArchivo: name, valido: false, error: 'No PDF' };
      const parts = name.slice(0, -4).split('-');
      if (parts.length < 2) return { nombreArchivo: name, valido: false, error: 'Falta guión (-)' };
      const doc = parts[0].trim();
      const startEps = parts.slice(1).join('-').trim(); // Raw EPS part

      if (!/^[0-9xX]+$/.test(doc)) return { nombreArchivo: name, valido: false, error: 'Doc inválido' };

      // EPS Check
      const epsCanonical = this.resolveEps(startEps);
      return {
        nombreArchivo: name, documento: doc, eps: epsCanonical || startEps, valido: !!epsCanonical,
        error: !!epsCanonical ? null : 'EPS Desconocida. Use SALUD TOTAL o NUEVA EPS'
      };
    });
  }

  private resolveEps(raw: string): string | null {
    const normalized = raw.toLowerCase().replace(/[^a-z]/g, '');
    if (['saludtotal', 'salud total'].includes(normalized)) return 'SALUDTOTAL';
    if (['nuevaeps', 'nueva eps'].includes(normalized)) return 'NUEVAEPS';
    return null;
  }

  private checkAndShowPreviewErrors(items: any[], type: string, forceShow = false) {
    const invalid = items.filter(i => !i.valido);
    if (invalid.length > 0 || forceShow) {
      const html = invalid.length
        ? `<ul style="text-align:left; max-height:300px; overflow:auto;">${invalid.map(i => `<li><b>${i.nombreArchivo}</b>: ${i.error}</li>`).join('')}</ul>`
        : '<p class="text-success">Todos los archivos parecen correctos.</p>';

      Swal.fire({
        title: `${type === 'cedulas' ? 'Cédulas' : 'Traslados'}`,
        html,
        icon: invalid.length ? 'error' : 'success'
      });
    }
  }

  // ---------------------------------------------------------------------------
  // MAIN ACTION: VALIDAR TODO
  // ---------------------------------------------------------------------------

  public isValidatingAll = false;

  async onSubmit() {
    if (this.reporteForm.invalid) return;

    const checks = this.reporteForm.getRawValue();

    // El Cruce Diario solo es obligatorio cuando SÍ hubo contratación.
    // Si el usuario declara que no hubo contratación, el reporte queda como "sin movimientos".
    if (checks.contratosHoy === 'si' && !this.files.cruceDiario?.length) {
      Swal.fire({
        icon: 'warning',
        title: 'Falta el Cruce Diario',
        html:
          'El archivo Excel de <b>Cruce Diario</b> es obligatorio cuando hubo contratación.<br>' +
          'Adjúntalo antes de enviar — sin él el reporte no queda registrado.',
      });
      return;
    }

    if (checks.contratosHoy === 'si') {
      if (!this.isCruceValidado) {
        Swal.fire('Falta Validar', 'Debe validar el Cruce Diario antes de enviar.', 'warning');
        return;
      }
      if (checks.arl && this.arlErrors.length > 0) {
        Swal.fire('Errores ARL', `Hay ${this.arlErrors.length} error(es) en la validación ARL. Revise la tabla de errores.`, 'error');
        return;
      }
      if (checks.arl && !this.isArlValidado) {
        Swal.fire('Falta ARL', 'Debe procesar el archivo ARL antes de enviar. (Validar Todo)', 'warning');
        return;
      }
    }

    Swal.fire({ title: 'Enviando...', didOpen: () => Swal.showLoading() });

    try {
      const { payload, files } = this.buildReporteRequest();

      // Guard defensivo final: si el usuario marcó que SÍ hubo contratación,
      // el cruce_document debe estar presente al momento del envío.
      if (checks.contratosHoy === 'si' && !files.cruce_document) {
        this.closeSwal();
        Swal.fire({
          icon: 'error',
          title: 'Error interno',
          text: 'El archivo de Cruce Diario se perdió antes del envío. Vuelve a adjuntarlo.',
        });
        return;
      }

      const resp: any = await firstValueFrom(this.reportesService.createReporte(payload, files));

      this.closeSwal();
      // Offline: el interceptor encola el reporte y devuelve un 200 "mock". No
      // afirmamos "enviado al servidor"; quedó local y se subirá al reconectar.
      if (isOfflineQueued(resp)) {
        Swal.fire({
          icon: 'info',
          title: 'Guardado sin conexión',
          html:
            'El reporte y sus archivos quedaron guardados en este equipo.' +
            '<br><br>Se enviarán automáticamente cuando vuelva la conexión. ' +
            'Puedes ver el avance en el indicador de red (arriba a la derecha).',
        }).then(() => {
          this.router.navigate(['/dashboard/hiring/hiring-report']);
        });
      } else {
        // El reporte ya quedo guardado con su Excel adjunto. Ahora se baja el
        // contenido del cruce a la base: hasta aqui el Excel solo se validaba y
        // se archivaba como documento, y ninguna fila llegaba a
        // procesoContratacion -- por eso los codigos de contrato del informe no
        // existian en produccion.
        let resumen = '';
        if (checks.contratosHoy === 'si' && this.datoscruced.length) {
          resumen = await this.guardarCruceEnBase();
        }

        Swal.fire({
          icon: 'success',
          title: 'Enviado',
          html: 'Reporte enviado correctamente.' + resumen,
        }).then(() => {
          this.router.navigate(['/dashboard/hiring/hiring-report']);
        });
      }

    } catch (e: any) {
      this.closeSwal();
      console.error('[onSubmit] Error al enviar reporte:', e);
      const errorMsg = this.parseBackendError(e);

      const estado = e?.status;
      let cabecera = 'No se pudo enviar el reporte';
      if (estado === 0) cabecera = 'Sin conexión con el servidor';
      else if (estado === 401 || estado === 403) cabecera = 'Sesión expirada o sin permisos';
      else if (estado === 413) cabecera = 'Los archivos son demasiado grandes';
      else if (estado === 500) cabecera = 'Error interno del servidor';

      Swal.fire({
        icon: 'error',
        title: cabecera,
        html:
          (errorMsg && errorMsg.trim()
            ? errorMsg
            : 'El servidor respondió con un error sin detalle.') +
          `<br><br><small style="color:#64748b;">` +
          (estado ? `Código HTTP: ${estado}. ` : '') +
          `Si ves este mensaje varias veces, toma una captura y envíala a soporte.</small>`,
      });
    }
  }

  /**
   * Baja las filas ya validadas del cruce a la base de datos.
   *
   * Se llama DESPUES de crear el reporte, a proposito: si el guardado masivo
   * falla, el reporte y su Excel ya quedaron a salvo y se puede reintentar.
   * Nunca lanza -- devuelve un resumen en HTML para el Swal final.
   */
  private async guardarCruceEnBase(): Promise<string> {
    const BATCH = 500;
    const rows = this.datoscruced;
    const chunks = Math.ceil(rows.length / BATCH);

    let creados = 0, actualizados = 0;
    const omitidos: any[] = [], errores: any[] = [], conflictos: any[] = [];
    let lotesFallidos = 0;

    Swal.fire({ title: 'Guardando contratación...', didOpen: () => Swal.showLoading() });

    // Secuencial: son escrituras, no conviene que tres lotes toquen las mismas
    // filas a la vez.
    for (let i = 0; i < chunks; i++) {
      this.updateSwalProgress(`Guardando lote ${i + 1} de ${chunks}...`, i + 1, chunks);
      const chunk = rows.slice(i * BATCH, (i + 1) * BATCH);
      try {
        const res: any = await this.hiringService.subirContratacion(chunk);
        creados += res?.creados ?? 0;
        actualizados += res?.actualizados ?? 0;
        if (Array.isArray(res?.omitidos)) omitidos.push(...res.omitidos);
        if (Array.isArray(res?.errores)) errores.push(...res.errores);
        if (Array.isArray(res?.conflictos)) conflictos.push(...res.conflictos);
      } catch (e) {
        lotesFallidos++;
        console.error(`[guardarCruceEnBase] lote ${i + 1}/${chunks} falló:`, e);
      }
    }
    this.closeSwal();

    const problemas = [...omitidos, ...errores].map(x => ({
      cedula: x.cedula || 'SIN_CEDULA',
      error: `Fila ${x.fila}: ${x.motivo || x.error}`,
    }));
    if (problemas.length) {
      void this.saveErrorsSilently(problemas, 'Cruce Diario - Guardado en base');
    }

    const guardados = creados + actualizados;
    let html = `<br><br><b>Contratación guardada:</b> ${guardados} de ${rows.length} `
      + `(${creados} nuevas, ${actualizados} actualizadas).`;
    if (omitidos.length) html += `<br><span style="color:#b45309;">${omitidos.length} fila(s) sin cédula o sin código, no se guardaron.</span>`;
    if (errores.length) html += `<br><span style="color:#b91c1c;">${errores.length} fila(s) con error.</span>`;
    if (lotesFallidos) html += `<br><span style="color:#b91c1c;">${lotesFallidos} lote(s) no se pudieron enviar. Vuelve a enviar el reporte para reintentar.</span>`;
    if (conflictos.length) {
      html += `<br><span style="color:#b45309;">${conflictos.length} código(s) de contrato ya existían a nombre de otra cédula `
        + `(ej. ${conflictos[0].codigo_contrato} → ${conflictos[0].ya_usado_por?.[0]}). Se guardaron igual; revísalos.</span>`;
    }
    return html;
  }

  async validarTodo() {
    if (this.isValidatingAll) return;

    if (!this.files.cruceDiario?.length) {
      Swal.fire({
        icon: 'warning',
        title: 'Falta el archivo de Cruce Diario',
        html:
          'Antes de validar, marca la casilla <b>"Cruce Diario (Excel)"</b> y haz clic en ' +
          '<b>"Seleccionar"</b> para adjuntar el archivo <b>.xlsx</b> del día.',
      });
      return;
    }

    // Explicitly run inside zone for state update
    this.zone.run(() => {
      this.isValidatingAll = true;
      this.cdr.detectChanges();
    });

    this.showLoading('Validando...', 'Procesando Cruce Diario y ARL...');

    try {
      // 1. Validar Cruce
      const cruceOk = await this.processCruce();

      if (!cruceOk) {
        // processCruce returns false if cancelled OR if critical errors remain
        return;
      }

      // 2. Validar ARL (si aplica)
      if (this.reporteForm.controls.arl.value && this.files.arl?.length) {
        await this.processArl(this.files.arl[0]);
      }

      this.closeSwal();
      // Success Swal removed per request

    } catch (e: any) {
      this.closeSwal();
      console.error('[validarTodo] Error inesperado:', e);
      const detalle =
        (e && typeof e.message === 'string' && e.message) ||
        (typeof e === 'string' ? e : '') ||
        'Sin detalle disponible del error.';
      Swal.fire({
        icon: 'error',
        title: 'No se pudo completar la validación',
        html:
          `Ocurrió un problema mientras validábamos los archivos.<br><br>` +
          `<b>Detalle:</b> ${detalle}<br><br>` +
          `Revisa que los Excel no estén abiertos en otra ventana ` +
          `y que no estén protegidos con contraseña. Si persiste, contacta a soporte.`,
      });
    } finally {
      // Ensure UI update happens in next tick to avoid conflicts with Swal closing
      this.zone.run(() => {
        setTimeout(() => {
          this.isValidatingAll = false;
          this.cdr.markForCheck(); // Mark for check
          this.cdr.detectChanges(); // Force check
        }, 100);
      });
    }
  }

  // ---------------------------------------------------------------------------
  // CRUCE LOGIC
  // ---------------------------------------------------------------------------

  private async processCruce(): Promise<boolean> {
    const file = this.files.cruceDiario![0];
    const wb = await this.readExcel(file);

    // Limpieza previa (tildes y caracteres especiales), igual que home.
    // Las celdas con fechas se dejan intactas.
    this.cleanWorkbookLikeHome(wb);

    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rawJson = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '-', raw: true });

    if (rawJson.length < 2) {
      throw new Error(
        `El archivo de Cruce Diario "${file.name}" está vacío o solo contiene el encabezado. ` +
        `Necesita al menos una fila con datos de contratación (cédula, fecha de ingreso, etc.).`,
      );
    }

    const headerRow = rawJson[0] as string[]; // Fila 0 de headers
    this.cruceHeaderRow = headerRow; // Guardar para uso posterior (ARL report)
    const dataRows = rawJson.slice(1) as any[][];

    // 1 & 2. Normalizar filas y Contar AL/TA simultáneamente (O(N))
    const totalRows = dataRows.length;
    this.datoscruced = new Array(totalRows);
    let al = 0, ta = 0;

    for (let i = 0; i < totalRows; i++) {
        const normalized = this.normalizeRow(dataRows[i]);
        this.datoscruced[i] = normalized;
        
        const tem = (normalized[2] || '').toUpperCase().trim();
        if (tem === 'AL') al++;
        else if (tem === 'TA') ta++;
    }

    this.reporteForm.patchValue({ cantidadContratosApoyoLaboral: al, cantidadContratosTuAlianza: ta });

    // 3. Pre-Validation (Frontend)
    const cruceRows = CruceValidationHelper.parseRows(this.datoscruced, headerRow);
    const uploadedRef = {
      cedulas: this.getDocList('cedulasEscaneadas'),
      traslados: this.getDocList('traslados')
    };
    const schema = CruceValidationHelper.getSchema(headerRow, uploadedRef);

    const issues = [
      ...(schema.validateItem ? cruceRows.flatMap(r => schema.validateItem!(r)) : []),
      ...(schema.validateAll ? schema.validateAll(cruceRows) : [])
    ].filter(i => i.severity === 'error');

    // 4. Dialog if local issues
    if (issues.length > 0) {
      // Guardado silencioso en backend: auditoría de lo que el previsualizador
      // detectó antes de la corrección del usuario.
      const preValErrors = issues.map(issue => {
        const item = cruceRows.find(r => r._id === issue.itemId);
        const cedula = item?.cedula || 'SIN_CEDULA';
        const campo = issue.field ? ` [${issue.field}]` : '';
        return {
          cedula,
          error: `${issue.message}${campo}`,
        };
      });
      void this.saveErrorsSilently(preValErrors, 'Cruce Diario - Pre-validación');

      this.closeSwal();
      const res = await this.openCruceDialog(cruceRows, schema, uploadedRef, [], 'pre');
      if (!res) return false; // Cancelled
      this.datoscruced = res;
    }

    // 5. Backend Validation
    const backendErrors = await this.validateBatchesBackend(this.datoscruced);
    this.erroresValidacion.data = backendErrors;

    const blockingErrors = backendErrors.filter(e => {
      let rawMsg = e.mensaje || e.message || (Array.isArray(e.errores) ? e.errores.join('. ') : '');
      if (!rawMsg) rawMsg = JSON.stringify(e);
      let fieldVal = e.element || 'general';
      if (rawMsg.toLowerCase().includes('correo') || rawMsg.toLowerCase().includes('email')) fieldVal = 'email';
      return !this.isBackendWarning(rawMsg, fieldVal);
    });

    if (backendErrors.length > 0) {
      this.closeSwal();

      // Snapshot for comparison
      const originalData = this.datoscruced;

      const res = await this.openCruceDialog(
        CruceValidationHelper.parseRows(this.datoscruced, headerRow),
        schema, uploadedRef, backendErrors, 'post'
      );
      if (!res) return false; // Cancelled

      // Local Comparison Function (Robust string[][])
      const hasChanged = (d1: string[][], d2: string[][]): boolean => {
        if (d1.length !== d2.length) return true;
        for (let i = 0; i < d1.length; i++) {
          if (d1[i].length !== d2[i].length) return true;
          for (let j = 0; j < d1[i].length; j++) {
            if (String(d1[i][j]) !== String(d2[i][j])) return true;
          }
        }
        return false;
      };

      const changed = hasChanged(originalData, res);

      if (changed) {
        // Data changed, MUST re-validate
        this.showLoading('Revalidando...', 'Verificando correcciones con el servidor...');
        this.datoscruced = res;
        const reErrors = await this.validateBatchesBackend(this.datoscruced);

        // Check new blocking errors
        const newBlocking = reErrors.filter(e => {
          let rawMsg = e.mensaje || e.message || (Array.isArray(e.errores) ? e.errores.join('. ') : '');
          if (!rawMsg) rawMsg = JSON.stringify(e);
          let fieldVal = e.element || 'general';
          if (rawMsg.toLowerCase().includes('correo') || rawMsg.toLowerCase().includes('email')) fieldVal = 'email';
          return !this.isBackendWarning(rawMsg, fieldVal);
        });

        if (newBlocking.length > 0) {
          await this.saveErrorsToBackend(newBlocking);
          this.erroresValidacion.data = newBlocking;
          return false;
        }
      } else {
        // Data unchanged
        // Should we assume warnings allow continuation? 
        // YES, if blockingErrors was 0, it means we only had warnings initially.
        // If blockingErrors > 0, we still have blocking errors and they weren't fixed (since data didn't change).
        if (blockingErrors.length > 0) {
          await this.saveErrorsToBackend(blockingErrors);
          // Ensure we show the errors even if we don't re-fetch
          this.erroresValidacion.data = blockingErrors;
          return false;
        }
        // If blockingErrors == 0, we proceed directly.
      }
    }

    this.isCruceValidado = true;
    return true;
  }

  /**
   * Ancho minimo de una fila del cruce.
   *
   * El backend (`subidadeusuariosarchivoexcel`) mapea hasta el indice 194, y
   * `sheet_to_json` recorta las celdas vacias del final de cada fila. Rellenar
   * solo a 56 dejaba filas cortas que el backend descartaba en silencio.
   */
  private static readonly CRUCE_MIN_COLS = 195;

  private normalizeRow(row: any[]): string[] {
    const safe = row.map(c => (c === null || c === undefined) ? '-' : String(c).trim());
    while (safe.length < HiringReportComponent.CRUCE_MIN_COLS) safe.push('-');

    // Sanitize Critical Columns
    // Col 1 = Cedula, Col 11 = NIT (Indices 1 and 11)
    if (safe[1]) safe[1] = this.normalizeIdentity(safe[1]);
    if (safe[11]) safe[11] = this.normalizeIdentity(safe[11]);

    // Normalize Dates (Col 8, 16, 24, 44 [AnioFin can be date])
    [8, 16, 24, 44].forEach(idx => {
      if (safe[idx] && safe[idx] !== '-' && safe[idx].length >= 4) {
        safe[idx] = this.tryNormalizeDate(safe[idx]);
      }
    });

    return safe;
  }

  /* sanitizeIdentity - removed, use normalizeIdentity */


  private tryNormalizeDate(val: string): string {
    // Si tiene letras o formato no apto, devolver crudo para que el validador estricto lo atrape
    if (!val || /[a-zA-Z]/.test(val)) return val;

    // 1. Handle Excel Serial Numbers (e.g. "44567" or "44567.123")
    // Pre check sin RegEx: si no tiene / ni -
    if (val.indexOf('/') === -1 && val.indexOf('-') === -1) {
      const isNum = /^\d+(\.\d+)?$/.test(val);
      if (isNum) {
        const serial = Number(val);
        if (serial > 20000 && serial < 80000) {
          const ms = Date.UTC(1899, 11, 30) + (serial * 24 * 60 * 60 * 1000);
          const d = new Date(ms);
          if (!isNaN(d.getTime())) {
            return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
          }
        }
      }
    }

    // 2. Si ya es una fecha colombiana clásica con 4 dígitos, la validamos rápido por longitud
    if (val.length >= 8 && val.length <= 10 && val.indexOf('/') > 0) {
        if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(val)) return val;
    }

    // 3. Robust Parse for DD/MM/YY or DD-MM-YYYY
    const parts = val.split(/[/-]/);
    if (parts.length === 3) {
      // Assume DD/MM/YYYY for LATAM
      let d = parseInt(parts[0], 10);
      let m = parseInt(parts[1], 10);
      let y = parseInt(parts[2], 10);

      // Validate assumption: if month > 12 and day <= 12, swap (US format detection)
      if (m > 12 && d <= 12) {
        const temp = d;
        d = m;
        m = temp;
      }

      // Handle 2-digit years
      if (y < 100) {
        // Pivot logic:
        // If year is less than 30, assume 20xx (2000-2029)
        // If year is 30 or more, assume 19xx (1930-1999)
        // This covers birthdates (1994) and modern dates (2025)
        y += (y < 30 ? 2000 : 1900);
      }

      // Basic validity check
      if (d > 0 && d <= 31 && m > 0 && m <= 12 && y > 1900) {
        return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
      }
    }
    return val;
  }

  private async openCruceDialog(items: CruceRow[], schema: any, uploadRef: any, externalErrors: any[], phase: 'pre' | 'post'): Promise<string[][] | null> {
    const ref = this.dialog.open(ValidationPreviewDialogComponent, {
      width: '95vw', maxWidth: '95vw', height: '90vh', disableClose: true,
      data: {
        schema, items, phase,
        externalIssues: this.mapExternalIssues(externalErrors),
        title: phase === 'pre' ? 'Validación Preliminar' : 'Errores del Backend',
        subtitle: 'Revise los datos antes de continuar.',
        uploadHandler: async (f: File) => {
          // Simple handler for adding file to existing list
          const cedula = this.normalizeIdentity(f.name.split('.')[0]);
          // Add to memory if not exists... simplified for dialog interaction
        }
      }
    });


    const res = await firstValueFrom(ref.afterClosed());
    if (!res?.accepted) return null;

    // Use raw array if available to prevent field reordering or loss
    return res.items.map((i: any) => Array.isArray(i.raw) ? i.raw : (Array.isArray(i) ? i : []));
  }

  private async validateBatchesBackend(rows: string[][]): Promise<any[]> {
    const BATCH = 1500;
    const CONCURRENCY = 3; // Enviar hasta 3 lotes al mismo tiempo
    const errors: any[] = [];
    const chunks = Math.ceil(rows.length / BATCH);

    for (let i = 0; i < chunks; i += CONCURRENCY) {
      const top = Math.min(i + CONCURRENCY, chunks);
      this.updateSwalProgress(`Validando lotes ${i + 1} a ${top} de ${chunks}...`, top, chunks);

      const batchPromises = [];
      for (let j = 0; j < CONCURRENCY && (i + j) < chunks; j++) {
        const chunkIndex = i + j;
        const chunk = rows.slice(chunkIndex * BATCH, (chunkIndex + 1) * BATCH);
        
        batchPromises.push(
          this.hiringService.subirContratacionValidar(chunk)
            .then((res: any) => {
              if (res?.status === 'error' && Array.isArray(res.errores)) {
                return res.errores;
              }
              return [];
            })
            .catch(err => {
              console.error(`[validateBatchesBackend] Error en lote ${chunkIndex + 1}:`, err);
              const detalle =
                (err && typeof err.message === 'string' && err.message) ||
                (typeof err === 'string' ? err : 'Sin detalle del servidor.');
              return [{
                mensaje:
                  `No se pudo validar el lote ${chunkIndex + 1} de ${chunks} contra el servidor. ` +
                  `Detalle: ${detalle}. Revisa tu conexión e intenta "Validar Todo" nuevamente.`,
              }];
            })
        );
      }

      const results = await Promise.all(batchPromises);
      for (const errArray of results) {
        errors.push(...errArray);
      }
    }
    
    return errors;
  }

  /** Oficina seleccionada en el formulario; se guarda junto a cada error. */
  private get oficinaSeleccionada(): string {
    return this.reporteForm.getRawValue()?.sede?.nombre || '';
  }

  private async saveErrorsToBackend(errors: any[]) {
    try {
      const payload = {
        errores: errors,
        responsable: this.nombre,
        oficina: this.oficinaSeleccionada,
        tipo: 'Documento de Contratación',
      };
      await this.hiringService.enviarErroresValidacion(payload);
      Swal.fire({
        icon: 'warning',
        title: 'El reporte aún tiene errores',
        html:
          `Después de corregir, siguen existiendo <b>${errors.length}</b> error(es) bloqueantes.<br>` +
          `Ya guardamos el listado en el servidor para seguimiento, pero <b>el reporte NO fue enviado</b>.<br><br>` +
          `Corrige los errores restantes y vuelve a darle a "Validar Todo" antes de enviar.`,
      });
    } catch (e: any) {
      console.error('[saveErrorsToBackend] Falló:', e);
      const detalle = (e && typeof e.message === 'string' ? e.message : '') || 'Sin detalle.';
      Swal.fire({
        icon: 'error',
        title: 'No se pudo guardar el listado de errores',
        html:
          `No logramos guardar los errores en el servidor.<br><br>` +
          `<b>Detalle técnico:</b> ${detalle}<br><br>` +
          `Verifica tu conexión a internet y vuelve a intentarlo. ` +
          `Si persiste, contacta a soporte con una captura de esta pantalla.`,
      });
    }
  }

  /**
   * Envía errores al backend sin mostrar Swal.
   * Agrupa por 'registro' (cédula) para que cada persona lleve todos sus errores juntos.
   */
  private async saveErrorsSilently(
    rawErrors: { cedula: string; error: string }[],
    tipo: string,
  ): Promise<void> {
    if (!rawErrors.length) return;

    const grouped = new Map<string, string[]>();
    for (const err of rawErrors) {
      const key = (err.cedula || 'SIN_CEDULA').toString();
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(err.error);
    }

    const errores = Array.from(grouped.entries()).map(([registro, errs]) => ({
      registro,
      errores: errs,
    }));

    try {
      await this.hiringService.enviarErroresValidacion({
        errores,
        responsable: this.nombre,
        oficina: this.oficinaSeleccionada,
        tipo,
      });
    } catch (e) {
      // Silencioso: no mostrar Swal, solo log.
      console.error(`[${tipo}] Envío silencioso de errores falló:`, e);
    }
  }

  // ---------------------------------------------------------------------------
  // ARL PROCESSING (WORKER)
  // ---------------------------------------------------------------------------

  /**
   * Lee el ARL, valida que tenga las columnas requeridas y devuelve datos + índices.
   * Si falla, muestra un Swal explicativo y retorna null. Reusable desde onFileSelect
   * (verificación inmediata al adjuntar) y desde validarTodo (procesamiento completo).
   */
  private async parseAndValidateArl(
    file: File,
  ): Promise<{ indices: { dni: number; vig: number }; data: any[][] } | null> {
    let wb: XLSX.WorkBook;
    try {
      wb = await this.readExcel(file);
    } catch (e: any) {
      Swal.fire({
        icon: 'error',
        title: 'No se pudo leer el archivo ARL',
        html:
          `Ocurrió un error al abrir <b>${file.name}</b>.<br><br>` +
          `<b>Detalle:</b> ${(e && e.message) || 'Sin detalle.'}<br><br>` +
          `Verifica que no esté abierto en otra ventana ni protegido con contraseña.`,
      });
      return null;
    }

    const sheet = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '', raw: true });

    if (data.length < 2) {
      Swal.fire({
        icon: 'warning',
        title: 'El archivo ARL está vacío',
        html:
          `El archivo <b>${file.name}</b> está vacío o solo tiene el encabezado. ` +
          `Verifica que contenga al menos una fila de datos.`,
      });
      return null;
    }

    const headers = data[0].map(h => String(h).toUpperCase().trim());
    const idxDni = headers.findIndex(h => h.includes('DNI') && h.includes('TRABAJADOR'));
    const idxVig = headers.findIndex(h => h.includes('INICIO') && h.includes('VIGENCIA'));

    if (idxDni === -1 || idxVig === -1) {
      const faltantes: string[] = [];
      if (idxDni === -1) faltantes.push('"DNI TRABAJADOR"');
      if (idxVig === -1) faltantes.push('"INICIO VIGENCIA"');

      Swal.fire({
        icon: 'error',
        title: 'El archivo ARL no tiene las columnas necesarias',
        html:
          `No se encontró la(s) columna(s) ${faltantes.join(' y ')} en el archivo ` +
          `<b>${file.name}</b>.<br><br>` +
          `Abre el Excel y revisa la <b>primera fila</b> (encabezados). Debe tener:<br>` +
          `• Una columna cuyo nombre contenga <b>DNI TRABAJADOR</b>.<br>` +
          `• Una columna cuyo nombre contenga <b>INICIO VIGENCIA</b>.<br><br>` +
          `Sin estas columnas no se puede validar ARL.`,
      });
      return null;
    }

    return { indices: { dni: idxDni, vig: idxVig }, data };
  }

  /**
   * Verificación inmediata al adjuntar el ARL. Si las columnas no son válidas,
   * limpia el archivo para forzar re-adjuntar.
   */
  private async validateArlOnUpload(file: File): Promise<void> {
    const result = await this.parseAndValidateArl(file);
    if (!result) {
      this.clearFile('arl');
      this.cdr.markForCheck();
    }
  }

  private async processArl(file: File) {
    const parsed = await this.parseAndValidateArl(file);
    if (!parsed) {
      this.isArlValidado = false;
      return;
    }

    const { indices, data } = parsed;
    const { dni: idxDni, vig: idxVig } = indices;

    // SANITIZE DNI COLUMN: remover caracteres no alfanuméricos para empatar con el cruce.
    const rawRows = data.slice(1);
    this.arlRows = rawRows.map(row => {
      const val = row[idxDni];
      if (val) {
        const clean = String(val).replace(/[^a-zA-Z0-9]/g, '');
        row[idxDni] = clean;
      }
      return row;
    });

    this.arlIndices = { dni: idxDni, vig: idxVig };
    this.isArlValidado = true;

    this.collectArlErrors();

    // Envío silencioso al backend: toda inconsistencia ARL queda registrada
    // (no existe en ARL, fecha desfasada, duplicados que podrían generar cobros).
    if (this.arlErrors.length > 0) {
      void this.saveErrorsSilently(this.arlErrors, 'Validación ARL');
    }

    this.cdr.markForCheck();
  }

  private collectArlErrors() {
    this.arlErrors = [];
    if (!this.datoscruced.length || !this.arlRows.length) return;

    const { dni, vig } = this.arlIndices;

    // Indexar ARL por cédula
    const arlMap = new Map<string, any[][]>();
    this.arlRows.forEach(row => {
      const cedula = this.normalizeIdentity(row[dni]);
      if (cedula) {
        if (!arlMap.has(cedula)) {
          arlMap.set(cedula, []);
        }
        arlMap.get(cedula)!.push(row);
      }
    });

    // Comparar cada fila del cruce contra ARL
    this.datoscruced.forEach(cruceRow => {
      const cedula = this.normalizeIdentity(cruceRow[1]);
      const fechaIngreso = cruceRow[8];
      const arlRowsForCedula = arlMap.get(cedula);

      if (!arlRowsForCedula || arlRowsForCedula.length === 0) {
        this.arlErrors.push({ cedula, error: 'No existe en ARL' });
      } else {
        // Duplicados en ARL: riesgo de cobro duplicado por retiro.
        if (arlRowsForCedula.length > 1) {
          this.arlErrors.push({
            cedula,
            error: `Múltiples registros en ARL (${arlRowsForCedula.length}) para la misma cédula. Riesgo de cobro duplicado si la persona se retira.`,
          });
        }

        // Comparar fechas
        const dCruce = CruceValidationHelper.parseDate(fechaIngreso);
        let matchFound = false;
        let fechasArlTexto: string[] = [];

        for (const arlRow of arlRowsForCedula) {
          let dArl: Date | null = null;
          const rawFechaArl = arlRow[vig];
          const strArl = String(rawFechaArl || '').trim();

          if (strArl.includes('/')) {
            dArl = CruceValidationHelper.parseDate(strArl);
          } else if (strArl.includes('-')) {
            const parts = strArl.split('-');
            if (parts[0].length === 4) {
              dArl = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
            } else {
              dArl = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
            }
          } else if (typeof rawFechaArl === 'number') {
            const ms = Date.UTC(1899, 11, 30) + (rawFechaArl * 24 * 60 * 60 * 1000);
            const d = new Date(ms);
            // CruceValidationHelper.parseDate returns local midnight Date(Y, M, D).
            if (!isNaN(d.getTime())) {
              dArl = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
            }
          }

          const fmtArl = dArl && !isNaN(dArl.getTime())
            ? `${String(dArl.getDate()).padStart(2, '0')}/${String(dArl.getMonth() + 1).padStart(2, '0')}/${dArl.getFullYear()}`
            : strArl;

          fechasArlTexto.push(fmtArl);

          if (dCruce && dArl && !isNaN(dArl.getTime()) && dCruce.getTime() === dArl.getTime()) {
            matchFound = true;
            break;
          }
        }

        if (!matchFound) {
          const unicas = Array.from(new Set(fechasArlTexto));
          this.arlErrors.push({ cedula, error: `Fecha de ingreso (${fechaIngreso}) diferente a fecha(s) ARL (${unicas.join(' o ')})` });
        }
      }
    });
  }

  // Helper state for ARL indices
  private arlIndices = { dni: 11, vig: 8 };

  downloadArlReport() {
    if (!this.datoscruced.length || !this.arlRows.length) return;

    const headerRow = this.cruceHeaderRow.length > 0
      ? this.cruceHeaderRow
      : CruceValidationHelper.getSchema([], undefined).columns.map(c => c.header);

    const errorsMap: Record<string, string[]> = {};
    this.erroresValidacion.data.forEach(e => {
      const id = String(e.registro || '0');
      if (!errorsMap[id]) errorsMap[id] = [];
      errorsMap[id].push(e.mensaje || e.message);
    });

    const { dni, vig } = this.arlIndices;

    const workerData = {
      cruceRows: this.datoscruced,
      arlRows: this.arlRows,
      headerRowCruce: headerRow,
      indices: { dniTrabajador: dni, inicioVigencia: vig },
      errorsMap
    };

    if (this.arlWorker) {
      // Worker disponible (browser estándar)
      this.showLoading('Generando Excel...', 'El worker está procesando el reporte ARL...');
      this.arlWorker.postMessage(workerData);
    } else {
      // Fallback inline (Electron o entornos sin soporte de Worker)
      this.showLoading('Generando Excel...', 'Procesando el reporte ARL...');
      setTimeout(() => {
        try {
          this.generateArlInline(workerData);
        } catch (e: any) {
          this.closeSwal();
          console.error('[generateArlInline] Falló:', e);
          const detalle =
            (e && typeof e.message === 'string' && e.message) ||
            (typeof e === 'string' ? e : 'Sin detalle disponible.');
          Swal.fire({
            icon: 'error',
            title: 'No se pudo generar el Excel del reporte ARL',
            html:
              `Ocurrió un error al armar el archivo Excel del reporte ARL.<br><br>` +
              `<b>Detalle:</b> ${detalle}<br><br>` +
              `Intenta nuevamente. Si el problema continúa, cierra el navegador y vuelve a abrir.`,
          });
        }
      }, 100);
    }
  }

  private generateArlInline(data: any) {
    const { cruceRows, arlRows, headerRowCruce, indices, errorsMap } = data;

    // Indexar ARL
    const arlMap = new Map<string, any[][]>();
    arlRows.forEach((row: any[]) => {
      const cedula = this.normalizeIdentity(row[indices.dniTrabajador]);
      if (cedula) {
        if (!arlMap.has(cedula)) {
          arlMap.set(cedula, []);
        }
        arlMap.get(cedula)!.push(row);
      }
    });

    // Headers de salida
    const outputHeaders = ['Numero de Cedula', 'Arl', 'ARL_FECHAS', 'FECHA EN ARL', 'FECHA INGRESO SUBIDA CONTRATACION', 'Errores', ...headerRowCruce];
    const outputData: any[][] = [outputHeaders];

    cruceRows.forEach((cruceRow: string[]) => {
      const cedulaCruce = this.normalizeIdentity(cruceRow[1]);
      const fechaIngresoCruce = cruceRow[8];
      const arlRowsForCedula = arlMap.get(cedulaCruce);

      let estadoArl = 'NO', estadoFechas = 'NO', fechaEnArl = 'SIN DATA';

      if (arlRowsForCedula && arlRowsForCedula.length > 0) {
        estadoArl = 'SI';
        const dCruce = CruceValidationHelper.parseDate(fechaIngresoCruce);
        let matchFound = false;
        let fechasArlTexto: string[] = [];

        for (const arlRow of arlRowsForCedula) {
          const rawFechaArl = arlRow[indices.inicioVigencia];
          let dArl: Date | null = null;

          const strArl = String(rawFechaArl || '').trim();
          if (strArl.includes('/')) {
            dArl = CruceValidationHelper.parseDate(strArl);
          } else if (typeof rawFechaArl === 'number') {
            const ms = Date.UTC(1899, 11, 30) + (rawFechaArl * 24 * 60 * 60 * 1000);
            const d = new Date(ms);
            if (!isNaN(d.getTime())) {
              dArl = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
            }
          } else if (strArl.includes('-')) {
            const parts = strArl.split('-');
            if (parts[0].length === 4) {
              dArl = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
            } else {
              dArl = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
            }
          }

          let formattedDate = strArl || 'SIN DATA';
          if (dArl && !isNaN(dArl.getTime())) {
            const dd = String(dArl.getDate()).padStart(2, '0');
            const mm = String(dArl.getMonth() + 1).padStart(2, '0');
            formattedDate = `${dd}/${mm}/${dArl.getFullYear()}`;
          }

          fechasArlTexto.push(formattedDate);

          if (dCruce && dArl && !isNaN(dArl.getTime()) && dCruce.getTime() === dArl.getTime()) {
            matchFound = true;
          }
        }

        const unicas = Array.from(new Set(fechasArlTexto));
        fechaEnArl = unicas.join(' o ');

        if (matchFound) {
          estadoFechas = 'SI';
        }
      }

      const erroresPrevios = errorsMap[cedulaCruce] ? errorsMap[cedulaCruce].join('; ') : '';
      outputData.push([cedulaCruce, estadoArl, estadoFechas, fechaEnArl, fechaIngresoCruce, erroresPrevios, ...cruceRow]);
    });

    // Recolectar errores ARL para mostrar en la UI
    this.arlErrors = [];
    for (let i = 1; i < outputData.length; i++) {
      const row = outputData[i];
      const cedula = row[0];
      const arl = row[1];
      const arlFechas = row[2];
      if (arl === 'NO') {
        this.arlErrors.push({ cedula, error: 'No existe en ARL' });
      } else if (arlFechas === 'NO') {
        this.arlErrors.push({ cedula, error: `Fecha de ingreso (${row[4]}) diferente a fecha ARL (${row[3]})` });
      }
    }

    // Generar Excel con ExcelJS (soporte de estilos)
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Reporte ARL');

    // Agregar filas
    outputData.forEach((row, rowIdx) => {
      const excelRow = ws.addRow(row);
      if (rowIdx === 0) {
        // Header styling
        excelRow.eachCell(cell => {
          cell.font = { bold: true };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
        });
      } else {
        // Columna B (Arl) = col 2, Columna C (ARL_FECHAS) = col 3
        const cellArl = excelRow.getCell(2);
        const cellFechas = excelRow.getCell(3);

        const redFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } };
        const whiteFont: Partial<ExcelJS.Font> = { color: { argb: 'FFFFFFFF' }, bold: true };

        if (cellArl.value === 'NO') {
          cellArl.fill = redFill;
          cellArl.font = whiteFont;
        }
        if (cellFechas.value === 'NO') {
          cellFechas.fill = redFill;
          cellFechas.font = whiteFont;
        }
      }
    });

    // Anchos de columna
    ws.getColumn(1).width = 18;  // Cedula
    ws.getColumn(2).width = 8;   // ARL
    ws.getColumn(3).width = 14;  // ARL_FECHAS
    ws.getColumn(4).width = 18;  // FECHA EN ARL
    ws.getColumn(5).width = 18;  // FECHA INGRESO
    ws.getColumn(6).width = 45;  // Errores

    // Escribir archivo
    wb.xlsx.writeBuffer().then(buffer => {
      this.handleWorkerSuccess(buffer);
      this.cdr.markForCheck();
    });
  }

  private handleWorkerSuccess(fileData: any) {
    this.closeSwal();
    const blob = new Blob([fileData], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    FileSaver.saveAs(blob, `Reporte_ARL_${new Date().getTime()}.xlsx`);
    Swal.fire('Éxito', 'Reporte ARL descargado', 'success');
  }

  private handleWorkerError(err: string) {
    this.closeSwal();
    console.error('[ARL Worker] Error:', err);
    Swal.fire({
      icon: 'error',
      title: 'No se pudo generar el Excel del reporte ARL',
      html:
        `Ocurrió un error en segundo plano al armar el archivo.<br><br>` +
        `<b>Detalle:</b> ${err || 'Sin detalle disponible.'}<br><br>` +
        `Intenta nuevamente. Si persiste, cierra el navegador y ábrelo otra vez.`,
    });
  }

  // ---------------------------------------------------------------------------
  // UTILS
  // ---------------------------------------------------------------------------

  private async readExcel(file: File): Promise<XLSX.WorkBook> {
    const buffer = await file.arrayBuffer();
    return XLSX.read(buffer, { type: 'array' });
  }

  /**
   * Limpieza de celdas de texto igual que `procesarYLimpiarExcel` en home:
   * - Normaliza y quita tildes / diacríticos.
   * - Conserva solo letras, dígitos y espacios.
   * - Preserva cadenas que parecen fechas (DD/MM/YYYY, YYYY-MM-DD, etc.).
   */
  private cleanWorkbookLikeHome(wb: XLSX.WorkBook): void {
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      for (const cellAddress in ws) {
        if (
          !Object.prototype.hasOwnProperty.call(ws, cellAddress) ||
          cellAddress[0] === '!'
        ) continue;

        const cell = (ws as any)[cellAddress];
        if (cell && cell.t === 's' && typeof cell.v === 'string') {
          let val: string = cell.v;
          const valTrimmed = val.trim();
          const isDateString =
            /^\d{2,4}[-/]?\d{2}[-/]?\d{2,4}(?:\s+\d{1,2}:\d{2}(:\d{2})?)?$/.test(valTrimmed);

          if (!isDateString) {
            val = val.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            // Preservamos @ (correos), +, -, y . además de letras, dígitos y espacios.
            val = val.replace(/[^a-zA-Z0-9\s@+\-.]/g, '');
            cell.v = val;
            if (typeof cell.w === 'string') cell.w = val;
          }
        }
      }
    }
  }

  private showLoading(title: string, text: string) {
    Swal.fire({
      title, text, icon: 'info', allowOutsideClick: false, didOpen: () => Swal.showLoading()
    });
  }

  private updateSwalProgress(msg: string, cur: number, total: number) {
    if (Swal.isVisible()) {
      const content = Swal.getHtmlContainer();
      if (content) content.textContent = `${msg} (${Math.round(cur / total * 100)}%)`;
    }
  }

  private closeSwal() {
    Swal.close();
  }

  private normalizeIdentity(val: any): string {
    if (!val) return '';
    const s = String(val).trim().toUpperCase();
    if (s.startsWith('X')) {
      // Remove spaces and dots for special IDs
      return s.replace(/\./g, '').replace(/\s/g, '');
    }
    // Only digits for normal IDs
    return s.replace(/[^\d]/g, '');
  }

  /* 
   * DEPRECATED: merged into normalizeIdentity
   * private normalizeCedula...
   * private sanitizeIdentity...
   */

  private getDocList(key: UploadControl): string[] {
    if (key === 'cedulasEscaneadas') {
      return this.cedulasPreview.filter(p => p.valido).map(p => String(p.documento));
    }
    if (key === 'traslados') {
      return this.trasladosPreview.filter(p => p.valido).map(p => String(p.documento));
    }
    const files = this.files[key] || [];
    return files.map(f => {
      // Improved regex to capture the leading ID part
      const m = f.name.match(/^\s*([a-zA-Z0-9]+)/);
      return this.normalizeIdentity(m ? m[1] : '');
    }).filter(Boolean);
  }

  // ... checkAndShowPreviewErrors ...

  private isBackendWarning(msg: string, field?: string): boolean {
    if (!msg) return false;
    const lower = msg.toLowerCase();

    // Palabras clave para duplicados
    const duplicateKeywords = [
      'ya está en uso', 'ya esta en uso', 'ya se encuentra en uso',
      'ya existe', 'ya se encuentra registrado',
      'duplicad', 'duplicate', 'unique', 'constraint',
      'already exists', 'already in use'
    ];

    // Palabras clave para advertencias generales
    const warningKeywords = [
      'opcional', 'recomendado', 'sugerencia',
      'advertencia', 'warning', 'informativo'
    ];

    return duplicateKeywords.some(kw => lower.includes(kw))
      || warningKeywords.some(kw => lower.includes(kw));
  }

  private mapExternalIssues(backendErrors: any[]): PreviewIssue[] {
    return backendErrors.map((e, idx) => {
      // Backend "registro" is 1-based index
      let r = String(e.registro || '0');

      if (!r.startsWith('row-')) {
        const val = parseInt(r, 10);
        if (!isNaN(val) && val > 0) {
          r = `row-${val - 1}`;
        } else {
          r = `row-${r}`;
        }
      }

      // 1. Extract raw message
      let rawMsg = e.mensaje || e.message;
      if (!rawMsg && Array.isArray(e.errores)) {
        rawMsg = e.errores.join('. ');
      }
      if (!rawMsg) rawMsg = JSON.stringify(e);

      // 2. Clean Message & Infer Field
      let finalMsg = rawMsg;
      let fieldVal = e.element || 'general';

      const lowerMsg = rawMsg.toLowerCase();
      if (lowerMsg.includes('correo') || lowerMsg.includes('email')) {
        fieldVal = 'email';
        finalMsg = rawMsg.replace(/El campo \(Correo electrónico\) contiene '[^']+',\s*/i, '');
      }

      const isWarn = this.isBackendWarning(finalMsg, fieldVal);

      return {
        id: `ext-${idx}`,
        itemId: r,
        severity: isWarn ? 'warn' : 'error',
        message: finalMsg,
        field: fieldVal
      };
    });
  }

  private buildReporteRequest() {
    const val = this.reporteForm.getRawValue();

    // Mapping files
    const sst = this.files.induccionSSO?.[0] || null;
    const cruce = this.files.cruceDiario?.[0] || null;
    const cedulas = this.files.cedulasEscaneadas || [];
    const traslados = this.files.traslados || [];

    // Mapping Payload
    const payload = {
      nombre: this.nombre || 'Reporte',
      sede: val.sede?.nombre || null,
      fecha: (val.esDeHoy === 'true' || !val.fecha)
        ? new Date().toISOString()
        : val.fecha.toISOString(),
      cantidadContratosTuAlianza: val.cantidadContratosTuAlianza ?? null,
      cantidadContratosApoyoLaboral: val.cantidadContratosApoyoLaboral ?? null,
      nota: val.notas?.trim() || null
    };

    return {
      payload,
      files: {
        sst_document: sst,
        cruce_document: cruce,
        cedulas: cedulas.length ? cedulas : undefined,
        traslados: traslados.length ? traslados : undefined
      }
    };
  }

  // ---------------------------------------------------------------------------
  // ERROR PARSER
  // ---------------------------------------------------------------------------
  private parseBackendError(err: any): string {
    if (!err) return '';
    let obj = err;
    if (err.error) obj = err.error; // Si viene envuelto por HttpErrorResponse
    if (typeof obj === 'string') return obj;

    const issues: string[] = [];
    const extract = (data: any, path: string) => {
      if (!data) return;
      if (typeof data === 'string') {
        issues.push(path ? `<b>${path}</b>: ${data}` : data);
      } else if (Array.isArray(data)) {
        data.forEach((item) => extract(item, path));
      } else if (typeof data === 'object') {
        Object.keys(data).forEach(key => {
          let fieldName = key;
          // Traducciones de DRF internas
          if (key === 'non_field_errors' || key === 'detail') fieldName = '';
          extract(data[key], fieldName);
        });
      }
    };

    extract(obj, '');
    
    if (issues.length === 0) return 'Ocurrió un error en el servidor al intentar guardar los datos.';
    if (issues.length === 1) return issues[0];
    
    return `<ul style="text-align:left; max-height:200px; overflow:auto;">` + 
           issues.map(msg => `<li>${msg}</li>`).join('') + 
           `</ul>`;
  }
}
