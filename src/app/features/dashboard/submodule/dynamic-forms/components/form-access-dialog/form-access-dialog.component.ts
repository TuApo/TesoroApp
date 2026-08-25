import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin } from 'rxjs';

import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';

import { AudienceCatalogService, Sujeto } from '../../services/audience-catalog.service';
import { ProcessControlService } from '../../services/process-control.service';
import { ApiProblem } from '../../models/dynamic-forms.models';
import {
  CAPACIDADES, FormAccessConfig, FormAccessRule, FormColumn, ICONO_SUJETO, NOMBRE_SUJETO,
  SubjectKind, claveRegla, nombreRegla, reglaVacia,
} from '../../models/process.models';

export interface FormAccessDialogData {
  /** null durante la CREACIÓN: todavía no hay formulario que guardar. */
  formId: number | null;
  /** Nombre del formulario, solo para el título. */
  formName?: string;
  /** Configuración de partida (la del builder en creación; la del backend en edición). */
  config?: FormAccessConfig | null;
  /** Columnas del formulario: en creación las calcula el builder desde sus secciones. */
  columns: FormColumn[];
}

/**
 * PERMISOS de un formulario —a quién y para qué— y con ellos el CONTROL DEL PROCESO.
 *
 * Una regla tiene dos mitades y las dos se editan aquí, en la misma fila:
 *
 *  · A QUIÉN: un ROL, un GRUPO (finca, empresa usuaria o etiqueta libre), una OFICINA
 *    —la sede que la persona ya tiene asignada— o una PERSONA concreta. Antes solo podía
 *    ser un rol, que es un contrato de permisos y no sirve para acotar por finca.
 *  · QUÉ PUEDE: llenar, ver respuestas, editar, aprobar, exportar… y, dentro de eso,
 *    hasta qué COLUMNAS puede llenar. Eso es lo que permite dos audiencias mirando la
 *    misma tabla, cada una escribiendo únicamente lo suyo.
 *
 * Quien cae en varias reglas SUMA sus capacidades. Con "Restringir el acceso" apagado el
 * formulario queda como siempre: lo gestiona su dueño y los administradores, y el resto
 * solo lo llena. Encenderlo no le quita nada al dueño.
 */
@Component({
  selector: 'app-form-access-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule,
    MatDialogModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatIconModule,
    MatInputModule, MatProgressBarModule, MatSelectModule, MatSlideToggleModule, MatTooltipModule,
  ],
  templateUrl: './form-access-dialog.component.html',
  styleUrls: ['./form-access-dialog.component.css'],
})
export class FormAccessDialogComponent {
  readonly data = inject<FormAccessDialogData>(MAT_DIALOG_DATA);
  private ref = inject(MatDialogRef<FormAccessDialogComponent>);
  private catalogo = inject(AudienceCatalogService);
  private svc = inject(ProcessControlService);
  private destroyRef = inject(DestroyRef);

  readonly capacidades = CAPACIDADES;
  readonly nombreSujeto = NOMBRE_SUJETO;
  readonly iconoSujeto = ICONO_SUJETO;

  /** Pestañas del selector "dar acceso a…", en el orden en que se usan de verdad. */
  readonly tiposSujeto: ReadonlyArray<SubjectKind> = ['ROL', 'GRUPO', 'SEDE', 'USUARIO'];
  readonly tipoActivo = signal<SubjectKind>('ROL');
  /** Filtro del selector: con cientos de personas, elegir sin buscar es impracticable. */
  readonly busquedaSujeto = signal('');

