import { ColumnDefinition } from '@/app/shared/models/advanced-table-interface';
import {  Component, OnInit, AfterViewInit, OnDestroy, ChangeDetectionStrategy, ViewChild, ChangeDetectorRef } from '@angular/core';
import { forkJoin, of, Subscription } from 'rxjs';
import { map, catchError, take } from 'rxjs/operators';

import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';

import Swal from 'sweetalert2';

import { VacantesService } from '../../service/vacantes/vacantes.service';
import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';
import { SharedModule } from '@/app/shared/shared.module';
import { CrearEditarVacanteComponent } from '../../components/crear-editar-vacante/crear-editar-vacante.component';
import { CumplimientoDialogComponent } from '../../components/cumplimiento-dialog/cumplimiento-dialog.component';
import { VacantesDashboardComponent } from '../../components/vacantes-dashboard/vacantes-dashboard.component';
import { DateRangeDialogComponent } from '@/app/shared/components/date-rang-dialog/date-rang-dialog.component';
import { StandardFilterTable } from '@/app/shared/components/standard-filter-table/standard-filter-table';
import { ColumnCellTemplateDirective } from '@/app/shared/directives/column-cell-template.directive';
import { getLocalStorageItem, setLocalStorageItem } from '../../../../../../core/utils/safe-storage';
import { SedeScopeService } from '../../../../../../shared/services/sede-scope/sede-scope.service';

interface ConteoEstados {
  pre_registro: number;
  entrevistado: number;
  prueba_tecnica: number;
  autorizado: number;
  examenes_medicos: number;
  contratado: number;
  ingreso: number;
  total_con_su_ultimo_registro: number;
}
type AuxilioTransporte = 'Si' | 'No';

interface OficinaPayload {
  nombre: string;
  ruta: boolean;
}

interface DistPayload {
  municipio: string;
  cantidad: number;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-vacantes',
  standalone: true,
  imports: [
    SharedModule,
    StandardFilterTable,
    MatMenuModule,
    MatDialogModule,
    MatButtonToggleModule,
    MatIconModule,
    MatSlideToggleModule,
    MatButtonModule,
    MatDividerModule,
    MatTooltipModule,
    ColumnCellTemplateDirective,
    VacantesDashboardComponent
],
  templateUrl: './vacantes.component.html',
  styleUrl: './vacantes.component.css',
} )
export class VacantesComponent implements OnInit, AfterViewInit, OnDestroy {
  // Data
  private allRows: any[] = [];
  visibleRows: any[] = [];

  // Selección masiva (checkbox de la tabla compartida)
  @ViewChild(StandardFilterTable) private tabla?: StandardFilterTable;
  seleccionCount = 0;
  private selSub?: Subscription;

  // Tabla
  pageSizeOptions: number[] = [10, 25, 50];
  defaultPageSize = 10;
  tableTitle = 'Vacantes';

  // ⬇️ OJO: la columna de acciones se llama "actions" en TODO lado
  columnDefinitions: ColumnDefinition[] = [
    { name: 'actions', header: 'Acciones', type: 'custom', filterable: false, sortable: false, width: '72px', stickyStart: true },

    { name: 'cumpl', header: 'Cumpl.', type: 'custom', filterable: false, sortable: true, width: '90px' },
    { name: 'fecha_publicado', header: 'Publicado', type: 'date', filterable: true, sortable: true, width: '120px' },

    // Embudo del proceso: las 8 etapas (Req, Falt, Entrev, Pru, Auto, Exm,
    // Firm, Ing) colapsadas en UNA sola columna compacta de chips para ganar
    // espacio horizontal. El detalle de cada etapa sale en el tooltip.
    { name: 'embudo', header: 'Embudo', type: 'custom', filterable: false, sortable: false, width: '180px' },

    { name: 'finca', header: 'Centro de costo', type: 'text', filterable: true, sortable: true, width: '170px' },
    { name: 'cargo', header: 'Cargo', type: 'text', filterable: true, sortable: true, width: '170px' },
    { name: 'empresa_usuaria_solicita', header: 'Empresa usuaria', type: 'text', filterable: true, sortable: true, width: '170px' },

    // Municipio: si son más de 2 se colapsa en un chip (el detalle sale en el
    // tooltip), igual que "Obs. / Descripción"; con 2 o menos se muestran los
    // nombres. La búsqueda global sigue funcionando por `municipioLabel`.
    { name: 'municipioLabel', header: 'Municipio', type: 'custom', filterable: false, sortable: false, width: '150px' },

    { name: 'experiencia', header: 'Expe', type: 'text', filterable: true, sortable: true, width: '90px' },
    // Observación del perfil + Descripción colapsadas en UN solo chip para
    // ahorrar espacio; el detalle completo de ambas sale en el tooltip.
    { name: 'perfil', header: 'Obs. / Descripción', type: 'custom', filterable: false, sortable: false, width: '110px' },

    { name: 'salario', header: 'Salario', type: 'custom', filterable: false, sortable: true, width: '140px' },
    { name: 'auxilio_transporte', header: 'Auxilio', type: 'text', filterable: true, sortable: true, width: '120px' },
    { name: 'tipo_contratacion', header: 'Tipo de Contrato', type: 'text', filterable: true, sortable: true, width: '160px' },
  ];

  displayedColumns: string[] = this.columnDefinitions.map(c => c.name);

  viewMode: 'table' | 'faltantes' | 'completados' | 'inactivas' = 'table';
  loading = false;
  /** Qué conjunto está cargado en `allRows` para no refetch innecesario. */
  private cargadoComo: 'activas' | 'inactivas' = 'activas';

  permitido = false;
  sede = '';
  /** Oficinas sobre las que el usuario puede operar (multi-sede V62). */
  sedesAlcance: string[] = [];
  /** true si su rol no se recorta por sede (ADMIN/GERENCIA): ve todas las oficinas. */
  sinLimiteSede = false;
  busyActivoIds = new Set<number | string>();

