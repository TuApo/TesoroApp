import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import { mensajeDeError } from '../../../../../../shared/utils/mensaje-error';
import { confirmar } from '../../components/dialogos/formulario-dialogo';
import { EditorZonas, ZonaBorrador } from '../../components/editor-zonas/editor-zonas';
import { Camara, SentidoLinea } from '../../models/seguridad.models';
import { AccionesSeguridad } from '../../services/acciones.service';
import { SeguridadService } from '../../services/seguridad.service';

/**
 * Zonas y líneas de conteo dibujadas sobre la captura de una cámara. Lo dibujado queda en
 * borrador (marcado "sin guardar") hasta presionar Guardar; así se pueden ajustar varias
 * figuras y guardar todo junto.
 */
@Component({
  selector: 'sg-cfg-zonas',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatTooltipModule, EditorZonas],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="filtros-cfg">
      <label class="sg-campo-nativo camara">Cámara
        <select [ngModel]="camaraId()" (ngModelChange)="elegir($event)">
          <option [ngValue]="null">— Elija una cámara —</option>
          @for (c of camaras(); track c.id) { <option [ngValue]="c.id">{{ c.sede_nombre }} · {{ c.nombre }}</option> }
        </select>
      </label>
      @if (camaraId()) {
        <button type="button" class="sg-boton" (click)="refrescarCaptura()"><mat-icon aria-hidden="true">refresh</mat-icon>Nueva captura</button>
      }
    </div>

    @if (camaraId()) {
      @if (camara() && !camara()!.analitica_activa) {
        <div class="sg-aviso warn"><mat-icon aria-hidden="true">info</mat-icon>
          <span>Esta cámara tiene la analítica IA apagada: las zonas se guardan, pero no cuentan ni disparan reglas hasta encenderla (Configuración → Cámaras).</span></div>
      }
      <div class="zonas-disp">
        <section class="lienzo-zonas">
          <sg-editor-zonas [fondo]="fondo()" [(zonas)]="zonas" [(seleccion)]="seleccion" />
        </section>
        <aside class="sg-tarjeta props">
          <h3><mat-icon aria-hidden="true">tune</mat-icon>Figuras <span class="sg-sub">{{ zonas().length }}</span></h3>
          <ul class="lista-zonas">
            @for (z of zonas(); track $index; let i = $index) {
              <li [class.elegida]="seleccion() === i">
                <button type="button" class="nombre" (click)="seleccion.set(i)">
                  <i class="color" [style.background]="z.color || '#2b59f0'"></i>
                  <span>{{ z.nombre }}</span>
                  <small>{{ z.tipo === 'LINEA' ? 'Línea' : 'Zona' }}@if (z.sucia) { · <b class="sin-guardar">sin guardar</b> }</small>
                </button>
              </li>
            } @empty { <li class="sg-tenue">Dibuje una zona o una línea sobre la imagen.</li> }
          </ul>

          @if (elegida(); as z) {
            <div class="form-zona">
              <label class="sg-campo-nativo">Nombre <input type="text" [ngModel]="z.nombre" (ngModelChange)="cambiar({ nombre: $event })" /></label>
              @if (z.tipo === 'LINEA') {
                <label class="sg-campo-nativo">Qué cruce cuenta como entrada
                  <select [ngModel]="z.sentido" (ngModelChange)="cambiar({ sentido: $event })">
                    <option [ngValue]="'AMBOS'">Ambos sentidos (A↔B)</option>
                    <option [ngValue]="'A_B'">De A hacia B</option>
                    <option [ngValue]="'B_A'">De B hacia A</option>
                  </select>
                </label>
              } @else {
                <label class="sg-campo-nativo">Capacidad (aforo máximo)
                  <input type="number" min="0" [ngModel]="z.capacidad" (ngModelChange)="cambiar({ capacidad: $event === '' || $event === null ? null : +$event })" placeholder="Sin límite" />
                </label>
              }
              <label class="sg-campo-nativo">Color <input type="color" [ngModel]="z.color || '#2b59f0'" (ngModelChange)="cambiar({ color: $event })" /></label>
              <button type="button" class="sg-boton sg-boton--peligro" (click)="borrarElegida()"><mat-icon aria-hidden="true">delete</mat-icon>Borrar figura</button>
            </div>
          }

          @if (error(); as e) { <div class="sg-aviso danger" role="alert"><mat-icon aria-hidden="true">error</mat-icon><span>{{ e }}</span></div> }
          <div class="sg-fila">
            <button type="button" class="sg-boton sg-boton--primario" (click)="guardar()" [disabled]="guardando() || !sucias()">
              <mat-icon aria-hidden="true">save</mat-icon>{{ guardando() ? 'Guardando…' : 'Guardar ' + (sucias() || '') }}
            </button>
            @if (sucias()) { <button type="button" class="sg-boton" (click)="cargarZonas()">Descartar cambios</button> }
          </div>
        </aside>
      </div>
    } @else {
      <div class="sg-tarjeta sg-vacio"><mat-icon aria-hidden="true">pentagon</mat-icon>Elija una cámara para dibujar sus zonas (intrusión, aforo) y sus líneas de conteo (entradas/salidas).</div>
    }
  `,
  styleUrls: ['../../styles/seguridad-comun.css', './configuracion.css'],
})
export class CfgZonas {
  private readonly api = inject(SeguridadService);
  private readonly acciones = inject(AccionesSeguridad);
  private readonly dialog = inject(MatDialog);

  /** Cámara pedida desde otra pestaña (Cámaras → Zonas). */
  readonly camaraInicial = input<string | null>(null);

  readonly camaras = signal<Camara[]>([]);
  readonly camaraId = signal<string | null>(null);
  readonly camara = computed(() => this.camaras().find((c) => c.id === this.camaraId()) ?? null);
  readonly zonas = signal<ZonaBorrador[]>([]);
  readonly seleccion = signal<number | null>(null);
  readonly elegida = computed(() => { const i = this.seleccion(); return i === null ? null : this.zonas()[i] ?? null; });
  readonly sucias = computed(() => this.zonas().filter((z) => z.sucia).length);
  readonly marca = signal(Date.now());
  readonly fondo = computed(() => { const id = this.camaraId(); return id ? `${this.api.urlCaptura(id)}?v=${this.marca()}` : null; });
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    this.api.camaras().subscribe({
      next: (c) => this.camaras.set([...c].sort((a, b) => `${a.sede_nombre} ${a.nombre}`.localeCompare(`${b.sede_nombre} ${b.nombre}`))),
      error: (e) => this.error.set(mensajeDeError(e, 'No se pudieron leer las cámaras.')),
    });
    effect(() => {
      const id = this.camaraInicial();
      untracked(() => { if (id && id !== this.camaraId()) this.elegir(id); });
    });
  }

  elegir(id: string | null): void {
    this.camaraId.set(id);
    this.seleccion.set(null);
    this.zonas.set([]);
    this.marca.set(Date.now());
    if (id) this.cargarZonas();
  }

  refrescarCaptura(): void { this.marca.set(Date.now()); }

  cargarZonas(): void {
    const id = this.camaraId();
    if (!id) return;
    this.error.set(null);
    this.api.zonas(id).subscribe({
      next: (l) => {
        this.zonas.set(l.map((z) => ({ id: z.id, nombre: z.nombre, tipo: z.tipo, puntos: z.puntos, sentido: z.sentido, capacidad: z.capacidad, color: z.color, sucia: false })));
        this.seleccion.set(null);
      },
      error: (e) => this.error.set(mensajeDeError(e, 'No se pudieron leer las zonas.')),
    });
  }

  cambiar(c: Partial<{ nombre: string; sentido: SentidoLinea; capacidad: number | null; color: string }>): void {
    const i = this.seleccion();
    if (i === null) return;
    this.zonas.update((l) => l.map((z, k) => (k === i ? { ...z, ...c, sucia: true } : z)));
  }

  async borrarElegida(): Promise<void> {
    const i = this.seleccion();
    const z = this.elegida();
    if (i === null || !z) return;
    if (z.id) {
      const ok = await confirmar(this.dialog, { titulo: `Borrar "${z.nombre}"`, peligro: true, boton: 'Borrar', texto: 'Las reglas que usan esta zona dejan de funcionar.' });
      if (!ok) return;
      try { await firstValueFrom(this.api.borrarZona(z.id)); }
      catch (e) { this.error.set(mensajeDeError(e, 'No se pudo borrar la zona.')); return; }
    }
    this.zonas.update((l) => l.filter((_, k) => k !== i));
    this.seleccion.set(null);
  }

  async guardar(): Promise<void> {
    const id = this.camaraId();
    if (!id) return;
    const sinNombre = this.zonas().find((z) => !z.nombre.trim());
    if (sinNombre) { this.error.set('Todas las figuras necesitan nombre.'); return; }
    this.guardando.set(true);
    this.error.set(null);
    const l = [...this.zonas()];
    let fallos = 0;
    for (let i = 0; i < l.length; i++) {
      const z = l[i];
      if (!z.sucia) continue;
      try {
        const r = await firstValueFrom(this.api.guardarZona(z.id, {
          camara_id: id, nombre: z.nombre.trim(), tipo: z.tipo, puntos: z.puntos, sentido: z.sentido,
          capacidad: z.tipo === 'ZONA' ? z.capacidad : null, color: z.color,
        }));
        l[i] = { ...z, id: r?.id ?? z.id, sucia: false };
      } catch (e) {
        fallos++;
        this.error.set(mensajeDeError(e, `No se pudo guardar "${z.nombre}".`));
      }
    }
    this.zonas.set(l);
    this.guardando.set(false);
    if (!fallos) this.acciones.aviso('Zonas guardadas.');
  }
}
