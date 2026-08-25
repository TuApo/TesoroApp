import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatTabsModule } from '@angular/material/tabs';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatExpansionModule } from '@angular/material/expansion';
import Swal from 'sweetalert2';
import { ReportesApiService } from '../../services/reportes-api.service';
import { mensajeDeError } from '../../services/constructor.store';
import { DatasetCatalogo } from '../../models/reportes.models';

/**
 * Administración del catálogo de datos (§25).
 *
 * Es la pantalla que decide QUÉ puede reportar la organización: qué tablas se
 * exponen, con qué nombre, qué columnas, cuáles son sensibles y quién ve qué.
 * Por eso solo la ven los administradores del módulo y todo lo que se hace aquí
 * queda en la auditoría.
 *
 * El asistente de alta parte de las tablas REALES del esquema: no se puede
 * escribir a mano el nombre de una tabla, se elige de las que existen.
 */
@Component({
  selector: 'app-catalogo-admin',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, RouterLink, MatIconModule, MatButtonModule,
    MatTooltipModule, MatTabsModule, MatFormFieldModule, MatSelectModule,
    MatInputModule, MatCheckboxModule, MatProgressBarModule, MatExpansionModule],
  templateUrl: './catalogo-admin.component.html',
  styleUrls: ['./catalogo-admin.component.css'],
})
export class CatalogoAdminComponent implements OnInit {

  readonly api = inject(ReportesApiService);

  readonly cargando = signal(true);
  readonly diagnostico = signal<any>(null);
  readonly esquemaSeleccionado = signal<string>('');
  readonly tablasDisponibles = signal<any[]>([]);
  readonly relacionesSugeridas = signal<any[]>([]);
  readonly permisos = signal<Record<string, any[]>>({});
  readonly guardando = signal(false);

  busqueda = '';

  readonly datasets = computed<DatasetCatalogo[]>(() => {
    const q = this.busqueda.trim().toLowerCase();
    const lista = this.api.catalogo()?.datasets ?? [];
    if (!q) return lista;
    return lista.filter(d =>
      d.nombre.toLowerCase().includes(q) || d.tabla_fisica.toLowerCase().includes(q));
  });

  readonly esquemas = computed(() => this.diagnostico()?.esquemas_permitidos ?? []);

  readonly incidencias = computed<string[]>(() => this.diagnostico()?.incidencias ?? []);

  ngOnInit(): void {
    this.api.cargarCatalogo(true).subscribe({
      next: () => this.cargando.set(false),
      error: () => this.cargando.set(false),
    });
    this.cargarDiagnostico();
  }

  cargarDiagnostico(): void {
    this.api.diagnosticoCatalogo().subscribe({
      next: d => {
        this.diagnostico.set(d);
        if (!this.esquemaSeleccionado() && d.esquemas_permitidos?.length) {
          this.esquemaSeleccionado.set(d.esquemas_permitidos[0]);
          this.cargarEsquema();
        }
      },
      error: e => Swal.fire({ icon: 'error', title: 'No se pudo leer el catálogo', text: mensajeDeError(e) }),
    });
  }

  cargarEsquema(): void {
    const esq = this.esquemaSeleccionado();
    if (!esq) return;
    this.cargando.set(true);
    this.api.tablasDisponibles(esq).subscribe({
      next: t => { this.tablasDisponibles.set(t); this.cargando.set(false); },
      error: () => this.cargando.set(false),
    });
    this.api.relacionesSugeridas(esq).subscribe({
      next: r => this.relacionesSugeridas.set(r),
      error: () => this.relacionesSugeridas.set([]),
    });
  }

  refrescar(): void {
    this.cargando.set(true);
    this.api.refrescarCatalogo().subscribe({
      next: d => {
        this.diagnostico.set(d);
        this.api.cargarCatalogo(true).subscribe(() => this.cargando.set(false));
      },
      error: e => {
        this.cargando.set(false);
        Swal.fire({ icon: 'error', title: 'No se pudo refrescar', text: mensajeDeError(e) });
      },
    });
  }

