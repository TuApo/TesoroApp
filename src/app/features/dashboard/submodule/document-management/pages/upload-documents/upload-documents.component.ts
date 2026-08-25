
import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  Inject,
  PLATFORM_ID,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  DestroyRef,
  inject
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  FormArray,
  FormsModule,
  ReactiveFormsModule,
  Validators,
  AbstractControl
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@/app/shared/shared.module';
import { firstValueFrom } from 'rxjs';
import Swal from 'sweetalert2';

import { GestionDocumentalService } from '../../../hiring/service/gestion-documental/gestion-documental.service';
import { DocumentacionService, agruparTiposPorPadre } from '../../service/documentacion/documentacion.service';
import { DocumentScanDialogComponent } from '../../components/document-scan-dialog/document-scan-dialog.component';
import { isOfflineQueued } from '@/app/core/utils/offline-response';

export interface FileQueueItem {
  id: string;
  file: File;
  name: string;
  size: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
  progress: number;
  errorMessage?: string;
  /** true si el envío quedó en cola offline (no confirmado contra el servidor). */
  queued?: boolean;
}

@Component({
  selector: 'app-upload-documents',
  standalone: true,
  imports: [
    CommonModule,
    SharedModule,
    FormsModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatProgressBarModule,
    MatMenuModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatCheckboxModule,
    MatTooltipModule,
    MatDividerModule,
    MatDialogModule
  ],
  templateUrl: './upload-documents.component.html',
  styleUrls: ['./upload-documents.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UploadDocumentsComponent implements OnInit, OnDestroy {
  // Data: opciones del selector agrupadas por su tipo padre
  gruposHojas: { padre: string; hijos: any[] }[] = [];
  hojasPorId: Record<number, any> = {};

  /** Tipo elegido en la barra de acciones masivas ("aplicar a los seleccionados"). */
  bulkTypeId: number | null = null;

  // Core State
  fileQueue: FileQueueItem[] = []; // Immutable list for rendering loop (status/file/progress)

  // Forms
  mainForm: FormGroup;
  queueForm: FormArray;

  // UI State
  dragOver = false;
  isUploading = false;

  // Element Refs
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  @ViewChild('zipInput') zipInput!: ElementRef<HTMLInputElement>;

  private destroyRef = inject(DestroyRef);

  constructor(
    private fb: FormBuilder,
    private docSrv: DocumentacionService,
    private gestionDocSrv: GestionDocumentalService,
    private titleService: Title,
    private cdr: ChangeDetectorRef,
    private dialog: MatDialog,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.queueForm = this.fb.array([]);
    this.mainForm = this.fb.group({
      numeroDocumento: ['', Validators.required]
    });
  }

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.titleService.setTitle('Carga de Documentos | Gestión Documental');
      this.loadHierarchy();
    }
  }

  ngOnDestroy(): void {
    // Cleanup handled by takeUntilDestroyed
  }

  // --- Getters ---
  get numeroDocumentoControl(): FormControl {
    return this.mainForm.get('numeroDocumento') as FormControl;
  }

  private loadHierarchy() {
    this.docSrv.mostrar_jerarquia_anidada()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (arbol) => {
          this.gruposHojas = agruparTiposPorPadre(arbol);
          this.gruposHojas.forEach((g) => g.hijos.forEach((h) => (this.hojasPorId[h.id] = h)));
          this.cdr.markForCheck();
        },
        error: (err: any) => {
          console.error('[upload] Error cargando jerarquía:', err);
          Swal.fire('Error', 'No se pudo cargar los tipos de documentos disponibles. Recargue la página o contacte a soporte.', 'error');
        }
      });
  }

  // --- Drag & Drop ---
  onDragOver(event: DragEvent) {
    if (this.isUploading) return;
    event.preventDefault();
    event.stopPropagation();
    this.dragOver = true;
  }

  onDragLeave(event: DragEvent) {
    if (this.isUploading) return;
    event.preventDefault();
    event.stopPropagation();
    this.dragOver = false;
  }

  onDrop(event: DragEvent) {
    if (this.isUploading) return;
    event.preventDefault();
    event.stopPropagation();
    this.dragOver = false;
    const files = event.dataTransfer?.files;
    if (files) this.handleFiles(files);
  }

  onFileSelected(event: Event) {
    if (this.isUploading) return;
    const input = event.target as HTMLInputElement;
    if (input.files) {
      this.handleFiles(input.files);
      input.value = '';
    }
  }

  handleFiles(fileList: FileList) {
    const maxBytes = 10 * 1024 * 1024; // 10MB
    let addedCount = 0;
    let skippedPdf = 0;
    let skippedSize = 0;

    Array.from(fileList).forEach(file => {
      if (!file.name.toLowerCase().endsWith('.pdf')) {
        skippedPdf++;
        return;
      }
      if (file.size > maxBytes) {
        skippedSize++;
        return;
      }
      this.addPdfToQueue(file);
      addedCount++;
    });

    if (skippedPdf > 0 || skippedSize > 0) {
      let msg = '';
      if (skippedPdf > 0) msg += `${skippedPdf} archivo(s) no eran PDF. `;
      if (skippedSize > 0) msg += `${skippedSize} archivo(s) excedían 10MB.`;

      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'warning',
        title: 'Archivos omitidos',
        text: msg,
        timer: 4000
      });
    }

    this.cdr.markForCheck();
  }

  private readonly MAX_FILE_BYTES = 10 * 1024 * 1024;

  addPdfToQueue(file: File) {
    if (file.size > this.MAX_FILE_BYTES) {
      Swal.fire({
        icon: 'warning',
        title: 'Archivo muy pesado',
        html: `<b>${file.name}</b> pesa ${(file.size / 1024 / 1024).toFixed(1)} MB y excede el límite de 10 MB.<br>
               Aplica el filtro <b>B/N</b> en el escáner o reduce el número de páginas.`
      });
      return;
    }
    const id = this.generateId();

    // Add to Visual Queue (Read-only props)
    this.fileQueue.push({
      id,
      file,
      name: file.name,
      size: file.size,
      status: 'pending',
      progress: 0
    });

    // Add to Form Queue (Editable props)
    const group = this.fb.group({
      id: [id], // Sync key
      selected: [false],
      typeId: [null, Validators.required],
      contractCode: [{ value: '', disabled: true }] // Disabled by default
    });

    // React to type changes to enforce contract logic
    group.get('typeId')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((typeId) => {
        this.updateContractValidator(group, typeId);
      });

    this.queueForm.push(group);
  }

  private updateContractValidator(group: FormGroup, typeId: number | null) {
    const contractCtrl = group.get('contractCode')!;
    const aplica = this.requiresContract(typeId);

    if (aplica) {
      contractCtrl.enable({ emitEvent: false });
      // Decisión de producto (2026-07-14): el campo se muestra pero NO bloquea.
      // El bug de camelCase lo mantuvo oculto, así que nadie lo viene llenando;
      // exigirlo de golpe trabaría la subida a quien no tenga el código a mano.
      contractCtrl.clearValidators();
    } else {
      contractCtrl.disable({ emitEvent: false });
      contractCtrl.clearValidators();
      contractCtrl.setValue(''); // Clear value if not required
    }
    contractCtrl.updateValueAndValidity({ emitEvent: false });
    this.cdr.markForCheck();
  }

  requiresContract(typeId: number | null): boolean {
    if (!typeId) return false;
    const hoja = this.hojasPorId[typeId];
    // El backend serializa camelCase (`codigoContrato`). Leerlo como snake_case
    // devolvía siempre undefined, así que el contrato nunca se exigía.
    return !!hoja?.codigoContrato;
  }

  /** Nombre del tipo, para pintarlo en la fila y en los avisos. */
  nombreTipo(typeId: number | null): string {
    return typeId ? (this.hojasPorId[typeId]?.name ?? '') : '';
  }

  generateId() {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  getControl(index: number): FormGroup {
    return this.queueForm.at(index) as FormGroup;
  }

  // --- Queue Actions ---
  removeFromQueue(index: number) {
    if (this.isUploading) return;
    this.fileQueue.splice(index, 1);
    this.queueForm.removeAt(index);
    this.cdr.markForCheck();
  }

  clearQueue() {
    if (this.isUploading) return;
    this.fileQueue = [];
    this.queueForm.clear();
    this.cdr.markForCheck();
  }

  // --- Selection Logic ---
  get allSelected(): boolean {
    if (this.queueForm.length === 0) return false;
    return this.queueForm.controls.every(c => c.get('selected')?.value);
  }

  get someSelected(): boolean {
    if (this.queueForm.length === 0) return false;
    const count = this.queueForm.controls.filter(c => c.get('selected')?.value).length;
    return count > 0 && count < this.queueForm.length;
  }

  toggleSelectAll() {
    if (this.isUploading) return;
    const newState = !this.allSelected;
    this.queueForm.controls.forEach(c => c.get('selected')?.setValue(newState));
  }

  get selectedCount(): number {
    return this.queueForm.controls.filter(c => c.get('selected')?.value).length;
  }

  /**
   * Patrón "definir una vez y aplicar a todos": al soltar 20 PDFs del mismo
   * tipo, marcarlos y asignar el tipo de una sola vez en lugar de 20 veces.
   */
  aplicarTipoASeleccionados() {
    if (this.isUploading || !this.bulkTypeId) return;

    let aplicados = 0;
    this.queueForm.controls.forEach(c => {
      if (c.get('selected')?.value) {
        c.get('typeId')?.setValue(this.bulkTypeId); // dispara updateContractValidator
        aplicados++;
      }
    });

    if (aplicados) {
      Swal.fire({
        toast: true, position: 'top-end', icon: 'success', showConfirmButton: false, timer: 1800,
        title: `Tipo aplicado a ${aplicados} archivo${aplicados === 1 ? '' : 's'}`,
      });
    }
    this.cdr.markForCheck();
  }

  quitarSeleccionados() {
    if (this.isUploading) return;
    // Se recorre al revés: borrar de adelante hacia atrás corre los índices.
    for (let i = this.queueForm.length - 1; i >= 0; i--) {
      if (this.queueForm.at(i).get('selected')?.value) {
        this.fileQueue.splice(i, 1);
        this.queueForm.removeAt(i);
      }
    }
    this.cdr.markForCheck();
  }

  // --- Validation ---
  get canUpload(): boolean {
    if (this.isUploading) return false;

    // Check global requirements
    if (this.mainForm.invalid) return false;

    // Must have at least one pending file
    const pendingIndices = this.fileQueue
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.status === 'pending' || item.status === 'error')
      .map(({ index }) => index);

    if (pendingIndices.length === 0) return false;

    // Check validity of those pending rows
    const allPendingValid = pendingIndices.every(i => {
      const g = this.queueForm.at(i) as FormGroup;
      return g.valid; // Checks typeId and contractCode (if required)
    });

    return allPendingValid;
  }

  async startUpload() {
    if (!this.canUpload) {
      if (this.mainForm.invalid) this.mainForm.markAllAsTouched();
      this.queueForm.markAllAsTouched(); // Show errors on rows
      return;
    }

    const pendingIndices = this.fileQueue
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.status === 'pending' || item.status === 'error')
      .map(({ index }) => index);

    const numeroDoc = this.numeroDocumentoControl.value!;

    Swal.fire({
      title: 'Subiendo documentos',
      text: 'Por favor espere...',
      allowOutsideClick: false,
      allowEscapeKey: false,
      didOpen: () => Swal.showLoading()
    });

    this.isUploading = true;
    this.mainForm.disable(); // Disable inputs during upload
    this.queueForm.disable();
    this.cdr.markForCheck();

    const CONCURRENCY = 3;
    const pool: Promise<void>[] = [];

    for (const i of pendingIndices) {
      while (pool.length >= CONCURRENCY) {
        await Promise.race(pool);
      }

      const p = this.uploadSingleFile(i, numeroDoc).then(() => {
        const idx = pool.indexOf(p);
        if (idx > -1) pool.splice(idx, 1);
      });
      pool.push(p);
    }
    await Promise.all(pool);

    this.isUploading = false;
    this.mainForm.enable();
    this.queueForm.enable();

    // Re-evaluate disabled state for contract codes based on types
    this.queueForm.controls.forEach(g => {
      const group = g as FormGroup;
      this.updateContractValidator(group, group.get('typeId')?.value);
    });

    // Final Analysis
    const errors = this.fileQueue.filter(f => f.status === 'error');
    const success = this.fileQueue.filter(f => f.status === 'success');

    if (errors.length > 0) {
      const errorList = errors
        .map(e => `<li><b>${e.name}</b>: ${e.errorMessage || 'Error desconocido'}</li>`)
        .join('');
      Swal.fire({
        title: 'Carga finalizada con errores',
        html: `<p>Subidos correctamente: <b>${success.length}</b><br>Fallidos: <b>${errors.length}</b></p>
               <div style="text-align:left;max-height:200px;overflow-y:auto;font-size:13px;margin-top:10px;">
                 <ul style="padding-left:20px;">${errorList}</ul>
               </div>
               <p style="font-size:12px;color:#888;margin-top:10px;">Puede corregir los archivos con error e intentar subirlos de nuevo.</p>`,
        icon: 'warning',
        confirmButtonColor: '#3085d6'
      });
    } else if (success.some(f => f.queued)) {
      // Todo "ok" pero al menos uno quedó en cola offline: no mentir con
      // "subido al servidor". Se subirá solo cuando vuelva la conexión.
      Swal.fire({
        title: 'Guardado sin conexión',
        html:
          `Se guardaron <b>${success.length}</b> documento(s) en este equipo.` +
          `<br><br>Se subirán automáticamente cuando vuelva la conexión. ` +
          `Puedes ver el avance en el indicador de red (arriba a la derecha).`,
        icon: 'info',
      }).then(() => {
        this.resetAll();
      });
    } else {
      Swal.fire({
        title: '¡Operación Exitosa!',
        text: 'Todos los documentos se cargaron correctamente.',
        icon: 'success'
      }).then(() => {
        this.resetAll();
      });
    }
    this.cdr.markForCheck();
  }

  private async uploadSingleFile(index: number, numeroDoc: string) {
    const item = this.fileQueue[index];
    const formGroup = this.queueForm.at(index);
    const typeId = formGroup.get('typeId')?.value; // Works even if disabled
    const contractCode = formGroup.get('contractCode')?.value;

    if (!typeId) return;

    item.status = 'uploading';
    this.cdr.markForCheck();

    try {
      const resp = await firstValueFrom(
        this.gestionDocSrv.guardarDocumento(
          item.name,
          numeroDoc,
          typeId,
          item.file,
          contractCode || undefined
        )
      );
      // Sin conexión el interceptor devuelve un 200 "mock": el archivo quedó en
      // cola local, NO en el servidor. Lo marcamos para no afirmar "subido".
      item.queued = isOfflineQueued(resp);
      item.status = 'success';
      item.progress = 100;
    } catch (err: any) {
      console.error(`[upload] Error subiendo "${item.name}":`, err);
      item.status = 'error';

      // Extraer mensaje legible del error
      const body = err?.error;
      if (body?.detail) {
        item.errorMessage = body.detail;
      } else if (body?.message) {
        item.errorMessage = body.message;
      } else if (typeof body === 'string') {
        item.errorMessage = body;
      } else if (err?.status === 0 || err?.status === 504) {
        item.errorMessage = 'Sin conexión al servidor';
      } else if (err?.status === 413) {
        item.errorMessage = 'Archivo demasiado grande para el servidor';
      } else if (err?.status === 415) {
        item.errorMessage = 'Formato de archivo no soportado';
      } else if (err?.status >= 500) {
        item.errorMessage = `Error interno del servidor (${err.status})`;
      } else {
        item.errorMessage = `Error ${err?.status || 'desconocido'}`;
      }
    }
    this.cdr.markForCheck();
  }

  resetAll() {
    this.clearQueue();
    this.mainForm.reset();
  }

  // --- ZIP functionality ---
  onClickSubidaMasiva() {
    if (this.isUploading) return;
    this.zipInput.nativeElement.value = '';
    this.zipInput.nativeElement.click();
  }

  onZipSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.zip')) {
      Swal.fire('Archivo inválido', 'Solo se permiten archivos .zip', 'error');
      return;
    }

    Swal.fire({
      title: 'Configuración ZIP',
      html: `
        <div style="text-align: left; font-size: 14px; display: flex; flex-direction: column; gap: 12px;">
           <div>
             <label for="swal-contract" style="display:block; margin-bottom:4px; font-weight:600;">Contrato por defecto (Opcional)</label>
             <input id="swal-contract" class="swal2-input" style="margin:0; width: 100%; box-sizing: border-box;" placeholder="Ej. CT-2024-001">
           </div>
           <div style="display: flex; align-items: center; gap: 8px;">
             <input type="checkbox" id="swal-toggle" checked>
             <label for="swal-toggle">Intentar extraer contrato del nombre del archivo</label>
           </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Subir ZIP',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        return {
          default_contract: (document.getElementById('swal-contract') as HTMLInputElement).value,
          contract_from_filename: (document.getElementById('swal-toggle') as HTMLInputElement).checked
        };
      }
    }).then((res) => {
      if (res.isConfirmed) {
        this.processZip(file, res.value);
      }
    });
  }

  processZip(file: File, payload: { default_contract: string, contract_from_filename: boolean }) {
    Swal.fire({ title: 'Subiendo ZIP...', text: 'Esto puede tomar unos segundos...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    this.docSrv.bulkZipUpload(file, payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => {
          Swal.close();

          const items: any[] = res?.items || [];
          const created = items.filter((i: any) => i.status === 'created');
          const errored = items.filter((i: any) => i.status === 'error');
          const skipped = items.filter((i: any) => i.status === 'skipped');

          if (errored.length === 0 && skipped.length === 0) {
            Swal.fire({
              icon: 'success',
              title: '¡Carga masiva exitosa!',
              html: `Se procesaron <b>${res.processed || 0}</b> archivos.<br>Creados correctamente: <b>${created.length}</b>.`,
              confirmButtonColor: '#3085d6'
            });
            return;
          }

          // Construir detalle de errores y omitidos
          let detail = '';
          if (errored.length > 0) {
            const errorList = errored.map((i: any) => `<li><b>${i.path || 'Archivo'}</b>: ${i.reason || 'Error desconocido'}</li>`).join('');
            detail += `<div style="text-align:left;margin-top:10px;"><b style="color:#d32f2f;">Errores (${errored.length}):</b><ul style="font-size:13px;max-height:150px;overflow-y:auto;padding-left:20px;">${errorList}</ul></div>`;
          }
          if (skipped.length > 0) {
            const skipList = skipped.map((i: any) => `<li><b>${i.path || 'Archivo'}</b>: ${i.reason || 'Omitido'}</li>`).join('');
            detail += `<div style="text-align:left;margin-top:10px;"><b style="color:#f59e0b;">Omitidos (${skipped.length}):</b><ul style="font-size:13px;max-height:150px;overflow-y:auto;padding-left:20px;">${skipList}</ul></div>`;
          }

          Swal.fire({
            icon: errored.length > 0 ? 'warning' : 'info',
            title: errored.length > 0 ? 'Carga completada con errores' : 'Carga completada con archivos omitidos',
            html: `<p>Procesados: <b>${res.processed || 0}</b> | Creados: <b>${created.length}</b> | Errores: <b>${errored.length}</b> | Omitidos: <b>${skipped.length}</b></p>${detail}`,
            confirmButtonColor: '#3085d6',
            width: '600px'
          });
        },
        error: (err: any) => {
          console.error('[ZIP upload] Error:', err);
          const detail = err?.error?.detail || err?.message || '';
          Swal.fire({
            icon: 'error',
            title: 'Error en carga masiva',
            html: detail
              ? `<p>${detail}</p>`
              : '<p>No se pudo procesar el archivo ZIP. Verifique que el archivo no esté corrupto y que su conexión a internet esté estable.</p>',
            confirmButtonColor: '#3085d6'
          });
        }
      });
  }

  // --- SCANNER ---
  openScanDialog() {
    if (this.isUploading) return;

    const dialogRef = this.dialog.open(DocumentScanDialogComponent, {
      maxWidth: '100vw',
      maxHeight: '100vh',
      height: '100%',
      width: '100%',
      panelClass: 'full-screen-dialog', // Ensure user adds this CSS or we rely on height/width
      disableClose: true
    });

    dialogRef.afterClosed().subscribe((result: File[] | undefined) => {
      if (result && Array.isArray(result)) {
        result.forEach(file => {
          this.addPdfToQueue(file);
        });
        this.cdr.markForCheck();
      }
    });
  }
}

