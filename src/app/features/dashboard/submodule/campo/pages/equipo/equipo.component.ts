import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Subject, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';

import { ComunicacionesApiService } from '../../../comunicaciones/service/comunicaciones-api.service';
import { UsuarioDir } from '../../../comunicaciones/modelos';
import { Miembro, Zona } from '../../campo.models';
import { CampoApiService } from '../../services/campo-api.service';
import { CampoService, mensajeDe } from '../../services/campo.service';

type Vista = 'arbol' | 'lista';

/** Cargos de campo con nombre; cualquier otro se escribe a mano. */
const CARGOS = ['COORDINADOR', 'SUPERVISOR', 'JEFE DE ZONA'] as const;
const OTRO = 'OTRO';

/** Una fila del árbol ya aplanada, con su profundidad. */
interface NodoArbol { m: Miembro; nivel: number; hijos: number }

interface FormMiembro {
  usuario_id: string; nombre: string;
  jefe_id: string | null; jefe_nombre: string | null;
  /** Uno de CARGOS u OTRO. */
  cargo: string; cargo_otro: string;
  zona_id: number | null; activo: boolean;
}

/** Persona que se puede elegir (del equipo o de toda la plataforma). */
interface Candidato { id: string; nombre: string; detalle: string | null; del_equipo: boolean }

/**
 * Jerarquía del equipo de campo (`/dashboard/campo/equipo`).
 *
 * Vista árbol (raíces = quien no tiene jefe dentro del equipo visible) y vista lista con
 * buscador. Administración edita jefe, cargo de campo, zona y si está activo; el servidor
 * valida que no se formen ciclos y devuelve la jerarquía entera ya recalculada.
 */
