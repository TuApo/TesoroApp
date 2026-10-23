import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subject, debounceTime, switchMap, of, catchError } from 'rxjs';
import { AlcanceContacto, OpcionFiltro, OpcionesDirectorio, ReglaContacto, UsuarioDir } from '../../modelos';
import { ChatStoreService } from '../../service/chat-store.service';
import { ComunicacionesApiService } from '../../service/comunicaciones-api.service';
import { ComActividad } from '../../components/actividad/actividad';
import { ComAvatar } from '../../components/avatar/avatar';

interface Borrador {
  id: number | null;
  contacto: UsuarioDir | null;
  motivo: string;
  rol: string;
  alcanceTipo: AlcanceContacto;
  alcanceClave: string;
  orden: number;
  activo: boolean;
}

const MOTIVOS = ['Novedades de nómina', 'Incapacidades', 'Permisos y licencias', 'Seguridad social (EPS, ARL, pensión)',
  'Préstamos y anticipos', 'Contratación', 'Dotación', 'Coordinador de finca', 'Transporte'];

/**
 * Contactos para novedades (solo administración): quién atiende a quién. Cada
 * asignación dice para qué (nómina, incapacidades…), a qué rol y dónde (toda la
 * organización, una temporal, una sede o una finca). A quien coincide le aparece esa
 * persona como favorito fijo arriba de sus chats.
 */
