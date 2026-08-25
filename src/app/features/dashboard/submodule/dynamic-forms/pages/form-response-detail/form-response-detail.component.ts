import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import Swal from 'sweetalert2';
import type { RowInput } from 'jspdf-autotable';

import { FieldRendererComponent } from '@/app/shared/components/forms/field-renderer/field-renderer.component';
import { DynamicFormService } from '../../services/dynamic-form.service';
import { SubmissionService } from '../../services/submission.service';
import { MediaOffloadService } from '../../services/media-offload.service';
import {
  ApiProblem,
  DocumentRef,
  DynamicField,
  FieldValue,
  FormSection,
  FormStructure,
  LocationValue,
  Submission,
  SubmissionStatus,
  asDocumentRefs,
} from '../../models/dynamic-forms.models';

/** Vista precalculada de una sección: campos ordenados (sin COMMENT) + sus valores. */
interface SeccionVista {
  sec: FormSection;
  campos: DynamicField[];
  valores: Record<string, FieldValue>;
}

/**
 * Detalle de UNA respuesta (ruta :formId/respuestas/:submissionId).
 *
 * Regla central — la corrección de la trampa PHOTO del sistema origen: el cuerpo
 * recorre la ESTRUCTURA de la versión con que se respondió (no la vigente) y cada
 * valor se pinta con app-field-renderer en mode='readonly', que despacha por el
 * TIPO REAL del campo. Aquí NO hay diálogos CRUD genéricos ni heurísticas por
 * nombre de clave: si el esquema dice PHOTO se ve miniatura, si dice FILE se ven
 * chips descargables, si dice LOCATION se ven coordenadas. Punto.
 */
