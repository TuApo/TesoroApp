import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';

import { SalonEncabezado } from '../../components/salon-encabezado';
import { Camara, CamaraForm, FormaMesa, Mesa, MesaForm, PruebaCamara, Reglas, Salon, SalonForm, Salud } from '../../models/salon.models';
import { SALON_CONTEXTO, permisosDeContexto } from '../../services/salon-contexto.token';
import { SalonService, mensajeError } from '../../services/salon.service';

const REGLAS_DEFECTO: Reglas = {
  minutos_sin_atencion: 5, minutos_escalado: 10, histeresis_ocupada_seg: 20, histeresis_libre_seg: 45, minutos_limpieza: 3,
  min_confianza: 0.45, modo_manual: false, guardar_recorte_alertas: false,
  duracion_defecto_min: { '1': 35, '2': 45, '3': 55, '4': 65, '5': 75, '6': 90 }, mesas_por_mesero: 4,
};
const CAMARA_VACIA: CamaraForm = { nombre: '', url_rtsp: '', fps: 1.5, activa: true };
const MESA_VACIA: MesaForm = { nombre: '', capacidad: 4, pos_x: 0.05, pos_y: 0.05, ancho: 0.12, alto: 0.12, forma: 'RECTA' };

/**
 * Configuración del salón: Reglas (§4.3), Cámaras (§4.2, con prueba de conexión y salud),
 * Salones y mesas (§4.1, con la posición en el plano arrastrando) y Modo manual.
 */
@Component({
  selector: 'app-salon-configuracion',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule, MatTabsModule, SalonEncabezado],
  styleUrls: ['../../salon-comun.css'],
  templateUrl: './configuracion.html',
  styles: [`
    .cf-form { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr)); align-items: end; }
    .cf-form .sl-campo small { color: var(--muted); font-size: .75rem; font-weight: 500; }
    .cf-duraciones { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(min(96px, 100%), 1fr)); }
    .cf-pie { margin-top: 14px; display: flex; gap: 8px; flex-wrap: wrap; }
    .cf-lista { display: flex; flex-direction: column; gap: 8px; }
    .cf-item { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 10px 12px; border-radius: var(--r-md); border: 1px solid var(--border); background: var(--surface-2); }
    .cf-item--activo { border-color: var(--primary); box-shadow: var(--ring); }
    .cf-item strong { font-size: 1rem; }
    .cf-item .sl-muted { font-size: .85rem; }
    .cf-item-datos { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
    .cf-item-acciones { display: flex; gap: 6px; flex-wrap: wrap; }
    .cf-prueba { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .cf-plano { position: relative; width: 100%; max-width: 1100px; border-radius: var(--r-md); border: 1px solid var(--border); background: var(--surface-2);
      background-image: linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px); background-size: 10% 10%;
      overflow: hidden; touch-action: none; user-select: none; }
    .cf-mesa { position: absolute; box-sizing: border-box; border: 2px solid var(--primary); background: var(--blue-soft); color: var(--navy-ink); border-radius: 10px;
      display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: .85rem; cursor: grab; min-width: 36px; min-height: 30px; }
    :host-context(html[data-theme='dark']) .cf-mesa { background: var(--info-bg); }
    .cf-mesa--redonda { border-radius: 50%; }
    .cf-mesa--activa { box-shadow: var(--ring); z-index: 1; }
    .cf-mesa:active { cursor: grabbing; }
    .cf-ayuda { color: var(--muted); font-size: .82rem; margin: 6px 0 0; }
    .cf-manual { display: flex; flex-direction: column; gap: 12px; max-width: 720px; }
    .cf-manual-estado { display: flex; align-items: center; gap: 10px; font-size: 1.1rem; font-weight: 800; }
    .cf-salud { display: flex; flex-wrap: wrap; gap: 6px; }
  `],
})
export class SalonConfiguracionPage {
  readonly ctx = inject(SALON_CONTEXTO);
  readonly permisos = permisosDeContexto(this.ctx);
  private api = inject(SalonService);
  private snack = inject(MatSnackBar);

