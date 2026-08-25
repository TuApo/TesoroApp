import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ConstructorStore } from '../services/constructor.store';
import { ReportesApiService } from '../services/reportes-api.service';

/**
 * Vista de diagrama de las tablas del reporte y sus relaciones (§7).
 *
 * Cada tabla es un bloque con sus columnas seleccionadas, su PK y las que actúan
 * como llave foránea; las líneas son las relaciones activas. Es la forma más
 * rápida de ver por qué un reporte trae filas de más: se ve el "uno a muchos"
 * dibujado, no hay que deducirlo de los números.
 *
 * Al seleccionar una relación se puede cambiar el tipo de unión o desactivarla,
 * que es exactamente lo que pide el brief.
 */
@Component({
  selector: 'app-diagrama-relaciones',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatMenuModule, MatTooltipModule],
  template: `
  <div class="diag">
    @if (!store.root()) {
      <div class="vacio">
        <mat-icon>account_tree</mat-icon>
        <p>Elige la tabla principal para ver el diagrama.</p>
      </div>
    } @else {
      <div class="cadena">
        @for (n of nodos(); track n.clave; let i = $index; let ultimo = $last) {
          <div class="bloque" [class.bloque--raiz]="n.esRaiz">
            <div class="bloque__cab">
              <mat-icon>{{ n.icono }}</mat-icon>
              <span class="bloque__nombre">{{ n.nombre }}</span>
              @if (n.esRaiz) { <em class="marca">principal</em> }
              @if (!n.esRaiz) {
                <button mat-icon-button class="bloque__x" (click)="store.quitarTabla(n.clave)"
                        matTooltip="Quitar del reporte">
                  <mat-icon>close</mat-icon>
                </button>
              }
            </div>
            <div class="bloque__tec">{{ n.esquema }}.{{ n.tabla }}</div>

            <ul class="bloque__cols">
              @for (c of n.columnas; track c.clave) {
                <li>
                  @if (c.esPk) { <mat-icon class="ic ic--pk" matTooltip="Llave primaria">key</mat-icon> }
                  @else if (c.esFk) { <mat-icon class="ic ic--fk" matTooltip="Relaciona con otra tabla">hub</mat-icon> }
                  @else { <mat-icon class="ic">check</mat-icon> }
                  <span>{{ c.nombre }}</span>
                </li>
              }
              @if (!n.columnas.length) {
                <li class="bloque__sincols">Sin columnas seleccionadas</li>
              }
              @if (n.ocultas > 0) {
                <li class="bloque__mas">+ {{ n.ocultas }} más</li>
              }
            </ul>
          </div>

          @if (!ultimo && conexiones()[i]; as con) {
            <div class="conector" [class.conector--off]="!con.activo">
              <div class="conector__linea"></div>
              <button class="conector__chip" [matMenuTriggerFor]="menuRel"
                      [matTooltip]="con.advertencia || 'Cambiar el tipo de unión'">
                <mat-icon>{{ con.multiplica ? 'call_split' : 'link' }}</mat-icon>
                <span>{{ con.tipo === 'INNER' ? 'solo coincidencias' : 'todas las de la izquierda' }}</span>
              </button>
              <div class="conector__linea"></div>

              <mat-menu #menuRel="matMenu">
                <div class="menurel" (click)="$event.stopPropagation()">
                  <p class="menurel__t">{{ con.nombre }}</p>
                  <p class="menurel__on">
                    <code>{{ con.izq }}</code> = <code>{{ con.der }}</code>
                  </p>
                  @if (con.advertencia) {
                    <p class="menurel__warn"><mat-icon>warning_amber</mat-icon>{{ con.advertencia }}</p>
                  }
                </div>
                <button mat-menu-item (click)="store.cambiarTipoJoin(con.clave, 'LEFT')">
                  <mat-icon>{{ con.tipo === 'LEFT' ? 'radio_button_checked' : 'radio_button_unchecked' }}</mat-icon>
                  Traer todas, aunque no tengan pareja
                </button>
                <button mat-menu-item (click)="store.cambiarTipoJoin(con.clave, 'INNER')">
                  <mat-icon>{{ con.tipo === 'INNER' ? 'radio_button_checked' : 'radio_button_unchecked' }}</mat-icon>
                  Solo las que sí tienen pareja
                </button>
                <button mat-menu-item (click)="store.alternarJoin(con.clave)">
                  <mat-icon>{{ con.activo ? 'toggle_on' : 'toggle_off' }}</mat-icon>
                  {{ con.activo ? 'Desactivar relación' : 'Activar relación' }}
                </button>
              </mat-menu>
            </div>
          }
        }
      </div>

      @if (avisos().length) {
        <div class="avisos">
          @for (a of avisos(); track $index) {
            <p><mat-icon>warning_amber</mat-icon>{{ a }}</p>
          }
        </div>
      }
    }
  </div>
  `,
  styles: [`
    :host { display: block; }
    .diag { padding: .3rem 0; }

    .cadena {
      display: flex; align-items: stretch; gap: 0; overflow-x: auto; padding: .4rem .1rem 1rem;
    }

    .bloque {
      flex: 0 0 auto; min-width: 180px; max-width: 230px;
      border: 1px solid var(--rp-borde, #e2e8f0); border-radius: 12px;
      background: var(--rp-fondo, #fff); overflow: hidden;
      box-shadow: 0 1px 2px rgba(15,23,42,.05);
    }
    .bloque--raiz { border-color: #0284c7; box-shadow: 0 0 0 3px #e0f2fe; }

    .bloque__cab {
      display: flex; align-items: center; gap: .3rem; padding: .45rem .55rem;
      background: var(--rp-cab, #f8fafc); border-bottom: 1px solid var(--rp-borde, #e2e8f0);
    }
    .bloque__cab > mat-icon { font-size: 17px; width: 17px; height: 17px; color: #64748b; }
    .bloque__nombre {
      flex: 1; font-size: .82rem; font-weight: 700; color: var(--rp-texto, #0f172a);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .marca {
      font-style: normal; font-size: .6rem; font-weight: 700; text-transform: uppercase;
      background: #0284c7; color: #fff; border-radius: 999px; padding: 1px 5px;
    }
    .bloque__x { width: 24px; height: 24px; line-height: 24px; }
    .bloque__x mat-icon { font-size: 14px; width: 14px; height: 14px; }

    .bloque__tec {
      font-family: ui-monospace, Menlo, monospace; font-size: .62rem; color: #94a3b8;
      padding: .2rem .55rem; border-bottom: 1px dashed var(--rp-borde, #e2e8f0);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }

    .bloque__cols { list-style: none; margin: 0; padding: .3rem .4rem .45rem; }
    .bloque__cols li {
      display: flex; align-items: center; gap: .25rem;
      font-size: .74rem; color: #475569; padding: 1px 0; min-width: 0;
    }
    .bloque__cols li span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ic { font-size: 13px; width: 13px; height: 13px; color: #cbd5e1; }
    .ic--pk { color: #f59e0b; }
    .ic--fk { color: #6366f1; }
    .bloque__sincols, .bloque__mas { color: #94a3b8; font-style: italic; }

    .conector { flex: 0 0 auto; display: flex; align-items: center; padding: 0 .2rem; }
    .conector--off { opacity: .4; }
    .conector__linea { width: 14px; height: 2px; background: #cbd5e1; }
    .conector__chip {
      display: inline-flex; align-items: center; gap: .2rem; cursor: pointer;
      border: 1px solid #cbd5e1; border-radius: 999px; background: #fff;
      padding: .12rem .5rem; font-size: .66rem; color: #475569; white-space: nowrap;
    }
    .conector__chip:hover { border-color: #0284c7; color: #0284c7; }
    .conector__chip mat-icon { font-size: 13px; width: 13px; height: 13px; }

    .menurel { padding: .5rem .8rem; max-width: 260px; }
    .menurel__t { margin: 0 0 .2rem; font-size: .8rem; font-weight: 700; }
    .menurel__on { margin: 0; font-size: .7rem; color: #64748b; }
    .menurel__on code { background: #f1f5f9; border-radius: 4px; padding: 0 3px; }
    .menurel__warn {
      display: flex; gap: .25rem; margin: .4rem 0 0; font-size: .7rem; color: #b45309;
    }
    .menurel__warn mat-icon { font-size: 14px; width: 14px; height: 14px; }

    .avisos { display: flex; flex-direction: column; gap: .25rem; }
    .avisos p {
      display: flex; align-items: flex-start; gap: .3rem; margin: 0;
      font-size: .76rem; color: #92400e; background: #fffbeb;
      border: 1px solid #fde68a; border-radius: 10px; padding: .4rem .55rem;
    }
    .avisos mat-icon { font-size: 16px; width: 16px; height: 16px; flex: 0 0 auto; }

    .vacio { text-align: center; padding: 1.6rem 1rem; color: #94a3b8; }
    .vacio mat-icon { font-size: 34px; width: 34px; height: 34px; opacity: .5; }
    .vacio p { font-size: .8rem; margin: .4rem 0 0; }

    :host-context(.dark-theme) {
      --rp-borde: #334155; --rp-fondo: #1e293b; --rp-cab: #16202f; --rp-texto: #e2e8f0;
    }
    :host-context(.dark-theme) .conector__chip { background: #1e293b; border-color: #334155; color: #cbd5e1; }
  `],
})
export class DiagramaRelacionesComponent {

