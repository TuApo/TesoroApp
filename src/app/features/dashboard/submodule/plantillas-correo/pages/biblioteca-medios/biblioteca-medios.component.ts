import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Title } from '@angular/platform-browser';

import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';

import { firstValueFrom } from 'rxjs';
import Swal from 'sweetalert2';

import { PlantillasCorreoService } from '../../services/plantillas-correo.service';
import { Activo } from '../../models/plantilla-correo.model';

/**
 * Biblioteca de medios: las fotos y los vídeos que se pueden meter en un correo.
 *
 * <h3>Por qué el vídeo no se sube</h3>
 * Porque ningún cliente de correo reproduce vídeo incrustado. Lo que funciona es
 * una miniatura enlazada, así que aquí se registra el enlace y se elige una
 * imagen como portada. Subir el fichero sería peso muerto en la base de datos.
 */
@Component({
  selector: 'app-biblioteca-medios',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule, RouterLink,
    MatButtonModule, MatButtonToggleModule, MatCardModule, MatFormFieldModule,
    MatIconModule, MatInputModule, MatProgressBarModule, MatSnackBarModule, MatTooltipModule,
  ],
  templateUrl: './biblioteca-medios.component.html',
  styleUrl: './biblioteca-medios.component.css',
})
export class BibliotecaMediosComponent implements OnInit {
  private srv = inject(PlantillasCorreoService);
  private snack = inject(MatSnackBar);
  private titulo = inject(Title);

  readonly cargando = signal(false);
  readonly subiendo = signal(false);
  readonly activos = signal<Activo[]>([]);
  readonly filtroTipo = signal<string>('TODOS');
  readonly filtroTexto = signal<string>('');

  async ngOnInit(): Promise<void> {
    this.titulo.setTitle('Biblioteca de medios | Plantillas de correo');
    await this.recargar();
  }

  async recargar(): Promise<void> {
    this.cargando.set(true);
    try {
      this.activos.set(await firstValueFrom(this.srv.activos(
        this.filtroTipo() === 'TODOS' ? null : this.filtroTipo(),
        this.filtroTexto() || null)));
    } catch (e: any) {
      this.snack.open(e?.error?.error ?? 'No se pudo cargar la biblioteca.', 'Cerrar', { duration: 5000 });
    } finally {
      this.cargando.set(false);
    }
  }

  /**
   * Sube varias imágenes de una vez. El backend deduplica por contenido, así que
   * volver a subir el mismo logo devuelve el que ya estaba en vez de crear una
   * copia — sin eso, la biblioteca acaba con ocho "logo.png" y nadie sabe cuál
   * es el vigente.
   */
  async subir(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const archivos = Array.from(input.files ?? []);
    if (!archivos.length) return;

    this.subiendo.set(true);
    let ok = 0;
    const fallos: string[] = [];
    for (const a of archivos) {
      try {
        await firstValueFrom(this.srv.subirImagen(a));
        ok++;
      } catch (e: any) {
        fallos.push(`${a.name}: ${e?.error?.error ?? 'error desconocido'}`);
      }
    }
    this.subiendo.set(false);
    input.value = '';
    await this.recargar();

    if (fallos.length) {
      await Swal.fire({
        title: ok ? `${ok} subida(s), ${fallos.length} con problemas` : 'No se pudo subir',
        html: `<div style="text-align:left;font-size:13px">${fallos.join('<br>')}</div>`,
        icon: ok ? 'warning' : 'error',
      });
    } else {
      this.snack.open(`${ok} imagen(es) en la biblioteca.`, 'Cerrar', { duration: 2500 });
    }
  }

  async registrarVideo(): Promise<void> {
    const imagenes = this.activos().filter((a) => a.tipo === 'IMAGEN');
    const opciones = imagenes.map((a) => `<option value="${a.id}">${a.nombre}</option>`).join('');

    const res = await Swal.fire({
      title: 'Registrar un vídeo',
      html: `
        <p style="font-size:13px;text-align:left;color:#475569;margin:0 0 10px">
          Ningún cliente de correo reproduce vídeo incrustado. Lo que se envía es la miniatura
          enlazada al vídeo.
        </p>
        <input id="v-nombre" class="swal2-input" placeholder="Nombre">
        <input id="v-url" class="swal2-input" placeholder="https://youtu.be/…">
        <select id="v-mini" class="swal2-select" style="width:80%">
          <option value="">— Sin miniatura (se envía un botón de texto) —</option>
          ${opciones}
        </select>`,
      focusConfirm: false, showCancelButton: true,
      confirmButtonText: 'Registrar', cancelButtonText: 'Cancelar', confirmButtonColor: '#0f766e',
      preConfirm: () => {
        const nombre = (document.getElementById('v-nombre') as HTMLInputElement)?.value?.trim();
        const url = (document.getElementById('v-url') as HTMLInputElement)?.value?.trim();
        if (!nombre || !url) { Swal.showValidationMessage('Nombre y enlace son obligatorios'); return false; }
        return {
          nombre, url,
          miniatura_id: (document.getElementById('v-mini') as HTMLSelectElement)?.value || null,
        };
      },
    });
    if (!res.isConfirmed || !res.value) return;

    try {
      await firstValueFrom(this.srv.registrarVideo(res.value));
      await this.recargar();
    } catch (e: any) {
      this.snack.open(e?.error?.error ?? 'No se pudo registrar el vídeo.', 'Cerrar', { duration: 5000 });
    }
  }

  async archivar(a: Activo): Promise<void> {
    const res = await Swal.fire({
      title: `¿Archivar «${a.nombre}»?`,
      text: 'Deja de ofrecerse en el editor. Las plantillas que ya lo usan lo siguen mostrando: '
          + 'el archivo no se borra, precisamente para no romper correos ya publicados.',
      icon: 'warning', showCancelButton: true,
      confirmButtonText: 'Archivar', cancelButtonText: 'Cancelar', confirmButtonColor: '#dc2626',
    });
    if (!res.isConfirmed) return;
    try {
      await firstValueFrom(this.srv.archivarActivo(a.id));
      await this.recargar();
    } catch (e: any) {
      this.snack.open(e?.error?.error ?? 'No se pudo archivar.', 'Cerrar', { duration: 5000 });
    }
  }

  url(a: Activo): string { return this.srv.urlActivo(a); }

  peso(a: Activo): string {
    if (!a.tamano_bytes) return '';
    const kb = a.tamano_bytes / 1024;
    return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
  }

  /** 200 KB es el punto en el que una imagen de correo empieza a estorbar. */
  esPesada(a: Activo): boolean {
    return (a.tamano_bytes ?? 0) > 200 * 1024;
  }
}
