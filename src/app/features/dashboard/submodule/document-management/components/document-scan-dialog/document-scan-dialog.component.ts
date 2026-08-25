import {
    Component,
    ElementRef,
    OnInit,
    OnDestroy,
    Optional,
    ViewChild,
    Inject,
    PLATFORM_ID,
    ChangeDetectorRef,
    ChangeDetectionStrategy,
    NgZone
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatChipsModule } from '@angular/material/chips';
import { MatBadgeModule } from '@angular/material/badge';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { Capacitor } from '@capacitor/core';
import { DocumentScanner, ResponseType } from '@capgo/capacitor-document-scanner';
import Swal from 'sweetalert2';
import jsPDF from 'jspdf';
import dayjs from 'dayjs';

import {
    DocumentScannerService,
    DetectedCorners,
    FilterMode
} from '../../service/scanner/document-scanner.service';
import { OpencvLoaderService } from '../../service/scanner/opencv-loader.service';
import { OcrService, OcrPageResult } from '../../service/scanner/ocr.service';

export interface ScannedPage {
    raw: string;
    processed: string;
    filter: FilterMode;
    ocr?: OcrPageResult;
}

export interface ScannedDoc {
    id: string;
    name: string;
    createdAt: Date;
    pages: ScannedPage[];
    thumb: string;
}

/**
 * Ajustes opcionales del diálogo (MAT_DIALOG_DATA). Sin ellos se comporta como
 * siempre: escaneo libre, documentos ilimitados de N páginas cada uno.
 *
 * `modo: 'cedula'` es el flujo guiado de documento de identidad: TODO lo capturado
 * cae en UN solo documento de dos páginas (frente y reverso), que es lo que pide el
 * campo de formulario "Escanear cédula" — dos PDFs sueltos no sirven ahí.
 */
export interface ScanDialogConfig {
    modo?: 'libre' | 'cedula';
    /** Tope de documentos (PDF) que puede devolver el diálogo. */
    maxDocs?: number;
    /** Nombre del documento en modo cédula (por defecto "Cédula"). */
    docName?: string;
}

/** Páginas exactas del flujo de cédula, en orden. */
const CARAS_CEDULA = ['Frente', 'Reverso'];

interface CornerPx { x: number; y: number; }

const STABILITY_FRAMES = 8;
const STABILITY_THRESHOLD_PX = 12;
const MIN_CONFIDENCE = 0.55;
const BLUR_THRESHOLD = 80;
const MAX_PDF_BYTES = 10 * 1024 * 1024;

