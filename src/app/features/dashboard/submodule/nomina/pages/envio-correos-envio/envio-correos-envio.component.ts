import {
  ChangeDetectionStrategy, Component, ElementRef, OnInit, computed, inject, signal, viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml, Title } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import Swal from 'sweetalert2';

import {
  CampoPlantilla, EnvioCorreosService, EnvioItem, EstadoEnvioItem, LoteDetalle,
  PeriodoDisponible, Plantilla, PreviewCorreo, TipoRef,
} from '../../service/envio-correos/envio-correos.service';

/** Destinatarios por petición. Cada uno adjunta un PDF y habla con el SMTP. */
const TAMANO_TANDA = 20;

/**
 * Nómina → Envío de correos (modelo antiguo) → Enviar.
 *
 * Reúne en una sola pantalla lo que antes eran una hoja de cálculo, una carpeta
 * de Drive y dos botones de Apps Script:
 *
 *   1. Quincena, empresa y tipo.
 *   2. Plantilla del correo, con **preview renderizado sobre una persona real**
 *      de esa quincena — no sobre datos inventados.
 *   3. Corrección de correos por Excel (descargar prellenado → completar → subir).
 *   4. Preparar: se ve a quién le falta correo o documento ANTES de enviar.
 *   5. Enviar por tandas, con progreso y detalle de fallos.
 *
 * El paso 4 existe porque el error caro aquí no es que falle un envío, sino
 * mandar 1500 correos y descubrir después que 200 fueron al vacío.
 */
@Component({
  selector: 'app-envio-correos-envio',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule, MatButtonModule, MatCardModule, MatCheckboxModule,
    MatExpansionModule, MatFormFieldModule, MatIconModule, MatInputModule,
    MatProgressBarModule, MatSelectModule, MatTableModule, MatTooltipModule,
  ],
  templateUrl: './envio-correos-envio.component.html',
  styleUrl: './envio-correos-envio.component.css',
})
export class EnvioCorreosEnvioComponent implements OnInit {
  private srv = inject(EnvioCorreosService);
  private titulo = inject(Title);
  private sanitizer = inject(DomSanitizer);

  readonly inputExcel = viewChild<ElementRef<HTMLInputElement>>('inputExcel');

  // ── Estado ────────────────────────────────────────────────────────────────
  readonly cargando = signal(false);
  readonly enviando = signal(false);
  readonly periodos = signal<PeriodoDisponible[]>([]);
  readonly tipos = signal<TipoRef[]>([]);
  readonly plantillas = signal<Plantilla[]>([]);
  readonly campos = signal<CampoPlantilla[]>([]);
  readonly preview = signal<PreviewCorreo | null>(null);
  readonly detalle = signal<LoteDetalle | null>(null);

  // Selección
  readonly periodoSel = signal<string | null>(null);
  readonly empresaSel = signal<string | null>(null);
  readonly tipoSel = signal<'NOMINA' | 'LIQUIDACION' | null>('NOMINA');
  readonly typeIdSel = signal<number | null>(null);
  readonly plantillaSel = signal<number | null>(null);
  readonly omitirYaEnviados = signal(true);

  // Progreso del envío
  readonly enviados = signal(0);
  readonly totalAEnviar = signal(0);
  readonly fallosEnvio = signal<{ cedula: string; correo: string; motivo: string }[]>([]);

  // ── Derivados ─────────────────────────────────────────────────────────────
  readonly lote = computed(() => this.detalle()?.lote ?? null);
  readonly listos = computed(() => this.detalle()?.listos_para_enviar ?? 0);
  readonly problemas = computed<EnvioItem[]>(() => this.detalle()?.items_con_problema ?? []);
  readonly advertencias = computed<string[]>(() => this.detalle()?.advertencias ?? []);

  readonly resumen = computed(() => {
    const r = this.detalle()?.resumen ?? {};
    return Object.entries(r)
      .map(([estado, total]) => ({ estado: estado as EstadoEnvioItem, total }))
      .sort((a, b) => b.total - a.total);
  });

  readonly progreso = computed(() => {
    const t = this.totalAEnviar();
    return t === 0 ? 0 : Math.round((this.enviados() / t) * 100);
  });

