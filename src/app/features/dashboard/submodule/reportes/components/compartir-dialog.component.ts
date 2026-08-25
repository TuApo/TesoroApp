import { ChangeDetectionStrategy, Component, Inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatRadioModule } from '@angular/material/radio';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Comparticion, VisibilidadReporte } from '../models/reportes.models';

/**
 * Compartir un reporte o un tablero (§20 "Visibilidad", §22).
 *
 * Un detalle que importa: compartir un TABLERO no da acceso a los reportes que lo
 * alimentan. Cada uno conserva su propia visibilidad, y el servidor lo respeta
 * widget por widget. Se le dice al usuario aquí para que no se lleve la sorpresa.
 */
@Component({
  selector: 'app-compartir-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatIconModule, MatRadioModule, MatTooltipModule],
  template: `
  <h2 mat-dialog-title class="tit"><mat-icon>share</mat-icon> Compartir «{{ data.nombre }}»</h2>

  <mat-dialog-content class="cuerpo">
    <mat-radio-group [(ngModel)]="visibilidad" class="vis">
      <mat-radio-button value="PRIVADO">
        <b>Privado</b><span>Solo tú puedes verlo</span>
      </mat-radio-button>
      <mat-radio-button value="ROL">
        <b>Por rol</b><span>Quienes tengan alguno de los roles que elijas</span>
      </mat-radio-button>
      <mat-radio-button value="USUARIOS">
        <b>Personas concretas</b><span>Solo quienes agregues a la lista</span>
      </mat-radio-button>
      <mat-radio-button value="ORGANIZACION">
        <b>Toda la organización</b><span>Cualquiera con acceso al módulo</span>
      </mat-radio-button>
    </mat-radio-group>

    @if (visibilidad === 'ROL' || visibilidad === 'USUARIOS') {
      <div class="agregar">
        <mat-form-field appearance="outline" class="agregar__tipo" subscriptSizing="dynamic">
          <mat-label>Tipo</mat-label>
          <mat-select [(ngModel)]="tipoNuevo">
            <mat-option value="ROL">Rol</mat-option>
            <mat-option value="USUARIO">Usuario</mat-option>
            <mat-option value="GRUPO">Grupo</mat-option>
            <mat-option value="SEDE">Oficina</mat-option>
          </mat-select>
        </mat-form-field>

        @if (tipoNuevo === 'ROL' && data.roles.length) {
          <mat-form-field appearance="outline" class="agregar__ref" subscriptSizing="dynamic">
            <mat-label>Rol</mat-label>
            <mat-select [(ngModel)]="refNueva">
              @for (r of data.roles; track r.nombre) {
                <mat-option [value]="r.nombre">{{ r.nombre }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        } @else {
          <mat-form-field appearance="outline" class="agregar__ref" subscriptSizing="dynamic">
            <mat-label>{{ tipoNuevo === 'USUARIO' ? 'Id o correo del usuario' : 'Identificador' }}</mat-label>
            <input matInput [(ngModel)]="refNueva">
          </mat-form-field>
        }

        <mat-form-field appearance="outline" class="agregar__perm" subscriptSizing="dynamic">
          <mat-label>Permiso</mat-label>
          <mat-select [(ngModel)]="permisoNuevo">
            <mat-option value="VER">Puede ver</mat-option>
            <mat-option value="EDITAR">Puede editar</mat-option>
          </mat-select>
        </mat-form-field>

        <button mat-flat-button color="primary" [disabled]="!refNueva.trim()" (click)="agregar()">
          <mat-icon>add</mat-icon>
        </button>
      </div>

      <div class="lista">
        @for (c of lista(); track c.sujeto_tipo + c.sujeto_ref) {
          <div class="fila">
            <mat-icon>{{ icono(c.sujeto_tipo) }}</mat-icon>
            <span class="fila__ref">{{ c.sujeto_nombre || c.sujeto_ref }}</span>
            <span class="fila__perm">{{ c.permiso === 'EDITAR' ? 'Puede editar' : 'Puede ver' }}</span>
            <button mat-icon-button (click)="quitar(c)" matTooltip="Quitar">
              <mat-icon>close</mat-icon>
            </button>
          </div>
        }
        @if (!lista().length) {
          <p class="lista__vacia">Todavía no lo compartiste con nadie.</p>
        }
      </div>
    }

    @if (data.esTablero) {
      <p class="nota">
        <mat-icon>info</mat-icon>
        Compartir el tablero no da acceso a los reportes que lo alimentan. Quien no
        pueda ver un reporte verá ese componente vacío, con el motivo.
      </p>
    }
  </mat-dialog-content>

  <mat-dialog-actions align="end">
    <button mat-button mat-dialog-close>Cancelar</button>
    <button mat-flat-button color="primary" (click)="guardar()">Guardar</button>
  </mat-dialog-actions>
  `,
  styles: [`
    .tit { display: flex; align-items: center; gap: .4rem; }
    .cuerpo { min-width: min(560px, 92vw); padding-top: .5rem !important; }
    .vis { display: flex; flex-direction: column; gap: .3rem; margin-bottom: .8rem; }
    .vis b { display: block; font-size: .86rem; }
    .vis span { display: block; font-size: .74rem; color: #64748b; }

    .agregar { display: flex; gap: .4rem; align-items: flex-start; margin-bottom: .6rem; flex-wrap: wrap; }
    .agregar__tipo { width: 110px; }
    .agregar__ref { flex: 1; min-width: 150px; }
    .agregar__perm { width: 140px; }

    .lista { display: flex; flex-direction: column; gap: .2rem; }
    .fila {
      display: flex; align-items: center; gap: .4rem; padding: .3rem .45rem;
      border-radius: 8px; background: #f8fafc;
    }
    .fila mat-icon { font-size: 17px; width: 17px; height: 17px; color: #64748b; }
    .fila__ref { flex: 1; font-size: .82rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fila__perm { font-size: .72rem; color: #64748b; }
    .lista__vacia { font-size: .78rem; color: #94a3b8; margin: .3rem 0; }

    .nota {
      display: flex; gap: .35rem; margin: .8rem 0 0; padding: .5rem .6rem;
      font-size: .76rem; border-radius: 10px;
      background: #f0f9ff; border: 1px solid #bae6fd; color: #0369a1;
    }
    .nota mat-icon { font-size: 16px; width: 16px; height: 16px; flex: 0 0 auto; }

    :host-context(.dark-theme) .fila { background: #1e293b; }
  `],
})
export class CompartirDialogComponent {

