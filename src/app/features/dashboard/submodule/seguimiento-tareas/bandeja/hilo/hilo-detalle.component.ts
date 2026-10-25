import { ChangeDetectionStrategy, Component, ElementRef, OnChanges, OnDestroy, SimpleChanges, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { LowerCasePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { DomSanitizer } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { BandejaApiService } from '../bandeja-api.service';
import { AdjuntoVista, Compromiso, HiloDetalle, MensajeVista, TipoCompromiso } from '../bandeja.models';
import { ESTADOS_HILO, ESTADOS_TAREA, TIPOS_COMPROMISO, cuando, enlaceResponder, escapar, fechaHora, iconoCanal, tituloHilo, venceTexto } from '../bandeja-ui';
import { mensajeError } from '../../utils/tareas-ui';
import { TareasDialogosService } from '../../services/tareas-dialogos.service';
import { DocViewerService } from '@/app/shared/services/doc-viewer/doc-viewer.service';
import { AvisoDialogComponent } from '@/app/shared/components/confirm-dialog/confirm-dialog.component';

/**
 * Una conversación: mensajes, lo que la IA leyó (resumen, si hace falta responder, una
 * respuesta sugerida para copiar), compromisos, tareas de Seguimiento Tareas y el histórico.
 * La bandeja no envía: "Responder" abre el WhatsApp o el correo de la persona con el texto.
 * En supervisión todo es de solo lectura.
 */
@Component({
  selector: 'app-hilo-detalle',
  standalone: true,
  imports: [FormsModule, LowerCasePipe, RouterLink, MatIconModule, MatButtonModule, MatMenuModule, MatTooltipModule, MatProgressSpinnerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './hilo-detalle.component.html',
  styleUrls: ['../bandeja-comun.css', './hilo-detalle.component.css'],
})
export class HiloDetalleComponent implements OnChanges, OnDestroy {
  private readonly api = inject(BandejaApiService);
  private readonly snack = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly dialogos = inject(TareasDialogosService);
  private readonly visor = inject(DocViewerService);
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);

  readonly hiloId = input.required<string>();
  readonly cerrar = output<void>();
  readonly cambio = output<void>();

  readonly d = signal<HiloDetalle | null>(null);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly ocupado = signal<string | null>(null);
  readonly verHistorial = signal(false);
  readonly sugerida = signal('');
  readonly htmlAbierto = signal<{ id: number; url: string } | null>(null);
  readonly nuevo = signal<{ tipo: TipoCompromiso; descripcion: string; vence_en: string } | null>(null);
  private readonly mensajesEl = viewChild<ElementRef<HTMLElement>>('mensajesEl');

  readonly ESTADOS = ESTADOS_HILO;
  readonly TIPOS = TIPOS_COMPROMISO;
  readonly ESTADOS_TAREA = ESTADOS_TAREA;
  readonly cuando = cuando;
  readonly fechaHora = fechaHora;
  readonly venceTexto = venceTexto;
  readonly iconoCanal = iconoCanal;
  readonly tipos: TipoCompromiso[] = ['SOLICITUD', 'MIO', 'DEL_CONTACTO'];

  readonly h = computed(() => this.d()?.hilo ?? null);
  readonly dueno = computed(() => !!this.d()?.es_dueno);
  readonly titulo = computed(() => tituloHilo(this.h()));
  readonly abiertos = computed(() => (this.d()?.compromisos ?? []).filter(c => c.estado === 'PENDIENTE' || c.estado === 'EN_CURSO'));
  readonly cerrados = computed(() => (this.d()?.compromisos ?? []).filter(c => c.estado === 'CUMPLIDO' || c.estado === 'DESCARTADO'));
  /** Correo de quien escribió de último, para "Responder en mi correo". */
  readonly correoContacto = computed(() => {
    const ms = this.d()?.mensajes ?? [];
    for (let i = ms.length - 1; i >= 0; i--) if (ms[i].direccion === 'ENTRANTE' && ms[i].remitente?.includes('@')) return ms[i].remitente;
    return null;
  });
  /** URL blob propia (HTML del correo) para el iframe con sandbox vacío: sin scripts ni origen. */
  readonly htmlSeguro = computed(() => {
    const a = this.htmlAbierto();
    return a ? this.sanitizer.bypassSecurityTrustResourceUrl(a.url) : null;
  });
  readonly enlace = computed(() => {
    const h = this.h();
    return h ? enlaceResponder(h, this.sugerida(), this.correoContacto()) : null;
  });

  ngOnChanges(c: SimpleChanges): void {
    if (c['hiloId']) {
      this.cerrarHtml();
      void this.cargar(true);
    }
  }

  ngOnDestroy(): void {
    this.cerrarHtml();
  }

  async cargar(primera = false): Promise<void> {
    this.cargando.set(primera);
    this.error.set(null);
    try {
      const d = await this.api.hilo(this.hiloId());
      this.d.set(d);
      this.sugerida.set(d.hilo.respuesta_sugerida ?? '');
      if (primera) {
        this.bajar();
        if (d.es_dueno && d.hilo.no_leidos > 0) {
          await this.api.leido(d.hilo.id);
          this.cambio.emit();
        }
      }
    } catch (e) {
      this.error.set(mensajeError(e, 'No se pudo abrir la conversación.'));
    } finally {
      this.cargando.set(false);
    }
  }

  private bajar(): void {
    setTimeout(() => {
      const el = this.mensajesEl()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 0);
  }

  async anteriores(): Promise<void> {
    const d = this.d();
    if (!d || !d.mensajes.length) return;
    try {
      const r = await this.api.masMensajes(d.hilo.id, d.mensajes[0].id);
      this.d.set({ ...d, mensajes: [...r.mensajes, ...d.mensajes], hay_mas: r.hay_mas });
    } catch (e) {
      this.snack.open(mensajeError(e), 'Cerrar', { duration: 4500 });
    }
  }

  private async hacer(clave: string, f: () => Promise<unknown>, ok?: string): Promise<void> {
    this.ocupado.set(clave);
    try {
      await f();
      if (ok) this.snack.open(ok, undefined, { duration: 2500 });
      await this.cargar();
      this.cambio.emit();
    } catch (e) {
      this.snack.open(mensajeError(e), 'Cerrar', { duration: 4500 });
    } finally {
      this.ocupado.set(null);
    }
  }

  estado(estado: 'RESUELTO' | 'ARCHIVADO' | 'ABIERTO'): void {
    const h = this.h();
    if (!h) return;
    const textos = { RESUELTO: 'Conversación resuelta', ARCHIVADO: 'Conversación archivada', ABIERTO: 'Conversación reabierta' };
    void this.hacer('estado', () => this.api.estado(h.id, estado), textos[estado]);
  }

  marcar(b: { ignorado?: boolean; fijado?: boolean; prioridad?: string }): void {
    const h = this.h();
    if (h) void this.hacer('marcar', () => this.api.marcar(h.id, b));
  }

  analizar(): void {
    const h = this.h();
    if (h) void this.hacer('analizar', () => this.api.analizar(h.id), 'La IA volvió a leer la conversación');
  }

  async copiar(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.sugerida());
      this.snack.open('Respuesta copiada', undefined, { duration: 2000 });
    } catch {
      this.snack.open('No se pudo copiar', 'Cerrar', { duration: 3000 });
    }
  }

  // ───────── compromisos ─────────

  compromisoEstado(c: Compromiso, estado: string): void {
    void this.hacer('c-' + c.id, () => this.api.actualizarCompromiso(c.id, { estado }),
      estado === 'CUMPLIDO' ? 'Compromiso cumplido' : estado === 'DESCARTADO' ? 'Compromiso descartado' : undefined);
  }

  compromisoFecha(c: Compromiso, fecha: string): void {
    void this.hacer('c-' + c.id, () => this.api.actualizarCompromiso(c.id, fecha ? { vence_en: fecha } : { quitar_vencimiento: true }));
  }

  abrirNuevo(): void {
    this.nuevo.set({ tipo: 'SOLICITUD', descripcion: '', vence_en: '' });
  }

  guardarNuevo(): void {
    const n = this.nuevo();
    const h = this.h();
    if (!n || !h || !n.descripcion.trim()) return;
    void this.hacer('nuevo', () => this.api.crearCompromiso({
      hilo_id: h.id, tipo: n.tipo, descripcion: n.descripcion.trim(), vence_en: n.vence_en || null,
    }), 'Compromiso anotado').then(() => this.nuevo.set(null));
  }

  actualizarNuevo(campo: 'tipo' | 'descripcion' | 'vence_en', valor: string): void {
    const n = this.nuevo();
    if (n) this.nuevo.set({ ...n, [campo]: valor } as typeof n);
  }

  // ───────── tareas ─────────

  /** Crea la tarea en Seguimiento Tareas con origen en esta conversación (o en un compromiso). */
  async crearTarea(c?: Compromiso): Promise<void> {
    const h = this.h();
    if (!h) return;
    const lineas = [
      h.resumen ? `Resumen: ${h.resumen}` : '',
      c?.evidencia ? `Lo que dijeron: «${c.evidencia}»` : '',
      `Conversación: ${tituloHilo(h)} (${h.canal === 'CORREO' ? 'correo' : 'WhatsApp'})`,
    ].filter(Boolean);
    const t = await this.dialogos.nuevaTarea({
      titulo: c ? c.descripcion : `Responder a ${tituloHilo(h)}${h.asunto ? ' — ' + h.asunto : ''}`,
      descripcion: lineas.join('\n'),
      vence: c?.vence_en ? new Date(`${c.vence_en}T17:00:00`) : null,
      origen: {
        tipo: 'COMUNICACION',
        ref: c ? `compromiso:${c.id}` : `hilo:${h.id}`,
        url: `tareas/bandeja?hilo=${h.id}`,
        etiqueta: tituloHilo(h),
      },
    });
    if (!t) return;
    try { await this.api.sincronizarTareas(); } catch { /* la sincronización periódica la recoge */ }
    this.snack.open('Tarea creada y ligada a la conversación', undefined, { duration: 2500 });
    await this.cargar();
    this.cambio.emit();
  }

  tieneTarea(c: Compromiso): boolean {
    return (this.d()?.tareas ?? []).some(t => t.compromiso_id === c.id);
  }

  abrirTarea(id: number): void {
    void this.router.navigate(['/dashboard/tareas/tarea', id]);
  }

  // ───────── mensajes ─────────

  async verAdjunto(m: MensajeVista, a: AdjuntoVista): Promise<void> {
    if (!a.disponible) {
      this.snack.open('Este archivo no se descargó (era muy grande o es historial)', 'Cerrar', { duration: 3500 });
      return;
    }
    const blob = await this.visor.fetchBlob(this.api.urlAdjunto(a.id));
    if (!blob) {
      this.snack.open('No se pudo abrir el archivo', 'Cerrar', { duration: 3500 });
      return;
    }
    const lista = m.adjuntos.filter(x => x.disponible);
    const i = Math.max(0, lista.findIndex(x => x.id === a.id));
    const archivos = await Promise.all(lista.map(async x => {
      const b = x.id === a.id ? blob : await this.visor.fetchBlob(this.api.urlAdjunto(x.id));
      return { nombre: x.nombre ?? 'archivo', mime: x.mime, tamano: x.tamano ?? 0, archivo: b ? new File([b], x.nombre ?? 'archivo', { type: x.mime ?? b.type }) : undefined };
    }));
    await this.dialogos.verArchivos(archivos, i);
  }

  /** El correo tal como llegó: HTML en un iframe sin scripts (sandbox vacío), servido por blob. */
  async verHtml(m: MensajeVista): Promise<void> {
    if (this.htmlAbierto()?.id === m.id) { this.cerrarHtml(); return; }
    try {
      const html = await this.api.htmlMensaje(m.id);
      this.cerrarHtml();
      // Sin imágenes remotas: un píxel de rastreo le avisaría al remitente que se abrió el correo.
      const politica = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'">`;
      const url = URL.createObjectURL(new Blob([politica + html], { type: 'text/html' }));
      this.htmlAbierto.set({ id: m.id, url });
    } catch (e) {
      this.snack.open(mensajeError(e), 'Cerrar', { duration: 3500 });
    }
  }

  cerrarHtml(): void {
    const a = this.htmlAbierto();
    if (a) URL.revokeObjectURL(a.url);
    this.htmlAbierto.set(null);
  }

  destinatarios(m: MensajeVista): string {
    try {
      const d = JSON.parse(m.destinatarios_json ?? '[]') as { nombre: string | null; direccion: string; tipo: string }[];
      return d.map(x => (x.tipo === 'cc' ? 'cc: ' : '') + (x.nombre || x.direccion)).join(', ');
    } catch { return ''; }
  }

  async confirmarIgnorar(): Promise<void> {
    const h = this.h();
    if (!h) return;
    if (h.ignorado) { this.marcar({ ignorado: false }); return; }
    const ref = this.dialog.open(AvisoDialogComponent, {
      data: {
        icono: 'warning', titulo: 'Dejar de seguir',
        html: `«${escapar(tituloHilo(h))}» ya no contará como pendiente ni la leerá la IA. Puedes volver a seguirla desde «No seguidas».`,
        textoConfirmar: 'Dejar de seguir', textoCancelar: 'Cancelar',
      },
      autoFocus: false,
    });
    if (await firstValueFrom(ref.afterClosed())) this.marcar({ ignorado: true });
  }

  etiquetaEstadoEnvio(e: string | null): string {
    return e === 'LEIDO' ? 'Leído' : e === 'ENTREGADO' ? 'Entregado' : e === 'ENVIADO' ? 'Enviado' : '';
  }
}
