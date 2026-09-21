import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { Observable } from 'rxjs';

import { ContextoTurnosService } from '../../service/contexto-turnos.service';
import { Area, Oficina, OficinaIn, Punto, PuntoIn, Servicio, TurnosService } from '../../service/turnos.service';
import { UtilityServiceService } from '../../../../../../shared/services/utilityService/utility-service.service';

interface Sede { id: string; nombre: string; }

/**
 * Oficinas y sus puntos de atención. El croquis se edita aparte (pantalla completa).
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-turnos-oficinas',
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './oficinas.html',
  styleUrls: ['../../styles/turnos-comun.css', './oficinas.css'],
})
export class Oficinas implements OnInit {
  readonly ctx = inject(ContextoTurnosService);
  private api = inject(TurnosService);
  private router = inject(Router);
  private utilidades = inject(UtilityServiceService);

  readonly oficinas = signal<Oficina[]>([]);
  readonly sedes = signal<Sede[]>([]);
  readonly seleccionada = signal<Oficina | null>(null);
  readonly puntos = signal<Punto[]>([]);
  readonly areas = signal<Area[]>([]);
  readonly servicios = signal<Servicio[]>([]);
  readonly mostrarInactivas = signal(false);
  readonly formAbierto = signal<'' | 'oficina' | 'punto'>('');
  readonly editando = signal<string | null>(null);
  readonly ocupado = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  readonly visibles = computed(() => this.oficinas().filter(o => this.mostrarInactivas() || o.activa));

  formOficina: OficinaIn & { dias: boolean[] } = this.oficinaVacia();
  formPunto: PuntoIn & { servicios: string[] } = { nombre: '', codigo: '', tipo: 'FIJO', area_id: null, orden: 0, activo: true, servicios: [] };
  readonly DIAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

  constructor() {
    effect(() => {
      const of = this.seleccionada();
      untracked(() => this.cargarDetalle(of));
    });
  }

  ngOnInit(): void {
    this.ctx.cargar();
    this.cargar();
    this.utilidades.traerSucursales().subscribe({
      next: (r: unknown) => {
        const lista = Array.isArray(r) ? r : (r as { results?: unknown[] })?.results ?? [];
        this.sedes.set((lista as Array<{ id: string; nombre: string }>).map(s => ({ id: String(s.id), nombre: s.nombre })));
      },
      error: () => this.sedes.set([]),
    });
  }

  cargar(): void {
    this.api.oficinas(false).subscribe({
      next: lista => {
        this.oficinas.set(lista);
        const actual = this.seleccionada();
        const pref = this.ctx.oficinaId();
        const elegida = lista.find(o => o.id === actual?.id) ?? lista.find(o => o.id === pref) ?? lista[0] ?? null;
        this.seleccionada.set(elegida);
      },
      error: () => this.error.set('No se pudieron cargar las oficinas'),
    });
  }

  seleccionar(o: Oficina): void {
    this.seleccionada.set(o);
    this.formAbierto.set('');
  }

  // ── Oficina ──
  nuevaOficina(): void {
    this.formOficina = this.oficinaVacia();
    this.editando.set(null);
    this.formAbierto.set('oficina');
  }

  editarOficina(o: Oficina): void {
    const dias = (o.dias_habiles || '1111100').split('').map(c => c === '1');
    this.formOficina = {
      nombre: o.nombre, codigo: o.codigo, sede_ref: o.sede_ref, sede_nombre: o.sede_nombre,
      direccion: o.direccion, ciudad: o.ciudad, telefono: o.telefono,
      hora_apertura: o.hora_apertura?.slice(0, 5) ?? null, hora_cierre: o.hora_cierre?.slice(0, 5) ?? null,
      dias_habiles: o.dias_habiles, activa: o.activa, ui_json: o.ui_json, dias,
    };
    this.editando.set(o.id);
    this.formAbierto.set('oficina');
  }

  guardarOficina(): void {
    const f = this.formOficina;
    const sede = this.sedes().find(s => s.id === f.sede_ref);
    const cuerpo: OficinaIn = {
      nombre: f.nombre.trim(), codigo: f.codigo.trim().toUpperCase(),
      sede_ref: f.sede_ref || null, sede_nombre: sede?.nombre ?? null,
      direccion: f.direccion || null, ciudad: f.ciudad || null, telefono: f.telefono || null,
      hora_apertura: f.hora_apertura || null, hora_cierre: f.hora_cierre || null,
      dias_habiles: f.dias.map(d => (d ? '1' : '0')).join(''), activa: f.activa ?? true,
    };
    const id = this.editando();
    this.correr(id ? this.api.actualizarOficina(id, cuerpo) : this.api.crearOficina(cuerpo), o => {
      this.formAbierto.set('');
      this.aviso.set(id ? 'Oficina actualizada' : 'Oficina creada');
      this.cargar();
      this.ctx.cargar(true);
      this.seleccionada.set(o);
    });
  }

  desactivarOficina(o: Oficina): void {
    if (!confirm(`¿Desactivar la oficina ${o.nombre}? No se borra: deja de recibir turnos.`)) return;
    this.correr(this.api.desactivarOficina(o.id), () => { this.aviso.set('Oficina desactivada'); this.cargar(); this.ctx.cargar(true); });
  }

  irAlCroquis(o: Oficina): void { this.router.navigate(['/dashboard/turnos/oficinas', o.id, 'croquis']); }
  irAlCartel(o: Oficina): void { this.ctx.seleccionarOficina(o.id); this.router.navigate(['/dashboard/turnos/cartel']); }

  // ── Puntos ──
  nuevoPunto(): void {
    this.formPunto = { nombre: '', codigo: '', tipo: 'FIJO', area_id: null, orden: this.puntos().length + 1, activo: true, servicios: [] };
    this.editando.set(null);
    this.formAbierto.set('punto');
  }

  editarPunto(p: Punto): void {
    this.formPunto = { nombre: p.nombre, codigo: p.codigo ?? '', tipo: p.tipo, area_id: p.area_id, orden: p.orden, activo: p.activo, servicios: [...p.servicios] };
    this.editando.set(p.id);
    this.formAbierto.set('punto');
  }

  alternarServicioPunto(id: string): void {
    const s = this.formPunto.servicios;
    this.formPunto.servicios = s.includes(id) ? s.filter(x => x !== id) : [...s, id];
  }

  guardarPunto(): void {
    const of = this.seleccionada();
    if (!of) return;
    const f = this.formPunto;
    const cuerpo: PuntoIn = { nombre: f.nombre.trim(), codigo: f.codigo || null, tipo: f.tipo, area_id: f.area_id || null, orden: f.orden, activo: f.activo, servicios: f.servicios };
    const id = this.editando();
    this.correr(id ? this.api.actualizarPunto(id, cuerpo) : this.api.crearPunto(of.id, cuerpo), () => {
      this.formAbierto.set('');
      this.aviso.set(id ? 'Punto actualizado' : 'Punto creado');
      this.cargarDetalle(of);
    });
  }

  eliminarPunto(p: Punto): void {
    if (!confirm(`¿Eliminar el punto ${p.nombre}?`)) return;
    this.correr(this.api.eliminarPunto(p.id), () => { this.aviso.set('Punto eliminado'); this.cargarDetalle(this.seleccionada()); });
  }

  nombreServicio(id: string): string { return this.servicios().find(s => s.id === id)?.nombre ?? id; }

  private cargarDetalle(of: Oficina | null): void {
    if (!of) { this.puntos.set([]); this.areas.set([]); this.servicios.set([]); return; }
    this.api.puntos(of.id).subscribe({ next: p => this.puntos.set(p), error: () => this.puntos.set([]) });
    this.api.servicios(of.id).subscribe({ next: s => this.servicios.set(s), error: () => this.servicios.set([]) });
    this.api.croquis(of.id).subscribe({ next: c => this.areas.set(c?.areas ?? []), error: () => this.areas.set([]) });
  }

  private oficinaVacia(): OficinaIn & { dias: boolean[] } {
    return { nombre: '', codigo: '', sede_ref: null, sede_nombre: null, direccion: '', ciudad: '', telefono: '',
      hora_apertura: '08:00', hora_cierre: '17:00', dias_habiles: '1111100', activa: true, dias: [true, true, true, true, true, false, false] };
  }

  private correr<T>(obs: Observable<T>, ok: (v: T) => void): void {
    this.ocupado.set(true);
    this.error.set(null);
    obs.subscribe({
      next: v => { this.ocupado.set(false); ok(v); setTimeout(() => this.aviso.set(null), 2500); },
      error: e => {
        this.ocupado.set(false);
        const m = (e as { error?: { message?: string } })?.error?.message;
        this.error.set(m || 'No se pudo completar la acción');
      },
    });
  }
}
