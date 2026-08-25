import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, HostListener,
  Input, OnChanges, OnDestroy, Output, SimpleChanges, inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatDialog } from '@angular/material/dialog';
import { Observable, firstValueFrom } from 'rxjs';
import {
  DocumentRef, DynamicField, FieldMode, FieldValue,
  asDocumentRefs, fileExtension, validateFieldValue,
} from '../field.model';
import {
  CameraDialogComponent, CameraDialogResult,
} from '@/app/features/dashboard/submodule/hiring/components/camera-dialog/camera-dialog.component';

/**
 * Estado LOCAL de cada foto dentro del campo (modo 'preview').
 * El valor del campo son solo las referencias DocumentRef ya subidas;
 * un File nativo jamás viaja en el payload.
 */
interface PhotoSlot {
  /** Referencia ya subida a ms-documents; null mientras sube o si falló. */
  ref: DocumentRef | null;
  /** Archivo original, conservado para poder reintentar la subida. */
  file: File | null;
  /** ObjectURL local para la miniatura (somos dueños: se revoca aquí). */
  previewUrl: string | null;
  uploading: boolean;
  error: string | null;
}

/**
 * Campo PHOTO — sigue el contrato uniforme de componentes de campo (ver
 * text-short-field.component.ts) más el contrato extendido de media:
 * uploadFn / downloadUrlFn los inyecta la página (ms-documents autenticado o
 * endpoint público). La foto se comprime en cliente ANTES de subir y se sube
 * INMEDIATAMENTE al capturarla/elegirla (fail-closed: sin subida no hay
 * referencia en el payload). En 'readonly' la imagen se baja como blob
 * autenticado (el <img> no puede mandar el JWT) y se muestra con lightbox
 * propio y botón de descarga.
 */
