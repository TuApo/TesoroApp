import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CdkDrag, CdkDragStart } from '@angular/cdk/drag-drop';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { CampoCatalogo, DatasetCatalogo } from '../models/reportes.models';
import { ReportesApiService } from '../services/reportes-api.service';
import { ConstructorStore } from '../services/constructor.store';

/**
 * Explorador de datos: el panel izquierdo del constructor (§5).
 *
 * Muestra las tablas AUTORIZADAS agrupadas por origen y categoría, con su nombre
 * amigable y —desplegado— el técnico, las columnas con su tipo, la PK y las
 * relaciones conocidas.
 *
 * Dos gestos para agregar un campo, porque los dos son naturales según el momento:
 * el checkbox para ir marcando varios seguidos, y arrastrar para colocarlo en un
 * sitio concreto del panel de columnas.
 */
@Component({
  selector: 'app-explorador-datos',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, CdkDrag, MatIconModule, MatButtonModule,
    MatTooltipModule, MatMenuModule, MatCheckboxModule],
  template: `
  <div class="exp">
    <div class="exp__buscar">
      <mat-icon>search</mat-icon>
      <input type="text" [(ngModel)]="textoBusqueda" (ngModelChange)="filtro.set($event)"
             placeholder="Buscar tabla o campo…" aria-label="Buscar en el catalogo">
      @if (filtro()) {
        <button mat-icon-button (click)="limpiar()" aria-label="Limpiar busqueda">
          <mat-icon>close</mat-icon>
        </button>
      }
    </div>

    @if (!store.root()) {
      <p class="exp__ayuda">
        <mat-icon>looks_one</mat-icon>
        Elige la tabla principal del reporte. Después podrás relacionar otras.
      </p>
    }

    <div class="exp__lista">
      @for (grupo of gruposVisibles(); track grupo.origen) {
        <div class="origen">
          <div class="origen__cab">
            <mat-icon [style.color]="grupo.color">{{ grupo.icono }}</mat-icon>
            <span>{{ grupo.nombre }}</span>
            <small>{{ grupo.datasets.length }}</small>
          </div>

          @for (d of grupo.datasets; track d.clave) {
            <div class="tabla" [class.tabla--activa]="estaEnReporte(d.clave)"
                 [class.tabla--raiz]="store.root() === d.clave">
              <button class="tabla__cab" type="button" (click)="alternar(d.clave)">
                <mat-icon class="tabla__chev">
                  {{ abiertas().has(d.clave) ? 'expand_more' : 'chevron_right' }}
                </mat-icon>
                <mat-icon class="tabla__ico">{{ d.icono }}</mat-icon>
                <span class="tabla__nombre">
                  {{ d.nombre }}
                  @if (store.root() === d.clave) { <em class="marca">principal</em> }
                </span>
                @if (d.filas_estimadas) {
                  <small class="tabla__filas" [matTooltip]="'≈ ' + (d.filas_estimadas | number) + ' registros'">
                    {{ compacto(d.filas_estimadas) }}
                  </small>
                }
              </button>

              @if (!estaEnReporte(d.clave)) {
                <button mat-icon-button class="tabla__add" type="button"
                        [matTooltip]="tooltipAgregar(d)"
                        [disabled]="!!store.root() && !store.relacionSugerida(d.clave)"
                        (click)="agregar(d)">
                  <mat-icon>{{ store.root() ? 'add_link' : 'play_circle' }}</mat-icon>
                </button>
              } @else if (store.root() !== d.clave) {
                <button mat-icon-button class="tabla__add" type="button"
                        matTooltip="Quitar esta tabla del reporte" (click)="quitar(d.clave)">
                  <mat-icon>link_off</mat-icon>
                </button>
              }

              @if (abiertas().has(d.clave)) {
                <div class="detalle">
                  <div class="detalle__meta">
                    <span class="tecnico" matTooltip="Nombre técnico en la base de datos">
                      <mat-icon>storage</mat-icon>{{ d.esquema }}.{{ d.tabla_fisica }}
                    </span>
                    @if (d.pk_columna) {
                      <span class="tecnico" matTooltip="Llave primaria">
                        <mat-icon>key</mat-icon>{{ d.pk_columna }}
                      </span>
                    }
                    @if (d.editable) {
                      <span class="tecnico tecnico--edit" matTooltip="Tiene campos editables desde el reporte">
                        <mat-icon>edit_note</mat-icon>editable
                      </span>
                    }
                  </div>
                  @if (d.descripcion) { <p class="detalle__desc">{{ d.descripcion }}</p> }

                  @if (d.relaciones.length) {
                    <div class="rels">
                      <span class="rels__t">Relaciones conocidas</span>
                      @for (r of d.relaciones; track r.clave) {
                        <div class="rel" [matTooltip]="r.advertencia || 'Relación uno a uno'">
                          <mat-icon [class.rel__warn]="r.multiplica_filas">
                            {{ r.multiplica_filas ? 'call_split' : 'link' }}
                          </mat-icon>
                          <span>{{ r.nombre || r.clave }}</span>
                        </div>
                      }
                    </div>
                  }

                  <div class="campos">
                    @for (c of camposVisibles(d); track c.clave) {
                      <div class="campo" cdkDrag [cdkDragData]="c" (cdkDragStarted)="arrastrando.set(true)"
                           (cdkDragEnded)="arrastrando.set(false)">
                        <mat-checkbox class="campo__chk"
                                      [checked]="estaSeleccionado(c.clave)"
                                      [disabled]="!estaEnReporte(d.clave)"
                                      (change)="alternarCampo(c, $event.checked)">
                        </mat-checkbox>
                        <mat-icon class="campo__tipo" [matTooltip]="rotuloTipo(c)">
                          {{ iconoTipo(c) }}
                        </mat-icon>
                        <span class="campo__nombre" [matTooltip]="c.descripcion || c.columna">
                          {{ c.nombre }}
                        </span>
                        @if (c.es_pk) { <mat-icon class="campo__pk" matTooltip="Llave primaria">key</mat-icon> }
                        @if (c.es_fk) { <mat-icon class="campo__fk" matTooltip="Relaciona con otra tabla">hub</mat-icon> }
                        @if (c.sensible) { <mat-icon class="campo__sens" matTooltip="Dato sensible">shield</mat-icon> }

                        @if (estaEnReporte(d.clave) && (c.agregaciones.length > 1)) {
                          <button mat-icon-button class="campo__agg" type="button"
                                  matTooltip="Usar como métrica (contar, sumar…)"
                                  [matMenuTriggerFor]="menuAgg">
                            <mat-icon>functions</mat-icon>
                          </button>
                          <mat-menu #menuAgg="matMenu">
                            @for (a of c.agregaciones; track a) {
                              <button mat-menu-item (click)="agregarMetrica(c, a)">
                                {{ rotuloAgregacion(a) }}
                              </button>
                            }
                          </mat-menu>
                        }
                        <span class="campo__tec">{{ c.columna }}</span>
                      </div>
                    }
                    @if (!camposVisibles(d).length) {
                      <p class="campos__vacio">Ningún campo coincide con la búsqueda.</p>
                    }
                  </div>
                </div>
              }
            </div>
          }
        </div>
      }

      @if (!gruposVisibles().length) {
        <div class="vacio">
          <mat-icon>search_off</mat-icon>
          @if (filtro()) {
            <p>Ninguna tabla o campo coincide con «{{ filtro() }}».</p>
          } @else {
            <p>No tienes tablas habilitadas para reportes. Pídele acceso a un administrador.</p>
          }
        </div>
      }
    </div>
  </div>
  `,
  styles: [`
    :host { display: block; height: 100%; min-height: 0; }
    .exp { display: flex; flex-direction: column; height: 100%; min-height: 0; }

    .exp__buscar {
      display: flex; align-items: center; gap: .35rem;
      padding: .4rem .6rem; margin: 0 0 .5rem;
      border: 1px solid var(--rp-borde, #e2e8f0); border-radius: 10px;
      background: var(--rp-fondo-input, #f8fafc);
    }
    .exp__buscar mat-icon { color: #94a3b8; font-size: 20px; width: 20px; height: 20px; }
    .exp__buscar input {
      flex: 1; border: 0; outline: 0; background: transparent; font-size: .86rem;
      color: var(--rp-texto, #0f172a); min-width: 0;
    }
    .exp__buscar button { width: 28px; height: 28px; line-height: 28px; }

    .exp__ayuda {
      display: flex; align-items: center; gap: .4rem; margin: 0 0 .5rem;
      padding: .5rem .6rem; border-radius: 10px; font-size: .78rem;
      background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe;
    }
    .exp__ayuda mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .exp__lista { flex: 1; overflow-y: auto; overflow-x: hidden; padding-right: 2px; }

    .origen__cab {
      display: flex; align-items: center; gap: .4rem; padding: .5rem .25rem .3rem;
      font-size: .72rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
      color: var(--rp-texto-suave, #64748b);
    }
    .origen__cab mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .origen__cab small {
      margin-left: auto; font-weight: 600; background: var(--rp-fondo-chip, #f1f5f9);
      border-radius: 999px; padding: 0 .4rem;
    }

    .tabla {
      position: relative; border-radius: 10px; margin-bottom: 2px;
      border: 1px solid transparent;
    }
    .tabla:hover { background: var(--rp-hover, #f8fafc); }
    .tabla--activa { background: var(--rp-activa, #f0f9ff); border-color: #bae6fd; }
    .tabla--raiz { border-color: #7dd3fc; }

    .tabla__cab {
      display: flex; align-items: center; gap: .3rem; width: 100%;
      padding: .4rem 2.2rem .4rem .2rem; border: 0; background: transparent;
      cursor: pointer; text-align: left; color: inherit; font: inherit;
    }
    .tabla__chev { font-size: 18px; width: 18px; height: 18px; color: #94a3b8; }
    .tabla__ico { font-size: 18px; width: 18px; height: 18px; color: #64748b; }
    .tabla__nombre {
      flex: 1; font-size: .85rem; font-weight: 600; color: var(--rp-texto, #0f172a);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .marca {
      font-style: normal; font-size: .64rem; font-weight: 700; text-transform: uppercase;
      background: #0284c7; color: #fff; border-radius: 999px; padding: 1px 6px; margin-left: .35rem;
    }
    .tabla__filas { font-size: .68rem; color: #94a3b8; font-variant-numeric: tabular-nums; }
    .tabla__add { position: absolute; right: 2px; top: 2px; width: 30px; height: 30px; line-height: 30px; }
    .tabla__add mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .detalle { padding: .1rem .3rem .5rem 1.6rem; }
    .detalle__meta { display: flex; flex-wrap: wrap; gap: .3rem; margin-bottom: .35rem; }
    .tecnico {
      display: inline-flex; align-items: center; gap: .2rem;
      font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: .66rem;
      color: #64748b; background: var(--rp-fondo-chip, #f1f5f9);
      border-radius: 6px; padding: 1px 5px;
    }
    .tecnico mat-icon { font-size: 12px; width: 12px; height: 12px; }
    .tecnico--edit { color: #b45309; background: #fef3c7; }
    .detalle__desc { margin: 0 0 .4rem; font-size: .73rem; color: #64748b; line-height: 1.35; }

    .rels { margin-bottom: .4rem; }
    .rels__t {
      display: block; font-size: .66rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: .04em; color: #94a3b8; margin-bottom: .15rem;
    }
    .rel { display: flex; align-items: center; gap: .25rem; font-size: .71rem; color: #475569; }
    .rel mat-icon { font-size: 13px; width: 13px; height: 13px; color: #94a3b8; }
    .rel__warn { color: #f59e0b !important; }

    .campos { display: flex; flex-direction: column; }
    .campo {
      display: flex; align-items: center; gap: .25rem; padding: .18rem .2rem;
      border-radius: 6px; cursor: grab; min-width: 0;
    }
    .campo:hover { background: var(--rp-hover-fuerte, #eef2ff); }
    .campo__chk { transform: scale(.8); margin-right: -4px; }
    .campo__tipo { font-size: 15px; width: 15px; height: 15px; color: #94a3b8; flex: 0 0 auto; }
    .campo__nombre {
      flex: 1; font-size: .78rem; color: #334155; min-width: 0;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .campo__tec {
      font-family: ui-monospace, Menlo, monospace; font-size: .62rem; color: #cbd5e1;
      max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .campo__pk { font-size: 13px; width: 13px; height: 13px; color: #f59e0b; }
    .campo__fk { font-size: 13px; width: 13px; height: 13px; color: #6366f1; }
    .campo__sens { font-size: 13px; width: 13px; height: 13px; color: #ef4444; }
    .campo__agg { width: 24px; height: 24px; line-height: 24px; }
    .campo__agg mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .campos__vacio { font-size: .72rem; color: #94a3b8; margin: .2rem 0; }

    .vacio { text-align: center; padding: 2rem .5rem; color: #94a3b8; }
    .vacio mat-icon { font-size: 34px; width: 34px; height: 34px; opacity: .6; }
    .vacio p { font-size: .8rem; margin: .4rem 0 0; }

    /* Modo oscuro: la app lo aplica con .dark-theme en el body. */
    :host-context(.dark-theme) {
      --rp-borde: #334155; --rp-fondo-input: #1e293b; --rp-texto: #e2e8f0;
      --rp-texto-suave: #94a3b8; --rp-fondo-chip: #1e293b; --rp-hover: #1e293b;
      --rp-hover-fuerte: #263449; --rp-activa: #0c2942;
    }
    :host-context(.dark-theme) .campo__nombre { color: #cbd5e1; }
    :host-context(.dark-theme) .exp__ayuda { background: #0c2942; border-color: #1e40af; color: #93c5fd; }
  `],
})
export class ExploradorDatosComponent {

