import { ChangeDetectionStrategy, Component, HostListener, OnDestroy, computed, inject, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import { mensajeDeError } from '../../utils/mensaje-error';
import { ArchivoChat, etiquetaFormato, iconoArchivo, tamanoLegible } from './chat-ia.modelos';
import { ChatIaService } from './chat-ia.service';

type Modo = 'imagen' | 'pdf' | 'audio' | 'video' | 'hoja' | 'diapositivas' | 'texto' | 'html' | 'nada';

interface Hoja { nombre: string; filas: string[][] }

/**
 * Vista previa de lo que se adjunta y de lo que genera la IA, sin descargar: imagen, PDF,
 * audio, Excel/CSV como tabla, PowerPoint diapositiva por diapositiva (las dibuja el servidor)
 * y Word como texto. Basado en el visor de Seguimiento de Tareas, pero leyendo del chat.
 */
@Component({
  selector: 'app-visor-archivo-ia',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule],
  template: `
    @let a = actual();
    <div class="vai">
      <header class="vai-cab">
        <mat-icon class="vai-ico">{{ icono(a) }}</mat-icon>
        <div class="vai-tit">
          <strong [title]="a.nombre">{{ a.nombre }}</strong>
          <small>{{ formato(a) }} · {{ tam(a.tamano) }}{{ data.archivos.length > 1 ? ' · ' + (indice() + 1) + ' de ' + data.archivos.length : '' }}</small>
        </div>
        @if (data.archivos.length > 1) {
          <button mat-icon-button (click)="mover(-1)" aria-label="Archivo anterior" matTooltip="Anterior"><mat-icon>chevron_left</mat-icon></button>
          <button mat-icon-button (click)="mover(1)" aria-label="Archivo siguiente" matTooltip="Siguiente"><mat-icon>chevron_right</mat-icon></button>
        }
        <button mat-icon-button (click)="descargar()" aria-label="Descargar" matTooltip="Descargar"><mat-icon>download</mat-icon></button>
        <button mat-icon-button (click)="ref.close()" aria-label="Cerrar"><mat-icon>close</mat-icon></button>
      </header>
      <div class="vai-cuerpo" [attr.data-modo]="modo()">
        @if (cargando()) {
          <div class="vai-centro"><mat-spinner diameter="36" /></div>
        } @else if (error()) {
          <div class="vai-centro vai-vacio"><mat-icon>error_outline</mat-icon><p>{{ error() }}</p></div>
        } @else {
          @switch (modo()) {
            @case ('imagen') { <img class="vai-img" [src]="url()" [alt]="a.nombre"> }
            @case ('pdf') { <iframe class="vai-marco" [src]="seguro()" [title]="a.nombre"></iframe> }
            @case ('audio') { <div class="vai-centro"><mat-icon class="vai-grande">graphic_eq</mat-icon><audio [src]="url()" controls></audio></div> }
            @case ('video') { <video class="vai-img" [src]="url()" controls></video> }
            @case ('html') { <iframe class="vai-marco" sandbox="" [src]="seguro()" [title]="a.nombre"></iframe> }
            @case ('texto') { <pre class="vai-texto">{{ texto() }}</pre> }
            @case ('diapositivas') {
              <div class="vai-diapo">
                @if (diapositiva()) { <img [src]="diapositiva()" [alt]="'Diapositiva ' + numero()"> }
                <div class="vai-diapo-nav">
                  <button mat-stroked-button (click)="verDiapositiva(numero() - 1)" [disabled]="numero() <= 1"><mat-icon>chevron_left</mat-icon></button>
                  <span>Diapositiva {{ numero() }} de {{ totalDiapositivas() }}</span>
                  <button mat-stroked-button (click)="verDiapositiva(numero() + 1)" [disabled]="numero() >= totalDiapositivas()"><mat-icon>chevron_right</mat-icon></button>
                </div>
              </div>
            }
            @case ('hoja') {
              @if (hojas().length > 1) {
                <nav class="vai-pestanas">
                  @for (h of hojas(); track h.nombre; let i = $index) {
                    <button type="button" [class.activa]="i === hojaActiva()" (click)="hojaActiva.set(i)">{{ h.nombre }}</button>
                  }
                </nav>
              }
              @let h = hojas()[hojaActiva()];
              @if (h) {
                <div class="vai-tabla">
                  <table>
                    @for (f of h.filas; track $index; let i = $index) {
                      <tr>@for (c of f; track $index) { @if (i === 0) { <th>{{ c }}</th> } @else { <td>{{ c }}</td> } }</tr>
                    }
                  </table>
                </div>
              }
            }
            @default {
              <div class="vai-centro vai-vacio"><mat-icon class="vai-grande">{{ icono(a) }}</mat-icon><p>Este archivo no tiene vista previa.</p>
                <button mat-flat-button (click)="descargar()"><mat-icon>download</mat-icon> Descargar</button></div>
            }
          }
        }
      </div>
    </div>
  `,
  styles: [`
    .vai { display: flex; flex-direction: column; height: min(86vh, 900px); max-height: 100%; background: var(--surface); }
    .vai-cab { display: flex; align-items: center; gap: 6px; padding: 8px 10px 8px 14px; border-bottom: 1px solid var(--border); }
    .vai-ico { color: var(--brand-blue); }
    .vai-tit { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .vai-tit strong { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text); }
    .vai-tit small { color: var(--muted); }
    .vai-cuerpo { flex: 1; min-height: 0; overflow: auto; background: var(--surface-2); display: flex; flex-direction: column; }
    .vai-centro { margin: auto; display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 24px; text-align: center; color: var(--muted); }
    .vai-grande { font-size: 48px; width: 48px; height: 48px; }
    .vai-img { max-width: 100%; max-height: 100%; margin: auto; object-fit: contain; }
    .vai-marco { flex: 1; width: 100%; border: 0; background: #fff; min-height: 60vh; }
    .vai-texto { margin: 0; padding: 16px; white-space: pre-wrap; font: .86rem/1.5 var(--font-mono); color: var(--text); }
    .vai-diapo { margin: auto; padding: 12px; display: flex; flex-direction: column; align-items: center; gap: 10px; width: 100%; box-sizing: border-box; }
    .vai-diapo img { max-width: 100%; max-height: calc(86vh - 150px); box-shadow: 0 2px 12px rgb(15 27 45 / .18); border-radius: 6px; background: #fff; }
    .vai-diapo-nav { display: flex; align-items: center; gap: 12px; color: var(--text-2); }
    .vai-pestanas { display: flex; gap: 4px; padding: 8px 10px 0; overflow-x: auto; }
    .vai-pestanas button { border: 1px solid var(--border); background: var(--surface); color: var(--text-2); border-radius: 8px 8px 0 0; padding: 6px 12px; cursor: pointer; white-space: nowrap; }
    .vai-pestanas button.activa { background: var(--brand-blue); color: #fff; border-color: var(--brand-blue); }
    .vai-tabla { overflow: auto; padding: 0 10px 10px; }
    .vai-tabla table { border-collapse: collapse; font-size: .82rem; background: var(--surface); }
    .vai-tabla th { position: sticky; top: 0; background: var(--brand-blue); color: #fff; text-align: left; padding: 5px 8px; white-space: nowrap; }
    .vai-tabla td { border-bottom: 1px solid var(--border); padding: 4px 8px; white-space: nowrap; color: var(--text); }
    @media (max-width: 600px) { .vai { height: 100%; } }
  `],
})
export class VisorArchivoIa implements OnDestroy {
  readonly data = inject<{ archivos: ArchivoChat[]; indice: number }>(MAT_DIALOG_DATA);
  readonly ref = inject(MatDialogRef<VisorArchivoIa>);
  private api = inject(ChatIaService);
  private sanitizer = inject(DomSanitizer);