  private readonly sujetos = signal<Record<SubjectKind, Sujeto[]>>({
    ROL: [], GRUPO: [], SEDE: [], USUARIO: [],
  });
  readonly cargandoRoles = signal(true);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);

  readonly columnas = signal<FormColumn[]>([]);

  // ── Configuración en edición ────────────────────────────────────────
  readonly porRoles = signal(false);
  readonly procesoActivo = signal(false);
  readonly campoLlave = signal<string | null>(null);
  readonly permitirEditarEnviadas = signal(false);
  readonly reglas = signal<FormAccessRule[]>([]);

  /** Regla cuya lista de columnas está desplegada (solo una a la vez: caben muchas). */
  readonly rolExpandido = signal<string | null>(null);

  readonly hayColumnas = computed(() => this.columnas().length > 0);

  /** Sujetos del tipo activo que aún no tienen regla y casan con la búsqueda. */
  readonly sujetosDisponibles = computed<Sujeto[]>(() => {
    const kind = this.tipoActivo();
    const usados = new Set(this.reglas().map(r => claveRegla(r)));
    const texto = this.busquedaSujeto().trim().toLowerCase();
    return this.sujetos()[kind]
      .filter(su => !usados.has(`${kind}|${kind === 'ROL' ? su.nombre.toLowerCase() : su.id}`))
      .filter(su => !texto || su.nombre.toLowerCase().includes(texto)
        || (su.detalle ?? '').toLowerCase().includes(texto))
      // Las personas son miles: sin tope la lista tapa el diálogo entero.
      .slice(0, kind === 'USUARIO' ? 12 : 200);
  });

  /** Con muchas opciones el selector obliga a buscar antes de listar. */
  readonly exigeBuscar = computed(() =>
    this.tipoActivo() === 'USUARIO' && this.busquedaSujeto().trim().length < 2);

  claveDe(regla: FormAccessRule): string { return claveRegla(regla); }
  nombreDe(regla: FormAccessRule): string { return nombreRegla(regla); }
  tipoDe(regla: FormAccessRule): SubjectKind { return regla.subject_kind ?? 'ROL'; }

  constructor() {
    this.columnas.set(this.data.columns ?? []);
    this.cargarConfigInicial();
    this.cargarRoles();
    // En edición las columnas vienen del backend, que sabe la versión publicada vigente.
    if (this.data.formId) this.cargarDesdeBackend(this.data.formId);
  }

  private cargarConfigInicial(): void {
    const cfg = this.data.config;
    if (!cfg) return;
    this.porRoles.set(cfg.access_mode === 'ROLES');
    this.procesoActivo.set(cfg.process_enabled);
    this.campoLlave.set(cfg.process_key_field ?? null);
    this.permitirEditarEnviadas.set(cfg.allow_edit_submitted);
    this.reglas.set((cfg.rules ?? []).map(r => ({ ...r })));
  }

  /**
   * Los cuatro catálogos, en paralelo. Cada uno es tolerante a fallo por su cuenta (el
   * servicio los degrada a lista vacía): que no haya grupos configurados todavía no puede
   * impedir dar permisos por rol.
   */
  private cargarRoles(): void {
    forkJoin({
      ROL: this.catalogo.roles(),
      GRUPO: this.catalogo.grupos(),
      SEDE: this.catalogo.sedes(),
      USUARIO: this.catalogo.personas(),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: mapa => {
        this.sujetos.set(mapa);
        this.cargandoRoles.set(false);
        if (mapa.ROL.length === 0) {
          this.error.set('No se pudieron cargar los roles de la plataforma.');
        }
        // Las reglas de rol se emparejan por NOMBRE; se recupera el id para que un
        // renombrado del rol no deje la fila huérfana la próxima vez.
        this.reglas.update(reglas => reglas.map(r => {
          if ((r.subject_kind ?? 'ROL') !== 'ROL' || r.role_id) return r;
          const rol = mapa.ROL.find(x => x.nombre.toLowerCase() === (r.role_name ?? '').toLowerCase());
          return rol ? { ...r, role_id: rol.id, subject_ref: r.subject_ref ?? rol.id } : r;
        }));
      },
      error: () => {
        this.cargandoRoles.set(false);
        this.error.set('No se pudieron cargar los catálogos de permisos.');
      },
    });
  }

  /** En edición manda lo que está guardado, no lo que traía la pantalla que abrió el diálogo. */
  private cargarDesdeBackend(formId: number): void {
    this.svc.accessConfig(formId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: cfg => {
        this.porRoles.set(cfg.access_mode === 'ROLES');
        this.procesoActivo.set(cfg.process_enabled);
        this.campoLlave.set(cfg.process_key_field ?? null);
        this.permitirEditarEnviadas.set(cfg.allow_edit_submitted);
        this.reglas.set((cfg.rules ?? []).map(r => ({ ...r })));
        if (cfg.columns?.length) this.columnas.set(cfg.columns);
      },
      error: (e: HttpErrorResponse) => this.error.set(this.mensaje(e, 'No se pudo leer la configuración guardada.')),
    });
  }

  // ── Reglas ──────────────────────────────────────────────────────────

  agregarSujeto(sujeto: Sujeto): void {
    if (!sujeto) return;
    this.reglas.update(rs => [...rs, reglaVacia(sujeto.nombre, sujeto.id, sujeto.kind)]);
    this.busquedaSujeto.set('');
    // Agregar una regla sin encender la restricción no haría nada: se enciende sola.
    this.porRoles.set(true);
  }

  quitarRegla(clave: string): void {
    this.reglas.update(rs => rs.filter(r => claveRegla(r) !== clave));
    if (this.rolExpandido() === clave) this.rolExpandido.set(null);
  }

  valorCapacidad(regla: FormAccessRule, key: keyof FormAccessRule): boolean {
    return regla[key] === true;
  }

  alternarCapacidad(clave: string, key: keyof FormAccessRule, valor: boolean): void {
    this.reglas.update(rs => rs.map(r => {
      if (claveRegla(r) !== clave) return r;
      const actualizado: FormAccessRule = { ...r, [key]: valor } as FormAccessRule;
      // Coherencias que el backend también aplica; espejarlas aquí evita que la pantalla
      // muestre una combinación que el servidor va a "corregir" por su cuenta.
      if (valor && (key === 'can_edit_responses' || key === 'can_review'
        || key === 'can_process' || key === 'can_bulk_load')) {
        actualizado.can_view_responses = true;
      }
      if (valor && key === 'can_bulk_load') actualizado.can_process = true;
      return actualizado;
    }));
  }

  alternarColumnas(clave: string): void {
    this.rolExpandido.set(this.rolExpandido() === clave ? null : clave);
  }

  /** null = todas las columnas; una lista = solo esas. */
  columnaEditable(regla: FormAccessRule, key: string): boolean {
    return regla.editable_fields == null || regla.editable_fields.includes(key);
  }

  todasLasColumnas(regla: FormAccessRule): boolean {
    return regla.editable_fields == null;
  }

  alternarTodasLasColumnas(clave: string, todas: boolean): void {
    this.reglas.update(rs => rs.map(r => claveRegla(r) === clave
      ? { ...r, editable_fields: todas ? null : [] }
      : r));
  }

  alternarColumna(clave: string, key: string, marcada: boolean): void {
    this.reglas.update(rs => rs.map(r => {
      if (claveRegla(r) !== clave) return r;
      // Pasar de "todas" a una selección concreta arranca de la lista completa: quitar una
      // columna no puede significar perder de golpe todas las demás.
      const base = r.editable_fields ?? this.columnas().map(c => c.key);
      const set = new Set(base);
      if (marcada) set.add(key); else set.delete(key);
      return { ...r, editable_fields: [...set] };
    }));
  }

  resumenColumnas(regla: FormAccessRule): string {
    if (regla.editable_fields == null) return 'todas las columnas';
    const n = regla.editable_fields.length;
    if (n === 0) return 'ninguna columna';
    return n === 1 ? '1 columna' : `${n} columnas`;
  }

  // ── Guardar ─────────────────────────────────────────────────────────

  private construir(): FormAccessConfig {
    return {
      access_mode: this.porRoles() ? 'ROLES' : 'OWNER',
      process_enabled: this.procesoActivo(),
      process_key_field: this.campoLlave() || null,
      allow_edit_submitted: this.permitirEditarEnviadas(),
      rules: this.porRoles() ? this.reglas() : [],
    };
  }

  /**
   * En CREACIÓN se devuelve la configuración al builder, que la manda junto con la
   * estructura (el formulario todavía no existe). En EDICIÓN se guarda de una.
   */
  guardar(): void {
    const cfg = this.construir();
    const formId = this.data.formId;
    if (!formId) {
      this.ref.close(cfg);
      return;
    }
    this.guardando.set(true);
    this.error.set(null);
    this.svc.saveAccess(formId, cfg).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: guardada => {
        this.guardando.set(false);
        this.ref.close(guardada);
      },
      error: (e: HttpErrorResponse) => {
        this.guardando.set(false);
        this.error.set(this.mensaje(e, 'No se pudieron guardar los permisos.'));
      },
    });
  }

  /**
   * Rellena la llave de negocio en los registros que ya existían. Solo tiene sentido en
   * edición y después de guardar; se ofrece aquí porque es donde se elige el campo llave
   * y donde se nota que sin esto un masivo no cruzaría con nada.
   */
  reindexar(): void {
    const formId = this.data.formId;
    if (!formId) return;
    this.guardando.set(true);
    this.svc.reindexKeys(formId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: r => {
        this.guardando.set(false);
        this.error.set(null);
        this.aviso.set(`Llave actualizada en ${r.updated} registro(s).`);
      },
      error: (e: HttpErrorResponse) => {
        this.guardando.set(false);
        this.error.set(this.mensaje(e, 'No se pudo reindexar la llave.'));
      },
    });
  }

  readonly aviso = signal<string | null>(null);

  cerrar(): void {
    this.ref.close();
  }

  private mensaje(e: HttpErrorResponse, porDefecto: string): string {
    const p = e?.error as ApiProblem | undefined;
    return p?.detail || p?.title || porDefecto;
  }
}
