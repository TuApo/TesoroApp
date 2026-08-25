import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import Swal from 'sweetalert2';

import { GestionParametrizacionService } from '@/app/features/dashboard/submodule/users/services/gestion-parametrizacion/gestion-parametrizacion.service';
import {
  OptionCatalog, OptionRuleFilter, OptionSource, OptionSourceRequest, OptionSourceRules, OptionsResult,
} from '../../models/option-source.models';
import { OptionSourceService } from '../../services/option-source.service';

/** Columna en alta de una tabla parametrizada nueva. */
interface ColumnaNueva {
  campo: string;
  tipo: 'STRING' | 'NUMBER' | 'BOOLEAN' | 'DATE';
}

/**
 * ORÍGENES DE OPCIONES — submódulo de Formularios Dinámicos.
 *
 * Dos cosas en una pantalla:
 *  1. Crear TABLAS PARAMETRIZADAS (con sus columnas y unas primeras filas). Se guardan en
 *     el motor de catálogos de la plataforma (ms-auth-admin, el mismo que usa
 *     Usuarios › Gestión de Parametrización): una sola fuente de verdad, sin copias.
 *  2. Definir ORÍGENES sobre esas tablas: qué columna se muestra, cómo se ordenan, de qué
 *     campo dependen (cascada) y qué REGLAS deciden quién ve cada fila (empresa, sede,
 *     rol, permiso heredado y filtros fijos).
 *
 * El botón "Probar" resuelve el origen CON LA SESIÓN ACTUAL: muestra exactamente lo que
 * vería quien llena el formulario, incluido el motivo cuando no ve nada.
 */
@Component({
  selector: 'app-option-sources',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule, MatCardModule, MatButtonModule, MatIconModule,
    MatProgressBarModule, MatSnackBarModule, MatTooltipModule,
  ],
  templateUrl: './option-sources.component.html',
  styleUrls: ['./option-sources.component.css'],
})
export class OptionSourcesComponent {
  private srv = inject(OptionSourceService);
  private meta = inject(GestionParametrizacionService);
  private snack = inject(MatSnackBar);

  readonly cargando = signal(false);
  readonly guardando = signal(false);
  readonly origenes = signal<OptionSource[]>([]);
  readonly catalogos = signal<OptionCatalog[]>([]);
  readonly columnas = signal<string[]>([]);

  /** Origen en edición (null = no hay editor abierto). */
  readonly editando = signal<OptionSourceRequest | null>(null);
  readonly editandoId = signal<number | null>(null);

  /** Alta de tabla parametrizada. */
  readonly nuevaTabla = signal(false);
  readonly tablaCodigo = signal('');
  readonly tablaDescripcion = signal('');
  readonly tablaColumnas = signal<ColumnaNueva[]>([{ campo: '', tipo: 'STRING' }]);
  readonly tablaFilas = signal<Record<string, string>[]>([{}]);

  /** Prueba de resolución. */
  readonly probando = signal<string | null>(null);
  readonly pruebaPadre = signal('');
  readonly prueba = signal<OptionsResult | null>(null);

  readonly candidatosPadre = computed(() =>
    this.origenes().filter(o => o.id !== this.editandoId()));

  constructor() {
    this.recargar();
  }

  // ---------- Carga ----------

  recargar(): void {
    this.cargando.set(true);
    this.srv.list(true).subscribe({
      next: list => {
        this.origenes.set(list ?? []);
        this.cargando.set(false);
      },
      error: err => {
        this.cargando.set(false);
        this.error(err, 'No se pudieron cargar los orígenes');
      },
    });
    this.srv.catalogs().subscribe({
      next: list => this.catalogos.set((list ?? []).filter(c => c.active)),
      error: err => this.error(err, 'No se pudieron cargar las tablas parametrizadas'),
    });
  }

