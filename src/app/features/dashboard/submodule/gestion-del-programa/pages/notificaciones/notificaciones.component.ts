import { AfterViewInit, ChangeDetectorRef, Component, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatCardModule } from '@angular/material/card';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatSortModule, MatSort } from '@angular/material/sort';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggle, MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTabsModule } from '@angular/material/tabs';
import { MatChipsModule } from '@angular/material/chips';

import Swal from 'sweetalert2';

import { NotificacionesConfigService } from '../../services/notificaciones-config.service';
import { ReglaFormDialogComponent, ReglaFormDialogData } from './regla-form-dialog.component';
import { TipoFormDialogComponent, TipoFormDialogData } from './tipo-form-dialog.component';
import { SimularDialogComponent, SimularDialogData } from './simular-dialog.component';
import {
  AUDIENCIA_MODO_LABEL,
  CANALES,
  Canal,
  DESTINO_TIPO_LABEL,
  DestinoTipo,
  NotificationType,
  NotifRegla,
  URGENCIA_META,
  Urgencia,
} from '../../models/notificacion-config.model';

/**
 * Administración → Notificaciones.
 *
 * Es la pantalla que saca la parametrización del hub del SQL: hasta ahora las
 * reglas y el catálogo de tipos solo se podían tocar por migración o a mano
 * contra la base, que es justo lo que este módulo vino a eliminar.
 *
 * Dos pestañas porque son dos decisiones distintas:
 *  · REGLAS   — qué hecho dispara qué aviso, a quién y por dónde;
 *  · TIPOS    — cómo se ve y se agrupa cada clase de aviso (ícono, color,
 *               urgencia por defecto). Es el catálogo que la campana y la página
 *               de Novedades leen de `GET /tipos`.
 *
 * NO hay acción de eliminar en ninguna de las dos: una regla borrada se lleva por
 * delante la trazabilidad de por qué se generó cada mensaje histórico
 * (`notif_mensaje.regla_id`), y un tipo borrado dejaría sin ícono a los mensajes
 * ya entregados. Se desactivan, que es el mismo criterio de borrado lógico que
 * usa el resto de Administración.
 */
@Component({
  selector: 'app-notificaciones',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatTableModule,
    MatSortModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatDialogModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    MatTabsModule,
    MatChipsModule,
  ],
  templateUrl: './notificaciones.component.html',
  styleUrls: ['./notificaciones.component.css'],
})
export class NotificacionesComponent implements OnInit, AfterViewInit {
  @ViewChild(MatSort) sortReglas!: MatSort;

  /**
   * OJO: cada id de aquí DEBE tener su `matColumnDef` en el HTML. Si falta uno,
   * MatTable lanza y no pinta NINGUNA fila (la tabla se ve vacía con el contador
   * en su número real). Lo cubre la prueba de render de la spec.
   */
  readonly columnasReglas = [
    'nombre', 'evento_clave', 'tipo', 'audiencia', 'canales',
    'urgencia', 'destino', 'activo', 'acciones',
  ];
  readonly columnasTipos = [
    'aspecto', 'clave', 'nombre', 'urgencia_default', 'agrupable', 'orden', 'activo', 'acciones',
  ];

  reglas = new MatTableDataSource<NotifRegla>([]);
  tipos = new MatTableDataSource<NotificationType>([]);

  /** Índice clave→tipo: la tabla de reglas pinta el ícono y el color del tipo. */
  tipoPorId = new Map<string, NotificationType>();

  eventos: string[] = [];

  // Filtros
  filtroTexto = '';
  filtroEvento = '';
  filtroEstado: 'activas' | 'inactivas' | 'todas' = 'todas';
  filtroTipos: 'activos' | 'inactivos' | 'todos' = 'todos';

  cargando = false;
  cargaFallida = false;
  /** Id de la regla cuyo toggle está en vuelo, para bloquear solo esa fila. */
  alternandoId: string | null = null;

  readonly AUDIENCIA_LABEL = AUDIENCIA_MODO_LABEL;
  readonly DESTINO_LABEL = DESTINO_TIPO_LABEL;
  readonly URGENCIA = URGENCIA_META;
  readonly CANAL_META: Record<Canal, { label: string; icono: string; disponible: boolean }> =
    Object.fromEntries(CANALES.map((c) => [c.value, { label: c.label, icono: c.icono, disponible: c.disponible }])) as
      Record<Canal, { label: string; icono: string; disponible: boolean }>;

