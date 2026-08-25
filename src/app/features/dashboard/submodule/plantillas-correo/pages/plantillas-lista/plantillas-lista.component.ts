import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Title } from '@angular/platform-browser';

import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';

import { firstValueFrom } from 'rxjs';
import Swal from 'sweetalert2';

import {
  ImportarHtmlDialogComponent, DatosImportar,
} from '../../components/importar-html-dialog/importar-html-dialog.component';
import { PlantillasCorreoService } from '../../services/plantillas-correo.service';
import { OrigenDatos, PlantillaResumen } from '../../models/plantilla-correo.model';

/**
 * Administración → Plantillas de correo (listado).
 *
 * <h3>Por qué tarjetas y no una tabla</h3>
 * Lo que distingue a una plantilla de otra es cómo se ve y a quién va, no una
 * fila de columnas. La tarjeta muestra de un vistazo lo que de verdad se
 * consulta: el asunto real, si tiene cambios sin publicar y qué origen de datos
 * usa. Un catálogo de plantillas se navega mirando, no ordenando.
 */
@Component({
  selector: 'app-plantillas-lista',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule, RouterLink,
    MatButtonModule, MatCardModule, MatChipsModule, MatDialogModule, MatFormFieldModule,
    MatIconModule, MatInputModule, MatMenuModule, MatProgressBarModule, MatSelectModule,
    MatSnackBarModule, MatTooltipModule,
  ],
  templateUrl: './plantillas-lista.component.html',
  styleUrl: './plantillas-lista.component.css',
})
export class PlantillasListaComponent implements OnInit {
  private srv = inject(PlantillasCorreoService);
  private router = inject(Router);
  private snack = inject(MatSnackBar);
  private titulo = inject(Title);
  private dialogo = inject(MatDialog);

  readonly cargando = signal(false);
  readonly plantillas = signal<PlantillaResumen[]>([]);
  readonly categorias = signal<string[]>([]);
  readonly origenes = signal<OrigenDatos[]>([]);

  readonly filtroEstado = signal<string>('TODOS');
  readonly filtroCategoria = signal<string>('');
  readonly filtroTexto = signal<string>('');

  readonly destacadas = computed(() => this.plantillas().filter((p) => p.destacada));
  readonly resto = computed(() => this.plantillas().filter((p) => !p.destacada));

  async ngOnInit(): Promise<void> {
    this.titulo.setTitle('Plantillas de correo | Administración');
    await this.recargar();
  }

