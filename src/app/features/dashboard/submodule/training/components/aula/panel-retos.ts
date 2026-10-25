import { ChangeDetectionStrategy, Component, DestroyRef, Input, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';
import { Aula, AulasService, Entrega, Espacio } from '../../service/aulas.service';
import { EjercicioCodigo, ejercicioNuevo, nombreLenguaje } from '../../service/codigo.service';
import { mensajeDeError } from '../../service/disenador.service';
import { PreguntaEncontrada, TrainingAdminService } from '../../service/training-admin.service';
import { SalaEnVivo } from '../../aula/sala-en-vivo';
import { EjercicioEditor } from '../codigo/ejercicio-editor';
import { ResolverEjercicio } from '../codigo/resolver-ejercicio';
import { ResultadoPruebas } from '../codigo/resultado-pruebas';

/**
 * Retos de programación del aula: quien dirige lanza un ejercicio con pruebas (armado ahí o
 * copiado del banco) y cada participante lo resuelve en su propio editor y lo entrega; la nota
 * la ponen las pruebas en unos segundos. Quien dirige ve quién entregó y cuánto sacó.
 */
@Component({
  selector: 'app-aula-retos',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule, DecimalPipe, EjercicioEditor, ResolverEjercicio, ResultadoPruebas],
  template: `
    @if (dirijo) {
      <button type="button" class="rt-nuevo" (click)="abrirDiseno()"><mat-icon>add_circle</mat-icon> Nuevo reto de programación</button>
    }
    @for (r of retos(); track r.id) {
      <section class="rt-reto">
        <header>
          <strong>{{ r.nombre }}</strong>
          <span>{{ lenguaje(r.lenguaje) }} · {{ r.ejercicio?.casos?.length ?? 0 }} pruebas
            @if (dirijo) { · {{ entregasDe(r.id).length }} entrega(s) }</span>
        </header>
        @if (!dirijo) {
          @if (mejorDe(r.id); as m) {
            <p class="rt-nota" [class.rt-nota--ok]="(m.nota ?? 0) >= 100">
              @if (m.calificando) { <span class="rt-punto"></span> Calificando tu entrega… } @else { Tu mejor nota: <b>{{ m.nota | number: '1.0-0' }}</b>/100 }
            </p>
          }
        }
        <div class="rt-fila">
          @if (!dirijo) {
            <button type="button" class="rt-btn rt-btn--primario" (click)="resolver(r)"><mat-icon>code</mat-icon> Resolver</button>
          } @else {
            <button type="button" class="rt-btn" (click)="verEntregas(r)"><mat-icon>grading</mat-icon> Entregas</button>
            <button type="button" class="rt-btn" (click)="resolver(r)"><mat-icon>visibility</mat-icon> Ver como participante</button>
          }
        </div>
      </section>
    } @empty {
      <p class="rt-vacio">{{ dirijo ? 'Lanza un reto: el grupo programa, entrega y las pruebas lo califican solas.' : 'Aquí aparecerán los retos de programación de quien dirige.' }}</p>
    }

    <!-- ── Diseñar un reto (quien dirige) ── -->
    @if (disenando()) {
      <div class="rt-velo" (click)="cerrarDiseno()">
        <div class="rt-modal" role="dialog" aria-modal="true" aria-label="Nuevo reto de programación" (click)="$event.stopPropagation()">
          <header class="rt-modal__cab">
            <h3><mat-icon>add_circle</mat-icon> Nuevo reto de programación</h3>
            <button type="button" class="rt-x" (click)="cerrarDiseno()" aria-label="Cerrar"><mat-icon>close</mat-icon></button>
          </header>
          <div class="rt-modal__cuerpo">
            <div class="rt-origen" role="tablist">
              <button type="button" role="tab" [attr.aria-selected]="origen() === 'aqui'" [class.activo]="origen() === 'aqui'" (click)="origen.set('aqui')">
                <mat-icon>edit</mat-icon> Armarlo aquí</button>
              @if (puedeBanco()) {
                <button type="button" role="tab" [attr.aria-selected]="origen() === 'banco'" [class.activo]="origen() === 'banco'" (click)="origen.set('banco'); buscar()">
                  <mat-icon>inventory_2</mat-icon> Del banco de preguntas</button>
              }
            </div>
            @if (origen() === 'aqui') {
              <label class="rt-campo"><span>Título</span><input [(ngModel)]="titulo" maxlength="200" placeholder="Ej: Suma de pares" /></label>
              <label class="rt-campo"><span>Enunciado</span>
                <textarea rows="3" [(ngModel)]="enunciado" placeholder="Qué tiene que hacer el programa, con un ejemplo"></textarea></label>
              <app-ejercicio-editor [ejercicio]="ejercicio" (ejercicioChange)="ejercicio = $event" [enunciado]="titulo + '\\n' + enunciado" />
            } @else {
              <div class="rt-buscar">
                <input [(ngModel)]="q" (keyup.enter)="buscar()" placeholder="Buscar en las preguntas de programación" aria-label="Buscar" />
                <button type="button" class="rt-btn" (click)="buscar()"><mat-icon>search</mat-icon></button>
              </div>
              <ul class="rt-banco">
                @for (p of delBanco(); track p.pregunta.id) {
                  <li>
                    <button type="button" [class.activo]="elegida() === p.pregunta.id" (click)="elegida.set(p.pregunta.id)">
                      <strong>{{ p.pregunta.enunciado }}</strong>
                      <small>{{ p.bank_nombre }} · {{ lenguaje(p.pregunta.ejercicio?.lenguaje) }} · {{ p.pregunta.ejercicio?.casos?.length ?? 0 }} pruebas</small>
                    </button>
                  </li>
                } @empty { <li class="rt-vacio">No hay preguntas de programación en los bancos.</li> }
              </ul>
            }
          </div>
          <footer class="rt-modal__pie">
            <button type="button" class="rt-btn" (click)="cerrarDiseno()">Cancelar</button>
            <button type="button" class="rt-btn rt-btn--primario" (click)="lanzar()" [disabled]="lanzando()">
              <mat-icon>send</mat-icon> {{ lanzando() ? 'Lanzando…' : 'Lanzar al aula' }}</button>
          </footer>
        </div>
      </div>
    }

    <!-- ── Resolver un reto ── -->
    @if (abierto(); as r) {
      <div class="rt-velo" (click)="abierto.set(null)">
        <div class="rt-modal" role="dialog" aria-modal="true" [attr.aria-label]="r.nombre" (click)="$event.stopPropagation()">
          <header class="rt-modal__cab">
            <h3><mat-icon>code</mat-icon> {{ r.nombre }}</h3>
            <button type="button" class="rt-x" (click)="abierto.set(null)" aria-label="Cerrar"><mat-icon>close</mat-icon></button>
          </header>
          <div class="rt-modal__cuerpo">
            @if (r.contenido) { <div class="rt-enunciado" [innerHTML]="r.contenido"></div> }
            <app-resolver-ejercicio [ejercicio]="r.ejercicio ?? null" origen="AULA" [origenId]="r.id" modo="entrega"
                                    textoEntregar="Entregar reto" [deshabilitado]="dirijo"
                                    [resultado]="ultimaDe(r.id)?.resultado ?? null" [calificando]="!!ultimaDe(r.id)?.calificando || entregando()"
                                    (entregar)="entregar(r, $event)" />
          </div>
        </div>
      </div>
    }

    <!-- ── Entregas de un reto (quien dirige) ── -->
    @if (revisando(); as r) {
      <div class="rt-velo" (click)="revisando.set(null)">
        <div class="rt-modal" role="dialog" aria-modal="true" [attr.aria-label]="'Entregas de ' + r.nombre" (click)="$event.stopPropagation()">
          <header class="rt-modal__cab">
            <h3><mat-icon>grading</mat-icon> Entregas · {{ r.nombre }}</h3>
            <button type="button" class="rt-x" (click)="revisando.set(null)" aria-label="Cerrar"><mat-icon>close</mat-icon></button>
          </header>
          <div class="rt-modal__cuerpo">
            @if (promedio(r.id); as p) { <p class="rt-prom">{{ entregasDe(r.id).length }} entrega(s) · promedio {{ p | number: '1.0-0' }}/100</p> }
            @for (e of entregasDe(r.id); track e.id) {
              <details class="rt-entrega">
                <summary>
                  <b>{{ e.equipo_nombre ?? e.autor_nombre }}</b>
                  @if (e.calificando) { <span class="rt-punto"></span> calificando } @else { <span class="rt-chip">{{ e.nota | number: '1.0-0' }}/100</span> }
                </summary>
                @if (e.resultado) { <app-resultado-pruebas [resultado]="e.resultado" /> }
                <pre>{{ e.contenido }}</pre>
              </details>
            } @empty { <p class="rt-vacio">Nadie ha entregado todavía.</p> }
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: grid; gap: 8px; }
    .rt-nuevo { display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 1px dashed var(--primary); background: transparent; color: var(--primary); border-radius: 12px; min-height: 44px !important; font: 700 13.5px var(--font-sans); cursor: pointer; }
    .rt-reto { border: 1px solid var(--border); border-radius: 12px; padding: 10px; display: grid; gap: 6px; }
    .rt-reto header { display: grid; gap: 2px; }
    .rt-reto header span { font-size: 12px; color: var(--muted); }
    .rt-fila { display: flex; gap: 6px; flex-wrap: wrap; }
    .rt-btn { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--text); border-radius: 999px; padding: 0 12px; min-height: 34px !important; font: 700 12.5px var(--font-sans); cursor: pointer; }
    .rt-btn mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .rt-btn--primario { background: var(--primary); border-color: var(--primary); color: #fff; }
    .rt-btn:disabled { opacity: .5; cursor: not-allowed; }
    .rt-nota { margin: 0; font-size: 13px; color: var(--warn-fg); display: flex; gap: 6px; align-items: center; }
    .rt-nota--ok { color: var(--ok-fg, #15803d); }
    .rt-punto { width: 8px; height: 8px; border-radius: 50%; background: var(--primary); display: inline-block; animation: rt-l 1.1s infinite; }
    @keyframes rt-l { 50% { opacity: .25; } }
    .rt-vacio { color: var(--muted); font-size: 13px; text-align: center; padding: 16px 6px; margin: 0; }
    .rt-velo { position: fixed; inset: 0; z-index: 80; background: rgb(2 6 23 / .6); display: grid; place-items: center; padding: 16px; }
    .rt-modal { width: min(980px, 100%); max-height: calc(100dvh - 32px); display: flex; flex-direction: column; background: var(--surface); color: var(--text); border-radius: 18px; box-shadow: var(--shadow-lg); overflow: hidden; }
    .rt-modal__cab { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border); }
    .rt-modal__cab h3 { margin: 0; display: flex; align-items: center; gap: 8px; font-size: 16px; }
    .rt-modal__cab mat-icon { color: var(--primary); }
    .rt-x { width: 36px; min-height: 36px !important; border: 0; background: transparent; color: var(--muted); cursor: pointer; border-radius: 9px; display: grid; place-items: center; }
    .rt-modal__cuerpo { padding: 14px 16px; overflow-y: auto; display: grid; gap: 12px; }
    .rt-modal__pie { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--border); }
    .rt-origen { display: flex; gap: 6px; flex-wrap: wrap; }
    .rt-origen button { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--text); border-radius: 10px; padding: 0 12px; min-height: 38px !important; font: 600 13px var(--font-sans); cursor: pointer; }
    .rt-origen button.activo { background: var(--primary); border-color: var(--primary); color: #fff; }
    .rt-campo { display: grid; gap: 4px; font-size: 13px; }
    .rt-campo span { font-weight: 700; color: var(--text-2); }
    .rt-campo input, .rt-campo textarea, .rt-buscar input { font: 14px var(--font-sans); padding: 9px 10px; border-radius: 10px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--text); min-width: 0; }
    .rt-buscar { display: flex; gap: 6px; }
    .rt-buscar input { flex: 1; }
    .rt-banco { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    .rt-banco button { width: 100%; text-align: left; display: grid; gap: 2px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text); border-radius: 10px; padding: 8px 12px; cursor: pointer; }
    .rt-banco button.activo { border-color: var(--primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 25%, transparent); }
    .rt-banco small { color: var(--muted); font-size: 12px; }
    .rt-enunciado { font-size: 14px; line-height: 1.5; background: var(--surface-2); border-radius: 12px; padding: 10px 12px; }
    .rt-prom { margin: 0; font-weight: 700; }
    .rt-entrega { border: 1px solid var(--border); border-radius: 12px; padding: 8px 10px; }
    .rt-entrega summary { cursor: pointer; display: flex; align-items: center; gap: 8px; }
    .rt-entrega pre { margin: 8px 0 0; max-height: 240px; overflow: auto; background: #0F172A; color: #E2E8F0; border-radius: 10px; padding: 8px 10px; font: 12.5px/1.45 var(--font-mono); white-space: pre-wrap; }
    .rt-chip { font-size: 12px; font-weight: 800; padding: 2px 8px; border-radius: 999px; background: var(--surface-3); }
  `],
})
export class PanelRetos implements OnInit {
  @Input({ required: true }) aula!: Aula;
  @Input({ required: true }) sala!: SalaEnVivo;
  @Input() dirijo = false;

