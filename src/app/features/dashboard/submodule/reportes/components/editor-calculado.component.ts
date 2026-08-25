import { ChangeDetectionStrategy, Component, Inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatTabsModule } from '@angular/material/tabs';
import { CalculatedSpec, CampoCatalogo, FormatoCampo, FuncionCalculada, TipoCampo } from '../models/reportes.models';

/**
 * Editor de campos calculados (§14).
 *
 * El usuario escribe una expresión en el mini-lenguaje del módulo, no SQL. Este
 * editor le da lo que hace falta para no tener que aprendérselo: la lista de
 * campos disponibles (que inserta con la sintaxis correcta), el catálogo de
 * funciones con su ejemplo, y unas plantillas para los casos de siempre.
 *
 * La validación de verdad la hace el servidor al compilar; aquí solo se evita lo
 * obvio (expresión vacía, corchetes sin cerrar) para no gastar un viaje.
 */
@Component({
  selector: 'app-editor-calculado',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatIconModule, MatTooltipModule, MatTabsModule],
  template: `
  <h2 mat-dialog-title class="tit">
    <mat-icon>calculate</mat-icon>
    {{ data.existente ? 'Editar campo calculado' : 'Nuevo campo calculado' }}
  </h2>

  <mat-dialog-content class="cuerpo">
    <mat-form-field appearance="outline" class="w100">
      <mat-label>Nombre de la columna</mat-label>
      <input matInput [(ngModel)]="alias" placeholder="p. ej. Nombre completo" autofocus>
    </mat-form-field>

    <label class="lbl">Fórmula</label>
    <textarea class="formula" [(ngModel)]="expresion" rows="3" spellcheck="false"
              placeholder="CONCATENAR([hr.trabajador.primer_nombre], ' ', [hr.trabajador.primer_apellido])"
              (input)="error.set(null)"></textarea>

    @if (errorLocal(); as e) {
      <p class="err"><mat-icon>error_outline</mat-icon> {{ e }}</p>
    } @else if (data.errorServidor) {
      <p class="err"><mat-icon>error_outline</mat-icon> {{ data.errorServidor }}</p>
    }

    <div class="fila">
      <mat-form-field appearance="outline">
        <mat-label>Tipo del resultado</mat-label>
        <mat-select [(ngModel)]="tipo">
          <mat-option value="TEXTO">Texto</mat-option>
          <mat-option value="ENTERO">Número entero</mat-option>
          <mat-option value="DECIMAL">Número decimal</mat-option>
          <mat-option value="MONEDA">Moneda</mat-option>
          <mat-option value="FECHA">Fecha</mat-option>
        </mat-select>
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>Formato</mat-label>
        <mat-select [(ngModel)]="formato">
          <mat-option value="text">Texto</mat-option>
          <mat-option value="integer">Entero</mat-option>
          <mat-option value="decimal">Decimal</mat-option>
          <mat-option value="currency">Moneda</mat-option>
          <mat-option value="percent">Porcentaje</mat-option>
          <mat-option value="date">Fecha</mat-option>
        </mat-select>
      </mat-form-field>
    </div>

    <mat-tab-group class="ayuda" animationDuration="0ms">
      <mat-tab label="Plantillas">
        <div class="lista">
          @for (p of plantillas; track p.titulo) {
            <button type="button" class="item" (click)="usarPlantilla(p)">
              <mat-icon>auto_fix_high</mat-icon>
              <div>
                <b>{{ p.titulo }}</b>
                <code>{{ p.formula }}</code>
              </div>
            </button>
          }
        </div>
      </mat-tab>

      <mat-tab label="Campos">
        <div class="buscador">
          <mat-icon>search</mat-icon>
          <input type="text" [(ngModel)]="buscaCampo" placeholder="Buscar campo…">
        </div>
        <div class="lista">
          @for (c of camposFiltrados(); track c.clave) {
            <button type="button" class="item" (click)="insertar('[' + c.clave + ']')">
              <mat-icon>data_object</mat-icon>
              <div><b>{{ c.nombre }}</b><code>{{ c.clave }}</code></div>
            </button>
          }
          @if (!camposFiltrados().length) {
            <p class="sinres">Ningún campo coincide.</p>
          }
        </div>
      </mat-tab>

      <mat-tab label="Funciones">
        <div class="buscador">
          <mat-icon>search</mat-icon>
          <input type="text" [(ngModel)]="buscaFuncion" placeholder="Buscar función…">
        </div>
        <div class="lista">
          @for (f of funcionesFiltradas(); track f.nombre) {
            <button type="button" class="item" (click)="insertar(f.nombre + '(')">
              <mat-icon>functions</mat-icon>
              <div>
                <b>{{ f.nombre }}</b>
                <span class="desc">{{ f.descripcion }}</span>
                <code>{{ f.ejemplo }}</code>
              </div>
            </button>
          }
        </div>
      </mat-tab>
    </mat-tab-group>
  </mat-dialog-content>

  <mat-dialog-actions align="end">
    <button mat-button mat-dialog-close>Cancelar</button>
    <button mat-flat-button color="primary" [disabled]="!puedeGuardar()" (click)="guardar()">
      {{ data.existente ? 'Guardar cambios' : 'Agregar columna' }}
    </button>
  </mat-dialog-actions>
  `,
  styles: [`
    .tit { display: flex; align-items: center; gap: .4rem; }
    .cuerpo { display: flex; flex-direction: column; padding-top: .5rem !important; min-width: min(620px, 90vw); }
    .w100 { width: 100%; }
    .lbl { font-size: .74rem; font-weight: 600; color: #64748b; margin-bottom: .2rem; }
    .formula {
      width: 100%; box-sizing: border-box; resize: vertical;
      font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: .84rem; line-height: 1.5;
      padding: .6rem .7rem; border-radius: 10px; border: 1px solid #cbd5e1;
      background: #f8fafc; color: #0f172a;
    }
    .formula:focus { outline: 2px solid #0284c7; outline-offset: -1px; border-color: transparent; }
    .err {
      display: flex; align-items: flex-start; gap: .3rem; margin: .4rem 0 0;
      font-size: .78rem; color: #b91c1c;
    }
    .err mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .fila { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem; margin-top: .7rem; }

    .ayuda { margin-top: .5rem; }
    .buscador {
      display: flex; align-items: center; gap: .3rem; padding: .35rem .5rem; margin: .5rem 0 .3rem;
      border: 1px solid #e2e8f0; border-radius: 8px;
    }
    .buscador input { border: 0; outline: 0; flex: 1; font-size: .82rem; background: transparent; }
    .buscador mat-icon { font-size: 17px; width: 17px; height: 17px; color: #94a3b8; }

    .lista { max-height: 200px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; padding: .2rem 0; }
    .item {
      display: flex; align-items: flex-start; gap: .5rem; text-align: left;
      padding: .4rem .5rem; border: 0; border-radius: 8px; background: transparent;
      cursor: pointer; width: 100%; color: inherit; font: inherit;
    }
    .item:hover { background: #f1f5f9; }
    .item mat-icon { font-size: 17px; width: 17px; height: 17px; color: #94a3b8; margin-top: 2px; }
    .item div { display: flex; flex-direction: column; min-width: 0; }
    .item b { font-size: .82rem; font-weight: 600; }
    .item .desc { font-size: .72rem; color: #64748b; }
    .item code {
      font-size: .7rem; color: #7c3aed; background: #f5f3ff; border-radius: 4px;
      padding: 0 4px; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .sinres { font-size: .78rem; color: #94a3b8; padding: .5rem; }

    :host-context(.dark-theme) .formula { background: #0f172a; border-color: #334155; color: #e2e8f0; }
    :host-context(.dark-theme) .item:hover { background: #1e293b; }
  `],
})
export class EditorCalculadoComponent {

