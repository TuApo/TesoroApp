import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { Subject, debounceTime, switchMap, of, catchError, map } from 'rxjs';
import { AtajoDirectorio, OpcionesDirectorio, UsuarioDir, atajosDirectorio } from '../../modelos';
import { ChatStoreService } from '../../service/chat-store.service';
import { ComunicacionesApiService } from '../../service/comunicaciones-api.service';
import { ComActividad } from '../actividad/actividad';
import { ComAvatar } from '../avatar/avatar';

export interface NuevoChatData {
  /** 'directo' (elige una persona) | 'grupo' | 'agregar' (sumar personas a un grupo existente). */
  modo?: 'directo' | 'grupo' | 'agregar';
  excluir?: string[];
}

/**
 * Buscar a alguien de la plataforma y abrir el chat, o armar un grupo. Además del texto,
 * se puede buscar por grupo de personal (administrativos de apoyo, coordinadores…) y por
 * empresa temporal (Tu Alianza, Apoyo Laboral…), sin escribir nada.
 */
@Component({
  selector: 'app-com-nuevo-chat',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, ComAvatar, ComActividad],
  template: `
    <div class="dlg">
      <header>
        <h2>{{ modo() === 'grupo' ? 'Nuevo grupo' : modo() === 'agregar' ? 'Agregar personas' : 'Nuevo chat' }}</h2>
        <button type="button" class="ico" (click)="ref.close()" aria-label="Cerrar"><mat-icon>close</mat-icon></button>
      </header>
      @if (modo() === 'grupo') {
        <input class="campo" type="text" placeholder="Nombre del grupo (ej. Cierre de nómina)" maxlength="160"
               [value]="titulo()" (input)="titulo.set($any($event.target).value)" />
      }
      @if (modo() !== 'directo' && elegidos().length) {
        <div class="elegidos">
          @for (u of elegidos(); track u.id) {
            <span class="chip"><app-com-avatar [usuarioId]="u.id" [nombre]="u.nombre" [tieneFoto]="u.tiene_foto" [tam]="20" />
              {{ u.nombre }} <button type="button" (click)="alternar(u)" aria-label="Quitar"><mat-icon>close</mat-icon></button></span>
          }
        </div>
      }
      <label class="buscar">
        <mat-icon>search</mat-icon>
        <input type="search" placeholder="Busca por nombre, cargo, sede, empresa o cédula" autofocus
               (input)="escribir($any($event.target).value)" />
      </label>
      @if (atajos().length) {
        <div class="atajos" role="group" aria-label="Buscar por grupo o empresa">
          @for (a of atajos(); track a.tipo + a.clave) {
            <button type="button" [class.on]="atajoActivo(a)" [attr.aria-pressed]="atajoActivo(a)" (click)="alternarAtajo(a)">
              <mat-icon>{{ a.icono }}</mat-icon>{{ a.nombre }}</button>
          }
        </div>
      }
      @if (modo() !== 'directo' && hayAtajo() && resultados().length) {
        <button type="button" class="todos" (click)="elegirTodos()">
          <mat-icon>done_all</mat-icon> Elegir {{ resultados().length === limiteGrupo ? 'los primeros ' : 'a los ' }}{{ resultados().length }}</button>
      }
      <div class="lista">
        @if (modo() === 'directo' && !texto()) {
          <button type="button" class="fila grupo" (click)="modo.set('grupo')">
            <span class="ic-grupo"><mat-icon>group_add</mat-icon></span><span class="n">Crear un grupo</span>
          </button>
        }
        @for (u of resultados(); track u.id) {
          <button type="button" class="fila" [class.sel]="estaElegido(u)" (click)="elegir(u)">
            <app-com-avatar [usuarioId]="u.id" [nombre]="u.nombre" [tieneFoto]="u.tiene_foto" [tam]="36" [presencia]="u.en_linea"
              [coordinador]="u.coordinador" />
            <span class="n"><span class="nom">{{ u.nombre }}@if (u.coordinador) { <em class="coord">Coordinador</em> }@if (u.grupo) { <em class="grp">{{ u.grupo }}</em> }</span><small>{{ detalle(u) }}</small>
              <app-com-actividad [enLinea]="u.en_linea" [ultimaVezMs]="u.ultima_vez_ms" /></span>
            @if (modo() !== 'directo') { <mat-icon class="check">{{ estaElegido(u) ? 'check_box' : 'check_box_outline_blank' }}</mat-icon> }
          </button>
        } @empty {
          @if (hayAtajo() && !buscando()) { <p class="vacio">No hay nadie en ese grupo@if (texto()) { con “{{ texto() }}”}.</p> }
          @else if (texto().length >= 2 && !buscando()) { <p class="vacio">No se encontró a nadie con “{{ texto() }}”.</p> }
          @if (!hayAtajo() && texto().length < 2) { <p class="vacio">Escribe al menos dos letras o elige un grupo.</p> }
        }
      </div>
      @if (error()) { <p class="error">{{ error() }}</p> }
      @if (modo() !== 'directo') {
        <footer>
          <button type="button" class="sec" (click)="modo() === 'grupo' && !data?.modo ? modo.set('directo') : ref.close()">Cancelar</button>
          <button type="button" class="ok" [disabled]="!listo() || enviando()" (click)="confirmar()">
            {{ modo() === 'grupo' ? 'Crear grupo' : 'Agregar' }}</button>
        </footer>
      }
    </div>`,
  styles: [`
    .coord { font-style: normal; font-size: .62rem; font-weight: 800; color: var(--com-ambar-txt); background: var(--com-ambar-bg); border: 1px solid var(--com-ambar-borde);
      border-radius: 999px; padding: 0 .35rem; margin-left: .35rem; }
    .dlg { width: min(460px, 100vw); max-height: min(640px, 90vh); display: flex; flex-direction: column; background: var(--surface); color: var(--text); }
    header { display: flex; align-items: center; justify-content: space-between; padding: .9rem 1rem .5rem; }
    h2 { margin: 0; font-size: 1.05rem; }
    .ico { border: 0; background: transparent; cursor: pointer; color: var(--muted); border-radius: 50%; width: 34px; height: 34px; }
    .campo { margin: 0 1rem .6rem; border: 1px solid var(--border); border-radius: 10px; padding: .55rem .7rem; font: inherit; background: var(--surface); color: var(--text); }
    .buscar { width: auto; display: flex; align-items: center; gap: .4rem; margin: 0 1rem .5rem; border: 1px solid var(--border); border-radius: 999px;
      padding: .35rem .8rem; background: var(--surface-2); }
    .buscar input { flex: 1; border: 0; outline: 0; background: transparent; font: inherit; color: var(--text); }
    .buscar mat-icon { color: var(--muted); }
    .grp { font-style: normal; font-size: .62rem; font-weight: 800; color: var(--info-fg); background: var(--info-bg); border: 1px solid var(--info-border);
      border-radius: 999px; padding: 0 .35rem; margin-left: .35rem; }
    .atajos { display: flex; flex-wrap: wrap; gap: .3rem; padding: 0 1rem .5rem; }
    .atajos button { display: inline-flex; align-items: center; gap: .25rem; border: 1px dashed var(--border); background: transparent;
      border-radius: 999px; padding: .2rem .6rem; font: inherit; font-size: .74rem; color: var(--text-2); cursor: pointer; min-height: 0 !important; }
    .atajos button mat-icon { font-size: 15px; width: 15px; height: 15px; color: var(--muted); }
    .atajos button.on { border-style: solid; border-color: var(--primary); background: var(--info-bg); color: var(--info-fg); font-weight: 700; }
    .atajos button.on mat-icon { color: inherit; }
    .todos { align-self: flex-start; display: inline-flex; align-items: center; gap: .3rem; margin: 0 1rem .4rem; border: 0; background: transparent;
      color: var(--primary); font: inherit; font-size: .8rem; font-weight: 700; cursor: pointer; padding: .2rem 0; min-height: 0 !important; }
    .todos mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .elegidos { display: flex; flex-wrap: wrap; gap: .3rem; padding: 0 1rem .5rem; }
    .chip { display: inline-flex; align-items: center; gap: .3rem; background: var(--info-bg); color: var(--info-fg); border-radius: 999px;
      padding: .15rem .2rem .15rem .2rem; font-size: .78rem; }
    .chip button { border: 0; background: transparent; cursor: pointer; color: inherit; display: inline-flex; padding: 0; }
    .chip mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .lista { flex: 1; overflow-y: auto; padding: 0 .5rem .5rem; min-height: 200px; }
    .fila { display: flex; align-items: center; gap: .65rem; width: 100%; border: 0; background: transparent; padding: .45rem .5rem;
      border-radius: 10px; cursor: pointer; text-align: left; font: inherit; color: inherit; }
    .fila:hover { background: var(--surface-3); }
    .fila.sel { background: var(--info-bg); }
    .n { flex: 1; min-width: 0; display: flex; flex-direction: column; font-weight: 600; font-size: .9rem; }
    .nom { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .n small { font-weight: 400; color: var(--muted); font-size: .75rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ic-grupo { width: 36px; height: 36px; border-radius: 50%; background: var(--primary); color: #fff; display: flex; align-items: center; justify-content: center; }
    .check { color: var(--primary); }
    .vacio { color: var(--muted); text-align: center; font-size: .85rem; padding: 1.5rem 0; }
    .error { color: var(--danger-fg); padding: 0 1rem; font-size: .82rem; }
    footer { display: flex; justify-content: flex-end; gap: .5rem; padding: .7rem 1rem; border-top: 1px solid var(--border); }
    .sec, .ok { border-radius: 999px; padding: .45rem 1rem; font: inherit; cursor: pointer; border: 1px solid var(--border); background: var(--surface); color: var(--text); }
    .ok { background: var(--primary); color: #fff; border-color: var(--primary); font-weight: 700; }
    .ok:disabled { opacity: .5; cursor: default; }
  `],
})
export class NuevoChatDialog implements OnDestroy {
  readonly ref = inject(MatDialogRef<NuevoChatDialog, string | string[] | undefined>);
  readonly data = inject<NuevoChatData | null>(MAT_DIALOG_DATA, { optional: true });
  private readonly api = inject(ComunicacionesApiService);
  private readonly store = inject(ChatStoreService);