  constructor(
    private api: NotificacionesConfigService,
    private dialog: MatDialog,
    private snack: MatSnackBar,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.reglas.filterPredicate = (r, filtro) => this.coincide(r, filtro);
    this.tipos.filterPredicate = (t, filtro) => {
      const q = filtro.trim().toLowerCase();
      if (!q) return true;
      return [t.clave, t.nombre, t.descripcion ?? ''].join(' ').toLowerCase().includes(q);
    };
    this.cargar();
  }

  /**
   * El @ViewChild(MatSort) todavia no esta resuelto en ngOnInit, asi que
   * engancharlo alli dependeria de que la respuesta HTTP llegue despues de que
   * la vista se inicialice. Aqui es determinista.
   */
  ngAfterViewInit(): void {
    this.reglas.sort = this.sortReglas;
  }

  // ── Carga ────────────────────────────────────────────────────────────────

  /**
   * Los tipos se piden SIEMPRE antes que las reglas: la tabla de reglas pinta el
   * ícono y el color a partir de `tipoPorId`, y si llegaran al revés la primera
   * pintada saldría sin ellos.
   */
  cargar(): void {
    this.cargando = true;
    this.cargaFallida = false;
    this.api.listarTipos().subscribe({
      next: (tipos) => {
        this.tipos.data = tipos;
        this.tipoPorId = new Map(tipos.map((t) => [t.id, t]));
        this.aplicarFiltroTipos();
        this.cargarReglas();
      },
      error: (e) => this.fallo(e, 'No se pudo cargar el catálogo de tipos'),
    });
    this.api.listarEventos().subscribe((evs) => {
      this.eventos = evs;
      this.cdr.markForCheck();
    });
  }

  private cargarReglas(): void {
    this.api.listarReglas(this.filtroEvento || null).subscribe({
      next: (reglas) => {
        this.reglas.data = reglas;
        this.aplicarFiltroReglas();
        this.cargando = false;
        this.cdr.markForCheck();
      },
      error: (e) => this.fallo(e, 'No se pudieron cargar las reglas'),
    });
  }

  private fallo(e: unknown, mensaje: string): void {
    this.cargando = false;
    this.cargaFallida = true;
    this.snack.open(this.mensajeDeError(e, mensaje), 'Cerrar', { duration: 6000 });
    this.cdr.markForCheck();
  }

  /** El backend responde `{ error: "..." }` en 400/404/409. */
  private mensajeDeError(e: unknown, porDefecto: string): string {
    const err = e as { error?: { error?: string } | string };
    if (typeof err?.error === 'string') return err.error;
    if (err?.error?.error) return err.error.error;
    return porDefecto;
  }

  // ── Filtros ──────────────────────────────────────────────────────────────

  /**
   * El filtro de MatTable es un solo string, así que el estado viaja empaquetado
   * con el texto. Sin esto, cambiar "activas/inactivas" no repintaría la tabla
   * porque `filter` no habría cambiado.
   */
  private aplicarFiltroReglas(): void {
    this.reglas.filter = `${this.filtroTexto.trim().toLowerCase()}||${this.filtroEstado}`;
  }

  private aplicarFiltroTipos(): void {
    this.tipos.filter = this.filtroTexto.trim().toLowerCase();
    this.recalcularTiposVisibles();
  }

  private coincide(r: NotifRegla, filtro: string): boolean {
    const [texto, estado] = filtro.split('||');
    if (estado === 'activas' && !r.activo) return false;
    if (estado === 'inactivas' && r.activo) return false;
    if (!texto) return true;
    return [
      r.nombre, r.descripcion ?? '', r.evento_clave, r.tipo_clave ?? '',
      r.plantilla_titulo, r.destino_valor ?? '',
    ].join(' ').toLowerCase().includes(texto);
  }

  onTextoChange(valor: string): void {
    this.filtroTexto = valor;
    this.aplicarFiltroReglas();
    this.aplicarFiltroTipos();
  }

  onEventoChange(): void {
    this.cargarReglas();
  }

  onEstadoChange(): void {
    this.aplicarFiltroReglas();
  }

  onFiltroTiposChange(): void {
    this.recalcularTiposVisibles();
  }

  /**
   * Los tipos se filtran por estado en cliente; el endpoint devuelve todos.
   *
   * Es un CAMPO y no un getter a proposito: alimenta [dataSource], y un getter
   * que devuelve un array nuevo en cada ciclo de deteccion haria que MatTable
   * se repintara entero cada vez.
   */
  tiposVisibles: NotificationType[] = [];

