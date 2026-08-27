import {
  Component, ChangeDetectionStrategy, OnInit, OnDestroy, signal, computed, inject, PLATFORM_ID,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
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
} from '../../service/agentes.service';

type Pestana = 'panel' | 'nuevo' | 'agentes' | 'misiones' | 'historial';

/** Cada cuánto se refresca el panel. Ojo: /ia/** va con rate limit en el gateway. */
const MS_REFRESCO_PANEL = 3000;
const MS_REFRESCO_CONSOLA = 2000;

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

  encargar(): void {
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
    };
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
          this.fObjetivo.set('');
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
        this.fObjetivo.set('');
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

    const seguro = url.replace(/"/g, '&quot;');
    const datos = await Swal.fire<string>({
      title: `Iniciar sesión en «${c.nombre}»`,
      html:
        '<p style="text-align:left;margin:0 0 10px">Abre este enlace, entra con la cuenta de <b>' +
        `${c.titular || 'su titular'}</b> y copia el código que te dé:</p>` +
        `<a href="${seguro}" target="_blank" rel="noopener" class="swal2-confirm swal2-styled" ` +
        'style="display:block;margin:0 0 12px;text-decoration:none">Abrir la página de Claude</a>' +
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

  duracion(ms: number): string {
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
