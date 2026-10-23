import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, debounceTime, of, switchMap } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Conversacion, Favorito, ParticipanteOut, UsuarioDir } from '../../modelos';
import { ComunicacionesApiService } from '../../service/comunicaciones-api.service';
import { ChatStoreService } from '../../service/chat-store.service';
import { horaCorta, iconoConversacion, primerNombre } from '../../utiles';
import { ComActividad } from '../actividad/actividad';
import { ComAvatar } from '../avatar/avatar';

/**
 * La lista de conversaciones (en el dock y en la página), con búsqueda y filtros.
 * Arriba, los coordinadores de la persona (a un clic para escribirles) y la línea de
 * soporte con el asistente si todavía no la ha abierto.
 */
@Component({
  selector: 'app-com-lista-chats',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // En el dock (sin filtros) los favoritos van compactos para dejarle espacio a los chats.
  host: { '[class.compacta]': '!conFiltros()' },
  imports: [MatIconModule, MatTooltipModule, ComAvatar, ComActividad],
  template: `
    <label class="buscar"><mat-icon>search</mat-icon>
      <input #caja type="search" placeholder="Buscar chats o personas" [value]="filtro()" (input)="escribir($any($event.target).value)"
             aria-label="Buscar chats o personas de la organización" />
      @if (filtro()) { <button type="button" class="limpiar" (click)="escribir(''); caja.focus()" aria-label="Limpiar búsqueda"><mat-icon>close</mat-icon></button> }
    </label>
    @if (conFiltros()) {
      <div class="filtros">
        @for (f of filtros; track f.v) {
          <button type="button" [class.on]="modo() === f.v" (click)="modo.set(f.v)">{{ f.t }}</button>
        }
      </div>
    }
    <div class="lista">
      @if (extras()) {
        <div class="favs" role="list" aria-label="Favoritos">
          <div class="sec">
            <span><mat-icon>star</mat-icon> Favoritos</span>
            <button type="button" class="ver" (click)="enfocarBusqueda()"><mat-icon>person_search</mat-icon> Buscar personas</button>
          </div>
          @if (store.favoritos().length) {
            <div class="tira">
              @for (f of store.favoritos(); track f.usuario.id) {
                <button type="button" class="fav" role="listitem" [class.fijo]="f.origen !== 'PERSONAL'" (click)="hablarCon(f.usuario.id)"
                        [matTooltip]="tooltip(f)" [attr.aria-label]="'Escribir a ' + f.usuario.nombre">
                  <app-com-avatar [usuarioId]="f.usuario.id" [nombre]="f.usuario.nombre" [tieneFoto]="f.usuario.tiene_foto" [tam]="40"
                    [presencia]="f.usuario.en_linea" [coordinador]="f.usuario.coordinador" />
                  <strong>{{ primer(f.usuario.nombre) }}</strong>
                  <small class="motivo">{{ f.motivo || f.usuario.cargo || '' }}</small>
                  <app-com-actividad [enLinea]="f.usuario.en_linea" [ultimaVezMs]="f.usuario.ultima_vez_ms" [corto]="true" />
                </button>
              }
            </div>
          } @else {
            <p class="sin-favs">Aún no tienes favoritos. <button type="button" (click)="enfocarBusqueda()">Busca a alguien</button>
              y márcalo con ★.</p>
          }
        </div>
      }
      @if (buscaPersonas() && visibles().length) { <div class="sec-res"><mat-icon>forum</mat-icon> Chats</div> }
      @for (c of visibles(); track c.id) {
        <button type="button" class="fila" [class.activa]="c.id === activa()" [class.noleido]="c.no_leidos > 0 && !c.silenciada"
                (click)="elegir.emit(c.id)">
          <app-com-avatar [usuarioId]="c.otro_usuario_id" [nombre]="c.nombre" [tieneFoto]="foto(c)" [grupo]="c.tipo === 'GRUPO'"
            [icono]="icono(c)" [color]="c.color ?? (c.tipo === 'SOPORTE' ? '#0B6B58' : null)" [tam]="40"
            [presencia]="c.tipo === 'DIRECTA' ? enLinea(c) : null" [coordinador]="!!otro(c)?.coordinador" />
          <span class="txt">
            <span class="l1"><strong>{{ c.nombre }}</strong>
              @if (subtitulo(c); as st) { <span class="cargo">{{ st }}</span> }
              <small>{{ hora(c.ultimo_mensaje_en ?? c.creado_en) }}</small></span>
            <span class="l2">
              @if (c.llamada_activa) { <mat-icon class="en-llamada">call</mat-icon> }
              @if (escribe(c)) { <em>escribiendo…</em> }
              @else { <span class="prev">{{ prefijo(c) }}{{ c.ultimo_mensaje_texto ?? 'Sin mensajes todavía' }}</span> }
              @if (c.fijada) { <mat-icon class="mini">push_pin</mat-icon> }
              @if (c.silenciada) { <mat-icon class="mini">notifications_off</mat-icon> }
              @if (c.no_leidos > 0) { <b class="badge" [class.gris]="c.silenciada">{{ c.no_leidos > 99 ? '99+' : c.no_leidos }}</b> }
            </span>
          </span>
        </button>
      } @empty {
        <div class="vacio">
          @if (!store.cargado()) { Cargando… }
          @else if (filtro() || modo() !== 'todos') { @if (!buscaPersonas()) { Nada coincide. } }
          @else { <mat-icon>forum</mat-icon><p>Aún no tienes conversaciones.</p><small>Empieza un chat con el botón <b>+</b>.</small> }
        </div>
      }
      @if (extras() && !store.miSoporte()) {
        <button type="button" class="fila soporte" (click)="abrirSoporte()" [disabled]="abriendoSoporte()">
          <app-com-avatar nombre="Soporte" icono="support_agent" color="#0B6B58" [tam]="40" />
          <span class="txt">
            <span class="l1"><strong>Soporte TuApo</strong><em class="chip">IA</em></span>
            <span class="l2"><span class="prev">Tus desprendibles, certificados, tu contrato o cómo hacer algo</span></span>
          </span>
        </button>
      }
      @if (buscaPersonas()) {
        <div class="sec-res"><mat-icon>person_search</mat-icon> Personas de la organización</div>
        @for (u of personasVisibles(); track u.id) {
          <div class="fila persona" role="button" tabindex="0" (click)="hablarCon(u.id)" (keydown.enter)="hablarCon(u.id)"
               [attr.aria-label]="'Escribir a ' + u.nombre">
            <app-com-avatar [usuarioId]="u.id" [nombre]="u.nombre" [tieneFoto]="u.tiene_foto" [tam]="40"
              [presencia]="u.en_linea" [coordinador]="u.coordinador" />
            <span class="txt">
              <span class="l1"><strong>{{ u.nombre }}</strong>@if (u.cargo) { <span class="cargo">{{ u.cargo }}</span> }</span>
              <span class="l2"><app-com-actividad [enLinea]="u.en_linea" [ultimaVezMs]="u.ultima_vez_ms" [corto]="true" />
                @if (u.lugar) { <span class="prev">· {{ u.lugar }}</span> }</span>
            </span>
            <button type="button" class="ico-estrella" [class.on]="store.estrellas().has(u.id)" (click)="$event.stopPropagation(); estrella(u)"
                    [matTooltip]="store.estrellas().has(u.id) ? 'Quitar de favoritos' : 'Agregar a favoritos'"
                    [attr.aria-label]="store.estrellas().has(u.id) ? 'Quitar de favoritos' : 'Agregar a favoritos'">
              <mat-icon>{{ store.estrellas().has(u.id) ? 'star' : 'star_outline' }}</mat-icon></button>
          </div>
        } @empty {
          <p class="vacio-p">{{ buscandoPersonas() ? 'Buscando…' : 'Nadie en la organización coincide con “' + filtro().trim() + '”.' }}</p>
        }
      }
    </div>`,
  styles: [`
    :host { display: flex; flex-direction: column; min-height: 0; min-width: 0; height: 100%; overflow: hidden; }
    /* width:auto: hay una regla global .buscar { width:100% } que, con el margen, se salía por la derecha. */
    .buscar { display: flex; align-items: center; gap: .35rem; margin: .5rem .6rem .35rem; border-radius: 999px; padding: .3rem .7rem;
      background: var(--surface-3); width: auto; box-sizing: border-box; }
    .buscar mat-icon { color: var(--muted); font-size: 20px; width: 20px; height: 20px; }
    .buscar input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font: inherit; font-size: .85rem; color: var(--text); }
    .buscar .limpiar { border: 0; background: transparent; color: var(--muted); cursor: pointer; display: inline-flex; padding: 0; min-height: 0; }
    .buscar .limpiar mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .sec-res { display: flex; align-items: center; gap: .3rem; margin: .45rem .5rem .2rem; font-size: .68rem; font-weight: 800;
      text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
    .sec-res mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .fila.persona { outline: none; }
    .fila.persona:focus-visible { background: var(--surface-3); }
    .fila.persona .l2 { gap: .35rem; }
    .ico-estrella { border: 0; background: transparent; color: var(--muted); width: 32px; height: 32px; border-radius: 50%; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center; flex: none; min-height: 0; }
    .ico-estrella:hover { background: var(--surface-3); }
    .ico-estrella.on { color: #F59E0B; }
    .vacio-p { margin: .3rem .6rem .6rem; font-size: .78rem; color: var(--muted); }
    .filtros { display: flex; gap: .3rem; padding: 0 .6rem .35rem; flex-wrap: wrap; }
    .filtros button { border: 1px solid var(--border); background: var(--surface); border-radius: 999px; padding: .15rem .6rem; font: inherit;
      font-size: .74rem; cursor: pointer; color: var(--text-2); }
    .filtros button.on { background: var(--info-bg); border-color: var(--info-border); color: var(--info-fg); font-weight: 700; }
    .lista { flex: 1; overflow-y: auto; padding: 0 .3rem .4rem; }
    .fila { display: flex; align-items: center; gap: .6rem; width: 100%; border: 0; background: transparent; text-align: left; padding: .5rem .45rem;
      border-radius: 12px; cursor: pointer; font: inherit; color: var(--text); }
    .fila:hover { background: var(--surface-3); }
    .fila.activa { background: var(--info-bg); }
    .txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: .1rem; }
    .l1 { display: flex; align-items: baseline; gap: .4rem; }
    .l1 strong { flex: 0 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: .88rem; font-weight: 600; }
    .l1 .cargo { flex: 1 1 0; min-width: 2.5rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: .72rem; color: var(--muted); }
    .l1 small { color: var(--muted); font-size: .7rem; flex: none; margin-left: auto; }
    .chip { font-style: normal; font-size: .62rem; font-weight: 800; letter-spacing: .04em; color: var(--com-verde-txt); background: var(--com-verde-bg);
      border-radius: 999px; padding: 0 .4rem; flex: none; }
    .fila.soporte { border: 1px dashed var(--border); margin-bottom: .25rem; }
    .fila.soporte:disabled { opacity: .6; cursor: progress; }
    .favs { padding: .1rem .15rem .4rem; min-width: 0; }
    .sec { display: flex; align-items: center; justify-content: space-between; gap: .25rem; padding: .15rem .35rem .3rem; }
    .sec > span { display: inline-flex; align-items: center; gap: .25rem; font-size: .7rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: .05em; color: var(--muted); }
    .sec mat-icon { font-size: 14px; width: 14px; height: 14px; color: #F59E0B; }
    .ver { display: inline-flex; align-items: center; border: 0; background: transparent; color: var(--primary); font: inherit; font-size: .74rem;
      font-weight: 700; cursor: pointer; padding: .1rem .2rem; border-radius: 6px; }
    .ver:hover { background: var(--info-bg); }
    .ver mat-icon { font-size: 16px; width: 16px; height: 16px; color: inherit; }
    .tira { display: flex; gap: .35rem; overflow-x: auto; padding: 0 .1rem .3rem; scrollbar-width: thin; max-width: 100%; }
    .fav { flex: none; width: 92px; display: flex; flex-direction: column; align-items: center; gap: .12rem; border: 1px solid var(--border);
      background: var(--surface); border-radius: 12px; padding: .5rem .3rem .4rem; cursor: pointer; font: inherit; color: var(--text); min-width: 0; }
    .fav.fijo { border-color: var(--com-ambar-borde); background: var(--com-ambar-bg); }
    .fav:hover { border-color: #F59E0B; }
    .fav strong { font-size: .76rem; font-weight: 700; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: .1rem; }
    .fav .motivo { font-size: .64rem; color: var(--text-2); max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .fav app-com-actividad { max-width: 100%; }
    :host(.compacta) .fav { width: 68px; padding: .4rem .15rem .35rem; gap: .08rem; }
    :host(.compacta) .fav .motivo, :host(.compacta) .fav app-com-actividad { display: none; }
    :host(.compacta) .fav strong { font-size: .76rem; }
    :host(.compacta) .favs { padding-bottom: .15rem; border-bottom: 1px solid var(--border); margin-bottom: .2rem; }
    /* Barras de desplazamiento finas (en Windows las del sistema se comen el dock). */
    .lista, .tira { scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--text) 28%, transparent) transparent; }
    .lista::-webkit-scrollbar { width: 6px; }
    .tira::-webkit-scrollbar { height: 5px; }
    .lista::-webkit-scrollbar-thumb, .tira::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--text) 28%, transparent); border-radius: 6px; }
    .sin-favs { margin: 0 .4rem .2rem; font-size: .74rem; color: var(--muted); line-height: 1.4; }
    .sin-favs button { border: 0; background: transparent; padding: 0; color: var(--primary); font: inherit; font-weight: 700; cursor: pointer;
      line-height: inherit; min-height: 0; height: auto; vertical-align: baseline; }
    .l2 { display: flex; align-items: center; gap: .3rem; font-size: .78rem; color: var(--muted); }
    .prev { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .noleido .l1 strong, .noleido .prev { font-weight: 800; color: var(--text); }
    em { flex: 1; color: var(--lime-ink, #4E8A12); font-style: normal; font-weight: 600; }
    .badge { background: var(--brand-blue, #2B59F0); color: #fff; border-radius: 999px; font-size: .68rem; min-width: 18px; height: 18px;
      display: inline-flex; align-items: center; justify-content: center; padding: 0 .3rem; flex: none; }
    .badge.gris { background: var(--text-faint); }
    .mini { font-size: 14px; width: 14px; height: 14px; flex: none; }
    .en-llamada { font-size: 15px; width: 15px; height: 15px; color: #16A34A; flex: none; }
    .vacio { text-align: center; color: var(--muted); padding: 2rem 1rem; font-size: .85rem; }
    .vacio mat-icon { font-size: 40px; width: 40px; height: 40px; color: var(--primary); opacity: .5; }
    .vacio p { margin: .4rem 0 .2rem; color: var(--text-2); font-weight: 600; }
  `],
})
export class ComListaChats {
  readonly store = inject(ChatStoreService);
  private readonly api = inject(ComunicacionesApiService);
  private readonly caja = viewChild<ElementRef<HTMLInputElement>>('caja');
  /** Personas de la organización que coinciden con lo que se escribió en el buscador. */
  readonly personas = signal<UsuarioDir[]>([]);
  readonly buscandoPersonas = signal(false);
  private readonly busqueda$ = new Subject<string>();
  readonly activa = input<string | null>(null);
  readonly conFiltros = input(false);
  readonly elegir = output<string>();
  readonly filtro = signal('');
  readonly abriendoSoporte = signal(false);
  readonly modo = signal<'todos' | 'noleidos' | 'grupos' | 'archivados'>('todos');
  readonly filtros = [
    { v: 'todos' as const, t: 'Todos' }, { v: 'noleidos' as const, t: 'No leídos' },
    { v: 'grupos' as const, t: 'Grupos' }, { v: 'archivados' as const, t: 'Archivados' },
  ];

