import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';
import { EditorCodigo } from './editor-codigo';
import { ResultadoPruebas } from './resultado-pruebas';
import {
  CasoPrueba, CodigoService, EjercicioCodigo, LENGUAJES_EJERCICIO, ModoEjercicio, ResultadoCodigo,
  ayudaFunciones, ejemploLlamada, ejercicioNuevo, plantillaDe,
} from '../../service/codigo.service';
import { mensajeDeError } from '../../service/disenador.service';

/**
 * Editor de un ejercicio de programación para quien diseña: lenguaje, cómo se califica, el
 * código inicial, la solución de referencia y los casos de prueba. La solución calcula los
 * esperados y se verifica contra todos los casos; la IA propone casos desde el enunciado.
 *
 * Se usa con [(ejercicio)]. Antes de guardar, quien lo usa llama a {@link completarEsperados}
 * para no guardar casos sin resultado esperado.
 */
@Component({
  selector: 'app-ejercicio-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule, EditorCodigo, ResultadoPruebas],
  template: `
    @if (e(); as ej) {
      <div class="ee">
        <div class="ee-fila">
          <label class="ee-campo">
            <span>Lenguaje</span>
            <select [ngModel]="ej.lenguaje" (ngModelChange)="cambiarLenguaje($event)" aria-label="Lenguaje del ejercicio">
              @for (l of lenguajes; track l.id) { <option [value]="l.id">{{ l.nombre }}</option> }
            </select>
          </label>
          <div class="ee-campo">
            <span>Cómo se califica</span>
            <div class="ee-modos" role="radiogroup" aria-label="Cómo se califica">
              <button type="button" role="radio" [attr.aria-checked]="ej.modo === 'FUNCIONES'" [class.activo]="ej.modo === 'FUNCIONES'"
                      [disabled]="!conFunciones(ej.lenguaje)" (click)="cambiarModo('FUNCIONES')">
                <mat-icon>functions</mat-icon> Pruebas de funciones</button>
              <button type="button" role="radio" [attr.aria-checked]="ej.modo === 'SALIDA'" [class.activo]="ej.modo === 'SALIDA'"
                      (click)="cambiarModo('SALIDA')">
                <mat-icon>terminal</mat-icon> Entrada y salida</button>
            </div>
          </div>
        </div>
        <p class="ee-ayuda">
          @if (ej.modo === 'FUNCIONES') {
            Se llaman las funciones del estudiante y se compara lo que devuelven con lo esperado. {{ ayuda(ej.lenguaje) }}
          } @else {
            El programa lee la entrada del caso y tiene que escribir exactamente la salida esperada.
          }
        </p>

        <div class="ee-dos">
          <div class="ee-bloque">
            <div class="ee-tit"><mat-icon>edit_note</mat-icon> Código inicial <small>lo que ve el estudiante al empezar</small></div>
            <app-editor-codigo [lenguaje]="ej.lenguaje" [valor]="ej.plantilla ?? ''" (valorChange)="parche({ plantilla: $event })"
                               alto="180px" etiqueta="Código inicial" />
          </div>
          <div class="ee-bloque">
            <div class="ee-tit"><mat-icon>verified</mat-icon> Solución de referencia <small>nunca la ve el estudiante</small></div>
            <app-editor-codigo [lenguaje]="ej.lenguaje" [valor]="ej.solucion ?? ''" (valorChange)="parche({ solucion: $event })"
                               alto="180px" etiqueta="Solución de referencia" />
          </div>
        </div>

        <div class="ee-tit ee-tit--casos">
          <mat-icon>checklist</mat-icon> Casos de prueba <small>{{ ej.casos.length }} · {{ ocultos(ej) }} ocultos</small>
          <span class="ee-sep"></span>
          <button type="button" class="ee-btn" (click)="sugerir()" [disabled]="ocupado()" title="La IA propone casos a partir del enunciado">
            <mat-icon>auto_awesome</mat-icon> Sugerir con IA</button>
          <button type="button" class="ee-btn" (click)="calcular()" [disabled]="ocupado() || sinCompilador() || !ej.solucion?.trim()"
                  title="Corre la solución en cada caso y escribe el resultado esperado">
            <mat-icon>calculate</mat-icon> Calcular esperados</button>
          <button type="button" class="ee-btn ee-btn--primario" (click)="verificar()" [disabled]="ocupado() || sinCompilador() || !ej.solucion?.trim()"
                  title="Corre la solución contra todos los casos: debería pasarlos todos">
            <mat-icon>play_arrow</mat-icon> Verificar solución</button>
        </div>
        @if (sinCompilador()) {
          <p class="ee-aviso"><mat-icon>info</mat-icon> El compilador (Piston) todavía no está activo: escribe los esperados a mano. Calcular y Verificar se activan en cuanto lo esté.</p>
        }
        @if (estado()) { <p class="ee-estado" role="status"><span class="ee-punto"></span> {{ estado() }}</p> }

        <ol class="ee-casos">
          @for (c of ej.casos; track $index; let i = $index) {
            <li class="ee-caso" [class.oculto]="c.oculto">
              <div class="ee-caso__cab">
                <b>{{ i + 1 }}</b>
                <input class="ee-nombre" [ngModel]="c.nombre ?? ''" (ngModelChange)="caso(i, { nombre: $event })"
                       placeholder="Qué prueba (p. ej. números negativos)" [attr.aria-label]="'Nombre del caso ' + (i + 1)" />
                <label class="ee-mini" title="Cuánto vale frente a los demás casos">Peso
                  <input type="number" min="0.1" max="100" step="0.5" [ngModel]="c.peso ?? 1" (ngModelChange)="caso(i, { peso: +$event || 1 })" /></label>
                <label class="ee-mini ee-chk" title="Cuenta para la nota, pero el estudiante no ve su contenido">
                  <input type="checkbox" [ngModel]="!!c.oculto" (ngModelChange)="caso(i, { oculto: $event })" /> Oculto</label>
                <button type="button" class="ee-x" (click)="quitar(i)" [attr.aria-label]="'Quitar el caso ' + (i + 1)" [disabled]="ej.casos.length <= 1">
                  <mat-icon>delete</mat-icon></button>
              </div>
              @if (ej.modo === 'FUNCIONES') {
                <div class="ee-caso__cuerpo ee-caso__cuerpo--fn">
                  <label><span>Llamada</span>
                    <input class="mono" [ngModel]="c.llamada ?? ''" (ngModelChange)="caso(i, { llamada: $event })" [placeholder]="ejemplo(ej.lenguaje)" /></label>
                  <label><span>Esperado</span>
                    <input class="mono" [ngModel]="c.esperado ?? ''" (ngModelChange)="caso(i, { esperado: $event })" placeholder="p. ej. 5 (o calcúlalo)"
                           [class.falta]="!c.esperado?.trim()" /></label>
                </div>
              } @else {
                <div class="ee-caso__cuerpo">
                  <label><span>Entrada</span>
                    <textarea class="mono" rows="2" [ngModel]="c.entrada ?? ''" (ngModelChange)="caso(i, { entrada: $event })" placeholder="p. ej. 2 3"></textarea></label>
                  <label><span>Salida esperada</span>
                    <textarea class="mono" rows="2" [ngModel]="c.salida_esperada ?? ''" (ngModelChange)="caso(i, { salida_esperada: $event })"
                              placeholder="p. ej. 5 (o calcúlala)" [class.falta]="c.salida_esperada == null"></textarea></label>
                </div>
              }
              @if (notas()[i]) { <p class="ee-nota"><mat-icon>info</mat-icon> {{ notas()[i] }}</p> }
            </li>
          }
        </ol>
        <div class="ee-pie">
          <button type="button" class="ee-btn" (click)="agregar()" [disabled]="ej.casos.length >= 15"><mat-icon>add</mat-icon> Agregar caso</button>
          @if (ej.modo === 'SALIDA') {
            <label class="ee-chk"><input type="checkbox" [ngModel]="ej.ignorar_espacios !== false" (ngModelChange)="parche({ ignorar_espacios: $event })" />
              Ignorar espacios de más</label>
            <label class="ee-chk"><input type="checkbox" [ngModel]="!!ej.ignorar_mayusculas" (ngModelChange)="parche({ ignorar_mayusculas: $event })" />
              Ignorar mayúsculas</label>
          } @else {
            <label class="ee-chk" title="Cuánto pueden diferir dos decimales para darlos por iguales">Tolerancia decimal
              <input type="number" step="any" min="0" class="ee-tol" [ngModel]="ej.tolerancia ?? 0.000001" (ngModelChange)="parche({ tolerancia: +$event })" /></label>
          }
        </div>

        @if (verificacion(); as v) {
          <div class="ee-verif">
            <div class="ee-tit"><mat-icon>fact_check</mat-icon> Verificación de la solución</div>
            <app-resultado-pruebas [resultado]="v" [mostrarNota]="false" />
          </div>
        }
      </div>
    }
  `,
  styles: [`
    .ee { display: grid; gap: 12px; }
    .ee-fila { display: grid; grid-template-columns: minmax(140px, 200px) minmax(0, 1fr); gap: 12px; align-items: end; }
    .ee-campo { display: grid; gap: 4px; font-size: 13px; }
    .ee-campo > span { font-weight: 700; color: var(--text-2); }
    .ee-campo select { font: 14px var(--font-sans); padding: 9px 10px; border-radius: 10px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--text); }
    .ee-modos { display: flex; gap: 6px; flex-wrap: wrap; }
    .ee-modos button { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--text); border-radius: 10px; padding: 0 12px; min-height: 40px !important; font: 600 13px var(--font-sans); cursor: pointer; }
    .ee-modos button.activo { background: var(--primary); border-color: var(--primary); color: #fff; }
    .ee-modos button:disabled { opacity: .45; cursor: not-allowed; }
    .ee-modos mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .ee-ayuda { margin: 0; font-size: 12.5px; color: var(--muted); }
    .ee-dos { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .ee-bloque { display: grid; gap: 6px; min-width: 0; }
    .ee-tit { display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 14px; flex-wrap: wrap; }
    .ee-tit small { font-weight: 500; color: var(--muted); font-size: 12px; }
    .ee-tit mat-icon { font-size: 19px; width: 19px; height: 19px; color: var(--primary); }
    .ee-sep { flex: 1; }
    .ee-btn { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--text); border-radius: 999px; padding: 0 12px; min-height: 36px !important; font: 600 12.5px var(--font-sans); cursor: pointer; }
    .ee-btn mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .ee-btn:disabled { opacity: .5; cursor: not-allowed; }
    .ee-btn--primario { background: var(--primary); border-color: var(--primary); color: #fff; }
    .ee-aviso { margin: 0; display: flex; gap: 6px; align-items: flex-start; font-size: 13px; padding: 8px 10px; border-radius: 10px; background: var(--info-bg, var(--surface-2)); color: var(--info-fg, var(--text-2)); }
    .ee-aviso mat-icon { font-size: 18px; width: 18px; height: 18px; flex: none; }
    .ee-estado { margin: 0; display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--info-fg, var(--primary)); }
    .ee-punto { width: 8px; height: 8px; border-radius: 50%; background: currentColor; animation: ee-l 1.1s infinite; }
    @keyframes ee-l { 50% { opacity: .25; } }
    .ee-casos { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    .ee-caso { border: 1px solid var(--border); border-radius: 12px; padding: 8px 10px; background: var(--surface-2); display: grid; gap: 6px; }
    .ee-caso.oculto { border-style: dashed; }
    .ee-caso__cab { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .ee-caso__cab b { width: 22px; height: 22px; border-radius: 50%; background: var(--surface-3); display: grid; place-items: center; font-size: 12px; flex: none; }
    .ee-nombre { flex: 1; min-width: 140px; font: 13px var(--font-sans); padding: 6px 8px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text); }
    .ee-mini { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--muted); }
    .ee-mini input[type=number] { width: 58px; padding: 5px 6px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text); }
    .ee-chk { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; }
    .ee-x { border: 0; background: transparent; color: var(--muted); cursor: pointer; width: 34px; min-height: 34px !important; border-radius: 8px; display: grid; place-items: center; }
    .ee-x:hover:not(:disabled) { color: #dc2626; background: var(--surface-3); }
    .ee-caso__cuerpo { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .ee-caso__cuerpo label { display: grid; gap: 3px; font-size: 11.5px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .03em; min-width: 0; }
    .ee-caso__cuerpo input, .ee-caso__cuerpo textarea { font: 13px/1.4 var(--font-mono); padding: 7px 8px; border-radius: 8px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--text); text-transform: none; letter-spacing: 0; resize: vertical; min-width: 0; }
    .ee-caso__cuerpo .falta { border-color: #f59e0b; }
    .ee-nota { margin: 0; display: flex; gap: 6px; align-items: flex-start; font-size: 12.5px; color: var(--warn-fg, #92400e); }
    .ee-nota mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .ee-pie { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
    .ee-tol { width: 110px; padding: 5px 8px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text); }
    .ee-verif { display: grid; gap: 6px; }
    @media (max-width: 760px) {
      .ee-fila, .ee-dos, .ee-caso__cuerpo { grid-template-columns: minmax(0, 1fr); }
    }
  `],
})
export class EjercicioEditor implements OnChanges {
  private api = inject(CodigoService);

