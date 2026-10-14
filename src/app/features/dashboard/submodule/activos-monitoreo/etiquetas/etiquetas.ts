import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

import { Categoria, Etiqueta, EtiquetasService, Sede } from './etiquetas.service';
import { code128Svg } from './code128';

type Tamano = 'S' | 'M' | 'L';
interface GrupoSede { sede: string; items: Etiqueta[]; }

/**
 * Generación de stickers/etiquetas para pegar en los dispositivos. Cada sticker trae QR (resuelve al
 * activo al escanear), código de barras Code 128, y el código legible; organizados POR SEDE para
 * imprimir "todos los de una oficina" de una. El QR lo dibuja `qrcode`; el barras, `code128` propio.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-etiquetas-activos',
  imports: [CommonModule, FormsModule, MatIconModule],
  template: `
    <div class="et">
      <header class="et__barra no-print">
        <h1><mat-icon>qr_code_2</mat-icon> Etiquetas / Stickers</h1>
        <span class="et__flex"></span>
        <select [(ngModel)]="tamano"><option value="S">Pequeño 50×25</option><option value="M">Mediano 70×38</option><option value="L">Grande 90×50</option></select>
        <button class="btn" [disabled]="!etiquetas().length" (click)="imprimir()"><mat-icon>print</mat-icon> Imprimir</button>
      </header>

      <div class="et__filtros no-print">
        <label>Sede
          <select [(ngModel)]="sedeId">
            <option value="">Todas</option>
            @for (s of sedes(); track s.id) { <option [value]="s.id">{{ s.nombre }}</option> }
          </select>
        </label>
        <label>Categoría
          <select [(ngModel)]="categoriaId">
            <option [ngValue]="null">Todas</option>
            @for (c of categorias(); track c.id) { <option [ngValue]="c.id">{{ c.nombre }}</option> }
          </select>
        </label>
        <label>Estado
          <select [(ngModel)]="estado">
            <option value="">Cualquiera</option>
            <option value="DISPONIBLE">Disponible</option><option value="ASIGNADO">Asignado</option>
            <option value="EN_MANTENIMIENTO">En mantenimiento</option><option value="EN_REPARACION">En reparación</option>
          </select>
        </label>
        <label class="crece">Buscar
          <input type="text" [(ngModel)]="q" placeholder="código, nombre, serial…" (keydown.enter)="generar()">
        </label>
        <button class="btn btn--primario" [disabled]="cargando()" (click)="generar()"><mat-icon>auto_awesome_mosaic</mat-icon> Generar</button>
      </div>

      @if (cargando()) { <p class="et__estado no-print"><mat-icon class="girar">progress_activity</mat-icon> Generando…</p> }
      @else if (!etiquetas().length) { <p class="et__estado no-print">Filtra y pulsa Generar para armar las etiquetas.</p> }
      @else { <p class="et__estado no-print">{{ etiquetas().length }} etiquetas · {{ grupos().length }} sede(s). Revisa e imprime.</p> }

      <div class="hojas" [class]="'tam-' + tamano()">
        @for (g of grupos(); track g.sede) {
          <section class="hoja">
            <h2 class="hoja__sede no-print">{{ g.sede }} · {{ g.items.length }}</h2>
            <div class="rejilla">
              @for (e of g.items; track e.id) {
                <div class="sticker">
                  <div class="sticker__qr">
                    @if (qr().get(e.id); as url) { <img [src]="url" alt="QR"> } @else { <div class="sticker__qrvacio"><mat-icon>qr_code_2</mat-icon></div> }
                  </div>
                  <div class="sticker__datos">
                    <div class="sticker__cod">{{ e.codigo }}</div>
                    <div class="sticker__nom">{{ e.nombre }}</div>
                    <div class="sticker__meta">{{ e.categoriaNombre || '' }}{{ e.placa ? ' · ' + e.placa : '' }}</div>
                    <div class="sticker__barras" [innerHTML]="barras().get(e.id)"></div>
                    <div class="sticker__cb">{{ e.codigoBarras || e.codigo }}</div>
                  </div>
                </div>
              }
            </div>
          </section>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .et { padding: 12px 16px; color: var(--text, #0f1b2d); }
    .et__barra { display: flex; align-items: center; gap: 8px; }
    .et__barra h1 { font-size: 18px; font-weight: 800; display: flex; align-items: center; gap: 8px; margin: 0; }
    .et__flex { flex: 1; }
    .et__filtros { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; margin: 10px 0; }
    .et__filtros label { display: flex; flex-direction: column; gap: 3px; font-size: 12px; font-weight: 700; color: #475569; }
    .et__filtros .crece { flex: 1; min-width: 180px; }
    .et__filtros select, .et__filtros input { padding: 7px 9px; border: 1px solid var(--border, #cbd5e1); border-radius: 8px; font-size: 13px; }
    .btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border, #cbd5e1); background: var(--surface, #fff); color: inherit; border-radius: 10px; padding: 7px 12px; min-height: 40px; cursor: pointer; font-weight: 700; font-size: 13px; }
    .btn--primario { background: var(--brand-blue, #2b59f0); color: #fff; border-color: transparent; }
    .btn:disabled { opacity: .5; }
    .btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .et__estado { color: #64748b; font-size: 13px; display: flex; align-items: center; gap: 6px; }
    .girar { animation: etgira 1s linear infinite; } @keyframes etgira { to { transform: rotate(360deg); } }
    .hoja__sede { font-size: 14px; margin: 14px 0 6px; color: #0f172a; }
    .rejilla { display: flex; flex-wrap: wrap; gap: 4mm; }
    .sticker { display: flex; align-items: center; gap: 2mm; border: 1px dashed #cbd5e1; border-radius: 2mm; padding: 2mm; box-sizing: border-box; background: #fff; overflow: hidden; }
    .sticker__qr img, .sticker__qrvacio { width: var(--qr); height: var(--qr); display: block; }
    .sticker__qrvacio { display: flex; align-items: center; justify-content: center; background: #f1f5f9; border-radius: 1mm; color: #94a3b8; }
    .sticker__datos { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: .5mm; }
    .sticker__cod { font-weight: 800; font-size: var(--cod); font-family: ui-monospace, monospace; letter-spacing: .3px; }
    .sticker__nom { font-size: var(--nom); font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sticker__meta { font-size: var(--meta); color: #475569; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sticker__barras { width: 100%; height: var(--bar); margin-top: .5mm; }
    .sticker__barras svg { width: 100%; height: 100%; display: block; }
    .sticker__cb { font-size: var(--meta); font-family: ui-monospace, monospace; color: #0f172a; text-align: center; letter-spacing: 1px; }
    /* Tamaños reales del sticker (mm). */
    .tam-S .sticker { width: 50mm; height: 25mm; --qr: 20mm; --cod: 3mm; --nom: 2.2mm; --meta: 1.8mm; --bar: 6mm; }
    .tam-M .sticker { width: 70mm; height: 38mm; --qr: 30mm; --cod: 4.5mm; --nom: 3mm; --meta: 2.4mm; --bar: 9mm; }
    .tam-L .sticker { width: 90mm; height: 50mm; --qr: 40mm; --cod: 6mm; --nom: 4mm; --meta: 3mm; --bar: 12mm; }
    @media print {
      :host { color: #000; }
      .no-print { display: none !important; }
      .et { padding: 0; }
      .hoja { break-inside: auto; }
      .hoja + .hoja { break-before: page; }
      .sticker { border: 1px solid #e2e8f0; }
      @page { margin: 8mm; }
    }
  `],
})
export class EtiquetasActivos implements OnInit {
  private readonly api = inject(EtiquetasService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly sedes = signal<Sede[]>([]);
  readonly categorias = signal<Categoria[]>([]);
  readonly etiquetas = signal<Etiqueta[]>([]);
  readonly qr = signal<Map<number, string>>(new Map());
  readonly barras = signal<Map<number, SafeHtml>>(new Map());
  readonly cargando = signal(false);
  readonly tamano = signal<Tamano>('M');

  sedeId = '';
  categoriaId: number | null = null;
  estado = '';
  q = '';

  readonly grupos = computed<GrupoSede[]>(() => {
    const porSede = new Map<string, Etiqueta[]>();
    for (const e of this.etiquetas()) {
      const k = e.sedeNombre || 'Sin sede';
      (porSede.get(k) ?? porSede.set(k, []).get(k)!).push(e);
    }
    return [...porSede.entries()].map(([sede, items]) => ({ sede, items }));
  });

  ngOnInit(): void {
    this.api.sedes().subscribe({ next: s => this.sedes.set(s), error: () => {} });
    this.api.categorias().subscribe({ next: c => this.categorias.set(c), error: () => {} });
  }

  generar(): void {
    this.cargando.set(true);
    this.api.etiquetas({
      q: this.q || undefined, estado: this.estado || undefined,
      sede_id: this.sedeId || undefined,
      categoria_id: this.categoriaId ?? undefined, limite: 500,
    }).subscribe({
      next: lista => { this.etiquetas.set(lista); this.render(lista); this.cargando.set(false); },
      error: () => { this.etiquetas.set([]); this.cargando.set(false); },
    });
  }

  private async render(lista: Etiqueta[]): Promise<void> {
    // Código de barras (síncrono).
    const bar = new Map<number, SafeHtml>();
    const alto = this.tamano() === 'S' ? 24 : this.tamano() === 'M' ? 36 : 48;
    const modulo = this.tamano() === 'S' ? 1.1 : this.tamano() === 'M' ? 1.5 : 2;
    for (const e of lista) {
      bar.set(e.id, this.sanitizer.bypassSecurityTrustHtml(code128Svg(e.codigoBarras || e.codigo, { moduloPx: modulo, altoPx: alto })));
    }
    this.barras.set(bar);
    // QR (asíncrono, con la librería qrcode cargada bajo demanda).
    try {
      const mod: { default?: unknown } & Record<string, unknown> = await import('qrcode');
      const QR = (mod.default ?? mod) as { toDataURL(text: string, opts?: Record<string, unknown>): Promise<string> };
      const mapa = new Map<number, string>();
      await Promise.all(lista.map(async e => {
        if (!e.qrContenido) return;
        try { mapa.set(e.id, await QR.toDataURL(e.qrContenido, { margin: 0, width: 320, errorCorrectionLevel: 'M' })); } catch { /* una etiqueta sin QR no rompe la hoja */ }
      }));
      this.qr.set(mapa);
    } catch { /* sin qrcode: las etiquetas salen con el placeholder */ }
  }

  imprimir(): void { window.print(); }
}
