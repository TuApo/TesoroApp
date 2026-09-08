/**
 * Alta / edicion de un correo del directorio de empresas usuarias. Devuelve la fila guardada o
 * `undefined` si se cancela. La regla del directorio (un solo principal por finca) la aplica el
 * backend; aqui solo se marca la casilla.
 */
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';

import { IncapacidadGestionService } from '../../services/incapacidad-gestion/incapacidad-gestion.service';
import { CorreoEmpresa, GrupoEmpresa } from '../../models/incapacidad-gestion.model';
import { mensajeDeError } from '../informes-incapacidades/informes-incapacidades.component';

export interface DatosDialogoCorreoEmpresa {
  /** Fila a editar; null = alta. */
  fila: CorreoEmpresa | null;
  /** Sugerencias al crear (misma finca). */
  grupo?: GrupoEmpresa;
  empresa?: string;
  empresasConocidas: string[];
}

export const ROLES_DIRECTORIO: readonly { valor: string; etiqueta: string }[] = [
  { valor: 'COORDINADOR', etiqueta: 'Asistente al trabajador en mision' },
  { valor: 'GESTION_HUMANA', etiqueta: 'Jefe de gestion humana' },
  { valor: 'EJECUTIVA', etiqueta: 'Ejecutiva' },
  { valor: 'ASISTENTE', etiqueta: 'Asistente' },
  { valor: 'SST', etiqueta: 'SST de la finca' },
  { valor: 'AUXILIAR', etiqueta: 'Auxiliar' },
  { valor: 'SST_TU_ALIANZA', etiqueta: 'SST Tu Alianza' },
  { valor: 'OTRO', etiqueta: 'Otro' },
];

@Component({
  selector: 'app-dialogo-correo-empresa',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, MatSelectModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title class="ce-titulo"><mat-icon>{{ datos.fila ? 'edit' : 'person_add' }}</mat-icon> {{ datos.fila ? 'Editar correo' : 'Agregar correo' }}</h2>
    <mat-dialog-content class="ce-contenido">
      <div class="ce-fila">
        <mat-form-field appearance="outline">
          <mat-label>Empleador</mat-label>
          <mat-select [(ngModel)]="grupo" [disabled]="!!datos.fila">
            <mat-option value="APOYO">Apoyo Laboral</mat-option>
            <mat-option value="ALIANZA">Tu Alianza</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" class="ce-ancho">
          <mat-label>Empresa / finca (como en el centro de costo)</mat-label>
          <input matInput [(ngModel)]="empresa" list="ce-empresas" maxlength="200" style="text-transform: uppercase" />
          <datalist id="ce-empresas">@for (e of datos.empresasConocidas; track e) { <option [value]="e"></option> }</datalist>
        </mat-form-field>
      </div>
      <mat-form-field appearance="outline">
        <mat-label>Correo</mat-label>
        <input matInput type="email" [(ngModel)]="correo" maxlength="255" />
      </mat-form-field>
      <div class="ce-fila">
        <mat-form-field appearance="outline">
          <mat-label>Rol del contacto</mat-label>
          <mat-select [(ngModel)]="rol">
            @for (r of roles; track r.valor) { <mat-option [value]="r.valor">{{ r.etiqueta }}</mat-option> }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Orden</mat-label>
          <input matInput type="number" min="0" [(ngModel)]="orden" />
        </mat-form-field>
      </div>
      <mat-checkbox [(ngModel)]="esPrincipal">Contacto principal (a el va DIRIGIDO el correo; los demas van en copia)</mat-checkbox>
      <div class="ce-fila">
        <mat-form-field appearance="outline" class="ce-ancho">
          <mat-label>Nombre del asistente al trabajador</mat-label>
          <input matInput [(ngModel)]="contactoNombre" maxlength="160" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Oficina responsable</mat-label>
          <input matInput [(ngModel)]="oficinaResponsable" maxlength="80" />
        </mat-form-field>
      </div>
      <div class="ce-fila">
        <mat-form-field appearance="outline"><mat-label>Telefono</mat-label><input matInput [(ngModel)]="telefono" maxlength="60" /></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>Extension</mat-label><input matInput [(ngModel)]="extension" maxlength="60" /></mat-form-field>
      </div>
      @if (datos.fila) { <mat-checkbox [(ngModel)]="activo">Activo (recibe correos)</mat-checkbox> }
      @if (error()) { <p class="ce-error" role="alert"><mat-icon>error</mat-icon> {{ error() }}</p> }
      @if (guardando()) { <mat-progress-bar mode="indeterminate" /> }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="ref.close(undefined)">Cancelar</button>
      <button mat-flat-button color="primary" type="button" [disabled]="guardando()" (click)="guardar()"><mat-icon>save</mat-icon> Guardar</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .ce-titulo { display: flex; align-items: center; gap: 8px; font-weight: 800; }
    .ce-contenido { display: flex; flex-direction: column; gap: 4px; min-width: min(640px, 92vw); }
    .ce-fila { display: flex; gap: 10px; flex-wrap: wrap; }
    .ce-fila mat-form-field { flex: 1 1 180px; }
    .ce-ancho { flex: 2 1 260px !important; }
    .ce-error { display: flex; align-items: center; gap: 6px; color: #c62828; margin: 0; font-size: 13px; }
  `],
})
export class DialogoCorreoEmpresaComponent {
  readonly ref = inject(MatDialogRef<DialogoCorreoEmpresaComponent, CorreoEmpresa | undefined>);
  readonly datos = inject<DatosDialogoCorreoEmpresa>(MAT_DIALOG_DATA);
  private readonly srv = inject(IncapacidadGestionService);

  readonly roles = ROLES_DIRECTORIO;
  grupo: GrupoEmpresa = this.datos.fila?.grupo ?? this.datos.grupo ?? 'APOYO';
  empresa = this.datos.fila?.empresa ?? this.datos.empresa ?? '';
  correo = this.datos.fila?.correo ?? '';
  rol = this.datos.fila?.rol ?? 'OTRO';
  orden = this.datos.fila?.orden ?? 7;
  esPrincipal = this.datos.fila?.esPrincipal ?? false;
  contactoNombre = this.datos.fila?.contactoNombre ?? '';
  oficinaResponsable = this.datos.fila?.oficinaResponsable ?? '';
  telefono = this.datos.fila?.telefono ?? '';
  extension = this.datos.fila?.extension ?? '';
  activo = this.datos.fila?.activo ?? true;
  readonly guardando = signal(false);
  readonly error = signal('');

  guardar(): void {
    if (!this.empresa.trim() || !this.correo.trim()) {
      this.error.set('La empresa y el correo son obligatorios.');
      return;
    }
    this.guardando.set(true);
    this.error.set('');
    const cuerpo = {
      grupo: this.grupo,
      empresa: this.empresa.trim().toUpperCase(),
      correo: this.correo.trim().toLowerCase(),
      rol: this.rol,
      orden: Number(this.orden) || 0,
      esPrincipal: this.esPrincipal,
      contactoNombre: this.contactoNombre.trim(),
      oficinaResponsable: this.oficinaResponsable.trim(),
      telefono: this.telefono.trim(),
      extension: this.extension.trim(),
      activo: this.activo,
    };
    const peticion = this.datos.fila
      ? this.srv.editarCorreoEmpresa(this.datos.fila.id, cuerpo)
      : this.srv.crearCorreoEmpresa(cuerpo);
    peticion.subscribe({
      next: (f) => this.ref.close(f),
      error: (e: unknown) => { this.guardando.set(false); this.error.set(mensajeDeError(e, 'No se pudo guardar.')); },
    });
  }
}
