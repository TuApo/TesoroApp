import {  Component, Inject, OnDestroy , ChangeDetectionStrategy } from '@angular/core';

import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';

import { Subscription } from 'rxjs';

import { ChangeDetectorRef } from '@angular/core';

import { ColumnaTabla, TABLA_ESTANDAR } from '../tabla-estandar';

import {
  PreviewDialogData,
  PreviewDialogResult,
  PreviewIssue,
  PreviewSchema,
  PreviewField,
  PreviewOption,
  ServerValidateResult,
} from './../../model/validation-preview';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-validation-preview-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatDividerModule,
    MatIconModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatChipsModule,
    MatTooltipModule,
    ...TABLA_ESTANDAR,
],
  templateUrl: './validation-preview-dialog.component.html',
  styleUrl: './validation-preview-dialog.component.css',
} )
export class ValidationPreviewDialogComponent<TItem = any, TResult = any>
  implements OnDestroy {
  // base
  schema: PreviewSchema<TItem, TResult>;
  items: TItem[];

  // UI state
  selected: TItem | null = null;
  selectedId = '';

  form!: FormGroup;
  issues: PreviewIssue[] = [];

  // filtro de negocio "solo errores"; la búsqueda por texto la hace la tabla estándar
  showErrorsOnly = false;

  /**
   * Filas que ve la tabla (sin las quitadas y, si aplica, solo las que tienen
   * issues). Se reasigna con un arreglo NUEVO en cada cambio: la tabla estándar
   * recibe señales y no se entera de mutaciones en sitio.
   */
  filas: TItem[] = [];
  /** Columna de estado + las columnas que define el schema de quien abre el diálogo. */
  readonly columnas: ColumnaTabla<TItem>[];
  readonly idFila = (item: TItem) => this.schema.itemId(item);
  /** Resalta la fila que se está editando en el panel derecho. */
  readonly claseFila = (item: TItem) =>
    this.schema.itemId(item) === this.selectedId ? 'te-fila--destacada' : '';

  /** Resumen por tipo: cuando es true, solo lista categorías de error. */
  summaryErrorsOnly = false;

  private removedIds = new Set<string>();

  // 2 fases
  phase: 'pre' | 'post' = 'pre';
  externalIssues: PreviewIssue[] = [];
  private resolvedExternalIssueIds = new Set<string>();

  // summary (para no usar arrow functions en template)
  totalErrors = 0;
  totalWarns = 0;

  // estado del flujo iterativo de "Confirmar Todo" contra servidor
  private serverValidate?: (items: TItem[]) => Promise<ServerValidateResult>;
  submitting = false;
  private lastServerResult: unknown = undefined;

  // header texts (sin casts en template)
  titleText = 'Previsualización de validación';
  subtitleText = 'Corrige los datos aquí antes de continuar.';

  private formSub?: Subscription;

  constructor(
    private readonly fb: FormBuilder,
    private readonly ref: MatDialogRef<
      ValidationPreviewDialogComponent<TItem, TResult>,
      PreviewDialogResult<TResult>
    >,
    private readonly cdr: ChangeDetectorRef,
    @Inject(MAT_DIALOG_DATA) data: PreviewDialogData<TItem, TResult>,
  ) {
    this.serverValidate = data.serverValidate;
    this.schema = data.schema;
    this.items = [...(data.items ?? [])];

    this.phase = data.phase ?? 'pre';
    this.externalIssues = [...(data.externalIssues ?? [])];
    this.summaryErrorsOnly = data.summaryErrorsOnly ?? false;

    // prioridad: overrides del diálogo > schema > defaults
    this.titleText = data.title ?? this.schema.title ?? this.titleText;
    this.subtitleText = data.subtitle ?? this.schema.subtitle ?? this.subtitleText;

    this.uploadHandler = data.uploadHandler;

    this.columnas = [
      { id: '__status', header: 'Est.', valor: (it) => this.estadoFila(it), align: 'center',
        tarjeta: 'badge', ancho: '56px' },
      ...this.schema.columns.map((c, i): ColumnaTabla<TItem> => ({
        id: c.key,
        header: c.header,
        valor: (it) => c.cell(it),
        minAncho: c.width,
        tarjeta: i === 0 ? 'titulo' : i === 1 ? 'subtitulo' : 'meta',
      })),
    ];

    this.recomputeIssues();

    // Prioridad: Seleccionar el primer registro con errores o issues externos
    const firstInvalid = this.items.find(it => {
      const id = this.schema.itemId(it);
      return this.issues.some(iss => iss.itemId === id && (iss.severity === 'error' || iss.severity === 'warn'));
    });

    const first = firstInvalid ?? this.filteredItems()[0] ?? null;
    if (first) this.select(first);

    // UX Improvement: If there are blocking errors, filter by errors automatically so the user sees them.
    if (this.totalErrors > 0) {
      this.showErrorsOnly = true;
      this.refrescarFilas();
    }
  }

  ngOnDestroy(): void {
    this.formSub?.unsubscribe();
  }

  get globalIssues(): PreviewIssue[] {
    return this.issues.filter((x) => x.itemId === 'GLOBAL' || x.itemId === 'general');
  }

  // ----------------------------
  // Table helpers
  // ----------------------------

  filteredItems(): TItem[] {
    // Base filter: not removed
    let items = this.items.filter((it) => !this.removedIds.has(this.schema.itemId(it)));

    // Error filter
    if (this.showErrorsOnly) {
      items = items.filter(it => this.issueCount(it) > 0 || this.warnCount(it) > 0);
    }

    return items;
  }

  /** Recalcula las filas de la tabla con un arreglo nuevo (ver `filas`). */
  private refrescarFilas(): void {
    this.filas = this.filteredItems();
  }

  toggleErrorsOnly(): void {
    this.showErrorsOnly = !this.showErrorsOnly;
    this.refrescarFilas();
  }

  /** Valor plano de la columna de estado: filtra, ordena y se copia. */
  estadoFila(item: TItem): string {
    if (this.issueCount(item) > 0) return 'Error';
    if (this.warnCount(item) > 0) return 'Advertencia';
    return 'Correcto';
  }

  get filteredCount(): number {
    return this.filteredItems().length;
  }

  get externalCount(): number {
    return this.externalIssues.length;
  }

  issueCount(item: TItem): number {
    const id = this.schema.itemId(item);
    return this.issues.filter((x) => x.itemId === id && x.severity === 'error').length;
  }

  warnCount(item: TItem): number {
    const id = this.schema.itemId(item);
    return this.issues.filter((x) => x.itemId === id && x.severity === 'warn').length;
  }

  anyBlockingErrors(): boolean {
    return this.totalErrors > 0;
  }

  // Flujo iterativo: ¿hay al menos una fila enviable al servidor?
  hasSubmittableItems(): boolean {
    return this.items.some(
      (it) =>
        !this.removedIds.has(this.schema.itemId(it)) && this.issueCount(it) === 0,
    );
  }

  // Habilita "Confirmar Todo". En modo serverValidate alcanza con que UNA fila
  // pase la validación cliente: el server se encarga del resto y las rechazadas
  // vuelven con su motivo para que el usuario las corrija.
  get canSubmit(): boolean {
    if (this.submitting) return false;
    if (this.serverValidate) return this.hasSubmittableItems();
    return !this.anyBlockingErrors();
  }

  severityIcon(sev: string): string {
    if (sev === 'error') return 'error';
    if (sev === 'warn') return 'warning';
    return 'info';
  }

  // ----------------------------
  // Resumen por tipo de issue (opt-in)
  // ----------------------------

  /** ¿Algún issue trae `category`? Si no, el panel de resumen por tipo se oculta.
   *  Con summaryErrorsOnly solo cuentan las categorías de error. */
  hasIssueTypeSummary(): boolean {
    return this.issues.some(
      (i) => !!i.category && (!this.summaryErrorsOnly || i.severity === 'error'),
    );
  }

  /**
   * Agrupa los issues con `category` por (severidad, categoría) y cuenta FILAS
   * distintas afectadas (no issues), para mostrar "12 · Sin equivalencia CECO".
   * Errores primero, luego advertencias; dentro de cada grupo, mayor conteo arriba.
   */
  issueTypeSummary(): { severity: 'error' | 'warn'; category: string; count: number }[] {
    const groups = new Map<string, { severity: 'error' | 'warn'; category: string; rows: Set<string> }>();
    for (const iss of this.issues) {
      if (!iss.category) continue;
      if (iss.severity !== 'error' && iss.severity !== 'warn') continue;
      if (this.summaryErrorsOnly && iss.severity !== 'error') continue;
      const key = `${iss.severity}|${iss.category}`;
      let g = groups.get(key);
      if (!g) {
        g = { severity: iss.severity, category: iss.category, rows: new Set<string>() };
        groups.set(key, g);
      }
      g.rows.add(iss.itemId);
    }
    return [...groups.values()]
      .map((g) => ({ severity: g.severity, category: g.category, count: g.rows.size }))
      .sort((a, b) =>
        a.severity === b.severity ? b.count - a.count : a.severity === 'error' ? -1 : 1,
      );
  }

  // ----------------------------
  // Selection + form
  // ----------------------------

  select(item: TItem): void {
    this.selected = item;
    this.selectedId = this.schema.itemId(item);
    this.buildForm(item);
  }

  private buildForm(item: TItem): void {
    // evitar subs acumuladas
    this.formSub?.unsubscribe();

    const group: Record<string, FormControl> = {};

    for (const f of this.schema.editFields) {
      const visible = f.visible ? f.visible(item) : true;
      if (!visible) continue;

      const raw = (item as any)[f.key];

      const validatorsArr = [];
      if (f.required) validatorsArr.push(Validators.required);

      const ctrl = new FormControl(raw, validatorsArr);

      // disabled dinámico (si aplica)
      const disabled = f.disabled ? f.disabled(item) : false;
      if (disabled) ctrl.disable({ emitEvent: false });

      group[f.key] = ctrl;
    }

    this.form = this.fb.group(group);

    // Live update in-memory + recalcular issues. Solo procesamos los campos
    // que realmente cambiaron — disparar onChange para todos en cada keystroke
    // causa efectos colaterales (p.ej. markFkOptimistic marcando FKs no tocadas
    // como resueltas y enmascarando errores reales).
    this.formSub = this.form.valueChanges.subscribe(() => {
      if (!this.selected) return;

      let changed = false;
      for (const f of this.schema.editFields) {
        const visible = f.visible ? f.visible(this.selected) : true;
        if (!visible) continue;

        const ctrl = this.form.get(f.key);
        if (!ctrl) continue;

        const v = ctrl.value;
        const nv = f.normalize ? f.normalize(v, this.selected) : v;
        const old = (this.selected as any)[f.key];
        if (old === nv) continue;

        (this.selected as any)[f.key] = nv;
        if (f.onChange) f.onChange(this.selected);

        // si llegó del backend y tocaste el campo, lo marcamos como resuelto
        this.resolveExternalIssuesForField(this.selectedId, f.key);
        changed = true;
      }

      if (changed) {
        this.recomputeIssues();
        this.cdr.markForCheck();
      }
    });
  }

  showAllFields = false;

  fieldError(fieldKey: string): string | null {
    if (!this.selected) return null;

    const itemId = this.schema.itemId(this.selected);
    const issue = this.issues.find(
      (x) => x.itemId === itemId && x.field === fieldKey && x.severity === 'error',
    );

    return issue ? issue.message : null;
  }

  shouldShowField(f: PreviewField<any>): boolean {
    if (this.showAllFields) return true;

    // Si hay error en el campo, mostrarlo
    if (this.fieldError(f.key)) return true;

    // Si el item NO tiene ningún error, mostramos todo (para revisión)
    // O si preferimos, solo mostramos si hay error.
    // El usuario dijo: "solo los campos que tengo que corregir".
    // Pero si corregimos uno, y queda valido, desaparece? 
    // Vamos a permitir que si el item es valido (sin errores bloqueantes), mostremos todo.
    if (this.selected && !this.anyBlockingErrorsForSelected()) return true;

    return false;
  }

  anyBlockingErrorsForSelected(): boolean {
    if (!this.selected) return false;
    return this.issueCount(this.selected) > 0;
  }

  toggleShowAll(): void {
    this.showAllFields = !this.showAllFields;
  }

  applyEdits(): void {
    if (!this.selected || !this.form) return;

    for (const f of this.schema.editFields) {
      const visible = f.visible ? f.visible(this.selected) : true;
      if (!visible) continue;

      const ctrl = this.form.get(f.key);
      if (!ctrl) continue;

      const v = ctrl.value;
      const nv = f.normalize ? f.normalize(v, this.selected) : v;

      (this.selected as any)[f.key] = nv;
      if (f.onChange) f.onChange(this.selected);

      this.resolveExternalIssuesForField(this.selectedId, f.key);
    }

    this.recomputeIssues();
    this.cdr.markForCheck();
  }

  removeSelected(): void {
    if (!this.schema.allowRemove || !this.selected) return;

    const id = this.schema.itemId(this.selected);
    this.removedIds.add(id);

    this.selected = null;
    this.selectedId = '';

    this.recomputeIssues();

    // Si al quitar la fila ya no queda NINGUNA pendiente, terminamos el diálogo.
    // Sin esto quedaba colgado con la tabla vacía y "Confirmar" deshabilitado,
    // sin forma de cerrar el flujo (las filas confirmadas antes ya se importaron).
    if (this.finishWhenEmpty()) return;

    const next = this.filteredItems()[0] ?? null;
    if (next) this.select(next);
    this.cdr.markForCheck();
  }

  /**
   * Si ya no quedan filas pendientes (todas confirmadas o quitadas), cierra el
   * diálogo. Con resultado del servidor si hubo importaciones previas; si no se
   * importó nada (solo se quitaron filas) cierra como cancelado para no mostrar
   * una pantalla de "éxito" engañosa. Devuelve true si cerró.
   */
  private finishWhenEmpty(): boolean {
    const pending = this.items.filter(
      (it) => !this.removedIds.has(this.schema.itemId(it)),
    );
    if (pending.length > 0) return false;
    this.submitting = false;
    this.cdr.markForCheck();
    if (this.lastServerResult !== undefined) {
      this.ref.close({ accepted: true, result: this.lastServerResult as TResult, items: [] });
    } else {
      this.ref.close({ accepted: false });
    }
    return true;
  }

  // ----------------------------
  // Issues helpers (para template sin arrow fn)
  // ----------------------------

  selectedIssues(): PreviewIssue[] {
    if (!this.selectedId) return [];
    return this.issues.filter((i) => i.itemId === this.selectedId);
  }

  hasSelectedIssues(): boolean {
    return this.selectedIssues().length > 0;
  }

  // form helpers (template limpio)
  fieldLabel(f: PreviewField<any>): string {
    return f.label || f.key;
  }

  fieldPlaceholder(f: PreviewField<any>): string {
    return f.placeholder ?? '';
  }

  fieldHint(f: PreviewField<any>): string {
    return f.hint ?? '';
  }

  isSelectField(f: PreviewField<any>): boolean {
    return f.type === 'select';
  }

  inputTypeFor(f: PreviewField<any>): string {
    return f.type === 'number' ? 'number' : 'text';
  }

  optionsFor(f: PreviewField<any>): PreviewOption<any>[] {
    return (f.options ?? []) as PreviewOption<any>[];
  }

  // ----------------------------
  // External issues resolution (POST)
  // ----------------------------

  private resolveExternalIssuesForField(itemId: string, fieldKey: string): void {
    for (const iss of this.externalIssues) {
      if (iss.itemId !== itemId) continue;
      // Limpiamos el error externo (del servidor) cuando el usuario toca su campo
      // asociado, O cuando es un rechazo de fila COMPLETA sin `field` (p. ej.
      // "Servidor rechazó la fila: …"): al editar cualquier campo de esa fila el
      // veredicto previo del servidor queda obsoleto y debe re-validarse en el
      // próximo envío. Sin esto, un rechazo sin `field` se quedaba pegado y dejaba
      // la fila siempre en error → "Confirmar" deshabilitado de forma permanente.
      if (iss.field === fieldKey || !iss.field) {
        this.resolvedExternalIssueIds.add(iss.id);
      }
    }
  }

  // ----------------------------
  // Issues aggregation
  // ----------------------------

  private recomputeIssues(): void {
    const activeItems = this.items.filter((it) => !this.removedIds.has(this.schema.itemId(it)));

    // issues por item (schema.validateItem)
    const base = activeItems.flatMap((it) => this.schema.validateItem(it));

    // issues por field.validate
    const fieldIssues: PreviewIssue[] = [];
    for (const it of activeItems) {
      const itemId = this.schema.itemId(it);

      for (const f of this.schema.editFields) {
        const visible = f.visible ? f.visible(it) : true;
        if (!visible) continue;

        if (!f.validate) continue;

        const v = (it as any)[f.key];
        const msg = f.validate(v, it);
        if (!msg) continue;

        fieldIssues.push({
          id: `field:${itemId}:${f.key}`,
          itemId,
          severity: 'error',
          field: f.key,
          message: msg,
        });
      }
    }

    // issues cruzados
    const cross = this.schema.validateAll ? this.schema.validateAll(activeItems) : [];

    // issues externos (backend) filtrados por resueltos
    const external = this.externalIssues.filter((x) => !this.resolvedExternalIssueIds.has(x.id));

    this.issues = [...base, ...fieldIssues, ...cross, ...external];

    // summary para template
    this.totalErrors = this.issues.filter((i) => i.severity === 'error').length;
    this.totalWarns = this.issues.filter((i) => i.severity === 'warn').length;

    // Si ya no hay errores, apagamos el filtro "solo errores": de lo contrario la
    // tabla se queda vacía ("No se encontraron registros") ocultando las filas
    // correctas y el operador no encuentra qué confirmar.
    if (this.totalErrors === 0) this.showErrorsOnly = false;

    this.refrescarFilas();
  }

  // ----------------------------
  // Dialog actions
  // ----------------------------

  cancel(): void {
    if (this.schema.allowCancel === false) return;
    this.ref.close({ accepted: false });
  }

  accept(): void {
    this.applyEdits();
    if (this.submitting) return;

    const activeItems = this.items.filter(
      (it) => !this.removedIds.has(this.schema.itemId(it)),
    );

    // Flujo iterativo contra servidor: enviamos SOLO las filas sin errores
    // cliente. Las filas con errores se quedan en el diálogo para que el
    // usuario las siga corrigiendo. El dialog cierra cuando ya no queda
    // ninguna pendiente.
    if (this.serverValidate) {
      const submittable = activeItems.filter((it) => this.issueCount(it) === 0);
      if (submittable.length === 0) return;
      void this.submitToServer(submittable);
      return;
    }

    // Flujo clásico: gateamos el submit completo.
    if (this.anyBlockingErrors()) return;
    const result = this.schema.buildResult(activeItems);
    this.ref.close({ accepted: true, result, items: activeItems });
  }

  private async submitToServer(itemsToSend: TItem[]): Promise<void> {
    if (!this.serverValidate) return;

    this.submitting = true;
    this.cdr.markForCheck();

    let resp: ServerValidateResult;
    try {
      resp = await this.serverValidate(itemsToSend);
    } catch (e) {
      this.submitting = false;
      this.cdr.markForCheck();
      // No marcamos issues por fila (el server no respondió estructurado): el
      // llamador maneja el error global via toast/snackbar. El dialog queda
      // abierto para reintentar.
      console.error('serverValidate falló', e);
      return;
    }

    // Acumular resultado del servidor por si todo termina OK.
    this.lastServerResult = resp.serverResult;

    // Quitar de la lista las filas que el servidor aceptó.
    for (const id of resp.acceptedItemIds ?? []) {
      this.removedIds.add(id);
    }

    // Limpiar errores externos previos (de intentos anteriores) y empujar los
    // nuevos del servidor. Los marcamos como resueltos si el itemId quedó
    // aceptado (defensa por si el server devolviera ambos por error).
    this.externalIssues = (resp.errors ?? []).filter(
      (iss) => !this.removedIds.has(iss.itemId),
    );
    this.resolvedExternalIssueIds.clear();

    this.recomputeIssues();

    // Si ya no quedan items pendientes, cerrar el dialog.
    const pending = this.items.filter((it) => !this.removedIds.has(this.schema.itemId(it)));
    if (pending.length === 0) {
      this.submitting = false;
      this.cdr.markForCheck();
      this.ref.close({
        accepted: true,
        result: this.lastServerResult as TResult,
        items: [],
      });
      return;
    }

    // Re-seleccionar primera fila con error para que el usuario continúe.
    const nextInvalid =
      pending.find((it) => this.issueCount(it) > 0) ?? pending[0] ?? null;
    if (nextInvalid) this.select(nextInvalid);

    this.submitting = false;
    this.cdr.markForCheck();
  }

  // ----------------------------
  // Resolution Actions (Upload, etc.)
  // ----------------------------

  private uploadHandler?: (file: File, itemId: string) => Promise<void> | void;
  private pendingUploadIssue: PreviewIssue | null = null;

  triggerUpload(issue: PreviewIssue, inputRef: HTMLInputElement): void {
    if (!this.uploadHandler) return;
    this.pendingUploadIssue = issue;
    inputRef.value = ''; // reset
    inputRef.click();
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0 || !this.pendingUploadIssue) return;

    const file = input.files[0];
    const itemId = this.pendingUploadIssue.itemId;

    try {
      if (this.uploadHandler) {
        await this.uploadHandler(file, itemId);
      }
      // Re-run validations
      this.recomputeIssues();
    } catch (err) {
      console.error('Error uploading file from preview:', err);
    } finally {
      this.pendingUploadIssue = null;
    }
  }
}