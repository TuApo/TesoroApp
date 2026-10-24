import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { Historico, VisitaHistorica } from '../../campo.models';
import { CampoApiService } from '../../services/campo-api.service';
import { CampoService, mensajeDe } from '../../services/campo.service';

const ETIQUETA_TIPO: Record<string, string> = { FINCA: 'Finca', OFICINA: 'Oficina', CONVOCATORIA: 'Convocatoria' };

/** Nombres legibles de los contadores del informe diario. */
const ETIQUETA_CONTADOR: Record<string, string> = {
  usted_realizo_acompanamiento_en_ingresos_indicar_cantidad_de: 'Ingresos acompañados',
  usted_realizo_acompanamiento_en_pruebas_tecnicas_indicar_can: 'Pruebas técnicas',
  cantidad_de_documentos_recibios_de_compensar_en_la_finca: 'Docs. Compensar recibidos',
  cantidad_de_documentos_procesados_de_compensar: 'Docs. Compensar procesados',
  cantidad_de_tarjetas_de_compensar: 'Tarjetas Compensar',
  cantidad_de_cartas_entregadas_de_compensar: 'Cartas Compensar',
  cantidad_de_citaciones_para_proceso_disciplinarios_realizada: 'Citaciones disciplinarias',
  cantidad_de_procesos_disciplinarios_ejecutados_en_la_finca: 'Procesos disciplinarios',
  cantidad_incapacidades_recibidas: 'Incapacidades recibidas',
  cantidad_incapacidades_radicadas: 'Incapacidades radicadas',
  cantidad_ausentismos: 'Ausentismos',
  cantidad_retiros: 'Retiros',
  cantidad_traslados_de_eps: 'Traslados EPS',
  cantidad_afiliacion_a_beneficiarios_eps: 'Beneficiarios EPS',
  cantidad_de_certificados_laborales_solicitadas: 'Certificados laborales',
};

/**
 * Histórico de visitas de antes del módulo de campo: los informes diarios de los coordinadores
 * (migrados de Google Forms desde jul-2023 y los llenados después en la plataforma). Solo
 * lectura. La administración ve todo; cada quien, lo de su equipo.
 */
