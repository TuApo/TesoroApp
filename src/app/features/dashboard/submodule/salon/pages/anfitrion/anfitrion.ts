import { ChangeDetectionStrategy, Component, DestroyRef, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';

import { SalonEncabezado } from '../../components/salon-encabezado';
import { Espera, EsperaForm, MesaPlano, Prediccion } from '../../models/salon.models';
import { SALON_CONTEXTO, permisosDeContexto } from '../../services/salon-contexto.token';
import { SalonStreamService } from '../../services/salon-stream.service';
import { SalonService, mensajeError } from '../../services/salon.service';

const REFRESCO_MS = 20_000;

/**
 * Pantalla del anfitrión (tablet en la entrada): a la izquierda la lista de espera con
 * posición y minutos estimados y los botones avisar / sentar / cancelar; a la derecha la
 * predicción de liberación ordenada. La lista se refresca cada 20 s y con cada evento del
 * plano (sentar cambia el plano y el plano cambia la predicción).
 */
@Component({
  selector: 'app-salon-anfitrion',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule, SalonEncabezado],
  styleUrls: ['../../salon-comun.css'],
  template: `
    <div class="sl-pagina">
      <app-salon-encabezado subtitulo="Lista de espera y mesas que se liberan" [mostrarVision]="true" />

      @if (!ctx.tiendaId()) {
        <div class="sl-panel sl-vacio"><mat-icon>storefront</mat-icon><strong>Elige una sede.</strong></div>
      } @else {
        <div class="anf-grid">
          <section class="sl-panel anf-espera">
            <h2><mat-icon>groups</mat-icon>Lista de espera <span class="sl-chip sl-tono-info">{{ enEspera().length }}</span></h2>

            @if (permisos.puedeOperar()) {
              <form class="anf-alta" (ngSubmit)="agregar()" autocomplete="off">
                <label class="sl-campo anf-alta-nombre"><span>Nombre</span><input class="sl-input" name="nombre" [(ngModel)]="nuevo.nombre" required maxlength="80" /></label>
                <label class="sl-campo anf-alta-personas"><span>Personas</span><input class="sl-input" name="personas" type="number" min="1" max="30" [(ngModel)]="nuevo.personas" required /></label>
                <label class="sl-campo anf-alta-tel"><span>Teléfono (opcional)</span><input class="sl-input" name="telefono" type="tel" [(ngModel)]="nuevo.telefono" maxlength="20" /></label>
                <button type="submit" class="sl-btn sl-btn--primario sl-btn--grande" [disabled]="guardando() || !nuevo.nombre.trim()"><mat-icon>person_add</mat-icon>Anotar</button>
              </form>
            }

            @if (errorEspera(); as e) { <div class="sl-aviso sl-tono-danger" role="alert"><mat-icon>cloud_off</mat-icon>{{ e }}<button type="button" class="sl-btn sl-btn--chico" (click)="cargar()">Reintentar</button></div> }

            @if (!enEspera().length) {
              <div class="sl-vacio"><mat-icon>event_seat</mat-icon><strong>Nadie en espera.</strong></div>
            } @else {
              <ol class="anf-lista">
                @for (e of enEspera(); track e.id) {
                  <li class="anf-item" [class.anf-item--avisado]="e.estado === 'AVISADO'">
                    <span class="anf-pos">{{ e.posicion ?? $index + 1 }}</span>
                    <div class="anf-datos">
                      <strong>{{ e.nombre }}</strong>
                      <span class="sl-muted"><mat-icon>group</mat-icon>{{ e.personas }} · esperando {{ minutosDesde(e.creado_en) }} min
                        @if (e.minutos_estimados !== null) { · mesa en ~{{ e.minutos_estimados }} min }
                        @if (e.telefono) { · {{ e.telefono }} }
                      </span>
                      @if (e.estado === 'AVISADO') { <span class="sl-chip sl-tono-warn"><mat-icon>campaign</mat-icon>Avisado {{ minutosDesde(e.avisado_en) }} min</span> }
                      @if (e.canal === 'QR') { <span class="sl-chip sl-tono-neutro"><mat-icon>qr_code_2</mat-icon>QR</span> }
                    </div>
                    @if (permisos.puedeOperar()) {
                      <div class="anf-acciones">
                        <button type="button" class="sl-btn sl-btn--warn" (click)="avisar(e)" [disabled]="ocupado() === e.id" title="Avisar (push/WhatsApp)"><mat-icon>campaign</mat-icon><span>Avisar</span></button>
                        <label class="anf-sentar">
                          <select class="sl-select" [ngModel]="mesaElegida()[e.id] ?? ''" (ngModelChange)="elegirMesa(e.id, $event)" [attr.aria-label]="'Mesa para ' + e.nombre">
                            <option value="">Mesa…</option>
                            @for (m of mesasLibres(); track m.id) { <option [value]="m.id">{{ m.nombre }} ({{ m.capacidad }})</option> }
                          </select>
                          <button type="button" class="sl-btn sl-btn--ok" (click)="sentar(e)" [disabled]="ocupado() === e.id || !mesaElegida()[e.id]"><mat-icon>chair</mat-icon><span>Sentar</span></button>
                        </label>
                        <button type="button" class="sl-btn sl-btn--chico" (click)="noLlego(e)" [disabled]="ocupado() === e.id" title="No llegó"><mat-icon>person_off</mat-icon></button>
                        <button type="button" class="sl-btn sl-btn--chico sl-btn--peligro" (click)="cancelar(e)" [disabled]="ocupado() === e.id" title="Cancelar"><mat-icon>close</mat-icon></button>
                      </div>
                    }
                  </li>
                }
              </ol>
            }
          </section>

          <aside class="sl-panel anf-prediccion">
            <h2><mat-icon>update</mat-icon>Se liberan pronto</h2>
            @if (resumen(); as r) {
              <div class="sl-kpis anf-kpis">
                <div class="sl-kpi"><small>Libres</small><strong>{{ r.libres }}</strong></div>
                <div class="sl-kpi"><small>Ocupadas</small><strong>{{ r.ocupadas }}</strong></div>
                <div class="sl-kpi"><small>Por limpiar</small><strong>{{ r.por_limpiar }}</strong></div>
              </div>
            }
            @if (!prediccion().length) {
              <div class="sl-vacio"><mat-icon>schedule</mat-icon><strong>No hay mesas ocupadas.</strong></div>
            } @else {
              <ul class="anf-pred">
                @for (p of prediccion(); track p.mesa_id) {
                  <li class="anf-pred-item">
                    <span class="anf-pred-min" [class.anf-pred-min--ya]="p.minutos_para_liberar <= 5">{{ p.minutos_para_liberar <= 0 ? 'ya' : '~' + p.minutos_para_liberar + ' min' }}</span>
                    <div class="anf-datos">
                      <strong>Mesa {{ p.mesa_nombre }} <span class="sl-muted">· {{ p.personas ?? '?' }}/{{ p.capacidad }}</span></strong>
                      <span class="sl-muted">lleva {{ p.minutos_transcurridos }} min · {{ p.base === 'HISTORICO' ? 'según histórico' : 'duración por defecto' }}</span>
                    </div>
                  </li>
                }
              </ul>
            }
          </aside>
        </div>
      }
    </div>
  `,
  styles: [`
    .anf-grid { display: grid; gap: 14px; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); }
    @media (max-width: 900px) { .anf-grid { grid-template-columns: minmax(0, 1fr); } }
    .anf-alta { display: grid; gap: 10px; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1.5fr) auto; align-items: end; margin-bottom: 14px; }
    @media (max-width: 700px) { .anf-alta { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } .anf-alta-nombre { grid-column: 1 / -1; } }
    .anf-lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
    .anf-item { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 10px 12px; border-radius: var(--r-md); border: 1px solid var(--border); background: var(--surface-2); }
    .anf-item--avisado { border-color: var(--warn-border); background: var(--warn-bg); }
    .anf-pos { width: 44px; height: 44px; border-radius: 50%; background: var(--primary); color: #fff; font-weight: 800; font-size: 1.2rem; display: inline-flex; align-items: center; justify-content: center; flex: none; }
    .anf-datos { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
    .anf-datos strong { font-size: 1.1rem; }
    .anf-datos .sl-muted { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; font-size: .88rem; }
    .anf-datos .sl-muted mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .anf-acciones { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .anf-sentar { display: inline-flex; gap: 6px; align-items: center; }
    .anf-sentar .sl-select { width: auto; min-width: 120px; }
    .anf-pred { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .anf-pred-item { display: flex; gap: 10px; align-items: center; padding: 8px 10px; border-radius: var(--r-md); border: 1px solid var(--border); background: var(--surface-2); }
    .anf-pred-min { min-width: 76px; text-align: center; padding: 6px 8px; border-radius: 999px; background: var(--mesa-ocupada-bg); color: var(--mesa-ocupada-fg); font-weight: 800; }
    .anf-pred-min--ya { background: var(--mesa-libre-bg); color: var(--mesa-libre-fg); }
    .anf-kpis { margin-bottom: 12px; }
    @media (max-width: 640px) { .anf-acciones .sl-btn span { display: none; } }
  `],
})
export class SalonAnfitrionPage implements OnDestroy {
  readonly ctx = inject(SALON_CONTEXTO);
  readonly permisos = permisosDeContexto(this.ctx);
  readonly stream = inject(SalonStreamService);
  private api = inject(SalonService);
  private snack = inject(MatSnackBar);
  private destroyRef = inject(DestroyRef);

