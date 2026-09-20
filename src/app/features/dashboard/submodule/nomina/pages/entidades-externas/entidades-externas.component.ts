import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';

import Swal from 'sweetalert2';

import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';
import { NominaService, EntidadExterna, TipoEntidadExterna } from '../../service/nomina/nomina.service';
import { EntidadExternaFormDialogComponent, TIPOS_ENTIDAD } from './entidad-externa-form-dialog.component';

type FiltroEstado = 'activas' | 'inactivas' | 'todas';

/**
 * Submódulo Nómina → Entidades Externas. Mantenimiento con borrado lógico de la
 * tabla polimórfica nomina_entidades_externas, restringido a los tipos
 * permitidos. Listar / buscar / filtrar por tipo y estado / crear / editar /
 * desactivar / reactivar. NO existe eliminación física. Tipo y estado se
 * filtran en el backend; la búsqueda por texto, el orden y los filtros por
 * columna los hace la tabla estándar sobre el resultado.
 */
@Component({
  selector: 'app-entidades-externas',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatDialogModule,
    MatTooltipModule,
    MatSnackBarModule,
    ...TABLA_ESTANDAR,
  ],
  templateUrl: './entidades-externas.component.html',
  styleUrls: ['./entidades-externas.component.css'],
})
export class EntidadesExternasComponent implements OnInit {
  /** Lo que devolvió el backend con los filtros de tipo y estado. */
  entidades: EntidadExterna[] = [];
  isLoading = false;

  readonly TIPOS = TIPOS_ENTIDAD;
  readonly TIPO_LABEL: Record<string, string> =
    Object.fromEntries(TIPOS_ENTIDAD.map(t => [t.value, t.label]));

  filterTipo: TipoEntidadExterna | '' = '';   // '' = todos
  filterEstado: FiltroEstado = 'activas';

  readonly columnas: ColumnaTabla<EntidadExterna>[] = [
    // El nombre comercial va en el valor para que la búsqueda lo encuentre, como antes.
    { id: 'nombre', header: 'Nombre', tarjeta: 'titulo', minAncho: '200px',
      valor: (e) => (e.nombre_comercial ? `${e.nombre} — ${e.nombre_comercial}` : e.nombre) },
    { id: 'nit', header: 'NIT', valor: (e) => e.nit ?? '', formato: (e) => e.nit || '—', tarjeta: 'subtitulo' },
    { id: 'codigo', header: 'Código', valor: (e) => e.codigo ?? '', formato: (e) => e.codigo || '—',
      prioridad: 2, tarjeta: 'meta' },
    { id: 'tipo', header: 'Tipo', valor: (e) => this.tipoLabel(e.tipo), tarjeta: 'cuerpo' },
    { id: 'activo', header: 'Estado', valor: (e) => (e.activo ? 'Activa' : 'Inactiva'), tarjeta: 'badge',
      badge: (e) => e.activo
        ? { texto: 'Activa', tono: 'ok', icono: 'check_circle' }
        : { texto: 'Inactiva', tono: 'neutro', icono: 'cancel' } },
    { id: 'centros_costo_count', header: 'Centros de costo', align: 'right', prioridad: 2, tarjeta: 'meta',
      valor: (e) => (this.aplicaConteos(e) ? e.centros_costo_count : null) },
    { id: 'contratos_count', header: 'Contratos', align: 'right', prioridad: 2, tarjeta: 'meta',
      valor: (e) => (this.aplicaConteos(e) ? e.contratos_count : null) },
  ];

  readonly idEntidad = (e: EntidadExterna) => e.id;
  readonly claseFila = (e: EntidadExterna) => (e.activo ? '' : 'te-fila--atenuada');

  constructor(
    private nominaService: NominaService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.cargar();
  }

  private estadoParam(): boolean | null {
    if (this.filterEstado === 'activas') return true;
    if (this.filterEstado === 'inactivas') return false;
    return null;
  }

  cargar(): void {
    this.isLoading = true;
    this.cdr.markForCheck();
    this.nominaService.getEntidadesExternas({
      tipo: this.filterTipo || null,
      activo: this.estadoParam(),
    }).subscribe({
      next: (data) => {
        this.entidades = data ?? [];
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.snackBar.open('Error al cargar entidades externas', 'Cerrar', { duration: 3000 });
        this.isLoading = false;
        this.cdr.markForCheck();
      },
    });
  }

  /** tipo y estado se filtran en el backend → recargar. */
  onServerFilterChange(): void {
    this.cargar();
  }

  limpiarFiltros(): void {
    this.filterTipo = '';
    this.filterEstado = 'activas';
    this.cargar();
  }

  tipoLabel(tipo: string): string {
    return this.TIPO_LABEL[tipo] ?? tipo;
  }

  /** Los conteos solo aplican a EMPRESA_USUARIA (para el resto el backend manda null). */
  aplicaConteos(e: EntidadExterna): boolean {
    return e.tipo === 'EMPRESA_USUARIA';
  }

  abrirDialogoCrear(): void {
    const ref = this.dialog.open(EntidadExternaFormDialogComponent, {
      width: '640px',
      data: { entidad: null },
    });
    ref.afterClosed().subscribe((ok) => { if (ok) this.cargar(); });
  }

  abrirDialogoEditar(entidad: EntidadExterna): void {
    const ref = this.dialog.open(EntidadExternaFormDialogComponent, {
      width: '640px',
      data: { entidad },
    });
    ref.afterClosed().subscribe((ok) => { if (ok) this.cargar(); });
  }

  async desactivar(entidad: EntidadExterna): Promise<void> {
    const base = 'La entidad no será eliminada. Solo quedará inactiva y no ' +
      'aparecerá para nuevas operaciones. Las relaciones históricas se conservan.';
    const tieneDatos = (entidad.contratos_count ?? 0) > 0 || (entidad.centros_costo_count ?? 0) > 0;
    const detalle = tieneDatos
      ? `<br><br><b>Esta entidad tiene ${entidad.contratos_count ?? 0} contratos y ` +
        `${entidad.centros_costo_count ?? 0} centros de costo asociados.</b>`
      : '';

    const res = await Swal.fire({
      title: `Desactivar “${entidad.nombre}”`,
      html: `${base}${detalle}`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, desactivar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#d33',
      reverseButtons: true,
    });
    if (!res.isConfirmed) return;

    this.nominaService.desactivarEntidadExterna(entidad.id).subscribe({
      next: () => {
        this.snackBar.open('Entidad externa desactivada', 'Cerrar', { duration: 2500 });
        this.cargar();
      },
      error: (err) => {
        this.snackBar.open(err?.error?.error ?? 'No se pudo desactivar', 'Cerrar', { duration: 3500 });
      },
    });
  }

  async reactivar(entidad: EntidadExterna): Promise<void> {
    const res = await Swal.fire({
      title: `Reactivar “${entidad.nombre}”`,
      html: 'La entidad volverá a estar disponible para nuevas operaciones de nómina, según su tipo.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, reactivar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#3f51b5',
      reverseButtons: true,
    });
    if (!res.isConfirmed) return;

    this.nominaService.reactivarEntidadExterna(entidad.id).subscribe({
      next: () => {
        this.snackBar.open('Entidad externa reactivada', 'Cerrar', { duration: 2500 });
        this.cargar();
      },
      error: (err) => {
        this.snackBar.open(err?.error?.error ?? 'No se pudo reactivar', 'Cerrar', { duration: 3500 });
      },
    });
  }
}
