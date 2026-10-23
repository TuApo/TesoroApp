import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, input, model, signal, viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpEventType } from '@angular/common/http';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AccionRedactar, Adjunto, Mensaje } from '../../modelos';
import { ChatStoreService } from '../../service/chat-store.service';
import { ComunicacionesApiService } from '../../service/comunicaciones-api.service';
import { iconoAdjunto, idCliente, tamano } from '../../utiles';
import { CamaraDialog } from '../camara/camara-dialog';

interface Pendiente {
  clave: string;
  nombre: string;
  tamano: number;
  progreso: number;
  vistaPrevia: string | null;
  adjunto: Adjunto | null;
  error: string | null;
}

const EMOJIS = ['👍', '👌', '🙏', '👏', '🙌', '💪', '😀', '😂', '😊', '😉', '😍', '🤔', '😅', '😮', '😢', '😡',
  '✅', '❌', '⚠️', '❗', '❓', '🔥', '🎉', '💯', '📌', '📎', '📄', '📅', '⏰', '☕', '👋', '🤝'];

/**
 * Donde se escribe: texto (Enter envía, Mayús+Enter salta de línea), adjuntos
 * con barra de progreso, foto con la cámara, escaneo de documentos y emojis.
 * Pegar una imagen o arrastrar archivos también adjunta.
 */
