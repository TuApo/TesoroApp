import { Component, ChangeDetectionStrategy, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';
import {
  TrainingS, GrupoDelInstructor, GrupoInstructorDetalle, PlanillaGrupo, FilaPlanilla, Boletin,
  Entrega, MatriculaDelGrupo, AsistenciaDelGrupo, ItemBoletin, RequisitoBoletin
} from '../../service/training-s';

/**
 * El profesor: sus grupos, la planilla de notas, las entregas por revisar y la lista.
 *
 * No es una pantalla de administración: la ve quien DICTA, que puede ser un coordinador, un
 * jefe o un operario con experiencia. Ser instructor no es un rol sino estar en la lista de
 * instructores del grupo, y por eso todo lo que se pide aquí va por `/me/instructor`: el
 * servidor decide por el usuario del token, no por el rol.
 *
 * Tres pestañas por grupo y ninguna se carga hasta que se abre: la planilla calcula la nota de
 * cada persona en el servidor, y pedirla junto con las entregas y la asistencia a la vez
 * triplicaría el tiempo de abrir el grupo por dos pestañas que a lo mejor no se miran.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-instructor-home',
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './instructor-home.html',
  styleUrl: './instructor-home.css'
})
export class InstructorHome implements OnInit {
  private api = inject(TrainingS);
  private router = inject(Router);
  private ruta = inject(ActivatedRoute);

  readonly grupos = signal<GrupoDelInstructor[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);

  readonly grupoActivo = signal<GrupoInstructorDetalle | null>(null);
  readonly pestana = signal<'planilla' | 'entregas' | 'asistencia'>('planilla');
  readonly ocupado = signal(false);

  // ── Planilla ──
  readonly planilla = signal<PlanillaGrupo | null>(null);
  readonly cargandoPlanilla = signal(false);
  /** La matrícula cuyo boletín está desplegado bajo su fila. Solo una. */
  readonly boletinAbierto = signal<string | null>(null);
  readonly boletin = signal<Boletin | null>(null);
  readonly cargandoBoletin = signal(false);

  // ── Entregas ──
  readonly entregas = signal<Entrega[]>([]);
  readonly cargandoEntregas = signal(false);
  readonly verTodas = signal(false);
  /** La entrega que se está calificando, con lo que se va a mandar. null = ninguna. */
  readonly revision = signal<{ entrega: Entrega; nota: number | null; feedback: string } | null>(null);

  // ── Asistencia ──
  readonly matriculados = signal<MatriculaDelGrupo[]>([]);
  readonly fechaLista = signal(new Date().toISOString().slice(0, 10));
  readonly marcas = signal<Record<string, string>>({});
  readonly cargandoLista = signal(false);

  /** Solo los módulos con nota: una columna por cada uno en la planilla. */
  readonly modulosConNota = computed(() =>
    (this.planilla()?.modulos ?? []).filter(m => m.tiene_calificables));

  readonly totalPorRevisar = computed(() =>
    this.grupos().reduce((n, g) => n + g.entregas_por_revisar, 0));

  async ngOnInit(): Promise<void> {
    await this.cargar();
    const id = this.ruta.snapshot.paramMap.get('groupId');
    if (id) await this.abrir(id);
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      this.grupos.set(await this.api.misGruposComoInstructor());
    } catch (e: any) {
      this.error.set(e?.status === 403
        ? 'Tu sesión no puede consultar grupos.'
        : 'No pudimos cargar tus grupos. Conéctate a internet e intenta de nuevo.');
    } finally {
      this.cargando.set(false);
    }
  }

  // ── Abrir y cerrar un grupo ───────────────────────────────────────────────

  async abrir(groupId: string): Promise<void> {
    this.ocupado.set(true);
    try {
      this.grupoActivo.set(await this.api.grupoComoInstructor(groupId));
      this.pestana.set('planilla');
      this.planilla.set(null);
      this.entregas.set([]);
      this.matriculados.set([]);
      this.boletinAbierto.set(null);
      this.router.navigate(['/dashboard/capacitaciones/profesor', groupId], { replaceUrl: true });
      await this.cargarPlanilla();
    } catch (e: any) {
      Swal.fire('No se pudo abrir el grupo',
        e?.status === 404 ? 'No dictas este grupo o ya no existe.' : (e?.error?.message ?? 'Inténtalo de nuevo.'),
        'error');
    } finally {
      this.ocupado.set(false);
    }
  }

  cerrar(): void {
    this.grupoActivo.set(null);
    this.router.navigate(['/dashboard/capacitaciones/profesor'], { replaceUrl: true });
    void this.cargar();
  }

  volverAMisCursos(): void {
    this.router.navigate(['/dashboard/capacitaciones']);
  }

  async irA(p: 'planilla' | 'entregas' | 'asistencia'): Promise<void> {
    this.pestana.set(p);
    if (p === 'planilla' && !this.planilla()) await this.cargarPlanilla();
    if (p === 'entregas' && !this.entregas().length) await this.cargarEntregas();
    if (p === 'asistencia') await this.cargarAsistencia();
  }

  // ── Planilla ─────────────────────────────────────────────────────────────

  async cargarPlanilla(): Promise<void> {
    const g = this.grupoActivo();
    if (!g) return;
    this.cargandoPlanilla.set(true);
    try {
      this.planilla.set(await this.api.planillaComoInstructor(g.id));
    } catch (e: any) {
      Swal.fire('No se pudo cargar la planilla', e?.error?.message ?? 'Inténtalo de nuevo.', 'error');
    } finally {
      this.cargandoPlanilla.set(false);
    }
  }

  notaDeModulo(f: FilaPlanilla, moduleId: string): { nota: number | null; aprobado: boolean } | null {
    return f.modulos.find(m => m.module_id === moduleId) ?? null;
  }

  async alternarBoletin(f: FilaPlanilla): Promise<void> {
    if (this.boletinAbierto() === f.enrollment_id) {
      this.boletinAbierto.set(null);
      return;
    }
    this.boletinAbierto.set(f.enrollment_id);
    this.boletin.set(null);
    this.cargandoBoletin.set(true);
    try {
      this.boletin.set(await this.api.boletinDeAlguien(f.enrollment_id));
    } catch {
      this.boletin.set(null);
    } finally {
      this.cargandoBoletin.set(false);
    }
  }

  requisitosQueAplican(b: Boletin): RequisitoBoletin[] {
    return b.requisitos.filter(r => r.aplica);
  }

  etiquetaItem(it: ItemBoletin): string {
    switch (it.estado) {
      case 'SIN_PRESENTAR':      return 'sin presentar';
      case 'PENDIENTE_REVISION': return 'esperando revisión';
      case 'RECHAZADO':          return 'rechazada';
      case 'APROBADO':           return 'aprobada';
      case 'NO_CALIFICA':        return 'no cuenta';
      default:                   return it.intentos ? `${it.intentos} intento(s)` : '';
    }
  }

  etiquetaEstado(estado: string): string {
    switch (estado) {
      case 'APROBADO':  return 'Aprobado';
      case 'REPROBADO': return 'Reprobado';
      case 'EN_CURSO':  return 'En curso';
      case 'ANULADO':   return 'Anulado';
      default:          return 'Sin empezar';
    }
  }

  // ── Entregas ─────────────────────────────────────────────────────────────

  async cargarEntregas(): Promise<void> {
    const g = this.grupoActivo();
    if (!g) return;
    this.cargandoEntregas.set(true);
    try {
      this.entregas.set(await this.api.entregasDeGrupo(g.id, this.verTodas() ? 'TODAS' : undefined));
    } catch (e: any) {
      Swal.fire('No se pudieron cargar las entregas', e?.error?.message ?? 'Inténtalo de nuevo.', 'error');
    } finally {
      this.cargandoEntregas.set(false);
    }
  }

  async alternarTodas(): Promise<void> {
    this.verTodas.set(!this.verTodas());
    await this.cargarEntregas();
  }

  abrirRevision(e: Entrega): void {
    this.revision.set({ entrega: e, nota: e.nota ?? null, feedback: e.feedback ?? '' });
  }

  editarRevision(parche: Partial<{ nota: number | null; feedback: string }>): void {
    this.revision.update(r => r ? { ...r, ...parche } : r);
  }

  /**
   * Aprueba o rechaza. Un rechazo sin motivo lo rechaza el servidor: la persona tiene que
   * saber qué corregir. La nota es opcional; sin ella, aprobada vale todo el puntaje.
   */
  async revisar(estado: 'APROBADA' | 'RECHAZADA'): Promise<void> {
    const r = this.revision();
    if (!r) return;
    if (estado === 'RECHAZADA' && !r.feedback.trim()) {
      Swal.fire('Falta el motivo', 'Un rechazo necesita decir qué corregir.', 'info');
      return;
    }
    this.ocupado.set(true);
    try {
      await this.api.revisarEntrega(r.entrega.id, {
        estado, nota: r.nota, feedback: r.feedback.trim() || null,
      });
      this.revision.set(null);
      await this.cargarEntregas();
      // La nota cambió: la planilla se vuelve a pedir la próxima vez que se abra.
      this.planilla.set(null);
      await this.cargar();
    } catch (e: any) {
      Swal.fire('No se pudo revisar', e?.error?.message ?? 'Inténtalo de nuevo.', 'error');
    } finally {
      this.ocupado.set(false);
    }
  }

  /** Abre la evidencia en otra pestaña. Va por el servicio de documentos con la sesión. */
  async verEvidencia(e: Entrega): Promise<void> {
    if (!e.document_id) return;
    try {
      const blob = await this.api.evidenciaDeEntrega(e.document_id);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err: any) {
      Swal.fire('No se pudo abrir la evidencia', err?.error?.message ?? 'Inténtalo de nuevo.', 'error');
    }
  }

  // ── Asistencia ───────────────────────────────────────────────────────────

  async cargarAsistencia(): Promise<void> {
    const g = this.grupoActivo();
    if (!g) return;
    this.cargandoLista.set(true);
    try {
      if (!this.matriculados().length) {
        this.matriculados.set((await this.api.matriculadosComoInstructor(g.id))
          .filter(m => m.estado !== 'ANULADO'));
      }
      const hoy: AsistenciaDelGrupo[] = await this.api.asistenciaComoInstructor(g.id, this.fechaLista());
      const marcas: Record<string, string> = {};
      for (const a of hoy) marcas[a.enrollment_id] = a.estado;
      this.marcas.set(marcas);
    } catch (e: any) {
      Swal.fire('No se pudo cargar la lista', e?.error?.message ?? 'Inténtalo de nuevo.', 'error');
    } finally {
      this.cargandoLista.set(false);
    }
  }

  marcaDe(enrollmentId: string): string {
    return this.marcas()[enrollmentId] ?? '';
  }

  marcar(enrollmentId: string, estado: string): void {
    this.marcas.update(m => ({ ...m, [enrollmentId]: estado }));
  }

  marcarTodos(estado: string): void {
    const m: Record<string, string> = {};
    for (const x of this.matriculados()) m[x.id] = estado;
    this.marcas.set(m);
  }

  async guardarLista(): Promise<void> {
    const g = this.grupoActivo();
    if (!g) return;
    const registros = Object.entries(this.marcas())
      .filter(([, estado]) => !!estado)
      .map(([enrollment_id, estado]) => ({ enrollment_id, estado }));
    if (!registros.length) {
      Swal.fire('Nada que guardar', 'Marca al menos a una persona.', 'info');
      return;
    }
    this.ocupado.set(true);
    try {
      await this.api.pasarLista(g.id, this.fechaLista(), registros);
      this.planilla.set(null);
      Swal.fire('Lista guardada', `${registros.length} registro(s) del ${this.fechaLista()}.`, 'success');
      await this.cargar();
    } catch (e: any) {
      Swal.fire('No se pudo guardar la lista', e?.error?.message ?? 'Inténtalo de nuevo.', 'error');
    } finally {
      this.ocupado.set(false);
    }
  }

  claseEstadoGrupo(estado: string): string {
    return estado === 'CERRADO' ? 'chip-cerrado' : estado === 'EN_CURSO' ? 'chip-curso' : 'chip-abierto';
  }
}
