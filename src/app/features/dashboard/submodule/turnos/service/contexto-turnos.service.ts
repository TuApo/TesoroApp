import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { Caso, CasoPatch, Cola, EstadoAtencion, Oficina, Preferencia, TurnosService, Turno } from './turnos.service';
import { conectarSse, ConexionSse, tokenActual } from './sse.util';
import { VistaCaso, VistaCasoService, mismaPantalla } from './vista-caso.service';
import { RegistroVistaCaso } from '../../../../../core/services/vista-caso.registro';
import { getLocalStorageItem, setLocalStorageItem } from '../../../../../core/utils/safe-storage';

export type Semaforo = 'neutro' | 'verde' | 'amarillo' | 'rojo';

/** Umbrales del semáforo de la pestaña. */
const AMARILLO_DESDE_EN_ESPERA = 1;
const ROJO_DESDE_EN_ESPERA = 6;
const ROJO_ESPERA_MAX_SEG = 15 * 60;
const ROJO_LLAMADO_SIN_LLEGAR_SEG = 90;

/**
 * Estado compartido del módulo: la oficina sobre la que se trabaja, el puesto abierto, el
 * turno en curso, los casos del asesor y el semáforo de la pestaña.
 *
 * <p>Existe porque el mismo estado lo pintan DOS sitios a la vez: la pestaña que cuelga de
 * la barra superior (visible desde cualquier pantalla) y la página completa del panel de
 * atención. Si cada uno lo cargara por su cuenta, llamar un turno desde uno no se vería en
 * el otro hasta recargar.
 *
 * <p>Dos canales SSE lo mantienen al día: "mios" (mi turno, mis casos, aunque cambien desde
 * otra pestaña u otro equipo) y el de la oficina (cuánta gente espera: es lo que mueve el
 * semáforo aunque no haya puesto abierto).
 *
 * <p>También lleva el AUTOGUARDADO de la vista del caso activo: cada vez que la persona
 * escribe algo en la pantalla o cambia de pantalla, el caso recuerda dónde iba y con qué
 * datos, para poder volver a él (o abrirlo en otra pestaña) y seguir.
 */
@Injectable({ providedIn: 'root' })
export class ContextoTurnosService {
  private api = inject(TurnosService);
  private vista = inject(VistaCasoService);
  private registro = inject(RegistroVistaCaso);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  private static readonly CLAVE_OFICINA = 'tuapo.turnos.oficina';

  readonly oficinas = signal<Oficina[]>([]);
  readonly oficinaId = signal<string | null>(this.leerOficinaGuardada());
  readonly esAdmin = signal(false);
  readonly cargado = signal(false);

  readonly preferencia = signal<Preferencia | null>(null);
  readonly atencion = signal<EstadoAtencion | null>(null);
  /** La cola de la oficina elegida (en espera y en atención), en vivo por SSE. */
  readonly cola = signal<Cola | null>(null);
  readonly casos = signal<Caso[]>([]);
  readonly maxCasos = signal(8);
  readonly estadoCanal = signal<'conectando' | 'conectado' | 'reconectando' | 'cerrado'>('cerrado');
  /** Reloj compartido (cada 5 s): los tiempos que corren y el semáforo dependen de él. */
  readonly ahora = signal(Date.now());
  /** true mientras se restaura la vista de un caso: el autoguardado se calla. */
  readonly restaurando = signal(false);
  /** Último turno que entró para MI área estando en turno (evento turno-area): el panel lo anuncia. */
  readonly avisoArea = signal<Turno | null>(null);
  /** Último turno que nadie podía atender y quedó a mi cargo (soy el jefe de la oficina): evento turno-escalado. */
  readonly avisoEscalado = signal<Turno | null>(null);

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

