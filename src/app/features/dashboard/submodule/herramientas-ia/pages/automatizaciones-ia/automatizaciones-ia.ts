import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import { OperadorService } from '../../../../../../core/services/operador/operador.service';
import {
  Automatizacion, DIAS_SEMANA, DestinoNavegacion, DiaSemana, Disparador, NuevaAutomatizacion, PlantillaAutomatizacion, TareaOperador,
} from '../../../../../../core/services/operador/operador.modelos';
import { mensajeDeError } from '../../../../../../shared/utils/mensaje-error';
import { RUTA_BANDEJA_IA } from '../../../../../../shared/components/chat-ia/chat-ia.modelos';

/** ms-ai responde los errores como {mensaje}: ese texto se muestra tal cual. */
function textoError(e: unknown, respaldo: string): string {
  const m = (e as { error?: { mensaje?: unknown } })?.error?.mensaje;
  return typeof m === 'string' && m.trim() ? m : mensajeDeError(e, respaldo);
}

const NOMBRES_DIA: Record<DiaSemana, string> = { LUN: 'L', MAR: 'M', MIE: 'X', JUE: 'J', VIE: 'V', SAB: 'S', DOM: 'D' };
const DIAS_CRON: Record<string, DiaSemana> = { MON: 'LUN', TUE: 'MAR', WED: 'MIE', THU: 'JUE', FRI: 'VIE', SAT: 'SAB', SUN: 'DOM' };

/** Lo que se edita en el diálogo (crear desde cero, desde plantilla o editar una existente). */
interface Borrador {
  id: number | null;
  nombre: string;
  instruccion: string;
  disparador: Disparador;
  hora: string;
  dias: DiaSemana[];
  ruta: string;
  plantilla: string | null;
}

/**
 * Herramientas IA › Automatizaciones IA: lo que el Asistente IA hace solo por cada persona, con
 * sus permisos — por horario, al entrar, al abrir una pantalla o a mano — y una galería de
 * plantillas listas para usar. Es de uso personal: ms-ai solo deja ver y tocar las propias.
 * El resultado de cada ejecución queda en una conversación del asistente (bandeja de Conversaciones IA).
 */
@Component({
  selector: 'app-automatizaciones-ia',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe, RouterLink, MatIconModule, MatTooltipModule],
  templateUrl: './automatizaciones-ia.html',
  styleUrl: './automatizaciones-ia.css',
})
export class AutomatizacionesIa implements OnInit {
  private op = inject(OperadorService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  readonly automatizaciones = signal<Automatizacion[]>([]);
  readonly plantillas = signal<PlantillaAutomatizacion[]>([]);
  readonly historial = signal<TareaOperador[]>([]);
  readonly destinos = signal<DestinoNavegacion[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);
  readonly categoria = signal<string | null>(null);
  readonly ocupadas = signal<Set<number>>(new Set());

  readonly borrador = signal<Borrador | null>(null);
  readonly guardando = signal(false);
  readonly diasSemana = DIAS_SEMANA;
  readonly nombresDia = NOMBRES_DIA;

  readonly activas = computed(() => this.automatizaciones().filter(a => a.activa).length);
  readonly ejecuciones = computed(() => this.automatizaciones().reduce((s, a) => s + (a.ejecuciones || 0), 0));

  /** Plantillas que le sirven a esta persona (las que piden una pantalla que no ve, no se ofrecen). */
  readonly plantillasVisibles = computed(() => {
    const rutas = this.destinos().map(d => d.ruta);
    return this.plantillas().filter(p => !p.requiere || rutas.some(r => r.startsWith(p.requiere) || p.requiere.startsWith(r + '/') || p.requiere === r));
  });
  readonly categorias = computed(() => [...new Set(this.plantillasVisibles().map(p => p.categoria))]);
  readonly plantillasFiltradas = computed(() => {
    const c = this.categoria();
    return c ? this.plantillasVisibles().filter(p => p.categoria === c) : this.plantillasVisibles();
  });

  ngOnInit(): void {
    this.destinos.set(this.op.destinos());
    void this.cargar();
    if (this.route.snapshot.queryParamMap.get('nueva')) this.nueva();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const [autos, plantillas, historial] = await Promise.all([
        firstValueFrom(this.op.automatizaciones()),
        firstValueFrom(this.op.plantillas()).catch(() => [] as PlantillaAutomatizacion[]),
        firstValueFrom(this.op.tareas({ tipo: 'AUTOMATIZACION', pagina: 0, tamano: 30 })).then(r => r.tareas).catch(() => [] as TareaOperador[]),
      ]);
      this.automatizaciones.set(autos);
      this.plantillas.set(plantillas);
      this.historial.set(historial);
    } catch (e) {
      this.error.set(textoError(e, 'No se pudieron cargar las automatizaciones.'));
    } finally {
      this.cargando.set(false);
    }
  }

