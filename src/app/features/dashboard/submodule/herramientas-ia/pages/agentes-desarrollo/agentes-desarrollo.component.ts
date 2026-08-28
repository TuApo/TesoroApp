import {
  Component, ChangeDetectionStrategy, OnInit, OnDestroy, signal, computed, inject, PLATFORM_ID,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { markdownToHtml } from '@/app/features/dashboard/submodule/nomina/pages/analitica-nomina-ia/markdown-lite';
import { firstValueFrom } from 'rxjs';
import { FormsModule } from '@angular/forms';

import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatChipsModule } from '@angular/material/chips';
import { MatMenuModule } from '@angular/material/menu';

import Swal from 'sweetalert2';

import {
  AgentesService, AgenteCatalogo, Catalogo, Cuenta, EstadoAgentes, EventoBitacora,
  Repo, Tarea, Vigilante, Mision, DisparoMision, AgenteFicha,
  SugerenciaAgentes, PlantillaEnjambre,
} from '../../service/agentes.service';

type Pestana = 'panel' | 'nuevo' | 'agentes' | 'misiones' | 'historial';

/** Cada cuánto se refresca el panel. Ojo: /ia/** va con rate limit en el gateway. */
const MS_REFRESCO_PANEL = 3000;
const MS_REFRESCO_CONSOLA = 2000;

/**
 * Los diálogos de SweetAlert se arman con HTML en crudo, fuera de la sanitización de
 * Angular. Todo lo que venga de fuera (una URL de OAuth con sus parámetros, un correo
 * tecleado a mano) pasa por aquí antes de entrar en la cadena.
 */
function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

@Component({
  selector: 'app-agentes-desarrollo',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatCardModule, MatButtonModule, MatIconModule, MatTooltipModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatSlideToggleModule,
    MatProgressSpinnerModule, MatProgressBarModule, MatChipsModule, MatMenuModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './agentes-desarrollo.component.html',
  styleUrls: ['./agentes-desarrollo.component.css'],
})
export class AgentesDesarrolloComponent implements OnInit, OnDestroy {
  private svc = inject(AgentesService);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private sanitizer = inject(DomSanitizer);

  // ── Estado general ────────────────────────────────────────────────────────
  pestana = signal<Pestana>('panel');
  cargando = signal(true);
  error = signal<string | null>(null);
  servicioCaido = signal(false);

  estado = signal<EstadoAgentes | null>(null);
  catalogo = signal<Catalogo | null>(null);
  repos = signal<Repo[]>([]);
  misiones = signal<Mision[]>([]);

  // ── Consola de una tarea ──────────────────────────────────────────────────
  tareaAbierta = signal<Tarea | null>(null);
  bitacora = signal<EventoBitacora[]>([]);
  private leidosBitacora = 0;

  // ── Formulario de encargo ─────────────────────────────────────────────────
  fObjetivo = signal('');
  fContexto = signal('');
  fAgente = signal<string>('backend-dev');
  fRepo = signal<string>('todos');
  fPrioridad = signal<number>(3);
  fPermiso = signal<string>('acceptEdits');
  fMinutos = signal<number>(30);
  fModelo = signal<string>('');
  fEnjambre = signal(false);
  fAgentesEnjambre = signal<string[]>([]);
  fModoEnjambre = signal<'paralelo' | 'secuencial'>('paralelo');
  enviando = signal(false);

  // ── Encargo guiado ────────────────────────────────────────────────────────
  fMetas = signal('');
  fAdjuntos = signal<{ nombre: string; contenidoBase64: string }[]>([]);
  capEncargo = signal<{ asistente: boolean; transcripcion: boolean } | null>(null);
  ocupadoIa = signal(false);
  grabando = signal(false);
  /** Lo que la IA no pudo deducir: se enseña para que se decida antes de encargar. */
  preguntasIa = signal<string[]>([]);
  private grabadora: MediaRecorder | null = null;
  private trozosAudio: Blob[] = [];
  /**
   * Por qué se eligió cada agente (lo dice la IA o la plantilla). Se guarda para poder
   * explicarlo en el plan: un reparto sin motivo no se puede revisar.
   */
  porqueAgente = signal<Map<string, string>>(new Map());

  // ── Catálogo ──────────────────────────────────────────────────────────────
  busquedaAgente = signal('');
  categoriaFiltro = signal<string>('');

  private tempPanel?: ReturnType<typeof setInterval>;
  private tempConsola?: ReturnType<typeof setInterval>;

  // ── Derivados ─────────────────────────────────────────────────────────────

  enCurso = computed(() => this.estado()?.enCurso ?? []);
  cola = computed(() => this.estado()?.cola ?? []);
  cuentas = computed(() => this.estado()?.cuentas ?? []);
  vigilantes = computed(() => this.estado()?.vigilantes ?? []);
  ultimas = computed(() => this.estado()?.ultimas ?? []);

  /** Agentes que están literalmente trabajando ahora mismo, con su cuenta. */
  agentesTrabajando = computed(() =>
    this.enCurso().map((t) => ({
      tarea: t,
      agente: this.catalogo()?.agentes.find((a) => a.clave === t.agente) ?? null,
    })),
  );

  hayPool = computed(() => (this.estado()?.pool.cuentas ?? 0) > 0);
  poolSinSesion = computed(() => {
    const p = this.estado()?.pool;
    return !!p && p.cuentas > 0 && p.cuentas === p.sinSesion;
  });

  agentesFiltrados = computed(() => {
    const todos = this.catalogo()?.agentes ?? [];
    const q = this.busquedaAgente().trim().toLowerCase();
    const cat = this.categoriaFiltro();
    return todos.filter((a) => {
      // Los filtros que empiezan por @ no son categorias del catalogo: son cortes
      // por como se usa el agente (mio, de accion, de evento).
      if (cat === '@propios' && !a.propio) return false;
      if (cat === '@accion' && (a.modo ?? 'accion') !== 'accion') return false;
      if (cat === '@evento' && a.modo !== 'evento') return false;
      if (cat && !cat.startsWith('@') && a.categoria !== cat) return false;
      if (!q) return true;
      return (
        a.clave.toLowerCase().includes(q) ||
        a.nombre.toLowerCase().includes(q) ||
        a.descripcion.toLowerCase().includes(q) ||
        a.capacidades.some((c) => c.toLowerCase().includes(q))
      );
    });
  });

  agentesOrdenados = computed(() =>
    [...(this.catalogo()?.agentes ?? [])].sort((a, b) => a.nombre.localeCompare(b.nombre)),
  );