  private api = inject(AulasService);
  private admin = inject(TrainingAdminService);

  readonly retos = signal<Espacio[]>([]);
  readonly entregas = signal<Entrega[]>([]);
  readonly disenando = signal(false);
  readonly origen = signal<'aqui' | 'banco'>('aqui');
  readonly puedeBanco = signal(true);
  readonly delBanco = signal<PreguntaEncontrada[]>([]);
  readonly elegida = signal<string | null>(null);
  readonly lanzando = signal(false);
  readonly abierto = signal<Espacio | null>(null);
  readonly revisando = signal<Espacio | null>(null);
  readonly entregando = signal(false);
  @ViewChild(EjercicioEditor) editor?: EjercicioEditor;

  titulo = '';
  enunciado = '';
  q = '';
  ejercicio: EjercicioCodigo = ejercicioNuevo();
  private bajas: (() => void)[] = [];

  constructor() {
    inject(DestroyRef).onDestroy(() => this.bajas.forEach(f => f()));
  }

  async ngOnInit(): Promise<void> {
    this.bajas.push(
      this.sala.on('aula.reto', (d: any) => {
        void this.cargar();
        if (!this.dirijo && d?.accion === 'nuevo') {
          Swal.fire({ toast: true, position: 'top-end', timer: 3500, showConfirmButton: false, icon: 'info', title: `Nuevo reto: ${d.nombre ?? ''}` });
        }
      }),
      this.sala.on('aula.entregas', () => { if (this.dirijo) void this.cargarEntregas(); }),
    );
    await Promise.all([this.cargar(), this.cargarEntregas()]);
  }

