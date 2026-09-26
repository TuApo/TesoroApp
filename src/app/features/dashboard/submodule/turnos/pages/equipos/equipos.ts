import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Observable } from 'rxjs';

import { SelectorOficina } from '../../components/selector-oficina/selector-oficina';
import { ContextoTurnosService } from '../../service/contexto-turnos.service';
import {
  AgendaConfig, AgendaConfigIn, AreaEquipo, Horario, HorarioIn, Miembro, Servicio, TurnosService, UsuarioPlataforma,
} from '../../service/turnos.service';
import { GestionRolesSService, Rol } from '../../../users/services/gestion-roles/gestion-roles-s.service';

type Pestana = 'equipos' | 'horarios' | 'agenda';

/**
 * Equipos, horarios y agenda de la oficina elegida.
 *
 * <ul>
 *   <li><b>Equipos</b>: qué ROLES trabajan en cada área del plano y qué PERSONAS fijas; un área sin
 *       nada configurado está abierta a todos. Es lo que decide dónde puede uno "iniciar turno" y a
 *       quién se le avisa cuando entra un turno del área.</li>
 *   <li><b>Horarios</b>: por persona o por rol, con área y puesto preferido; dentro de la ventana la
 *       persona queda en turno sola (y el puesto se abre solo si así se marca).</li>
 *   <li><b>Agenda</b>: cuándo se dan citas (general de la oficina y, si hace falta, por trámite) y el
 *       enlace público para que aspirantes y empleados agenden.</li>
 * </ul>
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-turnos-equipos',
  imports: [CommonModule, FormsModule, MatIconModule, SelectorOficina],
  templateUrl: './equipos.html',
  styleUrls: ['../../styles/turnos-comun.css', './equipos.css'],
})
export class Equipos implements OnInit {
  readonly ctx = inject(ContextoTurnosService);
  private api = inject(TurnosService);
  private rolesApi = inject(GestionRolesSService);

  readonly pestana = signal<Pestana>('equipos');
  readonly ocupado = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  readonly areas = signal<AreaEquipo[]>([]);
  readonly roles = signal<Rol[]>([]);
  readonly servicios = signal<Servicio[]>([]);
  readonly horarios = signal<Horario[]>([]);
  readonly configs = signal<AgendaConfig[]>([]);

  /** Búsqueda de personas para miembros y horarios (administración filtra por cédula o correo). */
  readonly busqueda = signal('');
  readonly encontrados = signal<UsuarioPlataforma[]>([]);
  readonly buscando = signal(false);
  private temporizador: ReturnType<typeof setTimeout> | null = null;
  /** Área a la que se le está agregando un miembro. */
  readonly areaEditando = signal<string | null>(null);
  rolNuevo: Record<string, string> = {};

  // ── Horarios ──
  readonly formHorarioAbierto = signal(false);
  readonly editandoHorario = signal<string | null>(null);
  horario = this.horarioVacio();
  horarioPersona: UsuarioPlataforma | null = null;
  readonly DIAS = [
    { n: 1, l: 'L' }, { n: 2, l: 'M' }, { n: 3, l: 'X' }, { n: 4, l: 'J' }, { n: 5, l: 'V' }, { n: 6, l: 'S' }, { n: 7, l: 'D' },
  ];

  // ── Agenda ──
  readonly formAgendaAbierto = signal(false);
  agenda: AgendaConfigIn = this.agendaVacia();

  readonly puntosDelAreaHorario = computed(() => this.areas().find(a => a.id === this.horario.area_id)?.puntos ?? []);
  readonly enlaceAgenda = computed(() => {
    const o = this.ctx.oficina();
    if (!o || typeof window === 'undefined') return '';
    return `${window.location.origin}${window.location.pathname}#/agendar/${o.codigo}`;
  });
  readonly serviciosAgendables = computed(() => this.servicios().filter(s => s.agendable));

  constructor() {
    effect(() => {
      const id = this.ctx.oficinaId();
      untracked(() => this.cargar(id));
    });
  }

  ngOnInit(): void {
    this.ctx.cargar();
    this.rolesApi.list().subscribe({ next: r => this.roles.set(r), error: () => this.roles.set([]) });
  }

  private cargar(id: string | null): void {
    if (!id) { this.areas.set([]); this.horarios.set([]); this.configs.set([]); this.servicios.set([]); return; }
    this.api.equipos(id).subscribe({ next: a => this.areas.set(a), error: () => this.areas.set([]) });
    this.api.horarios(id).subscribe({ next: h => this.horarios.set(h), error: () => this.horarios.set([]) });
    this.api.agendaConfigs(id).subscribe({ next: c => this.configs.set(c), error: () => this.configs.set([]) });
    this.api.servicios(id).subscribe({ next: s => this.servicios.set(s.filter(x => x.activo)), error: () => this.servicios.set([]) });
  }

  // ═══════════════════ Equipos ═══════════════════

  agregarRol(a: AreaEquipo): void {
    const rol = (this.rolNuevo[a.id] || '').trim().toUpperCase();
    if (!rol || a.roles.includes(rol)) return;
    this.guardarRoles(a, [...a.roles, rol]);
    this.rolNuevo[a.id] = '';
  }

  quitarRol(a: AreaEquipo, rol: string): void { this.guardarRoles(a, a.roles.filter(r => r !== rol)); }

  private guardarRoles(a: AreaEquipo, roles: string[]): void {
    this.correr(this.api.guardarRolesDeArea(a.id, roles), r => {
      this.areas.update(lista => lista.map(x => (x.id === a.id ? { ...x, roles: r } : x)));
      this.aviso.set(`Roles de ${a.nombre} guardados`);
    });
  }

  buscarPersonas(q: string): void {
    this.busqueda.set(q);
    if (this.temporizador) clearTimeout(this.temporizador);
    const texto = q.trim();
    if (texto.length < 3) { this.encontrados.set([]); return; }
    this.temporizador = setTimeout(() => {
      this.buscando.set(true);
      this.api.buscarUsuarios(texto).subscribe({
        next: u => { this.encontrados.set(u); this.buscando.set(false); },
        error: () => { this.encontrados.set([]); this.buscando.set(false); },
      });
    }, 350);
  }

  agregarMiembro(a: AreaEquipo, u: UsuarioPlataforma): void {
    if (a.miembros.some(m => m.usuario_ref === u.id)) return;
    const nuevos: Miembro[] = [...a.miembros, { usuario_ref: u.id, usuario_nombre: u.nombre }];
    this.correr(this.api.guardarMiembrosDeArea(a.id, nuevos), m => {
      this.areas.update(lista => lista.map(x => (x.id === a.id ? { ...x, miembros: m } : x)));
      this.encontrados.set([]);
      this.busqueda.set('');
      this.areaEditando.set(null);
      this.aviso.set(`${u.nombre} ahora trabaja en ${a.nombre}`);
    });
  }

  quitarMiembro(a: AreaEquipo, m: Miembro): void {
    this.correr(this.api.guardarMiembrosDeArea(a.id, a.miembros.filter(x => x.usuario_ref !== m.usuario_ref)), r => {
      this.areas.update(lista => lista.map(x => (x.id === a.id ? { ...x, miembros: r } : x)));
    });
  }

  // ═══════════════════ Horarios ═══════════════════

  nuevoHorario(): void {
    this.horario = this.horarioVacio();
    this.horarioPersona = null;
    this.editandoHorario.set(null);
    this.formHorarioAbierto.set(true);
  }

  editarHorario(h: Horario): void {
    this.horario = {
      area_id: h.area_id, punto_id: h.punto_id, usuario_ref: h.usuario_ref, usuario_nombre: h.usuario_nombre, rol: h.rol,
      dias: h.dias, hora_inicio: h.hora_inicio.slice(0, 5), hora_fin: h.hora_fin.slice(0, 5), auto_abrir: h.auto_abrir, activo: h.activo,
    };
    this.horarioPersona = h.usuario_ref ? { id: h.usuario_ref, nombre: h.usuario_nombre || h.usuario_ref, documento: null, correo: null, rol: null } : null;
    this.editandoHorario.set(h.id);
    this.formHorarioAbierto.set(true);
  }

  elegirPersonaHorario(u: UsuarioPlataforma): void {
    this.horarioPersona = u;
    this.horario.usuario_ref = u.id;
    this.horario.usuario_nombre = u.nombre;
    this.horario.rol = null;
    this.encontrados.set([]);
    this.busqueda.set('');
  }

  quitarPersonaHorario(): void { this.horarioPersona = null; this.horario.usuario_ref = null; this.horario.usuario_nombre = null; }

  diaMarcado(n: number): boolean { return (this.horario.dias || '').includes(String(n)); }
  alternarDia(n: number): void {
    const set = new Set((this.horario.dias || '').split('').filter(Boolean));
    if (set.has(String(n))) set.delete(String(n)); else set.add(String(n));
    this.horario.dias = [...set].sort().join('');
  }

  guardarHorario(): void {
    const of = this.ctx.oficinaId();
    if (!of) return;
    const h: HorarioIn = { ...this.horario, area_id: this.horario.area_id || null, punto_id: this.horario.punto_id || null,
      rol: this.horario.usuario_ref ? null : (this.horario.rol || null) };
    if (!h.usuario_ref && !h.rol) { this.error.set('Elija una persona o un rol'); setTimeout(() => this.error.set(null), 3000); return; }
    if (!h.dias) { this.error.set('Marque al menos un día'); setTimeout(() => this.error.set(null), 3000); return; }
    const id = this.editandoHorario();
    this.correr(id ? this.api.actualizarHorario(id, h) : this.api.crearHorario(of, h), () => {
      this.formHorarioAbierto.set(false);
      this.aviso.set(id ? 'Horario actualizado' : 'Horario creado');
      this.api.horarios(of).subscribe({ next: l => this.horarios.set(l), error: () => {} });
    });
  }

  eliminarHorario(h: Horario): void {
    if (!confirm(`¿Eliminar el horario de ${h.usuario_nombre || h.rol}?`)) return;
    this.correr(this.api.eliminarHorario(h.id), () => this.horarios.update(l => l.filter(x => x.id !== h.id)));
  }

  diasTexto(dias: string): string {
    const l = ['', 'L', 'M', 'X', 'J', 'V', 'S', 'D'];
    const d = (dias || '').split('').map(Number).filter(n => n >= 1 && n <= 7);
    const seguidos = d.length >= 3 && d.every((v, i) => i === 0 || v === d[i - 1] + 1);
    return seguidos ? `${l[d[0]]}-${l[d[d.length - 1]]}` : d.map(n => l[n]).join(', ');
  }

  private horarioVacio(): HorarioIn {
    return { area_id: null, punto_id: null, usuario_ref: null, usuario_nombre: null, rol: null, dias: '12345', hora_inicio: '08:00', hora_fin: '17:00', auto_abrir: true, activo: true };
  }

  // ═══════════════════ Agenda ═══════════════════

  nuevaAgenda(servicioId: string | null = null): void {
    const existente = this.configs().find(c => (c.servicio_id ?? null) === servicioId);
    this.agenda = existente ? {
      servicio_id: existente.servicio_id, dias: existente.dias, hora_inicio: existente.hora_inicio.slice(0, 5), hora_fin: existente.hora_fin.slice(0, 5),
      minutos_cita: existente.minutos_cita, cupo_por_franja: existente.cupo_por_franja,
      anticipacion_min_horas: existente.anticipacion_min_horas, anticipacion_max_dias: existente.anticipacion_max_dias, activo: existente.activo,
    } : { ...this.agendaVacia(), servicio_id: servicioId };
    this.formAgendaAbierto.set(true);
  }

  diaAgendaMarcado(n: number): boolean { return (this.agenda.dias || '').includes(String(n)); }
  alternarDiaAgenda(n: number): void {
    const set = new Set((this.agenda.dias || '').split('').filter(Boolean));
    if (set.has(String(n))) set.delete(String(n)); else set.add(String(n));
    this.agenda.dias = [...set].sort().join('');
  }

  guardarAgenda(): void {
    const of = this.ctx.oficinaId();
    if (!of) return;
    this.correr(this.api.guardarAgendaConfig(of, { ...this.agenda, servicio_id: this.agenda.servicio_id || null }), () => {
      this.formAgendaAbierto.set(false);
      this.aviso.set('Agenda guardada');
      this.api.agendaConfigs(of).subscribe({ next: c => this.configs.set(c), error: () => {} });
    });
  }

  eliminarAgenda(c: AgendaConfig): void {
    if (!confirm(`¿Quitar la agenda ${c.servicio_nombre ? 'de ' + c.servicio_nombre : 'general'}?`)) return;
    this.correr(this.api.eliminarAgendaConfig(c.id), () => this.configs.update(l => l.filter(x => x.id !== c.id)));
  }

  copiarEnlace(): void {
    const e = this.enlaceAgenda();
    if (!e) return;
    navigator.clipboard?.writeText(e).then(() => { this.aviso.set('Enlace copiado'); setTimeout(() => this.aviso.set(null), 2000); });
  }

  private agendaVacia(): AgendaConfigIn {
    return { servicio_id: null, dias: '12345', hora_inicio: '08:00', hora_fin: '17:00', minutos_cita: 20, cupo_por_franja: 1, anticipacion_min_horas: 2, anticipacion_max_dias: 30, activo: true };
  }

  // ── Auxiliares ──

  horaDe(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  }

  private correr<T>(obs: Observable<T>, ok: (v: T) => void): void {
    this.ocupado.set(true);
    this.error.set(null);
    obs.subscribe({
      next: v => { this.ocupado.set(false); ok(v); setTimeout(() => this.aviso.set(null), 2500); },
      error: e => {
        this.ocupado.set(false);
        const err = (e as { error?: { message?: string; error?: string } })?.error;
        this.error.set(err?.message || err?.error || 'No se pudo completar la acción');
        setTimeout(() => this.error.set(null), 4000);
      },
    });
  }
}
