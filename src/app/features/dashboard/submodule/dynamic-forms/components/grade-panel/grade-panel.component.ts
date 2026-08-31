import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import Swal from 'sweetalert2';

import { ExamService } from '../../services/exam.service';
import {
  AnotacionProfesional,
  EstadoCalificacion,
  ResultadoCampo,
  ResultadoExamen,
} from '../../models/exam.models';

/** Lo que la profesional está escribiendo en un campo, antes de guardarlo. */
interface Borrador {
  puntos: number;
  motivo: string;
  interpretacion: string;
  observaciones: string;
  veredicto: string;
  utilidad_ia: string;
  usar_para_entrenar: boolean;
  sucio: boolean;
}

/**
 * BANDEJA DE REVISIÓN — lo que ve quien firma.
 *
 * Vive dentro del detalle de la respuesta, no en una pantalla aparte, y eso no es un detalle
 * de implementación: la profesional necesita el dibujo y el borrador a la vez. Sacar la
 * corrección a otra pantalla la obligaría a ir y venir por cada campo, cuatrocientas veces al
 * día.
 *
 * Tres cosas que el componente no deja hacer, porque el servidor tampoco:
 *   · Firmar con algo pendiente. El botón se apaga y dice qué falta.
 *   · Dar más puntos de los que vale la pregunta.
 *   · Marcar «usar para entrenar» por defecto. Participar es voluntario y por caso.
 */