  @Input() ejercicio: EjercicioCodigo | null = null;
  /** El enunciado, para que la IA proponga casos. */
  @Input() enunciado = '';
  @Output() ejercicioChange = new EventEmitter<EjercicioCodigo>();

  readonly lenguajes = LENGUAJES_EJERCICIO;
  readonly e = signal<EjercicioCodigo | null>(null);
  readonly ocupado = signal(false);
  readonly estado = signal('');
  readonly notas = signal<(string | null)[]>([]);
  readonly verificacion = signal<ResultadoCodigo | null>(null);
  readonly sinCompilador = signal(false);

  constructor() {
    this.api.estado().then(e => this.sinCompilador.set(!e.piston_configurado)).catch(() => { /* se sabra al usarlo */ });
  }

  ngOnChanges(c: SimpleChanges): void {
    if (c['ejercicio'] && this.ejercicio !== this.e()) {
      this.e.set(this.ejercicio ? structuredClone(this.ejercicio) : ejercicioNuevo());
      if (!this.ejercicio) queueMicrotask(() => this.emitir());
    }
  }

  conFunciones(l: string): boolean {
    return !!LENGUAJES_EJERCICIO.find(x => x.id === l)?.funciones;
  }

  ayuda(l: string): string {
    return ayudaFunciones(l);
  }

