import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { DocViewerService } from '@/app/shared/services/doc-viewer/doc-viewer.service';
import { environment } from '../../../../../../../environments/environment';
import { reducir } from '../../../../../economiapp/components/eco-captura-rostro';
import { CasoPedido, TiendaService } from '../../service/tienda.service';
import { utc } from '../../util/alerta-nuevos';
import { compromiso, franjaAcordada } from '../../util/fechas-entrega';

const CATEGORIAS: Record<string, string> = {
  cliente_no_contesta: 'El cliente no contesta', direccion_errada: 'Dirección errada o incompleta', cliente_ausente: 'No había nadie',
  reprogramacion: 'Hay que reprogramar', entrega_fallida: 'Entrega fallida', demora_domicilio: 'Demora en el domicilio',
  producto_faltante: 'Falta un producto', producto_danado: 'Producto dañado', reclamo_cliente: 'Reclamo / PQRS del cliente',
  cobro_o_pago: 'Cobro o pago', otro: 'Otro',
};
const ICONOS: Record<string, string> = { ESTADO: 'flag', TRAZA: 'history', CONTACTO: 'call', RUTA: 'two_wheeler', EVIDENCIA: 'photo_camera', CASO: 'report' };

/**
 * El caso de un pedido: todo lo que le pasó en orden (estados, quién lo alistó, quién lo
 * tomó, llamadas, llegada, fallos, acta), las fotos y videos con su huella, y los casos
 * abiertos para averiguar qué está pasando. Los casos son internos: la persona no los ve.
 */
@Component({
  selector: 'app-caso-pedido',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './caso-pedido.html',
  styleUrls: ['../../styles/tienda-comun.css', './caso-pedido.css'],
})
export class CasoPedidoPanel {
  private api = inject(TiendaService);
  private visor = inject(DocViewerService);
  readonly pedidoId = input.required<string>();
  readonly cerrar = output<void>();

  readonly datos = signal<CasoPedido | null>(null);
  readonly error = signal<string | null>(null);
  readonly ocupado = signal(false);
  readonly abriendo = signal(false);
  readonly categoria = signal('cliente_no_contesta');
  readonly prioridad = signal('MEDIA');
  readonly descripcion = signal('');
  readonly foto = signal<string | null>(null);
  readonly notas = signal<Record<string, string>>({});
  readonly CATEGORIAS = CATEGORIAS;
  readonly ICONOS = ICONOS;
  readonly utc = utc;

  readonly compromiso = computed(() => compromiso(this.datos()?.fecha_compromiso));
  readonly franja = computed(() => { const d = this.datos(); return d?.hora_confirmada_en ? franjaAcordada(d.programado_en, d.programado_hasta) : null; });
  readonly abiertos = computed(() => (this.datos()?.casos ?? []).filter(c => ['ABIERTO', 'EN_PROCESO', 'ESPERANDO_CLIENTE'].includes(c.estado)).length);

  constructor() {
    effect(() => { const id = this.pedidoId(); untracked(() => this.cargar(id)); });
  }

  async cargar(id = this.pedidoId()): Promise<void> {
    try { this.datos.set(await firstValueFrom(this.api.casoPedido(id))); this.error.set(null); }
    catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo cargar el caso'); }
  }

  async subirFoto(ev: Event): Promise<void> {
    const f = (ev.target as HTMLInputElement).files?.[0]; if (!f) return;
    this.ocupado.set(true);
    try {
      const r = await firstValueFrom(this.api.subirEvidencia(this.pedidoId(), 'CASO', await reducir(f, 1800), 'caso.jpg'));
      this.foto.set(r.doc_id);
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo subir la foto'); }
    finally { this.ocupado.set(false); (ev.target as HTMLInputElement).value = ''; }
  }

  async abrir(): Promise<void> {
    if (!this.descripcion().trim()) return;
    this.ocupado.set(true); this.error.set(null);
    try {
      this.datos.set(await firstValueFrom(this.api.abrirCaso(this.pedidoId(), {
        categoria: this.categoria(), prioridad: this.prioridad(), descripcion: this.descripcion().trim(), evidencia_doc_id: this.foto() })));
      this.abriendo.set(false); this.descripcion.set(''); this.foto.set(null);
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo abrir el caso'); }
    finally { this.ocupado.set(false); }
  }

  async nota(casoId: string, cerrar = false): Promise<void> {
    const t = (this.notas()[casoId] ?? '').trim(); if (!t) return;
    this.ocupado.set(true); this.error.set(null);
    try {
      await firstValueFrom(cerrar ? this.api.cerrarCaso(casoId, t) : this.api.notaCaso(casoId, t));
      this.notas.update(n => ({ ...n, [casoId]: '' }));
      await this.cargar();
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo guardar'); }
    finally { this.ocupado.set(false); }
  }

  ponerNota(id: string, v: string): void { this.notas.update(n => ({ ...n, [id]: v })); }
  ver(docId: string | null | undefined): void {
    if (docId) this.visor.openInNewTab(`${environment.apiUrl}/api/v1/documents/${docId}/download`);
  }
  esVideo(e: { tipo: string; mime: string | null }): boolean { return e.tipo.startsWith('VIDEO') || (e.mime ?? '').startsWith('video'); }
  nombreCategoria(c: string): string { return CATEGORIAS[c] ?? c.replace(/_/g, ' '); }
  categorias(): string[] { return this.datos()?.categorias?.length ? this.datos()!.categorias : Object.keys(CATEGORIAS); }
}
