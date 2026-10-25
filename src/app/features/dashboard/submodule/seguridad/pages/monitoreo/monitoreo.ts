import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { mensajeDeError } from '../../../../../../shared/utils/mensaje-error';
import { DetalleIncidente } from '../../components/detalle-incidente/detalle-incidente';
import { abrirFormulario } from '../../components/dialogos/formulario-dialogo';
import { SgImagen } from '../../components/imagen-segura/imagen-segura';
import { PttBoton } from '../../components/ptt-boton/ptt-boton';
import { VisorCamara } from '../../components/visor-camara/visor-camara';
import {
  AccionDispositivo, Camara, Disposicion, Dispositivo, EstadoDispositivo, ICONO_ACCION, ICONO_TIPO_DISPOSITIVO, Incidente,
  Mosaico, NOMBRE_ACCION, NOMBRE_ESTADO_DISPOSITIVO, NOMBRE_ESTADO_INCIDENTE, NOMBRE_SEVERIDAD, Parlante, Protocolo, Sede, Grupo,
} from '../../models/seguridad.models';
import { AccionesSeguridad } from '../../services/acciones.service';
import { SeguridadService } from '../../services/seguridad.service';
import { SeguridadVivoService } from '../../services/seguridad-vivo.service';
import { copiarTexto, cronometro, tonoSeveridad } from '../../utils/formato';

type Fuente = 'libre' | 'mosaico' | 'sede' | 'grupo';

export const CAPACIDAD: Record<Disposicion, number> = { '1x1': 1, '2x2': 4, '3x3': 9, '4x4': 16, '1+5': 6, '1+7': 8 };
export const DISPOSICIONES: Disposicion[] = ['1x1', '2x2', '3x3', '4x4', '1+5', '1+7'];
const CLAVE_LOCAL = 'sg-monitoreo-v1';

interface Guardado {
  disposicion: Disposicion; celdas: (string | null)[]; fuente: Fuente; mosaicoId: string | null;
  sede: string | null; grupo: string | null; rotacion: number;
}

/**
 * Centro de monitoreo: el videowall, las alarmas en vivo y las acciones rápidas por sede.
 *
 * <p>Videowall: un mosaico guardado (`/mosaicos`) o uno armado al vuelo por sede o grupo
 * (con páginas que rotan). Se arrastra una cámara de la lista a una celda (en pantallas
 * táctiles: tocar la cámara y luego la celda). La disposición elegida se recuerda en este
 * navegador.
 *
 * <p>Alarmas: cada una con su color de severidad, cuánto lleva abierta, en qué paso del
 * protocolo va y cuándo sube el tono. Reconocer detiene el escalamiento. Con `?incidente=`
 * se abre su ficha. Mientras esta pantalla está abierta, las críticas y altas suenan.
 */
@Component({
  selector: 'app-seguridad-monitoreo',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatTooltipModule, MatMenuModule, VisorCamara, PttBoton, DetalleIncidente, SgImagen],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './monitoreo.html',
  styleUrls: ['../../styles/seguridad-comun.css', './monitoreo.css'],
})
export class SeguridadMonitoreo {
  private readonly api = inject(SeguridadService);
  readonly vivo = inject(SeguridadVivoService);
  readonly acciones = inject(AccionesSeguridad);
  private readonly dialog = inject(MatDialog);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly muro = viewChild<ElementRef<HTMLElement>>('muro');

  // ── Catálogos ────────────────────────────────────────────────────────────
  readonly camaras = signal<Camara[]>([]);
  readonly sedes = signal<Sede[]>([]);
  readonly grupos = signal<Grupo[]>([]);
  readonly mosaicos = signal<Mosaico[]>([]);
  readonly parlantes = signal<Parlante[]>([]);
  readonly dispositivos = signal<Dispositivo[]>([]);
  readonly protocolos = signal<Protocolo[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);

  readonly mapaCamaras = computed(() => new Map(this.camaras().map((c) => [c.id, c])));

