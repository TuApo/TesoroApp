import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';

import { Diseno, DisenadorService, FuenteDiseno, mensajeDeError, nombreGrabacion } from '../../service/disenador.service';
import { GrabadoraVoz } from '../grabadora-voz/grabadora-voz';

interface Subida { nombre: string; estado: 'subiendo' | 'error'; error?: string; }

/**
 * Paso 1: todo el material del profesor, como lo tenga.
 *
 * Se aceptan archivos de cualquier tipo que se sepa leer (PDF, Office nuevo, texto, imagen,
 * audio, video), texto pegado, una explicación grabada y enlaces. Cada pieza se lee en el
 * servidor y aquí se ve su estado: lo que no se pudo leer se dice con el motivo, porque el
 * profesor tiene que saber que eso NO se tuvo en cuenta.
 */
@Component({
  selector: 'app-paso-material',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, DecimalPipe, GrabadoraVoz],
  templateUrl: './paso-material.html',
  styleUrls: ['./pasos.css', './paso-material.css'],
})
export class PasoMaterial {
  @Input({ required: true }) diseno!: Diseno;
  @Input() ocupado = false;
  @Output() cambio = new EventEmitter<Diseno>();
  @Output() ir = new EventEmitter<'entrevista'>();

  private api = inject(DisenadorService);

  readonly subidas = signal<Subida[]>([]);
  readonly arrastrando = signal(false);
  readonly modo = signal<'nada' | 'texto' | 'enlace'>('nada');
  readonly enviando = signal(false);
  readonly abierta = signal<string | null>(null);

  textoTitulo = '';
  texto = '';
  enlace = '';

  static readonly ACEPTA = '.pdf,.docx,.pptx,.xlsx,.txt,.md,.csv,.html,.htm,.json,.srt,.vtt,image/*,audio/*,video/*';
  readonly acepta = PasoMaterial.ACEPTA;
  static readonly MAX_BYTES = 500 * 1024 * 1024;

  get leyendo(): number {
    return this.diseno.fuentes.filter(f => f.estado === 'PENDIENTE' || f.estado === 'PROCESANDO').length;
  }

  get listas(): number {
    return this.diseno.fuentes.filter(f => f.estado === 'LISTO').length;
  }

  soltar(ev: DragEvent): void {
    ev.preventDefault();
    this.arrastrando.set(false);
    const files = ev.dataTransfer?.files;
    if (files?.length) this.subir(Array.from(files));
  }

  elegir(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    if (input.files?.length) this.subir(Array.from(input.files));
    input.value = '';
  }

  async subir(files: File[]): Promise<void> {
    for (const f of files) {
      if (f.size > PasoMaterial.MAX_BYTES) {
        this.subidas.update(l => [...l, { nombre: f.name, estado: 'error', error: 'Pesa más de 500 MB' }]);
        continue;
      }
      this.subidas.update(l => [...l, { nombre: f.name, estado: 'subiendo' }]);
      try {
        const documentId = await this.api.subirMaterial(f, f.name);
        const d = await this.api.agregarFuente(this.diseno.id, {
          tipo: 'ARCHIVO', titulo: f.name, document_id: documentId, mime: f.type || null, bytes: f.size,
        });
        this.subidas.update(l => l.filter(s => s.nombre !== f.name));
        this.cambio.emit(d);
      } catch (e) {
        this.subidas.update(l => l.map(s => s.nombre === f.name ? { ...s, estado: 'error', error: mensajeDeError(e, 'No se pudo subir') } : s));
      }
    }
  }

  async grabacion(audio: Blob): Promise<void> {
    const nombre = nombreGrabacion(audio);
    this.subidas.update(l => [...l, { nombre: 'Tu explicación grabada', estado: 'subiendo' }]);
    try {
      const documentId = await this.api.subirMaterial(audio, nombre);
      const d = await this.api.agregarFuente(this.diseno.id, {
        tipo: 'VOZ', titulo: 'Explicación grabada', document_id: documentId, mime: audio.type || null, bytes: audio.size,
      });
      this.subidas.update(l => l.filter(s => s.nombre !== 'Tu explicación grabada'));
      this.cambio.emit(d);
    } catch (e) {
      this.subidas.update(l => l.map(s => s.nombre === 'Tu explicación grabada' ? { ...s, estado: 'error', error: mensajeDeError(e) } : s));
    }
  }

  async agregarTexto(): Promise<void> {
    if (!this.texto.trim()) return;
    await this.agregar({ tipo: 'TEXTO', titulo: this.textoTitulo.trim() || null, texto: this.texto });
    this.texto = '';
    this.textoTitulo = '';
    this.modo.set('nada');
  }

  async agregarEnlace(): Promise<void> {
    if (!this.enlace.trim()) return;
    await this.agregar({ tipo: 'ENLACE', url: this.enlace.trim() });
    this.enlace = '';
    this.modo.set('nada');
  }

  private async agregar(req: Parameters<DisenadorService['agregarFuente']>[1]): Promise<void> {
    this.enviando.set(true);
    try {
      this.cambio.emit(await this.api.agregarFuente(this.diseno.id, req));
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo agregar', text: mensajeDeError(e) });
    } finally {
      this.enviando.set(false);
    }
  }

  async quitar(f: FuenteDiseno): Promise<void> {
    try {
      this.cambio.emit(await this.api.eliminarFuente(this.diseno.id, f.id));
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo quitar', text: mensajeDeError(e) });
    }
  }

  async reintentar(f: FuenteDiseno): Promise<void> {
    try { this.cambio.emit(await this.api.reintentarFuente(this.diseno.id, f.id)); } catch { /* se ve al consultar */ }
  }

  async analizar(): Promise<void> {
    this.enviando.set(true);
    try {
      this.cambio.emit(await this.api.analizar(this.diseno.id));
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo empezar', text: mensajeDeError(e) });
    } finally {
      this.enviando.set(false);
    }
  }

  quitarSubida(s: Subida): void {
    this.subidas.update(l => l.filter(x => x !== s));
  }

  icono(f: FuenteDiseno): string {
    if (f.tipo === 'TEXTO') return 'notes';
    if (f.tipo === 'VOZ') return 'record_voice_over';
    if (f.tipo === 'ENLACE') return f.url?.includes('youtu') ? 'smart_display' : 'link';
    const m = (f.mime || f.titulo || '').toLowerCase();
    if (m.includes('pdf')) return 'picture_as_pdf';
    if (m.includes('presentation') || m.endsWith('.pptx')) return 'slideshow';
    if (m.includes('sheet') || m.endsWith('.xlsx')) return 'table_chart';
    if (m.startsWith('image') || /\.(png|jpe?g|webp|gif)$/.test(m)) return 'image';
    if (m.startsWith('audio')) return 'audio_file';
    if (m.startsWith('video') || /\.(mp4|mov|mkv|webm)$/.test(m)) return 'movie';
    return 'description';
  }

  alternar(f: FuenteDiseno): void {
    this.abierta.set(this.abierta() === f.id ? null : f.id);
  }
}
