import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { CdkDropList, CdkDragDrop } from '@angular/cdk/drag-drop';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatTabsModule } from '@angular/material/tabs';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDialog } from '@angular/material/dialog';
import { MatSidenavModule } from '@angular/material/sidenav';
import Swal from 'sweetalert2';
import { ReportesApiService } from '../../services/reportes-api.service';
import { ConstructorStore, mensajeDeError } from '../../services/constructor.store';
import { descargar, nombreArchivo } from '../../services/descargas.util';
import { ExploradorDatosComponent } from '../../components/explorador-datos.component';
import { PanelColumnasComponent } from '../../components/panel-columnas.component';
import { ConstructorFiltrosComponent } from '../../components/constructor-filtros.component';
import { PanelVisualizacionComponent } from '../../components/panel-visualizacion.component';
import { TablaResultadosComponent } from '../../components/tabla-resultados.component';
import { GraficaReporteComponent } from '../../components/grafica-reporte.component';
import { KpiCardComponent } from '../../components/kpi-card.component';
import { DiagramaRelacionesComponent } from '../../components/diagrama-relaciones.component';
import { EditorCalculadoComponent } from '../../components/editor-calculado.component';
import { CompartirDialogComponent } from '../../components/compartir-dialog.component';
import { CampoCatalogo, DatasetCatalogo, SortSpec } from '../../models/reportes.models';

/**
 * Constructor visual de reportes (§4 y siguientes).
 *
 * Es UNA sola pantalla de trabajo, no un asistente por pasos: el brief lo pide
 * explícitamente (§27) y además es lo correcto — armar un reporte es iterar, y un
 * wizard obliga a ir y volver. Los "pasos" existen como guía visual en el
 * encabezado, marcando lo que ya está hecho.
 *
 * Tres zonas: explorador de datos a la izquierda, vista previa al centro y
 * configuración a la derecha. En móvil las laterales se vuelven paneles
 * deslizables para que el centro conserve el ancho.
 */
@Component({
  selector: 'app-constructor-reportes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ConstructorStore],
  imports: [CommonModule, FormsModule, CdkDropList, MatIconModule, MatButtonModule,
    MatMenuModule, MatTooltipModule, MatTabsModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatProgressBarModule, MatSidenavModule,
    ExploradorDatosComponent, PanelColumnasComponent, ConstructorFiltrosComponent,
    PanelVisualizacionComponent, TablaResultadosComponent, GraficaReporteComponent,
    KpiCardComponent, DiagramaRelacionesComponent],
  templateUrl: './constructor.component.html',
  styleUrls: ['./constructor.component.css'],
})
export class ConstructorComponent implements OnInit {

  readonly store = inject(ConstructorStore);
  readonly api = inject(ReportesApiService);
  private ruta = inject(ActivatedRoute);
  private router = inject(Router);
  private dialog = inject(MatDialog);

  readonly cargandoCatalogo = signal(true);
  readonly guardando = signal(false);
  readonly vistaDiagrama = signal(false);
  readonly panelIzqAbierto = signal(true);
  readonly panelDerAbierto = signal(true);
  readonly asistenteDisponible = signal(false);

  /** Pasos del flujo (§27): guía visual, no un asistente que bloquee. */
  readonly pasos = computed(() => [
    { n: 1, t: 'Fuente de datos', ok: !!this.store.root() },
    { n: 2, t: 'Columnas', ok: this.store.fields().length > 0 },
    { n: 3, t: 'Filtros', ok: !!this.store.filtros() },
    { n: 4, t: 'Visualización', ok: this.store.visualizacion().tipo !== 'TABLA' },
    { n: 5, t: 'Guardar', ok: !!this.store.reporteId() && !this.store.sucio() },
  ]);

  readonly esGrafica = computed(() => {
    const t = this.store.visualizacion().tipo;
    return t !== 'TABLA' && t !== 'KPI';
  });

  readonly esKpi = computed(() => this.store.visualizacion().tipo === 'KPI');

  ngOnInit(): void {
    this.api.cargarMetadatos().subscribe();
    this.api.cargarCatalogo().subscribe({
      next: cat => {
        this.cargandoCatalogo.set(false);
        if (!cat.puede_construir) {
          Swal.fire({
            icon: 'info',
            title: 'Solo lectura',
            text: 'Tu rol puede abrir reportes, pero no crearlos ni modificarlos.',
          });
        }
      },
      error: e => {
        this.cargandoCatalogo.set(false);
        Swal.fire({ icon: 'error', title: 'No se pudo cargar el catálogo', text: mensajeDeError(e) });
      },
    });
    this.api.estadoAsistente().subscribe({
      next: e => this.asistenteDisponible.set(e.disponible),
      error: () => this.asistenteDisponible.set(false),
    });

    const id = this.ruta.snapshot.paramMap.get('id');
    if (id) {
      this.api.abrirReporte(id).subscribe({
        next: d => this.store.cargarDesde(d),
        error: e => {
          Swal.fire({ icon: 'error', title: 'No se pudo abrir el reporte', text: mensajeDeError(e) });
          this.router.navigate(['/dashboard/reportes']);
        },
      });
    }

    // En pantallas chicas los paneles laterales nacen cerrados.
    if (typeof window !== 'undefined' && window.innerWidth < 1200) {
      this.panelIzqAbierto.set(false);
      this.panelDerAbierto.set(false);
    }
  }