  lenguaje(l: string | null | undefined): string {
    return nombreLenguaje(l);
  }

  async cargar(): Promise<void> {
    try { this.retos.set((await this.api.espacios(this.aula.id)).filter(e => e.tipo === 'EJERCICIO')); } catch { /* sin retos */ }
  }

  async cargarEntregas(): Promise<void> {
    try { this.entregas.set(await this.api.entregas(this.aula.id)); } catch { /* sin entregas */ }
  }

  entregasDe(retoId: string): Entrega[] {
    return this.entregas().filter(e => e.workspace_id === retoId);
  }

  ultimaDe(retoId: string): Entrega | null {
    return this.entregasDe(retoId)[0] ?? null;
  }

  mejorDe(retoId: string): Entrega | null {
    const l = this.entregasDe(retoId);
    if (!l.length) return null;
    if (l[0].calificando) return l[0];
    return l.reduce((a, b) => (b.nota ?? 0) > (a.nota ?? 0) ? b : a);
  }

  promedio(retoId: string): number | null {
    const l = this.entregasDe(retoId).filter(e => e.nota != null);
    return l.length ? l.reduce((s, e) => s + (e.nota ?? 0), 0) / l.length : null;
  }

  // ── Quien dirige ──

  abrirDiseno(): void {
    this.titulo = '';
    this.enunciado = '';
    this.ejercicio = ejercicioNuevo();
    this.elegida.set(null);
    this.origen.set('aqui');
    this.disenando.set(true);
  }

