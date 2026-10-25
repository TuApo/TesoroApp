import {
  ChangeDetectionStrategy, Component, DestroyRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';

import { Capacidades, EditarMedio, LineaDialogo, Medio, MediosService, Tarjeta, medioOcupado } from '../../service/medios.service';
import { mensajeDeError } from '../../service/disenador.service';
import { BloqueFicha } from '../bloque-ficha/bloque-ficha';
import { BloqueYoutube } from '../bloque-youtube/bloque-youtube';

/**
 * Un medio de clase, editable en sitio (como las tarjetas de bloque de la consola): se abre,
 * se ajusta el guion, las tarjetas, el diálogo, la escena o el video, se guarda con botón y se
 * aprueba para generar. Lo generado se escucha o se ve aquí mismo antes de usarlo.
 */
@Component({
  selector: 'app-medio-tarjeta',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, BloqueFicha, BloqueYoutube],
  templateUrl: './medio-tarjeta.html',
  styleUrl: './medio-tarjeta.css',
})
export class MedioTarjeta implements OnChanges {
  @Input({ required: true }) medio!: Medio;
  @Input() capacidades: Capacidades | null = null;
  /** true en la consola del curso: ofrece insertar en la clase. */
  @Input() puedeInsertar = false;
  @Input() abierta = false;
  @Output() cambio = new EventEmitter<Medio>();
  @Output() eliminado = new EventEmitter<string>();

  private api = inject(MediosService);

  readonly expandida = signal(false);
  readonly sucio = signal(false);
  readonly ocupada = signal(false);
  readonly archivoUrl = signal<string | null>(null);
  readonly cargandoArchivo = signal(false);

  titulo = '';
  proposito = '';
  guion = '';
  promptVisual = '';
  tarjetas: Tarjeta[] = [];
  dialogo: LineaDialogo[] = [];
  puntos: string[] = [];
  consulta = '';
  videoUrl = '';
  inicio = '';
  fin = '';
  private documentoVisto: string | null = null;

