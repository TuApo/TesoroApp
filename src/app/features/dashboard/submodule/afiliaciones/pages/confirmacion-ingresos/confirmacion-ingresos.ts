import {
  Component, ChangeDetectionStrategy, ChangeDetectorRef, OnDestroy, inject, signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule, formatDate } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Observable, firstValueFrom } from 'rxjs';

import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';

import {
  ColumnaTabla, TABLA_ESTANDAR
} from '../../../../../../shared/components/tabla-estandar';
import { AfiliacionesFiltersBarComponent } from '../../components/filters/afiliaciones-filters-bar.component';
import { SelectionModel } from '@angular/cdk/collections';
import { PegadoMasivoDialogComponent } from '../../components/pegado-masivo/pegado-masivo-dialog.component';
import { DatosAfiliacionDialogComponent } from '../../components/datos-afiliacion/datos-afiliacion-dialog.component';
import { AfiliacionesGestionService, BaseFechaGestion } from '../../services/afiliaciones-gestion.service';
import { AfiliacionPdfService } from '../../services/afiliacion-pdf.service';
import { etiquetaRegimenAdres, regimenAdresClass } from '../../models/regimen-adres';
import { PlantillaEpsService } from '../../services/plantilla-eps.service';
import { DiagnosticoGeneracion, EstadoDocumentoEps } from '../../models/plantilla-eps.models';
import { TramiteEpsService, EtapaTramite } from '../../services/tramite-eps.service';
import { TramiteEpsPanelComponent } from '../../components/tramite-eps/tramite-eps-panel.component';
import {
  DiagnosticoEpsDialogComponent, DiagnosticoEpsDialogData, DiagnosticoEpsDialogResult
} from '../../components/diagnostico-eps/diagnostico-eps-dialog.component';
import {
  ContratacionRow, CasoDetalle, CedulaDoc, MasivoResult, Validador, Canal,
  Expediente, DocumentoExpediente, GrupoDoc
} from '../../models/afiliaciones-dashboard.models';

/** 'aaaa-mm-dd' (o ISO con hora) → Date local, igual que el DatePipe; así ordena como fecha. */
function aFecha(v: string | null | undefined): Date | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/** dd/MM/aaaa, o '-' si no hay fecha. */
function fechaCorta(v: string | null | undefined): string {
  const d = aFecha(v);
  return d ? formatDate(d, 'dd/MM/yyyy', 'en-US') : '-';
}

/** El backend no ordena por columna: ninguna columna ofrece orden en la tabla. */
function sinOrden<T>(cols: ColumnaTabla<T>[]): ColumnaTabla<T>[] {
  return cols.map(c => ({ ...c, ordenable: false }));
}

/** Cómo se puede pintar un documento en línea. */
type PreviewKind = 'pdf' | 'imagen' | 'otro';

/** Estado de la vista previa de un documento dentro de la ficha. */
interface PreviewDoc {
  abierto: boolean;
  cargando: boolean;
  error?: boolean;
  mime: string;
  kind: PreviewKind;
  objectUrl?: string;
  safeUrl?: SafeResourceUrl;
}

