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
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ProcesoLegal, ProcesoEstado, DocumentoTipo } from '../../models/legal.models';
import { LegalService } from '../../services/legal.service';

interface DocEntry {
  file: File | null;
  nombre: string;
  docTipoId: number | null;
}

export interface CambiarEstadoDialogData {
  proceso: ProcesoLegal;
  estados: ProcesoEstado[];
}

export interface CambiarEstadoResult {
  estadoId: number;
  motivo: string;
  archivos: Array<{ file: File; docTipoId: number }>;
}

@Component({
  selector: 'app-cambiar-estado-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule, ReactiveFormsModule,
    MatDialogModule, MatButtonModule, MatFormFieldModule,
    MatSelectModule, MatInputModule, MatIconModule,
    MatTooltipModule, MatProgressSpinnerModule
  ],
  template: `
    <h2 mat-dialog-title>Cambiar Estado del Proceso</h2>

    <mat-dialog-content>
      <p class="proceso-info">
        <strong>{{ data.proceso.radicado }}</strong> —
        {{ data.proceso.trabajadorNombre }} ({{ data.proceso.trabajadorCedula }})
      </p>
      <p class="estado-actual">
        Estado actual:
        <span class="chip" [ngClass]="'semaforo-' + data.proceso.colorSemaforo">
          {{ data.proceso.estadoNombre }}
        </span>
      </p>

      <form [formGroup]="form">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Nuevo estado</mat-label>
          <mat-select formControlName="estadoId">
            <mat-option *ngFor="let e of data.estados" [value]="e.id">
              {{ e.nombre }}
            </mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Motivo del cambio</mat-label>
          <textarea matInput formControlName="motivo" rows="3"
            placeholder="Describe el motivo del cambio de estado..."></textarea>
        </mat-form-field>
      </form>

      <!-- Sección documentos -->
      <div class="docs-section">
        <div class="docs-header">
          <span class="docs-title">
            <mat-icon class="docs-icon">attach_file</mat-icon>
            Adjuntar documentos
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
            <mat-label>Tipo de documento</mat-label>
            <mat-select [(ngModel)]="a.docTipoId" [ngModelOptions]="{standalone: true}">
              <mat-option *ngFor="let t of documentoTipos" [value]="t.id">
                {{ t.nombre }}
              </mat-option>
            </mat-select>
          </mat-form-field>

          <label class="file-label" [for]="'doc-file-' + i" [class.has-file]="a.file">
            <mat-icon>{{ a.file ? 'description' : 'upload_file' }}</mat-icon>
            <span class="file-name">{{ a.nombre || 'Seleccionar archivo' }}</span>
          </label>
          <input [id]="'doc-file-' + i" type="file" hidden (change)="onFileSelected($event, i)">

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
    .proceso-info  { margin: 0 0 8px; font-size: 14px; }
    .estado-actual { margin: 0 0 16px; font-size: 13px; color: #666; }
    .full-width    { width: 100%; margin-bottom: 8px; }

    .chip { display: inline-block; padding: 2px 10px; border-radius: 12px;
            font-size: 12px; font-weight: 500; }
    .semaforo-verde    { background: #e8f5e9; color: #2e7d32; }
    .semaforo-amarillo { background: #fff8e1; color: #f57f17; }
    .semaforo-rojo     { background: #ffebee; color: #c62828; }

    /* Documentos */
    .docs-section  { margin-top: 12px; border-top: 1px solid #e0e0e0; padding-top: 12px; }
    .docs-header   { display: flex; align-items: center; justify-content: space-between;
                     margin-bottom: 10px; }
    .docs-title    { display: flex; align-items: center; gap: 6px;
                     font-size: 14px; font-weight: 500; color: #555; }
    .docs-icon     { font-size: 18px; width: 18px; height: 18px; }
    .docs-loading  { display: flex; align-items: center; gap: 8px;
                     font-size: 13px; color: #888; padding: 8px 0; }
    .docs-empty    { font-size: 13px; color: #999; margin: 4px 0 0; font-style: italic; }

    .doc-row {
      display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
    }
    .tipo-field { flex: 0 0 200px; margin: 0; }
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
export class CambiarEstadoDialogComponent implements OnInit {
  data: CambiarEstadoDialogData = inject(MAT_DIALOG_DATA);
  private ref  = inject(MatDialogRef<CambiarEstadoDialogComponent>);
  private fb   = inject(FormBuilder);
  private svc  = inject(LegalService);
  private cdr  = inject(ChangeDetectorRef);

  documentoTipos: DocumentoTipo[] = [];
  archivos: DocEntry[] = [];
  cargandoTipos = true;

  form = this.fb.group({
    estadoId: [null as number | null, Validators.required],
    motivo: ['', Validators.required]
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

  confirmar(): void {
    if (this.form.invalid || !this.archivosValidos()) return;
    const result: CambiarEstadoResult = {
      estadoId: this.form.value.estadoId!,
      motivo:   this.form.value.motivo!,
      archivos: this.archivos
        .filter(a => a.file && a.docTipoId)
        .map(a => ({ file: a.file!, docTipoId: a.docTipoId! }))
    };
    this.ref.close(result);
  }
}