@Component({
  selector: 'app-com-contactos-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatTooltipModule, ComAvatar, ComActividad],
  template: `
    <div class="contactos">
      @if (sinPermiso()) {
        <div class="vacio"><mat-icon>lock</mat-icon><p>Solo la administración asigna los contactos para novedades.</p></div>
      } @else {
      <header class="cab">
        <div>
          <h2>Contactos para novedades</h2>
          <p>Define quién atiende a quién. A las personas del rol y lugar que elijas les aparece ese contacto como
            <strong>favorito fijo</strong> arriba de sus chats, con el motivo.</p>
        </div>
        @if (!borrador()) { <button type="button" class="primario" (click)="nuevo()"><mat-icon>person_add</mat-icon> Asignar contacto</button> }
      </header>

      @if (borrador(); as b) {
        <section class="form" aria-label="Asignación">
          <h3>{{ b.id ? 'Editar asignación' : 'Nueva asignación' }}</h3>
          <div class="campo">
            <span>¿Quién atiende?</span>
            @if (b.contacto; as c) {
              <div class="elegido">
                <app-com-avatar [usuarioId]="c.id" [nombre]="c.nombre" [tieneFoto]="c.tiene_foto" [tam]="36" [coordinador]="c.coordinador" />
                <div><strong>{{ c.nombre }}</strong><small>{{ sub(c) }}</small></div>
                <button type="button" class="ico" (click)="parchar({ contacto: null })" aria-label="Cambiar persona"><mat-icon>close</mat-icon></button>
              </div>
            } @else {
              <div class="buscador">
                <label class="buscar"><mat-icon>search</mat-icon>
                  <input type="search" placeholder="Nombre, cargo o sede" (input)="busqueda$.next($any($event.target).value)" /></label>
                @if (resultados().length) {
                  <div class="resultados">
                    @for (u of resultados(); track u.id) {
                      <button type="button" (click)="parchar({ contacto: u }); resultados.set([])">
                        <app-com-avatar [usuarioId]="u.id" [nombre]="u.nombre" [tieneFoto]="u.tiene_foto" [tam]="28" [coordinador]="u.coordinador" />
                        <span><strong>{{ u.nombre }}</strong><small>{{ sub(u) }}</small></span>
                      </button>
                    }
                  </div>
                }
              </div>
            }
          </div>
          <label class="campo"><span>¿Para qué se le escribe?</span>
            <input type="text" list="motivos-novedad" maxlength="120" placeholder="Ej: Novedades de nómina" [value]="b.motivo"
                   (input)="parchar({ motivo: $any($event.target).value })" />
            <datalist id="motivos-novedad">@for (m of motivos; track m) { <option [value]="m"></option> }</datalist>
          </label>
          <div class="fila2">
            <label class="campo"><span>¿A qué rol?</span>
              <select [value]="b.rol" (change)="parchar({ rol: $any($event.target).value })">
                <option value="">Todos los roles</option>
                @for (o of opciones()?.roles ?? []; track o.clave) { <option [value]="o.clave">{{ o.nombre }}</option> }
              </select></label>
            <label class="campo"><span>Orden</span>
              <input type="number" min="0" max="99" [value]="b.orden" (input)="parchar({ orden: +$any($event.target).value || 0 })" /></label>
          </div>
          <div class="campo">
            <span>¿Dónde?</span>
            <div class="segmentos" role="radiogroup">
              @for (t of tipos; track t.v) {
                <button type="button" role="radio" [attr.aria-checked]="b.alcanceTipo === t.v" [class.on]="b.alcanceTipo === t.v"
                        (click)="parchar({ alcanceTipo: t.v, alcanceClave: '' })">{{ t.t }}</button>
              }
            </div>
            @if (b.alcanceTipo !== 'TODOS') {
              <select [value]="b.alcanceClave" (change)="parchar({ alcanceClave: $any($event.target).value })">
                <option value="">Elige {{ b.alcanceTipo === 'FINCA' ? 'la finca' : b.alcanceTipo === 'SEDE' ? 'la sede' : 'la empresa' }}…</option>
                @for (o of opcionesDe(b.alcanceTipo); track o.clave) { <option [value]="o.clave">{{ o.nombre }} ({{ o.total }})</option> }
              </select>
            }
          </div>
          <p class="audiencia" aria-live="polite">
            <mat-icon>visibility</mat-icon>
            @if (audiencia() === null) { Elige a quién se le muestra. }
            @else { Le aparecerá a <strong>{{ audiencia()!.toLocaleString('es-CO') }}</strong> {{ audiencia() === 1 ? 'persona' : 'personas' }}. }
          </p>
          @if (error()) { <p class="error">{{ error() }}</p> }
          <div class="botones">
            <button type="button" (click)="borrador.set(null)">Cancelar</button>
            <button type="button" class="primario" [disabled]="!valido() || guardando()" (click)="guardar()">
              {{ guardando() ? 'Guardando…' : (b.id ? 'Guardar cambios' : 'Asignar') }}</button>
          </div>
        </section>
      }

      <div class="barra">
        <label class="buscar"><mat-icon>search</mat-icon>
          <input type="search" placeholder="Filtrar por persona, motivo o lugar" [value]="filtro()" (input)="filtro.set($any($event.target).value)" /></label>
        <small>{{ visibles().length }} de {{ reglas().length }} asignaciones</small>
      </div>

      <div class="lista">
        @for (r of visibles(); track r.id) {
          <article class="regla" [class.apagada]="!r.activo">
            <app-com-avatar [usuarioId]="r.contacto.id" [nombre]="r.contacto.nombre" [tieneFoto]="r.contacto.tiene_foto" [tam]="40"
              [presencia]="r.contacto.en_linea" [coordinador]="r.contacto.coordinador" />
            <div class="quien">
              <strong>{{ r.contacto.nombre }}</strong>
              <app-com-actividad [enLinea]="r.contacto.en_linea" [ultimaVezMs]="r.contacto.ultima_vez_ms" [corto]="true" />
            </div>
            <div class="que"><span class="motivo">{{ r.motivo }}</span>
              <small>{{ r.rol ? rolBonito(r.rol) : 'Todos los roles' }} · {{ dondeTexto(r) }}</small></div>
            <div class="n" [matTooltip]="'Personas que lo ven como favorito'"><mat-icon>groups</mat-icon>{{ r.audiencia.toLocaleString('es-CO') }}</div>
            <div class="acc">
              <button type="button" class="ico" (click)="alternar(r)" [matTooltip]="r.activo ? 'Pausar' : 'Activar'"
                      [attr.aria-label]="r.activo ? 'Pausar' : 'Activar'"><mat-icon>{{ r.activo ? 'toggle_on' : 'toggle_off' }}</mat-icon></button>
              <button type="button" class="ico" (click)="editar(r)" matTooltip="Editar" aria-label="Editar"><mat-icon>edit</mat-icon></button>
              <button type="button" class="ico rojo" (click)="borrar(r)" matTooltip="Quitar" aria-label="Quitar"><mat-icon>delete</mat-icon></button>
            </div>
          </article>
        } @empty {
          <div class="vacio"><mat-icon>support_agent</mat-icon>
            <p>{{ cargando() ? 'Cargando…' : (filtro() ? 'Nada coincide.' : 'Aún no hay contactos asignados.') }}</p>
            @if (!cargando() && !filtro()) {
              <small>Ejemplo: a los <strong>operarios</strong> de la <strong>finca La Primavera</strong> los atiende su coordinador para
                <strong>novedades de nómina</strong>.</small>
            }
          </div>
        }
      </div>
      }
    </div>`,
  styles: [`
    :host { display: block; height: 100%; }
    .contactos { height: 100%; overflow-y: auto; padding: 1rem 1.2rem 2rem; box-sizing: border-box; }
    .cab { display: flex; align-items: flex-start; gap: 1rem; justify-content: space-between; margin-bottom: .8rem; }
    .cab h2 { margin: 0 0 .2rem; font-size: 1.15rem; }
    .cab p { margin: 0; color: var(--text-2); font-size: .85rem; max-width: 640px; line-height: 1.45; }
    .primario { display: inline-flex; align-items: center; gap: .3rem; border: 0; background: var(--primary); color: #fff; border-radius: 999px;
      padding: .5rem 1rem; font: inherit; font-weight: 700; font-size: .84rem; cursor: pointer; white-space: nowrap; }
    .primario:disabled { opacity: .5; cursor: default; }
    .primario mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .form { border: 1px solid var(--border); border-radius: 14px; padding: 1rem; margin-bottom: 1rem; background: var(--surface-2);
      display: flex; flex-direction: column; gap: .75rem; max-width: 760px; }
    .form h3 { margin: 0; font-size: .95rem; }
    .campo { display: flex; flex-direction: column; gap: .3rem; min-width: 0; }
    .campo > span { font-size: .7rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
    .campo input, .campo select { font: inherit; font-size: .88rem; border: 1px solid var(--border); border-radius: 10px; padding: .5rem .6rem;
      background: var(--surface); color: var(--text); min-width: 0; }
    .fila2 { display: grid; grid-template-columns: minmax(0, 1fr) 110px; gap: .6rem; }
    .elegido { display: flex; align-items: center; gap: .6rem; border: 1px solid var(--border); border-radius: 12px; padding: .45rem .6rem;
      background: var(--surface); }
    .elegido div { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .elegido small, .resultados small { color: var(--muted); font-size: .74rem; }
    .buscador { position: relative; }
    .buscar { display: flex; align-items: center; gap: .35rem; border-radius: 999px; padding: .4rem .8rem; background: var(--surface);
      border: 1px solid var(--border); }
    .buscar mat-icon { color: var(--muted); font-size: 20px; width: 20px; height: 20px; }
    .buscar input { flex: 1; min-width: 0; border: 0 !important; outline: 0; background: transparent; font: inherit; font-size: .86rem;
      color: var(--text); padding: 0 !important; }
    .resultados { position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 5; background: var(--surface); border: 1px solid var(--border);
      border-radius: 12px; box-shadow: var(--shadow-md); max-height: 280px; overflow-y: auto; padding: .3rem; }
    .resultados button { display: flex; align-items: center; gap: .55rem; width: 100%; border: 0; background: transparent; text-align: left;
      padding: .4rem; border-radius: 8px; cursor: pointer; font: inherit; color: var(--text); }
    .resultados button:hover { background: var(--surface-3); }
    .resultados span { display: flex; flex-direction: column; min-width: 0; }
    .segmentos { display: flex; flex-wrap: wrap; gap: .3rem; }
    .segmentos button { border: 1px solid var(--border); background: var(--surface); border-radius: 999px; padding: .3rem .8rem; font: inherit;
      font-size: .8rem; cursor: pointer; color: var(--text-2); }
    .segmentos button.on { background: var(--info-bg); border-color: var(--info-border); color: var(--info-fg); font-weight: 700; }
    .audiencia { display: flex; align-items: center; gap: .35rem; margin: 0; font-size: .84rem; color: var(--text-2); }
    .audiencia mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--primary); }
    .error { margin: 0; color: var(--danger-fg); font-size: .82rem; }
    .botones { display: flex; justify-content: flex-end; gap: .5rem; }
    .botones > button:not(.primario) { border: 1px solid var(--border); background: var(--surface); border-radius: 999px; padding: .5rem 1rem;
      font: inherit; cursor: pointer; }
    .barra { display: flex; align-items: center; gap: .8rem; margin: .4rem 0 .5rem; }
    .barra .buscar { flex: 1; max-width: 420px; background: var(--surface-3); border-color: transparent; }
    .barra small { color: var(--muted); }
    .regla { display: grid; grid-template-columns: auto minmax(0, 1.1fr) minmax(0, 1.6fr) auto auto; align-items: center; gap: .8rem;
      padding: .6rem .5rem; border-bottom: 1px solid var(--border); }
    .regla.apagada { opacity: .55; }
    .quien, .que { display: flex; flex-direction: column; min-width: 0; gap: .1rem; }
    .quien strong, .motivo { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: .88rem; }
    .motivo { font-weight: 600; }
    .que small { color: var(--muted); font-size: .76rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .n { display: inline-flex; align-items: center; gap: .2rem; font-size: .8rem; color: var(--text-2); font-variant-numeric: tabular-nums; }
    .n mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--muted); }
    .acc { display: flex; }
    .ico { border: 0; background: transparent; width: 34px; height: 34px; border-radius: 50%; cursor: pointer; color: var(--text-2);
      display: inline-flex; align-items: center; justify-content: center; }
    .ico:hover { background: var(--surface-3); color: var(--primary); }
    .ico.rojo:hover { color: var(--danger-fg); }
    .vacio { text-align: center; color: var(--muted); padding: 2.5rem 1rem; }
    .vacio mat-icon { font-size: 44px; width: 44px; height: 44px; opacity: .5; }
    .vacio p { color: var(--text-2); font-weight: 600; }
    @media (max-width: 900px) {
      .contactos { padding: .8rem .8rem 2rem; }
      .cab { flex-direction: column; gap: .6rem; }
      .regla { grid-template-columns: auto minmax(0, 1fr) auto; grid-template-areas: 'av quien acc' 'av que n'; row-gap: .2rem; }
      .regla app-com-avatar { grid-area: av; }
      .quien { grid-area: quien; } .que { grid-area: que; } .n { grid-area: n; } .acc { grid-area: acc; }
    }
  `],
})
export class ContactosPage implements OnInit {
  private readonly api = inject(ComunicacionesApiService);
  private readonly store = inject(ChatStoreService);
  private readonly destroyRef = inject(DestroyRef);

