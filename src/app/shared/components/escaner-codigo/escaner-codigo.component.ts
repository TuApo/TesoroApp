import {
  ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, input, output, signal, viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

/**
 * Todos los formatos que lee el navegador (BarcodeDetector) y sus equivalentes en ZXing.
 * Lineales de góndola (EAN/UPC), logísticos (Code 128/39/93, ITF, Codabar, GS1 DataBar) y
 * bidimensionales (QR, Data Matrix, PDF417 —el de la cédula—, Aztec).
 */
const FORMATOS_NATIVOS = [
  'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'codabar', 'itf',
  'qr_code', 'data_matrix', 'pdf417', 'aztec',
];
const FORMATOS_ZXING = [
  'EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'CODE_39', 'CODE_93', 'CODABAR', 'ITF',
  'RSS_14', 'RSS_EXPANDED', 'QR_CODE', 'DATA_MATRIX', 'PDF_417', 'AZTEC',
];

/** Lo que devuelve quien procesa la lectura, para mostrarlo dentro del lector. */
export interface ResultadoEscaneo {
  ok: boolean;
  texto: string;
  detalle?: string | null;
}

interface Lectura extends ResultadoEscaneo { codigo: string; hora: number; procesando?: boolean; veces: number; }

declare global {
  interface Window { ZXing?: any; BarcodeDetector?: any; }
}

let zxingCargando: Promise<any> | null = null;
/** ZXing se sirve desde la propia app (public/vendor) y solo se baja cuando hace falta. */
function cargarZxing(): Promise<any> {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (!zxingCargando) {
    zxingCargando = new Promise((ok, mal) => {
      const s = document.createElement('script');
      s.src = 'vendor/zxing/zxing-library-0.21.3.min.js';
      s.onload = () => ok(window.ZXing);
      s.onerror = () => { zxingCargando = null; mal(new Error('No se pudo cargar el lector')); };
      document.head.appendChild(s);
    });
  }
  return zxingCargando;
}

let formatosNativos: Promise<string[]> | null = null;
/** Formatos que el lector del navegador dice soportar (vacío si no hay lector o no sirve). */
function nativosDisponibles(): Promise<string[]> {
  if (!formatosNativos) {
    formatosNativos = (async () => {
      if (!window.BarcodeDetector) return [];
      try {
        const sop: string[] = (await window.BarcodeDetector.getSupportedFormats?.()) ?? FORMATOS_NATIVOS;
        return FORMATOS_NATIVOS.filter(f => sop.includes(f));
      } catch { return []; }
    })();
  }
  return formatosNativos;
}

const CLAVE_CAMARA = 'escaner.camara';

/**
 * Lector de códigos con la cámara para TODAS las pantallas que escanean (caja, catálogo,
 * inventario, arqueos, traslados, rutas, redención, EconomiAPP…).
 *
 * <p>Lee todos los formatos: barras de producto, logísticos, QR, Data Matrix y PDF417. Usa
 * el lector nativo del navegador (Android, Chrome de Mac, Safari reciente) y, donde no hay
 * o no encuentra nada en unos segundos, ZXing sobre cuadros del video: franja central,
 * cuadro completo, acercamiento digital y girado (códigos verticales).
 *
 * <p>En el celular se abre a pantalla completa con controles al alcance del pulgar: linterna,
 * zoom (de la cámara si lo tiene, si no digital), tocar para enfocar, cambiar de cámara y
 * <b>Tomar foto</b>: abre la cámara del teléfono (con autoenfoque y resolución completa) y
 * lee la foto — el camino que funciona cuando el video no enfoca de cerca, típico de las
 * cámaras de portátil.
 *
 * <p>Dos modos: `unico` (lee, avisa y cierra) y `continuo` (sigue leyendo y lleva la lista;
 * para cargar varios pedidos a la ruta, contar un arqueo o armar un carrito escaneando).
 * Con `procesar` la pantalla dueña resuelve el código y el lector muestra el resultado
 * (producto encontrado, no existe…) sin salir de la cámara.
 *
 * <p>Se abre como `<dialog>` modal: queda en la capa superior aunque el botón esté dentro
 * de un panel con transform/overflow. Con la caja abierta, un lector USB también funciona:
 * escribe en el campo manual y Enter.
 */
@Component({
  selector: 'app-escaner-codigo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, FormsModule],
  template: `
    @if (!sinBoton()) {
      <button type="button" class="ec-boton" [class.ec-boton--texto]="!!etiqueta()" (click)="abrir()"
              [attr.aria-label]="etiqueta() || 'Leer código con la cámara'" [title]="etiqueta() || 'Leer código con la cámara'">
        <mat-icon>{{ modo() === 'continuo' ? 'qr_code_scanner' : 'barcode_reader' }}</mat-icon>
        @if (etiqueta()) { <span>{{ etiqueta() }}</span> }
      </button>
    }
    <dialog #dialogo class="ec-dialogo" [attr.aria-label]="titulo()" (cancel)="$event.preventDefault(); cerrar()" (click)="clicFuera($event)">
      @if (abierto()) {
        <div class="ec-caja">
          <header class="ec-cab">
            <mat-icon>{{ modo() === 'continuo' ? 'qr_code_scanner' : 'barcode_reader' }}</mat-icon>
            <span class="ec-tit">{{ titulo() }}@if (modo() === 'continuo' && lecturas().length) { <small>{{ lecturas().length }} leído{{ lecturas().length === 1 ? '' : 's' }}</small> }</span>
            <button type="button" class="ec-x" (click)="cerrar()" aria-label="Cerrar"><mat-icon>close</mat-icon></button>
          </header>

          <div class="ec-visor" [class.ec-visor--flash]="flash()" (click)="tocarVisor($event)">
            <video #video playsinline muted autoplay [style.transform]="zoomDigital() > 1 ? 'scale(' + zoomDigital() + ')' : null"></video>
            @if (!error() && !iniciando()) {
              <div class="ec-mira" [class.ec-mira--ok]="leyendo()" [class.ec-mira--qr]="formatoMira() === 'qr'"><span class="ec-laser"></span></div>
            }
            @if (enfoque(); as e) { <span class="ec-foco" [style.left.%]="e.x * 100" [style.top.%]="e.y * 100"></span> }
            @if (iniciando()) { <div class="ec-estado"><mat-icon class="ec-gira">progress_activity</mat-icon> Abriendo cámara…</div> }
            @if (error()) {
              <div class="ec-estado ec-estado--mal"><mat-icon>no_photography</mat-icon> {{ error() }}
                <button type="button" class="ec-foto-grande" (click)="$event.stopPropagation(); tomarFoto()"><mat-icon>photo_camera</mat-icon> Tomar foto del código</button>
              </div>
            }
            @if (ultimo(); as u) {
              <div class="ec-resultado" [class.ec-resultado--mal]="!u.ok && !u.procesando" role="status" aria-live="polite">
                <mat-icon>{{ u.procesando ? 'hourglass_top' : u.ok ? 'check_circle' : 'error' }}</mat-icon>
                <span><b>{{ u.procesando ? 'Buscando ' + u.codigo + '…' : u.texto }}</b>@if (u.detalle && !u.procesando) { <small>{{ u.detalle }}</small> }</span>
              </div>
            }
            @if (!error() && !iniciando() && zoomMax() > 1) {
              <label class="ec-zoom" (click)="$event.stopPropagation()">
                <mat-icon>zoom_out</mat-icon>
                <input type="range" [min]="zoomMin()" [max]="zoomMax()" [step]="zoomPaso()" [value]="zoom()" (input)="ponerZoom(+$any($event.target).value)" aria-label="Zoom" />
                <mat-icon>zoom_in</mat-icon>
              </label>
            }
          </div>

          <p class="ec-ayuda">{{ ayuda() }}</p>

          <div class="ec-acciones">
            @if (tieneLinterna()) {
              <button type="button" class="ec-ico" [class.ec-ico--on]="linterna()" (click)="alternarLinterna()" [attr.aria-pressed]="linterna()" aria-label="Linterna">
                <mat-icon>{{ linterna() ? 'flashlight_off' : 'flashlight_on' }}</mat-icon><small>Luz</small></button>
            }
            <button type="button" class="ec-ico ec-ico--foto" (click)="tomarFoto()" aria-label="Tomar foto del código">
              <mat-icon>photo_camera</mat-icon><small>Foto</small></button>
            @if (camaras().length > 1) {
              <button type="button" class="ec-ico" (click)="otraCamara()" aria-label="Cambiar de cámara"><mat-icon>cameraswitch</mat-icon><small>Cámara</small></button>
            }
            <button type="button" class="ec-ico" [class.ec-ico--on]="sonido()" (click)="sonido.set(!sonido())" [attr.aria-pressed]="sonido()" aria-label="Sonido al leer">
              <mat-icon>{{ sonido() ? 'volume_up' : 'volume_off' }}</mat-icon><small>Sonido</small></button>
          </div>
          <input #archivo type="file" accept="image/*" capture="environment" hidden (change)="leerFoto($event)" />

          <form class="ec-manual" (submit)="$event.preventDefault(); manualOk()">
            <input #manualInput type="text" autocomplete="off" enterkeyhint="go" placeholder="O escriba el código (o use el lector USB)" [(ngModel)]="manual" name="manual" />
            <button type="submit" class="ec-ok" [disabled]="!manual.trim()">Usar</button>
          </form>

          @if (modo() === 'continuo' && lecturas().length) {
            <ul class="ec-lista" aria-label="Códigos leídos">
              @for (l of lecturas(); track l.codigo + l.hora) {
                <li [class.mal]="!l.ok && !l.procesando">
                  <mat-icon>{{ l.procesando ? 'hourglass_top' : l.ok ? 'check' : 'close' }}</mat-icon>
                  <span><b>{{ l.procesando ? l.codigo : l.texto }}</b><small>{{ l.codigo }}@if (l.veces > 1) { · ×{{ l.veces }} }@if (l.detalle && !l.procesando) { · {{ l.detalle }} }</small></span>
                </li>
              }
            </ul>
          }

          <button type="button" class="ec-cerrar" (click)="cerrar()"><mat-icon>{{ modo() === 'continuo' && lecturas().length ? 'done_all' : 'close' }}</mat-icon>
            {{ modo() === 'continuo' && lecturas().length ? 'Listo' : 'Cerrar' }}</button>
        </div>
      }
    </dialog>
  `,
  styles: [`
    :host { display: inline-flex; }
    .ec-boton {
      height: 48px; min-width: 48px; min-height: 48px !important; border-radius: 12px; border: 1px solid var(--border, rgba(127,127,127,.3));
      background: var(--surface, #fff); color: var(--text, inherit); display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      cursor: pointer; padding: 0; font: inherit; font-weight: 700; margin: 0 !important;
    }
    .ec-boton--texto { padding: 0 14px; }
    .ec-dialogo {
      border: 0; padding: 0; margin: auto; background: transparent; color: #fff;
      width: min(540px, calc(100vw - 24px)); max-width: 100%; max-height: calc(100dvh - 24px); overflow: visible;
    }
    .ec-dialogo::backdrop { background: rgba(2,6,23,.86); backdrop-filter: blur(2px); }
    .ec-caja { display: flex; flex-direction: column; align-items: stretch; gap: 10px; padding: 12px; border-radius: 20px; background: #0f172a; box-shadow: 0 20px 60px rgba(0,0,0,.5); max-height: calc(100dvh - 24px); overflow: auto; }
    .ec-cab { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 16px; }
    .ec-tit { flex: 1; display: flex; align-items: baseline; gap: 8px; min-width: 0; }
    .ec-tit small { font-size: 12px; font-weight: 800; padding: 2px 8px; border-radius: 999px; background: #22c55e; color: #052e16; }
    .ec-x { width: 40px; height: 40px; min-height: 40px !important; border-radius: 999px; border: 0; background: rgba(255,255,255,.12); color: #fff; display: grid; place-items: center; cursor: pointer; padding: 0; margin: 0 !important; }
    .ec-visor { position: relative; width: 100%; aspect-ratio: 4 / 3; max-height: 56dvh; border-radius: 14px; overflow: hidden; background: #000; touch-action: manipulation; }
    .ec-visor--flash::after { content: ''; position: absolute; inset: 0; background: rgba(34,197,94,.35); animation: ec-flash .35s ease-out forwards; pointer-events: none; }
    @keyframes ec-flash { to { opacity: 0; } }
    video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transform-origin: center; transition: transform .15s; }
    .ec-mira { position: absolute; left: 8%; right: 8%; top: 28%; bottom: 28%; border: 3px solid rgba(255,255,255,.9); border-radius: 12px; box-shadow: 0 0 0 9999px rgba(0,0,0,.32); pointer-events: none; overflow: hidden; transition: all .2s; }
    .ec-mira--qr { left: 22%; right: 22%; top: 14%; bottom: 14%; }
    .ec-mira--ok { border-color: #22c55e; }
    .ec-laser { position: absolute; left: 4%; right: 4%; height: 2px; background: #ef4444; box-shadow: 0 0 8px #ef4444; top: 50%; animation: ec-barrer 1.6s ease-in-out infinite alternate; }
    @keyframes ec-barrer { from { top: 12%; } to { top: 88%; } }
    .ec-foco { position: absolute; width: 64px; height: 64px; margin: -32px 0 0 -32px; border: 2px solid #facc15; border-radius: 10px; pointer-events: none; animation: ec-foco .6s ease-out forwards; }
    @keyframes ec-foco { from { transform: scale(1.4); opacity: 1; } to { transform: scale(1); opacity: 0; } }
    .ec-estado { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; text-align: center; padding: 16px; font-weight: 600; background: rgba(0,0,0,.6); }
    .ec-estado--mal { color: #fecaca; }
    .ec-foto-grande { display: inline-flex; align-items: center; gap: 8px; height: 48px; padding: 0 18px; border-radius: 999px; border: 0; background: #fff; color: #0f172a; font: inherit; font-weight: 800; cursor: pointer; margin: 0 !important; }
    .ec-gira { animation: ec-girar 1s linear infinite; }
    @keyframes ec-girar { to { transform: rotate(360deg); } }
    .ec-resultado { position: absolute; left: 10px; right: 10px; bottom: 10px; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px; background: rgba(5,46,22,.92); border: 1px solid #22c55e; }
    .ec-resultado--mal { background: rgba(69,10,10,.92); border-color: #ef4444; }
    .ec-resultado mat-icon { flex: none; color: #4ade80; }
    .ec-resultado--mal mat-icon { color: #f87171; }
    .ec-resultado span { display: flex; flex-direction: column; min-width: 0; }
    .ec-resultado b { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ec-resultado small { font-size: 12px; color: #cbd5e1; }
    .ec-zoom { position: absolute; left: 50%; transform: translateX(-50%); top: 10px; display: flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; background: rgba(0,0,0,.55); width: min(80%, 320px); }
    .ec-zoom input { flex: 1; min-width: 0; accent-color: #22c55e; }
    .ec-zoom mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .ec-ayuda { margin: 0; text-align: center; font-size: 13px; color: #cbd5e1; }
    .ec-acciones { display: flex; justify-content: center; gap: 10px; flex-wrap: wrap; }
    .ec-ico { width: 64px; height: 60px; min-height: 60px !important; border-radius: 16px; border: 0; background: rgba(255,255,255,.12); color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; cursor: pointer; padding: 0; margin: 0 !important; font: inherit; }
    .ec-ico small { font-size: 11px; font-weight: 700; opacity: .9; }
    .ec-ico--on { background: #facc15; color: #111; }
    .ec-ico--foto { background: #2563eb; }
    .ec-manual { display: flex; gap: 8px; }
    .ec-manual input { flex: 1; min-width: 0; height: 48px; padding: 0 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,.25); background: rgba(255,255,255,.08); color: #fff; font-size: 16px; }
    .ec-manual input::placeholder { color: #94a3b8; }
    .ec-ok { min-width: 84px; height: 48px; border-radius: 12px; border: 0; background: #22c55e; color: #052e16; font-weight: 800; cursor: pointer; margin: 0 !important; }
    .ec-ok:disabled { opacity: .45; cursor: default; }
    .ec-lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 22dvh; overflow: auto; }
    .ec-lista li { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 10px; background: rgba(255,255,255,.07); }
    .ec-lista li mat-icon { flex: none; color: #4ade80; font-size: 20px; width: 20px; height: 20px; }
    .ec-lista li.mal mat-icon { color: #f87171; }
    .ec-lista li span { display: flex; flex-direction: column; min-width: 0; }
    .ec-lista li b { font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ec-lista li small { font-size: 11.5px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ec-cerrar { align-self: center; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-width: 60%; height: 52px; min-height: 52px !important; border-radius: 999px; border: 0; background: #fff; color: #0f172a; font-weight: 800; font-size: 16px; cursor: pointer; margin: 0 !important; }

    /* Celular: pantalla completa, video grande y botones abajo, al alcance del pulgar. */
    @media (max-width: 600px), (pointer: coarse) and (max-height: 900px) and (max-width: 900px) {
      .ec-dialogo { width: 100vw; height: 100dvh; max-width: 100vw; max-height: 100dvh; margin: 0; }
      .ec-caja { height: 100dvh; max-height: 100dvh; border-radius: 0; padding: max(10px, env(safe-area-inset-top)) 12px max(12px, env(safe-area-inset-bottom)); }
      .ec-visor { flex: 1 1 auto; aspect-ratio: auto; min-height: 42dvh; max-height: none; }
      .ec-lista { max-height: 18dvh; }
      .ec-cerrar { width: 100%; }
    }
  `],
})
export class EscanerCodigoComponent implements OnDestroy {
  readonly titulo = input('Leer código de barras');
  /** Texto del botón (vacío = solo el icono). */
  readonly etiqueta = input('');
  /** `unico`: lee y cierra. `continuo`: sigue leyendo y lleva la lista de lo leído. */
  readonly modo = input<'unico' | 'continuo'>('unico');
  /** Oculta el botón: la pantalla abre el lector con `abrir()`. */
  readonly sinBoton = input(false);
  /** Forma de la mira: barras (ancha) o QR (cuadrada). Solo es una guía visual. */
  readonly formatoMira = input<'barras' | 'qr'>('barras');
  /**
   * Resuelve el código dentro del lector (buscar el producto, cargar el pedido…) y dice qué
   * pasó. En modo único el lector cierra solo si el resultado es `ok`.
   */
  readonly procesar = input<((codigo: string) => Promise<ResultadoEscaneo | null | void>) | null>(null);

  readonly leido = output<string>();
  readonly cerrado = output<void>();

  readonly abierto = signal(false);
  readonly iniciando = signal(false);
  readonly leyendo = signal(false);
  readonly error = signal<string | null>(null);
  readonly tieneLinterna = signal(false);
  readonly linterna = signal(false);
  readonly camaras = signal<MediaDeviceInfo[]>([]);
  readonly lecturas = signal<Lectura[]>([]);
  readonly ultimo = signal<Lectura | null>(null);
  readonly flash = signal(false);
  readonly sonido = signal(true);
  readonly enfoque = signal<{ x: number; y: number } | null>(null);
  readonly buscandoFoto = signal(false);
  /** Zoom de la cámara (hardware) o digital; zoomMax 1 = sin control. */
  readonly zoom = signal(1);
  readonly zoomMin = signal(1);
  readonly zoomMax = signal(1);
  readonly zoomPaso = signal(0.1);
  private readonly zoomHardware = signal(false);
  readonly zoomDigital = computed(() => this.zoomHardware() ? 1 : this.zoom());
  readonly ayuda = computed(() => {
    if (this.buscandoFoto()) return 'Buscando el código en la foto…';
    if (this.error()) return 'Puede tomar una foto del código o escribirlo abajo.';
    if (this.modo() === 'continuo') return 'Pase los códigos uno por uno; se van sumando a la lista.';
    return 'Centre el código en el recuadro. Si no enfoca de cerca, aleje un poco, use el zoom o «Foto».';
  });
  manual = '';

  private readonly dialogo = viewChild<ElementRef<HTMLDialogElement>>('dialogo');
  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');
  private readonly archivo = viewChild<ElementRef<HTMLInputElement>>('archivo');
  private readonly manualInput = viewChild<ElementRef<HTMLInputElement>>('manualInput');
  private flujo: MediaStream | null = null;
  private activo = false;
  private sesion = 0;
  private camaraIdx = -1;
  private relojes: ReturnType<typeof setTimeout>[] = [];
  private ultimaLectura = { codigo: '', hora: 0 };
  private audio: AudioContext | null = null;
  private lienzo: HTMLCanvasElement | null = null;
  /** En modo único, mientras la pantalla procesa una lectura no se toma otra. */
  private procesando = false;

  async abrir(): Promise<void> {
    this.error.set(null); this.manual = '';
    this.lecturas.set([]); this.ultimo.set(null);
    this.abierto.set(true);
    const d = this.dialogo()?.nativeElement;
    try { if (d && !d.open) d.showModal(); } catch { d?.setAttribute('open', ''); }
    await new Promise(r => setTimeout(r));
    // En escritorio el foco va al campo manual: así un lector USB también escribe aquí. En el
    // celular no, porque abriría el teclado encima de la cámara.
    if (!this.esTactil()) this.manualInput()?.nativeElement.focus({ preventScroll: true });
    await this.arrancar();
  }

  private esTactil(): boolean {
    try { return window.matchMedia('(pointer: coarse)').matches; } catch { return false; }
  }

  private async arrancar(): Promise<void> {
    const mia = ++this.sesion;
    this.detener();
    this.activo = true;
    this.iniciando.set(true); this.error.set(null); this.leyendo.set(false);
    this.zoom.set(1); this.zoomMax.set(1); this.zoomHardware.set(false);
    const v = this.video()?.nativeElement;
    if (!v) return;
    try {
      if (!window.isSecureContext) throw Object.assign(new Error(), { name: 'Inseguro' });
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error(), { name: 'SinCamara' });
      const flujo = await this.pedirCamara();
      // Si se cerró mientras se pedía permiso, soltar la cámara de una.
      if (mia !== this.sesion || !this.activo) { flujo.getTracks().forEach(t => t.stop()); return; }
      this.flujo = flujo;
      v.srcObject = flujo;
      await v.play().catch(() => undefined);
      this.iniciando.set(false);
      this.revisarCapacidades(flujo);
      await this.leerEnVivo(v, mia);
    } catch (e: any) {
      if (mia !== this.sesion) return;
      this.iniciando.set(false);
      this.error.set(
        e?.name === 'NotAllowedError' ? 'Sin permiso para la cámara. Actívelo en el candado de la barra de direcciones.'
        : e?.name === 'NotFoundError' || e?.name === 'SinCamara' ? 'Este equipo no tiene cámara disponible.'
        : e?.name === 'NotReadableError' ? 'Otra aplicación está usando la cámara. Ciérrela e intente de nuevo.'
        : e?.name === 'Inseguro' ? 'La cámara solo funciona con conexión segura (https).'
        : 'No se pudo abrir la cámara.');
    }
  }

  /** Cámara trasera en alta resolución con enfoque continuo; si el equipo no puede, lo básico. */
  private async pedirCamara(): Promise<MediaStream> {
    const cams = this.camaras();
    let guardada: string | null = null;
    try { guardada = localStorage.getItem(CLAVE_CAMARA); } catch { /* sin storage */ }
    const base: MediaTrackConstraints = this.camaraIdx >= 0 && cams[this.camaraIdx]
      ? { deviceId: { exact: cams[this.camaraIdx].deviceId } }
      : guardada ? { deviceId: { ideal: guardada }, facingMode: { ideal: 'environment' } } : { facingMode: { ideal: 'environment' } };
    const intentos: MediaTrackConstraints[] = [
      { ...base, width: { ideal: 1920 }, height: { ideal: 1080 }, advanced: [{ focusMode: 'continuous' } as any] },
      { ...base, width: { ideal: 1280 }, height: { ideal: 720 } },
      base,
    ];
    let ultimoError: any;
    for (const video of intentos) {
      try { return await navigator.mediaDevices.getUserMedia({ video, audio: false }); }
      catch (e: any) {
        ultimoError = e;
        if (e?.name === 'NotAllowedError' || e?.name === 'NotFoundError') throw e;
      }
    }
    throw ultimoError;
  }

  /**
   * Lee del video en vivo: lector nativo si existe; si en 3 s no encontró nada (o no hay),
   * ZXing por turnos sobre distintos recortes del cuadro.
   */
  private async leerEnVivo(v: HTMLVideoElement, mia: number): Promise<void> {
    const nativos = await nativosDisponibles();
    let detector: any = null;
    if (nativos.length) {
      try { detector = new window.BarcodeDetector({ formats: nativos }); } catch { detector = null; }
    }
    this.leyendo.set(true);
    const inicio = Date.now();
    let zx: { lector: any; ZXing: any } | null = null;
    let cargandoZx = false;
    let turno = 0;
    const ciclo = async () => {
      if (!this.activo || mia !== this.sesion) return;
      if (v.readyState >= 2 && v.videoWidth) {
        turno++;
        const fuenteZoom = this.zoomDigital() > 1 ? this.recorte(v, 1 / this.zoomDigital(), 1 / this.zoomDigital()) : null;
        if (detector) {
          try {
            const r = await detector.detect(fuenteZoom ?? v);
            const valor = r?.find((x: any) => x?.rawValue)?.rawValue;
            if (valor) { this.alLeer(valor); }
          } catch { /* cuadro no listo */ }
        }
        // ZXing entra si no hay lector nativo, o como refuerzo cuando el nativo no encuentra.
        if (!detector || Date.now() - inicio > 3000) {
          if (!zx && !cargandoZx) {
            cargandoZx = true;
            this.prepararZxing().then(z => { zx = z; }).catch(() => undefined);
          }
          if (zx && (!detector || turno % 2 === 0)) {
            const texto = this.decodificarZxing(zx, v, turno);
            if (texto) this.alLeer(texto);
          }
        }
      }
      if (!this.activo || mia !== this.sesion) return;
      this.relojes.push(setTimeout(ciclo, detector ? 110 : 140));
    };
    ciclo();
  }

  private async prepararZxing(): Promise<{ lector: any; ZXing: any }> {
    const ZXing = await cargarZxing();
    const hints = new Map();
    const F = ZXing.BarcodeFormat;
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, FORMATOS_ZXING.map(f => F[f]).filter((f: any) => f != null));
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    const lector = new ZXing.MultiFormatReader();
    lector.setHints(hints);
    return { lector, ZXing };
  }

  /** Recorte centrado del video en un lienzo (para acercar o leer solo la franja del recuadro). */
  private recorte(v: HTMLVideoElement | HTMLImageElement | ImageBitmap, fw: number, fh: number, maxAncho = 1280, girar = false,
                  lienzo: HTMLCanvasElement = this.lienzo ??= document.createElement('canvas')): HTMLCanvasElement {
    const w = (v as any).videoWidth || (v as any).naturalWidth || (v as any).width;
    const h = (v as any).videoHeight || (v as any).naturalHeight || (v as any).height;
    const sw = Math.round(w * fw), sh = Math.round(h * fh);
    const sx = Math.round((w - sw) / 2), sy = Math.round((h - sh) / 2);
    const escala = Math.min(2.5, maxAncho / sw);
    const dw = Math.round(sw * escala), dh = Math.round(sh * escala);
    lienzo.width = girar ? dh : dw; lienzo.height = girar ? dw : dh;
    const ctx = lienzo.getContext('2d', { willReadFrequently: true })!;
    ctx.save();
    if (girar) { ctx.translate(dh, 0); ctx.rotate(Math.PI / 2); }
    ctx.drawImage(v as CanvasImageSource, sx, sy, sw, sh, 0, 0, dw, dh);
    ctx.restore();
    return lienzo;
  }

  /** Un intento de ZXing con el recorte que toca en este turno. */
  private decodificarZxing(zx: { lector: any; ZXing: any }, fuente: HTMLVideoElement | HTMLImageElement | ImageBitmap, turno: number): string | null {
    const z = this.zoomDigital() > 1 ? 1 / this.zoomDigital() : 1;
    // franja del recuadro · cuadro completo · acercamiento 2x · franja girada (código vertical)
    const recortes: Array<[number, number, number, boolean]> = [
      [z, z * 0.5, 1280, false], [z, z, 1280, false], [z * 0.5, z * 0.35, 1280, false], [z * 0.5, z, 1280, true],
    ];
    const [fw, fh, max, girar] = recortes[turno % recortes.length];
    return this.zxingSobre(zx, this.recorte(fuente, fw, fh, max, girar));
  }

  private zxingSobre(zx: { lector: any; ZXing: any }, lienzo: HTMLCanvasElement): string | null {
    const { ZXing, lector } = zx;
    try {
      const lum = new ZXing.HTMLCanvasElementLuminanceSource(lienzo);
      const bmp = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(lum));
      const r = lector.decode(bmp);
      return r?.getText() || null;
    } catch { return null; }
    finally { try { lector.reset?.(); } catch { /* nada */ } }
  }

  // ── Foto: la cámara nativa del teléfono, con autoenfoque y resolución completa ─────────

  tomarFoto(): void {
    const i = this.archivo()?.nativeElement;
    if (!i) return;
    i.value = '';
    i.click();
  }

  async leerFoto(ev: Event): Promise<void> {
    const archivo = (ev.target as HTMLInputElement).files?.[0];
    if (!archivo) return;
    this.buscandoFoto.set(true);
    try {
      const texto = await this.decodificarImagen(archivo);
      if (texto) this.alLeer(texto, true);
      else this.mostrar({ codigo: '', ok: false, texto: 'No encontramos un código en la foto', detalle: 'Acérquese, que el código salga nítido y con buena luz.', hora: Date.now(), veces: 1 });
    } finally { this.buscandoFoto.set(false); }
  }

  private async decodificarImagen(archivo: Blob): Promise<string | null> {
    let img: ImageBitmap | HTMLImageElement;
    try { img = await createImageBitmap(archivo); }
    catch {
      img = await new Promise<HTMLImageElement>((ok, mal) => {
        const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = URL.createObjectURL(archivo);
      });
    }
    const nativos = await nativosDisponibles();
    if (nativos.length) {
      try {
        const det = new window.BarcodeDetector({ formats: nativos });
        const r = await det.detect(img);
        const valor = r?.find((x: any) => x?.rawValue)?.rawValue;
        if (valor) return valor;
      } catch { /* sigue con ZXing */ }
    }
    try {
      const zx = await this.prepararZxing();
      const lienzo = document.createElement('canvas');
      // Varias pasadas: completa reducida, completa a más detalle, centro, y giradas.
      const pasadas: Array<[number, number, number, boolean]> = [
        [1, 1, 1600, false], [1, 1, 2400, false], [0.6, 0.6, 1600, false], [1, 1, 1600, true], [0.6, 0.6, 1600, true],
      ];
      for (const [fw, fh, max, girar] of pasadas) {
        const t = this.zxingSobre(zx, this.recorte(img, fw, fh, max, girar, lienzo));
        if (t) return t;
      }
    } catch { /* sin lector */ }
    return null;
  }

  // ── Resultado de una lectura ────────────────────────────────────────────────────────

  private alLeer(crudo: string, deFoto = false): void {
    const codigo = (crudo || '').trim();
    if (!codigo) return;
    if (this.procesando && !deFoto) return;
    const ahora = Date.now();
    // El mismo código pegado a la cámara se lee 10 veces por segundo: se cuenta una.
    if (!deFoto && codigo === this.ultimaLectura.codigo && ahora - this.ultimaLectura.hora < 2500) return;
    this.ultimaLectura = { codigo, hora: ahora };
    this.pitar(); this.vibrar();
    this.flash.set(true); this.relojes.push(setTimeout(() => this.flash.set(false), 380));
    this.leido.emit(codigo);
    const proc = this.procesar();
    if (!proc) {
      if (this.modo() === 'unico') { this.cerrar(); return; }
      this.mostrar({ codigo, ok: true, texto: codigo, hora: ahora, veces: 1 });
      return;
    }
    const lectura: Lectura = { codigo, ok: true, texto: codigo, hora: ahora, procesando: true, veces: 1 };
    this.mostrar(lectura);
    if (this.modo() === 'unico') this.procesando = true;
    Promise.resolve(proc(codigo)).then(r => {
      this.procesando = false;
      const final: Lectura = { ...lectura, procesando: false, ok: r ? r.ok : true, texto: r?.texto || codigo, detalle: r?.detalle ?? null };
      this.mostrar(final, lectura);
      if (!final.ok) this.vibrar(true);
      if (this.modo() === 'unico' && final.ok) this.relojes.push(setTimeout(() => this.cerrar(), 700));
    }).catch(() => {
      this.procesando = false;
      this.mostrar({ ...lectura, procesando: false, ok: false, texto: 'No se pudo procesar ' + codigo }, lectura);
      this.vibrar(true);
    });
  }

  /** Pone la lectura arriba del visor y (en continuo) en la lista; reemplaza la provisional. */
  private mostrar(l: Lectura, reemplaza?: Lectura): void {
    this.ultimo.set(l);
    if (this.modo() !== 'continuo' || !l.codigo) return;
    this.lecturas.update(ls => {
      if (reemplaza) return ls.map(x => x === reemplaza || (x.codigo === reemplaza.codigo && x.hora === reemplaza.hora) ? { ...l, veces: x.veces } : x);
      const previa = ls.find(x => x.codigo === l.codigo && !x.procesando);
      if (previa && l.procesando) return [{ ...l, veces: previa.veces + 1 }, ...ls.filter(x => x !== previa)].slice(0, 40);
      return [l, ...ls].slice(0, 40);
    });
  }

  private pitar(): void {
    if (!this.sonido()) return;
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      const ctx: AudioContext = this.audio ??= new Ctx();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = 1760;
      g.gain.setValueAtTime(0.06, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.09);
      o.connect(g).connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.1);
    } catch { /* sin audio */ }
  }

  private vibrar(mal = false): void {
    try { navigator.vibrate?.(mal ? [60, 60, 60] : 60); } catch { /* opcional */ }
  }

  // ── Controles de la cámara ─────────────────────────────────────────────────────────

  private revisarCapacidades(flujo: MediaStream): void {
    const pista = flujo.getVideoTracks()[0];
    let cap: any = {};
    try { cap = pista?.getCapabilities?.() ?? {}; } catch { cap = {}; }
    this.tieneLinterna.set(!!cap.torch);
    this.linterna.set(false);
    if (cap.zoom && cap.zoom.max > cap.zoom.min) {
      this.zoomHardware.set(true);
      this.zoomMin.set(cap.zoom.min); this.zoomMax.set(Math.min(cap.zoom.max, 8)); this.zoomPaso.set(cap.zoom.step || 0.1);
      const actual = pista.getSettings?.().zoom as number | undefined;
      this.zoom.set(actual ?? cap.zoom.min);
    } else {
      // Sin zoom de cámara: acercamiento digital (se agranda el video y se lee el recorte).
      this.zoomHardware.set(false);
      this.zoomMin.set(1); this.zoomMax.set(3); this.zoomPaso.set(0.25); this.zoom.set(1);
    }
    navigator.mediaDevices.enumerateDevices?.().then(ds => {
      const cams = ds.filter(d => d.kind === 'videoinput');
      this.camaras.set(cams);
      if (this.camaraIdx < 0) {
        const actual = pista?.getSettings?.().deviceId;
        this.camaraIdx = Math.max(0, cams.findIndex(c => c.deviceId === actual));
      }
    }).catch(() => undefined);
  }

  async ponerZoom(valor: number): Promise<void> {
    this.zoom.set(valor);
    if (!this.zoomHardware()) return;
    const pista = this.flujo?.getVideoTracks()[0];
    try { await pista?.applyConstraints({ advanced: [{ zoom: valor } as any] }); } catch { /* el equipo no lo aceptó */ }
  }

  /** Tocar el video enfoca ese punto (Android); en los demás solo muestra la marca. */
  async tocarVisor(ev: MouseEvent): Promise<void> {
    const el = ev.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    const x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    this.enfoque.set({ x, y });
    this.relojes.push(setTimeout(() => this.enfoque.set(null), 650));
    const pista = this.flujo?.getVideoTracks()[0];
    if (!pista) return;
    try {
      const cap: any = pista.getCapabilities?.() ?? {};
      const modos: string[] = cap.focusMode ?? [];
      const adv: any = { pointsOfInterest: [{ x, y }] };
      if (modos.includes('single-shot')) adv.focusMode = 'single-shot';
      await pista.applyConstraints({ advanced: [adv] });
      if (modos.includes('continuous')) setTimeout(() => pista.applyConstraints({ advanced: [{ focusMode: 'continuous' } as any] }).catch(() => undefined), 1500);
    } catch { /* sin enfoque manual */ }
  }

  async alternarLinterna(): Promise<void> {
    const pista = this.flujo?.getVideoTracks()[0];
    if (!pista) return;
    const on = !this.linterna();
    try { await pista.applyConstraints({ advanced: [{ torch: on } as any] }); this.linterna.set(on); } catch { this.tieneLinterna.set(false); }
  }

  otraCamara(): void {
    const n = this.camaras().length;
    if (n < 2) return;
    this.camaraIdx = (this.camaraIdx + 1) % n;
    try { localStorage.setItem(CLAVE_CAMARA, this.camaras()[this.camaraIdx].deviceId); } catch { /* sin storage */ }
    this.arrancar();
  }

  manualOk(): void {
    const c = this.manual.trim();
    if (!c) return;
    this.manual = '';
    this.ultimaLectura = { codigo: '', hora: 0 };
    this.alLeer(c, true);
  }

  clicFuera(ev: MouseEvent): void {
    // Clic en el fondo (fuera de la caja) cierra.
    if (ev.target === this.dialogo()?.nativeElement) this.cerrar();
  }

  private detener(): void {
    this.relojes.forEach(r => clearTimeout(r));
    this.relojes = [];
    this.flujo?.getTracks().forEach(t => t.stop());
    this.flujo = null;
    const v = this.video()?.nativeElement;
    if (v) v.srcObject = null;
  }

  cerrar(): void {
    const estabaAbierto = this.abierto();
    this.activo = false;
    this.sesion++;
    this.detener();
    this.leyendo.set(false); this.iniciando.set(false); this.linterna.set(false);
    this.ultimaLectura = { codigo: '', hora: 0 };
    this.procesando = false;
    const d = this.dialogo()?.nativeElement;
    try { if (d?.open) d.close(); } catch { d?.removeAttribute('open'); }
    this.abierto.set(false);
    if (estabaAbierto) this.cerrado.emit();
  }

  ngOnDestroy(): void {
    this.cerrar();
    try { this.audio?.close(); } catch { /* nada */ }
  }
}