  static readonly ICONOS: Record<string, string> = {
    FICHA: 'style', AUDIO: 'headphones', PODCAST: 'podcasts', CLIP: 'movie', YOUTUBE: 'smart_display',
  };
  static readonly NOMBRES: Record<string, string> = {
    FICHA: 'Fichas de repaso', AUDIO: 'Audio', PODCAST: 'Podcast', CLIP: 'Clip de video', YOUTUBE: 'YouTube',
  };
  static readonly ESTADOS: Record<string, string> = {
    PROPUESTO: 'Propuesto', APROBADO: 'En cola', GENERANDO: 'Generando', LISTO: 'Listo', ERROR: 'Error', DESCARTADO: 'Descartado',
  };
  readonly iconos = MedioTarjeta.ICONOS;
  readonly nombres = MedioTarjeta.NOMBRES;
  readonly estados = MedioTarjeta.ESTADOS;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.liberarArchivo());
  }

  ngOnChanges(c: SimpleChanges): void {
    if (c['abierta'] && this.abierta) this.expandida.set(true);
    if (c['medio'] && !this.sucio()) this.copiar();
    if (this.medio.document_id !== this.documentoVisto) {
      this.liberarArchivo();
      this.documentoVisto = this.medio.document_id;
    }
  }

  private copiar(): void {
    const m = this.medio;
    this.titulo = m.titulo;
    this.proposito = m.proposito ?? '';
    this.guion = m.guion ?? '';
    this.promptVisual = m.prompt_visual ?? '';
    this.tarjetas = (m.tarjetas ?? []).map(t => ({ ...t }));
    this.dialogo = (m.dialogo ?? []).map(l => ({ ...l }));
    this.puntos = [...(m.puntos ?? [])];
    this.consulta = m.consulta ?? '';
    this.videoUrl = '';
    this.inicio = m.inicio_seg ? MedioTarjeta.mmss(m.inicio_seg) : '';
    this.fin = m.fin_seg ? MedioTarjeta.mmss(m.fin_seg) : '';
  }

  get ocupadoServidor(): boolean { return medioOcupado(this.medio); }
  get palabras(): number { return this.guion.trim() ? this.guion.trim().split(/\s+/).length : 0; }
  get segundosEstimados(): number { return Math.round(this.palabras / 2.5); }

  tocar(): void { this.sucio.set(true); }

  async guardar(): Promise<Medio | null> {
    const req: EditarMedio = { titulo: this.titulo, proposito: this.proposito };
    switch (this.medio.tipo) {
      case 'FICHA': req.tarjetas = this.tarjetas.filter(t => t.frente.trim()); break;
      case 'AUDIO': req.guion = this.guion; break;
      case 'PODCAST': req.dialogo = this.dialogo.filter(l => l.texto.trim()); break;
      case 'CLIP': req.guion = this.guion; req.prompt_visual = this.promptVisual; req.puntos = this.puntos.filter(p => p.trim()); break;
      case 'YOUTUBE':
        req.consulta = this.consulta;
        if (this.videoUrl.trim()) req.video_url = this.videoUrl.trim();
        req.inicio_seg = MedioTarjeta.segundos(this.inicio) ?? 0;
        req.fin_seg = MedioTarjeta.segundos(this.fin) ?? 0;
        break;
    }
    return this.accion(() => this.api.editar(this.medio.id, req), true);
  }

  async aprobar(): Promise<void> {
    if (this.sucio() && !(await this.guardar())) return;
    await this.accion(async () => (await this.api.aprobar([this.medio.id]))[0]);
  }

  elegirVideo(id: string): void {
    this.videoUrl = id;
    this.guardar();
  }

  async descartar(): Promise<void> { await this.accion(() => this.api.descartar(this.medio.id)); }
  async restaurar(): Promise<void> { await this.accion(() => this.api.restaurar(this.medio.id)); }
  async insertar(): Promise<void> { await this.accion(() => this.api.insertar(this.medio.id)); }

  async eliminar(): Promise<void> {
    const r = await Swal.fire({ icon: 'warning', title: '¿Quitar este medio?', showCancelButton: true,
      confirmButtonText: 'Quitar', cancelButtonText: 'Cancelar' });
    if (!r.isConfirmed) return;
    try {
      await this.api.eliminar(this.medio.id);
      this.eliminado.emit(this.medio.id);
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo quitar', text: mensajeDeError(e) });
    }
  }

  private async accion(f: () => Promise<Medio>, limpia = false): Promise<Medio | null> {
    this.ocupada.set(true);
    try {
      const m = await f();
      if (limpia) this.sucio.set(false);
      this.medio = m;
      this.copiar();
      this.cambio.emit(m);
      return m;
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo', text: mensajeDeError(e) });
      return null;
    } finally {
      this.ocupada.set(false);
    }
  }

  async cargarArchivo(): Promise<void> {
    if (this.archivoUrl() || !this.medio.document_id) return;
    this.cargandoArchivo.set(true);
    try {
      const blob = await this.api.archivo(this.medio.id);
      this.archivoUrl.set(URL.createObjectURL(blob));
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo abrir', text: mensajeDeError(e) });
    } finally {
      this.cargandoArchivo.set(false);
    }
  }

  private liberarArchivo(): void {
    const u = this.archivoUrl();
    if (u) URL.revokeObjectURL(u);
    this.archivoUrl.set(null);
  }

  agregarTarjeta(): void { this.tarjetas.push({ frente: '', reverso: '' }); this.tocar(); }
  agregarLinea(): void {
    const ultima = this.dialogo[this.dialogo.length - 1]?.voz ?? 'B';
    this.dialogo.push({ voz: ultima === 'A' ? 'B' : 'A', texto: '' });
    this.tocar();
  }
  agregarPunto(): void { this.puntos.push(''); this.tocar(); }
  quitar<T>(lista: T[], i: number): void { lista.splice(i, 1); this.tocar(); }
  setPunto(i: number, v: string): void { this.puntos[i] = v; this.tocar(); }

  youtubeContenido(): string {
    const v = this.medio.video;
    return JSON.stringify({ video_id: v?.video_id, inicio: this.medio.inicio_seg ?? 0, fin: this.medio.fin_seg ?? undefined });
  }

  static mmss(s: number): string { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

  static segundos(v: string): number | null {
    const t = v.trim();
    if (!t) return null;
    const m = /^(\d+):(\d{1,2})$/.exec(t);
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    return /^\d+$/.test(t) ? Number(t) : null;
  }

  trackI(i: number): number { return i; }
}
