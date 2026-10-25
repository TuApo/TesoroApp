import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { ConfigFotos, ModoSubidaFoto, TiendaService } from '../../service/tienda.service';
import { NOMBRE_ANGULO } from './fotos-ia';

/**
 * Cómo trata la tienda las fotos que se suben: tal cual, con mejora básica (luz, color,
 * nitidez en el navegador) o pasando por la IA con su estilo — para que todo el catálogo
 * se vea parejo y con la cara de la marca.
 */
@Component({
  selector: 'app-config-fotos-tienda',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule],
  template: `
    @if (cfg(); as c) {
      <div class="cf">
        <div class="grupo">
          <span class="rotulo">Al subir una foto</span>
          <div class="modos">
            @for (m of modos; track m.codigo) {
              <button type="button" class="modo" [class.activo]="c.modo_subida === m.codigo" (click)="poner('modo_subida', m.codigo)">
                <mat-icon>{{ m.icono }}</mat-icon><b>{{ m.nombre }}</b><small>{{ m.texto }}</small>
              </button>
            }
          </div>
        </div>
        <div class="grupo">
          <span class="rotulo">Estilo de la tienda</span>
          <div class="estilos">
            @for (e of c.estilos ?? []; track e.codigo) {
              <button type="button" class="estilo" [class.activo]="c.estilo === e.codigo" (click)="poner('estilo', e.codigo)">
                <span class="muestra" [attr.data-e]="e.codigo" [style.--marca]="c.color_fondo || '#0b6b58'"><mat-icon>inventory_2</mat-icon></span>
                <b>{{ e.nombre }}</b><small>{{ e.descripcion }}</small>
              </button>
            }
          </div>
        </div>
        <div class="fila">
          <label class="campo color">Color de marca
            <span><input type="color" [ngModel]="c.color_fondo || '#0b6b58'" (ngModelChange)="poner('color_fondo', $event)" />
              <code>{{ c.color_fondo || 'sin color' }}</code></span>
          </label>
          <label class="campo">Calidad
            <select [ngModel]="c.calidad" (ngModelChange)="poner('calidad', $event)">
              <option value="low">Rápida (más barata)</option><option value="medium">Normal</option><option value="high">Alta</option>
            </select>
          </label>
        </div>
        <label class="campo">Instrucciones de marca (se suman al estilo «Estilo de la marca»)
          <textarea rows="2" maxlength="1000" [ngModel]="c.instrucciones_marca ?? ''" (ngModelChange)="poner('instrucciones_marca', $event)"
                    placeholder="Ej.: luz cálida, sombras suaves, fondo verde Flora, sin textos añadidos"></textarea>
        </label>
        <div class="grupo">
          <span class="rotulo">Ángulos que se generan en carga masiva</span>
          <div class="chips">
            @for (a of c.angulos_disponibles ?? []; track a) {
              <button type="button" class="chip" [class.activo]="c.angulos.includes(a)" (click)="alternarAngulo(a)">{{ nombreAngulo(a) }}</button>
            }
          </div>
        </div>
        <label class="casilla"><input type="checkbox" [ngModel]="c.requiere_aprobacion" (ngModelChange)="poner('requiere_aprobacion', $event)" />
          Revisar cada versión antes de publicarla (si no, la vista de frente se publica sola)</label>
        @if (error()) { <div class="msg mal"><mat-icon>error</mat-icon> {{ error() }}</div> }
        @if (aviso()) { <div class="msg bien"><mat-icon>check_circle</mat-icon> {{ aviso() }}</div> }
        <div class="pie">
          @if (c.actualizado_por) { <span class="nota">Último cambio: {{ c.actualizado_por }}</span> }
          <button type="button" class="boton" [disabled]="guardando()" (click)="guardar()">{{ guardando() ? 'Guardando…' : 'Guardar estilo' }}</button>
        </div>
      </div>
    } @else if (error()) {
      <div class="msg mal"><mat-icon>lock</mat-icon> {{ error() }}</div>
    } @else { <p class="nota">Cargando…</p> }
  `,
  styleUrls: ['../../styles/tienda-comun.css', './fotos-ia.css'],
})
export class ConfigFotosTienda {
  private api = inject(TiendaService);
  readonly tiendaId = input.required<string>();
  readonly guardada = output<ConfigFotos>();

  readonly cfg = signal<ConfigFotos | null>(null);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  readonly modos: { codigo: ModoSubidaFoto; nombre: string; texto: string; icono: string }[] = [
    { codigo: 'NORMAL', nombre: 'Tal cual', texto: 'Se publica la foto como llega.', icono: 'image' },
    { codigo: 'MEJORA_BASICA', nombre: 'Mejora básica', texto: 'Luz, color y nitidez, sin tocar el producto.', icono: 'tune' },
    { codigo: 'IA', nombre: 'Con IA', texto: 'Versiones con el estilo de la tienda, desde varios ángulos.', icono: 'auto_awesome' },
  ];

  constructor() {
    effect(() => { const t = this.tiendaId(); untracked(() => this.cargar(t)); });
  }

  async cargar(t: string): Promise<void> {
    this.cfg.set(null); this.error.set(null);
    try { this.cfg.set(await firstValueFrom(this.api.configFotos(t))); }
    catch (e: any) { this.error.set(e?.status === 403 ? 'Solo quien administra la tienda cambia el estilo de fotos.' : 'No se pudo leer la configuración.'); }
  }

  poner<K extends keyof ConfigFotos>(k: K, v: ConfigFotos[K]): void {
    this.aviso.set(null);
    this.cfg.update(c => c ? { ...c, [k]: v } : c);
  }

  alternarAngulo(a: string): void {
    const c = this.cfg(); if (!c) return;
    this.poner('angulos', c.angulos.includes(a) ? c.angulos.filter(x => x !== a) : [...c.angulos, a]);
  }

  nombreAngulo(a: string): string { return NOMBRE_ANGULO[a] ?? a; }

  async guardar(): Promise<void> {
    const c = this.cfg(); if (!c) return;
    this.guardando.set(true); this.error.set(null);
    try {
      const r = await firstValueFrom(this.api.guardarConfigFotos(this.tiendaId(), {
        modo_subida: c.modo_subida, estilo: c.estilo, color_fondo: c.color_fondo, instrucciones_marca: c.instrucciones_marca,
        angulos: c.angulos, requiere_aprobacion: c.requiere_aprobacion, calidad: c.calidad,
      }));
      this.cfg.set(r); this.aviso.set('Estilo de fotos guardado.'); this.guardada.emit(r);
    } catch (e: any) { this.error.set(e?.error?.error ?? e?.error?.message ?? 'No se pudo guardar'); }
    finally { this.guardando.set(false); }
  }
}