  alias = '';
  expresion = '';
  tipo: TipoCampo = 'TEXTO';
  formato: FormatoCampo = 'text';
  buscaCampo = '';
  buscaFuncion = '';

  readonly error = signal<string | null>(null);

  readonly plantillas = [
    { titulo: 'Nombre completo', formula: "CONCATENAR([campo.nombre], ' ', [campo.apellido])" },
    { titulo: 'Días entre dos fechas', formula: 'DIAS_ENTRE([campo.fecha_fin], [campo.fecha_inicio])' },
    { titulo: 'Edad a partir de la fecha de nacimiento', formula: 'ANIOS_ENTRE([campo.fecha_nacimiento], HOY())' },
    { titulo: 'Antigüedad en meses', formula: 'MESES_ENTRE([campo.fecha_ingreso], HOY())' },
    { titulo: 'Etiqueta según una condición', formula: "SI([campo.activo] = 1, 'Activo', 'Retirado')" },
    { titulo: 'Valor por día (sin dividir entre cero)', formula: '[campo.salario] / NULO_SI([campo.dias], 0)' },
    { titulo: 'Porcentaje', formula: 'REDONDEAR([campo.parte] * 100 / NULO_SI([campo.total], 0), 2)' },
    { titulo: 'Texto sin vacíos', formula: "SI_NULO([campo.observacion], 'Sin observación')" },
  ];

