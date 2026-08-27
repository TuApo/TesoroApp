import {
  Component, ChangeDetectionStrategy, OnInit, OnDestroy, signal, computed, inject, PLATFORM_ID,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatChipsModule } from '@angular/material/chips';
import { MatMenuModule } from '@angular/material/menu';

import Swal from 'sweetalert2';

import {
  AgentesService, AgenteCatalogo, Catalogo, Cuenta, EstadoAgentes, EventoBitacora,
  Repo, Tarea, Vigilante,
} from '../../service/agentes.service';

type Pestana = 'panel' | 'nuevo' | 'agentes' | 'historial';

/** Cada cuánto se refresca el panel. Ojo: /ia/** va con rate limit en el gateway. */
const MS_REFRESCO_PANEL = 3000;
const MS_REFRESCO_CONSOLA = 2000;

@Component({
  selector: 'app-agentes-desarrollo',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatCardModule, MatButtonModule, MatIconModule, MatTooltipModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatSlideToggleModule,
    MatProgressSpinnerModule, MatProgressBarModule, MatChipsModule, MatMenuModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './agentes-desarrollo.component.html',
  styleUrls: ['./agentes-desarrollo.component.css'],
})
export class AgentesDesarrolloComponent implements OnInit, OnDestroy {
  private svc = inject(AgentesService);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  // ── Estado general ────────────────────────────────────────────────────────
  pestana = signal<Pestana>('panel');
  cargando = signal(true);
  error = signal<string | null>(null);
  servicioCaido = signal(false);

  estado = signal<EstadoAgentes | null>(null);
  catalogo = signal<Catalogo | null>(null);
  repos = signal<Repo[]>([]);

  // ── Consola de una tarea ──────────────────────────────────────────────────
  tareaAbierta = signal<Tarea | null>(null);
  bitacora = signal<EventoBitacora[]>([]);
  private leidosBitacora = 0;

  // ── Formulario de encargo ─────────────────────────────────────────────────
  fObjetivo = signal('');
  fContexto = signal('');
  fAgente = signal<string>('backend-dev');
  fRepo = signal<string>('todos');
  fPrioridad = signal<number>(3);
  fPermiso = signal<string>('acceptEdits');
  fMinutos = signal<number>(30);
  fModelo = signal<string>('');
  fEnjambre = signal(false);
  fAgentesEnjambre = signal<string[]>([]);
  fModoEnjambre = signal<'paralelo' | 'secuencial'>('paralelo');
  enviando = signal(false);

  // ── Catálogo ──────────────────────────────────────────────────────────────
  busquedaAgente = signal('');
  categoriaFiltro = signal<string>('');

  private tempPanel?: ReturnType<typeof setInterval>;
  private tempConsola?: ReturnType<typeof setInterval>;

  // ── Derivados ─────────────────────────────────────────────────────────────

  enCurso = computed(() => this.estado()?.enCurso ?? []);
  cola = computed(() => this.estado()?.cola ?? []);
  cuentas = computed(() => this.estado()?.cuentas ?? []);
  vigilantes = computed(() => this.estado()?.vigilantes ?? []);
  ultimas = computed(() => this.estado()?.ultimas ?? []);

  /** Agentes que están literalmente trabajando ahora mismo, con su cuenta. */
  agentesTrabajando = computed(() =>
    this.enCurso().map((t) => ({
      tarea: t,
      agente: this.catalogo()?.agentes.find((a) => a.clave === t.agente) ?? null,
    })),
  );

  hayPool = computed(() => (this.estado()?.pool.cuentas ?? 0) > 0);
  poolSinSesion = computed(() => {
    const p = this.estado()?.pool;
    return !!p && p.cuentas > 0 && p.cuentas === p.sinSesion;
  });

  agentesFiltrados = computed(() => {
    const todos = this.catalogo()?.agentes ?? [];
    const q = this.busquedaAgente().trim().toLowerCase();
    const cat = this.categoriaFiltro();
    return todos.filter((a) => {
      if (cat && a.categoria !== cat) return false;
      if (!q) return true;
      return (
        a.clave.toLowerCase().includes(q) ||
        a.nombre.toLowerCase().includes(q) ||
        a.descripcion.toLowerCase().includes(q) ||
        a.capacidades.some((c) => c.toLowerCase().includes(q))
      );
    });
  });

  agentesOrdenados = computed(() =>
    [...(this.catalogo()?.agentes ?? [])].sort((a, b) => a.nombre.localeCompare(b.nombre)),
  );