@Component({
  selector: 'app-com-composer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatMenuModule, MatTooltipModule],
  template: `
    @if (respondiendo(); as r) {
      <div class="cita">
        <mat-icon>reply</mat-icon>
        <div class="cita-txt"><strong>{{ r.autor_nombre }}</strong><span>{{ r.texto || 'Archivo' }}</span></div>
        <button type="button" class="ico" (click)="respondiendo.set(null)" aria-label="Cancelar respuesta"><mat-icon>close</mat-icon></button>
      </div>
    }
    @if (ia(); as sug) {
      <div class="ia-sug" [class.cargando]="sug.cargando">
        <div class="ia-cab"><mat-icon>auto_awesome</mat-icon>
          <strong>{{ sug.cargando ? 'Redactando…' : sug.error ? 'No se pudo' : 'Sugerencia de la IA' }}</strong>
          <button type="button" class="ico chico" (click)="ia.set(null)" aria-label="Descartar sugerencia"><mat-icon>close</mat-icon></button></div>
        @if (sug.pedirInstruccion) {
          <form class="ia-instr" (submit)="$event.preventDefault(); redactar('PERSONALIZADA', instr.value)">
            <input #instr type="text" maxlength="500" placeholder="¿Qué cambio quieres? (p. ej. agrega un saludo y hazlo más claro)" aria-label="Cambio que quieres" />
            <button type="submit">Pedir</button>
          </form>
        } @else if (sug.error) {
          <p class="ia-err">{{ sug.error }}</p>
        } @else if (!sug.cargando) {
          <div class="ia-txt">{{ sug.texto }}</div>
          <div class="ia-acc">
            <button type="button" (click)="redactar(sug.accion, sug.instruccion)"><mat-icon>refresh</mat-icon> Otra versión</button>
            <button type="button" class="pri" (click)="usarSugerencia(sug.texto)"><mat-icon>check</mat-icon> Usar</button>
          </div>
        }
      </div>
    }
    @if (pendientes().length) {
      <div class="pendientes">
        @for (p of pendientes(); track p.clave) {
          <div class="pend" [class.err]="p.error">
            @if (p.vistaPrevia) { <img [src]="p.vistaPrevia" alt="" /> }
            @else { <mat-icon>{{ p.adjunto ? icono(p.adjunto) : 'upload_file' }}</mat-icon> }
            <div class="pend-txt">
              <span class="pend-n">{{ p.nombre }}</span>
              <small>{{ p.error ?? (p.adjunto ? tam(p.tamano) : p.progreso + '%') }}</small>
              @if (!p.adjunto && !p.error) { <i class="barra"><b [style.width.%]="p.progreso"></b></i> }
            </div>
            <button type="button" class="ico" (click)="quitar(p)" aria-label="Quitar"><mat-icon>close</mat-icon></button>
          </div>
        }
      </div>
    }
    <div class="fila">
      <button type="button" class="ico" [matMenuTriggerFor]="menuAdjuntar" matTooltip="Adjuntar" aria-label="Adjuntar">
        <mat-icon>add_circle</mat-icon>
      </button>
      <mat-menu #menuAdjuntar="matMenu" yPosition="above">
        <button mat-menu-item (click)="doc.click()"><mat-icon>description</mat-icon> Documento</button>
        <button mat-menu-item (click)="galeria.click()"><mat-icon>photo_library</mat-icon> Foto o video</button>
        <button mat-menu-item (click)="tomarFoto()"><mat-icon>photo_camera</mat-icon> Tomar foto</button>
        <button mat-menu-item (click)="escanear()"><mat-icon>document_scanner</mat-icon> Escanear documento</button>
      </mat-menu>
      <input #doc type="file" multiple hidden (change)="elegidos($event)" />
      <input #galeria type="file" multiple hidden accept="image/*,video/*" (change)="elegidos($event)" />

      <textarea #caja rows="1" [placeholder]="placeholder()" [value]="texto()" (input)="alEscribir($event)"
                (keydown)="tecla($event)" (paste)="pegar($event)" aria-label="Mensaje"></textarea>

      <button type="button" class="ico ia-btn" [matMenuTriggerFor]="menuIa" matTooltip="Redactar con IA" aria-label="Redactar con IA">
        <mat-icon>auto_awesome</mat-icon>
      </button>
      <mat-menu #menuIa="matMenu" yPosition="above">
        <button mat-menu-item (click)="redactar('MEJORAR')" [disabled]="!texto().trim()"><mat-icon>auto_fix_high</mat-icon> Mejorar redacción</button>
        <button mat-menu-item (click)="redactar('CORREGIR')" [disabled]="!texto().trim()"><mat-icon>spellcheck</mat-icon> Corregir ortografía</button>
        <button mat-menu-item (click)="redactar('FORMAL')" [disabled]="!texto().trim()"><mat-icon>business_center</mat-icon> Más formal</button>
        <button mat-menu-item (click)="redactar('CORDIAL')" [disabled]="!texto().trim()"><mat-icon>sentiment_satisfied</mat-icon> Más cordial</button>
        <button mat-menu-item (click)="redactar('BREVE')" [disabled]="!texto().trim()"><mat-icon>short_text</mat-icon> Más breve</button>
        <button mat-menu-item (click)="redactar('RESPONDER')"><mat-icon>reply</mat-icon> {{ texto().trim() ? 'Armar la respuesta con mi idea' : 'Sugerir una respuesta' }}</button>
        <button mat-menu-item (click)="pedirOtroCambio()" [disabled]="!texto().trim()"><mat-icon>edit_note</mat-icon> Pedir otro cambio…</button>
      </mat-menu>
      <button type="button" class="ico" [matMenuTriggerFor]="menuEmoji" matTooltip="Emoji" aria-label="Emoji">
        <mat-icon>sentiment_satisfied</mat-icon>
      </button>
      <mat-menu #menuEmoji="matMenu" yPosition="above" class="com-emojis">
        <div class="emojis" (click)="$event.stopPropagation()">
          @for (e of emojis; track e) { <button type="button" (click)="emoji(e)">{{ e }}</button> }
        </div>
      </mat-menu>
      <button type="button" class="enviar" [disabled]="!puedeEnviar()" (click)="enviar()" aria-label="Enviar">
        <mat-icon>send</mat-icon>
      </button>
    </div>`,
  styles: [`
    :host { display: block; border-top: 1px solid var(--border); background: var(--surface); padding: .45rem .5rem .55rem; }
    .fila { display: flex; align-items: flex-end; gap: .25rem; }
    textarea { flex: 1; resize: none; border: 1px solid var(--border); border-radius: 18px; padding: .5rem .8rem;
      font: inherit; font-size: .92rem; line-height: 1.35; max-height: 140px; background: var(--surface-2); color: var(--text);
      outline: none; min-width: 0; }
    textarea:focus { border-color: var(--primary); background: var(--surface); box-shadow: var(--ring); }
    .ico { border: 0; background: transparent; color: var(--muted); width: 36px; height: 36px; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center; cursor: pointer; flex: none; }
    .ico:hover { background: var(--surface-3); color: var(--text); }
    .enviar { border: 0; width: 38px; height: 38px; border-radius: 50%; background: var(--primary); color: #fff; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center; flex: none; }
    .enviar:disabled { background: var(--surface-4); color: var(--text-faint); cursor: default; }
    .enviar mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .cita { display: flex; align-items: center; gap: .5rem; padding: .35rem .5rem; margin-bottom: .35rem;
      border-left: 3px solid var(--primary); background: var(--surface-2); border-radius: 6px; color: var(--muted); }
    .cita-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; font-size: .8rem; }
    .cita-txt span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pendientes { display: flex; gap: .4rem; overflow-x: auto; padding-bottom: .4rem; }
    .pend { position: relative; display: flex; align-items: center; gap: .4rem; border: 1px solid var(--border); border-radius: 10px;
      padding: .3rem .3rem .3rem .4rem; min-width: 150px; max-width: 220px; background: var(--surface-2); }
    .pend.err { border-color: var(--danger-border); background: var(--danger-bg); }
    .pend img { width: 38px; height: 38px; object-fit: cover; border-radius: 6px; }
    .pend-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; font-size: .75rem; }
    .pend-n { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
    .barra { display: block; height: 3px; background: var(--surface-4); border-radius: 2px; margin-top: 2px; }
    .barra b { display: block; height: 100%; background: var(--primary); border-radius: 2px; transition: width .2s; }
    .ia-btn { color: var(--primary); }
    .ia-sug { border: 1px solid color-mix(in srgb, var(--primary) 45%, transparent); background: color-mix(in srgb, var(--primary) 7%, var(--surface));
      border-radius: 12px; padding: .45rem .6rem; margin-bottom: .4rem; display: flex; flex-direction: column; gap: .35rem; }
    .ia-cab { display: flex; align-items: center; gap: .3rem; font-size: .78rem; color: var(--primary); }
    .ia-cab mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .ia-cab .chico { margin-left: auto; width: 26px; height: 26px; min-height: 0 !important; }
    .ia-cab .chico mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .ia-sug.cargando .ia-cab mat-icon:first-child { animation: brillo 1s ease-in-out infinite alternate; }
    .ia-txt { white-space: pre-wrap; font-size: .86rem; line-height: 1.4; max-height: 180px; overflow-y: auto; color: var(--text); overflow-wrap: anywhere; }
    .ia-err { margin: 0; font-size: .8rem; color: var(--danger-fg); }
    .ia-acc { display: flex; justify-content: flex-end; gap: .35rem; }
    .ia-acc button, .ia-instr button { display: inline-flex; align-items: center; gap: .2rem; border: 1px solid var(--border); background: var(--surface);
      color: var(--text); border-radius: 999px; padding: .22rem .65rem; font: inherit; font-size: .76rem; cursor: pointer; min-height: 0 !important; }
    .ia-acc button.pri, .ia-instr button { background: var(--primary); border-color: var(--primary); color: #fff; }
    .ia-acc mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .ia-instr { display: flex; gap: .35rem; }
    .ia-instr input { flex: 1; min-width: 0; border: 1px solid var(--border); border-radius: 10px; padding: .35rem .55rem; font: inherit; font-size: .8rem;
      background: var(--surface); color: var(--text); }
    @keyframes brillo { from { opacity: .4; } to { opacity: 1; } }
    .emojis { display: grid; grid-template-columns: repeat(8, 34px); gap: 2px; padding: .35rem; }
    .emojis button { border: 0; background: transparent; font-size: 1.25rem; cursor: pointer; border-radius: 6px; height: 34px; }
    .emojis button:hover { background: var(--surface-3); }
  `],
})
export class ComComposer {
  private readonly store = inject(ChatStoreService);
  private readonly api = inject(ComunicacionesApiService);
  private readonly dialog = inject(MatDialog);