@Component({
  selector: 'app-campo-historico',
  standalone: true,
  imports: [MatIconModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../campo-ui.css'],
  styles: [`
    .barras { display: flex; align-items: flex-end; gap: 3px; height: 120px; padding-top: 8px; overflow-x: auto; }
    .barra-mes { flex: 1 0 10px; min-width: 10px; background: var(--brand-blue); border-radius: 4px 4px 0 0; position: relative; }
    .barra-mes:hover::after { content: attr(data-t); position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%);
      background: var(--navy); color: #fff; font-size: 11px; padding: 2px 6px; border-radius: 6px; white-space: nowrap; }
    .eje { display: flex; justify-content: space-between; color: var(--muted); font-size: 12px; margin-top: 4px; }
    .conteos li { display: flex; justify-content: space-between; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 14px; }
    .conteos li span:last-child { color: var(--muted); white-space: nowrap; }
    .conteos { max-height: 340px; overflow: auto; list-style: none; margin: 0; padding: 0; }
    .contadores { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
    .foto img { width: 100%; max-height: 70vh; object-fit: contain; border-radius: 12px; }
    .filtros { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
  `],
  template: `
    <div class="pagina">
      <header class="cabecera">
        <a class="boton chico" routerLink="/dashboard/coordinadores" aria-label="Volver"><mat-icon>arrow_back</mat-icon></a>
        <div style="flex:1;min-width:200px">
          <h1>Histórico de visitas</h1>
          <p>Informes diarios de los coordinadores desde 2023 (Google Forms y plataforma)</p>
        </div>
      </header>

      <section class="tarjeta filtros">
        <div class="campo"><label for="h-desde">Desde</label><input id="h-desde" type="date" [value]="desde()" (change)="desde.set($any($event.target).value); cargar(0)" /></div>
        <div class="campo"><label for="h-hasta">Hasta</label><input id="h-hasta" type="date" [value]="hasta()" (change)="hasta.set($any($event.target).value); cargar(0)" /></div>
        <div class="campo"><label for="h-tipo">Jornada</label>
          <select id="h-tipo" [value]="tipo()" (change)="tipo.set($any($event.target).value); cargar(0)">
            <option value="">Todas</option><option value="FINCA">En finca</option><option value="OFICINA">Oficina</option><option value="CONVOCATORIA">Convocatoria</option>
          </select></div>
        <div class="campo"><label for="h-coord">Coordinador</label>
          <select id="h-coord" [value]="coordinador()" (change)="coordinador.set($any($event.target).value); cargar(0)">
            <option value="">Todos</option>
            @for (c of coordinadores(); track c.clave) { <option [value]="c.clave">{{ c.nombre }} ({{ c.visitas }})</option> }
          </select></div>
      </section>

      @if (error()) { <p class="chip mal">{{ error() }}</p> }

      @if (datos(); as d) {
        <section class="kpis">
          <div class="kpi"><b>{{ d.total }}</b><span>Registros (visita × finca)</span></div>
          <div class="kpi"><b>{{ totalInformes() }}</b><span>Informes diarios</span></div>
          <div class="kpi"><b>{{ d.por_finca.length }}</b><span>Fincas visitadas</span></div>
          <div class="kpi"><b>{{ d.por_coordinador.length }}</b><span>Coordinadores</span></div>
        </section>

        @if (d.por_mes.length) {
          <section class="tarjeta">
            <h2><mat-icon>bar_chart</mat-icon> Informes por mes</h2>
            <div class="barras">
              @for (m of d.por_mes; track m.clave) {
                <div class="barra-mes" [style.height.%]="maxMes() ? m.visitas * 100 / maxMes() : 0" [attr.data-t]="m.nombre + ': ' + m.visitas"></div>
              }
            </div>
            <div class="eje"><span>{{ d.por_mes[0].nombre }}</span><span>{{ d.por_mes[d.por_mes.length - 1].nombre }}</span></div>
          </section>
        }

        <div class="rejilla dos">
          <section class="tarjeta">
            <h2><mat-icon>agriculture</mat-icon> Fincas más visitadas</h2>
            <ul class="conteos">
              @for (f of d.por_finca; track f.clave) { <li><span>{{ f.nombre }}</span><span>{{ f.visitas }} · última {{ f.ultima }}</span></li> }
              @empty { <li><span>Sin visitas a fincas en el rango</span></li> }
            </ul>
          </section>
          <section class="tarjeta">
            <h2><mat-icon>badge</mat-icon> Coordinadores</h2>
            <ul class="conteos">
              @for (c of d.por_coordinador; track c.clave) { <li><span>{{ titulo(c.nombre) }}</span><span>{{ c.visitas }} · última {{ c.ultima }}</span></li> }
            </ul>
          </section>
        </div>

        <section class="tarjeta">
          <h2><mat-icon>list</mat-icon> Registros</h2>
          <ul class="lista">
            @for (v of d.filas; track v.id) {
              <li class="fila">
                <span class="avatar" [style.background]="v.tipo === 'FINCA' ? 'var(--navy)' : 'var(--slate-500)'">
                  <mat-icon>{{ v.tipo === 'FINCA' ? 'agriculture' : v.tipo === 'OFICINA' ? 'business' : 'campaign' }}</mat-icon>
                </span>
                <span class="cuerpo">
                  <strong>{{ v.fecha }} · {{ v.finca_nombre || titulo(v.finca_texto) }}</strong>
                  <small>{{ titulo(v.coordinador_nombre) }}{{ v.oficina ? ' · ' + v.oficina : '' }} · {{ etiquetaTipo[v.tipo] }}{{ v.origen === 'GOOGLE_FORMS' ? ' · Google Forms' : '' }}</small>
                  @if (contadores(v).length) {
                    <span class="contadores">@for (c of contadores(v); track c.k) { <span class="chip">{{ c.k }}: {{ c.v }}</span> }</span>
                  }
                </span>
                @if (v.evidencia_documento_id) {
                  <button type="button" class="boton chico" (click)="verPlanilla(v)" aria-label="Ver planilla"><mat-icon>image</mat-icon></button>
                }
              </li>
            } @empty {
              <li class="vacio"><mat-icon>history</mat-icon> No hay registros con estos filtros</li>
            }
          </ul>
          @if (d.total > d.tamano) {
            <div class="barra" style="justify-content:center;margin-top:12px">
              <button type="button" class="boton chico" [disabled]="d.pagina === 0" (click)="cargar(d.pagina - 1)">Anterior</button>
              <span>Página {{ d.pagina + 1 }} de {{ paginas() }}</span>
              <button type="button" class="boton chico" [disabled]="d.pagina + 1 >= paginas()" (click)="cargar(d.pagina + 1)">Siguiente</button>
            </div>
          }
        </section>
      } @else if (cargando()) {
        <div class="tarjeta vacio"><mat-icon>hourglass_top</mat-icon> Cargando histórico…</div>
      }
    </div>

    @if (foto(); as f) {
      <div class="panel-flotante" (click)="cerrarFoto()">
        <div class="hoja foto" (click)="$event.stopPropagation()">
          <h3>Planilla de la visita</h3>
          <img [src]="f" alt="Planilla de la visita" />
          <div class="acciones"><button type="button" class="boton oscuro" (click)="cerrarFoto()">Cerrar</button></div>
        </div>
      </div>
    }
  `,
})
export class HistoricoComponent {
  private readonly api = inject(CampoApiService);
  private readonly campo = inject(CampoService);
  private readonly destroy = inject(DestroyRef);

  readonly datos = signal<Historico | null>(null);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly desde = signal(haceMeses(6));
  readonly hasta = signal(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date()));
  readonly tipo = signal('');
  readonly coordinador = signal('');
  readonly foto = signal<string | null>(null);
  /** La lista del filtro se arma con la primera consulta (sin filtro de coordinador). */
  readonly coordinadores = signal<{ clave: string; nombre: string; visitas: number }[]>([]);

  readonly etiquetaTipo = ETIQUETA_TIPO;
  readonly maxMes = computed(() => Math.max(0, ...(this.datos()?.por_mes ?? []).map(m => m.visitas)));
  readonly totalInformes = computed(() => (this.datos()?.por_mes ?? []).reduce((s, m) => s + m.visitas, 0));
  readonly paginas = computed(() => { const d = this.datos(); return d ? Math.max(1, Math.ceil(d.total / d.tamano)) : 1; });

  constructor() {
    this.campo.iniciar();
    void this.cargar(0);
    this.destroy.onDestroy(() => this.cerrarFoto());
  }

  async cargar(pagina: number): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const d = await firstValueFrom(this.api.historico({
        desde: this.desde() || undefined, hasta: this.hasta() || undefined, tipo: this.tipo() || undefined,
        coordinador: this.coordinador() || undefined, pagina, tamano: 50,
      }));
      this.datos.set(d);
      if (!this.coordinador()) this.coordinadores.set(d.por_coordinador.map(c => ({ clave: c.clave, nombre: this.titulo(c.nombre), visitas: c.visitas })));
    } catch (e) {
      this.error.set(mensajeDe(e, 'No se pudo cargar el histórico'));
    } finally {
      this.cargando.set(false);
    }
  }

  async verPlanilla(v: VisitaHistorica): Promise<void> {
    if (!v.evidencia_documento_id) return;
    try {
      const b = await firstValueFrom(this.api.documento(v.evidencia_documento_id));
      this.cerrarFoto();
      this.foto.set(URL.createObjectURL(b));
    } catch (e) {
      this.error.set(mensajeDe(e, 'No se pudo abrir la planilla'));
    }
  }

  cerrarFoto(): void {
    const f = this.foto();
    if (f) URL.revokeObjectURL(f);
    this.foto.set(null);
  }

  contadores(v: VisitaHistorica): { k: string; v: number }[] {
    if (!v.resumen_json) return [];
    try {
      const o = JSON.parse(v.resumen_json) as Record<string, number>;
      return Object.entries(o).map(([k, n]) => ({ k: ETIQUETA_CONTADOR[k] ?? k.replace(/_/g, ' '), v: n })).slice(0, 8);
    } catch { return []; }
  }

  titulo(s: string | null): string {
    return (s ?? '').toLowerCase().replace(/(^|\s)\S/g, m => m.toUpperCase());
  }
}

function haceMeses(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(d);
}