  ejemplo(l: string): string {
    return ejemploLlamada(l);
  }

  ocultos(e: EjercicioCodigo): number {
    return e.casos.filter(c => c.oculto).length;
  }

  parche(p: Partial<EjercicioCodigo>): void {
    const e = this.e();
    if (!e) return;
    this.e.set({ ...e, ...p });
    this.verificacion.set(null);
    this.emitir();
  }

  caso(i: number, p: Partial<CasoPrueba>): void {
    const e = this.e();
    if (!e) return;
    const casos = e.casos.map((c, j) => j === i ? { ...c, ...p } : c);
    this.e.set({ ...e, casos });
    this.verificacion.set(null);
    this.emitir();
  }

  agregar(): void {
    const e = this.e();
    if (!e) return;
    const nuevo: CasoPrueba = e.modo === 'FUNCIONES' ? { llamada: '', esperado: '', peso: 1 } : { entrada: '', salida_esperada: null, peso: 1 };
    this.parche({ casos: [...e.casos, nuevo] });
    this.notas.set([...this.notas(), null]);
  }

  quitar(i: number): void {
    const e = this.e();
    if (!e || e.casos.length <= 1) return;
    this.parche({ casos: e.casos.filter((_, j) => j !== i) });
    this.notas.set(this.notas().filter((_, j) => j !== i));
  }

