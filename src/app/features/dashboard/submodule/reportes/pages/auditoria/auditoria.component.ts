import { ChangeDetectionStrategy, Component, OnInit, inject, signal, viewChild } from '@angular/core';
import { CommonModule, formatDate } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import {
  ColumnaTabla, TABLA_ESTANDAR, TablaEstandarComponent, TonoBadge,
} from '../../../../../../shared/components/tabla-estandar';
import { ReportesApiService } from '../../services/reportes-api.service';
import { FilaAuditoria } from '../../models/reportes.models';

/**
 * Auditoría del módulo (§30).
 *
 * Registra quién creó, modificó, ejecutó, exportó o compartió cada reporte, y —lo
 * más importante— qué datos se editaron desde una tabla, con el valor anterior y
 * el nuevo. Es la contrapartida obligatoria de permitir edición en línea.
 *
 * La tabla estándar va en modo servidor: el backend pagina y filtra por acción y fechas,
 * pero no busca por texto ni ordena por columna, así que esas dos cosas van apagadas.
 */
@Component({
  selector: 'app-auditoria-reportes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, RouterLink, MatIconModule, MatButtonModule,
    MatTooltipModule, MatFormFieldModule, MatSelectModule, MatInputModule,
    MatDatepickerModule, MatNativeDateModule, ...TABLA_ESTANDAR],
  template: `
  <div class="au">
    <header class="au__head">
      <button mat-icon-button routerLink="/dashboard/reportes" matTooltip="Volver">
        <mat-icon>arrow_back</mat-icon>
      </button>
      <div>
        <h1>Auditoría de reportes</h1>
        <p>Quién consultó, exportó o modificó datos desde el módulo.</p>
      </div>
    </header>

    <div class="filtros">
      <mat-form-field appearance="outline" subscriptSizing="dynamic">
        <mat-label>Acción</mat-label>
        <mat-select [(ngModel)]="accion" (ngModelChange)="cargar(0)">
          <mat-option value="">Todas</mat-option>
          @for (a of acciones(); track a) { <mat-option [value]="a">{{ rotulo(a) }}</mat-option> }
        </mat-select>
      </mat-form-field>

      <mat-form-field appearance="outline" subscriptSizing="dynamic">
        <mat-label>Desde</mat-label>
        <input matInput [matDatepicker]="d1" [(ngModel)]="desde" (dateChange)="cargar(0)">
        <mat-datepicker-toggle matIconSuffix [for]="d1"></mat-datepicker-toggle>
        <mat-datepicker #d1></mat-datepicker>
      </mat-form-field>

      <mat-form-field appearance="outline" subscriptSizing="dynamic">
        <mat-label>Hasta</mat-label>
        <input matInput [matDatepicker]="d2" [(ngModel)]="hasta" (dateChange)="cargar(0)">
        <mat-datepicker-toggle matIconSuffix [for]="d2"></mat-datepicker-toggle>
        <mat-datepicker #d2></mat-datepicker>
      </mat-form-field>

      <button mat-stroked-button (click)="limpiar()"><mat-icon>filter_alt_off</mat-icon> Limpiar</button>
    </div>

    <app-tabla-estandar
      id="reportes-auditoria"
      titulo="Auditoría de reportes"
      modulo="Reportes"
      entidad="auditoria_reportes"
      [busqueda]="false"
      vacio="No hay actividad registrada con estos filtros."
      [datos]="filas()"
      [columnas]="columnas"
      [filaId]="idFila"
      [filaClase]="claseFila"
      [cargando]="cargando()"
      [totalServidor]="total()"
      [filasPorPagina]="tam"
      (paginaCambio)="paginar($event)">

      <!-- El detalle se despliega dentro de su propia celda: la tabla no tiene filas extra. -->
      <ng-template tablaCelda="detalle" let-f>
        <span class="detalle">{{ resumen(f) }}</span>
        @if (expandidas().has(f.id) && f.metadata) {
          <pre class="meta">{{ formatear(f.metadata) }}</pre>
        }
      </ng-template>

      <ng-template tablaAcciones let-f>
        @if (f.metadata) {
          <button mat-icon-button (click)="alternar(f.id)"
                  [matTooltip]="expandidas().has(f.id) ? 'Ocultar detalle' : 'Ver detalle'">
            <mat-icon>{{ expandidas().has(f.id) ? 'expand_less' : 'expand_more' }}</mat-icon>
          </button>
        }
      </ng-template>
    </app-tabla-estandar>
  </div>
  `,
  styles: [`
    :host {
      --rp-fondo: var(--surface-2); --rp-panel: var(--surface); --rp-borde: var(--border);
      --rp-texto: var(--text); --rp-texto-suave: var(--muted);
      display: block; min-height: 100%; padding: 1rem 1.2rem 3rem;
      background: var(--rp-fondo); color: var(--rp-texto);
    }
    :host-context(.dark-theme) {
      --rp-fondo: #0f172a; --rp-panel: #1e293b; --rp-borde: #334155;
      --rp-texto: #f1f5f9; --rp-texto-suave: var(--text-faint);
    }
    .au { max-width: 1400px; margin: 0 auto; }
    .au__head { display: flex; align-items: flex-start; gap: .5rem; margin-bottom: 1rem; }
    .au__head h1 { margin: 0; font-size: 1.4rem; font-weight: 800; letter-spacing: -.02em; }
    .au__head p { margin: .15rem 0 0; font-size: .84rem; color: var(--rp-texto-suave); }

    .filtros { display: flex; gap: .5rem; flex-wrap: wrap; align-items: center; margin-bottom: .8rem; }
    .filtros mat-form-field { width: 190px; }

    /* Celdas propias (plantilla tablaCelda del detalle) */
    .detalle { display: inline-block; color: var(--rp-texto-suave); max-width: 420px; white-space: normal; }
    .meta {
      margin: .4rem 0 0; padding: .5rem .6rem; border-radius: 8px; background: var(--surface-2);
      font-size: .74rem; white-space: pre-wrap; word-break: break-word; max-width: 560px;
      font-family: ui-monospace, Menlo, monospace;
    }

    @media (max-width: 720px) { :host { padding: .7rem .5rem 2rem; } .filtros mat-form-field { width: 100%; } }
  `],
})
export class AuditoriaComponent implements OnInit {
  /** Tope de filas por página del endpoint de auditoría (ms-reports). */
  private static readonly MAX_POR_PAGINA = 200;