@Component({
  selector: 'app-form-response-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterLink, MatSnackBarModule, FieldRendererComponent],
  templateUrl: './form-response-detail.component.html',
  styleUrl: './form-response-detail.component.css',
})
export class FormResponseDetailComponent {
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);
  private forms = inject(DynamicFormService);
  private submissions = inject(SubmissionService);
  private media = inject(MediaOffloadService);
  private snack = inject(MatSnackBar);

  // ── Estado ───────────────────────────────────────────────────────────
  private formId = NaN;
  readonly submissionId = signal<number>(NaN);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly submission = signal<Submission | null>(null);
  readonly estructura = signal<FormStructure | null>(null);
  readonly cambiandoEstado = signal(false);
  readonly exportando = signal(false);

  private static readonly ESTADO_LABEL: Record<SubmissionStatus, string> = {
    DRAFT: 'Borrador',
    SUBMITTED: 'Enviada',
    APPROVED: 'Aprobada',
    REJECTED: 'Rechazada',
  };
  private static readonly ESTADO_CLASE: Record<SubmissionStatus, string> = {
    DRAFT: 'badge--draft',
    SUBMITTED: 'badge--submitted',
    APPROVED: 'badge--approved',
    REJECTED: 'badge--rejected',
  };

  // ── Derivados ────────────────────────────────────────────────────────
  readonly tituloFormulario = computed<string>(() =>
    this.estructura()?.form_name ?? this.submission()?.form_name ?? 'Formulario');

  /** Versión con la que se respondió (la del envío; la estructura pedida es esa misma). */
  readonly versionLabel = computed<string>(() => {
    const v = this.submission()?.version ?? this.estructura()?.version.version;
    return v != null ? `v${v}` : '';
  });

  readonly versionDeprecada = computed<boolean>(() =>
    this.estructura()?.version.status === 'DEPRECATED');

  readonly estadoLabel = computed<string>(() => {
    const s = this.submission();
    return s ? FormResponseDetailComponent.ESTADO_LABEL[s.status] : '';
  });

  readonly estadoClase = computed<string>(() => {
    const s = this.submission();
    return s ? FormResponseDetailComponent.ESTADO_CLASE[s.status] : '';
  });

  readonly esEnviada = computed<boolean>(() => this.submission()?.status === 'SUBMITTED');

  /** Fecha a mostrar: la de envío; un borrador aún no tiene, cae a la de creación. */
  readonly fechaEnvio = computed<string | null>(() => {
    const s = this.submission();
    return s ? (s.submitted_at ?? s.created_at) : null;
  });
  readonly etiquetaFecha = computed<string>(() =>
    this.submission()?.submitted_at ? 'Enviada' : 'Creada');

  readonly autor = computed<string>(() => {
    const s = this.submission();
    if (!s) return '';
    if (s.created_by) return s.created_by;
    if (s.public_link_id != null) return 'anónimo por link público';
    return '—';
  });

  /** Secciones en orden, cada una con campos ordenados (COMMENT no aparece en readonly). */
  readonly seccionesVista = computed<SeccionVista[]>(() => {
    const st = this.estructura();
    const payload = this.submission()?.payload ?? {};
    if (!st) return [];
    return [...st.sections]
      .sort((a, b) => a.order_no - b.order_no)
      .map(sec => ({
        sec,
        campos: sec.fields
          .filter(f => f.type !== 'COMMENT')
          .sort((a, b) => a.order_no - b.order_no),
        valores: payload[sec.code ?? ''] ?? {},
      }));
  });

  /** URL de descarga de media — el renderer la usa para miniaturas, players y chips. */
  readonly downloadUrlFn = (ref: DocumentRef): string => this.media.downloadUrl(ref);

  constructor() {
    this.route.paramMap
      .pipe(takeUntilDestroyed())
      .subscribe(pm => {
        this.formId = Number(pm.get('formId'));
        this.submissionId.set(Number(pm.get('submissionId')));
        this.cargar();
      });
  }

  // ── Carga ────────────────────────────────────────────────────────────
  /** Serial de carga: si los params cambian a mitad, la respuesta vieja se descarta. */
  private cargaSeq = 0;

  cargar(): void {
    const formId = this.formId;
    const submissionId = this.submissionId();
    if (!Number.isFinite(formId) || !Number.isFinite(submissionId)) {
      this.error.set('Ruta inválida: falta el formulario o la respuesta.');
      this.cargando.set(false);
      return;
    }
    const seq = ++this.cargaSeq;
    this.cargando.set(true);
    this.error.set(null);
    this.submissions.get(submissionId).pipe(
      switchMap(sub => {
        if (seq === this.cargaSeq) this.submission.set(sub);
        // El esquema de SU versión, no el vigente: si el formulario se editó
        // después, esta respuesta se sigue leyendo con la estructura histórica.
        return this.forms.structure(formId, sub.version ?? undefined);
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: st => {
        if (seq !== this.cargaSeq) return;
        this.estructura.set(st);
        this.cargando.set(false);
      },
      error: (err: unknown) => {
        if (seq !== this.cargaSeq) return;
        this.error.set(this.mensajeDe(err));
        this.cargando.set(false);
      },
    });
  }

  // ── Plantilla: helpers de grilla ─────────────────────────────────────
  /** Misma regla de ancho completo que expone el renderer (aquí el grid es de la página). */
  esAnchoCompleto(f: DynamicField): boolean {
    return f.type === 'TEXT_LONG' || f.type === 'SECTION'
      || f.schema?.ui?.full_width === true
      || (f.type === 'MULTIPLE_CHOICE' && (f.schema?.options?.length ?? 0) > 6);
  }

  valorDe(vm: SeccionVista, f: DynamicField): FieldValue {
    return vm.valores[f.name ?? ''] ?? null;
  }

  // ── Aprobar / Rechazar ───────────────────────────────────────────────
  async cambiarEstado(nuevo: 'APPROVED' | 'REJECTED'): Promise<void> {
    const sub = this.submission();
    if (!sub || sub.status !== 'SUBMITTED' || this.cambiandoEstado()) return;
    const aprobar = nuevo === 'APPROVED';
    const res = await Swal.fire({
      title: aprobar ? '¿Aprobar esta respuesta?' : '¿Rechazar esta respuesta?',
      text: aprobar
        ? `La respuesta #${sub.id} quedará marcada como APROBADA.`
        : `La respuesta #${sub.id} quedará marcada como RECHAZADA.`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: aprobar ? 'Sí, aprobar' : 'Sí, rechazar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: aprobar ? '#21263c' : '#b42318',
    });
    if (!res.isConfirmed) return;

    this.cambiandoEstado.set(true);
    this.submissions.changeStatus(sub.id, nuevo)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: actualizada => {
          this.submission.set(actualizada);
          this.cambiandoEstado.set(false);
          this.snack.open(aprobar ? 'Respuesta aprobada' : 'Respuesta rechazada', 'OK', { duration: 3500 });
        },
        error: (err: unknown) => {
          this.cambiandoEstado.set(false);
          void Swal.fire({
            icon: 'error',
            title: 'No se pudo cambiar el estado',
            text: this.mensajeDe(err),
            confirmButtonColor: '#21263c',
          });
        },
      });
  }

  // ── Exportar PDF ─────────────────────────────────────────────────────
  async exportarPdf(): Promise<void> {
    const sub = this.submission();
    const st = this.estructura();
    if (!sub || !st || this.exportando()) return;
    this.exportando.set(true);
    try {
      await this.generarPdf(sub, st);
    } catch {
      void Swal.fire({
        icon: 'error',
        title: 'No se pudo generar el PDF',
        text: 'Ocurrió un error armando el documento. Intenta de nuevo.',
        confirmButtonColor: '#21263c',
      });
    } finally {
      this.exportando.set(false);
    }
  }

  /**
   * PDF campo/valor por sección. jsPDF y autoTable se cargan bajo demanda para no
   * meter ~400 KB en el chunk del detalle (mismo patrón que el formato de afiliación).
   */
  private async generarPdf(sub: Submission, st: FormStructure): Promise<void> {
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);

    // Carta en milímetros.
    const ANCHO = 215.9;
    const ALTO = 279.4;
    const M = 14;
    const CONTENIDO = ANCHO - M * 2;

    const NAVY: [number, number, number] = [33, 38, 60];
    const PIZARRA: [number, number, number] = [51, 65, 85];
    const GRIS: [number, number, number] = [148, 163, 184];
    const BORDE: [number, number, number] = [203, 213, 225];
    const SUBHEAD: [number, number, number] = [232, 237, 243];

    const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' });
    const generado = new Date();
    const finalY = (fallback: number): number =>
      (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? fallback;

    // Banda superior con branding.
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, ANCHO, 22, 'F');
    doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(255, 255, 255);
    doc.text(this.corto(st.form_name, 60), M, 9.5);
    doc.setFont('helvetica', 'normal').setFontSize(8.5);
    doc.text(`Detalle de respuesta #${sub.id}`, M, 16);
    const marca = 'TuApo · Formularios Dinámicos';
    doc.text(marca, M + CONTENIDO - doc.getTextWidth(marca), 9.5);
    const sello = `Generado ${this.fechaHoraPdf(generado)}`;
    doc.text(sello, M + CONTENIDO - doc.getTextWidth(sello), 16);

    let y = 28;

    // Metadatos de la respuesta.
    const metaBody: RowInput[] = [
      ['Formulario', st.form_name],
      ['Versión', this.versionLabel() + (this.versionDeprecada() ? ' (estructura histórica)' : '')],
      ['Estado', this.estadoLabel() || sub.status],
      [this.etiquetaFecha(), this.fechaHoraIso(this.fechaEnvio())],
      ['Autor', this.autor()],
    ];
    autoTable(doc, {
      startY: y,
      body: metaBody,
      theme: 'grid',
      margin: { left: M, right: M },
      styles: {
        font: 'helvetica', fontSize: 8, cellPadding: { top: 1.4, bottom: 1.4, left: 2, right: 2 },
        lineColor: BORDE, lineWidth: 0.1, textColor: [15, 23, 42], overflow: 'linebreak',
      },
      columnStyles: {
        0: { cellWidth: 45, fontStyle: 'bold', textColor: PIZARRA, fillColor: [248, 250, 252] },
        1: { cellWidth: CONTENIDO - 45 },
      },
    });
    y = finalY(y) + 8;

    // Una tabla campo/valor por sección, en el MISMO orden de la estructura.
    for (const vm of this.seccionesVista()) {
      if (y > ALTO - 40) { doc.addPage(); y = 20; }

      if (vm.sec.title) {
        doc.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(...NAVY);
        doc.text(vm.sec.title.toUpperCase(), M, y + 3.2);
        doc.setDrawColor(...NAVY).setLineWidth(0.4);
        doc.line(M, y + 4.6, M + CONTENIDO, y + 4.6);
        y += 7;
      }

      const body: RowInput[] = [];
      for (const f of vm.campos) {
        if (f.type === 'SECTION') {
          // Grupo anidado: fila de título y luego sus hijos (los valores viven
          // planos en el mismo mapa de la sección).
          body.push([{
            content: f.label || 'Grupo',
            colSpan: 2,
            styles: { fillColor: SUBHEAD, fontStyle: 'bold', textColor: NAVY },
          }]);
          for (const child of (f.children ?? []).filter(c => c.type !== 'COMMENT')) {
            body.push([child.label, this.valorPdf(child, vm.valores[child.name ?? ''] ?? null)]);
          }
        } else {
          body.push([f.label, this.valorPdf(f, this.valorDe(vm, f))]);
        }
      }
      if (body.length === 0) continue;

      autoTable(doc, {
        startY: y,
        head: [['Campo', 'Valor']],
        body,
        theme: 'grid',
        margin: { left: M, right: M },
        styles: {
          font: 'helvetica', fontSize: 8, cellPadding: { top: 1.4, bottom: 1.4, left: 2, right: 2 },
          lineColor: BORDE, lineWidth: 0.1, textColor: [15, 23, 42], overflow: 'linebreak',
        },
        headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontSize: 7.6, fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 62, fontStyle: 'bold', textColor: PIZARRA, fillColor: [248, 250, 252] },
          1: { cellWidth: CONTENIDO - 62 },
        },
        alternateRowStyles: { fillColor: [252, 253, 254] },
      });
      y = finalY(y) + 8;
    }

    // Pie con paginación (al final, cuando ya se sabe el total).
    const total = doc.getNumberOfPages();
    for (let p = 1; p <= total; p++) {
      doc.setPage(p);
      doc.setDrawColor(...BORDE).setLineWidth(0.2);
      doc.line(M, ALTO - 12, M + CONTENIDO, ALTO - 12);
      doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...GRIS);
      doc.text(`TuApo · Formularios Dinámicos · ${this.fechaHoraPdf(generado)}`, M, ALTO - 8);
      const der = `Página ${p} de ${total}`;
      doc.text(der, M + CONTENIDO - doc.getTextWidth(der), ALTO - 8);
    }

    doc.save(`respuesta-${sub.id}.pdf`);
  }

  /** Valor de un campo como TEXTO para el PDF — por TIPO real, sin heurísticas. */
  private valorPdf(field: DynamicField, value: FieldValue): string {
    const vacio = value == null
      || (typeof value === 'string' && value.trim() === '')
      || (Array.isArray(value) && value.length === 0);
    if (vacio) return '—';
    switch (field.type) {
      case 'PHOTO':
      case 'VIDEO':
      case 'FILE':
      case 'SIGNATURE':
      case 'SCAN_DOC':
      case 'SCAN_ID': {
        // Media = nombre(s) de archivo; el binario no viaja al PDF.
        const nombres = asDocumentRefs(value).map(r => r.filename).join(', ');
        return nombres || '—';
      }
      case 'LOCATION': {
        const loc = value as LocationValue;
        return (typeof loc?.lat === 'number' && typeof loc?.lng === 'number')
          ? `${loc.lat}, ${loc.lng}` : '—';
      }
      case 'MULTIPLE_CHOICE':
        // Los choices guardan el label tal cual: se imprimen sin re-mapear.
        return Array.isArray(value) ? (value as string[]).join(', ') : String(value);
      case 'CURRENCY': {
        const n = typeof value === 'number' ? value : Number(value);
        return Number.isFinite(n)
          ? '$ ' + n.toLocaleString('es-CO', { maximumFractionDigits: 2 }) : String(value);
      }
      case 'NUMBER': {
        const n = typeof value === 'number' ? value : Number(value);
        return Number.isFinite(n) ? n.toLocaleString('es-CO') : String(value);
      }
      case 'RATING': {
        const escala = field.schema?.rating_config?.scale_max ?? 5;
        return `${String(value)} / ${escala}`;
      }
      case 'DATE': {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
        return m ? `${m[3]}/${m[2]}/${m[1]}` : String(value);
      }
      default:
        return String(value);
    }
  }

  // ── Utilidades ───────────────────────────────────────────────────────
  private mensajeDe(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const p = err.error as ApiProblem | null;
      if (p?.detail) return p.detail;
      if (err.status === 404) return 'La respuesta o el formulario ya no existe.';
      if (err.status === 403) return 'No tienes permisos para ver esta respuesta.';
      if (err.status === 0) return 'Sin conexión con el servidor. Verifica tu red.';
      return `Error del servidor (${err.status}).`;
    }
    return 'Ocurrió un error inesperado.';
  }

  /** ISO → 'dd/MM/yyyy HH:mm' (es-CO). */
  private fechaHoraIso(v: string | null): string {
    if (!v) return '—';
    const d = new Date(v);
    return isNaN(d.getTime()) ? v : this.fechaHoraPdf(d);
  }

  private fechaHoraPdf(d: Date): string {
    const dos = (n: number) => String(n).padStart(2, '0');
    return `${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${d.getFullYear()} ${dos(d.getHours())}:${dos(d.getMinutes())}`;
  }

  private corto(v: string | null | undefined, max: number): string {
    const s = (v ?? '').trim();
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }
}
