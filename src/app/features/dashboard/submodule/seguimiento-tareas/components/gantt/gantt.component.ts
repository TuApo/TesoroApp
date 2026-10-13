import {
  ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, effect, inject, input, output, signal, untracked, viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Tarea } from '../../models/tareas.models';
import { DirectorioService } from '../../services/directorio.service';
import { estadoInfo } from '../../utils/tareas-ui';
import { TareaAvatarComponent } from '../avatar/avatar.component';

export type ZoomGantt = 'dia' | 'semana' | 'mes';
export type AgruparGantt = 'tablero' | 'lista' | 'responsable' | 'estado' | 'ninguno';
export interface DependenciaGantt { card_id: number; requisito_id: number }
export interface CambioFechas { tarea: Tarea; start_at: string; due_at: string }

const DIA = 86_400_000;
const PX: Record<ZoomGantt, number> = { dia: 44, semana: 20, mes: 7 };
const ALTO_FILA = 40;
const ALTO_GRUPO = 34;
const CLAVE_ZOOM = 'tareas.ganttZoom';
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

interface Barra {
  tarea: Tarea;
  ini: number;          // día (índice desde el inicio del rango)
  fin: number;          // día final, inclusive
  sinFecha: boolean;
  avance: number;       // 0..1
  atrasada: boolean;
  esperando: number;    // requisitos sin completar
}
interface Fila { tipo: 'grupo' | 'tarea'; clave: string; y: number; alto: number; barra?: Barra; grupo?: GrupoGantt }
interface GrupoGantt { clave: string; titulo: string; color: string | null; n: number; ini: number; fin: number; avance: number; abierto: boolean }
interface Flecha { d: string; tono: 'ok' | 'pend' | 'conflicto'; de: number; a: number }

/**
 * Diagrama de Gantt de tareas: barras por fechas (inicio → vencimiento), avance, hoy, fines de
 * semana y flechas de dependencia (requisito → tarea que lo espera). Con `editable` las barras
 * se arrastran para mover las fechas y se estiran por los bordes; un toque abre la tarea.
 *
 * Una tarea sin inicio arranca el día que se creó (o el de su vencimiento si es anterior); sin
 * ninguna fecha se dibuja punteada en el día de creación, para que también se vea y se programe.
 */
