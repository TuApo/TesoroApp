import {
  Component, OnInit, signal, computed, ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormArray, Validators, FormGroup } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDividerModule } from '@angular/material/divider';
import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';
import { PlantillaEpsService } from '../../services/plantilla-eps.service';
import {
  PlantillaResumen, PlantillaDetalle, PlantillaRequest,
  CampoDisponible, CampoRequest,
  FUENTES_CAMPO, TIPOS_RENDER
} from '../../models/plantilla-eps.models';
import { PlantillaDialogComponent } from './plantilla-dialog.component';

/**
 * Página de administración de plantillas de documentos EPS.
 * Lista todas las plantillas configuradas con sus dimensiones y permite
 * crear, editar o desactivar cada una.
 */
@Component({
  selector: 'app-plantillas-eps',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule,
    MatCardModule, MatButtonModule, MatIconModule,
    MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatChipsModule, MatTooltipModule, MatSnackBarModule, MatExpansionModule,
    MatSlideToggleModule, MatDividerModule,
    ...TABLA_ESTANDAR,
  ],
  templateUrl: './plantillas-eps.component.html',
  styleUrls: ['./plantillas-eps.component.css'],
})
export class PlantillasEpsComponent implements OnInit {

  plantillas = signal<PlantillaResumen[]>([]);
  camposDisponibles = signal<CampoDisponible[]>([]);
  cargando = signal(false);

  filtroTemporal = signal<string | null>(null);

  /** Filtro rápido por temporal; la búsqueda por texto la hace la tabla estándar. */
  plantillasFiltradas = computed(() => {
    const tmp = this.filtroTemporal();
    return this.plantillas().filter(p => !tmp || p.temporalKey === tmp);
  });

  temporalesUnicos = computed(() =>
    [...new Set(this.plantillas().map(p => p.temporalKey).filter(Boolean))] as string[]
  );

  readonly columnas: ColumnaTabla<PlantillaResumen>[] = [
    // La búsqueda cubre nombre y clave de la EPS: las dos van en el valor.
    { id: 'epsNombre', header: 'EPS', valor: p => `${p.epsNombre} (${p.epsKey})`,
      copiaTexto: p => p.epsNombre, tarjeta: 'titulo', minAncho: '160px' },
    { id: 'temporalKey', header: 'Temporal', valor: p => p.temporalKey || 'Todas', tarjeta: 'badge',
      badge: p => p.temporalKey ? { texto: p.temporalKey, tono: 'violet' } : { texto: 'Todas', tono: 'neutro' } },
    { id: 'sexo', header: 'Sexo', valor: p => this.labelSexo(p.sexo), prioridad: 2, tarjeta: 'meta' },
    { id: 'nombre', header: 'Nombre plantilla', valor: p => p.nombrePlantilla, tarjeta: 'subtitulo' },
    { id: 'campos', header: 'Campos', valor: p => p.totalCampos, prioridad: 2, tarjeta: 'meta' },
    { id: 'activa', header: 'Estado', valor: p => (p.activa ? 'Activa' : 'Inactiva'), tarjeta: 'badge' },
  ];

  readonly idPlantilla = (p: PlantillaResumen) => p.id;
  readonly claseFila = (p: PlantillaResumen) => (p.activa ? '' : 'te-fila--atenuada');

  constructor(
    private svc: PlantillaEpsService,
    private dialog: MatDialog,
    private snack: MatSnackBar,
    private cd: ChangeDetectorRef,
  ) {}

  ngOnInit() { this.cargar(); }

  cargar() {
    this.cargando.set(true);
    this.svc.listarPlantillas().subscribe({
      next: ps => { this.plantillas.set(ps); this.cargando.set(false); },
      error: () => { this.snack.open('Error cargando plantillas', '', { duration: 3000 }); this.cargando.set(false); }
    });
    this.svc.camposDisponibles().subscribe({
      next: cs => this.camposDisponibles.set(cs),
      error: () => {}
    });
  }

  nueva() {
    this.abrirDialog(null);
  }

  editar(p: PlantillaResumen) {
    this.cargando.set(true);
    this.svc.obtenerPlantilla(p.id).subscribe({
      next: detalle => { this.cargando.set(false); this.abrirDialog(detalle); },
      error: () => { this.cargando.set(false); this.snack.open('Error cargando detalle', '', { duration: 3000 }); }
    });
  }

  private abrirDialog(detalle: PlantillaDetalle | null) {
    const ref = this.dialog.open(PlantillaDialogComponent, {
      width: '98vw',
      maxWidth: '1500px',
      maxHeight: '95vh',
      data: { detalle, camposDisponibles: this.camposDisponibles() },
      panelClass: 'plantilla-dialog',
    });
    ref.afterClosed().subscribe((req: PlantillaRequest | null) => {
      if (!req) return;
      const obs = detalle
        ? this.svc.actualizarPlantilla(detalle.id, req)
        : this.svc.crearPlantilla(req);
      obs.subscribe({
        next: saved => {
          this.snack.open(detalle ? 'Plantilla actualizada ✓' : 'Plantilla creada ✓', '', { duration: 3000 });
          this.cargar();
        },
        error: () => this.snack.open('Error guardando plantilla', '', { duration: 3000 })
      });
    });
  }

  desactivar(p: PlantillaResumen) {
    if (!confirm(`¿Desactivar la plantilla "${p.nombrePlantilla}"?`)) return;
    this.svc.desactivarPlantilla(p.id).subscribe({
      next: () => { this.snack.open('Plantilla desactivada', '', { duration: 3000 }); this.cargar(); },
      error: () => this.snack.open('Error al desactivar', '', { duration: 3000 })
    });
  }

  setFiltroTemporal(val: string | null) {
    this.filtroTemporal.set(val);
  }

  labelSexo(sexo: string | null): string {
    if (!sexo) return 'Ambos';
    return sexo === 'M' ? 'Masculino' : 'Femenino';
  }
}