  /**
   * El semáforo de la pestaña:
   *   verde    puesto abierto y nadie esperando (o atendiendo con normalidad);
   *   amarillo hay gente esperando, o alguien llamado que aún no llega;
   *   rojo     la sala se desborda: muchos esperando, alguien lleva demasiado, o un
   *            llamado que no llega hace rato;
   *   neutro   sin puesto abierto y sin nadie esperando en su oficina.
   */
  readonly semaforo = computed<Semaforo>(() => {
    const a = this.atencion();
    const ahora = this.ahora();
    if (!a) return 'neutro';
    const enEspera = a.en_espera ?? 0;
    const t = a.turno_actual;
    if (t?.estado === 'LLAMADO' && t.llamado_en && (ahora - new Date(t.llamado_en).getTime()) / 1000 > ROJO_LLAMADO_SIN_LLEGAR_SEG) return 'rojo';
    if (enEspera >= ROJO_DESDE_EN_ESPERA || (a.espera_max_seg ?? 0) >= ROJO_ESPERA_MAX_SEG) return 'rojo';
    if (enEspera >= AMARILLO_DESDE_EN_ESPERA || t?.estado === 'LLAMADO') return 'amarillo';
    return a.punto_id ? 'verde' : 'neutro';
  });

  private canalMio: ConexionSse | null = null;
  private canalOficina: ConexionSse | null = null;
  private oficinaDelCanal: string | null = null;
  private refrescoEstado: ReturnType<typeof setTimeout> | null = null;
  private refrescoCola: ReturnType<typeof setTimeout> | null = null;
  private autoguardado: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const reloj = setInterval(() => this.ahora.set(Date.now()), 5000);
    // Sin puesto no llegan eventos "míos": cada minuto se repregunta el estado.
    const sondeo = setInterval(() => { if (this.cargado()) { this.refrescarEstado(); this.recargarCola(); } }, 60_000);
    this.destroyRef.onDestroy(() => { clearInterval(reloj); clearInterval(sondeo); this.cerrarCanales(); });

    // El canal de la oficina sigue a la oficina elegida.
    effect(() => {
      const id = this.oficinaId();
      if (!this.cargado()) return;
      untracked(() => this.abrirCanalOficina(id));
    });