  readonly conversacionId = input.required<string>();
  readonly placeholder = input('Escribe un mensaje');
  readonly respondiendo = model<Mensaje | null>(null);

  private readonly caja = viewChild<ElementRef<HTMLTextAreaElement>>('caja');
  readonly texto = signal('');
  readonly pendientes = signal<Pendiente[]>([]);
  readonly emojis = EMOJIS;
  readonly subiendo = computed(() => this.pendientes().some(p => !p.adjunto && !p.error));
  readonly puedeEnviar = computed(() => !this.subiendo()
    && (this.texto().trim().length > 0 || this.pendientes().some(p => p.adjunto)));
  /** La sugerencia de la IA en curso (se ve sobre el redactor; la persona decide si la usa). */
  readonly ia = signal<{ accion: AccionRedactar; instruccion?: string; cargando: boolean; texto: string; error: string | null;
    pedirInstruccion?: boolean } | null>(null);

  constructor() {
    this.store.insertarEnComposer$.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(({ conversacionId, texto }) => {
      if (conversacionId !== this.conversacionId()) return;
      this.ponerTexto(this.texto().trim() ? this.texto().trimEnd() + '\n\n' + texto : texto);
    });
  }

  /** Mejorar, corregir, cambiar el tono o sugerir la respuesta, con la conversación como contexto. */
  redactar(accion: AccionRedactar, instruccion?: string): void {
    if (accion === 'PERSONALIZADA' && !instruccion?.trim()) return;
    this.ia.set({ accion, instruccion, cargando: true, texto: '', error: null });
    this.api.redactar({ conversacion_id: this.conversacionId(), texto: this.texto(), accion, instruccion }).subscribe({
      next: r => this.ia.set({ accion, instruccion, cargando: false, texto: r.texto, error: null }),
      error: e => this.ia.set({ accion, instruccion, cargando: false, texto: '', error: e?.error?.message ?? 'La IA no respondió; intenta de nuevo.' }),
    });
  }