  // ── Videowall ────────────────────────────────────────────────────────────
  readonly disposiciones = DISPOSICIONES;
  readonly fuente = signal<Fuente>('libre');
  readonly mosaicoId = signal<string | null>(null);
  readonly modificado = signal(false);
  readonly sedeMuro = signal<string | null>(null);
  readonly grupoMuro = signal<string | null>(null);
  readonly disposicion = signal<Disposicion>('2x2');
  readonly celdas = signal<(string | null)[]>([null, null, null, null]);
  readonly pagina = signal(0);
  readonly rotacion = signal(0);
  readonly foco = signal<string | null>(null);
  readonly elegida = signal<string | null>(null);
  readonly busqueda = signal('');
  readonly verLista = signal(true);
  private ultimoGiro = Date.now();

  readonly capacidad = computed(() => CAPACIDAD[this.disposicion()]);
  readonly posiciones = computed(() => Array.from({ length: this.capacidad() }, (_, i) => i));
  readonly camarasFuente = computed(() => {
    const f = this.fuente();
    const lista = this.camaras().filter((c) => c.activo !== false);
    if (f === 'sede') return lista.filter((c) => c.sede_id === this.sedeMuro());
    if (f === 'grupo') return lista.filter((c) => c.grupo_id === this.grupoMuro());
    return lista;
  });
  readonly totalPaginas = computed(() => Math.max(1, Math.ceil(this.camarasFuente().length / this.capacidad())));
  readonly listaLateral = computed(() => {
    const q = this.busqueda().trim().toLowerCase();
    const sede = this.sedeMuro();
    return this.camaras()
      .filter((c) => !sede || c.sede_id === sede)
      .filter((c) => !q || `${c.nombre} ${c.sede_nombre} ${c.grupo_nombre ?? ''} ${c.ubicacion ?? ''}`.toLowerCase().includes(q));
  });
  readonly enMuro = computed(() => new Set(this.celdas().filter(Boolean) as string[]));

  // ── Alarmas ──────────────────────────────────────────────────────────────
  readonly ahora = signal(Date.now());
  readonly incidenteAbierto = signal<string | null>(null);
  readonly nombreSev = NOMBRE_SEVERIDAD;
  readonly nombreEstado = NOMBRE_ESTADO_INCIDENTE;
  readonly f = { cronometro, tonoSeveridad };

  // ── Acciones rápidas por sede ────────────────────────────────────────────
  readonly sedeAccion = signal<string | null>(null);
  readonly sedeAcc = computed(() => this.sedes().find((s) => s.id === this.sedeAccion()) ?? null);
  readonly parlantesSede = computed(() => this.parlantes().filter((p) => p.sede_id === this.sedeAccion() && p.activo !== false));
  readonly parlantePtt = signal<string | null>(null);
  readonly parlanteElegido = computed(() => {
    const id = this.parlantePtt();
    const l = this.parlantesSede();
    return l.find((p) => p.id === id) ?? l[0] ?? null;
  });
  readonly dispositivosSede = computed(() => this.dispositivos()
    .filter((d) => d.sede_id === this.sedeAccion() && d.activo !== false && d.acciones_disponibles?.length)
    .sort((a, b) => (a.tipo === 'SIRENA' ? -1 : 0) - (b.tipo === 'SIRENA' ? -1 : 0)));
  readonly incidenteSede = computed(() => this.vivo.incidentes().find((i) => i.sede_id === this.sedeAccion()) ?? null);
  readonly nombreAccion = NOMBRE_ACCION;
  readonly iconoAccion = ICONO_ACCION;
  readonly iconoTipo = ICONO_TIPO_DISPOSITIVO;
  readonly nombreEstadoDisp = NOMBRE_ESTADO_DISPOSITIVO;

  constructor() {
    this.restaurar();
    this.cargar();
    this.vivo.activarAvisos(true);
    const reloj = setInterval(() => {
      this.ahora.set(Date.now());
      const r = this.rotacion();
      if (r > 0 && !this.foco() && Date.now() - this.ultimoGiro >= r * 1000) this.girar();
    }, 1000);
    const sub = this.route.queryParamMap.subscribe((q) => {
      const inc = q.get('incidente');
      if (inc) this.incidenteAbierto.set(inc);
      const sede = q.get('sede');
      if (sede) { this.sedeAccion.set(sede); this.verSede(sede); }
    });
    inject(DestroyRef).onDestroy(() => {
      clearInterval(reloj);
      sub.unsubscribe();
      this.vivo.activarAvisos(false);
    });
  }