/**
 * Gestión de Afiliaciones — Confirmación de Ingreso.
 *
 * Control diario del personal cuyo ingreso ya llegó (gate `listo`): tabla multiselección con
 * las 4 banderas de validación (Afiliaciones / Coordinador de finca / Nómina / Pago de
 * seguridad social), acciones individuales y MASIVAS por canal (llamada/correo/whatsapp),
 * panel de detalle con todos los datos + historial de intentos + ver la cédula subida.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-confirmacion-ingresos',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatCheckboxModule, MatButtonModule, MatIconModule, MatChipsModule,
    MatTooltipModule, MatSelectModule, MatFormFieldModule, MatInputModule,
    MatSlideToggleModule, MatButtonToggleModule, MatSnackBarModule, MatProgressBarModule,
    MatDialogModule, MatMenuModule,
    AfiliacionesFiltersBarComponent, TramiteEpsPanelComponent,
    ...TABLA_ESTANDAR
  ],
  templateUrl: './confirmacion-ingresos.html',
  styleUrl: './confirmacion-ingresos.css'
})
export class ConfirmacionIngresos implements OnDestroy {
  private svc = inject(AfiliacionesGestionService);
  private pdf = inject(AfiliacionPdfService);
  private plantillaSvc = inject(PlantillaEpsService);
  private tramiteSvc = inject(TramiteEpsService);
  private snack = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private sanitizer = inject(DomSanitizer);
  private cdr = inject(ChangeDetectorRef);

  tablePage$ = this.svc.tablePage$;
  page$ = this.svc.page$;
  soloListos$ = this.svc.soloListos$;
  baseFecha$ = this.svc.baseFecha$;
  oficinas$ = this.svc.oficinasDisponibles$;
  responsables$ = this.svc.responsablesDisponibles$;
  empresasUsuarias$ = this.svc.empresasUsuariasDisponibles$;

  // Selección persistente entre páginas (por candidato_id).
  selected = new Set<number>();
  /**
   * Selección del estándar (la casilla va pegada al «#», anclada como él).
   * El `Set` de arriba sigue siendo la memoria: en modo servidor las filas
   * cambian con cada página y el estándar suelta las que ya no están, así que
   * al llegar una página nueva se vuelven a marcar las que ya se habían
   * elegido antes.
   */
  readonly sel = new SelectionModel<ContratacionRow>(true, []);
  /** Cuántas hay marcadas, para la plantilla (el `Set` se muta y no avisa). */
  readonly marcadas = signal(0);
  private sincronizando = false;

  // Estado de la barra de acciones masivas.
  validadorSel: Validador = 'AFILIACIONES';
  canalSel: Canal = 'LLAMADA';
  resultadoSel = 'CONTACTADO';
  notaBulk = '';
  saving = false;

  // Panel de detalle.
  detailRow: ContratacionRow | null = null;
  caso$: Observable<CasoDetalle> | null = null;
  detailCanal: Canal = 'LLAMADA';
  detailNota = '';
  docLoading = false;

  // ── Listado en la tabla estándar (modo servidor) ───────────────────
  //
  // La vista tabla ⇄ tarjetas (vCard) la da la tabla estándar, recordada por pantalla; arranca
  // en tarjetas. El backend pagina y filtra, pero no ordena por columna ni busca por texto
  // desde la tabla (la búsqueda está en la barra de filtros), así que ninguna columna ordena.

  // La página la sincroniza la propia tabla con el input `paginaServidor` (lo aplica con
  // `untracked` para no realimentarse). Antes se hacía desde aquí, con un effect que escribía
  // en el signo interno `pagina` de la tabla en CADA emisión de `page$`: dos dueños para el
  // mismo estado, y el paginador se quedaba clavado en la primera página.

  readonly columnas: ColumnaTabla<ContratacionRow>[] = sinOrden<ContratacionRow>([
    { id: 'numero_documento', header: 'Documento', valor: r => r.numero_documento ?? '',
      formato: r => r.numero_documento || '-' },
    { id: 'nombre_completo', header: 'Nombre', valor: r => r.nombre_completo ?? '', minAncho: '180px' },
    { id: 'empresa', header: 'Empresa', valor: r => r.empresa ?? '' },
    { id: 'empresa_usuaria', header: 'Empresa usuaria', valor: r => r.empresa_usuaria ?? '', prioridad: 2 },
    { id: 'oficina', header: 'Oficina', valor: r => r.oficina ?? '' },
    { id: 'finca', header: 'Finca / CC', valor: r => r.finca || r.centro_costo || '',
      formato: r => r.finca || r.centro_costo || '-', prioridad: 2 },
    { id: 'fecha_firma_contrato', header: 'Contratación', valor: r => aFecha(r.fecha_firma_contrato),
      formato: r => fechaCorta(r.fecha_firma_contrato), prioridad: 2 },
    { id: 'fecha_ingreso', header: 'Ingreso', valor: r => aFecha(r.fecha_ingreso),
      formato: r => fechaCorta(r.fecha_ingreso) },
    // EPS del contrato: es la que decide qué formato de afiliación se genera. La de ADRES,
    // que ya estaba, dice dónde figura la persona HOY y puede no coincidir.
    { id: 'eps', header: 'EPS', valor: r => r.eps ?? '', formato: r => r.eps || '-', prioridad: 2 },
    { id: 'afp', header: 'AFP', valor: r => r.afp ?? '', formato: r => r.afp || '-', prioridad: 3 },
    { id: 'adres_eps', header: 'EPS (ADRES)', valor: r => r.adres_eps ?? '', formato: r => r.adres_eps || '-', prioridad: 3 },
    { id: 'adres_estado', header: 'Estado (ADRES)', valor: r => r.adres_estado ?? '', prioridad: 3 },
    { id: 'adres_regimen', header: 'Régimen (ADRES)', valor: r => etiquetaRegimenAdres(r.adres_regimen), prioridad: 3 },
    { id: 'traslado', header: 'Traslado EPS', prioridad: 3,
      valor: r => (r.resumen?.traslado_codigo ? (r.resumen.traslado_estado || 'Sin estado') : '') },
    { id: 'docs', header: 'Docs', prioridad: 3,
      valor: r => (r.resumen
        ? `Cédula ${r.resumen.docs_cedula} · ADRES ${r.resumen.docs_adres} · Traslado ${r.resumen.docs_traslado}`
        : '') },
    { id: 'contacto', header: 'Contacto', valor: r => [r.celular, r.correo].filter(Boolean).join(' · '), prioridad: 2 },
    { id: 'v1', header: 'Afil.', valor: r => !!r.ingreso_confirmado, align: 'center' },
    { id: 'v2', header: 'Coord.', valor: r => !!r.coord_confirmado, align: 'center' },
    { id: 'v3', header: 'Nóm.', valor: r => !!r.nomina_confirmado, align: 'center' },
    { id: 'v4', header: 'Pago seg.', valor: r => !!r.pago_confirmado, align: 'center' },
  ]);

  readonly idFila = (r: ContratacionRow) => r.id;

  /**
   * Resalta las filas marcadas. La tabla no se entera de cambios dentro del `Set`, así que la
   * función se recrea al marcar o desmarcar (ver `repintarSeleccion`).
   */
  claseFila = this.crearClaseFila();
  private crearClaseFila() {
    return (r: ContratacionRow) => (this.isSelected(r) ? 'te-fila--destacada' : '');
  }
  private repintarSeleccion() { this.claseFila = this.crearClaseFila(); }

  // ── Generación del formato de afiliación (PDF) ─────────────────────

  /**
   * Filas de la página visible, por candidato. El PDF masivo las reusa para no volver a pedir al
   * servidor a quien ya está en pantalla (la selección sobrevive al cambio de página, así que las
   * que falten sí se piden una a una).
   */
  private filasEnPantalla = new Map<number, ContratacionRow>();
  pdfGenerando = false;

  constructor() {
    this.escucharSeleccion();
    this.tablePage$.pipe(takeUntilDestroyed()).subscribe(p => {
      this.filasEnPantalla = new Map(
        (p.rows || []).filter(r => r.candidato_id != null).map(r => [r.candidato_id!, r]));
      this.repescarSeleccion(p.rows || []);
      this.refrescarEstadoEps((p.rows || []).map(r => r.id).filter(id => id != null));
    });
  }

  // ── Estado del documento EPS por fila: rojo / amarillo / verde ─────────

  /** proceso_id → estado. Se pide por página visible y se refresca tras generar. */
  readonly estadoEps = signal(new Map<number, EstadoDocumentoEps>());

  refrescarEstadoEps(ids: number[]) {
    if (!ids.length) return;
    this.plantillaSvc.estadoDocumentos(ids).subscribe({
      next: lista => {
        const m = new Map(this.estadoEps());
        for (const e of lista) m.set(e.procesoId, e);
        this.estadoEps.set(m);
        this.cdr.markForCheck();
      },
      error: () => { /* sin estado: el botón queda en su color neutro */ },
    });
  }

  /**
   * Color del botón: mientras no hay trámite, el del documento (rojo / amarillo / verde);
   * con trámite abierto, el de su etapa (azul remitido, naranja con respuesta, verde oscuro
   * afiliado, rojo oscuro rechazado). "Por remitir" conserva el verde del documento.
   */
  claseDocEps(row: ContratacionRow): string {
    const e = this.estadoEps().get(row.id);
    if (!e) return 'doc-eps';
    if (e.tramiteEstado && e.tramiteEstado !== 'POR_ENVIAR') return 'doc-eps doc-eps--t-' + e.tramiteEstado.toLowerCase().replace('_', '-');
    return 'doc-eps doc-eps--' + e.estado.toLowerCase().replace('_', '-');
  }

  private static readonly ETIQUETA_TRAMITE: Record<string, string> = {
    POR_ENVIAR: 'trámite abierto, por remitir', RADICADA: 'remitido a la EPS', CON_RESPUESTA: 'con respuesta de la EPS',
    CONFIRMADA: 'afiliado', RECHAZADA: 'rechazado por la EPS',
  };

  tooltipDocEps(row: ContratacionRow): string {
    const e = this.estadoEps().get(row.id);
    if (!e) return 'Generar documento EPS (plantilla parametrizada)';
    const tram = e.tramiteEstado ? ` · Trámite: ${ConfirmacionIngresos.ETIQUETA_TRAMITE[e.tramiteEstado] ?? e.tramiteEstado} (detalle en «Ver»)` : '';
    return this.tooltipDocumento(e) + tram;
  }

  private tooltipDocumento(e: EstadoDocumentoEps): string {
    if (e.estado === 'GENERADO') {
      const fecha = e.generadoAt ? formatDate(e.generadoAt, 'dd/MM/yyyy HH:mm', 'es-CO') : '';
      return `Documento EPS generado${e.veces > 1 ? ` ${e.veces} veces` : ''} · último ${fecha}`
        + (e.generadoPor ? ` por ${e.generadoPor}` : '')
        + (e.puedeGenerar ? '. Clic para generarlo de nuevo.' : `. Hoy no se puede regenerar: ${e.motivo}`);
    }
    if (e.estado === 'PUEDE') return `Listo para generar (${e.plantillaNombre})`;
    return `No se puede generar: ${e.motivo}`;
  }

  // ── Soportes EPS en lote ────────────────────────────────────────────────

  etapaLote: EtapaTramite = 'REMISION';

  /**
   * Sube varios archivos a la vez a los trámites de los contratos marcados: cada archivo va al
   * de la cédula que trae en el nombre. En tandas de 12 MB (tope de ms-hr por petición).
   */
  async subirLote(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const archivos = Array.from(input.files ?? []);
    input.value = '';
    if (!archivos.length) return;
    if (!this.selected.size) { this.snack.open('Marca primero los contratos del lote', 'Cerrar', { duration: 4000 }); return; }
    this.pdfGenerando = true;
    this.cdr.markForCheck();
    try {
      const rows = await firstValueFrom(this.svc.cargarFilas(this.selectedIds, this.filasEnPantalla));
      const procesos = rows.map(r => r.id).filter(id => id != null);
      let cargados = 0;
      const detalles: string[] = [];
      for (const tanda of TramiteEpsService.tandas(archivos)) {
        const r = await firstValueFrom(this.tramiteSvc.subirLote(procesos, this.etapaLote, tanda, null, true));
        cargados += r.cargados;
        detalles.push(...r.detalles);
      }
      this.refrescarEstadoEps(procesos);
      this.snack.open(`${cargados} de ${archivos.length} soporte(s) cargado(s)`
        + (detalles.length ? ` · ${detalles.slice(0, 3).join(' · ')}${detalles.length > 3 ? ` (+${detalles.length - 3})` : ''}` : ''),
        'Cerrar', { duration: detalles.length ? 12000 : 4000 });
      if (detalles.length) console.warn('[soportes EPS en lote]', detalles);
    } catch (err) {
      const e = (err as { error?: { error?: string } })?.error?.error;
      this.snack.open(e || 'No se pudieron subir los soportes', 'Cerrar', { duration: 6000 });
    } finally {
      this.pdfGenerando = false;
      this.cdr.markForCheck();
    }
  }

  /** Cuántos de los marcados están en cada estado (para el botón masivo). */
  resumenEstadoSeleccion(): { rojo: number; amarillo: number; verde: number } {
    const r = { rojo: 0, amarillo: 0, verde: 0 };
    for (const row of this.filasEnPantalla.values()) {
      if (row.candidato_id == null || !this.selected.has(row.candidato_id)) continue;
      const e = this.estadoEps().get(row.id);
      if (!e) continue;
      if (e.estado === 'NO_PUEDE') r.rojo++; else if (e.estado === 'PUEDE') r.amarillo++; else r.verde++;
    }
    return r;
  }

  /** Formato de una persona: la fila ya trae todo, no hace falta ir al servidor. */
  generarPdfFila(row: ContratacionRow) {
    if (this.pdfGenerando) return;
    this.pdfGenerando = true;
    this.pdf.generarIndividual(row, { usuario: this.usuarioActual() })
      .then(() => this.snack.open('Formato de afiliación generado', 'Cerrar', { duration: 3000 }))
      .catch(() => this.snack.open('No se pudo generar el PDF', 'Cerrar', { duration: 4000 }))
      .finally(() => { this.pdfGenerando = false; this.cdr.markForCheck(); });
  }

  /** Formato masivo de lo que esté seleccionado en la tabla. */
  generarPdfSeleccion() {
    if (!this.selected.size || this.pdfGenerando) return;
    const ids = this.selectedIds;
    const tope = AfiliacionesGestionService.MAX_FILAS_PDF;
    const pedidos = ids.slice(0, tope);
    if (ids.length > tope) {
      this.snack.open(
        `Se seleccionaron ${ids.length}; el PDF se genera con los primeros ${tope}`,
        'Cerrar', { duration: 6000 });
    }

    this.pdfGenerando = true;
    this.cdr.markForCheck();
    this.svc.cargarFilas(pedidos, this.filasEnPantalla).subscribe({
      next: rows => this.emitirPdf(rows, pedidos.length, 'Selección de la tabla'),
      error: () => {
        this.pdfGenerando = false;
        this.snack.open('No se pudieron cargar los datos para el PDF', 'Cerrar', { duration: 4000 });
        this.cdr.markForCheck();
      }
    });
  }

  /** Cierre común de los PDF masivos: avisa de lo que no se pudo resolver y descarga. */
  private emitirPdf(rows: ContratacionRow[], pedidos: number, origen: string) {
    if (!rows.length) {
      this.pdfGenerando = false;
      this.snack.open('No se pudo resolver ninguna de las personas seleccionadas', 'Cerrar', { duration: 5000 });
      this.cdr.markForCheck();
      return;
    }
    this.pdf.generarMasivo(rows, {
      usuario: this.usuarioActual(),
      origen: `${origen} · ${rows.length} de ${pedidos} solicitadas`
    })
      .then(() => {
        const faltan = pedidos - rows.length;
        this.snack.open(
          `Formato de afiliación generado (${rows.length} personas)`
          + (faltan > 0 ? ` — ${faltan} sin datos, quedaron fuera` : ''),
          'Cerrar', { duration: faltan > 0 ? 7000 : 4000 });
      })
      .catch(() => this.snack.open('No se pudo generar el PDF', 'Cerrar', { duration: 4000 }))
      .finally(() => { this.pdfGenerando = false; this.cdr.markForCheck(); });
  }

  // ── Generación del documento EPS desde plantilla parametrizada ────────

  docEpsGenerando: number | null = null;

  /**
   * Documento EPS de una persona según la plantilla de su EPS / temporal / sexo. Primero se
   * pide el diagnóstico: si no se puede, el diálogo dice exactamente por qué (EPS sin
   * plantilla, contrato sin EPS, plantilla desactivada…) en vez de un "no hay plantilla" mudo.
   */
  generarDocEps(row: ContratacionRow) {
    if (this.docEpsGenerando) return;
    const procesoId = row.id;
    this.docEpsGenerando = procesoId;
    this.cdr.markForCheck();
    const fin = () => { this.docEpsGenerando = null; this.cdr.markForCheck(); };

    this.plantillaSvc.diagnosticar([procesoId]).subscribe({
      next: ([d]) => {
        if (!d?.puedeGenerar) {
          fin();
          this.mostrarDiagnostico(d ? [d] : [], true);
          return;
        }
        this.plantillaSvc.generarPdf(procesoId).subscribe({
          next: blob => {
            this.abrirPdf(blob);
            this.refrescarEstadoEps([procesoId]);
            const avisos = d.avisos?.length ? ' — ' + d.avisos.join(' ') : '';
            this.snack.open(`Documento EPS generado (${d.plantillaNombre})${avisos}`, 'Cerrar',
              { duration: avisos ? 9000 : 3000 });
            fin();
          },
          error: err => { fin(); this.errorDocEps(err); }
        });
      },
      error: err => { fin(); this.errorDocEps(err); }
    });
  }

  /** Documento EPS de lo marcado en la tabla: diagnóstico de todos, y un PDF con los que se puedan. */
  generarDocEpsSeleccion() {
    if (!this.selected.size || this.pdfGenerando) return;
    const tope = PlantillaEpsService.MAX_MASIVO;
    const ids = this.selectedIds.slice(0, tope);
    if (this.selected.size > tope) {
      this.snack.open(`Se seleccionaron ${this.selected.size}; el documento EPS se arma con los primeros ${tope}`,
        'Cerrar', { duration: 6000 });
    }
    this.pdfGenerando = true;
    this.cdr.markForCheck();
    const fin = () => { this.pdfGenerando = false; this.cdr.markForCheck(); };

    this.svc.cargarFilas(ids, this.filasEnPantalla).subscribe({
      next: rows => {
        const procesos = rows.map(r => r.id).filter(id => id != null);
        if (!procesos.length) {
          fin();
          this.snack.open('No se pudo resolver ninguna de las personas seleccionadas', 'Cerrar', { duration: 5000 });
          return;
        }
        this.plantillaSvc.diagnosticar(procesos).subscribe({
          next: diags => {
            fin();
            this.mostrarDiagnostico(diags, false);
          },
          error: err => { fin(); this.errorDocEps(err); }
        });
      },
      error: () => {
        fin();
        this.snack.open('No se pudieron cargar los datos de la selección', 'Cerrar', { duration: 4000 });
      }
    });
  }

  /** Diálogo con el diagnóstico; si el usuario sigue, genera (individual o masivo). */
  private mostrarDiagnostico(diags: DiagnosticoGeneracion[], individual: boolean) {
    const ref = this.dialog.open<DiagnosticoEpsDialogComponent, DiagnosticoEpsDialogData, DiagnosticoEpsDialogResult>(
      DiagnosticoEpsDialogComponent, { data: { diagnosticos: diags, individual }, autoFocus: false });
    ref.afterClosed().subscribe(ok => {
      if (!ok?.length) return;
      this.pdfGenerando = true;
      this.cdr.markForCheck();
      this.plantillaSvc.generarMasivo(ok).subscribe({
        next: blob => {
          this.abrirPdf(blob, 'documentos_eps.pdf');
          this.refrescarEstadoEps(ok);
          this.snack.open(`Documento EPS generado (${ok.length} personas)`, 'Cerrar', { duration: 4000 });
          this.pdfGenerando = false;
          this.cdr.markForCheck();
        },
        error: err => { this.pdfGenerando = false; this.cdr.markForCheck(); this.errorDocEps(err); }
      });
    });
  }

  /** El servidor responde 422 con el diagnóstico: se muestra el motivo exacto. */
  private async errorDocEps(err: unknown) {
    const d = await PlantillaEpsService.leerDiagnostico(err);
    const lista = Array.isArray(d) ? d : d ? [d] : [];
    if (lista.length && lista.some(x => x?.motivo)) {
      this.mostrarDiagnostico(lista, lista.length === 1);
      return;
    }
    const status = (err as { status?: number })?.status;
    const msg = status === 0 ? 'Sin conexión con el servidor: no se pudo generar el documento EPS'
      : status === 403 ? 'No tienes permiso para generar documentos EPS'
      : `Error del servidor generando el documento EPS (HTTP ${status ?? '?'})`;
    this.snack.open(msg, 'Cerrar', { duration: 6000 });
  }

  private abrirPdf(blob: Blob, nombre?: string) {
    const url = URL.createObjectURL(blob);
    if (nombre) {
      const a = document.createElement('a');
      a.href = url; a.download = nombre; a.click();
    } else {
      window.open(url, '_blank');
    }
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  /** Nombre del operador para el pie del PDF; si no se puede leer, el pie va sin él. */
  private usuarioActual(): string | undefined {
    try {
      const raw = localStorage.getItem('user');
      if (!raw) return undefined;
      const u = JSON.parse(raw);
      return u?.nombre || u?.name || u?.username || u?.usuario || u?.correo || u?.email || undefined;
    } catch {
      return undefined;
    }
  }

  /** Régimen en ADRES (V65): etiqueta corta y clase del chip; excepción resaltada. */
  readonly etiquetaRegimenAdres = etiquetaRegimenAdres;
  readonly regimenAdresClass = regimenAdresClass;

  /** Clase de color para el chip de estado ADRES. */
  adresEstadoClass(estado?: string): string {
    const e = (estado || '').toUpperCase();
    if (e.includes('ACTIVO') || e.includes('AFILIADO') && !e.includes('FALLECIDO')) return 'adres-ok';
    if (e.includes('FALLECIDO')) return 'adres-muerto';
    if (e.includes('RETIRADO') || e.includes('DESAFILIADO') || e.includes('SUSPENDIDO')) return 'adres-bad';
    return 'adres-neutro';
  }

  validadores: Validador[] = ['AFILIACIONES', 'COORDINADOR', 'NOMINA', 'PAGO_SEGURIDAD'];

  // ── Seguimiento de la afiliación ───────────────────────────────────
  //
  // El trámite estaba repartido por toda la ficha: las fechas en «Datos», los cuatro
  // validadores en un bloque, el radicado escondido dentro de la tarjeta del traslado y el
  // estado de los documentos en ningún sitio. Aquí se arma la línea de avance que permite
  // responder «¿en qué va esta persona?» sin leer la ficha entera.

  private static readonly ESTADO_AFILIACION: Record<string, { txt: string; cls: string }> = {
    PENDIENTE:  { txt: 'Pendiente',  cls: 'seg-estado--pend' },
    EN_PROCESO: { txt: 'En proceso', cls: 'seg-estado--curso' },
    AFILIADO:   { txt: 'Afiliado',   cls: 'seg-estado--ok' },
    RECHAZADO:  { txt: 'Rechazado',  cls: 'seg-estado--mal' },
  };

  estadoAfiliacion(r: ContratacionRow): { txt: string; cls: string } {
    return ConfirmacionIngresos.ESTADO_AFILIACION[(r.estado_afiliacion || '').toUpperCase()]
        ?? { txt: r.estado_afiliacion || 'Sin estado', cls: 'seg-estado--pend' };
  }

  /** Radicado del traslado vigente; es el número con el que se reclama a la EPS. */
  radicadoTraslado(): { radicado: string; estado: string; eps: string } | null {
    const ts = (this.expediente?.traslados || []).filter(t => t.activo !== false);
    const con = ts.find(t => !!t.radicado) ?? ts[0];
    if (!con) return null;
    return {
      radicado: con.radicado || 'sin radicar',
      estado: con.estado || 'Sin estado',
      eps: con.eps_a_trasladar || con.eps_trasladada || '',
    };
  }

  /**
   * Pasos del trámite en orden. `estado`: hecho | curso | pendiente.
   * El ingreso cuenta como «en curso» mientras la fecha no haya llegado: no es un pendiente
   * de nadie, es que todavía no toca.
   */
  pasosSeguimiento(r: ContratacionRow): Array<{ titulo: string; estado: string; detalle: string }> {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const ingreso = r.fecha_ingreso ? new Date(r.fecha_ingreso + 'T00:00:00') : null;
    const futuro = !!ingreso && ingreso.getTime() > hoy.getTime();
    const val = (ok: unknown, canal?: string | null, at?: string | null) => ({
      estado: ok ? 'hecho' : 'pendiente',
      detalle: ok ? [canal, at ? formatDate(at, 'dd/MM/yy', 'es-CO') : null].filter(Boolean).join(' · ') || 'confirmado'
                  : 'sin confirmar',
    });
    const tr = this.radicadoTraslado();
    const pasos = [
      { titulo: 'Contratación', estado: r.fecha_firma_contrato ? 'hecho' : 'pendiente',
        detalle: r.fecha_firma_contrato ? fechaCorta(r.fecha_firma_contrato) : 'sin fecha' },
      { titulo: 'Ingreso', estado: !ingreso ? 'pendiente' : (futuro ? 'curso' : 'hecho'),
        detalle: ingreso ? fechaCorta(r.fecha_ingreso) + (futuro ? ' (aún no llega)' : '') : 'sin fecha' },
      { titulo: 'Afiliaciones', ...val(r.ingreso_confirmado, r.ingreso_confirmado_canal, r.ingreso_confirmado_at) },
      { titulo: 'Coordinador', ...val(r.coord_confirmado) },
      { titulo: 'Nómina', ...val(r.nomina_confirmado) },
      { titulo: 'Pago seguridad', ...val(r.pago_confirmado) },
    ];
    pasos.push(tr
      ? { titulo: 'Traslado EPS', estado: tr.radicado === 'sin radicar' ? 'curso' : 'hecho',
          detalle: `${tr.estado}${tr.eps ? ' · ' + tr.eps : ''}` }
      : { titulo: 'Traslado EPS', estado: 'pendiente', detalle: 'sin solicitud registrada' });
    return pasos;
  }

  /**
   * Estado documental por grupo, leído de gestión documental (ms-documents).
   * Interesa si existe, de cuándo es y si la versión que se vería al descargar es la vigente:
   * el robot sube versiones sin marcarlas, y bajar la equivocada ya ha pasado.
   */
  estadoDocumental(): Array<{ grupo: GrupoDoc; etiqueta: string; total: number; detalle: string; estado: string }> {
    const grupos: Array<{ g: GrupoDoc; etiqueta: string }> = [
      { g: 'CEDULA', etiqueta: 'Cédula' },
      { g: 'ADRES', etiqueta: 'ADRES' },
      { g: 'TRASLADO', etiqueta: 'Traslado EPS' },
    ];
    return grupos.map(({ g, etiqueta }) => {
      const docs = this.docsDe(g);
      const total = this.totalDe(g);
      if (!docs.length) {
        return { grupo: g, etiqueta, total: 0, detalle: 'no cargado', estado: 'falta' };
      }
      const ultimo = [...docs].sort((a, b) =>
        (b.subido_en || '').localeCompare(a.subido_en || ''))[0];
      const fecha = ultimo.subido_en ? formatDate(ultimo.subido_en, 'dd/MM/yy', 'es-CO') : 's/f';
      const vig = ultimo.vigente === false ? 'no vigente' : 'vigente';
      return {
        grupo: g, etiqueta, total,
        detalle: `v${ultimo.version ?? 1} · ${vig} · ${fecha}`,
        estado: ultimo.vigente === false ? 'aviso' : 'ok',
      };
    });
  }
  canales: Canal[] = ['LLAMADA', 'CORREO', 'WHATSAPP'];
  resultados = ['CONTACTADO', 'NO_CONTESTA', 'PENDIENTE', 'RECHAZADO'];

  validadorLabel(v: string): string {
    switch (v) {
      case 'COORDINADOR': return 'Coordinador';
      case 'NOMINA': return 'Nómina';
      case 'PAGO_SEGURIDAD': return 'Pago seguridad';
      default: return 'Afiliaciones';
    }
  }

  /**
   * Bandera de un validador sobre el caso (overlay `afiliacion_caso`, camelCase del backend).
   * Centralizada aquí para que la plantilla no repita una cadena de ternarios por validador.
   */
  casoConfirmado(caso: any, v: Validador): boolean {
    switch (v) {
      case 'COORDINADOR': return !!caso?.coordConfirmado;
      case 'NOMINA': return !!caso?.nominaConfirmado;
      case 'PAGO_SEGURIDAD': return !!caso?.pagoConfirmado;
      default: return !!caso?.ingresoConfirmado;
    }
  }

  // ── Cambio masivo por pegado ───────────────────────────────────────
  /**
   * Abre el pegado desde Excel: resolver un bloque de cédulas, ver el preview de qué cambia y
   * confirmar cualquiera de las 4 validaciones. Va aparte de la barra masiva porque no depende
   * de la selección ni de los filtros de la tabla — la lista la trae el portapapeles.
   */
  abrirPegadoMasivo() {
    // En móvil se abre a pantalla completa: con 95vw el diálogo queda con márgenes inútiles
    // y el preview pierde el poco ancho que hay.
    const movil = typeof window !== 'undefined' && window.innerWidth < 768;
    this.dialog.open(PegadoMasivoDialogComponent, movil
      ? { width: '100vw', maxWidth: '100vw', height: '100dvh', panelClass: 'pm-dialog-movil', autoFocus: false, restoreFocus: true }
      : { width: '1140px', maxWidth: '95vw', autoFocus: false, restoreFocus: true }
    ).afterClosed().subscribe(r => {
      if (r?.procesados) { this.clearSelection(); this.svc.refresh(); }
    });
  }

  // ── Ficha editable de los 23 datos de afiliación ───────────────────
  /**
   * Abre los datos que alimentan los documentos de afiliación para verificarlos y corregirlos.
   * Lo que se guarda ahí va a las tablas reales de contratación (con auditoría), así que al
   * cerrar se refresca la tabla: la fila pudo cambiar de nombre, EPS o fecha de ingreso.
   */
  abrirDatosAfiliacion(row: ContratacionRow) {
    if (row.candidato_id == null) {
      this.snack.open('Esta fila no tiene candidato asociado', 'Cerrar', { duration: 4000 });
      return;
    }
    const movil = typeof window !== 'undefined' && window.innerWidth < 768;
    this.dialog.open(DatosAfiliacionDialogComponent, {
      data: { candidatoId: row.candidato_id, nombre: row.nombre_completo, cedula: row.numero_documento },
      autoFocus: false,
      restoreFocus: true,
      ...(movil
        ? { width: '100vw', maxWidth: '100vw', height: '100dvh', panelClass: 'da-dialog-movil' }
        : { width: '960px', maxWidth: '95vw' })
    }).afterClosed().subscribe(r => {
      if (r?.guardado) this.svc.refresh();
    });
  }

  // ── Filtros ────────────────────────────────────────────────────────
  onDateRangeChanged(r: { start: Date; end: Date }) { this.svc.updateDateRange(r.start, r.end); this.clearSelection(); }
  onSearchChanged(t: string) { this.svc.updateSearch(t); }
  onEmpresaChanged(e: string) { this.svc.updateEmpresa(e); this.clearSelection(); }
  onEmpresaUsuariaChanged(e: string) { this.svc.updateEmpresaUsuaria(e); this.clearSelection(); }
  onOficinaChanged(o: string) { this.svc.updateOficina(o); this.clearSelection(); }
  onResponsableChanged(r: string) { this.svc.updateResponsable(r); this.clearSelection(); }
  onPageChange(e: { pagina: number; porPagina: number }) { this.svc.setPage(e.pagina, e.porPagina); }
  toggleListos(v: boolean) { this.svc.updateSoloListos(v); this.clearSelection(); }
  setBase(b: BaseFechaGestion) { this.svc.updateBaseFecha(b); this.clearSelection(); }

  // ── Selección ──────────────────────────────────────────────────────
  isSelected(row: ContratacionRow): boolean {
    return row.candidato_id != null && this.selected.has(row.candidato_id);
  }

  /** Casilla de la vista de tarjetas: pasa por el mismo selector que la tabla. */
  toggleRow(row: ContratacionRow, checked: boolean) {
    if (row.candidato_id == null) return;
    if (checked) this.sel.select(row); else this.sel.deselect(row);
  }

  /** Lo que marca o desmarca la tabla se apunta en el `Set` por candidato. */
  private escucharSeleccion(): void {
    this.sel.changed.subscribe(() => {
      if (this.sincronizando) return;
      for (const r of this.sel.selected) if (r.candidato_id != null) this.selected.add(r.candidato_id);
      for (const r of this.filasPagina) {
        if (r.candidato_id != null && !this.sel.isSelected(r)) this.selected.delete(r.candidato_id);
      }
      this.marcadas.set(this.selected.size);
      this.repintarSeleccion();
    });
  }

  /** Página nueva: se vuelven a marcar las filas que ya estaban elegidas. */
  private repescarSeleccion(rows: ContratacionRow[]): void {
    this.filasPagina = rows;
    const marcar = rows.filter(r => r.candidato_id != null && this.selected.has(r.candidato_id));
    this.sincronizando = true;
    this.sel.select(...marcar);
    this.sincronizando = false;
  }

  private filasPagina: ContratacionRow[] = [];

  clearSelection() {
    this.selected.clear();
    this.marcadas.set(0);
    this.sincronizando = true;
    this.sel.clear();
    this.sincronizando = false;
    this.repintarSeleccion();
  }
  get selectedIds(): number[] { return Array.from(this.selected); }

  // ── Acciones masivas ───────────────────────────────────────────────
  confirmarMasivo() {
    if (!this.selected.size || this.saving) return;
    this.saving = true;
    this.svc.confirmarMasivo(this.selectedIds, this.validadorSel, this.canalSel, this.notaBulk).subscribe({
      next: r => this.afterMasivo('Confirmación', r),
      error: () => { this.saving = false; this.snack.open('Error al confirmar', 'Cerrar', { duration: 4000 }); }
    });
  }
  intentoMasivo() {
    if (!this.selected.size || this.saving) return;
    this.saving = true;
    this.svc.registrarIntentoMasivo(this.selectedIds, this.validadorSel, this.canalSel, this.resultadoSel, this.notaBulk).subscribe({
      next: r => this.afterMasivo('Intento', r),
      error: () => { this.saving = false; this.snack.open('Error al registrar', 'Cerrar', { duration: 4000 }); }
    });
  }
  private afterMasivo(label: string, r: MasivoResult) {
    this.saving = false;
    const msg = `${label}: ${r.procesados}/${r.solicitados} procesados`
      + (r.fallidos?.length ? `, ${r.fallidos.length} con error` : '');
    this.snack.open(msg, 'Cerrar', { duration: 5000 });
    this.selected.clear();
    this.notaBulk = '';
    this.svc.refresh();
  }

  // ── Detalle ────────────────────────────────────────────────────────
  openDetail(row: ContratacionRow) {
    this.detailRow = row;
    this.detailNota = '';
    this.detailCanal = 'LLAMADA';
    if (row.candidato_id != null) {
      this.caso$ = this.svc.getCaso(row.candidato_id);
      this.cargarExpediente(row.candidato_id);
    }
  }
  closeDetail() {
    this.detailRow = null;
    this.caso$ = null;
    this.expediente = null;
    this.liberarPreviews();
  }

  ngOnDestroy() { this.liberarPreviews(); }

  // ── Expediente: documentos + ADRES + traslados ─────────────────────

  expediente: Expediente | null = null;
  expedienteCargando = false;
  /** Grupo de documentos que se está mostrando en la ficha. */
  grupoDoc: GrupoDoc = 'CEDULA';
  grupos: GrupoDoc[] = ['CEDULA', 'ADRES', 'TRASLADO', 'OTROS'];
  /** Documentos de cualquier otro tipo (contrato, exámenes, ARL, policivos…). */
  otrosDocs: DocumentoExpediente[] = [];
  otrosCargando = false;
  private otrosPedidosPara: string | null = null;

  /**
   * Vistas previas ya descargadas, por documento+versión. Se cachean porque el binario viaja
   * por el gateway con el token: volver a pedirlo cada vez que se colapsa/expande sería
   * descargar el PDF otra vez. Los object URL se liberan al cerrar la ficha.
   */
  private previews = new Map<string, PreviewDoc>();

  grupoLabel(g: GrupoDoc): string {
    return g === 'CEDULA' ? 'Cédula' : g === 'ADRES' ? 'ADRES'
         : g === 'TRASLADO' ? 'Traslado EPS' : 'Otros';
  }
  grupoIcono(g: GrupoDoc): string {
    return g === 'CEDULA' ? 'badge' : g === 'ADRES' ? 'health_and_safety'
         : g === 'TRASLADO' ? 'swap_horiz' : 'folder_open';
  }

  /** Cambiar de pestaña; «Otros» se pide a gestión documental la primera vez que se abre. */
  verGrupo(g: GrupoDoc): void {
    this.grupoDoc = g;
    if (g === 'OTROS') this.cargarOtros();
  }

  /**
   * Todo lo que la persona tiene en gestión documental, menos lo que ya muestran las otras
   * pestañas. Se pide una sola vez por cédula y solo si el usuario abre «Otros»: son hasta
   * 20 tipos por persona y no hace falta traerlos para quien solo viene a confirmar.
   */
  private cargarOtros(): void {
    const cedula = this.expediente?.cedula || this.detailRow?.numero_documento || '';
    if (!cedula || this.otrosPedidosPara === cedula) return;
    this.otrosPedidosPara = cedula;
    this.otrosCargando = true;
    this.otrosDocs = [];
    this.svc.documentosDelDueno(cedula).subscribe(docs => {
      const yaVistos = new Set(['CEDULA', 'ADRES', 'SOLICITUD_TRASLADO_EPS', 'TRASLADOS']);
      this.otrosDocs = docs
        .filter(d => !yaVistos.has((d.tipo || '').toUpperCase()))
        .sort((a, b) => (a.tipo || '').localeCompare(b.tipo || ''));
      this.otrosCargando = false;
      this.cdr.markForCheck();
    });
  }

  private cargarExpediente(candidatoId: number) {
    this.expedienteCargando = true;
    this.expediente = null;
    this.otrosDocs = [];
    this.otrosPedidosPara = null;
    this.docEnVista = null;
    this.liberarPreviews();
    this.svc.getExpediente(candidatoId).subscribe({
      next: exp => {
        this.expediente = exp;
        this.expedienteCargando = false;
        // Arranca en el primer grupo que tenga algo: si no hay cédula cargada, no tiene
        // sentido abrir la ficha en una pestaña vacía.
        this.grupoDoc = this.grupos.find(g => this.docsDe(g).length > 0) || 'CEDULA';
        // La cédula es lo que permite confirmar de quién es el expediente, así que su
        // vista previa se abre sola; el resto se descarga solo si lo piden.
        const primera = this.docsDe(this.grupoDoc)[0];
        if (primera) this.togglePreview(primera);
        this.cdr.markForCheck();
      },
      error: () => {
        this.expedienteCargando = false;
        this.snack.open('No se pudo cargar el expediente', 'Cerrar', { duration: 4000 });
        this.cdr.markForCheck();
      }
    });
  }

  /** Documentos de un grupo, ya ordenados por el backend (más recientes primero). */
  docsDe(grupo: GrupoDoc): DocumentoExpediente[] {
    if (grupo === 'OTROS') return this.otrosDocs;
    return (this.expediente?.documentos || []).filter(d => d.grupo === grupo);
  }

  /** Cuántos documentos tiene la persona en ese grupo (el listado puede venir topado). */
  totalDe(grupo: GrupoDoc): number {
    if (grupo === 'OTROS') return this.otrosDocs.length;
    return this.expediente?.conteos?.find(c => c.grupo === grupo)?.total ?? this.docsDe(grupo).length;
  }
  hayMasDe(grupo: GrupoDoc): number {
    return Math.max(0, this.totalDe(grupo) - this.docsDe(grupo).length);
  }

  /**
   * Documento que se está viendo en el panel de la derecha. El visor dejó de ir debajo de
   * cada tarjeta —una tira ancha que empujaba la lista hacia abajo— y pasó a ser un panel
   * fijo: se elige en la lista y se ve al lado, sin perder de vista el resto del expediente.
   */
  docEnVista: DocumentoExpediente | null = null;

  esEnVista(d: DocumentoExpediente): boolean {
    return !!this.docEnVista && this.claveDoc(this.docEnVista) === this.claveDoc(d);
  }

  private claveDoc(d: DocumentoExpediente): string {
    return `${d.document_id}:${d.version_id ?? ''}`;
  }
  preview(d: DocumentoExpediente): PreviewDoc | undefined {
    return this.previews.get(this.claveDoc(d));
  }

  /**
   * Abre/cierra la vista previa de un documento. Se descarga el binario por el gateway (con el
   * token de la app) y se muestra en línea — PDF en un visor embebido, imágenes como imagen —
   * para decidir si vale la pena descargarlo. Los formatos que el navegador no sabe pintar
   * (Word, Excel) se marcan como no previsualizables en vez de abrir una pestaña en blanco.
   */
  togglePreview(d: DocumentoExpediente) {
    const clave = this.claveDoc(d);
    // Volver a pulsar el que ya se está viendo lo cierra; pulsar otro cambia el panel.
    if (this.esEnVista(d)) {
      const abierta = this.previews.get(clave);
      if (abierta) abierta.abierto = false;
      this.docEnVista = null;
      this.cdr.markForCheck();
      return;
    }
    this.docEnVista = d;
    const actual = this.previews.get(clave);
    if (actual) {
      actual.abierto = true;
      this.cdr.markForCheck();
      return;
    }
    if (!d.document_id) { this.docEnVista = null; return; }

    const entrada: PreviewDoc = { abierto: true, cargando: true, mime: d.mime || '', kind: this.kindDe(d) };
    this.previews.set(clave, entrada);
    this.cdr.markForCheck();

    this.svc.descargarDocumento(d.document_id, d.version_id ?? null).subscribe({
      next: blob => {
        entrada.cargando = false;
        entrada.objectUrl = URL.createObjectURL(blob);
        entrada.safeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(entrada.objectUrl);
        // El mime de la metadata a veces viene vacío o mentido; el del blob es el real.
        if (blob.type) { entrada.mime = blob.type; entrada.kind = this.kindDeMime(blob.type, d.archivo); }
        this.cdr.markForCheck();
      },
      error: () => {
        entrada.cargando = false;
        entrada.error = true;
        this.cdr.markForCheck();
      }
    });
  }

  /** Descarga el documento al disco, con su nombre real. */
  descargarDoc(d: DocumentoExpediente) {
    if (!d.document_id) return;
    const yaCargado = this.previews.get(this.claveDoc(d))?.objectUrl;
    if (yaCargado) { this.dispararDescarga(yaCargado, d.archivo); return; }
    this.svc.descargarDocumento(d.document_id, d.version_id ?? null).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        this.dispararDescarga(url, d.archivo);
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      },
      error: () => this.snack.open('No se pudo descargar el documento', 'Cerrar', { duration: 4000 })
    });
  }

  /** Abre el documento en una pestaña aparte (útil para PDFs largos). */
  abrirEnPestana(d: DocumentoExpediente) {
    const p = this.previews.get(this.claveDoc(d));
    if (p?.objectUrl) { window.open(p.objectUrl, '_blank'); return; }
    if (!d.document_id) return;
    this.svc.descargarDocumento(d.document_id, d.version_id ?? null).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      },
      error: () => this.snack.open('No se pudo abrir el documento', 'Cerrar', { duration: 4000 })
    });
  }

  private dispararDescarga(url: string, nombre?: string) {
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre || 'documento';
    a.click();
  }

  private kindDe(d: DocumentoExpediente): PreviewKind {
    return this.kindDeMime(d.mime || '', d.archivo);
  }
  private kindDeMime(mime: string, archivo?: string): PreviewKind {
    const m = (mime || '').toLowerCase();
    const nombre = (archivo || '').toLowerCase();
    if (m.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/.test(nombre)) return 'imagen';
    if (m.includes('pdf') || nombre.endsWith('.pdf')) return 'pdf';
    return 'otro';
  }

  private liberarPreviews() {
    this.previews.forEach(p => { if (p.objectUrl) URL.revokeObjectURL(p.objectUrl); });
    this.previews.clear();
  }

  /** Tamaño legible para la ficha del documento. */
  tamano(bytes?: number): string {
    if (!bytes || bytes <= 0) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /** Color del chip según el estado del traslado de EPS. */
  trasladoEstadoClass(estado?: string | null): string {
    const e = (estado || '').toUpperCase();
    if (!e) return 'tr-neutro';
    if (e.includes('ACEPTADO')) return 'tr-ok';
    if (e.includes('RETIRADO') || e.includes('NO SE ENCUENTRA') || e.includes('NO CUMPLE')) return 'tr-bad';
    if (e.includes('PROCESO') || e.includes('VALIDAR') || e.includes('REPORTE')) return 'tr-proceso';
    return 'tr-neutro';
  }

  confirmarUno(validador: Validador) {
    if (!this.detailRow?.candidato_id || this.saving) return;
    this.saving = true;
    this.svc.confirmar(this.detailRow.candidato_id, validador, this.detailCanal, this.detailNota).subscribe({
      next: () => { this.saving = false; this.snack.open(`Confirmado (${this.validadorLabel(validador)})`, 'Cerrar', { duration: 3000 }); this.svc.refresh(); this.reloadCaso(); },
      error: () => { this.saving = false; this.snack.open('Error al confirmar', 'Cerrar', { duration: 4000 }); }
    });
  }
  registrarUno(validador: Validador) {
    if (!this.detailRow?.candidato_id || this.saving) return;
    this.saving = true;
    this.svc.registrarIntento(this.detailRow.candidato_id, validador, this.detailCanal, this.resultadoSel, this.detailNota).subscribe({
      next: () => { this.saving = false; this.snack.open('Intento registrado', 'Cerrar', { duration: 3000 }); this.svc.refresh(); this.reloadCaso(); },
      error: () => { this.saving = false; this.snack.open('Error al registrar', 'Cerrar', { duration: 4000 }); }
    });
  }
  private reloadCaso() {
    if (this.detailRow?.candidato_id != null) this.caso$ = this.svc.getCaso(this.detailRow.candidato_id);
  }

  verCedula(row: ContratacionRow) {
    this.abrirDoc(row, this.svc.getCedula(row.candidato_id!), 'cédula');
  }
  verAdres(row: ContratacionRow) {
    this.abrirDoc(row, this.svc.getAdres(row.candidato_id!), 'ADRES');
  }

  /**
   * Marca de tiempo de un documento para ordenarlo. ms-documents serializa los Instant como
   * epoch (segundos, a veces en notación exponencial); si falta, cae al id del documento.
   */
  private docTimestamp(d: any): number {
    const raw = d?.uploaded_at ?? d?.uploadedAt ?? d?.created_at ?? d?.createdAt;
    const n = typeof raw === 'number' ? raw : (raw ? Date.parse(String(raw)) : NaN);
    if (!isNaN(n)) return n;
    return Number(d?.document_id ?? d?.documentId ?? 0);
  }

  /**
   * Última cédula/ADRES de la persona. Una misma persona puede tener VARIOS documentos del mismo
   * tipo (subidas repetidas del legacy) y ms-documents los devuelve sin orden garantizado, así que
   * quedarse con el primero abría uno viejo. Se elige el de subida más reciente.
   */
  private docMasReciente(docs: any[]): any | null {
    if (!docs?.length) return null;
    return docs.reduce((mejor, d) => this.docTimestamp(d) > this.docTimestamp(mejor) ? d : mejor);
  }

  /** Busca el documento (cédula/ADRES), descarga el binario con auth y lo abre en pestaña nueva. */
  private abrirDoc(row: ContratacionRow, obs: Observable<CedulaDoc>, label: string) {
    if (row.candidato_id == null || this.docLoading) return;
    this.docLoading = true;
    obs.subscribe(doc => {
      const d = (doc.found ? this.docMasReciente(doc.documentos || []) : null) || {};
      const id = d.document_id ?? d.documentId ?? null;
      const versionId = d.version_id ?? d.versionId ?? null;
      if (!id) {
        this.docLoading = false;
        this.snack.open(`Sin ${label} para esta persona`, 'Cerrar', { duration: 4000 });
        return;
      }
      this.svc.descargarDocumento(id, versionId).subscribe({
        next: blob => {
          this.docLoading = false;
          const url = URL.createObjectURL(blob);
          window.open(url, '_blank');
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        },
        error: () => { this.docLoading = false; this.snack.open(`No se pudo abrir el ${label}`, 'Cerrar', { duration: 4000 }); }
      });
    });
  }
}
