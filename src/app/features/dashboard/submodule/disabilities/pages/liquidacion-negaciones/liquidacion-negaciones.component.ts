/**
 * Submodulo "Negaciones" de Liquidacion (reunion funcional 2026-10-05).
 *
 * Cuando la EPS niega una incapacidad, la causal decide que pasa:
 *  - SOLO "1 y 2 dias no reconocidos" (los asume el empleador) y "no se evidencian aportes en las
 *    4 semanas anteriores" FINALIZAN ("FINALIZADO NEGADO ...");
 *  - cualquier otra pasa a RECOBRO (nuevo radicado bajo el mismo codigo unico).
 * Cada EPS escribe la causal a su manera, asi que hay un catalogo de causales INTERNAS y una
 * tabla de EQUIVALENCIAS por EPS (texto externo -> causal interna). Lo que llega sin equivalencia
 * queda "sin homologar" (va a recobro) hasta que alguien lo homologa: nunca se adivina.
 *
 * Pestanas: Negaciones (consulta, exportar, anular) · Causales internas (CRUD) · Equivalencias por
 * EPS (CRUD con reaplicar) · Sin homologar (textos pendientes con su accion "Homologar").
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
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import Swal from 'sweetalert2';
import type * as XLSX from 'xlsx';

import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';
import { IncapacidadSaludService } from '../../services/incapacidad-salud/incapacidad-salud.service';
import { IncapacidadV2Service } from '../../services/incapacidad-v2/incapacidad-v2.service';
import {
  AccionCausal,
  CausalNegacion,
  CausalSinHomologar,
  EquivalenciaCausal,
  FiltrosNegaciones,
  NegacionItem,
} from '../../models/incapacidad-salud.model';
import {
  EPS_TODAS,
  MAX_PAGINAS_EXPORT,
  RUTA_LIQUIDACION,
  TAMANO_PAGINA_EXPORT,
  claseAccion,
  claseEstadoIncapacidad,
  codigoVisible,
  entero,
  escaparHtml,
  escribirLibro,
  etiquetaAccion,
  etiquetaEps,
  fechaComoDate,
  fechaCorta,
  fechaHora,
  libroDeFilas,
  marcaDeTiempo,
  mensajeDeError,
  plural,
  tonoDeChip,
  traerTodasLasPaginas,
} from '../liquidacion/liquidacion.utils';
import {
  DatosDialogoCausal,
  DialogoCausalNegacionComponent,
} from './dialogos/dialogo-causal-negacion.component';
import {
  DatosDialogoEquivalencia,
  DialogoEquivalenciaComponent,
  ResultadoDialogoEquivalencia,
} from './dialogos/dialogo-equivalencia.component';

/** Pestanas de la pantalla. */
export const TAB_NEGACIONES = 0;
export const TAB_CAUSALES = 1;
export const TAB_EQUIVALENCIAS = 2;
export const TAB_SIN_HOMOLOGAR = 3;

/** Filtros del formulario de la pestana Negaciones. */
export interface FormularioNegaciones {
  q: string;
  eps: string;
  accion: AccionCausal | '';
  soloSinHomologar: boolean;
}

/** Formulario -> parametros del backend (sin claves vacias; `sinHomologar` solo si se pide). */
export function filtrosDeNegaciones(f: FormularioNegaciones, cargaId: number | null): FiltrosNegaciones {
  const filtros: FiltrosNegaciones = {};
  if (f.q.trim()) filtros.q = f.q.trim();
  if (f.eps.trim()) filtros.eps = f.eps.trim();
  if (f.accion) filtros.accion = f.accion;
  if (f.soloSinHomologar) filtros.sinHomologar = true;
  if (cargaId) filtros.cargaId = cargaId;
  return filtros;
}

