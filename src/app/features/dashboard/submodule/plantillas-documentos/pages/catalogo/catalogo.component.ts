import { Component, OnDestroy, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import Swal from 'sweetalert2';

import { StandardFilterTable } from '@/app/shared/components/standard-filter-table/standard-filter-table';
import { ColumnCellTemplateDirective } from '@/app/shared/directives/column-cell-template.directive';
import { ColumnDefinition } from '@/app/shared/models/advanced-table-interface';

import { PlantillasService } from '../../services/plantillas.service';
import { Plantilla, ModoPlantilla, MODOS } from '../../models/plantillas.models';

/**
 * Catálogo de documentos parametrizables.
 *
 * La columna que importa es "Generado por": mientras diga «Sistema anterior»,
 * ese documento se sigue produciendo como siempre y esta plantilla no afecta a
 * nadie. Cambiarlo es el corte, y por eso pide confirmación explícita.
 */
@Component({
  selector: 'app-plantillas-catalogo',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatCardModule, MatTableModule, MatButtonModule,
    MatIconModule, MatChipsModule, MatTooltipModule, MatProgressSpinnerModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatSnackBarModule,
    StandardFilterTable, ColumnCellTemplateDirective,
  ],
  templateUrl: './catalogo.component.html',
  styleUrl: './catalogo.component.css',
})
export class CatalogoComponent implements OnInit, OnDestroy {
  private srv = inject(PlantillasService);
  private router = inject(Router);
  private snack = inject(MatSnackBar);
  private saneador = inject(DomSanitizer);

  readonly MODOS = MODOS;

  /** Definición para la tabla estándar del proyecto (filtros, orden, export). */
  readonly columnasTabla: ColumnDefinition[] = [
    { name: 'nombre',   header: 'Documento',        type: 'custom', filterable: true,  sortable: true,  width: '40%' },
    { name: 'modo',     header: 'Cómo se construye', type: 'custom', filterable: true, sortable: true,  width: '20%' },
    { name: 'motor',    header: 'Generado por',     type: 'custom', filterable: true,  sortable: true,  width: '20%' },
    { name: 'acciones', header: 'Acciones',         type: 'custom', filterable: false, sortable: false, width: '20%', align: 'center' },
  ];

  /**
   * El documento que se está mirando. Se guarda el object URL para poder
   * revocarlo: cada previsualización que no se libera se queda en memoria
   * mientras viva la pestaña.
   */
  readonly visor = signal<{ plantilla: Plantilla; url: string; segura: SafeResourceUrl } | null>(null);
  readonly cargandoVisor = signal<number | null>(null);

  readonly cargando = signal(true);
  readonly plantillas = signal<Plantilla[]>([]);
  readonly filtro = signal('');

  readonly filtradas = computed(() => {
    const f = this.filtro().trim().toLowerCase();
    if (!f) return this.plantillas();
    return this.plantillas().filter(p =>
      p.nombre.toLowerCase().includes(f) || p.clave.toLowerCase().includes(f));
  });

  /** Cuántos documentos ya salen por el motor nuevo: el avance de la migración. */
  readonly cortados = computed(() => this.plantillas().filter(p => p.motor === 'TEMPLATES').length);

  ngOnInit(): void { this.cargar(); }

  cargar(): void {
    this.cargando.set(true);
    this.srv.listar().subscribe({
      next: p => { this.plantillas.set(p); this.cargando.set(false); },
      error: () => {
        this.cargando.set(false);
        this.snack.open('No se pudo cargar el catálogo de documentos.', 'Cerrar', { duration: 6000 });
      },
    });
  }

  ngOnDestroy(): void { this.cerrarVisor(); }

  /**
   * Ver el documento, sea del tipo que sea.
   *
   * El PDF se descarga con HttpClient y NO por la URL directa: la API exige la
   * cabecera Authorization y un <iframe src> no la manda — devolvería 401 y el
   * visor saldría en blanco. Ya pasó con las imágenes de las páginas.
   */
  verDocumento(p: Plantilla): void {
    this.cargandoVisor.set(p.id);
    this.srv.previsualizarPlantilla(p.id).subscribe({
      next: blob => {
        this.cargandoVisor.set(null);
        this.cerrarVisor();
        const url = URL.createObjectURL(blob);
        // El object URL sale de un blob que acabamos de descargar de nuestra
        // propia API; Angular no deja pintarlo en un iframe sin decírselo.
        this.visor.set({ plantilla: p, url, segura: this.saneador.bypassSecurityTrustResourceUrl(url) });
      },
      error: async e => {
        this.cargandoVisor.set(null);
        Swal.fire('No se puede ver todavía', await this.motivo(e), 'info');
      },
    });
  }

  /**
   * El motivo real del error.
   *
   * Con `responseType: 'blob'` el cuerpo de error TAMBIÉN llega como Blob, así
   * que hay que leerlo como texto o se pierde el mensaje del backend —que es
   * justo el que dice qué falta: la versión, o el formato sin cargar—.
   */
  private async motivo(e: unknown): Promise<string> {
    const err = e as { error?: unknown };
    try {
      if (err?.error instanceof Blob) {
        const texto = await err.error.text();
        return JSON.parse(texto)?.message ?? texto;
      }
      return (err?.error as { message?: string })?.message
        ?? 'Este documento aún no tiene una versión con su formato cargado.';
    } catch {
      return 'Este documento aún no tiene una versión con su formato cargado.';
    }
  }