@Component({
  selector: 'app-campo-equipo',
  standalone: true,
  imports: [FormsModule, MatIconModule, NgTemplateOutlet],
  templateUrl: './equipo.component.html',
  styleUrls: ['../../campo-ui.css', './equipo.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EquipoComponent {
  private readonly api = inject(CampoApiService);
  private readonly com = inject(ComunicacionesApiService);
  private readonly destroy = inject(DestroyRef);
  readonly campo = inject(CampoService);

  readonly CARGOS = CARGOS;
  readonly OTRO = OTRO;

  readonly admin = computed(() => this.campo.paquete()?.perfil === 'ADMIN');

  readonly miembros = signal<Miembro[]>([]);
  readonly zonas = signal<Zona[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<{ texto: string; tipo: 'ok' | 'mal' } | null>(null);
  readonly trabajando = signal(false);

  readonly vista = signal<Vista>('arbol');
  readonly texto = signal('');
  readonly plegados = signal<ReadonlySet<string>>(new Set());

  readonly porId = computed(() => new Map(this.miembros().map(m => [m.usuario_id, m])));

  /** Árbol aplanado en orden de lectura, saltando las ramas plegadas. */
  readonly arbol = computed<NodoArbol[]>(() => {
    const todos = this.miembros();
    const ids = this.porId();
    const hijos = new Map<string, Miembro[]>();
    const raices: Miembro[] = [];
    for (const m of todos) {
      if (m.jefe_id && ids.has(m.jefe_id) && m.jefe_id !== m.usuario_id) {
        const l = hijos.get(m.jefe_id) ?? [];
        l.push(m);
        hijos.set(m.jefe_id, l);
      } else {
        raices.push(m);
      }
    }
    const orden = (l: Miembro[]) => [...l].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    const plegados = this.plegados();
    const vistos = new Set<string>();
    const out: NodoArbol[] = [];
    const recorrer = (m: Miembro, nivel: number) => {
      if (vistos.has(m.usuario_id)) return; // defensa ante un ciclo que se haya colado en datos viejos
      vistos.add(m.usuario_id);
      const sub = hijos.get(m.usuario_id) ?? [];
      out.push({ m, nivel, hijos: sub.length });
      if (!plegados.has(m.usuario_id)) for (const h of orden(sub)) recorrer(h, nivel + 1);
    };
    for (const r of orden(raices)) recorrer(r, 0);
    // Lo que quedó suelto (ciclo entre varios) va al final como raíz.
    for (const m of orden(todos)) if (!vistos.has(m.usuario_id) && !this.dentroDePlegado(m, plegados)) recorrer(m, 0);
    return out;
  });

  readonly lista = computed(() => {
    const q = normalizar(this.texto());
    return [...this.miembros()]
      .filter(m => !q || normalizar(`${m.nombre} ${m.cargo_campo} ${m.cargo ?? ''} ${m.zona_nombre ?? ''} ${m.jefe_nombre ?? ''}`).includes(q))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  });

  readonly resumen = computed(() => {
    const l = this.miembros();
    return {
      total: l.length,
      sinJefe: l.filter(m => !m.jefe_id).length,
      sinFoto: l.filter(m => m.rostro_referencia !== 'APROBADA').length,
      porAprobar: l.filter(m => m.rostro_referencia === 'PROPUESTA').length,
    };
  });

  // ─── Edición ────────────────────────────────────────────────────────────
  readonly form = signal<FormMiembro | null>(null);
  readonly agregando = signal(false);
  readonly busqueda = signal('');
  readonly resultadosPlataforma = signal<UsuarioDir[]>([]);
  readonly buscandoPlataforma = signal(false);
  private readonly consulta$ = new Subject<string>();

  /** Jefes posibles: el equipo (menos la persona misma) más lo que traiga la búsqueda de la plataforma. */
  readonly candidatos = computed<Candidato[]>(() => {
    const q = normalizar(this.busqueda());
    if (q.length < 2) return [];
    const excluir = this.form()?.usuario_id ?? null;
    const enEquipo = this.porId();
    const out = new Map<string, Candidato>();
    if (!this.agregando()) {
      for (const m of this.miembros()) {
        if (m.usuario_id === excluir || !normalizar(m.nombre).includes(q)) continue;
        out.set(m.usuario_id, { id: m.usuario_id, nombre: m.nombre, del_equipo: true,
          detalle: [m.cargo_campo, m.zona_nombre].filter(Boolean).join(' · ') || null });
      }
    }
    for (const u of this.resultadosPlataforma()) {
      if (u.id === excluir || out.has(u.id)) continue;
      if (this.agregando() && enEquipo.get(u.id)?.en_jerarquia) continue;
      out.set(u.id, { id: u.id, nombre: u.nombre, del_equipo: enEquipo.has(u.id),
        detalle: [u.cargo || u.rol, u.sede].filter(Boolean).join(' · ') || null });
    }
    return [...out.values()].slice(0, 15);
  });

  private relojAviso: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.campo.iniciar();
    this.cargar();
    this.consulta$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(q => {
        if (q.trim().length < 3) { this.buscandoPlataforma.set(false); return of([] as UsuarioDir[]); }
        this.buscandoPlataforma.set(true);
        return this.com.buscarPersonas(q.trim(), 20).pipe(catchError(() => of([] as UsuarioDir[])));
      }),
      takeUntilDestroyed(this.destroy),
    ).subscribe(r => { this.resultadosPlataforma.set(r); this.buscandoPlataforma.set(false); });
  }

  cargar(): void {
    this.cargando.set(true);
    this.error.set(null);
    this.api.jerarquia().pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: l => { this.miembros.set(l); this.cargando.set(false); },
      error: e => { this.error.set(mensajeDe(e, 'No se pudo cargar el equipo')); this.cargando.set(false); },
    });
    this.api.zonas().pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: z => this.zonas.set([...z].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))),
      error: () => undefined, // sin zonas igual se puede trabajar: el select solo ofrece "Sin zona"
    });
  }

  alternar(id: string): void {
    this.plegados.update(s => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  private dentroDePlegado(m: Miembro, plegados: ReadonlySet<string>): boolean {
    let jefe = m.jefe_id;
    const vistos = new Set<string>();
    while (jefe && !vistos.has(jefe)) {
      if (plegados.has(jefe)) return true;
      vistos.add(jefe);
      jefe = this.porId().get(jefe)?.jefe_id ?? null;
    }
    return false;
  }

  // ─── Editar ─────────────────────────────────────────────────────────────

  editar(m: Miembro): void {
    if (!this.admin()) return;
    const conocido = (CARGOS as readonly string[]).includes((m.cargo_campo || '').toUpperCase());
    this.agregando.set(false);
    this.limpiarBusqueda();
    this.form.set({
      usuario_id: m.usuario_id, nombre: m.nombre, jefe_id: m.jefe_id, jefe_nombre: m.jefe_nombre,
      cargo: conocido ? m.cargo_campo.toUpperCase() : (m.cargo_campo ? OTRO : 'COORDINADOR'),
      cargo_otro: conocido ? '' : (m.cargo_campo ?? ''),
      zona_id: m.zona_id, activo: m.en_jerarquia,
    });
  }

  poner<K extends keyof FormMiembro>(campo: K, valor: FormMiembro[K]): void {
    this.form.update(f => f && { ...f, [campo]: valor });
  }

  /** El select de jefe solo ofrece el equipo; de la plataforma se llega por el buscador. */
  elegirJefeDelEquipo(id: string | null): void {
    const m = id ? this.porId().get(id) : null;
    this.form.update(f => f && { ...f, jefe_id: m?.usuario_id ?? null, jefe_nombre: m?.nombre ?? null });
  }

  readonly jefesPosibles = computed(() => {
    const yo = this.form()?.usuario_id;
    return [...this.miembros()].filter(m => m.usuario_id !== yo).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  });

  /** ¿El jefe elegido está fuera del equipo visible? (entonces el select no lo puede mostrar) */
  readonly jefeFuera = computed(() => {
    const f = this.form();
    return !!f?.jefe_id && !this.porId().has(f.jefe_id);
  });

  escribir(q: string): void {
    this.busqueda.set(q);
    this.consulta$.next(q);
  }

  private limpiarBusqueda(): void {
    this.busqueda.set('');
    this.resultadosPlataforma.set([]);
  }

  elegirCandidato(c: Candidato): void {
    if (this.agregando()) { this.agregar(c); return; }
    this.form.update(f => f && { ...f, jefe_id: c.id, jefe_nombre: c.nombre });
    this.limpiarBusqueda();
  }

  guardar(): void {
    const f = this.form();
    if (!f) return;
    const cargo = (f.cargo === OTRO ? f.cargo_otro : f.cargo).trim().toUpperCase();
    if (!cargo) { this.avisar('Escribe el cargo de campo', 'mal'); return; }
    this.trabajando.set(true);
    this.api.guardarMiembro(f.usuario_id, {
      jefe_id: f.jefe_id, quitar_jefe: !f.jefe_id, cargo_campo: cargo, zona_id: f.zona_id, activo: f.activo,
    }).subscribe({
      next: l => { this.trabajando.set(false); this.miembros.set(l); this.form.set(null); this.avisar(`${f.nombre}: cambios guardados`, 'ok'); },
      error: e => { this.trabajando.set(false); this.avisar(mensajeDe(e, 'No se pudieron guardar los cambios'), 'mal'); },
    });
  }

  // ─── Agregar ────────────────────────────────────────────────────────────

  abrirAgregar(): void {
    this.form.set(null);
    this.limpiarBusqueda();
    this.agregando.set(true);
  }

  cerrarAgregar(): void {
    this.agregando.set(false);
    this.limpiarBusqueda();
  }

  private agregar(c: Candidato): void {
    this.trabajando.set(true);
    this.api.guardarMiembro(c.id, { cargo_campo: 'COORDINADOR', activo: true }).subscribe({
      next: l => {
        this.trabajando.set(false);
        this.miembros.set(l);
        this.cerrarAgregar();
        this.avisar(`${c.nombre} ya hace parte del equipo de campo`, 'ok');
        // Queda listo para ponerle jefe y zona de una vez.
        const nuevo = l.find(m => m.usuario_id === c.id);
        if (nuevo) this.editar(nuevo);
      },
      error: e => { this.trabajando.set(false); this.avisar(mensajeDe(e, 'No se pudo agregar la persona al equipo'), 'mal'); },
    });
  }

  // ─── Utilidades de plantilla ────────────────────────────────────────────

  iniciales(nombre: string | null | undefined): string {
    const p = (nombre ?? '').trim().split(/\s+/).filter(Boolean);
    return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() || '?';
  }

  foto(m: Miembro): { clase: string; texto: string } {
    switch (m.rostro_referencia) {
      case 'APROBADA': return { clase: 'ok', texto: 'Foto aprobada' };
      case 'PROPUESTA': return { clase: 'aviso', texto: 'Foto por aprobar' };
      default: return { clase: '', texto: 'Sin foto de referencia' };
    }
  }

  avisar(texto: string, tipo: 'ok' | 'mal'): void {
    this.aviso.set({ texto, tipo });
    if (this.relojAviso) clearTimeout(this.relojAviso);
    this.relojAviso = setTimeout(() => this.aviso.set(null), 5000);
  }
}

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