  readonly motivos = MOTIVOS;
  readonly tipos: { v: AlcanceContacto; t: string }[] = [
    { v: 'FINCA', t: 'Una finca' }, { v: 'SEDE', t: 'Una sede' }, { v: 'EMPRESA', t: 'Una empresa' }, { v: 'TODOS', t: 'Toda la organización' },
  ];
  readonly reglas = signal<ReglaContacto[]>([]);
  readonly opciones = signal<OpcionesDirectorio | null>(null);
  readonly cargando = signal(true);
  readonly sinPermiso = signal(false);
  readonly filtro = signal('');
  readonly borrador = signal<Borrador | null>(null);
  readonly resultados = signal<UsuarioDir[]>([]);
  readonly audiencia = signal<number | null>(null);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  readonly busqueda$ = new Subject<string>();
  private readonly cambioAudiencia$ = new Subject<Borrador>();

  readonly visibles = computed(() => {
    const f = this.filtro().trim().toLowerCase();
    if (!f) return this.reglas();
    return this.reglas().filter(r => `${r.contacto.nombre} ${r.motivo} ${r.alcance_nombre ?? ''} ${r.rol ?? ''}`.toLowerCase().includes(f));
  });
  readonly valido = computed(() => {
    const b = this.borrador();
    return !!b && !!b.contacto && b.motivo.trim().length > 1 && (b.alcanceTipo === 'TODOS' || !!b.alcanceClave);
  });

