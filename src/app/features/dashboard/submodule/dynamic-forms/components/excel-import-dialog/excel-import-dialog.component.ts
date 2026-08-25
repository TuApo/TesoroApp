import {
  ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, output, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { concatMap, from, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { ModuleTreePickerComponent } from '../module-tree-picker/module-tree-picker.component';
import { ModuleNode, PlacementRequest } from '../../models/placement.models';
import { ImportResult, ImportRoleRef, ImportedForm, TemplateConfig } from '../../models/form-import.models';
import { FormImportService, descargarBlob } from '../../services/form-import.service';
import { RolesService, RolResumen } from '../../services/roles.service';
import { DynamicFormService } from '../../services/dynamic-form.service';
import { PlacementService } from '../../services/placement.service';
import { ApiProblem } from '../../models/dynamic-forms.models';

/** Resultado de crear un formulario en la carga masiva. */
interface ResultadoCreacion {
  nombre: string;
  ok: boolean;
  detalle: string;
}

type Pestana = 'plantilla' | 'cargar';

/**
 * CARGA POR EXCEL de formularios: los dos botones que pidió el negocio, en un solo sitio.
 *
 *  1. «Descargar plantilla» — antes de bajar el archivo se define a quién se le presta el
 *     formulario (roles que lo llenan), en qué módulo del menú queda, con qué etiqueta,
 *     visibilidad y recorrido. Todo eso va DENTRO del archivo, así que al volver no hay
 *     que reconfigurar nada.
 *  2. «Cargar archivo» — el backend lo lee y devuelve los formularios tal como quedarían.
 *     Nada se guarda todavía: uno solo se abre en el constructor con todo cargado, y si
 *     el archivo trae varios se pueden crear en bloque desde aquí.
 *
 * El diálogo no decide la navegación: emite `abrir` con el formulario elegido y quien lo
 * hospeda (el listado o el constructor) decide qué hacer.
 */
@Component({
  selector: 'app-excel-import-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, ModuleTreePickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './excel-import-dialog.component.html',
  styleUrl: './excel-import-dialog.component.css',
})
export class ExcelImportDialogComponent implements OnInit {
  private importSvc = inject(FormImportService);
  private rolesSvc = inject(RolesService);
  private formsSvc = inject(DynamicFormService);
  private placementSvc = inject(PlacementService);
  private destroyRef = inject(DestroyRef);

  /** Valores con los que abrir el paso 1 cuando ya hay un formulario a medias. */
  readonly nombreInicial = input<string>('');
  readonly descripcionInicial = input<string>('');
  readonly categoriaInicial = input<string>('');

  /** Un formulario listo para volcar en el constructor. */
  readonly abrir = output<ImportedForm>();
  /** Se crearon formularios en bloque (el listado se refresca). */
  readonly creados = output<number>();
  readonly cerrar = output<void>();

  readonly pestana = signal<Pestana>('plantilla');

  // ── Paso 1: parametrizar y descargar ──────────────────────────────
  readonly modo = signal<'individual' | 'masivo'>('individual');
  readonly cuantos = signal(3);
  readonly nombre = signal('');
  readonly descripcion = signal('');
  readonly categoria = signal('');
  readonly esPublico = signal(false);
  readonly pasoAPaso = signal(true);
  readonly conEjemplos = signal(true);

  readonly moduloId = signal<string | null>(null);
  readonly moduloNodo = signal<ModuleNode | null>(null);
  readonly etiquetaMenu = signal('');
  readonly icono = signal('dynamic_form');
  readonly menuRespuestas = signal(true);

  readonly roles = signal<RolResumen[]>([]);
  readonly rolesSel = signal<string[]>([]);
  readonly cargandoRoles = signal(false);
  readonly descargando = signal(false);

  // ── Paso 2: cargar y revisar ──────────────────────────────────────
  readonly archivo = signal<File | null>(null);
  readonly leyendo = signal(false);
  readonly resultado = signal<ImportResult | null>(null);
  readonly errorCarga = signal('');
  readonly abierto = signal<string | null>(null);
  readonly creando = signal(false);
  readonly resultadosCreacion = signal<ResultadoCreacion[]>([]);

  constructor() {
    this.cargandoRoles.set(true);
    this.rolesSvc.list()
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: rs => { this.roles.set(rs); this.cargandoRoles.set(false); },
        error: () => this.cargandoRoles.set(false),
      });
  }

  /**
   * Los metadatos que ya escribió el usuario en el constructor entran como punto de
   * partida: la plantilla sale con su nombre, no con uno en blanco. Va en ngOnInit y no
   * en el constructor porque los inputs todavía no están puestos ahí.
   */
  ngOnInit(): void {
    if (!this.nombre()) this.nombre.set(this.nombreInicial());
    if (!this.descripcion()) this.descripcion.set(this.descripcionInicial());
    if (!this.categoria()) this.categoria.set(this.categoriaInicial());
  }

  // ── Resúmenes ─────────────────────────────────────────────────────

  readonly resumenDestino = computed(() => {
    const n = this.moduloNodo();
    if (!n) return 'Sin módulo: el formulario se creará sin publicar en el menú.';
    const etiqueta = this.etiquetaMenu().trim() || this.nombre().trim() || 'Formulario';
    return `${n.label} › ${etiqueta}`;
  });

  readonly resumenRoles = computed(() => {
    const ids = this.rolesSel();
    if (!ids.length) return 'Nadie por ahora: los permisos se asignan después.';
    const nombres = this.roles().filter(r => ids.includes(r.id)).map(r => r.nombre);
    return nombres.join(', ');
  });

  readonly hayValidos = computed(() => (this.resultado()?.forms ?? []).some(f => f.valid));

  readonly cuantosValidos = computed(() => (this.resultado()?.forms ?? []).filter(f => f.valid).length);

  // ── Paso 1 ────────────────────────────────────────────────────────

  moduloElegido(n: ModuleNode | null): void {
    this.moduloNodo.set(n);
    this.moduloId.set(n?.id ?? null);
    if (n && !this.icono().trim()) this.icono.set(n.icon ?? 'dynamic_form');
  }

  alternarRol(id: string): void {
    const sel = this.rolesSel();
    this.rolesSel.set(sel.includes(id) ? sel.filter(r => r !== id) : [...sel, id]);
  }

  rolMarcado(id: string): boolean {
    return this.rolesSel().includes(id);
  }

  descargarPlantilla(): void {
    const config: TemplateConfig = {
      mode: this.modo(),
      forms_count: this.modo() === 'masivo' ? Math.min(Math.max(this.cuantos(), 1), 50) : 1,
      name: this.nombre().trim(),
      description: this.descripcion().trim(),
      category: this.categoria().trim(),
      is_public: this.esPublico(),
      navigation: this.pasoAPaso() ? 'wizard' : 'single',
      parent_module_id: this.moduloId(),
      parent_module_label: this.moduloNodo()?.label ?? null,
      menu_label: this.etiquetaMenu().trim(),
      icon: this.icono().trim() || 'dynamic_form',
      responses_menu_enabled: this.menuRespuestas(),
      roles: this.rolesSeleccionados(),
      include_examples: this.conEjemplos(),
    };
    this.descargando.set(true);
    this.importSvc.plantilla(config)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: blob => {
          this.descargando.set(false);
          const fecha = new Date().toISOString().slice(0, 10);
          const base = this.modo() === 'masivo' ? 'plantilla-formularios-masiva' : 'plantilla-formulario';
          descargarBlob(blob, `${base}-${fecha}.xlsx`);
          // Bajar la plantilla es la mitad del trabajo: se deja lista la otra pestaña.
          this.pestana.set('cargar');
        },
        error: (err: unknown) => {
          this.descargando.set(false);
          this.errorCarga.set(this.motivo(err, 'No se pudo generar la plantilla.'));
          this.pestana.set('cargar');
        },
      });
  }

  private rolesSeleccionados(): ImportRoleRef[] {
    const ids = this.rolesSel();
    return this.roles().filter(r => ids.includes(r.id)).map(r => ({ id: r.id, name: r.nombre }));
  }

  // ── Paso 2 ────────────────────────────────────────────────────────

  archivoElegido(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (file) this.leerArchivo(file);
  }

  soltarArchivo(ev: DragEvent): void {
    ev.preventDefault();
    const file = ev.dataTransfer?.files?.[0];
    if (file) this.leerArchivo(file);
  }

  permitirSoltar(ev: DragEvent): void {
    ev.preventDefault();
  }

  private leerArchivo(file: File): void {
    this.archivo.set(file);
    this.resultado.set(null);
    this.resultadosCreacion.set([]);
    this.errorCarga.set('');
    this.leyendo.set(true);
    this.importSvc.cargar(file)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: r => {
          this.leyendo.set(false);
          this.resultado.set(r);
          // Con un solo formulario se abre su detalle de una vez: es lo que se va a revisar.
          this.abierto.set(r.forms.length === 1 ? r.forms[0].row_code : null);
        },
        error: (err: unknown) => {
          this.leyendo.set(false);
          this.errorCarga.set(this.motivo(err, 'No se pudo leer el archivo.'));
        },
      });
  }

  alternarDetalle(code: string): void {
    this.abierto.set(this.abierto() === code ? null : code);
  }

  abrirEnConstructor(f: ImportedForm): void {
    if (!f.valid) return;
    this.abrir.emit(f);
  }

  /** Preguntas de un formulario en texto, para la vista previa del detalle. */
  preguntasDe(f: ImportedForm): Array<{ seccion: string; label: string; tipo: string; obligatoria: boolean }> {
    const out: Array<{ seccion: string; label: string; tipo: string; obligatoria: boolean }> = [];
    for (const sec of f.form.sections ?? []) {
      const titulo = sec.title?.trim() || 'Sección';
      for (const campo of sec.fields ?? []) {
        out.push({ seccion: titulo, label: campo.label, tipo: campo.type, obligatoria: !!campo.required });
        for (const hijo of campo.children ?? []) {
          out.push({ seccion: `${titulo} / ${campo.label}`, label: hijo.label, tipo: hijo.type, obligatoria: !!hijo.required });
        }
      }
    }
    return out;
  }

  /**
   * Crea en bloque los formularios válidos del archivo. Va de uno en uno (concatMap): son
   * altas reales sobre ms-forms y el aprovisionamiento de módulos toca ms-auth-admin —
   * dispararlas en paralelo solo serviría para pelearse por el mismo padre del menú.
   * Cada resultado se reporta por separado: que uno falle no cancela los demás.
   */
  crearTodos(): void {
    const validos = (this.resultado()?.forms ?? []).filter(f => f.valid);
    if (!validos.length || this.creando()) return;
    this.creando.set(true);
    this.resultadosCreacion.set([]);

    from(validos)
      .pipe(
        concatMap(f => this.crearUno(f)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: r => this.resultadosCreacion.update(rs => [...rs, r]),
        error: () => this.creando.set(false),
        complete: () => {
          this.creando.set(false);
          const ok = this.resultadosCreacion().filter(r => r.ok).length;
          if (ok > 0) this.creados.emit(ok);
        },
      });
  }

  private crearUno(f: ImportedForm) {
    const req = { ...f.form };
    const roles = f.placement?.fill_role_ids ?? [];
    if (roles.length) req.fill_role_ids = roles;
    return this.formsSvc.createBuilder(req).pipe(
      concatMap(detalle => {
        const padre = f.placement?.parent_module_id;
        if (!padre) {
          return of<ResultadoCreacion>({
            nombre: detalle.name,
            ok: true,
            detalle: 'Creado sin publicar (sin módulo en el archivo).',
          });
        }
        const pr: PlacementRequest = {
          parent_module_id: padre,
          menu_label: f.placement.menu_label?.trim() || detalle.name,
          icon: f.placement.icon?.trim() || 'dynamic_form',
          responses_menu_enabled: f.placement.responses_menu_enabled !== false,
        };
        if (f.placement.order_no != null) pr.order_no = f.placement.order_no;
        if (roles.length) pr.fill_role_ids = roles;
        return this.placementSvc.place(detalle.id, pr).pipe(
          map(p => ({
            nombre: detalle.name,
            ok: true,
            detalle: p.placement_status === 'LINKED'
              ? `Publicado en ${f.placement.parent_module_label ?? 'el menú'}.`
              : 'Creado; la publicación en el menú quedó pendiente.',
          } as ResultadoCreacion)),
          // El formulario YA existe: que falle la ubicación no lo invalida.
          catchError(() => of<ResultadoCreacion>({
            nombre: detalle.name,
            ok: true,
            detalle: 'Creado, pero no se pudo publicar en el menú. Ubícalo desde el listado.',
          })),
        );
      }),
      catchError((err: unknown) => of<ResultadoCreacion>({
        nombre: f.form.name,
        ok: false,
        detalle: this.motivo(err, 'No se pudo crear.'),
      })),
    );
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private motivo(err: unknown, porDefecto: string): string {
    if (err instanceof HttpErrorResponse) {
      const p = err.error as ApiProblem | undefined;
      if (p?.detail) return p.detail;
      if (err.status === 403) return 'No tienes permiso para crear formularios.';
      if (err.status === 0) return 'Sin conexión con el servidor.';
    }
    return porDefecto;
  }
}