  /**
   * El HTML del preview lo genera el backend a partir de una plantilla que
   * escribe el área de nómina, y los valores interpolados ya vienen escapados
   * allí. Angular lo bloquearía por defecto; se marca como confiable para poder
   * mostrar el correo tal como va a llegar, que es el objetivo del preview.
   */
  readonly previewHtml = computed<SafeHtml>(() =>
    this.sanitizer.bypassSecurityTrustHtml(this.preview()?.cuerpo_html ?? ''));

  readonly columnasProblemas = ['cedula', 'nombre', 'correo', 'estado', 'motivo'];

  async ngOnInit(): Promise<void> {
    this.titulo.setTitle('Enviar correos | Envío de correos (modelo antiguo)');
    this.cargando.set(true);
    try {
      const [periodos, tipos, plantillas, campos] = await Promise.all([
        firstValueFrom(this.srv.periodos()),
        firstValueFrom(this.srv.tiposDisponibles()),
        firstValueFrom(this.srv.plantillas()),
        firstValueFrom(this.srv.camposPlantilla()),
      ]);
      this.periodos.set(periodos.content);
      this.tipos.set(tipos);
      this.plantillas.set(plantillas.content.filter((p) => p.activo));
      this.campos.set(campos.content);
      if (periodos.content.length) this.periodoSel.set(periodos.content[0].clave);
      await this.refrescarPreview();
    } catch (e: any) {
      this.error(e?.error?.error ?? 'No se pudo cargar la configuración de envío.');
    } finally {
      this.cargando.set(false);
    }
  }

  // ── Plantilla y preview ───────────────────────────────────────────────────

  async refrescarPreview(): Promise<void> {
    if (!this.plantillaSel() && !this.plantillas().length) return;
    try {
      this.preview.set(await firstValueFrom(this.srv.previewPlantilla({
        plantilla_id: this.plantillaSel(),
        periodo_clave: this.periodoSel(),
        empresa: this.empresaSel(),
        tipo: this.tipoSel(),
      })));
    } catch (e: any) {
      // Un preview que no sale no debe bloquear la pantalla; se avisa y ya.
      this.preview.set(null);
      this.error(e?.error?.error ?? 'No se pudo generar la vista previa.');
    }
  }

  onCambioSeleccion(): void {
    // Cambiar quincena/empresa/tipo invalida el lote preparado: se armó con
    // otros criterios y enviarlo mandaría el corte equivocado.
    this.detalle.set(null);
    this.refrescarPreview();
  }

  // ── Corrección de correos por Excel ───────────────────────────────────────

