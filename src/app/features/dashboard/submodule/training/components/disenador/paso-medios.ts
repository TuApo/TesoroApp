import {
  ChangeDetectionStrategy, Component, DestroyRef, EventEmitter, Input, OnChanges, OnInit, Output, computed, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';

import { Diseno, LeccionP, mensajeDeError } from '../../service/disenador.service';
import { Capacidades, Medio, MediosService, TipoMedio, medioOcupado } from '../../service/medios.service';
import { MedioTarjeta } from '../medio-tarjeta/medio-tarjeta';

/**
 * Paso 5: medios complementarios de cada clase. La IA propone (fichas, audio, podcast, clip,
 * YouTube); el profesor revisa, ajusta y aprueba; lo aprobado se genera de fondo y, al crear el
 * curso, entra a cada clase como un bloque más, después del texto y antes del quiz.
 *
 * Es un paso opcional: un curso sin medios también se puede crear.
 */
@Component({
  selector: 'app-paso-medios',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterLink, MatIconModule, MedioTarjeta],
  templateUrl: './paso-medios.html',
  styleUrls: ['./pasos.css', './paso-medios.css'],
})
export class PasoMedios implements OnInit, OnChanges {
  @Input({ required: true }) diseno!: Diseno;
  @Input() ocupado = false;
  @Output() cambio = new EventEmitter<Diseno>();
  @Output() ir = new EventEmitter<'clases' | 'crear'>();

  private api = inject(MediosService);

  readonly medios = signal<Medio[]>([]);
  readonly capacidades = signal<Capacidades | null>(null);
  readonly elegida = signal<string | null>(null);
  readonly cargando = signal(true);
  private readonly dis = signal<Diseno | null>(null);
  private temporizador: ReturnType<typeof setTimeout> | null = null;
  private vivo = true;
  private ocupadoAntes = false;

  readonly tiposNuevos: { tipo: TipoMedio; nombre: string; icono: string }[] = [
    { tipo: 'FICHA', nombre: 'Fichas', icono: 'style' },
    { tipo: 'AUDIO', nombre: 'Audio', icono: 'headphones' },
    { tipo: 'PODCAST', nombre: 'Podcast', icono: 'podcasts' },
    { tipo: 'CLIP', nombre: 'Clip', icono: 'movie' },
    { tipo: 'YOUTUBE', nombre: 'YouTube', icono: 'smart_display' },
  ];

  readonly lecciones = computed<LeccionP[]>(() =>
    (this.dis()?.propuesta?.modulos ?? []).flatMap(m => m.lecciones).filter(l => l.estado_detalle === 'LISTO'));
  readonly actual = computed(() => {
    const ls = this.lecciones();
    return ls.find(l => l.clave === this.elegida()) ?? ls[0] ?? null;
  });
  readonly deActual = computed(() => this.medios().filter(m => m.leccion_clave === this.actual()?.clave));
  readonly pendientes = computed(() => this.medios().filter(m => m.estado === 'PROPUESTO'));
  readonly generando = computed(() => this.medios().filter(medioOcupado).length);
  readonly listos = computed(() => this.medios().filter(m => m.estado === 'LISTO').length);

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.vivo = false;
      if (this.temporizador) clearTimeout(this.temporizador);
    });
  }

  async ngOnInit(): Promise<void> {
    try {
      this.capacidades.set(await this.api.capacidades());
    } catch { /* sin capacidades se muestran todas las opciones */ }
    await this.recargar();
    this.cargando.set(false);
  }

  ngOnChanges(): void {
    this.dis.set(this.diseno);
    // Cuando el trabajo de planificar termina, se traen los medios nuevos.
    if (this.ocupadoAntes && !this.ocupado) this.recargar();
    this.ocupadoAntes = this.ocupado;
  }

  cuantos(clave: string): number {
    return this.medios().filter(m => m.leccion_clave === clave && m.estado !== 'DESCARTADO').length;
  }

  async recargar(): Promise<void> {
    try {
      this.medios.set(await this.api.deDiseno(this.diseno.id));
    } catch { /* se reintenta en el siguiente ciclo */ }
    this.programar();
  }

  private programar(): void {
    if (this.temporizador) { clearTimeout(this.temporizador); this.temporizador = null; }
    if (!this.vivo || !this.generando()) return;
    this.temporizador = setTimeout(() => this.recargar(), 3000);
  }

  actualizado(m: Medio): void {
    this.medios.update(l => l.map(x => x.id === m.id ? m : x));
    this.programar();
  }

  eliminado(id: string): void {
    this.medios.update(l => l.filter(x => x.id !== id));
  }

  async proponer(soloActual = false): Promise<void> {
    try {
      const claves = soloActual && this.actual() ? [this.actual()!.clave] : [];
      this.cambio.emit(await this.api.planificarDiseno(this.diseno.id, claves));
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo', text: mensajeDeError(e) });
    }
  }

  async agregar(tipo: TipoMedio): Promise<void> {
    const l = this.actual();
    if (!l) return;
    try {
      const m = await this.api.crearEnDiseno(this.diseno.id, l.clave, tipo);
      this.medios.update(x => [...x, m]);
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo agregar', text: mensajeDeError(e) });
    }
  }

  async generarTodo(): Promise<void> {
    const ids = this.pendientes().map(m => m.id);
    if (!ids.length) return;
    const clips = this.pendientes().filter(m => m.tipo === 'CLIP' && m.costo_estimado).length;
    const r = await Swal.fire({ icon: 'question', title: `Generar ${ids.length} medio${ids.length === 1 ? '' : 's'}`,
      text: clips ? `Incluye ${clips} clip(s) con Higgsfield, que tienen costo.` : 'Se generan de fondo; puedes seguir trabajando.',
      showCancelButton: true, confirmButtonText: 'Generar', cancelButtonText: 'Cancelar' });
    if (!r.isConfirmed) return;
    try {
      const hechos = await this.api.aprobar(ids);
      const porId = new Map(hechos.map(h => [h.id, h]));
      this.medios.update(l => l.map(m => porId.get(m.id) ?? m));
      this.programar();
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo generar', text: mensajeDeError(e) });
    }
  }
}
