import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import Swal from 'sweetalert2';

import { ExamService } from '../../services/exam.service';
import {
  CampoExamen,
  ConfigCampo,
  ConfigExamen,
  ModoCalificacion,
  ModoInfo,
  MODOS,
  TipoExamen,
  TIPOS_EXAMEN,
  TIPOS_NO_CALIFICABLES,
} from '../../models/exam.models';

/**
 * CONSTRUCTOR DE EXAMEN — la hoja de respuestas de un formulario dinámico.
 *
 * Es una pantalla aparte del constructor de estructura a propósito. Son dos trabajos distintos
 * y en momentos distintos: primero se arman las preguntas, después se decide qué se considera
 * responderlas bien. Mezclarlos llenaría el constructor de campos que estorban a quien solo
 * quiere un formulario, que son la mayoría.
 *
 * Cada campo se edita en su propia tarjeta desplegable, con lo que le corresponde a su modo y
 * nada más: marcar la opción correcta y configurar una rúbrica no se parecen en nada, y
 * enseñarlos a la vez es la forma segura de que nadie llene ninguno de los dos.
 */
@Component({
  selector: 'app-form-exam',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './form-exam.component.html',
  styleUrls: ['./form-exam.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormExamComponent {
  private svc = inject(ExamService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  readonly formId = signal(0);
  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly error = signal('');

  readonly version = signal(0);
  readonly examen = signal<ConfigExamen>({
    es_examen: false,
    tipo: 'CONOCIMIENTO',
    nota_minima: 70,
    mostrar_resultado: 'AL_TERMINAR',
    mostrar_correctas: false,
  });
  readonly campos = signal<CampoExamen[]>([]);
  readonly abiertos = signal<ReadonlySet<string>>(new Set());
  /** Lecturas ya firmadas que alimentan cada pregunta (solo para IA_INTERPRETACION). */
  readonly ejemplos = signal<Record<string, number>>({});

  readonly tiposExamen = TIPOS_EXAMEN;

  readonly calificables = computed(() =>
    this.campos().filter(c => (c.calificacion?.puntos ?? 0) > 0 && !!c.calificacion?.modo));

  readonly totalPuntos = computed(() =>
    this.calificables().reduce((s, c) => s + Number(c.calificacion?.puntos ?? 0), 0));

  /**
   * Lo que impediría guardar, dicho antes de intentarlo.
   *
   * El servidor valida lo mismo y es la autoridad; esto existe para que el aviso salga mientras
   * se configura y no después de perder el trabajo de media hora en un 400.
   */
  readonly problemas = computed<string[]>(() => {
    const out: string[] = [];
    const tipo = this.examen().tipo;
    for (const c of this.calificables()) {
      const k = c.calificacion!;
      const info = MODOS.find(m => m.modo === k.modo);
      if (tipo === 'PROYECTIVO' && info?.puntuaConIa) {
        out.push(`«${c.etiqueta}» deja la nota en manos del modelo, y en un examen proyectivo la pone la profesional.`);
      }
      if (k.modo === 'OPCION' && !(k.opciones_correctas?.length)) {
        out.push(`«${c.etiqueta}» no tiene ninguna opción marcada como correcta.`);
      }
      if (k.modo === 'TEXTO_CONTIENE' && !(k.contiene?.length)) {
        out.push(`«${c.etiqueta}» no dice qué términos hay que mencionar.`);
      }
      if (k.modo === 'TEXTO_SIMILITUD' && !k.respuesta_modelo?.trim()) {
        out.push(`«${c.etiqueta}» no tiene respuesta modelo con la que comparar.`);
      }
      if (k.modo === 'NUMERO_RANGO' && k.min == null && k.max == null) {
        out.push(`«${c.etiqueta}» no tiene ni mínimo ni máximo.`);
      }
      if ((k.modo === 'IA_RUBRICA' || k.modo === 'IA_VISION') && !k.rubrica?.trim()) {
        out.push(`«${c.etiqueta}» usa la IA sin rúbrica: sin criterio el modelo se inventa uno.`);
      }
    }
    return out;
  });

  constructor() {
    const id = Number(this.route.snapshot.paramMap.get('formId') ?? 0);
    this.formId.set(id);
    this.cargar();
  }

  private cargar(): void {
    this.cargando.set(true);
    this.svc.leer(this.formId()).subscribe({
      next: e => {
        this.examen.set({ ...e.examen, nota_minima: e.examen.nota_minima ?? 70 });
        this.campos.set(e.campos.filter(c => !TIPOS_NO_CALIFICABLES.includes((c.tipo ?? '').toUpperCase())));
        this.version.set(e.version);
        this.cargando.set(false);
        for (const c of e.campos) {
          if (c.calificacion?.modo === 'IA_INTERPRETACION') this.contarEjemplos(c.clave);
        }
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(err.error?.detail ?? 'No se pudo cargar la configuración del examen.');
        this.cargando.set(false);
      },
    });
  }

  private contarEjemplos(clave: string): void {
    this.svc.ejemplos(this.formId(), clave).subscribe({
      next: n => this.ejemplos.update(m => ({ ...m, [clave]: n })),
      error: () => { /* el contador es informativo: si falla, no se muestra y ya */ },
    });
  }

  // ── Estado de las tarjetas ─────────────────────────────────────────────────

  abierto(clave: string): boolean { return this.abiertos().has(clave); }

  alternar(clave: string): void {
    this.abiertos.update(s => {
      const n = new Set(s);
      if (n.has(clave)) n.delete(clave); else n.add(clave);
      return n;
    });
  }

  // ── Edición ────────────────────────────────────────────────────────────────

  cambiarExamen<K extends keyof ConfigExamen>(campo: K, valor: ConfigExamen[K]): void {
    this.examen.update(e => ({ ...e, [campo]: valor }));
  }

  elegirTipo(tipo: TipoExamen): void {
    this.cambiarExamen('tipo', tipo);
  }

  cfg(c: CampoExamen): ConfigCampo {
    return c.calificacion ?? { puntos: null, modo: null };
  }

  /** Modos que tiene sentido ofrecer para ESTE campo dentro de ESTE examen. */
  modosPara(c: CampoExamen): ModoInfo[] {
    const tipo = (c.tipo ?? '').toUpperCase();
    const proyectivo = this.examen().tipo === 'PROYECTIVO';
    return MODOS.filter(m => {
      if (proyectivo && m.puntuaConIa) return false;
      if (!m.tiposCampo.length) return true;
      return m.tiposCampo.includes(tipo);
    });
  }

  ayudaDe(modo: ModoCalificacion | null | undefined): string {
    return MODOS.find(m => m.modo === modo)?.ayuda ?? '';
  }

  actualizar(clave: string, patch: Partial<ConfigCampo>): void {
    this.campos.update(lista => lista.map(c => c.clave === clave
      ? { ...c, calificacion: { ...this.cfg(c), ...patch } }
      : c));
    if (patch.modo === 'IA_INTERPRETACION') this.contarEjemplos(clave);
  }

  cambiarModo(c: CampoExamen, modo: string): void {
    const m = (modo || null) as ModoCalificacion | null;
    // Los puntos se conservan al cambiar de modo (lo que vale la pregunta no depende de cómo
    // se corrige), pero la configuración vieja NO: una rúbrica no dice nada en un rango.
    this.campos.update(lista => lista.map(x => x.clave === c.clave
      ? { ...x, calificacion: { puntos: this.cfg(x).puntos ?? 10, modo: m,
                                referencia: this.cfg(x).referencia,
                                explicacion: this.cfg(x).explicacion } }
      : x));
    if (m && !this.abierto(c.clave)) this.alternar(c.clave);
    if (m === 'IA_INTERPRETACION') this.contarEjemplos(c.clave);
  }

  quitar(c: CampoExamen): void {
    this.campos.update(lista => lista.map(x => x.clave === c.clave ? { ...x, calificacion: null } : x));
  }

  // ── Listas que se editan como texto (una por línea) ────────────────────────

  aTexto(lista: string[] | null | undefined): string { return (lista ?? []).join('\n'); }

  aLista(texto: string): string[] {
    return texto.split('\n').map(t => t.trim()).filter(Boolean);
  }

  referencia(c: CampoExamen) {
    return this.cfg(c).referencia ?? { leccion_id: null, bloque_id: null, segundo: null, url: null, texto: null };
  }

  cambiarReferencia(c: CampoExamen, patch: Record<string, unknown>): void {
    this.actualizar(c.clave, { referencia: { ...this.referencia(c), ...patch } });
  }

  /** "3:20" ⇄ segundos, que es como lo guarda el reproductor de capacitaciones. */
  segundosATexto(s: number | null | undefined): string {
    if (s == null) return '';
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }

  textoASegundos(t: string): number | null {
    const limpio = (t ?? '').trim();
    if (!limpio) return null;
    const partes = limpio.split(':').map(p => Number(p.trim()));
    if (partes.some(n => Number.isNaN(n))) return null;
    return partes.length === 2 ? partes[0] * 60 + partes[1] : partes[0];
  }

  // ── Guardar ────────────────────────────────────────────────────────────────

  guardar(): void {
    const problemas = this.problemas();
    if (problemas.length) {
      Swal.fire({
        icon: 'warning',
        title: 'Falta algo por definir',
        html: `<ul style="text-align:left;margin:0;padding-left:18px">${
          problemas.map(p => `<li>${p}</li>`).join('')}</ul>`,
        confirmButtonText: 'Lo reviso',
      });
      return;
    }

    const campos: Record<string, ConfigCampo> = {};
    for (const c of this.campos()) {
      if (c.calificacion?.modo) campos[c.clave] = c.calificacion;
    }

    this.guardando.set(true);
    this.svc.guardar(this.formId(), { examen: this.examen(), campos }).subscribe({
      next: e => {
        this.campos.set(e.campos.filter(c => !TIPOS_NO_CALIFICABLES.includes((c.tipo ?? '').toUpperCase())));
        this.guardando.set(false);
        Swal.fire({
          icon: 'success',
          title: 'Hoja de respuestas guardada',
          text: this.examen().es_examen
            ? 'Las respuestas nuevas se califican solas. Las que ya estaban recibidas se recalifican desde la bandeja de respuestas.'
            : 'La configuración quedó guardada, pero el formulario todavía no está marcado como examen.',
          timer: 4200,
          timerProgressBar: true,
        });
      },
      error: (err: HttpErrorResponse) => {
        this.guardando.set(false);
        Swal.fire({
          icon: 'error',
          title: 'No se pudo guardar',
          text: err.error?.detail ?? 'Revisa la configuración e inténtalo otra vez.',
        });
      },
    });
  }

  volver(): void {
    this.router.navigate(['../'], { relativeTo: this.route });
  }
}
