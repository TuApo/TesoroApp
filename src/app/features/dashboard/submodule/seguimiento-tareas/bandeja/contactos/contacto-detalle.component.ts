import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BandejaApiService } from '../bandeja-api.service';
import { BandejaEstadoService } from '../bandeja-estado.service';
import { Contacto, ContactoDetalle } from '../bandeja.models';
import { ESTADOS_HILO, ESTADOS_TAREA, TIPOS_COMPROMISO, cuando, fechaHora, iconoCanal, venceTexto } from '../bandeja-ui';
import { mensajeError } from '../../utils/tareas-ui';

/** Ficha de un contacto: datos, notas, línea de tiempo por todos los canales, compromisos y tareas. */
@Component({
  selector: 'app-bandeja-contacto',
  standalone: true,
  imports: [RouterLink, FormsModule, MatIconModule, MatButtonModule, MatProgressSpinnerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (cargando() && !d()) { <div class="centro"><mat-spinner diameter="34" /></div> }
    @if (error()) { <div class="error"><mat-icon>error</mat-icon>{{ error() }}</div> }
    @if (d(); as det) {
      @let c = det.contacto;
      <a class="cd-volver" routerLink="/dashboard/tareas/bandeja/contactos" queryParamsHandling="preserve"><mat-icon>arrow_back</mat-icon>Contactos</a>
      <header class="tarjeta cd-cab">
        @if (editando() && det.es_dueno) {
          <form class="cd-form" (submit)="$event.preventDefault(); guardar()">
            <input name="n" [(ngModel)]="form.nombre" placeholder="Nombre" required />
            <input name="o" [(ngModel)]="form.organizacion" placeholder="Empresa / finca" />
            <input name="c" [(ngModel)]="form.cargo" placeholder="Cargo" />
            <select name="e" [(ngModel)]="form.etapa">
              <option value="NUEVO">Nuevo</option><option value="ACTIVO">Activo</option>
              <option value="SEGUIMIENTO">En seguimiento</option><option value="CERRADO">Cerrado</option>
            </select>
            <div class="acciones"><button mat-flat-button class="btn-chico" type="submit">Guardar</button>
              <button mat-button class="btn-chico" type="button" (click)="editando.set(false)">Cancelar</button></div>
          </form>
        } @else {
          <div class="cd-tit">
            <h2>{{ c.nombre || 'Sin nombre' }}</h2>
            <p class="muted">{{ subtitulo(c) }}</p>
            <div class="cd-ids">
              @for (i of det.identidades; track i.valor) {
                <span class="chip" [attr.data-tono]="i.tipo === 'CORREO' ? 'info' : 'ok'"><mat-icon>{{ i.tipo === 'CORREO' ? 'mail' : 'chat' }}</mat-icon>{{ i.valor }}</span>
              }
              <span class="chip" data-tono="neutro">{{ etapa(c.etapa) }}</span>
              @if (c.usuario_plataforma_id) { <span class="chip" data-tono="violeta"><mat-icon>badge</mat-icon>Compañero de la plataforma</span> }
            </div>
            <p class="muted cd-num">{{ c.mensajes_entrantes }} recibidos · {{ c.mensajes_salientes }} enviados · desde {{ fechaHora(c.primer_contacto_en) }}</p>
          </div>
          @if (det.es_dueno) { <button mat-stroked-button class="btn-chico" (click)="editar(c)"><mat-icon>edit</mat-icon>Editar</button> }
        }
      </header>

      <div class="cd-grid">
        <section class="tarjeta">
          <h3><mat-icon>timeline</mat-icon>Línea de tiempo</h3>
          @if (det.es_dueno) {
            <form class="cd-nota" (submit)="$event.preventDefault(); notar()">
              <input name="nota" [(ngModel)]="nota" placeholder="Agregar una nota (queda en el histórico)" />
              <button mat-flat-button class="btn-chico" type="submit" [disabled]="!nota.trim()">Anotar</button>
            </form>
          }
          <ol class="cd-linea">
            @for (e of det.linea_tiempo; track $index) {
              <li [attr.data-tipo]="e.tipo">
                <time>{{ fechaHora(e.fecha) }}</time>
                @if (e.tipo === 'MENSAJES') {
                  <a [routerLink]="['/dashboard/tareas/bandeja']" [queryParams]="{ hilo: e.hilo_id, usuario: estado.usuario() }">
                    <mat-icon>{{ iconoCanal(e.canal) }}</mat-icon>{{ e.titulo }}: {{ e.descripcion }}</a>
                } @else if (e.tipo === 'NOTA') {
                  <span class="cd-n"><mat-icon>sticky_note_2</mat-icon>{{ e.descripcion }} <i>— {{ e.titulo }}</i></span>
                } @else {
                  <span>{{ e.descripcion }}</span>
                }
              </li>
            } @empty { <li class="muted">Sin actividad.</li> }
          </ol>
        </section>
        <aside class="cd-lado">
          <section class="tarjeta">
            <h3><mat-icon>forum</mat-icon>Conversaciones</h3>
            @for (h of det.conversaciones; track h.id) {
              <a class="cd-hilo" [routerLink]="['/dashboard/tareas/bandeja']" [queryParams]="{ hilo: h.id, usuario: estado.usuario() }">
                <mat-icon>{{ iconoCanal(h.canal) }}</mat-icon>
                <span class="ellipsis">{{ h.asunto || h.titulo || h.vista_previa }}</span>
                <span class="chip" [attr.data-tono]="ESTADOS[h.estado!].tono">{{ ESTADOS[h.estado!].texto }}</span>
              </a>
            }
          </section>
          <section class="tarjeta">
            <h3><mat-icon>handshake</mat-icon>Compromisos</h3>
            @for (k of det.compromisos; track k.id) {
              @let v = venceTexto(k.vence_en);
              <div class="cd-comp" [class.cd-comp--cerrado]="k.estado === 'CUMPLIDO' || k.estado === 'DESCARTADO'">
                <mat-icon>{{ TIPOS[k.tipo].icono }}</mat-icon>
                <span>{{ k.descripcion }}</span>
                @if (k.estado === 'PENDIENTE' || k.estado === 'EN_CURSO') { <span class="chip" [attr.data-tono]="v.tono">{{ v.texto }}</span> }
                @else { <span class="chip" data-tono="ok">{{ k.estado === 'CUMPLIDO' ? 'Cumplido' : 'Descartado' }}</span> }
              </div>
            } @empty { <p class="muted">Ninguno.</p> }
          </section>
          <section class="tarjeta">
            <h3><mat-icon>task</mat-icon>Tareas</h3>
            @for (t of det.tareas; track t.tarea_id) {
              <a class="cd-hilo" [routerLink]="['/dashboard/tareas/tarea', t.tarea_id]"><mat-icon>task</mat-icon><span class="ellipsis">{{ t.titulo }}</span>
                <span class="chip" [attr.data-tono]="t.estado === 'DONE' ? 'ok' : 'violeta'">{{ ESTADOS_TAREA[t.estado ?? ''] || t.estado }}</span></a>
            } @empty { <p class="muted">Ninguna.</p> }
          </section>
        </aside>
      </div>
    }
  `,
  styleUrls: ['../bandeja-comun.css'],
  styles: [`
    :host { display: flex; flex-direction: column; gap: 12px; }
    :host > * { flex-shrink: 0; }
    .cd-volver { display: inline-flex; align-items: center; gap: 4px; color: var(--link); font-weight: 700; text-decoration: none; width: fit-content; }
    .cd-cab { display: flex; gap: 12px; align-items: flex-start; }
    .cd-tit { flex: 1; min-width: 0; }
    .cd-tit h2 { margin: 0; font-size: 20px; font-weight: 850; }
    .cd-tit p { margin: 4px 0; }
    .cd-ids { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0; }
    .cd-num { font-size: 12.5px; }
    .cd-form { flex: 1; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr)); gap: 8px; }
    .cd-form input, .cd-form select, .cd-nota input { height: 40px; border-radius: 10px; border: 1px solid var(--border-strong); padding: 0 10px;
      background: var(--surface); color: var(--text); font: 600 14px var(--font-sans); min-width: 0; }
    .cd-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(280px, 380px); gap: 12px; align-items: start; }
    .cd-lado { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
    .cd-nota { display: flex; gap: 8px; margin-bottom: 10px; }
    .cd-nota input { flex: 1; }
    .cd-linea { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
    .cd-linea li { display: flex; flex-direction: column; gap: 2px; padding-left: 12px; border-left: 2px solid var(--border-strong); font-size: 13.5px; }
    .cd-linea li[data-tipo="NOTA"] { border-left-color: var(--warn-border); }
    .cd-linea time { font-size: 11.5px; color: var(--muted); font-weight: 700; }
    .cd-linea a, .cd-n { display: inline-flex; align-items: flex-start; gap: 6px; color: var(--text); text-decoration: none; overflow-wrap: anywhere; }
    .cd-linea mat-icon { font-size: 17px; width: 17px; height: 17px; flex: none; color: var(--muted); }
    .cd-hilo { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-top: 1px solid var(--border); color: var(--text); text-decoration: none; font-size: 13.5px; }
    .cd-hilo mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--muted); flex: none; }
    .cd-hilo .ellipsis { flex: 1; }
    .cd-comp { display: flex; align-items: center; gap: 8px; padding: 6px 0; font-size: 13.5px; }
    .cd-comp mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--warn-fg); flex: none; }
    .cd-comp span:first-of-type { flex: 1; min-width: 0; }
    .cd-comp--cerrado span:first-of-type { text-decoration: line-through; color: var(--muted); }
    @media (max-width: 900px) { .cd-grid { grid-template-columns: minmax(0, 1fr); } .cd-cab { flex-wrap: wrap; } }
  `],
})
export class ContactoDetalleComponent implements OnInit {
  private readonly api = inject(BandejaApiService);
  readonly estado = inject(BandejaEstadoService);
  private readonly snack = inject(MatSnackBar);
  readonly id = input.required<string>();

  readonly d = signal<ContactoDetalle | null>(null);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly editando = signal(false);
  form: { nombre: string; organizacion: string; cargo: string; etapa: Contacto['etapa'] } = { nombre: '', organizacion: '', cargo: '', etapa: 'ACTIVO' };
  nota = '';
  readonly ESTADOS = ESTADOS_HILO;
  readonly TIPOS = TIPOS_COMPROMISO;
  readonly ESTADOS_TAREA = ESTADOS_TAREA;
  readonly cuando = cuando;
  readonly fechaHora = fechaHora;
  readonly venceTexto = venceTexto;
  readonly iconoCanal = iconoCanal;
  readonly nombre = computed(() => this.d()?.contacto.nombre ?? '');

  ngOnInit(): void { void this.cargar(); }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      this.d.set(await this.api.contacto(this.id()));
    } catch (e) {
      this.error.set(mensajeError(e, 'No se pudo abrir el contacto.'));
    } finally {
      this.cargando.set(false);
    }
  }

  editar(c: Contacto): void {
    this.form = { nombre: c.nombre ?? '', organizacion: c.organizacion ?? '', cargo: c.cargo ?? '', etapa: c.etapa };
    this.editando.set(true);
  }

  async guardar(): Promise<void> {
    try {
      await this.api.actualizarContacto(this.id(), this.form);
      this.editando.set(false);
      await this.cargar();
    } catch (e) {
      this.snack.open(mensajeError(e), 'Cerrar', { duration: 4500 });
    }
  }

  async notar(): Promise<void> {
    const t = this.nota.trim();
    if (!t) return;
    try {
      await this.api.nota(this.id(), t);
      this.nota = '';
      await this.cargar();
    } catch (e) {
      this.snack.open(mensajeError(e), 'Cerrar', { duration: 4500 });
    }
  }

  subtitulo(c: Contacto): string {
    return [c.cargo, c.organizacion].filter(x => !!x).join(' · ') || 'Sin empresa';
  }

  etapa(e: string): string {
    return ({ NUEVO: 'Nuevo', ACTIVO: 'Activo', SEGUIMIENTO: 'En seguimiento', CERRADO: 'Cerrado' } as Record<string, string>)[e] ?? e;
  }
}