  readonly espera = signal<Espera[]>([]);
  readonly prediccion = signal<Prediccion[]>([]);
  readonly errorEspera = signal<string | null>(null);
  readonly guardando = signal(false);
  readonly ocupado = signal<string | null>(null);
  readonly mesaElegida = signal<Record<string, string | undefined>>({});
  nuevo: EsperaForm = { nombre: '', personas: 2, telefono: null, canal: 'ANFITRION' };

  readonly resumen = computed(() => this.stream.plano()?.resumen ?? null);
  readonly enEspera = computed(() => this.espera()
    .filter(e => e.estado === 'ESPERANDO' || e.estado === 'AVISADO')
    .sort((a, b) => (a.posicion ?? 999) - (b.posicion ?? 999) || a.creado_en.localeCompare(b.creado_en)));
  readonly mesasLibres = computed<MesaPlano[]>(() => (this.stream.plano()?.salones ?? [])
    .flatMap(s => s.mesas).filter(m => m.estado === 'LIBRE' || m.estado === 'RESERVADA')
    .sort((a, b) => a.capacidad - b.capacidad || a.nombre.localeCompare(b.nombre, 'es', { numeric: true })));

  private tiendaEnUso: string | null = null;
  private refrescoId: ReturnType<typeof setInterval> | null = null;

