/**
 * Modulo "Radicacion" de Salud (reunion funcional 2026-10-05).
 *
 * Luis Carlos radica a mano en el portal de cada EPS (no se automatiza: el RPA se descarto) y
 * vuelve aqui a anotar el numero que le devolvieron, por pagina web, por correo dias despues o
 * en persona. La pantalla tiene:
 *  - el bloque "Radicar por codigo unico" (uno o varios codigos → un mismo radicado),
 *  - "Pendientes por radicar": validadas sin radicado, para traerlas al bloque sin teclear,
 *  - "Radicados recientes": lo ultimo que se anoto, para revisar.
 * Quien radico lo pone el backend con la sesion; la carga masiva vieja (Excel) sigue a mano.
 */
import { SelectionModel } from '@angular/cdk/collections';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';

import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';
import type {
  FiltrosPendientesRadicacion,
  IncapacidadRef,
  RadicadoItem,
} from '../../models/incapacidad-salud.model';
import { IncapacidadSaludService } from '../../services/incapacidad-salud/incapacidad-salud.service';
import { IncapacidadV2Service } from '../../services/incapacidad-v2/incapacidad-v2.service';
import { codigoSinGuion } from '../../utils/codigos';
import {
  DialogoCargaMasivaRadicadosComponent,
  ResultadoDialogoCargaMasiva,
} from '../consulta-incapacidades/dialogos/dialogo-carga-masiva-radicados/dialogo-carga-masiva-radicados.component';
import { PanelCodigosComponent } from './componentes/panel-codigos/panel-codigos.component';
import {
  aFechaLocal,
  codigoVisible,
  entidadDe,
  etiquetaDonde,
  etiquetaGrupo,
  fechaCorta,
  fechaHora,
  mensajeError,
  OPCIONES_POR_PAGINA,
  periodo,
  tonoEstado,
} from './radicacion.utils';

/** Pestanas de la parte de abajo (el bloque de codigos va siempre arriba). */
export const TAB_PENDIENTES = 0;
export const TAB_RECIENTES = 1;

