import { SharedModule } from '@/app/shared/shared.module';
import {  Component, Inject, OnInit , ChangeDetectionStrategy } from '@angular/core';
import { FormGroup, FormArray, FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogActions, MatDialogContent } from '@angular/material/dialog';
import { DocumentacionService } from '../../service/documentacion/documentacion.service';
import { MatDividerModule } from '@angular/material/divider';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTooltipModule } from '@angular/material/tooltip';

import { animate, style, transition, trigger, query, stagger } from '@angular/animations';


export interface ModalData {
  id: any;
  name: string;
  expandable: boolean;
  estado: boolean;
  isEdit: boolean;
  /** Nombre del padre bajo el que se creará (null = nivel raíz). Solo contexto visual. */
  parentName?: string | null;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-document-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogContent,
    MatDialogActions,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatFormFieldModule,
    MatCheckboxModule,
    MatDividerModule,
    MatTooltipModule
],
  templateUrl: './document-modal.component.html',
  styleUrl: './document-modal.component.css',
  animations: [
    trigger('listAnimation', [
      transition('* => *', [
        query(':enter', [
          style({ opacity: 0, transform: 'translateY(10px)' } ),
          stagger(50, [
            animate('300ms ease-out', style({ opacity: 1, transform: 'none' }))
          ])
        ], { optional: true }),
        query(':leave', [
          animate('200ms ease-in', style({ opacity: 0, height: 0, margin: 0 }))
        ], { optional: true })
      ])
    ])
  ]
})
export class DocumentModalComponent implements OnInit {

  // Main form (Edit Mode) or Container (Create Mode)
  form: FormGroup;

  // Create Mode: "Input Area" form
  inputForm: FormGroup;

  // Create Mode: "Queue"
  nuevosDocumentos: FormArray<FormGroup>;

  /** El backend tiene `name` UNIQUE: un duplicado revienta el POST entero. */
  duplicateError = false;

  constructor(
    public dialogRef: MatDialogRef<DocumentModalComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ModalData,
    private fb: FormBuilder,
    private documentacionService: DocumentacionService
  ) {
    // 1. Edit Form (Used if data.isEdit)
    this.form = this.fb.group({
      id: [data.id || null],
      name: [data.name || '', [Validators.required, Validators.minLength(3), Validators.maxLength(50)]],
      expandable: [data.expandable || false],
      estado: [data.estado !== undefined ? data.estado : true],
    });

    // 2. Queue Array (Used if !data.isEdit)
    this.nuevosDocumentos = this.fb.array<FormGroup>([]);

    // 3. Input Form for Queue (Used if !data.isEdit)
    this.inputForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(50)]],
      estado: [true],
    });

    // El aviso de duplicado desaparece en cuanto el usuario corrige el nombre
    this.inputForm.get('name')!.valueChanges.subscribe(() => {
      if (this.duplicateError) this.duplicateError = false;
    });
  }

  ngOnInit(): void { }

  // --- ACTIONS: ADD TO QUEUE ---

  addToQueue() {
    if (this.inputForm.invalid) {
      this.inputForm.markAllAsTouched();
      return;
    }

    const name = (this.inputForm.value.name || '').trim();

    // Se compara sin distinguir mayúsculas: para MySQL "Actas" y "ACTAS" chocan igual.
    const yaEnLista = this.nuevosDocumentos.controls
      .some(c => (c.value.name || '').trim().toLowerCase() === name.toLowerCase());
    if (yaEnLista) {
      this.duplicateError = true;
      return;
    }

    this.nuevosDocumentos.push(this.fb.group({
      name: [name, [Validators.required]],
      estado: [this.inputForm.value.estado],
    }));

    // Reset Input
    this.inputForm.reset({
      name: '',
      estado: true,
    });
  }

  removeFromQueue(index: number) {
    this.nuevosDocumentos.removeAt(index);
  }

  // --- SAVE ---

  save(): void {
    if (this.data.isEdit) {
      this.saveEdit();
    } else {
      this.saveCreate();
    }
  }

  saveEdit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const val = this.form.value;
    this.dialogRef.close(val); // Return simple object for Edit
  }

  saveCreate() {
    if (this.nuevosDocumentos.length === 0) return;

    // Transform array
    const resultData = this.nuevosDocumentos.controls.map(control => {
      const val = control.value;
      return {
        name: val.name,
        estado: val.estado,
      };
    });

    this.dialogRef.close({ type: 'create', data: resultData });
  }

  cancel() {
    this.dialogRef.close();
  }
}
