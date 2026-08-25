import {
  ChangeDetectionStrategy, Component, DestroyRef, EventEmitter, Input,
  OnDestroy, Output, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatDialog } from '@angular/material/dialog';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import {
  DocumentRef, DynamicField, FieldMode, FieldValue,
  asDocumentRefs, fileExtension, validateFieldValue,
} from '../field.model';

/** Extensiones aceptadas al SUBIR un archivo ya existente (el escáner produce PDF). */
const EXTENSIONES_SCAN_DEFAULT = ['pdf', 'jpg', 'jpeg', 'png'];

interface SubidaEnCurso { name: string; }

/**
 * Campos SCAN_DOC (escanear documento) y SCAN_ID (escanear cédula) — mismo contrato de
 * media que FILE/PHOTO: el valor son REFERENCIAS DocumentRef, nunca un File nativo.
 *
 * Lo que cambia es el ORIGEN del archivo: en vez del selector del sistema se abre el
 * escáner de la plataforma (detección de bordes, recorte perspectivo, filtros y OCR
 * opcional; el mismo de Gestión Documental) y lo que devuelve es un PDF por documento:
 *
 *  - SCAN_DOC → un PDF con las N páginas que se capturen.
 *  - SCAN_ID  → flujo GUIADO frente + reverso que deja las dos caras en UN SOLO PDF
 *               (el motivo de que exista este tipo: dos PDFs sueltos no sirven).
 *
 * `max_files` decide cuántos documentos admite el campo — uno o varios, lo elige quien
 * arma el formulario. Subir un archivo ya existente sigue disponible como alternativa.
 *
 * El diálogo del escáner se carga con import() DINÁMICO: arrastra OpenCV, Tesseract y
 * jsPDF, y no tiene por qué pesar en el bundle de todo el que abra un formulario.
 */