  cambiarLenguaje(l: string): void {
    const e = this.e();
    if (!e) return;
    const modo = this.conFunciones(l) ? e.modo : 'SALIDA';
    // La plantilla por defecto se cambia sola; una escrita a mano se respeta.
    const plantillaPorDefecto = !e.plantilla?.trim() || e.plantilla === plantillaDe(e.lenguaje, e.modo);
    this.parche({ lenguaje: l, modo, plantilla: plantillaPorDefecto ? plantillaDe(l, modo) : e.plantilla });
  }

  cambiarModo(m: ModoEjercicio): void {
    const e = this.e();
    if (!e || e.modo === m) return;
    const plantillaPorDefecto = !e.plantilla?.trim() || e.plantilla === plantillaDe(e.lenguaje, e.modo);
    const casos = e.casos.map(c => m === 'FUNCIONES'
      ? { nombre: c.nombre, llamada: c.llamada ?? '', esperado: c.esperado ?? '', peso: c.peso, oculto: c.oculto }
      : { nombre: c.nombre, entrada: c.entrada ?? '', salida_esperada: c.salida_esperada ?? null, peso: c.peso, oculto: c.oculto });
    this.parche({ modo: m, casos, plantilla: plantillaPorDefecto ? plantillaDe(e.lenguaje, m) : e.plantilla });
  }

  private emitir(): void {
    const e = this.e();
    if (e) this.ejercicioChange.emit(e);
  }

  // ── Acciones con el servidor ──────────────────────────────────────────────