@Component({
  selector: 'app-gantt',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule, TareaAvatarComponent],
  templateUrl: './gantt.component.html',
  styleUrls: ['./gantt.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GanttComponent {
  private readonly dir = inject(DirectorioService);

  readonly tareas = input<Tarea[]>([]);
  readonly dependencias = input<DependenciaGantt[]>([]);
  readonly agrupar = input<AgruparGantt>('tablero');
  readonly editable = input(false);
  readonly abrir = output<number>();
  readonly cambiarFechas = output<CambioFechas>();

  readonly zoom = signal<ZoomGantt>(this.leerZoom());
  readonly px = computed(() => PX[this.zoom()]);
  readonly foco = signal<number | null>(null);
  readonly cerrados = signal<Set<string>>(new Set());
  /** Arrastre en curso: desplazamiento en días del inicio y del fin de una barra. */
  readonly arrastre = signal<{ id: number; dIni: number; dFin: number } | null>(null);

  private readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');
  private yaCentrado = false;

  /** Día 0 del rango (medianoche local) y cantidad de días visibles. */
  readonly rango = computed(() => {
    const hoy = this.dia(Date.now());
    let min = hoy, max = hoy;
    for (const t of this.tareas()) {
      const [a, b] = this.extremos(t);
      if (a < min) min = a;
      if (b > max) max = b;
    }
    const z = this.zoom();
    let ini = min - (z === 'dia' ? 3 : 7) * DIA;
    if (z !== 'dia') { const d = new Date(ini); ini -= ((d.getDay() + 6) % 7) * DIA; } // desde lunes
    const minimo = z === 'dia' ? 28 : z === 'semana' ? 84 : 240;
    let dias = Math.round((max - ini) / DIA) + (z === 'dia' ? 10 : 21);
    dias = Math.min(Math.max(dias, minimo), 1100);
    return { ini: this.dia(ini), dias };
  });

  readonly anchoLinea = computed(() => this.rango().dias * this.px());

  readonly barras = computed<Barra[]>(() => {
    const { ini } = this.rango();
    const ahora = Date.now();
    const esperando = new Map<number, number>();
    const hechas = new Set(this.tareas().filter(t => t.status === 'DONE').map(t => t.id));
    for (const d of this.dependencias()) {
      if (!hechas.has(d.requisito_id)) esperando.set(d.card_id, (esperando.get(d.card_id) ?? 0) + 1);
    }
    return this.tareas().map(t => {
      const [a, b] = this.extremos(t);
      const total = t.checklist_total ?? 0;
      const avance = t.status === 'DONE' ? 1 : total > 0 ? (t.checklist_done ?? 0) / total : 0;
      return {
        tarea: t,
        ini: Math.round((a - ini) / DIA),
        fin: Math.round((b - ini) / DIA),
        sinFecha: !t.start_at && !t.due_at,
        avance,
        atrasada: !!t.due_at && t.status !== 'DONE' && new Date(t.due_at).getTime() < ahora,
        esperando: t.requisitos_abiertos ?? esperando.get(t.id) ?? 0,
      };
    }).sort((x, y) => x.ini - y.ini || x.fin - y.fin || x.tarea.title.localeCompare(y.tarea.title, 'es'));
  });

  readonly filas = computed<Fila[]>(() => {
    const modo = this.agrupar();
    const cerrados = this.cerrados();
    const out: Fila[] = [];
    let y = 0;
    const meter = (b: Barra) => { out.push({ tipo: 'tarea', clave: `t${b.tarea.id}`, y, alto: ALTO_FILA, barra: b }); y += ALTO_FILA; };
    if (modo === 'ninguno') {
      this.barras().forEach(meter);
      return out;
    }
    const grupos = new Map<string, { titulo: string; color: string | null; barras: Barra[]; orden: number }>();
    for (const b of this.barras()) {
      const [clave, titulo, color, orden] = this.grupoDe(b.tarea, modo);
      const g = grupos.get(clave) ?? { titulo, color, barras: [], orden };
      g.barras.push(b);
      grupos.set(clave, g);
    }
    const ordenados = [...grupos.entries()].sort((a, b) => a[1].orden - b[1].orden || a[1].titulo.localeCompare(b[1].titulo, 'es'));
    for (const [clave, g] of ordenados) {
      const dias = g.barras.reduce((n, b) => n + (b.fin - b.ini + 1), 0) || 1;
      const avance = g.barras.reduce((n, b) => n + b.avance * (b.fin - b.ini + 1), 0) / dias;
      const abierto = !cerrados.has(clave);
      out.push({
        tipo: 'grupo', clave: `g${clave}`, y, alto: ALTO_GRUPO,
        grupo: {
          clave, titulo: g.titulo, color: g.color, n: g.barras.length, abierto, avance,
          ini: Math.min(...g.barras.map(b => b.ini)), fin: Math.max(...g.barras.map(b => b.fin)),
        },
      });
      y += ALTO_GRUPO;
      if (abierto) g.barras.forEach(meter);
    }
    return out;
  });

  readonly alto = computed(() => this.filas().reduce((n, f) => n + f.alto, 0));

  /** Flechas requisito → dependiente, entre filas visibles (codo en ángulo recto). */
  readonly flechas = computed<Flecha[]>(() => {
    const px = this.px();
    const pos = new Map<number, Fila>();
    for (const f of this.filas()) if (f.barra) pos.set(f.barra.tarea.id, f);
    const out: Flecha[] = [];
    for (const d of this.dependencias()) {
      const req = pos.get(d.requisito_id), dep = pos.get(d.card_id);
      if (!req?.barra || !dep?.barra) continue;
      const [ri, rf] = this.conArrastre(req.barra), [di] = this.conArrastre(dep.barra);
      const x1 = (rf + 1) * px, y1 = req.y + ALTO_FILA / 2;
      const x2 = di * px, y2 = dep.y + ALTO_FILA / 2;
      const hecho = req.barra.tarea.status === 'DONE';
      const conflicto = !hecho && di <= rf;
      let path: string;
      if (x2 - x1 >= 16) {
        const xm = x1 + 8;
        path = `M${x1},${y1} H${xm} V${y2} H${x2 - 2}`;
      } else {
        const yMedio = y2 + (y2 > y1 ? -ALTO_FILA / 2 : ALTO_FILA / 2);
        path = `M${x1},${y1} h8 V${yMedio} H${x2 - 10} V${y2} H${x2 - 2}`;
      }
      out.push({ d: path, tono: hecho ? 'ok' : conflicto ? 'conflicto' : 'pend', de: d.requisito_id, a: d.card_id });
      void ri;
    }
    return out;
  });

  readonly relacionadas = computed(() => {
    const f = this.foco();
    if (f == null) return null;
    const s = new Set<number>([f]);
    for (const d of this.dependencias()) {
      if (d.card_id === f) s.add(d.requisito_id);
      if (d.requisito_id === f) s.add(d.card_id);
    }
    return s;
  });

  /** Encabezado: meses arriba; abajo días (zoom día) o semanas. */
  readonly meses = computed(() => {
    const { ini, dias } = this.rango();
    const px = this.px();
    const out: { texto: string; x: number; ancho: number }[] = [];
    let i = 0;
    while (i < dias) {
      const d = new Date(ini + i * DIA);
      const finMes = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
      const n = Math.min(dias - i, Math.round((finMes - d.getTime()) / DIA));
      out.push({ texto: `${MESES[d.getMonth()]} ${d.getFullYear()}`, x: i * px, ancho: n * px });
      i += Math.max(n, 1);
    }
    return out;
  });

  readonly marcas = computed(() => {
    const { ini, dias } = this.rango();
    const px = this.px();
    const z = this.zoom();
    const hoy = Math.round((this.dia(Date.now()) - ini) / DIA);
    const out: { texto: string; sub?: string; x: number; ancho: number; finde: boolean; hoy: boolean }[] = [];
    if (z === 'dia') {
      for (let i = 0; i < dias; i++) {
        const d = new Date(ini + i * DIA);
        out.push({ texto: String(d.getDate()), sub: DIAS[d.getDay()], x: i * px, ancho: px, finde: d.getDay() === 0 || d.getDay() === 6, hoy: i === hoy });
      }
    } else {
      for (let i = 0; i < dias; i += 7) {
        const d = new Date(ini + i * DIA);
        out.push({ texto: z === 'semana' ? `${d.getDate()} ${MESES[d.getMonth()].slice(0, 3)}` : String(d.getDate()),
          x: i * px, ancho: 7 * px, finde: false, hoy: hoy >= i && hoy < i + 7 });
      }
    }
    return out;
  });

  /** Fines de semana sombreados (solo en zoom día y semana). */
  readonly findes = computed(() => {
    if (this.zoom() === 'mes') return [];
    const { ini, dias } = this.rango();
    const px = this.px();
    const out: number[] = [];
    for (let i = 0; i < dias; i++) if (new Date(ini + i * DIA).getDay() === 6) out.push(i * px);
    return out;
  });

  readonly xHoy = computed(() => (Date.now() - this.rango().ini) / DIA * this.px());

  constructor() {
    // Al cargar (y al cambiar de zoom) la vista arranca cerca de hoy.
    afterNextRender(() => this.irAHoy());
    effect(() => {
      this.zoom();
      const hay = this.tareas().length;
      untracked(() => {
        if (!hay && this.yaCentrado) return;
        queueMicrotask(() => this.irAHoy());
      });
    });
  }

  // ── Acciones de la barra ──

  cambiarZoom(z: ZoomGantt): void {
    this.zoom.set(z);
    try { localStorage.setItem(CLAVE_ZOOM, z); } catch { /* sin almacenamiento */ }
  }

  irAHoy(): void {
    const el = this.scroll()?.nativeElement;
    if (!el) return;
    const nombre = el.querySelector<HTMLElement>('.gt-cab__nombre')?.offsetWidth ?? 0;
    el.scrollLeft = Math.max(0, this.xHoy() - (el.clientWidth - nombre) / 3);
    this.yaCentrado = true;
  }

  alternarGrupo(clave: string): void {
    this.cerrados.update(s => { const n = new Set(s); n.has(clave) ? n.delete(clave) : n.add(clave); return n; });
  }

  // ── Arrastre: mover (cuerpo) o estirar (bordes) ──

  private gesto: { id: number; modo: 'mover' | 'ini' | 'fin'; x0: number; movio: boolean; barra: Barra; tactil: boolean } | null = null;

  bajar(ev: PointerEvent, b: Barra, modo: 'mover' | 'ini' | 'fin'): void {
    if (ev.button !== 0) return;
    const tactil = ev.pointerType === 'touch';
    // En el celular el cuerpo de la barra deja desplazar el diagrama; solo los bordes la editan.
    if (!this.editable() || (tactil && modo === 'mover')) {
      this.gesto = { id: b.tarea.id, modo, x0: ev.clientX, movio: false, barra: b, tactil };
      return;
    }
    ev.stopPropagation();
    (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
    this.gesto = { id: b.tarea.id, modo, x0: ev.clientX, movio: false, barra: b, tactil };
  }

  mover(ev: PointerEvent): void {
    const g = this.gesto;
    if (!g || !this.editable() || (g.tactil && g.modo === 'mover')) return;
    const dx = ev.clientX - g.x0;
    if (!g.movio && Math.abs(dx) < 4) return;
    g.movio = true;
    const d = Math.round(dx / this.px());
    const largo = g.barra.fin - g.barra.ini;
    let dIni = 0, dFin = 0;
    if (g.modo === 'mover') { dIni = d; dFin = d; }
    else if (g.modo === 'ini') dIni = Math.min(d, largo);
    else dFin = Math.max(d, -largo);
    this.arrastre.set({ id: g.id, dIni, dFin });
  }

  soltar(ev: PointerEvent): void {
    const g = this.gesto;
    this.gesto = null;
    if (!g) return;
    const a = this.arrastre();
    this.arrastre.set(null);
    if (!g.movio || !a) {
      if (Math.abs(ev.clientX - g.x0) < 6) this.abrir.emit(g.id);
      return;
    }
    if (!a.dIni && !a.dFin) return;
    const { ini } = this.rango();
    const nuevoIni = new Date(ini + (g.barra.ini + a.dIni) * DIA);
    const nuevoFin = new Date(ini + (g.barra.fin + a.dFin) * DIA);
    this.cambiarFechas.emit({
      tarea: g.barra.tarea,
      start_at: new Date(nuevoIni.getFullYear(), nuevoIni.getMonth(), nuevoIni.getDate(), 8, 0, 0).toISOString(),
      due_at: new Date(nuevoFin.getFullYear(), nuevoFin.getMonth(), nuevoFin.getDate(), 17, 0, 0).toISOString(),
    });
  }

  cancelar(): void { this.gesto = null; this.arrastre.set(null); }

  // ── Ayudantes de plantilla ──

  conArrastre(b: Barra): [number, number] {
    const a = this.arrastre();
    return a && a.id === b.tarea.id ? [b.ini + a.dIni, b.fin + a.dFin] : [b.ini, b.fin];
  }

  x(b: Barra): number { return this.conArrastre(b)[0] * this.px(); }
  ancho(b: Barra): number { const [i, f] = this.conArrastre(b); return Math.max((f - i + 1) * this.px(), 10); }

  etiqueta(b: Barra): string {
    const t = b.tarea;
    const [i, f] = this.conArrastre(b);
    const { ini } = this.rango();
    const fmt = (n: number) => new Date(ini + n * DIA).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
    const quien = t.assignee ? this.dir.nombre(t.assignee) : t.assignee_group_name ? `Grupo ${t.assignee_group_name}` : 'Sin responsable';
    const partes = [
      t.title,
      b.sinFecha ? 'Sin fechas: arrástrala para programarla' : `${fmt(i)} → ${fmt(f)} (${f - i + 1} d)`,
      `${estadoInfo(t.status).etiqueta} · ${Math.round(b.avance * 100)}%`,
      quien,
    ];
    if (b.esperando) partes.push(`Espera ${b.esperando} requisito${b.esperando === 1 ? '' : 's'}`);
    if (b.atrasada) partes.push('Vencida');
    return partes.join('\n');
  }

  fechaCorta(b: Barra): string {
    const [, f] = this.conArrastre(b);
    return new Date(this.rango().ini + f * DIA).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
  }

  tenue(id: number): boolean { const r = this.relacionadas(); return !!r && !r.has(id); }
  tenueFlecha(f: Flecha): boolean { const r = this.foco(); return r != null && f.de !== r && f.a !== r; }

  readonly ALTO_FILA = ALTO_FILA;
  readonly ALTO_GRUPO = ALTO_GRUPO;

  // ── Fechas ──

  /** Medianoche local del instante. */
  private dia(ms: number): number { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }

  /** [inicio, fin] en medianoches locales; fin inclusive. */
  private extremos(t: Tarea): [number, number] {
    const creada = t.created_at ? this.dia(new Date(t.created_at).getTime()) : this.dia(Date.now());
    const vence = t.due_at ? this.dia(new Date(t.due_at).getTime()) : null;
    let ini = t.start_at ? this.dia(new Date(t.start_at).getTime()) : vence != null ? Math.min(creada, vence) : creada;
    let fin = vence ?? ini;
    if (fin < ini) [ini, fin] = [fin, ini];
    return [ini, fin];
  }

  private grupoDe(t: Tarea, modo: AgruparGantt): [string, string, string | null, number] {
    switch (modo) {
      case 'lista': return [`l${t.board_list ?? 0}`, `${t.list_name ?? 'Sin columna'}${t.board_name ? ' · ' + t.board_name : ''}`, t.board_accent ?? null, 0];
      case 'responsable':
        if (t.assignee) return [`u${t.assignee}`, this.dir.nombre(t.assignee), null, 0];
        if (t.assignee_group) return [`g${t.assignee_group}`, `Grupo ${t.assignee_group_name ?? ''}`.trim(), null, 1];
        return ['sin', 'Sin responsable', null, 2];
      case 'estado': {
        const orden = ['IN_PROGRESS', 'BLOCKED', 'TODO', 'DONE'].indexOf(t.status);
        return [`e${t.status}`, estadoInfo(t.status).etiqueta, null, orden];
      }
      default: return [`b${t.board_id ?? 0}`, t.board_name ?? 'Tablero', t.board_accent ?? null, 0];
    }
  }

  private leerZoom(): ZoomGantt {
    try { const z = localStorage.getItem(CLAVE_ZOOM); return z === 'dia' || z === 'mes' ? z : 'semana'; } catch { return 'semana'; }
  }
}