  private api = inject(ReportesApiService);

  readonly cargando = signal(false);
  readonly filas = signal<FilaAuditoria[]>([]);
  readonly total = signal(0);
  readonly acciones = signal<string[]>([]);
  readonly expandidas = signal<Set<number>>(new Set());

  private readonly tabla = viewChild(TablaEstandarComponent);

  readonly columnas: ColumnaTabla<FilaAuditoria>[] = [
    { id: 'cuando', header: 'Cuándo', ordenable: false, tarjeta: 'subtitulo',
      valor: f => (f.occurred_at ? new Date(f.occurred_at) : null),
      formato: f => (f.occurred_at ? formatDate(f.occurred_at, 'dd/MM/yyyy HH:mm:ss', 'en-US') : '') },
    { id: 'quien', header: 'Quién', ordenable: false, tarjeta: 'titulo', minAncho: '140px',
      valor: f => f.actor_email || f.actor_id || '', formato: f => f.actor_email || f.actor_id || '—' },
    { id: 'accion', header: 'Acción', ordenable: false, tarjeta: 'badge',
      valor: f => this.rotulo(f.accion),
      badge: f => ({ texto: this.rotulo(f.accion), tono: this.tonoAccion(f.accion), icono: this.icono(f.accion) }) },
    { id: 'recurso', header: 'Recurso', ordenable: false, prioridad: 2, tarjeta: 'meta',
      valor: f => f.recurso ?? '', formato: f => f.recurso || '—' },
    // Siempre visible: es donde se despliega el JSON del botón de la fila.
    { id: 'detalle', header: 'Detalle', ordenable: false, tarjeta: 'cuerpo', minAncho: '220px',
      valor: f => this.resumen(f) },
  ];

  readonly idFila = (f: FilaAuditoria) => f.id;
  readonly claseFila = (f: FilaAuditoria) => (f.exito ? '' : 'te-fila--peligro');

  accion = '';
  desde: Date | null = null;
  hasta: Date | null = null;
  pagina = 0;
  tam = 50;

  ngOnInit(): void {
    this.api.accionesAuditoria().subscribe({
      next: r => this.acciones.set(r.acciones),
      error: () => {},
    });
    this.cargar(0);
  }

