import {
  ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, inject, input, model, output, signal, viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { TareasApiService } from '../../services/tareas-api.service';
import { TareasDialogosService } from '../../services/tareas-dialogos.service';
import { Adjunto, PropuestaTablero, Prioridad } from '../../models/tareas.models';
import { iconoArchivo, mensajeError, tamano } from '../../utils/tareas-ui';

/** Lo que la IA propone para el formulario de una tarea. */
export interface CamposIa {
  titulo?: string;
  descripcion?: string;
  pasos?: string[];
  prioridad?: Prioridad;
  dias?: number;
  inicio_dias?: number;
  responsable?: string;
}

export interface RespuestaIa {
  modo: 'chat_tarea' | 'chat_tablero';
  respuesta: string;
  preguntas: string[];
  faltantes?: string[];
  completitud: number;
  campos?: CamposIa;
  propuesta?: PropuestaTablero;
}

/** El formulario aplica lo que la IA propuso y dice qué cambió (y cómo deshacerlo). */
export type Aplicador = (r: RespuestaIa) => { aplicado: string[]; deshacer?: () => void };

interface Mensaje {
  id: number;
  rol: 'usuario' | 'asistente';
  texto: string;
  adjuntos?: Adjunto[];
  preguntas?: string[];
  faltantes?: string[];
  aplicado?: string[];
  deshacer?: () => void;
  deshecho?: boolean;
  error?: boolean;
}

/**
 * Chat de "Completar con IA" para el formulario de una tarea o el creador de tableros: la
 * persona escribe o pega lo que tiene, sube archivos (quedan con la tarea o el tablero) y la IA
 * va rellenando los campos, propone y pregunta lo que falta hasta dejarlo completo. Se pliega
 * y se despliega; en pantalla amplia se trabaja al lado del formulario.
 */
@Component({
  selector: 'app-asistente-ia',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatButtonModule, MatTooltipModule, MatProgressBarModule],
  templateUrl: './asistente-ia.component.html',
  styleUrls: ['./asistente-ia.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AsistenteIaComponent implements OnDestroy {
  private readonly api = inject(TareasApiService);
  private readonly dialogos = inject(TareasDialogosService);

  readonly modo = input<'tarea' | 'tablero'>('tarea');
  /** Foto del formulario (o de la propuesta) en el momento de enviar. */
  readonly estado = input.required<() => unknown>();
  readonly aplicador = input.required<Aplicador>();
  readonly area = input<string | null>(null);
  /** Archivos del formulario aún sin subir: la IA también los lee (hasta 25 MB en total por mensaje). */
  readonly archivosLocales = input<File[]>([]);
  readonly abierto = model(false);
  readonly amplio = model(false);
  /** Permite el modo lado a lado (solo en pantallas anchas). */
  readonly puedeAmpliar = input(true);
  /** Archivos subidos en el chat: el formulario los liga a la tarea o al tablero al crearlo. */
  readonly adjuntosCambio = output<Adjunto[]>();

  readonly mensajes = signal<Mensaje[]>([]);
  readonly adjuntos = signal<Adjunto[]>([]);
  readonly pendientes = signal<Adjunto[]>([]);
  readonly subiendo = signal(0);
  readonly pensando = signal(false);
  readonly segundos = signal(0);
  readonly completitud = signal<number | null>(null);
  readonly faltantes = signal<string[]>([]);
  texto = '';
  private idSec = 0;
  private reloj: ReturnType<typeof setInterval> | null = null;
  private cerrado = false;
  private readonly lista = viewChild<ElementRef<HTMLElement>>('lista');
  private readonly caja = viewChild<ElementRef<HTMLTextAreaElement>>('caja');

  readonly sugerencias = computed(() => this.modo() === 'tarea'
    ? ['Revisa lo que llevo y dime qué falta', 'Pega aquí el correo o la solicitud', 'Propón los pasos y el plazo']
    : ['Crea las columnas que necesita el proceso', 'Detalla más cada tarea con su checklist', 'Agrega una etapa de revisión y aprobación']);

  readonly estadoPensando = computed(() => {
    const s = this.segundos();
    const fases = this.modo() === 'tarea'
      ? ['Leyendo lo que escribiste', 'Revisando los archivos', 'Completando la tarea', 'Buscando lo que falta']
      : ['Leyendo el pedido y los archivos', 'Diseñando las columnas', 'Detallando las tareas', 'Revisando fechas y prioridades'];
    return fases[Math.min(fases.length - 1, Math.floor(s / 5))];
  });

  ngOnDestroy(): void {
    this.cerrado = true;
    if (this.reloj) clearInterval(this.reloj);
  }

  alternar(): void { this.abierto.set(!this.abierto()); if (this.abierto()) this.enfocar(); }

  usar(s: string): void {
    if (s.startsWith('Pega aquí')) { this.enfocar(); return; }
    this.texto = s;
    this.enviar();
  }

  responder(pregunta: string): void {
    this.texto = '';
    const c = this.caja()?.nativeElement;
    if (c) { c.placeholder = pregunta; c.focus(); }
  }

  async subir(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const archivos = Array.from(input.files ?? []);
    input.value = '';
    for (const f of archivos) {
      this.subiendo.update(n => n + 1);
      try {
        const a = await this.api.subirSuelto(f);
        this.pendientes.update(l => [...l, a]);
        this.adjuntos.update(l => [...l, a]);
        this.adjuntosCambio.emit(this.adjuntos());
      } catch (e) {
        this.agregar({ rol: 'asistente', texto: mensajeError(e, `No se pudo subir «${f.name}».`), error: true });
      } finally {
        this.subiendo.update(n => n - 1);
      }
    }
  }

  quitarPendiente(a: Adjunto): void {
    this.pendientes.update(l => l.filter(x => x.uuid !== a.uuid));
    this.adjuntos.update(l => l.filter(x => x.uuid !== a.uuid));
    this.adjuntosCambio.emit(this.adjuntos());
    this.api.eliminarAdjunto(a.uuid).catch(() => undefined);
  }

  verAdjunto(lista: Adjunto[], i: number): void {
    this.dialogos.verArchivos(lista.map(a => ({ nombre: a.original_name, mime: a.mime_type, tamano: a.size_bytes, uuid: a.uuid })), i);
  }

  teclear(ev: KeyboardEvent): void {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); this.enviar(); }
  }

  async enviar(): Promise<void> {
    if (this.pensando() || this.subiendo()) return;
    const texto = this.texto.trim();
    const nuevos = this.pendientes();
    const c = this.caja()?.nativeElement;
    const pregunta = c?.placeholder && !c.placeholder.startsWith('Escribe') ? c.placeholder : null;
    const mensaje = texto ? (pregunta ? `${pregunta}\n${texto}` : texto) : (nuevos.length ? 'Revisa estos archivos y completa con lo que encuentres.' : 'Revisa lo que llevo y dime qué falta.');
    if (c) c.placeholder = this.marcador();
    this.texto = '';
    this.pendientes.set([]);
    this.agregar({ rol: 'usuario', texto: texto || (nuevos.length ? '' : mensaje), adjuntos: nuevos });
    this.pensando.set(true);
    this.segundos.set(0);
    this.reloj = setInterval(() => this.segundos.update(s => s + 1), 1000);
    try {
      const historial = this.mensajes().slice(0, -1).filter(m => !m.error).map(m => ({ rol: m.rol, texto: m.texto }));
      const clave = this.modo() === 'tarea' ? 'formulario' : 'propuesta';
      const t = await this.api.iaGenerar('sugerir', {
        modo: this.modo() === 'tarea' ? 'chat_tarea' : 'chat_tablero',
        descripcion: JSON.stringify({ [clave]: this.estado()(), historial }),
        instruccion: mensaje,
        area: this.area() || undefined,
        adjuntos: this.adjuntos().map(a => a.uuid),
        archivos: this.localesQueCaben(),
      });
      const r = await this.api.esperarIa<RespuestaIa>(t.id, { maxSeg: 300, cancelado: () => this.cerrado });
      const { aplicado, deshacer } = this.aplicador()(r);
      this.completitud.set(r.completitud ?? null);
      this.faltantes.set(r.faltantes ?? []);
      this.agregar({ rol: 'asistente', texto: r.respuesta || 'Listo.', preguntas: r.preguntas, faltantes: r.faltantes, aplicado, deshacer });
    } catch (e: any) {
      if (e?.message === 'cancelado') return;
      this.agregar({ rol: 'asistente', texto: e instanceof Error ? e.message : mensajeError(e, 'La IA no pudo responder.'), error: true });
    } finally {
      if (this.reloj) clearInterval(this.reloj);
      this.reloj = null;
      this.pensando.set(false);
    }
  }

  deshacer(m: Mensaje): void {
    m.deshacer?.();
    this.mensajes.update(l => l.map(x => x.id === m.id ? { ...x, deshecho: true } : x));
  }

  marcador(): string {
    return this.modo() === 'tarea'
      ? 'Escribe, pega un correo o una solicitud, o adjunta archivos…'
      : 'Escribe cómo es el proceso, qué necesitas o adjunta documentos…';
  }

  private localesQueCaben(): File[] {
    let total = 0;
    return this.archivosLocales().filter(f => (total += f.size) <= 25 * 1024 * 1024);
  }

  private agregar(m: Omit<Mensaje, 'id'>): void {
    this.mensajes.update(l => [...l, { ...m, id: ++this.idSec }]);
    queueMicrotask(() => {
      const el = this.lista()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  private enfocar(): void { queueMicrotask(() => this.caja()?.nativeElement.focus()); }

  icono = iconoArchivo;
  tamano = tamano;
}