    // Cambiar de pantalla con un caso activo: el caso recuerda la nueva ruta. Los campos
    // guardados solo se conservan si sigue siendo la misma pantalla.
    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd), takeUntilDestroyed())
      .subscribe(e => this.alNavegar(e.urlAfterRedirects));

    // La pantalla avisa de cambios que no pasan por un campo (otra persona, otro paso).
    effect(() => {
      this.registro.cambios();
      untracked(() => this.programarAutoguardado());
    });

    // Escribir en cualquier campo de la pantalla: foto de la vista (con espera corta).
    if (typeof document !== 'undefined') {
      const escuchar = (ev: Event) => {
        const el = ev.target as HTMLElement | null;
        if (!el || !el.closest?.('.dashboard-page-wrapper') || el.closest('app-panel-atencion')) return;
        this.programarAutoguardado();
      };
      document.addEventListener('input', escuchar, true);
      document.addEventListener('change', escuchar, true);
      this.destroyRef.onDestroy(() => {
        document.removeEventListener('input', escuchar, true);
        document.removeEventListener('change', escuchar, true);
      });
    }
  }

  /** Carga oficinas y el panel. Se puede repetir sin coste real. */
  cargar(forzar = false): void {
    if (this.cargado() && !forzar) return;
    this.cargado.set(true);
    this.api.oficinas().subscribe({
      next: lista => {
        this.oficinas.set(lista);
        const guardada = this.oficinaId();
        if (!lista.some(o => o.id === guardada)) {
          this.seleccionarOficina(lista.length ? lista[0].id : null);
        } else {
          this.abrirCanalOficina(guardada);
        }
      },
      error: () => this.oficinas.set([]),
    });
    this.api.soyAdmin().subscribe({ next: r => this.esAdmin.set(!!r.admin), error: () => this.esAdmin.set(false) });
    this.recargarPanel();
  }

  recargarPanel(): void {
    this.api.panel().subscribe({
      next: p => {
        this.preferencia.set(p.preferencia);
        this.atencion.set(p.atencion);
        this.casos.set(p.casos);
        this.maxCasos.set(p.max_casos_abiertos);
        // La oficina del puesto abierto manda sobre la guardada: es donde está la persona.
        if (p.atencion?.punto_id && p.atencion.oficina_id && p.atencion.oficina_id !== this.oficinaId()) {
          this.seleccionarOficina(p.atencion.oficina_id);
        } else if (!this.oficinaId() && p.preferencia?.oficina_id) {
          this.seleccionarOficina(p.preferencia.oficina_id);
        }
        this.abrirCanalMio();
        this.recargarCola();
      },
      error: () => { /* sin permisos o sin sesión: el panel no se pinta */ },
    });
  }

  refrescarEstado(): void {
    this.api.estadoAtencion().subscribe({ next: e => this.atencion.set(e), error: () => {} });
  }

  /** La cola completa de la oficina: es lo que pinta la lista de personas por atender. */
  recargarCola(): void {
    const id = this.oficinaId();
    if (!id) { this.cola.set(null); return; }
    this.api.cola(id).subscribe({ next: c => this.cola.set(c), error: () => {} });
  }

  seleccionarOficina(id: string | null): void {
    this.oficinaId.set(id);
    try { if (id) setLocalStorageItem(ContextoTurnosService.CLAVE_OFICINA, id); } catch { /* sin storage */ }
    if (id) {
      this.api.guardarPreferencias({ oficina_id: id }).subscribe({
        next: p => { this.preferencia.set(p); this.refrescarEstado(); },
        error: () => {},
      });
    }
    this.abrirCanalOficina(id);
    this.recargarCola();
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

  // ── Autoguardado de la vista del caso activo ──

  /**
   * Una pestaña es una FOTO FIJA de una pantalla: no sigue al usuario cuando navega a otra.
   * (Antes sí lo hacía, y volver a la pestaña "no hacía nada" porque ya apuntaba a la
   * pantalla actual.) Solo un caso sin pantalla adopta la primera de trabajo a la que se llega.
   */
  private alNavegar(url: string): void {
    const caso = this.casoActivo();
    if (!caso || this.restaurando() || !this.vista.esVistaDeTrabajo(url)) return;
    const guardada = leerVista(caso.contexto_json);
    if (guardada.ruta) return;
    const nueva: VistaCaso = { ...this.vista.capturar(), campos: undefined, scroll: undefined };
    this.guardarVista(caso, nueva);
  }

  private programarAutoguardado(): void {
    if (this.restaurando() || !this.casoActivo()) return;
    if (this.autoguardado) clearTimeout(this.autoguardado);
    this.autoguardado = setTimeout(() => this.guardarVistaDelCasoActivo(), 1500);
  }

  /**
   * Foto completa de la pantalla actual en el caso activo, SOLO si se está en la pantalla
   * del caso (o el caso aún no tiene ninguna). Escribir en otra pantalla no la pisa.
   */
  guardarVistaDelCasoActivo(): void {
    const caso = this.casoActivo();
    if (!caso || this.restaurando() || !this.vista.esVistaDeTrabajo()) return;
    const guardada = leerVista(caso.contexto_json);
    if (guardada.ruta && !mismaPantalla(guardada.ruta, this.router.url)) return;
    this.guardarVista(caso, this.vista.capturar());
  }

  private guardarVista(caso: Caso, v: VistaCaso): void {
    const json = JSON.stringify(v);
    const cambio: CasoPatch = {};
    if (json !== caso.contexto_json) cambio.contexto_json = json;
    // La persona y el paso que la pantalla dice tener al frente mandan sobre los datos del
    // caso: si en la pestaña se cambió de persona o de paso, el nombre automático la sigue.
    const p = v.persona;
    if (p) {
      if (p.documento && p.documento !== caso.documento) cambio.documento = p.documento;
      if (p.persona_nombre && p.persona_nombre !== caso.persona_nombre) cambio.persona_nombre = p.persona_nombre;
      if (p.telefono && p.telefono !== caso.telefono) cambio.telefono = p.telefono;
      if (p.correo && p.correo !== caso.correo) cambio.correo = p.correo;
      if (p.motivo && p.motivo !== caso.motivo) cambio.motivo = p.motivo;
    }
    if (!Object.keys(cambio).length) return;
    // Se refleja de inmediato en memoria (la pestaña muestra "Estaba en…") y se persiste.
    this.aplicarCaso({ ...caso, ...cambio, contexto_json: cambio.contexto_json ?? caso.contexto_json } as Caso);
    this.api.actualizarCaso(caso.id, cambio).subscribe({ next: c => this.aplicarCaso(c), error: () => {} });
  }

  // ── Canales en vivo ──

  private abrirCanalMio(): void {
    if (this.canalMio) return;
    const token = tokenActual();
    if (!token) return;
    this.canalMio = conectarSse(this.api.urlEventosMios(), {
      token,
      onEstado: e => this.estadoCanal.set(e),
      onEvento: (nombre, datos) => {
        if (nombre === 'turno-escalado') {
          // Nadie podía atenderlo y quedó a mi cargo: se anuncia aparte del turno-creado que también llega.
          this.avisoEscalado.set(datos as Turno);
          this.sonarAviso();
          this.programarRefresco();
          return;
        }
        if (nombre === 'turno-area') {
          // Entró un turno para el área en la que estoy en turno: se anuncia y se refresca la lista.
          this.avisoArea.set(datos as Turno);
          this.sonarAviso();
          this.programarRefresco();
          return;
        }
        if (nombre.startsWith('turno-')) {
          this.aplicarTurno(datos as Turno);
          this.programarRefresco();
        } else if (nombre.startsWith('caso-')) {
          this.aplicarCaso(datos as Caso);
          if (nombre === 'caso-activado') {
            this.preferencia.update(p => (p ? { ...p, caso_activo_id: (datos as Caso).id } : p));
          }
        }
      },
    });
  }

  private abrirCanalOficina(oficinaId: string | null): void {
    if (this.oficinaDelCanal === oficinaId && this.canalOficina) return;
    this.canalOficina?.cerrar();
    this.canalOficina = null;
    this.oficinaDelCanal = oficinaId;
    if (!oficinaId) return;
    const token = tokenActual();
    if (!token) return;
    this.canalOficina = conectarSse(this.api.urlEventosOficina(oficinaId), {
      token,
      onEvento: nombre => { if (nombre.startsWith('turno-') || nombre.startsWith('puesto-') || nombre.startsWith('jornada-')) this.programarRefresco(); },
    });
  }

  /** Varios eventos seguidos (un llamado dispara dos) se agrupan en una sola consulta. */
  private programarRefresco(): void {
    if (this.refrescoEstado) clearTimeout(this.refrescoEstado);
    this.refrescoEstado = setTimeout(() => this.refrescarEstado(), 300);
    if (this.refrescoCola) clearTimeout(this.refrescoCola);
    this.refrescoCola = setTimeout(() => this.recargarCola(), 350);
  }

  /** Dos notas cortas cuando llega un turno de mi área (si la persona no apagó el sonido). */
  private sonarAviso(): void {
    if (this.preferencia()?.sonido === false || typeof window === 'undefined') return;
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      [[660, 0], [880, 0.18]].forEach(([f, t]) => {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.frequency.value = f; g.gain.value = 0.12; o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.16);
      });
    } catch { /* sin audio */ }
  }

  cerrarCanales(): void {
    this.canalMio?.cerrar(); this.canalMio = null;
    this.canalOficina?.cerrar(); this.canalOficina = null;
  }

  private leerOficinaGuardada(): string | null {
    try { return getLocalStorageItem(ContextoTurnosService.CLAVE_OFICINA) || null; } catch { return null; }
  }
}

export function leerVista(json: string | null | undefined): VistaCaso {
  if (!json) return {};
  try { const v = JSON.parse(json); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
