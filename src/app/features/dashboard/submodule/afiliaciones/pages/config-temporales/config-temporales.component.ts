import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatTabsModule } from '@angular/material/tabs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { PlantillaEpsService } from '../../services/plantilla-eps.service';
import { TemporalConfig, TemporalConfigRequest } from '../../models/plantilla-eps.models';

/**
 * Página de configuración por empresa temporal.
 * Permite editar los datos legales (NIT, dirección, email) y cargar la firma
 * y el sello que se insertan en los documentos de afiliación generados.
 */
@Component({
  selector: 'app-config-temporales',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule,
    MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule,
    MatIconModule, MatSnackBarModule, MatTooltipModule, MatTabsModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './config-temporales.component.html',
  styleUrls: ['./config-temporales.component.css'],
})
export class ConfigTemporales implements OnInit {

  private svc  = inject(PlantillaEpsService);
  private fb   = inject(FormBuilder);
  private snack = inject(MatSnackBar);

  temporales = signal<TemporalConfig[]>([]);
  seleccionado = signal<TemporalConfig | null>(null);

  firmaPreview = signal<string | null>(null);
  selloPreview = signal<string | null>(null);

  guardando = signal(false);
  cargando  = signal(false);

  firmaFile: File | null = null;
  selloFile: File | null = null;

  form = this.fb.group({
    nombreDisplay: ['', Validators.required],
    nit:       [''],
    direccion: [''],
    email:     [''],
  });

  ngOnInit() { this.cargarTemporales(); }

  cargarTemporales() {
    this.cargando.set(true);
    this.svc.listarTemporales().subscribe({
      next: ts => { this.temporales.set(ts); this.cargando.set(false); },
      error: () => { this.snack.open('Error cargando temporales', '', { duration: 3000 }); this.cargando.set(false); }
    });
  }

  seleccionar(t: TemporalConfig) {
    this.seleccionado.set(t);
    this.firmaPreview.set(null);
    this.selloPreview.set(null);
    this.firmaFile = null;
    this.selloFile = null;
    this.form.patchValue({
      nombreDisplay: t.nombreDisplay,
      nit:       t.nit ?? '',
      direccion: t.direccion ?? '',
      email:     t.email ?? '',
    });
    if (t.tieneFirma) {
      this.svc.obtenerFirmaUri(t.temporalKey).subscribe(uri => this.firmaPreview.set(uri));
    }
    if (t.tieneSello) {
      this.svc.obtenerSelloUri(t.temporalKey).subscribe(uri => this.selloPreview.set(uri));
    }
  }

  onFirmaChange(ev: Event) { this.leerImagen(ev, 'firma'); }
  onSelloChange(ev: Event) { this.leerImagen(ev, 'sello'); }

  private leerImagen(ev: Event, tipo: 'firma' | 'sello') {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.snack.open('Solo se aceptan imágenes (PNG, JPG, SVG)', '', { duration: 3000 });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const uri = reader.result as string;
      if (tipo === 'firma') { this.firmaFile = file; this.firmaPreview.set(uri); }
      else                  { this.selloFile = file; this.selloPreview.set(uri); }
    };
    reader.readAsDataURL(file);
  }

  limpiarFirma() { this.firmaFile = null; this.firmaPreview.set(null); }
  limpiarSello() { this.selloFile = null; this.selloPreview.set(null); }

  guardar() {
    if (!this.form.valid || !this.seleccionado()) return;
    const t = this.seleccionado()!;
    const v = this.form.value;

    const req: TemporalConfigRequest = {
      temporalKey:  t.temporalKey,
      nombreDisplay: v.nombreDisplay!,
      nit:           v.nit  || undefined,
      direccion:     v.direccion || undefined,
      email:         v.email || undefined,
      firmaImagen:   this.firmaPreview() ?? undefined,
      selloImagen:   this.selloPreview() ?? undefined,
    };

    this.guardando.set(true);
    this.svc.guardarTemporal(t.temporalKey, req).subscribe({
      next: updated => {
        this.guardando.set(false);
        this.snack.open('Configuración guardada ✓', '', { duration: 3000 });
        this.temporales.update(ts => ts.map(x => x.id === updated.id ? updated : x));
        this.seleccionado.set(updated);
      },
      error: () => { this.guardando.set(false); this.snack.open('Error al guardar', '', { duration: 3000 }); }
    });
  }
}
