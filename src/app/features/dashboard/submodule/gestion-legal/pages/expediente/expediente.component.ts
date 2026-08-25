import {
  Component, ChangeDetectionStrategy, ChangeDetectorRef, OnInit, inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';

import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';

import { LegalService } from '../../services/legal.service';
import {
  ProcesoLegal, ActuacionLegal, TerminoLegal, ParteProceso, DocumentoProceso, ProcesoEstado
} from '../../models/legal.models';
import { NuevaActuacionDialogComponent, NuevaActuacionResult } from './nueva-actuacion-dialog.component';
import { CambiarEstadoDialogComponent, CambiarEstadoResult } from '../bandeja/cambiar-estado-dialog.component';

@Component({
  selector: 'app-expediente-legal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule, ReactiveFormsModule,
    MatTabsModule, MatButtonModule, MatIconModule, MatChipsModule, MatCardModule,
    MatTableModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatSnackBarModule, MatDialogModule, MatProgressSpinnerModule, MatTooltipModule,
    MatDividerModule
  ],
  templateUrl: './expediente.component.html',
  styleUrl: './expediente.component.css'
})
export class ExpedienteComponent implements OnInit {
  private svc = inject(LegalService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private snack = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private cdr = inject(ChangeDetectorRef);

  procesoId!: number;
  proceso: ProcesoLegal | null = null;
  actuaciones: ActuacionLegal[] = [];
  terminos: TerminoLegal[] = [];
  partes: ParteProceso[] = [];
  documentos: DocumentoProceso[] = [];

  cargandoProceso = false;
  cargandoActuaciones = false;
  cargandoTerminos = false;
  cargandoPartes = false;
  cargandoDocumentos = false;
  subiendoDocumento = false;

  columnasTerminos = ['tipo', 'descripcion', 'fechaInicio', 'fechaVencimiento', 'estado'];

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    this.procesoId = Number(id);
    if (!this.procesoId) { this.router.navigate(['/dashboard/gestion-legal/bandeja']); return; }
    this.cargarProceso();
    this.cargarActuaciones();
    this.cargarTerminos();
    this.cargarPartes();
    this.cargarDocumentos();
  }

  cargarProceso(): void {
    this.cargandoProceso = true;
    this.cdr.markForCheck();
    this.svc.getProceso(this.procesoId).subscribe({
      next: p => { this.proceso = p; this.cargandoProceso = false; this.cdr.markForCheck(); },
      error: () => { this.cargandoProceso = false; this.snack.open('Error al cargar el proceso', 'Cerrar', { duration: 3000 }); this.cdr.markForCheck(); }
    });
  }

  cargarActuaciones(): void {
    this.cargandoActuaciones = true;
    this.cdr.markForCheck();
    this.svc.getActuaciones(this.procesoId).subscribe({
      next: a => {
        this.actuaciones = a.slice().sort((x, y) =>
          new Date(y.fechaActuacion).getTime() - new Date(x.fechaActuacion).getTime()
        );
        this.cargandoActuaciones = false;
        this.cdr.markForCheck();
      },
      error: () => { this.cargandoActuaciones = false; this.cdr.markForCheck(); }
    });
  }

  cargarTerminos(): void {
    this.cargandoTerminos = true;
    this.cdr.markForCheck();
    this.svc.getTerminos(this.procesoId).subscribe({
      next: t => { this.terminos = t; this.cargandoTerminos = false; this.cdr.markForCheck(); },
      error: () => { this.cargandoTerminos = false; this.cdr.markForCheck(); }
    });
  }

  cargarPartes(): void {
    this.cargandoPartes = true;
    this.cdr.markForCheck();
    this.svc.getPartes(this.procesoId).subscribe({
      next: p => { this.partes = p; this.cargandoPartes = false; this.cdr.markForCheck(); },
      error: () => { this.cargandoPartes = false; this.cdr.markForCheck(); }
    });
  }

