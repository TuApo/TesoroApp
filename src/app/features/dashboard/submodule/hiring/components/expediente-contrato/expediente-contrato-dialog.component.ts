import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';

import { ColumnaTabla, TABLA_ESTANDAR } from '@/app/shared/components/tabla-estandar';
import { DocViewerService } from '@/app/shared/services/doc-viewer/doc-viewer.service';
import { GestionDocumentalService } from '../../service/gestion-documental/gestion-documental.service';
import {
  ContratoExpediente,
  DocumentoExpediente,
  ExigidoExpediente,
  ExpedienteContrato,
  etiquetaContrato,
  fechaCorta,
  textoAsignacion,
  tonoEstado,
} from '../../service/gestion-documental/expediente-contrato.model';

/**
 * Datos para abrir el expediente. Basta la cédula (abre su último contrato) o el
 * proceso; `tipos` reemplaza los exigidos por defecto (ids de tipo documental).
 */
export interface ExpedienteContratoDialogData {
  cedula?: string | number | null;
  proceso_id?: number | string | null;
  contract_number?: string | null;
  nombre?: string | null;
  tipos?: number[] | null;
}

/**
 * «Ver expediente» — documentos de UN contrato (pedido #14).
 *
 * Reutilizable: lo abre Consultar documentación y lo abrirán el historial
 * laboral del pipeline y la línea de tiempo. Muestra los exigidos con su
 * estado, los documentos del contrato, los de la persona (valen para todos sus
 * contratos) y, aparte, los antiguos sin contrato que no se pueden atribuir.
 *
 * Uso:
 *   this.dialog.open(ExpedienteContratoDialogComponent, {
 *     data: { cedula, proceso_id, nombre }, width: '1100px', maxWidth: '96vw',
 *   });
 */
@Component({
  selector: 'app-expediente-contrato-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatProgressBarModule,
    ...TABLA_ESTANDAR,
  ],
  templateUrl: './expediente-contrato-dialog.component.html',
  styleUrl: './expediente-contrato-dialog.component.css',
})
export class ExpedienteContratoDialogComponent {
  private readonly svc = inject(GestionDocumentalService);
  private readonly visor = inject(DocViewerService);
  private readonly destroyRef = inject(DestroyRef);
  readonly dialogRef = inject(MatDialogRef<ExpedienteContratoDialogComponent>);
  readonly data = inject<ExpedienteContratoDialogData>(MAT_DIALOG_DATA);

  readonly expediente = signal<ExpedienteContrato | null>(null);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  /** Procesos sin fila de contrato (selecciones que no llegaron a contratar): ocultos por defecto. */
  readonly verTodosLosProcesos = signal(false);
  readonly verSinAsignar = signal(false);

  readonly contratoActual = computed(() => this.expediente()?.contrato ?? null);

  /** Contratos para cambiar de uno a otro: los que tienen contrato y el que se está viendo. */
  readonly contratosVisibles = computed<ContratoExpediente[]>(() => {
    const lista = this.expediente()?.contratos ?? [];
    if (this.verTodosLosProcesos()) return lista;
    return lista.filter((c) => c.tiene_contrato || c.seleccionado);
  });

  readonly procesosOcultos = computed(() => {
    const lista = this.expediente()?.contratos ?? [];
    return lista.filter((c) => !c.tiene_contrato && !c.seleccionado).length;
  });

  readonly titulo = computed(() => {
    const e = this.expediente();
    const nombre = String(this.data?.nombre ?? '').trim();
    const ced = e?.cedula ?? String(this.data?.cedula ?? '').trim();
    return [nombre, ced ? `CC ${ced}` : ''].filter(Boolean).join(' · ');
  });

  readonly etiquetaContrato = etiquetaContrato;
  readonly fechaCorta = fechaCorta;

  readonly columnasExigidos: ColumnaTabla<ExigidoExpediente>[] = [
    { id: 'type_name', header: 'Documento', valor: (f) => f.type_name, tarjeta: 'titulo', minAncho: '200px' },
    {
      id: 'estado', header: 'Estado', valor: (f) => tonoEstado(f.estado).texto, tarjeta: 'badge',
      badge: (f) => tonoEstado(f.estado),
    },
    { id: 'nivel', header: 'Nivel', valor: (f) => (f.nivel === 'PERSONA' ? 'Persona' : 'Contrato'), prioridad: 2 },
    { id: 'uploaded_at', header: 'Subido', valor: (f) => fechaCorta(f.uploaded_at), prioridad: 2 },
    { id: 'asignacion', header: 'Origen', valor: (f) => textoAsignacion(f.asignacion), prioridad: 3, minAncho: '180px' },
  ];

  readonly columnasDocumentos: ColumnaTabla<DocumentoExpediente>[] = [
    { id: 'type_name', header: 'Tipo', valor: (f) => f.type_name, tarjeta: 'titulo', minAncho: '180px' },
    { id: 'title', header: 'Archivo', valor: (f) => f.title, prioridad: 2, minAncho: '200px' },
    { id: 'uploaded_at', header: 'Subido', valor: (f) => fechaCorta(f.uploaded_at) },
    { id: 'contract_number', header: 'N.º contrato', valor: (f) => f.contract_number ?? '', prioridad: 3 },
    { id: 'asignacion', header: 'Origen', valor: (f) => textoAsignacion(f.asignacion), prioridad: 3, minAncho: '180px' },
    {
      id: 'vigente', header: 'Vigente', valor: (f) => (f.vigente ? 'Sí' : 'Anterior'), tarjeta: 'badge',
      badge: (f) => (f.vigente ? { texto: 'Vigente', tono: 'ok' } : { texto: 'Anterior', tono: 'neutro' }),
    },
  ];

  constructor() {
    this.cargar({
      proceso_id: this.data?.proceso_id ?? null,
      contract_number: this.data?.contract_number ?? null,
    });
  }

  /** Cambia al contrato elegido (o recarga el actual). */
  elegir(c: ContratoExpediente): void {
    if (c.seleccionado || this.cargando()) return;
    this.cargar({ proceso_id: c.proceso_id, contract_number: null });
  }

  recargar(): void {
    const e = this.expediente();
    this.cargar({ proceso_id: e?.proceso_id ?? this.data?.proceso_id ?? null, contract_number: null });
  }

  async ver(url: string | null | undefined, ev?: Event): Promise<void> {
    ev?.stopPropagation();
    if (!url) return;
    const ok = await this.visor.openInNewTab(url);
    if (!ok) this.error.set('No se pudo abrir el documento. Revisa tu sesión e intenta de nuevo.');
  }

  cerrar(): void {
    this.dialogRef.close();
  }

  private cargar(filtro: { proceso_id: number | string | null; contract_number: string | null }): void {
    this.cargando.set(true);
    this.error.set(null);
    this.svc
      .getExpedienteContrato({
        cedula: this.data?.cedula ?? this.expediente()?.cedula ?? null,
        proceso_id: filtro.proceso_id,
        contract_number: filtro.contract_number,
        tipos: this.data?.tipos ?? null,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (e) => {
          this.expediente.set(e);
          this.cargando.set(false);
        },
        error: (err: HttpErrorResponse) => {
          this.cargando.set(false);
          const detalle = err?.error?.message || err?.error?.error || err?.error?.detail;
          this.error.set(detalle
            ? String(detalle)
            : err?.status === 0
              ? 'No hay conexión con el servidor.'
              : 'No se pudo cargar el expediente.');
        },
      });
  }
}
