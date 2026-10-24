import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';

import { partirBloque, type ResultadoPegado } from './tabla.pegado';

/** Lo que la tabla le pasa al diálogo. */
export interface DatosPegarSeleccion {
  /** Nombre de la tabla, para encabezar el diálogo. */
  titulo: string;
  /** Columnas contra las que se probará lo pegado ("Cédula", "Código"…). */
  columnas: string[];
  /** Cuántas filas hay cargadas, para avisar si el servidor pagina. */
  filasCargadas: number;
  /** El backend tiene más filas de las que están en pantalla. */
  modoServidor: boolean;
  /** Casa el bloque contra la tabla (lo resuelve la tabla, que tiene los datos). */
  casar: (texto: string) => ResultadoPegado;
}

/**
 * PEGAR UNA LISTA PARA MARCAR FILAS — parte del estándar de la plataforma.
 *
 * El operador pega un bloque de Excel; aquí se dice cuáles de esos registros
 * están en la tabla y cuáles no, y al aceptar se devuelven las claves
 * encontradas para que la tabla las marque y se les pueda aplicar una acción
 * masiva. No modifica nada por su cuenta: solo selecciona.
 */
@Component({
  selector: 'app-pegar-seleccion-dialog',
  standalone: true,
  imports: [
    FormsModule, MatDialogModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatTooltipModule,
  ],
  templateUrl: './pegar-seleccion-dialog.component.html',
  styleUrl: './pegar-seleccion-dialog.component.css',
})
export class PegarSeleccionDialogComponent {
  readonly datos = inject<DatosPegarSeleccion>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<PegarSeleccionDialogComponent, boolean>);

  readonly texto = signal('');
  readonly resultado = signal<ResultadoPegado | null>(null);
  readonly copiado = signal(false);

  readonly lineas = computed(() => partirBloque(this.texto()).length);

  buscar(): void {
    if (!this.lineas()) { this.resultado.set(null); return; }
    this.resultado.set(this.datos.casar(this.texto()));
  }

  volver(): void {
    this.resultado.set(null);
    this.copiado.set(false);
  }

  /** Las que no aparecieron, para pegarlas en otro lado y revisarlas. */
  copiarFaltantes(): void {
    const faltan = this.resultado()?.noEncontradas ?? [];
    if (!faltan.length) return;
    navigator.clipboard?.writeText(faltan.join('\n')).then(() => {
      this.copiado.set(true);
      setTimeout(() => this.copiado.set(false), 2000);
    }).catch(() => undefined);
  }

  marcar(): void {
    this.ref.close(true);
  }

  cerrar(): void {
    this.ref.close();
  }
}