  private api = inject(ReportesApiService);
  readonly store = inject(ConstructorStore);

  /** Aviso al padre cuando una tabla no se puede relacionar (§6). */
  readonly sinRelacion = output<DatasetCatalogo>();
  readonly relacionAgregada = output<{ dataset: DatasetCatalogo; relacion: string }>();

  readonly filtro = signal('');
  readonly abiertas = signal<Set<string>>(new Set());
  readonly arrastrando = signal(false);
  textoBusqueda = '';

  /** Tablas agrupadas por origen, ya filtradas por el buscador. */
  readonly gruposVisibles = computed(() => {
    const cat = this.api.catalogo();
    if (!cat) return [];
    const q = this.filtro().trim().toLowerCase();
    return cat.origenes.map(o => ({
      origen: o.clave,
      nombre: o.nombre,
      icono: o.icono,
      color: o.color ?? '#64748b',
      datasets: cat.datasets
        .filter(d => d.origen === o.clave)
        .filter(d => !q || this.coincide(d, q)),
    })).filter(g => g.datasets.length);
  });

  private coincide(d: DatasetCatalogo, q: string): boolean {
    if (d.nombre.toLowerCase().includes(q)) return true;
    if (d.tabla_fisica.toLowerCase().includes(q)) return true;
    if ((d.categoria ?? '').toLowerCase().includes(q)) return true;
    return d.campos.some(c =>
      c.nombre.toLowerCase().includes(q) || c.columna.toLowerCase().includes(q));
  }

