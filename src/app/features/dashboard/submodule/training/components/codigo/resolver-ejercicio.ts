import {
  ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges, inject, signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';
import { EditorCodigo } from './editor-codigo';
import { ResultadoPruebas } from './resultado-pruebas';
import { CodigoService, EjercicioCodigo, OrigenEjercicio, ResultadoCodigo, nombreLenguaje } from '../../service/codigo.service';
import { mensajeDeError } from '../../service/disenador.service';

/**
 * Donde el estudiante resuelve un ejercicio de programación: ve qué se va a probar, escribe en
 * el editor (arranca con la plantilla y guarda un borrador en este navegador), prueba contra
 * las pruebas visibles y, si es una actividad o un reto del aula, entrega.
 *
 * En un quiz o un examen no entrega él: el código viaja con la respuesta ([(valor)]).
 */
@Component({
  selector: 'app-resolver-ejercicio',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, EditorCodigo, ResultadoPruebas],
  template: `
    @if (ejercicio; as ej) {
      <div class="re">
        <div class="re-cab">
          <span class="re-chip"><mat-icon>code</mat-icon> {{ lenguaje(ej.lenguaje) }}</span>
          <span class="re-como">
            {{ ej.modo === 'FUNCIONES' ? 'Se prueban tus funciones: lo que devuelven se compara con lo esperado.' : 'Tu programa lee la entrada y tiene que escribir la salida esperada.' }}
          </span>
        </div>

        <details class="re-pruebas" [open]="visibles(ej).length <= 4">
          <summary>Qué se va a probar <small>{{ visibles(ej).length }} {{ visibles(ej).length === 1 ? 'visible' : 'visibles' }}@if (ocultas(ej)) { · {{ ocultas(ej) }} {{ ocultas(ej) === 1 ? 'oculta' : 'ocultas' }}}</small></summary>
          <ul>
            @for (c of visibles(ej); track $index) {
              <li>
                @if (c.nombre) { <b>{{ c.nombre }}</b> }
                @if (ej.modo === 'FUNCIONES') {
                  <code>{{ c.llamada }}</code> <span class="re-flecha">→</span> <code>{{ c.esperado }}</code>
                } @else {
                  <span class="re-io"><small>Entrada</small><code>{{ c.entrada || '(vacía)' }}</code></span>
                  <span class="re-io"><small>Salida</small><code>{{ c.salida_esperada }}</code></span>
                }
              </li>
            }
          </ul>
          @if (ocultas(ej)) { <p class="re-ocultas"><mat-icon>visibility_off</mat-icon> {{ ocultas(ej) === 1 ? 'Hay 1 prueba oculta: cuenta' : 'Hay ' + ocultas(ej) + ' pruebas ocultas: cuentan' }} para la nota, así que no programes solo para los ejemplos.</p> }
        </details>

        <app-editor-codigo [lenguaje]="ej.lenguaje" [valor]="codigo()" (valorChange)="escribir($event)"
                           [soloLectura]="deshabilitado" [bloqueaPegado]="bloqueaPegado" alto="220px" etiqueta="Tu solución" />

        @if (sinCompilador()) {
          <p class="re-aviso"><mat-icon>info</mat-icon> El compilador todavía no está activo: no se puede probar ahora, pero puedes entregar y se calificará en cuanto lo esté.</p>
        }
        <div class="re-acc">
          <button type="button" class="re-btn" (click)="probar()" [disabled]="probando() || deshabilitado || sinCompilador() || !codigo().trim()">
            <mat-icon>{{ probando() ? 'hourglass_top' : 'science' }}</mat-icon> {{ probando() ? estadoPrueba() : 'Probar' }}</button>
          <button type="button" class="re-btn re-btn--suave" (click)="restaurar()" [disabled]="deshabilitado" title="Volver al código con que empezó">
            <mat-icon>restart_alt</mat-icon> Código inicial</button>
          <span class="re-sep"></span>
          @if (modo === 'entrega') {
            <button type="button" class="re-btn re-btn--primario" (click)="entregarCodigo()" [disabled]="deshabilitado || calificando || !codigo().trim()">
              <mat-icon>send</mat-icon> {{ textoEntregar }}</button>
          }
        </div>

        @if (calificando) {
          <p class="re-calif" role="status"><span class="re-punto"></span> Calificando tu entrega con todas las pruebas…</p>
        }
        @if (resultado && !calificando) {
          <app-resultado-pruebas [resultado]="resultado" />
        } @else if (prueba(); as p) {
          <app-resultado-pruebas [resultado]="p" [mostrarNota]="false" />
        }
      </div>
    }
  `,
  styles: [`
    .re { display: grid; gap: 10px; min-width: 0; }
    .re-cab { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .re-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 999px; background: var(--mt-accent-soft, var(--surface-3)); color: var(--mt-accent-ink, var(--text)); font: 700 12.5px var(--font-sans); }
    .re-chip mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .re-como { font-size: 13px; color: var(--muted); }
    .re-pruebas { border: 1px solid var(--border); border-radius: 12px; padding: 8px 12px; background: var(--surface-2); }
    .re-pruebas summary { cursor: pointer; font-weight: 700; font-size: 13.5px; }
    .re-pruebas summary small { font-weight: 500; color: var(--muted); margin-left: 6px; }
    .re-pruebas ul { margin: 8px 0 0; padding: 0; list-style: none; display: grid; gap: 6px; }
    .re-pruebas li { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; font-size: 13px; min-width: 0; }
    .re-pruebas code { font: 12.5px/1.4 var(--font-mono); background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 1px 6px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .re-flecha { color: var(--muted); }
    .re-io { display: inline-flex; gap: 4px; align-items: baseline; min-width: 0; }
    .re-io small { font-size: 11px; color: var(--muted); font-weight: 700; text-transform: uppercase; }
    .re-ocultas { margin: 8px 0 0; display: flex; gap: 6px; align-items: center; font-size: 12.5px; color: var(--muted); }
    .re-ocultas mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .re-acc { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .re-sep { flex: 1; }
    .re-btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--text); border-radius: 999px; padding: 0 16px; min-height: 40px !important; font: 700 13.5px var(--font-sans); cursor: pointer; }
    .re-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .re-btn:disabled { opacity: .5; cursor: not-allowed; }
    .re-btn--suave { border-color: transparent; background: transparent; color: var(--muted); }
    .re-btn--primario { background: var(--primary); border-color: var(--primary); color: #fff; }
    .re-aviso { margin: 0; display: flex; gap: 6px; align-items: flex-start; font-size: 13px; padding: 8px 10px; border-radius: 10px; background: var(--info-bg, var(--surface-2)); color: var(--info-fg, var(--text-2)); }
    .re-aviso mat-icon { font-size: 18px; width: 18px; height: 18px; flex: none; }
    .re-calif { margin: 0; display: flex; gap: 8px; align-items: center; font-size: 13.5px; color: var(--primary); }
    .re-punto { width: 9px; height: 9px; border-radius: 50%; background: currentColor; animation: re-l 1.1s infinite; }
    @keyframes re-l { 50% { opacity: .25; } }
  `],
})
export class ResolverEjercicio implements OnInit, OnChanges {
  private api = inject(CodigoService);

