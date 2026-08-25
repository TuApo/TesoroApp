import {
  ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, output, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { concatMap, from, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { OfficeFormsService, descargarBlob } from '../../services/office-forms.service';
import {
  FieldType, ImportRef, OfficeImportResult, OfficeImportedForm, OfficeTemplateConfig, RoleAccess,
  Visibility, paletteLabel,
} from '../../models/office-forms.models';

interface ResultadoCreacion {
  nombre: string;
  ok: boolean;
  detalle: string;
}

type Pestana = 'plantilla' | 'cargar';

/**
 * CARGA POR EXCEL de los formularios de control de Gestión de Oficina.
 *
 * Es la hermana del diálogo de Formularios Dinámicos, con los conceptos de ESTE motor:
 * antes de bajar la plantilla se define el módulo donde se agrupa, las OFICINAS que lo
 * responden y los roles que lo ven o lo llenan; todo eso viaja dentro del archivo y
 * vuelve puesto al cargarlo. Nada se guarda al cargar: un formulario se abre en el
 * constructor con todo cargado, y si el archivo trae varios se crean en bloque desde aquí.
 */
@Component({
  selector: 'app-office-excel-import-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './excel-import-dialog.component.html',
  styleUrl: './excel-import-dialog.component.css',
})
export class OfficeExcelImportDialogComponent implements OnInit {
  private api = inject(OfficeFormsService);
  private destroyRef = inject(DestroyRef);

  /** Valores con los que abrir el paso 1 cuando ya hay un formulario a medias. */
  readonly tituloInicial = input<string>('');
  readonly descripcionInicial = input<string>('');
  readonly moduloInicial = input<string>('');

  readonly abrir = output<OfficeImportedForm>();
  readonly creados = output<number>();
  readonly cerrar = output<void>();

  readonly pestana = signal<Pestana>('plantilla');

  // ── Paso 1 ────────────────────────────────────────────────────────
  readonly modo = signal<'individual' | 'masivo'>('individual');
  readonly cuantos = signal(3);
  readonly titulo = signal('');
  readonly descripcion = signal('');
  readonly moduloPadre = signal('');
  readonly visibilidad = signal<Visibility>('PRIVATE');
  readonly conEjemplos = signal(true);

  readonly oficinas = signal<ImportRef[]>([]);
  readonly oficinasSel = signal<string[]>([]);
  readonly roles = signal<ImportRef[]>([]);
  readonly rolesVen = signal<string[]>([]);
  readonly rolesResponden = signal<string[]>([]);
  readonly descargando = signal(false);

  // ── Paso 2 ────────────────────────────────────────────────────────
  readonly archivo = signal<File | null>(null);
  readonly leyendo = signal(false);
  readonly resultado = signal<OfficeImportResult | null>(null);
  readonly errorCarga = signal('');
  readonly abierto = signal<string | null>(null);
  readonly creando = signal(false);
  readonly resultadosCreacion = signal<ResultadoCreacion[]>([]);

  constructor() {
    this.api.sedes()
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (res: unknown) => this.oficinas.set(normalizarSedes(res)),
        error: () => this.oficinas.set([]),
      });
    this.api.roles()
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: rs => this.roles.set((rs ?? []).map(r => ({ id: String(r.id), name: r.nombre }))),
        error: () => this.roles.set([]),
      });
  }

  /**
   * Lo que ya escribió el usuario en el constructor entra como punto de partida. Va en
   * ngOnInit y no en el constructor porque los inputs todavía no están puestos ahí.
   */
  ngOnInit(): void {
    if (!this.titulo()) this.titulo.set(this.tituloInicial());
    if (!this.descripcion()) this.descripcion.set(this.descripcionInicial());
    if (!this.moduloPadre()) this.moduloPadre.set(this.moduloInicial());
  }

  // ── Resúmenes ─────────────────────────────────────────────────────

  readonly resumenOficinas = computed(() => {
    const ids = this.oficinasSel();
    if (!ids.length) return 'Todas las oficinas.';
    return this.oficinas().filter(o => ids.includes(o.id)).map(o => o.name).join(', ');
  });

  readonly resumenRoles = computed(() => {
    const ven = this.nombresDe(this.rolesVen());
    const responden = this.nombresDe(this.rolesResponden());
    if (!ven && !responden) return 'Sin roles: los permisos se asignan después.';
    const partes: string[] = [];
    if (responden) partes.push(`responden: ${responden}`);
    if (ven) partes.push(`ven: ${ven}`);
    return partes.join(' · ');
  });

  readonly cuantosValidos = computed(() => (this.resultado()?.forms ?? []).filter(f => f.valid).length);

  private nombresDe(ids: string[]): string {
    return this.roles().filter(r => ids.includes(r.id)).map(r => r.name).join(', ');
  }

  // ── Paso 1 ────────────────────────────────────────────────────────

  alternarOficina(id: string): void {
    const sel = this.oficinasSel();
    this.oficinasSel.set(sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]);
  }

  alternarRolVe(id: string): void {
    const sel = this.rolesVen();
    this.rolesVen.set(sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]);
  }

  alternarRolResponde(id: string): void {
    const sel = this.rolesResponden();
    this.rolesResponden.set(sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]);
  }

  marcado(ids: string[], id: string): boolean {
    return ids.includes(id);
  }

  descargarPlantilla(): void {
    const config: OfficeTemplateConfig = {
      mode: this.modo(),
      forms_count: this.modo() === 'masivo' ? Math.min(Math.max(this.cuantos(), 1), 50) : 1,
      title: this.titulo().trim(),
      description: this.descripcion().trim(),
      parent_module: this.moduloPadre().trim(),
      visibility: this.visibilidad(),
      offices: this.refs(this.oficinas(), this.oficinasSel()),
      view_roles: this.refs(this.roles(), this.rolesVen()),
      respond_roles: this.refs(this.roles(), this.rolesResponden()),
      include_examples: this.conEjemplos(),
    };
    this.descargando.set(true);
    this.api.plantilla(config)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: blob => {
          this.descargando.set(false);
          const fecha = new Date().toISOString().slice(0, 10);
          const base = this.modo() === 'masivo' ? 'plantilla-oficina-masiva' : 'plantilla-oficina';
          descargarBlob(blob, `${base}-${fecha}.xlsx`);
          this.pestana.set('cargar');
        },
        error: (err: unknown) => {
          this.descargando.set(false);
          this.errorCarga.set(this.motivo(err, 'No se pudo generar la plantilla.'));
          this.pestana.set('cargar');
        },
      });
  }

  private refs(todos: ImportRef[], ids: string[]): ImportRef[] {
    return todos.filter(x => ids.includes(x.id));
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
    this.api.cargarExcel(file)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: r => {
          this.leyendo.set(false);
          this.resultado.set(r);
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

  abrirEnConstructor(f: OfficeImportedForm): void {
    if (f.valid) this.abrir.emit(f);
  }

  /** Nombre legible del tipo, para la vista previa de las preguntas. */
  nombreTipo(tipo: FieldType): string {
    return paletteLabel(tipo);
  }

  /** Nombres de una lista de roles del archivo, para el detalle. */
  nombresDeRoles(refs: ImportRef[]): string {
    return (refs ?? []).map(r => r.name || r.id).join(', ');
  }

  /**
   * Crea en bloque los formularios válidos. Uno a uno (concatMap): cada alta son cuatro
   * llamadas encadenadas (crear, campos, oficinas, accesos) y que uno falle no debe
   * cancelar los demás — cada resultado se reporta por separado.
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

  private crearUno(f: OfficeImportedForm) {
    return this.api.create({
      title: f.title,
      description: f.description ?? null,
      parent_module: f.parent_module ?? null,
      visibility: f.visibility,
    }).pipe(
      concatMap(creado => {
        const id = creado.id!;
        return this.api.setFields(id, f.fields).pipe(
          concatMap(() => this.api.setOffices(id, f.office_ids ?? [])),
          concatMap(() => {
            const accesos = accesosDe(f);
            return accesos.length ? this.api.setAccess(id, accesos) : of(creado);
          }),
          map(() => ({
            nombre: f.title,
            ok: true,
            detalle: `Creado como borrador con ${f.fields_count} pregunta(s). Publícalo cuando lo revises.`,
          } as ResultadoCreacion)),
          // El formulario ya existe: que falle un paso posterior no lo invalida.
          catchError((err: unknown) => of<ResultadoCreacion>({
            nombre: f.title,
            ok: true,
            detalle: 'Creado, pero quedó incompleto: ' + this.motivo(err, 'revisa campos, oficinas y accesos.'),
          })),
        );
      }),
      catchError((err: unknown) => of<ResultadoCreacion>({
        nombre: f.title,
        ok: false,
        detalle: this.motivo(err, 'No se pudo crear.'),
      })),
    );
  }

  private motivo(err: unknown, porDefecto: string): string {
    if (err instanceof HttpErrorResponse) {
      const cuerpo = err.error as { message?: string; detail?: string } | undefined;
      if (cuerpo?.detail) return cuerpo.detail;
      if (cuerpo?.message) return cuerpo.message;
      if (err.status === 403) return 'No tienes permiso para crear formularios.';
      if (err.status === 0) return 'Sin conexión con el servidor.';
    }
    return porDefecto;
  }
}

/** Accesos por rol a partir de las dos listas del archivo (ver / responder). */
function accesosDe(f: OfficeImportedForm): RoleAccess[] {
  const ven = new Set((f.view_roles ?? []).map(r => r.id));
  const responden = new Set((f.respond_roles ?? []).map(r => r.id));
  const todos = new Set<string>([...ven, ...responden]);
  return [...todos].map(id => ({
    role_id: id,
    // Quien responde necesita ver el formulario para llenarlo.
    can_view: ven.has(id) || responden.has(id),
    can_respond: responden.has(id),
  }));
}

/** El catálogo de sedes llega con varias formas según el endpoint; se normaliza aquí. */
function normalizarSedes(res: unknown): ImportRef[] {
  const cuerpo = res as { results?: unknown[]; data?: unknown[] } | unknown[] | null;
  const arr: unknown[] = Array.isArray(cuerpo)
    ? cuerpo
    : ((cuerpo as { results?: unknown[] })?.results ?? (cuerpo as { data?: unknown[] })?.data ?? []);
  return arr
    .map(x => x as Record<string, unknown>)
    .map(s => ({
      id: String(s['id'] ?? s['sede_id'] ?? s['uuid'] ?? s['codigo'] ?? ''),
      name: String(s['nombre'] ?? s['name'] ?? s['sede'] ?? s['descripcion'] ?? s['id'] ?? ''),
    }))
    .filter(o => o.id);
}