  async sugerir(): Promise<void> {
    const e = this.e();
    if (!e) return;
    if (!this.enunciado?.trim()) {
      Swal.fire({ icon: 'info', title: 'Falta el enunciado', text: 'Escribe primero qué tiene que hacer el programa: de ahí salen los casos.' });
      return;
    }
    await this.trabajar('La IA está pensando casos de prueba…', async () => {
      const t = await this.api.esperar(await this.api.sugerir(this.enunciado, e, 5), x => this.progreso(x.estado));
      if (t.estado === 'ERROR') throw new Error(t.error || 'La IA no pudo proponer casos');
      const nuevos = t.casos ?? [];
      // Los casos vacíos del ejercicio nuevo se reemplazan; los que ya tienen algo se conservan.
      const conservar = e.casos.filter(c => (c.llamada?.trim() || c.entrada?.trim()) && (c.esperado?.trim() || c.salida_esperada != null));
      this.parche({ casos: [...conservar, ...nuevos].slice(0, 15) });
      this.notas.set([]);
      if (e.solucion?.trim()) await this.calcularInterno();
      Swal.fire({ toast: true, position: 'top-end', timer: 3000, showConfirmButton: false, icon: 'success',
        title: `${nuevos.length} casos propuestos${e.solucion?.trim() ? ' y esperados calculados con tu solución' : ''}` });
    });
  }

  async calcular(): Promise<void> {
    await this.trabajar('Corriendo tu solución en cada caso…', () => this.calcularInterno());
  }

  private async calcularInterno(): Promise<void> {
    const e = this.e();
    if (!e) return;
    this.estado.set('Corriendo tu solución en cada caso…');
    const t = await this.api.esperar(await this.api.esperados(e), x => this.progreso(x.estado));
    if (t.estado === 'ERROR' || !t.ejercicio) throw new Error(t.error || 'No se pudieron calcular');
    const calc = t.ejercicio;
    // Solo se tocan los esperados: lo demás pudo cambiar mientras corría.
    const actual = this.e()!;
    const casos = actual.casos.map((c, i) => calc.casos[i]
      ? { ...c, esperado: calc.casos[i].esperado ?? c.esperado, salida_esperada: calc.casos[i].salida_esperada ?? c.salida_esperada }
      : c);
    this.parche({ casos });
    this.notas.set(t.notas ?? []);
  }

  async verificar(): Promise<void> {
    const e = this.e();
    if (!e) return;
    await this.trabajar('Verificando tu solución contra todos los casos…', async () => {
      const t = await this.api.esperar(await this.api.verificar(e), x => this.progreso(x.estado));
      if (t.estado === 'ERROR') throw new Error(t.error || 'No se pudo verificar');
      this.verificacion.set(t.resultado ?? null);
    });
  }

  /**
   * Para quien guarda: si hay solución y algún caso sin esperado, los calcula. Devuelve el
   * ejercicio listo para guardar, o lanza con lo que falta.
   */
  async completarEsperados(): Promise<EjercicioCodigo> {
    const e = this.e();
    if (!e) throw new Error('Falta el ejercicio');
    const faltan = e.casos.some(c => e.modo === 'FUNCIONES' ? !c.esperado?.trim() : c.salida_esperada == null);
    if (faltan) {
      if (!e.solucion?.trim() || this.sinCompilador()) {
        throw new Error(this.sinCompilador()
          ? 'Hay casos sin resultado esperado y el compilador todavía no está activo: escríbelos a mano.'
          : 'Hay casos sin resultado esperado: escríbelos o pon la solución de referencia para calcularlos.');
      }
      await this.trabajar('Calculando los resultados esperados…', () => this.calcularInterno(), true);
      const d = this.e()!;
      if (d.casos.some(c => d.modo === 'FUNCIONES' ? !c.esperado?.trim() : c.salida_esperada == null)) {
        throw new Error('Algunos casos quedaron sin resultado esperado: revisa las notas de cada caso.');
      }
    }
    return this.e()!;
  }

  private progreso(estado: string): void {
    if (estado === 'EN_COLA') this.estado.set('En cola: esperando el compilador…');
  }

  private async trabajar(mensaje: string, f: () => Promise<void>, relanzar = false): Promise<void> {
    this.ocupado.set(true);
    this.estado.set(mensaje);
    try {
      await f();
    } catch (err) {
      if (relanzar) throw err;
      Swal.fire({ icon: 'error', title: 'No se pudo', text: err instanceof Error ? err.message : mensajeDeError(err) });
    } finally {
      this.ocupado.set(false);
      this.estado.set('');
    }
  }
}