  // ================== Filtros de la cabecera ==================
  /** ADMIN/GERENCIA ven todas las oficinas y pueden elegir cuál mirar. */
  puedeElegirOficina = false;
  /** Catálogo de oficinas (sedes) para el selector de gerencia. */
  oficinas: string[] = [];
  filtrosAbiertos = true;

  filtros: {
    oficina: string;
    finca: string;
    empresa: string;
    cargo: string;
    municipio: string;
    tipo: string;
    antiguedad: number;
    desde: Date | null;
    hasta: Date | null;
  } = {
    oficina: '',
    finca: '',
    empresa: '',
    cargo: '',
    municipio: '',
    tipo: '',
    antiguedad: 0,
    desde: null,
    hasta: null,
  };

  /** Opciones de los desplegables, derivadas de lo que hay cargado. */
  opcFincas: string[] = [];
  opcEmpresas: string[] = [];
  opcCargos: string[] = [];
  opcMunicipios: string[] = [];
  opcTipos: string[] = [];

  readonly opcAntiguedad = [
    { valor: 0, label: 'Cualquier antigüedad' },
    { valor: 8, label: 'Más de 7 días' },
    { valor: 16, label: 'Más de 15 días' },
    { valor: 31, label: 'Más de 30 días' },
    { valor: 61, label: 'Más de 60 días' },
  ];

  constructor(
    private dialog: MatDialog,
    private vacantesService: VacantesService,
    private utilityService: UtilityServiceService,
    private sedeScope: SedeScopeService,
    private cdr: ChangeDetectorRef,
  ) { }

  ngOnInit(): void {
    const saved =
      typeof window !== 'undefined'
        ? (getLocalStorageItem('vacantes:viewMode') as 'table' | 'faltantes' | 'completados' | 'inactivas' | null)
        : null;
    if (saved) this.viewMode = saved;

    const user = this.utilityService.getUser();
    this.sede = this.sedeScope.activa() || user?.sede?.nombre || '';
    this.permitido = this.isManager(user);
    this.sinLimiteSede = this.sedeScope.sinLimite();
    this.sedesAlcance = this.sedeScope.nombres();
    // Multi-sede (V62): el selector de oficina se abre para quien no se recorta por
    // sede (Gerencia/Admin) Y para quien tiene varias asignadas; con una sola el
    // filtro queda anclado, igual que antes de existir el multi-sede.
    this.puedeElegirOficina = this.sedeScope.puedeElegirOficina();

    if (this.puedeElegirOficina) {
      // "" = todas las oficinas de su alcance (todo el catálogo si no se recorta).
      const guardada = typeof window !== 'undefined' ? getLocalStorageItem('vacantes:oficina') : null;
      this.filtros.oficina = guardada && this.sedeScope.alcanza(guardada) ? guardada : '';
      this.cargarOficinas();
    } else {
      this.filtros.oficina = this.sede;
    }

    this.loadData();
  }

  /** Catálogo de sedes para el selector (cacheado en el utility service). */
  private cargarOficinas(): void {
    this.utilityService.traerSucursales().subscribe({
      next: (data: any) => {
        const arr = Array.isArray(data) ? data : (data?.results ?? []);
        const catalogo = arr
          .filter((s: any) => s?.activa !== false)
          .map((s: any) => String(s?.nombre ?? '').trim())
          .filter((n: string) => !!n)
          .sort((a: string, b: string) => a.localeCompare(b));
        // Quien se recorta por sede solo puede elegir entre las suyas.
        this.oficinas = this.sedeScope.opciones(catalogo);

        // La oficina recordada puede haberse borrado del catálogo: si ya no
        // existe, el selector saldría en blanco filtrando por un nombre muerto.
        if (this.filtros.oficina && !this.oficinas.includes(this.filtros.oficina)) {
          this.filtros.oficina = '';
          try { setLocalStorageItem('vacantes:oficina', ''); } catch { }
          this.applyViewMode();
        }
        this.cdr.markForCheck();
      },
      error: () => { },
    });
  }

  onToggleView(mode: 'table' | 'faltantes' | 'completados' | 'inactivas'): void {
    this.viewMode = mode;
    try { setLocalStorageItem('vacantes:viewMode', mode); } catch { }

    // "Inactivas" trae otro conjunto desde el backend. Sólo refetch si cruzamos
    // el límite activas <-> inactivas; entre subvistas de activas, filtra local.
    const necesita: 'activas' | 'inactivas' = mode === 'inactivas' ? 'inactivas' : 'activas';
    if (necesita !== this.cargadoComo) {
      this.loadData();
    } else {
      this.applyViewMode();
    }
  }

  /**
   * Recalcula lo que se ve: primero la pestaña (Todos / Faltantes /
   * Completados / Inactivas) y encima los filtros de la cabecera. El
   * resultado alimenta a la vez la tabla y el panel de indicadores, así los
   * dos cuentan siempre lo mismo.
   */
  private applyViewMode(): void {
    const rows = this.allRows ?? [];

    let base: any[];
    if (this.viewMode === 'inactivas') {
      base = rows.filter(r => r.activo === false);
    } else {
      const activas = rows.filter(r => r.activo !== false);
      if (this.viewMode === 'faltantes') {
        base = activas.filter(r => (Number(r?.falt) || 0) > 0);
      } else if (this.viewMode === 'completados') {
        base = activas.filter(r => (Number(r?.req) || 0) > 0 && (Number(r?.falt) || 0) === 0);
      } else {
        base = activas;
      }
    }

    this.visibleRows = this.aplicarFiltros(base);
    this.recalcularOpciones();
    this.cdr.markForCheck();
  }

