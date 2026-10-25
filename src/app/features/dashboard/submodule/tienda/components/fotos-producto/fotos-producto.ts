import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { FotosIa } from '../fotos-ia/fotos-ia';
import { ContextoTiendaService } from '../../service/contexto-tienda.service';
import { firstValueFrom } from 'rxjs';

import { DocViewerService } from '@/app/shared/services/doc-viewer/doc-viewer.service';
import { environment } from '../../../../../../../environments/environment';
import { reducir } from '../../../../../economiapp/components/eco-captura-rostro';
import { ImagenProducto, TiendaService } from '../../service/tienda.service';
import { MEJORA_POR_DEFECTO, OpcionesMejora, mejorarFoto } from '../../util/mejorar-foto';

interface Pendiente { id: string; nombre: string; original: Blob; mejorada: Blob | null; urlOriginal: string; urlMejorada: string | null; usarMejorada: boolean; procesando: boolean }

/**
 * Las fotos públicas de un producto: varias, con la principal (la de la vitrina) marcada,
 * y antes de subir una opción de mejorarlas — luz, color, nitidez y fondo blanco — con
 * vista de antes y después para que quien publica decida.
 */
@Component({
  selector: 'app-fotos-producto',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, FotosIa],
  templateUrl: './fotos-producto.html',
  styleUrls: ['../../styles/tienda-comun.css', './fotos-producto.css'],
})
export class FotosProducto {
  private api = inject(TiendaService);
  private visor = inject(DocViewerService);
  readonly productoId = input.required<string>();
  readonly editable = input(true);