  private recalcularTiposVisibles(): void {
    const base = this.tipos.filteredData;
    this.tiposVisibles =
      this.filtroTipos === 'activos' ? base.filter((t) => t.activo)
      : this.filtroTipos === 'inactivos' ? base.filter((t) => !t.activo)
      : base;
  }

  // ── Indicadores ──────────────────────────────────────────────────────────

  get reglasActivas(): number { return this.reglas.data.filter((r) => r.activo).length; }
  get tiposActivos(): number { return this.tipos.data.filter((t) => t.activo).length; }
  get eventosCubiertos(): number { return new Set(this.reglas.data.map((r) => r.evento_clave)).size; }
  /** Reglas activas que además mandan correo: es el número que cuesta plata. */
  get reglasConCorreo(): number {
    return this.reglas.data.filter((r) => r.activo && r.canales.includes('EMAIL')).length;
  }

  // ── Acciones sobre reglas ────────────────────────────────────────────────

  tipoDe(regla: NotifRegla): NotificationType | undefined {
    return regla.tipo_id ? this.tipoPorId.get(regla.tipo_id) : undefined;
  }

  urgenciaDe(regla: NotifRegla): Urgencia { return regla.urgencia_efectiva; }

  /** Resumen legible de la audiencia para la columna de la tabla. */
  audienciaDe(regla: NotifRegla): string {
    const base = this.AUDIENCIA_LABEL[regla.audiencia_modo] ?? regla.audiencia_modo;
    if (regla.audiencia_modo === 'PAYLOAD' || regla.audiencia_modo === 'TODOS') return base;
    const n = this.contarAudiencia(regla);
    return n ? `${base} (${n})` : `${base} — sin seleccionar`;
  }

