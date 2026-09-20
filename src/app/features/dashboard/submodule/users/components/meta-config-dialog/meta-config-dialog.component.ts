// src/app/features/dashboard/submodule/users/components/meta-config-dialog/meta-config-dialog.component.ts
import {  Component, Inject, OnInit, signal, computed, inject, ChangeDetectorRef , ChangeDetectionStrategy } from '@angular/core';
import { CommonModule, formatDate } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup, FormControl } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';

import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';

import {
  GestionParametrizacionService,
  MetaCampo,
  MetaValor,
  CampoTipo,
  MetaTabla
} from '../../services/gestion-parametrizacion/gestion-parametrizacion.service';

export type DialogMode = 'campos' | 'valores';

export interface MetaConfigDialogData {
  mode: DialogMode;
  tabla?: MetaTabla;
  tablaCodigo?: string;
  tablaId?: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-meta-config-dialog',
  standalone: true,
  templateUrl: './meta-config-dialog.component.html',
  styleUrls: ['./meta-config-dialog.component.css'],
  imports: [
    CommonModule, MatDialogModule, MatButtonModule, MatIconModule,
    MatTooltipModule, MatMenuModule, ReactiveFormsModule, MatFormFieldModule,
    MatInputModule, MatCheckboxModule, MatSelectModule, MatSnackBarModule,
    MatDatepickerModule, MatNativeDateModule, ...TABLA_ESTANDAR
  ]
} )
export class MetaConfigDialogComponent implements OnInit {
  // cabecera
  mode = signal<DialogMode>('campos');
  tablaCodigo = signal<string>('');
  tablaId = signal<string | null>(null);

  private svc = inject(GestionParametrizacionService);
  private fb = inject(FormBuilder);
  private snack = inject(MatSnackBar);
  private cdr = inject(ChangeDetectorRef);

  // token anti-carrera
  private reqToken = 0;

  // listas / estado
  campos = signal<MetaCampo[]>([]);
  valores = signal<MetaValor[]>([]);
  loading = signal<boolean>(false);

  readonly columnasCampos: ColumnaTabla<MetaCampo>[] = [
    { id: 'campo', header: 'Campo', valor: (r) => r.campo, tarjeta: 'titulo' },
    { id: 'tipo', header: 'Tipo', valor: (r) => r.tipo, tarjeta: 'subtitulo' },
    { id: 'obligatorio', header: 'Oblig.', valor: (r) => !!r.obligatorio },
    { id: 'visible', header: 'Visible', valor: (r) => !!r.visible },
    { id: 'orden', header: 'Orden', valor: (r) => r.orden, align: 'right' },
  ];
  readonly idCampo = (r: MetaCampo) => r.id;
  readonly idValor = (r: MetaValor) => r.id;
  campoTipos: CampoTipo[] = ['STRING', 'NUMBER', 'BOOLEAN', 'DATE', 'JSON', 'ENUM'];

  // forms
  formCampo!: FormGroup;
  formValor!: FormGroup;

  // edición en curso
  editingCampo = signal<MetaCampo | null>(null);
  editingValor = signal<MetaValor | null>(null);

