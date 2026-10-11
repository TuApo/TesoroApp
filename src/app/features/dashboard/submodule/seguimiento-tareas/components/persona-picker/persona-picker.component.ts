import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { DirectorioService, Persona, sinTildes } from '../../services/directorio.service';
import { Grupo } from '../../models/tareas.models';
import { TareaAvatarComponent } from '../avatar/avatar.component';

export type Eleccion = { tipo: 'persona'; id: string; nombre: string } | { tipo: 'grupo'; id: number; nombre: string };

/**
 * Buscador de personas (y grupos) por nombre, correo o cédula. Muestra primero a los
 * "cercanos" (miembros del espacio) y distingue homónimos con el correo: asignar a la
 * persona equivocada también le manda el aviso a la equivocada.
 *
 * Emite la elección y se limpia; quien lo usa decide cómo mostrar lo elegido.
 */
@Component({
  selector: 'app-persona-picker',
  standalone: true,
  imports: [FormsModule, MatAutocompleteModule, MatFormFieldModule, MatInputModule, MatIconModule, TareaAvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-form-field appearance="outline" class="pp" subscriptSizing="dynamic">
      <mat-icon matPrefix>person_search</mat-icon>
      <input matInput [placeholder]="placeholder()" [ngModel]="texto()" (ngModelChange)="texto.set($event)"
             [matAutocomplete]="auto" (focus)="dir.cargar()" [attr.aria-label]="placeholder()">
      <mat-autocomplete #auto="matAutocomplete" (optionSelected)="elegir($event)" [displayWith]="vacio">
        @if (!dir.listo()) {
          <mat-option disabled>Cargando personas…</mat-option>
        }
        @for (g of gruposFiltrados(); track g.id) {
          <mat-option [value]="{ tipo: 'grupo', id: g.id, nombre: g.name }">
            <span class="op">
              <app-tarea-avatar [grupo]="g.name" [tam]="26" />
              <span class="op__txt"><strong>{{ g.name }}</strong><small>Grupo · {{ g.member_count }} miembros</small></span>
            </span>
          </mat-option>
        }
        @for (p of sugerencias(); track p.id) {
          <mat-option [value]="{ tipo: 'persona', id: p.id, nombre: p.nombre }">
            <span class="op">
              <app-tarea-avatar [usuario]="p.id" [tam]="26" />
              <span class="op__txt"><strong>{{ p.nombre }}</strong><small>{{ p.email || p.documento }}{{ cercanosSet().has(p.id) ? ' · miembro' : '' }}</small></span>
            </span>
          </mat-option>
        }
        @if (dir.listo() && texto().trim().length >= 2 && !sugerencias().length && !gruposFiltrados().length) {
          <mat-option disabled>Nadie coincide con «{{ texto() }}»</mat-option>
        }
      </mat-autocomplete>
    </mat-form-field>
  `,
  styles: [`
    :host { display: block; }
    .pp { width: 100%; }
    .op { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .op__txt { display: flex; flex-direction: column; min-width: 0; line-height: 1.2; }
    .op__txt strong { font-weight: 700; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .op__txt small { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `],
})
export class PersonaPickerComponent {
  readonly dir = inject(DirectorioService);
  readonly placeholder = input('Buscar persona por nombre, correo o cédula');
  readonly cercanos = input<string[]>([]);
  readonly grupos = input<Grupo[]>([]);
  readonly excluir = input<string[]>([]);
  readonly elegido = output<Eleccion>();

  readonly texto = signal('');
  readonly cercanosSet = computed(() => new Set(this.cercanos()));

  readonly sugerencias = computed<Persona[]>(() => {
    this.dir.personas();
    const fuera = new Set(this.excluir());
    return this.dir.buscar(typeof this.texto() === 'string' ? this.texto() : '', this.cercanos(), 14)
      .filter(p => !fuera.has(p.id));
  });

  readonly gruposFiltrados = computed(() => {
    const q = sinTildes(typeof this.texto() === 'string' ? this.texto().trim() : '');
    return this.grupos().filter(g => !q || sinTildes(g.name).includes(q)).slice(0, 6);
  });

  vacio = () => '';

  elegir(ev: MatAutocompleteSelectedEvent): void {
    const v = ev.option.value as Eleccion;
    this.texto.set('');
    if (v) this.elegido.emit(v);
  }
}
