import {
  ChangeDetectionStrategy, Component, DestroyRef, OnInit, ViewEncapsulation, computed, inject, input, output, signal,
} from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonToggleModule } from '@angular/material/button-toggle';

import {
  ConocimientoService, EjecucionDto, FuenteDto, FuenteReq, McpServidorDto, ModuloKbDto, PruebaResp, SugerenciaDto, TipoFuente,
} from '../../service/conocimiento.service';
import { markdownToHtml } from '../../../nomina/pages/analitica-nomina-ia/markdown-lite';
import { mensajeDeError } from '../../../../../../shared/utils/mensaje-error';

interface Borrador {
  id: number | null;
  nombre: string; tipo: TipoFuente; descripcion: string;
  urls: string; unaBasePorUrl: boolean;
  url: string; metodo: 'GET' | 'POST'; cabeceras: string; cabeceraSecreta: string; secreto: string; rutaDatos: string; cuerpo: string;
  servidorId: string; herramienta: string; argumentos: string;
  ciudades: string; dias: number;
  modulos: string[]; frecuenciaMin: number; conRed: boolean; transformacion: 'ninguna' | 'ia'; instruccionesIa: string; activo: boolean;
  tieneSecreto: boolean; borrarSecreto: boolean;
}

const TIPOS: { clave: TipoFuente; nombre: string; icono: string; ayuda: string }[] = [
  { clave: 'WEB', nombre: 'Página web', icono: 'language', ayuda: 'Scraping de una o varias páginas; Docling saca títulos, tablas y texto.' },
  { clave: 'API', nombre: 'API REST', icono: 'api', ayuda: 'JSON o texto de una API (datos abiertos, tasas, festivos…). Admite clave secreta.' },
  { clave: 'MCP', nombre: 'Conector MCP', icono: 'extension', ayuda: 'Una herramienta de un conector MCP registrado en Configuración › Conectores.' },
  { clave: 'CLIMA', nombre: 'Clima', icono: 'partly_cloudy_day', ayuda: 'Condiciones y pronóstico por municipio (Open-Meteo, sin clave).' },
];

const FRECUENCIAS = [
  { min: 0, nombre: 'Solo manual' }, { min: 15, nombre: 'Cada 15 min' }, { min: 60, nombre: 'Cada hora' },
  { min: 180, nombre: 'Cada 3 horas' }, { min: 360, nombre: 'Cada 6 horas' }, { min: 720, nombre: 'Cada 12 horas' },
  { min: 1440, nombre: 'Diaria' }, { min: 10080, nombre: 'Semanal' }, { min: 43200, nombre: 'Mensual' },
];

/**
 * Fuentes externas de la base de conocimiento: lo que la IA trae de afuera y mantiene al día
 * (normas, tasas, festivos, clima, páginas oficiales, conectores MCP). Cada fuente deja sus
 * bases con origen «fuente» y solo las rehace cuando el contenido cambió.
 */