  /**
   * Alta rápida de una tabla: se toman TODAS sus columnas con un nombre visible
   * derivado del técnico, y el administrador afina después. Es mucho más rápido
   * que declarar cincuenta columnas a mano, y nada queda expuesto sin querer
   * porque el servidor rechaza las columnas de la lista negra (contraseñas, etc.).
   */
  exponerTabla(t: any): void {
    Swal.fire({
      title: `Exponer «${t.tabla}»`,
      html: `
        <input id="ct-nombre" class="swal2-input" placeholder="Nombre visible" value="${this.aTitulo(t.tabla)}">
        <input id="ct-cat" class="swal2-input" placeholder="Categoría (opcional)">
        <input id="ct-clave" class="swal2-input" placeholder="Clave (ej. hr.mi_tabla)"
               value="${this.claveSugerida(t)}">
      `,
      showCancelButton: true,
      confirmButtonText: 'Exponer',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const nombre = (document.getElementById('ct-nombre') as HTMLInputElement)?.value?.trim();
        const clave = (document.getElementById('ct-clave') as HTMLInputElement)?.value?.trim();
        if (!nombre || !clave) { Swal.showValidationMessage('El nombre y la clave son obligatorios'); return false; }
        return {
          nombre, clave,
          categoria: (document.getElementById('ct-cat') as HTMLInputElement)?.value?.trim() || null,
        };
      },
    }).then(res => {
      if (!res.isConfirmed || !res.value) return;
      const origen = this.origenDe(this.esquemaSeleccionado());
      if (!origen) {
        Swal.fire({ icon: 'error', title: 'Sin origen',
          text: `No hay un origen de datos configurado para el esquema ${this.esquemaSeleccionado()}.` });
        return;
      }
      this.guardando.set(true);
      this.api.guardarDatasetCatalogo({
        origen,
        tabla: t.tabla,
        clave: res.value.clave,
        nombre: res.value.nombre,
        categoria: res.value.categoria,
        icono: 'table_chart',
        pk_columna: this.pkProbable(t),
        editable: false,
        campos: (t.columnas ?? []).map((c: any, i: number) => ({
          columna: c.columna,
          nombre: this.aTitulo(c.columna),
          tipo: this.tipoDesdeSql(c.tipo_sql),
          formato: null,
          grupo: null,
          visible: true,
          filtrable: true,
          agrupable: true,
          agregable: ['int', 'bigint', 'decimal', 'double', 'float', 'smallint'].some(x => (c.tipo_sql ?? '').includes(x)),
          editable: false,
          sensible: c.sugerida_sensible,
          orden: (i + 1) * 10,
        })),
      }).subscribe({
        next: () => {
          this.guardando.set(false);
          Swal.fire({ icon: 'success', title: 'Tabla expuesta',
            text: 'Ya se puede usar en reportes. Ajusta nombres y campos sensibles desde la pestaña «Expuestas».',
            timer: 3000, showConfirmButton: false });
          this.refrescar();
          this.cargarEsquema();
        },
        error: e => {
          this.guardando.set(false);
          Swal.fire({ icon: 'error', title: 'No se pudo exponer', text: mensajeDeError(e) });
        },
      });
    });
  }

  quitarTabla(d: DatasetCatalogo): void {
    Swal.fire({
      icon: 'warning',
      title: `¿Quitar «${d.nombre}» del catálogo?`,
      html: 'La tabla dejará de aparecer en el constructor. Los reportes que la usen '
        + '<b>dejarán de funcionar</b> hasta que se corrijan.<br><br>'
        + 'No se borra nada de la base de datos.',
      showCancelButton: true, confirmButtonText: 'Quitar', cancelButtonText: 'Cancelar',
      confirmButtonColor: '#dc2626',
    }).then(r => {
      if (!r.isConfirmed) return;
      this.api.desactivarDatasetCatalogo(d.clave).subscribe({
        next: () => { this.refrescar(); },
        error: e => Swal.fire({ icon: 'error', title: 'No se pudo quitar', text: mensajeDeError(e) }),
      });
    });
  }

  crearRelacion(r: any): void {
    this.api.guardarRelacionCatalogo(r).subscribe({
      next: () => {
        Swal.fire({ icon: 'success', title: 'Relación creada', toast: true,
          position: 'top-end', timer: 1800, showConfirmButton: false });
        this.refrescar();
        this.cargarEsquema();
      },
      error: e => Swal.fire({ icon: 'error', title: 'No se pudo crear', text: mensajeDeError(e) }),
    });
  }

  verPermisos(d: DatasetCatalogo): void {
    this.api.permisosDataset(d.clave).subscribe({
      next: p => this.permisos.update(m => ({ ...m, [d.clave]: p })),
      error: () => {},
    });
  }

  agregarPermiso(clave: string, rol: string, sensibles: boolean): void {
    const actuales = this.permisos()[clave] ?? [];
    if (actuales.some(p => p.sujeto_ref === rol)) return;
    const nuevos = [...actuales, {
      sujeto_tipo: 'ROL', sujeto_ref: rol.toUpperCase(),
      puede_ver: true, puede_ver_sensibles: sensibles, puede_editar: false,
    }];
    this.api.guardarPermisosDataset(clave, nuevos).subscribe({
      next: p => this.permisos.update(m => ({ ...m, [clave]: p })),
      error: e => Swal.fire({ icon: 'error', title: 'No se pudo guardar', text: mensajeDeError(e) }),
    });
  }

  quitarPermiso(clave: string, ref: string): void {
    const nuevos = (this.permisos()[clave] ?? []).filter(p => p.sujeto_ref !== ref);
    this.api.guardarPermisosDataset(clave, nuevos).subscribe({
      next: p => this.permisos.update(m => ({ ...m, [clave]: p })),
      error: e => Swal.fire({ icon: 'error', title: 'No se pudo guardar', text: mensajeDeError(e) }),
    });
  }

  pedirRol(clave: string): void {
    Swal.fire({
      title: 'Dar acceso a un rol',
      input: 'text',
      inputPlaceholder: 'ANALISTA',
      html: '<label style="display:flex;gap:.4rem;align-items:center;justify-content:center;margin-top:.6rem">'
        + '<input type="checkbox" id="ct-sens"> También los campos sensibles</label>',
      showCancelButton: true, confirmButtonText: 'Dar acceso', cancelButtonText: 'Cancelar',
      preConfirm: (v) => {
        if (!v?.trim()) { Swal.showValidationMessage('Escribe el nombre del rol'); return false; }
        return { rol: v.trim(), sensibles: (document.getElementById('ct-sens') as HTMLInputElement)?.checked ?? false };
      },
    }).then(r => {
      if (r.isConfirmed && r.value) this.agregarPermiso(clave, r.value.rol, r.value.sensibles);
    });
  }

  // ─────────────────────────── utilidades ───────────────────────────

  private origenDe(esquema: string): string | null {
    const cat = this.api.catalogo();
    const d = cat?.datasets.find(x => x.esquema === esquema);
    return d?.origen ?? null;
  }

  private pkProbable(t: any): string | null {
    const cols: string[] = (t.columnas ?? []).map((c: any) => c.columna);
    return cols.find(c => c === 'id') ?? cols.find(c => c.startsWith('id_')) ?? null;
  }

  /** `numero_documento` → `Numero documento`. Un punto de partida razonable. */
  aTitulo(s: string): string {
    const limpio = s.replace(/^tabla_/, '').replace(/[_]+/g, ' ').trim();
    return limpio.charAt(0).toUpperCase() + limpio.slice(1);
  }

  private claveSugerida(t: any): string {
    const origen = this.origenDe(this.esquemaSeleccionado()) ?? 'datos';
    const base = t.tabla.replace(/^tabla_/, '').replace(/[^A-Za-z0-9_]/g, '_').toLowerCase();
    return `${origen}.${base}`;
  }

  private tipoDesdeSql(tipoSql: string): string {
    const t = (tipoSql ?? '').toLowerCase();
    if (t.includes('int')) return t.includes('tinyint') ? 'BOOLEANO' : 'ENTERO';
    if (t.includes('decimal') || t.includes('double') || t.includes('float')) return 'DECIMAL';
    if (t === 'date') return 'FECHA';
    if (t.includes('datetime') || t.includes('timestamp')) return 'FECHA_HORA';
    return 'TEXTO';
  }

  camposSensibles(d: DatasetCatalogo): number {
    return d.campos.filter(c => c.sensible).length;
  }
}
