import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { filter } from 'rxjs/operators';

import { obtenerUsuarioActual } from '../../../../../../core/utils/usuario-actual';
import { ETIQUETA_VISITA, EstadoVisita, Finca, Miembro, Visita } from '../../campo.models';
import { CampoApiService } from '../../services/campo-api.service';
import { CampoService, horaCorta, hoyIso, mensajeDe } from '../../services/campo.service';

/** Un día de la semana con sus visitas. */
interface Dia { iso: string; nombre: string; numero: string; mes: string; hoy: boolean; pasado: boolean; visitas: Visita[] }

interface FormVisita {
  id: number | null; coordinador_id: string; finca_id: number | null; finca_nombre: string;
  fecha: string; hora_inicio: string; hora_fin: string; objetivo: string; notas: string;
  /** false = solo consulta (ya tiene marcación, no está programada o no es de quien la mira). */
  editable: boolean; visita: Visita | null;
}

const CLASE_ESTADO: Record<EstadoVisita, string> = {
  CUMPLIDA: 'ok', EN_CURSO: 'info', INCUMPLIDA: 'mal', PROGRAMADA: '', CANCELADA: 'cancelada',
};

/**
 * Agenda de visitas a fincas (`/dashboard/campo/agenda`).
 *
 * Semana de lunes a domingo: en el teléfono un día debajo del otro, en escritorio siete
 * columnas. El coordinador ve la suya (y puede programarse visitas si la configuración lo
 * permite); supervisión ve la de su equipo y filtra por persona. Sin señal se muestra la
 * agenda guardada en el paquete del teléfono.
 */