  // ── Reglas ──
  readonly reglas = signal<Reglas>({ ...REGLAS_DEFECTO });
  readonly guardandoReglas = signal(false);
  readonly tamanos = ['1', '2', '3', '4', '5', '6'];

  // ── Cámaras ──
  readonly camaras = signal<Camara[]>([]);
  readonly salud = signal<Salud | null>(null);
  readonly camaraForm = signal<CamaraForm>({ ...CAMARA_VACIA });
  readonly camaraEditando = signal<Camara | null>(null);
  readonly prueba = signal<PruebaCamara | null>(null);
  readonly probando = signal(false);
  readonly guardandoCamara = signal(false);

  // ── Salones y mesas ──
  readonly salones = signal<Salon[]>([]);
  readonly salonId = signal<string | null>(null);
  readonly salonForm = signal<SalonForm>({ nombre: '', ancho_plano: 1, alto_plano: 0.6 });
  readonly salonEditando = signal<Salon | null>(null);
  readonly mesas = signal<Mesa[]>([]);
  readonly mesaForm = signal<MesaForm>({ ...MESA_VACIA });
  readonly mesaEditando = signal<Mesa | null>(null);
  readonly guardandoEstructura = signal(false);
  readonly formas: FormaMesa[] = ['RECTA', 'REDONDA'];
  readonly salonActual = computed(() => this.salones().find(s => s.id === this.salonId()) ?? null);
  readonly mesasActivas = computed(() => this.mesas().filter(m => m.activa));

  readonly error = signal<string | null>(null);
  private arrastre: { mesa: Mesa; dx: number; dy: number; lienzo: HTMLElement; movio: boolean } | null = null;

  constructor() {
    effect(() => { if (this.ctx.tiendaId()) this.cargarTodo(); });
  }

  cargarTodo(): void {
    const id = this.ctx.tiendaId();
    if (!id) return;
    this.error.set(null);
    this.api.reglas(id).subscribe({
      next: r => this.reglas.set({ ...REGLAS_DEFECTO, ...r, duracion_defecto_min: { ...REGLAS_DEFECTO.duracion_defecto_min, ...(r.duracion_defecto_min ?? {}) } }),
      error: e => this.error.set(mensajeError(e, 'No se pudieron cargar las reglas')),
    });
    this.cargarCamaras();
    this.api.salones(id).subscribe({
      next: s => { this.salones.set(s); if (!this.salonId() && s.length) this.elegirSalon(s[0].id); },
      error: e => this.error.set(mensajeError(e, 'No se pudieron cargar los salones')),
    });
  }

  // ── Reglas ────────────────────────────────────────────────────────────────
  campo<K extends keyof Reglas>(k: K, v: Reglas[K]): void { this.reglas.update(r => ({ ...r, [k]: v })); }
  duracion(t: string, v: number): void { this.reglas.update(r => ({ ...r, duracion_defecto_min: { ...r.duracion_defecto_min, [t]: Number(v) || 0 } })); }
  guardarReglas(mensaje = 'Reglas guardadas'): void {
    const id = this.ctx.tiendaId();
    if (!id) return;
    this.guardandoReglas.set(true);
    this.api.guardarReglas(id, this.reglas()).subscribe({
      next: r => { this.reglas.set({ ...this.reglas(), ...r }); this.guardandoReglas.set(false); this.snack.open(mensaje, 'OK', { duration: 2500 }); },
      error: e => { this.guardandoReglas.set(false); this.snack.open(mensajeError(e), 'OK', { duration: 5000 }); },
    });
  }
  alternarModoManual(): void {
    this.campo('modo_manual', !this.reglas().modo_manual);
    this.guardarReglas(this.reglas().modo_manual ? 'Modo manual ACTIVADO: la visión no cambia estados' : 'Modo manual apagado: la visión vuelve a mandar');
  }

