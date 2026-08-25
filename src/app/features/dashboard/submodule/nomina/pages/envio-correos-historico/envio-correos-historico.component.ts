import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import Swal from 'sweetalert2';

import {
  EnvioCorreosService, EnvioItem, EnvioLote, EstadoEnvioItem, PeriodoDisponible,
} from '../../service/envio-correos/envio-correos.service';
import {
  VisorDocumentoComponent, VisorDocumentoData,
} from '../../components/visor-documento/visor-documento.component';

/**
 * Nómina → Envío de correos (modelo antiguo) → Histórico.
 *
 * Responde la pregunta que hoy no tiene respuesta: "¿a esta persona se le
 * mandó el desprendible de esa quincena, y a qué correo?". Cada envío quedó
 * registrado con su destinatario, su documento y su resultado.
 */
@Component({
  selector: 'app-envio-correos-historico',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule, MatButtonModule, MatCardModule, MatDialogModule, MatFormFieldModule,
    MatIconModule, MatPaginatorModule, MatProgressBarModule, MatSelectModule,
    MatTableModule, MatTooltipModule,
  ],
  templateUrl: './envio-correos-historico.component.html',
  styleUrl: './envio-correos-historico.component.css',
})
export class EnvioCorreosHistoricoComponent implements OnInit {
  private srv = inject(EnvioCorreosService);
  private titulo = inject(Title);
  private dialog = inject(MatDialog);

  readonly cargando = signal(false);
  readonly periodos = signal<PeriodoDisponible[]>([]);
  readonly lotes = signal<EnvioLote[]>([]);
  readonly totalLotes = signal(0);
  readonly pagina = signal(0);

  // Detalle del lote abierto
  readonly loteAbierto = signal<EnvioLote | null>(null);
  readonly items = signal<EnvioItem[]>([]);
  readonly totalItems = signal(0);
  readonly paginaItems = signal(0);
  readonly estadoItems = signal<string | null>(null);

  readonly periodoFiltro = signal<string | null>(null);
  readonly estadoFiltro = signal<string | null>(null);

  readonly columnasLotes = ['fecha', 'quincena', 'empresa', 'plantilla', 'totales', 'estado', 'acciones'];
  readonly columnasItems = ['cedula', 'nombre', 'correo', 'documento', 'estado', 'enviado'];

  readonly hayLotes = computed(() => this.lotes().length > 0);

  async ngOnInit(): Promise<void> {
    this.titulo.setTitle('Histórico de envíos | Envío de correos (modelo antiguo)');
    try {
      const p = await firstValueFrom(this.srv.periodos());
      this.periodos.set(p.content);
    } catch { /* el histórico funciona sin el selector */ }
    await this.consultar();
  }

  async consultar(reiniciar = false): Promise<void> {
    if (reiniciar) this.pagina.set(0);
    this.cargando.set(true);
    try {
      const r = await firstValueFrom(this.srv.listarLotesEnvio(
        this.periodoFiltro(), this.estadoFiltro(), this.pagina(), 20));
      this.lotes.set(r.content);
      this.totalLotes.set(r.total_elements);
    } catch (e: any) {
      Swal.fire({ icon: 'error', title: 'Error', text: e?.error?.error ?? 'No se pudo cargar el histórico.' });
    } finally {
      this.cargando.set(false);
    }
  }

  onPaginaLotes(e: PageEvent): void {
    this.pagina.set(e.pageIndex);
    this.consultar();
  }

  async abrir(lote: EnvioLote): Promise<void> {
    this.loteAbierto.set(lote);
    this.paginaItems.set(0);
    this.estadoItems.set(null);
    await this.cargarItems();
  }

  cerrar(): void {
    this.loteAbierto.set(null);
    this.items.set([]);
  }

  async cargarItems(): Promise<void> {
    const lote = this.loteAbierto();
    if (!lote) return;
    this.cargando.set(true);
    try {
      const r = await firstValueFrom(this.srv.itemsDelLoteEnvio(
        lote.id, this.estadoItems(), this.paginaItems(), 50));
      this.items.set(r.content);
      this.totalItems.set(r.total_elements);
    } catch {
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo cargar el detalle del envío.' });
    } finally {
      this.cargando.set(false);
    }
  }

  onPaginaItems(e: PageEvent): void {
    this.paginaItems.set(e.pageIndex);
    this.cargarItems();
  }

  /** Visor con JWT: una navegación directa a /api/v1/documents/** da 401. */
  verDocumento(item: EnvioItem): void {
    if (!item.document_id) return;
    this.dialog.open<VisorDocumentoComponent, VisorDocumentoData>(VisorDocumentoComponent, {
      data: {
        documentId: item.document_id,
        nombreArchivo: item.nombre_archivo,
        cedula: item.cedula,
        titulo: item.nombre,
      },
      width: '900px',
      maxWidth: '95vw',
    });
  }

  etiquetaEstado(estado: EstadoEnvioItem | string): string {
    const mapa: Record<string, string> = {
      PENDIENTE: 'Pendiente', ENVIADO: 'Enviado', FALLIDO: 'Fallido',
      SIN_CORREO: 'Sin correo', SIN_DOCUMENTO: 'Sin documento', OMITIDO: 'Omitido',
      PREPARADO: 'Preparado', EN_CURSO: 'En curso', COMPLETADO: 'Completado',
      CON_ERRORES: 'Con errores', CANCELADO: 'Cancelado',
    };
    return mapa[estado] ?? estado;
  }

  claseEstado(estado: string): string {
    if (estado === 'ENVIADO' || estado === 'COMPLETADO') return 'chip-ok';
    if (estado === 'OMITIDO' || estado === 'PREPARADO' || estado === 'CANCELADO') return 'chip-neutro';
    if (estado === 'EN_CURSO' || estado === 'PENDIENTE') return 'chip-info';
    return 'chip-alerta';
  }

  nombreEmpresa(v: string | null): string {
    if (v === 'APOYO_LABORAL') return 'Apoyo Laboral';
    if (v === 'ALIANZA') return 'Tu Alianza';
    return 'Ambas';
  }
}
