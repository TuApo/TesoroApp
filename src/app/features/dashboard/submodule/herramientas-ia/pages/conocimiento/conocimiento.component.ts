import {
  Component, ChangeDetectionStrategy, OnInit, signal, inject, ViewChild, ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';

import { ConocimientoService, DocDto } from '../../service/conocimiento.service';

interface ModuloOpcion { clave: string; nombre: string; icono: string; }

const MODULOS: ModuloOpcion[] = [
  { clave: 'nomina',        nombre: 'Nómina',                icono: 'payments' },
  { clave: 'contratacion',  nombre: 'Contratación',          icono: 'assignment' },
  { clave: 'documentos',    nombre: 'Documentos',            icono: 'folder' },
  { clave: 'tesoreria',     nombre: 'Tesorería',             icono: 'account_balance' },
  { clave: 'afiliaciones',  nombre: 'Afiliaciones',          icono: 'badge' },
  { clave: 'salud',         nombre: 'Salud',                 icono: 'health_and_safety' },
];

@Component({
  selector: 'app-conocimiento',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule,
    MatCheckboxModule, MatProgressSpinnerModule, MatTooltipModule, MatCardModule, MatChipsModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './conocimiento.component.html',
  styleUrls: ['./conocimiento.component.css'],
})
export class ConocimientoComponent implements OnInit {
  private svc = inject(ConocimientoService);

  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;

  documentos = signal<DocDto[]>([]);
  loading = signal<boolean>(false);
  uploading = signal<boolean>(false);
  error = signal<string | null>(null);

  // Formulario de carga
  formNombre = signal<string>('');
  formModulos = signal<string[]>(['nomina', 'contratacion', 'documentos', 'tesoreria', 'afiliaciones', 'salud']);
  formContenido = signal<string | null>(null);
  formArchivoNombre = signal<string | null>(null);
  formArchivoMime = signal<string>('text/plain');

  readonly modulosOpciones = MODULOS;

  ngOnInit(): void {
    this.cargar();
  }

  private cargar(): void {
    this.loading.set(true);
    this.svc.listarDocumentos().subscribe({
      next: (d) => { this.documentos.set(d ?? []); this.loading.set(false); },
      error: () => { this.loading.set(false); this.error.set('No se pudo cargar los documentos.'); },
    });
  }

  // ── Formulario ────────────────────────────────────────────────────────────────
  formModuloActivo(clave: string): boolean { return this.formModulos().includes(clave); }

  toggleFormModulo(clave: string): void {
    const activos = this.formModulos();
    this.formModulos.set(
      activos.includes(clave) ? activos.filter((m) => m !== clave) : [...activos, clave]
    );
  }

  abrirArchivos(): void { this.fileInput?.nativeElement.click(); }

  async onFile(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.formArchivoNombre.set(file.name);
    this.formArchivoMime.set(file.type || 'text/plain');
    if (!this.formNombre()) this.formNombre.set(file.name);

    try {
      const texto = await file.text();
      this.formContenido.set(texto);
    } catch {
      this.error.set('No se pudo leer el archivo.');
      this.formContenido.set(null);
    }
    input.value = '';
  }

  async subirDocumento(): Promise<void> {
    const nombre = this.formNombre().trim();
    const contenido = this.formContenido();
    if (!nombre || !contenido) {
      this.error.set('Debes seleccionar un archivo y asignarle un nombre.');
      return;
    }
    if (this.formModulos().length === 0) {
      this.error.set('Selecciona al menos un módulo.');
      return;
    }

    this.uploading.set(true);
    this.error.set(null);
    this.svc.subirDocumento({
      nombre,
      tipoMime: this.formArchivoMime(),
      contenido,
      modulos: this.formModulos(),
    }).subscribe({
      next: (d) => {
        this.documentos.update((list) => [d, ...list]);
        this.uploading.set(false);
        this.resetForm();
      },
      error: () => {
        this.uploading.set(false);
        this.error.set('Error al subir el documento.');
      },
    });
  }

  private resetForm(): void {
    this.formNombre.set('');
    this.formContenido.set(null);
    this.formArchivoNombre.set(null);
    this.formArchivoMime.set('text/plain');
    this.formModulos.set(['nomina', 'contratacion', 'documentos', 'tesoreria', 'afiliaciones', 'salud']);
  }

  // ── Editar módulos de un documento existente ──────────────────────────────────
  toggleDocModulo(doc: DocDto, clave: string): void {
    const activos = doc.modulos ?? [];
    const nuevos = activos.includes(clave) ? activos.filter((m) => m !== clave) : [...activos, clave];
    this.svc.actualizarModulos(doc.id, nuevos).subscribe({
      next: (d) => this.documentos.update((list) => list.map((x) => (x.id === d.id ? d : x))),
      error: () => this.error.set('No se pudo actualizar los módulos.'),
    });
  }

  eliminarDocumento(doc: DocDto): void {
    if (!window.confirm(`¿Eliminar "${doc.nombre}"? Los fragmentos RAG también se eliminarán.`)) return;
    this.svc.eliminarDocumento(doc.id).subscribe({
      next: () => this.documentos.update((list) => list.filter((x) => x.id !== doc.id)),
      error: () => this.error.set('No se pudo eliminar el documento.'),
    });
  }

  formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  nombreModulo(clave: string): string {
    return MODULOS.find((m) => m.clave === clave)?.nombre ?? clave;
  }
}
