import { ChangeDetectionStrategy, Component, DestroyRef, Input, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';
import { Aula, AulasService, Encuesta, Entrega } from '../../service/aulas.service';
import { mensajeDeError } from '../../service/disenador.service';
import { SalaEnVivo } from '../../aula/sala-en-vivo';
import { PanelRetos } from './panel-retos';
import { ResultadoPruebas } from '../codigo/resultado-pruebas';

/**
 * Actividades en vivo: encuestas o preguntas rápidas (con respuesta correcta opcional, que se
 * revela al cerrar) y las entregas del taller, que quien dirige revisa con nota y comentario.
 */
@Component({
  selector: 'app-aula-actividades',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule, DatePipe, DecimalPipe, PanelRetos, ResultadoPruebas],
  templateUrl: './panel-actividades.html',
  styleUrl: './panel-actividades.css',
})
export class PanelActividades implements OnInit {
  @Input({ required: true }) aula!: Aula;
  @Input({ required: true }) sala!: SalaEnVivo;
  @Input() dirijo = false;

  private api = inject(AulasService);
  readonly encuestas = signal<Encuesta[]>([]);
  readonly entregas = signal<Entrega[]>([]);
  readonly abierta = computed(() => this.encuestas().find(e => e.estado === 'ABIERTA') ?? null);
  readonly vista = signal<'encuestas' | 'retos' | 'entregas'>('encuestas');
  readonly verEntrega = signal<string | null>(null);

  pregunta = '';
  opciones = ['', ''];
  correcta: number | null = null;
  private bajas: (() => void)[] = [];
  private espera: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.bajas.forEach(f => f()));
  }

  async ngOnInit(): Promise<void> {
    this.bajas.push(
      this.sala.on('aula.encuesta', () => this.recargarPronto()),
      this.sala.on('aula.entregas', () => { if (this.dirijo) this.cargarEntregas(); }),
    );
    await Promise.all([this.cargar(), this.cargarEntregas()]);
  }

  /** Con muchos votos llegan muchos avisos: se recarga como mucho una vez por segundo. */
  private recargarPronto(): void {
    if (this.espera) return;
    this.espera = setTimeout(() => { this.espera = null; this.cargar(); }, 800);
  }

  async cargar(): Promise<void> {
    try { this.encuestas.set(await this.api.encuestas(this.aula.id)); } catch { /* sin encuestas */ }
  }

  async cargarEntregas(): Promise<void> {
    try { this.entregas.set(await this.api.entregas(this.aula.id)); } catch { /* sin entregas */ }
  }

  agregarOpcion(): void { if (this.opciones.length < 8) this.opciones = [...this.opciones, '']; }
  quitarOpcion(i: number): void { this.opciones = this.opciones.filter((_, j) => j !== i); if (this.correcta === i) this.correcta = null; }
  setOpcion(i: number, v: string): void { this.opciones[i] = v; }
  trackI(i: number): number { return i; }

  async lanzar(): Promise<void> {
    const ops = this.opciones.map(o => o.trim()).filter(Boolean);
    if (!this.pregunta.trim() || ops.length < 2) return;
    try {
      await this.api.crearEncuesta(this.aula.id, this.pregunta.trim(), ops, this.correcta);
      this.pregunta = '';
      this.opciones = ['', ''];
      this.correcta = null;
      this.sala.enviar('aula.encuesta', { accion: 'nueva' });
      await this.cargar();
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo lanzar', text: mensajeDeError(e) });
    }
  }

  async votar(e: Encuesta, i: number): Promise<void> {
    try {
      const r = await this.api.votar(this.aula.id, e.id, i);
      this.encuestas.update(l => l.map(x => x.id === r.id ? r : x));
      this.sala.enviar('aula.encuesta', { accion: 'voto' }, { confiable: false });
    } catch (err) {
      Swal.fire({ toast: true, position: 'top-end', timer: 2500, showConfirmButton: false, icon: 'error', title: mensajeDeError(err) });
    }
  }

  async cerrar(e: Encuesta): Promise<void> {
    try {
      await this.api.cerrarEncuesta(this.aula.id, e.id);
      this.sala.enviar('aula.encuesta', { accion: 'cerrada' });
      await this.cargar();
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'No se pudo cerrar', text: mensajeDeError(err) });
    }
  }

  pct(e: Encuesta, i: number): number {
    return e.total ? Math.round((e.votos[i] / e.total) * 100) : 0;
  }

  async revisar(en: Entrega): Promise<void> {
    const r = await Swal.fire({
      title: `Revisar: ${en.titulo}`,
      html: `<input id="nota" type="number" min="0" max="100" class="swal2-input" placeholder="Nota (0-100)" value="${en.nota ?? ''}">
             <textarea id="fb" class="swal2-textarea" placeholder="Comentario">${en.feedback ?? ''}</textarea>`,
      showCancelButton: true, confirmButtonText: 'Guardar', cancelButtonText: 'Cancelar',
      preConfirm: () => ({ nota: (document.getElementById('nota') as HTMLInputElement).value,
        fb: (document.getElementById('fb') as HTMLTextAreaElement).value }),
    });
    if (!r.isConfirmed) return;
    try {
      const act = await this.api.revisar(this.aula.id, en.id, r.value.nota === '' ? null : Number(r.value.nota), r.value.fb || null);
      this.entregas.update(l => l.map(x => x.id === act.id ? act : x));
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo guardar', text: mensajeDeError(e) });
    }
  }
}