  readonly modo = signal<'directo' | 'grupo' | 'agregar'>(this.data?.modo ?? 'directo');
  readonly titulo = signal('');
  readonly texto = signal('');
  readonly resultados = signal<UsuarioDir[]>([]);
  readonly elegidos = signal<UsuarioDir[]>([]);
  readonly buscando = signal(false);
  readonly enviando = signal(false);
  readonly error = signal<string | null>(null);
  readonly listo = computed(() => this.elegidos().length > 0 && (this.modo() !== 'grupo' || this.titulo().trim().length > 0));

  /** Grupo de personal o empresa por la que se busca (se combinan con el texto). */
  readonly grupo = signal<string | null>(null);
  readonly empresa = signal<string | null>(null);
  readonly opciones = signal<OpcionesDirectorio | null>(null);
  readonly atajos = computed(() => atajosDirectorio(this.opciones()));
  readonly hayAtajo = computed(() => !!(this.grupo() || this.empresa()));
  /** Tope de una búsqueda por grupo (el directorio sirve hasta 100 por página). */
  readonly limiteGrupo = 100;

  private readonly buscar$ = new Subject<void>();
  private readonly sub = this.buscar$.pipe(
    debounceTime(250),
    switchMap(() => {
      const q = this.texto();
      const grupo = this.grupo(), empresa = this.empresa();
      if (grupo || empresa) {
        this.buscando.set(true);
        return this.api.directorio({ q, grupo, empresa, tamano: this.limiteGrupo }).pipe(
          map(p => p.items.map(i => i.usuario)), catchError(() => of([] as UsuarioDir[])));
      }
      if (q.length < 2) return of([] as UsuarioDir[]);
      this.buscando.set(true);
      return this.api.buscarPersonas(q, 25).pipe(catchError(() => of([] as UsuarioDir[])));
    }),
  ).subscribe(r => {
    const fuera = new Set(this.data?.excluir ?? []);
    this.resultados.set(r.filter(u => !fuera.has(u.id)));
    this.buscando.set(false);
  });