  cargar(p: number): void {
    this.pagina = p;
    // En modo servidor la tabla lleva su propio número de página: al volver a la primera
    // por un cambio de filtro, se le avisa para que el paginador no se quede atrás.
    this.tabla()?.pagina.set(p);
    this.cargando.set(true);
    this.api.auditoria({
      accion: this.accion,
      desde: this.iso(this.desde),
      hasta: this.iso(this.hasta),
      page: p, size: this.tam,
    }).subscribe({
      next: r => { this.filas.set(r.items); this.total.set(r.total); this.cargando.set(false); },
      error: () => this.cargando.set(false),
    });
  }

  paginar(ev: { pagina: number; porPagina: number }): void {
    // El backend sirve como mucho 200 por página: si se elige más (la tabla ofrece 250),
    // se le pide a la tabla que use 200, que vuelve a emitir con ese tamaño.
    if (ev.porPagina > AuditoriaComponent.MAX_POR_PAGINA) {
      this.tabla()?.cambiarPorPagina(AuditoriaComponent.MAX_POR_PAGINA);
      return;
    }
    this.tam = ev.porPagina;
    this.cargar(ev.pagina);
  }

  limpiar(): void {
    this.accion = ''; this.desde = null; this.hasta = null;
    this.cargar(0);
  }

  alternar(id: number): void {
    this.expandidas.update(s => {
      const copia = new Set(s);
      copia.has(id) ? copia.delete(id) : copia.add(id);
      return copia;
    });
  }

  private iso(d: Date | null): string | undefined {
    if (!d) return undefined;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  rotulo(a: string): string {
    const mapa: Record<string, string> = {
      REPORTE_CREADO: 'Reporte creado', REPORTE_MODIFICADO: 'Reporte modificado',
      REPORTE_ELIMINADO: 'Reporte eliminado', REPORTE_DUPLICADO: 'Reporte duplicado',
      REPORTE_EJECUTADO: 'Reporte ejecutado', REPORTE_EXPORTADO: 'Reporte exportado',
      REPORTE_COMPARTIDO: 'Reporte compartido', DASHBOARD_CREADO: 'Tablero creado',
      DASHBOARD_MODIFICADO: 'Tablero modificado', DASHBOARD_ELIMINADO: 'Tablero eliminado',
      DASHBOARD_COMPARTIDO: 'Tablero compartido', CONSULTA_LIBRE: 'Consulta desde el constructor',
      DATO_EDITADO: 'Dato editado', CATALOGO_MODIFICADO: 'Catálogo modificado',
      ACCESO_DENEGADO: 'Acceso denegado',
    };
    return mapa[a] ?? a;
  }

  icono(a: string): string {
    if (a.includes('ELIMINADO')) return 'delete';
    if (a === 'DATO_EDITADO') return 'edit_note';
    if (a.includes('EXPORTADO')) return 'download';
    if (a.includes('COMPARTIDO')) return 'share';
    if (a.includes('EJECUTADO') || a === 'CONSULTA_LIBRE') return 'play_arrow';
    if (a === 'ACCESO_DENEGADO') return 'block';
    if (a.includes('CREADO')) return 'add';
    return 'edit';
  }

  tonoAccion(a: string): TonoBadge {
    if (a === 'DATO_EDITADO') return 'violet';
    if (a.includes('ELIMINADO') || a === 'ACCESO_DENEGADO') return 'danger';
    if (a.includes('CREADO')) return 'ok';
    if (a.includes('MODIFICADO')) return 'warn';
    return 'neutro';
  }

  /** Resumen legible del metadata, para no obligar a abrir el JSON en cada fila. */
  resumen(f: FilaAuditoria): string {
    if (!f.metadata) return '';
    try {
      const m = JSON.parse(f.metadata);
      if (f.accion === 'DATO_EDITADO') {
        return `${m.tabla ?? ''}.${m.columna ?? ''} — de «${m.antes ?? '(vacío)'}» a «${m.despues ?? '(vacío)'}»`;
      }
      if (f.accion === 'REPORTE_EXPORTADO') {
        return `${m.formato ?? ''} · ${m.filas ?? 0} filas${m.completo ? ' (completo)' : ''}`;
      }
      if (f.accion === 'REPORTE_EJECUTADO' || f.accion === 'CONSULTA_LIBRE') {
        return `${m.filas ?? 0} filas · ${m.ms ?? 0} ms`;
      }
      if (m.nombre) return String(m.nombre);
      if (m.motivo) return String(m.motivo);
      return Object.entries(m).slice(0, 2).map(([k, v]) => `${k}: ${v}`).join(' · ');
    } catch {
      return '';
    }
  }

  formatear(json: string): string {
    try { return JSON.stringify(JSON.parse(json), null, 2); } catch { return json; }
  }
}