  constructor(
    private ref: MatDialogRef<EditorCalculadoComponent>,
    @Inject(MAT_DIALOG_DATA) public data: {
      campos: CampoCatalogo[];
      funciones: FuncionCalculada[];
      existente?: CalculatedSpec;
      errorServidor?: string;
    },
  ) {
    if (data.existente) {
      this.alias = data.existente.alias;
      this.expresion = data.existente.expresion;
      this.tipo = data.existente.tipo ?? 'TEXTO';
      this.formato = data.existente.formato ?? 'text';
    }
  }

  readonly camposFiltrados = computed(() => {
    const q = this.buscaCampo.trim().toLowerCase();
    const lista = this.data.campos;
    if (!q) return lista.slice(0, 60);
    return lista.filter(c =>
      c.nombre.toLowerCase().includes(q) || c.clave.toLowerCase().includes(q)).slice(0, 60);
  });

  readonly funcionesFiltradas = computed(() => {
    const q = this.buscaFuncion.trim().toLowerCase();
    const lista = this.data.funciones;
    if (!q) return lista;
    return lista.filter(f =>
      f.nombre.toLowerCase().includes(q) || f.descripcion.toLowerCase().includes(q));
  });

  /** Validación local mínima: lo demás lo dice el servidor con precisión. */
  errorLocal(): string | null {
    const e = this.error();
    if (e) return e;
    const expr = this.expresion.trim();
    if (!expr) return null;
    const abre = (expr.match(/\[/g) ?? []).length;
    const cierra = (expr.match(/\]/g) ?? []).length;
    if (abre !== cierra) return 'Hay corchetes sin cerrar en la referencia a un campo.';
    const par1 = (expr.match(/\(/g) ?? []).length;
    const par2 = (expr.match(/\)/g) ?? []).length;
    if (par1 !== par2) return 'Hay paréntesis sin cerrar.';
    const comillas = (expr.match(/'/g) ?? []).length;
    if (comillas % 2 !== 0) return 'Hay una comilla sin cerrar.';
    return null;
  }

  puedeGuardar(): boolean {
    return !!this.alias.trim() && !!this.expresion.trim() && !this.errorLocal();
  }

  insertar(texto: string): void {
    this.expresion = (this.expresion + (this.expresion && !this.expresion.endsWith('(') ? ' ' : '') + texto).trim();
  }

  usarPlantilla(p: { formula: string }): void {
    this.expresion = p.formula;
  }

  guardar(): void {
    this.ref.close({
      id: this.data.existente?.id,
      alias: this.alias.trim(),
      expresion: this.expresion.trim(),
      tipo: this.tipo,
      formato: this.formato,
    });
  }
}
