import {
  Component, ChangeDetectionStrategy, ChangeDetectorRef, inject, OnInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DocumentoTipo, ActuacionLegal } from '../../models/legal.models';
import { LegalService } from '../../services/legal.service';

export interface SubirDocumentoDialogData {
  procesoId: number;
  actuaciones: ActuacionLegal[];
}

export interface SubirDocumentoResult {
  file: File;
  docTipoId: number;
  actuacionId?: number;
}

@Component({
  selector: 'app-subir-documento-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule,
    MatDialogModule, MatButtonModule, MatFormFieldModule,
    MatSelectModule, MatIconModule, MatTooltipModule, MatProgressSpinnerModule
  ],
  template: `
    <h2 mat-dialog-title>Subir Documento</h2>

    <mat-dialog-content>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Tipo de documento*</mat-label>
        <mat-select [(ngModel)]="docTipoId">
          <mat-option *ngIf="cargandoTipos" [value]="null" disabled>
            Cargando...
          </mat-option>
          <mat-option *ngFor="let t of documentoTipos" [value]="t.id">
            {{ t.nombre }}
          </mat-option>
        </mat-select>
      </mat-form-field>

      <mat-form-field appearance="outline" class="full-width" *ngIf="(data.actuaciones?.length ?? 0) > 0">
        <mat-label>Vincular a actuación (opcional)</mat-label>
        <mat-select [(ngModel)]="actuacionId">
          <mat-option [value]="null">— Sin vincular —</mat-option>
          <mat-option *ngFor="let a of data.actuaciones" [value]="a.id">
            {{ a.titulo }} ({{ a.fechaActuacion | date:'dd/MM/yyyy' }})
          </mat-option>
        </mat-select>
      </mat-form-field>

      <div class="file-zone" [class.has-file]="file" (click)="filePicker.click()">
        <input #filePicker type="file" hidden (change)="onFileSelected($event)">
        <mat-icon class="zone-icon">{{ file ? 'description' : 'cloud_upload' }}</mat-icon>
        <span class="zone-text">
          {{ file ? file.name : 'Clic para seleccionar archivo' }}
        </span>
        <span *ngIf="file" class="zone-size">{{ formatBytes(file.size) }}</span>
      </div>

    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="cancelar()">Cancelar</button>
      <button mat-flat-button color="primary"
        [disabled]="!file || !docTipoId"
        (click)="confirmar()">
        <mat-icon>upload</mat-icon> Subir
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .full-width { width: 100%; margin-bottom: 8px; }

    .file-zone {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 8px; padding: 24px 16px; margin-top: 8px;
      border: 2px dashed #bbb; border-radius: 8px; cursor: pointer;
      transition: border-color .2s, background .2s;
      text-align: center;
    }
    .file-zone:hover   { border-color: #1976d2; background: #e3f2fd; }
    .file-zone.has-file { border-color: #2e7d32; background: #e8f5e9; }
    .zone-icon { font-size: 36px; width: 36px; height: 36px; color: #888; }
    .file-zone.has-file .zone-icon { color: #2e7d32; }
    .zone-text { font-size: 14px; color: #555; word-break: break-all; }
    .zone-size { font-size: 12px; color: #888; }
  `]
})
export class SubirDocumentoDialogComponent implements OnInit {
  data: SubirDocumentoDialogData = inject(MAT_DIALOG_DATA);
  private ref = inject(MatDialogRef<SubirDocumentoDialogComponent>);
  private svc = inject(LegalService);
  private cdr = inject(ChangeDetectorRef);

  documentoTipos: DocumentoTipo[] = [];
  cargandoTipos = true;

  docTipoId: number | null = null;
  actuacionId: number | null = null;
  file: File | null = null;

  ngOnInit(): void {
    this.svc.getDocumentoTipos().subscribe({
      next: tipos => { this.documentoTipos = tipos; this.cargandoTipos = false; this.cdr.markForCheck(); },
      error: () => { this.cargandoTipos = false; this.cdr.markForCheck(); }
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.file = input.files?.[0] ?? null;
    this.cdr.markForCheck();
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  cancelar(): void { this.ref.close(null); }

  confirmar(): void {
    if (!this.file || !this.docTipoId) return;
    const result: SubirDocumentoResult = {
      file: this.file,
      docTipoId: this.docTipoId,
      actuacionId: this.actuacionId ?? undefined
    };
    this.ref.close(result);
  }
}