  // ── Diálogo ──

  nueva(): void {
    this.borrador.set({ id: null, nombre: '', instruccion: '', disparador: 'HORARIO', hora: '08:00', dias: ['LUN', 'MAR', 'MIE', 'JUE', 'VIE'], ruta: '', plantilla: null });
  }

  usar(p: PlantillaAutomatizacion): void {
    this.borrador.set({
      id: null, nombre: p.nombre, instruccion: p.instruccion, disparador: p.disparador,
      hora: p.hora || '08:00', dias: p.dias?.length ? [...p.dias] : ['LUN', 'MAR', 'MIE', 'JUE', 'VIE'],
      ruta: p.ruta || '', plantilla: p.nombre,
    });
  }

  editar(a: Automatizacion): void {
    const { hora, dias } = this.horarioDe(a.cron);
    this.borrador.set({ id: a.id, nombre: a.nombre, instruccion: a.instruccion, disparador: a.disparador, hora, dias, ruta: a.ruta || '', plantilla: null });
  }

  cambiar<K extends keyof Borrador>(campo: K, valor: Borrador[K]): void {
    this.borrador.update(b => b ? { ...b, [campo]: valor } : b);
  }

  alternarDia(d: DiaSemana): void {
    this.borrador.update(b => {
      if (!b) return b;
      const dias = b.dias.includes(d) ? b.dias.filter(x => x !== d) : DIAS_SEMANA.filter(x => x === d || b.dias.includes(x));
      return { ...b, dias };
    });
  }

  async guardar(): Promise<void> {
    const b = this.borrador();
    if (!b) return;
    if (!b.nombre.trim() || !b.instruccion.trim()) { this.aviso.set('Ponga un nombre y diga qué debe hacer.'); return; }
    if (b.disparador === 'HORARIO' && (!b.hora || !b.dias.length)) { this.aviso.set('Elija la hora y al menos un día.'); return; }
    if (b.disparador === 'AL_ABRIR_RUTA' && !b.ruta) { this.aviso.set('Elija la pantalla.'); return; }
    const datos: NuevaAutomatizacion = {
      nombre: b.nombre.trim(), instruccion: b.instruccion.trim(), disparador: b.disparador,
      hora: b.disparador === 'HORARIO' ? b.hora : undefined,
      dias: b.disparador === 'HORARIO' ? b.dias : undefined,
      ruta: b.disparador === 'AL_ABRIR_RUTA' ? b.ruta : undefined,
    };
    this.guardando.set(true);
    try {
      if (b.id) {
        const { disparador: _d, ...cambios } = datos;
        void _d;
        const n = await firstValueFrom(this.op.cambiarAutomatizacion(b.id, cambios));
        this.automatizaciones.update(l => l.map(x => x.id === n.id ? n : x));
      } else {
        const n = await firstValueFrom(this.op.crearAutomatizacion(datos));
        this.automatizaciones.update(l => [n, ...l]);
      }
      this.borrador.set(null);
      this.aviso.set(null);
    } catch (e) {
      this.aviso.set(textoError(e, 'No se pudo guardar la automatización.'));
    } finally {
      this.guardando.set(false);
    }
  }

  // ── Acciones ──

  async alternar(a: Automatizacion): Promise<void> {
    await this.conCandado(a.id, async () => {
      const n = await firstValueFrom(this.op.cambiarAutomatizacion(a.id, { activa: !a.activa }));
      this.automatizaciones.update(l => l.map(x => x.id === n.id ? n : x));
    }, 'No se pudo cambiar la automatización.');
  }