/** Mensaje tras crear una equivalencia con reaplicar. */
export function mensajeReaplicar(negaciones: number, incapacidades: number): string {
  if (negaciones === 0) return 'No había negaciones cargadas sin homologar con ese texto.';
  return (
    `Se ${negaciones === 1 ? 'actualizó' : 'actualizaron'} ${plural(negaciones, 'negación', 'negaciones')} ` +
    `y se ${incapacidades === 1 ? 'recalculó' : 'recalcularon'} ${plural(incapacidades, 'incapacidad', 'incapacidades')}.`
  );
}

@Component({
  selector: 'app-liquidacion-negaciones',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTabsModule,
    MatTooltipModule,
    ...TABLA_ESTANDAR,
  ],
  templateUrl: './liquidacion-negaciones.component.html',
  styleUrls: ['../gestion-incapacidades.comun.css', './liquidacion-negaciones.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiquidacionNegacionesComponent implements OnInit {
  private readonly srv = inject(IncapacidadSaludService);
  private readonly srvV2 = inject(IncapacidadV2Service);
  private readonly dialogo = inject(MatDialog);
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly rutaLiquidacion = RUTA_LIQUIDACION;
  readonly tab = signal(TAB_NEGACIONES);
  readonly epsOpciones = signal<string[]>([]);

  // ── Negaciones ────────────────────────────────────────────────────────
  formulario: FormularioNegaciones = { q: '', eps: '', accion: '', soloSinHomologar: false };
  readonly cargaId = signal<number | null>(null);
  readonly negaciones = signal<NegacionItem[]>([]);
  readonly total = signal(0);
  readonly pagina = signal(0);
  readonly tamano = signal(50);
  readonly cargando = signal(false);
  readonly exportando = signal(false);
  readonly error = signal('');

  // ── Causales y equivalencias ──────────────────────────────────────────
  readonly causales = signal<CausalNegacion[] | null>(null);
  readonly cargandoCausales = signal(false);
  readonly equivalencias = signal<EquivalenciaCausal[] | null>(null);
  readonly cargandoEquivalencias = signal(false);
  readonly sinHomologar = signal<CausalSinHomologar[]>([]);
  readonly cargandoSinHomologar = signal(false);
  readonly totalSinHomologar = computed(() => this.sinHomologar().reduce((s, x) => s + Number(x.veces ?? 0), 0));

  readonly etiquetaEps = etiquetaEps;
  readonly claseAccion = claseAccion;
  readonly etiquetaAccion = etiquetaAccion;
  readonly claseEstadoIncapacidad = claseEstadoIncapacidad;
  readonly entero = entero;

  // ── Columnas ──────────────────────────────────────────────────────────

  readonly columnasNegaciones: ColumnaTabla<NegacionItem>[] = [
    { id: 'codigo', header: 'Código', ordenable: false, tarjeta: 'subtitulo', valor: (n) => codigoVisible(n.incapacidad) },
    { id: 'cedula', header: 'Cédula', ordenable: false, tarjeta: 'meta', valor: (n) => n.incapacidad?.cedula ?? '' },
    { id: 'nombre', header: 'Nombre', ordenable: false, tarjeta: 'titulo', minAncho: '150px', valor: (n) => n.incapacidad?.nombreCompleto ?? '' },
    { id: 'eps', header: 'EPS', ordenable: false, tarjeta: 'meta', minAncho: '110px', valor: (n) => n.eps ?? n.incapacidad?.eps ?? '' },
    { id: 'fechaRespuesta', header: 'Fecha respuesta', ordenable: false, tarjeta: 'meta',
      valor: (n) => fechaComoDate(n.fechaRespuesta), formato: (n) => fechaCorta(n.fechaRespuesta) || '—', copiaTexto: (n) => fechaCorta(n.fechaRespuesta) },
    { id: 'dias', header: 'Días', ordenable: false, align: 'right', prioridad: 2, tarjeta: 'meta', valor: (n) => n.diasLiquidados },
    { id: 'causalEps', header: 'Causal EPS', ordenable: false, tarjeta: 'cuerpo', minAncho: '170px', valor: (n) => n.causalTexto },
    { id: 'causal', header: 'Causal homologada', ordenable: false, tarjeta: 'cuerpo', minAncho: '160px',
      valor: (n) => (n.sinHomologar ? 'Sin homologar' : n.causalNombre ?? n.causalCodigo ?? ''), interactiva: true },
    { id: 'accion', header: 'Acción', ordenable: false, tarjeta: 'badge',
      valor: (n) => n.accionEtiqueta || etiquetaAccion(n.accion),
      badge: (n) => ({ texto: n.accionEtiqueta || etiquetaAccion(n.accion), tono: tonoDeChip(claseAccion(n.accion)) }) },
    { id: 'terminacion', header: 'Terminación', ordenable: false, prioridad: 3, tarjeta: 'meta', valor: (n) => n.terminacion ?? '', formato: (n) => n.terminacion || '—' },
    { id: 'estado', header: 'Estado actual', ordenable: false, prioridad: 2, tarjeta: 'badge',
      valor: (n) => n.incapacidad?.estadoEtiqueta ?? n.incapacidad?.estado ?? '',
      badge: (n) => ({ texto: n.incapacidad?.estadoEtiqueta ?? n.incapacidad?.estado ?? '—', tono: tonoDeChip(claseEstadoIncapacidad(n.incapacidad?.estado)) }) },
    { id: 'carga', header: 'Carga', ordenable: false, prioridad: 3, tarjeta: 'meta', valor: (n) => (n.cargaId ? `#${n.cargaId}` : '—') },
    { id: 'usuario', header: 'Usuario', ordenable: false, prioridad: 3, tarjeta: 'meta', valor: (n) => n.creadoPor ?? '', formato: (n) => n.creadoPor || '—' },
  ];

  readonly columnasCausales: ColumnaTabla<CausalNegacion>[] = [
    { id: 'orden', header: 'Orden', align: 'right', ancho: '70px', tarjeta: 'meta', valor: (c) => c.orden },
    { id: 'codigo', header: 'Código', tarjeta: 'subtitulo', valor: (c) => c.codigo },
    { id: 'nombre', header: 'Nombre', tarjeta: 'titulo', minAncho: '220px', valor: (c) => c.nombre },
    { id: 'accion', header: 'Acción', tarjeta: 'badge', valor: (c) => etiquetaAccion(c.accion),
      badge: (c) => ({ texto: c.accionEtiqueta || etiquetaAccion(c.accion), tono: tonoDeChip(claseAccion(c.accion)) }) },
    { id: 'terminacion', header: 'Terminación', prioridad: 2, tarjeta: 'meta', valor: (c) => c.terminacion ?? '', formato: (c) => c.terminacion || '—' },
    { id: 'equivalencias', header: 'Equivalencias', align: 'right', prioridad: 2, tarjeta: 'meta', valor: (c) => c.equivalencias },
    { id: 'activo', header: 'Estado', tarjeta: 'badge', valor: (c) => (c.activo ? 'Activa' : 'Inactiva'),
      badge: (c) => ({ texto: c.activo ? 'Activa' : 'Inactiva', tono: c.activo ? 'ok' : 'neutro' }) },
  ];

  readonly columnasEquivalencias: ColumnaTabla<EquivalenciaCausal>[] = [
    { id: 'eps', header: 'EPS', tarjeta: 'subtitulo', minAncho: '120px', valor: (e) => etiquetaEps(e.eps) },
    { id: 'texto', header: 'Texto de la EPS', tarjeta: 'titulo', minAncho: '240px', valor: (e) => e.textoExterno },
    { id: 'causal', header: 'Causal interna', tarjeta: 'cuerpo', minAncho: '200px', valor: (e) => e.causalNombre ?? e.causalCodigo ?? '' },
    { id: 'accion', header: 'Acción', tarjeta: 'badge', valor: (e) => etiquetaAccion(e.accion),
      badge: (e) => ({ texto: etiquetaAccion(e.accion) || '—', tono: tonoDeChip(claseAccion(e.accion)) }) },
    { id: 'activo', header: 'Estado', prioridad: 2, tarjeta: 'badge', valor: (e) => (e.activo ? 'Activa' : 'Inactiva'),
      badge: (e) => ({ texto: e.activo ? 'Activa' : 'Inactiva', tono: e.activo ? 'ok' : 'neutro' }) },
    { id: 'creado', header: 'Creada por', prioridad: 3, tarjeta: 'meta', valor: (e) => e.creadoPor ?? '',
      formato: (e) => [e.creadoPor, fechaHora(e.creadoEn)].filter(Boolean).join(' · ') || '—' },
  ];

  readonly columnasSinHomologar: ColumnaTabla<CausalSinHomologar>[] = [
    { id: 'texto', header: 'Texto de la EPS', tarjeta: 'titulo', minAncho: '260px', valor: (s) => s.textoExterno },
    { id: 'eps', header: 'EPS', tarjeta: 'subtitulo', minAncho: '120px', valor: (s) => s.eps ?? '', formato: (s) => s.eps || '—' },
    { id: 'veces', header: 'Veces', align: 'right', tarjeta: 'meta', valor: (s) => s.veces },
    { id: 'ultima', header: 'Última fecha', tarjeta: 'meta',
      valor: (s) => fechaComoDate(s.ultimaFecha), formato: (s) => fechaCorta(s.ultimaFecha) || '—', copiaTexto: (s) => fechaCorta(s.ultimaFecha) },
  ];

  readonly idNegacion = (n: NegacionItem) => n.id;
  readonly idCausal = (c: CausalNegacion) => c.id;
  readonly idEquivalencia = (e: EquivalenciaCausal) => e.id;
  readonly idSinHomologar = (s: CausalSinHomologar) => `${s.eps ?? ''}|${s.textoNormalizado}`;
  readonly claseNegacion = (n: NegacionItem) => (n.anulado ? 'te-fila--atenuada' : n.sinHomologar ? 'te-fila--alerta' : '');
  readonly claseInactiva = (x: { activo: boolean }) => (x.activo ? '' : 'te-fila--atenuada');

  ngOnInit(): void {
    const carga = Number(this.ruta.snapshot.queryParamMap.get('cargaId'));
    if (Number.isInteger(carga) && carga > 0) this.cargaId.set(carga);
    this.srvV2.epsMatriz().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (m) => this.epsOpciones.set((m ?? []).map((e) => e.nombre)),
      error: () => this.epsOpciones.set([]),
    });
    this.cargar();
    // Para el contador de la pestana "Sin homologar".
    this.cargarSinHomologar();
  }

  cambiarTab(i: number): void {
    this.tab.set(i);
    if (i === TAB_CAUSALES && this.causales() === null) this.cargarCausales();
    if (i === TAB_EQUIVALENCIAS) {
      if (this.equivalencias() === null) this.cargarEquivalencias();
      if (this.causales() === null) this.cargarCausales();
    }
    if (i === TAB_SIN_HOMOLOGAR) this.cargarSinHomologar();
  }

  // ── Negaciones ────────────────────────────────────────────────────────

  filtros(): FiltrosNegaciones {
    return filtrosDeNegaciones(this.formulario, this.cargaId());
  }

  cargar(): void {
    this.cargando.set(true);
    this.error.set('');
    this.srv.negaciones(this.filtros(), this.pagina(), this.tamano()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (p) => {
        this.negaciones.set(p.content ?? []);
        this.total.set(p.totalElements ?? 0);
        this.cargando.set(false);
      },
      error: (e: unknown) => {
        this.cargando.set(false);
        this.error.set(mensajeDeError(e, 'No se pudieron cargar las negaciones.'));
      },
    });
  }

  filtrar(): void {
    this.pagina.set(0);
    this.cargar();
  }

  limpiar(): void {
    this.formulario = { q: '', eps: '', accion: '', soloSinHomologar: false };
    this.filtrar();
  }

  quitarFiltroCarga(): void {
    this.cargaId.set(null);
    void this.router.navigate([], { relativeTo: this.ruta, queryParams: { cargaId: null }, queryParamsHandling: 'merge' });
    this.filtrar();
  }

  paginar(e: { pagina: number; porPagina: number }): void {
    this.pagina.set(e.pagina);
    this.tamano.set(e.porPagina);
    this.cargar();
  }

  anular(n: NegacionItem): void {
    if (n.anulado) return;
    void Swal.fire({
      icon: 'warning',
      title: 'Anular negación',
      html:
        `<p style="margin:0 0 8px">Negación de ${escaparHtml(n.eps ?? '')} a la incapacidad <b>${escaparHtml(codigoVisible(n.incapacidad))}</b> ` +
        `(${escaparHtml(n.incapacidad?.nombreCompleto ?? '')}): «${escaparHtml(n.causalTexto)}».</p>` +
        '<p style="margin:0;font-size:13px;color:#64748b">La negación queda anulada (no se borra) y se recalcula el estado de la incapacidad.</p>',
      input: 'textarea',
      inputLabel: 'Motivo (opcional)',
      inputPlaceholder: 'Por qué se anula',
      showCancelButton: true,
      confirmButtonText: 'Anular negación',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#c62828',
    }).then((r) => {
      if (!r.isConfirmed) return;
      const motivo = typeof r.value === 'string' && r.value.trim() ? r.value.trim() : undefined;
      this.srv.anularNegacion(n.id, motivo).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => {
          void Swal.fire({ icon: 'success', title: 'Negación anulada', timer: 2500, showConfirmButton: false });
          this.cargar();
          this.cargarSinHomologar();
        },
        error: (e: unknown) =>
          void Swal.fire({ icon: 'error', title: 'No se pudo anular la negación', text: mensajeDeError(e, 'Inténtalo de nuevo.') }),
      });
    });
  }

  exportar(): void {
    if (this.exportando() || this.total() === 0) return;
    this.exportando.set(true);
    const filtros = this.filtros();
    traerTodasLasPaginas((pagina) => this.srv.negaciones(filtros, pagina, TAMANO_PAGINA_EXPORT))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (negaciones) => {
          this.exportando.set(false);
          this.guardarLibro(
            libroDeFilas('Negaciones', negaciones.map((n) => filaExcelNegacion(n)), [12, 18, 14, 34, 20, 12, 8, 50, 24, 36, 16, 32, 18, 24, 8, 24, 16, 9]),
            `negaciones_incapacidades_${marcaDeTiempo()}.xlsx`,
          );
          if (this.total() > TAMANO_PAGINA_EXPORT * MAX_PAGINAS_EXPORT) {
            void Swal.fire({
              icon: 'info',
              title: 'Exportación parcial',
              text: `Se exportaron las primeras ${entero(negaciones.length)} de ${entero(this.total())} negaciones. Acota el filtro para exportar el resto.`,
            });
          }
        },
        error: (e: unknown) => {
          this.exportando.set(false);
          void Swal.fire({ icon: 'error', title: 'No se pudo exportar', text: mensajeDeError(e, 'Inténtalo de nuevo.') });
        },
      });
  }

  /** Envoltura de `XLSX.writeFile` (se espia en las pruebas). */
  guardarLibro(libro: XLSX.WorkBook, nombre: string): void {
    escribirLibro(libro, nombre);
  }

  // ── Causales internas ─────────────────────────────────────────────────

  cargarCausales(): void {
    this.cargandoCausales.set(true);
    this.srv.causales(true).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (c) => {
        this.causales.set([...(c ?? [])].sort((a, b) => a.orden - b.orden || a.codigo.localeCompare(b.codigo)));
        this.cargandoCausales.set(false);
      },
      error: (e: unknown) => {
        this.cargandoCausales.set(false);
        void Swal.fire({ icon: 'error', title: 'No se pudieron cargar las causales', text: mensajeDeError(e, 'Inténtalo de nuevo.') });
      },
    });
  }

  nuevaCausal(): void {
    const orden = Math.max(0, ...(this.causales() ?? []).filter((c) => c.orden < 99).map((c) => c.orden)) + 1;
    this.abrirCausal({ causal: null, ordenSugerido: orden });
  }

  editarCausal(c: CausalNegacion): void {
    this.abrirCausal({ causal: c });
  }

  private abrirCausal(datos: DatosDialogoCausal): void {
    this.dialogo
      .open<DialogoCausalNegacionComponent, DatosDialogoCausal, CausalNegacion | undefined>(DialogoCausalNegacionComponent, {
        data: datos, width: '660px', maxWidth: '96vw', maxHeight: '92vh', autoFocus: false, panelClass: 'disab-dialogo',
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((guardada) => {
        if (!guardada) return;
        this.cargarCausales();
        // Cambiar la accion re-evalua negaciones: se refresca lo que ya estaba a la vista.
        if (datos.causal && datos.causal.accion !== guardada.accion) this.cargar();
        if (this.equivalencias() !== null) this.cargarEquivalencias();
      });
  }

  // ── Equivalencias ─────────────────────────────────────────────────────

  cargarEquivalencias(): void {
    this.cargandoEquivalencias.set(true);
    this.srv.equivalencias().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (e) => {
        this.equivalencias.set(e ?? []);
        this.cargandoEquivalencias.set(false);
      },
      error: (e: unknown) => {
        this.cargandoEquivalencias.set(false);
        void Swal.fire({ icon: 'error', title: 'No se pudieron cargar las equivalencias', text: mensajeDeError(e, 'Inténtalo de nuevo.') });
      },
    });
  }

  nuevaEquivalencia(): void {
    this.conCausales((causales) => this.abrirEquivalencia({ modo: 'crear', causales, epsOpciones: this.epsOpciones() }));
  }

  editarEquivalencia(e: EquivalenciaCausal): void {
    this.conCausales((causales) =>
      this.abrirEquivalencia({ modo: 'editar', equivalencia: e, causales, epsOpciones: this.epsOpciones() }),
    );
  }

  /** Desde "Sin homologar" (o una negacion sin homologar): texto fijo, EPS propuesta. */
  homologar(textoExterno: string, eps: string | null): void {
    this.conCausales((causales) =>
      this.abrirEquivalencia({ modo: 'homologar', textoExterno, eps, causales, epsOpciones: this.epsOpciones() }),
    );
  }

  eliminarEquivalencia(e: EquivalenciaCausal): void {
    void Swal.fire({
      icon: 'warning',
      title: 'Eliminar equivalencia',
      html:
        `<p style="margin:0 0 8px">«${escaparHtml(e.textoExterno)}» (${escaparHtml(etiquetaEps(e.eps))}) → <b>${escaparHtml(e.causalNombre ?? e.causalCodigo ?? '')}</b></p>` +
        '<p style="margin:0;font-size:13px;color:#64748b">Las próximas cargas con este texto llegarán sin homologar. Las negaciones ya registradas no cambian.</p>',
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#c62828',
    }).then((r) => {
      if (!r.isConfirmed) return;
      this.srv.eliminarEquivalencia(e.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => {
          this.cargarEquivalencias();
          if (this.causales() !== null) this.cargarCausales();
        },
        error: (err: unknown) =>
          void Swal.fire({ icon: 'error', title: 'No se pudo eliminar', text: mensajeDeError(err, 'Inténtalo de nuevo.') }),
      });
    });
  }

  private abrirEquivalencia(datos: DatosDialogoEquivalencia): void {
    this.dialogo
      .open<DialogoEquivalenciaComponent, DatosDialogoEquivalencia, ResultadoDialogoEquivalencia | undefined>(DialogoEquivalenciaComponent, {
        data: datos, width: '660px', maxWidth: '96vw', maxHeight: '92vh', autoFocus: false, panelClass: 'disab-dialogo',
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        if (!r) return;
        this.trasGuardarEquivalencia(r);
      });
  }

  /** Refresca todo lo que una equivalencia puede mover y dice cuantas negaciones se actualizaron. */
  trasGuardarEquivalencia(r: ResultadoDialogoEquivalencia): void {
    if (r.tipo === 'creada') {
      const { negacionesActualizadas, incapacidadesRecalculadas } = r.resultado;
      void Swal.fire({
        icon: 'success',
        title: 'Equivalencia guardada',
        text: mensajeReaplicar(negacionesActualizadas ?? 0, incapacidadesRecalculadas ?? 0),
      });
      if ((negacionesActualizadas ?? 0) > 0) this.cargar();
    }
    this.cargarEquivalencias();
    this.cargarSinHomologar();
    if (this.causales() !== null) this.cargarCausales();
  }

  /** Las causales hacen falta en los dialogos de equivalencia: se cargan si aun no estan. */
  private conCausales(continuar: (causales: CausalNegacion[]) => void): void {
    const ya = this.causales();
    if (ya) {
      continuar(ya);
      return;
    }
    this.srv.causales(true).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (c) => {
        const ordenadas = [...(c ?? [])].sort((a, b) => a.orden - b.orden || a.codigo.localeCompare(b.codigo));
        this.causales.set(ordenadas);
        continuar(ordenadas);
      },
      error: (e: unknown) =>
        void Swal.fire({ icon: 'error', title: 'No se pudieron cargar las causales', text: mensajeDeError(e, 'Inténtalo de nuevo.') }),
    });
  }

  // ── Sin homologar ─────────────────────────────────────────────────────

  cargarSinHomologar(): void {
    this.cargandoSinHomologar.set(true);
    this.srv.causalesSinHomologar().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (s) => {
        this.sinHomologar.set(s ?? []);
        this.cargandoSinHomologar.set(false);
      },
      error: () => {
        this.sinHomologar.set([]);
        this.cargandoSinHomologar.set(false);
      },
    });
  }

  readonly epsTodas = EPS_TODAS;
}