  constructor() {
    this.api.opcionesDirectorio().subscribe({ next: o => this.opciones.set(o), error: () => {} });
  }

  ngOnDestroy(): void { this.sub.unsubscribe(); }

  escribir(v: string): void {
    this.texto.set(v.trim());
    // Mientras corre la pausa del tecleo no se dice "no se encontró a nadie".
    this.buscando.set(this.hayAtajo() || this.texto().length >= 2);
    this.buscar$.next();
  }

  atajoActivo(a: AtajoDirectorio): boolean {
    return (a.tipo === 'grupo' ? this.grupo() : this.empresa()) === a.clave;
  }

  /** Un clic busca por ese grupo o empresa; otro clic lo quita. Grupo y empresa se combinan. */
  alternarAtajo(a: AtajoDirectorio): void {
    const nuevo = this.atajoActivo(a) ? null : a.clave;
    if (a.tipo === 'grupo') this.grupo.set(nuevo); else this.empresa.set(nuevo);
    this.buscando.set(this.hayAtajo() || this.texto().length >= 2);
    this.buscar$.next();
  }

  /** Para armar un grupo con todo un equipo (p. ej. los administrativos de Tu Alianza). */
  elegirTodos(): void {
    this.elegidos.update(l => [...l, ...this.resultados().filter(u => !l.some(x => x.id === u.id))]);
  }

  /** Cargo y finca primero: es lo que distingue a dos personas con el mismo nombre. */
  detalle(u: UsuarioDir): string { return [u.cargo || u.rol, u.lugar || u.sede, u.empresa].filter(Boolean).join(' · '); }
  estaElegido(u: UsuarioDir): boolean { return this.elegidos().some(x => x.id === u.id); }
  alternar(u: UsuarioDir): void {
    this.elegidos.update(l => l.some(x => x.id === u.id) ? l.filter(x => x.id !== u.id) : [...l, u]);
  }

  async elegir(u: UsuarioDir): Promise<void> {
    if (this.modo() !== 'directo') { this.alternar(u); return; }
    try {
      const c = await this.store.abrirDirecta(u.id);
      this.ref.close(c.id);
    } catch (e: any) {
      this.error.set(e?.error?.message ?? 'No se pudo abrir el chat');
    }
  }

  async confirmar(): Promise<void> {
    if (!this.listo()) return;
    if (this.modo() === 'agregar') { this.ref.close(this.elegidos().map(u => u.id)); return; }
    this.enviando.set(true);
    try {
      const c = await this.store.crearGrupo(this.titulo().trim(), this.elegidos().map(u => u.id));
      this.ref.close(c.id);
    } catch (e: any) {
      this.error.set(e?.error?.message ?? 'No se pudo crear el grupo');
    } finally {
      this.enviando.set(false);
    }
  }
}