  /** Columnas del catálogo elegido: alimentan los selectores de etiqueta/orden/clave. */
  cargarColumnas(code: string): void {
    if (!code) {
      this.columnas.set([]);
      return;
    }
    this.srv.catalogColumns(code).subscribe({
      next: cols => this.columnas.set(cols ?? []),
      error: () => this.columnas.set([]),
    });
  }

  // ---------- Editor de orígenes ----------

  nuevo(): void {
    this.editandoId.set(null);
    this.columnas.set([]);
    this.editando.set({
      name: '',
      catalog_code: '',
      label_field: '',
      value_field: null,
      order_field: null,
      parent_source_id: null,
      parent_link_field: null,
      rules: { filters: [], scope: {}, access: { roles: [] } },
      active: true,
    });
  }

  editar(o: OptionSource): void {
    this.editandoId.set(o.id);
    this.editando.set({
      name: o.name,
      description: o.description ?? null,
      catalog_code: o.catalog_code,
      label_field: o.label_field,
      value_field: o.value_field ?? null,
      order_field: o.order_field ?? null,
      parent_source_id: o.parent_source_id ?? null,
      parent_link_field: o.parent_link_field ?? null,
      rules: o.rules ?? { filters: [], scope: {}, access: { roles: [] } },
      active: o.active,
    });
    this.cargarColumnas(o.catalog_code);
  }

  cerrarEditor(): void {
    this.editando.set(null);
    this.editandoId.set(null);
  }

  /** Mutación inmutable del borrador en edición (el editor vive en un signal). */
  cambiar(parcial: Partial<OptionSourceRequest>): void {
    const actual = this.editando();
    if (!actual) return;
    this.editando.set({ ...actual, ...parcial });
  }

  cambiarCatalogo(code: string): void {
    // Al cambiar de tabla las columnas elegidas dejan de existir: se limpian.
    this.cambiar({ catalog_code: code, label_field: '', value_field: null, order_field: null });
    this.cargarColumnas(code);
  }

  cambiarRegla(parcial: Partial<OptionSourceRules>): void {
    const actual = this.editando();
    if (!actual) return;
    this.cambiar({ rules: { ...(actual.rules ?? {}), ...parcial } });
  }

  get reglas(): OptionSourceRules {
    return this.editando()?.rules ?? {};
  }

  get filtros(): OptionRuleFilter[] {
    return this.reglas.filters ?? [];
  }

  agregarFiltro(): void {
    this.cambiarRegla({ filters: [...this.filtros, { field: '', op: 'eq', value: '' }] });
  }

  cambiarFiltro(i: number, parcial: Partial<OptionRuleFilter>): void {
    const next = this.filtros.map((f, k) => (k === i ? { ...f, ...parcial } : f));
    this.cambiarRegla({ filters: next });
  }

  quitarFiltro(i: number): void {
    this.cambiarRegla({ filters: this.filtros.filter((_, k) => k !== i) });
  }

  /** Los roles se escriben separados por coma; el API los quiere como lista. */
  get rolesTexto(): string {
    return (this.reglas.access?.roles ?? []).join(', ');
  }

  cambiarRoles(texto: string): void {
    const roles = texto.split(',').map(r => r.trim()).filter(r => !!r);
    this.cambiarRegla({ access: { ...(this.reglas.access ?? {}), roles } });
  }

  cambiarPermiso(permission: string): void {
    this.cambiarRegla({ access: { ...(this.reglas.access ?? {}), permission: permission.trim() || null } });
  }

  guardar(): void {
    const req = this.editando();
    if (!req) return;
    if (!req.name?.trim() || !req.catalog_code || !req.label_field) {
      this.snack.open('Nombre, tabla y columna a mostrar son obligatorios', 'Cerrar', { duration: 4000 });
      return;
    }
    if (req.parent_source_id && !req.parent_link_field) {
      this.snack.open('Para encadenar hay que indicar la columna de enlace', 'Cerrar', { duration: 4000 });
      return;
    }
    this.guardando.set(true);
    const id = this.editandoId();
    const op = id == null ? this.srv.create(req) : this.srv.update(id, req);
    op.subscribe({
      next: () => {
        this.guardando.set(false);
        this.cerrarEditor();
        this.recargar();
        void Swal.fire({
          icon: 'success',
          title: id == null ? 'Origen creado' : 'Origen actualizado',
          timer: 1400,
          showConfirmButton: false,
        });
      },
      error: err => {
        this.guardando.set(false);
        this.error(err, 'No se pudo guardar el origen');
      },
    });
  }

