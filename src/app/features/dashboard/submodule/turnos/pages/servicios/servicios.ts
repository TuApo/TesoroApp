import { ChangeDetectionStrategy, Component, OnInit, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

import { SelectorOficina } from '../../components/selector-oficina/selector-oficina';
import { ContextoTurnosService } from '../../service/contexto-turnos.service';
import { Area, Servicio, ServicioIn, ServicioPlantilla, ServicioPlantillaIn, TurnosService } from '../../service/turnos.service';

/** Los trámites que reparten turnos en la oficina elegida. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-turnos-servicios',
  imports: [CommonModule, FormsModule, MatIconModule, SelectorOficina],
  templateUrl: './servicios.html',
  styleUrls: ['../../styles/turnos-comun.css', './servicios.css'],
})
export class Servicios implements OnInit {
  readonly ctx = inject(ContextoTurnosService);
  private api = inject(TurnosService);

  readonly servicios = signal<Servicio[]>([]);
  readonly areas = signal<Area[]>([]);
  readonly formAbierto = signal(false);
  readonly editando = signal<string | null>(null);
  readonly ocupado = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  form: ServicioIn = this.vacio();

  /** Catálogo global de procesos predeterminados: lo que toda oficina debería poder ofrecer. */
  readonly plantillas = signal<ServicioPlantilla[]>([]);
  readonly verPlantillas = signal(false);
  readonly formPlantillaAbierto = signal(false);
  readonly editandoPlantilla = signal<string | null>(null);
  readonly cargandoPredeterminados = signal(false);
  plantilla: ServicioPlantillaIn = this.plantillaVacia();
  readonly COLORES = ['#2B59F0', '#4E8A12', '#6D28D9', '#B45309', '#0369A1', '#B91C1C', '#0F766E', '#BE185D'];
  readonly ICONOS = ['description', 'badge', 'payments', 'work', 'medical_services', 'school', 'account_balance', 'support_agent', 'assignment', 'verified'];

  constructor() {
    effect(() => {
      const id = this.ctx.oficinaId();
      untracked(() => this.cargar(id));
    });
  }

  ngOnInit(): void { this.ctx.cargar(); this.cargarPlantillas(); }

  // ── Procesos predeterminados ──

  private cargarPlantillas(): void {
    this.api.plantillasServicio().subscribe({ next: p => this.plantillas.set(p), error: () => this.plantillas.set([]) });
  }

  /** Carga en la oficina los predeterminados que le falten (no duplica los que ya tiene). */
  cargarPredeterminados(): void {
    const of = this.ctx.oficinaId();
    if (!of) return;
    this.cargandoPredeterminados.set(true);
    this.api.cargarPredeterminados(of).subscribe({
      next: creados => {
        this.cargandoPredeterminados.set(false);
        this.aviso.set(creados.length ? `${creados.length} procesos cargados en esta oficina` : 'La oficina ya tenía todos los predeterminados');
        this.cargar(of);
        setTimeout(() => this.aviso.set(null), 3000);
      },
      error: e => { this.cargandoPredeterminados.set(false); this.error.set(e?.error?.message || 'No se pudieron cargar los predeterminados'); },
    });
  }

  nuevaPlantilla(): void { this.plantilla = this.plantillaVacia(); this.editandoPlantilla.set(null); this.formPlantillaAbierto.set(true); this.verPlantillas.set(true); }

  editarPlantilla(p: ServicioPlantilla): void {
    this.plantilla = { clave: p.clave, nombre: p.nombre, descripcion: p.descripcion, prefijo: p.prefijo, color: p.color, icono: p.icono,
      prioridad: p.prioridad, tiempo_estimado_min: p.tiempo_estimado_min, requiere_documento: p.requiere_documento,
      verificar_formulario: p.verificar_formulario, agendable: p.agendable, publico: p.publico, orden: p.orden, activo: p.activo };
    this.editandoPlantilla.set(p.id);
    this.formPlantillaAbierto.set(true);
  }

  guardarPlantilla(): void {
    const f: ServicioPlantillaIn = { ...this.plantilla, nombre: this.plantilla.nombre.trim(), prefijo: this.plantilla.prefijo.trim().toUpperCase() };
    const id = this.editandoPlantilla();
    this.ocupado.set(true);
    this.error.set(null);
    (id ? this.api.actualizarPlantillaServicio(id, f) : this.api.crearPlantillaServicio(f)).subscribe({
      next: () => { this.ocupado.set(false); this.formPlantillaAbierto.set(false); this.aviso.set(id ? 'Predeterminado actualizado' : 'Predeterminado creado'); this.cargarPlantillas(); setTimeout(() => this.aviso.set(null), 2500); },
      error: e => { this.ocupado.set(false); this.error.set(e?.error?.message || 'No se pudo guardar'); },
    });
  }

  eliminarPlantilla(p: ServicioPlantilla): void {
    if (!confirm(`¿Quitar "${p.nombre}" del catálogo de predeterminados? Las oficinas que ya lo cargaron lo conservan.`)) return;
    this.api.eliminarPlantillaServicio(p.id).subscribe({ next: () => this.cargarPlantillas(), error: () => {} });
  }

  private plantillaVacia(): ServicioPlantillaIn {
    return { clave: '', nombre: '', descripcion: '', prefijo: '', color: '#2B59F0', icono: 'description', prioridad: 5, tiempo_estimado_min: 10,
      requiere_documento: true, verificar_formulario: false, agendable: false, publico: true, orden: this.plantillas().length + 1, activo: true };
  }

  nuevo(): void { this.form = this.vacio(); this.editando.set(null); this.formAbierto.set(true); }

  editar(s: Servicio): void {
    this.form = {
      nombre: s.nombre, descripcion: s.descripcion, prefijo: s.prefijo, area_id: s.area_id, color: s.color, icono: s.icono,
      prioridad: s.prioridad, tiempo_estimado_min: s.tiempo_estimado_min, requiere_documento: s.requiere_documento,
      requiere_cita: s.requiere_cita, cupo_diario: s.cupo_diario, hora_apertura: s.hora_apertura?.slice(0, 5) ?? null,
      hora_cierre: s.hora_cierre?.slice(0, 5) ?? null, dias_habiles: s.dias_habiles, publico: s.publico, orden: s.orden, activo: s.activo,
      agendable: s.agendable, verificar_formulario: s.verificar_formulario,
    };
    this.editando.set(s.id);
    this.formAbierto.set(true);
  }

  guardar(): void {
    const of = this.ctx.oficinaId();
    if (!of) return;
    const f: ServicioIn = { ...this.form, nombre: this.form.nombre.trim(), prefijo: this.form.prefijo.trim().toUpperCase(),
      area_id: this.form.area_id || null, hora_apertura: this.form.hora_apertura || null, hora_cierre: this.form.hora_cierre || null };
    const id = this.editando();
    this.ocupado.set(true);
    this.error.set(null);
    (id ? this.api.actualizarServicio(id, f) : this.api.crearServicio(of, f)).subscribe({
      next: () => { this.ocupado.set(false); this.formAbierto.set(false); this.aviso.set(id ? 'Servicio actualizado' : 'Servicio creado'); this.cargar(of); setTimeout(() => this.aviso.set(null), 2500); },
      error: e => { this.ocupado.set(false); this.error.set(e?.error?.message || 'No se pudo guardar'); },
    });
  }

  desactivar(s: Servicio): void {
    if (!confirm(`¿Desactivar el servicio ${s.nombre}? Sale del kiosco y de la cola; el histórico se conserva.`)) return;
    this.api.desactivarServicio(s.id).subscribe({ next: () => this.cargar(this.ctx.oficinaId()), error: () => {} });
  }

  private cargar(id: string | null): void {
    if (!id) { this.servicios.set([]); this.areas.set([]); return; }
    this.api.servicios(id).subscribe({ next: s => this.servicios.set(s), error: () => this.servicios.set([]) });
    this.api.croquis(id).subscribe({ next: c => this.areas.set(c?.areas ?? []), error: () => this.areas.set([]) });
  }

  private vacio(): ServicioIn {
    return { nombre: '', descripcion: '', prefijo: '', area_id: null, color: '#2B59F0', icono: 'description', prioridad: 5,
      tiempo_estimado_min: 10, requiere_documento: false, requiere_cita: false, cupo_diario: 0, hora_apertura: null,
      hora_cierre: null, dias_habiles: null, publico: true, orden: this.servicios().length + 1, activo: true,
      agendable: false, verificar_formulario: false };
  }
}
