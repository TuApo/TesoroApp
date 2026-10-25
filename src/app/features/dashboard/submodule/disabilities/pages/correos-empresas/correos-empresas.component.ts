/**
 * Submodulo "Correos a empresas usuarias" (reunion 2026-09-07, Nathalia Ovalle):
 *
 *  - LOTE DE HOY (modo DIARIO): lo que saldria al final del dia, correo por correo (finca,
 *    dirigido a, copias, tabla de cedulas) con vista previa exacta y boton "Enviar ahora".
 *  - RESUMEN DEL DIA (modo INMEDIATO, respuesta de la funcional 2026-10-07: "inmediatamente se
 *    reciben se van enviando; al final del dia que se envie el resumen"): la misma pestana pasa a
 *    mostrar el resumen por finca de lo registrado hoy, que sale solo a la hora configurada
 *    (`resumenDiario`) o a mano con "Enviar resumen del dia ahora".
 *  - CONFIGURACION: modo de envio (INMEDIATO al recibir cada incapacidad | DIARIO en lote a una
 *    hora) — editable porque una jefatura pidio lo uno y la funcional acordo lo otro.
 *  - DIRECTORIO: correos por finca (Drive de cartera, resembrado V58), editables: principal,
 *    copias, alta, baja logica.
 *  - ENVIADOS: lotes y envios individuales con su estado y el HTML exacto que salio.
 */
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subscription } from 'rxjs';
import Swal from 'sweetalert2';

import { ColumnaTabla, TABLA_ESTANDAR, TablaEstandarComponent } from '../../../../../../shared/components/tabla-estandar';
import { IncapacidadGestionService } from '../../services/incapacidad-gestion/incapacidad-gestion.service';
import {
  CorreoConfig,
  CorreoEmpresa,
  EnvioHistorial,
  GrupoEmpresa,
  GrupoLotePreview,
  LoteCorreo,
  LotePreview,
  ModoEnvioCorreo,
} from '../../models/incapacidad-gestion.model';
import { aFecha, fechaTexto, hoyIso, mensajeDeError } from '../informes-incapacidades/informes-incapacidades.component';
import { DialogoVistaCorreoComponent, DatosVistaCorreo } from './dialogo-vista-correo.component';
import { DialogoCorreoEmpresaComponent, DatosDialogoCorreoEmpresa } from './dialogo-correo-empresa.component';
import { GuiaSaludComponent } from '../../components/guia-salud/guia-salud.component';

/** Filas del directorio agrupadas por finca (para pintar el encabezado por empresa). */
export interface GrupoDirectorio {
  grupo: GrupoEmpresa;
  empresa: string;
  contactoNombre: string | null;
  oficinaResponsable: string | null;
  telefono: string | null;
  filas: CorreoEmpresa[];
}

export function agruparDirectorio(filas: CorreoEmpresa[]): GrupoDirectorio[] {
  const mapa = new Map<string, GrupoDirectorio>();
  for (const f of filas) {
    const clave = `${f.grupo}|${f.empresa}`;
    let g = mapa.get(clave);
    if (!g) {
      g = { grupo: f.grupo, empresa: f.empresa, contactoNombre: null, oficinaResponsable: null, telefono: null, filas: [] };
      mapa.set(clave, g);
    }
    g.filas.push(f);
    g.contactoNombre ??= f.contactoNombre;
    g.oficinaResponsable ??= f.oficinaResponsable;
    g.telefono ??= f.telefono;
  }
  return [...mapa.values()];
}

/** Filtro de texto sobre finca, correo o contacto (sin tildes ni mayusculas). */
export function filtrarDirectorio(grupos: GrupoDirectorio[], texto: string): GrupoDirectorio[] {
  const q = normalizar(texto);
  if (!q) return grupos;
  return grupos.filter((g) =>
    normalizar(g.empresa).includes(q) ||
    normalizar(g.contactoNombre ?? '').includes(q) ||
    normalizar(g.oficinaResponsable ?? '').includes(q) ||
    g.filas.some((f) => normalizar(f.correo).includes(q)),
  );
}