  private contarAudiencia(regla: NotifRegla): number {
    if (!regla.audiencia_json) return 0;
    try {
      const parsed: unknown = JSON.parse(regla.audiencia_json);
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }

  tieneCondicion(regla: NotifRegla): boolean {
    return !!regla.condicion_json && regla.condicion_json.trim() !== '[]';
  }

  abrirCrearRegla(): void {
    this.abrirDialogoRegla({ tipos: this.tipos.data, eventos: this.eventos });
  }

  abrirEditarRegla(regla: NotifRegla): void {
    this.abrirDialogoRegla({ regla, tipos: this.tipos.data, eventos: this.eventos });
  }

  private abrirDialogoRegla(data: ReglaFormDialogData): void {
    this.dialog
      .open(ReglaFormDialogComponent, { data, width: '920px', maxWidth: '96vw', disableClose: true })
      .afterClosed()
      .subscribe((guardada?: NotifRegla) => {
        if (!guardada) return;
        this.snack.open('Regla guardada', 'Cerrar', { duration: 3000 });
        this.cargar();
      });
  }

  /**
   * Activar una regla es la acción de más radio de la pantalla: a partir de ese
   * momento cada evento que encaje genera mensajes reales. Por eso pide
   * confirmación al ENCENDER y no al apagar — apagar siempre es la salida segura.
   */
  async alternar(regla: NotifRegla, activo: boolean, toggle: MatSlideToggle): Promise<void> {
    if (activo) {
      const alcance = regla.audiencia_modo === 'TODOS'
        ? '<b>toda la organización</b>'
        : `la audiencia configurada (<b>${this.audienciaDe(regla)}</b>)`;
      const correo = regla.canales.includes('EMAIL')
        ? '<br>Además <b>enviará correo</b>, que consume la cuota de las cuentas remitentes.'
        : '';
      const res = await Swal.fire({
        title: '¿Activar la regla?',
        html: `Desde ya, cada evento <code>${regla.evento_clave}</code> que cumpla la condición
               notificará a ${alcance}.${correo}<br><br>
               Si aún no la has simulado, cancela y usa <b>Simular</b> primero.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sí, activar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#3f51b5',
      });
      if (!res.isConfirmed) {
        // Hay que devolver el toggle a mano. El binding [checked] es de una sola
        // via y su valor NO cambio (la regla sigue desactivada), asi que la
        // deteccion de cambios no reescribe el DOM y el interruptor se quedaria
        // encendido mintiendo sobre el estado real.
        this.revertir(toggle, regla.activo);
        return;
      }
    }

    this.alternandoId = regla.id;
    this.api.alternarActivo(regla.id, activo).subscribe({
      next: (actualizada) => {
        this.reglas.data = this.reglas.data.map((r) => (r.id === actualizada.id ? actualizada : r));
        this.alternandoId = null;
        this.snack.open(activo ? 'Regla activada' : 'Regla desactivada', 'Cerrar', { duration: 3000 });
        this.cdr.markForCheck();
      },
      error: (e) => {
        this.alternandoId = null;
        this.revertir(toggle, regla.activo);
        this.snack.open(this.mensajeDeError(e, 'No se pudo cambiar el estado'), 'Cerrar', { duration: 6000 });
      },
    });
  }

  /** Deja el interruptor mostrando el estado real tras un fallo o una cancelación. */
  private revertir(toggle: MatSlideToggle, estadoReal: boolean): void {
    toggle.checked = estadoReal;
    this.cdr.markForCheck();
  }

  abrirSimular(regla: NotifRegla): void {
    const data: SimularDialogData = { regla, tipo: this.tipoDe(regla) };
    this.dialog.open(SimularDialogComponent, { data, width: '820px', maxWidth: '96vw' });
  }

  // ── Acciones sobre tipos ─────────────────────────────────────────────────

  abrirCrearTipo(): void { this.abrirDialogoTipo({}); }

  abrirEditarTipo(tipo: NotificationType): void { this.abrirDialogoTipo({ tipo }); }

  private abrirDialogoTipo(data: TipoFormDialogData): void {
    this.dialog
      .open(TipoFormDialogComponent, { data, width: '700px', maxWidth: '96vw', disableClose: true })
      .afterClosed()
      .subscribe((guardado?: NotificationType) => {
        if (!guardado) return;
        this.snack.open('Tipo guardado', 'Cerrar', { duration: 3000 });
        this.cargar();
      });
  }

  /**
   * Desactivar un tipo NO borra nada: los mensajes ya entregados conservan su
   * ícono y su color. Solo deja de ofrecerse al crear reglas nuevas.
   */
  async alternarTipo(tipo: NotificationType, activo: boolean, toggle: MatSlideToggle): Promise<void> {
    if (!activo) {
      const enUso = this.reglas.data.filter((r) => r.tipo_id === tipo.id && r.activo).length;
      if (enUso) {
        const res = await Swal.fire({
          title: '¿Desactivar el tipo?',
          html: `Hay <b>${enUso}</b> regla(s) activa(s) usando <code>${tipo.clave}</code>.
                 Seguirán disparando: desactivar el tipo solo lo esconde del catálogo
                 al crear reglas nuevas.`,
          icon: 'warning',
          showCancelButton: true,
          confirmButtonText: 'Desactivar igual',
          cancelButtonText: 'Cancelar',
          confirmButtonColor: '#3f51b5',
        });
        if (!res.isConfirmed) {
          this.revertir(toggle, tipo.activo);
          return;
        }
      }
    }
    this.api.actualizarTipo(tipo.id, { activo }).subscribe({
      next: (actualizado) => {
        this.tipos.data = this.tipos.data.map((t) => (t.id === actualizado.id ? actualizado : t));
        this.tipoPorId.set(actualizado.id, actualizado);
        this.recalcularTiposVisibles();
        this.snack.open(activo ? 'Tipo activado' : 'Tipo desactivado', 'Cerrar', { duration: 3000 });
        this.cdr.markForCheck();
      },
      error: (e) => {
        this.revertir(toggle, tipo.activo);
        this.snack.open(this.mensajeDeError(e, 'No se pudo cambiar el estado'), 'Cerrar', { duration: 6000 });
      },
    });
  }

  // ── Accesores para la plantilla ──────────────────────────────────────────
  // Las filas de `matCellDef` llegan como `any` bajo strictTemplates, e indexar
  // un Record con `any` es error de compilacion (TS7053). Pasarlas por un metodo
  // tipado resuelve el indice aqui, en TypeScript, en vez de en el template.

  canalMeta(c: Canal): { label: string; icono: string; disponible: boolean } {
    return this.CANAL_META[c] ?? { label: c, icono: 'notifications', disponible: false };
  }

  /** Tooltip del canal: deja claro cuál está declarado pero todavía no entrega. */
  canalTooltip(c: Canal): string {
    const meta = this.canalMeta(c);
    return meta.disponible ? meta.label : `${meta.label} — todavía sin entrega real`;
  }

  destinoLabel(t: DestinoTipo): string { return this.DESTINO_LABEL[t] ?? t; }

  urgMeta(u: Urgencia): { label: string; icono: string; clase: string } {
    return this.URGENCIA[u] ?? { label: u, icono: 'info', clase: 'urg-info' };
  }

  /** `trackBy` de ambas tablas: sin esto Angular repinta toda la lista por toggle. */
  trackById = (_: number, item: { id: string }): string => item.id;
}
