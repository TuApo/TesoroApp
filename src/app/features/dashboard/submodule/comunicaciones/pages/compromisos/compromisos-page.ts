import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { Compromiso } from '../../modelos';
import { ChatStoreService } from '../../service/chat-store.service';
import { ComunicacionesApiService } from '../../service/comunicaciones-api.service';
import { abrirActa } from '../../components/acta/acta';
import { ComCompromiso, PersonaRef } from '../../components/compromiso/compromiso-item';

interface Grupo { clave: string; titulo: string; icono: string; items: Compromiso[] }

/** Todo lo que quedó acordado, de todas las conversaciones: lo mío primero, lo vencido arriba. */
@Component({
  selector: 'app-com-compromisos-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, ComCompromiso],
  template: `
    <div class="pagina">
      <div class="barra">
        <div class="seg">
          <button type="button" [class.on]="alcance() === 'mios'" (click)="alcance.set('mios'); cargar()">Míos</button>
          <button type="button" [class.on]="alcance() === 'todos'" (click)="alcance.set('todos'); cargar()">De mis conversaciones</button>
        </div>
        <div class="seg">
          <button type="button" [class.on]="vista() === 'abiertos'" (click)="vista.set('abiertos')">Abiertos</button>
          <button type="button" [class.on]="vista() === 'cerrados'" (click)="vista.set('cerrados')">Cumplidos y cancelados</button>
        </div>
        <label class="buscar"><mat-icon>search</mat-icon><input type="search" placeholder="Filtrar" (input)="texto.set($any($event.target).value)" /></label>
        <div class="kpis">
          <span class="k rojo"><b>{{ conteo().vencidos }}</b> vencidos</span>
          <span class="k"><b>{{ conteo().abiertos }}</b> abiertos</span>
          <span class="k verde"><b>{{ conteo().cumplidos }}</b> cumplidos</span>
        </div>
      </div>
      <div class="columnas">
        @for (g of grupos(); track g.clave) {
          <section class="col">
            <h3><mat-icon>{{ g.icono }}</mat-icon> {{ g.titulo }} <small>{{ g.items.length }}</small></h3>
            <div class="items">
              @for (c of g.items; track c.id) {
                <app-com-compromiso [c]="c" [personas]="personasDe(c)" (cambio)="actualizar($event)" (borrado)="quitar($event)" (irOrigen)="origen($event)" />
              } @empty { <p class="vacio">Nada aquí.</p> }
            </div>
          </section>
        }
      </div>
      @if (!cargando() && !lista().length) {
        <div class="vacio-grande"><mat-icon>task_alt</mat-icon>
          <p>{{ alcance() === 'mios' ? 'No tienes compromisos asignados.' : 'No hay compromisos en tus conversaciones.' }}</p>
          <small>Aparecen solos cuando termina una llamada transcrita o cuando se resume un chat, y también se pueden crear desde el panel de cada conversación.</small>
        </div>
      }
    </div>`,
  styles: [`
    :host { display: block; height: 100%; }
    .pagina { height: 100%; display: flex; flex-direction: column; min-height: 0; }
    .barra { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; padding: .7rem .9rem; border-bottom: 1px solid var(--border); }
    .seg { display: inline-flex; border: 1px solid var(--border); border-radius: 999px; overflow: hidden; }
    .seg button { border: 0; background: var(--surface); padding: .35rem .8rem; font: inherit; font-size: .8rem; cursor: pointer; color: var(--text-2); }
    .seg button.on { background: var(--primary); color: #fff; font-weight: 700; }
    .buscar { display: flex; align-items: center; gap: .3rem; border: 1px solid var(--border); border-radius: 999px; padding: .2rem .6rem; background: var(--surface-2); }
    .buscar input { border: 0; outline: 0; background: transparent; font: inherit; font-size: .82rem; color: var(--text); width: 160px; }
    .buscar mat-icon { color: var(--muted); font-size: 18px; width: 18px; height: 18px; }
    .kpis { margin-left: auto; display: flex; gap: .4rem; }
    .k { font-size: .75rem; background: var(--surface-3); border-radius: 999px; padding: .2rem .6rem; color: var(--text-2); }
    .k.rojo { background: var(--danger-bg); color: var(--danger-fg); }
    .k.verde { background: var(--ok-bg); color: var(--ok-fg); }
    .columnas { flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: .8rem; padding: .8rem; overflow-y: auto; align-items: start; }
    .col { background: var(--surface-2); border: 1px solid var(--border); border-radius: 14px; padding: .6rem; }
    h3 { display: flex; align-items: center; gap: .35rem; margin: 0 0 .5rem; font-size: .8rem; text-transform: uppercase; letter-spacing: .05em; color: var(--text-2); }
    h3 small { margin-left: auto; background: var(--surface); border-radius: 999px; padding: 0 .45rem; }
    h3 mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--primary); }
    .items { display: flex; flex-direction: column; gap: .4rem; }
    .vacio { color: var(--muted); font-size: .8rem; text-align: center; margin: .4rem 0; }
    .vacio-grande { text-align: center; color: var(--muted); padding: 1rem 2rem 2rem; }
    .vacio-grande mat-icon { font-size: 48px; width: 48px; height: 48px; color: var(--primary); opacity: .6; }
    .vacio-grande p { color: var(--text-2); font-weight: 600; }
  `],
})
export class CompromisosPage implements OnInit {
  private readonly api = inject(ComunicacionesApiService);
  private readonly store = inject(ChatStoreService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly lista = signal<Compromiso[]>([]);
  readonly cargando = signal(true);
  readonly alcance = signal<'mios' | 'todos'>('mios');
  readonly vista = signal<'abiertos' | 'cerrados'>('abiertos');
  readonly texto = signal('');

  readonly filtrados = computed(() => {
    const t = this.texto().trim().toLowerCase();
    return this.lista().filter(c => !t || c.descripcion.toLowerCase().includes(t)
      || (c.responsable_nombre ?? '').toLowerCase().includes(t) || (c.conversacion_nombre ?? '').toLowerCase().includes(t));
  });

  readonly conteo = computed(() => {
    const l = this.lista();
    return {
      vencidos: l.filter(c => c.vencido).length,
      abiertos: l.filter(c => c.estado === 'PENDIENTE' || c.estado === 'EN_CURSO').length,
      cumplidos: l.filter(c => c.estado === 'CUMPLIDO').length,
    };
  });

  readonly grupos = computed<Grupo[]>(() => {
    const l = this.filtrados();
    if (this.vista() === 'cerrados') {
      return [
        { clave: 'cumplidos', titulo: 'Cumplidos', icono: 'check_circle', items: l.filter(c => c.estado === 'CUMPLIDO') },
        { clave: 'cancelados', titulo: 'Cancelados', icono: 'block', items: l.filter(c => c.estado === 'CANCELADO') },
      ];
    }
    const abiertos = l.filter(c => c.estado === 'PENDIENTE' || c.estado === 'EN_CURSO');
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const en7 = new Date(hoy); en7.setDate(hoy.getDate() + 7);
    const fecha = (c: Compromiso) => c.fecha_limite ? new Date(c.fecha_limite + 'T00:00:00') : null;
    return [
      { clave: 'vencidos', titulo: 'Vencidos', icono: 'warning', items: abiertos.filter(c => c.vencido) },
      { clave: 'semana', titulo: 'Esta semana', icono: 'event', items: abiertos.filter(c => !c.vencido && fecha(c) && fecha(c)! < en7) },
      { clave: 'despues', titulo: 'Más adelante', icono: 'date_range', items: abiertos.filter(c => fecha(c) && fecha(c)! >= en7) },
      { clave: 'sinfecha', titulo: 'Sin fecha', icono: 'schedule', items: abiertos.filter(c => !fecha(c)) },
    ];
  });

  ngOnInit(): void {
    this.cargar();
    this.store.eventos$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(({ nombre }) => {
      if (nombre === 'compromiso' || nombre === 'memoria') this.cargar();
    });
  }

  cargar(): void {
    this.api.compromisos({ alcance: this.alcance() }).subscribe({
      next: l => { this.lista.set(l); this.cargando.set(false); },
      error: () => this.cargando.set(false),
    });
  }

  personasDe(c: Compromiso): PersonaRef[] {
    return (this.store.conversacion(c.conversacion_id)?.participantes ?? []).filter(p => p.activo);
  }

  actualizar(c: Compromiso): void { this.lista.update(l => l.map(x => x.id === c.id ? c : x)); }
  quitar(id: string): void { this.lista.update(l => l.filter(x => x.id !== id)); }

  origen(c: Compromiso): void {
    if (c.llamada_id) abrirActa(this.dialog, c.llamada_id);
    else void this.router.navigate(['/dashboard/comunicaciones/chats'], { queryParams: { c: c.conversacion_id } });
  }
}