  readonly visibles = computed(() => {
    const f = this.filtro().trim().toLowerCase();
    return this.store.conversaciones().filter(c => {
      if (this.modo() === 'archivados' ? !c.archivada : c.archivada) return false;
      if (this.modo() === 'noleidos' && !c.no_leidos) return false;
      if (this.modo() === 'grupos' && c.tipo !== 'GRUPO') return false;
      if (!f) return true;
      return c.nombre.toLowerCase().includes(f)
        || c.participantes.some(p => p.nombre.toLowerCase().includes(f) || (p.cargo ?? '').toLowerCase().includes(f));
    });
  });
  /** Coordinadores y soporte solo en la vista normal (sin búsqueda ni filtro). */
  readonly extras = computed(() => !this.filtro().trim() && this.modo() === 'todos' && this.store.cargado());

  hora(iso: string | null): string { return horaCorta(iso); }
  primer(n: string): string { return primerNombre(n); }
  icono(c: Conversacion): string | null { return iconoConversacion(c); }
  otro(c: Conversacion): ParticipanteOut | undefined {
    return c.tipo === 'DIRECTA' ? c.participantes.find(p => p.usuario_id === c.otro_usuario_id) : undefined;
  }
  subtitulo(c: Conversacion): string | null {
    if (c.tipo === 'DIRECTA') return this.otro(c)?.cargo ?? null;
    if (c.tipo === 'SOPORTE') return c.soporte_estado === 'HUMANO' ? 'Con una persona' : 'Asistente IA';
    return null;
  }