@Component({
  selector: 'app-kb-fuentes',
  standalone: true,
  imports: [
    DatePipe, DecimalPipe, FormsModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule,
    MatSlideToggleModule, MatButtonToggleModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  templateUrl: './kb-fuentes.component.html',
  styleUrls: ['./kb-fuentes.component.css'],
})
export class KbFuentesComponent implements OnInit {
  private svc = inject(ConocimientoService);
  private destroyRef = inject(DestroyRef);

  readonly modulos = input<ModuloKbDto[]>([]);
  readonly abrirBase = output<number>();
  readonly cambio = output<void>();

  readonly TIPOS = TIPOS;
  readonly FRECUENCIAS = FRECUENCIAS;

  readonly fuentes = signal<FuenteDto[]>([]);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);
  readonly borrador = signal<Borrador | null>(null);
  readonly guardando = signal(false);
  readonly prueba = signal<PruebaResp | null>(null);
  readonly probando = signal(false);
  readonly mcp = signal<McpServidorDto[]>([]);
  readonly historialDe = signal<number | null>(null);
  readonly historial = signal<EjecucionDto[]>([]);
  readonly abiertas = signal<Set<number>>(new Set());

  // Sugerencias
  readonly verSugerencias = signal(false);
  readonly moduloSug = signal('');
  readonly necesidad = signal('');
  readonly sugerencias = signal<SugerenciaDto[] | null>(null);
  readonly sugiriendo = signal(false);

  readonly ejecutando = computed(() => this.fuentes().some((f) => f.ultimoEstado === 'EJECUTANDO'));
  readonly herramientasMcp = computed(() => this.mcp().find((s) => s.id === this.borrador()?.servidorId)?.herramientas ?? []);
  readonly htmlPrueba = computed(() => (this.prueba()?.partes ?? []).map((p) => ({ ...p, html: markdownToHtml(p.markdown) })));
  readonly nombresModulo = computed(() => Object.fromEntries(this.modulos().map((m) => [m.clave, m.nombre])));

  private sondeo: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.cargar();
    this.svc.conectoresMcp().subscribe({ next: (m) => this.mcp.set(m ?? []), error: () => this.mcp.set([]) });
    this.destroyRef.onDestroy(() => { if (this.sondeo) clearInterval(this.sondeo); });
  }

  cargar(silencioso = false): void {
    if (!silencioso) this.cargando.set(true);
    this.svc.fuentes().subscribe({
      next: (f) => {
        const antes = this.ejecutando();
        this.fuentes.set(f ?? []);
        this.cargando.set(false);
        if (antes && !this.ejecutando()) this.cambio.emit();
        this.vigilar();
      },
      error: (e) => { this.cargando.set(false); this.error.set(mensajeDeError(e, 'No se pudieron cargar las fuentes.')); },
    });
  }

  private vigilar(): void {
    if (this.ejecutando() && !this.sondeo) this.sondeo = setInterval(() => this.cargar(true), 5000);
    else if (!this.ejecutando() && this.sondeo) { clearInterval(this.sondeo); this.sondeo = null; }
  }

  // ── Acciones sobre fuentes ──────────────────────────────────────────────────
  ejecutar(f: FuenteDto): void {
    this.svc.ejecutarFuente(f.id).subscribe({
      next: (r) => { this.reemplazar(r); this.vigilar(); },
      error: (e) => this.error.set(mensajeDeError(e, 'No se pudo ejecutar.')),
    });
  }

  alternarActiva(f: FuenteDto, activo: boolean): void {
    this.svc.editarFuente(f.id, { activo }).subscribe({
      next: (r) => this.reemplazar(r),
      error: (e) => { this.error.set(mensajeDeError(e, 'No se pudo cambiar.')); this.cargar(true); },
    });
  }

  eliminar(f: FuenteDto): void {
    if (!window.confirm(`¿Eliminar la fuente «${f.nombre}»? Sus ${f.bases.length} bases dejarán de usarse en la IA.`)) return;
    this.svc.eliminarFuente(f.id, true).subscribe({
      next: () => { this.fuentes.update((l) => l.filter((x) => x.id !== f.id)); this.cambio.emit(); },
      error: (e) => this.error.set(mensajeDeError(e, 'No se pudo eliminar.')),
    });
  }

  verHistorial(f: FuenteDto): void {
    if (this.historialDe() === f.id) { this.historialDe.set(null); return; }
    this.historialDe.set(f.id);
    this.historial.set([]);
    this.svc.ejecucionesFuente(f.id).subscribe({ next: (h) => this.historial.set(h ?? []) });
  }

  alternarBases(id: number): void {
    this.abiertas.update((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  private reemplazar(f: FuenteDto): void {
    this.fuentes.update((l) => (l.some((x) => x.id === f.id) ? l.map((x) => (x.id === f.id ? f : x)) : [...l, f]));
  }

  // ── Editor ──────────────────────────────────────────────────────────────────
  nueva(tipo: TipoFuente = 'WEB'): void {
    this.prueba.set(null);
    this.borrador.set(this.vacio(tipo));
    this.desplazarAlEditor();
  }

  editar(f: FuenteDto): void {
    const c = f.config ?? {};
    this.prueba.set(null);
    this.borrador.set({
      ...this.vacio(f.tipo), id: f.id, nombre: f.nombre, descripcion: f.descripcion ?? '',
      urls: (c.urls ?? (c.url && f.tipo === 'WEB' ? [c.url] : [])).join('\n'), unaBasePorUrl: !!c.unaBasePorUrl,
      url: f.tipo === 'API' ? c.url ?? '' : '', metodo: c.metodo ?? 'GET',
      cabeceras: c.cabeceras ? JSON.stringify(c.cabeceras, null, 2) : '', cabeceraSecreta: c.cabeceraSecreta ?? '',
      rutaDatos: c.rutaDatos ?? '', cuerpo: c.cuerpo ? (typeof c.cuerpo === 'string' ? c.cuerpo : JSON.stringify(c.cuerpo, null, 2)) : '',
      servidorId: c.servidorId ?? '', herramienta: c.herramienta ?? '', argumentos: c.argumentos ? JSON.stringify(c.argumentos, null, 2) : '{}',
      ciudades: (c.ciudades ?? []).join('\n'), dias: c.dias ?? 3,
      modulos: f.modulos ?? [], frecuenciaMin: f.frecuenciaMin, conRed: f.conRed, transformacion: f.transformacion,
      instruccionesIa: f.instruccionesIa ?? '', activo: f.activo, tieneSecreto: f.tieneSecreto,
    });
    this.desplazarAlEditor();
  }

  usarSugerencia(s: SugerenciaDto): void {
    const c = s.config ?? {};
    const validas = new Set(this.modulos().map((m) => m.clave));
    this.prueba.set(null);
    this.borrador.set({
      ...this.vacio(s.tipo), nombre: s.nombre, descripcion: [s.descripcion, s.porque].filter(Boolean).join(' — '),
      urls: (c.urls ?? []).join('\n'), url: c.url ?? '', metodo: c.metodo ?? 'GET',
      ciudades: (c.ciudades ?? []).join('\n'), dias: c.dias ?? 3,
      modulos: (s.modulos ?? []).filter((m) => validas.has(m)), frecuenciaMin: s.frecuenciaMin || 1440,
      transformacion: s.transformacion, instruccionesIa: s.instruccionesIa ?? '', activo: false,
    });
    this.aviso.set('Revisa la sugerencia y pulsa «Probar» antes de activarla: se guarda inactiva.');
    this.desplazarAlEditor();
  }

  private vacio(tipo: TipoFuente): Borrador {
    return {
      id: null, nombre: '', tipo, descripcion: '', urls: '', unaBasePorUrl: false,
      url: '', metodo: 'GET', cabeceras: '', cabeceraSecreta: '', secreto: '', rutaDatos: '', cuerpo: '',
      servidorId: this.mcp()[0]?.id ?? '', herramienta: '', argumentos: '{}',
      ciudades: '', dias: 3, modulos: [], frecuenciaMin: tipo === 'CLIMA' ? 180 : 1440, conRed: tipo === 'WEB',
      transformacion: 'ninguna', instruccionesIa: '', activo: true, tieneSecreto: false, borrarSecreto: false,
    };
  }

  cambiar<K extends keyof Borrador>(campo: K, valor: Borrador[K]): void {
    this.borrador.update((b) => (b ? { ...b, [campo]: valor } : b));
  }

  toggleModulo(c: string): void {
    const b = this.borrador();
    if (!b) return;
    this.cambiar('modulos', b.modulos.includes(c) ? b.modulos.filter((x) => x !== c) : [...b.modulos, c]);
  }

  cancelar(): void { this.borrador.set(null); this.prueba.set(null); }

  /** Convierte el borrador en la petición; lanza con un mensaje claro si un JSON está mal. */
  private peticion(b: Borrador): FuenteReq {
    const json = (t: string, campo: string) => {
      if (!t.trim()) return undefined;
      try { return JSON.parse(t); } catch { throw new Error(`${campo} no es un JSON válido`); }
    };
    const lineas = (t: string) => t.split(/\n|,(?=\s*https?:)/).map((x) => x.trim()).filter(Boolean);
    let config: any;
    switch (b.tipo) {
      case 'WEB': config = { urls: lineas(b.urls), unaBasePorUrl: b.unaBasePorUrl }; break;
      case 'API': config = {
        url: b.url.trim(), metodo: b.metodo, cabeceras: json(b.cabeceras, 'Cabeceras'),
        cabeceraSecreta: b.cabeceraSecreta.trim() || undefined, rutaDatos: b.rutaDatos.trim() || undefined,
        cuerpo: b.metodo === 'POST' ? json(b.cuerpo, 'Cuerpo') : undefined,
      }; break;
      case 'MCP': config = { servidorId: b.servidorId, herramienta: b.herramienta, argumentos: json(b.argumentos, 'Argumentos') ?? {} }; break;
      case 'CLIMA': config = { ciudades: b.ciudades.split('\n').map((x) => x.trim()).filter(Boolean), dias: b.dias }; break;
    }
    return {
      nombre: b.nombre.trim(), tipo: b.tipo, descripcion: b.descripcion.trim() || null, config,
      secreto: b.secreto || null, borrarSecreto: b.borrarSecreto, modulos: b.modulos.length ? b.modulos : ['todos'],
      frecuenciaMin: b.frecuenciaMin, conRed: b.conRed, transformacion: b.transformacion,
      instruccionesIa: b.instruccionesIa.trim() || null, activo: b.activo,
    };
  }

  probar(): void {
    const b = this.borrador();
    if (!b) return;
    let req: FuenteReq;
    try { req = this.peticion(b); } catch (e: any) { this.error.set(e.message); return; }
    this.probando.set(true);
    this.prueba.set(null);
    this.error.set(null);
    this.svc.probarFuente(req, b.id).subscribe({
      next: (r) => { this.prueba.set(r); this.probando.set(false); },
      error: (e) => { this.probando.set(false); this.error.set(mensajeDeError(e, 'La fuente no respondió.')); },
    });
  }

  guardar(ejecutar = false): void {
    const b = this.borrador();
    if (!b) return;
    if (!b.nombre.trim()) { this.error.set('Ponle un nombre a la fuente.'); return; }
    let req: FuenteReq;
    try { req = this.peticion(b); } catch (e: any) { this.error.set(e.message); return; }
    this.guardando.set(true);
    this.error.set(null);
    const op = b.id ? this.svc.editarFuente(b.id, req) : this.svc.crearFuente(req);
    op.subscribe({
      next: (f) => {
        this.guardando.set(false);
        this.reemplazar(f);
        this.borrador.set(null);
        this.prueba.set(null);
        this.aviso.set(`Fuente «${f.nombre}» guardada${f.activo && f.frecuenciaMin > 0 ? '; se refresca sola' : ''}.`);
        if (ejecutar) this.ejecutar(f);
      },
      error: (e) => { this.guardando.set(false); this.error.set(mensajeDeError(e, 'No se pudo guardar la fuente.')); },
    });
  }

  private desplazarAlEditor(): void {
    setTimeout(() => document.querySelector('.kbf-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  // ── Sugerencias ─────────────────────────────────────────────────────────────
  pedirSugerencias(): void {
    this.sugiriendo.set(true);
    this.sugerencias.set(null);
    this.error.set(null);
    this.svc.sugerirFuentes(this.moduloSug() || null, this.necesidad().trim() || null).subscribe({
      next: (s) => { this.sugerencias.set(s ?? []); this.sugiriendo.set(false); },
      error: (e) => { this.sugiriendo.set(false); this.error.set(mensajeDeError(e, 'La IA no pudo sugerir fuentes.')); },
    });
  }

  // ── Formato ─────────────────────────────────────────────────────────────────
  tipo(t: TipoFuente) { return TIPOS.find((x) => x.clave === t) ?? TIPOS[0]; }

  frecuencia(min: number): string {
    return FRECUENCIAS.find((f) => f.min === min)?.nombre ?? (min >= 60 ? `Cada ${Math.round(min / 60)} h` : `Cada ${min} min`);
  }

  etiquetaEstado(e: string | null): string {
    return ({ EJECUTANDO: 'Actualizando…', OK: 'Actualizada', SIN_CAMBIOS: 'Sin cambios', ERROR: 'Error' } as Record<string, string>)[e ?? ''] ?? 'Sin ejecutar';
  }

  origenFuente(f: FuenteDto): string {
    const c = f.config ?? {};
    switch (f.tipo) {
      case 'WEB': { const u = c.urls ?? []; return u.length > 1 ? `${u.length} páginas · ${this.host(u[0])}` : this.host(u[0] ?? c.url); }
      case 'API': return this.host(c.url);
      case 'MCP': return `${this.mcp().find((s) => s.id === c.servidorId)?.nombre ?? 'Conector'} › ${c.herramienta ?? ''}`;
      case 'CLIMA': return `${(c.ciudades ?? []).length} municipios`;
    }
  }

  private host(u?: string): string {
    try { return u ? new URL(u.replace(/\{[a-z]+\}/g, 'x')).host : ''; } catch { return u ?? ''; }
  }

  nombreModulo(c: string): string { return this.nombresModulo()[c] ?? c; }

  modulosTexto(l: string[]): string { return (l ?? []).map((m) => this.nombreModulo(m)).join(', ') || 'Toda la plataforma'; }
}
