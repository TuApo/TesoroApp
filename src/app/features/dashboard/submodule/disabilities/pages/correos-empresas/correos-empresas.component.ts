/**
 * Submodulo "Correos a empresas usuarias" (reunion 2026-09-07, Nathalia Ovalle):
 *
 *  - LOTE DE HOY: lo que saldria al final del dia, correo por correo (finca, dirigido a, copias,
 *    tabla de cedulas) con vista previa exacta y boton "Enviar ahora".
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
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import Swal from 'sweetalert2';

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
import { hoyIso, mensajeDeError } from '../informes-incapacidades/informes-incapacidades.component';
import { DialogoVistaCorreoComponent, DatosVistaCorreo } from './dialogo-vista-correo.component';
import { DialogoCorreoEmpresaComponent, DatosDialogoCorreoEmpresa } from './dialogo-correo-empresa.component';

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
    DatePipe, DecimalPipe, FormsModule, MatButtonModule, MatCardModule, MatExpansionModule, MatFormFieldModule,
    MatIconModule, MatInputModule, MatPaginatorModule, MatProgressSpinnerModule, MatRadioModule, MatSelectModule,
    MatSlideToggleModule, MatTabsModule, MatTooltipModule,
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

  // ── Lote de hoy ───────────────────────────────────────────────────────
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

  ngOnInit(): void {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    this.enviadosDesde = hoyIso(d);
    this.cargarConfig();
    this.cargarPreview();
  }

  cambiarTab(i: number): void {
    this.tab.set(i);
    if (i === 2 && this.directorio().length === 0) this.cargarDirectorio();
    if (i === 3 && this.lotes().length === 0 && this.envios().length === 0) this.cargarEnviados();
  }

  // ── Configuracion ─────────────────────────────────────────────────────

  cargarConfig(): void {
    this.srv.correoConfig().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (c) => {
        this.config.set(c);
        this.modoEnvio = c.envioModo;
        this.horaEnvio = c.envioHora;
        this.ventanaDias = c.ventanaDias;
      },
      error: () => this.config.set(null),
    });
  }

  guardarConfig(): void {
    this.guardandoConfig.set(true);
    this.srv
      .actualizarCorreoConfig({ envioModo: this.modoEnvio, envioHora: this.horaEnvio, ventanaDias: Number(this.ventanaDias) })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (c) => {
          this.config.set(c);
          this.guardandoConfig.set(false);
          void Swal.fire({
            icon: 'success', title: 'Configuracion guardada',
            text: c.envioModo === 'DIARIO'
              ? `Los correos saldran en un solo lote por finca todos los dias a las ${c.envioHora}.`
              : 'Cada incapacidad enviara su correo al momento de recibirla (al cargar el soporte).',
            timer: 3500, showConfirmButton: false,
          });
          this.cargarPreview();
        },
        error: (e: unknown) => {
          this.guardandoConfig.set(false);
          void Swal.fire({ icon: 'error', title: 'No se pudo guardar', text: mensajeDeError(e, 'Intente de nuevo.') });
        },
      });
  }

  // ── Lote de hoy ───────────────────────────────────────────────────────

  cargarPreview(): void {
    this.cargandoPreview.set(true);
    this.errorPreview.set('');
    this.srv.previsualizarLote().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (p) => { this.preview.set(p); this.cargandoPreview.set(false); },
      error: (e: unknown) => { this.cargandoPreview.set(false); this.errorPreview.set(mensajeDeError(e, 'No se pudo armar la previsualizacion.')); },
    });
  }

  verGrupo(g: GrupoLotePreview): void {
    this.abrirVista({
      titulo: `Correo a ${g.empresaMatch || g.incapacidades[0]?.empresa || 'empresa usuaria'}`,
      asunto: g.asunto, destinatario: g.destinatario, copias: g.copias, cuerpoHtml: g.cuerpoHtml,
    });
  }

  enviarAhora(): void {
    const p = this.preview();
    if (!p || p.totalIncapacidades === 0) return;
    void Swal.fire({
      icon: 'question',
      title: 'Enviar los correos de hoy ahora',
      html:
        `<p style="margin:0 0 8px">Se enviaran <b>${p.totalCorreos}</b> correo(s) con <b>${p.totalIncapacidades}</b> incapacidad(es).</p>` +
        (p.prueba
          ? `<p style="margin:0;font-size:13px;color:#b26a00"><b>Modo prueba:</b> todo sale a ${escapar(p.destinoPrueba ?? '')} con el destinatario real anotado.</p>`
          : '<p style="margin:0;font-size:13px;color:#c62828"><b>Modo activo:</b> saldran a los correos reales de cada finca.</p>'),
      showCancelButton: true, confirmButtonText: 'Enviar ahora', cancelButtonText: 'Cancelar', confirmButtonColor: '#1976d2',
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

  paginarEnvios(e: PageEvent): void {
    this.pageEnvios.set(e.pageIndex);
    this.sizeEnvios.set(e.pageSize);
    this.cargarEnviados();
  }

  verLote(l: LoteCorreo): void {
    this.srv.lote(l.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (d) => this.abrirVista({
        titulo: `Lote #${d.id} · ${d.empresaMatch || 'sin finca'} · ${d.fechaLote}`,
        asunto: d.asunto, destinatario: d.destinatario, copias: d.cc, cuerpoHtml: d.cuerpoHtml ?? '', estado: d.estado, mensajeError: d.mensajeError,
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
    this.dialogo.open(DialogoVistaCorreoComponent, { data: datos, width: '820px', maxWidth: '96vw', autoFocus: false });
  }

  trackGrupo(_: number, g: GrupoLotePreview): string { return g.clave; }
  trackDir(_: number, g: GrupoDirectorio): string { return `${g.grupo}|${g.empresa}`; }
  trackFila(_: number, f: CorreoEmpresa): number { return f.id; }
  trackLote(_: number, l: LoteCorreo): number { return l.id; }
  trackEnvio(_: number, h: EnvioHistorial): number { return h.notificacion.id; }
}

function escapar(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
