import {
  ChangeDetectionStrategy, Component, OnInit, computed, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml, Title } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import Swal from 'sweetalert2';

import {
  CalendarioCumpleanos, CargaPadron, ConfiguracionCumpleanos, CumpleanosDelDia,
  CumpleanosService, DetalleEnvioCumpleanos, EnvioCumpleanos, PadronPage,
  PersonaCumpleanos, PlantillaEmpresa, PreviewCumpleanos,
} from '../../service/cumpleanos/cumpleanos.service';

/** Una casilla del calendario. `null` = hueco de relleno antes del día 1. */
interface Celda {
  dia: number;
  fecha: string;
  total: number;
  sinCorreo: number;
  enviado: boolean;
  esHoy: boolean;
}

/**
 * Nómina → Envío de correos → **Cumpleaños**.
 *
 * Tres pestañas, en el orden en que se usan:
 *
 *  1. **Hoy** — el calendario del mes con quién cumple cada día, la lista del
 *     día elegido, y un buscador que filtra las dos cosas a la vez.
 *  2. **Padrón** — el Excel que manda: se descarga, se corrige y se vuelve a
 *     subir. Quien viene queda activo; quien no viene, inactivo.
 *  3. **Configuración** — qué plantilla usa cada temporal, a qué hora sale y el
 *     interruptor del envío automático.
 *
 * <h3>Por qué el buscador filtra también el calendario</h3>
 * Porque si solo filtrara la lista, buscar a alguien obligaría a ir mes a mes
 * adivinando en cuál cae. Filtrando el calendario, los días que quedan pintados
 * SON los días en que cumple quien buscas.
 *
 * <h3>Por qué la carga muestra tantos números</h3>
 * Porque subir un archivo recortado por error se ve EXACTAMENTE igual que una
 * carga correcta si no se dice cuánta gente quedó inactiva.
 */
@Component({
  selector: 'app-envio-correos-cumpleanos',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule, MatButtonModule, MatCardModule, MatChipsModule,
    MatFormFieldModule, MatIconModule, MatInputModule, MatPaginatorModule,
    MatProgressBarModule, MatSelectModule, MatSlideToggleModule, MatTabsModule,
    MatTooltipModule,
  ],
  templateUrl: './envio-correos-cumpleanos.component.html',
  styleUrl: './envio-correos-cumpleanos.component.css',
})
export class EnvioCorreosCumpleanosComponent implements OnInit {
  private srv = inject(CumpleanosService);
  private titulo = inject(Title);
  private sanitizer = inject(DomSanitizer);

  readonly cargando = signal(false);
  readonly enviando = signal(false);
  readonly subiendo = signal(false);

  /** Mensaje cuando la pantalla no pudo cargar. Evita la pestaña en blanco. */
  readonly errorCarga = signal<string | null>(null);

  // ── Hoy: calendario, día y buscador ─────────────────────────────────────────
  readonly hoy = signal<CumpleanosDelDia | null>(null);
  readonly calendario = signal<CalendarioCumpleanos | null>(null);
  readonly fechaSel = signal<string>(this.fechaLocalHoy());
  readonly anio = signal<number>(new Date().getFullYear());
  readonly mes = signal<number>(new Date().getMonth() + 1);
  readonly busqueda = signal('');
  readonly detalleEnvio = signal<DetalleEnvioCumpleanos | null>(null);

  // ── Padrón ──────────────────────────────────────────────────────────────────
  readonly padron = signal<PadronPage | null>(null);
  readonly filtroActivo = signal<'true' | 'false' | 'todos'>('true');
  readonly filtroEmpresa = signal<string>('todos');
  readonly busquedaPadron = signal('');
  readonly pagina = signal(0);
  readonly tamano = signal(50);
  readonly ultimaCarga = signal<CargaPadron | null>(null);
  readonly cargas = signal<CargaPadron[]>([]);

  // ── Configuración ───────────────────────────────────────────────────────────
  readonly configuracion = signal<ConfiguracionCumpleanos | null>(null);
  readonly preview = signal<PreviewCumpleanos | null>(null);
  readonly correoPrueba = signal('');
  readonly empresaPrueba = signal<string>('DEFECTO');
  readonly envios = signal<EnvioCumpleanos[]>([]);

