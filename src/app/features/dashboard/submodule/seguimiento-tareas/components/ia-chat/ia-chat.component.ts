import {
  ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, computed, inject, input, output, signal, viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { filter, lastValueFrom } from 'rxjs';
import { TareasApiService } from '../../services/tareas-api.service';
import { EnjambreService, EstadoEnjambre, TareaEnjambre } from '../../services/enjambre.service';
import { TareasDialogosService } from '../../services/tareas-dialogos.service';
import { DirectorioService } from '../../services/directorio.service';
import { AmbitoChat, ChatMensaje, DocumentoChat } from '../../models/tareas.models';
import { hace, iconoArchivo, mensajeError, tamano } from '../../utils/tareas-ui';
import { TareaAvatarComponent } from '../avatar/avatar.component';

type Destino = 'ASISTENTE' | 'AGENTE';

const SUGERENCIAS: { texto: string; icono: string }[] = [
  { texto: 'Propón el plan para resolver esto, paso a paso', icono: 'route' },
  { texto: 'Arma un cuadro de control en Excel con lo que hay que hacer', icono: 'table_chart' },
  { texto: 'Redacta en Word el documento formal (acta, carta o informe) que se necesita', icono: 'description' },
  { texto: 'Crea una página HTML de resumen para compartir', icono: 'web' },
  { texto: 'Analiza los archivos adjuntos y dime qué encontraste', icono: 'plagiarism' },
];

const VIVOS = new Set(['pendiente', 'asignada', 'en_curso', 'interrumpida']);
const MAX_ADJUNTOS_AGENTE = 8 * 1024 * 1024;

/**
 * Chat de IA de una tarea o un ticket. La persona conversa sobre la solución y puede:
 *  - hablarle al Asistente IA: responde con el contexto del caso, lee los archivos que se
 *    suban (quedan en Archivos de la tarea) y genera documentos reales (Excel, Word, HTML,
 *    CSV...) que también quedan como archivos, con vista previa;
 *  - hablarle a los Agentes (solo administración): un encargo para RESOLVER el problema que
 *    sigue en la misma sesión con cada mensaje y que el puente retoma solo si se interrumpe.
 */
@Component({
  selector: 'app-ia-chat',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatButtonModule, MatTooltipModule, MatSnackBarModule, TareaAvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ia-chat.component.html',
  styleUrls: ['./ia-chat.component.css'],
})
export class IaChatComponent implements OnInit, OnDestroy {
  private readonly api = inject(TareasApiService);
  private readonly enjambre = inject(EnjambreService);
  private readonly dialogos = inject(TareasDialogosService);
  readonly dir = inject(DirectorioService);
  private readonly snack = inject(MatSnackBar);

  readonly ambito = input.required<AmbitoChat>();
  readonly ref = input.required<string | number>();
  /** Título del caso, para los encargos a los agentes. */
  readonly titulo = input('');
  /** Contexto del caso para los agentes (el asistente lo arma el servidor). */
  readonly contexto = input<() => string>(() => '');
  /** Si se pueden agregar pasos al checklist (solo tareas). */
  readonly puedeAplicar = input(false);
  /** Algo cambió en la tarea (documentos nuevos, pasos agregados): quien lo usa recarga. */
  readonly cambio = output<void>();

  readonly sugerencias = SUGERENCIAS;
  readonly hace = hace;
  readonly tamano = tamano;

  readonly mensajes = signal<ChatMensaje[]>([]);
  readonly cargando = signal(true);
  readonly disponible = signal(false);
  readonly estadoEnjambre = signal<EstadoEnjambre | null>(null);
  readonly destino = signal<Destino>('ASISTENTE');
  readonly archivos = signal<File[]>([]);
  readonly enviando = signal(false);
  readonly vivas = signal<Map<string, TareaEnjambre>>(new Map());
  texto = '';

  readonly lista = viewChild<ElementRef<HTMLElement>>('lista');
  private sondeo: ReturnType<typeof setInterval> | null = null;
  private ciclo = 0;
  private destruido = false;

  readonly agentesDisponibles = computed(() => !!this.estadoEnjambre());
  readonly hayAgentesListos = computed(() => (this.estadoEnjambre()?.pool.listas ?? 0) > 0);
  readonly pendientes = computed(() => this.mensajes().filter(m => m.estado === 'PENDIENTE'));

  async ngOnInit(): Promise<void> {
    this.dir.cargar();
    try {
      const e = await this.api.iaEstado();
      this.disponible.set(e.disponible);
      if (e.puede_usar_agentes && e.agentes_habilitados) {
        // ms-ai responde 403 a quien no es ADMIN: entonces no se ofrece "Agentes".
        this.estadoEnjambre.set(await this.enjambre.estado().catch(() => null));
      }
    } catch { /* sin IA: el chat queda en solo lectura */ }
    await this.cargar();
  }

  ngOnDestroy(): void {
    this.destruido = true;
    if (this.sondeo) clearInterval(this.sondeo);
  }

  async cargar(): Promise<void> {
    try {
      this.mensajes.set(await this.api.chat(this.ambito(), this.ref()));
      this.bajar();
      this.vigilar();
    } catch (e) {
      this.snack.open(mensajeError(e, 'No se pudo cargar el chat.'), 'Cerrar', { duration: 4000 });
    } finally {
      this.cargando.set(false);
    }
  }

  usar(s: string): void { this.texto = s; }

  elegirArchivos(ev: Event): void {
    const el = ev.target as HTMLInputElement;
    const nuevos = Array.from(el.files ?? []);
    const grandes = nuevos.filter(f => f.size > 100 * 1024 * 1024);
    if (grandes.length) this.snack.open(`Superan 100 MB: ${grandes.map(f => f.name).join(', ')}`, 'Cerrar', { duration: 4000 });
    this.archivos.update(l => [...l, ...nuevos.filter(f => f.size <= 100 * 1024 * 1024)].slice(0, 10));
    el.value = '';
  }
  quitarArchivo(i: number): void { this.archivos.update(l => l.filter((_, j) => j !== i)); }

  teclear(ev: KeyboardEvent): void {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); this.enviar(); }
  }

  async enviar(): Promise<void> {
    const texto = this.texto.trim();
    if ((!texto && !this.archivos().length) || this.enviando()) return;
    if (this.destino() === 'AGENTE' && !texto) { this.snack.open('Escríbele al agente qué debe resolver.', 'Cerrar', { duration: 3000 }); return; }
    this.enviando.set(true);
    const archivos = this.archivos();
    try {
      // Los archivos quedan en la tarea (o sueltos si es un ticket) y la IA los lee.
      const uuids: string[] = [];
      for (const f of archivos) {
        const destino = this.ambito() === 'tarea' ? { card: Number(this.ref()) } : {};
        const r = await lastValueFrom(this.api.subirConAvance(destino, f).pipe(filter(ev => ev.tipo === 'listo')));
        if (r.tipo === 'listo') uuids.push(r.adjunto.uuid);
      }
      if (archivos.length) this.cambio.emit();
      if (this.destino() === 'ASISTENTE') {
        const nuevos = await this.api.enviarChat(this.ambito(), this.ref(), texto, uuids);
        this.mensajes.update(l => [...l, ...nuevos]);
      } else {
        await this.aAgentes(texto, uuids, archivos);
      }
      this.texto = '';
      this.archivos.set([]);
      this.bajar();
      this.vigilar();
    } catch (e) {
      this.snack.open(mensajeError(e, 'No se pudo enviar.'), 'Cerrar', { duration: 5000 });
    } finally {
      this.enviando.set(false);
    }
  }

  /** Primer mensaje: encargo nuevo. Los siguientes: continuación en la misma sesión del agente. */
  private async aAgentes(texto: string, uuids: string[], archivos: File[]): Promise<void> {
    const adjuntos = await this.enBase64(archivos);
    const ultimo = [...this.mensajes()].reverse().find(m => m.rol === 'AGENTE' && m.referencia_externa);
    let tarea: TareaEnjambre | null = null;
    if (ultimo?.referencia_externa && ultimo.estado !== 'PENDIENTE') {
      tarea = await this.enjambre.continuar(ultimo.referencia_externa, { objetivo: texto, adjuntos }).catch(() => null);
    }
    if (!tarea) {
      const previo = ultimo?.contenido ? `\n\nLo que ya trabajó un agente antes en este caso:\n${ultimo.contenido.slice(0, 6000)}` : '';
      tarea = await this.enjambre.encargar({
        titulo: `${this.ambito() === 'tarea' ? 'Tarea' : 'Ticket'} · ${this.titulo()}`.slice(0, 140),
        objetivo: texto,
        contexto: this.contexto()() + previo
          + '\n\nTrabaja hasta dejarlo resuelto. Entrega en español: qué hiciste, qué quedó listo, dónde (commits, archivos) y qué necesita decisión humana. '
          + 'Nunca despliegues ni borres datos de producción.',
        adjuntos,
      });
    }
    const nuevos = await this.api.registrarAgenteChat(this.ambito(), this.ref(), texto, tarea.id, uuids);
    this.mensajes.update(l => [...l, ...nuevos]);
    this.vivas.update(m => new Map(m).set(tarea!.id, tarea!));
  }

  // ── Seguimiento de lo pendiente ──

  private vigilar(): void {
    if (this.pendientes().length && !this.sondeo) {
      this.sondeo = setInterval(() => this.revisar(), 2500);
    } else if (!this.pendientes().length && this.sondeo) {
      clearInterval(this.sondeo);
      this.sondeo = null;
    }
  }

  private async revisar(): Promise<void> {
    if (this.destruido) return;
    this.ciclo++;
    let cambio = false;
    for (const m of this.pendientes()) {
      try {
        if (m.rol === 'ASISTENTE') {
          const n = await this.api.chatMensaje(m.id);
          if (n.estado !== 'PENDIENTE') {
            this.reemplazar(n);
            cambio = cambio || n.documentos.length > 0;
          }
        } else if (m.rol === 'AGENTE' && m.referencia_externa && this.ciclo % 3 === 0) {
          await this.revisarAgente(m);
        }
      } catch { /* se reintenta en el próximo ciclo */ }
    }
    if (cambio) this.cambio.emit();
    this.vigilar();
    this.bajar();
  }

  /**
   * Un agente puede retomarse en otra tarea del mismo hilo (reanudación automática si se cayó
   * el servicio): se sigue siempre la ÚLTIMA del hilo, así no "para" a mitad.
   */
  private async revisarAgente(m: ChatMensaje): Promise<void> {
    const hilo = await this.enjambre.hilo(m.referencia_externa!).catch(() => [] as TareaEnjambre[]);
    const actual = hilo.length ? hilo[hilo.length - 1] : await this.enjambre.tarea(m.referencia_externa!);
    this.vivas.update(x => new Map(x).set(m.referencia_externa!, actual));
    if (VIVOS.has(actual.estado)) {
      if (actual.id !== m.referencia_externa) {
        this.reemplazar(await this.api.cerrarAgenteChat(m.id, { referencia: actual.id }));
      }
      return;
    }
    const ok = actual.estado === 'ok';
    const n = await this.api.cerrarAgenteChat(m.id, {
      estado: ok ? 'LISTO' : 'ERROR',
      contenido: actual.resumen || actual.error || (ok ? 'Terminó sin dejar resumen.' : `El agente terminó en estado «${actual.estado}».`),
      coste_usd: actual.costeUsd,
      referencia: actual.id,
    });
    this.reemplazar(n);
  }

  estadoAgente(m: ChatMensaje): string {
    const v = m.referencia_externa ? this.vivas().get(m.referencia_externa) : null;
    if (!v) return this.hayAgentesListos() ? 'En cola…' : 'En cola: los agentes no tienen sesión iniciada';
    return ({ pendiente: 'En cola…', asignada: 'Asignado, arrancando…', en_curso: 'Trabajando…', interrumpida: 'Se interrumpió: retomándose solo…' } as Record<string, string>)[v.estado]
      ?? v.estado;
  }

  // ── Documentos y acciones ──

  verDocs(docs: DocumentoChat[], i: number): void {
    this.dialogos.verArchivos(docs.map(d => ({ nombre: d.nombre, mime: null, tamano: d.tamano, uuid: d.uuid })), i);
  }

  verAdjuntos(m: ChatMensaje, i: number): void {
    this.dialogos.verArchivos(m.adjuntos.map(a => ({ nombre: a.nombre, mime: a.mime, tamano: a.tamano, uuid: a.uuid })), i);
  }

  async descargar(d: DocumentoChat): Promise<void> {
    try {
      const blob = await this.api.descargarAdjunto(d.uuid);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = d.nombre;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      this.snack.open(mensajeError(e, 'No se pudo descargar.'), 'Cerrar', { duration: 4000 });
    }
  }

  async agregarPasos(m: ChatMensaje): Promise<void> {
    const pasos = m.acciones?.pasos ?? [];
    if (!pasos.length || this.ambito() !== 'tarea') return;
    try {
      for (const p of pasos) await this.api.agregarItem(Number(this.ref()), p);
      this.snack.open(pasos.length === 1 ? 'Paso agregado al checklist' : `${pasos.length} pasos agregados al checklist`, undefined, { duration: 2500 });
      this.cambio.emit();
    } catch (e) {
      this.snack.open(mensajeError(e), 'Cerrar', { duration: 4000 });
    }
  }

  icono(d: { nombre: string }): string { return iconoArchivo(d.nombre, null); }
  autor(m: ChatMensaje): string { return m.autor_id ? this.dir.nombre(m.autor_id, m.autor_nombre || 'Tú') : (m.autor_nombre || 'Tú'); }

  // ── Utilidades ──

  private reemplazar(n: ChatMensaje): void { this.mensajes.update(l => l.map(x => x.id === n.id ? n : x)); }

  private bajar(): void {
    setTimeout(() => { const el = this.lista()?.nativeElement; if (el) el.scrollTop = el.scrollHeight; }, 30);
  }

  private async enBase64(archivos: File[]): Promise<{ nombre: string; contenidoBase64: string }[]> {
    const out: { nombre: string; contenidoBase64: string }[] = [];
    let total = 0;
    for (const f of archivos) {
      if (total + f.size > MAX_ADJUNTOS_AGENTE) continue;
      const b64 = await new Promise<string>((ok, mal) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result).split(',')[1] ?? '');
        r.onerror = () => mal(r.error);
        r.readAsDataURL(f);
      });
      out.push({ nombre: f.name, contenidoBase64: b64 });
      total += f.size;
    }
    return out;
  }
}
