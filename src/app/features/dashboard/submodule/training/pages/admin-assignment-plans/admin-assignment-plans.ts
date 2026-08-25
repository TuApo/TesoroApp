import { Component, ChangeDetectionStrategy, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';
import {
  TrainingAdminService, PlanAsignacion, PlanRequest, CriterioAudiencia, CriterioRequest,
  EjeAsignacion, ItemPlan, ItemPlanRequest, Disparador, DisparadorRequest, CorridaPlan,
  LineaBitacora, Curso,
} from '../../service/training-admin.service';

/**
 * Planes de asignación: quién recibe qué curso y cuándo, sin desplegar código.
 *
 * Un plan tiene tres partes que se leen en ese orden: la AUDIENCIA (a quién alcanza), el
 * CONTENIDO (qué se le asigna y con qué plazo) y los DISPARADORES (cuándo se evalúa).
 *
 * La pantalla empuja a simular antes de activar, y no por cortesía: el backend responde 409 a
 * un plan que nunca se simuló. Simular escribe la bitácora persona a persona —incluido a quien
 * NO alcanzó y por qué—, que es lo único que permite revisar un plan antes de que matricule a
 * gente de verdad.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-admin-assignment-plans',
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './admin-assignment-plans.html',
  styleUrl: './admin-assignment-plans.css'
})
export class AdminAssignmentPlans implements OnInit {
  private api = inject(TrainingAdminService);

  readonly planes = signal<PlanAsignacion[]>([]);
  readonly ejes = signal<EjeAsignacion[]>([]);
  readonly cursos = signal<Curso[]>([]);

  readonly planActivo = signal<PlanAsignacion | null>(null);
  readonly criterios = signal<CriterioAudiencia[]>([]);
  readonly items = signal<ItemPlan[]>([]);
  readonly disparadores = signal<Disparador[]>([]);
  readonly corridas = signal<CorridaPlan[]>([]);

  readonly cargando = signal(true);
  readonly ocupado = signal(false);
  readonly error = signal<string | null>(null);

  readonly formPlan = signal<(PlanRequest & { id?: string }) | null>(null);
  readonly nuevoCriterio = signal<CriterioRequest>(this.criterioVacio());
  readonly nuevoItem = signal<ItemPlanRequest>({ course_id: '', plazo_dias: 30, orden: 0 });
  readonly nuevoDisparador = signal<DisparadorRequest>({ evento: 'AL_INGRESO', cron: '', event_code: '' });

  /** Bitácora de la corrida que se está mirando. */
  readonly corridaVista = signal<CorridaPlan | null>(null);
  readonly bitacora = signal<LineaBitacora[]>([]);
  readonly filtroBitacora = signal<'todos' | 'si' | 'no'>('no');

  readonly eventos = ['AL_INGRESO', 'AL_CAMBIAR_CARGO', 'AL_HABILITAR_MODULO', 'PROGRAMADO', 'MANUAL'];

  /** Los criterios agrupados como los evalúa el motor: OR dentro del grupo, AND entre grupos. */
  readonly gruposDeAudiencia = computed(() => {
    const porGrupo = new Map<number, CriterioAudiencia[]>();
    for (const c of this.criterios()) {
      const lista = porGrupo.get(c.grupo_orden) ?? [];
      lista.push(c);
      porGrupo.set(c.grupo_orden, lista);
    }
    return [...porGrupo.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([orden, criterios]) => ({ orden, criterios }));
  });

  readonly ejeElegido = computed(() =>
    this.ejes().find(e => e.eje === this.nuevoCriterio().tipo) ?? null);

  /** Los operadores que admite el eje elegido; si no hay eje, el neutro. */
  readonly operadoresDelEje = computed(() => this.ejeElegido()?.operadores ?? ['IGUAL']);

  /** Un plan sin audiencia alcanza a TODA la plantilla; conviene decirlo antes, no después. */
  readonly sinAudiencia = computed(() => this.criterios().length === 0);
  readonly sinContenido = computed(() => this.items().length === 0);

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const [planes, ejes, cursos] = await Promise.all([
        this.api.listarPlanes(),
        this.api.ejesAsignacion(),
        this.api.listarCursos(0, 200),
      ]);
      this.planes.set(planes);
      this.ejes.set(ejes);
      this.cursos.set(cursos.content ?? []);
    } catch (e) {
      this.error.set(this.mensaje(e, 'No se pudieron cargar los planes.'));
    } finally {
      this.cargando.set(false);
    }
  }

  // ── Plan ──────────────────────────────────────────────────────────────────

  abrirNuevo(): void {
    this.formPlan.set({ nombre: '', codigo: '', descripcion: '', vigente_desde: null, vigente_hasta: null });
  }

  editar(p: PlanAsignacion): void {
    this.formPlan.set({
      id: p.id, nombre: p.nombre, codigo: p.codigo ?? '', descripcion: p.descripcion ?? '',
      vigente_desde: p.vigente_desde ?? null, vigente_hasta: p.vigente_hasta ?? null,
    });
  }

  cerrarForm(): void { this.formPlan.set(null); }

  async guardarPlan(): Promise<void> {
    const f = this.formPlan();
    if (!f || !f.nombre.trim()) {
      await Swal.fire('Falta el nombre', 'Un plan sin nombre no hay quien lo distinga después.', 'warning');
      return;
    }
    this.ocupado.set(true);
    try {
      const req: PlanRequest = {
        nombre: f.nombre.trim(),
        codigo: f.codigo?.trim() || null,
        descripcion: f.descripcion?.trim() || null,
        vigente_desde: f.vigente_desde || null,
        vigente_hasta: f.vigente_hasta || null,
      };
      const guardado = f.id ? await this.api.actualizarPlan(f.id, req) : await this.api.crearPlan(req);
      this.formPlan.set(null);
      await this.cargar();
      if (!f.id) await this.abrirPlan(guardado);
    } catch (e) {
      await Swal.fire('No se guardó', this.mensaje(e, 'El backend rechazó el plan.'), 'error');
    } finally {
      this.ocupado.set(false);
    }
  }

  async abrirPlan(p: PlanAsignacion): Promise<void> {
    this.planActivo.set(p);
    this.corridaVista.set(null);
    this.bitacora.set([]);
    this.ocupado.set(true);
    try {
      const [criterios, items, disparadores, corridas] = await Promise.all([
        this.api.criteriosDePlan(p.id),
        this.api.itemsDePlan(p.id),
        this.api.disparadoresDePlan(p.id),
        this.api.corridasDePlan(p.id),
      ]);
      this.criterios.set(criterios);
      this.items.set(items);
      this.disparadores.set(disparadores);
      this.corridas.set(corridas);
    } catch (e) {
      await Swal.fire('No se pudo abrir', this.mensaje(e, 'Falló la carga del plan.'), 'error');
      this.planActivo.set(null);
    } finally {
      this.ocupado.set(false);
    }
  }

  volver(): void {
    this.planActivo.set(null);
    void this.cargar();
  }

  async cambiarActivo(p: PlanAsignacion): Promise<void> {
    const activar = !p.activo;
    if (activar) {
      const r = await Swal.fire({
        title: '¿Activar el plan?',
        html: 'Desde que quede activo, el reconciliador lo evaluará y <b>matriculará gente de verdad</b>.',
        icon: 'warning', showCancelButton: true,
        confirmButtonText: 'Sí, activar', cancelButtonText: 'Cancelar',
      });
      if (!r.isConfirmed) return;
    }
    this.ocupado.set(true);
    try {
      const actualizado = await this.api.activarPlan(p.id, activar);
      this.planActivo.set(actualizado);
      await this.cargar();
    } catch (e) {
      // 409 = el backend exige haber simulado antes. Es la regla que evita activar a ciegas.
      const err = e as { status?: number };
      if (err?.status === 409) {
        await Swal.fire('Primero simúlalo',
          'No se puede activar un plan que nunca se ha simulado. Corre la simulación, revisa a quién alcanza y vuelve.',
          'info');
      } else {
        await Swal.fire('No se pudo', this.mensaje(e, 'El backend rechazó el cambio.'), 'error');
      }
    } finally {
      this.ocupado.set(false);
    }
  }

  async eliminar(p: PlanAsignacion): Promise<void> {
    const r = await Swal.fire({
      title: '¿Borrar el plan?',
      text: 'Deja de asignar. Las matrículas que ya creó NO se tocan.',
      icon: 'warning', showCancelButton: true,
      confirmButtonText: 'Borrar', cancelButtonText: 'Cancelar', confirmButtonColor: '#a33131',
    });
    if (!r.isConfirmed) return;
    this.ocupado.set(true);
    try {
      await this.api.eliminarPlan(p.id);
      this.planActivo.set(null);
      await this.cargar();
    } catch (e) {
      await Swal.fire('No se pudo borrar', this.mensaje(e, ''), 'error');
    } finally {
      this.ocupado.set(false);
    }
  }

  // ── Audiencia ─────────────────────────────────────────────────────────────

  criterioVacio(): CriterioRequest {
    return { grupo_orden: 0, tipo: '', operador: 'IGUAL', valor: '', negado: false };
  }

  elegirEje(eje: string): void {
    const cat = this.ejes().find(e => e.eje === eje);
    this.nuevoCriterio.set({
      ...this.nuevoCriterio(), tipo: eje,
      operador: cat?.operadores?.[0] ?? 'IGUAL',
    });
  }

  async agregarCriterio(): Promise<void> {
    const p = this.planActivo();
    const c = this.nuevoCriterio();
    if (!p || !c.tipo || !c.valor.trim()) {
      await Swal.fire('Falta algo', 'Elige el eje y escribe el valor con el que se compara.', 'warning');
      return;
    }
    this.ocupado.set(true);
    try {
      await this.api.agregarCriterio(p.id, { ...c, valor: c.valor.trim() });
      this.criterios.set(await this.api.criteriosDePlan(p.id));
      this.nuevoCriterio.set(this.criterioVacio());
    } catch (e) {
      await Swal.fire('No se agregó', this.mensaje(e, ''), 'error');
    } finally {
      this.ocupado.set(false);
    }
  }

  async quitarCriterio(c: CriterioAudiencia): Promise<void> {
    const p = this.planActivo();
    if (!p) return;
    this.ocupado.set(true);
    try {
      await this.api.quitarCriterio(c.id);
      this.criterios.set(await this.api.criteriosDePlan(p.id));
    } catch (e) {
      await Swal.fire('No se pudo quitar', this.mensaje(e, ''), 'error');
    } finally {
      this.ocupado.set(false);
    }
  }

  // ── Contenido ─────────────────────────────────────────────────────────────

  async agregarItem(): Promise<void> {
    const p = this.planActivo();
    const i = this.nuevoItem();
    if (!p || !i.course_id) {
      await Swal.fire('Elige el curso', 'Un ítem asigna un curso.', 'warning');
      return;
    }
    this.ocupado.set(true);
    try {
      await this.api.agregarItemPlan(p.id, {
        course_id: i.course_id,
        plazo_dias: i.plazo_dias ? Number(i.plazo_dias) : null,
        orden: Number(i.orden ?? 0),
      });
      this.items.set(await this.api.itemsDePlan(p.id));
      this.nuevoItem.set({ course_id: '', plazo_dias: 30, orden: this.items().length });
    } catch (e) {
      await Swal.fire('No se agregó', this.mensaje(e, ''), 'error');
    } finally {
      this.ocupado.set(false);
    }
  }

  async quitarItem(i: ItemPlan): Promise<void> {
    const p = this.planActivo();
    if (!p) return;
    this.ocupado.set(true);
    try {
      await this.api.quitarItemPlan(i.id);
      this.items.set(await this.api.itemsDePlan(p.id));
    } catch (e) {
      await Swal.fire('No se pudo quitar', this.mensaje(e, ''), 'error');
    } finally {
      this.ocupado.set(false);
    }
  }

  // ── Disparadores ──────────────────────────────────────────────────────────

  /**
   * Por `.set()` y no por mutación: el evento decide si aparece el campo del cron, y con
   * detección zoneless mutar el objeto no repinta nada.
   */
  elegirEvento(evento: string): void {
    this.nuevoDisparador.set({ ...this.nuevoDisparador(), evento });
  }

  async agregarDisparador(): Promise<void> {
    const p = this.planActivo();
    const d = this.nuevoDisparador();
    if (!p) return;
    if (d.evento === 'PROGRAMADO' && !d.cron?.trim()) {
      await Swal.fire('Falta el cron', 'Un disparador PROGRAMADO necesita su expresión cron.', 'warning');
      return;
    }
    this.ocupado.set(true);
    try {
      await this.api.agregarDisparador(p.id, {
        evento: d.evento,
        cron: d.cron?.trim() || null,
        event_code: d.event_code?.trim() || null,
      });
      this.disparadores.set(await this.api.disparadoresDePlan(p.id));
      this.nuevoDisparador.set({ evento: 'AL_INGRESO', cron: '', event_code: '' });
    } catch (e) {
      await Swal.fire('No se agregó', this.mensaje(e, ''), 'error');
    } finally {
      this.ocupado.set(false);
    }
  }

  async quitarDisparador(d: Disparador): Promise<void> {
    const p = this.planActivo();
    if (!p) return;
    this.ocupado.set(true);
    try {
      await this.api.quitarDisparador(d.id);
      this.disparadores.set(await this.api.disparadoresDePlan(p.id));
    } catch (e) {
      await Swal.fire('No se pudo quitar', this.mensaje(e, ''), 'error');
    } finally {
      this.ocupado.set(false);
    }
  }

  // ── Correr ────────────────────────────────────────────────────────────────

  async simular(): Promise<void> {
    const p = this.planActivo();
    if (!p) return;
    this.ocupado.set(true);
    try {
      const corrida = await this.api.simularPlan(p.id);
      this.corridas.set(await this.api.corridasDePlan(p.id));
      await this.verBitacora(corrida);
      if (corrida.evaluadas === 0) {
        await Swal.fire('Simulado, pero no había a quién evaluar',
          'El módulo todavía no tiene personas sincronizadas, así que el plan evaluó a 0. ' +
          'La simulación es correcta; lo que falta es la carga de personal.', 'info');
      }
    } catch (e) {
      await Swal.fire('No se pudo simular', this.mensaje(e, ''), 'error');
    } finally {
      this.ocupado.set(false);
    }
  }

  async ejecutar(): Promise<void> {
    const p = this.planActivo();
    if (!p) return;
    const r = await Swal.fire({
      title: '¿Ejecutar ahora?',
      html: 'Esto <b>matricula de verdad</b> a todo el que cumpla la audiencia. Revisa antes la simulación.',
      icon: 'warning', showCancelButton: true,
      confirmButtonText: 'Sí, matricular', cancelButtonText: 'Cancelar',
    });
    if (!r.isConfirmed) return;
    this.ocupado.set(true);
    try {
      const corrida = await this.api.ejecutarPlan(p.id);
      this.corridas.set(await this.api.corridasDePlan(p.id));
      await this.verBitacora(corrida);
      await Swal.fire('Ejecutado',
        `Evaluadas ${corrida.evaluadas}, coincidieron ${corrida.coincidencias}, ` +
        `matrículas nuevas ${corrida.matriculas}.`, 'success');
    } catch (e) {
      const err = e as { status?: number };
      if (err?.status === 409) {
        await Swal.fire('El plan no está activo',
          'Solo se ejecuta un plan activo y dentro de su vigencia.', 'info');
      } else {
        await Swal.fire('No se pudo ejecutar', this.mensaje(e, ''), 'error');
      }
    } finally {
      this.ocupado.set(false);
    }
  }

  async verBitacora(c: CorridaPlan): Promise<void> {
    this.corridaVista.set(c);
    await this.recargarBitacora();
  }

  async cambiarFiltroBitacora(f: 'todos' | 'si' | 'no'): Promise<void> {
    this.filtroBitacora.set(f);
    await this.recargarBitacora();
  }

  private async recargarBitacora(): Promise<void> {
    const c = this.corridaVista();
    if (!c) return;
    const f = this.filtroBitacora();
    try {
      this.bitacora.set(
        await this.api.bitacoraDeCorrida(c.id, f === 'todos' ? undefined : f === 'si'));
    } catch (e) {
      this.bitacora.set([]);
    }
  }

  // ── Utilidades ────────────────────────────────────────────────────────────

  nombreCurso(id?: string | null): string {
    if (!id) return '—';
    return this.cursos().find(c => c.id === id)?.nombre ?? id;
  }

  fecha(iso?: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '—' : d.toLocaleString('es-CO', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  private mensaje(e: unknown, porDefecto: string): string {
    const err = e as { error?: { message?: string; error?: string }; message?: string };
    return err?.error?.message || err?.error?.error || err?.message || porDefecto;
  }
}
