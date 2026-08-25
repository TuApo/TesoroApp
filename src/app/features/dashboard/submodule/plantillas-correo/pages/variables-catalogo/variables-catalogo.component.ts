import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Title } from '@angular/platform-browser';

import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';

import { firstValueFrom } from 'rxjs';
import Swal from 'sweetalert2';

import { PlantillasCorreoService } from '../../services/plantillas-correo.service';
import { OrigenDatos, TipoVariable, Variable } from '../../models/plantilla-correo.model';

/**
 * Catálogo de variables: qué orígenes de datos hay y qué campos expone cada uno.
 *
 * <h3>Qué problema resuelve esta pantalla</h3>
 * El gestor de plantillas que existía antes (Nómina) tenía sus campos escritos
 * en un `Map` de Java. Añadir uno significaba tocar código y desplegar
 * `ms-payroll`. Aquí, un campo nuevo es una fila; el motor lo ofrece en el
 * editor la próxima vez que alguien abra una plantilla.
 *
 * <h3>Lo que no se puede hacer, y por qué</h3>
 * La clave de una variable y el código de un origen no se editan una vez
 * creados: son lo que citan las plantillas ya publicadas. Renombrarlos las
 * dejaría apuntando a la nada, y el correo saldría con el marcador literal en
 * medio del texto. Una variable tampoco se borra: se desactiva.
 */
@Component({
  selector: 'app-variables-catalogo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule, RouterLink,
    MatButtonModule, MatCardModule, MatChipsModule, MatFormFieldModule, MatIconModule,
    MatInputModule, MatProgressBarModule, MatSelectModule, MatSnackBarModule,
    MatTableModule, MatTooltipModule,
  ],
  templateUrl: './variables-catalogo.component.html',
  styleUrl: './variables-catalogo.component.css',
})
export class VariablesCatalogoComponent implements OnInit {
  private srv = inject(PlantillasCorreoService);
  private snack = inject(MatSnackBar);
  private titulo = inject(Title);

  readonly columnas = ['clave', 'etiqueta', 'grupo', 'tipo', 'ejemplo', 'acciones'];
  readonly tipos: TipoVariable[] = [
    'TEXTO', 'NUMERO', 'FECHA', 'FECHA_HORA', 'MONEDA', 'BOOLEANO',
    'CORREO', 'TELEFONO', 'ENLACE', 'IMAGEN', 'HTML',
  ];

  readonly cargando = signal(false);
  readonly origenes = signal<OrigenDatos[]>([]);
  readonly origenSel = signal<OrigenDatos | null>(null);
  readonly variables = signal<Variable[]>([]);
  readonly filtro = signal('');

  readonly filtradas = computed(() => {
    const q = this.filtro().trim().toLowerCase();
    if (!q) return this.variables();
    return this.variables().filter(
      (v) => v.clave.toLowerCase().includes(q) || v.etiqueta.toLowerCase().includes(q)
          || v.grupo.toLowerCase().includes(q));
  });

  /** Ver el comentario del mismo método en PanelVariablesComponent: las llaves
   *  escapadas en el HTML se convierten en una interpolación real. */
  marcador(clave: string): string {
    return `{{${clave}}}`;
  }

  async ngOnInit(): Promise<void> {
    this.titulo.setTitle('Catálogo de variables | Plantillas de correo');
    await this.recargarOrigenes();
  }

  async recargarOrigenes(): Promise<void> {
    this.cargando.set(true);
    try {
      const lista = await firstValueFrom(this.srv.origenes(false));
      this.origenes.set(lista);
      const actual = this.origenSel();
      const elegido = actual ? lista.find((o) => o.id === actual.id) ?? lista[0] : lista[0];
      if (elegido) await this.elegirOrigen(elegido);
    } catch (e: any) {
      this.snack.open(e?.error?.error ?? 'No se pudo cargar el catálogo.', 'Cerrar', { duration: 5000 });
    } finally {
      this.cargando.set(false);
    }
  }

  async elegirOrigen(o: OrigenDatos): Promise<void> {
    this.origenSel.set(o);
    try {
      this.variables.set(await firstValueFrom(this.srv.variables(o.id)));
    } catch {
      this.variables.set([]);
    }
  }

  /**
   * Prueba el origen contra su microservicio. Es lo que convierte "los correos
   * salen sin datos" en "ms-hr no está respondiendo", sin abrir un log.
   */
  async probar(): Promise<void> {
    const o = this.origenSel();
    if (!o) return;

    const res = await Swal.fire({
      title: `Probar «${o.nombre}»`,
      input: 'text',
      inputPlaceholder: 'Clave del sujeto (ej. candidato:123). Vacío = solo comprobar conexión',
      showCancelButton: true, confirmButtonText: 'Probar', cancelButtonText: 'Cancelar',
    });
    if (!res.isConfirmed) return;

    try {
      const r = await firstValueFrom(this.srv.probarOrigen(o.id, res.value || null));
      await Swal.fire({
        title: r.ok ? 'El origen responde' : 'El origen no respondió',
        html: r.payload
          ? `<pre style="text-align:left;max-height:340px;overflow:auto;font-size:11.5px">${
              JSON.stringify(r.payload, null, 2).replace(/</g, '&lt;')}</pre>`
          : (r.mensaje ?? ''),
        icon: r.ok ? 'success' : 'error', width: 640,
      });
    } catch (e: any) {
      this.snack.open(e?.error?.error ?? 'No se pudo probar el origen.', 'Cerrar', { duration: 5000 });
    }
  }