@Component({
  selector: 'app-scan-field',
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
                <span class="df-field__file-chip">
                  <span class="material-symbols-outlined" aria-hidden="true">{{ icono }}</span>
                  <span class="df-chip__name" [title]="ref.filename">{{ ref.filename }}</span>
                  <span class="df-chip__size">{{ formatoTamano(ref.size) }}</span>
                  @if (downloadUrlFn) {
                    <button type="button" class="df-chip__action"
                            (click)="descargarRef(ref)" [disabled]="descargando(ref)"
                            [attr.aria-label]="'Descargar ' + ref.filename">
                      <span class="material-symbols-outlined" aria-hidden="true"
                            [class.df-spin]="descargando(ref)">
                        {{ descargando(ref) ? 'progress_activity' : 'download' }}
                      </span>
                    </button>
                  }
                </span>
              }
            </div>
            @if (errorDescarga()) {
              <p class="df-field__error" role="alert">{{ errorDescarga() }}</p>
            }
          }
        }
        @case ('config') {
          <button type="button" class="df-field__btn" disabled>
            <span class="material-symbols-outlined" aria-hidden="true">{{ icono }}</span>
            {{ textoBoton }}
          </button>
          <p class="df-field__desc">{{ ayuda }}</p>
        }
        @default {
          @if (refs.length > 0 || subiendo().length > 0) {
            <div class="df-field__files">
              @for (ref of refs; track ref.document_id) {
                <span class="df-field__file-chip">
                  <span class="material-symbols-outlined" aria-hidden="true">{{ icono }}</span>
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
            <div class="df-scan__acciones">
              <button type="button" class="df-field__btn df-field__btn--primario" [id]="inputId"
                      (click)="escanear()" [disabled]="!uploadFn || abriendo()"
                      [attr.aria-required]="field.required"
                      [attr.aria-invalid]="showErrors && !!error"
                      [attr.aria-describedby]="errorSubida() ? errorId : null">
                <span class="material-symbols-outlined" aria-hidden="true"
                      [class.df-spin]="abriendo()">
                  {{ abriendo() ? 'progress_activity' : icono }}
                </span>
                {{ abriendo() ? 'Abriendo escáner…' : textoBoton }}
              </button>

              <input #picker type="file" class="df-visually-hidden"
                     [accept]="acceptAttr" [multiple]="cupoLibre > 1"
                     (change)="onArchivosElegidos(picker)"
                     tabindex="-1" aria-hidden="true" />
              <button type="button" class="df-field__btn" (click)="picker.click()"
                      [disabled]="!uploadFn">
                <span class="material-symbols-outlined" aria-hidden="true">upload_file</span>
                Subir archivo
              </button>
            </div>
            <p class="df-field__desc">{{ refs.length + subiendo().length }} de {{ maxFiles }} · {{ ayuda }}</p>
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
    .df-scan__acciones {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .df-field__btn--primario {
      border-color: var(--navy, #21263c);
      background: var(--navy, #21263c);
      color: #fff;
    }
    .df-field__btn--primario:hover:not(:disabled) { filter: brightness(1.08); }
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
    .df-chip__action:hover:not(:disabled) {
      color: var(--navy, #21263c);
      background: var(--slate-200, #e2e8f0);
    }
    .df-chip__action--remove:hover:not(:disabled) { color: #c0392b; }
    .df-chip__action:disabled { cursor: default; }
    .df-chip__action:focus-visible {
      outline: 2px solid var(--lime, #8cd50a);
      outline-offset: 1px;
    }
    .df-spin { animation: df-rotate 1s linear infinite; }
    @keyframes df-rotate { to { transform: rotate(360deg); } }
  `],
})
export class ScanFieldComponent implements OnDestroy {
  @Input({ required: true }) field!: DynamicField;
  @Input() mode: FieldMode = 'preview';
  @Input() value: FieldValue = null;
  @Input() showErrors = false;
  @Input() uploadFn: ((file: File) => Observable<DocumentRef>) | null = null;
  @Input() downloadUrlFn: ((ref: DocumentRef) => string) | null = null;
  @Output() valueChange = new EventEmitter<FieldValue>();

  private readonly http = inject(HttpClient);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);

  readonly subiendo = signal<SubidaEnCurso[]>([]);
  readonly errorSubida = signal<string | null>(null);
  /** El chunk del escáner se está descargando (import dinámico). */
  readonly abriendo = signal(false);
  private readonly descargas = signal<Record<number, boolean>>({});
  readonly errorDescarga = signal<string | null>(null);
  private objectUrls: string[] = [];

  get esCedula(): boolean { return this.field.type === 'SCAN_ID'; }

  get inputId(): string { return `df-${this.field.name ?? this.field.label}`; }
  get errorId(): string { return `${this.inputId}-scan-error`; }
  get icono(): string { return this.esCedula ? 'badge' : 'document_scanner'; }

  get textoBoton(): string {
    if (this.esCedula) return 'Escanear cédula';
    return this.maxFiles > 1 ? 'Escanear documentos' : 'Escanear documento';
  }

  get ayuda(): string {
    return this.esCedula
      ? `Frente y reverso en un solo PDF · hasta ${this.maxFiles} cédula(s)`
      : `Un PDF por documento (varias páginas) · hasta ${this.maxFiles} documento(s)`;
  }

  get refs(): DocumentRef[] { return asDocumentRefs(this.value); }

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
    return lista.length > 0 ? lista : EXTENSIONES_SCAN_DEFAULT;
  }

  get acceptAttr(): string {
    return this.extensionesPermitidas.map(e => `.${e}`).join(',');
  }

  /** Documentos que todavía caben. */
  get cupoLibre(): number {
    return this.maxFiles - this.refs.length - this.subiendo().length;
  }

  get puedeAgregar(): boolean { return this.cupoLibre > 0; }

  get error(): string | null { return validateFieldValue(this.field, this.value); }

  ngOnDestroy(): void {
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls = [];
  }

  descargando(ref: DocumentRef): boolean {
    return this.descargas()[ref.document_id] === true;
  }

  /**
   * Abre el escáner. El diálogo devuelve un File PDF por documento capturado; en modo
   * cédula devuelve exactamente uno (frente + reverso), porque él mismo exige las dos
   * caras antes de dejar finalizar.
   */
  async escanear(): Promise<void> {
    if (!this.uploadFn || this.abriendo() || !this.puedeAgregar) return;
    this.errorSubida.set(null);
    this.abriendo.set(true);
    try {
      const { DocumentScanDialogComponent } = await import(
        '@/app/features/dashboard/submodule/document-management/components/document-scan-dialog/document-scan-dialog.component');
      const ref = this.dialog.open(DocumentScanDialogComponent, {
        maxWidth: '100vw',
        maxHeight: '100vh',
        height: '100%',
        width: '100%',
        panelClass: 'full-screen-dialog',
        disableClose: true,
        data: {
          modo: this.esCedula ? 'cedula' : 'libre',
          maxDocs: this.cupoLibre,
          docName: this.esCedula ? 'Cédula' : this.field.label,
        },
      });
      ref.afterClosed()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((archivos: File[] | undefined) => {
          if (Array.isArray(archivos)) this.recibirArchivos(archivos);
        });
    } catch {
      this.errorSubida.set('No se pudo abrir el escáner. Sube el archivo o intenta de nuevo.');
    } finally {
      this.abriendo.set(false);
    }
  }

  onArchivosElegidos(input: HTMLInputElement): void {
    const archivos = Array.from(input.files ?? []);
    input.value = '';
    this.recibirArchivos(archivos);
  }

  quitarRef(ref: DocumentRef): void {
    this.errorSubida.set(null);
    this.emitirRefs(this.refs.filter(r => r.document_id !== ref.document_id));
  }

  descargarRef(ref: DocumentRef): void {
    const fn = this.downloadUrlFn;
    if (!fn || this.descargando(ref)) return;
    this.errorDescarga.set(null);
    this.descargas.update(d => ({ ...d, [ref.document_id]: true }));
    this.http.get(fn(ref), { responseType: 'blob' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: blob => {
          this.descargas.update(d => ({ ...d, [ref.document_id]: false }));
          const url = URL.createObjectURL(blob);
          this.objectUrls.push(url);
          const ancla = document.createElement('a');
          ancla.href = url;
          ancla.download = ref.filename;
          ancla.click();
        },
        error: () => {
          this.descargas.update(d => ({ ...d, [ref.document_id]: false }));
          this.errorDescarga.set(`No se pudo descargar «${ref.filename}». Intenta de nuevo.`);
        },
      });
  }

  formatoTamano(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toLocaleString('es-CO', { maximumFractionDigits: 1 })} KB`;
    const mb = kb / 1024;
    return `${mb.toLocaleString('es-CO', { maximumFractionDigits: 1 })} MB`;
  }

  /** Valida cupo, extensión y tamaño; sube uno a uno (fail-closed por archivo). */
  private recibirArchivos(archivos: File[]): void {
    if (archivos.length === 0 || !this.uploadFn) return;
    this.errorSubida.set(null);
    const errores: string[] = [];
    let cupos = this.cupoLibre;
    for (const archivo of archivos) {
      if (cupos <= 0) {
        errores.push(`Máximo ${this.maxFiles} documento(s); «${archivo.name}» no se subió`);
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

  private validarArchivo(archivo: File): string | null {
    const ext = fileExtension(archivo.name);
    if (!this.extensionesPermitidas.includes(ext)) {
      return `«${archivo.name}»: formato no permitido (permitidos: ${this.extensionesPermitidas.join(', ')})`;
    }
    if (this.maxSizeMb != null && archivo.size > this.maxSizeMb * 1024 * 1024) {
      return `«${archivo.name}» supera el tamaño máximo de ${this.maxSizeMb} MB`;
    }
    return null;
  }

  private subirUno(archivo: File): void {
    if (!this.uploadFn) return;
    const entrada: SubidaEnCurso = { name: archivo.name };
    this.subiendo.update(u => [...u, entrada]);
    this.uploadFn(archivo)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ref => {
          this.subiendo.update(u => u.filter(e => e !== entrada));
          this.emitirRefs([...this.refs, ref]);
        },
        error: () => {
          this.subiendo.update(u => u.filter(e => e !== entrada));
          this.errorSubida.set(`No se pudo subir «${archivo.name}». Intenta de nuevo.`);
        },
      });
  }

  /** Objeto si max_files===1, array si >1 — mismo contrato que el resto de media. */
  private emitirRefs(refs: DocumentRef[]): void {
    const v: FieldValue = refs.length === 0
      ? null
      : (this.maxFiles === 1 ? refs[0] : refs);
    this.value = v;
    this.valueChange.emit(v);
  }
}
