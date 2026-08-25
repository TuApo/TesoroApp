import {
  Component, ChangeDetectionStrategy, ChangeDetectorRef, OnInit, inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { BreakpointObserver } from '@angular/cdk/layout';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { MatStepperModule } from '@angular/material/stepper';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatCardModule } from '@angular/material/card';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';

import { LegalService } from '../../services/legal.service';
import { ProcesoTipo } from '../../models/legal.models';

@Component({
  selector: 'app-nuevo-proceso',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule, ReactiveFormsModule,
    MatStepperModule, MatButtonModule, MatIconModule, MatFormFieldModule,
    MatInputModule, MatDatepickerModule, MatNativeDateModule, MatCardModule,
    MatSnackBarModule, MatProgressSpinnerModule, MatTooltipModule
  ],
  templateUrl: './nuevo-proceso.component.html',
  styleUrl: './nuevo-proceso.component.css'
})
export class NuevoProceso implements OnInit {
  private svc = inject(LegalService);
  private router = inject(Router);
  private snack = inject(MatSnackBar);
  private fb = inject(FormBuilder);
  private cdr = inject(ChangeDetectorRef);
  private bp = inject(BreakpointObserver);

  tipos: ProcesoTipo[] = [];
  tipoSeleccionado: ProcesoTipo | null = null;
  cargandoTipos = false;
  enviando = false;
  stepperOrientation: 'horizontal' | 'vertical' = 'horizontal';

  constructor() {
    this.bp.observe('(max-width: 768px)').pipe(takeUntilDestroyed()).subscribe(r => {
      this.stepperOrientation = r.matches ? 'vertical' : 'horizontal';
      this.cdr.markForCheck();
    });
  }

  // Formulario paso 2
  form = this.fb.group({
    trabajadorCedula: ['', Validators.required],
    trabajadorNombre: ['', Validators.required],
    empresaNombre: [''],
    fechaInicio: [new Date().toISOString().split('T')[0], Validators.required],
    responsableId: [''],
    descripcionHechos: [''],
    pretensiones: ['']
  });

  ngOnInit(): void {
    this.cargandoTipos = true;
    this.cdr.markForCheck();
    this.svc.getTipos().subscribe({
      next: t => {
        this.tipos = t.filter(x => x.activo !== false);
        this.cargandoTipos = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.cargandoTipos = false;
        this.snack.open('Error al cargar tipos de proceso', 'Cerrar', { duration: 3000 });
        this.cdr.markForCheck();
      }
    });
  }

  seleccionarTipo(tipo: ProcesoTipo): void {
    this.tipoSeleccionado = tipo;
    this.cdr.markForCheck();
  }

  cancelar(): void {
    this.router.navigate(['/dashboard/gestion-legal/bandeja']);
  }

  private toDateStr(v: unknown): string {
    if (!v) return '';
    if (typeof v === 'string') return v.split('T')[0];
    const d = v as { toISOString?: () => string };
    return d.toISOString ? d.toISOString().split('T')[0] : String(v);
  }

  enviar(): void {
    if (this.form.invalid || !this.tipoSeleccionado) return;
    this.enviando = true;
    this.cdr.markForCheck();

    const val = this.form.value;
    const fechaInicio = this.toDateStr(val.fechaInicio);

    const body: any = {
      tipoId: this.tipoSeleccionado.id,
      trabajadorCedula: val.trabajadorCedula,
      trabajadorNombre: val.trabajadorNombre,
      fechaInicio,
    };
    if (val.empresaNombre) body.empresaNombre = val.empresaNombre;
    if (val.responsableId) body.responsableId = val.responsableId;
    if (val.descripcionHechos) body.descripcionHechos = val.descripcionHechos;
    if (val.pretensiones) body.pretensiones = val.pretensiones;

    this.svc.crearProceso(body).subscribe({
      next: proceso => {
        this.snack.open('Proceso creado correctamente', 'Cerrar', { duration: 3000 });
        this.router.navigate(['/dashboard/gestion-legal/expediente', proceso.id]);
      },
      error: () => {
        this.enviando = false;
        this.snack.open('Error al crear el proceso', 'Cerrar', { duration: 3000 });
        this.cdr.markForCheck();
      }
    });
  }

  iconoTipo(icono: string): string {
    return icono || 'gavel';
  }
}
