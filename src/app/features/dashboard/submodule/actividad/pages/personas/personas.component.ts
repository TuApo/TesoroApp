import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActividadApiService } from '../../actividad-api.service';
import { Alcance, PersonaFila } from '../../actividad.models';
import { hace, hoyIso, rangoDe } from '../../actividad-ui';

/**
 * Quién está usando la plataforma y cuánto: una fila por persona con su actividad del
 * periodo. ADMIN/GERENCIA ven a todos; COORDINADOR y JEFE-DE-AREA, a los de sus sedes.
 */
@Component({
  selector: 'app-actividad-personas',
  standalone: true,
  imports: [RouterLink, FormsModule, MatIconModule, MatButtonModule, MatProgressSpinnerModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ap">
      <div class="ap-barra">
        <label class="ap-buscar"><mat-icon>search</mat-icon>
          <input type="search" placeholder="Buscar por nombre, correo o documento…" [ngModel]="q()" (ngModelChange)="buscar($event)" /></label>
        <select [ngModel]="rol()" (ngModelChange)="rol.set($event); cargar()" aria-label="Rol">
          <option value="">Todos los roles</option>
          @for (r of roles(); track r) { <option [value]="r">{{ r }}</option> }
        </select>
        <select [ngModel]="sede()" (ngModelChange)="sede.set($event); cargar()" aria-label="Sede">
          <option value="">Todas las sedes</option>
          @for (s of sedes(); track s) { <option [value]="s">{{ s }}</option> }
        </select>
        <div class="ap-periodo" role="group" aria-label="Periodo">
          @for (p of periodos; track p.clave) {
            <button type="button" [class.on]="periodo() === p.clave" (click)="elegirPeriodo(p.clave)">{{ p.etiqueta }}</button>
          }
          <input type="date" [ngModel]="desde()" (ngModelChange)="desde.set($event); periodo.set('rango'); cargar()" aria-label="Desde" />
          <input type="date" [ngModel]="hasta()" (ngModelChange)="hasta.set($event); periodo.set('rango'); cargar()" aria-label="Hasta" />
        </div>
      </div>
      <div class="ap-sub">
        <label class="ap-check"><input type="checkbox" [ngModel]="soloActivos()" (ngModelChange)="soloActivos.set($event); cargar()" /> Solo con actividad en el periodo</label>
        <span class="ap-alc">{{ textoAlcance() }}</span>
        <span class="ap-esp"></span>
        @if (alcance()?.supervisa) {
          <a mat-stroked-button class="ap-btn" routerLink="/dashboard/actividad/informes" [queryParams]="{ nuevo: 'EQUIPO', rol: rol() || null, sede: sede() || null }">
            <mat-icon>auto_awesome</mat-icon>Informe IA del equipo</a>
        }
      </div>

      @if (cargando()) { <div class="ap-centro"><mat-spinner diameter="36" /></div> }
      @else {
        <p class="ap-total">{{ total() }} persona(s) · {{ desde() }} a {{ hasta() }}</p>
        <div class="ap-tabla">
          <table>
            <thead><tr>
              <th>Persona</th>
              <th (click)="ordenar('')" class="ord" [class.on]="orden() === ''">Última actividad</th>
              <th (click)="ordenar('dias')" class="ord num" [class.on]="orden() === 'dias'">Días</th>
              <th (click)="ordenar('peticiones')" class="ord num" [class.on]="orden() === 'peticiones'">Acciones</th>
              <th (click)="ordenar('cambios')" class="ord num" [class.on]="orden() === 'cambios'">Cambios</th>
              <th class="num" matTooltip="Respuestas con error (4xx/5xx)">Errores</th>
              <th class="num">Ingresos</th>
              <th class="num" matTooltip="Creadas / completadas">Tareas</th>
              <th class="num" matTooltip="Correo y WhatsApp vinculados: recibidos / enviados">Mensajes</th>
              <th class="num">Por responder</th>
            </tr></thead>
            <tbody>
              @for (p of personas(); track p.usuario_id) {
                <tr (click)="abrir(p)" tabindex="0" (keydown.enter)="abrir(p)">
                  <td><strong>{{ p.nombre }}</strong><small>{{ p.rol }}@if (p.sede) { · {{ p.sede }} }@if (!p.activo) { · <b class="mal">inactivo</b> }</small></td>
                  <td>{{ hace(p.ultima_actividad) }}</td>
                  <td class="num">{{ p.dias ?? 0 }}</td>
                  <td class="num">{{ p.peticiones ?? 0 }}</td>
                  <td class="num">{{ p.cambios ?? 0 }}</td>
                  <td class="num" [class.mal]="(p.errores ?? 0) > 0">{{ p.errores ?? 0 }}</td>
                  <td class="num">{{ p.ingresos ?? 0 }}@if ((p.ingresos_fallidos ?? 0) > 0) { <small class="mal">{{ p.ingresos_fallidos }} fallidos</small> }</td>
                  <td class="num">{{ p.tareas_creadas ?? 0 }} / {{ p.tareas_completadas ?? 0 }}</td>
                  <td class="num">{{ p.mensajes_recibidos ?? 0 }} / {{ p.mensajes_enviados ?? 0 }}</td>
                  <td class="num" [class.mal]="(p.por_responder ?? 0) > 0">{{ p.por_responder ?? 0 }}</td>
                </tr>
              } @empty {
                <tr><td colspan="10" class="ap-vacio">Nadie con actividad en el periodo.</td></tr>
              }
            </tbody>
          </table>
        </div>
        @if (personas().length < total()) { <button mat-stroked-button class="ap-mas" (click)="mas()">Cargar más</button> }
      }
    </div>
  `,
  styleUrls: ['../../actividad-comun.css'],
  styles: [`
    .ap-sub { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
    .ap-check { display: inline-flex; align-items: center; gap: 6px; font-weight: 650; font-size: 13.5px; }
    .ap-alc { font-size: 12.5px; color: var(--muted); }
    .ap-esp { flex: 1; }
    .ap-total { margin: 0; font-size: 13px; color: var(--muted); }
    .ap-tabla tbody tr { cursor: pointer; }
    .ap-tabla tbody tr:hover td { background: var(--surface-2); }
    .ord { cursor: pointer; user-select: none; }
    .ord.on { color: var(--text); text-decoration: underline; }
    .ap-mas { align-self: center; }
  `],
})
export class PersonasComponent implements OnInit {
  private readonly api = inject(ActividadApiService);
  private readonly router = inject(Router);

  readonly periodos = [{ clave: 'hoy', etiqueta: 'Hoy' }, { clave: '7', etiqueta: '7 días' }, { clave: '30', etiqueta: '30 días' }, { clave: '90', etiqueta: '90 días' }];
  readonly periodo = signal('7');
  readonly desde = signal(rangoDe('7').desde);
  readonly hasta = signal(hoyIso());
  readonly q = signal('');
  readonly rol = signal('');
  readonly sede = signal('');
  readonly orden = signal('');
  readonly soloActivos = signal(true);
  readonly personas = signal<PersonaFila[]>([]);
  readonly total = signal(0);
  readonly pagina = signal(0);
  readonly roles = signal<string[]>([]);
  readonly sedes = signal<string[]>([]);
  readonly alcance = signal<Alcance | null>(null);
  readonly cargando = signal(false);
  readonly hace = hace;
  private t: ReturnType<typeof setTimeout> | null = null;

  async ngOnInit(): Promise<void> {
    try { this.alcance.set(await this.api.alcance()); } catch { /* sin alcance: la API decide */ }
    const a = this.alcance();
    // Quien solo puede verse a sí mismo va directo a su ficha.
    if (a && !a.supervisa) { void this.router.navigate(['/dashboard/actividad/personas', a.yo], { replaceUrl: true }); return; }
    await this.cargar();
  }

  async cargar(pagina = 0): Promise<void> {
    if (pagina === 0) this.cargando.set(true);
    try {
      const r = await this.api.personas({
        q: this.q() || null, rol: this.rol() || null, sede: this.sede() || null, desde: this.desde(), hasta: this.hasta(),
        soloConActividad: this.soloActivos(), orden: this.orden() || null, pagina, tamano: 80,
      });
      this.personas.set(pagina === 0 ? r.items : [...this.personas(), ...r.items]);
      this.total.set(r.total);
      this.pagina.set(pagina);
      if (!this.roles().length) this.roles.set(r.roles);
      if (!this.sedes().length) this.sedes.set(r.sedes);
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

  elegirPeriodo(p: string): void {
    const r = rangoDe(p);
    this.periodo.set(p);
    this.desde.set(r.desde);
    this.hasta.set(r.hasta);
    void this.cargar();
  }

  ordenar(o: string): void {
    this.orden.set(o);
    void this.cargar();
  }

  abrir(p: PersonaFila): void {
    void this.router.navigate(['/dashboard/actividad/personas', p.usuario_id], { queryParams: { desde: this.desde(), hasta: this.hasta() } });
  }

  textoAlcance(): string {
    const a = this.alcance();
    if (!a) return '';
    return a.total ? 'Ves a todas las personas.' : a.por_sede ? 'Ves a las personas de tus sedes.' : 'Ves solo tu actividad.';
  }
}
