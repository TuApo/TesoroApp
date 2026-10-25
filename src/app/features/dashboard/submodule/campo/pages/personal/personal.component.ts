import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

import { CampoService, haceCuanto } from '../../services/campo.service';
import { PersonalService, Trabajador } from '../../services/personal.service';

/**
 * Mi personal: lista de los trabajadores que le tocan al coordinador (recorte del servidor),
 * guardada en el teléfono y buscable sin señal. Ficha con llamar y WhatsApp (apps del teléfono).
 */
@Component({
  selector: 'app-campo-personal',
  standalone: true,
  imports: [MatIconModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../campo-ui.css'],
  styles: [`
    .personal { max-width: 900px; }
    .resumen { color: var(--muted); font-size: 13px; margin: 0; }
    .fila .cuerpo small { white-space: nowrap; }
    .ficha dl { display: grid; grid-template-columns: auto 1fr; gap: 8px 14px; margin: 0 0 12px; font-size: 15px; }
    .ficha dt { color: var(--muted); }
    .ficha dd { margin: 0; font-weight: 600; word-break: break-word; }
    .mas { align-self: center; }
  `],
  template: `
    <div class="pagina personal">
      <header class="cabecera">
        <a class="boton chico" routerLink="/dashboard/coordinadores" aria-label="Volver"><mat-icon>arrow_back</mat-icon></a>
        <h1>Mi personal</h1>
        <button type="button" class="boton chico" (click)="descargar()" [disabled]="personal.cargando() || !campo.enLinea()">
          <mat-icon>{{ personal.cargando() ? 'sync' : 'download_for_offline' }}</mat-icon> {{ personal.cargando() ? 'Descargando…' : 'Actualizar' }}
        </button>
      </header>

      @if (personal.datos(); as d) {
        <p class="resumen">{{ d.total }} personas · {{ d.alcance }} · guardado en el teléfono {{ hace(d.generado_ms) }}</p>
      }
      @if (personal.error()) { <p class="chip aviso">{{ personal.error() }}</p> }

      <div class="barra">
        <input class="buscador" type="search" placeholder="Buscar por nombre, cédula, finca o cargo" [value]="q()" (input)="q.set($any($event.target).value)" />
        @if (personal.fincas().length > 1) {
          <select class="buscador" [value]="finca() ?? ''" (change)="finca.set($any($event.target).value || null)" aria-label="Finca">
            <option value="">Todas las fincas</option>
            @for (f of personal.fincas(); track f) { <option [value]="f">{{ f }}</option> }
          </select>
        }
      </div>

      <section class="tarjeta">
        <ul class="lista">
          @for (t of resultados(); track t.cedula) {
            <li class="fila clic" tabindex="0" (click)="ficha.set(t)" (keydown.enter)="ficha.set(t)">
              <span class="avatar">{{ iniciales(t.nombre) }}</span>
              <span class="cuerpo">
                <strong>{{ t.nombre || t.cedula }}</strong>
                <small>{{ t.cedula }} · {{ t.finca || 'Sin finca' }}{{ t.cargo ? ' · ' + t.cargo : '' }}</small>
              </span>
              @if (t.celular) {
                <a class="boton chico" [href]="'tel:' + t.celular" (click)="$event.stopPropagation()" aria-label="Llamar"><mat-icon>call</mat-icon></a>
              }
            </li>
          } @empty {
            <li class="vacio"><mat-icon>groups</mat-icon>
              {{ personal.datos() ? 'Nadie coincide con la búsqueda' : (campo.enLinea() ? 'Descargando tu personal…' : 'Conéctate una vez para descargar tu personal y tenerlo sin señal.') }}
            </li>
          }
        </ul>
        @if (total() > resultados().length) {
          <button type="button" class="boton mas" (click)="limite.update(n => n + 150)">Ver más ({{ total() - resultados().length }})</button>
        }
      </section>
    </div>

    @if (ficha(); as t) {
      <div class="panel-flotante" (click)="ficha.set(null)">
        <div class="hoja ficha" (click)="$event.stopPropagation()" role="dialog" aria-label="Ficha del trabajador">
          <h3>{{ t.nombre || t.cedula }}</h3>
          <dl>
            <dt>Cédula</dt><dd>{{ t.cedula }}</dd>
            <dt>Finca</dt><dd>{{ t.finca || '—' }}</dd>
            <dt>Empresa usuaria</dt><dd>{{ t.empresa_usuaria || '—' }}</dd>
            <dt>Cargo</dt><dd>{{ t.cargo || '—' }}</dd>
            <dt>Temporal</dt><dd>{{ t.temporal || '—' }}</dd>
            <dt>Oficina</dt><dd>{{ t.oficina || '—' }}</dd>
            <dt>Ingreso</dt><dd>{{ t.fecha_ingreso || '—' }}</dd>
            <dt>Contrato</dt><dd>{{ t.codigo_contrato || '—' }}</dd>
            <dt>Celular</dt><dd>{{ t.celular || '—' }}</dd>
          </dl>
          <div class="acciones">
            @if (t.celular) {
              <a class="boton" [href]="'tel:' + t.celular"><mat-icon>call</mat-icon> Llamar</a>
              <a class="boton" [href]="whatsapp(t)" target="_blank" rel="noopener"><mat-icon>chat</mat-icon> WhatsApp</a>
            }
            <button type="button" class="boton oscuro" (click)="ficha.set(null)">Cerrar</button>
          </div>
        </div>
      </div>
    }
  `,
})
export class PersonalComponent {
  readonly campo = inject(CampoService);
  readonly personal = inject(PersonalService);

  readonly q = signal('');
  readonly finca = signal<string | null>(null);
  readonly limite = signal(150);
  readonly ficha = signal<Trabajador | null>(null);

  readonly resultados = computed(() => this.personal.buscar(this.q(), this.finca(), this.limite()));
  readonly total = computed(() => this.personal.contar(this.q(), this.finca()));

  constructor() {
    this.campo.iniciar();
    void this.personal.cargarLocal().then(() => {
      // Con red y la lista vieja (o sin lista): se refresca sola.
      const d = this.personal.datos();
      if (this.campo.enLinea() && (!d || Date.now() - d.generado_ms > 6 * 3600_000)) void this.personal.descargar();
    });
  }

  descargar(): void { void this.personal.descargar(); }

  hace(ms: number): string { return haceCuanto(ms); }

  iniciales(n: string | null): string {
    return (n ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
  }

  whatsapp(t: Trabajador): string {
    const n = (t.celular ?? '').replace(/\D/g, '');
    return `https://wa.me/${n.length === 10 ? '57' + n : n}`;
  }
}