  cerrarVisor(): void {
    const v = this.visor();
    if (v) URL.revokeObjectURL(v.url);
    this.visor.set(null);
  }

  descargarVisto(): void {
    const v = this.visor();
    if (!v) return;
    const a = document.createElement('a');
    a.href = v.url;
    a.download = `${v.plantilla.clave}-previsualizacion.pdf`;
    a.click();
  }

  etiquetaModo(m: ModoPlantilla): string {
    return MODOS.find(x => x.value === m)?.label ?? m;
  }

  ayudaModo(m: ModoPlantilla): string {
    return MODOS.find(x => x.value === m)?.ayuda ?? '';
  }

  abrir(p: Plantilla): void {
    this.router.navigate(['/dashboard/plantillas-documentos', p.id]);
  }

  async nueva(): Promise<void> {
    const { value } = await Swal.fire({
      title: 'Nuevo documento',
      html:
        `<input id="pn" class="swal2-input" placeholder="Nombre, p. ej. Certificado laboral">` +
        `<input id="pc" class="swal2-input" placeholder="Clave corta, p. ej. certificado-laboral">` +
        `<select id="pm" class="swal2-input">` +
        MODOS.map(m => `<option value="${m.value}">${m.label}</option>`).join('') +
        `</select>`,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Crear',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const nombre = (document.getElementById('pn') as HTMLInputElement).value.trim();
        const clave = (document.getElementById('pc') as HTMLInputElement).value.trim();
        const modo = (document.getElementById('pm') as HTMLSelectElement).value as ModoPlantilla;
        if (!nombre || !clave) {
          Swal.showValidationMessage('Hacen falta el nombre y la clave.');
          return false;
        }
        if (!/^[a-z0-9-]+$/.test(clave)) {
          Swal.showValidationMessage('La clave solo admite minúsculas, números y guiones.');
          return false;
        }
        return { nombre, clave, modo };
      },
    });
    if (!value) return;

    this.srv.crear(value).subscribe({
      next: p => { this.snack.open(`«${p.nombre}» creado.`, 'Cerrar', { duration: 4000 }); this.cargar(); },
      error: e => Swal.fire('No se pudo crear',
        e?.error?.message ?? 'Puede que ya exista un documento con esa clave.', 'error'),
    });
  }

  /**
   * El corte. Se pregunta con las consecuencias delante porque a partir de ese
   * momento los documentos de esa clase salen por el motor nuevo, para todos.
   */
  async cambiarMotor(p: Plantilla): Promise<void> {
    const aNuevo = p.motor === 'LEGACY';
    const r = await Swal.fire({
      title: aNuevo ? '¿Pasar al motor nuevo?' : '¿Volver al sistema anterior?',
      html: aNuevo
        ? `A partir de ahora <b>${p.nombre}</b> se generará con esta plantilla, para todo el mundo.` +
          `<br><br>Antes conviene haber comparado una salida real con la del sistema anterior.`
        : `<b>${p.nombre}</b> volverá a generarse como antes. La plantilla se conserva.`,
      icon: aNuevo ? 'warning' : 'question',
      showCancelButton: true,
      confirmButtonText: aNuevo ? 'Sí, cortar' : 'Sí, volver atrás',
      cancelButtonText: 'Cancelar',
    });
    if (!r.isConfirmed) return;

    this.srv.cambiarMotor(p.id, aNuevo ? 'TEMPLATES' : 'LEGACY').subscribe({
      next: () => { this.snack.open('Hecho.', 'Cerrar', { duration: 3000 }); this.cargar(); },
      error: e => Swal.fire('No se pudo cambiar',
        // El backend se niega si no hay versión publicada: ese mensaje es útil.
        e?.error?.message ?? 'Revise que la plantilla tenga una versión publicada.', 'error'),
    });
  }

  /** Carga de una vez los formatos que la empresa ya usa. */
  async sembrar(): Promise<void> {
    const { value: dir } = await Swal.fire({
      title: 'Cargar los formatos actuales',
      text: 'Ruta en el servidor donde están los PDF de origen.',
      input: 'text',
      inputValue: '/data/formatos-origen',
      showCancelButton: true,
      confirmButtonText: 'Cargar',
      cancelButtonText: 'Cancelar',
    });
    if (!dir) return;

    this.srv.sembrarFormatos(dir).subscribe({
      next: r => {
        const fallos = r.detalle.filter(x => x.estado !== 'CARGADO');
        Swal.fire({
          icon: fallos.length ? 'warning' : 'success',
          title: `${r.cargados} de ${r.total} formatos cargados`,
          html: fallos.length
            ? 'No se pudieron cargar:<br>' + fallos.map(f => `• ${f.clave}: ${f.detalle}`).join('<br>')
            : 'Cada documento quedó con su PDF y un borrador abierto, listo para mapear.',
        });
        this.cargar();
      },
      error: e => Swal.fire('No se pudieron cargar',
        e?.error?.message ?? 'Revise que la ruta exista en el servidor.', 'error'),
    });
  }
}
