import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, ViewChild, computed, inject, signal,
} from '@angular/core';
import { DatePipe, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';

import { Aula, AulasService, Entrada } from '../../service/aulas.service';
import { mensajeDeError } from '../../service/disenador.service';
import { SalaEnVivo } from '../../aula/sala-en-vivo';
import { Disposicion, Escenario } from '../../components/aula/escenario';
import { PanelChat } from '../../components/aula/panel-chat';
import { PanelPersonas } from '../../components/aula/panel-personas';
import { PanelCodigo } from '../../components/aula/panel-codigo';
import { PanelPizarra } from '../../components/aula/panel-pizarra';
import { PanelEquipos } from '../../components/aula/panel-equipos';
import { PanelActividades } from '../../components/aula/panel-actividades';
import { PanelClase } from '../../components/aula/panel-clase';

type Panel = 'chat' | 'personas' | 'clase' | 'codigo' | 'pizarra' | 'equipos' | 'actividades';

/**
 * El aula en vivo.
 *
 * <p>Tres momentos: la SALA PREVIA (probar cámara y micrófono, esperar si todavía no empieza), la
 * SALA (escenario, controles y paneles) y el FINAL. En la sala todo lo compartido —disposición,
 * foco, qué hay en el escenario, en qué bloque de la clase van— viene del estado del aula (la
 * metadata de la sala de LiveKit), que solo cambia quien dirige.
 *
 * <p>Los equipos son otras salas de LiveKit: al abrirlos el servidor avisa por la sala principal
 * y cada navegador se cambia solo a la de su equipo; al cerrarlos, vuelve.
 */
@Component({
  selector: 'app-aula',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule, RouterLink, DatePipe, TitleCasePipe, Escenario, PanelChat, PanelPersonas, PanelCodigo, PanelPizarra,
    PanelEquipos, PanelActividades, PanelClase],
  templateUrl: './aula.html',
  styleUrl: './aula.css',
})
export class AulaPage implements OnInit {
  private api = inject(AulasService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  @ViewChild('audios', { static: true }) audiosEl!: ElementRef<HTMLElement>;
  @ViewChild('previa') previaEl?: ElementRef<HTMLVideoElement>;

  readonly aula = signal<Aula | null>(null);
  readonly fase = signal<'cargando' | 'previa' | 'sala' | 'final' | 'error'>('cargando');
  readonly error = signal<string | null>(null);
  readonly entrando = signal(false);
  readonly esperando = signal(false);
  readonly sala = signal<SalaEnVivo | null>(null);
  readonly equipoActual = signal<string | null>(null);
  /** En pantalla angosta el panel es una hoja que tapa el escenario: arranca cerrado. */
  readonly panel = signal<Panel | null>(window.matchMedia?.('(max-width: 1000px)').matches ? null : 'chat');
  /** Los navegadores de celular no comparten pantalla (no tienen getDisplayMedia). */
  readonly puedeCompartirPantalla = typeof navigator.mediaDevices?.getDisplayMedia === 'function';
  readonly puedePantallaCompleta = !!document.fullscreenEnabled;
  readonly pantallaCompleta = signal(!!document.fullscreenElement);
  private readonly alCambiarPantallaCompleta = () => this.pantallaCompleta.set(!!document.fullscreenElement);
  readonly disposicionLocal = signal<Disposicion>('auto');
  readonly reaccionesAbiertas = signal(false);
  readonly refrescoEspacios = signal(0);
  readonly ahora = signal(Date.now());
  readonly oscuro = signal(document.documentElement.getAttribute('data-theme') === 'dark');

  readonly camaras = signal<MediaDeviceInfo[]>([]);
  readonly micros = signal<MediaDeviceInfo[]>([]);
  micId: string | null = null;
  camId: string | null = null;
  conMic = false;
  conCam = true;
  private streamPrevia: MediaStream | null = null;

  readonly estadoAula = computed<Record<string, any>>(() => ({ ...(this.aula()?.estado_aula ?? {}), ...(this.sala()?.metadata() ?? {}) }));
  readonly dirijo = computed(() => ['ANFITRION', 'COPRESENTADOR'].includes(this.aula()?.mi_rol ?? ''));
  readonly disposicion = computed<Disposicion>(() => this.disposicionLocal() !== 'auto' ? this.disposicionLocal() : (this.estadoAula()['disposicion'] ?? 'auto'));
  readonly enEscenario = computed<string | null>(() => this.estadoAula()['escenario'] ?? null);
  readonly manos = computed(() => this.sala()?.mosaicos().filter(m => m.mano).length ?? 0);
  readonly nombreEquipo = computed(() => this.aula()?.equipos.find(e => e.id === this.equipoActual())?.nombre ?? null);
  readonly duracion = computed(() => {
    const ini = this.aula()?.iniciada_at;
    if (!ini) return '';
    const s = Math.max(0, Math.floor((this.ahora() - new Date(ini).getTime()) / 1000));
    return `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ':' : ''}${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  });

  readonly paneles: { id: Panel; icono: string; nombre: string }[] = [
    { id: 'chat', icono: 'chat', nombre: 'Chat' },
    { id: 'personas', icono: 'group', nombre: 'Personas' },
    { id: 'clase', icono: 'menu_book', nombre: 'Clase' },
    { id: 'codigo', icono: 'code', nombre: 'Código' },
    { id: 'pizarra', icono: 'draw', nombre: 'Pizarra' },
    { id: 'equipos', icono: 'diversity_3', nombre: 'Equipos' },
    { id: 'actividades', icono: 'poll', nombre: 'Actividades' },
  ];
  readonly emojis = ['👍', '👏', '😂', '❤️', '😮', '🎉', '🤔', '🙌'];

  private bajas: (() => void)[] = [];
  private reloj: ReturnType<typeof setInterval> | null = null;
  private espera: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    document.addEventListener('fullscreenchange', this.alCambiarPantallaCompleta);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('fullscreenchange', this.alCambiarPantallaCompleta);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      this.salirDeTodo();
    });
  }

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id')!;
    try {
      const a = await this.api.obtener(id);
      this.aula.set(a);
      if (a.estado === 'FINALIZADA' || a.estado === 'CANCELADA') { this.fase.set('final'); return; }
      this.fase.set('previa');
      await this.prepararPrevia();
    } catch (e) {
      this.error.set(mensajeDeError(e, 'No se encontró el aula'));
      this.fase.set('error');
    }
  }

  // ── Sala previa ────────────────────────────────────────────────────────────

  async prepararPrevia(): Promise<void> {
    try {
      const dispositivos = await navigator.mediaDevices.enumerateDevices();
      this.camaras.set(dispositivos.filter(d => d.kind === 'videoinput'));
      this.micros.set(dispositivos.filter(d => d.kind === 'audioinput'));
    } catch { /* sin permisos todavía */ }
    await this.probarCamara();
  }

  async probarCamara(): Promise<void> {
    this.streamPrevia?.getTracks().forEach(t => t.stop());
    this.streamPrevia = null;
    if (!this.conCam || this.aula()?.mi_rol === 'ESPECTADOR') return;
    try {
      this.streamPrevia = await navigator.mediaDevices.getUserMedia({ video: this.camId ? { deviceId: this.camId } : true, audio: false });
      setTimeout(() => { if (this.previaEl) this.previaEl.nativeElement.srcObject = this.streamPrevia; });
      const dispositivos = await navigator.mediaDevices.enumerateDevices();
      this.camaras.set(dispositivos.filter(d => d.kind === 'videoinput'));
      this.micros.set(dispositivos.filter(d => d.kind === 'audioinput'));
    } catch {
      this.conCam = false;
    }
  }

  async entrar(): Promise<void> {
    const a = this.aula();
    if (!a || this.entrando()) return;
    this.entrando.set(true);
    this.esperando.set(false);
    try {
      const e = await this.api.entrar(a.id);
      this.streamPrevia?.getTracks().forEach(t => t.stop());
      this.streamPrevia = null;
      await this.conectar(e, null);
      this.aula.set(await this.api.obtener(a.id));
      this.fase.set('sala');
      this.reloj = setInterval(() => this.ahora.set(Date.now()), 1000);
    } catch (err: any) {
      if (err?.status === 409 && /todavia no empieza/i.test(mensajeDeError(err))) {
        this.esperando.set(true);
        this.espera = setTimeout(() => this.entrar(), 6000);
      } else {
        Swal.fire({ icon: 'error', title: 'No se pudo entrar', text: mensajeDeError(err) });
      }
    } finally {
      this.entrando.set(false);
    }
  }

  private async conectar(e: Entrada, equipo: string | null): Promise<void> {
    const s = new SalaEnVivo(this.audiosEl.nativeElement);
    await s.conectar(e, { mic: this.conMic, cam: this.conCam, micId: this.micId, camId: this.camId });
    this.sala.set(s);
    this.equipoActual.set(equipo);
    this.escuchar(s);
  }

  private escuchar(s: SalaEnVivo): void {
    this.bajas.forEach(f => f());
    this.bajas = [
      s.on('aula.equipos', d => {
        if (d?.accion === 'abrir' && !this.equipoActual()) {
          const mio = d.asignaciones?.[s.identidad];
          if (mio) this.irAEquipo(mio);
          else this.recargarAula();
        } else if (d?.accion === 'volver' && this.equipoActual()) {
          this.volverAPrincipal();
        }
      }),
      s.on('aula.aviso', d => Swal.fire({ toast: true, position: 'top', timer: 6000, showConfirmButton: false, icon: 'info', title: String(d?.texto ?? '') })),
      s.on('aula.control', d => { if (d?.accion === 'finalizada') this.terminada(); }),
      s.on('aula.espacios', () => this.refrescoEspacios.update(n => n + 1)),
    ];
  }

  async recargarAula(): Promise<void> {
    const a = this.aula();
    if (a) this.aula.set(await this.api.obtener(a.id));
  }

  // ── Equipos ────────────────────────────────────────────────────────────────

  async irAEquipo(teamId: string): Promise<void> {
    const a = this.aula();
    if (!a) return;
    try {
      const e = await this.api.entrarEquipo(a.id, teamId);
      await this.sala()?.desconectar();
      this.conMic = true;
      await this.conectar(e, teamId);
      await this.recargarAula();
      this.panel.set('codigo');
      Swal.fire({ toast: true, position: 'top', timer: 3000, showConfirmButton: false, icon: 'info', title: `Estás en ${this.nombreEquipo() ?? 'tu equipo'}` });
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'No se pudo entrar al equipo', text: mensajeDeError(err) });
    }
  }

  async volverAPrincipal(): Promise<void> {
    const a = this.aula();
    if (!a) return;
    try {
      await this.sala()?.desconectar();
      const e = await this.api.entrar(a.id);
      await this.conectar(e, null);
      await this.recargarAula();
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'No se pudo volver', text: mensajeDeError(err) });
    }
  }

  // ── Controles ──────────────────────────────────────────────────────────────

  alternarPanel(p: Panel): void {
    this.panel.set(this.panel() === p ? null : p);
    if (p === 'chat') this.sala()?.chatSinLeer.set(0);
  }

  async estado(parche: Record<string, unknown>): Promise<void> {
    const a = this.aula();
    if (!a || !this.dirijo()) return;
    try { await this.api.estado(a.id, parche); } catch (e) { Swal.fire({ icon: 'error', title: 'No se pudo', text: mensajeDeError(e) }); }
  }

  async accionPersona(ev: { tipo: string; identidad: string; rol: string }): Promise<void> {
    const a = this.aula();
    if (!a) return;
    try {
      switch (ev.tipo) {
        case 'palabra':
          if (ev.rol === 'ESPECTADOR') await this.api.cambiarRol(a.id, ev.identidad, 'PARTICIPANTE');
          this.sala()?.enviar('aula.control', { accion: 'bajar-mano', identidad: ev.identidad });
          break;
        case 'espectador': await this.api.cambiarRol(a.id, ev.identidad, 'ESPECTADOR'); break;
        case 'silenciar': await this.api.silenciar(a.id, ev.identidad); break;
        case 'foco': await this.estado({ foco: this.estadoAula()['foco'] === ev.identidad ? null : ev.identidad, disposicion: 'foco' }); break;
        case 'sacar': {
          const r = await Swal.fire({ icon: 'warning', title: '¿Sacar a esta persona del aula?', showCancelButton: true, confirmButtonText: 'Sacar', cancelButtonText: 'Cancelar' });
          if (r.isConfirmed) await this.api.sacar(a.id, ev.identidad);
          break;
        }
      }
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo', text: mensajeDeError(e) });
    }
  }

  llevarATodos(bloqueId: string): void { this.estado({ clase_bloque: bloqueId }); }
  alEscenario(tipo: 'codigo' | 'pizarra', id: string): void { this.estado({ escenario: `${tipo}:${id}` }); }
  quitarDelEscenario(): void { this.estado({ escenario: null }); }

  alternarPantallaCompleta(): void {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  }

  copiarCodigo(): void {
    const a = this.aula();
    if (!a) return;
    navigator.clipboard?.writeText(a.codigo);
    Swal.fire({ toast: true, position: 'top-end', timer: 2000, showConfirmButton: false, icon: 'success', title: `Código ${a.codigo} copiado` });
  }

  async finalizar(): Promise<void> {
    const a = this.aula();
    if (!a) return;
    const r = await Swal.fire({ icon: 'question', title: '¿Finalizar el aula para todos?',
      text: a.group_id ? 'Se pasará lista del grupo con el tiempo que cada quien estuvo conectado.' : 'Todos salen de la sala.',
      showCancelButton: true, confirmButtonText: 'Finalizar', cancelButtonText: 'Cancelar' });
    if (!r.isConfirmed) return;
    try {
      this.aula.set(await this.api.finalizar(a.id));
      this.terminada();
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo finalizar', text: mensajeDeError(e) });
    }
  }

  async salir(): Promise<void> {
    await this.salirDeTodo();
    this.router.navigate(['/dashboard/capacitaciones/en-vivo']);
  }

  private terminada(): void {
    this.salirDeTodo();
    this.fase.set('final');
  }

  private async salirDeTodo(): Promise<void> {
    if (this.reloj) clearInterval(this.reloj);
    if (this.espera) clearTimeout(this.espera);
    this.bajas.forEach(f => f());
    this.bajas = [];
    this.streamPrevia?.getTracks().forEach(t => t.stop());
    await this.sala()?.desconectar();
  }
}