  // ── Ciclo de vida ─────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.cargarFijos();
    this.refrescar();
    if (this.isBrowser) {
      this.tempPanel = setInterval(() => {
        // Sin pestaña visible no se consulta: evita castigar el rate limit del gateway.
        if (document.visibilityState === 'visible') this.refrescar();
      }, MS_REFRESCO_PANEL);
    }
  }

  ngOnDestroy(): void {
    if (this.tempPanel) clearInterval(this.tempPanel);
    if (this.tempConsola) clearInterval(this.tempConsola);
  }

  private cargarFijos(): void {
    this.svc.catalogo().subscribe({
      next: (c) => this.catalogo.set(c),
      error: () => this.catalogo.set(null),
    });
    this.svc.repos().subscribe({
      next: (r) => this.repos.set(r ?? []),
      error: () => this.repos.set([]),
    });
    this.cargarMisiones();
    this.svc.capacidadesEncargo().subscribe({
      next: (c) => this.capEncargo.set(c),
      // Sin respuesta se esconden las ayudas: mejor un formulario simple que botones
      // que fallan al pulsarlos.
      error: () => this.capEncargo.set({ asistente: false, transcripcion: false }),
    });
  }

  private limpiarEncargo(): void {
    this.fObjetivo.set('');
    this.fContexto.set('');
    this.fMetas.set('');
    this.fAdjuntos.set([]);
    this.preguntasIa.set([]);
  }

  private cargarMisiones(): void {
    this.svc.misiones().subscribe({
      next: (m) => this.misiones.set(m ?? []),
      error: () => this.misiones.set([]),
    });
  }

  refrescar(): void {
    this.svc.estado().subscribe({
      next: (e) => {
        this.estado.set(e);
        this.servicioCaido.set(false);
        this.error.set(null);
        this.cargando.set(false);
        const abierta = this.tareaAbierta();
        if (abierta) {
          const viva = [...e.enCurso, ...e.cola, ...e.ultimas].find((t) => t.id === abierta.id);
          if (viva) this.tareaAbierta.set(viva);
        }
      },
      error: (err) => {
        this.cargando.set(false);
        this.servicioCaido.set(true);
        this.error.set(
          err?.status === 503
            ? 'El servicio de agentes no está respondiendo en el host (systemd tuapo-agentes).'
            : err?.status === 403
              ? 'Este modo es solo para administradores.'
              : 'No se pudo consultar el estado de los agentes.',
        );
      },
    });
  }

  // ── Consola ───────────────────────────────────────────────────────────────

  abrirConsola(t: Tarea): void {
    this.tareaAbierta.set(t);
    this.bitacora.set([]);
    this.leidosBitacora = 0;
    this.tirarBitacora();
    if (this.tempConsola) clearInterval(this.tempConsola);
    if (this.isBrowser) {
      this.tempConsola = setInterval(() => {
        const a = this.tareaAbierta();
        if (!a) return;
        if (document.visibilityState !== 'visible') return;
        this.tirarBitacora();
        if (!this.estaViva(a)) {
          clearInterval(this.tempConsola);
          this.tempConsola = undefined;
        }
      }, MS_REFRESCO_CONSOLA);
    }
  }

  cerrarConsola(): void {
    this.tareaAbierta.set(null);
    this.bitacora.set([]);
    if (this.tempConsola) { clearInterval(this.tempConsola); this.tempConsola = undefined; }
  }

  private tirarBitacora(): void {
    const t = this.tareaAbierta();
    if (!t) return;
    this.svc.bitacora(t.id, this.leidosBitacora).subscribe({
      next: (nuevos) => {
        if (!nuevos?.length) return;
        this.leidosBitacora += nuevos.length;
        this.bitacora.set([...this.bitacora(), ...nuevos]);
      },
      error: () => { /* la consola no es crítica: se reintenta al siguiente tirón */ },
    });
    this.svc.tarea(t.id).subscribe({
      next: (fresca) => this.tareaAbierta.set(fresca),
      error: () => { /* idem */ },
    });
  }

  // ── Acciones ──────────────────────────────────────────────────────────────

  async encargar(): Promise<void> {
    const objetivo = this.fObjetivo().trim();
    if (!objetivo) {
      Swal.fire('Falta el encargo', 'Escribe qué quieres que hagan los agentes.', 'info');
      return;
    }
    if (this.poolSinSesion()) {
      Swal.fire(
        'No hay ninguna cuenta con sesión',
        'Ninguna cuenta del pool ha iniciado sesión todavía, así que el encargo se quedaría esperando en la cola. Inicia sesión en al menos una desde el servidor.',
        'warning',
      );
      return;
    }
    const comun = {
      objetivo,
      contexto: this.fContexto().trim() || null,
      repo: this.fRepo(),
      prioridad: this.fPrioridad(),
      permiso: this.fPermiso(),
      minutos: this.fMinutos(),
      modelo: this.fModelo() || null,
      metas: this.fMetas().split('\n').map((m) => m.trim()).filter(Boolean),
      // Los documentos viajan CON el encargo: subirlos aparte dejaria una ventana en la
      // que el planificador podria arrancar la tarea sin ellos.
      adjuntos: this.fAdjuntos(),
    };

    // El plan se enseña ANTES de lanzar. Un enjambre ocupa una cuenta del pool por
    // cabeza y puede estar media hora trabajando: media pantalla de lectura sale mucho
    // mas barata que descubrir a mitad de camino que el reparto no era el que se queria.
    if (!(await this.confirmarPlan(comun))) return;

    this.enviando.set(true);

    if (this.fEnjambre()) {
      const agentes = this.fAgentesEnjambre();
      if (!agentes.length) {
        this.enviando.set(false);
        Swal.fire('Elige agentes', 'Un enjambre necesita al menos un agente.', 'info');
        return;
      }
      this.svc.crearEnjambre({ ...comun, agentes, modo: this.fModoEnjambre() }).subscribe({
        next: (r) => {
          this.enviando.set(false);
          this.limpiarEncargo();
          this.pestana.set('panel');
          this.refrescar();
          Swal.fire('Enjambre lanzado', `${r.tareas.length} agentes se pusieron en marcha.`, 'success');
        },
        error: (e) => { this.enviando.set(false); this.avisarError(e); },
      });
      return;
    }

    this.svc.crearTarea({ ...comun, agente: this.fAgente() || null }).subscribe({
      next: (t) => {
        this.enviando.set(false);
        this.limpiarEncargo();
        this.pestana.set('panel');
        this.refrescar();
        this.abrirConsola(t);
      },
      error: (e) => { this.enviando.set(false); this.avisarError(e); },
    });
  }

  async cancelarTarea(t: Tarea): Promise<void> {
    const r = await Swal.fire({
      title: '¿Parar a este agente?',
      text: `Se corta "${t.titulo || t.objetivo.slice(0, 60)}" a mitad de trabajo. Lo que ya escribió en la copia de trabajo se queda como está.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, parar',
      cancelButtonText: 'Seguir',
    });
    if (!r.isConfirmed) return;
    this.svc.cancelar(t.id).subscribe({
      next: () => this.refrescar(),
      error: (e) => this.avisarError(e),
    });
  }

  // ── Encargo guiado ────────────────────────────────────────────────────────

  /** Convierte un fichero a base64 pelado (readAsDataURL trae un prefijo delante). */
  private async aBase64(f: File | Blob): Promise<string> {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(',')[1] ?? '');
      fr.onerror = () => rej(new Error('no se pudo leer el fichero'));
      fr.readAsDataURL(f);
    });
  }

  /**
   * Dictado. Se graba en el navegador y se manda a transcribir; lo que vuelve se AÑADE
   * a lo que ya hubiera escrito, no lo sustituye: mucha gente teclea cuatro palabras y
   * luego dicta el detalle.
   */
  async alternarDictado(): Promise<void> {
    if (this.grabando()) {
      this.grabadora?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.trozosAudio = [];
      const rec = new MediaRecorder(stream);
      this.grabadora = rec;
      rec.ondataavailable = (e) => { if (e.data.size) this.trozosAudio.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        this.grabando.set(false);
        const blob = new Blob(this.trozosAudio, { type: rec.mimeType || 'audio/webm' });
        if (blob.size > 0) await this.transcribirYVolcar(blob, 'dictado.webm');
      };
      rec.start();
      this.grabando.set(true);
    } catch {
      Swal.fire('Sin micrófono', 'El navegador no dio acceso al micrófono. Puedes subir un audio en su lugar.', 'info');
    }
  }

  async audioElegido(ev: Event): Promise<void> {
    const f = (ev.target as HTMLInputElement).files?.[0];
    (ev.target as HTMLInputElement).value = '';
    if (f) await this.transcribirYVolcar(f, f.name);
  }

  private async transcribirYVolcar(audio: Blob, nombre: string): Promise<void> {
    this.ocupadoIa.set(true);
    try {
      const r = await firstValueFrom(this.svc.transcribir(audio, nombre));
      const texto = (r?.texto || '').trim();
      if (!texto) { Swal.fire('Sin texto', 'No se entendió nada en el audio.', 'info'); return; }
      const previo = this.fObjetivo().trim();
      this.fObjetivo.set(previo ? `${previo}\n${texto}` : texto);
    } catch (e) {
      this.avisarError(e);
    } finally {
      this.ocupadoIa.set(false);
    }
  }

  /**
   * Ordena la petición y, con el objetivo ya limpio, deja montado el enjambre que la
   * IA propone. El reparto viene siempre: quien pide "ordena esto" quiere salir de ahí
   * con el encargo listo para lanzar, no con la mitad del trabajo hecho.
   */
  async ordenarPeticion(): Promise<void> {
    this.ocupadoIa.set(true);
    try {
      const r = await firstValueFrom(this.svc.mejorarEncargo({
        objetivo: this.fObjetivo(),
        contexto: this.fContexto(),
      }));
      if (r.objetivo) this.fObjetivo.set(r.objetivo);
      if (r.contexto) this.fContexto.set(r.contexto);
      if (r.metas?.length) this.fMetas.set(r.metas.join('\n'));
      this.preguntasIa.set(r.preguntas ?? []);
      this.aplicarReparto(r.enjambre);
    } catch (e) {
      this.avisarError(e);
    } finally {
      this.ocupadoIa.set(false);
    }
  }

  /** Deja el formulario montado como enjambre (o con un solo agente si basta uno). */
  private aplicarReparto(s: SugerenciaAgentes | undefined): void {
    const agentes = s?.agentes ?? [];
    if (!agentes.length) return;
    this.porqueAgente.set(new Map(agentes.map((a) => [a.clave, a.porque])));
    if (agentes.length > 1) {
      this.fEnjambre.set(true);
      this.fModoEnjambre.set(s?.modo ?? 'paralelo');
      this.fAgentesEnjambre.set(agentes.map((a) => a.clave));
    } else {
      this.fEnjambre.set(false);
      this.fAgente.set(agentes[0].clave);
    }
  }

  /** Plantillas: combinaciones ya decididas, con su esqueleto de objetivo y sus metas. */
  async abrirPlantillas(): Promise<void> {
    let lista: PlantillaEnjambre[];
    try {
      lista = await firstValueFrom(this.svc.plantillas());
    } catch (e) { this.avisarError(e); return; }
    if (!lista.length) { Swal.fire('Sin plantillas', 'Todavía no hay ninguna.', 'info'); return; }

    const esc = (v: string) => String(v ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));
    const tarjetas = lista.map((p) => `
      <button type="button" data-id="${esc(p.id)}" class="tpl-op"
              style="display:block;width:100%;text-align:left;margin:0 0 8px;padding:10px 12px;
                     border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;cursor:pointer">
        <b>${esc(p.nombre)}</b>${p.completa ? '' : ' <span style="color:#b91c1c">· le falta un agente</span>'}
        <br><span style="color:#64748b;font-size:.85rem">${esc(p.para)}</span>
        <br><span style="color:#94a3b8;font-size:.78rem">
          ${p.agentesDetalle.map((a) => esc(a.nombre)).join(' → ')} · ${p.modo}
        </span>
      </button>`).join('');

    const r = await Swal.fire<string>({
      title: 'Plantillas',
      html: `<div style="text-align:left">${tarjetas}</div>`,
      width: 720,
      showConfirmButton: false,
      showCancelButton: true,
      cancelButtonText: 'Cerrar',
      didOpen: () => {
        document.querySelectorAll('.tpl-op').forEach((el) => {
          el.addEventListener('click', () => Swal.close({ isConfirmed: true, isDenied: false, isDismissed: false, value: (el as HTMLElement).dataset['id'] } as never));
        });
      },
    });
    if (!r.isConfirmed || !r.value) return;

    const p = lista.find((x) => x.id === r.value);
    if (!p) return;
    // El objetivo de la plantilla es un esqueleto con huecos [ASI]: se pone SOLO si no
    // habia nada escrito, para no pisar lo que la persona ya redactó.
    if (!this.fObjetivo().trim()) this.fObjetivo.set(p.objetivo);
    if (p.metas.length && !this.fMetas().trim()) this.fMetas.set(p.metas.join('\n'));
    this.fPermiso.set(p.permiso);
    this.fMinutos.set(p.minutos);
    this.porqueAgente.set(new Map(p.agentesDetalle.map((a) => [a.clave, a.descripcion])));
    if (p.agentes.length > 1) {
      this.fEnjambre.set(true);
      this.fModoEnjambre.set(p.modo);
      this.fAgentesEnjambre.set(p.agentes);
    } else {
      this.fEnjambre.set(false);
      this.fAgente.set(p.agentes[0]);
    }
  }

  /** Propone agentes y, si hacen falta varios, deja el encargo montado como enjambre. */
  async proponerAgentes(): Promise<void> {
    this.ocupadoIa.set(true);
    try {
      const r = await firstValueFrom(this.svc.sugerirAgentes(this.fObjetivo()));
      if (!r.agentes?.length) { Swal.fire('Sin propuesta', 'La IA no supo elegir. Escoge tú el agente.', 'info'); return; }

      const nombres = (c: string) => this.catalogo()?.agentes.find((a) => a.clave === c)?.nombre ?? c;
      const lista = r.agentes
        .map((a) => `<li><b>${nombres(a.clave)}</b><br><span style="color:#64748b">${a.porque}</span></li>`)
        .join('');
      const ok = await Swal.fire({
        title: 'Propuesta',
        html: `<ul style="text-align:left;margin:0;padding-left:18px">${lista}</ul>`
          + (r.enjambre ? `<p style="text-align:left;margin:10px 0 0;font-size:.85rem;color:#64748b">Se montaría como enjambre ${r.modo}: una cuenta del pool por agente.</p>` : ''),
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Usar esta propuesta',
        cancelButtonText: 'Elijo yo',
      });
      if (!ok.isConfirmed) return;

      if (r.enjambre && r.agentes.length > 1) {
        this.fEnjambre.set(true);
        this.fModoEnjambre.set(r.modo);
        this.fAgentesEnjambre.set(r.agentes.map((a) => a.clave));
      } else {
        this.fEnjambre.set(false);
        this.fAgente.set(r.agentes[0].clave);
      }
    } catch (e) {
      this.avisarError(e);
    } finally {
      this.ocupadoIa.set(false);
    }
  }

  async documentoElegido(ev: Event): Promise<void> {
    const f = (ev.target as HTMLInputElement).files?.[0];
    (ev.target as HTMLInputElement).value = '';
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) { Swal.fire('Demasiado grande', 'El fichero pasa de 25 MB.', 'info'); return; }
    try {
      const contenidoBase64 = await this.aBase64(f);
      this.fAdjuntos.update((xs) => [...xs.filter((x) => x.nombre !== f.name), { nombre: f.name, contenidoBase64 }]);
    } catch (e) {
      this.avisarError(e);
    }
  }

  quitarAdjunto(nombre: string): void {
    this.fAdjuntos.update((xs) => xs.filter((x) => x.nombre !== nombre));
  }

  // ── Creador de agentes ────────────────────────────────────────────────────

  misionesActivas = computed(() => this.misiones().filter((m) => m.activo).length);
  totalPropios = computed(() => (this.catalogo()?.agentes ?? []).filter((a) => a.propio).length);

  /** Ficha: de qué está hecho el agente, qué ficheros lleva y —si es tuyo— editarlo. */
  async verFicha(a: AgenteCatalogo): Promise<void> {
    let f: AgenteFicha;
    try {
      f = await firstValueFrom(this.svc.fichaAgente(a.clave));
    } catch (e) { this.avisarError(e); return; }

    const esc = (v: string) => String(v ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));
    const adjuntos = f.adjuntos.length
      ? f.adjuntos.map((x) => `<li>${esc(x.nombre)} <span style="color:#94a3b8">· ${Math.max(1, Math.round(x.bytes / 1024))} KB</span></li>`).join('')
      : '<li style="color:#94a3b8">sin ficheros</li>';

    const r = await Swal.fire({
      title: f.nombre,
      html:
        `<div style="text-align:left">
           <p style="margin:0 0 6px"><b>Clave:</b> <code>${esc(f.clave)}</code> · <b>Tipo:</b> ${esc(f.tipo)}
              · <b>Modo:</b> ${f.modo === 'evento' ? 'de evento' : 'de acción'}</p>
           <p style="margin:0 0 6px"><b>Fichero:</b> <code>${esc(f.fichero)}</code></p>
           <p style="margin:0 0 10px">${esc(f.descripcion || '')}</p>
           ${f.capacidades.length ? `<p style="margin:0 0 10px"><b>Capacidades:</b> ${f.capacidades.map(esc).join(', ')}</p>` : ''}
           <p style="margin:0 0 4px"><b>Ficheros adjuntos</b></p>
           <ul style="margin:0 0 10px;padding-left:18px">${adjuntos}</ul>
           <p style="margin:0 0 4px"><b>Instrucciones (${f.persona.split('\\n').length} líneas)</b></p>
           <pre style="max-height:240px;overflow:auto;background:#0f172a;color:#e2e8f0;padding:10px;border-radius:8px;white-space:pre-wrap">${esc(f.persona)}</pre>
           ${f.editable ? '' : '<p style="margin:8px 0 0;font-size:.85rem;color:#64748b">Este agente lo trajo ruflo: es de solo lectura. Duplícalo para poder cambiarlo.</p>'}
         </div>`,
      width: 780,
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: f.editable ? 'Editar' : 'Duplicar para editar',
      denyButtonText: 'Adjuntar fichero',
      cancelButtonText: 'Cerrar',
    });

    if (r.isDenied) { await this.adjuntarAAgente(f); return; }
    if (!r.isConfirmed) return;
    if (f.editable) await this.editarAgente(f);
    else await this.duplicarAgente(f);
  }

  private formularioAgente(f: Partial<AgenteFicha>): string {
    const v = (x: unknown) => String(x ?? '').replace(/"/g, '&quot;');
    return `
      <input id="ag-nombre" class="swal2-input" style="margin:0 0 8px" placeholder="Nombre visible" value="${v(f.nombre)}">
      <input id="ag-desc" class="swal2-input" style="margin:0 0 8px" placeholder="¿Para qué sirve?" value="${v(f.descripcion)}">
      <input id="ag-caps" class="swal2-input" style="margin:0 0 8px" placeholder="Capacidades, separadas por coma" value="${v((f.capacidades || []).join(', '))}">
      <select id="ag-modo" class="swal2-select" style="display:block;width:100%;margin:0 0 8px">
        <option value="accion"${f.modo !== 'evento' ? ' selected' : ''}>De acción — se le encarga algo puntual</option>
        <option value="evento"${f.modo === 'evento' ? ' selected' : ''}>De evento — cuelga de un disparador</option>
      </select>
      <textarea id="ag-persona" class="swal2-textarea" style="margin:0;height:200px"
                placeholder="Instrucciones del agente: quién es, qué hace y qué NO debe hacer">${String(f.persona ?? '')}</textarea>
      <p style="text-align:left;margin:8px 0 0;font-size:.82rem;color:#64748b">
        Las instrucciones se le inyectan como su personalidad en cada encargo.</p>`;
  }

  private leerFormularioAgente(): { nombre: string; descripcion: string; capacidades: string[]; modo: 'accion' | 'evento'; persona: string } | undefined {
    const g = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)?.value?.trim() ?? '';
    const persona = g('ag-persona');
    if (!persona) { Swal.showValidationMessage('Sin instrucciones el agente no sabe qué es.'); return undefined; }
    return {
      nombre: g('ag-nombre'),
      descripcion: g('ag-desc'),
      capacidades: g('ag-caps').split(',').map((x) => x.trim()).filter(Boolean),
      modo: g('ag-modo') === 'evento' ? 'evento' : 'accion',
      persona,
    };
  }

  async nuevoAgente(): Promise<void> {
    const r = await Swal.fire<Record<string, unknown>>({
      title: 'Nuevo agente',
      html: `<input id="ag-clave" class="swal2-input" style="margin:0 0 8px" placeholder="Clave (ej. revisor-nomina)">`
        + this.formularioAgente({ modo: 'accion' }),
      width: 720,
      showCancelButton: true,
      confirmButtonText: 'Crear',
      cancelButtonText: 'Cancelar',
      focusConfirm: false,
      preConfirm: () => {
        const clave = (document.getElementById('ag-clave') as HTMLInputElement)?.value?.trim() ?? '';
        if (!clave) { Swal.showValidationMessage('Falta la clave.'); return undefined; }
        const base = this.leerFormularioAgente();
        return base ? { clave, ...base } : undefined;
      },
    });
    if (!r.isConfirmed || !r.value) return;
    this.svc.crearAgente(r.value as never).subscribe({
      next: () => { this.cargarFijos(); Swal.fire('Listo', 'El agente ya está en el catálogo.', 'success'); },
      error: (e) => this.avisarError(e),
    });
  }

  private async editarAgente(f: AgenteFicha): Promise<void> {
    const r = await Swal.fire<Record<string, unknown>>({
      title: `Editar «${f.nombre}»`,
      html: this.formularioAgente(f),
      width: 720,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      focusConfirm: false,
      preConfirm: () => this.leerFormularioAgente(),
    });
    if (!r.isConfirmed || !r.value) return;
    this.svc.editarAgente(f.clave, r.value as never).subscribe({
      next: () => { this.cargarFijos(); Swal.fire('Guardado', 'El agente quedó actualizado.', 'success'); },
      error: (e) => this.avisarError(e),
    });
  }

  private async duplicarAgente(f: AgenteFicha): Promise<void> {
    const r = await Swal.fire<string>({
      title: `Duplicar «${f.nombre}»`,
      input: 'text',
      inputValue: `${f.clave}-propio`,
      inputLabel: 'Clave del nuevo agente',
      text: 'Se copia con sus instrucciones a tus agentes, donde sí puedes cambiarlo.',
      showCancelButton: true,
      confirmButtonText: 'Duplicar',
      cancelButtonText: 'Cancelar',
    });
    if (!r.isConfirmed || !r.value) return;
    this.svc.duplicarAgente(f.clave, { clave: r.value }).subscribe({
      next: (n) => { this.cargarFijos(); this.verFicha(n); },
      error: (e) => this.avisarError(e),
    });
  }

  /** Cualquier tipo de fichero: se le entrega al agente cuando trabaja. */
  private async adjuntarAAgente(f: AgenteFicha): Promise<void> {
    const r = await Swal.fire<File>({
      title: `Adjuntar a «${f.nombre}»`,
      html: '<input id="ag-file" type="file" class="swal2-file" style="display:block">'
        + '<p style="text-align:left;margin:10px 0 0;font-size:.82rem;color:#64748b">'
        + 'Cualquier tipo de fichero, hasta 25 MB. El agente lo tendrá a mano —de solo lectura— '
        + 'cada vez que trabaje.</p>',
      width: 620,
      showCancelButton: true,
      confirmButtonText: 'Subir',
      cancelButtonText: 'Cancelar',
      focusConfirm: false,
      preConfirm: () => {
        const el = document.getElementById('ag-file') as HTMLInputElement;
        const file = el?.files?.[0];
        if (!file) { Swal.showValidationMessage('Elige un fichero.'); return undefined; }
        if (file.size > 25 * 1024 * 1024) { Swal.showValidationMessage('El fichero pasa de 25 MB.'); return undefined; }
        return file;
      },
    });
    if (!r.isConfirmed || !r.value) return;

    const file = r.value;
    const b64 = await new Promise<string>((res, rej) => {
      const fr = new FileReader();
      // readAsDataURL da "data:<tipo>;base64,<datos>": el puente solo quiere los datos.
      fr.onload = () => res(String(fr.result).split(',')[1] ?? '');
      fr.onerror = () => rej(new Error('no se pudo leer el fichero'));
      fr.readAsDataURL(file);
    });

    this.svc.subirAdjuntoAgente(f.clave, file.name, b64).subscribe({
      next: () => { this.cargarFijos(); Swal.fire('Subido', `«${file.name}» ya acompaña al agente.`, 'success'); },
      error: (e) => this.avisarError(e),
    });
  }

  // ── Misiones ──────────────────────────────────────────────────────────────

  /** Cuál de los resúmenes del historial está desplegado. */
  resumenAbierto = signal<string | null>(null);

  alternarResumen(id: string): void {
    this.resumenAbierto.update((x) => (x === id ? null : id));
  }

  /** El resumen que deja el agente viene en markdown; se pinta como tal. */
  comoMarkdown(texto: string): SafeHtml {
    // markdownToHtml escapa el texto y solo reintroduce etiquetas de una lista blanca;
    // aun asi se pasa por el sanitizador de Angular como segunda barrera.
    return this.sanitizer.bypassSecurityTrustHtml(markdownToHtml(texto || ''));
  }

  /** Lo que lleva corriendo una tarea viva, contado desde que arrancó. */
  transcurrido(t: Tarea): string {
    const desde = t.inicio || t.creada;
    return this.duracion(Date.now() - desde);
  }

  /** Cuánto de su tiempo permitido lleva gastado, en porcentaje. */
  avanceCorte(t: Tarea): number {
    const tope = (t.minutos || 30) * 60_000;
    const desde = t.inicio || t.creada;
    return Math.min(100, Math.round(((Date.now() - desde) / tope) * 100));
  }

  /**
   * true a partir del 80% del tiempo permitido. Pasado el corte la tarea muere y se
   * pierde lo que llevara sin resumir, así que conviene verlo venir.
   */
  cercaDelCorte(t: Tarea): boolean {
    return this.avanceCorte(t) >= 80;
  }

  describirDisparo(d: DisparoMision): string {
    const dias = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
    switch (d?.tipo) {
      case 'diario': {
        const cuales = d.dias?.length ? d.dias.map((x) => dias[x]).join(', ') : 'todos los días';
        return `a las ${d.hora} · ${cuales}`;
      }
      case 'cron': return `cron: ${d.cron}`;
      case 'unaVez': return d.cuando ? `una vez el ${new Date(d.cuando).toLocaleString()}` : 'una sola vez';
      default: {
        const m = d?.cadaMinutos ?? 240;
        return m % 60 === 0 ? `cada ${m / 60} h` : `cada ${m} min`;
      }
    }
  }

  private formularioMision(m: Partial<Mision>): string {
    const v = (x: unknown) => String(x ?? '').replace(/"/g, '&quot;');
    const d = m.disparo ?? { tipo: 'recurrente', cadaMinutos: 240 };
    const opciones = (this.catalogo()?.agentes ?? [])
      .map((a) => `<option value="${v(a.clave)}"${(m.agentes || []).includes(a.clave) ? ' selected' : ''}>${v(a.nombre)}</option>`)
      .join('');
    const repos = (this.repos() ?? [])
      .map((r) => `<option value="${v(r.clave)}"${m.repo === r.clave ? ' selected' : ''}>${v(r.nombre)}</option>`)
      .join('');
    return `
      <input id="mi-nombre" class="swal2-input" style="margin:0 0 8px" placeholder="Nombre de la misión" value="${v(m.nombre)}">
      <textarea id="mi-obj" class="swal2-textarea" style="margin:0 0 8px;height:90px" placeholder="¿Qué tienen que hacer?">${String(m.objetivo ?? '')}</textarea>
      <textarea id="mi-metas" class="swal2-textarea" style="margin:0 0 8px;height:60px" placeholder="Metas, una por línea (cuándo está bien hecho)">${(m.metas ?? []).join('\\n')}</textarea>
      <label style="display:block;text-align:left;font-size:.8rem;color:#64748b">Agentes (varios = enjambre)</label>
      <select id="mi-agentes" class="swal2-select" multiple style="display:block;width:100%;height:110px;margin:0 0 8px">${opciones}</select>
      <label style="display:block;text-align:left;font-size:.8rem;color:#64748b">Sobre qué código</label>
      <select id="mi-repo" class="swal2-select" style="display:block;width:100%;margin:0 0 8px">
        <option value="todos"${!m.repo || m.repo === 'todos' ? ' selected' : ''}>Todo</option>${repos}
      </select>
      <label style="display:block;text-align:left;font-size:.8rem;color:#64748b">¿Cuándo se lanza?</label>
      <select id="mi-tipo" class="swal2-select" style="display:block;width:100%;margin:0 0 8px"
              onchange="document.getElementById('mi-cada').style.display=this.value==='recurrente'?'block':'none';
                        document.getElementById('mi-diario').style.display=this.value==='diario'?'block':'none';
                        document.getElementById('mi-cron').style.display=this.value==='cron'?'block':'none';
                        document.getElementById('mi-cuando').style.display=this.value==='unaVez'?'block':'none';">
        <option value="recurrente"${d.tipo === 'recurrente' ? ' selected' : ''}>Cada cierto tiempo</option>
        <option value="diario"${d.tipo === 'diario' ? ' selected' : ''}>A una hora fija</option>
        <option value="cron"${d.tipo === 'cron' ? ' selected' : ''}>Expresión cron</option>
        <option value="unaVez"${d.tipo === 'unaVez' ? ' selected' : ''}>Una sola vez</option>
      </select>
      <input id="mi-cada" class="swal2-input" style="margin:0 0 8px;display:${d.tipo === 'recurrente' || !d.tipo ? 'block' : 'none'}"
             type="number" min="15" placeholder="Cada cuántos minutos" value="${v(d.cadaMinutos ?? 240)}">
      <div id="mi-diario" style="display:${d.tipo === 'diario' ? 'block' : 'none'}">
        <input id="mi-hora" class="swal2-input" style="margin:0 0 8px" type="time" value="${v(d.hora ?? '08:00')}">
        <input id="mi-dias" class="swal2-input" style="margin:0 0 8px" placeholder="Días: 1,2,3,4,5 (0=domingo). Vacío = todos" value="${v((d.dias ?? []).join(','))}">
      </div>
      <input id="mi-cron" class="swal2-input" style="margin:0 0 8px;display:${d.tipo === 'cron' ? 'block' : 'none'}"
             placeholder="min hora día mes día-semana — ej. 30 7 * * 1-5" value="${v(d.cron ?? '')}">
      <input id="mi-cuando" class="swal2-input" style="margin:0 0 8px;display:${d.tipo === 'unaVez' ? 'block' : 'none'}"
             type="datetime-local" value="${d.cuando ? new Date(d.cuando - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}">`;
  }

  private leerFormularioMision(): Partial<Mision> | undefined {
    const g = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement)?.value?.trim() ?? '';
    const objetivo = g('mi-obj');
    if (!objetivo) { Swal.showValidationMessage('Falta el objetivo.'); return undefined; }
    const sel = document.getElementById('mi-agentes') as HTMLSelectElement;
    const agentes = Array.from(sel?.selectedOptions ?? []).map((o) => o.value);
    if (!agentes.length) { Swal.showValidationMessage('Elige al menos un agente.'); return undefined; }

    const tipo = (document.getElementById('mi-tipo') as HTMLSelectElement)?.value as DisparoMision['tipo'];
    let disparo: DisparoMision;
    if (tipo === 'diario') {
      disparo = {
        tipo, hora: g('mi-hora') || '08:00',
        dias: g('mi-dias').split(',').map((x) => Number(x.trim())).filter((x) => x >= 0 && x <= 6),
      };
    } else if (tipo === 'cron') {
      const cron = g('mi-cron');
      if (cron.split(/\s+/).length !== 5) { Swal.showValidationMessage('El cron necesita 5 campos.'); return undefined; }
      disparo = { tipo, cron };
    } else if (tipo === 'unaVez') {
      const cuando = g('mi-cuando');
      if (!cuando) { Swal.showValidationMessage('Falta la fecha y la hora.'); return undefined; }
      disparo = { tipo, cuando: new Date(cuando).getTime() };
    } else {
      disparo = { tipo: 'recurrente', cadaMinutos: Math.max(15, Number(g('mi-cada')) || 240) };
    }

    return {
      nombre: g('mi-nombre') || objetivo.slice(0, 40),
      objetivo,
      metas: g('mi-metas').split('\n').map((x) => x.trim()).filter(Boolean),
      agentes,
      repo: (document.getElementById('mi-repo') as HTMLSelectElement)?.value || 'todos',
      disparo,
    };
  }

  async nuevaMision(): Promise<void> {
    const r = await Swal.fire<Partial<Mision>>({
      title: 'Nueva misión',
      html: this.formularioMision({}),
      width: 720,
      showCancelButton: true,
      confirmButtonText: 'Crear',
      cancelButtonText: 'Cancelar',
      focusConfirm: false,
      preConfirm: () => this.leerFormularioMision(),
    });
    if (!r.isConfirmed || !r.value) return;
    this.svc.crearMision(r.value).subscribe({
      next: () => this.cargarMisiones(),
      error: (e) => this.avisarError(e),
    });
  }

  async editarMision(m: Mision): Promise<void> {
    const r = await Swal.fire<Partial<Mision>>({
      title: `Editar «${m.nombre}»`,
      html: this.formularioMision(m),
      width: 720,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      focusConfirm: false,
      preConfirm: () => this.leerFormularioMision(),
    });
    if (!r.isConfirmed || !r.value) return;
    this.svc.editarMision(m.id, r.value).subscribe({
      next: () => this.cargarMisiones(),
      error: (e) => this.avisarError(e),
    });
  }

  alternarMision(m: Mision): void {
    this.svc.editarMision(m.id, { activo: !m.activo }).subscribe({
      next: () => this.cargarMisiones(),
      error: (e) => this.avisarError(e),
    });
  }

  lanzarMisionYa(m: Mision): void {
    this.svc.lanzarMision(m.id).subscribe({
      next: (t) => { this.cargarMisiones(); this.refrescar(); if (t?.id) this.abrirConsola(t); },
      error: (e) => this.avisarError(e),
    });
  }

  async borrarMision(m: Mision): Promise<void> {
    const ok = await Swal.fire({
      title: `¿Borrar «${m.nombre}»?`,
      text: 'Deja de lanzarse. El historial de lo que ya hizo se conserva.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Borrar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#dc2626',
    });
    if (!ok.isConfirmed) return;
    this.svc.borrarMision(m.id).subscribe({
      next: () => this.cargarMisiones(),
      error: (e) => this.avisarError(e),
    });
  }

  /**
   * Explica lo que va a pasar y pide el visto bueno: quien trabaja, en que orden, sobre
   * que codigo, con que permisos y cuanto puede durar. Devuelve false si se cancela.
   */
  private async confirmarPlan(comun: {
    objetivo: string; contexto: string | null; repo: string; prioridad: number;
    permiso: string; minutos: number; metas: string[];
    adjuntos: { nombre: string }[];
  }): Promise<boolean> {
    const esc = (v: string) => String(v ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));
    const claves = this.fEnjambre() ? this.fAgentesEnjambre() : [this.fAgente()].filter(Boolean);
    if (!claves.length) {
      Swal.fire('Elige agentes', 'Un encargo necesita al menos un agente.', 'info');
      return false;
    }

    const porque = this.porqueAgente();
    const secuencial = this.fEnjambre() && this.fModoEnjambre() === 'secuencial';
    const pasos = claves.map((c, i) => {
      const a = this.catalogo()?.agentes.find((x) => x.clave === c);
      const razon = porque.get(c) || a?.descripcion || '';
      return `<li style="margin:0 0 6px">
                ${secuencial ? `<b>${i + 1}.</b> ` : ''}<b>${esc(a?.nombre || c)}</b>
                ${razon ? `<br><span style="color:#64748b;font-size:.86rem">${esc(razon)}</span>` : ''}
              </li>`;
    }).join('');

    // Cuanto suele tardar esto, segun lo que esos agentes ya hicieron. Si no hay
    // historial no se inventa un numero: se dice que no se sabe.
    let estimacion = '';
    try {
      const e = await firstValueFrom(this.svc.estimar(claves, secuencial ? 'secuencial' : 'paralelo'));
      if (e.totalMs) {
        const pasaDelCorte = e.totalMs > comun.minutos * 60_000;
        estimacion = `<p style="margin:8px 0 0;font-size:.86rem;${pasaDelCorte ? 'color:#b91c1c' : 'color:#334155'}">
            Suele tardar <b>${esc(this.duracion(e.totalMs))}</b>
            ${e.completa ? '' : ' (al menos: alguno no tiene historial todavia)'}
            ${e.costeTotalUsd ? ` · ronda los ${e.costeTotalUsd.toFixed(2)} USD` : ''}
            ${pasaDelCorte ? `<br><b>Ojo:</b> eso pasa del corte de ${comun.minutos} min y moriria a medias. Sube el corte antes de lanzar.` : ''}
          </p>`;
      } else {
        estimacion = '<p style="margin:8px 0 0;font-size:.86rem;color:#94a3b8">Sin historial de estos agentes todavia: no se sabe cuanto tardara.</p>';
      }
    } catch {
      // Que no se pueda estimar no puede impedir lanzar.
    }

    const libres = this.estado()?.pool.listas ?? 0;
    const avisoCuentas = claves.length > libres && !secuencial
      ? `<p style="margin:8px 0 0;color:#9a3412">Hay ${libres} cuenta(s) libre(s) y el enjambre pide ${claves.length}:
         los que no quepan esperan turno en la cola.</p>`
      : '';

    const repoNombre = this.repos().find((r) => r.clave === comun.repo)?.nombre
      || (comun.repo === 'todos' ? 'todo el proyecto' : comun.repo);

    const r = await Swal.fire({
      title: this.fEnjambre() ? 'Plan del enjambre' : 'Plan del encargo',
      html: `<div style="text-align:left">
        <p style="margin:0 0 4px"><b>Qué se pide</b></p>
        <p style="margin:0 0 12px;color:#334155">${esc(comun.objetivo)}</p>

        <p style="margin:0 0 4px"><b>Quién trabaja</b>
          <span style="color:#64748b;font-weight:400">
            · ${secuencial ? 'uno detrás de otro' : 'todos a la vez'}</span></p>
        <ul style="margin:0 0 12px;padding-left:18px">${pasos}</ul>

        ${comun.metas.length ? `<p style="margin:0 0 4px"><b>No termina hasta</b></p>
          <ul style="margin:0 0 12px;padding-left:18px;color:#334155">
            ${comun.metas.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}

        ${comun.adjuntos.length ? `<p style="margin:0 0 4px"><b>Con estos documentos</b></p>
          <p style="margin:0 0 12px;color:#334155">${comun.adjuntos.map((a) => esc(a.nombre)).join(', ')}</p>` : ''}

        <p style="margin:0;color:#64748b;font-size:.86rem">
          Sobre <b>${esc(repoNombre)}</b> · ${esc(this.textoPermiso(comun.permiso))} ·
          se corta a los ${comun.minutos} min · ocupa ${claves.length} cuenta(s) del pool.
        </p>
        ${estimacion}
        <p style="margin:6px 0 0;color:#64748b;font-size:.86rem">
          Trabajan sobre la copia aislada, nunca sobre producción.</p>
        ${avisoCuentas}
      </div>`,
      width: 720,
      showCancelButton: true,
      confirmButtonText: this.fEnjambre() ? 'Lanzar el enjambre' : 'Lanzar',
      cancelButtonText: 'Ajustar antes',
    });
    return r.isConfirmed;
  }

  private textoPermiso(p: string): string {
    switch (p) {
      case 'plan': return 'solo planifica, no toca ficheros';
      case 'acceptEdits': return 'puede editar ficheros';
      case 'bypassPermissions': return 'sin pedir permiso para nada';
      default: return p;
    }
  }

  encargarleA(a: AgenteCatalogo): void {
    this.fAgente.set(a.clave);
    this.fEnjambre.set(false);
    this.pestana.set('nuevo');
  }

  alternarEnEnjambre(clave: string): void {
    const actuales = this.fAgentesEnjambre();
    this.fAgentesEnjambre.set(
      actuales.includes(clave) ? actuales.filter((x) => x !== clave) : [...actuales, clave],
    );
  }

  estaEnEnjambre(clave: string): boolean {
    return this.fAgentesEnjambre().includes(clave);
  }

  alternarPausaCuenta(c: Cuenta): void {
    this.svc.editarCuenta(c.id, { pausada: !c.pausada }).subscribe({
      next: () => this.refrescar(),
      error: (e) => this.avisarError(e),
    });
  }

  despertarCuenta(c: Cuenta): void {
    this.svc.despertarCuenta(c.id).subscribe({
      next: () => this.refrescar(),
      error: (e) => this.avisarError(e),
    });
  }

  /**
   * Dos caminos para dejar una ranura autenticada, porque solo uno cabe en una web:
   *
   *  - Pegar una credencial YA emitida (API key de Anthropic o el token largo de
   *    `claude setup-token`). Funciona desde aquí.
   *  - El OAuth de `claude auth login`, que abre una página en un navegador y no tiene
   *    modo headless: eso hay que hacerlo desde el servidor.
   */
  async comoIniciarSesion(c: Cuenta): Promise<void> {
    const elegir = await Swal.fire({
      title: `Dar acceso a «${c.nombre}»`,
      html:
        '<p style="text-align:left;margin:0 0 10px">Lo normal es <b>iniciar sesión con Claude</b>: te damos el enlace, ' +
        'autorizas en tu navegador y pegas aquí el código. La sesión queda en el servidor, a nombre de su titular.</p>' +
        '<p style="text-align:left;margin:0;font-size:.85rem;color:#64748b">La otra vía es pegar una clave ya emitida ' +
        '—una API key de Anthropic o el token de <code>claude setup-token</code>—.</p>',
      icon: 'question',
      width: 620,
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: 'Iniciar sesión con Claude',
      denyButtonText: 'Pegar una clave',
      cancelButtonText: 'Cancelar',
    });

    if (elegir.isConfirmed) { await this.loginConEnlace(c); return; }
    if (!elegir.isDenied) return;

    const datos = await Swal.fire<{ tipo: 'apikey' | 'token'; valor: string }>({
      title: `Clave de «${c.nombre}»`,
      html:
        '<select id="ag-tipo" class="swal2-select" style="display:block;width:100%;margin:0 0 10px">' +
        '<option value="apikey">API key de Anthropic (sk-ant-…)</option>' +
        '<option value="token">Token largo de claude setup-token</option>' +
        '</select>' +
        '<input id="ag-valor" type="password" autocomplete="off" class="swal2-input" ' +
        'style="margin:0" placeholder="Pega aquí la clave">' +
        '<p style="text-align:left;margin:10px 0 0;font-size:.82rem;color:#64748b">Se guarda en el servidor con ' +
        'permisos 0600 y no vuelve a mostrarse en ningún sitio.</p>',
      width: 620,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      focusConfirm: false,
      preConfirm: () => {
        const tipo = (document.getElementById('ag-tipo') as HTMLSelectElement)?.value as 'apikey' | 'token';
        const valor = (document.getElementById('ag-valor') as HTMLInputElement)?.value?.trim() ?? '';
        if (valor.length < 20) {
          Swal.showValidationMessage('La clave parece incompleta.');
          return undefined;
        }
        return { tipo, valor };
      },
    });

    if (!datos.isConfirmed || !datos.value) return;
    this.svc.guardarCredencial(c.id, datos.value.tipo, datos.value.valor).subscribe({
      next: () => {
        this.refrescar();
        Swal.fire('Listo', `«${c.nombre}» ya puede coger trabajo.`, 'success');
      },
      error: (e) => this.avisarError(e),
    });
  }

  /**
   * Inicio de sesión en dos pasos, sin entrar al servidor: se pide el enlace, la
   * persona autoriza en su navegador y trae el código. El CLI queda esperando en el
   * host entre ambos pasos, así que si se cancela hay que avisarle.
   */
  private async loginConEnlace(c: Cuenta): Promise<void> {
    Swal.fire({ title: 'Pidiendo el enlace…', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    let url: string;
    try {
      const r = await firstValueFrom(this.svc.iniciarLogin(c.id));
      url = r.url;
    } catch (e) {
      this.avisarError(e);
      return;
    }

    // El enlace se da para COPIAR, no solo para abrir: cada cuenta del pool suele
    // vivir en otro navegador o en otro perfil de Chrome, y "Abrir" lo lanzaría en
    // esta misma ventana, que es justo la sesión equivocada.
    const seguro = escaparHtml(url);
    const datos = await Swal.fire<string>({
      title: `Iniciar sesión en «${c.nombre}»`,
      html:
        '<p style="text-align:left;margin:0 0 10px">Copia este enlace y ábrelo donde tengas la sesión de <b>' +
        `${escaparHtml(c.titular || 'su titular')}</b> —otro navegador, otro perfil o el móvil—. Autoriza allí y ` +
        'trae de vuelta el código:</p>' +
        '<div style="display:flex;gap:6px;align-items:stretch;margin:0 0 8px">' +
        `<input id="ag-url" readonly value="${seguro}" ` +
        'style="flex:1;min-width:0;font-size:.78rem;padding:9px 10px;border:1px solid #d9dde3;' +
        'border-radius:8px;background:#f8fafc;color:#334155;font-family:ui-monospace,monospace">' +
        '<button type="button" id="ag-copiar" class="swal2-styled" ' +
        'style="margin:0;background:#6d28d9;font-size:.85rem;padding:9px 16px;white-space:nowrap">Copiar</button>' +
        '</div>' +
        `<a href="${seguro}" target="_blank" rel="noopener" ` +
        'style="display:inline-block;margin:0 0 14px;font-size:.82rem;color:#6d28d9">' +
        'Abrirlo aquí mismo (solo si esta ventana ya es la de esa cuenta)</a>' +
        '<input id="ag-codigo" class="swal2-input" style="margin:0" autocomplete="off" ' +
        'placeholder="Pega aquí el código">' +
        '<p style="text-align:left;margin:10px 0 0;font-size:.82rem;color:#64748b">El enlace caduca en 10 minutos. ' +
        'El código es de un solo uso y no se guarda en ningún sitio.</p>',
      width: 640,
      showCancelButton: true,
      confirmButtonText: 'Validar',
      cancelButtonText: 'Cancelar',
      focusConfirm: false,
      allowOutsideClick: false,
      didOpen: () => this.cablearCopiaDeEnlace(url),
      preConfirm: () => {
        const v = (document.getElementById('ag-codigo') as HTMLInputElement)?.value?.trim() ?? '';
        if (!v) { Swal.showValidationMessage('Falta el código.'); return undefined; }
        return v;
      },
    });

    if (!datos.isConfirmed || !datos.value) {
      // Hay un `claude` esperando en el host: sin esto se quedaría colgado 10 minutos.
      this.svc.cancelarLogin(c.id).subscribe({ next: () => this.refrescar(), error: () => this.refrescar() });
      return;
    }

    Swal.fire({ title: 'Validando…', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    this.svc.completarLogin(c.id, datos.value).subscribe({
      next: () => {
        this.refrescar();
        Swal.fire('Sesión iniciada', `«${c.nombre}» ya puede coger trabajo.`, 'success');
      },
      error: (e) => this.avisarError(e),
    });
  }

  /**
   * Botón «Copiar» del enlace de autorización. Va aquí y no en la plantilla porque el
   * diálogo lo pinta SweetAlert como HTML suelto, fuera del alcance de Angular.
   *
   * Tres intentos, de mejor a peor: la API del portapapeles (necesita contexto seguro),
   * el execCommand de toda la vida, y dejar el texto seleccionado para que la persona
   * haga Ctrl+C. En los tres casos el botón dice qué pasó.
   */
  private cablearCopiaDeEnlace(url: string): void {
    const boton = document.getElementById('ag-copiar') as HTMLButtonElement | null;
    const campo = document.getElementById('ag-url') as HTMLInputElement | null;
    if (!boton || !campo) return;

    campo.addEventListener('focus', () => campo.select());

    boton.addEventListener('click', async () => {
      let copiado = false;
      try {
        await navigator.clipboard.writeText(url);
        copiado = true;
      } catch {
        campo.focus();
        campo.select();
        try { copiado = document.execCommand('copy'); } catch { copiado = false; }
      }
      if (!copiado) { campo.focus(); campo.select(); }
      boton.textContent = copiado ? '¡Copiado!' : 'Pulsa Ctrl+C';
      boton.style.background = copiado ? '#059669' : '#d97706';
      setTimeout(() => {
        boton.textContent = 'Copiar';
        boton.style.background = '#6d28d9';
      }, 2500);
    });
  }

  /** Alta de una ranura nueva. El titular es obligatorio: la ranura es el asiento de alguien. */
  async nuevaCuenta(): Promise<void> {
    const datos = await Swal.fire<{ id: string; nombre: string; titular: string }>({
      title: 'Nueva ranura del pool',
      html:
        '<input id="ag-id" class="swal2-input" style="margin:0 0 8px" placeholder="Identificador (p. ej. cuenta-4)">' +
        '<input id="ag-nombre" class="swal2-input" style="margin:0 0 8px" placeholder="Nombre visible">' +
        '<input id="ag-titular" class="swal2-input" style="margin:0" placeholder="Titular (correo de la persona)">' +
        '<p style="text-align:left;margin:10px 0 0;font-size:.82rem;color:#64748b">Cada ranura es el asiento de una ' +
        'persona real que autoriza su uso desatendido.</p>',
      width: 620,
      showCancelButton: true,
      confirmButtonText: 'Crear',
      cancelButtonText: 'Cancelar',
      focusConfirm: false,
      preConfirm: () => {
        const id = (document.getElementById('ag-id') as HTMLInputElement)?.value?.trim() ?? '';
        const nombre = (document.getElementById('ag-nombre') as HTMLInputElement)?.value?.trim() ?? '';
        const titular = (document.getElementById('ag-titular') as HTMLInputElement)?.value?.trim() ?? '';
        if (!id) { Swal.showValidationMessage('Falta el identificador.'); return undefined; }
        if (!titular) { Swal.showValidationMessage('Falta el titular: sin dueño la ranura no debe existir.'); return undefined; }
        return { id, nombre: nombre || id, titular };
      },
    });

    if (!datos.isConfirmed || !datos.value) return;
    this.svc.crearCuenta(datos.value).subscribe({
      next: () => this.refrescar(),
      error: (e) => this.avisarError(e),
    });
  }

  async borrarCuenta(c: Cuenta): Promise<void> {
    const ok = await Swal.fire({
      title: `¿Quitar «${c.nombre}» del pool?`,
      html:
        '<p style="text-align:left;margin:0">Deja de repartírsele trabajo. El perfil en el servidor ' +
        '<b>no</b> se borra, así que su titular no pierde la sesión.</p>',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Quitar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#dc2626',
    });
    if (!ok.isConfirmed) return;
    this.svc.borrarCuenta(c.id).subscribe({
      next: () => this.refrescar(),
      error: (e) => this.avisarError(e),
    });
  }

  async cerrarSesionCuenta(c: Cuenta): Promise<void> {
    const ok = await Swal.fire({
      title: `¿Cerrar la sesión de «${c.nombre}»?`,
      text: 'La ranura seguirá en el pool, pero dejará de coger trabajo hasta que vuelvas a darle acceso.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Cerrar sesión',
      cancelButtonText: 'Cancelar',
    });
    if (!ok.isConfirmed) return;
    this.svc.olvidarCredencial(c.id).subscribe({
      next: () => this.refrescar(),
      error: (e) => this.avisarError(e),
    });
  }

  alternarVigilante(v: Vigilante): void {
    this.svc.editarVigilante(v.id, { activo: !v.activo }).subscribe({
      next: () => this.refrescar(),
      error: (e) => this.avisarError(e),
    });
  }

  dispararVigilante(v: Vigilante): void {
    this.svc.dispararVigilante(v.id).subscribe({
      next: (t) => { this.refrescar(); this.abrirConsola(t); },
      error: (e) => this.avisarError(e),
    });
  }

  private avisarError(e: unknown): void {
    const err = e as { status?: number; error?: unknown };
    let detalle = 'No se pudo completar la operación.';
    if (err?.status === 503) detalle = 'El servicio de agentes no responde en el host.';
    else if (err?.status === 403) detalle = 'Este modo es solo para administradores.';
    else if (typeof err?.error === 'string') detalle = err.error;
    else if (err?.error && typeof err.error === 'object' && 'error' in (err.error as object)) {
      detalle = String((err.error as { error: unknown }).error);
    }
    Swal.fire('No se pudo', detalle, 'error');
  }

  // ── Ayudas de plantilla ───────────────────────────────────────────────────

  estaViva(t: Tarea): boolean {
    return t.estado === 'pendiente' || t.estado === 'asignada' || t.estado === 'en_curso';
  }

  iconoEstado(estado: string): string {
    switch (estado) {
      case 'ok': return 'check_circle';
      case 'error': return 'error';
      case 'limite': return 'hourglass_disabled';
      case 'cancelada': return 'cancel';
      case 'interrumpida': return 'power_off';
      case 'en_curso': return 'bolt';
      case 'asignada': return 'play_circle';
      default: return 'schedule';
    }
  }

  etiquetaEstado(estado: string): string {
    switch (estado) {
      case 'ok': return 'Terminada';
      case 'error': return 'Falló';
      case 'limite': return 'Sin cupo';
      case 'cancelada': return 'Cancelada';
      case 'interrumpida': return 'Interrumpida';
      case 'en_curso': return 'Trabajando';
      case 'asignada': return 'Arrancando';
      default: return 'En cola';
    }
  }

  etiquetaCuenta(estado: string): string {
    switch (estado) {
      case 'lista': return 'Libre';
      case 'trabajando': return 'Trabajando';
      case 'enfriando': return 'Enfriando';
      case 'pausada': return 'En pausa';
      case 'sesion_caducada': return 'Sesión caducada';
      default: return 'Sin sesión';
    }
  }

  duracion(ms: number | null | undefined): string {
    if (!ms || ms < 0) return '—';
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min ${s % 60} s`;
    return `${Math.floor(m / 60)} h ${m % 60} min`;
  }

  faltan(ms: number | null): string {
    if (ms == null) return '—';
    const m = Math.round(ms / 60000);
    if (m <= 0) return 'ya toca';
    if (m < 60) return `en ${m} min`;
    return `en ${Math.floor(m / 60)} h ${m % 60} min`;
  }

  nombreCorto(ruta: string): string {
    const p = ruta.split('/');
    return p.slice(-2).join('/');
  }
}