  readonly indice = signal(this.data.indice ?? 0);
  readonly actual = computed(() => this.data.archivos[this.indice()]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly url = signal<string | null>(null);
  readonly seguro = signal<SafeResourceUrl | null>(null);
  readonly texto = signal('');
  readonly hojas = signal<Hoja[]>([]);
  readonly hojaActiva = signal(0);
  readonly totalDiapositivas = signal(0);
  readonly numero = signal(1);
  readonly diapositiva = signal<string | null>(null);
  readonly modo = computed<Modo>(() => modoDe(this.actual()));
  private urls: string[] = [];

  readonly icono = iconoArchivo;
  readonly formato = etiquetaFormato;
  readonly tam = tamanoLegible;

  constructor() {
    this.cargar();
  }

  @HostListener('document:keydown', ['$event'])
  teclado(e: KeyboardEvent): void {
    if (this.modo() === 'diapositivas' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      this.verDiapositiva(this.numero() + (e.key === 'ArrowRight' ? 1 : -1));
    } else if (e.key === 'ArrowRight') this.mover(1);
    else if (e.key === 'ArrowLeft') this.mover(-1);
  }

  mover(d: number): void {
    const n = this.data.archivos.length;
    if (n < 2) return;
    this.indice.set((this.indice() + d + n) % n);
    this.cargar();
  }

  async descargar(): Promise<void> {
    try { await this.api.descargar(this.actual()); } catch (e) { this.error.set(mensajeDeError(e, 'No se pudo descargar')); }
  }

  async verDiapositiva(n: number): Promise<void> {
    if (n < 1 || n > this.totalDiapositivas()) return;
    this.numero.set(n);
    try {
      const b = await firstValueFrom(this.api.diapositiva(this.actual().id, n));
      this.diapositiva.set(this.objeto(b));
    } catch (e) {
      this.error.set(mensajeDeError(e, 'No se pudo dibujar la diapositiva'));
    }
  }

  private async cargar(): Promise<void> {
    const a = this.actual();
    this.cargando.set(true);
    this.error.set(null);
    this.texto.set('');
    this.hojas.set([]);
    this.hojaActiva.set(0);
    this.diapositiva.set(null);
    try {
      switch (this.modo()) {
        case 'diapositivas': {
          const r = await firstValueFrom(this.api.diapositivas(a.id));
          this.totalDiapositivas.set(r.total);
          await this.verDiapositiva(1);
          break;
        }
        case 'texto': {
          const n = a.nombre.toLowerCase();
          if (n.endsWith('.docx') || n.endsWith('.pptx') || a.tipo === 'DOCUMENTO') {
            this.texto.set((await firstValueFrom(this.api.texto(a.id))).texto || 'Sin texto legible.');
          } else {
            this.texto.set(await (await firstValueFrom(this.api.contenido(a.id))).text());
          }
          break;
        }
        case 'hoja': {
          const blob = await firstValueFrom(this.api.contenido(a.id));
          this.hojas.set(await leerHojas(blob, a.nombre));
          break;
        }
        case 'nada':
          break;
        default: {
          const blob = await firstValueFrom(this.api.contenido(a.id));
          const tipo = this.modo() === 'pdf' ? 'application/pdf' : this.modo() === 'html' ? 'text/html' : (blob.type || a.mime);
          const u = this.objeto(new Blob([blob], { type: tipo }));
          this.url.set(u);
          this.seguro.set(this.sanitizer.bypassSecurityTrustResourceUrl(u));
        }
      }
    } catch (e) {
      this.error.set(mensajeDeError(e, 'No se pudo abrir el archivo'));
    } finally {
      this.cargando.set(false);
    }
  }

  private objeto(b: Blob): string {
    const u = URL.createObjectURL(b);
    this.urls.push(u);
    return u;
  }

  ngOnDestroy(): void {
    this.urls.forEach(u => URL.revokeObjectURL(u));
  }
}

function modoDe(a: ArchivoChat): Modo {
  const n = (a.nombre || '').toLowerCase();
  if (n.endsWith('.pptx')) return 'diapositivas';
  if (n.endsWith('.xlsx') || n.endsWith('.xls') || n.endsWith('.csv')) return 'hoja';
  if (n.endsWith('.docx') || n.endsWith('.md') || n.endsWith('.txt') || n.endsWith('.json')) return 'texto';
  if (n.endsWith('.html') || n.endsWith('.htm')) return 'html';
  switch (a.tipo) {
    case 'IMAGEN': return 'imagen';
    case 'PDF': return 'pdf';
    case 'AUDIO': return 'audio';
    case 'VIDEO': return 'video';
    case 'HOJA': return 'hoja';
    case 'PRESENTACION': return 'diapositivas';
    case 'DOCUMENTO':
    case 'TEXTO': return 'texto';
    default: return 'nada';
  }
}

async function leerHojas(blob: Blob, nombre: string): Promise<Hoja[]> {
  if (nombre.toLowerCase().endsWith('.csv')) {
    const t = (await blob.text()).replace(/^﻿/, '');
    const sep = (t.split('\n')[0].match(/;/g)?.length ?? 0) >= (t.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ',';
    return [{ nombre: 'CSV', filas: t.split(/\r?\n/).filter(l => l.trim()).slice(0, 301).map(l => l.split(sep)) }];
  }
  const XLSX = await import('xlsx');
  const libro = XLSX.read(await blob.arrayBuffer(), { type: 'array' });
  return libro.SheetNames.map(n => ({
    nombre: n,
    filas: (XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets[n], { header: 1, raw: false, defval: '' }) as unknown[][])
      .slice(0, 301).map(f => f.map(c => String(c ?? ''))),
  }));
}