  // columnas dinámicas para valores: una por cada MetaCampo visible + fijas.
  // El id lleva prefijo para no chocar con las fijas si un campo se llama igual.
  readonly columnasValores = computed<ColumnaTabla<MetaValor>[]>(() => [
    ...this.camposVisiblesOrdenados.map((c): ColumnaTabla<MetaValor> => ({
      id: 'dato:' + c.campo,
      header: c.campo,
      valor: (r) => {
        const v = r.datos?.[c.campo];
        if (c.tipo === 'BOOLEAN') return !!v;
        if (c.tipo === 'JSON') return v == null ? '' : JSON.stringify(v);
        return v;
      },
    })),
    { id: 'activo', header: 'Activo', valor: (r) => !!r.activo },
    { id: 'updated_at', header: 'Actualizado', prioridad: 2, tarjeta: 'meta',
      valor: (r) => r.updated_at,
      formato: (r) => (r.updated_at ? formatDate(r.updated_at, 'yyyy-MM-dd HH:mm', 'en-US') : '') },
  ]);

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: MetaConfigDialogData,
    private ref: MatDialogRef<MetaConfigDialogComponent, { refresh: boolean } | null>
  ) {
    // LIMPIEZA DURA AL ENTRAR
    this.hardReset();

    // Normalizar datos de entrada
    this.mode.set(data.mode);
    const src: any = data?.tabla ?? data ?? {};
    const codigo = (src.codigo ?? data.tablaCodigo ?? src.code ?? '').toString().trim();
    const id = (src.id ?? data.tablaId ?? src.uuid ?? src.pk ?? '').toString().trim();
    if (codigo) this.tablaCodigo.set(codigo);
    if (id) this.tablaId.set(id);
  }

  ngOnInit(): void {
    // Crear forms
    this.formCampo = this.fb.group({
      id: [null],
      campo: ['', [Validators.required, Validators.maxLength(64)]],
      tipo: ['STRING', Validators.required],
      obligatorio: [false],
      visible: [true],
      activo: [true],
    });

    this.formValor = this.fb.group({
      id: [null],
      activo: [true],
      datos: this.fb.group({})
    });

    // Forzar un render vacío antes de cargar
    this.cdr.detectChanges();

    this.bootstrap();
  }

  /** Limpia TODO el estado y subforms */
  private hardReset(): void {
    this.reqToken++; // invalida cualquier respuesta anterior
    this.loading.set(false);
    this.campos.set([]);
    this.valores.set([]);
    if (this.formCampo) {
      this.formCampo.reset({ id: null, campo: '', tipo: 'STRING', obligatorio: false, visible: true, activo: true });
    }
    if (this.formValor) {
      this.formValor.reset({ id: null, activo: true });
      this.formValor.setControl('datos', this.fb.group({}));
    }
  }

  /** Inicialización: asegurar id/código de la tabla y cargar */
  private bootstrap() {
    this.loading.set(true);

    const idOK = !!(this.tablaId() && this.tablaId()!.toString().trim());
    const codOK = !!(this.tablaCodigo() && this.tablaCodigo()!.toString().trim());

    if (!idOK && !codOK) {
      this.snack.open('No se recibió la tabla (id o código).', 'Cerrar', { duration: 3000 });
      this.loading.set(false);
      return;
    }

    if (idOK) {
      this.loadData(); // siempre cargamos fresco por id
      return;
    }

    // Resolver id por código
    const token = ++this.reqToken;
    this.svc.getMetaTablaByCodigo(this.tablaCodigo()).subscribe({
      next: (t: MetaTabla) => {
        if (token !== this.reqToken) return;
        this.tablaId.set(t.id);
        this.campos.set((t.campos || []).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)));
        if (this.mode() === 'valores') this.rebuildValorDatosForm();
        if (this.mode() === 'valores') this.loadValores();
        this.loading.set(false);
      },
      error: () => {
        if (token !== this.reqToken) return;
        this.snack.open('No se pudo cargar la tabla', 'Cerrar', { duration: 3000 });
        this.loading.set(false);
      }
    });
  }

  /** Carga según modo */
  private loadData() {
    if (this.mode() === 'campos') {
      this.loadCamposById(this.tablaId()!);
    } else {
      const id = this.tablaId();
      if (!id) { this.loading.set(false); return; }
      const token = ++this.reqToken;

      // limpiar antes de hacer llamados
      this.campos.set([]);
      this.valores.set([]);
      this.formValor.setControl('datos', this.fb.group({}));
      this.cdr.detectChanges();

      this.svc.listMetaCampos({ tabla: id }).subscribe({
        next: res => {
          if (token !== this.reqToken) return;
          const arr = Array.isArray(res) ? res : [];
          const sanitized = arr.filter((x: any) => !x.tabla || x.tabla === id);
          this.campos.set(sanitized.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)));
          this.rebuildValorDatosForm();
          this.loadValores();
        },
        error: () => {
          if (token !== this.reqToken) return;
          this.snack.open('No se pudieron cargar los campos', 'Cerrar', { duration: 3000 });
          this.loading.set(false);
        }
      });
    }
  }

  /** Carga de campos por id con limpieza y token anti-carrera */
  private loadCamposById(id: string) {
    const token = ++this.reqToken;

    // limpiar visual inmediato
    this.campos.set([]);
    this.cdr.detectChanges();

    this.svc.listMetaCampos({ tabla: id }).subscribe({
      next: res => {
        if (token !== this.reqToken) return;
        const arr = Array.isArray(res) ? res : [];
        const sanitized = arr.filter((x: any) => !x.tabla || x.tabla === id);
        this.campos.set(sanitized.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)));
        this.loading.set(false);
      },
      error: () => {
        if (token !== this.reqToken) return;
        this.snack.open('No se pudieron cargar los campos', 'Cerrar', { duration: 3000 });
        this.loading.set(false);
      }
    });
  }

  private loadValores() {
    const codigo = this.tablaCodigo();
    if (!codigo) { this.loading.set(false); return; }
    const token = ++this.reqToken;

    // limpiar lista antes de pintar nuevos
    this.valores.set([]);
    this.cdr.detectChanges();

    this.svc.listMetaValores({ tablaCodigo: codigo }).subscribe({
      next: res => {
        if (token !== this.reqToken) return;
        this.valores.set(res || []);
        this.loading.set(false);
      },
      error: () => {
        if (token !== this.reqToken) return;
        this.snack.open('No se pudieron cargar los valores', 'Cerrar', { duration: 3000 });
        this.loading.set(false);
      }
    });
  }

  // ======== Builder dinámico para 'datos' ========
  get camposVisiblesOrdenados(): MetaCampo[] {
    return (this.campos() || [])
      .filter(c => c.visible !== false)
      .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  }

  private rebuildValorDatosForm(initial?: Record<string, any>) {
    const group: Record<string, FormControl> = {};

    for (const c of this.camposVisiblesOrdenados) {
      const value = initial ? initial[c.campo] : this.defaultValueFor(c);
      const validators = c.obligatorio ? [Validators.required] : [];
      switch (c.tipo) {
        case 'BOOLEAN':
          group[c.campo] = new FormControl(!!value, validators);
          break;
        case 'NUMBER':
          group[c.campo] = new FormControl(
            value === null || value === undefined ? null : Number(value),
            validators
          );
          break;
        case 'DATE':
          group[c.campo] = new FormControl(value ? new Date(value) : null, validators);
          break;
        case 'JSON':
          group[c.campo] = new FormControl(
            value ? JSON.stringify(value, null, 2) : '',
            validators
          );
          break;
        case 'ENUM':
        case 'STRING':
        default:
          group[c.campo] = new FormControl(value ?? '', validators);
          break;
      }
    }

    this.formValor.setControl('datos', this.fb.group(group));
  }

  private defaultValueFor(c: MetaCampo) {
    switch (c.tipo) {
      case 'BOOLEAN': return false;
      case 'NUMBER': return null;
      case 'DATE': return null;
      case 'JSON': return '';
      case 'ENUM':
      case 'STRING':
      default: return '';
    }
  }

  // ===== Campos (CRUD) =====
  startCreateCampo() {
    this.editingCampo.set(null);
    this.formCampo.reset({
      id: null, campo: '', tipo: 'STRING', obligatorio: false, visible: true, activo: true
    });
  }

  startEditCampo(row: MetaCampo) {
    this.editingCampo.set(row);
    this.formCampo.reset({
      id: row.id,
      campo: row.campo,
      tipo: row.tipo,
      obligatorio: row.obligatorio,
      visible: row.visible,
      activo: row.activo
    });
  }

  saveCampo() {
    const idTabla = this.tablaId();
    if (this.formCampo.invalid || !idTabla) {
      this.snack.open('Completa el formulario de campo.', 'Cerrar', { duration: 2500 });
      return;
    }

    const payload: any = { ...this.formCampo.value };
    const isEdit = !!payload.id;

    if (isEdit) {
      delete payload.tabla;
      delete payload.orden;
      this.svc.updateMetaCampo(payload.id, payload).subscribe({
        next: () => { this.snack.open('Campo actualizado', 'OK', { duration: 2000 }); this.loadData(); this.startCreateCampo(); },
        error: () => this.snack.open('No se pudo actualizar el campo', 'Cerrar', { duration: 3000 })
      });
    } else {
      const toCreate = { ...payload, tabla: idTabla } as Omit<MetaCampo, 'id'> & { tabla: string };
      this.svc.createMetaCampo(toCreate).subscribe({
        next: () => { this.snack.open('Campo creado', 'OK', { duration: 2000 }); this.loadData(); this.startCreateCampo(); },
        error: () => this.snack.open('No se pudo crear el campo', 'Cerrar', { duration: 3000 })
      });
    }
  }

  deleteCampo(row: MetaCampo) {
    this.svc.deleteMetaCampo(row.id).subscribe({
      next: () => { this.snack.open('Campo eliminado', 'OK', { duration: 2000 }); this.loadData(); },
      error: () => this.snack.open('No se pudo eliminar el campo', 'Cerrar', { duration: 3000 })
    });
  }

  // ===== Valores (dinámicos, sin referencia) =====
  startCreateValor() {
    this.editingValor.set(null);
    this.formValor.patchValue({ id: null, activo: true });
    this.rebuildValorDatosForm();
  }

  startEditValor(row: MetaValor) {
    this.editingValor.set(row);
    this.formValor.patchValue({
      id: row.id,
      activo: row.activo
    });
    this.rebuildValorDatosForm(row.datos || {});
  }

  saveValor() {
    const idTabla = this.tablaId();
    if (!idTabla) {
      this.snack.open('Falta id de la tabla.', 'Cerrar', { duration: 2500 });
      return;
    }
    if (this.formValor.invalid) {
      this.snack.open('Completa los campos requeridos.', 'Cerrar', { duration: 2500 });
      return;
    }

    const datosGroup = (this.formValor.get('datos') as FormGroup);
    const datosRaw = datosGroup.getRawValue();
    const datos: Record<string, any> = {};

    for (const c of this.camposVisiblesOrdenados) {
      const v = datosRaw[c.campo];
      switch (c.tipo) {
        case 'BOOLEAN': datos[c.campo] = !!v; break;
        case 'NUMBER': datos[c.campo] = (v === null || v === '' || v === undefined) ? null : Number(v); break;
        case 'DATE':
          datos[c.campo] = v instanceof Date
            ? new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())).toISOString().slice(0, 10)
            : (v || null);
          break;
        case 'JSON':
          if (typeof v === 'string' && v.trim()) {
            try { datos[c.campo] = JSON.parse(v); }
            catch { this.snack.open(`JSON inválido en "${c.campo}"`, 'Cerrar', { duration: 3000 }); return; }
          } else {
            datos[c.campo] = {};
          }
          break;
        case 'ENUM':
        case 'STRING':
        default:
          datos[c.campo] = (v ?? '').toString();
          break;
      }
    }

    const base = this.formValor.getRawValue();
    const isEdit = !!base.id;

    if (isEdit) {
      // PATCH: no exige enviar 'tabla'
      this.svc.patchMetaValor(base.id, { datos, activo: base.activo }).subscribe({
        next: () => { this.snack.open('Valor actualizado', 'OK', { duration: 2000 }); this.loadValores(); this.startCreateValor(); },
        error: (e) => this.snack.open(this.extractBackendError(e) || 'No se pudo actualizar el valor', 'Cerrar', { duration: 3500 })
      });
    } else {
      this.svc.createMetaValor({ tabla: idTabla, datos, activo: base.activo }).subscribe({
        next: () => { this.snack.open('Valor creado', 'OK', { duration: 2000 }); this.loadValores(); this.startCreateValor(); },
        error: (e) => this.snack.open(this.extractBackendError(e) || 'No se pudo crear el valor', 'Cerrar', { duration: 3500 })
      });
    }
  }

  deleteValor(row: MetaValor) {
    this.svc.deleteMetaValor(row.id).subscribe({
      next: () => { this.snack.open('Valor eliminado', 'OK', { duration: 2000 }); this.loadValores(); },
      error: () => this.snack.open('No se pudo eliminar el valor', 'Cerrar', { duration: 3000 })
    });
  }

  /** Cerrar devolviendo señal de refresh al padre */
  close(ok = false) {
    this.ref.close(ok ? { refresh: true } : null);
  }

  private extractBackendError(e: any): string | null {
    try {
      const msg = e?.error?.datos?._extras || e?.error?.datos || e?.error?.detail || e?.error?.message;
      if (!msg) return null;
      return typeof msg === 'string' ? msg : JSON.stringify(msg);
    } catch { return null; }
  }
}
