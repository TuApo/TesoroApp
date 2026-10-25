import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';

import { ActividadP, Diseno, DisenadorService, LeccionP, ModuloP, Propuesta, mensajeDeError } from '../../service/disenador.service';

/**
 * Paso 3: la estructura propuesta, editable.
 *
 * Se edita una copia local y se guarda con botón (igual que las tarjetas de bloque de la
 * consola): reordenar módulos y clases, renombrar, cambiar duraciones o cuántas preguntas lleva
 * el quiz son muchos toques seguidos, y guardar en cada uno llenaría la red. Mientras haya
 * cambios sin guardar se avisa y los botones que dependen del servidor guardan primero.
 */
@Component({
  selector: 'app-paso-estructura',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './paso-estructura.html',
  styleUrls: ['./pasos.css', './paso-estructura.css'],
})
export class PasoEstructura implements OnChanges {
  @Input({ required: true }) diseno!: Diseno;
  @Input() ocupado = false;
  @Output() cambio = new EventEmitter<Diseno>();
  @Output() ir = new EventEmitter<'clases' | 'entrevista'>();

  private api = inject(DisenadorService);

  propuesta: Propuesta | null = null;
  readonly sucio = signal(false);
  readonly guardando = signal(false);
  readonly abierta = signal<string | null>(null);
  readonly rehaciendo = signal(false);
  indicaciones = '';
  private versionVista = '';

  readonly tiposActividad: { valor: ActividadP['tipo']; etiqueta: string; icono: string }[] = [
    { valor: 'TEXTO', etiqueta: 'Respuesta escrita', icono: 'edit_note' },
    { valor: 'EVIDENCIA_FOTO', etiqueta: 'Foto de evidencia', icono: 'photo_camera' },
    { valor: 'FORMULARIO', etiqueta: 'Formulario / caso', icono: 'assignment' },
  ];

  ngOnChanges(c: SimpleChanges): void {
    // Solo se reemplaza la copia local si cambió en el servidor Y no hay ediciones pendientes:
    // la consulta periódica no puede pisar lo que el profesor está escribiendo.
    const firma = JSON.stringify(this.diseno.propuesta ?? null);
    if (c['diseno'] && firma !== this.versionVista && !this.sucio()) {
      this.versionVista = firma;
      this.propuesta = this.diseno.propuesta ? structuredClone(this.diseno.propuesta) : null;
      if (this.propuesta && !this.propuesta.evaluacion_final) {
        this.propuesta.evaluacion_final = { incluir: false, preguntas: 15, nota_minima: 70 };
      }
      if (this.propuesta && !this.propuesta.curso) this.propuesta.curso = { objetivos: [] };
    }
  }

  tocar(): void { this.sucio.set(true); }

  totalLecciones(): number {
    return this.propuesta?.modulos.reduce((n, m) => n + m.lecciones.length, 0) ?? 0;
  }

  totalMinutos(): number {
    return this.propuesta?.modulos.reduce((n, m) => n + m.lecciones.reduce((k, l) => k + (l.duracion_min ?? 0), 0), 0) ?? 0;
  }

  totalPreguntas(): number {
    return this.propuesta?.modulos.reduce((n, m) => n + m.lecciones.reduce((k, l) => k + (l.preguntas_quiz ?? 0), 0), 0) ?? 0;
  }

  mover<T>(lista: T[], i: number, delta: number): void {
    const j = i + delta;
    if (j < 0 || j >= lista.length) return;
    [lista[i], lista[j]] = [lista[j], lista[i]];
    this.tocar();
  }

  quitar<T>(lista: T[], i: number): void {
    lista.splice(i, 1);
    this.tocar();
  }

  agregarModulo(): void {
    if (!this.propuesta) return;
    const n = this.propuesta.modulos.length + 1;
    this.propuesta.modulos.push({ clave: `nuevo_m${Date.now()}`, titulo: `Módulo ${n}`, objetivo: '', lecciones: [this.leccionNueva(1)] });
    this.tocar();
  }

  agregarLeccion(m: ModuloP): void {
    m.lecciones.push(this.leccionNueva(m.lecciones.length + 1));
    this.tocar();
  }

  private leccionNueva(n: number): LeccionP {
    return { clave: `nueva_${Date.now()}_${n}`, titulo: `Clase ${n}`, objetivos: [], duracion_min: 20, preguntas_quiz: 3,
      actividades: [], estado_detalle: 'PENDIENTE' };
  }

  agregarActividad(l: LeccionP): void {
    (l.actividades ??= []).push({ titulo: 'Actividad', tipo: 'TEXTO', instrucciones: '' });
    this.tocar();
  }

  agregarObjetivo(lista: string[] | undefined, dueño: { objetivos?: string[] }): void {
    (dueño.objetivos ??= []).push('');
    this.tocar();
    void lista;
  }

  cambiarObjetivo(dueño: { objetivos?: string[] }, i: number, v: string): void {
    if (dueño.objetivos) dueño.objetivos[i] = v;
    this.tocar();
  }

  alternar(clave: string): void {
    this.abierta.set(this.abierta() === clave ? null : clave);
  }

  icono(tipo: string): string {
    return this.tiposActividad.find(t => t.valor === tipo)?.icono ?? 'task';
  }

  async guardar(): Promise<boolean> {
    if (!this.propuesta || !this.sucio()) return true;
    this.guardando.set(true);
    try {
      const d = await this.api.guardarPropuesta(this.diseno.id, this.propuesta);
      this.sucio.set(false);
      this.versionVista = '';
      this.cambio.emit(d);
      return true;
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo guardar', text: mensajeDeError(e) });
      return false;
    } finally {
      this.guardando.set(false);
    }
  }

  async armar(): Promise<void> {
    try {
      this.cambio.emit(await this.api.estructurar(this.diseno.id));
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo pedir la estructura', text: mensajeDeError(e) });
    }
  }

  async rehacer(): Promise<void> {
    if (this.sucio()) {
      const r = await Swal.fire({ icon: 'warning', title: '¿Rehacer la estructura?',
        text: 'Tus cambios sin guardar se pierden: la IA propone una estructura nueva con tus indicaciones.',
        showCancelButton: true, confirmButtonText: 'Rehacer', cancelButtonText: 'Cancelar' });
      if (!r.isConfirmed) return;
    }
    try {
      const d = await this.api.estructurar(this.diseno.id, this.indicaciones.trim() || null);
      this.sucio.set(false);
      this.rehaciendo.set(false);
      this.indicaciones = '';
      this.versionVista = '';
      this.cambio.emit(d);
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo rehacer', text: mensajeDeError(e) });
    }
  }

  async escribirClases(): Promise<void> {
    if (!(await this.guardar())) return;
    try {
      this.cambio.emit(await this.api.detallar(this.diseno.id));
      this.ir.emit('clases');
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo empezar', text: mensajeDeError(e) });
    }
  }

  yaDetalladas(): number {
    return this.propuesta?.modulos.reduce((n, m) => n + m.lecciones.filter(l => l.estado_detalle === 'LISTO').length, 0) ?? 0;
  }

  trackIndex(i: number): number { return i; }
}