  constructor() {
    this.busqueda$.pipe(
      debounceTime(250),
      switchMap(q => {
        if (q.trim().length < 2) { this.buscandoPersonas.set(false); return of([] as UsuarioDir[]); }
        this.buscandoPersonas.set(true);
        return this.api.buscarPersonas(q.trim(), 8).pipe(catchError(() => of([] as UsuarioDir[])));
      }),
      takeUntilDestroyed(inject(DestroyRef)),
    ).subscribe(l => { this.personas.set(l); this.buscandoPersonas.set(false); });
  }

  /** Con dos letras o más, además de los chats se busca en toda la organización. */
  readonly buscaPersonas = computed(() => this.filtro().trim().length >= 2 && this.modo() !== 'archivados');
  /** Las personas encontradas que no salen ya como chat 1 a 1 en la lista. */
  readonly personasVisibles = computed(() => {
    const yaEnChats = new Set(this.visibles().filter(c => c.tipo === 'DIRECTA').map(c => c.otro_usuario_id));
    const yo = this.store.miId();
    return this.personas().filter(u => u.id !== yo && !yaEnChats.has(u.id));
  });

  escribir(v: string): void {
    this.filtro.set(v);
    this.busqueda$.next(v);
  }

  enfocarBusqueda(): void { this.caja()?.nativeElement.focus(); }