  // ── Cámaras ───────────────────────────────────────────────────────────────
  cargarCamaras(): void {
    const id = this.ctx.tiendaId();
    if (!id) return;
    this.api.camaras(id).subscribe({ next: c => this.camaras.set(c), error: e => this.error.set(mensajeError(e, 'No se pudieron cargar las cámaras')) });
    this.api.salud(id).subscribe({ next: s => this.salud.set(s), error: () => this.salud.set(null) });
  }
  camaraCampo<K extends keyof CamaraForm>(k: K, v: CamaraForm[K]): void { this.camaraForm.update(f => ({ ...f, [k]: v })); }
  editarCamara(c: Camara | null): void {
    this.camaraEditando.set(c);
    this.prueba.set(null);
    this.camaraForm.set(c ? { nombre: c.nombre, url_rtsp: '', fps: c.fps, activa: c.activa } : { ...CAMARA_VACIA });
  }
  probarCamara(): void {
    const url = this.camaraForm().url_rtsp.trim();
    if (!url) { this.snack.open('Escribe la URL RTSP para probarla', 'OK', { duration: 3000 }); return; }
    this.probando.set(true);
    this.api.probarCamara(url).subscribe({
      next: r => { this.prueba.set(r); this.probando.set(false); },
      error: e => { this.probando.set(false); this.prueba.set({ ok: false, ancho: null, alto: null, latencia_ms: null, error: mensajeError(e, 'No se pudo probar') }); },
    });
  }
  guardarCamara(): void {
    const id = this.ctx.tiendaId();
    const f = { ...this.camaraForm(), nombre: this.camaraForm().nombre.trim(), url_rtsp: this.camaraForm().url_rtsp.trim(), fps: Number(this.camaraForm().fps) || 1.5 };
    if (!id || !f.nombre || (!this.camaraEditando() && !f.url_rtsp)) return;
    this.guardandoCamara.set(true);
    const editando = this.camaraEditando();
    const peticion = editando ? this.api.editarCamara(editando.id, f) : this.api.crearCamara(id, f);
    peticion.subscribe({
      next: () => { this.guardandoCamara.set(false); this.editarCamara(null); this.cargarCamaras(); this.snack.open('Cámara guardada', 'OK', { duration: 2500 }); },
      error: e => { this.guardandoCamara.set(false); this.snack.open(mensajeError(e), 'OK', { duration: 5000 }); },
    });
  }
  borrarCamara(c: Camara): void {
    if (!confirm(`¿Eliminar la cámara «${c.nombre}»? Sus ${c.mesas_calibradas} polígonos dejarán de observarse.`)) return;
    this.api.borrarCamara(c.id).subscribe({
      next: () => { this.cargarCamaras(); this.snack.open('Cámara eliminada', 'OK', { duration: 2500 }); },
      error: e => this.snack.open(mensajeError(e), 'OK', { duration: 5000 }),
    });
  }
  tonoSalud(c: Camara): string {
    if (!c.activa || c.estado_salud === 'DESACTIVADA') return 'sl-tono-neutro';
    if (c.estado_salud === 'OK') return 'sl-tono-ok';
    if (c.estado_salud === 'SIN_SENAL') return 'sl-tono-warn';
    return c.estado_salud ? 'sl-tono-danger' : 'sl-tono-neutro';
  }
  hace(iso: string | null): string {
    const t = Date.parse(iso ?? '');
    if (Number.isNaN(t)) return 'nunca';
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    return s < 90 ? `hace ${s} s` : s < 5400 ? `hace ${Math.round(s / 60)} min` : `hace ${Math.round(s / 3600)} h`;
  }