  async nuevaVariable(): Promise<void> {
    const o = this.origenSel();
    if (!o) return;
    const gruposExistentes = [...new Set(this.variables().map((v) => v.grupo))];

    const res = await Swal.fire({
      title: 'Nueva variable',
      html: `
        <input id="v-clave" class="swal2-input" placeholder="Clave (ej. contrato.fecha_ingreso)">
        <input id="v-etiqueta" class="swal2-input" placeholder="Etiqueta visible">
        <input id="v-grupo" class="swal2-input" list="v-grupos" placeholder="Grupo">
        <datalist id="v-grupos">${gruposExistentes.map((g) => `<option value="${g}">`).join('')}</datalist>
        <select id="v-tipo" class="swal2-select" style="width:80%">
          ${this.tipos.map((t) => `<option value="${t}">${t}</option>`).join('')}
        </select>
        <input id="v-ejemplo" class="swal2-input" placeholder="Valor de ejemplo (para la vista previa)">
        <p style="font-size:12px;color:#64748b;text-align:left;margin:8px 0 0">
          La <b>clave</b> es la ruta dentro del JSON que devuelve el microservicio, y es lo que se
          escribe entre llaves. No se puede cambiar después.
        </p>`,
      focusConfirm: false, showCancelButton: true, width: 560,
      confirmButtonText: 'Crear', cancelButtonText: 'Cancelar', confirmButtonColor: '#0f766e',
      preConfirm: () => {
        const clave = (document.getElementById('v-clave') as HTMLInputElement)?.value?.trim();
        const etiqueta = (document.getElementById('v-etiqueta') as HTMLInputElement)?.value?.trim();
        if (!clave || !etiqueta) { Swal.showValidationMessage('Clave y etiqueta son obligatorias'); return false; }
        return {
          clave, etiqueta,
          grupo: (document.getElementById('v-grupo') as HTMLInputElement)?.value?.trim() || 'General',
          tipo: (document.getElementById('v-tipo') as HTMLSelectElement)?.value,
          ejemplo: (document.getElementById('v-ejemplo') as HTMLInputElement)?.value?.trim() || null,
        };
      },
    });
    if (!res.isConfirmed || !res.value) return;

    try {
      await firstValueFrom(this.srv.crearVariable(o.id, res.value));
      await this.elegirOrigen(o);
      this.snack.open('Variable creada. Ya está disponible en el editor.', 'Cerrar', { duration: 3000 });
    } catch (e: any) {
      this.snack.open(e?.error?.error ?? 'No se pudo crear la variable.', 'Cerrar', { duration: 5000 });
    }
  }

  async editarVariable(v: Variable): Promise<void> {
    const res = await Swal.fire({
      title: `Editar «${v.clave}»`,
      html: `
        <input id="e-etiqueta" class="swal2-input" placeholder="Etiqueta" value="${v.etiqueta}">
        <input id="e-grupo" class="swal2-input" placeholder="Grupo" value="${v.grupo}">
        <select id="e-tipo" class="swal2-select" style="width:80%">
          ${this.tipos.map((t) => `<option value="${t}" ${t === v.tipo ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        <input id="e-formato" class="swal2-input" placeholder="Formato (dd/MM/yyyy, Si/No…)" value="${v.formato ?? ''}">
        <input id="e-ejemplo" class="swal2-input" placeholder="Ejemplo" value="${v.ejemplo ?? ''}">`,
      focusConfirm: false, showCancelButton: true, width: 560,
      confirmButtonText: 'Guardar', cancelButtonText: 'Cancelar', confirmButtonColor: '#0f766e',
      preConfirm: () => ({
        etiqueta: (document.getElementById('e-etiqueta') as HTMLInputElement)?.value?.trim(),
        grupo: (document.getElementById('e-grupo') as HTMLInputElement)?.value?.trim(),
        tipo: (document.getElementById('e-tipo') as HTMLSelectElement)?.value,
        formato: (document.getElementById('e-formato') as HTMLInputElement)?.value?.trim() || null,
        ejemplo: (document.getElementById('e-ejemplo') as HTMLInputElement)?.value?.trim() || null,
      }),
    });
    if (!res.isConfirmed || !res.value) return;

    try {
      await firstValueFrom(this.srv.actualizarVariable(v.id, res.value));
      const o = this.origenSel();
      if (o) await this.elegirOrigen(o);
    } catch (e: any) {
      this.snack.open(e?.error?.error ?? 'No se pudo guardar.', 'Cerrar', { duration: 5000 });
    }
  }

  async desactivar(v: Variable): Promise<void> {
    const res = await Swal.fire({
      title: `¿Desactivar «${v.clave}»?`,
      text: 'Deja de ofrecerse en el editor, pero las plantillas publicadas que ya la citan '
          + 'la siguen resolviendo. No se borra a propósito.',
      icon: 'warning', showCancelButton: true,
      confirmButtonText: 'Desactivar', cancelButtonText: 'Cancelar', confirmButtonColor: '#dc2626',
    });
    if (!res.isConfirmed) return;
    try {
      await firstValueFrom(this.srv.desactivarVariable(v.id));
      const o = this.origenSel();
      if (o) await this.elegirOrigen(o);
    } catch (e: any) {
      this.snack.open(e?.error?.error ?? 'No se pudo desactivar.', 'Cerrar', { duration: 5000 });
    }
  }
}
