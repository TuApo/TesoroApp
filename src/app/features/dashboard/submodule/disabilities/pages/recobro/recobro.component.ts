/**
 * Submodulo "Recobro" de Radicacion (reunion funcional 2026-10-05).
 *
 * Aqui le APARECE a Luis Carlos / Ligia todo lo negado que no se ha finalizado (estado RECOBRO):
 * la causal de la EPS, cuando respondio y cuantos radicados lleva. Desde la bandeja se registra
 * el nuevo radicado (PQR) de una o varias, y desde "Recobro por codigo" se hace lo mismo pegando
 * codigos, igual que en Radicacion. Cada radicado queda con su fecha y se ve en "Ver radicados".
 * La incapacidad no se finaliza aqui: eso pasa en Liquidacion cuando llega una respuesta de pago.
 */
import { SelectionModel } from '@angular/cdk/collections';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';

import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';
import type { RecobroItem, SituacionRecobro } from '../../models/incapacidad-salud.model';
import { IncapacidadSaludService } from '../../services/incapacidad-salud/incapacidad-salud.service';
import { IncapacidadV2Service } from '../../services/incapacidad-v2/incapacidad-v2.service';
import { codigoSinGuion } from '../../utils/codigos';
import { PanelCodigosComponent } from '../radicacion/componentes/panel-codigos/panel-codigos.component';
import {
  aFechaLocal,
  codigoVisible,
  entidadDe,
  fechaCorta,
  mensajeError,
  OPCIONES_POR_PAGINA,
  periodo,
} from '../radicacion/radicacion.utils';
import {
  ANCHO_DIALOGO_RADICADOS,
  DatosDialogoRadicados,
  DialogoRadicadosRecobroComponent,
  ResultadoDialogoRadicados,
} from './dialogo-radicados-recobro/dialogo-radicados-recobro.component';
import {
  ANCHO_DIALOGO_REGISTRAR_RECOBRO,
  DatosDialogoRegistrarRecobro,
  DialogoRegistrarRecobroComponent,
  ResultadoDialogoRegistrarRecobro,
} from './dialogo-registrar-recobro/dialogo-registrar-recobro.component';
import {
  SITUACIONES_RECOBRO,
  causalHomologada,
  etiquetaSituacion,
  situacionDe,
  tonoSituacion,
  ultimoRecobro,
} from './recobro.utils';

