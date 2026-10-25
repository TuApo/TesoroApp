import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, EventEmitter, Input, OnInit, Output, ViewChild, inject, signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';
import * as Y from 'yjs';
import { getStroke } from 'perfect-freehand';

import { AulasService, Espacio } from '../../service/aulas.service';
import { mensajeDeError } from '../../service/disenador.service';
import { SalaEnVivo } from '../../aula/sala-en-vivo';
import { YjsSala } from '../../aula/yjs-sala';

type Herramienta = 'lapiz' | 'resaltador' | 'linea' | 'flecha' | 'rect' | 'elipse' | 'texto' | 'borrador';

interface Trazo {
  id: string;
  tipo: Herramienta;
  /** x, y, presión, x, y, presión… en coordenadas del lienzo lógico (1600 × 900). */
  p: number[];
  color: string;
  grosor: number;
  texto?: string;
  autor: string;
}

const ANCHO = 1600;
const ALTO = 900;

/**
 * Pizarra compartida del aula (o del equipo). Cada trazo es un elemento de un Y.Array: todos
 * dibujan a la vez, quien entra tarde la ve completa y se guarda en el servidor.
 *
 * <p>El lienzo es lógico (1600 × 900) y se escala a lo que haya de pantalla: lo que uno dibuja en
 * la esquina del celular cae en la misma esquina del proyector.
 */
@Component({
  selector: 'app-aula-pizarra',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  templateUrl: './panel-pizarra.html',
  styleUrl: './panel-pizarra.css',
})
export class PanelPizarra implements OnInit {
  @Input({ required: true }) aulaId!: string;
  @Input({ required: true }) sala!: SalaEnVivo;
  @Input() equipoId: string | null = null;
  @Input() dirijo = false;
  /** En el escenario: sin barra de pizarras, ocupa todo. */
  @Input() espacioFijo: string | null = null;
  /** Pide al aula poner esta pizarra en el escenario de todos. */
  @Output() alEscenario = new EventEmitter<string>();
  @ViewChild('lienzo', { static: true }) lienzo!: ElementRef<HTMLCanvasElement>;
  @ViewChild('marco', { static: true }) marco!: ElementRef<HTMLElement>;

  private api = inject(AulasService);
  readonly pizarras = signal<Espacio[]>([]);
  readonly actual = signal<Espacio | null>(null);
  readonly herramienta = signal<Herramienta>('lapiz');
  readonly color = signal('#1E293B');
  readonly grosor = signal(6);
  readonly colores = ['#1E293B', '#2B59F0', '#EF4444', '#16A34A', '#F59E0B', '#8B5CF6', '#FFFFFF'];
  readonly herramientas: { id: Herramienta; icono: string; nombre: string }[] = [
    { id: 'lapiz', icono: 'draw', nombre: 'Lápiz' }, { id: 'resaltador', icono: 'ink_highlighter', nombre: 'Resaltador' },
    { id: 'linea', icono: 'horizontal_rule', nombre: 'Línea' }, { id: 'flecha', icono: 'north_east', nombre: 'Flecha' },
    { id: 'rect', icono: 'crop_square', nombre: 'Rectángulo' }, { id: 'elipse', icono: 'circle', nombre: 'Elipse' },
    { id: 'texto', icono: 'title', nombre: 'Texto' }, { id: 'borrador', icono: 'ink_eraser', nombre: 'Borrador' },
  ];

