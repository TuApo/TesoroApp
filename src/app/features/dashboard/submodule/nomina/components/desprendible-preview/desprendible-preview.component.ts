import {
  Component, ChangeDetectionStrategy, OnInit, inject, signal, computed,
  ElementRef, viewChild,
} from '@angular/core';
import { CommonModule, DatePipe, registerLocaleData } from '@angular/common';
import localeEsCO from '@angular/common/locales/es-CO';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import {
  NominaService, DesprendibleData, DesprendibleConcepto, DesprendibleNovedad,
} from '../../service/nomina/nomina.service';

// Locale es-CO está pre-empaquetada en Angular; registrarla una sola vez por
// componente es barato y autocontenido. Hace que DatePipe/CurrencyPipe
// formateen meses en español y miles con punto, sin tocar app-wide config.
registerLocaleData(localeEsCO);

export interface DesprendiblePreviewData {
  /** id_nomina_emp de la fila de histórico clicada. */
  idNominaEmp: number;
}

@Component({
  selector: 'app-desprendible-preview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, MatDialogModule, MatButtonModule, MatIconModule,
    MatProgressSpinnerModule,
  ],
  providers: [DatePipe],
  templateUrl: './desprendible-preview.component.html',
  styleUrl: './desprendible-preview.component.scss',
})
export class DesprendiblePreviewComponent implements OnInit {
  private svc = inject(NominaService);
  private ref = inject(MatDialogRef<DesprendiblePreviewComponent>);
  readonly data = inject<DesprendiblePreviewData>(MAT_DIALOG_DATA);

  readonly pageRef = viewChild<ElementRef<HTMLElement>>('pageRef');

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly desprendible = signal<DesprendibleData | null>(null);
  readonly downloading = signal(false);

  /** Colores derivados del branding de la empresa emisora con fallback al
   *  azul/naranja de la plantilla original. Se inyectan como CSS vars en
   *  el host. */
  readonly accent = computed(() => this.desprendible()?.empresa?.color_primario ?? '#F58634');
  readonly secondary = computed(() => this.desprendible()?.empresa?.color_secundario ?? '#134DA8');

  /** URL del logo a mostrar. Si la empresa emisora aún no tiene capturado
   *  `logo_url` (caso típico hasta que se inserte la fila EMPRESA_PROPIA en
   *  nomina_entidades_externas), caemos al logo institucional bundleado en
   *  public/logos/. Path relativo para que funcione bajo cualquier base href.
   *  Misma origin = sin problema CORS al embed en html2canvas. */
  readonly logoSrc = computed(() => this.desprendible()?.empresa?.logo_url || 'logos/Logo_AL.png');

  /** Novedades informativas del período (incapacidad, ausencia, suspensión,
   *  sanción, permiso, luto…). No mueven el neto pero explican el resultado. */
  readonly novedadesInformativas = computed<DesprendibleNovedad[]>(
    () => this.desprendible()?.novedades_informativas ?? []);

  /** True cuando la liquidación no arroja pago neto. En ese caso la sección de
   *  novedades resalta el motivo (qué novedad quitó / redujo el pago). */
  readonly sinPago = computed(() => {
    const neto = this.desprendible()?.totales?.neto_pagar;
    return neto == null || neto <= 0;
  });

  ngOnInit(): void {
    this.svc.getDesprendible(this.data.idNominaEmp).subscribe({
      next: (d) => {
        this.desprendible.set(d);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(e?.error?.error ?? 'No fue posible cargar el desprendible.');
        this.loading.set(false);
      },
    });
  }

  cerrar(): void { this.ref.close(); }

  /**
   * Descarga el desprendible como PDF. Convierte el `.page` con html2canvas
   * (alta resolución vía scale=2 para evitar texto borroso), lo embebe en
   * un jspdf en formato carta (igual que la plantilla original), y fuerza
   * descarga. Cargas dinámicas para no inflar el bundle inicial.
   */
  async descargarPdf(): Promise<void> {
    const el = this.pageRef()?.nativeElement;
    if (!el || this.downloading()) return;
    this.downloading.set(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const canvas = await html2canvas(el, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        // Letter @ 96dpi → el .page mide 816×1056. Doblamos a 1632×2112 px
        // para texto nítido cuando jspdf escale a la página.
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
      // pt letter: 612×792. La imagen se mete a ancho completo y el alto
      // se ajusta proporcionalmente; con un .page bien dimensionado entra
      // en una sola página (1056/816 ≈ 1.294 vs 792/612 ≈ 1.294, match).
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const ratio = canvas.height / canvas.width;
      let imgW = pageW;
      let imgH = pageW * ratio;
      if (imgH > pageH) { imgH = pageH; imgW = pageH / ratio; }
      pdf.addImage(imgData, 'PNG', 0, 0, imgW, imgH, undefined, 'FAST');
      const d = this.desprendible();
      const nombre = (d?.empleado?.numero_documento ?? 'desprendible') + '_' +
                     (d?.nomina?.periodo_inicio ?? '');
      pdf.save(`desprendible_${nombre}.pdf`);
    } catch (e: any) {
      this.error.set('No fue posible generar el PDF: ' + (e?.message ?? e));
    } finally {
      this.downloading.set(false);
    }
  }

  /** Helper para iterar por concepto sin colisionar con ngFor en HTML. */
  trackConcepto(_i: number, c: DesprendibleConcepto): string {
    return c.codigo_concepto + '|' + (c.valor ?? 0);
  }

  /** Track para las novedades informativas (código + índice: puede repetirse
   *  el mismo código con distinto detalle en un período). */
  trackNovedad(i: number, n: DesprendibleNovedad): string {
    return n.codigo_concepto + '|' + i;
  }

  /** Etiqueta legible de la naturaleza de una novedad informativa. */
  naturalezaLabel(n: string | null | undefined): string {
    switch ((n ?? '').toUpperCase()) {
      case 'INFORMATIVO':
      case 'INFORMATIVA': return 'Informativa';
      case 'OTRO': return 'Novedad';
      default: return n ?? 'Novedad';
    }
  }

  /** Devuelve "—" para valores vacíos/nulos/cero, manteniendo la convención
   *  visual de la plantilla original que pinta guion en celdas vacías. */
  formatCantidad(c: number | null | undefined): string {
    if (c == null || c === 0) return '—';
    return c.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
