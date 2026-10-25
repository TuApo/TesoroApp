import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { BandejaApiService } from '../bandeja-api.service';
import { BandejaEstadoService } from '../bandeja-estado.service';
import { Contacto } from '../bandeja.models';
import { cuando } from '../bandeja-ui';
import { mensajeError } from '../../utils/tareas-ui';

/** El CRM de la persona: con quién habla, por qué canales, qué tiene pendiente con cada quien. */
@Component({
  selector: 'app-bandeja-contactos',
  standalone: true,
  imports: [RouterLink, FormsModule, MatIconModule, MatButtonModule, MatProgressSpinnerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ct-filtros">
      <label class="buscar"><mat-icon>search</mat-icon>
        <input type="search" placeholder="Nombre, empresa, correo, número o nota…" [ngModel]="q()" (ngModelChange)="buscar($event)" /></label>
      <div class="filtros">
        @for (e of etapas; track e.clave) {
          <button type="button" [class.on]="etapa() === e.clave" (click)="etapa.set(e.clave); cargar()">{{ e.etiqueta }}</button>
        }
      </div>
      <select class="ct-orden" [ngModel]="orden()" (ngModelChange)="orden.set($event); cargar()" aria-label="Ordenar">
        <option value="">Último contacto</option><option value="pendientes">Con pendientes</option>
        <option value="mensajes">Más mensajes</option><option value="nombre">Nombre</option>
      </select>
    </div>
    @if (error()) { <div class="error"><mat-icon>error</mat-icon>{{ error() }}</div> }
    @if (cargando()) { <div class="centro"><mat-spinner diameter="34" /></div> }
    @else {
      <p class="muted ct-total">{{ total() }} contacto(s)</p>
      <div class="ct-grid">
        @for (c of lista(); track c.id) {
          <a class="tarjeta ct" [routerLink]="['/dashboard/tareas/bandeja/contactos', c.id]" [queryParams]="estado.usuario() ? { usuario: estado.usuario() } : {}">
            <span class="ct-ini">{{ iniciales(c.nombre) }}</span>
            <span class="ct-cuerpo">
              <strong class="ellipsis">{{ c.nombre || 'Sin nombre' }}</strong>
              <span class="muted ellipsis">{{ c.organizacion || c.identidades }}</span>
              <span class="ct-chips">
                @if (c.canales?.includes('CORREO')) { <span class="chip" data-tono="info"><mat-icon>mail</mat-icon>Correo</span> }
                @if (c.canales?.includes('WA')) { <span class="chip" data-tono="ok"><mat-icon>chat</mat-icon>WhatsApp</span> }
                @if ((c.por_responder ?? 0) > 0) { <span class="chip" data-tono="peligro">{{ c.por_responder }} por responder</span> }
                @if ((c.compromisos_abiertos ?? 0) > 0) { <span class="chip" data-tono="aviso"><mat-icon>handshake</mat-icon>{{ c.compromisos_abiertos }}</span> }
                <span class="chip" data-tono="neutro">{{ etiquetaEtapa(c.etapa) }}</span>
              </span>
              <span class="muted ct-ult">{{ c.mensajes_entrantes }} recibidos · {{ c.mensajes_salientes }} enviados · {{ cuando(c.ultimo_contacto_en) }}</span>
            </span>
          </a>
        } @empty {
          <div class="vacio"><mat-icon>contacts</mat-icon><p>Los contactos aparecen solos a medida que llegan correos y mensajes.</p></div>
        }
      </div>
      @if (lista().length < total()) { <button mat-stroked-button class="ct-mas" (click)="mas()">Cargar más</button> }
    }
  `,
  styleUrls: ['../bandeja-comun.css'],
  styles: [`
    :host { display: flex; flex-direction: column; gap: 12px; }
    .ct-filtros { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .ct-orden { height: 46px; border-radius: 12px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--text); padding: 0 10px; font: 650 13.5px var(--font-sans); }
    .ct-total { margin: 0; font-size: 13px; }
    .ct-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr)); gap: 10px; }
    .ct { display: flex; gap: 12px; text-decoration: none; color: inherit; }
    .ct:hover { border-color: var(--border-strong); box-shadow: var(--shadow-sm); }
    .ct-ini { flex: none; width: 42px; height: 42px; border-radius: 50%; display: grid; place-items: center; background: var(--navy); color: #fff; font-weight: 800; }
    .ct-cuerpo { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .ct-cuerpo strong { font-size: 15px; }
    .ct-chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .ct-ult { font-size: 12px; }
    .ct-mas { align-self: center; }
  `],
})
export class ContactosComponent implements OnInit {
  private readonly api = inject(BandejaApiService);
  readonly estado = inject(BandejaEstadoService);

  readonly etapas = [{ clave: '', etiqueta: 'Todos' }, { clave: 'NUEVO', etiqueta: 'Nuevos' }, { clave: 'ACTIVO', etiqueta: 'Activos' },
    { clave: 'SEGUIMIENTO', etiqueta: 'En seguimiento' }, { clave: 'CERRADO', etiqueta: 'Cerrados' }];
  readonly q = signal('');
  readonly etapa = signal('');
  readonly orden = signal('');
  readonly lista = signal<Contacto[]>([]);
  readonly total = signal(0);
  readonly pagina = signal(0);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly cuando = cuando;
  private t: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void { void this.cargar(); }

  async cargar(pagina = 0): Promise<void> {
    if (pagina === 0) this.cargando.set(true);
    this.error.set(null);
    try {
      const r = await this.api.contactos({
        usuario: this.estado.supervisando() ? this.estado.usuario() : null, q: this.q() || null, etapa: this.etapa() || null,
        orden: this.orden() || null, pagina, tamano: 60,
      });
      this.lista.set(pagina === 0 ? r.items : [...this.lista(), ...r.items]);
      this.total.set(r.total);
      this.pagina.set(pagina);
    } catch (e) {
      this.error.set(mensajeError(e, 'No se pudieron cargar los contactos.'));
    } finally {
      this.cargando.set(false);
    }
  }

  mas(): void { void this.cargar(this.pagina() + 1); }

  buscar(v: string): void {
    this.q.set(v);
    if (this.t) clearTimeout(this.t);
    this.t = setTimeout(() => void this.cargar(), 350);
  }

  iniciales(n: string | null): string {
    const p = (n ?? '?').replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/);
    return ((p[0]?.[0] ?? '?') + (p[1]?.[0] ?? '')).toUpperCase();
  }

  etiquetaEtapa(e: string): string {
    return ({ NUEVO: 'Nuevo', ACTIVO: 'Activo', SEGUIMIENTO: 'En seguimiento', CERRADO: 'Cerrado' } as Record<string, string>)[e] ?? e;
  }
}
