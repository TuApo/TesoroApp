import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

import { leerPisos } from '../../components/croquis-svg/croquis-svg';
import { Area, Croquis, ElementoCroquis, Oficina, PisoCroquis, TurnosService } from '../../service/turnos.service';
import { EndpointMon, MonitoreoService } from '../../../activos-monitoreo/monitoreo.service';
import type { EscenaOficina, Equipo3D } from './escena-3d';

type Seleccion = { tipo: 'elemento' | 'area' | 'equipo'; id: string } | null;

/** Objeto de oficina listo para soltar en el plano. Un `modelo` (glTF/GLB público) o un primitivo. */
interface ObjetoCatalogo {
  clave: string; nombre: string; icono: string;
  tipo: ElementoCroquis['tipo']; anchoM: number; profM: number; alto3d: number;
  modelo?: string; // URL glTF/GLB (API pública CC0); vacío = primitivo
}

const CATALOGO: ObjetoCatalogo[] = [
  { clave: 'escritorio', nombre: 'Escritorio', icono: 'desk', tipo: 'MESA', anchoM: 1.6, profM: 0.8, alto3d: 0.75 },
  { clave: 'mostrador', nombre: 'Mostrador', icono: 'countertops', tipo: 'MOSTRADOR', anchoM: 2.4, profM: 0.7, alto3d: 1.1 },
  { clave: 'silla', nombre: 'Silla', icono: 'chair', tipo: 'SILLA', anchoM: 0.55, profM: 0.55, alto3d: 0.95 },
  { clave: 'planta', nombre: 'Planta', icono: 'potted_plant', tipo: 'PLANTA', anchoM: 0.6, profM: 0.6, alto3d: 1.1 },
  { clave: 'pared', nombre: 'Pared', icono: 'square_foot', tipo: 'PARED', anchoM: 4, profM: 0.2, alto3d: 2.5 },
  { clave: 'equipo', nombre: 'Equipo (computador)', icono: 'computer', tipo: 'EQUIPO', anchoM: 0.7, profM: 0.6, alto3d: 0.5 },
  { clave: 'modelo', nombre: 'Objeto por URL (glTF/GLB)', icono: 'view_in_ar', tipo: 'MODELO3D', anchoM: 1, profM: 1, alto3d: 1 },
];