  /** Con búsqueda activa se muestran solo los campos que coinciden. */
  camposVisibles(d: DatasetCatalogo): CampoCatalogo[] {
    const q = this.filtro().trim().toLowerCase();
    if (!q) return d.campos;
    const tablaCoincide = d.nombre.toLowerCase().includes(q) || d.tabla_fisica.toLowerCase().includes(q);
    if (tablaCoincide) return d.campos;
    return d.campos.filter(c =>
      c.nombre.toLowerCase().includes(q) || c.columna.toLowerCase().includes(q));
  }

  limpiar(): void { this.textoBusqueda = ''; this.filtro.set(''); }

  alternar(clave: string): void {
    this.abiertas.update(s => {
      const copia = new Set(s);
      copia.has(clave) ? copia.delete(clave) : copia.add(clave);
      return copia;
    });
  }

  estaEnReporte(clave: string): boolean {
    return this.store.datasetsUsados().includes(clave);
  }

  estaSeleccionado(clave: string): boolean {
    return this.store.fields().some(f => f.campo === clave && !f.agregacion);
  }

  tooltipAgregar(d: DatasetCatalogo): string {
    if (!this.store.root()) return 'Usar como tabla principal del reporte';
    const rel = this.store.relacionSugerida(d.clave);
    if (!rel) {
      return 'No hay una relación conocida entre esta tabla y las que ya agregaste. '
        + 'Agrega primero la tabla que las une.';
    }
    return `Relacionar por «${rel.nombre || rel.clave}»`;
  }