  private yjs: YjsSala | null = null;
  private trazos: Y.Array<Y.Map<unknown>> | null = null;
  private enCurso: Trazo | null = null;
  private escala = 1;
  private observador: ResizeObserver | null = null;
  private pendiente = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => { this.observador?.disconnect(); this.yjs?.cerrar(); });
  }

  async ngOnInit(): Promise<void> {
    this.observador = new ResizeObserver(() => this.ajustar());
    this.observador.observe(this.marco.nativeElement);
    await this.cargar();
  }

  async cargar(abrir?: string): Promise<void> {
    try {
      const todas = (await this.api.espacios(this.aulaId)).filter(e => e.tipo === 'PIZARRA' && (this.espacioFijo ? e.id === this.espacioFijo : (e.team_id ?? null) === this.equipoId));
      this.pizarras.set(todas);
      const elegir = todas.find(e => e.id === (abrir ?? this.espacioFijo ?? this.actual()?.id)) ?? todas[0] ?? null;
      if (elegir && elegir.id !== this.actual()?.id) this.abrir(elegir);
    } catch (e) {
      Swal.fire({ toast: true, position: 'top-end', timer: 3000, showConfirmButton: false, icon: 'error', title: mensajeDeError(e) });
    }
  }

  async nueva(): Promise<void> {
    try {
      const e = await this.api.crearEspacio(this.aulaId, { tipo: 'PIZARRA', team_id: this.equipoId, nombre: `Pizarra ${this.pizarras().length + 1}` });
      this.sala.enviar('aula.espacios', { accion: 'nuevo', id: e.id });
      await this.cargar(e.id);
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'No se pudo crear la pizarra', text: mensajeDeError(err) });
    }
  }

  abrir(e: Espacio): void {
    this.yjs?.cerrar();
    this.actual.set(e);
    this.yjs = new YjsSala(this.sala, e.id, {
      estadoInicial: e.yjs_estado,
      responsable: () => this.dirijo,
      usuario: { nombre: this.sala.nombre, color: '#2B59F0' },
      guardar: async (b64, doc) => {
        await this.api.guardarEspacio(this.aulaId, e.id, { yjs_estado: b64, contenido: JSON.stringify({ trazos: doc.getArray('trazos').length }) });
      },
    });
    this.trazos = this.yjs.doc.getArray<Y.Map<unknown>>('trazos');
    this.trazos.observeDeep(() => this.pedirDibujo());
    this.pedirDibujo();
  }

  // ── Entrada ──────────────────────────────────────────────────────────────

  private punto(ev: PointerEvent): [number, number, number] {
    const r = this.lienzo.nativeElement.getBoundingClientRect();
    return [(ev.clientX - r.left) / this.escala, (ev.clientY - r.top) / this.escala, ev.pressure || 0.5];
  }

  abajo(ev: PointerEvent): void {
    if (!this.trazos) return;
    (ev.target as Element).setPointerCapture(ev.pointerId);
    const [x, y, pr] = this.punto(ev);
    const h = this.herramienta();
    if (h === 'borrador') { this.borrarEn(x, y); return; }
    if (h === 'texto') { this.pedirTexto(x, y); return; }
    this.enCurso = { id: crypto.randomUUID(), tipo: h, p: [x, y, pr], color: this.color(),
      grosor: h === 'resaltador' ? this.grosor() * 3 : this.grosor(), autor: this.sala.identidad };
  }

  mover(ev: PointerEvent): void {
    const [x, y, pr] = this.punto(ev);
    if (this.herramienta() === 'borrador' && ev.buttons) { this.borrarEn(x, y); return; }
    if (!this.enCurso) return;
    if (['lapiz', 'resaltador'].includes(this.enCurso.tipo)) this.enCurso.p.push(x, y, pr);
    else this.enCurso.p = [this.enCurso.p[0], this.enCurso.p[1], this.enCurso.p[2], x, y, pr];
    this.pedirDibujo();
  }

  arriba(): void {
    const t = this.enCurso;
    this.enCurso = null;
    if (!t || !this.trazos || t.p.length < 6) { this.pedirDibujo(); return; }
    const m = new Y.Map<unknown>();
    Object.entries(t).forEach(([k, v]) => m.set(k, v));
    this.trazos.push([m]);
  }

  private async pedirTexto(x: number, y: number): Promise<void> {
    const r = await Swal.fire({ title: 'Texto', input: 'text', showCancelButton: true, confirmButtonText: 'Poner', cancelButtonText: 'Cancelar' });
    if (!r.isConfirmed || !r.value || !this.trazos) return;
    const m = new Y.Map<unknown>();
    const t: Trazo = { id: crypto.randomUUID(), tipo: 'texto', p: [x, y, 0.5], color: this.color(), grosor: this.grosor(), texto: String(r.value).slice(0, 300), autor: this.sala.identidad };
    Object.entries(t).forEach(([k, v]) => m.set(k, v));
    this.trazos.push([m]);
  }

  private borrarEn(x: number, y: number): void {
    if (!this.trazos) return;
    const arr = this.trazos.toArray();
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i].get('p') as number[];
      const g = (arr[i].get('grosor') as number) + 12;
      for (let k = 0; k < p.length; k += 3) {
        if (Math.hypot(p[k] - x, p[k + 1] - y) < g) { this.trazos.delete(i, 1); return; }
      }
    }
  }

  deshacer(): void {
    if (!this.trazos) return;
    const arr = this.trazos.toArray();
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].get('autor') === this.sala.identidad) { this.trazos.delete(i, 1); return; }
    }
  }

  async limpiar(): Promise<void> {
    if (!this.trazos) return;
    const r = await Swal.fire({ icon: 'warning', title: '¿Borrar toda la pizarra?', text: 'Se borra para todos.', showCancelButton: true, confirmButtonText: 'Borrar', cancelButtonText: 'Cancelar' });
    if (r.isConfirmed) this.trazos.delete(0, this.trazos.length);
  }

  exportar(): void {
    const a = document.createElement('a');
    a.download = `${this.actual()?.nombre ?? 'pizarra'}.png`;
    a.href = this.lienzo.nativeElement.toDataURL('image/png');
    a.click();
  }

  // ── Dibujo ───────────────────────────────────────────────────────────────

  private ajustar(): void {
    const marco = this.marco.nativeElement.getBoundingClientRect();
    this.escala = Math.max(0.1, Math.min(marco.width / ANCHO, marco.height / ALTO));
    const c = this.lienzo.nativeElement;
    const dpr = window.devicePixelRatio || 1;
    c.style.width = `${ANCHO * this.escala}px`;
    c.style.height = `${ALTO * this.escala}px`;
    c.width = Math.round(ANCHO * this.escala * dpr);
    c.height = Math.round(ALTO * this.escala * dpr);
    this.pedirDibujo();
  }

  private pedirDibujo(): void {
    if (this.pendiente) return;
    this.pendiente = true;
    requestAnimationFrame(() => { this.pendiente = false; this.dibujar(); });
  }

  private dibujar(): void {
    const c = this.lienzo.nativeElement;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const k = c.width / ANCHO;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const todos: Trazo[] = (this.trazos?.toArray() ?? []).map(m => m.toJSON() as Trazo);
    if (this.enCurso) todos.push(this.enCurso);
    for (const t of todos) this.pintar(ctx, t);
  }

  private pintar(ctx: CanvasRenderingContext2D, t: Trazo): void {
    const p = t.p;
    ctx.save();
    ctx.strokeStyle = t.color;
    ctx.fillStyle = t.color;
    ctx.lineWidth = t.grosor;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (t.tipo === 'lapiz' || t.tipo === 'resaltador') {
      if (t.tipo === 'resaltador') ctx.globalAlpha = 0.35;
      const pts: number[][] = [];
      for (let i = 0; i < p.length; i += 3) pts.push([p[i], p[i + 1], p[i + 2]]);
      const contorno = getStroke(pts, { size: t.grosor, thinning: t.tipo === 'lapiz' ? 0.55 : 0, smoothing: 0.5, streamline: 0.5 });
      if (contorno.length) {
        ctx.beginPath();
        ctx.moveTo(contorno[0][0], contorno[0][1]);
        for (const [x, y] of contorno.slice(1)) ctx.lineTo(x, y);
        ctx.closePath();
        ctx.fill();
      }
    } else if (t.tipo === 'texto') {
      ctx.font = `600 ${Math.max(16, t.grosor * 5)}px Manrope, sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillText(t.texto ?? '', p[0], p[1]);
    } else if (p.length >= 6) {
      const [x1, y1, , x2, y2] = p;
      ctx.beginPath();
      if (t.tipo === 'rect') ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      else if (t.tipo === 'elipse') {
        ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        if (t.tipo === 'flecha') {
          const a = Math.atan2(y2 - y1, x2 - x1);
          const l = 14 + t.grosor * 2;
          ctx.beginPath();
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - l * Math.cos(a - 0.45), y2 - l * Math.sin(a - 0.45));
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - l * Math.cos(a + 0.45), y2 - l * Math.sin(a + 0.45));
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }
}