  /** Aplica los filtros de la cabecera sobre un conjunto ya acotado por vista. */
  private aplicarFiltros(rows: any[]): any[] {
    const f = this.filtros;
    const desde = this.soloFecha(f.desde);
    const hasta = this.soloFecha(f.hasta);

    return rows.filter(r => {
      // "Todas las oficinas" significa todas las SUYAS: sin este recorte, alguien
      // con varias sedes vería también las vacantes de las oficinas ajenas.
      if (!this.dentroDelAlcance(r)) return false;
      if (f.oficina && !this.matchesSede(r, f.oficina)) return false;
      if (f.finca && this.norm(r?.finca) !== this.norm(f.finca)) return false;
      if (f.empresa && this.norm(r?.empresa_usuaria_solicita) !== this.norm(f.empresa)) return false;
      if (f.cargo && this.norm(r?.cargo) !== this.norm(f.cargo)) return false;
      if (f.tipo && this.norm(r?.tipo_contratacion) !== this.norm(f.tipo)) return false;

      if (f.municipio) {
        const arr = Array.isArray(r?.municipio) ? r.municipio : [];
        if (!arr.some((m: any) => this.norm(m) === this.norm(f.municipio))) return false;
      }

      if (desde || hasta) {
        const pub = this.aFecha(r?.fecha_publicado);
        if (!pub) return false;
        if (desde && pub.getTime() < desde.getTime()) return false;
        if (hasta && pub.getTime() > hasta.getTime()) return false;
      }

      if (f.antiguedad > 0) {
        const dias = this.diasPublicada(r);
        if (dias === null || dias < f.antiguedad) return false;
      }

      return true;
    });
  }

  /** Los desplegables listan sólo lo que existe dentro de la oficina elegida. */
  private recalcularOpciones(): void {
    const base = (this.allRows ?? []).filter(
      r => this.dentroDelAlcance(r)
        && (!this.filtros.oficina || this.matchesSede(r, this.filtros.oficina))
    );

    this.opcFincas = this.valoresUnicos(base, r => r?.finca);
    this.opcEmpresas = this.valoresUnicos(base, r => r?.empresa_usuaria_solicita);
    this.opcCargos = this.valoresUnicos(base, r => r?.cargo);
    this.opcTipos = this.valoresUnicos(base, r => r?.tipo_contratacion);

    const municipios = new Set<string>();
    for (const r of base) {
      const arr = Array.isArray(r?.municipio) ? r.municipio : [];
      for (const m of arr) {
        const t = String(m ?? '').trim();
        if (t) municipios.add(t);
      }
    }
    this.opcMunicipios = [...municipios].sort((a, b) => a.localeCompare(b));
  }

