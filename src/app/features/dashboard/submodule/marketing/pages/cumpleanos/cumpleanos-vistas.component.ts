import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { HttpErrorResponse } from '@angular/common/http';
import Swal from 'sweetalert2';
import { PersonaCelebradaAdmin, QuienVio, VistasDia } from '../../../../components/celebracion/celebracion.models';
import { CelebracionService } from '../../../../components/celebracion/celebracion.service';
import { fechaLarga } from '../../../../components/celebracion/preparar';
import { normalizarCedula } from './cumpleanos-union.service';

type Filtro = 'todos' | 'cerraron' | 'cumpleaneros';

/**
 * «¿Quién la vio?»: la lista de personas que vieron la celebración de un día, con la hora,
 * si la cerraron antes de terminar y si la vio la propia persona que cumple. Arriba, cada
 * cumpleañero con «ya la vio» / «aún no».
 */
@Component({
  selector: 'app-cumpleanos-vistas',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="telon" (click)="cerrar.emit()">
      <div class="panel qv" (click)="$event.stopPropagation()" role="dialog" aria-label="Quién vio la celebración">
        <header class="qv-cab">
          <span class="qv-icono"><mat-icon>visibility</mat-icon></span>
          <div>
            <h3>Quién la vio</h3>
            <p class="sub">{{ fechaTxt() }}</p>
          </div>
          <button type="button" class="mini qv-x" (click)="cerrar.emit()" title="Cerrar"><mat-icon>close</mat-icon></button>
        </header>

        @if (error()) {
          <p class="sub">{{ error() }}</p>
        } @else if (!datos()) {
          <p class="sub">Cargando…</p>
        } @else {
          @if (cumpleaneros().length) {
            <ul class="qv-cumple">
              @for (c of cumpleaneros(); track c.persona.id) {
                <li [class.on]="c.vio">
                  <mat-icon>{{ c.vio ? 'cake' : 'hourglass_empty' }}</mat-icon>
                  <span><b>{{ c.persona.nombre }}</b>
                    <small>{{ c.vio ? 'Ya la vio' + (c.hora ? ' · ' + c.hora : '') : (c.persona.documento ? 'Aún no ha entrado a verla' : 'Sin cédula: no se puede saber si la vio') }}</small></span>
                </li>
              }
            </ul>
          }

          <div class="qv-resumen">
            <span><b>{{ datos()!.total }}</b> {{ datos()!.total === 1 ? 'persona' : 'personas' }}</span>
            <span><b>{{ datos()!.cerradas_antes }}</b> la cerraron antes</span>
            @if (sinNombre()) { <span><b>{{ sinNombre() }}</b> sin nombre (vistas viejas)</span> }
          </div>

          <div class="qv-barra">
            <label class="campo qv-buscar"><span class="vh">Buscar</span>
              <input type="search" [ngModel]="busca()" (ngModelChange)="busca.set($event)" placeholder="Buscar por nombre, correo, cédula o rol" /></label>
            <div class="qv-filtros" role="group" aria-label="Filtrar">
              @for (f of filtros; track f.id) {
                <button type="button" [class.on]="filtro() === f.id" (click)="filtro.set(f.id)">{{ f.nombre }}</button>
              }
            </div>
            <button type="button" class="btn btn--fantasma qv-copiar" (click)="copiar()" [disabled]="!lista().length" title="Copiar la lista (nombre, correo, hora)">
              <mat-icon>content_copy</mat-icon> Copiar</button>
          </div>

          <ul class="qv-lista">
            @for (p of lista(); track p.usuario_id) {
              <li class="qv-fila" [class.qv-fila--cumple]="p.es_cumpleanero">
                <span class="qv-ini">{{ iniciales(p) }}</span>
                <span class="qv-datos">
                  <b>{{ p.nombre || p.correo || 'Sin nombre' }}
                    @if (p.es_cumpleanero) { <span class="qv-tag qv-tag--cumple">🎂 Cumpleañero</span> }</b>
                  <small>{{ detalle(p) }}</small>
                </span>
                <span class="qv-cuando">
                  <b>{{ hora(p.primer_en) }}</b>
                  <small>
                    @if (p.cerrada_antes) { <span class="qv-tag qv-tag--cerro">La cerró antes</span> }
                    @else { {{ p.veces > 1 ? p.veces + ' veces' : 'Completa' }} }
                  </small>
                </span>
              </li>
            } @empty {
              <li class="sub qv-vacia">{{ datos()!.total ? 'Nadie coincide con la búsqueda.' : 'Todavía nadie la ha visto.' }}</li>
            }
          </ul>
        }
      </div>
    </div>
  `,
  styleUrls: ['../banners/pestanas-banners.css'],
  styles: [`
    .qv { width: min(680px, 100%); }
    .qv-cab { display: flex; align-items: center; gap: 12px; }
    .qv-cab h3 { margin: 0; }
    .qv-cab .sub::first-letter { text-transform: uppercase; }
    .qv-icono { flex: none; width: 46px; height: 46px; border-radius: 14px; display: grid; place-items: center; color: #fff;
      background: linear-gradient(135deg, #ff4f8b, #ffb13d); }
    .qv-x { margin-left: auto; }
    .qv-cumple { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
    .qv-cumple li { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 12px; flex: 1 1 220px;
      border: 1px dashed var(--border); background: var(--surface-2, rgb(0 0 0 / .02)); }
    .qv-cumple li.on { border-style: solid; border-color: color-mix(in srgb, #15803d 45%, var(--border));
      background: color-mix(in srgb, #15803d 8%, var(--surface)); }
    .qv-cumple li.on .mat-icon { color: #15803d; }
    .qv-cumple li span { display: flex; flex-direction: column; min-width: 0; font-size: .86rem; }
    .qv-cumple small { color: var(--muted); font-size: .76rem; }
    .qv-resumen { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: .84rem; color: var(--muted); }
    .qv-resumen b { color: var(--text); font-size: 1rem; }
    .qv-barra { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .qv-buscar { flex: 1 1 220px; margin: 0; }
    .qv-filtros { display: flex; gap: 4px; padding: 3px; border-radius: 10px; background: var(--surface-2, rgb(0 0 0 / .03)); border: 1px solid var(--border); }
    .qv-filtros button { border: 0; background: transparent; font: inherit; font-size: .78rem; font-weight: 700; color: var(--muted);
      padding: 6px 10px; border-radius: 8px; cursor: pointer; min-height: 0; }
    .qv-filtros button.on { background: var(--surface); color: #e0245e; box-shadow: 0 1px 2px rgb(0 0 0 / .08); }
    .qv-copiar { min-height: 38px; }
    .qv-lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; max-height: min(52vh, 520px); overflow: auto;
      border: 1px solid var(--border); border-radius: 12px; }
    .qv-fila { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-top: 1px solid var(--border); }
    .qv-fila:first-child { border-top: 0; }
    .qv-fila--cumple { background: color-mix(in srgb, #ffb13d 12%, var(--surface)); }
    .qv-ini { flex: none; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; font-size: .74rem; font-weight: 800;
      color: #fff; background: linear-gradient(135deg, #6c8cff, #2b59f0); }
    .qv-datos { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; }
    .qv-datos b { font-size: .88rem; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .qv-datos small, .qv-cuando small { color: var(--muted); font-size: .74rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .qv-cuando { flex: none; display: flex; flex-direction: column; align-items: flex-end; text-align: right; }
    .qv-cuando b { font-size: .84rem; }
    .qv-tag { display: inline-flex; padding: 1px 7px; border-radius: 999px; font-size: .68rem; font-weight: 700; }
    .qv-tag--cumple { background: #fff1d6; color: #9a5b00; }
    .qv-tag--cerro { background: color-mix(in srgb, #e0245e 12%, var(--surface)); color: #b0174a; }
    .qv-vacia { padding: 18px; text-align: center; }
    .vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    @media (max-width: 600px) {
      .qv-buscar { flex: 1 1 150px; }
      .qv-filtros { order: 3; width: 100%; justify-content: space-between; }
      .qv-filtros button { flex: 1 1 auto; }
      .qv-lista { max-height: none; }
    }
  `],
})
export class CumpleanosVistasComponent implements OnInit {
  readonly fecha = input.required<string>();
  /** Quienes cumplen ese día: para decir si cada uno ya la vio. */
  readonly personas = input<PersonaCelebradaAdmin[]>([]);
  readonly cerrar = output<void>();

  private readonly api = inject(CelebracionService);

  readonly datos = signal<VistasDia | null>(null);
  readonly error = signal<string | null>(null);
  readonly busca = signal('');
  readonly filtro = signal<Filtro>('todos');
  readonly filtros: { id: Filtro; nombre: string }[] = [
    { id: 'todos', nombre: 'Todos' }, { id: 'cerraron', nombre: 'La cerraron' }, { id: 'cumpleaneros', nombre: 'Cumpleañeros' },
  ];

  readonly fechaTxt = computed(() => fechaLarga(this.fecha()));
  readonly sinNombre = computed(() => (this.datos()?.personas ?? []).filter((p) => !p.nombre && !p.correo).length);

  readonly cumpleaneros = computed(() => {
    const vistas = this.datos()?.personas ?? [];
    return this.personas().map((persona) => {
      const doc = normalizarCedula(persona.documento);
      const v = doc ? vistas.find((x) => normalizarCedula(x.documento) === doc) : undefined;
      return { persona, vio: !!v, hora: v ? this.hora(v.primer_en) : '' };
    });
  });

  readonly lista = computed(() => {
    const q = this.busca().trim().toLowerCase();
    const f = this.filtro();
    return (this.datos()?.personas ?? []).filter((p) =>
      (f === 'todos' || (f === 'cerraron' && p.cerrada_antes) || (f === 'cumpleaneros' && p.es_cumpleanero))
      && (!q || [p.nombre, p.correo, p.documento, p.rol].some((x) => (x ?? '').toLowerCase().includes(q))));
  });

  ngOnInit(): void {
    this.api.vistasDia(this.fecha()).subscribe({
      next: (d) => this.datos.set(d),
      error: (e: HttpErrorResponse) => this.error.set(e.status === 403
        ? 'Solo el equipo de Marketing puede ver quién la vio.' : 'No se pudo cargar la lista. Intenta de nuevo.'),
    });
  }

  iniciales(p: QuienVio): string {
    const base = (p.nombre || p.correo || '?').replace(/@.*/, '').trim();
    const w = base.split(/[\s._-]+/).filter(Boolean);
    return ((w[0]?.[0] ?? '?') + (w.length > 1 ? w[w.length > 2 ? 2 : 1][0] : '')).toUpperCase();
  }

  detalle(p: QuienVio): string {
    const donde = p.superficies.map((s) => (s === 'TESORO' ? 'Plataforma' : s === 'TUAPO_WEB' ? 'Portal' : s)).join(' y ');
    return [p.nombre ? p.correo : null, p.rol ? titulo(p.rol) : null, donde || null,
      !p.nombre && !p.correo ? `id ${p.usuario_id.slice(0, 8)}` : null].filter(Boolean).join(' · ');
  }

  hora(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' });
  }

  async copiar(): Promise<void> {
    const filas = this.lista().map((p) => [p.nombre ?? '', p.correo ?? '', p.documento ?? '', p.rol ?? '', this.hora(p.primer_en),
      p.cerrada_antes ? 'la cerró antes' : 'completa'].join('\t'));
    const texto = ['Nombre\tCorreo\tCédula\tRol\tHora\tCómo la vio', ...filas].join('\n');
    try {
      await navigator.clipboard.writeText(texto);
      Swal.fire({ icon: 'success', title: 'Lista copiada', text: `${filas.length} personas: pégala en Excel o en un correo.`, timer: 2200, showConfirmButton: false });
    } catch {
      Swal.fire('No se pudo copiar', 'Tu navegador no dejó usar el portapapeles.', 'warning');
    }
  }
}

function titulo(s: string): string {
  return s.toLowerCase().replace(/(^|[\s_])\p{L}/gu, (m) => m.toUpperCase()).replace(/_/g, ' ');
}
