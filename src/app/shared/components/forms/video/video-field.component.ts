import {
  ChangeDetectionStrategy, Component, DestroyRef, EventEmitter, Input,
  OnChanges, OnDestroy, Output, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import {
  DocumentRef, DynamicField, FieldMode, FieldValue,
  asDocumentRefs, fileExtension, validateFieldValue,
} from '../field.model';

/** Extensiones por defecto cuando el schema no define allowed_extensions. */
const EXTENSIONES_VIDEO_DEFAULT = ['mp4', 'mov', 'avi', 'mkv'];

interface SubidaEnCurso { name: string; size: number; }
interface EstadoPreview { state: 'loading' | 'ready' | 'error'; url: string | null; }

/**
 * Campo VIDEO — contrato uniforme de campos + contrato extendido de media:
 * el valor son REFERENCIAS DocumentRef (objeto si max_files===1, array si >1);
 * el File nativo se sube INMEDIATAMENTE vía uploadFn y jamás viaja en el payload.
 * En 'readonly' el blob se baja autenticado (HttpClient + interceptor JWT) y se
 * reproduce con <video controls> sobre un object URL (revocado en ngOnDestroy);
 * si el mime no es video/ se ofrece un enlace de descarga con ese mismo blob.
 */
@Component({
  selector: 'app-video-field',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="df-field" [class.df-field--error]="showErrors && error">
      <label class="df-field__label" [attr.for]="inputId">
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
          } @else {
            <div class="df-field__files">
              @for (ref of refs; track ref.document_id) {
                @let pv = previewOf(ref);
                @if (pv && pv.state === 'ready' && esVideo(ref)) {
                  <figure class="df-video-wrap">
                    <video class="df-video" controls preload="metadata"
                           [attr.src]="pv.url"
                           [attr.aria-label]="'Video: ' + ref.filename"></video>
                    <figcaption class="df-field__desc">
                      {{ ref.filename }} · {{ formatoTamano(ref.size) }}
                    </figcaption>
                  </figure>
                } @else if (pv && pv.state === 'ready') {
                  <!-- Mime no reproducible: enlace de descarga sobre el blob ya autenticado -->
                  <a class="df-field__file-chip" [attr.href]="pv.url" [attr.download]="ref.filename">
                    <span class="material-symbols-outlined" aria-hidden="true">download</span>
                    <span class="df-chip__name" [title]="ref.filename">{{ ref.filename }}</span>
                    <span class="df-chip__size">{{ formatoTamano(ref.size) }}</span>
                  </a>
                } @else if (pv && pv.state === 'loading') {
                  <span class="df-field__file-chip" role="status">
                    <span class="material-symbols-outlined df-spin" aria-hidden="true">progress_activity</span>
                    Cargando «{{ ref.filename }}»…
                  </span>
                } @else if (pv && pv.state === 'error') {
                  <span class="df-field__file-chip df-chip--error" role="alert">
                    <span class="material-symbols-outlined" aria-hidden="true">error</span>
                    No se pudo cargar «{{ ref.filename }}»
                  </span>
                } @else {
                  <!-- Sin downloadUrlFn: solo la referencia, sin preview ni descarga -->
                  <span class="df-field__file-chip">
                    <span class="material-symbols-outlined" aria-hidden="true">movie</span>
                    <span class="df-chip__name" [title]="ref.filename">{{ ref.filename }}</span>
                    <span class="df-chip__size">{{ formatoTamano(ref.size) }}</span>
                  </span>
                }
              }
            </div>
          }
        }
        @case ('config') {
          <button type="button" class="df-field__btn" disabled>
            <span class="material-symbols-outlined" aria-hidden="true">videocam</span>
            Subir video
          </button>
          <p class="df-field__desc">
            Formatos: {{ extensionesPermitidas.join(', ') }}@if (maxSizeMb) { · máx. {{ maxSizeMb }} MB}
          </p>
        }
        @default {
          @if (refs.length > 0 || subiendo().length > 0) {
            <div class="df-field__files">
              @for (ref of refs; track ref.document_id) {
                <span class="df-field__file-chip">
                  <span class="material-symbols-outlined" aria-hidden="true">movie</span>
                  <span class="df-chip__name" [title]="ref.filename">{{ ref.filename }}</span>
                  <span class="df-chip__size">{{ formatoTamano(ref.size) }}</span>
                  <button type="button" class="df-chip__action df-chip__action--remove"
                          (click)="quitarRef(ref)"
                          [attr.aria-label]="'Quitar ' + ref.filename">
                    <span class="material-symbols-outlined" aria-hidden="true">close</span>
                  </button>
                </span>
              }
              @for (up of subiendo(); track up) {
                <span class="df-field__file-chip" role="status">
                  <span class="material-symbols-outlined df-spin" aria-hidden="true">progress_activity</span>
                  <span class="df-chip__name" [title]="up.name">{{ up.name }}</span>
                  <span class="df-chip__size">subiendo…</span>
                </span>
              }
            </div>
          }
          @if (puedeAgregar) {
            <input #picker type="file" class="df-visually-hidden"
                   [accept]="acceptAttr" [multiple]="maxFiles > 1"
                   (change)="onArchivosElegidos(picker)"
                   tabindex="-1" aria-hidden="true" />
            <button type="button" class="df-field__btn" [id]="inputId"
                    (click)="picker.click()" [disabled]="!uploadFn"
                    [attr.aria-required]="field.required"
                    [attr.aria-invalid]="showErrors && !!error"
                    [attr.aria-describedby]="errorSubida() ? errorId : null">
              <span class="material-symbols-outlined" aria-hidden="true">videocam</span>
              {{ refs.length === 0 ? 'Subir video' : 'Agregar video' }}
            </button>
          }
          @if (!uploadFn) {
            <p class="df-field__desc">La subida de archivos no está disponible en esta vista.</p>
          }
          @if (errorSubida()) {
            <p class="df-field__error" role="alert" [id]="errorId">{{ errorSubida() }}</p>
          }
        }
      }

      @if (showErrors && error && mode === 'preview') {
        <p class="df-field__error" role="alert">{{ error }}</p>
      }
    </div>
  `,
  styleUrls: ['../field-shared.css'],
  styles: [`
    .df-visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
      overflow: hidden;
      pointer-events: none;
      clip-path: inset(50%);
    }
    .df-video-wrap {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 0;
      min-width: 0;
      max-width: 100%;
    }
    .df-video {
      width: 420px;
      max-width: 100%;
      border: 1px solid var(--slate-300, #cbd5e1);
      border-radius: var(--r-sm, 10px);
      background: #000;
    }
    .df-chip__name {
      max-width: 220px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .df-chip__size {
      color: var(--slate-500, #64748b);
      white-space: nowrap;
    }
    .df-chip--error {
      border-color: #c0392b;
      color: #c0392b;
    }
    .df-chip__action {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 2px;
      border: none;
      border-radius: 50%;
      background: transparent;
      color: var(--slate-500, #64748b);
      cursor: pointer;
    }
    .df-chip__action .material-symbols-outlined { font-size: 16px; }
    .df-chip__action--remove:hover {
      color: #c0392b;
      background: var(--slate-200, #e2e8f0);
    }
    .df-chip__action:focus-visible {
      outline: 2px solid var(--lime, #8cd50a);
      outline-offset: 1px;
    }
    .df-spin { animation: df-rotate 1s linear infinite; }
    @keyframes df-rotate { to { transform: rotate(360deg); } }
  `],
})
export class VideoFieldComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) field!: DynamicField;
  @Input() mode: FieldMode = 'preview';
  @Input() value: FieldValue = null;
  @Input() showErrors = false;
  /** Sube el archivo y devuelve la referencia; sin ella el botón queda deshabilitado. */
  @Input() uploadFn: ((file: File) => Observable<DocumentRef>) | null = null;
  /** Construye la URL de descarga de una referencia (la baja HttpClient con JWT). */
  @Input() downloadUrlFn: ((ref: DocumentRef) => string) | null = null;
  @Output() valueChange = new EventEmitter<FieldValue>();

  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  /** Subidas con spinner por archivo (fail-closed: si falla, no se emite referencia). */
  readonly subiendo = signal<SubidaEnCurso[]>([]);
  readonly errorSubida = signal<string | null>(null);
  /** Estado de los blobs bajados en 'readonly', por document_id. */
  private readonly previews = signal<Record<number, EstadoPreview>>({});
  /** Object URLs creados; se revocan todos en ngOnDestroy. */
  private objectUrls: string[] = [];

  get inputId(): string {
    return `df-${this.field.name ?? this.field.label}`;
  }

  get errorId(): string {
    return `${this.inputId}-upload-error`;
  }

  get refs(): DocumentRef[] {
    return asDocumentRefs(this.value);
  }

  get maxFiles(): number {
    return this.field.schema?.validation?.max_files ?? 1;
  }

  get maxSizeMb(): number | null {
    return this.field.schema?.validation?.max_size_mb ?? null;
  }

  get extensionesPermitidas(): string[] {
    const lista = (this.field.schema?.validation?.allowed_extensions ?? [])
      .map(e => e.replace(/^\./, '').toLowerCase())
      .filter(Boolean);
    return lista.length > 0 ? lista : EXTENSIONES_VIDEO_DEFAULT;
  }

  get acceptAttr(): string {
    return this.extensionesPermitidas.map(e => `.${e}`).join(',');
  }

  get puedeAgregar(): boolean {
    return this.refs.length + this.subiendo().length < this.maxFiles;
  }

  get error(): string | null {
    return validateFieldValue(this.field, this.value);
  }

  ngOnChanges(): void {
    if (this.mode === 'readonly') this.cargarPreviews();
  }

  ngOnDestroy(): void {
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls = [];
  }

  esVideo(ref: DocumentRef): boolean {
    return (ref.mime_type ?? '').startsWith('video/');
  }

  previewOf(ref: DocumentRef): EstadoPreview | null {
    return this.previews()[ref.document_id] ?? null;
  }

  /** Tamaño legible en formato es-CO (B / KB / MB). */
  formatoTamano(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toLocaleString('es-CO', { maximumFractionDigits: 1 })} KB`;
    const mb = kb / 1024;
    return `${mb.toLocaleString('es-CO', { maximumFractionDigits: 1 })} MB`;
  }

  onArchivosElegidos(input: HTMLInputElement): void {
    const archivos = Array.from(input.files ?? []);
    input.value = ''; // permite volver a elegir el mismo archivo
    if (archivos.length === 0 || !this.uploadFn) return;
    this.errorSubida.set(null);

    const errores: string[] = [];
    let cupos = this.maxFiles - this.refs.length - this.subiendo().length;
    for (const archivo of archivos) {
      if (cupos <= 0) {
        errores.push(`Máximo ${this.maxFiles} archivo(s); «${archivo.name}» no se subió`);
        continue;
      }
      const err = this.validarArchivo(archivo);
      if (err) {
        errores.push(err);
        continue;
      }
      cupos--;
      this.subirUno(archivo);
    }
    if (errores.length > 0) this.errorSubida.set(errores.join(' · '));
  }

  quitarRef(ref: DocumentRef): void {
    this.errorSubida.set(null);
    this.emitirRefs(this.refs.filter(r => r.document_id !== ref.document_id));
  }

  /** Validación en cliente ANTES de subir: extensión y tamaño. */
  private validarArchivo(archivo: File): string | null {
    const ext = fileExtension(archivo.name);
    if (!this.extensionesPermitidas.includes(ext)) {
      return `«${archivo.name}»: extensión no permitida (permitidas: ${this.extensionesPermitidas.join(', ')})`;
    }
    if (this.maxSizeMb != null && archivo.size > this.maxSizeMb * 1024 * 1024) {
      return `«${archivo.name}» supera el tamaño máximo de ${this.maxSizeMb} MB`;
    }
    return null;
  }

  private subirUno(archivo: File): void {
    if (!this.uploadFn) return;
    const entrada: SubidaEnCurso = { name: archivo.name, size: archivo.size };
    this.subiendo.update(u => [...u, entrada]);
    this.uploadFn(archivo)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ref => {
          this.subiendo.update(u => u.filter(e => e !== entrada));
          this.emitirRefs([...this.refs, ref]);
        },
        error: () => {
          // Fail-closed: sin referencia emitida; el usuario reintenta.
          this.subiendo.update(u => u.filter(e => e !== entrada));
          this.errorSubida.set(`No se pudo subir «${archivo.name}». Intenta de nuevo.`);
        },
      });
  }

  /** Objeto si max_files===1, array si >1 — nunca un File nativo. */
  private emitirRefs(refs: DocumentRef[]): void {
    const v: FieldValue = refs.length === 0
      ? null
      : (this.maxFiles === 1 ? refs[0] : refs);
    this.value = v;
    this.valueChange.emit(v);
  }

  /** Baja los blobs autenticados de 'readonly' (el interceptor agrega el JWT). */
  private cargarPreviews(): void {
    const fn = this.downloadUrlFn;
    if (!fn) return;
    for (const ref of this.refs) {
      if (this.previews()[ref.document_id]) continue;
      this.previews.update(p => ({ ...p, [ref.document_id]: { state: 'loading', url: null } }));
      this.http.get(fn(ref), { responseType: 'blob' })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: blob => {
            const url = URL.createObjectURL(blob);
            this.objectUrls.push(url);
            this.previews.update(p => ({ ...p, [ref.document_id]: { state: 'ready', url } }));
          },
          error: () => {
            this.previews.update(p => ({ ...p, [ref.document_id]: { state: 'error', url: null } }));
          },
        });
    }
  }
}