  async ejecutar(a: Automatizacion): Promise<void> {
    await this.conCandado(a.id, async () => {
      const r = await firstValueFrom(this.op.ejecutarAutomatizacion(a.id, this.router.url, true));
      if (r.omitida || !r.conversacionId) { this.aviso.set('No se ejecutó: acaba de correr hace menos de un minuto.'); return; }
      this.aviso.set(`«${a.nombre}» quedó corriendo: el resultado aparece en el asistente en unos segundos.`);
      this.op.abrirConversacion(r.conversacionId);
      setTimeout(() => void this.cargar(), 4000);
    }, 'No se pudo ejecutar.');
  }

  async eliminar(a: Automatizacion): Promise<void> {
    if (!confirm(`¿Eliminar la automatización «${a.nombre}»? Su historial de ejecuciones se conserva.`)) return;
    await this.conCandado(a.id, async () => {
      await firstValueFrom(this.op.borrarAutomatizacion(a.id));
      this.automatizaciones.update(l => l.filter(x => x.id !== a.id));
    }, 'No se pudo eliminar.');
  }

  /** Abre los resultados en el asistente (o en la bandeja si el asistente no está en esta pantalla). */
  verConversacion(id: number | null): void {
    if (!id) return;
    if (this.op.perfil()) this.op.abrirConversacion(id);
    else void this.router.navigate([RUTA_BANDEJA_IA], { queryParams: { modulo: 'operador', c: id } });
  }

  verEnBandeja(id: number | null): void {
    void this.router.navigate([RUTA_BANDEJA_IA], { queryParams: id ? { modulo: 'operador', c: id } : { modulo: 'operador' } });
  }

  // ── Presentación ──

  etiquetaDisparador(a: { disparador: Disparador; descripcionHorario?: string | null; ruta?: string | null }): string {
    switch (a.disparador) {
      case 'HORARIO': return a.descripcionHorario || 'Por horario';
      case 'AL_INGRESAR': return 'Al entrar a la plataforma (una vez al día)';
      case 'AL_ABRIR_RUTA': return `Al abrir ${this.nombreDeRuta(a.ruta || '')}`;
      default: return 'Solo cuando la ejecutes';
    }
  }

  iconoDisparador(d: Disparador): string {
    return ({ HORARIO: 'schedule', AL_INGRESAR: 'login', AL_ABRIR_RUTA: 'ads_click', MANUAL: 'touch_app' } as Record<Disparador, string>)[d];
  }

  /** Descripción del horario de una plantilla (antes de crearla no hay descripción del servidor). */
  horarioPlantilla(p: PlantillaAutomatizacion): string {
    if (p.disparador !== 'HORARIO') return this.etiquetaDisparador(p);
    const dias = p.dias?.length && p.dias.length < 7 ? p.dias.map(d => NOMBRES_DIA[d]).join(' ') : 'Todos los días';
    return `${dias} · ${p.hora || '08:00'}`;
  }

  estadoClase(a: Automatizacion): string {
    if (!a.activa) return 'pausada';
    if (a.ultimoEstado === 'ERROR') return 'error';
    if (a.ultimoEstado === 'EN_CURSO') return 'corriendo';
    return 'activa';
  }

  nombreDeRuta(ruta: string): string {
    const base = ruta.split('?')[0];
    return this.destinos().find(d => d.ruta === base)?.nombre ?? base;
  }

  ocupada(id: number): boolean { return this.ocupadas().has(id); }

  private async conCandado(id: number, f: () => Promise<void>, error: string): Promise<void> {
    if (this.ocupada(id)) return;
    this.ocupadas.update(s => new Set(s).add(id));
    try {
      await f();
    } catch (e) {
      this.aviso.set(textoError(e, error));
    } finally {
      this.ocupadas.update(s => { const n = new Set(s); n.delete(id); return n; });
    }
  }

  /** "0 30 8 * * MON,THU" → 08:30 y [LUN, JUE] (el cron lo arma ms-ai con ese formato). */
  private horarioDe(cron: string | null): { hora: string; dias: DiaSemana[] } {
    const m = /^0 (\d{1,2}) (\d{1,2}) \* \* ([A-Z,*]+)$/.exec(cron ?? '');
    if (!m) return { hora: '08:00', dias: ['LUN', 'MAR', 'MIE', 'JUE', 'VIE'] };
    const dias = m[3] === '*' ? [...DIAS_SEMANA] : m[3].split(',').map(d => DIAS_CRON[d]).filter((d): d is DiaSemana => !!d);
    return { hora: `${m[2].padStart(2, '0')}:${m[1].padStart(2, '0')}`, dias };
  }
}