  pedirOtroCambio(): void {
    this.ia.set({ accion: 'PERSONALIZADA', cargando: false, texto: '', error: null, pedirInstruccion: true });
  }

  usarSugerencia(texto: string): void {
    this.ia.set(null);
    this.ponerTexto(texto);
  }

  private ponerTexto(texto: string): void {
    this.texto.set(texto);
    const c = this.caja()?.nativeElement;
    if (c) {
      c.value = texto;
      this.autoAjustar(c);
      c.focus();
      c.setSelectionRange(texto.length, texto.length);
    }
  }

  enfocar(): void { this.caja()?.nativeElement.focus(); }

  alEscribir(e: Event): void {
    const t = e.target as HTMLTextAreaElement;
    this.texto.set(t.value);
    this.autoAjustar(t);
    if (t.value.trim()) this.store.escribiendo(this.conversacionId());
  }

  private autoAjustar(t: HTMLTextAreaElement): void {
    t.style.height = 'auto';
    t.style.height = Math.min(140, t.scrollHeight) + 'px';
  }

  tecla(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      this.enviar();
    } else if (e.key === 'Escape' && this.respondiendo()) {
      this.respondiendo.set(null);
    }
  }

  enviar(): void {
    if (!this.puedeEnviar()) return;
    const listos = this.pendientes().filter(p => p.adjunto).map(p => p.adjunto!);
    const texto = this.texto().trim() || null;
    this.store.enviar(this.conversacionId(), texto, listos, this.respondiendo());
    this.texto.set('');
    this.pendientes.set([]);
    this.respondiendo.set(null);
    const c = this.caja()?.nativeElement;
    if (c) { c.value = ''; this.autoAjustar(c); c.focus(); }
  }

  emoji(e: string): void {
    const c = this.caja()?.nativeElement;
    if (!c) { this.texto.update(t => t + e); return; }
    const ini = c.selectionStart ?? c.value.length, fin = c.selectionEnd ?? c.value.length;
    c.value = c.value.slice(0, ini) + e + c.value.slice(fin);
    this.texto.set(c.value);
    c.selectionStart = c.selectionEnd = ini + e.length;
    c.focus();
  }

  pegar(e: ClipboardEvent): void {
    const archivos = Array.from(e.clipboardData?.files ?? []);
    if (archivos.length) {
      e.preventDefault();
      this.agregarArchivos(archivos);
    }
  }

  elegidos(e: Event): void {
    const input = e.target as HTMLInputElement;
    this.agregarArchivos(Array.from(input.files ?? []));
    input.value = '';
  }

  async tomarFoto(): Promise<void> {
    const ref = this.dialog.open(CamaraDialog, { panelClass: 'com-dialogo-oscuro', maxWidth: '100vw' });
    const f = await new Promise<File | undefined>(r => ref.afterClosed().subscribe(r));
    if (f) this.agregarArchivos([f]);
  }

  async escanear(): Promise<void> {
    const { DocumentScanDialogComponent } = await import(
      '@/app/features/dashboard/submodule/document-management/components/document-scan-dialog/document-scan-dialog.component');
    const ref = this.dialog.open(DocumentScanDialogComponent, {
      maxWidth: '100vw', maxHeight: '100vh', height: '100%', width: '100%',
      panelClass: 'full-screen-dialog', disableClose: true,
      data: { modo: 'libre', maxDocs: 10, docName: 'Documento' },
    });
    const archivos = await new Promise<File[] | undefined>(r => ref.afterClosed().subscribe(r));
    if (archivos?.length) this.agregarArchivos(archivos, 'ESCANEO');
  }

  /** Sube de inmediato: el mensaje sale cuando todo terminó de subir. */
  async agregarArchivos(archivos: File[], clase?: string): Promise<void> {
    for (const original of archivos.slice(0, 20)) {
      if (original.size > 90 * 1024 * 1024) {
        this.pendientes.update(l => [...l, { clave: idCliente(), nombre: original.name, tamano: original.size, progreso: 0,
          vistaPrevia: null, adjunto: null, error: 'Supera 90 MB' }]);
        continue;
      }
      const archivo = await comprimirSiEsFoto(original);
      const clave = idCliente();
      const vista = archivo.type.startsWith('image/') ? URL.createObjectURL(archivo) : null;
      this.pendientes.update(l => [...l, { clave, nombre: archivo.name, tamano: archivo.size, progreso: 0, vistaPrevia: vista, adjunto: null, error: null }]);
      this.api.subir(this.conversacionId(), archivo, clase).subscribe({
        next: ev => {
          if (ev.type === HttpEventType.UploadProgress && ev.total) {
            const pct = Math.round(100 * ev.loaded / ev.total);
            this.parchar(clave, { progreso: pct });
          } else if (ev.type === HttpEventType.Response && ev.body) {
            this.parchar(clave, { adjunto: ev.body, progreso: 100 });
          }
        },
        error: e => this.parchar(clave, { error: e?.status === 413 ? 'Muy grande' : 'No se pudo subir' }),
      });
    }
    this.enfocar();
  }

  quitar(p: Pendiente): void {
    if (p.adjunto) this.api.descartarAdjunto(p.adjunto.id).subscribe({ error: () => undefined });
    if (p.vistaPrevia) URL.revokeObjectURL(p.vistaPrevia);
    this.pendientes.update(l => l.filter(x => x.clave !== p.clave));
  }

  private parchar(clave: string, cambios: Partial<Pendiente>): void {
    this.pendientes.update(l => l.map(p => p.clave === clave ? { ...p, ...cambios } : p));
  }

  icono(a: Adjunto): string { return iconoAdjunto(a.clase, a.mime); }
  tam(b: number): string { return tamano(b); }
}

/** Fotos de celular de 4-8 MB → JPEG de 2000 px: se ven igual en el chat y suben en segundos. */
async function comprimirSiEsFoto(f: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(f.type) || f.size < 1.2 * 1024 * 1024) return f;
  try {
    const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    const escala = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * escala);
    c.height = Math.round(bmp.height * escala);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', 0.85));
    if (!blob || blob.size >= f.size) return f;
    return new File([blob], f.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return f;
  }
}