@Component({
    selector: 'app-document-scan-dialog',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        MatButtonModule,
        MatIconModule,
        MatInputModule,
        MatFormFieldModule,
        MatDialogModule,
        MatProgressSpinnerModule,
        MatTooltipModule,
        MatSlideToggleModule,
        MatButtonToggleModule,
        MatChipsModule,
        MatBadgeModule,
        DragDropModule
    ],
    templateUrl: './document-scan-dialog.component.html',
    styleUrls: ['./document-scan-dialog.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class DocumentScanDialogComponent implements OnInit, OnDestroy {
    @ViewChild('video') videoElement?: ElementRef<HTMLVideoElement>;
    @ViewChild('canvas') canvasElement?: ElementRef<HTMLCanvasElement>;
    @ViewChild('detectCanvas') detectCanvas?: ElementRef<HTMLCanvasElement>;

    mode: 'list' | 'capture-web' | 'crop' | 'preview' = 'list';
    isNative = false;

    scannedDocs: ScannedDoc[] = [];

    tempPages: ScannedPage[] = [];
    showFlash = false;

    autoCapture = true;
    autoCaptureCountdown = 0;
    isCvLoading = false;
    cvReady = false;
    detectionConfidence = 0;
    detectedOverlay: CornerPx[] | null = null;
    overlayViewBox = '0 0 100 100';
    blurWarning = false;

    cropSourceImage = '';
    cropPoints: CornerPx[] = [];
    activePointIndex: number | null = null;
    isDragging = false;
    magnifierPos = { x: 0, y: 0 };
    isProcessingCrop = false;
    cropEditMode: 'new' | 'edit' = 'new';
    editingPageIndex: number | null = null;
    natW = 0;
    natH = 0;

    @ViewChild('cropStage') cropStage?: ElementRef<HTMLDivElement>;
    @ViewChild('cropImage') cropImage?: ElementRef<HTMLImageElement>;
    @ViewChild('magnifierCanvas') magnifierCanvas?: ElementRef<HTMLCanvasElement>;

    currentDocId: string | null = null;
    currentDocName = '';
    currentDocPages: ScannedPage[] = [];
    selectedPageIndex = 0;

    enableOcr = false;

    stream: MediaStream | null = null;
    errorMsg = '';

    private rafId: number | null = null;
    private detectionInFlight = false;
    private stabilityHistory: CornerPx[][] = [];
    private stableFrames = 0;

    constructor(
        private dialogRef: MatDialogRef<DocumentScanDialogComponent>,
        private cdr: ChangeDetectorRef,
        private zone: NgZone,
        private scanner: DocumentScannerService,
        private cvLoader: OpencvLoaderService,
        private ocr: OcrService,
        @Inject(PLATFORM_ID) private platformId: Object,
        @Optional() @Inject(MAT_DIALOG_DATA) public config: ScanDialogConfig | null = null
    ) { }

    /** Flujo guiado de cédula: un único documento con frente y reverso. */
    get esCedula(): boolean {
        return this.config?.modo === 'cedula';
    }

    /** Tope de documentos; en cédula siempre 1 (las dos caras van juntas). */
    get maxDocs(): number {
        if (this.esCedula) return 1;
        const n = this.config?.maxDocs;
        return n != null && n > 0 ? n : Number.POSITIVE_INFINITY;
    }

    /** Páginas ya capturadas del documento de cédula. */
    get carasCapturadas(): number {
        return this.esCedula ? (this.scannedDocs[0]?.pages.length ?? 0) : 0;
    }

    /** Cara que toca capturar ahora ('' cuando ya están las dos). */
    get siguienteCara(): string {
        return CARAS_CEDULA[this.carasCapturadas] ?? '';
    }

    /** ¿Queda cupo para capturar más? */
    get puedeCapturar(): boolean {
        return this.esCedula
            ? this.carasCapturadas < CARAS_CEDULA.length
            : this.scannedDocs.length < this.maxDocs;
    }

    /**
     * La cédula solo se da por buena con las DOS caras: un documento con solo el
     * frente es exactamente el error que este flujo existe para evitar.
     */
    get puedeFinalizar(): boolean {
        if (this.scannedDocs.length === 0) return false;
        return this.esCedula ? this.carasCapturadas === CARAS_CEDULA.length : true;
    }

    /** Mensaje guía del modo cédula (banner del listado). */
    get guiaCedula(): string {
        switch (this.carasCapturadas) {
            case 0: return 'Captura primero el FRENTE de la cédula.';
            case 1: return 'Ahora captura el REVERSO; ambas caras quedan en un solo PDF.';
            default: return 'Frente y reverso listos en un solo documento.';
        }
    }

    get totalPages(): number {
        return this.scannedDocs.reduce((acc, doc) => acc + doc.pages.length, 0);
    }

    getFormattedDate(date: Date): string {
        return dayjs(date).format('HH:mm');
    }

    ngOnInit() {
        if (isPlatformBrowser(this.platformId)) {
            this.isNative = Capacitor.isNativePlatform();
        }
    }

    ngOnDestroy() {
        this.stopWebCamera();
        this.stopDetectionLoop();
    }

    async onCaptureClick() {
        if (!this.puedeCapturar) {
            Swal.fire('Sin cupo', this.esCedula
                ? 'La cédula ya tiene frente y reverso.'
                : `Este campo admite máximo ${this.maxDocs} documento(s).`, 'info');
            return;
        }
        if (this.isNative) {
            await this.scanNative();
        } else {
            await this.startWebCaptureSession();
        }
    }

    previewDoc(doc: ScannedDoc) {
        this.currentDocId = doc.id;
        this.currentDocName = doc.name;
        this.currentDocPages = doc.pages.map(p => ({ ...p }));
        this.selectedPageIndex = 0;
        this.mode = 'preview';
    }

    deleteDoc(doc: ScannedDoc) {
        Swal.fire({
            title: '¿Eliminar documento?',
            text: doc.name,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Sí, eliminar',
            cancelButtonText: 'Cancelar'
        }).then(res => {
            if (res.isConfirmed) {
                this.scannedDocs = this.scannedDocs.filter(d => d.id !== doc.id);
                this.cdr.markForCheck();
            }
        });
    }

    async scanNative() {
        try {
            const result = await DocumentScanner.scanDocument({
                responseType: ResponseType.Base64,
                letUserAdjustCrop: true,
                maxNumDocuments: this.esCedula ? CARAS_CEDULA.length - this.carasCapturadas : 24
            }) as any;

            const images: string[] = result.scannedImages || result.scannedFilePaths || [];

            if (images && images.length > 0) {
                const newPages: ScannedPage[] = images.map((img: string) => {
                    const url = img.startsWith('data:image') || img.startsWith('file://')
                        ? img
                        : `data:image/jpeg;base64,${img}`;
                    return { raw: url, processed: url, filter: 'original' as FilterMode };
                });
                this.addScannedDoc(newPages);
            }
        } catch (e: any) {
            console.error('Scan error natively:', e);
            if (e?.message) {
                const msg = e.message.toLowerCase();
                if (msg.includes('not implemented') || msg.includes('implementation missing')) {
                    Swal.fire({
                        icon: 'warning',
                        title: 'Modo Web',
                        text: 'Esta función requiere correr como App. Cambiando a cámara web automática.'
                    }).then(() => this.startWebCaptureSession());
                }
            }
        }
    }

    async startWebCaptureSession() {
        this.mode = 'capture-web';
        this.tempPages = [];
        this.errorMsg = '';
        this.detectedOverlay = null;
        this.detectionConfidence = 0;
        this.stableFrames = 0;
        this.stabilityHistory = [];
        this.blurWarning = false;
        this.autoCaptureCountdown = 0;

        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'environment',
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                }
            });

            this.cdr.detectChanges();

            if (this.videoElement) {
                const video = this.videoElement.nativeElement;
                video.srcObject = this.stream;
                await video.play().catch(() => { });
                await this.waitForVideoReady(video);
                this.overlayViewBox = `0 0 ${video.videoWidth || 1} ${video.videoHeight || 1}`;
            }

            this.warmupOpenCv();
            this.startDetectionLoop();
        } catch (err) {
            console.error(err);
            this.errorMsg = 'No se pudo acceder a la cámara. Revisa permisos.';
            this.mode = 'list';
            this.cdr.markForCheck();
        }
    }

    private waitForVideoReady(video: HTMLVideoElement): Promise<void> {
        return new Promise((resolve) => {
            if (video.readyState >= 2 && video.videoWidth > 0) return resolve();
            const onReady = () => {
                video.removeEventListener('loadeddata', onReady);
                resolve();
            };
            video.addEventListener('loadeddata', onReady);
        });
    }

    private async warmupOpenCv() {
        if (this.cvReady) return;
        this.isCvLoading = true;
        this.cdr.markForCheck();
        try {
            await this.scanner.ensureReady();
            this.cvReady = true;
        } catch (e) {
            console.warn('[scanner] OpenCV no disponible, modo manual', e);
            this.cvReady = false;
        } finally {
            this.isCvLoading = false;
            this.cdr.markForCheck();
        }
    }

    private startDetectionLoop() {
        if (!isPlatformBrowser(this.platformId)) return;
        this.zone.runOutsideAngular(() => {
            const tick = async () => {
                if (this.mode !== 'capture-web' || !this.videoElement) {
                    this.rafId = null;
                    return;
                }
                if (this.cvReady && !this.detectionInFlight) {
                    this.detectionInFlight = true;
                    this.runDetectionFrame()
                        .catch(err => console.warn('[detect] frame error', err))
                        .finally(() => { this.detectionInFlight = false; });
                }
                this.rafId = requestAnimationFrame(tick);
            };
            this.rafId = requestAnimationFrame(tick);
        });
    }

    private stopDetectionLoop() {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.detectionInFlight = false;
        this.stabilityHistory = [];
        this.stableFrames = 0;
    }

    private async runDetectionFrame() {
        const video = this.videoElement?.nativeElement;
        const canvas = this.detectCanvas?.nativeElement;
        if (!video || !canvas) return;
        if (!video.videoWidth || !video.videoHeight) return;

        const targetW = 480;
        const scale = targetW / video.videoWidth;
        canvas.width = targetW;
        canvas.height = Math.round(video.videoHeight * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const detected = await this.scanner.detectCornersFromCanvas(canvas);

        if (detected) {
            const corners: CornerPx[] = [
                { x: detected.topLeft.x / scale, y: detected.topLeft.y / scale },
                { x: detected.topRight.x / scale, y: detected.topRight.y / scale },
                { x: detected.bottomRight.x / scale, y: detected.bottomRight.y / scale },
                { x: detected.bottomLeft.x / scale, y: detected.bottomLeft.y / scale }
            ];
            this.zone.run(() => {
                this.detectedOverlay = corners;
                this.detectionConfidence = detected.confidence;
                this.overlayViewBox = `0 0 ${video.videoWidth} ${video.videoHeight}`;
                this.checkStability(corners);
                this.cdr.markForCheck();
            });
        } else {
            this.zone.run(() => {
                this.detectedOverlay = null;
                this.detectionConfidence = 0;
                this.stableFrames = 0;
                this.stabilityHistory = [];
                this.autoCaptureCountdown = 0;
                this.cdr.markForCheck();
            });
        }
    }

    private checkStability(corners: CornerPx[]) {
        this.stabilityHistory.push(corners);
        if (this.stabilityHistory.length > STABILITY_FRAMES) {
            this.stabilityHistory.shift();
        }
        if (this.stabilityHistory.length < STABILITY_FRAMES) {
            this.stableFrames = this.stabilityHistory.length;
            this.autoCaptureCountdown = 0;
            return;
        }

        const reference = this.stabilityHistory[0];
        let maxDelta = 0;
        for (let i = 1; i < this.stabilityHistory.length; i++) {
            for (let c = 0; c < 4; c++) {
                const a = reference[c];
                const b = this.stabilityHistory[i][c];
                const d = Math.hypot(a.x - b.x, a.y - b.y);
                if (d > maxDelta) maxDelta = d;
            }
        }

        const isStable = maxDelta < STABILITY_THRESHOLD_PX
            && this.detectionConfidence >= MIN_CONFIDENCE;

        if (isStable) {
            this.stableFrames = STABILITY_FRAMES;
            this.autoCaptureCountdown = 1;
            if (this.autoCapture && !this.isProcessingCrop) {
                this.triggerAutoCapture();
            }
        } else {
            this.stableFrames = Math.max(0, this.stableFrames - 1);
            this.autoCaptureCountdown = 0;
        }
    }

    private autoCaptureLock = false;
    private async triggerAutoCapture() {
        if (this.autoCaptureLock) return;
        this.autoCaptureLock = true;
        try {
            await this.captureWebPage(true);
        } finally {
            setTimeout(() => { this.autoCaptureLock = false; }, 1500);
        }
    }

    stopWebCamera() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
    }

    async captureWebPage(fromAuto = false) {
        if (!this.videoElement || !this.canvasElement) return;
        if (this.isProcessingCrop) return;

        const video = this.videoElement.nativeElement;
        const canvas = this.canvasElement.nativeElement;
        const ctx = canvas.getContext('2d');
        if (!ctx || !video.videoWidth) return;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        if (this.cvReady) {
            try {
                const blur = await this.scanner.measureBlur(canvas);
                if (blur < BLUR_THRESHOLD) {
                    this.blurWarning = true;
                    this.cdr.markForCheck();
                    if (fromAuto) {
                        setTimeout(() => { this.blurWarning = false; this.cdr.markForCheck(); }, 1800);
                        return;
                    }
                    const ok = await Swal.fire({
                        icon: 'warning',
                        title: 'Imagen con desenfoque',
                        text: 'Se detectó posible movimiento. ¿Usar de todos modos?',
                        showCancelButton: true,
                        confirmButtonText: 'Sí, usar',
                        cancelButtonText: 'Repetir'
                    });
                    if (!ok.isConfirmed) return;
                    this.blurWarning = false;
                }
            } catch { }
        }

        const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

        this.showFlash = true;
        setTimeout(() => { this.showFlash = false; this.cdr.markForCheck(); }, 120);

        if (this.cvReady && this.detectedOverlay && this.detectionConfidence >= MIN_CONFIDENCE) {
            await this.autoWarpAndAdd(dataUrl, this.detectedOverlay);
        } else {
            this.initCrop(dataUrl, 'new');
        }
    }

    private async autoWarpAndAdd(sourceUrl: string, corners: CornerPx[]) {
        this.isProcessingCrop = true;
        this.cdr.markForCheck();
        try {
            const warped = await this.scanner.warpAndCrop(sourceUrl, corners);
            this.tempPages.push({ raw: warped, processed: warped, filter: 'original' });
            this.stabilityHistory = [];
            this.stableFrames = 0;
            this.autoCaptureCountdown = 0;
        } catch (e) {
            console.error('autoWarp error', e);
            Swal.fire('Error', 'No se pudo procesar la imagen, ajusta manualmente.', 'error');
            this.initCrop(sourceUrl, 'new');
        } finally {
            this.isProcessingCrop = false;
            this.cdr.markForCheck();
        }
    }

    initCrop(imageUrl: string, mode: 'new' | 'edit' = 'new', pageIndex?: number) {
        this.cropSourceImage = imageUrl;
        this.cropEditMode = mode;
        this.editingPageIndex = pageIndex ?? null;

        const img = new Image();
        img.onload = () => {
            this.natW = img.naturalWidth;
            this.natH = img.naturalHeight;

            const useDetected = mode === 'new'
                && this.detectedOverlay
                && this.detectionConfidence >= 0.3;

            if (useDetected) {
                this.cropPoints = this.detectedOverlay!.map(p => ({ x: p.x, y: p.y }));
            } else {
                const mX = this.natW * 0.1;
                const mY = this.natH * 0.1;
                const rX = this.natW * 0.9;
                const rY = this.natH * 0.9;
                this.cropPoints = [
                    { x: mX, y: mY },
                    { x: rX, y: mY },
                    { x: rX, y: rY },
                    { x: mX, y: rY }
                ];
            }

            this.mode = 'crop';
            this.stopDetectionLoop();
            this.cdr.detectChanges();
        };
        img.src = imageUrl;
    }

    cancelCrop() {
        if (this.cropEditMode === 'new') {
            this.mode = 'capture-web';
            if (this.stream) this.startDetectionLoop();
        } else {
            this.mode = 'preview';
        }
        this.cropSourceImage = '';
        this.cropPoints = [];
    }

    async confirmCrop() {
        this.isProcessingCrop = true;
        this.cdr.detectChanges();

        try {
            let warpedImage: string;
            if (this.cvReady) {
                warpedImage = await this.scanner.warpAndCrop(this.cropSourceImage, this.cropPoints);
            } else {
                warpedImage = await this.fallbackWarp(this.cropSourceImage, this.cropPoints);
            }

            if (this.cropEditMode === 'new') {
                this.tempPages.push({ raw: warpedImage, processed: warpedImage, filter: 'original' });
                this.mode = 'capture-web';
                if (this.stream) this.startDetectionLoop();
            } else if (this.editingPageIndex !== null && this.currentDocPages[this.editingPageIndex]) {
                const old = this.currentDocPages[this.editingPageIndex];
                this.currentDocPages[this.editingPageIndex] = {
                    ...old,
                    raw: warpedImage,
                    processed: warpedImage,
                    filter: 'original',
                    ocr: undefined
                };
                this.mode = 'preview';
            }
        } catch (e) {
            console.error('Crop error', e);
            Swal.fire('Error', 'No se pudo procesar el recorte.', 'error');
        } finally {
            this.isProcessingCrop = false;
            this.cdr.markForCheck();
        }
    }

    private fallbackWarp(srcUrl: string, points: CornerPx[]): Promise<string> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const w = Math.round(Math.max(
                    Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y),
                    Math.hypot(points[2].x - points[3].x, points[2].y - points[3].y)
                ));
                const h = Math.round(Math.max(
                    Math.hypot(points[3].x - points[0].x, points[3].y - points[0].y),
                    Math.hypot(points[2].x - points[1].x, points[2].y - points[1].y)
                ));
                canvas.width = Math.min(w, 2400);
                canvas.height = Math.min(h, 2400);
                const ctx = canvas.getContext('2d')!;
                const minX = Math.min(...points.map(p => p.x));
                const minY = Math.min(...points.map(p => p.y));
                const maxX = Math.max(...points.map(p => p.x));
                const maxY = Math.max(...points.map(p => p.y));
                ctx.drawImage(img, minX, minY, maxX - minX, maxY - minY, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.9));
            };
            img.onerror = reject;
            img.src = srcUrl;
        });
    }

    private getFitRect(): DOMRect | null {
        if (!this.cropImage || !this.cropStage) return null;
        const img = this.cropImage.nativeElement;
        const stage = this.cropStage.nativeElement;
        const stageRect = stage.getBoundingClientRect();
        const nw = img.naturalWidth;
        const nh = img.naturalHeight;
        if (!nw || !nh) return null;
        const stageRatio = stageRect.width / stageRect.height;
        const imgRatio = nw / nh;
        let drawW, drawH, offX, offY;
        if (stageRatio > imgRatio) {
            drawH = stageRect.height; drawW = drawH * imgRatio;
            offX = (stageRect.width - drawW) / 2; offY = 0;
        } else {
            drawW = stageRect.width; drawH = drawW / imgRatio;
            offX = 0; offY = (stageRect.height - drawH) / 2;
        }
        return new DOMRect(stageRect.left + offX, stageRect.top + offY, drawW, drawH);
    }

    onCropPointerDown(event: PointerEvent, index: number) {
        event.preventDefault();
        event.stopPropagation();
        this.activePointIndex = index;
        this.isDragging = true;
        (event.target as HTMLElement).setPointerCapture(event.pointerId);
        this.updateMagnifier(event);
    }

    onCropPointerMove(event: PointerEvent) {
        if (this.activePointIndex === null) return;
        event.preventDefault();
        const fitRect = this.getFitRect();
        if (!fitRect) return;
        const relX = event.clientX - fitRect.left;
        const relY = event.clientY - fitRect.top;
        const scaleX = this.natW / fitRect.width;
        const scaleY = this.natH / fitRect.height;
        let nx = Math.max(0, Math.min(this.natW, relX * scaleX));
        let ny = Math.max(0, Math.min(this.natH, relY * scaleY));
        this.cropPoints[this.activePointIndex] = { x: nx, y: ny };
        this.updateMagnifier(event, fitRect);
    }

    onCropPointerUp(event: PointerEvent) {
        if (this.activePointIndex !== null) {
            (event.target as HTMLElement).releasePointerCapture(event.pointerId);
            this.activePointIndex = null;
            this.isDragging = false;
        }
    }

    updateMagnifier(event: PointerEvent, fitRect?: DOMRect) {
        if (this.activePointIndex === null) return;
        if (!this.magnifierCanvas) return;
        const container = this.cropStage?.nativeElement.getBoundingClientRect();
        if (!container) return;
        let magX = container.width - 130;
        let magY = 10;
        const pt = this.cropPoints[this.activePointIndex];
        const normX = pt.x / this.natW;
        const normY = pt.y / this.natH;
        if (normX > 0.5 && normY < 0.5) magX = 10;
        this.magnifierPos = { x: magX, y: magY };

        const canvas = this.magnifierCanvas.nativeElement;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const img = this.cropImage?.nativeElement;
        if (!img) return;
        const size = 120;
        canvas.width = size;
        canvas.height = size;
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, size, size);
        const zoom = 2.5;
        const srcChunk = size / zoom;
        const sx = pt.x - srcChunk / 2;
        const sy = pt.y - srcChunk / 2;
        try {
            ctx.drawImage(img, sx, sy, srcChunk, srcChunk, 0, 0, size, size);
        } catch { }
        ctx.strokeStyle = '#2d5af5';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(size / 2, 0); ctx.lineTo(size / 2, size);
        ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2);
        ctx.stroke();
        ctx.fillStyle = '#2d5af5';
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, 2, 0, Math.PI * 2);
        ctx.fill();
    }

    reCropPage() {
        if (this.currentDocPages.length > 0) {
            const page = this.currentDocPages[this.selectedPageIndex];
            this.initCrop(page.raw, 'edit', this.selectedPageIndex);
        }
    }

    async applyFilterToCurrent(filter: FilterMode) {
        if (this.selectedPageIndex < 0 || this.selectedPageIndex >= this.currentDocPages.length) return;
        const page = this.currentDocPages[this.selectedPageIndex];
        if (page.filter === filter) return;
        if (!this.cvReady) {
            await this.warmupOpenCv();
            if (!this.cvReady) {
                Swal.fire('No disponible', 'No se pudo cargar el motor de filtros.', 'warning');
                return;
            }
        }
        this.isProcessingCrop = true;
        this.cdr.markForCheck();
        try {
            const out = await this.scanner.applyFilter(page.raw, filter);
            this.currentDocPages[this.selectedPageIndex] = { ...page, processed: out, filter, ocr: undefined };
        } catch (e) {
            console.error('filter error', e);
            Swal.fire('Error', 'No se pudo aplicar el filtro.', 'error');
        } finally {
            this.isProcessingCrop = false;
            this.cdr.markForCheck();
        }
    }

    async applyFilterToAll(filter: FilterMode) {
        if (!this.cvReady) {
            await this.warmupOpenCv();
            if (!this.cvReady) return;
        }
        this.isProcessingCrop = true;
        this.cdr.markForCheck();
        try {
            for (let i = 0; i < this.currentDocPages.length; i++) {
                const p = this.currentDocPages[i];
                if (p.filter === filter) continue;
                const out = await this.scanner.applyFilter(p.raw, filter);
                this.currentDocPages[i] = { ...p, processed: out, filter, ocr: undefined };
                this.cdr.markForCheck();
            }
        } finally {
            this.isProcessingCrop = false;
            this.cdr.markForCheck();
        }
    }

    async finishWebCapture() {
        this.stopDetectionLoop();
        this.stopWebCamera();

        if (this.tempPages.length === 0) {
            this.mode = 'list';
            return;
        }

        // En modo cédula el nombre no se pregunta: es siempre el mismo documento.
        if (this.esCedula) {
            this.addScannedDoc(this.tempPages, this.config?.docName || 'Cédula');
            this.mode = 'list';
            return;
        }

        const { value: name } = await Swal.fire({
            title: 'Nombre del documento',
            input: 'text',
            inputLabel: 'Ej: Cédula, Diploma...',
            inputValue: `Documento ${this.scannedDocs.length + 1}`,
            showCancelButton: true,
            inputValidator: (value) => !value ? 'El nombre es obligatorio' : null
        });

        if (name) {
            this.addScannedDoc(this.tempPages, name);
        }
        this.mode = 'list';
    }

    cancelWebCapture() {
        this.stopDetectionLoop();
        this.stopWebCamera();
        this.tempPages = [];
        this.mode = 'list';
    }

    private addScannedDoc(pages: ScannedPage[], nameOverride?: string) {
        if (pages.length === 0) return;

        // Cédula: las capturas se ACUMULAN en el único documento (frente + reverso),
        // recortadas al número de caras; nunca se crea un segundo PDF.
        if (this.esCedula) {
            const doc = this.scannedDocs[0];
            if (doc) {
                doc.pages = [...doc.pages, ...pages].slice(0, CARAS_CEDULA.length);
                doc.thumb = doc.pages[0].processed;
            } else {
                this.scannedDocs.push({
                    id: Date.now().toString(36) + Math.random().toString(36).substring(2),
                    name: nameOverride || this.config?.docName || 'Cédula',
                    createdAt: new Date(),
                    pages: pages.slice(0, CARAS_CEDULA.length),
                    thumb: pages[0].processed
                });
            }
            this.cdr.markForCheck();
            return;
        }

        const id = Date.now().toString(36) + Math.random().toString(36).substring(2);
        const name = nameOverride || `Documento ${this.scannedDocs.length + 1}`;
        this.scannedDocs.push({
            id,
            name,
            createdAt: new Date(),
            pages,
            thumb: pages[0].processed
        });
        this.cdr.markForCheck();
    }

    dropPage(event: CdkDragDrop<ScannedPage[]>) {
        moveItemInArray(this.currentDocPages, event.previousIndex, event.currentIndex);
    }

    removePageFromCurrent(index: number) {
        this.currentDocPages.splice(index, 1);
        if (index === this.selectedPageIndex) {
            this.selectedPageIndex = Math.max(0, index - 1);
        } else if (index < this.selectedPageIndex) {
            this.selectedPageIndex--;
        }
    }

    saveCurrentDocChanges() {
        if (this.currentDocId) {
            const docIndex = this.scannedDocs.findIndex(d => d.id === this.currentDocId);
            if (docIndex > -1) {
                if (this.currentDocPages.length === 0) {
                    this.scannedDocs.splice(docIndex, 1);
                } else {
                    this.scannedDocs[docIndex].pages = this.currentDocPages.map(p => ({ ...p }));
                    this.scannedDocs[docIndex].name = this.currentDocName;
                    this.scannedDocs[docIndex].thumb = this.currentDocPages[0].processed;
                }
            }
        }
        this.backToList();
    }

    backToList() {
        this.currentDocId = null;
        this.currentDocPages = [];
        this.selectedPageIndex = 0;
        this.mode = 'list';
    }

    close() {
        this.dialogRef.close();
    }

    async exportAllAndClose() {
        if (this.scannedDocs.length === 0) return;

        Swal.fire({
            title: 'Procesando PDF...',
            html: this.enableOcr
                ? 'Reconociendo texto y generando archivos. Esto puede tomar 1-3 s por página.'
                : 'Generando archivos, por favor espere.',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        try {
            const files: File[] = [];
            const oversize: string[] = [];

            for (const doc of this.scannedDocs) {
                if (this.enableOcr) {
                    for (const page of doc.pages) {
                        if (!page.ocr) {
                            try {
                                page.ocr = await this.ocr.recognize(page.processed);
                            } catch (e) {
                                console.warn('[ocr] failed for page, continuing', e);
                            }
                        }
                    }
                }

                const file = await this.buildPdfFile(doc);
                if (file.size > MAX_PDF_BYTES) {
                    oversize.push(`${doc.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
                }
                files.push(file);
            }

            if (this.enableOcr) {
                this.ocr.terminate().catch(() => { });
            }

            Swal.close();

            if (oversize.length > 0) {
                const proceed = await Swal.fire({
                    icon: 'warning',
                    title: 'Documentos muy pesados',
                    html: `Estos PDFs superan los 10 MB y pueden ser rechazados al subir:<br><br>
                           <ul style="text-align:left;font-size:13px;">
                           ${oversize.map(o => `<li>${o}</li>`).join('')}
                           </ul>
                           ¿Subir de todos modos?`,
                    showCancelButton: true,
                    confirmButtonText: 'Sí, subir',
                    cancelButtonText: 'Volver y aplicar B/N'
                });
                if (!proceed.isConfirmed) return;
            }

            this.dialogRef.close(files);
        } catch (e) {
            console.error(e);
            Swal.fire('Error', 'Hubo un error generando los PDFs', 'error');
        }
    }

    private async buildPdfFile(doc: ScannedDoc): Promise<File> {
        const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();

        for (let i = 0; i < doc.pages.length; i++) {
            if (i > 0) pdf.addPage();
            const page = doc.pages[i];
            const imgData = page.processed;
            const props = pdf.getImageProperties(imgData);
            const imgRatio = props.width / props.height;
            const pageRatio = pageWidth / pageHeight;

            let renderW: number, renderH: number;
            if (imgRatio > pageRatio) {
                renderW = pageWidth;
                renderH = pageWidth / imgRatio;
            } else {
                renderH = pageHeight;
                renderW = pageHeight * imgRatio;
            }
            const x = (pageWidth - renderW) / 2;
            const y = (pageHeight - renderH) / 2;

            pdf.addImage(imgData, 'JPEG', x, y, renderW, renderH, undefined, 'FAST');

            if (page.ocr && page.ocr.words.length > 0) {
                this.drawOcrLayer(pdf, page.ocr, x, y, renderW, renderH, props.width, props.height);
            }
        }

        const blob = pdf.output('blob');
        const safeName = doc.name.replace(/[^a-z0-9]/gi, '_');
        const filename = safeName.endsWith('.pdf') ? safeName : `${safeName}.pdf`;
        return new File([blob], filename, { type: 'application/pdf' });
    }

    private drawOcrLayer(
        pdf: jsPDF,
        ocr: OcrPageResult,
        offsetX: number, offsetY: number,
        renderW: number, renderH: number,
        imgPxW: number, imgPxH: number
    ) {
        const sx = renderW / imgPxW;
        const sy = renderH / imgPxH;

        pdf.setFont('Helvetica');
        pdf.setTextColor(0, 0, 0);

        for (const word of ocr.words) {
            const { x0, y0, x1, y1 } = word.bbox;
            const wMm = (x1 - x0) * sx;
            const hMm = (y1 - y0) * sy;
            if (wMm <= 0 || hMm <= 0) continue;

            const xMm = offsetX + x0 * sx;
            const yMm = offsetY + y1 * sy;

            const fontSizePt = (hMm / 0.352778) * 0.95;
            if (fontSizePt < 1) continue;

            pdf.setFontSize(fontSizePt);
            try {
                (pdf as any).text(word.text, xMm, yMm, { renderingMode: 'invisible' });
            } catch {
                pdf.text(word.text, xMm, yMm);
            }
        }
    }
}
