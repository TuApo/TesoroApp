import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NotificationCenterService, NotificationPreference, NotificationType } from '@/app/core/services/notification-center.service';
import { obtenerUsuarioActual } from '@/app/core/utils/usuario-actual';
import { TareasApiService } from '../../services/tareas-api.service';
import { DirectorioService, sinTildes } from '../../services/directorio.service';
import { TareasDialogosService } from '../../services/tareas-dialogos.service';
import { Espacio, Parametro, Plantilla, RegistroAuditoria, RegistroImportacion, TipoLista } from '../../models/tareas.models';
import { TIPOS_LISTA, hace, mensajeError } from '../../utils/tareas-ui';

type Pestana = 'parametros' | 'plantillas' | 'avisos' | 'importar' | 'auditoria';

const GRUPOS: Record<string, { titulo: string; icono: string; ayuda: string }> = {
  NOTIFICACIONES: { titulo: 'Avisos automáticos', icono: 'notifications_active',
    ayuda: 'Qué genera un aviso en la bandeja de Notificaciones. Cada persona puede además silenciar tipos en «Mis avisos».' },
  SEGUIMIENTO: { titulo: 'Seguimiento compartido', icono: 'visibility', ayuda: 'Quién queda siguiendo una tarea sin pedirlo.' },
  TABLEROS: { titulo: 'Tableros', icono: 'view_kanban', ayuda: 'Cómo nacen los tableros y las tareas nuevas.' },
  ACCESO: { titulo: 'Acceso', icono: 'lock', ayuda: 'Qué puede hacer cada quien en los espacios.' },
  IA: { titulo: 'Inteligencia artificial', icono: 'auto_awesome',
    ayuda: 'Asistente para crear tableros, tareas y plantillas desde documentos, y el enjambre de agentes (solo administración).' },
};

const OPCIONES: Record<string, string> = {
  LOW: 'Baja', MEDIUM: 'Media', HIGH: 'Alta', URGENT: 'Urgente',
  MEMBER: 'Abierto: crean y editan', VIEWER: 'Cerrado: solo consultan',
};

interface FilaLista { nombre: string; tipo: TipoLista }

/**
 * Parametrización del módulo: lo que antes estaba fijo en el código (a quién avisar, con
 * cuánta anticipación, columnas por defecto, acceso de no miembros), las preferencias de
 * avisos de cada persona, la importación desde Excel y la auditoría.
 */
