import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BandejaApiService } from '../bandeja-api.service';
import { BandejaEstadoService } from '../bandeja-estado.service';
import { Compromiso } from '../bandeja.models';
import { ESTADOS_TAREA, TIPOS_COMPROMISO, cuando, iconoCanal, venceTexto } from '../bandeja-ui';
import { mensajeError } from '../../utils/tareas-ui';
import { TareasDialogosService } from '../../services/tareas-dialogos.service';

/**
 * Todos los compromisos de la bandeja: lo que me pidieron, lo que prometí y lo que me deben,
 * con su vencimiento, su tarea y de qué conversación salieron.
 */
@Component({
  selector: 'app-bandeja-compromisos',
  standalone: true,
  imports: [RouterLink, MatIconModule, MatButtonModule, MatTooltipModule, MatProgressSpinnerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cp-filtros">
      <div class="filtros" role="tablist" aria-label="Estado">
        @for (v of vistas; track v.clave) {
          <button type="button" [class.on]="vista() === v.clave" (click)="elegir(v.clave)">{{ v.etiqueta }}</button>
        }
      </div>
      <div class="filtros" role="group" aria-label="Quién debe">
        <button type="button" [class.on]="tipo() === ''" (click)="tipoFiltro('')">Todos</button>
        <button type="button" [class.on]="tipo() === 'YO_DEBO'" (click)="tipoFiltro('YO_DEBO')"><mat-icon>assignment_late</mat-icon>Yo debo</button>
        <button type="button" [class.on]="tipo() === 'DEL_CONTACTO'" (click)="tipoFiltro('DEL_CONTACTO')"><mat-icon>schedule_send</mat-icon>Me deben</button>
      </div>
    </div>

    @if (error()) { <div class="error"><mat-icon>error</mat-icon>{{ error() }}</div> }
    @if (cargando()) {
      <div class="centro"><mat-spinner diameter="34" /></div>
    } @else {
      <ul class="cp-lista">
        @for (c of lista(); track c.id) {
          @let v = venceTexto(c.vence_en);
          <li class="tarjeta cp" [attr.data-estado]="c.estado">
            <mat-icon class="cp-ico" [attr.data-tipo]="c.tipo">{{ TIPOS[c.tipo].icono }}</mat-icon>
            <div class="cp-cuerpo">
              <span class="cp-tipo">{{ TIPOS[c.tipo].texto }}@if (c.quien) { · {{ c.quien }}}@if (c.contacto_nombre) { · {{ c.contacto_nombre }}}</span>
              <strong class="cp-desc">{{ c.descripcion }}</strong>
              @if (c.evidencia) { <q class="cp-cita">{{ c.evidencia }}</q> }
              <span class="cp-chips">
                @if (c.estado === 'PENDIENTE' || c.estado === 'EN_CURSO') { <span class="chip" [attr.data-tono]="v.tono">{{ v.texto }}</span> }
                @if (c.estado === 'EN_CURSO') { <span class="chip" data-tono="violeta">En curso</span> }
                @if (c.estado === 'CUMPLIDO') { <span class="chip" data-tono="ok">Cumplido {{ cuando(c.cumplido_en) }}</span> }
                @if (c.estado === 'DESCARTADO') { <span class="chip" data-tono="neutro">Descartado</span> }
                @if (c.tarea_id) {
                  <a class="chip" data-tono="violeta" [routerLink]="['/dashboard/tareas/tarea', c.tarea_id]"><mat-icon>task</mat-icon>{{ ESTADOS_TAREA[c.tarea_estado ?? ''] || 'Tarea' }}</a>
                }
                @if (c.falta_avisar) {
                  <span class="chip" data-tono="aviso" matTooltip="La tarea se completó pero no le has escrito al contacto desde entonces"><mat-icon>campaign</mat-icon>Falta avisar al contacto</span>
                }
                @if (c.hilo_id) {
                  <a class="chip" [routerLink]="['/dashboard/tareas/bandeja']" [queryParams]="{ hilo: c.hilo_id, usuario: estado.usuario() }">
                    <mat-icon>{{ iconoCanal(c.canal) }}</mat-icon>{{ c.hilo_titulo || c.hilo_asunto || 'Conversación' }}</a>
                }
                @if (c.origen === 'IA') { <span class="chip" data-tono="neutro">IA</span> }
              </span>
            </div>
            @if (!estado.supervisando() && (c.estado === 'PENDIENTE' || c.estado === 'EN_CURSO')) {
              <div class="cp-acc">
                <button mat-stroked-button class="btn-chico" (click)="cambiar(c, 'CUMPLIDO')" [disabled]="ocupado() === c.id"><mat-icon>check</mat-icon>Cumplido</button>
                @if (!c.tarea_id) { <button mat-stroked-button class="btn-chico" (click)="tarea(c)"><mat-icon>add_task</mat-icon>Tarea</button> }
                <button mat-icon-button (click)="cambiar(c, 'DESCARTADO')" matTooltip="Descartar" aria-label="Descartar"><mat-icon>close</mat-icon></button>
              </div>
            } @else if (!estado.supervisando()) {
              <div class="cp-acc"><button mat-button class="btn-chico" (click)="cambiar(c, 'PENDIENTE')">Reabrir</button></div>
            }
          </li>
        } @empty {
          <li class="vacio"><mat-icon>handshake</mat-icon><p>No hay compromisos en esta vista.</p></li>
        }
      </ul>
    }
  `,
  styleUrls: ['../bandeja-comun.css'],
  styles: [`
    :host { display: flex; flex-direction: column; gap: 12px; }
    .cp-filtros { display: flex; flex-wrap: wrap; gap: 10px; justify-content: space-between; }
    .cp-lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .cp { display: flex; gap: 12px; align-items: flex-start; }
    .cp[data-estado="CUMPLIDO"], .cp[data-estado="DESCARTADO"] { opacity: .8; }
    .cp-ico { flex: none; font-size: 22px; width: 22px; height: 22px; color: var(--warn-fg); margin-top: 2px; }
    .cp-ico[data-tipo="DEL_CONTACTO"] { color: var(--info-fg); }
    .cp-ico[data-tipo="MIO"] { color: var(--violet-fg); }
    .cp-cuerpo { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .cp-tipo { font-size: 11.5px; font-weight: 800; color: var(--muted); text-transform: uppercase; letter-spacing: .02em; }
    .cp-desc { font-size: 15px; color: var(--text); overflow-wrap: anywhere; }
    .cp-cita { font-size: 13px; color: var(--text-2); font-style: italic; overflow-wrap: anywhere; }
    .cp-chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .cp-chips a { text-decoration: none; }
    .cp-acc { display: flex; gap: 6px; align-items: center; flex: none; }
    @media (max-width: 600px) { .cp { flex-wrap: wrap; } .cp-acc { width: 100%; justify-content: flex-end; } }
  `],
})
export class CompromisosComponent implements OnInit {
  private readonly api = inject(BandejaApiService);
  readonly estado = inject(BandejaEstadoService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  private readonly dialogos = inject(TareasDialogosService);
  private readonly destroy = inject(DestroyRef);

  readonly vistas = [
    { clave: 'abiertos', etiqueta: 'Abiertos' }, { clave: 'vencidos', etiqueta: 'Vencidos' }, { clave: 'hoy', etiqueta: 'Hoy' },
    { clave: 'semana', etiqueta: 'Próximos 7 días' }, { clave: 'cumplidos', etiqueta: 'Cumplidos' },
    { clave: 'descartados', etiqueta: 'Descartados' }, { clave: 'todos', etiqueta: 'Todos' },
  ];
  readonly vista = signal('abiertos');
  readonly tipo = signal('');
  readonly lista = signal<Compromiso[]>([]);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly ocupado = signal<string | null>(null);
  readonly TIPOS = TIPOS_COMPROMISO;
  readonly ESTADOS_TAREA = ESTADOS_TAREA;
  readonly cuando = cuando;
  readonly venceTexto = venceTexto;
  readonly iconoCanal = iconoCanal;
  readonly total = computed(() => this.lista().length);

  ngOnInit(): void {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroy)).subscribe(q => {
      this.vista.set(q.get('vista') ?? 'abiertos');
      void this.cargar();
    });
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      this.lista.set(await this.api.compromisos({
        usuario: this.estado.supervisando() ? this.estado.usuario() : null, vista: this.vista(), tipo: this.tipo() || null,
      }));
    } catch (e) {
      this.error.set(mensajeError(e, 'No se pudieron cargar los compromisos.'));
    } finally {
      this.cargando.set(false);
    }
  }

  elegir(v: string): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { vista: v }, queryParamsHandling: 'merge' });
  }

  tipoFiltro(t: string): void {
    this.tipo.set(t);
    void this.cargar();
  }

  async cambiar(c: Compromiso, estado: string): Promise<void> {
    this.ocupado.set(c.id);
    try {
      await this.api.actualizarCompromiso(c.id, { estado });
      await this.cargar();
      void this.estado.refrescar();
    } catch (e) {
      this.snack.open(mensajeError(e), 'Cerrar', { duration: 4500 });
    } finally {
      this.ocupado.set(null);
    }
  }

  async tarea(c: Compromiso): Promise<void> {
    const t = await this.dialogos.nuevaTarea({
      titulo: c.descripcion,
      descripcion: [c.evidencia ? `Lo que dijeron: «${c.evidencia}»` : '', c.contacto_nombre ? `Contacto: ${c.contacto_nombre}` : ''].filter(Boolean).join('\n'),
      vence: c.vence_en ? new Date(`${c.vence_en}T17:00:00`) : null,
      origen: { tipo: 'COMUNICACION', ref: `compromiso:${c.id}`, url: c.hilo_id ? `tareas/bandeja?hilo=${c.hilo_id}` : 'tareas/bandeja/compromisos', etiqueta: c.contacto_nombre ?? c.descripcion },
    });
    if (!t) return;
    try { await this.api.sincronizarTareas(); } catch { /* la sincronización periódica la recoge */ }
    this.snack.open('Tarea creada y ligada al compromiso', undefined, { duration: 2500 });
    await this.cargar();
  }
}
