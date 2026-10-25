import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { SelectionModel } from '@angular/cdk/collections';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';
import { EnviosEpsService } from '../../services/envios-eps.service';
import {
  BandejaEps, CanalEpsConfig, ETIQUETA_CANAL, ETIQUETA_EMPRESA, ETIQUETA_ESTADO_TRAMITE, ETIQUETA_FALTANTE,
  EnvioEps, EstadoTramite, GrupoBandeja, ICONO_CANAL, PersonaBandeja, ResultadoMasivoEps, TramiteEps,
} from '../../models/envios-eps.models';
import { CanalEpsDialogComponent } from './canal-eps-dialog.component';
import { EnvioEpsDialogComponent, EnvioEpsDialogData } from './envio-eps-dialog.component';
import { AccionTramite, AccionTramiteDialogComponent } from './accion-tramite-dialog.component';
import { HistorialTramiteDialogComponent } from './historial-tramite-dialog.component';

/**
 * Afiliaciones › Envíos a EPS (ms-hr V70).
 *
 * <ol>
 *   <li><b>Bandeja</b>: personal activo que ingresa en el rango, por EPS. Afiliaciones confirma
 *       que los datos de cada persona sirven para generar sus documentos y luego envía el lote:
 *       un correo al tramitador con los datos de todos y la cédula de cada uno, o el registro en
 *       la plataforma.</li>
 *   <li><b>Seguimiento</b>: radicado, confirmación (o confirmación directa) y devoluciones.</li>
 *   <li><b>Envíos</b>: lo que salió, con el correo exacto.</li>
 *   <li><b>Parametrización</b>: todas las EPS, cuál está activa, canal y datos.</li>
 * </ol>
 */