  cargarDocumentos(): void {
    this.cargandoDocumentos = true;
    this.cdr.markForCheck();
    this.svc.getDocumentos(this.procesoId).subscribe({
      next: d => { this.documentos = d; this.cargandoDocumentos = false; this.cdr.markForCheck(); },
      error: () => { this.cargandoDocumentos = false; this.cdr.markForCheck(); }
    });
  }

  abrirNuevaActuacion(): void {
    const ref = this.dialog.open(NuevaActuacionDialogComponent, {
      width: '540px',
      maxWidth: '95vw',
      data: { procesoId: this.procesoId }
    });
    ref.afterClosed().subscribe((result: NuevaActuacionResult | null) => {
      if (!result) return;
      const { archivos, ...body } = result;
      this.svc.crearActuacion(this.procesoId, body as Partial<ActuacionLegal>).subscribe({
        next: (actuacion: ActuacionLegal) => {
          const docs = archivos || [];
          if (docs.length === 0) {
            this.snack.open('Actuación registrada', 'Cerrar', { duration: 3000 });
            this.cargarActuaciones();
            this.cargarProceso();
            return;
          }
          let pendiente = docs.length;
          let errores = 0;
          for (const d of docs) {
            const fd = new FormData();
            fd.append('file', d.file);
            fd.append('docTipoId', String(d.docTipoId));
            if (actuacion?.id) fd.append('actuacionId', String(actuacion.id));
            this.svc.subirDocumento(this.procesoId, fd).subscribe({
              next: () => {
                pendiente--;
                if (pendiente === 0) {
                  const msg = errores === 0
                    ? `Actuación registrada con ${docs.length} documento(s)`
                    : `Actuación registrada. ${errores} doc(s) fallaron`;
                  this.snack.open(msg, 'Cerrar', { duration: 4000 });
                  this.cargarActuaciones();
                  this.cargarDocumentos();
                  this.cargarProceso();
                }
              },
              error: () => {
                errores++;
                pendiente--;
                if (pendiente === 0) {
                  this.snack.open(`Actuación registrada. ${errores} doc(s) no se pudieron subir`, 'Cerrar', { duration: 4000 });
                  this.cargarActuaciones();
                  this.cargarDocumentos();
                  this.cargarProceso();
                }
              }
            });
          }
        },
        error: () => this.snack.open('Error al registrar actuación', 'Cerrar', { duration: 3000 })
      });
    });
  }

  abrirCambiarEstado(): void {
    if (!this.proceso) return;
    this.svc.getEstados(this.proceso.tipoId).subscribe({
      next: estados => {
        const ref = this.dialog.open(CambiarEstadoDialogComponent, {
          width: '560px',
          maxWidth: '95vw',
          data: { proceso: this.proceso, estados }
        });
        ref.afterClosed().subscribe((result: CambiarEstadoResult | null) => {
          if (!result) return;
          this.svc.cambiarEstado(this.procesoId, result).subscribe({
            next: p => {
              this.proceso = p;
              const docs = result.archivos || [];
              if (docs.length === 0) {
                this.snack.open('Estado actualizado', 'Cerrar', { duration: 3000 });
                this.cargarActuaciones();
                this.cdr.markForCheck();
                return;
              }
              let pendiente = docs.length;
              let errores = 0;
              for (const d of docs) {
                const fd = new FormData();
                fd.append('file', d.file);
                fd.append('docTipoId', String(d.docTipoId));
                this.svc.subirDocumento(this.procesoId, fd).subscribe({
                  next: () => {
                    pendiente--;
                    if (pendiente === 0) {
                      const msg = errores === 0
                        ? `Estado actualizado y ${docs.length} documento(s) radicado(s)`
                        : `Estado actualizado. ${errores} doc(s) fallaron`;
                      this.snack.open(msg, 'Cerrar', { duration: 4000 });
                      this.cargarActuaciones();
                      this.cargarDocumentos();
                      this.cdr.markForCheck();
                    }
                  },
                  error: () => {
                    errores++;
                    pendiente--;
                    if (pendiente === 0) {
                      this.snack.open(`Estado actualizado. ${errores} doc(s) no se pudieron subir`, 'Cerrar', { duration: 4000 });
                      this.cargarActuaciones();
                      this.cargarDocumentos();
                      this.cdr.markForCheck();
                    }
                  }
                });
              }
            },
            error: () => this.snack.open('Error al cambiar estado', 'Cerrar', { duration: 3000 })
          });
        });
      },
      error: () => this.snack.open('Error al cargar estados', 'Cerrar', { duration: 3000 })
    });
  }