  agregar(d: DatasetCatalogo): void {
    if (!this.store.root()) {
      this.store.fijarRaiz(d.clave);
      this.abiertas.update(s => new Set(s).add(d.clave));
      return;
    }
    const rel = this.store.agregarTabla(d.clave);
    if (!rel) { this.sinRelacion.emit(d); return; }
    this.abiertas.update(s => new Set(s).add(d.clave));
    this.relacionAgregada.emit({ dataset: d, relacion: rel.clave });
  }

  quitar(clave: string): void { this.store.quitarTabla(clave); }

  alternarCampo(c: CampoCatalogo, marcado: boolean): void {
    if (marcado) this.store.agregarCampo(c);
    else {
      const f = this.store.fields().find(x => x.campo === c.clave && !x.agregacion);
      if (f) this.store.quitarCampo(f.id);
    }
  }

  agregarMetrica(c: CampoCatalogo, agg: string): void {
    this.store.agregarMetrica(c, agg as never);
  }

  iconoTipo(c: CampoCatalogo): string {
    switch (c.tipo) {
      case 'ENTERO': case 'DECIMAL': return 'tag';
      case 'MONEDA': return 'payments';
      case 'FECHA': return 'event';
      case 'FECHA_HORA': return 'schedule';
      case 'BOOLEANO': return 'toggle_on';
      case 'ENUM': return 'label';
      default: return 'text_fields';
    }
  }

  rotuloTipo(c: CampoCatalogo): string {
    const base: Record<string, string> = {
      TEXTO: 'Texto', ENTERO: 'Número entero', DECIMAL: 'Número decimal',
      MONEDA: 'Valor en pesos', FECHA: 'Fecha', FECHA_HORA: 'Fecha y hora',
      BOOLEANO: 'Sí / No', ENUM: 'Lista de opciones',
    };
    return `${base[c.tipo] ?? c.tipo} · columna ${c.columna}`;
  }

  rotuloAgregacion(a: string): string {
    const mapa: Record<string, string> = {
      COUNT: 'Contar registros', COUNT_DISTINCT: 'Contar valores distintos',
      SUM: 'Sumar', AVG: 'Promediar', MIN: 'Mínimo', MAX: 'Máximo',
    };
    return mapa[a] ?? a;
  }

  /** 110000 → "110 k". Cabe en la fila y da la magnitud, que es lo que importa. */
  compacto(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
    if (n >= 1_000) return `${Math.round(n / 1_000)} k`;
    return String(n);
  }
}
