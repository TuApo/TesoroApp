import {
  ChangeDetectionStrategy, Component, OnInit, effect, inject, signal, viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import Swal from 'sweetalert2';

import {
  ColumnaTabla, TABLA_ESTANDAR, TablaEstandarComponent, TonoBadge,
} from '../../../../../../shared/components/tabla-estandar';
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
    MatIconModule, MatProgressBarModule, MatSelectModule, MatTooltipModule,
    ...TABLA_ESTANDAR,
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
  readonly tamanoLotes = signal(20);

  // Detalle del lote abierto
  readonly loteAbierto = signal<EnvioLote | null>(null);
  readonly items = signal<EnvioItem[]>([]);
  readonly totalItems = signal(0);
  readonly paginaItems = signal(0);
  readonly tamanoItems = signal(50);
  readonly estadoItems = signal<string | null>(null);

  readonly periodoFiltro = signal<string | null>(null);
  readonly estadoFiltro = signal<string | null>(null);

  // Tablas en modo servidor: el backend pagina, pero no busca ni ordena.
  readonly columnasLotes: ColumnaTabla<EnvioLote>[] = [
    { id: 'fecha', header: 'Fecha', valor: (l) => (l.creado_en ? new Date(l.creado_en) : null),
      ordenable: false, tarjeta: 'meta' },
    { id: 'quincena', header: 'Quincena', valor: (l) => l.periodo_etiqueta ?? '', ordenable: false, tarjeta: 'titulo' },
    { id: 'empresa', header: 'Empresa', valor: (l) => this.nombreEmpresa(l.empresa), ordenable: false, tarjeta: 'subtitulo' },
    { id: 'plantilla', header: 'Plantilla', valor: (l) => l.plantilla_nombre ?? '',
      formato: (l) => l.plantilla_nombre || '—', ordenable: false, prioridad: 2, tarjeta: 'meta' },
    { id: 'totales', header: 'Resultado', ordenable: false, tarjeta: 'cuerpo',
      valor: (l) => [
        `${l.total_enviados} enviados`,
        l.total_fallidos > 0 ? `${l.total_fallidos} fallidos` : '',
        l.total_omitidos > 0 ? `${l.total_omitidos} sin enviar` : '',
      ].filter(Boolean).join(' · ') },
    { id: 'estado', header: 'Estado', valor: (l) => this.etiquetaEstado(l.estado), ordenable: false, tarjeta: 'badge',
      badge: (l) => ({ texto: this.etiquetaEstado(l.estado), tono: this.tonoEstado(l.estado) }) },
  ];

  readonly columnasItems: ColumnaTabla<EnvioItem>[] = [
    { id: 'cedula', header: 'Cédula', valor: (i) => i.cedula, ordenable: false, tarjeta: 'subtitulo' },
    { id: 'nombre', header: 'Nombre', valor: (i) => i.nombre ?? '', ordenable: false, tarjeta: 'titulo' },
    { id: 'correo', header: 'Correo', valor: (i) => i.correo ?? '', ordenable: false, tarjeta: 'cuerpo' },
    { id: 'documento', header: 'Documento', valor: (i) => (i.document_id ? i.nombre_archivo ?? 'Sí' : ''),
      ordenable: false, interactiva: true, prioridad: 2, tarjeta: 'meta' },
    // El motivo va en el valor: es lo que se busca en el Excel cuando alguien reclama.
    { id: 'estado', header: 'Estado', ordenable: false, tarjeta: 'badge',
      valor: (i) => [this.etiquetaEstado(i.estado), i.motivo].filter(Boolean).join(' — ') },
    { id: 'enviado', header: 'Enviado', valor: (i) => (i.enviado_en ? new Date(i.enviado_en) : null),
      ordenable: false, prioridad: 2, tarjeta: 'meta' },
  ];

  readonly idLote = (l: EnvioLote) => l.id;
  readonly idItem = (i: EnvioItem) => i.id;

  /**
   * La tabla estándar guarda su página; la de la pantalla manda. Se sincroniza
   * al reiniciar por un filtro y cuando la tabla se vuelve a crear (al volver
   * del detalle de un lote a la lista).
   */
  private readonly tablaLotes = viewChild<TablaEstandarComponent>('tablaLotes');
  private readonly tablaItems = viewChild<TablaEstandarComponent>('tablaItems');

  constructor() {
    effect(() => this.tablaLotes()?.pagina.set(this.pagina()));
    effect(() => this.tablaItems()?.pagina.set(this.paginaItems()));
  }

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
        this.periodoFiltro(), this.estadoFiltro(), this.pagina(), this.tamanoLotes()));
      this.lotes.set(r.content);
      this.totalLotes.set(r.total_elements);
    } catch (e: any) {
      Swal.fire({ icon: 'error', title: 'Error', text: e?.error?.error ?? 'No se pudo cargar el histórico.' });
    } finally {
      this.cargando.set(false);
    }
  }

  onPaginaLotes(e: { pagina: number; porPagina: number }): void {
    this.pagina.set(e.pagina);
    this.tamanoLotes.set(e.porPagina);
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
        lote.id, this.estadoItems(), this.paginaItems(), this.tamanoItems()));
      this.items.set(r.content);
      this.totalItems.set(r.total_elements);
    } catch {
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo cargar el detalle del envío.' });
    } finally {
      this.cargando.set(false);
    }
  }

  onPaginaItems(e: { pagina: number; porPagina: number }): void {
    this.paginaItems.set(e.pagina);
    this.tamanoItems.set(e.porPagina);
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

  /** Mismo criterio que {@link claseEstado}, con los tonos de la tabla estándar. */
  tonoEstado(estado: string): TonoBadge {
    if (estado === 'ENVIADO' || estado === 'COMPLETADO') return 'ok';
    if (estado === 'OMITIDO' || estado === 'PREPARADO' || estado === 'CANCELADO') return 'neutro';
    if (estado === 'EN_CURSO' || estado === 'PENDIENTE') return 'info';
    return 'danger';
  }

  nombreEmpresa(v: string | null): string {
    if (v === 'APOYO_LABORAL') return 'Apoyo Laboral';
    if (v === 'ALIANZA') return 'Tu Alianza';
    return 'Ambas';
  }
}