@Component({
  selector: 'app-envios-eps',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatButtonModule, MatDialogModule, MatExpansionModule, MatFormFieldModule, MatIconModule,
    MatInputModule, MatProgressBarModule, MatSelectModule, MatSlideToggleModule, MatSnackBarModule,
    MatTabsModule, MatTooltipModule, ...TABLA_ESTANDAR,
  ],
  templateUrl: './envios-eps.component.html',
  styleUrls: ['./envios-eps.component.css'],
})
export class EnviosEpsComponent implements OnInit {
  private svc = inject(EnviosEpsService);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);

  readonly etiquetaCanal = ETIQUETA_CANAL;
  readonly iconoCanal = ICONO_CANAL;
  readonly etiquetaEstado = ETIQUETA_ESTADO_TRAMITE;
  readonly estados: EstadoTramite[] = ['POR_ENVIAR', 'RADICADA', 'CONFIRMADA', 'RECHAZADA'];

  pestana = signal(0);

  // ── Parametrización (también alimenta los filtros por EPS) ───────────────
  canales = signal<CanalEpsConfig[]>([]);
  cargandoCanales = signal(false);
  canalPorKey = computed(() => new Map(this.canales().map(c => [c.eps_key, c])));
  activas = computed(() => this.canales().filter(c => c.activa).length);

  // ── Bandeja ──────────────────────────────────────────────────────────────
  desde = haceDias(30);
  hasta = haceDias(-15);
  empresaBandeja = '';
  bandeja = signal<BandejaEps | null>(null);
  cargandoBandeja = signal(false);
  errorBandeja = signal<string | null>(null);
  /** Selección por EPS: cada tabla de la bandeja tiene la suya. */
  private selecciones = new Map<string, SelectionModel<PersonaBandeja>>();
  resultadoGrupo = signal<Record<string, ResultadoMasivoEps>>({});

  // ── Seguimiento ──────────────────────────────────────────────────────────
  estadoFiltro = 'RADICADA';
  epsFiltro = '';
  empresaFiltro = '';
  q = '';
  tramites = signal<TramiteEps[]>([]);
  cargandoTramites = signal(false);
  seleccionTramites = new SelectionModel<TramiteEps>(true, [], true, (a, b) => a.id === b.id);
  marcados = signal<TramiteEps[]>([]);

  // ── Envíos ───────────────────────────────────────────────────────────────
  envios = signal<EnvioEps[]>([]);
  cargandoEnvios = signal(false);

  ngOnInit() {
    this.cargarCanales();
    this.cargarBandeja();
    this.seleccionTramites.changed.subscribe(() => this.marcados.set(this.seleccionTramites.selected));
  }

  cambiarPestana(i: number) {
    this.pestana.set(i);
    if (i === 1 && !this.tramites().length) this.cargarTramites();
    if (i === 2) this.cargarEnvios();
    if (i === 3) this.cargarCanales();
  }

  // ════════════════════════════════════════════════════════════════════════
  // Bandeja
  // ════════════════════════════════════════════════════════════════════════

  cargarBandeja() {
    this.cargandoBandeja.set(true);
    this.errorBandeja.set(null);
    this.svc.bandeja({ desde: this.desde, hasta: this.hasta, empresa: this.empresaBandeja || null }).subscribe({
      next: b => {
        this.selecciones.clear();
        this.resultadoGrupo.set({});
        this.bandeja.set(b);
        this.cargandoBandeja.set(false);
      },
      error: (e: HttpErrorResponse) => {
        this.errorBandeja.set(e.error?.error ?? 'No se pudo cargar la bandeja.');
        this.cargandoBandeja.set(false);
      },
    });
  }

  seleccion(g: GrupoBandeja): SelectionModel<PersonaBandeja> {
    let s = this.selecciones.get(g.eps_key);
    if (!s) {
      s = new SelectionModel<PersonaBandeja>(true, [], true, (a, b) => a.proceso_id === b.proceso_id);
      this.selecciones.set(g.eps_key, s);
    }
    return s;
  }

  /** Marcadas que aún no tienen los datos confirmados. */
  porConfirmar(g: GrupoBandeja): PersonaBandeja[] {
    return this.seleccion(g).selected.filter(p => !p.tramite_id);
  }

  /** Marcadas listas para enviar; sin marcar ninguna = todas las listas del grupo. */
  listasMarcadas(g: GrupoBandeja): PersonaBandeja[] {
    return this.seleccion(g).selected.filter(p => !!p.tramite_id);
  }

  confirmarDatos(g: GrupoBandeja, incluirIncompletos = false) {
    const personas = this.porConfirmar(g);
    const candidatas = personas.length ? personas : g.personas.filter(p => !p.tramite_id && !p.faltantes.length);
    if (!candidatas.length) {
      this.snack.open('Marque las personas cuyos datos ya revisó.', 'OK', { duration: 4000 });
      return;
    }
    this.svc.confirmarDatos(candidatas.map(p => p.proceso_id), incluirIncompletos).subscribe({
      next: r => {
        this.snack.open(`${r.ok} persona(s) listas para enviar${r.omitidos ? ` · ${r.omitidos} omitidas` : ''}.`, 'OK', { duration: 5000 });
        this.cargarBandeja();
        this.resultadoGrupo.update(m => ({ ...m, [g.eps_key]: r }));
        this.cargarCanales();
      },
      error: (e: HttpErrorResponse) => this.snack.open(e.error?.error ?? 'No se pudo confirmar.', 'OK', { duration: 6000 }),
    });
  }

  abrirEnvio(g: GrupoBandeja) {
    const canal = g.canal ?? this.canalPorKey().get(g.eps_key)?.canal;
    if (!canal || !g.configurado) {
      this.configurar(g.eps_key);
      return;
    }
    const data: EnvioEpsDialogData = {
      epsKey: g.eps_key, epsNombre: g.eps_nombre, canal,
      tramiteIds: this.listasMarcadas(g).map(p => p.tramite_id!),
      modoEnvio: this.bandeja()?.modo_envio ?? 'prueba',
    };
    this.dialog.open(EnvioEpsDialogComponent, { data, maxWidth: '96vw' }).afterClosed().subscribe(r => {
      if (r) { this.cargarBandeja(); this.cargarCanales(); this.tramites.set([]); }
    });
  }

  readonly idPersona = (p: PersonaBandeja) => p.proceso_id;
  readonly columnasBandeja: ColumnaTabla<PersonaBandeja>[] = [
    { id: 'nombre', header: 'Nombre', valor: p => p.nombre, tarjeta: 'titulo', minAncho: '200px' },
    { id: 'cedula', header: 'Cédula', valor: p => p.cedula, tarjeta: 'subtitulo' },
    {
      id: 'datos', header: 'Datos', tarjeta: 'badge',
      valor: p => p.tramite_id ? 'Listo para enviar' : p.faltantes.length ? 'Datos incompletos' : 'Por confirmar',
      badge: p => p.tramite_id
        ? { texto: 'Listo para enviar', tono: 'ok', icono: 'task_alt' }
        : p.faltantes.length
          ? { texto: `Faltan ${p.faltantes.length}`, tono: 'danger', icono: 'error' }
          : { texto: 'Por confirmar', tono: 'warn', icono: 'pending' },
    },
    {
      id: 'faltantes', header: 'Qué falta', prioridad: 3,
      valor: p => p.faltantes.map(f => ETIQUETA_FALTANTE[f] ?? f).join(', '),
      formato: p => p.faltantes.length ? p.faltantes.map(f => ETIQUETA_FALTANTE[f] ?? f).join(', ') : '—',
    },
    {
      id: 'cedula_doc', header: 'Cédula cargada', align: 'center', prioridad: 2,
      valor: p => p.cedula_cargada === null ? 'Sin verificar' : p.cedula_cargada ? 'Sí' : 'No',
      badge: p => p.cedula_cargada === null ? { texto: 'Sin verificar', tono: 'neutro' }
        : p.cedula_cargada ? { texto: 'Sí', tono: 'ok' } : { texto: 'No', tono: 'danger' },
    },
    { id: 'empresa', header: 'Empresa', prioridad: 2, valor: p => p.empresa ? ETIQUETA_EMPRESA[p.empresa] : '—' },
    { id: 'fecha_ingreso', header: 'Ingreso', prioridad: 2, valor: p => p.fecha_ingreso, formato: p => fechaCorta(p.fecha_ingreso) },
    { id: 'oficina', header: 'Oficina', prioridad: 3, valor: p => p.oficina ?? '' },
    { id: 'finca', header: 'Finca', prioridad: 3, valor: p => p.finca ?? '' },
    { id: 'eps_texto', header: 'EPS en el contrato', prioridad: 3, valor: p => p.eps_texto ?? '' },
    {
      id: 'ingreso', header: 'Ingreso confirmado', align: 'center', prioridad: 3,
      valor: p => p.ingreso_confirmado ? 'Sí' : 'No',
      badge: p => p.ingreso_confirmado ? { texto: 'Sí', tono: 'ok' } : { texto: 'No', tono: 'neutro' },
    },
  ];

  // ════════════════════════════════════════════════════════════════════════
  // Seguimiento
  // ════════════════════════════════════════════════════════════════════════

  cargarTramites() {
    this.cargandoTramites.set(true);
    this.svc.tramites({
      estado: this.estadoFiltro || null, eps_key: this.epsFiltro || null,
      empresa: this.empresaFiltro || null, q: this.q.trim() || null, limite: 2000,
    }).subscribe({
      next: t => { this.seleccionTramites.clear(); this.tramites.set(t); this.cargandoTramites.set(false); },
      error: () => { this.cargandoTramites.set(false); this.snack.open('No se pudo cargar el seguimiento.', 'OK', { duration: 4000 }); },
    });
  }

  accion(accion: AccionTramite) {
    const sel = this.marcados();
    if (!sel.length) {
      this.snack.open('Marque primero los trámites.', 'OK', { duration: 3000 });
      return;
    }
    const sugerirDirecta = accion === 'confirmar'
      && sel.every(t => this.canalPorKey().get(t.eps_key)?.confirmacion_directa);
    this.dialog.open(AccionTramiteDialogComponent, { data: { accion, tramites: sel, sugerirDirecta } })
      .afterClosed().subscribe(ok => { if (ok) { this.cargarTramites(); this.cargarCanales(); } });
  }

  verTramite(t: TramiteEps) {
    this.dialog.open(HistorialTramiteDialogComponent, { data: t, maxWidth: '96vw' });
  }

  readonly idTramite = (t: TramiteEps) => t.id;
  readonly columnasTramites: ColumnaTabla<TramiteEps>[] = [
    { id: 'nombre', header: 'Nombre', valor: t => t.nombre, tarjeta: 'titulo', minAncho: '200px' },
    { id: 'cedula', header: 'Cédula', valor: t => t.cedula, tarjeta: 'subtitulo' },
    { id: 'eps', header: 'EPS', valor: t => t.eps_nombre },
    {
      id: 'estado', header: 'Estado', tarjeta: 'badge', valor: t => ETIQUETA_ESTADO_TRAMITE[t.estado],
      badge: t => ({
        texto: ETIQUETA_ESTADO_TRAMITE[t.estado] + (t.confirmacion_directa ? ' (directa)' : ''),
        tono: t.estado === 'CONFIRMADA' ? 'ok' : t.estado === 'RECHAZADA' ? 'danger' : t.estado === 'RADICADA' ? 'info' : 'warn',
      }),
    },
    { id: 'canal', header: 'Canal', prioridad: 2, valor: t => t.canal ? ETIQUETA_CANAL[t.canal] : '—' },
    { id: 'radicado', header: 'Radicado', prioridad: 2, valor: t => t.radicado_numero ?? '' , formato: t => t.radicado_numero ?? '—' },
    { id: 'radicado_fecha', header: 'Fecha radicado', prioridad: 2, valor: t => t.radicado_fecha, formato: t => fechaCorta(t.radicado_fecha) },
    { id: 'confirmacion_fecha', header: 'Fecha confirmación', prioridad: 3, valor: t => t.confirmacion_fecha, formato: t => fechaCorta(t.confirmacion_fecha) },
    {
      id: 'soportes', header: 'Soportes', align: 'center', prioridad: 3,
      valor: t => [t.radicado_doc_id ? 'Radicado' : '', t.confirmacion_doc_id ? 'Certificado' : ''].filter(Boolean).join(' + ') || 'Ninguno',
    },
    { id: 'empresa', header: 'Empresa', prioridad: 3, valor: t => t.empresa ? ETIQUETA_EMPRESA[t.empresa] : '—' },
    { id: 'fecha_ingreso', header: 'Ingreso', prioridad: 3, valor: t => t.fecha_ingreso, formato: t => fechaCorta(t.fecha_ingreso) },
    { id: 'rechazo', header: 'Devolución', prioridad: 3, valor: t => t.rechazo_motivo ?? '' },
  ];

  // ════════════════════════════════════════════════════════════════════════
  // Envíos
  // ════════════════════════════════════════════════════════════════════════

  cargarEnvios() {
    this.cargandoEnvios.set(true);
    this.svc.envios().subscribe({
      next: e => { this.envios.set(e); this.cargandoEnvios.set(false); },
      error: () => this.cargandoEnvios.set(false),
    });
  }

  verCorreo(e: EnvioEps) {
    if (e.canal !== 'CORREO' || e.estado === 'REGISTRADO') return;
    this.svc.cuerpoEnvio(e.id).subscribe({
      next: html => {
        const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
        window.open(url, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      },
      error: () => this.snack.open('No se pudo abrir el correo.', 'OK', { duration: 3000 }),
    });
  }

  readonly idEnvio = (e: EnvioEps) => e.id;
  readonly columnasEnvios: ColumnaTabla<EnvioEps>[] = [
    { id: 'fecha', header: 'Fecha', valor: e => e.created_at, formato: e => fechaHora(e.created_at), tarjeta: 'subtitulo' },
    { id: 'eps', header: 'EPS', valor: e => this.canalPorKey().get(e.eps_key)?.nombre ?? e.eps_key, tarjeta: 'titulo' },
    { id: 'empresa', header: 'Empresa', valor: e => e.empresa ? (ETIQUETA_EMPRESA[e.empresa] ?? e.empresa) : '—', prioridad: 2 },
    { id: 'canal', header: 'Canal', valor: e => ETIQUETA_CANAL[e.canal], prioridad: 2 },
    {
      id: 'estado', header: 'Resultado', tarjeta: 'badge', valor: e => e.estado,
      badge: e => ({
        texto: e.estado === 'PRUEBA' ? 'Prueba' : e.estado === 'ENVIADO' ? 'Enviado' : e.estado === 'REGISTRADO' ? 'Registrado' : 'Falló',
        tono: e.estado === 'FALLIDO' ? 'danger' : e.estado === 'PRUEBA' ? 'warn' : 'ok',
      }),
    },
    { id: 'personas', header: 'Personas', align: 'right', valor: e => e.total_personas },
    { id: 'adjuntos', header: 'Adjuntos', align: 'right', prioridad: 3, valor: e => e.total_adjuntos },
    { id: 'destinatario', header: 'Para', prioridad: 3, valor: e => e.destinatario ?? '' },
    { id: 'motivo', header: 'Detalle', prioridad: 3, valor: e => e.motivo ?? '' },
    { id: 'usuario', header: 'Usuario', prioridad: 3, valor: e => e.usuario ?? '' },
  ];

  // ════════════════════════════════════════════════════════════════════════
  // Parametrización
  // ════════════════════════════════════════════════════════════════════════

  cargarCanales() {
    this.cargandoCanales.set(true);
    this.svc.canales().subscribe({
      next: c => { this.canales.set(c); this.cargandoCanales.set(false); },
      error: () => { this.cargandoCanales.set(false); this.snack.open('No se pudo cargar la parametrización.', 'OK', { duration: 4000 }); },
    });
  }

  configurar(epsKey: string | null) {
    const c = epsKey ? this.canalPorKey().get(epsKey) ?? null : null;
    this.dialog.open(CanalEpsDialogComponent, { data: c, maxWidth: '96vw' }).afterClosed().subscribe(r => {
      if (r) { this.cargarCanales(); this.cargarBandeja(); }
    });
  }

  alternarActiva(c: CanalEpsConfig, activa: boolean) {
    this.svc.guardarCanal(c.eps_key, { activa }).subscribe({
      next: n => { this.canales.update(l => l.map(x => x.eps_key === n.eps_key ? n : x)); this.cargarBandeja(); },
      error: (e: HttpErrorResponse) => {
        this.snack.open(e.error?.error ?? 'No se pudo cambiar.', 'OK', { duration: 5000 });
        this.canales.update(l => [...l]);
      },
    });
  }

  readonly idCanal = (c: CanalEpsConfig) => c.eps_key;
  readonly columnasCanales: ColumnaTabla<CanalEpsConfig>[] = [
    { id: 'nombre', header: 'EPS', valor: c => c.nombre, tarjeta: 'titulo', minAncho: '200px' },
    { id: 'activa', header: 'Activa', align: 'center', interactiva: true, copiable: false, valor: c => c.activa ? 'Sí' : 'No' },
    {
      id: 'canal', header: 'Canal', tarjeta: 'badge', valor: c => ETIQUETA_CANAL[c.canal],
      badge: c => ({ texto: ETIQUETA_CANAL[c.canal], icono: ICONO_CANAL[c.canal],
        tono: c.canal === 'CORREO' ? 'info' : c.canal === 'PLATAFORMA' ? 'violet' : 'neutro' }),
    },
    {
      id: 'destino', header: 'Destino / plataforma', prioridad: 2,
      valor: c => c.canal === 'CORREO' ? (c.correo_destino ?? '') : c.canal === 'PLATAFORMA' ? (c.plataforma_url ?? '') : '',
      formato: c => c.canal === 'CORREO' ? (c.correo_destino ?? 'Falta el correo')
        : c.canal === 'PLATAFORMA' ? (c.plataforma_url ?? '—') : '—',
    },
    { id: 'plantilla', header: 'Formato', align: 'center', prioridad: 3, valor: c => c.tiene_plantilla ? 'Sí' : 'No' },
    { id: 'por_enviar', header: 'Por enviar', align: 'right', prioridad: 2, valor: c => c.por_enviar },
    { id: 'radicadas', header: 'Radicadas', align: 'right', prioridad: 3, valor: c => c.radicadas },
    { id: 'confirmadas', header: 'Confirmadas', align: 'right', prioridad: 3, valor: c => c.confirmadas },
    { id: 'nit', header: 'NIT', prioridad: 3, valor: c => c.nit ?? '' },
    { id: 'actualizado', header: 'Actualizado por', prioridad: 3, valor: c => c.actualizado_por ?? '' },
  ];
  readonly claseCanal = (c: CanalEpsConfig) => c.activa ? '' : 'te-fila--atenuada';
}

function haceDias(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

function fechaHora(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso
    : d.toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
