import {
  Component, ChangeDetectionStrategy, ChangeDetectorRef, inject, OnInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DocumentoTipo } from '../../models/legal.models';
import { LegalService } from '../../services/legal.service';

interface DocEntry {
  file: File | null;
  nombre: string;
  docTipoId: number | null;
}

export interface NuevaActuacionResult {
  tipo: string;
  titulo: string;
  fechaActuacion: string;
  realizadoPor: string;
  descripcion: string | null;
  archivos: Array<{ file: File; docTipoId: number }>;
}

@Component({
  selector: 'app-nueva-actuacion-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule, ReactiveFormsModule,
    MatDialogModule, MatButtonModule, MatFormFieldModule,
    MatSelectModule, MatInputModule, MatIconModule,
    MatDatepickerModule, MatNativeDateModule,
    MatTooltipModule, MatProgressSpinnerModule
  ],
  template: `
    <h2 mat-dialog-title>Registrar Actuación</h2>

    <mat-dialog-content>
      <form [formGroup]="form" class="form-actuacion">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Tipo de actuación*</mat-label>
          <mat-select formControlName="tipo">
            <mat-option value="AUDIENCIA">Audiencia</mat-option>
            <mat-option value="NOTIFICACION">Notificación</mat-option>
            <mat-option value="DOCUMENTO">Documento</mat-option>
            <mat-option value="RECURSO">Recurso</mat-option>
            <mat-option value="FALLO">Fallo</mat-option>
            <mat-option value="OTRO">Otro</mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Título*</mat-label>
          <input matInput formControlName="titulo" placeholder="Ej. Audiencia de conciliación">
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Fecha de la actuación*</mat-label>
          <input matInput [matDatepicker]="picker" formControlName="fechaActuacion">
          <mat-datepicker-toggle matIconSuffix [for]="picker"></mat-datepicker-toggle>
          <mat-datepicker #picker></mat-datepicker>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Realizado por*</mat-label>
          <input matInput formControlName="realizadoPor" placeholder="Nombre del responsable">
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Descripción</mat-label>
          <textarea matInput formControlName="descripcion" rows="3"
            placeholder="Detalle de la actuación..."></textarea>
        </mat-form-field>
      </form>

      <!-- Sección documentos vinculados -->
      <div class="docs-section">
        <div class="docs-header">
          <span class="docs-title">
            <mat-icon class="docs-icon">attach_file</mat-icon>
            Documentos de esta actuación
          </span>
          <button mat-stroked-button type="button" (click)="agregarArchivo()" [disabled]="cargandoTipos">
            <mat-icon>add</mat-icon> Agregar
          </button>
        </div>

        <div *ngIf="cargandoTipos" class="docs-loading">
          <mat-spinner diameter="20"></mat-spinner>
          <span>Cargando tipos...</span>
        </div>

        <p *ngIf="!cargandoTipos && archivos.length === 0" class="docs-empty">
          Sin adjuntos — opcional
        </p>

        <div *ngFor="let a of archivos; let i = index" class="doc-row">
          <mat-form-field appearance="outline" class="tipo-field">
            <mat-label>Tipo</mat-label>
            <mat-select [(ngModel)]="a.docTipoId" [ngModelOptions]="{standalone: true}">
              <mat-option *ngFor="let t of documentoTipos" [value]="t.id">
                {{ t.nombre }}
              </mat-option>
            </mat-select>
          </mat-form-field>

          <label class="file-label" [for]="'act-file-' + i" [class.has-file]="a.file">
            <mat-icon>{{ a.file ? 'description' : 'upload_file' }}</mat-icon>
            <span class="file-name">{{ a.nombre || 'Seleccionar archivo' }}</span>
          </label>
          <input [id]="'act-file-' + i" type="file" hidden (change)="onFileSelected($event, i)">

          <button mat-icon-button type="button" color="warn"
            (click)="eliminarArchivo(i)" matTooltip="Quitar">
            <mat-icon>close</mat-icon>
          </button>
        </div>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="cancelar()">Cancelar</button>
      <button mat-flat-button color="primary"
        [disabled]="form.invalid || !archivosValidos()"
        (click)="confirmar()">
        <mat-icon>save</mat-icon> Guardar
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .form-actuacion { display: flex; flex-direction: column; gap: 8px; padding-top: 8px; }
    .full-width { width: 100%; }

    .docs-section  { margin-top: 12px; border-top: 1px solid #e0e0e0; padding-top: 12px; }
    .docs-header   { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    .docs-title    { display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 500; color: #555; }
    .docs-icon     { font-size: 18px; width: 18px; height: 18px; }
    .docs-loading  { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #888; padding: 8px 0; }
    .docs-empty    { font-size: 13px; color: #999; margin: 4px 0 0; font-style: italic; }

    .doc-row       { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .tipo-field    { flex: 0 0 200px; margin: 0; }
    .file-label {
      display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0;
      cursor: pointer; border: 1px dashed #bbb; border-radius: 4px;
      padding: 6px 10px; font-size: 13px; color: #555;
      transition: border-color .2s, background .2s;
    }
    .file-label:hover  { border-color: #1976d2; background: #e3f2fd; }
    .file-label.has-file { border-color: #2e7d32; background: #e8f5e9; color: #2e7d32; }
    .file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    @media (max-width: 600px) {
      .doc-row    { flex-wrap: wrap; }
      .tipo-field { flex: 1 1 100%; }
      .file-label { flex: 1; }
    }
  `]
})
export class NuevaActuacionDialogComponent implements OnInit {
  data: { procesoId: number } = inject(MAT_DIALOG_DATA);
  private ref  = inject(MatDialogRef<NuevaActuacionDialogComponent>);
  private fb   = inject(FormBuilder);
  private svc  = inject(LegalService);
  private cdr  = inject(ChangeDetectorRef);