  // ─────────────────────────── explorador ───────────────────────────

  /** Arrastrar un campo del explorador hasta el panel de columnas. */
  soltarCampo(ev: CdkDragDrop<unknown>): void {
    const campo = ev.item.data as CampoCatalogo | undefined;
    if (!campo) return;
    const clave = campo.clave.split('.').slice(0, -1).join('.');
    if (!this.store.datasetsUsados().includes(clave)) {
      this.avisarTablaNoAgregada(clave);
      return;
    }
    this.store.agregarCampo(campo);
  }

  avisarSinRelacion(d: DatasetCatalogo): void {
    Swal.fire({
      icon: 'info',
      title: `No se puede relacionar «${d.nombre}» todavía`,
      html: 'No hay una relación conocida entre esa tabla y las que ya agregaste.<br><br>'
        + 'Agrega primero la tabla que las une, o pídele a un administrador que declare '
        + 'la relación en el <b>Catálogo de datos</b>.',
    });
  }

  private avisarTablaNoAgregada(clave: string): void {
    const d = this.api.datasetsPorClave().get(clave);
    Swal.fire({
      icon: 'info',
      title: 'Falta agregar la tabla',
      text: `El campo pertenece a «${d?.nombre ?? clave}». Agrégala al reporte antes de usar sus columnas.`,
    });
  }

  // ─────────────────────────── campos calculados ───────────────────────────

  nuevoCalculado(): void {
    this.dialog.open(EditorCalculadoComponent, {
      maxWidth: '96vw',
      data: {
        campos: this.store.camposDisponibles(),
        funciones: this.api.metadatos()?.funciones ?? [],
      },
    }).afterClosed().subscribe(res => {
      if (!res) return;
      this.store.agregarCalculado({
        alias: res.alias, expresion: res.expresion, tipo: res.tipo, formato: res.formato,
      });
    });
  }

  editarCalculado(id: string): void {
    const existente = this.store.calculated().find(c => c.id === id);
    if (!existente) return;
    this.dialog.open(EditorCalculadoComponent, {
      maxWidth: '96vw',
      data: {
        campos: this.store.camposDisponibles(),
        funciones: this.api.metadatos()?.funciones ?? [],
        existente,
      },
    }).afterClosed().subscribe(res => {
      if (!res) return;
      this.store.actualizarCalculado(id, {
        alias: res.alias, expresion: res.expresion, tipo: res.tipo, formato: res.formato,
      });
    });
  }

  // ─────────────────────────── guardar / exportar ───────────────────────────