  // ── Ciclo de vida ─────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.cargarFijos();
    this.refrescar();
    if (this.isBrowser) {
      this.tempPanel = setInterval(() => {
        // Sin pestaña visible no se consulta: evita castigar el rate limit del gateway.
        if (document.visibilityState === 'visible') this.refrescar();
      }, MS_REFRESCO_PANEL);
    }
  }

  ngOnDestroy(): void {
    if (this.tempPanel) clearInterval(this.tempPanel);
    if (this.tempConsola) clearInterval(this.tempConsola);
  }

  private cargarFijos(): void {
    this.svc.catalogo().subscribe({
      next: (c) => this.catalogo.set(c),
      error: () => this.catalogo.set(null),
    });
    this.svc.repos().subscribe({
      next: (r) => this.repos.set(r ?? []),
      error: () => this.repos.set([]),
    });
  }

  refrescar(): void {
    this.svc.estado().subscribe({
      next: (e) => {
        this.estado.set(e);
        this.servicioCaido.set(false);
        this.error.set(null);
        this.cargando.set(false);
        const abierta = this.tareaAbierta();
        if (abierta) {
          const viva = [...e.enCurso, ...e.cola, ...e.ultimas].find((t) => t.id === abierta.id);
          if (viva) this.tareaAbierta.set(viva);
        }
      },
      error: (err) => {
        this.cargando.set(false);
        this.servicioCaido.set(true);
        this.error.set(
          err?.status === 503
            ? 'El servicio de agentes no está respondiendo en el host (systemd tuapo-agentes).'
            : err?.status === 403
              ? 'Este modo es solo para administradores.'
              : 'No se pudo consultar el estado de los agentes.',
        );
      },
    });
  }

  // ── Consola ───────────────────────────────────────────────────────────────

  abrirConsola(t: Tarea): void {
    this.tareaAbierta.set(t);
    this.bitacora.set([]);
    this.leidosBitacora = 0;
    this.tirarBitacora();
    if (this.tempConsola) clearInterval(this.tempConsola);
    if (this.isBrowser) {
      this.tempConsola = setInterval(() => {
        const a = this.tareaAbierta();
        if (!a) return;
        if (document.visibilityState !== 'visible') return;
        this.tirarBitacora();
        if (!this.estaViva(a)) {
          clearInterval(this.tempConsola);
          this.tempConsola = undefined;
        }
      }, MS_REFRESCO_CONSOLA);
    }
  }

  cerrarConsola(): void {
    this.tareaAbierta.set(null);
    this.bitacora.set([]);
    if (this.tempConsola) { clearInterval(this.tempConsola); this.tempConsola = undefined; }
  }

  private tirarBitacora(): void {
    const t = this.tareaAbierta();
    if (!t) return;
    this.svc.bitacora(t.id, this.leidosBitacora).subscribe({
      next: (nuevos) => {
        if (!nuevos?.length) return;
        this.leidosBitacora += nuevos.length;
        this.bitacora.set([...this.bitacora(), ...nuevos]);
      },
      error: () => { /* la consola no es crítica: se reintenta al siguiente tirón */ },
    });
    this.svc.tarea(t.id).subscribe({
      next: (fresca) => this.tareaAbierta.set(fresca),
      error: () => { /* idem */ },
    });
  }

  // ── Acciones ──────────────────────────────────────────────────────────────

  encargar(): void {
    const objetivo = this.fObjetivo().trim();
    if (!objetivo) {
      Swal.fire('Falta el encargo', 'Escribe qué quieres que hagan los agentes.', 'info');
      return;
    }
    if (this.poolSinSesion()) {
      Swal.fire(
        'No hay ninguna cuenta con sesión',
        'Ninguna cuenta del pool ha iniciado sesión todavía, así que el encargo se quedaría esperando en la cola. Inicia sesión en al menos una desde el servidor.',
        'warning',
      );
      return;
    }
    const comun = {
      objetivo,
      contexto: this.fContexto().trim() || null,
      repo: this.fRepo(),
      prioridad: this.fPrioridad(),
      permiso: this.fPermiso(),
      minutos: this.fMinutos(),
      modelo: this.fModelo() || null,
    };
    this.enviando.set(true);

    if (this.fEnjambre()) {
      const agentes = this.fAgentesEnjambre();
      if (!agentes.length) {
        this.enviando.set(false);
        Swal.fire('Elige agentes', 'Un enjambre necesita al menos un agente.', 'info');
        return;
      }
      this.svc.crearEnjambre({ ...comun, agentes, modo: this.fModoEnjambre() }).subscribe({
        next: (r) => {
          this.enviando.set(false);
          this.fObjetivo.set('');
          this.pestana.set('panel');
          this.refrescar();
          Swal.fire('Enjambre lanzado', `${r.tareas.length} agentes se pusieron en marcha.`, 'success');
        },
        error: (e) => { this.enviando.set(false); this.avisarError(e); },
      });
      return;
    }

    this.svc.crearTarea({ ...comun, agente: this.fAgente() || null }).subscribe({
      next: (t) => {
        this.enviando.set(false);
        this.fObjetivo.set('');
        this.pestana.set('panel');
        this.refrescar();
        this.abrirConsola(t);
      },
      error: (e) => { this.enviando.set(false); this.avisarError(e); },
    });
  }

  async cancelarTarea(t: Tarea): Promise<void> {
    const r = await Swal.fire({
      title: '¿Parar a este agente?',
      text: `Se corta "${t.titulo || t.objetivo.slice(0, 60)}" a mitad de trabajo. Lo que ya escribió en la copia de trabajo se queda como está.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, parar',
      cancelButtonText: 'Seguir',
    });
    if (!r.isConfirmed) return;
    this.svc.cancelar(t.id).subscribe({
      next: () => this.refrescar(),
      error: (e) => this.avisarError(e),
    });
  }

  encargarleA(a: AgenteCatalogo): void {
    this.fAgente.set(a.clave);
    this.fEnjambre.set(false);
    this.pestana.set('nuevo');
  }

  alternarEnEnjambre(clave: string): void {
    const actuales = this.fAgentesEnjambre();
    this.fAgentesEnjambre.set(
      actuales.includes(clave) ? actuales.filter((x) => x !== clave) : [...actuales, clave],
    );
  }

  estaEnEnjambre(clave: string): boolean {
    return this.fAgentesEnjambre().includes(clave);
  }

  alternarPausaCuenta(c: Cuenta): void {
    this.svc.editarCuenta(c.id, { pausada: !c.pausada }).subscribe({
      next: () => this.refrescar(),
      error: (e) => this.avisarError(e),
    });
  }

  despertarCuenta(c: Cuenta): void {
    this.svc.despertarCuenta(c.id).subscribe({
      next: () => this.refrescar(),
      error: (e) => this.avisarError(e),
    });
  }

  comoIniciarSesion(c: Cuenta): void {
    Swal.fire({
      title: `Iniciar sesión en «${c.nombre}»`,
      html:
        '<p style="text-align:left;margin:0 0 8px">Es un flujo OAuth interactivo: hay que hacerlo desde el servidor, ' +
        'con la cuenta de su titular.</p>' +
        `<pre style="text-align:left;background:#0f172a;color:#e2e8f0;padding:10px;border-radius:8px;overflow:auto"># en el host\nagentes-cuenta login ${c.id}\nsudo systemctl restart tuapo-agentes</pre>` +
        '<p style="text-align:left;margin:8px 0 0;font-size:.85rem;color:#64748b">Una ranura = el asiento de una persona real que autoriza su uso desatendido.</p>',
      icon: 'info',
      width: 620,
    });
  }

  alternarVigilante(v: Vigilante): void {
    this.svc.editarVigilante(v.id, { activo: !v.activo }).subscribe({
      next: () => this.refrescar(),
      error: (e) => this.avisarError(e),
    });
  }

  dispararVigilante(v: Vigilante): void {
    this.svc.dispararVigilante(v.id).subscribe({
      next: (t) => { this.refrescar(); this.abrirConsola(t); },
      error: (e) => this.avisarError(e),
    });
  }

  private avisarError(e: unknown): void {
    const err = e as { status?: number; error?: unknown };
    let detalle = 'No se pudo completar la operación.';
    if (err?.status === 503) detalle = 'El servicio de agentes no responde en el host.';
    else if (err?.status === 403) detalle = 'Este modo es solo para administradores.';
    else if (typeof err?.error === 'string') detalle = err.error;
    else if (err?.error && typeof err.error === 'object' && 'error' in (err.error as object)) {
      detalle = String((err.error as { error: unknown }).error);
    }
    Swal.fire('No se pudo', detalle, 'error');
  }

  // ── Ayudas de plantilla ───────────────────────────────────────────────────

  estaViva(t: Tarea): boolean {
    return t.estado === 'pendiente' || t.estado === 'asignada' || t.estado === 'en_curso';
  }

  iconoEstado(estado: string): string {
    switch (estado) {
      case 'ok': return 'check_circle';
      case 'error': return 'error';
      case 'limite': return 'hourglass_disabled';
      case 'cancelada': return 'cancel';
      case 'interrumpida': return 'power_off';
      case 'en_curso': return 'bolt';
      case 'asignada': return 'play_circle';
      default: return 'schedule';
    }
  }

  etiquetaEstado(estado: string): string {
    switch (estado) {
      case 'ok': return 'Terminada';
      case 'error': return 'Falló';
      case 'limite': return 'Sin cupo';
      case 'cancelada': return 'Cancelada';
      case 'interrumpida': return 'Interrumpida';
      case 'en_curso': return 'Trabajando';
      case 'asignada': return 'Arrancando';
      default: return 'En cola';
    }
  }

  etiquetaCuenta(estado: string): string {
    switch (estado) {
      case 'lista': return 'Libre';
      case 'trabajando': return 'Trabajando';
      case 'enfriando': return 'Enfriando';
      case 'pausada': return 'En pausa';
      case 'sesion_caducada': return 'Sesión caducada';
      default: return 'Sin sesión';
    }
  }

  duracion(ms: number): string {
    if (!ms || ms < 0) return '—';
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min ${s % 60} s`;
    return `${Math.floor(m / 60)} h ${m % 60} min`;
  }

  faltan(ms: number | null): string {
    if (ms == null) return '—';
    const m = Math.round(ms / 60000);
    if (m <= 0) return 'ya toca';
    if (m < 60) return `en ${m} min`;
    return `en ${Math.floor(m / 60)} h ${m % 60} min`;
  }

  nombreCorto(ruta: string): string {
    const p = ruta.split('/');
    return p.slice(-2).join('/');
  }
}