  ngOnInit(): void {
    this.cargar();
    this.api.opcionesDirectorio().subscribe({ next: o => this.opciones.set(o) });
    this.busqueda$.pipe(debounceTime(250),
      switchMap(q => q.trim().length < 2 ? of([]) : this.api.buscarPersonas(q.trim(), 12).pipe(catchError(() => of([])))),
      takeUntilDestroyed(this.destroyRef)).subscribe(r => this.resultados.set(r));
    this.cambioAudiencia$.pipe(debounceTime(250),
      switchMap(b => b.alcanceTipo !== 'TODOS' && !b.alcanceClave ? of(null)
        : this.api.audiencia({ rol: b.rol || null, alcance_tipo: b.alcanceTipo, alcance_clave: b.alcanceClave || null,
            contacto_id: b.contacto?.id ?? null }).pipe(catchError(() => of(null)))),
      takeUntilDestroyed(this.destroyRef)).subscribe(r => this.audiencia.set(r ? r.personas : null));
  }

  cargar(): void {
    this.api.contactosAsignados().subscribe({
      next: r => { this.reglas.set(r); this.cargando.set(false); },
      error: e => { this.cargando.set(false); if (e?.status === 403) this.sinPermiso.set(true); },
    });
  }

  nuevo(): void {
    this.error.set(null);
    this.borrador.set({ id: null, contacto: null, motivo: '', rol: 'OPERARIO', alcanceTipo: 'FINCA', alcanceClave: '', orden: 0, activo: true });
    this.audiencia.set(null);
  }