  eliminar(o: OptionSource): void {
    void Swal.fire({
      icon: 'warning',
      title: `¿Eliminar "${o.name}"?`,
      text: 'Los campos que lo usen se quedarán sin opciones hasta que elijas otro origen.',
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#c0392b',
    }).then(r => {
      if (!r.isConfirmed) return;
      this.srv.remove(o.id).subscribe({
        next: () => {
          this.recargar();
          this.snack.open('Origen eliminado', 'Cerrar', { duration: 3000 });
        },
        error: err => this.error(err, 'No se pudo eliminar el origen'),
      });
    });
  }

  // ---------- Prueba ----------

  probar(o: OptionSource): void {
    this.probando.set(o.code);
    this.prueba.set(null);
    this.pruebaPadre.set('');
    this.resolverPrueba(o.code, null);
  }

  resolverPrueba(code: string, parent: string | null): void {
    this.srv.clearCache();
    this.srv.options(code, parent).subscribe({
      next: res => this.prueba.set(res),
      error: err => {
        this.prueba.set(null);
        this.error(err, 'No se pudo resolver el origen');
      },
    });
  }

  cerrarPrueba(): void {
    this.probando.set(null);
    this.prueba.set(null);
  }

  motivo(reason: string | null | undefined): string {
    switch (reason) {
      case 'espera_padre': return 'Falta elegir el campo del que depende (escribe un valor arriba para probar).';
      case 'sin_permiso': return 'Tu usuario no tiene el permiso exigido por el origen.';
      case 'sin_rol': return 'Tu rol no está entre los permitidos.';
      case 'sin_empresa': return 'Tu usuario no tiene empresa asignada.';
      case 'sin_sede': return 'Tu usuario no tiene sede asignada.';
      case 'sin_sesion': return 'El origen exige sesión: en un link público no mostrará nada.';
      case 'origen_inactivo': return 'El origen está desactivado.';
      case 'catalogo_no_disponible': return 'No se pudo leer la tabla parametrizada.';
      case 'contexto_no_disponible': return 'No se pudieron consultar empresa y sede del usuario.';
      default: return '';
    }
  }

  // ---------- Alta de tabla parametrizada ----------

  abrirNuevaTabla(): void {
    this.nuevaTabla.set(true);
    this.tablaCodigo.set('');
    this.tablaDescripcion.set('');
    this.tablaColumnas.set([{ campo: 'nombre', tipo: 'STRING' }]);
    this.tablaFilas.set([{}]);
  }

  agregarColumna(): void {
    this.tablaColumnas.update(cs => [...cs, { campo: '', tipo: 'STRING' }]);
  }

  cambiarColumna(i: number, parcial: Partial<ColumnaNueva>): void {
    this.tablaColumnas.update(cs => cs.map((c, k) => (k === i ? { ...c, ...parcial } : c)));
  }

  quitarColumna(i: number): void {
    this.tablaColumnas.update(cs => cs.filter((_, k) => k !== i));
  }

  agregarFila(): void {
    this.tablaFilas.update(fs => [...fs, {}]);
  }

  cambiarCelda(fila: number, campo: string, valor: string): void {
    this.tablaFilas.update(fs => fs.map((f, k) => (k === fila ? { ...f, [campo]: valor } : f)));
  }

  quitarFila(i: number): void {
    this.tablaFilas.update(fs => fs.filter((_, k) => k !== i));
  }

