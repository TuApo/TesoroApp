import {
  ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, effect, inject, input, signal, untracked,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { DispositivosService, wavDePrueba } from '../../service/dispositivos.service';
import { LlamadaService } from '../../service/llamada.service';

/** Abre "Audio y video" fuera de una llamada (para dejarlo listo antes de llamar). */
export function abrirDispositivos(dialog: MatDialog): void {
  dialog.open(DispositivosDialog, { data: {}, width: 'min(440px, 100vw)', maxWidth: '100vw', panelClass: 'com-dialogo', autoFocus: false });
}

/**
 * Elegir micrófono, salida de audio y cámara. En plena llamada el cambio es inmediato
 * (los demás oyen el micrófono nuevo sin cortar); fuera de ella queda guardado para la
 * próxima. El medidor muestra si el micrófono elegido de verdad está captando la voz.
 */
@Component({
  selector: 'app-com-llamada-dispositivos',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <div class="disp" [class.oscuro]="oscuro()">
      @if (sinPermiso()) {
        <p class="nota alerta"><mat-icon>mic_off</mat-icon> El navegador no deja usar el micrófono. Permítelo en el candado de la barra de direcciones.</p>
      } @else if (disp.sinNombres()) {
        <p class="nota">Permite el micrófono para ver el nombre de cada dispositivo.</p>
      }

      <div class="campo">
        <label for="com-sel-mic"><mat-icon>mic</mat-icon> Micrófono</label>
        <select id="com-sel-mic" [value]="disp.mic()" (change)="elegirMic($any($event.target).value)">
          <option value="">Predeterminado del sistema</option>
          @for (d of disp.microfonos(); track d.id) { <option [value]="d.id" [selected]="d.id === disp.mic()">{{ d.nombre }}</option> }
        </select>
        <div class="nivel" role="meter" aria-label="Nivel del micrófono" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="nivelPct()">
          <i [style.width.%]="nivelPct()" [class.alto]="nivelPct() > 85"></i>
        </div>
        <small class="ayuda">
          @if (silenciado()) { Tienes el micrófono silenciado en la llamada. }
          @else if (nivelPct() > 6) { Te estamos oyendo. }
          @else { Habla para probarlo: la barra se mueve con tu voz. }
        </small>
      </div>

      <div class="campo">
        <label for="com-sel-salida"><mat-icon>volume_up</mat-icon> Salida de audio</label>
        @if (disp.eligeSalida) {
          <div class="fila">
            <select id="com-sel-salida" [value]="disp.altavoz()" (change)="disp.elegirAltavoz($any($event.target).value)">
              <option value="">Predeterminada del sistema</option>
              @for (d of disp.altavoces(); track d.id) { <option [value]="d.id" [selected]="d.id === disp.altavoz()">{{ d.nombre }}</option> }
            </select>
            <button type="button" class="probar" (click)="probar()" [disabled]="probando()">
              <mat-icon>{{ probando() ? 'graphic_eq' : 'play_arrow' }}</mat-icon>{{ probando() ? 'Sonando' : 'Probar' }}</button>
          </div>
        } @else {
          <p class="nota">Este navegador usa la salida de audio del sistema. Cámbiala en la configuración de sonido del equipo, o usa Chrome o Edge para elegirla aquí.</p>
        }
      </div>

      <div class="campo">
        <label for="com-sel-cam"><mat-icon>videocam</mat-icon> Cámara</label>
        <select id="com-sel-cam" [value]="disp.camara()" (change)="elegirCamara($any($event.target).value)">
          <option value="">Predeterminada del sistema</option>
          @for (d of disp.camaras(); track d.id) { <option [value]="d.id" [selected]="d.id === disp.camara()">{{ d.nombre }}</option> }
        </select>
      </div>

      <p class="nota pie"><mat-icon>save</mat-icon> Queda guardado en este equipo para tus próximas llamadas.</p>
    </div>`,
  styles: [`
    :host { display: block; }
    .disp { display: flex; flex-direction: column; gap: 1rem; padding: 1rem; color: var(--text); }
    .campo { display: flex; flex-direction: column; gap: .35rem; }
    label { display: inline-flex; align-items: center; gap: .35rem; font-size: .8rem; font-weight: 700; color: var(--text-2); }
    label mat-icon { font-size: 18px; width: 18px; height: 18px; }
    select { width: 100%; min-width: 0; max-width: 100%; height: 40px; border-radius: 10px; border: 1px solid var(--border-strong, var(--border));
      background: var(--surface); color: var(--text); padding: 0 .6rem; font-size: .85rem; }
    .fila { display: flex; gap: .5rem; align-items: center; }
    .fila select { flex: 1; }
    .probar { flex: none; display: inline-flex; align-items: center; gap: .2rem; height: 40px; min-height: 0 !important; padding: 0 .8rem;
      border-radius: 10px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text); cursor: pointer; font-size: .8rem; font-weight: 600; }
    .probar mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .nivel { height: 8px; border-radius: 999px; background: var(--surface-3); overflow: hidden; }
    .nivel i { display: block; height: 100%; background: #22C55E; border-radius: inherit; transition: width .1s linear; }
    .nivel i.alto { background: #F59E0B; }
    .ayuda { color: var(--muted); font-size: .74rem; }
    .nota { margin: 0; font-size: .76rem; color: var(--muted); display: flex; gap: .35rem; align-items: flex-start; line-height: 1.35; }
    .nota mat-icon { font-size: 16px; width: 16px; height: 16px; flex: none; }
    .nota.alerta { color: var(--danger-fg, #B91C1C); }
    .oscuro { color: #fff; }
    .oscuro label { color: rgba(255,255,255,.75); }
    .oscuro select { background: #1F2937; color: #fff; border-color: rgba(255,255,255,.18); }
    .oscuro .probar { background: rgba(255,255,255,.1); color: #fff; border-color: rgba(255,255,255,.18); }
    .oscuro .nivel { background: rgba(255,255,255,.12); }
    .oscuro .ayuda, .oscuro .nota { color: rgba(255,255,255,.65); }
    .oscuro .nota.alerta { color: #FCA5A5; }
  `],
})
export class ComLlamadaDispositivos implements OnInit, OnDestroy {
  readonly disp = inject(DispositivosService);
  private readonly ll = inject(LlamadaService);
  /** Dentro del panel de la llamada (fondo oscuro). */
  readonly oscuro = input(false);

  readonly nivel = signal(0);
  readonly nivelPct = computed(() => Math.round(Math.min(1, this.nivel() * 5) * 100));
  readonly probando = signal(false);
  readonly sinPermiso = signal(false);
  /** Fuera de una llamada se abre el micrófono solo para el medidor. */
  private readonly pistaPrueba = signal<MediaStreamTrack | null>(null);
  readonly silenciado = computed(() => this.ll.enLlamada() && !this.ll.mic());

  private ctx: AudioContext | null = null;
  private medidor: ReturnType<typeof setInterval> | null = null;
  private destruido = false;

  constructor() {
    // Mide la pista que de verdad se está usando: la de la llamada o la de prueba.
    effect(() => {
      const pista = this.ll.enLlamada() ? this.ll.local()?.getAudioTracks()[0] ?? null : this.pistaPrueba();
      untracked(() => this.medir(pista));
    });
  }

  async ngOnInit(): Promise<void> {
    await this.disp.refrescar();
    if (!this.ll.enLlamada()) await this.abrirPrueba();
  }

  ngOnDestroy(): void {
    this.destruido = true;
    this.pararMedidor();
    this.pistaPrueba()?.stop();
  }

  async elegirMic(id: string): Promise<void> {
    if (this.ll.enLlamada()) await this.ll.cambiarMicrofono(id);
    else { this.disp.elegirMic(id); await this.abrirPrueba(); }
  }

  async elegirCamara(id: string): Promise<void> {
    if (this.ll.enLlamada()) await this.ll.cambiarCamara(id);
    else this.disp.elegirCamara(id);
  }

  /** Un pitido por la salida elegida. */
  async probar(): Promise<void> {
    const url = wavDePrueba();
    const a = new Audio(url);
    await this.disp.aplicarSalida(a);
    this.probando.set(true);
    const fin = () => { this.probando.set(false); URL.revokeObjectURL(url); };
    a.onended = fin;
    await a.play().catch(fin);
  }

  private async abrirPrueba(): Promise<void> {
    this.pistaPrueba()?.stop();
    this.pistaPrueba.set(null);
    if (!navigator.mediaDevices?.getUserMedia) return;
    let s: MediaStream | null = null;
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: this.disp.audio() });
    } catch (e: any) {
      if (this.disp.mic() && this.disp.esErrorDeDispositivo(e)) {
        s = await navigator.mediaDevices.getUserMedia({ audio: this.disp.audio('') }).catch(() => null);
      } else {
        this.sinPermiso.set(e?.name === 'NotAllowedError');
      }
    }
    if (!s) return;
    if (this.destruido || this.ll.enLlamada()) { s.getTracks().forEach(t => t.stop()); return; }
    this.sinPermiso.set(false);
    this.pistaPrueba.set(s.getAudioTracks()[0] ?? null);
    void this.disp.refrescar();
  }

  private medir(pista: MediaStreamTrack | null): void {
    this.pararMedidor();
    if (!pista || typeof AudioContext === 'undefined') return;
    try {
      const ctx = new AudioContext();
      void ctx.resume().catch(() => undefined);
      const fuente = ctx.createMediaStreamSource(new MediaStream([pista]));
      const analizador = ctx.createAnalyser();
      analizador.fftSize = 1024;
      fuente.connect(analizador);
      const datos = new Float32Array(analizador.fftSize);
      this.ctx = ctx;
      this.medidor = setInterval(() => {
        analizador.getFloatTimeDomainData(datos);
        let suma = 0;
        for (const x of datos) suma += x * x;
        const rms = pista.enabled ? Math.sqrt(suma / datos.length) : 0;
        this.nivel.set(this.nivel() * 0.6 + rms * 0.4);
      }, 90);
    } catch { /* sin WebAudio: no hay medidor */ }
  }

  private pararMedidor(): void {
    if (this.medidor) clearInterval(this.medidor);
    this.medidor = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.nivel.set(0);
  }
}

@Component({
  selector: 'app-com-dispositivos-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ComLlamadaDispositivos, MatIconModule],
  template: `
    <header>
      <h2><mat-icon>headset_mic</mat-icon> Audio y video</h2>
      <button type="button" class="cerrar" (click)="ref.close()" aria-label="Cerrar"><mat-icon>close</mat-icon></button>
    </header>
    <app-com-llamada-dispositivos />`,
  styles: [`
    :host { display: block; background: var(--surface); color: var(--text); }
    header { display: flex; align-items: center; gap: .5rem; padding: 1rem 1rem 0; }
    h2 { flex: 1; margin: 0; font-size: 1.05rem; display: inline-flex; align-items: center; gap: .4rem; }
    .cerrar { border: 0; background: var(--surface-3); width: 36px; height: 36px; min-height: 0 !important; border-radius: 50%; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center; color: var(--text); }
  `],
})
export class DispositivosDialog {
  readonly data = inject(MAT_DIALOG_DATA);
  readonly ref = inject(MatDialogRef<DispositivosDialog>);
}