@Component({
  selector: 'app-configuracion-tareas',
  standalone: true,
  imports: [
    DatePipe, FormsModule, MatIconModule, MatButtonModule, MatSlideToggleModule, MatSelectModule, MatFormFieldModule,
    MatInputModule, MatProgressSpinnerModule, MatSnackBarModule, MatTooltipModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './configuracion.component.html',
  styleUrls: ['./configuracion.component.css'],
})
export class ConfiguracionComponent {
  private readonly api = inject(TareasApiService);
  private readonly centro = inject(NotificationCenterService);
  readonly dir = inject(DirectorioService);
  private readonly snack = inject(MatSnackBar);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialogos = inject(TareasDialogosService);

  readonly esAdmin = ['ADMIN', 'GERENCIA'].includes((obtenerUsuarioActual().rol || '').toUpperCase());
  readonly pestana = signal<Pestana>((this.route.snapshot.queryParamMap.get('tab') as Pestana) || 'parametros');

  // Parámetros
  readonly parametros = signal<Parametro[]>([]);
  readonly cargandoParametros = signal(true);
  readonly borradores = signal<Record<string, string>>({});
  readonly listasEditadas = signal<FilaLista[]>([]);
  readonly tiposLista = TIPOS_LISTA.filter(t => t.clave !== 'UNASSIGNED').concat(TIPOS_LISTA.filter(t => t.clave === 'UNASSIGNED'));
  readonly grupos = computed(() => {
    const m = new Map<string, Parametro[]>();
    for (const p of this.parametros()) m.set(p.grupo, [...(m.get(p.grupo) ?? []), p]);
    const orden = Object.keys(GRUPOS);
    return [...m.entries()]
      .sort((a, b) => (orden.indexOf(a[0]) + 99 * Number(!orden.includes(a[0]))) - (orden.indexOf(b[0]) + 99 * Number(!orden.includes(b[0]))))
      .map(([clave, items]) => ({ clave, ...(GRUPOS[clave] ?? { titulo: clave, icono: 'tune', ayuda: '' }), items }));
  });

  // Plantillas
  readonly plantillas = signal<Plantilla[]>([]);
  readonly cargandoPlantillas = signal(false);
  readonly buscarPlantilla = signal('');
  readonly plantillasPorArea = computed(() => {
    const q = sinTildes(this.buscarPlantilla().trim());
    const m = new Map<string, Plantilla[]>();
    for (const p of this.plantillas()) {
      if (q && !sinTildes(`${p.nombre} ${p.area} ${p.descripcion ?? ''}`).includes(q)) continue;
      m.set(p.area, [...(m.get(p.area) ?? []), p]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es')).map(([area, items]) => ({ area, items }));
  });

  // Avisos
  readonly tipos = signal<NotificationType[]>([]);
  readonly preferencias = signal<NotificationPreference[]>([]);
  readonly cargandoAvisos = signal(false);

  // Importar
  readonly espacios = signal<Espacio[]>([]);
  readonly importaciones = signal<RegistroImportacion[]>([]);
  readonly importando = signal(false);
  espacioImportar: number | null = null;
  archivo: File | null = null;

  // Auditoría
  readonly auditoria = signal<RegistroAuditoria[]>([]);
  readonly filtroAuditoria = signal<string | null>(null);
  readonly cargandoAuditoria = signal(false);
  readonly auditoriaFiltrada = computed(() => {
    const f = this.filtroAuditoria();
    return f ? this.auditoria().filter(a => a.entity_type === f) : this.auditoria();
  });

  constructor() {
    this.dir.cargar();
    this.cargarPestana(this.pestana());
  }

  /** Cambia de pestaña y la deja en la URL (?tab=) para poder compartir el enlace. */
  abrirPestana(p: Pestana): void {
    this.pestana.set(p);
    this.router.navigate([], { relativeTo: this.route, queryParams: { tab: p === 'parametros' ? null : p }, replaceUrl: true });
    this.cargarPestana(p);
  }

  private cargarPestana(p: Pestana): void {
    if (p === 'parametros' && !this.parametros().length) this.cargarParametros();
    if (p === 'plantillas' && !this.plantillas().length) this.cargarPlantillas();
    if (p === 'avisos' && !this.tipos().length) this.cargarAvisos();
    if (p === 'importar' && !this.espacios().length) this.cargarImportar();
    if (p === 'auditoria' && !this.auditoria().length) this.cargarAuditoria();
  }

  // ── Plantillas ──
  async cargarPlantillas(): Promise<void> {
    this.cargandoPlantillas.set(true);
    try {
      this.plantillas.set(await this.api.plantillas());
    } catch (e) {
      this.snack.open(mensajeError(e, 'No se pudieron cargar las plantillas.'), 'Cerrar', { duration: 4500 });
    } finally {
      this.cargandoPlantillas.set(false);
    }
  }

  /** Abre la galería con la plantilla elegida: vista previa y "crear tablero". */
  usarPlantilla(p: Plantilla): void { this.dialogos.nuevoTablero({ plantillaId: p.id }); }

  async plantillaConIa(): Promise<void> {
    const r = await this.dialogos.generarConIa({ modo: 'plantilla' });
    if (r?.plantilla) {
      this.snack.open(`Plantilla «${r.plantilla.nombre}» guardada`, undefined, { duration: 3000 });
      this.cargarPlantillas();
    }
  }

  puedeRetirar(p: Plantilla): boolean {
    return this.esAdmin || (p.origen !== 'SISTEMA' && p.creado_por === this.dir.yo.id);
  }

  async retirarPlantilla(p: Plantilla): Promise<void> {
    if (!confirm(`¿Retirar la plantilla «${p.nombre}»? Los tableros ya creados con ella no cambian.`)) return;
    try {
      await this.api.eliminarPlantilla(p.id);
      this.plantillas.update(l => l.filter(x => x.id !== p.id));
      this.snack.open('Plantilla retirada', undefined, { duration: 2500 });
    } catch (e) {
      this.snack.open(mensajeError(e), 'Cerrar', { duration: 4500 });
    }
  }

  origenPlantilla(p: Plantilla): string { return p.origen === 'SISTEMA' ? 'Tu-Apo' : p.origen === 'IA' ? 'IA' : 'Equipo'; }

  // ── Parámetros ──
  async cargarParametros(): Promise<void> {
    this.cargandoParametros.set(true);
    try {
      const ps = await this.api.parametros();
      this.parametros.set(ps);
      this.borradores.set(Object.fromEntries(ps.map(p => [p.clave, p.valor ?? ''])));
      const listas = ps.find(p => p.tipo === 'LISTAS');
      this.listasEditadas.set(this.parsearListas(listas?.valor ?? ''));
    } catch (e) {
      this.snack.open(mensajeError(e, 'No se pudieron cargar los parámetros.'), 'Cerrar', { duration: 4500 });
    } finally {
      this.cargandoParametros.set(false);
    }
  }

  borrador(clave: string): string { return this.borradores()[clave] ?? ''; }
  ponerBorrador(clave: string, v: string): void { this.borradores.update(b => ({ ...b, [clave]: String(v ?? '') })); }
  cambiado(p: Parametro): boolean { return (this.borrador(p.clave) ?? '') !== (p.valor ?? ''); }
  etiquetaOpcion(o: string): string { return OPCIONES[o] ?? o; }

  async guardar(p: Parametro, valor?: string): Promise<void> {
    const v = valor ?? this.borrador(p.clave);
    try {
      const nuevo = await this.api.fijarParametro(p.clave, v);
      this.parametros.update(l => l.map(x => x.clave === p.clave ? nuevo : x));
      this.ponerBorrador(p.clave, nuevo.valor ?? '');
      this.snack.open('Guardado. Aplica de inmediato.', undefined, { duration: 2200 });
    } catch (e) {
      this.ponerBorrador(p.clave, p.valor ?? '');
      this.snack.open(mensajeError(e, 'No se pudo guardar.'), 'Cerrar', { duration: 4500 });
    }
  }

  alternar(p: Parametro, on: boolean): void { this.guardar(p, on ? 'true' : 'false'); }

  private parsearListas(raw: string): FilaLista[] {
    return raw.split('|').map(s => s.trim()).filter(Boolean).map(s => {
      const i = s.lastIndexOf(':');
      return { nombre: i > 0 ? s.slice(0, i) : s, tipo: (i > 0 ? s.slice(i + 1) : 'TODO') as TipoLista };
    });
  }

  agregarFila(): void { this.listasEditadas.update(l => [...l, { nombre: '', tipo: 'TODO' }]); }
  quitarFila(i: number): void { this.listasEditadas.update(l => l.filter((_, j) => j !== i)); }
  moverFila(i: number, d: number): void {
    this.listasEditadas.update(l => {
      const n = [...l]; const j = i + d;
      if (j < 0 || j >= n.length) return n;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  }
  editarFila(i: number, campo: keyof FilaLista, v: string): void {
    this.listasEditadas.update(l => l.map((f, j) => j === i ? { ...f, [campo]: v } : f));
  }
  guardarListas(p: Parametro): void {
    const filas = this.listasEditadas().filter(f => f.nombre.trim());
    this.guardar(p, filas.map(f => `${f.nombre.trim().replace(/[|:]/g, ' ')}:${f.tipo}`).join('|'));
  }

  async ejecutarRecordatorios(): Promise<void> {
    try {
      const r = await this.api.ejecutarRecordatorios();
      this.snack.open(`Enviados: ${r.por_vencer} avisos de "por vencer" y ${r.vencidas} de vencidas`, undefined, { duration: 3500 });
    } catch (e) { this.snack.open(mensajeError(e), 'Cerrar', { duration: 4500 }); }
  }

  // ── Mis avisos (preferencias del centro de notificaciones) ──
  async cargarAvisos(): Promise<void> {
    this.cargandoAvisos.set(true);
    try {
      const [tipos, prefs] = await Promise.all([
        firstValueFrom(this.centro.catalogo()), firstValueFrom(this.centro.preferencias()).catch(() => []),
      ]);
      this.tipos.set(tipos.filter(t => t.clave.startsWith('MATDER_') && t.activo).sort((a, b) => a.orden - b.orden));
      this.preferencias.set(prefs);
    } catch (e) {
      this.snack.open(mensajeError(e, 'No se pudieron cargar tus preferencias.'), 'Cerrar', { duration: 4500 });
    } finally {
      this.cargandoAvisos.set(false);
    }
  }

  habilitado(clave: string, canal: 'IN_APP' | 'EMAIL'): boolean {
    const p = this.preferencias().find(x => x.tipo_clave === clave && x.canal === canal);
    return p ? p.habilitado : canal === 'IN_APP';
  }

  async fijarAviso(clave: string, canal: 'IN_APP' | 'EMAIL', habilitado: boolean): Promise<void> {
    try {
      const p = await firstValueFrom(this.centro.fijarPreferencia({ tipo_clave: clave, canal, habilitado }));
      this.preferencias.update(l => [...l.filter(x => !(x.tipo_clave === clave && x.canal === canal)), p]);
    } catch (e) { this.snack.open(mensajeError(e), 'Cerrar', { duration: 4500 }); }
  }

  // ── Importar ──
  async cargarImportar(): Promise<void> {
    try {
      const [es, logs] = await Promise.all([this.api.espacios(), this.api.importaciones().catch(() => [])]);
      this.espacios.set(es.filter(e => e.can_create_boards));
      this.importaciones.set(logs);
      this.espacioImportar = this.espacios()[0]?.id ?? null;
    } catch (e) { this.snack.open(mensajeError(e), 'Cerrar', { duration: 4500 }); }
  }

  elegirArchivo(ev: Event): void { this.archivo = (ev.target as HTMLInputElement).files?.[0] ?? null; }
  soltarArchivo(ev: DragEvent): void { ev.preventDefault(); this.archivo = ev.dataTransfer?.files?.[0] ?? null; }

  async plantilla(): Promise<void> {
    try {
      const blob = await this.api.plantillaImportacion();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'plantilla-seguimiento-tareas.xlsx'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { this.snack.open(mensajeError(e, 'No se pudo descargar la plantilla.'), 'Cerrar', { duration: 4500 }); }
  }

  async importar(): Promise<void> {
    if (!this.archivo || !this.espacioImportar) return;
    this.importando.set(true);
    try {
      const r = await this.api.importar(this.espacioImportar, this.archivo);
      this.archivo = null;
      this.importaciones.set(await this.api.importaciones());
      this.snack.open(`Listo: ${r.boards_created} tableros y ${r.cards_created} tareas${r.errors?.length ? ` (${r.errors.length} filas con error)` : ''}`,
        'Cerrar', { duration: 6000 });
    } catch (e) {
      this.snack.open(mensajeError(e, 'No se pudo importar el archivo.'), 'Cerrar', { duration: 5000 });
    } finally {
      this.importando.set(false);
    }
  }

  // ── Auditoría ──
  async cargarAuditoria(): Promise<void> {
    this.cargandoAuditoria.set(true);
    try { this.auditoria.set(await this.api.auditoria({ size: 300 })); }
    catch (e) { this.snack.open(mensajeError(e), 'Cerrar', { duration: 4500 }); }
    finally { this.cargandoAuditoria.set(false); }
  }

  readonly entidades = [
    { clave: 'card', etiqueta: 'Tareas' }, { clave: 'board', etiqueta: 'Tableros' }, { clave: 'list', etiqueta: 'Columnas' },
    { clave: 'workspace', etiqueta: 'Espacios' }, { clave: 'comment', etiqueta: 'Comentarios' }, { clave: 'config', etiqueta: 'Parámetros' },
  ];

  describir(a: RegistroAuditoria): string {
    const md = (a.metadata ?? {}) as Record<string, any>;
    const que: Record<string, string> = {
      card: 'la tarea', board: 'el tablero', list: 'la columna', workspace: 'el espacio', comment: 'un comentario en',
      checklist_item: 'un paso de checklist', upload: 'un adjunto', group: 'el grupo', group_membership: 'un integrante de grupo',
      favorite: 'un favorito', import: 'una importación', config: 'el parámetro',
    };
    const acc: Record<string, string> = {
      create: 'creó', update: 'actualizó', delete: 'eliminó', move: 'movió', watch_add: 'agregó un seguidor a', import_boards: 'importó',
    };
    const nombre = md['name'] ?? md['clave'] ?? md['filename'] ?? '';
    const donde = md['board'] ? ` · ${md['board']}` : '';
    const extra = a.action === 'move' && md['to_list'] ? ` → ${md['to_list']}` : (md['changed'] ? ` (${md['changed']})` : '');
    return `${acc[a.action] ?? a.action} ${que[a.entity_type] ?? a.entity_type} ${nombre ? '«' + nombre + '»' : ''}${extra}${donde}`.replace(/\s+/g, ' ');
  }

  hace = hace;
}
