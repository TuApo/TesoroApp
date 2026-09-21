import {
  ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, input, signal, untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, filter } from 'rxjs';

import { ContextoTurnosService } from '../../service/contexto-turnos.service';
import { Caso, Punto, Servicio, Turno, TurnosService } from '../../service/turnos.service';
import { PermissionsService } from '../../../../../../core/services/permissions.service';

/**
 * El panel plegable de atención: vive entre la barra superior y la pantalla.
 *
 * <p>Dos mitades. La IZQUIERDA es el control del turno: el puesto abierto, a quién se está
 * atendiendo, quién sigue, y los botones de llamar, iniciar, finalizar, transferir y
 * aplazar. La DERECHA son los CASOS: cada persona que se está atendiendo es una pestaña
 * con nombre (automático o puesto a mano), con su reloj y sus notas, para poder saltar
 * entre varias sin perder dónde se iba.
 *
 * <p>Vive en el shell y no en una página porque el turno sigue abierto mientras la persona
 * navega por contratación, tesorería o documentos. Se pinta solo si el usuario puede leer
 * el panel de atención (árbol de permisos); el resto de la plataforma no ve nada.
 *
 * <p>`modo="pagina"` es la misma cosa a pantalla completa (la ruta /turnos/atencion), sin
 * el colapsador y sin límite de alto.
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
  private router = inject(Router);
  private permisos = inject(PermissionsService);
  private destroyRef = inject(DestroyRef);

  /** Solo se pinta para quien puede entrar al panel de atención. */
  readonly permitido = signal(false);
  readonly abierto = signal(false);
  readonly alto = signal(260);
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

  /** Formulario de caso nuevo (a mano). */
  readonly nuevoCasoAbierto = signal(false);
  nuevoCaso = { nombre: '', documento: '', persona_nombre: '', motivo: '' };
  readonly renombrando = signal<string | null>(null);
  nombreTemporal = '';
  readonly notaTexto = signal('');
  readonly cerrandoCaso = signal<string | null>(null);
  resultadoCaso = '';

  /** Reloj de un segundo para pintar los tiempos que corren. */
  readonly ahora = signal(Date.now());

  readonly turno = this.ctx.turnoActual;
  readonly siguiente = this.ctx.siguiente;
  readonly atencion = this.ctx.atencion;
  readonly casos = this.ctx.casosVivos;
  readonly casoActivo = this.ctx.casoActivo;

  readonly puedeAbrirMas = computed(() => this.casos().length < this.ctx.maxCasos());

  readonly resumenColapsado = computed(() => {
    const a = this.atencion();
    const t = this.turno();
    if (!a?.punto_id) return 'Sin puesto abierto';
    const partes = [a.punto_nombre ?? 'Puesto'];
    if (t) partes.push(`${t.codigo} · ${etiquetaEstado(t.estado)}`);
    else partes.push(`${a.en_espera} en espera`);
    return partes.join(' · ');
  });

  private guardadoPref: ReturnType<typeof setTimeout> | null = null;
  private arrastre: { y0: number; alto0: number } | null = null;

  constructor() {
    // Las preferencias del servidor mandan al montar: abierto y alto.
    effect(() => {
      const p = this.ctx.preferencia();
      if (!p) return;
      untracked(() => {
        this.abierto.set(!!p.panel_abierto);
        this.alto.set(Math.max(160, Math.min(720, p.panel_alto || 260)));
      });
    });
    // Al abrir un puesto o cambiar de oficina, se cargan puntos y servicios de esa oficina.
    effect(() => {
      const oficinaId = this.ctx.oficinaId();
      if (!oficinaId) { this.puntos.set([]); this.servicios.set([]); return; }
      untracked(() => this.cargarCatalogos(oficinaId));
    });
    // Recordar por dónde iba la persona para cada caso activo: al cambiar de ruta se
    // anota en el caso, y "volver" lo lleva justo ahí. Es lo que hace que saltar entre
    // casos no sea "¿en qué pantalla estaba con esta señora?".
    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd), takeUntilDestroyed())
      .subscribe(e => {
        const caso = this.casoActivo();
        if (!caso || e.urlAfterRedirects.startsWith('/dashboard/turnos')) return;
        const ctx = leerContexto(caso.contexto_json);
        if (ctx.ruta === e.urlAfterRedirects) return;
        this.api.actualizarCaso(caso.id, { contexto_json: JSON.stringify({ ...ctx, ruta: e.urlAfterRedirects }) })
          .subscribe({ next: c => this.ctx.aplicarCaso(c), error: () => {} });
      });

    const reloj = setInterval(() => this.ahora.set(Date.now()), 1000);
    this.destroyRef.onDestroy(() => clearInterval(reloj));
  }

  ngOnInit(): void {
    // ADMIN ve todo aunque el módulo no esté sembrado; el resto por el árbol de permisos.
    this.permitido.set(this.modo() === 'pagina' || this.permisos.canReadRoute('/dashboard/turnos/atencion'));
    if (this.permitido()) this.ctx.cargar();
  }

  // ── Colapsador ────────────────────────────────────────────────────────

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
    this.alto.set(Math.max(160, Math.min(720, this.arrastre.alto0 + (e.clientY - this.arrastre.y0))));
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
      this.refrescarEstado();
      this.sonar();
    });
  }

  rellamar(): void {
    const t = this.turno();
    if (t) this.llamar(t.id);
  }

  iniciar(): void {
    const t = this.turno();
    if (!t) return;
    this.correr(this.api.iniciar(t.id), r => { this.ctx.aplicarTurno(r); this.refrescarEstado(); });
  }

  pedirCierre(resultado: 'ATENDIDO' | 'NO_SE_PRESENTO' | 'CANCELADO'): void {
    // Finalizar como atendido no pide motivo: es el camino feliz y se pulsa cien veces al día.
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
      this.refrescarEstado();
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
      this.refrescarEstado();
      this.aviso.set('Turno transferido; nace con prioridad en el otro servicio');
    });
  }

  aplazar(): void {
    const t = this.turno();
    if (!t) return;
    this.correr(this.api.aplazar(t.id, 'La persona pidió un momento'), () => this.refrescarEstado());
  }

  alternarAutoLlamar(): void {
    const v = !this.ctx.preferencia()?.auto_llamar;
    this.guardarPref({ auto_llamar: v });
    this.ctx.preferencia.update(p => (p ? { ...p, auto_llamar: v } : p));
  }

  refrescarEstado(): void {
    this.api.estadoAtencion().subscribe({ next: e => this.ctx.aplicarAtencion(e), error: () => {} });
  }

  // ── Casos ─────────────────────────────────────────────────────────────

  abrirCasoDelTurno(): void {
    const t = this.turno();
    if (!t) return;
    this.correr(this.api.abrirCaso({ turno_id: t.id, oficina_id: t.oficina_id, activar: true }), c => {
      this.ctx.aplicarCaso(c);
      this.ctx.preferencia.update(p => (p ? { ...p, caso_activo_id: c.id } : p));
      this.abierto.set(true);
    });
  }

  crearCaso(): void {
    const f = this.nuevoCaso;
    if (!f.nombre.trim() && !f.documento.trim() && !f.persona_nombre.trim()) return;
    this.correr(this.api.abrirCaso({
      oficina_id: this.ctx.oficinaId(), nombre: f.nombre.trim() || null,
      documento: f.documento.trim() || null, persona_nombre: f.persona_nombre.trim() || null,
      motivo: f.motivo.trim() || null, activar: true,
    }), c => {
      this.ctx.aplicarCaso(c);
      this.ctx.preferencia.update(p => (p ? { ...p, caso_activo_id: c.id } : p));
      this.nuevoCaso = { nombre: '', documento: '', persona_nombre: '', motivo: '' };
      this.nuevoCasoAbierto.set(false);
    });
  }

  activarCaso(c: Caso): void {
    if (this.casoActivo()?.id === c.id) return;
    this.correr(this.api.activarCaso(c.id), r => {
      this.ctx.aplicarCaso(r);
      this.ctx.preferencia.update(p => (p ? { ...p, caso_activo_id: r.id } : p));
      // Los demás pasan a pausados en el servidor; se reflejan al recargar.
      this.api.casos().subscribe({ next: l => this.ctx.casos.set(l), error: () => {} });
    });
  }

  volverAlCaso(c: Caso): void {
    const ruta = leerContexto(c.contexto_json).ruta;
    if (ruta) this.router.navigateByUrl(ruta);
  }

  pausarCaso(c: Caso): void {
    this.correr(this.api.pausarCaso(c.id), r => this.ctx.aplicarCaso(r));
  }

  fijarCaso(c: Caso): void {
    this.correr(this.api.actualizarCaso(c.id, { fijado: !c.fijado }), r => this.ctx.aplicarCaso(r));
  }

  empezarRenombrar(c: Caso): void {
    this.renombrando.set(c.id);
    this.nombreTemporal = c.nombre;
  }

  guardarNombre(c: Caso): void {
    const nombre = this.nombreTemporal.trim();
    this.renombrando.set(null);
    if (!nombre || nombre === c.nombre) return;
    this.correr(this.api.actualizarCaso(c.id, { nombre }), r => this.ctx.aplicarCaso(r));
  }

  nombreAutomatico(c: Caso): void {
    this.correr(this.api.actualizarCaso(c.id, { nombre_automatico: true }), r => this.ctx.aplicarCaso(r));
  }

  pedirCerrarCaso(c: Caso): void {
    this.cerrandoCaso.set(c.id);
    this.resultadoCaso = '';
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

  // ── Presentación ──────────────────────────────────────────────────────

  estado(t: Turno): string { return etiquetaEstado(t.estado); }

  tiempoCaso(c: Caso): string {
    let seg = c.segundos_activo ?? 0;
    // El backend ya incluye el tramo activo hasta el momento de la respuesta; aquí se le
    // suma lo que ha pasado desde entonces para que el reloj corra sin pedir de nuevo.
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

  colorCaso(c: Caso): string { return c.color || '#2B59F0'; }

  volverPosible(c: Caso): boolean {
    const ruta = leerContexto(c.contexto_json).ruta;
    return !!ruta && ruta !== this.router.url;
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

export function leerContexto(json: string | null): { ruta?: string; [k: string]: unknown } {
  if (!json) return {};
  try { const v = JSON.parse(json); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