  guardar(): void {
    if (!this.store.fields().length) {
      Swal.fire({ icon: 'info', title: 'Falta seleccionar columnas',
        text: 'Un reporte necesita al menos una columna.' });
      return;
    }
    const esNuevo = !this.store.reporteId();
    const pedirNombre = esNuevo || this.store.nombre() === 'Reporte sin titulo';

    const continuar = (nombre: string, descripcion: string | null, categoria: string | null) => {
      this.guardando.set(true);
      const cuerpo = {
        nombre,
        descripcion,
        categoria,
        tipo: this.tipoReporte(),
        estado: this.store.estado(),
        visibilidad: this.store.visibilidad(),
        definicion: this.store.definicion(),
        visualizacion: this.store.visualizacion(),
      };
      const peticion = esNuevo
        ? this.api.crearReporte(cuerpo)
        : this.api.actualizarReporte(this.store.reporteId()!, cuerpo);

      peticion.subscribe({
        next: d => {
          this.guardando.set(false);
          this.store.cargarDesde(d);
          this.toast(esNuevo ? 'Reporte creado' : 'Cambios guardados');
          if (esNuevo) {
            this.router.navigate(['/dashboard/reportes/constructor', d.id], { replaceUrl: true });
          }
        },
        error: e => {
          this.guardando.set(false);
          Swal.fire({ icon: 'error', title: 'No se pudo guardar', text: mensajeDeError(e) });
        },
      });
    };

    if (!pedirNombre) {
      continuar(this.store.nombre(), this.store.descripcion(), this.store.categoria());
      return;
    }

    Swal.fire({
      title: 'Guardar reporte',
      html: `
        <input id="rp-nombre" class="swal2-input" placeholder="Nombre del reporte"
               value="${esNuevo ? '' : this.escapar(this.store.nombre())}">
        <input id="rp-desc" class="swal2-input" placeholder="Descripción (opcional)"
               value="${this.escapar(this.store.descripcion() ?? '')}">
        <input id="rp-cat" class="swal2-input" placeholder="Categoría (opcional)"
               value="${this.escapar(this.store.categoria() ?? '')}">
      `,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const n = (document.getElementById('rp-nombre') as HTMLInputElement)?.value?.trim();
        if (!n) { Swal.showValidationMessage('El reporte necesita un nombre'); return false; }
        return {
          nombre: n,
          descripcion: (document.getElementById('rp-desc') as HTMLInputElement)?.value?.trim() || null,
          categoria: (document.getElementById('rp-cat') as HTMLInputElement)?.value?.trim() || null,
        };
      },
    }).then(res => {
      if (!res.isConfirmed || !res.value) return;
      this.store.nombre.set(res.value.nombre);
      this.store.descripcion.set(res.value.descripcion);
      this.store.categoria.set(res.value.categoria);
      continuar(res.value.nombre, res.value.descripcion, res.value.categoria);
    });
  }

  /** El tipo del reporte se deduce de cómo lo dejó el usuario, no se le pregunta. */
  private tipoReporte(): string {
    const t = this.store.visualizacion().tipo;
    if (t === 'KPI') return 'KPI';
    if (t === 'TABLA') return 'TABLA';
    return 'GRAFICA';
  }

  exportar(formato: 'XLSX' | 'CSV' | 'PDF', completo: boolean): void {
    if (!this.store.fields().length) return;
    Swal.fire({ title: 'Generando el archivo…', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
    const titulo = this.store.nombre();
    this.api.exportarConsulta({
      definicion: this.store.definicion(),
      titulo, formato, completo,
      limite: completo ? undefined : 200,
      orden: this.store.orden(),
    }).subscribe({
      next: blob => { Swal.close(); descargar(blob, nombreArchivo(titulo, formato)); },
      error: e => Swal.fire({ icon: 'error', title: 'No se pudo exportar', text: mensajeDeError(e) }),
    });
  }

  compartir(): void {
    const id = this.store.reporteId();
    if (!id) {
      Swal.fire({ icon: 'info', title: 'Guarda el reporte primero',
        text: 'Para compartirlo necesitas guardarlo.' });
      return;
    }
    this.dialog.open(CompartirDialogComponent, {
      width: '600px', maxWidth: '95vw',
      data: {
        nombre: this.store.nombre(),
        visibilidad: this.store.visibilidad(),
        comparticiones: [],
        roles: [],
      },
    }).afterClosed().subscribe(res => {
      if (!res) return;
      this.api.compartirReporte(id, res.visibilidad, res.comparticiones).subscribe({
        next: () => { this.store.visibilidad.set(res.visibilidad); this.toast('Compartido actualizado'); },
        error: e => Swal.fire({ icon: 'error', title: 'No se pudo compartir', text: mensajeDeError(e) }),
      });
    });
  }

  verSql(): void {
    this.api.validar(this.store.definicion()).subscribe({
      next: r => {
        Swal.fire({
          title: 'Consulta generada',
          html: `<pre class="rp-sql">${this.escapar(r.sql || '(solo visible para administradores)')}</pre>`,
          width: 780,
          customClass: { htmlContainer: 'rp-sql-cont' },
        });
      },
      error: e => Swal.fire({ icon: 'error', title: 'La definición no es válida', text: mensajeDeError(e) }),
    });
  }

  crearConIA(): void {
    Swal.fire({
      title: 'Crear reporte con IA',
      input: 'textarea',
      inputPlaceholder: 'Ej.: cuántas personas fueron contratadas por cada empresa durante agosto',
      showCancelButton: true,
      confirmButtonText: 'Generar',
      cancelButtonText: 'Cancelar',
    }).then(res => {
      if (!res.isConfirmed || !res.value?.trim()) return;
      Swal.fire({ title: 'Armando el reporte…', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
      this.api.proponerConIA(res.value.trim()).subscribe({
        next: r => {
          Swal.close();
          if (!r.ok || !r.definicion) {
            Swal.fire({ icon: 'info', title: 'No disponible', text: r.mensaje ?? 'Intenta de nuevo.' });
            return;
          }
          this.store.aplicarDefinicion(r.definicion);
        },
        error: e => Swal.fire({ icon: 'error', title: 'No se pudo generar', text: mensajeDeError(e) }),
      });
    });
  }

  // ─────────────────────────── tabla ───────────────────────────

  alOrdenar(orden: SortSpec[]): void { this.store.fijarOrden(orden); }

  alPaginar(): void { /* la vista previa siempre trae la primera página */ }

  volver(): void {
    if (!this.store.sucio()) { this.router.navigate(['/dashboard/reportes']); return; }
    Swal.fire({
      icon: 'warning',
      title: 'Tienes cambios sin guardar',
      showCancelButton: true,
      confirmButtonText: 'Salir sin guardar',
      cancelButtonText: 'Seguir editando',
      confirmButtonColor: '#dc2626',
    }).then(r => { if (r.isConfirmed) this.router.navigate(['/dashboard/reportes']); });
  }

  private toast(titulo: string): void {
    Swal.fire({ icon: 'success', title: titulo, toast: true, position: 'top-end',
      timer: 1800, showConfirmButton: false });
  }

  private escapar(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