  readonly store = inject(ConstructorStore);
  private api = inject(ReportesApiService);

  /** Máximo de columnas que se listan por bloque: el resto se resume. */
  private static readonly MAX_COLS = 7;

  readonly nodos = computed(() => {
    const raiz = this.store.root();
    return this.store.datasetsUsados().map(clave => {
      const d = this.api.datasetsPorClave().get(clave);
      const seleccionadas = this.store.fields()
        .filter(f => f.campo?.startsWith(clave + '.'))
        .map(f => {
          const c = this.api.camposPorClave().get(f.campo!);
          return {
            clave: f.campo!,
            nombre: f.alias,
            esPk: c?.es_pk ?? false,
            esFk: c?.es_fk ?? false,
          };
        });
      return {
        clave,
        nombre: d?.nombre ?? clave,
        icono: d?.icono ?? 'table_chart',
        esquema: d?.esquema ?? '',
        tabla: d?.tabla_fisica ?? '',
        esRaiz: clave === raiz,
        columnas: seleccionadas.slice(0, DiagramaRelacionesComponent.MAX_COLS),
        ocultas: Math.max(0, seleccionadas.length - DiagramaRelacionesComponent.MAX_COLS),
      };
    });
  });

  /**
   * Conexión entre el bloque i y el i+1. Se busca la relación activa que une esas
   * dos tablas; si no hay una directa (porque el grafo no es una cadena simple),
   * se deja el hueco en lugar de dibujar una línea que mentiría.
   */
  readonly conexiones = computed(() => {
    const claves = this.store.datasetsUsados();
    const joins = this.store.joins();
    const mapa = this.api.relacionesPorClave();
    const salida: (null | {
      clave: string; nombre: string; tipo: string; activo: boolean;
      multiplica: boolean; advertencia: string | null; izq: string; der: string;
    })[] = [];

    for (let i = 0; i < claves.length - 1; i++) {
      const a = claves[i];
      const b = claves[i + 1];
      const j = joins.find(x => {
        const rel = mapa.get(x.relacion);
        return rel && ((rel.dataset_izq === a && rel.dataset_der === b)
                    || (rel.dataset_izq === b && rel.dataset_der === a));
      });
      if (!j) { salida.push(null); continue; }
      const rel = mapa.get(j.relacion)!;
      salida.push({
        clave: rel.clave,
        nombre: rel.nombre ?? rel.clave,
        tipo: j.tipo ?? rel.tipo_default,
        activo: j.activo,
        multiplica: rel.multiplica_filas,
        advertencia: rel.advertencia,
        izq: `${this.nombreCorto(rel.dataset_izq)}.${rel.columna_izq}`,
        der: `${this.nombreCorto(rel.dataset_der)}.${rel.columna_der}`,
      });
    }
    return salida;
  });

  readonly avisos = computed(() => {
    const out: string[] = [];
    for (const c of this.conexiones()) {
      if (c?.activo && c.multiplica && c.advertencia) out.push(c.advertencia);
    }
    // Sin duplicar el mismo aviso dos veces si hay varias relaciones 1:N iguales.
    return [...new Set(out)];
  });

  private nombreCorto(clave: string): string {
    return this.api.datasetsPorClave().get(clave)?.nombre ?? clave;
  }
}
