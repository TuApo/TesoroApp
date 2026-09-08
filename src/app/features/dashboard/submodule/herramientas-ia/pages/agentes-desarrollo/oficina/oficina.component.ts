import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnDestroy, PLATFORM_ID,
  computed, effect, inject, input, output, signal, viewChild,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { catchError, of } from 'rxjs';

import type { Catalogo, EstadoAgentes, Tarea } from '../../../service/agentes.service';
import { ConocimientoService, DocDto } from '../../../service/conocimiento.service';
import { construirPlano, estadoVivo } from './oficina-plano';
import type { PlanoOficina } from './oficina-plano';
import type { Calidad, OficinaEscena } from './oficina-escena';

/**
 * La oficina: los 81 agentes del pool sentados en su sitio, trabajando cuando
 * hay tarea de verdad.
 *
 * No sondea nada. El panel padre ya consulta /ia/agentes/estado cada 3 s y le
 * pasa el resultado por `input`; aqui solo se pinta. Lo unico propio es la
 * lista de documentos del modulo Conocimiento, que se pide una vez porque el
 * cerebro del centro es ese grafo.
 *
 * three.js entra por `import()` dinamico: son ~600 KB que no tienen por que
 * caer en el bundle de nadie que no abra esta pestaña.
 */
@Component({
  selector: 'app-oficina',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatTooltipModule, MatMenuModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './oficina.component.html',
  styleUrls: ['./oficina.component.css'],
})
export class OficinaComponent implements OnDestroy {
  private readonly kb = inject(ConocimientoService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly esNavegador = isPlatformBrowser(inject(PLATFORM_ID));

  // ── Entradas y salidas ────────────────────────────────────────────────────

  readonly catalogo = input<Catalogo | null>(null);
  readonly estado = input<EstadoAgentes | null>(null);
  /** Mientras la pestaña no este a la vista, la escena ni se monta. */
  readonly activa = input<boolean>(false);

  readonly agenteElegido = output<string>();
  readonly documentoElegido = output<{ id: number; nombre: string }>();

  // ── Estado de la vista ────────────────────────────────────────────────────

  readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('lienzo');
  readonly hudRef = viewChild<ElementRef<HTMLDivElement>>('hud');
  readonly cajaRef = viewChild<ElementRef<HTMLDivElement>>('caja');

  readonly montando = signal(false);
  readonly fallo = signal<string | null>(null);
  readonly deptoEnfocado = signal<string | null>(null);
  readonly calidad = signal<Calidad>('alta');
  readonly oscuro = signal(false);
  readonly docs = signal<DocDto[]>([]);
  readonly docsPedidos = signal(false);

  // ── Panel lateral ─────────────────────────────────────────────────────────

  readonly panelAbierto = signal(true);
  readonly panelPestana = signal<'ahora' | 'historico'>('ahora');
  readonly filtroTexto = signal('');
  readonly filtroEstado = signal<string>('');
  readonly filtroAgente = signal<string>('');

  private escena: OficinaEscena | null = null;
  private plano: PlanoOficina | null = null;
  private firmaPlano = '';

  readonly nombreDepto = computed(() => {
    const k = this.deptoEnfocado();
    if (!k) return null;
    if (k === 'cerebro') return 'CONOCIMIENTO';
    return this.plano?.deptos.find((d) => d.clave === k)?.nombre ?? k;
  });

  /** Un solo cruce por refresco: lo comparten la escena y los marcadores de arriba. */
  private readonly vivo = computed(() => estadoVivo(this.estado()));

  readonly resumen = computed(() => {
    const e = this.estado();
    if (!e) return null;
    const v = this.vivo();
    return {
      // Del cruce, no del contador del puente: si no, la cabecera diria "0
      // trabajando" mientras la oficina enseña gente tecleando (o al reves).
      trabajando: v.trabajando,
      cola: v.enCola,
      agentes: this.plano?.puestos.length ?? 0,
      deptos: this.plano?.deptos.length ?? 0,
      docs: this.docs().length,
    };
  });

  // ── Listas del panel ──────────────────────────────────────────────────────

  /**
   * Lo que esta pasando AHORA. En curso primero y despues la cola: es el orden en que
   * se mira, no el alfabetico.
   *
   * OJO: el estado sale de `tarea.estado`, no del array que la trae. El puente mete en
   * `enCurso[]` tareas todavia en `pendiente` y el panel enseñaria gente trabajando con
   * el pool parado.
   */
  readonly ahora = computed(() => {
    const e = this.estado();
    if (!e) return [] as Tarea[];
    const vistas = new Set<string>();
    const out: Tarea[] = [];
    for (const t of [...e.enCurso, ...e.cola]) {
      if (vistas.has(t.id)) continue;
      vistas.add(t.id);
      out.push(t);
    }
    const peso = (t: Tarea) => (t.estado === 'en_curso' || t.estado === 'asignada' ? 0 : 1);
    return out.sort((a, b) => peso(a) - peso(b) || b.creada - a.creada);
  });

  readonly historico = computed(() => this.estado()?.ultimas ?? []);

  /** Las claves que aparecen en pantalla, para poder filtrar por agente sin listar 81. */
  readonly agentesConTareas = computed(() => {
    const s = new Set<string>();
    for (const t of [...this.ahora(), ...this.historico()]) if (t.agente) s.add(t.agente);
    return [...s].sort();
  });

  readonly listaVisible = computed(() => {
    const base = this.panelPestana() === 'ahora' ? this.ahora() : this.historico();
    const q = this.filtroTexto().trim().toLowerCase();
    const est = this.filtroEstado();
    const ag = this.filtroAgente();
    return base.filter((t) => {
      if (est && t.estado !== est) return false;
      if (ag && t.agente !== ag) return false;
      if (!q) return true;
      return ((t.titulo ?? '') + ' ' + (t.objetivo ?? '') + ' ' + (t.agenteNombre ?? '')
        + ' ' + (t.agente ?? '')).toLowerCase().includes(q);
    });
  });

  readonly hayFiltro = computed(() =>
    !!(this.filtroTexto().trim() || this.filtroEstado() || this.filtroAgente()));

  /** Avisa si la oficina se quedo corta respecto al catalogo real. */
  readonly recortado = computed(() => {
    const total = this.catalogo()?.agentes.length ?? 0;
    const puestos = this.plano?.puestos.length ?? 0;
    return total > puestos ? total - puestos : 0;
  });

  constructor() {
    // Monta cuando la pestaña se abre por primera vez; despues solo pausa/reanuda.
    effect(() => {
      const activa = this.activa();
      if (!this.esNavegador) return;
      if (!activa) {
        this.escena?.pausar();
        return;
      }
      if (this.escena) {
        this.escena.reanudar();
        this.escena.redimensionar();
        return;
      }
      void this.montar();
    });

    // El plano se rehace solo si cambia de verdad: reconstruir son 81 escritorios
    // y ademas devuelve la camara a la vista general, asi que hacerlo por un
    // refresco cualquiera le movia el encuadre al usuario a media faena.
    effect(() => {
      const cat = this.catalogo();
      const docs = this.docs();
      const esc = this.escena;
      if (!esc || !cat) return;
      const firma = `${cat.agentes.length}|${cat.categorias.length}|${cat.generado}|${docs.length}`;
      if (firma === this.firmaPlano) return;
      this.firmaPlano = firma;
      this.plano = construirPlano(cat, docs);
      esc.construir(this.plano);
      esc.aplicar(this.vivo());
    });

    // Y el estado vivo, cada vez que el padre refresca.
    effect(() => {
      const v = this.vivo();
      this.escena?.aplicar(v);
    });

    this.destroyRef.onDestroy(() => this.desmontar());
  }

  ngOnDestroy(): void {
    this.desmontar();
  }

  // ── Montaje ───────────────────────────────────────────────────────────────

  private async montar(): Promise<void> {
    const canvas = this.canvasRef()?.nativeElement;
    const hud = this.hudRef()?.nativeElement;
    const caja = this.cajaRef()?.nativeElement;
    if (!canvas || !hud || !caja || this.montando()) return;

    this.montando.set(true);
    this.fallo.set(null);
    // Se piden ANTES del await: el GET tarda menos que el bundle de three, asi la
    // escena se construye ya con el cerebro puesto y no hay que rehacerla.
    this.pedirDocumentos();
    try {
      const { OficinaEscena: Escena } = await import('./oficina-escena');
      // La pestaña pudo cerrarse mientras cargaba el bundle de three.
      if (!this.activa()) {
        this.montando.set(false);
        return;
      }
      const esc = new Escena({
        canvas, hud, contenedor: caja,
        calidad: this.calidad(),
        onAgente: (clave) => this.agenteElegido.emit(clave),
        onDepto: (clave) => this.deptoEnfocado.set(clave),
        onDocumento: (id, nombre) => this.documentoElegido.emit({ id, nombre }),
      });
      this.escena = esc;

      const cat = this.catalogo();
      if (cat) {
        const docs = this.docs();
        this.firmaPlano = `${cat.agentes.length}|${cat.categorias.length}|${cat.generado}|${docs.length}`;
        this.plano = construirPlano(cat, docs);
        esc.construir(this.plano);
        esc.aplicar(this.vivo());
      }
      esc.arrancar();
      // El contenedor pudo medir 0 mientras cargaba el bundle (la pestaña estaba
      // oculta): se remide en el frame siguiente, ya con layout hecho.
      requestAnimationFrame(() => esc.redimensionar());
    } catch (e) {
      this.fallo.set(mensaje(e));
    } finally {
      this.montando.set(false);
    }
  }

  /** El cerebro del centro es el modulo Conocimiento. Si no responde, se queda vacio y ya. */
  private pedirDocumentos(): void {
    if (this.docsPedidos()) return;
    this.docsPedidos.set(true);
    this.kb
      .listarDocumentos()
      .pipe(catchError(() => of([] as DocDto[])))
      .subscribe((d) => this.docs.set(d));
  }

  private desmontar(): void {
    this.escena?.destruir();
    this.escena = null;
    this.firmaPlano = '';
  }

  // ── Controles ─────────────────────────────────────────────────────────────

  vistaGeneral(): void {
    this.escena?.vistaGeneral();
  }

  acercar(): void {
    this.escena?.paso(1.4);
  }

  alejar(): void {
    this.escena?.paso(1 / 1.4);
  }

  irA(clave: string): void {
    this.escena?.irAAgente(clave);
  }

  ponerCalidad(c: Calidad): void {
    this.calidad.set(c);
    this.escena?.cambiarCalidad(c);
  }

  alternarOscuro(): void {
    const v = !this.oscuro();
    this.oscuro.set(v);
    this.escena?.modoOscuro(v);
  }

  // ── Panel ─────────────────────────────────────────────────────────────────

  alternarPanel(): void {
    this.panelAbierto.set(!this.panelAbierto());
    // La escena mide su contenedor: sin esto se queda con el ancho viejo hasta que
    // alguien toque la ventana.
    requestAnimationFrame(() => this.escena?.redimensionar());
  }

  verPestanaPanel(p: 'ahora' | 'historico'): void {
    this.panelPestana.set(p);
    this.filtroEstado.set('');
  }

  limpiarFiltros(): void {
    this.filtroTexto.set('');
    this.filtroEstado.set('');
    this.filtroAgente.set('');
  }

  /** Clic en una tarea: lleva la camara a quien la hace y avisa al panel de arriba. */
  mirarTarea(t: Tarea): void {
    if (!t.agente) return;
    this.escena?.irAAgente(t.agente);
  }

  abrirTarea(t: Tarea): void {
    if (t.agente) this.agenteElegido.emit(t.agente);
  }

  etiquetaEstadoTarea(e: string): string {
    switch (e) {
      case 'en_curso': return 'trabajando';
      case 'asignada': return 'arrancando';
      case 'pendiente': return 'en cola';
      case 'ok': return 'hecha';
      case 'error': return 'falló';
      case 'limite': return 'tope de uso';
      case 'cancelada': return 'cancelada';
      case 'interrumpida': return 'incompleta';
      default: return e;
    }
  }

  /** Hace cuánto, en corto. Una fecha completa no cabe y tampoco se necesita. */
  hace(ms: number | undefined): string {
    if (!ms) return '';
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return `hace ${s}s`;
    if (s < 3600) return `hace ${Math.round(s / 60)}m`;
    if (s < 86400) return `hace ${Math.round(s / 3600)}h`;
    return `hace ${Math.round(s / 86400)}d`;
  }

  duracionCorta(ms: number | undefined): string {
    if (!ms) return '';
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  reintentar(): void {
    this.desmontar();
    void this.montar();
  }
}

function mensaje(e: unknown): string {
  if (e instanceof Error) return e.message;
  return 'No se pudo montar la oficina 3D.';
}
