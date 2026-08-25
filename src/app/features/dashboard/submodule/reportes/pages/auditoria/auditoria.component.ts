import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
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
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ReportesApiService } from '../../services/reportes-api.service';
import { FilaAuditoria } from '../../models/reportes.models';

/**
 * Auditoría del módulo (§30).
 *
 * Registra quién creó, modificó, ejecutó, exportó o compartió cada reporte, y —lo
 * más importante— qué datos se editaron desde una tabla, con el valor anterior y
 * el nuevo. Es la contrapartida obligatoria de permitir edición en línea.
 */
@Component({
  selector: 'app-auditoria-reportes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, RouterLink, MatIconModule, MatButtonModule,
    MatTooltipModule, MatFormFieldModule, MatSelectModule, MatInputModule,
    MatDatepickerModule, MatNativeDateModule, MatPaginatorModule, MatProgressBarModule],
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

    @if (cargando()) { <mat-progress-bar mode="indeterminate"></mat-progress-bar> }

    <div class="tabla-wrap">
      <table class="tabla">
        <thead>
          <tr>
            <th>Cuándo</th><th>Quién</th><th>Acción</th><th>Recurso</th><th>Detalle</th><th></th>
          </tr>
        </thead>
        <tbody>
          @for (f of filas(); track f.id) {
            <tr [class.fila--fallo]="!f.exito">
              <td class="nowrap">{{ f.occurred_at | date:'dd/MM/yyyy HH:mm:ss' }}</td>
              <td class="actor">{{ f.actor_email || f.actor_id || '—' }}</td>
              <td>
                <span class="acc" [class]="claseAccion(f.accion)">
                  <mat-icon>{{ icono(f.accion) }}</mat-icon>{{ rotulo(f.accion) }}
                </span>
              </td>
              <td class="nowrap">{{ f.recurso || '—' }}</td>
              <td class="detalle">{{ resumen(f) }}</td>
              <td>
                @if (f.metadata) {
                  <button mat-icon-button (click)="alternar(f.id)"
                          [matTooltip]="expandidas().has(f.id) ? 'Ocultar detalle' : 'Ver detalle'">
                    <mat-icon>{{ expandidas().has(f.id) ? 'expand_less' : 'expand_more' }}</mat-icon>
                  </button>
                }
              </td>
            </tr>
            @if (expandidas().has(f.id) && f.metadata) {
              <tr class="meta">
                <td colspan="6"><pre>{{ formatear(f.metadata) }}</pre></td>
              </tr>
            }
          }
          @if (!filas().length && !cargando()) {
            <tr><td colspan="6" class="vacio">No hay actividad registrada con estos filtros.</td></tr>
          }
        </tbody>
      </table>
    </div>

    <mat-paginator [length]="total()" [pageSize]="tam" [pageSizeOptions]="[25, 50, 100]"
                   (page)="paginar($event)"></mat-paginator>
  </div>
  `,
  styles: [`
    :host {
      --rp-fondo: #f8fafc; --rp-panel: #fff; --rp-borde: #e2e8f0;
      --rp-texto: #0f172a; --rp-texto-suave: #64748b;
      display: block; min-height: 100%; padding: 1rem 1.2rem 3rem;
      background: var(--rp-fondo); color: var(--rp-texto);
    }
    :host-context(.dark-theme) {
      --rp-fondo: #0f172a; --rp-panel: #1e293b; --rp-borde: #334155;
      --rp-texto: #f1f5f9; --rp-texto-suave: #94a3b8;
    }
    .au { max-width: 1400px; margin: 0 auto; }
    .au__head { display: flex; align-items: flex-start; gap: .5rem; margin-bottom: 1rem; }
    .au__head h1 { margin: 0; font-size: 1.4rem; font-weight: 800; letter-spacing: -.02em; }
    .au__head p { margin: .15rem 0 0; font-size: .84rem; color: var(--rp-texto-suave); }

    .filtros { display: flex; gap: .5rem; flex-wrap: wrap; align-items: center; margin-bottom: .8rem; }
    .filtros mat-form-field { width: 190px; }

    .tabla-wrap {
      overflow-x: auto; border: 1px solid var(--rp-borde); border-radius: 12px;
      background: var(--rp-panel);
    }
    .tabla { width: 100%; border-collapse: collapse; font-size: .82rem; }
    .tabla th {
      text-align: left; padding: .6rem .7rem; font-size: .7rem; text-transform: uppercase;
      letter-spacing: .04em; color: var(--rp-texto-suave); border-bottom: 1px solid var(--rp-borde);
      position: sticky; top: 0; background: var(--rp-panel); z-index: 1;
    }
    .tabla td { padding: .5rem .7rem; border-bottom: 1px solid var(--rp-borde); vertical-align: top; }
    .nowrap { white-space: nowrap; }
    .actor { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .detalle { color: var(--rp-texto-suave); max-width: 420px; }
    .fila--fallo { background: #fef2f2; }

    .acc {
      display: inline-flex; align-items: center; gap: .2rem; white-space: nowrap;
      font-size: .72rem; font-weight: 600; border-radius: 999px; padding: 2px 8px;
      background: #f1f5f9; color: #475569;
    }
    .acc mat-icon { font-size: 13px; width: 13px; height: 13px; }
    .acc--crea { background: #d1fae5; color: #047857; }
    .acc--edita { background: #fef3c7; color: #b45309; }
    .acc--borra { background: #fee2e2; color: #b91c1c; }
    .acc--dato { background: #ede9fe; color: #6d28d9; }

    .meta td { background: rgba(148, 163, 184, .08); }
    .meta pre {
      margin: 0; font-size: .74rem; white-space: pre-wrap; word-break: break-word;
      font-family: ui-monospace, Menlo, monospace;
    }
    .vacio { text-align: center; padding: 2.5rem; color: var(--rp-texto-suave); }

    @media (max-width: 720px) { :host { padding: .7rem .5rem 2rem; } .filtros mat-form-field { width: 100%; } }
  `],
})
export class AuditoriaComponent implements OnInit {

  private api = inject(ReportesApiService);

  readonly cargando = signal(false);
  readonly filas = signal<FilaAuditoria[]>([]);
  readonly total = signal(0);
  readonly acciones = signal<string[]>([]);
  readonly expandidas = signal<Set<number>>(new Set());

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

  paginar(ev: PageEvent): void {
    this.tam = ev.pageSize;
    this.cargar(ev.pageIndex);
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

  claseAccion(a: string): string {
    if (a === 'DATO_EDITADO') return 'acc--dato';
    if (a.includes('ELIMINADO') || a === 'ACCESO_DENEGADO') return 'acc--borra';
    if (a.includes('CREADO')) return 'acc--crea';
    if (a.includes('MODIFICADO')) return 'acc--edita';
    return '';
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
