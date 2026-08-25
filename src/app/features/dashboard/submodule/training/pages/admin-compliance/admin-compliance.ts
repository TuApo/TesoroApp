import { Component, ChangeDetectionStrategy, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import {
  TrainingAdminService, ResumenCumplimiento, FilaMatriz, FilaPersonaCumplimiento,
  CargoSinFamilia, Curso,
} from '../../service/training-admin.service';

/**
 * Panel de cumplimiento: quién debe formación, quién la tiene al día y por dónde se escapa.
 *
 * El estado de cumplimiento NO es el estado de la matrícula. Una matrícula aprobada cuyo
 * certificado ya venció no está al día: cuenta como vencida. Un tablero que solo mirara
 * "APROBADO" diría que todo va bien mientras la gente trabaja con certificaciones caducadas.
 *
 * Por eso, además de la matriz, la cabecera muestra los dos huecos que no aparecen en ninguna
 * fila: gente activa <b>sin una sola matrícula</b> (no pertenece a ningún curso, así que la
 * matriz no la puede mostrar) y cargos sin familia, a los que ningún plan de asignación alcanza.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-admin-compliance',
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './admin-compliance.html',
  styleUrl: './admin-compliance.css'
})
export class AdminCompliance implements OnInit {
  private api = inject(TrainingAdminService);

  readonly resumen = signal<ResumenCumplimiento | null>(null);
  readonly matriz = signal<FilaMatriz[]>([]);
  readonly cursos = signal<Curso[]>([]);
  readonly excepciones = signal<CargoSinFamilia[]>([]);

  readonly cargando = signal(true);
  readonly ocupado = signal(false);
  readonly error = signal<string | null>(null);

  readonly cursoFiltro = signal<string>('');
  readonly pestana = signal<'matriz' | 'excepciones'>('matriz');

  /** Detalle abierto: qué celda se pinchó. */
  readonly detalle = signal<{ estado: string; curso?: FilaMatriz | null } | null>(null);
  readonly personas = signal<FilaPersonaCumplimiento[]>([]);

  readonly estados = [
    { clave: 'VENCIDO', etiqueta: 'Vencidos' },
    { clave: 'POR_VENCER', etiqueta: 'Por vencer' },
    { clave: 'AL_DIA', etiqueta: 'Al día' },
    { clave: 'EN_CURSO', etiqueta: 'En curso' },
    { clave: 'PENDIENTE', etiqueta: 'Pendientes' },
    { clave: 'REPROBADO', etiqueta: 'Reprobados' },
  ];

  /** Sin matrículas no hay nada que medir: el panel lo dice en vez de pintar 0 % en rojo. */
  readonly sinDatos = computed(() => (this.resumen()?.matriculas ?? 0) === 0);

  /** Cobertura real sobre la plantilla, no sobre lo matriculado. */
  readonly cobertura = computed(() => {
    const r = this.resumen();
    if (!r || r.personas_activas === 0) return null;
    return Math.round((r.personas / r.personas_activas) * 1000) / 10;
  });

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const curso = this.cursoFiltro() || undefined;
      const [resumen, matriz, cursos, excepciones] = await Promise.all([
        this.api.resumenCumplimiento(curso),
        this.api.matrizCumplimiento(curso),
        this.api.listarCursos(0, 200),
        this.api.cargosSinClasificar().catch(() => [] as CargoSinFamilia[]),
      ]);
      this.resumen.set(resumen);
      this.matriz.set(matriz);
      this.cursos.set(cursos.content ?? []);
      this.excepciones.set(excepciones);
    } catch (e) {
      this.error.set(this.mensaje(e, 'No se pudo cargar el cumplimiento.'));
    } finally {
      this.cargando.set(false);
    }
  }

  async cambiarCurso(id: string): Promise<void> {
    this.cursoFiltro.set(id);
    this.detalle.set(null);
    this.personas.set([]);
    await this.cargar();
  }

  /** Bajar al detalle desde una celda: "enséñame los 12 vencidos de Alturas". */
  async abrirDetalle(estado: string, curso?: FilaMatriz | null): Promise<void> {
    this.detalle.set({ estado, curso: curso ?? null });
    this.ocupado.set(true);
    try {
      this.personas.set(await this.api.personasCumplimiento(
        estado, curso?.course_id ?? (this.cursoFiltro() || undefined), 300));
    } catch (e) {
      this.personas.set([]);
      this.error.set(this.mensaje(e, 'No se pudo cargar el detalle.'));
    } finally {
      this.ocupado.set(false);
    }
  }

  cerrarDetalle(): void {
    this.detalle.set(null);
    this.personas.set([]);
  }

  etiquetaEstado(clave: string): string {
    return this.estados.find(e => e.clave === clave)?.etiqueta ?? clave;
  }

  /** Verde solo si está realmente al día; el resto se distingue por gravedad. */
  claseEstado(estado: string): string {
    switch (estado) {
      case 'AL_DIA': return 'chip-ok';
      case 'VENCIDO': return 'chip-mal';
      case 'POR_VENCER': return 'chip-aviso';
      case 'REPROBADO': return 'chip-mal';
      default: return 'chip-cerrado';
    }
  }

  fecha(iso?: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-CO', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
  }

  private mensaje(e: unknown, porDefecto: string): string {
    const err = e as { error?: { message?: string; error?: string }; message?: string };
    return err?.error?.message || err?.error?.error || err?.message || porDefecto;
  }
}