@Component({
  selector: 'app-recobro',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatButtonToggleModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTabsModule,
    MatTooltipModule,
    ...TABLA_ESTANDAR,
    PanelCodigosComponent,
  ],
  templateUrl: './recobro.component.html',
  styleUrls: ['../gestion-incapacidades.comun.css', '../radicacion/radicacion.comun.css', './recobro.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecobroComponent implements OnInit {
  private readonly srv = inject(IncapacidadSaludService);
  private readonly v2 = inject(IncapacidadV2Service);
  private readonly dialogo = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);

  readonly rutaRadicacion = '/dashboard/disabilities/radicacion';
  readonly situaciones = SITUACIONES_RECOBRO;
  readonly opcionesPorPagina = OPCIONES_POR_PAGINA;
  readonly tab = signal(0);
  readonly epsOpciones = signal<string[]>([]);

  // ── Bandeja ───────────────────────────────────────────────────────────
  readonly situacion = signal<SituacionRecobro>('PENDIENTE');
  filtros = { q: '', eps: '' };
  private ultimoFiltro = '';
  readonly filas = signal<RecobroItem[]>([]);
  readonly total = signal(0);
  readonly pagina = signal(0);
  readonly tamano = signal(25);
  readonly cargando = signal(false);
  readonly error = signal('');
  readonly seleccion = new SelectionModel<RecobroItem>(true, []);
  readonly marcadas = signal(0);

  /** KPI: cuantas hay en cada situacion (sin filtros de texto ni EPS). */
  readonly conteoPendientes = signal<number | null>(null);
  readonly conteoRadicados = signal<number | null>(null);

  readonly idFila = (r: RecobroItem) => r.incapacidad.id;
  readonly fechaCorta = fechaCorta;
  readonly causalHomologada = causalHomologada;
  readonly ultimoRecobro = ultimoRecobro;

  readonly columnas: ColumnaTabla<RecobroItem>[] = [
    { id: 'codigo', header: 'Código', tarjeta: 'subtitulo', minAncho: '150px', valor: (r) => codigoVisible(r.incapacidad) },
    { id: 'cedula', header: 'Cédula', tarjeta: 'meta', valor: (r) => r.incapacidad.cedula },
    { id: 'nombre', header: 'Nombre', tarjeta: 'titulo', minAncho: '190px', valor: (r) => r.incapacidad.nombreCompleto },
    { id: 'entidad', header: 'EPS', prioridad: 2, tarjeta: 'meta', valor: (r) => entidadDe(r.incapacidad) },
    {
      id: 'periodo', header: 'Inicio – fin', prioridad: 2, tarjeta: 'meta', minAncho: '170px',
      valor: (r) => aFechaLocal(r.incapacidad.fechaInicio), formato: (r) => periodo(r.incapacidad),
    },
    {
      id: 'causal', header: 'Causal de negación', tarjeta: 'cuerpo', minAncho: '240px',
      valor: (r) => r.negacion?.causalTexto ?? '',
    },
    {
      id: 'respuesta', header: 'Respuesta EPS', prioridad: 2, tarjeta: 'meta',
      valor: (r) => aFechaLocal(r.negacion?.fechaRespuesta), formato: (r) => fechaCorta(r.negacion?.fechaRespuesta),
    },
    { id: 'radicados', header: 'Radicados', align: 'right', tarjeta: 'meta', valor: (r) => r.totalRadicados },
    {
      id: 'situacion', header: 'Situación', tarjeta: 'badge',
      valor: (r) => etiquetaSituacion(situacionDe(r, this.situacion())),
      badge: (r) => {
        const s = situacionDe(r, this.situacion());
        return { texto: etiquetaSituacion(s), tono: tonoSituacion(s) };
      },
    },
  ];

  constructor() {
    this.seleccion.changed
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.marcadas.set(this.seleccion.selected.length));
  }

  ngOnInit(): void {
    this.cargarEps();
    this.cargarConteos();
    this.filtrar(true);
  }

  private cargarEps(): void {
    this.v2.epsMatriz().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (m) => this.epsOpciones.set((m ?? []).map((e) => e.nombre)),
      error: () => this.epsOpciones.set([]),
    });
  }

  /** Dos consultas de una fila: solo interesa `totalElements`. */
  cargarConteos(): void {
    this.srv.recobros({ situacion: 'PENDIENTE' }, 0, 1).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (p) => this.conteoPendientes.set(p?.totalElements ?? 0),
      error: () => this.conteoPendientes.set(null),
    });
    this.srv.recobros({ situacion: 'RADICADO' }, 0, 1).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (p) => this.conteoRadicados.set(p?.totalElements ?? 0),
      error: () => this.conteoRadicados.set(null),
    });
  }

  cargar(): void {
    this.cargando.set(true);
    this.error.set('');
    this.srv
      .recobros(
        { situacion: this.situacion(), q: this.filtros.q.trim(), eps: this.filtros.eps.trim() },
        this.pagina(),
        this.tamano(),
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (p) => {
          this.filas.set(p?.content ?? []);
          this.total.set(p?.totalElements ?? 0);
          this.cargando.set(false);
        },
        error: (e: unknown) => {
          this.cargando.set(false);
          this.error.set(mensajeError(e, 'No se pudo cargar la bandeja de recobro.'));
        },
      });
  }

  /** Vuelve a la primera pagina; sin `forzar` no repite la consulta si nada cambio (blur). */
  filtrar(forzar = false): void {
    const clave = JSON.stringify([this.situacion(), this.filtros.q.trim(), this.filtros.eps.trim()]);
    if (!forzar && clave === this.ultimoFiltro) return;
    this.ultimoFiltro = clave;
    this.pagina.set(0);
    this.seleccion.clear();
    this.cargar();
  }

  cambiarSituacion(s: SituacionRecobro): void {
    if (!s) return;
    this.situacion.set(s);
    this.tab.set(0);
    this.filtrar();
  }

  paginar(e: { pagina: number; porPagina: number }): void {
    this.pagina.set(e.pagina);
    this.tamano.set(e.porPagina);
    this.cargar();
  }

  recargarTodo(): void {
    this.cargarConteos();
    this.cargar();
  }

  codigoGeneral(r: RecobroItem): string {
    return codigoSinGuion(r.incapacidad.codigoUnico);
  }

  // ── Dialogos ──────────────────────────────────────────────────────────

  verRadicados(item: RecobroItem): void {
    const datos: DatosDialogoRadicados = { item };
    this.dialogo
      .open(DialogoRadicadosRecobroComponent, {
        data: datos, width: ANCHO_DIALOGO_RADICADOS, maxWidth: '96vw', maxHeight: '92vh', autoFocus: false,
        panelClass: 'disab-dialogo',
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((r?: ResultadoDialogoRadicados) => {
        if (r?.recargar) this.recargarTodo();
      });
  }

  registrarSeleccion(): void {
    this.registrar(this.seleccion.selected);
  }

  registrar(items: readonly RecobroItem[]): void {
    if (!items.length) return;
    const datos: DatosDialogoRegistrarRecobro = { items: [...items] };
    this.dialogo
      .open(DialogoRegistrarRecobroComponent, {
        data: datos, width: ANCHO_DIALOGO_REGISTRAR_RECOBRO, maxWidth: '96vw', maxHeight: '92vh', autoFocus: false,
        panelClass: 'disab-dialogo',
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((r?: ResultadoDialogoRegistrarRecobro) => {
        if (!r?.recargar) return;
        this.seleccion.clear();
        this.recargarTodo();
      });
  }
}