  // ── Salones ───────────────────────────────────────────────────────────────
  elegirSalon(id: string | null): void {
    this.salonId.set(id);
    this.mesas.set([]);
    this.editarMesa(null);
    if (id) this.api.mesas(id).subscribe({ next: m => this.mesas.set(m), error: e => this.snack.open(mensajeError(e, 'No se pudieron cargar las mesas'), 'OK', { duration: 4000 }) });
  }
  salonCampo<K extends keyof SalonForm>(k: K, v: SalonForm[K]): void { this.salonForm.update(f => ({ ...f, [k]: v })); }
  editarSalon(s: Salon | null): void {
    this.salonEditando.set(s);
    this.salonForm.set(s ? { nombre: s.nombre, ancho_plano: s.ancho_plano, alto_plano: s.alto_plano } : { nombre: '', ancho_plano: 1, alto_plano: 0.6 });
  }
  guardarSalon(): void {
    const id = this.ctx.tiendaId();
    const f: SalonForm = { nombre: this.salonForm().nombre.trim(), ancho_plano: Number(this.salonForm().ancho_plano) || 1, alto_plano: Number(this.salonForm().alto_plano) || 0.6 };
    if (!id || !f.nombre) return;
    this.guardandoEstructura.set(true);
    const editando = this.salonEditando();
    (editando ? this.api.editarSalon(editando.id, f) : this.api.crearSalon(id, f)).subscribe({
      next: s => {
        this.guardandoEstructura.set(false);
        this.salones.update(l => editando ? l.map(x => (x.id === s.id ? s : x)) : [...l, s]);
        this.editarSalon(null);
        if (!editando) this.elegirSalon(s.id);
        this.snack.open('Salón guardado', 'OK', { duration: 2500 });
      },
      error: e => { this.guardandoEstructura.set(false); this.snack.open(mensajeError(e), 'OK', { duration: 5000 }); },
    });
  }
  borrarSalon(s: Salon): void {
    if (!confirm(`¿Eliminar el salón «${s.nombre}»? Solo se puede si no tiene mesas activas.`)) return;
    this.api.borrarSalon(s.id).subscribe({
      next: () => { this.salones.update(l => l.filter(x => x.id !== s.id)); if (this.salonId() === s.id) this.elegirSalon(this.salones()[0]?.id ?? null); this.snack.open('Salón eliminado', 'OK', { duration: 2500 }); },
      error: e => this.snack.open(mensajeError(e, 'No se pudo eliminar (¿tiene mesas activas?)'), 'OK', { duration: 5000 }),
    });
  }

  // ── Mesas ─────────────────────────────────────────────────────────────────
  mesaCampo<K extends keyof MesaForm>(k: K, v: MesaForm[K]): void { this.mesaForm.update(f => ({ ...f, [k]: v })); }
  editarMesa(m: Mesa | null): void {
    this.mesaEditando.set(m);
    this.mesaForm.set(m ? { nombre: m.nombre, capacidad: m.capacidad, pos_x: m.pos_x, pos_y: m.pos_y, ancho: m.ancho, alto: m.alto, forma: m.forma } : { ...MESA_VACIA, ...siguienteHueco(this.mesasActivas()) });
  }
  guardarMesa(): void {
    const salon = this.salonId();
    const f = normalizarMesa(this.mesaForm());
    if (!salon || !f.nombre) return;
    this.guardandoEstructura.set(true);
    const editando = this.mesaEditando();
    (editando ? this.api.editarMesa(editando.id, f) : this.api.crearMesa(salon, f)).subscribe({
      next: m => {
        this.guardandoEstructura.set(false);
        this.mesas.update(l => editando ? l.map(x => (x.id === m.id ? m : x)) : [...l, m]);
        if (!editando) this.salones.update(l => l.map(s => (s.id === salon ? { ...s, mesas: s.mesas + 1 } : s)));
        this.editarMesa(null);
        this.snack.open('Mesa guardada', 'OK', { duration: 2500 });
      },
      error: e => { this.guardandoEstructura.set(false); this.snack.open(mensajeError(e), 'OK', { duration: 5000 }); },
    });
  }
  borrarMesa(m: Mesa): void {
    if (!confirm(`¿Desactivar la mesa «${m.nombre}»? Deja de salir en el plano; su historial se conserva.`)) return;
    this.api.borrarMesa(m.id).subscribe({
      next: () => {
        this.mesas.update(l => l.map(x => (x.id === m.id ? { ...x, activa: false } : x)));
        this.salones.update(l => l.map(s => (s.id === m.salon_id ? { ...s, mesas: Math.max(0, s.mesas - 1) } : s)));
        if (this.mesaEditando()?.id === m.id) this.editarMesa(null);
        this.snack.open('Mesa desactivada', 'OK', { duration: 2500 });
      },
      error: e => this.snack.open(mensajeError(e), 'OK', { duration: 5000 }),
    });
  }
  estiloMesa(m: Mesa | MesaForm): Record<string, string> {
    return { left: `${m.pos_x * 100}%`, top: `${m.pos_y * 100}%`, width: `${m.ancho * 100}%`, height: `${m.alto * 100}%` };
  }
  proporcion(s: Salon | null): string { return `${s?.ancho_plano || 1} / ${s?.alto_plano || 0.6}`; }