  constructor() {
    effect(() => {
      const id = this.ctx.tiendaId();
      if (this.tiendaEnUso) { this.stream.soltar(); this.tiendaEnUso = null; }
      if (id) { this.stream.usar(id); this.tiendaEnUso = id; this.cargar(); }
    });
    // Cada plano nuevo cambia la predicción: se vuelve a pedir (barato, una lista corta).
    effect(() => { if (this.stream.plano()) this.cargarPrediccion(); });
    this.refrescoId = setInterval(() => this.cargar(), REFRESCO_MS);
    this.stream.alerta$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(a => {
      if (a.mesa_nombre) this.snack.open(`Mesa ${a.mesa_nombre}: ${a.tipo}`, 'OK', { duration: 4000 });
    });
  }

  ngOnDestroy(): void {
    if (this.refrescoId) clearInterval(this.refrescoId);
    if (this.tiendaEnUso) this.stream.soltar();
  }

  cargar(): void {
    const id = this.ctx.tiendaId();
    if (!id) return;
    this.api.espera(id).subscribe({
      next: l => { this.espera.set(l); this.errorEspera.set(null); },
      error: e => this.errorEspera.set(mensajeError(e, 'No se pudo cargar la lista de espera')),
    });
    this.cargarPrediccion();
  }
  private cargarPrediccion(): void {
    const id = this.ctx.tiendaId();
    if (!id) return;
    this.api.prediccion(id).subscribe({ next: p => this.prediccion.set(p), error: () => { /* se mantiene la anterior */ } });
  }

  minutosDesde(iso: string | null): number {
    const t = Date.parse(iso ?? '');
    return Number.isNaN(t) ? 0 : Math.max(0, Math.round((this.stream.ahora() - t) / 60000));
  }

  agregar(): void {
    const id = this.ctx.tiendaId();
    if (!id || !this.nuevo.nombre.trim()) return;
    this.guardando.set(true);
    const body: EsperaForm = { ...this.nuevo, nombre: this.nuevo.nombre.trim(), telefono: this.nuevo.telefono?.trim() || null, canal: 'ANFITRION' };
    this.api.crearEspera(id, body).subscribe({
      next: e => {
        this.guardando.set(false);
        this.nuevo = { nombre: '', personas: 2, telefono: null, canal: 'ANFITRION' };
        this.snack.open(`${e.nombre}: posición ${e.posicion ?? '?'}${e.minutos_estimados !== null ? ', ~' + e.minutos_estimados + ' min' : ''}`, 'OK', { duration: 4000 });
        this.cargar();
      },
      error: e => { this.guardando.set(false); this.snack.open(mensajeError(e), 'OK', { duration: 5000 }); },
    });
  }

  elegirMesa(esperaId: string, mesaId: string): void {
    this.mesaElegida.update(m => ({ ...m, [esperaId]: mesaId }));
  }

  avisar(e: Espera): void { this.accion(e, this.api.avisarEspera(e.id), `${e.nombre}: avisado`); }
  sentar(e: Espera): void {
    const mesa = this.mesaElegida()[e.id];
    if (!mesa) return;
    this.accion(e, this.api.sentarEspera(e.id, mesa), `${e.nombre}: sentado`, () => this.stream.refrescar());
  }
  cancelar(e: Espera): void { this.accion(e, this.api.cancelarEspera(e.id), `${e.nombre}: cancelado`); }
  noLlego(e: Espera): void { this.accion(e, this.api.noLlegoEspera(e.id), `${e.nombre}: no llegó`); }

  private accion(e: Espera, peticion: { subscribe: (o: { next: () => void; error: (x: unknown) => void }) => unknown }, ok: string, despues?: () => void): void {
    this.ocupado.set(e.id);
    peticion.subscribe({
      next: () => { this.ocupado.set(null); this.snack.open(ok, 'OK', { duration: 2500 }); this.cargar(); despues?.(); },
      error: x => { this.ocupado.set(null); this.snack.open(mensajeError(x), 'OK', { duration: 5000 }); },
    });
  }
}
