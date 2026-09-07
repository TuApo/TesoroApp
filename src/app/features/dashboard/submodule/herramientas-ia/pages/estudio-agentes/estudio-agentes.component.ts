import {
  ChangeDetectionStrategy, Component, OnInit, PLATFORM_ID, computed, inject, signal,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';

import Swal from 'sweetalert2';

import {
  AgenteRegistrado, Area, Borrador, EstudioAgentesService, Propuesta, TurnoChat, VersionAgente,
} from '../../service/estudio-agentes.service';
import { Adjunto, AgentesService } from '../../service/agentes.service';

type Vista = 'catalogo' | 'chat' | 'ficha' | 'propuestas';
type PestanaFicha = 'persona' | 'adjuntos' | 'historial';

/**
 * Estudio de agentes: donde se escriben los agentes propios y se reparten por áreas.
 *
 * QUÉ NO ES. No es el panel de Agente Desarrollo. Aquel ENCARGA trabajo a los 81 agentes
 * de ruflo, que son de solo lectura. Aquí se CREAN los nuestros, que viven en base de
 * datos, se versionan y se pueden recuperar si el workspace se pierde.
 *
 * LOS DOS CAMINOS PARA CREAR. El formulario está, pero la parte difícil de un agente es la
 * persona —el prompt que decide si entrega bien o entrega basura— y pedirle eso a alguien
 * desde una caja vacía acaba en dos líneas y un agente inútil. Por eso el camino de verdad
 * es el chat: se cuenta lo que hace falta y el asistente redacta un borrador largo, avisa
 * de si ya hay un agente que hace eso, y pregunta lo que no se dijo en vez de inventarlo.
 */
@Component({
  selector: 'app-estudio-agentes',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatButtonModule, MatCardModule, MatChipsModule, MatFormFieldModule, MatIconModule,
    MatInputModule, MatMenuModule, MatProgressSpinnerModule, MatSelectModule, MatTooltipModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './estudio-agentes.component.html',
  styleUrls: ['./estudio-agentes.component.css'],
})
export class EstudioAgentesComponent implements OnInit {
  private svc = inject(EstudioAgentesService);
  private puente = inject(AgentesService);
  private esNavegador = isPlatformBrowser(inject(PLATFORM_ID));

  // ── Estado general ────────────────────────────────────────────────────────

  vista = signal<Vista>('catalogo');
  cargando = signal(true);
  error = signal<string | null>(null);

  areas = signal<Area[]>([]);
  agentes = signal<AgenteRegistrado[]>([]);
  areaFiltro = signal<string | null>(null);
  busqueda = signal('');

  asistenteDisponible = signal(false);

  // ── Ficha abierta ─────────────────────────────────────────────────────────

  abierto = signal<AgenteRegistrado | null>(null);
  pestanaFicha = signal<PestanaFicha>('persona');
  guardando = signal(false);

  fNombre = signal('');
  fClave = signal('');
  fDescripcion = signal('');
  fPersona = signal('');
  fCapacidades = signal('');
  fArea = signal<string | null>(null);
  fPrioridad = signal('media');
  fMotivo = signal('');

  adjuntos = signal<Adjunto[]>([]);
  subiendo = signal(false);
  historial = signal<VersionAgente[]>([]);

  // ── Bandeja de propuestas ─────────────────────────────────────────────────

  propuestas = signal<Propuesta[]>([]);
  pendientes = signal(0);
  repasando = signal(false);
  autoEncendido = signal(false);
  verTodas = signal(false);

  // ── Chat de creación ──────────────────────────────────────────────────────

  conversacion = signal<TurnoChat[]>([]);
  mensaje = signal('');
  pensando = signal(false);
  borrador = signal<Borrador | null>(null);

  // ── Derivados ─────────────────────────────────────────────────────────────

  agentesVisibles = computed(() => {
    const area = this.areaFiltro();
    const q = this.busqueda().trim().toLowerCase();
    return this.agentes().filter((a) => {
      if (area && a.areaId !== area) return false;
      if (!q) return true;
      return (a.nombre + ' ' + a.clave + ' ' + (a.descripcion ?? '')).toLowerCase().includes(q);
    });
  });

  /** Cuántos activos están por detrás del workspace. Es el aviso que importa. */
  desincronizados = computed(() => this.agentes().filter((a) => a.desincronizado).length);

  hayBorradores = computed(() => this.agentes().some((a) => a.estado === 'borrador'));

  areaAbierta = computed(() => {
    const id = this.areaFiltro();
    return id ? this.areas().find((a) => a.id === id) ?? null : null;
  });

  ngOnInit(): void {
    if (!this.esNavegador) return;
    this.recargar();
    this.svc.saludAsistente().subscribe({
      next: (s) => this.asistenteDisponible.set(!!s.disponible),
      error: () => this.asistenteDisponible.set(false),
    });
    this.cargarPropuestas();
  }

  // ── Bandeja ───────────────────────────────────────────────────────────────

  cargarPropuestas(): void {
    this.svc.propuestas(this.verTodas() ? 'todas' : 'pendientes').subscribe({
      next: (p) => {
        this.propuestas.set(p ?? []);
        this.pendientes.set((p ?? []).filter((x) => x.estado === 'pendiente').length);
      },
      error: () => this.propuestas.set([]),
    });
  }

  alternarFiltroPropuestas(): void {
    this.verTodas.set(!this.verTodas());
    this.cargarPropuestas();
  }

  /**
   * Lanza el repaso a mano: mira lo que falló y busca patrones. Puede tardar —
   * es una llamada al modelo con la bitácora entera.
   */
  repasar(): void {
    if (this.repasando()) return;
    this.repasando.set(true);
    this.svc.repasar().subscribe({
      next: (r) => {
        this.repasando.set(false);
        this.autoEncendido.set(r.automatico);
        this.cargarPropuestas();
        Swal.fire({
          icon: r.propuestas ? 'success' : 'info',
          title: r.propuestas
            ? `${r.propuestas} propuesta${r.propuestas === 1 ? '' : 's'} nueva${r.propuestas === 1 ? '' : 's'}`
            : 'Nada que proponer',
          text: r.propuestas
            ? 'Están en la bandeja, sin aplicar. Léelas antes de aceptar.'
            : 'No vi ningún patrón claro en lo que falló. Suele ser la respuesta correcta.',
          confirmButtonColor: '#6d28d9',
        });
      },
      error: (e) => {
        this.repasando.set(false);
        this.avisar(e);
      },
    });
  }

  async aceptarPropuesta(p: Propuesta): Promise<void> {
    const esAjuste = p.tipo === 'ajuste';
    const r = await Swal.fire({
      icon: 'question',
      title: esAjuste ? `¿Aplicar el ajuste a "${p.clave}"?` : `¿Crear "${p.nombre}"?`,
      html: esAjuste
        ? 'Se guarda una versión nueva de su persona. La anterior queda en el historial, '
          + 'así que puedes volver atrás.'
        : 'Nace en <b>borrador</b>: no se suelta al pool hasta que lo publiques.',
      input: 'text',
      inputPlaceholder: 'Nota para el historial (opcional)',
      showCancelButton: true,
      confirmButtonText: esAjuste ? 'Aplicar' : 'Crear',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#6d28d9',
    });
    if (!r.isConfirmed) return;
    this.svc.aceptarPropuesta(p.id, r.value || undefined).subscribe({
      next: (a) => {
        this.cargarPropuestas();
        this.recargar();
        this.abrir(a);
      },
      error: (e) => this.avisar(e),
    });
  }

  async descartarPropuesta(p: Propuesta): Promise<void> {
    const r = await Swal.fire({
      icon: 'question',
      title: '¿Descartar la propuesta?',
      text: 'Se queda registrada como descartada; no vuelve a proponerse igual.',
      input: 'text',
      inputPlaceholder: 'Por qué no vale (opcional, pero ayuda)',
      showCancelButton: true,
      confirmButtonText: 'Descartar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#b91c1c',
    });
    if (!r.isConfirmed) return;
    this.svc.descartarPropuesta(p.id, r.value || undefined).subscribe({
      next: () => this.cargarPropuestas(),
      error: (e) => this.avisar(e),
    });
  }

  etiquetaDisparador(d: string): string {
    return d === 'tarea_fallida' ? 'patrón en tareas fallidas'
      : d === 'sin_agente' ? 'encargo sin agente que encajara'
      : d === 'programado' ? 'repaso automático'
      : 'repaso a mano';
  }

  recargar(): void {
    this.cargando.set(true);
    this.svc.areas().subscribe({
      next: (a) => this.areas.set(a ?? []),
      error: () => this.areas.set([]),
    });
    this.svc.agentes().subscribe({
      next: (a) => {
        this.agentes.set(a ?? []);
        this.cargando.set(false);
        this.error.set(null);
      },
      error: (e) => {
        this.cargando.set(false);
        this.error.set(
          e?.status === 403
            ? 'El estudio de agentes es solo para administradores.'
            : 'No se pudo consultar el registro de agentes.',
        );
      },
    });
  }

  // ── Áreas ─────────────────────────────────────────────────────────────────

  async nuevaArea(): Promise<void> {
    const r = await Swal.fire({
      title: 'Área nueva',
      html:
        '<input id="n" class="swal2-input" placeholder="Nombre (ej. Nómina)">' +
        '<input id="d" class="swal2-input" placeholder="Para qué es (opcional)">',
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Crear',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#6d28d9',
      preConfirm: () => {
        const n = (document.getElementById('n') as HTMLInputElement)?.value?.trim();
        if (!n) {
          Swal.showValidationMessage('El área necesita un nombre');
          return null;
        }
        return { nombre: n, descripcion: (document.getElementById('d') as HTMLInputElement)?.value?.trim() };
      },
    });
    if (!r.isConfirmed || !r.value) return;
    this.svc.crearArea(r.value).subscribe({
      next: () => this.recargar(),
      error: (e) => this.avisar(e),
    });
  }

  async borrarArea(a: Area): Promise<void> {
    const r = await Swal.fire({
      icon: 'warning',
      title: `¿Borrar el área "${a.nombre}"?`,
      text: 'Los agentes no se borran; el área solo se puede quitar si está vacía.',
      showCancelButton: true,
      confirmButtonText: 'Borrar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#b91c1c',
    });
    if (!r.isConfirmed) return;
    this.svc.borrarArea(a.id).subscribe({
      next: () => {
        if (this.areaFiltro() === a.id) this.areaFiltro.set(null);
        this.recargar();
      },
      error: (e) => this.avisar(e),
    });
  }

  filtrarPor(id: string | null): void {
    this.areaFiltro.set(id);
  }

  // ── Ficha ─────────────────────────────────────────────────────────────────

  abrir(a: AgenteRegistrado): void {
    this.abierto.set(a);
    this.fNombre.set(a.nombre);
    this.fClave.set(a.clave);
    this.fDescripcion.set(a.descripcion ?? '');
    this.fPersona.set(a.persona);
    this.fCapacidades.set((a.capacidades ?? []).join(', '));
    this.fArea.set(a.areaId);
    this.fPrioridad.set(a.prioridad || 'media');
    this.fMotivo.set('');
    this.pestanaFicha.set('persona');
    this.adjuntos.set([]);
    this.historial.set([]);
    this.vista.set('ficha');
    // Los adjuntos los guarda el puente, y ahí solo existe si está publicado.
    if (a.estado === 'activo') this.cargarAdjuntos(a.clave);
  }

  cerrarFicha(): void {
    this.abierto.set(null);
    this.vista.set('catalogo');
  }

  verPestana(p: PestanaFicha): void {
    this.pestanaFicha.set(p);
    const a = this.abierto();
    if (p === 'historial' && a && !this.historial().length) {
      this.svc.versiones(a.id).subscribe({
        next: (v) => this.historial.set(v ?? []),
        error: () => this.historial.set([]),
      });
    }
  }

  guardar(): void {
    const a = this.abierto();
    if (!a) return;
    if (!this.fPersona().trim()) {
      Swal.fire({ icon: 'warning', title: 'Falta la persona', text: 'Un agente sin instrucciones no sabe qué es.', confirmButtonColor: '#6d28d9' });
      return;
    }
    this.guardando.set(true);
    this.svc.editarAgente(a.id, {
      nombre: this.fNombre(),
      areaId: this.fArea(),
      descripcion: this.fDescripcion(),
      persona: this.fPersona(),
      capacidades: this.listaCapacidades(),
      prioridad: this.fPrioridad(),
      motivo: this.fMotivo() || 'edición manual',
    }).subscribe({
      next: (act) => {
        this.guardando.set(false);
        this.abierto.set(act);
        this.historial.set([]);
        this.fMotivo.set('');
        this.recargar();
      },
      error: (e) => {
        this.guardando.set(false);
        this.avisar(e);
      },
    });
  }

  publicar(a: AgenteRegistrado): void {
    this.svc.publicar(a.id).subscribe({
      next: (act) => {
        if (this.abierto()?.id === act.id) this.abierto.set(act);
        this.recargar();
        Swal.fire({
          icon: 'success', title: 'Publicado',
          text: `"${act.nombre}" ya está en el workspace: el pool puede encargarle trabajo.`,
          confirmButtonColor: '#6d28d9',
        });
      },
      error: (e) => this.avisar(e),
    });
  }

  archivar(a: AgenteRegistrado): void {
    this.svc.archivar(a.id).subscribe({
      next: (act) => {
        if (this.abierto()?.id === act.id) this.abierto.set(act);
        this.recargar();
      },
      error: (e) => this.avisar(e),
    });
  }

  async borrar(a: AgenteRegistrado): Promise<void> {
    const r = await Swal.fire({
      icon: 'warning',
      title: `¿Borrar "${a.nombre}"?`,
      html: 'Se va el agente y todo su historial de versiones. '
        + 'Si solo quieres retirarlo del pool, <b>archívalo</b> en vez de borrarlo.',
      showCancelButton: true,
      confirmButtonText: 'Borrar del todo',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#b91c1c',
    });
    if (!r.isConfirmed) return;
    this.svc.borrarAgente(a.id).subscribe({
      next: () => {
        this.cerrarFicha();
        this.recargar();
      },
      error: (e) => this.avisar(e),
    });
  }

  restaurar(v: VersionAgente): void {
    const a = this.abierto();
    if (!a) return;
    this.svc.restaurar(a.id, v.version).subscribe({
      next: (act) => {
        this.abierto.set(act);
        this.fPersona.set(act.persona);
        this.fNombre.set(act.nombre);
        this.historial.set([]);
        this.verPestana('historial');
        this.recargar();
      },
      error: (e) => this.avisar(e),
    });
  }

  sincronizar(): void {
    this.svc.sincronizar().subscribe({
      next: (r) => {
        this.recargar();
        Swal.fire({
          icon: r.fallidos ? 'warning' : 'success',
          title: `${r.escritos} agente${r.escritos === 1 ? '' : 's'} al día`,
          text: r.fallidos ? `${r.fallidos} no se pudieron escribir: ${r.errores.join(' · ')}` : undefined,
          confirmButtonColor: '#6d28d9',
        });
      },
      error: (e) => this.avisar(e),
    });
  }

  // ── Adjuntos ──────────────────────────────────────────────────────────────

  private cargarAdjuntos(clave: string): void {
    this.puente.fichaAgente(clave).subscribe({
      next: (f) => this.adjuntos.set(f.adjuntos ?? []),
      error: () => this.adjuntos.set([]),
    });
  }

  /**
   * PDF, imágenes, hojas de cálculo, lo que sea. El agente los recibe en su carpeta antes
   * de arrancar; las imágenes las MIRA de verdad con la herramienta Read, no las lee como
   * texto.
   */
  async subirArchivos(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const a = this.abierto();
    if (!input.files?.length || !a) return;
    this.subiendo.set(true);
    try {
      for (const f of Array.from(input.files)) {
        const b64 = await this.aBase64(f);
        await new Promise<void>((ok, mal) => {
          this.puente.subirAdjuntoAgente(a.clave, f.name, b64).subscribe({ next: () => ok(), error: mal });
        });
      }
      this.cargarAdjuntos(a.clave);
    } catch (e) {
      this.avisar(e);
    } finally {
      this.subiendo.set(false);
      input.value = '';
    }
  }

  borrarAdjunto(nombre: string): void {
    const a = this.abierto();
    if (!a) return;
    this.puente.borrarAdjuntoAgente(a.clave, nombre).subscribe({
      next: () => this.cargarAdjuntos(a.clave),
      error: (e) => this.avisar(e),
    });
  }

  private aBase64(f: File): Promise<string> {
    return new Promise((ok, mal) => {
      const r = new FileReader();
      // readAsDataURL da "data:<mime>;base64,<datos>"; el puente solo quiere los datos.
      r.onload = () => ok(String(r.result).split(',')[1] ?? '');
      r.onerror = () => mal(new Error(`no se pudo leer ${f.name}`));
      r.readAsDataURL(f);
    });
  }

  // ── Chat de creación ──────────────────────────────────────────────────────

  abrirChat(): void {
    this.conversacion.set([]);
    this.borrador.set(null);
    this.mensaje.set('');
    this.vista.set('chat');
  }

  enviar(): void {
    const texto = this.mensaje().trim();
    if (!texto || this.pensando()) return;
    const conv: TurnoChat[] = [...this.conversacion(), { rol: 'persona', texto }];
    this.conversacion.set(conv);
    this.mensaje.set('');
    this.pensando.set(true);

    this.svc.proponer(conv).subscribe({
      next: (b) => {
        this.pensando.set(false);
        this.borrador.set(b);
        // El comentario y las preguntas vuelven a la conversación: así se ve lo que falta
        // sin tener que mirar el borrador de al lado.
        const partes: string[] = [];
        if (b.comentario) partes.push(b.comentario);
        if (b.agentesParecidos?.length) {
          partes.push(`Ojo: ya hay algo parecido — ${b.agentesParecidos.join(', ')}.`);
        }
        if (b.preguntas?.length) {
          partes.push('Para terminarlo me falta saber:\n· ' + b.preguntas.join('\n· '));
        }
        this.conversacion.set([
          ...conv,
          { rol: 'asistente', texto: partes.join('\n\n') || 'Listo, mira el borrador.' },
        ]);
      },
      error: (e) => {
        this.pensando.set(false);
        this.avisar(e);
      },
    });
  }

  /** Convierte el borrador en un agente de verdad. Nace en borrador, no publicado. */
  aceptarBorrador(): void {
    const b = this.borrador();
    if (!b) return;
    const area = this.areas().find((a) => a.clave === b.areaSugerida);
    this.svc.crearAgente({
      clave: b.clave,
      nombre: b.nombre,
      areaId: area?.id ?? this.areaFiltro() ?? null,
      descripcion: b.descripcion,
      persona: b.persona,
      capacidades: b.capacidades,
    }, 'asistente').subscribe({
      next: (a) => {
        this.recargar();
        this.abrir(a);
        Swal.fire({
          icon: 'success', title: 'Agente creado',
          text: 'Está en borrador: revisa la persona y púlsale a Publicar cuando te convenza.',
          confirmButtonColor: '#6d28d9',
        });
      },
      error: (e) => this.avisar(e),
    });
  }

  // ── Utilidades ────────────────────────────────────────────────────────────

  private listaCapacidades(): string[] {
    return this.fCapacidades().split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12);
  }

  private avisar(e: unknown): void {
    const err = e as { error?: { error?: string }; status?: number };
    Swal.fire({
      icon: 'error',
      title: 'No se pudo',
      text: err?.error?.error || 'La operación no se completó.',
      confirmButtonColor: '#6d28d9',
    });
  }

  colorArea(a: AgenteRegistrado): string {
    return this.areas().find((x) => x.id === a.areaId)?.color || '#cbd5e1';
  }

  etiquetaEstado(e: string): string {
    return e === 'activo' ? 'Publicado' : e === 'borrador' ? 'Borrador' : 'Archivado';
  }

  pesoLegible(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
}