  visibilidad: VisibilidadReporte;
  tipoNuevo: Comparticion['sujeto_tipo'] = 'ROL';
  refNueva = '';
  permisoNuevo: 'VER' | 'EDITAR' = 'VER';

  private readonly _lista = signal<Comparticion[]>([]);
  readonly lista = this._lista.asReadonly();

  constructor(
    private ref: MatDialogRef<CompartirDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: {
      nombre: string;
      visibilidad: VisibilidadReporte;
      comparticiones: Comparticion[];
      roles: { nombre: string }[];
      esTablero?: boolean;
    },
  ) {
    this.visibilidad = data.visibilidad;
    this._lista.set([...(data.comparticiones ?? [])]);
  }

  agregar(): void {
    const ref = this.refNueva.trim();
    if (!ref) return;
    if (this._lista().some(c => c.sujeto_tipo === this.tipoNuevo && c.sujeto_ref === ref)) return;
    this._lista.update(l => [...l, {
      sujeto_tipo: this.tipoNuevo,
      sujeto_ref: ref,
      sujeto_nombre: ref,
      permiso: this.permisoNuevo,
    }]);
    this.refNueva = '';
  }

  quitar(c: Comparticion): void {
    this._lista.update(l => l.filter(x => !(x.sujeto_tipo === c.sujeto_tipo && x.sujeto_ref === c.sujeto_ref)));
  }

  icono(tipo: string): string {
    switch (tipo) {
      case 'ROL': return 'badge';
      case 'USUARIO': return 'person';
      case 'GRUPO': return 'groups';
      case 'SEDE': return 'store';
      default: return 'label';
    }
  }

  guardar(): void {
    this.ref.close({
      visibilidad: this.visibilidad,
      comparticiones: this.visibilidad === 'ROL' || this.visibilidad === 'USUARIOS' ? this._lista() : [],
    });
  }
}