@Component({
  selector: 'app-radicacion',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTabsModule,
    MatTooltipModule,
    ...TABLA_ESTANDAR,
    PanelCodigosComponent,
  ],
  templateUrl: './radicacion.component.html',
  styleUrls: ['../gestion-incapacidades.comun.css', './radicacion.comun.css', './radicacion.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RadicacionComponent implements OnInit {
  private readonly srv = inject(IncapacidadSaludService);
  private readonly v2 = inject(IncapacidadV2Service);
  private readonly dialogo = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);

  readonly panel = viewChild(PanelCodigosComponent);
  private readonly bloquePanel = viewChild<ElementRef<HTMLElement>>('bloquePanel');

  readonly rutaRecobro = '/dashboard/disabilities/radicacion/recobro';
  readonly opcionesPorPagina = OPCIONES_POR_PAGINA;
  readonly tab = signal(TAB_PENDIENTES);
  /** Lista cerrada de EPS (matriz de cartera); si no llega, el filtro pasa a texto libre. */
  readonly epsOpciones = signal<string[]>([]);

  // ── Pendientes por radicar ────────────────────────────────────────────
  filtros: Required<FiltrosPendientesRadicacion> = {
    q: '', eps: '', oficina: '', entidadGrupo: '', soloAplicativo: true,
  };
  private ultimoFiltro = '';
  readonly pendientes = signal<IncapacidadRef[]>([]);
  readonly totalPendientes = signal(0);
  readonly paginaPendientes = signal(0);
  readonly tamanoPendientes = signal(25);
  readonly cargandoPendientes = signal(false);
  readonly errorPendientes = signal('');
  readonly seleccionPendientes = new SelectionModel<IncapacidadRef>(true, []);
  /** El SelectionModel no es senal: se refleja la cuenta para el boton de la barra. */
  readonly marcadasPendientes = signal(0);

  // ── Radicados recientes ───────────────────────────────────────────────
  readonly historial = signal<RadicadoItem[]>([]);
  readonly totalHistorial = signal(0);
  readonly paginaHistorial = signal(0);
  readonly tamanoHistorial = signal(25);
  readonly qHistorial = signal('');
  readonly cargandoHistorial = signal(false);
  readonly errorHistorial = signal('');
  private historialCargado = false;

  readonly idPendiente = (r: IncapacidadRef) => r.id;
  readonly idRadicado = (r: RadicadoItem) => `${r.id ?? 'h'}-${r.incapacidadId}-${r.numeroRadicado}`;
  /** Lo que ya esta en el bloque de arriba se ve resaltado en Pendientes. */
  readonly clasePendiente = (r: IncapacidadRef): string =>
    this.panel()?.encontrados().some((e) => e.incapacidad.id === r.id) ? 'te-fila--info' : '';
  readonly fechaCorta = fechaCorta;
  readonly fechaHora = fechaHora;
  readonly etiquetaDonde = etiquetaDonde;

  readonly columnasPendientes: ColumnaTabla<IncapacidadRef>[] = [
    { id: 'codigo', header: 'Código', tarjeta: 'subtitulo', minAncho: '150px', valor: (r) => codigoVisible(r) },
    { id: 'cedula', header: 'Cédula', tarjeta: 'meta', valor: (r) => r.cedula },
    { id: 'nombre', header: 'Nombre', tarjeta: 'titulo', minAncho: '190px', valor: (r) => r.nombreCompleto },
    { id: 'entidad', header: 'EPS / entidad', prioridad: 2, tarjeta: 'meta', valor: (r) => entidadDe(r) },
    { id: 'tipo', header: 'Tipo', prioridad: 3, tarjeta: 'meta', valor: (r) => r.tipoIncapacidadEtiqueta ?? '' },
    {
      id: 'periodo', header: 'Inicio – fin', prioridad: 2, tarjeta: 'meta', minAncho: '170px',
      valor: (r) => aFechaLocal(r.fechaInicio), formato: (r) => periodo(r),
    },
    { id: 'dias', header: 'Días', align: 'right', prioridad: 3, tarjeta: 'meta', valor: (r) => r.dias },
    {
      id: 'estado', header: 'Estado', tarjeta: 'badge', valor: (r) => r.estadoEtiqueta || r.estado,
      badge: (r) => ({ texto: r.estadoEtiqueta || r.estado, tono: tonoEstado(r.estado) }),
    },
    { id: 'oficina', header: 'Oficina', prioridad: 3, tarjeta: 'meta', valor: (r) => r.oficina ?? '' },
    { id: 'grupo', header: 'Empleador', prioridad: 3, tarjeta: 'meta', valor: (r) => etiquetaGrupo(r.entidadGrupo) },
  ];

  readonly columnasHistorial: ColumnaTabla<RadicadoItem>[] = [
    {
      id: 'fecha', header: 'Fecha radicado', tarjeta: 'meta', minAncho: '110px',
      valor: (r) => aFechaLocal(r.fechaRadicado), formato: (r) => fechaCorta(r.fechaRadicado),
    },
    { id: 'numero', header: 'Radicado', tarjeta: 'subtitulo', minAncho: '140px', valor: (r) => r.numeroRadicado },
    { id: 'codigo', header: 'Código', tarjeta: 'meta', valor: (r) => r.codigoOficina || codigoSinGuion(r.codigoUnico) },
    { id: 'cedula', header: 'Cédula', prioridad: 2, tarjeta: 'meta', valor: (r) => r.cedula ?? '' },
    { id: 'nombre', header: 'Nombre', tarjeta: 'titulo', minAncho: '190px', valor: (r) => r.nombreCompleto ?? '' },
    { id: 'entidad', header: 'EPS / entidad', prioridad: 2, tarjeta: 'meta', valor: (r) => r.entidad || r.eps || '' },
    { id: 'donde', header: 'Dónde', tarjeta: 'badge', valor: (r) => etiquetaDonde(r.dondeRadicado) },
    { id: 'por', header: 'Radicado por', prioridad: 2, tarjeta: 'meta', valor: (r) => r.radicadoPor ?? '' },
    {
      id: 'registrado', header: 'Registrado', prioridad: 3, tarjeta: 'meta',
      valor: (r) => (r.creadoEn ? new Date(r.creadoEn) : null), formato: (r) => fechaHora(r.creadoEn),
    },
    {
      id: 'lote', header: 'Lote', prioridad: 3, tarjeta: 'meta', valor: (r) => (r.lote ? 'Colectivo' : 'Individual'),
    },
    { id: 'observaciones', header: 'Observaciones', prioridad: 3, tarjeta: 'cuerpo', valor: (r) => r.observaciones ?? '' },
  ];

  constructor() {
    this.seleccionPendientes.changed
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.marcadasPendientes.set(this.seleccionPendientes.selected.length));
  }

  ngOnInit(): void {
    this.cargarEps();
    this.filtrarPendientes(true);
  }

  private cargarEps(): void {
    this.v2.epsMatriz().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (m) => this.epsOpciones.set((m ?? []).map((e) => e.nombre)),
      error: () => this.epsOpciones.set([]),
    });
  }

  cambiarTab(i: number): void {
    this.tab.set(i);
    if (i === TAB_RECIENTES && !this.historialCargado) this.cargarHistorial();
  }

  /** Recarga lo de abajo (lo de arriba es la lista de trabajo del usuario: no se toca). */
  actualizar(): void {
    this.cargarPendientes();
    if (this.historialCargado) this.cargarHistorial();
  }

  // ── Pendientes ────────────────────────────────────────────────────────

  /** Vuelve a la primera pagina; sin `forzar` no repite la consulta si nada cambio (blur). */
  filtrarPendientes(forzar = false): void {
    const clave = JSON.stringify(this.filtrosLimpios());
    if (!forzar && clave === this.ultimoFiltro) return;
    this.ultimoFiltro = clave;
    this.paginaPendientes.set(0);
    this.cargarPendientes();
  }

  private filtrosLimpios(): FiltrosPendientesRadicacion {
    const f = this.filtros;
    return {
      q: f.q.trim(),
      eps: f.eps.trim(),
      oficina: f.oficina.trim(),
      entidadGrupo: f.entidadGrupo,
      soloAplicativo: f.soloAplicativo,
    };
  }

  cargarPendientes(): void {
    this.cargandoPendientes.set(true);
    this.errorPendientes.set('');
    this.srv
      .pendientesRadicacion(this.filtrosLimpios(), this.paginaPendientes(), this.tamanoPendientes())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (p) => {
          this.pendientes.set(p?.content ?? []);
          this.totalPendientes.set(p?.totalElements ?? 0);
          this.cargandoPendientes.set(false);
        },
        error: (e: unknown) => {
          this.cargandoPendientes.set(false);
          this.errorPendientes.set(mensajeError(e, 'No se pudieron cargar las pendientes por radicar.'));
        },
      });
  }

  paginarPendientes(e: { pagina: number; porPagina: number }): void {
    this.paginaPendientes.set(e.pagina);
    this.tamanoPendientes.set(e.porPagina);
    this.cargarPendientes();
  }

  limpiarFiltros(): void {
    this.filtros = { q: '', eps: '', oficina: '', entidadGrupo: '', soloAplicativo: true };
    this.filtrarPendientes();
  }

  /** Lleva las marcadas al bloque de arriba sin volver a teclear sus codigos. */
  agregarSeleccion(): void {
    this.agregarARadicar(this.seleccionPendientes.selected);
    this.seleccionPendientes.clear();
  }

  agregarARadicar(filas: readonly IncapacidadRef[]): void {
    if (!filas.length) return;
    this.panel()?.agregarIncapacidades(filas);
    this.bloquePanel()?.nativeElement.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  // ── Radicados recientes ───────────────────────────────────────────────

  cargarHistorial(): void {
    this.historialCargado = true;
    this.cargandoHistorial.set(true);
    this.errorHistorial.set('');
    this.srv
      .historialRadicados('RADICACION', this.qHistorial(), this.paginaHistorial(), this.tamanoHistorial())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (p) => {
          this.historial.set(p?.content ?? []);
          this.totalHistorial.set(p?.totalElements ?? 0);
          this.cargandoHistorial.set(false);
        },
        error: (e: unknown) => {
          this.cargandoHistorial.set(false);
          this.errorHistorial.set(mensajeError(e, 'No se pudieron cargar los radicados recientes.'));
        },
      });
  }

  buscarHistorial(q: string): void {
    this.qHistorial.set(q);
    this.paginaHistorial.set(0);
    this.cargarHistorial();
  }

  paginarHistorial(e: { pagina: number; porPagina: number }): void {
    this.paginaHistorial.set(e.pagina);
    this.tamanoHistorial.set(e.porPagina);
    this.cargarHistorial();
  }

  // ── Eventos ───────────────────────────────────────────────────────────

  /** Algo quedo radicado: sale de pendientes y entra en recientes. */
  alGuardar(): void {
    this.cargarPendientes();
    if (this.historialCargado) {
      this.paginaHistorial.set(0);
      this.cargarHistorial();
    }
  }

  /** La carga masiva por Excel de siempre (la funcional prefirio la interfaz, pero no se quita). */
  abrirCargaMasiva(): void {
    this.dialogo
      .open(DialogoCargaMasivaRadicadosComponent, {
        width: '860px', maxWidth: '95vw', maxHeight: '92vh', autoFocus: false, panelClass: 'disab-dialogo',
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((r?: ResultadoDialogoCargaMasiva) => {
        if (r?.recargar) this.alGuardar();
      });
  }
}
