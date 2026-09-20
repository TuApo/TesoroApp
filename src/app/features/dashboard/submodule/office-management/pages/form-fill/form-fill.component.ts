import { ChangeDetectionStrategy, Component, OnInit, ViewChild, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { OfficeFormsService } from '../../services/office-forms.service';
import { FormRendererComponent } from '../../components/form-renderer/form-renderer.component';
import { FormDefinition } from '../../models/office-forms.models';

/** Llenado interno de un formulario (usuario autenticado). Reusa el FormRenderer. */
@Component({
  selector: 'app-form-fill',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatSelectModule,
    MatProgressSpinnerModule, FormRendererComponent,
  ],
  template: `
  <div class="ff">
    <header class="ff__head">
      <button mat-icon-button (click)="back()"><mat-icon>arrow_back</mat-icon></button>
      <div>
        <h1>{{ form()?.title || 'Formulario' }}</h1>
        @if (form()?.description) { <p>{{ form()?.description }}</p> }
      </div>
    </header>

    @if (loading()) {
      <div class="ff__loading"><mat-spinner diameter="34"></mat-spinner></div>
    } @else if (form(); as f) {
      <div class="ff__card">
        @if ((f.office_ids?.length || 0) > 0) {
          <mat-form-field appearance="outline" class="w-full">
            <mat-label>Oficina</mat-label>
            <mat-select [value]="office()" (selectionChange)="office.set($event.value)">
              @for (o of f.office_ids; track o) { <mat-option [value]="o">{{ o }}</mat-option> }
            </mat-select>
          </mat-form-field>
        }
        <app-form-renderer #renderer [fields]="f.fields || []"></app-form-renderer>

        <div class="ff__actions">
          <button mat-flat-button color="primary" [disabled]="sending()" (click)="submit()">
            <mat-icon>send</mat-icon> Enviar respuesta
          </button>
        </div>
      </div>
    } @else {
      <div class="ff__error">No se pudo cargar el formulario.</div>
    }
  </div>
  `,
  styles: [`
    .ff { padding: 8px 4px 40px; max-width: 620px; }
    .w-full { width: 100%; }
    .ff__head { display: flex; align-items: center; gap: 12px; }
    .ff__head h1 { font-size: 22px; font-weight: 800; margin: 0; color: var(--text); }
    .ff__head p { color: var(--muted); margin: 2px 0 0; }
    .ff__loading { display: flex; justify-content: center; padding: 50px 0; }
    .ff__card { margin-top: 16px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); padding: 20px; }
    .ff__actions { margin-top: 18px; display: flex; justify-content: flex-end; }
  `],
})
export class FormFillComponent implements OnInit {
  private api = inject(OfficeFormsService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private snack = inject(MatSnackBar);

  @ViewChild('renderer') renderer?: FormRendererComponent;

  formId = 0;
  form = signal<FormDefinition | null>(null);
  loading = signal(true);
  sending = signal(false);
  office = signal<string | null>(null);

  ngOnInit(): void {
    this.formId = Number(this.route.snapshot.paramMap.get('id'));
    this.api.get(this.formId).subscribe({
      next: (f) => {
        this.form.set(f);
        this.office.set((f.office_ids && f.office_ids.length === 1) ? f.office_ids[0] : null);
        this.loading.set(false);
      },
      error: () => { this.form.set(null); this.loading.set(false); },
    });
  }

  submit(): void {
    if (!this.renderer) return;
    if (!this.renderer.isValid()) {
      this.renderer.markAllTouched();
      this.snack.open('Completa los campos obligatorios', 'OK', { duration: 2500 });
      return;
    }
    this.sending.set(true);
    const values = this.renderer.getValues();
    this.api.submit(this.formId, values, { office_id: this.office() }).subscribe({
      next: () => {
        this.sending.set(false);
        this.snack.open('Respuesta enviada', 'OK', { duration: 2500 });
        this.router.navigate(['/dashboard/office-management/forms', this.formId, 'responses']);
      },
      error: () => { this.sending.set(false); this.snack.open('No se pudo enviar', 'OK', { duration: 3000 }); },
    });
  }

  back(): void { this.router.navigate(['/dashboard/office-management']); }
}
