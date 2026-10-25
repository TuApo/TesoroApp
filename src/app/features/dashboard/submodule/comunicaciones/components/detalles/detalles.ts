import { LowerCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Adjunto, Compromiso, Llamada, ParticipanteOut, Resumen } from '../../modelos';
import { ChatStoreService } from '../../service/chat-store.service';
import { ComunicacionesApiService } from '../../service/comunicaciones-api.service';
import { cargoYLugar, duracionLarga, horaCorta, iconoAdjunto, iconoConversacion, tamano } from '../../utiles';
import { abrirActa } from '../acta/acta';
import { ComActividad } from '../actividad/actividad';
import { ComAvatar } from '../avatar/avatar';
import { ComCompromiso } from '../compromiso/compromiso-item';
import { NuevoChatDialog } from '../nuevo-chat/nuevo-chat';
import { VisorAdjunto } from '../visor/visor-adjunto';

type Pestana = 'personas' | 'archivos' | 'llamadas' | 'resumenes' | 'compromisos';

/** Panel lateral de una conversación: todo lo que quedó organizado de ella. */
@Component({
  selector: 'app-com-detalles',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LowerCasePipe, MatIconModule, MatMenuModule, MatTooltipModule, ComAvatar, ComCompromiso, ComActividad],
  templateUrl: './detalles.html',
  styleUrl: './detalles.css',
})
export class ComDetalles implements OnInit {
  readonly store = inject(ChatStoreService);
  private readonly api = inject(ComunicacionesApiService);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);

  readonly conversacionId = input.required<string>();
  readonly pestana = signal<Pestana>('compromisos');
  readonly claseArchivo = signal<'fotos' | 'docs' | 'escaneos' | 'media'>('fotos');
  readonly archivos = signal<Adjunto[]>([]);
  readonly llamadas = signal<Llamada[]>([]);
  readonly resumenes = signal<Resumen[]>([]);
  readonly compromisos = signal<Compromiso[]>([]);
  readonly resumiendo = signal(false);
  readonly aviso = signal<string | null>(null);
  readonly editandoTitulo = signal(false);

  readonly conv = computed(() => this.store.conversacion(this.conversacionId()));
  readonly soyAdmin = computed(() => this.conv()?.mi_rol === 'ADMIN');
  readonly personas = computed(() => (this.conv()?.participantes ?? []).filter(p => p.activo));
  readonly iconoConv = computed(() => { const c = this.conv(); return c ? iconoConversacion(c) : null; });
  /** Grupos por rango o de más de 40: la lista completa viene paginada del servidor. */
  readonly grande = computed(() => { const c = this.conv(); return !!c && c.total_participantes > this.personas().length; });
  readonly paginaPersonas = signal<ParticipanteOut[]>([]);
  readonly hayMasPersonas = signal(false);
  readonly cargandoPersonas = signal(false);
  readonly personasVista = computed(() => this.grande() ? this.paginaPersonas() : this.personas());
  private consultaPersonas = '';
  private paginaActual = 0;
  private esperaBusqueda: ReturnType<typeof setTimeout> | null = null;
  readonly pestanas: { v: Pestana; t: string; i: string }[] = [
    { v: 'compromisos', t: 'Compromisos', i: 'task_alt' },
    { v: 'resumenes', t: 'Resúmenes', i: 'summarize' },
    { v: 'llamadas', t: 'Llamadas', i: 'call' },
    { v: 'archivos', t: 'Archivos', i: 'folder' },
    { v: 'personas', t: 'Personas', i: 'group' },
  ];

  constructor() {
    effect(() => {
      const id = this.conversacionId();
      const p = this.pestana();
      this.claseArchivo();
      untracked(() => this.cargar(id, p));
    });
    this.store.eventos$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(({ nombre, datos }) => {
      if (datos?.conversacion_id !== this.conversacionId()) return;
      if (nombre === 'memoria') {
        this.resumiendo.set(false);
        if (datos?.estado === 'SIN_NOVEDAD') this.aviso.set('No hay mensajes nuevos desde el último resumen.');
        else if (datos?.estado === 'ERROR') this.aviso.set('No se pudo resumir ahora. Intenta de nuevo en un rato.');
        this.cargar(this.conversacionId(), this.pestana());
      }
      if (nombre === 'compromiso' || nombre === 'transcripcion') this.cargar(this.conversacionId(), this.pestana());
    });
  }

  ngOnInit(): void {
    // En un grupo por rango lo que interesa es quién está (y quién coordina), no los compromisos.
    if (this.conv()?.alcance_tipo) this.pestana.set('personas');
  }

  private cargar(id: string, p: Pestana): void {
    switch (p) {
      case 'personas': if (this.grande()) this.cargarPersonas(true); break;
      case 'archivos': {
        const clases = { fotos: ['IMAGEN'], docs: ['DOCUMENTO', 'OTRO'], escaneos: ['ESCANEO'], media: ['VIDEO', 'AUDIO'] }[this.claseArchivo()];
        this.api.galeria(id, clases).subscribe({ next: a => this.archivos.set(a) });
        break;
      }
      case 'llamadas': this.api.historial(id, 50).subscribe({ next: l => this.llamadas.set(l) }); break;
      case 'resumenes': this.api.resumenes(id).subscribe({ next: r => this.resumenes.set(r) }); break;
      case 'compromisos': this.api.compromisos({ alcance: 'todos', conversacion_id: id }).subscribe({ next: c => this.compromisos.set(c) }); break;
      default: break;
    }
  }

  resumir(): void {
    this.aviso.set(null);
    this.resumiendo.set(true);
    this.api.resumir(this.conversacionId()).subscribe({
      error: e => { this.resumiendo.set(false); this.aviso.set(e?.error?.message ?? 'No se pudo resumir'); },
    });
  }

  nuevoCompromiso(input: HTMLInputElement, resp: HTMLSelectElement, fecha: HTMLInputElement): void {
    const d = input.value.trim();
    if (!d) return;
    this.api.crearCompromiso({ conversacion_id: this.conversacionId(), descripcion: d, responsable_id: resp.value || null,
      fecha_limite: fecha.value || null }).subscribe({
      next: c => { this.compromisos.update(l => [c, ...l]); input.value = ''; resp.value = ''; fecha.value = ''; },
    });
  }

  actualizar(c: Compromiso): void { this.compromisos.update(l => l.map(x => x.id === c.id ? c : x)); }
  quitar(id: string): void { this.compromisos.update(l => l.filter(x => x.id !== id)); }
  origen(c: Compromiso): void { if (c.llamada_id) abrirActa(this.dialog, c.llamada_id); }
  verActa(l: Llamada): void { abrirActa(this.dialog, l.id); }
  abrirActaDe(id: string): void { abrirActa(this.dialog, id); }

  abrirArchivo(i: number): void {
    this.dialog.open(VisorAdjunto, { data: { adjuntos: this.archivos(), indice: i }, panelClass: 'com-visor-panel',
      maxWidth: '100vw', maxHeight: '100vh', width: '100vw', height: '100vh' });
  }

  agregarPersonas(): void {
    const ref = this.dialog.open(NuevoChatDialog, { data: { modo: 'agregar', excluir: this.personas().map(p => p.usuario_id) }, panelClass: 'com-dialogo' });
    ref.afterClosed().subscribe(ids => {
      if (Array.isArray(ids) && ids.length) this.api.agregar(this.conversacionId(), ids).subscribe({ next: c => this.store.upsert(c) });
    });
  }

  quitarPersona(usuarioId: string): void {
    const yo = usuarioId === this.store.miId();
    if (!confirm(yo ? '¿Salir de este grupo?' : '¿Quitar a esta persona del grupo?')) return;
    this.api.quitar(this.conversacionId(), usuarioId).subscribe({
      next: () => yo ? this.store.quitar(this.conversacionId()) : this.store.refrescar(this.conversacionId()),
    });
  }

  hacerAdmin(usuarioId: string, admin: boolean): void {
    this.api.rol(this.conversacionId(), usuarioId, admin ? 'ADMIN' : 'MIEMBRO').subscribe({ next: c => this.store.upsert(c) });
  }

  guardarTitulo(titulo: string, descripcion: string): void {
    this.api.actualizar(this.conversacionId(), { titulo: titulo.trim(), descripcion: descripcion.trim() })
      .subscribe({ next: c => { this.store.upsert(c); this.editandoTitulo.set(false); } });
  }

  preferencia(p: { fijada?: boolean; archivada?: boolean; silenciada?: boolean }): void {
    this.api.preferencias(this.conversacionId(), p).subscribe({ next: c => this.store.upsert(c) });
  }

  detalleP(p: ParticipanteOut): string { return cargoYLugar(p.cargo, p.sede); }

  cargarPersonas(reiniciar: boolean): void {
    if (reiniciar) this.paginaActual = 0;
    const pagina = this.paginaActual;
    this.cargandoPersonas.set(true);
    this.api.participantes(this.conversacionId(), this.consultaPersonas, pagina, 60).subscribe({
      next: l => {
        this.paginaPersonas.update(prev => reiniciar ? l : [...prev, ...l.filter(x => !prev.some(y => y.usuario_id === x.usuario_id))]);
        this.hayMasPersonas.set(l.length === 60);
        this.paginaActual = pagina + 1;
        this.cargandoPersonas.set(false);
      },
      error: () => this.cargandoPersonas.set(false),
    });
  }

  buscarPersonas(q: string): void {
    this.consultaPersonas = q.trim();
    if (this.esperaBusqueda) clearTimeout(this.esperaBusqueda);
    this.esperaBusqueda = setTimeout(() => this.cargarPersonas(true), 300);
  }

  async escribirA(usuarioId: string): Promise<void> {
    try { this.store.pedirAbrir((await this.store.abrirDirecta(usuarioId)).id); } catch { /* sin red */ }
  }
  abs(u: string | null): string | null { return this.api.absoluta(u); }
  cuando(iso: string | null): string { return horaCorta(iso); }
  fecha(iso: string): string { return new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); }
  dur(s: number | null): string { return duracionLarga(s); }
  tam(b: number): string { return tamano(b); }
  icono(a: Adjunto): string { return iconoAdjunto(a.clase, a.mime); }
  estadoTrans(l: Llamada): string {
    return ({ LISTA: 'Acta lista', PENDIENTE: 'En cola', PROCESANDO: 'Transcribiendo', ERROR: 'Falló', SIN_AUDIO: 'Sin audio', NINGUNA: '' } as Record<string, string>)[l.transcripcion_estado] ?? '';
  }
}