  readonly fotos = signal<ImagenProducto[]>([]);
  readonly miniaturas = signal<Record<string, string>>({});
  readonly pendientes = signal<Pendiente[]>([]);
  readonly opciones = signal<OpcionesMejora>({ ...MEJORA_POR_DEFECTO });
  readonly mejorar = signal(true);
  readonly comparando = signal<string | null>(null);
  readonly subiendo = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);
  readonly procesando = computed(() => this.pendientes().some(p => p.procesando));
  readonly verIa = signal(false);
  /** Modo de la tienda: NORMAL publica tal cual, MEJORA_BASICA mejora en el navegador, IA abre la mejora con IA tras subir. */
  readonly modoTienda = signal<string>('MEJORA_BASICA');
  private ctx = inject(ContextoTiendaService);

  constructor() {
    effect(() => { const id = this.productoId(); untracked(() => { this.descartar(); this.cargar(id); }); });
    effect(() => {
      const t = this.ctx.tiendaId();
      untracked(() => { if (t) firstValueFrom(this.api.configFotos(t)).then(c => {
        this.modoTienda.set(c.modo_subida); this.mejorar.set(c.modo_subida !== 'NORMAL');
      }).catch(() => {}); });
    });
    inject(DestroyRef).onDestroy(() => this.descartar());
  }

  async cargar(id: string): Promise<void> {
    if (!id) return;
    try {
      const fs = await firstValueFrom(this.api.imagenesProducto(id));
      this.fotos.set([...fs].sort((a, b) => Number(b.principal) - Number(a.principal) || (a.orden ?? 0) - (b.orden ?? 0)));
      for (const f of fs) if (!this.miniaturas()[f.doc_id]) {
        this.visor.toBlobUrl(this.url(f.doc_id)).then(u => { if (u) this.miniaturas.update(m => ({ ...m, [f.doc_id]: u })); });
      }
    } catch { this.fotos.set([]); }
  }

  async elegir(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const archivos = Array.from(input.files ?? []).filter(a => a.type.startsWith('image/'));
    input.value = '';
    if (this.fotos().length + this.pendientes().length + archivos.length > 20) {
      this.error.set('Máximo 20 fotos por producto.'); return;
    }
    this.error.set(null); this.aviso.set(null);
    const nuevas: Pendiente[] = [];
    for (const a of archivos) {
      const original = await reducir(a, 1800);
      nuevas.push({ id: crypto.randomUUID(), nombre: a.name || 'foto.jpg', original, mejorada: null,
        urlOriginal: URL.createObjectURL(original), urlMejorada: null, usarMejorada: true, procesando: this.mejorar() });
    }
    this.pendientes.update(p => [...p, ...nuevas]);
    if (this.mejorar()) for (const p of nuevas) this.procesar(p.id);
  }

  /** Vuelve a revelar todas con las opciones actuales (al cambiar una casilla). */
  reprocesar(): void {
    if (!this.mejorar()) return;
    for (const p of this.pendientes()) this.procesar(p.id);
  }

  private async procesar(id: string): Promise<void> {
    const p = this.pendientes().find(x => x.id === id); if (!p) return;
    this.cambiar(id, { procesando: true });
    try {
      const b = await mejorarFoto(p.original, this.opciones());
      const anterior = this.pendientes().find(x => x.id === id)?.urlMejorada;
      if (anterior) URL.revokeObjectURL(anterior);
      this.cambiar(id, { mejorada: b, urlMejorada: URL.createObjectURL(b), procesando: false });
    } catch {
      this.cambiar(id, { mejorada: null, urlMejorada: null, usarMejorada: false, procesando: false });
    }
  }

  ponerOpcion(k: keyof OpcionesMejora, v: boolean): void {
    this.opciones.update(o => ({ ...o, [k]: v }));
    this.reprocesar();
  }

  ponerMejorar(v: boolean): void {
    this.mejorar.set(v);
    if (v) for (const p of this.pendientes()) if (!p.mejorada) this.procesar(p.id);
  }

  cambiar(id: string, c: Partial<Pendiente>): void { this.pendientes.update(l => l.map(p => p.id === id ? { ...p, ...c } : p)); }

  quitarPendiente(id: string): void {
    const p = this.pendientes().find(x => x.id === id);
    if (p) { URL.revokeObjectURL(p.urlOriginal); if (p.urlMejorada) URL.revokeObjectURL(p.urlMejorada); }
    this.pendientes.update(l => l.filter(x => x.id !== id));
  }

  descartar(): void { for (const p of this.pendientes()) this.quitarPendiente(p.id); }

  vaMejorada(p: Pendiente): boolean { return this.mejorar() && p.usarMejorada && !!p.mejorada; }

  async subir(): Promise<void> {
    const id = this.productoId(); const lista = this.pendientes(); if (!lista.length) return;
    this.subiendo.set(true); this.error.set(null);
    try {
      const docs: string[] = [];
      for (const p of lista) {
        const blob = this.vaMejorada(p) ? p.mejorada! : p.original;
        docs.push(await firstValueFrom(this.api.subirArchivo(blob, p.nombre.replace(/\.\w+$/, '') + '.jpg', id, 'STORE_PRODUCTO')));
      }
      const r = await firstValueFrom(this.api.fijarFotosProducto(id, docs, false));
      this.aviso.set(`${r.agregadas} foto${r.agregadas === 1 ? '' : 's'} publicada${r.agregadas === 1 ? '' : 's'}. El producto queda con ${r.total}.`);
      this.descartar();
      await this.cargar(id);
      if (this.modoTienda() === 'IA') this.verIa.set(true);
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudieron subir las fotos'); }
    finally { this.subiendo.set(false); }
  }

  async principal(f: ImagenProducto): Promise<void> {
    try { await firstValueFrom(this.api.principalImagenProducto(this.productoId(), f.id)); await this.cargar(this.productoId()); }
    catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo cambiar la principal'); }
  }

  async quitar(f: ImagenProducto): Promise<void> {
    if (!confirm('¿Quitar esta foto del producto? Deja de verse en la tienda.')) return;
    try { await firstValueFrom(this.api.quitarImagenProducto(this.productoId(), f.id)); await this.cargar(this.productoId()); }
    catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo quitar la foto'); }
  }

  ver(f: ImagenProducto): void { this.visor.openInNewTab(this.url(f.doc_id)); }
  private url(doc: string): string { return `${environment.apiUrl}/api/v1/documents/${doc}/download`; }
}
