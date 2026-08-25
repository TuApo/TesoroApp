import {
  Component, OnInit, signal, computed, ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormArray, Validators, FormGroup } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
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
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDividerModule } from '@angular/material/divider';
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
    MatTableModule, MatCardModule, MatButtonModule, MatIconModule,
    MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatChipsModule, MatTooltipModule, MatSnackBarModule, MatExpansionModule,
    MatProgressSpinnerModule, MatSlideToggleModule, MatDividerModule,
  ],
  templateUrl: './plantillas-eps.component.html',
  styleUrls: ['./plantillas-eps.component.css'],
})
export class PlantillasEpsComponent implements OnInit {

  plantillas = signal<PlantillaResumen[]>([]);
  camposDisponibles = signal<CampoDisponible[]>([]);
  cargando = signal(false);

  filtroTexto = signal('');
  filtroTemporal = signal<string | null>(null);

  plantillasFiltradas = computed(() => {
    const txt = this.filtroTexto().toLowerCase();
    const tmp = this.filtroTemporal();
    return this.plantillas().filter(p => {
      const matchTxt = !txt || p.epsNombre.toLowerCase().includes(txt)
                             || p.nombrePlantilla.toLowerCase().includes(txt)
                             || p.epsKey.toLowerCase().includes(txt);
      const matchTmp = !tmp || p.temporalKey === tmp;
      return matchTxt && matchTmp;
    });
  });

  temporalesUnicos = computed(() =>
    [...new Set(this.plantillas().map(p => p.temporalKey).filter(Boolean))] as string[]
  );

  cols = ['epsNombre','temporalKey','sexo','nombre','campos','activa','acciones'];

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

  setFiltroTexto(ev: Event) {
    this.filtroTexto.set((ev.target as HTMLInputElement).value);
  }

  setFiltroTemporal(val: string | null) {
    this.filtroTemporal.set(val);
  }

  labelSexo(sexo: string | null): string {
    if (!sexo) return 'Ambos';
    return sexo === 'M' ? 'Masculino' : 'Femenino';
  }
}
