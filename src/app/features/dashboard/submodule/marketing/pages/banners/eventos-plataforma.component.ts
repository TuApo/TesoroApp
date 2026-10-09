import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { HttpErrorResponse } from '@angular/common/http';
import Swal from 'sweetalert2';
import { EventoTipo, OcurrenciaEvento, PersonaEvento } from '../../carrusel/carrusel.models';
import { CarruselService } from '../../carrusel/carrusel.service';

/**
 * Eventos de plataforma: cumpleaños, bienvenida, contrato por vencer…
 *
 * Un banner segmentado por evento solo le sale a quien lo tenga vigente. Aquí se ve quién
 * lo tiene y se asigna a mano pegando una lista (cédula y, si se quiere, el nombre para
 * {{nombre}}). Otros módulos pueden registrarlos solos por el canal interno.
 */
@Component({
  selector: 'app-eventos-plataforma',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cab">
      <p class="sub">Un banner con un evento en su audiencia solo le sale a quien tenga ese evento vigente — por ejemplo,
        «¡Feliz cumpleaños, {{ variableNombre }}!» solo el día del cumpleaños de cada persona.</p>
      <button type="button" class="btn btn--primario" (click)="nuevoTipo()"><mat-icon>add</mat-icon> Nuevo evento</button>
    </div>

    <div class="eventos">
      <ul class="lista-ev">
        @for (e of tipos(); track e.codigo) {
          <li>
            <button type="button" class="ev" [class.ev--on]="abierto()?.codigo === e.codigo" (click)="abrir(e)">
              <mat-icon aria-hidden="true">{{ e.icono || 'event' }}</mat-icon>
              <span><strong>{{ e.nombre }}</strong>
                <small>{{ e.vigentes ? 'Lo tienen ahora: ' + e.vigentes : 'Nadie ahora' }} · {{ dias(e.duracion_dias) }}
                  @if (!e.activo) { · inactivo }</small></span>
            </button>
          </li>
        }
      </ul>

      <section class="detalle-ev">
        @if (abierto(); as e) {
          <header class="detalle-ev__cab">
            <div>
              <h3>{{ e.nombre }} <code>{{ e.codigo }}</code></h3>
              <p class="sub">{{ e.descripcion }}</p>
              @if (e.variables) { <p class="sub">Variables para el texto: <code>{{ e.variables }}</code></p> }
            </div>
            <button type="button" class="mini" (click)="editarTipo(e)" title="Editar"><mat-icon>edit</mat-icon></button>
          </header>

          <form class="asignar" (ngSubmit)="asignar(e)">
            <h4>Asignar a personas</h4>
            <label class="campo">
              <span>Una persona por línea: <code>cédula</code> o <code>cédula, nombre</code></span>
              <textarea name="lista" rows="5" [ngModel]="lista()" (ngModelChange)="lista.set($event)"
                        placeholder="1023456789, Ana María&#10;52123456, Pedro"></textarea>
            </label>
            <div class="fila">
              <label class="campo"><span>Desde</span><input type="date" name="desde" [ngModel]="desde()" (ngModelChange)="desde.set($event)" /></label>
              <label class="campo"><span>Hasta <em>(vacío = {{ dias(e.duracion_dias) }})</em></span>
                <input type="date" name="hasta" [ngModel]="hasta()" (ngModelChange)="hasta.set($event)" /></label>
            </div>
            <button type="submit" class="btn btn--primario" [disabled]="!lista().trim() || guardando()">
              <mat-icon>group_add</mat-icon> Asignar ({{ contar() }})
            </button>
          </form>

          <h4>Quién lo tiene ({{ ocurrencias().length }})</h4>
          @if (cargandoOc()) { <p class="sub">Cargando…</p> }
          <div class="tabla">
            <table>
              <thead><tr><th>Persona</th><th>Desde</th><th>Hasta</th><th>Origen</th><th></th></tr></thead>
              <tbody>
                @for (o of ocurrencias(); track o.id) {
                  <tr [class.futuro]="!o.vigente_ahora">
                    <td>{{ o.documento || o.usuario_id }} @if (nombreDe(o)) { <small>· {{ nombreDe(o) }}</small> }</td>
                    <td>{{ o.vigente_desde }}</td><td>{{ o.vigente_hasta }}</td>
                    <td>{{ o.origen === 'INTERNO' ? 'Automático' : 'Manual' }}</td>
                    <td><button type="button" class="mini" (click)="quitar(o)" title="Quitar"><mat-icon>delete</mat-icon></button></td>
                  </tr>
                } @empty {
                  <tr><td colspan="5" class="sub">Nadie tiene este evento vigente.</td></tr>
                }
              </tbody>
            </table>
          </div>
          <details class="tecnico">
            <summary>Para desarrolladores: registrarlo desde otro microservicio</summary>
            <pre>POST http://ms-marketing:8098/api/v1/marketing/interno/eventos
X-Interno-Token: $MARKETING_INTERNO_TOKEN
{{ ejemploInterno(e.codigo) }}</pre>
            <p class="sub">Idempotente por <code>referencia</code>: reenviar el mismo evento lo actualiza, no lo duplica.</p>
          </details>
        } @else {
          <p class="sub vacio">Elige un evento para ver quién lo tiene y asignarlo.</p>
        }
      </section>
    </div>

    @if (editando(); as t) {
      <div class="telon" (click)="editando.set(null)">
        <form class="panel" (click)="$event.stopPropagation()" (ngSubmit)="guardarTipo()">
          <h3>{{ t.codigo ? 'Editar evento' : 'Nuevo evento' }}</h3>
          <label class="campo"><span>Nombre</span>
            <input name="n" [ngModel]="t.nombre" (ngModelChange)="campoTipo('nombre', $event)" required maxlength="120" /></label>
          <label class="campo"><span>Descripción</span>
            <input name="d" [ngModel]="t.descripcion" (ngModelChange)="campoTipo('descripcion', $event)" maxlength="500" /></label>
          <div class="fila">
            <label class="campo"><span>Duración por defecto (días)</span>
              <input type="number" name="du" min="1" max="366" [ngModel]="t.duracion_dias" (ngModelChange)="campoTipo('duracion_dias', +$event)" /></label>
            <label class="campo"><span>Ícono (Material)</span>
              <input name="i" [ngModel]="t.icono" (ngModelChange)="campoTipo('icono', $event)" placeholder="event" /></label>
          </div>
          <label class="campo"><span>Variables que trae (separadas por coma)</span>
            <input name="v" [ngModel]="t.variables" (ngModelChange)="campoTipo('variables', $event)" placeholder="nombre,fecha" /></label>
          <label class="check"><input type="checkbox" name="a" [ngModel]="t.activo" (ngModelChange)="campoTipo('activo', $event)" /> Activo</label>
          <div class="pie">
            <button type="button" class="btn btn--fantasma" (click)="editando.set(null)">Cancelar</button>
            <button type="submit" class="btn btn--primario" [disabled]="!t.nombre || guardando()">Guardar</button>
          </div>
        </form>
      </div>
    }
  `,
  styleUrl: './pestanas-banners.css',
})
export class EventosPlataformaComponent implements OnInit {
  private readonly api = inject(CarruselService);

  readonly tipos = signal<EventoTipo[]>([]);
  readonly abierto = signal<EventoTipo | null>(null);
  readonly ocurrencias = signal<OcurrenciaEvento[]>([]);
  readonly cargandoOc = signal(false);
  readonly lista = signal('');
  readonly desde = signal('');
  readonly hasta = signal('');
  readonly guardando = signal(false);
  readonly editando = signal<(Partial<EventoTipo> & { nuevo?: boolean }) | null>(null);
  readonly variableNombre = '{{nombre}}';

  ngOnInit(): void { this.cargar(); }

  private cargar(): void {
    this.api.eventos().subscribe((t) => {
      this.tipos.set(t);
      const a = this.abierto();
      if (a) this.abierto.set(t.find((x) => x.codigo === a.codigo) ?? null);
    });
  }

  abrir(e: EventoTipo): void {
    this.abierto.set(e);
    this.cargandoOc.set(true);
    this.api.ocurrencias(e.codigo).subscribe({
      next: (o) => { this.ocurrencias.set(o); this.cargandoOc.set(false); },
      error: () => this.cargandoOc.set(false),
    });
  }

  private personas(): PersonaEvento[] {
    return this.lista().split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
      const [doc, ...resto] = l.split(/[,;\t]/);
      return { documento: doc.replace(/[^0-9A-Za-z]/g, ''), nombre: resto.join(' ').trim() || null };
    }).filter((p) => (p.documento ?? '').length >= 4);
  }

  contar(): number { return this.personas().length; }

  asignar(e: EventoTipo): void {
    const personas = this.personas();
    if (!personas.length) return;
    this.guardando.set(true);
    this.api.asignarEvento({ codigo: e.codigo, personas, desde: this.desde() || null, hasta: this.hasta() || null }).subscribe({
      next: (r) => {
        this.guardando.set(false);
        this.lista.set('');
        Swal.fire({ icon: 'success', title: `${r.creadas} asignadas`,
          text: `Vigente del ${r.desde} al ${r.hasta}.${r.omitidas ? ` ${r.omitidas} líneas sin cédula se omitieron.` : ''}` });
        this.abrir(e);
        this.cargar();
      },
      error: (err: HttpErrorResponse) => {
        this.guardando.set(false);
        Swal.fire('No se pudo asignar', err.error?.error || 'Intenta de nuevo.', 'error');
      },
    });
  }

  quitar(o: OcurrenciaEvento): void {
    this.api.quitarOcurrencia(o.id).subscribe(() => {
      this.ocurrencias.update((l) => l.filter((x) => x.id !== o.id));
      this.cargar();
    });
  }

  dias(n: number): string { return n === 1 ? '1 día' : `${n} días`; }

  nombreDe(o: OcurrenciaEvento): string {
    try { return o.datos ? String(JSON.parse(o.datos)?.nombre ?? '') : ''; } catch { return ''; }
  }

  ejemploInterno(codigo: string): string {
    return JSON.stringify({ ocurrencias: [{
      codigo, documento: '1023456789', desde: '2026-10-12', hasta: '2026-10-12',
      datos: { nombre: 'Ana' }, referencia: `${codigo.toLowerCase()}-1023456789-2026`,
    }] }, null, 2);
  }

  nuevoTipo(): void {
    this.editando.set({ nuevo: true, nombre: '', descripcion: '', duracion_dias: 1, icono: 'event', variables: 'nombre', activo: true });
  }

  editarTipo(e: EventoTipo): void { this.editando.set({ ...e }); }

  campoTipo<K extends keyof EventoTipo>(k: K, v: EventoTipo[K]): void {
    this.editando.update((t) => (t ? { ...t, [k]: v } : t));
  }

  guardarTipo(): void {
    const t = this.editando();
    if (!t?.nombre) return;
    this.guardando.set(true);
    const { nuevo, ...cuerpo } = t;
    const req = nuevo || !t.codigo ? this.api.crearEvento(cuerpo) : this.api.editarEvento(t.codigo, cuerpo);
    req.subscribe({
      next: () => { this.guardando.set(false); this.editando.set(null); this.cargar(); },
      error: (err: HttpErrorResponse) => {
        this.guardando.set(false);
        Swal.fire('No se pudo guardar', err.error?.error || 'Intenta de nuevo.', 'error');
      },
    });
  }
}