  async recargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const [lista, cats, orig] = await Promise.all([
        firstValueFrom(this.srv.listar({
          estado: this.filtroEstado() === 'TODOS' ? null : this.filtroEstado(),
          categoria: this.filtroCategoria() || null,
          q: this.filtroTexto() || null,
        })),
        firstValueFrom(this.srv.categorias()),
        firstValueFrom(this.srv.origenes(true)),
      ]);
      this.plantillas.set(lista);
      this.categorias.set(cats.filter(Boolean));
      this.origenes.set(orig);
    } catch (e: any) {
      this.snack.open(e?.error?.error ?? 'No se pudieron cargar las plantillas.', 'Cerrar', { duration: 5000 });
    } finally {
      this.cargando.set(false);
    }
  }

  /**
   * Alta. Se pide el origen de datos en el momento de crear y no después porque
   * es lo que decide qué variables ofrece el editor: elegirlo a mitad de la
   * redacción significa haber escrito media plantilla a ciegas.
   */
  async crear(copiarDe?: PlantillaResumen): Promise<void> {
    const opciones = this.origenes()
      .map((o) => `<option value="${o.codigo}">${o.nombre}</option>`).join('');

    const res = await Swal.fire({
      title: copiarDe ? `Duplicar «${copiarDe.nombre}»` : 'Nueva plantilla de correo',
      html: `
        <input id="pc-nombre" class="swal2-input" placeholder="Nombre de la plantilla"
               value="${copiarDe ? `Copia de ${copiarDe.nombre}` : ''}">
        <input id="pc-categoria" class="swal2-input" placeholder="Categoría (CONTRATACION, NOMINA…)"
               value="${copiarDe?.categoria ?? ''}">
        <select id="pc-origen" class="swal2-select" style="width:80%">
          <option value="">— Sin origen de datos —</option>
          ${opciones}
        </select>`,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Crear', cancelButtonText: 'Cancelar', confirmButtonColor: '#0f766e',
      didOpen: () => {
        const sel = document.getElementById('pc-origen') as HTMLSelectElement | null;
        if (sel && copiarDe?.origen_codigo) sel.value = copiarDe.origen_codigo;
      },
      preConfirm: () => {
        const nombre = (document.getElementById('pc-nombre') as HTMLInputElement)?.value?.trim();
        if (!nombre) { Swal.showValidationMessage('El nombre es obligatorio'); return false; }
        return {
          nombre,
          categoria: (document.getElementById('pc-categoria') as HTMLInputElement)?.value?.trim() || null,
          origen_codigo: (document.getElementById('pc-origen') as HTMLSelectElement)?.value || null,
        };
      },
    });
    if (!res.isConfirmed || !res.value) return;

    try {
      const d = await firstValueFrom(this.srv.crear({ ...res.value, copiar_de: copiarDe?.id ?? null }));
      void this.router.navigate(['/dashboard/gestion-del-programa/plantillas-correo', d.plantilla.id]);
    } catch (e: any) {
      this.snack.open(e?.error?.error ?? 'No se pudo crear la plantilla.', 'Cerrar', { duration: 5000 });
    }
  }

  /**
   * Abre el asistente de importación. Al terminar lleva directo al editor: lo
   * importado queda como BORRADOR y hay que revisarlo antes de publicarlo, así
   * que dejar al usuario en el listado sería dejarlo a medias.
   */
  async importar(): Promise<void> {
    const ref = this.dialogo.open(ImportarHtmlDialogComponent, {
      data: {
        origenes: this.origenes(),
        plantillas: this.plantillas(),
        plantillaDestino: null,
      } satisfies DatosImportar,
      maxWidth: '96vw',
    });
    const r = await firstValueFrom(ref.afterClosed());
    if (!r) return;

    await Swal.fire({
      title: 'Plantilla importada',
      html: `${r.placeholders_reemplazados} marcador(es) emparejados y `
          + `${r.imagenes_importadas} imagen(es) en la biblioteca.`
          + (r.avisos.length ? `<div style="text-align:left;font-size:12.5px;margin-top:10px">`
              + r.avisos.map((a: string) => `• ${a}`).join('<br>') + '</div>' : '')
          + '<div style="font-size:12.5px;margin-top:10px">Se guardó como <b>borrador</b>.</div>',
      icon: 'success', confirmButtonColor: '#0f766e', width: 620,
    });
    void this.router.navigate(
      ['/dashboard/gestion-del-programa/plantillas-correo', r.plantilla.plantilla.id]);
  }

  /** Archivar es la única "eliminación": el histórico de envíos sigue teniendo sentido. */
  async archivar(p: PlantillaResumen): Promise<void> {
    const res = await Swal.fire({
      title: `¿Archivar «${p.nombre}»?`,
      text: 'Deja de ofrecerse para envíos nuevos. No se borra: sus versiones quedan en el histórico.',
      icon: 'warning', showCancelButton: true,
      confirmButtonText: 'Archivar', cancelButtonText: 'Cancelar', confirmButtonColor: '#dc2626',
    });
    if (!res.isConfirmed) return;
    try {
      await firstValueFrom(this.srv.archivar(p.id));
      this.snack.open('Plantilla archivada.', 'Cerrar', { duration: 2500 });
      await this.recargar();
    } catch (e: any) {
      this.snack.open(e?.error?.error ?? 'No se pudo archivar.', 'Cerrar', { duration: 5000 });
    }
  }

  async reactivar(p: PlantillaResumen): Promise<void> {
    try {
      await firstValueFrom(this.srv.reactivar(p.id));
      await this.recargar();
    } catch (e: any) {
      this.snack.open(e?.error?.error ?? 'No se pudo reactivar.', 'Cerrar', { duration: 5000 });
    }
  }

  async alternarDestacada(p: PlantillaResumen): Promise<void> {
    try {
      await firstValueFrom(this.srv.actualizar(p.id, { destacada: !p.destacada }));
      await this.recargar();
    } catch (e: any) {
      this.snack.open(e?.error?.error ?? 'No se pudo actualizar.', 'Cerrar', { duration: 5000 });
    }
  }

  nombreOrigen(codigo: string | null): string | null {
    if (!codigo) return null;
    return this.origenes().find((o) => o.codigo === codigo)?.nombre ?? codigo;
  }
}