  async descargarExcel(): Promise<void> {
    const periodo = this.periodoSel();
    if (!periodo) { this.error('Selecciona primero la quincena.'); return; }
    try {
      const blob = await firstValueFrom(
        this.srv.descargarPlantillaCorreos(periodo, this.empresaSel()));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `correos-${periodo}${this.empresaSel() ? '-' + this.empresaSel() : ''}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      this.error('No se pudo descargar la plantilla de correos.');
    }
  }

  abrirSelectorExcel(): void {
    this.inputExcel()?.nativeElement.click();
  }

  async onExcelSeleccionado(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.cargando.set(true);
    try {
      const r = await firstValueFrom(this.srv.cargarPlantillaCorreos(file));
      const detalle = r.detalle_invalidos.length
        ? `<br><br><b>Filas con problema:</b><br><small>${r.detalle_invalidos.slice(0, 10).join('<br>')}</small>`
        : '';
      await Swal.fire({
        icon: r.invalidos > 0 ? 'warning' : 'success',
        title: 'Correos actualizados',
        html: `Leídas <b>${r.filas_leidas}</b> filas.<br>
               Actualizados: <b>${r.actualizados}</b><br>
               Sin cambio: ${r.sin_cambio}<br>
               Inválidos: <b>${r.invalidos}</b>${detalle}`,
      });
      // El lote preparado quedó con los correos viejos.
      if (this.detalle()) this.detalle.set(null);
    } catch (e: any) {
      this.error(e?.error?.error ?? 'No se pudo procesar el Excel.');
    } finally {
      this.cargando.set(false);
    }
  }

  // ── Preparar ──────────────────────────────────────────────────────────────

  async preparar(): Promise<void> {
    const periodo = this.periodoSel();
    if (!periodo) { this.error('Selecciona la quincena.'); return; }

    this.cargando.set(true);
    this.fallosEnvio.set([]);
    try {
      this.detalle.set(await firstValueFrom(this.srv.prepararLote({
        periodo_clave: periodo,
        empresa: this.empresaSel(),
        type_id: this.typeIdSel(),
        tipo: this.tipoSel(),
        plantilla_id: this.plantillaSel(),
        omitir_ya_enviados: this.omitirYaEnviados(),
      })));
    } catch (e: any) {
      this.error(e?.error?.error ?? 'No se pudo preparar el envío.');
    } finally {
      this.cargando.set(false);
    }
  }

  // ── Enviar ────────────────────────────────────────────────────────────────

  async enviar(): Promise<void> {
    const lote = this.lote();
    if (!lote || this.enviando()) return;

    const total = this.listos();
    const confirma = await Swal.fire({
      icon: 'warning',
      title: '¿Enviar los correos?',
      html: `Se van a enviar <b>${total}</b> correo(s) de
             <b>${lote.periodo_etiqueta}</b>.<br><br>
             Esto <b>manda correos reales</b> a las personas. Revisa antes la vista
             previa y los ${this.problemas().length} caso(s) con problema.`,
      showCancelButton: true,
      confirmButtonText: `Sí, enviar ${total}`,
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#d93025',
    });
    if (!confirma.isConfirmed) return;

    this.enviando.set(true);
    this.enviados.set(0);
    this.totalAEnviar.set(total);
    this.fallosEnvio.set([]);

    try {
      let quedan = true;
      while (quedan) {
        const r = await firstValueFrom(this.srv.enviarTanda(lote.id, TAMANO_TANDA));
        this.enviados.update((n) => n + r.enviados);

        const fallos = r.resultados
          .filter((i) => i.estado === 'FALLIDO')
          .map((i) => ({
            cedula: i.cedula,
            correo: i.correo ?? '—',
            motivo: i.motivo ?? 'Error sin detalle.',
          }));
        if (fallos.length) this.fallosEnvio.update((prev) => [...prev, ...fallos]);

        // El backend puede cortar la tanda por cuota agotada; si avisa, se para.
        if (r.advertencias.some((a) => a.includes('Se detuvo la tanda'))) {
          await Swal.fire({
            icon: 'warning',
            title: 'Envío detenido',
            html: r.advertencias.join('<br>') +
              '<br><br>Lo ya enviado quedó registrado. Puedes continuar mañana con el mismo lote.',
          });
          break;
        }
        quedan = r.pendientes > 0;
      }

      this.detalle.set(await firstValueFrom(this.srv.obtenerLoteEnvio(lote.id)));
      const fallidos = this.fallosEnvio().length;
      await Swal.fire({
        icon: fallidos ? 'warning' : 'success',
        title: fallidos ? 'Envío terminado con errores' : 'Envío completado',
        html: fallidos
          ? `Se enviaron ${this.enviados()} correo(s) y fallaron ${fallidos}.
             Puedes reintentar solo los fallidos.`
          : `Se enviaron ${this.enviados()} correo(s).`,
      });
    } catch (e: any) {
      this.error(e?.error?.error
        ?? 'El envío se interrumpió. Lo ya enviado quedó registrado en el histórico.');
    } finally {
      this.enviando.set(false);
    }
  }

  async reintentar(): Promise<void> {
    const lote = this.lote();
    if (!lote) return;
    this.cargando.set(true);
    try {
      this.detalle.set(await firstValueFrom(this.srv.reintentarFallidos(lote.id)));
      this.fallosEnvio.set([]);
    } catch (e: any) {
      this.error(e?.error?.error ?? 'No se pudo reintentar.');
    } finally {
      this.cargando.set(false);
    }
  }

  // ── Presentación ──────────────────────────────────────────────────────────

  etiquetaEstado(estado: EstadoEnvioItem): string {
    const mapa: Record<EstadoEnvioItem, string> = {
      PENDIENTE: 'Listos para enviar',
      ENVIADO: 'Enviados',
      FALLIDO: 'Fallidos',
      SIN_CORREO: 'Sin correo',
      SIN_DOCUMENTO: 'Sin documento',
      OMITIDO: 'Omitidos',
    };
    return mapa[estado] ?? estado;
  }

  claseEstado(estado: EstadoEnvioItem): string {
    if (estado === 'ENVIADO' || estado === 'PENDIENTE') return 'chip-ok';
    if (estado === 'OMITIDO') return 'chip-neutro';
    return 'chip-alerta';
  }

  private error(mensaje: string): void {
    Swal.fire({ icon: 'error', title: 'Error', text: mensaje });
  }
}