  /**
   * Crea la tabla, sus columnas y las filas con contenido. Secuencial a propósito: las
   * columnas y las filas necesitan el id de la tabla, y así un fallo a mitad deja dicho
   * exactamente en qué paso ocurrió en vez de un error suelto.
   */
  guardarTabla(): void {
    const codigo = this.tablaCodigo().trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_');
    const columnas = this.tablaColumnas().filter(c => c.campo.trim());
    if (!codigo || !columnas.length) {
      this.snack.open('La tabla necesita código y al menos una columna', 'Cerrar', { duration: 4000 });
      return;
    }
    this.guardando.set(true);
    this.meta.createMetaTabla({ codigo, descripcion: this.tablaDescripcion().trim() || undefined, activo: true })
      .subscribe({
        next: tabla => {
          const campos$ = columnas.map((c, i) => this.meta.createMetaCampo({
            tabla: tabla.id,
            campo: c.campo.trim(),
            tipo: c.tipo,
            obligatorio: false,
            visible: true,
            orden: i,
            activo: true,
          }));
          // Las columnas se crean en paralelo; las filas después, ya con la tabla lista.
          let pendientes = campos$.length;
          if (!pendientes) this.crearFilas(codigo);
          campos$.forEach(obs => obs.subscribe({
            next: () => { if (--pendientes === 0) this.crearFilas(codigo); },
            error: err => {
              this.guardando.set(false);
              this.error(err, 'La tabla se creó pero falló alguna columna');
            },
          }));
        },
        error: err => {
          this.guardando.set(false);
          this.error(err, 'No se pudo crear la tabla parametrizada');
        },
      });
  }

  private crearFilas(codigo: string): void {
    const columnas = this.tablaColumnas().filter(c => c.campo.trim()).map(c => c.campo.trim());
    const filas = this.tablaFilas()
      .map(f => {
        const datos: Record<string, string> = {};
        columnas.forEach(c => {
          const v = (f[c] ?? '').trim();
          if (v) datos[c] = v;
        });
        return datos;
      })
      .filter(d => Object.keys(d).length > 0);

    if (!filas.length) {
      this.terminarTabla(codigo, 0);
      return;
    }
    let pendientes = filas.length;
    let fallidas = 0;
    filas.forEach(datos => {
      this.meta.createMetaValorByCodigo(codigo, { datos, activo: true }).subscribe({
        next: () => { if (--pendientes === 0) this.terminarTabla(codigo, filas.length - fallidas); },
        error: () => {
          fallidas++;
          if (--pendientes === 0) this.terminarTabla(codigo, filas.length - fallidas);
        },
      });
    });
  }

  private terminarTabla(codigo: string, filas: number): void {
    this.guardando.set(false);
    this.nuevaTabla.set(false);
    this.recargar();
    void Swal.fire({
      icon: 'success',
      title: `Tabla ${codigo} creada`,
      text: filas ? `Se guardaron ${filas} filas.` : 'Sin filas todavía: agrégalas cuando quieras.',
      timer: 2200,
      showConfirmButton: false,
    });
  }

  // ---------- Helpers ----------

  resumenReglas(o: OptionSource): string {
    const partes: string[] = [];
    const r = o.rules ?? {};
    if (r.scope?.empresa_field) partes.push('empresa');
    if (r.scope?.sede_field) partes.push('sede');
    if (r.scope?.rol_field) partes.push('rol de la fila');
    if (r.access?.roles?.length) partes.push(`roles: ${r.access.roles.join('/')}`);
    if (r.access?.permission) partes.push(`permiso ${r.access.permission}`);
    if (r.filters?.length) partes.push(`${r.filters.length} filtro(s)`);
    return partes.length ? partes.join(' · ') : 'Sin reglas';
  }

  private error(err: unknown, fallback: string): void {
    const e = err as { error?: { detail?: string; title?: string } };
    this.snack.open(e?.error?.detail || e?.error?.title || fallback, 'Cerrar', { duration: 5000 });
  }
}
