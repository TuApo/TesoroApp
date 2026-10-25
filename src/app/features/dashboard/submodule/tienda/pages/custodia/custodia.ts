import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { DocViewerService } from '@/app/shared/services/doc-viewer/doc-viewer.service';
import { environment } from '../../../../../../../environments/environment';
import { SelectorTienda } from '../../components/selector-tienda/selector-tienda';
import { ContextoTiendaService } from '../../service/contexto-tienda.service';
import { DocumentoCustodia, EventoCustodia, TiendaService } from '../../service/tienda.service';
import { EscanerCodigoComponent } from '@/app/shared/components/escaner-codigo/escaner-codigo.component';
import { EscaneoCustodia } from '../../components/escaneo-custodia/escaneo-custodia';

const ESTADOS: Record<string, string> = {
  PENDIENTE_FIRMA: 'Sin firmar', FIRMADO_VIRTUAL: 'Firmada electrónicamente', FIRMADO_FISICO: 'Papel firmado', ARCHIVADO: 'Archivada',
};
const EVENTOS: Record<string, string> = {
  GENERADO: 'Generada', FIRMA_VIRTUAL: 'Firmada en la app', FIRMA_EN_ENTREGA: 'Firmada en pantalla al entregar', IMPRESO: 'Impresa',
  FIRMA_FISICA: 'Firmada en papel', ENTREGA_DIGITAL: 'Entregada con firma electrónica', ESCANEADO: 'Papel escaneado',
  RECIBIDO_EN_TIENDA: 'Recibida en la tienda', ARCHIVADO: 'Archivada', PRESTADO: 'Prestada', DEVUELTO: 'Devuelta al archivo', ANULADO: 'Anulada',
};

/**
 * Custodia de las solicitudes de préstamo firmadas en papel: dónde está cada una y quién
 * responde por ella, desde que el repartidor la trae hasta la caja del archivo.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-custodia',
  imports: [CommonModule, FormsModule, MatIconModule, RouterLink, SelectorTienda, EscanerCodigoComponent, EscaneoCustodia],
  templateUrl: './custodia.html',
  styleUrls: ['../../styles/tienda-comun.css', './custodia.css'],
})
export class Custodia {
  private api = inject(TiendaService);
  private ctx = inject(ContextoTiendaService);
  private visor = inject(DocViewerService);
  readonly ESTADOS = ESTADOS;
  readonly EVENTOS = EVENTOS;
  readonly filtro = signal('POR_ARCHIVAR');
  readonly q = signal('');
  readonly lista = signal<DocumentoCustodia[]>([]);
  readonly sel = signal<(DocumentoCustodia & { eventos: EventoCustodia[]; texto: string; acta: any }) | null>(null);
  readonly ubicacion = signal('');
  readonly nota = signal('');
  readonly error = signal<string | null>(null);
  readonly cargando = signal(false);
  readonly escaneando = signal(false);
  readonly aviso = signal<string | null>(null);
  /** Candidatas para asignar a mano una hoja escaneada sin QR legible. */
  readonly candidatas = signal<DocumentoCustodia[]>([]);

  constructor() {
    this.ctx.cargar();
    effect(() => { this.ctx.tiendaId(); this.filtro(); untracked(() => this.cargar()); });
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      this.lista.set(await firstValueFrom(this.api.custodia({ tienda: this.ctx.tiendaId() ?? undefined, estado: this.filtro(), q: this.q() })));
      this.error.set(null);
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo cargar la custodia'); }
    finally { this.cargando.set(false); }
  }

  async abrir(id: string): Promise<void> {
    try { this.sel.set(await firstValueFrom(this.api.documentoCustodia(id))); this.ubicacion.set(''); this.nota.set(''); }
    catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo abrir'); }
  }

  async mover(evento: string): Promise<void> {
    const d = this.sel(); if (!d) return;
    try {
      this.sel.set(await firstValueFrom(this.api.moverCustodia(d.id, { evento, ubicacion: this.ubicacion().trim() || null, nota: this.nota().trim() || null })));
      this.ubicacion.set(''); this.nota.set(''); this.cargar();
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo registrar el movimiento'); }
  }

  /** La tienda recibe el formato firmado que trae el domiciliario. */
  async recibir(d: DocumentoCustodia): Promise<void> {
    if (!d.escaneo_doc_id && !confirm(`El formato ${d.numero} no está escaneado. ¿Recibirlo igual? (Escanéelo luego en "Digitalizar papeles")`)) return;
    try {
      await firstValueFrom(this.api.recibirPapel(d.id));
      this.aviso.set(`Recibido ${d.numero} de ${d.custodia_responsable ?? 'domiciliario'}`);
      this.cargar();
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo recibir'); }
  }

  /** Escáner continuo: cada QR de formato que pasa queda recibido. */
  readonly recibirEscaneando = async (codigo: string): Promise<{ ok: boolean; texto: string; detalle?: string }> => {
    try {
      const d = await firstValueFrom(this.api.recibirPapelQr(codigo));
      this.cargar();
      return { ok: true, texto: `Recibido ${d.numero}`, detalle: d.nombre ?? undefined };
    } catch (e: any) { return { ok: false, texto: e?.error?.error ?? 'No se pudo recibir', detalle: codigo }; }
  };

  async abrirEscaneo(): Promise<void> {
    this.escaneando.set(true);
    try {
      const [fis, vir, pend] = await Promise.all(['FIRMADO_FISICO', 'FIRMADO_VIRTUAL', 'PENDIENTE_FIRMA'].map(e =>
        firstValueFrom(this.api.custodia({ tienda: this.ctx.tiendaId() ?? undefined, estado: e }))));
      this.candidatas.set([...fis, ...vir, ...pend]);
    } catch { this.candidatas.set(this.lista()); }
  }

  ver(docId: string | null | undefined): void {
    if (docId) this.visor.openInNewTab(`${environment.apiUrl}/api/v1/documents/${docId}/download`);
  }
}
