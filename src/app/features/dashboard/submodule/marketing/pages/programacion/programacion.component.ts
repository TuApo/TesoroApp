import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';

import {
  ItemProgramacion, Marca, MarketingService, PlantillaResumen, Programacion, Vigente,
} from '../../service/marketing.service';

/**
 * Qué juego de plantillas rige y cuándo.
 *
 * <p>Es lo que se pidió con "cambiar mensualmente o que se repitan": una programación de
 * diciembre marcada para repetirse hace que el juego navideño vuelva cada año sin que
 * nadie lo toque otra vez.
 *
 * <p><b>La simulación es la mitad de la pantalla.</b> Una programación que solo se puede
 * comprobar esperando a diciembre no se configura con confianza: aquí se adelanta el
 * calendario y se ve el juego que saldría, con los nombres de las plantillas.
 */
@Component({
  selector: 'app-mk-programacion',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './programacion.component.html',
  styleUrl: './programacion.component.css',
})
export class ProgramacionComponent implements OnInit {
  private readonly api = inject(MarketingService);

  readonly cargando = signal(true);
  readonly marcas = signal<Marca[]>([]);
  readonly marcaId = signal<string>('');
  readonly lista = signal<Programacion[]>([]);
  readonly vigente = signal<Vigente | null>(null);
  readonly plantillas = signal<PlantillaResumen[]>([]);

  /** El día que se está simulando. Arranca en hoy. */
  readonly fecha = signal(new Date().toISOString().slice(0, 10));

  /** La que se está editando; `null` = el formulario está cerrado. */
  readonly editando = signal<Partial<Programacion> | null>(null);
  readonly seleccion = signal<Set<string>>(new Set());
  readonly guardando = signal(false);

  readonly meses = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];

  readonly esAdmin = computed(() => this.lista().length > 0 || !this.cargando());

  ngOnInit(): void {
    this.api.marcas().subscribe({
      next: (m) => {
        this.marcas.set(m);
        const pred = m.find((x) => x.predeterminada) ?? m[0];
        if (pred) { this.marcaId.set(pred.id); this.cargar(); } else { this.cargando.set(false); }
      },
      error: () => this.cargando.set(false),
    });
  }

  cambiarMarca(id: string): void { this.marcaId.set(id); this.cargar(); }
  cambiarFecha(f: string): void { if (f) { this.fecha.set(f); this.cargar(); } }

  private cargar(): void {
    this.cargando.set(true);
    // Las plantillas se recargan con la marca: son distintas para cada una y mezclarlas
    // deja elegir una que no le corresponde.
    this.api.plantillas(this.marcaId()).subscribe({
      next: (p) => this.plantillas.set(p),
      error: () => this.plantillas.set([]),
    });
    this.api.programaciones(this.marcaId(), this.fecha()).subscribe({
      next: (l) => { this.lista.set(l); this.cargando.set(false); },
      error: () => this.cargando.set(false),
    });
    this.api.vigente(this.marcaId(), this.fecha()).subscribe({
      next: (v) => this.vigente.set(v),
      error: () => this.vigente.set(null),
    });
  }

  // ── formulario ──────────────────────────────────────────────────────────

  nueva(): void {
    this.seleccion.set(new Set());
    this.editando.set({
      marca_id: this.marcaId(), nombre: '', tipo: 'MENSUAL',
      mes: new Date().getMonth() + 1, anio: null, repetir_anual: true,
      prioridad: 10, piezas_por_vacante: 3, activo: true,
    });
  }

  editar(p: Programacion): void {
    this.seleccion.set(new Set());
    // Al abrir una existente se traen sus plantillas para que el formulario muestre lo que
    // hay de verdad y no una lista vacía que al guardar lo borraría todo.
    this.api.vigente(this.marcaId(), this.fecha()).subscribe({
      next: (v) => {
        if (v?.id === p.id && v.plantillas) {
          this.seleccion.set(new Set(v.plantillas.map((i) => i.plantilla_id)));
        }
      },
      error: () => {},
    });
    this.editando.set({ ...p });
  }

  cerrar(): void { this.editando.set(null); }

  alternar(id: string): void {
    const s = new Set(this.seleccion());
    s.has(id) ? s.delete(id) : s.add(id);
    this.seleccion.set(s);
  }

  campo<K extends keyof Programacion>(k: K, v: Programacion[K]): void {
    this.editando.set({ ...this.editando(), [k]: v });
  }

  async guardar(): Promise<void> {
    const e = this.editando();
    if (!e) return;
    this.guardando.set(true);

    const items: Partial<ItemProgramacion>[] = [...this.seleccion()].map((id, i) => ({
      plantilla_id: id, peso: 1, obligatoria: false, orden: i,
    }));

    const alGuardar = (p: Programacion) => {
      // Las plantillas se fijan siempre, incluso vacías: es la única forma de vaciar un
      // juego desde la pantalla.
      this.api.fijarPlantillas(p.id, items).subscribe({
        next: () => {
          this.guardando.set(false);
          this.editando.set(null);
          this.cargar();
          Swal.fire({ icon: 'success', title: 'Guardado', timer: 1300, showConfirmButton: false });
        },
        error: () => { this.guardando.set(false); this.error('No se pudieron guardar las plantillas'); },
      });
    };

    const cuerpo = {
      marca_id: this.marcaId(), nombre: e.nombre, tipo: e.tipo, mes: e.mes, anio: e.anio,
      desde: e.desde, hasta: e.hasta, repetir_anual: e.repetir_anual,
      prioridad: e.prioridad, piezas_por_vacante: e.piezas_por_vacante, activo: e.activo,
    } as Partial<Programacion>;

    const obs = e.id
      ? this.api.editarProgramacion(e.id, cuerpo)
      : this.api.crearProgramacion(cuerpo);

    obs.subscribe({
      next: alGuardar,
      error: (err) => {
        this.guardando.set(false);
        // El backend explica en castellano por qué no se puede guardar; repetirlo tal cual
        // es más útil que un "error al guardar" genérico.
        this.error(err?.error?.error ?? 'No se pudo guardar');
      },
    });
  }

  async desactivar(p: Programacion): Promise<void> {
    const r = await Swal.fire({
      icon: 'warning',
      title: `¿Desactivar "${p.nombre}"?`,
      text: 'Deja de regir desde ya. Las piezas ya generadas no se tocan.',
      showCancelButton: true, confirmButtonText: 'Desactivar', cancelButtonText: 'Cancelar',
    });
    if (!r.isConfirmed) return;
    this.api.desactivarProgramacion(p.id).subscribe({
      next: () => this.cargar(),
      error: () => this.error('No se pudo desactivar'),
    });
  }

  private error(texto: string): void {
    Swal.fire({ icon: 'error', title: 'Un momento', text: texto });
  }

  // ── presentación ────────────────────────────────────────────────────────

  /** La regla, en una línea que se lee sin saber qué es un `tipo`. */
  regla(p: Programacion): string {
    if (p.tipo === 'PERMANENTE') return 'Todo el año';
    if (p.tipo === 'RANGO') return `Del ${p.desde ?? '?'} al ${p.hasta ?? '?'}`;
    const mes = p.mes ? this.meses[p.mes - 1] : '?';
    return p.repetir_anual ? `Cada ${mes}` : `${mes} de ${p.anio ?? '?'}`;
  }

  nombrePlantilla(id: string): string {
    return this.plantillas().find((p) => p.id === id)?.nombre ?? '(sin nombre)';
  }
}