  cerrarDiseno(): void {
    this.disenando.set(false);
  }

  async buscar(): Promise<void> {
    try {
      this.delBanco.set(await this.admin.buscarPreguntas({ q: this.q, tipo: 'PROGRAMACION', limite: 30 }));
    } catch {
      // Buscar en los bancos es de quien administra formación: sin ese permiso no se ofrece.
      this.puedeBanco.set(false);
      this.origen.set('aqui');
    }
  }

  async lanzar(): Promise<void> {
    this.lanzando.set(true);
    try {
      let creado: Espacio;
      if (this.origen() === 'banco') {
        const id = this.elegida();
        if (!id) throw new Error('Elige una pregunta del banco');
        creado = await this.api.crearEspacio(this.aula.id, { tipo: 'EJERCICIO', question_id: id });
      } else {
        if (!this.titulo.trim()) throw new Error('Ponle un título al reto');
        const ejercicio = this.editor ? await this.editor.completarEsperados() : this.ejercicio;
        creado = await this.api.crearEspacio(this.aula.id, {
          tipo: 'EJERCICIO', nombre: this.titulo.trim(), ejercicio,
          enunciado: this.enunciado.trim() ? escapar(this.enunciado.trim()).replace(/\n/g, '<br>') : null,
        });
      }
      this.sala.enviar('aula.reto', { accion: 'nuevo', nombre: creado.nombre });
      this.disenando.set(false);
      await this.cargar();
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo lanzar', text: e instanceof Error ? e.message : mensajeDeError(e) });
    } finally {
      this.lanzando.set(false);
    }
  }

  verEntregas(r: Espacio): void {
    void this.cargarEntregas();
    this.revisando.set(r);
  }

  // ── Participantes ──

  resolver(r: Espacio): void {
    this.abierto.set(r);
  }

  async entregar(r: Espacio, codigo: string): Promise<void> {
    this.entregando.set(true);
    try {
      const e = await this.api.entregar(this.aula.id, { titulo: r.nombre, contenido: codigo, workspace_id: r.id });
      this.entregas.update(l => [e, ...l]);
      this.sala.enviar('aula.entregas', { accion: 'nueva' });
      await this.seguir(r.id);
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo entregar', text: mensajeDeError(e) });
    } finally {
      this.entregando.set(false);
    }
  }

  /** Espera la nota de la última entrega del reto (hasta 4 minutos). */
  private async seguir(retoId: string): Promise<void> {
    const limite = Date.now() + 240_000;
    while (Date.now() < limite) {
      await new Promise(res => setTimeout(res, 2000));
      await this.cargarEntregas();
      const u = this.ultimaDe(retoId);
      if (!u || !u.calificando) {
        this.sala.enviar('aula.entregas', { accion: 'calificada' });
        return;
      }
    }
  }
}

function escapar(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
