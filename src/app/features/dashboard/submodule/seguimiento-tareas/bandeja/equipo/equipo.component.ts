import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BandejaApiService } from '../bandeja-api.service';
import { MiembroEquipo, ParametroSeguimiento } from '../bandeja.models';
import { cuando, minutosLegibles } from '../bandeja-ui';
import { mensajeError } from '../../utils/tareas-ui';
import { obtenerUsuarioActual } from '@/app/core/utils/usuario-actual';

/**
 * Supervisión (ADMIN/GERENCIA): cómo va la bandeja de cada persona que vinculó cuentas.
 * "Ver bandeja" la abre en solo lectura y deja el acceso registrado. Abajo, los parámetros.
 */
@Component({
  selector: 'app-bandeja-equipo',
  standalone: true,
  imports: [RouterLink, FormsModule, MatIconModule, MatButtonModule, MatProgressSpinnerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="buscar"><mat-icon>search</mat-icon><input type="search" placeholder="Buscar persona…" [ngModel]="q()" (ngModelChange)="q.set($event)" /></label>
    @if (error()) { <div class="error"><mat-icon>error</mat-icon>{{ error() }}</div> }
    @if (cargando()) { <div class="centro"><mat-spinner diameter="34" /></div> }
    @else {
      <div class="eq-tabla">
        <table>
          <thead><tr>
            <th>Persona</th><th>Cuentas</th><th>Por responder</th><th>Vencidos</th><th>Compromisos</th>
            <th>Recibidos / enviados (30 d)</th><th>Respuesta (mediana)</th><th></th>
          </tr></thead>
          <tbody>
            @for (m of filtrados(); track m.usuario_id) {
              <tr>
                <td><strong>{{ m.nombre }}</strong><small class="muted">{{ m.rol }} · {{ m.sede }}</small></td>
                <td>
                  @for (c of m.cuentas; track $index) {
                    <span class="chip" [attr.data-tono]="c.estado === 'CONECTADO' ? 'ok' : 'peligro'" [title]="c.ultimo_error || ''">
                      <mat-icon>{{ c.canal === 'CORREO' ? 'mail' : 'chat' }}</mat-icon>{{ c.direccion || 'sin vincular' }}</span>
                  }
                </td>
                <td class="num">{{ m.por_responder }}</td>
                <td class="num" [class.mal]="(m.vencidos ?? 0) > 0">{{ m.vencidos }}</td>
                <td class="num">{{ m.compromisos_abiertos }}@if ((m.compromisos_vencidos ?? 0) > 0) { <small class="mal"> ({{ m.compromisos_vencidos }} venc.)</small> }</td>
                <td class="num">{{ m.mensajes_recibidos }} / {{ m.mensajes_enviados }}</td>
                <td class="num">{{ minutos(m.respuesta_mediana_min) }}</td>
                <td><a mat-stroked-button class="btn-chico" [routerLink]="['/dashboard/tareas/bandeja']" [queryParams]="{ usuario: m.usuario_id, nombre: m.nombre, vista: 'todos' }">
                  <mat-icon>visibility</mat-icon>Ver bandeja</a></td>
              </tr>
            } @empty { <tr><td colspan="8" class="muted">Nadie ha vinculado cuentas todavía.</td></tr> }
          </tbody>
        </table>
      </div>
    }

    @if (esAdmin) {
      <section class="tarjeta">
        <h3><mat-icon>tune</mat-icon>Parámetros de la Bandeja, la actividad y los informes</h3>
        <div class="eq-params">
          @for (p of parametros(); track p.clave) {
            <label>
              <span><b>{{ p.descripcion }}</b><small class="muted">{{ p.clave }}@if (p.actualizado_en) { · cambiado {{ cuando(p.actualizado_en) }} por {{ p.actualizado_por_nombre }} }</small></span>
              @if (p.clave === 'aviso.texto') {
                <textarea rows="4" [ngModel]="p.valor" (change)="guardar(p, $any($event.target).value)"></textarea>
              } @else {
                <input [ngModel]="p.valor" (change)="guardar(p, $any($event.target).value)" />
              }
            </label>
          }
        </div>
      </section>
    }
  `,
  styleUrls: ['../bandeja-comun.css'],
  styles: [`
    :host { display: flex; flex-direction: column; gap: 12px; }
    :host > .buscar { flex: 0 0 auto; }
    .eq-tabla { overflow-x: auto; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }
    table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
    th { text-align: left; padding: 10px 12px; font-size: 12px; color: var(--muted); font-weight: 800; border-bottom: 1px solid var(--border); white-space: nowrap; }
    td { padding: 10px 12px; border-bottom: 1px solid var(--border); vertical-align: top; color: var(--text); }
    td strong, td small { display: block; }
    td .chip { margin: 0 4px 4px 0; }
    .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .mal { color: var(--danger-fg); font-weight: 800; }
    .eq-params { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr)); gap: 12px; }
    .eq-params label { display: flex; flex-direction: column; gap: 6px; }
    .eq-params label span { display: flex; flex-direction: column; gap: 2px; font-size: 13.5px; }
    .eq-params input, .eq-params textarea { border-radius: 10px; border: 1px solid var(--border-strong); padding: 8px 10px; background: var(--surface);
      color: var(--text); font: 600 13.5px var(--font-sans); }
  `],
})
export class EquipoComponent implements OnInit {
  private readonly api = inject(BandejaApiService);
  private readonly snack = inject(MatSnackBar);

  readonly miembros = signal<MiembroEquipo[]>([]);
  readonly parametros = signal<ParametroSeguimiento[]>([]);
  readonly q = signal('');
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly esAdmin = ['ADMIN', 'GERENCIA'].includes((obtenerUsuarioActual().rol || '').toUpperCase());
  readonly cuando = cuando;
  readonly filtrados = computed(() => {
    const t = this.q().trim().toLowerCase();
    return t ? this.miembros().filter(m => `${m.nombre} ${m.rol} ${m.sede}`.toLowerCase().includes(t)) : this.miembros();
  });

  ngOnInit(): void { void this.cargar(); }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      this.miembros.set(await this.api.equipo());
      if (this.esAdmin) this.parametros.set(await this.api.parametros());
    } catch (e) {
      this.error.set(mensajeError(e, 'No se pudo cargar el equipo.'));
    } finally {
      this.cargando.set(false);
    }
  }

  minutos(m: number | null | undefined): string { return minutosLegibles(m); }

  async guardar(p: ParametroSeguimiento, valor: string): Promise<void> {
    if (valor === p.valor) return;
    try {
      await this.api.guardarParametro(p.clave, valor);
      this.snack.open('Parámetro guardado', undefined, { duration: 2000 });
      this.parametros.set(await this.api.parametros());
    } catch (e) {
      this.snack.open(mensajeError(e), 'Cerrar', { duration: 4500 });
    }
  }
}
