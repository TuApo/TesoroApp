import { ColumnDefinition } from '@/app/shared/models/advanced-table-interface';
import { Component, OnInit, AfterViewInit, OnDestroy, ChangeDetectionStrategy, ViewChild, computed, inject, signal } from '@angular/core';
import { forkJoin, of, Subscription } from 'rxjs';
import { map, catchError, take } from 'rxjs/operators';

import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';

import Swal from 'sweetalert2';

import { VacantesService } from '../../service/vacantes/vacantes.service';
import { VacancyDataService } from '../../service/vacancy-data/vacancy-data.service';
import { VacancyFiltersService } from '../../service/vacancy-filters/vacancy-filters.service';
import { SharedModule } from '@/app/shared/shared.module';
import { CrearEditarVacanteComponent } from '../../components/crear-editar-vacante/crear-editar-vacante.component';
import { CumplimientoDialogComponent } from '../../components/cumplimiento-dialog/cumplimiento-dialog.component';
import { VacancyFiltersPanelComponent } from '../../components/vacancy-filters-panel/vacancy-filters-panel.component';
import { DateRangeDialogComponent } from '@/app/shared/components/date-rang-dialog/date-rang-dialog.component';
import { StandardFilterTable } from '@/app/shared/components/standard-filter-table/standard-filter-table';
import { ColumnCellTemplateDirective } from '@/app/shared/directives/column-cell-template.directive';
import {
  AuxilioTransporte,
  ConteoEstados,
  DetalleCargoPayload,
  DistPayload,
  OficinaPayload,
  conteoVacio,
  salarioOMinimo,
} from '../../models/vacante.model';