  readonly MESES = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];
  readonly DIAS_SEMANA = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

  readonly previewHtml = computed<SafeHtml>(() =>
    this.sanitizer.bypassSecurityTrustHtml(this.preview()?.cuerpo_html ?? ''));

  readonly nombreMes = computed(() => `${this.MESES[this.mes() - 1]} ${this.anio()}`);

  /**
   * El mes repartido en semanas que empiezan en lunes.
   *
   * Se calcula aquí y no en el template para no rehacerlo en cada ciclo de
   * detección de cambios.
   */
  readonly semanas = computed<(Celda | null)[][]>(() => {
    const cal = this.calendario();
    const primero = new Date(this.anio(), this.mes() - 1, 1);
    const totalDias = new Date(this.anio(), this.mes(), 0).getDate();
    // getDay(): 0 = domingo. Se convierte a 0 = lunes.
    const desplazamiento = (primero.getDay() + 6) % 7;

    const porDia = new Map<number, Celda>();
    for (const d of cal?.dias ?? []) {
      porDia.set(d.dia, {
        dia: d.dia, fecha: d.fecha, total: d.total,
        sinCorreo: d.sin_correo, enviado: d.enviado, esHoy: false,
      });
    }

    const hoyIso = this.fechaLocalHoy();
    const celdas: (Celda | null)[] = Array(desplazamiento).fill(null);
    for (let dia = 1; dia <= totalDias; dia++) {
      const fecha = this.iso(this.anio(), this.mes(), dia);
      const base = porDia.get(dia);
      celdas.push({
        dia,
        fecha,
        total: base?.total ?? 0,
        sinCorreo: base?.sinCorreo ?? 0,
        enviado: base?.enviado ?? false,
        esHoy: fecha === hoyIso,
      });
    }
    while (celdas.length % 7 !== 0) celdas.push(null);

    const filas: (Celda | null)[][] = [];
    for (let i = 0; i < celdas.length; i += 7) filas.push(celdas.slice(i, i + 7));
    return filas;
  });

  /** Aviso de la pantalla: automático encendido sin plantillas = no sale nada. */
  readonly avisoConfig = computed<string | null>(() => {
    const c = this.configuracion();
    if (!c) return null;
    const elegidas = c.plantillas.filter((p) => p.plantilla_id).length;
    if (c.config.auto_activo && elegidas === 0) {
      return 'El envío automático está encendido pero no hay ninguna plantilla elegida: no saldrá ningún correo.';
    }
    if (!c.config.auto_activo) {
      return 'El envío automático está apagado. Los saludos solo saldrán si alguien los manda a mano.';
    }
    const huerfanos = c.plantillas.find((p) => !p.plantilla_id && p.personas > 0);
    if (huerfanos) {
      return `${huerfanos.personas} persona(s) de "${huerfanos.empresa_nombre}" no tienen plantilla asignada y no recibirán el saludo.`;
    }
    return null;
  });

  async ngOnInit(): Promise<void> {
    this.titulo.setTitle('Cumpleaños | Correos electrónicos');
    await this.recargarTodo();
  }

  private async recargarTodo(): Promise<void> {
    this.cargando.set(true);
    this.errorCarga.set(null);
    try {
      const [hoy, cal, cfg] = await Promise.all([
        firstValueFrom(this.srv.delDia(this.fechaSel(), this.busqueda() || null)),
        firstValueFrom(this.srv.calendario(this.anio(), this.mes(), this.busqueda() || null)),
        firstValueFrom(this.srv.configuracion()),
      ]);
      this.hoy.set(hoy);
      this.calendario.set(cal);
      this.configuracion.set(cfg);
      await Promise.all([this.recargarPadron(), this.recargarHistorial(), this.recargarCargas()]);
    } catch (e: any) {
      // Se guarda el motivo en vez de dejar las pestañas vacías: una pantalla en
      // blanco no dice si falta desplegar el backend, si caducó la sesión o si
      // simplemente no hay datos.
      this.errorCarga.set(this.mensaje(e, 'No se pudo cargar el submódulo de cumpleaños.'));
    } finally {
      this.cargando.set(false);
    }
  }

  // ══ Hoy ═══════════════════════════════════════════════════════════════════

  /** El buscador filtra el calendario y la lista a la vez. */
  async buscar(texto: string): Promise<void> {
    this.busqueda.set(texto);
    await this.refrescarDia();
  }

  async limpiarBusqueda(): Promise<void> {
    await this.buscar('');
  }

  async irAMes(delta: number): Promise<void> {
    let m = this.mes() + delta;
    let a = this.anio();
    if (m < 1) { m = 12; a--; }
    if (m > 12) { m = 1; a++; }
    this.mes.set(m);
    this.anio.set(a);
    await this.cargarCalendario();
  }

  async irAHoy(): Promise<void> {
    const hoy = new Date();
    this.anio.set(hoy.getFullYear());
    this.mes.set(hoy.getMonth() + 1);
    this.fechaSel.set(this.fechaLocalHoy());
    await this.refrescarDia();
  }

  async elegirDia(celda: Celda | null): Promise<void> {
    if (!celda) return;
    this.fechaSel.set(celda.fecha);
    this.detalleEnvio.set(null);
    await this.cargarDia();
  }

  /** Salta al día de una persona encontrada por el buscador. */
  async irAPersona(p: PersonaCumpleanos): Promise<void> {
    if (!p.cumple_dia) return;
    const [mm, dd] = p.cumple_dia.split('-').map(Number);
    this.mes.set(mm);
    this.fechaSel.set(this.iso(this.anio(), mm, dd));
    await this.refrescarDia();
  }

  private async cargarCalendario(): Promise<void> {
    try {
      this.calendario.set(await firstValueFrom(
        this.srv.calendario(this.anio(), this.mes(), this.busqueda() || null)));
    } catch (e: any) {
      this.error(this.mensaje(e, 'No se pudo cargar el calendario.'));
    }
  }

  private async cargarDia(): Promise<void> {
    try {
      this.hoy.set(await firstValueFrom(
        this.srv.delDia(this.fechaSel(), this.busqueda() || null)));
    } catch (e: any) {
      this.error(this.mensaje(e, 'No se pudo consultar esa fecha.'));
    }
  }

  private async refrescarDia(): Promise<void> {
    await Promise.all([this.cargarDia(), this.cargarCalendario()]);
  }

  /**
   * Envío a mano.
   *
   * Se confirma antes de mandar porque es irreversible: un correo enviado no se
   * puede recoger.
   */
  async enviarAhora(): Promise<void> {
    const dia = this.hoy();
    if (!dia || dia.total === 0) return;

    const c = await Swal.fire({
      icon: 'question',
      title: '¿Mandar el saludo?',
      html: `Se enviará a <b>${dia.total - dia.sin_correo}</b> persona(s), cada una con la `
          + 'plantilla de su temporal.'
          + (dia.sin_correo > 0
              ? `<br><br><small>${dia.sin_correo} sin correo válido quedarán registradas como tal.</small>`
              : ''),
      showCancelButton: true,
      confirmButtonText: 'Enviar',
      cancelButtonText: 'Cancelar',
    });
    if (!c.isConfirmed) return;

    this.enviando.set(true);
    try {
      const r = await firstValueFrom(this.srv.enviar(this.fechaSel()));
      this.detalleEnvio.set(r);
      Swal.fire({
        icon: r.envio.total_fallidos > 0 ? 'warning' : 'success',
        title: r.envio.total_fallidos > 0 ? 'Enviado con errores' : 'Saludos enviados',
        text: `${r.envio.total_enviados} enviado(s), ${r.envio.total_fallidos} fallido(s).`,
      });
      await this.refrescarDia();
      await this.recargarHistorial();
    } catch (e: any) {
      // 409 = ese día ya salió. No es un fallo: es la protección funcionando.
      if (e?.status === 409) {
        Swal.fire({ icon: 'info', title: 'Ya se envió', text: this.mensaje(e, '') });
        await this.refrescarDia();
      } else {
        this.error(this.mensaje(e, 'No se pudo enviar.'));
      }
    } finally {
      this.enviando.set(false);
    }
  }

  /** Reintenta lo fallido. Los ya enviados no se tocan: nadie recibe dos veces. */
  async reintentar(envioId: number): Promise<void> {
    this.enviando.set(true);
    try {
      const r = await firstValueFrom(this.srv.reintentar(envioId));
      this.detalleEnvio.set(r);
      Swal.fire({ icon: 'success', title: 'Reintento hecho',
        text: `${r.envio.total_enviados} enviado(s) en total, ${r.envio.total_fallidos} sigue(n) fallando.` });
      await this.refrescarDia();
      await this.recargarHistorial();
    } catch (e: any) {
      this.error(this.mensaje(e, 'No se pudo reintentar.'));
    } finally {
      this.enviando.set(false);
    }
  }

  async verDetalle(envioId: number): Promise<void> {
    try {
      this.detalleEnvio.set(await firstValueFrom(this.srv.detalleEnvio(envioId)));
    } catch (e: any) {
      this.error(this.mensaje(e, 'No se pudo abrir el detalle.'));
    }
  }

  private async recargarHistorial(): Promise<void> {
    this.envios.set((await firstValueFrom(this.srv.envios())).content);
  }

  // ══ Padrón ════════════════════════════════════════════════════════════════

  async recargarPadron(): Promise<void> {
    const activo = this.filtroActivo();
    const empresa = this.filtroEmpresa();
    this.padron.set(await firstValueFrom(this.srv.padron({
      activo: activo === 'todos' ? null : activo === 'true',
      empresa: empresa === 'todos' ? null : empresa,
      q: this.busquedaPadron() || null,
      page: this.pagina(),
      size: this.tamano(),
    })));
  }

  async filtrar(): Promise<void> {
    this.pagina.set(0);
    await this.recargarPadron();
  }

  async paginar(e: PageEvent): Promise<void> {
    this.pagina.set(e.pageIndex);
    this.tamano.set(e.pageSize);
    await this.recargarPadron();
  }

  async descargarPadron(): Promise<void> {
    try {
      const blob = await firstValueFrom(this.srv.descargarPadron());
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'cumpleanos.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      this.error('No se pudo descargar el Excel.');
    }
  }

  /**
   * Sube el Excel del padrón.
   *
   * Se avisa ANTES de subir de qué va la operación: el archivo no solo agrega,
   * también deja inactivo a quien no aparezca. Quien lo hace por primera vez no
   * tiene por qué saberlo, y enterarse después es tarde.
   */
  async subirPadron(evento: Event): Promise<void> {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo) return;

    const activos = this.padron()?.total_activos ?? 0;
    const c = await Swal.fire({
      icon: 'warning',
      title: '¿Actualizar el padrón?',
      html: 'Las personas que estén en el archivo quedarán <b>activas</b>.<br>'
          + 'Las que <b>no</b> aparezcan quedarán <b>inactivas</b> y dejarán de recibir el saludo'
          + (activos ? ` (hoy hay ${activos} activas).` : '.')
          + '<br><br><small>No se borra nada: si te equivocas de archivo, vuelve a subir el bueno '
          + 'y todos se reactivan con sus datos.</small>',
      showCancelButton: true,
      confirmButtonText: 'Subir y actualizar',
      cancelButtonText: 'Cancelar',
    });
    if (!c.isConfirmed) return;

    this.subiendo.set(true);
    try {
      const r = await firstValueFrom(this.srv.cargarPadron(archivo));
      this.ultimaCarga.set(r);
      this.pagina.set(0);
      await Promise.all([this.recargarPadron(), this.refrescarDia(), this.recargarCargas()]);
      // Recargar la configuración: los contadores por empresa cambian con la carga.
      this.configuracion.set(await firstValueFrom(this.srv.configuracion()));
      Swal.fire({
        icon: r.inactivados > 0 || r.sin_empresa > 0 ? 'warning' : 'success',
        title: 'Padrón actualizado',
        html: `<b>${r.nuevos}</b> nuevas · <b>${r.actualizados}</b> actualizadas · `
            + `<b>${r.reactivados}</b> reactivadas · <b>${r.inactivados}</b> inactivadas`
            + (r.sin_empresa > 0
                ? `<br><br><b>${r.sin_empresa}</b> sin empresa reconocida: recibirán la plantilla por defecto.`
                : '')
            + (r.invalidos > 0 ? `<br><small>${r.invalidos} fila(s) con problemas: revisa el detalle.</small>` : ''),
      });
    } catch (e: any) {
      this.error(this.mensaje(e, 'No se pudo procesar el archivo.'));
    } finally {
      this.subiendo.set(false);
    }
  }

  async recargarCargas(): Promise<void> {
    this.cargas.set((await firstValueFrom(this.srv.cargas())).content);
  }

  async cambiarActivo(p: PersonaCumpleanos, activo: boolean): Promise<void> {
    try {
      await firstValueFrom(this.srv.cambiarActivo(p.id, activo));
      await Promise.all([this.recargarPadron(), this.refrescarDia()]);
    } catch (e: any) {
      this.error(this.mensaje(e, 'No se pudo cambiar el estado.'));
    }
  }

  // ══ Configuración ═════════════════════════════════════════════════════════

  async guardarConfig(cambios: Record<string, unknown>): Promise<void> {
    const actual = this.configuracion();
    if (!actual) return;
    // Optimista sobre una copia: si el backend rechaza, se restaura la de antes
    // en vez de dejar la pantalla diciendo algo que no se guardó.
    this.configuracion.set({ ...actual, config: { ...actual.config, ...cambios } as any });
    try {
      const cfg = await firstValueFrom(this.srv.guardarConfig(cambios as any));
      this.configuracion.set({ ...actual, config: cfg });
    } catch (e: any) {
      this.configuracion.set(actual);
      this.error(this.mensaje(e, 'No se pudo guardar la configuración.'));
    }
  }

  /** Fija la plantilla de una temporal. */
  async elegirPlantilla(empresa: string, plantillaId: string | null): Promise<void> {
    const actual = this.configuracion();
    if (!actual) return;
    try {
      const guardada = await firstValueFrom(this.srv.guardarPlantilla(empresa, plantillaId));
      this.configuracion.set({
        ...actual,
        plantillas: actual.plantillas.map((p) => (p.empresa === empresa ? guardada : p)),
      });
    } catch (e: any) {
      this.error(this.mensaje(e, 'No se pudo guardar la plantilla.'));
    }
  }

  async verPreview(empresa: string): Promise<void> {
    try {
      this.preview.set(await firstValueFrom(this.srv.preview(empresa, null)));
    } catch (e: any) {
      this.error(this.mensaje(e, 'No se pudo generar la vista previa.'));
    }
  }

  /** Manda una muestra. No consume el hueco del día. */
  async enviarPrueba(): Promise<void> {
    const correo = this.correoPrueba().trim();
    if (!correo) {
      this.error('Escribe el correo al que quieres que llegue la prueba.');
      return;
    }
    this.enviando.set(true);
    try {
      const r = await firstValueFrom(this.srv.probar(correo, this.empresaPrueba(), null));
      Swal.fire({
        icon: r.enviado ? 'success' : 'error',
        title: r.enviado ? 'Prueba enviada' : 'No se pudo enviar',
        text: r.mensaje ?? '',
      });
    } catch (e: any) {
      this.error(this.mensaje(e, 'No se pudo enviar la prueba.'));
    } finally {
      this.enviando.set(false);
    }
  }

  async reintentarCarga(): Promise<void> {
    await this.recargarTodo();
  }

  // ── Utilidades ────────────────────────────────────────────────────────────

  /** "hoy" en hora local, en el formato que espera <input type="date">. */
  private fechaLocalHoy(): string {
    const d = new Date();
    return this.iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  private iso(anio: number, mes: number, dia: number): string {
    return `${anio}-${`${mes}`.padStart(2, '0')}-${`${dia}`.padStart(2, '0')}`;
  }

  /** El texto que manda el backend, o uno genérico si no llegó ninguno. */
  private mensaje(e: any, porDefecto: string): string {
    return e?.error?.error ?? e?.error?.message ?? e?.message ?? porDefecto;
  }

  iconoEstado(estado: string): string {
    switch (estado) {
      case 'ENVIADO': return 'check_circle';
      case 'FALLIDO': return 'error';
      case 'SIN_CORREO': return 'unsubscribe';
      case 'SIN_PLANTILLA': return 'draft';
      case 'OMITIDO': return 'block';
      default: return 'schedule';
    }
  }

  claseEstado(estado: string): string {
    switch (estado) {
      case 'ENVIADO': case 'COMPLETADO': return 'ok';
      case 'FALLIDO': case 'CON_ERRORES': return 'mal';
      case 'SIN_DESTINATARIOS': return 'neutro';
      default: return 'aviso';
    }
  }

  private error(mensaje: string): void {
    Swal.fire({ icon: 'error', title: 'Error', text: mensaje });
  }
}