@Component({
  selector: 'app-grade-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './grade-panel.component.html',
  styleUrls: ['./grade-panel.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GradePanelComponent {
  readonly submissionId = input.required<number>();

  private svc = inject(ExamService);

  readonly cargando = signal(true);
  readonly calificando = signal(false);
  readonly firmando = signal(false);
  readonly guardandoCampo = signal<string | null>(null);
  /** null = esta respuesta todavía no se ha calificado nunca. */
  readonly resultado = signal<ResultadoExamen | null>(null);
  readonly notas = signal<Record<string, AnotacionProfesional>>({});
  readonly borradores = signal<Record<string, Borrador>>({});
  /** null = todavía no se sabe. El panel no se pinta hasta saberlo. */
  readonly estadoExamen = signal<EstadoCalificacion | null>(null);

  /**
   * El panel solo existe si hay examen. En un formulario corriente no debe aparecer nada —ni un
   * vacío, ni un botón—: la mayoría de los formularios no se califican y un panel apagado en
   * todos ellos es ruido en la pantalla que más se abre.
   */
  readonly visible = computed(() => this.estadoExamen()?.es_examen === true);

  readonly pendientes = computed(() =>
    (this.resultado()?.detalle ?? []).filter(c => c.estado?.startsWith('PENDIENTE')));

  readonly firmado = computed(() => this.resultado()?.estado === 'FIRMADO');

  readonly puedeFirmar = computed(() =>
    !!this.resultado() && this.pendientes().length === 0 && !this.firmado());

  constructor() {
    effect(() => {
      const id = this.submissionId();
      if (Number.isFinite(id)) this.cargar(id);
    });
  }

  private cargar(id: number): void {
    this.cargando.set(true);
    this.svc.estado(id).subscribe({
      next: e => {
        this.estadoExamen.set(e);
        if (!e.es_examen) { this.cargando.set(false); return; }
        if (!e.calificado) { this.resultado.set(null); this.cargando.set(false); return; }
        this.cargarResultado(id);
      },
      // 403 = quien mira no gestiona formularios. No es un error que mostrarle: simplemente
      // esta pantalla no le toca, y el panel no se pinta.
      error: () => { this.estadoExamen.set(null); this.cargando.set(false); },
    });
  }

  private cargarResultado(id: number): void {
    this.svc.consultar(id).subscribe({
      next: r => { this.resultado.set(r); this.sembrar(r); this.cargando.set(false); this.cargarNotas(id); },
      error: (_err: HttpErrorResponse) => { this.resultado.set(null); this.cargando.set(false); },
    });
  }

  private cargarNotas(id: number): void {
    this.svc.anotaciones(id).subscribe({
      next: lista => {
        const m: Record<string, AnotacionProfesional> = {};
        for (const n of lista) m[n.campo] = n;
        this.notas.set(m);
        this.borradores.update(b => {
          const out = { ...b };
          for (const n of lista) {
            out[n.campo] = {
              ...(out[n.campo] ?? this.borradorVacio(n.campo)),
              interpretacion: n.interpretacion ?? '',
              observaciones: n.observaciones ?? '',
              veredicto: n.veredicto ?? '',
              utilidad_ia: n.utilidad_ia ?? '',
              usar_para_entrenar: n.usar_para_entrenar,
              sucio: false,
            };
          }
          return out;
        });
      },
      error: () => { /* sin anotaciones el panel funciona igual */ },
    });
  }

  private borradorVacio(campo: string): Borrador {
    const c = (this.resultado()?.detalle ?? []).find(x => x.campo === campo);
    return {
      puntos: c?.puntos ?? 0,
      motivo: '',
      interpretacion: '',
      observaciones: '',
      veredicto: '',
      utilidad_ia: '',
      usar_para_entrenar: false,
      sucio: false,
    };
  }

  private sembrar(r: ResultadoExamen): void {
    this.borradores.update(b => {
      const out = { ...b };
      for (const c of r.detalle) {
        out[c.campo] = { ...(out[c.campo] ?? this.borradorVacio(c.campo)), puntos: c.puntos, sucio: false };
      }
      return out;
    });
  }

  borrador(campo: string): Borrador {
    return this.borradores()[campo] ?? this.borradorVacio(campo);
  }

  cambiar(campo: string, patch: Partial<Borrador>): void {
    this.borradores.update(b => ({ ...b, [campo]: { ...this.borrador(campo), ...patch, sucio: true } }));
  }

  nota(campo: string): AnotacionProfesional | null { return this.notas()[campo] ?? null; }

  // ── Acciones ───────────────────────────────────────────────────────────────

  calificar(): void {
    this.calificando.set(true);
    this.svc.calificar(this.submissionId()).subscribe({
      next: r => {
        this.resultado.set(r);
        this.sembrar(r);
        this.calificando.set(false);
        this.cargarNotas(this.submissionId());
      },
      error: (err: HttpErrorResponse) => {
        this.calificando.set(false);
        Swal.fire({
          icon: 'info',
          title: 'No se pudo calificar',
          text: err.error?.detail ?? 'Revisa que la versión del formulario esté marcada como examen.',
        });
      },
    });
  }

  guardarCampo(c: ResultadoCampo): void {
    const b = this.borrador(c.campo);
    if (b.puntos > c.puntos_max) {
      Swal.fire({ icon: 'warning', title: 'Son más puntos de los que vale',
                  text: `«${c.etiqueta}» vale ${c.puntos_max}.` });
      return;
    }
    this.guardandoCampo.set(c.campo);

    // Dos escrituras, y en este orden: primero la lectura de la profesional (que es lo que no
    // se puede perder), y solo si queda guardada se cierra la nota del campo.
    this.svc.anotar(this.submissionId(), c.campo, {
      interpretacion: b.interpretacion || null,
      observaciones: b.observaciones || null,
      veredicto: b.veredicto || null,
      utilidad_ia: (b.utilidad_ia || null) as AnotacionProfesional['utilidad_ia'],
      usar_para_entrenar: b.usar_para_entrenar,
    }).subscribe({
      next: n => {
        this.notas.update(m => ({ ...m, [c.campo]: n }));
        this.svc.revisar(this.submissionId(), c.campo, b.puntos,
                         b.motivo || b.interpretacion || 'Revisado por la profesional.').subscribe({
          next: r => {
            this.resultado.set(r);
            this.borradores.update(x => ({ ...x, [c.campo]: { ...this.borrador(c.campo), sucio: false } }));
            this.guardandoCampo.set(null);
          },
          error: (err: HttpErrorResponse) => { this.guardandoCampo.set(null); this.fallo(err); },
        });
      },
      error: (err: HttpErrorResponse) => { this.guardandoCampo.set(null); this.fallo(err); },
    });
  }

  firmar(): void {
    Swal.fire({
      icon: 'question',
      title: '¿Firmar el resultado?',
      html: 'Queda como resultado definitivo y a nombre tuyo.<br>'
          + 'Lo que escribiste se conserva junto al borrador del modelo.',
      showCancelButton: true,
      confirmButtonText: 'Firmar',
      cancelButtonText: 'Todavía no',
    }).then(res => {
      if (!res.isConfirmed) return;
      this.firmando.set(true);
      this.svc.firmar(this.submissionId()).subscribe({
        next: r => { this.resultado.set(r); this.firmando.set(false); },
        error: (err: HttpErrorResponse) => { this.firmando.set(false); this.fallo(err); },
      });
    });
  }

  private fallo(err: HttpErrorResponse): void {
    Swal.fire({ icon: 'error', title: 'No se pudo guardar',
                text: err.error?.detail ?? 'Inténtalo otra vez.' });
  }

  // ── Presentación ───────────────────────────────────────────────────────────

  etiquetaEstado(estado: string): string {
    switch (estado) {
      case 'CORRECTO': return 'Correcta';
      case 'PARCIAL': return 'Parcial';
      case 'INCORRECTO': return 'Incorrecta';
      case 'VACIO': return 'Sin responder';
      case 'PENDIENTE_REVISION': return 'Espera revisión';
      case 'PENDIENTE_IA': return 'Espera recalificar';
      case 'REVISADO': return 'Revisada';
      case 'FIRMADO': return 'Firmado';
      case 'CALIFICADO': return 'Calificado';
      case 'SIN_CALIFICAR': return 'Sin calificar';
      default: return estado;
    }
  }

  claseEstado(estado: string): string {
    if (estado === 'CORRECTO' || estado === 'REVISADO' || estado === 'FIRMADO') return 'gp-chip--ok';
    if (estado === 'PARCIAL') return 'gp-chip--medio';
    if (estado?.startsWith('PENDIENTE')) return 'gp-chip--espera';
    return 'gp-chip--mal';
  }

  /** true si el campo trae texto del modelo: hay algo que contrastar antes de decidir. */
  tieneBorrador(c: ResultadoCampo): boolean {
    return !!(c.interpretacion_apoyo || c.descripcion_ia);
  }
}