  private valoresUnicos(rows: any[], get: (r: any) => any): string[] {
    const set = new Set<string>();
    for (const r of rows) {
      const t = String(get(r) ?? '').trim();
      if (t) set.add(t);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  /** Cualquier cambio en la cabecera repinta tabla + indicadores. */
  onFiltroChange(): void {
    this.applyViewMode();
  }

  onOficinaChange(): void {
    // Al cambiar de oficina los desplegables cambian de universo: lo que ya no
    // exista se queda "colgado" filtrando de más, así que se limpian.
    this.filtros.finca = '';
    this.filtros.empresa = '';
    this.filtros.cargo = '';
    this.filtros.municipio = '';
    this.filtros.tipo = '';
    try { setLocalStorageItem('vacantes:oficina', this.filtros.oficina); } catch { }
    this.applyViewMode();
  }

  limpiarFiltros(): void {
    this.filtros = {
      oficina: this.puedeElegirOficina ? '' : this.sede,
      finca: '',
      empresa: '',
      cargo: '',
      municipio: '',
      tipo: '',
      antiguedad: 0,
      desde: null,
      hasta: null,
    };
    if (this.puedeElegirOficina) {
      try { setLocalStorageItem('vacantes:oficina', ''); } catch { }
    }
    this.applyViewMode();
  }

  get filtrosActivos(): number {
    const f = this.filtros;
    let n = 0;
    if (this.puedeElegirOficina && f.oficina) n++;
    if (f.finca) n++;
    if (f.empresa) n++;
    if (f.cargo) n++;
    if (f.municipio) n++;
    if (f.tipo) n++;
    if (f.antiguedad > 0) n++;
    if (f.desde) n++;
    if (f.hasta) n++;
    return n;
  }

  toggleFiltros(): void {
    this.filtrosAbiertos = !this.filtrosAbiertos;
  }

  /** Días desde que se publicó (pidió) la vacante. */
  private diasPublicada(row: any): number | null {
    const f = this.aFecha(row?.fecha_publicado);
    if (!f) return null;
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((hoy.getTime() - f.getTime()) / 86_400_000));
  }

  /** 'YYYY-MM-DD' se arma en local para que no se corra un día por UTC. */
  private aFecha(v: any): Date | null {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : this.soloFecha(v);
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    const d = new Date(String(v));
    return isNaN(d.getTime()) ? null : this.soloFecha(d);
  }

  private soloFecha(d: Date | null): Date | null {
    if (!d) return null;
    const x = new Date(d.getTime());
    x.setHours(0, 0, 0, 0);
    return x;
  }

  loadData(): void {
    this.loading = true;

    // En la pestaña "Inactivas" pedimos sólo inactivas; en el resto, activas.
    const soloInactivas = this.viewMode === 'inactivas';
    this.cargadoComo = soloInactivas ? 'inactivas' : 'activas';

    this.vacantesService.listarVacantes(soloInactivas ? false : true).subscribe({
      next: (response: any[]) => {
        // Ya NO se recorta aquí por sede: el recorte lo hace `aplicarFiltros`
        // con `filtros.oficina`, que para gerencia puede ser "todas".
        this.allRows = (response ?? []).map(r => this.enrichComputed(this.mapRow(r)));
        this.applyViewMode();
      },
      error: () => { },
      complete: () => { this.loading = false; this.cdr.markForCheck(); },
    });
  }

  // ================== Selección masiva ==================
  ngAfterViewInit(): void {
    // La selección vive en la tabla compartida; nos suscribimos a sus cambios
    // para reflejar el contador y mostrar/ocultar la barra de acciones masivas.
    const sel = this.tabla?.selection;
    if (sel) {
      this.selSub = sel.changed.subscribe(() => {
        this.seleccionCount = sel.selected.length;
        this.cdr.markForCheck();
      });
    }
  }

  ngOnDestroy(): void {
    this.selSub?.unsubscribe();
  }

  private seleccionadas(): any[] {
    return this.tabla?.selection?.selected ?? [];
  }

  private limpiarSeleccion(): void {
    this.tabla?.selection?.clear();
    this.seleccionCount = 0;
  }

  /** Eliminar en bloque las vacantes seleccionadas. */
  eliminarSeleccionadas(): void {
    const sel = this.seleccionadas().filter(v => v?.id != null);
    if (!sel.length) {
      Swal.fire('Sin selección', 'Selecciona al menos una vacante.', 'info');
      return;
    }
    Swal.fire({
      title: `¿Eliminar ${sel.length} vacante(s)?`,
      text: 'No podrás revertir esto.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6',
      confirmButtonText: 'Sí, eliminar',
    }).then(res => {
      if (!res.isConfirmed) return;
      Swal.fire({ title: 'Eliminando…', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

      forkJoin(
        sel.map(v =>
          this.vacantesService.eliminarVacante(v.id).pipe(
            map(() => true),
            catchError(() => of(false)),
          )
        )
      ).subscribe(results => {
        const fallidas = results.filter(ok => !ok).length;
        this.limpiarSeleccion();
        this.loadData();
        if (fallidas) {
          Swal.fire('Resultado parcial', `${results.length - fallidas} eliminada(s), ${fallidas} con error.`, 'warning');
        } else {
          Swal.fire('Eliminadas', `${results.length} vacante(s) eliminada(s).`, 'success');
        }
      });
    });
  }

  /** Inactivar en bloque las vacantes seleccionadas (con un único motivo). */
  inactivarSeleccionadas(): void {
    const sel = this.seleccionadas().filter(v => v?.id != null && v.activo !== false);
    if (!sel.length) {
      Swal.fire('Sin selección', 'Selecciona al menos una vacante activa.', 'info');
      return;
    }
    Swal.fire({
      title: `Inactivar ${sel.length} vacante(s)`,
      input: 'textarea',
      inputLabel: 'Motivo de inactivación (se aplicará a todas)',
      inputPlaceholder: 'Escribe aquí el motivo…',
      inputAttributes: { maxlength: '500' },
      inputValidator: (val: any) => {
        const t = String(val ?? '').trim();
        if (!t) return 'El motivo es obligatorio.';
        if (t.length < 10) return 'Amplía un poco más el motivo (mínimo 10 caracteres).';
        return null;
      },
      showCancelButton: true,
      confirmButtonText: 'Inactivar',
      cancelButtonText: 'Cancelar',
      allowOutsideClick: () => !Swal.isLoading(),
    }).then(res => {
      if (!res.isConfirmed) return;
      const motivo = String(res.value ?? '').trim();
      Swal.fire({ title: 'Inactivando…', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

      forkJoin(
        sel.map(v =>
          this.vacantesService.cambiarEstadoActivo(v.id, false, motivo).pipe(
            map(() => true),
            catchError(() => of(false)),
          )
        )
      ).subscribe(results => {
        const fallidas = results.filter(ok => !ok).length;
        this.limpiarSeleccion();
        this.loadData();
        if (fallidas) {
          Swal.fire('Resultado parcial', `${results.length - fallidas} inactivada(s), ${fallidas} con error.`, 'warning');
        } else {
          Swal.fire('Inactivadas', `${results.length} vacante(s) inactivada(s).`, 'success');
        }
      });
    });
  }

  private enrichComputed(row: any): any {
    const req = Number(row?.personas_solicitadas) || 0;

    const entrev = this.entrev(row);
    const prueba = this.prue(row);
    const auto = this.auto(row);
    const exm = this.exm(row);
    const firm = this.firm(row);
    const ing = this.ing(row);

    const falt = Math.max(0, req - firm);
    const cumpl = req ? Math.max(0, Math.min(100, Math.round((firm / req) * 100))) : 0;

    return {
      ...row,
      req,
      falt,
      entrev,
      prueba,
      auto,
      exm,
      firm,
      ing,
      cumpl,
      municipioLabel: Array.isArray(row?.municipio) ? row.municipio.join(', ') : '',
    };
  }

  /**
   * true si la vacante toca alguna de las oficinas del usuario. Quien no se recorta
   * por sede pasa siempre; una vacante sin oficina declarada tampoco se esconde,
   * porque no hay dato por el que excluirla.
   */
  private dentroDelAlcance(vac: any): boolean {
    if (this.sinLimiteSede) return true;
    const arr = Array.isArray(vac?.oficinas_que_contratan) ? vac.oficinas_que_contratan : [];
    if (!arr.length) return true;
    return arr.some((o: any) => this.sedeScope.alcanza(typeof o === 'string' ? o : o?.nombre));
  }

  private matchesSede(vac: any, sede: string): boolean {
    const wanted = this.norm(sede);
    if (!wanted) return true;

    const arr = Array.isArray(vac?.oficinas_que_contratan) ? vac.oficinas_que_contratan : [];
    return arr.some((o: any) => {
      const name = typeof o === 'string' ? o : o?.nombre;
      return this.norm(name) === wanted;
    });
  }

  private mapRow(r: any) {
    const defaultConteo: ConteoEstados = {
      pre_registro: 0,
      entrevistado: 0,
      prueba_tecnica: 0,
      autorizado: 0,
      examenes_medicos: 0,
      contratado: 0,
      ingreso: 0,
      total_con_su_ultimo_registro: 0,
    };

    const municipioArr = Array.isArray(r?.municipio)
      ? r.municipio
      : (Array.isArray(r?.municipios) ? r.municipios : []);

    return {
      ...r,
      activo: typeof r?.activo === 'boolean' ? r.activo : true,
      motivo_inactivacion: r?.motivo_inactivacion ?? '',

      salario: this.parseCurrency(r?.salario),
      municipio: municipioArr,
      observacionVacante: r?.observacion ?? '',
      preseleccionados: Array.isArray(r?.preseleccionados) ? r.preseleccionados : [],
      contratados: Array.isArray(r?.contratados) ? r.contratados : [],
      personas_solicitadas: Number(r?.personas_solicitadas) || 0,
      municipiosDistribucion: Array.isArray(r?.municipiosDistribucion) ? r.municipiosDistribucion : [],
      fecha_publicado: r?.fecha_publicado ?? null,
      fechadeIngreso: r?.fechadeIngreso ?? null,
      cargo: r?.cargo ?? null,
      finca: r?.finca ?? '',
      experiencia: r?.experiencia ?? '',
      auxilio_transporte: r?.auxilio_transporte ?? 'No',
      tipo_contratacion: r?.tipo_contratacion ?? '',
      conteo_estados: (r?.conteo_estados as ConteoEstados) || defaultConteo,
    };
  }

  // ================== Acciones ==================
  openModalEdit(vacante?: any): void {
    const dialogRef = this.dialog.open(CrearEditarVacanteComponent, {
      width: '95vw',
      maxWidth: '95vw',
      data: vacante ?? null,
    });

    dialogRef.afterClosed().subscribe((result: any) => {
      if (!result) return;

      const t = (v: unknown): string => (v ?? '').toString().trim();
      const n = (v: unknown): number => Number(v);

      const id: number | string | null = vacante?.id ?? null;
      if (!id) {
        Swal.fire('Error', 'No se encontró el ID de la vacante para actualizar.', 'error');
        return;
      }

      const missing: string[] = [];

      // Requeridos
      if (!t(result.cargo)) missing.push('Cargo');
      if (!t(result.finca)) missing.push('Centro de costo');
      if (!t(result.direccion)) missing.push('Dirección');
      if (!t(result.empresa_usuaria_solicita)) missing.push('Empresa usuaria');
      if (!t(result.temporal)) missing.push('Temporal');
      if (!t(result.area)) missing.push('Área');
      if (!t(result.experiencia)) missing.push('Experiencia');
      if (!t(result.descripcion)) missing.push('Descripción');
      if (!t(result.tipo_contratacion)) missing.push('Tipo de contratación');
      if (!t(result.prueba_ocontratacion)) missing.push('Prueba o Contratación');

      const total: number = Math.trunc(n(result.personas_solicitadas));
      if (!(total >= 1)) missing.push('Personas solicitadas (mínimo 1)');

      const aux: AuxilioTransporte | '' = (t(result.auxilio_transporte) as AuxilioTransporte | '');
      if (!(aux === 'Si' || aux === 'No')) missing.push('Auxilio Transporte (Si/No)');

      const municipios: string[] = Array.isArray(result.municipio)
        ? (result.municipio as unknown[]).map((m: unknown) => t(m)).filter((s: string) => !!s)
        : [];
      if (!municipios.length) missing.push('Municipio(s)');

      // Condicionales
      const isPrueba: boolean = t(result.prueba_ocontratacion) === 'Prueba';
      if (isPrueba) {
        if (!result.fechadePruebatecnica) missing.push('Fecha de Prueba Técnica');
        if (!t(result.horade_pruebatecnica)) missing.push('Hora de Prueba Técnica');
      }

      const tieneIngreso: string = t(result.tieneFechaIngreso);
      if (tieneIngreso === 'Si') {
        if (!result.fechadeIngreso) missing.push('Fecha de Ingreso');
      }

      // Oficinas
      const oficinasRaw: unknown[] = Array.isArray(result.oficinas_que_contratan) ? (result.oficinas_que_contratan as unknown[]) : [];
      if (!oficinasRaw.length) missing.push('Oficinas que contratan');

      const oficinasLimpias: OficinaPayload[] = oficinasRaw
        .map((o: any): OficinaPayload => ({ nombre: t(o?.nombre), ruta: !!o?.ruta }))
        .filter((o: OficinaPayload) => !!o.nombre);

      if (!oficinasLimpias.length) missing.push('Nombre de oficina (vacío)');

      // Distribución
      const distRaw: unknown[] = Array.isArray(result.municipiosDistribucion) ? (result.municipiosDistribucion as unknown[]) : [];

      const distClean: DistPayload[] = distRaw
        .map((d: any): DistPayload => ({
          municipio: t(d?.municipio),
          cantidad: Math.trunc(n(d?.cantidad)),
        }))
        .filter((d: DistPayload) => !!d.municipio && Number.isFinite(d.cantidad) && d.cantidad >= 0);

      const sumaDist: number = distClean.reduce((acc: number, d: DistPayload) => acc + (d.cantidad || 0), 0);
      if (sumaDist > total) missing.push(`Distribución: suma ${sumaDist} supera total ${total}`);

      const distSet = new Set(distClean.map((d: DistPayload) => d.municipio));
      const faltanFilas: string[] = municipios.filter((m: string) => !distSet.has(m));
      if (faltanFilas.length) {
        missing.push(
          `Distribución: faltan municipios (${faltanFilas.slice(0, 6).join(', ')}${faltanFilas.length > 6 ? '...' : ''})`
        );
      }

      if (missing.length) {
        Swal.fire({
          icon: 'warning',
          title: 'Faltan campos / hay inconsistencias',
          html: `<ul style="text-align:left; margin:0; padding-left:18px;">
                ${Array.from(new Set(missing)).map((m: string) => `<li>${m}</li>`).join('')}
              </ul>`,
        });
        return;
      }

      const payload = {
        cargo: t(result.cargo) || null,
        temporal: t(result.temporal) || null,
        area: t(result.area) || null,
        empresa_usuaria_solicita: t(result.empresa_usuaria_solicita) || null,
        finca: t(result.finca) || null,
        direccion: t(result.direccion) || null,

        experiencia: t(result.experiencia) || null,
        descripcion: t(result.descripcion) || null,
        salario: this.parseCurrency(result.salario),
        codigo_elite: t(result.codigo_elite) || null,
        observacion: t(result.observacionVacante) || null,

        prueba_ocontratacion: isPrueba ? 'Prueba' : 'Contratación',
        fechadePruebatecnica: isPrueba ? this.formatDate(result.fechadePruebatecnica) : null,
        horade_pruebatecnica: isPrueba ? (t(result.horade_pruebatecnica) || null) : null,
        fechadeIngreso: tieneIngreso === 'Si' ? (this.formatDate(result.fechadeIngreso) || null) : null,

        fecha_publicado: result.fecha_publicado || new Date().toISOString(),
        quienpublicolavacante: t(result.quienpublicolavacante) || 'Sistema',
        estadovacante: t(result.estadovacante) || 'Activa',

        personas_solicitadas: total,
        municipiosDistribucion: distClean,

        oficinas_que_contratan: oficinasLimpias,

        tipo_contratacion: t(result.tipo_contratacion) || null,
        municipio: municipios,
        auxilio_transporte: aux,
      };

      this.vacantesService.actualizarVacante(id, payload).subscribe({
        next: () => {
          this.loadData();
          Swal.fire('¡Vacante actualizada!', 'Los datos se guardaron correctamente', 'success');
        },
        error: (error: any) => {
          const msg = this.getErrorMessage(error);
          Swal.fire('Error al guardar', msg, 'error');
        },
      });
    });
  }



  eliminarVacante(vacante: any): void {
    Swal.fire({
      title: '¿Estás seguro?',
      text: 'No podrás revertir esto',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#3085d6',
      cancelButtonColor: '#d33',
      confirmButtonText: 'Sí, eliminar',
    }).then(result => {
      if (!result.isConfirmed) return;

      this.vacantesService.eliminarVacante(vacante.id).subscribe({
        next: () => {
          Swal.fire('Eliminado', 'La vacante ha sido eliminada.', 'success');
          this.loadData();
        },
        error: (err: any) => {
          const msg = this.getErrorMessage(err);
          Swal.fire('Error', msg, 'error');
        },
      });
    });
  }

  openModal(vacante?: any): void {
    const dialogRef = this.dialog.open(CrearEditarVacanteComponent, {
      width: '95vw',
      maxWidth: '95vw',
      data: vacante ?? null,
    });

    dialogRef.afterClosed().subscribe((result: any) => {
      if (!result) return;

      const t = (v: unknown): string => (v ?? '').toString().trim();
      const n = (v: unknown): number => Number(v);

      const missing: string[] = [];

      // Requeridos
      if (!t(result.cargo)) missing.push('Cargo');
      if (!t(result.finca)) missing.push('Centro de costo');
      if (!t(result.direccion)) missing.push('Dirección');
      if (!t(result.empresa_usuaria_solicita)) missing.push('Empresa usuaria');
      if (!t(result.temporal)) missing.push('Temporal');
      if (!t(result.area)) missing.push('Área');
      if (!t(result.experiencia)) missing.push('Experiencia');
      if (!t(result.descripcion)) missing.push('Descripción');
      if (!t(result.tipo_contratacion)) missing.push('Tipo de contratación');
      if (!t(result.prueba_ocontratacion)) missing.push('Prueba o Contratación');

      const total: number = Math.trunc(n(result.personas_solicitadas));
      if (!(total >= 1)) missing.push('Personas solicitadas (mínimo 1)');

      const aux: AuxilioTransporte | '' = (t(result.auxilio_transporte) as AuxilioTransporte | '');
      if (!(aux === 'Si' || aux === 'No')) missing.push('Auxilio Transporte (Si/No)');

      const municipios: string[] = Array.isArray(result.municipio)
        ? (result.municipio as unknown[]).map((m: unknown) => t(m)).filter((s: string) => !!s)
        : [];
      if (!municipios.length) missing.push('Municipio(s)');

      // Condicionales
      const isPrueba: boolean = t(result.prueba_ocontratacion) === 'Prueba';
      if (isPrueba) {
        if (!result.fechadePruebatecnica) missing.push('Fecha de Prueba Técnica');
        if (!t(result.horade_pruebatecnica)) missing.push('Hora de Prueba Técnica');
      }

      const tieneIngreso: string = t(result.tieneFechaIngreso);
      if (tieneIngreso === 'Si') {
        if (!result.fechadeIngreso) missing.push('Fecha de Ingreso');
      }

      // Oficinas
      const oficinasRaw: unknown[] = Array.isArray(result.oficinas_que_contratan) ? (result.oficinas_que_contratan as unknown[]) : [];
      if (!oficinasRaw.length) missing.push('Oficinas que contratan');

      const oficinasLimpias: OficinaPayload[] = oficinasRaw
        .map((o: any): OficinaPayload => ({ nombre: t(o?.nombre), ruta: !!o?.ruta }))
        .filter((o: OficinaPayload) => !!o.nombre);

      if (!oficinasLimpias.length) missing.push('Nombre de oficina (vacío)');

      // Distribución
      const distRaw: unknown[] = Array.isArray(result.municipiosDistribucion) ? (result.municipiosDistribucion as unknown[]) : [];

      const distClean: DistPayload[] = distRaw
        .map((d: any): DistPayload => ({
          municipio: t(d?.municipio),
          cantidad: Math.trunc(n(d?.cantidad)),
        }))
        .filter((d: DistPayload) => !!d.municipio && Number.isFinite(d.cantidad) && d.cantidad >= 0);

      const sumaDist: number = distClean.reduce((acc: number, d: DistPayload) => acc + (d.cantidad || 0), 0);
      if (sumaDist > total) missing.push(`Distribución: suma ${sumaDist} supera total ${total}`);

      const distSet = new Set(distClean.map((d: DistPayload) => d.municipio));
      const faltanFilas: string[] = municipios.filter((m: string) => !distSet.has(m));
      if (faltanFilas.length) {
        missing.push(
          `Distribución: faltan municipios (${faltanFilas.slice(0, 6).join(', ')}${faltanFilas.length > 6 ? '...' : ''})`
        );
      }

      if (missing.length) {
        Swal.fire({
          icon: 'warning',
          title: 'Faltan campos / hay inconsistencias',
          html: `<ul style="text-align:left; margin:0; padding-left:18px;">
                ${Array.from(new Set(missing)).map((m: string) => `<li>${m}</li>`).join('')}
              </ul>`,
        });
        return;
      }

      const payload = {
        cargo: t(result.cargo) || null,
        area: t(result.area) || null,
        empresa_usuaria_solicita: t(result.empresa_usuaria_solicita) || null,
        finca: t(result.finca) || null,
        ubicacionPruebaTecnica: isPrueba ? (t(result.ubicacionPruebaTecnica) || null) : null,
        experiencia: t(result.experiencia) || null,
        direccion: t(result.direccion) || null,

        fechadePruebatecnica: isPrueba ? this.formatDate(result.fechadePruebatecnica) : null,
        horade_pruebatecnica: isPrueba ? (t(result.horade_pruebatecnica) || null) : null,
        fechadeIngreso: tieneIngreso === 'Si' ? (this.formatDate(result.fechadeIngreso) || null) : null,
        prueba_ocontratacion: isPrueba ? 'Prueba' : 'Contratación',

        observacion: t(result.observacionVacante) || null,
        temporal: t(result.temporal) || null,
        descripcion: t(result.descripcion) || null,
        fecha_publicado: this.formatDate(new Date()),
        quienpublicolavacante: t(result.quienpublicolavacante) || 'Usuario Logueado',
        estadovacante: t(result.estadovacante) || 'Activa',
        salario: this.parseCurrency(result.salario),
        codigo_elite: t(result.codigo_elite) || null,

        personas_solicitadas: total,
        municipiosDistribucion: distClean,

        oficinas_que_contratan: oficinasLimpias,

        tipo_contratacion: t(result.tipo_contratacion) || null,
        municipio: municipios,
        auxilio_transporte: aux,
      };

      this.vacantesService.enviarVacante(payload).subscribe({
        next: () => {
          this.loadData();
          Swal.fire('¡Éxito!', 'La vacante ha sido enviada correctamente', 'success');
        },
        error: (error: any) => {
          const msg = this.getErrorMessage(error);
          Swal.fire('Error al crear', msg, 'error');
        },
      });
    });
  }



  formatDate(date: Date | string | null): string | null {
    if (!date) return null;
    const d = new Date(date);
    const day = d.getDate().toString().padStart(2, '0');
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const year = d.getFullYear();
    return `${year}-${month}-${day}`;
  }

  private mapMunicipiosDistribucion(arr: any[]): Array<{ municipio: string; cantidad: number }> {
    const src = Array.isArray(arr) ? arr : [];
    return src
      .map(d => ({
        municipio: String(d?.municipio ?? '').trim(),
        cantidad: Number(d?.cantidad) || 0,
      }))
      .filter(d => !!d.municipio);
  }

  // ================== Activo ==================
  async setActivo(row: any, nuevoActivo: boolean): Promise<void> {
    if (!row?.id || this.busyActivoIds.has(row.id)) return;

    const anterior = !!row.activo;

    let motivo: string | null = null;
    if (nuevoActivo === false && this.cumplimientoPct(row) < 100) {
      const res = await Swal.fire({
        title: 'Motivo de inactivación',
        input: 'textarea',
        inputLabel: 'Describe por qué se inactiva la vacante (obligatorio si no hay 100% de cumplimiento).',
        inputPlaceholder: 'Escribe aquí el motivo…',
        inputAttributes: { maxlength: '500', 'aria-label': 'Motivo de inactivación' },
        inputValidator: (val: any) => {
          const t = String(val ?? '').trim();
          if (!t) return 'El motivo es obligatorio.';
          if (t.length < 10) return 'Amplía un poco más el motivo (mínimo 10 caracteres).';
          return null;
        },
        showCancelButton: true,
        confirmButtonText: 'Guardar',
        cancelButtonText: 'Cancelar',
        allowOutsideClick: () => !Swal.isLoading(),
      });

      if (!res.isConfirmed) {
        row.activo = anterior;
        return;
      }
      motivo = String(res.value ?? '').trim();
    }

    this.busyActivoIds.add(row.id);
    row.activo = nuevoActivo;

    this.vacantesService.cambiarEstadoActivo(row.id, nuevoActivo, motivo ?? undefined).subscribe({
      next: () => {
        if (nuevoActivo === false) {
          // Ya no quitamos de allRows; solo reaplicamos la vista
          this.applyViewMode();
          Swal.fire('Desactivada', 'La publicación fue desactivada.', 'success');
        } else {
          // Reaplicamos vista (por si estábamos en Inactivas y la activamos, debería salir de la vista actual)
          this.applyViewMode();
          Swal.fire('Activada', 'La publicación fue activada.', 'success');
        }
      },
      error: (err: any) => {
        row.activo = anterior;
        const msg = this.getErrorMessage(err);
        Swal.fire('Error', msg, 'error');
      },
      complete: () => this.busyActivoIds.delete(row.id),
    });
  }

  /**
   * Parsea errores del backend (DRF) para mostrar mensajes amigables.
   * - 400: Puede ser {"field": ["msg"]} o {"field": "msg"}.
   * - 500: {"detail": "..."}
   * - String directo o message.
   */
  private getErrorMessage(error: any): string {
    const defaultMsg = 'Ocurrió un error inesperado.';

    if (!error) return defaultMsg;

    // Si viene dentro de 'error' (estructura común de HttpClient)
    const e = error.error ?? error;

    // Caso 1: Array de mensajes (poco común root, pero posible)
    if (Array.isArray(e)) {
      return e.map((m: any) => String(m)).join(' | ');
    }

    // Caso 2: Objeto con claves (ValidationErrors de DRF)
    if (typeof e === 'object') {
      // Si tiene 'detail' (nuestro custom 500 o genérico DRF)
      if (e.detail) {
        return String(e.detail);
      }

      // Recorrer las claves y concatenar
      const msgs: string[] = [];
      for (const key of Object.keys(e)) {
        const val = e[key];
        const valStr = Array.isArray(val) ? val.join(' ') : String(val);
        // Si el key es 'non_field_errors', no mostramos la clave
        if (key === 'non_field_errors') {
          msgs.push(valStr);
        } else {
          // "Campo: mensaje"
          msgs.push(`${key}: ${valStr}`);
        }
      }
      if (msgs.length > 0) return msgs.join('<br>');
    }

    // Caso 3: String directo o message
    if (typeof e === 'string') return e;
    if (error.message) return error.message;

    return defaultMsg;
  }

  // ================== Utilidades ==================
  private parseCurrency(val: any): number {
    return Number(String(val ?? '').replace(/[^\d.-]/g, '')) || 0;
  }

  private ce(v: any): ConteoEstados {
    const z: ConteoEstados = {
      pre_registro: 0,
      entrevistado: 0,
      prueba_tecnica: 0,
      autorizado: 0,
      examenes_medicos: 0,
      contratado: 0,
      ingreso: 0,
      total_con_su_ultimo_registro: 0,
    };
    return (v?.conteo_estados as ConteoEstados) || z;
  }

  prue(v: any): number { return this.ce(v).prueba_tecnica; }
  auto(v: any): number { return this.ce(v).autorizado; }
  exm(v: any): number { return this.ce(v).examenes_medicos; }
  firm(v: any): number { return this.ce(v).contratado; }
  ing(v: any): number { return this.ce(v).ingreso; }
  entrev(v: any): number { return this.ce(v).entrevistado; }

  cumplimientoPct(v: any): number {
    const req = Number(v?.req ?? v?.personas_solicitadas) || 0;
    if (!req) return 0;
    const firmados = Number(v?.firm ?? this.firm(v)) || 0;
    return Math.max(0, Math.min(100, Math.round((firmados / req) * 100)));
  }

  cumplClass(v: any): string {
    const pct = this.cumplimientoPct(v);
    if (pct >= 100) return 'semaforo-pill semaforo-ok';
    if (pct >= 70) return 'semaforo-pill semaforo-warn';
    return 'semaforo-pill semaforo-error';
  }

  /**
   * Abre el detalle de cumplimiento de la vacante: candidatos asignados, con
   * opción de quitarles la vacante y de descargar la base / formato BMC.
   */
  abrirCumplimiento(row: any, ev?: Event): void {
    ev?.stopPropagation();
    if (!row?.id) return;
    const ref = this.dialog.open(CumplimientoDialogComponent, {
      width: '760px',
      maxWidth: '94vw',
      autoFocus: false,
      panelClass: 'cumpl-dialog-panel',
      data: {
        publicacionId: row.id,
        cargo: row?.cargo,
        finca: row?.finca,
        empresa: row?.empresa_usuaria_solicita,
        area: row?.area,
        auxilio_transporte: row?.auxilio_transporte,
        // La ruta es un booleano por oficina; se resume a Si/No para el formato.
        ruta: (Array.isArray(row?.oficinas_que_contratan) && row.oficinas_que_contratan.some((o: any) => o?.ruta)) ? 'Si' : 'No',
        req: row?.req,
        firm: row?.firm,
        cumpl: this.cumplimientoPct(row),
      },
    });
    ref.afterClosed().pipe(take(1)).subscribe((cambios) => {
      // Si se quitó alguna vacante, los conteos cambian: refrescamos.
      if (cambios) this.loadData();
    });
  }

  /** ¿la fila tiene observación o descripción para mostrar el chip? */
  tienePerfil(row: any): boolean {
    return !!(String(row?.observacionVacante ?? '').trim() || String(row?.descripcion ?? '').trim());
  }

  /** Tooltip combinado (Observación del perfil + Descripción) del chip único. */
  perfilTooltip(row: any): string {
    const obs = String(row?.observacionVacante ?? '').trim();
    const desc = String(row?.descripcion ?? '').trim();
    const parts: string[] = [];
    if (obs) parts.push(`Observación del perfil:\n${obs}`);
    if (desc) parts.push(`Descripción:\n${desc}`);
    return parts.join('\n\n') || 'Sin observación ni descripción';
  }

  // ---- Municipio (chip cuando son más de 2) ----
  private municipiosArr(row: any): string[] {
    const arr = Array.isArray(row?.municipio) ? row.municipio : [];
    return arr.map((m: any) => String(m ?? '').trim()).filter((s: string) => !!s);
  }

  municipiosCount(row: any): number {
    return this.municipiosArr(row).length;
  }

  /** Texto inline cuando hay 2 o menos municipios. */
  municipiosTexto(row: any): string {
    return this.municipiosArr(row).join(', ');
  }

  /** Tooltip (uno por línea) cuando hay más de 2. */
  municipiosTooltip(row: any): string {
    return this.municipiosArr(row).join('\n');
  }

  private isManager(user: any): boolean {
    const raw = user?.rol ?? user?.roles ?? [];
    const roleNames: string[] = Array.isArray(raw)
      ? raw.map((r: any) => (typeof r === 'string' ? r : r?.nombre)).filter((v: any): v is string => !!v)
      : [typeof raw === 'string' ? raw : raw?.nombre].filter(Boolean) as string[];
    const upper = roleNames.map(r => r.toUpperCase());
    return upper.includes('GERENCIA') || upper.includes('ADMIN');
  }

  descargarExcelVacantes(_: Event): void {
    const ref = this.dialog.open(DateRangeDialogComponent, {
      width: '400px',
      data: { title: 'Seleccionar rango de fechas', startDate: null, endDate: null },
    });

    ref.afterClosed().subscribe(result => {
      if (!result) return;
      const { start, end } = result;

      this.vacantesService.getVacantesExcel(start, end, this.filtros.oficina || undefined).subscribe(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `vacantes_${start || 'inicio'}_${end || 'hoy'}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
      });
    });
  }

  // ✅ XLSX lazy-load: evita que “se congele” al entrar a la página
  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) { input.value = ''; return; }

    const XLSX = await import('xlsx');

    const reader = new FileReader();
    reader.onload = (e: any) => {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      Swal.fire('Aviso', 'Implementa el endpoint para subir Excel (crearDetalleLaboral).', 'info');
    };
    reader.readAsArrayBuffer(file);

    input.value = '';
  }

  abrirFormularioPreRegistroVacantes(): void {
    window.open('https://formulario.tsservicios.co/formulario/formulario-pre-registro-vacantes', '_blank');
  }

  private norm(s: any): string {
    return String(s ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }
}
