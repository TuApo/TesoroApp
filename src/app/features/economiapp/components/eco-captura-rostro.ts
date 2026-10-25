import {
  ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, computed, inject, input, output, signal, viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { DeteccionRostroService } from '../../dashboard/submodule/hiring/service/rostro/deteccion-rostro.service';

/** Lo que se entrega al capturar: la foto y la prueba de vida que la acompañó. */
export interface CapturaRostro {
  blob: Blob;
  vivacidad: string;
}

type Paso = 'iniciando' | 'parpadee' | 'gire' | 'quieto' | 'lista' | 'sin-camara';

/**
 * Cámara con prueba de vida para verificar identidad.
 *
 * <p>Antes de capturar pide dos gestos que una foto impresa o una pantalla no hacen:
 * parpadear y girar un poco la cabeza. La detección corre en el navegador (MediaPipe, el
 * mismo de la foto de contratación); el resultado viaja con la foto como evidencia, y la
 * comparación que decide se hace en el servidor.
 *
 * <p>Si el modelo no carga (navegador viejo) se puede capturar igual y así queda escrito
 * (`disponible: false`): el servidor no confía en el navegador para aprobar, solo registra.
 */
@Component({
  selector: 'eco-captura-rostro',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <div class="marco" [class.espejo]="frontal()">
      <video #video autoplay playsinline muted></video>
      <svg class="ovalo" viewBox="0 0 100 133" preserveAspectRatio="none" aria-hidden="true">
        <defs><mask id="m"><rect width="100" height="133" fill="white"/><ellipse cx="50" cy="60" rx="31" ry="42" fill="black"/></mask></defs>
        <rect width="100" height="133" fill="rgba(0,0,0,.45)" mask="url(#m)"/>
        <ellipse cx="50" cy="60" rx="31" ry="42" fill="none" [attr.stroke]="paso() === 'lista' ? '#22C55E' : '#fff'" stroke-width="1.2"/>
      </svg>
      <div class="instruccion" [class.ok]="paso() === 'lista'">
        <mat-icon>{{ icono() }}</mat-icon> {{ texto() }}
      </div>
    </div>
    @if (paso() === 'sin-camara') {
      <p class="error">No pudimos usar la cámara. Revise el permiso del navegador{{ permitirArchivo() ? ' o suba una foto' : '' }}.</p>
    }
    <div class="acciones">
      @if (permitirArchivo()) {
        <label class="eco-btn secundario">
          <input type="file" accept="image/*" [attr.capture]="frontal() ? 'user' : 'environment'" (change)="desdeArchivo($event)" hidden />
          <mat-icon>upload</mat-icon> Subir foto
        </label>
      }
      <button type="button" class="eco-btn" (click)="capturar()" [disabled]="paso() !== 'lista' && !sinModelo()">
        <mat-icon>photo_camera</mat-icon> Tomar foto
      </button>
    </div>
  `,
  styles: [`
    :host { display:flex; flex-direction:column; gap:10px; }
    .marco { position:relative; width:100%; max-width:360px; margin:0 auto; aspect-ratio: 3/4; border-radius:20px; overflow:hidden; background:#000; }
    video { width:100%; height:100%; object-fit:cover; display:block; }
    .espejo video { transform: scaleX(-1); }
    .ovalo { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }
    .instruccion { position:absolute; left:10px; right:10px; bottom:12px; display:flex; align-items:center; justify-content:center; gap:6px;
      padding:8px 12px; border-radius:999px; background:rgba(15,27,45,.8); color:#fff; font-weight:700; font-size:14px; text-align:center; }
    .instruccion.ok { background: rgba(22,101,52,.9); }
    .acciones { display:flex; gap:8px; justify-content:center; flex-wrap:wrap; }
    .error { color: var(--danger-fg); font-size:13px; text-align:center; margin:0; }
  `],
  styleUrls: ['../economiapp.css'],
})
export class EcoCapturaRostro implements OnInit, OnDestroy {
  private rostro = inject(DeteccionRostroService);

  /** Cámara frontal (el titular en su celular) o trasera (el operador en el mostrador). */
  readonly frontal = input(true);
  /** Si se exige la prueba de vida antes de dejar capturar. */
  readonly conVivacidad = input(true);
  readonly permitirArchivo = input(false);
  readonly capturado = output<CapturaRostro>();

  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  readonly paso = signal<Paso>('iniciando');
  readonly sinModelo = signal(false);
  private stream: MediaStream | null = null;
  private raf = 0;
  private parpadeo = false;
  private giro = false;
  private ojosCerrados = false;
  private inicio = 0;

  readonly texto = computed(() => ({
    iniciando: 'Encendiendo la cámara…',
    parpadee: 'Mire a la cámara y parpadee',
    gire: 'Ahora gire un poco la cabeza a un lado',
    quieto: 'Vuelva al centro y quédese quieto',
    lista: 'Listo: tome la foto',
    'sin-camara': 'Cámara no disponible',
  }[this.paso()]));
  readonly icono = computed(() => ({
    iniciando: 'hourglass_top', parpadee: 'visibility', gire: 'switch_left', quieto: 'center_focus_strong',
    lista: 'check_circle', 'sin-camara': 'videocam_off',
  }[this.paso()]));

  async ngOnInit(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: this.frontal() ? 'user' : 'environment', width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      const v = this.video().nativeElement;
      v.srcObject = this.stream;
      await v.play();
    } catch {
      this.paso.set('sin-camara');
      return;
    }
    this.inicio = performance.now();
    if (!this.conVivacidad()) { this.paso.set('lista'); return; }
    const ok = await this.rostro.iniciar().catch(() => false);
    if (!ok) { this.sinModelo.set(true); this.paso.set('lista'); return; }
    this.paso.set('parpadee');
    this.bucle();
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach(t => t.stop());
  }

  private bucle = (): void => {
    const v = this.video().nativeElement;
    const l = this.rostro.leer(v, performance.now());
    if (l?.hayCara) {
      const cerrados = l.ojoIzq > 0.55 && l.ojoDer > 0.55;
      if (this.paso() === 'parpadee') {
        if (cerrados) this.ojosCerrados = true;
        else if (this.ojosCerrados) { this.parpadeo = true; this.paso.set('gire'); }
      } else if (this.paso() === 'gire') {
        if (Math.abs(l.giro) > 0.28) { this.giro = true; this.paso.set('quieto'); }
      } else if (this.paso() === 'quieto' || this.paso() === 'lista') {
        const centrada = Math.abs(l.giro) < 0.15 && Math.abs(l.centroX - 0.5) < 0.18 && l.alto > 0.28 && !cerrados;
        this.paso.set(centrada ? 'lista' : 'quieto');
      }
    } else if (this.paso() === 'lista') {
      this.paso.set('quieto');
    }
    this.raf = requestAnimationFrame(this.bucle);
  };

  capturar(): void {
    const v = this.video().nativeElement;
    if (!v.videoWidth) return;
    const escala = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * escala);
    c.height = Math.round(v.videoHeight * escala);
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
    c.toBlob(b => { if (b) this.capturado.emit({ blob: b, vivacidad: this.resumen('camara') }); }, 'image/jpeg', 0.9);
  }

  /** Solo si se permite (operador sin cámara): sin prueba de vida, y así queda dicho. */
  async desdeArchivo(ev: Event): Promise<void> {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return;
    this.capturado.emit({ blob: await reducir(f), vivacidad: this.resumen('archivo') });
  }

  private resumen(fuente: string): string {
    return JSON.stringify({
      fuente, modelo: !this.sinModelo(), parpadeo: this.parpadeo, giro: this.giro,
      segundos: Math.round((performance.now() - this.inicio) / 100) / 10,
    });
  }
}

/** Reduce una foto a 1280 px de lado mayor en JPEG: llega rápido y el verificador no necesita más. */
export async function reducir(archivo: Blob, lado = 1280): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(archivo, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    const escala = Math.min(1, lado / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * escala);
    c.height = Math.round(bmp.height * escala);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise<Blob>((ok, mal) => c.toBlob(b => b ? ok(b) : mal(new Error('sin imagen')), 'image/jpeg', 0.88));
  } catch {
    return archivo;
  }
}