  abrirSubirDocumento(): void {
    import('./subir-documento-dialog.component').then(m => {
      const ref = this.dialog.open(m.SubirDocumentoDialogComponent, {
        width: '480px',
        maxWidth: '95vw',
        data: { procesoId: this.procesoId, actuaciones: this.actuaciones }
      });
      ref.afterClosed().subscribe((result: { file: File; docTipoId: number; actuacionId?: number } | null) => {
        if (!result) return;
        const fd = new FormData();
        fd.append('file', result.file);
        fd.append('docTipoId', String(result.docTipoId));
        if (result.actuacionId) fd.append('actuacionId', String(result.actuacionId));
        this.subiendoDocumento = true;
        this.cdr.markForCheck();
        this.svc.subirDocumento(this.procesoId, fd).subscribe({
          next: () => {
            this.snack.open('Documento subido correctamente', 'Cerrar', { duration: 3000 });
            this.subiendoDocumento = false;
            this.cargarDocumentos();
            this.cargarProceso();
          },
          error: () => {
            this.snack.open('Error al subir el documento', 'Cerrar', { duration: 3000 });
            this.subiendoDocumento = false;
            this.cdr.markForCheck();
          }
        });
      });
    });
  }

  descargarDocumento(id: number): void {
    window.open(this.svc.urlDescargarDocumento(id), '_blank');
  }

  actuacionLabel(actuacionId: number): string {
    const a = this.actuaciones.find(x => x.id === actuacionId);
    return a ? a.titulo : `Actuación #${actuacionId}`;
  }

  analizarConIA(): void {
    if (!this.proceso) return;
    const titulo = `Proceso legal ${this.proceso.radicado} — ${this.proceso.tipoNombre}`;
    this.router.navigate(['/dashboard/herramientas-ia/asistente'], {
      queryParams: { contexto: `Proceso legal: ${titulo}. Trabajador: ${this.proceso.trabajadorNombre} (${this.proceso.trabajadorCedula}). Estado: ${this.proceso.estadoNombre}.` }
    });
  }

  volver(): void {
    this.router.navigate(['/dashboard/gestion-legal/bandeja']);
  }

  colorSemaforoClass(color: string): string {
    return 'semaforo-' + color;
  }

  tipoParteLabel(tipo: string): string {
    const map: Record<string, string> = {
      DEMANDANTE: 'Demandante', DEMANDADO: 'Demandado', APODERADO: 'Apoderado'
    };
    return map[tipo] || tipo;
  }

  tipoParteColor(tipo: string): string {
    const map: Record<string, string> = {
      DEMANDANTE: 'primary', DEMANDADO: 'warn', APODERADO: 'accent'
    };
    return map[tipo] || '';
  }

  terminoEstadoLabel(t: TerminoLegal): string {
    if (t.vencido) return 'Vencido';
    return 'Vigente';
  }

  terminoEstadoClass(t: TerminoLegal): string {
    if (t.vencido) return 'termino-vencido';
    if (t.alertado) return 'termino-alerta';
    return 'termino-vigente';
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  actuacionIcono(tipo: string): string {
    const map: Record<string, string> = {
      CREACION: 'add_circle',
      ESTADO: 'swap_horiz',
      DOCUMENTO: 'attach_file',
      AUDIENCIA: 'gavel',
      NOTIFICACION: 'notifications',
      RECURSO: 'description',
      FALLO: 'verified',
    };
    return map[tipo?.toUpperCase()] || 'circle';
  }
}