@Component({
  selector: 'app-campo-agenda',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  templateUrl: './agenda.component.html',
  styleUrls: ['../../campo-ui.css', './agenda.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgendaComponent {
  private readonly api = inject(CampoApiService);
  private readonly router = inject(Router);
  private readonly destroy = inject(DestroyRef);
  readonly campo = inject(CampoService);

  readonly ETIQUETA_VISITA = ETIQUETA_VISITA;
  readonly horaCorta = horaCorta;

  readonly yo = computed(() => this.campo.paquete()?.usuario_id || obtenerUsuarioActual().id);
  readonly supervisa = this.campo.supervisa;
  readonly puedeProgramar = computed(() => this.supervisa() || !!this.campo.paquete()?.config?.agenda_propia);

  readonly lunes = signal(lunesDe(hoyIso()));
  readonly coordinador = signal('');
  readonly visitas = signal<Visita[]>([]);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly desdePaquete = signal(false);
  readonly aviso = signal<{ texto: string; tipo: 'ok' | 'mal' } | null>(null);
  readonly trabajando = signal(false);

  readonly equipo = signal<Miembro[]>([]);
  private equipoPedido = false;

  readonly rango = computed(() => ({ desde: this.lunes(), hasta: sumarDias(this.lunes(), 6) }));
  readonly titulo = computed(() => {
    const { desde, hasta } = this.rango();
    const f = (iso: string, mes: boolean) => fecha(iso, mes ? { day: 'numeric', month: 'short' } : { day: 'numeric' });
    return desde.slice(0, 7) === hasta.slice(0, 7) ? `${f(desde, false)} – ${f(hasta, true)}` : `${f(desde, true)} – ${f(hasta, true)}`;
  });
  readonly esEstaSemana = computed(() => this.lunes() === lunesDe(hoyIso()));

  readonly dias = computed<Dia[]>(() => {
    const hoy = hoyIso();
    const porDia = new Map<string, Visita[]>();
    for (const v of this.visitas()) {
      const l = porDia.get(v.fecha) ?? [];
      l.push(v);
      porDia.set(v.fecha, l);
    }
    return Array.from({ length: 7 }, (_, i) => {
      const iso = sumarDias(this.lunes(), i);
      return {
        iso, hoy: iso === hoy, pasado: iso < hoy,
        nombre: fecha(iso, { weekday: 'long' }), numero: fecha(iso, { day: 'numeric' }), mes: fecha(iso, { month: 'short' }),
        visitas: (porDia.get(iso) ?? []).sort((a, b) => (a.hora_inicio ?? '99').localeCompare(b.hora_inicio ?? '99')),
      };
    });
  });

  readonly resumen = computed(() => {
    const l = this.visitas().filter(v => v.estado !== 'CANCELADA');
    return { total: l.length, cumplidas: l.filter(v => v.estado === 'CUMPLIDA').length, incumplidas: l.filter(v => v.estado === 'INCUMPLIDA').length };
  });

  // ─── Formulario ─────────────────────────────────────────────────────────
  readonly form = signal<FormVisita | null>(null);
  readonly fincaQ = signal('');
  readonly fincasTodas = signal<Finca[] | null>(null);
  private fincasPedidas = false;

  readonly fincasDisponibles = computed<Finca[]>(() => (this.fincasTodas() ?? this.campo.fincas()).filter(f => f.activa));
  readonly fincasSugeridas = computed(() => {
    const q = normalizar(this.fincaQ());
    const l = this.fincasDisponibles();
    const coincide = q ? l.filter(f => normalizar(`${f.nombre} ${f.clave} ${f.zona_nombre ?? ''}`).includes(q)) : l.filter(f => f.mia);
    return coincide.slice(0, 10);
  });

  private relojAviso: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.campo.iniciar();
    this.cargar();
    // El perfil llega con el paquete: cuando se sabe que supervisa, se trae el equipo para el filtro.
    effect(() => {
      if (this.supervisa()) untracked(() => this.cargarEquipo());
    });
    // Si el servidor avisa que cambió la agenda, se recarga la semana.
    this.campo.eventos$.pipe(filter(e => e.nombre === 'campo-agenda'), takeUntilDestroyed(this.destroy))
      .subscribe(() => this.cargar());
  }

  cargar(): void {
    const { desde, hasta } = this.rango();
    if (!this.campo.enLinea()) { this.usarPaquete(); return; }
    this.cargando.set(true);
    this.error.set(null);
    this.api.agenda({ desde, hasta, coordinador: this.coordinador() || undefined }).subscribe({
      next: l => {
        // Si en el entretanto se navegó a otra semana, esta respuesta ya no aplica.
        if (this.rango().desde !== desde) return;
        this.visitas.set(l);
        this.desdePaquete.set(false);
        this.cargando.set(false);
      },
      error: e => {
        this.cargando.set(false);
        if (this.campo.paquete()?.agenda?.length && !this.coordinador()) this.usarPaquete();
        else this.error.set(mensajeDe(e, 'No se pudo cargar la agenda'));
      },
    });
  }

  private usarPaquete(): void {
    const { desde, hasta } = this.rango();
    this.visitas.set((this.campo.paquete()?.agenda ?? []).filter(v => v.fecha >= desde && v.fecha <= hasta));
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
    if (this.fincasPedidas || !this.supervisa() || !this.campo.enLinea()) return;
    this.fincasPedidas = true;
    this.api.fincas().pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: l => this.fincasTodas.set([...l].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))),
      error: () => { this.fincasPedidas = false; },
    });
  }

  // ─── Navegación ─────────────────────────────────────────────────────────

  semana(delta: number): void {
    this.lunes.set(sumarDias(this.lunes(), delta * 7));
    this.cargar();
  }

  irAHoy(): void {
    this.lunes.set(lunesDe(hoyIso()));
    this.cargar();
  }

  filtrar(id: string): void {
    this.coordinador.set(id);
    this.cargar();
  }

  // ─── Visitas ────────────────────────────────────────────────────────────

  claseEstado(e: EstadoVisita): string { return CLASE_ESTADO[e] ?? ''; }

  puedeEditar(v: Visita): boolean {
    if (v.entrada_id || v.estado !== 'PROGRAMADA') return false;
    return this.supervisa() || (v.coordinador_id === this.yo() && !!this.campo.paquete()?.config?.agenda_propia);
  }

  puedeMarcar(v: Visita): boolean {
    return v.coordinador_id === this.yo() && v.fecha === hoyIso() && (v.estado === 'PROGRAMADA' || v.estado === 'EN_CURSO');
  }

  nueva(fechaIso?: string): void {
    if (!this.puedeProgramar()) return;
    this.cargarFincas();
    this.fincaQ.set('');
    const hoy = hoyIso();
    this.form.set({
      id: null, coordinador_id: this.supervisa() ? this.coordinador() : this.yo(), finca_id: null, finca_nombre: '',
      fecha: fechaIso && fechaIso >= hoy ? fechaIso : hoy, hora_inicio: '08:00', hora_fin: '10:00', objetivo: '', notas: '',
      editable: true, visita: null,
    });
  }

  abrir(v: Visita): void {
    const editable = this.puedeEditar(v);
    if (editable) this.cargarFincas();
    this.fincaQ.set('');
    this.form.set({
      id: v.id, coordinador_id: v.coordinador_id, finca_id: v.finca_id, finca_nombre: v.finca_nombre, fecha: v.fecha,
      hora_inicio: (v.hora_inicio ?? '').slice(0, 5), hora_fin: (v.hora_fin ?? '').slice(0, 5),
      objetivo: v.objetivo ?? '', notas: v.notas ?? '', editable, visita: v,
    });
  }

  poner<K extends keyof FormVisita>(campo: K, valor: FormVisita[K]): void {
    this.form.update(f => f && { ...f, [campo]: valor });
  }

  elegirFinca(f: Finca): void {
    this.form.update(v => v && { ...v, finca_id: f.id, finca_nombre: f.nombre });
    this.fincaQ.set('');
  }

  quitarFinca(): void {
    this.form.update(v => v && { ...v, finca_id: null, finca_nombre: '' });
  }

  guardar(): void {
    const f = this.form();
    if (!f || !f.editable) return;
    if (this.supervisa() && !f.coordinador_id) { this.avisar('Elige el coordinador', 'mal'); return; }
    if (f.finca_id == null) { this.avisar('Elige la finca', 'mal'); return; }
    if (!f.fecha) { this.avisar('Elige la fecha', 'mal'); return; }
    if (f.hora_inicio && f.hora_fin && f.hora_fin <= f.hora_inicio) { this.avisar('La hora de fin debe ser después de la de inicio', 'mal'); return; }
    const datos = {
      coordinador_id: f.coordinador_id || this.yo(), finca_id: f.finca_id, fecha: f.fecha,
      hora_inicio: f.hora_inicio || null, hora_fin: f.hora_fin || null,
      objetivo: f.objetivo.trim() || null, notas: f.notas.trim() || null,
    };
    this.trabajando.set(true);
    const peticion = f.id == null
      ? this.api.crearVisita(datos)
      : this.api.editarVisita(f.id, { ...datos, estado: f.visita?.estado ?? 'PROGRAMADA' });
    peticion.subscribe({
      next: () => {
        this.trabajando.set(false);
        this.form.set(null);
        this.avisar(f.id == null ? 'Visita programada' : 'Visita actualizada', 'ok');
        // Si quedó en otra semana, se salta a esa semana para verla.
        const lunes = lunesDe(datos.fecha);
        if (lunes !== this.lunes()) this.lunes.set(lunes);
        this.cargar();
        void this.campo.refrescar();
      },
      error: e => { this.trabajando.set(false); this.avisar(mensajeDe(e, 'No se pudo guardar la visita'), 'mal'); },
    });
  }

  cancelar(): void {
    const f = this.form();
    if (!f?.id || !f.editable) return;
    if (!confirm(`¿Cancelar la visita a ${f.finca_nombre} del ${fecha(f.fecha, { weekday: 'long', day: 'numeric', month: 'long' })}?`)) return;
    this.trabajando.set(true);
    this.api.cancelarVisita(f.id).subscribe({
      next: () => {
        this.trabajando.set(false);
        this.form.set(null);
        this.avisar('Visita cancelada', 'ok');
        this.cargar();
        void this.campo.refrescar();
      },
      error: e => { this.trabajando.set(false); this.avisar(mensajeDe(e, 'No se pudo cancelar la visita'), 'mal'); },
    });
  }

  marcar(v: Visita): void {
    this.form.set(null);
    void this.router.navigate(['/dashboard/campo/marcar'], { queryParams: { finca: v.finca_id } });
  }

  nombreCoordinador(id: string): string {
    return this.equipo().find(m => m.usuario_id === id)?.nombre ?? '';
  }

  fechaLarga(iso: string): string { return fecha(iso, { weekday: 'long', day: 'numeric', month: 'long' }); }

  avisar(texto: string, tipo: 'ok' | 'mal'): void {
    this.aviso.set({ texto, tipo });
    if (this.relojAviso) clearTimeout(this.relojAviso);
    this.relojAviso = setTimeout(() => this.aviso.set(null), 5000);
  }
}

// ─── Fechas (ISO 'YYYY-MM-DD', a mediodía UTC para que no se corran de día) ─────────

function sumarDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function lunesDe(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return sumarDias(iso, -((d.getUTCDay() + 6) % 7));
}

function fecha(iso: string, o: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('es-CO', { ...o, timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`)).replace('.', '');
}

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