  editar(r: ReglaContacto): void {
    this.error.set(null);
    const b: Borrador = { id: r.id, contacto: r.contacto, motivo: r.motivo, rol: r.rol ?? '', alcanceTipo: r.alcance_tipo,
      alcanceClave: r.alcance_clave ?? '', orden: r.orden, activo: r.activo };
    this.borrador.set(b);
    this.cambioAudiencia$.next(b);
  }

  parchar(c: Partial<Borrador>): void {
    const b = this.borrador();
    if (!b) return;
    const nuevo = { ...b, ...c };
    this.borrador.set(nuevo);
    if ('rol' in c || 'alcanceTipo' in c || 'alcanceClave' in c || 'contacto' in c) this.cambioAudiencia$.next(nuevo);
  }

  opcionesDe(tipo: AlcanceContacto): OpcionFiltro[] {
    const o = this.opciones();
    if (!o) return [];
    return tipo === 'FINCA' ? o.fincas : tipo === 'SEDE' ? o.sedes : tipo === 'EMPRESA' ? o.empresas : [];
  }

  guardar(): void {
    const b = this.borrador();
    if (!b || !this.valido()) return;
    const nombre = this.opcionesDe(b.alcanceTipo).find(o => o.clave === b.alcanceClave)?.nombre ?? null;
    const req = { contacto_id: b.contacto!.id, motivo: b.motivo.trim(), rol: b.rol || null, alcance_tipo: b.alcanceTipo,
      alcance_clave: b.alcanceTipo === 'TODOS' ? null : b.alcanceClave, alcance_nombre: nombre, orden: b.orden, activo: b.activo };
    this.guardando.set(true);
    this.error.set(null);
    (b.id ? this.api.actualizarContacto(b.id, req) : this.api.crearContacto(req)).subscribe({
      next: () => { this.guardando.set(false); this.borrador.set(null); this.cargar(); this.store.cargarFavoritos(); },
      error: e => { this.guardando.set(false); this.error.set(e?.error?.message ?? e?.error?.detail ?? 'No se pudo guardar'); },
    });
  }

  alternar(r: ReglaContacto): void {
    this.api.actualizarContacto(r.id, { activo: !r.activo }).subscribe({
      next: n => this.reglas.update(l => l.map(x => x.id === n.id ? n : x)),
    });
  }

  borrar(r: ReglaContacto): void {
    if (!confirm(`¿Quitar a ${r.contacto.nombre} como contacto de "${r.motivo}"?`)) return;
    this.api.borrarContacto(r.id).subscribe({ next: () => this.reglas.update(l => l.filter(x => x.id !== r.id)) });
  }

  sub(u: UsuarioDir): string { return [u.cargo, u.lugar].filter(x => !!x).join(' · '); }

  rolBonito(rol: string): string { return this.opciones()?.roles.find(o => o.clave === rol)?.nombre ?? rol; }

  dondeTexto(r: ReglaContacto): string {
    if (r.alcance_tipo === 'TODOS') return 'Toda la organización';
    const pre = r.alcance_tipo === 'FINCA' ? 'Finca' : r.alcance_tipo === 'SEDE' ? 'Sede' : 'Empresa';
    const nombre = r.alcance_nombre ?? r.alcance_clave ?? '';
    return nombre.toLowerCase().startsWith(pre.toLowerCase()) ? nombre : `${pre} ${nombre}`;
  }
}
