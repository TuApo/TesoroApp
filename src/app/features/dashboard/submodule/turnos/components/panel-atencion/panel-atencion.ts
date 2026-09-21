import {
  ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, input, signal, untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { Observable } from 'rxjs';

import { ContextoTurnosService, leerVista } from '../../service/contexto-turnos.service';
import { Caso, Punto, Servicio, Turno, TurnosService } from '../../service/turnos.service';
import { VistaCaso, VistaCasoService } from '../../service/vista-caso.service';
import { PermissionsService } from '../../../../../../core/services/permissions.service';
import { obtenerUsuarioActual } from '../../../../../../core/utils/usuario-actual';

/**
 * La pestaña de atención: cuelga de la barra superior en cualquier pantalla.
 *
 * <p>Plegada es una PESTAÑA PEQUEÑA con un semáforo (verde/amarillo/rojo según cómo va
 * la sala) y lo mínimo: el puesto, el turno en curso y cuántos casos hay. Al pulsarla se
 * abre todo.
 *
 * <p>Abierta tiene dos mitades. La IZQUIERDA es el control del turno: el puesto, a quién
 * se atiende, quién sigue, y los botones de llamar, iniciar, finalizar, transferir y
 * aplazar. La DERECHA son los CASOS como pestañas de navegador: cada persona que se está
 * atendiendo es una pestaña que guarda la pantalla donde se iba y lo que se llevaba escrito;
 * volver a ella restaura esa vista, y se puede abrir en otra pestaña del navegador con la
 * misma sesión. Los datos del caso se leen solos de la pantalla (cédula, nombre, trámite).
 *
 * <p>`modo="pagina"` es la misma cosa a pantalla completa (ruta /turnos/atencion).
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-panel-atencion',
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './panel-atencion.html',
  styleUrls: ['../../styles/turnos-comun.css', './panel-atencion.css'],
})
export class PanelAtencion implements OnInit {
  readonly modo = input<'colapsador' | 'pagina'>('colapsador');

  readonly ctx = inject(ContextoTurnosService);
  private api = inject(TurnosService);
  private vista = inject(VistaCasoService);
  private router = inject(Router);
  private permisos = inject(PermissionsService);

  readonly permitido = signal(false);
  readonly abierto = signal(false);
  readonly alto = signal(280);
  readonly ocupado = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  readonly puntos = signal<Punto[]>([]);
  readonly servicios = signal<Servicio[]>([]);
  readonly puntoElegido = signal<string>('');
  readonly transfiriendo = signal(false);
  readonly servicioDestino = signal<string>('');
  readonly cerrandoCon = signal<'ATENDIDO' | 'NO_SE_PRESENTO' | 'CANCELADO' | null>(null);
  readonly motivoCierre = signal('');

  readonly nuevoCasoAbierto = signal(false);
  nuevoCaso = { nombre: '', documento: '', persona_nombre: '', motivo: '' };
  readonly renombrando = signal<string | null>(null);
  nombreTemporal = '';
  readonly notaTexto = signal('');
  readonly cerrandoCaso = signal<string | null>(null);
  resultadoCaso = '';

  /** Pestaña de caso con el menú desplegado. */
  readonly menuCaso = signal<string | null>(null);

  readonly ahora = this.ctx.ahora;
  readonly cola = this.ctx.cola;
  readonly enEspera = computed<Turno[]>(() => this.cola()?.en_espera ?? []);
  readonly enCurso = computed<Turno[]>(() => this.cola()?.en_curso ?? []);
  readonly turno = this.ctx.turnoActual;
  readonly siguiente = this.ctx.siguiente;
  readonly atencion = this.ctx.atencion;
  readonly casos = this.ctx.casosVivos;
  readonly casoActivo = this.ctx.casoActivo;
  readonly semaforo = this.ctx.semaforo;

  readonly puedeAbrirMas = computed(() => this.casos().length < this.ctx.maxCasos());

  /** Los puntos agrupados por área del plano: "Contratación" → sus 4 puestos; manuales aparte. */
  readonly gruposDePuntos = computed(() => {
    const grupos = new Map<string, { nombre: string; puntos: Punto[] }>();
    for (const p of this.puntos()) {
      const clave = p.area_id ?? (p.origen === 'MANUAL' ? '_manual' : '_sin');
      const nombre = p.area_nombre ? `${p.area_nombre}${p.area_piso ? ' · ' + p.area_piso : ''}` : (p.origen === 'MANUAL' ? 'Otros puestos' : 'Sin área');
      if (!grupos.has(clave)) grupos.set(clave, { nombre, puntos: [] });
      grupos.get(clave)!.puntos.push(p);
    }
    return [...grupos.values()];
  });
  readonly puntoElegidoInfo = computed<Punto | null>(() => this.puntos().find(p => p.id === this.puntoElegido()) ?? null);
  /** Servicios que atiende mi puesto (vacío = todos): marca en la lista quién es "para mí". */
  readonly misServicios = computed<Set<string>>(() => new Set(this.puntoActualInfo()?.servicios ?? []));
  readonly puedoLlamar = computed(() => this.ctx.puestoAbierto() && !this.turno() && !this.ocupado());
  readonly puntoActualInfo = computed<Punto | null>(() => this.puntos().find(p => p.id === this.atencion()?.punto_id) ?? null);
  miId(): string { return obtenerUsuarioActual().id; }
  readonly enVistaDeTrabajo = computed(() => { this.ahora(); return this.vista.esVistaDeTrabajo(this.router.url); });

  /** Texto corto de la pestaña plegada. */
  readonly resumen = computed(() => {
    const a = this.atencion();
    const t = this.turno();
    if (!a?.punto_id) return a?.en_espera ? `Sin puesto · ${a.en_espera} esperando` : 'Sin puesto abierto';
    if (t) return `${a.punto_nombre} · ${t.codigo} ${etiquetaEstado(t.estado).toLowerCase()}`;
    return `${a.punto_nombre} · ${a.en_espera} en espera`;
  });

  readonly tituloSemaforo = computed(() => ({
    verde: 'Todo al día: nadie esperando',
    amarillo: 'Hay personas esperando o un turno llamado',
    rojo: 'La sala se desborda: muchos esperando o alguien lleva demasiado',
    neutro: 'Sin puesto abierto',
  } as Record<string, string>)[this.semaforo()]);

  private guardadoPref: ReturnType<typeof setTimeout> | null = null;
  private arrastre: { y0: number; alto0: number } | null = null;

  constructor() {
    effect(() => {
      const p = this.ctx.preferencia();
      if (!p) return;
      untracked(() => {
        this.abierto.set(!!p.panel_abierto);
        this.alto.set(Math.max(180, Math.min(720, p.panel_alto || 280)));
      });
    });
    effect(() => {
      const oficinaId = this.ctx.oficinaId();
      if (!oficinaId) { this.puntos.set([]); this.servicios.set([]); return; }
      untracked(() => this.cargarCatalogos(oficinaId));
    });
  }

  ngOnInit(): void {
    this.permitido.set(this.modo() === 'pagina' || this.permisos.canReadRoute('/dashboard/turnos/atencion'));
    if (this.permitido()) this.ctx.cargar();
  }

  // ── Pestaña ───────────────────────────────────────────────────────────

  alternar(): void {
    this.abierto.update(v => !v);
    this.guardarPref({ panel_abierto: this.abierto() });
  }

  iniciarArrastre(e: PointerEvent): void {
    this.arrastre = { y0: e.clientY, alto0: this.alto() };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  moverArrastre(e: PointerEvent): void {
    if (!this.arrastre) return;
    this.alto.set(Math.max(180, Math.min(720, this.arrastre.alto0 + (e.clientY - this.arrastre.y0))));
  }
  terminarArrastre(): void {
    if (!this.arrastre) return;
    this.arrastre = null;
    this.guardarPref({ panel_alto: this.alto() });
  }

  private guardarPref(cambio: Record<string, unknown>): void {
    if (this.guardadoPref) clearTimeout(this.guardadoPref);
    this.guardadoPref = setTimeout(() => {
      this.api.guardarPreferencias(cambio).subscribe({ next: p => this.ctx.aplicarPreferencia(p), error: () => {} });
    }, 400);
  }

  // ── Puesto ────────────────────────────────────────────────────────────

  private cargarCatalogos(oficinaId: string): void {
    this.api.puntos(oficinaId).subscribe({
      next: lista => {
        this.puntos.set(lista.filter(p => p.activo));
        const pref = this.ctx.preferencia()?.punto_id;
        if (pref && lista.some(p => p.id === pref)) this.puntoElegido.set(pref);
        else if (!this.puntoElegido() && lista.length) this.puntoElegido.set(lista[0].id);
      },
      error: () => this.puntos.set([]),
    });
    this.api.servicios(oficinaId).subscribe({ next: s => this.servicios.set(s.filter(x => x.activo)), error: () => this.servicios.set([]) });
  }

  abrirPuesto(): void {
    const punto = this.puntoElegido();
    if (!punto) return;
    this.correr(this.api.abrirPuesto(punto), e => {
      this.ctx.aplicarAtencion(e);
      this.guardarPref({ punto_id: punto, oficina_id: this.ctx.oficinaId() });
      this.aviso.set(`Puesto ${e.punto_nombre} abierto`);
    });
  }

  cerrarPuesto(): void {
    this.correr(this.api.cerrarPuesto(), e => { this.ctx.aplicarAtencion(e); this.aviso.set('Puesto cerrado'); });
  }

  // ── Turno ─────────────────────────────────────────────────────────────

  llamar(turnoId?: string): void {
    const a = this.atencion();
    if (!a?.punto_id) return;
    this.correr(this.api.llamar(a.punto_id, turnoId ?? null), t => {
      this.ctx.aplicarTurno(t);
      this.ctx.refrescarEstado();
      this.sonar();
    });
  }

  rellamar(): void { const t = this.turno(); if (t) this.llamar(t.id); }

  iniciar(): void {
    const t = this.turno();
    if (!t) return;
    this.correr(this.api.iniciar(t.id), r => { this.ctx.aplicarTurno(r); this.ctx.refrescarEstado(); });
  }

  pedirCierre(resultado: 'ATENDIDO' | 'NO_SE_PRESENTO' | 'CANCELADO'): void {
    if (resultado === 'ATENDIDO') { this.cerrar(resultado); return; }
    this.cerrandoCon.set(resultado);
    this.motivoCierre.set('');
  }

  cerrar(resultado: 'ATENDIDO' | 'NO_SE_PRESENTO' | 'CANCELADO'): void {
    const t = this.turno();
    if (!t) return;
    this.correr(this.api.cerrarTurno(t.id, resultado, this.motivoCierre() || null), r => {
      this.ctx.aplicarTurno(r);
      this.cerrandoCon.set(null);
      this.ctx.refrescarEstado();
      if (this.ctx.preferencia()?.auto_llamar && resultado === 'ATENDIDO') setTimeout(() => this.llamar(), 400);
    });
  }

  transferir(): void {
    const t = this.turno();
    const destino = this.servicioDestino();
    if (!t || !destino) return;
    this.correr(this.api.transferir(t.id, destino, null, true), () => {
      this.transfiriendo.set(false);
      this.servicioDestino.set('');
      this.ctx.refrescarEstado();
      this.aviso.set('Turno transferido; nace con prioridad en el otro servicio');
    });
  }

  aplazar(): void {
    const t = this.turno();
    if (!t) return;
    this.correr(this.api.aplazar(t.id, 'La persona pidió un momento'), () => this.ctx.refrescarEstado());
  }

  alternarAutoLlamar(): void {
    const v = !this.ctx.preferencia()?.auto_llamar;
    this.guardarPref({ auto_llamar: v });
    this.ctx.preferencia.update(p => (p ? { ...p, auto_llamar: v } : p));
  }

  // ── Casos (pestañas) ──────────────────────────────────────────────────

  /**
   * "+" : guarda la VISTA ACTUAL como un caso nuevo. Los datos se leen solos de la
   * pantalla (cédula, nombre, trámite); si no hay nada que leer, el caso se llama como
   * la pantalla. Si hay un turno en curso, el caso nace de él.
   */
  guardarVistaComoCaso(): void {
    const t = this.turno();
    const datos = this.vista.datosDeLaVista();
    const foto = this.vista.esVistaDeTrabajo() ? this.vista.capturar() : null;
    const cuerpo = {
      turno_id: t?.id ?? null, oficina_id: this.ctx.oficinaId(),
      documento: datos.documento, persona_nombre: datos.persona_nombre, telefono: datos.telefono, correo: datos.correo,
      motivo: datos.motivo, activar: true,
    };
    this.correr(this.api.abrirCaso(cuerpo), c => {
      this.ctx.aplicarCaso(c);
      this.ctx.preferencia.update(p => (p ? { ...p, caso_activo_id: c.id } : p));
      this.pausarOtros(c.id);
      if (foto) {
        this.api.actualizarCaso(c.id, { contexto_json: JSON.stringify(foto) }).subscribe({ next: r => this.ctx.aplicarCaso(r), error: () => {} });
      }
      this.aviso.set(foto ? `Caso guardado con la pantalla "${foto.titulo ?? ''}"` : 'Caso abierto');
    });
  }

  abrirCasoDelTurno(): void { this.guardarVistaComoCaso(); }

  crearCasoManual(): void {
    const f = this.nuevoCaso;
    if (!f.nombre.trim() && !f.documento.trim() && !f.persona_nombre.trim()) return;
    this.correr(this.api.abrirCaso({
      oficina_id: this.ctx.oficinaId(), nombre: f.nombre.trim() || null,
      documento: f.documento.trim() || null, persona_nombre: f.persona_nombre.trim() || null,
      motivo: f.motivo.trim() || null, activar: true,
    }), c => {
      this.ctx.aplicarCaso(c);
      this.ctx.preferencia.update(p => (p ? { ...p, caso_activo_id: c.id } : p));
      this.pausarOtros(c.id);
      this.nuevoCaso = { nombre: '', documento: '', persona_nombre: '', motivo: '' };
      this.nuevoCasoAbierto.set(false);
    });
  }

  /** Clic en una pestaña: activa el caso y vuelve a la pantalla donde se iba, con sus datos. */
  irACaso(c: Caso): void {
    this.menuCaso.set(null);
    if (this.casoActivo()?.id === c.id) { this.volverAlCaso(c); return; }
    // Antes de soltar el caso actual se le guarda su foto: es lo que se va a restaurar después.
    this.ctx.guardarVistaDelCasoActivo();
    this.correr(this.api.activarCaso(c.id), r => {
      this.ctx.aplicarCaso(r);
      this.ctx.preferencia.update(p => (p ? { ...p, caso_activo_id: r.id } : p));
      this.pausarOtros(r.id);
      this.volverAlCaso(r);
    });
  }

  volverAlCaso(c: Caso): void {
    const v = leerVista(c.contexto_json);
    if (!v.ruta) return;
    this.ctx.restaurando.set(true);
    this.vista.restaurar(v).finally(() => setTimeout(() => this.ctx.restaurando.set(false), 600));
  }

  abrirEnPestanaNueva(c: Caso): void {
    this.ctx.guardarVistaDelCasoActivo();
    window.open(this.vista.enlaceDeCaso(c.id), '_blank', 'noopener');
  }

  copiarEnlace(c: Caso): void {
    navigator.clipboard?.writeText(this.vista.enlaceDeCaso(c.id)).then(() => { this.aviso.set('Enlace del caso copiado'); setTimeout(() => this.aviso.set(null), 2000); });
  }

  pausarCaso(c: Caso): void {
    if (this.casoActivo()?.id === c.id) this.ctx.guardarVistaDelCasoActivo();
    this.correr(this.api.pausarCaso(c.id), r => this.ctx.aplicarCaso(r));
  }

  fijarCaso(c: Caso): void {
    this.correr(this.api.actualizarCaso(c.id, { fijado: !c.fijado }), r => this.ctx.aplicarCaso(r));
  }

  empezarRenombrar(c: Caso): void { this.renombrando.set(c.id); this.nombreTemporal = c.nombre; }

  guardarNombre(c: Caso): void {
    const nombre = this.nombreTemporal.trim();
    this.renombrando.set(null);
    if (!nombre || nombre === c.nombre) return;
    this.correr(this.api.actualizarCaso(c.id, { nombre }), r => this.ctx.aplicarCaso(r));
  }

  nombreAutomatico(c: Caso): void {
    this.correr(this.api.actualizarCaso(c.id, { nombre_automatico: true }), r => this.ctx.aplicarCaso(r));
  }

  /** Vuelve a leer la pantalla actual y completa los datos vacíos del caso. */
  releerDatos(c: Caso): void {
    const d = this.vista.datosDeLaVista();
    const cambio: Record<string, string | null> = {};
    if (!c.documento && d.documento) cambio['documento'] = d.documento;
    if (!c.persona_nombre && d.persona_nombre) cambio['persona_nombre'] = d.persona_nombre;
    if (!c.telefono && d.telefono) cambio['telefono'] = d.telefono;
    if (!c.correo && d.correo) cambio['correo'] = d.correo;
    if (!c.motivo && d.motivo) cambio['motivo'] = d.motivo;
    if (!Object.keys(cambio).length) { this.aviso.set('No encontré datos nuevos en esta pantalla'); setTimeout(() => this.aviso.set(null), 2500); return; }
    this.correr(this.api.actualizarCaso(c.id, cambio), r => { this.ctx.aplicarCaso(r); this.ctx.guardarVistaDelCasoActivo(); });
  }

  pedirCerrarCaso(c: Caso): void { this.cerrandoCaso.set(c.id); this.resultadoCaso = ''; }

  cerrarCasoPorId(id: string): void {
    const c = this.casos().find(x => x.id === id);
    if (c) this.cerrarCaso(c);
  }

  cerrarCaso(c: Caso): void {
    this.correr(this.api.cerrarCaso(c.id, this.resultadoCaso || null), () => {
      this.ctx.casos.update(l => l.filter(x => x.id !== c.id));
      this.cerrandoCaso.set(null);
      if (this.ctx.preferencia()?.caso_activo_id === c.id) {
        this.ctx.preferencia.update(p => (p ? { ...p, caso_activo_id: null } : p));
      }
    });
  }

  agregarNota(): void {
    const c = this.casoActivo();
    const texto = this.notaTexto().trim();
    if (!c || !texto) return;
    this.correr(this.api.agregarNota(c.id, texto), () => {
      this.notaTexto.set('');
      this.ctx.aplicarCaso({ ...c, notas: (c.notas ?? 0) + 1 });
      this.aviso.set('Nota guardada');
    });
  }

  private pausarOtros(activoId: string): void {
    this.ctx.casos.update(l => l.map(x => (x.id !== activoId && x.estado === 'ABIERTO' ? { ...x, estado: 'PAUSADO' as const, activado_en: null } : x)));
  }

  // ── Presentación ──────────────────────────────────────────────────────

  estado(t: Turno): string { return etiquetaEstado(t.estado); }
  vistaDe(c: Caso): VistaCaso { return leerVista(c.contexto_json); }
  tienePantalla(c: Caso): boolean { return !!leerVista(c.contexto_json).ruta; }
  camposGuardados(c: Caso): number { return Object.keys(leerVista(c.contexto_json).campos ?? {}).length; }

  tiempoCaso(c: Caso): string {
    let seg = c.segundos_activo ?? 0;
    if (c.estado === 'ABIERTO' && c.activado_en) {
      const desde = new Date(c.actualizado_en ?? c.activado_en).getTime();
      seg += Math.max(0, Math.floor((this.ahora() - desde) / 1000));
    }
    return formatearDuracion(seg);
  }

  tiempoTurno(t: Turno): string {
    const inicio = t.estado === 'EN_ATENCION' ? t.iniciado_en : (t.llamado_en ?? t.creado_en);
    if (!inicio) return '';
    return formatearDuracion(Math.max(0, Math.floor((this.ahora() - new Date(inicio).getTime()) / 1000)));
  }

  esperaMaxima(): string {
    const s = this.atencion()?.espera_max_seg;
    return s ? formatearDuracion(s) : '';
  }

  colorCaso(c: Caso): string { return c.color || '#2B59F0'; }

  // ── Lista de personas por atender ─────────────────────────────────────

  minutosEspera(t: Turno): number { return Math.max(0, Math.floor((this.ahora() - new Date(t.creado_en).getTime()) / 60000)); }
  esperaTexto(t: Turno): string {
    const m = this.minutosEspera(t);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60}`;
  }
  /** Verde hasta 5 min, ámbar hasta 15, rojo después. */
  nivelEspera(t: Turno): 'ok' | 'warn' | 'danger' {
    const m = this.minutosEspera(t);
    return m >= 15 ? 'danger' : m >= 5 ? 'warn' : 'ok';
  }
  paraMi(t: Turno): boolean { const s = this.misServicios(); return s.size === 0 || s.has(t.servicio_id); }
  iconoCanal(canal: string): string {
    return ({ QR: 'qr_code_2', KIOSCO: 'touch_app', RECEPCION: 'support_agent', WEB: 'language', AGENDADO: 'event' } as Record<string, string>)[canal] ?? 'confirmation_number';
  }
  llamarEste(t: Turno): void { if (this.puedoLlamar()) this.llamar(t.id); }

  // ── Menú de una pestaña de caso ───────────────────────────────────────

  alternarMenuCaso(c: Caso, e: Event): void {
    e.stopPropagation();
    this.menuCaso.set(this.menuCaso() === c.id ? null : c.id);
  }
  cerrarMenuCaso(): void { this.menuCaso.set(null); }
  casoDelMenu(): Caso | null { const id = this.menuCaso(); return this.casos().find(c => c.id === id) ?? null; }

  /** El "+" de la fila de pestañas: guarda la pantalla actual, o abre el caso a mano si no hay pantalla de trabajo. */
  nuevoCasoDesdeMas(): void {
    if (!this.puedeAbrirMas()) return;
    if (this.enVistaDeTrabajo() || this.turno()) this.guardarVistaComoCaso();
    else this.nuevoCasoAbierto.set(true);
  }

  private correr<T>(obs: Observable<T>, ok: (v: T) => void): void {
    this.ocupado.set(true);
    this.error.set(null);
    obs.subscribe({
      next: v => { this.ocupado.set(false); ok(v); setTimeout(() => this.aviso.set(null), 2500); },
      error: e => {
        this.ocupado.set(false);
        const msg = (e as { error?: { message?: string; error?: string } })?.error;
        this.error.set(msg?.message || msg?.error || 'No se pudo completar la acción');
        setTimeout(() => this.error.set(null), 4000);
      },
    });
  }

  private sonar(): void {
    if (!this.ctx.preferencia()?.sonido) return;
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.08;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.18);
    } catch { /* sin audio */ }
  }
}

export function etiquetaEstado(e: string): string {
  return ({
    EN_ESPERA: 'En espera', LLAMADO: 'Llamado', EN_ATENCION: 'En atención', ATENDIDO: 'Atendido',
    NO_SE_PRESENTO: 'No se presentó', CANCELADO: 'Cancelado', TRANSFERIDO: 'Transferido', APLAZADO: 'Aplazado',
  } as Record<string, string>)[e] ?? e;
}

export function formatearDuracion(seg: number): string {
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const s = seg % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Compatibilidad con quien importaba el lector del contexto desde aquí. */
export const leerContexto = leerVista;
