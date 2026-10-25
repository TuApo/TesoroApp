import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { filter } from 'rxjs/operators';

import { obtenerUsuarioActual } from '../../../../../../core/utils/usuario-actual';
import { Finca, Miembro, Tarea } from '../../campo.models';
import { CampoApiService } from '../../services/campo-api.service';
import { CampoService, haceCuanto, hoyIso, mensajeDe } from '../../services/campo.service';

type Pestana = 'PENDIENTE' | 'HECHA' | 'TODAS';
type Prioridad = Tarea['prioridad'];

interface FormTarea {
  id: number | null; asignado_a: string; finca_id: number | null; finca_nombre: string; visita_id: number | null;
  titulo: string; detalle: string; vence: string; prioridad: Prioridad;
}

const PESO_PRIORIDAD: Record<Prioridad, number> = { ALTA: 0, MEDIA: 1, BAJA: 2 };

/**
 * Tareas de campo (`/dashboard/campo/tareas`).
 *
 * El asignado la marca hecha (con nota) o la reabre: eso pasa por la cola del teléfono, así
 * que funciona sin señal y se envía al volver. Supervisión crea tareas para su equipo y
 * edita o borra las que creó. Sin señal se muestran las propias del paquete guardado.
 */
@Component({
  selector: 'app-campo-tareas',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  templateUrl: './tareas.component.html',
  styleUrls: ['../../campo-ui.css', './tareas.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TareasComponent {
  private readonly api = inject(CampoApiService);
  private readonly destroy = inject(DestroyRef);
  readonly campo = inject(CampoService);

  readonly haceCuanto = haceCuanto;

  readonly yo = computed(() => this.campo.paquete()?.usuario_id || obtenerUsuarioActual().id);
  readonly supervisa = this.campo.supervisa;
  readonly admin = computed(() => this.campo.paquete()?.perfil === 'ADMIN');

  readonly pestana = signal<Pestana>('PENDIENTE');
  readonly persona = signal('');
  readonly tareas = signal<Tarea[]>([]);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly desdePaquete = signal(false);
  readonly aviso = signal<{ texto: string; tipo: 'ok' | 'mal' } | null>(null);
  readonly trabajando = signal(false);

  readonly equipo = signal<Miembro[]>([]);
  private equipoPedido = false;

  /** Cambios de estado que esperan en la cola del teléfono (se pintan como si ya hubieran llegado). */
  private readonly enCola = computed(() => {
    const m = new Map<number, Tarea['estado']>();
    for (const e of this.campo.cola()) if (e.tipo === 'tarea') m.set(e.datos.tarea_id, e.datos.estado as Tarea['estado']);
    return m;
  });

  readonly visibles = computed(() => {
    const cola = this.enCola();
    const p = this.pestana();
    return this.tareas()
      .map(t => cola.has(t.id) ? { ...t, estado: cola.get(t.id) as Tarea['estado'] } : t)
      .filter(t => p === 'TODAS' || t.estado === p)
      .sort((a, b) => {
        if (a.estado !== b.estado) return a.estado === 'PENDIENTE' ? -1 : 1;
        if (a.estado === 'PENDIENTE') {
          if (this.vencida(a) !== this.vencida(b)) return this.vencida(a) ? -1 : 1;
          if (a.prioridad !== b.prioridad) return PESO_PRIORIDAD[a.prioridad] - PESO_PRIORIDAD[b.prioridad];
          return (a.vence ?? '9999').localeCompare(b.vence ?? '9999');
        }
        return (b.hecha_ms ?? 0) - (a.hecha_ms ?? 0);
      });
  });

  readonly pendientesEnCola = computed(() => [...this.enCola().keys()].length);

  // ─── Hojas ──────────────────────────────────────────────────────────────
  readonly cierre = signal<{ tarea: Tarea; nota: string } | null>(null);
  readonly form = signal<FormTarea | null>(null);
  readonly fincaQ = signal('');
  readonly fincasTodas = signal<Finca[] | null>(null);
  private fincasPedidas = false;

  readonly fincasSugeridas = computed(() => {
    const q = normalizar(this.fincaQ());
    if (!q) return [];
    return (this.fincasTodas() ?? this.campo.fincas())
      .filter(f => f.activa && normalizar(`${f.nombre} ${f.clave} ${f.zona_nombre ?? ''}`).includes(q))
      .slice(0, 10);
  });

  private relojAviso: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.campo.iniciar();
    this.cargar();
    effect(() => {
      if (this.supervisa()) untracked(() => this.cargarEquipo());
    });
    // Sin señal la lista sale del paquete: si el paquete se refresca, se vuelve a leer.
    effect(() => {
      this.campo.paquete();
      if (untracked(() => this.desdePaquete())) untracked(() => this.usarPaquete());
    });
    this.campo.eventos$.pipe(filter(e => e.nombre === 'campo-tarea'), takeUntilDestroyed(this.destroy))
      .subscribe(() => this.cargar());
  }

  cargar(): void {
    if (!this.campo.enLinea()) { this.usarPaquete(); return; }
    const p = this.pestana(), persona = this.persona();
    this.cargando.set(true);
    this.error.set(null);
    this.api.tareas({ asignado: persona || undefined, estado: p === 'TODAS' ? undefined : p }).subscribe({
      next: l => {
        if (this.pestana() !== p || this.persona() !== persona) return; // llegó tarde: ya se pidió otra cosa
        this.tareas.set(l);
        this.desdePaquete.set(false);
        this.cargando.set(false);
      },
      error: e => {
        this.cargando.set(false);
        if (this.campo.paquete()?.tareas?.length && !persona) this.usarPaquete();
        else this.error.set(mensajeDe(e, 'No se pudieron cargar las tareas'));
      },
    });
  }

  /** Las tareas propias que trae el paquete guardado en el teléfono. */
  private usarPaquete(): void {
    const yo = this.yo();
    this.tareas.set((this.campo.paquete()?.tareas ?? []).filter(t => t.asignado_a === yo));
    this.desdePaquete.set(true);
    this.error.set(null);
  }

  private cargarEquipo(): void {
    if (this.equipoPedido) return;
    this.equipoPedido = true;
    this.api.jerarquia().pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: l => this.equipo.set([...l].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))),
      error: () => { this.equipoPedido = false; },
    });
  }

  private cargarFincas(): void {
    if (this.fincasPedidas || !this.campo.enLinea()) return;
    this.fincasPedidas = true;
    this.api.fincas().pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: l => this.fincasTodas.set([...l].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))),
      error: () => { this.fincasPedidas = false; },
    });
  }

  verPestana(p: Pestana): void {
    this.pestana.set(p);
    this.cargar();
  }

  filtrar(id: string): void {
    this.persona.set(id);
    this.cargar();
  }

  // ─── Reglas ─────────────────────────────────────────────────────────────

  esMia(t: Tarea): boolean { return t.asignado_a === this.yo(); }
  laCree(t: Tarea): boolean { return this.supervisa() && (t.creado_por === this.yo() || this.admin()); }
  enEspera(t: Tarea): boolean { return this.enCola().has(t.id); }

  vencida(t: Tarea): boolean {
    if (t.estado !== 'PENDIENTE') return false;
    return t.vencida || (!!t.vence && t.vence.slice(0, 10) < hoyIso());
  }

  venceTexto(t: Tarea): string {
    if (!t.vence) return '';
    const iso = t.vence.slice(0, 10);
    const hoy = hoyIso();
    if (iso === hoy) return 'Vence hoy';
    const d = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
    return iso < hoy ? `Venció el ${d}` : `Vence el ${d}`;
  }

  // ─── Cerrar / reabrir (cola del teléfono) ───────────────────────────────

  abrirCierre(t: Tarea): void { this.cierre.set({ tarea: t, nota: '' }); }

  async confirmarCierre(): Promise<void> {
    const c = this.cierre();
    if (!c) return;
    await this.cambiarEstado(c.tarea, 'HECHA', c.nota.trim() || null);
    this.cierre.set(null);
  }

  async reabrir(t: Tarea): Promise<void> {
    await this.cambiarEstado(t, 'PENDIENTE', null);
  }

  private async cambiarEstado(t: Tarea, estado: 'HECHA' | 'PENDIENTE', nota: string | null): Promise<void> {
    this.trabajando.set(true);
    try {
      await this.campo.cerrarTarea(t.id, estado, nota);
      // Se refleja de una vez; si quedó en cola, la superposición de `enCola` la mantiene así.
      this.tareas.update(l => l.map(x => x.id === t.id
        ? { ...x, estado, nota_cierre: estado === 'HECHA' ? nota : null, hecha_ms: estado === 'HECHA' ? Date.now() : null }
        : x));
      const quedoEnCola = this.campo.cola().some(e => e.tipo === 'tarea' && e.datos.tarea_id === t.id);
      this.avisar(quedoEnCola
        ? 'Guardado en el teléfono: se enviará cuando haya señal'
        : estado === 'HECHA' ? 'Tarea marcada como hecha' : 'Tarea reabierta', 'ok');
    } catch (e) {
      this.avisar(mensajeDe(e, 'No se pudo cambiar el estado de la tarea'), 'mal');
    } finally {
      this.trabajando.set(false);
    }
  }

  // ─── Crear / editar / borrar (supervisión) ──────────────────────────────

  nueva(): void {
    this.cargarFincas();
    this.fincaQ.set('');
    this.form.set({
      id: null, asignado_a: this.persona(), finca_id: null, finca_nombre: '', visita_id: null,
      titulo: '', detalle: '', vence: '', prioridad: 'MEDIA',
    });
  }

  editar(t: Tarea): void {
    if (!this.laCree(t)) return;
    this.cargarFincas();
    this.fincaQ.set('');
    this.form.set({
      id: t.id, asignado_a: t.asignado_a, finca_id: t.finca_id, finca_nombre: t.finca_nombre ?? '', visita_id: t.visita_id,
      titulo: t.titulo, detalle: t.detalle ?? '', vence: (t.vence ?? '').slice(0, 10), prioridad: t.prioridad,
    });
  }

  poner<K extends keyof FormTarea>(campo: K, valor: FormTarea[K]): void {
    this.form.update(f => f && { ...f, [campo]: valor });
  }

  elegirFinca(f: Finca): void {
    this.form.update(v => v && { ...v, finca_id: f.id, finca_nombre: f.nombre });
    this.fincaQ.set('');
  }

  quitarFinca(): void {
    this.form.update(v => v && { ...v, finca_id: null, finca_nombre: '', visita_id: null });
  }

  /** Nombre del asignado aunque no esté en el equipo visible (al editar). */
  nombreDe(id: string): string { return this.equipo().find(m => m.usuario_id === id)?.nombre ?? ''; }

  guardar(): void {
    const f = this.form();
    if (!f) return;
    if (!f.asignado_a) { this.avisar('Elige a quién se le asigna', 'mal'); return; }
    if (!f.titulo.trim()) { this.avisar('Escribe el título de la tarea', 'mal'); return; }
    const datos: Partial<Tarea> = {
      asignado_a: f.asignado_a, finca_id: f.finca_id, visita_id: f.visita_id, titulo: f.titulo.trim(),
      detalle: f.detalle.trim() || null, vence: f.vence || null, prioridad: f.prioridad,
    };
    this.trabajando.set(true);
    const peticion = f.id == null ? this.api.crearTarea(datos) : this.api.editarTarea(f.id, datos);
    peticion.subscribe({
      next: () => {
        this.trabajando.set(false);
        this.form.set(null);
        this.avisar(f.id == null ? 'Tarea creada' : 'Tarea actualizada', 'ok');
        this.cargar();
      },
      error: e => { this.trabajando.set(false); this.avisar(mensajeDe(e, 'No se pudo guardar la tarea'), 'mal'); },
    });
  }

  borrar(): void {
    const f = this.form();
    if (!f?.id) return;
    if (!confirm(`¿Borrar la tarea «${f.titulo}»?`)) return;
    this.trabajando.set(true);
    this.api.borrarTarea(f.id).subscribe({
      next: () => {
        this.trabajando.set(false);
        this.form.set(null);
        this.tareas.update(l => l.filter(t => t.id !== f.id));
        this.avisar('Tarea borrada', 'ok');
      },
      error: e => { this.trabajando.set(false); this.avisar(mensajeDe(e, 'No se pudo borrar la tarea'), 'mal'); },
    });
  }

  avisar(texto: string, tipo: 'ok' | 'mal'): void {
    this.aviso.set({ texto, tipo });
    if (this.relojAviso) clearTimeout(this.relojAviso);
    this.relojAviso = setTimeout(() => this.aviso.set(null), 5000);
  }
}

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
