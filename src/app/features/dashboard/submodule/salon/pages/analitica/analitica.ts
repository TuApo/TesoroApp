import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

import { ColumnaTabla, TABLA_ESTANDAR } from '@/app/shared/components/tabla-estandar';

import { SalonMapaCalor } from '../../components/mapa-calor';
import { SalonEncabezado } from '../../components/salon-encabezado';
import { Analitica, RecomendacionMeseros, RotacionMesa, nombreDia } from '../../models/salon.models';
import { SALON_CONTEXTO } from '../../services/salon-contexto.token';
import { SalonService, mensajeError } from '../../services/salon.service';

/**
 * Analítica del salón (§4.6): rango de fechas, mapa de calor día×hora, rotación por mesa,
 * tiempos medios, KPIs de alertas, recomendación de meseros por día/franja y duración por
 * tamaño de grupo.
 */
@Component({
  selector: 'app-salon-analitica',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule, SalonEncabezado, SalonMapaCalor, ...TABLA_ESTANDAR],
  styleUrls: ['../../salon-comun.css'],
  template: `
    <div class="sl-pagina">
      <app-salon-encabezado subtitulo="Ocupación, rotación y cuántos meseros hacen falta" />

      @if (!ctx.tiendaId()) {
        <div class="sl-panel sl-vacio"><mat-icon>storefront</mat-icon><strong>Elige una sede.</strong></div>
      } @else {
        <section class="sl-panel sl-fila an-filtros">
          <label class="sl-campo"><span>Desde</span><input class="sl-input" type="date" [ngModel]="desde()" (ngModelChange)="desde.set($event)" /></label>
          <label class="sl-campo"><span>Hasta</span><input class="sl-input" type="date" [ngModel]="hasta()" (ngModelChange)="hasta.set($event)" /></label>
          <div class="an-atajos">
            <button type="button" class="sl-btn sl-btn--chico" (click)="rango(7)">7 días</button>
            <button type="button" class="sl-btn sl-btn--chico" (click)="rango(30)">30 días</button>
            <button type="button" class="sl-btn sl-btn--chico" (click)="rango(90)">90 días</button>
          </div>
          <span class="sl-esp"></span>
          <button type="button" class="sl-btn sl-btn--primario" (click)="cargar()" [disabled]="cargando()"><mat-icon>query_stats</mat-icon>Calcular</button>
        </section>

        @if (error(); as e) { <div class="sl-aviso sl-tono-danger" role="alert"><mat-icon>cloud_off</mat-icon>{{ e }}</div> }

        @if (datos(); as d) {
          <section class="sl-kpis">
            <div class="sl-kpi"><small>Atención media</small><strong>{{ minutos(d.tiempo_medio_atencion_seg) }}</strong></div>
            <div class="sl-kpi"><small>Limpieza media</small><strong>{{ minutos(d.tiempo_medio_limpieza_seg) }}</strong></div>
            <div class="sl-kpi"><small>Alertas</small><strong>{{ d.alertas.total }}</strong></div>
            <div class="sl-kpi"><small>Sin atención</small><strong>{{ d.alertas.atencion }}</strong></div>
            <div class="sl-kpi"><small>Escalados</small><strong>{{ d.alertas.escalado }}</strong></div>
            <div class="sl-kpi"><small>Limpieza</small><strong>{{ d.alertas.limpieza }}</strong></div>
            <div class="sl-kpi"><small>Falsos positivos</small><strong>{{ d.alertas.falsos_positivos }} <span class="an-pct">({{ d.alertas.pct_falsos_positivos }} %)</span></strong></div>
          </section>

          <div class="sl-grid-2">
            <section class="sl-panel">
              <h2><mat-icon>grid_on</mat-icon>Ocupación por día y hora</h2>
              @if (d.mapa_calor.length) { <app-salon-mapa-calor [celdas]="d.mapa_calor" /> }
              @else { <div class="sl-vacio"><mat-icon>grid_off</mat-icon><strong>Sin observaciones en el rango.</strong></div> }
            </section>

            <section class="sl-panel">
              <h2><mat-icon>badge</mat-icon>Meseros recomendados</h2>
              <p class="sl-muted an-nota">Mesas ocupadas medias ÷ mesas por mesero (regla <code>mesas_por_mesero</code>), redondeado hacia arriba.</p>
              @if (!d.recomendacion_meseros.length) {
                <div class="sl-vacio"><mat-icon>person_search</mat-icon><strong>Aún no hay histórico suficiente.</strong></div>
              } @else {
                <div class="an-meseros">
                  @for (dia of diasRecomendacion(); track dia.dia) {
                    <div class="an-dia">
                      <strong>{{ dia.nombre }}</strong>
                      @for (f of dia.franjas; track f.franja) {
                        <span class="an-franja" [title]="f.mesas_ocupadas_medias + ' mesas ocupadas de media'">
                          <span class="sl-muted">{{ f.franja }}</span>
                          <b>{{ f.meseros }}</b><mat-icon>person</mat-icon>
                        </span>
                      }
                    </div>
                  }
                </div>
              }
            </section>
          </div>

          <section class="sl-panel">
            <h2><mat-icon>sync_alt</mat-icon>Rotación por mesa</h2>
            <app-tabla-estandar id="salon-analitica-rotacion" titulo="Rotación por mesa" modulo="Salón"
              [datos]="d.rotacion_por_mesa" [columnas]="columnasRotacion" [filaId]="idMesa" [seleccionable]="false" [filasPorPagina]="0"
              vacio="Sin grupos en el rango." [pie]="pieRotacion" />
          </section>

          @if (d.duracion_por_tamano.length) {
            <section class="sl-panel">
              <h2><mat-icon>timelapse</mat-icon>Duración por tamaño de grupo</h2>
              <div class="an-tamanos">
                @for (t of d.duracion_por_tamano; track t.personas) {
                  <div class="sl-kpi"><small>{{ t.personas }} persona{{ t.personas === 1 ? '' : 's' }}</small><strong>{{ t.minutos_medios }} min</strong><span class="sl-muted">{{ t.muestras }} muestras</span></div>
                }
              </div>
            </section>
          }
        } @else if (cargando()) {
          <div class="sl-panel sl-vacio"><mat-icon>hourglass_top</mat-icon><strong>Calculando…</strong></div>
        }
      }
    </div>
  `,
  styles: [`
    .an-filtros { align-items: end; }
    .an-filtros .sl-campo { min-width: 150px; }
    .an-atajos { display: flex; gap: 6px; align-items: end; }
    .an-pct { font-size: .85rem; color: var(--muted); font-weight: 600; }
    .an-nota { margin: -4px 0 10px; font-size: .82rem; }
    .an-nota code { font-size: .8rem; }
    .an-meseros { display: flex; flex-direction: column; gap: 8px; }
    .an-dia { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .an-dia > strong { min-width: 40px; }
    .an-franja { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 999px; background: var(--surface-2); border: 1px solid var(--border); font-size: .85rem; }
    .an-franja b { font-size: 1rem; color: var(--primary); }
    .an-franja mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--primary); }
    .an-tamanos { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(min(140px, 100%), 1fr)); }
    .an-tamanos .sl-kpi .sl-muted { font-size: .78rem; }
  `],
})
export class SalonAnaliticaPage {
  readonly ctx = inject(SALON_CONTEXTO);
  private api = inject(SalonService);

