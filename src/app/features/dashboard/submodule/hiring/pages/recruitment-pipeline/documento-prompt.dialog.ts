import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';

/** Lo que devuelve el diálogo, o `undefined` si se cerró sin buscar. */
export interface DocumentoPrompt {
  tipoDoc: string;
  numero: string;
}

/**
 * Pide el documento al entrar al pipeline.
 *
 * Antes esto era la pestaña "Turnos": para atender a alguien había que entrar,
 * caer en un tablero de cola, buscar el campo y recién ahí escribir la cédula.
 * Con la persona al frente el primer gesto es siempre el mismo, así que se
 * pregunta de una y la vista arranca en Selección.
 *
 * El diálogo NO busca: solo recoge tipo y número. La búsqueda la sigue haciendo
 * `SearchForCandidateComponent`, que además consulta vetados, asegura el estado
 * del robot y encola. Duplicar eso aquí habría dejado dos caminos que se
 * desincronizan al primer cambio.
 */
@Component({
  selector: 'app-documento-prompt-dialog',
  standalone: true,
  imports: [
    FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatIconModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .dp-head { display:flex; align-items:center; gap:12px; padding:18px 22px; background:var(--navy,#21263C); }
    .dp-head mat-icon { color:var(--lime,#8CD50A); }
    .dp-title { margin:0; font-size:1rem; font-weight:700; color:#fff; }
    .dp-sub { margin:2px 0 0; font-size:.78rem; color:rgba(255,255,255,.65); }
    .dp-body { display:flex; gap:12px; padding:20px 22px 4px; flex-wrap:wrap; }
    .dp-tipo { flex:1 1 190px; min-width:0; }
    .dp-num  { flex:2 1 240px; min-width:0; }
    .dp-actions { padding:0 22px 18px; }
  `],
  template: `
    <div class="dp-head">
      <mat-icon>badge</mat-icon>
      <div>
        <h2 class="dp-title">¿A quién vas a atender?</h2>
        <p class="dp-sub">Escribe el documento de la persona que tienes al frente.</p>
      </div>
    </div>

    <div class="dp-body">
      <mat-form-field appearance="outline" class="dp-tipo">
        <mat-label>Tipo de documento</mat-label>
        <mat-select [(ngModel)]="tipoDoc">
          @for (t of tiposDocumento; track t.value) {
            <mat-option [value]="t.value">{{ t.label }}</mat-option>
          }
        </mat-select>
      </mat-form-field>

      <mat-form-field appearance="outline" class="dp-num">
        <mat-label>Número de documento</mat-label>
        <!-- cdkFocusInitial: el foco cae aquí, que es lo único que hay que teclear. -->
        <input matInput cdkFocusInitial [(ngModel)]="numero" autocomplete="off"
               placeholder="Ej: 1005851506" (keyup.enter)="buscar()" />
        <mat-hint>Enter para buscar</mat-hint>
      </mat-form-field>
    </div>

    <div mat-dialog-actions align="end" class="dp-actions">
      <button mat-button type="button" (click)="ref.close()">Ahora no</button>
      <button mat-flat-button color="primary" type="button"
              [disabled]="!numero.trim()" (click)="buscar()">
        <mat-icon>search</mat-icon> Buscar
      </button>
    </div>
  `,
})
export class DocumentoPromptDialogComponent {
  tipoDoc = 'CC';
  numero = '';

  /** Misma lista que el buscador, para que el tipo elegido case con su búsqueda. */
  readonly tiposDocumento: ReadonlyArray<{ value: string; label: string }> = [
    { value: 'CC', label: 'C.C - Cédula de ciudadanía' },
    { value: 'CE', label: 'C.E - Cédula de extranjería' },
    { value: 'TI', label: 'T.I - Tarjeta de identidad' },
    { value: 'PEP', label: 'PEP - Permiso especial de permanencia' },
    { value: 'PPT', label: 'PPT - Permiso por protección temporal' },
    { value: 'PT', label: 'PT - Permiso temporal' },
    { value: 'PA', label: 'PA - Pasaporte' },
  ];

  constructor(readonly ref: MatDialogRef<DocumentoPromptDialogComponent, DocumentoPrompt>) {}

  buscar(): void {
    const numero = this.numero.trim();
    if (!numero) return;
    this.ref.close({ tipoDoc: this.tipoDoc, numero });
  }
}