/** Una fila del Excel de negaciones. */
export function filaExcelNegacion(n: NegacionItem): Record<string, unknown> {
  return {
    'Código oficina': n.incapacidad?.codigoOficina ?? '',
    'Código único': n.incapacidad?.codigoUnico ?? '',
    Cédula: n.incapacidad?.cedula ?? '',
    Nombre: n.incapacidad?.nombreCompleto ?? '',
    EPS: n.eps ?? n.incapacidad?.eps ?? '',
    'Fecha respuesta': fechaCorta(n.fechaRespuesta),
    Días: n.diasLiquidados ?? '',
    'Causal EPS': n.causalTexto ?? '',
    'Código causal': n.causalCodigo ?? '',
    'Causal homologada': n.sinHomologar ? 'SIN HOMOLOGAR' : n.causalNombre ?? '',
    Acción: n.accionEtiqueta || etiquetaAccion(n.accion),
    Terminación: n.terminacion ?? '',
    'Estado actual': n.incapacidad?.estadoEtiqueta ?? n.incapacidad?.estado ?? '',
    Observaciones: n.observaciones ?? '',
    Carga: n.cargaId ?? '',
    Usuario: n.creadoPor ?? '',
    Registrado: fechaHora(n.creadoEn),
    Anulada: n.anulado ? 'Sí' : 'No',
  };
}
