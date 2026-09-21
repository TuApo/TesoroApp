import { Injectable, computed, inject, signal } from '@angular/core';
import { Caso, EstadoAtencion, Oficina, Preferencia, TurnosService, Turno } from './turnos.service';
import { conectarSse, ConexionSse, tokenActual } from './sse.util';
import { getLocalStorageItem, setLocalStorageItem } from '../../../../../core/utils/safe-storage';

/**
 * Estado compartido del módulo: la oficina sobre la que se trabaja, el puesto abierto, el
 * turno en curso y los casos del asesor.
 *
 * <p>Existe porque el mismo estado lo pintan DOS sitios a la vez: el colapsador que cuelga de
 * la barra superior (visible desde cualquier pantalla) y la página completa del panel de
 * atención. Si cada uno lo cargara por su cuenta, llamar un turno desde el colapsador no se
 * vería en la página hasta recargar, y al revés.
 *
 * <p>El canal SSE "mios" mantiene esto al día cuando algo cambia desde otra pestaña u otro
 * equipo del mismo asesor. Se abre una sola vez, aquí, y lo comparten todos.
 */
@Injectable({ providedIn: 'root' })
export class ContextoTurnosService {
  private api = inject(TurnosService);

  private static readonly CLAVE_OFICINA = 'tuapo.turnos.oficina';

  readonly oficinas = signal<Oficina[]>([]);
  readonly oficinaId = signal<string | null>(this.leerOficinaGuardada());
  readonly esAdmin = signal(false);
  readonly cargado = signal(false);

  readonly preferencia = signal<Preferencia | null>(null);
  readonly atencion = signal<EstadoAtencion | null>(null);
  readonly casos = signal<Caso[]>([]);
  readonly maxCasos = signal(8);
  readonly estadoCanal = signal<'conectando' | 'conectado' | 'reconectando' | 'cerrado'>('cerrado');

  readonly oficina = computed<Oficina | null>(() => {
    const id = this.oficinaId();
    return this.oficinas().find(o => o.id === id) ?? null;
  });

  readonly puestoAbierto = computed(() => !!this.atencion()?.punto_id);
  readonly turnoActual = computed<Turno | null>(() => this.atencion()?.turno_actual ?? null);
  readonly siguiente = computed<Turno | null>(() => this.atencion()?.siguiente ?? null);
  readonly casoActivo = computed<Caso | null>(() => {
    const id = this.preferencia()?.caso_activo_id;
    return this.casos().find(c => c.id === id && c.estado === 'ABIERTO') ?? null;
  });
  readonly casosVivos = computed(() => this.casos().filter(c => c.estado !== 'CERRADO'));

  private canal: ConexionSse | null = null;

  /** Carga oficinas y el panel. Se puede repetir sin coste real. */
  cargar(forzar = false): void {
    if (this.cargado() && !forzar) return;
    this.api.oficinas().subscribe({
      next: lista => {
        this.oficinas.set(lista);
        const guardada = this.oficinaId();
        if (!lista.some(o => o.id === guardada)) {
          this.seleccionarOficina(lista.length ? lista[0].id : null);
        }
      },
      error: () => this.oficinas.set([]),
    });
    this.api.soyAdmin().subscribe({ next: r => this.esAdmin.set(!!r.admin), error: () => this.esAdmin.set(false) });
    this.recargarPanel();
    this.cargado.set(true);
  }

  recargarPanel(): void {
    this.api.panel().subscribe({
      next: p => {
        this.preferencia.set(p.preferencia);
        this.atencion.set(p.atencion);
        this.casos.set(p.casos);
        this.maxCasos.set(p.max_casos_abiertos);
        // La oficina del puesto abierto manda sobre la guardada: es donde está la persona.
        if (p.atencion?.oficina_id && p.atencion.oficina_id !== this.oficinaId()) {
          this.seleccionarOficina(p.atencion.oficina_id);
        } else if (!this.oficinaId() && p.preferencia?.oficina_id) {
          this.seleccionarOficina(p.preferencia.oficina_id);
        }
        this.abrirCanal();
      },
      error: () => { /* sin permisos o sin sesión: el panel no se pinta */ },
    });
  }

  seleccionarOficina(id: string | null): void {
    this.oficinaId.set(id);
    try { if (id) setLocalStorageItem(ContextoTurnosService.CLAVE_OFICINA, id); } catch { /* sin storage */ }
    if (id) this.api.guardarPreferencias({ oficina_id: id }).subscribe({ error: () => {} });
  }

  // ── Escrituras que refrescan el estado compartido ──

  aplicarAtencion(e: EstadoAtencion): void { this.atencion.set(e); }

  aplicarTurno(t: Turno): void {
    const a = this.atencion();
    if (!a) return;
    const abierto = t.estado === 'LLAMADO' || t.estado === 'EN_ATENCION';
    this.atencion.set({ ...a, turno_actual: abierto ? t : (a.turno_actual?.id === t.id ? null : a.turno_actual) });
  }

  aplicarCaso(c: Caso): void {
    this.casos.update(lista => {
      const i = lista.findIndex(x => x.id === c.id);
      const nueva = i >= 0 ? lista.map(x => (x.id === c.id ? c : x)) : [...lista, c];
      return nueva.filter(x => x.estado !== 'CERRADO');
    });
  }

  aplicarPreferencia(p: Preferencia): void { this.preferencia.set(p); }

  // ── Canal en vivo del asesor ──

  private abrirCanal(): void {
    if (this.canal) return;
    const token = tokenActual();
    if (!token) return;
    this.canal = conectarSse(this.api.urlEventosMios(), {
      token,
      onEstado: e => this.estadoCanal.set(e),
      onEvento: (nombre, datos) => {
        if (nombre.startsWith('turno-')) {
          this.aplicarTurno(datos as Turno);
          // El "siguiente" y los contadores cambian con cada llamado: se piden de nuevo.
          this.api.estadoAtencion().subscribe({ next: e => this.atencion.set(e), error: () => {} });
        } else if (nombre.startsWith('caso-')) {
          this.aplicarCaso(datos as Caso);
          if (nombre === 'caso-activado') {
            this.preferencia.update(p => (p ? { ...p, caso_activo_id: (datos as Caso).id } : p));
          }
        }
      },
    });
  }

  cerrarCanal(): void {
    this.canal?.cerrar();
    this.canal = null;
  }

  private leerOficinaGuardada(): string | null {
    try { return getLocalStorageItem(ContextoTurnosService.CLAVE_OFICINA) || null; } catch { return null; }
  }
}
