import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { CasoResultado, ResultadoCodigo } from '../../service/codigo.service';

/** Lo que dieron las pruebas: resumen con barra, error de compilación y caso por caso. */
@Component({
  selector: 'app-resultado-pruebas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, DecimalPipe],
  template: `
    @if (resultado; as r) {
      <section class="rp" [class.rp--bien]="r.total > 0 && r.pasadas === r.total" [class.rp--mal]="!r.compilo || r.pasadas === 0">
        <header class="rp-cab">
          <mat-icon>{{ !r.compilo ? 'build_circle' : r.total > 0 && r.pasadas === r.total ? 'task_alt' : r.pasadas === 0 ? 'cancel' : 'rule' }}</mat-icon>
          <div>
            <strong>{{ r.resumen }}</strong>
            @if (r.solo_visibles) { <small>Solo las pruebas visibles. Al entregar se califican también las ocultas.</small> }
            @else if (mostrarNota) { <small>Nota de las pruebas: {{ r.puntaje * 100 | number: '1.0-0' }} %</small> }
          </div>
        </header>
        @if (r.total > 0) {
          <div class="rp-barra" role="progressbar" [attr.aria-valuenow]="r.puntaje * 100" aria-valuemin="0" aria-valuemax="100">
            <i [style.width.%]="r.puntaje * 100"></i>
          </div>
        }
        @if (!r.compilo && r.error_compilacion) {
          <pre class="rp-comp">{{ r.error_compilacion }}</pre>
        }
        <ol class="rp-casos">
          @for (c of r.casos; track c.indice) {
            <li class="rp-caso" [attr.data-estado]="c.estado">
              <span class="rp-ic" [attr.aria-label]="etiqueta(c)"><mat-icon>{{ icono(c) }}</mat-icon></span>
              <div class="rp-det">
                <div class="rp-tit">
                  <b>{{ c.oculto ? 'Prueba oculta ' + c.indice : (c.nombre || 'Prueba ' + c.indice) }}</b>
                  @if (c.peso && c.peso !== 1) { <em>peso {{ c.peso }}</em> }
                </div>
                @if (!c.oculto && c.entrada) { <code class="rp-kv"><span>Prueba</span>{{ c.entrada }}</code> }
                @if (!c.oculto && c.estado !== 'OK' && c.esperado != null) { <code class="rp-kv"><span>Esperado</span>{{ c.esperado }}</code> }
                @if (!c.oculto && c.estado !== 'OK' && c.obtenido != null && c.obtenido !== '') { <code class="rp-kv"><span>Obtenido</span>{{ c.obtenido }}</code> }
                @if (c.mensaje && !(c.estado === 'FALLO' && !c.oculto && c.esperado != null)) { <p class="rp-msg">{{ c.mensaje }}</p> }
              </div>
            </li>
          }
        </ol>
        @if (r.salida) {
          <details class="rp-salida"><summary>Lo que escribió tu programa</summary><pre>{{ r.salida }}</pre></details>
        }
      </section>
    }
  `,
  styles: [`
    .rp { border: 1px solid var(--border); border-radius: 14px; padding: 12px 14px; background: var(--surface); display: grid; gap: 10px; }
    .rp--bien { border-color: #16a34a55; background: color-mix(in srgb, #16a34a 6%, var(--surface)); }
    .rp--mal { border-color: #dc262655; }
    .rp-cab { display: flex; gap: 10px; align-items: flex-start; }
    .rp-cab mat-icon { color: var(--primary); flex: none; }
    .rp--bien .rp-cab mat-icon { color: #16a34a; }
    .rp--mal .rp-cab mat-icon { color: #dc2626; }
    .rp-cab strong { display: block; font-size: 15px; }
    .rp-cab small { color: var(--muted); font-size: 12.5px; }
    .rp-barra { height: 8px; border-radius: 999px; background: var(--surface-3); overflow: hidden; }
    .rp-barra i { display: block; height: 100%; background: linear-gradient(90deg, #16a34a, #65a30d); border-radius: 999px; transition: width .4s; }
    .rp-comp { margin: 0; background: #1e1e2e; color: #fecaca; border-radius: 10px; padding: 10px 12px; font: 12.5px/1.45 var(--font-mono); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 220px; overflow: auto; }
    .rp-casos { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    .rp-caso { display: flex; gap: 8px; align-items: flex-start; padding: 8px 10px; border-radius: 10px; background: var(--surface-2); min-width: 0; }
    .rp-ic { flex: none; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; }
    .rp-ic mat-icon { font-size: 18px; width: 18px; height: 18px; }
    [data-estado='OK'] .rp-ic { background: #dcfce7; color: #15803d; }
    [data-estado='FALLO'] .rp-ic { background: #fee2e2; color: #b91c1c; }
    [data-estado='ERROR'] .rp-ic { background: #ffedd5; color: #c2410c; }
    [data-estado='TIEMPO'] .rp-ic { background: #e0e7ff; color: #4338ca; }
    .rp-det { min-width: 0; flex: 1; display: grid; gap: 3px; }
    .rp-tit { display: flex; gap: 8px; align-items: baseline; font-size: 13.5px; }
    .rp-tit em { font-style: normal; font-size: 11.5px; color: var(--muted); }
    .rp-kv { display: block; font: 12.5px/1.4 var(--font-mono); white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text); max-height: 120px; overflow: auto; }
    .rp-kv span { font-family: var(--font-sans); font-weight: 700; font-size: 11px; text-transform: uppercase; color: var(--muted); margin-right: 6px; letter-spacing: .03em; }
    .rp-msg { margin: 0; font-size: 12.5px; color: var(--text-2); white-space: pre-wrap; overflow-wrap: anywhere; }
    .rp-salida summary { cursor: pointer; font-size: 13px; color: var(--primary); font-weight: 600; }
    .rp-salida pre { margin: 6px 0 0; background: var(--surface-2); border-radius: 8px; padding: 8px 10px; font: 12.5px/1.4 var(--font-mono); white-space: pre-wrap; max-height: 200px; overflow: auto; }
  `],
})
export class ResultadoPruebas {
  @Input() resultado: ResultadoCodigo | null | undefined = null;
  @Input() mostrarNota = true;

  icono(c: CasoResultado): string {
    return ({ OK: 'check', FALLO: 'close', ERROR: 'priority_high', TIEMPO: 'hourglass_bottom' } as Record<string, string>)[c.estado] ?? 'help';
  }

  etiqueta(c: CasoResultado): string {
    return ({ OK: 'Pasó', FALLO: 'Falló', ERROR: 'Error', TIEMPO: 'Tiempo agotado' } as Record<string, string>)[c.estado] ?? c.estado;
  }
}