/**
 * Listado de Vacantes — pantalla OPERATIVA del submódulo.
 *
 * Tabla, acciones (crear / editar / inactivar / eliminar, individuales y en
 * bloque), detalle de cumplimiento y exportaciones. Los indicadores viven en su
 * propia pantalla (`vacancy-indicators`); aquí no se pintan.
 *
 * Los datos y los filtros NO son suyos: los sirven `VacancyDataService` y
 * `VacancyFiltersService`, compartidos con la vista de indicadores para que las
 * dos miren exactamente el mismo universo.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-vacancy-list',
  standalone: true,
  imports: [
    SharedModule,
    StandardFilterTable,
    MatMenuModule,
    MatDialogModule,
    MatIconModule,
    MatSlideToggleModule,
    MatButtonModule,
    MatDividerModule,
    MatTooltipModule,
    ColumnCellTemplateDirective,
    VacancyFiltersPanelComponent,
  ],
  templateUrl: './vacancy-list.component.html',
  styleUrl: './vacancy-list.component.css',
})
export class VacancyListComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly dialog = inject(MatDialog);
  private readonly vacantesService = inject(VacantesService);
  readonly datos = inject(VacancyDataService);
  readonly f = inject(VacancyFiltersService);

  /** Filas que se pintan: conjunto cargado + pestaña + filtros de la cabecera. */
  readonly visibleRows = computed<any[]>(() => {
    this.f.cambios();
    return this.f.aplicar(this.datos.rows());
  });

  /** Opciones vivas de los desplegables, dentro de la oficina elegida. */
  readonly opcionesFiltro = computed(() => {
    this.f.cambios();
    return this.f.opciones(this.datos.rows());
  });

  readonly loading = this.datos.loading;

  // Selección masiva (checkbox de la tabla compartida)
  @ViewChild(StandardFilterTable) private tabla?: StandardFilterTable;
  /** Senal (no campo plano): la app es zoneless y la seleccion llega por un
   *  observable de la tabla, que por si solo no dispara deteccion de cambios. */
  readonly seleccionCount = signal(0);
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
    // Municipio: si son más de 2 se colapsa en un chip (el detalle sale en el
    // tooltip), igual que "Obs. / Descripción"; con 2 o menos se muestran los
    // nombres. La búsqueda global sigue funcionando por `municipioLabel`.
    { name: 'municipioLabel', header: 'Municipio', type: 'custom', filterable: false, sortable: false, width: '150px' },

    { name: 'experiencia', header: 'Expe', type: 'text', filterable: true, sortable: true, width: '90px' },
    // Observación del perfil + Descripción colapsadas en UN solo chip para
    // ahorrar espacio; el detalle completo de ambas sale en el tooltip.
    { name: 'perfil', header: 'Obs. / Descripción', type: 'custom', filterable: false, sortable: false, width: '110px' },

    // Las dos fechas que de verdad se consultan desde el listado. Sustituyen a
    // Salario, Auxilio, Tipo de Contrato y Empresa usuaria, que se miraban en el
    // detalle y aquí solo robaban ancho.
    //
    // `filterable: false` NO es descuido. El filtro de fechas de la tabla apunta por
    // defecto a "todas las fechas" y descarta la fila a la que le falte CUALQUIERA de
    // ellas. Como solo 19 de las vacantes tienen fecha de ingreso y 16 fecha de prueba,
    // dejarlas entrar ahí habría vaciado la tabla en cuanto alguien filtrara por fechas.
    // Siguen siendo ordenables y las alcanza la búsqueda global; el rango por fecha
    // sigue trabajando sobre "Publicado", como hasta ahora.
    { name: 'fechadeIngreso', header: 'Fecha ingreso', type: 'date', filterable: false, sortable: true, width: '130px' },
    { name: 'fechadePruebatecnica', header: 'Fecha prueba técnica', type: 'date', filterable: false, sortable: true, width: '150px' },
  ];

  displayedColumns: string[] = this.columnDefinitions.map(c => c.name);

  busyActivoIds = new Set<number | string>();

  /** ADMIN/GERENCIA: habilita eliminar (individual y en bloque). */
  get permitido(): boolean {
    return this.f.permitido;
  }

  ngOnInit(): void {
    this.f.init();
    this.datos.cargar(this.f.pideInactivas);
  }

  /** El panel de filtros pidió otro conjunto (activas ↔ inactivas). */
  onRecargarConjunto(): void {
    this.datos.cargar(this.f.pideInactivas);
  }

  // ================== Selección masiva ==================
  ngAfterViewInit(): void {
    // La selección vive en la tabla compartida; nos suscribimos a sus cambios
    // para reflejar el contador y mostrar/ocultar la barra de acciones masivas.
    const sel = this.tabla?.selection;
    if (sel) {
      this.selSub = sel.changed.subscribe(() => {
        this.seleccionCount.set(sel.selected.length);
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
    this.seleccionCount.set(0);
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
        this.datos.recargar();
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
        this.datos.recargar();
        if (fallidas) {
          Swal.fire('Resultado parcial', `${results.length - fallidas} inactivada(s), ${fallidas} con error.`, 'warning');
        } else {
          Swal.fire('Inactivadas', `${results.length} vacante(s) inactivada(s).`, 'success');
        }
      });
    });
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
      const perfiles: string[] = Array.isArray(result.area)
        ? (result.area as unknown[]).map((x) => t(x)).filter((x: string) => !!x)
        : [t(result.area)].filter((x: string) => !!x);
      if (!perfiles.length) missing.push('Perfil vacante');
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

      // La fecha de ingreso solo es OBLIGATORIA en contratación inmediata. En
      // prueba técnica es opcional: si se indica se guarda, y si no, no.
      // Se mira la opción directamente y no el campo oculto `tieneFechaIngreso`,
      // que era un intermediario de más entre la decisión y la comprobación.
      if (!isPrueba && !result.fechadeIngreso) missing.push('Fecha de Ingreso');

      // Oficinas
      const oficinasRaw: unknown[] = Array.isArray(result.oficinas_que_contratan) ? (result.oficinas_que_contratan as unknown[]) : [];
      if (!oficinasRaw.length) missing.push('Oficinas que contratan');

      const oficinasLimpias: OficinaPayload[] = oficinasRaw
        .map((o: any): OficinaPayload => ({ nombre: t(o?.nombre) }))
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

      // Detalle del cargo: el desglose del total. El diálogo ya no deja cerrarse si
      // no cuadra, pero se vuelve a comprobar aquí —igual que la distribución por
      // municipio— porque este es el único sitio por el que pasa el payload y el
      // backend rechaza el guardado con un 400 si la suma no da el total.
      const detRaw: unknown[] = Array.isArray(result.detallesCargo) ? (result.detallesCargo as unknown[]) : [];

      const detClean: DetalleCargoPayload[] = detRaw
        .map((d: any): DetalleCargoPayload => ({
          detalle: t(d?.detalle),
          cantidad: Math.trunc(n(d?.cantidad)),
        }))
        .filter((d: DetalleCargoPayload) => !!d.detalle && Number.isFinite(d.cantidad) && d.cantidad >= 1);

      if (detRaw.length !== detClean.length) missing.push('Detalle del cargo: hay líneas sin detalle o con cantidad menor que 1');

      const sumaDet: number = detClean.reduce((acc: number, d: DetalleCargoPayload) => acc + (d.cantidad || 0), 0);
      if (detClean.length && sumaDet !== total) {
        missing.push(`Detalle del cargo: la suma ${sumaDet} debe ser igual al total ${total}`);
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
        // "Perfil vacante" admite varios y se guardan aquí separados por coma: es
        // la forma que ya leen el cruce de ms-hr, los formatos Excel del detalle de
        // cumplimiento y el prellenado de la Remisión. La columna se amplió a 255
        // en la V14 de ms-automation porque con MySQL en modo estricto pasarse de
        // largo no trunca, falla.
        area: perfiles.join(', ') || null,
        empresa_usuaria_solicita: t(result.empresa_usuaria_solicita) || null,
        finca: t(result.finca) || null,
        direccion: t(result.direccion) || null,

        experiencia: t(result.experiencia) || null,
        descripcion: t(result.descripcion) || null,
        salario: salarioOMinimo(result.salario),
        codigo_elite: t(result.codigo_elite) || null,
        // `observacion` NO viaja: el formulario ya no tiene ese campo. Se OMITE en vez
        // de mandarla en null porque el backend hace merge parcial —solo toca las claves
        // presentes—, y así las 190 vacantes que ya tenían observación la conservan. En
        // null se habrían borrado en la primera edición.

        prueba_ocontratacion: isPrueba ? 'Prueba' : 'Contratación',
        fechadePruebatecnica: isPrueba ? this.formatDate(result.fechadePruebatecnica) : null,
        horade_pruebatecnica: isPrueba ? (t(result.horade_pruebatecnica) || null) : null,
        fechadeIngreso: this.formatDate(result.fechadeIngreso) || null,

        fecha_publicado: result.fecha_publicado || new Date().toISOString(),
        quienpublicolavacante: t(result.quienpublicolavacante) || 'Sistema',
        estadovacante: t(result.estadovacante) || 'Activa',

        personas_solicitadas: total,
        municipiosDistribucion: distClean,
        detallesCargo: detClean,

        oficinas_que_contratan: oficinasLimpias,

        tipo_contratacion: t(result.tipo_contratacion) || null,
        municipio: municipios,
        auxilio_transporte: aux,

        // Traza de la parametrizacion de labor (columnas V13 de db_automation).
        // Solo viaja lo que el diálogo haya resuelto: si la temporal no está
        // parametrizada llegan en null y el backend, que solo toca las claves
        // presentes, deja la traza anterior como estaba.
        ...trazaLabor(result),

        // Grupo de pago, fechas de pago y casino (columnas V18). Misma regla que
        // la labor: solo viaja lo resuelto, y sin resolver no se pisa nada.
        ...trazaPagoCasino(result),
      };

      this.vacantesService.actualizarVacante(id, payload).subscribe({
        next: () => {
          this.datos.recargar();
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
          this.datos.recargar();
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
      const perfiles: string[] = Array.isArray(result.area)
        ? (result.area as unknown[]).map((x) => t(x)).filter((x: string) => !!x)
        : [t(result.area)].filter((x: string) => !!x);
      if (!perfiles.length) missing.push('Perfil vacante');
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

      // La fecha de ingreso solo es OBLIGATORIA en contratación inmediata. En
      // prueba técnica es opcional: si se indica se guarda, y si no, no.
      // Se mira la opción directamente y no el campo oculto `tieneFechaIngreso`,
      // que era un intermediario de más entre la decisión y la comprobación.
      if (!isPrueba && !result.fechadeIngreso) missing.push('Fecha de Ingreso');

      // Oficinas
      const oficinasRaw: unknown[] = Array.isArray(result.oficinas_que_contratan) ? (result.oficinas_que_contratan as unknown[]) : [];
      if (!oficinasRaw.length) missing.push('Oficinas que contratan');

      const oficinasLimpias: OficinaPayload[] = oficinasRaw
        .map((o: any): OficinaPayload => ({ nombre: t(o?.nombre) }))
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

      // Detalle del cargo: el desglose del total. El diálogo ya no deja cerrarse si
      // no cuadra, pero se vuelve a comprobar aquí —igual que la distribución por
      // municipio— porque este es el único sitio por el que pasa el payload y el
      // backend rechaza el guardado con un 400 si la suma no da el total.
      const detRaw: unknown[] = Array.isArray(result.detallesCargo) ? (result.detallesCargo as unknown[]) : [];

      const detClean: DetalleCargoPayload[] = detRaw
        .map((d: any): DetalleCargoPayload => ({
          detalle: t(d?.detalle),
          cantidad: Math.trunc(n(d?.cantidad)),
        }))
        .filter((d: DetalleCargoPayload) => !!d.detalle && Number.isFinite(d.cantidad) && d.cantidad >= 1);

      if (detRaw.length !== detClean.length) missing.push('Detalle del cargo: hay líneas sin detalle o con cantidad menor que 1');

      const sumaDet: number = detClean.reduce((acc: number, d: DetalleCargoPayload) => acc + (d.cantidad || 0), 0);
      if (detClean.length && sumaDet !== total) {
        missing.push(`Detalle del cargo: la suma ${sumaDet} debe ser igual al total ${total}`);
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
        // "Perfil vacante" admite varios y se guardan aquí separados por coma: es
        // la forma que ya leen el cruce de ms-hr, los formatos Excel del detalle de
        // cumplimiento y el prellenado de la Remisión. La columna se amplió a 255
        // en la V14 de ms-automation porque con MySQL en modo estricto pasarse de
        // largo no trunca, falla.
        area: perfiles.join(', ') || null,
        empresa_usuaria_solicita: t(result.empresa_usuaria_solicita) || null,
        finca: t(result.finca) || null,
        ubicacionPruebaTecnica: isPrueba ? (t(result.ubicacionPruebaTecnica) || null) : null,
        experiencia: t(result.experiencia) || null,
        direccion: t(result.direccion) || null,

        fechadePruebatecnica: isPrueba ? this.formatDate(result.fechadePruebatecnica) : null,
        horade_pruebatecnica: isPrueba ? (t(result.horade_pruebatecnica) || null) : null,
        fechadeIngreso: this.formatDate(result.fechadeIngreso) || null,
        prueba_ocontratacion: isPrueba ? 'Prueba' : 'Contratación',

        temporal: t(result.temporal) || null,
        descripcion: t(result.descripcion) || null,
        fecha_publicado: this.formatDate(new Date()),
        quienpublicolavacante: t(result.quienpublicolavacante) || 'Usuario Logueado',
        estadovacante: t(result.estadovacante) || 'Activa',
        salario: salarioOMinimo(result.salario),
        codigo_elite: t(result.codigo_elite) || null,

        personas_solicitadas: total,
        municipiosDistribucion: distClean,
        detallesCargo: detClean,

        oficinas_que_contratan: oficinasLimpias,

        tipo_contratacion: t(result.tipo_contratacion) || null,
        municipio: municipios,
        auxilio_transporte: aux,

        // Traza de la parametrizacion de labor (columnas V13 de db_automation).
        // Solo viaja lo que el diálogo haya resuelto: si la temporal no está
        // parametrizada llegan en null y el backend, que solo toca las claves
        // presentes, deja la traza anterior como estaba.
        ...trazaLabor(result),

        // Grupo de pago, fechas de pago y casino (columnas V18). Misma regla que
        // la labor: solo viaja lo resuelto, y sin resolver no se pisa nada.
        ...trazaPagoCasino(result),
      };

      this.vacantesService.enviarVacante(payload).subscribe({
        next: () => {
          this.datos.recargar();
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
        // El toggle ya se pintó al otro lado: se devuelve a como estaba, tanto
        // en el objeto que el menú tiene en contexto como en el estado común.
        row.activo = anterior;
        this.datos.reemplazarFila(row.id, { activo: anterior });
        return;
      }
      motivo = String(res.value ?? '').trim();
    }

    this.busyActivoIds.add(row.id);
    // Optimista: la fila cambia ya, sin esperar al backend. Al ir por el
    // servicio de datos, la tabla y los indicadores se enteran a la vez.
    row.activo = nuevoActivo;
    this.datos.reemplazarFila(row.id, { activo: nuevoActivo });

    this.vacantesService.cambiarEstadoActivo(row.id, nuevoActivo, motivo ?? undefined).subscribe({
      next: () => {
        if (nuevoActivo === false) {
          Swal.fire('Desactivada', 'La publicación fue desactivada.', 'success');
        } else {
          Swal.fire('Activada', 'La publicación fue activada.', 'success');
        }
      },
      error: (err: any) => {
        row.activo = anterior;
        this.datos.reemplazarFila(row.id, { activo: anterior });
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

  // ================== Utilidades de plantilla ==================
  private ce(v: any): ConteoEstados {
    return (v?.conteo_estados as ConteoEstados) || conteoVacio();
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
      if (cambios) this.datos.recargar();
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

  // ================== Exportaciones / entradas externas ==================
  descargarExcelVacantes(_: Event): void {
    const ref = this.dialog.open(DateRangeDialogComponent, {
      width: '400px',
      data: { title: 'Seleccionar rango de fechas', startDate: null, endDate: null },
    });

    ref.afterClosed().subscribe(result => {
      if (!result) return;
      const { start, end } = result;

      this.vacantesService.getVacantesExcel(start, end, this.f.filtros.oficina || undefined).subscribe(blob => {
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
}

/**
 * Campos de trazabilidad de la labor que produce la cascada del diálogo.
 *
 * Se manda la clave solo cuando hay valor: `applyPayload` del backend hace merge
 * PARCIAL —toca únicamente las claves presentes— así que omitirlas conserva el
 * snapshot de una vacante que se edita sin volver a tocar el cargo. Mandarlas en
 * null lo habría borrado, y con él la explicación de de dónde salió el texto que
 * ya se imprimió en los documentos.
 */
function trazaLabor(result: any): Record<string, unknown> {
  const claves = [
    'configuracion_centro_cargo_id',
    'regla_labor_id',
    'labor_codigo_snapshot',
    'labor_descripcion_snapshot',
    'area_operativa_codigo',
    'esquema_labor_codigo',
    'labor_origen_resolucion',
  ] as const;

  const out: Record<string, unknown> = {};
  for (const k of claves) {
    const v = result?.[k];
    if (v !== null && v !== undefined && v !== '') out[k] = v;
  }
  return out;
}

/**
 * Grupo de pago, fechas de pago y casino que resolvió el diálogo (columnas V18).
 *
 * Es de donde sale el grupo que luego propone Contratación en "Pago y Transporte", y
 * los dos textos que imprime el contrato. Se manda con la MISMA regla que `trazaLabor`
 * —clave solo cuando hay valor— para que editar una vacante de una temporal sin esta
 * parametrización no borre lo que ya se publicó.
 */
function trazaPagoCasino(result: any): Record<string, unknown> {
  const claves = [
    'grupo_pago_ref',
    'grupo_pago_nombre_snapshot',
    'calendario_pago_ref',
    'fechas_pago_texto_snapshot',
    'politica_casino_ref',
    'casino_origen_resolucion',
    'casino_texto_snapshot',
  ] as const;

  const out: Record<string, unknown> = {};
  for (const k of claves) {
    const v = result?.[k];
    if (v !== null && v !== undefined && v !== '') out[k] = v;
  }
  return out;
}
