import { ChangeDetectionStrategy, Component, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { CdkDrag, CdkDragDrop, CdkDropList, CdkDropListGroup, moveItemInArray } from '@angular/cdk/drag-drop';
import { MatStepper, MatStepperModule } from '@angular/material/stepper';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { OfficeFormsService } from '../../services/office-forms.service';
import { PhonePreviewComponent } from '../../components/phone-preview/phone-preview.component';
import {
  FieldType, FormFieldDef, OfficeImportedForm, PALETTE, PaletteItem, PublishResult, RoleAccess,
  Visibility, defaultFieldLabel,
} from '../../models/office-forms.models';
import { OfficeExcelImportDialogComponent } from '../../components/excel-import-dialog/excel-import-dialog.component';

/**
 * Constructor de formularios: wizard de 3 pasos (Datos y visibilidad / Campos / Publicar)
 * con paleta drag-drop, editor de campo y preview de teléfono en vivo.
 */
@Component({
  selector: 'app-form-builder',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, ReactiveFormsModule, MatStepperModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatIconModule, MatSelectModule, MatCheckboxModule, MatTooltipModule,
    CdkDropListGroup, CdkDropList, CdkDrag, PhonePreviewComponent, OfficeExcelImportDialogComponent,
  ],
  templateUrl: './form-builder.component.html',
  styleUrl: './form-builder.component.css',
})
export class FormBuilderComponent implements OnInit {
  private fb = inject(FormBuilder);
  private api = inject(OfficeFormsService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private snack = inject(MatSnackBar);

  @ViewChild('stepper') stepper?: MatStepper;

  palette = PALETTE;

  meta = this.fb.group({
    title: ['', Validators.required],
    description: [''],
    parent_module: [''],
    visibility: ['PRIVATE' as Visibility],
  });

  fields = signal<FormFieldDef[]>([]);
  selectedIndex = signal<number | null>(null);
  formId = signal<number | null>(null);
  offices = signal<{ id: string; label: string }[]>([]);
  selectedOffices = signal<string[]>([]);
  saving = signal(false);
  publishing = signal(false);
  publishResult = signal<PublishResult | null>(null);

  /** Carga por Excel: plantilla ya parametrizada + archivo lleno. */
  importarAbierto = signal(false);
  /**
   * Accesos por rol que venían en el Excel. El constructor no tiene pantalla de roles,
   * así que se guardan aquí y se aplican junto con los campos y las oficinas — si no,
   * el «a quién se le presta» que se definió al bajar la plantilla se perdería al crear.
   */
  private accesosImportados = signal<RoleAccess[]>([]);

  // Espejos reactivos para el preview en vivo.
  titlePreview = signal('');
  descPreview = signal('');
  visibilityPreview = signal<Visibility>('PRIVATE');

  selected = computed(() => {
    const i = this.selectedIndex();
    return i == null ? null : (this.fields()[i] ?? null);
  });

  ngOnInit(): void {
    this.titlePreview.set(this.meta.controls.title.value || '');
    this.meta.controls.title.valueChanges.pipe(takeUntilDestroyed()).subscribe(v => this.titlePreview.set(v || ''));
    this.meta.controls.description.valueChanges.pipe(takeUntilDestroyed()).subscribe(v => this.descPreview.set(v || ''));
    this.meta.controls.visibility.valueChanges.pipe(takeUntilDestroyed()).subscribe(v => this.visibilityPreview.set((v as Visibility) || 'PRIVATE'));

    this.loadOffices();

    const idParam = this.route.snapshot.paramMap.get('id');
    if (idParam) {
      this.loadForm(Number(idParam));
      return;
    }
    // El dashboard pudo dejar un formulario leído de un Excel: se entra con todo cargado.
    const importado = this.api.tomarPendiente();
    if (importado) this.aplicarImportado(importado);
  }

  // ---------- Carga por Excel ----------

  /**
   * Vuelca en el constructor un formulario leído de un Excel: datos, visibilidad, campos,
   * oficinas y accesos. Es exactamente lo que se habría armado a mano y NADA se ha
   * guardado todavía: el alta ocurre al avanzar por los pasos, como siempre.
   */
  aplicarImportado(f: OfficeImportedForm): void {
    this.meta.patchValue({
      title: f.title ?? '',
      description: f.description ?? '',
      parent_module: f.parent_module ?? '',
      visibility: (f.visibility ?? 'PRIVATE') as Visibility,
    });
    this.fields.set(this.reindex(f.fields ?? []));
    this.selectedOffices.set(f.office_ids ?? []);
    this.accesosImportados.set(accesosDe(f));
    this.selectedIndex.set(null);
    this.importarAbierto.set(false);
    this.snack.open(
      `Archivo cargado: ${f.fields_count} pregunta(s). Revísalas y continúa cuando estés listo.`,
      'OK', { duration: 6000 });
  }

  // ---------- Carga ----------

  private loadOffices(): void {
    this.api.sedes().subscribe({
      next: (res) => {
        const arr: any[] = Array.isArray(res) ? res : (res?.results ?? res?.data ?? []);
        this.offices.set(arr.map((s: any) => ({
          id: String(s.id ?? s.sede_id ?? s.uuid ?? s.codigo ?? ''),
          label: String(s.nombre ?? s.name ?? s.sede ?? s.descripcion ?? s.id ?? ''),
        })).filter(o => o.id));
      },
      error: () => this.offices.set([]),
    });
  }

  private loadForm(id: number): void {
    this.api.get(id).subscribe({
      next: (f) => {
        this.formId.set(f.id ?? id);
        this.meta.patchValue({
          title: f.title ?? '',
          description: f.description ?? '',
          parent_module: f.parent_module ?? '',
          visibility: f.visibility ?? 'PRIVATE',
        });
        this.fields.set((f.fields ?? []).map((x, i) => ({ ...x, position: i })));
        this.selectedOffices.set(f.office_ids ?? []);
      },
      error: () => this.snack.open('No se pudo cargar el formulario', 'OK', { duration: 3000 }),
    });
  }

  // ---------- Paso 1: datos y visibilidad ----------

  setVisibility(v: Visibility): void {
    this.meta.controls.visibility.setValue(v);
  }

  nextFromMeta(): void {
    if (this.meta.controls.title.invalid) {
      this.meta.controls.title.markAsTouched();
      this.snack.open('El título es obligatorio', 'OK', { duration: 2500 });
      return;
    }
    this.saving.set(true);
    const body = {
      title: this.meta.controls.title.value!,
      description: this.meta.controls.description.value || null,
      parent_module: this.meta.controls.parent_module.value || null,
      visibility: this.meta.controls.visibility.value || 'PRIVATE',
    };
    const id = this.formId();
    const req = id ? this.api.update(id, body) : this.api.create(body);
    req.subscribe({
      next: (f) => {
        this.saving.set(false);
        this.formId.set(f.id ?? id);
        this.stepper?.next();
      },
      error: () => { this.saving.set(false); this.snack.open('No se pudo guardar', 'OK', { duration: 3000 }); },
    });
  }

  // ---------- Paso 2: campos ----------

  drop(event: CdkDragDrop<any>): void {
    if (event.previousContainer === event.container) {
      const arr = [...this.fields()];
      moveItemInArray(arr, event.previousIndex, event.currentIndex);
      this.fields.set(this.reindex(arr));
      this.selectedIndex.set(event.currentIndex);
    } else {
      const item = event.item.data as PaletteItem;
      if (!item) return;
      if (!item.enabled) {
        this.snack.open(`"${item.label}" se habilita en una fase siguiente`, 'OK', { duration: 2500 });
        return;
      }
      const arr = [...this.fields()];
      arr.splice(event.currentIndex, 0, this.newField(item.type));
      this.fields.set(this.reindex(arr));
      this.selectedIndex.set(event.currentIndex);
    }
  }

  addFromPalette(item: PaletteItem): void {
    if (!item.enabled) { this.snack.open(`"${item.label}" se habilita en una fase siguiente`, 'OK', { duration: 2500 }); return; }
    const arr = this.reindex([...this.fields(), this.newField(item.type)]);
    this.fields.set(arr);
    this.selectedIndex.set(arr.length - 1);
  }

  private newField(type: FieldType): FormFieldDef {
    const needsOptions = type === 'seleccion_unica';
    return {
      field_type: type,
      label: defaultFieldLabel(type),
      help_text: null,
      placeholder: null,
      position: 0,
      required: false,
      config_json: needsOptions ? { options: [{ value: 'op1', label: 'Opción 1' }] } : null,
    };
  }

  private reindex(arr: FormFieldDef[]): FormFieldDef[] {
    return arr.map((f, i) => ({ ...f, position: i }));
  }

  selectField(i: number): void { this.selectedIndex.set(i); }

  removeField(i: number, ev?: Event): void {
    ev?.stopPropagation();
    const arr = this.fields().filter((_, idx) => idx !== i);
    this.fields.set(this.reindex(arr));
    this.selectedIndex.set(null);
  }

  patch(key: keyof FormFieldDef, value: any): void {
    const i = this.selectedIndex();
    if (i == null) return;
    const arr = [...this.fields()];
    arr[i] = { ...arr[i], [key]: value };
    this.fields.set(arr);
  }

  patchConfig(patch: Record<string, any>): void {
    const i = this.selectedIndex();
    if (i == null) return;
    const arr = [...this.fields()];
    arr[i] = { ...arr[i], config_json: { ...(arr[i].config_json ?? {}), ...patch } };
    this.fields.set(arr);
  }

  addOption(): void {
    const f = this.selected();
    if (!f) return;
    const opts = [...(f.config_json?.options ?? [])];
    opts.push({ value: 'op' + (opts.length + 1), label: 'Opción ' + (opts.length + 1) });
    this.patchConfig({ options: opts });
  }

  updateOption(idx: number, label: string): void {
    const f = this.selected();
    if (!f) return;
    const opts = [...(f.config_json?.options ?? [])];
    opts[idx] = { value: opts[idx]?.value || 'op' + (idx + 1), label };
    this.patchConfig({ options: opts });
  }

  removeOption(idx: number): void {
    const f = this.selected();
    if (!f) return;
    const opts = (f.config_json?.options ?? []).filter((_, i) => i !== idx);
    this.patchConfig({ options: opts });
  }

  toggleOffice(id: string, checked: boolean): void {
    const set = new Set(this.selectedOffices());
    if (checked) set.add(id); else set.delete(id);
    this.selectedOffices.set([...set]);
  }

  isOfficeSelected(id: string): boolean {
    return this.selectedOffices().includes(id);
  }

  nextFromFields(): void {
    if (!this.fields().length) {
      this.snack.open('Agrega al menos un campo', 'OK', { duration: 2500 });
      return;
    }
    this.persistFields(() => this.stepper?.next());
  }

  private persistFields(done: () => void): void {
    const id = this.formId();
    if (!id) { done(); return; }
    this.saving.set(true);
    this.api.setFields(id, this.fields()).subscribe({
      next: () => {
        this.api.setOffices(id, this.selectedOffices()).subscribe({
          next: () => this.persistAccess(id, done),
          // Que falle la asignación de oficinas no debe dejar los campos sin guardar.
          error: () => this.persistAccess(id, done),
        });
      },
      error: () => { this.saving.set(false); this.snack.open('No se pudieron guardar los campos', 'OK', { duration: 3000 }); },
    });
  }

  /** Accesos por rol que trajo el Excel (si los hubo). Se aplican una sola vez. */
  private persistAccess(id: number, done: () => void): void {
    const accesos = this.accesosImportados();
    if (!accesos.length) { this.saving.set(false); done(); return; }
    this.api.setAccess(id, accesos).subscribe({
      next: () => { this.accesosImportados.set([]); this.saving.set(false); done(); },
      error: () => {
        this.saving.set(false);
        this.snack.open('No se pudieron aplicar los permisos por rol del archivo.', 'OK', { duration: 5000 });
        done();
      },
    });
  }

  // ---------- Paso 3: publicar ----------

  publish(): void {
    const id = this.formId();
    if (!id) return;
    this.publishing.set(true);
    this.persistFields(() => {
      this.api.publish(id).subscribe({
        next: (r) => {
          this.publishing.set(false);
          this.publishResult.set(r);
          this.snack.open('Formulario publicado', 'OK', { duration: 3000 });
        },
        error: () => { this.publishing.set(false); this.snack.open('No se pudo publicar', 'OK', { duration: 3000 }); },
      });
    });
  }

  copyLink(): void {
    const url = this.publishResult()?.public_url;
    if (url && navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => this.snack.open('Enlace copiado', 'OK', { duration: 2000 }));
    }
  }

  goToDashboard(): void {
    this.router.navigate(['/dashboard/office-management']);
  }

  // ---------- helpers de plantilla ----------

  iconFor(type: FieldType): string {
    return PALETTE.find(p => p.type === type)?.icon ?? 'help_outline';
  }
}

/** Accesos por rol a partir de las dos listas del archivo (ver / responder). */
function accesosDe(f: OfficeImportedForm): RoleAccess[] {
  const ven = new Set((f.view_roles ?? []).map(r => r.id));
  const responden = new Set((f.respond_roles ?? []).map(r => r.id));
  return [...new Set<string>([...ven, ...responden])].map(id => ({
    role_id: id,
    // Quien responde necesita ver el formulario para llenarlo.
    can_view: ven.has(id) || responden.has(id),
    can_respond: responden.has(id),
  }));
}
