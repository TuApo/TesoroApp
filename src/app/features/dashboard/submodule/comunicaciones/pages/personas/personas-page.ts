import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subject, debounceTime } from 'rxjs';
import { AtajoDirectorio, FiltroActividad, OpcionesDirectorio, PersonaItem, UsuarioDir, atajosDirectorio } from '../../modelos';
import { ChatStoreService } from '../../service/chat-store.service';
import { ComunicacionesApiService } from '../../service/comunicaciones-api.service';
import { LlamadaService } from '../../service/llamada.service';
import { ComActividad } from '../../components/actividad/actividad';
import { ComAvatar } from '../../components/avatar/avatar';

/**
 * Personas de la organización: buscar por nombre, cargo, finca o empresa y filtrar por
 * grupo de personal (administrativos de apoyo, coordinadores, equipo virtual, en
 * misión), empresa temporal, rol, finca, sede y actividad. Primero quien está en línea;
 * de un clic se le escribe, se le llama o se marca como favorito.
 */
@Component({
  selector: 'app-com-personas-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatTooltipModule, ComAvatar, ComActividad],
  template: `
    <div class="personas">
      <header class="barra">
        <label class="buscar"><mat-icon>search</mat-icon>
          <input type="search" placeholder="Busca por nombre, cargo, finca, sede o empresa" [value]="q()"
                 (input)="escribir($any($event.target).value)" aria-label="Buscar personas" />
        </label>
        <button type="button" class="btn-filtros" [class.on]="verFiltros()" (click)="verFiltros.update(v => !v)">
          <mat-icon>tune</mat-icon> Filtros @if (filtrosActivos()) { <b>{{ filtrosActivos() }}</b> }
        </button>
      </header>

      <div class="actividad" role="tablist" aria-label="Actividad">
        @for (a of actividades; track a.v) {
          <button type="button" role="tab" [class.on]="act() === a.v" [attr.aria-selected]="act() === a.v" (click)="cambiar('act', a.v)">
            <i [attr.data-a]="a.v"></i>{{ a.t }}</button>
        }
      </div>

      @if (atajos().length) {
        <div class="atajos" role="group" aria-label="Grupos y empresas">
          @for (a of atajos(); track a.tipo + a.clave) {
            <button type="button" [class.on]="atajoActivo(a)" [attr.aria-pressed]="atajoActivo(a)" [attr.data-tipo]="a.tipo"
                    (click)="alternarAtajo(a)">
              <mat-icon>{{ a.icono }}</mat-icon>{{ a.nombre }}<small>{{ a.total.toLocaleString('es-CO') }}</small></button>
          }
        </div>
      }

      @if (verFiltros()) {
        <div class="filtros">
          <label><span>Grupo</span>
            <select [value]="grupo() ?? ''" (change)="cambiar('grupo', $any($event.target).value)">
              <option value="">Todos los grupos</option>
              @for (o of opciones()?.grupos ?? []; track o.clave) { <option [value]="o.clave">{{ o.nombre }} ({{ o.total }})</option> }
            </select></label>
          <label><span>Rol</span>
            <select [value]="rol() ?? ''" (change)="cambiar('rol', $any($event.target).value)">
              <option value="">Todos los roles</option>
              @for (o of opciones()?.roles ?? []; track o.clave) { <option [value]="o.clave">{{ o.nombre }} ({{ o.total }})</option> }
            </select></label>
          <label><span>Finca</span>
            <select [value]="finca() ?? ''" (change)="cambiar('finca', $any($event.target).value)">
              <option value="">Todas las fincas</option>
              @for (o of opciones()?.fincas ?? []; track o.clave) { <option [value]="o.clave">{{ o.nombre }} ({{ o.total }})</option> }
            </select></label>
          <label><span>Sede</span>
            <select [value]="sede() ?? ''" (change)="cambiar('sede', $any($event.target).value)">
              <option value="">Todas las sedes</option>
              @for (o of opciones()?.sedes ?? []; track o.clave) { <option [value]="o.clave">{{ o.nombre }} ({{ o.total }})</option> }
            </select></label>
          <label><span>Empresa</span>
            <select [value]="empresa() ?? ''" (change)="cambiar('empresa', $any($event.target).value)">
              <option value="">Todas</option>
              @for (o of opciones()?.empresas ?? []; track o.clave) { <option [value]="o.clave">{{ o.nombre }} ({{ o.total }})</option> }
            </select></label>
          @if (filtrosActivos()) { <button type="button" class="limpiar" (click)="limpiar()"><mat-icon>filter_alt_off</mat-icon> Limpiar</button> }
        </div>
      }

      <p class="resumen" aria-live="polite">
        @if (cargando() && !items().length) { Buscando… }
        @else { <strong>{{ total().toLocaleString('es-CO') }}</strong> {{ total() === 1 ? 'persona' : 'personas' }}
          @if (enLineaVisibles()) { · <span class="verde">{{ enLineaVisibles() }} en línea</span> } }
      </p>

      <div class="lista" (scroll)="alScroll($event)">
        @for (it of items(); track it.usuario.id) {
          <article class="persona" [class.inactiva]="!it.usuario.ultima_vez_ms && !it.usuario.en_linea">
            <app-com-avatar [usuarioId]="it.usuario.id" [nombre]="it.usuario.nombre" [tieneFoto]="it.usuario.tiene_foto" [tam]="44"
              [presencia]="it.usuario.en_linea" [coordinador]="it.usuario.coordinador" />
            <div class="info">
              <div class="l1"><strong>{{ it.usuario.nombre }}</strong>
                @if (it.usuario.coordinador) { <em class="coord">Coordinador</em> }
                @if (it.usuario.grupo) { <em class="grp">{{ it.usuario.grupo }}</em> }</div>
              <div class="l2">{{ detalle(it.usuario) }}</div>
              <div class="l3"><app-com-actividad [enLinea]="it.usuario.en_linea" [ultimaVezMs]="it.usuario.ultima_vez_ms" />
                @if (it.usuario.rol) { <span class="rol">{{ rolBonito(it.usuario.rol) }}</span> }</div>
            </div>
            <div class="acciones">
              <button type="button" class="ico estrella" [class.on]="esFavorito(it)" (click)="alternarEstrella(it)"
                      [matTooltip]="esFavorito(it) ? 'Quitar de favoritos' : 'Agregar a favoritos'"
                      [attr.aria-label]="esFavorito(it) ? 'Quitar de favoritos' : 'Agregar a favoritos'">
                <mat-icon>{{ esFavorito(it) ? 'star' : 'star_outline' }}</mat-icon></button>
              <button type="button" class="ico" (click)="llamar(it.usuario, 'AUDIO')" [disabled]="ll.enLlamada()" matTooltip="Llamar"
                      [attr.aria-label]="'Llamar a ' + it.usuario.nombre"><mat-icon>call</mat-icon></button>
              <button type="button" class="ico video" (click)="llamar(it.usuario, 'VIDEO')" [disabled]="ll.enLlamada()" matTooltip="Videollamada"
                      [attr.aria-label]="'Videollamada con ' + it.usuario.nombre"><mat-icon>videocam</mat-icon></button>
              <button type="button" class="chat" (click)="chatear(it.usuario)" [attr.aria-label]="'Escribir a ' + it.usuario.nombre">
                <mat-icon>chat</mat-icon><span>Escribir</span></button>
            </div>
          </article>
        } @empty {
          @if (!cargando()) {
            <div class="vacio"><mat-icon>person_search</mat-icon>
              <p>Nadie coincide con esa búsqueda.</p>
              @if (filtrosActivos() || act() !== 'TODOS') { <button type="button" (click)="limpiar(true)">Quitar filtros</button> }
            </div>
          }
        }
        @if (hayMas()) {
          <button type="button" class="mas" [disabled]="cargando()" (click)="cargar(false)">
            {{ cargando() ? 'Cargando…' : 'Ver más personas' }}</button>
        }
      </div>
    </div>`,
  styles: [`
    :host { display: block; height: 100%; }
    .personas { display: flex; flex-direction: column; height: 100%; min-height: 0; }
    .barra { display: flex; gap: .5rem; align-items: center; padding: .8rem 1rem .4rem; }
    .buscar { flex: 1; min-width: 0; display: flex; align-items: center; gap: .45rem; border-radius: 999px; padding: .5rem .9rem;
      background: var(--surface-3); border: 1px solid transparent; }
    .buscar:focus-within { border-color: var(--primary); background: var(--surface); }
    .buscar mat-icon { color: var(--muted); }
    .buscar input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font: inherit; font-size: .92rem; color: var(--text); }
    .btn-filtros { display: inline-flex; align-items: center; gap: .3rem; border: 1px solid var(--border); background: var(--surface);
      border-radius: 999px; padding: .45rem .85rem; font: inherit; font-size: .82rem; font-weight: 600; color: var(--text-2); cursor: pointer; flex: none; }
    .btn-filtros.on { border-color: var(--primary); color: var(--primary); }
    .btn-filtros b { background: var(--primary); color: #fff; border-radius: 999px; font-size: .68rem; padding: 0 .4rem; }
    .btn-filtros mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .actividad { display: flex; gap: .35rem; padding: .2rem 1rem .4rem; overflow-x: auto; scrollbar-width: none; }
    .actividad button { display: inline-flex; align-items: center; gap: .35rem; border: 1px solid var(--border); background: var(--surface);
      border-radius: 999px; padding: .28rem .75rem; font: inherit; font-size: .78rem; color: var(--text-2); cursor: pointer; white-space: nowrap; }
    .actividad button.on { background: var(--info-bg); border-color: var(--info-border); color: var(--info-fg); font-weight: 700; }
    .actividad i { width: 8px; height: 8px; border-radius: 50%; background: var(--text-faint); }
    .actividad i[data-a='EN_LINEA'] { background: #22C55E; }
    .actividad i[data-a='RECIENTE'] { background: #FCD34D; }
    .actividad i[data-a='NUNCA'] { background: transparent; border: 1.5px solid var(--text-faint); box-sizing: border-box; }
    .atajos { display: flex; gap: .35rem; padding: .1rem 1rem .45rem; overflow-x: auto; scrollbar-width: none; }
    .atajos button { display: inline-flex; align-items: center; gap: .3rem; border: 1px dashed var(--border); background: transparent;
      border-radius: 999px; padding: .26rem .7rem; font: inherit; font-size: .78rem; color: var(--text-2); cursor: pointer; white-space: nowrap;
      min-height: 0 !important; }
    .atajos button mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--muted); }
    .atajos button small { font-size: .68rem; color: var(--muted); }
    .atajos button.on { border-style: solid; border-color: var(--primary); background: var(--info-bg); color: var(--info-fg); font-weight: 700; }
    .atajos button.on mat-icon, .atajos button.on small { color: inherit; }
    .filtros { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)) auto; gap: .5rem; padding: .3rem 1rem .5rem; align-items: end; }
    .filtros label { display: flex; flex-direction: column; gap: .2rem; min-width: 0; }
    .filtros span { font-size: .68rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
    .filtros select { font: inherit; font-size: .84rem; border: 1px solid var(--border); border-radius: 10px; padding: .45rem .5rem;
      background: var(--surface); color: var(--text); min-width: 0; width: 100%; }
    .limpiar { display: inline-flex; align-items: center; gap: .25rem; border: 0; background: transparent; color: var(--danger-fg); font: inherit;
      font-size: .8rem; font-weight: 600; cursor: pointer; padding: .45rem .3rem; }
    .limpiar mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .resumen { margin: 0; padding: .2rem 1rem .5rem; font-size: .8rem; color: var(--muted); border-bottom: 1px solid var(--border); }
    .resumen strong { color: var(--text); }
    .verde { color: var(--com-ok-txt); font-weight: 700; }
    .lista { flex: 1; min-height: 0; overflow-y: auto; padding: .3rem .6rem 1rem; }
    .persona { display: flex; align-items: center; gap: .75rem; padding: .6rem .5rem; border-radius: 12px; }
    .persona:hover { background: var(--surface-2); }
    .persona.inactiva app-com-avatar { opacity: .75; }
    .info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: .08rem; }
    .l1 { display: flex; align-items: center; gap: .35rem; min-width: 0; }
    .l1 strong { font-size: .9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .coord { font-style: normal; font-size: .62rem; font-weight: 800; color: var(--com-ambar-txt); background: var(--com-ambar-bg); border: 1px solid var(--com-ambar-borde);
      border-radius: 999px; padding: 0 .35rem; flex: none; }
    .grp { font-style: normal; font-size: .62rem; font-weight: 800; color: var(--info-fg); background: var(--info-bg); border: 1px solid var(--info-border);
      border-radius: 999px; padding: 0 .35rem; flex: none; white-space: nowrap; }
    .l2 { font-size: .78rem; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .l3 { display: flex; align-items: center; gap: .5rem; min-width: 0; }
    .rol { font-size: .66rem; color: var(--muted); border: 1px solid var(--border); border-radius: 999px; padding: 0 .4rem; flex: none; }
    .acciones { display: flex; align-items: center; gap: .15rem; flex: none; }
    .ico { border: 0; background: transparent; width: 36px; height: 36px; border-radius: 50%; color: var(--text-2); cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center; }
    .ico:hover { background: var(--surface-3); color: var(--primary); }
    .ico:disabled { opacity: .35; cursor: default; }
    .estrella.on { color: #F59E0B; }
    .chat { display: inline-flex; align-items: center; gap: .3rem; border: 0; background: var(--primary); color: #fff; border-radius: 999px;
      padding: .4rem .85rem; font: inherit; font-size: .8rem; font-weight: 700; cursor: pointer; margin-left: .2rem; }
    .chat mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .vacio { text-align: center; color: var(--muted); padding: 3rem 1rem; }
    .vacio mat-icon { font-size: 48px; width: 48px; height: 48px; opacity: .5; }
    .vacio button { border: 1px solid var(--border); background: var(--surface); border-radius: 999px; padding: .35rem .9rem; font: inherit; cursor: pointer; }
    .mas { display: block; margin: .8rem auto 0; border: 1px solid var(--border); background: var(--surface); border-radius: 999px;
      padding: .5rem 1.2rem; font: inherit; font-weight: 600; cursor: pointer; color: var(--primary); }
    @media (max-width: 900px) {
      .filtros { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
      .barra { padding: .6rem .7rem .3rem; }
      .actividad, .atajos, .filtros, .resumen { padding-left: .7rem; padding-right: .7rem; }
      .lista { padding: .2rem .3rem 1rem; }
      .persona { gap: .55rem; padding: .55rem .3rem; border-bottom: 1px solid var(--border); border-radius: 0; align-items: flex-start; }
      .acciones { gap: 0; }
      .ico { width: 34px; height: 34px; }
      .ico.video { display: none; }
      .chat { width: 36px; height: 36px; padding: 0; justify-content: center; border-radius: 50%; margin-left: .1rem; }
      .chat span { display: none; }
      .l2 { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    }
  `],
})
export class PersonasPage implements OnInit {
  private readonly api = inject(ComunicacionesApiService);
  private readonly store = inject(ChatStoreService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly ll = inject(LlamadaService);

  readonly actividades: { v: FiltroActividad; t: string }[] = [
    { v: 'TODOS', t: 'Todas' }, { v: 'EN_LINEA', t: 'En línea' },
    { v: 'RECIENTE', t: 'Activas esta semana' }, { v: 'NUNCA', t: 'No han entrado' },
  ];

  readonly q = signal('');
  readonly act = signal<FiltroActividad>('TODOS');
  readonly rol = signal<string | null>(null);
  readonly finca = signal<string | null>(null);
  readonly sede = signal<string | null>(null);
  readonly empresa = signal<string | null>(null);
  readonly grupo = signal<string | null>(null);
  readonly verFiltros = signal(typeof window !== 'undefined' && window.innerWidth > 900);
  readonly opciones = signal<OpcionesDirectorio | null>(null);
  readonly items = signal<PersonaItem[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(false);
  readonly filtrosActivos = computed(() => [this.grupo(), this.rol(), this.finca(), this.sede(), this.empresa()].filter(Boolean).length);
  /** Grupos de personal y empresas temporales como atajos de un clic. */
  readonly atajos = computed(() => atajosDirectorio(this.opciones()));
  readonly enLineaVisibles = computed(() => this.items().filter(i => i.usuario.en_linea).length);
  readonly hayMas = computed(() => this.items().length < this.total());
  private pagina = 0;
  private pedido = 0;
  private readonly escritura$ = new Subject<string>();

  ngOnInit(): void {
    this.api.opcionesDirectorio().subscribe({ next: o => this.opciones.set(o) });
    this.escritura$.pipe(debounceTime(280), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.cargar(true));
    this.cargar(true);
  }

  escribir(v: string): void { this.q.set(v); this.escritura$.next(v); }

  cambiar(que: 'act' | 'grupo' | 'rol' | 'finca' | 'sede' | 'empresa', v: string): void {
    const valor = v || null;
    switch (que) {
      case 'act': this.act.set((v || 'TODOS') as FiltroActividad); break;
      case 'grupo': this.grupo.set(valor); break;
      case 'rol': this.rol.set(valor); break;
      case 'finca': this.finca.set(valor); break;
      case 'sede': this.sede.set(valor); break;
      case 'empresa': this.empresa.set(valor); break;
    }
    this.cargar(true);
  }

  atajoActivo(a: AtajoDirectorio): boolean {
    return (a.tipo === 'grupo' ? this.grupo() : this.empresa()) === a.clave;
  }

  /** Un clic filtra por ese grupo o empresa; otro clic lo quita. Grupo y empresa se combinan. */
  alternarAtajo(a: AtajoDirectorio): void {
    this.cambiar(a.tipo, this.atajoActivo(a) ? '' : a.clave);
  }

  limpiar(todo = false): void {
    this.grupo.set(null); this.rol.set(null); this.finca.set(null); this.sede.set(null); this.empresa.set(null);
    if (todo) { this.act.set('TODOS'); this.q.set(''); }
    this.cargar(true);
  }

  cargar(reiniciar: boolean): void {
    if (reiniciar) this.pagina = 0;
    const n = ++this.pedido;
    this.cargando.set(true);
    this.api.directorio({
      q: this.q().trim(), grupo: this.grupo(), rol: this.rol(), finca: this.finca(), sede: this.sede(), empresa: this.empresa(),
      actividad: this.act(), pagina: this.pagina, tamano: 40,
    }).subscribe({
      next: r => {
        if (n !== this.pedido) return; // llegó tarde: ya hay otra búsqueda
        this.items.update(prev => reiniciar ? r.items : [...prev, ...r.items.filter(x => !prev.some(y => y.usuario.id === x.usuario.id))]);
        this.total.set(r.total);
        this.pagina = r.pagina + 1;
        this.cargando.set(false);
      },
      error: () => { if (n === this.pedido) this.cargando.set(false); },
    });
  }

  alScroll(e: Event): void {
    const el = e.target as HTMLElement;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200 && this.hayMas() && !this.cargando()) this.cargar(false);
  }

  detalle(u: UsuarioDir): string {
    return [u.cargo, u.lugar, u.empresa, u.correo].filter(Boolean).join(' · ');
  }

  rolBonito(rol: string): string {
    return this.opciones()?.roles.find(r => r.clave === rol.toUpperCase())?.nombre ?? rol;
  }

  esFavorito(it: PersonaItem): boolean { return it.favorito; }

  async alternarEstrella(it: PersonaItem): Promise<void> {
    const poner = !it.favorito;
    this.items.update(l => l.map(x => x.usuario.id === it.usuario.id ? { ...x, favorito: poner } : x));
    try { await this.store.estrella(it.usuario.id, poner); }
    catch { this.items.update(l => l.map(x => x.usuario.id === it.usuario.id ? { ...x, favorito: !poner } : x)); }
  }

  async chatear(u: UsuarioDir): Promise<void> {
    const c = await this.store.abrirDirecta(u.id);
    void this.router.navigate(['/dashboard/comunicaciones/chats'], { queryParams: { c: c.id } });
  }

  async llamar(u: UsuarioDir, tipo: 'AUDIO' | 'VIDEO'): Promise<void> {
    const c = await this.store.abrirDirecta(u.id);
    void this.ll.llamar(c.id, tipo);
  }
}