  readonly desde = signal(fechaIso(diasAtras(30)));
  readonly hasta = signal(fechaIso(new Date()));
  readonly datos = signal<Analitica | null>(null);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly idMesa = (r: RotacionMesa) => r.mesa_id;

  readonly columnasRotacion: ColumnaTabla<RotacionMesa>[] = [
    { id: 'mesa', header: 'Mesa', valor: r => r.mesa_nombre, tarjeta: 'titulo' },
    { id: 'grupos', header: 'Grupos', align: 'right', valor: r => r.grupos },
    { id: 'ocupada', header: 'Min. ocupada (media)', align: 'right', valor: r => r.minutos_medios_ocupada, formato: r => `${r.minutos_medios_ocupada} min` },
    { id: 'limpieza', header: 'Min. limpieza (media)', align: 'right', valor: r => r.minutos_medios_limpieza, formato: r => `${r.minutos_medios_limpieza} min`, prioridad: 2 },
  ];
  readonly pieRotacion = (filas: RotacionMesa[]) => ({ grupos: filas.reduce((s, r) => s + r.grupos, 0) });

  readonly diasRecomendacion = computed(() => {
    const porDia = new Map<number, RecomendacionMeseros[]>();
    for (const r of this.datos()?.recomendacion_meseros ?? []) porDia.set(r.dia_semana, [...(porDia.get(r.dia_semana) ?? []), r]);
    return [...porDia.entries()].sort((a, b) => a[0] - b[0])
      .map(([dia, franjas]) => ({ dia, nombre: nombreDia(dia), franjas: franjas.sort((a, b) => a.franja.localeCompare(b.franja)) }));
  });

  constructor() {
    effect(() => { if (this.ctx.tiendaId()) this.cargar(); });
  }

  rango(dias: number): void {
    this.desde.set(fechaIso(diasAtras(dias)));
    this.hasta.set(fechaIso(new Date()));
    this.cargar();
  }

  cargar(): void {
    const id = this.ctx.tiendaId();
    if (!id || !this.desde() || !this.hasta()) return;
    this.cargando.set(true);
    this.error.set(null);
    this.api.analitica(id, this.desde(), this.hasta()).subscribe({
      next: d => { this.datos.set(d); this.cargando.set(false); },
      error: e => { this.error.set(mensajeError(e, 'No se pudo calcular la analítica')); this.cargando.set(false); },
    });
  }

  minutos(seg: number | null): string {
    if (seg == null) return '—';
    return seg < 90 ? `${Math.round(seg)} s` : `${Math.round(seg / 60)} min`;
  }
}

function diasAtras(n: number): Date { const d = new Date(); d.setDate(d.getDate() - n); return d; }
function fechaIso(d: Date): string {
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