/**
 * Vista 3D de la oficina. Lee el mismo croquis que el editor 2D (áreas + elementos_json por piso) y
 * lo levanta en 3D con three.js (cargado dinámicamente para no engordar el bundle). Añade objetos de
 * oficina, coloca cámaras y muestra su perspectiva en un previsualizador, y pinta los equipos
 * (computadores/activos) coloreados por estado. No reemplaza al 2D: es un modo paralelo (se guarda en
 * el mismo elementos_json, formato v3, que el backend conserva sin interpretar).
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-oficina-3d',
  imports: [CommonModule, FormsModule, MatIconModule],
  template: `
    <div class="o3d">
      <header class="o3d__barra">
        <button class="btn btn--plano" (click)="volver2D()" title="Volver al plano 2D">
          <mat-icon>grid_on</mat-icon><span>Plano 2D</span>
        </button>
        <h2>{{ oficina()?.nombre || 'Oficina' }} · 3D</h2>

        @if (pisos().length > 1) {
          <div class="o3d__pisos">
            @for (p of pisos(); track p.id) {
              <button class="chip" [class.chip--on]="p.id === pisoId()" (click)="irAPiso(p.id)">{{ p.nombre }}</button>
            }
          </div>
        }

        <div class="o3d__modo">
          <button class="chip" [class.chip--on]="modo() === 'orbitar'" (click)="setModo('orbitar')" title="Orbitar la cámara">
            <mat-icon>3d_rotation</mat-icon>
          </button>
          <button class="chip" [class.chip--on]="modo() === 'mover'" (click)="setModo('mover')" title="Mover objetos sobre el suelo">
            <mat-icon>open_with</mat-icon>
          </button>
        </div>

        <div class="o3d__catalogo">
          <button class="btn" (click)="abrirCatalogo.set(!abrirCatalogo())" title="Agregar objeto">
            <mat-icon>add_box</mat-icon><span>Objeto</span>
          </button>
          @if (abrirCatalogo()) {
            <div class="menu">
              @for (o of catalogo; track o.clave) {
                <button (click)="agregar(o)"><mat-icon>{{ o.icono }}</mat-icon> {{ o.nombre }}</button>
              }
            </div>
          }
        </div>
        <button class="btn" (click)="agregarCamara()" title="Agregar cámara"><mat-icon>videocam</mat-icon><span>Cámara</span></button>

        <span class="o3d__flex"></span>
        @if (sucio()) { <span class="o3d__sucio">Sin guardar</span> }
        <button class="btn btn--guardar" [disabled]="ocupado() || !sucio()" (click)="guardar()">
          <mat-icon>save</mat-icon><span>Guardar</span>
        </button>
      </header>

      @if (error()) { <div class="o3d__error">{{ error() }}</div> }

      <div class="o3d__cuerpo">
        <div #lienzo class="o3d__lienzo" [class.o3d__lienzo--mover]="modo() === 'mover'">
          @if (cargando()) { <div class="o3d__cargando"><mat-icon class="girar">progress_activity</mat-icon> Cargando plano 3D…</div> }
        </div>

        @if (elementoSel(); as el) {
          <aside class="o3d__panel">
            <div class="o3d__panel-cab">
              <mat-icon>{{ el.tipo === 'CAMARA' ? 'videocam' : 'tune' }}</mat-icon>
              <strong>{{ nombreTipo(el.tipo) }}</strong>
              <button class="x" (click)="quitar(el.id)" title="Quitar"><mat-icon>delete</mat-icon></button>
            </div>

            @if (el.tipo === 'CAMARA') {
              <div class="o3d__preview">
                <canvas #preview></canvas>
                <span class="o3d__preview-cap">Perspectiva de la cámara</span>
              </div>
              <label>Giro (°)
                <input type="range" min="-180" max="180" step="5" [ngModel]="el.rotacion || 0" (ngModelChange)="patch(el.id, { rotacion: +$event })">
                <b>{{ el.rotacion || 0 }}</b>
              </label>
              <label>Inclinación (°)
                <input type="range" min="-80" max="30" step="5" [ngModel]="el.inclinacion ?? -10" (ngModelChange)="patch(el.id, { inclinacion: +$event })">
                <b>{{ el.inclinacion ?? -10 }}</b>
              </label>
              <label>Altura (m)
                <input type="range" min="1" max="5" step="0.1" [ngModel]="el.z ?? 2.4" (ngModelChange)="patch(el.id, { z: +$event })">
                <b>{{ (el.z ?? 2.4).toFixed(1) }}</b>
              </label>
              <label>Apertura FOV (°)
                <input type="range" min="30" max="120" step="5" [ngModel]="el.fov ?? 70" (ngModelChange)="patch(el.id, { fov: +$event })">
                <b>{{ el.fov ?? 70 }}</b>
              </label>
              <label>Alcance (m)
                <input type="range" min="2" max="20" step="1" [ngModel]="el.alcance ?? 8" (ngModelChange)="patch(el.id, { alcance: +$event })">
                <b>{{ el.alcance ?? 8 }}</b>
              </label>
            } @else if (el.tipo === 'EQUIPO') {
              <label class="col">Equipo ligado
                <select [ngModel]="el.ref || ''" (ngModelChange)="patch(el.id, { ref: $event })">
                  <option value="">— Sin ligar —</option>
                  @for (ep of endpointsMon(); track ep.id) {
                    <option [value]="ep.id">{{ ep.hostname || ep.machineUid }} · {{ ep.estado }}</option>
                  }
                </select>
              </label>
              <p class="o3d__ayuda">El color del equipo refleja su estado en vivo (verde = encendido, gris = apagado).</p>
              <label>Giro (°)
                <input type="range" min="-180" max="180" step="5" [ngModel]="el.rotacion || 0" (ngModelChange)="patch(el.id, { rotacion: +$event })">
                <b>{{ el.rotacion || 0 }}</b>
              </label>
            } @else {
              <label>Giro (°)
                <input type="range" min="-180" max="180" step="5" [ngModel]="el.rotacion || 0" (ngModelChange)="patch(el.id, { rotacion: +$event })">
                <b>{{ el.rotacion || 0 }}</b>
              </label>
              <label>Altura (m)
                <input type="range" min="0.1" max="4" step="0.1" [ngModel]="el.alto3d ?? 1" (ngModelChange)="patch(el.id, { alto3d: +$event })">
                <b>{{ (el.alto3d ?? 1).toFixed(1) }}</b>
              </label>
              @if (el.tipo === 'MODELO3D') {
                <label class="col">URL del modelo (glTF/GLB público)
                  <input type="text" [ngModel]="el.modelo || ''" (ngModelChange)="patch(el.id, { modelo: $event })" placeholder="https://…/modelo.glb">
                </label>
                <p class="o3d__ayuda">Pega una URL CC0 (Poly Pizza, Kenney…). Debe permitir CORS; si no, súbela a Documentos y usa esa URL.</p>
              }
            }
          </aside>
        } @else if (seleccion()?.tipo === 'equipo') {
          <aside class="o3d__panel">
            <div class="o3d__panel-cab"><mat-icon>computer</mat-icon><strong>Equipo</strong></div>
            <p>{{ equipoSel()?.nombre }} · {{ equipoSel()?.tipo }}</p>
            <p>Estado: <b>{{ equipoSel()?.estado }}</b></p>
            <p class="o3d__ayuda">El inventario y el estado vienen del módulo de Activos (agente del equipo).</p>
          </aside>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .o3d { display: flex; flex-direction: column; height: 100%; min-height: 70vh; color: var(--text, #0f1b2d); }
    .o3d__barra { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px 12px; border-bottom: 1px solid var(--border, #e2e8f0); background: var(--surface, #fff); }
    .o3d__barra h2 { font-size: 15px; margin: 0 8px 0 0; font-weight: 800; }
    .o3d__flex { flex: 1; }
    .o3d__pisos, .o3d__modo, .o3d__catalogo { display: flex; gap: 4px; position: relative; }
    .chip { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--border, #cbd5e1); background: transparent; color: inherit; border-radius: 999px; padding: 5px 12px; min-height: 40px; cursor: pointer; font-weight: 700; font-size: 13px; }
    .chip--on { background: var(--brand-blue, #2b59f0); color: #fff; border-color: transparent; }
    .chip mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border, #cbd5e1); background: var(--surface, #fff); color: inherit; border-radius: 10px; padding: 6px 12px; min-height: 40px; cursor: pointer; font-weight: 700; font-size: 13px; }
    .btn--plano { background: var(--muted, #f1f5f9); }
    .btn--guardar { background: var(--brand-blue, #2b59f0); color: #fff; border-color: transparent; }
    .btn:disabled { opacity: .5; cursor: default; }
    .btn mat-icon, .x mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .menu { position: absolute; top: 46px; left: 0; z-index: 20; background: var(--surface, #fff); border: 1px solid var(--border, #e2e8f0); border-radius: 12px; box-shadow: 0 10px 30px rgba(15,27,45,.18); padding: 6px; min-width: 240px; }
    .menu button { display: flex; align-items: center; gap: 10px; width: 100%; border: 0; background: transparent; color: inherit; padding: 9px 10px; border-radius: 8px; cursor: pointer; font-size: 14px; text-align: left; }
    .menu button:hover { background: var(--muted, #f1f5f9); }
    .o3d__sucio { font-size: 12px; color: #b45309; font-weight: 700; }
    .o3d__error { padding: 8px 14px; background: #fee2e2; color: #991b1b; font-size: 13px; }
    .o3d__cuerpo { display: flex; flex: 1; min-height: 0; }
    .o3d__lienzo { position: relative; flex: 1; min-height: 0; background: linear-gradient(180deg, #eef2f8, #dfe6ef); }
    .o3d__lienzo--mover { cursor: move; }
    .o3d__cargando { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 8px; color: #475569; font-weight: 700; }
    .girar { animation: o3dgira 1s linear infinite; } @keyframes o3dgira { to { transform: rotate(360deg); } }
    .o3d__panel { width: 300px; border-left: 1px solid var(--border, #e2e8f0); background: var(--surface, #fff); padding: 12px; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
    .o3d__panel-cab { display: flex; align-items: center; gap: 8px; font-size: 14px; }
    .o3d__panel-cab .x { margin-left: auto; border: 0; background: transparent; color: #ef4444; cursor: pointer; }
    .o3d__panel label { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 6px 10px; font-size: 12px; font-weight: 700; color: #475569; }
    .o3d__panel label.col { grid-template-columns: 1fr; }
    .o3d__panel label input[type=range] { grid-column: 1 / 2; width: 100%; }
    .o3d__panel label b { font-variant-numeric: tabular-nums; color: var(--text, #0f1b2d); }
    .o3d__panel input[type=text] { grid-column: 1 / -1; width: 100%; padding: 7px 9px; border: 1px solid var(--border, #cbd5e1); border-radius: 8px; font-size: 13px; }
    .o3d__preview { border: 1px solid var(--border, #e2e8f0); border-radius: 10px; overflow: hidden; background: #0f172a; }
    .o3d__preview canvas { width: 100%; aspect-ratio: 16 / 9; display: block; }
    .o3d__preview-cap { display: block; font-size: 11px; color: #64748b; padding: 4px 8px; background: var(--muted, #f1f5f9); }
    .o3d__ayuda { font-size: 11px; color: #64748b; margin: 0; }
    @media (max-width: 900px) { .o3d__panel { width: 100%; position: absolute; right: 0; top: 0; bottom: 0; max-width: 320px; box-shadow: -8px 0 24px rgba(15,27,45,.12); } }
  `],
})
export class Oficina3D implements OnInit {
  private readonly api = inject(TurnosService);
  private readonly monitoreo = inject(MonitoreoService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly id = input.required<string>();

  private readonly lienzo = viewChild<ElementRef<HTMLElement>>('lienzo');
  private readonly preview = viewChild<ElementRef<HTMLCanvasElement>>('preview');

  readonly catalogo = CATALOGO;
  readonly oficina = signal<Oficina | null>(null);
  readonly croquis = signal<Croquis | null>(null);
  readonly pisos = signal<PisoCroquis[]>([]);
  readonly pisoId = signal<string | null>(null);
  readonly areas = signal<Area[]>([]);
  readonly equipos = signal<Equipo3D[]>([]);
  readonly seleccion = signal<Seleccion>(null);
  readonly endpointsMon = signal<EndpointMon[]>([]);
  readonly modo = signal<'orbitar' | 'mover'>('orbitar');
  readonly cargando = signal(true);
  readonly ocupado = signal(false);
  readonly sucio = signal(false);
  readonly error = signal<string | null>(null);
  readonly abrirCatalogo = signal(false);

  private escena: EscenaOficina | null = null;
  private viewListo = false;

  readonly pisoActual = computed(() => this.pisos().find(p => p.id === this.pisoId()) ?? this.pisos()[0] ?? null);
  readonly elementoSel = computed<ElementoCroquis | null>(() => {
    const s = this.seleccion();
    if (s?.tipo !== 'elemento') return null;
    return this.pisoActual()?.elementos.find(e => e.id === s.id) ?? null;
  });
  readonly equipoSel = computed(() => {
    const s = this.seleccion();
    return s?.tipo === 'equipo' ? this.equipos().find(e => e.id === s.id) ?? null : null;
  });

  constructor() {
    // El rearmado de la escena es explícito (irAPiso / insertar / quitar), NO por effect: editar un
    // parámetro con un slider muta `pisos` y un effect reconstruiría toda la escena en cada tick.
    this.destroyRef.onDestroy(() => this.escena?.destruir());
    // El <canvas> del previsualizador vive dentro de un @if (solo con cámara seleccionada): cuando
    // aparece en el DOM, lo enganchamos a la escena. Este effect solo reacciona al viewChild.
    effect(() => {
      const c = this.preview()?.nativeElement;
      if (c && this.escena) this.escena.usarPreview(c);
    });
  }

  ngOnInit(): void {
    this.api.oficina(this.id()).subscribe({ next: o => this.oficina.set(o), error: () => {} });
    this.api.croquis(this.id(), true).subscribe({
      next: c => { this.aplicar(c); this.cargando.set(false); this.intentarIniciar(); },
      error: e => { this.error.set(e?.error?.message || 'No se pudo cargar el plano'); this.cargando.set(false); },
    });
  }

  ngAfterViewInit(): void { this.viewListo = true; this.intentarIniciar(); }

  private aplicar(c: Croquis | null): void {
    this.croquis.set(c);
    const pisos = leerPisos(c);
    this.pisos.set(pisos);
    this.areas.set((c?.areas ?? []).map(a => ({ ...a })));
    if (!this.pisoId() || !pisos.some(p => p.id === this.pisoId())) this.pisoId.set(pisos[0]?.id ?? null);
  }

  private async intentarIniciar(): Promise<void> {
    if (this.escena || !this.viewListo || this.cargando()) return;
    const host = this.lienzo()?.nativeElement;
    if (!host) return;
    const { EscenaOficina } = await import('./escena-3d');
    const escala = Number(this.croquis()?.escala_cm_px) || 2;
    this.escena = new EscenaOficina(host, this.preview()?.nativeElement ?? null, escala);
    this.escena.onSeleccion = sel => { this.seleccion.set(sel); this.sincronizarResaltado(); };
    this.escena.onCambio = (id, p) => this.patch(id, p, true);
    const ro = new ResizeObserver(() => this.escena?.redimensionar());
    ro.observe(host);
    this.destroyRef.onDestroy(() => ro.disconnect());
    // Primera carga del piso vigente.
    const piso = this.pisoActual();
    if (piso) {
      const primero = this.pisos()[0]?.id === piso.id;
      this.escena.cargar(piso, this.areas().filter(a => a.piso === piso.id || (!a.piso && primero)), this.equipos());
    }
    // Estado en vivo de los equipos, refrescado cada 30 s.
    this.cargarEndpoints();
    const t = setInterval(() => this.cargarEndpoints(), 30_000);
    this.destroyRef.onDestroy(() => clearInterval(t));
  }

  /** Trae los endpoints, colorea los objetos EQUIPO por su estado y repinta. */
  private cargarEndpoints(): void {
    this.monitoreo.endpoints().subscribe({
      next: lista => {
        this.endpointsMon.set(lista);
        const mapa = new Map<string, string>(lista.map(e => [String(e.id), e.estado]));
        this.escena?.setEstados(mapa);
        if (this.pisos().some(p => p.elementos.some(el => el.tipo === 'EQUIPO'))) this.recargarEscena();
      },
      error: () => { /* ms-assets puede no estar desplegado aún: el 3D funciona igual */ },
    });
  }

  private sincronizarResaltado(): void {
    const el = this.elementoSel();
    this.escena?.resaltarCamara(el && el.tipo === 'CAMARA' ? el : null);
  }

  // ── Edición ───────────────────────────────────────────────────────────

  irAPiso(id: string): void { this.pisoId.set(id); this.seleccion.set(null); this.recargarEscena(true); }
  setModo(m: 'orbitar' | 'mover'): void { this.modo.set(m); this.escena?.setModo(m); }

  /** Aplica un parche a un elemento del piso actual. `desdeEscena` evita reescribir lo que ya movió la escena. */
  patch(id: string, p: Partial<ElementoCroquis>, desdeEscena = false): void {
    this.pisos.update(lista => lista.map(piso => piso.id !== this.pisoActual()?.id ? piso
      : { ...piso, elementos: piso.elementos.map(e => e.id === id ? { ...e, ...p } : e) }));
    this.sucio.set(true);
    if (desdeEscena) return; // la escena ya aplicó el movimiento (arrastre); solo persistimos el dato
    // Cambios de tamaño/modelo/cantidad necesitan reconstruir la malla; los demás se ajustan en vivo.
    const visual = 'alto3d' in p || 'modelo' in p || 'cantidad' in p || 'ref' in p;
    if (visual) { this.recargarEscena(); }
    else { this.escena?.actualizarElemento(id, p); }
    const el = this.elementoSel();
    if (el && el.tipo === 'CAMARA') this.escena?.resaltarCamara(el);
  }

  agregar(o: ObjetoCatalogo): void {
    this.abrirCatalogo.set(false);
    const piso = this.pisoActual(); if (!piso) return;
    const escala = Number(this.croquis()?.escala_cm_px) || 2;
    const px = (m: number) => Math.round((m * 100) / escala);
    const el: ElementoCroquis = {
      id: crypto.randomUUID(), tipo: o.tipo,
      x: Math.round(piso.ancho / 2 - px(o.anchoM) / 2), y: Math.round(piso.alto / 2 - px(o.profM) / 2),
      ancho: px(o.anchoM), alto: px(o.profM), rotacion: 0, alto3d: o.alto3d,
      cantidad: o.tipo === 'SILLA' ? 1 : undefined, modelo: o.modelo,
      icono: o.tipo === 'MODELO3D' ? o.icono : undefined,
    };
    this.insertar(el);
  }

  agregarCamara(): void {
    const piso = this.pisoActual(); if (!piso) return;
    const el: ElementoCroquis = {
      id: crypto.randomUUID(), tipo: 'CAMARA',
      x: Math.round(piso.ancho / 2), y: Math.round(piso.alto / 2), ancho: 16, alto: 16,
      rotacion: 0, inclinacion: -10, z: 2.4, fov: 70, alcance: 8, color: '#f59e0b',
    };
    this.insertar(el);
  }

  private insertar(el: ElementoCroquis): void {
    const idPiso = this.pisoActual()?.id;
    this.pisos.update(lista => lista.map(p => p.id === idPiso ? { ...p, elementos: [...p.elementos, el] } : p));
    this.sucio.set(true);
    this.seleccion.set({ tipo: 'elemento', id: el.id });
    // Rehacer la escena (el effect del piso no se dispara por mutar elementos → forzamos recarga).
    this.recargarEscena();
    this.sincronizarResaltado();
  }

  quitar(id: string): void {
    const idPiso = this.pisoActual()?.id;
    this.pisos.update(lista => lista.map(p => p.id === idPiso ? { ...p, elementos: p.elementos.filter(e => e.id !== id) } : p));
    this.seleccion.set(null);
    this.sucio.set(true);
    this.recargarEscena();
  }

  private recargarEscena(reencuadrar = false): void {
    const piso = this.pisoActual(); if (!this.escena || !piso) return;
    const primero = this.pisos()[0]?.id === piso.id;
    this.escena.cargar(piso, this.areas().filter(a => a.piso === piso.id || (!a.piso && primero)),
      this.equipos().filter(q => (q.piso ?? null) === piso.id || (!q.piso && primero)), reencuadrar);
    if (this.seleccion()?.tipo === 'elemento') this.escena.seleccionar(this.seleccion()!.id);
  }

  // ── Guardar / salir ─────────────────────────────────────────────────

  guardar(): void {
    const c = this.croquis(); if (!c) return;
    this.ocupado.set(true); this.error.set(null);
    const primero = this.pisos()[0];
    const elementosJson = JSON.stringify({ v: 3, pisos: this.pisos() });
    this.api.guardarCroquis(this.id(), {
      nombre: c.nombre, ancho: primero.ancho, alto: primero.alto, escala_cm_px: c.escala_cm_px,
      fondo_color: c.fondo_color, fondo_imagen_url: c.fondo_imagen_url,
      elementos_json: elementosJson,
      areas: this.areas().map(({ servicios: _s, puestos: _p, ...a }) => a),
    }).subscribe({
      next: r => { this.ocupado.set(false); this.aplicar(r); this.sucio.set(false); },
      error: e => { this.ocupado.set(false); this.error.set(e?.error?.message || 'No se pudo guardar'); },
    });
  }

  volver2D(): void {
    if (this.sucio() && !confirm('Hay cambios 3D sin guardar. ¿Salir al plano 2D igualmente?')) return;
    this.router.navigate(['/dashboard/turnos/oficinas', this.id(), 'croquis']);
  }

  nombreTipo(t: string): string {
    const n: Record<string, string> = { CAMARA: 'Cámara', MODELO3D: 'Objeto 3D', MESA: 'Escritorio', MOSTRADOR: 'Mostrador', SILLA: 'Silla', PLANTA: 'Planta', PARED: 'Pared' };
    return n[t] ?? t;
  }
}