  cargar(): void {
    this.cargando.set(true);
    this.api.camaras().subscribe({
      next: (c) => { this.camaras.set([...c].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || a.nombre.localeCompare(b.nombre))); this.cargando.set(false); this.reaplicar(); },
      error: (e) => { this.cargando.set(false); this.error.set(mensajeDeError(e, 'No se pudieron leer las cámaras.')); },
    });
    this.api.sedes().subscribe({ next: (s) => { this.sedes.set(s); if (!this.sedeAccion() && s.length) this.sedeAccion.set(s[0].id); }, error: () => {} });
    this.api.grupos().subscribe({ next: (g) => this.grupos.set(g), error: () => {} });
    this.api.mosaicos().subscribe({ next: (m) => this.mosaicos.set([...m].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))), error: () => {} });
    this.api.parlantes().subscribe({ next: (p) => this.parlantes.set(p), error: () => {} });
    this.api.dispositivos().subscribe({ next: (d) => this.dispositivos.set(d), error: () => {} });
    this.api.protocolos().subscribe({ next: (p) => this.protocolos.set(p), error: () => {} });
  }

  // ── Videowall: fuentes y disposición ────────────────────────────────────
  private guardarLocal(): void {
    const g: Guardado = {
      disposicion: this.disposicion(), celdas: this.celdas(), fuente: this.fuente(), mosaicoId: this.mosaicoId(),
      sede: this.sedeMuro(), grupo: this.grupoMuro(), rotacion: this.rotacion(),
    };
    try { localStorage.setItem(CLAVE_LOCAL, JSON.stringify(g)); } catch { /* sin almacenamiento */ }
  }

  private restaurar(): void {
    try {
      const raw = localStorage.getItem(CLAVE_LOCAL);
      if (!raw) return;
      const g = JSON.parse(raw) as Guardado;
      if (!DISPOSICIONES.includes(g.disposicion)) return;
      this.disposicion.set(g.disposicion);
      this.celdas.set(this.ajustar(g.celdas ?? [], CAPACIDAD[g.disposicion]));
      this.fuente.set(g.fuente ?? 'libre');
      this.mosaicoId.set(g.mosaicoId ?? null);
      this.sedeMuro.set(g.sede ?? null);
      this.grupoMuro.set(g.grupo ?? null);
      this.rotacion.set(g.rotacion ?? 0);
    } catch { /* guardado dañado: se ignora */ }
  }

  private ajustar(l: (string | null)[], n: number): (string | null)[] {
    const r = l.slice(0, n);
    while (r.length < n) r.push(null);
    return r;
  }

  /** Vuelve a llenar las celdas cuando la fuente es automática (sede o grupo). */
  private reaplicar(): void {
    const f = this.fuente();
    if (f === 'sede' || f === 'grupo') this.llenarPagina();
  }

  private llenarPagina(): void {
    const n = this.capacidad();
    const lista = this.camarasFuente();
    const p = Math.min(this.pagina(), Math.max(0, Math.ceil(lista.length / n) - 1));
    this.pagina.set(p);
    this.celdas.set(this.ajustar(lista.slice(p * n, p * n + n).map((c) => c.id), n));
    this.guardarLocal();
  }

  cambiarDisposicion(d: Disposicion): void {
    this.disposicion.set(d);
    this.foco.set(null);
    if (this.fuente() === 'sede' || this.fuente() === 'grupo') this.llenarPagina();
    else {
      this.celdas.set(this.ajustar(this.celdas(), CAPACIDAD[d]));
      if (this.fuente() === 'mosaico') this.modificado.set(true);
      this.guardarLocal();
    }
  }

  elegirMosaico(m: Mosaico): void {
    this.fuente.set('mosaico');
    this.mosaicoId.set(m.id);
    this.modificado.set(false);
    this.disposicion.set(m.disposicion);
    const l: (string | null)[] = Array.from({ length: CAPACIDAD[m.disposicion] }, () => null);
    for (const c of m.celdas ?? []) if (c.pos >= 0 && c.pos < l.length) l[c.pos] = c.camara_id;
    this.celdas.set(l);
    this.rotacion.set(m.rotacion_seg ?? 0);
    this.foco.set(null);
    this.ultimoGiro = Date.now();
    this.guardarLocal();
  }

  verSede(id: string | null): void {
    if (!id) { this.fuente.set('libre'); this.sedeMuro.set(null); this.guardarLocal(); return; }
    this.fuente.set('sede'); this.sedeMuro.set(id); this.mosaicoId.set(null); this.pagina.set(0); this.foco.set(null);
    this.llenarPagina();
  }

  verGrupo(id: string): void {
    this.fuente.set('grupo'); this.grupoMuro.set(id); this.mosaicoId.set(null); this.pagina.set(0); this.foco.set(null);
    this.llenarPagina();
  }

  cambiarPagina(d: number): void {
    const t = this.totalPaginas();
    this.pagina.set((this.pagina() + d + t) % t);
    this.ultimoGiro = Date.now();
    this.llenarPagina();
  }

  cambiarRotacion(seg: number): void { this.rotacion.set(seg); this.ultimoGiro = Date.now(); this.guardarLocal(); }

  private girar(): void {
    this.ultimoGiro = Date.now();
    const f = this.fuente();
    if (f === 'sede' || f === 'grupo') { if (this.totalPaginas() > 1) this.cambiarPagina(1); return; }
    if (f === 'mosaico') {
      const l = this.mosaicos();
      if (l.length < 2) return;
      const i = l.findIndex((m) => m.id === this.mosaicoId());
      this.elegirMosaico(l[(i + 1) % l.length]);
      this.rotacion.set(this.rotacion() || 30);
    }
  }

  nombreFuente = computed(() => {
    switch (this.fuente()) {
      case 'mosaico': return this.mosaicos().find((m) => m.id === this.mosaicoId())?.nombre ?? 'Mosaico';
      case 'sede': return `Sede: ${this.sedes().find((s) => s.id === this.sedeMuro())?.nombre ?? ''}`;
      case 'grupo': return `Grupo: ${this.grupos().find((g) => g.id === this.grupoMuro())?.nombre ?? ''}`;
      default: return 'Mosaico libre';
    }
  });

  // ── Arrastrar y soltar (y tocar-tocar en pantallas táctiles) ────────────
  arrastrar(ev: DragEvent, id: string): void {
    ev.dataTransfer?.setData('text/plain', id);
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'copy';
  }

  sobre(ev: DragEvent): void { ev.preventDefault(); if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy'; }

  soltar(ev: DragEvent, pos: number): void {
    ev.preventDefault();
    const id = ev.dataTransfer?.getData('text/plain');
    if (id) this.poner(pos, id);
  }

  tocarCelda(pos: number): void {
    const id = this.elegida();
    if (id) { this.poner(pos, id); this.elegida.set(null); }
  }

  /** Clic en la lista: la deja elegida para tocar una celda; doble clic la pone en la primera libre. */
  elegir(id: string): void { this.elegida.set(this.elegida() === id ? null : id); }
  ponerEnLibre(id: string): void {
    const l = this.celdas();
    const libre = l.findIndex((x) => !x);
    this.poner(libre >= 0 ? libre : 0, id);
    this.elegida.set(null);
  }

  private poner(pos: number, id: string): void {
    const l = [...this.celdas()];
    const ya = l.indexOf(id);
    if (ya >= 0 && ya !== pos) l[ya] = l[pos]; // si ya estaba en otra celda, se intercambian
    l[pos] = id;
    this.celdas.set(l);
    this.marcarCambio();
  }

  vaciar(pos: number): void {
    const l = [...this.celdas()];
    l[pos] = null;
    this.celdas.set(l);
    this.marcarCambio();
  }

  private marcarCambio(): void {
    if (this.fuente() === 'mosaico') this.modificado.set(true);
    else if (this.fuente() !== 'libre') { this.fuente.set('libre'); this.rotacion.set(0); }
    this.guardarLocal();
  }

  async pantallaCompleta(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await this.muro()?.nativeElement.requestFullscreen();
    } catch { /* no permitido */ }
  }

  async guardarMosaico(nuevo: boolean): Promise<void> {
    const actual = this.mosaicos().find((m) => m.id === this.mosaicoId());
    const celdas = this.celdas().map((camara_id, pos) => ({ pos, camara_id })).filter((c) => c.camara_id);
    const r = await abrirFormulario<Mosaico>(this.dialog, {
      titulo: nuevo ? 'Guardar como mosaico' : `Guardar cambios de "${actual?.nombre}"`, icono: 'grid_view', ancho: '480px',
      campos: [
        { clave: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true, ancho: true },
        { clave: 'compartido', etiqueta: 'Compartido con todos los operadores', tipo: 'booleano', ancho: true,
          ayuda: 'Si no, solo usted lo ve en su lista.' },
        { clave: 'rotacion_seg', etiqueta: 'Rotar al siguiente mosaico cada (s)', tipo: 'numero', min: 0, ayuda: '0 = no rota.' },
      ],
      valores: { nombre: nuevo ? '' : actual?.nombre, compartido: actual?.compartido ?? true, rotacion_seg: this.rotacion() },
      guardar: (v) => this.api.guardarMosaico(nuevo ? null : this.mosaicoId(), {
        nombre: v['nombre'], compartido: !!v['compartido'], rotacion_seg: v['rotacion_seg'] ?? 0,
        disposicion: this.disposicion(), celdas, orden: actual?.orden ?? this.mosaicos().length,
      }),
    });
    if (!r) return;
    this.acciones.aviso('Mosaico guardado.');
    const m = await firstValueFrom(this.api.mosaicos()).catch(() => null);
    if (m) this.mosaicos.set([...m].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)));
    if ((r as Mosaico).id) { this.fuente.set('mosaico'); this.mosaicoId.set((r as Mosaico).id); this.modificado.set(false); this.guardarLocal(); }
  }

  // ── Alarmas ──────────────────────────────────────────────────────────────
  desde(iso: string): number { return Math.max(0, (this.ahora() - new Date(iso).getTime()) / 1000); }
  faltan(iso: string | null): number | null { return iso ? Math.round((new Date(iso).getTime() - this.ahora()) / 1000) : null; }
  sinReconocer(i: Incidente): boolean { return i.estado === 'ABIERTO' || i.estado === 'NOTIFICANDO'; }

  abrirIncidente(id: string): void {
    this.incidenteAbierto.set(id);
    this.router.navigate([], { relativeTo: this.route, queryParams: { incidente: id }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  cerrarDetalle(): void {
    this.incidenteAbierto.set(null);
    this.router.navigate([], { relativeTo: this.route, queryParams: { incidente: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  verCamara(id: string): void { this.foco.set(id); }

  // ── Acciones rápidas ─────────────────────────────────────────────────────
  estadoDisp(d: Dispositivo): EstadoDispositivo { return this.vivo.dispositivos().get(d.id)?.estado ?? d.estado; }
  enLineaDisp(d: Dispositivo): boolean { return this.vivo.dispositivos().get(d.id)?.en_linea ?? d.en_linea; }

  async accionar(d: Dispositivo, a: AccionDispositivo): Promise<void> { await this.acciones.accionar(d, a); }

  async panico(): Promise<void> {
    const s = this.sedeAcc();
    if (!s) return;
    const r = await this.acciones.panico(s, this.camaras(), this.protocolos());
    if (r?.id) this.abrirIncidente(r.id);
  }

  async copiarTelefono(t: string): Promise<void> {
    this.acciones.aviso(await copiarTexto(t) ? 'Teléfono copiado.' : 'No se pudo copiar.');
  }

  async anotarPolicia(): Promise<void> {
    const i = this.incidenteSede();
    const s = this.sedeAcc();
    if (!i || !s) return;
    this.api.comentar(i.id, `Se llamó a la policía del cuadrante${s.policia_nombre ? ` (${s.policia_nombre})` : ''} al ${s.policia_telefono}.`).subscribe({
      next: () => this.acciones.aviso('Quedó anotado en la bitácora de la alarma.'),
      error: (e) => this.acciones.aviso(mensajeDeError(e, 'No se pudo anotar.'), true),
    });
  }

  estadoCamara(c: Camara): string { return this.vivo.camaras().get(c.id)?.estado ?? c.estado; }
}