  documentoTipos: DocumentoTipo[] = [];
  archivos: DocEntry[] = [];
  cargandoTipos = true;

  form = this.fb.group({
    tipo:           ['AUDIENCIA', Validators.required],
    titulo:         ['', Validators.required],
    fechaActuacion: [new Date().toISOString().split('T')[0], Validators.required],
    realizadoPor:   ['', Validators.required],
    descripcion:    ['']
  });

  ngOnInit(): void {
    this.svc.getDocumentoTipos().subscribe({
      next: tipos => {
        this.documentoTipos = tipos;
        this.cargandoTipos = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.cargandoTipos = false;
        this.cdr.markForCheck();
      }
    });
  }

  agregarArchivo(): void {
    this.archivos = [...this.archivos, { file: null, nombre: '', docTipoId: null }];
    this.cdr.markForCheck();
  }

  eliminarArchivo(i: number): void {
    this.archivos = this.archivos.filter((_, idx) => idx !== i);
    this.cdr.markForCheck();
  }

  onFileSelected(event: Event, i: number): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const updated = [...this.archivos];
    updated[i] = { ...updated[i], file, nombre: file.name };
    this.archivos = updated;
    this.cdr.markForCheck();
  }

  archivosValidos(): boolean {
    return this.archivos.every(a => a.file !== null && a.docTipoId !== null);
  }

  cancelar(): void { this.ref.close(null); }

  private toDateStr(v: unknown): string {
    if (!v) return '';
    if (typeof v === 'string') return v.split('T')[0];
    const d = v as { toISOString?: () => string };
    return d.toISOString ? d.toISOString().split('T')[0] : String(v);
  }

  confirmar(): void {
    if (this.form.invalid || !this.archivosValidos()) return;
    const val = this.form.value;
    const result: NuevaActuacionResult = {
      tipo:           val.tipo!,
      titulo:         val.titulo!,
      fechaActuacion: this.toDateStr(val.fechaActuacion),
      realizadoPor:   val.realizadoPor!,
      descripcion:    val.descripcion || null,
      archivos:       this.archivos
        .filter(a => a.file && a.docTipoId)
        .map(a => ({ file: a.file!, docTipoId: a.docTipoId! }))
    };
    this.ref.close(result);
  }
}
