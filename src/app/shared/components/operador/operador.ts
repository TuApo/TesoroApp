import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, PLATFORM_ID, computed, effect, inject, input, signal, untracked, viewChild,
} from '@angular/core';
import { DatePipe, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { filter, firstValueFrom, map } from 'rxjs';

import { NavegacionService } from '../../../core/services/navegacion.service';
import { OperadorService } from '../../../core/services/operador/operador.service';
import { HerramientasPantallaService } from '../../../core/services/operador/herramientas-pantalla.service';
import { Instantanea, LectorPantallaService } from '../../../core/services/operador/lector-pantalla.service';
import {
  AppOperador, Automatizacion, DestinoNavegacion, EstadoTarea, PersonaPlataforma, PrioridadTarea, TareaDesarrollo, TareaOperador, TipoTarea,
  VistaOperador,
} from '../../../core/services/operador/operador.modelos';
import { obtenerUsuarioActual } from '../../../core/utils/usuario-actual';
import { mensajeDeError } from '../../utils/mensaje-error';
import {
  ArchivoChat, ConversacionChat, MensajeChat, RUTA_BANDEJA_IA, etiquetaFormato, iconoArchivo, tamanoLegible,
} from '../chat-ia/chat-ia.modelos';
import { ChatIaService } from '../chat-ia/chat-ia.service';
import { GrabadoraVoz, ReproductorVoz, textoParaVoz } from '../chat-ia/chat-ia-voz';
import { archivosPegados, nombreAlSubir, reducirImagen, traeArchivos } from '../chat-ia/chat-ia-archivos';
import { MedidorMic } from './medidor-mic';
import { AvatarAgente } from '../avatar-agente/avatar-agente';
import { AvatarAgenteService } from '../avatar-agente/avatar-agente.service';
import { RespuestaAvatares } from '../avatar-agente/respuesta-avatares';
import { EscuchaAtenta } from './escucha-atenta';
import { VentanaFlotante } from './operador-ventana';

/** ms-ai responde los errores del chat y del operador como {mensaje}: ese texto se muestra tal cual. */
function textoError(e: unknown, respaldo: string): string {
  const m = (e as { error?: { mensaje?: unknown } })?.error?.mensaje;
  return typeof m === 'string' && m.trim() ? m : mensajeDeError(e, respaldo);
}

type Pestana = 'conversar' | 'documentos' | 'tareas' | 'automatizaciones' | 'desarrollo';

/** Lo que la IA está haciendo (no solo pensando): se dice en voz alta mientras trabaja. */
const PROGRESO_ACCION = /^(Abriendo|Creando|Buscando|Programando|Ejecutando|Encargando|Generando|Exportando|Consultando)\b/;

/** Resultado de una automatización que corrió sola (gancho), para avisar junto al botón. */
interface AvisoGancho {
  titulo: string;
  texto: string;
  conversacionId: number | null;
  error: boolean;
}

/** Aviso tipo «notificación de mensaje» del modo agente: la IA generó un archivo o respondió. */
interface AvisoIa {
  clave: string;
  tipo: 'archivo' | 'respuesta';
  titulo: string;
  texto: string;
  icono: string;
  archivo: ArchivoChat | null;
  mensajeId: number;
  hora: number;
}

/** Herramienta de pantalla con consecuencias esperando el sí de la persona. */
interface ConfirmacionHerramienta {
  id: string;
  nombre: string;
  titulo: string;
  resumen: string;
  args: Record<string, unknown>;
  mensajeId: number;
  reloj: ReturnType<typeof setTimeout>;
}

/** Cómo terminó una herramienta de pantalla (chip «Hecho: …» en la burbuja). */
interface ResultadoChip {
  id: string;
  titulo: string;
  ok: boolean;
  error?: string;
  cancelada?: boolean;
  mensajeId: number;
}

/** El servidor espera 90 s; se cancela antes para que el turno no muera por tiempo. */
const CONFIRMACION_MS = 85_000;
const SI_CORTO = new Set(['si', 'confirmo', 'dale', 'hazlo', 'si confirmo', 'si dale', 'si hazlo', 'confirmado', 'si claro', 'claro que si']);
const NO_CORTO = new Set(['no', 'cancela', 'cancelar', 'espera', 'no gracias', 'no cancela', 'detente', 'mejor no']);

/** «Sí.», «¡Dale!», «no, cancela» → 'si' | 'no' | null. Solo respuestas cortas y exactas cuentan. */
function respuestaCorta(t: string): 'si' | 'no' | null {
  const x = t.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (SI_CORTO.has(x)) return 'si';
  if (NO_CORTO.has(x)) return 'no';
  return null;
}

/** Vistazo del chat sobre la cápsula, sin salir del modo agente. */
interface Vistazo {
  archivoId: string | null;
  mensajeId: number | null;
}

/** Cuánto queda desplegado un aviso antes de plegarse en el contador. */
const AVISO_VISIBLE_MS = 8000;
const MAX_AVISOS = 5;

/** Un archivo que se va a mandar con el próximo mensaje (pegado, arrastrado o elegido). */
interface Pendiente {
  clave: string;
  nombre: string;
  estado: 'SUBIENDO' | 'PENDIENTE' | 'LISTO' | 'ERROR';
  archivo?: ArchivoChat;
  error?: string;
  vista?: string;
}

/** Reconocimiento de voz del navegador (Chrome/Edge/Safari); no viene tipado en lib.dom. */
interface Reconocedor {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

/** Un gancho al abrir pantalla no se repite antes de esto en la misma pestaña (el servidor también filtra). */
const PAUSA_GANCHO_RUTA_MS = 30 * 60_000;
const MAX_ADJUNTOS = 6;
const RUTA_AUTOMATIZACIONES = '/dashboard/herramientas-ia/automatizaciones';
const RUTA_MIS_TAREAS = '/dashboard/tareas/mis-tareas';

/**
 * Asistente operador: se habla o se escribe y opera la plataforma con los permisos de quien lo
 * usa. Lleva a las pantallas, consulta datos, genera archivos, crea tareas con responsable,
 * automatizaciones (por horario o como ganchos al entrar o al abrir una pantalla) y, solo para
 * administración con el modo encendido a mano, encarga cambios de código a los agentes.
 *
 * <p>Es una ventana flotante que se mueve y se redimensiona, se acopla a la derecha (modo chat),
 * se encoge a una cápsula de voz mientras opera (para no tapar la pantalla) o se minimiza en la
 * pestaña «IA» del dock de chat (en EconomiAPP, en su orbe). La conversación es la del chat
 * estándar (`/api/v1/ai/chat`, módulo 'operador') y queda en la bandeja de Conversaciones IA.
 */
@Component({
  selector: 'app-operador',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe, RouterLink, MatIconModule, MatTooltipModule, AvatarAgente, RespuestaAvatares],
  templateUrl: './operador.html',
  styleUrl: './operador.css',
  host: { '[class.eco]': "app() === 'economiapp'" },
})
export class OperadorComponent {
  readonly app = input<AppOperador>('tesoro');

  readonly op = inject(OperadorService);
  private chat = inject(ChatIaService);
  private hp = inject(HerramientasPantallaService);
  private lector = inject(LectorPantallaService);
  private router = inject(Router);
  private navegacion = inject(NavegacionService);
  private destroyRef = inject(DestroyRef);
  private navegador = isPlatformBrowser(inject(PLATFORM_ID));
  private avatares = inject(AvatarAgenteService);
  /** Avatar Agent: el director de la pantalla donde está la persona (el presidente fuera de un módulo). */
  private readonly rutaActual = toSignal(this.router.events.pipe(filter(e => e instanceof NavigationEnd),
    map(e => (e as NavigationEnd).urlAfterRedirects)), { initialValue: this.router.url });
  readonly director = computed(() => this.avatares.deRuta(this.rutaActual()));

  private lista = viewChild<ElementRef<HTMLElement>>('lista');
  private entrada = viewChild<ElementRef<HTMLTextAreaElement>>('entrada');
  private selectorArchivo = viewChild<ElementRef<HTMLInputElement>>('selectorArchivo');

  readonly usuario = obtenerUsuarioActual();
  readonly perfil = this.op.perfil;
  readonly visible = computed(() => !!this.perfil());
  readonly pestana = signal<Pestana>('conversar');
  readonly aviso = signal<string | null>(null);

  // ── Ventana ──
  readonly ventana = new VentanaFlotante();
  readonly vista = this.op.vista;
  readonly celular = signal(false);
  /** A dónde vuelve la cápsula al expandirla. */
  private vistaAnterior: VistaOperador = 'flotante';
  /** Orbe propio: solo cuando no está la pestaña «IA» del dock (EconomiAPP, o sin chat). */
  readonly conOrbe = computed(() => !this.op.anclaEnDock());

  // ── Conversación ──
  readonly conversacionId = signal<number | null>(null);
  readonly mensajes = signal<MensajeChat[]>([]);
  readonly texto = signal('');
  readonly enviando = signal(false);
  readonly cargandoConversacion = signal(false);
  readonly ocupado = computed(() => this.enviando() || this.mensajes().some(m => m.estado === 'PENDIENTE'));
  readonly recientes = signal<ConversacionChat[]>([]);
  readonly verRecientes = signal(false);
  private cargadaId: number | null = null;
  private vigilando = false;
  private destruido = false;
  /** Acciones ya ejecutadas, por mensaje e índice (`id:i`): llegan mientras la IA trabaja y no se repiten. */
  private accionesHechas = new Set<string>();
  /** Último progreso que se dijo en voz alta por mensaje. */
  private progresoDicho = new Map<number, string>();
  private vozProgreso: SpeechSynthesisUtterance | null = null;

  // ── Personalidad (estilo de respuesta de esta conversación) ──
  readonly estilo = signal('auto');
  readonly verEstilos = signal(false);
  readonly catalogo = this.op.personalidades;
  readonly rutaPersonalidades = '/dashboard/herramientas-ia/personalidades';
  readonly personalidadActual = computed(() => {
    const c = this.catalogo();
    const k = this.estilo();
    return [...(c?.predefinidas ?? []), ...(c?.propias ?? [])].find(p => p.clave === k) ?? null;
  });
  readonly etiquetaEstilo = computed(() => this.personalidadActual()?.nombre
    ?? ({ auto: 'Automática', directa: 'Directa', analitica: 'Analítica', ejecutiva: 'Ejecutiva', didactica: 'Didáctica', conversacional: 'Conversacional' } as Record<string, string>)[this.estilo()]
    ?? 'Personalizada');

  // ── Transcripción (cápsula de voz) y documentos de la conversación ──
  readonly verTranscripcion = signal(false);
  private transcripcionEl = viewChild<ElementRef<HTMLElement>>('panelTranscripcion');
  readonly transcripcion = computed(() => this.mensajes()
    .filter(m => m.rol === 'user' || m.estado !== 'ERROR')
    .slice(-30)
    .map(m => ({
      id: m.id,
      yo: m.rol === 'user',
      texto: m.estado === 'PENDIENTE' ? (this.narraciones(m).at(-1) || m.progreso || 'Pensando…')
        : (m.rol === 'user' ? (m.contenido || 'Nota de voz') : textoParaVoz(m.contenido)).replace(/\s+/g, ' ').trim(),
      pendiente: m.estado === 'PENDIENTE',
    })));
  readonly documentos = computed(() => {
    const out: { archivo: ArchivoChat; generado: boolean; fecha: string | null }[] = [];
    for (const m of this.mensajes()) {
      for (const a of m.archivos ?? []) out.push({ archivo: a, generado: true, fecha: m.createdAt ?? null });
      for (const a of (m.adjuntos ?? []).filter(x => x.tipo !== 'AUDIO')) out.push({ archivo: a, generado: false, fecha: m.createdAt ?? null });
    }
    return out.reverse();
  });
  private leerAlTerminar = new Set<number>();
  /** La última respuesta llegó por voz: al navegar, la ventana pasa a cápsula. */
  private conversandoPorVoz = false;

  // ── Conversación fluida (iteración 4) ──
  /** Escucha a la persona mientras la IA habla: si la interrumpe, la oye primero a ella. */
  readonly atenta = new EscuchaAtenta();
  /** La IA está narrando lo que hace (acciones «decir», voz del navegador). */
  readonly narrando = signal(false);
  private narrado = new Set<string>();
  private colaNarracion: string[] = [];
  /** Respuestas que la persona interrumpió: terminan, sus acciones corren, pero no se leen. */
  private interrumpidos = new Set<number>();
  /** Texto de la respuesta que suena ahora (para distinguir su eco de la voz de la persona). */
  private textoSonando = '';
  readonly avisos = signal<AvisoIa[]>([]);
  readonly avisosPlegados = signal(false);

  // ── Herramientas de pantalla (estilo WebMCP) ──
  /** Acciones con consecuencias que esperan el sí de la persona (tarjeta en la burbuja y sobre la cápsula). */
  readonly confirmaciones = signal<ConfirmacionHerramienta[]>([]);
  /** Cómo terminó cada herramienta que pidió la IA. */
  readonly resultadosHerramientas = signal<ResultadoChip[]>([]);
  private herramientasAtendidas = new Set<string>();
  private relojAvisos: ReturnType<typeof setTimeout> | null = null;
  private notificados = new Set<string>();
  readonly vistazo = signal<Vistazo | null>(null);
  private vistazoEl = viewChild<ElementRef<HTMLElement>>('panelVistazo');
  /** El chat se está viendo: ventana en Conversar o el vistazo sobre la cápsula. */
  readonly chatVisible = computed(() => this.vistazo() !== null
    || (this.op.abierto() && this.vista() !== 'compacto' && this.pestana() === 'conversar'));
  readonly vistazoMensajes = computed(() => this.mensajes().slice(-20));

  // ── Adjuntos ──
  readonly pendientes = signal<Pendiente[]>([]);
  readonly soltando = signal(false);
  readonly subiendo = computed(() => this.pendientes().some(p => p.estado === 'SUBIENDO'));

  // ── Voz ──
  readonly grabadora = new GrabadoraVoz();
  readonly reproductor = new ReproductorVoz();
  readonly medidor = new MedidorMic();
  readonly reconocimiento = this.navegador && !!this.claseReconocedor();
  readonly puedeGrabar = this.navegador && (this.reconocimiento || GrabadoraVoz.soportada());
  readonly escuchando = signal(false);
  readonly parcial = signal('');
  readonly manosLibres = signal(false);
  /** El asistente recibe lo que se ve en pantalla en cada mensaje (la persona lo puede apagar). */
  readonly compartirPantalla = signal(true);
  /** Título de lo que el asistente está viendo (chip «Viendo: …»). */
  readonly viendo = computed(() => this.app() === 'economiapp' ? 'EconomiAPP' : this.navegacion.titulo());
  private reconocedor: Reconocedor | null = null;
  private relistarAlCallar = false;
  /** Nivel que mueve la onda: el micrófono mientras escucha o graba, la voz mientras habla. */
  readonly nivelVoz = computed(() => this.escuchando() ? this.medidor.nivel()
    : this.grabadora.grabando() ? this.grabadora.nivel() : this.reproductor.nivel());
  readonly estadoVoz = computed(() => this.escuchando() || this.grabadora.grabando() ? 'escuchando'
    : this.reproductor.sonando() !== null || this.narrando() ? 'hablando' : this.ocupado() ? 'pensando' : 'inactivo');
  /** Una línea para la cápsula: lo que se oye, lo que hace la IA o el comienzo de su última respuesta. */
  readonly lineaCapsula = computed(() => {
    if (this.escuchando() || this.grabadora.grabando()) return this.parcial() || 'Te escucho…';
    const pend = this.mensajes().find(m => m.estado === 'PENDIENTE');
    if (pend) return this.narraciones(pend).at(-1) || pend.progreso || 'Pensando…';
    const ultima = [...this.mensajes()].reverse().find(m => m.rol === 'assistant');
    if (!ultima) return 'Pulsa el micrófono y dime qué necesitas';
    if (ultima.estado === 'ERROR') return ultima.error || 'No se pudo completar.';
    const t = textoParaVoz(ultima.contenido).replace(/\s+/g, ' ').trim();
    return t.length > 140 ? t.slice(0, 140) + '…' : t;
  });

  // ── Tareas ──
  readonly tareas = signal<TareaOperador[]>([]);
  readonly totalTareas = signal(0);
  readonly filtroEstado = signal<EstadoTarea | ''>('PENDIENTE');
  readonly filtroTipo = signal<TipoTarea | ''>('');
  readonly cargandoTareas = signal(false);
  readonly nuevaTarea = signal('');
  readonly venceTarea = signal('');
  readonly prioridadTarea = signal<PrioridadTarea>('media');
  readonly responsable = signal<PersonaPlataforma | null>(null);
  readonly buscaResponsable = signal('');
  readonly opcionesResponsable = signal<PersonaPlataforma[]>([]);
  readonly guardandoTarea = signal(false);
  private relojBusqueda: ReturnType<typeof setTimeout> | null = null;
  readonly estadosTarea: EstadoTarea[] = ['PENDIENTE', 'EN_CURSO', 'HECHA', 'ERROR', 'CANCELADA'];
  readonly tiposTarea: TipoTarea[] = ['TAREA', 'RECORDATORIO', 'NAVEGACION', 'CONSULTA', 'DOCUMENTO', 'AUTOMATIZACION', 'DESARROLLO'];
  readonly nombresTipo: Record<TipoTarea, string> = {
    TAREA: 'Tarea', RECORDATORIO: 'Recordatorio', NAVEGACION: 'Navegación', CONSULTA: 'Consulta', DOCUMENTO: 'Documento',
    AUTOMATIZACION: 'Automatización', DESARROLLO: 'Desarrollo',
  };
  readonly nombresEstado: Record<EstadoTarea, string> = {
    PENDIENTE: 'Pendiente', EN_CURSO: 'En curso', HECHA: 'Hecha', ERROR: 'Con error', CANCELADA: 'Cancelada',
  };
  readonly rutaMisTareas = RUTA_MIS_TAREAS;

  // ── Automatizaciones ──
  readonly automatizaciones = signal<Automatizacion[]>([]);
  readonly cargandoAutos = signal(false);
  readonly rutaAutomatizaciones = RUTA_AUTOMATIZACIONES;

  // ── Desarrollo ──
  readonly tareasDev = signal<TareaDesarrollo[]>([]);
  readonly objetivoDev = signal('');
  readonly contextoDev = signal('');
  readonly cargandoDev = signal(false);
  readonly cambiandoModo = signal(false);
  private relojDev: ReturnType<typeof setInterval> | null = null;

  // ── Ganchos ──
  readonly avisoGancho = signal<AvisoGancho | null>(null);

  readonly destinos = signal<DestinoNavegacion[]>([]);
  readonly modoDev = computed(() => !!this.perfil()?.admin && !!this.perfil()?.modoDesarrollador);

  readonly primerNombre = computed(() => {
    const n = (this.usuario.nombreCompleto || '').split(' ')[0] ?? '';
    return n ? n.toLowerCase().replace(/^\p{L}/u, c => c.toUpperCase()) : '';
  });

  /** Sugerencias según dónde está y lo que puede abrir. */
  readonly sugerencias = computed(() => {
    const d = this.destinos();
    const s: string[] = ['¿Qué puedo hacer en esta pantalla?'];
    if (this.app() === 'economiapp') {
      s.push('Llévame a mis pedidos', '¿Cuánto cupo me queda?', 'Arma mi mercado de la semana');
    } else {
      const otros = d.filter(x => !x.ruta.startsWith('/economiapp')).slice(0, 2);
      for (const x of otros) s.push(`Llévame a ${x.nombre}`);
      s.push('Crea tareas: revisar el informe (yo) y llamar al proveedor (alta)');
      s.push('Hazme un informe en PDF con los indicadores del mes de mi área');
    }
    s.push('Cada lunes a las 8 a. m. recuérdame revisar mis pendientes');
    if (this.modoDev()) s.push('Modo desarrollador: ¿cómo van las tareas de los agentes?');
    return s.slice(0, 6);
  });

  iconoArchivo = iconoArchivo;
  etiquetaFormato = etiquetaFormato;
  tamanoLegible = tamanoLegible;

  constructor() {
    this.avatares.cargar();
    if (!this.navegador || !this.haySesion()) return;
    this.celular.set(this.esCelular());
    this.op.cargarPerfil().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: p => {
        this.op.perfil.set(p);
        this.destinos.set(this.op.destinos());
        this.compartirPantalla.set(this.preferenciaCompartir(p.usuarioId));
        const vista = this.ventana.cargar(p.usuarioId);
        if (vista) { this.op.vista.set(vista); this.vistaAnterior = vista; }
        let guardada: number | null = null;
        try { guardada = Number(localStorage.getItem(this.claveConversacion(p.usuarioId))) || null; } catch { /* opcional */ }
        this.conversacionId.set(guardada ?? p.conversacionId ?? null);
        let estilo: string | null = null;
        try { estilo = localStorage.getItem(this.claveEstilo(p.usuarioId)); } catch { /* opcional */ }
        this.estilo.set(estilo || p.personalidad || 'auto');
        this.cargarAutomatizaciones(true);
      },
      error: () => this.op.perfil.set(null), // sin operador: ni pestaña ni orbe
    });

    this.router.events.pipe(filter(e => e instanceof NavigationEnd), takeUntilDestroyed(this.destroyRef))
      .subscribe(e => this.ganchosDeRuta((e as NavigationEnd).urlAfterRedirects));

    // Al abrir: cargar la conversación y enfocar.
    effect(() => {
      const abierto = this.op.abierto();
      untracked(() => {
        if (abierto) {
          this.op.noLeidos.set(0);
          this.destinos.set(this.op.destinos());
          if (this.pestana() === 'conversar') this.cargarConversacion();
          if (this.vista() !== 'compacto') setTimeout(() => this.entrada()?.nativeElement.focus(), 120);
        } else {
          this.silenciar();
          this.verRecientes.set(false);
        }
      });
    });

    // La transcripción de la cápsula sigue la conversación.
    effect(() => {
      this.transcripcion();
      untracked(() => { if (this.verTranscripcion()) setTimeout(() => this.bajarTranscripcion(), 30); });
    });

    // La pestaña del dock y el orbe se animan con lo que hace la voz.
    effect(() => {
      const e = this.estadoVoz();
      untracked(() => this.op.estadoVoz.set(e));
    });

    // Otra pantalla pidió abrir una conversación (p. ej. resultados de una automatización).
    effect(() => {
      const id = this.op.conversacionPedida();
      if (id === null) return;
      untracked(() => {
        this.op.conversacionPedida.set(null);
        this.abrirConversacion(id);
      });
    });

    // Recordar cómo quedó la ventana (la cápsula no se recuerda: es para el momento).
    effect(() => {
      const v = this.vista();
      untracked(() => {
        if (v !== 'compacto') {
          this.vistaAnterior = v;
          this.ventana.guardar(v);
        }
      });
    });

    // Manos libres: cuando termina de hablar, vuelve a escuchar.
    effect(() => {
      const sonando = this.reproductor.sonando();
      untracked(() => {
        if (sonando === null && this.relistarAlCallar) {
          this.relistarAlCallar = false;
          if (this.manosLibres() && this.reconocimiento && this.op.abierto() && !this.escuchando() && !this.atenta.interrumpida()) {
            setTimeout(() => { if (!this.escuchando() && !this.atenta.interrumpida()) this.escuchar(); }, 150);
          }
        }
      });
    });

    // Escucha atenta: mientras la IA habla (respuesta o narración) y hay manos libres, se oye a la persona.
    effect(() => {
      const hablando = this.reproductor.sonando() !== null || this.narrando();
      const puede = this.manosLibres() && this.op.abierto() && !this.escuchando() && !this.grabadora.grabando();
      untracked(() => {
        if (hablando && puede && !this.atenta.activa()) this.iniciarEscuchaAtenta();
        else if ((!hablando || !this.manosLibres() || !this.op.abierto()) && this.atenta.activa() && !this.atenta.interrumpida()) this.atenta.detener();
      });
    });

    // Al ver el chat, los avisos ya no hacen falta.
    effect(() => {
      if (this.chatVisible() && this.op.abierto() && this.vista() !== 'compacto') untracked(() => this.limpiarAvisos());
    });

    this.destroyRef.onDestroy(() => {
      this.destruido = true;
      if (this.relojAvisos) clearTimeout(this.relojAvisos);
      for (const c of this.confirmaciones()) this.cancelarHerramienta(c, 'Se cerró la pantalla del asistente.');
      this.silenciar();
      this.pararRelojDev();
      this.op.estadoVoz.set('inactivo');
    });
  }

  @HostListener('document:keydown', ['$event'])
  atajo(e: KeyboardEvent): void {
    if (!this.visible()) return;
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'a' || e.key === 'A' || e.code === 'KeyA')) {
      e.preventDefault();
      this.op.alternar();
    } else if (e.key === 'Escape' && this.op.abierto()) {
      if (this.verRecientes()) this.verRecientes.set(false);
      else this.op.minimizar();
    }
  }

  @HostListener('window:resize')
  alCambiarTamano(): void {
    this.celular.set(this.esCelular());
    this.ventana.ajustar();
  }

  // ── Ventana ──────────────────────────────────────────────────────────────────────

  cambiarVista(v: VistaOperador): void {
    this.verRecientes.set(false);
    this.verEstilos.set(false);
    if (v === 'compacto') this.activarModoVoz();
    this.op.vista.set(v);
    if (v !== 'compacto') setTimeout(() => this.bajar(true), 60);
  }

  /** De la cápsula a la ventana completa (la última que usó). */
  expandir(): void {
    this.cambiarVista(this.vistaAnterior === 'compacto' ? 'flotante' : this.vistaAnterior);
  }

  alternarAcople(): void {
    this.cambiarVista(this.vista() === 'acoplado' ? 'flotante' : 'acoplado');
  }

  /** Cerrar: minimiza, apaga manos libres y deja la ventana lista para la próxima. */
  cerrarTodo(): void {
    this.manosLibres.set(false);
    if (this.vista() === 'compacto') this.op.vista.set(this.vistaAnterior);
    this.op.minimizar();
  }

  arrastrar(e: PointerEvent, modo: 'mover' | 'tamano'): void {
    if (this.celular() || this.vista() !== 'flotante') return;
    this.ventana.empezar(e, modo);
  }

  moverVentana(e: PointerEvent): void { this.ventana.mover(e); }

  soltarVentana(): void {
    if (this.ventana.terminar()) this.ventana.guardar(this.vista());
  }

  cambiarPestana(p: Pestana): void {
    this.pestana.set(p);
    this.aviso.set(null);
    this.verRecientes.set(false);
    this.pararRelojDev();
    if (p === 'conversar' || p === 'documentos') this.cargarConversacion();
    if (p === 'tareas') this.cargarTareas();
    if (p === 'automatizaciones') this.cargarAutomatizaciones(false);
    if (p === 'desarrollo' && this.modoDev()) {
      this.cargarDesarrollo();
      this.relojDev = setInterval(() => this.cargarDesarrollo(true), 15_000);
    }
  }

  // ── Conversación ─────────────────────────────────────────────────────────────────

  private async cargarConversacion(): Promise<void> {
    const id = this.conversacionId();
    if (!id || this.cargadaId === id) return;
    this.cargandoConversacion.set(true);
    try {
      const r = await firstValueFrom(this.chat.conversacion(id));
      this.cargadaId = id;
      // Las acciones de respuestas viejas no se vuelven a ejecutar al abrir.
      for (const m of r.mensajes) if (m.estado !== 'PENDIENTE') this.marcarAcciones(m);
      this.mensajes.set(r.mensajes);
      this.bajar(true);
      this.vigilar();
    } catch {
      // Conversación borrada o ajena: se empieza otra.
      this.nuevaConversacion();
    } finally {
      this.cargandoConversacion.set(false);
    }
  }

  abrirConversacion(id: number | null): void {
    if (!id) return;
    this.op.abrir();
    if (this.vista() === 'compacto') this.cambiarVista(this.vistaAnterior);
    this.pestana.set('conversar');
    this.verRecientes.set(false);
    this.fijarConversacion(id);
    this.cargadaId = null;
    this.mensajes.set([]);
    this.cargarConversacion();
  }

  nuevaConversacion(): void {
    this.reproductor.callar();
    this.fijarConversacion(null);
    this.cargadaId = null;
    this.mensajes.set([]);
    this.aviso.set(null);
    this.verRecientes.set(false);
  }

  /** Las conversaciones recientes con el asistente (también están en la bandeja de Conversaciones IA). */
  async alternarRecientes(): Promise<void> {
    if (this.verRecientes()) { this.verRecientes.set(false); return; }
    this.verRecientes.set(true);
    try {
      this.recientes.set(await firstValueFrom(this.chat.delModulo('operador')));
    } catch (e) {
      this.aviso.set(textoError(e, 'No se pudo cargar el historial.'));
    }
  }

  verHistorial(): void {
    this.verRecientes.set(false);
    const id = this.conversacionId();
    void this.router.navigate([RUTA_BANDEJA_IA], { queryParams: id ? { modulo: 'operador', c: id } : { modulo: 'operador' } });
    if (this.celular()) this.op.minimizar();
  }

  usarSugerencia(s: string): void {
    this.texto.set(s);
    this.enviar();
  }

  teclear(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      this.enviar();
    }
  }

  /** {@code forzar}: la persona interrumpió a la IA; se manda aunque la respuesta anterior siga en curso. */
  async enviar(viaVoz = false, audio?: ArchivoChat, forzar = false): Promise<void> {
    const texto = this.texto().trim();
    // Un «sí» / «no» corto mientras la IA espera confirmación responde esa confirmación, no es un mensaje nuevo.
    const conf = this.confirmaciones()[0];
    if (conf && texto && !audio) {
      const r = respuestaCorta(texto);
      if (r) {
        this.texto.set('');
        this.parcial.set('');
        if (r === 'si') this.confirmarHerramienta(conf);
        else this.cancelarHerramienta(conf, 'La persona dijo que no.');
        return;
      }
      // Cambió de tema: lo pendiente se cancela para que la IA atienda lo nuevo.
      for (const c of this.confirmaciones()) this.cancelarHerramienta(c, 'La persona cambió de tema sin confirmar.');
    }
    const listos = this.pendientes().filter(p => p.archivo && p.estado !== 'ERROR').map(p => p.archivo!.id);
    if (!texto && !audio && !listos.length) return;
    if (this.enviando() || (this.ocupado() && !forzar)) return;
    if (this.subiendo()) { this.aviso.set('Espera a que terminen de subir los archivos.'); return; }
    this.enviando.set(true);
    this.aviso.set(null);
    this.reproductor.callar();
    this.conversandoPorVoz = viaVoz;
    try {
      const r = await firstValueFrom(this.chat.enviar({
        conversacionId: this.conversacionId(),
        texto,
        adjuntos: audio ? [audio.id, ...listos] : listos,
        viaVoz,
        usuarioNombre: this.usuario.nombreCompleto || null,
        contexto: {
          modulo: 'operador',
          moduloNombre: 'Asistente operador',
          ruta: this.router.url,
          pantallaTitulo: this.app() === 'economiapp' ? 'EconomiAPP' : this.navegacion.titulo(),
          app: this.app(),
          modoDesarrollador: this.modoDev(),
          estilo: this.estilo(),
          navegacion: this.destinos(),
          // Herramientas que registró la pantalla abierta (filtrar, abrir, marcar…): la IA las usa aquí mismo.
          herramientasPantalla: this.hp.herramientas(),
          // Lo que la persona ve ahora: el asistente siempre tiene el contexto de la pantalla.
          pantalla: this.pantallaActual(),
        },
      }));
      this.texto.set('');
      this.parcial.set('');
      this.pendientes.set([]);
      this.cargadaId = r.conversacion.id;
      this.fijarConversacion(r.conversacion.id);
      this.mensajes.update(l => [...l, ...r.mensajes]);
      const asistente = r.mensajes.find(m => m.rol === 'assistant');
      if (asistente && viaVoz) this.leerAlTerminar.add(asistente.id);
      this.bajar(true);
      this.vigilar();
    } catch (e) {
      this.aviso.set(textoError(e, 'No se pudo enviar el mensaje.'));
    } finally {
      this.enviando.set(false);
    }
  }

  reintentar(m: MensajeChat): void {
    const i = this.mensajes().findIndex(x => x.id === m.id);
    const pregunta = [...this.mensajes().slice(0, i)].reverse().find(x => x.rol === 'user');
    if (pregunta?.contenido) {
      this.texto.set(pregunta.contenido);
      this.enviar();
    }
  }

  /** Consulta los mensajes en PENDIENTE hasta que terminen (la IA responde en segundo plano). */
  private async vigilar(): Promise<void> {
    if (this.vigilando) return;
    this.vigilando = true;
    try {
      while (!this.destruido) {
        const pendientes = this.mensajes().filter(m => m.estado === 'PENDIENTE');
        if (!pendientes.length) break;
        await new Promise(r => setTimeout(r, 1300));
        let termino = false;
        for (const p of pendientes) {
          try {
            const m = await firstValueFrom(this.chat.mensaje(p.id));
            this.mensajes.update(l => l.map(x => x.id === m.id ? m : x));
            // Lo que la IA ya hizo se ejecuta en la pantalla de una vez, aunque siga respondiendo.
            if (m.estado !== 'ERROR') this.ejecutarAcciones(m);
            if (m.estado === 'PENDIENTE') this.decirProgreso(m);
            else {
              termino = true;
              this.progresoDicho.delete(m.id);
              const interrumpido = this.interrumpidos.delete(m.id);
              if (interrumpido) this.leerAlTerminar.delete(m.id);
              if (m.estado === 'LISTO') {
                for (const a of m.archivos ?? []) this.avisarArchivo(a, m);
                if (!interrumpido) this.avisarRespuesta(m);
                if (!interrumpido && this.leerAlTerminar.delete(m.id)) this.hablar(m);
              }
            }
          } catch { /* se reintenta en la siguiente vuelta */ }
        }
        if (termino) await this.refrescar();
        this.bajar();
      }
    } finally {
      this.vigilando = false;
    }
  }

  /** Trae la conversación completa (la transcripción de la nota de voz queda como texto). */
  private async refrescar(): Promise<void> {
    const id = this.conversacionId();
    if (!id) return;
    try {
      const r = await firstValueFrom(this.chat.conversacion(id));
      if (this.conversacionId() !== id) return;
      this.mensajes.set(r.mensajes);
    } catch { /* la próxima consulta lo arregla */ }
  }

  /**
   * Lo que la respuesta pide a la pantalla: navegar y refrescar listas. Se llama en cada consulta
   * del mensaje (también mientras está PENDIENTE): cada acción nueva se ejecuta una sola vez.
   */
  private ejecutarAcciones(m: MensajeChat): void {
    let navego = false;
    (m.acciones ?? []).forEach((a, i) => {
      const clave = `${m.id}:${i}`;
      if (this.accionesHechas.has(clave)) return;
      this.accionesHechas.add(clave);
      if (a.tipo === 'navegar' && !navego && a.ruta?.startsWith('/')) {
        navego = true;
        this.irOperando(a.ruta);
      } else if (a.tipo === 'tareas_actualizadas') {
        if (this.pestana() === 'tareas') this.cargarTareas();
        else this.tareas.set([]);
      } else if (a.tipo === 'automatizaciones_actualizadas') {
        this.cargarAutomatizaciones(false);
      } else if (a.tipo === 'desarrollo' && this.modoDev()) {
        this.cargarDesarrollo(true);
      } else if (a.tipo === 'decir' && a.texto) {
        if (!this.interrumpidos.has(m.id)) this.narrar(a.texto, clave);
      } else if (a.tipo === 'archivo' && a.archivo) {
        this.avisarArchivo(a.archivo, m);
      } else if (a.tipo === 'herramienta') {
        this.atenderHerramienta(a, m);
      }
    });
  }

  // ── Herramientas de pantalla (estilo WebMCP) ──

  /**
   * La IA pide ejecutar una herramienta de la pantalla. `__listar` devuelve las de la pantalla
   * abierta; lo de solo lectura corre de una vez; lo demás espera el sí de la persona. Basta con
   * que la pantalla o el servidor pidan confirmar para pedirla.
   */
  private atenderHerramienta(a: NonNullable<MensajeChat['acciones']>[number], m: MensajeChat): void {
    const id = a.id ?? '';
    if (!/^[a-f0-9]{20}$/.test(id) || this.herramientasAtendidas.has(id)) return;
    this.herramientasAtendidas.add(id);
    const nombre = a.nombre ?? '';
    const titulo = a.titulo || nombre;
    const args = (a.args ?? {}) as Record<string, unknown>;
    if (nombre === '__listar') {
      void this.responderHerramienta(id, { ok: true, resultado: { herramientas: this.hp.herramientas(), pantalla: this.pantallaActual() } }, null);
      return;
    }
    if (nombre === '__pantalla') {
      void this.responderHerramienta(id, { ok: true, resultado: this.pantallaActual() }, null);
      return;
    }
    if (!this.hp.existe(nombre)) {
      void this.responderHerramienta(id, { ok: false, error: `Esta pantalla ya no ofrece «${titulo}» (la persona cambió de pantalla).` },
        { titulo, mensajeId: m.id });
      return;
    }
    if (a.confirmar || this.hp.pideConfirmacion(nombre)) this.pedirConfirmacion(id, nombre, titulo, args, m.id);
    else void this.correrHerramienta(id, nombre, titulo, args, m.id);
  }

  private pedirConfirmacion(id: string, nombre: string, titulo: string, args: Record<string, unknown>, mensajeId: number): void {
    const c: ConfirmacionHerramienta = {
      id, nombre, titulo, args, mensajeId, resumen: resumenArgs(args),
      reloj: setTimeout(() => {
        const sigue = this.confirmaciones().find(x => x.id === id);
        if (sigue) this.cancelarHerramienta(sigue, 'La persona no confirmó a tiempo.');
      }, CONFIRMACION_MS),
    };
    this.confirmaciones.update(l => [...l, c]);
    if (!this.op.abierto()) this.op.noLeidos.update(n => n + 1);
    if (this.conversandoPorVoz || this.manosLibres()) {
      this.narrar(`¿Confirmo: ${titulo}?`, `conf:${id}`);
      // Se escucha la respuesta: un «sí» o «no» corto la resuelve (ver enviar()).
      if (this.reconocimiento && this.manosLibres()) {
        void this.esperarNarracion(6000).then(() => {
          if (this.confirmaciones().some(x => x.id === id) && !this.escuchando() && this.op.abierto()) this.escuchar(true);
        });
      }
    }
  }

  confirmarHerramienta(c: ConfirmacionHerramienta): void {
    if (!this.confirmaciones().some(x => x.id === c.id)) return;
    clearTimeout(c.reloj);
    this.confirmaciones.update(l => l.filter(x => x.id !== c.id));
    void this.correrHerramienta(c.id, c.nombre, c.titulo, c.args, c.mensajeId);
  }

  cancelarHerramienta(c: ConfirmacionHerramienta, motivo = 'La persona canceló.'): void {
    if (!this.confirmaciones().some(x => x.id === c.id)) return;
    clearTimeout(c.reloj);
    this.confirmaciones.update(l => l.filter(x => x.id !== c.id));
    void this.responderHerramienta(c.id, { ok: false, cancelada: true, error: motivo }, { titulo: c.titulo, mensajeId: c.mensajeId });
  }

  confirmacionesDe(m: MensajeChat): ConfirmacionHerramienta[] {
    return this.confirmaciones().filter(c => c.mensajeId === m.id);
  }

  resultadosDe(m: MensajeChat): ResultadoChip[] {
    return this.resultadosHerramientas().filter(r => r.mensajeId === m.id);
  }

  private async correrHerramienta(id: string, nombre: string, titulo: string, args: Record<string, unknown>, mensajeId: number): Promise<void> {
    try {
      const res = await this.hp.ejecutar(nombre, args);
      await this.responderHerramienta(id, { ok: true, resultado: serializable(res) }, { titulo, mensajeId });
    } catch (e) {
      const error = e instanceof Error ? e.message : textoError(e, 'La pantalla no pudo hacerlo.');
      await this.responderHerramienta(id, { ok: false, error }, { titulo, mensajeId });
    }
  }

  /** Devuelve el resultado a ms-ai (el turno lo espera) y deja el chip en la burbuja. */
  private async responderHerramienta(id: string, r: { ok: boolean; resultado?: unknown; error?: string; cancelada?: boolean },
                                     chip: { titulo: string; mensajeId: number } | null): Promise<void> {
    if (chip) {
      this.resultadosHerramientas.update(l => [...l.filter(x => x.id !== id),
        { id, titulo: chip.titulo, ok: r.ok, error: r.error, cancelada: r.cancelada, mensajeId: chip.mensajeId }].slice(-40));
    }
    try {
      await firstValueFrom(this.op.responderHerramienta(id, r));
    } catch { /* el turno ya venció: la IA lo explica */ }
  }

  /** Lo que la IA anunció en este turno («Te llevo a nómina y reviso…»). */
  narraciones(m: MensajeChat): string[] {
    return (m.acciones ?? []).filter(a => a.tipo === 'decir' && a.texto).map(a => a.texto as string);
  }

  /** Archivos que la IA ya generó aunque la respuesta siga en curso. */
  archivosEnCurso(m: MensajeChat): ArchivoChat[] {
    return (m.acciones ?? []).filter(a => a.tipo === 'archivo' && a.archivo).map(a => a.archivo as ArchivoChat);
  }

  /**
   * Dice en voz alta (voz del navegador: es inmediata) el anuncio de la IA mientras actúa. Las
   * frases se encolan en orden; solo en conversación por voz o con manos libres.
   */
  private narrar(texto: string, clave: string): void {
    if (this.narrado.has(clave)) return;
    this.narrado.add(clave);
    if (!(this.conversandoPorVoz || this.manosLibres()) || this.escuchando() || this.atenta.interrumpida()) return;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const t = textoParaVoz(texto);
    if (!t) return;
    try {
      const sy = window.speechSynthesis;
      // Un progreso («Abriendo…») que suene se corta: la narración de la IA lo reemplaza.
      if (this.vozProgreso) { this.vozProgreso = null; sy.cancel(); }
      const u = new SpeechSynthesisUtterance(t);
      u.lang = 'es-CO';
      u.rate = 1.05;
      const v = sy.getVoices().find(x => x.lang?.toLowerCase().startsWith('es-co')) ?? sy.getVoices().find(x => x.lang?.toLowerCase().startsWith('es'));
      if (v) u.voice = v;
      this.colaNarracion.push(t);
      const fin = () => {
        this.colaNarracion = this.colaNarracion.filter(x => x !== t);
        if (!this.colaNarracion.length) this.narrando.set(false);
      };
      u.onend = fin;
      u.onerror = fin;
      this.narrando.set(true);
      sy.speak(u);
    } catch { this.narrando.set(false); }
  }

  /** Espera a que termine la narración en curso (para no pisarla con la respuesta final). */
  private esperarNarracion(topeMs = 9000): Promise<void> {
    if (!this.narrando()) return Promise.resolve();
    return new Promise(res => {
      const hasta = Date.now() + topeMs;
      const paso = () => (!this.narrando() || Date.now() > hasta || this.atenta.interrumpida()) ? res() : setTimeout(paso, 120);
      paso();
    });
  }

  private callarNarracion(): void {
    this.colaNarracion = [];
    if (this.narrando()) { try { window.speechSynthesis.cancel(); } catch { /* nada */ } }
    this.narrando.set(false);
  }

  // ── Interrupción (la persona habla mientras la IA habla) ──

  private iniciarEscuchaAtenta(): void {
    if (!this.atenta.disponible) return;
    void this.atenta.iniciar({
      Clase: this.claseReconocedor(),
      dicho: () => `${this.colaNarracion.join(' ')} ${this.textoSonando}`,
      nivelAsistente: () => this.reproductor.nivel(),
      alInterrumpir: () => this.interrumpirAsistente(),
      alParcial: t => this.parcial.set(t),
      alTerminar: t => this.alTerminarInterrupcion(t),
    });
  }

  /** Calla a la IA YA: la persona tiene la palabra. Lo que esté en curso termina sin leerse. */
  private interrumpirAsistente(): void {
    this.relistarAlCallar = false;
    this.callarNarracion();
    this.callarProgreso();
    this.reproductor.callar();
    this.textoSonando = '';
    for (const m of this.mensajes()) {
      if (m.estado === 'PENDIENTE') { this.interrumpidos.add(m.id); this.leerAlTerminar.delete(m.id); }
    }
    this.escuchando.set(true);
    this.parcial.set('');
  }

  private alTerminarInterrupcion(t: string): void {
    this.escuchando.set(false);
    this.parcial.set('');
    const dicho = t.trim();
    if (dicho) {
      this.texto.set(dicho);
      void this.enviar(true, undefined, true);
    } else if (!this.reconocimiento) {
      // APK: se detectó voz pero no hay reconocedor: lo que siga diciendo va como nota de voz.
      void this.grabarNota(true);
    } else if (this.manosLibres() && this.op.abierto()) {
      setTimeout(() => { if (!this.escuchando()) this.escuchar(true); }, 120);
    }
  }

  // ── Avisos del modo agente ──

  private avisarArchivo(a: ArchivoChat, m: MensajeChat): void {
    this.notificar({
      clave: `archivo:${a.id}`, tipo: 'archivo', titulo: 'La IA generó un archivo', texto: `«${a.nombre}»`,
      icono: iconoArchivo(a), archivo: a, mensajeId: m.id, hora: Date.now(),
    });
  }

  private avisarRespuesta(m: MensajeChat): void {
    const t = textoParaVoz(m.contenido).replace(/\s+/g, ' ').trim();
    if (!t) return;
    this.notificar({
      clave: `respuesta:${m.id}`, tipo: 'respuesta', titulo: 'Respuesta de la IA', texto: t.length > 120 ? t.slice(0, 120) + '…' : t,
      icono: 'chat', archivo: null, mensajeId: m.id, hora: Date.now(),
    });
  }

  /** Pestaña de aviso sobre la cápsula (o sobre la pestaña IA del dock): solo si el chat no se ve. */
  private notificar(a: AvisoIa): void {
    if (this.notificados.has(a.clave)) return;
    this.notificados.add(a.clave);
    if (this.chatVisible()) return;
    if (this.op.abierto() && this.vista() !== 'compacto') return; // la ventana muestra el chat u otra pestaña con contador
    this.avisos.update(l => [a, ...l.filter(x => x.clave !== a.clave)].slice(0, MAX_AVISOS));
    this.avisosPlegados.set(false);
    if (!this.op.abierto()) this.op.noLeidos.update(n => n + 1);
    if (this.relojAvisos) clearTimeout(this.relojAvisos);
    this.relojAvisos = setTimeout(() => this.avisosPlegados.set(true), AVISO_VISIBLE_MS);
  }

  cerrarAviso(a: AvisoIa, e?: Event): void {
    e?.stopPropagation();
    this.avisos.update(l => l.filter(x => x.clave !== a.clave));
  }

  limpiarAvisos(): void {
    this.avisos.set([]);
    this.avisosPlegados.set(false);
  }

  desplegarAvisos(): void {
    this.avisosPlegados.set(false);
    if (this.relojAvisos) clearTimeout(this.relojAvisos);
    this.relojAvisos = setTimeout(() => this.avisosPlegados.set(true), AVISO_VISIBLE_MS);
  }

  /**
   * Abre el vistazo del chat sobre la cápsula SIN salir del modo agente: la cápsula, la escucha y
   * manos libres siguen activos. Desde minimizado, el asistente vuelve como cápsula.
   */
  abrirVistazo(a: AvisoIa): void {
    this.cerrarAviso(a);
    if (!this.op.abierto()) this.op.abrir('compacto');
    else if (this.vista() !== 'compacto') this.op.vista.set('compacto');
    this.verTranscripcion.set(false);
    this.vistazo.set({ archivoId: a.archivo?.id ?? null, mensajeId: a.mensajeId });
    if (!this.mensajes().some(m => m.id === a.mensajeId)) void this.refrescar();
    setTimeout(() => this.enfocarVistazo(), 60);
  }

  cerrarVistazo(): void { this.vistazo.set(null); }

  private enfocarVistazo(): void {
    const el = this.vistazoEl()?.nativeElement;
    if (!el) return;
    const destacado = el.querySelector('.destacado') as HTMLElement | null;
    if (destacado) destacado.scrollIntoView({ block: 'center', behavior: 'smooth' });
    else el.scrollTop = el.scrollHeight;
  }

  /** Las acciones de un mensaje ya terminado no se vuelven a ejecutar (al abrir una conversación vieja). */
  private marcarAcciones(m: MensajeChat): void {
    (m.acciones ?? []).forEach((_, i) => this.accionesHechas.add(`${m.id}:${i}`));
  }

  /** En voz, lo que la IA va haciendo se dice corto («Abriendo Nómina…») mientras trabaja. */
  private decirProgreso(m: MensajeChat): void {
    const t = (m.progreso || '').trim();
    if (!t || !PROGRESO_ACCION.test(t) || this.progresoDicho.get(m.id) === t) return;
    // Si la IA ya narró lo que hace, su frase vale más que el progreso genérico.
    if (this.narraciones(m).length || this.narrando()) { this.progresoDicho.set(m.id, t); return; }
    this.progresoDicho.set(m.id, t);
    if (!(this.conversandoPorVoz || this.manosLibres()) || this.reproductor.sonando() !== null || this.escuchando() || this.atenta.interrumpida()) return;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(t.replace(/…$/, ''));
      u.lang = 'es-CO';
      u.rate = 1.1;
      this.vozProgreso = u;
      u.onend = () => { if (this.vozProgreso === u) this.vozProgreso = null; };
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch { /* sin voz del navegador */ }
  }

  private callarProgreso(): void {
    if (!this.vozProgreso) return;
    this.vozProgreso = null;
    try { window.speechSynthesis.cancel(); } catch { /* nada */ }
  }

  // ── Personalidad ─────────────────────────────────────────────────────────────────

  async alternarEstilos(): Promise<void> {
    this.verEstilos.update(v => !v);
    if (this.verEstilos() && !this.catalogo()) await this.cargarCatalogo();
  }

  private async cargarCatalogo(): Promise<void> {
    try {
      this.op.personalidades.set(await firstValueFrom(this.op.catalogoPersonalidades()));
    } catch (e) {
      this.aviso.set(textoError(e, 'No se pudieron cargar las personalidades.'));
    }
  }

  /** Estilo de respuesta para ESTA conversación (se recuerda en este equipo). */
  elegirEstilo(clave: string): void {
    this.estilo.set(clave);
    this.verEstilos.set(false);
    const p = this.perfil();
    if (p) { try { localStorage.setItem(this.claveEstilo(p.usuarioId), clave); } catch { /* opcional */ } }
  }

  /** Deja el estilo elegido como el de siempre (también en otros equipos y en las automatizaciones). */
  async usarSiempre(): Promise<void> {
    try {
      const r = await firstValueFrom(this.op.activarPersonalidad(this.estilo()));
      const p = this.perfil();
      if (p) this.op.perfil.set({ ...p, personalidad: r.activa });
      this.verEstilos.set(false);
      this.aviso.set(`«${this.etiquetaEstilo()}» quedó como tu estilo por defecto.`);
    } catch (e) {
      this.aviso.set(textoError(e, 'No se pudo guardar.'));
    }
  }

  irAPersonalidades(): void {
    this.verEstilos.set(false);
    void this.router.navigateByUrl(this.rutaPersonalidades);
    if (this.celular()) this.op.minimizar();
  }

  private claveEstilo(usuarioId: string): string { return `op-estilo:${usuarioId}`; }

  // ── Transcripción ──

  alternarTranscripcion(): void {
    this.verTranscripcion.update(v => !v);
    if (this.verTranscripcion()) setTimeout(() => this.bajarTranscripcion(), 40);
  }

  private bajarTranscripcion(): void {
    const el = this.transcripcionEl()?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
  }

  /**
   * El asistente llevó a la persona a otra pantalla: para que se vea, la ventana pasa a cápsula
   * si se está hablando (o siempre en el celular, donde la ventana tapa todo).
   */
  private irOperando(ruta: string): void {
    if (this.router.url !== ruta) this.router.navigateByUrl(ruta).catch(() => undefined);
    if ((this.conversandoPorVoz || this.manosLibres() || this.celular()) && this.vista() !== 'compacto') this.cambiarVista('compacto');
  }

  /** Chips de navegación y enlaces de una respuesta (los enlaces nunca navegan solos). */
  chips(m: MensajeChat): { ruta: string; etiqueta: string; enlace: boolean }[] {
    return (m.acciones ?? [])
      .filter(a => (a.tipo === 'navegar' || a.tipo === 'enlace') && !!a.ruta && a.ruta.startsWith('/'))
      .map(a => ({ ruta: a.ruta!, etiqueta: a.etiqueta || this.nombreDeRuta(a.ruta!), enlace: a.tipo === 'enlace' }));
  }

  /** Va a la ruta desde un chip; en el celular deja la cápsula para que se vea la pantalla. */
  ir(ruta: string): void {
    if (!ruta.startsWith('/')) return;
    if (this.router.url !== ruta) this.router.navigateByUrl(ruta).catch(() => undefined);
    if (this.celular()) this.cambiarVista('compacto');
  }

  private nombreDeRuta(ruta: string): string {
    const base = ruta.split('?')[0];
    return this.destinos().find(d => d.ruta === base)?.nombre ?? base;
  }

  async descargar(a: ArchivoChat): Promise<void> {
    try { await this.chat.descargar(a); } catch (e) { this.aviso.set(textoError(e, 'No se pudo descargar.')); }
  }

  /** Adjuntos de la persona que se muestran en su burbuja (la nota de voz no: ya es el texto). */
  adjuntosVisibles(m: MensajeChat): ArchivoChat[] {
    return (m.adjuntos ?? []).filter(a => a.tipo !== 'AUDIO');
  }

  // ── Adjuntos: pegar, arrastrar o elegir ─────────────────────────────────────────

  alPegar(e: ClipboardEvent): void {
    const archivos = archivosPegados(e);
    if (!archivos.length) return;
    e.preventDefault();
    this.agregarArchivos(archivos);
  }

  alArrastrar(e: DragEvent): void {
    if (!traeArchivos(e)) return;
    e.preventDefault();
    this.soltando.set(true);
  }

  alSalirArrastre(e: DragEvent): void {
    const dentro = (e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null);
    if (!dentro) this.soltando.set(false);
  }

  alSoltar(e: DragEvent): void {
    this.soltando.set(false);
    const archivos = Array.from(e.dataTransfer?.files ?? []);
    if (!archivos.length) return;
    e.preventDefault();
    if (this.pestana() !== 'conversar') this.cambiarPestana('conversar');
    this.agregarArchivos(archivos);
  }

  elegirArchivos(): void { this.selectorArchivo()?.nativeElement.click(); }

  alElegir(e: Event): void {
    const input = e.target as HTMLInputElement;
    this.agregarArchivos(Array.from(input.files ?? []));
    input.value = '';
  }

  quitarPendiente(p: Pendiente): void {
    if (p.vista) URL.revokeObjectURL(p.vista);
    this.pendientes.update(l => l.filter(x => x.clave !== p.clave));
  }

  private agregarArchivos(archivos: File[]): void {
    for (const f of archivos) {
      if (this.pendientes().length >= MAX_ADJUNTOS) { this.aviso.set(`Máximo ${MAX_ADJUNTOS} archivos por mensaje.`); break; }
      void this.subirUno(f);
    }
    setTimeout(() => this.entrada()?.nativeElement.focus(), 30);
  }

  private async subirUno(f: File): Promise<void> {
    const clave = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const vista = f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined;
    this.pendientes.update(l => [...l, { clave, nombre: f.name || 'archivo', estado: 'SUBIENDO', vista }]);
    const cambiar = (c: Partial<Pendiente>) => this.pendientes.update(l => l.map(p => p.clave === clave ? { ...p, ...c } : p));
    try {
      const blob = f.type.startsWith('image/') ? await reducirImagen(f) : f;
      let a = await firstValueFrom(this.chat.subir(blob, nombreAlSubir(f, blob), this.conversacionId()));
      cambiar({ archivo: a, nombre: a.nombre, estado: a.estado === 'ERROR' ? 'ERROR' : a.estado, error: a.error });
      if (a.estado === 'PENDIENTE') {
        a = await this.chat.esperarArchivo(a.id, 120_000, 1200);
        cambiar({ archivo: a, estado: a.estado, error: a.error });
      }
    } catch (e) {
      cambiar({ estado: 'ERROR', error: textoError(e, 'No se pudo subir.') });
    }
  }

  // ── Voz ──────────────────────────────────────────────────────────────────────────

  /** Botón del micrófono: escucha (reconocimiento del navegador) o graba una nota de voz. */
  async alternarVoz(): Promise<void> {
    if (this.escuchando()) { this.reconocedor?.stop(); return; }
    if (this.grabadora.grabando()) { this.grabadora.detener(false); return; }
    this.activarModoVoz();
    if (!this.puedeGrabar) { this.aviso.set('Este navegador no permite usar el micrófono.'); return; }
    if (this.reconocimiento) this.escuchar();
    else await this.grabarNota();
  }

  /** {@code forzar}: tras una interrupción se escucha aunque la respuesta anterior siga en curso. */
  escuchar(forzar = false): void {
    const Clase = this.claseReconocedor();
    if (!Clase || (this.ocupado() && !forzar)) return;
    this.atenta.detener();
    this.reproductor.callar();
    const rec = new Clase();
    rec.lang = 'es-CO';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let final = '';
    rec.onresult = e => {
      let provisional = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else provisional += r[0].transcript;
      }
      this.parcial.set((final + ' ' + provisional).trim());
    };
    rec.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.aviso.set('Permita el micrófono para hablar con el asistente.');
        this.manosLibres.set(false);
      } else if (e.error === 'network') {
        this.aviso.set('El reconocimiento de voz necesita internet.');
      }
    };
    rec.onend = () => {
      this.escuchando.set(false);
      this.medidor.detener();
      this.reconocedor = null;
      const dicho = (final || this.parcial()).trim();
      this.parcial.set('');
      if (dicho) {
        this.texto.set(dicho);
        this.enviar(true, undefined, forzar);
      }
    };
    try {
      rec.start();
      this.reconocedor = rec;
      this.escuchando.set(true);
      this.parcial.set('');
      void this.medidor.iniciar();
    } catch {
      this.aviso.set('No se pudo usar el micrófono.');
    }
  }

  /** Respaldo sin reconocimiento del navegador (p. ej. el APK): nota de voz que transcribe el servidor. */
  private async grabarNota(forzar = false): Promise<void> {
    this.reproductor.callar();
    this.atenta.detener();
    let fin: Promise<Blob | null>;
    try {
      fin = (await this.grabadora.iniciar()).fin;
    } catch (e: unknown) {
      const n = (e as { name?: string })?.name;
      this.aviso.set(n === 'NotAllowedError' ? 'Permita el micrófono para hablar con el asistente.' : 'No se pudo usar el micrófono.');
      return;
    }
    const audio = await fin;
    if (!audio) return;
    if (audio.size < 1500) { this.aviso.set('La nota de voz quedó muy corta.'); return; }
    const ext = audio.type.includes('mp4') ? 'm4a' : audio.type.includes('ogg') ? 'ogg' : 'webm';
    this.enviando.set(true);
    try {
      const a = await firstValueFrom(this.chat.subir(audio, `nota-de-voz.${ext}`, this.conversacionId()));
      this.enviando.set(false);
      await this.enviar(true, a, forzar);
    } catch (e) {
      this.enviando.set(false);
      this.aviso.set(textoError(e, 'No se pudo enviar la nota de voz.'));
    }
  }

  cancelarVoz(): void {
    this.atenta.detener();
    this.reconocedor?.abort();
    this.medidor.detener();
    this.grabadora.detener(true);
    this.escuchando.set(false);
    this.parcial.set('');
  }

  /** Lee una respuesta en voz alta: la voz del servidor y, si no hay, la del navegador. */
  async hablar(m: MensajeChat): Promise<void> {
    if (this.reproductor.sonando() === m.id) { this.reproductor.callar(); return; }
    await this.esperarNarracion();
    if (this.atenta.interrumpida() || this.interrumpidos.has(m.id)) return;
    this.callarProgreso();
    this.relistarAlCallar = this.manosLibres();
    this.textoSonando = textoParaVoz(m.contenido);
    try {
      if (!this.perfil()?.voz) throw new Error('sin voz');
      let a = await firstValueFrom(this.chat.voz(m.id));
      if (a.estado === 'PENDIENTE') a = await this.chat.esperarArchivo(a.id, 90_000, 700);
      if (a.estado !== 'LISTO') throw new Error(a.error || 'voz no disponible');
      const url = URL.createObjectURL(await firstValueFrom(this.chat.contenido(a.id)));
      setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
      if (!this.op.abierto()) return;
      await this.reproductor.reproducir(m.id, url);
    } catch {
      if (!this.reproductor.leerConNavegador(m.id, textoParaVoz(m.contenido))) this.relistarAlCallar = false;
    }
  }

  /**
   * Al entrar en modo voz, manos libres queda encendido salvo que la persona lo haya apagado
   * antes (esa preferencia se recuerda por usuario en este equipo).
   */
  private activarModoVoz(): void {
    if (!this.reconocimiento || this.manosLibres()) return;
    this.manosLibres.set(this.preferenciaManosLibres());
  }

  // ── Contexto de pantalla ──

  /** Lo que se ve ahora (o solo ruta y título si la persona apagó «compartir pantalla»). */
  private pantallaActual(): Instantanea {
    const r = this.compartirPantalla() ? this.lector.instantanea() : this.lector.basica();
    if (this.app() === 'economiapp' && (!r.titulo || r.titulo === 'Inicio')) r.titulo = 'EconomiAPP';
    return r;
  }

  alternarCompartirPantalla(): void {
    const v = !this.compartirPantalla();
    this.compartirPantalla.set(v);
    const p = this.perfil();
    if (p) { try { localStorage.setItem(`op-compartir-pantalla:${p.usuarioId}`, v ? '1' : '0'); } catch { /* opcional */ } }
  }

  private preferenciaCompartir(usuarioId: string): boolean {
    try { return localStorage.getItem(`op-compartir-pantalla:${usuarioId}`) !== '0'; } catch { return true; }
  }

  private preferenciaManosLibres(): boolean {
    const p = this.perfil();
    if (!p) return true;
    try { return localStorage.getItem(`op-manos-libres:${p.usuarioId}`) !== '0'; } catch { return true; }
  }

  alternarManosLibres(): void {
    const v = !this.manosLibres();
    this.manosLibres.set(v);
    const p = this.perfil();
    if (p) { try { localStorage.setItem(`op-manos-libres:${p.usuarioId}`, v ? '1' : '0'); } catch { /* opcional */ } }
    if (v && !this.escuchando() && !this.ocupado()) this.escuchar();
    if (!v) this.relistarAlCallar = false;
  }

  private silenciar(): void {
    this.relistarAlCallar = false;
    this.atenta.detener();
    this.callarNarracion();
    this.textoSonando = '';
    this.callarProgreso();
    this.reproductor.callar();
    this.reconocedor?.abort();
    this.reconocedor = null;
    this.medidor.detener();
    this.escuchando.set(false);
    if (this.grabadora.grabando()) this.grabadora.detener(true);
  }

  private claseReconocedor(): (new () => Reconocedor) | null {
    if (typeof window === 'undefined') return null;
    const w = window as unknown as { SpeechRecognition?: new () => Reconocedor; webkitSpeechRecognition?: new () => Reconocedor };
    return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
  }

  // ── Tareas ───────────────────────────────────────────────────────────────────────

  async cargarTareas(): Promise<void> {
    this.cargandoTareas.set(true);
    try {
      const r = await firstValueFrom(this.op.tareas({ estado: this.filtroEstado() || null, tipo: this.filtroTipo() || null, pagina: 0, tamano: 50 }));
      this.tareas.set(r.tareas);
      this.totalTareas.set(r.total);
    } catch (e) {
      this.aviso.set(textoError(e, 'No se pudieron cargar las tareas.'));
    } finally {
      this.cargandoTareas.set(false);
    }
  }

  /** Busca responsable mientras escribe (espera a que pare un momento). */
  buscarResponsable(q: string): void {
    this.buscaResponsable.set(q);
    if (this.relojBusqueda) clearTimeout(this.relojBusqueda);
    if (q.trim().length < 2) { this.opcionesResponsable.set([]); return; }
    this.relojBusqueda = setTimeout(async () => {
      try {
        const r = await firstValueFrom(this.op.personas(q.trim()));
        if (this.buscaResponsable() === q) this.opcionesResponsable.set(r);
      } catch { this.opcionesResponsable.set([]); }
    }, 300);
  }

  elegirResponsable(p: PersonaPlataforma | null): void {
    this.responsable.set(p);
    this.buscaResponsable.set('');
    this.opcionesResponsable.set([]);
  }

  async crearTarea(): Promise<void> {
    const titulo = this.nuevaTarea().trim();
    if (!titulo) return;
    const vence = this.venceTarea();
    const r = this.responsable();
    this.guardandoTarea.set(true);
    try {
      const t = await firstValueFrom(this.op.crearTarea({
        titulo,
        venceEn: vence ? new Date(vence).toISOString() : null,
        prioridad: this.prioridadTarea(),
        responsableId: r?.id ?? null,
        responsableNombre: r?.nombre ?? null,
      }));
      this.nuevaTarea.set('');
      this.venceTarea.set('');
      this.responsable.set(null);
      this.aviso.set(t.aviso ?? null);
      await this.cargarTareas();
    } catch (e) {
      this.aviso.set(textoError(e, 'No se pudo crear la tarea.'));
    } finally {
      this.guardandoTarea.set(false);
    }
  }

  async marcar(t: TareaOperador, estado: EstadoTarea): Promise<void> {
    try {
      const n = await firstValueFrom(this.op.cambiarTarea(t.id, estado));
      this.tareas.update(l => l.map(x => x.id === n.id ? n : x));
    } catch (e) {
      this.aviso.set(textoError(e, 'No se pudo actualizar la tarea.'));
    }
  }

  /** "Responsable: Ana Pérez\n…" → "Ana Pérez" (lo escribe el servidor al crear la tarea). */
  responsableDe(t: TareaOperador): string | null {
    const m = /^Responsable:\s*(.+)$/m.exec(t.detalle ?? '');
    return m ? m[1].trim() : null;
  }

  /** El detalle sin la línea del responsable (que va aparte). */
  detalleDe(t: TareaOperador): string | null {
    const d = (t.detalle ?? '').replace(/^Responsable:.*(\n|$)/m, '').trim();
    return d || null;
  }

  enTareas(t: TareaOperador): boolean {
    return !!t.referencia?.startsWith('card:');
  }

  iconoTarea(t: TipoTarea): string {
    return ({
      TAREA: 'assignment_ind', NAVEGACION: 'near_me', CONSULTA: 'query_stats', DOCUMENTO: 'description', RECORDATORIO: 'alarm',
      AUTOMATIZACION: 'bolt', DESARROLLO: 'code',
    } as Record<TipoTarea, string>)[t] ?? 'task_alt';
  }

  // ── Automatizaciones ─────────────────────────────────────────────────────────────

  async cargarAutomatizaciones(conGanchos: boolean): Promise<void> {
    this.cargandoAutos.set(true);
    try {
      this.automatizaciones.set(await firstValueFrom(this.op.automatizaciones()));
      if (conGanchos) {
        this.ganchosDeIngreso();
        this.ganchosDeRuta(this.router.url);
      }
    } catch (e) {
      if (!conGanchos) this.aviso.set(textoError(e, 'No se pudieron cargar las automatizaciones.'));
    } finally {
      this.cargandoAutos.set(false);
    }
  }

  async alternarAuto(a: Automatizacion): Promise<void> {
    try {
      const n = await firstValueFrom(this.op.cambiarAutomatizacion(a.id, { activa: !a.activa }));
      this.automatizaciones.update(l => l.map(x => x.id === n.id ? n : x));
    } catch (e) {
      this.aviso.set(textoError(e, 'No se pudo cambiar la automatización.'));
    }
  }

  /** Correr ahora: el resultado llega como respuesta en su conversación. */
  async ejecutarAhora(a: Automatizacion): Promise<void> {
    try {
      const r = await firstValueFrom(this.op.ejecutarAutomatizacion(a.id, this.router.url, true));
      if (r.omitida || !r.conversacionId) { this.aviso.set('No se ejecutó la automatización.'); return; }
      this.abrirConversacion(r.conversacionId);
    } catch (e) {
      this.aviso.set(textoError(e, 'No se pudo ejecutar.'));
    }
  }

  abrirModuloAutomatizaciones(): void {
    void this.router.navigateByUrl(RUTA_AUTOMATIZACIONES);
    if (this.celular() || this.vista() === 'acoplado') this.op.minimizar();
  }

  etiquetaDisparador(a: Automatizacion): string {
    switch (a.disparador) {
      case 'HORARIO': return a.descripcionHorario || 'Por horario';
      case 'AL_INGRESAR': return 'Al entrar a la plataforma';
      case 'AL_ABRIR_RUTA': return `Al abrir ${this.nombreDeRuta(a.ruta || '')}`;
      default: return 'Manual';
    }
  }

  // ── Ganchos ──────────────────────────────────────────────────────────────────────

  /** Las de "al entrar": una vez por sesión del navegador (el servidor además las corre una vez al día). */
  private ganchosDeIngreso(): void {
    const p = this.perfil();
    if (!p) return;
    const clave = `operador:ingreso:${p.usuarioId}`;
    try {
      if (sessionStorage.getItem(clave)) return;
      sessionStorage.setItem(clave, '1');
    } catch { /* sin storage: se corre igual */ }
    for (const a of this.automatizaciones()) if (a.activa && a.disparador === 'AL_INGRESAR') this.correrGancho(a, null);
  }

  private ganchosDeRuta(url: string): void {
    if (!this.perfil()) return;
    const destino = (url || '').split('?')[0].split('#')[0];
    for (const a of this.automatizaciones()) {
      if (!a.activa || a.disparador !== 'AL_ABRIR_RUTA' || !a.ruta) continue;
      const r = a.ruta.replace(/\/+$/, '');
      if (destino !== r && !destino.startsWith(r + '/')) continue;
      const clave = `${a.id}|${r}`;
      const antes = this.op.ganchosCorridos.get(clave) ?? 0;
      if (Date.now() - antes < PAUSA_GANCHO_RUTA_MS) continue;
      this.op.ganchosCorridos.set(clave, Date.now());
      this.correrGancho(a, destino);
    }
  }

  private async correrGancho(a: Automatizacion, ruta: string | null): Promise<void> {
    try {
      const r = await firstValueFrom(this.op.ejecutarAutomatizacion(a.id, ruta));
      if (r.omitida || !r.mensajeId) return;
      const fin = Date.now() + 3 * 60_000;
      let m = await firstValueFrom(this.chat.mensaje(r.mensajeId));
      while (m.estado === 'PENDIENTE' && Date.now() < fin && !this.destruido) {
        await new Promise(res => setTimeout(res, 2000));
        m = await firstValueFrom(this.chat.mensaje(r.mensajeId));
      }
      if (this.destruido || m.estado === 'PENDIENTE') return;
      const texto = m.estado === 'ERROR' ? (m.error || 'No se pudo completar.') : textoParaVoz(m.contenido);
      this.avisoGancho.set({
        titulo: a.nombre,
        texto: texto.length > 220 ? texto.slice(0, 220) + '…' : texto,
        conversacionId: r.conversacionId ?? null,
        error: m.estado === 'ERROR',
      });
      if (!this.op.abierto()) this.op.noLeidos.update(n => n + 1);
      if (this.pestana() === 'automatizaciones') this.cargarAutomatizaciones(false);
    } catch { /* un gancho que falla no debe molestar */ }
  }

  verAvisoGancho(): void {
    const g = this.avisoGancho();
    this.avisoGancho.set(null);
    this.op.noLeidos.set(0);
    if (g?.conversacionId) this.abrirConversacion(g.conversacionId);
    else this.op.abrir();
  }

  // ── Desarrollo ───────────────────────────────────────────────────────────────────

  async alternarModoDev(): Promise<void> {
    const p = this.perfil();
    if (!p?.admin) return;
    this.cambiandoModo.set(true);
    try {
      const n = await firstValueFrom(this.op.modoDesarrollador(!p.modoDesarrollador));
      this.op.perfil.set(n);
      this.pararRelojDev();
      if (n.modoDesarrollador) {
        this.cargarDesarrollo();
        this.relojDev = setInterval(() => this.cargarDesarrollo(true), 15_000);
      } else {
        this.tareasDev.set([]);
      }
    } catch (e) {
      this.aviso.set(textoError(e, 'No se pudo cambiar el modo desarrollador.'));
    } finally {
      this.cambiandoModo.set(false);
    }
  }

  async cargarDesarrollo(silencioso = false): Promise<void> {
    if (!this.modoDev()) return;
    if (!silencioso) this.cargandoDev.set(true);
    try {
      const r = await firstValueFrom(this.op.tareasDesarrollo());
      this.tareasDev.set(r.tareas ?? []);
    } catch (e) {
      if (!silencioso) this.aviso.set(textoError(e, 'No se pudieron cargar las tareas de los agentes.'));
    } finally {
      this.cargandoDev.set(false);
    }
  }

  async encargarDesarrollo(): Promise<void> {
    const objetivo = this.objetivoDev().trim();
    if (!objetivo) return;
    if (!confirm('Los agentes trabajarán sobre el código en una rama aparte (no despliegan). ¿Encargar?')) return;
    this.cargandoDev.set(true);
    try {
      await firstValueFrom(this.op.crearTareaDesarrollo(objetivo, this.contextoDev().trim() || `Pantalla actual: ${this.router.url}`));
      this.objetivoDev.set('');
      this.contextoDev.set('');
      await this.cargarDesarrollo(true);
    } catch (e) {
      this.aviso.set(textoError(e, 'No se pudo encargar la tarea.'));
    } finally {
      this.cargandoDev.set(false);
    }
  }

  async cancelarDev(t: TareaDesarrollo): Promise<void> {
    if (!confirm('¿Cancelar esta tarea de los agentes?')) return;
    try {
      await firstValueFrom(this.op.cancelarTareaDesarrollo(t.id));
      await this.cargarDesarrollo(true);
    } catch (e) {
      this.aviso.set(textoError(e, 'No se pudo cancelar.'));
    }
  }

  devViva(t: TareaDesarrollo): boolean {
    // ESTADOS_VIVOS del puente (bridge/src/almacen.js).
    return ['pendiente', 'asignada', 'en_curso'].includes(String(t.estado ?? '').toLowerCase());
  }

  private pararRelojDev(): void {
    if (this.relojDev) { clearInterval(this.relojDev); this.relojDev = null; }
  }

  // ── Utilidades ───────────────────────────────────────────────────────────────────

  private fijarConversacion(id: number | null): void {
    this.conversacionId.set(id);
    const p = this.perfil();
    if (!p) return;
    try {
      if (id) localStorage.setItem(this.claveConversacion(p.usuarioId), String(id));
      else localStorage.removeItem(this.claveConversacion(p.usuarioId));
    } catch { /* opcional */ }
  }

  private claveConversacion(usuarioId: string): string {
    return `operador:conversacion:${usuarioId}`;
  }

  private haySesion(): boolean {
    try {
      if (localStorage.getItem('token') || localStorage.getItem('Authorization')) return true;
      const u = JSON.parse(localStorage.getItem('user') || 'null');
      return !!(u?.token || u?.jwt || u?.access_token || u?.accessToken);
    } catch {
      return false;
    }
  }

  private esCelular(): boolean {
    return this.navegador && !!window.matchMedia?.('(max-width: 720px)').matches;
  }

  private bajar(forzar = false): void {
    setTimeout(() => {
      const el = this.lista()?.nativeElement;
      if (!el) return;
      const cerca = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
      if (forzar || cerca) el.scrollTop = el.scrollHeight;
    }, 30);
  }
}

/** Los argumentos de una herramienta en una línea legible: «estado: HECHA · tarea_id: 42». */
function resumenArgs(args: Record<string, unknown>): string {
  return Object.entries(args ?? {})
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ')
    .slice(0, 240);
}

/** Lo que devolvió la herramienta, apto para JSON (sin funciones ni ciclos). */
function serializable(v: unknown): unknown {
  if (v === undefined) return { ok: true };
  try { return JSON.parse(JSON.stringify(v)); } catch { return String(v); }
}
