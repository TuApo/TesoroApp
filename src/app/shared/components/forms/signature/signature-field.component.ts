import {
  ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, OnChanges,
  OnDestroy, Output, ViewChild, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, Subscription } from 'rxjs';
import {
  DocumentRef, DynamicField, FieldMode, FieldValue,
  asDocumentRefs, fileExtension, validateFieldValue,
} from '../field.model';

/** Alto CSS fijo del lienzo de firma (px); el ancho es el del contenedor. */
const ALTO_LIENZO = 180;

/**
 * Campo SIGNATURE — firma manuscrita sobre canvas PROPIO (sin librerías).
 * Pointer events con setPointerCapture (mouse, touch y stylus), trazo redondeado
 * color navy sobre fondo blanco, escalado por devicePixelRatio para nitidez.
 *
 * Contrato de media: al Confirmar se genera un PNG y se sube DE INMEDIATO vía
 * uploadFn; el valor del campo es UN DocumentRef (jamás un File nativo). Si la
 * subida falla NO se emite referencia (fail-closed) y el usuario reintenta.
 * En 'readonly' la imagen se descarga como blob autenticado (el interceptor
 * agrega el JWT que un <img src> directo no manda).
 */
@Component({
  selector: 'app-signature-field',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="df-field" [class.df-field--error]="showErrors && !!error">
      <label class="df-field__label" [id]="labelId">
        {{ field.label }}
        @if (field.required) { <span class="df-field__req" aria-hidden="true">*</span> }
      </label>
      @if (field.schema.description) {
        <p class="df-field__desc">{{ field.schema.description }}</p>
      }

      @switch (mode) {
        @case ('readonly') {
          @if (signedRef; as ref) {
            @if (imgUrl(); as url) {
              <img class="sig-img" [src]="url" [alt]="'Firma manuscrita: ' + ref.filename" />
            } @else if (loadingImg()) {
              <span class="sig-status">
                <span class="material-symbols-outlined df-spin" aria-hidden="true">progress_activity</span>
                Cargando firma…
              </span>
            } @else {
              <span class="df-field__file-chip">
                <span class="material-symbols-outlined" aria-hidden="true">draw</span>
                {{ ref.filename }}
              </span>
              @if (loadError(); as msg) {
                <p class="df-field__error" role="alert">{{ msg }}</p>
              }
            }
          } @else {
            <p class="df-field__value">—</p>
          }
        }
        @case ('config') {
          <div class="sig-config" aria-hidden="true">
            <span class="material-symbols-outlined">draw</span>
            <span>Firma manuscrita — se dibuja al llenar el formulario</span>
          </div>
        }
        @default {
          @if (signedRef; as ref) {
            <div class="df-field__files">
              <span class="df-field__file-chip">
                <span class="material-symbols-outlined" aria-hidden="true">draw</span>
                {{ ref.filename }}
              </span>
              <button type="button" class="df-field__btn" (click)="redo()">
                <span class="material-symbols-outlined" aria-hidden="true">restart_alt</span>
                Rehacer firma
              </button>
            </div>
          } @else {
            <canvas #cv class="sig-canvas"
                    role="img"
                    [attr.aria-labelledby]="labelId"
                    [attr.aria-invalid]="showErrors && !!error"
                    (pointerdown)="onDown($event)"
                    (pointermove)="onMove($event)"
                    (pointerup)="onUp($event)"
                    (pointercancel)="onUp($event)"></canvas>
            <p class="df-field__desc">Dibuja tu firma con el dedo, el lápiz o el mouse.</p>
            <div class="sig-actions">
              <button type="button" class="df-field__btn"
                      (click)="clear()" [disabled]="!hasStrokes() || uploading()">
                <span class="material-symbols-outlined" aria-hidden="true">delete</span>
                Limpiar
              </button>
              <button type="button" class="df-field__btn sig-btn--primary"
                      (click)="confirm()" [disabled]="!uploadFn || !hasStrokes() || uploading()">
                @if (uploading()) {
                  <span class="material-symbols-outlined df-spin" aria-hidden="true">progress_activity</span>
                  Subiendo…
                } @else {
                  <span class="material-symbols-outlined" aria-hidden="true">check</span>
                  Confirmar
                }
              </button>
            </div>
            @if (!uploadFn) {
              <p class="df-field__desc">La carga de archivos no está disponible en esta vista.</p>
            }
            @if (uploadError(); as msg) {
              <p class="df-field__error" role="alert">{{ msg }}</p>
            }
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
    .sig-canvas {
      display: block;
      width: 100%;
      height: 180px;
      box-sizing: border-box;
      background: #fff;
      border: 1px dashed var(--slate-300, #cbd5e1);
      border-radius: var(--r-sm, 10px);
      touch-action: none; /* que firmar no haga scroll en móvil */
      cursor: crosshair;
    }
    .df-field--error .sig-canvas { border-color: #c0392b; }
    .sig-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .sig-btn--primary {
      background: var(--navy, #21263c);
      border-color: var(--navy, #21263c);
      color: #fff;
    }
    .sig-btn--primary:hover:not(:disabled) { border-color: var(--navy-deep, #0f172a); }
    .sig-img {
      max-height: 120px;
      max-width: 100%;
      background: #fff;
      border: 1px solid var(--slate-300, #cbd5e1);
      border-radius: var(--r-sm, 10px);
    }
    .sig-config {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border: 1px dashed var(--slate-300, #cbd5e1);
      border-radius: var(--r-sm, 10px);
      color: var(--slate-500, #64748b);
      font-size: 0.88rem;
      background: var(--slate-50, #f8fafc);
    }
    .sig-status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.85rem;
      color: var(--slate-500, #64748b);
    }
    .df-spin { animation: df-spin 1s linear infinite; }
    @keyframes df-spin { to { transform: rotate(360deg); } }
  `],
})
export class SignatureFieldComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) field!: DynamicField;
  @Input() mode: FieldMode = 'preview';
  @Input() value: FieldValue = null;
  @Input() showErrors = false;
  @Input() uploadFn: ((file: File) => Observable<DocumentRef>) | null = null;
  @Input() downloadUrlFn: ((ref: DocumentRef) => string) | null = null;
  @Output() valueChange = new EventEmitter<FieldValue>();

  private readonly http = inject(HttpClient);

  // Estado de UI (signals: los callbacks async de canvas/HTTP refrescan la vista en OnPush)
  readonly hasStrokes = signal(false);
  readonly uploading = signal(false);
  readonly uploadError = signal<string | null>(null);
  readonly imgUrl = signal<string | null>(null);
  readonly loadingImg = signal(false);
  readonly loadError = signal<string | null>(null);

  // Canvas / dibujo
  private canvasEl: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private drawing = false;
  private last: { x: number; y: number } | null = null;
  private resizeObs: ResizeObserver | null = null;

  private uploadSub: Subscription | null = null;
  private loadSub: Subscription | null = null;
  private loadedDocId: number | null = null;

  /** El canvas vive dentro de @if: el setter (re)inicializa cada instancia nueva. */
  @ViewChild('cv') set canvasRef(ref: ElementRef<HTMLCanvasElement> | undefined) {
    const el = ref?.nativeElement ?? null;
    if (el === this.canvasEl) return;
    this.teardownCanvas();
    this.canvasEl = el;
    if (el) {
      this.setupContext(el, el.clientWidth || 300);
      this.resizeObs = new ResizeObserver(() => this.resizeCanvas());
      this.resizeObs.observe(el);
    }
  }

  get labelId(): string {
    return `df-${this.field.name ?? this.field.label}-label`;
  }

  get error(): string | null {
    return validateFieldValue(this.field, this.value);
  }

  /** SIGNATURE es siempre UNA referencia (max_files === 1 por definición del tipo). */
  get signedRef(): DocumentRef | null {
    return asDocumentRefs(this.value)[0] ?? null;
  }

  ngOnChanges(): void {
    if (this.mode === 'readonly') this.loadReadonlyImage();
  }

  ngOnDestroy(): void {
    this.teardownCanvas();
    this.uploadSub?.unsubscribe();
    this.loadSub?.unsubscribe();
    this.revokeUrl();
  }

  // ---------- Dibujo (pointer events: mouse + touch + stylus) ----------

  onDown(ev: PointerEvent): void {
    if (!this.ctx || !this.canvasEl || this.uploading()) return;
    ev.preventDefault();
    this.canvasEl.setPointerCapture(ev.pointerId);
    this.drawing = true;
    const p = this.point(ev);
    this.last = p;
    // Un tap también deja marca (punto)
    this.ctx.beginPath();
    this.ctx.moveTo(p.x, p.y);
    this.ctx.lineTo(p.x + 0.01, p.y + 0.01);
    this.ctx.stroke();
    this.hasStrokes.set(true);
    this.uploadError.set(null);
  }

  onMove(ev: PointerEvent): void {
    if (!this.drawing || !this.ctx || !this.last) return;
    ev.preventDefault();
    const p = this.point(ev);
    this.ctx.beginPath();
    this.ctx.moveTo(this.last.x, this.last.y);
    this.ctx.lineTo(p.x, p.y);
    this.ctx.stroke();
    this.last = p;
  }

  onUp(ev: PointerEvent): void {
    this.drawing = false;
    this.last = null;
    if (this.canvasEl?.hasPointerCapture(ev.pointerId)) {
      this.canvasEl.releasePointerCapture(ev.pointerId);
    }
  }

  clear(): void {
    const canvas = this.canvasEl;
    if (!canvas || !this.ctx) return;
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, canvas.clientWidth, ALTO_LIENZO);
    this.hasStrokes.set(false);
    this.uploadError.set(null);
  }

  /** Vuelve al lienzo descartando la firma ya confirmada. */
  redo(): void {
    this.value = null;
    this.hasStrokes.set(false);
    this.uploadError.set(null);
    this.valueChange.emit(null);
  }

  // ---------- Confirmar = PNG → subir INMEDIATO (fail-closed) ----------

  confirm(): void {
    const canvas = this.canvasEl;
    const fn = this.uploadFn;
    if (!canvas || !fn || !this.hasStrokes() || this.uploading()) return;
    this.uploading.set(true);
    this.uploadError.set(null);
    canvas.toBlob(blob => {
      if (!blob) {
        this.uploading.set(false);
        this.uploadError.set('No se pudo generar la imagen de la firma.');
        return;
      }
      const file = new File([blob], 'firma.png', { type: 'image/png' });
      const clientError = this.validateFile(file);
      if (clientError) {
        this.uploading.set(false);
        this.uploadError.set(clientError);
        return;
      }
      this.uploadSub?.unsubscribe();
      this.uploadSub = fn(file).subscribe({
        next: ref => {
          this.uploading.set(false);
          this.value = ref; // UNA referencia: objeto, no array
          this.valueChange.emit(ref);
        },
        error: () => {
          // Fail-closed: sin referencia; el trazo queda en el lienzo para reintentar
          this.uploading.set(false);
          this.uploadError.set('No se pudo subir la firma. Verifica tu conexión e intenta de nuevo.');
        },
      });
    }, 'image/png');
  }

  /** Validación cliente (extensión y tamaño) antes de subir; el backend manda. */
  private validateFile(file: File): string | null {
    const val = this.field.schema?.validation ?? {};
    const ext = fileExtension(file.name);
    if (val.allowed_extensions?.length
        && !val.allowed_extensions.map(e => e.toLowerCase()).includes(ext)) {
      return `Extensión .${ext} no permitida (permitidas: ${val.allowed_extensions.join(', ')})`;
    }
    if (val.max_size_mb != null && file.size > val.max_size_mb * 1024 * 1024) {
      return `La firma supera el tamaño máximo de ${val.max_size_mb} MB`;
    }
    return null;
  }

  // ---------- Readonly: blob autenticado (el <img> directo no manda el JWT) ----------

  private loadReadonlyImage(): void {
    const ref = this.signedRef;
    if (!ref || !this.downloadUrlFn) return;
    if (ref.document_id === this.loadedDocId) return;
    this.loadedDocId = ref.document_id;
    this.loadingImg.set(true);
    this.loadError.set(null);
    this.loadSub?.unsubscribe();
    this.loadSub = this.http.get(this.downloadUrlFn(ref), { responseType: 'blob' }).subscribe({
      next: blob => {
        this.revokeUrl();
        this.imgUrl.set(URL.createObjectURL(blob));
        this.loadingImg.set(false);
      },
      error: () => {
        this.loadingImg.set(false);
        this.loadError.set('No se pudo cargar la imagen de la firma.');
      },
    });
  }

  private revokeUrl(): void {
    const url = this.imgUrl();
    if (url) {
      URL.revokeObjectURL(url);
      this.imgUrl.set(null);
    }
  }

  // ---------- Lienzo: tamaño responsive + nitidez por devicePixelRatio ----------

  private setupContext(canvas: HTMLCanvasElement, cssWidth: number): void {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    canvas.height = Math.round(ALTO_LIENZO * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // coordenadas en px CSS
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = (getComputedStyle(canvas).getPropertyValue('--navy') || '').trim() || '#21263c';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cssWidth, ALTO_LIENZO); // fondo blanco (queda en el PNG exportado)
    this.ctx = ctx;
  }

  /** Redimensiona sin perder el trazo (snapshot → redibujar estirado). */
  private resizeCanvas(): void {
    const canvas = this.canvasEl;
    if (!canvas || !this.ctx) return;
    const cssWidth = canvas.clientWidth;
    const dpr = window.devicePixelRatio || 1;
    if (cssWidth <= 0 || Math.round(cssWidth * dpr) === canvas.width) return;
    const snap = document.createElement('canvas');
    snap.width = canvas.width;
    snap.height = canvas.height;
    snap.getContext('2d')?.drawImage(canvas, 0, 0);
    this.setupContext(canvas, cssWidth);
    if (this.hasStrokes() && snap.width > 0) {
      this.ctx.drawImage(snap, 0, 0, cssWidth, ALTO_LIENZO);
    }
  }

  private teardownCanvas(): void {
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    this.ctx = null;
    this.drawing = false;
    this.last = null;
  }

  private point(ev: PointerEvent): { x: number; y: number } {
    const rect = this.canvasEl!.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }
}