  @Input({ required: true }) ejercicio!: EjercicioCodigo | null;
  @Input({ required: true }) origen!: OrigenEjercicio;
  @Input({ required: true }) origenId!: string;
  /** El código (en quices y exámenes viaja con la respuesta). */
  @Input() valor: string | null = null;
  /** respuesta = lo entrega quien contiene (quiz/examen); entrega = tiene su botón Entregar. */
  @Input() modo: 'respuesta' | 'entrega' = 'respuesta';
  @Input() textoEntregar = 'Entregar';
  @Input() deshabilitado = false;
  @Input() bloqueaPegado = false;
  /** El resultado calificado de la última entrega (con las ocultas). */
  @Input() resultado: ResultadoCodigo | null = null;
  @Input() calificando = false;
  @Output() valorChange = new EventEmitter<string>();
  @Output() entregar = new EventEmitter<string>();

  readonly codigo = signal('');
  readonly probando = signal(false);
  readonly estadoPrueba = signal('Probando…');
  readonly prueba = signal<ResultadoCodigo | null>(null);
  readonly sinCompilador = signal(false);

  private get claveBorrador(): string {
    return `tuapo.codigo.${this.origen}.${this.origenId}`;
  }

  ngOnInit(): void {
    this.api.estado().then(e => this.sinCompilador.set(!e.piston_configurado)).catch(() => { /* se sabra al probar */ });
    const inicial = this.valor?.length ? this.valor : this.borrador() ?? this.ejercicio?.plantilla ?? '';
    this.codigo.set(inicial);
    if (inicial !== (this.valor ?? '')) this.valorChange.emit(inicial);
  }

  ngOnChanges(c: SimpleChanges): void {
    if (c['valor'] && !c['valor'].firstChange && this.valor != null && this.valor !== this.codigo()) {
      this.codigo.set(this.valor);
    }
  }

  lenguaje(l: string): string {
    return nombreLenguaje(l);
  }

  visibles(e: EjercicioCodigo) {
    return e.casos.filter(c => !c.oculto);
  }

  ocultas(e: EjercicioCodigo): number {
    return e.casos.filter(c => c.oculto).length;
  }

  escribir(v: string): void {
    this.codigo.set(v);
    this.valorChange.emit(v);
    try { localStorage.setItem(this.claveBorrador, v); } catch { /* sin almacenamiento: no pasa nada */ }
  }

  restaurar(): void {
    this.escribir(this.ejercicio?.plantilla ?? '');
    this.prueba.set(null);
  }

  private borrador(): string | null {
    try { return localStorage.getItem(this.claveBorrador); } catch { return null; }
  }

  async probar(): Promise<void> {
    if (!this.codigo().trim()) return;
    this.probando.set(true);
    this.estadoPrueba.set('Probando…');
    try {
      const t = await this.api.esperar(await this.api.probar(this.origen, this.origenId, this.codigo()),
        x => this.estadoPrueba.set(x.estado === 'EN_COLA' ? 'En cola…' : 'Ejecutando…'));
      if (t.estado === 'ERROR') throw new Error(t.error || 'No se pudo probar');
      this.prueba.set(t.resultado ?? null);
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo probar', text: e instanceof Error ? e.message : mensajeDeError(e) });
    } finally {
      this.probando.set(false);
    }
  }

  entregarCodigo(): void {
    if (!this.codigo().trim()) return;
    this.entregar.emit(this.codigo());
  }
}