@Component({
  selector: 'app-photo-field',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="df-field" [class.df-field--error]="showErrors && !!error">
      <label class="df-field__label"
             [attr.id]="inputId + '-label'"
             [attr.for]="mode === 'preview' ? inputId : null">
        {{ field.label }}
        @if (field.required) { <span class="df-field__req" aria-hidden="true">*</span> }
      </label>
      @if (field.schema.description) {
        <p class="df-field__desc">{{ field.schema.description }}</p>
      }

      @switch (mode) {
        @case ('readonly') {
          @if (refs.length === 0) {
            <p class="df-field__value">—</p>
          } @else if (!downloadUrlFn) {
            <div class="df-field__files">
              @for (ref of refs; track ref.document_id) {
                <span class="df-field__file-chip">
                  <span class="material-symbols-outlined" aria-hidden="true">image</span>
                  {{ ref.filename }}
                </span>
              }
            </div>
          } @else {
            <div class="df-field__files">
              @for (ref of refs; track ref.document_id) {
                <div class="pf-item">
                  <div class="pf-thumb-wrap">
                    @if (blobUrls.get(ref.document_id); as u) {
                      <img class="df-field__thumb" [src]="u" [alt]="ref.filename"
                           tabindex="0" role="button"
                           [attr.aria-label]="'Ampliar ' + ref.filename"
                           (click)="openLightbox(u, ref.filename)"
                           (keydown.enter)="openLightbox(u, ref.filename)" />
                      <a class="pf-corner pf-corner--dl" [href]="u" [download]="ref.filename"
                         [attr.aria-label]="'Descargar ' + ref.filename"
                         [title]="'Descargar ' + ref.filename">
                        <span class="material-symbols-outlined" aria-hidden="true">download</span>
                      </a>
                    } @else if (downloadErrors.has(ref.document_id)) {
                      <button type="button" class="pf-placeholder pf-placeholder--error"
                              (click)="loadBlob(ref, true)"
                              [attr.aria-label]="'Reintentar cargar ' + ref.filename"
                              title="No se pudo cargar. Reintentar">
                        <span class="material-symbols-outlined" aria-hidden="true">broken_image</span>
                      </button>
                    } @else {
                      <div class="pf-placeholder">
                        <span class="pf-spinner" role="status" aria-label="Cargando la imagen"></span>
                      </div>
                    }
                  </div>
                  <span class="pf-name" [title]="ref.filename">{{ ref.filename }}</span>
                </div>
              }
            </div>
          }
        }
        @case ('config') {
          <div class="pf-actions">
            <button type="button" class="df-field__btn" disabled>
              <span class="material-symbols-outlined" aria-hidden="true">photo_camera</span>
              Tomar foto
            </button>
            <button type="button" class="df-field__btn" disabled>
              <span class="material-symbols-outlined" aria-hidden="true">upload</span>
              Subir imagen
            </button>
            @if (maxFiles > 1) { <span class="pf-counter">0/{{ maxFiles }} fotos</span> }
          </div>
        }
        @default {
          <div class="pf-group" role="group"
               [attr.aria-labelledby]="inputId + '-label'"
               [attr.aria-invalid]="showErrors && !!error">
            <div class="pf-actions">
              <button type="button" class="df-field__btn"
                      (click)="openCamera()" [disabled]="!uploadFn || atCapacity">
                <span class="material-symbols-outlined" aria-hidden="true">photo_camera</span>
                Tomar foto
              </button>
              <button type="button" class="df-field__btn"
                      (click)="fileInput.click()" [disabled]="!uploadFn || atCapacity">
                <span class="material-symbols-outlined" aria-hidden="true">upload</span>
                Subir imagen
              </button>
              @if (maxFiles > 1) {
                <span class="pf-counter">{{ slots.length }}/{{ maxFiles }} fotos</span>
              }
            </div>
            <input #fileInput type="file" class="pf-hidden-input"
                   [id]="inputId"
                   [accept]="acceptAttr"
                   [multiple]="maxFiles - slots.length > 1"
                   [disabled]="!uploadFn || atCapacity"
                   (change)="onFilesPicked($event)" />
            @if (!uploadFn) {
              <p class="df-field__desc">La subida de imágenes no está disponible en este contexto.</p>
            }
            @if (pickError) {
              <p class="df-field__error" role="alert">{{ pickError }}</p>
            }
            @if (slots.length > 0) {
              <div class="df-field__files">
                @for (slot of slots; track slot) {
                  <div class="pf-item">
                    <div class="pf-thumb-wrap" [class.pf-thumb-wrap--error]="!!slot.error">
                      @if (slot.previewUrl) {
                        <img class="df-field__thumb" [src]="slot.previewUrl"
                             [alt]="slotName(slot)"
                             [class.pf-dim]="slot.uploading || !!slot.error"
                             tabindex="0" role="button"
                             [attr.aria-label]="'Ampliar ' + slotName(slot)"
                             (click)="openLightbox(slot.previewUrl, slotName(slot))"
                             (keydown.enter)="openLightbox(slot.previewUrl, slotName(slot))" />
                      } @else {
                        <div class="pf-placeholder">
                          <span class="material-symbols-outlined" aria-hidden="true">image</span>
                        </div>
                      }
                      @if (slot.uploading) {
                        <div class="pf-overlay">
                          <span class="pf-spinner" role="status" aria-label="Subiendo la foto"></span>
                        </div>
                      }
                      @if (slot.error && !slot.uploading) {
                        <div class="pf-overlay pf-overlay--error">
                          <button type="button" class="pf-retry" (click)="retry(slot)"
                                  [attr.aria-label]="'Reintentar subir ' + slotName(slot)"
                                  title="Reintentar subida">
                            <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
                          </button>
                        </div>
                      }
                      @if (!slot.uploading) {
                        <button type="button" class="pf-corner pf-corner--rm"
                                (click)="removeSlot(slot)"
                                [attr.aria-label]="'Quitar ' + slotName(slot)"
                                title="Quitar">
                          <span class="material-symbols-outlined" aria-hidden="true">close</span>
                        </button>
                      }
                    </div>
                    @if (slot.error) {
                      <span class="pf-slot-error" role="alert" [title]="slot.error">{{ slot.error }}</span>
                    }
                  </div>
                }
              </div>
            }
          </div>
        }
      }

      @if (showErrors && error && mode === 'preview') {
        <p class="df-field__error" role="alert">{{ error }}</p>
      }
    </div>

    <!-- Lightbox propio: overlay a pantalla completa, cierra con click o Escape -->
    @if (lightboxUrl) {
      <div class="pf-lightbox" role="dialog" aria-modal="true"
           [attr.aria-label]="'Vista ampliada de ' + lightboxName"
           (click)="closeLightbox()">
        <img class="pf-lightbox__img" [src]="lightboxUrl" [alt]="lightboxName" />
        <button type="button" class="pf-lightbox__close" aria-label="Cerrar vista ampliada">
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>
    }
  `,
  styleUrls: ['../field-shared.css'],
  styles: [`
    .pf-group { display: flex; flex-direction: column; gap: 8px; }
    .pf-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .pf-counter { font-size: 0.8rem; color: var(--slate-500, #64748b); }
    .pf-hidden-input {
      position: absolute; width: 1px; height: 1px;
      opacity: 0; overflow: hidden; clip: rect(0 0 0 0);
    }
    .pf-item { display: flex; flex-direction: column; gap: 4px; width: 96px; }
    .pf-thumb-wrap { position: relative; width: 96px; height: 96px; }
    .pf-thumb-wrap--error .df-field__thumb { border-color: #c0392b; }
    .pf-dim { opacity: 0.45; }
    .pf-name {
      font-size: 0.75rem; color: var(--slate-500, #64748b);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .pf-slot-error {
      font-size: 0.72rem; color: #c0392b;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .pf-placeholder {
      width: 96px; height: 96px; display: flex; align-items: center; justify-content: center;
      border: 1px dashed var(--slate-300, #cbd5e1); border-radius: var(--r-sm, 10px);
      background: var(--slate-50, #f8fafc); color: var(--slate-500, #64748b);
      box-sizing: border-box;
    }
    .pf-placeholder--error { color: #c0392b; cursor: pointer; font: inherit; }
    .pf-overlay {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      border-radius: var(--r-sm, 10px); background: rgba(255, 255, 255, 0.35);
    }
    .pf-overlay--error { background: rgba(192, 57, 43, 0.12); }
    .pf-spinner {
      width: 26px; height: 26px; border-radius: 50%;
      border: 3px solid var(--slate-300, #cbd5e1);
      border-top-color: var(--navy, #21263c);
      animation: pf-spin 0.8s linear infinite;
    }
    @keyframes pf-spin { to { transform: rotate(360deg); } }
    .pf-corner {
      position: absolute; top: 4px; display: flex; align-items: center; justify-content: center;
      width: 24px; height: 24px; padding: 0; border: none; border-radius: 50%;
      background: rgba(15, 23, 42, 0.65); color: #fff; cursor: pointer; text-decoration: none;
    }
    .pf-corner .material-symbols-outlined { font-size: 16px; }
    .pf-corner:hover { background: rgba(15, 23, 42, 0.85); }
    .pf-corner:focus-visible { outline: 2px solid var(--lime, #8cd50a); outline-offset: 1px; }
    .pf-corner--rm { right: 4px; }
    .pf-corner--dl { left: 4px; }
    .pf-retry {
      display: flex; align-items: center; justify-content: center;
      width: 34px; height: 34px; padding: 0; border: none; border-radius: 50%;
      background: #c0392b; color: #fff; cursor: pointer;
    }
    .pf-retry:focus-visible { outline: 2px solid var(--lime, #8cd50a); outline-offset: 1px; }
    .pf-lightbox {
      position: fixed; inset: 0; z-index: 1200;
      display: flex; align-items: center; justify-content: center;
      background: rgba(15, 23, 42, 0.85); cursor: zoom-out;
    }
    .pf-lightbox__img {
      max-width: 92vw; max-height: 92vh; object-fit: contain;
      border-radius: var(--r-sm, 10px); background: #fff;
    }
    .pf-lightbox__close {
      position: absolute; top: 16px; right: 16px;
      display: flex; align-items: center; justify-content: center;
      width: 40px; height: 40px; padding: 0; border: none; border-radius: 50%;
      background: rgba(255, 255, 255, 0.15); color: #fff; cursor: pointer;
    }
    .pf-lightbox__close:hover { background: rgba(255, 255, 255, 0.3); }
    .pf-lightbox__close:focus-visible { outline: 2px solid var(--lime, #8cd50a); outline-offset: 1px; }
  `],
})
export class PhotoFieldComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) field!: DynamicField;
  @Input() mode: FieldMode = 'preview';
  @Input() value: FieldValue = null;
  @Input() showErrors = false;
  /** Contrato de media: la página decide el destino de la subida. */
  @Input() uploadFn: ((file: File) => Observable<DocumentRef>) | null = null;
  @Input() downloadUrlFn: ((ref: DocumentRef) => string) | null = null;
  /** Compresión configurable antes de subir. */
  @Input() photoMaxSide = 1600;
  @Input() photoQuality = 0.85;
  @Input() photoFormat: 'jpeg' | 'webp' = 'jpeg';

  @Output() valueChange = new EventEmitter<FieldValue>();

  private readonly dialog = inject(MatDialog);
  private readonly http = inject(HttpClient);
  private readonly cdr = inject(ChangeDetectorRef);

  /** Fotos en curso/subidas del modo 'preview'. */
  slots: PhotoSlot[] = [];
  /** Error de selección (extensión/tamaño) del último intento. */
  pickError: string | null = null;

  /** Blobs autenticados del modo 'readonly': document_id → objectURL. */
  readonly blobUrls = new Map<number, string>();
  readonly downloadErrors = new Set<number>();
  private readonly blobsEnCurso = new Set<number>();

  lightboxUrl: string | null = null;
  lightboxName = '';

  /** Último valor emitido, para no reconstruir los slots con nuestro propio eco. */
  private lastEmitted: FieldValue = null;

  get inputId(): string {
    return `df-${this.field.name ?? this.field.label}`;
  }

  get error(): string | null {
    return validateFieldValue(this.field, this.value);
  }

  get maxFiles(): number {
    return this.field.schema.validation?.max_files ?? 1;
  }

  get atCapacity(): boolean {
    return this.slots.length >= this.maxFiles;
  }

  get refs(): DocumentRef[] {
    return asDocumentRefs(this.value);
  }

  /** Extensiones permitidas normalizadas (minúsculas, sin punto). */
  private get allowedExtensions(): string[] {
    return (this.field.schema.validation?.allowed_extensions ?? [])
      .map(e => e.replace(/^\./, '').toLowerCase())
      .filter(e => e.length > 0);
  }

  get acceptAttr(): string {
    const exts = this.allowedExtensions;
    return exts.length ? exts.map(e => `.${e}`).join(',') : 'image/*';
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['value'] || changes['mode'] || changes['downloadUrlFn']) {
      if (this.mode === 'readonly') {
        this.syncReadonly();
      } else if (this.mode === 'preview') {
        this.syncSlotsFromValue();
      }
    }
  }

  ngOnDestroy(): void {
    for (const slot of this.slots) this.revokeIfBlob(slot.previewUrl);
    for (const url of this.blobUrls.values()) URL.revokeObjectURL(url);
    this.blobUrls.clear();
  }

  // ---------- Captura / selección (modo 'preview') ----------

  openCamera(): void {
    if (!this.uploadFn || this.atCapacity) return;
    this.dialog
      .open<CameraDialogComponent, { initialPreviewUrl?: string | null }, CameraDialogResult>(
        CameraDialogComponent,
        { width: '720px', maxWidth: '95vw', disableClose: true },
      )
      .afterClosed()
      .subscribe(result => {
        if (result?.file) {
          // El diálogo cede la propiedad de previewUrl al confirmar: la revocamos nosotros.
          void this.addFile(result.file, result.previewUrl ?? null, true);
        }
        this.cdr.markForCheck();
      });
  }

  onFilesPicked(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = ''; // permite volver a elegir el mismo archivo
    this.pickError = null;
    for (const file of files) {
      if (this.atCapacity) {
        this.pickError = `Máximo ${this.maxFiles} foto(s)`;
        break;
      }
      void this.addFile(file, null, false);
    }
    this.cdr.markForCheck();
  }

  private async addFile(file: File, previewUrl: string | null, fromCamera: boolean): Promise<void> {
    if (this.atCapacity) {
      this.revokeIfBlob(previewUrl);
      this.pickError = `Máximo ${this.maxFiles} foto(s)`;
      this.cdr.markForCheck();
      return;
    }
    // Extensión: solo para archivos elegidos por el usuario (la cámara siempre entrega
    // JPG interno y de todas formas se re-encodea a photoFormat antes de subir).
    if (!fromCamera) {
      const exts = this.allowedExtensions;
      const ext = fileExtension(file.name);
      if (exts.length > 0 && !exts.includes(ext)) {
        this.pickError = `Extensión .${ext || '?'} no permitida (se acepta: ${exts.map(e => '.' + e).join(', ')})`;
        this.revokeIfBlob(previewUrl);
        this.cdr.markForCheck();
        return;
      }
    }
    const slot: PhotoSlot = {
      ref: null,
      file,
      previewUrl: previewUrl ?? URL.createObjectURL(file),
      uploading: true,
      error: null,
    };
    this.slots = [...this.slots, slot];
    this.cdr.markForCheck();
    // TODO(dynamic-forms): la ventana de compresión (antes de llamar uploadFn) no la ve
    // el gate `subiendo()` del runtime, que cuenta por uploadFn. Un submit en esos ~200ms
    // podría no esperar la foto. Cubrirlo bien exige un @Output uploadingChange propagado
    // por field-renderer a los 4 tipos de media; pendiente (deuda anotada en runbook 16).
    await this.uploadSlot(slot);
  }

  retry(slot: PhotoSlot): void {
    void this.uploadSlot(slot);
  }

  private async uploadSlot(slot: PhotoSlot): Promise<void> {
    if (!slot.file) return;
    if (!this.uploadFn) {
      slot.uploading = false;
      slot.error = 'La subida no está disponible en este contexto';
      this.cdr.markForCheck();
      return;
    }
    slot.uploading = true;
    slot.error = null;
    this.cdr.markForCheck();
    try {
      // Siempre se re-encodea (aunque ya sea pequeña): normaliza EXIF y formato.
      const comprimida = await this.compressImage(slot.file);
      const maxMb = this.field.schema.validation?.max_size_mb ?? null;
      if (maxMb != null && comprimida.size > maxMb * 1024 * 1024) {
        throw new Error(`La imagen supera ${maxMb} MB incluso comprimida`);
      }
      const ref = await firstValueFrom(this.uploadFn(comprimida));
      slot.ref = ref;
      slot.uploading = false;
      this.emitValue(); // fail-closed: la referencia solo se emite si la subida terminó bien
    } catch (e) {
      slot.uploading = false;
      slot.error = e instanceof Error && e.message
        ? e.message
        : 'No se pudo subir la foto. Reintenta.';
    }
    this.cdr.markForCheck();
  }

  removeSlot(slot: PhotoSlot): void {
    // Solo quita la referencia local del payload; no borra nada en el servidor.
    this.revokeIfBlob(slot.previewUrl);
    this.slots = this.slots.filter(s => s !== slot);
    this.pickError = null;
    this.emitValue();
    this.cdr.markForCheck();
  }

  slotName(slot: PhotoSlot): string {
    return slot.ref?.filename ?? slot.file?.name ?? 'Foto';
  }

  private emitValue(): void {
    const refs = this.slots.map(s => s.ref).filter((r): r is DocumentRef => r != null);
    const next: FieldValue = refs.length === 0
      ? null
      : this.maxFiles === 1 ? refs[0] : refs;
    this.lastEmitted = next;
    this.value = next;
    this.valueChange.emit(next);
  }

  /** Reconstruye los slots desde un valor entrante externo (borrador precargado). */
  private syncSlotsFromValue(): void {
    if (this.value === this.lastEmitted) return; // eco de nuestra propia emisión
    const enVuelo = this.slots.filter(s => s.ref == null && (s.uploading || s.error != null));
    const asentados = this.slots.filter(s => s.ref != null);
    const refs = asDocumentRefs(this.value);
    const nuevos: PhotoSlot[] = refs.map(ref => {
      const previo = asentados.find(s => s.ref?.document_id === ref.document_id);
      return previo ?? { ref, file: null, previewUrl: null, uploading: false, error: null };
    });
    // Libera las previews de slots asentados que ya no están en el valor.
    for (const s of asentados) {
      if (!refs.some(r => r.document_id === s.ref?.document_id)) this.revokeIfBlob(s.previewUrl);
    }
    this.slots = [...nuevos, ...enVuelo];
  }

  // ---------- Compresión ----------

  /**
   * Comprime/re-encodea la imagen en cliente: lado mayor ≤ photoMaxSide,
   * salida photoFormat con photoQuality. Aunque la imagen ya sea más pequeña
   * se re-encodea igual (normaliza la orientación EXIF de paso).
   */
  private async compressImage(file: File): Promise<File> {
    const fuente = await this.decodeImage(file);
    const iw = fuente instanceof HTMLImageElement ? fuente.naturalWidth : fuente.width;
    const ih = fuente instanceof HTMLImageElement ? fuente.naturalHeight : fuente.height;
    if (!iw || !ih) throw new Error('La imagen no se pudo leer');
    const escala = Math.min(1, this.photoMaxSide / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * escala));
    const h = Math.max(1, Math.round(ih * escala));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas no disponible en este navegador');
    ctx.drawImage(fuente, 0, 0, w, h);
    if (fuente instanceof ImageBitmap) fuente.close();
    const type = this.photoFormat === 'webp' ? 'image/webp' : 'image/jpeg';
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, type, this.photoQuality));
    if (!blob) throw new Error('No fue posible codificar la imagen');
    const ext = this.photoFormat === 'webp' ? 'webp' : 'jpg';
    const base = (file.name.replace(/\.[^.]+$/, '') || 'foto').trim() || 'foto';
    return new File([blob], `${base}.${ext}`, { type });
  }

  /** createImageBitmap (aplica orientación EXIF) con fallback a <img> + onload. */
  private async decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
    if (typeof createImageBitmap === 'function') {
      try {
        return await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch {
        try {
          return await createImageBitmap(file);
        } catch { /* cae al <img> */ }
      }
    }
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('La imagen no se pudo leer')); };
      img.src = url;
    });
  }

  // ---------- Lectura autenticada (modo 'readonly') ----------

  private syncReadonly(): void {
    if (!this.downloadUrlFn) return;
    for (const ref of this.refs) {
      if (!this.blobUrls.has(ref.document_id)
        && !this.blobsEnCurso.has(ref.document_id)
        && !this.downloadErrors.has(ref.document_id)) {
        this.loadBlob(ref, false);
      }
    }
  }

  /** Baja el blob por HttpClient (el auth.interceptor agrega el JWT que un <img> no manda). */
  loadBlob(ref: DocumentRef, esReintento: boolean): void {
    if (!this.downloadUrlFn || this.blobsEnCurso.has(ref.document_id)) return;
    if (esReintento) this.downloadErrors.delete(ref.document_id);
    this.blobsEnCurso.add(ref.document_id);
    this.http.get(this.downloadUrlFn(ref), { responseType: 'blob' }).subscribe({
      next: blob => {
        this.blobsEnCurso.delete(ref.document_id);
        this.blobUrls.set(ref.document_id, URL.createObjectURL(blob));
        this.cdr.markForCheck();
      },
      error: () => {
        this.blobsEnCurso.delete(ref.document_id);
        this.downloadErrors.add(ref.document_id);
        this.cdr.markForCheck();
      },
    });
  }

  // ---------- Lightbox ----------

  openLightbox(url: string | null, name: string): void {
    if (!url) return;
    this.lightboxUrl = url;
    this.lightboxName = name;
  }

  closeLightbox(): void {
    this.lightboxUrl = null;
    this.lightboxName = '';
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.lightboxUrl) {
      this.closeLightbox();
      this.cdr.markForCheck();
    }
  }

  private revokeIfBlob(url: string | null): void {
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
  }
}