  /** Arrastre de una mesa en el mini-plano: al soltar se guarda la posición. */
  empezarArrastre(ev: PointerEvent, m: Mesa, lienzo: HTMLElement): void {
    if (!this.permisos.puedeAdministrar()) return;
    const r = lienzo.getBoundingClientRect();
    const px = (ev.clientX - r.left) / r.width, py = (ev.clientY - r.top) / r.height;
    this.arrastre = { mesa: m, dx: px - m.pos_x, dy: py - m.pos_y, lienzo, movio: false };
    lienzo.setPointerCapture(ev.pointerId);
    this.editarMesa(m);
  }
  moverArrastre(ev: PointerEvent): void {
    const a = this.arrastre;
    if (!a) return;
    const r = a.lienzo.getBoundingClientRect();
    const px = (ev.clientX - r.left) / r.width, py = (ev.clientY - r.top) / r.height;
    const pos_x = acotar(px - a.dx, 1 - a.mesa.ancho), pos_y = acotar(py - a.dy, 1 - a.mesa.alto);
    a.movio = true;
    this.mesas.update(l => l.map(x => (x.id === a.mesa.id ? { ...x, pos_x, pos_y } : x)));
    this.mesaForm.update(f => ({ ...f, pos_x, pos_y }));
  }
  soltarArrastre(ev: PointerEvent): void {
    const a = this.arrastre;
    if (!a) return;
    this.arrastre = null;
    try { a.lienzo.releasePointerCapture(ev.pointerId); } catch { /* nada */ }
    if (!a.movio) return;
    const actual = this.mesas().find(x => x.id === a.mesa.id);
    if (!actual) return;
    const body: MesaForm = { nombre: actual.nombre, capacidad: actual.capacidad, pos_x: actual.pos_x, pos_y: actual.pos_y, ancho: actual.ancho, alto: actual.alto, forma: actual.forma };
    this.api.editarMesa(actual.id, body).subscribe({
      next: m => this.mesas.update(l => l.map(x => (x.id === m.id ? m : x))),
      error: e => { this.snack.open(mensajeError(e, 'No se guardó la posición'), 'OK', { duration: 4000 }); this.elegirSalon(this.salonId()); },
    });
  }
}

function acotar(v: number, max: number): number { return Math.round(Math.min(Math.max(0, v), Math.max(0, max)) * 1000) / 1000; }
function normalizarMesa(f: MesaForm): MesaForm {
  const n = (v: number, def: number) => (Number.isFinite(Number(v)) ? Number(v) : def);
  return {
    nombre: f.nombre.trim(), capacidad: Math.max(1, Math.round(n(f.capacidad, 4))), forma: f.forma,
    ancho: acotar(n(f.ancho, 0.12), 1), alto: acotar(n(f.alto, 0.12), 1),
    pos_x: acotar(n(f.pos_x, 0), 1 - acotar(n(f.ancho, 0.12), 1)), pos_y: acotar(n(f.pos_y, 0), 1 - acotar(n(f.alto, 0.12), 1)),
  };
}
/** Primera casilla libre en una rejilla de 0.15 para que una mesa nueva no caiga encima de otra. */
function siguienteHueco(mesas: Mesa[]): Partial<MesaForm> {
  for (let y = 0.05; y <= 0.85; y += 0.15) {
    for (let x = 0.05; x <= 0.85; x += 0.15) {
      const ocupado = mesas.some(m => Math.abs(m.pos_x - x) < 0.1 && Math.abs(m.pos_y - y) < 0.1);
      if (!ocupado) return { pos_x: Math.round(x * 100) / 100, pos_y: Math.round(y * 100) / 100 };
    }
  }
  return {};
}
