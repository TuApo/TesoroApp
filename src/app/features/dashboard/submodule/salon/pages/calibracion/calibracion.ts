import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { forkJoin } from 'rxjs';

import { EditorPoligono } from '../../components/editor-poligono';
import { SalonEncabezado } from '../../components/salon-encabezado';
import { Camara, Mesa, Poligono, PoligonoMesa, Salon } from '../../models/salon.models';
import { SALON_CONTEXTO, permisosDeContexto } from '../../services/salon-contexto.token';
import { SalonService, mensajeError } from '../../services/salon.service';

/**
 * Calibración (§4.2): se elige una cámara, se ve su último fotograma y, mesa por mesa, se
 * dibuja el polígono (y la zona del personal) sobre la imagen. «Proponer automáticamente»
 * pide al worker las mesas que YOLO ve en el cuadro; el dueño valida y guarda.
 */
@Component({
  selector: 'app-salon-calibracion',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, SalonEncabezado, EditorPoligono],
  styleUrls: ['../../salon-comun.css'],
  template: `
    <div class="sl-pagina">
      <app-salon-encabezado subtitulo="Dibuja cada mesa sobre la imagen de la cámara" />

      @if (!ctx.tiendaId()) {
        <div class="sl-panel sl-vacio"><mat-icon>storefront</mat-icon><strong>Elige una sede.</strong></div>
      } @else if (!permisos.puedeAdministrar()) {
        <div class="sl-panel sl-vacio"><mat-icon>lock</mat-icon><strong>Solo el administrador de la sede calibra las cámaras.</strong></div>
      } @else {
        @if (error(); as e) { <div class="sl-aviso sl-tono-danger" role="alert"><mat-icon>cloud_off</mat-icon>{{ e }}<button type="button" class="sl-btn sl-btn--chico" (click)="cargar()">Reintentar</button></div> }

        <section class="sl-panel sl-fila cal-barra">
          <label class="sl-campo cal-campo"><span>Cámara</span>
            <select class="sl-select" [value]="camaraId() ?? ''" (change)="elegirCamara($any($event.target).value)">
              <option value="">Elige…</option>
              @for (c of camaras(); track c.id) { <option [value]="c.id">{{ c.nombre }} · {{ c.estado_salud ?? 'sin latido' }} · {{ c.mesas_calibradas }} mesas</option> }
            </select>
          </label>
          <label class="sl-campo cal-campo"><span>Mesa</span>
            <select class="sl-select" [value]="mesaId() ?? ''" (change)="elegirMesa($any($event.target).value)" [disabled]="!camaraId()">
              <option value="">Elige…</option>
              @for (m of mesas(); track m.id) {
                <option [value]="m.id">{{ m.salon_nombre }} › {{ m.nombre }}{{ poligonoDe(m.id) ? ' ✓' : '' }}{{ m.camara_id && m.camara_id !== camaraId() ? ' (otra cámara)' : '' }}</option>
              }
            </select>
          </label>
          <span class="sl-esp"></span>
          <button type="button" class="sl-btn" (click)="cargarFotograma()" [disabled]="!camaraId() || cargandoFoto()" title="Pedir el último cuadro al worker"><mat-icon>photo_camera</mat-icon>Nuevo fotograma</button>
          <button type="button" class="sl-btn sl-btn--primario" (click)="guardar()" [disabled]="!puedeGuardar() || guardando()"><mat-icon>save</mat-icon>Guardar polígono</button>
        </section>

        @if (!camaraId()) {
          <div class="sl-panel sl-vacio"><mat-icon>videocam</mat-icon><strong>Elige una cámara para empezar.</strong>
            @if (!camaras().length && !cargando()) { <span class="sl-muted">No hay cámaras: créalas en Configuración › Cámaras.</span> }
          </div>
        } @else {
          <section class="sl-panel">
            @if (!mesaId()) { <div class="sl-aviso sl-tono-info"><mat-icon>info</mat-icon>Elige la mesa que vas a dibujar. Las ya calibradas se ven en gris de fondo.</div> }
            <app-editor-poligono #editor [imagenUrl]="fotoUrl()" [otros]="otros()" [puedeProponer]="!!fotoUrl() && !proponiendo()"
              [(poligono)]="poligono" [(zonaPersonal)]="zonaPersonal" (proponer)="proponer()" />
            @if (propuestas().length) {
              <div class="cal-propuestas">
                <strong>Propuestas de la visión:</strong>
                @for (p of propuestas(); track $index) {
                  <button type="button" class="sl-btn sl-btn--chico" (click)="aplicarPropuesta(p.poligono)"><mat-icon>auto_awesome</mat-icon>Mesa {{ $index + 1 }} · {{ (p.confianza * 100).toFixed(0) }} %</button>
                }
              </div>
            }
          </section>

          <section class="sl-panel">
            <h3><mat-icon>checklist</mat-icon>Mesas calibradas en esta cámara</h3>
            @if (!poligonos().length) { <div class="sl-muted">Ninguna todavía.</div> }
            @else {
              <div class="cal-lista">
                @for (p of poligonos(); track p.mesa_id) {
                  <button type="button" class="sl-chip sl-tono-ok cal-chip" (click)="elegirMesa(p.mesa_id)"><mat-icon>check</mat-icon>{{ p.mesa_nombre }} · v{{ p.version }}{{ p.zona_personal ? ' · personal' : '' }}</button>
                }
              </div>
            }
          </section>
        }
      }
    </div>
  `,
  styles: [`
    .cal-barra { align-items: end; }
    .cal-campo { min-width: 220px; flex: 1; }
    .cal-propuestas { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 10px; }
    .cal-lista { display: flex; flex-wrap: wrap; gap: 6px; }
    .cal-chip { cursor: pointer; }
  `],
})
export class SalonCalibracionPage implements OnDestroy {
  readonly ctx = inject(SALON_CONTEXTO);
  readonly permisos = permisosDeContexto(this.ctx);
  private api = inject(SalonService);
  private snack = inject(MatSnackBar);
  private editor = viewChild<EditorPoligono>('editor');