function normalizar(v: string): string {
  return v.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

export function claseEstadoEnvio(estado: string | null | undefined): string {
  switch (estado) {
    case 'ENVIADO': return 'ges-chip-ok';
    case 'FALLIDO': return 'ges-chip-peligro';
    case 'SIN_DESTINATARIO': return 'ges-chip-aviso';
    default: return 'ges-chip-neutro';
  }
}

@Component({
  selector: 'app-correos-empresas',
  standalone: true,
  imports: [
    GuiaSaludComponent,
    DatePipe, DecimalPipe, FormsModule, MatButtonModule, MatCardModule, MatCheckboxModule, MatExpansionModule, MatFormFieldModule,
    MatIconModule, MatInputModule, MatProgressSpinnerModule, MatRadioModule, MatSelectModule,
    MatSlideToggleModule, MatTabsModule, MatTooltipModule, ...TABLA_ESTANDAR,
  ],
  templateUrl: './correos-empresas.component.html',
  styleUrls: ['../gestion-incapacidades.comun.css', './correos-empresas.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CorreosEmpresasComponent implements OnInit {
  private readonly srv = inject(IncapacidadGestionService);
  private readonly dialogo = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);

  readonly tab = signal(0);
  readonly claseEstado = claseEstadoEnvio;

  // ── Configuracion ─────────────────────────────────────────────────────
  readonly config = signal<CorreoConfig | null>(null);
  readonly guardandoConfig = signal(false);
  modoEnvio: ModoEnvioCorreo = 'DIARIO';
  horaEnvio = '19:00';
  ventanaDias = 3;
  resumenDiario = true;

  /**
   * Con la configuracion GUARDADA en INMEDIATO la primera pestana es el resumen del dia; en
   * DIARIO (o si la configuracion no cargo) sigue siendo el lote de pendientes de siempre.
   */
  readonly esResumen = computed(() => this.config()?.envioModo === 'INMEDIATO');
  /** `ultimaCorrida` es hoy: el resumen ya salio (a mano o a la hora) y no se repite solo. */
  readonly resumenYaSalioHoy = computed(() => this.config()?.ultimaCorrida === hoyIso());

  // ── Lote de hoy / Resumen del dia ─────────────────────────────────────
  readonly preview = signal<LotePreview | null>(null);
  readonly cargandoPreview = signal(false);
  readonly enviando = signal(false);
  readonly errorPreview = signal('');
  readonly gruposConDestino = computed(() => (this.preview()?.grupos ?? []).filter((g) => !g.sinDestinatario));
  readonly gruposSinDestino = computed(() => (this.preview()?.grupos ?? []).filter((g) => g.sinDestinatario));

  // ── Directorio ────────────────────────────────────────────────────────
  readonly directorio = signal<CorreoEmpresa[]>([]);
  readonly cargandoDirectorio = signal(false);
  filtroGrupo: GrupoEmpresa | '' = '';
  filtroTexto = '';
  incluirInactivos = false;
  readonly textoDirectorio = signal('');
  readonly gruposDirectorio = computed(() => filtrarDirectorio(agruparDirectorio(this.directorio()), this.textoDirectorio()));
  readonly empresasConocidas = computed(() => [...new Set(this.directorio().map((f) => f.empresa))].sort());

  // ── Enviados ──────────────────────────────────────────────────────────
  readonly lotes = signal<LoteCorreo[]>([]);
  readonly envios = signal<EnvioHistorial[]>([]);
  readonly totalEnvios = signal(0);
  readonly cargandoEnviados = signal(false);
  enviadosDesde = '';
  enviadosHasta = hoyIso();
  enviadosEstado = '';
  readonly pageEnvios = signal(0);
  readonly sizeEnvios = signal(50);
  vista: 'LOTES' | 'ENVIOS' = 'LOTES';

  /** Lotes: el backend los entrega completos, asi que busqueda, filtros y orden van en la tabla. */
  readonly columnasLotes: ColumnaTabla<LoteCorreo>[] = [
    { id: 'fecha', header: 'Fecha', tarjeta: 'subtitulo',
      valor: (l) => aFecha(l.fechaLote), formato: (l) => fechaTexto(l.fechaLote), copiaTexto: (l) => fechaTexto(l.fechaLote) },
    { id: 'finca', header: 'Finca', tarjeta: 'titulo', minAncho: '160px',
      valor: (l) => l.empresaMatch ?? '', formato: (l) => l.empresaMatch || '—' },
    { id: 'para', header: 'Para', tarjeta: 'cuerpo',
      valor: (l) => l.destinatario ?? '', formato: (l) => l.destinatario || '—' },
    { id: 'copias', header: 'Copias', prioridad: 3, tarjeta: 'cuerpo', minAncho: '180px',
      valor: (l) => l.cc ?? '', formato: (l) => l.cc || '—' },
    { id: 'incapacidades', header: 'Incap.', align: 'right', tarjeta: 'meta',
      valor: (l) => l.totalIncapacidades },
    { id: 'estado', header: 'Estado', tarjeta: 'badge', valor: (l) => l.estado },
    { id: 'disparo', header: 'Disparo', prioridad: 2, tarjeta: 'meta', valor: (l) => l.disparo },
    { id: 'enviado', header: 'Enviado', prioridad: 2, tarjeta: 'meta',
      valor: (l) => aFecha(l.creadoEn), formato: (l) => fechaTexto(l.creadoEn, 'dd/MM/yy HH:mm'),
      copiaTexto: (l) => fechaTexto(l.creadoEn, 'dd/MM/yy HH:mm') },
  ];

  /** Envios: pagina en el backend (modo servidor); el endpoint no ordena ni busca texto libre. */
  readonly columnasEnvios: ColumnaTabla<EnvioHistorial>[] = [
    { id: 'fecha', header: 'Fecha', ordenable: false, tarjeta: 'meta',
      valor: (h) => fechaTexto(h.notificacion.creadoEn, 'dd/MM/yy HH:mm') },
    { id: 'incapacidad', header: 'Incapacidad', ordenable: false, tarjeta: 'subtitulo',
      valor: (h) => h.incapacidad.codigoConsecutivo || '#' + h.incapacidad.incapacidadId },
    { id: 'persona', header: 'Persona', ordenable: false, tarjeta: 'titulo', minAncho: '180px',
      valor: (h) => h.incapacidad.nombreCompleto },
    { id: 'finca', header: 'Finca', ordenable: false, tarjeta: 'cuerpo',
      valor: (h) => h.notificacion.empresaMatch || h.incapacidad.centroCosto || '',
      formato: (h) => h.notificacion.empresaMatch || h.incapacidad.centroCosto || '—' },
    { id: 'para', header: 'Para', ordenable: false, prioridad: 2, tarjeta: 'cuerpo',
      valor: (h) => h.notificacion.destinatarios ?? '' },
    { id: 'estado', header: 'Estado', ordenable: false, tarjeta: 'badge', valor: (h) => h.notificacion.estado },
    { id: 'lote', header: 'Lote', ordenable: false, prioridad: 2, tarjeta: 'meta',
      valor: (h) => (h.notificacion.loteId ? '#' + h.notificacion.loteId : 'individual') },
  ];

  readonly idLote = (l: LoteCorreo) => l.id;
  readonly idEnvio = (h: EnvioHistorial) => h.notificacion.id;

  /**
   * La tabla de envios guarda su propia pagina. Se le sincroniza la pedida al
   * backend: al filtrar (vuelve a la 1) y cuando la tabla se crea de nuevo
   * (cambio de pestana o de vista Lotes / Envios).
   */
  private readonly tablaEnvios = viewChild<TablaEstandarComponent<EnvioHistorial>>('tablaEnvios');
  private readonly sincronizarPaginaEnvios = effect(() => {
    const tabla = this.tablaEnvios();
    const pagina = this.pageEnvios();
    if (tabla) untracked(() => tabla.pagina.set(pagina));
  });

  ngOnInit(): void {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    this.enviadosDesde = hoyIso(d);
    // La previsualizacion depende del modo (lote o resumen): se pide cuando llega la configuracion.
    this.cargarConfig();
  }

  cambiarTab(i: number): void {
    this.tab.set(i);
    if (i === 2 && this.directorio().length === 0) this.cargarDirectorio();
    if (i === 3 && this.lotes().length === 0 && this.envios().length === 0) this.cargarEnviados();
  }

  // ── Configuracion ─────────────────────────────────────────────────────

  /** Lee la configuracion y, con el modo ya conocido, la previsualizacion que corresponde. */
  cargarConfig(): void {
    // La previsualizacion espera a la configuracion: mientras llega ya se esta "armando" (spinner
    // en la pestana y "Actualizar" deshabilitado, no una pestana en blanco ni clics repetidos).
    this.cargandoPreview.set(true);
    this.srv.correoConfig().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (c) => {
        this.config.set(c);
        this.modoEnvio = c.envioModo;
        this.horaEnvio = c.envioHora;
        this.ventanaDias = c.ventanaDias;
        // Un backend sin la clave nueva no la manda: el defecto acordado es enviarlo.
        this.resumenDiario = c.resumenDiario !== false;
        this.cargarPreview();
      },
      error: () => {
        // Se conserva la ultima configuracion leida: un fallo al ACTUALIZAR en INMEDIATO no debe
        // volver a "Lote de hoy" ni ofrecer el lote de pendientes. Si nunca cargo, sigue en null y
        // se muestra el lote de pendientes (lo que habia antes).
        this.cargarPreview();
      },
    });
  }

  guardarConfig(): void {
    this.guardandoConfig.set(true);
    this.srv
      .actualizarCorreoConfig({
        envioModo: this.modoEnvio,
        envioHora: this.horaEnvio,
        ventanaDias: Number(this.ventanaDias),
        resumenDiario: this.resumenDiario,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (c) => {
          this.config.set(c);
          this.guardandoConfig.set(false);
          void Swal.fire({
            icon: 'success', title: 'Configuración guardada',
            text: c.envioModo === 'DIARIO'
              ? `Solo saldrá el lote diario automático: un correo por finca todos los días a las ${c.envioHora}.`
              : c.resumenDiario !== false
                ? `Cada incapacidad enviará su correo al registrarla (al cargar el soporte) y a las ${c.envioHora} saldrá el resumen del día por finca.`
                : 'Cada incapacidad enviará su correo al registrarla (al cargar el soporte). El resumen del día no sale solo: envíalo desde «Resumen del día».',
            timer: 3500, showConfirmButton: false,
          });
          this.resumenDiario = c.resumenDiario !== false;
          this.cargarPreview();
        },
        error: (e: unknown) => {
          this.guardandoConfig.set(false);
          void Swal.fire({ icon: 'error', title: 'No se pudo guardar', text: mensajeDeError(e, 'Intente de nuevo.') });
        },
      });
  }

  // ── Lote de hoy / Resumen del dia ─────────────────────────────────────

  private subPreview?: Subscription;

  /**
   * Lote de pendientes (DIARIO) o resumen del dia (INMEDIATO), segun la configuracion guardada.
   * Cancela la anterior: al cambiar de modo no debe pintarse la respuesta del otro endpoint.
   */
  cargarPreview(): void {
    this.subPreview?.unsubscribe();
    this.cargandoPreview.set(true);
    this.errorPreview.set('');
    const peticion = this.esResumen() ? this.srv.previsualizarResumen() : this.srv.previsualizarLote();
    this.subPreview = peticion.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (p) => { this.preview.set(p); this.cargandoPreview.set(false); },
      error: (e: unknown) => { this.cargandoPreview.set(false); this.errorPreview.set(mensajeDeError(e, 'No se pudo armar la previsualización.')); },
    });
  }

  verGrupo(g: GrupoLotePreview): void {
    const resumen = this.esResumen();
    this.abrirVista({
      titulo: `${resumen ? 'Resumen del día' : 'Correo'} a ${g.empresaMatch || g.incapacidades[0]?.empresa || 'empresa usuaria'}`,
      asunto: g.asunto, destinatario: g.destinatario, copias: g.copias, cuerpoHtml: g.cuerpoHtml,
      enviadoEn: null,
      referencia: resumen ? 'resumen del día, vista previa' : 'lote de hoy, vista previa',
      // Aun no se generan: solo se sabe con que nombre saldran. En el resumen solo se adjuntan
      // los soportes que no salieron al registrar y la vista previa no sabe cuales: no se listan.
      adjuntos: resumen ? null : { nombres: g.incapacidades.map((i) => nombreAdjunto(i.cedula, i.fechaInicio)) },
    });
  }

  enviarAhora(): void {
    const p = this.preview();
    if (!p || p.totalIncapacidades === 0) return;
    void Swal.fire({
      icon: 'question',
      title: 'Enviar lote del día (pendientes)',
      html:
        `<p style="margin:0 0 8px">Se enviarán <b>${p.totalCorreos}</b> correo(s) con <b>${p.totalIncapacidades}</b> incapacidad(es).</p>` +
        (p.prueba
          ? `<p style="margin:0;font-size:13px;color:#b26a00"><b>Modo prueba:</b> todo sale a ${escapar(p.destinoPrueba ?? '')} con el destinatario real anotado.</p>`
          : '<p style="margin:0;font-size:13px;color:#c62828"><b>Modo activo:</b> saldrán a los correos reales de cada finca.</p>'),
      showCancelButton: true, confirmButtonText: 'Enviar lote', cancelButtonText: 'Cancelar', confirmButtonColor: '#1976d2',
    }).then((r) => {
      if (!r.isConfirmed) return;
      this.enviando.set(true);
      this.srv.enviarLoteAhora().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (res) => {
          this.enviando.set(false);
          void Swal.fire({
            icon: res.fallidos === 0 ? 'success' : 'warning',
            title: 'Lote enviado',
            html: `<p style="margin:0">Correos enviados: <b>${res.enviados}</b> · fallidos: <b>${res.fallidos}</b> · sin destinatario: <b>${res.sinDestinatario}</b><br/>Incapacidades notificadas: <b>${res.incapacidades}</b></p>`,
          });
          this.cargarPreview();
          this.lotes.set([]);
          this.envios.set([]);
        },
        error: (e: unknown) => {
          this.enviando.set(false);
          void Swal.fire({ icon: 'error', title: 'No se pudo enviar el lote', text: mensajeDeError(e, 'Intente de nuevo.') });
        },
      });
    });
  }

  /** Modo INMEDIATO: adelanta (o repite) el resumen de hoy; despues no se duplica a la hora. */
  enviarResumenAhora(): void {
    const p = this.preview();
    if (!p || p.totalIncapacidades === 0) return;
    const hora = this.config()?.envioHora || '19:00';
    // Con el resumen automatico apagado no hay envio "a la hora" que evitar: no se menciona.
    const automatico = this.config()?.resumenDiario !== false;
    void Swal.fire({
      icon: 'question',
      title: 'Enviar resumen del día',
      html:
        `<p style="margin:0 0 8px">Se enviarán <b>${p.totalCorreos}</b> correo(s) de resumen con <b>${p.totalIncapacidades}</b> incapacidad(es) registradas hoy. ` +
        'Solo se adjuntan los soportes que no salieron al registrarlas.</p>' +
        (this.resumenYaSalioHoy()
          ? '<p style="margin:0 0 8px;font-size:13px;color:#b26a00"><b>El resumen de hoy ya se envió:</b> saldrá otra vez, completo.</p>'
          : automatico
            ? `<p style="margin:0 0 8px;font-size:13px">Después ya no sale solo a las ${escapar(hora)}.</p>`
            : '') +
        (p.prueba
          ? `<p style="margin:0;font-size:13px;color:#b26a00"><b>Modo prueba:</b> todo sale a ${escapar(p.destinoPrueba ?? '')} con el destinatario real anotado.</p>`
          : '<p style="margin:0;font-size:13px;color:#c62828"><b>Modo activo:</b> saldrán a los correos reales de cada finca.</p>'),
      showCancelButton: true, confirmButtonText: 'Enviar resumen', cancelButtonText: 'Cancelar', confirmButtonColor: '#1976d2',
    }).then((r) => {
      if (!r.isConfirmed) return;
      this.enviando.set(true);
      this.srv.enviarResumenAhora().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (res) => {
          this.enviando.set(false);
          void Swal.fire({
            icon: res.fallidos === 0 ? 'success' : 'warning',
            title: 'Resumen enviado',
            html: `<p style="margin:0">Correos enviados: <b>${res.enviados}</b> · fallidos: <b>${res.fallidos}</b> · sin destinatario: <b>${res.sinDestinatario}</b><br/>Incapacidades en el resumen: <b>${res.incapacidades}</b></p>`,
          });
          // La configuracion trae la nueva `ultimaCorrida` y vuelve a pedir la previsualizacion.
          this.cargarConfig();
          this.lotes.set([]);
          this.envios.set([]);
        },
        error: (e: unknown) => {
          this.enviando.set(false);
          void Swal.fire({ icon: 'error', title: 'No se pudo enviar el resumen', text: mensajeDeError(e, 'Intente de nuevo.') });
        },
      });
    });
  }

  // ── Directorio ────────────────────────────────────────────────────────

  cargarDirectorio(): void {
    this.cargandoDirectorio.set(true);
    this.srv.directorio(this.filtroGrupo, this.incluirInactivos).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (d) => { this.directorio.set(d); this.cargandoDirectorio.set(false); },
      error: (e: unknown) => {
        this.cargandoDirectorio.set(false);
        void Swal.fire({ icon: 'error', title: 'No se pudo cargar el directorio', text: mensajeDeError(e, 'Intente de nuevo.') });
      },
    });
  }

  filtrarTexto(): void { this.textoDirectorio.set(this.filtroTexto); }

  agregarCorreo(g?: GrupoDirectorio): void {
    this.abrirEdicion({ fila: null, grupo: g?.grupo ?? (this.filtroGrupo || 'APOYO'), empresa: g?.empresa, empresasConocidas: this.empresasConocidas() });
  }

  editarCorreo(f: CorreoEmpresa): void {
    this.abrirEdicion({ fila: f, empresasConocidas: this.empresasConocidas() });
  }

  private abrirEdicion(datos: DatosDialogoCorreoEmpresa): void {
    this.dialogo
      .open<DialogoCorreoEmpresaComponent, DatosDialogoCorreoEmpresa, CorreoEmpresa | undefined>(DialogoCorreoEmpresaComponent, {
        data: datos, width: '680px', maxWidth: '95vw', autoFocus: false,
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((guardada) => { if (guardada) this.cargarDirectorio(); });
  }

  marcarPrincipal(f: CorreoEmpresa): void {
    this.srv.editarCorreoEmpresa(f.id, { esPrincipal: true }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.cargarDirectorio(),
      error: (e: unknown) => void Swal.fire({ icon: 'error', title: 'No se pudo cambiar el principal', text: mensajeDeError(e, 'Intente de nuevo.') }),
    });
  }

  desactivarCorreo(f: CorreoEmpresa): void {
    void Swal.fire({
      icon: 'warning', title: 'Retirar correo del directorio',
      html: `<p style="margin:0"><b>${escapar(f.correo)}</b> de <b>${escapar(f.empresa)}</b> dejara de recibir correos. Se conserva inactivo (no se borra).</p>`,
      showCancelButton: true, confirmButtonText: 'Retirar', cancelButtonText: 'Cancelar', confirmButtonColor: '#c62828',
    }).then((r) => {
      if (!r.isConfirmed) return;
      this.srv.desactivarCorreoEmpresa(f.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => this.cargarDirectorio(),
        error: (e: unknown) => void Swal.fire({ icon: 'error', title: 'No se pudo retirar', text: mensajeDeError(e, 'Intente de nuevo.') }),
      });
    });
  }

  reactivarCorreo(f: CorreoEmpresa): void {
    this.srv.editarCorreoEmpresa(f.id, { activo: true }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.cargarDirectorio(),
      error: (e: unknown) => void Swal.fire({ icon: 'error', title: 'No se pudo reactivar', text: mensajeDeError(e, 'Intente de nuevo.') }),
    });
  }

  // ── Enviados ──────────────────────────────────────────────────────────

  cargarEnviados(): void {
    this.cargandoEnviados.set(true);
    this.srv.lotes(this.enviadosDesde, this.enviadosHasta).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (l) => this.lotes.set(l),
      error: () => this.lotes.set([]),
    });
    this.srv.envios(this.enviadosDesde, this.enviadosHasta, this.enviadosEstado, this.pageEnvios(), this.sizeEnvios())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (p) => { this.envios.set(p.content); this.totalEnvios.set(p.totalElements); this.cargandoEnviados.set(false); },
        error: (e: unknown) => {
          this.cargandoEnviados.set(false);
          void Swal.fire({ icon: 'error', title: 'No se pudo cargar el historial', text: mensajeDeError(e, 'Intente de nuevo.') });
        },
      });
  }

  filtrarEnviados(): void { this.pageEnvios.set(0); this.cargarEnviados(); }

  paginarEnvios(e: { pagina: number; porPagina: number }): void {
    this.pageEnvios.set(e.pagina);
    this.sizeEnvios.set(e.porPagina);
    this.cargarEnviados();
  }

  verLote(l: LoteCorreo): void {
    this.srv.lote(l.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (d) => this.abrirVista({
        titulo: `Lote #${d.id} · ${d.empresaMatch || 'sin finca'} · ${d.fechaLote}`,
        asunto: d.asunto, destinatario: d.destinatario, copias: d.cc, cuerpoHtml: d.cuerpoHtml ?? '', estado: d.estado, mensajeError: d.mensajeError,
        remitente: d.remitente, enviadoEn: d.creadoEn, modo: d.modo, referencia: `lote #${d.id}`,
        adjuntos: { tipo: 'lote', id: d.id },
      }),
      error: (e: unknown) => void Swal.fire({ icon: 'error', title: 'No se pudo abrir el lote', text: mensajeDeError(e, 'Intente de nuevo.') }),
    });
  }

  verEnvio(h: EnvioHistorial): void {
    this.srv.cuerpoEnvio(h.notificacion.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (html) => this.abrirVista({
        titulo: `Envio #${h.notificacion.id} · CC ${h.incapacidad.cedula}`,
        asunto: h.notificacion.asunto, destinatario: h.notificacion.destinatarios, copias: h.notificacion.cc,
        cuerpoHtml: html, estado: h.notificacion.estado, mensajeError: h.notificacion.mensajeError,
        remitente: h.notificacion.remitente ?? null, enviadoEn: h.notificacion.creadoEn, modo: h.notificacion.modo,
        referencia: h.notificacion.loteId ? `envío #${h.notificacion.id}, lote #${h.notificacion.loteId}` : `envío #${h.notificacion.id}`,
        adjuntos: { tipo: 'envio', id: h.notificacion.id },
      }),
      error: (e: unknown) => void Swal.fire({ icon: 'error', title: 'No se pudo abrir el correo', text: mensajeDeError(e, 'Intente de nuevo.') }),
    });
  }

  reenviar(h: EnvioHistorial): void {
    void Swal.fire({
      icon: 'question', title: 'Reenviar la notificacion',
      text: `Se enviara de nuevo el correo de la incapacidad de CC ${h.incapacidad.cedula} (individual, con el directorio actual).`,
      showCancelButton: true, confirmButtonText: 'Reenviar', cancelButtonText: 'Cancelar',
    }).then((r) => {
      if (!r.isConfirmed) return;
      this.srv.reenviarCorreo(h.incapacidad.incapacidadId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (n) => {
          void Swal.fire({ icon: n.estado === 'ENVIADO' ? 'success' : 'warning', title: n.estado, text: n.mensajeError ?? (n.destinatarios ?? '') });
          this.cargarEnviados();
        },
        error: (e: unknown) => void Swal.fire({ icon: 'error', title: 'No se pudo reenviar', text: mensajeDeError(e, 'Intente de nuevo.') }),
      });
    });
  }

  private abrirVista(datos: DatosVistaCorreo): void {
    this.dialogo.open(DialogoVistaCorreoComponent, { data: datos, width: '1060px', maxWidth: '96vw', autoFocus: false });
  }

  trackGrupo(_: number, g: GrupoLotePreview): string { return g.clave; }
  trackDir(_: number, g: GrupoDirectorio): string { return `${g.grupo}|${g.empresa}`; }
  trackFila(_: number, f: CorreoEmpresa): number { return f.id; }
}

function escapar(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Nombre con el que viaja el adjunto (espejo de PrimeraPaginaSoporteService.nombreAdjunto). */
export function nombreAdjunto(cedula: string, fechaInicio: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fechaInicio ?? '');
  const fecha = m ? `${m[3]}${m[2]}${m[1]}` : '';
  return `${(cedula ?? '').trim()} ${fecha} Notificacion.pdf`.replace(/\s+/g, ' ');
}