  async estrella(u: UsuarioDir): Promise<void> {
    try { await this.store.estrella(u.id, !this.store.estrellas().has(u.id)); } catch { /* sin red */ }
  }

  tooltip(f: Favorito): string {
    return [f.usuario.nombre, f.motivo, f.usuario.cargo].filter(Boolean).join(' · ');
  }


  async hablarCon(usuarioId: string): Promise<void> {
    try {
      const c = await this.store.abrirDirecta(usuarioId);
      if (this.filtro()) this.escribir('');
      this.elegir.emit(c.id);
    } catch { /* sin red: no pasa nada */ }
  }

  async abrirSoporte(): Promise<void> {
    this.abriendoSoporte.set(true);
    try { this.elegir.emit((await this.store.abrirSoporte()).id); }
    catch { /* el soporte puede estar apagado */ }
    finally { this.abriendoSoporte.set(false); }
  }
  foto(c: Conversacion): boolean { return c.participantes.find(p => p.usuario_id === c.otro_usuario_id)?.tiene_foto ?? false; }
  enLinea(c: Conversacion): boolean { return c.participantes.find(p => p.usuario_id === c.otro_usuario_id)?.en_linea ?? false; }
  escribe(c: Conversacion): boolean { return this.store.escribiendoEn(c.id).length > 0; }
  prefijo(c: Conversacion): string {
    if (!c.ultimo_mensaje_autor || !c.ultimo_mensaje_texto) return '';
    const yo = this.store.yo()?.nombre;
    if (yo && c.ultimo_mensaje_autor === yo) return 'Tú: ';
    return c.tipo === 'GRUPO' ? c.ultimo_mensaje_autor.split(' ')[0] + ': ' : '';
  }
}