  readonly camaras = signal<Camara[]>([]);
  readonly mesas = signal<Array<Mesa & { salon_nombre: string }>>([]);
  readonly poligonos = signal<PoligonoMesa[]>([]);
  readonly camaraId = signal<string | null>(null);
  readonly mesaId = signal<string | null>(null);
  readonly fotoUrl = signal<string | null>(null);
  readonly propuestas = signal<Array<{ poligono: Poligono; confianza: number }>>([]);
  readonly poligono = signal<Poligono>([]);
  readonly zonaPersonal = signal<Poligono | null>(null);
  readonly cargando = signal(false);
  readonly cargandoFoto = signal(false);
  readonly proponiendo = signal(false);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);

  readonly otros = computed(() => this.poligonos().filter(p => p.mesa_id !== this.mesaId()).map(p => ({ nombre: p.mesa_nombre, poligono: p.poligono })));
  readonly puedeGuardar = computed(() => !!this.mesaId() && !!this.camaraId() && this.poligono().length >= 3 && (this.zonaPersonal() === null || this.zonaPersonal()!.length >= 3));

  constructor() {
    effect(() => { if (this.ctx.tiendaId()) this.cargar(); });
  }
  ngOnDestroy(): void { this.soltarFoto(); }

  cargar(): void {
    const id = this.ctx.tiendaId();
    if (!id) return;
    this.cargando.set(true);
    this.error.set(null);
    forkJoin({ camaras: this.api.camaras(id), salones: this.api.salones(id) }).subscribe({
      next: ({ camaras, salones }) => {
        this.camaras.set(camaras);
        this.cargarMesas(salones);
        this.cargando.set(false);
        if (camaras.length === 1 && !this.camaraId()) this.elegirCamara(camaras[0].id);
      },
      error: e => { this.error.set(mensajeError(e, 'No se pudieron cargar las cámaras')); this.cargando.set(false); },
    });
  }
  private cargarMesas(salones: Salon[]): void {
    if (!salones.length) { this.mesas.set([]); return; }
    forkJoin(salones.map(s => this.api.mesas(s.id))).subscribe({
      next: listas => this.mesas.set(listas.flatMap((l, i) => l.filter(m => m.activa).map(m => ({ ...m, salon_nombre: salones[i].nombre })))),
      error: () => { /* el selector de mesas queda vacío; el aviso de cámaras ya lo dice */ },
    });
  }

  elegirCamara(id: string): void {
    this.camaraId.set(id || null);
    this.mesaId.set(null);
    this.propuestas.set([]);
    this.poligono.set([]);
    this.zonaPersonal.set(null);
    this.poligonos.set([]);
    this.soltarFoto();
    if (!id) return;
    this.api.poligonos(id).subscribe({ next: p => this.poligonos.set(p), error: e => this.snack.open(mensajeError(e, 'No se pudieron leer los polígonos'), 'OK', { duration: 4000 }) });
    this.cargarFotograma();
  }

  elegirMesa(id: string): void {
    this.mesaId.set(id || null);
    const p = this.poligonoDe(id);
    this.editor()?.cargar(p?.poligono ?? [], p?.zona_personal ?? null);
    if (!this.editor()) { this.poligono.set(p?.poligono ?? []); this.zonaPersonal.set(p?.zona_personal ?? null); }
  }

  poligonoDe(mesaId: string): PoligonoMesa | undefined { return this.poligonos().find(p => p.mesa_id === mesaId); }

  cargarFotograma(): void {
    const id = this.camaraId();
    if (!id) return;
    this.cargandoFoto.set(true);
    this.api.fotograma(id).subscribe({
      next: blob => { this.soltarFoto(); this.fotoUrl.set(URL.createObjectURL(blob)); this.cargandoFoto.set(false); },
      error: e => { this.cargandoFoto.set(false); this.soltarFoto(); this.snack.open(mensajeError(e, 'La cámara no entregó fotograma'), 'OK', { duration: 5000 }); },
    });
  }
  private soltarFoto(): void {
    const u = this.fotoUrl();
    if (u) { try { URL.revokeObjectURL(u); } catch { /* nada */ } }
    this.fotoUrl.set(null);
  }

  proponer(): void {
    const id = this.camaraId();
    if (!id) return;
    this.proponiendo.set(true);
    this.api.proponerPoligonos(id).subscribe({
      next: r => {
        this.proponiendo.set(false);
        this.propuestas.set(r.propuestas ?? []);
        if (!r.propuestas?.length) this.snack.open('La visión no encontró mesas en el cuadro actual', 'OK', { duration: 4000 });
      },
      error: e => { this.proponiendo.set(false); this.snack.open(mensajeError(e, 'No se pudo pedir la propuesta'), 'OK', { duration: 5000 }); },
    });
  }
  aplicarPropuesta(p: Poligono): void {
    if (!this.mesaId()) { this.snack.open('Elige primero la mesa a la que va esta propuesta', 'OK', { duration: 3500 }); return; }
    this.editor()?.aplicarPropuesta(p);
  }

  guardar(): void {
    const mesa = this.mesaId(), camara = this.camaraId();
    if (!mesa || !camara || !this.puedeGuardar()) return;
    this.guardando.set(true);
    this.api.guardarPoligono(mesa, { camara_id: camara, poligono: this.poligono(), zona_personal: this.zonaPersonal() }).subscribe({
      next: guardado => {
        this.guardando.set(false);
        this.poligonos.update(l => [...l.filter(p => p.mesa_id !== mesa), guardado]);
        this.mesas.update(l => l.map(m => (m.id === mesa ? { ...m, camara_id: camara, tiene_poligono: true } : m)));
        this.snack.open(`Polígono de ${guardado.mesa_nombre} guardado (v${guardado.version})`, 'OK', { duration: 3000 });
      },
      error: e => { this.guardando.set(false); this.snack.open(mensajeError(e), 'OK', { duration: 5000 }); },
    });
  }
}
